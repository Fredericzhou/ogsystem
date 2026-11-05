# OGSystem Decisions

Date: 2026-11-02
Status: active

## 1. One Runtime

OGSystem uses one active runtime path: the graph runtime.

- `model.bind` is the default execution binding surface
- `exec.bind` remains supported as the local-shell execution mode
- `exec.bind` does not imply a separate engine or a fallback FSM

Reason:

- the repository already needs one orchestration model for sequential, branch, join, and loop systems
- keeping parallel runtime implementations created drift in code, tests, and docs
- one persisted state model is required for trustworthy resume and audit behavior

## 1.1 Product Execution Model

OGSystem is positioned as an event-driven, persistent extended state-machine workflow runtime.
The persisted Run state includes business state, active branches, lineage, loop iterations, Join
progress, human-review control state, and checkpoint identity. A Role execution returns a business
event and structured data; the Runtime reduces that result into state and routes it through the
matching Flow.

The static socio-technical collaboration model is documented in the bilingual reference
[`extended-state-machine-and-dag-bilingual.md`](extended-state-machine-and-dag-bilingual.md). Its
abstract relation is `R = (V, E, rho, tau, kappa, alpha)`: Roles and handoffs, responsibility
boundaries, event labels, typed contracts, and authority policy are separate dimensions. This
distinction keeps responsibility, execution binding, information transfer, and control-plane
governance from collapsing into one graph node or one identity field.

This is an extended state machine rather than a simple finite-state machine because execution
state includes structured data, branch and Join scopes, bounded loops, durable recovery, and
control-plane pauses. The product keeps `task`, `input`, `event`, `data`, and lifecycle status as
separate concepts. LangGraph remains an engine adapter behind this model and does not define the
OGSystem public DSL or persisted product data model.

### 1.1.1 Ordinary FSM And OGS Extended State

The ordinary finite-state-machine model is a finite set of control states plus an event-driven
transition relation:

```text
(controlState, event) -> (nextControlState, action)
```

The current control state is sufficient to decide which transition is eligible. A guard may be
attached to a transition, but the model does not require a separately persisted business data
store, branch frontier, or partial-join result. This is the useful core of a state machine and
OGS keeps it: a declared Flow is selected from the current Role outcome and its event.

OGS uses the standard extended-state-machine pattern, in which a finite control state is paired
with explicitly modeled extended state:

```text
(controlState, event, extendedState)
  -> (nextControlState, updatedExtendedState, emittedFacts)
```

For OGS, the extended state is bounded and typed. It includes business state and reducer output,
the immutable `task`, the changing per-hop `input`, active branch and lineage facts, Join scopes,
loop counters and budgets, review/control state, checkpoint version, and execution evidence.
The Runtime persists these facts and uses them for routing, recovery, and audit; they are not
implicit variables hidden inside a model prompt.

Join and Loop explain why the extension is necessary in operational terms:

- **Join** readiness is a predicate over a set of completed source Roles for one
  `runId + lineageId + loopIteration`. Encoding every partial combination as a separate ordinary
  FSM state would make the control-state set grow with the number of branches and would lose the
  source payload needed by the joining Role. OGS stores a Join Scope and activates the target once
  the declared `all_of` or `quorum_of` rule is satisfied.
- **Loop** execution needs an iteration counter, a declared budget, and an exhausted transition.
  A plain back edge expresses repetition but does not express which iteration is active or when
  the loop must stop. OGS requires bounded loop metadata and records the iteration in the Run
  state, so the loop remains recoverable and termination is reviewable.
- **Parallel branches** require a frontier containing more than one active path. A theoretical
  product FSM could enumerate every frontier combination, but that creates state explosion and
  makes lineage and Join evidence opaque. OGS represents the frontier explicitly as runtime
  branch/lineage state.

This is a semantic extension, not an unrestricted scripting mechanism. The portable Semantic IR
defines the allowed fields, event contracts, guard AST, Join modes, loop budgets, persistence
rules, and failure behavior. Unknown fields, ambiguous routes, unbounded loops, undeclared Join
sources, and invalid context selectors fail closed. OGS is conceptually aligned with the
event/guard/action vocabulary used by UML state machines and with workflow control-flow ideas
such as BPMN gateways and tokens, but it does not claim UML execution-semantic or BPMN XML
conformance. OGS owns the public Role/Flow contract, durable state, recovery, and audit rules.

## 2. Backend Boundary

LangGraph is the current backend implementation of the graph runtime, not the public DSL surface.

- OGSystem semantics live in Mermaid parsing plus the normalized execution plan
- `role.mode.*`, `join.mode.*`, `join.sources.*`, and `loop.max.*` are OGSystem metadata
- `join.sources.*` is only valid together with `join.mode.*`, and `all_of` sources must match the incoming Mermaid role edges exactly
- `any_of` is represented by `join.mode=quorum_of + join.min=1` instead of adding a third join mode keyword
- `%% engine=langgraph` is not part of the active OGSystem semantic surface

Reason:

- contributors need a stable semantic layer even if the backend changes later
- OGSystem metadata should not be documented as native LangGraph syntax
- keep `all_of` explicit for common full-join readability, while avoiding `any_of` keyword expansion that increases parser/test surface without adding expressive power

## 2.1 Responsibility Role Boundary

`roleId` identifies an abstract Responsibility Role in one System. A rendered graph node is that
role's Responsibility Seat. Neither is a person, account, model, service instance, BPMN
gateway/event, branch, or execution record.

- role packages are versioned implementation assets, not the role identity
- `branchId`, `lineageId`, and `RoleExecutionRecord` are runtime facts, not static graph nodes
- feedback and review outcomes are transitions/control-plane facts, not implicit roles
- review/audit `actor` is derived from the authenticated control-plane principal and never
  participates in graph routing merely by being recorded
- a future nested-System relation means responsibility composition, not organization hierarchy,
  personnel assignment, or inherited authority

Reason:

- preserving these distinctions lets one responsibility be repeatedly activated without changing
  the static process graph
- it prevents visual or organizational convenience concepts from corrupting execution semantics
- it leaves identity, HR, organization, and legal-governance integrations outside the portable
  OGS core

## 3. Execution Boundary

OpenCode is the current default executor behind the `Executor` abstraction.

- the runtime depends on `executor.ts`, not on OpenCode lifecycle details everywhere
- one run starts one shared `opencode serve`
- sessions are keyed by `roleId:sessionLineageId`
- sibling branches of the same role do not share a session, but they still share the same role directory/private workspace
- `opencode serve` is started with its hostname/port arguments and no OGSystem directory binding; OpenCode SDK session `directory` is the resolved coding project
- an optional external `targetDir` may be attached to the OGSystem project; when present, OpenCode SDK sessions and CLI project commands use that target while artifacts remain under the OGSystem root
- Visualizer run APIs accept the same optional `targetDir`; when omitted they resolve the project attachment, preserving the CLI and UI default behavior

Reason:

- OpenCode is the implemented executor today
- the abstraction keeps server lifecycle, execution, and session cleanup behind one boundary
- keeping the target optional preserves the low-friction same-directory default while allowing multiple control planes to bind one coding project

## 4. Concurrency Semantics

Semantic fan-out is not the same thing as backend compute parallelism.

- `parallel_split` means OGSystem activates multiple downstream branches
- join readiness is tracked by `join.sources + lineageId + loopIteration`, not by raw node count alone
- uncertain-`N` dynamic fan-out stays inside one role (Heavy Node) or pre-expansion, not as runtime-generated graph semantics
- ordinary single-target sequential transitions keep the current `sessionLineageId`
- `all_of` join activation allocates a fresh join session lineage after all declared sources are ready
- actual execution concurrency depends on the backend and executor behavior
- controlled fan-out concurrency is an execution strategy, not a flow semantic
- today, `parallel_split` guarantees branch activation and session-lineage isolation; the current graph scheduler drains active branches in queue order, so physical execution concurrency is not a runtime guarantee
- sibling branches of the same role are isolated at the model-session layer, not by separate role-private directories

## 5. Persistence Contract

Resume consumes a narrow set of artifacts.

- canonical run root is `.ogs/runs/<run-id>/`
- `state.json.graphState` is the runtime state snapshot
- `sessions.json` is the executor session index for reload/reuse
- runtime writes `resolved-config.json` on run start for replay/audit stability
- OGSystem writes OpenCode run-local metadata to `.ogs/runs/<run-id>/.opencode/server.pid` + `.ogs/runs/<run-id>/.opencode/endpoint.json`; this run-local namespace is separate from the OpenCode session `directory`
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
- hard-blocking script execution harms portability with limited additional stability benefit

## 9. Exception Edge Scope (V1 Delivered, Flag-Gated)

`ERROR*` is implemented with strict boundaries and staged rollout control.

- syntax reuses edge labels: `ERROR` and `ERROR.<errorCode>`
- node-level opt-in: only nodes declaring `ERROR*` edges participate
- trigger source is runtime failure only; normal success outputs cannot emit `ERROR*`
- exception routing is evaluated only after executor-level retries are exhausted for that attempt
- matching order is exact `ERROR.<errorCode>` then fallback `ERROR`
- parser constraints: one fallback `ERROR` per `fromRole`, one target per `ERROR.<code>`, and exception flows originate from business roles rather than structural Start
- fail-closed parsing: reserved `ERROR*` events must be exactly `ERROR` or `ERROR.<errorCode>`
- role-facing `allowed_events` excludes runtime-only `ERROR*` edges
- use business event flows for expected successful domain outcomes; use `ERROR*` only for runtime-failure compensation/degrade paths
- behavior rule: no `ERROR*` edges means unchanged fail-stop behavior
- rollout uses feature flag `runtime.error_flows.v1` for staged enablement and rollback

## 10. Role Package And Import Boundary

Runtime executes one canonical role package shape.

- executable roles live only under `og-roles/roles/<roleId>/`
- role main text is `agent.md`; runtime no longer reads `persona.md` or `work.md`
- prompt templates consume the fixed shell `allowed_events`, `user_preferences`, `task`, `input`
- `task` remains the original user request across loops; `input` carries the per-hop changing context
- prompt-shell naming and selector naming are separate layers: the shell uses `user_preferences`, while selector syntax remains `global.user_profile.*`
- `source.json` and `tools/agent-source/sources.lock.json` are traceability metadata only; they do not participate in runtime manifest validation
- upstream repositories under `agent-sources/` are development-only checkouts and must be normalized through importer adapters before they become executable roles

## 11. Runtime-Native Human Review

Human review is a runtime control-plane capability, not a role-node pattern.

- reviewed roles declare `review.*` metadata on the role itself
- reviewed execution first produces a durable draft result, not an immediately released `roleResults` entry
- the owning branch moves to `waiting_review`
- operator surfaces expose `pendingReviewCount` and `hasWaitingHumanReview` as derived fields without expanding `GraphRunStatus`
- review decisions are persisted under `control/reviews/<reviewId>.decision.json`
- approve / rework / pause / terminate are reconciled by runtime resume/apply logic
- rework feedback is projected through `global.human_review.current.*` selectors

Reason:

- keeps human control in the runtime control plane instead of faking it as another autonomous role
- preserves durable audit/reconcile semantics for stop-review-resume workflows
- avoids building a second “human gate node” abstraction that duplicates branch/state machinery

## 12. Control Root And Shared Workspace Separation

Control metadata and business workspace files have separate ownership roots.

- `--ogs-dir` owns the System definition, role packages, runtime configuration, `.ogs/team-versions/`, and `.ogs/runs/<run-id>/`
- `--workspace-dir` owns user code, input materials, and promoted business deliverables
- one Collaboration Project binds one `workspaceDir`; multiple mounted `TeamVersion` snapshots can operate on that shared workspace without polluting each other's control root
- the framework never creates implicit `.ogs/`, `source/`, or `destination/` directories inside `workspaceDir`
- each used `TeamVersion` freezes an immutable manifest (`teamCoreDigest`, `systemDigest`, `packageDigest`), and each Project Run records `team-version.json`

## 13. Studio And Projects Dual-Workbench Isolation

OGS Studio and OGS Projects share the execution base and SPA shell, but own distinct lifecycles and storage namespaces.

- `runKind: "project_task"` is owned by `projectId + taskId + runId`, stored under `<projectId>/.ogs/runs/<runId>`, consumes the project execution slot, and can be archived into a Deliverable
- `runKind: "studio_simulation"` is owned by `teamVersionId + simulationId`, stored under `.studio/simulations/<teamVersionId>/<simulationId>`, and never enters project Tasks, capacity slots, Recent Project Runs, or Deliverables
- release baselines require `sandbox` Simulation evidence bound to the current `teamCoreDigest` and `baselineScenarioDigest`; `dry-run` Simulations are for interactive debugging only

## 14. Visualizer Semantic Layout And Query Boundary

Visualizer projections and graph layouts are strictly derived from runtime contracts.

- `Semantic IR -> ResponsibilityGraph -> Semantic Layout Projection -> ELK.js layered adapter -> LayoutProjection -> GraphViewModel -> X6 Renderer`
- ELK.js is the single explicit layout adapter; runtime state updates only refresh `ExecutionOverlay` without recalculating static node layout or dropping loop/error edges
- `RunQueryService` provides the read boundary between persisted run artifacts (`events.ndjson`, `timeline.jsonl`, `state.json`) and HTTP/SSE consumers, using cursor and byte-offset incremental reads

## 15. Untrusted Input Boundary And Call-ID Prompt Budget Ledger

External inputs and model token/character budgets are enforced at runtime boundaries.

- `isolateExternalData` defaults to `true`, wrapping non-task `input` payloads in `<ogs_external_data>` blocks with closing-tag escaping and recording `externalDataIsolated` in audit records
- prompt character budgets (`maxPromptCharsPerRole`, `maxTotalPromptCharsPerRun`) are tracked in `RunPromptBudgetLedger` keyed by per-request `callId` (`${executionId}:${phase}:${ordinal}`) across parallel branches, retries, JSON repairs, fallbacks, and checkpoint resumes
- `fallbackModelId` is a model ID within the role's selected backend; it is restricted to `binding.kind === "model"` and triggers only on retryable model-channel failures (timeouts, HTTP 429/502/503/504, transient network resets), never on schema/contract/auth/budget errors
