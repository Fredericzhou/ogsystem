# Corrected Core Experiment Reproduction

This package reproduces the corrected paper experiment. It contains five frozen
multi-file Python tasks, four arms (`A`, `B1`, `B2`, `C`), and two paired seeds
(40 task/seed/arm units). The independent hidden oracle is executed only after
all arms for a seed have persisted delivery snapshots.

## Fixed configuration

- Model: `gpt-6-luna` through Codex CLI
- Codex reasoning effort: `low`
- Per-role timeout: `900000 ms`
- Internal gate: task-specific visible `pytest` subset
- Independent oracle: task-specific hidden `pytest` suite, evaluated post-arm
- Tasks: `task-01-ledger-engine`, `task-02-config-merger`, `task-03-task-scheduler`, `task-04-review-rework-loop`, `task-05-cross-module-contract`
- Seeds: `1`, `2`
- Arms: A (single agent), B1 (shared directory), B2 (naive worktrees), C (OGS V2)

The model endpoint is an environment prerequisite and is not bundled in this
repository. Configure Codex so `codex exec -m gpt-6-luna` succeeds.

## Run from a clean worktree

```bash
pnpm install --frozen-lockfile
pnpm build
node benchmarks/run-live-pilot.mjs --dry-run
mkdir -p benchmarks/results
node benchmarks/run-live-pilot.mjs --task=all --arm=all --seed=1 --timeoutMs=900000 --out=benchmarks/results/v3-seed1.json
node benchmarks/run-live-pilot.mjs --task=all --arm=all --seed=2 --timeoutMs=900000 --out=benchmarks/results/v3-seed2.json
node benchmarks/run-efsm-ablation.mjs --out=benchmarks/results/efsm-ablation.json
node benchmarks/summarize-live-pilot.mjs
```

The live runner writes one JSON report per seed and delivery snapshots under
`benchmarks/results/artifacts/<task>/s<seed>/<arm>/`. Each result records visible
and hidden outcomes, completion claim, merge and Release diagnostics, role runs,
LLM call count, wall time, artifact digest, and the four audit dimensions.
Report artifact paths are repository-relative, and generated Python bytecode
(`__pycache__`, `.pyc`, `.pyo`) is excluded from snapshots and digest computation.

The deterministic ablation consumes no LLM calls and covers stale-head TOCTOU,
crash/resume replay, sticky failed Join, illegal transition/reference input,
loop-budget exhaustion, and repeated publication after digest failure. Its
result is `benchmarks/results/efsm-ablation.json`. The imperative side executes
local Git, filesystem, map, and loop operations without the OGS guards; it is
not a table of predeclared outcomes.

## Metric definitions

- `RawPass`: post-arm hidden pytest suite passes completely.
- `FCR`: `claimedComplete && !RawPass`; computed identically for every arm.
- `RoleAttribution`: final changes have immutable role-level commit evidence.
- `CanonicalIntegrity`: the delivered canonical snapshot is clean and version-controlled; failed or conflicting integration must leave canonical state clean.
- `VerifiedArtifactDigest`: delivered snapshot has a deterministic content digest and passes the visible gate.
- `FailClosedOnError`: an internal merge or gate error prevents a completion claim.
- `VerifiedDelivery`: all four audit dimensions are true.

Timeouts, runner errors, failed merges, and incomplete releases remain in the
denominator. The checked-in `v3-seed1.json` and `v3-seed2.json` files are the
raw evidence for the reported table. Re-running the live protocol may produce
different model traces; reproducibility means the same frozen tasks, prompts,
model settings, oracle separation, and denominator rules.

The checked-in v3 reports include a narrowly scoped protocol recalibration:
task-01 seed-1 was rerun for all four arms after the canonical-integrity rule
was tightened, and B1 was rerun for all five tasks in both seeds. The remaining
arms retain their original v3 traces. The recalibration metadata is recorded in
each seed JSON; it changes no task, prompt, model, oracle, or denominator rule.
