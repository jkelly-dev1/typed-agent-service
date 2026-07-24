import type { ChatMessage, Provider, ProviderEvent, ProviderRequest, ToolSpec } from './types.js';

/**
 * OpenAI adapter (Chat Completions with function tools, streamed). The SDK is
 * imported lazily, mirroring the Anthropic adapter: nothing loads unless this
 * provider is selected.
 *
 * Streaming strategy: content deltas are forwarded as they arrive; tool-call
 * arguments arrive as JSON fragments accumulated per index and parsed once
 * complete. Unparseable arguments are passed through raw so the tool
 * registry's Zod boundary rejects them with a real validation message.
 */

type OpenAiMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const message of messages) {
    const toolResults = message.blocks.filter((b) => b.kind === 'tool_result');
    if (message.role === 'user' && toolResults.length > 0) {
      // Tool results are their own role in the OpenAI schema.
      for (const block of toolResults) {
        if (block.kind === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: block.toolUseId, content: block.content });
        }
      }
      continue;
    }
    if (message.role === 'user') {
      const text = message.blocks
        .filter((b): b is Extract<typeof b, { kind: 'text' }> => b.kind === 'text')
        .map((b) => b.text)
        .join('');
      out.push({ role: 'user', content: text });
      continue;
    }
    // Assistant: text plus any tool calls it made.
    const text = message.blocks
      .filter((b): b is Extract<typeof b, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('');
    const toolCalls = message.blocks
      .filter((b): b is Extract<typeof b, { kind: 'tool_use' }> => b.kind === 'tool_use')
      .map((b) => ({
        id: b.id,
        type: 'function' as const,
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }));
    out.push({
      role: 'assistant',
      content: text.length > 0 ? text : null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }
  return out;
}

export function toOpenAiTools(tools: ToolSpec[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** Parse accumulated tool arguments; hand back raw text if malformed. */
export function parseToolArguments(raw: string): unknown {
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export class OpenAiProvider implements Provider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent, void, void> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    const stream = await client.chat.completions.create(
      {
        model: this.model,
        max_completion_tokens: request.maxTokens,
        messages: [{ role: 'system', content: request.system }, ...toOpenAiMessages(request.messages)],
        tools: toOpenAiTools(request.tools),
        stream: true,
      },
      { signal },
    );

    const pending = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.delta.content) {
        yield { type: 'text', text: choice.delta.content };
      }
      for (const delta of choice.delta.tool_calls ?? []) {
        const slot = pending.get(delta.index) ?? { id: '', name: '', args: '' };
        if (delta.id) slot.id = delta.id;
        if (delta.function?.name) slot.name += delta.function.name;
        if (delta.function?.arguments) slot.args += delta.function.arguments;
        pending.set(delta.index, slot);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    for (const [, call] of [...pending.entries()].sort(([a], [b]) => a - b)) {
      yield { type: 'tool_use', id: call.id, name: call.name, input: parseToolArguments(call.args) };
    }
    yield {
      type: 'stop',
      reason:
        finishReason === 'tool_calls' ? 'tool_use' : finishReason === 'length' ? 'max_tokens' : 'end_turn',
    };
  }
}
