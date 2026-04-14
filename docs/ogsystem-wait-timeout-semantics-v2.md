# OGSystem 等待超时与并行汇合语义规范（v2 RFC）

更新时间：2026-04-14  
状态：RFC / **未实现**（proposal-only）  
适用范围：运行时编排层（Join 等待、并行汇合超时、全局兜底）  
权威级别：低于 `src/runtime/*` 与 `docs/ogsystem-orchestration-semantics-v1.md`

---

## 0. 目的与结论

本 RFC 目标是给 Join 等待补齐“可超时”的系统护栏，同时保持配置和语义尽量简单：

1. 仅保留两段等待：`first_packet` + `gap`。
2. 执行超时与等待超时分层：`timeoutMs`（执行）与 `wait.*`（等待）分开。
3. 不只依赖一个全局大超时：保留 `global.deadlineMs` 作为兜底，但不替代局部等待控制。

---

## 1. 当前实现事实（As-Is）

以下是当前代码现状，不是目标语义：

1. Mermaid 元数据是白名单，`wait.*` / `join.deadline` / `join.on_timeout` 目前会被拒绝。
2. `runtime` 配置白名单未包含等待超时相关键。
3. 调度器主路径是事件驱动，不存在独立 wait timer/poll 机制。
4. Join 在 readiness 未满足时不会激活分支，直接 `continue` 等待后续事件。
5. `ERROR*` 入口当前绑定在“角色执行失败 outcome”；Join timeout 不是现成的执行失败路径。

---

## 2. 目标语义（To-Be）

### 2.1 时间分层

1. 执行时长：`timeoutMs`（节点执行预算）。
2. 等待时长：`wait.first_packet` 与 `wait.gap`（Join 等待预算）。

二者不得混算。

### 2.2 Join 两段等待

1. `first_packet`：等待首个有效 source 到达的上限。
2. `gap`：首包到达后，相邻有效 source 到达间隔的上限。

---

## 3. 命名与配置（去歧义）

### 3.1 配置面与归一（硬规则）

v2 目标支持两种配置面，但内部必须归一为同一 canonical 结构：

1. Mermaid metadata 扁平键：
   `wait.first_packet.default`、`wait.first_packet.<roleId>`、`wait.gap.default`、`wait.gap.<roleId>`、`wait.on_timeout.<roleId>`、`global.deadlineMs`。
2. Runtime YAML 结构键：
   `wait.first_packet.{default,<roleId>}`、`wait.gap.{default,<roleId>}`、`wait.on_timeout.{<roleId>}`、`global.deadlineMs`。
3. 内部 canonical 归一后字段仅保留：
   `wait.first_packet`、`wait.gap`、`wait.on_timeout`、`global.deadlineMs`。
4. 跨配置面冲突不做“覆盖优先级”：
   同一 canonical 字段若在两种配置面都声明，值必须一致；不一致则解析期直接失败（`WAIT_SURFACE_CONFLICT`）。

### 3.2 Canonical 键与别名

推荐 canonical 键：

1. `wait.first_packet.default`
2. `wait.first_packet.<roleId>`
3. `wait.gap.default`（可选）
4. `wait.gap.<roleId>`
5. `wait.on_timeout.<roleId>`（v2 默认 `FAIL`）
6. `global.deadlineMs`（全局兜底）

兼容别名：

1. `join.deadline.<roleId>` -> `wait.first_packet.<roleId>`
2. `join.on_timeout.<roleId>` -> `wait.on_timeout.<roleId>`

### 3.3 别名冲突规则（硬规则）

若 canonical 与 alias 同时出现：

1. 值相同：接受，canonical 生效，记录一次兼容告警（可选）。
2. 值不同：**解析期直接失败**（fail-closed）。

建议错误码：`MERMAID_WAIT_ALIAS_CONFLICT`。

### 3.4 默认值、优先级与继承（硬规则）

每个 join 角色 `roleId` 的解析口径固定如下：

1. `first_packet(roleId)` 解析顺序：  
   `wait.first_packet.<roleId>` > `wait.first_packet.default` > 解析失败（`WAIT_FIRST_PACKET_MISSING`）。
2. `gap(roleId)` 解析顺序：  
   `wait.gap.<roleId>` > `wait.gap.default` > `first_packet(roleId)`（强制继承）。
3. `on_timeout(roleId)` 解析顺序：  
   `wait.on_timeout.<roleId>` > `FAIL`（v2 唯一必选动作）。

即：`role > default > fallback`，其中 fallback 对 `first_packet` 是“失败退出”，对 `gap` 是“继承 first_packet”。

### 3.5 解析与校验（fail-closed）

1. `wait.first_packet.*` 与 `wait.gap.*` 单位统一为毫秒（ms），且必须是正整数。
2. `wait.*` 仅允许配置在 join 角色上；非 join 角色声明 `wait.*` 直接失败（`WAIT_NON_JOIN_ROLE`）。
3. `wait.*` 引用的 `roleId` 必须存在于图中；不存在直接失败（`WAIT_UNKNOWN_ROLE`）。
4. `wait.on_timeout.*` 在 v2 仅允许 `FAIL`；其他枚举值直接失败（`WAIT_UNSUPPORTED_TIMEOUT_ACTION`）。
5. `default` 是唯一保留默认槽位；除 `default` 外其余键必须被解析为已定义 `roleId`。

---

## 4. 起算点定义（与现机制对齐）

### 4.1 first_packet 起点（修正）

由于当前 Join “未 ready 不激活分支”，不能使用“Join 分支入队时刻”作为统一起点。  
v2 建议引入显式 `joinPending` 观察状态，并定义：

1. `t_pending_started`：某 `joinKey(roleId, lineageId, loopIteration)` 进入“待汇合观察态”的时刻。
2. `first_packet` 判定：`now - t_pending_started > wait.first_packet` 且 `arrivalCount == 0`。

### 4.2 gap 起点

1. `t_last_arrival`：最近一次有效 source 到达时刻。
2. `gap` 判定：`now - t_last_arrival > wait.gap`（仅在 `arrivalCount > 0` 时）。

---

## 5. 时钟与 Resume（必须补充）

仅使用 monotonic 会在跨进程 resume 后失去连续基准。v2 建议双轨：

1. 运行时判定使用 monotonic（进程内稳定）。
2. 持久化使用 wall-clock deadline（`deadlineAtEpochMs`）。
3. resume 时按 `deadlineAtEpochMs - nowEpochMs` 重建剩余预算；若已过期则立即触发超时路径。

这样可避免重启后超时漂移。

---

## 6. on_timeout 映射（与 ERROR* 对齐）

`on_timeout=FAIL` 需要明确路径，不可隐含“等同 executeRoleNode 失败”。

v2 建议：

1. 失败信封由调度器 wait-timer 子系统产出（不是 role executor）：
   针对 `joinPending` 轮询判定超时后，直接构造 runtime failure envelope。
2. 新增 Join timeout 失败代码：
   - `GRAPH_JOIN_FIRST_PACKET_TIMEOUT`
   - `GRAPH_JOIN_GAP_TIMEOUT`
3. 进入统一“运行时失败路由”：
   - 若启用 `error_edges.v1` 且 join 节点声明 `ERROR.<code>`/`ERROR`，走异常边。
   - 否则进入现有 fail-stop。
4. 审计落点必须包含：
   `runId`、`branchId`、`lineageId`、`loopIteration`、`roleId`、`timeoutType`、`budgetMs`、`elapsedMs`、`onTimeoutAction`、`dedupKey`。
5. 单触发硬约束：  
   `dedupKey = roleId + lineageId + loopIteration + timeoutType`。首次触发写入并路由，后续重复仅记 `join_timeout_duplicate_ignored` 审计，不重复路由。

注意：这是“运行时状态失败”，不是“角色执行失败”。

---

## 7. 调度前置改造（最小闭环）

要让等待超时可触发，至少需要：

1. 增加 `joinPending` 状态（含 `t_pending_started`、`t_last_arrival`、`arrivalCount`）。
2. 增加 timer 驱动能力（tick/poll 或等价机制）。
3. 调整 scheduler 结束条件：  
   不能只看 `activeRoles.length === 0`，还要看是否存在未完成 `joinPending`。

否则在“无活动角色但有待汇合窗口”时会提前 END，超时永远不会触发。

---

## 8. 并行超时策略

结论：不建议仅一个“大统一超时”。

建议双层：

1. `global.deadlineMs`：整轮兜底。
2. `timeoutMs + wait.first_packet + wait.gap`：局部定位与局部失败控制。

### 8.1 `maxTransitions` 与 `global.deadlineMs` 的终止顺序（硬规则）

为避免双重终止语义冲突，v2 约定：

1. 运行中并行检查 `maxTransitions` 与 `global.deadlineMs`，谁先触发谁先终止。
2. 若同一调度周期内两者同时满足，按固定优先级处理：先 `maxTransitions`，后 `global.deadlineMs`。
3. 终止后走统一 fail-stop/审计出口，错误码必须区分触发源：
   - `GRAPH_TRANSITION_BUDGET_EXCEEDED`
   - `GRAPH_GLOBAL_DEADLINE_EXCEEDED`

---

## 9. v2 最小动作集

默认且唯一必选：`FAIL`。

可扩展（后续版本）：

1. `PARTIAL_CONTINUE`
2. `SKIP`

v2 不要求这些扩展动作落地。

---

## 10. 伪代码（概念级）

```ts
const key = joinKey(roleId, lineageId, loopIteration);
const pending = getJoinPending(key);
const nowMono = monotonicNow();
const nowEpoch = Date.now();

// resume-safe: deadlineAtEpochMs 优先用于“是否已到期”判定
if (pending.arrivalCount === 0) {
  if (
    expiredByEpochOrMono(pending.firstPacketDeadlineAtEpochMs, nowEpoch, pending.tPendingStartedMono, nowMono, waitFirstPacket(roleId)) &&
    markJoinTimeoutFiredOnce(key, "FIRST_PACKET")
  ) {
    failJoinTimeout("GRAPH_JOIN_FIRST_PACKET_TIMEOUT", key);
  }
} else {
  if (
    expiredByEpochOrMono(pending.gapDeadlineAtEpochMs, nowEpoch, pending.tLastArrivalMono, nowMono, waitGap(roleId)) &&
    markJoinTimeoutFiredOnce(key, "GAP")
  ) {
    failJoinTimeout("GRAPH_JOIN_GAP_TIMEOUT", key);
  }
}
```

---

## 11. 配置示例（提案）

```yaml
timeoutMs:
  analyst: 120000
  reviewer: 180000

wait:
  first_packet:
    default: 120000
    joiner: 240000
  gap:
    # 未配置可继承 first_packet.joiner
    joiner: 90000
  on_timeout:
    joiner: FAIL

global:
  deadlineMs: 900000

# 兼容别名
join:
  deadline:
    joiner: 240000
  on_timeout:
    joiner: FAIL
```

---

## 12. 落地前置检查清单（准确性门槛）

在宣称“已支持 v2”之前，需至少完成：

1. `parse-mermaid.ts` 白名单扩展 + 别名冲突规则 + `wait` 数值/role/join-only 校验。
2. `config.ts` 白名单扩展。
3. `graph-runner.ts` 加入 `joinPending + timer + scheduler end 条件修正`。
4. Join timeout 由调度器产出 envelope，并实现去重单触发与审计落盘。
5. Join timeout 到 ERROR*/fail-stop 的显式路由实现。
6. 跨配置面冲突策略（同值接受、异值失败）在解析期生效。
7. `gap` 缺省继承 `first_packet` 与 `first_packet` 缺失 fail-closed 在解析期生效。
8. resume 跨进程 deadline 持久化与恢复逻辑。
9. 文档状态从 RFC 改为 Delivered，并回写主语义文档。

---

## 13. 文档状态约定

本文件在上述检查清单完成前，始终为“提案文档”，不是当前运行时语义真相。
