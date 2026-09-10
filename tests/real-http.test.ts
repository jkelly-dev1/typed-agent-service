import { afterEach, describe, expect, it } from 'vitest';
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
});
