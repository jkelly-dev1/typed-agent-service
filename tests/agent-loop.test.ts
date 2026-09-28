import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../src/agent/loop.js';
import { runAgent } from '../src/agent/loop.js';
import { MockProvider } from '../src/providers/mock.js';
import type { Provider } from '../src/providers/types.js';
import { buildRegistry } from '../src/server.js';

async function collect(userMessage: string, maxIterations = 5): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const run = runAgent({
    provider: new MockProvider(),
    registry: buildRegistry(),
    system: 'test',
    userMessage,
    maxIterations,
    maxTokens: 256,
    signal: new AbortController().signal,
  });
  for await (const event of run) events.push(event);
  return events;
}

describe('agent loop', () => {
  it('runs tool call -> result -> answer and terminates with done', async () => {
    const events = await collect('calc: (2+3)*4');
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('tool_call');
    expect(types[1]).toBe('tool_result');
    expect(types).toContain('token');
    expect(types[types.length - 1]).toBe('done');

    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.answer).toContain('(2+3)*4 = 20');
    expect(done.iterations).toBe(2); // one tool turn + one answer turn
    expect(done.toolCalls).toBe(1);
  });

  it('enforces the iteration cap on a model that never stops requesting tools', async () => {
    // Mutation check: this test is what makes the cap claim non-vacuous.
    // Remove the cap (or raise it silently) and this fails: the mock requests
    // a tool on every turn, so only the cap can terminate the run.
    const maxIterations = 3;
    const events = await collect('loop forever', maxIterations);
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'max_iterations_exceeded' });
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(maxIterations); // exactly one per iteration, then stop
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('feeds schema-invalid tool input back as an error result and still completes', async () => {
    const events = await collect('bad tool call');
    const result = events.find((e) => e.type === 'tool_result') as Extract<
      AgentEvent,
      { type: 'tool_result' }
    >;
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/Invalid input for calculator/);

    // The loop does not crash on a bad call: the model gets the validation
    // error as data and produces a final answer acknowledging the failure.
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.answer).toMatch(/could not complete/i);
  });

  it('aborts cleanly when the signal fires', async () => {
    // The loop's own check, not the provider's: an already-aborted signal
    // ends the run before the provider is called at all, with the abort code.
    const controller = new AbortController();
    controller.abort();
    let providerCalls = 0;
    const counting: Provider = {
      name: 'counting',
      stream(request, signal) {
        providerCalls++;
        return new MockProvider().stream(request, signal);
      },
    };
    const events: AgentEvent[] = [];
    const run = runAgent({
      provider: counting,
      registry: buildRegistry(),
      system: 'test',
      userMessage: 'calc: 1+1',
      maxIterations: 5,
      maxTokens: 256,
      signal: controller.signal,
    });
    for await (const event of run) events.push(event);
    expect(events).toEqual([{ type: 'error', code: 'aborted', message: 'Request aborted by client' }]);
    expect(providerCalls).toBe(0);
  });

  it('reports a provider failure as a code and sends the cause to the log', async () => {
    const logged: Array<{ err: unknown; msg: string }> = [];
    const failing: Provider = {
      name: 'failing',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('upstream rejected key sk-secret-1234');
      },
    };
    const events: AgentEvent[] = [];
    const run = runAgent({
      provider: failing,
      registry: buildRegistry(),
      system: 'test',
      userMessage: 'hi',
      maxIterations: 5,
      maxTokens: 256,
      signal: new AbortController().signal,
      log: { error: (obj, msg) => logged.push({ err: (obj as { err: unknown }).err, msg }) },
    });
    for await (const event of run) events.push(event);
    expect(events).toEqual([
      { type: 'error', code: 'provider_error', message: 'The model provider failed' },
    ]);
    expect(logged).toHaveLength(1);
    expect((logged[0]?.err as Error).message).toContain('sk-secret-1234');
  });

  it('reports a run the model cut off at its token limit as truncated, not done', async () => {
    // The Anthropic and OpenAI providers both report max_tokens; the mock
    // never does. Read as an ordinary end of turn, a cut-off answer would
    // return as a 200, and a tool call in that turn would be dropped without
    // a word.
    for (const tail of [
      [{ type: 'text', text: 'The answer is 4' }],
      [{ type: 'tool_use', id: 't1', name: 'calculator', input: { expression: '2+2' } }],
    ] as const) {
      const cut: Provider = {
        name: 'cut',
        async *stream() {
          yield* tail;
          yield { type: 'stop', reason: 'max_tokens' };
        },
      };
      const events: AgentEvent[] = [];
      const run = runAgent({
        provider: cut,
        registry: buildRegistry(),
        system: 'test',
        userMessage: 'hi',
        maxIterations: 5,
        maxTokens: 256,
        signal: new AbortController().signal,
      });
      for await (const event of run) events.push(event);
      expect(events.at(-1)).toMatchObject({ type: 'error', code: 'truncated' });
      expect(events.some((e) => e.type === 'done')).toBe(false);
    }
  });
});
