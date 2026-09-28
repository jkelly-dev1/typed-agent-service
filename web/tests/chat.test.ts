import { describe, expect, it } from 'vitest';
import { runChat } from '../src/lib/chat';
import type { AgentEvent } from '../src/lib/sse';

/** A fetch whose stream carries these frames and then simply ends. */
function streamOf(events: AgentEvent[]): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const e of events) {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        }
        controller.close();
      },
    });
    return { ok: true, status: 200, body } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('runChat', () => {
  it('reports a stream that ended without done or error as incomplete', async () => {
    // A dropped connection or a proxy cut ends the body with no terminal
    // frame. Without this the page shows the partial answer as if it were one.
    const seen: AgentEvent[] = [];
    await runChat({
      message: 'hi',
      signal: new AbortController().signal,
      onEvent: (e) => seen.push(e),
      fetchImpl: streamOf([{ type: 'token', text: 'partial' }]),
    });
    expect(seen.at(-1)).toMatchObject({ type: 'error', code: 'incomplete_stream' });
  });

  it('adds nothing after a stream that ended with done', async () => {
    const seen: AgentEvent[] = [];
    await runChat({
      message: 'hi',
      signal: new AbortController().signal,
      onEvent: (e) => seen.push(e),
      fetchImpl: streamOf([{ type: 'done', answer: 'ok', iterations: 1, toolCalls: 0 }]),
    });
    expect(seen.map((e) => e.type)).toEqual(['done']);
  });
});
