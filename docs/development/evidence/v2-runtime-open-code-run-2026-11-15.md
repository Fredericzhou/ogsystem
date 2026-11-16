# v2 Runtime Evidence: OpenCode Run (Historical)

> Historical adapter evidence. This record predates the current `gpt-6-luna` acceptance
> baseline and is retained for regression context; it does not establish current Gate B or Gate C
> verification.

## Run

- Run ID: `20261115-235444-0a159771`
- Backend: OpenCode
- Model: `opencode/beam-free`
- Execution path: CLI Runtime, real Backend session, non-dry execution
- Result: `done`
- Role executions: 5 successful, 0 failed, 0 noop
- Graph coverage: parallel split, Join, bounded loop, terminal aggregation

## Frozen policy evidence

The run's `resolved-config.json` records, for every Role:

- `ogsContractVersion: 2`
- Backend and model identity
- Run Capability Snapshot and `verifiedTools`
- The executable tool intersection computed in memory from `allowedTools` and `verifiedTools`
- EffectiveEnvironmentPolicy with the run staging root
- `capabilityDigest` and `policyDigest`
- Stable `recoveryIdentity`

The terminal Run is not resumed or rediscovered after completion. A terminal resume request is
rejected, and recovery tests verify that an interrupted Run reuses the frozen configuration.

## Limits

This record proves Runtime/Adapter execution and policy freezing. It is not a Gate C software or
documentation delivery sign-off: those workflows still require a real repository/document,
authorized Artifact output, reviewer decision, and product-owner evidence through Studio or CLI.
Codex models unavailable in the local account were rejected fail-closed; OpenCode is the verified
local Backend for this evidence.
