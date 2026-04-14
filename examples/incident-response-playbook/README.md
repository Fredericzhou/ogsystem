# Incident Response Playbook

Professional incident-handling example with explicit exception routing and human gates.

Capabilities covered:

- runtime `ERROR*` routing (`ERROR.<code>` first, then `ERROR`)
- compensation template role (`error-handler-base`)
- human approval and signal gates (`human-approve-gate`, `human-signal-wait`)
- feature-flagged rollout (`runtime.error_flows.v1=true` in local runtime override)

Run:

```bash
pnpm run run:adapter \
  --system examples/incident-response-playbook/system.mmd \
  --runtime examples/incident-response-playbook/runtime.json \
  --profiles examples/incident-response-playbook/profiles.json \
  --tools examples/incident-response-playbook/tools.json \
  --laws examples/incident-response-playbook/laws.json \
  --prompt "生产环境发布后出现关键告警，触发应急处置流程"
```

Force approval rejection:

```bash
HUMAN_APPROVE_EVENT=REJECTED pnpm run run:adapter \
  --system examples/incident-response-playbook/system.mmd \
  --runtime examples/incident-response-playbook/runtime.json \
  --profiles examples/incident-response-playbook/profiles.json \
  --tools examples/incident-response-playbook/tools.json \
  --laws examples/incident-response-playbook/laws.json \
  --prompt "生产环境发布后出现关键告警，触发应急处置流程"
```
