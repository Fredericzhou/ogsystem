# OGSystem Release UAT

This checklist gates the first stable local-first release. It starts from a clean install and a
new project. Development builds and run artifacts created before the first stable release are not
migration targets. Compatibility of released CLI, project, API, and Semantic IR contracts is defined
separately by the released CLI compatibility policy.
The real target workflow is a bounded workflow used to validate framework behavior with its intended
operator. It does not require this project to build or deliver a complex application. Repository
examples and templates remain examples; the target workflow may be supplied by a pilot user.

## Participants

- Framework developer: checks install, configuration diagnostics, API contracts, and recovery evidence.
- Workflow operator: completes the scenarios without editing runtime files by hand.
- Product owner: records pass/fail and accepts any non-blocking findings.
- At least one real target workflow is required in addition to repository examples.

## Scenarios

1. Build the release candidate and create the package artifact (for example, with `npm pack`).
   Install that tarball on a clean supported machine, create a project, configure one Role and its
   executor, validate readiness, and run the minimal linear example. Uninstall the CLI and confirm
   shared role files and project data remain. The first stable release has no earlier stable release
   to upgrade from; validate the upgrade path in a later release cycle.
2. Run a branch-and-join example; inspect initial input, each Role's input/output and handoff in
   the Visualizer Flow view, then verify the event stream and execution records through `/api/v1`.
3. Stop at human review, record approve and rework decisions, verify the audit principal matches
   the OGS service process's OS account, resume, and confirm that duplicate or stale decisions are
   rejected without changing the run. Do not treat loopback attribution as browser-operator identity.
4. Trigger a configured failure-compensation route, inspect the failure and audit evidence, and
   resume an interrupted run without repeating a committed role execution. Verify that a missing
   or corrupt authoritative recovery artifact fails closed with an actionable diagnostic, and that
   duplicate review/control requests do not apply the action twice.
5. Scrape `/metrics`, check `/healthz` and `/readyz`, and verify that sensitive prompt/result data
   is absent from metric labels and operational summaries.
6. Complete the same operator workflow at desktop and mobile viewport sizes; confirm the graph,
   failure location, pending review action, and next lifecycle action remain discoverable.
7. Exercise the documented retention and cleanup policy with representative run artifacts; record
   what is retained, what is removed, and the resulting disk/artifact growth.

## Release Gate

- The accepted latest-two-minor support commitment is captured in the release evidence record.
- Stable package support is Node.js `22.x` and `24.x` on Linux, macOS, and Windows, installed with
  npm or pnpm. Run the
  [release package validation workflow](../../.github/workflows/release-package-validation.yml) to
  test all 12 Node.js/OS/package-manager combinations using the same candidate tarball. Record this
  matrix run and its artifact digest separately from regular CI. The package job exposes the SHA-256
  as a job output; every matrix job verifies the downloaded tarball against it before installation.
  Compare the UAT tarball's SHA-256 with that output and record the matching value.
- Required build, unit, contract, integration, fault-injection, and browser E2E checks pass in the
  regular CI workflow for the same immutable candidate ref. Record the regular CI run separately;
  the release package validation workflow only builds the tarball and tests its install matrix.
- Complete the deployed Visualizer UAT on the release candidate in its intended deployment
  environment. Record the package version, environment, workflow, result, and issue references here
  or in a linked UAT record before closing this item. Browser smoke automation is supplementary and
  does not close the deployed UAT item.
- UAT evidence records package version, OS/runtime, workflow fixture, API/UI paths used, outcome,
  and issue references.
- The workflow operator and product owner record their sign-off against the bounded target workflow;
  automated tests and repository examples do not substitute for this evidence.
- No unresolved blocker or high-severity data-integrity, authorization, recovery, or audit issue.
- A high-severity data-integrity or authorization issue blocks release even when the affected
  capability was otherwise deferred from the initial product scope.
- Flow-contract gaps block release only when `handoff.mode=strict`; `transition` gaps remain readiness warnings, and projects without `handoff.mode` do not enforce flow contracts.
- Set resource and artifact growth limits from scenario 7 results, not speculative cross-host targets.

## Deployed Visualizer UAT

Status: **IN PROGRESS**. The fixed `1.0.0` tarball passed local install, real target-workflow,
deployed Visualizer, interruption recovery, and cleanup checks. The workflow paused at its required
human-review gate. Operator decision/sign-off and Product owner sign-off remain pending.
Windows/Linux operator UAT remains a later cross-platform confirmation; the package matrix is
automated install/run evidence, not that UAT.

- Product-code commit: `dce1e583ca1f50f28ac8d83cc52210a57b7a51fb`; package version: `1.0.0`.
- Candidate tarball: `ogsystem-1.0.0.tgz`, SHA-256 `37d7746af9905b45347bb41f6b1207fa4a7d2e3a02a8dacbd4fb300adea83e3b`. The same local tarball passed npm and pnpm install smoke. Package matrix run 37877480295 passed all 12 combinations and checked the downloaded artifact against the build-job digest.
- Regular CI run 37877480276 passed Linux/macOS Node 22/24 and package-install smoke jobs, but failed the Windows Node 22 and Node 24 `Test` jobs. The failure annotations only report exit code 1. Downloading job logs through the unauthenticated Actions API returns `403 Must have admin rights to Repository`; a repository administrator must collect the failed test output from the Actions UI or rerun the jobs with accessible logs before closing the Windows gate.
- Deployment environment: local macOS, Node.js `22.21.1`, exact-candidate Visualizer at `http://127.0.0.1:3380`, using an isolated copy of `mulit-debate/ogs-app`. `/healthz` and `/readyz` returned healthy/ready.
- Real workflow: fixed-tarball follow-up run `20261009-132640-bbecb069` completed proposal-author, critic-a, critic-b, and judge with 4/4 `gpt-6-luna` role executions, then paused at `review.judge@1#4.r1`. An injected exit `91` after proposal-author's durable outcome was recovered by resuming the same run; proposal-author executed once, and all four roles had one execution snapshot each. No review decision was submitted. The isolated run and logs are under `/tmp/ogs-release-uat-followup-1.0.0.HMrYzO/`; the source `mulit-debate/ogs-app` was not modified.
- Review Queue navigation, pending-review detail, and fixed decision actions were visible at 1280px, 1024px, and 390px; page width matched viewport. Deployed-package browser UAT passed.
- Cleanup exercise on a second copy of the target run added one older synthetic execution snapshot per role, then ran `run resume --cleanup-executions 1`. Cleanup event recorded success, removed 4 of 8 snapshot directories, and reduced the fixture from 782,336 to 602,112 bytes. `sessions.json`, plan fingerprint, review request, checkpoints, execution outcomes, state semantics, and one latest snapshot per role remained; a subsequent resume exited 0 without repeating role execution. This confirms cleanup behavior on target-workflow artifact layout but does not establish growth limits for naturally accumulated history.
- Missing/corrupt recovery checks on disposable copies returned `RESUME_STATE_MISSING` for missing `state.json` and `RESUME_STATE_INVALID` for corrupt `state.json`. `pnpm run test:runtime-regression` passed 49/49 on the candidate source checkout.
- Remaining scenarios: Windows operator acceptance, operator decision/sign-off, and separate Product owner sign-off. Local full suite passed 581 tests with the Windows-only test skipped on macOS.

## Windows Continuation

Use this section to continue the same candidate validation on a Windows 10/11 machine. Keep the
candidate ref and tarball digest fixed; do not rebuild after recording UAT results.

1. Check out product-code commit `dce1e583ca1f50f28ac8d83cc52210a57b7a51fb` and confirm
   `package.json` reports `1.0.0`. Use Node.js `22.x` and `24.x` in separate clean environments.
2. In the GitHub Actions UI, open regular CI run `37877480276` and save the full logs for
   `Test (Node 22, windows-latest)` and `Test (Node 24, windows-latest)`. The API log download
   requires repository admin rights; attach the failing test names and relevant stack traces to the
   release evidence before attempting a fix.
3. On each Node version, run from PowerShell:

   ```powershell
   corepack enable
   pnpm install --frozen-lockfile
   pnpm test
   pnpm run smoke:windows-lifecycle
   pnpm run test:visualizer-browser
   ```

   Save the command output, Node/pnpm versions, Windows version, and exit codes. If a failure is
   found, fix it on a new candidate ref and repeat CI, the 12-combination package matrix, packing,
   and UAT with a new digest.
4. Download the tarball artifact from package validation run `37877480295`, if available, and verify
   it before installation:

   ```powershell
   Get-FileHash .\ogsystem-1.0.0.tgz -Algorithm SHA256
   ```

   It must report
   `37d7746af9905b45347bb41f6b1207fa4a7d2e3a02a8dacbd4fb300adea83e3b`. Then run both package
   install smoke scripts against that same tarball:

   ```powershell
   pnpm run smoke:package-install:npm -- .\ogsystem-1.0.0.tgz
   pnpm run smoke:package-install:pnpm -- .\ogsystem-1.0.0.tgz
   ```

5. Complete the operator workflow with the same candidate package, record the Visualizer/API paths,
   recovery and cleanup observations, and leave the real pending review for its assigned operator.
   Record operator and Product owner sign-offs separately in
   [`release-evidence/1.0.0.md`](release-evidence/1.0.0.md).

Create one release evidence record per release candidate using
[`release-evidence/TEMPLATE.md`](release-evidence/TEMPLATE.md). Do not mark UAT complete until the
operator has made and recorded the review decision, completed the remaining scenarios, and signed
off; the product owner must record their acceptance separately.

## Development Package Baseline

This is preliminary evidence from the current development package, not stable-release evidence.

| Package | Node.js | OS | npm smoke | pnpm smoke |
| --- | --- | --- | --- | --- |
| `0.3.0` | `22.21.1` | macOS | PASS (`pnpm run smoke:package-install:npm`) | PASS (`pnpm run smoke:package-install:pnpm`) |
| `0.3.1` | `22.21.1` | macOS | PASS (same candidate tarball; see `release-evidence/0.3.1.md`) | PASS (same candidate tarball; see `release-evidence/0.3.1.md`) |
| `1.0.0` | `22.21.1` | macOS | PASS (same candidate tarball; see `release-evidence/1.0.0.md`) | PASS (same candidate tarball; see `release-evidence/1.0.0.md`) |

The smoke installs a locally packed tarball, checks `ogs --version` against its package manifest,
creates and runs a minimal project, starts the Visualizer, then uninstalls the CLI and confirms
shared role files and project data remain. It does not establish support for other Node.js/OS
combinations or close deployed Visualizer UAT. The `0.3.1` smoke used one fixed development-test
tarball; the `1.0.0` smoke used one fixed stable-release candidate tarball for both installers using
the external-tarball path used by the release workflow.

## Release Sequence

1. Decide the stable version before building a candidate package. Set it in `package.json`, commit
   and push the candidate, and use that immutable ref and version for all subsequent evidence.
2. Run regular CI on that ref and record its workflow run and result.
3. Dispatch the release package validation workflow with the same ref and exact version. Record its
   separate 12-combination install matrix result, tarball filename, and SHA-256 digest.
4. Run UAT against that exact tarball and record the same version, ref, and digest with results and
   sign-offs. Do not change the version or source after packaging. Any required change creates a new
   candidate ref and package; rerun CI, the package matrix, and UAT against the new artifact.
5. After every release gate passes, publish that exact validated tarball and create the matching
   `v<version>` source tag. Do not repack between UAT and publication.
