import type { AppConfig } from '../config.js';
import { resolveProviderName } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OpenAiProvider } from './openai.js';
import type { Provider } from './types.js';

export function getProvider(config: AppConfig): Provider {
  const name = resolveProviderName(config);
  if (name === 'anthropic') {
    return new AnthropicProvider(config.ANTHROPIC_API_KEY as string, config.ANTHROPIC_MODEL);
  }
  if (name === 'openai') {
    return new OpenAiProvider(config.OPENAI_API_KEY as string, config.OPENAI_MODEL);
  }
  return new MockProvider();
}
