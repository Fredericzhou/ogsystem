# Runtime Replay Baseline 2026-09-03

Environment: Node v22.23.2, darwin/x64. The records were collected on the same local machine and
software tree. They are not cross-machine performance claims.

Scenario: 500 iterations, restore checkpoint 490. Each run used:

```bash
node tests/benchmarks/runtime-replay-benchmark.mjs \
  --iterations 500 --restore-checkpoint 490 --output <record>.json
```

| Run | State load (ms) | Checkpoint load (ms) | Resume total (ms) | State write (ms) | Counts |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 6.049 | 4.389 | 842.358 | 6 | 500 / 490 / 10 |
| 2 | 6.394 | 4.016 | 885.507 | 6 | 500 / 490 / 10 |
| 3 | 6.699 | 5.008 | 1270.695 | 9 | 500 / 490 / 10 |

The metrics are reported as `stateLoadMs`, `checkpointLoadMs`, `resumeTotalMs`, and
`stateWriteMs`. The third resume measurement shows meaningful local variance, so PERF-02 uses a
report-only gate rather than a failing CI gate:

| Metric | Report-only limit |
| --- | ---: |
| `stateLoadMs` | 10 ms |
| `checkpointLoadMs` | 8 ms |
| `resumeTotalMs` | 1800 ms |
| `stateWriteMs` | 15 ms |

Check a record with:

```bash
node scripts/runtime-replay-threshold-check.mjs --input <record>.json
```

Use `--fail` only in a controlled benchmark job after variance is re-measured. A threshold
violation is currently reported and does not fail the default command. The data does not justify
checkpoint compaction, so P2-05 remains data-gated and the checkpoint format is unchanged.
