# Runtime Resilience Validation Plan

Date: 2026-04-11  
Status: completed  
Scope: post-P0 runtime hardening validation and low-complexity resilience improvements  
Source: follow-up review after commits `1e9b080` and `643d741`; implemented by commits after this plan

## 1. Goal

The current runtime already closes the main P0 correctness gaps:

- runtime-loaded resume fingerprint
- branch-aware session identity
- durable `execution-outcome.json` marker
- checkpoint reconciliation on resume
- scheduler-aware recursion budget
- buffered artifact flush hardening

This plan does not try to redesign the runtime again.

The goal is narrower:

- increase confidence that the new recovery model works under real failure modes
- add only the minimum new runtime mechanism that materially improves safety
- avoid introducing new durable state, new recovery branches, or new operator burden unless strictly necessary

## 2. Execution Result

Completed:

1. `R0.1` end-to-end crash fault-injection drill
2. `R0.2` session isolation verification at transport/session-memory layer
3. `R0.3` advisory single-run resume lock for `--resume-run`
4. `R0.4` WAL replay benchmark script and baseline note

Artifacts added or updated:

- `tests/runtime-fault-injection.test.mjs`
- `tests/resume-session.test.mjs`
- `tests/opencode-executor.test.mjs`
- `tests/graph-runtime.integration.test.mjs`
- `tests/benchmarks/runtime-replay-benchmark.mjs`
- `docs/runtime-replay-benchmark-2026-04-11.md`
- `docs/usage-manual.md`

Observed replay baseline on this machine:

- command: `npm run bench:runtime-replay`
- platform: `darwin`
- node: `v20.20.0`
- restored checkpoint sequence: `490`
- total checkpoint files: `500`
- pending checkpoint files: `10`
- `stateLoadMs`: `1.602`
- `checkpointLoadMs`: `1.025`
- `resumeTotalMs`: `42.262`

## 3. Decision Summary

Approved now:

1. End-to-end crash fault-injection drill for the outcome/checkpoint gap
2. Session isolation verification focused on model-context isolation, not file-system isolation
3. Advisory single-run resume lock for `--resume-run`
4. WAL replay performance benchmark and baseline

Explicitly not approved now:

1. Branch-specific private workspaces or per-branch file-system isolation
2. CRLF/LF normalization in fingerprint identity
3. Automatic checkpoint compaction / snapshot rotation
4. Generic fault-injection framework or broad hidden runtime debug surface

## 4. Guiding Principles

1. Prefer tests over mechanisms.
If a risk can be closed by stronger automated validation, do that before adding new runtime behavior.

2. Keep the runtime file-first.
`state.json`, `sessions.json`, `plan-fingerprint.json`, `checkpoints/`, and `execution-outcome.json` remain the recovery authority set.

3. Preserve the current isolation boundary.
The runtime guarantees model-session isolation across sibling branches of the same role.
It does not guarantee branch-specific file-system isolation inside the same role directory.

4. Measure before optimizing.
Do not add compaction, background workers, or extra indexes until benchmarks show replay cost is a real problem.

5. Prefer narrow, explicit, reversible changes.
Small one-purpose hooks are acceptable.
Generic subsystems that create more state and more branches are not.

## 5. Approved Work Items

### R0.1 End-to-End Crash Fault Injection

Problem:
We already test resume replay from persisted artifacts, but we still need one true end-to-end drill where the process dies after durable outcome commit and before checkpoint persistence.

Why this is worth doing:

- high confidence gain
- mostly test complexity, not runtime complexity
- directly validates the most important crash-idempotency invariant

Recommended implementation:

1. Add one narrowly scoped, one-shot failpoint around the gap between:
   - durable `persistCommittedExecutionResult(...)`
   - `persistRuntimeCheckpoint(...)`
2. Trigger it only under an explicit test-only environment variable.
3. Drive the scenario from a child-process test harness:
   - first run exits intentionally
   - second run resumes from the same `runDir`
4. Assert:
   - no extra execution directory is created
   - audit trail count does not double
   - final output is correct
   - `execution-outcome.json` is reconciled with a checkpoint after resume

Best-practice constraints:

- do not introduce a generic failpoint framework
- do not keep the failpoint enabled outside explicit tests
- do not add any new runtime authority file for this

Acceptance:

- a forced crash after outcome commit but before checkpoint emission resumes without re-executing the role
- repeated resume remains idempotent

Suggested test location:

- `tests/runtime-fault-injection.test.mjs`

### R0.2 Session Isolation Verification

Problem:
The current session model is now keyed by `${roleId}:${sessionLineageId}`, but we should verify the isolation contract more directly.

Important boundary:

- required guarantee: sibling branches must not share model conversation state
- non-goal: sibling branches must not be isolated at the file-system level

Why file-system isolation is not the right target:

- same-role branches currently share the same role directory and private workspace by design
- that shared workspace is part of the current collaboration model
- forcing branch-private directories would change the architecture, not merely validate it

Recommended implementation:

1. Build the verification at the OpenCode transport/session layer, not via files or environment variables.
2. Use a fake or stub transport that keeps per-session memory.
3. Run two sibling branches of the same role.
4. Make branch A write a session-local marker through the fake model session.
5. Make branch B try to read it.
6. Assert branch B cannot see branch A's marker unless both calls use the same `sessionId`.

Best-practice constraints:

- test model-context isolation, not shared-directory behavior
- do not add per-branch role directories
- do not add new session persistence files

Acceptance:

- sibling branches of the same role receive different session identities
- session-local memory does not bleed across sibling branches
- lineage-stable continuation still reuses the same session

Suggested test locations:

- `tests/graph-runtime.integration.test.mjs`
- `tests/session-recovery.test.mjs`
- optionally `tests/opencode-executor.test.mjs` with a stub transport

### R0.3 Advisory Resume Lock

Problem:
`--resume-run` against the same `runDir` from two terminals is still unsafe.
That is a real runtime hazard, not just a test gap.

Why this is worth doing:

- small runtime complexity increase
- large safety improvement
- prevents a class of operator mistakes that recovery logic cannot safely merge

Recommended implementation:

1. On runtime initialization for a resumed run, create a lock file under `runDir` using atomic create semantics.
2. Store minimal metadata:
   - `pid`
   - `hostname`
   - `acquiredAt`
   - `command`
3. If the lock already exists:
   - if same host and the process is alive, fail fast with a stable runtime error
   - if the process is dead, treat it as stale and replace it
4. Release the lock on normal shutdown in `finally`.

Best-practice constraints:

- advisory lock only; no waiting queue, no background renewer
- no lock server, no Redis, no cross-host coordination
- stale-lock takeover must be explicit and deterministic

Acceptance:

- second concurrent `--resume-run` on the same host fails fast with a stable error envelope
- stale lock from a dead process does not permanently brick the run directory

Suggested main touch points:

- `src/runtime/run-artifacts.ts`
- `src/runtime/adapter.ts`
- `tests/resume-session.test.mjs`

### R0.4 WAL Replay Performance Benchmark

Problem:
Checkpoint replay is correct, but we do not yet have a measured baseline for long-loop resume cost.

Why this is worth doing:

- creates evidence before optimization
- low implementation risk
- avoids speculative complexity such as checkpoint compaction

Recommended implementation:

1. Build a deterministic benchmark scenario:
   - loop budget around `500`
   - crash near the tail
   - resume from the same run directory
2. Measure:
   - time to load resume state
   - time to replay pending checkpoints
   - time to first resumed execution or terminal result
3. Record the numbers in test output or a benchmark note.
4. Keep this out of strict CI pass/fail unless the threshold is generous and stable.

Best-practice constraints:

- benchmark first
- no automatic compaction yet
- no extra snapshot file classes yet

Escalation trigger:

Only if replay time becomes materially bad under realistic workloads should we consider:

- periodic snapshot compaction
- checkpoint archival
- more incremental replay indexing

Suggested deliverable:

- one benchmark script or non-blocking performance test
- one short note in docs with the observed baseline

## 6. Deferred Items

These ideas are intentionally deferred because they currently increase complexity more than they improve reliability.

### D1. Branch-Private File-System Isolation

Rejected for now.

Reason:

- changes the role workspace contract
- breaks the current same-role shared-sandbox model
- introduces a much larger migration and documentation surface

### D2. Newline Normalization in Fingerprint Identity

Rejected for now.

Reason:

- can mask real content drift
- adds subtle portability rules to a safety-critical identity check
- current supported guarantee should remain: path movement is allowed when loaded content is unchanged

Recommended doc stance:

- `sourceHints` are diagnostic-only
- content identity, not path identity, governs resume safety
- cross-platform line-ending portability is not yet an explicit resume contract

### D3. Automatic Checkpoint Compaction

Rejected for now.

Reason:

- adds new state transitions and new recovery branches
- not justified until replay benchmarks show a real bottleneck

## 7. Delivery Order

1. `R0.1` crash fault-injection drill
2. `R0.3` advisory resume lock
3. `R0.2` session isolation verification
4. `R0.4` WAL replay benchmark

Reasoning:

- `R0.1` validates the highest-value recovery invariant
- `R0.3` closes a real operator hazard
- `R0.2` improves confidence but mostly extends tests, not safety-critical runtime behavior
- `R0.4` should be informed by the final stabilized behavior, not drive premature design

## 8. Test and Release Gate

Per item:

- `npm run build`
- targeted tests for the touched area

Before merge:

- `npm run test:runtime-regression`
- `npm run test:fault-injection`
- `npm test`

For benchmark-only work:

- do not fail normal CI on machine-sensitive timing unless the bound is intentionally loose

## 9. Expected Outcome

After this plan, the runtime should have:

- stronger evidence that resume recovery survives real kill-window failures
- clearer proof that same-role sibling branches do not share model context
- protection against accidental concurrent resume on the same run directory
- an evidence-based performance baseline for long replay paths

And it should still avoid:

- new durable authority files
- new background services
- cross-branch workspace redesign
- speculative performance mechanisms
