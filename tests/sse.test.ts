import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseSse, testApp } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /v1/chat/stream (SSE)', () => {
  it('streams the run as typed event frames ending in done', async () => {
    app = testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      payload: { message: 'calc: (2+3)*4' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const frames = parseSse(res.payload);
    const kinds = frames.map((f) => f.event);
    expect(kinds[0]).toBe('tool_call');
    expect(kinds[1]).toBe('tool_result');
    expect(kinds).toContain('token');
    expect(kinds.at(-1)).toBe('done');

    // Tokens reassemble into the final answer: framing loses nothing.
    const tokens = frames.filter((f) => f.event === 'token').map((f) => f.data['text'] as string);
    const done = frames.at(-1)?.data as { answer: string };
    expect(tokens.join('')).toBe(done.answer);
    expect(done.answer).toContain('= 20');
  });

  it('rejects invalid bodies BEFORE the stream starts (real 400, not an error frame)', async () => {
    app = testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      payload: { wrong: 'field' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('delivers in-flight failures as an error frame (status already sent)', async () => {
    app = testApp({ MAX_TOOL_ITERATIONS: '2' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      payload: { message: 'loop forever' },
    });
    // SSE cannot change the status mid-stream; the failure is data.
    expect(res.statusCode).toBe(200);
    const frames = parseSse(res.payload);
    expect(frames.at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'max_iterations_exceeded' },
    });
  });
});
