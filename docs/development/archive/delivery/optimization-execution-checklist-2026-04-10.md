# OGSystem Reliability-First Execution Checklist

Superseded by: `docs/todo-backlog.md` (2026-04-11)  
Status: archived snapshot (P0/P1 completed)

Date: 2026-04-10  
Scope: reliability, consistency, stability, and persistence only

## 0. Principles

- Reuse the existing `parse -> validate -> compile -> execute` flow.
- Keep one runtime path and one executor boundary.
- Add diagnostics and safeguards only.
- Do not introduce plugin, hook, scheduler, or multi-backend subsystems.
- Keep all changes additive and backward-compatible.
- Prefer hard fail over recovery heuristics.

## 1. P0

### 1.1 Error envelope

- [x] Define one stable error envelope for runtime, audit, and CLI:
  - `errorCode`
  - `errorCategory`
  - `message`
  - `retryable`
  - `stage`
  - `roleId?`, `runId?`, `branchId?`
  - `line?` for lint diagnostics
- [x] Keep existing user-facing error text unchanged.
- [x] Populate the envelope on every failure path.

Acceptance:

- [x] Failure records are machine-parseable without string matching.

### 1.2 System lint

- [x] Add one thin `lint:system` command.
- [x] Reuse the existing Mermaid parse/validate/compile path only.
- [x] Do not build a separate validation engine or second parser.
- [x] Emit line-aware diagnostics in the form `line + errorCode + message`.
- [x] Keep lint read-only.
- [x] Keep lint hard-fail only.
- [x] Do not add auto-repair or suggestion logic.

Acceptance:

- [x] Lint and runtime share one source of truth.

### 1.3 State persistence

- [x] Make `state.json` writes atomic.
- [x] Keep `state.json.graphState` as the resume source of truth.
- [x] Check consistency between `state.json.graphState` and `sessions.json` before resume.
- [x] Reject partial or corrupted state snapshots.
- [x] Add a resume idempotency test.

Acceptance:

- [x] Re-running resume does not duplicate role execution.

### 1.4 Output repair boundary

- [x] Keep output repair bounded to one correction attempt.
- [x] Keep repair narrow and deterministic.
- [x] Do not add relaxed-schema or raw-text fallback tiers.
- [x] Record repair statistics in the run summary.

Acceptance:

- [x] Repair behavior is measurable and predictable.

### 1.5 Minimal observability

- [x] Add run summary counters:
  - `totalTransitions`
  - `okCount`
  - `failedCount`
  - `noopCount`
- [x] Add structured failure summaries by `errorCode`.
- [x] Keep Markdown audit files as the operator-facing view.

Acceptance:

- [x] A failing role and failure class can be identified from run artifacts alone.

## 2. P1

### 2.1 Tests

- [x] Add bad Mermaid fixtures.
- [x] Add diagnostic snapshot tests for lint output.
- [x] Add error envelope regression tests.
- [x] Add resume idempotency tests.

### 2.2 CI

- [x] Keep build and test as the base gate.
- [x] Add dry-run example regression gates.
- [x] Add doctor preflight when execution is expected.

### 2.3 Artifact control

- [x] Add optional cleanup for historical execution snapshots.
- [x] Keep resume-consumed artifacts intact.
- [x] Do not affect `state.json` or `sessions.json`.

### 2.4 Config compatibility

- [x] Add explicit config version checks.
- [x] Fail fast on unsupported versions.
- [x] Do not add a migration platform.

## 3. Out of Scope

- [x] Plugin or hook ecosystem
- [x] New scheduler or orchestration layer
- [x] Multi-backend persistence
- [x] Multi-server sharding
- [x] Warning tier or suggestion engine
- [x] External secrets manager integration

## 4. Execution Order

1. Error envelope
2. `lint:system`
3. Atomic state writes
4. Resume consistency
5. Bounded output repair
6. Minimal observability
7. Bad-sample tests
8. CI dry-run gate
9. Artifact cleanup
10. Config version checks
