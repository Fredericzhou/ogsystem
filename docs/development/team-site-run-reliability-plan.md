# Team Site 运行可靠性实施方案

## 状态

最新方案：已实现；发布验收：通过。

本文只负责 TaskRecord 到 Run 的关系、运行时状态、幂等、控制和服务重启恢复，不重新定义 Team/Project 领域数据。当前版本采用运行状态文件作为唯一权威，并按最新契约工作，不保留旧状态别名或历史数据迁移。

验证证据：Team Site 全量测试 `51/51` 通过，覆盖 `202` 启动响应、`planning` 预留、Task/Run/events 查询、幂等、失败原因、控制边界、运行快照路径和服务重启恢复。

## 权威关系

- 没有 `runId` 的 TaskRecord 状态为 `queued`。
- 生成 `runId` 后，TaskRecord 状态映射为 Run 当前状态。
- Run 状态唯一规范为：`planning`、`running`、`pause_requested`、`paused`、`waiting_review`、`completed`、`failed`、`cancel_requested`、`cancelled`。
- Run 状态权威文件为 `.ogs/runs/<runId>/control/state.json`；任务记录只保存查询投影和引用。
- `deletedAt` 只隐藏 TaskRecord，不删除 Run 证据。

## 已实现能力

- 启动任务先预留 Run ID、持久化 `planning`，接口立即返回 HTTP `202`，后台执行器再推进状态。
- 相同幂等请求返回原 TaskRecord/Run，不创建重复 Run；同键不同输入返回稳定错误码。
- 控制请求只写入已有 Run 的控制文件；当前控制命令为 `pause`、`resume`、`cancel`。
- 重试创建新 Run，不覆盖历史 Run。
- 服务启动扫描所有项目的活动 Run；无法确认执行器存活的 Run 持久化为 `failed`，错误包含 `RUNNER_RESTARTED`。
- 失败保留错误原因、运行快照和重试入口；运行查询从状态文件读取，而不是依赖进程内缓存。
- 平台设置采用原子写入；服务端明确返回 `runtimeApplied: false`，表示已持久化但尚未接入当前运行时。

## 接口

```text
POST /api/v1/projects/:projectId/tasks
POST /api/v1/projects/:projectId/tasks/:taskId/start
GET  /api/v1/projects/:projectId/tasks/:taskId
GET  /api/v1/projects/:projectId/runs/:runId
GET  /api/v1/projects/:projectId/runs/:runId/events
POST /api/v1/projects/:projectId/tasks/:taskId/pause
POST /api/v1/projects/:projectId/tasks/:taskId/resume
POST /api/v1/projects/:projectId/tasks/:taskId/cancel
```

启动响应使用 HTTP `202`：

```json
{
  "task": {
    "taskId": "task-id",
    "runId": "run-id",
    "status": "planning"
  }
}
```

## 运行规则

- 启动请求只负责预留 Run、写入 `planning` 并返回；后台执行器负责推进状态。
- 查询优先读取 `.ogs/runs/<runId>/control/state.json`，并根据状态文件返回最新状态和事件快照。
- 运行控制不获取活动运行锁，只写入持久化控制意图，避免控制请求和执行器互相阻塞。
- 同一项目只允许一个活动任务；终态运行不会被错误地恢复、继续或覆盖。
- 服务重启后活动 Run 转为可解释的 `failed`，不会伪装为仍在运行。
- 平台配置只有真正被运行时读取后才能返回 `runtimeApplied: true`；当前实现明确返回 `false`。

## 发布验收清单

- [x] `planning -> running -> completed` 及失败链路通过 API 和状态文件测试。
- [x] 启动立即返回 `202`，不等待完整运行。
- [x] 页面刷新和服务重启均从状态文件恢复或得到持久化失败状态。
- [x] 重复请求不创建第二个 Run，重试使用新 Run。
- [x] 暂停、继续、取消作用于正确的 `runId`，终态边界明确。
- [x] 失败保留错误原因、运行证据和重试入口。
- [x] 运行前端使用可取消轮询；SSE 不属于当前版本，不伪造 SSE 能力。

## 非目标与边界

- 不支持 `ready`、`stopped` 等旧状态名，不提供旧数据迁移。
- 当前不引入外部队列；执行器仍为进程内后台执行，但重启扫描会可靠地将孤儿运行标记失败。
- 领域命名、项目资料和摘要规则由领域方案负责；前端不直接写运行状态文件。

## 文件边界

- 运行逻辑位于 `apps/team-site/run-service.mjs`、`apps/team-site/project-repository.mjs` 和运行路由。
- `apps/team-site/domain/contracts.mjs` 只定义规范状态集合和契约断言。
- 前端只消费运行接口和状态，不复制运行恢复逻辑。
