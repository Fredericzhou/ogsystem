# Medical Quorum Consultation

Professional model-binding example for multi-specialist consultation with contract-backed review.

Capabilities covered:

- `parallel_split` fan-out from dispatcher to specialists
- `handoff.mode=strict` with `handoff.contracts`
- `join.mode=quorum_of` with `join.min=3`
- `context.map` projection from join sources + global task
- `role_input` validation on the projected review input
- v2 Harness/Backend binding through `.ogs/execution-bindings.json`; the graph contains
  business Flow and join semantics only

Run:

```bash
ogs run start \
  --system examples/medical-quorum-consultation/system.mmd \
  --laws examples/medical-quorum-consultation/laws.json \
  --user-profile examples/medical-quorum-consultation/user-profile.json \
  --input "患者发热伴神经与心血管症状，先形成会诊结论" \
  --dry-run
```
