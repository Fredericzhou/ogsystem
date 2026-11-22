# V2 Formal Software Project Release Ledger: 2026-11-19

This is engineering evidence for the corrected Project Release path. It proves
that one real-model Sandbox Run produced a readable published Release through the
Project API. It does not replace manual workflow review, browser captures, or
product-owner sign-off.

The latest current-TeamVersion rerun is recorded below. The earlier Release ledger
is retained because it proves the same API path at an earlier point in the Project;
the latest rerun is the current engineering reference for the software-team path.

## Latest Current-TeamVersion Rerun

| Field | Value |
| --- | --- |
| Project | `v2-formal-software-uat-20261119-21e3cdd3` |
| Task | `20261119-084808-b24517ed` (task 5) |
| Run | `20261119-084816-966ecb55` (attempt 1) |
| TeamVersion | `new-team-6258e432` (version 1) |
| Team core digest | `d432ac9ba4f581739d0d1c8e4937c3cd58f5c72b9948b5e3edc78d72b68b85df` |
| Backend/model | Codex / `gpt-6-luna` |
| Mode/status | `sandbox` / `completed` |
| Workspace | `workspace-cf790c71701caa8970e885e1` |

The authoritative Run response reports five completed Role nodes. Its event read
returned 36 event records, including `join_activated` with the three required
sources `backend-planner`, `experience-planner`, and `quality-planner`; the final
result remains explicitly a planning proposal and does not claim implementation,
testing, or deployment completion.

| Release field | Value |
| --- | --- |
| Release | `release-20261119-084816-966ecb55` (`published`) |
| Release commit | `bb4dc4b0ac6418920131057e4ae552546ede88bc` |
| Expected canonical head | `76cabc2b4eed17363c2881ea85eb652bf2669fca` |
| Materialization manifest digest | `sha256:3d3e760101b82f5fcb6ede64c0660c45a7de8fc3559b5e1a54f6fbf136a7d619` |
| Output digest | `sha256:6951bfaedd54a39988ecb1f379e0473690fabaf6ab057a25ee3227cca4ef630d` |
| Download reference | `project://v2-formal-software-uat-20261119-21e3cdd3/runs/20261119-084816-966ecb55/release` |

The manifest contains `.gitattributes`, `software-delivery-plan.md`, and
`workspace/index.json`. It contains no binary or media object, so the formal
binary/media LFS acceptance requirement remains open.

The live Release API response was read back through the built-in
`assertRelease` and `assertMaterializationManifest` validators. The Release status,
manifest digest, release commit, and manifest identity all passed without a
transport-specific projection or a second schema.

Authoritative reads used for this entry:

```text
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/tasks/20261119-084808-b24517ed/runs/20261119-084816-966ecb55
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/tasks/20261119-084808-b24517ed/runs/20261119-084816-966ecb55/events
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/releases/release-20261119-084816-966ecb55
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/releases/release-20261119-084816-966ecb55/files/.gitattributes
```

## Identity and Run

| Field | Value |
| --- | --- |
| Project | `v2-formal-software-uat-20261119-21e3cdd3` |
| Task | `20261119-073801-baceb74d` (task 4) |
| Run | `20261119-073808-e0eadaac` (attempt 1) |
| TeamVersion | `new-team-6258e432` (version 1) |
| Team core digest | `d432ac9ba4f581739d0d1c8e4937c3cd58f5c72b9948b5e3edc78d72b68b85df` |
| Backend/model | Codex / `gpt-6-luna` |
| Mode/status | `sandbox` / `completed` |
| Workspace | `workspace-cf790c71701caa8970e885e1` |

The Run owner record and Task API agree on the Project, Task, Run, TeamVersion,
attempt, and digest tuple. Five Role results were persisted. The event stream has
3,322 events and 3,322 unique event IDs.

## Workspace and Release

| Field | Value |
| --- | --- |
| Base/canonical head before release | `620648c046f16be9e752040edc662aab82a7144c` |
| Role commit | `adae6831bf1ac7864001afa0672230fe7f948f40` |
| Changed path | `software-delivery-plan.md` |
| Merge/release commit and canonical HEAD | `76cabc2b4eed17363c2881ea85eb652bf2669fca` |
| Release | `release-20261119-073808-e0eadaac` (`published`) |
| Manifest digest | `sha256:3a465a9f6ba6117be8939c0530d36f2d88498ba2366f0702f8e1e67beeaf0a82` |
| Output digest | `sha256:10f76db9bb0fe6d7682b50af25601c2631c884e0ddbf7017a3d9758ee3066cf4` |
| Download reference | `project://v2-formal-software-uat-20261119-21e3cdd3/runs/20261119-073808-e0eadaac/release` |

The published manifest contains `.gitattributes`, `software-delivery-plan.md`,
and `workspace/index.json`. The Project Release API successfully returns the
manifest and reads `.gitattributes` after the dotfile path validation fix. The
Workspace worktree is clean and `git lfs fsck` reports `OK`; this particular
Release contains no LFS binary/media object, so the separate binary/media gate
remains open.

## Authoritative reads

```text
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/tasks/20261119-073801-baceb74d
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/tasks/20261119-073801-baceb74d/runs/20261119-073808-e0eadaac
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/releases
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/releases/release-20261119-073808-e0eadaac
GET /api/v2/projects/v2-formal-software-uat-20261119-21e3cdd3/releases/release-20261119-073808-e0eadaac/files/.gitattributes
```

This record remains engineering evidence. Scenario 2 and the four-team coverage
rows stay blocked until the workflow operator and product owner complete the
required refresh, role-by-role, browser, and sign-off steps.
