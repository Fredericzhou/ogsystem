# OGSystem Visualizer HTTP Runtime Isolation Decision

Archived: yes (decision record; active conclusion has been written back to `docs/todo-backlog.md`)

Date: 2026-05-04
Status: decided

## 1. Question

是否需要把 visualizer 的 `run start` / `run resume` 从当前 HTTP 服务进程内执行，改成进程外执行或显式队列化？

涉及入口：

- `src/visualizer/server.ts`
  - `handleApiRunStart()`
  - `handleApiRunResume()`
- `src/runtime/adapter.ts`
  - `runSystemWithAdapter()`

## 2. Current State

当前 visualizer 仍是 read-mostly 控制台，只有少量 control-plane 写入口：

- `project create/load/save`
- `run start`
- `run resume`
- `run stop`
- `review decide`

其中只有 `run start` / `run resume` 会直接调用 `runSystemWithAdapter()`，并在当前 Node HTTP 进程内完成运行时 setup、executor 启动、graph runner 执行、artifact 写盘与收尾。

同进程执行意味着：

- 运行时异常不会自动跨进程隔离。
- 长时间 CPU/IO 压力会与 HTTP/SSE 共用同一个 Node 进程。
- 如果进程崩溃，visualizer 和当前发起的运行都会一起中断。

## 3. What Was Verified

本轮复核确认了两点：

1. 这是已知可用性风险，不是“任意接口都不安全”的泛化问题。
2. 当前主要风险确实是进程级隔离不足，而不是路径解析或直接绕过 lifecycle 写运行目录。

同时确认当前已经存在的护栏：

- visualizer 写入口仍走 lifecycle / control-plane 边界。
- `resume` 已有 `.resume.lock` 互斥，避免同一 run 并发恢复。
- SSE 已补 active/open/close/tick/snapshot/write/error 指标，可观察连接堆积。
- 请求体大小已有上限。
- `run start` / `run resume` 的运行时覆盖路径已补 workdir 边界约束。

## 4. Options

### Option A. 保持现状

优点：

- 复用现有 `runSystemWithAdapter()` 与 artifact 语义，不引入第二套执行入口。
- 不增加新的进程编排、状态同步、子进程清理、日志转发和结果回传复杂度。
- 对当前单机、低并发、以运维可视化为主的使用形态最小扰动。

缺点：

- HTTP 进程与运行时共享故障域。
- 单次重负载运行可能拖慢同进程的页面响应与 SSE。

### Option B. 进程外执行

形式：

- 由 visualizer 仅创建控制请求。
- 运行时通过子进程或 CLI 子命令执行。

优点：

- 真正隔离 crash、memory pressure、阻塞风险。
- 更容易做超时、杀进程、资源预算和未来多 worker 演进。

缺点：

- 需要稳定的父子进程协议、状态回传、日志桥接、退出码映射。
- 需要重新处理 resume/start 的控制面幂等、stop 行为和可观测性。
- 当前复杂度成本明显高于已证实的问题规模。

### Option C. 同进程队列化

优点：

- 能限制并发 `start` / `resume` 数量。
- 实现成本低于进程外执行。

缺点：

- 不能解决 crash 共域问题。
- 不能解决单任务卡住 event loop / 内存膨胀时拖垮 visualizer 的根因。

结论：队列化只能缓解并发，不构成隔离方案本身。

## 5. Decision

结论：**当前不引入进程外执行，也不单独为了 visualizer 增加同进程队列层；继续保留同进程执行。**

原因：

1. 当前 visualizer 的主风险已经从“明显错误路径”收敛到“可用性隔离不足”，但还没有证据表明必须立即引入第二套执行架构。
2. 单独做同进程队列并不能解决 crash / memory / event-loop 共域问题，收益不足。
3. 直接切到进程外执行会显著扩大协议面、观测面和回归面，当前不符合稳定主线的“不加复杂度”原则。

## 6. Escalation Triggers

出现以下任一情况时，应优先重开此决策，并以“进程外执行”作为首选方向：

- visualizer 在 `run start` / `run resume` 期间出现可复现的页面卡顿、SSE 中断或请求超时。
- 单个运行的崩溃会明显拖垮长驻 visualizer 进程，成为真实运维痛点。
- 需要在同一 visualizer 会话下稳定支持多个长运行任务并发发起。
- 需要更强的 stop / cancel / timeout 语义，且必须具备进程级强制终止能力。
- 需要把 visualizer 从“单机操作台”提升为“可托管控制面”。

## 7. Preferred Future Direction

如果后续必须升级，优先顺序应为：

1. **进程外执行**
   - 由 visualizer 派生受控子进程或调用稳定 CLI 入口。
   - visualizer 只负责控制请求、状态回读和结果展示。
2. **必要时再叠加队列**
   - 仅在确认存在多任务并发争用后再增加排队/并发上限。

不建议先做“纯同进程队列化”，因为它会增加控制复杂度，但不能消除主要故障域问题。

## 8. Active Backlog Conclusion

对应 backlog 项：

- `针对 runSystemWithAdapter() 直接运行在 HTTP 进程内这一已知可用性风险，评估隔离方案与取舍，形成是否需要进程外执行或队列化的决策记录`

本项结论已经形成：

- 已完成评估。
- 当前结论是不升级执行架构。
- 后续仅在触发条件出现时，按“进程外执行优先、队列其次”的方向推进。
