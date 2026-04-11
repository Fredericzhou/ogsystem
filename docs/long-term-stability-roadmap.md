# OGSystem Long-Term Stability Roadmap

Date: 2026-04-11
Status: active (post-dehydration baseline)

## 1. 当前基线（已落地）

截至 2026-04-11，单机内核已经完成一轮“降复杂度稳定化”落地：

- 状态脱水：`graphState.auditTrail` 收敛为 `recentAudits`（窗口）+ `auditSummary`（聚合）+ `roleMetricsByRoleId`（按角色累计）。
- 报表解耦：完整审计优先从 `events.ndjson` 按需读取，恢复权威集仍保持 `state/sessions/fingerprint/checkpoints/outcome`。
- 指标增强：`metrics.json` 已输出 `rssBytes`、`stateWriteMs`、`executionDirCount`。
- 显式清理：新增 `runtime.retention`（默认关闭），并保持 CLI `--cleanup-executions` 优先级更高。

这意味着近期核心风险从“恢复正确性”进一步转向“长期容量治理与运维可视化”。

## 2. 已闭环能力（稳定性）

以下能力已形成可用闭环：

- 严格指纹校验（系统定义、角色内容、模型包、law）。
- 会话血缘隔离（`roleId:sessionLineageId`）。
- Durable outcome + checkpoint 对账补偿（crash-idempotent）。
- 同机 `--resume-run` 互斥（`.resume.lock`）。
- 状态体积控制与写盘耗时可观测（脱水 + metrics）。

## 3. 下一阶段优先级（不加复杂度）

### 3.1 容量治理

- 基于 `executionDirCount` 增加运维阈值建议与默认告警阈值文档。
- 补充清理行为审计字段（触发阈值、清理耗时、清理前后目录数量）。

### 3.2 回归与压测基线

- 持续运行 `runtime-replay-benchmark`，记录 checkpoint 重放耗时趋势。
- 增加长循环场景的稳定性门槛（例如 500+ iterations 下的恢复耗时阈值）。

### 3.3 运维手册化

- 把 retention 配置建议分层（开发默认、预发建议、生产建议）。
- 把“何时开启自动清理、何时使用一次性 CLI 清理”写成明确操作准则。

## 4. 明确延后事项

以下方向保持延后，避免过早复杂化：

- 语义兼容型 resume（宽容指纹/带损恢复）。
- 分布式锁 provider（Redis/DB 跨主机协调）。
- 面向共享存储多实例抢占的调度协议。

延后原因：当前真实瓶颈是单机长期 I/O 与产物增长，不是跨主机协调能力。

## 5. 30/60/90 天建议

### Day 0-30

- 固化 retention 实战配置模板与运维检查项。
- 将新增 metrics 纳入回归报告模板。

### Day 31-60

- 建立“长循环 + resume”基准曲线并纳入 CI 夜间任务。
- 按真实运行样本调整 retention 默认建议阈值。

### Day 61-90

- 依据基准曲线决定是否需要 state/checkpoint compact（仅在数据证明必要时）。
- 复盘是否进入“跨主机恢复协调”设计阶段。

## 6. 总结

OGSystem 当前已经是“稳定、可恢复、可审计、复杂度受控”的单机编排内核。后续路线应坚持同一原则：优先用可观测与显式策略解决长期运行问题，而不是提前引入高复杂度架构。
