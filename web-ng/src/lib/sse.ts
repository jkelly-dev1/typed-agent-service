/**
 * Parsing the server's SSE frames, and the reason this is its own module.
 *
 * The service writes `event: <type>\n` then `data: <json>\n\n` for every
 * agent event. A network read does NOT respect those boundaries: one chunk
 * can carry two and a half frames, and the half has to survive until the rest
 * of it arrives. Getting that wrong produces a UI that works on a fast local
 * connection and drops events on a slow one, which is the worst kind of bug
 * to find later.
 *
 * EventSource would handle this, and it cannot be used here: it only issues
 * GET requests and this endpoint is a POST. So the framing is ours to do.
 *
 * THIS FILE IS DELIBERATELY A SECOND IMPLEMENTATION rather than an import
 * from the React client. The two clients are separate npm packages on
 * separate TypeScript and Vite versions, and the thing they are meant to
 * share is THE EVENT CONTRACT, not a module. Parsing the contract twice and
 * testing it twice is the point: if the server changed a frame shape and only
 * one client noticed, that is worth knowing.
 */

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'done'; answer: string; iterations: number; toolCalls: number }
  | { type: 'error'; code: string; message: string };

const KNOWN = new Set(['token', 'tool_call', 'tool_result', 'done', 'error']);

/** True for the two frames that end a run. Nothing follows either one. */
export function isTerminal(event: AgentEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}

function parseFrame(raw: string): AgentEvent | null {
  // The `event:` line is redundant with data.type and is deliberately not
  // trusted: if the two ever disagree, the payload is the one carrying the
  // fields the UI reads.
  const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLine.slice(5).trim());
  } catch {
    return null; // A frame we cannot read is dropped, not thrown.
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  // An unknown event type is IGNORED rather than rendered or thrown. The
  // server may add one before this client is redeployed.
  if (typeof type !== 'string' || !KNOWN.has(type)) return null;
  return parsed as AgentEvent;
}

/**
 * A stateful parser. Feed it chunks in order; it returns whole events only,
 * and holds any partial frame until the rest of it arrives.
 */
export function createSseParser(): (chunk: string) => AgentEvent[] {
  let buffer = '';
  return function push(chunk: string): AgentEvent[] {
    buffer += chunk;
    const events: AgentEvent[] = [];
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = parseFrame(frame);
      if (event) events.push(event);
      sep = buffer.indexOf('\n\n');
    }
    return events;
  };
}
