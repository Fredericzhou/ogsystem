# ogsystem 编排语义架构参考手册 (v1.0)

## 一、 核心架构哲学：物理隔离与逻辑投影

`ogsystem` 的设计遵循 **“物理白纸，逻辑灵魂”** 的原则：
*   **物理层 (Physical Layer)**：通过 OpenCode Server 提供可隔离、可复用的“对话房间”（Sessions）。
*   **逻辑层 (Logic Layer)**：框架（Runtime）从全局状态中提取“脱水”后的关键信息，通过 **状态投影 (State Projection)** 注入到每个房间的提示词（Prompt）中。
*   **血缘识别 (Lineage)**：以 `branchId/lineageId/sessionLineageId` 共同描述执行血缘。会话复用键为 `roleId + sessionLineageId`，确保并行路径物理隔离，循环轮次按 `sessionLineageId` 策略进行隔离或复用。

---

## 二、 核心概念映射：Node vs. Branch (Git Fork 模型)

理解 `ogsystem` 运行时的关键在于区分“静态定义”与“动态实例”：

| 概念 | 类比 | 定义 | 作用 |
| :--- | :--- | :--- | :--- |
| **Role (角色)** | **Git Repository** | 静态资产（Prompt, Schema）。 | 定义“我是谁”以及“我怎么做”。 |
| **Node (节点)** | **代码中的函数调用** | Mermaid 图中的方框。 | 定义“我在图中的位置”以及“我的上下游”。 |
| **Branch (分支)** | **Git Fork / Branch** | 运行时的动态实例（核心标识为 `branchId`，并携带 `lineageId/sessionLineageId`）。 | 承载“分支级执行状态与会话血缘”。注：相同 role 的分支默认共享 `roleDir`，不提供分支级独立工作目录。 |

**Git Fork 类比**：
当一次转移会激活多个下游（典型是 `parallel_split`，也可能是同事件命中多个目标）或进入 join 节点时，系统会为目标分支切换到新的 `sessionLineageId`。它们拥有相同的初始状态（上游 Context），但随后的会话记忆物理隔离（注：此处主要指会话记忆层隔离，不代表文件系统隔离，相同 role 仍共用其私有工作目录）。

---

## 三、 编排语义清单：实现与逻辑层工作

| 编排语义 | 原理说明 | 逻辑层 (Role/Prompt) 的具体工作 |
| :--- | :--- | :--- |
| **`join.mode: all_of`** | **全量汇合**。等待 `join.sources` 声明的全部上游在同一 `lineageId + loopIteration` 下完成；当前实现要求 `join.sources.<roleId>` 中的 source role 唯一，且与 Mermaid 中该节点的全部入边角色严格一致，避免隐式漏等/多等。 | **1. 命名空间打包**：运行时将多方产物整理为以 `roleId` 为键的 JSON 对象注入 `{{input}}`，值中保留 `event/content/data`。 <br> **2. 汇合判定**：由运行时按 `join.sources`、当前 `lineageId` 与当前轮次判断是否可激活 join 节点。 |
| **`join.mode: quorum_of`** | **法定人数汇合**。等待 `join.sources` 中至少 `join.min.<roleId>` 个唯一上游在同一 `lineageId + loopIteration` 下完成；`join.sources.<roleId>` 本身也必须只声明唯一 source role，并与 Mermaid 中该节点的全部入边角色严格一致；达到阈值后 join 节点只激活一次，迟到 source 只记审计、不重触发。 | **1. 阈值判定**：运行时按唯一 source role 计数，而不是按到达次数计数。 <br> **2. 默认上下文**：未配置 `context.map` 时，仍按 `join.sources` 归一化注入 JSON 命名空间到 `input`。 |
| **`context.map.<roleId>.*`** | **字段级上下文投影**。运行时用稳定字段顺序构造新的 JSON `input`。 | **1. 普通节点来源**：`direct.*`、`global.task`、`global.user_profile.*`。 <br> **2. Join 节点来源**：`source(<roleId>).*(仅限 join.sources)` 与 `global.*`。 <br> **3. Fail-closed**：缺字段、缺 source、非法 selector 均直接失败。 |
| **默认事件路由（无 `role.mode`）** | **条件跳转**。由输出事件决定。 | **1. 选项锁定**：在 Prompt 注入 `allowed_events`。 <br> **2. 结构化约束**：在有出边且非并行模式下要求输出 `event`。 <br> **3. 命中规则**：运行时会激活所有 `eventType == 输出 event` 的出边；若 `PASS/REJECT` 指向同一目标，仍是单次二选一路由（由输出 event 决定命中哪一组边）。 <br> **4. `noop` 例外**：仅在 law 显式允许 `allowNoopWithoutExecutionBinding=true` 且该节点最多一个出边时，运行时可无模型执行直接走唯一出边。 |
| **`role.mode: parallel_split`** | **并行分发**。同时激活所有下游。 | **1. 任务分片**：在 Prompt 中明确当前分支的子任务目标。 <br> **2. 会话隔离**：运行时按 `sessionLineageId` 控制分支会话隔离；注意默认并非分支级独立工作目录，同一 role 仍共享其 `privateDir`。 |
| **`loop.max`** | **循环预算**。限制拓扑环路迭代。 | **1. 输入稳定性**：`task` 始终保持原始用户请求，轮次变化只通过新的 `input` 上下文体现。 <br> **2. 运行时守卫**：解析期要求每个拓扑环至少有一个角色声明 `loop.max.*`；执行期由 loop budget 拦截超限激活。 |

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
*   **`all_of` 与 `quorum_of` 的关系是“语义特例”，不是新增模式**：`quorum_of + join.min=1` 等价“any”；`quorum_of + join.min=|sources|` 等价“all”。当前 DSL 不单独引入 `any_of`：`all_of` 保留为高频默认汇合语义（更少配置、更易审查），`any` 通过 `quorum_of + join.min=1` 表达（避免新增关键字带来的解析/测试/兼容面扩张）。
*   **Join 上下文与字段投影都属于运行时契约**：默认 join `input` 是按 `roleId` 归一化后的 JSON 投影；若声明 `context.map.<roleId>.*`，运行时会以稳定字段顺序重建 `input`，并要求 selector 与 source 都合法。
*   **Flow contract 是独立的运行时合同层**：`handoff.mode` 只控制合同校验策略，`transition` 会跳过告警或缺失合同对应的 flow，`strict` 则硬失败；`handoff.contracts` 指向合同 bundle；`role_input` 只校验 `context.map` 投影后的结构化对象，不替代 runtime 内建的 prompt-input schema。
*   **Compiler facade 是静态摘要层**：`src/runtime/compiler.ts` 会收拢 system / role / contract / effective law 的稳定摘要，生成 `CompiledExecutionSnapshot` 与 compiler digest；运行时仍保留最后防线，不把 compiler 当作唯一真相源。
*   **合同路径按系统文件解析**：`handoff.contracts` 相对 `system.mmd` 所在目录解析，运行时会先归一到绝对路径，再参与加载与 resume 指纹。
*   **合同 schema 的 `$ref` 只允许本地文件引用**：相对引用按 schema 文件所在目录解析，支持嵌套本地引用与片段引用；远程 `http(s)://` 引用会直接失败。
*   **`context.map` selector 为白名单语法**：仅支持 `global.task`、`global.user_profile(.path)`、`direct.content/event/data(.path)`、`source(<roleId>).content/event/data(.path)`；join 节点禁止 `direct.*`，非 join 节点禁止 `source(...)`。
*   **`noop` 是受 law 约束的显式语义**：角色无 `model.bind/exec.bind` 时并不自动放行；只有 `allowNoopWithoutExecutionBinding=true` 且出边数不超过 1 才允许 `noop`，否则直接失败。
*   **隔离的是模型会话，不是分支文件系统**：并行 sibling branch 会拿到不同的 `sessionLineageId`，从而不会共享模型会话记忆；但相同 role 默认仍共用一个 role 私有目录。
*   **顺序链路会继承 `sessionLineageId`**：只有并行分叉、一次激活多个目标，或进入任意 join（`all_of` / `quorum_of`）时，运行时才会切换到新的会话血缘；普通单路顺序流转会沿用当前 branch 的 `sessionLineageId`。
*   **状态机扩展事件是单触发语义**：`quorum_of` 达阈值后 join 分支只激活一次；迟到 source 仅追加 `join_late_arrival_ignored` 事件，不重复激活 join。
*   **`loop.max` 是按“声明该 budget 的目标角色”独立计数**：进入该角色一次记一次；捷径若绕过该角色，不会增加该角色计数。若环上多个角色都声明了 `loop.max`，它们各自独立生效，任一超限都会触发失败。

---

## 八、 Mermaid DSL 硬约束（补充）

*   **Header 必须严格匹配**：首个非空行必须是 `flowchart TD` 或 `flowchart LR`。
*   **可执行行是封闭集合**：仅允许 `%% key=value` 元数据行与 `A -->|EVENT| B` 边定义；其他可执行语法直接失败。
*   **节点 token 是严格格式**：仅支持 `nodeId[Role:roleId]`；边界 token 仅支持 `input/output`，并拒绝 `start/end/done`。
*   **边界边语义固定**：只允许 `input -->|EVENT| Role` 与 `Role -->|EVENT| output`。
*   **入口语义需单值一致**：入口来自 `entry.role` 或唯一 `input` 边目标；两者冲突或存在多个 `input` 目标都会失败。
*   **元数据键是白名单**：仅支持 `engine/system.id/system.version/law.global/entry.role` 及 `talent.bind/model.bind/exec.bind/role.mode/join.mode/join.sources/join.min/context.map/loop.max/handoff.mode/handoff.contracts/route.order.*` 前缀；重复 key 与未知 key 都会失败。
*   **`engine` 仅保留兼容入口**：可省略；若声明则只能是 `langgraph`。
*   **保留角色名禁止复用**：`input/output/start/end/done` 不能作为 `roleId`。
*   **终止条件必须显式可达**：至少要有一个无下游 role 边的终止角色，或一条 `Role -->|EVENT| output` 边。
*   **绑定冲突会被拒绝**：同一 role 不允许同时声明 `model.bind.<roleId>` 与 `exec.bind.<roleId>`。

---

## 九、 生命周期与落盘契约（2026-04-12）

*   **运行根目录唯一化**：运行权威目录为 `.ogs/runs/<run-id>/`，不再使用旧 `ogsystem-history/` 路径。
*   **run-id 规则**：`YYYYMMDD-HHMMSS-<shortHash>`，保证可排序和低碰撞。
*   **配置快照**：每次 `run start` 写入 `resolved-config.json`，用于后续审计与复盘。
*   **OpenCode 运行元数据**：落盘到 `.opencode/server.pid` 和 `.opencode/endpoint.json`，按 run 隔离。
*   **日志双通道**：引擎日志 `logs/engine.ndjson`，角色日志 `logs/roles/<roleId>.ndjson`，同时保留 `events.ndjson` 作为完整事件流。
*   **停止状态机**：支持 `running -> stopping -> stopped`，并在 `control/stop-request.json`、`control/stop-outcome.json` 保留操作证据。

---

## 九、 异常流语义（ERROR*，V1 delivered，默认 flag off）

以下语义已落地实现；默认发布策略仍由 `runtime.error_flows.v1=false` 控制（未启用或未声明 `ERROR*` 边时保持 fail-stop）：

*   **语法沿用现有事件标签**：`ERROR` 与 `ERROR.<errorCode>`。
*   **节点级 opt-in**：仅声明了 `ERROR*` 出边的节点启用异常流。
*   **触发来源限定**：仅运行时失败路径触发（execution/validation/io/state 等），不是普通成功输出事件。
*   **触发时机边界**：执行器侧重试耗尽后，才进行 `ERROR*` 匹配与路由。
*   **匹配顺序**：先 `ERROR.<errorCode>`，后 `ERROR`，无匹配则保持 fail-stop。
*   **解析约束**：同一 `fromRole` 仅允许一个 `ERROR` 兜底边；同一 `ERROR.<code>` 仅允许一个目标；`input` 不允许声明 `ERROR*`。
*   **fail-closed 约束**：保留前缀事件必须是 `ERROR` 或 `ERROR.<errorCode>`；其他 `ERROR*` 形式在解析期拒绝。
*   **角色提示契约**：运行时注入给角色的 `allowed_events` 不包含 `ERROR*`（异常流仅由运行时失败路径触发）。

判定建议（异常流 vs 业务事件流）：

*   **业务事件流**：用于“成功执行后的业务分支”（如 APPROVED/REJECTED、ROUTE_A/ROUTE_B）。
*   **异常流**：用于“运行时失败后的补偿/降级分支”（execution/validation/io/state）。
*   **边界约束**：不要把预期业务否定路径建模为 `ERROR*`。

交付记录见：`docs/archive/delivery/error-flow-v1-execution-plan-2026-04-13.md`；术语对齐收口见：`docs/archive/delivery/ogsystem-flow-edge-alignment-execution-plan-2026-04-15.md`。
