# OGSystem 文档索引与归档规则

本文件是 `docs/` 目录的权威索引，也是文档生命周期规则。新增、调整、归档文档时，应同步更新本索引，避免“文档存在但无人知道它是否仍然有效”。

归档目录说明见：`docs/archive/README.md`。

## 1. 文档优先级

当多个文档描述不一致时，按以下顺序判定：

1. `src/runtime/` 代码与测试：实现真相。
2. `docs/ogsystem-orchestration-semantics-v1.md`：运行时语义契约真相。
3. `docs/DECISIONS.md`：架构决策与边界真相。
4. `docs/usage-manual.md`：操作、目录、运行契约与入口手册。
5. `docs/product-introduction.md`：能力总览与对外说明。
6. 带日期的 plan / assessment / benchmark / checklist：历史记录，不覆盖上面的权威文档。

## 2. 活跃文档

以下文档属于当前活跃参考，应与代码保持同步：

- `docs/product-introduction.md`：项目定位、能力亮点、边界与阅读入口。
- `docs/usage-manual.md`：主手册，面向“如何理解并运行 OGSystem”。
- `docs/ogsystem-orchestration-semantics-v1.md`：V1 编排语义的单一事实源。
- `docs/DECISIONS.md`：重要架构决策与取舍。
- `docs/long-term-stability-roadmap.md`：长期稳定性与扩展路线图。
- `docs/ogsystem-ebook.md`：面向工程读者的系统级说明书，覆盖模块、原理、能力与演进方向。

## 3. 交付记录（已归档）

以下文档是已完成工作的交付记录、验证记录或阶段性快照。它们有价值，但默认不再作为当前规则的来源：

- `docs/archive/delivery/single-graph-runtime-execution-checklist.md`
- `docs/archive/delivery/runtime-risk-assessment-2026-04-10.md`
- `docs/archive/delivery/runtime-remediation-plan-2026-04-11.md`
- `docs/archive/delivery/runtime-resilience-validation-plan-2026-04-11.md`
- `docs/archive/delivery/runtime-replay-benchmark-2026-04-11.md`
- `docs/archive/delivery/runtime-state-dehydration-plan-2026-04-11.md`
- `docs/archive/delivery/runtime-test-coverage-audit-2026-04-11.md`

## 4. 历史参考（已归档）

以下文档保留为历史背景、兼容讨论或旧方案参考：

- `docs/archive/history/implementation-checklist-role-model-opencode-langgraph.md`
- `docs/archive/history/ogsystem-role-repo-minimal-plan.md`
- `docs/archive/history/opencode-single-serve-multi-session-plan.md`
- `docs/archive/history/semantic-kernel-v1.md`
- `docs/archive/history/xlgraph-subset-compatibility.md`
- `docs/archive/history/role-model-user-profile-minimal-spec.md`
- `docs/archive/history/langgraph-engine-example-systems.md`

## 5. 归档规则

1. 优先原地更新权威文档，而不是继续堆叠新的“说明性补丁文档”。
2. 只有计划、评估、基准、阶段复盘这类一次性材料，才应创建带日期的新文件，例如 `*-2026-04-11.md`。
3. 带日期文档默认进入“交付记录”，不是新的 source of truth。若其中结论已经成为长期规则，应回写到活跃文档。
4. 某文档失效时，先在本索引调整分类，再物理移动到 `docs/archive/`（`delivery/` 或 `history/`）。
5. 若一份旧文档被新文档替代，应在旧文档开头或显著位置注明 `Superseded by:`，并把新文档加入本索引。
6. 任何影响编排语义、恢复契约、运行目录契约的改动，必须在同一提交中同步更新：
   - `docs/ogsystem-orchestration-semantics-v1.md`
   - `docs/usage-manual.md`
   - 本索引 `docs/README.md`

## 6. 新文档准入规则

新文档创建前，先判断它属于哪一类：

- 如果是在解释“现在系统是什么”，应优先更新活跃文档。
- 如果是在记录“本次任务如何做、做到了什么”，应创建带日期的交付记录。
- 如果只是中间思路、临时分析或未收敛方案，不应直接放进主索引；建议留在分支、Issue、PR 描述或临时笔记中。

## 7. 推荐阅读路径

第一次进入项目，建议按以下顺序阅读：

1. `README.md`
2. `docs/product-introduction.md`
3. `docs/usage-manual.md`
4. `docs/ogsystem-orchestration-semantics-v1.md`
5. `docs/DECISIONS.md`
6. `docs/ogsystem-ebook.md`

需要评估历史修复与验证过程时，再回看“交付记录”分组。
