# OGSystem 工程电子书

本书面向工程读者，系统介绍 OGSystem 的模块划分、设计原理、能力特点、价值边界与后续演进方向。它不是 API 速查表，而是一份帮助你真正理解这个内核为什么这样设计、当前已经做到什么、下一步应该往哪里继续收敛的说明书。

## 1. 项目要解决什么问题

很多多智能体系统在设计图层看起来很完整，但一旦进入工程现实，就会遇到几个难题：

- 编排图和实际执行逻辑脱节。
- 一次崩溃后，无法知道哪些节点已经真正执行过。
- 并行分支会互相污染上下文，导致 LLM 串话。
- 运行状态藏在内存里，排查问题只能靠猜。

OGSystem 的回答很直接：把图语义、运行状态、恢复依据和操作证据都落到一套单机文件型运行时中，让多角色流程既能执行，也能被理解、被验证、被恢复。

## 2. 核心设计哲学

### 2.1 文件优先，而不是平台优先

OGSystem 把一次运行当成一组可审计文件，而不是一段只存在于进程内存里的黑盒过程。默认运行目录是 `.ogs/runs/<run-id>/`，其中保存：

- 用户请求与系统定义副本
- `state.json` 与 `sessions.json`
- `plan-fingerprint.json`
- `checkpoints/`
- `events.ndjson`
- `roles/<roleId>/executions/<executionId>/...`

这样做的价值是：

- 恢复有明确依据。
- 审计有完整证据。
- 调试时可以直接查看文件，而不是依赖专用后台。

### 2.2 最小内核，而不是全能平台

OGSystem 故意不追求“大而全”。它把目标限定为：

- 执行受限 Mermaid DSL。
- 驱动多角色节点。
- 绑定模型或本地 profile/tool 执行路径。
- 生成可恢复、可审计的运行产物。

这让系统可以在较低复杂度下，把正确性和可靠性做得足够扎实。

### 2.3 先守住正确性，再谈扩展性

OGSystem 近期的重点始终是：

- 指纹一致性
- 会话隔离
- 崩溃后不重复执行
- 单机恢复可靠

而不是过早进入分布式协调、宽容恢复、复杂版本迁移等更重的议题。

## 3. 整体架构图

可以把 OGSystem 理解为六层：

1. **输入层**：CLI、`system.mmd`、`.ogs/runtime.json`、laws、user profile。
2. **解析层**：把 Mermaid DSL 解析并验证成 `SystemDefinition`。
3. **计划层**：把 `SystemDefinition` 进一步归一化为 `ExecutionPlan`。
4. **执行层**：graph runner 调度 role executor，role executor 调用具体 executor。
5. **状态层**：graph state、sessions、checkpoints、execution outcomes。
6. **证据层**：audit、events、role snapshots、metrics、summary。

这几层清楚分开，避免了“解析逻辑、调度逻辑、持久化逻辑混在一起”的常见失控局面。

## 4. 主要模块逐一说明

### 4.1 `src/runtime/cli.ts`

CLI 是薄入口。它只负责接收命令行参数并调用 adapter，而不承担业务编排逻辑。

价值：

- 输入面简单。
- 运行方式稳定。
- 以后扩展命令时不容易污染内核。

### 4.2 `src/runtime/adapter.ts`

Adapter 是整个运行时的组合根。

它负责：

- 读取 runtime config、laws、user profile。
- 加载角色包和模型包。
- 从 `system.mmd` 构建 `SystemDefinition` 与 `ExecutionPlan`。
- 计算 `plan-fingerprint.json` 所需的运行计划指纹。
- 初始化 `RunContext`。
- 在 resume 时校验指纹和状态，再把执行交给 graph runner。

为什么 adapter 重要：

- 它把“系统定义阶段”和“执行阶段”分开了。
- 所有运行前校验集中在这里，避免执行过程中才暴露基础配置错误。
- 它让 graph runner 不需要关心配置发现和仓库加载细节。

### 4.3 `src/runtime/parse-mermaid.ts`

这一层不是在“画图”，而是在“编译图”。

它负责：

- 解析受限 `flowchart TD/LR`。
- 识别 metadata、角色节点、边和事件。
- 校验 `entry.role`、边界、保留字、绑定、join sources、loop budget。
- 检测没有 `loop.max` 的循环。

为什么要做成受限 DSL：

- DSL 越受限，语义越清晰。
- 可以在解析期完成更多 fail-fast 校验。
- 让 Mermaid 图保持“可读”和“可执行”两种属性的一致。

### 4.4 `src/runtime/execution-plan.ts`

Execution Plan 是运行时真正消费的计划对象。

它的价值不在于“多一层抽象”，而在于：

- 让 graph runner 不再直接解析 Mermaid 细节。
- 把 node、binding、routing、join、loop 信息归一化。
- 为运行时调度、测试和文档语义建立统一接口。

简单说，`system.mmd` 是输入语言，`ExecutionPlan` 是执行语言。

### 4.5 `src/runtime/graph-runtime-state.ts`

这个模块定义并维护图运行时真正关心的状态结构，例如：

- `branchRecords`
- `roleResults`
- `loopIterations`
- `selectedEventByBranchId`
- `branchId / lineageId / sessionLineageId`

这里体现了 OGSystem 一个很关键的设计：把“分支实例”“分支家族”“会话血缘”拆成不同概念，而不是混在一个 ID 里。

价值：

- join readiness 可以按 lineage 判断。
- session reuse 可以按 session lineage 判断。
- 并行与循环都能获得更可解释的状态语义。

### 4.6 `src/runtime/graph-mode-registry.ts`

这是 DSL 扩展点。

它负责：

- 注册 routing mode handler
- 注册 join mode handler
- 选择下游目标
- 判断 join 是否 ready

当前实现很小，只支持：

- `parallel_split`
- `all_of`
- `quorum_of`

但这个小 registry 很重要，因为它把“语义扩展机制”从 graph runner 主流程中抽离出来了。

### 4.7 `src/runtime/graph-runner.ts`

Graph runner 是内核中的内核。它负责图级调度，但不直接执行模型。

核心职责：

- 维护 graph state。
- 找出当前可执行的 role。
- 逐 branch 调用 `executeRoleNode`。
- 根据结果构造 graph update。
- 写 checkpoint。
- 在 resume 时重放 checkpoint，并补偿未对账的 durable outcomes。

为什么它是系统中心：

- 它掌握“状态如何推进”。
- 它决定何时结束、何时失败、何时等待 join。
- 它把 role executor 的结果翻译成图级状态转移。

### 4.8 `src/runtime/role-executor.ts`

Role executor 只关心单节点执行。

它负责：

- 构造 prompt 输入投影
- 渲染 prompt
- 选择 model binding 或 profile binding
- 调用 executor
- 修复有限范围内的输出问题
- 校验 output schema
- 生成 audit
- 写 role result 与 `execution-outcome.json`

这里有一个非常关键的设计：

- 节点执行完成后，先写 durable outcome。
- 之后由 graph runner 写 checkpoint 并完成对账。

这个顺序避免了“模型已经调用成功，但崩溃发生在状态推进之前”时的重复执行。

### 4.9 `src/runtime/executor.ts`、`src/runtime/opencode-executor.ts`、`src/runtime/tool-runner.ts`

这组模块负责“怎么执行”，而不是“为什么执行”。

- `executor.ts` 定义统一执行器接口。
- `opencode-executor.ts` 负责 OpenCode 路径。
- `tool-runner.ts` 负责 profile/tool 调用。

它们的设计价值是：

- 把编排语义和模型调用细节隔开。
- 让 role executor 只面对统一合同。
- 保留统一执行接口，但不再引入第二套调度引擎。

### 4.10 `src/runtime/run-artifacts.ts`

如果说 graph runner 是“运行时大脑”，那么 run artifacts 就是“运行时账本”。

它负责：

- 创建 run 目录和 role 目录
- 管理 `.resume.lock`
- 分配 executionId
- 持久化 session 快照
- 写 checkpoint
- 写 `execution-outcome.json`
- 加载 resume 所需的状态与对账信息
- 处理 buffered append 和恢复

这里集中体现了 OGSystem 的文件优先哲学。

### 4.11 `src/runtime/audit-recorder.ts`、`src/runtime/run-summary.ts`、`src/runtime/stage-projector.ts`

这些模块负责把运行结果整理成人可以消费的形式。

- `audit-recorder.ts`：生成和追加审计记录。
- `run-summary.ts`：聚合成功/失败/noop/错误码统计。
- `stage-projector.ts`：生成面向操作视角的阶段投影。

它们让系统不只是“能跑”，而是“能解释自己跑了什么”。

### 4.12 `src/runtime/doctor.ts` 与 `src/runtime/lint.ts`

这两个模块属于运行前护栏：

- `doctor.ts` 做环境、工具和 run 目录检查。
- `lint.ts` 走同一套 Mermaid 解析/校验路径，尽量在执行前发现图定义问题。

价值：

- 把问题尽早暴露。
- 降低把坏状态带入执行阶段的概率。

## 5. 关键运行语义

### 5.1 Branch、Lineage、Session Lineage

这三个概念是理解系统的关键：

- `branchId`：某一次具体分支实例。
- `lineageId`：同一家族分支的关联标识，主要用于 join 和结果查找。
- `sessionLineageId`：模型会话复用/隔离标识。

它们拆开后，系统就能同时做到：

- join 时看的是同一 lineage 的结果。
- 并行 sibling 可以拿到独立的会话上下文。
- 顺序链路又能继续复用已有会话。

需要特别注意：

- 会话隔离针对的是模型上下文，不是分支级文件系统隔离。
- 相同 role 的 sibling branch 默认仍共享同一个 role 目录与 `private/` 工作区。

### 5.2 Join 语义

`all_of/quorum_of` join 都不是“来一个就跑”，而是：

- 必须等 `join.sources.<roleId>` 指定的所有上游都在同一 lineage 下产出结果。
- `quorum_of` 还要求满足 `join.min.<roleId>` 的唯一 source role 阈值，并且达到阈值后只激活一次。
- 上游结果会被投影为一个按 roleId 键控的 JSON 字符串注入 `{{context}}`。

这保证了 join 节点看到的是结构化上游结果，而不是隐式共享的内部状态。

### 5.3 Loop 语义

OGSystem 不允许无预算循环。

策略包括：

- 解析期检测环。
- 要求至少一个环上角色声明 `loop.max.<roleId>=N`。
- 运行时对目标角色做 loop budget 检查。

这样可以把无限调用模型的风险压到最低。

### 5.4 Resume 语义

Resume 不是简单“接着跑”，而是先完成一套完整校验：

- 指纹是否一致
- `state.json` 是否可读
- `sessions.json` 是否可读且与状态一致
- checkpoint 是否可重放
- 是否存在未对账的 `execution-outcome.json`

只有这些都通过，系统才会继续推进。

### 5.5 异常控制流边界（V1 delivered，默认 flag off）

`ERROR*` 异常流语义已实现，发布默认仍通过 `runtime.error_flows.v1=false` 灰度控制；边界如下：

- `ERROR` 与 `ERROR.<errorCode>` 复用现有事件标签，不新增 DSL。
- 仅声明了 `ERROR*` 出边的节点启用异常流（节点级 opt-in）。
- 仅运行时失败可触发 `ERROR*`，普通成功输出不会触发。
- 匹配顺序为 `ERROR.<errorCode> -> ERROR`；无匹配保持 fail-stop。
- 动态 fan-out 的不确定 `N` 不进入图语义；受控并发属于执行策略。

## 6. 为什么当前方案可靠

### 6.1 内容指纹

OGSystem 的指纹不只是系统 ID，而是对实际加载内容做哈希，包括：

- 系统定义
- 角色包 manifest、prompt、schema、persona/work
- 模型包 manifest
- 生效后的 law 约束

这保证了 resume 绑定的是“同一份执行合同”，而不是“名字相同的一套新内容”。

### 6.2 Durable Outcome + Checkpoint 补偿

这是当前内核最关键的可靠性设计之一。

顺序是：

1. role executor 执行完成。
2. 先持久化 `execution-outcome.json`。
3. graph runner 再写 checkpoint。
4. 如果 2 和 3 之间进程崩溃，resume 会扫描 outcome 并补写缺失 checkpoint。

这样能避免重复调用模型，也让崩溃窗口变得可恢复。

### 6.3 Advisory Resume Lock

`.resume.lock` 的作用不是做复杂分布式协调，而是守住一个明确原则：

- 同一个 `runDir` 在同一时刻只能由一个本机进程进行 resume。

这足以拦截最现实的误操作风险：两个终端同时对同一个 run 目录执行 `ogs run resume <run-id>`。

### 6.4 缓冲刷盘保护

`events.ndjson`、Markdown 审计等追加型产物并不是每次立即硬刷，而是通过 buffered append 统一 flush，并带有恢复机制。

这样做的价值是：

- 降低写放大。
- 保持追加产物的性能。
- 在 flush 失败时仍保留恢复机会。

## 7. 运行目录是如何组织的

一次运行通常会落到 `.ogs/runs/<run-id>/`，其中关键结构包括：

- `run.md`
- `request.md`
- `system.mmd`
- `state.json`
- `metrics.json`
- `sessions.json`
- `plan-fingerprint.json`
- `checkpoints/`
- `events.ndjson`
- `audit/`
- `roles/<roleId>/`

每个 role 目录下又有两层信息：

- 最新快照：`role.md`、`execution.json`、`latest-session.json`、`prompt.md`、`result.json`、`audit.json`
- 历史快照：`executions/<executionId>/...`

这种布局的价值是：

- 最新视图便于操作与排查。
- 历史视图便于回放与审计。
- 运行权威集和人类友好投影可以并存。

在最新实现中，`state.json.graphState` 已做状态脱水：

- 仅保留 `recentAudits`（固定窗口）用于近场排障。
- 使用 `auditSummary` 与 `roleMetricsByRoleId` 保留累计统计。
- 全量审计历史继续以 `events.ndjson` 作为观测面来源。

## 8. 这个项目真正的特点与价值

### 8.1 它把“可运行”和“可解释”同时保住了

很多系统在可运行后就不再可解释。OGSystem 刻意把运行语义与证据链一起设计，所以：

- 图可以执行。
- 执行可以审计。
- 审计可以反查到代码与文件。

### 8.2 它在低复杂度下建立了恢复闭环

OGSystem 没有引入数据库事务、消息队列或复杂分布式组件，但通过：

- 指纹
- checkpoint
- durable outcome
- session snapshot
- advisory lock

组合出了一个可靠的单机恢复闭环。这是它最有工程价值的地方之一。

### 8.3 它把边界说清楚了

这个项目没有假装自己已经是云原生调度平台。它明确承认：

- 现在的强项是单机。
- 现在的瓶颈是 I/O 与状态增长。
- 现在不做宽容 resume，也不做跨主机锁。

这种边界清晰，本身就是成熟工程设计的一部分。

## 9. 当前风险与下一步

这轮版本已经完成三项关键稳定化：

1. 状态脱水（`recentAudits + auditSummary + roleMetricsByRoleId`）。
2. 指标增强（`rssBytes/stateWriteMs/executionDirCount`）。
3. 显式阈值清理（`runtime.retention`，默认关闭）。

因此下一步重点不再是“补功能”，而是“把运维策略跑实”：

- 结合真实运行样本校准 retention 阈值。
- 用 replay benchmark 持续追踪 WAL 重放耗时。
- 把容量与清理策略固化到运维手册与回归流程。

继续延后事项保持不变：

- 语义兼容型 resume。
- 跨主机分布式锁 provider。
- 共享存储多实例协调机制。

## 10. 如何阅读源码

建议按下面顺序阅读：

1. `src/runtime/adapter.ts`
2. `src/runtime/parse-mermaid.ts`
3. `src/runtime/execution-plan.ts`
4. `src/runtime/graph-runtime-state.ts`
5. `src/runtime/graph-mode-registry.ts`
6. `src/runtime/graph-runner.ts`
7. `src/runtime/role-executor.ts`
8. `src/runtime/run-artifacts.ts`
9. `src/runtime/doctor.ts`

这样的顺序符合“从输入到执行、从语义到状态、从主流程到账本”的理解方式。

## 11. 结语

OGSystem 的价值不在于它声称自己能调度一切，而在于它已经把一个多角色编排内核最难讲清楚、最难稳定下来的几件事做成了：

- 语义明确
- 会话可控
- 恢复可靠
- 证据完整
- 复杂度可控

如果你要在单机环境下构建一个可恢复、可审计、可解释的多角色编排系统，OGSystem 已经提供了一个非常有参考价值的内核样本。
