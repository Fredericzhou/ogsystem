# Current-Source Validation 2026-11-26

This record documents validation of the current working tree after the CLI terminal-failure
handling and example smoke changes. It is engineering evidence, not a substitute for the
manual UAT scenarios or human sign-off in [`../release-uat-checklist.md`](../release-uat-checklist.md).

## Passed

- `pnpm run build`
- `pnpm test`: core suite `496` passed, `1` Windows-only test skipped, `0` failures; Team Site
  suite `108` passed, `0` failures.
- `pnpm run test:examples`: two successful dry-run examples and one expected fail-closed semantic
  route (`IR_ROUTE_NO_MATCH`).
- `node --test tests/cli.test.mjs`: `10` passed, `0` failures.
- `pnpm run smoke:package-install:npm`
- `pnpm run smoke:package-install:pnpm`
- `pnpm run test:docs-command-drift`
- `pnpm run test:doctor`: status `ok`, with no missing required commands.
- Follow-up `ogs project sync-models` refreshed `.ogs/model-catalog.json` from the stale
  2026-11-15 catalog to the current local adapter discovery (`generatedAt=2026-11-25T20:44:30.556Z`,
  215 entries); a second `pnpm run test:doctor` returned `status=ok` with `warnings=[]`.
- `pnpm run test:visualizer-browser`: Studio graph/workflow `17` passed, Build layout `4` passed,
  and `2` deployment-only tests skipped. The Contract editor and Context Map race cases were also
  repeated three times each (`6` focused passes).
- Darwin desktop screenshot baseline was regenerated for the already committed desktop workbench
  spacing rule; the full browser suite then passed without visual diffs.
- `git diff --check`

## Post-Refresh Regression

- After refreshing the model catalog, `pnpm build` passed again.
- After refreshing the model catalog, the core suite passed `496` tests with `0` failures and `1`
  Windows-only skip; `pnpm run test:team-site` passed `108/108`.
- `pnpm run test:doctor` returned `status=ok`, `warnings=[]`, and `model catalog loaded: 215 entries`.
- After refreshing the model catalog, `pnpm run test:visualizer-browser` passed Studio graph/workflow
  `17/17` and Build layout `4/4`, with `2` deployment-only tests skipped.
- After refreshing the model catalog, both `pnpm run smoke:package-install:npm` and
  `pnpm run smoke:package-install:pnpm` passed.
- After wiring Codex probing into Doctor, the repository `pnpm test` entry point passed: core
  `496` tests passed with `0` failures and `1` Windows-only skip; Team Site passed `108/108`.
- After wiring Codex probing into Doctor, `pnpm run test:visualizer-browser` passed Studio
  graph/workflow `17/17` and Build layout `4/4`, with `2` deployment-only tests skipped.
- After making provider discovery details actionable in model selection, the focused model contract
  suite passed `19/19`; final npm and pnpm package-install smokes both passed.
- `pnpm run run:doctor --system examples/target-model-binding-system.mmd --laws .ogs/laws.json
  --online-check` returned `status=ok` with no errors or warnings. Both configured Codex
  `gpt-6-luna` bindings returned `DOCTOR_PROVIDER_CONNECTIVITY_OK` after the Doctor path was
  connected to the existing Codex adapter probe. A real Codex-backed Project/Task/Run remains the
  authority for end-to-end provider readiness.

## Real Model Probe Boundary

- `pnpm --dir apps/team-site run verify:cases` was executed against the configured local model
  adapters. The probe completed role execution for the cross-backend case, but the complete run
  ended with four case failures: two missing formal release materialization records, one software
  case stopped before `delivery-lead`, and one release-operations case without the configured
  shared Responses API credential.
- The isolated `runCase` helper does not create a Project Workspace or a formal Task/Run. Its
  release projection now reports `not-applicable` when no V2 Release/Materialization evidence is
  present; it must not be interpreted as a published delivery. Formal Project Runs remain the
  authority for Commit, Release, Materialization, file read, and download evidence.
- The user reported that Windows execution was completed. The OS/runtime transcript is not present
  in this checkout, so Release UAT Scenario 4 remains `Not run` until the operator records the
  Windows version, Node/pnpm versions, commands, readiness result, and minimal workflow output.
- After increasing the isolated probe's whole-process budget from 10 to 30 minutes, a fresh
  `software-team` Codex run completed as `done` with all five Roles successful. Run
  `20261126-042211-707470cb` completed in `887532` ms. This confirms the earlier missing
  `delivery-lead` result was caused by the probe's aggregate timeout; it is still Role/Backend
  evidence only and does not close the formal Project/Task/Run acceptance scenarios.

### Latest Probe Follow-up

- A fresh `pnpm --dir apps/team-site run verify:cases` run after the catalog refresh and Codex
  probe fix completed four real model cases:
  - `cross-backend-review-loop`: Run `20261126-050026-d5785c80`, `2/2` Roles, `82082` ms.
  - `management-consulting`: Run `20261126-050149-a40f13b0`, `9/9` Roles, `324145` ms.
  - `software-team`: Run `20261126-050713-aaa2b430`, `5/5` Roles, `713474` ms.
  - `structured-debate`: Run `20261126-051907-35eda146`, `5/5` Roles, `131921` ms.
- `release-operations` failed closed before Run reservation with `MODEL_UNAVAILABLE`: its fixed
  `qwen/gpt-6-luna` and `kimi/gpt-6-luna` bindings are not available in the refreshed catalog
  because the shared Responses API credential is unavailable. This is a provider configuration
  blocker, not a successful delivery. The isolated probe still does not create formal Project,
  Task, Run, Workspace Commit, or Materialization evidence.
- The provider error now reaches the user boundary as: `the qwen backend is installed_but_broken:
  Shared Responses API credential is unavailable.` It no longer recommends a redundant catalog
  refresh when discovery has already identified the provider failure.

## Boundaries

- This record covers the current source checkout and local host only. It does not close the
  supported-machine, Windows, real-provider, real Project/Task/Run, accessibility, operator, or
  Product Owner UAT requirements.
- The model catalog is now refreshed and Doctor reports no catalog warning. The default Doctor
  invocation skips credential probes; use `--online-check` for the adapter-level connectivity check.
- The first package-install smoke attempt was stopped by the host reaching `ENOSPC`; after removing
  only the smoke's temporary install roots and restoring free space, both package-manager smokes
  passed.
- After the validation changes were committed as `806543d4439c4aa26929f71c1fb7c21166ca99c9`
  (`chore: harden release validation and runtime probes`), the final committed-source gate passed:
  `pnpm test` (496 core passed, one Windows-only skip, Team Site 108/108),
  `pnpm run test:examples`, `pnpm run test:docs-command-drift`, and
  `pnpm run test:visualizer-browser` (Studio 17/17, Build 4/4; two deployment-only skips).
  `git diff --check` passed and the working tree is clean. The local branch is one commit ahead of
  `origin/main`; this record does not imply that the commit has been pushed or published.
