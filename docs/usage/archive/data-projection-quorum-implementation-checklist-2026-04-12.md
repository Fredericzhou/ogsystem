# OGSystem 数据投影与 Quorum Join 实施清单（开发测试版，latest-only）

Archived: yes (delivery record only; not active source of truth)  
Spec reference: `docs/ogsystem-data-projection-spec.md`  
Runtime truth after landing: `docs/ogsystem-orchestration-semantics-v1.md`  
Status: Delivered  
Date: 2026-04-12  
Owner: Runtime maintainers

## Delivery Result

Status summary:

1. `quorum_of + join.min` 已在 parser、execution plan、join handler、scheduler、恢复链路与审计事件中落地。
2. `context.map.<roleId>.<field>=<selector>` 已在 parser 校验与 runtime prompt projection 中落地，且保持 fail-closed。
3. 相关契约测试、执行时失败测试、quorum/late-arrival 回归、resume 回归与文档回写已完成。

## 1. 适用范围与约束

1. 本清单仅面向开发测试环境，直接按最新版本推进。
2. 不做历史运行数据兼容，不做旧 DSL 兼容，不做迁移桥接。
3. 首期只做两项能力：
   - `quorum_of + join.min`
   - `context.map.<roleId>.<field>=<selector>`
4. 首期明确不做：
   - 通用表达式系统
   - reducer / merge contract
   - 任意祖先或兄弟分支读取
   - `metrics` / `role` 投影
   - 数组索引、转换函数、fallback、隐式 merge
5. 所有新增语义必须保持 prompt 输入合同不变，仍然只通过现有 `context` / `last_output` 对角色可见。

## 2. 目标

1. 用最小语义增强覆盖 `N-of-M` join 场景，不再额外引入 `any_of` 等重复模式。
2. 把角色输入从“粗粒度上下文传递”提升到“字段级只读投影”，降低噪音、token 和误判。
3. 保持运行时确定性、可审计性和 resume 一致性。
4. 在不复杂化系统的前提下，为后续更强状态语义预留干净扩展面。

## 3. 风险最佳实践（首期必须遵守）

1. 只扩展现有 metadata 体系，不新增第二套 DSL。
2. 解析与执行都要 fail-closed；不允许 silent fallback 或自动补 `null`。
3. join 统计范围固定为 `lineageId + loopIteration`，不能跨轮次串计数。
4. quorum 按“唯一 source role”计数，不按到达次数或重试次数计数。
5. join 节点在同一 `lineageId + loopIteration` 下最多激活一次；迟到结果只记录、不重触发。
6. projection 只允许读取已授权运行时事实，不能把 `state.json` 当查询数据库。
7. selector 首期只支持最小 dot-path，对象字段读取；不做数组索引、表达式、变换、fallback。
8. prompt 输入合同保持稳定：新能力只重塑 `context` 的内容，不新增第二套 prompt 字段。
9. 投影结果必须稳定序列化，保证相同输入得到 byte-stable `context`。
10. 即使不做兼容迁移，也必须补 resume 回归；latest-only 不等于可以放弃恢复一致性。
11. 多入边非 join 的现有行为必须保持不变：每个 active branch 各执行一次，不自动 merge。
12. 文档与测试必须和代码同批次落地，不能先上实现后补契约说明。

## 4. 收益与风险判断

### 4.1 `quorum_of + join.min`

收益：

1. 一个语义覆盖 `1-of-M`、`N-of-M`、`M-of-M`，避免同时维护 `any_of`、`all_of`、`count_of` 多套模式。
2. 能表达“先到先用”“部分结果即可继续”的真实工作流。
3. 设计面比单独新增 `any_of` 更小、更干净。

主要风险：

1. 阈值达到后重复激活。
2. `loop` 与 `quorum` 组合时串轮次计数。
3. resume 后 late arrival 触发重复执行。

结论：

- 收益高，风险中等，值得优先实现。

### 4.2 `context.map`

收益：

1. 明显降低 prompt 噪音和 token 浪费。
2. 让上下文授权更接近 least-privilege。
3. 让 join 后节点不再被整块上游 payload 淹没。

主要风险：

1. selector 语法失控后会演化成通用表达式系统。
2. 缺字段策略不清会让运行时行为变得不可预测。
3. 序列化不稳定会影响测试、回放和审计。

结论：

- 收益高，风险中等，适合和 `quorum_of` 一起落地。

### 4.3 延后项

以下能力暂不进入首期，因为风险高于收益：

1. 数组索引、表达式、函数变换。
2. 任意祖先、兄弟分支、全局状态任意查询。
3. reducer / merge contract。
4. `metrics` / `role` 暴露面。

## 5. 实施红线

以下事项任一出现，应视为范围失控并立即回退设计：

1. 出现第二套注释语法，例如 `@ogs-input` / `@ogs-trigger`。
2. 普通节点可以任意读取祖先或兄弟分支结果。
3. selector 支持数组、条件表达式、模板拼接或函数调用。
4. 缺字段默认填 `null` 或静默忽略。
5. `quorum_of` 以到达次数计数，或达到阈值后允许重复触发。
6. 为了投影能力而把 prompt 直接绑定到 `state.json` 序列化布局。

## 6. 完整实施清单

### Phase 0：冻结首期范围与契约

目标：先把语义边界钉死，再开始写代码。

实施项：

1. 冻结首期能力为 `quorum_of + join.min + context.map`。
2. 明确最新版本语义，不保留旧模式兼容分支。
3. 明确 source model：
   - 普通节点：`direct.*`、`global.task`、`global.user_profile.*`
   - join 节点：`source(<roleId>).*(仅限 join.sources)`、`global.*`
4. 明确失败模型：
   - 解析非法 metadata 直接失败
   - 缺失必需字段直接失败
   - 运行时不自动降级
5. 明确确定性规则：
   - 统计单位是唯一 source role
   - 作用域是 `lineageId + loopIteration`
   - join 只激活一次
   - late arrival 仅审计，不重触发

交付：

1. `docs/ogsystem-data-projection-spec.md` 与本清单一致。
2. 团队实现前不再讨论新增 selector 或扩展来源。

### Phase 1：类型与解析器收敛

目标：把新增语义纳入现有 fail-closed 解析面。

建议改动点：

1. `src/runtime/types.ts`
   - 扩展 `GraphJoinMode` 增加 `quorum_of`
   - 为 parsed metadata 增加 `joinMin`、`contextMap` 的类型表达
2. `src/runtime/parse-mermaid.ts`
   - 解析 `join.min.<roleId>`
   - 解析 `context.map.<roleId>.<field>=<selector>`
   - 校验 `join.min` 的上下界
   - 校验 `source(<roleId>)` 只能引用 `join.sources`
   - 校验普通节点不能引用 join-only selector
   - 校验 selector grammar 首期只接受最小 dot-path
3. 解析期错误码与错误文案稳定化

关键风险：

1. 解析器一旦放宽，后续 runtime 就会被迫兜底，复杂度会迅速上升。
2. metadata key 设计若不稳定，后续文档和示例会频繁重写。

验收标准：

1. 未声明新 metadata 时，现有系统解析结果完全不变。
2. 非法 metadata 一律在解析期拒绝。
3. `quorum_of` 与 `context.map` 都有单独的解析单测。

### Phase 2：最小 projection evaluator

目标：只做字段级只读投影，不做表达式系统。

建议改动点：

1. `src/runtime/role-executor.ts`
   - 在现有 `context` 生成路径上增加 `context.map` 分支
   - 无 `context.map` 时维持当前行为
   - 有 `context.map` 时构造稳定字段顺序的 projected object
   - `last_output` 继续镜像 `context`
2. 新增最小 selector evaluator
   - 支持 `direct.content`
   - 支持 `direct.event`
   - 支持 `direct.data`
   - 支持 `direct.data.<path>`
   - 支持 `source(<roleId>).content|event|data|data.<path>`
   - 支持 `global.task`
   - 支持 `global.user_profile|global.user_profile.<path>`
3. 缺字段策略
   - 首期默认 required
   - 找不到路径直接失败

关键风险：

1. evaluator 一旦支持太多 grammar，会迅速退化成小型解释器。
2. 普通节点若能越权引用非 direct 数据，会破坏当前授权边界。
3. JSON 序列化顺序不稳定会导致 snapshot 与回放噪声。

验收标准：

1. 普通节点与 join 节点都能生成稳定的 projected `context`。
2. 非法 selector 与缺字段都明确失败。
3. 没有任何代码路径直接依赖 `state.json` 布局来投影 prompt。

### Phase 3：`quorum_of` 调度与一次性激活

目标：在现有 join 框架内增加最小 quorum 调度，不破坏 `all_of`。

建议改动点：

1. `src/runtime/graph-mode-registry.ts`
   - 注册 `quorum_of` handler
2. `src/runtime/graph-runner.ts`
   - 在 join readiness 计算中引入 `join.min`
   - 统计唯一 source role 完成情况
   - 保持作用域为 `lineageId + loopIteration`
   - 达到阈值后只激活一次
   - 迟到 source 仅追加审计事件
   - 保持现有 `all_of` 语义不变
3. join 激活后的 session / lineage 行为保持和现有 join 一致，避免引入第二套会话规则

关键风险：

1. join 一次性激活保护做得不严，会造成重复执行。
2. retry 或 duplicate completion 被错误计数，会导致提前触发。
3. loop 场景若未按 `loopIteration` 隔离，容易产生跨轮污染。

验收标准：

1. `join.min=1`、`join.min=2`、`join.min=|sources|` 都行为正确。
2. retry 不会重复计数。
3. late arrival 不会重触发。
4. `all_of` 行为与现有测试保持一致。

### Phase 4：恢复与审计回归

目标：确保 latest-only 版本仍具备恢复一致性和可解释性。

实施项：

1. 补充 resume 前后 join readiness 一致性测试。
2. 补充 threshold 已达到但 join 尚未执行时的 crash/resume 测试。
3. 补充 join 执行后 late arrival 到达时的 resume 测试。
4. 审计事件中明确区分：
   - quorum reached
   - join activated
   - late arrival ignored
5. 确保 `events.ndjson` 与运行摘要能解释“为什么在此时触发”。

关键风险：

1. latest-only 环境最容易忽视 resume，最终会把问题拖到后期才暴露。
2. 没有足够审计事件时，问题虽然能复现但很难定位。

验收标准：

1. 首次执行与 resume 执行结果一致。
2. 审计日志能解释 quorum 的计数过程与触发时点。

### Phase 5：文档、示例、提交门禁

目标：确保新语义可用、可读、可验证，而不是只停留在代码层。

实施项：

1. 更新 `docs/ogsystem-orchestration-semantics-v1.md`
   - 补 `quorum_of`
   - 补 `context.map`
   - 补“多入边非 join 不自动 merge”的显式规则
2. 更新 `docs/usage-manual.md`
   - 新增 metadata 示例
   - 新增错误场景说明
3. 保持 `docs/ogsystem-data-projection-spec.md` 为设计草案，并在权威文档落地后缩减重复说明
4. 增加最小示例系统
   - 一个 `quorum_of` 示例
   - 一个 `context.map` 示例
5. 统一提交门禁
   - typecheck
   - 全量测试
   - examples
   - doctor

验收标准：

1. 文档与代码同批次合入。
2. 示例可跑通。
3. 新语义不依赖口头解释。

## 7. 重点风险清单

### R1. 重复触发

风险等级：高  
表现：同一 join 在阈值达到后被再次激活。  
防护：

1. 在 `lineageId + loopIteration + roleId` 维度记录已激活标记。
2. late arrival 只写审计，不走二次调度。
3. 单测覆盖重复 completion、retry、resume 三类路径。

### R2. 串轮次计数

风险等级：高  
表现：上一轮 loop 的 source 被下一轮 quorum 误用。  
防护：

1. readiness 统计强制绑定 `loopIteration`。
2. loop 相关测试覆盖 `0 -> 1 -> 2` 至少三轮。

### R3. selector 复杂度膨胀

风险等级：高  
表现：为了“方便”逐步加入表达式、数组、fallback，最终形成难维护的小型语言。  
防护：

1. 首期只做 dot-path。
2. 所有新增 selector 提案必须单独立项，不得顺手带入。
3. 代码审查明确拒绝 transform/fallback/array index。

### R4. 授权边界退化

风险等级：中高  
表现：普通节点能读取祖先或兄弟分支上下文。  
防护：

1. selector 解析期硬校验来源合法性。
2. join-only selector 只能在 join 节点上使用。

### R5. 序列化不稳定

风险等级：中  
表现：相同输入产生不同字段顺序，导致 snapshot、resume、测试和审计噪声。  
防护：

1. 投影字段按稳定顺序 materialize。
2. snapshot 测试比对最终 `context` 序列化结果。

### R6. 文档与实现漂移

风险等级：中  
表现：spec、manual、semantics 三处描述不一致。  
防护：

1. 同一提交更新 `docs/ogsystem-orchestration-semantics-v1.md`、`docs/usage-manual.md`、`docs/README.md`。
2. 草案文档显式标明“不是当前运行时真相”。

## 8. 测试矩阵（必须补齐）

### 8.1 解析器测试

1. 接受 `join.mode=quorum_of + join.min` 的合法组合。
2. 拒绝缺失 `join.min` 的 `quorum_of`。
3. 拒绝 `join.min < 1`。
4. 拒绝 `join.min > |join.sources|`。
5. 拒绝 `source(<roleId>)` 引用非 `join.sources`。
6. 拒绝普通节点使用 `source(...)` selector。
7. 拒绝数组索引、表达式、fallback 等未支持语法。

### 8.2 Projection 测试

1. 普通节点 `direct.content`、`direct.data.<path>` 正常工作。
2. join 节点 `source(<roleId>).data.<path>` 正常工作。
3. `global.task`、`global.user_profile.<path>` 正常工作。
4. 缺字段直接失败。
5. 非法来源直接失败。
6. 字段顺序稳定。
7. 无 `context.map` 时行为与当前版本完全一致。

### 8.3 Quorum 调度测试

1. `join.min=1` 等价 any。
2. `join.min=2` 正常在第二个唯一 source 到齐时触发。
3. `join.min=|sources|` 等价 all。
4. 重试或重复 completion 不重复计数。
5. late arrival 不重触发。
6. 同一 join 在同一轮次只激活一次。
7. 多入边非 join 仍然是“每个 active branch 各执行一次”。

### 8.4 Resume / Loop 回归

1. 阈值未达到时 crash/resume。
2. 阈值刚达到但未执行 join 时 crash/resume。
3. join 已执行后 late arrival + resume。
4. `loopIteration` 多轮下 quorum 统计隔离。

### 8.5 端到端验证

1. 至少一个最小 `quorum_of` 示例系统跑通。
2. 至少一个 `context.map` 示例系统跑通。
3. 全量 `pnpm test` 通过。
4. `pnpm run test:examples` 通过。
5. `pnpm run test:doctor` 通过。

## 9. 建议提交拆分

1. `feat(runtime): add quorum_of parser/types/contracts`
2. `feat(runtime): add context projection and quorum scheduling`
3. `test(runtime): cover quorum projection resume regressions`
4. `docs(runtime): document quorum_of and context.map semantics`

说明：

- 解析器/类型、运行时、测试、文档分开提交，更容易定位问题并回滚。

## 10. 完成定义（DoD）

满足以下条件才算完成：

1. `quorum_of + join.min` 已在解析器、调度器、审计与恢复链路中落地。
2. `context.map` 已支持最小 selector 集，且不引入表达式系统。
3. 默认行为不变；未使用新 metadata 的系统回归通过。
4. 重复触发、串轮次计数、缺字段静默降级等高风险问题均有测试覆盖。
5. 权威文档、手册、索引、示例同步更新。
6. 全量验证通过后再提交，不留“文档先行但代码未收敛”的半成品状态。

## 11. 结论

在“开发测试环境、latest-only、无兼容迁移”的前提下，这项工作整体属于：

- 风险：中等
- 收益：高
- 推荐策略：分阶段落地，严格收敛首期范围

最关键的管理动作不是“做更多能力”，而是守住三条线：

1. 不做第二套 DSL。
2. 不让 selector 演化成表达式语言。
3. 不牺牲 resume 与确定性来换取短期功能完成。
