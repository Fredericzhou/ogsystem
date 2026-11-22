# V2 Formal Management Consulting Project Release Evidence

Status: engineering evidence only. This record does not replace browser refresh review,
workflow-operator or product-owner sign-off, and does not close the four-team UAT row by itself.

## Execution identity

- Project: `v2-formal-management-consulting-20261119-78d35786`
- Project Workspace: `workspace-9bcd84f8da69c9222b972d78` (`git-lfs`)
- Task: `20261119-093300-e3fd2cf9`
- Run: `20261119-093344-c9ee996e`
- TeamVersion: `new-team-1bd7e229` (management consulting), Team core digest `d14ff68ae228ff802c6ea3c13aa43e7f3a93b83a17cec78b93bcad6474986ed9`
- Mode: real `sandbox`; final Task status: `completed`

## Workflow and Workspace evidence

- Nine expected Roles completed: `engagement-lead`, `market-analyst`, `operations-analyst`,
  `commercial-analyst`, `risk-advisor`, `synthesis-consultant`, `quality-reviewer`,
  `executive-brief`, and `document-publisher`.
- The Run recorded 62 durable events, including 9 `role.started`, 10 `result_committed`,
  3 `join_activated`, one `join_quorum_reached`, one `join_late_arrival_ignored`, and 3
  `workspace_integrated` records.
- No-content-change Role commits reused base commit
  `a224d2406a7b1399a953424a71cee20012988294`; the final publisher commit was
  `d3ac0a68f57c15d20db2c4d60183b90da6e647ec` with `changedPaths: ["executive-brief.md"]`.
- Final Workspace merge commit: `6774ca3a7a8d741572912f24f7683f33186ac77f`.
- The raw Run evidence is under the Team Site Project root at
  `.ogs/runs/20261119-093344-c9ee996e/`; public reads were performed through the Project
  Task, Run events, Release, Release files, and file-read APIs.

## Published Release

- Release: `release-20261119-093344-c9ee996e`, status `published`
- `releaseCommit`: `6774ca3a7a8d741572912f24f7683f33186ac77f`
- `expectedCanonicalHead`: `a224d2406a7b1399a953424a71cee20012988294`
- Materialization manifest digest: `sha256:9da25ae015202664eef1c0097a7bba7a3f2ab0905bf1320a57759849b25f3175`
- Output digest: `sha256:e4439919ddb26611f061cd3c78b0131e45355b996fdb26e47872d794471dd475`
- Download reference: `project://v2-formal-management-consulting-20261119-78d35786/runs/20261119-093344-c9ee996e/release`

The verified materialization contains `.gitattributes`, `executive-brief.md`, and
`workspace/index.json`. The published `executive-brief.md` is 3,970 bytes with manifest digest
`sha256:41d6bf79cc43824f26a1fe3ff186e155356aaaee9ab585020eeaa1b4384c84fa`.

This is a successful engineering Project Release path. It does not by itself prove product
acceptance of the consulting content or close the remaining UAT and sign-off requirements.
