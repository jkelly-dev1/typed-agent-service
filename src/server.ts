import Fastify, { type FastifyInstance } from 'fastify';
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
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  // Typed error boundary: every thrown error becomes problem+json exactly once.
  app.setErrorHandler((err, request, reply) => {
    const problem = toProblem(err, request.id);
    if (problem.status >= 500) {
      request.log.error({ err }, 'request failed');
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
        detail: `No route for ${request.method} ${request.url}`,
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
