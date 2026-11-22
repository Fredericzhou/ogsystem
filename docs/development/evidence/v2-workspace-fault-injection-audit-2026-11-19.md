# V2 Workspace Scenario 19 Engineering Audit

> **Evidence type: engineering audit only.** This record does not close the Scenario 19 UAT row.
> A formal companion Project/Task/Run, operator evidence, and product-owner sign-off are still
> required before the row can move from `Not run` or `Blocked`.

## Source and command

- Contract source: [`v2-workspace-contracts.md`](../v2-workspace-contracts.md)
- UAT row: [`release-uat-checklist.md`](../release-uat-checklist.md), Scenario 19
- Date: 2026-11-19
- Build: `pnpm build`
- Deterministic checks:
  `node --test tests/workspace-contracts.test.mjs tests/workspace-coordinator.test.mjs tests/git-collaboration.test.mjs tests/v2-execution-policy.test.mjs tests/model-readiness-contract.test.mjs`
  (40 passed, including post-CAS Release reconciliation)
- Projection checks:
  `node --test tests/optional-context-projection.test.mjs tests/context-selector.test.mjs tests/transition-orphan-join.test.mjs`
  (11 passed)
- Evidence Manifest: Project Run completion writes the Run-owned manifest; the active Run query store
  verifies its digest, owner, contained references, and referenced event identity. Covered by
  `tests/workspace-coordinator.test.mjs` and `apps/team-site/tests/run-evidence-manifest.test.mjs`.

## Implementation follow-up

- Project Run cleanup is available at
  `POST /api/v2/projects/{projectId}/tasks/{taskId}/runs/{runId}/cleanup`. The use case holds the
  Project write lock, verifies Project/Task/Run ownership, Workspace identity, terminal Run state,
  and expected canonical HEAD before calling `WorkspaceCoordinator`. The transport returns counts,
  not filesystem paths; callers can read the retained manifest through the existing manifest API.
- `apps/team-site/tests/runtime-project-workspace-cleanup.test.mjs` uses a temporary real Git + LFS
  repository and verifies the cleanup removes the Run worktree while retaining the unmerged branch,
  commit, and canonical HEAD. Route and use-case checks also cover owner, Workspace, and terminal
  state rejection.
- Latest full `pnpm test`: core 471 passed / 1 Windows-only skipped; Team Site 68 passed.
- This remains engineering evidence: no formal Project/Task/Run fault companion, retained-manifest
  browser/API review, or product-owner sign-off has been recorded for Scenario 19.

## Case matrix

| Required case | Current engineering evidence | Current gap |
| --- | --- | --- |
| Readiness | `tests/model-readiness-contract.test.mjs` and `tests/v2-execution-policy.test.mjs` verify fail-closed model, tool, resource, and path readiness. | No formal Project/Task companion Run or operator record. |
| Unauthorized WorkspaceRef | `role-input-projector.ts` emits `WORKSPACE_REF_UNAUTHORIZED`; active projection tests cover unauthorized selectors. | No current WorkspaceRef allow-set companion Run proving denial and durable Run evidence. |
| Join conflict | `tests/git-collaboration.test.mjs` verifies `conflict`, no `mergeCommit`, and unresolved conflict paths; prior deterministic evidence records unchanged canonical HEAD. | No formal Project/Task/Run conflict companion evidence. |
| Checkpoint interruption | Graph Runner has the crash window and recovery reconciliation path. | No current non-archive test or formal Run proving interruption, resume, and no duplicate committed Role execution. |
| LFS interruption | `tests/git-collaboration.test.mjs` verifies missing LFS object rejection with `WORKSPACE_LFS_UNAVAILABLE`; Workspace coordinator tests verify valid LFS materialization. | Missing-object rejection is not an interruption/recovery companion Run. |
| Stale head | Lock tests verify `WORKSPACE_LOCK_STALE_HEAD`; coordinator test verifies an external `git update-ref` is rejected while the lock is held. | No formal Project/Task/Run ledger or sign-off. |
| Materialization failure | Workspace contract test verifies a failed materialization persists `MATERIALIZATION_FAILED` and no `downloadReference`. | No formal Project/Task/Run failure and retry evidence. |
| Reconciliation | `WorkspaceReleaseService.reconcile` verifies persisted manifest/output; `WorkspaceCoordinator.reconcileRelease` finalizes only after canonical HEAD already equals `releaseCommit`, after checking the owning Run and Workspace. Retrying the existing `workspace.release` lifecycle reconciles the post-CAS interruption. A regression confirms reconciliation cannot perform a CAS while HEAD remains `expectedCanonicalHead`. | No formal Project/Task/Run companion evidence or sign-off. |
| External ref write | Coordinator test advances `refs/heads/main` externally and verifies the guarded update fails closed with `WORKSPACE_LOCK_STALE_HEAD`; external HEAD remains authoritative. | No formal Project/Task/Run companion evidence or sign-off. |
| Cleanup and retention | `removeWorktree()` removes a checkout without deleting its branch. `WorkspaceCoordinator.cleanupMergedRunBranches()` scopes cleanup to the owning terminal Run, removes its worktrees, and prunes only branch commits already reachable from canonical HEAD under a live canonical lock. Coordinator and runtime integration tests prove a held lock blocks cleanup, an unmerged candidate ref and commit remain available, and the Run worktree is removed. A new regression advances canonical HEAD during checkout removal: cleanup then fails stale-head, retains the candidate ref/commit and Run Evidence Manifest/events, and rebuilds the worktree from the candidate commit. Live browser/API engineering evidence records a completed Project Run, successful owner-checked cleanup, and post-cleanup Manifest/events/Run readback in [`v2-workspace-cleanup-live-run-2026-11-19.md`](v2-workspace-cleanup-live-run-2026-11-19.md). | One cleanup companion Run is recorded; the other fault cases, retained unmerged-candidate live companion evidence, workflow-operator review, and product-owner sign-off remain outstanding. |

## Release decision

These results are implementation evidence and must not be copied into the formal UAT status as
`Pass`. Scenario 19 covers ten cases and remains open until every case has a real companion Run (or an explicitly
recorded environment blocker), recovery evidence, and the required sign-offs.
