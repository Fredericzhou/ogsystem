# OGSystem 统一计划与演进清单 (Unified Plan & Backlog)

更新日期：2026-11-02
状态：active（工作区唯一活动计划入口）

## 1. 规划原则与防过度设计边界

1. **单一计划入口**：本文件是工作区唯一的活动计划与待办入口。已落地功能的架构契约统一归入 [`DECISIONS.md`](DECISIONS.md)、[`ogs-product-boundary-and-evolution.md`](ogs-product-boundary-and-evolution.md) 与 `docs/usage/` 手册，不再维护多份重叠的专题路线图。
2. **低成本高收益（Low Cost, High Reward）**：优先解决影响运行可靠性、发布验收闭环、高频交互体验和单文件维护成本的实际问题；全面复用现有 `SystemDefinition -> Semantic IR v1 -> ExecutionPlan -> LangGraphEngineAdapter` 核心链路与原生 ESM/CSS 技术栈。
3. **严控范围扩大化**：在单机文件优先（file-first）内核与现有双工作台（Studio / Projects）未遇到真实实测瓶颈前，拒绝破坏性重写、重型基础设施预设和投机性平台扩张。

---

## 2. 已完成基线（Closed Baseline）

以下核心能力与专项改造均已落地并由自动化测试覆盖，不再重复立项：

- **编排内核与语义（Semantic IR v1）**：受限 Mermaid DSL 解析、责任席位（Responsibility Seat）模型、State Schema 与确定性 Reducer、受限 Condition AST 条件路由、`parallel_split` 语义分支激活、`all_of` / `quorum_of` Join（含基础 `timeoutSeconds` / `onTimeout`）、Loop Scope 三层预算、`ERROR` / `ERROR.<code>` 异常路由。
- **持久化、恢复与人工审核**：版本化状态快照（CAS / `eventId` 幂等提交）、Checkpoint WAL 重放与 `runtime-replay-benchmark` 基线、Runtime 原生人工审核（`approve / rework / pause / terminate` 及惰性超时自动收敛）。
- **生产治理与评测门禁**：外部不可信输入默认包裹 `<ogs_external_data>` 并记录审计、基于 `callId`（`${executionId}:${phase}:${ordinal}`）的并发安全提示词预算账本（`RunPromptBudgetLedger`）、受限备选模型降级（resolved `fallback`，仅限模型通道瞬态故障）、Studio `.ogs/laws.json` 版本隔离配置，以及发布基线批次状态机（跨进程文件锁、摘要变更自动失效、跨版本对比）。
- **控制目录分离与双工作台隔离**：`--ogs-dir`（控制与运行证据根）与 `--workspace-dir`（纯业务工作区）显式分离；`TeamVersion` 发布摘要与运行 `team-version.json` 冻结；`project_task`（`<projectId>/.ogs/runs/`）与 `studio_simulation`（`.studio/simulations/`）存储、API、容量槽位与交付物严格隔离。
- **角色源与共享资源目录**：独立 Git 角色源（`agency-agents` 与 `agency-agents-cn`）安全拉取、Front Matter 解析、`source.json` 溯源证明、复制到 Draft 向导及平台共享资源目录（模型、数据集、工具、存储目标）。
- **可视化布局与 Team Site 工作台**：`Semantic IR -> Semantic Layout Projection -> ELK.js -> LayoutProjection -> GraphViewModel -> X6` 唯一显式分层布局链路；`RunQueryService` 基于游标与字节偏移的增量事件读取；Team Site 统一 `pageFrame` 响应式外壳、一级菜单紧凑头部、Studio 仿真运行态图谱只读锁，以及浮动面板级联避让与 `Escape` 焦点管理。

---

## 3. 近期高优计划：低成本高收益（P1）

### P1-1 发布前验收（Release UAT）与语义一致性收口
- [ ] **完成 [`release-uat-checklist.md`](release-uat-checklist.md) 待签收场景**：重点完成场景 14/15（双控制目录共享同一业务 Workspace、版本冻结与运行证据隔离）及真实 Sandbox 下的人工审核（批准/打回/分支终止）端到端记录。
- [ ] **条件路由与 Join 运行态浏览器验证**：在真实 Runtime/Operate 流程中验证条件路由决策（命中、无匹配、同优先级歧义）与 Join 等待/超时原因的可检索性，收敛跨语义 Engine Adapter 黄金测试夹具（conformance fixtures）。

### P1-2 上下文映射（Context Map）可选字段支持
- [ ] **支持 `direct.*` 与 `source(role).*` 的显式可选选择器（`?`）**：解决返工循环中“首轮执行”与“QA/审核打回轮次”上游输出结构不同的高频痛点。对标记为 `?` 的缺失字段在投影时安全省略，对未标记 `?` 的必需字段保持严格 fail-closed，避免下游角色被迫绑定整个 `direct.data` 对象。

### P1-3 Team Site 细节修复与冗余代码清理
- [ ] **修正角色仓库分页参数不一致**：对齐 `apps/team-site/public/app/views/shared-resources.js` 请求的 `pageSize` 与服务端分页上限（50），消除截断隐患。
- [ ] **清理旧版浮动面板冗余代码**：在现有浏览器回归测试守护下，移除 `apps/team-site/public/app/views/app.js` 中被 `dataset.floatingPanelController !== "true"` 保护的旧拖拽监听分支及未引用的 `resizePanel` 函数。

### P1-4 Visualizer 前端打包与高频流渲染优化
- [ ] **用 `esbuild` 直接打包替代 `.toString()` 拼接**：将 Visualizer `client-app.js` 的运行时函数字符串拼接改为与 `build:studio-client` 一致的 `esbuild` 编译压缩产物，配合静态资源内容哈希与服务端 HTML 首屏静态骨架屏，降低加载体积与首屏空白时间。
- [ ] **SSE 高频事件节流与转义核查**：在 Visualizer SSE 运行流处理中引入 `requestAnimationFrame` 批量节流更新，避免密集事件阻塞 UI 线程；对客户端 `innerHTML` 赋值做一轮输入转义（`esc` / `escapeHtml`）覆盖核查。

---

## 4. 按需演进项：有真实痛点或基准数据后再启动（P2）

以下事项仅在触及对应模块或有实测数据支撑时按最小范围实施：

- [ ] **超大前端视图文件按业务域渐进拆分**：在修改对应面板时，将 `apps/team-site/public/app/views/app.js`（5000+ 行）和 `src/visualizer/client-app.ts`（9000+ 行）按面板职责（如 `workbench`、`asset-drawer`、`build-panel`、`debug-panel`）拆分为独立 ESM 模块。**约束**：保持原生 ESM 调用，不引入 EventBus、PanelRegistry 或第三方前端框架。
- [ ] **可扩展 Model Backend Registry**：在不改 Mermaid/Role 图语义的前提下，将 Codex、OpenCode 及后续主流 CLI 的执行路由收口到窄 `BackendAdapter`/Registry；Backend 是执行通道身份，`modelId` 是 backend-local opaque ID，不引入独立的 provider/vendor/source 字段。当前版本直接切换 selection/catalog/session schema，不做旧格式迁移或兼容层；保留现有会话复用、重试、取消、JSON 修复和证据记录。按独立阶段加入 Ollama HTTP 及已验证的主流 CLI adapter。Backend-native tools、skills、MCP 默认沿用所选 CLI 配置，不新增 OGS 管理矩阵。
- [ ] **主流 CLI Backend 接入矩阵**：Registry 使用稳定的字符串 Backend ID，首批纳入 `codex`、`opencode`、`ollama`、`pi`、`qwen`、`kimi`；Gemini 和其他 CLI 等待后续协议验证。只有完成 transport、取消、结构化输出、会话语义和本机探测验证的 CLI 才标记 runnable。仅能发现 CLI 或尚未验证 transport 的条目保留为 `unavailable`，不得伪造可运行模型；每个 adapter 独立维护模型发现和能力映射。
- [ ] **Backend 图标本地注册表**：参考 CC Switch 的 `ProviderIcon`/本地图标映射方式，为每个 Backend 提供受控的 bundled SVG/PNG 或内联资源、可访问文本标签和通用 fallback；图标按 Backend ID 查找，不读取远程图片，不把图标 URL、厂商元数据或模型来源写入 selection/catalog。一个 CLI 可访问多个模型来源时仍只显示该 CLI Backend 图标，模型 ID 原样显示。
- [ ] **单机文件型外部信号等待与项目生命周期补充**：当出现外部异步回调场景时，提供最小单机文件型 `signal` 恢复入口；按需补充已验证 Run 产物的显式导出（Artifact Promotion）校验与项目归档（Archived 只读）状态。

---

## 5. 明确不做与延后边界（Non-Goals & Deferred）

为避免扩大化与过度设计，以下方向明确不纳入当前主线：

1. **不推翻现有 DSL 与编译契约**：不实施破坏性的 `Team IR v2` 全量 JSON 重写，不废弃 `system.mmd`、`Semantic IR v1`、`flow-contract.ts` 或现有 Studio 项目配置。
2. **不扩张为云端多租户平台或容器编排底座**：不建设独立门户/下载站、远程控制面 API、Docker/Podman/Kubernetes 动态容器管理器、gVisor/Kata/Firecracker 微虚拟机集群，也不维护 Electron / Tauri 多桌面壳工程。
3. **不提前引入数据库与分布式协调**：在单机文件系统与 `RunQueryService` 增量游标查询满足需求前，不建设 PostgreSQL/SQLite 存储后端、Redis/DB 分布式锁、跨主机抢占调度或 Worker Runtime 多世代热切换守护进程（Supervisor）。
4. **不膨胀核心图语义与协议面**：不引入动态 `map_fanout` 集合展开节点、分阶段 Join 等待窗口（`join.first_packet.*` / `join.gap.*`）、可执行递归子系统（`CompositeResponsibilitySpec`）、通用脚本表达式语言、远程 A2A 协议集成或 BPMN XML 导入导出。

Backend 范围继续保持最小：不做每个 Agent/Role 一个常驻服务，不做共享 Backend 服务池，不做跨 Backend fallback，不做 backend-native tool/skill/MCP 目录或权限矩阵。支持更多 CLI 只通过新增独立 adapter、descriptor、探测器和本地图标映射实现，不扩张为 provider/model 关系图。Worker Runtime 服务化、Supervisor、客户端重连和在线替换属于后续按真实部署需求启动的运维阶段，不是 Backend Registry 或任一具体 Backend 的前置条件。
