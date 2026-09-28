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
 *
 * Like a real model, it can only call a tool it was offered in the request.
 * A script that needs one it was not given says so in text instead, so a
 * loop that stops sending its tools stops getting tool calls back.
 */
export class MockProvider implements Provider {
  readonly name = 'mock';

  /** The most recent request, so a test can assert what the loop handed over. */
  lastRequest: ProviderRequest | undefined;

  // eslint-disable-next-line require-yield
  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent, void, void> {
    if (signal.aborted) throw new Error('aborted');
    this.lastRequest = request;
    const offered = new Set(request.tools.map((t) => t.name));

    const firstUser = request.messages[0];
    const firstText =
      firstUser?.blocks.find((b) => b.kind === 'text')?.kind === 'text'
        ? (firstUser.blocks.find((b) => b.kind === 'text') as { kind: 'text'; text: string }).text
        : '';
    const lastMessage = request.messages[request.messages.length - 1];
    const hasToolResults = lastMessage?.blocks.some((b) => b.kind === 'tool_result') ?? false;

    if (/loop forever/i.test(firstText)) {
      yield* this.callTool(offered, `loop-${request.messages.length}`, 'calculator', { expression: '1 + 1' });
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
      yield* this.callTool(offered, 'mock-calc-1', 'calculator', { expression: (calc[1] as string).trim() });
      return;
    }

    const conv = /convert\s+(-?[\d.]+)\s*(\w+)\s+to\s+(\w+)/i.exec(firstText);
    if (conv) {
      yield* this.callTool(offered, 'mock-conv-1', 'unit_convert', {
        value: Number(conv[1]),
        from: (conv[2] as string).toLowerCase(),
        to: (conv[3] as string).toLowerCase(),
      });
      return;
    }

    const define = /define:\s*(.+)$/i.exec(firstText);
    if (define) {
      yield* this.callTool(offered, 'mock-gloss-1', 'glossary_lookup', { term: (define[1] as string).trim() });
      return;
    }

    if (/bad tool call/i.test(firstText)) {
      // Schema-invalid by construction: `expression` must be a string.
      yield* this.callTool(offered, 'mock-bad-1', 'calculator', { expression: 42 });
      return;
    }

    yield* this.emitText(
      'This is the deterministic mock provider. Try "calc: (2+3)*4", "convert 10 km to mi", or "define: audit trail". Set AGENT_PROVIDER=anthropic with an API key for a real model.',
    );
    yield { type: 'stop', reason: 'end_turn' };
  }

  /** A tool call if the tool was offered; otherwise a text turn saying it was not. */
  private *callTool(
    offered: ReadonlySet<string>,
    id: string,
    name: string,
    input: unknown,
  ): Generator<ProviderEvent, void, void> {
    if (offered.has(name)) {
      yield { type: 'tool_use', id, name, input };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }
    yield* this.emitText(`I was not given a ${name} tool, so I cannot do that.`);
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
