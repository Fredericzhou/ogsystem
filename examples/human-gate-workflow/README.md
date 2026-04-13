# Human Gate Workflow Example

This example demonstrates template-based human gates as normal role nodes.

Flow:

1. `human-approve-gate` emits `APPROVED | REJECTED | TIMEOUT`.
2. On `APPROVED`, `human-signal-wait` emits `SIGNAL_OK | SIGNAL_FAIL | EXPIRED`.
3. On `SIGNAL_OK`, `test-operator` emits `DONE` and exits to `output`.

Default run (approve + signal ok):

```bash
pnpm run run:adapter \
  --system examples/human-gate-workflow/system.mmd \
  --profiles examples/human-gate-workflow/profiles.json \
  --tools examples/human-gate-workflow/tools.json \
  --laws examples/human-gate-workflow/laws.json \
  --prompt "run human gate workflow example"
```

Force a rejected approval decision:

```bash
HUMAN_APPROVE_EVENT=REJECTED pnpm run run:adapter \
  --system examples/human-gate-workflow/system.mmd \
  --profiles examples/human-gate-workflow/profiles.json \
  --tools examples/human-gate-workflow/tools.json \
  --laws examples/human-gate-workflow/laws.json \
  --prompt "run human gate workflow example"
```
