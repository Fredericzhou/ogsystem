# ogsystem 编排语义架构参考手册 (v1.0)

> 术语基准：`Role` 是抽象责任角色，`Responsibility Seat` 是静态图位置，`Role Package` 是版本化实现
> 资产。角色可递归负责嵌套 System，但当前 `SubgraphSpec` 尚未形成可执行的 owner 组合合同；不要将角色
> 解释为具体人员、组织成员或运行实例。详见 [OGS Core Concepts](ogsystem-core-concepts.md)。

本规范采用角色优先图契约：节点是责任角色/Agent 席位，`Flow` 是源角色完成职责后向目标角色进行的直接
handoff。事件、动作、业务任务/任务步骤、网关、处理步骤、分支、运行实例和运行状态属于合同、边标签或运行投影，不能
被建模为 `Role` 节点。

中英文对照参考：[OGS Extended State Machine And Social Collaboration](../development/extended-state-machine-and-dag-bilingual.md)。

OGSystem 的运行模型是事件驱动的持久化扩展状态机工作流：Run 保存当前业务状态和执行前沿，Role 产生事件与结构化
结果，Runtime 应用状态更新并按事件选择 Flow，随后激活下一个 Role、分支、Join、Loop 或结束节点。LangGraph 只是当前
底层执行引擎；Role、Flow、事件协议、状态约束、恢复和审计语义由 OGSystem 自己定义。

### 规范基线：普通有限状态机与 OGS 扩展状态机

普通有限状态机（FSM）的最小转移关系可以写成：

```text
(控制状态, event) -> (下一控制状态, action)
```

有限集合中的当前控制状态和输入事件决定可用转移。OGS 保留这个核心：Role 输出事件，
Runtime 根据事件和 Flow 选择下一次激活。但 OGS 还必须持久化一组显式的扩展状态：

```text
(控制状态, event, 扩展状态)
  -> (下一控制状态, 更新后的扩展状态, 持久化事实)
```

扩展状态包括业务状态与 reducer 结果、原始 `task`、逐跳变化的 `input`、活跃分支与
lineage、Join Scope、Loop 轮次与预算、审核控制状态、checkpoint 版本和审计证据。
这些字段有固定结构和校验规则，不是隐藏在 Prompt 或模型上下文中的任意变量。

之所以称为“扩展状态机”，不是因为 OGS 放弃了状态机，而是因为以下语义无法可靠地只用
一个“当前节点”表示：

1. **Join** 要判断同一 `runId + lineageId + loopIteration` 下哪些 source Role 已完成，
   并保留它们的事件和数据。若把每种部分完成组合都编码成普通 FSM 状态，分支增加时
   控制状态会迅速膨胀。
2. **Loop** 不只是图上的回边，还需要当前轮次、最大预算和耗尽后的路径。运行时必须
   持久化并校验这些字段，才能保证恢复和终止可解释。
3. **Parallel branch** 同时存在多个活动前沿，需要 branch/lineage 记录。理论上可以
   将每种前沿组合展开成普通 FSM 状态，但会造成状态爆炸，并且无法清晰表达 Join 的
   来源和审计范围。

因此 OGS 的“扩展”是受限的语义扩展：Semantic IR 固定事件合同、状态 reducer、条件
AST、Join 模式、Loop 预算、持久化和失败规则；未知字段、歧义路由、无界循环、未声明
Join source 和非法上下文选择器都必须 fail closed。OGS 借鉴 UML 状态机常用的事件、守卫
和动作概念，也参考 BPMN 的网关和令牌控制流，但不宣称 UML 执行语义或 BPMN XML 的
一致性。对外以 OGS 自己的 Role、Flow、恢复和审计合同为准。

### 与普通工作流 DAG 的严格比较

普通工作流 DAG 可表示为 `G = (V, E)`，其中边集合 `E` 无环。一次运行遵循偏序关系：
前置节点满足条件后，节点进入执行前沿；通常每个节点在一次运行中只激活一次。DAG 的
优势是拓扑序、结构性终止、静态关键路径和容量分析都比较简单，适合固定的 ETL、构建、
审批和批处理流程。

OGS 并不否定 DAG。没有环、没有重复激活、只有静态前置汇合的 OGS Team，本身就是 DAG
形状的子集，应当按简单 DAG 使用。OGS 增加的是在 DAG 无法直接表达或必须隐藏在节点内部的
业务语义：

```text
X_t = (S_t, F_t, L_t, J_t, C_t, H_t, R_t)
X_{t+1} = delta(X_t, event_t)
```

其中 `S` 是业务状态，`F` 是多分支执行前沿，`L` 是血缘，`J` 是 Join Scope，`C` 是循环
轮次与预算，`H` 是人工控制状态，`R` 是恢复和审计身份。

| 比较维度 | 普通工作流 DAG | OGS 扩展状态机 |
| --- | --- | --- |
| 控制结构 | 无环偏序 | 包含 DAG 子集，并支持受限反馈、循环和重复激活 |
| 循环 | 展开固定次数，或藏在一个黑盒节点中 | 显式 Loop Scope、轮次、预算和耗尽路径 |
| 汇合 | 通常等待静态前置节点 | `all_of` / `quorum_of`，按 `runId + lineageId + loopIteration` 判断就绪并保留来源数据 |
| 分支 | 静态分叉，通常一次激活 | 显式 branch/lineage 前沿，可在同一 Role 上下文中隔离多条路径 |
| 终止 | 由无环结构保证 | 由有限工作、Loop 预算和 fail-closed 规则保证；无预算环路无效 |
| 静态分析 | 简单，适合关键路径和容量预估 | 运行时状态更丰富，分析和调度成本更高 |
| 恢复与审计 | 多为节点/任务级检查点 | Role 执行、事件、分支、Join、Loop、checkpoint 和控制面证据均可追踪 |

从数学上看，有限次数的循环可以展开成 DAG，但图规模会随轮次和嵌套组合增长；不定次数
循环不能由有限 DAG 精确表示，只能隐藏在一个黑盒节点中。并行汇合也可以把每种部分完成
情况枚举为 DAG 节点，但来源数量增加时状态组合会快速膨胀，且不再直接表达“至少 N 个
来源完成”的业务谓词。OGS 把这些谓词和证据放入扩展状态，因此表达能力更强，但状态、
持久化和验证成本也更高。

对 AI 场景，扩展的价值不在于“用了模型就必须使用状态机”。固定的提示词串联和一次性
批处理仍应使用 DAG。扩展状态机适用于模型输出本身是受合同约束的业务事件，并且需要：

- 多个专业 Role 并行给出意见，再按全量或 quorum 汇合；
- 审查、返工、再评估等可解释的反馈回路；
- 模型不确定时按事件和业务状态选择下一责任角色，而不是让一个黑盒节点自行改图；
- 长时间运行、人工暂停、恢复和逐 Role 审计。

这类场景若全部塞入 DAG 节点，流程图仍然存在，但反馈轮次、路由原因、来源数据和恢复
边界会变成节点内部日志，难以统一验证。OGS 将其提升为固定的 Role/Flow 语义，同时用
预算、合同和检查点限制模型带来的不确定性。代价是更高的状态和实现复杂度，所以固定的
无环流程、Role 内部的 item-level 循环和无法稳定解释的动态 fan-out 不应强行提升为图语义。

### 社会化协作关系的形式化

OGS 的“社会化协作”指责任之间的可观察协作关系，不等同于员工社交网络或组织层级。
静态 Team 可表示为带标签的有向角色图：

```text
R = (V, E, rho, tau, kappa, alpha)
```

其中 `V` 是稳定的 Responsibility Role 集合，`E` 是可能的责任交接，`rho` 描述责任边界，
`tau(e)` 是交接携带的业务事件，`kappa(e)` 是有类型的输入/输出合同，`alpha` 是控制动作的
权限策略。人、模型、服务和工具只能作为 Role 的执行绑定；它们不是 `V` 中的 Role 身份。身份
认证、授权和操作责任人属于控制面审计，不参与 Role 图的路由推断。

该模型综合了有向标记图、角色理论、标记转移系统、契约式设计、访问控制以及社会技术系统与协调理论。
它是 OGS 的领域抽象，不是某一个外部标准的原文公式；UML、BPMN 和 Petri 网只提供概念参照，
不构成 OGS 的符合性声明。

一次运行在这个静态关系上增加动态状态：

```text
X = (s, b, l, j, c, h, q)
```

分别表示业务状态、活动分支前沿、血缘、Join Scope、循环轮次/预算、人工控制状态以及
checkpoint/审计身份。Role 激活消费输入上下文并产生带类型的事件和数据：

```text
(X, role, input) --event/data--> (X', nextRoles)
```

可以把它类比为带颜色的 Petri 网：Role 激活是变迁，事件/数据是带类型的令牌，并行分支
产生多个令牌，Join 是同步变迁；`all_of` 消费所有声明来源，`quorum_of` 消费达到阈值的
唯一来源。这个类比用于解释同步和就绪判定，不表示 OGS 宣称兼容 Petri 网规范。

从社会协作角度，以下关系都是真实的业务关系而不是图形装饰：

- 同行审查和返工是反馈交接；
- 多个专家给出意见并由裁决者汇总，是并行产出加 Join 同步；
- 升级或降级路径，是由业务状态和权限决定的条件交接；
- 人工批准、暂停和终止，是可以跨进程存在的控制面状态。

这种形式化让“谁负责、交接了什么、何时可以汇合、谁可以干预”都能进入同一份可审计
运行证据。代价是可达状态空间会随活动分支数、Join 组合、循环预算和审核决定增加；因此
OGS 使用固定 Role Contract、受限条件 AST、有界 Loop、显式 quorum、不可变 Run 身份和
fail-closed 路由控制复杂度。它描述的是有边界的社会技术协作系统，不是无限制的自治社会
模拟器或组织管理系统。

## 零、团队、项目、Task 与 Run 边界

本规范定义的 Team/System 图是静态协作结构；Project 是资源与运行历史的聚合边界；Run 是该结构的一次
动态执行尝试。Runtime `Run` 不等于 Team Site 的业务 `Task`：一个 Task 可排队并关联多次 Run。三者不得混为同一个状态对象：

| 对象 | 规范职责 | 关键约束 |
| --- | --- | --- |
| **Team / System** | 定义角色、Flow、事件、循环、分支、汇合、合同和静态策略 | 可复用、可发布、可版本化；不保存项目资源或运行状态 |
| **Project** | 持有项目工作目录、共享资源、已挂载 TeamVersion 集合，以及 Team Site 的 Task 清单和运行历史 | 可挂载多个 TeamVersion；每个 Task 明确选择其中一个。Studio 发布新版本后由项目显式加入挂载集合，不把 Team 图复制成项目私有结构 |
| **Task** | Team Site 中的一项业务工作请求，明确选择一个已挂载 Team 版本，并关联零次或多次 Run | 不表示一次动态执行；一次成功 Run 满足适用验收条件后即完成 Task；失败/异常重试不创建新的 Task |
| **Run** | 执行一个确定的 Team 版本，并保存本次输入、状态、运行工作目录、产物和审计证据 | 一次 Run 只绑定一个 Team 版本；同一 Team 版本可在一个 Project 中运行多次 |

Run 开始时必须冻结所选 Team 版本、项目输入和执行指纹。之后 Team 发布新版本、Project 重新挂载 Team 或项目
共享资源发生变化，都不得改变既有 Run 的恢复和审计语义。运行时的 `branchId`、`lineageId`、loop iteration
和 role execution record 都属于 Run 内部动态事实，不是 Team 的静态节点。

目录边界如下：项目工作目录保存共享资源和项目配置；`.ogs/runs/<run-id>/` 是一次 Run 的运行工作目录，保存
快照、状态、日志、检查点、运行产物和审计记录；通过 `--workspace-dir` 绑定的外部编程目录是角色工具的目标，
不改变 Project 对 Team 定义和 Run 证据的所有权。Run 目录不自动隔离角色对目标目录或外部服务的写入。Git 管理的
目标代码可通过每 Run 独立 worktree 和显式合并隔离，但 Team Site 当前尚未自动创建这类 worktree；worktree 也不
隔离网络、凭据或其他外部副作用。运行结果默认属于该 Run，提升为项目共享资源必须经过明确的发布/复制动作。

暂停或人工审核通过控制面中断当前执行线；恢复从原 checkpoint 继续同一个 Run。Runtime 也可在恢复权威文件和
执行指纹有效时从进程中断恢复。Team Site 服务启动恢复则把遗留活动 Run 标记为失败，Task 后续重试会创建新的 Run。

## 一、 核心架构哲学：物理隔离与逻辑投影

`ogsystem` 的设计遵循 **“物理白纸，逻辑灵魂”** 的原则：
*   **物理层 (Physical Layer)**：通过 OpenCode Server 提供可隔离、可复用的“对话房间”（Sessions）。
*   **逻辑层 (Logic Layer)**：框架（Runtime）从全局状态中提取“脱水”后的关键信息，通过 **状态投影 (State Projection)** 注入到每个房间的提示词（Prompt）中。
*   **血缘识别 (Lineage)**：以 `branchId/lineageId/sessionLineageId` 共同描述执行血缘。会话复用键为 `roleId + sessionLineageId`，确保并行路径物理隔离，循环轮次按 `sessionLineageId` 策略进行隔离或复用。

---

## 二、 核心概念映射：责任角色、席位与 Branch

理解 `ogsystem` 运行时的关键在于区分“静态定义”与“动态实例”：

| 概念 | 类比 | 定义 | 作用 |
| :--- | :--- | :--- | :--- |
| **Responsibility Role（责任角色）** | **流程中的稳定职责** | 由 `roleId` 标识的抽象责任。 | 定义流程中“哪项职责负责什么”；不是人员、模型、服务或一次运行实例。 |
| **Responsibility seat（责任席位，静态节点）** | **流程中的职责位置** | Mermaid 图中一个 Responsibility Role 的静态位置。 | 定义该职责的上下游；不是网关、事件或运行实例。 |
| **Role Package（角色包）** | **版本化实现资产** | Prompt、Schema、manifest 等静态材料。 | 约束职责如何实现；不等同于 Responsibility Role 本身。 |
| **Branch (分支)** | **Git Fork / Branch** | 运行时的动态实例（核心标识为 `branchId`，并携带 `lineageId/sessionLineageId`）。 | 承载“分支级执行状态与会话血缘”。注：相同 role 的分支默认共享 `roleDir`，不提供分支级独立工作目录。 |

**Git Fork 类比**：
当一次转移会激活多个下游（典型是 `parallel_split`，也可能是同事件命中多个目标）或进入 join 节点时，系统会为目标分支切换到新的 `sessionLineageId`。它们拥有相同的初始状态（上游 Context），但随后的会话记忆物理隔离（注：此处主要指会话记忆层隔离，不代表文件系统隔离，相同 role 仍共用其私有工作目录）。术语的完整边界见 [核心概念](ogsystem-core-concepts.md)。

---

## 三、 编排语义清单：实现与逻辑层工作

| 编排语义 | 原理说明 | 逻辑层 (Role/Prompt) 的具体工作 |
| :--- | :--- | :--- |
| **`join.mode: all_of`** | **全量汇合**。等待 `join.sources` 声明的全部上游在同一 `lineageId + loopIteration` 下完成；当前实现要求 `join.sources.<roleId>` 中的 source role 唯一，且与 Mermaid 中该节点的全部入边角色严格一致，避免隐式漏等/多等。 | **1. 命名空间打包**：运行时将多方产物整理为以 `roleId` 为键的 JSON 对象注入 `{{input}}`，值中保留 `event/content/data`。 <br> **2. 汇合判定**：由运行时按 `join.sources`、当前 `lineageId` 与当前轮次判断是否可激活 join 节点。 |
| **`join.mode: quorum_of`** | **法定人数汇合**。等待 `join.sources` 中至少 `join.min.<roleId>` 个唯一上游在同一 `lineageId + loopIteration` 下完成；`join.sources.<roleId>` 本身也必须只声明唯一 source role，并与 Mermaid 中该节点的全部入边角色严格一致；达到阈值后 join 节点只激活一次，迟到 source 只记审计、不重触发。 | **1. 阈值判定**：运行时按唯一 source role 计数，而不是按到达次数计数。 <br> **2. 默认上下文**：未配置 `context.map` 时，仍按 `join.sources` 归一化注入 JSON 命名空间到 `input`。 |
| **`context.map.<roleId>.*`** | **字段级上下文投影**。运行时用稳定字段顺序构造新的 JSON `input`。 | **1. 普通节点来源**：`direct.*`、`global.task`、`global.user_profile.*`。 <br> **2. Join 节点来源**：`source(<roleId>).*(仅限 join.sources)` 与 `global.*`。 <br> **3. Fail-closed**：缺字段、缺 source、非法 selector 均直接失败。 |
| **默认事件路由（无 `role.mode`）** | **条件跳转**。由输出事件决定。 | **1. 选项锁定**：在 Prompt 注入 `allowed_events`。 <br> **2. 结构化约束**：在有出边且非并行模式下要求输出 `event`。 <br> **3. 命中规则**：运行时会激活所有 `eventType == 输出 event` 的出边；若 `PASS/REJECT` 指向同一目标，仍是单次二选一路由（由输出 event 决定命中哪一组边）。 <br> **4. `noop` 例外**：仅在 law 显式允许 `allowNoopWithoutExecutionBinding=true` 且该节点最多一个出边时，运行时可无模型执行直接走唯一出边。 |
| **Semantic IR 条件路由** | 对同一源角色和输出事件的候选 Transition 求值；无条件边恒匹配。条件为封闭形状的受限 AST，只能读取白名单 `state/loop/event/role` 路径；literal 只允许有限数值、字符串、布尔值或 null，不允许对象、脚本或额外字段。显式 `null` 可用于 `exists` 和 `equals null`。 | 只激活唯一最高优先级匹配边；缺失输入、操作数类型错误、无匹配或最高优先级并列均 fail closed，稳定错误码分别为 `IR_ROUTE_CONDITION_INPUT_MISSING`、`IR_ROUTE_CONDITION_TYPE_INVALID`、`IR_ROUTE_NO_MATCH`、`IR_ROUTE_AMBIGUOUS`（无候选为 `IR_ROUTE_NO_CANDIDATE`）。`route_decision` 事件记录候选 flow、priority、匹配布尔值、胜出 flow/目标或失败码；不记录参与比较的字段值。Studio/Run 的 Conversation 视图读取同一持久化事件。 |
| **反馈事件** | **席位间的业务事件流**。例如 `A --|FEEDBACK|--> B` 表示 A 产生反馈，B 消费反馈；`FEEDBACK` 本身不是节点或执行实例。 | 反馈内容放入事件 Payload，并按 B 的输入/事件合同校验；除非存在独立职责、权限和审计边界，不新增 `a-feedback` / `b-feedback` 席位。 |
| **`role.mode: parallel_split`** | 在一次状态转移中激活该 Role 的全部静态声明普通下游分支；`ERROR*` 异常流不属于普通分支。它不按业务集合生成子任务、不选择一个独占目标，也不承诺物理同时执行。 | 业务任务拆解必须由上游输出及显式输入/上下文映射完成。运行时按 `sessionLineageId` 隔离分支会话；默认不提供分支级独立工作目录，同一 Role 仍共享其 `privateDir`。 |
| **`loop.max`** | **循环预算**。限制拓扑环路迭代。 | **1. 输入稳定性**：`task` 始终保持原始用户请求，轮次变化只通过新的 `input` 上下文体现。 <br> **2. 运行时守卫**：解析期要求每个拓扑环至少有一个角色声明 `loop.max.*`；执行期由 loop budget 拦截超限激活。Semantic IR 的 Loop Scope 计数按 `runId + lineageId + loopId` 隔离；`counterField` 只引用业务方声明的状态字段，不是 OGS 预置字段。 |

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
*   **Join 作用域键与显示 ID 分离**：内部 readiness key 包含 `runId`、Join 角色、`lineageId` 和 `loopIteration`；`joinId` 是审计/UI 显示标识，不能用于替代内部去重或 readiness 判断。
*   **Join 可观察状态来自持久化 scope**：运行快照保留 scope 的 Join mode/minimum、预期/已到达/缺失来源、状态和 timeout policy；Visualizer 按 scope 分开展示 lineage、轮次、等待时间与 deadline。旧快照缺少可选的 mode/minimum 时，从已编译的图配置投影，不从前端猜测运行状态。
*   **Join 失败原因保持互斥**：来源失败按 `failurePolicy` 结算时记录 `join_source_failed` 和 `GRAPH_JOIN_SOURCE_FAILED`；等待期限耗尽时记录 `join_timed_out` 和 `GRAPH_JOIN_TIMEOUT`。`failurePolicy: wait` 会继续等待到 Join timeout，不把来源失败事件伪装为 timeout。
*   **条件路由审计不持久化比较值**：运行事件仅记录候选 flow 的 priority 与 matched 结果、选中目标或稳定失败码；state/event/role 中的实际字段值只用于运行时判定，不复制到 route decision event。
*   **`all_of` 与 `quorum_of` 的关系是“语义特例”，不是新增模式**：`quorum_of + join.min=1` 等价“any”；`quorum_of + join.min=|sources|` 等价“all”。当前 DSL 不单独引入 `any_of`：`all_of` 保留为高频默认汇合语义（更少配置、更易审查），`any` 通过 `quorum_of + join.min=1` 表达（避免新增关键字带来的解析和测试范围扩张）。
*   **Join 上下文与字段投影都属于运行时契约**：默认 join `input` 是按 `roleId` 归一化后的 JSON 投影；若声明 `context.map.<roleId>.*`，运行时会以稳定字段顺序重建 `input`，并要求 selector 与 source 都合法。
*   **Flow contract 是独立的运行时合同层**：`handoff.mode` 只控制合同校验策略，`transition` 会跳过告警或缺失合同对应的 flow，`strict` 则硬失败；`handoff.contracts` 指向合同 bundle；`role_input` 只校验 `context.map` 投影后的结构化对象，不替代 runtime 内建的 prompt-input schema。
*   **Compiler facade 是静态摘要层**：`src/runtime/compiler.ts` 会收拢 system / role / contract / effective law 的稳定摘要，生成 `CompiledExecutionSnapshot` 与 compiler digest；运行时仍保留最后防线，不把 compiler 当作唯一真相源。
*   **合同路径按系统文件解析**：`handoff.contracts` 相对 `system.mmd` 所在目录解析，运行时会先归一到绝对路径，再参与加载与 resume 指纹。
*   **合同 schema 的 `$ref` 只允许本地文件引用**：相对引用按 schema 文件所在目录解析，支持嵌套本地引用与片段引用；远程 `http(s)://` 引用会直接失败。
*   **`context.map` selector 为白名单语法**：仅支持 `global.task`、`global.user_profile(.path)`、`global.human_review.current(.comment|.round|.previous_output(.path))`、`direct.content/event/data(.path)`、`source(<roleId>).content/event/data(.path)`；human review selector 允许追加 `?` 表示“当前 branch 没有 review 上下文时忽略该字段”；join 节点禁止 `direct.*`，非 join 节点禁止 `source(...)`。
*   **`noop` 是受 law 约束的显式语义**：角色无 `model.bind/exec.bind` 时并不自动放行；只有 `allowNoopWithoutExecutionBinding=true` 且出边数不超过 1 才允许 `noop`，否则直接失败。
*   **隔离的是模型会话，不是分支文件系统**：并行 sibling branch 会拿到不同的 `sessionLineageId`，从而不会共享模型会话记忆；但相同 role 默认仍共用一个 role 私有目录。
*   **顺序链路会继承 `sessionLineageId`**：只有并行分叉、一次激活多个目标，或进入任意 join（`all_of` / `quorum_of`）时，运行时才会切换到新的会话血缘；普通单路顺序流转会沿用当前 branch 的 `sessionLineageId`。
*   **状态机扩展事件是单触发语义**：`quorum_of` 达阈值后 join 分支只激活一次；迟到 source 仅追加 `join_late_arrival_ignored` 事件，不重复激活 join。
*   **`loop.max` 是按“声明该 budget 的目标角色”独立计数**：进入该角色一次记一次；捷径若绕过该角色，不会增加该角色计数。若环上多个角色都声明了 `loop.max`，它们各自独立生效，任一超限都会触发控制面审核。角色级预算与 Semantic IR Loop Scope 同时存在时按合取关系检查，追加额度只作用于触发审核的预算。
*   **分支终止必须影响 Join source 状态**：`terminate(branch)` 将当前 source 记录为 `skipped`；`all_of` 不会把它计入已到达来源，`quorum_of` 只按实际 `arrived` 来源计算阈值，无法收敛的 Join 以稳定错误结束。

---

## 八、 Mermaid DSL 硬约束（补充）

*   **Header 必须严格匹配**：首个非空行必须是 `flowchart TD` 或 `flowchart LR`。
*   **可执行行是封闭集合**：仅允许 `%% key=value` 元数据行与 `A -->|EVENT| B` 边定义；其他可执行语法直接失败。
*   **节点 token 是严格格式**：业务节点使用 `nodeId[Role:roleId]`，结构角色使用 `start[开始]` 与 `end[结束]`。
*   **边界边语义固定**：只允许 `start[开始] -->|START| Role` 与 `Role -->|EVENT| end[结束]`。
*   **入口语义来自开始连线**：Start 的候选角色只由其出边确定，所有出边必须使用 `START`。默认分发全部候选；`start.dispatch.mode=random_n` 配合 `start.dispatch.count=N` 按 Run 固定选择 N 个并持久化，恢复不重抽。
*   **结束汇聚只看直接连线**：只有直接连接 End 的不同角色参与 `all_of` 或 `quorum_of`；无结束连线的孤立角色不计入。`end.join.min` 范围为直接连接 End 的不同角色数。阈值达成会取消未完成分支，随机入口造成阈值不可达时运行失败并记录未满足角色。终值按稳定图顺序记录，同一角色多次激活均保留。
*   **元数据键是白名单**：仅支持 `engine/system.id/system.version/law.global/start.dispatch.mode/start.dispatch.count/end.join.mode/end.join.min`、`exec.bind/role.mode/join.mode/join.sources/join.min/context.map/loop.max/handoff.mode/handoff.contracts/route.order.*` 以及 `review.mode/review.timeout/review.timeout.action/review.rework.target/review.rework.max/review.terminate.scope` 前缀；重复 key 与未知 key 都会失败。`runtime.error_flows.v1` 属于 `.ogs/runtime.json`，不是 Mermaid 元数据。
*   **`engine` 是可选的执行元数据**：可省略；若声明则只能是 `langgraph`。
*   **保留角色名禁止复用**：`start/end` 是特殊角色名，不能作为业务 `roleId`。
*   **终止条件必须显式可达**：至少一个业务角色必须有 Flow 直接连接 `end[结束]`；无出边角色不会隐式成为终值角色。
*   **绑定冲突会被拒绝**：同一 role 不允许同时声明 `exec.bind.<roleId>` 与项目模型选择；`system.mmd` 不承载模型绑定。

---

## 九、 生命周期与落盘契约（2026-04-12）

*   **运行根目录唯一化**：运行权威目录为 `.ogs/runs/<run-id>/`，不再使用旧 `ogsystem-history/` 路径。
*   **run-id 规则**：`YYYYMMDD-HHMMSS-<shortHash>`，保证可排序和低碰撞。
*   **配置快照**：每次 `run start` 写入 `resolved-config.json`，用于后续审计与复盘。
*   **OpenCode 运行元数据**：由 OGSystem 写入 `.ogs/runs/<run-id>/.opencode/server.pid` 和 `.ogs/runs/<run-id>/.opencode/endpoint.json`，按 run 隔离。`opencode serve` 只使用 hostname/port 参数启动，不绑定 OGSystem 目录；`session.create/prompt/abort` 的 `directory` 指向解析后的编程项目。
*   **编程项目绑定**：默认 `targetDir=workdir`。OGSystem 项目也可以通过 `.ogs/project.json.target.directory` 或 `--workspace-dir` 绑定外部编程项目；此时 OpenCode 的 session 上下文和工具项目基准指向目标项目，系统定义、审计和运行产物仍留在 OGSystem 项目中。多个 OGSystem 项目可绑定同一目标，但并发写入必须使用 worktree、独立 clone 或互斥策略。
*   **日志双通道**：引擎日志 `logs/engine.ndjson`，角色日志 `logs/roles/<roleId>.ndjson`，同时保留 `events.ndjson` 作为完整事件流。
*   **停止状态机**：支持 `running -> stopping -> stopped`，并在 `control/stop-request.json`、`control/stop-outcome.json` 保留操作证据。
*   **人工审核原生化**：`review.*` 让 role 执行后先进入 `waiting_review`，draft result 落在 pending review 控制面，approve / rework / pause / terminate 通过 `control/reviews/` 与 resume/reconcile 主链完成，而不是通过单独 human-gate role 节点。
*   **审核超时边界**：`review.timeout.*` 会进入编译快照与 pending review spec。status、inspect、review list 和 resume 惰性检查到期时间，并幂等写入超时 decision 与审计事件；没有后台计时服务。`pause` 保留可操作的暂停审核，`terminate` 按配置终止分支或运行；resume 幂等应用持久化 decision。
*   **语义分叉与物理并发分离**：`parallel_split` 只保证多个下游分支被激活及其 session lineage 隔离；当前 scheduler 按活动队列顺序处理，物理并发属于未来执行策略。
*   **执行工作区与 ACP session 绑定**：每次 role execution 使用新的 clean-room workspace。ACP session 只能在创建它的 execution directory 中复用；同一 `sessionKey` 遇到新的 execution directory 时必须重新创建或按新目录加载 session，不能把旧 workspace 的会话带入本次执行。
*   **能力策略下沉到 backend**：`workspace.read`、`workspace.write`、`workspace.patch_text` 与 `workspace.run` 是独立能力。OpenCode native tools、Codex sandbox/approval、以及 ACP permission request 都必须服从同一策略；ACP 命令还必须是执行 workspace 内的简单命令。
*   **产物证据链**：`artifact-manifest.json` 是验证后的 canonical manifest，`verification.json` 记录本次检查，`seal-manifest.json` 通过 `manifestSha256` 指向 canonical manifest。读取方必须重新验证 canonical manifest 和文件摘要，不能只信封存清单中的可变文件条目。

---

## 十、 异常流语义（ERROR*，V1 delivered，默认 flag off）

以下语义已落地实现；默认发布策略仍由 `runtime.error_flows.v1=false` 控制（未启用或未声明 `ERROR*` 边时保持 fail-stop）：

*   **语法沿用现有事件标签**：`ERROR` 与 `ERROR.<errorCode>`。
*   **节点级 opt-in**：仅声明了 `ERROR*` 出边的节点启用异常流。
*   **触发来源限定**：仅运行时失败路径触发（execution/validation/io/state 等），不是普通成功输出事件。
*   **触发时机边界**：执行器侧重试耗尽后，才进行 `ERROR*` 匹配与路由。
*   **匹配顺序**：先 `ERROR.<errorCode>`，后 `ERROR`，无匹配则保持 fail-stop。
*   **解析约束**：同一 `fromRole` 仅允许一个 `ERROR` 兜底边；同一 `ERROR.<code>` 仅允许一个目标；结构角色 `start[开始]` 不允许声明 `ERROR*`。
*   **fail-closed 约束**：保留前缀事件必须是 `ERROR` 或 `ERROR.<errorCode>`；其他 `ERROR*` 形式在解析期拒绝。
*   **角色提示契约**：运行时注入给角色的 `allowed_events` 不包含 `ERROR*`（异常流仅由运行时失败路径触发）。

判定建议（异常流 vs 业务事件流）：

*   **业务事件流**：用于“成功执行后的业务分支”（如 APPROVED/REJECTED、ROUTE_A/ROUTE_B）。
*   **异常流**：用于“运行时失败后的补偿/降级分支”（execution/validation/io/state）。
*   **边界约束**：不要把预期业务否定路径建模为 `ERROR*`。

错误流配置、失败 envelope、补偿与恢复规则以本规范、[语义手册](./ogsystem-semantics-manual.md)及 runtime 回归测试为准。
