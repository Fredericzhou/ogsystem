# OGSystem Release UAT

This checklist gates the Contract Set v2 local-first release. It starts from a clean install and a
new project; historical development data and interfaces are not migration or compatibility targets.
Workspace fields, states, events, provenance, manifests, and APIs are defined only by
[`v2-workspace-contracts.md`](v2-workspace-contracts.md). This checklist records execution evidence
and sign-off; it does not define another Workspace schema.

## Workspace terminology

The Workspace contract retains its Framework-level Release state machine for guarded ref updates and
recovery. Materialization records are Framework-private verification and recovery data used to
generate and verify files from a recorded Commit. Neither defines a Project publication lifecycle.
Project users read collaboration outputs through their owning Task and Run. Evidence in this checklist
must identify the Project, Task, and Run; it must not treat an internal Release ID or `published`
state as a Project deliverable. Legacy public content-reference names remain prohibited as active
public concepts or evidence fields.

## Current UAT Status

The latest recorded count is 3 Pass, 13 Blocked, and 3 Not run across the 19 product scenarios. The
four Documentation and Contract Freeze Gate rows add four Pass, for an overall count of 7 Pass,
13 Blocked, and 3 Not run. Blocked and Not run scenarios remain release blockers. Recalculate counts
only from the current scenario table when a scenario is formally updated; engineering evidence alone
does not change a UAT status.

The TeamVersion accuracy gate is also open for any team without a current-digest review linked to
every required Sandbox Simulation. A structurally valid graph, a successful machine baseline, or a
machine-recorded checkbox review cannot close that gate; the workflow operator and Product Owner
must inspect the real team output and sign the applicable scenario. A real management-consulting
Sandbox completed on 2026-11-21 and received an engineering content review in
[`v2-team-accuracy-review-management-consulting-2026-11-21.md`](evidence/v2-team-accuracy-review-management-consulting-2026-11-21.md).
That review found the observed output accurate for its narrow task, but also found empty machine
Role Contracts and no persisted accuracy review; the TeamVersion remains draft and untrained.

## Documentation and Contract Freeze Gate

This is the formal prerequisite before implementation and UAT execution. It records document
closure only; it is not a product-release approval.

| Gate | Status | Evidence |
| --- | --- | --- |
| Authority order and document registration | Pass | Constitution and `DECISIONS.md` (governance layer; `DECISIONS.md` controls immutable choices within it) -> Role Execution Architecture -> `v2-workspace-contracts.md` -> Workspace Design -> `v2-validation-and-acceptance.md` -> this Release UAT checklist -> Implementation Runbook; all active entry points are linked from `docs/README.md` and `docs/development/README.md`. |
| Single Workspace contract authority | Pass | Workspace fields, states, events, provenance, manifests, and APIs are defined in `v2-workspace-contracts.md`; design, validation, and this checklist link to it instead of defining another schema. |
| Public legacy-surface cleanup | Pass | Active architecture, schemas, APIs, checkpoints, UI, and public error responses contain no legacy public content-reference model; internal transition names are explicitly marked private and transitional. Team Site architecture tests enforce the boundary. |
| Task traceability and Runbook boundary | Pass | The Runbook maps implementation and fault-recovery steps to the contract and acceptance records and explicitly forbids new architecture rules, fields, states, events, or APIs. |

The gate authorizes implementation and testing only. The scenario statuses below still require their
listed real Project/Task/Run evidence and responsible-person sign-off.

## Participants

- Framework developer: checks install, configuration diagnostics, API contracts, and recovery evidence.
- Workflow operator: completes the scenarios without editing runtime files by hand.
- Product owner: records pass/fail and accepts any non-blocking findings.
- Accessibility evaluator: completes the real-device keyboard and screen-reader scenario; this may be the workflow operator when appropriately equipped.
- At least one real target workflow is required in addition to repository examples.

## TeamVersion Content Validity

Before a TeamVersion is trained for a target workflow or mounted to a Project, the workflow operator
and Product Owner must review that the TeamVersion itself accurately represents the intended
collaboration: Role responsibilities and authority, required inputs, handoffs and review points,
completion conditions, and the expected collaboration output. Compare a real Sandbox baseline and
its output with explicit scenario acceptance criteria. A structurally valid graph or successful
Sandbox run proves execution, not that the selected Roles, instructions, or result are correct for
the user's objective. Record the reviewed TeamVersion ID and digest, scenario criteria, observed
output, corrections made, reviewer, and sign-off. If the team model is inaccurate, fix and retrain
the TeamVersion before using Project Runs to claim coverage; those Runs cannot compensate for a
mis-specified team.

The content review must exercise the team against a representative task and check each handoff at
the point where the receiving Role uses it. Confirm that the team has enough authority, context, and
available tools to do its assigned work; that required inputs survive projection; that parallel or
review dependencies match the stated workflow; and that the final output meets the user's acceptance
criteria without unsupported completion claims. Record gaps by Role and handoff, not only as a
whole-run pass/fail.

Every required Workspace read or write is also a training prerequisite: the selected Backend/model
must expose a verified capability for the required operation, and the effective Harness policy must
grant only the minimum needed access. A text-only Backend cannot establish a WorkspaceRef content
verification requirement; keep that TeamVersion untrained or change the team/backend and rerun the
representative baseline.

The Studio training gate records this review at `training-review` and binds it to the current
TeamVersion digest. Every TeamVersion remains untrained until the reviewer, representative task, and
all seven accuracy checks are recorded. Built-in teams also use the canonical case materializer as a
machine baseline check, but still require the responsible operator and Product Owner to sign the
relevant UAT scenario.

When the final result conflicts with runtime evidence, keep acceptance blocked and classify the
cause before changing the TeamVersion: (a) revise the team when its responsibilities, instructions,
handoffs, or completion criteria cannot produce the target result; (b) fix the Framework when the
configured team cannot access or use a required Workspace, tool, event, or persisted input; (c)
rerun or correct the scenario when its brief or fixture does not exercise the stated acceptance
criteria; (d) record an execution variance when the team and Framework are adequate but a particular
Run fails. Do not treat lifecycle state, file presence, or a structurally valid graph as proof of
content accuracy. For a discrepancy, retain the TeamVersion digest, task brief, per-Role input and
output, relevant events/checkpoints, produced collaboration output, and a short root-cause finding.
Only a reviewed correction and a fresh representative baseline can establish that the team is fit
for that target workflow.

## Scenarios

1. From the `Software development` team page, choose `Use for a project`, create a
   collaboration project, and confirm the project page shows the mounted TeamVersion, project
   materials area, and an empty task list. Record a request to implement the first usable release
   of a freelancer bookkeeping product. Confirm it appears as one queued Task with no Run ID.
2. Use `Isolated run` with a ready provider and complete the Task through the page. The result
   must contain a working source change, executable tests or verification output, and delivery
   notes. Inspect the Run page evidence: the five software-team roles, per-role inputs and outputs,
   event history, final result, changed paths, test result, and completed status. Refresh the page
   and verify the same Task, TeamVersion, Run ID, mode, and result remain visible. A plan or flow
   preview is not acceptable evidence of software delivery.
3. Repeat with an unavailable provider or a deliberate readiness blocker. The page must show the
   failure reason, must not show a completed result, and must leave the Task retryable. Resolve
   the blocker and retry the same Task; verify the Task ID is unchanged, a new Run ID is added to
   its history, and the failed Run remains inspectable.
4. Install the package on a clean supported machine, create a project, configure one Role and its
   executor, validate readiness, and run the minimal linear example.
5. Run a branch-and-join example; inspect initial input, each Role's input/output and handoff in
   the Visualizer Flow view, then verify the event stream and execution records through `/api/v2`.
6. Stop at Human Review and have the authorized human reviewer make approve and rework decisions in
   the UI. Verify the authenticated principal, decision ID, expected state/version and CAS result in
   the durable review record. Submit duplicate and stale decisions through the supported boundary;
   both must be rejected and leave Run state, checkpoint and canonical HEAD unchanged. Resume the Run
   and retain before/after evidence. An agent may prepare and inspect this scenario but must not make
   a real reviewer decision or sign for the reviewer.
7. Trigger a configured failure-compensation route and record the failure location, compensation
   decision and audit evidence. Interrupt after at least one Role commit, capture committed Role
   execution identities/counts, then recover through the supported UI/API. Verify each committed Role
   is not executed again and its commit, lineage and checkpoint remain readable.
8. Scrape `/metrics`, check `/healthz` and `/readyz`, and verify that sensitive prompt/result data
   is absent from metric labels and operational summaries.
9. Complete the same operator workflow at desktop and mobile viewport sizes with a real pending
   review and a real failed Run. At each viewport confirm the graph, precise failure location, pending
   review action, and next allowed action are visible and operable; capture dimensions and screenshots.
   Check overflow, overlap, focus and browser errors. The workflow operator must sign the end-to-end
   review; project-list/card UX evidence alone is only a subcase.
10. In Studio, open a Role property panel and keep the floating Team assets panel open. Connect graph
    ports with X6, open the relationship editor, and save the selected source and target endpoints;
    re-open the Flow and verify the persisted endpoints. Open Global from Team assets and confirm its
    configuration stays in that asset panel. Verify Start and End localize correctly. Capture the
    interaction, saved Flow readback, viewport and browser errors.
11. On a real supported device, complete the operator's keyboard-only path and review the same
    workflow with a screen reader. Verify focus order, visible focus, control names and states,
    status/error announcements, review actions, and recovery actions at the device's actual
    viewport and browser zoom.
12. In the Team Site browser, open the `management-consulting` TeamVersion under accuracy review, open Design and the
    Debug panel, enter a task, select `Sandbox`, and start the run with the default verified
    Backend/model selected by the v2 Harness Template (the current local target is Codex/
    `gpt-6-luna`). Record the exact Backend/model and Harness revision, readiness/verification result,
    and credential availability without exposing secrets. Verify the panel switches to the run view, role avatars/names and live
    messages appear, at least one message expands to show input/output/diagnostics, and active
    graph Flow edges use the animated green runtime style. Record TeamVersion, Simulation, batch and
    Run directory identities, final status, output listing and file readback before and after refresh,
    screenshots, and console errors.
13. Follow the `Open run directory` link and inspect the real controlled Run directory and output
    listing. Confirm events, timeline, audit, logs, and role output can be opened before and after a
    page refresh. Start a second Sandbox run, click Stop before completion, and record timestamped
    `stopping` then `stopped` state and the corresponding durable events. Repeat panel switch, return,
    scroll, directory/output links and refresh at desktop, tablet, and mobile viewports, recording
    each viewport size and capture. A missing selected Backend/model or credential, or a
    missing completed real Sandbox run, is a blocker; a mock runner does not satisfy these scenarios.
14. Verify directory ownership with one shared business workspace and two independent Team control
    roots. Run two different TeamVersions as formal Project Runs against the same Project Workspace
    and confirm each Run is stored only under its own `<ogs-dir>/.ogs/runs/<run-id>`, while business
    files remain directly in the shared workspace without generated `source/`, `destination/`, or
    workspace `.ogs` directories. This scenario does not share a Studio Simulation Workspace; each
    Simulation uses its own internal evidence-bound Workspace as described by the Workspace contract.
    Record both TeamVersion IDs, both Run IDs, the two control roots, the shared workspace path, and
    before/after directory listings.
15. Complete two formal Runs around a TeamVersion change. Capture the first Run's `team-version.json`,
    asset snapshot, digest, events, result, and output list before the change; after changing the
    TeamVersion, rerun the same Task workflow and verify the second Run records the new identity and
    digest while the first snapshot and output remain unchanged. Capture Task history, both Run
    details, and all relevant pages before and after refresh. Confirm Studio Simulation history stays
    in `.studio/simulations` and is absent from Project Task history and Run-owned collaboration
    outputs. Do not import or compare released v1 data.
16. Complete a real documentation collaboration through the supported Studio/CLI path. Start from a
    documentation request and source material with a recorded source digest. Use distinct Research,
    Drafting, Review, and Finalization Roles. A human reviewer records the decision and principal;
    verify its expected-state/CAS scope. Read the final collaboration output through its owning
    Task/Run and recorded Commit. Check source digest, links, terminology, completeness, review
    decision, and append-only Evidence; refresh and verify all cited evidence and output files remain
    readable.

17. Open Debug History for a completed branch, Join, quorum, loop, or review Run. Confirm the event
    list is collapsed by default, uses compact secondary typography with stable rows, is scrollable
    without changing page layout, and uses the same control sizing and visual language as the rest of
    the page. Expand decision
    events and verify the list shows decision background, selected route or loop action, contributing
    Role/node arrivals with timestamps and statuses, quorum calculation, `round`, `lineageId`,
    `branchId`, `loopIteration`, commit/evidence references, and the resulting state. Model request,
    token, and transport events must not appear as business events. Capture the same facts after a
    refresh and from the Run evidence/API read boundary. Product Owner reviews the formal Run and its
    collaboration output for semantic correctness and signs the scenario; browser evidence alone is
    not acceptance.

## Real team and Project coverage

The release must execute all four built-in teams twice: once through a real Studio Sandbox run and
once from a newly created formal Project with a new Task and a real Run. The formal Project run is
the acceptance authority; Sandbox proves the authoring and live-debug path and cannot replace the
Project run. A Project may contain several Tasks/Runs for positive, failure, and recovery cases.

| Pack | Formal Project run requirements | Required assertions and delivery evidence |
| --- | --- | --- |
| `cross-backend-review-loop` | Create a Project and Task, run Role A and Role B on two verified Backends, pass an explicit `WorkspaceRef`, then have an authorized reviewer make approval and rework decisions | Both Role executions occur; handoff projection and authorization are visible; human decisions are principal- and expected-state/CAS-bound; final Run records the full WorkspaceRef (immutable commit, relative path, digest), decision background, and evidence refs; final collaboration output is readable through the owning Task/Run |
| `management-consulting` | Create a Project and Task for a document or structured package; run specialist Roles in parallel, converge through Join and QA, and create a real Git LFS binary/media collaboration output | Role arrivals and Join/quorum facts are visible; source and `mergeCommit` are recorded; Framework Materialization manifest and output digest validate; Task/Run output preview, file read, download and refresh agree; LFS content restores and checksum-verifies |
| `software-team` | Create a Project backed by a real repository; run independent edits in parallel, force a same-file text conflict, resolve through Join, interrupt and resume, and perform restore and stale-head attempts | Worktrees have distinct `worktreeId`; prohibited Role Git mutations are denied and audited; Role commits and paths are traceable; `join_conflict` leaves canonical HEAD unchanged; `mergeCommit` and restore commit are valid; lock has `owner`, `leaseUntil`, `fencingToken`, and `expectedCanonicalHead`; stale CAS fails closed; code/test collaboration output is read through the owning Task/Run |
| `structured-debate` | Create a Project and Task with proposition and opposition Roles; run both branches, exercise quorum and a loop/review decision, and create a final brief | Both sides have real execution records; branch, quorum, loop, and review decisions show their background and evidence; final brief is generated from a recorded Commit and remains readable through Task/Run after refresh |

Across the four formal Projects, include at least one text output and one binary or media collaboration
output tracked through Git LFS. The binary/media file may be a real project input or generated output,
but it must pass through the same Workspace Commit, restore, Framework Materialization verification,
Task/Run file read and digest checks. No manually copied file outside the Workspace is accepted as
collaboration output evidence.

Each Sandbox run has a narrow user-facing assertion in addition to the formal Project run: the
cross-Backend team shows both real Role messages and the handoff/review state; the consulting team
shows Join progress and a browsable delivery; the software team shows live branch/Run state and the
decision event list; the debate team shows both proposition and opposition activity and the branch or
quorum outcome. Sandbox evidence demonstrates the browser path only; it cannot replace formal Project
Run, Commit, LFS, or Task/Run output evidence.

### Required companion Runs

The following cases are separate real Runs with their own Run IDs. They may reuse one of the four
Projects above, but each case must be triggered through the supported product path and leave its
failure or recovery state inspectable. When a failure cannot be induced safely from the UI, use a
Framework-approved deterministic fault-injection hook attached to the real Run; never insert a fake
event or edit persisted evidence by hand.

| Case | Companion Run required | Signal to record | Recovery result | Required Evidence Manifest readback |
| --- | --- | --- | --- | --- |
| Readiness and retry | A formal Task readiness attempt plus a retry Run after readiness is repaired; record a Run ID only if reservation occurred | Exact readiness error/event and code from the contract; if blocked before reservation, explicitly record `runId = null` for that attempt | No false success; retry uses a new Run ID; failed Run, if any, remains inspectable | Read the retry manifest and any failed Run manifest after refresh; verify owner, digest and references |
| Unauthorized `WorkspaceRef` | A formal Run with a Role requesting a path, commit, or Workspace outside its projected allow-set | `WORKSPACE_REF_UNAUTHORIZED` or the exact contract-defined denial signal | Handoff fails closed and no unauthorized bytes are read; Run remains inspectable | Read manifest and denial event; verify the unauthorized selector is not exposed as a valid reference |
| Join conflict | A formal Run whose two Role worktrees produce incompatible content at one path | `join_conflict` event; record a failure code only if the contract assigns one, otherwise state `failureCode = null` | Canonical HEAD remains unchanged; recovery resolves from the candidate without rerunning already committed Roles | Read pre- and post-recovery manifests and verify event/checkpoint/provenance references |
| Checkpoint interruption | A formal Run interrupted after a Role Commit and before the next durable transition | Record the contract-defined interruption state/code; explicitly record `failureCode = null` if interruption is represented by state/event only | Rebuild from committed references, skip the committed Role, and preserve lineage/state version | Read the manifest before interruption and after recovery; verify committed Role and checkpoint refs still resolve |
| LFS interruption | A formal Run with an interrupted upload or restore of a tracked object | Record the exact contract-defined LFS error, such as `WORKSPACE_LFS_UNAVAILABLE` or digest mismatch | Retry/resume verifies pointer and object checksum and does not expose a partial file | Read post-recovery manifest and file; verify LFS object ID, size and digest |
| Stale head | A formal Run where a guarded operation observes a canonical HEAD advanced after its expected-head snapshot | Exact contract stale-head code, such as `WORKSPACE_LOCK_STALE_HEAD` | Fail closed and retain candidate for recovery/rebase; do not expose unverified output | Read manifest/events after rejection and after recovery; verify candidate and evidence remain owned by the Run |
| Materialization failure | A formal Run whose Framework materialization fails after preparation, covering a defined code path | Persisted contract `failureCode`, including the exercised digest/store/candidate failure | No verified output is exposed; retry follows Framework policy and either succeeds with verified files or stays recoverable/failed | Read failed and retry manifests; verify failure record, owner and any successful file digests |
| Reconciliation | A formal Run interrupted after the canonical ref update and before Workspace Release finalization | Exact persisted reconciliation state and any contract `failureCode`; record `null` when the contract represents the window without one | Finalize only if canonical ref, Commit, manifest identity and digest agree; otherwise remain recoverable or fail closed | Read manifest before/after reconciliation and verify output files and all references resolve |
| External ref write | A formal Run with an authoritative ref changed outside the guarded Framework operation | Exact stale-head error code and ref/HEAD evidence | Next operation detects mismatch and fails closed; reconciliation is limited to the contract-defined post-update window | Read Run manifest after rejection; verify no false commit/output reference was added |
| Cleanup and retention | Separate formal Runs covering merged success and unmerged/recoverable candidate retention before cleanup | Exact cleanup result or contract rejection code; record `null` if cleanup succeeds without failure | Remove only eligible terminal Run worktrees/merged refs; retain unmerged candidates, checkpoints and required evidence; LFS garbage collection remains separate | Read Run, events and Evidence Manifest after cleanup; verify every retained event/checkpoint/provenance/output reference resolves |

Each row above requires its own Project/Task/Run ledger and evidence references. A deterministic test
or injected event without a formal companion Run does not satisfy the row. Do not invent failure codes:
use the contract-defined code/event, or explicitly record `failureCode = null` with the state/event that
represents the condition.

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
| Workspace Release/Materialization verification, manifest, digest, file access, and reconciliation | `management-consulting` and `software-team` Task/Run outputs plus failure/reconciliation companion Runs; verify the Workspace Release commit equals `mergeCommit` unless the Workspace contract records a content-changing commit |
| Decision event audit view | `structured-debate` Debug History Run, with browser capture and API/evidence cross-check |
| Backend readiness, capability freeze, fail-closed permissions, and cross-Backend execution | `cross-backend-review-loop` Project Run and readiness/authorization companion Runs |

For every formal Project Run, attach a single run ledger containing `projectId`, `taskId`, `runId`,
`workspaceId`, TeamVersion and code/schema digests, Backend/model snapshot, `baseCommit`,
`roleCommit` values, `mergeCommit`, and any Workspace Release commit/state needed to inspect guarded
ref updates or recovery. Include decision/event evidence, checkpoint references and commit
provenance, canonical lock/CAS evidence, Framework Materialization manifest identity/digest, output
digest or contract `failureCode`, Task/Run output file readback, browser captures, and required
operator/product-owner sign-off. Do not use an internal Release ID or state as the Project output
identity. The ledger is the minimum acceptance index, not a second runtime record.

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
| 1 | Workflow operator / Workflow operator | Pass | Project and Task IDs; page capture showing mounted TeamVersion, materials area, empty task list before creation, then queued Task without a Run ID. | Authorized browser-simulated workflow-operator acceptance on 2026-11-19: from the Software development TeamVersion page, used `用于项目` to create Project `v2-uat-scenario-1-2026-11-19-ec97bcb6`, Workspace `workspace-d7462fa77678fe969cdfcc91` (`git-lfs`), mounted TeamVersion `new-team-6258e432`, and Task `20261119-200714-f5ba5344`. The Project initially showed its mounted TeamVersion, materials area, and empty task list. The UI-created Task is `queued`, has `currentRunId=null` and `runIds=[]`, and remained identical after refresh; browser console/page errors were empty. Captures, SHA-256 digests, and the API readback are recorded in `evidence/v2-uat-scenario-01-browser-acceptance-2026-11-19.md`. |
| 2 | Workflow operator / Product owner | Blocked | Package/version and real implementation fixture; Task, TeamVersion, and Run IDs; per-role inputs/outputs and event history; changed source paths; passing tests or explicit rejection; Task/Run-owned collaboration output; before/after-refresh captures and Product Owner content review. | Follow-up attempt 2 completed the same Task `20261120-025502-3ebc9ceb` in Sandbox Run `20261120-030301-c9b852a5`; its Workspace Commit is `60194b009b8bcd9714bd4288271de8ac15e967bc`. The internal Workspace materialization record contains 8 files and validates against that Commit; all 12 fixture tests pass. Browser review verified income/expense totals, refresh persistence, storage-write error feedback, no console errors, and no overflow at 1440px or 375px. The first attempt remains recorded as failed with `GIT_COLLABORATION_MERGE_CONFLICT`; the successful retry has an all-of Join and clean canonical Workspace. The immutable Delivery Lead summary still conflicts with the verified files; Product Owner must review the source, implementation, test evidence, and final collaboration output and accept the result. Details and screenshot digests: `evidence/v2-uat-scenario-02-browser-run-2026-11-20.md`. |
| 3 | Workflow operator / Workflow operator | Blocked | Readiness blocker and displayed reason; Task Run history before/after retry; failed and retry Run IDs; evidence the blocked attempt reserved no Run and the failed Run remains inspectable. | Historical browser/API observation on 2026-11-19: Task `20261119-025948-b1f8f0ac` was blocked before Run reservation with `PROJECT_CONFIRMATION_STALE`; it remained `queued`, `currentRunId=null`, and `runIds=[]`. Its bound TeamVersion stored `projectDigest` (`8772b216c37df8a8f68f0bc1b4f5b8e7765e3e5df5e5724d576a7fe7514a9fd2`) differed from the current file digest (`fdb86e7fc9815be19c7a24ea79c8e59747da34fcdc27106d4cf828f91f886860`), while that older readiness response incorrectly reported `canDryRun=true`. The readiness path now uses the same confirmation check as Sandbox execution and reports stale trained TeamVersions as `canDryRun=false`; regressions: `apps/team-site/tests/project-readiness-use-cases.test.mjs`. The historical capture is `evidence/screenshots/v2-uat-project-task-readiness-block-2026-11-19.png`. Current service audit on 2026-11-20 found that Task ID absent from the active Projects and recent Runs APIs; the capture does not identify the bound TeamVersion, so the original TeamVersion cannot be verified or replaced from current records. The separately queried Software TeamVersion `new-team-6258e432` currently reports `ready: true`, but there is no evidence that it is the same binding or a retry for this Task. A fresh formal Project/Task record with a failed Run and successful retry is still missing; Scenario 3 remains Blocked. |
| 4 | Framework developer / Framework developer | Not run | Clean-machine OS/runtime and package version; install/configuration transcript; readiness result; minimal linear workflow inputs, outputs, and execution record. | Engineering package smoke on 2026-11-19T09:05:19+08:00 passed through isolated temporary install roots via both `npm` and `pnpm`; each covered tarball packing, installation, project creation, model sync, production Doctor, manifest generation, dry-run, and localhost Visualizer startup. Current source package `ogsystem@2.0.0` repeated the full smoke on 2026-11-20 and passed with both `pnpm` and `npm`. Both runs are isolated temporary installs on the development host, not a separate supported machine. A clean supported-machine transcript and operator record are still required before changing this status. |
| 5 | Workflow operator / Workflow operator | Pass | Branch-and-join fixture and Run ID; initial input; each Role's input/output and handoff; matching Visualizer capture and `/api/v2` requests/responses or saved records. | Workflow-operator review on 2026-11-20 of the fresh formal Sandbox Run `20261120-030301-c9b852a5` for Task `20261120-025502-3ebc9ceb`: the saved Join record is `all_of` with all three implementation sources arrived; `workspace_integrated` records successful integration; all five Role records and the initial Task input remain readable from Run evidence APIs. The Run manifest returned 1,628 event refs, 22 checkpoint refs, 5 provenance refs, and digest `sha256:367ee0bd85929572a7c72afee95eb22c071cae7463489896e816d3c01440fe63`. The Project's Visualizer graph shows the three branches converging on Delivery Lead; capture and API details are in `evidence/v2-uat-scenario-05-branch-join-browser-2026-11-20.md`. |
| 6 | Workflow operator / Workflow operator | Blocked | Human reviewer identity/principal; review request and Run ID; approve/rework decision IDs; expected state/version and CAS evidence; duplicate and stale decision request/response; before/after Run, checkpoint and canonical HEAD proving rejected requests made no change; resume evidence. | An operator with an authorized review principal must make and sign off the real decision. Agent preparation, API fixtures, or inferred identity cannot substitute. |
| 7 | Workflow operator / Workflow operator | Blocked | Failure-compensation route and audit evidence; interruption point; committed Role execution IDs/counts immediately before interruption and after recovery; resumed Run/event records proving each committed Role was not executed again; checkpoint/lineage readback; operator actions and timestamps. | Requires an operator to interrupt and resume through the supported workflow, then review no-duplicate-execution evidence. |
| 8 | Framework developer / Framework developer | Pass | Timestamped `/metrics`, `/healthz`, and `/readyz` responses from the final v2 build; redaction inspection noting which labels/summaries were checked and confirming prompt/result content is absent. | Engineering check on 2026-11-19T05:44:35+08:00 against restarted Team Site `http://127.0.0.1:4173`: `/healthz` returned HTTP 200 `{"status":"ok"}`; `/readyz` returned HTTP 200 `{"status":"ready"}`; `/metrics` returned HTTP 200 with `ogs_team_site_http_requests_total`, `ogs_team_site_http_responses_total{status="200|503"}`, and `ogs_team_site_process_uptime_seconds`. Inspected every emitted metric name, label, and value: no URL, prompt, or result content is collected or exposed. |
| 9 | Workflow operator / Workflow operator | Blocked | Desktop, tablet, and mobile dimensions; screenshots/recording showing a real graph, exact failure location, real pending review, and next permitted action; responsive operation of those controls; overflow/overlap/focus/browser-error findings and issue IDs; operator sign-off. | Project-list/card UX review and failed-Run responsive review are subcases only. A real pending Review, the complete operator flow at all required viewports, and workflow-operator sign-off remain outstanding. |
| 10 | Workflow operator / Product owner | Blocked | TeamVersion and Simulation/Run IDs; recording with Team assets open while X6 connects the selected graph ports; opened relationship editor; saved source/target endpoint readback; Global configuration retained in Team assets; localized Start/End labels; viewport and console record. | Automated Studio design regression covers part of the geometry and save path. Browser review of isolated draft `v2-uat-scenario-10-graph-editor-2026-11-21-6efe75a9` confirmed the persisted `开始 -> 流程负责人` edge and endpoint readback after refresh, Global configuration in the Team configuration side panel, localized `开始`/`结束` labels, and no console errors. A separate test on draft `v2-uat-draft-initializer-validation-2026-11-21-9334be89` used X6 to save `Start -> Anthropologist -> owner -> End`; the conversion and save APIs returned HTTP 200, and the graph plus Anthropologist display name survived refresh. This exposed and fixed V2 role-package normalization on the conversion path and the projector's V1-only saved-draft check. The AI Builder was unavailable during this attempt, so it was completed through the role-library and graph controls. Evidence and screenshot digest are in `evidence/v2-uat-scenario-10-graph-editor-engineering-2026-11-21.md`. On the designated TeamVersion, Global-panel and default-edge readback evidence exists; the successful edited X6 flow recording, TeamVersion content review, and Product Owner sign-off remain outstanding. Scenario 10 stays Blocked. |
| 11 | Accessibility evaluator / Accessibility evaluator | Blocked | Device model/OS, browser/version, assistive technology/version, viewport/zoom; keyboard path and focus order; screen-reader names, states, and announcements; recording or notes for any blocker and its reproduction steps. | No real supported device or screen reader is available in this execution context; accessibility evaluator owns completion. |
| 12 | Workflow operator / Product owner | Blocked | TeamVersion, Simulation, batch and Run-directory identities; exact Backend/model and Harness binding revision; Harness readiness/capability result; Sandbox final status; role transcripts and expanded diagnostics; Flow capture; Workspace Materialization manifest and output digest; output listing and file readback before/after refresh; URLs, screenshots, console log and Product Owner review. | Earlier Sandbox evidence: TeamVersion `20261121-f99e2da4`, digest `e5fea62a866379d9edf5a763d6d24ffbd09944eda14fc836f00095deb58cab9d`; Simulation `0aedf2c3-9401-4f57-8ffb-daaedb20b372`; completed 9/9. Follow-up isolated Sandbox evidence against the corrected built-in template: TeamVersion `new-team-0a679c45`, digest `b83d8346262b91f164a825597d60f39262f179f006187d1ca787abd7f9c5cbc3`; Simulation `4ee361dd-3002-48b1-b25a-fa208e8464c5`; completed 9/9; readiness reports `baselineReady=true`, `roleContractReady=true`, `accuracyReady=false`, `ready=false`; Evidence Manifest digest `sha256:09833ac95182d3aadb9e30b6e145a822647644e85c9a19505e347a05d253d39d`; materialized `executive-brief.md` reads successfully. The legacy sealed verification-report lookup returns `STUDIO_SIMULATION_VERIFICATION_NOT_FOUND` because this V2 Workspace Simulation has no `shared/verification.json`; that endpoint is not part of the Workspace contract or Scenario 12 evidence requirement. Use the Harness readiness/capability snapshot and verified Workspace Materialization manifest/output digest as the relevant machine checks. A distinct immutable Harness binding revision is not persisted in this Sandbox record and must be captured in a formal companion run. Both runs are Sandbox evidence, not formal Project/Task/Run acceptance. Workflow-operator and Product Owner content review/sign-off remain outstanding. Scenario 12 stays Blocked. See `evidence/v2-team-accuracy-review-management-consulting-follow-up-2026-11-21.md`, `evidence/v2-team-accuracy-review-management-consulting-2026-11-21.md`, and `evidence/v2-team-role-contract-training-gate-2026-11-21.md`. |
| 13 | Workflow operator / Product owner | Blocked | Second Simulation and Run-directory IDs; selected Backend/model and verification result; output list/file read before/after refresh; Stop request plus timestamped `stopping` and `stopped` states/events; desktop, tablet and mobile dimensions/captures; console record and review. | Requires a live run long enough to exercise graceful stop. A missing selected Backend/model or credential is a blocker; the current local engineering target is Codex/`gpt-6-luna`, while OpenCode/Pi may be selected only when their own readiness probe passes. |
| 14 | Framework developer / Product owner | Not run | Two independent Team control roots and one shared business Workspace; Project, Workspace, two TeamVersion, two Task and two Run IDs; before/after listings; Run-owned evidence location; no generated Workspace `.ogs`, `source`, or `destination`; framework-developer review and Product Owner sign-off. | Engineering evidence records Project `v2-shared-workspace-boundary-fixed-20261119-c7222311`, Workspace `workspace-cccd17fea396ccb1053c56b5`, shared path `/tmp/ogs-v2-uat-shared-workspace-fixed.k2YSzf`, two TeamVersions, Tasks and Runs, and the initial/final listings in `evidence/v2-workspace-boundary-two-team-runs-2026-11-19.md`. The reviewer must confirm the two distinct control roots against the shared Workspace and the current Run ownership contract; the row remains Not run until both reviewers sign. |
| 15 | Framework developer / Product owner | Not run | First and second formal Run IDs around a TeamVersion mutation; before/after `team-version.json`, asset snapshots, digests, events, result and output reads; Task history; Studio Simulation and Project history; desktop/mobile refresh captures; reviewer sign-off. | Existing freeze/namespace engineering evidence records immutable-version rejection and namespace isolation in `evidence/v2-team-version-freeze-namespace-engineering-2026-11-19.md`; it does not contain the required pair of Run snapshots and refresh evidence. The row remains Not run pending that review and framework-developer/Product Owner sign-off. |
| 16 | Workflow operator / Product owner | Blocked | Documentation request, source files and source digest; explicit Research, Drafting, Review and Finalization Role identities with inputs/outputs; reviewer principal and decision; decision expected-state/CAS scope; final Task/Run-owned output Commit and digest; link, terminology, completeness and append-only Evidence checks; refresh readback; workflow-operator and Product Owner review. | A historical engineering execution record exists in `docs/development/evidence/v2-gate-c-real-workflow-success-2026-11-16.md`, but it predates the final Workspace contract and cannot close this row. A new workflow and both sign-offs remain outstanding. |
| 17 | Workflow operator / Product owner | Blocked | Formal Project/Task/Run IDs for a branch, Join, quorum, loop, or review case; desktop/mobile Debug History captures; expanded decision details; refresh capture; matching event/Evidence Manifest read response; collaboration output Commit/digest and content review; browser console record; Product Owner sign-off. | Fresh Sandbox Run `20261120-063220-949c69f3` for Task `20261120-062953-427f5a68` provides direct rework-loop engineering evidence. Run, event response, Evidence Manifest digest, internal Materialization digests, desktop/mobile captures, refresh, and zero-console-error review are recorded in `evidence/v2-uat-scenario-17-rework-loop-browser-2026-11-20.md`. Cursor paging now displays all 13 decision/transition events. Product Owner must still review the formal Run and its collaboration output for semantic correctness and sign off; Scenario 17 remains Blocked. Earlier Runs and the Codex SQLite failure remain in prior records. |
| 18 | Workflow operator / Product owner | Blocked | For each of four built-in teams: TeamVersion ID/digest, completed real Sandbox Simulation ID and ledger, newly created formal Project/Task/Run IDs and ledger, role/event history, output file list/content and refresh readback. Across the four Projects, verify at least one Git LFS binary/media collaboration output and a text/structured output through the owning Task/Run. Include browser captures, workflow-operator review and Product Owner content review/sign-off. | Existing baseline and formal Run IDs are in `evidence/v2-four-team-coverage-engineering-2026-11-19.md`, and browser review is in `evidence/v2-four-team-browser-review-2026-11-20.md`. Those records expose content/evidence discrepancies and do not yet provide a fully reviewed Sandbox plus newly created formal Project/Task/Run ledger and output-content acceptance for each team. Scenario 18 remains Blocked. |
| 19 | Framework developer / Product owner | Blocked | Companion Run IDs for readiness, unauthorized WorkspaceRef, Join conflict, checkpoint interruption, LFS interruption, stale head, materialization failure, reconciliation, external ref write, and cleanup/retention; failure codes, recovery evidence, Evidence Manifest readback, and proof retained references still resolve after cleanup. | Local deterministic checks are recorded in `evidence/v2-workspace-fault-injection-2026-11-18.md`, `evidence/v2-workspace-fault-injection-audit-2026-11-19.md`, and the 2026-11-20 no-content-change Release lock/CAS audit `evidence/v2-noop-release-lock-cas-audit-2026-11-20.md`; these are engineering evidence only. A live cleanup attempt for Project `v2-uat-structured-debate-1795057638883-d38a811b`, Task `20261120-051853-a8b5fb78`, Run `20261120-051917-b467b893` first failed closed on `ENOSPC` before creating a lock or removing worktrees. After storage recovered, retry returned HTTP 200, removed its 6 worktrees and 6 merged branches, and the Run, 33 events, Evidence Manifest (2,241 event refs, 18 checkpoints, 1 provenance), and the Workspace Release record in its internal `published` state remained readable with canonical HEAD unchanged. Details: `evidence/v2-workspace-follow-up-validation-2026-11-20.md`. Scenario 19 remains Blocked because readiness, unauthorized WorkspaceRef, Join conflict, checkpoint/LFS interruption and recovery, stale head, materialization failure, reconciliation, external ref write, and Product Owner review remain outstanding; deterministic tests or injected events alone cannot close it. |

Supplemental UX evidence for Scenario 9: the Project library action controls were checked against
all visible card bounds at desktop and mobile sizes in
[`evidence/v2-project-library-ux-review-2026-11-20.md`](evidence/v2-project-library-ux-review-2026-11-20.md).
The reported card-button overflow was not reproducible on the current build. A project-creation
readiness race was fixed and rechecked by full browser regression in
[`evidence/v2-project-creation-readiness-ux-2026-11-20.md`](evidence/v2-project-creation-readiness-ux-2026-11-20.md).
These engineering checks do not cover the required graph, failure, review, tablet, accessibility, or
operator-flow acceptance; Scenario 9 remains Blocked.

## Historical Materialization Evidence

The records below predate the current product boundary and retain their original terminology for
traceability. Project Release is not a current Project entity, API, or acceptance target. Current
acceptance treats verified files as collaboration outputs owned by a Task Run; historical records
do not satisfy that current user-flow evidence by themselves.

The earlier formal Project attempt is recorded in
[`evidence/v2-formal-software-project-run-2026-11-19.md`](evidence/v2-formal-software-project-run-2026-11-19.md).
It reached `completed` in `sandbox` mode and persisted five Role results, but its
Project Releases response was empty and the result was explicitly a delivery plan,
not an implementation or deployment. It is therefore retained as engineering
evidence only; it does not change any UAT row to `Pass` or close the formal Project
coverage gate.

The corrected formal Project Runs are recorded in
[`evidence/v2-formal-software-project-release-2026-11-19.md`](evidence/v2-formal-software-project-release-2026-11-19.md).
The latest run reached `completed` in `sandbox` mode and published Release
`release-20261119-084816-966ecb55`; the Project API returned its manifest, output
digest, and `.gitattributes` file. The earlier Release
`release-20261119-073808-e0eadaac` remains in the same ledger for traceability.
The selected software Release contains no LFS binary/media object. Separate current engineering
evidence now records a published Git LFS PNG through a structured-debate Project Release and
formal Project/Task/Run/Release paths for all four built-in teams in
[`evidence/v2-formal-structured-debate-collaboration-project-release-2026-11-19.md`](evidence/v2-formal-structured-debate-collaboration-project-release-2026-11-19.md)
and [`evidence/v2-four-team-coverage-engineering-2026-11-19.md`](evidence/v2-four-team-coverage-engineering-2026-11-19.md).
These engineering records do not close the row: workflow-operator and product-owner review,
browser refresh evidence, and required companion Runs remain open.

Additional LFS event-path engineering evidence for scenario 2: from the Team Site UI, Task `20261119-052706-aaaf5651` (Task 10) completed Run `20261119-052737-861d9126` on TeamVersion `new-team-449bf6e4`. Published Release `release-20261119-052737-861d9126` uses Workspace `workspace-e6da5d3c658b02f9d2411f00`, commit `6a11a6edb54436fa60d4b780a9117f8b9b563081`, manifest digest `sha256:ebb58b87566e042ed7c8058363a7dead6e1bf2aff752912686678fb1ecfe256b`, and output digest `sha256:2975b1f115e33dddc299f9082a738c27013f4b8efed6af3dc344b93b60bda461`. The changed Role's `result_committed` event records `sha256:4d2f45456384d4c73cd9a04001a1a5a884070af8f547b033e3187a4555112790`; this matches the Git LFS pointer, Release Manifest, and restored PNG digest. The PNG is 640×360 RGB, `git lfs fsck` passes, and all 5,260 event IDs are unique. UI capture: `evidence/screenshots/v2-uat-workspace-lfs-release-2026-11-19.png`. Engineering evidence is recorded; operator refresh comparison, role-by-role review, and operator/product-owner sign-off remain outstanding.

Implementation audit follow-up on 2026-11-19: `WorkspaceCoordinator.restore()` now claims the canonical lock and verifies owner, fencing token, live lease, and canonical HEAD before and after producing the restore commit; the canonical ref remains unchanged. Workspace event validation now rejects incomplete `join_quorum_reached` payloads and malformed optional source snapshots. Release validation rejects `downloadReference` in `prepared` and `failed` states. Collaboration Project metadata reads reject a missing Workspace ID or any backend other than `git-lfs`. Release reconciliation now completes only when canonical HEAD already equals the recorded Release commit; retrying `workspace.release` recovers the known post-CAS write window without performing a second CAS. Project Run cleanup is callable through the owner-checked Run API, removes only the terminal Run's worktrees, and prunes refs only when their commits are ancestors of canonical HEAD under the lock; unmerged candidates remain. A real temporary Git + LFS integration check verifies cleanup retains the candidate branch and commit. Run-owned Evidence manifests are generated from persisted events, checkpoints, provenance, and review records and remain readable through the owning Project/Task/Run evidence API after cleanup. At that audit point, `pnpm test` passed: core 471 passed / 1 Windows-only skipped, Team Site 68 passed. These are implementation and engineering-test results only. The UAT count at that point was 1 Pass, 12 Blocked, and 6 Not run; with the four Pass rows in the Documentation and Contract Freeze Gate, that was 5 Pass, 12 Blocked, and 6 Not run overall. After the authorized browser-simulated acceptance recorded in `evidence/v2-uat-scenario-01-browser-acceptance-2026-11-19.md`, Scenario 1 and the existing health/metrics Scenario 8 are Pass; before the four-team browser review, UAT count was 2 Pass, 11 Blocked, and 6 Not run. The four-team browser review on 2026-11-20 moved Scenario 18 from Not run to Blocked. A later audit confirmed that the branch/Join observed on the Scenario 2 Run cannot close Scenario 5 because the semantic scenario requires its own fresh Run; at that point Scenario 5 remained Blocked. The follow-up fresh Run satisfies Scenario 5. After the Scenario 17 Project Debug History review recorded in `evidence/v2-project-debug-history-acceptance-2026-11-20.md` and the Scenario 19 live cleanup attempt recorded in `evidence/v2-workspace-follow-up-validation-2026-11-20.md`, current UAT is 3 Pass, 13 Blocked, and 3 Not run; together with the four Documentation and Contract Freeze Gate Pass rows, the total is 7 Pass, 13 Blocked, and 3 Not run. Scenario 2 remains Blocked for product-owner review, and other Project/Task/Run fault scenarios and required human sign-offs remain release blockers.

Second implementation audit follow-up on 2026-11-19: cleanup now re-reads the canonical HEAD and persisted lock immediately before and after Run worktree removal; a stale-head regression advances the canonical ref after lock acquisition and verifies cleanup rejects before removal while the candidate worktree, branch, and commit remain. The shared Materialization manifest validator and both Release readers require `manifestId === "${releaseId}:materialization"`. Release failure handling now records `CANDIDATE_INVALID` for invalid Git candidates, `MATERIALIZATION_FAILED` for missing committed LFS objects, `OUTPUT_DIGEST_MISMATCH` for output/manifest disagreement, and `RELEASE_STORE_UNAVAILABLE` for materialization-store I/O failures; all failure records omit download references. Project Run query reads reject missing Workspace IDs and any `workspaceBackend` other than `git-lfs`. The final targeted build and contract/integration checks passed 27/27 across `tests/workspace-contracts.test.mjs`, `tests/workspace-coordinator.test.mjs`, `apps/team-site/tests/file-project-release-store.test.mjs`, and `apps/team-site/tests/run-evidence-manifest.test.mjs`. These remain engineering checks and do not change UAT sign-off status.

Cleanup race follow-up: `tests/workspace-coordinator.test.mjs` now also advances canonical HEAD from inside Run worktree removal. Cleanup rejects the stale head after checkout removal; the unmerged branch and commit, generated Evidence Manifest and event remain readable, and a new worktree is rebuilt from the candidate commit. Build and all 11 Workspace coordinator tests passed. This is deterministic engineering evidence only; it does not close Scenario 19.

Contract audit follow-up on 2026-11-20: GraphRunner now validates registered Workspace events before routing them through either the default filesystem writer or an injected Runtime audit port. `result_committed` content-commit payloads require their contract `runId`, malformed commit values cannot fall back to the result-state projection form, and the fallback producer supplies the required field. The contract recovery table now covers invalid and digest-mismatched manifests and malformed Run event evidence. The previously reviewed cleanup stale-head, materialization manifest identity, Release failure-code mapping, and Project Workspace binding checks remain covered by the targeted regression tests. `pnpm test` passed on this source state: core 483 passed / 1 Windows-only skipped and Team Site 69/69 passed. This remains engineering evidence and does not change UAT status or human sign-offs.

Review follow-up on 2026-11-20: Studio Simulation Evidence Manifest verification now decodes URI-encoded event IDs before comparing them with persisted event IDs; its regression case covers IDs containing `#` and `%`. Materialization reconciliation now reports `OUTPUT_DIGEST_MISMATCH` when output bytes differ from the manifest digest even if the file length is unchanged. The targeted Simulation Manifest, Workspace coordinator, and Workspace contract suites passed 28/28 tests. These are engineering checks only; UAT remains 3 Pass, 13 Blocked, and 3 Not run (7 Pass, 13 Blocked, and 3 Not run including the four documentation-freeze gates), and this follow-up does not close any UAT scenario or release sign-off.

Current-source release engineering recheck on 2026-11-20: full `pnpm test` completed successfully, including Build and Team Site 77/77; `pnpm run smoke:package-install:pnpm` and `pnpm run smoke:package-install:npm` both passed the isolated package-install lifecycle; `pnpm run test:docs-command-drift` passed; and `pnpm run test:visualizer-browser` passed Studio graph/workflow 17/17 and Build layout 4/4, with 2 deployment-only Studio tests skipped. Current live Project-library browser measurements at 1602px and 390px found no card-button overflow, page overflow, or console errors. These are engineering checks; Scenario 4 remains `Not run` pending a separate supported machine, Scenario 9 remains `Blocked` pending real Project operator-flow evidence and sign-off, and no UAT status is changed by this recheck.

Scenario 17 follow-up on 2026-11-20: a new formal structured-debate Sandbox Run `20261120-063220-949c69f3` exercised the second `NEEDS_REWORK` loop and second 2/2 Join, and the Run, manifest, published decision brief, desktop/mobile Debug History, refresh, and browser console were checked. The check exposed Project Debug History truncation at 20 business events; cursor-based event paging now accumulates the full history, covered by `apps/team-site/tests/run-poll.test.mjs`. The Run and Release explicitly say `NEEDS_REWORK` and do not assert V2 acceptance. Product Owner review and sign-off remain outstanding; Scenario 17 stays Blocked.

TeamVersion training boundary follow-up on 2026-11-20: a structurally valid TeamVersion becomes an immutable trained version eligible for Project mounting after its required Sandbox baselines pass. Projects record collaboration through Task Runs and their shared Workspace; materialized files are collaboration outputs, not Project Releases. The implementation validates the TeamVersion frozen asset digest before Project creation/mount and before Task Run reservation, and validates Simulation Evidence Manifest integrity for required Sandbox baselines without requiring Project-level publication. Regression tests cover stale-version mount rejection, successful mount preserving the exact TeamVersion ID/digest, and stale-version rejection before Run reservation. Full `pnpm test` passed on this source state: core 486 passed / 1 Windows-only skipped, Team Site 83/83, and Build passed. This closes the identified engineering gaps only; it does not change formal UAT status (3 Pass, 13 Blocked, 3 Not run; 7 Pass, 13 Blocked, 3 Not run including documentation gates) or human sign-offs.

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
- At least one formal Project Task Run exposes a Git LFS tracked binary or media collaboration
  output and a text or structured collaboration output, both read through the owning Task/Run path
  and digest-verified against the Run's Workspace commit.
- The Debug History audit scenario proves the user can inspect branch, Join, quorum, loop, review,
  decision background, Role arrival timing/status, commit/evidence references, and final outcomes
  without model request events being presented as business events.
- No active V2 schema, API, UI, checkpoint, or acceptance record exposes legacy public
  content-reference names; occurrences in explicitly marked internal transition notes or private
  implementation modules are allowed and do not define a public contract.
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

Supplemental product-expression and Task-owned output UI evidence: the current Project page and
Run output viewer were rechecked through Orca and Playwright on 2026-11-20, including refresh and
responsive widths. The managed Team Site was restarted to load the new collaboration-output API
route. Details, Project/Task/Run IDs, screenshot digest, and remaining sign-off boundary are in
[`evidence/v2-product-expression-collaboration-output-browser-2026-11-20.md`](evidence/v2-product-expression-collaboration-output-browser-2026-11-20.md).

Supplemental Project library UX evidence: status categories, Team filtering, team-structure links,
whole-page scrolling, mobile width, and trained Team wording were checked through Playwright and
Orca on 2026-11-20. Scenario 9 remains Blocked for the still-missing real pending-Review workflow,
complete operator flow, and workflow-operator sign-off. Details and capture are in
[`evidence/v2-project-library-categories-scroll-browser-2026-11-20.md`](evidence/v2-project-library-categories-scroll-browser-2026-11-20.md).

Current-source automated recheck on 2026-11-22: full `pnpm test`, package-install smoke through npm
and pnpm, documentation command-drift check, and visualizer browser regression passed. Studio
graph/workflow passed 17/17 with two deployment-only cases skipped; Build layout passed 4/4 after
refreshing the desktop screenshot baseline for the current 15px workbench inset. `git diff --check`
passed. This engineering evidence does not change the UAT status or close human, external-provider,
deployment, supported-machine, or Windows requirements. Details are in
[`evidence/v2-automated-release-recheck-2026-11-22.md`](evidence/v2-automated-release-recheck-2026-11-22.md).
