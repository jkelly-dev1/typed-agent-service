import type { Provider, ProviderEvent, ProviderRequest } from './types.js';

/**
 * Deterministic offline provider. It scripts realistic behavior from the text
 * of the conversation so the full agent loop, both endpoints, and every test
 * run with zero network access and byte-identical output:
 *
 *   "calc: <expr>"          -> one calculator tool call, then a text answer
 *   "convert <v> <a> to <b>"-> one unit_convert call, then a text answer
 *   "define: <term>"        -> one glossary_lookup call, then a text answer
 *   "loop forever"          -> requests a tool on EVERY turn (never finishes;
 *                              exists to prove the iteration cap works)
 *   "bad tool call"         -> calls calculator with schema-invalid input
 *                              (exists to prove Zod validation rejects it)
 *   anything else           -> a plain streamed text answer, no tools
 */
export class MockProvider implements Provider {
  readonly name = 'mock';

  // eslint-disable-next-line require-yield
  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent, void, void> {
    if (signal.aborted) throw new Error('aborted');

    const firstUser = request.messages[0];
    const firstText =
      firstUser?.blocks.find((b) => b.kind === 'text')?.kind === 'text'
        ? (firstUser.blocks.find((b) => b.kind === 'text') as { kind: 'text'; text: string }).text
        : '';
    const lastMessage = request.messages[request.messages.length - 1];
    const hasToolResults = lastMessage?.blocks.some((b) => b.kind === 'tool_result') ?? false;

    if (/loop forever/i.test(firstText)) {
      yield { type: 'tool_use', id: `loop-${request.messages.length}`, name: 'calculator', input: { expression: '1 + 1' } };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }

    if (hasToolResults) {
      // Second turn: summarize the tool results as the final answer.
      const results = (lastMessage as NonNullable<typeof lastMessage>).blocks
        .filter((b): b is Extract<typeof b, { kind: 'tool_result' }> => b.kind === 'tool_result')
        .map((b) => b.content);
      const failed = (lastMessage as NonNullable<typeof lastMessage>).blocks.some(
        (b) => b.kind === 'tool_result' && b.isError,
      );
      const text = failed
        ? `I could not complete that: ${results.join('; ')}`
        : `Based on the tool result: ${results.join('; ')}`;
      yield* this.emitText(text);
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    const calc = /calc:\s*(.+)$/i.exec(firstText);
    if (calc) {
      yield { type: 'tool_use', id: 'mock-calc-1', name: 'calculator', input: { expression: (calc[1] as string).trim() } };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }

    const conv = /convert\s+(-?[\d.]+)\s*(\w+)\s+to\s+(\w+)/i.exec(firstText);
    if (conv) {
      yield {
        type: 'tool_use',
        id: 'mock-conv-1',
        name: 'unit_convert',
        input: { value: Number(conv[1]), from: (conv[2] as string).toLowerCase(), to: (conv[3] as string).toLowerCase() },
      };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }

    const define = /define:\s*(.+)$/i.exec(firstText);
    if (define) {
      yield { type: 'tool_use', id: 'mock-gloss-1', name: 'glossary_lookup', input: { term: (define[1] as string).trim() } };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }

    if (/bad tool call/i.test(firstText)) {
      // Schema-invalid on purpose: `expression` must be a string.
      yield { type: 'tool_use', id: 'mock-bad-1', name: 'calculator', input: { expression: 42 } };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }

    yield* this.emitText(
      'This is the deterministic mock provider. Try "calc: (2+3)*4", "convert 10 km to mi", or "define: audit trail". Set AGENT_PROVIDER=anthropic with an API key for a real model.',
    );
    yield { type: 'stop', reason: 'end_turn' };
  }

  /** Stream text in fixed-size chunks so SSE behavior is exercised for real. */
  private *emitText(text: string): Generator<ProviderEvent, void, void> {
    const chunkSize = 24;
    for (let i = 0; i < text.length; i += chunkSize) {
      yield { type: 'text', text: text.slice(i, i + chunkSize) };
    }
  }
}
