import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Provider, ProviderEvent, ProviderRequest } from '../src/providers/types.js';
import { parseSse, testApp } from './helpers.js';

/**
 * Real-socket regression tests. The client-disconnect detector once listened
 * on the REQUEST's `close` event, which fires when the request body completes
 * normally over real HTTP; every run aborted itself, yet all inject-based
 * tests passed because inject never emits that event. These tests go through
 * a real listening socket so that class of bug cannot pass again.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function listen(env: Record<string, string> = {}, provider?: Provider): Promise<string> {
  app = testApp(env, provider);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

const json = { 'content-type': 'application/json' };

/**
 * A provider that streams one token, then waits for its signal and reports
 * what it saw. Cancellation is only real if it reaches here.
 */
class WaitingProvider implements Provider {
  readonly name = 'waiting';
  readonly aborted: Promise<AbortSignal>;
  private resolveAborted!: (signal: AbortSignal) => void;

  constructor() {
    this.aborted = new Promise((resolve) => {
      this.resolveAborted = resolve;
    });
  }

  async *stream(_request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent, void, void> {
    yield { type: 'text', text: 'partial' };
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    this.resolveAborted(signal);
    throw signal.reason;
  }
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`not cancelled within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

describe('over a real HTTP socket', () => {
  it('completes a buffered run without self-aborting', async () => {
    const base = await listen();
    const res = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ message: 'calc: 6 * 7' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string };
    expect(body.answer).toContain('6 * 7 = 42');
  });

  it('streams SSE to completion with a done frame', async () => {
    const base = await listen();
    const res = await fetch(`${base}/v1/chat/stream`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ message: 'calc: 2 + 2' }),
    });
    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());
    expect(frames.at(-1)?.event).toBe('done');
    expect(frames.some((f) => f.event === 'error')).toBe(false);
  });

  it('cancels the run at the provider when the client disconnects mid-stream', async () => {
    const provider = new WaitingProvider();
    const base = await listen({}, provider);
    const controller = new AbortController();
    const res = await fetch(`${base}/v1/chat/stream`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ message: 'hi' }),
      signal: controller.signal,
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read(); // the first frame has arrived: the run is in flight
    controller.abort();

    const signal = await withDeadline(provider.aborted, 3000);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as { name?: string }).name).not.toBe('TimeoutError');
  });

  it('cancels the run at the provider when the server time limit passes, as a 504', async () => {
    const provider = new WaitingProvider();
    const base = await listen({ REQUEST_TIMEOUT_MS: '1000' }, provider);
    const res = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(res.status).toBe(504);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'timeout' });

    const signal = await withDeadline(provider.aborted, 3000);
    expect((signal.reason as { name?: string }).name).toBe('TimeoutError');
  });
  it('answers a request that is not HTTP with problem+json', async () => {
    // Fastify writes these straight to the socket from its client-error
    // handler, before any route, hook or error handler runs.
    const base = await listen();
    const logInfo = vi.spyOn(app!.log, 'info');
    const { port } = new URL(base);
    const { connect } = await import('node:net');
    for (const raw of ['GARBAGE\r\n\r\n',
                       'POST /v1/chat HTTP/1.1\r\nHost: x\r\nContent-Length: abc\r\n\r\n']) {
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = connect(Number(port), '127.0.0.1', () => socket.write(raw));
        let data = '';
        socket.on('data', (chunk) => { data += chunk.toString(); });
        socket.on('close', () => resolve(data));
        socket.on('error', reject);
      });
      expect(reply).toMatch(/^HTTP\/1\.1 400 /);
      expect(reply).toContain('application/problem+json');
      expect(reply).toContain('"code":"bad_request"');
      // The id in the body is only useful if a log line carries it too.
      const { requestId } = JSON.parse(reply.slice(reply.indexOf('\r\n\r\n') + 4)) as {
        requestId: string;
      };
      expect(logInfo).toHaveBeenCalledWith(
        expect.objectContaining({ requestId, code: expect.any(String) }),
        'client error',
      );
    }
  });

  it('answers request headers over the size limit as 431 problem+json', async () => {
    // Node's default limit on the whole header block is 16 KiB.
    const base = await listen();
    const { port } = new URL(base);
    const { connect } = await import('node:net');
    const raw = `GET /healthz HTTP/1.1\r\nHost: x\r\nX-Big: ${'a'.repeat(20000)}\r\n\r\n`;
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(port), '127.0.0.1', () => socket.write(raw));
      let data = '';
      socket.on('data', (chunk) => { data += chunk.toString(); });
      socket.on('close', () => resolve(data));
      socket.on('error', reject);
    });
    expect(reply).toMatch(/^HTTP\/1\.1 431 /);
    expect(reply).toContain('application/problem+json');
    expect(reply).toContain('"status":431');
  });
});
