import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatService, FETCH } from './chat';
import type { AgentEvent } from './sse';

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

async function run(events: AgentEvent[]): Promise<AgentEvent[]> {
  TestBed.configureTestingModule({ providers: [{ provide: FETCH, useValue: streamOf(events) }] });
  const seen: AgentEvent[] = [];
  await TestBed.inject(ChatService).run({
    message: 'hi',
    signal: new AbortController().signal,
    onEvent: (e) => seen.push(e),
  });
  return seen;
}

describe('ChatService', () => {
  it('reports a stream that ended without done or error as incomplete', async () => {
    const seen = await run([{ type: 'token', text: 'partial' }]);
    expect(seen.at(-1)).toMatchObject({ type: 'error', code: 'incomplete_stream' });
  });

  it('adds nothing after a stream that ended with done', async () => {
    const seen = await run([{ type: 'done', answer: 'ok', iterations: 1, toolCalls: 0 }]);
    expect(seen.map((e) => e.type)).toEqual(['done']);
  });
});
