import type { AgentEvent } from '../lib/sse';

/**
 * The run, as it happens. Tokens are joined into one answer paragraph; every
 * tool call is shown with the input it was given and the result it returned,
 * because "which tools did it call and what came back" is the question this
 * service exists to answer and a chat bubble hides it.
 */
export function EventStream({ events, answer }: { events: AgentEvent[]; answer: string }) {
  const failure = events.find((e) => e.type === 'error');
  const finished = events.find((e) => e.type === 'done');

  return (
    <section aria-label="Run">
      {answer && (
        <p className="answer" data-testid="answer">
          {answer}
        </p>
      )}

      <ol className="tools">
        {events.map((event, i) => {
          if (event.type === 'tool_call') {
            return (
              <li key={i} className="tool-call" data-testid="tool-call">
                <span className="tool-name">{event.name}</span>
                <code>{JSON.stringify(event.input)}</code>
              </li>
            );
          }
          if (event.type === 'tool_result') {
            return (
              <li
                key={i}
                className={event.ok ? 'tool-result ok' : 'tool-result failed'}
                data-testid="tool-result"
              >
                <span className="tool-name">{event.name}</span>
                <span className="badge">{event.ok ? 'ok' : 'failed'}</span>
                <code>{event.content}</code>
              </li>
            );
          }
          return null;
        })}
      </ol>

      {failure && failure.type === 'error' && (
        <p className="error" role="alert" data-testid="error">
          <strong>{failure.code}</strong> {failure.message}
        </p>
      )}

      {finished && finished.type === 'done' && (
        <p className="done" data-testid="done">
          {finished.iterations} iteration{finished.iterations === 1 ? '' : 's'},{' '}
          {finished.toolCalls} tool call{finished.toolCalls === 1 ? '' : 's'}
        </p>
      )}
    </section>
  );
}
