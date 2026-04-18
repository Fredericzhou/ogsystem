# OGSystem Runtime Refactor Execution Checklist

Date: 2026-04-18  
Status: in progress  
Scope: 基于当前仓库实现现状，对运行时主链、状态层、编译层、运维投影层给出一份可执行的重构清单。

## 1. 执行原则

- 先收敛语义，再补性能，再补机器可读观测面。
- 每一阶段优先保持现有持久化格式不变，除非该阶段目标就是新增 operator-facing projection。
- parser 保留 DSL 白名单与 fail-closed 早拒绝；compiler 逐步收敛为唯一静态编排语义真相。
- 每阶段结束必须同步补测试与文档，不接受“后面再补”。

## 2. 当前判断（合并修正版）

### 2.1 架构层主问题

- 当前最伤的是编排语义双轨维护，不是单纯文件过大。
- 成功流和失败流各维护一份 branch/join/loop/terminal 激活逻辑，长期看极易漂移。
- 直接证据：
  - `src/runtime/graph-runner.ts:792`
  - `src/runtime/graph-runner.ts:1189`

### 2.2 编译层定位

- compiler 已经进入运行主路径，不应再表述为“影子层”。
- compiler digest 已进入 run fingerprint。
- backlog 中编译器主线相关项已完成。
- 更准确的判断是：
  - compiler 已进入主路径，但还不是唯一权威源。
  - parser、compiler、runtime 之间仍存在重复校验和职责交叉。

### 2.3 状态层风险表述

- 当前存在明确的线性扫描和全表遍历形态，这是真实的扩展性风险。
- 但是否已经成为系统首要性能瓶颈，还缺 benchmark 证明。
- 现阶段文档给出的更优先风险仍是长期 I/O 与工件增长。

### 2.4 运维面判断

- 项目不是完全没有 timeline。
- 当前已经有 markdown timeline 和 visualizer 消费路径。
- 下一步更合适的方向不是“从零造 timeline”，而是把现有 operator-facing projection 固化成机器可读契约。

## 3. 重构目标

1. 让 DSL 语义只定义一次，parser/compiler/runtime 不再各持半份真相。
2. 让运行主链从“大而全 orchestrator”收敛为几个稳定边界：调度、转移规划、持久化、执行。
3. 让状态与恢复从“可用”升级为“规模增长后仍可控”。
4. 让运维和产品面跟上内核能力，避免用户直接理解内部工件模型。

## 4. 阶段 0：基线与防回归

Delivery status: delivered in the first implementation slice.

### 4.1 目标

- 在改主链前锁住当前行为，避免“重构后感觉没坏”。

### 4.2 涉及文件

- `tests/graph-runtime.integration.test.mjs`
- `tests/error-flow-runtime.test.mjs`
- `tests/resume-session.test.mjs`
- `tests/session-recovery.test.mjs`
- `tests/runtime-fault-injection.test.mjs`
- `tests/graph-runtime-state.test.mjs`
- `tests/visualizer.test.mjs`

### 4.3 动作

- 补一组 golden 场景，至少覆盖：
  - success flow
  - error flow
  - `join.mode=all_of`
  - `join.mode=quorum_of`
  - `loop.max`
  - resume crash window
  - stop request
- 为 run 目录关键产物建立回归断言，覆盖：
  - `state.json`
  - `checkpoints/`
  - `events.ndjson`
  - `execution-outcome.json`
- 增加一组最小 benchmark 基线，至少记录：
  - transition 数
  - checkpoint replay 耗时
  - state write 耗时
- benchmark 不与 golden 回归强绑定。
- 回归测试补全必须先完成；benchmark 可先做最小版，避免拖慢第 1 阶段启动。

### 4.4 完成标准

- 后续每阶段都能跑稳定回归，不再依赖人工 diff。

### 4.5 风险

- 如果省掉这一步，后续 `transition-planner` 和索引改造很难安全推进。

## 5. 阶段 1：抽离 `transition-planner`

Delivery status: delivered. `transition-planner.ts` owns branch/join/loop/terminal planning for success and handled-failure outcomes.

### 5.1 目标

- 消灭成功流和失败流双轨维护，统一 branch/join/loop/terminal 语义。

### 5.2 优先级

- 最高。

### 5.3 现状依据

- `src/runtime/graph-runner.ts:792`
- `src/runtime/graph-runner.ts:1189`

### 5.4 涉及文件

- `src/runtime/graph-runner.ts`
- `src/runtime/graph-runtime-state.ts`
- `src/runtime/graph-mode-registry.ts`

### 5.5 新增文件建议

- `src/runtime/transition-planner.ts`

### 5.6 动作

- 定义统一输入 `TransitionPlannerInput`，包含：
  - `state`
  - `plan`
  - `contractPlan`
  - `node`
  - `branch`
  - `outcome`
  - `errorFlowRoutingEnabled`
- 定义统一输出 `TransitionPlan`，仅包含：
  - `update`
  - `events`
- 先把失败结果归一成“可路由 outcome”，不要保留一套单独的失败分支激活算法。
- 把以下逻辑全部迁入 planner：
  - selected target resolution
  - flow contract gating
  - loop budget
  - join readiness
  - `sessionLineageId`
  - branch activation
  - output termination
  - orphaned join handling
- `graph-runner` 只保留：
  - 调用 `executeRoleNode`
  - 调用 `planTransition`
  - 写 checkpoint
  - append event
  - apply update
  - persist state
- 把 `buildHandledFailureTransitionPlan` 和 `buildSuccessTransitionPlan` 合并为一条路径；允许保留极薄的 pre-normalization helper，但不再各自维护完整语义。

### 5.7 测试重点

- `tests/graph-runtime.integration.test.mjs`
- `tests/error-flow-runtime.test.mjs`
- `tests/transition.test.mjs`
- `tests/transition-orphan-join.test.mjs`

### 5.8 完成标准

- `graph-runner.ts` 不再直接持有两套完整 transition builder。
- 所有 branch/join/loop 激活语义只在一个 planner 中实现。

### 5.9 风险

- `error_flow` 与 `handoff.mode=transition` 的交互最容易回归。

## 6. 阶段 2：引入 `RuntimeIndexes` 第一批索引

Delivery status: delivered for the first index batch. Indexes remain rebuildable from `GraphState` and are not persisted.

### 6.1 目标

- 不改 `GraphState` 持久化结构，先去掉最频繁的扫表路径。

### 6.2 优先级

- 第二。

### 6.3 现状依据

- `src/runtime/graph-runtime-state.ts:106`
- `src/runtime/graph-runtime-state.ts:241`
- `src/runtime/graph-mode-registry.ts:176`

### 6.4 涉及文件

- `src/runtime/graph-runtime-state.ts`
- `src/runtime/graph-mode-registry.ts`
- `src/runtime/graph-runner.ts`

### 6.5 新增文件建议

- `src/runtime/runtime-indexes.ts`

### 6.6 第一批索引

- `branchById`
- `activeBranchIdsByRoleId`
- `resultByRoleLineageLoopKey`

### 6.7 动作

- 实现 `buildRuntimeIndexes(state)`，在 fresh run、resume replay 后都可重建。
- 实现 `applyGraphUpdateToIndexes(indexes, update)`，随每次 checkpoint update 同步更新。
- 把 `findRoleResult` 改为优先查 `resultByRoleLineageLoopKey`。
- 把 `listActiveBranches` 和 `getActiveRoleIds` 改为优先走 `activeBranchIdsByRoleId`。
- join readiness 改为依赖索引，不再直接对 `roleResults` 线性扫描。

### 6.8 第二批索引（后置）

- `activeJoinGroupsByRoleLineageLoop`
- `childBranchIdsByParentBranchId`

### 6.9 测试重点

- `tests/graph-runtime-state.test.mjs`
- `tests/graph-runtime.integration.test.mjs`
- `tests/resume-session.test.mjs`

### 6.10 完成标准

- 关键热路径不再依赖 `Object.values(...).find/filter/some`。
- 持久化格式完全不变。

### 6.11 风险

- 索引与 `GraphState` 漂移。
- 必须坚持“索引可重建、不可单独持久化”。

## 7. 阶段 3：落 `summary.json`

Delivery status: delivered. `summary.json` is refreshed as an operator projection and consumed by lifecycle/visualizer read paths.

### 7.1 目标

- 把最有边际收益的 operator-facing projection 固化为机器可读契约。

### 7.2 优先级

- 第三。

### 7.3 现状依据

- `docs/todo-backlog.md:30`
- `src/runtime/graph-runner.ts:605`

### 7.4 涉及文件

- `src/runtime/graph-runner.ts`
- `src/runtime/run-summary.ts`
- `src/runtime/project-lifecycle.ts`
- `src/runtime/cli.ts`

### 7.5 新增文件建议

- `src/runtime/run-summary-schema.ts`

### 7.6 动作

- 定义 `summary.json` 结构，至少包含：
  - `runId`
  - `systemId`
  - `systemVersion`
  - `status`
  - `transitionCount`
  - `durationMs`
  - `lastRoleId`
  - `lastErrorCode`
  - `finalRoleId`
  - `executionDirCount`
  - `okCount`
  - `failedCount`
  - `noopCount`
- 在 run 结束时稳定落盘。
- 第一版可不强求中间态增量刷新。
- 但必须明确运行中场景的读取策略：
  - `run status` / `run list` 对运行中实例可回退读取 `state.json` 与 `metrics.json`
  - 后续应尽快补 `summary.json` 的中间态刷新
- `run status` 与 `run list` 优先消费 `summary.json`，不要各自重新拼字段。
- visualizer 读取时也优先使用 `summary.json`。

### 7.7 测试重点

- `tests/cli-lifecycle.test.mjs`
- `tests/visualizer.test.mjs`

### 7.8 完成标准

- CLI、visualizer、自动化工具都能基于同一份机器可读摘要工作。

### 7.9 风险

- 字段定义一旦外露，就会成为公共契约。
- 第一版字段不要贪多。

## 8. 阶段 4：固化机器可读 timeline

Delivery status: delivered. `timeline.jsonl` is rebuilt from `events.ndjson` and consumed by visualizer event snapshots/SSE fallback projection.

### 8.1 目标

- 不是从零造 timeline，而是把现有 event/audit projection 固化成机器可读格式。

### 8.2 优先级

- 在 `summary.json` 之后。

### 8.3 现状依据

- `src/runtime/graph-runner.ts:630`
- `docs/usage-manual.md:657`

### 8.4 涉及文件

- `src/runtime/graph-runner.ts`
- `src/runtime/run-artifacts.ts`
- `src/visualizer/server.ts`

### 8.5 新增文件建议

- `src/runtime/timeline-projector.ts`

### 8.6 动作

- 定义 `timeline.jsonl` 或 `timeline.json`。
- 第一版建议使用 JSONL，便于追加和流式读取。
- 投影维度至少包含：
  - `at`
  - `type`
  - `roleId`
  - `branchId`
  - `lineageId`
  - `loopIteration`
  - `event`
  - `status`
  - `durationMs`
  - `errorCode`
- 优先从 `events.ndjson` 投影，而不是在热路径再写一套独立事件。
- visualizer 改为优先消费机器可读 timeline。
- markdown timeline 继续保留给人工查看。

### 8.7 测试重点

- `tests/run-artifacts-events.test.mjs`
- `tests/visualizer.test.mjs`

### 8.8 完成标准

- 机器可读 timeline 存在。
- visualizer 不再依赖解析 markdown timeline。

### 8.9 风险

- 不要把 timeline 混成恢复真相。
- timeline 只能是 projection。

## 9. 阶段 5：固化 `durable truth / operator projection` 边界

Delivery status: delivered for the current artifact boundary. Recovery truth remains `state.json`, `sessions.json`, `plan-fingerprint.json`, `checkpoints/`, and `execution-outcome.json`; `summary.json` and `timeline.jsonl` are projections.

### 9.1 目标

- 把恢复权威集与观测投影的边界显式化，即使暂不引入完整 `run-commit-coordinator`，也先形成清晰约束。

### 9.2 动机

- 仓库已经在文档层承认恢复权威集与观测投影是不同层次。
- 下一步应把这层边界进一步固化到实现与文档，而不是继续隐含在代码路径里。

### 9.3 涉及文件

- `src/runtime/run-artifacts.ts`
- `src/runtime/graph-runner.ts`
- `docs/long-term-stability-roadmap.md`
- `docs/usage-manual.md`

### 9.4 动作

- 明确列出当前 `durable truth`：
  - `state.json`
  - `sessions.json`
  - `plan-fingerprint.json`
  - `checkpoints/`
  - `execution-outcome.json`
- 明确列出当前 `operator projections`：
  - `events.ndjson`
  - `audit/summary.md`
  - markdown transitions/timeline
  - `summary.json`
  - `timeline.jsonl`
  - `metrics.json`
- 在代码中补最小边界约束：
  - 恢复流程不得依赖 projection 文件
  - projection 刷新失败不得污染恢复真相
- 若阶段内不引入完整 `run-commit-coordinator`，至少补一层轻量说明与 helper，避免写盘职责继续散落。

### 9.5 测试重点

- `tests/resume-session.test.mjs`
- `tests/session-recovery.test.mjs`
- `tests/run-artifacts-events.test.mjs`

### 9.6 完成标准

- 仓库内对“哪些文件是恢复真相、哪些只是观测投影”有明确且可执行的一致定义。

### 9.7 风险

- 若边界只写文档不落到代码约束，后续仍会继续回到隐式耦合。

## 10. 阶段 6：收窄 `role-executor` 边界

Delivery status: delivered for the first structural split. Input projection, binding resolution, output parsing, and execution recording now have separate modules.

### 10.1 目标

- 把单 role 执行链拆成更可维护的几个部件。

### 10.2 优先级

- 在 planner 和 indexes 稳定后推进。

### 10.3 现状依据

- `src/runtime/role-executor.ts:929`

### 10.4 涉及文件

- `src/runtime/role-executor.ts`
- `src/runtime/executor.ts`
- `src/runtime/flow-contract.ts`

### 10.5 新增文件建议

- `src/runtime/role-input-projector.ts`
- `src/runtime/binding-resolver.ts`
- `src/runtime/role-output-parser.ts`
- `src/runtime/role-execution-recorder.ts`

### 10.6 动作

- 把 `context.map` 求值、join 默认上下文、prompt input 构造移入 `role-input-projector.ts`。
- 把 profile/model/noop 绑定决议移入 `binding-resolver.ts`。
- 把 JSON 解析、输出修复、事件合法性判定移入 `role-output-parser.ts`。
- 把 prelude/result/outcome/audit/session 持久化移入 `role-execution-recorder.ts`。
- `executeRoleNode` 最终只负责编排这些子步骤。

### 10.7 测试重点

- `tests/role-executor-projection.test.mjs`
- `tests/role-output-repair.test.mjs`
- `tests/tool-runner.test.mjs`

### 10.8 完成标准

- `role-executor.ts` 变成协调器，不再是厚实现。

### 10.9 风险

- `role_input` contract 校验和真正注入 prompt 的对象必须继续保持一致。

## 11. 阶段 7：收敛静态语义到 compiler 主线

Delivery status: pending.

### 11.1 目标

- compiler 已在主路径中，下一步要继续收敛成唯一静态编排语义真相。

### 11.2 表述边界

- 不是让 parser 失去 fail-closed 能力。
- parser 保留 surface-level fail-closed。

### 11.3 涉及文件

- `src/runtime/parse-mermaid.ts`
- `src/runtime/compiler.ts`
- `src/runtime/adapter.ts`
- `src/runtime/role-executor.ts`

### 11.4 动作

- 梳理静态检查矩阵，明确哪些留在 parser，哪些迁入 compiler。

### 11.5 parser 保留

- DSL 白名单
- metadata 白名单
- 明显结构非法输入早拒绝

### 11.6 compiler 收敛

- loop/cycle 完整性
- `join.sources` / `join.min` / incoming alignment
- `context.map` selector 合法性与 bindability
- `flow contract` / `role_input contract` bindability
- noop legality 与 binding completeness

### 11.7 runtime 保留

- 动态数据相关防线
- 不再重复静态证明

### 11.8 测试重点

- `tests/compiler.test.mjs`
- `tests/parser.test.mjs`
- `tests/flow-contract.test.mjs`

### 11.9 完成标准

- 静态语义冲突不再需要 parser/compiler/runtime 三处共同兜底。

### 11.10 风险

- 迁移过程中最容易出现“错误位置后移”。
- 必须确保 surface-level fail-closed 不被削弱。

## 12. 阶段 8：瘦身 `adapter`

Delivery status: pending.

### 12.1 目标

- 让 setup 层只负责装配，不再同时掌握过多策略。

### 12.2 涉及文件

- `src/runtime/adapter.ts`

### 12.3 新增文件建议

- `src/runtime/runtime-loader.ts`
- `src/runtime/plan-fingerprint.ts`
- `src/runtime/runtime-setup.ts`

### 12.4 动作

- 把 config/profile/tool/law/userProfile 读取集中到 loader。
- 把 fingerprint 生成与验证集中到单独模块。
- 把 executor lifecycle 和 runContext wiring 组织成 setup object。
- `runSystemWithAdapter` 只做：
  - load
  - setup
  - invoke runner
  - cleanup

### 12.5 测试重点

- `tests/config.test.mjs`
- `tests/cli-lifecycle.test.mjs`

### 12.6 完成标准

- `adapter.ts` 不再是 setup 巨石文件。

### 12.7 风险

- 这一步收益主要是可维护性，不应抢在前几步之前做。

## 13. 阶段 9：日志能力补齐

Delivery status: pending.

### 13.1 目标

- 把“强审计”补成“可排障”。

### 13.2 现状依据

- `docs/todo-backlog.md:31`

### 13.3 涉及文件

- `src/runtime/cli.ts`
- `src/runtime/project-lifecycle.ts`

### 13.4 动作

- 给 `ogs run logs` 增加 `--tail`。
- 给 `ogs run logs` 增加 `--follow`。
- 给 `ogs run logs` 增加 `--since`。
- 统一 `engine` / `role` log 查询格式，不要在 CLI 层散落条件分支。

### 13.5 测试重点

- `tests/cli-lifecycle.test.mjs`

### 13.6 完成标准

- 常见排障不再依赖手工打开 run 目录。

### 13.7 风险

- `--follow` 需要谨慎处理文件增长和进程退出。

## 14. 阶段 10：脱敏与最小安全补面

Delivery status: pending.

### 14.1 目标

- 先补最必要的敏感信息治理，不碰大隔离改造。

### 14.2 现状依据

- `docs/todo-backlog.md:61`

### 14.3 涉及文件

- `src/runtime/role-executor.ts`
- `src/runtime/run-artifacts.ts`
- `src/runtime/runtime-support.ts`

### 14.4 动作

- 定义统一脱敏入口，不要在各处写正则。
- 优先脱敏：
  - prompt input
  - stdout/stderr snapshot
  - audit inputContext
  - summary/timeline 中可能透出的敏感字段
- 脱敏策略做成 runtime config 可控项，默认开启基础规则。

### 14.5 测试重点

- 新增 `redaction` 相关单测。

### 14.6 完成标准

- operator-facing projection 默认不裸奔输出敏感信息。

### 14.7 风险

- 过度脱敏会损害排障价值。
- 第一版只做高置信字段。

## 15. 阶段 11：工作区隔离增强

Delivery status: pending.

### 15.1 目标

- 作为后续能力，不抢在 observability 之前。

### 15.2 涉及文件

- `src/runtime/role-executor.ts`
- `src/runtime/run-artifacts.ts`
- `src/runtime/config.ts`

### 15.3 动作

- 引入 `workspaceIsolation = role | branch` 配置。
- 默认继续 `role`，保证兼容。
- `branch` 模式下给不同 branch 分配独立 private workspace。
- resume 目录契约和 session 目录解析同步适配。

### 15.4 测试重点

- 并行 split
- resume
- same role sibling branch 文件隔离

### 15.5 完成标准

- 隔离增强成为可选能力，不破坏默认行为。

### 15.6 风险

- 牵涉目录契约、resume、tool workdir，必须后置。

## 16. 文档同步清单

- 每完成一个阶段，至少同步更新：
  - `docs/usage-manual.md`
  - `docs/README.md`
- 编排语义变更时同步更新：
  - `docs/ogsystem-orchestration-semantics-v1.md`
- 架构边界变更时同步更新：
  - `docs/DECISIONS.md`
- 若新增机器可读 run projection，同步更新：
  - `docs/usage-manual.md`
- 若阶段性设计较重，先写交付记录到：
  - `docs/archive/delivery/`

## 17. 建议排期

1. 第 1 周  
   阶段 0，补基线回归；benchmark 先落最小版。
2. 第 2 到 3 周  
   阶段 1，抽 `transition-planner`。
3. 第 4 周  
   阶段 2，落第一批 `RuntimeIndexes`。
4. 第 5 周  
   阶段 3，落 `summary.json`。
5. 第 6 周  
   阶段 4，落机器可读 timeline。
6. 第 7 周  
   阶段 5，固化 `durable truth / operator projection` 边界。
7. 第 8 到 9 周  
   阶段 6，瘦 `role-executor`。
8. 第 10 到 11 周  
   阶段 7，收敛 compiler 主线。
9. 第 12 周以后  
   阶段 8 到 11，按资源推进。

## 18. 最值得立即开的三张任务单

1. `transition-planner` 抽离  
   这是当前收益最大、最直接降低语义漂移的一步。
2. `RuntimeIndexes` 第一批索引  
   这是低风险、可立即见效的状态层改造。
3. `summary.json`  
   这是把现有内核能力变成可用系统的最低成本补面。

## 19. 附：建议的首批实施顺序

### 18.1 第一优先

- `transition-planner`

### 18.2 第二优先

- `RuntimeIndexes`

### 18.3 第三优先

- `summary.json`

### 18.4 顺序说明

- 先收敛语义主链，再补索引，再补机器可读投影。
- `timeline.jsonl` 排在 `summary.json` 之后，因为当前已有 `events.ndjson` 与 markdown 时间线过渡，`summary.json` 的边际收益更直接。
