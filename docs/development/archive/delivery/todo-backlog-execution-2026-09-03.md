# Unified Backlog Execution Delivery 2026-09-03

Status: P1 implementation and reconciliation complete; P2 boundary-gated work remains deferred.

Owner: Codex
Branch/commit: working tree; no commit requested
Plan: [`todo-backlog-execution-plan-2026-09-03.md`](../../todo-backlog-execution-plan-2026-09-03.md)

## Delivered

- OPS-01 optional Rust CI gate, OPS-02 retention guidance reconciliation, and OPS-03 cleanup
  audit-field verification.
- PERF-01 replay benchmark options and dated trend record; PERF-02 three-run 500-iteration
  report-only recovery thresholds.
- DOC-01 commenting style and DOC-02 runtime/NL2MMD file-set ownership documentation.
- MODEL-01 through MODEL-05 OpenCode discovery, explicit role mapping, pinned selection,
  fail-closed behavior, readiness wiring, and contract tests.
- P2-01 released CLI compatibility/deprecation policy and synchronized help/docs.
- VIZ-01 through VIZ-03 semantic Dagre adapter isolation, layout diagnostics, fixtures, graph
  reading modes, bounded URL state, and projection filters.
- VIZ-04 and VIZ-05 Build/Operate workspace focus validated against existing page and browser
  behavior.
- VIZ-06 through VIZ-08 operations health, provider readiness, and recent log-filter persistence.
- VIZ-09 read-only conversation projection with redaction, truncation, source locators, Join,
  loop, route, error, review, channel filters, URL state, API pagination, and incremental client
  cursor merge. No synthetic feedback seat is created.

## Changed Boundaries

The conversation view is derived from `events.ndjson`, `timeline.jsonl`, and `state.json`. It is
not a runtime artifact and is not a resume source. The event stream and persisted state remain
authoritative. Dagre remains the selected layout engine behind an explicit semantic adapter; no
ELK dependency was introduced.

## Verification

Passed:

- `pnpm run build`
- `pnpm run test:docs-command-drift`
- `git diff --check`
- `pnpm run test:visualizer`
- `node --test tests/runtime-replay-threshold.test.mjs`
- `node scripts/runtime-replay-threshold-check.mjs --input /tmp/ogs-replay-baseline-3.json`

The browser smoke gate is the final required Visualizer check for this delivery and is run from
the same working tree after this record is written. Temporary benchmark/run directories remain
outside the repository.

## Residual Risk And Deferred Work

- P2-02 remains blocked by the explicit strict fingerprint/resume product boundary.
- P2-03 and P2-04 remain outside the current single-host mainline pending a supported deployment,
  storage, lease, fencing, and operational ownership contract.
- P2-05 remains data-gated. The three local recovery runs pass report-only thresholds, and the
  observed data does not demonstrate that checkpoint compaction is necessary; checkpoint format
  was not changed.
