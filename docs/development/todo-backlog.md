# OGSystem Unified Backlog

Date: 2026-09-03
Status: active

This is the only active backlog entry point. Dated plans, reviews, and checklists stay in `docs/development/archive/` and are not daily execution lists.

## Closed

- Visualizer platform validation P1/P2 is closed in `docs/development/archive/delivery/ogsystem-visualizer-platform-validation-execution-plan-2026-05-04.md`.
- Browser smoke gating, Windows lifecycle smoke, docs drift checks, and CI Playwright Chromium setup are closed in `docs/development/archive/delivery/ogsystem-cross-platform-visualizer-validation-closure-2026-05-05.md`.
- Visualizer product usability gate follow-up is closed in `docs/development/archive/delivery/ogsystem-visualizer-product-usability-gate-followup-2026-05-05.md`.
- Visualizer UX convergence is closed; the short closure summary is archived at `docs/development/archive/delivery/visualizer-refactor-closure-summary-2026-05-13.md` and the detailed execution record at `docs/development/archive/delivery/visualizer-refactor-plan-2026-05-13.md`. Remaining ELK/semantic-layout work is tracked separately below.
- Responsibility-seat semantics review is closed and consolidated into `docs/development/ogs-visualizer-refactor-plan.md`, `docs/product-manual/ogsystem-orchestration-semantics-v1.md`, and `docs/product-manual/ogsystem-semantics-manual.md`; the review record remains historical at `docs/development/archive/delivery/ogsystem-visualizer-responsibility-seat-review-2026-09-02.md`.
- Semantic IR v1 foundations, state reducers, event/payload contracts, condition AST, Loop Scope, Join readiness/timeout, CAS/idempotency, runtime-native review, and ERROR* routing are closed for the current development-test baseline. Current boundaries and remaining gaps are maintained in `docs/development/semantic-gap-implementation-plan.md`.
- Generic feedback modeling is closed: `FEEDBACK` is a transition event between existing responsibility seats, not an implicit `a-feedback`/`b-feedback` seat.

## Current P1

- [ ] Add an optional Rust toolchain CI gate: run `tests/rust-hello-pipeline.test.mjs` when cargo is available.
- [ ] Add default `executionDirCount` threshold guidance to operations docs.
- [ ] Add cleanup audit fields: trigger threshold, cleanup duration, directory count before cleanup, and directory count after cleanup.
- [ ] Keep running `runtime-replay-benchmark` and record checkpoint replay timing trends.
- [ ] Add 500+ iteration recovery timing thresholds and regression gates.
- [ ] Add `docs/commenting-style.md` for source comment rules, counterexamples, and review checklist.
- [ ] Add `docs/file-sets.md` for `src/runtime/*` and `src/nl2mmd/*` ownership boundaries and import relationships.

## Current P1 Visualizer

- [ ] Replace the current Dagre/custom post-layout path with an explicit semantic layout adapter (ELK.js evaluation or a documented Dagre adapter), preserving back edges and route channels.
- [ ] Add layout quality diagnostics and fixtures for fan-out, Join, cycle, error flow, multi-terminal, label overlap, and stable lane assignment.
- [ ] Add responsibility-seat graph reading modes: upstream/downstream focus, route probe, main/error/loop/Join filters, and stable URL graph state.
- [ ] Continue focusing Build around the graph workspace, with Source, Diagnostics, and Readiness as supporting panels.
- [ ] Continue focusing Operate around selected-run health, failure location, and next actions, with logs, audit, resume diagnostics, and snapshot manifest as drill-down information.
- [ ] Add explicit long-running Visualizer health and disk-growth signals: `executionDirCount`, retention tier, and latest cleanup recommendation.
- [ ] Add a provider readiness UI entrypoint backed by doctor `providerHealth[]`.
- [ ] Persist or remember recent run-log filter combinations.

## Current P2

- [ ] Define released CLI upgrade, compatibility-window, and deprecation policy.
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
