# OGSystem 降复杂度版实施计划：状态脱水与稳定性增强

Date: 2026-04-11  
Status: completed  
Scope: latest-only（不做旧状态兼容）

## 1. 目标与原则

本方案聚焦在“不增加系统复杂度”的前提下，提升长期运行稳定性与可观测性。

核心目标：

1. 控制 `state.json` 体积增长，避免写盘耗时随运行历史线性上升。
2. 保持恢复权威集稳定，不把审计流水引入恢复面。
3. 增强关键运行指标，支持阈值驱动的显式治理。

执行原则：

- 只面向最新版本，不增加向后兼容分支。
- 恢复逻辑继续依赖权威集：`state.json + sessions.json + plan-fingerprint + checkpoints + execution-outcome`。
- `events.ndjson` 仅用于观测、报表、人工排查。

## 2. 架构决策（降复杂度版）

### 2.1 状态三层职责

1. Authority（恢复权威）
- 文件：`state.json`、`sessions.json`、`plan-fingerprint.json`、`checkpoints/`、`execution-outcome.json`
- 责任：resume、WAL 重放、checkpoint 对账

2. Journal（审计流水）
- 文件：`events.ndjson`
- 责任：全量执行事件记录、离线报表与排障

3. Summary（运行摘要）
- 文件：`state.json.graphState`（轻量）、`metrics.json`、`audit/summary.md`
- 责任：实时状态概览与指标输出

### 2.2 状态脱水策略

`GraphState` 改为轻量结构：

- 用 `recentAudits`（固定窗口，默认 5）替代全量 `auditTrail`
- 新增 `auditSummary` 聚合计数：
  - `okCount`
  - `failedCount`
  - `noopCount`

说明：

- `recentAudits` 用于近期调试上下文，不参与长期累计。
- 全量审计来源固定为 `events.ndjson`。

### 2.3 Prompt 优化策略

不在 runtime 中强制对象键顺序；采用“模板约定”治理：

- 在角色模板中固定结构：`Role-Meta -> User-Task -> Global-Laws -> Dynamic-Context`
- 通过文档和共享模板约束实现稳定前缀，避免引入运行时硬编码耦合

### 2.4 Index 策略

暂不引入 `executionLogIndex` 到 `state.json`。

原因：

- 会新增一致性维护成本（写入、清理、恢复同步）。
- 当前 `executions/<executionId>/` 路径已能满足目录级检索诉求。

## 3. 分阶段实施

## Step 1（P0）：状态脱水 + 指标增强

目标：先控制增长和写盘成本，不改恢复权威模型。

改动项：

1. 类型与状态结构
- 修改 `src/runtime/types.ts`
  - `GraphState.auditTrail` -> `GraphState.recentAudits`
  - 新增 `GraphState.auditSummary`

2. 运行态 reducer / update 逻辑
- 修改 `src/runtime/graph-runner.ts`
  - reducer 从全量拼接改为固定窗口裁剪
  - 每次 update 同步维护 `auditSummary` 计数

3. 状态投影
- 修改 `src/runtime/graph-runtime-state.ts`
  - `projectStateSnapshot` 不再依赖全量 `auditTrail`
  - run summary 计数优先使用 `auditSummary`

4. 指标增强
- 修改 `src/runtime/graph-runner.ts`（`projectMetricsSnapshot`）
  - 增加 `rssBytes`
  - 增加 `stateWriteMs`
  - 增加 `executionDirCount`

5. 审计流水保证
- 保持 `events.ndjson` 追加写完整记录（不变更其恢复语义）

验收标准：

- `state.json` 体积不再随 transition 数量线性增长。
- `npm test` 全量通过。
- 长循环回归中 `stateWriteMs` 波动明显收敛。

## Step 2（P0）：报表改为按需重算

目标：避免全量报表依赖内存中历史数组。

改动项：

1. `summarizeRun` 改造
- 支持从 `events.ndjson` 流式读取重算摘要（仅在需要全量报表时触发）

2. 输出策略
- 实时结果使用 `GraphState.auditSummary + recentAudits`
- 完整历史报告改为“按需读 Journal”

验收标准：

- 实时运行路径不读取全量历史文件。
- 离线报表结果与既有统计字段保持一致。

## Step 3（P1）：阈值驱动的显式清理

目标：把历史清理从“人工参数”升级为“可观测、可控、可审计”的显式策略。

改动项：

1. 配置层
- 扩展 `runtime.json`（显式开关，默认关闭）：
  - `retention.enabled`
  - `retention.executionDirThreshold`
  - `retention.keepLatest`

2. 触发逻辑
- 在 adapter / runner 生命周期中读取指标并显式判断：
  - `if (enabled && executionDirCount > threshold) => cleanup`

3. 观测与日志
- 每次触发写入：
  - 触发原因（阈值、当前计数）
  - 清理规模（每角色删除数量）
  - 清理耗时

验收标准：

- 默认配置不触发自动 GC（行为可预测）。
- 开启后按阈值触发，日志可追溯。

## 4. 测试计划

必补用例：

1. 状态脱水
- `state.json` 在 100+ transitions 后体积增长受控
- `recentAudits` 长度始终 <= 窗口值
- `auditSummary` 计数正确

2. 恢复稳定性
- resume 不依赖 `events.ndjson`
- checkpoint/outcome 对账逻辑不受脱水影响

3. 指标正确性
- `metrics.json` 包含 `rssBytes/stateWriteMs/executionDirCount`
- 指标字段在失败路径和成功路径都存在

4. 阈值清理
- 默认关闭时不触发
- 开启且超阈值时触发且只清理历史快照

5. 报表重算
- 从 `events.ndjson` 流式计算结果与期望一致

## 5. 风险与防护

风险：

1. 状态字段改名导致现有测试断裂
2. 计数逻辑从全量数组改为增量更新后出现偏差
3. 指标采集引入额外开销

防护：

1. 分阶段提交（Step 1 完成后先锁定）
2. 每步都跑全量 `npm test`
3. 增加故障注入回归：crash + resume + 对账

## 6. 文档同步清单

需同步更新：

- `docs/usage-manual.md`
- `docs/long-term-stability-roadmap.md`
- `docs/ogsystem-ebook.md`
- `docs/README.md`（将本计划归类到 Delivery & Run Records）

## 7. 完成定义（DoD）

满足以下条件才算完成：

1. `GraphState` 已脱水（无全量 `auditTrail`）
2. `events.ndjson` 仍完整记录全量事件
3. `metrics.json` 新指标稳定输出
4. 阈值触发清理可控且默认关闭
5. 全量测试通过，关键回归（resume / crash / loop-heavy）通过
6. 文档同步完成并提交

## 8. 实施结果（2026-04-11）

已完成：

1. `GraphState` 已完成脱水：使用 `recentAudits + auditSummary + roleMetricsByRoleId`，不再在状态中累积全量审计数组。
2. `events.ndjson` 继续保留为全量审计观测面，恢复权威集未发生扩权。
3. `metrics.json` 已新增 `rssBytes`、`stateWriteMs`、`executionDirCount`。
4. 新增 `runtime.retention` 显式阈值清理（默认关闭），并保持 CLI `--cleanup-executions` 优先。
5. 已补充并通过相关测试（配置校验、成功/失败路径指标、自动阈值清理、resume 结构校验）。
6. 手册与路线图已同步更新（`docs/usage-manual.md`、`docs/long-term-stability-roadmap.md`、`docs/README.md`、`docs/ogsystem-ebook.md`）。
