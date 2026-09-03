# Runtime Replay Benchmark

`tests/benchmarks/runtime-replay-benchmark.mjs` measures the cost of loading a persisted
runtime state, loading the checkpoint tail, and resuming the durable replay scenario.

## Run

The default run preserves the baseline scenario: 500 loop iterations and checkpoint sequence
490 as the restore point.

```bash
pnpm run bench:runtime-replay
```

Use a smaller configuration for local smoke runs:

```bash
pnpm run bench:runtime-replay -- --iterations 5 --restore-checkpoint 4
```

Options can also be supplied through environment variables. Command-line options take
precedence over environment variables.

| CLI option | Environment variable | Default | Meaning |
| --- | --- | ---: | --- |
| `--iterations <count>` | `OGSYSTEM_RUNTIME_REPLAY_ITERATIONS` | `500` | Loop iteration budget |
| `--restore-checkpoint <sequence>` | `OGSYSTEM_RUNTIME_REPLAY_CHECKPOINT` | `490` | Last checkpoint included in the reconstructed state |
| `--output <path>` | `OGSYSTEM_RUNTIME_REPLAY_OUTPUT` | none | Path for the machine-readable JSON record |

The restore sequence must be non-negative and less than the iteration count. The benchmark
creates its run under the operating system temporary directory and removes it after a
successful run; temporary run directories must not be added to this documentation directory
or committed to the repository.

## Output Contract

The benchmark writes exactly one compact JSON record to stdout. The short human-readable
summary is written to stderr, so stdout can be redirected or parsed as JSON. `--output` writes
the same record, pretty-printed, with a trailing newline.

The record format is versioned and has this shape:

```json
{
  "schemaVersion": 1,
  "benchmark": "runtime-replay",
  "date": "2026-09-03T00:00:00.000Z",
  "environment": {
    "nodeVersion": "v20.0.0",
    "platform": "darwin",
    "arch": "arm64"
  },
  "scenario": {
    "iterationCount": 500,
    "restoreCheckpointSequence": 490
  },
  "checkpointCounts": {
    "total": 500,
    "restored": 490,
    "pending": 10
  },
  "metrics": {
    "transitionCount": 500,
    "stateLoadMs": 0.123,
    "checkpointLoadMs": 0.456,
    "resumeTotalMs": 12.345,
    "stateWriteMs": 0.789
  },
  "result": {
    "finalStatus": "done",
    "finalRoleId": "test-loop-probe"
  }
}
```

`stateLoadMs` measures `state.json` loading, `checkpointLoadMs` measures loading checkpoint
files after the restored state sequence, `resumeTotalMs` measures the resumed adapter run, and
`stateWriteMs` is the runtime's persisted state-write metric from the resumed run. Checkpoint
counts are reported as total files discovered, files included in the reconstructed state, and
files pending after that state.

## Trend Records

Store dated records outside the repository's temporary run directories. A trend entry should
identify the benchmark date, exact environment, scenario, command, and the JSON record (or a
link to an artifact containing it):

```markdown
## 2026-09-03

- Environment: Node v20.0.0, darwin/arm64, `<machine-id>`
- Scenario: 500 iterations, restore checkpoint 490
- Command: `node tests/benchmarks/runtime-replay-benchmark.mjs --output <artifact>.json`
- Record: `<artifact>.json`
- Metrics: state load `<ms>`, checkpoint load `<ms>`, resume total `<ms>`, state write `<ms>`
```

Keep repeated runs on the same machine and software environment comparable. Do not compare
absolute timings across machines or platforms without normalization, and do not set PERF-02
thresholds from a single run.
