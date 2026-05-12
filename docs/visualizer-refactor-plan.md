# Visualizer 收敛与 UX 重构执行计划

> 唯一执行入口。按 §3 顺序执行，每 Phase 独立可回滚。
> 历史参照：commit 历史中 `docs/visualizer-graph-convergence-tasks.md` 与 `docs/ogsystem-visualizer-architecture-ux-review-2026-05-12.md`（已于本次合并后删除）。

## 1. Context

`src/visualizer/` 当前问题**三件事叠加**：

1. **前端装配单体化** — `client-app.ts` 6200+ 行 + `buildClientAppScript()` 字符串注入 + `function.toString()` 内联；仅 `studio-graph.js` 已独立为静态资源。
2. **图谱渲染投影重复翻译** — 编辑态走 X6，运行态走静态 SVG；同一张图的 "正在执行 / 等待审核 / join 阻塞" 在两侧各写一遍。
3. **交互过于打断** — 单击即编辑 / selection overlay 三态（open / docked / collapsed）/ Build 与 Operate 的 graph 不共享心智模型。

**共识结论（已锁定）**：

- 三层图谱真理层**保留不动**：`SystemDefinition`（运行内核真理）/ `StudioAuthoringDocument`（编辑真理）/ `StudioCanvasDocument`（布局真理）— 前两者形状不改，`StudioCanvasDocument` 按本期规划折回 `authoring.layout`。
- 真正要收敛的是**渲染投影层**：把 `StudioGraphProjection` + `RunGraphView` 合成单一 `GraphViewModel`（4 层：structure / layout / runtime / diagnostics），编辑态与运行态共用同一组件。
- Undo/Redo 走**语义 command reducer + 派生快照**，不切回 X6 内置 History。
- Chat-to-MMD 改为**语义 patch**（沿用既有命令集 `add-role / update-edge / set-review-policy` 等），不做全量替换，不走原始 JSON Patch。
- 产品形态向 **Design / Run / Release** 三视图收敛，CTA 按情境切换。
- **本期不引入** Preact / Solid 等响应式库，先稳住渲染边界再评估。

## 2. 不变量

- `SystemDefinition` 与 `StudioAuthoringDocument` 形状本期不改。
- 语义命令 reducer（`studio-client/studio-graph-commands.ts:231` `applyStudioAuthoringCommand`）是唯一 mutation 入口。
- 服务端只做校验 + 持久化，不承担 command 语义。
- `client-app.ts` 的字符串渲染主入口本期保留，仅替换它消费的数据形状。

## 3. 执行顺序（按序推进）

每行对应一个 Phase；按序执行；状态栏维护在 §5。

| 顺序 | Phase | 主题 | 优先级 | 状态 | 依赖 |
|---:|:---:|---|:---:|:---:|---|
| 1 | A | 新增 `GraphViewModel` 类型与工厂 | P1 | in_progress（代码已落地，回归未完成） | — |
| 2 | D | 语义 reducer 扩展（batch + inverse + 失败回滚） | P1 | pending | — |
| 3 | B | Canvas 折回 `authoring.layout` | P1 | pending | — |
| 4 | C | 编辑态渲染器切 `GraphViewModel` | P1 | pending | A、B |
| 5 | H | 单击选中 / 双击（F2）编辑解耦 | **P0** | pending | C |
| 6 | I | 诊断锚定到画布（徽章 + hover card） | **P0** | pending | A、C |
| 7 | G | 三栏稳定布局（outline / canvas / inspector） | **P0** | pending | C |
| 8 | F | 运行态渲染统一到 `GraphViewModel` | P1 | pending | A、C |
| 9 | J | Studio Bridge island 边界固化（mount once + props） | P1 | pending | C、G |
| 10 | E | Chat-to-MMD 语义 patch | P2 | pending | D |
| 11 | K | Minimap + 搜索聚焦 | P2 | pending | C |
| 12 | L | 导航扁平化到 Design / Run / Release + 情境 CTA | P2 | pending | — |

> 注：Review 结论的 P0 在本排序中排在第 5–7 位 — 排序规则是 "先把图谱模型收敛（A–C、F）做实，再动交互/布局（H、I、G、J）"，避免对正在重构的底座做 UX 重排。P0/P1/P2 仅作价值标注保留。

## 4. Phase 详表

### 1. Phase A — 新增 GraphViewModel 类型与工厂（P1）

**状态**：in_progress（代码落地，回归未完成）。

**已完成**：
- `src/visualizer/studio-contracts.ts` 新增 `GraphViewModel` / `GraphViewModelNode` / `GraphViewModelEdge` 及 `structure / layout / runtime / diagnostics` 4 层类型。
- 新增 `src/visualizer/graph-view-model.ts` 的 `buildGraphViewModel({ authoring, system?, state?, validation?, mode })` 工厂。
  - diagnostic helper（`asDiagnostics` / `findDiagnostic` / `findEdgeDiagnostic`）就地放在本文件内（原因：根 `tsconfig.json` 排除 `studio-client/**`，共享消费需要独立副本）。
- 导出既有 helper：`studio-authoring.ts` 的 `buildBridgeRoles` / `buildBridgeFlows`、`run-graph-projection.ts` 的 `countBranches` / `findLastErrorCode` / `findLastSelectedEvent` / `findLatestFailureForRole` / `buildGraphNodeStatus`。
- 保留 `canvasToStudioGraphProjection` 与 `buildRunGraphView`（Phase C / F 才切换 / 删除）。
- 新增 `tests/visualizer-graph-view-model.test.mjs`（5 用例，覆盖 edit / run / boundary / diagnostic / 空 authoring，全部通过）。
- `pnpm build` 通过；`tsc -p tsconfig.json --noEmit` 与 `tsc -p tsconfig.visualizer-client.json --noEmit` 均无错。

**未完成**：
- 完整回归（`visualizer-studio-authoring` / `client-state` / `client` / `data` / `page-shell` / `visualizer`）上次被中断。下次接续时先跑这组回归，无回归即置 Phase A = completed。

### 2. Phase D — 语义 reducer 扩展（P1，独立于 A）

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

### 3. Phase B — Canvas 折回 authoring.layout（P1）

**目标**：`StudioCanvasDocument` 从 "公开中间类型" 降级为 "adapter 内部细节"，为 Phase C 直接删除铺路。

**改动**：
- `src/visualizer/studio-contracts.ts` 标记 `StudioCanvasDocument` `@deprecated`（注释 "removed after Phase C"）。
- `src/visualizer/studio-client/studio-graph-adapter.ts` 新增 `graphToAuthoringLayoutPatch(graph, authoring): StudioAuthoringDocument["layout"]`；保留 `graphToCanvasDocument` 但内部走 layout patch 再拼 canvas 壳。
- `studio-graph-commands.ts:231` `applyStudioAuthoringCommand` 内 `canvas` 从输入变为派生（`authoringToCanvasDocument(authoring)`）。
- `src/visualizer/client-app.ts` 约 4612 行 `applyStudioGraphCanvasPatch(canvas)` — 本地先 `applyCanvasDocumentToAuthoring({authoring, canvas})`，仅向服务端发 `{authoring}`。
- `src/visualizer/server.ts:1724` apply-canvas 处理器 — 接受 `{authoring}`；`canvas` 字段兼容读取但忽略。

**Tests**：更新 `tests/visualizer-studio-authoring.test.mjs` 预期。

### 4. Phase C — 编辑态渲染器切 GraphViewModel（P1，依赖 A、B）

**改动**：
- `src/visualizer/studio-client/studio-graph-adapter.ts:48` 删除 `canvasToStudioGraphProjection`，改调 `buildGraphViewModel({ authoring, validation, mode: "edit" })`。
- `src/visualizer/studio-client/studio-graph.ts` 与 `studio-graph-render.ts` 的 prop 类型从 `StudioGraphProjection` 全部换成 `GraphViewModel`；字段迁移：`node.x/y/width/height → node.layout.*`、`severity → diagnostic?.severity`。
- `src/visualizer/studio-contracts.ts` 合并本 Phase 时**直接删除** `StudioCanvasDocument` / `StudioGraphProjection` 导出。
- feature flag `OGS_GRAPH_VIEWMODEL=1` 灰度上线，稳定后默认开启。

**Tests**：更新 `tests/visualizer-client-state.test.mjs` / `tests/visualizer.test.mjs` 字段名断言；`tests-e2e/visualizer-studio-graph.spec.ts` 选择器沿用。

### 5. Phase H — 单击选中 / 双击（F2）编辑解耦（P0，依赖 C）

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

### 6. Phase I — 诊断锚定到画布（P0，依赖 A、C）

**目标**：把 `validation.diagnostics` 从 "面板列表" 升级为 "画布上可见"。

**改动**：
- `src/visualizer/studio-client/studio-graph-render.ts`
  - 读取 `node.diagnostic` / `edge.diagnostic` 在节点右上角 / 边 label 旁绘 badge（error = 红、warning = 黄）。
  - 新增 `node:mouseenter` hover card：阻塞原因、缺失输入、最近失败码、等待 review 原因、loop 次数（字段来自 `node.runtime` + `node.diagnostic`）。
  - boundary 节点不渲染 diagnostic 层（与 Phase A 保持一致）。
- `src/visualizer/studio-client/styles.ts` 新增 `.studio-graph-diagnostic-card` 样式（dark theme，圆角，max-width 320px）。
- 可选：inspector 的 diagnostic 分区加 "定位到画布" 按钮，点击 `centerCell` + 短暂 focus 动画（复用既有 `focusMotionTimer`）。

**Tests**：`tests-e2e/visualizer-studio-graph-diagnostics.spec.ts` 截图对比 badge 位置；`tests/visualizer-graph-view-model.test.mjs` 已覆盖 viewmodel 层映射。

### 7. Phase G — 三栏稳定布局（P0，依赖 C）

**目标**：消掉 `selection overlay` 的 `open / docked / collapsed` 三态，换成固定三栏。

**改动**：
- `src/visualizer/page-shell-template.ts` Build 区域改为：左 outline（`studio-bridge-index`）/ 中 canvas / 右 inspector。默认全展开；小屏（<1280px）时 inspector 折叠为抽屉。
- `src/visualizer/client-app.ts` 删除 `studioSelectionDialogOpen / Docked / Collapsed` 三元状态（约 70+ 处引用），改为 `studioInspectorCollapsed: boolean`。
- `src/visualizer/client-renderers.ts` `renderStudioGraphCanvas` / `renderStudioBridgePanel` 简化：不再生成 overlay dialog，直接输出三栏骨架。
- `src/visualizer/page-shell-styles.ts` `.studio-canvas-shell.has-docked-selection.has-collapsed-selection` 系列 class 收敛成 `.studio-workbench-grid[data-layout="three-column"|"canvas-only"]`。

**Tests**：`tests-e2e/visualizer-build-layout.spec.ts` 更新选择器；新增 `tests/visualizer-page-shell.test.mjs` 用例覆盖三栏骨架渲染。

### 8. Phase F — 运行态渲染统一到 GraphViewModel（P1，依赖 A、C）

**改动**：
- `src/visualizer/run-graph-projection.ts:140` 删除 `buildRunGraphView`；`inspectRunGraphVisualization` 外层签名保留，内部改为 `buildGraphViewModel({ authoring: importSystemToAuthoring(...), system, state, mode: "run" })`。
- `src/visualizer/client-renderers.ts:2232` 删除 `renderRunTopologySvg` 与 `renderWorkbenchTopologySvg`；`client-app.ts:255` 内联引用清理。
- `src/visualizer/client-app.ts` 的 `operate-tabpanel-graph` 挂载 `StudioGraphIsland` read-only 模式：
  - `capabilities.editable = false`
  - 允许：平移 / 缩放 / 节点边选中 + Inspector 展示 runtime 字段
  - 禁止：画布编辑、连线、命令表单（`openEditRoleForm` / `openEditEdgeForm` read-only 下短路）
- `src/visualizer/studio-client/studio-graph-render.ts` runtime 层驱动节点描边 / 填色 / 徽章；复用并扩展 `deriveStudioRuntimeVisualState`。

**Tests**：`tests/visualizer.test.mjs` 的 run-graph HTML 快照改为 `GraphViewModel` 断言；`tests-e2e/visualizer-build-layout.spec.ts` 运行态 tab 静态 SVG 选择器换为 X6 节点选择器。

### 9. Phase J — Studio Bridge island 边界固化（P1，依赖 C、G）

**目标**：消掉 `preserveGraphRoot` / `patchStudioBridgePanel` 的手工 DOM 保护补丁，让 Studio Graph 做真正的 "mount once + props update"。

**改动**：
- `src/visualizer/client-app.ts`
  - `renderStudioBridge({ preserveGraphRoot })` 删除；`patchStudioBridgePanel` 删除。
  - Build 面板初次挂载时 `new StudioGraphIsland(root, ...)`，后续仅调 `island.update(nextProps)`。
  - outline / inspector 走独立 render，互不破坏对方 DOM。
- `src/visualizer/studio-client/studio-graph.ts` 若有 "options 局部替换" 逻辑，改为整个 options 对象不可变更新。
- 验证点：`renderStudioBridge` 触发 10 次后，`StudioGraphIsland` 实例不变、X6 graph 实例不变。

**Tests**：`tests/visualizer-client-state.test.mjs` 新增 mount 计数断言。

### 10. Phase E — Chat-to-MMD 语义 patch（P2，依赖 D）

**改动**：
- `src/visualizer/studio-chat-to-mmd.ts:66` `authoringPatch` 联合：
  - `{ type: "commands"; commands: StudioAuthoringCommand[]; source: "nl2mmd" }`
  - `{ type: "replace-authoring"; authoring; canvas; source: "nl2mmd" }`（fallback）
- 新增 `diffAuthoringToCommands(prev, next): StudioAuthoringCommand[]`：role 级 diff → add/update/delete-role；flow 级 diff → add/update/delete-edge。
- **Fallback 规则**：
  - diff 产生的命令数 > **20** 条 → `replace-authoring`
  - `system.entryRoleId` / `systemId` / `systemVersion` 变化 → `replace-authoring`（本期命令集不支持 `set-system-meta`）
- `src/visualizer/client-app.ts` chat apply 路径：`type === "commands"` 时调用 `applyStudioAuthoringCommand` 的 batch；`replace-authoring` 保持现路径。
- `nl2mmd/index.ts` 本期不动（diff 在 visualizer 侧完成）。

**Tests**：扩展 `tests/visualizer-studio-authoring.test.mjs`：小量 diff → commands、超阈值 → replace、根字段变 → replace、apply 后 authoring 等价。

### 11. Phase K — Minimap + 搜索聚焦（P2，依赖 C）

**改动**：
- `src/visualizer/studio-client/studio-graph.ts` 引入 `@antv/x6-plugin-minimap`（已在依赖里）或手写轻量 minimap；放置在画布右下角。
- outline 列表点击角色 → 画布 `centerCell` + focus 动画（复用 `focusMotionTimer`）。
- 新增 `Cmd/Ctrl+P` 快捷键：打开 role / flow 快速搜索面板，回车即 center。

**Tests**：`tests-e2e/visualizer-studio-graph-navigation.spec.ts` 覆盖 minimap 可见性、搜索跳转。

### 12. Phase L — 导航扁平化到 Design / Run / Release + 情境 CTA（P2）

**改动**：
- `src/visualizer/client-shell-controls.ts` `renderConsoleTabsHtml`
  - 删除 `consoleTab === "legacy"` 分支和 legacy tab 集合。
  - 一级 tab 合并为 **Design / Run / Release** 三项；`Project` 的初始化能力并入 Design 的空态。
- `src/visualizer/page-shell-template.ts` 顶部动作按情境切换：
  - Design：主 CTA `Validate`、次 `Save`，隐藏 Resume / Stop。
  - Run：根据当前 run 状态切 `Resume` 或 `Stop`，次 `Reindex`。
  - Release：主 CTA `Export`。
- `refresh` 收到设置面板；`locale-select` / workdir pill 收到 "项目菜单"。
- `client-app.ts` `getVisibleConsolePanelIds` / `getOperatePanelId` 重构，依赖现有 operate sub-tab 设计。

**Tests**：`tests/visualizer-client-state.test.mjs` 与 `tests-e2e/visualizer-build-layout.spec.ts` 路由与 CTA 可见性更新。

## 5. 进度状态

> 每完成一个 Phase 就更新 §3 的状态栏 + 这一段 "当前状态" 部分。

**当前位置**：Phase A in_progress（2026-05-13）。

- **已完成**：Phase A 的代码、类型、新测试全部落地；`pnpm build` 通过；新测试 5/5 过。
- **未完成**：扩展回归（`visualizer-studio-authoring` / `client-state` / `client` / `data` / `page-shell` / `visualizer`）被中断，未跑完。

**下次 session 接续动作**（按序）：

1. `pnpm build`
2. `node --test tests/visualizer-graph-view-model.test.mjs tests/visualizer-studio-authoring.test.mjs tests/visualizer-client-state.test.mjs`（先跑最相关的 3 个，快）
3. 若全过，把 §3 的 Phase A 状态改为 completed，开始 **Phase D**（§4 第 2 项）
4. 若发现回归，优先修；回归多半来自导出函数重命名或 `studio-contracts.ts` 的类型新增触发既有消费者的 strict 检查

## 6. Out of Scope

- Preact / Solid / lit 等响应式框架迁移。
- `SystemDefinition` / `StudioAuthoringDocument` 形状变更。
- 服务端 nl2mmd 原生输出 commands（本期 diff 在 visualizer 侧）。
- X6 内置 History 复活。
- `ops-summary-projection.ts` / `project-projection.ts`（未耦合本次 5 层表示）。
- Runtime 模式下的 timeline scrubber / 回放（F 期只落 Inspector，时间回放留待后续立项）。

## 7. Feature Flags

| Flag | 覆盖 Phase | 默认 | 说明 |
|---|---|---|---|
| `OGS_GRAPH_VIEWMODEL` | C、F | 关 → 灰度 → 开 | 编辑态与运行态切换到 GraphViewModel |
| `OGS_SEMANTIC_UNDO` | D | 关 | 逆命令栈；关闭时走 snapshot fallback |
| `OGS_UI_DESIGN_RUN_RELEASE` | L | 关 | 新导航；并行跑 legacy 至少一个版本 |

每阶段合入后 flag 默认关，冒烟通过后翻开，下一阶段开始前清理旧代码。

## 8. Verification

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
4. **回归**
   - 关闭所有 feature flag 确认 legacy 路径仍可用（至少一个版本）。
   - `pnpm test:e2e` 全量。
   - `scripts/console-print.mjs` 巡检浏览器控制台无新 warning。

## 9. 关键文件索引

- `src/visualizer/studio-contracts.ts` — 类型定义（A、B、C）
- `src/visualizer/graph-view-model.ts` — 新增工厂（A）
- `src/visualizer/studio-authoring.ts:115 / :266 / :301 / :405` — `importSystemToAuthoring` / `authoringToCanvasDocument` / `applyCanvasDocumentToAuthoring` / `serializeAuthoringToMermaid`
- `src/visualizer/studio-client/studio-graph-adapter.ts:48 / :150` — canvas 投影与 layout patch
- `src/visualizer/studio-client/studio-graph-commands.ts:231` — reducer 入口（D）
- `src/visualizer/studio-client/studio-graph.ts:111, 286, 373, 873–890, 917, 967` — history 栈、graph 构造、事件绑定、失败 gap（D、H）
- `src/visualizer/studio-client/studio-graph-render.ts` — X6 渲染（C、F、I）
- `src/visualizer/run-graph-projection.ts:140` — 运行投影（F 删除）
- `src/visualizer/client-renderers.ts:2232` — 静态 SVG（F 删除）
- `src/visualizer/studio-chat-to-mmd.ts:66` — patch 形状（E）
- `src/visualizer/server.ts:1724` — apply-canvas 处理器（B）
- `src/visualizer/page-shell-template.ts` / `page-shell-styles.ts` — 顶栏与 Build 骨架（G、L）
- `src/visualizer/client-shell-controls.ts` — console tabs / run sidebar 可见性（L）
- `src/visualizer/client-app.ts` — 约 255 / 1990–2100 / 2290–2590 / 3168–3330 / 4612 行：studio bridge 渲染、selection overlay、chat apply、canvas apply、operate-tabpanel-graph 挂载（B、C、F、G、H、J）
