import type { ContentBlock, Provider, ProviderEvent, ProviderRequest } from './types.js';

/**
 * Anthropic adapter. The SDK is imported lazily so the service and its tests
 * never load (or need) it unless this provider is actually selected.
 *
 * Streaming strategy: text deltas are forwarded as they arrive; tool_use
 * blocks are taken from the final message (their JSON input arrives as
 * incremental fragments, so the assembled form is the reliable one).
 */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent, void, void> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    const stream = client.messages.stream(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.blocks.map((b) => toAnthropicBlock(b)),
        })),
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          // The registry generates draft 2020-12 JSON Schema from Zod.
          input_schema: t.inputSchema as { type: 'object'; [k: string]: unknown },
        })),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    for (const block of final.content) {
      if (block.type === 'tool_use') {
        yield { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      }
    }
    yield {
      type: 'stop',
      reason:
        final.stop_reason === 'tool_use'
          ? 'tool_use'
          : final.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : 'end_turn',
    };
  }
}

/**
 * Structural match for the SDK's ContentBlockParam variants, declared locally
 * so no SDK types are imported at module level (the SDK stays a lazy import).
 */
type AnthropicBlockParam =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean };

function toAnthropicBlock(block: ContentBlock): AnthropicBlockParam {
  switch (block.kind) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
  }
}
