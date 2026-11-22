# V2 Shared Workspace Boundary: Two TeamVersion Runs

Status: engineering evidence only. This record does not change UAT scenario 14 from
`Not run` and does not replace workflow-operator or product-owner review and sign-off.

## Identity

| Field | Value |
| --- | --- |
| Project | `v2-shared-workspace-boundary-fixed-20261119-c7222311` |
| Project control root | `/Users/fred/.ogsystem/projects/v2-shared-workspace-boundary-fixed-20261119-c7222311` |
| Project Workspace | `workspace-cccd17fea396ccb1053c56b5` |
| Workspace backend | `git-lfs` |
| Shared Workspace path | `/tmp/ogs-v2-uat-shared-workspace-fixed.k2YSzf` |
| Project status | `confirmed` |
| Project digest | `7b82c6f083758c515de583120f55315b9e35fc214b4bc5222c33fd58a114c3fb` |
| Initial Workspace commit | `dc069360ea6be657c4b4ea232f335dcccf0c0e0b` |

The Project mounted two trained TeamVersions:

| TeamVersion | Team core digest | Digest version | Task | Run | Release |
| --- | --- | ---: | --- | --- | --- |
| `new-team-1bd7e229` | `d14ff68ae228ff802c6ea3c13aa43e7f3a93b83a17cec78b93bcad6474986ed9` | 3 | `20261119-123409-cb0bf1aa` | `20261119-123409-30c1e81d` | `release-20261119-123409-30c1e81d` |
| `new-team-6258e432` | `d432ac9ba4f581739d0d1c8e4937c3cd58f5c72b9948b5e3edc78d72b68b85df` | 3 | `20261119-123840-3c4ff84f` | `20261119-123840-12e36514` | `release-20261119-123840-12e36514` |

Both Tasks and both Runs completed in real `sandbox` mode. Each Run owner record is
under the same Project control root, in its own `.ogs/runs/<run-id>` directory. The
Run event API returned 57 events for the first Run and 31 for the second, including
`result_committed` and `workspace_integrated` records.

## Workspace Boundary

Before the first Run, the shared Workspace contained only:

```text
.git/
.gitattributes
workspace/index.json
```

After the first Run it contained the committed business file `executive-brief.md`.
After the second Run it contained `software-delivery-plan.md` as well. The final Git
working tree was clean at commit
`0da8a475990cf993d0751fc0d873b01fc38e5bdf`.

The final directory inspection confirmed:

```text
.ogs       absent
source     absent
destination absent
```

No Run evidence, role output, or Studio Simulation history was written into the shared
Workspace. Run evidence and Release materializations remained under the Project
control root. Both Releases were `published` and reference the same Workspace ID:

- first release commit `0e1af72ca9dc7bf38b7c98706503b05b302db388`;
- second release commit `0da8a475990cf993d0751fc0d873b01fc38e5bdf`.

## Boundary Correction

The first exploratory execution against an earlier Project left an empty root
`.ogs` directory after completion. The Project Run executor now records the forbidden
Workspace directories present before a Run and removes only a newly created empty
`.ogs`, `source`, or `destination` directory. A newly created non-empty directory or
non-directory path raises `PROJECT_WORKSPACE_BOUNDARY_VIOLATION`; business files are
never removed by this cleanup. The corrected Project above was rebuilt after that
change and both real Runs passed the final directory check.

## Authoritative Reads

```text
GET /api/v2/projects/v2-shared-workspace-boundary-fixed-20261119-c7222311
GET /api/v2/projects/v2-shared-workspace-boundary-fixed-20261119-c7222311/tasks/20261119-123409-cb0bf1aa
GET /api/v2/projects/v2-shared-workspace-boundary-fixed-20261119-c7222311/tasks/20261119-123840-3c4ff84f
GET /api/v2/projects/v2-shared-workspace-boundary-fixed-20261119-c7222311/tasks/{task-id}/runs/{run-id}
GET /api/v2/projects/v2-shared-workspace-boundary-fixed-20261119-c7222311/tasks/{task-id}/runs/{run-id}/events
```

The API reads, control-root listings, Git status, and final Workspace listing were
captured on 2026-11-19. Formal scenario closure still requires the responsible
workflow operator and product owner to review this ledger and sign the UAT row.

## Live Revalidation

Read-only revalidation against the running Team Site on 2026-11-19T06:45:26Z confirmed:

- `GET /api/v2/projects/v2-shared-workspace-boundary-fixed-20261119-c7222311` still returns
  Workspace `workspace-cccd17fea396ccb1053c56b5` with backend `git-lfs` and exactly two Tasks.
- Both Task/Run pairs remain `completed`; both Run owner records identify the same Project and their
  respective mounted TeamVersion. The Run event endpoints return 57 and 31 records.
- `GET /api/v2/projects/v2-shared-workspace-boundary-fixed-20261119-c7222311/releases` still returns
  both Releases as `published`, with the same Workspace ID and the commits recorded above.
- The Workspace HEAD remains `0da8a475990cf993d0751fc0d873b01fc38e5bdf`; `git status --porcelain`
  is empty and `git lfs fsck` reports `Git LFS fsck OK`.
- The Workspace root contains `.git`, `.gitattributes`, the two trained business files, and
  `workspace/`; `.ogs`, `source`, and `destination` are absent.

This revalidation confirms that the engineering evidence still matches live persisted state. It does
not replace the required framework-developer review, product-owner review, or UAT sign-off.
