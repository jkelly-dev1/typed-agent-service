import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ChatService } from '../lib/chat';
import { isTerminal, type AgentEvent } from '../lib/sse';
import { EventStreamComponent } from './event-stream';

/**
 * One page: ask, watch the run, stop it. No router, no state library, no
 * component library. The service is the subject; this exists to make its
 * event contract visible.
 *
 * ZONELESS. Angular 21 runs without zone.js by default and every piece of
 * state here is a signal, so the view updates because a signal changed and
 * not because something patched setTimeout. That matters for a token stream:
 * tokens arrive inside an async read loop, which is exactly the place
 * zone-based change detection used to need coaxing.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EventStreamComponent],
  template: `
    <main>
      <h1>typed-agent-service</h1>
      <p class="sub">
        A bounded agent loop over typed tools. Every tool call is validated against its
        schema before it runs, and the run is streamed as typed events.
      </p>

      <form (submit)="send($event)">
        <label for="message">Message</label>
        <textarea
          id="message"
          rows="3"
          [value]="message()"
          [disabled]="running()"
          (input)="message.set($any($event.target).value)"
        ></textarea>
        <div class="actions">
          <button type="submit" [disabled]="running() || !message().trim()">
            {{ running() ? 'Running' : 'Send' }}
          </button>
          <button type="button" (click)="stop()" [disabled]="!running()">Stop</button>
          @if (finished() && !running()) {
            <span class="hint">run complete</span>
          }
        </div>
      </form>

      <app-event-stream [events]="events()" [answer]="answer()" />
    </main>
  `,
})
export class App {
  private readonly chat = inject(ChatService);

  protected readonly message = signal('calc: (2 + 3) * 4 ^ 2');
  protected readonly events = signal<AgentEvent[]>([]);
  protected readonly answer = signal('');
  protected readonly running = signal(false);
  protected readonly finished = computed(() => this.events().some(isTerminal));

  private abort: AbortController | null = null;

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    if (this.running() || !this.message().trim()) return;
    this.events.set([]);
    this.answer.set('');
    this.running.set(true);
    const controller = new AbortController();
    this.abort = controller;
    try {
      await this.chat.run({
        message: this.message(),
        signal: controller.signal,
        onEvent: (e) => {
          // Tokens accumulate into the answer; everything else is a row.
          if (e.type === 'token') this.answer.update((a) => a + e.text);
          else this.events.update((list) => [...list, e]);
        },
      });
    } catch (err) {
      // An aborted run is a user action, not a failure to report as one.
      if (!controller.signal.aborted) {
        const detail = err instanceof Error ? err.message : String(err);
        this.events.update((list) => [
          ...list,
          { type: 'error', code: 'network', message: detail },
        ]);
      }
    } finally {
      this.running.set(false);
      this.abort = null;
    }
  }

  protected stop(): void {
    this.abort?.abort();
  }
}
