import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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

async function listen(): Promise<string> {
  app = testApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

describe('over a real HTTP socket', () => {
  it('completes a buffered run without self-aborting', async () => {
    const base = await listen();
    const res = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'calc: 2 + 2' }),
    });
    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());
    expect(frames.at(-1)?.event).toBe('done');
    expect(frames.some((f) => f.event === 'error')).toBe(false);
  });
});
