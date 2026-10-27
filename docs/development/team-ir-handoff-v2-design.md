# Team IR v2：以 Handoff 为核心的设计方案

状态：提议作为下一代架构基线
范围：下一代 Team 配置、编译和运行合同
兼容策略：不兼容旧配置，不迁移配置数据

## 1. 概述

Team IR v2 将 Agent 之间的 handoff 作为一等协作关系：

- **Agent** 声明职责、命名输入/输出端口和执行绑定引用。
- **Handoff** 声明交接双方、触发条件、数据映射和交付时限。
- **Orchestration** 控制路由、分支、并行分发、汇合、循环、人工审核、终止和错误处理。
- **Binding** 选择本地模型/工具或远程 A2A 端点及执行策略。

公开的 Team IR 是唯一的配置与发布格式。编译器将其编译成与引擎无关的执行计划，LangGraph
Adapter 执行该计划。LangGraph 是当前引擎实现，不是公开 DSL；A2A 是远程 Agent 的互操作协议，
不是本地工作流模型。

这是一次干净断代。旧 `SystemDesignDocument`、独立 Flow 合同 bundle、`context.map` 配置和
可执行 Mermaid 输入不再作为 v2 配置接受。已有 Studio 项目需要在 v2 中重新创建。本方案不把
`.ogs/runs/` 当作配置输入，不迁移、改写或删除其中的运行记录；新旧版本间的 Run 恢复兼容性不在
本配置设计的保证范围内。

## 2. 领域边界

| 概念 | 负责内容 | 不负责内容 |
| --- | --- | --- |
| Team | 稳定团队身份、版本、Agent、Handoff、编排策略 | 某次 Run 的实时状态 |
| Agent | 职责、端口合同、角色包引用 | 图路由或共享工作流状态 |
| 输入端口 | Agent 可接收的一种命名数据形状 | 工作流节点或独立 Agent |
| 输出端口 | Agent 可产出的一种命名结果/事件 | 任意目标的调用决策 |
| Handoff | 从发送端口向接收端口进行的一次有类型交付 | Join 就绪、循环计数、模型选择 |
| Orchestration | 入口分发、路由、Join、Loop、审核、错误路由、结束 | payload Schema 或执行器实现 |
| Binding | 后端、模型/工具/A2A 端点、执行限制和重试策略 | Team 拓扑或业务 payload 含义 |
| Run | 调用输入、检查点、分支、产物、审计和执行结果 | 可复用 Team 定义 |

Agent 是可复用的责任参与方。图上的节点不是合同；合同属于 Handoff 两端，包含发送方输出、
接收方输入以及两者之间的映射。

## 3. Team IR v2 规范模型

持久化文档使用根字段 `schemaVersion: 2`。Team 自身的业务版本与 IR Schema 版本分开管理。
画布坐标、缩放等展示状态不属于语义内容，不计入语义 digest。

```json
{
  "schemaVersion": 2,
  "team": { "id": "market-report", "version": "2.0.0" },
  "runInput": { "schema": { "$ref": "#/$defs/runInput" } },
  "agents": [
    {
      "id": "researcher",
      "packageRef": "role:researcher@1",
      "bindingRef": "binding:researcher",
      "inputPorts": {
        "default": { "dataSchema": { "$ref": "#/$defs/researchInput" } }
      },
      "outputPorts": {
        "RESEARCH_READY": { "dataSchema": { "$ref": "#/$defs/researchOutput" } }
      }
    },
    {
      "id": "writer",
      "packageRef": "role:writer@1",
      "bindingRef": "binding:writer",
      "inputPorts": {
        "draft": { "dataSchema": { "$ref": "#/$defs/draftInput" } },
        "revise": { "dataSchema": { "$ref": "#/$defs/reviseInput" } }
      },
      "outputPorts": {
        "DELIVERED": { "dataSchema": { "$ref": "#/$defs/reportOutput" } }
      }
    }
  ],
  "handoffs": [
    {
      "id": "run-to-researcher",
      "from": { "kind": "run" },
      "to": { "kind": "agent", "agentId": "researcher", "inputPort": "default" },
      "when": { "event": "START" },
      "map": {
        "data": {
          "product": { "ref": "$.run.input.product" },
          "competitors": { "ref": "$.run.input.competitors" }
        }
      }
    },
    {
      "id": "research-to-writer",
      "from": { "kind": "agent", "agentId": "researcher", "outputPort": "RESEARCH_READY" },
      "to": { "kind": "agent", "agentId": "writer", "inputPort": "draft" },
      "when": { "event": "RESEARCH_READY" },
      "map": {
        "data": {
          "findings": { "ref": "$.output.data.findings" },
          "recommendation": { "ref": "$.output.data.recommendation" },
          "product": { "ref": "$.run.input.product" }
        },
        "artifacts": {
          "sources": { "ref": "$.output.artifacts.sources" }
        }
      },
      "delivery": { "deadlineMs": 600000, "onInvalidInput": "fail" }
    },
    {
      "id": "writer-to-result",
      "from": { "kind": "agent", "agentId": "writer", "outputPort": "DELIVERED" },
      "to": { "kind": "result" },
      "when": { "event": "DELIVERED" },
      "map": {
        "data": { "report": { "ref": "$.output.data.report" } },
        "artifacts": { "report": { "ref": "$.output.artifacts.report" } }
      }
    }
  ],
  "orchestration": {
    "entryDispatch": { "mode": "all" },
    "joins": [],
    "loops": [],
    "errorRoutes": []
  },
  "bindings": [
    { "id": "binding:researcher", "kind": "model", "modelRef": "default" },
    { "id": "binding:writer", "kind": "model", "modelRef": "default" }
  ],
  "presentation": { "nodes": {} },
  "$defs": {}
}
```

示例省略了 `$defs` 的具体 Schema。实际文档包含完整的 JSON Schema Draft 2020-12 定义，或引用
不可变 Schema 资源。`START` 和 `result` 是运行边界端点，不是 Agent 节点。入口和出口与 Agent
之间的 handoff 使用相同的映射、合同和校验机制。

### 3.1 Agent 端口与结果信封

- `inputPorts` 以稳定端口 ID 为键。每个输入端口声明 `dataSchema`；Artifact 输入槽位单独声明，
  并携带媒体类型和来源信息。
- `outputPorts` 以稳定事件/端口 ID 为键。每个输出端口声明 `dataSchema` 和命名 Artifact 槽位。
- 每次 Agent 执行只返回一个统一信封：

  ```json
  {
    "event": "RESEARCH_READY",
    "data": { "findings": [], "recommendation": "..." },
    "artifacts": {
      "sources": { "artifactId": "...", "mediaType": "text/uri-list" }
    },
    "summary": "调研已完成"
  }
  ```

- `event` 选择输出端口和路由结果；`data` 是有类型的业务数据；`artifacts` 是命名引用，不内联
  大型文件；`summary` 用于展示，除非显式纳入 Schema，否则不能作为下游数据源。
- 原始 Run task 作为不可变调用上下文提供。Agent 特定工作指令属于角色包，或作为有类型输入数据，
  不通过多条边各自传递和覆盖 task。
- Agent 只收到选定的输入端口、映射后的 data/Artifact 和显式投影的 Run 字段，不能读取任意
  Team 或 Run 状态。

### 3.2 Handoff 定义

每个 Handoff 恰有一个发送端和一个接收端。端点类型为 `run`、`agent` 或 `result`；Agent 端点必须
指定端口。接收 Agent 时，`map.data` 和 `map.artifacts` 构造目标输入端口；接收 `result` 时，映射
构造 Team 的结果合同。

`when` 包含输出事件；必要时可带受限条件 AST 和优先级。事件必须属于发送 Agent 声明的输出端口。
条件使用封闭的类型化 AST，不执行脚本。相同最高优先级产生歧义时，编译失败关闭。

所有 Handoff 都是显式类型关系。纯文本交接使用声明为字符串的 `text` 端口或 text 字段；不提供
全局 `transition` 宽松模式，也不允许缺少合同的隐式连线。

## 4. 映射表达式语法

IR 校验器、编译器、Studio 自动补全和 Runtime 投影器共用同一套小型引用语法。

### 4.1 允许的引用根

| 引用 | 含义 | 作用域 |
| --- | --- | --- |
| `$.output.event` | 当前发送 Agent 的结果事件 | 当前已完成的 Agent 调用 |
| `$.output.data.<path>` | 当前发送 Agent 的类型化业务数据 | 当前已完成的 Agent 调用 |
| `$.output.artifacts.<slot>` | 当前发送 Agent 的命名 Artifact | 当前已完成的 Agent 调用 |
| `$.run.task` | Run 原始任务 | 整个 Run，只读 |
| `$.run.input.<path>` | 已校验的 Run 结构化输入 | 整个 Run，只读 |
| `$.run.preferences.<path>` | 已校验的用户偏好 | 整个 Run，只读 |
| `$.run.attachments.<slot>` | 输入附件引用 | 整个 Run，只读 |
| `$.loop.previous.<agentId>.output.data.<path>` | 指定 Agent 上一轮成功输出 | 同一 Run、lineage 和声明的 Loop Scope |
| `$.loop.previous.<agentId>.output.artifacts.<slot>` | 指定 Agent 上一轮 Artifact | 同一 Run、lineage 和声明的 Loop Scope |

常量使用 `{ "literal": <JSON scalar> }`；引用使用 `{ "ref": "..." }`。映射目标使用结构化对象，
不允许把目标路径编码进字符串。

### 4.2 语法和解析规则

- 引用以 `$` 开始，后接点分隔标识符；标识符匹配
  `[A-Za-z_][A-Za-z0-9_-]*`。数组只允许非负整数下标，例如 `[0]`。
- Schema 属性名必须能被该语法无歧义寻址；不支持带点属性名、引号键或转义键。
- 不支持通配符、切片、过滤、递归选择、函数、可选链、动态下标或任意表达式。
- “缺失”和 JSON `null` 是不同状态。可选源不能满足必需目标；显式 `null` 必须符合目标的
  nullability。
- `$.output.*` 按发送 Agent 被选中的输出端口解析；`$.run.*` 按 Run 输入 Schema 解析。
  `$.loop.previous.*` 仅在被引用 Agent 属于同一 Loop Scope 且先前成功执行可保证时有效。
- Run 引用只读。投影不会修改发送方结果；不隐式传递未选择的输入、偏好、附件或历史结果。

## 5. 编译器与 Schema 规则

编译器负责静态结构检查，返回编译计划和稳定诊断。任何 error 诊断都会阻止发布和运行。warning
表示某项约束需要运行时校验，不得绕过运行时校验。

### 5.1 静态检查

- 解析 Agent、端口、Binding、Handoff、Run/Result 端点及本地 Schema 引用。
- 验证 Handoff 事件属于发送端输出端口和路由声明。
- 将每个源引用解析为源 Schema 子树，将每个目标解析到目标端口/结果 Schema 位置。
- 验证源字段存在、目标必需字段覆盖和结构类型可赋值性。
- 对象映射中的每个必需目标属性必须且只能有一个提供方。源对象只有在保证包含目标的
  全部必需属性时，才能满足该目标对象。类型方向为：源 Schema 允许的每个值都必须被目标 Schema 接受。
- 自动映射仅在字段同名且类型静态兼容时提出建议；Studio 展示建议，只有接受或显式配置后才成为语义。
- 未知端口、未解析路径、类型不兼容、必需字段缺失、目标重复写入、错误事件引用和越界 Loop 引用
  都是编译错误。

### 5.2 保守类型边界

静态赋值检查支持简单 `type`、`properties`、`required`、`items` 以及本地 `$ref` 解析。对
`anyOf`、`oneOf`、`not`、`if/then/else`、`pattern`、`format`、字符串/数值边界和自定义关键字
不做深层蕴含推导。若这些约束使编译器无法证明兼容，则产生
`IR_MAPPING_RUNTIME_CHECK_REQUIRED`；发布可继续，但调用 Agent 前必须执行完整目标 Schema 校验。
不得把未证明的兼容性标为静态通过。

初始稳定诊断码族：

- `IR_UNKNOWN_AGENT`、`IR_UNKNOWN_PORT`、`IR_UNKNOWN_BINDING`、`IR_UNKNOWN_SCHEMA_REF`
- `IR_MAPPING_REF_INVALID`、`IR_MAPPING_SOURCE_MISSING`、`IR_MAPPING_TYPE_INCOMPATIBLE`
- `IR_MAPPING_REQUIRED_FIELD_MISSING`、`IR_MAPPING_TARGET_CONFLICT`
- `IR_MAPPING_RUNTIME_CHECK_REQUIRED`、`IR_LOOP_REF_OUT_OF_SCOPE`
- `IR_ROUTE_AMBIGUOUS`、`IR_JOIN_FIELD_CONFLICT`、`IR_JOIN_REQUIRED_FIELD_MISSING`
- `IR_QUORUM_FIELD_MUST_BE_OPTIONAL`、`IR_UNBOUNDED_LOOP`、`IR_BUDGET_EXCEEDED`

诊断包含稳定代码、Team IR JSON Pointer、相关发送/接收 Agent ID 和可执行的修复建议，不包含秘密值。

## 6. 编排语义

编排独立于 Handoff payload 合同。Orchestration 引用 Agent 和 Handoff ID，编译成确定性的路由、
Branch、Join 和 Loop 作用域。

### 6.1 路由和并行分发

- Agent 成功输出一个已声明事件。普通 Handoff 按事件和可选条件匹配；路由优先级必须产生唯一结果，
  除非发送 Agent 显式启用 fan-out。
- Fan-out 激活所有静态声明且符合条件的普通下游 Handoff；不从集合动态生成任务，也不承诺物理并发。
- Runtime-only ERROR 路由不是 Agent 可输出事件，只在所属执行/交付重试耗尽后触发。
- 业务拒绝、澄清等预期结果使用普通业务事件；运行失败使用错误通道。

### 6.2 Join 字段槽位合并

Join 绑定到目标 Agent 的一个输入端口，声明 `all_of` 或 `quorum_of`、来源 Handoff、阈值、作用域、
超时和失败策略。

- 所有贡献 Handoff 必须指向同一 Agent 和同一输入端口。
- 每条入边提供互不重叠的 `data` 字段和 Artifact 槽位；重复目标字段编译失败，即使两边映射表达式相同。
- Agent 调用 task 固定为 Run task，不参与各入边合并。
- Join 所需的公共 Run 字段通过一次性 `baseMapping` 声明，参与相同的端口覆盖检查，且不能与入边字段冲突。
- `all_of` 要求所有来源映射与 `baseMapping` 合并后覆盖端口全部必需字段。
- `quorum_of` 中非保证到达来源提供的字段必须为 optional。Runtime 仅合并同一 Run、lineage 和
  Loop 轮次下已完成的唯一来源；缺失 optional 字段直接省略，不以 `null` 代替。
- Artifact 槽位保留生产方来源，不拼接成提示词文本。

### 6.3 Loop 和返工

- Loop Scope 声明成员、边界、最大轮数、激活预算和耗尽策略。
- 初稿与返工输入形状不同的 Agent 声明不同端口，例如 `draft` 与 `revise`。
- `revise` Handoff 可把审查意见映射自 `$.output.data.*`，并将上一轮草稿映射自
  `$.loop.previous.writer.output.data.*` 或其 Artifact 引用。
- 上一轮引用仅限声明的 Loop Scope 和同一 lineage，不可访问任意历史执行或兄弟分支。
- 原始 Run task 在循环期间保持不变；新反馈和前轮产物通过明确字段进入输入端口。
- Loop 耗尽是 Runtime 控制结果，不是 Agent 输出事件。

### 6.4 人工审核与错误

- 人工审核属于 Runtime 控制面，不建模为虚构 Agent 或 Handoff。
- 目标 Agent 激活前的输入校验错误归属于 Handoff，并由发送侧错误策略处理；Agent 执行期间的失败
  归属于该 Agent。
- Binding 重试耗尽后才评估对应 ERROR 路由。Handoff 只有总 `deadlineMs` 和 `onInvalidInput`，
  不再额外启动重试循环。
- 审核返工反馈通过命名输入端口和类型化映射提供，不开放无约束共享状态读取。

## 7. 交付、状态与 A2A

### 7.1 Binding 与交付策略归属

- Binding 定义执行器/后端、模型或工具引用、单次尝试超时、重试次数、退避策略、凭据引用和能力限制。
- Handoff 定义交付总 deadline 和输入无效策略。有效 deadline 取 Run 与 Handoff 时限中较早者，不能
  延长 Run 时限。
- 重试归被调用 Agent 的 Binding（远端由 A2A Binding Adapter 执行），并受 Handoff deadline 约束；
  同一执行链路只允许一个重试所有者。
- Handoff ID 是稳定语义 ID。运行调用 ID 由 Run、Handoff、branch、lineage、源 execution/attempt
  和 Loop 轮次组成。Checkpoint 与副作用使用幂等键；交付事件写入追加式审计记录。
- Run 持久状态包含编译 Team digest、活动/完成分支、Join/Loop 状态、待审核项、结果/Artifact 引用和
  Handoff 生命周期。恢复时若语义 digest 不匹配，拒绝以不同 Team 静默继续执行。

### 7.2 远程 Agent Binding

远程 A2A Binding 引用 Agent Card、端点/认证配置、支持的输入输出媒体类型和协议能力。Handoff 数据
映射为 A2A Message Parts；长任务映射为 A2A Task 状态；返回 Artifact 映射回类型化 Artifact 引用。

Adapter 负责远端协议细节，包括支持时的轮询/流式/通知方式、取消、远端任务关联和终态映射。Team IR
不暴露远端 Agent 的内部角色图、提示词、工具或私有状态。本地与远程 Agent 使用相同的业务端口、
Handoff 映射和校验规则。

标准边界：

- A2A 规范独立 Agent 互操作，不规范本地工作流图。
- JSON Schema 描述和校验数据，不定义 handoff 生命周期。
- OpenAPI 描述同步 HTTP API；AsyncAPI 描述异步 API 通道。
- CloudEvents 规范事件信封，不定义工作流执行和 Agent 职责。
- BPMN 2.0 是流程建模/交换标准；OGSystem 不宣称 BPMN 一致性。
- LangGraph 是当前执行后端，不是公开 Team IR 规范。

参考：[A2A 规范](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)、
[JSON Schema 2020-12](https://json-schema.org/draft/2020-12)、
[OpenAPI](https://spec.openapis.org/oas/latest.html)、
[AsyncAPI](https://www.asyncapi.com/docs/reference/specification/latest)、
[CloudEvents](https://cloudevents.io/)、[BPMN 2.0](https://www.omg.org/spec/BPMN/2.0/)。

## 8. Studio 配置体验

### 8.1 默认流程

1. 从角色包添加 Agent 并选择 Binding。
2. 在画布上查看 Agent 声明的输入端口和事件输出端口。
3. 从输出事件端口拖至目标输入端口，创建一条 Handoff。
4. Studio 提议同名且兼容的字段映射，并显示必填覆盖情况。
5. 解决阻断诊断后发布 Team。

合法默认连接不弹模态框。缺字段和需要运行时校验的约束显示在连线上，并可定位到具体字段或 Schema。

### 8.2 渐进披露

- **基础层**：发送方、接收方、触发事件、自动映射字段、缺少的必填项。
- **路由层**：条件、优先级、fan-out、Join 参与关系和 Loop 范围。
- **高级交付层**：deadline、输入失败策略、Binding 重试摘要、远程 A2A 设置。
- **Agent 输入汇总**：选择 Agent 后显示每个端口的必需字段、来源 Handoff、Join base mapping 和
  缺失/可选来源；编辑入口联动至对应 Handoff，但语义映射仍存于 Handoff 或 Join base mapping。
- **Schema 编辑**：普通用户使用表单；高级用户可编辑 JSON Schema。不提供任意表达式或代码编辑器。

坐标和 viewport 不计入语义 digest。客户端预检与服务端发布校验共用同一 Team IR 校验器和诊断码。

## 9. 模块边界与实施路径

### 阶段 1：规范 Team IR 包

创建 `src/team-ir/`，实现公开类型、Draft 2020-12 根 Schema、解析器、映射引用语法、Schema resolver、
静态校验器、诊断码、规范化和语义 digest。Studio 改造前先冻结 Agent 端口、Handoff 映射、Join
base mapping、Loop 作用域和 Binding 引用语义。

**完成标准：** 示例可验证；路径和作用域规则固定；测试 fixture 覆盖全部阻断诊断和运行时校验提示。

### 阶段 2：编译器与 Runtime 边界

将 Team IR 编译为新的 runtime-neutral `CompiledTeamPlan`。Team IR 解析不进入 LangGraph Adapter。
替换运行时上下文投影，实现命名端口投影、类型化 Handoff 交付、Join 字段合并、Loop 引用、错误归属、
生命周期事件和 checkpoint/幂等行为。

**完成标准：** 编译计划确定且 digest 稳定；本地顺序、路由、fan-out、all-of、quorum、loop、审核、
失败和恢复 fixture 通过，且执行路径不再依赖旧编译器模块。

### 阶段 3：Studio 与 Team 发布

以 Team IR 替换旧 Studio 作者模型，展示模型与展示布局分离。更新图投影、事件桩连线命令、Handoff
面板、Agent 输入汇总、诊断、模拟和 TeamVersion 发布/读取。Mermaid 仅作为生成图形投影或导出，不再
作为可执行配置来源。

**完成标准：** Studio 与服务端产出相同语义 digest 和诊断；用户可以创建、编辑、发布、模拟、关闭和
重开 v2 Team；旧项目显示需重新创建，不静默转换。

### 阶段 4：断代与文档/示例更新

v2 端到端测试通过后，移除无 v2 调用方的旧 `FlowContractFile`、`handoffMode`、`contextMap`、旧
`SystemDesignDocument` 解析和旧编译路径，包括 `flow-contract.ts`、`semantic-ir-compiler.ts`。
更新模板、示例、手册、CLI/API 合同和发布说明。不得加入迁移命令或兼容读取器。

**完成标准：** 仓库只有一个作者模型和编译入口；生产路径拒绝旧 Team 配置；所有活动示例使用 v2。

## 10. 验收矩阵

| 范围 | 必须覆盖的场景 |
| --- | --- |
| IR Schema | 合法 v2、重复 ID、未知端点/端口/Binding、非法端点类型、无效 Schema 引用 |
| 映射编译 | 合法 output/Run/Loop 引用、未解析路径、禁用根、非法数组索引、常量类型错误、缺必填、类型不兼容、目标冲突 |
| Schema 边界 | `$ref`、type/required/items、optional 源到 required 目标拒绝、复杂 Schema 运行时校验提示、调用前校验失败 |
| Join | 目标端口一致、字段并集、重复字段拒绝、all-of 必填覆盖、quorum optional 规则、baseMapping 冲突、迟到结果幂等 |
| Loop | draft/revise 端口、上一轮 data/Artifact 引用、越界 Agent、首轮历史缺失、耗尽和恢复 |
| Runtime | 本地文本/结构化 handoff、Artifact 来源、无效输入、deadline、Binding 重试耗尽、ERROR 归属、取消、checkpoint replay |
| A2A | Agent Card、Task 创建/状态映射、input-required、completed/failed/canceled、Artifact 映射、deadline、重复调用幂等 |
| Studio | 事件桩连线、自动映射、缺项定位、Handoff 编辑、Join 汇总、Loop 端口、发布诊断、窄屏、保存重开 |
| 数据边界 | 旧配置拒绝并给出重建提示；Team IR 创建/发布不改动 `.ogs/runs/`；无迁移副作用 |
| 发布 | 活动模板/示例/文档均使用 v2；编译器、API、Runtime、Team Site 和浏览器验收通过；`git diff --check` 通过 |

## 11. 固定默认值

- Schema 方言为 JSON Schema Draft 2020-12。
- Handoff 不隐式透传数据；原始 task 是不可变调用上下文，其它 Run 字段必须显式映射。
- 未解析引用、类型不兼容、必填缺失、Join 冲突和 Loop 越界在执行前失败。
- 静态推导不能证明的复杂 Schema 约束必须在发布诊断中可见，并在 Agent 调用前运行时校验。
- 纯文本使用显式 string Schema/端口，不存在无类型连线。
- Join 使用互斥字段槽位合并；task 来自 Run；公共 Run 字段使用一次性 Join `baseMapping`。
- Binding 管重试；Handoff 管调用总 deadline 与输入失败策略。
- 不迁移旧 Team 配置；旧定义需重建；历史运行文件保持原位。
- LangGraph 通过 CompiledTeamPlan Adapter 执行；A2A 通过远端 Binding Adapter 接入。

## 12. 设计评审清单

- 每条 Handoff 是否明确双方端口和触发条件？
- 编译器能否检查必填覆盖和受支持范围内的类型兼容？
- 静态无法证明的约束是否清楚提示并保留运行时校验？
- Join task、字段冲突、quorum optionality 和 Loop 历史范围是否确定？
- 每个 Agent 是否只接收显式投影的数据，而不能任意读取全局状态？
- 每种失败是否只有一个重试所有者和明确的 ERROR 归属？
- Team 语义是否与 LangGraph、A2A 实现细节解耦？
- 普通用户是否能不写 JSON/selector 完成常见连线？
- 旧 Team 配置是否明确拒绝，同时 `.ogs/runs/` 不进入迁移流程？
- 编译器、Runtime、Studio、发布和远程 A2A 是否都有验收覆盖？
