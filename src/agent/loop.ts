import type { ChatMessage, ContentBlock, Provider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';

/**
 * Public event contract. Both endpoints speak this: the SSE route forwards
 * each event as a frame; the JSON route folds them into a single response.
 */
export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'done'; answer: string; iterations: number; toolCalls: number }
  | { type: 'error'; code: string; message: string };

/** Where the cause of a provider failure goes. The client only ever gets a code. */
export interface AgentLogger {
  error(obj: object, msg: string): void;
}

export interface AgentLoopOptions {
  provider: Provider;
  registry: ToolRegistry;
  system: string;
  userMessage: string;
  maxIterations: number;
  maxTokens: number;
  signal: AbortSignal;
  log?: AgentLogger;
}

/** The two ways a run is cancelled, told apart by the signal's reason. */
function cancelled(signal: AbortSignal): AgentEvent {
  const reason = signal.reason as { name?: unknown } | undefined;
  return reason?.name === 'TimeoutError'
    ? { type: 'error', code: 'timeout', message: 'Run exceeded the server time limit' }
    : { type: 'error', code: 'aborted', message: 'Request aborted by client' };
}

/**
 * The tool-use loop. One iteration = one provider call. If the model requests
 * tools, each request is validated against its Zod schema and executed, the
 * results go back into the conversation, and the loop continues. The iteration
 * cap is a hard guardrail: a model that keeps requesting tools cannot run the
 * service in circles or burn an unbounded budget.
 */
export async function* runAgent(opts: AgentLoopOptions): AsyncGenerator<AgentEvent, void, void> {
  const messages: ChatMessage[] = [
    { role: 'user', blocks: [{ kind: 'text', text: opts.userMessage }] },
  ];
  let answer = '';
  let toolCalls = 0;

  for (let iteration = 1; iteration <= opts.maxIterations; iteration++) {
    // Yield to the event loop once per iteration. Cancellation arrives as a
    // timer or a socket event, and a run whose provider and tools settle in
    // microtasks alone would never let either be delivered. This is what
    // makes the check below able to see them, and what keeps a long run
    // from starving every other request on the process.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (opts.signal.aborted) {
      yield cancelled(opts.signal);
      return;
    }

    const assistantBlocks: ContentBlock[] = [];
    const pendingTools: Array<{ id: string; name: string; input: unknown }> = [];
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';

    try {
      const stream = opts.provider.stream(
        {
          system: opts.system,
          messages,
          tools: opts.registry.specs(),
          maxTokens: opts.maxTokens,
        },
        opts.signal,
      );
      for await (const event of stream) {
        if (event.type === 'text') {
          answer += event.text;
          assistantBlocks.push({ kind: 'text', text: event.text });
          yield { type: 'token', text: event.text };
        } else if (event.type === 'tool_use') {
          pendingTools.push(event);
          assistantBlocks.push({ kind: 'tool_use', id: event.id, name: event.name, input: event.input });
        } else {
          stopReason = event.reason;
        }
      }
    } catch (err) {
      // A provider that throws after the signal fired is reporting the
      // cancellation, not a failure of its own.
      if (opts.signal.aborted) {
        yield cancelled(opts.signal);
        return;
      }
      // The provider's own failure text is for the log, where it is
      // correlated by request id. The client gets a code and a fixed message.
      opts.log?.error({ err }, 'provider failed');
      yield { type: 'error', code: 'provider_error', message: 'The model provider failed' };
      return;
    }

    if (stopReason !== 'tool_use' || pendingTools.length === 0) {
      yield { type: 'done', answer, iterations: iteration, toolCalls };
      return;
    }

    // Execute the requested tools and feed the results back.
    messages.push({ role: 'assistant', blocks: assistantBlocks });
    const resultBlocks: ContentBlock[] = [];
    for (const call of pendingTools) {
      toolCalls++;
      yield { type: 'tool_call', name: call.name, input: call.input };
      const run = await opts.registry.run(call.name, call.input);
      const content = run.ok ? run.result : run.error;
      yield { type: 'tool_result', name: call.name, ok: run.ok, content };
      resultBlocks.push({
        kind: 'tool_result',
        toolUseId: call.id,
        content,
        isError: !run.ok,
      });
    }
    messages.push({ role: 'user', blocks: resultBlocks });
  }

  yield {
    type: 'error',
    code: 'max_iterations_exceeded',
    message:
      `Agent did not finish within its configured cap of ` +
      `${opts.maxIterations} tool iterations; every provider call succeeded`,
  };
}
