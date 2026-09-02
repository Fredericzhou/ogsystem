# OGSystem 语义缺口与实施计划

更新时间：2026-09-02
状态：active（P0 与基础运行语义已完成；剩余 P1/P2 按需实施）
适用范围：当前 runtime、CLI、Visualizer 与文档声明的语义边界

## 1. 结论

当前核心语义已经落地：默认事件路由、`parallel_split` 分支激活、`all_of/quorum_of` join、基础 Join 超时策略（`timeoutSeconds`、`failurePolicy`、`onTimeout`）、`context.map`、`loop.max`、flow contract、`ERROR*` 异常路由、runtime-native human review、WAL/resume 和日志增量读取均已有实现与测试覆盖。

剩余高价值缺口集中在分阶段 Join 等待、长流程治理、外部异步协作和执行资源治理，不建议继续扩展 DSL 表达能力或 Studio 功能。

## 2. 优先级定义

- **P0**：当前声明容易造成错误认知，或已有语义表述与实现不一致，必须立即收口。
- **P1**：直接影响长流程可靠性、可恢复性或外部协作，应在下一轮 runtime 稳定性工作中实现。
- **P2**：有明确产品价值，但应先有真实运行数据和边界设计，再进入实现。
- **Deferred**：当前收益不足以抵消复杂度，保持明确不支持。

## 3. P0：立即收口

### P0-1 修正并行语义文档

现状：`parallel_split` 已实现的是“同时激活多个下游分支”的 Flow 语义；当前 graph scheduler 仍按活动角色队列逐个处理，不能承诺物理并发。

修复：所有活跃文档统一使用“语义分叉/分支激活”表述；将实际并发明确归类为未来执行策略。不得用“concurrent sessions”描述当前 scheduler 行为。

验收：文档不再把 `parallel_split` 描述成当前物理并发；执行策略与 Flow 可达性保持独立。

### P0-2 收口 `talent.bind` 语义残留

现状：`talent.bind.<roleId>` 会被解析并参与 fingerprint，但不参与当前执行绑定决议；它是兼容性元数据，不是当前可执行能力。

决策：保留该键，不删除、不改变现有 fingerprint 行为，统一标记为未来实现“基于能力标签的模型/执行器路由”的预留。当前 `model.bind`、`exec.bind`、模型选择和 `noop` 规则不受影响。

未来实现边界：能力标签只能参与候选模型/执行器筛选和路由，不能绕过 law、output schema、timeout、审计或 resume fingerprint。

验收：用户文档、语义文档和 README 均不再暗示 `talent.bind` 当前会选择执行器；解析、构建和现有测试保持不变。

## 4. P1：剩余 Runtime 实现

### P1-1 Join 分阶段等待超时

价值：在已有 Join 总等待超时之外，区分首包等待和相邻 source 到达间隔，并支持超时补偿。

当前状态：基础 Join 超时已实现并由 Semantic IR 的 `timeoutSeconds`、`failurePolicy`、`onTimeout` 驱动，包含审计、恢复和 `terminated`/`stopped`/`failed` 收敛。`docs/development/ogsystem-wait-timeout-semantics-v2.md` 中的 `join.first_packet.*`、`join.gap.*` 和对应 timeout failure envelope 仍为 RFC/未实现。

最小范围（后续）：实现 `join.first_packet.*`、`join.gap.*`、`join.on_timeout.*=FAIL`、`GRAPH_JOIN_FIRST_PACKET_TIMEOUT`、`GRAPH_JOIN_GAP_TIMEOUT`、WAL/resume 恢复、单次触发去重和审计。不得引入新的 YAML 配置面，也不改变现有基础 Join 超时合同。

验收：旧图行为不变；超时可进入 `ERROR.<code>`、`ERROR` 或 fail-stop；scheduler 不会在仍有 pending join 时提前结束；resume 不重复触发。

### P1-2 Human Review 自动超时

价值：让现有 `review.timeout` 真正提供 SLA 保障。

当前状态：`review.timeout` 只解析并持久化到 review spec；`expired` 类型存在，但运行时没有自动过期路径。

最小范围：优先采用 status/inspect/resume 时的惰性过期检查，并持久化明确的 expiry event/decision；不引入常驻 daemon。明确 `pause`、`terminate` 与 `expired` 的状态关系后再实现。

验收：过期检查幂等、可审计、可恢复；未配置 timeout 的 review 行为保持不变。

### P1-3 外部信号等待与恢复

价值：支持异步任务、外部系统回调和人工系统之外的等待点。

最小范围：单机文件型 signal inbox、等待状态、`run signal` 控制入口、checkpoint/resume 对账；不引入外部控制平面和新图节点。

验收：信号只能消费一次，错误 signal 不改变运行状态，crash/resume 不丢失或重复消费信号。

### P1-4 可配置执行重试策略

价值：当前只有 OpenCode 固定 3 次、固定退避的传输级重试；本地 `exec.bind` 没有等价策略，失败后只能依赖异常边或业务循环。

最小范围：把 retry/backoff/可重试错误分类放在 profile 或 runtime execution policy，不扩展 Mermaid DSL；每次 attempt 独立落盘并纳入审计/fingerprint。`ERROR*` 仍只在重试耗尽后触发。

验收：model/profile 行为可分别配置；不可重试错误不重复执行；重试和 resume 均幂等，现有默认策略保持兼容。

## 5. P2：有数据后实现

### P2-1 受控并发与背压

`parallel_split` 继续只表示语义分叉；新增 `maxConcurrentBranches` 等执行策略前，先完成 fan-out 基准。实现后需要队列、排队耗时、失败传播和 workspace isolation 指标。

### P2-2 Provider/Model 能力标签路由

实现 `talent.bind` 与 `preferredModelTags` 的真正消费，支持模型能力匹配、provider readiness 和可解释 fallback。必须保留 direct `provider/model` 优先级，并把最终解析结果纳入 fingerprint。

### P2-3 Prompt/Token/Cost 可观测性

在已有 duration、RSS、executionDirCount 基础上，先增加 prompt/input/output 字节数和 attempt 统计；token/cost 只有在 provider 数据口径稳定后再加入。

### P2-4 外部 Worker 合同

完善 `exec.bind` 的 capability、输入输出版本、timeout、retry 和幂等约束，使外部 CLI/agent 与 model role 共享同一 durable audit path。

## 6. Deferred：明确不做

- 任意祖先/兄弟上下文读取、表达式语言、数组变换和隐式 reducer。
- 动态 fan-out 图节点和递归 child-system runtime。
- 宽容 fingerprint resume 或带损恢复。
- Redis/DB 分布式锁、共享存储多实例抢占调度。
- 在没有实测资源压力前引入新的 scheduler 层。
- 继续扩展 Studio 功能或增加新的 DSL 语义关键字。

## 7. 交付顺序

1. 完成 P0 文档与兼容性语义收口。
2. 按真实长等待需求评估并实现 Human Review timeout 与 Join 分阶段等待超时；基础 Join 超时无需重复建设。
3. 实现外部 signal 的单机文件型恢复闭环。
4. 根据 benchmark 决定执行重试、受控并发和观测字段的具体范围。
5. 最后评估能力标签路由和外部 Worker 合同。

## 8. 本轮收口记录

- 2026-09-03 示例收口：debate moderator 的示例事件字段统一为 `debate_round`，与示例状态 Schema/reducer 保持一致；该字段不属于 OGS 平台合同。嵌套示例新增 `.gitignore`，隔离生命周期生成的控制面文件与运行产物。
- 2026-09-03 RFC 澄清：基础 `joinScopes.status=waiting` 与总等待超时属于已实现能力；本 RFC 仅描述尚未实现的 `first_packet/gap` 分阶段等待机制。
- P0-1 已完成：活跃文档统一将 `parallel_split` 定义为语义分叉/分支激活，明确当前 scheduler 不承诺物理并发。
- P0-2 已完成：`talent.bind` 统一定义为当前仅保留并参与 fingerprint 的兼容性元数据，未来用于基于能力标签的模型/执行器路由。
- 基础 Join 超时已完成：`timeoutSeconds`、`failurePolicy`、`onTimeout` 已进入 IR 和运行时主路径；分阶段 `first_packet/gap` 等待继续保留为 RFC。
- 本轮未改动 parser、execution plan 或 scheduler 行为；因此不改变现有运行时语义和 resume 兼容性。
- 验证要求：文档漂移检查、类型/构建检查、现有测试与 `git diff --check` 必须通过；归档文档可保留当时的历史语境，不作为当前语义契约。
