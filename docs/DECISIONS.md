# OGSystem Decisions

Date: 2026-04-12  
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
- `join.sources.*` is only valid together with `join.mode.*`, and `all_of` sources must match the incoming Mermaid role edges exactly
- `any_of` is represented by `join.mode=quorum_of + join.min=1` instead of adding a third join mode keyword
- legacy `%% engine=langgraph` is accepted only as compatibility input

Reason:

- contributors need a stable semantic layer even if the backend changes later
- OGSystem metadata should not be documented as native LangGraph syntax
- keep `all_of` explicit for common full-join readability, while avoiding `any_of` keyword expansion that increases parser/test/compatibility surface without adding expressive power

## 3. Execution Boundary

OpenCode is the current default executor behind the `Executor` abstraction.

- the runtime depends on `executor.ts`, not on OpenCode lifecycle details everywhere
- one run starts one shared `opencode serve`
- sessions are keyed by `roleId:sessionLineageId`
- sibling branches of the same role do not share a session, but they still share the same role directory/private workspace

Reason:

- OpenCode is the implemented executor today
- the abstraction keeps server lifecycle, execution, and session cleanup behind one boundary

## 4. Concurrency Semantics

Semantic fan-out is not the same thing as backend compute parallelism.

- `parallel_split` means OGSystem activates multiple downstream branches
- join readiness is tracked by `join.sources + lineageId + loopIteration`, not by raw node count alone
- uncertain-`N` dynamic fan-out stays inside one role (Heavy Node) or pre-expansion, not as runtime-generated graph semantics
- ordinary single-target sequential transitions keep the current `sessionLineageId`
- `all_of` join activation allocates a fresh join session lineage after all declared sources are ready
- actual execution concurrency depends on the backend and executor behavior
- controlled fan-out concurrency is an execution strategy, not a flow semantic
- today, model-bound runs share one OpenCode server and use concurrent sessions when branches fan out
- sibling branches of the same role are isolated at the model-session layer, not by separate role-private directories

## 5. Persistence Contract

Resume consumes a narrow set of artifacts.

- canonical run root is `.ogs/runs/<run-id>/`
- `state.json.graphState` is the runtime state snapshot
- `sessions.json` is the executor session index for reload/reuse
- runtime writes `resolved-config.json` on run start for replay/audit stability
- OpenCode run-local metadata is `.opencode/server.pid` + `.opencode/endpoint.json`
- operator-facing logs are split by channel: `logs/engine.ndjson` and `logs/roles/<roleId>.ndjson`
- `events.ndjson` stays as append-only full event history
- `summary.json` and `timeline.jsonl` are operator-facing projections; resume must not depend on them

Reason:

- separating runtime-consumed state from audit projections keeps recovery behavior explicit

## 6. Output Repair Policy

Output repair is deliberately narrow.

- wrapped stdout may be repaired by extracting one recoverable JSON object
- unknown event may be normalized only when exactly one outgoing event is allowed
- schema mismatch fails fast

Reason:

- broad auto-repair would hide role package defects and blur the runtime contract

## 7. Lifecycle Surface

`ogs` lifecycle commands are the primary operator surface.

- `ogs project init`
- `ogs project create <name> [--template <templateId>]`
- `ogs run start|resume|stop|list|status|inspect|logs`
- run stop follows `running -> stopping -> stopped` and persists stop intent/outcome in `control/`

## 8. Package Manager Policy

Package management now uses a split policy between published CLI installation and source-repository development.

- published package installs support `npm` and `pnpm`
- source-repository development keeps `pnpm` enforced when the lockfile is present
- docs prefer installed `ogs*` commands and mention `pnpm run ...` only as source-repository equivalents

Reason:

- the main determinism gains come from lockfile/install/CI discipline during repository development
- hard-blocking script execution harms ecosystem compatibility with limited additional stability benefit

## 9. Exception Edge Scope (V1 Delivered, Flag-Gated)

`ERROR*` is implemented with strict boundaries and staged rollout control.

- syntax reuses edge labels: `ERROR` and `ERROR.<errorCode>`
- node-level opt-in: only nodes declaring `ERROR*` edges participate
- trigger source is runtime failure only; normal success outputs cannot emit `ERROR*`
- exception routing is evaluated only after executor-level retries are exhausted for that attempt
- matching order is exact `ERROR.<errorCode>` then fallback `ERROR`
- parser constraints: one fallback `ERROR` per `fromRole`, one target per `ERROR.<code>`, and no `ERROR*` on `input`
- fail-closed parsing: reserved `ERROR*` events must be exactly `ERROR` or `ERROR.<errorCode>`
- role-facing `allowed_events` excludes runtime-only `ERROR*` edges
- use business event flows for expected successful domain outcomes; use `ERROR*` only for runtime-failure compensation/degrade paths
- compatibility rule: no `ERROR*` edges means unchanged fail-stop behavior
- rollout uses feature flag `runtime.error_flows.v1` for staged enablement and rollback
