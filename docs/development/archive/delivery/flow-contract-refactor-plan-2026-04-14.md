# OGSystem Flow Contract 重构方案（修订版，2026-04-14）

Archived: yes (delivery proposal; not active source of truth)  
Status: proposed  
Date: 2026-04-14  
Owner: Runtime maintainers

## 1. 目标与核心结论

本修订版明确采用两层主分工，避免把业务合同和技术协议混在一起：

1. 技术层（Runtime Envelope）：统一 `event/content/data`，`_meta` 由运行时注入。
2. 业务层（Flow Contract）：以 flow 为准，定义“这条边允许传什么”。

说明：Role Capability 不属于本次重构主链，若后续需要推进，另开独立 RFC/里程碑。

结论：

- 用户关注与配置重点应是业务合同（flow contract），不是技术字段。
- 技术字段由框架统一约束；role 仅保留最小生成护栏（minimal schema）。
- 编译期做主校验，运行期做 fail-closed 执行校验。

---

## 2. 当前约束与待解决冲突

当前仓库已有且本方案需要遵守的运行时约束：

1. Mermaid metadata 是白名单，未知 key 直接失败。
2. 角色输出当前只允许 `event/content/data` 三个字段。
3. `parallel_split` 可以在无 event 的情况下激活全部下游。
4. `join` 通过 `all_of/quorum_of + join.sources + join.min` 判定就绪。
5. `ERROR*` 是运行时失败路由，不是普通业务输出事件。

已知冲突（本修订需要规避）：

1. `handoff.contract.<from>.<event>.<to>.*` 作为 metadata key 有歧义风险。  
原因：`roleId` 与 `eventType` 允许包含 `.`，按 `.` 分段不稳定。
2. 若只改 parser 不改 NL2MMD，会出现“可写不可保留/可写不可生成”的链路断裂。
3. 若直接移除 role output schema，会破坏执行器结构化生成约束与现有校验链路。

---

## 3. 分层定义（建议作为后续文档回写口径）

### 3.1 技术层：Runtime Envelope（统一、框架托管）

运行时交接信封（角色无需输出 `_meta`）：

```json
{
  "event": "PASS",
  "content": "summary",
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
    "contractId": "review.pass.to.decision.v1",
    "contractVersion": 1,
    "at": "2026-04-14T12:00:01.000Z"
  }
}
```

边界：

- 业务合同默认仅约束 `event/content/data`。
- `_meta` 是技术审计字段，不作为业务合同输入来源（除非显式允许只读引用）。
- `_meta` 属于运行时临时交接信封，不进入持久化 `StoredRoleResult/result.json` 主体。
- 若需要审计 `_meta`，应写入 `events.ndjson` 或专门的运行时审计事件，而不是回写为 role 输出事实。

### 3.2 业务层：Flow Contract（以 flow 为准）

不再把 `from/event/to` 编进 metadata key。  
改为独立合同清单文件，并在 Mermaid 只声明引用：

```txt
%% handoff.mode=strict|transition
%% handoff.contracts=contracts/handoff.contracts.json
%% route.order.<fromRoleId>=<toRoleIdA>,<toRoleIdB>,...
```

`contracts/handoff.contracts.json` 示例：

```json
{
  "version": 1,
  "contracts": [
    {
      "id": "intake.pass.to.dispatch.v1",
      "kind": "flow",
      "match": {
        "fromRoleId": "intake",
        "eventType": "PASS",
        "toRoleId": "dispatch"
      },
      "schema": "schemas/handoff/intake-pass.json",
      "onViolation": "FAIL"
    },
    {
      "id": "dispatch.split.to.worker_a.v1",
      "kind": "flow",
      "match": {
        "fromRoleId": "dispatch",
        "mode": "split",
        "toRoleId": "worker_a"
      },
      "schema": "schemas/handoff/split-worker-task.json",
      "onViolation": "FAIL"
    },
    {
      "id": "review.join.input.v1",
      "kind": "role_input",
      "match": {
        "roleId": "review"
      },
      "schema": "schemas/handoff/review-join-input.json",
      "onViolation": "FAIL"
    }
  ]
}
```

说明（拟定口径）：

- `kind=flow`：校验 flow 上传递载荷。
- `kind=role_input`：校验节点最终输入（特别适合 join + context.map，也适用于 split/普通接收节点的 `context.map` 投影输入）。
- `mode=split`：用于 `parallel_split` 场景，不依赖 event 匹配。
- `role_input` 是业务层输入合同；现有 `role.inputSchema` 继续保留为技术层 prompt-input 合同，两者并存但不互相替代。
- 本次主链计划只处理：技术 envelope、flow contract、minimal schema、resume 一致性。

---

## 4. 特殊节点任务示例

### 4.1 `parallel_split`（无 event 分发）

Mermaid：

```mermaid
flowchart TD
%% system.id=demo.split
%% system.version=1.0.0
%% law.global=law.default
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% handoff.mode=strict
%% handoff.contracts=contracts/handoff.split.json
%% route.order.dispatch=worker_a,worker_b
%% context.map.worker_a.task=direct.data.tasks.worker_a
%% context.map.worker_b.task=direct.data.tasks.worker_b

input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TASK_A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|TASK_B| worker_b[Role:worker_b]
worker_a[Role:worker_a] -->|DONE_A| output
worker_b[Role:worker_b] -->|DONE_B| output
```

合同匹配任务：

1. `dispatch` 进入 split 时忽略输出 event。
2. 对每个命中下游（`worker_a`、`worker_b`）按 `mode=split + from + to` 匹配 flow 合同。
3. split 后若不同下游需要不同输入视图，不新增额外投影机制；统一由接收节点使用现有 `context.map.<roleId>.* = direct.*` 做接收侧投影。
4. flow 合同校验共享上游 envelope；接收节点若声明 `role_input` 合同，则在其 `context.map` 投影后的结构化对象上校验最终输入，而不是校验字符串化后的 prompt context。
5. 每条 flow 单独进入匹配集合，但 strict/transition 的激活策略按第 7 节统一处理。

### 4.2 `join.mode=all_of` + `context.map`

Mermaid：

```mermaid
flowchart TD
%% system.id=demo.join.allof
%% system.version=1.0.0
%% law.global=law.default
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=all_of
%% join.sources.review=dev,qa
%% context.map.review.dev_report=source(dev).data.report
%% context.map.review.qa_risk=source(qa).data.risk
%% context.map.review.task=global.task
%% handoff.mode=strict
%% handoff.contracts=contracts/handoff.join.json

input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|DEV| dev[Role:dev]
dispatch[Role:dispatch] -->|QA| qa[Role:qa]
dev[Role:dev] -->|DONE_DEV| review[Role:review]
qa[Role:qa] -->|DONE_QA| review[Role:review]
review[Role:review] -->|DONE| output
```

建议校验顺序：

1. `dev -> review`、`qa -> review` 分别走 `kind=flow` 合同校验。  
2. `all_of` 就绪后，运行 `context.map.review.*` 构建输入。  
3. 对 `review` 执行 `kind=role_input` 合同校验。  
4. 通过后才激活 `review`。

### 4.3 `join.mode=quorum_of`（阈值激活）

原则与 `all_of` 一致，只是就绪条件变为 `join.min`。  
建议保留“激活一次，迟到 source 仅审计不重复激活”的目标语义。

但需补一条 v1 硬约束：

1. 当 `join.mode.<roleId>=quorum_of` 且 `join.min < |join.sources|` 时，`context.map.<roleId>.*` 不允许使用 `source(...)` selector。
2. 原因：当前运行时允许任意满足 quorum 的 source 子集触发激活，但 `source(x)` 在缺席时会直接 fail-closed。
3. 因此在现有实现下，`quorum_of` 节点的 `context.map` 仅允许：
   - `global.*`
   - 未来新增的显式 optional selector（本方案 v1 不包含）
4. 若 `join.min == |join.sources|`，该 `quorum_of` 退化为事实上的全量到齐，此时 `source(...)` 才是安全的。

---

## 5. 字段冲突/字段不足处理规则

### 5.1 编译期（目标约束）

1. flow 合同引用 schema 不可加载/不可编译（AJV）。
2. 合同与 flow 无绑定关系（孤儿合同）。
3. flow 命中关系在 strict 下无合同覆盖。
4. `role_input` 合同要求字段在 `context.map` 投影后不可达。
5. 同一 target 字段被多来源重复映射（投影冲突）。
6. `parallel_split` 同时声明 event 匹配合同与 split 匹配合同（语义歧义）。
7. `quorum_of` 且 `join.min < |join.sources|` 时，若 `context.map` 使用 `source(...)`，应报错。

上述“不可达/投影冲突”在 v1 的目标含义应收敛为轻量 lint：

1. 只检查 selector 语法是否合法、source 是否允许、目标字段是否存在映射、以及同一 target 字段是否被多来源重复声明。
2. 对 `role_input` 对应合同 schema 的 `required` 字段，只检查这些字段能否由 `context.map` 生成，不做跨 JSON Schema 的深层类型证明。
3. 对 `transition + skip flow -> join 不可达`，只做基于 `join.sources/join.min/flow 命中集合` 的结构性判定，不做全图 reachability 求解。
4. v1 明确不实现：跨 schema 类型统一推导、任意 `$ref` 展开后的语义等价证明、或全图静态可满足性分析。
5. parser 已对重复 metadata key 直接失败，因此“投影冲突”在这里仅指合同/lint 层对同一 target 字段的重复声明/重复投影口径，不引入新的静态分析面。

### 5.2 运行期（目标策略）

1. `strict`：合同失败 -> fail-closed，不激活对应 flow；在 `parallel_split` 等多目标场景下按第 7 节两阶段规则整体处理。
2. `transition`：
   - 合同缺失 -> WARN + skip flow（避免脏数据透传）。  
   - 合同存在但校验失败 -> 默认 FAIL（允许显式 WARN 仅用于过渡）。
3. 若 `transition + skip flow` 会导致某个 join 条件变为不可达，则该情况应升级为 `FAIL`，不能只保留告警。

---

## 6. `strict/transition` 与边界范围

默认合同作用范围（v1）：

1. role-to-role 业务边（普通事件边 + split 边）。
2. 不默认覆盖 `ERROR*` 运行时异常边。
3. 不强制覆盖 role->output 边（可选）。

行为矩阵：

| 场景 | strict | transition |
| :--- | :--- | :--- |
| 合同缺失（在作用范围内） | FAIL | WARN（默认不激活该 flow；若导致 join 不可达则升级为 FAIL） |
| 合同 schema 无效 | FAIL | FAIL |
| 合同校验失败 | FAIL | 按 `onViolation`（默认 FAIL） |
| `onViolation=WARN` | 不允许 | 允许（仅用于过渡验证） |

---

## 7. 编译与运行任务清单

### 7.1 编译期（lint/plan）

拟新增 `ContractPlan`：

1. 读取 `handoff.contracts` 指向的合同文件。
2. 收集 flow：普通 `from+event+to` 与 split `from+mode=split+to`。
3. 建立 `flow <-> contract` 唯一映射。
4. 校验普通 flow 不允许重复声明（同一 `fromRoleId + eventType + toRoleId`）。
5. 校验 `route.order.<fromRoleId>`：目标合法、无重复。
6. 校验 `role_input` 合同与 `context.map` 可达性。
7. 识别 `transition + skip flow` 是否会让 join 条件不可达；若不可达则应报错或升级策略。

V1 lint 边界（按最佳实践收敛复杂度）：

1. `role_input` 的“可达性”仅指投影字段级可达，检查的是 `context.map` 能否生成合同 schema 所需字段，不要求对合同 schema 做强静态证明。
2. `transition + skip flow` 的“不可达”仅针对当前命中 flow 与目标 join 的局部结构做判断，不扩展为全系统图可达性分析。
3. 编译期目标是提前发现高价值、低歧义错误，而不是把运行时语义完整搬成静态分析器。

### 7.2 运行期（execute/transition）

每次 role 成功输出后：

1. 先做 envelope 基础校验（`event/content/data`）。
2. 运行时注入 `_meta`。
3. 计算命中边集合（普通事件匹配或 split）。
4. 应用 `route.order`（仅重排普通 role-edge 的命中集合，不改命中集合；`ERROR*` 与 `output` 不参与该排序）。
5. `strict` 下采用两阶段语义：
   - Phase A：先对全部命中 flow 做合同校验，不激活任何下游。
   - Phase B：仅当全部通过时，再统一激活所有命中下游。
6. `transition` 下允许逐 flow 处理：
   - 单条 flow 校验通过则可激活该 flow 下游。
   - 单条 flow 校验失败则按 `onViolation` 处理，且不影响其他已通过 flow。
7. 下游节点在激活前，若声明 `role_input` 合同，则先构造其 `context.map` 投影后的结构化输入对象；`role_input` 合同只校验该对象，不校验字符串化后的 prompt context。
8. `role.inputSchema` 若存在，继续只校验技术层 promptInput；不得把 `role_input` 业务合同并入或替代 `role.inputSchema`。
9. flow 合同与 `role_input` 合同校验所用 envelope/输入对象均为运行时派生的临时结构；不得为此把 `StoredRoleResult` 改造成按 flow 分叉的持久化 artifact 模型。
10. 通过后激活下游。

---

## 8. 最小约束（Minimal Schema）策略

原则：

1. 不再让每个 role schema 承担业务协作契约。
2. role 保留最小技术护栏：输出 envelope 基础形状与基础类型。
3. 业务约束全部放到 flow contract。

Schema floor（建议）：

1. 顶层仅允许 `event/content/data`。
2. `event` 为可选非空字符串，`content` 为可选字符串，`data` 为可选对象。
3. 不要求把 `ERROR*` 禁止编码进 schema；该规则继续由 runtime 独立强制。

Lint policy（建议）：

1. 若某 role 的普通业务事件集合稳定，继续建议保留 `event enum`。
2. `event enum` 作为 lint/生成质量信号，不再是 flow 业务合同真源。
3. 无稳定事件集的 role 可只使用 schema floor，由 flow contract 补业务约束。

最小约束价值：

1. 给模型输出提供稳定轨道（降低格式漂移）。
2. 配合 runtime 规则，降低保留事件与非法字段误输出风险。
3. 保持恢复/审计一致性（输出结构稳定）。

---

## 9. 分阶段任务计划

## Phase 0：契约载体与工具链对齐（低风险）

1. parser 白名单放行：`handoff.mode`、`handoff.contracts`、`route.order.*`，并与 NL2MMD / fingerprint 同步完成，不允许只改单侧。
2. 新增合同文件加载与 `lint:contracts`。
3. NL2MMD 同步支持上述 metadata；normalize 不再丢弃这些 key。
4. `SystemDefinition` / `GraphMetadata` / plan 类型补充合同引用与 `route.order` 承载字段。
5. 指纹补充完整语义字段（resume 一致性），至少包括：
   - `routingModeByRoleId`
   - `joinModeByRoleId`
   - `joinSourcesByRoleId`
   - `joinMinByRoleId`
   - `contextMapByRoleId`
   - `loopMaxByRoleId`
   - `handoff.mode`
   - 合同文件 digest
   - `route.order.*`

Phase 0 退出前需要冻结接口边界：

1. parser 输入面
2. `SystemDefinition` / execution plan 承载面
3. resume 指纹面
4. NL2MMD 生成与校验面
5. parser 入口面与 NL2MMD / fingerprint 面应同轮冻结，禁止分批启用。

## Phase 1：运行时并行校验（过渡验证）

1. 保留现有 role output schema。
2. 增加 flow 合同校验（`transition` 默认）。
3. split 合同匹配路径上线。

## Phase 2：Flow Contract 主导

1. `strict` 成为默认。
2. 作用范围内缺合同直接失败。
3. 支持基于 `context.map` 的节点 `role_input` 合同校验。

## Phase 3：Role Schema 收敛（非移除）

1. role schema 缩减为 minimal schema（技术护栏）。
2. 业务字段约束从 role schema 收敛到 flow contract。

---

## 10. 错误码与观测（建议项）

建议新增：

- `CONTRACT_MISSING`
- `CONTRACT_SCHEMA_INVALID`
- `CONTRACT_UNBOUND_FLOW`
- `CONTRACT_VALIDATION_FAILED`
- `CONTRACT_ROLE_INPUT_VALIDATION_FAILED`
- `CONTRACT_PROJECTION_PATH_MISSING`
- `CONTRACT_PROJECTION_CONFLICT`

审计建议：

- `events.ndjson` 增加 `contract_validation`（from/event/to 或 role_input、contractId、result）。
- `audit/summary.md` 增加合同通过率与失败分布。

---

## 11. 风险处置（临时）

主要风险：

1. 上线期合同缺失导致严格模式阻断。
2. 合同文件与 Mermaid 图漂移。
3. 生成链路（NL2MMD）未同步导致配置被吞。
4. 若 strict 未采用“两阶段校验 -> 统一激活”，split 会出现顺序相关的部分激活。
5. 若未限制 `quorum_of + source(...)`，有 `context.map` 时 join 输入构建本身就可能 fail-closed。
6. 若不把 `role_input` 校验对象固定为“投影后的结构化对象”，且不明确其与现有 `inputSchema` 的分层边界，会形成两套输入合同叠加。
7. 若 `_meta` 进入持久化结果，会把单次 role 结果膨胀为按 flow 分叉的 artifact 模型，显著增加实现复杂度。

处置开关：

1. 全局 `handoff.mode=transition`，仅用于上线验证/回滚处置。
2. 保留 role minimal schema + 现有输出校验兜底。
3. 移除 `handoff.contracts` 引用即可回退到旧行为。
4. 验证成功后清理上述处置开关，不作为长期设计保留，也不演化为常驻兼容层。

---

## 12. 与 wait-timeout v2 的关系

`join.deadline/on_timeout` 不并入本方案主链。  
其上线依赖 `docs/ogsystem-wait-timeout-semantics-v2.md` 从 RFC 进入 Delivered 后再做独立里程碑。

---

## 13. 回写目标（若采纳）

1. `docs/ogsystem-orchestration-semantics-v1.md`
2. `docs/usage-manual.md`
3. `docs/DECISIONS.md`
4. `docs/ogsystem-semantics-manual.md`

---

## 14. 实施前检查清单（待冻结项）

1. 合同文件路径解析基准待冻结为：相对 `system.mmd` 所在目录解析；运行时归一为绝对路径用于加载与 fingerprint。
2. JSON Schema 方言待冻结为：draft-07。
3. `$ref` 策略待冻结为：仅允许本地文件引用；相对 `$ref` 以当前 schema 文件所在目录为基准解析；禁止远程 `http(s)://` 引用。
4. 每个合同 schema 文件应显式声明 `$schema: "http://json-schema.org/draft-07/schema#"`。
5. `transition` 默认动作待冻结为：`WARN + skip flow`；但若导致 join 不可达则升级为 `FAIL`。该机制仅用于上线处置，验证通过后可清理。
6. 指纹覆盖范围待冻结：应纳入完整语义字段与合同 digest，不能只补增量字段。
7. `role_input` 与 `role.inputSchema` 的边界待冻结：前者是业务层投影对象合同，后者是技术层 prompt-input 合同，两者并存但不互相替代。
8. `role_input` 合同触发时机待冻结为：任何声明该合同且使用 `context.map` 构造业务输入的接收节点，都在激活前校验一次；且校验对象固定为投影后的结构化对象。
9. `_meta` 生命周期待冻结：仅用于运行时校验/审计，不进入持久化 role 结果；flow 合同校验使用派生的临时 envelope，不改造 `StoredRoleResult` 持久化模型。
10. `ERROR*` 合同策略待冻结：v1 继续排除，若需纳入另开 RFC。
11. 一次性验证工具策略待冻结：仅保留临时离线检查/生成工具用于上线验证，验证完成后可清理，不纳入长期设计。
12. schema floor 待冻结为：允许仅保留 `event/content/data` 基础形状；若业务事件集稳定，则保留 `event enum` 作为强建议 lint，而非硬合同真源。
13. `transition` 待冻结为一次性处置开关，不得演化为长期兼容层；验证后需要清理。
14. 编译期“可达性/不可达”待冻结为轻量 lint：只做字段级投影覆盖与局部 join 结构判定，不做跨 schema 强证明或全图静态求解。
