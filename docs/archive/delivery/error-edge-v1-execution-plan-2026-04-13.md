# OGSystem 异常边语义（ERROR*）执行计划

Date: 2026-04-13  
Status: completed  
Owner: runtime core

## 0. 当前进度（2026-04-13）

- [x] 决策冻结：语义边界与非目标已确认
- [x] C 线文档同步：语义手册/使用手册/决策/索引/产品与 ebook 口径已更新
- [x] M2 Parser 增强
- [x] M3 Runtime 路由增强
- [x] M4 审计与摘要增强
- [x] M5 模板与示例

## 1. 目标与边界

本计划用于在不扩张图语义复杂度的前提下，为 OGSystem 增加“运行时失败可显式转补偿流”的能力。

本轮目标：

1. 维持现有控制流语义：`parallel_split / all_of / quorum_of / loop.max`。
2. 保持“动态 fan-out 的不确定 N”在节点内部能力（Heavy Node），不进入图语义。
3. 保持受控并发为执行策略，不进入 Flow 语义定义。
4. 新增唯一语义：运行时失败可命中 `ERROR*` 显式异常边。
5. `ERROR*` 为节点级 opt-in：声明了 `ERROR*` 边的节点启用异常流；未声明节点行为保持当前 fail-stop。

非目标：

1. 不新增 map/for-each 类动态 fan-out DSL。
2. 不新增特殊节点类型。
3. 不新增 fan-out 专用日志事件类型。

## 2. 冻结决策（实现真相约束）

1. `ERROR*` 为保留事件前缀。
2. 正常成功执行路径不得主动通过 role 输出触发 `ERROR*`。
3. `ERROR*` 仅由运行时失败路径触发（execution/validation/io/state 等）。
4. 并行场景按分支级处理：仅失败分支走异常流；未命中异常边才升级为全局失败。
5. `ERROR.<code>` 使用精确匹配，不支持前缀匹配和通配符。
6. 执行器内部重试耗尽后，才进行一次异常边匹配。
7. 命中异常边后 run 状态保持 `running`，并写入 handled-failure 审计信息。
8. 失败分支不直接视为 join source 完成；后续是否进入 join 由补偿节点正常事件决定。
9. feature flag：`runtime.error_edges.v1`，默认 `off`，用于灰度和回滚。

## 3. 语义规格 V1

### 3.1 语法与事件

沿用现有边标签语法，不新增 DSL：

- `ERROR`
- `ERROR.<errorCode>`

示例：

```mermaid
worker[Role:worker] -->|DONE| next[Role:next]
worker[Role:worker] -->|ERROR| compensate[Role:compensate]
worker[Role:worker] -->|ERROR.TOOL_EXECUTION_TIMEOUT| retry[Role:retry]
```

### 3.2 匹配顺序

1. 先匹配 `ERROR.<errorCode>`
2. 再匹配 `ERROR`
3. 无匹配则保持当前 fail-stop

### 3.3 校验规则

1. 同一 `fromRole` 仅允许一个 `ERROR` 兜底边。
2. 同一 `fromRole` 下同一个 `ERROR.<code>` 仅允许一个目标。
3. `input` 不允许声明 `ERROR*` 边。
4. `ERROR*` 边不要求出现在该 role 的正常输出 schema 的 event enum 中。

## 4. 模板规范（普通节点）

异常处理节点继续使用普通 `Role`，建议提供模板族：

1. `error-handler-base`（标准骨架）
2. `human-approve-gate`
3. `human-signal-wait`

建议统一最小输入字段：

- `error_code`
- `error_message`
- `failed_role`
- `branch_id`
- `lineage_id`
- `loop_iteration`
- `last_context`

建议统一最小输出字段：

- `event`（模板词表内）
- `content`
- `data`（可选）

推荐事件词表：

- `human-approve-gate`: `APPROVED | REJECTED | TIMEOUT`
- `human-signal-wait`: `SIGNAL_OK | SIGNAL_FAIL | EXPIRED`

## 5. 里程碑与改动面

### M1 文档对齐

目标：修正语义与目录漂移，明确异常边范围与非目标。

建议改动：

1. `docs/ogsystem-orchestration-semantics-v1.md`
2. `docs/usage-manual.md`
3. `docs/DECISIONS.md`
4. `docs/README.md`（索引与优先级）

### M2 Parser 增强

目标：`ERROR*` 合法性、唯一性、边界约束 fail-closed。

建议改动：

1. `src/runtime/parse-mermaid.ts`
2. `src/runtime/types.ts`（必要时补充错误分类常量或辅助类型）

### M3 Runtime 路由增强

目标：失败后按 `ERROR.<code> -> ERROR` 匹配并决定转补偿或终止。

建议改动：

1. `src/runtime/graph-runner.ts`
2. `src/runtime/role-executor.ts`（仅保持失败包信息完整，不改正常输出契约）

关键行为：

1. 命中异常边：当前失败分支转为“已处理失败分支”，激活目标分支继续运行。
2. 无命中：保持现有全局失败行为。
3. feature flag 关闭时：完全保持旧行为。

### M4 审计与摘要增强

目标：区分 handled vs unhandled failure。

建议改动：

1. `src/runtime/run-summary.ts`
2. `src/runtime/graph-runner.ts`（事件写入）
3. 审计输出文件（`audit/summary.md` 字段）

建议新增字段：

1. `handledFailureCount`
2. `unhandledFailureCount`
3. `handled_by_event`
4. `handled_target_role`

### M5 模板与示例

目标：提供可直接复用的异常流与人审 gate 示例。

建议改动：

1. `og-roles/roles/*`（新增模板角色）
2. `examples/*`（新增异常补偿流示例、人审 gate 示例）
3. 使用手册增加“何时使用异常边 vs 业务事件边”的判定说明

## 6. 测试矩阵与验收标准

### 6.1 解析测试

1. `ERROR*` 合法边通过。
2. 重复 `ERROR` 兜底边拒绝。
3. 重复 `ERROR.<code>` 拒绝。
4. `input` 声明 `ERROR*` 拒绝。

### 6.2 运行测试

1. 命中 `ERROR.<code>` 走精确目标。
2. 无精确命中但有 `ERROR` 走兜底目标。
3. 无异常边时保持 fail-stop。
4. 并行分支场景下，单分支失败命中异常边不导致全局立刻失败。

### 6.3 兼容性测试

1. 无 `ERROR*` 边的现有系统行为完全不变。
2. feature flag 关闭时行为完全不变。

### 6.4 恢复一致性测试

1. 异常流路径下 checkpoint/resume 一致。
2. 恢复后不重复执行已 durable 的失败尝试。
3. 状态不回退、不漂移。

验收门槛：

1. `pnpm test` 全绿。
2. 新增异常边相关测试覆盖 parser + runtime + resume 关键路径。
3. 手册和语义文档同步更新。

## 7. 发布与灰度策略

1. 第一阶段：`runtime.error_edges.v1=off`，仅 examples 与内部模板灰度。
2. 第二阶段：默认 `on`，保留 flag 作为回滚开关。
3. 发布说明明确：旧图无需改动；只有新增 `ERROR*` 边才改变失败行为。

## 8. 风险与回滚

主要风险：

1. 失败路由引入状态推进歧义。
2. 并行+join 场景语义误判。
3. 审计统计口径改变影响既有报表。

缓解：

1. 以 feature flag 控制发布面。
2. 强化 parser fail-closed。
3. 将 handled/unhandled 字段作为增量字段，不破坏既有字段。

回滚：

1. 将 `runtime.error_edges.v1` 置 `off`。
2. 保持旧图和旧运行行为无迁移成本。
