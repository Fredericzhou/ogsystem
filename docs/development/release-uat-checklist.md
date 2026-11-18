# OGSystem Release UAT

This checklist gates the Contract Set v2 local-first release. It starts from a clean install and a
new project; historical development data and interfaces are not migration or compatibility targets.

## Workspace terminology

This checklist uses `Release materialization` for the final file or media delivery produced from a
recorded Git commit. `Artifact`, `Final Artifact`, and `ArtifactReference` are not accepted as V2
public concepts or evidence fields. Any remaining occurrence in an active schema, API, UI, or
acceptance record is a pre-release cleanup failure; no compatibility alias or historical read path
is allowed.

## Participants

- Framework developer: checks install, configuration diagnostics, API contracts, and recovery evidence.
- Workflow operator: completes the scenarios without editing runtime files by hand.
- Product owner: records pass/fail and accepts any non-blocking findings.
- Accessibility evaluator: completes the real-device keyboard and screen-reader scenario; this may be the workflow operator when appropriately equipped.
- At least one real target workflow is required in addition to repository examples.

## Scenarios

1. From the `Software development` team page, choose `Use for a project`, create a
   collaboration project, and confirm the project page shows the mounted TeamVersion, project
   materials area, and an empty task list. Record a request for a first release plan for a
   freelancer bookkeeping product. Confirm it appears as one queued Task with no Run ID.
2. Use `Isolated run` with a ready provider and complete the Task through the page. The result
   must address the request and include an implementation breakdown, user experience, acceptance
   checks, and delivery integration. Inspect the Run page evidence: the five software-team roles,
   per-role inputs and outputs, event history, final result, and completed status. Refresh the
   page and verify the same Task, TeamVersion, Run ID, mode, and result remain visible. A flow
   preview is not acceptable evidence of business delivery.
3. Repeat with an unavailable provider or a deliberate readiness blocker. The page must show the
   failure reason, must not show a completed result, and must leave the Task retryable. Resolve
   the blocker and retry the same Task; verify the Task ID is unchanged, a new Run ID is added to
   its history, and the failed Run remains inspectable.
4. Install the package on a clean supported machine, create a project, configure one Role and its
   executor, validate readiness, and run the minimal linear example.
5. Run a branch-and-join example; inspect initial input, each Role's input/output and handoff in
   the Visualizer Flow view, then verify the event stream and execution records through `/api/v2`.
6. Stop at human review, record approve and rework decisions, verify principal attribution, resume,
   and confirm that duplicate or stale decisions are rejected without changing the run.
7. Trigger a configured failure-compensation route, inspect the failure and audit evidence, and
   resume an interrupted run without repeating a committed role execution.
8. Scrape `/metrics`, check `/healthz` and `/readyz`, and verify that sensitive prompt/result data
   is absent from metric labels and operational summaries.
9. Complete the same operator workflow at desktop and mobile viewport sizes; confirm the graph,
   failure location, pending review action, and next lifecycle action remain discoverable.
10. In Studio, open a Role property panel, keep the floating Team assets panel open, and create a
    relationship between visible graph ports outside the panel. Confirm X6 receives the connection,
    the relationship editor opens, and the flow is saved with the selected endpoints. Open Global
    inside Team assets and confirm configuration stays in the floating panel; verify Start/End flows
    have localized labels.
11. On a real supported device, complete the operator's keyboard-only path and review the same
    workflow with a screen reader. Verify focus order, visible focus, control names and states,
    status/error announcements, review actions, and recovery actions at the device's actual
    viewport and browser zoom.
12. In the Team Site browser, open the published `management-consulting` team, open Design and the
    Debug panel, enter a task, select `Sandbox`, and start the run with the default verified
    Backend/model selected by the v2 Harness Template (the current local target is Codex/
    `gpt-6-luna`). Verify the panel switches to the run view, role avatars/names and live
    messages appear, at least one message expands to show input/output/diagnostics, and active
    graph Flow edges use the animated green runtime style. Record the TeamVersion ID, Simulation
    ID, final status, materialization URL, screenshots, and console errors.
13. Follow the `Open run directory` link and inspect the real controlled materialization listing. Confirm
    events, timeline, audit, logs, and role output remain readable after a page refresh. Start a
    second Sandbox run, click the red Stop button before completion, and record the complete
    `stopping` to `stopped` transition. Repeat the panel switch, return, scroll, and link checks at
    desktop, tablet, and mobile viewports. A missing OpenCode model, credential, or completed real
    Sandbox run is a blocker; a mock runner does not satisfy these scenarios.
14. Verify directory ownership with one shared business workspace and two independent Team control
    roots. Run two different TeamVersions against the same workspace and confirm each Run is stored
    only under its own `<ogs-dir>/.ogs/runs/<run-id>`, while business files remain directly in the
    shared workspace without generated `source/`, `destination/`, or workspace `.ogs` directories.
    Record both TeamVersion IDs, both Run IDs, the two control roots, the shared workspace path, and
    before/after directory listings.
15. Change the TeamVersion after a completed Run. Confirm the old Run's `team-version.json`, asset
    snapshot, digest, events, and result remain unchanged; the next v2 Run records the new
    TeamVersion and digest. Confirm Studio Simulation history remains in `.studio/simulations` and
    is absent from Project Task history and Release materializations. Do not import or compare released v1 data.
16. Complete a real documentation delivery workflow through the supported Studio/CLI path. Start
    from a documentation request and source material, use separate research, drafting, review, and
    finalization Roles, materialize the final document from its recorded commit, and verify links,
    terminology, completeness checks, reviewer decision, and append-only Evidence after refresh.

17. Open Debug History for a completed branch, Join, quorum, loop, or review Run. Confirm the event
    list is collapsed by default, uses compact secondary typography with stable rows, is scrollable
    without changing page layout, and uses the same control sizing and visual language as the rest of
    the page. Expand decision
    events and verify the list shows decision background, selected route or loop action, contributing
    Role/node arrivals with timestamps and statuses, quorum calculation, `round`, `lineageId`,
    `branchId`, `loopIteration`, commit/evidence references, and the resulting state. Model request,
    token, and transport events must not appear as business events. Capture the same facts after a
    refresh and from the Run evidence/API read boundary.

## Real team and Project coverage

The release must execute all four built-in teams twice: once through a real Studio Sandbox run and
once from a newly created formal Project with a new Task and a real Run. The formal Project run is
the acceptance authority; Sandbox proves the authoring and live-debug path and cannot replace the
Project run. A Project may contain several Tasks/Runs for positive, failure, and recovery cases.

| Pack | Formal Project run requirements | Required assertions and delivery evidence |
| --- | --- | --- |
| `cross-backend-review-loop` | Create a Project and Task, run Role A and Role B on two verified Backends, pass an explicit `WorkspaceRef`, then exercise review approval and rework decisions | Both Role executions occur; the handoff projection and authorization are visible; review decisions are principal- and CAS-bound; the final Run records the full WorkspaceRef (immutable commit, relative path, digest), decision background, evidence refs, and a Release result |
| `management-consulting` | Create a Project and Task for a document or structured package; run specialist Roles in parallel, converge through Join and QA, and deliver a real document plus a Git LFS binary/media fixture | Role arrivals and Join/quorum facts are visible; source and `mergeCommit` are recorded; the materialization manifest, output digest, preview, download, and refresh all agree; the LFS content is restored and checksum-verified |
| `software-team` | Create a Project backed by a real repository; run independent edits in parallel, force a same-file text conflict, resolve it through Join, interrupt and resume, and perform a restore and stale-head attempt | Each worktree has a distinct `worktreeId`; Role attempts to run prohibited Git mutations are denied and audited; role commits and changed paths are traceable; `join_conflict` leaves canonical HEAD unchanged; `mergeCommit` and restore commit are valid; the canonical lock records `owner`, `leaseUntil`, `fencingToken`, and `expectedCanonicalHead`; stale CAS fails closed; the resulting code/test package is downloaded from the published Release |
| `structured-debate` | Create a Project and Task with proposition and opposition Roles; run both branches, exercise quorum and a loop/review decision, and publish a final brief | Both sides have real execution records; branch, quorum, loop, and review decisions show their background and evidence; the final brief is materialized from the recorded commit and remains available after refresh |

The formal Project pack must include at least one text deliverable and one binary or media file
tracked through Git LFS. The binary/media file may be a real project input or a generated deliverable,
but it must pass through the same Workspace commit, restore, materialization, download, and digest
checks. No manually copied file outside the Workspace is accepted as delivery evidence.

Each Sandbox run has a narrow user-facing assertion in addition to the formal Project run: the
cross-Backend team shows both real Role messages and the handoff/review state; the consulting team
shows Join progress and a browsable delivery; the software team shows live branch/Run state and the
decision event list; the debate team shows both proposition and opposition activity and the branch or
quorum outcome. Sandbox evidence demonstrates the browser path only; it cannot be used for commit,
LFS, or Release claims.

### Required companion Runs

The following cases are separate real Runs with their own Run IDs. They may reuse one of the four
Projects above, but each case must be triggered through the supported product path and leave its
failure or recovery state inspectable. When a failure cannot be induced safely from the UI, use a
Framework-approved deterministic fault-injection hook attached to the real Run; never insert a fake
event or edit persisted evidence by hand.

| Case | Run setup | Pass condition |
| --- | --- | --- |
| Readiness and retry | Select an unavailable Backend/model or deny a required capability, then fix readiness and retry the same Task | The blocked attempt creates no false success; the retry has a new Run ID; the failed attempt remains inspectable |
| Unauthorized `WorkspaceRef` | A Role requests a path, commit, or Workspace outside its projected allow-set | Handoff fails closed, no unauthorized read occurs, and the denial is in Run evidence |
| Join conflict | Two Role worktrees write the same path with incompatible text or binary content | `join_conflict` is emitted, canonical ref is unchanged, and resolution resumes from the merge candidate without rerunning committed Roles |
| Checkpoint interruption | Stop or crash after a Role commit and before the next durable transition | Recovery recreates the worktree from commit references, skips the committed Role, and preserves lineage/state version |
| LFS interruption | Interrupt an LFS upload or restore | Retry or resume verifies the pointer/object checksum and never publishes a partial object |
| Stale canonical head | Advance the canonical ref through another Framework operation before release CAS | Release fails with `STALE_CANONICAL_HEAD`, exposes no official download, and creates a new candidate from the current head |
| Materialization failure | Inject a materialization or output-digest failure after `prepared` | Release enters `failed` with the defined `failureCode`; no official download is exposed; a retry follows Framework/materialization policy |
| Release reconciliation | Interrupt after canonical ref update and before Release finalization | Recovery publishes only when canonical ref, manifest, digest, and download reference all verify; otherwise it remains recoverable or fails closed |
| External ref write | Modify an authoritative ref outside Framework control during a guarded operation | The next Framework operation detects the expected-head mismatch and fails closed; only a known Release failure window may reconcile |
| Cleanup and retention | Complete successful, failed, conflicted, and recoverable Runs, then apply the configured cleanup policy | Stale worktrees, branches, refs, and locks are removed; retained checkpoints, Release records, and evidence still resolve; unreferenced LFS objects are only marked for repository garbage collection |

### Capability-to-team coverage

The following mapping is the minimum real Project coverage. One Run can satisfy multiple rows when all
listed evidence is present; a row is not satisfied by a graph preview, mock response, synthetic event,
or API-only request.

| Design capability | Required real team/project evidence |
| --- | --- |
| Linear handoff, context projection, and authorized `WorkspaceRef` | `cross-backend-review-loop` Project Run with HandoffProjection and denial attempt |
| Parallel split and independent worktrees | `management-consulting` or `software-team` Project Run with two concurrent Role executions |
| Same-file text/binary conflict and Join recovery | `software-team` Project Run plus `Join conflict` companion Run |
| All-of/quorum Join and late-arrival handling | `management-consulting` and `structured-debate` Project Runs with Role arrival timestamps |
| Branch routing and loop/rework | `structured-debate` Project Run with both branches and a loop iteration |
| Human Review approve/rework/reject and stale decision rejection | `cross-backend-review-loop` Project Runs with attributed decisions |
| Retry exhaustion, timeout, compensation, cancellation, terminal aggregation | Companion Runs attached to the owning Project, with event and checkpoint evidence |
| Git/LFS commit, restore, worktree cleanup, and canonical lock/CAS | `software-team` Project Run and its interruption, restore, stale-head, and LFS companion Runs |
| Release materialization, manifest, digest, download, and reconciliation | `management-consulting` and `software-team` Releases plus failure/reconciliation Runs; verify `releaseCommit = mergeCommit` unless release content changes |
| Decision event audit view | `structured-debate` Debug History Run, with browser capture and API/evidence cross-check |
| Backend readiness, capability freeze, fail-closed permissions, and cross-Backend execution | `cross-backend-review-loop` Project Run and readiness/authorization companion Runs |

For every formal Project Run, attach a single run ledger containing `projectId`, `taskId`, `runId`,
`workspaceId`, TeamVersion and code/schema digests, Backend/model snapshot, `baseCommit`,
`roleCommit` values, `mergeCommit`, `releaseCommit` when present, decision/event evidence, checkpoint
references and commit provenance, canonical lock/CAS facts, `canonicalRefUpdated` when applicable,
Release status history, `materializationManifestRef` and digest, output digest or `failureCode`,
download reference when published, browser captures, and operator/product-owner sign-off. The ledger
is the minimum acceptance index, not a second runtime record.

## Manual Evidence Record

Create one record for every scenario. The initial status for every row is **Not run**; change it
only after performing the scenario and attaching the listed evidence. Each row names one executor
role and one sign-off role; record the individuals, date, and evidence reference when run. Use
**Blocked** when an environment or device is unavailable, and record the blocker, dependency, and
responsible person. A blocked or evidence-free row is not a pass.

Narrative evidence copied from pre-cutover runs is context only. It does not satisfy the row until
the same evidence is reproduced against the final v2 code, schemas, and package roots.

| Scenario | Executor / sign-off role | Status (Not run / Pass / Fail / Blocked) | Required evidence to attach | Evidence, individuals, date, blocker/dependency, issue IDs |
| --- | --- | --- | --- | --- |
| 1 | Workflow operator / Workflow operator | Blocked | Project and Task IDs; page capture showing mounted TeamVersion, materials area, empty task list before creation, then queued Task without a Run ID. | Executor unavailable in this run; workflow operator must perform and record IDs/captures. |
| 2 | Workflow operator / Product owner | Blocked | Package/version and real target workflow fixture; Task, TeamVersion, and Run IDs; role-by-role inputs/outputs and event history; final result; before/after-refresh page captures. | Engineering CLI evidence for the v2 software workflow is attached in `docs/development/evidence/v2-gate-c-real-workflow-success-2026-11-16.md` (Run `20261116-021112-8895f585`), including sealed materializations and reviewer approval. Browser workflow, refresh capture, and operator/product-owner sign-off remain outstanding. |
| 3 | Workflow operator / Workflow operator | Blocked | Readiness blocker and displayed reason; Task Run history before/after retry; failed and retry Run IDs; evidence the blocked attempt reserved no Run and the failed Run remains inspectable. | Requires workflow operator to execute and record the page flow. |
| 4 | Framework developer / Framework developer | Not run | Clean-machine OS/runtime and package version; install/configuration transcript; readiness result; minimal linear workflow inputs, outputs, and execution record. | Final v2 npm and pnpm tarball smoke passed in the development environment. A clean supported machine transcript and operator record are still required before changing this status. |
| 5 | Workflow operator / Workflow operator | Blocked | Branch-and-join fixture and Run ID; initial input; each Role's input/output and handoff; matching Visualizer capture and `/api/v2` requests/responses or saved records. | Requires workflow operator to perform the scenario and verify the delivered flow. |
| 6 | Workflow operator / Workflow operator | Blocked | Review request and Run ID; approve/rework decision IDs and attributed principals; resume evidence; duplicate/stale request and response; before/after state proving rejection made no change. | Requires an operator with a review principal to perform and sign off. |
| 7 | Workflow operator / Workflow operator | Blocked | Failure-compensation route and audit evidence; interruption point; committed Role execution IDs/counts immediately before interruption and after recovery; resumed Run/event records proving each committed Role was not executed again. Include operator actions and timestamps. | Requires an operator to interrupt, recover, retry, and verify no committed role repeats. |
| 8 | Framework developer / Framework developer | Not run | Timestamped `/metrics`, `/healthz`, and `/readyz` responses from the final v2 build; redaction inspection noting which labels/summaries were checked and confirming prompt/result content is absent. | The prior health and metrics record predates the v2 cutover. Re-run against the final v2 build and attach the responses and redaction inspection. |
| 9 | Workflow operator / Workflow operator | Blocked | Desktop, mobile, and viewport dimensions; screenshots or recording showing graph, failure location, pending review, and next lifecycle action; overflow/overlap findings and issue IDs. | Final browser regression passed 17 tests with 2 deployment-only skips; Build layout regression passed 4 tests, including mobile graph controls and long-label geometry. Manual operator-flow screenshots, tablet comparison, and product-owner sign-off remain outstanding. |
| 10 | Workflow operator / Product owner | Blocked | TeamVersion and Run IDs; screen recording showing the Team assets panel open while connecting two graph ports; saved Flow endpoints/event/business label; Global panel state; Start/End flow labels; any console errors. | Automated Studio design regression keeps Team assets open, verifies both connection ports are outside the panel bounds, creates the Flow, and saves its business label. The combined flow is covered automatically, but no human-reviewed screen recording and release sign-off are recorded yet. |
| 11 | Accessibility evaluator / Accessibility evaluator | Blocked | Device model/OS, browser/version, assistive technology/version, viewport/zoom; keyboard path and focus order; screen-reader names, states, and announcements; recording or notes for any blocker and its reproduction steps. | No real supported device or screen reader is available in this execution context; accessibility evaluator owns completion. |
| 12 | Workflow operator / Product owner | Blocked | TeamVersion ID, Simulation ID, Backend/model configuration, final status, role transcript captures, expanded diagnostic capture, green Flow capture, materialization URL, console log. | Requires a real browser workflow and an available verified Backend/model (current local target: Codex/`gpt-6-luna`); mock or API-only execution does not count. |
| 13 | Workflow operator / Product owner | Blocked | Materialization listing and file captures before/after refresh; second Simulation ID; stop request and `stopping`/`stopped` timestamps; desktop/tablet/mobile viewport evidence. | Requires a live run long enough to exercise graceful stop and a real browser. A missing selected Backend/model or credential is a blocker; the current local engineering target is Codex/`gpt-6-luna`, while OpenCode/Pi may be selected only when their own readiness probe passes. |
| 14 | Framework developer / Product owner | Not run | Two control roots, one shared workspace path, two TeamVersion IDs, two Run IDs, before/after directory listings, and proof that no workspace `.ogs`, `source`, or `destination` directory was generated. | Must be executed against the new control-root/workspace contract. |
| 15 | Framework developer / Product owner | Not run | Two v2 TeamVersion IDs and digests; unchanged first v2 Run manifest, asset snapshot and result; second v2 Run evidence; Studio Simulation and Project history listings. | Must prove v2 version freezing and Studio/Projects namespace isolation without importing or reading v1 data. |
| 16 | Workflow operator / Product owner | Blocked | Documentation request and source digest; Role inputs/outputs; final Release materialization digest and URL; reviewer decision and CAS scope; link, terminology, completeness, and refresh evidence. | Engineering evidence is attached in `docs/development/evidence/v2-gate-c-real-workflow-success-2026-11-16.md` for Run `20261116-020145-9adc9512`, including the sealed materialization manifest, promotion receipt, and reviewer result. Workflow-operator/product-owner review and sign-off remain outstanding. |
| 17 | Workflow operator / Product owner | Not run | Formal Project/Task/Run IDs for a branch, Join, quorum, loop, or review case; desktop/mobile Debug History captures; expanded decision details; refresh capture; matching event/evidence read response; browser console record. | Must prove compact collapsed event list, scrolling, decision background, Role arrival times/statuses, quorum/branch/loop facts, evidence/commit links, and exclusion of model request events. |
| 18 | Workflow operator / Product owner | Not run | Four TeamVersion IDs; four Project IDs; Sandbox and formal Project Run IDs for each built-in team; per-team run ledger and final deliverable/release evidence. | Must prove every built-in team ran through both supported paths with real models and a real file or media delivery where required. |
| 19 | Framework developer / Product owner | Not run | Companion Run IDs for readiness, unauthorized WorkspaceRef, Join conflict, checkpoint interruption, LFS interruption, stale head, materialization failure, reconciliation, and external ref write; failure codes and recovery evidence. | Every required case must be executed or explicitly marked Blocked with an environment dependency; no case can be closed by a unit test or injected event alone. |

## Release Gate

Historical automated page evidence is retained in
`apps/team-site/tests/archive/v1/classic-team-flow.test.mjs`. It is not an active v2 test and does
not close any v2 UAT scenario. A new v2 Playwright or equivalent evidence record must be attached
before the corresponding manual rows can change from Not run/Blocked. Automated evidence remains
separate from operator, product-owner, target-model, Windows, and real-device accessibility
scenarios.

Historical v1 resource baseline: **Recorded for archaeology; not v2 evidence**. Framework developer,
2026-10-19 09:13 CST, OGSystem 1.0.0, macOS 26.2, Node v22.21.1, Codex CLI, released Software
development TeamVersion `new-team-b3801b04`. The baseline is retained to show prior measurement
methodology only. A v2 baseline must be collected from the final v2 build if a product capacity
commitment is made; do not use this record for Gate C or a v2 performance claim.

Windows lifecycle smoke: **Blocked** in this environment (macOS; PowerShell and CMD are unavailable). Executor: framework developer on a supported Windows host.

- Required build, unit, contract, integration, fault-injection, package-install, and browser E2E
  checks pass on supported CI platforms.
- All four built-in teams have a real Sandbox run and a new formal Project/Task/Run run with a
  completed run ledger; the formal Project coverage matrix and all required companion Runs are
  complete.
- At least one formal Project Release contains a Git LFS tracked binary or media file and a text or
  structured file, both restored and digest-verified through the published Release.
- The Debug History audit scenario proves the user can inspect branch, Join, quorum, loop, review,
  decision background, Role arrival timing/status, commit/evidence references, and final outcomes
  without model request events being presented as business events.
- No active V2 schema, API, UI, checkpoint, or acceptance record exposes `Artifact`, `Final Artifact`,
  or `ArtifactReference`; any remaining occurrence blocks release cleanup.
- UAT evidence records package version, OS/runtime, workflow fixture, API/UI paths used, outcome,
  and issue references.
- Every manual scenario above has an explicit status and evidence reference; scenarios marked
  Not run or Blocked remain outstanding and cannot be counted as passed.
- No unresolved blocker or high-severity data-integrity, authorization, recovery, or audit issue.
- Flow-contract gaps block release only when `handoff.mode=strict`; `transition` gaps remain readiness warnings, and projects without `handoff.mode` do not enforce flow contracts.
- Product owner and workflow operator sign off the real target workflow.
- If the product has a stated workload or resource commitment, engineering defines measurable
  load, metrics, and limits against it; the product owner confirms user impact. Otherwise, record a
  representative workload baseline (duration, Task/Run/event/material counts, disk use, and peak
  memory) and state whether a capacity limit is needed. Do not invent a product threshold.
- Code changes require affected-scope retesting; the final full gate must use one final code state.
  Windows-only checks run on Windows. Not run, blocked, or evidence-free scenarios remain open.
