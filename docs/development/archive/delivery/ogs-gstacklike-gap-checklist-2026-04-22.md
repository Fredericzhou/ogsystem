# OGS GStacklike Gap Checklist

Date: 2026-04-22
Source: `docs/archive/delivery/ogs-gstacklike-gap-priority-2026-04-22.md`

## Goal

Turn the gap analysis into an execution-ready checklist.

Status: completed on 2026-04-22 after runtime/example/docs/test regression and artifact inspection.

Use this order:

1. fix the flagship example boundary first
2. fix operator-facing human review semantics
3. fix observability semantics
4. improve example realism
5. add scripting and dashboard polish

## Phase 1: Example Boundary Cleanup

### P0. Stop leaking runtime prompt shell into final artifact

- [x] Update `examples/ogs-gstacklike/scripts/ship-deploy.mjs` so final HTML no longer embeds the full stdin prompt.
- [x] Keep only business-facing content in `shared/index.html`.
- [x] If debugging context is still needed, write it to role-local artifacts instead of the final deliverable.
- [x] Re-run `bash examples/ogs-gstacklike/scripts/validate-scenarios.sh`.
- [x] Manually inspect one generated `shared/index.html` to confirm there is no `You are ...`, `Allowed events`, or raw prompt shell content.

Acceptance:

- final artifact contains only the intended page content
- runtime prompt shell remains available only in run artifacts, not in delivery output

## Phase 2: Human Review Operator Surface

### P1. Normalize review status semantics

- [x] Add a normalized top-level `currentStatus` field to:
  - `ogs run review list`
  - `ogs run review inspect`
- [x] Keep request snapshot and live runtime state separate in naming.
- [x] Avoid making callers infer status from `request.status` vs `pendingReview.status`.
- [x] Add tests covering:
  - pending review before decision
  - resolved review after approve
  - paused review after pause
  - rework case where request snapshot and live state differ

Acceptance:

- scripts can reliably read one status field for operator decisions
- old nested status fields no longer cause ambiguity

### P1. Preflight validation for `run review decide`

- [x] Before writing a decision, load the current review state.
- [x] Reject decision writes for already-resolved reviews by default.
- [x] Return a clear CLI error for stale or invalid review targets.
- [x] Add tests for:
  - valid pending review decision
  - stale resolved review decision
  - missing review id
  - invalid scope for terminate

Acceptance:

- invalid operator actions fail before durable decision write
- normal review flow remains unchanged

## Phase 3: Observability and Summary Semantics

### P1. Split wall-clock duration from execution duration

- [x] Keep current run-level wall-clock duration.
- [x] Add `executionDurationMs` derived from role execution durations.
- [x] Add `humanReviewWaitDurationMs` derived from review request/decision timing when available.
- [x] Update summary projection and any CLI output that surfaces duration.
- [x] Add tests for:
  - no-review run
  - review run with approval
  - review run with pause/re-resume

Acceptance:

- reviewed runs no longer look artificially slow in execution metrics
- human wait time is visible as a separate dimension

### P2. Add review summary projections

- [x] Add summary-level fields such as:
  - `lastReviewId`
  - `lastReviewDecision`
  - `lastReviewDecidedAt`
  - `reviewRoundCount`
- [x] Ensure these fields are stable across resume.
- [x] Add tests for single-round and multi-round review flows.

Acceptance:

- dashboards and summaries can answer basic review questions without opening raw review files

## Phase 4: Example Realism Upgrade

### P1. Improve handoff realism in `ogs-gstacklike`

- [x] Make `qa -> ship` handoff more structured than a canned event-only output.
- [x] Make `ship -> ship-deploy` handoff expose a compact deploy payload.
- [x] Keep runtime-native review on `ship`, but ensure `ship` output resembles a real release candidate artifact.
- [x] Make `retro` and `learn` produce small structured outputs rather than pure stubs.
- [x] Update the example README with one short “artifact inspection path” section.

Acceptance:

- the example still stays small
- the example now teaches both flow semantics and cleaner handoff boundaries

### P2. Improve README operator guidance

- [x] Add one explicit “inspect these files” section to `examples/ogs-gstacklike/README.md`.
- [x] Include:
  - `control/reviews/<reviewId>.request.json`
  - `control/reviews/<reviewId>.decision.json`
  - `summary.json`
  - `timeline.jsonl`
  - `shared/index.html`
- [x] Add one compact walkthrough for `approve`.
- [x] Add one compact walkthrough for `rework -> second review -> approve`.

Acceptance:

- a user can validate the example end-to-end without guessing which artifacts matter

## Phase 5: Review Scripting and UX Polish

### P2. Add helper for unresolved review discovery

- [x] Add either:
  - `ogs run review next <run-id>`
  - or `latestPendingReviewId` in `ogs run status`
- [x] Ensure multi-round review flows return the unresolved review, not the oldest review.
- [x] Add tests for:
  - single pending review
  - multi-round review with one resolved and one pending review

Acceptance:

- shell scripts no longer need to manually scan review arrays for unresolved entries

## Suggested Execution Batches

### Batch A

- [x] Prompt-shell leakage fix
- [x] Review status normalization
- [x] `run review decide` preflight validation

Outcome:

- example becomes safe to present as the main project-style reference
- review operations become less error-prone

### Batch B

- [x] Duration split
- [x] Review summary enrichments

Outcome:

- review-heavy runs become operationally measurable

### Batch C

- [x] Example realism upgrades
- [x] README artifact guidance
- [x] unresolved-review helper

Outcome:

- example becomes easier to learn from and easier to automate

## Definition of Done

- [x] `examples/ogs-gstacklike/system.mmd` still runs end-to-end
- [x] `examples/ogs-gstacklike/scenarios/approval-rework.mmd` still performs two-round review correctly
- [x] `bash examples/ogs-gstacklike/scripts/validate-scenarios.sh` passes
- [x] relevant runtime tests pass
- [x] docs and README reflect the new operator-facing behavior
