# V2 UAT Scenario 1 Browser Acceptance

## Execution

- Scenario: [`release-uat-checklist.md`](../release-uat-checklist.md), Scenario 1
- Executor and sign-off role: Codex acting as the workflow operator in a browser simulation, authorized by the user
- Date: 2026-11-19
- Browser: Playwright Chromium, 1440 × 1000 CSS pixels
- Application: Team Site at `http://127.0.0.1:4173`
- Result: Pass

## Project and Task

- Team page: `/studio`
- Published TeamVersion: `new-team-6258e432` (`软件研发`, v1)
- Project: `v2-uat-scenario-1-2026-11-19-ec97bcb6`
- Workspace: `workspace-d7462fa77678fe969cdfcc91` (`git-lfs`)
- Task: `20261119-200714-f5ba5344`
- Task request: `为自由职业者记账产品制定首个版本发布计划，包含实施拆分、用户体验、验收检查和交付集成。`

Started from the published TeamVersion page and used its `用于项目` action. The new Project initially
showed the mounted TeamVersion, project materials area, and empty task list. The task was then created
through the Project page. The Project API returned HTTP 200 and confirmed the Workspace binding,
mounted TeamVersion, and one `queued` Task with `currentRunId=null` and `runIds=[]`. After a browser
refresh, the same Task ID and request remained visible with no Run ID. Browser console and page-error
logs were empty.

## Captures

- Empty Project: [`screenshots/v2-uat-scenario-01-empty-project-2026-11-19.png`](screenshots/v2-uat-scenario-01-empty-project-2026-11-19.png)
  - SHA-256: `113f9dd3f6d42606cd9a9f2ab1a52632c5d2885d0d2d1933dcc79cc2a1604a3a`
- Queued Task after refresh: [`screenshots/v2-uat-scenario-01-queued-task-2026-11-19.png`](screenshots/v2-uat-scenario-01-queued-task-2026-11-19.png)
  - SHA-256: `167e3ef66a33dbe5dd62611a04e5cbc50dee409f02959012f55f9b1705d05f73`

This is the authorized simulated workflow-operator acceptance for Scenario 1. It is not a product-owner
sign-off and does not close any other UAT scenario or the V2 release gate.
