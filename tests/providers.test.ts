import { describe, expect, it } from 'vitest';
import { loadConfig, resolveProviderName } from '../src/config.js';
import { parseToolArguments, toOpenAiMessages, toOpenAiTools } from '../src/providers/openai.js';
import type { ChatMessage } from '../src/providers/types.js';

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
