# Runtime Remediation Plan

Date: 2026-04-11
Scope: `src/runtime/*`
Source: review of commit `81a4807` (`Harden runtime recovery and branch execution`)
Goal: close the remaining correctness gaps in resume compatibility, crash-idempotency, branch isolation, and scheduler budget handling.

## 1. Problem Statement

The previous hardening pass fixed many real risks, but 4 follow-up issues remain:

1. `--resume-run` fingerprinting is incomplete.
Current fingerprint only covers Mermaid-derived `SystemDefinition`, not loaded role package contents, model manifests, or effective law contents.
Result: changed prompt/schema/model manifest/law constraint can still slip through resume compatibility checks.

2. Same-role multi-branch execution still shares one model session.
Runtime state now supports `branchId`, but OpenCode session lookup is still keyed by `roleId`.
Result: sibling branches of the same role can contaminate each other’s model context.

3. Crash-idempotency is still incomplete.
Role result/session/audit files are persisted before runtime checkpoint WAL is written.
Result: crash in that window can still cause duplicate execution and repeated side effects on resume.

4. Scheduler hop increases LangGraph step count without adjusting recursion budget.
The new `__scheduler__` node adds extra graph steps, but `recursionLimit` still uses the old formula.
Result: long but valid runs may hit LangGraph recursion limit earlier than runtime transition budget.

## 2. Repair Principles

- Correctness before optimization: fix replay/compatibility/session semantics first.
- File-first durability: continue using filesystem WAL/checkpoint approach; do not introduce Redis/PG.
- Small-step verifiability: every fix must land with deterministic tests.
- No silent compatibility downgrade: any potentially unsafe resume must hard fail.
- Branch isolation is the default: same `roleId` on different active branches must not share mutable runtime context unless explicitly designed.

## 3. Target Outcomes

After this remediation:

- resume must fail when Mermaid graph, role package content, model manifest, or effective law content changes.
- same-role sibling branches must execute with isolated session keys and isolated persisted session metadata.
- resume after crash must not re-execute a role whose durable execution checkpoint already exists.
- LangGraph recursion budget must remain safely above worst-case scheduler-expanded execution steps.

## 4. Work Items

### P0.1 Expand Resume Fingerprint Coverage

Problem:
`buildRunPlanFingerprint()` only hashes Mermaid-compiled structure and binding IDs.

Changes:

- Replace current fingerprint payload with a runtime-level fingerprint:
  - normalized Mermaid `SystemDefinition`
  - runtime-loaded role package artifact set actually consumed by execution:
    - manifest content
    - prompt template
    - persona/work text
    - input/output schema content
  - runtime-loaded model package manifest content
  - runtime-loaded effective law constraints content
  - optional source path hints for diagnostics only, not identity
- Fingerprint the effective artifact set returned by the runtime loaders, not an arbitrary whole-directory glob.
- If a loader resolves multiple source files, hash the normalized file set actually loaded at runtime:
  - relative path
  - normalized content
  - deterministic ordering
- Generate fingerprint after loading role/model/law data, not before.
- Keep output file as `plan-fingerprint.json`, but bump fingerprint `version`.
- Improve mismatch error message to say which component class changed:
  - `system`
  - `rolePackages`
  - `modelPackages`
  - `effectiveLaw`

Acceptance:

- changing role prompt/schema without changing role ID must reject resume.
- changing model manifest without changing model ID must reject resume.
- changing law constraint content without changing `lawId` must reject resume.

Tests:

- add resume test: role package content drift rejects resume.
- add resume test: model manifest content drift rejects resume.
- add resume test: law constraint drift rejects resume.

### P0.2 Make Session Identity Branch-Aware

Problem:
session reuse is still keyed by `roleId`.

Changes:

- Introduce explicit `sessionKey` strategy:
  - default for single-instance role: stable per session branch lineage
  - do not reuse existing graph `lineageId` directly because sibling branches currently share it
  - introduce a dedicated `sessionLineageId`
  - standard concrete format: `${roleId}:${sessionLineageId}`
- Update:
  - `RoleExecutionRecord.sessionKey`
  - `OpencodeSessionRecord.sessionKey`
  - `BranchRecord.sessionLineageId`
  - session persistence / reload lookup
  - executor request path if needed for diagnostics
- Session reuse policy:
  - same `sessionLineageId` and same role may reuse session
  - different sibling branches of same role must not reuse session
- Preserve lineage-stable reuse:
  - downstream continuation on the same session branch lineage keeps the same session
  - sibling forked branches receive different `sessionLineageId` values and therefore different sessions
  - merge points may mint a new `sessionLineageId` when multiple sibling branches collapse into one downstream branch
- Keep role-level directory layout if desired, but session metadata must distinguish branch-local sessions.

Acceptance:

- one role executing twice on two sibling branches creates two independent sessions.
- resume on a partially completed multi-branch run restores the correct session per branch lineage.

Tests:

- add runtime test: same `roleId` on two sibling branches uses two session keys.
- add resume test: branch-local session is restored correctly after restart.

### P0.3 Close the Pre-WAL Crash Window

Problem:
`persistRoleResult()` and `persistRoleSession()` happen before `persistRuntimeCheckpoint()`.

Changes:

- Move durable execution dedupe anchor from graph loop to role execution boundary.
- Recommended implementation:
  - create execution-scoped durable marker in execution dir before side effects are considered committed
  - write a compact execution outcome record atomically inside execution dir
  - then emit checkpoint referencing that outcome
- Resume bootstrap must scan execution outcomes and reconcile any checkpoint gap:
  - if execution outcome exists but checkpoint is missing, reconstruct/apply the missing graph update without re-executing
  - if neither outcome nor checkpoint exists, execute normally
- Add explicit execution status model:
  - `prepared`
  - `committed`
  - optional `reconciled`
- Avoid depending only on `audit.json`/`result.json` presence as dedupe proof; use one explicit atomic file.

Acceptance:

- crash after role result persistence but before graph checkpoint must not cause duplicate execution on resume.
- checkpoint replay source must be deterministic and idempotent.

Tests:

- add simulated crash-window test: committed execution outcome with missing checkpoint is replayed, not re-executed.
- add idempotency test: repeated resume does not change execution count.

### P1.1 Recalculate Scheduler Recursion Budget

Problem:
`__scheduler__` added extra graph steps but recursion budget formula stayed unchanged.

Changes:

- Replace fixed `+20` padding with scheduler-aware formula.
- Recommended minimum:
  - `recursionLimit >= 2 * maxExpectedRoleTransitions + fixed_margin`
- When `effectiveLaw.maxTransitions` exists:
  - derive recursion limit from it directly with scheduler multiplier.
- When absent:
  - derive from a conservative runtime default that still accounts for scheduler hops.
- Document why this formula is safe.

Acceptance:

- bounded-loop example should not fail on LangGraph recursion limit before runtime transition budget.

Tests:

- add test covering a loop-heavy graph with scheduler-enabled execution.

### P1.2 Harden Buffered Flush Concurrency

Problem:
`flushBufferedRunArtifacts()` can clear `flushPromise` from an older chain while a newer flush is already queued.

Changes:

- capture local promise token and only clear when the current promise is still the active one.
- A small deferred/token guard pattern is an acceptable implementation as long as stale `finally` cleanup cannot clear a newer queued flush.
- add concurrent flush test with overlapping calls.

Acceptance:

- overlapping flush calls must serialize correctly and not lose pending batches.

## 5. Implementation Order

Order must be:

1. `P0.2` session identity isolation
Reason: current multi-branch model already exposes cross-branch contamination risk.

2. `P0.3` crash-window closure
Reason: prevents duplicate execution while we continue iterating on resume semantics.

3. `P0.1` full runtime fingerprint
Reason: once resume data model stabilizes, lock compatibility checks to actual runtime identity.

4. `P1.1` recursion budget correction

5. `P1.2` buffered flush concurrency hardening

## 6. File-Level Impact

Expected main touch points:

- `src/runtime/adapter.ts`
- `src/runtime/run-artifacts.ts`
- `src/runtime/role-executor.ts`
- `src/runtime/graph-runner.ts`
- `src/runtime/types.ts`
- `src/runtime/executor.ts`
- `tests/resume-session.test.mjs`
- `tests/session-recovery.test.mjs`
- `tests/graph-runtime.integration.test.mjs`
- `tests/runtime-fault-injection.test.mjs`

Potential secondary touch points:

- `src/runtime/graph-runtime-state.ts`
- `docs/archive/delivery/runtime-risk-assessment-2026-04-10.md`

## 7. Test Plan

Mandatory per change:

- `npm run build`
- targeted node tests for changed area

Mandatory before merge:

- `npm run test:runtime-regression`
- `npm run test:fault-injection`
- `npm test`

New tests to add:

- resume rejects role content drift
- resume rejects model manifest drift
- resume rejects effective law drift
- sibling branches of same role use isolated sessions
- crash-window replay consumes committed execution without re-run
- repeated resume remains idempotent
- concurrent buffered flush does not lose data
- recursion budget remains above scheduler-expanded step count

## 8. Commit Strategy

Recommended split:

1. `runtime: isolate sessions by branch lineage`
2. `runtime: reconcile committed executions on resume`
3. `runtime: fingerprint loaded runtime artifacts`
4. `runtime: harden recursion and buffered flush`
5. `docs: update risk assessment and remediation status`

If reduced to fewer commits, keep at least:

- one commit for correctness changes
- one commit for tests/docs

## 9. Done Criteria

This plan is complete only when all conditions hold:

- no unsafe resume path remains for content drift
- no same-role sibling branch shares model session state
- no duplicate execution occurs in the pre-checkpoint crash window
- scheduler recursion budget is explicitly justified and tested
- all new regressions are automated
- `docs/archive/delivery/runtime-risk-assessment-2026-04-10.md` is updated to reflect the remediation status
