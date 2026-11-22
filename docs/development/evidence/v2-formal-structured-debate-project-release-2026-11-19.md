# V2 Formal Structured Debate Project Release Evidence

Status: engineering evidence only. This record does not replace browser refresh review,
workflow-operator or product-owner sign-off, and does not close the four-team UAT row by itself.

## Execution identity

- Project: `probe-v2-project-creation-20261119-c8e1d108` (renamed to `v2-formal-structured-debate-20261119`)
- Project Workspace: `workspace-172ab81a499417bab21cd1ec` (`git-lfs`)
- Task: `20261119-092414-d85bb97e`
- Run: `20261119-092612-ab6d5eff`
- TeamVersion: `new-team-0b2feb81` (structured debate), Team core digest `69c6b91e1274fdd1795ec3b5b5fad835ab6983ab8fbd9588753bc98b55785d9f`
- Mode: real `sandbox`; final Task status: `completed`

## Workflow and Workspace evidence

- Five expected Roles ran through the Project path: `debate-host`, `proponent`, `opponent`,
  `neutral-judge`, and `document-publisher`.
- The Run recorded 51 durable events, including 9 `role.started`, 6 `result_committed`,
  2 `join_activated`, and 2 `workspace_integrated` records.
- The Join/rework path completed two iterations. The second iteration returned through
  `neutral-judge` before `document-publisher` completed.
- No-content-change Role commits reused base commit
  `af6e06d7d9116b8ffef809c1fe016581d65a4745`; the final publisher commit was
  `d9937e13514c8dc5fb099969bfe193932699c1e2` with `changedPaths: ["debate-brief.md"]`.
- Final Workspace merge commit: `53c16e0d1f43bd02b2288e8f09055623665d535c`.
- The raw Run evidence is under the Team Site Project root at
  `.ogs/runs/20261119-092612-ab6d5eff/`; public reads were performed through the Project
  Task, Run events, Release, Release files, and file-read APIs.

## Published Release

- Release: `release-20261119-092612-ab6d5eff`, status `published`
- `releaseCommit`: `53c16e0d1f43bd02b2288e8f09055623665d535c`
- `expectedCanonicalHead`: `af6e06d7d9116b8ffef809c1fe016581d65a4745`
- Materialization manifest digest: `sha256:b28507c75e2766d9c8fe7d7d377f0d7ea4a3e6dffe577c04ed24bcdabbdedf91`
- Output digest: `sha256:b0651f3892fe9163726639a9c746d955a2cb1aef960a393cb405464be6d6d675`
- Download reference: `project://probe-v2-project-creation-20261119-c8e1d108/runs/20261119-092612-ab6d5eff/release`

The verified materialization contains `.gitattributes`, `debate-brief.md`, and
`workspace/index.json`. The published `debate-brief.md` was read through the Release file API;
its manifest entry is 1,941 bytes with digest
`sha256:4d66b71cd34c15996c6b108916021737916850be95fdf7be7b56d74425f289a0`.

This is a successful engineering Project Release path. It is not a claim that the debate content
passed product acceptance: the final document itself records that evidence was insufficient for
formal acceptance.
