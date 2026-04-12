# OGSystem 统一待办清单（Backlog）

Date: 2026-04-12  
Status: active  
Sources: `docs/long-term-stability-roadmap.md`, `docs/archive/delivery/optimization-execution-checklist-2026-04-10.md`, `docs/archive/delivery/single-graph-runtime-execution-checklist.md`, `docs/archive/delivery/cross-platform-rust-validation-and-gap-analysis-2026-04-12.md`, `docs/archive/delivery/source-commenting-hardening-plan-2026-04-11.md`

## 1. 目的与边界

- 本文档是当前唯一“待办汇总入口”，用于替代分散 checklist 的日常跟踪。
- 稳定主线继续遵循“不加复杂度”原则：先容量治理、基准回归、运维手册化，再评估架构升级。
- 带日期的计划/评估/checklist 作为交付记录保留在 `docs/archive/`，不直接作为当前执行清单。

## 2. 当前优先（可立即执行）

### P1. 跨平台产品化闭环

- [ ] 在 CI 增加 Rust toolchain 维度的可选门禁作业（cargo 可用时执行 `tests/rust-hello-pipeline.test.mjs`）。
- [ ] 增加 Windows PowerShell/CMD 生命周期命令 smoke test，覆盖 `project init` 与 `run start/list/status`。
- [ ] 建立安装与操作文档漂移检查（README 与 usage-manual 的命令片段对齐校验）。

### P1. 生命周期可观测性补齐

- [ ] `run status/list` 增加统一字段：运行时长、停止原因、最后错误码、最后角色。
- [ ] `run logs` 增加 `--tail`、`--follow`、`--since` 能力，降低排障成本。
- [ ] 增加 run 级 `summary.json`（面向工具消费），避免只依赖 markdown 审计摘要。

### P1. 容量治理

- [ ] 基于 `executionDirCount` 给出默认阈值建议，并写入运维文档。
- [ ] 在清理路径补充审计字段：触发阈值、清理耗时、清理前后目录数量。

### P1. 回归与压测基线

- [ ] 持续运行 `runtime-replay-benchmark`，沉淀 checkpoint 重放耗时趋势。
- [ ] 增加长循环（500+ iterations）下的恢复耗时阈值与回归门槛。

### P1. 运维手册化

- [ ] 形成 retention 分层建议（开发/预发/生产）。
- [ ] 明确“自动清理”和“一次性 CLI 清理”的启用准则。

### P1. 源码注释治理收尾

- [ ] 新增 `docs/commenting-style.md`，把当前已落地的注释规则、反例与评审清单从 archive 固化为活动规范。
- [ ] 新增 `docs/file-sets.md`，沉淀 `src/runtime/*` 与 `src/nl2mmd/*` 的文件集划分、职责边界与相互引用关系。
- [ ] 完成剩余 `src/runtime/*` 文件的文件头导读与必要关键路径注释，补齐 P2 范围的一致性收尾。
- [ ] 完成全量 `src/nl2mmd/*` 文件的文件头导读、关键转换/校验链路注释与必要类型契约说明。
- [ ] 增加轻量注释治理门禁，至少覆盖新增/改动源码的文件头存在性与“关键逻辑改动需同步更新注释”检查。

## 3. 稳定后再做（延后项）

- [ ] 发布版本化 CLI 分发（npm 包 + 跨平台单文件分发策略）并定义升级路径。
- [ ] 增加 provider 凭据健康检查与最小权限模板（开发/CI/生产）。
- [ ] 引入运行目录敏感字段脱敏策略（日志与审计输出）。
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
