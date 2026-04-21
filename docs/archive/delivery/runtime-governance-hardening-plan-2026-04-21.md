# Runtime Governance Hardening Plan

Date: 2026-04-21
Status: proposed

## 1. 背景

本计划面向当前仓库的真实基线，目标不是重做运行时架构，而是在现有单机内核上补齐运维门槛、执行治理和复杂度控制。

当前已确认的事实：

- 运行时已经存在 `Executor` 抽象与默认实现，不是从零开始设计执行器接口。
- 当前缺口在于配置层、模型包清单层、以及部分诊断/探测链路仍将默认后端锁定为 `opencode`。
- `roleRepo` / `modelRepo` 不是硬编码只能当前项目目录，但 resolver 目前只支持本地文件系统路径。
- 项目在单机场景内已经具备较强的正确性与恢复能力，但长期治理、执行级容量控制、夜间基准门槛仍未收口为硬约束。

## 2. 目标

30 天内完成以下三类收口：

1. 将恢复、基准、保留策略从“可手工验证”升级为“自动化门槛”。
2. 为当前运行时补齐最小执行治理能力，包括超时、节流、等待和失败处置。
3. 在不改变公开契约的前提下，降低核心文件复杂度，并为后续解耦预留清晰扩展点。

## 3. 非目标

本轮明确不做以下事项：

- 不将系统扩展成通用云工作流平台。
- 不从零重写 executor 体系。
- 不引入跨主机协调、分布式锁、共享存储抢占协议。
- 不大幅扩张 DSL 语义面。
- 不在重构阶段顺带修改 public contract。

## 4. 工作分段

### 4.1 第 1 周：运维与回归门槛收口

目标：先建立保护网，再进入执行路径改造。

任务：

- 抽出 `critical reliability` 套件，至少覆盖：
  - recovery invariants
  - mixed chaos
  - fault injection
  - engine conformance
  - retention maintenance
  - control-plane budget
- 保持 PR gate 快速反馈，不把长链基准塞进日常提交门槛。
- 新增 nightly workflow，定时运行长链恢复与 benchmark。
- benchmark 结果输出为可比较 artifact，至少保留：
  - 本次运行时间
  - 关键恢复耗时
  - checkpoint / replay 指标
  - 与上一基线的差异
- 将 retention、benchmark、恢复验证纳入统一报告格式。

建议改动入口：

- `package.json`
- `.github/workflows/ci.yml`
- `tests/benchmarks/runtime-replay-benchmark.mjs`
- 与恢复/故障注入相关测试入口文件

验收标准：

- PR gate 仍保持快速。
- nightly 自动产出 recovery 与 benchmark 趋势。
- 长链验证不再依赖手工运行。
- 出现恢复耗时回退时，能通过 artifact 直接定位趋势变化。

### 4.2 第 2-3 周：补齐最小执行治理

目标：在已有执行超时能力之上，补齐节点级治理策略与观测闭环，并为高扇出场景补最小容量控制。

任务：

- 基于现有 `timeoutMs` 执行超时能力，补齐节点级 `timeout / retry / catch` 治理策略。
- 为超时增加显式观测数据与诊断闭环：
  - 命中节点
  - 超时阈值
  - 实际耗时
  - 是否进入 retry / fail-stop / catch
- 设计并实现最小执行级容量控制，候选方式：
  - `parallel.max`
  - provider-level concurrency pool
- 二选一优先，标准是对现有运行时侵入最小、观测最直接。
- 为等待类节点先补最小治理契约设计与测试闭环：
  - `wait_for_signal`
  - `approve`
  - `resume`
- 上述契约优先限定为单机文件型恢复，不引入外部控制平面；是否在同一里程碑内完成完整实现，取决于前两项治理改造的落地复杂度。
- 补齐与上述能力对应的 conformance / chaos / recovery 测试。

建议改动入口：

- `src/runtime/graph-runner.ts`
- `src/runtime/role-executor.ts`
- `src/runtime/transition-planner.ts`
- `src/runtime/config.ts`
- `src/runtime/types.ts`
- `src/runtime/doctor.ts`
- 相关 runtime / recovery / fault-injection tests

验收标准：

- timeout 从“已有执行超时”升级为“节点级治理策略 + 观测闭环”。
- 高扇出下存在明确节流语义。
- 运行时与观测面能显示 timeout / retry / backpressure 的触发信息。
- wait / signal / resume 至少完成单机文件型最小契约设计与测试闭环；若实现一并落地，则不得破坏当前恢复基线。

### 4.3 第 4 周：复杂度降噪与扩展点清理

目标：在护栏已建立的前提下，降低核心模块认知复杂度，收敛后续扩展入口。

优先拆分文件：

- `src/runtime/parse-mermaid.ts`
- `src/runtime/cli.ts`
- `src/runtime/opencode-executor.ts`
- `src/runtime/graph-runner.ts`

拆分原则：

- 语义纯计算与 I/O 逻辑分离。
- durable artifact / checkpoint / projection 逻辑分离。
- route surface 与业务逻辑分离。
- 不修改 public contract。
- 每一轮拆分都必须由 conformance、recovery、fault-injection 回归保护。

并行补齐两类扩展点：

- repo resolver：从“仅本地文件系统路径”整理为显式扩展点。
- executor 接入链路：沿现有 `Executor` 接口扩展，让配置层和 model manifest 不再只认 `opencode`。

这里的目标不是立即支持多后端，而是消除当前“接口已抽象、接入链路未解锁”的结构不对称。

验收标准：

- 核心大文件显著缩短。
- 关键路径职责边界更清晰。
- repo resolver / executor 接入点清晰化，但默认行为保持不变。
- 全量 conformance / recovery 回归继续全绿。

## 5. 里程碑

### Milestone A：Nightly 和可靠性护栏上线

- 时间：第 1 周末
- 结果：critical reliability 套件与 nightly 自动运行可用

### Milestone B：最小执行治理闭环

- 时间：第 3 周末
- 结果：节点级 timeout 治理与节流闭环可用，wait/signal/resume 完成单机最小契约设计与测试闭环

### Milestone C：复杂度降噪完成

- 时间：第 4 周末
- 结果：高复杂度核心文件完成第一轮拆分，运行契约不变

## 6. 风险与控制

### 风险 1：把治理改造直接做成 DSL 扩张

控制：

- 所有新增能力优先走 runtime enforcement。
- 不为最小策略新增过宽语义面。

### 风险 2：在没有护栏时重构核心路径

控制：

- 必须先完成 nightly 和 critical reliability 套件，再进入核心拆分。

### 风险 3：把 executor 问题误判为“没有抽象”

控制：

- 保持 `Executor` 接口不重做。
- 只解锁配置层、manifest 层、doctor/探测链路的接入限制。

### 风险 4：把 repo 问题误判为“只能项目相对目录”

控制：

- 文档和实现都统一表述为“当前仅支持本地文件系统 resolver”。
- 后续扩展优先围绕 resolver abstraction，而不是改默认目录。

## 7. 建议的 PR 切片

1. `ci: add nightly reliability and benchmark workflow`
2. `test: add critical reliability suite`
3. `runtime: wire timeout semantics into execution path`
4. `runtime: add minimal fan-out capacity control`
5. `runtime: add wait/signal/resume governance closure`
6. `refactor: split graph runner and parser hot paths`
7. `refactor: unlock repo resolver and executor config entrypoints`

## 8. 完成定义

本计划完成时，应同时满足以下条件：

- recovery / benchmark / retention 已形成自动化门槛。
- timeout / 节流 / wait-signal 不再只是语义声明。
- 高复杂度文件完成第一轮降噪。
- repo resolver 与 executor 接入链路具备后续扩展条件。
- 默认行为、公开契约和单机场景稳定性不发生倒退。
