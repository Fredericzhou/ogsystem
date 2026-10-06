# OGSystem 语义缺口与实施计划

更新时间：2026-10-06
状态：设计参考；当前优先级以 `todo-backlog.md` 为准
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

### P0-2 清理已移除的 `talent.bind` 语义

现状：旧版本曾将 `talent.bind.<roleId>` 作为不参与执行的元数据保留；当前开发测试版本已移除该键族。

决策：删除该键族及其解析、fingerprint 和生成入口。能力标签路由不属于当前开发测试版本；模型能力匹配继续由 `preferredModelTags` 和模型选择配置负责，并受 law、output schema、timeout、审计和 resume fingerprint 约束。

验收：解析器、NL2MMD 字典、fingerprint 和用户文档不再把 `talent.bind` 作为当前输入；测试仅保留对该已移除键的拒绝回归。

## 4. 已裁定事项与需求门槛

### Join 分阶段等待超时（需求触发的 P2）

价值：在已有 Join 总等待超时之外，区分首包等待和相邻 source 到达间隔，并支持超时补偿。

当前状态：基础 Join 超时已实现并由 Semantic IR 的 `timeoutSeconds`、`failurePolicy`、`onTimeout` 驱动，包含审计、恢复和 `terminated`/`stopped`/`failed` 收敛。`docs/development/ogsystem-wait-timeout-semantics-v2.md` 中的 `join.first_packet.*`、`join.gap.*` 和对应 timeout failure envelope 仍为 RFC/未实现。

裁定：当前没有明确的长等待用例要求区分首包等待与 source 间隔，暂不进入近期执行。只有需求成立后，才按以下边界设计：实现 `join.first_packet.*`、`join.gap.*`、`join.on_timeout.*=FAIL`、对应错误码、WAL/resume 恢复、单次触发去重和审计。不得引入新的 YAML 配置面，也不改变现有基础 Join 超时合同。

验收：旧图行为不变；超时可进入 `ERROR.<code>`、`ERROR` 或 fail-stop；scheduler 不会在仍有 pending join 时提前结束；resume 不重复触发。

### Human Review 惰性超时（已实现）

价值：让现有 `review.timeout` 真正提供 SLA 保障。

当前状态：已实现惰性到期检查。status/inspect/review list/resume 会根据 request 时间和 `review.timeout` 原子创建唯一 decision，并将缺失的 timeout event 补写到事件日志；resume 将 decision 幂等应用到 checkpoint。`pause` 保留可操作的 paused review，`terminate` 按 scope 终止并标记 expired。不配置 timeout 时行为不变；不运行后台 daemon。

实现边界：到期时间由 `requestedAt + timeoutSeconds` 计算；若进程在 durable decision 写入后、事件落盘前中断，后续检查会补齐事件。decision artifact 是恢复权威，timeout event 用固定 event id 便于识别重复记录。检查并发在进程内按 run 串行处理。

验收：代码和测试覆盖 deadline 前不触发、并发检查只生成一份 decision/event、事件缺失后的恢复、未配置 timeout 保持 pending、timeout pause 保持 actionable，以及 terminate decision 经 resume 写入 checkpoint 并只发出一次过期事件。2026-10-06 对账运行结果见统一执行计划的验证记录。跨进程 inspect/list 的协调依赖文件系统原子创建 decision；没有后台 daemon，也不承诺跨主机分布式锁。

### 外部信号等待与恢复（需求触发的 P2）

价值：支持异步任务、外部系统回调和人工系统之外的等待点。

裁定：当前没有明确的外部异步集成要求，暂缓。需求成立后，最小范围为单机文件型 signal inbox、等待状态、`run signal` 控制入口、checkpoint/resume 对账；不引入外部控制平面和新图节点。

验收：信号只能消费一次，错误 signal 不改变运行状态，crash/resume 不丢失或重复消费信号。

### 可配置执行重试策略（数据门槛 P2）

价值：当前只有 OpenCode 固定 3 次、固定退避的传输级重试；本地 `exec.bind` 没有等价策略，失败后只能依赖异常边或业务循环。

裁定：暂不抽象通用重试策略。先收集真实失败样本，确定 retry/backoff/可重试错误分类、每次 attempt 的持久化与审计/fingerprint 语义，再决定是否放在 profile 或 runtime execution policy；不扩展 Mermaid DSL。`ERROR*` 仍只在重试耗尽后触发。

验收：model/profile 行为可分别配置；不可重试错误不重复执行；重试和 resume 均幂等，现有默认策略保持兼容。

## 5. P2：有数据后实现

### P2-1 受控并发与背压

`parallel_split` 继续只表示语义分叉；新增 `maxConcurrentBranches` 等执行策略前，先完成 fan-out 基准。实现后需要队列、排队耗时、失败传播和 workspace isolation 指标。

### P2-2 Provider/Model 能力标签路由

模型能力匹配继续由 `preferredModelTags` 和模型选择配置负责，必须保留 direct `provider/model` 优先级，并把最终解析结果纳入 fingerprint。

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

## 7. 后续评估顺序

1. 按统一 backlog 排序；本计划不作为独立活跃待办入口。
2. 只有出现具体长等待场景时，重新评估 Join 分阶段等待。
3. 只有出现具体外部异步集成时，重新评估单机 signal 恢复。
4. 根据真实失败样本和恢复要求，评估可配置重试；根据 benchmark 评估并发与观测字段。
5. 最后评估能力标签路由和外部 Worker 合同。

## 8. 本轮收口记录

- 2026-09-03 示例收口：debate moderator 的示例事件字段统一为 `debate_round`，与示例状态 Schema/reducer 保持一致；该字段不属于 OGS 平台合同。嵌套示例新增 `.gitignore`，隔离生命周期生成的控制面文件与运行产物。
- 2026-09-03 RFC 澄清：基础 `joinScopes.status=waiting` 与总等待超时属于已实现能力；本 RFC 仅描述尚未实现的 `first_packet/gap` 分阶段等待机制。
- P0-1 已完成：活跃文档统一将 `parallel_split` 定义为语义分叉/分支激活，明确当前 scheduler 不承诺物理并发。
- P0-2 已完成：`talent.bind` 已从当前 DSL、解析结果和 fingerprint 中移除。
- 基础 Join 超时已完成：`timeoutSeconds`、`failurePolicy`、`onTimeout` 已进入 IR 和运行时主路径；分阶段 `first_packet/gap` 等待继续保留为 RFC。
- 当前开发测试版本不提供旧 DSL、配置或运行数据迁移；旧格式直接拒绝，resume 只接受当前规范版本和恢复权威集。
- 2026-10-06 产品决策：resume 只接受最新版本和精确 fingerprint；不提供语义兼容恢复、降级恢复或旧运行数据迁移。
- 2026-10-06 优先级对账：Human Review 惰性超时已实现；Join 分阶段等待和外部 signal 降为需求触发的 P2；可配置执行重试为数据门槛 P2。当前优先级以统一 backlog 为准。
- 验证要求：文档漂移检查、类型/构建检查、现有测试与 `git diff --check` 必须通过；归档文档可保留当时的历史语境，不作为当前语义契约。
