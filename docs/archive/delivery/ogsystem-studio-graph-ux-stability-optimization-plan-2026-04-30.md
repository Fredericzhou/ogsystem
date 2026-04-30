# OGSystem Studio Graph UX Stability Optimization Plan

Date: 2026-04-30
Status: proposed
Scope: Studio Graph / X6 Graph Island 的交互稳定性、编辑体验、role 仓库选择、模型能力校验和页面模块化优化。

Product boundary: 本方案只升级 Studio Graph 的可视化编辑体验和前置解释能力，不改变 OGSystem runtime/parser/compiler 的执行语义；所有运行仍以生成并校验后的 `system.mmd` 为准。

## 1. Problem Statement

当前 Studio Graph 已切到真实 X6 Graph Island，但用户操作后仍会出现整块刷新和闪烁。根因不是 X6 本身，而是 shell 每次选择、编辑、保存、校验后重建 Studio Bridge DOM，再重新 mount graph，导致：

- 画布实例被销毁或重建，视口、选中态、拖拽态和端口 hover 态丢失。
- 新增 role / edge 后需要等待外层刷新，用户感知为闪烁或短暂空白。
- 编辑能力散落在 toolbar、inspector、command handler 和 authoring command 中，容易重复建设。
- 新增 role 只支持简单生成，缺少从 role 仓库选择、能力约束、字段编辑和非法输入提示。
- 新增 edge 主要是图上连线，缺少按 source / target / event / join / model capability 的预校验和解释。

优化目标不是再做一个图编辑器，而是在现有 truth 分层上把 Graph Island 变成稳定、可增量更新、可校验的编辑工作区。

## 2. Goals

1. 消除常规操作闪烁：选择节点、选择边、新增 role、新增 edge、移动节点、undo/redo 不重建整页 DOM，不重建 X6 实例。
2. 保持唯一事实源：`StudioAuthoringDocument` 仍是 authoring truth，`system.mmd` 仍是 runtime truth，X6 cells 只作为视图投影。
3. 新增 role 支持两条路径：
   - 从 role 仓库选择已有 role package。
   - 自定义 role，并在提交前完成 roleId、binding、model/profile、能力约束校验。
4. 新增 edge 支持可解释编辑：
   - 图上 port 拖拽连线。
   - 右侧 inspector 或弹框编辑 source、target、eventType、runtime error flow、join 参与状态。
5. 校验前移：在用户提交前提示非法 role、非法 event、非法连接、模型/执行能力不匹配、join source 缺失、review/route/loop 约束冲突。
6. 页面模块化：Graph Canvas、Navigator、Inspector、Command Forms、Validation Hints、Persistence Bridge 拆分，避免重复渲染和重复状态。

## 3. Non-Goals

- 不让 runtime、parser、compiler import X6。
- 不把 X6 cell JSON 持久化为项目真相。
- 不绕过 Mermaid validation / Studio authoring command 直接写 `system.mmd`。
- 不引入独立数据库或前端状态框架。
- 不在 Run Debug 只读图里暴露编辑能力。

## 4. Target Architecture

```text
Visualizer shell
  ├─ Studio Bridge data loader
  ├─ StudioGraphWorkspace
  │   ├─ StudioGraphIsland (stable X6 instance)
  │   ├─ StudioGraphNavigator
  │   ├─ StudioGraphInspector
  │   ├─ StudioGraphCommandDialog
  │   └─ StudioGraphValidationHints
  └─ StudioGraphController
      ├─ local draft state
      ├─ command reducer
      ├─ validation adapter
      └─ persistence adapter
```

关键边界：

- X6 Graph Island 只在 root 首次 mount 时创建。后续只调用 `island.update(options)`，内部首选 id-based upsert/remove 增量同步。
- 不把 `fromJSON` 作为常规更新路径。它容易重置 selection、viewport、history 和事件状态，只能作为首次初始化或无法增量修复的兜底路径。
- 外层 shell 不再因为 selection 变化调用 `renderWorkbench()` 重建 Studio Bridge。
- selection、pending command、inspector draft、viewport 保存在 StudioGraphController 内部。
- 保存、生成 MMD、dry-run 仍通过现有 Visualizer API 和 `applyStudioAuthoringCommand()`。
- Run Debug 不直接复用完整编辑型 controller。它复用底层 readonly X6 renderer/projection renderer，外面包独立 readonly controller，避免编辑 toolbar、undo stack、command state 泄漏到运行态只读图。

## 5. Prerequisite Worktree Gate

开始本方案任何实现任务前，必须先处理当前工作区已有改动，避免把未验证的历史修改混入 UX 稳定性重构。

执行要求：

- 检查 `git status -sb`，确认是否存在已修改或未跟踪文件。
- 重点审查当前已修改的 visualizer 文件，例如：
  - `src/visualizer/client-app.ts`
  - `src/visualizer/client-renderers.ts`
  - `src/visualizer/page-shell.ts`
  - `src/visualizer/studio-client/studio-graph.ts`
- 对这些已有改动执行必要的 diff review，确认它们属于已完成任务、用户手动修改，还是本方案的前置依赖。
- 若改动应保留，必须先完成对应测试、回归和提交。
- 若改动与本方案无关但尚未完成，必须单独记录 owner / follow-up，不能混入本方案提交。
- 不允许在未确认来源和意图的情况下 revert 当前工作区改动。
- 本方案实施前，工作区必须达到干净状态，或仅保留本方案文档自身的已确认改动。

Exit criteria:

- `git status -sb` 无未解释的 modified/untracked source 文件。
- 现有 visualizer 改动已被单独提交，或已明确记录为用户保留的未提交改动。
- 后续 Phase 0/1/2/3 的代码提交只包含对应阶段的 scoped changes。

## 6. Flicker Fix

### 6.1 Stable Mount

当前应避免这些路径触发整块刷新：

- `onSelectRole`
- `onSelectFlow`
- `onClearSelection`
- `onApplyCanvas`
- `onApplyCommand`
- undo / redo

推荐改法：

- `renderStudioBridge()` 只负责首次绘制 workspace shell。
- Graph Island mount 后由 controller 更新 inspector DOM，而不是重建整个 workbench body。
- `mountStudioX6Bridge(root, options)` 必须保持 WeakMap 实例复用；`update()` 内部不得重置 toolbar DOM。
- `renderStudioGraphProjection()` 从“清空全部 cells 后重建”改为基于 id 的增量 upsert：
  - 已存在节点更新 position/attrs/data。
  - 新节点 add。
  - 缺失节点 remove。
  - 边同理按 stable edge id upsert/remove。

### 6.2 Optimistic Local State

新增 role / edge 时：

1. 先在 controller 中生成 next authoring/canvas。
2. 本地立即 update graph 和 inspector。
3. 后台触发 Mermaid validation。
4. validation 返回后只更新 diagnostics overlay，不重建图。

失败时：

- 命令级失败不改变 authoring，toast + inspector inline error。
- validation 失败保留 draft，但禁用 save/dry-run，并在节点/边上显示 warning/error。
- server 拒绝或网络失败时，保留本地 draft，并显示 `unsynced` 状态；用户可以重试、撤销或放弃 draft。
- validation 请求必须携带递增 `requestId`。只接受最新 requestId 的结果，过期 validation 只记录调试日志，不更新 UI。
- save/generate/dry-run 前必须 flush pending canvas patch 和 pending command，确保提交的是 controller 最新 draft。
- 离开页面、切换项目或关闭 tab 前，如果存在 dirty/unsynced draft，必须提示用户确认。
- 后端返回 authoritative validation 失败时不自动回滚用户 draft；只阻断持久化动作，并把诊断落到 inspector 和 graph overlay。

### 6.3 Conflict And Sync Rules

并发和冲突处理规则：

- 每次本地 command 都生成 `draftVersion`。
- 每次 validation 请求包含 `draftVersion` 和 `requestId`。
- 返回结果的 `draftVersion` 与当前 draft 不一致时丢弃。
- `onApplyCanvas` 使用 debounce 合并 node move，拖动一次最多形成一个 undo step。
- controller 维护 `clean | dirty | validating | valid | invalid | unsynced` 状态，用于 toolbar、save/dry-run 按钮和用户提示。

### 6.4 Debounced Persistence

移动节点、批量 layout、连续编辑字段时只更新本地 draft：

- node move: 200-300ms debounce 后写 canvas draft。
- field edit: blur 或 submit 时 apply command。
- save/generate/dry-run: 明确按钮触发持久化。

## 7. Role Creation UX

新增 role 应使用一个统一 command form，可放在右侧 inspector，也可在空间不足时使用 modal。表单分两段：

### 7.1 Select From Role Repository

字段：

- role package 搜索。
- roleId 默认来自 package，可编辑但必须唯一。
- title / summary 只读预览。
- allowedEvents / input schema / output schema 预览。
- supported binding kind：model / exec / noop。
- 推荐 model/profile，从现有 binding resolution 或 role package metadata 中读取。

提交前校验：

- roleId 不为空，匹配 Mermaid role id 规则。
- roleId 未重复。
- role package 存在且健康。
- required files / schema 完整。
- 如果选择 model binding，必须能解析模型引用。
- 如果选择 exec/profile binding，必须能解析 profile。

### 7.2 Custom Role

字段：

- roleId。
- title。
- bindingKind：model / exec / noop。
- modelRef 或 profileId。
- allowedEvents。
- output schema path，可选。
- review / join / route / loop 高级项默认折叠。

提交前校验：

- modelRef/profileId 与 bindingKind 匹配。
- allowedEvents 至少包含常用成功事件，默认 `DONE`。
- review / route / join / loop 组合不冲突。
- 自定义 role 标记为 project-local draft，保存前明确提示需要补齐 role package 或接受 noop/custom 状态。

## 8. Edge Creation UX

新增 edge 支持两种入口：

- 画布 port 拖拽。
- inspector/dialog 中选择 source role、target role、eventType。

统一 edge form 字段：

- sourceRoleId。
- targetRoleId，包含 `output/end`。
- eventType。
- runtimeOnlyErrorFlow。
- participatesInJoin。
- contract/schema coverage 提示。

提交前校验：

- source/target 均存在，且不能从 output/start 非法连出。
- 不能自环，除非显式 loop 语义允许并已配置 loop max。
- eventType 不为空，优先来自 source role allowedEvents。
- eventType 不在 source allowedEvents 中时，允许高级 override，但必须显示 warning。
- target 是 join role 时，提示是否同步 join.sources。
- runtime-only error flow 必须使用 runtime error event 约定。
- 重复边需要合并或阻止，避免同 source/event/target 重复。

## 9. Model Capability Validation

校验来源分层：

```text
role package metadata
  -> allowedEvents / schema / capability hints
binding resolution
  -> effective model/profile/provider
model capability catalog
  -> tool use / structured output / context limit / multimodal / streaming
project readiness
  -> missing binding / contract coverage / dry-run blockers
```

浏览器端只做 fast preflight 和字段级提示，不复制 runtime/compiler 的权威语义。authoritative validation 仍由 server/parser/compiler/project readiness 输出。

前端可以即时判断：

- 空字段、重复 id、明显非法 endpoint。
- 当前 DTO 已提供的 allowedEvents / role package health / binding resolution。
- 当前表单内能确定的 capability hint。

前端不能自行决定：

- runtime 语义是否合法。
- compiler 最终是否接受 Mermaid。
- join/loop/review/contract 的完整权威结论。

新增 diagnostic DTO 应统一为：

```ts
type StudioDiagnosticDto = {
  source: "client-preflight" | "server-validation" | "parser" | "compiler" | "readiness" | "capability";
  severity: "info" | "warning" | "error";
  fieldPath?: string;
  roleId?: string;
  flowKey?: string;
  code: string;
  messageKey: string;
  vars?: Record<string, unknown>;
};
```

需要新增或复用的诊断类型：

- `ROLE_ID_INVALID`
- `ROLE_ID_DUPLICATED`
- `ROLE_PACKAGE_UNHEALTHY`
- `ROLE_BINDING_UNRESOLVED`
- `MODEL_CAPABILITY_MISMATCH`
- `EDGE_ENDPOINT_INVALID`
- `EDGE_EVENT_UNSUPPORTED`
- `EDGE_DUPLICATED`
- `JOIN_SOURCE_MISSING`
- `LOOP_REQUIRES_MAX`
- `CONTRACT_COVERAGE_MISSING`

UI 表达：

- 阻断项：表单 submit disabled，并显示具体修复字段。
- 警告项：允许提交 draft，但 save/dry-run 前继续提示。
- 信息项：只显示 capability hint，不阻止。

## 10. Module Boundaries

建议新增或重构为以下模块：

```text
src/visualizer/studio-client/
  studio-graph-workspace.ts
  studio-graph-controller.ts
  studio-graph-inspector.ts
  studio-graph-command-forms.ts
  studio-graph-validation.ts
  studio-graph-repository-picker.ts
```

职责：

- `studio-graph.ts`: X6 instance lifecycle、事件绑定、增量渲染。
- `studio-graph-controller.ts`: selection、draft、command dispatch、undo/redo。
- `studio-graph-command-forms.ts`: add/edit role、add/edit edge 的纯表单渲染和 input validation。
- `studio-graph-validation.ts`: 前端轻量校验，消费后端 readiness/binding/role package 投影。
- `studio-graph-repository-picker.ts`: role package 列表、搜索、选择，不直接改 authoring。
- `studio-graph-readonly.ts`: Run Debug 只读图 wrapper，只持有 selection/viewport，不持有 authoring command、undo stack 或编辑 toolbar。

避免重复：

- toolbar 不再直接拼 command 细节，只派发 `openCommand("add-role")` 等意图。
- inspector 和 modal 使用同一 form schema。
- add role / edit role 共享同一校验器。
- add edge / edit edge / port drag 共享同一 command builder。

## 11. Implementation Phases

### Phase 0: Stabilize Rendering

Phase 0 必须是纯稳定性任务，不引入 role repository、capability validation 或新 command forms，避免一次性扩大回归面。

- 保持 Graph Island root 稳定，不因 selection 重建 DOM。
- X6 projection 改增量 upsert。
- selection 更新 inspector 局部 DOM。
- 移动节点 debounce，同步 canvas 不闪烁。
- 保持 viewport zoom/translate，除非用户显式 fit/layout。
- undo/redo、node move 合并和 selection 更新不触发 full workbench render。

Exit criteria:

- 选择节点/边不触发 X6 remount。
- 现有新增 role/edge 命令执行后 graph root DOM identity 不变。
- 现有新增 role/edge 命令执行后视口不跳回默认。
- undo/redo 不闪烁。
- Playwright 截图无空白画布帧。
- node move debounce 后只发一次 apply-canvas。

### Phase 1: Unified Command Forms

- 新增 role dialog/inspector form。
- 新增 edge dialog/inspector form。
- port drag 打开 edge confirm form，而不是直接提交不可解释命令。
- 表单 submit 前执行本地 validation。

Exit criteria:

- role 可从 repository 选择或自定义。
- edge 可拖拽或表单创建。
- 所有非法输入都有字段级提示。

### Phase 2: Capability-Aware Validation

- 后端投影增加 role package、binding resolution、model capability 摘要。
- 前端 validation adapter 合并 Studio validation / readiness / capability diagnostics。
- 节点和边 overlay 显示 severity。

Exit criteria:

- 未解析模型/profile 不能提交阻断型 role。
- unsupported event 显示 warning 或阻断，取决于配置。
- join/loop/contract 缺口在 edge 编辑时可见。

### Phase 3: Modular Cleanup

- 删除旧的重复 toolbar/form handler。
- 把 inspector、forms、validation hints 从 `client-app.ts` 中抽出。
- Run Debug 只读图复用底层 readonly X6 renderer/projection renderer，使用独立 readonly wrapper，不挂编辑 controller。

Exit criteria:

- `client-app.ts` 不再承载大段 Studio 表单逻辑。
- Studio Graph 相关测试可按 controller/form/validation 分层。
- i18n 文案都通过 shell 注入 labels 或 Visualizer dictionary。

## 12. i18n And Persistence Rules

Studio Graph 新增 UI 文案必须走 Visualizer dictionary：

- toolbar labels。
- command forms。
- repository picker。
- validation hints。
- toast/confirm/dialog title。
- readonly Run Debug graph status。

X6 bundle 不直接 import `src/visualizer/i18n/**`，由 shell 注入 `labels` 或 renderer options。

持久化规则：

- roleId、flowId、eventType 等机器字段不随 locale 改变。
- 默认 title 不应把 “New role” 等 locale 文案写入 `StudioAuthoringDocument`。优先保持 title 为空或用 roleId；用户显式确认 title 后才持久化。
- `t()` 不负责 HTML escape。所有写入 HTML 的表单输入、diagnostic vars 和 i18n 字符串必须继续走 `escapeText` / DOM textContent。
- server diagnostic DTO 使用 `messageKey + vars`，由前端按当前 locale 渲染；原始 `message` 只作为 fallback/debug。

## 13. Accessibility And Performance

Accessibility:

- dialog 必须有 focus trap。
- Esc 关闭非提交型 dialog。
- Delete/Backspace 删除选中项，Ctrl/Cmd+Z undo，Ctrl/Cmd+Shift+Z redo。
- toolbar button 使用可本地化 `aria-label` 和 `title`。
- 字段错误与 input 通过 `aria-describedby` 关联。

Performance:

- 增量更新时使用 X6 batch/freeze-unfreeze 或 requestAnimationFrame 合并渲染。
- 大图虚拟化暂不纳入本轮，但记录阈值：超过 200 nodes 或 500 edges 时进入性能告警和降级评估。
- node move undo history 要 coalesce，拖动一次只产生一个 semantic undo step。
- projection diff 使用 stable node id / edge id，避免因 label 或 badge 变化重建 cell。

## 14. Test Plan

Unit tests:

- controller command reducer：add/edit/delete role、add/edit/delete edge、undo/redo。
- validation：重复 role、非法 endpoint、unsupported event、missing binding、model capability mismatch。
- form schema：repository role 和 custom role 字段校验。
- i18n key parity。

Client tests:

- selection 不调用 full `renderWorkbench()`。
- add role 后 X6 mount call 不增加。
- add edge 后保留 selected role/flow 和 viewport。
- invalid role/edge 显示 inline error，不写 draft。
- selection 不增加 `mountStudioX6Bridge` 调用次数。
- add role/edge 后 graph root DOM identity 不变。
- 非 fit/layout 操作后 viewport zoom/translate 不变。
- node move debounce 后只发一次 apply-canvas。
- stale validation response 不更新 diagnostics。
- save/generate/dry-run 前 flush pending draft。

Browser tests:

- port drag 触发 edge form，确认后图中出现边。
- repository picker 选择 role package 后新增节点。
- custom role 输入非法 model/profile 时 submit disabled。
- 连续拖动节点无闪烁，无空白 canvas。
- undo/redo 更新 authoring draft，并保留 graph root。
- Playwright 截图检查 canvas/cell count 始终非零。
- Run Debug readonly graph 不暴露编辑 toolbar command，也不共享 Studio editor undo stack。

Regression:

- `pnpm run build`
- `pnpm run test:visualizer`
- `pnpm run test:visualizer-browser`
- `pnpm test`

## 15. User Testing, UX Optimization, And Validation

本方案不能只以“技术可运行”为完成标准。每个阶段完成后都必须补充面向真实用户路径的体验验证，确保 Studio Graph 对 system.mmd 可视化编辑的提升是可感知、可理解、可恢复的。

### 15.1 User Journey Smoke

至少覆盖以下核心路径：

- 首次打开 Studio Graph，画布、toolbar、inspector、诊断区信息完整且无明显跳动。
- 用户从现有项目进入，选择 role、选择 edge、清空选择，画布不闪烁，右侧信息响应及时。
- 用户新增 role，能在提交前理解 roleId、binding、model/profile、allowed events 的要求。
- 用户新增 edge，能理解 source、target、eventType、join、runtime error flow 的含义和风险。
- 用户拖动节点、缩放画布、撤销/重做后，视口、选中态和图内容保持稳定。
- 用户遇到非法输入或 validation 失败时，能知道错误位置、原因和下一步修复动作。
- 用户保存、生成 MMD、dry-run 前，能明确当前 draft 是否 dirty、validating、invalid 或 unsynced。
- Run Debug 图视图始终表现为只读，不出现编辑入口、编辑 toolbar 或编辑 undo/redo 行为。

### 15.2 UX Quality Bar

每个阶段必须检查并优化以下体验细节：

- 常用操作路径不依赖用户理解内部术语；必要术语必须有本地化解释或字段级提示。
- 操作反馈不打断工作流：阻断错误 inline 显示，非阻断风险以 warning/hint 显示，避免频繁弹窗。
- toolbar 不重复暴露同类动作；主操作、次操作、危险操作有清晰层级。
- inspector 优先展示当前选择对象的可操作信息，低频高级项默认折叠。
- 空状态、加载中、验证中、无权限、无诊断、无可用 role package 等状态都有明确文案。
- PC 端和窄屏布局都不能出现按钮挤压、内容重叠、图视图过长导致相邻区域大面积空白的问题。
- 所有新增 UI 文案、aria label、placeholder、错误提示、状态说明都必须同步 i18n。
- 不把本地化默认文案持久化为机器字段或用户未确认的 authoring 内容。

### 15.3 Product Validation Gate

Phase 0 之后必须完成一次轻量用户测试或等价走查：

- 由非实现者按 user journey smoke 跑完整路径。
- 记录每个路径的成功/失败、卡点、误解点、闪烁/跳动截图或录屏。
- 对高频路径中的明显体验问题先修复，再进入下一阶段。
- 对不阻断本阶段目标的问题建立 follow-up，不混入当前阶段扩大范围。

Phase 1/2 之后必须增加可解释性验证：

- 用户能否在不查看源码或文档的情况下创建 role / edge。
- 用户能否理解 validation hint 的严重级别和修复建议。
- 用户能否区分前端 preflight、server validation、readiness、compiler/parser 返回的问题。
- 中文和英文界面都必须完成一次核心路径检查，避免中英混杂和术语未翻译。

### 15.4 Evidence Required

每个阶段交付记录中必须包含：

- 已跑的自动化命令和结果。
- Playwright/browser smoke 覆盖说明。
- 至少一组桌面端截图或录屏结论，证明画布非空、无明显闪烁、布局无重叠。
- i18n key parity 或等价检查结果。
- 已知 UX follow-up 列表，并标注是否阻断当前阶段发布。

## 16. Acceptance Criteria

Product acceptance:

- 用户新增 role/edge 后画布不闪烁。
- 用户能在提交前知道为什么某个 role/edge 不合法。
- 用户能从 role 仓库选择并创建可运行的节点。
- 用户能看到模型/profile/contract/join 的风险提示。
- 生成的 `system.mmd` 与现有 runtime 兼容。
- Run Debug 始终只读。

Engineering acceptance:

- Studio Graph 常规操作无明显闪烁，X6 instance 不重复创建。
- selection 不增加 `mountStudioX6Bridge` 调用次数。
- add role/edge 后 graph root DOM identity 不变。
- 非 fit/layout 操作后 viewport zoom/translate 不变。
- Playwright 截图无空白 canvas，且 canvas/cell count 始终非零。
- node move debounce 后只发一次 apply-canvas。
- 新增 role 支持 repository 选择和 custom 输入。
- 新增 edge 支持 port drag 和表单编辑。
- 所有阻断型非法输入在提交前可见。
- 模型/profile/capability 不匹配有明确提示。
- 前端 preflight 与 server authoritative validation 分层清晰，diagnostic DTO 带 `source/severity/fieldPath/code/messageKey/vars`。
- 页面结构模块化，Graph、Inspector、Forms、Validation 不再互相重建。
- Run Debug 图视图保持只读，不暴露编辑入口，不共享编辑 controller/undo stack。
- 文档、用例、手册同步更新并通过全量回归。
