import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApp } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /v1/chat', () => {
  it('returns the full run as JSON', async () => {
    app = testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { message: 'convert 10 km to mi' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      provider: string;
      answer: string;
      iterations: number;
      toolCalls: Array<{ name: string; ok: boolean; content: string }>;
    };
    expect(body.provider).toBe('mock');
    expect(body.toolCalls).toHaveLength(1);
    expect(body.toolCalls[0]).toMatchObject({ name: 'unit_convert', ok: true });
    expect(body.answer).toContain('6.21371');
  });

  it('rejects an invalid body with problem+json and field-level issues', async () => {
    app = testApp();
    const res = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const problem = res.json() as { code: string; requestId: string; issues: Array<{ path: string }> };
    expect(problem.code).toBe('validation_failed');
    expect(problem.requestId).toBeTruthy();
    expect(problem.issues.some((i) => i.path === 'message')).toBe(true);
  });

  it('never leaks internals on unexpected errors', async () => {
    app = testApp();
    // Force an unexpected error type through the boundary.
    app.get('/boom', () => {
      throw new RangeError('secret internal detail');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const problem = res.json() as { detail: string; code: string };
    expect(problem.code).toBe('internal_error');
    expect(problem.detail).not.toContain('secret');
  });

  it('returns problem+json for unknown routes', async () => {
    app = testApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect((res.json() as { code: string }).code).toBe('not_found');
  });

  it('maps a run that exceeds the iteration cap to a 502 problem', async () => {
    app = testApp({ MAX_TOOL_ITERATIONS: '2' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { message: 'loop forever' },
    });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { code: string }).code).toBe('max_iterations_exceeded');
  });
});

describe('GET /healthz', () => {
  it('reports provider and tools', async () => {
    app = testApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      provider: 'mock',
      tools: ['calculator', 'unit_convert', 'glossary_lookup'],
    });
  });
});
