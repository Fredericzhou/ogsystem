# OGSystem Long-Term Stability Roadmap

Date: 2026-04-11
Status: active planning

## 1. 当前定位

OGSystem 现在已经具备较强的单机正确性与恢复能力：

- 指纹校验覆盖系统定义、角色内容、模型包与 law。
- 会话按 `roleId:sessionLineageId` 做血缘隔离。
- `execution-outcome.json` + `checkpoints/` 形成 crash-idempotent 恢复链。
- `.resume.lock` 可以阻止同机双 `--resume-run` 竞争。

因此，近期最主要的风险已经不再是“语义是否正确”，而是“长期运行后磁盘与 I/O 会不会成为天花板”。

## 2. 近期必须做的三件事

### 2.1 审计流式化，控制 `state.json` 膨胀

当前问题：

- `state.json.graphState` 仍包含完整 `auditTrail`。
- 运行时间越长，单次原子写入成本越高。
- 大文件写盘会放大 event loop lag，并拖慢每次 transition 的落盘延迟。

近期目标：

- 将长期累积的审计历史从 `state.json` 中剥离。
- 保留 resume 必需的最小状态，把完整历史流式写入独立 `.ndjson` 或分段审计文件。
- 在内存与快照中只保留最近窗口或聚合摘要。

### 2.2 落地产物保留与清理策略

当前问题：

- `roles/<roleId>/executions/<executionId>/` 会随运行次数持续增长。
- 单目录海量小文件会拖慢 `readdir`、resume 扫描和运维检查。
- 目前已经有 `--cleanup-executions <n>`，但仍偏手工，不是完整的保留策略。

近期目标：

- 把“保留最近 N 份执行快照”从手工参数升级为可配置策略。
- 明确哪些产物必须保留、哪些产物可以清理、哪些产物只需归档。
- 在不改变恢复权威集的前提下，限制历史 artifacts 的无限增长。

### 2.3 增加增长与 I/O 指标

当前问题：

- 已有 `metrics.json`，但还缺少足够的增长类和 I/O 类指标。
- 状态膨胀通常不是突然出故障，而是逐步退化；如果没有指标，只能靠体感发现问题。

近期目标：

- 在 `metrics.json` 中补充关键指标，例如：
  - `state.json` 当前大小
  - checkpoint 数量
  - per-role execution 目录数量
  - 持久化耗时
  - buffered append flush 耗时
- 为未来的清理策略、压测和告警提供基础数据。

## 3. 继续加强，但不额外增加架构复杂度

这部分值得继续做，但应坚持“小改动提升稳定性”的原则：

- 保持故障注入与恢复演练，持续验证 `execution-outcome.json` 到 checkpoint 的补偿链条。
- 保持 replay benchmark，确认 WAL 重放时间仍在可接受范围内。
- 继续扩展与恢复、自愈、lock 相关的测试覆盖，但不引入新的状态层或外部基础设施。

## 4. 明确延后事项

以下方向目前不是近期优先级，原因是它们会明显提高复杂度，且并非当前瓶颈：

### 4.1 语义兼容型 Resume

暂不做“带损恢复”或“宽容指纹”。

原因：

- 当前严格指纹是正确性边界的重要组成部分。
- 一旦允许“提示词轻微变化仍可 resume”，就必须定义复杂的兼容规则、迁移规则和审计解释。
- 这类能力更适合在真正出现大量版本迁移需求后再设计。

### 4.2 分布式锁或跨主机恢复协调

暂不把 `.resume.lock` 抽象成 Redis/DB 锁 provider。

原因：

- 当前系统定位仍是单机文件型内核。
- 跨主机锁只有在共享存储、多实例恢复成为真实部署场景时才值得投入。
- 过早抽象会让运行时边界变复杂，但不会解决当前最现实的 I/O 增长问题。

## 5. 30/60/90 天建议

### Day 0-30

- 设计并落地 `auditTrail` 剥离方案。
- 明确 artifact retention 分类与默认策略。
- 为 `metrics.json` 增加增长类与 I/O 类指标。

### Day 31-60

- 把 retention 策略接入实际命令或 runtime 配置。
- 建立针对长循环和大量 execution 目录的回归测试。
- 为 state 膨胀、checkpoint 增长和 flush 耗时建立 benchmark 基线。

### Day 61-90

- 根据指标与 benchmark 结果决定是否需要 compact state。
- 评估是否引入更细粒度的 audit 分段和归档策略。
- 在真实运行样本上复盘单机上限，再决定是否需要进入“分布式协调”设计阶段。

## 6. 总结

OGSystem 现在的优势是：单机语义闭环、恢复机制完整、实现复杂度可控。

接下来最值得投入的方向不是再造更多语义，而是守住这个优势，让它在长时间运行时依然稳定、可观测、可维护。
