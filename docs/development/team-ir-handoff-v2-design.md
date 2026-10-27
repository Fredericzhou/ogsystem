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
| Orchestration | 入口分发、路由、Join、Loop、审核门、Run 完成条件 | payload Schema 或执行器实现 |
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
  "runInput": {
    "dataSchema": { "$ref": "#/$defs/runInputData" },
    "preferencesSchema": { "$ref": "#/$defs/runPreferences" },
    "artifactSlots": {}
  },
  "runResult": {
    "dataSchema": { "$ref": "#/$defs/teamResultData" },
    "artifactSlots": {
      "report": {
        "required": false,
        "acceptedMediaTypes": ["text/markdown"],
        "cardinality": "single"
      }
    }
  },
  "executionPolicy": {
    "resultMode": "required",
    "activeExecutionBudgetMs": 3600000
  },
  "agents": [
    {
      "id": "researcher",
      "packageRef": "role:researcher@1",
      "bindingRef": "binding:researcher",
      "inputPorts": {
        "default": { "dataSchema": { "$ref": "#/$defs/researchInput" } }
      },
      "outputPorts": {
        "RESEARCH_READY": {
          "dataSchema": { "$ref": "#/$defs/researchOutput" },
          "artifactSlots": {
            "sources": { "required": true, "mediaTypes": ["text/uri-list"], "cardinality": "single" }
          }
        }
      }
    },
    {
      "id": "writer",
      "packageRef": "role:writer@1",
      "bindingRef": "binding:writer",
      "inputPorts": {
        "draft": {
          "dataSchema": { "$ref": "#/$defs/draftInput" },
          "artifactSlots": {
            "sources": { "required": true, "acceptedMediaTypes": ["text/uri-list"], "cardinality": "single" }
          }
        },
        "revise": { "dataSchema": { "$ref": "#/$defs/reviseInput" } }
      },
      "outputPorts": {
        "DELIVERED": {
          "dataSchema": { "$ref": "#/$defs/reportOutput" },
          "artifactSlots": {
            "report": { "required": false, "mediaTypes": ["text/markdown"], "cardinality": "single" }
          }
        }
      }
    }
  ],
  "handoffs": [
    {
      "id": "run-to-researcher",
      "from": { "kind": "run" },
      "to": { "kind": "agent", "agentId": "researcher", "inputPort": "default" },
      "map": {
        "data": {
          "product": { "$ref": "$.run.input.product" },
          "competitors": { "$ref": "$.run.input.competitors" }
        }
      }
    },
    {
      "id": "research-to-writer",
      "from": { "kind": "agent", "agentId": "researcher", "outputPort": "RESEARCH_READY" },
      "to": { "kind": "agent", "agentId": "writer", "inputPort": "draft" },
      "when": {
        "condition": {
          "op": "equals",
          "args": [{ "$ref": "$.output.data.status" }, { "$literal": "ready" }]
        },
        "priority": 10
      },
      "map": {
        "data": {
          "findings": { "$ref": "$.output.data.findings" },
          "recommendation": { "$ref": "$.output.data.recommendation" },
          "product": { "$ref": "$.run.input.product" }
        },
        "artifacts": {
          "sources": { "$ref": "$.output.artifacts.sources" }
        }
      },
      "delivery": { "deadlineMs": 600000 }
    },
    {
      "id": "writer-to-result",
      "from": { "kind": "agent", "agentId": "writer", "outputPort": "DELIVERED" },
      "to": { "kind": "result" },
      "map": {
        "data": { "report": { "$ref": "$.output.data.report" } },
        "artifacts": { "report": { "$ref": "$.output.artifacts.report" } }
      }
    }
  ],
  "orchestration": {
    "routes": [
      {
        "from": { "kind": "agent", "agentId": "researcher", "outputPort": "RESEARCH_READY" },
        "mode": "exclusive_priority",
        "onNoMatch": "fail",
        "handoffIds": ["research-to-writer"]
      }
    ],
    "joins": [],
    "loops": [],
    "reviews": []
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
不可变 Schema 资源。`run` 和 `result` 是运行边界端点，不是 Agent 节点。入口和出口与 Agent
之间的 Handoff 使用相同的映射和校验机制。`runInput`、`runResult` 分别定义调用方输入与最终结果的
数据和 Artifact 合同。

### 3.1 Agent 端口与结果信封

- `inputPorts` 以稳定端口 ID 为键。每个输入端口声明 `dataSchema` 和可选的命名 `artifactSlots`。
- `outputPorts` 以稳定事件 ID 为键。键名就是输出事件；每个输出端口声明 `dataSchema` 和可选的
  命名 `artifactSlots`。
- `artifactSlots` 使用 `{ "required": true, "mediaTypes": ["text/markdown"],
  "cardinality": "single" }` 描述。v2 首版只支持 `single`；`many` 与多来源组装留作扩展。
- 生产端槽位声明可能的 `mediaTypes`，消费端槽位声明 `acceptedMediaTypes`；Run 输入附件和 Team 结果
  使用消费端约束。
- Runtime 交付的 Artifact 是不透明引用及必要元数据（至少 `artifactId`、`mediaType`）；存储 URI、访问
  凭据和权限检查由 Runtime 管理，不暴露在 Team IR 或 Agent 信封中。
- 每次 Agent attempt 创建 invocation-scoped Allowed Artifact Set，只包含本次输入端口映射及合法
  `$.loop.previous` 引用带入的 Artifact。Agent 只能经 Runtime 注入的只读 Artifact Resolver 或只读命名挂载读取；
  对集合外 `artifactId` 的读取返回 `ARTIFACT_ACCESS_DENIED`。Artifact ID 不构成授权凭证。
- Agent 产出的 Artifact 必须经受控写入接口登记；Runtime 检查实际媒体类型与所选输出端口槽位声明一致后才
  分配新 ID。远端 Binding 仅将当前 Handoff 映射的 Artifact 转为 A2A Message Parts。
- 必需目标槽位必须由恰好一个必需源槽位映射；可选源不能满足必需目标。源媒体类型集合必须被目标接受，
  无法静态证明时发布警告并在交付前校验实际媒体类型。通配媒体范围按 RFC 兼容的媒体范围规则处理。
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
- 调用方 Run 输入为 `{ "task": "...", "input": {}, "preferences": {}, "attachments": {} }`；
  Runtime 对 Agent 注入不可变 `task`，并只将经 Handoff 映射选择的 Run 字段放入 `data`。
- Runtime 可向 Agent 暴露当前拓扑中有出边的 `allowedOutputPorts`，并拒绝未声明或未允许的输出事件。
  该集合是输出合同，不是安全授权边界。

### 3.2 Handoff 定义

每个 Handoff 恰有一个发送端和一个接收端。端点类型为 `run`、`agent` 或 `result`；Agent 端点必须
指定端口。接收 Agent 时，`map.data` 和 `map.artifacts` 构造目标输入端口；接收 `result` 时，映射
构造 Team 的结果合同。

Agent Handoff 的发送端 `outputPort` 已唯一指定输出事件，不再重复声明 `when.event`。路由条件和优先级
由 `orchestration.routes` 统一控制；条件使用封闭的类型化 AST，不执行脚本。

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
| `$.review.decision` | 当前人工审核决定，值为 `approve` 或 `reject` | 当前被审核的 Agent 输出及其后续路由 |
| `$.review.feedback.<path>` | 经审核反馈 Schema 校验的数据 | 当前被审核的 Agent 输出及其后续路由 |
| `$.loop.previous.<agentId>.output.data.<path>` | 指定 Agent 上一轮成功输出 | 同一 Run、lineage 和声明的 Loop Scope |
| `$.loop.previous.<agentId>.output.artifacts.<slot>` | 指定 Agent 上一轮 Artifact | 同一 Run、lineage 和声明的 Loop Scope |

映射值使用递归的 ValueExpr：引用为 `{ "$ref": "..." }`，字面量为
`{ "$literal": <任意 JSON 值> }`；普通对象和数组本身递归表示结构化构造。映射目标使用结构化对象，
不允许把目标路径编码进字符串。每个表达式对象必须且只能包含一个保留标签键，否则按普通对象递归解析；
需要表达含保留标签键的业务对象时使用 `$literal`。

### 4.2 语法和解析规则

- 引用以 `$` 开始，后接点分隔标识符；标识符匹配
  `[A-Za-z_][A-Za-z0-9_-]*`。数组只允许非负整数下标，例如 `[0]`。
- Schema 属性名必须能被该语法无歧义寻址；不支持带点属性名、引号键或转义键。
- 不支持通配符、切片、过滤、递归选择、函数、可选链、动态下标或任意表达式。
- “缺失”和 JSON `null` 是不同状态。可选源不能满足必需目标；显式 `null` 必须符合目标的
  nullability。
- `$.output.*` 按发送 Agent 被选中的输出端口解析；`$.run.*` 按 Run 输入 Schema 解析。
  `$.review.*` 仅在对应输出端口配置了审核门后可用，并按该审核门的决定/反馈合同解析。
- 路由条件只能引用当前来源可用的上下文：Run 来源使用 `$.run.*`，Agent 来源使用 `$.output.*`，且仅在
  配置审核门后可使用 `$.review.*`。
  `$.loop.previous.*` 仅在被引用 Agent 属于同一 Loop Scope 且紧邻上一轮的唯一成功执行可保证时有效；
  Join `baseMapping` 不能使用当前 Agent 的 `$.output.*` 或审核上下文 `$.review.*`。
- 静态校验器在 Loop Scope 的展开控制流图上检查支配关系：每条读取
  `$.loop.previous.<agentId>` 的 Handoff 或 Join `baseMapping`，在同一 Loop Scope 和 lineage 内必须被该
  Agent 的一次成功执行支配。所有能到达该引用点的路径都必须先经过该 Agent；首轮可达路径未满足此条件时编译失败。
  语义固定读取同 lineage 紧邻上一轮的唯一成功执行；若该 Agent 在该轮可能执行零次或多次，编译失败，
  不回退到更早轮次的数据。
  该检查按 Loop 轮次和控制流边界执行，不以未展开的循环图上普通可达性代替。
- Run 引用只读。投影不会修改发送方结果；不隐式传递未选择的输入、偏好、附件或历史结果。
- `$literal` 可包含任意 JSON 值；对象和数组构造不引入额外 `$object`/`$array` 包装节点。

## 5. 编译器与 Schema 规则

编译器负责静态结构检查，返回编译计划和稳定诊断。任何 error 诊断都会阻止发布和运行。warning
表示某项约束需要运行时校验，不得绕过运行时校验。

### 5.1 静态检查

- 解析 Agent、端口、Binding、Handoff、Run/Result 端点以及 `runInput`、`runResult` 合同和本地 Schema 引用。
- 验证路由来源、被引用 Handoff 的发送端点及输出事件一致；Run 来源的触发事件固定为 `START`。
- 将每个源引用解析为源 Schema 子树，将每个目标解析到目标端口/结果 Schema 位置。
- 普通 Handoff 的映射必须独立覆盖目标端口的必需字段。只有被 `orchestration.joins[].handoffIds` 明确列出
  的 Handoff 才豁免独立必填覆盖；同一 Join 目标端口不允许有游离入边。Join 校验器合并所有指定贡献 Handoff
  与 `baseMapping` 后统一验证必填覆盖。
- 验证每个映射源字段存在且目标类型兼容；必需字段覆盖按普通 Handoff 独立检查或 Join 汇总检查执行。
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
- `IR_QUORUM_FIELD_MUST_BE_OPTIONAL`、`IR_JOIN_CONDITIONAL_REQUIRED_SOURCE`、`IR_UNBOUNDED_LOOP`、`IR_BUDGET_EXCEEDED`
- `IR_RESULT_CONFLICT`

运行期稳定错误码还包括 `RESULT_NOT_SATISFIED`、`RESULT_CONFLICT`、`JOIN_SOURCE_SKIPPED`、
`JOIN_NO_ARRIVALS`、`JOIN_QUORUM_UNREACHABLE`、`REVIEW_TIMEOUT` 和 `ARTIFACT_ACCESS_DENIED`。

诊断包含稳定代码、Team IR JSON Pointer、相关发送/接收 Agent ID 和可执行的修复建议，不包含秘密值。

## 6. 编排语义

编排独立于 Handoff payload 合同。Orchestration 引用 Agent 和 Handoff ID，编译成确定性的路由、
Branch、Join 和 Loop 作用域。

### 6.1 路由和并行分发

路由以来源端点为键，列出该端点可激活的 Handoff ID。来源为 Agent 时必须指定 `agentId` 和 `outputPort`；
来源为 Run 时使用 `{ "kind": "run" }`，其唯一事件为 `START`。示意：

```json
{
  "from": { "kind": "agent", "agentId": "researcher", "outputPort": "RESEARCH_READY" },
  "mode": "exclusive_priority",
  "onNoMatch": "fail",
  "handoffIds": ["research-to-writer", "research-to-fallback"]
}
```

每条 Handoff 可声明无条件匹配，或声明 `when.condition` 和 `when.priority`。路由模式、候选 Handoff 集合
和无匹配行为是唯一激活规则来源；Handoff 本身不重复声明事件。

- Run 或 Agent 来源下有多条 Handoff，或存在条件 Handoff 时，必须有一条 route 声明
  `exclusive_priority` 或 `parallel_fanout`；只有一条无条件 Handoff 时可省略 route。Run 入口与 Agent
  输出使用相同的路由模式、条件、优先级和 `onNoMatch` 语义，不另设 `entryDispatch`。
- `exclusive_priority` 按优先级从高到低选择首条条件为真的 Handoff；同一路由候选必须使用唯一整数优先级，
  重复优先级在编译期以 `IR_ROUTE_AMBIGUOUS` 拒绝。编译器无需证明任意条件互斥。`parallel_fanout` 不使用优先级。
- `parallel_fanout` 激活所有无条件或条件为真的静态 Handoff；不从集合动态生成任务，也不承诺物理并发。
  激活顺序不构成语义保证。
- Handoff 的 `when.condition` 只作为所引用 Route 候选边的条件；Run 入口也允许条件 Handoff。
- 未匹配任何 Handoff 时，Route 必须显式声明 `onNoMatch` 为 `fail` 或 `finish`；不得静默丢弃输出。
  `finish` 仅在 `runResult` 已满足时合法，否则按失败处理。
- v2 核心合同不提供可路由的错误边。失败按人工审核与错误规则产生终态；图内补偿和错误处理留作扩展。
- 业务拒绝、澄清等预期结果使用普通业务事件；运行失败使用 Runtime 错误状态，不伪装成 Agent 业务事件。

### 6.2 结果交付与 Run 完成

- 每条 `to: { "kind": "result" }` Handoff 必须独立满足 `runResult` 的全部 required data 字段和必需
  Artifact 槽位；不跨 Handoff 隐式拼装结果。多方材料先汇合到 Join/汇总 Agent，再由该 Agent 交付结果。
- 一次 Run 最多允许一次成功的 result 写入。编译器若发现同一 `parallel_fanout` 下多个结果 Handoff 可同时
  被激活，或存在其它可静态确认的并行重复结案路径，产生 `IR_RESULT_CONFLICT` 并拒绝发布。运行时以原子
  写入保证唯一性；二次写入以 `RESULT_CONFLICT` 失败关闭。
- `executionPolicy.resultMode` 必须显式为 `required` 或 `allow_empty`。默认 `required` 时，Run 必须有一次
  有效结果写入，即使 `runResult` Schema 没有必需字段。`allow_empty` 才允许零次结果写入。
- Run 仅在所有活动分支、Join、Loop 和审核门均已终止，且结果策略满足时进入 `completed`。`finish` 只终止
  当前分支；所有分支静默收敛但必需结果缺失时，Run 以 `RESULT_NOT_SATISFIED` 失败关闭。
- 编译器无法证明任意复杂条件路径互斥时，对可能并行写入结果的拓扑采取保守拒绝；用户应显式汇合后再交付。

### 6.3 Join 字段槽位合并

Join 绑定到目标 Agent 的一个输入端口，声明 `all_of` 或 `quorum_of`、精确的 `handoffIds` 来源集合、阈值、
作用域、超时和失败策略。同一 `(agentId, inputPort)` 上的所有入边必须属于该 Join；不允许游离直通边。
编译器验证来源 ID 唯一且指向该端口，`quorum_of.threshold` 为正整数且不超过来源数。

- 所有贡献 Handoff 必须指向同一 Agent 和同一输入端口。
- 每条入边提供互不重叠的 `data` 字段和 Artifact 槽位；重复目标字段编译失败，即使两边映射表达式相同。
- Agent 调用 task 固定为 Run task，不参与各入边合并。
- Join 所需的公共 Run 字段通过一次性 `baseMapping` 声明，参与相同的端口覆盖检查，且不能与入边字段冲突。
- `all_of` 要求所有来源映射与 `baseMapping` 合并后覆盖端口全部必需字段。
- Join `baseMapping` 在没有单一当前发送 Agent 的情况下，只允许读取 `$.run.*`、满足当前 Loop Scope
  支配约束的 `$.loop.previous.<agentId>.*`，或使用 `$literal`；不得引用 `$.output.*` 或 `$.review.*`。
  `baseMapping` 执行一次，所有 Join 来源共享该结果，因此用于提供公共必需字段，不得由多条入边重复写入。
- 若上游条件路由可能跳过某来源，该来源只能贡献 optional 字段和 optional Artifact 槽位；任何可能缺席来源
  若提供目标必需项，编译时报 `IR_JOIN_CONDITIONAL_REQUIRED_SOURCE`。必需项须由 `baseMapping` 或保证到达
  的来源覆盖。`quorum_of` 的所有非保证到达来源贡献项也必须为 optional。
- 编译器将路由条件视为可能为真或为假；required 项必须在 Join 作用域的每条成功路径上都有保证来源，
  无法静态证明时发布失败。Studio 创建端口字段时默认 required，用户必须显式改为 optional 才允许条件缺席。
- Runtime 仅合并同一 Run、lineage 和 Loop 轮次下的唯一来源；缺失 optional 字段直接省略，不以 `null` 代替。
- 每个 Join 来源在同一 Join 轮次内为 `pending`、`arrived` 或 `skipped`；来源失败按全局失败规则终止 Run。
  当所有上游前驱均已终止且没有活动分支能再激活该来源时，将仍为 `pending` 的来源标记为 `skipped`。
- `all_of` 等待每个来源变为 `arrived` 或 `skipped`。required 贡献来源变为 `skipped` 时立即以
  `JOIN_SOURCE_SKIPPED` 失败；只贡献 optional 项的来源可跳过，其字段/槽位被省略。目标至少需要一条来源
  `arrived`，否则以 `JOIN_NO_ARRIVALS` 失败。
- `quorum_of` 在 `arrived >= threshold` 时立即触发目标 Agent，之后到达的来源只记审计且不得重复触发；若
  `arrived + pending < threshold`，立即以 `JOIN_QUORUM_UNREACHABLE` 失败。两种模式均禁止零到达触发目标。
- `quorum_of` 提前触发不会取消尚未结束的贡献分支，也不把分支故障转换为 skipped。任何已激活分支失败仍按
  全局失败规则终止 Run；Run 完成仍等待全部活动分支收敛。
- `timeoutMs` 按 `(runId, lineage, loopRound)` 独立计时，从该 Join 轮次首个贡献前驱分支激活（或首个贡献
  到达，取较早者）时开始。Runtime 持久化 Join deadline，恢复时沿用原 deadline，不重置计时；计时不从 Run
  创建时开始。
- Artifact 槽位保留生产方来源，不拼接成提示词文本。

### 6.4 Loop 和返工

- Loop Scope 声明成员、边界、最大轮数、激活预算和耗尽策略。
- 需要读取 `$.loop.previous` 的锚点 Agent，其初始化执行必须位于同一 Loop Scope，并作为首轮迭代的唯一成功
  锚点执行；后续每个可到达该引用的迭代也必须恰好成功执行一次。若初始化在 Loop Scope 外，不能将其当作
  Loop 历史；首轮状态应显式来自 `$.run.*`，不能回退或猜测上一轮值。
- 初稿与返工输入形状不同的 Agent 声明不同端口，例如 `draft` 与 `revise`。
- `revise` Handoff 可把审查意见映射自 `$.output.data.*`，并将上一轮草稿映射自
  `$.loop.previous.writer.output.data.*` 或其 Artifact 引用。
- 上一轮引用仅限声明的 Loop Scope 和同一 lineage，不可访问任意历史执行或兄弟分支。
- 原始 Run task 在循环期间保持不变；新反馈和前轮产物通过明确字段进入输入端口。
- Loop 耗尽是 Runtime 控制结果，不是 Agent 输出事件。

### 6.5 人工审核与错误

- 人工审核属于 Runtime 控制面，不建模为虚构 Agent 或 Handoff。
- v2 审核门只挂在 `orchestration.reviews`，位置为 `{ "kind": "agentOutput", "agentId": "...",
  "outputPort": "..." }`，即 Agent 输出完成并校验后、路由评估前。每个审核点声明 `feedbackSchema`、
  `timeoutMs` 和固定的 `onTimeout: "fail"`；逾期以 `REVIEW_TIMEOUT` 失败，绝不默认批准。
  `timeoutMs` 从该审核门在当前 Run/lineage/Loop 轮次首次激活时起算并持久化。Runtime 暂停 Run，审核决定
  固定为 `approve` 或 `reject`，反馈必须符合该 Schema。
- 示例：`{ "id": "writer-review", "at": { "kind": "agentOutput", "agentId": "writer",
  "outputPort": "DELIVERED" }, "feedbackSchema": { "$ref": "#/$defs/reviewFeedback" },
  "timeoutMs": 86400000, "onTimeout": "fail" }`。拒绝路由可检查
  `{ "op": "equals", "args": [{ "$ref": "$.review.decision" }, { "$literal": "reject" }] }`，并将
  `{ "$ref": "$.review.feedback.comments" }` 映射到同一 Agent 的 revise 输入端口。
- `feedback` 在批准时可省略，在拒绝并触发返工时必须存在且通过 `feedbackSchema` 校验；审核决定、反馈和
  审核者审计身份写入 Run 审计记录，不并入 Agent 输出信封。
- 审核决定和反馈只在该审核点之后的路由条件及 Handoff 映射中通过 `$.review.*` 显式读取；未配置审核门时
  引用 `$.review.*` 是编译错误。Studio/API 提交审核决定前仍须由控制面验证审核者身份与权限。
- 批准路径继续使用普通结果/下游 Handoff。拒绝返工使用同一 Agent 输出事件下的普通 Handoff，目标指向该
  Agent 声明的 revise 输入端口，映射 `$.review.feedback.*`；该边必须属于已声明 Loop Scope。这样拒绝路径
  仍由普通路由、端口合同和 Loop 预算控制，不创建虚构 Reviewer Agent 或隐式控制边。
- Agent 输出不符合自身端口 Schema 时，归属于该 Agent 执行失败；映射后输入不符合目标端口 Schema 时，
  归属于该 Handoff。两类错误均失败关闭，不允许带病激活下游 Agent。
- Handoff 的 `onInvalidInput` 固定为 `fail`，可省略并按 `fail` 处理。v2 核心不支持 `ignore`、`warn`、
  自动修复或图内 ERROR 路由。
- Agent 执行错误由被调用 Agent 的 Binding 重试策略处理；重试耗尽后 Run 进入失败终态。Handoff 只有总
  `deadlineMs`，不额外启动重试循环。
- `executionPolicy.activeExecutionBudgetMs` 只累计 Agent 活跃执行时间；Run 调用方可请求更短预算但不能延长
  Team 上限。处于 `waiting_human_review` 时冻结活跃执行预算，由该审核门的 `timeoutMs` 单独计时；审核通过后
  才评估路由并启动下游 Handoff deadline。`paused_input_required` 同样不消耗活跃执行预算。审核等待不会消耗
  尚未激活的下游交付时限。
- 错误上下文使用稳定的 `code`、`category`、`stage`、`sourceKind`、`sourceId` 和 `attempt`；默认不把
  原始异常消息作为下游业务数据或用户可见内容，避免泄露凭据和提示词。
- 审核返工反馈通过命名输入端口和类型化映射提供，不开放无约束共享状态读取。

## 7. 交付、状态与 A2A

### 7.1 Binding 与交付策略归属

- Binding 定义执行器/后端、模型或工具引用、单次尝试超时、重试次数、退避策略、凭据引用和能力限制。
- Handoff 定义从路由激活时起算的交付总 deadline，覆盖交付及目标 Binding 的全部重试；重试不得重置该计时。
  Run 的 `activeExecutionBudgetMs` 独立累计 Agent 活跃执行时间；两者分别监管，任一耗尽即可终止 Run。
- 审核门位于路由前，暂停等待只受审核 `timeoutMs` 控制，不计入 Run 活跃执行预算，也不消耗尚未激活的
  Handoff deadline。A2A `paused_input_required` 不累计活跃执行预算，直至调用方取消或运行记录按保留策略过期。
- 重试归被调用 Agent 的 Binding（远端由 A2A Binding Adapter 执行），并受 Handoff deadline 约束；
  同一执行链路只允许一个重试所有者。
- Handoff ID 是稳定语义 ID。运行调用 ID 由 Run、Handoff、branch、lineage、源 execution/attempt
  和 Loop 轮次组成。Checkpoint 与副作用使用幂等键；交付事件写入追加式审计记录。
- `paused_input_required` 是可查询、可取消但不可 Resume 的暂停状态，不是 `completed` 或 `failed`；它不会继续
  路由或写入结果。调用方按待输入请求调整输入后创建新 Run。
- Run 持久状态包含 `compiledPlanDigest`、活动/完成分支、Join 来源状态与计时起点、Loop 状态、待审核项、
  唯一结果写入状态、结果/Artifact 引用和
  Handoff 生命周期。恢复时若语义 digest 不匹配，拒绝以不同 Team 静默继续执行。
- `compiledPlanDigest` 覆盖去除 `presentation` 后的规范化 IR、全部本地/外部 Schema 解析闭包摘要、不可变
  角色包内容摘要、有效 Binding 执行策略摘要，以及 `compilerSemanticsVersion` 和会改变执行语义的 Adapter
  版本。Binding 摘要包含模型/工具语义标识、超时/重试策略及 A2A Agent Card 能力摘要；不包含密钥明文或
  临时令牌。凭据引用及其版本标识可纳入摘要，但不能纳入凭据值。
- Resume/Replay 重新解析并计算同一闭包摘要；任何闭合依赖变化均拒绝静默恢复。无法取得旧依赖的摘要时，
  也拒绝以当前可变别名代替。

### 7.2 远程 Agent Binding

远程 A2A Binding 引用 Agent Card、端点/认证配置、支持的输入输出媒体类型和协议能力。Handoff 数据
映射为 A2A Message Parts；长任务映射为 A2A Task 状态；返回 Artifact 映射回类型化 Artifact 引用。

Adapter 负责远端协议细节，包括支持时的轮询/流式/通知方式、取消、远端任务关联和终态映射。远端任务
返回 `input-required` 时，v2 核心将 Run 持久化为可取消、不可继续执行的 `paused_input_required` 状态，并
保存 `{ handoffId, agentId, bindingId, remoteTaskId, messageParts, requestedInputSchema? }`。Runtime 不提供
携带补充输入恢复同一远端 Task 的 API 或图内路由；调用方可据此调整输入并创建新 Run，或取消当前 Run。
此状态不等同于人工审批。远端任务原地续接属于后续扩展。Team IR
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
- **高级交付层**：deadline、输入失败策略、Binding 重试摘要、人工审核门、远程 A2A 设置。
- **Agent 输入汇总**：选择 Agent 后显示每个端口的必需字段、来源 Handoff、Join base mapping 和
  缺失/可选来源；编辑入口联动至对应 Handoff，但语义映射仍存于 Handoff 或 Join base mapping。
- **Schema 编辑**：普通用户使用表单；高级用户可编辑 JSON Schema。不提供任意表达式或代码编辑器。

坐标和 viewport 不计入语义 digest。客户端预检与服务端发布校验共用同一 Team IR 校验器和诊断码。

## 9. 模块边界与实施路径

### 阶段 1：规范 Team IR 包

创建 `src/team-ir/`，实现公开类型、Draft 2020-12 根 Schema、解析器、映射引用语法、Schema resolver、
静态校验器、诊断码、规范化和语义 digest。Studio 改造前先冻结 Agent 端口、Handoff 映射、Join 必填
豁免与聚合规则、统一入口/输出路由、Loop 支配检查、审核门和 Binding 引用语义。

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

**完成标准：** 仓库只有一个作者模型和编译入口；生产路径以稳定诊断码拒绝旧 Team 配置且不覆盖旧文件；
所有活动示例使用 v2。发布切换按版本级兼容矩阵验收，不要求源码删除、入口切换和示例替换集中在同一次
合并或提交中。

## 10. 验收矩阵

| 范围 | 必须覆盖的场景 |
| --- | --- |
| IR Schema | 合法 v2、重复 ID、未知端点/端口/Binding、非法端点类型、无效 Schema 引用、runInput/runResult、executionPolicy 校验 |
| 映射编译 | 合法 output/Run/Loop 引用、未解析路径、禁用根、非法数组索引、常量类型错误、缺必填、类型不兼容、目标冲突 |
| Schema 边界 | `$ref`、type/required/items、optional 源到 required 目标拒绝、复杂 Schema 运行时校验提示、调用前校验失败 |
| Join | 精确 handoffIds、目标端口一致、游离入边拒绝、单边缺必填豁免、条件必需来源拒绝、字段并集、重复字段拒绝、all-of optional skip/必需缺席/零到达、quorum 早满足/不可达、timeout 起点与恢复、迟到结果幂等 |
| Loop | draft/revise 端口、上一轮 data/Artifact 引用、支配关系通过/拒绝、首轮历史缺失、前轮零次/多次执行、陈旧值拒绝、耗尽和恢复 |
| Runtime | 本地文本/结构化 handoff、条件 Run 入口、结果唯一次数/静默收敛/显式空结果策略/结果冲突、Artifact 来源/越权拒绝/受控产出登记、无效输入失败关闭、审核暂停/批准/拒绝/反馈校验/独立超时/活跃预算冻结、deadline、Binding 重试耗尽、错误归属、取消、checkpoint replay |
| A2A | Agent Card、Task 创建/状态映射、input-required 持久暂停/请求信息暴露/不支持续接/取消、completed/failed/canceled、Artifact 映射、deadline、重复调用幂等 |
| Studio | 事件桩连线、自动映射、缺项定位、Handoff 编辑、Join 汇总、Loop 端口、发布诊断、窄屏、保存重开 |
| 数据边界 | 旧配置拒绝并给出重建提示；Team IR 创建/发布不改动 `.ogs/runs/`；无迁移副作用 |
| 发布 | 活动模板/示例/文档均使用 v2；编译器、API、Runtime、Team Site 和浏览器验收通过；`git diff --check` 通过 |

## 11. 固定默认值

- Schema 方言为 JSON Schema Draft 2020-12。
- Handoff 不隐式透传数据；原始 task 是不可变调用上下文，其它 Run 字段必须显式映射。
- 未解析引用、类型不兼容、必填缺失、Join 冲突和 Loop 越界在执行前失败。
- 静态推导不能证明的复杂 Schema 约束必须在发布诊断中可见，并在 Agent 调用前运行时校验。
- 纯文本使用显式 string Schema/端口，不存在无类型连线。
- Join 使用互斥字段槽位合并；task 来自 Run；公共字段使用一次性 Join `baseMapping`，可引用 `$.run.*`、
  通过支配检查的 `$.loop.previous.*` 或 `$literal`，不能引用当前输出或审核上下文。
- Binding 管重试；Handoff 管调用总 deadline 与输入失败策略。
- Agent 输出与映射后的 Agent/Run 结果输入都在交付前校验；无效输入固定失败关闭，不自动修复或跳过。
- Result 单次完整写入；Run 等所有活动工作收敛后按显式 `executionPolicy.resultMode` 判定成功。
- Join 精确列出贡献 Handoff，持久化 pending/arrived/skipped 来源状态；`all_of` 必需贡献缺席失败、optional 贡献可跳过，`quorum_of` 不可达即失败。
- Agent 只能读取当前 invocation 映射授权的 Artifact；审核等待独立超时，不默认批准或消耗活跃执行预算。
- Resume/Replay 必须匹配含 Schema、角色包、Binding 和编译语义的 `compiledPlanDigest`。
- A2A `input-required` 进入不可 Resume、可取消的 `paused_input_required`，由调用方另起 Run。
- 不迁移旧 Team 配置；旧定义需重建；历史运行文件保持原位。
- LangGraph 通过 CompiledTeamPlan Adapter 执行；A2A 通过远端 Binding Adapter 接入。

## 12. 人类团队协作结构覆盖

Team IR v2 能表达一部分常见团队协作结构，但它描述的是可执行的信息流和控制流，不是组织制度、团队文化或完整的人类协作理论。

| 人类团队模式 | v2 表达方式 | 覆盖边界 |
| --- | --- | --- |
| 专业分工与交接 | Agent 职责、角色包、输入/输出端口、类型化 Handoff | 能描述谁产出什么、交给谁；不建模职位、劳动关系或组织权责 |
| 管理者分派与路由 | 条件路由、优先级、独占选择 | 可用一个 Agent 作为调度/分诊责任方；不推断组织层级 |
| 并行专家协作 | 静态 fan-out 与 Join | 支持有限、预先声明的并行任务；不支持运行时任意组队或动态扩编 |
| 条件会签 | `all_of`、optional 贡献和 `skipped` 来源状态 | 必到意见仍须到齐；仅贡献 optional 材料的条件分支可跳过 |
| 评审、批准与返工 | Runtime 人工审核、独立返工端口与 Loop | 可表达审批暂停和反馈回路；不定义审批授权、法定签署、多人共识或申诉程序 |
| 双盲评审与红蓝对抗 | 各自独立的输入投影、并行分支、主编 Join | 能避免显式传递对方材料；不保证形式化匿名、抗推断或无串通 |
| 固定参与者的结构化博弈 | 角色专属输入、裁判/协调 Agent、有限轮 Loop | 能编排已知的回合和结算；不是博弈求解器，也不提供隐私计算或策略保密保证 |
| 升级与故障处理 | 失败终态；后续可扩展补偿/升级 | v2 核心不提供通用错误工作流，避免错误通道变成另一套隐式路由 DSL |
| 多方协商与共识 | 多轮明确事件、Loop、Join | 可手工编排已知流程；不提供观点博弈、投票公平性、谈判策略或共识保证 |
| 知识与组织记忆 | 显式输入、输出和 Artifact 引用 | Run 内数据边界清晰；长期知识库、权限继承、保密等级和保留策略属于外部服务合同 |
| 远程组织协作 | A2A Binding 与类型化消息/Artifact | 可互操作地调用远程 Agent；不表示信任、身份治理、法律责任或跨组织授权已解决 |

因此，v2 适合建模边界明确、目标可描述、交付可验证、协作流程可重复执行的团队任务。它不能单独覆盖
人类社会中的非正式协商、权力关系、利益冲突、信任建立、价值判断和不断变化的团队成员关系。产品应把
这些能力留给人类控制面、身份与权限系统、审计策略及领域应用，而不把它们伪装成 Agent 图语义。
显式投影表达的是可审计的数据最小化，不是保密或非干扰证明：`$.run.task` 对所有 Agent 可见，Team 作者也
能决定将哪些字段映射给哪个角色。盲评/博弈设计必须避免把秘密写入共享 task 或公共 Artifact；严格机密隔离
需要单独的身份策略、信息流标签、隔离运行或密码学机制。相关架构取舍见
[Team IR 协作边界 ADR](adr-team-ir-collaboration-boundaries.md)。

## 13. 设计评审清单

- 每条 Handoff 是否明确双方端口，且路由激活规则只有一个权威来源？
- 编译器能否检查必填覆盖和受支持范围内的类型兼容？
- 静态无法证明的约束是否清楚提示并保留运行时校验？
- Join task、字段冲突、quorum optionality 和 Loop 历史范围是否确定？
- 每个 Agent 是否只接收显式投影的数据，而不能任意读取全局状态？
- 每种失败是否只有一个重试所有者和明确的终态/归属？
- Team 语义是否与 LangGraph、A2A 实现细节解耦？
- 普通用户是否能不写 JSON/selector 完成常见连线？
- 旧 Team 配置是否明确拒绝，同时 `.ogs/runs/` 不进入迁移流程？
- 编译器、Runtime、Studio、发布和远程 A2A 是否都有验收覆盖？
- 产品是否明确区分可执行工作流语义与组织治理、人类判断和权限制度？
