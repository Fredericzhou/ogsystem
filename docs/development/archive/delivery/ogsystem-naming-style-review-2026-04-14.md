# OGSystem 命名风格统一审计与建议（2026-04-14）

Archived: yes (review record; not active source of truth)

> 注：关于 `error_edges` vs `error_flows` 的结论，已被  
> `docs/archive/delivery/ogsystem-flow-edge-alignment-review-2026-04-15.md` 更新。  
> 若涉及 `flow/edge` 根语义对齐，请以后者为准。
>
> 本文当前仅保留仍然有效的命名风格建议，尤其是 `join.*` / `wait.*`
> 相关 DSL 命名判断；涉及 `flow/edge` 根语义与 canonical 配置键的旧结论已撤回。

## 1. 目标与范围

本审计当前聚焦以下两类命名：

1. Mermaid DSL 元数据键（`%% key=value`）。
2. 运行时错误码与事件名（如 `GRAPH_*`、`join_*`）。

重点回答的问题：

1. 是否应改成 `wait_join_first_packet` 这种命名？

---

## 2. 当前命名现状（事实）

### 2.1 DSL 元数据键风格（当前最稳定）

现有图语义键主风格是：

1. `dot namespace`（点分层）：`join.mode.<roleId>`、`context.map.<roleId>.<field>`。
2. 段名使用 `snake_case` 或短词：`all_of`、`quorum_of`、`loop.max`。
3. 语义域前缀明确：`role.*` / `join.*` / `context.*` / `loop.*`。

这套风格已经在解析器与文档广泛稳定存在。

### 2.2 Runtime JSON 键风格（混合）

1. 大部分键是 `camelCase`：`maxTransitions`、`allowNoopWithoutExecutionBinding`。
2. 历史上存在 `snake_case` 例外键；其是否保留为 canonical 不在本文裁决范围内。

### 2.3 代码内命名风格

1. TS 字段与变量：`camelCase`（如 `joinModeByRoleId`）。
2. 错误码：`UPPER_SNAKE_CASE` 且带域前缀（`MERMAID_*` / `GRAPH_*` / `ROLE_*`）。
3. 审计事件类型：`lower_snake_case`（如 `join_late_arrival_ignored`）。

---

## 3. 关键命名问题结论

## 3.1 `wait_join_first_packet`：不建议

不建议原因：

1. 与现有 DSL 的点分层风格冲突（现有都是 `join.mode.*` 这一类）。
2. 可扩展性差（`default`、`<roleId>`、子项继承会变得不自然）。
3. 与解析器现有前缀校验模型不一致，增加规则分支。

结论：**不要采用扁平下划线大串键名**。

## 3.2 `error_edges` vs `error_flows`：本文不再裁决

该问题已由  
`docs/archive/delivery/ogsystem-flow-edge-alignment-review-2026-04-15.md`
重新审计并覆盖。

本文撤回旧结论，不再将 `error_edges` 视为 canonical 命名建议来源。

---

## 4. Wait Timeout 命名建议（Mermaid-only v2）

为体现“仅 Join 等待”特点，并与现有 `join.mode/join.sources/join.min` 统一，建议：

1. 采用 `join.*` 域下命名。
2. 不再引入新的顶层 `wait.*` 域。

推荐 canonical（建议）：

1. `join.first_packet.default`
2. `join.first_packet.<roleId>`
3. `join.gap.default`
4. `join.gap.<roleId>`
5. `join.on_timeout.<roleId>`（v2 仅允许 `FAIL`）

不推荐：

1. `wait_join_first_packet`（扁平大串）
2. `wait.first_packet.*`（可用但 join 属性不够直观，且新开一套顶层域）

备注：若必须追求最小变更、完全复用现有 v2 文稿，也可暂保留 `wait.*`；但从“统一风格”角度，`join.*` 更一致。

---

## 5. 统一命名规则（建议冻结）

### 5.1 DSL 元数据键

1. 必须使用点分层：`<domain>.<field>[.<subfield>][.<target>]`。
2. 固定段名使用 `snake_case`（如 `on_timeout`、`first_packet`）。
3. 语义域优先复用既有域（`join/role/context/loop`），避免新增平行域。
4. 动态标识（`<roleId>`）尽量放尾段（`context.map` 为已存在例外）。

### 5.2 Runtime JSON 配置键

1. 新增键默认 `camelCase`。
2. 若某键已被后续专门审计文档重新裁决，以后续专门文档为准。
3. 本文不再对 `error_edges/error_flows` canonical 作出判断。

### 5.3 错误码与事件

1. 错误码：`<DOMAIN>_<DETAIL>`，全大写下划线。
2. 审计事件：`lower_snake_case`。
3. 同一语义跨层命名保持可映射（例如 join timeout -> `GRAPH_JOIN_*` + `join_timeout_*` 事件）。

---

## 6. 变更影响评估

若把 wait timeout canonical 从 `wait.*` 改为 `join.*`（当前尚未实现阶段）：

1. 成本：主要是文档与后续 parser 规则键名调整，代码未落地前成本可控。
2. 收益：减少新顶层域、与现有 join 语义命名同构、阅读成本更低。
3. 风险：低（因功能仍在 proposal/待实现阶段）。

---

## 7. 最终建议（可直接执行）

1. wait timeout 采用 **Join 域 canonical**：`join.first_packet/join.gap/join.on_timeout`。
2. 在 v2 文档中删除 `wait_join_*` 一类候选，明确“不使用扁平下划线串名”。
3. 后续实现按上述 canonical 入 parser 与 runner，避免实现后再重命名。
4. `flow/edge` 根语义与 `error_flows` canonical 以后续专项审计文档为准，不再以本文为准。
