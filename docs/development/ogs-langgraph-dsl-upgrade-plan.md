# OGS 工作流 DSL 升级计划

状态：开发测试版路线图；阶段 0–1 与阶段 2 核心语义已落地并验证，阶段 2 的分阶段等待及阶段 3–5 仍按需推进（不承诺历史接口兼容）

本文定义 OGSystem（OGS）向更完整工作流 DSL 演进的方向、边界和实施顺序。它不是 LangGraph 的功能清单，也不把 OGS 定义为 LangGraph 的语法子集。

## 1. 结论与定位

OGS 应定位为后端中立、可编译、可校验、可视化、可恢复和可审计的工作流编排 DSL。

```text
OGS       = 业务编排语义和稳定的执行合同
LangGraph = 当前默认的图执行后端
OpenCode  = 当前默认的角色执行器
```

LangGraph 负责实现调度和状态推进，但不定义 OGS 的公共语义。未来可以在不改变 OGS 语义的情况下评估其他执行后端。这与 [`DECISIONS.md`](./DECISIONS.md) 及运行时存储/引擎解耦路线保持一致。

OGS 不试图把任意 Python、JavaScript 或 LangGraph 内部对象塞进配置。无法用声明式语义表达的能力，必须通过版本化、可审计、权限受限的扩展点接入。

本文面向当前开发测试版本。可以直接升级 DSL、IR、运行时和存储合同，不需要保留历史接口、旧字段或旧运行迁移路径。每次开发测试版本仍必须记录规范版本和构建 digest，以保证同一版本内可重现。

“标准化”表示采用明确的 OGS 规范，并尽可能复用成熟标准；它不表示 OGS 已获得 BPMN、CEL、CloudEvents 等标准的认证或完全互操作。

## 2. 设计原则

### 2.1 语义归 OGS，执行归适配器

OGS 拥有：

- 角色责任席位、流程边和边界；
- 路由、循环、并发、Join、错误和审核语义；
- 业务状态合同、事件 Payload 合同和数据投影；
- 版本、恢复、审计和运行态投影。

执行后端拥有：

- 调度器如何推进节点；
- 后端如何实现异步等待、checkpoint 和恢复；
- 后端内部的 reducer 或图对象。

后端不得重新解释 OGS 的业务语义，也不得绕过 OGS 的合同校验。

### 2.2 责任席位不是运行实例

一个 role 是流程中的责任席位（responsibility seat），不是一次执行实例。一次运行中，同一席位可以：

- 被多个 branch 激活；
- 因循环执行多次；
- 在不同 `lineageId` 下同时运行；
- 汇总多个 Join 来源；
- 产生多个 `RoleExecutionRecord`。

静态结构、运行实例和可视化投影必须保持可区分：

```text
ResponsibilityGraph  -> seats / transitions / boundaries
ExecutionOverlay     -> branch / lineage / execution aggregation
LayoutProjection     -> rank / coordinates / route channels
```

#### 2.2.1 角色、实现资产和控制面身份不得混用

本计划中的 `Role` 指 **Responsibility Role（责任角色）**：在一个 System 中稳定存在、通过
`roleId` 标识的抽象职责。`Responsibility Seat` 是该职责在责任图中的静态位置。它们均不表示具体
人员、账号、模型、服务实例、BPMN gateway/event 或一次运行。

`Role Package`（prompt、manifest、I/O schema）是职责的版本化实现资产，不能替代角色身份；
`branchId`、`lineageId` 和 `RoleExecutionRecord` 是运行事实，不能反向成为静态节点。审核和控制操作中
记录的 `actor` 仅表示外部 **control-plane principal**，不参与责任图或运行路由。

递归关系的目标语义是“一个责任角色对嵌套 System 的定义范围负责”，而不是行政汇报、具体人员任命或
权限自动继承。当前 `SubgraphSpec` 仅具备独立子图描述，尚未冻结 `ownerRoleId -> nestedSystem` 的执行
合同；在该合同和测试完成前，不得将可执行递归责任组合描述为已实现能力。

### 2.3 语义 fan-out 不承诺物理并发

`parallel_split` 表示创建多个下游分支，不表示后端一定并行执行。物理并发是执行策略，必须独立于流程语义建模。

### 2.4 失败关闭和可重复构建优先

不确定的事件、条件、合同、Join 来源、版本或恢复数据不得被猜测修复。规范输入、编译器版本和依赖摘要必须产生稳定 digest；开发测试版本发现不一致时直接拒绝构建或恢复，不提供历史迁移兜底。

## 3. 标准依据和采用边界

OGS 采用“规范优先、标准承载、显式边界”的策略：

| 领域 | 采用/对齐依据 | OGS 责任 |
| --- | --- | --- |
| 工作流概念 | BPMN 2.0 概念 / ISO/IEC 19510:2013 对齐的任务、网关、人工任务、错误边界语义 | 定义责任席位、branch、lineage 和 OGS 特有运行聚合 |
| 数据合同 | JSON Schema Draft 2020-12 | 定义状态、事件和 flow contract 的绑定、版本和脱敏策略 |
| 条件表达式 | CEL 的确定性、无副作用模型；必要时参考 FEEL/CEL 类型规则 | 定义 OGS 允许的字段白名单和 AST 子集 |
| 事件 | CloudEvents 1.0 的上下文属性模型 | 定义 OGS 事件 Payload、路由和审计字段 |
| 追踪 | OpenTelemetry Traces、W3C Trace Context | 定义 run/branch/role/execution 的 span 映射 |
| 工具接口 | OpenAPI 3.1；MCP 作为可选工具接入协议 | 定义权限、超时、幂等和输出合同 |
| 执行后端 | LangGraph 当前实现 | 通过 Engine Adapter 消费 OGS IR，不反向定义 DSL |

采用标准不等于自动获得互操作性。任何对外导入/导出格式都必须有 conformance test、字段映射和版本声明；无法保证语义等价时应拒绝导出，而不是静默降级。

标准选择的约束：

- JSON Schema 用于结构校验，不承担 reducer、路由优先级或业务授权；
- CEL/FEEL 只借鉴表达式模型，OGS 条件仍必须编译为受限 AST；
- CloudEvents 只约束事件包络，不替代 OGS 的事件状态机；
- OpenTelemetry 是观测投影，不是运行时事实来源；
- BPMN 对齐概念，不要求 Mermaid 或 OGS 文件成为 BPMN XML 的语法别名。

本文使用以下规范性措辞：`必须`（MUST）表示编译器或运行时必须拒绝违反项；`应`（SHOULD）表示默认实现要求，若偏离必须有设计记录；`可以`（MAY）表示可选能力。每项 MUST 都应有正向和反向测试，以及至少一个失败诊断样例。

## 4. 当前基线

当前仓库已经具备一部分目标基础，不应重复建设：

| 能力 | 当前实现/边界 | 本计划中的工作 |
| --- | --- | --- |
| 图语义 | `SystemDefinition`、`ExecutionPlan` | 稳定公共 IR 和版本化合同 |
| 角色绑定 | model/profile/noop 绑定 | 增加模式和能力校验 |
| 分支 | `BranchRecord`、`branchId`、`lineageId` | 明确 DSL 语义和过滤规则 |
| 循环 | `loop.max.<roleId>` | 增加业务 Loop Scope |
| fan-out / Join | `parallel_split`、`all_of`、`quorum_of`、基础 timeout policy | 分阶段 `first_packet/gap` 等待及更复杂资源治理 |
| flow contract | JSON Schema 的 flow/role input 合同 | 统一事件 Payload 和状态合同 |
| 错误 | error envelope、错误流和恢复路径 | 声明式 retry/fallback/pause 策略 |
| 人工审核 | interrupt/resume、review history | 统一任务合同和版本行为 |
| 持久化 | `state.json`、checkpoint、events | 当前版本快照、幂等和恢复边界 |
| 运行后端 | `LangGraphEngineAdapter` 已提供首个适配器实现；OGS runtime 保留路由、合同、恢复和审计职责 | 完善 adapter contract tests，并验证其他后端的可替换性 |
| 可视化 | GraphViewModel 和运行 overlay | 责任席位 IR、语义布局和图谱交互 |

当前的 `role.mode.*` 是 OGS 图路由模式元数据，不等同于本文第 8 节的执行角色模式；两者必须使用不同的命名空间。

## 5. DSL 文件和加载模型

### 5.1 分层文件

短期保留 Mermaid 作为拓扑输入，结构化语义放到独立文件：

```text
system.mmd                 # 角色关系、拓扑和边标签
.ogs/semantics.yaml        # 状态、循环、路由、审核和策略
.ogs/contracts/*.json      # JSON Schema 合同
.ogs/models.yaml           # 模型和执行绑定
.ogs/laws.yaml             # 全局安全、资源和能力限制
```

每个文件必须包含版本，并在编译时生成一个不可变的规范快照。快照记录源文件摘要、编译器版本和解析结果；运行恢复不得依赖运行时重新读取当前工作目录中的未版本化文件。开发测试版本只恢复同一规范版本和兼容的构建 digest。

长期可以提供单文件 DSL，但单文件和多文件形式必须编译到同一个 `SystemDefinition`/`ExecutionPlan` IR。

### 5.2 引用和冲突规则

- 角色、边、合同、模型和策略引用不存在时编译失败；
- 同一语义的多个来源必须有明确优先级，禁止静默覆盖；
- Mermaid 拓扑是角色和 flow 的来源，语义文件不能凭空创建隐式边；
- `join.sources` 必须与声明的入边一致，除非规范明确支持受控的虚拟来源；
- 所有规范文件必须使用同一个 system id/version；
- 编译输出必须包含规范化排序，保证 digest 稳定。

## 6. 统一中间表示（IR）

编译链路应保持以下边界：

```text
DSL sources
  -> Syntax AST
  -> ResponsibilityGraph
  -> Semantic IR
  -> ExecutionPlan
  -> Engine Adapter
  -> Runtime Snapshot / Projections
```

Semantic IR v1 必须冻结为编译器和适配器之间的唯一合同。以下是最小字段约束：

```ts
type ResponsibilitySeat = {
  roleId: string;                 // non-empty, unique within system
  packageRef?: string;             // immutable package identity
  binding: RoleBinding;
  modes: Record<string, RoleMode>; // default: { default: ... }
};

type Transition = {
  flowId: string;
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
  condition?: ConditionAst;        // absent means event-only routing
  channel: "normal" | "error" | "loop" | "join";
  priority: number;                // integer >= 0, default: 0
};

type JoinScopeKey = {
  runId: string;
  joinRoleId: string;
  lineageId: string;
  loopId?: string;
  loopIteration: number;
};

type LoopScope = {
  loopId: string;
  members: string[];               // non-empty, unique role ids
  boundaryRoleId: string;
  counterField: string;
  maxRounds: number;               // integer > 0
  maxRoleActivationsByRoleId?: Record<string, number>; // optional per-role guard, integer > 0
  onExhausted: string;
};

type JoinSpec = {
  roleId: string;
  mode: "all_of" | "quorum_of";
  sources: string[];               // non-empty, unique role ids
  min: number;                     // all_of: sources.length; quorum_of: 1..sources.length
  key: "run+role+lineage+loop";
  duplicateArrival: "ignore";
  lateArrival: "ignore";
  failurePolicy: "wait" | "fail" | "quorum_continue";
  timeoutSeconds: number;          // integer > 0; required when failurePolicy=wait
  onTimeout: "fail" | "quorum_continue" | "pause" | "terminate";
};

type CapabilityPolicy = {
  maxTransitionsPerRun: number;    // integer > 0; effective global ceiling
  maxRoleActivationsByRoleId?: Record<string, number>; // optional global ceiling
  allowedToolsByRoleId: Record<string, string[]>;
};

type ConditionAst =
  | { op: "equals" | "in" | "greater_than" | "less_than"; args: [ValueRef, ValueRef] }
  | { op: "exists"; args: [ValueRef] }
  | { op: "not"; args: [ConditionAst] }
  | { op: "all" | "any"; args: ConditionAst[] };

type SemanticIR = {
  version: 1;
  system: SystemMetadata;
  seats: ResponsibilitySeat[];     // sorted by roleId
  transitions: Transition[];       // sorted by flowId
  stateSchema: StateSchemaRef;     // required in v1
  loops: LoopScope[];
  joins: JoinSpec[];
  contracts: ContractRef[];
  capabilities: CapabilityPolicy;
  defaults: {
    routePriority: 0;
    loopIteration: 0;
    joinDuplicateArrival: "ignore";
    joinTimeoutSeconds: 3600;
  };
};
```

IR 编译失败必须使用稳定错误码，至少包括 `IR_DUPLICATE_ROLE`、`IR_UNKNOWN_REFERENCE`、`IR_ROUTE_AMBIGUOUS`、`IR_INVALID_CONDITION`、`IR_JOIN_SCOPE_INVALID`、`IR_JOIN_TIMEOUT_INVALID`、`IR_LOOP_UNBOUNDED`、`IR_BUDGET_INVALID` 和 `IR_CONTRACT_INVALID`。字段名称可以调整，但必须满足：业务结构、执行聚合和布局数据不互相冒充。`GraphViewModel` 是面向渲染的投影，不应成为新的语义真相源。

未来的递归组合不应把 `System` 塞入普通 role payload。它必须使用独立、版本化的组合合同，例如：

```ts
type CompositeResponsibilitySpec = {
  ownerRoleId: string;             // parent System 中的 Responsibility Role
  nestedSystemRef: string;         // immutable, versioned System reference
  inputContract: ContractRef;
  outputContract: ContractRef;
  stateNamespace: string;
  checkpointNamespace: string;
  errorPropagation: "fail" | "route" | "contain";
  terminationPropagation: "propagate" | "contain";
};
```

该合同必须拒绝组合环、未知 owner/ref、命名空间冲突和未声明的跨 System 数据访问。它不引入人员、团队、
组织树或具体执行者身份；这些均位于 OGS 核心外部的可选治理集成。

预算归属固定为：`maxRounds` 是 Loop Scope 的业务预算；`maxRoleActivationsByRoleId` 是 Loop Scope 内的节点保护预算，并可由 CapabilityPolicy 设置更低的全局上限；`maxTransitionsPerRun` 是 CapabilityPolicy 的全局运行预算。Law 可以对 CapabilityPolicy 施加上限，但编译后的 Semantic IR 必须保存最终生效值。

## 7. State Schema 和 Reducer

OGS 需要显式的业务状态合同，不能只依赖角色返回的任意 JSON。状态合同至少定义：

- 字段类型、默认值和是否必需；
- 字段所有者和可写角色；
- 规范版本、默认值和一致性规则；
- 更新策略；
- 是否允许出现在角色输入、事件 Payload 或审计中。

建议支持以下受限 reducer：

```text
replace、merge、append、increment、max、set-once
```

Reducer 必须是纯的、确定的、可测试的。不要把内部运行状态（branch、锁、session、checkpoint 元数据）暴露为普通业务字段。

示例（仅用于说明业务方如何声明自有字段；`debate_round` 不是 OGS 内置字段）：

```yaml
version: "2"
state:
  schema: contracts/debate-state.json
  reducers:
    proposal: replace
    opinions: append
    votes: merge
    debate_round: max
```

状态更新应作为一个可审计的原子操作：验证候选更新，应用 reducer，写入版本化快照，再进行后续路由判断。

状态合同必须同时声明 `schemaVersion`、字段默认值、可写角色和 reducer；运行时状态至少携带单调递增的 `stateVersion`。一次提交必须包含唯一 `eventId` 和 `expectedStateVersion`，并满足以下任一条件：

- `expectedStateVersion` 与持久化版本一致后原子提交（CAS）；或
- 已处理的 `eventId` 被幂等识别并返回原提交结果。

版本冲突、重复事件和 reducer 冲突都必须拒绝或按显式策略处理，不能静默覆盖。

## 8. 角色模式

固定责任席位可以有多个经过编译的执行模式。模式不是新节点，也不是新的角色身份：

```yaml
roles:
  debate_a:
    package: debate-a
    modes:
      normal_debate:
        input_contract: contracts/debate-input.json
        output_contract: contracts/debate-output.json
        events: [CONTINUE_DEBATE, CONSENSUS_REACHED]
      judge_feedback:
        input_contract: contracts/judge-feedback-input.json
        output_contract: contracts/judge-feedback-output.json
        events: [FEEDBACK_RECORDED]
```

运行时输入应显式携带 `roleId`、`mode` 和允许事件。模式选择必须来自已声明的路由/运行状态，不得由提示词自行改变。

反馈是已有责任席位之间的事件流，不是默认的责任席位类型：例如 A 向 B 反馈时，应建模为
`A --|FEEDBACK|--> B`，由 A 产生事件及其 Payload、由 B 按自身模式消费并继续执行。不得为了表示反馈
新增 `a-feedback`、`b-feedback` 或其他仅承担“反馈动作”的节点；只有当反馈由独立主体负责，且该主体具有
独立输入/输出合同、权限或审计责任时，才可以建立独立责任席位。

## 9. 条件路由

事件是角色提出的候选事实，最终是否允许转移由运行时根据合同和条件决定：

```text
角色输出事件和 Payload
  -> 校验事件名称和 Payload
  -> 计算候选状态更新
  -> 校验并应用 reducer
  -> 在新状态上求值条件
  -> 解析唯一的可用路由
  -> 激活分支并写审计
```

条件必须编译为受限 AST，而不是执行任意 Python/JavaScript。初始操作集：

```text
equals、not、all、any、in、greater_than、less_than、exists
```

表达式只能访问白名单：`state.*`、`loop.*`、`event`、`role`。禁止函数调用、文件、网络、环境变量和动态属性访问。

必须定义：

- 多个条件同时满足时的优先级；
- 没有路由满足时的错误；
- 多条同优先级路由满足时的歧义错误；
- 条件求值异常的 fail-closed 行为；
- 条件与状态更新的同一版本边界。

所有 flow 都按新规范编译；没有 `when` 的 flow 使用明确的默认事件路由规则。未知事件和路由歧义直接失败，不提供历史行为兜底。

## 10. Loop Scope

`loop.max.<roleId>` 只限制某个角色的激活次数，不能表达完整业务回合。新增 Loop Scope。`counter` 仅引用业务方在自身 State Schema 中声明的字段，OGS 不预置 `round`、`debate_round` 或其他领域字段：

```yaml
loops:
  debate:
    members: [debate_a, debate_b]
    boundary: debate_b
    counter: debate_round
    max_rounds: 3
    on_exhausted: debate_judge
```

三种预算必须分开：

```text
max_rounds              业务循环约束
max_role_activations    单席位异常保护
max_transitions         全局资源保护
```

Loop Scope 必须明确其作用域键。持久化计数的身份是 `runId + lineageId + loopId`；当前 GraphState 在单个 run 内以 `lineageId::loopId` 保存该计数，`loopIteration` 是该 scope 的回合投影。不得跨 lineage 或跨独立 Loop Scope 合并计数。每次回合开始、递增、耗尽和拒绝都要写审计。

## 11. 事件和 Payload 合同

事件从普通字符串升级为结构化合同：

```yaml
events:
  CONSENSUS_REACHED:
    payload:
      schema: contracts/consensus-reached.json
  CONTINUE_DEBATE:
    payload:
      schema: contracts/continue-debate.json
```

事件处理必须校验：

1. 事件是否由当前模式声明；
2. Payload 是否符合 Schema；
3. 是否允许更新目标状态字段；
4. 是否存在唯一可用路由。

事件记录至少包含 `runId`、`roleId`、`executionId`、`branchId`、`lineageId`、`loopIteration`、`eventType` 和 Payload digest。完整 Payload 是否持久化由脱敏和保留策略决定。

## 12. 并发与 Join

OGS 继续支持 fan-out/fan-in：

```yaml
joins:
  debate_judge:
    mode: all_of
    sources: [debate_a, debate_b]
    timeoutSeconds: 3600
    onTimeout: fail
  quorum_judge:
    mode: quorum_of
    sources: [reviewer_a, reviewer_b, reviewer_c]
    min: 2
    timeoutSeconds: 3600
    onTimeout: quorum_continue
```

必须规定以下情形：

- 同一来源重复到达；
- late arrival；
- 分支失败或被取消；
- Join 超时；
- 同一来源在不同 `lineageId` 或 `loopIteration` 到达；
- Join 状态合并冲突；
- quorum 已满足后其他来源的处理。

Join `timeoutSeconds` 必须为正整数；`failurePolicy: wait` 只表示在超时前等待，不能表示无限等待。达到超时后必须执行 `onTimeout`，并记录 expected/ready/missing sources、超时时刻和最终动作。`onTimeout: quorum_continue` 只允许声明在 `quorum_of` Join 上；运行时若尚未达到 `min`，必须转为 `fail` 或按显式的 `failurePolicy` 处理，不能强行继续。

上述是当前已实现的基础 Join 超时合同。`join.first_packet.*`、`join.gap.*` 等分阶段等待窗口仍属于 [RFC](./ogsystem-wait-timeout-semantics-v2.md)，不应在当前 DSL 或产品能力说明中标记为已实现。

Join readiness 默认以结构化 `JoinScopeKey` 判定，而不是以目标节点当前分支数量判定：

```text
JoinScopeKey = {
  runId,
  joinRoleId,
  lineageId,
  loopId?,
  loopIteration
}
```

`joinId` 是面向审计和 UI 的稳定显示标识（例如 `joinRoleId#lineageId#loopIteration`）；readiness key 是内部结构化键，二者不得混用。`joinId` 在一个 run 内必须唯一且不依赖节点数量。实现必须保证 `sourceRoleId` 是 readiness 集合中的独立维度，同一来源重复到达只保留第一次有效 arrival。Join 激活、等待、达标和过期必须可查询、可恢复、可审计。

Loop counter 必须按 `runId + lineageId + loopId` 维护，不能只按 roleId 维护全局计数。`loopIteration` 是该 scope 内的业务回合序号；角色激活次数另行按 `runId + lineageId + roleId` 统计。GraphState 中保留的 `loopIterations[roleId]` 只能作为兼容性的角色投影，不能作为 Loop Scope 或 Join readiness 的权威计数。

## 13. 错误、重试、取消和超时

错误策略应独立于普通业务事件。以下是未来声明式错误策略的形状示例，不是当前 Mermaid DSL 的可直接配置合同；当前已实现的错误路由仍使用 Mermaid `ERROR` / `ERROR.<errorCode>` 边，并受 `runtime.error_flows.v1` 控制：

```yaml
errors:
  debate_a:
    retry:
      max_attempts: 2
      backoff: exponential
    routes:
      INVALID_OUTPUT: debate_a
      MODEL_TIMEOUT: human_finalizer
      default: human_finalizer
```

策略至少区分：

```text
retry、fallback、compensate、pause、human_review、fail
```

还必须统一区分：

```text
暂停 pause       保留运行并等待外部动作
取消 cancel      请求停止尚未完成的工作
终止 terminate   强制结束并记录结果
失败 fail        运行因不可恢复错误结束
超时 timeout     一种可被策略处理的原因
```

重试默认采用 at-least-once 语义。工具调用必须接收稳定的幂等键，不能假设 exactly-once。重试、恢复和补偿动作都必须写入审计，包含 attempt、原因、策略和结果。

节点、Loop Scope 和整个 run 可以有不同超时预算；预算继承和覆盖规则必须在编译期确定。

错误处理顺序必须固定为：

```text
executor attempt
  -> executor transport retry（仅处理执行器瞬时故障）
  -> 节点级 retry policy（按 attempt 和幂等键重试）
  -> OGS ERROR.<code> 精确错误边
  -> OGS ERROR 通用错误边
  -> 声明的 fallback/compensate/human_review
  -> run fail
```

`ERROR` 和 `ERROR.<code>` 只由运行时失败触发，不能由角色成功输出伪造。精确错误边优先于通用 `ERROR`；没有错误边时直接 fail-stop。该规则与 [`DECISIONS.md`](./DECISIONS.md) 的异常边界一致，并继续受 `error_flows.v1` feature flag 控制。

每次 attempt 都必须生成稳定的 `attemptId` 和幂等键（至少包含 run、lineage、role、execution 和 attempt），并在 retry、错误边、取消或最终失败时写入审计。取消请求不得被 retry 重新激活；已经提交的幂等事件必须在恢复时可识别。

## 14. 人工审核

人工审核是运行时一等语义：

```yaml
reviews:
  final_review:
    seat: human_finalizer
    required: true
    timeout: 86400
    timeout_action: pause
    terminate_scope: run
    decisions: [approve, rework, pause, terminate]
    rework:
      target: human_finalizer
      max: 2
```

审核规范使用 OGS runtime control plane 的小写规范值：`approve`、`rework`、`pause`、`terminate`。外部 API 或 UI 可以显示大写/本地化文案，但必须在边界层映射回规范值。`timeout_action` 只允许 `pause` 或 `terminate`，`terminate_scope` 只允许 `branch` 或 `run`。

审核请求必须绑定运行版本、branch、lineage 和输入快照，并持久化审核人、决定、意见、时间、重做目标和状态。人工审核不是普通角色节点；`seat` 仅表示责任归属，实际动作由 runtime control plane 执行。`interrupt/resume` 的恢复必须验证审核请求属于当前规范版本、当前状态版本和原始 branch/lineage。

## 15. 能力、模型、工具和扩展

模型、工具、角色和策略分层管理：

```yaml
models:
  strong_reasoning:
    provider: openai
    model: gpt-5.6-luna
    variant: high

roles:
  debate_judge:
    model: strong_reasoning
    tools: []

policies:
  debate_a:
    allowed_tools: []
    max_output_tokens: 12000
    timeout: 300
```

编译期应发现无效模型、无效工具、权限冲突、资源超限和模式能力不匹配。动态拓扑默认禁止；需要动态能力时，必须使用版本化、白名单化、可审计的插件声明。

### 15.1 安全和治理

按最小权限和默认拒绝原则处理模型、工具、文件和网络能力：

- DSL、日志和事件 Payload 不得承载明文密钥；敏感值只能引用受控 secret provider；
- 工具调用必须经过角色/模式/法律策略三层授权，并设置超时、输出大小和资源预算；
- 执行工作区、运行 artifact 和外部目标目录必须有明确隔离边界；
- 审计日志需要脱敏、完整性保护和可配置保留期；
- 外部输入、模型输出和工具结果都视为不可信数据，必须经过 Schema 和大小校验；
- 插件必须固定版本、来源和权限清单，构建时记录依赖摘要；
- 取消、终止和人工审核动作必须鉴权、幂等并留下操作者审计。

## 16. 子图、复合责任和模板

子图必须是可独立编译、可版本化和可校验的语义单元：

```yaml
subgraphs:
  solution_debate:
    source: graphs/solution-debate.mmd
    inputs: [question]
    outputs: [final_solution]
```

需要定义子图的输入/输出合同、状态命名空间、错误传播、Join/Loop 边界、checkpoint 命名空间和当前规范版本行为。若子图由一个责任角色组合和负责，还必须使用第 6 节的
`CompositeResponsibilitySpec` 显式声明 owner、嵌套 System 引用以及错误/终止传播；禁止由目录结构、角色
名称或视觉嵌套猜测父子关系。

模板只是生成规范输入的工具，不能绕过编译校验。`SubgraphSpec` 和复合责任组合是未来运行时能力；当前实现
不应把独立子图描述误称为已可执行的递归 Role。

## 17. 编译器与适配器

编译器建议拆为以下阶段：

```text
1. Syntax Parser
2. Graph Normalizer
3. State/Contract Compiler
4. Condition Compiler
5. Loop Analyzer
6. Join/Route Analyzer
7. Capability Validator
8. Specification Version and Dependency Validator
9. ExecutionPlan Generator
10. Runtime Snapshot Generator
```

至少检查：

- 角色、边、合同和绑定是否存在；
- 事件是否重复、未声明或冲突；
- 条件字段和类型是否正确；
- Loop 是否有预算且边界可达；
- Join source 是否与拓扑一致；
- Payload 和状态更新是否符合 Schema；
- 审核是否存在可恢复路径；
- 错误路由是否形成无预算死循环；
- 模型、工具和策略是否有权限冲突；
- 规范版本、依赖版本和构建 digest 是否一致。

执行引擎必须通过显式适配器消费 `ExecutionPlan`：

```ts
export type EngineRunInput = {
  plan: ExecutionPlan;
  initialState?: GraphState;
  prompt: string;
  runtimeServices: RuntimeExecutionServices;
};

export interface ExecutionEngineAdapter {
  readonly engineId: string;
  run(input: EngineRunInput): Promise<AdapterRunResult>;
}
```

`RuntimeExecutionServices` 必须是显式的 OGS-owned port 集合，而不是未定义的 service bag：

```ts
type RuntimeExecutionServices = {
  stateStore: {
    load(runId: string): Promise<VersionedStateSnapshot | undefined>;
    commit(args: { runId: string; expectedStateVersion: number; eventId: string; idempotencyKey: string; checkpointSequence?: number; update: GraphStateUpdate }): Promise<{ status: "accepted" | "duplicate"; snapshot: VersionedStateSnapshot; resultDigest: string }>;
  };
  checkpointStore: {
    append(record: RuntimeCheckpointRecord): Promise<void>;
    list(runId: string): Promise<RuntimeCheckpointRecord[]>;
  };
  audit: { append(event: AuditRecord): Promise<void> };
};
```

`stateStore.commit` 必须将状态 CAS、`eventId`/`idempotencyKey` 去重和结果记录作为单次原子操作，并处于同一事务或等价的线性化存储边界。禁止以 `seen()` 后调用 `record()` 的两个步骤实现幂等；并发重复事件必须最多有一个 accepted 提交，duplicate 必须返回原提交结果摘要。

职责边界固定如下：

- OGS runtime 负责状态合同、CAS/幂等、Join/Loop、错误策略、审核控制、审计和恢复判定；
- Persistence ports 负责原子存储、顺序保证和 lease，不解释业务路由；
- Engine Adapter 负责把 `ExecutionPlan` 映射到后端调度，并把后端 checkpoint/interrupt 事件转译为 OGS 事件；
- Engine Adapter 不得自行提交业务状态、绕过幂等记录或决定错误边优先级；
- executor 负责一次 attempt 的外部调用，节点 retry 和 ERROR 路由由 OGS runtime 统一编排。

第一实现可以是 `LangGraphEngineAdapter`。在实现映射前，必须先通过 adapter contract tests：确定性路由、重复事件、CAS 冲突、checkpoint 重放、interrupt/resume、取消和错误优先级均必须在不依赖真实模型的测试中验证。

## 18. LangGraph 映射边界

以下映射只能作为实现指导，不是公共语义的一一对应：

| OGS | LangGraph 适配实现 |
| --- | --- |
| responsibility seat | graph node wrapper |
| transition | ordinary or conditional edge |
| state schema | adapter state annotation plus OGS validator |
| reducer | backend reducer wrapper, subject to OGS rules |
| Loop Scope | conditional edge plus OGS budget state |
| fan-out | multiple branch activations |
| Join | OGS barrier/readiness service, possibly represented by a node |
| human review | interrupt/resume integration |
| checkpoint | backend checkpoint plus OGS durable snapshot |
| retry | OGS policy around node execution |
| event | structured adapter output, not a native LangGraph contract |
| subgraph | compiled subgraph with explicit namespace and contracts |

LangGraph 的 reducer、recursion limit 或 checkpoint 行为不能替代 OGS 的业务预算、状态合同和恢复合同。

## 19. 版本、恢复和审计

每次运行必须记录：

```text
systemId / systemVersion
semantic IR digest
compiler version
role package versions
contract versions
model selection and policy digest
engineId / engine version
runtime version
dependency lockfile digest
execution policy digest
```

持久化状态必须不是无版本的 `Partial<GraphState>`。每个可恢复快照至少包含：

```ts
type VersionedStateSnapshot = {
  schemaVersion: number;
  stateVersion: number;
  lastEventId?: string;
  lastCheckpointSequence: number;
  graphState: GraphState;
  irDigest: string;
  runtimeDigest: string;
};
```

每个 checkpoint/update 必须携带 `eventId`、`expectedStateVersion`、`resultingStateVersion`、`idempotencyKey` 和 `irDigest`。恢复时必须校验 system/IR、compiler、engine、runtime、role packages、contracts、models/laws、依赖 lockfile 和执行策略 digest；任一不一致直接 fail-closed。开发测试版本不按当前 DSL 猜测执行，也不执行历史数据迁移。

运行审计建议采用以下层级：

```text
run -> branch -> lineage -> loop iteration -> role execution -> model/tool call
```

未来可以提供 OpenTelemetry 投影，但不能以引入追踪协议为前提改变核心语义。事件可以采用 CloudEvents 风格字段，但 OGS 仍需定义自己的事件合同和脱敏规则。

## 20. 可视化投影

可视化层应从统一语义图生成多个投影：

```text
责任图谱     seats / transitions / boundaries
运行追踪     active branches / completed executions / reviews
数据上下文   input projection / join sources / output lineage
```

本节定义的是 OGS 平台级能力，不绑定任何具体业务项目、角色名称、事件集合或领域流程。文中的 debate 示例仅用于说明 DSL 形状；实现必须对任意责任席位、模式、事件、循环和审核流程成立。

节点应明确显示责任席位，而不是暗示自己是 branch 实例。运行态显示实例数、完成次数、审核等待和当前 lineage；详情面板说明同一席位可在一次运行中被多次激活。

布局层应保留完整业务图，并将 `backEdge`、错误流、Join 流和循环流作为布局元数据，不通过修改语义图来适配 ELK.js。布局适配器需要对 fan-out、Join、cycle、error flow 和 multi-terminal 提供稳定性测试。

### 20.1 条件标签

每条条件路由必须在图谱中保留可读的语义标签，而不能只显示底层事件名。边的投影至少包括：

- `eventType`：角色提出的候选事件；
- `when`：经过安全格式化的条件摘要；
- `priority`：发生路由竞争时的显式优先级；
- `channel`：`normal`、`error`、`loop` 或 `join`；
- `fallback`：无条件满足时的默认处理（若已声明）。

条件标签必须从 Condition AST 生成，禁止把原始 YAML/代码字符串直接注入 DOM。标签过长时应提供稳定的折叠摘要和详情面板；折叠不得丢失完整条件、字段路径和操作符。

### 20.2 循环通道

Loop Scope 必须在图谱中以独立的循环通道表达，而不是依赖普通边的回折来猜测循环：

- 标记循环成员、边界节点、计数器和 `max_rounds`；
- 将返回边标记为 `backEdge`，使用稳定的返回 lane；
- 显示当前 `round`、剩余预算和耗尽后的 `on_exhausted` 目标；
- 区分业务回合、角色激活次数和全局 transition 预算；
- 循环边不得遮挡主流程节点或错误流。

循环通道的数据必须来自 Loop Scope 和运行 overlay。布局器不得通过删除循环边来获得拓扑排序。

### 20.3 角色模式显示

同一责任席位的多个执行模式应显示在同一席位节点内，避免把模式误画成重复角色：

```text
A / responsibility seat
  mode: review
  mode: judge_feedback
```

模式投影至少显示：当前模式、允许事件、输入/输出合同摘要和绑定执行方式。运行中发生模式切换时，节点保留席位身份，只更新 overlay；模式切换事件应可在时间线中定位。

### 20.4 人工审核边界

人工审核必须以明确的边界和任务状态表达：

- 在图谱上显示 `human task` 边界，不把人工审核伪装成普通模型角色；
- 标记进入审核的原因、审核决定集合、超时动作和重做目标；
- 显示规范状态 `pending`、`paused`、`resolved`、`expired`；其中 `expired` 仅能来自显式持久化决定，当前 runtime 不自动计时产生过期决定；
- 将 `interrupt`、`resume` 以及规范决定值 `approve`、`rework`、`pause`、`terminate` 映射为可追踪的语义转换；外部大写或本地化文案必须在边界层转换；
- 详情面板显示审核请求绑定的 run、branch、lineage、输入快照和审计事件。

审核边界必须从 ReviewSpec/Review IR 推导。UI 不得为了填充视觉结构虚构审核节点、审核人或决定路径。

### 20.5 运行 overlay

运行 overlay 是静态责任图之上的独立投影，不能修改责任图本身。至少支持：

- 按 `runId`、`branchId`、`lineageId` 和 `loopId` 过滤；
- 节点显示 active、completed、waiting review、failed 和 retrying 等聚合状态；
- 边显示最近激活、当前候选路由、被抑制或已失效状态；
- Join 节点显示 expected/ready/missing sources 和等待原因；
- 循环节点显示当前回合、角色激活次数和剩余预算；
- 通过时间线定位一次 execution，而不把 execution 复制成新的静态节点；
- overlay 缺少运行数据时显示 `unknown`，不得将缺失误报为 `idle` 或 `completed`。

overlay 的每个指标必须能回溯到运行状态或审计事件，并标注聚合口径（by-role、by-branch 或 by-lineage）。

### 20.6 主流程、异常流和阅读模式

图谱应支持面向理解的阅读模式：

- 主流程：显示普通业务流，弱化错误和循环返回；
- 异常流：突出错误、重试、补偿和人工接管路径；
- 循环流：突出 Loop Scope、回合边界和预算；
- Join 视图：突出来源、就绪状态和缺失来源；
- 全量视图：显示完整语义图，适合审计和编辑。

过滤只改变投影可见性，不改变语义图、运行状态或路由计算。当前焦点、路径、过滤器和视口应可以保存到 stable URL 状态中。

## 21. 开发测试版本策略

本计划针对开发测试版本，采用一次性升级，不承担历史接口、旧 DSL 文件或旧运行快照的迁移成本。

- 新版本可以直接替换 `SystemDefinition`、`ExecutionPlan`、`GraphState` 和存储合同；
- 不保留旧字段别名、旧解析分支或隐式兼容行为；
- 旧项目和旧运行不属于验收范围，发现旧格式时直接给出版本错误；
- 新 DSL、IR、编译器和运行时使用同一个显式规范版本；
- 运行只能恢复相同规范版本、相同 IR digest 和兼容依赖摘要的快照；
- 规范变更通过新的开发测试版本整体发布，不在运行时执行数据迁移；
- 即使没有历史兼容要求，仍必须保留当前版本内的确定性、幂等、审计和可重复构建能力。

## 22. 分阶段路线

### 阶段 0：规范和基线（已完成）

- 冻结责任席位、branch、lineage、execution 的术语；
- 记录当前 `SystemDefinition`、`ExecutionPlan` 和 `GraphState` 合同；
- 冻结 Semantic IR v1 的字段、默认值、错误码和版本规则；
- 定义 `JoinScopeKey`、Loop counter、stateVersion、eventId 和幂等键合同；
- 将 `maxRounds`、`maxRoleActivationsByRoleId` 和 `maxTransitionsPerRun` 固化到 IR 的 Loop/Capability 层，并定义 Law 上限合并规则；
- 冻结 Join `timeoutSeconds`、`onTimeout` 和 `failurePolicy` 的组合约束；
- 定义 engine/runtime/dependency digest 的组成和校验时机；
- 为通用图模式建立 golden IR、golden checkpoint、golden audit 和失败诊断 fixture；
- 阶段 0 的 IR schema、fixture 和 contract tests 通过后，才进入阶段 1。

### 阶段 1：语义基础（已完成）

- State Schema 和受限 Reducer；
- Event/Payload Schema；
- Condition AST、类型检查和歧义诊断；
- 新 DSL 到 IR 的规范化编译。

### 阶段 2：循环、路由和 Join（核心已完成）

- Loop Scope 和三层预算；
- 条件路由时序、优先级和 fail-closed；
- Join 重复到达、超时、失败和 lineage 隔离；
- `join.first_packet/gap` 分阶段等待超时仍为 RFC，不属于本阶段已交付范围；
- 运行态和审计投影。

### 阶段 3：可靠执行

- 声明式 retry、fallback、pause、cancel 和 timeout；
- 稳定幂等键和副作用策略；
- 人工审核合同和版本化 resume；
- Engine Adapter 合同硬化与后端可替换性验证（LangGraph 首个适配器已落地）。

### 阶段 4：复用和开发体验

- 子图和模板；
- Studio Inspector、条件/Schema 测试工具；
- 责任图谱、运行追踪和数据上下文三类视图；
- stable URL 的焦点、路径、过滤和视口状态。

### 阶段 5：生态和可观测性

- OpenTelemetry 投影；
- CloudEvents 风格事件导出；
- MCP/OpenAPI 工具合同；
- 第二执行后端的概念验证，验证 IR 的后端中立性。

## 23. 验收标准

每一阶段必须同时通过语义、运行和恢复测试：

- 同一 IR 在 LangGraph 适配器上结果确定；
- 未声明事件、条件歧义、合同错误和 Join 错配均 fail-closed；
- branch、lineage 和 loop iteration 不会跨作用域合并；
- Join readiness 使用结构化 `JoinScopeKey`，显示 `joinId` 与内部 readiness key 不混淆；
- 基础 Join `wait` 不会无限等待，超时后按 `onTimeout` 确定性收敛；分阶段 `first_packet/gap` 等待仍不在当前实现内；
- Loop counter 按 `runId + lineageId + loopId` 隔离，角色激活次数不污染业务回合数；
- 三类预算在 IR 中有唯一归属，最终生效值已包含 Law/CapabilityPolicy 约束；
- checkpoint 使用 stateVersion/CAS 或等价幂等事件保证，重复提交不会产生第二次状态副作用；
- 重试和恢复不会产生未审计的重复副作用；
- 新示例覆盖完整规范能力，并在版本不匹配时明确拒绝恢复；
- fan-out、Join、cycle、error flow、review 和 multi-terminal 均有回归测试；
- 可视化从语义 IR 推导，不创建未建模的节点或路径；
- 条件标签、循环通道、角色模式、人工审核边界和运行 overlay 在不依赖具体业务名称的通用 fixture 上通过投影合同测试；
- 图谱过滤只影响可见投影，不改变语义图、运行状态或路由结果；
- 编译结果和规范 digest 在重复构建中稳定；
- 条件 AST、reducer 和路由解析具有单元、属性/边界和恶意输入测试；
- Engine Adapter、Persistence 和外部工具边界具有合同测试，核心语义测试不依赖真实模型或网络；
- adapter contract tests 覆盖重复事件、CAS 冲突、checkpoint 重放、interrupt/resume、取消和 ERROR 优先级；
- 关键规范样例具有 golden IR、golden audit 和失败诊断快照；
- CI 在格式检查、类型检查、静态分析、依赖审计和完整测试通过后才允许合并。

## 24. 成熟度判断

当前 OGS 的图拓扑、基础事件流转、分支、Join（含基础超时策略）、责任角色输入合同、状态 reducer、条件路由、Loop Scope、人工审核和同版本恢复机制已有实现与测试覆盖。剩余事项主要是分阶段 Join 等待、人工审核自动过期、外部 signal、可配置执行重试、受控并发、复合责任/子图运行时和协议对接。

2026-09-03 审查收口：debate 示例的业务字段与 reducer 已统一，嵌套示例的生成控制面文件已隔离；`join.first_packet/gap` 继续保持 RFC，不作为当前实现承诺。

因此，OGS 当前应描述为：

```text
方向：符合工作流 DSL 的主流设计原则
核心：多角色协作流程所需语义已具备稳定运行时基础
规范：OGS 规范持续收敛，尚非行业标准
生产级完整性：单机核心闭环可用，复合责任/子图、长流程与资源治理能力按需补齐
```

推荐优先级为：

```text
1. 业务状态与 Event Payload 合同的具体化
2. 循环耗尽结果、失败/取消/重试和幂等治理
3. 按需实现 Human Review 自动过期、外部 signal 或分阶段 Join 等待
4. 受控并发、Engine Adapter 扩展和标准协议投影
```
