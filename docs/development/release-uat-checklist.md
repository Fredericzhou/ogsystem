# OGSystem Release UAT

This checklist gates the first stable local-first release. It starts from a clean install and a
new project; historical development data and interfaces are not migration or compatibility targets.

## Participants

- Framework developer: checks install, configuration diagnostics, API contracts, and recovery evidence.
- Workflow operator: completes the scenarios without editing runtime files by hand.
- Product owner: records pass/fail and accepts any non-blocking findings.
- Accessibility evaluator: completes the real-device keyboard and screen-reader scenario; this may be the workflow operator when appropriately equipped.
- At least one real target workflow is required in addition to repository examples.

## Scenarios

1. From the `Software development` classic team page, choose `Use for a project`, create a
   collaboration project, and confirm the project page shows the mounted TeamVersion, project
   materials area, and an empty task list. Record a request for a first release plan for a
   freelancer bookkeeping product. Confirm it appears as one queued Task with no Run ID.
2. Use `Isolated run` with a ready provider and complete the Task through the page. The result
   must address the request and include an implementation breakdown, user experience, acceptance
   checks, and delivery integration. Inspect the Run page evidence: the five classic roles,
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
   the Visualizer Flow view, then verify the event stream and execution records through `/api/v1`.
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
12. In the Team Site browser, open the `management-consulting` classic team, open Design and the
    Debug panel, enter a task, select `Sandbox`, and start the run with the default OpenCode
    `gpt-6-luna` model. Verify the panel switches to the run view, role avatars/names and live
    messages appear, at least one message expands to show input/output/diagnostics, and active
    graph Flow edges use the animated green runtime style. Record the TeamVersion ID, Simulation
    ID, final status, artifact URL, screenshots, and console errors.
13. Follow the `Open run directory` link and inspect the real controlled artifact listing. Confirm
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
    snapshot, digest, events, and result remain unchanged; the next Run records the new TeamVersion
    and digest. Confirm Studio Simulation history remains in `.studio/simulations` and is absent from
    Project Task history and Deliverables.

## Manual Evidence Record

Create one record for every scenario. The initial status for every row is **Not run**; change it
only after performing the scenario and attaching the listed evidence. Each row names one executor
role and one sign-off role; record the individuals, date, and evidence reference when run. Use
**Blocked** when an environment or device is unavailable, and record the blocker, dependency, and
responsible person. A blocked or evidence-free row is not a pass.

| Scenario | Executor / sign-off role | Status (Not run / Pass / Fail / Blocked) | Required evidence to attach | Evidence, individuals, date, blocker/dependency, issue IDs |
| --- | --- | --- | --- | --- |
| 1 | Workflow operator / Workflow operator | Blocked | Project and Task IDs; page capture showing mounted TeamVersion, materials area, empty task list before creation, then queued Task without a Run ID. | Executor unavailable in this run; workflow operator must perform and record IDs/captures. |
| 2 | Workflow operator / Product owner | Blocked | Package/version and real target workflow fixture; Task, TeamVersion, and Run IDs; role-by-role inputs/outputs and event history; final result; before/after-refresh page captures. | Engineering preflight, 2026-10-19: a real Codex sandbox Task completed through Team Site APIs in an isolated temporary workspace (TeamVersion `new-team-b3801b04`, Project `resource-baseline-2026-10-19-1258cab4`, Task `20261019-091342-7161a440`, Run `20261019-091342-a0120fe0`, 8 events; Task completed, Run/events APIs HTTP 200). The result and page refresh were not captured for human review; workflow operator and product owner must still execute/review the page workflow and sign off. |
| 3 | Workflow operator / Workflow operator | Blocked | Readiness blocker and displayed reason; Task Run history before/after retry; failed and retry Run IDs; evidence the blocked attempt reserved no Run and the failed Run remains inspectable. | Requires workflow operator to execute and record the page flow. |
| 4 | Framework developer / Framework developer | Pass | Clean-machine OS/runtime and package version; install/configuration transcript; readiness result; minimal linear workflow inputs, outputs, and execution record. | Framework developer, 2026-10-27, macOS 26.6.2, Node v22.21.1, pnpm 10.33.2, OGSystem 1.0.0. Re-ran `pnpm run smoke:package-install:npm` and `pnpm run smoke:package-install:pnpm` against the current worktree; both packed the package, installed into isolated temporary homes, created a project and executor, passed `ogs doctor --production`, ran the minimal linear workflow, and ended `package install smoke passed`. Prior 2026-10-19 evidence retained in the execution history. |
| 5 | Workflow operator / Workflow operator | Blocked | Branch-and-join fixture and Run ID; initial input; each Role's input/output and handoff; matching Visualizer capture and `/api/v1` requests/responses or saved records. | Requires workflow operator to perform the scenario and verify the delivered flow. |
| 6 | Workflow operator / Workflow operator | Blocked | Review request and Run ID; approve/rework decision IDs and attributed principals; resume evidence; duplicate/stale request and response; before/after state proving rejection made no change. | Requires an operator with a review principal to perform and sign off. |
| 7 | Workflow operator / Workflow operator | Blocked | Failure-compensation route and audit evidence; interruption point; committed Role execution IDs/counts immediately before interruption and after recovery; resumed Run/event records proving each committed Role was not executed again. Include operator actions and timestamps. | Requires an operator to interrupt, recover, retry, and verify no committed role repeats. |
| 8 | Framework developer / Framework developer | Pass | Timestamped `/metrics`, `/healthz`, and `/readyz` responses; redaction inspection noting which labels/summaries were checked and confirming prompt/result content is absent. | Framework developer, 2026-10-19 08:35 CST, macOS 26.1. Started Visualizer on `127.0.0.1` with an isolated temporary workdir. `/healthz` returned HTTP 200 `{"status":"ok"}`; `/readyz` returned HTTP 200 `{"status":"ready"}`; `/metrics` returned HTTP 200 Prometheus text with request/response and SSE counters. Inspected complete response: no prompt, final-output/result, secret, token, or API-key fields. Temporary process and workdir were removed. |
| 9 | Workflow operator / Workflow operator | Blocked | Desktop, mobile, and viewport dimensions; screenshots or recording showing graph, failure location, pending review, and next lifecycle action; overflow/overlap findings and issue IDs. | Automated evidence, 2026-10-27: root and Team-Site suites passed; `visual-acceptance.test.mjs` passed on isolated browser fixtures. Live Team Site screenshots and geometry checks passed at 1440×1000 and 390×844 without horizontal page overflow. This run found and fixed a mobile Studio graph toolbar clipping issue; regression now verifies its horizontal scroll rail and confirms Save is fully visible at the rail end. Manual operator-flow screenshots, tablet comparison, and product-owner sign-off remain outstanding. |
| 10 | Workflow operator / Product owner | Blocked | TeamVersion and Run IDs; screen recording showing the Team assets panel open while connecting two graph ports; saved Flow endpoints/event/business label; Global panel state; Start/End flow labels; any console errors. | Automated Studio design regression keeps Team assets open, verifies both connection ports are outside the panel bounds, creates the Flow, and saves its business label. The combined flow is covered automatically, but no human-reviewed screen recording and release sign-off are recorded yet. |
| 11 | Accessibility evaluator / Accessibility evaluator | Blocked | Device model/OS, browser/version, assistive technology/version, viewport/zoom; keyboard path and focus order; screen-reader names, states, and announcements; recording or notes for any blocker and its reproduction steps. | No real supported device or screen reader is available in this execution context; accessibility evaluator owns completion. |
| 12 | Workflow operator / Product owner | Blocked | TeamVersion ID, Simulation ID, OpenCode/model configuration, final status, role transcript captures, expanded diagnostic capture, green Flow capture, artifact URL, console log. | Requires a real browser workflow and available OpenCode `gpt-6-luna` credentials; mock or API-only execution does not count. |
| 13 | Workflow operator / Product owner | Blocked | Artifact listing and file captures before/after refresh; second Simulation ID; stop request and `stopping`/`stopped` timestamps; desktop/tablet/mobile viewport evidence. | Requires a live run long enough to exercise graceful stop and a real browser. |
| 14 | Framework developer / Product owner | Not run | Two control roots, one shared workspace path, two TeamVersion IDs, two Run IDs, before/after directory listings, and proof that no workspace `.ogs`, `source`, or `destination` directory was generated. | Must be executed against the new control-root/workspace contract. |
| 15 | Framework developer / Product owner | Not run | v1 and v2 TeamVersion IDs and digests; unchanged v1 Run manifest, asset snapshot and result; v2 Run evidence; Studio Simulation and Project history listings. | Must prove version freezing and Studio/Projects namespace isolation. |

## Release Gate

Automated page evidence, separate from the manual scenarios above: Team Site Playwright test
`apps/team-site/tests/classic-team-flow.test.mjs` clicks through classic team selection, project
creation, Task recording, readiness blocking, Run start, full-result expansion, retry, historical
attempt inspection, and the Studio diagnostic link. The test starts both Projects and Studio on
isolated temporary roots. It verifies the linked TeamVersion/Task/Run ownership, rejects a
diagnostic request with a mismatched Task, confirms active Run controls are hidden and cannot be
clicked, checks that no control write request is sent, and compares Task/Run API state before and
after the diagnostic visit. It also checks desktop, 390px mobile, and 768px tablet layout. This is
automated evidence only; it does not close operator, product-owner, target-model, Windows, or
real-device accessibility scenarios.

Resource baseline: **Recorded; product owner review pending**. Framework developer, 2026-10-19 09:13 CST, OGSystem 1.0.0, macOS 26.6.2, Node v22.21.1, Codex CLI, released Software development TeamVersion `new-team-b3801b04`. One representative sandbox Task for a freelancer bookkeeping first-release plan completed in 58,865 ms. Workload: 1 Project, 1 Task, 1 Run, 8 Run events, 0 materials. Project workspaces occupied 104,259 bytes before Run execution and 643,301 bytes after it (539,042-byte increase). Peak sampled Team Site process-tree RSS was 380,976 KiB (about 372 MiB), sampled every 250 ms. Task completed; Run and events APIs returned HTTP 200. The isolated workspace was removed after measurement; no prompt or result body was retained in this record. No product workload/resource commitment was found, so no capacity threshold is proposed from this single-run baseline. Product owner must confirm user impact and whether this workload is representative enough to decide if a capacity limit is needed.

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
