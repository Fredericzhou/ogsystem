# V2 Software Project Run Ledger: 2026-11-19

This record captures the authoritative API state of one newly created Project Task
Run. It is engineering evidence only and does not close the formal Project UAT or
release gate.

## Identity

| Field | Value |
| --- | --- |
| Project | `v2-formal-software-uat-20261119-21e3cdd3` |
| Task | `20261119-072128-81213694` |
| Run | `20261119-072135-e195dc95` |
| TeamVersion | `new-team-6258e432` (version 1) |
| Team core digest | `d432ac9ba4f581739d0d1c8e4937c3cd58f5c72b9948b5e3edc78d72b68b85df` |
| Run mode | `sandbox` |
| Run status | `completed` |
| Task status | `completed` |
| Run started | `2026-11-18T23:21:35.966Z` |
| Run completed | `2026-11-18T23:25:14.719Z` |

## Contract-bound plan snapshot

The Run plan recorded these immutable digests:

- `projectDigest`: `7b82c6f083758c515de583120f55315b9e35fc214b4bc5222c33fd58a114c3fb`
- `designDigest`: `5e42a07d5ec5767feaa42e6835da447c157e591e266f2f4e08ce720250bd5f69`
- `workspaceDigest`: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`
- `taskDigest`: `897cc5922283e5bdab7de4d5a0f0fc86befb5862da39b6166b14742191201c9d`
- `projectAssetManifestDigest`: `76341c2e364897bdff9e1064702fe853faa5ed2432be4025a2894bbdb65db140`
- `runPlanDigest`: `b87b42a3036051c3d52e82935a0ce378ccf478813ea06f30cba2c5756dfcae24`

The graph contained five roles: `delivery-coordinator`, `backend-planner`,
`experience-planner`, `quality-planner`, and `delivery-lead`. All five reached
`completed` and emitted a `result_committed` event. The event stream ended at
cursor `4123`; the API returned `nextCursor=4124`.

## Release and acceptance boundary

`GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/releases` returned
an empty release list. No `WorkspaceRef`, role commit ledger, merge commit,
release commit, materialization manifest, output digest, download reference, or
Git LFS delivery evidence was published for this Run.

The final result is explicitly a delivery plan written to
`software-delivery-plan.md`; its own summary states that it does not represent
implementation, testing, or deployment completion. Therefore this Run proves
Run lifecycle and event persistence only. It cannot close the target workflow,
Release materialization, browser evidence, operator review, product-owner sign-off,
or the four-team formal Project coverage requirements.

## Authoritative reads

The record was captured from the following API resources after the Run reached its
terminal state:

```text
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/tasks/20261119-072128-81213694
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/tasks/20261119-072128-81213694/runs/20261119-072135-e195dc95
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/tasks/20261119-072128-81213694/runs/20261119-072135-e195dc95/events
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/releases
```

The corresponding UAT rows remain `Blocked` or `Not run` until a workflow operator
and product owner attach the required real Project evidence and sign-off.
