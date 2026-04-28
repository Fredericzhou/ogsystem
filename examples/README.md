# Example Training Manual

This directory includes runnable examples for OGSystem semantics and operations.

## Minimal Learning Set

Use this small set first to cover most capabilities with minimum repetition:

1. `minimal-system.mmd`
2. `langgraph-debate-current/`
3. `medical-quorum-consultation/`
4. `runtime-native-human-review/`
5. `ogs-gstacklike/`
6. `rust-hello-pipeline/`
7. `legal-rag-dev-team/`

## Coverage Matrix

| Example | Binding Mode | Core Semantics | Operational Focus |
|---|---|---|---|
| `minimal-system.mmd` | model.bind | linear flow | quick smoke check |
| `langgraph-debate-current/` | model.bind | `parallel_split + all_of + loop.max` | multi-round orchestration |
| `medical-quorum-consultation/` | model.bind | `parallel_split + quorum_of + context.map + flow contract` | quorum decision, projected join context, and contract-backed validation |
| `runtime-native-human-review/` | model.bind | `review.* + runtime-native human review` | stop-for-review, operator decision, resume |
| `ogs-gstacklike/` | exec.bind | `review.* + ERROR* + shared artifacts + local role repo` | project-style delivery flow with native human review, compensation, and run-level artifact handoff |
| `rust-hello-pipeline/` | exec.bind | sequential multi-role tool chain | side-effect workflow and artifact validation |
| `legal-rag-dev-team/` | model.bind | `parallel_split + all_of + context.map + strict handoff + review.*` | software-team orchestration for a legal RAG service with citation requirements |

## Recommended Order

1. Start with `minimal-system.mmd`.
2. Move to `langgraph-debate-current/` for core graph semantics.
3. Run `medical-quorum-consultation/` for quorum + projection + flow contract semantics.
4. Run `runtime-native-human-review/` for native stop-review-resume semantics.
5. Run `ogs-gstacklike/` for a full project-style example with local role repo, native review, shared artifacts, and compensation.
6. Run `rust-hello-pipeline/` if you need external toolchain workflows.
7. Run `legal-rag-dev-team/` if you want a project-planning pattern for a citation-heavy legal RAG service.

## Fast Commands

```bash
ogs run start --system examples/minimal-system.mmd --laws examples/console-laws.json --input "smoke" --dry-run

ogs run start --system examples/langgraph-debate-current/system.mmd --laws examples/langgraph-debate-current/laws.json --user-profile examples/langgraph-debate-current/user-profile.json --input "是否继续保持最小化" --dry-run

ogs run start --system examples/medical-quorum-consultation/system.mmd --laws examples/medical-quorum-consultation/laws.json --user-profile examples/medical-quorum-consultation/user-profile.json --input "患者发热伴神经与心血管症状，先形成会诊结论" --dry-run

ogs run start --system examples/ogs-gstacklike/system.mmd --input "构建一个html页面，要求显示hello world" --workdir examples/ogs-gstacklike

ogs run start --system system.mmd --workdir examples/legal-rag-dev-team --input "开发一个法律RAG问答服务，要求回答时给出可核验信源" --dry-run

bash examples/ogs-gstacklike/scripts/validate-scenarios.sh
```

## Extended Examples

- `target-model-binding-system.mmd`: smallest model-binding baseline.
- `langgraph-expert-consultation/`: all-of expert consultation baseline.
- `console-system.mmd`: smallest local-shell exec.bind baseline.
- `error-flow-compensation/`: focused ERROR* routing baseline.
- `legal-rag-dev-team/`: project-planning workflow for a legal RAG team with explicit citation engineering.
