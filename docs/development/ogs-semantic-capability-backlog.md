# OGS Semantic Capability Backlog

基线日期：2026-09-29
状态：active
范围：将当前已接受的 OGS 编排语义做成易配置、可观察、可验证的框架能力。

## 1. 目标与边界

OGS 当前语义采用行业常见的工作流设计原则：显式事件路由、固定分支、Join、有界循环、人工审核、错误流、数据合同和可恢复运行。目标是提升这些语义的可用性与验证质量，不要求复制 LangGraph 或 BPMN 的全部能力，也不把 OGS 宣称为 BPMN 一致性实现。

本计划遵循以下术语边界：

- `parallel_split` 激活所有静态声明的普通下游分支；它不自动拆分业务任务，也不承诺物理并发。
- `fan-out` 是一对多分发的通用模式名称，不是与 `parallel_split` 等义的 OGS 操作符。
- `map_fanout` 表示按集合元素创建独立子任务；这是可选扩展，不属于当前核心语义。
- 物理并发是执行策略，不能改变图的可达路径、Join 就绪条件或恢复结果。
- 新语义必须有版本化合同、失败行为、审计字段和 conformance tests；不确定或有歧义的输入必须失败关闭。

### 执行语义速查

- `parallel_split` 在一次转移中激活该 Role 声明的全部普通下游目标；`ERROR*` 是运行时异常流，不属于普通分支。它不会根据一个业务事件在下游中择一，也不会按集合内容自动生成子任务。
- 每个下游目标获得独立的 Branch 和会话血缘。默认直接上下文来自上游角色结果；`context.map` 可显式投影所需字段。分支结果分别记录，不会自动把多个结果合并成一个业务对象；Join 角色通过声明的来源及上下文映射消费结果。
- `event_route` 按角色输出事件匹配声明的 Flow。Semantic IR 条件用于进一步判定相应事件路由；条件路由必须有唯一胜出目标，否则失败关闭。条件只读取允许的 state、loop、event、role 上下文，不隐式读取任意分支结果。
- `all_of` 按同一个运行、Join Role、lineage 和 loop iteration 等待全部声明来源；`quorum_of` 按唯一来源数达到阈值后激活一次。达标后的迟到来源只审计，不重复激活；阈值未覆盖全部来源时，Join 输入不能假设缺失来源已有结果。
- `map_fanout` 若未来实现，才表示按集合元素创建各自带 item 输入的子任务；它与上游生成子任务数据、再由固定角色出边扇出的模式不同。

权威语义仍以 [OGSystem Orchestration Semantics v1](../usage/ogsystem-orchestration-semantics-v1.md) 和 runtime 实现为准。本计划与 [语义缺口实施计划](semantic-gap-implementation-plan.md) 分工：前者描述语义和运行时缺口，本文聚焦配置、可观察性和验收推进。

## 2. 当前能力基线

| 能力 | 当前状态 | 边界 |
| --- | --- | --- |
| 事件路由 | 已实现 | 按角色输出事件匹配声明的 Flow。 |
| 条件路由 | Runtime 已实现，产品化部分完成 | Semantic IR 使用受限条件 AST 和优先级；条件读取当前 state、loop、event、role，不代表能直接读取任意 Join 来源。 |
| 固定分支 | 已实现 | `parallel_split` 一次激活全部普通出边；当前 scheduler 逐个处理活动分支。 |
| 动态 Map-Fan-out | 未实现 | 不定数量的集合元素子任务不属于当前图语义。 |
| Join | 已实现基础语义 | 支持 `all_of`、`quorum_of`、关联范围、基础 timeout/failure policy；`first_packet` 和 `gap` 阶段等待未实现。 |
| Loop | 已实现 | 使用显式预算限制循环执行。 |
| 人工审核 | 已实现 | 有持久化审核请求和 approve/rework/pause/terminate 生命周期。 |
| ERROR 路由 | 已实现、默认受功能开关控制 | 运行时错误路径与业务否定事件分离。 |
| 输入输出合同与上下文投影 | 已实现 | 使用 flow/role-input contracts 与白名单 `context.map` selector。 |

## 3. 优先级定义

- **P1：现有语义的产品化**。改善设计、运行诊断和回归保证，不改变已接受的路由、Join、恢复语义。
- **P2：有真实需求或数据后实施**。实现前必须有使用场景、性能/运维证据和边界设计。
- **Deferred：暂不进入核心**。没有明确需求时保持不支持，不先预埋 DSL 关键字。

## 4. P1：现有能力产品化

### P1-1 Studio 条件路由配置与解释

**现状**：Semantic IR 支持有限条件 AST、非负优先级、确定性选路和失败关闭；Studio 能投影条件摘要，但配置和诊断体验需要形成完整工作流。

**范围**：让用户能发现条件来源、查看条件所读字段、维护条件和优先级，并检查运行时选择结果。条件 AST 仍为白名单形式；不引入任意脚本或任意表达式执行。

**验收标准**：

- Studio 对每条带条件的 Transition 显示来源、事件、目标、条件摘要和优先级。
- 用户可通过受约束的表单创建和编辑已支持的条件 AST；保存后 Semantic IR 与路由图一致。
- 非法字段路径、无效字面量、负优先级、无匹配条件和同优先级歧义均在运行前给出稳定诊断。
- 条件求值出错或无唯一胜出路线时 fail closed；不回退到任意出边。
- Run/Trace 显示参与判定的事件、已判定的条件结果、胜出 Transition；敏感值遵守现有脱敏策略。
- 浏览器回归覆盖创建、编辑、重载、无匹配、歧义和运行解释；桌面与窄屏布局可操作。

**不在本项范围**：直接读取未声明的 Join source、加入一般用途脚本表达式、让模型输出绕过运行时条件判定。

### P1-2 Join 运行态可观察性

**现状**：Runtime 已维护 Join scope、到达来源、缺失来源、基础超时与迟到事件；Visualizer 需要确保这些状态能帮助操作者回答“为什么还在等、接下来会怎样”。

**范围**：扩展运行状态投影和 Run/Trace 展示，不改变 `all_of`、`quorum_of`、timeout 或 late-arrival 的判定。

**验收标准**：

- 每个 Join instance 可查看稳定的 scope 标识，以及 run、join role、lineage、loop iteration。
- 显示声明来源、已到达来源、缺失来源、当前阈值、已等待时长、deadline 和 timeout action。
- `all_of` 未齐时明确显示等待来源；`quorum_of` 达阈值后明确显示已激活，并将后续迟到结果显示为已记录但不会重触发。
- 来源失败、超时、pause、terminate、fail 和 quorum 未达标均能展示对应原因及审计事件。
- 状态来自持久化运行事实；刷新、重新打开 Run 和 resume 后投影一致，不由前端推测状态。
- 桌面与窄屏 UAT 覆盖正常等待、阈值满足、来源失败、timeout 和 late arrival；不显示未脱敏的角色输入或输出。

### P1-3 语义与 Engine Adapter 一致性套件

**现状**：OGS 有大量针对 runtime 能力的测试；需把公开语义与 LangGraph Engine Adapter 的映射边界固化为可重复的合同测试，避免后端细节改变 OGS 行为。

**范围**：确定性 fixture、Semantic IR golden、runtime event/audit assertions 和 adapter contract tests；不依赖真实模型、网络或并行时序。

**验收标准**：

- 规范 fixture 覆盖 event route、conditional route、固定 `parallel_split`、`all_of`、`quorum_of`、loop budget、human review、ERROR flow、checkpoint/resume。
- 对相同的 OGS 输入，重复执行产生相同的路由决定和等价的规范化审计轨迹；允许明确排除时间戳、运行 ID 等非确定字段。
- 覆盖重复事件、Join 重复/迟到来源、条件无匹配/歧义、CAS 冲突、checkpoint 重放、interrupt/resume、取消和失败优先级。
- 每种拒绝路径都有稳定诊断码或稳定错误类别，且无静默路由、静默丢失或重复激活。
- 测试可在不启动真实模型服务和外网的环境下运行；golden 更新必须能审查语义差异。

### P1-4 语义名称与界面文案收口

**现状**：文档已区分语义分支与物理并发；`parallel` 一词仍可能被理解成任务自动拆分或同时执行。

**验收标准**：

- 使用 `parallel_split` 的帮助文案明确说明“激活所有静态下游分支”。
- 相关说明明确：不自动切分任务、不承诺物理并发；任务分解由上游输出和输入映射显式完成。
- `fan-out` 仅作模式类别用语；任何配置项、UI 控件和 CLI help 均不把它作为 `parallel_split` 的无差别别名。
- 术语检查覆盖使用手册、语义手册、Studio、CLI help 和 NL2MMD 输出样例。

## 5. P2：按真实需求实施

### P2-1 受控物理并发

**进入条件**：真实运行基准表明逐分支调度造成不可接受的延迟；仅凭“图上有并行分支”不足以启动该项。

**设计约束**：并发度属于 execution policy。不得改变 Flow reachability、Join readiness、事件顺序合同或 checkpoint 恢复语义。实现前须评估相同 Role 分支共享 `privateDir` 的隔离风险。

**验收标准**：

- 有每 Run/工作进程可配置的最大并发和有界排队策略；默认行为兼容串行调度。
- 并发执行有明确的取消、超时、失败传播、重试幂等和 workspace isolation 规则。
- 在相同语义输入下，串行和并发模式达到相同的终态、可达分支集合及 Join 判定。
- WAL/checkpoint/resume 能区分未启动、运行中、已完成和结果已落盘的分支；恢复不重复提交已完成副作用。
- 有吞吐、排队时间、资源占用和失败注入基准；并发只在实测有收益且资源上限可控时开放。

### P2-2 动态 Map-Fan-out

**进入条件**：至少一个真实应用需要对运行时集合逐项创建工作，并且预展开或单个 Role 内部处理不满足隔离、审计或恢复要求。

**设计约束**：这是新语义，不是 `parallel_split` 的别名。必须定义集合 selector、item schema、子任务身份、最大展开数量、空集合、结果收集、部分失败和取消语义；避免无界动态分支。

**验收标准**：

- 每个 item 有稳定、可恢复、可审计的子任务身份和独立输入。
- 支持显式展开上限；超限、非法集合和 schema 不匹配在创建子任务前失败关闭。
- 空集合、部分失败、重试、取消、checkpoint/resume 和重复投递均有确定行为。
- 收集结果具有声明的排序或关联方式，不依赖实际完成顺序。
- Visualizer 能区分静态图边和动态实例分支；静态图投影不会伪造运行时才产生的边。

### P2-3 Join 分阶段等待窗口

**进入条件**：真实长流程需要区分首次到达时间和相邻来源到达间隔，且基础 Join 总 timeout 无法满足 SLA。

**验收标准**：沿用 [Join 等待超时 RFC](ogsystem-wait-timeout-semantics-v2.md) 收敛 `first_packet`、`gap`、timeout failure envelope、WAL/resume、去重和审计合同；旧图行为保持兼容；任何 timeout 决定在恢复时最多应用一次。

## 6. Deferred：明确暂不建设

- 在无需求和基准前，不增加物理并发 scheduler、背压控制面或分布式队列。
- 在无集合逐项处理场景前，不增加 `map_fanout` 图语义。
- 不把 `parallel_split` 重新解释为自动任务拆分、独占路径选择或物理并发承诺。
- 不在条件路由中允许任意代码执行、隐式网络访问或不受约束的业务状态读取。
- 不为追求 LangGraph API 一致而复制后端专属对象或状态约定。

## 7. 推进顺序与完成定义

1. 完成 P1-4 的术语文案收口，并把 P1-1 的条件配置范围与 Semantic IR 合同对齐。
2. 通过 P1-2 的应用内 Join UAT，记录未通过的投影和交互问题。
3. 补齐 P1-3 adapter contract tests，作为后续语义改动的回归门槛。
4. 每个 P2 项只有在进入条件满足、设计约束评审通过并具备对应基准或场景后才转为 active。
5. 每项完成后更新本文件状态、对应权威语义文档和测试入口；实现代码、测试与用户可见说明一起交付。

一项工作仅在所有验收条目通过、文档与实现一致、失败路径可恢复或有明确终态、且 `git diff --check` 通过后标记完成。测试结果和未覆盖的风险必须附在对应任务记录中。

## 8. 落地记录

### 2026-09-30

| 项目 | 状态 | 本轮落地与验证 | 剩余验收 |
| --- | --- | --- | --- |
| P1-1 条件路由 | 部分落地 | Studio Flow 表单可编辑封闭形状的受限条件 AST 和非负优先级；服务端校验拒绝额外字段、非标量 literal 和错误参数数目，保存后重载与图边摘要一致。浏览器 UAT 验证保存、重载、图边摘要、非法 AST/Revert 及清空条件删除 route。Runtime 持久化成功选择、无匹配及歧义的 `route_decision` 事件；记录候选 flow、优先级和布尔结果，不写入比较值。 | 还需用完整真实 Runtime/Operate 浏览器 run 完成 success、no-match、ambiguity 的应用内 UAT（当前由 planner、Conversation projector/renderer 单测覆盖）；条件计算错误分支需确认错误码在 Run/Trace 可检索。 |
| P1-2 Join 可观察性 | 部分落地 | GraphViewModel 从持久化 Join scope 投影多实例 scope id、mode/threshold、状态、预期/到达/缺失来源、等待秒数、deadline 与 timeout action；Conversation 投影 scope/mode/threshold/timeout。来源失败与 timeout 现在使用互斥的 `join_source_failed`/`join_timed_out` 事件，fail envelope 分别为 `GRAPH_JOIN_SOURCE_FAILED`/`GRAPH_JOIN_TIMEOUT`，并投影 `failed`/`timed_out` 状态。角色摘要和图诊断卡呈现多 scope 细节。多实例投影、quorum 阈值、正常/激活/来源失败状态和渲染有回归覆盖；Studio 浏览器 UAT 覆盖 all/quorum source gating、阈值保存和重载。 | 尚未完成浏览器内正常等待、quorum 激活、来源失败、超时、恢复和迟到来源的应用流程 UAT；运行集成测试还需统一核验持久化事件的审计原因及脱敏。 |
| P1-3 Adapter 合同 | 部分验证 | 既有 adapter contract、Semantic IR、runtime integration 覆盖均保留；新增条件路由决策 golden 与 fail-closed/no-match/ambiguity 测试；全量 Node 套件覆盖重复、迟到、取消、CAS 冲突与 checkpoint replay 已有独立测试。 | 仍需把清单所列语义汇成统一规范 fixture/conformance 矩阵；需完成规范化完整审计轨迹 golden 与适配器映射的跨语义合同断言。 |
| P1-4 术语文案 | 已完成 | Studio 设置、CLI help、NL2MMD 语义识别和模板及活跃语义文档均将 `parallel_split` 解释为激活静态普通下游分支，并区分动态任务拆分与物理并发；NL2MMD 文档明确 `fanout_fanin` 是模板名，不是操作符。 | 无。 |

**2026-09-30 后续验证**：完整 `pnpm test` 通过 568 项；严格条件 AST 边界及 Join/Conversation 定向测试通过。浏览器 UAT 通过 13 项、按设计跳过 1 项部署 URL 检查；覆盖桌面与移动布局、条件路由非法输入/保存/重载/清除、Join 来源映射门槛与 quorum 阈值保存/重载。初次运行遇到 Chromium 禁用端口 `6566`，测试改为重抽浏览器可用端口后全过。实际 Runtime/Operate 路由决策与 Join 生命周期 UAT、统一 conformance fixture 仍是未完成验收项。
