import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { AgentEvent } from '../lib/sse';

type ToolCall = Extract<AgentEvent, { type: 'tool_call' }>;
type ToolResult = Extract<AgentEvent, { type: 'tool_result' }>;
type Failure = Extract<AgentEvent, { type: 'error' }>;
type Done = Extract<AgentEvent, { type: 'done' }>;

/**
 * The run, as it happens. Tokens are joined into one answer paragraph; every
 * tool call is shown with the input it was given and the result it returned,
 * because "which tools did it call and what came back" is the question this
 * service exists to answer and a chat bubble hides it.
 *
 * The discriminated union is narrowed in COMPUTED SIGNALS rather than in the
 * template. A template can test `event.type` but it cannot carry the narrowing
 * into a nested expression under strictTemplates, so the narrowing is done
 * once here in TypeScript where the compiler checks it.
 */
@Component({
  selector: 'app-event-stream',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Run">
      @if (answer()) {
        <p class="answer" data-testid="answer">{{ answer() }}</p>
      }

      <ol class="tools">
        @for (row of rows(); track $index) {
          @if (row.type === 'tool_call') {
            <li class="tool-call" data-testid="tool-call">
              <span class="tool-name">{{ row.name }}</span>
              <code>{{ inputJson(row) }}</code>
            </li>
          } @else {
            <li
              class="tool-result"
              [class.ok]="row.ok"
              [class.failed]="!row.ok"
              data-testid="tool-result"
            >
              <span class="tool-name">{{ row.name }}</span>
              <span class="badge">{{ row.ok ? 'ok' : 'failed' }}</span>
              <code>{{ row.content }}</code>
            </li>
          }
        }
      </ol>

      @if (failure(); as fail) {
        <p class="error" role="alert" data-testid="error">
          <strong>{{ fail.code }}</strong> {{ fail.message }}
        </p>
      }

      @if (finished(); as done) {
        <p class="done" data-testid="done">
          {{ done.iterations }} iteration{{ done.iterations === 1 ? '' : 's' }},
          {{ done.toolCalls }} tool call{{ done.toolCalls === 1 ? '' : 's' }}
        </p>
      }
    </section>
  `,
})
export class EventStreamComponent {
  readonly events = input.required<AgentEvent[]>();
  readonly answer = input.required<string>();

  protected readonly rows = computed<Array<ToolCall | ToolResult>>(() =>
    this.events().filter(
      (e): e is ToolCall | ToolResult => e.type === 'tool_call' || e.type === 'tool_result',
    ),
  );

  protected readonly failure = computed<Failure | undefined>(
    () => this.events().find((e): e is Failure => e.type === 'error'),
  );

  protected readonly finished = computed<Done | undefined>(
    () => this.events().find((e): e is Done => e.type === 'done'),
  );

  protected inputJson(row: ToolCall): string {
    return JSON.stringify(row.input);
  }
}
