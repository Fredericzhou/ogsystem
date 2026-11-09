# OGSystem 统一计划与演进清单 (Unified Plan & Backlog)

更新日期：2026-11-10
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
- **生产治理与评测门禁**：外部不可信输入默认包裹 `<ogs_external_data>` 并记录审计、基于 `callId`（`${executionId}:${phase}:${ordinal}`）的并发安全提示词预算账本（`RunPromptBudgetLedger`）、受限备选模型降级（`fallbackModelId`，限定在所选后端且仅处理模型通道瞬态故障）、Studio `.ogs/laws.json` 版本隔离配置，以及发布基线批次状态机（跨进程文件锁、摘要变更自动失效、跨版本对比）。
- **控制目录分离与双工作台隔离**：`--ogs-dir`（控制与运行证据根）与 `--workspace-dir`（纯业务工作区）显式分离；`TeamVersion` 发布摘要与运行 `team-version.json` 冻结；`project_task`（`<projectId>/.ogs/runs/`）与 `studio_simulation`（`.studio/simulations/`）存储、API、容量槽位与交付物严格隔离。
- **角色源与共享资源目录**：独立 Git 角色源（`agency-agents` 与 `agency-agents-cn`）安全拉取、Front Matter 解析、`source.json` 溯源证明、复制到 Draft 向导及平台共享资源目录（模型、数据集、工具、存储目标）。
- **可视化布局与 Team Site 工作台**：`Semantic IR -> Semantic Layout Projection -> ELK.js -> LayoutProjection -> GraphViewModel -> X6` 唯一显式分层布局链路；`RunQueryService` 基于游标与字节偏移的增量事件读取；Team Site 统一 `pageFrame` 响应式外壳、一级菜单紧凑头部、Studio 仿真运行态图谱只读锁，以及浮动面板级联避让与 `Escape` 焦点管理。
- **模型 Backend 与原生 CLI**：`BackendRegistry` 已收敛 Codex、OpenCode、Ollama、Pi、Qwen Code、Kimi Code；各 adapter 独立读取官方 API-provider 配置、发现模型并按协议执行探测。Gemini 暂不纳入当前交付。
- **Role 输入投影与语义抽象**：`direct.*` / `source(role).*` 可选 selector 已落地并由 Runtime 测试覆盖；扩展状态机、DAG 比较和社会化协作模型见双语技术参考。
- **语义合同与真实案例**：固定业务事件注册表（`READY` 为正常交接事件）、显式 Handoff、条件路由 fail-closed、Join source outcome、Review 血缘、Artifact provenance/Resolver、Run Result commit 和 Loop Budget Review 已接入；Debate Loop、Medical quorum、条件审批、Artifact 证据链、Error compensation 与 GStacklike Review 案例已完成自动化真实运行验证，详见当前[发布验证记录](release-validation-2026-11-08.md)。

---

## 3. 近期高优计划：低成本高收益（P1）

### P1-1 发布前验收（Release UAT）与语义一致性收口
- [ ] **完成 [`release-uat-checklist.md`](release-uat-checklist.md) 待签收场景**：重点完成场景 14/15（双控制目录共享同一业务 Workspace、版本冻结与运行证据隔离）及真实 Sandbox 下的人工审核（批准/打回/分支终止）端到端记录。
- [ ] **条件路由与 Join 运行态浏览器验证**：在真实 Runtime/Operate 流程中验证条件路由决策（命中、无匹配、同优先级歧义）与 Join 等待/超时原因的可检索性，收敛跨语义 Engine Adapter 黄金测试夹具（conformance fixtures）。
- [x] **全局循环预算人工审核策略**：将 `loop_exhausted` 作为独立 Runtime 控制事件；任何超预算统一进入预算审核等待，禁止按原业务事件、`onExhausted` 或 End 自动继续；实现 `continue / rework / terminate / reject` 的合法目标校验、新增预算授权、幂等恢复、审计记录和调试上下文展示。固定业务事件中的 `APPROVAL_PROPOSED` 仅表示拟批准建议，不替代人工审核授权。详见 [`business-event-protocol-v1.md`](business-event-protocol-v1.md)。

### P1-2 Team Site 细节修复与冗余代码清理
- [ ] **清理旧版浮动面板冗余代码**：在现有浏览器回归测试守护下，移除 `apps/team-site/public/app/views/app.js` 中被 `dataset.floatingPanelController !== "true"` 保护的旧拖拽监听分支及未引用的 `resizePanel` 函数。

### P1-3 文件产物与代码执行能力建设
- [x] **门禁一：文件产物契约（基础实现）**：候选 `artifacts` 声明和 parser 校验、固定业务事件、opaque `StoredRoleResult.artifactRef`、ArtifactResolver 显式授权和访问审计已落地。
- [ ] **门禁二：文件持久化与验证（部分实现）**：execution staging、声明产物验证、verified manifest、verification/seal、封存文件包读取和 Promotion 复用已落地；配置化 verifier 命令、shared artifact 投影及 checkpoint/resume 端到端对账仍待完成。
- [ ] **门禁三：产品发布闭环（部分实现）**：Studio 专用只读 API、Projects 多文件 Deliverable、Run 文件包归档、旧快照恢复和 CSP/SVG 边界已落地；Business Data Adapter 四步事务和前端 artifact canvas 仍待完成。
- [x] **长任务预算**：角色默认执行预算已放宽至 10 分钟，Graph Runner 增加 15 秒持久化宽限，OpenCode 启动预算上限提高至 2 分钟，显式 Role/Profile/Model 配置仍可覆盖。
- [x] **真实模型协作验收**：使用本机 Codex `gpt-6-luna` 完成两 Role 真实 API/模型运行，状态机、上下文交接、Schema 校验和审计证据均通过；复杂三分支案例另有模型响应超过 10 分钟而按门禁失败的记录。
- [ ] **多媒体真实验收**：尚未完成真实 FFmpeg 视频端到端 Role 协作验收；当前仅确认文件产物契约、CLI/模型执行链路和真实 Codex 文本协作。
- [ ] **多 backend capability 对齐**：各 backend 已使用 per-attempt execution staging，但 workspace capability/permission policy 的传递、自动批准语义和审计字段仍需分别核对并补充真实 CLI 文件生成验收。
- [ ] **阶段验收**：每道门禁完成契约测试、持久化/恢复测试和 Studio/Projects 边界测试后，才进入下一阶段。详细规格见 [`text-artifact-business-delivery-architecture.md`](text-artifact-business-delivery-architecture.md)。

### P1-4 Visualizer 前端打包与高频流渲染优化
- [ ] **用 `esbuild` 直接打包替代 `.toString()` 拼接**：将 Visualizer `client-app.js` 的运行时函数字符串拼接改为与 `build:studio-client` 一致的 `esbuild` 编译压缩产物，配合静态资源内容哈希与服务端 HTML 首屏静态骨架屏，降低加载体积与首屏空白时间。
- [ ] **SSE 高频事件节流与转义核查**：在 Visualizer SSE 运行流处理中引入 `requestAnimationFrame` 批量节流更新，避免密集事件阻塞 UI 线程；对客户端 `innerHTML` 赋值做一轮输入转义（`esc` / `escapeHtml`）覆盖核查。

---

## 4. 按需演进项：有真实痛点或基准数据后再启动（P2）

以下事项仅在触及对应模块或有实测数据支撑时按最小范围实施：

- [ ] **超大前端视图文件按业务域渐进拆分**：在修改对应面板时，将 `apps/team-site/public/app/views/app.js`（5000+ 行）和 `src/visualizer/client-app.ts`（9000+ 行）按面板职责（如 `workbench`、`asset-drawer`、`build-panel`、`debug-panel`）拆分为独立 ESM 模块。**约束**：保持原生 ESM 调用，不引入 EventBus、PanelRegistry 或第三方前端框架。
- [ ] **Backend 图标本地注册表**：参考 CC Switch 的 `ProviderIcon`/本地图标映射方式，为每个 Backend 提供受控的 bundled SVG/PNG 或内联资源、可访问文本标签和通用 fallback；图标按 Backend ID 查找，不读取远程图片，不把图标 URL、厂商元数据或模型来源写入 selection/catalog。一个 CLI 可访问多个模型来源时仍只显示该 CLI Backend 图标，模型 ID 原样显示。
- [ ] **单机文件型外部信号等待与项目生命周期补充**：当出现外部异步回调场景时，提供最小单机文件型 `signal` 恢复入口；按需补充已验证 Run 产物的显式导出（Artifact Promotion）校验与项目归档（Archived 只读）状态。
- [x] **Loop Review 故障窗口补测**：真实 Runner 已覆盖“决策应用后、标记已处理前崩溃”、重复决策改写只应用一次、CLI `list / inspect / decide --target-role --additional-budget / resume`，并验证恢复后的唯一审计事件。
- [x] **Runtime 事件写入索引**：Run 上下文缓存已用于稳定事件 ID 去重，首次加载仍读取 `events.ndjson`，并保持该文件作为唯一审计事实源。

---

## 5. 明确不做与延后边界（Non-Goals & Deferred）

为避免扩大化与过度设计，以下方向明确不纳入当前主线：

1. **不推翻现有 DSL 与编译契约**：不实施破坏性的 `Team IR v2` 全量 JSON 重写，不废弃 `system.mmd`、`Semantic IR v1`、`flow-contract.ts` 或现有 Studio 项目配置。
2. **不扩张为云端多租户平台或容器编排底座**：不建设独立门户/下载站、远程控制面 API、Docker/Podman/Kubernetes 动态容器管理器、gVisor/Kata/Firecracker 微虚拟机集群或第二套桌面壳工程。当前 Electron 只是复用 Team Site HTTP 服务的薄主机壳，桌面发布硬化单独列为 P1，不扩展 Runtime 核心。
3. **不提前引入数据库与分布式协调**：在单机文件系统与 `RunQueryService` 增量游标查询满足需求前，不建设 PostgreSQL/SQLite 存储后端、Redis/DB 分布式锁、跨主机抢占调度或 Worker Runtime 多世代热切换守护进程（Supervisor）。
4. **不膨胀核心图语义与协议面**：不引入动态 `map_fanout` 集合展开节点、分阶段 Join 等待窗口（`join.first_packet.*` / `join.gap.*`）、可执行递归子系统（`CompositeResponsibilitySpec`）、通用脚本表达式语言、远程 A2A 协议集成或 BPMN XML 导入导出。

Backend 范围继续保持最小：不做每个 Agent/Role 一个常驻服务，不做共享 Backend 服务池，不做跨 Backend fallback，不做 backend-native tool/skill/MCP 目录或权限矩阵。支持更多 CLI 只通过新增独立 adapter、descriptor、探测器和本地图标映射实现，不扩张为 provider/model 关系图。Worker Runtime 服务化、Supervisor、客户端重连和在线替换属于后续按真实部署需求启动的运维阶段，不是 Backend Registry 或任一具体 Backend 的前置条件。
