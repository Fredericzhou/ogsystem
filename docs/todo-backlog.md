# OGSystem 统一待办清单（Backlog）

Date: 2026-05-03  
Status: active  
Sources: `docs/long-term-stability-roadmap.md`, `docs/archive/delivery/optimization-execution-checklist-2026-04-10.md`, `docs/archive/delivery/single-graph-runtime-execution-checklist.md`, `docs/archive/delivery/cross-platform-rust-validation-and-gap-analysis-2026-04-12.md`, `docs/archive/delivery/source-commenting-hardening-plan-2026-04-11.md`, `docs/archive/delivery/ogsystem-canvas-centered-product-architecture-roadmap-2026-05-03.md`, `docs/archive/delivery/ogsystem-visualizer-optimization-checklist-calibrated-2026-05-03.md`

## 1. 目的与边界

- 本文档是当前唯一“待办汇总入口”，用于替代分散 checklist 的日常跟踪。
- 稳定主线继续遵循“不加复杂度”原则：先容量治理、基准回归、运维手册化，再评估架构升级。
- 带日期的计划/评估/checklist 作为交付记录保留在 `docs/archive/`，不直接作为当前执行清单。

## 2. 当前优先（可立即执行）

### P1. 编译器主线

- [x] 建立 `src/runtime/compiler.ts` 静态编译入口，并把 compiler digest 纳入 `plan-fingerprint.json`。
- [x] 增加 compiler 单元测试与负例诊断回归。
- [x] 继续做 compiler shadow compare，把 runtime failure surface 和 compiler diagnostics 的对照补齐。
- [x] 逐步把 compiler snapshot 消费面扩展到审计与恢复可观察项。

### P1. 跨平台产品化闭环

- [ ] 在 CI 增加 Rust toolchain 维度的可选门禁作业（cargo 可用时执行 `tests/rust-hello-pipeline.test.mjs`）。
- [ ] 增加 Windows PowerShell/CMD 生命周期命令 smoke test，覆盖 `project init` 与 `run start/list/status`。
- [ ] 建立安装与操作文档漂移检查（README 与 usage-manual 的命令片段对齐校验）。

### P1. 生命周期可观测性补齐

- [ ] `run status/list` 增加统一字段：运行时长、停止原因、最后错误码、最后角色。
- [ ] `run logs` 增加 `--tail`、`--follow`、`--since` 能力，降低排障成本。
- [ ] 增加 run 级 `summary.json`（面向工具消费），避免只依赖 markdown 审计摘要。

### P1. 容量治理

- [ ] 基于 `executionDirCount` 给出默认阈值建议，并写入运维文档。
- [ ] 在清理路径补充审计字段：触发阈值、清理耗时、清理前后目录数量。

### P1. 回归与压测基线

- [ ] 持续运行 `runtime-replay-benchmark`，沉淀 checkpoint 重放耗时趋势。
- [ ] 增加长循环（500+ iterations）下的恢复耗时阈值与回归门槛。

### P1. 运维手册化

- [ ] 形成 retention 分层建议（开发/预发/生产）。
- [ ] 明确“自动清理”和“一次性 CLI 清理”的启用准则。

### P1. 源码注释治理收尾

- [ ] 新增 `docs/commenting-style.md`，把当前已落地的注释规则、反例与评审清单从 archive 固化为活动规范。
- [ ] 新增 `docs/file-sets.md`，沉淀 `src/runtime/*` 与 `src/nl2mmd/*` 的文件集划分、职责边界与相互引用关系。
- [ ] 完成剩余 `src/runtime/*` 文件的文件头导读与必要关键路径注释，补齐 P2 范围的一致性收尾。
- [ ] 完成全量 `src/nl2mmd/*` 文件的文件头导读、关键转换/校验链路注释与必要类型契约说明。
- [ ] 增加轻量注释治理门禁，至少覆盖新增/改动源码的文件头存在性与“关键逻辑改动需同步更新注释”检查。

### P1. Visualizer 确认缺陷修复

- [x] 修复 Mermaid Live URL 编码逻辑，覆盖 `src/visualizer/data.ts` 与 `src/visualizer/run-graph-projection.ts` 的同类实现，改为 Mermaid Live 可识别的压缩/编码格式，并补充回归测试。
- [x] 清理 `src/visualizer/dto.ts` 中恒真三元表达式，避免 bundle `mode` 分支静默失效。
- [x] 删除 `src/visualizer/studio-authoring.ts` 中重复的类型导入，消除拷贝遗留噪音。
- [x] 为 `src/visualizer/server.ts` 的 `readJsonRequest()` 增加请求体大小上限和明确错误响应，避免大 body 拖垮进程。
- [x] 复核并调整 `src/visualizer/client-lifecycle-state.ts` 的 `hasProject` 初始语义，避免首屏先假定“已有项目”导致闪烁或错误面板切换。
- [x] 删除 `src/visualizer/client-route-state.ts` 中未使用的 `legacyView` 参数，或恢复其兼容用途并补测试。
- [x] 区分 `loadStudioAuthoringDraft()` 中“草稿不存在”和“草稿损坏/读取失败”两类情况，避免 `src/visualizer/studio-authoring.ts` 直接吞错返回 `null`。
- [x] 让 Studio bridge/import 的 Mermaid 解析失败对用户可见，避免 `inspectStudioBridgeDraft()` 在 import 失败时静默丢失错误上下文。
- [x] 补齐项目创建失败回滚时的清理错误处理，避免 `removeCreatedProjectFiles()` 静默忽略残留文件。

### P1. Visualizer 短期稳态优化

- [x] 为 `runsListCache`、项目投影缓存和相关长生命周期缓存建立明确的上限/失效策略，避免进程常驻后占用不可控增长。
- [x] 评估并优化 SSE 每秒轮询文件系统的实现，至少补连接数、IO 频率和关闭行为的观测指标。
- [x] 将 `src/visualizer/client-stream-state.ts` 的流式事件去重从线性扫描改为显式索引结构，降低高频事件追加成本。
- [x] 评估 `src/visualizer/project-projection.ts` 的角色目录摘要生成路径，区分“内容指纹”与“缓存 token”场景，避免不必要的全文件读取。
- [x] 复核 `src/visualizer/client-run-data-loaders.ts` 的日志并发抓取策略，为多 role 场景增加并发控制或分批加载。
- [x] 复核 `src/visualizer/ops-summary-projection.ts` 的 run 汇总读取路径，确认真实瓶颈后再决定是否并行化或加缓存。
- [x] 为 `src/visualizer/client-app.ts` 的高频 `innerHTML` 重绘热点建立优先级列表；首批热点已覆盖 `operateTabs` / `workbenchStatus` / `workbenchTabs` / `workbenchViewTabs` / `workbenchActions` / `runListEl` / `consoleTabsEl`。
- [x] 为关键异步加载态补更稳定的 loading skeleton 或占位策略，至少覆盖项目首页、Build 工作台和运行明细主面板。

### P2. Visualizer 状态与可维护性治理

- [ ] 拆分 `createInitialVisualizerState()` 的巨型扁平状态对象，按 project/build/operate/review/logs/streaming 切片组织。
- [ ] 继续审查 run 切换时的状态重置路径，重点验证 review、failure、resume、logs 是否仍存在短暂陈旧数据窗口。
- [ ] 为 `listTimer`、`workbenchValidationTimer`、`streamRefreshTimer` 等定时器建立统一清理约束，避免后续继续分散增长。
- [ ] 继续拆分 `src/visualizer/client-app.ts` 与 `src/visualizer/server.ts` 的超大文件，把稳定边界沉淀为独立模块。
- [ ] 收敛 `asString`、`asRecord`、`escapeHtml` 等重复辅助函数，统一语义并减少多份拷贝漂移。
- [x] 将 `src/visualizer/client-renderers.ts` 的 SVG 拓扑排序从 `queue.shift()` 改为 index 游标遍历，避免理论 O(n²) 热点。

### P2. Visualizer 无障碍与交互修复

- [ ] 对 visualizer 主要交互面板做一次系统性无障碍审计，优先补足可聚焦区域、label 关联、语义角色和非颜色状态提示。
- [ ] 复核 Studio 图命令表单与 chat 面板的 ARIA 语义，避免把非模态区域声明成 `dialog`；其中 chat 面板已改为 `region`，命令表单仍待确认其 modal 语义与焦点/键盘行为是否完备。
- [ ] 为工作台编辑、聊天输入和其他高频输入路径补明确的交互节流/防抖策略说明，避免后续回归到每击键重算。

### P2. Visualizer 风险待验证

- [ ] 验证 `requestId` 幂等缓存是否存在同 ID 并发双执行窗口；若成立，再补原子占位或 in-flight 协调。
- [ ] 验证 SSE 连接在快速切换 run、页面中断和网络抖动场景下是否会出现悬挂连接累积。
- [ ] 审查 `normalizeCanvasEdgeId()` 的冲突重试路径，确认是否存在极端输入下的无界循环或性能退化。
- [ ] 评估 Mermaid Live URL 在大图场景下的长度上限和回退策略，避免修复编码后仍遇到浏览器长度限制。
- [ ] 审查 visualizer API 的路径解析面，区分已有限制与仍需补强的 workdir 边界，避免泛化为“全部存在路径穿越”。
- [ ] 针对 `runSystemWithAdapter()` 直接运行在 HTTP 进程内这一已知可用性风险，评估隔离方案与取舍，形成是否需要进程外执行或队列化的决策记录。

## 3. 稳定后再做（延后项）

- [ ] 在 CI 增加 `pnpm pack` + 安装态 smoke test，覆盖 npm/pnpm 安装、`ogs help` 与模板项目启动。
- [ ] 定义已发布 CLI 的版本升级、兼容窗口和弃用策略。
- [ ] 增加 provider 凭据健康检查与最小权限模板（开发/CI/生产）。
- [ ] 引入运行目录敏感字段脱敏策略（日志与审计输出）。
- [ ] 语义兼容型 resume（宽容指纹/带损恢复）。
- [ ] 分布式锁 provider（Redis/DB 跨主机协调）。
- [ ] 共享存储多实例抢占调度协议。
- [ ] `state/checkpoint compact`（仅在基准数据证明必要时推进）。

## 4. 不纳入当前主线

- 插件/Hook 生态、新调度层、多后端持久化、多机分片、外部 secrets manager 集成等，保持 out-of-scope。
- `vNext-dev` 破坏性方案仅作为探索，不作为稳定主线待办。
- 对应归档记录：`docs/archive/delivery/vnext-execution-plan-2026-04-11.md`（仅历史参考）。

## 5. 已归档来源

- 已完成稳定性基线 checklist：`docs/archive/delivery/optimization-execution-checklist-2026-04-10.md`
- 已完成单运行时迁移 checklist：`docs/archive/delivery/single-graph-runtime-execution-checklist.md`
- Visualizer 产品架构路线与阶段性评审：`docs/archive/delivery/ogsystem-canvas-centered-product-architecture-roadmap-2026-05-03.md`
