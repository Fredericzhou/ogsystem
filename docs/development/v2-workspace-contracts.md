# V2 Workspace Contracts

> **Status: Contract Set v2 machine contract.** This is the sole normative source for Workspace
> fields, states, events, provenance records, and Workspace APIs. The collaboration design explains
> behavior; validation and UAT documents define evidence; the implementation runbook defines steps.
> This active contract is the normative target; it does not by itself assert that the V2 release
> gates or UAT sign-off have passed.

## 1. Authority and Invariants

These contracts implement the Constitution and decisions in [`DECISIONS.md`](DECISIONS.md), and
the boundaries in [`role-execution-architecture.md`](role-execution-architecture.md). They are
subordinate to the governance layer and architecture, and take precedence over examples in design,
acceptance, source, and historical records.

- A Project has exactly one Git + LFS Workspace.
- Git commit identity is the only Workspace content version fact.
- Git LFS stores large objects referenced by Git commits; it is not a second version system.
- Only Framework operations may mutate canonical refs, commits, branches, tags, or LFS locks.
- There is no migration reader, compatibility alias, dual-write path, or second Workspace backend.
- Public file boundaries are `WorkspaceRef`, Run evidence, and Run-owned collaboration outputs.
- The Framework-level Workspace Release state machine remains part of this contract for guarded
  ref updates and recovery. Release and Materialization records are not a Project publication
  lifecycle. Materialization records are Framework-private verification and recovery data used to
  generate and verify files from a recorded Commit; Project users access collaboration outputs
  through the owning Task and Run.
- The old shared content-reference and promotion vocabulary is not a V2 field, state, event, or API.

Every persisted record below carries the envelope fields:

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1
}
```

`ogsContractVersion` identifies the OGS contract set. `schemaVersion` identifies the concrete record
schema. Object-specific version fields remain independent where another active contract requires one.

### Project Workspace binding

The public collaboration Project API exposes this Workspace binding:

```json
{
  "workspaceId": "workspace-123",
  "workspaceBackend": "git-lfs"
}
```

Both fields are required. `workspaceId` identifies the Project's single Workspace and remains stable
for that Workspace's lifetime. `workspaceBackend` is fixed to `git-lfs`; it is descriptive and does
not select among pluggable Workspace backends. A Task and its Runs resolve the Workspace through
their owning Project. A local filesystem locator such as `workspaceDir` is not part of this public
binding and must not be returned as a filesystem path by the Project API.

### Studio Simulation workspace scope

Each Studio Simulation uses exactly one isolated Git + LFS Workspace inside its own simulation evidence
boundary. This is an internal execution and recovery boundary, not a second Project Workspace
backend or a new public Workspace record. A Simulation Workspace identity must not be used as a
Project `WorkspaceRef.workspaceId`, a Task Run collaboration output identity, or a cross-Project
public reference.
Simulation materialization is engineering or diagnostic evidence; Project collaboration outputs are
read through the owning Task and Run, as defined in the Workspace API section below.

## 2. WorkspaceRef

`WorkspaceRef` is the immutable, read-only reference that may cross a Role boundary.

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "workspaceId": "workspace-123",
  "commit": "full-immutable-commit-id",
  "path": "docs/report.md",
  "digest": "sha256:..."
}
```

Required constraints:

- `workspaceId` identifies the single Project Workspace.
- `commit` is a full immutable Git commit ID matching the repository object format. Branch names,
  tags, and symbolic refs are invalid.
- `path` is repository-relative, normalized, and contained in the committed tree. Absolute paths,
  traversal, and symlink escapes are invalid.
- `digest` is the digest of the referenced committed file content. Git LFS pointers are resolved and
  verified against the referenced LFS object before access.
- `WorkspaceRef` grants no write permission. The receiving Role's `HandoffProjection` and Framework
  policy authorize access.
- An uncommitted file cannot be represented by a `WorkspaceRef`.
- WorkspaceRef transfer is empty by default; only an explicit, authorized HandoffProjection may
  expose a reference to the receiving Role.

Workspace references are carried in the existing Role result and HandoffProjection under
`workspaceRefs`. `StoredRoleResult.workspaceRefs` is optional and contains only references produced
by the Framework after a committed Role result. `HandoffProjection.workspaceRefs` is an explicit
array of authorized references; an empty array transfers none. The receiving Role may resolve only
the references in that projection. These carrier fields do not add write authority or another
content-reference model.

Producer identity, source Run, source Role, and access decisions are recorded in Run evidence and
the `result_committed` event; they are not added to the reference value.

## 3. Checkpoint and Commit Provenance

A Role checkpoint contains workflow recovery state plus references to immutable repository facts.
The required shape is:

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "runId": "run-123",
  "nodeId": "backend-implementer",
  "attempt": 1,
  "status": "completed",
  "worktreeId": "wt-run-123-backend",
  "branch": "ogs/run-123/backend",
  "baseCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "roleCommit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "changedPaths": ["src/api.ts"],
  "branchId": "backend@1#1",
  "lineageId": "backend@1#1",
  "round": 1,
  "loopIteration": 1,
  "stateVersion": 3,
  "decisionBackground": {},
  "evidenceRefs": []
}
```

`roleCommit`, `mergeCommit`, and `releaseCommit` are mutually contextual references: a Role
checkpoint records `roleCommit`, a Join checkpoint records `mergeCommit`, and a Release checkpoint
records `releaseCommit`. A checkpoint may contain more than one when it records a completed transition.

`worktreePath` is not a recovery key. Recovery uses `worktreeId`, `branch`, and commit references.
Checkpoint writes are append-only and reconcile from Git when a commit exists but the checkpoint write
did not complete.

Checkpoint `status` uses the active Runtime workflow state for the recorded node. This Workspace
contract does not create a parallel checkpoint status enum.

Framework-created commits carry these trailers when the Git implementation supports trailers:

```text
Run-Id: run-123
Node-Id: backend-implementer
Checkpoint-Id: cp-456
Base-Commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

The bidirectional audit relationship is mandatory:

```text
Runtime checkpoint -> Git commit / LFS object
Git commit / LFS object -> Runtime checkpoint / provenance evidence
```

## 4. Canonical Workspace Lock

The canonical lock serializes authoritative ref mutations. Its required fields are:

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "workspaceId": "workspace-123",
  "owner": "run-123",
  "leaseUntil": "2026-11-18T10:00:00Z",
  "fencingToken": 7,
  "expectedCanonicalHead": "cccccccccccccccccccccccccccccccccccccccc"
}
```

The Framework must acquire the lock for canonical ref updates, restore, branch or tag updates,
cleanup that changes authoritative refs or LFS locks, and the canonical-ref CAS plus the Release
publication state transitions tied to that CAS. Materialization before the canonical-ref CAS does
not require this lock. Merge worktree creation and candidate integration do not require it.

Run cleanup removes only worktrees in the terminal Run's own namespace. Branch pruning is performed
under the canonical lock and only for refs whose commits are already ancestors of the canonical
HEAD; unmerged candidate refs remain available for recovery. Cleanup must leave checkpoint, Release,
manifest, provenance, and evidence records readable. Git/LFS object garbage collection is a separate
retention operation and must not remove objects referenced by retained evidence.

Within the Framework-level Workspace Release state machine, the `published` transition records only
the canonical-ref CAS and its tied `ref_updated` state. Preparing or verifying Materialization,
writing the Release record before the CAS, and reconciling a known post-CAS write failure are
separate record operations; they require the canonical lock only when they also perform an
authoritative ref or LFS-lock mutation.

For a no-content-change Release where `releaseCommit` equals `expectedCanonicalHead`, the Framework
still acquires the canonical lock, validates the expected head, and performs the guarded ref update
with the same old and new commit before transitioning to `ref_updated` and `published`. It does not
create a synthetic commit or skip the lock/CAS boundary.

Every guarded mutation validates the owner, unexpired lease, fencing token, and
`expectedCanonicalHead`. A stale head fails closed and leaves the candidate available for recovery or
rebase. A known Release write failure window is the only path into Release reconciliation.

An external authoritative ref write is detected by the expected-head check and fails closed.

## 5. Release

A Release is a publication record for one immutable `releaseCommit` and its materialized output. It
does not create another content version.

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "releaseId": "release-123",
  "runId": "run-123",
  "workspaceId": "workspace-123",
  "releaseCommit": "dddddddddddddddddddddddddddddddddddddddd",
  "expectedCanonicalHead": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "materializationManifestRef": "materializations/release-123/manifest.json",
  "materializationManifestDigest": "sha256:...",
  "outputDigest": "sha256:...",
  "materializationMetadata": {},
  "downloadReference": "...",
  "failureCode": null,
  "status": "published",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Allowed statuses and required fields:

| Status | Required state |
| --- | --- |
| `prepared` | `releaseCommit` and `expectedCanonicalHead`; no public download |
| `materialized` | Verified materialization manifest, manifest digest, output digest, and download reference; download is still held |
| `ref_updated` | `materialized` state plus recorded canonical ref update; publication remains recoverable |
| `published` | Verified manifest, output digest, download reference, and `failureCode = null` |
| `failed` | A defined `failureCode`; no official download |

The only normal transition is:

```text
prepared -> materialized -> ref_updated -> published
```

The defined failure codes are:

```text
STALE_CANONICAL_HEAD
CANDIDATE_INVALID
MATERIALIZATION_FAILED
OUTPUT_DIGEST_MISMATCH
RELEASE_STORE_UNAVAILABLE
RELEASE_RECONCILIATION_FAILED
```

`failureCode` is the only persisted Release failure field. Retryability comes from Framework policy.
`downloadReference` is publicly available only in `published` state.

## 6. Manifests

The two manifests are separate records:

### Evidence manifest

Owned by the Run. Its required shape is:

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "manifestId": "run-123:evidence",
  "runId": "run-123",
  "eventRefs": ["events.ndjson#event-123"],
  "checkpointRefs": ["checkpoints/cp-456.json"],
  "provenanceRefs": ["provenance/commit-789.json"],
  "reviewRefs": [],
  "digest": "sha256:..."
}
```

Each reference resolves within the owning Run's evidence boundary. `digest` is a SHA-256 digest of
the canonical manifest content with the `digest` field omitted. Event references use
`events.ndjson#<encoded-event-id>`; the event ID portion is URI component encoded so event IDs
containing reserved characters such as `#` remain unambiguous.

### Materialization manifest

Owned by the Release. Its required shape is:

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "manifestId": "release-123:materialization",
  "releaseId": "release-123",
  "releaseCommit": "dddddddddddddddddddddddddddddddddddddddd",
  "files": [
    {
      "path": "docs/report.md",
      "digest": "sha256:...",
      "sizeBytes": 1200
    }
  ],
  "digest": "sha256:..."
}
```

Each file entry uses a normalized repository-relative `path`, the SHA-256 digest of the materialized
bytes, and non-negative `sizeBytes`. `lfsObjectId` is present only for a file backed by a verified
Git LFS object and has the form `sha256:<hex>`. `digest` is the SHA-256 digest of the canonical
manifest content with the `digest` field omitted; the Release's `materializationManifestDigest`
equals this value.

Neither manifest defines Workspace versioning. Both resolve to Git commit or Release records rather
than storing an alternative content history.

## 7. Events and Provenance

The event envelope is the existing append-only Runtime event boundary:

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "eventId": "event-123",
  "eventType": "result_committed",
  "runId": "run-123",
  "recordedAt": "2026-11-18T10:00:00Z",
  "payload": {}
}
```

The active Runtime **Workspace event** registry must implement this contract event set.
`WorkspaceEventEnvelope.eventType` accepts exactly these 30 values. These are Runtime evidence
events, not Flow Business Event values and not routable edge labels. The Flow Business Event registry
and its routing rules remain defined by the Role Execution Architecture and existing Flow contracts;
this list does not replace or duplicate that registry:

```text
role.started
role.input_ready
role_waiting
role_retry_scheduled
flow.activated
start_dispatch_selected
route_decision
loop_budget_decision
failure_handled
join_activated
join_quorum_reached
join_late_arrival_ignored
join_timed_out
join_source_outcome_rejected
loop_exhausted
human_review_requested
human_review_approved
human_review_rework_requested
human_review_rejected
human_review_decision_rejected
human_review_paused
human_review_terminated
human_review_expired
run_waiting
run_stopping
run_stopped
run_terminated
result_committed
join_conflict
workspace_integrated
```

Workspace events are appended to the owning Run's existing `events.ndjson` with the same durable
event envelope. They do not create a second Workspace event file or event store.

For a Workspace Role commit, the `result_committed` payload includes `runId`, `nodeId`, `roleId`,
`baseCommit`, `resultCommit`, `changedPaths`, `lfsObjectIds`, `decisionBackground`, and
`evidenceRefs`. Runtime may also append a same-named idempotent result-state projection containing
`resultId` and `stateVersion` when no Workspace content commit is involved; that projection is not a
content-version fact and does not replace the Workspace commit form. Release status transitions are
projected from the Release record and are not duplicated as a second publication event model.

The `join_quorum_reached` payload uses the Runtime Join transition fields `joinId`, `roleId`,
`lineageId`, `loopIteration`, `joinMode`, `joinSources`, `requiredSourceCount`, `satisfiedSources`,
`arrivedFromRoleId`, `arrivedFromBranchId`, and `activatedBranchId`; `joinMin` and `sourceSnapshot`
are present when recorded by the transition. A source snapshot entry contains `roleId` and `status`,
and includes `branchId` and `arrivedAt` when known. Commit and evidence provenance are resolved through
the referenced Role execution and checkpoint records rather than repeated as event-specific aliases.

Tool invocation and permission evidence use the existing generic Runtime evidence envelope and are
technical evidence, not `WorkspaceEventEnvelope` values or Flow Business Events. Their evidence
record types are `tool_invocation` and `permission_request`; they are intentionally outside the 30
value `WorkspaceEventEnvelope.eventType` registry. Model request, token, transport, and host
notifications are not Workspace events or Workspace contract events.

## 7.1 Contract Errors and Recovery Conditions

The Framework returns a stable public error code when a Workspace operation is rejected. Transport-
specific envelopes may add details, and lower-level Git/materialization diagnostics may remain
implementation details, but public callers must preserve and act on the codes below rather than infer
recovery from free-form messages. Persisted `Release.failureCode` is restricted to the failure-code
set defined in the Release contract.

| Code | Rejection or failure | Required recovery condition |
| --- | --- | --- |
| `WORKSPACE_CONTRACT_VERSION_INVALID`, `WORKSPACE_REF_INVALID`, `WORKSPACE_CHECKPOINT_INVALID`, `WORKSPACE_LOCK_INVALID`, `WORKSPACE_EVENT_INVALID`, `RELEASE_INVALID`, `WORKSPACE_PATH_INVALID` | Contract record fails schema, envelope, or path validation | Correct the record from the normative contract; do not reinterpret or migrate it. |
| `WORKSPACE_MANIFEST_INVALID`, `WORKSPACE_MANIFEST_DIGEST_MISMATCH` | Evidence or Materialization Manifest has an invalid shape, identity, or digest | Rebuild the manifest only from its durable source records or immutable Release commit; reject reads and publication until its identity and digest validate. |
| `WORKSPACE_MANIFEST_EVIDENCE_INVALID` | A persisted Run event needed to build its Evidence Manifest is malformed or has the wrong Run identity | Preserve the Run evidence, correct or restore the invalid event from its authoritative checkpoint/provenance record, then rebuild the manifest; do not omit the invalid event to force cleanup or publication. |
| `WORKSPACE_REPOSITORY_REQUIRED` | Project Workspace is not an initialized Git repository | Do not run or convert the existing directory; create a new Project through the supported creation path, which provisions its Git + LFS Workspace. |
| `WORKSPACE_REF_WORKSPACE_MISMATCH` | Reference names another Project Workspace | Stop the read and request a newly authorized reference from the producer. |
| `WORKSPACE_REF_UNAUTHORIZED` | A Role requests a reference outside its projected allow-set | Fail the handoff closed, record the denial in Run evidence, and request a newly authorized projection. |
| `WORKSPACE_REF_NOT_FOUND` | Commit or path is not available in the committed tree | Stop the read; recover from the recorded commit or issue a new reference. |
| `WORKSPACE_REF_SYMLINK` | Referenced tree entry is a symbolic link or another non-regular file node | Reject the read; issue a reference to a regular committed file. |
| `WORKSPACE_REF_DIGEST_MISMATCH` | Committed bytes do not match the reference digest | Fail closed and quarantine the read; recover the commit or issue a new reference. |
| `WORKSPACE_LFS_UNAVAILABLE`, `WORKSPACE_LFS_DIGEST_MISMATCH`, `MATERIALIZATION_LFS_UNAVAILABLE`, `MATERIALIZATION_LFS_DIGEST_MISMATCH` | Required LFS object is missing or fails checksum verification | Do not publish or expose content; restore the object and retry from the immutable commit. |
| `WORKSPACE_LOCK_HELD` | Another valid owner holds the canonical lock | Wait for release or lease expiry; never overwrite the lock. |
| `WORKSPACE_LOCK_STALE_HEAD`, `GIT_COLLABORATION_STALE_CANONICAL_HEAD` | Expected canonical HEAD differs from the authoritative ref | Leave the candidate available, refresh the head, and rebase or create a new candidate. |
| `WORKSPACE_LOCK_OWNER_MISMATCH` | Owner, fencing token, lease, or expected head is no longer valid | Fence the caller and reconcile from the latest lock and checkpoint. |
| `WORKSPACE_CLEANUP_RUN_NOT_TERMINAL` | Cleanup targets a Run that can still resume or continue | Leave its worktrees and refs intact; retry only after the Run reaches `done`, `failed`, or `terminated`. |
| `WORKSPACE_CLEANUP_RUN_MISMATCH`, `WORKSPACE_CLEANUP_WORKSPACE_MISMATCH` | Run or Workspace identity does not match the owning Project | Reject cleanup and resolve identity from the owning Project, Task, and Run records. |
| `RELEASE_NOT_FOUND`, `RELEASE_STATE_INVALID` | Release operation is outside the allowed state machine | Reconcile from the persisted Release record; do not skip a state or create an alias. |

The following recovery outcomes are mandatory: a Join conflict emits `join_conflict` and leaves the
canonical HEAD unchanged; an expired lock is reclaimed only through fencing; a materialization or
digest failure enters `failed` with a defined `failureCode` and no download reference; and a known
post-ref-update write failure may enter Release reconciliation. Unknown failures remain recoverable
or fail closed and never publish an unverified result.

## 8. Workspace API

The Framework exposes these operations as the single mutation boundary. Names are normative; transport
and URL formatting are implementation details.

| Operation | Required input | Durable result |
| --- | --- | --- |
| `workspace.prepare` | Project, Run, Role, and `baseCommit` | `workspaceId`, `worktreeId`, `branch`, and prepared checkpoint |
| `workspace.claim` | `workspaceId`, owner, lease, expected head | canonical lock with fencing token |
| `workspace.commit` | worktree identity, base commit, changed paths, provenance | Framework-created `roleCommit` and `result_committed` evidence |
| `workspace.merge` | candidate commits and merge provenance | `mergeCommit`, or `join_conflict` with canonical ref unchanged |
| `workspace.restore` | target commit, expected canonical head, restore provenance | new restore commit; shared history is not rewritten |
| `workspace.release` | `releaseCommit`, expected head, materialization request | Release state machine and materialization evidence |
| `workspace.cleanup` | terminal Run identity, owning Workspace, expected canonical head | Run worktrees removed; only merged Run refs pruned under the canonical lock; unmerged candidates retained. The Project Run API reports removed worktree and branch counts, never local filesystem paths. |
| `workspace.run.output.list` | Owning Project identity | Run-owned collaboration output summaries, each bound to its Task and Run |
| `workspace.run.output.read` | Owning Project, Task, and Run identity | The Run output summary and verified file entries |
| `workspace.run.output.file.read` | Owning Project, Task, Run, and normalized file path | A digest-verified Run output file |
| `workspace.evidence.manifest.read` | Owning Project, Task, and Run identity | The Run-owned Evidence manifest after digest and Run-boundary reference verification |

The Project-facing collaboration output projection has this required shape:

```json
{
  "taskId": "task-123",
  "runId": "run-123",
  "attemptNumber": 1,
  "availability": "available",
  "commit": "full-immutable-commit-id",
  "digest": "sha256:...",
  "createdAt": "..."
}
```

`availability` is `processing` while the Framework Release is `prepared`, `materialized`, or
`ref_updated`; it is `available` only after the Workspace Release reaches `published` and its
Materialization manifest, output digest, and files verify; it is `unavailable` for a failed or
unverified output. A missing output has no projection and reads fail with the owning Task/Run
not-found result. A file is readable only when availability is `available` and its digest verifies.
The public projection never includes `releaseId`, Workspace Release `status`, `failureCode`, or
`downloadReference`; those remain Framework-owned records. The same output record is addressed by its
owning Project, Task, and Run.

Reads expose immutable WorkspaceRef, checkpoint, lock, provenance, manifest, and event records.
Roles cannot invoke mutation operations directly and cannot create unregistered commits, update refs,
push LFS objects, or edit checkpoints.

## 9. Prohibited Contract Surface

The following are invalid V2 fields, states, events, APIs, or compatibility aliases:

- a second content version or delivery version;
- a public generic content-reference field outside `WorkspaceRef`;
- a separate binary, media, or document Workspace backend;
- migration or compatibility reads of Contract Set v1;
- dual writes or fallback readers;
- Role-owned canonical Git mutations;
- branch names, absolute paths, or uncommitted files as cross-Role references.
