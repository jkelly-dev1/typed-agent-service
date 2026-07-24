import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { App } from './app';
import { FETCH } from '../lib/chat';
import type { AgentEvent } from '../lib/sse';

/** A fetch that streams the given events as SSE frames, one chunk each. */
function streamingFetch(events: AgentEvent[], ok = true, status = 200): typeof fetch {
  return (async () => {
    if (!ok) {
      return {
        ok: false,
        status,
        body: null,
        json: async () => ({ title: 'Bad Request', detail: 'message: too short' }),
      } as unknown as Response;
    }
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

async function runWith(events: AgentEvent[], ok = true, status = 200): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [{ provide: FETCH, useValue: streamingFetch(events, ok, status) }],
  });
  const fixture: ComponentFixture<App> = TestBed.createComponent(App);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await fixture.whenStable();
  return el;
}

const text = (el: HTMLElement, id: string) =>
  el.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('the run view', () => {
  it('joins streamed tokens into one answer', async () => {
    const el = await runWith([
      { type: 'token', text: 'The answer ' },
      { type: 'token', text: 'is 80.' },
      { type: 'done', answer: 'The answer is 80.', iterations: 2, toolCalls: 1 },
    ]);
    expect(text(el, 'answer')).toBe('The answer is 80.');
  });

  it('shows each tool call with the input it was given', async () => {
    // The whole point of this service is that tool inputs are validated
    // before they run. A UI that hides the input hides the subject.
    const el = await runWith([
      { type: 'tool_call', name: 'calculator', input: { expression: '(2 + 3) * 4 ^ 2' } },
      { type: 'tool_result', name: 'calculator', ok: true, content: '80' },
      { type: 'done', answer: '80', iterations: 1, toolCalls: 1 },
    ]);
    expect(text(el, 'tool-call')).toContain('calculator');
    expect(text(el, 'tool-call')).toContain('(2 + 3) * 4 ^ 2');
    expect(text(el, 'tool-result')).toContain('ok');
  });

  it('marks a failed tool result as failed rather than hiding it', async () => {
    // A tool that throws is captured and fed back to the model; the loop
    // survives it. That is a feature and it has to be visible.
    const el = await runWith([
      { type: 'tool_call', name: 'calculator', input: { expression: 'nope' } },
      { type: 'tool_result', name: 'calculator', ok: false, content: 'invalid expression' },
      { type: 'done', answer: 'I could not compute that.', iterations: 2, toolCalls: 1 },
    ]);
    expect(text(el, 'tool-result')).toContain('failed');
    expect(el.querySelector('[data-testid="tool-result"]')?.className).toContain('failed');
  });

  it('renders an in-flight failure that arrived as an error FRAME', async () => {
    // Once the stream has started the HTTP status is already sent, so a later
    // failure can only arrive as a frame. It must not look like success.
    const el = await runWith([
      { type: 'token', text: 'partial' },
      { type: 'error', code: 'provider_error', message: 'upstream refused' },
    ]);
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('provider_error');
    expect(alert?.textContent).toContain('upstream refused');
  });

  it('reports a rejected request, which arrives as a real status and not a frame', async () => {
    // The other half of that asymmetry: an invalid body is refused BEFORE the
    // stream starts, with problem+json.
    const el = await runWith([], false, 400);
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('http_400');
    expect(alert?.textContent).toContain('message: too short');
  });

  it('reports the iteration and tool-call count when the run completes', async () => {
    const el = await runWith([{ type: 'done', answer: 'x', iterations: 3, toolCalls: 1 }]);
    expect(text(el, 'done')).toContain('3 iterations');
    expect(text(el, 'done')).toContain('1 tool call');
  });
});
