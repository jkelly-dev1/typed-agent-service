# typed-agent-service

[![CI](https://github.com/jkelly-dev1/typed-agent-service/actions/workflows/ci.yml/badge.svg)](https://github.com/jkelly-dev1/typed-agent-service/actions/workflows/ci.yml)

A TypeScript AI agent service built as a personal learning project: Fastify 5,
Zod 4 tool schemas, a provider-agnostic tool-use loop, SSE streaming, a typed
error boundary, and two small front ends -- React and Angular -- that render the
same stream. It runs fully
offline on a deterministic mock provider by default and switches to a real
model (Anthropic or OpenAI) with two environment variables.

The rule this repo follows: no claim without a test. The table below maps each
claim in this README to the test that enforces it.

## What it demonstrates

- Zod schemas as the single source of truth for tools: one schema validates
  every model-supplied tool call at runtime, infers the executor's input type
  at compile time, and generates the JSON Schema the model sees.
- A bounded agent loop: tool requests are validated, executed, and fed back;
  a hard iteration cap stops a model that never finishes.
- Streaming SSE and buffered JSON endpoints over the same typed event
  contract, with client-disconnect and timeout cancellation.
- An RFC 9457 problem+json error boundary with stable machine-readable codes
  that never leaks internals.
- A provider seam (mock / Anthropic / OpenAI) where tests and CI never touch
  the network.
- A React client that consumes the same typed event contract, including its own
  SSE framing because `EventSource` cannot POST, and the two different ways
  this API reports failure.
- An Angular client over the SAME endpoints and the same contract, written
  standalone, signal-based and zoneless, so the contract is proven to be a
  contract rather than a shape one framework happened to fit.

## Claims backed by tests

| Claim | Test |
| --- | --- |
| Schema-invalid tool calls never reach an executor | `tests/tools.test.ts` "rejects schema-invalid input" |
| Unknown tools are refused as data, not crashes | `tests/tools.test.ts` "rejects unknown tools" |
| Tool executor failures are captured, the loop survives | `tests/tools.test.ts`, `tests/agent-loop.test.ts` |
| The calculator cannot execute arbitrary code | `tests/tools.test.ts` "rejects malformed input" |
| The iteration cap terminates a model that never stops | `tests/agent-loop.test.ts` "enforces the iteration cap" (mutation-checked: remove the cap and the test fails) |
| A bad tool call becomes an error result the model sees | `tests/agent-loop.test.ts` "feeds schema-invalid tool input back" |
| SSE frames reassemble losslessly into the final answer | `tests/sse.test.ts` "streams the run as typed event frames" |
| Invalid bodies get a real 400 before the stream starts | `tests/sse.test.ts` "rejects invalid bodies BEFORE the stream starts" |
| In-flight stream failures arrive as an error frame | `tests/sse.test.ts` "delivers in-flight failures" |
| Validation errors return problem+json with field issues | `tests/routes.test.ts` "rejects an invalid body" |
| Unexpected errors never leak internals | `tests/routes.test.ts` "never leaks internals" |
| Runs complete over a real socket, not just inject | `tests/real-http.test.ts` (regression: a request-close listener aborted every real-HTTP run while inject tests passed) |
| Provider selection needs BOTH name and credential; keys never cross-match | `tests/providers.test.ts` "provider resolution" |
| The conversation model maps correctly to OpenAI roles | `tests/providers.test.ts` "OpenAI wire conversion" |
| Malformed streamed tool arguments hit the Zod boundary, not JSON.parse crashes | `tests/providers.test.ts` "passes malformed tool arguments through" |
| SSE frames split across network reads are reassembled, not dropped | `web/tests/sse.test.ts` "holds a frame split across two chunks until the rest arrives" (mutation-checked: stop retaining the buffer and it fails) |
| An event type the client does not know is ignored, not thrown | `web/tests/sse.test.ts` "ignores an event type it does not know instead of throwing" |
| Streamed tokens are joined into one answer | `web/tests/App.test.tsx` "joins streamed tokens into one answer" |
| Every tool call is shown with the input it was given | `web/tests/App.test.tsx` "shows each tool call with the input it was given" |
| A failed tool result is marked failed, not hidden | `web/tests/App.test.tsx` "marks a failed tool result as failed rather than hiding it" (mutation-checked: render every result as ok and it fails) |
| An in-flight failure arriving as an error FRAME is surfaced | `web/tests/App.test.tsx` "renders an in-flight failure that arrived as an error FRAME" |
| A request rejected before the stream starts is surfaced as a status | `web/tests/App.test.tsx` "reports a rejected request, which arrives as a real status and not a frame" |
| The Angular client reassembles frames split across reads | `web-ng/src/lib/sse.spec.ts` "holds a frame split across two chunks until the rest arrives" (mutation-checked: stop retaining the buffer and it fails) |
| The Angular client ignores an event type it does not know | `web-ng/src/lib/sse.spec.ts` "ignores an event type it does not know instead of throwing" (mutation-checked: drop the known-type filter and it fails) |
| The Angular client joins streamed tokens into one answer | `web-ng/src/app/app.spec.ts` "joins streamed tokens into one answer" (mutation-checked: overwrite instead of accumulate and it fails) |
| The Angular client shows each tool call with its input | `web-ng/src/app/app.spec.ts` "shows each tool call with the input it was given" (mutation-checked: stop rendering the input and it fails) |
| The Angular client marks a failed tool result as failed | `web-ng/src/app/app.spec.ts` "marks a failed tool result as failed rather than hiding it" (mutation-checked: render every result as ok and it fails) |
| The Angular client surfaces an in-flight error FRAME | `web-ng/src/app/app.spec.ts` "renders an in-flight failure that arrived as an error FRAME" |
| The Angular client surfaces a pre-stream rejection as a status | `web-ng/src/app/app.spec.ts` "reports a rejected request, which arrives as a real status and not a frame" (mutation-checked: skip the not-ok branch and it fails) |

## The web clients

TWO FRONT ENDS OVER ONE BACKEND, on purpose. Both are a single page, both
speak the same typed event contract, and neither adds a router, a state
library or a component library.

### React, in `web/`

A single page in `web/`, React and TypeScript, no router and no state library.
It exists to make the event contract visible: tokens stream into the answer,
and every tool call is listed with the input it was validated against and the
result it returned, because "which tools ran and what came back" is the
question this service exists to answer and a chat bubble hides it.

```
npm run web        # vite dev server on :5173, proxying /v1 to :3000
npm run start      # the service itself on :3000, in another terminal
```

TWO THINGS IN IT ARE WORTH READING. `web/src/lib/sse.ts` does its own SSE
framing, because `EventSource` only issues GET requests and this endpoint is a
POST; a network read splits frames wherever it likes and the parser has to
hold a partial one until the rest arrives. And the client handles the API's
deliberate asymmetry: a bad request is refused with a real 400 and
problem+json before the stream starts, while a failure after the first frame
can only arrive as an `error` event. Those do not look alike and both are
tested.

### Angular, in `web-ng/`

The same page, standalone components, signals, and Angular 21's zoneless
change detection. `zone.js` is not installed at all: every piece of state is a
signal, so the view updates because a signal changed rather than because
something patched `setTimeout`. That matters for a token stream, which arrives
inside an async read loop.

```
cd web-ng && npm ci
npm start          # ng serve on :4200, proxying /v1 to :3000
npm test           # 13 tests
```

Open **http://localhost:4200** and not `http://127.0.0.1:4200`. The dev server
binds IPv6 loopback only, so the dotted-quad address is refused. The React
client's dev server does the same thing on :5173.

IT IS A SEPARATE NPM PACKAGE, WITH ITS OWN LOCKFILE, AND IT HAD TO BE. Three
version pairs disagree and none of them can be talked out of it: Angular 21
pins TypeScript 5.9 while the service is on 7, it pins Vite 7 while the React
client is on 8, and it pins jsdom 28 while the root's vitest resolves jsdom 30.
That last one is not cosmetic -- jsdom 30 pulls a version of undici that will
not load on this machine's Node, which is why the React client tests run on
happy-dom. Angular's own pin runs fine. Two lockfiles cost one extra `npm ci`
in CI and settle all three.

THE SSE PARSER IS DELIBERATELY WRITTEN TWICE rather than shared. What the two
clients are meant to have in common is the EVENT CONTRACT, not a module, and
parsing it independently in each is what makes the second client evidence of
anything. Both parsers are tested and both were mutation-checked.

`npm run typecheck` HERE RUNS `ngc`, NOT `tsc`, and the difference is not
pedantic. Plain `tsc` typechecks the TypeScript and never opens a template, so
it exits 0 on a component bound to entirely the wrong type. That was verified
by binding an `AgentEvent[]` to a `string` input on purpose: `tsc --noEmit`
passed, `ngc` failed with TS2322, and the production build failed too. It is
the same shape as a root tsconfig that does not include `web/`, which leaves
the React client untypechecked entirely while every check still passes.

## Quickstart

Requires Node 20.12 or newer. CI runs on the maintained LTS lines, 22 and 24.

```
npm ci
npm test          # 47 tests, fully offline (34 service, 13 React client)
npm run demo      # end-to-end over real HTTP with the mock provider
npm run dev       # start on http://127.0.0.1:3000
```

Try it:

```
curl -s localhost:3000/healthz
curl -s -X POST localhost:3000/v1/chat \
  -H 'content-type: application/json' \
  -d '{"message": "calc: (2 + 3) * 4 ^ 2"}'
curl -N -X POST localhost:3000/v1/chat/stream \
  -H 'content-type: application/json' \
  -d '{"message": "define: audit trail"}'
```

`SAMPLE_RUN.md` holds a verbatim capture of the demo output.

## API

- `POST /v1/chat` runs the agent and returns the whole run as JSON: answer,
  iteration count, and every tool call with its validated input and result.
- `POST /v1/chat/stream` returns `text/event-stream`. Frames are typed agent
  events: `token`, `tool_call`, `tool_result`, then exactly one terminal
  `done` or `error` frame. One asymmetry is deliberate: after the stream
  starts the HTTP status is already sent, so in-flight failures arrive as an
  `error` frame, while invalid request bodies are rejected with a real 400
  before any frame is written.
- `GET /healthz` reports the active provider and registered tools.
- Every error response is `application/problem+json` with a stable `code` and
  the request id for correlation with the structured logs.

## Real models

The service switches from the offline mock to a real model when `AGENT_PROVIDER`
is set to `anthropic` or `openai` and the matching API key is present in the
environment:

```
AGENT_PROVIDER=anthropic npm run demo
AGENT_PROVIDER=openai    npm run demo
```

Provider selection requires both the provider name and its credential; anything
else falls back to the offline mock, so the service always starts and tests
never depend on the network. Both provider SDKs are imported lazily and are not
loaded at all in mock mode. Credentials come from the environment, a gitignored
`.env`, or an `ENV_FILE` pointing at a file of variables; real environment
variables always win over file values, which is what makes the per-run
`AGENT_PROVIDER=` switch work.

## Design notes

- The mock provider scripts realistic behavior (tool calls, multi-turn
  results, a run that never terminates, a schema-invalid call) so the loop's
  guardrails are exercised deterministically. The non-terminating script
  exists purely to prove the iteration cap works.
- Tool inputs cross two boundaries and are validated at both: the HTTP body by
  the route schema, the model's tool arguments by the tool schema.
- Cancellation is one `AbortSignal` combining client disconnect and a server
  timeout; disconnect is detected on the response side (`close` before the
  response finished writing), which the regression test in
  `tests/real-http.test.ts` exists to protect.

## Scope

This is a learning project, deliberately small. It has no persistence, no
authentication, no rate limiting, and one worked toolset; those are seams, not
oversights. The design mirrors the discipline of my other portfolio repos
([prompt-injection-benchmark](https://github.com/jkelly-dev1/prompt-injection-benchmark),
[ai-data-boundary-proxy](https://github.com/jkelly-dev1/ai-data-boundary-proxy),
[llm-eval-gate](https://github.com/jkelly-dev1/llm-eval-gate),
[least-privilege-agent](https://github.com/jkelly-dev1/least-privilege-agent),
[citation-abstention-rag](https://github.com/jkelly-dev1/citation-abstention-rag),
[temporal-multi-agent](https://github.com/jkelly-dev1/temporal-multi-agent),
[agentic-review-gate](https://github.com/jkelly-dev1/agentic-review-gate),
[federated-retrieval-router](https://github.com/jkelly-dev1/federated-retrieval-router),
[hardened-mcp-server](https://github.com/jkelly-dev1/hardened-mcp-server),
[vlm-extraction-integrity](https://github.com/jkelly-dev1/vlm-extraction-integrity),
[llm-observability-stack](https://github.com/jkelly-dev1/llm-observability-stack),
[ai-compliance-checker](https://github.com/jkelly-dev1/ai-compliance-checker),
[airgapped-ai-bundle](https://github.com/jkelly-dev1/airgapped-ai-bundle),
[agent-sandbox-escape](https://github.com/jkelly-dev1/agent-sandbox-escape),
[parser-eval](https://github.com/jkelly-dev1/parser-eval)):
claims backed by tests, mutation checks on the tests that matter, and behavior
verified over real transports before publishing.

## License

MIT
