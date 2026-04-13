# Error Edge Compensation Example

This example demonstrates runtime failure routing with `ERROR*` edges.

Flow:

1. `worker` fails intentionally.
2. runtime matches `ERROR.<code>` first, then `ERROR` fallback.
3. `error-handler-base` emits `COMPENSATED` and forwards to `test-operator`.
4. `test-operator` emits `DONE` to `output`.

Run:

```bash
pnpm run run:adapter \
  --system examples/error-edge-compensation/system.mmd \
  --runtime examples/error-edge-compensation/runtime.json \
  --profiles examples/error-edge-compensation/profiles.json \
  --tools examples/error-edge-compensation/tools.json \
  --laws examples/error-edge-compensation/laws.json \
  --prompt "run error edge compensation example"
```
