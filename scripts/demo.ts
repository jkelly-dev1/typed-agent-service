/**
 * End-to-end demo over real HTTP: starts the service on an ephemeral port,
 * exercises the SSE stream, the buffered JSON endpoint, the validation
 * boundary, and the health check, then shuts down. Offline by default (mock
 * provider); set AGENT_PROVIDER=anthropic + ANTHROPIC_API_KEY for a real model.
 */
import { loadConfig } from '../src/config.js';
import { loadEnvFiles } from '../src/env.js';
import { buildApp } from '../src/server.js';

loadEnvFiles();
const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn' });
const app = buildApp({ config });
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

function say(title: string): void {
  process.stdout.write(`\n=== ${title} ===\n`);
}

async function streamChat(message: string): Promise<void> {
  say(`SSE stream: ${JSON.stringify(message)}`);
  const res = await fetch(`${base}/v1/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = frame.split('\n').find((l) => l.startsWith('event: '))?.slice(7) ?? '?';
      const data = frame.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? '{}';
      if (event === 'token') {
        process.stdout.write((JSON.parse(data) as { text: string }).text);
      } else {
        process.stdout.write(`\n[${event}] ${data}\n`);
      }
    }
  }
  process.stdout.write('\n');
}

async function jsonChat(message: string): Promise<void> {
  say(`Buffered JSON: ${JSON.stringify(message)}`);
  const res = await fetch(`${base}/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  process.stdout.write(`HTTP ${res.status}\n${JSON.stringify(await res.json(), null, 2)}\n`);
}

async function invalidBody(): Promise<void> {
  say('Validation boundary: empty message');
  const res = await fetch(`${base}/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  });
  process.stdout.write(
    `HTTP ${res.status} (${res.headers.get('content-type')})\n${JSON.stringify(await res.json(), null, 2)}\n`,
  );
}

try {
  const health = await (await fetch(`${base}/healthz`)).json();
  say('Health');
  process.stdout.write(`${JSON.stringify(health)}\n`);

  await streamChat('calc: (2 + 3) * 4 ^ 2');
  await streamChat('define: audit trail');
  await jsonChat('convert 10 km to mi');
  await invalidBody();
} finally {
  await app.close();
}
