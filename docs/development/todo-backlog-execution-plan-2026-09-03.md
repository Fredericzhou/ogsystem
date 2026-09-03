# OGSystem Unified Backlog Execution Plan

Date: 2026-09-03
Status: reconciled; P2 deferred items remain explicitly gated
Source backlog: [`todo-backlog.md`](todo-backlog.md)
Scope: current mainline development-test baseline

This document turns the unified backlog into an execution sequence. The backlog remains the
single list of active work. This file supplies task IDs, dependencies, target files, acceptance
gates, and evidence locations. Completed tasks should be reconciled back into the backlog and
then moved to the delivery archive when their evidence is complete.

## 1. Operating Rules

### 1.1 Task states

- `ready`: implementation can start with the current contract.
- `decision`: a product or architecture decision is required before implementation.
- `data-gated`: measurement or real usage data is required before a threshold or implementation choice.
- `blocked`: an explicit external dependency is missing.
- `closed-candidate`: code or documentation is already present and needs reconciliation evidence.
- `done`: acceptance and evidence are complete; update the backlog and archive the delivery record.

### 1.2 Required task record

Every implementation task must record:

- owner and branch/commit range;
- changed files and test files;
- dependency and decision references;
- exact verification commands;
- result, residual risk, and follow-up;
- benchmark or screenshot artifacts where applicable.

### 1.3 Global completion gate

For runtime or documentation-only changes:

```bash
pnpm run build
pnpm run test:docs-command-drift
git diff --check
```

For Visualizer changes, also run:

```bash
pnpm run test:visualizer
pnpm run test:visualizer-browser
```

For runtime behavior changes, add the smallest relevant focused test first, then run the affected
runtime regression suite. Do not use a passing build as a substitute for the task-specific gate.

## 2. Baseline And Reconciliation

### 2.1 Verified baseline

The following checks passed on 2026-09-03:

- `pnpm run build`;
- `pnpm run test:docs-command-drift`;
- focused tests covering doctor, model runtime, graph runtime, cleanup retention, loop budget,
  and Visualizer operations summary: 20 passed, 0 failed.

The initial replay benchmark attempt was slow to complete; PERF-01/02 subsequently recorded three
500-iteration runs and established a report-only regression check. See
[`benchmarks/runtime-replay-2026-09-03.md`](benchmarks/runtime-replay-2026-09-03.md).

### 2.2 Existing implementation that must not be duplicated

- `executionDirCount` is emitted by runtime metrics and consumed by operations projections.
- Retention tiers and threshold guidance already exist in
  [`docs/usage/usage-manual.md`](../usage/usage-manual.md:801).
- Cleanup events already record trigger, threshold, duration, and before/after directory counts
  in [`src/runtime/graph-runner.ts`](../../src/runtime/graph-runner.ts:964).
- OpenCode model discovery, catalog parsing, model selection, explicit role resolution, and
  provider health checks already have runtime foundations.
- Current Studio auto-layout is isolated in the Dagre adapter and semantic projection modules:
  [`dagre-layout-adapter.ts`](../../src/visualizer/studio-client/dagre-layout-adapter.ts:150) and
  [`semantic-layout-projection.ts`](../../src/visualizer/studio-client/semantic-layout-projection.ts:327).

## 3. Execution Order

The recommended order is:

1. Reconcile stale backlog entries and assign owners.
2. Land low-risk documentation and CI tasks.
3. Make the replay benchmark cheap, reproducible, and recordable.
4. Establish the 500+ recovery baseline before introducing compaction or concurrency work.
5. Execute Model Discovery in the frozen order `MODEL-01 -> MODEL-03 -> MODEL-02 -> MODEL-04 -> MODEL-05`.
6. Resolve the Visualizer layout adapter decision, then implement layout diagnostics before UI
   reading modes and the conversation projection.
7. Implement or validate the remaining Visualizer operator surfaces.
8. Define P2 policies only after the preceding evidence is available. Keep distributed operation
   work paused unless the product boundary changes.

The first executable batch is `OPS-01`, `DOC-01`, and `DOC-02`. `OPS-02` and `OPS-03` are
reconciliation tasks, not new implementation work.

## 4. P1 Runtime, Operations, And Documentation

### OPS-01 Optional Rust CI gate

Status: `done`
Owner: Codex
Dependency: none
Targets: `.github/workflows/ci.yml`, `tests/rust-hello-pipeline.test.mjs`

Execution:

- Add a CI step after build and before the full test or dry-run stage.
- Detect `cargo` using the runner environment.
- Run `node --test tests/rust-hello-pipeline.test.mjs` only when cargo is available.
- Emit an explicit skipped result when cargo is unavailable; missing cargo must not fail the
  general cross-platform job.
- Keep the test's existing skip behavior as a second safety layer.

Acceptance:

- A runner with cargo executes the Rust test.
- A runner without cargo reports a deliberate skip and remains green.
- Rust test failure fails the job when the gate actually ran.
- Existing Ubuntu, macOS, and Windows CI stages remain unchanged otherwise.

Verification:

```bash
pnpm run build
node --test tests/rust-hello-pipeline.test.mjs
```

Evidence: `.github/workflows/ci.yml` conditional cargo gate and
`tests/rust-hello-pipeline.test.mjs`; local Rust gate passed on the available toolchain.

### OPS-02 Reconcile `executionDirCount` guidance

Status: `done`
Owner: Codex
Dependency: none
Targets: [`docs/usage/usage-manual.md`](../usage/usage-manual.md:801)

The usage manual already defines Development, Staging, and Production retention tiers and the
threshold trigger. Do not add a second threshold table. Confirm that the table is the intended
authority, then move the backlog item to Closed with this plan and the relevant test/docs
references.

Acceptance:

- One active operations document is identified as the threshold authority.
- Guidance distinguishes metrics observation, automatic retention cleanup, and one-time CLI
  cleanup.
- `pnpm run test:docs-command-drift` passes.

Evidence: [`usage-manual.md`](../usage/usage-manual.md:801) is the single active threshold authority;
`pnpm run test:docs-command-drift` passed.

### OPS-03 Reconcile cleanup audit fields

Status: `done`
Owner: Codex
Dependency: none
Targets: [`src/runtime/graph-runner.ts`](../../src/runtime/graph-runner.ts:948),
`tests/graph-runtime.integration.test.mjs`

Runtime cleanup events already include `trigger`, `triggerThreshold`, `durationMs`,
`executionDirCountBefore`, `executionDirCountAfter`, and the removed count. Confirm the success
and failure paths remain covered, then close the backlog item. Any missing field must be fixed in
the event contract and its integration test rather than documented as future work.

Acceptance:

- Manual cleanup and threshold-triggered cleanup both expose the required fields.
- Failed cleanup records duration, threshold, before/after counts, and an error code.
- The existing retention integration tests pass.

Verification:

```bash
pnpm run build
node --test tests/graph-runtime.integration.test.mjs
```

Evidence: cleanup success/failure assertions in `tests/graph-runtime.integration.test.mjs` and the
audit fields emitted by `src/runtime/graph-runner.ts`.

### PERF-01 Replay benchmark baseline and trend record

Status: `done`
Owner: Codex
Dependency: none
Targets: `tests/benchmarks/runtime-replay-benchmark.mjs`, new
`docs/development/benchmarks/runtime-replay.md`

Execution:

- Preserve the existing 500-iteration scenario and its resume point.
- Add explicit benchmark options or environment variables for iteration count, checkpoint
  restore point, and output path.
- Print one machine-readable JSON record and a short human-readable summary.
- Record Node version, platform, iteration count, checkpoint counts, state-load time,
  checkpoint-load time, resume total time, and state-write time.
- Add a trend record format under `docs/development/benchmarks/`; do not commit temporary run
  directories.
- Run a small smoke configuration locally and the 500-iteration configuration on the selected
  benchmark environment.

Acceptance:

- The smoke benchmark completes within a normal developer test window.
- The 500-iteration benchmark completes without manual interruption on the selected environment.
- Two repeated runs produce comparable JSON fields and no missing metrics.
- A trend record identifies environment and date; it does not claim cross-machine comparability
  without normalization.

Verification:

```bash
pnpm run build
node tests/benchmarks/runtime-replay-benchmark.mjs
```

Evidence: [`benchmarks/runtime-replay-2026-09-03.md`](benchmarks/runtime-replay-2026-09-03.md),
three 500-iteration records, and the benchmark JSON/human summary output.

### PERF-02 500+ recovery timing threshold and regression gate

Status: `done`
Owner: Codex
Dependency: PERF-01
Targets: benchmark record, test/CI configuration, possibly
`tests/benchmarks/runtime-replay-benchmark.mjs`

Execution:

- Collect a baseline on the supported benchmark environment before setting a limit.
- Define separate limits for state load, checkpoint tail load, and total resume time; do not use
  one opaque end-to-end number.
- Define sample count, warm-up policy, allowed variance, and failure behavior.
- Start with a report-only gate if variance is high, then promote it to a failing regression gate.
- Keep `state/checkpoint compact` blocked until this data shows that artifact size or replay cost
  is the limiting factor.

Acceptance:

- Thresholds are justified by at least three repeated baseline runs.
- A deliberately slower fixture fails or is reported according to the chosen gate mode.
- Normal variance does not create an unreliable CI gate.
- The gate is documented with its environment assumptions.

Evidence: the three-run baseline and report-only thresholds in
[`benchmarks/runtime-replay-2026-09-03.md`](benchmarks/runtime-replay-2026-09-03.md), with focused
checker tests in `tests/runtime-replay-threshold.test.mjs`. The gate intentionally remains
report-only because observed local variance is material.

### DOC-01 Source commenting style

Status: `done`
Owner: Codex
Dependency: none
Target: new `docs/development/commenting-style.md`

Content must cover comment purpose, preferred placement, examples of useful context, misleading
or redundant comments, generated/bundled source rules, and a review checklist. Align the document
with existing comments in `src/runtime/*`, `src/nl2mmd/*`, and `src/visualizer/*`; do not impose a
formatter or broad comment rewrite in this task.

Acceptance:

- The rules distinguish invariants/trade-offs from narration of obvious code.
- At least two counterexamples and a concise review checklist are present.
- The document is linked from the documentation index.
- `pnpm run test:docs-command-drift` and `git diff --check` pass.

### DOC-02 Runtime and NL2MMD file sets

Status: `done`
Owner: Codex
Dependency: none
Target: new `docs/development/file-sets.md`

Document ownership boundaries for `src/runtime/*` and `src/nl2mmd/*`, including import direction,
shared contracts, generated `dist` boundaries, test ownership, and the rule for adding a new
cross-package dependency. The document must identify current exceptions rather than claiming that
the directories are completely independent.

Acceptance:

- Every current direct import between the two sets is either explained or identified as a boundary
  candidate.
- Runtime remains the authority for model selection and execution contracts.
- NL2MMD remains the authority for prompt-to-Mermaid transformation and validation orchestration.
- The file is linked from the documentation index.

## 5. P1 Model Discovery

### MODEL-01 OpenCode discovery authority

Status: `done`
Owner: Codex
Branch/commit: working tree; no commit requested
Dependency: none
Targets: `src/runtime/model-catalog.ts`, `src/runtime/project-lifecycle.ts`,
`src/runtime/doctor.ts`, related tests

Decision: OpenCode `opencode models --verbose` is the only availability discovery source. OGS
normalizes its output into `provider/model` and capability fields, but does not maintain a built-in
provider inventory.

Execution:

- Keep the existing parser and fixture-based discovery path.
- Specify behavior for command missing, non-zero exit, malformed output, empty catalog, and stale
  cache.
- Separate discovery failure from a pinned selection that is intentionally offline.
- Surface actionable diagnostics through project sync, doctor, and Visualizer readiness.

Acceptance:

- No runtime path silently invents an available provider/model.
- Discovery failures identify the command and corrective action.
- Tests use `tests/fixtures/opencode-models-verbose.txt` or injected command output and do not
  require a built-in inventory.

### MODEL-02 Explicit responsibility-seat mapping

Status: `done`
Owner: Codex
Branch/commit: working tree; no commit requested
Dependency: MODEL-01, MODEL-03
Targets: `src/runtime/model-selection.ts`, parser/selection tests, Visualizer authoring projection

Use explicit `model.bind.<roleId>` and `.ogs/model-selection.json` role/system overrides. Do not
infer model assignment from role names, labels, domains, or `talent` metadata.

Acceptance:

- Direct `provider/model` binding has documented precedence.
- System and project defaults resolve deterministically for every role.
- A missing or unresolved role mapping fails with a role-specific diagnostic.
- The resolved model reference is included in the plan fingerprint and resume contract.

### MODEL-03 Catalog cache versus pinned selection

Status: `done`
Owner: Codex
Branch/commit: working tree; no commit requested
Dependency: MODEL-01
Targets: `src/runtime/model-catalog.ts`, `src/runtime/model-selection.ts`, project lifecycle docs/tests

Freeze the following contract: `.ogs/model-catalog.json` is a refreshable discovery cache and audit
snapshot; `.ogs/model-selection.json` is the pinned runtime selection used for reproducible runs and
resume. Runtime execution and readiness use the same matrix; readiness may add operator guidance,
but must not report a state as executable when runtime will fail closed.

| Scenario | Runtime behavior | Readiness behavior |
| --- | --- | --- |
| Catalog missing, valid pinned selection exists | Allow offline run; do not silently select another model | Warn that availability was not discovered; keep the pinned reference visible |
| Catalog stale, pinned model remains executable | Warn; do not auto-replace the pinned model | Warn as stale, but report the pinned selection as usable |
| Pinned model is explicitly unavailable | Fail closed with model and role diagnostic | Failed readiness with refresh/configuration action |
| Role has no resolvable model | Fail closed | Failed readiness with role-specific mapping action |
| Model capability does not satisfy role execution requirements | Fail closed | Failed readiness with required/actual capability details |
| `sync-models` discovers a new model | Update catalog only; never overwrite existing selection | Show the new catalog entry as available for explicit pinning |

“Valid pinned selection” means the selection file passes schema validation and the model reference
uses `provider/model` format. A missing catalog cannot prove current provider availability; that is
why it is an offline warning rather than an availability failure. When discovery explicitly reports
the selected model as unavailable, or capability resolution fails, execution must fail closed.

Acceptance:

- Precedence and offline behavior are documented in one active contract.
- Catalog refresh never rewrites an existing pinned selection without an explicit option.
- Resume uses the persisted selection/fingerprint rather than reselecting from the current catalog.
- Runtime, doctor, project readiness, and Visualizer readiness use the same scenario matrix.
- Stale or missing catalog alone never causes a valid pinned offline run to select a replacement.

### MODEL-04 Remove concrete framework fallback models

Status: `done`
Owner: Codex
Branch/commit: working tree; no commit requested
Dependency: MODEL-01, MODEL-02, MODEL-03
Targets: `src/visualizer/project-projection.ts`,
`src/runtime/project-lifecycle.ts`, framework templates and tests

Remove concrete provider/model names from framework defaults and fallback paths. Concrete model names
may remain in examples, fixtures, and tests. When no discovered usable model exists, fail closed with
an actionable diagnostic. A valid pinned selection may run offline when the catalog is missing or
stale, according to the frozen MODEL-03 matrix.

Acceptance:

- Source scans show no concrete framework fallback outside examples/tests.
- Empty discovery and capability mismatch produce stable diagnostics.
- Generated projects do not silently select a hardcoded model.

### MODEL-05 Discovery and mapping contract tests

Status: `done`
Owner: Codex
Branch/commit: working tree; no commit requested
Dependency: MODEL-01, MODEL-02, MODEL-03, MODEL-04
Targets: `tests/model-runtime.test.mjs`, new focused model catalog/selection tests, doctor/readiness tests

Cover catalog refresh, malformed and empty discovery, stale cache, unavailable pinned model,
capability mismatch, direct binding precedence, project/system/role mapping, fingerprint inclusion,
and no-built-in-inventory behavior. Use injected OpenCode output fixtures; no network or provider
credentials are required.

Acceptance:

- Each failure mode has an assertion for error code/message and affected role/model.
- Tests prove role names and business labels do not influence assignment.
- The focused suite passes with no provider inventory and no online connectivity check.

Completion evidence (2026-09-03):

- Changed runtime model catalog/selection, lifecycle, doctor, project readiness, and framework fallback paths; concrete framework model refs were removed.
- Added `tests/model-contract.test.mjs` and `tests/model-readiness-contract.test.mjs` with injected OpenCode output and offline fixtures.
- Verified with `node --test tests/model-contract.test.mjs tests/model-readiness-contract.test.mjs tests/doctor.test.mjs tests/visualizer-project-readiness.test.mjs`, `node --test tests/cli-lifecycle.test.mjs`, `node --test tests/resume-session.test.mjs tests/role-resolution.test.mjs tests/execution-plan.test.mjs tests/nl2mmd.test.mjs tests/visualizer-data.test.mjs tests/visualizer-project-context-service.test.mjs`, `pnpm run test:docs-command-drift`, and `git diff --check`.
- Residual: none for this task; the current build and focused contract suites pass.

## 6. P1 Visualizer

### VIZ-01 Semantic layout adapter decision and implementation

Status: `done`
Owner: TBD
Dependency: none
Targets: `src/visualizer/studio-client/dagre-layout-adapter.ts`,
`src/visualizer/studio-client/semantic-layout-projection.ts`, `package.json`, Visualizer tests

Decision gate:

- Evaluate ELK.js against the existing generic fixtures and required route-channel contract; or
- formally document Dagre as the adapter and isolate current custom post-layout behavior behind an
  explicit adapter boundary.

The semantic contract must preserve all business edges, including back edges, error edges, Join
edges, multi-terminal edges, stable lanes, and route points. Layout must not change runtime semantics.

Implementation note: Dagre is the explicit adapter. `semantic-layout-projection.ts` owns the stable projection and route contract; `dagre-layout-adapter.ts` owns the only Dagre import. No ELK dependency is added.

Acceptance:

- Renderer consumes a layout projection rather than calling a layout library directly.
- Repeated layout of the same semantic graph is deterministic.
- Back edges and route channels remain represented even when the layout engine breaks cycles.
- The chosen fallback behavior and unsupported constraints produce diagnostics.

Required design reference: [`ogs-visualizer-refactor-plan.md`](ogs-visualizer-refactor-plan.md:394).

### VIZ-02 Layout quality diagnostics and fixtures

Status: `done`
Owner: Codex
Dependency: VIZ-01
Targets: `tests/fixtures`, layout projection tests, Visualizer browser tests

Create generic fixtures for fan-out, Join, cycle, error flow, multi-terminal, label overlap, node
size variation, and stable lane assignment. Define diagnostics for overlap, clipped labels, route
loss, unstable ordering, and unsupported constraints.

Acceptance:

- Every backlog scenario has a fixture and deterministic assertions.
- Node overlap and label overflow are detected rather than inferred from screenshots alone.
- The same graph and input produce the same `layoutDigest`.
- Browser screenshots cover at least one wide and one narrow viewport.

Completion evidence (2026-09-03): semantic layout fixtures and diagnostics cover fan-out, Join,
cycle, error flow, multi-terminal routing, label/node bounds, stable lanes, and deterministic
digests in `tests/visualizer-layout-projection.test.mjs` and
`tests/visualizer-studio-layout.test.mjs`.

### VIZ-03 Graph reading modes and URL state

Status: `done`
Owner: Codex
Dependency: VIZ-01, VIZ-02
Targets: `src/visualizer/graph-view-model.ts`, `src/visualizer/client-app.ts`,
`src/visualizer/client-route-state.ts`, DTOs, client-state tests

Define the state contract for upstream/downstream focus, route probe, main/error/loop/Join filters,
selected role/flow/branch, and stable URL serialization. URL state must be bounded, validated, and
independent of transient runtime data.

Acceptance:

- A copied URL restores the same graph reading mode and selection.
- Invalid or oversized URL values fall back to a valid default without breaking the page.
- Filtering changes the reading projection only; it never mutates the semantic source graph.
- Static graph layout remains stable when runtime overlay changes.

Completion evidence (2026-09-03): route state is bounded and validated in
`src/visualizer/client-route-state.ts`; projection filtering and graph reading tests pass in
`tests/visualizer-graph-reading.test.mjs` and the Visualizer client state suite.

### VIZ-04 Build workspace focus

Status: `done`
Owner: Codex
Dependency: VIZ-03
Targets: `src/visualizer/client-renderers.ts`, `src/visualizer/client-app.ts`, page shell styles,
browser tests

Define Build's primary workflow as the graph workspace, with Source, Diagnostics, and Readiness as
supporting panels. Keep authoring, validation, save, and quick-debug reachable without losing the
current graph context.

Acceptance:

- The first Build viewport gives the graph workspace the dominant area.
- Source, Diagnostics, and Readiness remain discoverable and usable at narrow widths.
- Dirty state, validation errors, and save/revert behavior remain correct.
- Existing design-release validation passes.

Completion evidence (2026-09-03): existing Build graph workspace, Source, Diagnostics, Readiness,
authoring, validation, save/revert, and narrow-layout browser coverage pass in the Visualizer gate.

### VIZ-05 Operate workspace focus

Status: `done`
Owner: Codex
Dependency: VIZ-03
Targets: `src/visualizer/client-lifecycle-panels.ts`, `src/visualizer/client-app.ts`,
`src/visualizer/ops-summary-projection.ts`, browser tests

Define selected-run health, failure location, and next actions as the primary Operate surface.
Logs, audit, resume diagnostics, and snapshot manifest remain drill-down views.

Acceptance:

- Selected run status, failure location, and next action are visible without opening raw logs.
- Resume blockers and pending review state are actionable.
- Drill-down panels preserve selected run and graph context.
- Existing operations summary and browser smoke tests pass.

Completion evidence (2026-09-03): selected-run health, failure triage, next actions, reviews,
resume drill-down, and artifact panels are covered by the existing Visualizer data/client/browser
tests and pass without losing run or graph context.

### VIZ-06 Long-running health and disk-growth signals

Status: `done`
Owner: Codex
Dependency: OPS-02, OPS-03
Targets: `src/visualizer/ops-summary-projection.ts`, DTOs/renderers, client tests

Expose `executionDirCount`, retention tier, and latest cleanup recommendation in the selected-run
health surface. Reuse existing runtime metrics and cleanup events; do not add another storage
counter.

Acceptance:

- Missing metrics degrade to an explicit unknown state, not zero when zero is not known.
- Retention configuration and observed count are displayed separately.
- Cleanup recommendation explains whether the threshold was exceeded and which action is available.
- No sensitive run artifact content is added to the summary projection.

Completion evidence (2026-09-03): operations summary projection and tests expose observed directory
count, retention tier, and cleanup recommendation with explicit unknown handling.

### VIZ-07 Provider readiness entrypoint

Status: `done`
Owner: Codex
Dependency: MODEL-01, MODEL-03
Targets: `src/runtime/doctor.ts`, Visualizer server/data DTOs, readiness renderer/client tests

Expose doctor `providerHealth[]` through the existing project/run readiness boundary. The UI must
distinguish skipped, failed, and successful checks, identify role/model where present, and link a
failed check to an actionable configuration or refresh operation.

Acceptance:

- The same provider health codes are preserved from doctor to DTO to UI.
- No online probe runs merely because the readiness panel is opened; online checks remain explicit.
- Missing catalog, unresolved selection, and connectivity failure have distinct presentation.
- Tests cover empty, skipped, success, and failure arrays.

Completion evidence (2026-09-03): `providerHealth[]` is preserved through readiness DTOs and UI
renderers; skipped, success, failure, missing catalog, and unresolved selection cases pass focused
readiness tests.

### VIZ-08 Recent run-log filter persistence

Status: `done`
Owner: Codex
Dependency: VIZ-03
Targets: `src/visualizer/client-lifecycle-state.ts`, `src/visualizer/client-app.ts`,
`src/visualizer/client-run-data-loaders.ts`, client-state tests

Persist or remember recent role, tail, page-size, and since filters using the existing route/local
state boundary. Do not persist arbitrary log content or credentials. Define whether state is URL,
session storage, or local storage based on shareability and privacy requirements.

Acceptance:

- Refreshing the same workbench restores the intended filter combination.
- Switching runs does not apply an invalid role filter from another project.
- Clear filters removes persisted state.
- Loading remains commit-on-change and does not fetch on every keystroke.

Completion evidence (2026-09-03): log role, tail, page size, and since state round-trip through the
URL route contract; changes commit on control change and clear correctly in client tests.

### VIZ-09 Conversation-style run projection

Status: `done`
Owner: Codex
Dependency: VIZ-03, existing timeline/event projection contract
Targets: `src/runtime/timeline-projector.ts`, `src/visualizer/run-query-service.ts`,
`src/visualizer/client-renderers.ts`, `src/visualizer/client-app.ts`, DTOs and browser tests

Add a conversation-style Operate view inspired by multi-role dialogue consoles. This is a generic
OGS projection for any responsibility graph; it must not introduce business-specific roles,
events, or chat semantics. The projection is derived from `events.ndjson` and runtime snapshots,
while the graph and runtime event history remain authoritative.

#### Data contract

The conversation projection is a read-only view model. It does not become a new runtime artifact
and must not be used as a resume source of truth.

```ts
type ConversationRouteChannel = "main" | "error" | "loop" | "join" | "feedback";

type LayoutPresentationChannel =
  | "primary"
  | "normal"
  | "join"
  | "error"
  | "loop"
  | "backEdge";

type ConversationRunStatus =
  | "running"
  | "stopping"
  | "waiting"
  | "done"
  | "failed"
  | "stopped"
  | "terminated";

type ConversationItemStatus =
  | "unknown"
  | "ok"
  | "noop"
  | "failed"
  | "active"
  | "waiting"
  | "waiting_review"
  | "completed"
  | "pending"
  | "paused"
  | "resolved"
  | "expired"
  | "activated"
  | "timed_out"
  | "running"
  | "done"
  | "stopped"
  | "terminated";

type ConversationSource =
  | {
      file: "events.ndjson";
      cursor: number;
    }
  | {
      file: "state.json";
      snapshotVersion: number;
    };

type ConversationRunProjection = {
  version: 1;
  runId: string;
  systemId: string;
  status: ConversationRunStatus;
  cursor: {
    next: number;
    hasMore: boolean;
  };
  items: ConversationItem[];
  filters: ConversationFilters;
};

type ConversationItem = {
  itemId: string;
  kind:
    | "role_message"
    | "route_decision"
    | "fan_out"
    | "join"
    | "loop_round"
    | "error_flow"
    | "human_review";
  roleId?: string;
  branchId?: string;
  lineageId?: string;
  loopIteration?: number;
  event?: string;
  status: ConversationItemStatus;
  at: string;
  durationMs?: number;
  content?: {
    text: string;
    redacted: boolean;
    truncated: boolean;
  };
  route?: {
    sourceRoleId?: string;
    targetRoleId?: string;
    channel: ConversationRouteChannel;
    presentationChannel: LayoutPresentationChannel;
    backEdge: boolean;
    condition?: string;
    outcome?: string;
  };
  join?: {
    joinRoleId: string;
    mode: "all_of" | "quorum_of";
    expected: string[];
    ready: string[];
    missing: string[];
    timedOut: boolean;
    finalAction?: string;
  };
  review?: {
    reviewId: string;
    reviewStatus: "pending" | "recorded" | "applied" | "expired";
    decision?: "approve" | "rework" | "pause" | "terminate";
  };
  source: ConversationSource;
};

type ConversationFilters = {
  roleId?: string;
  branchId?: string;
  lineageId?: string;
  loopIteration?: number;
  event?: string;
  status?: ConversationItemStatus;
  channel?: ConversationRouteChannel;
};
```

Route channels preserve conversation semantics; `presentationChannel` is the explicit adapter to
the Visualizer layout contract. The mapping is deterministic: `main -> primary`, `feedback ->
normal`, `join -> join`, `error -> error`, and an internal `loop -> loop`. A loop return edge maps
to `backEdge` and sets `backEdge: true`; all other routes set `backEdge: false`. The conversation
filter uses `channel`, while shared graph styling and edge presentation use
`presentationChannel`/`backEdge`. No consumer may infer this mapping from geometry or labels.

`reviewStatus` is the projection lifecycle: `pending` means no decision is recorded, `recorded`
means a decision is durable, `applied` means runtime apply/reconcile has incorporated it, and
`expired` is an explicitly persisted external lifecycle outcome. `decision` uses the runtime
`HumanReviewDecision` contract (`approve`, `rework`, `pause`, `terminate`) and is independent of
the lifecycle status. The projection must not emit `approved` or `rejected` as status values.

`ConversationItem.status` is normalized from known runtime status tokens into
`ConversationItemStatus`. A missing, malformed, or future token becomes `unknown`; the UI must
not infer a success, failure, or lifecycle phase from an unrecognized value. `ConversationRunStatus`
includes `waiting` as a Visualizer-derived view state (for example, a pending Join or human review),
not as a new persisted `GraphRunStatus` value and never as an input to runtime control APIs.

Contract rules:

- `roleId` identifies one responsibility seat; it never identifies a synthetic conversation
  participant. `branchId`, `lineageId`, and `loopIteration` preserve execution identity and must
  remain visible in detail views even when cards are grouped.
- `event` is the runtime transition event. `FEEDBACK` is only a flow event between existing
  responsibility seats; the projection must never create `a-feedback`, `b-feedback`, or any other
  feedback seat.
- `status` and `at` come from the authoritative event/snapshot projection. Status tokens are
  normalized to `ConversationItemStatus`; unknown values become `unknown` and are never guessed by
  the UI. Missing optional fields remain absent or explicitly unknown; the UI must not invent a
  successful state.
- `content.text` is already operator-safe content. Apply the existing redaction policy before the
  projection boundary, cap preview length, and set `redacted`/`truncated` independently. Never
  expose credentials, private workspace paths, unrestricted prompt/context data, or raw secrets.
- `source` is a typed locator: event and timeline records require `cursor`, while `state.json`
  snapshots require `snapshotVersion`. `itemId` must be stable for the same run event or snapshot
  observation and must support incremental de-duplication.
- Event/timeline projection ordering is authoritative cursor order, with timestamp only as a
  display field. Snapshot items are ordered by `snapshotVersion` and do not fabricate an event
  cursor. A malformed or duplicate source record is skipped or de-duplicated with a diagnostic; it
  must not reorder already displayed items.

#### UI behavior by flow type

- Sequential role execution renders a role-seat message card with role, event, status, content
  preview, branch/lineage metadata, and a source-locator affordance.
- Fan-out renders one expandable split group and child branch items. Child branches remain
  individually filterable and traceable; no parallel role is collapsed into an anonymous speaker.
- `all_of` and `quorum_of` Join render a Join control card with expected, ready, missing, timeout,
  and final-action state. A Join card is not a conversation participant and does not fabricate a
  message from a missing source.
- Loop execution renders explicit rounds grouped by `lineageId` and `loopIteration`. Repeated
  activations of one role remain separate items, while the graph continues to show one
  responsibility seat.
- Conditions render a route-decision item showing source role, candidate target, condition label,
  and evaluated outcome. The decision item links to the selected flow edge.
- Main, error, loop, Join, and feedback retain distinct semantic filter values. Their shared graph
  styling uses the explicit `presentationChannel` mapping above; loop return edges additionally
  use `backEdge`.
  Error-flow items show error code/category and handled/unhandled outcome when available.
- Human review renders a control-plane item with `reviewId`, review status, decision, and next
  action. It must not be rendered as ordinary role output.

#### Execution:

- Define a conversation item contract with `roleId`, `branchId`, `lineageId`, `loopIteration`,
  runtime `event`, timestamp, duration, controlled status, redacted content preview, and source
  locator.
- Render each item as a responsibility-seat message card linked to its source and target flow;
  `FEEDBACK` remains a transition event between existing seats and never creates a feedback seat.
- Group fan-out as one split with child branches; group `all_of`/`quorum_of` as Join cards showing
  expected, ready, missing, timeout, and final action instead of fabricating a chat participant.
- Group loop iterations into explicit rounds and show conditions as route decisions with the
  evaluated outcome. Render human review as a control-plane card, not as a role message.
- Support filtering by role, route, branch, lineage, loop iteration, status, and
  main/error/loop/join/feedback channels; preserve deep links to the graph node and raw event or
  snapshot locator.
- Keep content redaction and payload-size limits aligned with the existing operator projection;
  do not expose credentials, private workspace paths, or unrestricted prompt/context data.
- Update the live timeline path incrementally using `cursor.next`; append only records after the
  last acknowledged cursor, de-duplicate by `itemId`/source locator, and preserve the existing
  reconnect behavior. New conversation items must not trigger a full run reload or static graph
  re-layout.
- Selecting a card highlights its responsibility seat and, when `route` is present, its source and
  target edge in the graph. Selecting a graph role/edge scrolls to and filters the corresponding
  conversation items without mutating the graph.
- Filters combine deterministically, are reflected in the URL or approved local state contract,
  and can be cleared without leaving stale role/branch filters on another run.
- Source-locator navigation opens the matching timeline/event or snapshot detail and preserves run,
  graph, branch, lineage, and loop context for audit tracing.

Acceptance:

- A generic sequential, fan-out/Join, loop, error-flow, and human-review fixture renders without
  adding synthetic responsibility seats.
- Every displayed message can be traced to an event/timeline cursor or persisted snapshot version.
- Branches and repeated activations of one role remain distinguishable while the UI labels the
  role as one responsibility seat.
- Join readiness, loop iteration, route decision, review state, and runtime failure are visually
  distinct from ordinary role output.
- Redaction, truncation, ordering, malformed-event, duplicate-event, and incremental-cursor
  behavior have focused tests.
- Generic fixtures cover sequential flow, fan-out, `all_of` Join, `quorum_of` Join, loop rounds,
  conditional route selection, main/error/loop/join/feedback channels,
  presentation-channel mapping, and pending/recorded/applied human review with
  approve/rework/pause/terminate decisions. No fixture introduces a synthetic feedback seat.
- Tests cover content redaction, maximum preview truncation, stable ordering, missing optional
  metadata, unknown status normalization, event/timeline cursor traceability, and snapshot-version
  traceability.
- Wide and narrow browser screenshots verify readable message grouping and no overlap with the
  graph, filters, or run controls; screenshots also cover graph-to-conversation selection and a
  live incremental update.

Completion evidence (2026-09-03): read-only projector, API endpoint, route/channel filters,
redaction/truncation, source locators, review/Join/loop/error semantics, incremental cursor merge,
and no-synthetic-feedback behavior are covered by `tests/conversation-projector.test.mjs`,
`tests/visualizer-client-state.test.mjs`, and `tests/visualizer.test.mjs`; Visualizer browser smoke
and full regression gates pass.

Verification:

```bash
pnpm run build
pnpm run test:visualizer
pnpm run test:visualizer-browser
```

Evidence: conversation projection fixtures, DTO snapshots, browser screenshots, and a delivery
record linked from `docs/README.md`.

## 7. P2 Policy And Deferred Work

### P2-01 Released CLI upgrade and deprecation policy

Status: `done`
Owner: Codex
Dependency: product release posture
Targets: `README.md`, `docs/usage/usage-manual.md`, new policy section or development policy doc,
CLI help/tests

Define supported release versions, compatibility window, deprecation notice period, removal rules,
config/schema migration behavior, and the difference between development-test and released CLI
contracts.

Acceptance:

- A released CLI can identify its compatibility window and unsupported inputs.
- Deprecation messages include replacement syntax and removal timing.
- Current `vNext-dev` boundaries remain explicit.
- CLI help and active docs agree; archive docs are not changed for historical accuracy.

Verification:

~~~bash
pnpm run build
node --test tests/cli-help.test.mjs
pnpm run test:docs-command-drift
git diff --check
~~~

Result: active policy, README, usage manual, CLI help, and focused help tests are synchronized.
The current `0.3.0` development-test package remains outside the released compatibility window;
no migration command or cross-version resume guarantee was added.

### P2-02 Semantic-compatible resume

Status: `blocked by explicit current boundary`
Owner: TBD
Dependency: product decision to change strict fingerprint policy
Targets: `src/runtime/plan-fingerprint.ts`, resume validation, migration tests, semantics docs

The current development-test contract is strict fail-closed resume. The semantic-gap plan explicitly
defers tolerant fingerprints and degraded recovery. Keep this item in design-only status until a
product decision authorizes changing that boundary.

Acceptance for a future design only:

- Compatibility classes, data-loss semantics, audit wording, and operator confirmation are defined.
- No implementation weakens current resume validation implicitly.
- Old-run migration and rollback behavior are specified before code changes.

### P2-03 Distributed lock provider

Status: `blocked / out of current mainline`
Owner: TBD
Dependency: supported multi-host product boundary and external persistence choice
Targets: future lock-provider module and contract tests

Do not implement in the current mainline. The runtime currently provides same-host resume
coordination, while Redis/DB cross-host locking is explicitly deferred. Reopen only with a concrete
deployment target, lease/expiry contract, failure model, and operational owner.

### P2-04 Shared-storage multi-instance scheduling

Status: `blocked / out of current mainline`
Owner: TBD
Dependency: P2-03 decision, shared-storage deployment requirements

Do not implement in the current mainline. A future plan must first define run claim ownership,
heartbeat/lease expiry, duplicate execution prevention, fencing, recovery, and artifact consistency.

### P2-05 Checkpoint compaction decision

Status: `data-gated`
Owner: TBD
Dependency: PERF-01, PERF-02
Targets: benchmark records, future checkpoint format design

Do not change checkpoint format based on intuition. Advance only when benchmark data demonstrates
that replay time or storage growth is material and compaction can preserve resume truth, audit
ordering, fingerprint validation, and crash recovery.

Acceptance for the decision:

- Current checkpoint count/size and replay cost are measured.
- A compacted representation and crash-recovery protocol are designed.
- Migration, rollback, and mixed-format handling are defined.
- A benchmark demonstrates a material benefit before implementation begins.

## 8. Explicitly Out Of Scope

The following remain outside this plan and must not be pulled in as incidental work:

- plugin and hook ecosystem;
- a new scheduler layer;
- multiple persistence backends;
- external secrets manager integration;
- breaking `vNext-dev` proposals;
- new DSL keywords or broader semantic expression language;
- physical concurrency for `parallel_split` without a separate execution-policy decision.

## 9. Delivery Record Template

Copy this section into a dated delivery record when a batch is complete:

```text
Task IDs:
Date:
Owner:
Branch / commit range:
Scope:
Decisions used:
Changed files:
Tests and commands:
Results:
Benchmark / screenshot artifacts:
Known residual risk:
Follow-up task IDs:
Backlog reconciliation:
Release decision:
```

When all tasks in a batch pass their acceptance gates, update
[`todo-backlog.md`](todo-backlog.md), add a dated record under
`docs/development/archive/delivery/`, and update the documentation index.
