# OGSystem 源码注释加固执行计划（2026-04-11）

Archived: yes (delivery record only; not active source of truth)  
Stable-track superseded by: `docs/todo-backlog.md`, `docs/long-term-stability-roadmap.md`  
Date: 2026-04-11  
Status: Proposed  
Owner: Runtime maintainers  
Scope: `src/runtime/*`, `src/nl2mmd/*`

## 1. 背景与目标

当前仓库实现已较成熟，但源码普遍存在“可读性依赖上下文记忆”的问题：关键设计取舍、恢复语义、不变量主要散落在实现细节中，注释覆盖不均。

本计划目标不是“增加注释数量”，而是建立一套低噪声、高信息密度的注释体系：

1. 突出设计理念、取舍与成熟经验。
2. 每个源码文件给出文件集定位与职责说明。
3. 在关键路径补齐不变量、失败窗口与恢复语义说明。

## 2. 范围与非目标

### 2.1 范围

1. 为所有 `src/**/*.ts` 文件补充统一格式的文件头导读（L1）。
2. 在状态机、持久化、重试、恢复、边界校验等关键路径补充内联注释（L2）。
3. 在 `src/runtime/types.ts` 和关键导出接口补充 TSDoc 契约说明（L3）。
4. 增加注释规范文档与文件集映射文档，支持后续持续治理。

### 2.2 非目标

1. 不修改业务行为与运行语义。
2. 不引入新的运行时依赖。
3. 不通过注释替代测试或设计文档真相源。

## 3. 设计原则（硬性）

1. 注释解释“为什么（Why）”，不是复述“做了什么（What）”。
2. 遇到状态与 I/O 关键段，优先描述不变量、失败窗口、恢复语义。
3. 注释内容必须可被代码事实验证，禁止写不存在的错误码、保证条件或时序假设。
4. 注释密度控制在可维护范围（建议 8%~15%），宁少勿滥。

## 4. 三层注释模型

### 4.1 L1：模块级导读（文件头）

适用范围：所有源码文件。  
目的：快速回答“这个文件在系统中的位置与边界是什么”。

模板：

```ts
/**
 * @fileoverview <一句话使命>
 * File Set: <runtime-core | runtime-recovery | runtime-exec | runtime-observability | nl2mmd-*>
 * Responsibilities:
 * - <2~4条>
 * Boundaries:
 * - <不负责什么>
 * Trade-offs:
 * - <关键取舍>
 * @see <相关文件>
 */
```

### 4.2 L2：关键路径注释（内联）

适用范围：状态机推进、checkpoint/WAL、resume、重试、锁、解析与校验关键分支。  
目的：降低“读者必须脑补隐式契约”的成本。

模板：

```ts
// Invariant: <必须始终成立的条件>
// Failure window: <在哪一步崩溃会留下什么中间态>
// Recovery semantics: <系统如何继续保持一致性>
// Trade-off: <为何不用另一个看似更直观的方案>
```

### 4.3 L3：类型与接口契约（TSDoc）

适用范围：关键 `type/interface` 与导出函数。  
目的：在 IDE 悬停时直接暴露语义，而非仅字段名。

优先字段：

1. 可选字段（`?`）及其可空语义。
2. 排序/稳定性相关字段（例如时间戳、序列号）。
3. 恢复语义相关字段（checkpoint frontier、session lineage）。

## 5. 文件集划分与职责速览

### 5.1 runtime-core

- `graph-runner.ts`
- `graph-runtime-state.ts`
- `execution-plan.ts`
- `graph-mode-registry.ts`

职责：调度、状态推进、分支/循环语义、计划消费。

### 5.2 runtime-recovery

- `run-artifacts.ts`
- `run-artifact-policy.ts`
- `audit-recorder.ts`
- `runtime-errors.ts`

职责：持久化证据链、恢复边界、锁、错误包络。

### 5.3 runtime-exec

- `role-executor.ts`
- `opencode-executor.ts`
- `executor.ts`
- `tool-runner.ts`

职责：角色执行、会话延续、重试策略、工具执行。

### 5.4 runtime-observability & support

- `run-summary.ts`
- `stage-projector.ts`
- `console-run-log.ts`
- `doctor.ts`
- `runtime-support.ts`
- `json-file.ts`
- `json-schema.ts`

职责：可观测性投影、统计摘要、运行诊断、基础工具。

### 5.5 runtime-adapter & entry

- `adapter.ts`
- `config.ts`
- `cli.ts`
- `lint.ts`
- `langgraph-runner.ts`

职责：入口编排、配置读取、校验入口、兼容导出。

### 5.6 nl2mmd

- `src/nl2mmd/*`

职责：自然语言到 Mermaid 的转换、语义映射、校验与 CLI。

## 6. 分批执行计划（优先级）

### P0（关键路径先行）

文件：

- `graph-runner.ts`
- `run-artifacts.ts`
- `role-executor.ts`
- `opencode-executor.ts`
- `parse-mermaid.ts`
- `graph-runtime-state.ts`
- `executor.ts`
- `types.ts`

目标：

1. 完成 L1 文件头覆盖。
2. 补齐关键路径 L2 注释（状态推进、恢复边界、重试放弃条件）。
3. 补齐核心契约 L3（特别是 `GraphState`、`AuditRecord`、checkpoint 相关类型）。

### P1（核心支撑层）

文件：

- `adapter.ts`
- `runtime-errors.ts`
- `audit-recorder.ts`
- `run-summary.ts`
- `graph-mode-registry.ts`
- `execution-plan.ts`
- `tool-runner.ts`
- `run-artifact-policy.ts`

目标：

1. 统一文件集导读与职责边界。
2. 完成错误码与恢复语义关键注释。
3. 统一关键导出函数 TSDoc。

### P2（全仓一致性补齐）

文件：

- 其余 `src/runtime/*`
- 全量 `src/nl2mmd/*`

目标：

1. 实现“所有源码文件均有 L1 导读”。
2. 对校验/转换链路补充必要 L2 注释。
3. 统一命名与注释语气风格，清理冗余注释。

## 7. 交付物

1. 本计划文档（本文件）。
2. `docs/commenting-style.md`：注释规则、反例与审查清单。
3. `docs/file-sets.md`：源码文件集与依赖关系。
4. P0/P1/P2 三批注释补强 PR（建议拆分提交，降低评审负担）。

## 8. 验收标准（Definition of Done）

1. `src/**/*.ts` 文件头（L1）覆盖率 100%。
2. P0 文件关键函数具备 L2 注释，且能明确回答：
   - 不变量是什么；
   - 崩溃发生在中间步骤会怎样；
   - 为什么采用当前取舍。
3. `types.ts` 关键类型字段具备 L3 注释，重点可空/排序/恢复语义。
4. 无“复读机注释”与事实不一致注释。
5. 本轮改动不引入功能行为变化；类型检查与测试通过。

## 9. 实施节奏与评审策略

1. 先提交规范文档（`commenting-style.md` + `file-sets.md`）。
2. 再按 P0 -> P1 -> P2 分批提交，每批可独立评审与回滚。
3. 每个 PR 控制在 6~10 个文件，减少大体积注释改动的审查疲劳。
4. 评审时按“正确性优先于覆盖率”原则：注释可少，不可错。

## 10. 风险与缓解

1. 风险：注释与实现漂移。  
   缓解：关键逻辑改动时要求同 PR 更新注释与相关文档。
2. 风险：注释过量降低可读性。  
   缓解：强制执行“解释 Why，不复述 What”。
3. 风险：注释承诺超出代码真实能力。  
   缓解：审查中对错误码、时序、恢复语义逐项对照源码。

## 11. PR 审查清单（可复制）

1. 是否新增/修改了关键状态或 I/O 路径？若是，是否更新了 L2 注释。
2. 注释是否描述了不变量、失败窗口、恢复语义或取舍。
3. 是否存在与代码不一致的承诺性语句。
4. 导出类型与接口是否具备必要 TSDoc。
5. 是否出现复述变量名的低价值注释。

## 12. 预期收益

1. 新成员读码冷启动时间显著下降。
2. 恢复与状态机相关变更的评审成本下降。
3. 架构意图可沉淀在源码中，减少“口口相传”知识债务。
