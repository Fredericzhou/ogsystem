# OGS Extended State Machine And Social Collaboration
# OGS 扩展状态机与社会化协作

Status: active technical reference  
状态：现行技术参考

This document is the bilingual reference for the OGS execution model. The English and Chinese
paragraphs are intentionally paired so that product, runtime, and semantic discussions use the
same terms.

本文是 OGS 执行模型的中英文对照参考。英文和中文段落按语义配对，确保产品、Runtime 和
语义规范使用同一套术语。

## 1. Product Position / 产品定位

**English**

OGS is an event-driven, persistent extended state-machine workflow runtime. It organizes stable
Responsibility Roles into an executable, recoverable, and auditable collaboration system. A Role
produces a typed event and structured data; Runtime applies the state update and selects the next
Flow. LangGraph is an implementation adapter, not the public OGS semantic contract.

**中文**

OGS 是事件驱动、持久化的扩展状态机工作流运行时。它把稳定的责任角色组织成可执行、可恢复、
可审计的协作系统。Role 产生带类型的事件和结构化数据，Runtime 应用状态更新并选择下一条 Flow。
LangGraph 只是实现适配器，不是 OGS 对外的语义合同。

OGS is a bounded socio-technical coordination model, not an employee social network, an
organization chart, or an unrestricted autonomous-society simulator.

OGS 建模的是有边界的社会技术协作关系，不是员工社交网络、组织架构图，也不是无限制的自治社会模拟器。

## 1.1 Theoretical Basis / 理论基础

**English**

The model is a deliberate synthesis, not a formula quoted from one external standard:

| Foundation | Contribution to OGS |
| --- | --- |
| Directed labeled graphs | `V` and `E` represent stable Role vertices and directed handoff relations. |
| Role theory and organizational design | `rho` defines the responsibility boundary of each Role without identifying a person. |
| Labeled transition systems and event-driven automata | `tau` gives a handoff its event label and makes event selection part of execution. |
| Design by Contract and type systems | `kappa` defines the typed input/output contract for a handoff. |
| Access-control and governance models | `alpha` defines who or what may execute control actions; authority is separate from responsibility. |
| Sociotechnical systems and coordination theory | The model separates human responsibility, technical execution, information transfer, and governance. |

The resulting tuple is an OGS domain model. It is informed by these theories but is not itself a
UML, BPMN, or Petri-net conformance claim.

**中文**

这个模型是有意组合的领域形式化，不是直接摘自某一个外部标准：

| 理论基础 | 在 OGS 中的作用 |
| --- | --- |
| 有向标记图 | `V` 和 `E` 表示稳定的 Role 顶点和有向责任交接关系。 |
| 角色理论与组织设计 | `rho` 定义每个 Role 的责任边界，但不把它等同于具体人员。 |
| 标记转移系统与事件驱动自动机 | `tau` 为交接标记事件，使事件选择成为执行语义的一部分。 |
| 契约式设计与类型系统 | `kappa` 定义交接的有类型输入/输出合同。 |
| 访问控制与治理模型 | `alpha` 定义谁或什么可以执行控制动作；权限与责任分离。 |
| 社会技术系统与协调理论 | 模型分离人的责任、技术执行、信息传递和治理。 |

最终元组是 OGS 的领域模型。它受到这些理论启发，但不等同于 UML、BPMN 或 Petri 网符合性声明。

## 2. Ordinary FSM / 普通有限状态机

**English**

The minimal event transition relation of an ordinary finite-state machine is:

```text
(controlState, event) -> (nextControlState, action)
```

The current control state and input event determine the eligible transition. This finite control
model is useful and remains the core of OGS Flow routing.

**中文**

普通有限状态机的最小事件转移关系是：

```text
(控制状态, event) -> (下一控制状态, action)
```

当前控制状态和输入事件决定可用转移。这个有限控制模型仍然是 OGS Flow 路由的核心。

## 3. OGS Extended State / OGS 扩展状态

**English**

OGS uses the standard extended-state-machine pattern:

```text
(controlState, event, extendedState)
  -> (nextControlState, updatedExtendedState, durableFacts)
```

The extended state is explicit, typed, and persisted. It includes business state and reducer
output, the immutable task, changing per-hop input, active branches and lineage, Join scopes,
Loop counters and budgets, human-control state, checkpoint version, and audit identity.

**中文**

OGS 采用标准的扩展状态机模式：

```text
(控制状态, event, 扩展状态)
  -> (下一控制状态, 更新后的扩展状态, 持久化事实)
```

扩展状态是显式、有类型并且持久化的。它包括业务状态与 reducer 结果、不可变的 task、逐跳变化的
input、活动分支与 lineage、Join Scope、Loop 轮次与预算、人工控制状态、checkpoint 版本和审计身份。

The extension is not an unrestricted scripting surface. Semantic IR fixes event contracts, state
reducers, restricted guards, Join modes, Loop budgets, persistence rules, and failure behavior.

这个扩展不是无限制的脚本接口。Semantic IR 固定事件合同、状态 reducer、受限条件、Join 模式、Loop 预算、
持久化规则和失败行为。

## 4. Social Collaboration Graph / 社会化协作关系图

**English**

The static collaboration relation is a labeled directed Role graph:

```text
R = (V, E, rho, tau, kappa, alpha)
```

`V` is the set of stable Responsibility Roles. `E` is the set of possible handoffs. `rho` describes
the responsibility boundary, `tau(e)` is the business event on a handoff, `kappa(e)` is the typed
input/output contract, and `alpha` is the authority policy for control actions. A person, model,
service, or tool may realize a Role through a binding, but it is not the Role identity.

**中文**

静态协作关系是带标签的有向 Role 图：

```text
R = (V, E, rho, tau, kappa, alpha)
```

`V` 是稳定的 Responsibility Role 集合，`E` 是可能的责任交接，`rho` 描述责任边界，`tau(e)` 是交接携带的
业务事件，`kappa(e)` 是有类型的输入/输出合同，`alpha` 是控制动作的权限策略。人、模型、服务或工具可以通过
绑定来实现 Role，但不等同于 Role 身份。

Responsibility, handoff, coordination, and governance remain separate:

责任、交接、协调和治理保持分离：

| English | 中文 |
| --- | --- |
| Responsibility: who is accountable for a kind of work. | 责任：谁对某类工作负责。 |
| Handoff: what outcome is transferred and who may consume it. | 交接：传递什么结果，谁可以消费它。 |
| Coordination: whether all or enough contributors must complete before activation. | 协调：必须全部或达到足够贡献后才能激活。 |
| Governance: who may pause, approve, rework, or terminate. | 治理：谁可以暂停、批准、返工或终止。 |

Identity and authorization are control-plane projections and must not be inferred from `roleId`.

身份和授权属于控制面投影，不能从 `roleId` 推断。

## 5. Runtime Transition / 运行时转移

**English**

The dynamic execution state can be represented as:

```text
X = (s, b, l, j, c, h, q)
```

`s` is business state, `b` the active branch frontier, `l` lineage, `j` Join scopes, `c` Loop
counters and budgets, `h` human-control state, and `q` checkpoint/audit identity. A Role activation
consumes an input context and produces a typed event/data result:

```text
(X, role, input) --event/data--> (X', nextRoles)
```

**中文**

动态运行状态可以表示为：

```text
X = (s, b, l, j, c, h, q)
```

`s` 是业务状态，`b` 是活动分支前沿，`l` 是血缘，`j` 是 Join Scope，`c` 是 Loop 轮次与预算，`h` 是人工控制状态，
`q` 是 checkpoint/审计身份。Role 激活消费输入上下文并产生带类型的事件/数据结果：

```text
(X, role, input) --event/data--> (X', nextRoles)
```

## 6. DAG Comparison / 与普通工作流 DAG 比较

**English**

A conventional workflow DAG is `G = (V, E)` with acyclic `E`. Its execution follows a partial
order: a node becomes eligible after its predecessor condition is met and is normally activated
once. This gives simple topological scheduling, structural termination, critical-path analysis,
and capacity planning.

**中文**

普通工作流 DAG 可以表示为 `G = (V, E)`，其中 `E` 无环。运行遵循偏序关系：前置条件满足后节点才可执行，
并且通常在一次运行中只激活一次。这带来简单的拓扑调度、结构性终止、关键路径分析和容量规划。

| Dimension / 维度 | Conventional DAG / 普通 DAG | OGS extended state machine / OGS 扩展状态机 |
| --- | --- | --- |
| Control / 控制结构 | Acyclic partial order / 无环偏序 | DAG subset plus bounded feedback and repeated activation / DAG 子集加受限反馈与重复激活 |
| State / 状态 | Node status and workflow variables / 节点状态与工作流变量 | Typed business state, task/input, branch/lineage, Join, Loop, review, recovery / 有类型业务状态、task/input、分支血缘、Join、Loop、审核与恢复 |
| Loop / 循环 | Unroll to a fixed graph or hide in one node / 展开固定次数或藏在节点中 | Explicit iteration, budget, and exhausted route / 显式轮次、预算与耗尽路径 |
| Join / 汇合 | Static predecessor completion / 静态前置节点完成 | `all_of` or `quorum_of` over a scoped source set with payloads / 在作用域来源集合上执行 `all_of` 或 `quorum_of` 并保留数据 |
| Termination / 终止 | Structural from acyclicity / 由无环结构保证 | Finite work, budgets, and fail-closed guards / 由有限工作、预算和 fail-closed 条件保证 |
| Analysis / 分析成本 | Simpler static analysis / 静态分析更简单 | Richer runtime semantics and larger reachable state space / 运行时语义更丰富，可达状态空间更大 |
| Evidence / 证据 | Usually task/node-level / 通常是任务或节点级 | Role, event, branch, Join, Loop, checkpoint, and control evidence / Role、事件、分支、Join、Loop、checkpoint 与控制面证据 |

An acyclic OGS Team with no repeated activation is a DAG-shaped subset and should remain simple.
The extension is needed only when feedback, partial consensus, repeated Role work, or durable control
decisions are part of the business contract.

没有重复激活、没有环路的 OGS Team 本身就是 DAG 形状的子集，应保持简单。只有当反馈、部分共识、Role 重复工作或
持久化控制决策属于业务合同的一部分时，才需要扩展语义。

## 7. Join, Loop, And Petri-Net Analogy / Join、Loop 与 Petri 网类比

**English**

The model is analogous to a colored Petri net: a Role activation is a transition, event/data is a
typed token, parallel branches produce multiple tokens, and Join is a synchronization transition.
`all_of` consumes all declared source tokens; `quorum_of` consumes the configured number of unique
source tokens. This analogy explains synchronization; OGS does not claim Petri-net conformance.

**中文**

该模型可以类比为带颜色的 Petri 网：Role 激活是变迁，事件/数据是类型化令牌，并行分支产生多个令牌，Join 是同步
变迁。`all_of` 消费全部声明来源令牌，`quorum_of` 消费配置数量的唯一来源令牌。该类比用于解释同步机制，不表示
OGS 声称符合 Petri 网规范。

For a loop, a plain graph back edge expresses repetition but not the active round or termination
condition. OGS records `loopIteration`, enforces a declared budget, and routes an exhausted loop
explicitly. For a Join, a node status alone cannot represent which sources have completed or carry
their payloads; OGS persists the Join Scope.

对于 Loop，普通图上的回边只能表示重复，不能表示当前轮次和终止条件。OGS 记录 `loopIteration`，执行声明的预算，
并显式路由耗尽路径。对于 Join，单个节点状态不能表示哪些来源已完成，也不能携带来源数据；OGS 因此持久化 Join Scope。

## 8. AI Value And Trade-offs / AI 场景价值与代价

**English**

The extension is not required merely because a workflow uses AI. A fixed chain of model calls is
better represented as a DAG. The extension is valuable when model output is a contracted business
event and the system must support parallel specialist opinions, quorum or synthesis, review/rework,
state-dependent routing, human pause/resume, or per-Role audit.

Putting all of that inside one DAG node hides round-by-round context, routing reasons, source
evidence, and recovery boundaries in private logs. OGS exposes them as bounded Role/Flow semantics.
The price is more state, persistence, validation, and scheduling complexity. Fixed acyclic work,
Role-internal item loops, and unexplained dynamic fan-out should remain DAG-shaped or stay inside a
Heavy Node.

**中文**

扩展状态机并不是因为流程使用 AI 就必需。固定的模型调用链更适合用 DAG 表示。只有当模型输出是受合同约束的业务
事件，并且系统需要并行专家意见、quorum 或综合、审查/返工、基于状态路由、人工暂停/恢复或逐 Role 审计时，扩展
状态机才有价值。

如果把这些内容全部塞进一个 DAG 节点，逐轮上下文、路由原因、来源证据和恢复边界就会隐藏在节点私有日志中。OGS
把它们提升为有预算的 Role/Flow 语义。代价是更多状态、持久化、验证和调度复杂度；固定的无环工作、Role 内部的
item-level 循环以及无法解释的动态 fan-out，应保持 DAG 形状或留在 Heavy Node 内部。

## 9. Standards Boundary / 标准边界

**English**

OGS uses the event/guard/action vocabulary common to state-machine models and is conceptually
aligned with workflow control-flow ideas such as BPMN gateways and tokens. The Petri-net analogy
is explanatory. OGS does not claim UML execution-semantic conformance, BPMN XML compatibility, or
Petri-net conformance. The normative contract is the OGS Semantic IR, Role/Flow contract, durable
recovery rules, and audit model.

**中文**

OGS 使用状态机模型常见的事件/守卫/动作术语，并在概念上参考 BPMN 网关和令牌等工作流控制流思想。Petri 网只是
解释类比。OGS 不宣称符合 UML 执行语义、BPMN XML 兼容性或 Petri 网规范。规范性合同以 OGS Semantic IR、Role/Flow
合同、持久化恢复规则和审计模型为准。
