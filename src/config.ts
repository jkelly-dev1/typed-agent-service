import { z } from 'zod';

/**
 * All runtime configuration comes through this schema. Anything invalid fails
 * fast at startup with a readable message instead of surfacing later as an
 * undefined somewhere in a request handler.
 */
const EnvSchema = z.object({
  AGENT_PROVIDER: z.enum(['mock', 'anthropic', 'openai']).default('mock'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(25).default(5),
  MAX_TOKENS: z.coerce.number().int().min(1).max(64000).default(1024),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(120000),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  return parsed.data;
}

/**
 * Provider selection requires BOTH the provider name and its credential.
 * Anything else falls back to the deterministic offline mock, so the service
 * always starts and tests never depend on the network.
 */
export function resolveProviderName(config: AppConfig): 'mock' | 'anthropic' | 'openai' {
  if (config.AGENT_PROVIDER === 'anthropic' && config.ANTHROPIC_API_KEY) {
    return 'anthropic';
  }
  if (config.AGENT_PROVIDER === 'openai' && config.OPENAI_API_KEY) {
    return 'openai';
  }
  return 'mock';
}
