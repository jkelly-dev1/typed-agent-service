import { describe, expect, it } from 'vitest';
import { createSseParser, isTerminal } from './sse';

const frame = (e: unknown) =>
  `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`;

describe('SSE framing', () => {
  it('reads one whole frame', () => {
    const push = createSseParser();
    expect(push(frame({ type: 'token', text: 'hi' }))).toEqual([{ type: 'token', text: 'hi' }]);
  });

  it('holds a frame split across two chunks until the rest arrives', () => {
    // THE REASON THIS MODULE EXISTS. A read boundary lands wherever the
    // network puts it, and a parser that assumes one chunk is one frame
    // works locally and drops events over a real connection.
    const push = createSseParser();
    const whole = frame({ type: 'token', text: 'split' });
    const cut = Math.floor(whole.length / 2);
    expect(push(whole.slice(0, cut))).toEqual([]);
    expect(push(whole.slice(cut))).toEqual([{ type: 'token', text: 'split' }]);
  });

  it('reads several frames delivered in one chunk', () => {
    const push = createSseParser();
    const chunk =
      frame({ type: 'tool_call', name: 'calc', input: { expr: '2+2' } }) +
      frame({ type: 'tool_result', name: 'calc', ok: true, content: '4' }) +
      frame({ type: 'done', answer: '4', iterations: 1, toolCalls: 1 });
    expect(push(chunk).map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'done']);
  });

  it('ignores an event type it does not know instead of throwing', () => {
    // The service may add an event before this page is redeployed.
    const push = createSseParser();
    expect(push(frame({ type: 'heartbeat' }))).toEqual([]);
  });

  it('drops a frame whose data is not JSON rather than failing the run', () => {
    const push = createSseParser();
    expect(push('event: token\ndata: {not json\n\n')).toEqual([]);
  });

  it('does not emit a frame that has arrived without its terminator', () => {
    const push = createSseParser();
    expect(push('event: token\ndata: {"type":"token","text":"x"}')).toEqual([]);
  });

  it('knows which events end a run', () => {
    expect(isTerminal({ type: 'done', answer: '', iterations: 1, toolCalls: 0 })).toBe(true);
    expect(isTerminal({ type: 'error', code: 'x', message: 'y' })).toBe(true);
    expect(isTerminal({ type: 'token', text: 'x' })).toBe(false);
  });
});
