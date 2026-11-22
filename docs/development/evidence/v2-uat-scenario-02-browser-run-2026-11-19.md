# V2 UAT Scenario 2 Browser Run Evidence

> **Evidence type: authorized browser-simulated workflow-operator execution.** Product-owner acceptance
> is still outstanding, so Scenario 2 remains `Blocked`.

## Execution

- Scenario: [`release-uat-checklist.md`](../release-uat-checklist.md), Scenario 2
- Executor: Codex acting as the workflow operator in a browser simulation, authorized by the user
- Product-owner sign-off: pending
- Date: 2026-11-19
- Package version: `ogs` 2.0.0 working tree
- Runtime: macOS, Node.js v22.21.1
- Application: Team Site at `http://127.0.0.1:4173`
- Backend/model: Codex / `gpt-6-luna`; Platform discovery reported it runnable before execution
- Mode: `sandbox` / Isolated Run

## Project, Task, Run, and Release

- Project: `v2-uat-scenario-1-2026-11-19-ec97bcb6`
- Workspace: `workspace-d7462fa77678fe969cdfcc91` (`git-lfs`)
- TeamVersion: `new-team-6258e432` (`软件研发`, v1)
- Task: `20261119-200714-f5ba5344`
- Task request: `为自由职业者记账产品制定首个版本发布计划，包含实施拆分、用户体验、验收检查和交付集成。`
- Run: `20261119-220045-b5a5cac7`, status `completed`
- Release: `release-20261119-220045-b5a5cac7`, status `published`
- Release commit: `3e9837e6adbfde8cbf594092ee681aa54eadac2b`
- Expected canonical head: `9dbdd4e6111efe1dfea787ad11c68f517c6e07d7`
- Materialization manifest digest: `sha256:e222b03a527704c55733650a6ce9687311d2f222feb7a09a9e4be2a1517fd897`
- Output digest: `sha256:13df1447de9f23806910b8f74e35ed37048709ef0086ad3b847a285ee8d1c98a`

The Project Run API reported all five configured Role nodes completed: `delivery-coordinator`,
`backend-planner`, `experience-planner`, `quality-planner`, and `delivery-lead`. Their Run-owned
inbox, outbox, result, and audit records are persisted. The business event API returned 31 events
covering `START`, Role start/input/commit, `join_activated`, and `workspace_integrated`. The Evidence
Manifest API returned 200 with 2,309 event references, 17 checkpoint references, 2 provenance
references, and digest `sha256:708c84cc9c93ed9301bb860685708fae93bb171c354fe5b63cbe40539485a9fc`.

The final materialized file `software-delivery-plan.md` is a Chinese delivery proposal containing
implementation order, mobile and accessible user experience, acceptance checks, release integration,
backup, rollback, and unresolved product decisions. The published Release detail and file APIs
returned 200; the file digest was
`sha256:08766e2c5409be206b7bd2279b4ca67b1a55d945378a0dbc61165c4ff579a50d`.

After Run completion, a browser refresh showed the same Task ID, TeamVersion, Run ID, completed
status, Sandbox mode, and final result. Browser console and page-error logs were empty.

## Capture

- Refreshed Project Run page: [`screenshots/v2-uat-scenario-02-isolated-run-2026-11-19.png`](screenshots/v2-uat-scenario-02-isolated-run-2026-11-19.png)
  - SHA-256: `3e92d4eb4ce80a1d8569620f381dafec534f7651eff2ba706bed231b6a39119b`

The workflow-operator browser execution is complete. Product-owner review of the Run result and
published proposal is required before the row can move to `Pass`; this evidence does not by itself
close any other scenario or the V2 release gate.
