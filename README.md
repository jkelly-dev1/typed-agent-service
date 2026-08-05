# typed-agent-service

[![CI](https://github.com/jkelly-dev1/typed-agent-service/actions/workflows/ci.yml/badge.svg)](https://github.com/jkelly-dev1/typed-agent-service/actions/workflows/ci.yml)

A TypeScript AI agent service built as a personal learning project: Fastify 5,
Zod 4 tool schemas, a provider-agnostic tool-use loop, SSE streaming, and a
typed error boundary. It runs fully offline on a deterministic mock provider by
default and switches to a real model (Anthropic or OpenAI) with two environment
variables.

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

## Quickstart

Requires Node 20.12 or newer. CI runs on the maintained LTS lines, 22 and 24.

```
npm ci
npm test          # 34 tests, fully offline
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
[federated-retrieval-router](https://github.com/jkelly-dev1/federated-retrieval-router)):
claims backed by tests, mutation checks on the tests that matter, and behavior
verified over real transports before publishing.

## License

MIT
