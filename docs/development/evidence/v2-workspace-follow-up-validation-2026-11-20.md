# V2 Workspace Follow-up Validation

Status: engineering validation only. This record does not close a Release UAT scenario or establish
V2 release readiness.

## Reported Defects

- Studio Simulation Evidence Manifest verification decodes URI-encoded event IDs before matching
  persisted event IDs. The regression fixture includes `event#1` and `event%1`, which are encoded in
  manifest references and verified against the original IDs.
- Release reconciliation classifies a same-size materialization content change as
  `OUTPUT_DIGEST_MISMATCH`. Regression coverage verifies the persisted failure code for same-size
  tampering, including the Workspace Release path.

Targeted regression results on 2026-11-20:

- Team Site tests: 8 passed across Task retry material boundaries, Studio Simulation Evidence
  Manifest, and Project Release store.
- Workspace contract and coordinator tests: 27 passed.
- `git diff --check`: passed.

## Live Project Retry Attempt

- Team Site: `http://127.0.0.1:4174`
- Project: `v2-uat-structured-debate-1795057638883-d38a811b`
- Task: `20261120-050105-eab3cd89`
- Retry Run: `20261120-053327-3d88c8a2`, attempt 3
- Mode: Sandbox
- Material snapshot policy: `source_run_snapshot`, source Run
  `20261120-050154-2732f9bf`
- Run manifest API: HTTP 200, manifest ID `20261120-053327-3d88c8a2:evidence`, digest
  `sha256:e455d0ad71a31fc47e2196ef244dcb956c3a37ea04a47945d65c4f5155324e48`. It has no event,
  checkpoint, provenance, or review references because execution failed before role work began.

The Run ended `failed` before any role attempt. The recorded error is that Codex app-server could
not initialize its state runtime because SQLite could not open
`~/.codex/memories_1.sqlite` (`disk I/O error`). This confirms the retry snapshot path reached Run
creation, but it does not validate the full workflow or Workspace recovery behavior. The attempt is
an environment-blocked engineering observation, not a UAT pass.

## Live Cleanup and Recovery

The owner-checked cleanup API targeted Project `v2-uat-structured-debate-1795057638883-d38a811b`,
Task `20261120-051853-a8b5fb78`, Run `20261120-051917-b467b893`, Workspace
`workspace-fb33cc9d27c8c4f2d9d4e18f`, and expected canonical HEAD
`2ef7e14fc71a635f5ac153936c60573fc128e44c`.

The first request returned HTTP 400 with `ENOSPC` while opening `.site/project-write.lock`; no lock
file was created and cleanup did not start. Read-only verification found canonical HEAD unchanged,
all six Run-owned worktrees still present, and the Evidence Manifest readable with its original
digest and 2,241 event, 18 checkpoint, and 1 provenance references. The filesystem then reported
116 MiB available at 100% capacity.

After available space recovered to 5.1 GiB, the same owner-checked request returned HTTP 200 and
reported 6 removed worktrees and 6 removed merged branches. Post-cleanup reads returned HTTP 200
for the completed Run, its 33 persisted business events, the same Evidence Manifest ID and digest,
and its published Release. The manifest still has 2,241 event refs, 18 checkpoint refs, and 1
provenance ref. Canonical HEAD remains `2ef7e14fc71a635f5ac153936c60573fc128e44c`, Git status is
clean, and no worktree remains for the target Run.

This closes the live cleanup and retained-evidence subcase only. Scenario 19 remains Blocked because
readiness, authorization, join conflict, interruption/recovery, stale-head, materialization failure,
reconciliation, external-ref write, and Product Owner review evidence remain outstanding.

## Acceptance Boundary

The formal Project branch/Join/loop scenario remains open. A prior completed Run's role output
claimed a rework loop that did not match its event history, so that statement is not accepted as
loop evidence. The current retry failed before producing events. Operator and product-owner review,
remaining fault scenarios, and release sign-offs are still required. No UAT status or release gate
is changed by this record.
