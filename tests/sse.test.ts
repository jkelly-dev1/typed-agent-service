import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Provider } from '../src/providers/types.js';
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
    expect(frames[0]?.data['input']).toEqual({ expression: '(2+3)*4' });
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

  it('rejects a body that is not JSON, or is empty, BEFORE the stream starts', async () => {
    // Neither body reaches the schema validator: Fastify's parser refuses
    // them first, and that refusal has to be a real 400 as well.
    app = testApp();
    const headers = { 'content-type': 'application/json' };
    for (const [payload, code] of [
      ['{not json', 'malformed_body'],
      ['', 'empty_body'],
    ] as const) {
      const res = await app.inject({ method: 'POST', url: '/v1/chat/stream', headers, payload });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({ status: 400, code });
    }
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

  it('sends a fixed message, not the error text, when writing a frame fails', async () => {
    // The route's own catch branch. A tool input the frame writer cannot
    // serialize (a BigInt) makes the write itself throw, and the text of that
    // error must stay in the log, like every provider failure does.
    const provider: Provider = {
      name: 'unserializable',
      async *stream() {
        yield { type: 'tool_use', id: 't1', name: 'calculator', input: { n: 1n } };
        yield { type: 'stop', reason: 'tool_use' };
      },
    };
    app = testApp({}, provider);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      payload: { message: 'hi' },
    });
    const last = parseSse(res.payload).at(-1);
    expect(last?.event).toBe('error');
    expect(last?.data).toMatchObject({ code: 'stream_failed', message: 'The stream failed' });
    expect(res.payload).not.toContain('BigInt');
  });
});
