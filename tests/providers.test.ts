import { describe, expect, it } from 'vitest';
import { loadConfig, resolveProviderName } from '../src/config.js';
import { getProvider } from '../src/providers/index.js';
import { MockProvider } from '../src/providers/mock.js';
import { parseToolArguments, toOpenAiMessages, toOpenAiTools } from '../src/providers/openai.js';
import type { ChatMessage, ProviderEvent, ToolSpec } from '../src/providers/types.js';
import { buildRegistry } from '../src/server.js';

describe('provider resolution', () => {
  it('defaults to mock with no configuration', () => {
    expect(resolveProviderName(loadConfig({}))).toBe('mock');
  });

  it('requires BOTH the provider name and its credential', () => {
    expect(resolveProviderName(loadConfig({ AGENT_PROVIDER: 'anthropic' }))).toBe('mock');
    expect(resolveProviderName(loadConfig({ AGENT_PROVIDER: 'openai' }))).toBe('mock');
    expect(resolveProviderName(loadConfig({ ANTHROPIC_API_KEY: 'sk-x' }))).toBe('mock');
  });

  it('selects the real provider when name and key agree', () => {
    expect(
      resolveProviderName(loadConfig({ AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-x' })),
    ).toBe('anthropic');
    expect(
      resolveProviderName(loadConfig({ AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-x' })),
    ).toBe('openai');
  });

  it('does not cross-match a key from a different provider', () => {
    expect(
      resolveProviderName(loadConfig({ AGENT_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-x' })),
    ).toBe('mock');
  });
});

/**
 * The rule above is only worth what its consumer honors.
 *
 * getProvider is what the running service calls, and tests of
 * resolveProviderName alone do not prove getProvider honors the rule. If
 * getProvider read `config.AGENT_PROVIDER` directly, every test above would
 * pass while the service built a real network provider with no API key.
 *
 * These tests assert the CONSTRUCTED provider, not the resolved name.
 */
describe('getProvider honors the resolution rule', () => {
  const nameOf = (env: Record<string, string>) => getProvider(loadConfig(env)).constructor.name;

  it('builds the mock when there is no configuration', () => {
    expect(nameOf({})).toBe('MockProvider');
  });

  it('builds the mock when the name is given without its credential', () => {
    expect(nameOf({ AGENT_PROVIDER: 'anthropic' })).toBe('MockProvider');
    expect(nameOf({ AGENT_PROVIDER: 'openai' })).toBe('MockProvider');
  });

  it('builds the mock when a credential is given without the name', () => {
    expect(nameOf({ ANTHROPIC_API_KEY: 'sk-x' })).toBe('MockProvider');
    expect(nameOf({ OPENAI_API_KEY: 'sk-x' })).toBe('MockProvider');
  });

  it('does not cross-match a key from a different provider', () => {
    expect(nameOf({ AGENT_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-x' })).toBe('MockProvider');
    expect(nameOf({ AGENT_PROVIDER: 'anthropic', OPENAI_API_KEY: 'sk-x' })).toBe('MockProvider');
  });

  it('builds the real provider only when name and key agree', () => {
    expect(nameOf({ AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-x' })).toBe(
      'AnthropicProvider',
    );
    expect(nameOf({ AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-x' })).toBe('OpenAiProvider');
  });

  it('never constructs a real provider without a credential to construct it with', () => {
    for (const env of [
      {},
      { AGENT_PROVIDER: 'anthropic' },
      { AGENT_PROVIDER: 'openai' },
      { AGENT_PROVIDER: 'anthropic', OPENAI_API_KEY: 'sk-x' },
      { AGENT_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-x' },
    ]) {
      expect(nameOf(env)).toBe('MockProvider');
    }
  });
});

describe('OpenAI wire conversion', () => {
  it('maps the conversation model to OpenAI roles', () => {
    const messages: ChatMessage[] = [
      { role: 'user', blocks: [{ kind: 'text', text: 'calc: 1+1' }] },
      {
        role: 'assistant',
        blocks: [{ kind: 'tool_use', id: 'call_1', name: 'calculator', input: { expression: '1+1' } }],
      },
      {
        role: 'user',
        blocks: [{ kind: 'tool_result', toolUseId: 'call_1', content: '1+1 = 2', isError: false }],
      },
    ];
    expect(toOpenAiMessages(messages)).toEqual([
      { role: 'user', content: 'calc: 1+1' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '1+1 = 2' },
    ]);
  });

  it('maps tool specs to function tools', () => {
    const specs = toOpenAiTools([
      { name: 'calculator', description: 'math', inputSchema: { type: 'object' } },
    ]);
    expect(specs).toEqual([
      {
        type: 'function',
        function: { name: 'calculator', description: 'math', parameters: { type: 'object' } },
      },
    ]);
  });

  it('passes malformed tool arguments through for the Zod boundary to reject', () => {
    expect(parseToolArguments('{"expression":"1+1"}')).toEqual({ expression: '1+1' });
    expect(parseToolArguments('')).toEqual({});
    expect(parseToolArguments('{broken')).toBe('{broken'); // registry will reject with invalid_input
  });
});

describe('the mock provider', () => {
  it('calls only tools it was offered', async () => {
    // A real model cannot call a tool that is not in the request. The mock
    // behaves the same way, so a loop that stops sending its tools is visible.
    const provider = new MockProvider();
    const signal = new AbortController().signal;
    const messages: ChatMessage[] = [{ role: 'user', blocks: [{ kind: 'text', text: 'calc: 1+1' }] }];
    const collect = async (tools: ToolSpec[]) => {
      const events: ProviderEvent[] = [];
      for await (const e of provider.stream({ system: 'test', messages, tools, maxTokens: 64 }, signal)) {
        events.push(e);
      }
      return events;
    };
    const offered = await collect(buildRegistry().specs());
    expect(offered.some((e) => e.type === 'tool_use')).toBe(true);

    const withheld = await collect([]);
    expect(withheld.some((e) => e.type === 'tool_use')).toBe(false);
    expect(withheld.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' });
  });
});
