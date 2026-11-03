# OGS 固定业务事件协议与 Studio 配置方案

## 1. 决策

OGS 新版本将业务事件收敛为固定集合。Role 不再定义领域化事件名，例如 `ANALYSIS_READY`、`CODE_READY` 或 `READY_TO_DEPLOY`；正常业务差异通过 Role、目标 Flow、条件路由和 `data` 表达。

本方案采用直接切换：

- 不提供旧事件名迁移工具；
- 不提供旧事件名兼容模式；
- 新版本加载到不在固定集合中的业务事件时直接失败；
- 现有示例、测试夹具、语义定义和规范手册全部改为新协议；
- `START` 和 `ERROR.*` 保留为系统保留事件，不属于 Role 业务事件集合。

这是一项协议变更。发布新版本前，仓库中的所有 TeamVersion、角色包、示例和测试数据必须完成改写。

## 2. 事件与状态边界

Role 输出中的 `event` 是业务流转选择，不是 Role 的生命周期状态。

| 层级 | 责任 | 示例 |
| --- | --- | --- |
| Role 生命周期 | Runtime 管理执行过程 | `pending`、`running`、`waiting`、`waiting_review`、`completed`、`failed`、`stopped`、`skipped`、`noop` |
| 业务事件 | Role 选择下一条业务 Flow | `READY`、`APPROVED`、`REJECTED`、`NEEDS_REWORK`、`BLOCKED` |
| 业务结果 | Role 输出的领域数据 | `data.findings`、`data.artifactPath`、`data.reasonCode` |
| 技术错误 | Runtime 产生失败补偿流 | `ERROR`、`ERROR.OUTPUT_SCHEMA`、`ERROR.TOOL_EXECUTION` |

Role 只能通过以下信封输出业务结果：

```json
{
  "event": "READY",
  "content": "分析结果已准备好",
  "data": {
    "findings": [],
    "confidence": 0.92
  }
}
```

不得把 `RUNNING`、`WAITING`、`COMPLETED`、`FAILED` 等生命周期词放入 `event`。不得让 Role 输出 `ERROR.*`；技术失败由 Runtime 统一记录和路由。

## 3. 固定业务事件集合

### 3.1 核心集合

```text
READY
APPROVED
REJECTED
NEEDS_REWORK
BLOCKED
```

| 事件 | 固定语义 | 典型目标 |
| --- | --- | --- |
| `READY` | 当前 Role 已产出可交接结果 | 下游处理 Role 或 End |
| `APPROVED` | 结果通过业务审核或决策 | 发布、交付或 End |
| `REJECTED` | 结果被业务审核否决 | End、阻断或人工处置 |
| `NEEDS_REWORK` | 结果需要修改后重新处理 | 原 Role 或返工 Role |
| `BLOCKED` | 业务条件不足，当前无法继续 | 补救、支持或人工处置 Role |

固定集合只表达通用路由语义，不表达具体产物名称。`READY` 可以表示分析、设计、代码、报告或其他产出，具体含义由 Role 的责任和 `data` Schema 定义。

### 3.2 不加入业务集合的词

以下词不再作为新业务事件：

| 词 | 原因 | 替代方式 |
| --- | --- | --- |
| `DONE`、`COMPLETED` | 与正常完成或交接重复 | 用 `READY`；到 End 表示流程终止 |
| `RUNNING`、`WAITING` | Runtime 生命周期状态 | 由运行事件和状态投影表达 |
| `RETRY`、`TIMEOUT`、`CANCELLED` | Runtime 控制或技术结果 | 由 Runtime 控制面记录 |
| `PARTIAL`、`NO_CHANGE` | 结果属性，不是路由类别 | 写入 `data.completeness` 或 `data.changeType` |
| `ESCALATED` | 处置原因，不是稳定路由类别 | 使用 `BLOCKED`，在 `data.reasonCode` 中说明 |

### 3.3 系统保留事件

```text
START
ERROR
ERROR.<UPPER_SNAKE_CASE_CODE>
```

`START` 只能出现在系统开始节点的结构 Flow。`ERROR.*` 只能由 Runtime 失败路径触发，不出现在 Role 的 `allowed_events`，也不能由 Role 输出伪造。

## 4. 语义规则

### 4.1 正常交接

```mermaid
flowchart TD
    start[开始] --> analyst[Role:analyst]
    analyst -->|READY| reviewer[Role:reviewer]
    reviewer -->|APPROVED| end[结束]
```

`analyst` 返回 `READY` 并不表示“分析”这一通用事件，而表示该责任席位当前的结果已经满足交接契约。

### 4.2 审核与返工

```mermaid
reviewer -->|APPROVED| publisher[Role:publisher]
reviewer -->|NEEDS_REWORK| analyst[Role:analyst]
reviewer -->|REJECTED| end[结束]
```

人工审核动作的映射：

| 审核动作 | 业务事件或 Runtime 动作 |
| --- | --- |
| `approve` | `APPROVED` |
| `rework` | `NEEDS_REWORK` |
| `pause` | Runtime 控制动作 |
| `terminate` | Runtime 控制动作 |

### 4.3 业务阻塞

```mermaid
analyst -->|BLOCKED| material-support[Role:material-support]
material-support -->|READY| analyst
```

`BLOCKED` 不等于 Runtime `failed`。它是一个合法业务结果，说明流程应进入补救或等待路径。

### 4.4 多个同名事件出边

同一个 Role 可以有多个 `READY` 出边，但必须使用条件路由消除歧义：

```mermaid
analyst -->|READY| reviewer
analyst -->|READY| escalation
```

对应 Semantic IR 条件：

```yaml
routes:
  - from: analyst
    event: READY
    to: reviewer
    priority: 10
    when:
      gte:
        - field: event.confidence
        - 0.8

  - from: analyst
    event: READY
    to: escalation
    priority: 10
    when:
      lt:
        - field: event.confidence
        - 0.8
```

无条件的同事件多出边必须 fail closed，并报告 `IR_ROUTE_AMBIGUOUS`。如果不需要条件路由，应使用不同的固定事件，例如 `READY` 与 `BLOCKED`。

## 5. Role 包配置

### 5.1 `role.json`

`outputs.events` 只能包含固定业务事件，并且必须与该 Role 的普通出边事件集合严格一致：

```json
{
  "roleId": "analyst",
  "contractVersion": 1,
  "purpose": "Produces an evidence-based analysis.",
  "outputs": {
    "events": ["BLOCKED", "READY"],
    "postconditions": []
  }
}
```

排序沿用现有稳定排序要求。Studio 根据图谱出边自动生成该字段，手工编辑时由 Runtime 和发布校验再次检查。

### 5.2 `output.schema.json`

Schema 必须约束固定事件集合的子集：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["event", "content", "data"],
  "properties": {
    "event": {
      "enum": ["BLOCKED", "READY"]
    },
    "content": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "additionalProperties": false
}
```

Role 的领域数据继续由该 Role 的 Schema 约束。例如分析角色可以要求 `findings`，审核角色可以要求 `decisionReason`。

### 5.3 事件负载 Schema 的作用域

固定事件名不能意味着所有 `READY` 都共享一份领域 Payload Schema。不同 Role 的 `READY.data` 结构可以不同。

采用以下作用域：

- 全局协议只定义事件名称和事件类别；
- `output.schema.json` 定义 Role 的完整输出结构；
- Flow Contract 定义特定交接的输入/输出结构；
- Semantic IR 条件路由读取经过 Schema 校验的 `event.data`。

不要把所有 Role 的 `READY` 数据强行合并为一个全局 `events.READY` Schema。

## 6. Semantic IR 配置

在 `.ogs/semantics.yaml` 中声明协议版本：

```yaml
version: 1

event_protocol:
  version: 1
```

事件集合由 Runtime 固定提供，不在团队配置中复制一份可编辑列表。Semantic IR 可以保留事件元数据：

```yaml
events:
  READY:
    kind: handoff
  APPROVED:
    kind: decision
  REJECTED:
    kind: decision
  NEEDS_REWORK:
    kind: correction
  BLOCKED:
    kind: exception
```

第一阶段也可以不持久化这段 `events` 元数据，由编译器根据固定注册表推导；如果持久化，必须禁止未知事件类别和未知事件名。

建议在 Semantic IR 类型中增加：

```ts
type BusinessEventKind = "handoff" | "decision" | "correction" | "exception";

type SemanticEventDefinition = {
  kind: BusinessEventKind;
};
```

`START`、`ERROR.*` 不进入 `BusinessEventKind`。

## 7. Runtime 改造清单

### 7.1 新增协议模块

新增：

```text
src/runtime/business-events.ts
```

提供：

- `BUSINESS_EVENTS`；
- `BusinessEvent` 类型；
- `BUSINESS_EVENT_KIND`；
- `isBusinessEvent()`；
- `assertBusinessEvent()`；
- `isReservedRuntimeEvent()`。

### 7.2 输出解析

修改 `src/runtime/role-output-parser.ts`：

- `event` 必须是固定业务事件；
- `ERROR*` 继续单独拒绝；
- 不允许新增 `status`、`state`、`phase` 等自由字段；
- 保持输出对象只允许 `event`、`content`、`data`。

### 7.3 编译与发布校验

修改：

- `src/runtime/compiler.ts`：校验普通 Flow 事件属于固定集合；
- `src/runtime/semantic-ir-compiler.ts`：校验 Semantic IR 事件类别；
- `src/visualizer/project-readiness.ts`：发布前拒绝自定义事件；
- `src/visualizer/studio-authoring.ts`：生成 Mermaid 和 Role 包时只写固定事件。

校验错误建议：

```text
IR_BUSINESS_EVENT_UNKNOWN
IR_BUSINESS_EVENT_RESERVED
IR_BUSINESS_EVENT_ROLE_MISMATCH
IR_ROUTE_AMBIGUOUS
```

### 7.4 运行审计与 UI

审计记录继续保存：

```text
selectedEvent: READY
status: ok
```

UI 分开显示：

```text
角色状态：已完成
业务事件：READY
```

禁止将 `READY` 显示成 Role 生命周期状态，也禁止将 `BLOCKED` 自动显示成 Runtime 失败。

## 8. Studio 构建团队的配置流程

### 8.1 创建 Role

用户配置：

- Role ID 和职责描述；
- 模型或 CLI 执行绑定；
- 输入映射；
- 输出 `data` Schema；
- 审核、循环和权限策略。

用户不输入业务事件名。

### 8.2 创建 Flow

Flow 检查器的自由文本 Event Type 改为固定下拉框：

```text
READY
APPROVED
REJECTED
NEEDS_REWORK
BLOCKED
```

Studio 根据来源和目标关系给出默认建议：

| Flow 场景 | 默认建议 |
| --- | --- |
| 普通 Role -> 下游 Role | `READY` |
| 审核 Role -> 继续执行 | `APPROVED` |
| 审核 Role -> 返工目标 | `NEEDS_REWORK` |
| 审核 Role -> 终止 | `REJECTED` |
| Role -> 补救角色 | `BLOCKED` |
| Role -> End | `READY` 或 `APPROVED` |

用户仍可以在固定集合中选择，但不能添加新值。

### 8.3 自动生成 Role 契约

保存图谱时：

1. 收集 Role 的普通出边事件；
2. 去重并稳定排序；
3. 写入 `role.json.outputs.events`；
4. 更新 `output.schema.json` 的 `event.enum`；
5. 保留用户编辑的 `data` Schema；
6. 运行静态校验和条件路由歧义检查。

### 8.4 构建提示词

Runtime 注入：

```json
{
  "allowed_events": ["BLOCKED", "READY"]
}
```

Prompt 模板统一要求：

```text
Return exactly one JSON object matching output.schema.json.
The event must be one of the provided allowed_events.
Use READY for a valid result that can be handed off.
Use BLOCKED when a business prerequisite is missing.
Do not return runtime statuses such as RUNNING, WAITING, FAILED, or COMPLETED.
```

不同 Role 的职责说明和 `data` 字段说明仍由 Studio 生成到 Role Prompt 中。

## 9. 配置示例

### 9.1 线性流程

```mermaid
flowchart TD
    start[开始] --> research[Role:research]
    research -->|READY| review[Role:review]
    review -->|APPROVED| end[结束]
```

### 9.2 审核返工

```mermaid
flowchart TD
    start[开始] --> implement[Role:implement]
    implement -->|READY| review[Role:review]
    review -->|NEEDS_REWORK| implement
    review -->|APPROVED| end[结束]
    review -->|REJECTED| end[结束]
```

### 9.3 业务阻塞

```mermaid
flowchart TD
    start[开始] --> analyst[Role:analyst]
    analyst -->|BLOCKED| support[Role:support]
    support -->|READY| analyst
    analyst -->|READY| end[结束]
```

## 10. 必须同步更新的文档与语义定义

实现完成后必须同步修改以下内容，不能只修改 Runtime：

### 10.1 语义定义

- `src/runtime/semantic-ir.ts`：加入固定事件类别和协议版本类型；
- `src/runtime/semantic-ir-compiler.ts`：加入固定事件编译和校验；
- `.ogs/semantics.yaml` 示例：增加 `event_protocol.version: 1`；
- `docs/development/compiler-semantics-v1.md`：补充固定事件协议、事件类别和歧义规则。

### 10.2 规范手册

- `docs/usage/ogsystem-semantics-manual.md`：重写事件路由章节，删除“任意非空事件名”的表述，改为固定集合；
- `docs/usage/ogsystem-orchestration-semantics-v1.md`：增加业务事件表、`READY` 语义、多同名事件条件路由和 `ERROR.*` 边界；
- `docs/usage/ogsystem-core-concepts.md`：明确业务事件不是 Role 状态，补充固定事件集合；
- `docs/usage/usage-manual.md`：更新 Role 包、输出 Schema 和 Studio Flow 配置示例；
- `docs/usage/multi-entry-and-terminal-output.md`：将自定义终态事件改为 `READY` 或 `APPROVED`；
- `docs/development/DECISIONS.md`：记录“固定业务事件、无兼容层”的架构决策。

### 10.3 示例与模板

全仓库替换旧事件名，重点包括：

- `examples/` 下 Mermaid 图；
- `examples/` 下 `role.json`；
- `examples/` 下 `output.schema.json`；
- `examples/` 下 Prompt 和脚本；
- `tests/` 下运行、解析、审核、恢复和可视化夹具。

## 11. 测试与验收

### 11.1 Runtime 单元测试

- 固定集合中的五个事件全部通过；
- 自定义事件被拒绝；
- `START` 不能由 Role 输出；
- `ERROR.*` 不能由 Role 输出；
- 生命周期词不能作为业务事件；
- Role `outputs.events` 与普通出边集合不一致时失败；
- `READY` 的 Role-specific `data` Schema 可以不同；
- 同事件多出边无条件时报告 `IR_ROUTE_AMBIGUOUS`；
- 同事件多出边有互斥条件时只激活一个目标。

### 11.2 Studio 浏览器测试

- Flow 编辑器只显示固定事件下拉框；
- 不存在自由文本事件输入；
- 保存图谱后自动生成 Role 事件列表和输出 Schema；
- 新建普通 Role 默认使用 `READY`；
- 审核、返工、阻塞路径生成正确事件；
- 运行面板分开显示 Role 生命周期状态和业务事件；
- Prompt 中注入固定 `allowed_events`。

### 11.3 全量验收

```text
pnpm test
pnpm run build
node --test apps/team-site/tests/studio-simulation-browser.test.mjs
```

发布前增加仓库扫描，确保不存在新协议范围外的普通业务事件：

```text
ANALYSIS_READY
ANALYSIS_DONE
CODE_READY
READY_TO_DEPLOY
SHIP_BLOCKED
```

扫描只针对新协议要求改写的 TeamVersion、示例和测试，不保留兼容白名单。

## 12. 完成标准

满足以下条件后，固定事件协议才算完成：

- Runtime、Compiler、Semantic IR、Studio 和发布门禁使用同一事件注册表；
- 新建团队不能输入或保存自定义业务事件；
- Role 输出只能使用固定业务事件信封；
- `READY` 可在不同 Role 中携带不同的 `data` Schema；
- Runtime 状态与业务事件在审计和 UI 中分开显示；
- 多同名事件必须通过条件路由消歧；
- 所有示例、测试和手册已更新；
- 语义定义、规范手册和架构决策已同步；
- 全量构建、Runtime 测试和 Studio 浏览器验收通过。
