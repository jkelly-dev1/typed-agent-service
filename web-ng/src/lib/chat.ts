/** Driving one run of /v1/chat/stream and handing events to the caller. */
import { Injectable, InjectionToken, inject } from '@angular/core';
import { createSseParser, type AgentEvent } from './sse';

/**
 * fetch arrives through DI rather than being reached for globally, so a test
 * can supply a stream without a server and without patching globalThis.
 *
 * This is the Angular counterpart of the React client's `fetchImpl` prop. The
 * seam is the same seam; only the mechanism differs, and DI is the mechanism
 * this framework already has.
 */
export const FETCH = new InjectionToken<typeof fetch>('fetch', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

export interface RunOptions {
  message: string;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly fetchImpl = inject(FETCH);

  /**
   * INVALID BODIES ARE REJECTED BEFORE THE STREAM STARTS, and that asymmetry
   * is deliberate on the server side: once the first frame is written the HTTP
   * status is already sent, so later failures arrive as an `error` FRAME while
   * a bad request arrives as a real 400. The client has to handle both, and
   * they do not look alike.
   */
  async run({ message, signal, onEvent }: RunOptions): Promise<void> {
    const response = await this.fetchImpl('/v1/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
      signal,
    });

    if (!response.ok || !response.body) {
      // problem+json from the service; fall back if it is not JSON.
      let detail = `HTTP ${response.status}`;
      try {
        const problem = (await response.json()) as { detail?: unknown; title?: unknown };
        if (typeof problem?.detail === 'string') detail = problem.detail;
        else if (typeof problem?.title === 'string') detail = problem.title;
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
}
