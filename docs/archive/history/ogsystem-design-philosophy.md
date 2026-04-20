# ogsystem 设计哲学：当前实现的定位与取舍

**Date:** 2026-04-12  
**Status:** active  
**Scope:** 本文只描述当前仓库已经落地的能力与取舍。

---

## 1. 问题定义

在长耗时、可审计、需要明确职责边界的 AI 流程里，真正困难的通常不是“生成一段文本”，而是以下三件事：

*   **流程是否可控**：系统下一步去哪里，不应依赖模型临场猜测。
*   **上下文是否收敛**：一个节点不应默认看到全部历史和全部状态。
*   **失败后是否可恢复**：运行中断后，系统应能基于持久化证据继续，而不是整条链路重跑。

`ogsystem` 当前的定位，是一个 **代码优先的图执行运行时**，而不是自由对话式的多智能体聊天层。

---

## 2. 当前已落地的核心原则

### 2.1 图优先于 Agent 自治

`ogsystem` 的控制流首先由 Mermaid 图和受限 metadata 决定，而不是由模型自行改写流程。

当前已经落地的事实：

*   运行时只接受受限的 Mermaid 子集。
*   已支持的图语义是 `role.mode.*=parallel_split`、`join.mode.*=all_of|quorum_of`、`join.sources.*`、`join.min.*`、`context.map.*`、`loop.max.*`。
*   未知 metadata 会在解析期直接拒绝，而不是静默忽略。
*   有出边的普通角色必须输出匹配边标签的 `event`，否则执行失败。

这意味着系统更接近“制度化流程执行”，而不是“让多个 Agent 自由协商下一步”。

### 2.2 局部上下文优先于全量注入

`ogsystem` 当前已经实现局部数据投影，但这是 **固定投影契约**，不是通用授权 DSL。

当前已经落地的事实：

*   顺序节点默认只拿直接上游分支的 `content`；声明 `context.map.<roleId>.*` 时，会改为字段级只读投影。
*   join 节点在未声明 `context.map` 时，拿到的是按 `join.sources` 归一化后的 JSON 对象，字段仅包含 `event`、`content`、可选 `data`。
*   运行时不会把完整 `graphState` 直接注入角色 Prompt。
*   当前 Prompt 投影字段是固定的：`task`、`context`、`allowed_events`、`last_output`、`round`、`user_profile`。

这带来的直接效果是上下文更收敛，但代价是角色无法直接读取任意祖先节点、任意内部状态或任意统计指标。

### 2.3 恢复与审计优先于一次性跑通

`ogsystem` 当前最强的能力不是“更聪明”，而是“更容易恢复和复盘”。

当前已经落地的事实：

*   运行目录下会持久化 `state.json`、`sessions.json`、`checkpoints/`、`events.ndjson`。
*   每次角色执行都会写出 durable `execution-outcome.json`。
*   Resume 会先校验 `graphState` 和 plan fingerprint，再回放 checkpoint，并补偿 crash window。
*   在“角色结果已经 durable 落盘，但 checkpoint 尚未写出”的窗口内，恢复后可以避免重复执行该角色。
*   审计记录会保存角色、分支、轮次、lawRef、selectedEvent、nextRoleId、duration、session/message 标识和错误摘要。

这里的收益是恢复边界清晰、审计证据完整；代价是运行目录契约更重、I/O 更多、实现复杂度更高。

### 2.4 隔离基于会话血缘，不是完整沙箱

`ogsystem` 当前有隔离，但隔离层级需要说清楚。

当前已经落地的事实：

*   sibling branch 通过 `sessionLineageId` 获得独立模型会话，不共享会话记忆。
*   同一 run 只有一个共享 `shared/` 目录。
*   每个 role 有自己的 `private/` 目录。
*   同一 role 的不同 branch 默认仍共享同一个 role 目录和 private workspace。

因此，当前最硬的隔离是 **模型会话隔离**，不是 **分支级文件系统隔离**。

---

## 3. 当前边界

以下能力 **当前没有实现**，不应在设计哲学中被写成已具备能力：

*   没有 `%% @ogs-input`、`%% @ogs-trigger`、`%% @ogs-catch` 这类 DSL 语义。
*   没有属性级、节点级、跨祖先的显式数据授权机制。
*   没有把 `input / role / result / metrics` 统一投影成一个通用“四要素对象”供节点自由读取。
*   `Law` 当前只实现了 `forbiddenToolRefs`、`maxTransitions`、`allowNoopWithoutExecutionBinding` 三类约束。
*   没有专门的人审、批准、人工接管语义。
*   没有跨主机分布式运行时。

---

## 4. 优劣比较

### 4.1 与 LangGraph / AutoGen / CrewAI 这类通用多智能体框架相比

| 维度 | `ogsystem` 当前优势 | `ogsystem` 当前代价 |
| :--- | :--- | :--- |
| **控制流** | 图语义更窄、约束更硬，流程边界更清晰。 | 灵活性更低，新增语义通常要改 parser/runtime。 |
| **上下文策略** | 默认局部投影，Prompt 噪声更可控。 | 不能方便读取远端祖先或任意状态。 |
| **恢复能力** | run 目录、checkpoint、outcome reconciliation 是内建契约。 | 持久化目录更复杂，理解门槛更高。 |
| **审计能力** | 每次执行都有明确落盘证据，复盘路径稳定。 | 实现成本和 I/O 成本更高。 |
| **Agent 自主性** | 模型不负责偷偷改路由，系统行为更可预期。 | 不适合强调自由协商、开放探索、自主临场决策的场景。 |

简化地说，`ogsystem` 当前选择的是 **治理性优先**，而不是 **自治性优先**。

### 4.2 与 Dify / Coze / n8n 这类工作流平台相比

| 维度 | `ogsystem` 当前优势 | `ogsystem` 当前代价 |
| :--- | :--- | :--- |
| **开发方式** | Graph as Code，适合版本管理、评审和测试。 | 没有可视化搭建体验，对开发者更友好、对非开发者更陡峭。 |
| **运行形态** | 运行时较轻，可嵌入本地或 CI。 | 没有完整平台化后台、运营界面和开箱即用管理台。 |
| **长流程稳定性** | 对 resume、checkpoint、crash recovery 更重视。 | 需要用户理解 run 目录、恢复契约和工件布局。 |
| **工程边界** | 角色、模型、图、工件边界清晰。 | 内建连接器、平台集成、低代码体验不占优势。 |

简化地说，`ogsystem` 当前更像 **面向工程化执行的运行内核**，而不是 **面向业务搭建的全栈平台**。

---

## 5. 总结

`ogsystem` 当前不是一个“尽量什么都支持”的 Agent 框架。

它的实际取舍很明确：

*   用更窄的图语义，换取更强的确定性。
*   用局部上下文投影，换取更低的 Prompt 噪声。
*   用更重的持久化契约，换取更强的恢复与审计能力。

如果场景重点是 **流程治理、恢复、复盘、版本管理**，这些取舍是优势。  
如果场景重点是 **低门槛搭建、自由协商、平台化集成、快速试错**，这些取舍也会成为限制。
