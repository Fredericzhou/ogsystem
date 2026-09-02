# CLI Follow-up Checklist

Date: 2026-04-22

Status: delivered and archived

## 1. Goal

Tighten the `ogs` CLI so the current operator-facing contract matches the latest command surface:

- subcommand help is the authority
- unknown commands fail at the command layer
- main `run` commands no longer accept hidden legacy flags
- resume guidance is available on the modern path and uses modern syntax

## 2. In Scope

- [x] Restore and modernize resume guidance on the main CLI path
- [x] Fix unknown top-level command handling
- [x] Remove hidden legacy flags from `ogs run start` and `ogs run resume`
- [x] Add focused tests for the above
- [x] Decide whether active docs should stay mixed-mode or move to latest-only wording

## 3. Out of Scope

- Removing all runtime-level legacy implementation in one pass
- Bulk cleanup of archived docs
- Broad renaming outside the main `ogs` surface
- Adding a new dedicated CLI compatibility test file by default

## 4. Work Items

### 4.1 Resume Guidance

Problem:
`printResumeHint()` is only wired from the legacy catch path, so `ogs run start` and `ogs run resume` can fail without modern resume guidance. The existing hint builder also prints legacy syntax such as `ogs --resume-run ...` and old flag names.

Execution:

- [x] Wire resume hint emission into the main `run start` failure path.
- [x] Wire resume hint emission into the main `run resume` failure path.
- [x] Change the suggested command to the modern form:
  `ogs run resume <run-id> ...`
- [x] Use modern visualizer flags in hints:
  `--host`, `--port`
- [x] Do not print hidden legacy flags in the modern hint:
  `--profiles`, `--tools`, `--visualizer-host`, `--visualizer-port`
- [x] Keep hint emission gated:
  only print a hint when the failure is a `RuntimeError` and a valid `runId` is available.
- [x] Do not print recovery commands for CLI input errors, unknown flags, missing `<run-id>`, or other command-shape failures.

Acceptance:

- [x] `ogs run start ...` failure prints a copyable modern resume command when `runId` exists.
- [x] `ogs run resume ...` failure also prints a modern resume command when `runId` exists.
- [x] No hint is printed for pure CLI input mistakes.

### 4.2 Unknown Top-level Command Handling

Problem:
Unknown top-level commands currently fall through to legacy parsing, so `ogs foo` reports a parser-level positional error instead of a command-level unknown command.

Execution:

- [x] Add explicit top-level unknown-command handling in `main()`.
- [x] Only enter legacy mode when the argv shape positively matches the legacy compatibility flag set.
- [x] Remove the current negative fallback pattern:
  "not a known command, therefore try legacy mode".
- [x] Return a command-level `CLI_UNKNOWN_COMMAND` error with root usage for unknown commands.

Acceptance:

- [x] `ogs foo` fails as an unknown command.
- [x] The error includes root command guidance.
- [x] `ogs --system ... --input ...` still enters legacy mode.

### 4.3 Remove Hidden Legacy Flags From Main Run Commands

Problem:
`ogs run start` and `ogs run resume` help no longer documents `--profiles`, `--tools`, and `--log-run`, but parsing still accepts and forwards them.

Execution:

- [x] Remove `profiles` from `runStartCommand()` parsing.
- [x] Remove `tools` from `runStartCommand()` parsing.
- [x] Remove `log-run` from `runStartCommand()` parsing.
- [x] Remove `profiles` from `runResumeCommand()` parsing.
- [x] Remove `tools` from `runResumeCommand()` parsing.
- [x] Remove `log-run` from `runResumeCommand()` parsing.
- [x] Remove the corresponding forwarding from the main `run` path.
- [x] Keep `resolveLogRunOption()` reusable for legacy mode if needed.
- [x] Do not broaden this item into deleting legacy runtime support wholesale.

Acceptance:

- [x] `ogs run start --profiles x` fails as an unknown option.
- [x] `ogs run resume --tools x` fails as an unknown option.
- [x] `ogs run start --log-run` fails as an unknown option.
- [x] Main-path behavior matches main-path help.

### 4.4 Tests

Priority:
land changes in existing CLI test files first.

Execution:

- [x] Update `tests/cli.test.mjs`:
  - [x] unknown top-level command returns `CLI_UNKNOWN_COMMAND`
  - [x] legacy top-level entry still works when argv positively matches legacy flags
- [x] Update `tests/cli-help.test.mjs`:
  - [x] main help does not imply hidden legacy run flags
  - [x] modern subcommand help remains the authority
- [x] Update `tests/cli-lifecycle.test.mjs`:
  - [x] modern-path run failure prints modern resume guidance when `runId` exists
  - [x] no resume hint for CLI-shape errors
  - [x] `run start --profiles ...` fails
  - [x] `run resume --tools ...` fails
- [x] Do not add `tests/cli-compat.test.mjs` unless the existing files become clearly overloaded.
- [x] Only run `tests/package-install.test.mjs` if packaging surface or installed-entry behavior changes.

Suggested verification:

- [x] `pnpm build`
- [x] `node --test tests/cli.test.mjs tests/cli-help.test.mjs tests/cli-lifecycle.test.mjs`
- [x] `tests/package-install.test.mjs` only when the changed surface justifies it
- [x] `pnpm test` only if the edit footprint expands beyond the targeted CLI surface

## 5. Docs Decision Item

This item is intentionally conditional.

Observation:
active docs still contain some source-checkout and legacy/runtime-internal wording. Whether that is a bug depends on product posture.

Decision question:

- [ ] Do active docs remain mixed-mode, with source-checkout and legacy/runtime-internal notes still visible?
- [x] Or do active docs move to latest-only wording for operator-facing pages?

If the decision is latest-only, then execute:

- [x] tighten `README.md`
- [x] tighten `docs/usage-manual.md`
- [x] keep compatibility notes only in archive/migration-oriented material

If the decision is mixed-mode, then execute:

- [ ] keep the content
- [ ] but clearly label it as source-checkout or compatibility-only
- [ ] avoid presenting it as the default operator path

## 6. Exit Criteria

- [x] Main `run` commands no longer accept undocumented legacy flags
- [x] Unknown top-level commands fail at the command layer
- [x] Modern-path failures emit modern resume guidance only when appropriate
- [x] Targeted CLI tests pass
- [x] Active-doc wording matches the explicit product decision

## 7. Suggested Commit Sequence

- `cli: restore modern resume guidance`
- `cli: reject hidden legacy run flags`
- `cli: handle unknown top-level commands explicitly`
- `docs: tighten cli contract wording`

## 8. Delivery Notes

- `main()` now rejects unknown top-level commands before any legacy fallback and only enters legacy mode when argv positively matches the legacy compatibility flag set.
- `run start` and `run resume` now emit modern `ogs run resume <run-id>` guidance only for `RuntimeError` failures that carry a valid `runId`.
- Main-path `run` parsing no longer accepts hidden `--profiles`, `--tools`, or `--log-run`; those remain legacy-only internals.
- Active operator docs were tightened to latest-only wording, while compatibility/history notes stay in archived material.
