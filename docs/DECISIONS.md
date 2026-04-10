# OGSystem Decisions

Date: 2026-04-10  
Status: active

## 1. One Runtime

OGSystem uses one active runtime path: the graph runtime.

- `model.bind` is the default execution binding surface
- `exec.bind` remains supported as a compatibility execution mode
- `exec.bind` does not imply a separate engine or a fallback FSM

Reason:

- the repository already needs one orchestration model for sequential, branch, join, and loop systems
- keeping parallel runtime implementations created drift in code, tests, and docs
- one persisted state model is required for trustworthy resume and audit behavior

## 2. Backend Boundary

LangGraph is the current backend implementation of the graph runtime, not the public DSL surface.

- OGSystem semantics live in Mermaid parsing plus the normalized execution plan
- `role.mode.*`, `join.mode.*`, `join.sources.*`, and `loop.max.*` are OGSystem metadata
- legacy `%% engine=langgraph` is accepted only as compatibility input

Reason:

- contributors need a stable semantic layer even if the backend changes later
- OGSystem metadata should not be documented as native LangGraph syntax

## 3. Execution Boundary

OpenCode is the current default executor behind the `Executor` abstraction.

- the runtime depends on `executor.ts`, not on OpenCode lifecycle details everywhere
- one run starts one shared `opencode serve`
- each role/node keeps one isolated session on that shared server for the run

Reason:

- OpenCode is the implemented executor today
- the abstraction keeps server lifecycle, execution, and session cleanup behind one boundary

## 4. Concurrency Semantics

Semantic fan-out is not the same thing as backend compute parallelism.

- `parallel_split` means OGSystem activates multiple downstream branches
- actual execution concurrency depends on the backend and executor behavior
- today, model-bound runs share one OpenCode server and use concurrent sessions when branches fan out

## 5. Persistence Contract

Resume consumes a narrow set of artifacts.

- `state.json.graphState` is the runtime state snapshot
- `sessions.json` is the executor session index for reload/reuse
- `events.ndjson` and Markdown files are operator-facing audit projections

Reason:

- separating runtime-consumed state from audit projections keeps recovery behavior explicit

## 6. Output Repair Policy

Output repair is deliberately narrow.

- wrapped stdout may be repaired by extracting one recoverable JSON object
- unknown event may be normalized only when exactly one outgoing event is allowed
- schema mismatch fails fast

Reason:

- broad auto-repair would hide role package defects and blur the runtime contract
