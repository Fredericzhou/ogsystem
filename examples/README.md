# v2 Example Set

These examples are the active Contract Set v2 smoke and semantics set. Every executable Role
resolves through a v2 Harness Template; historical Profile/Tool and `exec.bind` examples are in
`examples/archive/v1/` and are not active inputs.

## Active Examples

| Example | Coverage |
| --- | --- |
| `target-model-binding-system.mmd` | Minimal Harness-bound linear flow |
| `langgraph-debate-current/` | Parallel split, all-of Join, and bounded loop |
| `medical-quorum-consultation/` | Quorum Join, context projection, and flow contract |
| `legal-rag-dev-team/` | Parallel delivery planning, strict handoff, and review |
| `ogs-gstacklike/` | High-value release pipeline: intake, review, QA, shipping, deployment, and compensation |

## Validation Fixtures

The following migrated graphs are retained for protocol and failure-path verification rather than
as built-in product teams:

| Fixture | Purpose |
| --- | --- |
| `error-flow-compensation/` | Error-event routing, compensation, escalation, and abort paths |
| `mulit-debate-ogs/` | Legacy investment debate topology; overlaps the built-in `structured-debate` team |

## Smoke Commands

```bash
pnpm run test:examples
```

The command runs the minimal linear, parallel/all-of, and quorum scenarios with the real Codex
adapter in dry-run mode. It asserts that the v2 graph compiles, binds a model/Harness, freezes
the run policy, and produces no noop execution.

For the full architecture and acceptance evidence requirements, see:

- `docs/development/role-execution-architecture.md`
- `docs/development/v2-validation-and-acceptance.md`
