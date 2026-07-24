import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../src/agent/loop.js';
import { runAgent } from '../src/agent/loop.js';
import { MockProvider } from '../src/providers/mock.js';
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
    // MUTATION CHECK: this test is what makes the cap claim non-vacuous.
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
    const controller = new AbortController();
    controller.abort();
    const events: AgentEvent[] = [];
    const run = runAgent({
      provider: new MockProvider(),
      registry: buildRegistry(),
      system: 'test',
      userMessage: 'calc: 1+1',
      maxIterations: 5,
      maxTokens: 256,
      signal: controller.signal,
    });
    for await (const event of run) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });
});
