/** Driving one run of /v1/chat/stream and handing events to the caller. */
import { createSseParser, type AgentEvent } from './sse';

export type RunOptions = {
  message: string;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  // Explicitly `| undefined` because exactOptionalPropertyTypes is on:
  // App passes this straight through and may pass undefined.
  fetchImpl?: typeof fetch | undefined;
};

/**
 * INVALID BODIES ARE REJECTED BEFORE THE STREAM STARTS, and that asymmetry is
 * deliberate on the server side: once the first frame is written the HTTP
 * status is already sent, so later failures arrive as an `error` FRAME while a
 * bad request arrives as a real 400. The client has to handle both, and they
 * do not look alike.
 */
export async function runChat({ message, signal, onEvent, fetchImpl = fetch }: RunOptions): Promise<void> {
  const response = await fetchImpl('/v1/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!response.ok || !response.body) {
    // problem+json from the service; fall back if it is not JSON.
    let detail = `HTTP ${response.status}`;
    try {
      const problem = await response.json();
      if (problem && typeof problem.detail === 'string') detail = problem.detail;
      else if (problem && typeof problem.title === 'string') detail = problem.title;
    } catch {
      /* keep the status line */
    }
    onEvent({ type: 'error', code: `http_${response.status}`, message: detail });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const push = createSseParser();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of push(decoder.decode(value, { stream: true }))) onEvent(event);
  }
}
