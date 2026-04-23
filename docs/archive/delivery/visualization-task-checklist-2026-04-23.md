# OGSystem 可视化任务清单

Date: 2026-04-23  
Status: delivered  
Scope: 基于现有文件优先架构，为项目创建、配置、运行、人工确认、恢复、仿真补齐可视化能力，不引入数据库等新基础组件

## 1. 目标

在不改变现有 runtime 语义的前提下，把现有能力整理为一套稳定的可视化控制面。

目标边界：

- 继续以 `.ogs/` 和 `.ogs/runs/<run-id>/` 为唯一数据源
- 继续区分恢复权威集与操作员投影
- 前端只消费 visualizer API，不直接读运行目录
- 首版优先做可观察、可追踪、可确认、可恢复，不做拖拽式编排

非目标：

- 不引入数据库、消息队列、搜索引擎、缓存服务
- 不引入前端构建链和重型 Web 框架
- 不重做 runtime
- 不把 visualizer 变成第二套执行引擎

## 2. 总体原则

- [x] 保持完整恢复权威集的地位，不把 resume 语义误降级为少数几个文件
- [x] 当前恢复权威集至少包括：
  - `state.json.graphState`
  - `sessions.json`
  - `plan-fingerprint.json`
  - `checkpoints/<sequence>-<executionId>.json`
  - `control/reviews/<reviewId>.request.json`
  - `control/reviews/<reviewId>.decision.json`
  - `roles/<roleId>/executions/<executionId>/execution-outcome.json`
  - `.resume.lock`
- [x] 保持 `summary.json`、`timeline.jsonl`、`runs-index.json`、`logs/*` 为投影层
- [x] 新增 UI 能力时，优先补 projection/API，不让前端直接依赖原始 `state.json` 结构
- [x] 所有写操作都走现有 lifecycle/control-plane 入口，不绕开 CLI/runtime
- [x] 仿真统一复用 `dry-run` run 目录，不额外引入 simulator 存储

## 3. Phase 0: 现状对齐

- [x] 盘点当前 visualizer 已有接口：`/api/v1/runs`、`/runs/:id`、`/state`、`/events`、`/logs`、`/graph`、`/stream`
- [x] 明确当前 run 级数据源职责：
  - `summary.json` 用于列表/摘要
  - `state.json` 用于详情与恢复诊断的核心状态视图
  - `timeline.jsonl` 用于时间线
  - `events.ndjson` 用于完整历史回放
  - `control/reviews/*` 用于人工确认
  - `roles/<roleId>/executions/*/execution-outcome.json` 用于 crash-window 恢复对账
  - `checkpoints/*` 用于 graph update WAL 回放
  - `logs/*` 用于排障
- [x] 明确项目级数据源职责：
  - `system.mmd`
  - `.ogs/runtime.json`
  - `.ogs/model-selection.json`
  - `.ogs/model-catalog.json`
  - `.ogs/laws.json`
  - `.ogs/user-profile.json`
  - `og-roles/roles/*`
- [x] 在文档中补一页“truth vs projection”说明，避免后续 UI 误用恢复权威文件

验收：

- [x] 团队对“哪些文件可直接给 UI，哪些只能通过投影/API 暴露”达成一致

## 4. Phase 1: 项目级可视化

目标：让用户在不进入 run 详情的情况下看清一个项目能跑什么、怎么跑。

### 4.1 Project Summary Projection

- [x] 新增项目级 summary 投影函数
- [x] 输出 `project-summary.json` 或等价 API 投影
- [x] 投影字段至少包含：
  - `projectName`
  - `systemId`
  - `systemVersion`
  - `entryRoleId`
  - `roleCount`
  - `roleIds`
  - `modelBindings`
  - `execBindings`
  - `reviewedRoleIds`
  - `joinRoleIds`
  - `loopRoleIds`
  - `contextMappedRoleIds`
  - `runsDir`

### 4.2 Project API

- [x] 新增 `GET /api/v1/project`
- [x] 新增 `GET /api/v1/project/system`
- [x] 新增 `GET /api/v1/project/config`
- [x] 新增 `GET /api/v1/project/roles`

### 4.3 Project UI

- [x] 增加项目首页
- [x] 展示 Mermaid 源图和基础系统信息
- [x] 展示角色清单、binding 类型、review/join/loop/context.map 使用点
- [x] 展示配置摘要：
  - runtime
  - model selection
  - laws
  - user profile
- [x] 展示最近 runs 入口

验收：

- [x] 不打开文件系统也能看清当前项目结构和主要配置
- [x] 不需要读 `state.json` 就能完成项目静态理解

## 5. Phase 2: 运行级图视图

目标：把“当前运行到哪里、为什么卡住、哪些 branch 活跃”做成真正可读的图面。

### 5.1 Graph View Projection

- [x] 新增 run 级 graph projection
- [x] 将 `system.mmd + execution plan + graphState` 投影成前端友好结构
- [x] 节点级字段至少包含：
  - `roleId`
  - `nodeType`
  - `bindingKind`
  - `status`
  - `activeBranchCount`
  - `completedBranchCount`
  - `waitingReviewCount`
  - `loopIteration`
  - `lastSelectedEvent`
  - `lastErrorCode`
- [x] 边级字段至少包含：
  - `sourceRoleId`
  - `targetRoleId`
  - `event`
  - `isErrorFlow`
  - `recentlyActivated`
- [x] join 节点补充等待信息：
  - `joinMode`
  - `expectedSources`
  - `readySources`
  - `missingSources`

### 5.2 Graph API

- [x] 扩展 `GET /api/v1/runs/:runId/graph`
- [x] 返回结构化 graph view，而不是只回 `systemSource + raw state`

### 5.3 Graph UI

- [x] 在 run 详情页增加图视图面板
- [x] 高亮当前活跃 role
- [x] 标注 waiting_review branch
- [x] 标注 join waiting 状态
- [x] 标注 loop 当前轮次
- [x] 标注失败节点和错误码

验收：

- [x] 看到 run 图就能判断当前 frontier、阻塞点、失败点
- [x] 不需要人工翻 `state.json` 定位 branch/join/review 状态

## 6. Phase 3: 时间线与日志增强

目标：把现在的“事件列表”提升到可筛选、可定位、可追责。

### 6.1 Timeline Projection

- [x] 扩展 `timeline.jsonl` 投影字段
- [x] 补齐 review、stop、resume、reconcile 相关事件投影
- [x] 补齐节点生命周期关键信号：
  - role start
  - role done
  - role failed
  - branch activated
  - join ready
  - human review requested
  - review decision applied
  - review decision reconciled

### 6.2 Timeline API

- [x] 保持 cursor 分页
- [x] 增加过滤参数：
  - `roleId`
  - `branchId`
  - `type`
  - `reviewId`
  - `status`
  - `errorCode`

### 6.3 Log UX

- [x] 区分 engine log 与 role log
- [x] 支持按 role 切换日志
- [x] 支持 tail 和时间窗口过滤
- [x] 在失败节点旁直接跳日志

验收：

- [x] 失败排查不再依赖手工翻多个 ndjson 文件
- [x] 能从时间线直接跳到对应 role 或 review

## 7. Phase 4: 人工确认可视化

目标：把 runtime-native human review 做成可观察、可决策、可对账的控制台。

### 7.1 Review Summary Projection

- [x] 新增 review summary 投影
- [x] 聚合：
  - `requestSnapshot`
  - `decisionSnapshot`
  - `currentState`
  - branch 状态
  - review round
  - actor
  - comment
  - terminate scope

### 7.2 Review API

- [x] 新增 `GET /api/v1/runs/:runId/reviews`
- [x] 新增 `GET /api/v1/runs/:runId/reviews/:reviewId`
- [x] 后续按需开放：
  - `POST /api/v1/runs/:runId/reviews/:reviewId/decide`

### 7.3 Review UI

- [x] 在 run 详情增加 Review Inbox
- [x] 显示 `pendingReviewCount`、`latestPendingReviewId`
- [x] 展示每个 review 的：
  - roleId
  - branchId
  - round
  - requestedAt
  - currentStatus
  - previousOutput
  - comment
  - decision history
- [x] 展示 approve/rework/pause/terminate 的可操作区

### 7.4 Decision Safety

- [x] 保持服务端复用 `writeHumanReviewDecision`
- [x] 对已 resolved/expired review 拒绝重复提交
- [x] terminate 仅允许合法 scope

验收：

- [x] 能清楚看见当前哪些 branch 卡在 `waiting_review`
- [x] 能分辨“请求已写入”和“决策已真正生效”
- [x] 不需要 CLI 也能完成常规 review 决策

## 8. Phase 5: 恢复与恢复诊断

目标：把“能恢复吗、为什么不能恢复、恢复会从哪里继续”可视化。

### 8.1 Resume Diagnostic Projection

- [x] 新增恢复诊断投影
- [x] 检查项至少包含：
  - `state.json.graphState` 是否可读
  - `sessions.json` 是否可读
  - `plan-fingerprint.json` 是否存在
  - checkpoint 是否完整
  - `control/reviews/*.request.json` 是否缺失或损坏
  - `control/reviews/*.decision.json` 是否缺失、损坏或存在待 reconcile 状态
  - 是否存在 unreconciled execution outcome
  - `roles/<roleId>/executions/<executionId>/execution-outcome.json` 是否存在孤儿 outcome
  - `.resume.lock` 是否存在冲突或陈旧锁
  - 是否存在未 apply / 未 reconcile review decision

### 8.2 Resume API

- [x] 新增 `GET /api/v1/runs/:runId/resume-diagnostics`

### 8.3 Resume UI

- [x] 显示 recoverable / blocked / mismatch / dirty 四类状态
- [x] 显示失败原因：
  - fingerprint mismatch
  - state corrupted
  - missing authority files
  - pending reconcile
- [x] 显示建议动作：
  - resume
  - inspect review
  - inspect logs
  - inspect checkpoint gap

验收：

- [x] 用户不看源码也能知道 run 是否可恢复
- [x] 恢复失败时能直接定位到权威文件层面的原因

## 9. Phase 6: 仿真视图

目标：把 dry-run 明确纳入 visualizer，而不是当成“普通 run 的弱化版”。

### 9.1 Simulation Model

- [x] 将 `dry-run` run 在 UI 中显式标记为 simulation
- [x] 复用现有 run 目录和事件流，不新增独立 simulator 存储

### 9.2 Simulation Summary

- [x] 新增 simulation summary 投影
- [x] 展示：
  - 是否 dry-run
  - 模拟执行节点数
  - 未真实执行的外部命令/模型调用数
  - 预计流转路径
  - Mermaid Live graph link

### 9.3 Simulation UI

- [x] 在 run 详情加 simulation badge
- [x] 让时间线和图视图显示“模拟执行”标签
- [x] 区分真实失败与 dry-run 下的模拟输出

验收：

- [x] 用户能明确区分仿真 run 和真实 run
- [x] dry-run 结果可以用于流程验收和图结构验证

## 10. Phase 7: 产品边界演进策略

目标：把 visualizer 从纯 read-only 观测面升级为 `read-mostly + 少量 control-plane 写入口`，同时继续保持 runtime 语义单点收口。

- [x] `start/resume` 继续以 CLI 为主
- [x] visualizer 升级为 `read-mostly + 少量 control-plane 写入口`
- [x] 明确记录当前事实：
  - visualizer 服务已升级为 read-mostly
  - `review decide`、`stop`、`reindex` 只复用 lifecycle/control-plane 入口，不直接写底层 artifacts
- [x] 接入写操作前，先显式升级产品边界而不是继续沿用 read-only 描述
- [x] 把 `review decide`、`stop`、`reindex` 纳入 visualizer 当前范围，并保持与 CLI 语义一致
- [x] 优先接入的控制面写操作已经落地：
  - `review decide`
  - `stop`
  - `reindex`
- [x] 所有写操作统一复用 lifecycle 层函数
- [x] 页面上的高风险操作都显示目标 runId / reviewId / scope

验收：

- [x] 当前 visualizer 与 read-mostly 实现边界一致
- [x] visualizer 不持有运行语义，只暴露少量 control-plane 入口
- [x] 不出现 UI 与 CLI 行为不一致的双写问题

## 11. Phase 8: 前端整理

目标：在保持轻量前提下，避免页面继续堆成单页 JSON 查看器。

- [x] 页面拆成：
  - 项目首页
  - run 列表
  - run 详情
  - review 详情
- [x] run 详情布局调整为：
  - 图视图
  - 时间线
  - 状态摘要
  - artifacts
  - logs
  - reviews
- [x] 支持移动端基础可用
- [x] 支持深链接到 runId / reviewId

验收：

- [x] 常见运维路径点击不超过 3 步
- [x] 不再需要长时间停留在 raw JSON 区块

## 12. 测试清单

### 12.1 Unit / Projection

- [x] `project-summary` 投影测试
- [x] `graph-view` 投影测试
- [x] `review-summary` 投影测试
- [x] `resume-diagnostics` 投影测试
- [x] `simulation-summary` 投影测试

### 12.2 Integration

- [x] minimal template 项目可视化回归
- [x] parallel_split + join 系统图状态回归
- [x] runtime-native human review 可视化回归
- [x] dry-run simulation UI 数据回归
- [x] stop/resume/reconcile 事件流回归

### 12.3 Manual Smoke

- [x] `ogs project create demo-app --template minimal`
- [x] `ogs run start --system system.mmd --input "smoke" --dry-run`
- [x] `ogs visualizer --workdir .`
- [x] 验证项目首页、run 列表、run 详情、simulation 标记、review 面板

## 13. 推荐改动顺序

### Milestone A: 项目与运行读面

- [x] project summary API
- [x] graph projection API
- [x] run detail UI 重构

### Milestone B: review 与恢复

- [x] review 列表/详情 API
- [x] review UI
- [x] resume diagnostics API/UI

### Milestone C: simulation 与写操作

- [x] simulation summary
- [x] reindex/stop/review decide 接入 UI

## 14. 暂不做

- [x] 不做数据库索引
- [x] 不做多用户协作和权限系统
- [x] 不做拖拽式 Mermaid 编辑器
- [x] 不做复杂统计大屏
- [x] 不做跨机器 run 聚合

## 15. 完成定义

当以下条件同时满足时，可认为“现有架构下的可视化能力”已基本成型：

- [x] 项目创建后的静态结构能被 visualizer 读清楚
- [x] 运行中的 graph frontier、branch、join、loop、error 能图形化展示
- [x] 人工确认可查看、可决策、可对账
- [x] 恢复可诊断、可解释
- [x] 仿真 run 与真实 run 可清晰区分
- [x] 全链路仍然只依赖文件型权威集和投影文件，无数据库依赖
