# OGSystem Unified Backlog

Date: 2026-05-05
Status: active

This is the only active backlog entry point. Dated plans, reviews, and checklists stay in `docs/archive/` and are not daily execution lists.

## Closed

- Visualizer platform validation P1/P2 is closed in `docs/archive/delivery/ogsystem-visualizer-platform-validation-execution-plan-2026-05-04.md`.
- Browser smoke gating, Windows lifecycle smoke, docs drift checks, and CI Playwright Chromium setup are closed in `docs/archive/delivery/ogsystem-cross-platform-visualizer-validation-closure-2026-05-05.md`.
- Visualizer product usability gate follow-up is closed in `docs/archive/delivery/ogsystem-visualizer-product-usability-gate-followup-2026-05-05.md`.

## Current P1

- [ ] Add an optional Rust toolchain CI gate: run `tests/rust-hello-pipeline.test.mjs` when cargo is available.
- [ ] Add default `executionDirCount` threshold guidance to operations docs.
- [ ] Add cleanup audit fields: trigger threshold, cleanup duration, directory count before cleanup, and directory count after cleanup.
- [ ] Keep running `runtime-replay-benchmark` and record checkpoint replay timing trends.
- [ ] Add 500+ iteration recovery timing thresholds and regression gates.
- [ ] Add `docs/commenting-style.md` for source comment rules, counterexamples, and review checklist.
- [ ] Add `docs/file-sets.md` for `src/runtime/*` and `src/nl2mmd/*` ownership boundaries and import relationships.

## Current P1 Visualizer

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
