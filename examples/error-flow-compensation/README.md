# Error Flow Compensation Example

This example demonstrates runtime failure routing with `ERROR*` edges.

Flow:

1. `worker` fails intentionally.
2. runtime matches `ERROR.<code>` first, then `ERROR` fallback.
3. `error-handler-base` emits `COMPENSATED` and forwards to `test-operator`.
4. `test-operator` emits `DONE` to `output`.

Run:

```bash
ogs run start \
  --system system.mmd \
  --runtime runtime.json \
  --laws laws.json \
  --workdir examples/error-flow-compensation \
  --input "run error flow compensation example"
```
