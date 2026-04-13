# Example Training Manual

This directory includes runnable examples for OGSystem semantics and operations.

## Minimal Learning Set

Use this small set first to cover most capabilities with minimum repetition:

1. `minimal-system.mmd`
2. `langgraph-debate-current/`
3. `medical-quorum-consultation/`
4. `incident-response-playbook/`
5. `rust-hello-pipeline/`

## Coverage Matrix

| Example | Binding Mode | Core Semantics | Operational Focus |
|---|---|---|---|
| `minimal-system.mmd` | model.bind | linear flow | quick smoke check |
| `langgraph-debate-current/` | model.bind | `parallel_split + all_of + loop.max` | multi-round orchestration |
| `medical-quorum-consultation/` | model.bind | `parallel_split + quorum_of + context.map` | quorum decision and projected join context |
| `incident-response-playbook/` | exec.bind | `ERROR* + compensation + human gates` | exception routing and human-in-the-loop control |
| `rust-hello-pipeline/` | exec.bind | sequential multi-role tool chain | side-effect workflow and artifact validation |

## Recommended Order

1. Start with `minimal-system.mmd`.
2. Move to `langgraph-debate-current/` for core graph semantics.
3. Run `medical-quorum-consultation/` for quorum + projection semantics.
4. Run `incident-response-playbook/` for runtime failure control and human gates.
5. Run `rust-hello-pipeline/` if you need external toolchain workflows.

## Fast Commands

```bash
pnpm run run:adapter --system examples/minimal-system.mmd --laws examples/console-laws.json --prompt "smoke" --dry-run

pnpm run run:adapter --system examples/langgraph-debate-current/system.mmd --laws examples/langgraph-debate-current/laws.json --user-profile examples/langgraph-debate-current/user-profile.json --prompt "是否继续保持最小化" --dry-run

pnpm run run:adapter --system examples/medical-quorum-consultation/system.mmd --laws examples/medical-quorum-consultation/laws.json --user-profile examples/medical-quorum-consultation/user-profile.json --prompt "患者发热伴神经与心血管症状，先形成会诊结论" --dry-run

pnpm run run:adapter --system examples/incident-response-playbook/system.mmd --runtime examples/incident-response-playbook/runtime.json --profiles examples/incident-response-playbook/profiles.json --tools examples/incident-response-playbook/tools.json --laws examples/incident-response-playbook/laws.json --prompt "生产环境发布后出现关键告警，触发应急处置流程"
```

## Extended/Compatibility Examples

- `target-model-binding-system.mmd`: smallest model-binding baseline.
- `langgraph-expert-consultation/`: all-of expert consultation baseline.
- `console-system.mmd`: legacy compatibility route for existing `profiles/tools`.
- `error-edge-compensation/`: focused ERROR* routing baseline.
- `human-gate-workflow/`: focused human gate baseline.
