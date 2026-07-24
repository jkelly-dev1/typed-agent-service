import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';

/**
 * Test app factory. Only the env entries passed in are visible to the config
 * loader, so the ambient shell environment (a real AGENT_PROVIDER or API key)
 * can never leak into a test run. Tests are offline by construction.
 */
export function testApp(env: Record<string, string> = {}): FastifyInstance {
  const config = loadConfig({ LOG_LEVEL: 'fatal', ...env });
  return buildApp({ config });
}

export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

/** Parse a text/event-stream payload into typed frames. */
export function parseSse(payload: string): SseFrame[] {
  return payload
    .split('\n\n')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const eventLine = chunk.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) throw new Error(`Malformed SSE frame: ${JSON.stringify(chunk)}`);
      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>,
      };
    });
}
