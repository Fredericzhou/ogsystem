# OGSystem Unified Backlog

Date: 2026-09-03
Status: active; current P1 execution plan reconciled 2026-09-03

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

## Current P1

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
- [x] Map discovered model references to project responsibility seats through explicit `model.bind.<roleId>` and `.ogs/model-selection.json` overrides; do not infer assignments from role names or business domains.
- [x] Keep `.ogs/model-catalog.json` as a refreshable cache and audit snapshot for UI/offline use, while `.ogs/model-selection.json` remains the pinned runtime selection used for reproducible runs and resume.
- [x] Remove concrete provider/model names from framework templates and fallback paths; use discovered catalog entries or fail closed with an actionable configuration diagnostic. Concrete model names may remain only in examples and tests.
- [x] Add catalog refresh, stale-cache, unavailable-model, capability mismatch, and role-mapping contract tests without requiring a built-in provider/model inventory.

## Current P2

- [ ] Freeze recursive responsibility composition: define the `ownerRoleId -> nestedSystem` IR contract, namespace/error/termination propagation rules, compiler diagnostics, and golden fixtures. Follow [`ogs-product-boundary-and-evolution.md`](ogs-product-boundary-and-evolution.md); keep organization, personnel, and concrete executor identity outside OGS core semantics.
- [x] Define released CLI upgrade, compatibility-window, and deprecation policy. See
  [`release-compatibility-policy.md`](release-compatibility-policy.md) and `ogs help compatibility`.
- [ ] Design semantic-compatible resume with tolerant fingerprints and degraded recovery.
- [ ] Add a distributed lock provider for Redis/DB cross-host coordination.
- [ ] Define shared-storage multi-instance scheduling and claim protocol.
- [ ] Advance `state/checkpoint compact` only if benchmark data proves it is needed.

## Out Of Scope For The Current Mainline

- Plugin and hook ecosystem.
- A new scheduler layer.
- Multiple persistence backends.
- External secrets manager integration.
- Breaking `vNext-dev` proposals.
