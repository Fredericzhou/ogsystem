# OGSystem Release UAT

This checklist gates the Contract Set v2 local-first release. It starts from a clean install and a
new project; historical development data and interfaces are not migration or compatibility targets.

## Workspace terminology

This checklist uses `Release materialization` for the final file or media delivery produced from a
recorded Git commit. During the refactor, existing UI or evidence fields may still use `artifact` in
their name; those fields must be renamed before the final V2 acceptance run. The temporary name is
an implementation label for run evidence or a delivery package, not an independent Workspace
content version, and no compatibility alias remains after cleanup.

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
