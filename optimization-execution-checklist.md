# OGSystem Optimization Execution Checklist

Date: 2026-04-09  
Scope: minimal kernel hardening only

## 0. Goal

Make the runtime minimal and truthful:

- no fake capability surface
- strict config validation
- deterministic transition contract
- stable execution baseline

## 1. P0 Must Do (Hardening)

### 1.1 Align config model with real behavior

- [x] Decide and freeze execution capability surface:
  - Option A: keep single-tool execution profile only
  - Option B: implement multi-tool/retry/concurrency fully
- [x] Remove unused fields if not implemented:
  - removed `ExecutionProfile.toolPolicy.allowedTools[].retry`
  - removed `ExecutionProfile.toolPolicy.allowedTools[].maxConcurrency`
  - removed `CliTool.outputMode`
  - removed `CliTool.cwdPolicy`
- [x] Decide `talentBinding` behavior:
  - keep as metadata-only sidecar with explicit docs
  - or remove from runtime types until used

Acceptance:

- [x] `types.ts` and runtime behavior are 1:1 aligned
- [x] No field remains "declared but ignored"

### 1.2 Add schema validation for JSON inputs

- [x] Add runtime schemas for:
  - `profiles`
  - `tools`
  - `laws`
  - `role-prompts`
- [x] Validate immediately after file load (before graph build)
- [x] Return actionable errors with file path + field path

Acceptance:

- [x] Invalid config fails early with readable error
- [x] Valid config path unchanged

### 1.3 Fix transition output contract

- [x] Define one strict contract for executable role output:
  - `{"event":"EVENT_NAME","content":"..."}`
- [x] Replace regex/line-guess fallback with strict parser
- [x] Document contract in README + DSL spec

Acceptance:

- [x] Branching is deterministic
- [x] No "guess event" code path remains

### 1.4 Tighten no-exec behavior

- [x] Define explicit policy for nodes without `exec.bind`:
  - fail-fast by default, or
  - explicit noop mode via law/config switch
- [x] Ensure completion means intentional execution outcome, not accidental pass-through

Acceptance:

- [x] `noop` path is explicit and documented

## 2. P1 Should Do (Stability + Engineering)

### 2.1 Stabilize tool runner

- [x] Add max output bytes for stdout/stderr
- [x] Add timeout error category
- [x] If retry is retained, implement bounded retry with backoff
- [x] Keep dry-run behavior deterministic

Acceptance:

- [x] Large output and timeout behavior are test-covered

### 2.2 Minimal tests

- [x] Add test framework and baseline suites:
  - parser validation
  - law resolution
  - transition selection
  - dry-run
  - CLI arg validation
- [x] Add fixtures for valid/invalid Mermaid and JSON configs

Acceptance:

- [x] `npm test` runs in CI

### 2.3 Minimal CI quality gate

- [x] Add CI workflow:
  - `npm ci`
  - `npm run build`
  - `npm test`
- [x] Add lint/format only if rules are minimal and stable

Acceptance:

- [x] PR has automated pass/fail signal

### 2.4 Portability cleanup

- [x] Replace `zsh -lc "command -v"` in doctor with platform-neutral resolution

Acceptance:

- [x] doctor works without shell-specific dependency

## 3. P2 Optional Refactor

- [x] Evaluate runtime architecture:
  - keep LangGraph with typed graph + compile cache
  - or replace with explicit loop state machine
- [x] Split Mermaid parser into clear stages:
  - tokenize
  - parse
  - validate
  - compile

Acceptance:

- [x] design choice documented with tradeoff and benchmark notes

## 4. Execution Order

1. P0.1 config truthfulness  
2. P0.2 schema validation  
3. P0.3 output contract  
4. P0.4 no-exec policy  
5. P1.1 tool-runner hardening  
6. P1.2 tests  
7. P1.3 CI  
8. P1.4 portability  
9. P2 refactor decisions

## 5. Done Criteria

- [x] Build passes: `npm run build`
- [x] Tests pass: `npm test`
- [x] Minimal sample runs: `npm run run:adapter -- --system examples/minimal-system.mmd --laws examples/console-laws.json --prompt "demo" --dry-run`
- [x] Console sample runs: `npm run run:adapter -- --system examples/console-system.mmd --profiles examples/console-profiles.json --tools examples/console-tools.json --laws examples/console-laws.json --role-prompts examples/console-role-prompts.json --prompt "demo" --dry-run`
- [x] Docs/specs updated to match final implemented behavior
