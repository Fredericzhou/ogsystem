# Release Candidate Evidence

Copy this file to `docs/development/release-evidence/<version-or-rc>.md` for each candidate.
Use `NOT RUN` for incomplete checks; do not infer a pass from CI coverage or checklist requirements.

## Candidate

- Version/tag:
- Source revision:
- Candidate ref (immutable commit):
- Package artifact and SHA-256:
- Build and package command:
- Regular CI workflow run/result:
- Release package validation workflow run/result (12-combination matrix):
- Known limitations/issues:

## Release Decisions

- Latest-two-minor support commitment: `ACCEPTED` on 2026-10-06
- Supported Node.js majors: 22, 24
- Supported operating systems: Linux, macOS, Windows
- Supported package managers: npm, pnpm
- Migration scope: released project/config contracts follow policy; pre-release run data is not migrated.

## Package Matrix

| Node.js | OS | npm | pnpm | Clean install, project creation, and run evidence |
| --- | --- | --- | --- | --- |
| 22 | Linux | NOT RUN | NOT RUN | |
| 22 | macOS | NOT RUN | NOT RUN | |
| 22 | Windows | NOT RUN | NOT RUN | |
| 24 | Linux | NOT RUN | NOT RUN | |
| 24 | macOS | NOT RUN | NOT RUN | |
| 24 | Windows | NOT RUN | NOT RUN | |

## User Acceptance

- Bounded target workflow and operator:
- Package version/artifact used:
- Workflow/API/UI paths exercised:
- Recovery result (interruption, missing/corrupt artifacts, duplicate controls):
- Retention/cleanup settings and observed disk/artifact growth:
- Deployed Visualizer environment and result:
- Open issues and accepted limitations:
- Workflow operator sign-off and date:
- Product owner sign-off and date:
