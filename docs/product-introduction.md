# OGSystem 产品自我介绍

## 1. 它是什么

OGSystem 是一个面向多角色协作流程的单机编排内核。它使用受限的 Mermaid `flowchart` 作为 DSL，把角色图、模型绑定、恢复语义和运行证据统一收敛到一个文件优先的运行时里。

它的目标不是做“平台大全”，而是把下面几件事做扎实：

- 角色图可执行，而不是停留在设计图层。
- 运行结果可审计、可回放、可恢复。
- 语义边界清楚，出现漂移时能 fail fast。
- 在不引入重型基础设施的前提下，尽量提高稳定性和可靠性。

## 2. 它擅长什么

- **图语义硬化**：`parallel_split`、`all_of/quorum_of` join、`context.map`、`loop.max` 都在解析和执行两侧被明确约束。
- **文件优先恢复**：运行状态落盘到 `.ogs/runs/<run-id>/`，以 `state.json`、`sessions.json`、`plan-fingerprint.json`、`checkpoints/` 和 `execution-outcome.json` 组成恢复权威集。
- **会话血缘隔离**：OpenCode 会话按 `roleId:sessionLineageId` 复用或隔离，顺序链路复用记忆，并行 sibling 不串话。
- **Crash 自愈补偿**：角色执行先提交 durable outcome，再由图调度层写 checkpoint；恢复时自动补齐缺失的 checkpoint，而不是重跑模型。
- **状态脱水与显式治理**：`state.json` 保持轻量摘要，完整审计走 `events.ndjson`；支持 `runtime.retention` 阈值触发的显式快照清理。
- **语义边界清晰**：动态 fan-out 的不确定 `N` 不进入图语义；受控并发属于执行策略；`ERROR*` 异常流已按节点级 opt-in 实现并由 feature flag 控制发布面。
- **最小但完整的工程闭环**：解析、调度、执行、审计、恢复与检查能力都收敛在同一套内核工程里。

## 3. 架构特点

OGSystem 当前采用单一 graph runtime 路径，核心模块分工很清晰：

- `src/runtime/adapter.ts`：组合根，负责装配配置、系统定义、角色包、模型包与运行上下文。
- `src/runtime/parse-mermaid.ts` 与 `src/runtime/execution-plan.ts`：把受限 Mermaid DSL 编译成可执行计划。
- `src/runtime/graph-runner.ts`：负责图级状态推进、branch/lineage 管理、checkpoint 与 resume 补偿。
- `src/runtime/role-executor.ts`：负责单节点 prompt 渲染、执行绑定、输出修复、schema 校验与审计落盘。
- `src/runtime/run-artifacts.ts`：负责 run 目录、会话索引、`.resume.lock`、checkpoint、execution artifacts 与 buffered append。

这套结构的核心特点是：

- **职责分离**：调度、执行、持久化分别收敛，不靠隐式共享逻辑。
- **实现可解释**：文档中的语义标签可以映射回明确的代码模块与产物文件。
- **运维可观察**：每次执行的关键信息都有对应落盘证据，不依赖黑盒状态。

## 4. 当前边界

OGSystem 目前是一个很强的单机文件型内核，但仍有明确边界：

- 重点解决的是单机正确性、恢复能力和操作安全，不是分布式调度。
- `.resume.lock` 只覆盖同机 `--resume-run` 竞争，不解决跨主机共享存储上的并发恢复。
- 指纹校验是严格模式。只要系统定义、角色内容、模型包或 law 变化，resume 就会拒绝继续。
- 长期运行的主要压力来自状态与产物增长，不是当前语义正确性本身。
- `ERROR*` 异常流语义已实现，默认由 `runtime.error_flows.v1=false` 灰度控制；未声明或未开启时保持 fail-stop 行为。

这意味着它适合：

- 本地或单机服务上的多角色编排实验与生产化前验证。
- 对恢复能力、审计能力、可解释性要求较高的运行场景。
- 希望以低复杂度方式获得“编排 + 恢复 + 证据链”的工程团队。

它暂时不适合：

- 需要跨机器抢占式调度的集群环境。
- 需要“宽松兼容恢复”或“热升级恢复”的运行模式。
- 以无限长期运行和海量历史产物为核心诉求的系统。

## 5. 从哪里开始读

建议按以下顺序理解项目：

1. `docs/README.md`：先看文档索引与归档规则，知道什么文档是活的。
2. `docs/usage-manual.md`：把项目能力、目录约定、运行命令和恢复契约整体过一遍。
3. `docs/ogsystem-orchestration-semantics-v1.md`：确认已实现语义的精确定义。
4. `docs/DECISIONS.md`：理解为什么做这些架构选择。
5. `docs/ogsystem-ebook.md`：系统阅读模块设计、原则、价值与演进方向。

如果你要直接上手运行，下一站应是 `docs/usage-manual.md`。如果你要评估设计是否合理，下一站应是 `docs/DECISIONS.md` 与 `docs/ogsystem-ebook.md`。
