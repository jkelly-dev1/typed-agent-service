import { useRef, useState } from 'react';
import { runChat } from './lib/chat';
import { isTerminal, type AgentEvent } from './lib/sse';
import { EventStream } from './components/EventStream';

/**
 * One page: ask, watch the run, stop it. No router, no state library, no
 * component library. The service is the subject; this exists to make its
 * event contract visible.
 */
export function App({ fetchImpl }: { fetchImpl?: typeof fetch } = {}) {
  const [message, setMessage] = useState('calc: (2 + 3) * 4 ^ 2');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [answer, setAnswer] = useState('');
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (running || !message.trim()) return;
    setEvents([]);
    setAnswer('');
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await runChat({
        message,
        signal: controller.signal,
        fetchImpl,
        onEvent: (event) => {
          // Tokens accumulate into the answer; everything else is a row.
          if (event.type === 'token') setAnswer((a) => a + event.text);
          else setEvents((list) => [...list, event]);
        },
      });
    } catch (err) {
      // An aborted run is a user action, not a failure to report as one.
      if (!controller.signal.aborted) {
        const detail = err instanceof Error ? err.message : String(err);
        setEvents((list) => [...list, { type: 'error', code: 'network', message: detail }]);
      }
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  const finished = events.some(isTerminal);

  return (
    <main>
      <h1>typed-agent-service</h1>
      <p className="sub">
        A bounded agent loop over typed tools. Every tool call is validated against its
        schema before it runs, and the run is streamed as typed events.
      </p>

      <form onSubmit={send}>
        <label htmlFor="message">Message</label>
        <textarea
          id="message"
          value={message}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          disabled={running}
        />
        <div className="actions">
          <button type="submit" disabled={running || !message.trim()}>
            {running ? 'Running' : 'Send'}
          </button>
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            disabled={!running}
          >
            Stop
          </button>
          {finished && !running && <span className="hint">run complete</span>}
        </div>
      </form>

      <EventStream events={events} answer={answer} />
    </main>
  );
}
