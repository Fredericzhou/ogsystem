# V2 UAT Project Creation and Refresh Evidence

Status: engineering browser evidence only. This record does not replace the workflow-operator
execution or sign-off required by Release UAT scenario 1.

## Browser run

- Date: 2026-11-19 (Asia/Shanghai)
- Team Site: `http://127.0.0.1:4173`
- Project: `v2-refresh-evidence-20261119-2bb83e49`
- Project Workspace: `workspace-1910fbec41bdd714b8bf85f8` (`git-lfs`)
- Mounted TeamVersion: `new-team-1bd7e229`
- Browser page: `/projects/v2-refresh-evidence-20261119-2bb83e49`
- Browser page ID: `2caa667f-95a4-42b4-a50d-b16f92b132f1`

The Project API returned a valid Collaboration Project with one mounted TeamVersion, a Git + LFS
Workspace, and an empty task list. The browser rendered that state. An initial API-created task was
used to verify the persistence boundary and then deleted from the task list; the final task below was
created through the supported browser form:

- Initial API task: `20261119-114850-3af5781f` (deleted after the persistence check)
- Browser-created Task: `20261119-115549-d811da4e`
- Task number: `2`
- Status after creation: `queued`
- `currentRunId`: `null`
- `runIds`: `[]`
- Input: `Create a release plan with explicit assumptions and acceptance checks.`

The browser form displayed the mounted `管理咨询交付 · v1` TeamVersion, accepted the task input, and
added the task to the list. The page was reloaded in the same browser page. After reload it rendered
the same Project and showed `1` visible task, `任务 #2`, `待执行`, and no Run ID. The readiness check
completed with
`所有已挂载团队均通过静态配置检查。`.

## Reproducible captures

| Capture | SHA-256 |
| --- | --- |
| [`v2-uat-refresh-evidence-before-2026-11-19.png`](screenshots/v2-uat-refresh-evidence-before-2026-11-19.png) | `9f55d73f8dd4f52a724dc001e4c5dbca3855ddfe40c8332ee2c7b122af7c35a0` |
| [`v2-uat-refresh-evidence-after-2026-11-19.png`](screenshots/v2-uat-refresh-evidence-after-2026-11-19.png) | `9f55d73f8dd4f52a724dc001e4c5dbca3855ddfe40c8332ee2c7b122af7c35a0` |
| [`v2-uat-refresh-evidence-task-after-2026-11-19.png`](screenshots/v2-uat-refresh-evidence-task-after-2026-11-19.png) | `0d67acb66928a99570bc9902c0adaeaf5f548e25c9525f9a2531528e7a638c7c` |
| [`v2-uat-refresh-evidence-ui-task-2026-11-19.png`](screenshots/v2-uat-refresh-evidence-ui-task-2026-11-19.png) | `3c833d040f3c98332372d0ab71f3a8e12ce5c3a6683097651882c08b8a6afd3a` |
| [`v2-uat-refresh-evidence-ui-task-after-refresh-2026-11-19.png`](screenshots/v2-uat-refresh-evidence-ui-task-after-refresh-2026-11-19.png) | `89cffb929d0450b1e97ead0589978a3664f8ffe877af84b21898a52a4764625c` |

The first two captures intentionally match: they prove the Project survives a browser reload before
the task is added. The third capture records the persisted queued Task after the reload. Orca browser
console inspection returned an empty error list after reload.

This is engineering evidence for the Project/Task persistence path. The UAT row remains `Blocked`
until a workflow operator repeats the user-facing creation path and records the required sign-off.
