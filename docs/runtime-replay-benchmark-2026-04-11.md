# Runtime Replay Benchmark

Date: 2026-04-11  
Status: measured baseline  
Command: `npm run bench:runtime-replay`

## 1. Purpose

This benchmark measures replay cost for a file-first resume path without adding checkpoint compaction or extra replay indexes.

The current script intentionally benchmarks a worst-case stress path:

- one loop-bound role
- `500` persisted checkpoint files
- `state.json` reset to the initial graph state before resume
- resume forced to replay the full checkpoint tail

This is stricter than a normal tail resume, where `state.json.lastCheckpointSequence` is usually already near the frontier.

## 2. Environment

- platform: `darwin`
- node: `v20.20.0`
- loop budget: `500`
- checkpoint count replayed: `500`

Measured at script timestamp: `2026-04-10T20:06:03.230Z`

## 3. Observed Results

- `stateLoadMs`: `0.236`
- `checkpointLoadMs`: `29.032`
- `resumeTotalMs`: `86.503`
- final status: `done`
- final role: `test-loop-probe`

## 4. Interpretation

On the current machine, replaying `500` checkpoint files is comfortably below the plan's informal concern threshold.

Current conclusion:

- no checkpoint compaction is justified yet
- no extra replay index is justified yet
- continue to keep replay logic simple and file-first

## 5. Reproduce

```bash
npm run bench:runtime-replay
```

Benchmark script:

- `tests/benchmarks/runtime-replay-benchmark.mjs`
