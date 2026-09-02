# OGS GStacklike Gap Priority

Date: 2026-04-22
Validated run: `20260422-163943-522fa3bd`
System: `examples/ogs-gstacklike/system.mmd`

## Scope

This note splits the gaps exposed by the end-to-end validation of `ogs-gstacklike/system.mmd` into:

- example problems
- framework problems

Each item is prioritized as `P0`, `P1`, or `P2`.

- `P0`: should be fixed before treating the example as the canonical project-style reference
- `P1`: important product/runtime quality issue, but not blocking the main semantics
- `P2`: worthwhile hardening or polish

## Summary

The core runtime-native review flow works:

- `office-hours -> review -> qa -> ship`
- `ship` parks in `waiting_review`
- operator decision is written under `control/reviews/`
- `resume` reconciles the decision and continues to `ship-deploy -> retro -> learn`
- final artifact is written to `shared/index.html`

The main gaps are not in the core stop-review-resume semantics. They are split between:

- example quality problems that make the reference example less clean than it should be
- framework operator-surface and observability problems that become obvious once a reviewed run is exercised end-to-end

## Example Problems

### P0

#### 1. Final artifact leaks internal runtime prompt shell

Current behavior:

- `examples/ogs-gstacklike/scripts/ship-deploy.mjs` writes the full stdin prompt into the final HTML
- the generated page includes internal text such as role instructions, allowed events, and runtime input shell

Why this is a problem:

- it teaches the wrong boundary between internal orchestration prompt and final user-facing deliverable
- it makes the project-style example look less production-ready than the runtime actually is

Recommended fix:

- change `ship-deploy.mjs` to consume only the business payload it needs
- stop echoing the full prompt into `shared/index.html`
- if debugging visibility is needed, write prompt snapshots to role artifacts, not final deliverables

### P1

#### 2. Main example roles are still too stub-like for a flagship project example

Current behavior:

- `office-hours`, `qa`, `retro`, and `learn` mostly emit canned results
- `review` and `ship` prove control-flow semantics, but do not demonstrate a realistic structured business handoff

Why this is a problem:

- the example is semantically correct but pedagogically weaker than it should be
- users may confuse "runtime can do this" with "this is how a project should model its role contracts"

Recommended fix:

- make `ship` consume a compact structured handoff from `qa`
- make `ship-deploy` consume a compact deploy payload instead of raw prompt text
- make `retro` and `learn` write small but real structured outputs

### P2

#### 3. Example docs still require a little too much operator inference

Current behavior:

- README now explains rework semantics, but the main path still assumes the operator understands which generated files matter most

Recommended fix:

- add one short "inspect these 5 files" section to the example README
- include `request.json`, `decision.json`, `summary.json`, `timeline.jsonl`, and `shared/index.html`

## Framework Problems

### P1

#### 1. Human review surfaces expose both request snapshot state and live pending-review state

Current behavior:

- `run review list` and `run review inspect` return both:
  - request record state from `*.request.json`
  - current runtime state from `graphState.pendingReviewsById`
- after reconciliation, these can diverge:
  - request snapshot may still show `pending`
  - live state may already be `resolved`

Why this is a problem:

- operator tooling and shell scripts can easily read the wrong status field
- the surface is technically accurate but semantically ambiguous

Recommended fix:

- add a normalized top-level `currentStatus`
- optionally rename nested fields to make the distinction explicit:
  - `requestSnapshot`
  - `currentState`

### P1

#### 2. Run summary duration mixes machine execution time with human waiting time

Current behavior:

- `summary.durationMs` is derived from `updatedAt - createdAt`
- human review waiting time is included in the same number as role execution time

Why this is a problem:

- performance analysis becomes misleading
- any reviewed workflow looks artificially slow
- execution regressions are harder to isolate from operator latency

Recommended fix:

- keep `wallClockDurationMs`
- add `executionDurationMs`
- add `humanReviewWaitDurationMs`

### P1

#### 3. `run review decide` accepts decisions too early and validates too late

Current behavior:

- CLI writes decision files directly
- stronger validity only emerges later during resume/reconcile

Why this is a problem:

- operator UX is more event-log-oriented than task-oriented
- invalid or stale decisions are not rejected as early as they should be

Recommended fix:

- preflight the target review before writing a decision
- reject decisions for already-resolved reviews by default
- keep a force path only if there is a concrete recovery use case

### P2

#### 4. Review observability is good at the event layer but thin at the summary layer

Current behavior:

- `timeline.jsonl` clearly shows `human_review_requested` and `human_review_approved`
- `summary.json` only exposes count-level review fields

Why this is a problem:

- summary-level dashboards cannot answer basic review questions without opening other files

Recommended fix:

- add review summary projections such as:
  - `lastReviewId`
  - `lastReviewDecision`
  - `lastReviewDecidedAt`
  - `reviewRoundCount`

### P2

#### 5. Review APIs still make scripting harder than necessary

Current behavior:

- external scripts often need multiple commands to:
  - discover the unresolved review
  - inspect it
  - confirm its effective state

Recommended fix:

- add a helper command like:
  - `ogs run review next <run-id>`
- or expose `currentStatus` and `latestPendingReviewId` directly in `run status`

## Priority Order

Recommended implementation order:

1. `P0` example fix: remove prompt-shell leakage from final artifact
2. `P1` framework fix: normalize human review status surfaces
3. `P1` framework fix: split execution duration from human-wait duration
4. `P1` framework fix: add preflight validation to `run review decide`
5. `P1` example fix: improve role handoff realism in `ogs-gstacklike`
6. `P2` improvements: summary enrichments and review scripting helpers

## Bottom Line

The current project does not have a broken runtime-native review framework.

What it has is:

- one flagship example that still carries some tutorial/stub shortcuts
- one operator surface that is correct but not yet sharp enough
- one observability model that needs to separate human latency from execution latency

That means the next phase should focus on:

- cleaning the example so it can serve as the canonical project-style reference
- tightening the operator and observability surfaces around review-heavy runs
