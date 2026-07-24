import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import type { AgentEvent } from '../src/lib/sse';

/** A fetch that streams the given events as SSE frames, one chunk each. */
function streamingFetch(events: AgentEvent[], ok = true, status = 200): typeof fetch {
  return (async () => {
    if (!ok) {
      return {
        ok: false,
        status,
        body: null,
        json: async () => ({ title: 'Bad Request', detail: 'message: too short' }),
      } as unknown as Response;
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const e of events) {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        }
        controller.close();
      },
    });
    return { ok: true, status: 200, body } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('the run view', () => {
  it('joins streamed tokens into one answer', async () => {
    render(
      <App
        fetchImpl={streamingFetch([
          { type: 'token', text: 'The answer ' },
          { type: 'token', text: 'is 80.' },
          { type: 'done', answer: 'The answer is 80.', iterations: 2, toolCalls: 1 },
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('answer')).toHaveTextContent('The answer is 80.'));
  });

  it('shows each tool call with the input it was given', async () => {
    // The whole point of this service is that tool inputs are validated
    // before they run. A UI that hides the input hides the subject.
    render(
      <App
        fetchImpl={streamingFetch([
          { type: 'tool_call', name: 'calculator', input: { expression: '(2 + 3) * 4 ^ 2' } },
          { type: 'tool_result', name: 'calculator', ok: true, content: '80' },
          { type: 'done', answer: '80', iterations: 1, toolCalls: 1 },
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('tool-call')).toHaveTextContent('calculator'));
    expect(screen.getByTestId('tool-call')).toHaveTextContent('(2 + 3) * 4 ^ 2');
    expect(screen.getByTestId('tool-result')).toHaveTextContent('ok');
  });

  it('marks a failed tool result as failed rather than hiding it', async () => {
    // A tool that throws is captured and fed back to the model; the loop
    // survives it. That is a feature and it has to be visible.
    render(
      <App
        fetchImpl={streamingFetch([
          { type: 'tool_call', name: 'calculator', input: { expression: 'nope' } },
          { type: 'tool_result', name: 'calculator', ok: false, content: 'invalid expression' },
          { type: 'done', answer: 'I could not compute that.', iterations: 2, toolCalls: 1 },
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('tool-result')).toHaveTextContent('failed'));
  });

  it('renders an in-flight failure that arrived as an error FRAME', async () => {
    // Once the stream has started the HTTP status is already sent, so a later
    // failure can only arrive as a frame. It must not look like success.
    render(
      <App
        fetchImpl={streamingFetch([
          { type: 'token', text: 'partial' },
          { type: 'error', code: 'provider_error', message: 'upstream refused' },
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('provider_error'));
    expect(screen.getByRole('alert')).toHaveTextContent('upstream refused');
  });

  it('reports a rejected request, which arrives as a real status and not a frame', async () => {
    // The other half of that asymmetry: an invalid body is refused BEFORE the
    // stream starts, with problem+json.
    render(<App fetchImpl={streamingFetch([], false, 400)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('http_400'));
    expect(screen.getByRole('alert')).toHaveTextContent('message: too short');
  });

  it('reports the iteration and tool-call count when the run completes', async () => {
    render(
      <App
        fetchImpl={streamingFetch([
          { type: 'done', answer: 'x', iterations: 3, toolCalls: 1 },
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('done')).toHaveTextContent('3 iterations'));
    expect(screen.getByTestId('done')).toHaveTextContent('1 tool call');
  });
});
