# Semantic IR v1 Handoff 补充规范

本文补充现有 Semantic IR v1 的 Handoff、条件路由、Join、审核、Artifact 和恢复语义。
它沿用现有 Mermaid、`context.map`、Flow Contract、ERROR 流和 `.ogs` 运行存储，不引入新的根配置格式。

## 1. 显式 Handoff

每条 Flow 的交接事实由四部分组成：来源事件、目标角色、字段映射和 Artifact 映射。
目标角色只能接收 `context.map` 明确投影的字段；没有映射的上游字段不会因为同属一个 Run 而自动透传。
Flow Contract 负责校验交接 payload，运行时状态、checkpoint 和执行结果保留在运行投影中。

Handoff 不提供动态 fan-out、可变 Blackboard、抢单池或隐式 Role memory。并行分支继续使用
`sessionLineageId` 隔离模型会话，连续性必须通过已声明的 context、审核反馈或 loop 结果表达。

## 2. 条件路由

条件 AST 只读取现有白名单路径，并采用 fail-closed 路由：

- `exists` 将显式 `null` 视为存在。
- `equals null` 是合法比较。
- 缺失路径参与需要输入值的比较时，记录 `IR_ROUTE_CONDITION_INPUT_MISSING`。
- 数值比较收到非数值操作数或非法路径时，记录 `IR_ROUTE_CONDITION_TYPE_INVALID`。
- 条件返回 false 时记录 `IR_ROUTE_NO_MATCH`，不回退到无条件边。

`route_decision` 只记录候选、优先级、匹配状态和原因，不记录参与比较的原始字段值。

## 3. Join 来源状态

Join 继续按现有 `join.sources.*` 的 source role 语义计算。每个 Join scope 可投影：

- `pending`：尚未完成，且仍可能到达；
- `arrived`：已记录该 source role 的结果；
- `skipped`：已证明该来源不会在当前 scope 再激活；
- `failed`：该 source role 的真实执行失败。

`failed` 不得转换成 `skipped`。`failurePolicy: wait|fail|quorum_continue` 仍决定失败后的收敛方式。
`quorum_of` 达到阈值后只激活一次，迟到来源只写审计。零来源到达不得激活 Join。

## 4. 审核血缘

审核请求、反馈和 decision 绑定 `reviewId`、`round`、`lineageId`。反馈只能通过对应审核返工路径
投影给目标 Role；旧轮次、其他 lineage、重复或已经应用的 decision 必须拒绝。

循环预算耗尽是 Runtime 控制事件 `loop_exhausted`，统一进入 `waiting_review`。预算审核只允许
`continue`、`rework`、`reject`、`terminate`，每个前进决定必须选择当前图中已经声明的目标并满足预算授权。
预算审核的 `loopBudget` 是控制面绑定，负责提供目标白名单、预算上限和默认终止范围；旧版请求中的
Human Review `spec` 只作为兼容投影读取，不会覆盖控制面绑定。
其中 `rework` 的审计事件为 `human_review_rework_requested`，`reject` 的审计事件为
`human_review_rejected`，并分别沿 `NEEDS_REWORK` 与 `REJECTED` 业务边。
普通审核 `approve` 如果其下游目标刚好超出循环预算，也会转入同一预算审核，不会直接产生
`GRAPH_LOOP_BUDGET_EXCEEDED`。

如果当前节点没有声明 `NEEDS_REWORK` 或 `REJECTED` 出边，对应预算审核动作不可用。Team Site 会禁用
空目标选择，`ogs run review inspect` 会报告缺失路径，控制面提交也会以
`GRAPH_LOOP_BUDGET_TARGET_UNAVAILABLE` fail closed。

## 5. Artifact 和最终 Result

Artifact provenance 记录生产 Role、Run 和 branch；媒体类型在 Artifact 记录可用时一并保留。受控 Artifact Resolver 是新增 opaque
引用的唯一读取入口；Resolver 外的 arbitrary reference 不是授权凭证。现有 shared 文件路径继续由
现有执行路径处理，不自动获得 Resolver 授权。

Run 对外公开的最终 Result 只能成功提交一次。分支级终值记录和现有 `end.join.mode` 聚合不受此限制。
Result intent、完成状态和 checkpoint 恢复必须通过幂等提交和 CAS 对账。

## 6. 集中业务事件

普通 Flow 事件来自 `src/runtime/business-events.ts` 的共享注册表：`READY`、`APPROVAL_PROPOSED`、
`APPROVED`、`REJECTED`、`NEEDS_REWORK`、`BLOCKED`。`START` 和 `ERROR*` 是系统保留事件，
`loop_exhausted` 是 Runtime 控制事件。`human_review_rejected` 与
`human_review_decision_rejected` 属于独立的 Runtime 审计事件集合，只进入运行时间线，
不得作为 Flow 或 Role 输出事件。不同 Role 的 `READY.data` 可以使用各自的 Schema；业务事件名
不再承担领域产物名称。

## 7. 恢复指纹

恢复指纹包含 `runtimeSemanticsVersion`，以及现有系统定义、Flow Contract、Role Package、模型选择、
Compiler 和 Runtime Assets 摘要。绝对路径、临时目录和凭据值不参与 digest。语义版本或依赖闭包变化时，
Resume 必须拒绝静默继续；历史 Run 仍可读取其已有运行记录。

结果查询对历史快照采用只读回退：如果 `graphState.status` 缺失但已有 `finalOutputsByRoleId`，允许读取；显式非 `done` 状态优先，不能由输出字段推断运行完成。
