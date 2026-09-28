import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';
import { resolveProviderName } from './config.js';
import { toProblem } from './errors.js';
import { getProvider } from './providers/index.js';
import type { Provider } from './providers/types.js';
import { calculatorTool } from './tools/calculator.js';
import { glossaryTool } from './tools/glossary.js';
import { ToolRegistry } from './tools/registry.js';
import { unitConvertTool } from './tools/units.js';
import { registerChatRoutes } from './routes/chat.js';

export function buildRegistry(): ToolRegistry {
  return new ToolRegistry().register(calculatorTool).register(unitConvertTool).register(glossaryTool);
}

export interface BuildAppOptions {
  config: AppConfig;
  /** Test seam: inject a provider instead of resolving one from config. */
  provider?: Provider;
}

const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * The request path, reduced to something safe to put in a response body.
 *
 * A 404 detail that interpolates the raw path returns whatever the caller
 * sent, so a path carrying markup arrives in the response body verbatim.
 * Behind a proxy that sends `nosniff` and a `default-src 'none'` CSP that is
 * inert, but this service is documented as runnable on its own, and on its own
 * it sends no security headers at all, so the body is the only thing between
 * the caller and their own renderer.
 *
 * The path is capped and everything outside an unreserved-character set is
 * percent-encoded instead of deleted. Encoding keeps two different paths
 * distinguishable; deleting the offending characters would silently map
 * `/a<b>c` and `/abc` onto one string, and a 404 that cannot tell you which
 * route was missing is not worth printing.
 */
const MAX_PATH_IN_PROBLEM = 80;

export function safePathForProblem(url: string): string {
  const path = url.split('?')[0] ?? '';
  const capped = path.slice(0, MAX_PATH_IN_PROBLEM);
  const encoded = capped.replace(
    /[^A-Za-z0-9/._~-]/g,
    (character) =>
      '%' +
      character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
  );
  return path.length > MAX_PATH_IN_PROBLEM ? `${encoded}%E2%80%A6` : encoded;
}

/**
 * A request Fastify rejects before routing. Its default bodies echo the raw
 * path, so each is answered like the 404 instead, with the path encoded and
 * capped. Fastify sends three errors here, and each keeps its own status: a
 * URL it cannot decode is 400, a route parameter over `maxParamLength` is 414,
 * and a failed async route constraint is 500.
 */
export function frameworkProblem(err: { code?: string }, url: string, requestId: string) {
  const path = safePathForProblem(url);
  const [status, title, code, detail] =
    err.code === 'FST_ERR_BAD_URL'
      ? [400, 'Bad Request', 'bad_url', `Malformed request path ${path}`]
      : err.code === 'FST_ERR_MAX_PARAM_LENGTH'
        ? [414, 'URI Too Long', 'param_too_long', `A path parameter is too long in ${path}`]
        : [500, 'Internal Server Error', 'internal_error', 'An unexpected error occurred'];
  return { type: 'about:blank', title, status, detail, code, requestId };
}

/**
 * A request that is not HTTP at all never reaches a route, a hook or the error
 * handler: Node's parser rejects it and Fastify writes a reply straight to the
 * socket. This writes that reply as problem+json. There is no request, so the
 * request id is a fresh one, and the one log line written here carries it with
 * the parser's error code. Fastify calls this bound to the app instance.
 */
export function writeClientErrorProblem(
  this: FastifyInstance,
  err: NodeJS.ErrnoException,
  socket: import('node:net').Socket,
): void {
  if (err.code === 'ECONNRESET' || socket.destroyed) return;
  const [status, title] =
    err.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? [408, 'Request Timeout']
      : err.code === 'HPE_HEADER_OVERFLOW' ? [431, 'Request Header Fields Too Large']
        : [400, 'Bad Request'];
  const requestId = randomUUID();
  this.log.info({ requestId, code: err.code }, 'client error');
  const body = JSON.stringify({
    type: 'about:blank',
    title,
    status,
    detail: 'The request could not be parsed as HTTP',
    code: 'bad_request',
    requestId,
  });
  if (socket.writable) {
    socket.write(
      `HTTP/1.1 ${status} ${title}\r\nContent-Type: application/problem+json; charset=utf-8\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
  }
  socket.destroy();
}

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const { config } = opts;
  const provider = opts.provider ?? getProvider(config);
  const registry = buildRegistry();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Secrets never reach the logs, even at trace level.
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
    },
    // A client may supply the correlation id, but only a bounded token is
    // accepted: the id is echoed in every problem body and stamped on every
    // log line for the request, so an unbounded one is a log-injection path.
    genReqId: (req) => {
      const supplied = req.headers['x-request-id'];
      return typeof supplied === 'string' && REQUEST_ID.test(supplied) ? supplied : randomUUID();
    },
    requestIdHeader: false,
    frameworkErrors: (err, request, reply) => {
      const problem = frameworkProblem(err, request.url, request.id);
      if (problem.status >= 500) request.log.error({ err }, 'request failed');
      // Typed loosely by Fastify for this hook; it is an ordinary reply.
      void (reply as unknown as FastifyReply)
        .status(problem.status)
        .header('content-type', 'application/problem+json; charset=utf-8')
        .send(problem);
    },
    clientErrorHandler: writeClientErrorProblem,
  });

  // Typed error boundary: every thrown error becomes problem+json exactly once.
  // Only an unexpected error is logged with its stack: a run that the
  // service's own controls ended, or a request the client got wrong, is an
  // outcome with a code, not a fault to trace.
  app.setErrorHandler((err, request, reply) => {
    const problem = toProblem(err, request.id);
    if (problem.code === 'internal_error') {
      request.log.error({ err }, 'request failed');
    } else if (problem.status >= 500) {
      request.log.warn({ code: problem.code }, 'run failed');
    } else {
      request.log.info({ code: problem.code }, 'request rejected');
    }
    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .send({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: `No route for ${request.method} ${safePathForProblem(request.url)}`,
        code: 'not_found',
        requestId: request.id,
      });
  });

  app.get('/healthz', () => ({
    status: 'ok',
    provider: provider.name,
    tools: registry.names(),
    uptimeSeconds: Math.round(process.uptime()),
  }));

  registerChatRoutes(app, { provider, registry, config });

  app.log.info(
    { provider: resolveProviderName(config), tools: registry.names() },
    'app configured',
  );

  return app;
}
