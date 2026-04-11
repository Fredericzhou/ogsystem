# OGSystem 统一待办清单（Backlog）

Date: 2026-04-11  
Status: active  
Sources: `docs/long-term-stability-roadmap.md`, `docs/archive/delivery/optimization-execution-checklist-2026-04-10.md`, `docs/archive/delivery/single-graph-runtime-execution-checklist.md`

## 1. 目的与边界

- 本文档是当前唯一“待办汇总入口”，用于替代分散 checklist 的日常跟踪。
- 稳定主线继续遵循“不加复杂度”原则：先容量治理、基准回归、运维手册化，再评估架构升级。
- 带日期的计划/评估/checklist 作为交付记录保留在 `docs/archive/`，不直接作为当前执行清单。

## 2. 当前优先（可立即执行）

### P1. 容量治理

- [ ] 基于 `executionDirCount` 给出默认阈值建议，并写入运维文档。
- [ ] 在清理路径补充审计字段：触发阈值、清理耗时、清理前后目录数量。

### P1. 回归与压测基线

- [ ] 持续运行 `runtime-replay-benchmark`，沉淀 checkpoint 重放耗时趋势。
- [ ] 增加长循环（500+ iterations）下的恢复耗时阈值与回归门槛。

### P1. 运维手册化

- [ ] 形成 retention 分层建议（开发/预发/生产）。
- [ ] 明确“自动清理”和“一次性 CLI 清理”的启用准则。

## 3. 稳定后再做（延后项）

- [ ] 语义兼容型 resume（宽容指纹/带损恢复）。
- [ ] 分布式锁 provider（Redis/DB 跨主机协调）。
- [ ] 共享存储多实例抢占调度协议。
- [ ] `state/checkpoint compact`（仅在基准数据证明必要时推进）。

## 4. 不纳入当前主线

- 插件/Hook 生态、新调度层、多后端持久化、多机分片、外部 secrets manager 集成等，保持 out-of-scope。
- `vNext-dev` 破坏性方案仅作为探索，不作为稳定主线待办。
- 对应归档记录：`docs/archive/delivery/vnext-execution-plan-2026-04-11.md`（仅历史参考）。

## 5. 已归档来源

- 已完成稳定性基线 checklist：`docs/archive/delivery/optimization-execution-checklist-2026-04-10.md`
- 已完成单运行时迁移 checklist：`docs/archive/delivery/single-graph-runtime-execution-checklist.md`
