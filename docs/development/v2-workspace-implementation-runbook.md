# V2 Workspace Implementation Runbook

> **Status: implementation and operations guide.** This document does not define Workspace fields,
> states, events, or APIs. Use [`v2-workspace-contracts.md`](v2-workspace-contracts.md) for those
> contracts and [`v2-workspace-collaboration-design-and-acceptance.md`](v2-workspace-collaboration-design-and-acceptance.md)
> for target behavior.

## 1. Before Coding

1. Read `ogsystem-constitution-v2.md` and `DECISIONS.md`; confirm the governance and direct replacement constraints.
2. Read `role-execution-architecture.md` and assign each change to Business, Technical Binding,
   Execution, or Evidence ownership.
3. Read `v2-workspace-contracts.md`; do not create a local field, state, event, or API variant.
4. Record the affected acceptance rows in `v2-validation-and-acceptance.md` and
   `release-uat-checklist.md`.

## 2. Implementation Sequence

1. Add or update typed schemas and validators from the Workspace contract.
2. Add Git and Git LFS capability probes and fail closed when the required boundary is unavailable.
3. Route commit, merge, restore, LFS, canonical ref, and lock mutations through Framework services.
4. Persist checkpoints, commit provenance, evidence events, and recovery identities.
5. Implement candidate merge and conflict handling without changing the canonical ref on conflict.
6. Implement Release materialization and the `prepared -> materialized -> ref_updated -> published`
   reconciliation path.
7. Implement idempotent worktree cleanup and retention-aware ref/object cleanup.
8. Give each Studio Simulation its own persisted Git + LFS Workspace under the simulation evidence
   boundary and route Role, merge, and Release mutations through the same Framework coordinator.
   Treat that Workspace as an internal simulation execution boundary under the Workspace contract;
   it is not a Project Workspace binding or Project WorkspaceRef. Project collaboration output
   remains owned by its formal Task and Run.
9. Keep old content-reference and promotion names out of public architecture, schemas, APIs,
   checkpoints, and UI from the start. A private internal transition symbol may remain only behind
   the DTO/API boundary; it must not enter a checkpoint or public schema.

## 2.1 Contract and Acceptance Traceability

Each implementation change must cite the applicable contract clause and acceptance target in its
work item. This table is the minimum mapping for the sequence above; a work item may narrow the
scope, but must not replace these authorities.

| Implementation area | Contract authority | Acceptance target |
| --- | --- | --- |
| Schemas, validators, and WorkspaceRef authorization | Workspace Contracts §§1-2, 9 | Validation and Acceptance Gates A-B; Release UAT scenarios 14 and 19 |
| Git/LFS capability checks and Role commits | Workspace Contracts §§3, 7-8 | Workspace Design §11 Git LFS; Validation and Acceptance Gate B; Release UAT scenario 19 |
| Canonical refs, locks, restore, and fencing | Workspace Contracts §4 and §8 | Workspace Design §11 Canonical lock and recovery; Release UAT scenario 19 |
| Checkpoints, provenance, and recovery identity | Workspace Contracts §§3, 7 | Workspace Design §11 Canonical lock and recovery; Validation and Acceptance Gate B; Release UAT scenarios 7 and 19 |
| Candidate merge and conflict handling | Workspace Contracts §§7-8 | Workspace Design §11 Parallel and conflict behavior; Validation and Acceptance Gate A; Release UAT scenarios 5 and 19 |
| Workspace Release/Materialization and reconciliation | Workspace Contracts §§5-6, 8 | Workspace Design §11 Framework Release and Materialization; Validation and Acceptance Gate C; Release UAT scenarios 16 and 19 |
| Worktree, ref, and object cleanup | Workspace Contracts §§3-4, 8 | Workspace Design §11 Worktree cleanup and retention; Release UAT scenario 19; Project Run cleanup operation |
| Studio Simulation Workspace isolation | Workspace Contracts §1 | Validation and Acceptance Gate B; Release UAT scenarios 12-13 |
| Public legacy-surface cleanup | Workspace Contracts §9 | Validation and Acceptance §0 Documentation and Contract Freeze Gate; Release UAT freeze-gate row |

## 3. Operational Checks

Before a Run:

- verify the repository is Git-backed and LFS-capable;
- verify the Project has one Workspace and a known canonical head;
- verify the Role's WorkspaceRef allow-set and worktree staging boundary;
- record `baseCommit` and the resolved Run identity.

After a Run reaches a terminal state, invoke cleanup with
`POST /api/v2/projects/{projectId}/tasks/{taskId}/runs/{runId}/cleanup`, passing the owning
`workspaceId` and current `expectedCanonicalHead`. The API verifies Task/Run ownership, terminal state,
and Workspace identity, then returns removed worktree and branch counts without exposing local paths.
Read the retained Evidence Manifest with `GET /api/v2/projects/{projectId}/tasks/{taskId}/runs/{runId}/manifest`.
A stale head or active lock is retried only after reconciling the current canonical head.

During a Run:

- check expected canonical head before every guarded mutation;
- persist commit provenance before making a worktree eligible for cleanup;
- preserve conflicted or recoverable worktrees until the Run lifecycle permits cleanup;
- append evidence through the existing event boundary.

Fault injection and recovery checks:

- interrupt after a Role commit and before checkpoint persistence;
- interrupt during LFS upload or candidate merge;
- expire the canonical lock lease and verify fencing;
- advance the canonical head before a guarded mutation and verify stale-head failure;
- interrupt after canonical ref update and before Release finalization;
- finalize materialization before Release metadata persistence and reconcile by digest.

Record each injected failure and recovery result using the contract records and the acceptance
scenario that owns it. An injected event or unit test alone does not close an acceptance row.

During Release:

- materialize from the recorded `releaseCommit`;
- verify the Materialization manifest and output digest;
- acquire the canonical lock only for the canonical-ref compare-and-swap and its tied
  `ref_updated`/`published` transitions; materialization preparation and verification do not hold it;
- complete the internal Workspace Release transition only after its record and verified
  Materialization fields satisfy the contract; Project files remain read through Task/Run outputs.

After failure:

- reconcile from checkpoint, commit, lock, Release, manifest, and evidence records;
- fence expired lock owners before reclaiming the lock;
- leave stale-head candidates recoverable or create a new candidate from the current head;
- never rewrite shared history or expose an unverified download.

## 4. Evidence Collection

Attach reproducible Project/Task/Run IDs, commit IDs, checkpoint IDs, lock records, event evidence,
Framework manifest digests, and Task/Run output readback to the acceptance rows. Record Workspace
Release state only where needed to prove guarded ref updates or recovery; it is not the Project output
identity. Browser or API smoke checks do not replace a real Project/Task/Run workflow, real Backend
execution, or the required recovery scenarios.

## 5. Cleanup

Cleanup is idempotent and is scoped to a terminal Run. Remove only that Run's worktrees; acquire the
canonical Workspace lock before pruning refs; prune only commits already reachable from canonical
HEAD, and keep unmerged candidates available for recovery. Verify checkpoint, Release, manifest,
provenance, and evidence reads after cleanup. Git/LFS garbage collection is a separate retention
operation and must preserve objects referenced by retained records.

## 6. V2 Freeze Documentation Gate

Before implementation is declared ready, verify:

- each Workspace field, state, and event has one authoritative definition;
- public architecture, schemas, APIs, checkpoints, and UI expose no legacy content-reference model;
- each implementation task maps to a contract clause and an acceptance scenario;
- this Runbook contains no architecture decision or unreviewed model, field, state, or API.
