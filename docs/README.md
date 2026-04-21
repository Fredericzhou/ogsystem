# OGSystem 文档索引与归档规则

本文件是 `docs/` 目录的权威索引和归档规则。

归档目录说明见：`docs/archive/README.md`。

命令入口基线：活跃文档优先展示已安装的 `ogs*` CLI；当文档讨论源码仓开发时，再展示 `pnpm run ...` 等等效命令。

## 1. 文档优先级

当多个文档描述不一致时，按以下顺序判定：

1. `src/runtime/` 代码与测试：实现真相。
2. `docs/ogsystem-orchestration-semantics-v1.md`：运行时语义契约真相。
3. `docs/DECISIONS.md`：架构决策与边界真相。
4. `docs/usage-manual.md`：操作、目录、运行契约与入口手册。
5. `docs/product-introduction.md`：能力总览与对外说明。
6. 带日期的计划/评估/基准/checklist：历史记录。

## 2. 活跃文档

活跃文档：

- `docs/product-introduction.md`
- `docs/usage-manual.md`
- `docs/ogsystem-orchestration-semantics-v1.md`
- `docs/compiler-semantics-v1.md`
- `docs/nl2mmd-structure-templates.md`
- `docs/DECISIONS.md`
- `docs/long-term-stability-roadmap.md`
- `docs/todo-backlog.md`
- `docs/ogsystem-ebook.md`

活跃“计划类”文档只保留两类：

- `roadmap`（长期方向）：`docs/long-term-stability-roadmap.md`
- `backlog`（当前待办）：`docs/todo-backlog.md`

## 2.1 设计记录（非当前真相）

以下文档保留在 `docs/` 根目录作为设计背景参考：

- `docs/context-map-projection-guide.md`：`context.map` selector 与祖先可达性说明。
- `docs/ogsystem-data-projection-spec.md`：`quorum_of` 数据投影记录。
- `docs/ogsystem-semantics-manual.md`：对齐型语义手册。
- `docs/ogsystem-wait-timeout-semantics-v2.md`：未实现的 join 超时提案。

## 3. 交付记录（已归档）

以下文档是交付记录或阶段快照：

- `docs/archive/delivery/single-graph-runtime-execution-checklist.md`
- `docs/archive/delivery/runtime-risk-assessment-2026-04-10.md`
- `docs/archive/delivery/runtime-remediation-plan-2026-04-11.md`
- `docs/archive/delivery/runtime-resilience-validation-plan-2026-04-11.md`
- `docs/archive/delivery/runtime-replay-benchmark-2026-04-11.md`
- `docs/archive/delivery/runtime-state-dehydration-plan-2026-04-11.md`
- `docs/archive/delivery/runtime-test-coverage-audit-2026-04-11.md`
- `docs/archive/delivery/source-commenting-hardening-plan-2026-04-11.md`（proposed stage plan）
- `docs/archive/delivery/vnext-execution-plan-2026-04-11.md`（proposed stage plan）
- `docs/archive/delivery/project-cli-lifecycle-plan-2026-04-12.md`（delivered lifecycle/productization plan）
- `docs/archive/delivery/cross-platform-rust-validation-and-gap-analysis-2026-04-12.md`（delivered cross-platform verification + gap analysis）
- `docs/archive/delivery/data-projection-quorum-implementation-checklist-2026-04-12.md`（delivered implementation checklist with risk controls）
- `docs/archive/delivery/error-flow-v1-execution-plan-2026-04-13.md`（delivered error-flow execution record）
- `docs/archive/delivery/error-flow-v1-hardening-followup-2026-04-13.md`（delivered follow-up hardening and test-maintainability closure）
- `docs/archive/delivery/flow-contract-refactor-plan-2026-04-14.md`（proposed flow-contract-first semantics and refactor plan）
- `docs/archive/delivery/typed-compiler-execution-plan-2026-04-16.md`（proposed unified static compiler entry checklist）
- `docs/archive/delivery/ogsystem-visualization-platform-solution-2026-04-16.md`（proposal for a runtime visualization and observability platform）
- `docs/archive/delivery/runtime-refactor-execution-checklist-2026-04-18.md`（delivered runtime refactor checklist; phases 0-11 completed）
- `docs/archive/delivery/installable-cli-release-notes-2026-04-20.md`（delivered installable CLI packaging, scaffolding, and operator-doc release notes）
- `docs/archive/delivery/agency-agents-role-repo-integration-plan-2026-04-20.md`（recommended integration plan for importing `agency-agents` as an OGSystem-compatible derived role repository）
- `docs/archive/delivery/runtime-input-contract-vnext-plan-2026-04-21.md`（proposed latest-version plan for schema-linked projected input and controlled shared data）
- `docs/archive/delivery/runtime-governance-hardening-plan-2026-04-21.md`（proposed 30-day plan for runtime governance, reliability gates, and minimal execution-policy hardening）
- `docs/archive/delivery/opencode-provider-reference-and-error-surfacing-2026-04-21.md`（delivered provider reference scaffolding and provider-error surfacing correction for OpenCode model.bind runs）
- `docs/archive/delivery/ogsystem-naming-style-review-2026-04-14.md`（archived naming audit; `flow/edge` conclusion superseded by 2026-04-15 alignment review）
- `docs/archive/delivery/ogsystem-flow-edge-alignment-review-2026-04-15.md`（delivered flow/edge alignment audit and canonical decision）
- `docs/archive/delivery/ogsystem-flow-edge-alignment-execution-plan-2026-04-15.md`（delivered flow/edge alignment rollout and closure record）
- `docs/archive/delivery/optimization-execution-checklist-2026-04-10.md`

## 4. 历史参考（已归档）

以下文档保留为历史参考：

- `docs/archive/history/implementation-checklist-role-model-opencode-langgraph.md`
- `docs/archive/history/ogsystem-role-repo-minimal-plan.md`
- `docs/archive/history/opencode-single-serve-multi-session-plan.md`
- `docs/archive/history/semantic-kernel-v1.md`
- `docs/archive/history/xlgraph-subset-compatibility.md`
- `docs/archive/history/role-model-user-profile-minimal-spec.md`
- `docs/archive/history/langgraph-engine-example-systems.md`
- `docs/archive/history/ogsystem-vnext-dev-plan.md`
- `docs/archive/history/mermaid-dsl-v0.1.md`
- `docs/archive/history/ogsystem-design-philosophy.md`
- `docs/archive/history/role-md-open-source-projects.md`

## 5. 归档规则

1. 优先原地更新权威文档。
2. 计划、评估、基准、阶段复盘等一次性材料使用带日期的新文件。
3. 带日期文档默认归入交付记录，不作为 source of truth。
4. 文档失效时，先更新本索引，再移动到 `docs/archive/`。
5. 被替代的旧文档应标注 `Superseded by:`，并更新本索引。
6. 影响编排语义、恢复契约、运行目录契约的改动，同步更新：
   - `docs/ogsystem-orchestration-semantics-v1.md`
   - `docs/usage-manual.md`
   - 本索引 `docs/README.md`
7. 包管理策略或命令入口变更时，同步更新 `README.md` 和 `docs/usage-manual.md`。
8. 覆盖率相关说明变更时，同步更新 `README.md` 和 `docs/usage-manual.md`。

## 6. 计划文档放置规则（防混淆）

1. `docs/` 根目录不放阶段性计划、评估、基准、checklist。
2. 阶段性材料放 `docs/archive/delivery/`。
3. 历史方案放 `docs/archive/history/`。
4. 同主题双份文档时，保留归档版本并移除根目录副本。

## 7. 新文档准入规则

新文档创建前，先判断它属于哪一类：

- 如果是在解释“现在系统是什么”，应优先更新活跃文档。
- 如果是在记录“本次任务如何做、做到了什么”，应创建带日期的交付记录。
- 如果只是中间思路、临时分析或未收敛方案，不应直接放进主索引；建议留在分支、Issue、PR 描述或临时笔记中。

## 8. 推荐阅读路径

第一次进入项目，建议按以下顺序阅读：

1. `README.md`
2. `docs/product-introduction.md`
3. `docs/usage-manual.md`
4. `docs/ogsystem-orchestration-semantics-v1.md`
5. `docs/compiler-semantics-v1.md`
6. `docs/nl2mmd-structure-templates.md`
7. `docs/DECISIONS.md`
8. `docs/ogsystem-ebook.md`

需要评估历史修复与验证过程时，再回看“交付记录”分组。
