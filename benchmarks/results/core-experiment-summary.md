# Corrected Core Experiment Summary

Protocol: v3, visible tests are optional internal gates; hidden tests run only after all selected arms persist delivery snapshots.

| Arm | Hidden RawPass | Claimed | FCR | VerifiedDelivery | Role Attribution | Canonical Integrity | Digest | Fail-Closed | Mean wall (s) | Mean LLM calls |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| A | 10/10 | 10/10 | 0/10 | 0/10 | 0/10 | 0/10 | 10/10 | 10/10 | 112.8 | 1.00 |
| B1 | 10/10 | 10/10 | 0/10 | 0/10 | 0/10 | 0/10 | 10/10 | 10/10 | 184.6 | 2.40 |
| B2 | 5/10 | 10/10 | 5/10 | 3/10 | 10/10 | 10/10 | 3/10 | 3/10 | 183.4 | 2.40 |
| C | 9/10 | 9/10 | 0/10 | 9/10 | 10/10 | 9/10 | 9/10 | 10/10 | 190.3 | 3.00 |

Source reports:
- `v3-seed1.json`
- `v3-seed2.json`

Deterministic state-machine ablation: `benchmarks/results/efsm-ablation.json`.
