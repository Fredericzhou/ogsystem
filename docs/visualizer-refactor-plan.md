# Visualizer 收敛与 UX 重构执行计划

> 唯一执行入口。按 §5 顺序执行，每 Phase 独立可回滚。
> 本计划不依赖其他文档；历史讨论请查 git log（2026-05 月初 `docs/` 下已合并文档）。

## 1. Context

`src/visualizer/` 当前问题**三件事叠加**：

1. **前端装配单体化** — `client-app.ts` 6200+ 行 + `buildClientAppScript()` 字符串注入 + `function.toString()` 内联；仅 `studio-graph.js` 已独立为静态资源。
2. **图谱渲染投影重复翻译** — 编辑态走 X6，运行态走静态 SVG；同一张图的 "正在执行 / 等待审核 / join 阻塞" 在两侧各写一遍。
3. **交互过于打断** — 单击即编辑 / selection overlay 三态（open / docked / collapsed）/ Build 与 Operate 的 graph 不共享心智模型。

## 2. Locked Decisions Checklist

下述决策已经对齐、本期内不再重新讨论。修改这些决策需要开新的 review，不属于本计划内部微调。

- [x] **三层图谱真理层保留不动**：`SystemDefinition` / `StudioAuthoringDocument` / `StudioCanvasDocument`，职责边界不混。`SystemDefinition` = 运行内核真理；`StudioAuthoringDocument` = 编辑真理（`.ogs/studio/system.authoring.json`）；`StudioCanvasDocument` = 布局真理（本期从 "公开中间类型" 降级为 "adapter 内部派生"，**不删除**；真正删除放到 Phase E 完成后）。
- [x] **收敛的是渲染投影层**：`StudioGraphProjection` + `RunGraphView` → 合成单一 `GraphViewModel`（structure / layout / runtime / diagnostics 四层）。`GraphViewModel` 只服务渲染，不承担真理层职责。
- [x] **Undo/Redo 走语义 command reducer + 派生快照**，不切回 X6 内置 History。
- [x] **Chat-to-MMD 改语义 patch**（沿用既有命令集 `add-role / update-edge / set-review-policy` 等），不做全量替换；超阈值时允许 fallback。
- [x] **产品形态向 Design / Run / Release 三视图收敛**，CTA 按情境切换（详见 Phase L1 / L2）。
- [x] **本期不引入 Preact / Solid 等响应式库**，先稳住 island 边界再评估。
- [x] **Run 图布局权威顺序**分两层：
  - **服务端 `/runs/:id/graph` authoring 来源**：saved authoring draft（`.ogs/studio/system.authoring.json`） > `importSystemToAuthoring` 的默认网格 fallback。
  - **前端同-session layout overlay**：仅当 `selectedRunId === studioBridgeLastDryRunId` 且当前页面仍保有该 Build workbench 的 `state.studioBridge.authoring` 时，允许用内存中的 `authoring.layout` 覆盖服务端返回的 `GraphViewModel.layout`。
  - 不新增 "把未保存 workbench 快照传给 `/runs/:id/graph`" 的接口；服务端不承担浏览器内存态判定。禁止直接把 system 反推出的默认网格当 Run 图布局（详见 Phase F）。
- [x] **Build 与 Run 共用同一 X6 canvas**，只通过 mode 切换交互能力；不再维护两套渲染代码路径。

## 3. 不变量 vs. 目标态

分清 "现在就成立" 与 "阶段完成后成立"，避免用当前文档误读现状。

**现在就成立的不变量**：

- `SystemDefinition` 与 `StudioAuthoringDocument` 形状本期不改。
- `client-app.ts` 的字符串渲染主入口本期保留，仅替换其消费的数据形状。
- Phase 执行不破坏 `main` 的任何 legacy 路径（全部通过 feature flag 控制）。

**目标态（阶段完成后成立，当前未成立）**：

- **Phase B 完成后**：语义命令 reducer（`studio-client/studio-graph-commands.ts:231` `applyStudioAuthoringCommand`）成为唯一 mutation 入口；服务端 `/authoring/apply-canvas`（`src/visualizer/server.ts:857`）不再做语义变换，只接收 `{authoring}` 并校验持久化。
- **Phase D 完成后**：undo/redo 从 snapshot 栈升级为语义逆命令栈（snapshot 作为 fallback）；`onApplyCommand` 失败不再污染 undo 栈。
- **Phase E 完成后**：chat-to-MMD 的 `replace-authoring` 仅在阈值 / 根字段场景保留；日常 chat 行为走 semantic patch；`StudioCanvasDocument` 与 chat `canvas` 字段完全删除。

## 4. 风险项

- **Undo/Redo 双栈** — X6 内置 history 已关闭、`studio-client/studio-graph.ts:111-126` 维护自定义 `sharedHistory` / `readonlyHistory`；`onApplyCommand` 失败时 snapshot 已被压栈但状态不回滚（行 873–890）。本期必须修复（Phase D / 可选拆 D0 前置）；在修复前，H / I / G / J 阶段新增的交互路径不得引入新的 snapshot push 点。
- **Run 图布局漂移** — `importSystemToAuthoring()` 默认网格（`src/visualizer/studio-authoring.ts:123`）会覆盖用户已编辑的位置。Phase F 合入前必须先接入 saved authoring draft 读取链路，并明确前端仅对当前 dry-run 命中的 run 应用同-session overlay；否则 Build 调整节点位置后切到 Run Graph 会看到位置漂移。
- **UI framework 诱惑** — `preserveGraphRoot` / `patchStudioBridgePanel` 是补丁信号，但不能作为引入 Preact/Solid 的理由。先做 island 边界（Phase J），再评估。

## 5. 执行顺序（按序推进）

每行对应一个 Phase；按序执行；状态栏维护在 §7。

| 顺序 | Phase | 主题 | 优先级 | 状态 | 依赖 |
|---:|:---:|---|:---:|:---:|---|
| 1 | A | 新增 `GraphViewModel` 类型与工厂 | P1 | completed | — |
| 2 | B | Canvas 折回 `authoring.layout`（仅 deprecate，不删类型） | P1 | completed | — |
| 3 | C | 编辑态渲染器切 `GraphViewModel` | P1 | completed | A、B |
| 4 | H | 单击选中 / 双击（F2）编辑解耦 | **P0** | completed | C |
| 5 | I | 诊断锚定到画布（徽章 + hover card） | **P0** | completed | A、C |
| 6 | G | 三栏稳定布局（outline / canvas / inspector） | **P0** | in_progress | C |
| 7 | J | Studio Bridge island 边界固化（mount once + props） | P1 | pending | C、G |
| 8 | D | 语义 reducer 扩展（batch + inverse + 失败回滚） | P1 | pending | — |
| 9 | F | 运行态渲染统一到 `GraphViewModel`（需先接入 draft 布局） | P1 | pending | A、B、C |
| 10 | E | Chat-to-MMD 语义 patch（完成后删 `replace-authoring` canvas fallback 与 `StudioCanvasDocument`） | P2 | pending | D |
| 11 | K | Minimap + 搜索聚焦 | P2 | pending | C |
| 12 | L1 | 新导航（Design / Run / Release）+ 情境 CTA，挂 `OGS_UI_DESIGN_RUN_RELEASE` flag，保留 legacy | P2 | pending | — |
| 13 | L2 | 灰度后移除 legacy 导航 | P2 | pending | L1 |

**排序理由**：

- 先做图谱模型底座（A → B → C），再叠最低风险高收益的交互修正（H → I → G → J）；
- D 排在 J 之后但 F 之前，是因为 F 需要 batch apply 与失败回滚保护（Run 模式虽然 read-only，但共享 StudioGraphIsland 的 apply 通路）；
- E 排在 D 之后，并承担 `StudioCanvasDocument` 与 chat `canvas` 字段的最终删除动作；
- L 拆两步避免新导航 flag 与 legacy 删除动作冲突。

**可选优化**：如判断 `studio-graph.ts:873–890` 的失败回退 gap 影响 H/I/G/J 阶段稳定性，可从 D 中拆出 **D0**（仅修 gap，无新能力）插到顺序 2，D 重命名为 D1。

## 6. Phase 详表

### 6.1 Phase A — 新增 GraphViewModel 类型与工厂（P1）

**状态**：in_progress（代码落地，回归未完成）。

**已完成**：
- `src/visualizer/studio-contracts.ts` 新增 `GraphViewModel` / `GraphViewModelNode` / `GraphViewModelEdge` 及 `structure / layout / runtime / diagnostics` 4 层类型。
- 新增 `src/visualizer/graph-view-model.ts` 的 `buildGraphViewModel({ authoring, system?, state?, validation?, mode })` 工厂。
  - diagnostic helper（`asDiagnostics` / `findDiagnostic` / `findEdgeDiagnostic`）就地放在本文件内（原因：根 `tsconfig.json` 排除 `studio-client/**`，共享消费需要独立副本）。
- 导出既有 helper：`studio-authoring.ts` 的 `buildBridgeRoles` / `buildBridgeFlows`、`run-graph-projection.ts` 的 `countBranches` / `findLastErrorCode` / `findLastSelectedEvent` / `findLatestFailureForRole` / `buildGraphNodeStatus`。
- 保留 `canvasToStudioGraphProjection` 与 `buildRunGraphView`（Phase C / F 才切换；`StudioCanvasDocument` 的最终删除放到 Phase E）。
- 新增 `tests/visualizer-graph-view-model.test.mjs`（5 用例，覆盖 edit / run / boundary / diagnostic / 空 authoring，全部通过）。
- `pnpm build` 通过；`tsc -p tsconfig.json --noEmit` 与 `tsc -p tsconfig.visualizer-client.json --noEmit` 均无错。

**未完成**：
- 完整回归（`visualizer-studio-authoring` / `client-state` / `client` / `data` / `page-shell` / `visualizer`）上次被中断。下次接续时先跑这组回归，无回归即置 Phase A = completed。

### 6.2 Phase B — Canvas 折回 authoring.layout（P1）

**目标**：`StudioCanvasDocument` 从 "公开中间类型" 降级为 "adapter 内部派生"；服务端从 `/authoring/apply-canvas` 的语义变换中退出，仅接收 `{authoring}` 做校验持久化。**本期不删 `StudioCanvasDocument` 类型**；真正删除放到 Phase E 完成后。

**改动**：
- `src/visualizer/studio-contracts.ts` 标记 `StudioCanvasDocument` `@deprecated`（注释 "removed after Phase E"）。
- `src/visualizer/studio-client/studio-graph-adapter.ts` 新增 `graphToAuthoringLayoutPatch(graph, authoring): StudioAuthoringDocument["layout"]`；保留 `graphToCanvasDocument` 但内部走 layout patch 再拼 canvas 壳（Phase E 前保留，供 chat 路径 fallback）。
- `studio-graph-commands.ts:231` `applyStudioAuthoringCommand` 内 `canvas` 从输入变为派生（`authoringToCanvasDocument(authoring)`）。
- `src/visualizer/client-app.ts` 约 4612 行 `applyStudioGraphCanvasPatch(canvas)` — 本地先 `applyCanvasDocumentToAuthoring({authoring, canvas})`，仅向服务端发 `{authoring}`。
- `src/visualizer/server.ts:857` apply-canvas 处理器 — 接受 `{authoring}`；`canvas` 字段兼容读取但忽略。服务端不再从 canvas 推导 authoring，只校验并持久化客户端提交的 authoring。

**Tests**：更新 `tests/visualizer-studio-authoring.test.mjs` 预期；新增 `server` 端集成测试覆盖 "发 authoring / 发 canvas / 同时发" 三种 payload 的兼容性。

### 6.3 Phase C — 编辑态渲染器切 GraphViewModel（P1，依赖 A、B）

**改动**：
- `src/visualizer/studio-client/studio-graph-adapter.ts:48` 删除 `canvasToStudioGraphProjection`，改调 `buildGraphViewModel({ authoring, validation, mode: "edit" })`。
- `src/visualizer/studio-client/studio-graph.ts` 与 `studio-graph-render.ts` 的 prop 类型从 `StudioGraphProjection` 全部换成 `GraphViewModel`；字段迁移：`node.x/y/width/height → node.layout.*`、`severity → diagnostic?.severity`。
- `src/visualizer/studio-contracts.ts` 合并本 Phase 时**删除 `StudioGraphProjection` 导出**；`StudioCanvasDocument` 保留 `@deprecated`（待 Phase E 删）。
- feature flag `OGS_GRAPH_VIEWMODEL=1` 灰度上线，稳定后默认开启。

**Tests**：更新 `tests/visualizer-client-state.test.mjs` / `tests/visualizer.test.mjs` 字段名断言；`tests-e2e/visualizer-studio-graph.spec.ts` 选择器沿用。

### 6.4 Phase H — 单击选中 / 双击（F2）编辑解耦（P0，依赖 C）

**目标**：选中 ≠ 编辑；避免鼠标失手就弹表单。

**改动**：
- `src/visualizer/studio-client/studio-graph.ts` `bindGraphEvents`
  - `node:click` / `edge:click` 不再调用 `openEditRoleForm` / `openEditEdgeForm`，仅驱动选中态。
  - 新增 `node:dblclick` / `edge:dblclick` 进入编辑；`graph.bindKey(["f2"])` 触发当前选中项的编辑。
  - `edge:connected` 拖拽完成后仍旧 pop add-edge 表单（不变），但允许工具栏 "稍后编辑" 跳过。
  - `editSelectionRequest` 机制保留，仅由用户显式触发（工具栏 ✎ / F2 / inspector）。
- `src/visualizer/studio-client/styles.ts` 选中态描边与 hover 态区分。
- `client-app.ts` inspector 在选中后仅显示只读摘要；编辑入口改为 inspector 顶部 "Edit" 按钮（与 F2 等价）。

**Tests**：新增 `tests-e2e/visualizer-studio-graph-select-edit.spec.ts`（单击不开表单 / 双击开 / F2 开 / blank-click 关）。

### 6.5 Phase I — 诊断锚定到画布（P0，依赖 A、C）

**目标**：把 `validation.diagnostics` 从 "面板列表" 升级为 "画布上可见"。诊断数据已在 `GraphViewModel` 里（Phase A 已映射 roleId / flowKey / selector），本 Phase 只做渲染表达。

**改动**：
- `src/visualizer/studio-client/studio-graph-render.ts`
  - 读取 `node.diagnostic` / `edge.diagnostic` 在节点右上角 / 边 label 旁绘 badge（error = 红、warning = 黄）。
  - 新增 `node:mouseenter` hover card：阻塞原因、缺失输入、最近失败码、等待 review 原因、loop 次数（字段来自 `node.runtime` + `node.diagnostic`）。
  - boundary 节点不渲染 diagnostic 层（与 Phase A 保持一致）。
- `src/visualizer/studio-client/styles.ts` 新增 `.studio-graph-diagnostic-card` 样式（dark theme，圆角，max-width 320px）。
- 可选：inspector 的 diagnostic 分区加 "定位到画布" 按钮，点击 `centerCell` + 短暂 focus 动画（复用既有 `focusMotionTimer`）。

**Tests**：`tests-e2e/visualizer-studio-graph-diagnostics.spec.ts` 截图对比 badge 位置；`tests/visualizer-graph-view-model.test.mjs` 已覆盖 viewmodel 层映射。

### 6.6 Phase G — 三栏稳定布局（P0，依赖 C）

**目标**：消掉 `selection overlay` 的 `open / docked / collapsed` 三态，换成固定三栏。

**改动**：
- `src/visualizer/page-shell-template.ts` Build 区域改为：左 outline（`studio-bridge-index`）/ 中 canvas / 右 inspector。默认全展开；小屏（<1280px）时 inspector 折叠为抽屉。
- `src/visualizer/client-app.ts` 删除 `studioSelectionDialogOpen / Docked / Collapsed` 三元状态（约 70+ 处引用），改为 `studioInspectorCollapsed: boolean`。
- `src/visualizer/client-renderers.ts` `renderStudioGraphCanvas` / `renderStudioBridgePanel` 简化：不再生成 overlay dialog，直接输出三栏骨架。
- `src/visualizer/page-shell-styles.ts` `.studio-canvas-shell.has-docked-selection.has-collapsed-selection` 系列 class 收敛成 `.studio-workbench-grid[data-layout="three-column"|"canvas-only"]`。

**Tests**：`tests-e2e/visualizer-build-layout.spec.ts` 更新选择器；新增 `tests/visualizer-page-shell.test.mjs` 用例覆盖三栏骨架渲染。

### 6.7 Phase J — Studio Bridge island 边界固化（P1，依赖 C、G）

**目标**：消掉 `preserveGraphRoot` / `patchStudioBridgePanel` 的手工 DOM 保护补丁，让 Studio Graph 做真正的 "mount once + props update"。延续 `studio-graph.js` 已有的静态资源模式，**不**引入新框架。

**改动**：
- `src/visualizer/client-app.ts`
  - `renderStudioBridge({ preserveGraphRoot })` 删除；`patchStudioBridgePanel` 删除。
  - Build 面板初次挂载时 `new StudioGraphIsland(root, ...)`，后续仅调 `island.update(nextProps)`。
  - outline / inspector 走独立 render，互不破坏对方 DOM。
- `src/visualizer/studio-client/studio-graph.ts` 若有 "options 局部替换" 逻辑，改为整个 options 对象不可变更新。
- 验证点：`renderStudioBridge` 触发 10 次后，`StudioGraphIsland` 实例不变、X6 graph 实例不变。

**Tests**：`tests/visualizer-client-state.test.mjs` 新增 mount 计数断言。

### 6.8 Phase D — 语义 reducer 扩展（P1）

**目标**：让命令 reducer 能承担 chat semantic patch 与逆命令撤销两种新用法，同时修复失败回退 gap。

**改动**：
- `src/visualizer/studio-client/studio-graph-commands.ts`
  - 新增 `{ type: "batch"; commands: StudioAuthoringCommand[] }`：原子 apply，任一步 `blockedCode` 整体回退并返回首个失败。
  - 新增 `deriveInverseCommand(authoring, command): StudioAuthoringCommand | null`：按类型给逆（delete-role ↔ add-role 带捕获字段；update-* 捕获原值；add-edge ↔ delete-edge 等）。
  - 副作用边界：`add-role` 带 `profileDraft` / `toolDraft` / `repositoryRoleId` 的返回 `null`，由调用方降级走 snapshot 回放，UI 层 toast 提示 "已保留执行配置草稿"。
- `src/visualizer/studio-client/studio-graph.ts`
  - 修复失败回退 gap（约 873–890 行）：`pushUndoSnapshot()` 移到 `onApplyCommand` resolve 之后；reject 不压栈。
  - 新增逆命令栈，置于 feature flag `OGS_SEMANTIC_UNDO=1` 后；snapshot 栈作为 fallback（inverse 为 null 时走 snapshot）。

**Tests**：新增 `tests/visualizer-studio-commands-batch.test.mjs`：batch 原子性、双向 inverse、snapshot fallback、副作用降级。

### 6.9 Phase F — 运行态渲染统一到 GraphViewModel（P1，依赖 A、B、C）

**目标**：Build 与 Run 共用同一张 X6 canvas，通过 mode 切换交互能力。Run 图布局权威来源见 §2 锁定决策。

**Runtime layout authority** 分两层：

1. **Server authority**（`/runs/:id/graph` 内部）：
   - saved authoring draft（`.ogs/studio/system.authoring.json`，通过 `loadStudioAuthoringDraft`）
   - `importSystemToAuthoring(system)` 的默认网格 fallback（仅当 draft 不存在时）
2. **Client overlay**（仅当前页面、当前 dry-run 命中的 run）：
   - 仅当 `selectedRunId === studioBridgeLastDryRunId`
   - 且 `state.studioBridge.authoring` 存在
   - 且当前页面仍保有该 Build workbench 的 authoring 快照
   - 才用该快照里的 `authoring.layout` 覆盖服务端返回的 `GraphViewModel.layout`

不做的事：

- 不新增 "把未保存 workbench 快照传给 `/runs/:id/graph`" 的接口
- 不让服务端承担浏览器内存态布局判定
- 不对历史 run 应用 workbench overlay

禁止直接把 `importSystemToAuthoring` 的默认网格当作 Run 图的权威布局 — 否则 Build 调整节点位置后切到 Run 会看到位置漂移。

**改动**：
- `src/visualizer/run-graph-projection.ts:140` 删除 `buildRunGraphView`；`inspectRunGraphVisualization` 外层签名保留，内部按 **Server authority** 解析 authoring，再调 `buildGraphViewModel({ authoring, system, state, mode: "run" })`。
- `src/visualizer/client-renderers.ts:2232` 删除 `renderRunTopologySvg` 与 `renderWorkbenchTopologySvg`；`client-app.ts:255` 内联引用清理。
- `src/visualizer/client-app.ts` 的 `operate-tabpanel-graph` 挂载 `StudioGraphIsland` read-only 模式：
  - `capabilities.editable = false`
  - 允许：平移 / 缩放 / 节点边选中 + Inspector 展示 runtime 字段
  - 禁止：画布编辑、连线、命令表单（`openEditRoleForm` / `openEditEdgeForm` read-only 下短路）
- `src/visualizer/client-app.ts` 在 mount read-only `StudioGraphIsland` 前，仅对命中的当前 dry-run（`selectedRunId === studioBridgeLastDryRunId`）使用 `state.studioBridge.authoring.layout` 覆盖 `graphPayload` 中的 layout；历史 run 不做 overlay。
- `src/visualizer/studio-client/studio-graph-render.ts` runtime 层驱动节点描边 / 填色 / 徽章；复用并扩展 `deriveStudioRuntimeVisualState`。

**Tests**：`tests/visualizer.test.mjs` 的 run-graph HTML 快照改为 `GraphViewModel` 断言；`tests-e2e/visualizer-build-layout.spec.ts` 运行态 tab 静态 SVG 选择器换为 X6 节点选择器；**新增 E2E**：
- 当前 dry-run：Build 调整节点位置但未保存 → 切到 Run Graph → 节点坐标与 Build 一致
- 历史 run：不使用当前 workbench overlay，只使用 draft 或 fallback

### 6.10 Phase E — Chat-to-MMD 语义 patch（P2，依赖 D）

**改动**：
- `src/visualizer/studio-chat-to-mmd.ts:66` `authoringPatch` 联合：
  - `{ type: "commands"; commands: StudioAuthoringCommand[]; source: "nl2mmd" }`
  - `{ type: "replace-authoring"; authoring; source: "nl2mmd" }`（fallback，**移除 canvas 字段**）
- 新增 `diffAuthoringToCommands(prev, next): StudioAuthoringCommand[]`：role 级 diff → add/update/delete-role；flow 级 diff → add/update/delete-edge。
- **Fallback 规则**：
  - diff 产生的命令数 > **20** 条 → `replace-authoring`
  - `system.entryRoleId` / `systemId` / `systemVersion` 变化 → `replace-authoring`（本期命令集不支持 `set-system-meta`）
- `src/visualizer/client-app.ts` chat apply 路径：`type === "commands"` 时调用 `applyStudioAuthoringCommand` 的 batch；`replace-authoring` 保持现路径但不再消费 `canvas`。
- `nl2mmd/index.ts` 本期不动（diff 在 visualizer 侧完成）。
- **收尾动作**（E 合入完成后一起做）：
  - 删除 `src/visualizer/studio-contracts.ts` 的 `StudioCanvasDocument` 导出。
  - 删除 `studio-graph-adapter.ts` 的 `graphToCanvasDocument`（保留 `graphToAuthoringLayoutPatch`）。
  - 确认 run graph、chat fallback、tests、legacy payload compatibility 全部改为 authoring-only 后，再删 `StudioCanvasDocument`。
  - 清理所有剩余的 `canvas:` 字段引用。

**Tests**：扩展 `tests/visualizer-studio-authoring.test.mjs`：小量 diff → commands、超阈值 → replace、根字段变 → replace、apply 后 authoring 等价；新增回归：chat 生成带 canvas 字段的 legacy payload 能被忽略且不崩。

### 6.11 Phase K — Minimap + 搜索聚焦（P2，依赖 C）

**改动**：
- `src/visualizer/studio-client/studio-graph.ts` 引入 `@antv/x6-plugin-minimap`（已在依赖里）或手写轻量 minimap；放置在画布右下角。
- outline 列表点击角色 → 画布 `centerCell` + focus 动画（复用 `focusMotionTimer`）。
- 新增 `Cmd/Ctrl+P` 快捷键：打开 role / flow 快速搜索面板，回车即 center。

**Tests**：`tests-e2e/visualizer-studio-graph-navigation.spec.ts` 覆盖 minimap 可见性、搜索跳转。

### 6.12 Phase L1 — 新导航（Design / Run / Release）+ 情境 CTA（P2）

**目标**：新导航上线，legacy 路径**保留**并通过 `OGS_UI_DESIGN_RUN_RELEASE` flag 控制默认开关。本 Phase 不做 legacy 清理。

**改动**：
- `src/visualizer/client-shell-controls.ts` `renderConsoleTabsHtml`
  - **保留** `consoleTab === "legacy"` 分支和 legacy tab 集合。
  - 当 `OGS_UI_DESIGN_RUN_RELEASE=1` 时一级 tab 渲染 **Design / Run / Release** 三项；否则维持现状。
  - `Project` 的初始化能力并入 Design 的空态。
- `src/visualizer/page-shell-template.ts` 顶部动作按情境切换（仅 flag 开启时生效）：
  - Design：主 CTA `Validate`、次 `Save`，隐藏 Resume / Stop。
  - Run：根据当前 run 状态切 `Resume` 或 `Stop`，次 `Reindex`。
  - Release：主 CTA `Export`。
- `refresh` 收到设置面板；`locale-select` / workdir pill 收到 "项目菜单"。
- `client-app.ts` `getVisibleConsolePanelIds` / `getOperatePanelId` 重构，依赖现有 operate sub-tab 设计。

**Tests**：`tests/visualizer-client-state.test.mjs` 新增 flag 开 / 关两种路径的断言；`tests-e2e/visualizer-build-layout.spec.ts` 路由与 CTA 可见性更新（flag 开）；legacy spec 保留。

### 6.13 Phase L2 — 移除 legacy 导航（P2，依赖 L1）

**前置条件**：L1 合入后观察 ≥1 个版本，无回滚压力；`OGS_UI_DESIGN_RUN_RELEASE` 默认开启 ≥1 周。

**改动**：
- `src/visualizer/client-shell-controls.ts` 删除 `consoleTab === "legacy"` 分支与 `legacyTabs` 集合。
- `src/visualizer/client-app.ts` 删除 `legacyConsoleTab` 相关状态字段与路由分支。
- `OGS_UI_DESIGN_RUN_RELEASE` flag 下线。
- legacy spec 删除。

**Tests**：`tests-e2e/visualizer-build-layout.spec.ts` 最终收敛为单一路径；`tests/visualizer-client-state.test.mjs` 删除 flag 分支断言。

## 7. 进度状态

> 每完成一个 Phase 就更新 §5 的状态栏 + 这一段 "当前状态" 部分。

**当前位置**：Phase G in_progress（2026-05-13）。

- **已完成**：Phase A / B / C / H / I 已落地。编辑态已切到 `GraphViewModel`；`/authoring/apply-canvas` 已改为仅提交 `{authoring}`；单击仅选中、双击/F2 才编辑；诊断徽章与 hover card 已锚到画布。
- **本次已验证**：
  - `pnpm build`
  - `node --test tests/visualizer-client-state.test.mjs tests/visualizer-studio-authoring.test.mjs tests/visualizer.test.mjs`
  - `node --test tests/visualizer-page-shell.test.mjs`
  - `node --test --test-name-pattern="visualizer client opens Studio Bridge and keeps authoring affordances on the graph shell|visualizer client keeps the right-side shell mounted when switching between graph and source views" tests/visualizer-client.test.mjs`
- **未完成**：Phase G 还在收尾，`client-app.ts` 内仍保留 legacy `selection overlay` / `preserveGraphRoot` 状态流；Phase J / D / F / E / K / L1 / L2 尚未开始。

**下次 session 接续动作**（按序）：

1. 收敛 `client-app.ts` 的 `studioSelectionDialogOpen / Docked / Collapsed` 到固定三栏 inspector 状态
2. 删除 `patchStudioBridgePanel` / `preserveGraphRoot` 补丁路径，验证 mount-once（Phase J）
3. 跑 `tests/visualizer-client.test.mjs` 的 Studio Bridge 相关全量子集，补 mount 计数断言
4. 继续 Phase D（batch / inverse / undo failure rollback）

## 8. Out of Scope

- Preact / Solid / lit 等响应式框架迁移（详见 §4 风险项）。
- `SystemDefinition` / `StudioAuthoringDocument` 形状变更。
- 服务端 nl2mmd 原生输出 commands（本期 diff 在 visualizer 侧）。
- X6 内置 History 复活。
- `ops-summary-projection.ts` / `project-projection.ts`（未耦合本次 5 层表示）。
- Runtime 模式下的 timeline scrubber / 回放（F 期只落 Inspector，时间回放留待后续立项）。

## 9. Feature Flags

| Flag | 覆盖 Phase | 默认 | 说明 |
|---|---|---|---|
| `OGS_GRAPH_VIEWMODEL` | C、F | 关 → 灰度 → 开 | 编辑态与运行态切换到 GraphViewModel |
| `OGS_SEMANTIC_UNDO` | D | 关 | 逆命令栈；关闭时走 snapshot fallback |
| `OGS_UI_DESIGN_RUN_RELEASE` | L1、L2 | 关 → 灰度 → 开 → 下线（L2 删除 legacy 后） | 新导航；并行跑 legacy 至少一个版本 |

每阶段合入后 flag 默认关，冒烟通过后翻开；下一阶段开始前，只清理已被当前阶段完全替代、且不再被后续灰度或兼容路径依赖的旧代码。

## 10. Verification

每阶段合入时都执行：

1. **类型与单测**
   - `pnpm exec tsc -p tsconfig.json --noEmit`
   - `pnpm exec tsc -p tsconfig.visualizer-client.json --noEmit`
   - `node --test tests/visualizer-graph-view-model.test.mjs tests/visualizer-studio-commands-batch.test.mjs tests/visualizer-studio-authoring.test.mjs tests/visualizer-client-state.test.mjs tests/visualizer.test.mjs`
2. **E2E**
   - `pnpm test:e2e tests-e2e/visualizer-studio-graph.spec.ts tests-e2e/visualizer-build-layout.spec.ts`
   - Phase H / I / K 增配对应 spec。
3. **手动冒烟**（Phase C、F、G、H、I 必做）
   - `ogs project create demo --template minimal && cd demo && ogs vis --workdir .`
   - Build：新增角色、连边、校验、保存、undo/redo 20 步以内。
   - Chat ✦：小改动（<20 条 diff）走 commands；大改动走 replace-authoring。
   - 触发一次 dry run；切到 Operate → Graph：确认用同一张 X6 图、Inspector 展示 runtime 字段。
   - **Phase F 专项**：Build 调整一个节点位置 → 保存 → 切到 Run Graph → 确认该节点坐标与 Build 完全一致（Runtime layout authority 验证）。
4. **回归**
   - `L2` 之前的所有 Phase：关闭所有 feature flag，确认 legacy 路径仍可用（至少一个版本）。
   - `L2` 及之后：确认 legacy 入口、legacy tab、legacy route 分支已完全移除；`?lifecycle=legacy` 被规范化到 `Run`，且不会导致空白页或 JS error。
   - `pnpm test:e2e` 全量。
   - `scripts/console-print.mjs` 巡检浏览器控制台无新 warning。

## 11. 关键文件索引

- `src/visualizer/studio-contracts.ts` — 类型定义（A、B、C、E）
- `src/visualizer/graph-view-model.ts` — 新增工厂（A）
- `src/visualizer/studio-authoring.ts:115 / :266 / :301 / :405` — `importSystemToAuthoring` / `authoringToCanvasDocument` / `applyCanvasDocumentToAuthoring` / `serializeAuthoringToMermaid`
- `src/visualizer/studio-client/studio-graph-adapter.ts:48 / :150` — canvas 投影与 layout patch（B、C、E）
- `src/visualizer/studio-client/studio-graph-commands.ts:231` — reducer 入口（B、D）
- `src/visualizer/studio-client/studio-graph.ts:111, 286, 373, 873–890, 917, 967` — history 栈、graph 构造、事件绑定、失败 gap（D、H）
- `src/visualizer/studio-client/studio-graph-render.ts` — X6 渲染（C、F、I）
- `src/visualizer/run-graph-projection.ts:140` — 运行投影（F 删除；需接入 draft 读取）
- `src/visualizer/client-renderers.ts:2232` — 静态 SVG（F 删除）
- `src/visualizer/studio-chat-to-mmd.ts:66` — patch 形状（E）
- `src/visualizer/server.ts:857` — apply-canvas 处理器（B）
- `src/visualizer/page-shell-template.ts` / `page-shell-styles.ts` — 顶栏与 Build 骨架（G、L1、L2）
- `src/visualizer/client-shell-controls.ts` — console tabs / run sidebar 可见性（L1、L2）
- `src/visualizer/client-app.ts` — 约 255 / 1990–2100 / 2290–2590 / 3168–3330 / 4612 行：studio bridge 渲染、selection overlay、chat apply、canvas apply、operate-tabpanel-graph 挂载（B、C、F、G、H、J）
