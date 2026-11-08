# OGS 固定业务事件协议与 Studio 配置方案

> **文档状态：已生效架构约束。** 业务事件由
> `src/business-events.ts` 的共享注册表管理，`src/runtime/business-events.ts` 只提供 Runtime 导出入口。普通 Flow 只能使用注册的业务事件；
> `START` 和 `ERROR*` 是系统保留事件。

## 0. 文档边界与权威实现

本文只定义可路由的业务事件、系统保留事件的边界，以及 Studio/Role 契约如何使用这些事件。
它不把所有 `events.ndjson` 记录都变成业务事件：Join、Loop、审核、Result、恢复和运行生命周期记录
属于 Runtime 证据事件，由 `src/runtime/transition-planner.ts` 的 `RuntimeTransitionEvent` 联合类型、
`src/runtime/types.ts` 的状态合同和 Runtime 测试共同约束。

| 问题 | 权威位置 | 说明 |
| --- | --- | --- |
| 哪些事件可以出现在 Flow/Role 输出中？ | `src/business-events.ts` | `BUSINESS_EVENT_TYPES`、`isBusinessEvent()`、`BUSINESS_EVENT_KIND` |
| 哪些事件是系统保留的？ | `src/business-events.ts` 与 `src/runtime/error-flow-utils.ts` | `START`、`ERROR`、`ERROR.<code>` 只能由系统边界产生 |
| Runtime 如何记录审核、Join、Loop 和 Result？ | `src/runtime/transition-planner.ts`、`src/runtime/graph-runner.ts` | 这些是审计/控制事实，不能作为 Flow 事件 |
| Studio 如何展示和编辑？ | `src/visualizer/studio-client/` 与 `src/visualizer/studio-authoring.ts` | 只能消费共享注册表，不复制一套事件枚举 |

当本文与实现或可执行测试不一致，按 [OGSystem Constitution and Rules](ogsystem-constitution-v1.md)
的权威顺序修正本文；不要通过增加兼容事件来掩盖漂移。

## 1. 决策

当前版本将业务事件收敛为固定集合。Role 不再定义领域化事件名，例如 `ANALYSIS_READY`、`CODE_READY` 或 `READY_TO_DEPLOY`；正常业务差异通过 Role、目标 Flow、条件路由和 `data` 表达。

当前运行时合同由 `src/runtime/*`、`docs/usage/ogsystem-semantics-manual.md`、
`docs/usage/ogsystem-orchestration-semantics-v1.md` 和本文共同定义。解析器、Role 包加载器、
Studio 编辑器和运行时输出校验均引用同一注册表。

本方案采用直接切换：

- 不提供旧事件名迁移工具；
- 不提供旧事件名兼容模式；
- 新版本加载到不在固定集合中的业务事件时直接失败；
- 现有示例、测试夹具、语义定义和规范手册全部改为新协议；
- `START` 和 `ERROR.*` 保留为系统保留事件，不属于 Role 业务事件集合。

Runtime 还定义独立的审计事件集合 `RUNTIME_AUDIT_EVENT_TYPES`，当前包括：

```text
human_review_rejected
human_review_decision_rejected
```

这些记录只描述人工审核控制面的结果：`human_review_rejected` 表示预算审核的
`reject` 决定已沿合法 `REJECTED` 路由落地；`human_review_decision_rejected` 表示提交的
审核决定未通过 `reviewId`、轮次、血缘、分支或状态版本校验。两者都不能出现在 Mermaid
Flow、Role `outputs.events` 或可路由业务事件列表中。Team Site 和 Visualizer 只将其作为
运行时间线和调试审计记录展示。

这次直接切换已应用到当前源码、TeamVersion、角色包、示例和测试夹具；当前输入边界不提供旧事件名的兼容或迁移。
后续如果扩展固定集合，必须先更新共享注册表、契约测试和本协议，再更新活动案例与发布证据。

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
APPROVAL_PROPOSED
APPROVED
REJECTED
NEEDS_REWORK
BLOCKED
```

| 事件 | 固定语义 | 典型目标 |
| --- | --- | --- |
| `READY` | 当前 Role 已产出可交接结果 | 下游处理 Role 或 End |
| `APPROVAL_PROPOSED` | 当前 Role 建议批准，但不代表最终授权 | 授权 Role 或人工审核 |
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

`APPROVAL_PROPOSED` 表示业务角色提出拟批准建议，不等同于人工审核动作 `approve`，也不
直接产生 `human_review_approved`。最终批准仍需由有权限的业务角色或人工审核控制面产生。

### 4.3 业务阻塞

```mermaid
analyst -->|BLOCKED| material-support[Role:material-support]
material-support -->|READY| analyst
```

`BLOCKED` 不等于 Runtime `failed`。它是一个合法业务结果，说明流程应进入补救或等待路径。

### 4.4 循环预算耗尽与人工审核

循环预算是全局 Runtime 安全边界。任何循环作用域或角色激活超过预算时，Runtime 不得
按原业务事件、`onExhausted` 或 End 自动继续，也不得猜测下游目标。它必须先写入独立的
Runtime 控制事件 `loop_exhausted`，然后将运行置为 `waiting_review`，等待人工决定。

```text
running -> loop_exhausted -> waiting_review
                              -> running
                              -> done
                              -> stopped / failed
```

人工审核可以选择：

- `continue`：选择已有合法目标，并明确增加的轮数或新预算；
- `rework`：选择已有合法返工目标，并明确增加的轮数或新预算；
- `terminate`：按审核作用域终止分支或整个运行；
- `reject`：进入已声明的业务拒绝路径；没有合法拒绝路径时拒绝该操作。

`approve` 不能无条件绕过预算。新增预算只对当前运行、循环作用域和 lineage 生效，并受
审核请求自身的 `maxAdditionalRounds` 上限约束。没有人工决定时，运行保持 `waiting_review`，不得继续激活角色。

`loop_exhausted` 属于 Runtime 图控制事件，不属于固定业务事件集合。它必须与
`APPROVAL_PROPOSED`、`APPROVED`、`REJECTED`、`NEEDS_REWORK` 等业务事件分开记录和展示。
人工审核决定通过现有 Human Review 控制面持久化，并记录 loop ID、触发角色、目标角色、
当前轮次、预算、决策人、决策时间和新增预算。当前实现把单次 `maxAdditionalRounds`
绑定为 `max(1, maxRounds)`；它是审核请求的明确上限，不代表可无限追加，独立的运维额度策略
需要后续增加显式配置后才会生效。

### 4.5 多个同名事件出边

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

## 7. 已落地实现与维护规则

### 7.1 共享注册表

当前实现位于：

```text
src/business-events.ts
src/runtime/business-events.ts  # Runtime re-export
```

注册表提供：

- `BUSINESS_EVENT_TYPES`；
- `BusinessEventType` 类型；
- `BUSINESS_EVENT_KIND`；
- `isBusinessEvent()`；
- `assertBusinessEvent()`；
- `isRuntimeErrorEvent()`、`isRuntimeControlEvent()`、`isRuntimeAuditEvent()`。

新增业务事件必须先修改该注册表、类型和测试，再更新 compiler、Role 契约、Studio 和文档。
新增 Runtime 审计事件必须先加入 `RuntimeTransitionEvent` 或对应集中事件合同及测试；不得在业务边或
Role 输出中直接写入审计事件名。

### 7.2 输出解析与编译门禁

`src/runtime/role-output-parser.ts` 与 Semantic IR 编译链已经执行以下门禁：

- `event` 必须是固定业务事件；
- `ERROR*` 继续单独拒绝；
- 不允许新增 `status`、`state`、`phase` 等自由字段；
- 保持输出对象只允许 `event`、`content`、`data`。

### 7.3 Studio 与运行审计

以下位置共同消费同一注册表：

- `src/runtime/semantic-ir-compiler.ts`：校验 Semantic IR 事件类别；
- `src/runtime/role-repo.ts`：校验 Role 输出事件集合；
- `src/visualizer/project-readiness.ts` 与 `src/visualizer/studio-client/`：发布与编辑门禁；
- `src/visualizer/studio-authoring.ts`：生成 Mermaid 和 Role 包时只写固定事件。

稳定诊断包括：

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

## 10. 维护时必须同步更新的文档与语义定义

事件协议变化时必须同步修改以下内容，不能只修改 Runtime：

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

- 固定集合中的六个事件全部通过；
- 自定义事件被拒绝；
- `START` 不能由 Role 输出；
- `ERROR.*` 不能由 Role 输出；
- 生命周期词不能作为业务事件；
- Role `outputs.events` 与普通出边集合不一致时失败；
- `READY` 的 Role-specific `data` Schema 可以不同；
- `APPROVAL_PROPOSED` 不能绕过人工审核授权；
- 循环预算耗尽必须生成 `loop_exhausted` 并进入 `waiting_review`；
- 没有人工决定时不得继续运行；
- 人工继续或返工必须使用已声明的合法目标并记录新增预算；
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

发布前增加仓库扫描，确保生产 Flow、Role 契约和活动案例不存在新协议范围外的普通业务事件。
下面是应被拒绝的历史命名示例，不是兼容白名单：

```text
ANALYSIS_READY
ANALYSIS_DONE
CODE_READY
READY_TO_DEPLOY
SHIP_BLOCKED
```

扫描只针对新协议要求改写的 TeamVersion、示例和测试，不保留兼容白名单；生产业务边只能使用共享注册表中的 `READY`、`APPROVAL_PROPOSED`、`APPROVED`、`REJECTED`、`NEEDS_REWORK`、`BLOCKED`。

## 12. 持续完成标准

每次发布固定事件协议的变更都必须满足以下条件：

- Runtime、Compiler、Semantic IR、Studio 和发布门禁使用同一事件注册表；
- 新建团队不能输入或保存自定义业务事件；
- Role 输出只能使用固定业务事件信封；
- `READY` 可在不同 Role 中携带不同的 `data` Schema；
- Runtime 状态与业务事件在审计和 UI 中分开显示；
- 多同名事件必须通过条件路由消歧；
- 所有示例、测试和手册已更新；
- 语义定义、规范手册和架构决策已同步；
- 全量构建、Runtime 测试和 Studio 浏览器验收通过。
