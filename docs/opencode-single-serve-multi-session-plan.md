# OpenCode Single-Serve Multi-Session Plan

Status: historical / implemented

Historical note:

- This plan has already been implemented in the current runtime.
- Keep this file only as design history; do not treat it as the active execution checklist.

Implementation note:

- the minimal implementation now keeps one shared `opencode serve` per run and one reusable session per role/node within that run
- this differs slightly from the original draft below, which assumed one new session per node execution
- the change was made so looped nodes can preserve session history while still keeping role-level isolation

## 1. Goal

Replace the current runtime strategy:

- current: one node execution starts one `opencode serve`

with the target strategy:

- target: one OGSystem run starts one `opencode serve`
- each node execution uses its own OpenCode `session`
- each node still gets isolated execution context
- structured result still comes from OpenCode normalized output, not raw stdout parsing

This document is a design plan only. It does not include code changes.

## 2. Why Change

The current per-node `serve` strategy is simple, but it has clear cost:

- repeated server cold start
- repeated port allocation and process lifecycle management
- higher latency under parallel nodes
- more startup timeout risk under branch fan-out
- more process noise in audit and OS process table

OpenCode SDK v2 already exposes:

- `session.create`
- `session.prompt`
- `session.abort`
- `session.messages`
- `session.delete`
- request-level `model`
- request-level `variant`
- request-level `directory`
- request-level `workspace`
- request-level `format: { type: "json_schema", schema }`
- response-level `info.structured`

So OGSystem can use one long-lived server per run and isolate node execution through sessions rather than processes.

## 3. Core Design

### 3.1 Runtime Scope

One OGSystem run owns exactly one OpenCode server:

- server lifecycle:
  - start at run begin
  - stay alive for the whole run
  - close at run end or fatal runtime failure

One node execution owns exactly one OpenCode session:

- session lifecycle:
  - create before node execution
  - prompt once for the current node
  - keep session metadata for audit and optional recovery
  - delete or archive later based on policy

### 3.2 Isolation Model

Isolation moves from process-level to session-level plus directory-level.

Recommended minimal isolation:

- one node execution = one session
- one node execution = one role directory
- one node execution = one structured output schema
- one node execution = one selected model/variant

This preserves the current semantic boundary:

- prompt isolation
- output isolation
- audit isolation
- model isolation
- filesystem isolation

without needing one server per node.

## 4. Execution Contract

### 4.1 Input Contract

For each executable node, OGSystem should send:

- `sessionID`
- `directory`
  - default: node role directory
- optional `workspace`
  - only if OGSystem later adopts explicit OpenCode workspace IDs
- `model`
  - `{ providerID, modelID }`
- `variant`
  - derived from model package
- `format`
  - `{ type: "json_schema", schema: role.output.schema.json }`
- `parts`
  - one text prompt built from role prompt template + runtime projection

### 4.2 Output Contract

OGSystem should consume:

- `response.data.info.structured`

and treat it as the authoritative node result.

Expected normalized shape remains:

```json
{
  "event": "EVENT_NAME",
  "content": "text",
  "data": {}
}
```

Rules:

- validate against role output schema
- `event` must match Mermaid outgoing edges when required
- do not parse raw stdout
- do not infer events from free text

### 4.3 Failure Contract

Failure categories should be explicit:

- server startup failure
- session creation failure
- prompt request failure
- structured output error
- schema validation failure
- routing mismatch
- timeout
- abort

Node audit should record which stage failed.

## 5. Lifecycle Design

### 5.1 Run Lifecycle

At run start:

1. start one `opencode serve`
2. create `OpencodeRunContext`
3. persist server metadata into run audit

At run end:

1. optionally archive or delete remaining sessions
2. close the single `serve`
3. flush final audit

### 5.2 Node Lifecycle

For each node execution:

1. resolve role prompt
2. resolve model package
3. create session
4. send structured prompt
5. receive `info.structured`
6. validate output and route
7. persist `sessionID`, `messageID`, prompt, result, audit

Recommended node execution key:

- `roleId@branchId@loopIteration`

This key should map to the created session.

## 6. Session Strategy

### 6.1 Recommended Minimal Strategy

Use:

- one node execution = one session

Reason:

- preserves current semantics
- simplest recovery model
- avoids context leakage across loop iterations
- avoids context leakage across branches
- easy audit mapping

### 6.2 Alternative Strategies

Not recommended for first step, but possible later:

- one role = one session
- one branch = one session
- one run = one session

Tradeoff:

- reuse reduces session creation overhead
- reuse increases context carry-over risk
- reuse complicates recovery and determinism

## 7. Directory and Workspace Design

### 7.1 Minimal Recommendation

Use `directory` only.

For each node:

- `directory = .ogsystems/<run>/roles/<roleId>/`

Benefits:

- matches current on-disk structure
- easy to audit
- no extra OpenCode workspace abstraction required

### 7.2 Shared Data

Keep current OGSystem policy:

- run-level shared directory exists
- role directory is still the node execution directory
- shared material is exposed by OGSystem-level file organization, not by switching the OpenCode root to shared

This keeps role-private files and shared files conceptually separate.

### 7.3 Future Option

If needed later, OGSystem can evaluate explicit OpenCode `workspace` usage for:

- sandbox worktrees
- branch-specific execution sandboxes
- stronger isolation under heavy file mutation

But this should not be required for the first migration.

## 8. Model Isolation

Different nodes can use different models without different servers.

Per prompt request:

- pass `model.providerID`
- pass `model.modelID`
- pass `variant`

This should become the only supported path for `model.bind`.

Implication:

- `serve` is infrastructure
- `session` is execution unit
- `model` is request configuration

These concerns remain cleanly separated.

## 9. Parallel Execution

LangGraph parallel branches should map naturally to:

- concurrent node executions
- concurrent sessions
- same shared `serve`

This is the main operational benefit.

Requirements:

- session map must be thread-safe in runtime terms
- audit writes must remain append-safe
- timeout/abort must target the specific session, not the whole server

## 10. Recovery and Resume

Single-serve multi-session improves recovery options.

Recommended persisted metadata per node:

- `sessionID`
- `messageID`
- `directory`
- `model`
- `variant`
- `status`
- `startedAt`
- `completedAt`

Resume options:

- conservative:
  - treat finished node result files as authoritative
  - do not rehydrate old sessions unless explicitly needed
- future:
  - query session status and messages on resume
  - use session history for richer diagnostics

Minimal recommendation:

- keep filesystem state authoritative
- keep session metadata as audit/debug data

## 11. Audit Design

Run-level audit should record:

- server startup time
- server base URL or opaque server ID
- server close time

Node-level audit should record:

- `sessionID`
- `messageID`
- execution directory
- model and variant
- schema mode used
- request duration
- structured output preview
- tool/reasoning summary if available

Important:

- audit should not depend on stdout text anymore for `model.bind`
- `info.structured` is the authoritative result

## 12. Proposed Runtime Abstractions

### 12.1 `OpencodeRunServer`

Responsibility:

- own one `serve` process for the run
- create client bound to the run server
- close server at run termination

### 12.2 `OpencodeSessionExecutor`

Responsibility:

- create sessions
- submit prompts
- read structured output
- abort or delete sessions

### 12.3 `NodeExecutionRegistry`

Responsibility:

- map node execution key to session metadata
- prevent duplicate execution under resume/retry logic
- expose audit references

## 13. Migration Plan

### Phase 1

- keep current node semantics
- change only server lifecycle
- one run = one server
- one node = one session

### Phase 2

- persist richer session metadata
- support targeted abort and better resume diagnostics

### Phase 3

- evaluate session reuse only if there is a measured performance need

## 14. Non-Goals

This plan does not require:

- one session reused across all nodes
- OpenCode workspace adoption in the first step
- changing Mermaid semantics
- changing role repo format
- changing model repo format
- changing output contract shape

## 15. Key Risks

### 15.1 Session Isolation Misunderstanding

Risk:

- assuming different sessions automatically isolate filesystem state

Mitigation:

- always pass explicit `directory` per node

### 15.2 Long-Lived Server Failure

Risk:

- one server crash affects the whole run

Mitigation:

- explicit run-level health checks
- fail fast with clear audit
- optional one-time server restart policy in future, not in minimal version

### 15.3 Session Accumulation

Risk:

- too many sessions retained for long runs

Mitigation:

- define retention policy
- default: keep metadata, optionally delete session after node completion

### 15.4 Concurrency Pressure

Risk:

- many parallel prompts compete on one server

Mitigation:

- start with current graph scale
- measure before adding queueing or throttling

## 16. Recommendation

Adopt this as the target runtime strategy:

- one OGSystem run starts one `opencode serve`
- each node execution creates its own OpenCode session
- each node prompt passes its own `directory`, `model`, `variant`, and `json_schema`
- OGSystem reads `info.structured` as the authoritative node result
- filesystem state remains the primary recovery source
- session metadata is persisted for audit and optional future resume features

This is the smallest change that:

- removes repeated server startup
- preserves node isolation
- supports different models per node
- supports parallel nodes
- keeps the structured execution contract explicit and stable

## 17. Suggested Task Checklist

- [x] define run-level server manager
- [x] define node execution to session mapping
- [x] define session metadata persistence fields
- [x] define server shutdown policy
- [x] define session retention policy
- [x] switch `model.bind` execution from per-node serve to run-level serve
- [x] keep one node = one session
- [x] validate parallel branch behavior
- [x] validate mixed-model behavior
- [x] validate timeout and abort semantics
- [x] update runtime and usage docs
