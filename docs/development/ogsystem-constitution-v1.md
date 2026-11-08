# OGSystem Constitution and Rules v1

Status: active (2026-11-08 release baseline)

This document is the compact governance entry point for OGSystem. It states the principles that
must remain true, the design layers that implement them, and the rules contributors and operators
must follow. It does not replace the detailed semantic, compiler, event, or product manuals.

## 1. Authority And Change Order

When two documents disagree, use this order:

1. Source code and executable tests define behavior that is already implemented.
2. This constitution and [`DECISIONS.md`](DECISIONS.md) define accepted architecture boundaries.
3. Active product and semantic manuals define the public contract and operating procedure.
4. Dated release records provide evidence for one code snapshot; they do not define behavior.
5. [`todo-backlog.md`](todo-backlog.md) is the only active work list.
6. `development/archive/` is historical context only.

Every semantic change must update the smallest relevant source-of-truth document, its tests, and
the release evidence when the change affects an acceptance claim. Do not create a second roadmap,
parallel event registry, or duplicate semantic contract.

## 2. Mission And Scope

OGSystem is an event-driven, persistent extended-state-machine runtime for bounded collaboration
among abstract Responsibility Roles. A Run persists its business state, active execution frontier,
branch lineage, Join progress, Loop budget, review control state, checkpoints, and audit evidence.

The public model is:

```text
System definition -> Semantic IR v1 -> Execution Plan -> Runtime -> durable evidence -> projections
```

The stable entry points remain Mermaid `system.mmd`, Semantic IR v1, `.ogs/` runtime assets, the
existing CLI, Team Site, Studio, and Projects. The current backend may use LangGraph and the current
executor may use OpenCode, but neither backend defines the public OGSystem model.

The current evolution boundary is deliberately narrow:

- no Team IR v2 root schema or replacement storage model;
- no historical migration or compatibility layer for the current direct-switch release;
- no dynamic fan-out, mutable Blackboard,抢单池, or implicit Role memory;
- no distributed scheduler, cloud multi-tenant runtime, or second orchestration engine;
- no UI framework replacement or separate Studio runtime.

## 3. Constitutional Principles

### 3.1 Responsibility Is The Graph Primitive

Every graph node is a stable abstract Responsibility Role / Responsibility Seat. It is not a
person, event, action, task, gateway, process step, branch instance, model, service, or Run record.
A Flow is a direct handoff from a completed source Role to a target Role.

### 3.2 One Semantic Runtime

There is one active graph runtime and one persisted state model for sequential execution, branching,
Join, Loop, review, recovery, and audit. Adapters may change execution technology behind the
boundary, but they must preserve the Role, Flow, state, event, recovery, and audit contracts.

### 3.3 Explicit Data Transfer

Handoff data is explicit: source event, target Role, field mapping, and Artifact mapping. Only
declared `context.map`, Flow Contract, and authorized Artifact references cross a Role boundary.
Run membership is not an authorization to read arbitrary upstream context or files.

### 3.4 Fixed Events, Typed Data

Normal Flow events come from the shared registry in `src/business-events.ts`; Runtime imports it
through `src/runtime/business-events.ts`. `READY` is
the normal handoff event; domain meaning belongs in Role identity, Flow selection, conditions, and
typed `data`, not in an unbounded event-name vocabulary. `START` and `ERROR*` are system events.
Runtime audit events are separate from routable business events.

### 3.5 Fail Closed

Missing inputs, invalid types, ambiguous routes, undeclared Join sources, invalid review bindings,
unauthorized Artifact reads, stale state versions, semantic drift, and unresolved budget targets
must reject or park with a stable reason. They must not silently fall back to an unconditional route,
old lineage, implicit context, or guessed recovery.

### 3.6 Bounded Repetition

Every executable cycle has an explicit finite budget. `loop_exhausted` is a Runtime control event
and enters `waiting_review`; it cannot continue through the old business event, `onExhausted`, or
End. Budget review permits only `continue`, `rework`, `reject`, and `terminate`, with graph-declared
targets and explicit authorization. Its `loopBudget` binding is the control-plane authority for
targets, grants, and termination scope. The legacy Human Review `spec` remains a read-compatible
projection for older request files and clients; it must not override the loop-budget binding.
An authorization consumed while activating a branch is compensated when that branch ends in a
retryable infrastructure failure, so a spawn or host failure cannot silently burn human-granted
capacity.

### 3.7 Join State Is Source State

Each Join source is projected as `pending`, `arrived`, `skipped`, or `failed`. `failed` means a real
execution failure and cannot be rewritten as `skipped`. A required skipped source fails closed;
quorum reaches its threshold once, and late arrivals remain audit facts. Zero arrivals never trigger
a Join.

### 3.8 Review State Is Lineage-Bound

A review decision is bound to `reviewId`, `round`, `lineageId`, `branchId`, and `stateVersion`.
Feedback enters only its declared rework path. A stale, duplicate, cross-round, or cross-lineage
decision is rejected and durably audited.

### 3.9 Artifacts Are Opaque And Authorized

Artifact references are opaque and retain Run, media type, producer, and provenance facts. A Role
invocation receives a precomputed allowed set. The controlled Artifact Resolver is the only new
reference-based read boundary; arbitrary paths are not credentials. Reads and denied reads are
auditable.

### 3.10 Results And Recovery Are Durable

The externally visible Run Result has one successful commit boundary, protected by CAS and an
idempotent commit identity. Branch-level terminal records may still be retained and existing End
aggregation semantics remain explicit. Resume consumes canonical state, checkpoints, sessions, and
semantic fingerprints; projections are for operators and queries, not recovery authority.

### 3.11 Ownership Is Explicit

Framework owns parsing, compilation, execution, recovery, and CLI. Platform owns discovery and
shared resource metadata. A Team owns static collaboration structure. A Project owns materials,
mounted TeamVersions, and Tasks. A Run owns one execution attempt and its evidence. Studio
Simulation and Project Run use the same runtime base but separate owners, storage, and lifecycles.

### 3.12 Evidence Is Part Of The Contract

Every control decision must be explainable from durable state, checkpoint, event, review, Artifact,
or result evidence. Visualizer and Team Site are projections and control surfaces; they may present
semantic facts but must not invent a second meaning for them.

## 4. Design Layers

| Layer | Canonical inputs | Responsibility | Durable output |
| --- | --- | --- | --- |
| Authoring | `system.mmd`, `.ogs/semantics.yaml`, contracts | Describe roles, flows, conditions, Join, Loop, and review metadata | validated source and authoring projections |
| Compilation | System definition, Role Packages, laws, bindings | Normalize and reject invalid semantics | Semantic IR, Execution Plan, compiler digest |
| Runtime | Plan, prompt/input, executor result | Reduce state, route Flow, manage branches, Join, Loop, review, and errors | `state.json`, checkpoints, `events.ndjson`, sessions, review files |
| Evidence | Runtime artifacts and event history | Preserve provenance, recovery identity, result commit, and audit | summaries, timeline, result projections, Artifact records |
| Product projections | Team/Project/Run evidence | Provide Studio, Team Site, CLI, and operator views | read models and control actions |

The projection layer may hide incomplete results from users, but it cannot turn a non-terminal Run
into a successful Result. The control plane may write a decision, but only Runtime reconciliation
may apply it to graph state.

## 5. Hard Rules

These rules are release-blocking when violated:

- Use the shared business-event registry; do not add raw event strings to a new semantic surface.
- Keep `task`, per-hop `input`, Role `event`, Role `data`, and lifecycle status separate.
- Do not pass context implicitly or read Artifacts outside the invocation allow-set.
- Do not infer Join failure from “no active branch”; persist source outcomes explicitly.
- Do not convert `failed` to `skipped`, or let a terminal Join outcome regress to `pending`.
- Do not bypass Loop Budget Review or accept an undeclared review target.
- Do not apply a decision without complete review binding and current CAS state.
- Do not expose a final Result before the Run-level commit is durable.
- Do not put absolute paths, credentials, temporary directories, or session IDs in semantic digests.
- Do not change Team Site/X6 structure to solve a Runtime semantic problem.
- Do not claim real provider, Sandbox, desktop, or LAN acceptance without an executable record.

## 6. Naming And Event Rules

Use these layers consistently:

| Layer | Allowed examples | Meaning |
| --- | --- | --- |
| Business Flow event | `READY`, `APPROVED`, `REJECTED`, `NEEDS_REWORK`, `BLOCKED` | Role-selected route |
| System event | `START`, `ERROR`, `ERROR.<code>` | Runtime boundary or failure route |
| Runtime control event | `loop_exhausted`, `run_waiting`, `result_committed` | Durable control/evidence fact |
| Runtime audit event | `human_review_rejected`, `human_review_decision_rejected` | Control decision result, never a Flow |
| Lifecycle status | `running`, `waiting_review`, `stopped`, `done`, `failed`, `terminated` | Runtime state, never a Role output event |

The routable event registry and payload contract are defined in
[`business-event-protocol-v1.md`](business-event-protocol-v1.md). Runtime evidence events are
typed separately in the Runtime transition/state contracts; they are not additional Flow events.
The detailed route, Join, review, Artifact, and recovery rules are defined in
[`ogsystem-handoff-semantics-v1.md`](../usage/ogsystem-handoff-semantics-v1.md).

## 7. Operational Rules

- Keep run evidence under `.ogs/runs/<runId>/`; keep business workspace and control/evidence roots
  distinct when a project configures both.
- Resume only a Run whose semantic fingerprint and dependency closure still match the frozen plan.
- Treat `state.json.graphState` and checkpoints as recovery authority; summaries and timelines are
  query projections.
- Use CLI review commands or the Team Site control surface to write decisions; do not edit graph
  state by hand.
- For LAN Visualizer exposure, use HTTPS and Basic Auth on a non-loopback host. Health probes may
  remain unauthenticated; UI, APIs, assets, and metrics require authentication.
- Record release validation for semantic cases, classic and new Teams, Studio/Projects separation,
  and browser layout. A passing unit test alone is not a real-case acceptance claim.

## 8. Change Procedure

For a proposed semantic change:

1. State which constitutional rule and ownership boundary it affects.
2. Update the canonical source, compiler/runtime contract, and focused tests together.
3. Add or update a real case when the change affects routing, Join, Loop, review, Artifact, Result,
   or recovery behavior.
4. Verify the existing Team Site/Visualizer shell and graph projections remain structurally intact.
5. Run build, focused tests, full tests, examples, and relevant browser/service checks.
6. Update the current release record and this documentation map; archive superseded proposals.

## 9. Documentation Map

| Question | Read first | Detail |
| --- | --- | --- |
| What is OGS? | [`product-introduction.md`](../usage/product-introduction.md) | [`ogsystem-core-concepts.md`](../usage/ogsystem-core-concepts.md) |
| What may the graph express? | [`ogsystem-orchestration-semantics-v1.md`](../usage/ogsystem-orchestration-semantics-v1.md) | [`ogsystem-semantics-manual.md`](../usage/ogsystem-semantics-manual.md) |
| How do handoff, Join, Loop, Review, Artifact, and recovery work? | [`ogsystem-handoff-semantics-v1.md`](../usage/ogsystem-handoff-semantics-v1.md) | Context Map and data projection guides |
| Which decisions are accepted? | [`DECISIONS.md`](DECISIONS.md) | Product boundary and compiler semantics |
| Which events are legal? | [`business-event-protocol-v1.md`](business-event-protocol-v1.md) | Shared registry and tests |
| How do I operate the product? | [`usage-manual.md`](../usage/usage-manual.md) | Team Site and Visualizer guides |
| What is currently verified? | [`release-validation-2026-11-08.md`](release-validation-2026-11-08.md) | UAT checklist and test output |
| What remains? | [`todo-backlog.md`](todo-backlog.md) | Archive for superseded work |
