# CLI Follow-up Checklist

Date: 2026-04-22

Status: proposed execution checklist

## 1. Goal

Tighten the `ogs` CLI so the current operator-facing contract matches the latest command surface:

- subcommand help is the authority
- unknown commands fail at the command layer
- main `run` commands no longer accept hidden legacy flags
- resume guidance is available on the modern path and uses modern syntax

## 2. In Scope

- [ ] Restore and modernize resume guidance on the main CLI path
- [ ] Fix unknown top-level command handling
- [ ] Remove hidden legacy flags from `ogs run start` and `ogs run resume`
- [ ] Add focused tests for the above
- [ ] Decide whether active docs should stay mixed-mode or move to latest-only wording

## 3. Out of Scope

- [ ] Removing all runtime-level legacy implementation in one pass
- [ ] Bulk cleanup of archived docs
- [ ] Broad renaming outside the main `ogs` surface
- [ ] Adding a new dedicated CLI compatibility test file by default

## 4. Work Items

### 4.1 Resume Guidance

Problem:
`printResumeHint()` is only wired from the legacy catch path, so `ogs run start` and `ogs run resume` can fail without modern resume guidance. The existing hint builder also prints legacy syntax such as `ogs --resume-run ...` and old flag names.

Execution:

- [ ] Wire resume hint emission into the main `run start` failure path.
- [ ] Wire resume hint emission into the main `run resume` failure path.
- [ ] Change the suggested command to the modern form:
  `ogs run resume <run-id> ...`
- [ ] Use modern visualizer flags in hints:
  `--host`, `--port`
- [ ] Do not print hidden legacy flags in the modern hint:
  `--profiles`, `--tools`, `--visualizer-host`, `--visualizer-port`
- [ ] Keep hint emission gated:
  only print a hint when the failure is a `RuntimeError` and a valid `runId` is available.
- [ ] Do not print recovery commands for CLI input errors, unknown flags, missing `<run-id>`, or other command-shape failures.

Acceptance:

- [ ] `ogs run start ...` failure prints a copyable modern resume command when `runId` exists.
- [ ] `ogs run resume ...` failure also prints a modern resume command when `runId` exists.
- [ ] No hint is printed for pure CLI input mistakes.

### 4.2 Unknown Top-level Command Handling

Problem:
Unknown top-level commands currently fall through to legacy parsing, so `ogs foo` reports a parser-level positional error instead of a command-level unknown command.

Execution:

- [ ] Add explicit top-level unknown-command handling in `main()`.
- [ ] Only enter legacy mode when the argv shape positively matches the legacy compatibility flag set.
- [ ] Remove the current negative fallback pattern:
  "not a known command, therefore try legacy mode".
- [ ] Return a command-level `CLI_UNKNOWN_COMMAND` error with root usage for unknown commands.

Acceptance:

- [ ] `ogs foo` fails as an unknown command.
- [ ] The error includes root command guidance.
- [ ] `ogs --system ... --input ...` still enters legacy mode.

### 4.3 Remove Hidden Legacy Flags From Main Run Commands

Problem:
`ogs run start` and `ogs run resume` help no longer documents `--profiles`, `--tools`, and `--log-run`, but parsing still accepts and forwards them.

Execution:

- [ ] Remove `profiles` from `runStartCommand()` parsing.
- [ ] Remove `tools` from `runStartCommand()` parsing.
- [ ] Remove `log-run` from `runStartCommand()` parsing.
- [ ] Remove `profiles` from `runResumeCommand()` parsing.
- [ ] Remove `tools` from `runResumeCommand()` parsing.
- [ ] Remove `log-run` from `runResumeCommand()` parsing.
- [ ] Remove the corresponding forwarding from the main `run` path.
- [ ] Keep `resolveLogRunOption()` reusable for legacy mode if needed.
- [ ] Do not broaden this item into deleting legacy runtime support wholesale.

Acceptance:

- [ ] `ogs run start --profiles x` fails as an unknown option.
- [ ] `ogs run resume --tools x` fails as an unknown option.
- [ ] `ogs run start --log-run` fails as an unknown option.
- [ ] Main-path behavior matches main-path help.

### 4.4 Tests

Priority:
land changes in existing CLI test files first.

Execution:

- [ ] Update `tests/cli.test.mjs`:
  - [ ] unknown top-level command returns `CLI_UNKNOWN_COMMAND`
  - [ ] legacy top-level entry still works when argv positively matches legacy flags
- [ ] Update `tests/cli-help.test.mjs`:
  - [ ] main help does not imply hidden legacy run flags
  - [ ] modern subcommand help remains the authority
- [ ] Update `tests/cli-lifecycle.test.mjs`:
  - [ ] modern-path run failure prints modern resume guidance when `runId` exists
  - [ ] no resume hint for CLI-shape errors
  - [ ] `run start --profiles ...` fails
  - [ ] `run resume --tools ...` fails
- [ ] Do not add `tests/cli-compat.test.mjs` unless the existing files become clearly overloaded.
- [ ] Only run `tests/package-install.test.mjs` if packaging surface or installed-entry behavior changes.

Suggested verification:

- [ ] `pnpm build`
- [ ] `node --test tests/cli.test.mjs tests/cli-help.test.mjs tests/cli-lifecycle.test.mjs`
- [ ] `tests/package-install.test.mjs` only when the changed surface justifies it
- [ ] `pnpm test` only if the edit footprint expands beyond the targeted CLI surface

## 5. Docs Decision Item

This item is intentionally conditional.

Observation:
active docs still contain some source-checkout and legacy/runtime-internal wording. Whether that is a bug depends on product posture.

Decision question:

- [ ] Do active docs remain mixed-mode, with source-checkout and legacy/runtime-internal notes still visible?
- [ ] Or do active docs move to latest-only wording for operator-facing pages?

If the decision is latest-only, then execute:

- [ ] tighten `README.md`
- [ ] tighten `docs/usage-manual.md`
- [ ] keep compatibility notes only in archive/migration-oriented material

If the decision is mixed-mode, then execute:

- [ ] keep the content
- [ ] but clearly label it as source-checkout or compatibility-only
- [ ] avoid presenting it as the default operator path

## 6. Exit Criteria

- [ ] Main `run` commands no longer accept undocumented legacy flags
- [ ] Unknown top-level commands fail at the command layer
- [ ] Modern-path failures emit modern resume guidance only when appropriate
- [ ] Targeted CLI tests pass
- [ ] Active-doc wording matches the explicit product decision

## 7. Suggested Commit Sequence

- `cli: restore modern resume guidance`
- `cli: reject hidden legacy run flags`
- `cli: handle unknown top-level commands explicitly`
- `docs: tighten cli contract wording`
