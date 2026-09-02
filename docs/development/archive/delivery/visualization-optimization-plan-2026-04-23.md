# Visualization Optimization Plan (2026-04-23)

Status: delivered

## Context

Current visualization delivery is functionally correct on the write path:

- visualizer write actions go through lifecycle/control-plane entrypoints
- front-end does not mutate run artifacts directly
- runtime semantics remain owned by runtime modules

The main optimization pressure is now on the read path, UX safety, and maintainability:

- active runs still pay significant read amplification from visualizer polling and refresh behavior
- control actions are clickable but not yet operator-safe
- visualizer DTO boundaries are still implicit
- `src/visualizer/server.ts` and `src/visualizer/data.ts` carry too many responsibilities

This plan keeps the current architecture constraints:

- file-first architecture
- no database
- no new infrastructure component
- reuse lifecycle/control-plane
- front-end reads via visualizer API/projections, not raw run directory access

## Target Outcomes

This optimization is successful only if all of the following become true:

1. A single SSE event no longer triggers a full `detail/reviews/logs/diagnostics` reload chain.
2. Opening a run no longer auto-computes full resume diagnostics by default.
3. Every write action exposes confirmation, audit input, busy state, success feedback, and failure feedback.
4. Runs list no longer triggers a full runs-directory scan every 15 seconds when there is no new run and no user action.

## Non-Goals

- no front-end framework migration
- no database-backed index or cache layer
- no change to runtime authority ownership
- no rewrite of lifecycle/control-plane semantics

## Milestone 1: Lightweight Cost Removal

Status: completed

### Goal

Remove obvious read costs that do not produce user value.

### Tasks

- [x] Remove `eventsCount` from visualizer run detail loading and related types.
- [x] Confirm there is no consumer on either server or client path.
- [x] Keep behavior otherwise unchanged.

### Acceptance

- [x] Run detail no longer reads full event history only to populate `eventsCount`.
- [x] No API or UI behavior regresses from removing the field.

## Milestone 2: Incremental Refresh Loop

Status: completed

### Goal

Close the main read-amplification loop end-to-end. Client-side partial refresh alone is not enough; server-side SSE tail reading must land in the same milestone.

### Scope

- front-end SSE behavior
- `/events` API behavior
- SSE server behavior
- selected-run refresh policy

### Tasks

- [x] Remove the `SSE -> scheduleRefresh() -> loadSelectedRun()` full reload chain.
- [x] Make SSE append timeline entries incrementally instead of triggering whole-page reload behavior.
- [x] Refresh only affected panels based on event type.
- [x] Keep logs out of automatic SSE-driven refresh unless explicitly requested by the user or covered by low-frequency policy.
- [x] Rework server-side event reading to support incremental tail reads from `timeline.jsonl` first, with compatibility fallback only where needed.
- [x] Change `/api/v1/runs/:runId/events?cursor=` to read incrementally instead of full-read-then-filter.
- [x] Change SSE push logic so it no longer re-reads the full event file every second.

### Notes

- This milestone should define the steady-state event delivery model for the visualizer.
- Compatibility for older runs is acceptable, but hot paths for active runs must be incremental.

### Acceptance

- [x] A single SSE event no longer triggers `loadSelectedRun()`.
- [x] SSE server no longer performs full event-file scans on every tick for active runs.
- [x] `/events?cursor=` no longer requires loading the entire event history before returning the requested tail.
- [x] Timeline still updates correctly for active runs.

## Milestone 3: DTO Boundary Before File Split

Status: completed

### Goal

Stabilize visualizer-facing data contracts before moving code across files.

### Required DTOs

- `RunHeader`
- `ReviewDetailView`
- `ResumeDiagnosticsView`

### Optional DTOs

- `RunGraphView`
- `ReviewListItem`
- `ProjectOverviewView`

### Tasks

- [x] Define explicit DTO shapes in visualizer-owned code.
- [x] Stop passing mixed runtime objects directly into front-end rendering.
- [x] Normalize data at the API/projection boundary.
- [x] Document which fields are visualizer contract versus runtime internal detail.

### Acceptance

- [x] Front-end rendering no longer depends on ad hoc runtime object shapes.
- [x] DTOs exist before `server.ts` and `data.ts` are physically split.
- [x] Runtime internal field churn does not force direct front-end updates unless DTOs change.

## Milestone 4: Heavy Read Models Become On-Demand

Status: completed

### Goal

Reduce high-cost reads that do not need to run by default.

### Tasks

- [x] Make resume diagnostics lazy-loaded instead of part of the default selected-run boot path.
- [x] Add explicit refresh behavior for diagnostics.
- [x] Add short-lived in-memory caching for diagnostics where safe, keyed by authority-set freshness signals such as mtime/digest.
- [x] Rework runs list refresh policy so idle periods do not keep scanning the runs directory.
- [x] Prefer existing `.ogs/runs-index.json` and in-memory snapshots on default list refresh paths.
- [x] Reserve full `loadIndexedRuns()` scans for reindex flows, explicit refresh, or bounded low-frequency reconciliation.

### Acceptance

- [x] Opening a run no longer auto-computes full resume diagnostics.
- [x] Resume diagnostics can still be explicitly loaded and refreshed.
- [x] Runs list no longer performs full runs-directory scans every 15 seconds during idle steady state.

## Milestone 5: Operator-Safe Control Actions

Status: completed

### Goal

Upgrade the visualizer from "API buttons" to a minimally safe operator console.

### Tasks

- [x] Add a shared action layer for write operations.
- [x] Require confirmation before `stop`, `reindex`, and review decisions.
- [x] Expose `actor`, `comment`, `reason`, and `scope` inputs where supported by lifecycle APIs.
- [x] Add per-action busy/disabled states.
- [x] Add local success and failure feedback at the page level or panel level.
- [x] Align review-decision wording with runtime semantics: distinguish `recorded`, `pending reconcile`, and `applied`.

### Acceptance

- [x] Every write action has confirmation.
- [x] Every write action can capture operator audit intent where the backend supports it.
- [x] Action failures are visible in the page without relying on console-only inspection.
- [x] Action success does not require a full-page reload.

## Milestone 6: Structural Decomposition

Status: completed

### Goal

Split responsibilities after refresh behavior and DTO boundaries are stable.

### Suggested Split

- `src/visualizer/http-routes.ts`
- `src/visualizer/api-handlers.ts`
- `src/visualizer/page-shell.ts`
- `src/visualizer/client-app.ts` or equivalent client-source module
- `src/visualizer/project-projection.ts`
- `src/visualizer/run-graph-projection.ts`
- `src/visualizer/resume-diagnostics.ts`

### Tasks

- [x] Separate HTML shell generation from client state/render logic.
- [x] Separate projection types by concern.
- [x] Keep visualizer DTO definitions in a stable module used by both handlers and renderer.
- [x] Reduce `server.ts` to API/control routing + server bootstrap instead of mixed HTML/CSS/JS ownership.

### Acceptance

- [x] `server.ts` no longer owns mixed HTML/CSS/JS concerns, and projection responsibilities are split into dedicated modules.
- [x] DTO ownership remains stable after the split.
- [x] Follow-up feature work can change one concern without reopening the entire visualizer stack.

## Milestone 7: Test Upgrade

Status: completed

### Goal

Move from interface-only confidence to user-path confidence.

### Tasks

- [x] Preserve existing API/projection regression coverage.
- [x] Add front-end state tests for route restoration and stream refresh behavior.
- [x] Add tests proving incremental timeline/event paths no longer depend on full-file rescans.
- [x] Add server tests proving idle runs-list refreshes stay cached until explicit reindex.
- [x] Expand visualizer API regression coverage to the updated DTO/read model contracts.

### Acceptance

- [x] Tests cover partial-refresh behavior, not just HTTP payloads.
- [x] Tests cover the updated control/data contracts, not just POST success.
- [x] Operator-critical visualizer flows remain covered by server + client state regression tests without adding new browser dependencies.

## Recommended Execution Order

1. Milestone 1: Lightweight Cost Removal
2. Milestone 2: Incremental Refresh Loop
3. Milestone 3: DTO Boundary Before File Split
4. Milestone 4: Heavy Read Models Become On-Demand
5. Milestone 5: Operator-Safe Control Actions
6. Milestone 6: Structural Decomposition
7. Milestone 7: Test Upgrade

## Review Notes Incorporated

- Client-side partial refresh and server-side incremental tail reading are treated as one continuous milestone.
- DTO boundaries are established before file splitting.
- Idle runs-list behavior must stop scanning the runs directory every 15 seconds without new runs or user action.
- Review lifecycle actionability stays on `currentStatus`, while operator-facing durable-decision progress is exposed separately as `decisionPhase`.
- Front-end regression now includes lightweight DOM/fetch/EventSource user-path coverage without adding a browser dependency.
