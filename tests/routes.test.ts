import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockProvider } from '../src/providers/mock.js';
import type { Provider } from '../src/providers/types.js';
import { parseSse, testApp } from './helpers.js';

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

  it('rejects a body that is not JSON, an empty body, and an oversized body as client errors', async () => {
    // None of these reach the schema validator: Fastify's body parser refuses
    // them first, and each refusal is the client's mistake, not the server's.
    app = testApp();
    const headers = { 'content-type': 'application/json' };
    const cases = [
      ['{not json', 400, 'malformed_body'],
      ['', 400, 'empty_body'],
      [JSON.stringify({ message: 'x'.repeat(1024 * 1024 + 1) }), 413, 'payload_too_large'],
    ] as const;
    for (const [payload, status, code] of cases) {
      const res = await app.inject({ method: 'POST', url: '/v1/chat', headers, payload });
      expect(res.statusCode).toBe(status);
      expect(res.headers['content-type']).toContain('application/problem+json');
      const problem = res.json() as { status: number; code: string; requestId: string };
      expect(problem).toMatchObject({ status, code });
      expect(problem.requestId).toBeTruthy();
    }
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

  it('does not reflect markup from the request path into the 404 body', async () => {
    // A 404 detail that interpolates the raw path returns whatever the caller
    // sent. Behind a proxy sending nosniff and a default-src 'none' CSP that
    // is inert, but this service is documented as runnable on its own, where
    // it sends no security headers at all.
    app = testApp();
    // Raw markup in the path, and the percent-encoded form a browser produces.
    for (const path of ['/<script>alert(1)</script>', '/%3Cscript%3Ealert(1)%3C/script%3E']) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(404);
      const detail = (res.json() as { detail: string }).detail;

      // WHAT MUST BE ABSENT, which is the whole assertion. Checking only that
      // some marker is PRESENT would pass on a body that still carried the
      // markup beside it. The letters "script" are inert once the angle
      // brackets and quotes are gone, so they are not asserted on; the
      // characters that make markup are.
      for (const dangerous of ['<', '>', '"', "'", '(', ')', '&', '=']) {
        expect(detail).not.toContain(dangerous);
      }

      // and it still says which method was refused, or it is not worth printing
      expect(detail).toContain('GET');
    }
  });

  it('caps the path it echoes in the 404 body', async () => {
    app = testApp();
    const res = await app.inject({ method: 'GET', url: `/${'a'.repeat(500)}` });
    expect(res.statusCode).toBe(404);
    const detail = (res.json() as { detail: string }).detail;
    expect(detail.length).toBeLessThan(200);
    expect(detail).not.toContain('a'.repeat(200));
  });

  it('still names an ordinary missing route legibly', async () => {
    // The cap and the encoding must not make the message useless: an ordinary
    // path is unreserved characters only and comes back untouched.
    app = testApp();
    const res = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    const detail = (res.json() as { detail: string }).detail;
    expect(detail).toContain('/v1/does-not-exist');
  });

  it('hands the provider the registered tools and the request\'s system prompt', async () => {
    const provider = new MockProvider();
    app = testApp({}, provider);
    await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { message: 'calc: 1+1', system: 'Be terse.' },
    });
    expect(provider.lastRequest?.system).toBe('Be terse.');
    expect(provider.lastRequest?.tools.map((t) => t.name)).toEqual([
      'calculator',
      'unit_convert',
      'glossary_lookup',
    ]);

    await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'hello' } });
    expect(provider.lastRequest?.system).toContain('careful assistant with tools');
  });

  it('echoes a well-formed x-request-id and replaces one that is not', async () => {
    app = testApp();
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'x-request-id': 'trace-42' },
      payload: { message: '' },
    });
    expect((ok.json() as { requestId: string }).requestId).toBe('trace-42');

    const oversized = 'a"b<'.repeat(100);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'x-request-id': oversized },
      payload: { message: '' },
    });
    const id = (bad.json() as { requestId: string }).requestId;
    expect(id).not.toBe(oversized);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports the iteration cap as the service\'s own limit, not an upstream failure', async () => {
    // 502 claims an upstream server returned something invalid. Every provider
    // call here SUCCEEDED and the service stopped at its own configured cap, so
    // 502 would state something untrue to whoever is reading the log. The
    // status says only "this end"; the body carries what actually happened.
    app = testApp({ MAX_TOOL_ITERATIONS: '2' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { message: 'loop forever' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { code: string; detail: string };
    expect(body.code).toBe('max_iterations_exceeded');
    // The cap and the count are what make the response actionable.
    expect(body.detail).toMatch(/\b2\b/);
  });
});

describe('provider failures', () => {
  const failing: Provider = {
    name: 'failing',
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('ECONNREFUSED 10.0.0.7:443 with key sk-secret-1234');
    },
  };

  it("never delivers the provider's own error text to the client, on either route", async () => {
    app = testApp({}, failing);
    const json = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'hi' } });
    expect(json.statusCode).toBe(502);
    const problem = json.json() as { code: string; detail: string };
    expect(problem.code).toBe('provider_error');
    expect(json.payload).not.toContain('sk-secret');
    expect(json.payload).not.toContain('ECONNREFUSED');

    const sse = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      payload: { message: 'hi' },
    });
    expect(sse.statusCode).toBe(200);
    expect(parseSse(sse.payload).at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'provider_error' },
    });
    expect(sse.payload).not.toContain('sk-secret');
    expect(sse.payload).not.toContain('ECONNREFUSED');
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
