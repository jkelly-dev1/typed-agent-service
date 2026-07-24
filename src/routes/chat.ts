import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgentEvent } from '../agent/loop.js';
import { runAgent } from '../agent/loop.js';
import type { AppConfig } from '../config.js';
import { AppError, ValidationError } from '../errors.js';
import type { Provider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';

const ChatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  system: z.string().min(1).max(2000).optional(),
});

const DEFAULT_SYSTEM = [
  'You are a careful assistant with tools. Use a tool whenever one applies',
  'instead of answering from memory: calculator for arithmetic, unit_convert',
  'for unit conversions, glossary_lookup for AI-governance terms. Answer',
  'glossary questions only from the tool result; if the tool reports the term',
  'is not found, say you do not have a definition rather than inventing one.',
  'Reply in plain text with no markdown formatting.',
].join(' ');

export interface ChatDeps {
  provider: Provider;
  registry: ToolRegistry;
  config: AppConfig;
}

interface CompletedRun {
  answer: string;
  iterations: number;
  tools: Array<{ name: string; input: unknown; ok: boolean; content: string }>;
}

function parseBody(request: FastifyRequest): z.infer<typeof ChatBodySchema> {
  const parsed = ChatBodySchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError(parsed.error);
  return parsed.data;
}

/**
 * Client disconnect and the server-side timeout both cancel the same run.
 * Disconnect is detected on the RESPONSE: `close` before the response has
 * finished writing means the client went away. (Listening on the request
 * instead is a trap: its `close` fires when the request body completes
 * normally, which aborts every run over real HTTP while passing under
 * inject-based tests.)
 */
function requestSignal(reply: FastifyReply, timeoutMs: number): AbortSignal {
  const clientAbort = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) clientAbort.abort();
  });
  return AbortSignal.any([clientAbort.signal, AbortSignal.timeout(timeoutMs)]);
}

async function collectRun(events: AsyncGenerator<AgentEvent>): Promise<CompletedRun> {
  const tools: CompletedRun['tools'] = [];
  let pending: { name: string; input: unknown } | undefined;
  for await (const event of events) {
    switch (event.type) {
      case 'token':
        break;
      case 'tool_call':
        pending = { name: event.name, input: event.input };
        break;
      case 'tool_result':
        tools.push({
          name: event.name,
          input: pending?.input,
          ok: event.ok,
          content: event.content,
        });
        pending = undefined;
        break;
      case 'done':
        return { answer: event.answer, iterations: event.iterations, tools };
      case 'error':
        throw new AppError(event.code, event.message, event.code === 'aborted' ? 499 : 502);
    }
  }
  throw new AppError('incomplete_run', 'Agent stream ended without a terminal event', 502);
}

function sseWrite(reply: FastifyReply, event: AgentEvent): void {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function registerChatRoutes(app: FastifyInstance, deps: ChatDeps): void {
  const { provider, registry, config } = deps;

  const startRun = (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(request);
    const signal = requestSignal(reply, config.REQUEST_TIMEOUT_MS);
    return runAgent({
      provider,
      registry,
      system: body.system ?? DEFAULT_SYSTEM,
      userMessage: body.message,
      maxIterations: config.MAX_TOOL_ITERATIONS,
      maxTokens: config.MAX_TOKENS,
      signal,
    });
  };

  // Buffered JSON: the whole run in one response body.
  app.post('/v1/chat', async (request, reply) => {
    const run = await collectRun(startRun(request, reply));
    return {
      provider: provider.name,
      answer: run.answer,
      iterations: run.iterations,
      toolCalls: run.tools,
    };
  });

  // Streaming SSE: one frame per agent event. Note the error asymmetry: once
  // the stream starts the HTTP status is already sent, so failures arrive as
  // an `error` event frame rather than a problem+json response.
  app.post('/v1/chat/stream', async (request, reply) => {
    const events = startRun(request, reply); // validation errors still become 400s
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    try {
      for await (const event of events) {
        sseWrite(reply, event);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sseWrite(reply, { type: 'error', code: 'stream_failed', message });
    } finally {
      reply.raw.end();
    }
  });
}
