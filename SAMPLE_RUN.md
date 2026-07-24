# Sample runs

Captured verbatim from `npm run demo`. Three provider configurations, all
exercising the same flow: health check, two SSE streams, a buffered JSON
request, and the RFC 9457 validation boundary. Only the offline mock is
deterministic; the two real-model answers vary run to run.

## Mock provider (offline)

No provider configured: the deterministic offline mock.

```

=== Health ===
{"status":"ok","provider":"mock","tools":["calculator","unit_convert","glossary_lookup"],"uptimeSeconds":0}

=== SSE stream: "calc: (2 + 3) * 4 ^ 2" ===

[tool_call] {"type":"tool_call","name":"calculator","input":{"expression":"(2 + 3) * 4 ^ 2"}}

[tool_result] {"type":"tool_result","name":"calculator","ok":true,"content":"(2 + 3) * 4 ^ 2 = 80"}
Based on the tool result: (2 + 3) * 4 ^ 2 = 80
[done] {"type":"done","answer":"Based on the tool result: (2 + 3) * 4 ^ 2 = 80","iterations":2,"toolCalls":1}


=== SSE stream: "define: audit trail" ===

[tool_call] {"type":"tool_call","name":"glossary_lookup","input":{"term":"audit trail"}}

[tool_result] {"type":"tool_result","name":"glossary_lookup","ok":true,"content":"audit trail: An append-only record of what a system did and why, sufficient to reconstruct a decision after the fact. Tamper-evidence (e.g. hash chaining) strengthens it."}
Based on the tool result: audit trail: An append-only record of what a system did and why, sufficient to reconstruct a decision after the fact. Tamper-evidence (e.g. hash chaining) strengthens it.
[done] {"type":"done","answer":"Based on the tool result: audit trail: An append-only record of what a system did and why, sufficient to reconstruct a decision after the fact. Tamper-evidence (e.g. hash chaining) strengthens it.","iterations":2,"toolCalls":1}


=== Buffered JSON: "convert 10 km to mi" ===
HTTP 200
{
  "provider": "mock",
  "answer": "Based on the tool result: 10 km = 6.213712 mi",
  "iterations": 2,
  "toolCalls": [
    {
      "name": "unit_convert",
      "input": {
        "value": 10,
        "from": "km",
        "to": "mi"
      },
      "ok": true,
      "content": "10 km = 6.213712 mi"
    }
  ]
}

=== Validation boundary: empty message ===
HTTP 400 (application/problem+json; charset=utf-8)
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed",
  "code": "validation_failed",
  "requestId": "21c9bf50-521e-41c2-b15a-dda16d0d8990",
  "issues": [
    {
      "path": "message",
      "message": "Too small: expected string to have >=1 characters"
    }
  ]
}
```

## Anthropic provider (real model)

`AGENT_PROVIDER=anthropic npm run demo` (model `claude-sonnet-5`).

```

=== Health ===
{"status":"ok","provider":"anthropic","tools":["calculator","unit_convert","glossary_lookup"],"uptimeSeconds":0}

=== SSE stream: "calc: (2 + 3) * 4 ^ 2" ===

[tool_call] {"type":"tool_call","name":"calculator","input":{"expression":"(2 + 3) * 4 ^ 2"}}

[tool_result] {"type":"tool_result","name":"calculator","ok":true,"content":"(2 + 3) * 4 ^ 2 = 80"}
The result of (2 + 3) * 4 ^ 2 is 80.
[done] {"type":"done","answer":"The result of (2 + 3) * 4 ^ 2 is 80.","iterations":2,"toolCalls":1}


=== SSE stream: "define: audit trail" ===

[tool_call] {"type":"tool_call","name":"glossary_lookup","input":{"term":"audit trail"}}

[tool_result] {"type":"tool_result","name":"glossary_lookup","ok":true,"content":"audit trail: An append-only record of what a system did and why, sufficient to reconstruct a decision after the fact. Tamper-evidence (e.g. hash chaining) strengthens it."}
Audit trail: An append-only record of what a system did and why, sufficient to reconstruct a decision after the fact. Tamper-evidence (e.g. hash chaining) strengthens it.
[done] {"type":"done","answer":"Audit trail: An append-only record of what a system did and why, sufficient to reconstruct a decision after the fact. Tamper-evidence (e.g. hash chaining) strengthens it.","iterations":2,"toolCalls":1}


=== Buffered JSON: "convert 10 km to mi" ===
HTTP 200
{
  "provider": "anthropic",
  "answer": "10 km is equal to approximately 6.213712 miles.",
  "iterations": 2,
  "toolCalls": [
    {
      "name": "unit_convert",
      "input": {
        "value": 10,
        "from": "km",
        "to": "mi"
      },
      "ok": true,
      "content": "10 km = 6.213712 mi"
    }
  ]
}

=== Validation boundary: empty message ===
HTTP 400 (application/problem+json; charset=utf-8)
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed",
  "code": "validation_failed",
  "requestId": "237dc545-6be4-4bce-8ee9-f50f77b128c6",
  "issues": [
    {
      "path": "message",
      "message": "Too small: expected string to have >=1 characters"
    }
  ]
}
```

## OpenAI provider (real model)

`AGENT_PROVIDER=openai npm run demo` (model `gpt-4o`).

```

=== Health ===
{"status":"ok","provider":"openai","tools":["calculator","unit_convert","glossary_lookup"],"uptimeSeconds":0}

=== SSE stream: "calc: (2 + 3) * 4 ^ 2" ===

[tool_call] {"type":"tool_call","name":"calculator","input":{"expression":"(2 + 3) * 4 ^ 2"}}

[tool_result] {"type":"tool_result","name":"calculator","ok":true,"content":"(2 + 3) * 4 ^ 2 = 80"}
The result of the expression \( (2 + 3) \times 4^2 \) is 80.
[done] {"type":"done","answer":"The result of the expression \\( (2 + 3) \\times 4^2 \\) is 80.","iterations":2,"toolCalls":1}


=== SSE stream: "define: audit trail" ===

[tool_call] {"type":"tool_call","name":"glossary_lookup","input":{"term":"audit trail"}}

[tool_result] {"type":"tool_result","name":"glossary_lookup","ok":true,"content":"audit trail: An append-only record of what a system did and why, sufficient to reconstruct a decision after the fact. Tamper-evidence (e.g. hash chaining) strengthens it."}
An audit trail is an append-only record of what a system did and why, providing enough information to reconstruct a decision after the fact. Tamper-evidence, such as hash chaining, can strengthen it.
[done] {"type":"done","answer":"An audit trail is an append-only record of what a system did and why, providing enough information to reconstruct a decision after the fact. Tamper-evidence, such as hash chaining, can strengthen it.","iterations":2,"toolCalls":1}


=== Buffered JSON: "convert 10 km to mi" ===
HTTP 200
{
  "provider": "openai",
  "answer": "10 kilometers is equal to 6.213712 miles.",
  "iterations": 2,
  "toolCalls": [
    {
      "name": "unit_convert",
      "input": {
        "value": 10,
        "from": "km",
        "to": "mi"
      },
      "ok": true,
      "content": "10 km = 6.213712 mi"
    }
  ]
}

=== Validation boundary: empty message ===
HTTP 400 (application/problem+json; charset=utf-8)
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed",
  "code": "validation_failed",
  "requestId": "ba3e80ea-005c-4e09-bd8d-e1325f7dd4e2",
  "issues": [
    {
      "path": "message",
      "message": "Too small: expected string to have >=1 characters"
    }
  ]
}
```
