# Error Flow Compensation Example

This example demonstrates runtime failure routing with `ERROR*` edges.

Flow:

1. `worker` fails intentionally.
2. runtime matches `ERROR.<code>` first, then `ERROR` fallback.
3. `error-handler-base` emits `COMPENSATED` and forwards to `test-operator`.
4. `test-operator` emits `DONE` to `output`.

Run:

```bash
pnpm run run:adapter \
  --system examples/error-flow-compensation/system.mmd \
  --runtime examples/error-flow-compensation/runtime.json \
  --profiles examples/error-flow-compensation/profiles.json \
  --tools examples/error-flow-compensation/tools.json \
  --laws examples/error-flow-compensation/laws.json \
  --prompt "run error flow compensation example"
```
