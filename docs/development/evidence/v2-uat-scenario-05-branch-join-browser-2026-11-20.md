# Supplemental Branch and Join Browser Evidence

> Evidence type: authorized browser-simulated workflow-operator review. This Run is shared with
> Scenario 2 and does not satisfy the fresh-Run requirement for Scenario 5.

## Execution

- Related scenario: [`release-uat-checklist.md`](../release-uat-checklist.md), Scenario 5
- Executor: Codex acting as workflow operator under the user's browser-simulation authorization
- Date: 2026-11-20
- Project: `v2-formal-software-uat-2026-11-20-718594c9`
- Workspace: `workspace-2d1740f637b7e93b2e5bc8ae` (`git-lfs`)
- TeamVersion: `new-team-34ca5dd6` (`软件研发`, v2)
- Task: `20261120-014539-7ac01201`
- Run: `20261120-014714-2af898ed` (`sandbox`, `completed`)

## Input, Handoffs, and Outputs

The initial Task input requested an implemented freelancer bookkeeping application with income and
expense entry, monthly summaries, input validation, an accessible browser workflow, automated tests,
README, test execution, and a published Project Release.

The Run API returned HTTP 200 with all five Role nodes `completed`. The persisted Role Inbox/Outbox
records show these handoffs:

| Role | Input and handoff | Output and committed paths |
| --- | --- | --- |
| `delivery-coordinator` | Received the Task and prepared a shared brief with user outcome, interface requirements, file ownership, constraints, and acceptance checks. | Shared brief committed with no changed files. |
| `backend-engineer` | Received the shared brief and owned the ledger module. | Implemented `createLedger`, record validation, and monthly totals; committed `src/ledger.mjs`. |
| `experience-engineer` | Received the shared brief and UI ownership for the form, styles, and app entry point. | Implemented income/expense entry, month filtering, summaries, validation, and responsive keyboard-accessible UI; committed `index.html`, `src/app.js`, and `styles.css`. Its initial outbox assumed a different ledger API; the delivery lead received this integration detail. |
| `quality-engineer` | Received the shared brief and test ownership. | Added coverage for totals, balances, month boundaries, invalid dates, duplicate IDs, invalid amounts, and other ledger rules; committed `tests/ledger.test.mjs`. |
| `delivery-lead` | Received all three parallel implementation results after their branches arrived at the `all_of` Join. | Integrated the work, updated `README.md`, adjusted `src/app.js` and tests, and reported 10 tests passing. Its final summary incorrectly says that no Release was published; the published Release is confirmed in Scenario 2 evidence. |

The saved event projection reports the `delivery-lead` Join `delivery-lead#delivery-coordinator@1#1#1`
with `joinMode: all_of`, required source count 3, and all of `backend-engineer`,
`experience-engineer`, and `quality-engineer` in `satisfiedSources` with status `arrived`. The next
branch is `delivery-lead@1#5`. `workspace_integrated` records a successful merge with no conflict paths.

## API and Browser Evidence

- `GET /api/v2/projects/v2-formal-software-uat-2026-11-20-718594c9/tasks/20261120-014539-7ac01201/runs/20261120-014714-2af898ed` returned HTTP 200; status was `completed`, mode `sandbox`, and all five Role nodes were complete.
- Filtered `GET .../events?type=join_activated&limit=100` returned HTTP 200 and one Join record with all three arrived source branches.
- Filtered `GET .../events?type=result_committed&roleId=<role>&limit=50` returned HTTP 200 with each implementation Role's committed result; saved commit events contain the changed paths listed above.
- `GET .../result` returned HTTP 200 with the final `delivery-lead` output.
- `GET .../manifest` returned HTTP 200 with Run-owned references to event, checkpoint, and provenance records.
- The Project page was opened at 1440px and the second Task's read-only team graph was captured. The graph shows the coordinator branching to backend, experience, and quality roles, then joining at delivery lead. Browser console and page-error logs were empty.

Capture: [`screenshots/v2-uat-scenario-05-project-run-graph-2026-11-20.png`](screenshots/v2-uat-scenario-05-project-run-graph-2026-11-20.png), SHA-256 `ed5d16eeaac3d64d6a22cb9fa9ff1b1c8f6521c38641f31172541ee150fa70b2`.

This supplemental review confirms that the shared Run contains a branch/Join flow and provides
inspectable evidence for planning a dedicated Scenario 5 execution. The V2 validation standard
requires a fresh Run per semantic scenario, so Scenario 5 remains Blocked until its own formal
Project/Task/Run and operator review are recorded. This evidence also does not close Scenario 2's
product-owner review, contradictory final summary, or the delivered fixture's memory-only storage
limitation.

## Fresh Run Follow-up

Workflow-operator review on 2026-11-20 completed the fresh formal Sandbox Run
`20261120-030301-c9b852a5` for Project `v2-formal-software-uat-2026-11-20-718594c9`, Task
`20261120-025502-3ebc9ceb`, Workspace `workspace-2d1740f637b7e93b2e5bc8ae`, and TeamVersion
`new-team-34ca5dd6`. The Task input and saved per-Role inbox/outbox records are in the Run-owned
evidence store; the Run Events API records `result_committed` for all five configured Roles, an
`all_of` Join with the three implementation sources arrived, and successful `workspace_integrated`
events for the Join and final Run.

Role commit IDs are `8870620afa50f800329de490c83d292dcd32b4cf` (`backend-engineer`),
`532840a19a7f04e8c65b84805eafaf8c70a61b5a` (`experience-engineer`),
`3c08d95364c0365f38c1c34fb6e38ab27b509e44` (`quality-engineer`), and
`d2768ebe0b498e37b7a5e284661c819c60b383b8` (`delivery-lead` integration). The final canonical Run
commit is `60194b009b8bcd9714bd4288271de8ac15e967bc`. The Evidence Manifest API returned 1,628
event references, 22 checkpoint references, 5 provenance references, and digest
`sha256:367ee0bd85929572a7c72afee95eb22c071cae7463489896e816d3c01440fe63`.

The Project Visualizer displayed the selected TeamVersion graph with the coordinator branching to
Backend, Experience, and Quality, then converging at Delivery Lead. The Project Run API, Events API,
Evidence Manifest API, and Result API were read successfully. Captures:

- [Task 5 graph](screenshots/v2-uat-scenario-05-task-20261120-025502-attempt-2-graph.png), SHA-256 `7c9a1f0f9be5d0ea4dec1bf9f97faf4afa23dbebdb7fe8903f236772fcc0049c`.
- [Project Run and Release status](screenshots/v2-uat-scenario-05-run-2026-11-20-attempt-2-desktop.png), SHA-256 `b51fe94f8d0a3813aed35421509c114a0e7a6333e2fbb5d32555332cc1e11100`.

Scenario 5 is now `Pass`: this is a fresh Project/Task/Run, the Join and integration succeeded, and
the saved event, checkpoint, provenance, Role input/output, and browser graph evidence are
inspectable. The initial failed retry remains visible as an independent conflict record. Scenario 2
remains Blocked because Product Owner review is pending. The immutable Delivery Lead summary says
no Release was published, but the later Project UI status notice shows the API-confirmed published
state beside that summary and links to the Release list; see the Project Status Clarity Follow-up in
the Scenario 2 evidence.
