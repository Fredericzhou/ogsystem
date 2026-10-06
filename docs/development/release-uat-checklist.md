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
  matrix run and its artifact digest separately from regular CI.
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

Status: **PARTIAL**. Browser automation passed against the locally installed `1.0.0` candidate on
macOS. Complete the bounded workflow with its intended operator, record the result and sign-offs,
and run it in any separate intended deployment environment before changing this item to passed.

- Package version/artifact: `1.0.0`, SHA-256 in `release-evidence/1.0.0.md`.
- Deployment environment: local macOS candidate at `127.0.0.1:3379`.
- Workflow and UI/API paths exercised: advanced-features graph; operations, Studio graph/structure, readiness, and wheel zoom.
- Result and issue references: browser automation PASS, 12/12; real operator workflow NOT RUN.
- Operator and product owner sign-off: NOT RUN.

Create one release evidence record per release candidate using
[`release-evidence/TEMPLATE.md`](release-evidence/TEMPLATE.md). Do not change this UAT status until
the deployed run and sign-offs are recorded.

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
