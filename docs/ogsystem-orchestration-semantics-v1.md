# ogsystem 编排语义架构参考手册 (v1.0)

## 一、 核心架构哲学：物理隔离与逻辑投影

`ogsystem` 的设计遵循 **“物理白纸，逻辑灵魂”** 的原则：
*   **物理层 (Physical Layer)**：通过 OpenCode Server 提供绝对干净、无差别的“对话房间”（Sessions）。
*   **逻辑层 (Logic Layer)**：框架（Runtime）从全局状态中提取“脱水”后的关键信息，通过 **状态投影 (State Projection)** 注入到每个房间的提示词（Prompt）中。
*   **血缘识别 (Lineage)**：以 `branchId/lineageId/sessionLineageId` 共同描述执行血缘。会话复用键为 `roleId + sessionLineageId`，确保并行路径物理隔离，循环轮次按 `sessionLineageId` 策略进行隔离或复用。

---

## 二、 核心概念映射：Node vs. Branch (Git Fork 模型)

理解 `ogsystem` 运行时的关键在于区分“静态定义”与“动态实例”：

| 概念 | 类比 | 定义 | 作用 |
| :--- | :--- | :--- | :--- |
| **Role (角色)** | **Git Repository** | 静态资产（Prompt, Schema）。 | 定义“我是谁”以及“我怎么做”。 |
| **Node (节点)** | **代码中的函数调用** | Mermaid 图中的方框。 | 定义“我在图中的位置”以及“我的上下游”。 |
| **Branch (分支)** | **Git Fork / Branch** | 运行时的动态实例（`branchId` + `sessionLineageId`）。 | 承载“分支级执行状态与会话血缘”。注：相同 role 的分支默认共享 `roleDir`，不提供分支级独立工作目录。 |

**Git Fork 类比**：
当图发生并行（Parallel Split）时，系统为每个下游 Node 执行了一次 `git checkout -b <sessionLineageId>`。它们拥有相同的初始状态（上游 Context），但随后的会话记忆物理隔离（注：此处主要指会话记忆层隔离，不代表文件系统隔离，相同 role 仍共用其私有工作目录）。

---

## 三、 编排语义清单：实现与逻辑层工作

| 编排语义 | 原理说明 | 逻辑层 (Role/Prompt) 的具体工作 |
| :--- | :--- | :--- |
| **`join.mode: all_of`** | **全量汇合**。等待 `join.sources` 声明的全部上游在同一 `lineageId + loopIteration` 下完成；当前实现要求 `join.sources.<roleId>` 中的 source role 唯一，且与 Mermaid 中该节点的全部入边角色严格一致，避免隐式漏等/多等。 | **1. 命名空间打包**：运行时将多方产物整理为以 `roleId` 为键的 JSON 对象注入 `{{context}}`，值中保留 `event/content/data`。 <br> **2. 汇合判定**：由运行时按 `join.sources`、当前 `lineageId` 与当前轮次判断是否可激活 join 节点。 |
| **`join.mode: quorum_of`** | **法定人数汇合**。等待 `join.sources` 中至少 `join.min.<roleId>` 个唯一上游在同一 `lineageId + loopIteration` 下完成；`join.sources.<roleId>` 本身也必须只声明唯一 source role，并与 Mermaid 中该节点的全部入边角色严格一致；达到阈值后 join 节点只激活一次，迟到 source 只记审计、不重触发。 | **1. 阈值判定**：运行时按唯一 source role 计数，而不是按到达次数计数。 <br> **2. 默认上下文**：未配置 `context.map` 时，仍按 `join.sources` 归一化注入 JSON 命名空间。 |
| **`context.map.<roleId>.*`** | **字段级上下文投影**。运行时用稳定字段顺序构造新的 JSON `context`，并让 `last_output` 继续镜像该投影。 | **1. 普通节点来源**：`direct.*`、`global.task`、`global.user_profile.*`。 <br> **2. Join 节点来源**：`source(<roleId>).*(仅限 join.sources)` 与 `global.*`。 <br> **3. Fail-closed**：缺字段、缺 source、非法 selector 均直接失败。 |
| **默认事件路由（无 `role.mode`）** | **条件跳转**。由输出事件决定。 | **1. 选项锁定**：在 Prompt 注入 `allowed_events`。 <br> **2. 结构化约束**：在有出边且非并行模式下要求输出 `event`。 |
| **`role.mode: parallel_split`** | **并行分发**。同时激活所有下游。 | **1. 任务分片**：在 Prompt 中明确当前分支的子任务目标。 <br> **2. 会话隔离**：运行时按 `sessionLineageId` 控制分支会话隔离；注意默认并非分支级独立工作目录，同一 role 仍共享其 `privateDir`。 |
| **`loop.max`** | **循环预算**。限制拓扑环路迭代。 | **1. 轮次感知**：注入 `round` 变量。 <br> **2. 运行时守卫**：环路在解析期要求存在 `loop.max.*`，执行期由 loop budget 进行拦截。 |

---

## 四、 自然语言映射 (NL2MMD 指南)

为了让 `nl2mmd` 工具准确生成上述语义，建议在自然语言描述中使用以下模式：

*   **并行意图**：“**同时**分发给开发和测试”、“**并行**开始多方审查”。
*   **汇合意图**：“**等** A 和 B **都**完成后”、“由裁判对各方意见进行**汇总/裁决**”。
*   **判断意图**：“**根据**代码质量**决定**下一步”、“如果**通过**则发布，否则**打回**”。
*   **循环意图**：“**循环**迭代直到成功”、“最多**尝试 5 次**”。

---

## 五、 架构红线：重图 (Smart Graph) vs. 重节点 (Heavy Node)

### 核心论点：为什么“不确定性”应放入节点内部？
对于**不确定数量、不可解释的动态迭代（如对一个列表进行 Map 处理）**，应由 **OpenCode 内部（Heavy Node）** 处理。

1.  **为什么选择 Heavy Node？**
    *   **拓扑清洁度**：避免 Mermaid 图中出现数百个动态生成的虚假节点，保持业务主线清晰。
    *   **原子性**：将复杂子任务视为一个原子操作，内部纠错由模型自主完成。
    *   **性能**：内部 Python/JS 循环开销远低于框架级的“任务拆分-分发-汇总”。

2.  **什么时候选择 Smart Graph (框架层处理)？**
    *   **跨专业协作**：任务需要由**不同专业领域**的角色（如：视觉、文案、代码）协作。
    *   **人工介入**：并行的每一项都需要**人类审批**或外部信号触发。
    *   **极限性能**：需要利用云端并发配额实现物理级并行加速（将 `N*T` 降为 `T`）。

> 语义边界补充：动态 fan-out 的不确定 `N` 不进入图语义；它属于节点内部能力（Heavy Node）或预展开阶段。  
> 受控并发（例如 fan-out 最大并发数）属于执行策略，不改变 Flow 可达性与 join 就绪语义。

---

## 六、 职责边界：框架 vs. 逻辑

### 1. 框架层 (Framework) 职责
*   **情报参谋**：负责数据的物理搬运与“脱水”提取（State Projection）。
*   **安全守门员**：负责 Session 的物理隔离（基于 `sessionLineageId`）和资源控制。
*   **审计员**：记录执行指纹，确保 Crash 后可基于 Checkpoint 进行自愈。

### 2. 逻辑层 (Logic/Role) 职责
*   **主控方**：通过 Prompt 模板决定如何“消费”框架准备好的干净 Context。
*   **格式官**：通过严格遵守 Output Schema，将业务决策转化为框架识别的信号（Event）。
*   **自治者**：利用内部计算能力消化“局部不确定性”，只向框架提交最终的权威产物。

---

## 七、 当前实现契约（v1 Runtime）

为避免将抽象语义理解成未落地能力，当前实现还有以下收敛约束：

*   **Join 配置是显式且严格的**：`join.sources.<roleId>` 必须只包含唯一 source role，且对 `all_of` 与 `quorum_of` 都必须与 Mermaid 中该节点的全部入边角色完全一致；`join.mode.<roleId>=quorum_of` 时，`join.min.<roleId>` 是必填项，且阈值按同一 `lineageId + loopIteration` 下的唯一 source role 计数。
*   **Join 上下文与字段投影都属于运行时契约**：默认 join `context` 是按 `roleId` 归一化后的 JSON 投影；若声明 `context.map.<roleId>.*`，运行时会以稳定字段顺序重建 `context`，并要求 selector 与 source 都合法。
*   **隔离的是模型会话，不是分支文件系统**：并行 sibling branch 会拿到不同的 `sessionLineageId`，从而不会共享模型会话记忆；但相同 role 默认仍共用一个 role 私有目录。
*   **顺序链路会继承 `sessionLineageId`**：只有并行分叉、一次激活多个目标，或进入任意 join（`all_of` / `quorum_of`）时，运行时才会切换到新的会话血缘；普通单路顺序流转会沿用当前 branch 的 `sessionLineageId`。

---

## 八、 生命周期与落盘契约（2026-04-12）

*   **运行根目录唯一化**：运行权威目录为 `.ogs/runs/<run-id>/`，不再使用旧 `ogsystem-history/` 路径。
*   **run-id 规则**：`YYYYMMDD-HHMMSS-<shortHash>`，保证可排序和低碰撞。
*   **配置快照**：每次 `run start` 写入 `resolved-config.json`，用于后续审计与复盘。
*   **OpenCode 运行元数据**：落盘到 `.opencode/server.pid` 和 `.opencode/endpoint.json`，按 run 隔离。
*   **日志双通道**：引擎日志 `logs/engine.ndjson`，角色日志 `logs/roles/<roleId>.ndjson`，同时保留 `events.ndjson` 作为完整事件流。
*   **停止状态机**：支持 `running -> stopping -> stopped`，并在 `control/stop-request.json`、`control/stop-outcome.json` 保留操作证据。

---

## 九、 异常边语义（ERROR*，V1 delivered，默认 flag off）

以下语义已落地实现；默认发布策略仍由 `runtime.error_edges.v1=false` 控制（未启用或未声明 `ERROR*` 边时保持 fail-stop）：

*   **语法沿用现有事件标签**：`ERROR` 与 `ERROR.<errorCode>`。
*   **节点级 opt-in**：仅声明了 `ERROR*` 出边的节点启用异常流。
*   **触发来源限定**：仅运行时失败路径触发（execution/validation/io/state 等），不是普通成功输出事件。
*   **匹配顺序**：先 `ERROR.<errorCode>`，后 `ERROR`，无匹配则保持 fail-stop。
*   **解析约束**：同一 `fromRole` 仅允许一个 `ERROR` 兜底边；同一 `ERROR.<code>` 仅允许一个目标；`input` 不允许声明 `ERROR*`。

执行计划见：`docs/archive/delivery/error-edge-v1-execution-plan-2026-04-13.md`。
