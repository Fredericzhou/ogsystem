# OGSystem 可视化平台方案

Date: 2026-04-16  
Status: proposal  
Scope: 为现有 OGSystem 内核增加运行态可视化、审计浏览和恢复操作平台

## 1. 目标

把 OGSystem 从“可执行的单机编排内核”扩展为“可观察、可追踪、可恢复”的平台，但不改变现有运行语义。

平台只做三件事：

1. 看清一次运行发生了什么。
2. 解释为什么会这样运行。
3. 让恢复、停止、排障更快。

## 2. 结论

最佳实践不是再造一个前端编排器，而是建立一层只读可视化平台，消费现有运行产物和审计数据。

推荐形态：

- 内核层继续保留现有 CLI/runtime。
- 新增只读 API 层，把文件型证据投影成稳定 JSON。
- 前端只消费 API，不直接读 `.ogs/runs/*`。
- 实时进度通过轮询或 SSE 获取增量事件。

## 3. 为什么现在就能做

现有内核已经具备足够的数据面：

- `runs-index.json` 提供运行摘要。
- `state.json` 提供运行状态。
- `metrics.json` 提供聚合指标。
- `resolved-config.json` 提供运行配置。
- `events.ndjson` 提供完整事件流。
- `logs/engine.ndjson` 和 `logs/roles/<roleId>.ndjson` 提供分通道日志。

另外，CLI 已经支持：

- `ogs run list`
- `ogs run status <run-id>`
- `ogs run inspect <run-id>`
- `ogs run logs <run-id>`
- `--log-run` 控制台进度输出
- `--print-graph-link` Mermaid 预览链接

这意味着平台层不需要发明新的运行协议，只需要把已有产物产品化。

## 4. 实时进度方案

### 4.1 可显示的进度

建议显示这些维度，而不是强行做单一百分比：

- `status`
- `transitionCount`
- `currentRole`
- `activeBranches`
- `recentAudits`
- `joinWait`
- `error / repair`

原因是 OGSystem 存在分支、join 和 loop，线性百分比容易误导。

### 4.2 接入方式

第一阶段：

- 前端轮询 `GET /api/runs/:runId`
- 前端轮询 `GET /api/runs/:runId/events?cursor=...`

第二阶段：

- 加 `SSE`，服务端持续推送增量事件
- 前端收到事件后更新时间线和状态面板

推荐顺序是先轮询，再 SSE。这样最快落地。

## 5. 技术栈建议

### 5.1 后端

- `Node.js 20+`
- `TypeScript`
- `Fastify`

理由：

- 与现有项目技术栈一致。
- 适合轻量 API 和 SSE。
- 文件型运行目录读写很自然。
- 比起引入多层服务、消息队列或重型框架，更容易长期维护。

### 5.2 前端

- `React`
- `TypeScript`
- `Vite`
- 原生 `fetch`
- 局部 `useState` / `useReducer`

### 5.3 可视化组件

- `Mermaid`：静态系统图预览
- `React Flow`：运行中节点高亮、分支展开、状态联动
- `ECharts`：耗时、失败率、角色统计

## 6. 平台信息架构

### 6.1 首页

- 运行列表
- 状态分布
- 最近失败
- 最近恢复

### 6.2 运行详情页

建议分三栏：

- 左：图视图
- 中：时间线
- 右：状态、工件、日志入口

### 6.3 图视图

展示：

- 系统拓扑
- 当前执行节点
- 活跃分支
- join 等待态
- loop 轮次

### 6.4 时间线

展示：

- audit 事件
- transition 事件
- role start / done
- failure / repair

### 6.5 工件面

展示：

- `state.json`
- `metrics.json`
- `resolved-config.json`
- `events.ndjson`
- `logs/engine.ndjson`
- `logs/roles/<roleId>.ndjson`

## 7. API 设计

建议只读 API 先行：

- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/state`
- `GET /api/runs/:runId/events?cursor=&roleId=&branchId=&event=`
- `GET /api/runs/:runId/logs?roleId=&engine=`
- `GET /api/runs/:runId/graph`
- `GET /api/runs/:runId/stream`
- `POST /api/runs/:runId/stop`
- `POST /api/runs/:runId/reindex`

建议增加版本前缀：

- `/api/v1/...`

## 8. 数据建模原则

### 8.1 分层

- `Run Summary`
- `Run Detail`
- `Graph Snapshot`
- `Audit Event`
- `Artifact Index`

### 8.2 约束

- 前端不直接依赖 `state.json` 结构。
- 事件流必须支持分页或 cursor。
- 大日志必须增量加载。
- 默认只读，写操作显式触发。

## 9. 推荐实施顺序

### Phase 1: 数据 API

- 做 `runs` 列表和 `run detail` API。
- 把现有文件型产物统一成稳定 JSON。

### Phase 2: 实时通道

- 增加 SSE。
- 把 progress / audit / log 增量推给前端。

### Phase 3: Web UI

- 做首页、运行详情页、日志页。
- 接入图和时间线。

### Phase 4: 交互增强

- 节点高亮
- 分支展开
- 事件过滤
- 失败定位
- 多 run 对比

## 10. 不建议一开始做的事

- 不要先做拖拽式编排器。
- 不要让前端直接读写 `.ogs/runs/*`。
- 不要把 UI 状态和运行时状态混成一个文件。
- 不要一开始就做多租户和协作编辑。
- 不要引入 Redis、GraphQL、SSR、微服务拆分或复杂状态容器，除非后期确实出现规模压力。

## 11. 关键收益

- 运行过程可动态观察。
- 失败原因可快速定位。
- 恢复操作更明确。
- 审计证据更容易浏览。
- 后续扩展到多项目、模板和对比分析时，平台架构不会重写。
