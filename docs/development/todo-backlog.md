# OGSystem Unified Backlog

Date: 2026-10-06
Status: active; reconciled through 2026-10-06

This is the only active backlog entry point. Dated plans, reviews, and checklists stay in `docs/development/archive/` and are not daily execution lists.

Execution plan: `docs/development/todo-backlog-execution-plan-2026-09-03.md`.

Contract freeze notes:

- VIZ-09 keeps `main | error | loop | join | feedback` as conversation semantics and maps them
  explicitly to the Visualizer layout channels through `presentationChannel`; loop return edges
  use `backEdge`.
- VIZ-09 human-review items use `reviewStatus: pending | recorded | applied | expired` and the
  runtime decision values `approve | rework | pause | terminate` as a separate `decision` field.
- VIZ-09 uses event/timeline `cursor` locators and `state.json` `snapshotVersion` locators;
  `ConversationItem.status` is controlled and unknown values normalize to `unknown`, while
  top-level `waiting` is a Visualizer-derived state rather than a new runtime status.

## Closed

- Visualizer platform validation P1/P2 is closed in `docs/development/archive/delivery/ogsystem-visualizer-platform-validation-execution-plan-2026-05-04.md`.
- Browser smoke gating, Windows lifecycle smoke, docs drift checks, and CI Playwright Chromium setup are closed in `docs/development/archive/delivery/ogsystem-cross-platform-visualizer-validation-closure-2026-05-05.md`.
- Visualizer product usability gate follow-up is closed in `docs/development/archive/delivery/ogsystem-visualizer-product-usability-gate-followup-2026-05-05.md`.
- Visualizer UX convergence is closed; the short closure summary is archived at `docs/development/archive/delivery/visualizer-refactor-closure-summary-2026-05-13.md` and the detailed execution record at `docs/development/archive/delivery/visualizer-refactor-plan-2026-05-13.md`. The current ELK.js semantic-layout implementation is tracked in the execution record below.
- Responsibility-seat semantics review is closed and consolidated into `docs/development/ogs-visualizer-refactor-plan.md`, `docs/usage/ogsystem-orchestration-semantics-v1.md`, and `docs/usage/ogsystem-semantics-manual.md`; the review record remains historical at `docs/development/archive/delivery/ogsystem-visualizer-responsibility-seat-review-2026-09-02.md`.
- Semantic IR v1 foundations, state reducers, event/payload contracts, condition AST, Loop Scope, Join readiness/timeout, CAS/idempotency, runtime-native review, and ERROR* routing are closed for the current development-test baseline. Current boundaries and remaining gaps are maintained in `docs/development/semantic-gap-implementation-plan.md`.
- Generic feedback modeling is closed: `FEEDBACK` is a transition event between existing responsibility seats, not an implicit `a-feedback`/`b-feedback` seat.
- 2026-09-04 to 2026-09-28 runtime, Visualizer, and Studio changes are reconciled in the execution record. Human Review timeout is implemented as lazy expiry at status/inspect/review-list/resume boundaries; it does not use a background daemon and does not provide cross-host coordination.
- Resume compatibility is explicitly out of scope: resume requires the current exact version/fingerprint; old run data is not migrated.

## Current P1

- [ ] Close first stable release gates in [`release-uat-checklist.md`](release-uat-checklist.md):
  validate the release tarball matrix, complete and sign bounded-workflow UAT, record
  recovery/retention evidence, and complete deployed Visualizer UAT. Support policy and Node/OS/
  package-manager scope are now recorded; validation still requires a candidate run. Use one
  [`release-evidence/TEMPLATE.md`](release-evidence/TEMPLATE.md) record per candidate; checklist
  completion is not evidence of execution.
- [x] Add an optional Rust toolchain CI gate: run `tests/rust-hello-pipeline.test.mjs` when cargo is available.
- [x] Add default `executionDirCount` threshold guidance to operations docs.
- [x] Add cleanup audit fields: trigger threshold, cleanup duration, directory count before cleanup, and directory count after cleanup.
- [x] Keep running `runtime-replay-benchmark` and record checkpoint replay timing trends.
- [x] Add 500+ iteration recovery timing thresholds and regression gates.
- [x] Add `docs/development/commenting-style.md` for source comment rules, counterexamples, and review checklist.
- [x] Add `docs/development/file-sets.md` for `src/runtime/*` and `src/nl2mmd/*` ownership boundaries and import relationships.

## Current P1 Visualizer

- [x] Replace the current custom post-layout path with ELK.js as the sole explicit semantic layout adapter, preserving back edges and route channels.
- [x] Add layout quality diagnostics and fixtures for fan-out, Join, cycle, error flow, multi-terminal, label overlap, and stable lane assignment.
- [x] Add responsibility-seat graph reading modes: upstream/downstream focus, route probe, main/error/loop/Join filters, and stable URL graph state.
- [x] Continue focusing Build around the graph workspace, with Source, Diagnostics, and Readiness as supporting panels.
- [x] Continue focusing Operate around selected-run health, failure location, and next actions, with logs, audit, resume diagnostics, and snapshot manifest as drill-down information.
- [x] Add explicit long-running Visualizer health and disk-growth signals: `executionDirCount`, retention tier, and latest cleanup recommendation.
- [x] Add a provider readiness UI entrypoint backed by doctor `providerHealth[]`.
- [x] Persist or remember recent run-log filter combinations.
- [x] Add a generic conversation-style run projection with an explicit redacted item contract for responsibility-seat events, branches, lineages, loop rounds, Join readiness, route decisions, error flows, and human-review control states; support incremental updates, graph links, main/error/loop/join/feedback filters, and source-locator traceability without synthetic feedback seats.

## Current P1 Model Discovery

- [x] Make OpenCode `opencode models --verbose` the sole discovery source for available models; keep OGS responsible only for the normalized `provider/model` reference and capability contract.
- [x] Map discovered model references to project responsibility seats through `.ogs/model-selection.json` defaults and role overrides; do not infer assignments from role names or business domains.
- [x] Keep `.ogs/model-catalog.json` as a refreshable cache and audit snapshot for UI/offline use, while `.ogs/model-selection.json` remains the pinned runtime selection used for reproducible runs and resume.
- [x] Remove concrete provider/model names from framework templates and fallback paths; use discovered catalog entries or fail closed with an actionable configuration diagnostic. Concrete model names may remain only in examples and tests.
- [x] Add catalog refresh, stale-cache, unavailable-model, capability mismatch, and role-mapping contract tests without requiring a built-in provider/model inventory.

## Current P2

- [x] Define released CLI upgrade, compatibility-window, and deprecation policy. See
  [`release-compatibility-policy.md`](release-compatibility-policy.md) and `ogs help compatibility`.
- [ ] Add a distributed lock provider for Redis/DB cross-host coordination.
- [ ] Define shared-storage multi-instance scheduling and claim protocol.
- [ ] Advance `state/checkpoint compact` only if benchmark data proves it is needed.
- [ ] Reconsider staged Join first-packet/gap timeouts only when a concrete long-wait use case requires them; preserve the existing total-timeout contract.
- [ ] Reconsider the single-host external signal inbox only when an asynchronous integration requires durable wait/signal/resume behavior.
- [ ] Define configurable execution retries only after real failure samples establish retryable error classes, per-attempt audit needs, and resume semantics.

## Out Of Scope For The Current Mainline

- Building complex applications with the framework as part of this project; project deliverables are framework capabilities and application templates/examples.
- Productionizing application examples into real code implementation, deployment, or sustained operational workflows.
- Recursive child-System execution; static composite declarations are validated, but execution is rejected with `IR_COMPOSITE_UNSUPPORTED`. Reconsider only if an application template demonstrates a reuse need that the current Role/Flow model cannot express clearly.
- Plugin and hook ecosystem.
- A new scheduler layer.
- Multiple persistence backends.
- External secrets manager integration.
- Breaking `vNext-dev` proposals.
