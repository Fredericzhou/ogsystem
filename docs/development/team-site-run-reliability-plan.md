# Team Site 运行可靠性实施方案

## 状态

一期基线：可继续实施；发布验收：未通过。

本文只负责 TaskRecord 到 Run 的关系、运行时状态、幂等和控制；不重新定义 Team/Project 领域数据。当前已经实现 Run 预留、`planning` 状态、HTTP `202` 启动响应、Task/Run/events 查询和失败持久化，但执行仍依赖进程内 `activeTaskWorkers`。

当前验证证据：Run 预留、Task/Run/events 查询契约通过；完整 Team Site 测试 `24/24` 通过。运行快照路径和协作任务投影竞态已修复，但服务重启恢复尚未完成，不能宣称运行可靠性方案整体发布验收通过。

## 权威关系

- 没有 `runId` 的 TaskRecord 状态为 `queued`。
- 生成 `runId` 后，TaskRecord 状态映射为 Run 当前状态。
- Run 状态唯一规范为：`planning`、`running`、`pause_requested`、`paused`、`waiting_review`、`completed`、`failed`、`cancel_requested`、`cancelled`。
- 旧的 `ready` 映射为 `planning`，旧的 `stopped` 映射为 `cancelled`。
- `deletedAt` 只隐藏 TaskRecord，不删除 Run 证据。

实现约束：`TaskRecord` 是站点投影，Run 状态文件是运行时权威。兼容层不得继续把 `ready`、`stopped` 作为新的规范状态写入持久化数据；迁移只允许读取旧值并映射到规范状态。

## 首期范围

- 预留 Run ID，持久化 `planning`，启动接口返回 `202`。
- 提供 TaskRecord 和 Run 查询接口。
- 使用运行时 `.ogs/runs/<runId>/state.json` 作为状态权威。
- 相同幂等请求不能创建重复 Run。
- 首期保留进程内执行，暂不引入外部队列。

一期最小可验收接口为：创建 TaskRecord、启动并返回 `202`、查询 TaskRecord、查询 Run 和查询运行事件快照。SSE、暂停/继续/停止/重试和重启恢复仍属于后续能力，必须在接口冻结时明确标注，不得以未实现接口宣称完成。

## 二期范围

- SSE 和轮询兜底、运行事件投影；进程内后台执行已作为一期过渡实现，但不具备重启安全性。
- 暂停、继续、停止、重试和服务重启恢复。
- 历史运行服务端投影。
- 平台设置原子持久化和运行时真实接入。

## 接口

```text
POST /api/v1/projects/:projectId/tasks
POST /api/v1/projects/:projectId/tasks/:taskId/start
GET  /api/v1/projects/:projectId/tasks/:taskId
GET  /api/v1/projects/:projectId/runs/:runId
GET  /api/v1/projects/:projectId/runs/:runId/events
POST /api/v1/projects/:projectId/runs/:runId/pause
POST /api/v1/projects/:projectId/runs/:runId/resume
POST /api/v1/projects/:projectId/runs/:runId/stop
POST /api/v1/projects/:projectId/runs/:runId/retry
```

当前实现差异：运行控制的 Run API 使用 `cancel`，Task API 使用 `stop`；二期需要统一规范名称并提供兼容映射和稳定错误码。

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
- 控制请求只写入已有 Run 的控制文件。
- 相同幂等键和输入返回原 TaskRecord/Run；同键不同输入返回稳定错误码。
- 重试创建新 Run，不覆盖历史 Run。
- 服务重启后无法确认执行器存活的活动 Run 转为 `failed`，错误码为 `RUNNER_RESTARTED`。
- 平台配置只有真正被运行时读取后才能返回 `runtimeApplied: true`。

进程内执行器是一期的明确风险边界：服务重启恢复尚未实现，不能把活动 TaskRecord 显示为仍在运行。重启扫描和 `RUNNER_RESTARTED` 失败转换属于二期发布前能力。

## 验收标准

- 启动立即返回 `202`，不等待完整运行。
- 页面刷新后可以从 Run 状态文件恢复状态。
- 不会因为重复请求创建第二个 Run。
- 暂停、继续、停止和重试作用于正确的 `runId`。
- 服务重启不会伪装活动运行。
- 失败保留错误原因、运行证据和重试入口。
- 完成 `planning -> running -> completed` 及失败链路 API 测试。

## 当前发布闸门

- 修复运行快照路径错误，并验证 TeamVersion、Project、Run 的工作目录和输入快照边界。
- 增加 HTTP 层的 `202`、Task/Run 查询、幂等、失败原因和重复启动测试。
- 收敛 `ready/stopped/cancelled` 命名，补充旧数据映射测试。
- 明确 events/SSE 是否进入本期；若保留，必须提供 events 端点和轮询兜底测试。
- 在实现重启恢复前，活动 Run 必须在服务启动后转为可解释的失败状态，不能伪装为运行中。

## 文件边界

- 运行逻辑位于 `apps/team-site/run-service.mjs` 及运行路由；现有 facade 只负责兼容导出。
- 本方案消费领域方案提供的 TeamVersion、Project 和资料接口，不修改其字段定义。
- 前端只消费本方案的状态和控制接口，不直接写运行文件。
