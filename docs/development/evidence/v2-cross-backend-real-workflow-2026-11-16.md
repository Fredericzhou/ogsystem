# v2 Cross-Backend Real Workflow Evidence

## Result

The repository reproducibility probe `scripts/run-cross-backend-evidence.mjs` completed a real
Codex -> OpenCode run with model `gpt-6-luna`. The latest sanitized result is stored in
`v2-cross-backend-real-run-latest.json` (Run `20261116-151236-3a4fdcc6`) and reports two
transitions, two successful Roles, zero failed Roles, and zero noop executions.
The Flow was:

```text
planner (Codex / gpt-6-luna)
  -> READY handoff
implementer (OpenCode / codex-gateway/gpt-6-luna)
  -> READY terminal result
```

The model identity is the same `gpt-6-luna`; OpenCode uses its CLI provider-qualified model
identifier `codex-gateway/gpt-6-luna`, as required by the OpenCode protocol. Backend-specific
provider naming remains inside the Technical Binding and Adapter boundary.

## Runtime evidence

- Run status: `done`
- Transitions: `2`
- Successful Roles: `2`
- Failed Roles: `0`
- Noop executions: `0`
- Duration: approximately `45,708 ms`
- Codex adapter: `codex-app-server-v2`, model `gpt-6-luna`
- OpenCode adapter: `opencode-sdk-v2-native-tools-1`, with no native tools requested in this
  handoff probe. OpenCode filesystem/process resources are deliberately fail-closed because
  its current native bash/write boundary cannot prove staging isolation; native tool use is
  therefore not claimed by this business-flow record.
- Both Roles used separate Harness Template references in `.ogs/execution-bindings.json`.
- Both Roles had frozen Capability Snapshot, EffectiveEnvironmentPolicy, policy digest, capability
  digest, staging root, and recovery identity in `resolved-config.json`.
- The downstream Role received the business handoff and returned `CROSS_BACKEND_HANDOFF_OK` with
  `data.handoff=true`; no Backend, Harness, tool, permission, or
  workspace fields were projected into its business input.

The probe creates a disposable fixture and sanitizes its evidence before writing the repository
record. It is rerunnable with `pnpm exec tsx scripts/run-cross-backend-evidence.mjs`; temporary
absolute paths and credentials are excluded from the checked-in evidence.

## Failure evidence retained

Earlier Codex -> OpenCode attempts remain retained as failure evidence. The latest successful
Codex -> OpenCode run closes the current cross-Backend business-flow requirement without masking
those adapter failures.
