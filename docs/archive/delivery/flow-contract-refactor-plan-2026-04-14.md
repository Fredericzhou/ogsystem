# OGSystem Flow Contract 重构方案与语义优先级清单（2026-04-14）

Archived: yes (delivery proposal; not active source of truth)  
Status: proposed  
Date: 2026-04-14  
Owner: Runtime maintainers

## 1. 目标与结论

本方案用于统一以下方向：

1. 统一框架输出信封为 `event/content/data`（运行时可附加 `_meta` 技术字段）。
2. `flow` 作为强合同（强制结构校验）载体。
3. `role` 不再承担 `input/output schema` 的硬结构定义，而是表达能力边界（可文本化、可选标签化）。
4. 编译/校验阶段提前暴露“合同超出角色能力范围”的风险。

核心原则：

- 协作合同强制在流转层，不在角色层重复定义。
- 角色层是能力声明，不是场景合同。
- 运行时 fail-closed 只对 flow contract 生效；role capability 由编译策略决定是 warn 还是 error。

可执行前置条件（必须先满足）：

1. 解析器白名单先放行新 metadata 键，否则 `handoff.*` 在 parse 阶段即失败。
2. `parallel_split` 的合同匹配规则先定稿（无 event 输出时如何匹配合同）。
3. role `outputSchema` 的兼容迁移路径先实现（manifest/执行期/校验链路的阶段化改造）。

---

## 2. 待补齐语义（按优先级）

### P0（必须先做）

| 语义 | 说明 | 价值 | 风险 |
| :--- | :--- | :--- | :--- |
| `handoff.contract.<fromRoleId>.<eventType>.<toRoleId>.*` | 流转合同强制声明（schema/version/on_violation） | 交接确定性、审计性、可恢复性显著提升 | 合同迁移成本上升 |
| `route.order.<fromRoleId>` | 同事件多流转命中顺序 | 消除隐式顺序歧义，行为可复现 | 需要增加 lint 冲突规则 |
| `join.deadline.<roleId>` + `join.on_timeout.<roleId>` | join 超时治理 | 防止汇合长尾卡死 | 与 retry/stop 语义耦合增加 |

### P1（高收益增强）

| 语义 | 说明 | 价值 | 风险 |
| :--- | :--- | :--- | :--- |
| `role.capability.<roleId>.*` | 角色能力文本/标签化声明（`can/cannot/notes/tags`） | 场景复用强，能力治理清晰 | 自动匹配准确率依赖规范化 |
| `role.idempotency.<roleId>` | 副作用节点幂等键策略 | 降低重放/恢复重复副作用 | 幂等键错误会误去重 |
| `role.retry.<roleId>.*` | 节点级重试策略 | 失败恢复稳定性提升 | 配置不当拉高时延/成本 |

### P2（治理层扩展）

| 语义 | 说明 | 价值 | 风险 |
| :--- | :--- | :--- | :--- |
| `route.when.<fromRoleId>.<toRoleId>` | 条件化路由（受限表达） | 业务路由显式可审计 | DSL 复杂度快速上升 |
| `govern.approve.<roleId>` / `govern.veto.<roleId>` | 审批/否决关系语义 | 组织决策链可落盘 | 运行路径变长 |
| `law.scope.*` | 多作用域策略优先级 | 长期规则体系可扩展 | 冲突解析复杂 |

备注：`any_of` 不新增为独立关键字，继续用 `quorum_of + join.min=1` 表达，减少 DSL 面扩张。

---

## 3. Flow Contract 全量方案（目标态）

### 3.1 统一信封（runtime envelope）

运行时统一交接结构：

```json
{
  "event": "PASS",
  "content": "summary text",
  "data": {
    "score": 87
  },
  "_meta": {
    "runId": "20260414-120001-ab12cd34",
    "fromRoleId": "review",
    "toRoleId": "decision",
    "branchId": "review@1#2",
    "lineageId": "dispatch@1#1",
    "loopIteration": 1,
    "contractVersion": 1,
    "at": "2026-04-14T12:00:01.000Z"
  }
}
```

说明：

- `event/content/data` 为业务信封。
- `_meta` 为技术字段，由运行时补齐，不要求 role 生成。
- flow contract 可默认只约束 `event/content/data`，不强制约束 `_meta` 业务含义。

### 3.2 Mermaid 元数据口径

```txt
%% handoff.mode=strict|compat
%% handoff.contract.<fromRoleId>.<eventType>.<toRoleId>.schema=schemas/handoff/<name>.json
%% handoff.contract.<fromRoleId>.<eventType>.<toRoleId>.version=1
%% handoff.contract.<fromRoleId>.<eventType>.<toRoleId>.on_violation=FAIL|WARN
%% handoff.contract.<fromRoleId>.__split__.<toRoleId>.schema=schemas/handoff/<name>.json
```

推荐：

- `strict`：缺合同或合同校验失败直接失败。
- `compat`：缺合同告警，合同存在时强校验。
- `__split__`：仅用于 `role.mode.<fromRoleId>=parallel_split` 且 role 输出不依赖 event 的合同匹配。

解析器迁移要求：

- 在 Phase 0 增加 `handoff.mode` 与 `handoff.contract.*` 键白名单支持。
- 在未实现运行时合同校验前，`handoff.*` 仅允许 lint 消费，不改变当前执行语义。

### 3.3 `handoff.*` 字段分级（必选/可选/默认值）

| 字段 | 级别 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `handoff.mode` | 可选 | `compat`（Phase 1）；`strict`（Phase 2 起建议默认） | 全局合同执行模式。 |
| `handoff.contract.<from>.<event>.<to>.schema` | 必选（strict）/可选（compat） | 无 | 指向 JSON Schema。 |
| `handoff.contract.<from>.<event>.<to>.version` | 可选 | `1` | 合同版本号（审计与回放定位）。 |
| `handoff.contract.<from>.<event>.<to>.on_violation` | 可选 | `FAIL` | strict 下仅允许 `FAIL`。 |
| `handoff.contract.<from>.__split__.<to>.schema` | 条件必选（当 `from` 为 `parallel_split` 且 strict） | 无 | split 场景合同匹配锚点。 |
| `handoff.contract.<from>.__split__.<to>.version` | 可选 | `1` | 同上。 |
| `handoff.contract.<from>.__split__.<to>.on_violation` | 可选 | `FAIL` | strict 下仅允许 `FAIL`。 |

额外约束：

- 当 `role.mode.<fromRoleId>=parallel_split` 时，`__split__` 与 `<eventType>` 两种合同键不应混用；lint 直接报错，避免匹配歧义。
- strict 下，任何命中流转都必须存在合同声明；缺失合同直接失败，不允许降级为 WARN。

### 3.4 Role 能力口径（非强 schema）

`role.json` 建议新增（或保留可选）：

```json
{
  "roleId": "developer",
  "name": "Developer",
  "can": ["implement", "refactor"],
  "cannot": ["approve_release"],
  "capabilityNotes": "可开发 C/Java，当前团队 C 更稳定",
  "tags": ["lang:c", "lang:java", "domain:backend"]
}
```

说明：

- `tags` 为可选治理增强，不是 flow 口径来源。
- role 不再以 `input/output schema` 做硬阻断。
- role 在迁移完成前仍保留现有 schema 字段以兼容现网运行路径。

---

## 4. 自动校验方案（编译期 + 运行期）

### 4.1 编译期（lint/plan）

新增 `ContractPlan` 构建步骤：

1. 从 Mermaid 收集所有 role-to-role 流转：
   - 普通路由：`fromRoleId + eventType + toRoleId`
   - `parallel_split`：`fromRoleId + __split__ + toRoleId`
2. 校验每条流转的合同声明完整性（按 `handoff.mode` 决定是否必须）。
   - 若 `fromRole` 为 `parallel_split`，必须使用 `__split__` 键空间。
   - 若检测到 `parallel_split` 同时声明 `__split__` 与 `<eventType>` 合同，直接报错。
3. 校验 schema 可加载/可编译（AJV）。
4. 校验声明与流转一一对应（拒绝“无对应流转”的孤儿合同）。
5. 对 role capability 做匹配分析并产出风险：
   - `CAPABILITY_MISMATCH_WARN`
   - `CAPABILITY_MISMATCH_ERROR`（由策略决定）

兼容性判定策略（建议）：

- 先做受限匹配（字段覆盖、枚举匹配、关键标签匹配），避免全量 schema 子类型推导复杂度。
- 匹配结果为“风险评估”，非默认硬阻断。

### 4.2 运行期（execute/transition）

每次 role 输出后执行：

1. 基础信封校验：输出必须是 `event/content/data` 结构。
2. 运行时附加 `_meta` 技术字段形成交接信封（role 输出不需要 `_meta`）。
3. 命中流转集合：
   - 普通路由：按输出 `event` 匹配
   - `parallel_split`：忽略 `event`，按 `__split__` 匹配所有下游
4. 对每条命中流转执行合同校验（schema）。
5. 根据运行模式与 `on_violation` 处理结果。
6. 通过后才激活下游节点。

join 场景：

- 上游每条流转先各自过合同。
- join 节点仍按现有 `all_of/quorum_of` 语义判断 readiness。

### 4.3 `strict/compat` 行为矩阵（消除歧义）

| 场景 | strict | compat |
| :--- | :--- | :--- |
| 合同缺失 | FAIL | WARN |
| 合同 schema 无效 | FAIL | FAIL |
| 合同校验失败 | FAIL | 按 `on_violation`（默认 FAIL） |
| `on_violation=WARN` | 不允许（按配置错误处理） | 允许 |

实现约束（必须）：

- strict 模式下，`on_violation` 语义固定为 `FAIL`；若配置 `WARN`，按配置错误处理，不进入执行阶段。
- compat 模式下，仅“合同缺失”允许 WARN；“schema 无效”永远 FAIL。

---

## 5. 与现有实现关系

当前实现已有：

- role 输出 schema 作为模型格式约束 + 本地二次校验。
- `context.map` 投影与 join 语义硬约束。
- 解析器对 metadata key 采用白名单拒绝策略（未知 key 直接失败）。
- `parallel_split` 当前允许 role 在无 event 情况下激活全部下游。

目标迁移关系：

1. 保留现有 `event/content/data` 信封。
2. 引入 flow contract 作为新的强约束主面。
3. role `input/output schema` 逐步降级并移除（分阶段）。

---

## 6. 分阶段重构计划

## Phase 0：文档与 lint 预埋（低风险）

- 先改解析器白名单，放行 `handoff.mode` / `handoff.contract.*`。
- 增加语义文档章节：flow contract 口径与错误码。
- 新增 `lint:contracts`（仅检查声明与 schema 可用性）。
- 增加 `strict/compat` 行为矩阵校验，拒绝 strict + WARN 组合。

## Phase 1：运行时并行校验（兼容）

- 保留 role output schema。
- 新增 flow contract 校验（可 `compat` 模式）。
- 报告 role capability 风险（warn）。
- 落地 `parallel_split` 的 `__split__` 匹配路径，不改变现有 split 激活语义。

## Phase 2：Flow Contract 主导

- `strict` 成为默认模式。
- 缺合同视为配置错误（role-to-role 流转）。
- role output schema 降为兼容层（可开关）。
- 提供 `contract-only` 诊断模式，对 role schema 仅告警不阻断。

## Phase 3：Role 去 schema 化

- `role.json` 中 `inputSchema/outputSchema` 改为可选，并在加载器中兼容缺省。
- 执行器不再依赖 role output schema 作为二次硬校验；合同校验成为主路径。
- 为旧 role 包提供迁移脚本：从 role output schema 生成初始 flow contract 模板。
- role 保留能力定义（文本/标签）与提示用途。

### 阶段闸门（Gate）

| Gate | 必须完成项 | 回滚开关 |
| :--- | :--- | :--- |
| G0（Phase 0 出口） | 解析器已放行 `handoff.*`；`lint:contracts` 可运行；strict/WARN 冲突可被拦截 | 移除 `handoff.*` 配置即可回到旧语义 |
| G1（Phase 1 出口） | `parallel_split` `__split__` 匹配生效；运行时合同校验可观测；不改变现有成功路径 | `handoff.mode=compat` + 保留 role schema 校验 |
| G2（Phase 2 出口） | strict 成为默认；所有 role-to-role 流转具备合同 | 全局切回 `compat` |
| G3（Phase 3 出口） | role schema 变可选；执行链不再硬依赖 role output schema | 打开 role schema 兼容开关 |

---

## 7. 错误码与观测

建议新增错误码：

- `CONTRACT_MISSING`
- `CONTRACT_SCHEMA_INVALID`
- `CONTRACT_UNBOUND_FLOW`
- `CONTRACT_VALIDATION_FAILED`
- `CAPABILITY_MISMATCH_WARN`
- `CAPABILITY_MISMATCH_ERROR`

审计建议：

- 在 `events.ndjson` 增加 `contract_validation` 事件（包含 from/event/to/version/result）。
- 在 `audit/summary.md` 增加合同校验统计。

---

## 8. 验收标准（DoD）

1. 任意 role-to-role 流转在 `strict` 模式下都可追溯到唯一合同。
2. 合同缺失/不匹配可在 lint 阶段被发现。
3. 运行时合同失败行为稳定可预期：strict 必须 fail-closed；compat 可按 `on_violation` 执行 WARN/FAIL。
4. `all_of/quorum_of/context.map/loop.max` 既有语义回归为零。
5. 文档、测试、错误码、CLI 诊断同步可用。

---

## 9. 风险与回滚

主要风险：

- 迁移期合同缺失导致大量阻断。
- 存量 role 包兼容策略不一致。
- schema 维护负担短期上升。

回滚策略：

- 全局切回 `handoff.mode=compat`。
- 保留 role output schema 兼容开关直到 Phase 3 完成。

---

## 10. 本次建议回写目标

若本方案被接受，需回写：

1. `docs/ogsystem-orchestration-semantics-v1.md`（语义与约束）
2. `docs/usage-manual.md`（配置、命令、排障）
3. `docs/DECISIONS.md`（为何采用 flow 强合同 + role 软能力）
