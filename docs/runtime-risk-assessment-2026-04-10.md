# Runtime Risk Assessment (File-First)

Date: 2026-04-10  
Scope: `src/runtime/*` 与 `docs/long-term-stability-roadmap.md`  
Decision: 暂不引入 Redis/PG，优先文件型持久化方案。

## 1. 结论总览

对你提出的 9 个问题，评估结果如下：

- 同意（7 项）：#2、#4、#5、#6、#7、#8、#9
- 部分同意（2 项）：#1、#3

核心原因：

- 当前实现确实存在恢复一致性窗口、退出码语义不严格、resume 兼容性校验不足等高风险问题。
- 但“无限循环直至 OOM”与“JSON 提取在 `}` 字符场景必然失败”两点表述偏强，代码中已有部分保护。

## 2. 逐条评估

### #1 缺少拓扑环路强制校验（部分同意）

同意点：

- `parse-mermaid.ts` 当前没有做环检测，也没有强制“出现环必须配置 loop.max”。  
  证据：`src/runtime/parse-mermaid.ts` 仅校验 metadata/edge 结构与引用关系。
- `wouldExceedLoopBudget` 在 `loopMax === undefined` 时直接返回 `false`。  
  证据：`src/runtime/graph-runtime-state.ts:27-38`。

不同意/修正点：

- 不是“必然无限到 OOM”。运行时还有全局转移预算与 LangGraph recursion limit 双重兜底：  
  - `maxTransitions` 预算：`src/runtime/role-executor.ts:475-499`  
  - `recursionLimit=(maxTransitions ?? 100)+20`：`src/runtime/graph-runner.ts:507-511`

结论：

- 风险为“缺少静态预防，可能触发高成本循环重试”，不是“无上限死循环”。
- 建议在解析阶段加 SCC/环检测，并强制环上至少一个节点有 `loop.max.*` 或全局 `maxTransitions` 明确配置。

### #2 OpenCode 超时 race 可能产生僵尸会话（同意）

- `withTimeout` 超时后只在 `sessionId` 非空时才执行 abort：  
  `src/runtime/opencode-executor.ts:745-753`
- 若超时发生在 `session.create()` 未返回前，`sessionId` 为空，清理不会发生。

结论：

- 高风险成立。
- 修复方向：引入可传播取消信号（AbortSignal）并在 create/prompt 完成后检查父级取消状态，若已取消则立刻补偿 abort。

### #3 JSON 提取算法脆弱（部分同意）

同意点：

- 回退提取确实是启发式算法，存在边界场景误判风险。  
  证据：`src/runtime/role-executor.ts` 的 `extractJsonObjectCandidate`。

不同意/修正点：

- 你举的 `{"reason":"... } ..."}`
  场景在当前实现中通常可被正确处理，因为代码显式跟踪 `inString/escaping`，不会把字符串内 `}` 误计入闭合。

结论：

- 风险存在，但示例不精确。建议优先“结构化输出优先 + 明确失败策略”，而不是仅依赖文本提取修复链路。

### #4 内存状态无界增长与 I/O 放大（同意，表述需校正）

- 运行态会持续累积 `auditTrail`、`branchRecords`、`roleResults`，并在流式执行中反复持久化快照。  
  证据：`src/runtime/graph-runner.ts:513-516`、`src/runtime/graph-runtime-state.ts:50-77`
- 审计写入为同步等待路径（每次节点执行后 await）。  
  证据：`src/runtime/audit-recorder.ts:71-77`

校正：

- 代码中没有 `state.history` / `state.branches` 这两个字段名，实际结构见 `GraphState`。

结论：

- 性能风险成立。建议文件侧先做“缓冲写 + 批量 flush + 可配置审计粒度”。

### #5 非 0 exitCode 仍可记为成功（同意）

- `runCliTool` 在 `close` 事件无论退出码多少都 `resolve`。  
  证据：`src/runtime/tool-runner.ts:136-138`
- `role-executor` 成功路径主要看 stdout JSON/schema，不基于 exitCode 失败判定。  
  证据：`src/runtime/role-executor.ts:685` 之后。

结论：

- 高风险成立，影响审计可信度和下游路由正确性。
- 应在 profile 执行路径强制 `exitCode===0` 才允许进入 success 路径。

### #6 resume 非 crash-idempotent（同意）

- 节点执行阶段先写 role 结果/审计，再由 graph loop 写权威 `state.json`。  
  证据：`src/runtime/role-executor.ts:667-668` vs `src/runtime/graph-runner.ts:513-516`
- 进程若在中间崩溃，会出现“副产物已落盘但 graphState 未推进”，恢复后可能重放。

结论：

- 高风险成立，与 roadmap “prevent duplicate execution on resume”一致。  
  证据：`docs/long-term-stability-roadmap.md:36-40`

### #7 `--resume-run` 未校验 plan/runDir 兼容性（同意）

- 恢复时会重新解析当前 `system.mmd` 并生成新 plan：`src/runtime/adapter.ts:217-219`
- runDir 中 `system.mmd` 是 `writeIfMissing`，不会强制比对：`src/runtime/run-artifacts.ts:172-175`
- `loadResumeGraphState` 只做 state/sessions 形状与一致性校验，不验证 plan hash：`src/runtime/run-artifacts.ts:253+`

结论：

- 高风险成立，可能出现“旧状态 + 新拓扑/新绑定”混跑。

### #8 分支/汇合状态建模不完整（同意）

- 分支 ID 由 `roleId@loopIteration` 构成：`src/runtime/graph-runtime-state.ts:10-12`
- 活跃角色按 `roleId` 去重：`src/runtime/graph-runtime-state.ts:88-96`
- `roleResults` 仅按 `roleId` 覆盖存储：`src/runtime/graph-runtime-state.ts:157-162`
- 多入边非 join 未被 parser 禁止，且 prompt 构造对 `incoming.length !== 1` 会退回用户原始输入：  
  `src/runtime/parse-mermaid.ts`（无此禁令） + `src/runtime/role-executor.ts:75-81`

结论：

- 中高风险成立。你给的 dry-run 现象与代码行为一致。

### #9 可观测性/运维闭环不足（同意）

- 运行时信号主要是 stderr 文本日志：`src/runtime/console-run-log.ts:64-71`
- 汇总主要在结束后写 markdown：`src/runtime/graph-runner.ts:526+`
- roadmap 里 SLO/metrics/drill/fault-injection 仍在规划：  
  `docs/long-term-stability-roadmap.md:8-16`, `:57-63`

结论：

- 中风险成立，属于“可运行”到“可运营”之间的典型缺口。

## 3. 文件优先修复顺序（不引入 Redis/PG）

P0（立即）：

1. [x] 修复 `exitCode` 语义：非 0 必失败，不允许 `status=ok`。  
2. [x] 加 resume 兼容性校验：启动时校验 `plan fingerprint`（system/roles/models/law）。  
3. [x] 加 crash-idempotent 防重：基于文件 checkpoint 序号与节点执行 nonce 去重，并在 resume 前重放未落入 `state.json` 的 checkpoint。  
4. [x] 增加环路静态校验：环存在且无显式预算时拒绝运行。

P1（短期）：

1. [x] 审计与事件写入改为文件缓冲队列（同进程异步 flush，异常可回放）。  
2. [x] 扩展状态模型支持并行同轮多实例（roleId+branchId 维度存储）。  
3. [x] timeout/cancel 语义贯通到 opencode 调用链，杜绝 session 泄漏。

P2（中期）：

1. [x] 结构化 metrics（run/role/error code）落地到文件指标快照。  
2. [x] 故障演练脚本（timeout、部分写失败、resume 重放）纳入回归。

## 4. 结语

你的风险列表整体判断方向正确，且对生产稳定性非常关键。  
执行上建议按“先纠正语义错误与恢复一致性，再做性能与可观测性增强”的顺序推进；在当前阶段采用文件型 checkpoint/audit 架构即可，不必提前引入 Redis/PG。

## 5. 执行进展（2026-04-10）

- [x] P0.1 `exitCode` 语义修复：`runCliTool` 在子进程非 0 退出时抛出 `ToolExecutionError(exit_code)`，阻断 success 路径；已补回归测试覆盖非 0 退出分支。
- [x] P0.2 resume 兼容性校验：新增 `plan-fingerprint.json`，指纹覆盖 Mermaid `system`、runtime loader 实际载入的 `rolePackages`/`modelPackages` 内容与 `effectiveLaw`；路径类 `sourceHints` 仅保留诊断用途，不纳入 identity digest；新 run 持久化、resume 启动强校验，不匹配/缺失时失败；已补 role/model/law drift 与 path-stable 场景测试。
- [x] P0.3 crash-idempotent 防重：新增 run 级 `checkpoints/` WAL 与 per-execution `execution-outcome.json` durable marker；role 执行先提交 execution outcome，再由 graph loop 发出 checkpoint，resume 会先重放 pending checkpoint 并补齐缺失 checkpoint，避免重复执行。
- [x] P0.4 环路静态校验：Mermaid parser 新增 SCC/自环检测；对所有检测到的环，若未配置任何 `loop.max.<role>`，直接以 `MERMAID_CYCLE_REQUIRES_LOOP_MAX` 拒绝运行。
- [x] P1.1 审计/事件缓冲写：`events.ndjson` 与 `audit/transitions.md` 改为缓冲队列 + 显式 flush；flush 失败时写入 `.buffer-recovery/`，下次初始化自动回放。
- [x] P1.2 并行同轮多实例：runtime 状态改为 `branchId` 唯一标识 + `lineageId` 关联，并新增 `sessionLineageId` 作为 session 复用/隔离维度；统一 scheduler 每次处理当前 role 的全部活跃 branch，支持非 join 多入边下同一 role 在同轮执行多次，并将 role 级 session 快照明确命名为 `latest-session.json`，避免与 `sessions.json` 的 runtime authority 语义混淆；已补集成回归。
- [x] P1.3 `timeout/cancel` 语义贯通至 OpenCode 调用链：引入可传播取消信号，并在 `session.create`/`session.prompt`/纠偏 `prompt` 后执行取消检查；若超时先发生且 session 后创建，补偿 `abort` 会在创建返回后立即触发，避免会话泄漏。
- [x] P2.1 结构化 metrics：新增 `metrics.json` 文件快照，包含 run 级 summary、error code 统计与 role 级执行计数/耗时汇总，并与 `state.json` 同步刷新。
- [x] P2.2 故障演练回归：新增/补齐 timeout、部分写失败恢复、resume checkpoint replay 三类测试；同时增加 `npm run test:runtime-regression` 与 `npm run test:fault-injection` 作为回归入口。
