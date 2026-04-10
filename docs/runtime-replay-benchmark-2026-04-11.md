# Runtime Replay Benchmark

Date: 2026-04-11  
Status: measured baseline  
Command: `npm run bench:runtime-replay`

## 1. Purpose

This benchmark measures replay cost for a file-first resume path without adding checkpoint compaction or extra replay indexes.

The current script intentionally benchmarks a near-tail resume path:

- one loop-bound role
- `500` persisted checkpoint files
- `state.json` reconstructed through checkpoint `490`
- resume forced to replay only the last `10` pending checkpoint files

This is closer to the production concern in the plan: crash near the tail, then replay a short pending WAL suffix.

## 2. Environment

- platform: `darwin`
- node: `v20.20.0`
- loop budget: `500`
- restored checkpoint sequence before resume: `490`
- total checkpoint files: `500`
- pending checkpoint files replayed on resume: `10`

Measured at script timestamp: `2026-04-10T20:14:49.736Z`

## 3. Observed Results

- `stateLoadMs`: `1.602`
- `checkpointLoadMs`: `1.025`
- `resumeTotalMs`: `42.262`
- final status: `done`
- final role: `test-loop-probe`

## 4. Interpretation

On the current machine, replaying the last `10` checkpoint files after restoring `state.json` through sequence `490` is comfortably below the plan's informal concern threshold.

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
