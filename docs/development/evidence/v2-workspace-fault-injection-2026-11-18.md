# V2 Workspace Fault Injection Engineering Evidence

> This record contains local deterministic engineering checks against the Workspace contract
> implementation. It does not close the companion Run UAT row: each required case still needs a
> real Project, Task, Run, operator evidence, and product-owner sign-off.

## Environment

- Date: 2026-11-18
- Execution: temporary local Git repositories and Framework APIs
- Evidence type: fail-closed and recovery behavior check
- Source of truth: `docs/development/v2-workspace-contracts.md`

## Results

| Contract case | Observed result |
| --- | --- |
| Stale canonical head | Guarded mutation rejected with `WORKSPACE_LOCK_STALE_HEAD`; no canonical ref change. |
| Owner or fencing mismatch | Mutation rejected with `WORKSPACE_LOCK_OWNER_MISMATCH`; the existing lock remained authoritative. |
| Expired canonical lease | Expired lock was reclaimed through the fencing path before a new owner acquired it. |
| Join conflict | `join_conflict` returned with `mergeCommit = null`; the canonical HEAD was unchanged. |
| Materialization failure | Release entered `failed` with `MATERIALIZATION_FAILED`; no download reference was exposed. |
| WorkspaceRef workspace mismatch | Read rejected with `WORKSPACE_REF_WORKSPACE_MISMATCH`; no file content was returned. |
| WorkspaceRef digest mismatch | Read rejected with `WORKSPACE_REF_DIGEST_MISMATCH`; no unverified content was returned. |
| Missing Git LFS object | A valid LFS configuration with a missing object failed closed with `WORKSPACE_LFS_UNAVAILABLE`. |

## Acceptance boundary

These checks provide implementation evidence for lock fencing, Join isolation, Release failure
handling, WorkspaceRef authorization and digest verification, and LFS fail-closed behavior. They do
not prove the real-team Project workflows, browser refresh behavior, device accessibility checks,
or the required operator and product-owner signatures.
