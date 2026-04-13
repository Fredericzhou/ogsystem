# Medical Quorum Consultation

Professional model-binding example for multi-specialist consultation with quorum-based review.

Capabilities covered:

- `parallel_split` fan-out from dispatcher to specialists
- `join.mode=quorum_of` with `join.min`
- `context.map` projection from join sources + global task
- model-first binding (`model.bind.*`) with dry-run friendly execution

Run:

```bash
pnpm run run:adapter \
  --system examples/medical-quorum-consultation/system.mmd \
  --laws examples/medical-quorum-consultation/laws.json \
  --user-profile examples/medical-quorum-consultation/user-profile.json \
  --prompt "患者发热伴神经与心血管症状，先形成会诊结论" \
  --dry-run
```
