# V2 UAT Scenario 2 Browser Run Evidence

> Evidence type: authorized browser-simulated workflow-operator execution. Product-owner acceptance
> remains pending; Scenario 2 stays `Blocked`.

## Execution

- Scenario: [`release-uat-checklist.md`](../release-uat-checklist.md), Scenario 2
- Executor: Codex acting as workflow operator in a browser simulation, authorized by the user
- Product-owner sign-off: pending
- Date: 2026-11-20
- Package version: `ogs` 2.0.0 working tree
- Runtime: macOS, Node.js v22.21.1
- Application: Team Site at `http://127.0.0.1:4175`
- Backend/model: Codex / `gpt-6-luna`; TeamVersion readiness passed before execution
- Mode: `sandbox` / Isolated Run

## Project, Task, Run, and Release

- Project: `v2-formal-software-uat-2026-11-20-718594c9`
- Workspace: `workspace-2d1740f637b7e93b2e5bc8ae` (`git-lfs`)
- TeamVersion: `new-team-34ca5dd6` (`软件研发`, v2)
- Task: `20261120-014539-7ac01201`
- Run: `20261120-014714-2af898ed`, status `completed`
- Release: `release-20261120-014714-2af898ed`, status `published`
- Release commit: `dbe5775a0bd3c2384a64f7d0ff2b5567f89cabb8`
- Expected canonical head: `3f7f22555ebbc31f1232d3c7236b8019fdd236f5`
- Materialization manifest digest: `sha256:4007e4d1e261edc87a7fae2ce63c4febddea748d049d69451bd828dd6f5a58e5`
- Output digest: `sha256:9ca65b97200518f77c063bc7153f4555fbf6df96470994a3b7b4f88d2bcab6d3`

The Run API reported `completed` with five configured Roles completed: `delivery-coordinator`,
`backend-engineer`, `experience-engineer`, `quality-engineer`, and `delivery-lead`. The events API
returned HTTP 200 and a 50-event page; the Evidence Manifest API returned HTTP 200 with 1,576 event
references, 22 checkpoint references, 5 provenance references, no review references, and digest
`sha256:adabfd0f613b2230a5d853a3681caddcde58760331fe682fe6e1b67160664f0e`. The result API returned
the final `delivery-lead` output. Per-Role inputs, outputs, and the full event history are persisted
in the Run-owned records and can be read through the Run evidence APIs.

The published Release lists eight files, including `.gitattributes`, `README.md`, `index.html`,
`src/app.js`, `src/ledger.mjs`, `styles.css`, `tests/ledger.test.mjs`, and `workspace/index.json`.
Running `node --test tests/ledger.test.mjs` in the Workspace passed 10 tests. The canonical
Workspace Git status was clean after publication.

## Browser Review

The Project Run page returned HTTP 200 and was refreshed. After refresh, it showed the same Project,
Task, TeamVersion, completed Run, and published Release. At a 390px viewport the document and body
scroll widths both measured 390px. Browser console and page-error logs were empty. Captures:

Responsive review found the Project title's team/task count collapsing into a narrow vertical label.
The Project heading now stacks below 900px, and its count label keeps an intrinsic width at larger
sizes. Playwright checks at 320, 360, 390, 768, 900, 901, 1024, 1100, and 1440px confirmed readable
count labels, no document-width overflow, and no browser errors.

- Desktop, 1440px viewport: [`screenshots/v2-formal-software-uat-run-2026-11-20-desktop.png`](screenshots/v2-formal-software-uat-run-2026-11-20-desktop.png), SHA-256 `9c389823960c7c2150af3a468cd42fd787f4b6d0af0d5cb010427c394d11d261`
- Mobile, 390px viewport: [`screenshots/v2-formal-software-uat-run-2026-11-20-mobile.png`](screenshots/v2-formal-software-uat-run-2026-11-20-mobile.png), SHA-256 `d0a607f7dd4e5f3ec3c0e58c2907866ef7ac8b32b8e0363b8780b5e555d58f0c`

## Findings and Acceptance

The visible final Role summary says that no Project Release entry point was available and that no
Release was published, while the Project page and Release API show the Run's Release as `published`.
The delivered bookkeeping fixture also keeps entries in page memory, so entries disappear after a
refresh. The second limitation is disclosed in its README and final Role output, but the requested
working implementation should receive product-owner review for whether that behavior is acceptable.

This execution proves a real Sandbox Project Run, persisted Workspace changes, passing fixture tests,
published source/test materialization, and stable Project/Run records after browser refresh. It does
not satisfy product-owner content review or resolve the contradictory Run summary and memory-only
storage limitation. Scenario 2 therefore remains `Blocked` until the product owner reviews and signs
off on the delivered behavior and evidence.

## Follow-up: Attempt 2

The same Project Task was retried through the Project UI with `mode: sandbox` explicitly selected.
The first retry (`20261120-025503-d4519536`) failed at Join with
`GIT_COLLABORATION_MERGE_CONFLICT: tests/ledger.test.mjs`; its candidate commits were retained for
inspection. Attempt 2 completed as Run `20261120-030301-c9b852a5`. Its initial Task requested the
named-import fix, versioned localStorage persistence, browser checks, all fixture tests, an accurate
README, and a new Release without altering prior Releases.

The all-of Join received `backend-engineer`, `experience-engineer`, and `quality-engineer`, and the
Workspace recorded successful integration. The canonical Workspace is clean at
`60194b009b8bcd9714bd4288271de8ac15e967bc`. The Run Evidence Manifest API returned 1,628 event
references, 22 checkpoint references, 5 provenance references, and digest
`sha256:367ee0bd85929572a7c72afee95eb22c071cae7463489896e816d3c01440fe63`. Running
`node --test tests/ledger.test.mjs` in the Workspace passed all 12 tests.

Release `release-20261120-030301-c9b852a5` is `published`; its materialization manifest is
`release-20261120-030301-c9b852a5:materialization`, contains 8 files, and has digest
`sha256:617eeafcc36bd75d006372ac6a88a7a8a367377d209f7d21d92f92e460179b94`. Its output digest is
`sha256:26c15dc8f92cb23d6bb17c6c90bc634fc41a38b31b29f3bf9db08948906113c5`. Prior Releases remain
listed and were not changed.

The published files were opened in Chromium through their Project Release file endpoints. The
browser imported the named `createLedger` export without page or console errors. Adding income
`¥125.50` and expense `¥45.25` showed monthly totals `¥125.50`, `¥45.25`, and `¥80.25`; refreshing
retained both entries and totals. With `localStorage.setItem` forced to throw `QuotaExceededError`,
the page kept the new entry for the current session and announced that it might be lost after refresh.
The document width matched the viewport at desktop 1440px and mobile 375px. This verifies the
storage-failure feedback path but does not represent an actual browser quota exhaustion test.

Captures:

- Project page showing the completed Run and published Release: `screenshots/v2-uat-scenario-05-run-2026-11-20-attempt-2-desktop.png`, SHA-256 `b51fe94f8d0a3813aed35421509c114a0e7a6333e2fbb5d32555332cc1e11100`.
- Published app after refresh at 1440px: `screenshots/v2-uat-scenario-02-release-2026-11-20-desktop.png`, SHA-256 `f40bd912d73cdf4c61f02359abcde475f9aa2a97cbc567770b93f7c8f64d31d9`.
- Published app at 375px with a simulated storage write failure: `screenshots/v2-uat-scenario-02-release-2026-11-20-mobile-storage-error.png`, SHA-256 `8aaa1a0966b1dd7c7d1346bbb01b88a7348c1605ab80d5497c67ff11d40f2e6f`.

At the time of this attempt's capture, the Project UI displayed a Delivery Lead summary claiming
that no Release was published, while the Release panel and `/api/v2` Release API showed the Release
as published. The follow-up below adds an adjacent status notice, preserving the immutable Role
output while making the current Release state clear. Product-owner review and sign-off are still
required, so Scenario 2 remains `Blocked`.

## Project Status Clarity Follow-up

The Project UI now places a Release-status notice directly beside the unchanged Run summary when
the Release API confirms that the current Run has a published Release. The notice links to the
published Release list and identifies the summary as original Run output. The link scrolls the
Project's internal content pane to the Release list at both 1440px and 375px viewports; there is no
page overflow or browser console error. This preserves the auditable Role result while presenting
the current release state at the point where users need it.

Capture: `screenshots/v2-uat-scenario-02-release-status-reconciliation-desktop.png`, SHA-256
`b8e8ae42bcd1d15f7d26370f92dba29b9e7c388ab267f226d0c889279c94284b`. Scenario 2 remains `Blocked`
until Product Owner review and sign-off.
