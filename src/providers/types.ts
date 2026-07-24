/**
 * Provider-agnostic conversation model. The agent loop speaks only these
 * types; each provider adapts them to its own wire format. Adding a provider
 * means implementing one interface, not touching the loop.
 */

export type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input, generated from the Zod schema. */
  inputSchema: Record<string, unknown>;
}

export interface ProviderRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens: number;
}

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'stop'; reason: 'end_turn' | 'tool_use' | 'max_tokens' };

export interface Provider {
  readonly name: string;
  stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent, void, void>;
}
