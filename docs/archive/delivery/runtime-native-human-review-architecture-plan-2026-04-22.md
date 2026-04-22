# Runtime-Native Human Review Architecture Plan

Date: 2026-04-22  
Status: proposed  
Scope: OGSystem graph runtime, parser/compiler, state model, persistence/resume, CLI, audit, visualizer

## 1. 背景

当前仓库已经有 `human-approve-gate`、`human-signal-wait` 这类模板 role，用显式节点方式把人工审批嵌进图里。这个方案可运行，但它有三个根问题：

1. 人工审核被建模成了“角色节点”，而不是运行时控制语义。
2. 图里出现了不属于业务主线的流程噪声，Mermaid 可读性下降。
3. agent 输出与人工决策语义混在一起，违背“agent 不替代人”的边界。

长期正确架构应当是：

- `human review` 不是 role。
- `human review` 不是隐藏 gate node。
- `human review` 不是 `role.mode` 的变种。
- `human review` 是 runtime 原生的“后置人工审核检查点”。

role 只负责产出候选结果；是否放行、打回、暂停、终止，由人类作出控制决策，runtime 负责挂起、恢复、审计与续流。

## 2. 目标

本方案的目标是把人工审核升级为 OGSystem 的一等运行时语义：

1. 对外表现为 role 的审核开关，而不是额外的 gate role。
2. 对内由 runtime 原生管理，不引入兼容层或隐藏节点。
3. 保持文件优先、checkpoint、resume、审计的现有设计哲学。
4. 保证未经人工批准的产物绝不进入下游主结果通道。
5. 支持 `approve / rework / pause / terminate` 四类人工决策。
6. 把 `execution outcome` 与 `released result` 显式拆模，避免在现有主链里继续混用一份 `storedResult`。

## 3. 非目标

本方案暂不包含以下内容：

1. 不做旧 `human-approve-gate` 方案的兼容运行时转换。
2. 不做外部控制平面或分布式审批服务。
3. 不做 GUI 优先交互；第一阶段以 CLI + 文件型控制为主。
4. 不把人工审核设计成业务 event。
5. 不允许 timeout 自动 approve。

## 4. 核心原则

### 4.1 Review 不是业务流转事件

role 产出的 `event` 仍然是业务 event，例如 `PASS / REJECT / DONE / ROUTE_A`。  
人工审核的动作 `approve / rework / pause / terminate` 只能是 runtime control action，不能进入 role output schema。

### 4.2 Draft 不等于 Released Result

role 执行成功后的输出先成为 `draft result`。  
只有人工 `approve` 后，draft 才能提升为 `released result`，写入 `graphState.roleResults` 并驱动 downstream transition。

### 4.3 Review 是后置检查点，不是额外 role

业务图中只保留业务 role。  
人工审核是 role 成功执行后的 runtime checkpoint，不再要求 Mermaid 显式画 `human gate` 节点。

### 4.4 Fail-Closed

任何 review 配置错误、review 决策缺失、review timeout、resume 对账异常，都必须 fail-closed，绝不默默放行。

## 5. DSL 设计

### 5.1 新增元数据

推荐最小集合：

```mmd
%% review.mode.writer=required
%% review.timeout.writer=86400
%% review.timeout.action.writer=pause
%% review.rework.target.writer=writer
%% review.rework.max.writer=3
%% review.terminate.scope.writer=branch
```

### 5.2 语义定义

- `review.mode.<roleId>=required`
  - 该 role 成功执行后必须进入人工审核。
- `review.timeout.<roleId>=<seconds>`
  - review 等待超时时间。
- `review.timeout.action.<roleId>=pause|terminate`
  - 超时后动作。
- `review.rework.target.<roleId>=<roleId>`
  - 打回重做时重新激活的目标 role，默认当前 role 自身。
- `review.rework.max.<roleId>=<n>`
  - 最大重做轮次。
- `review.terminate.scope.<roleId>=branch|run`
  - 人工终止的作用域。

### 5.3 禁止项

以下设计禁止进入 DSL：

1. `review.timeout.action=approve`
2. `review.on_approve=<event>`
3. `review` 直接改变 role 原始业务 event
4. `review` 通过 Mermaid 边声明自己的 event 路由

原因很简单：批准后必须继续走 role 原始业务结果，不重新发明一层“审核事件流”。

## 6. 类型系统与执行计划

需要在 `src/runtime/types.ts` 新增以下核心类型。

### 6.1 新增类型

- `HumanReviewSpec`
- `PendingHumanReview`
- `HumanReviewDecision`
- `HumanReviewDecisionRecord`
- `ReleasedRoleResult`
- `DraftRoleResult`

### 6.2 推荐结构

```ts
type HumanReviewSpec = {
  mode: "required";
  timeoutSeconds?: number;
  timeoutAction: "pause" | "terminate";
  reworkTargetRoleId: string;
  reworkMax?: number;
  terminateScope: "branch" | "run";
};
```

```ts
type PendingHumanReview = {
  reviewId: string;
  roleId: string;
  branchId: string;
  lineageId: string;
  loopIteration: number;
  executionId: string;
  selectedEvent?: string;
  draftResult: StoredRoleResult;
  requestedAt: string;
  requestedByExecutionId: string;
  status: "pending" | "paused" | "resolved" | "expired";
  round: number;
  spec: HumanReviewSpec;
};
```

`reviewId` 不是自由分配字段，必须由稳定输入确定性生成。  
一期执行稿要求：

```ts
reviewId = `review.${branchId}.r${round}`
```

其中：

- `branchId` 来自待审 branch 的稳定标识
- `round` 来自同一 `roleId + lineageId` 下的 review 轮次计数

resume / reconcile / inspect / decision apply 全部只能以这个 `reviewId` 为主键收敛，不能在恢复时重新分配新 id。

```ts
type HumanReviewDecisionRecord = {
  reviewId: string;
  committedAt: string;
  decidedAt: string;
  decision: "approve" | "rework" | "pause" | "terminate";
  comment?: string;
  actor?: string;
  scope?: "branch" | "run";
  checkpointSequence?: number;
  appliedAt?: string;
  reconciledAt?: string;
};
```

这里的 `checkpointSequence / appliedAt / reconciledAt` 不是附加信息，而是 review decision 幂等 apply 的最小合同。  
它应当与当前 `RoleExecutionOutcomeRecord` 的 `checkpointSequence / reconciledAt` 处于同级别地位，不能只靠“存在 decision.json 文件”来推断已应用。

### 6.3 执行计划升级

`ExecutionPlanNode` 新增：

```ts
review?: HumanReviewSpec;
```

`GraphMetadata` 新增：

```ts
reviewByRoleId: Record<string, HumanReviewSpec>;
```

## 7. 状态模型

### 7.1 Branch 状态

当前 `BranchRecord.status` 只有 `active | completed`，这不够。  
需要扩展为：

- `active`
- `waiting_review`
- `completed`

`pause` 只保留在 review 对象上，不再作为 branch 状态源。  
原因是当前 scheduler 只依赖 branch 是否 `active` 来决定可执行性；如果把 pause 同时放进 branch 和 review，会制造双状态源和一致性风险。

### 7.2 Run 状态

当前 `GraphRunStatus` 为：

- `running`
- `stopping`
- `stopped`
- `done`
- `failed`

一期执行稿不修改 `GraphRunStatus`。  
先保持现有枚举收敛，把“是否正在等待人工审核”建成派生视图：

- `pendingReviewCount > 0`
- `hasWaitingHumanReview = true`

该派生标记暴露到 `status / inspect / visualizer / summary projection`。  
是否在后续版本引入显式 `waiting_human_review` 或 `terminated_by_human`，等主链拆模稳定后再评估。

### 7.3 GraphState 新增字段

推荐新增：

- `pendingReviewsById: Record<string, PendingHumanReview>`
- `reviewHistoryByBranchId: Record<string, HumanReviewDecisionRecord[]>`
- `reviewRoundByRoleLineageKey: Record<string, number>`
- `lastWaitingReviewId?: string`

### 7.4 关键约束

1. 未批准草稿不能写入 `roleResults`。
2. `waiting_review` 分支不能被 scheduler 当成可执行分支。
3. run 只要存在 unresolved review，就不能进入 `done`。
4. pause 只能改变 review 状态，不能再额外改变 branch 状态枚举。

## 7A. 前置重构约束

这不是 Phase 3 的局部能力，而是运行时主链重构。  
当前 `transition-planner` 会直接把 `storedResult` 和 `selectedEvent` 写入 `GraphState`，而 `GraphState` 目前只认识一份 `roleResults` 主结果通道。  
因此 review 原生化的前置条件是先完成：

1. `execution outcome` 与 `released result` 拆模
2. `draft result` 与 `released result` 拆模
3. transition planner 改成“可延迟释放结果”的主链

## 8. 执行时序

### 8.1 普通 role

无 review 配置时，沿用当前时序：

1. role 执行
2. 校验输出
3. 写 durable outcome
4. planner 计算 transition
5. checkpoint
6. downstream activation

### 8.2 启用 review 的 role

有 `review.mode=required` 时，改为：

1. role 执行成功
2. 校验输出
3. 写 durable execution outcome
4. 生成 `PendingHumanReview`
5. 当前 branch 标记为 `waiting_review`
6. 写 `human_review_requested` 事件
7. 本次运行正常结束，等待人工决策

注意：

- 此时不写入 `graphState.roleResults`
- 不做 downstream transition
- 不激活下游 branch
- `status/inspect/visualizer` 通过 `pendingReviewCount` 暴露等待状态，而不是修改 `GraphRunStatus`

## 9. 人工决策语义

### 9.1 Approve

批准后：

1. 将 `draftResult` 提升为 released result。
2. 写入 `graphState.roleResults`。
3. 写入 `selectedEventByBranchId`。
4. 执行原本应发生的 downstream transition。
5. 当前 review 标记为 `resolved`。
6. 写 `human_review_approved` 事件。

### 9.2 Rework

打回后：

1. draft 不放行。
2. 激活 `review.rework.target`。
3. 注入 reviewer comment、上一版草稿、review round。
4. 当前 review 标记为 `resolved`。
5. 写 `human_review_rework_requested` 事件。

建议：

- rework 激活新的 branchSequence
- 分配新的 `sessionLineageId`

原因是防止模型继续把被否决版本当成隐式上下文真相。

### 9.3 Pause

暂停后：

1. `PendingHumanReview.status=paused`
2. branch 继续保持 `waiting_review`
3. 后续仍可继续 `approve / rework / terminate`
4. 写 `human_review_paused` 事件

### 9.4 Terminate

终止后分两类：

- `branch`
  - 只结束当前分支
- `run`
  - 整个 run 进入终止态

必须显式记录终止原因和作用域。

一期执行稿的硬约束：

- `terminate(scope=branch)` 不修改 `GraphRunStatus`；只结束当前分支，并通过审计与 summary 派生字段暴露“该分支被人工终止”。
- `terminate(scope=run)` 映射到现有 `GraphRunStatus="stopped"`。

原因：

1. 一期不扩展 `GraphRunStatus` 枚举。
2. `done` 会误导为成功完成。
3. `failed` 会把人工控制终止和运行时失败混在一起。
4. `stopped` 最接近“外部控制面主动终止运行”的既有语义。

配套呈现要求：

- `summary` 增加派生字段，例如 `terminatedByHuman: true`
- `summary`/`inspect`/CLI 明确展示 `stopReason=human_review_terminate_run`
- `status` 仍返回现有枚举 `stopped`，但人类可读文案必须写明这是 human review terminate，而不是普通 operator stop

## 10. Review Feedback 投影

rework 不是简单重跑，必须显式把 reviewer feedback 注入输入投影。

### 10.1 新增 selector

建议在 `context.map` selector 白名单中加入：

- `global.human_review.current`
- `global.human_review.current.comment`
- `global.human_review.current.round`
- `global.human_review.current.previous_output`
- `global.human_review.current.previous_output.content`
- `global.human_review.current.previous_output.data`

### 10.2 作用

这样 rework role 能明确看到：

1. 被打回原因
2. 当前是第几轮重做
3. 上一版输出具体内容

而不是依赖模型 session 记忆或外层 prompt 拼接。

## 11. 持久化与 Resume

这是本方案最关键的部分。

### 11.1 新增工件

建议新增：

- `control/reviews/<review-id>.request.json`
- `control/reviews/<review-id>.decision.json`

request 和 decision 都应是 durable 文件，不依赖 summary/timeline 投影。
其中 `decision.json` 必须带显式 apply/reconcile 元数据，不能只存决策内容。

### 11.2 request 工件建议内容

```json
{
  "reviewId": "review.writer@1#3.r1",
  "roleId": "writer",
  "branchId": "writer@1#3",
  "lineageId": "writer@1#3",
  "loopIteration": 1,
  "executionId": "exec-...",
  "requestedAt": "2026-04-22T10:00:00.000Z",
  "selectedEvent": "DONE",
  "round": 1,
  "spec": {
    "mode": "required",
    "timeoutSeconds": 86400,
    "timeoutAction": "pause",
    "reworkTargetRoleId": "writer",
    "reworkMax": 3,
    "terminateScope": "branch"
  }
}
```

### 11.3 decision 工件建议内容

```json
{
  "reviewId": "review.writer@1#3.r1",
  "committedAt": "2026-04-22T11:00:00.000Z",
  "decidedAt": "2026-04-22T11:00:00.000Z",
  "decision": "rework",
  "comment": "缺少证据链，请补充来源与结论边界",
  "actor": "operator",
  "scope": "branch",
  "checkpointSequence": 42,
  "appliedAt": "2026-04-22T11:00:02.000Z",
  "reconciledAt": "2026-04-22T11:00:02.000Z"
}
```

语义约束：

1. `committedAt` 表示该 decision 文件已 durable。
2. `checkpointSequence` 表示该 decision 已被纳入某次 graph checkpoint。
3. `appliedAt` 表示该 decision 的 graph update 已应用。
4. `reconciledAt` 表示 resume 对账已经确认该 decision 不需要再次 apply。

### 11.4 Resume 恢复顺序

恢复时：

1. 读取 `state.json`
2. 读取 `pendingReviewsById`
3. 扫描 `control/reviews/*.decision.json`
4. 仅对 `checkpointSequence/appliedAt/reconciledAt` 未完成的 decision 做幂等 reconcile
5. 恢复 scheduler 推进

### 11.5 必须覆盖的 crash windows

1. request 已落盘，但 `state.json.pendingReviewsById` 尚未更新
2. decision 已落盘，但 graph update 尚未 checkpoint
3. approve 已提升 released result，但 downstream activation 尚未 checkpoint
4. rework 已创建新分支，但 review 状态尚未标记 resolved

### 11.6 幂等原则

重复 resume 必须满足：

1. 不重复释放同一个 draft
2. 不重复创建同一个 rework branch
3. 不重复写入同一个 review decision audit
4. 不重复 apply 已有 `checkpointSequence/appliedAt/reconciledAt` 的 decision
5. 不重复创建新的 `reviewId`

### 11.7 Apply Marker 原则

review decision 的 apply marker 语义应对齐现有 `RoleExecutionOutcomeRecord`：

- durable decision file 先写入
- graph checkpoint 后再补 `checkpointSequence`
- resume 对账完成后写 `reconciledAt`

不能把“decision 文件存在”当成“decision 已生效”。

## 12. CLI 设计

### 12.1 新增 review 生命周期命令

建议新增：

```bash
ogs run review list <run-id>
ogs run review inspect <run-id> <review-id>
ogs run review decide <run-id> <review-id> --decision approve
ogs run review decide <run-id> <review-id> --decision rework --comment "..."
ogs run review decide <run-id> <review-id> --decision pause --comment "..."
ogs run review decide <run-id> <review-id> --decision terminate --scope branch
ogs run review decide <run-id> <review-id> --decision terminate --scope run
```

### 12.2 现有命令增强

- `ogs run status`
  - 显示 `hasWaitingHumanReview`
  - 显示 pending review count
- `ogs run inspect`
  - 显示 pending reviews、review history、当前 round、latest decision
- `ogs run resume`
  - 发现未应用 decision 时自动 reconcile

### 12.3 CLI 原则

CLI 只是 control surface，不是语义本体。  
review 的真实语义仍以持久化文件和 graph state 为准。

## 13. 审计与可观察性

### 13.1 新增 runtime event

建议增加：

- `human_review_requested`
- `human_review_approved`
- `human_review_rework_requested`
- `human_review_paused`
- `human_review_terminated`
- `human_review_expired`
- `human_review_decision_reconciled`

### 13.2 新增指标

建议在 run summary 或可视化层新增：

- `pendingReviewCount`
- `averageReviewLatencyMs`
- `approvalCount`
- `reworkCount`
- `pauseCount`
- `terminateCount`
- `averageReworkRoundsByRole`

### 13.3 Visualizer 展示

可视化至少要能看见：

1. 当前哪些 branch 在 `waiting_review`
2. 每个 review 的 request 时间、decision 时间、actor、comment
3. 某个 released result 对应哪一次 draft 和哪一次 approve

## 14. Parser / Compiler 约束

### 14.1 Parser 白名单

`parse-mermaid.ts` 增加：

- `review.mode.*`
- `review.timeout.*`
- `review.timeout.action.*`
- `review.rework.target.*`
- `review.rework.max.*`
- `review.terminate.scope.*`

### 14.2 编译期拒绝项

编译期直接拒绝：

1. `review.mode.*` 指向不存在的 role
2. `review.rework.target.*` 指向不存在的 role
3. `review.rework.max.*` 非正整数
4. `review.timeout.*` 非法值
5. `review.timeout.action.*` 不是 `pause|terminate`
6. `review.terminate.scope.*` 不是 `branch|run`
7. role 为 `noop` 但声明 `review.mode=required`

### 14.3 Compiler Digest

review 语义必须进入 compiler digest / plan fingerprint。  
任何 review contract 变化都必须导致 resume 拒绝继续。

## 15. 状态机设计摘要

### 15.1 无 review

```text
active -> completed
```

### 15.2 有 review

```text
Branch perspective:
active -> waiting_review -> completed

Review perspective:
pending -> paused -> resolved
pending ---------> resolved
```

### 15.3 Run 级状态摘要

```text
GraphRunStatus stays unchanged in phase 1:
running -> done
running -> failed

Operator-facing derived state:
running + pendingReviewCount>0 => hasWaitingHumanReview=true
```

## 16. 代码改动清单

### 16.1 数据契约

- `src/runtime/types.ts`
- `src/runtime/run-summary-schema.ts`
- `src/runtime/run-artifact-policy.ts`

### 16.2 Parser / Compiler

- `src/runtime/parse-mermaid.ts`
- `src/runtime/compiler.ts`
- `src/runtime/static-semantics.ts`

### 16.3 Execution Plan

- `src/runtime/execution-plan.ts`

### 16.4 状态推进

- `src/runtime/graph-runtime-state.ts`
- `src/runtime/transition-planner.ts`
- `src/runtime/graph-runner.ts`

### 16.5 Role 执行

- `src/runtime/role-executor.ts`

### 16.6 输入投影

- `src/runtime/role-input-projector.ts`

### 16.7 Resume / Artifacts

- `src/runtime/run-artifacts.ts`
- `src/runtime/adapter.ts`

### 16.8 CLI / Lifecycle

- `src/runtime/cli.ts`
- `src/runtime/project-lifecycle.ts`

### 16.9 Audit / Visualizer

- `src/runtime/audit-recorder.ts`
- `src/runtime/timeline-projector.ts`
- `src/visualizer/server.ts`

### 16.10 文档与示例

- `docs/usage-manual.md`
- `docs/DECISIONS.md`
- `docs/ogsystem-orchestration-semantics-v1.md`
- 新 example
- 旧 `human-gate-workflow` 改为 legacy

## 17. 实施任务清单

### Phase 0: 主链拆模前置重构

- [x] 拆分 `execution outcome` 与 `released result`
- [x] 拆分 `draft result` 与 `released result`
- [x] 让 `transition-planner` 支持“结果已 durable 但尚未 release”的主路径
- [x] 让 `GraphState` 不再只依赖单一 `roleResults` 通道表达全部执行结果

### Phase 1: 语义与数据模型

- [x] 定义 `HumanReviewSpec`
- [x] 定义 `PendingHumanReview`
- [x] 定义 `HumanReviewDecisionRecord`
- [x] 扩展 `BranchRecord.status`
- [x] 扩展 `GraphState`
- [x] 扩展 `ExecutionPlanNode.review`
- [x] 为 decision 增加 `checkpointSequence / appliedAt / reconciledAt`

### Phase 2: Parser / Compiler

- [x] 增加 `review.*` 元数据白名单
- [x] 实现 review 配置解析
- [x] 增加 review 静态校验
- [x] 将 review 纳入 compiler digest / plan fingerprint

### Phase 3: Runtime 执行主链

- [x] role 执行成功后生成 draft result
- [x] review-required 情况下创建 `PendingHumanReview`
- [x] 阻止 draft 直接进入 `roleResults`
- [x] 将 branch 置为 `waiting_review`
- [x] 暴露 `pendingReviewCount` 与 `hasWaitingHumanReview` 派生状态

### Phase 4: Review Decision Apply

- [x] 实现 approve apply
- [x] 实现 rework apply
- [x] 实现 pause apply
- [x] 实现 terminate apply
- [x] 实现 decision reconcile 幂等逻辑

### Phase 5: Resume / Checkpoint

- [x] review request durable 落盘
- [x] review decision durable 落盘
- [x] resume 时 decision reconcile
- [x] crash window 幂等恢复

### Phase 6: Context Projection

- [x] 增加 `global.human_review.*` selectors
- [x] rework 输入投影支持 comment / round / previous_output

### Phase 7: CLI

- [x] 增加 `ogs run review list`
- [x] 增加 `ogs run review inspect`
- [x] 增加 `ogs run review decide`
- [x] `status / inspect / resume` 集成 review 信息

### Phase 8: Audit / Visualizer

- [x] review 事件写入审计流
- [x] timeline 增加 review 事件投影
- [x] visualizer 展示 pending review 与 review history

### Phase 9: 文档与示例

- [x] 重写 active docs
- [x] 增加 runtime-native review example
- [x] 将旧 human gate example 标为 legacy

### Phase 10: 测试

- [x] parser 测试
- [x] compiler 测试
- [x] runtime integration 测试
- [x] review + resume crash 测试
- [x] CLI 测试
- [x] visualizer 测试

## 18. 检查清单

### 18.1 架构检查

- [ ] `human review` 是否完全脱离 role 节点
- [ ] `human review` 是否完全脱离 role 输出 schema
- [ ] approve 后是否继续走原始业务 event
- [ ] 未审核草稿是否绝不进入 `graphState.roleResults`
- [ ] timeout 是否 fail-closed

### 18.2 状态机检查

- [ ] `waiting_review` 分支不会被 scheduler 当成 active
- [ ] 有 unresolved review 时 run 不会提前 `done`
- [ ] pause 不会引入第二套 branch 状态源
- [ ] pause 不会丢失 review 上下文
- [ ] terminate.scope=branch 与 `run` 行为明确分离

### 18.3 Resume 检查

- [ ] request 已落盘但 state 未更新时可恢复
- [ ] decision 已落盘但 apply 未 checkpoint 时可恢复
- [ ] decision 的 `checkpointSequence / appliedAt / reconciledAt` 能稳定收敛
- [ ] `reviewId` 在 repeated resume 下保持稳定且不重新分配
- [ ] repeated resume 不重复放行 draft
- [ ] repeated resume 不重复创建 rework branch
- [ ] repeated resume 不重复追加 review audit

### 18.4 输入投影检查

- [ ] rework 时能收到 reviewer comment
- [ ] rework 时能收到 previous_output
- [ ] rework 时能收到当前 round
- [ ] 非 rework 执行不应误收到历史 review 上下文

### 18.5 CLI 检查

- [ ] `ogs run review list` 可枚举待审项
- [ ] `ogs run review inspect` 可显示 request / decision 细节
- [ ] `ogs run review decide` 可正确写入 durable decision
- [ ] `ogs run status` 可显示 `pendingReviewCount / hasWaitingHumanReview`
- [ ] `ogs run resume` 能自动对账 decision

### 18.6 审计检查

- [ ] 可从 released result 回溯 draft
- [ ] 可从 draft 回溯 review decision
- [ ] approve / rework / pause / terminate 都有独立事件
- [ ] visualizer 能展示 pending review 和历史决策

### 18.7 文档检查

- [ ] 活跃文档已不再把 human gate role 视为最佳实践
- [ ] DSL 文档以 `review.*` 为准
- [ ] 示例不再要求显式画 gate role

## 19. 推荐测试矩阵

### 19.1 Parser / Compiler

- review 元数据合法路径
- 缺失 role
- 非法 timeout action
- 非法 terminate scope
- noop role + required review

### 19.2 Runtime 主路径

- approve
- rework
- pause
- terminate(branch)
- terminate(run)

### 19.3 Resume / Crash Windows

- request 落盘后 crash
- decision 落盘后 crash
- decision apply 后 marker 补写前 crash
- approve apply 后 checkpoint 前 crash
- rework branch 创建后 state 持久化前 crash

### 19.4 Interaction With Existing Semantics

- review + join
- review + loop
- review + error flow
- review + branch workspace isolation

## 20. 结论

长期正确架构可以收敛成三条红线：

1. `review 不是 node`
2. `draft 不是 released result`
3. `人工决策是 runtime control action`

只要这三条成立，OGSystem 就能把人工审核从“流程技巧”升级为“运行时原生能力”，同时保持当前文件优先、审计优先、resume 敏感的系统设计。
