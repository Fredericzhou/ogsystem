# OGSystem Studio Lifecycle Platform Optimization Plan

Date: 2026-04-30
Status: completed
Scope: 将当前按 tab 分散组织的 Visualizer / Studio 能力，升级为覆盖投产前 Build 与投产后 Operate 的一体化生命周期平台，并以真实 X6 Graph Island 为可视化编排中心。

Product boundary: 本方案优化 Studio / Visualizer 的产品信息架构、可视化编排、配置、调试、发布和监控体验，不改变 OGSystem runtime/parser/compiler 的执行语义；运行事实仍以生成并校验后的 `system.mmd` 和 runtime 事件为准。X6 继续只作为 Studio view layer，不进入内核。

## 1. Product Positioning

目标产品形态是 **OGSystem Studio Lifecycle Platform**。

它不是一组互不相关的监控 tab，而是一个从投产前到投产后的统一工作台：

```text
Build before production
  Create project -> Visual authoring -> Configure -> Debug -> Package / export

Operate after production
  Select released project -> Monitor runs -> Audit -> Diagnose -> Resume / recover
```

核心原则：

- 以项目生命周期组织能力，而不是按数据面板堆叠 tab。
- 采用 Graph-first lifecycle workspace：X6 是编排、调试和运行理解的主上下文，但不是唯一界面。
- 配置、校验、调试、发布和运行监控都锚定到当前 graph entity，再由 Inspector、Bottom panel 和列表完成细节承载。
- Build 与 Operate 共享视觉语言，但编辑态和运行态边界清晰。
- Studio authoring truth 仍是 `StudioAuthoringDocument`，runtime truth 仍是 `system.mmd`。
- Runtime graph 只读；Build graph 可编辑。

## 2. Mature Product Benchmarks

OGSystem Studio 不应照搬单一成熟产品。更合理的对标组合是：

```text
LangGraph Studio: agent graph debugging
n8n / Node-RED: graph-first visual authoring
Airflow / Dagster / Prefect: workflow observability
Temporal: durable execution, recovery, auditability
```

运行时参考原则：

- 对标 LangGraph Studio：agent graph 调试应以图为主上下文，执行路径、节点状态、trace、失败位置和节点详情需要能从 graph selection 进入。
- 对标 n8n / Node-RED：可视化编排应采用 graph-first，但不能 graph-only；palette / object list、canvas、inspector、debug/sidebar 应协同工作。
- 对标 Airflow / Dagster / Prefect：投产后观测需要 run list / grid / logs / timeline / metadata 等可扫描界面，graph 负责结构、依赖和状态理解，不承载所有监控明细。
- 对标 Temporal：恢复、重试、暂停、终止、review decision 和 audit trail 必须围绕 durable execution 与可追溯操作记录设计。

对 OGSystem 的产品结论：

- X6 graph 是主工作面，负责结构关系、运行路径、异常定位和状态 overlay。
- Inspector 负责选中实体的配置、详情和动作。
- Bottom panel 负责 diagnostics、timeline、logs、readiness 和 audit trail。
- 左侧 lifecycle / object list / search 负责导航、扫描和批量定位。
- Graph-first 不等于把所有复杂表单、日志和审计明细塞进节点；节点和边只显示最高优先级 badge、状态摘要和定位入口。
- Build / Debug / Runtime 必须是不同 mode，共享投影数据但不共享编辑 controller、command state 或 undo stack。

## 3. Current Problems

当前可视化控制台主要按 tab 独立组织，导致：

- 编排、配置、调试、监控和审计割裂，用户需要在多个 tab 间来回切换。
- X6 图谱仍偏“局部编辑工具”，没有成为项目配置、调试和运行理解的主工作区。
- 投产前路径不完整：新建项目、配置校验、调试、打包导出之间缺少明确流程。
- 投产后路径不完整：运行监控、审计、故障诊断、恢复决策之间缺少统一上下文。
- 专业信息分散在 summary、readiness、logs、graph、state 等区域，用户难以判断下一步动作。
- `client-app.ts` 承载过多 shell、render、state、run debug 和 workbench 逻辑，后续扩展成本高。

## 4. Target Information Architecture

第一轮不采用 `Project | Build | Debug | Release | Operate | Audit` 六个一级入口。更稳的产品信息架构是四个一级入口：

```text
Project | Build | Validate & Release | Operate
```

各区域职责：

- Project: 项目创建、模板选择、项目元信息、环境选择。
- Build: X6 可视化编排、role / edge 配置、binding、contract、schema、model/profile 配置，并内置 Edit / Dry Run / Debug 模式。
- Validate & Release: 生成 `system.mmd`、readiness checklist、release manifest、digest、reports、打包导出和 release candidate。
- Operate: 已投产项目运行监控、run list、运行态只读图、logs、failure、resume readiness、audit trail。

降级规则：

- Debug 不做一级入口，而是 Build 内的模式：Edit / Dry Run / Debug。
- Audit 不做一级入口，而是 Operate 内的底部面板或详情面板。
- Release 与 readiness/checklist 合并为 Validate & Release。
- Operate 统一 run list、readonly graph、logs、failure、resume、audit。

推荐工作台布局：

```text
┌─────────────────────────────────────────────────────────────┐
│ Project / Environment / Validation / Primary Actions         │
├───────────────┬───────────────────────────────┬─────────────┤
│ Lifecycle Nav │ X6 Graph Workspace             │ Inspector   │
│               │ Build editable / Operate readonly│ Config    │
├───────────────┴───────────────────────────────┴─────────────┤
│ Diagnostics / Timeline / Logs / Readiness / Audit Trail       │
└─────────────────────────────────────────────────────────────┘
```

设计要求：

- Graph workspace 是第一工作区，不是辅助预览。
- Graph workspace 是主上下文，不是唯一界面；列表、搜索、Inspector 和 bottom panel 必须保留成熟工具所需的可扫描性和批量定位能力。
- Inspector 始终展示当前选中 project / role / edge / run / event 的上下文操作。
- Bottom panel 负责诊断、日志、timeline、readiness、audit，不挤占图谱主空间。
- 顶部 action bar 只放生命周期主动作，避免重复按钮。

## 5. Build Before Production

### 5.1 Create Project

提供 Project Wizard：

- 选择项目模板：basic workflow、review workflow、agent collaboration、tool execution、RAG/legal 等。
- 选择 role package。
- 选择 model/profile。
- 配置 entry role、output、默认 event。
- 生成初始 `StudioAuthoringDocument`。
- 自动进入 Build graph workspace。

验收：

- 用户可以从空项目创建可校验的初始 graph。
- 模板生成内容不绕过 Mermaid / Studio authoring validation。
- 默认文案通过 i18n，不把本地化文本写入机器字段。

### 5.2 Visual Authoring And Configuration

以 X6 为底座强化可视化编排：

- role 节点创建、拖拽、复制、删除。
- edge port 拖拽连接，并进入确认表单。
- 分组、折叠、搜索、定位、mini-map。
- auto layout 与手动布局共存。
- 节点 badge 展示 missing binding、contract missing、capability warning、validation error。
- 边 badge 展示 eventType、runtime error flow、join participation、contract coverage。
- 右侧 inspector 编辑 role、binding、model/profile、contract、schema、review、loop、route。

配置原则：

- 图上动作表达结构关系。
- Inspector 表达选中对象的详细配置。
- Diagnostics 表达当前配置是否可运行。
- Server/parser/compiler/readiness 仍是权威校验来源，前端只做 preflight。

### 5.3 Debug Project

Debug 是 Build 的验证模式，而不是一级入口或孤立监控页：

- 选择 entry role 和输入样例。
- 执行 dry-run / simulation。
- 在 X6 图上高亮执行路径。
- 节点显示 running / done / failed / skipped / waiting review。
- 点击节点查看 input、output、model call、tool call、contract result。
- 底部 timeline/logs/diagnostics 与图选中对象联动。
- 失败节点提供定位、解释和修复建议。

验收：

- 用户能从图上定位失败节点。
- 用户能看到失败来自配置、contract、model capability、runtime error 还是 review 阻塞。
- Debug 不改变 runtime 执行语义。

### 5.4 Validate, Package, And Export

Validate & Release 是投产前最后 gate：

- 生成并校验 `system.mmd`。
- 定义 release manifest / digest / report 数据结构。
- 生成 validation report。
- 生成 readiness report。
- 生成 role package dependency manifest。
- 生成 model/profile/binding summary。
- 生成 contract/schema coverage report。
- 导出 deployable artifact。

发布规则：

- 阻断型 validation/readiness 未通过时，不允许标记 release candidate。
- 非阻断 warning 可以导出，但必须进入 release notes。
- 打包产物必须可追溯到 source project、system.mmd digest、role package digest 和 config digest。

## 6. Operate After Production

### 6.1 Runtime Monitoring

Operate 面向已投产项目：

- 选择 released project / release version / environment。
- 查看 run list、status、duration、failure rate、review pending、resume readiness。
- 使用 readonly X6 runtime graph 展示运行状态。
- 节点显示实时状态：queued、running、done、failed、paused、waiting review。
- 边显示真实 transition 和 event。
- 点击节点查看 runtime detail、logs、artifact、decision trace。

边界：

- Operate graph 只读。
- 不暴露 role/edge 编辑入口。
- 不共享 Build editor controller、command state 或 undo stack。

### 6.2 Audit And Recovery

Audit 负责投产后追踪：

- decision trail。
- human review history。
- model/tool invocation trace。
- config drift。
- artifact snapshot。
- resume / retry / terminate 记录。
- failure summary 和 suggested next checks。

恢复原则：

- Resume readiness 由 server/runtime 侧权威输出。
- Visualizer 只解释状态和引导动作。
- 任何恢复动作都必须留下 audit 记录。

## 7. X6-Centered Studio Architecture

建议分层：

```text
Visualizer Shell
  lifecycle navigation
  project context
  environment context
  i18n
  layout

Studio Workspace
  X6 graph workspace
  inspector
  command forms
  validation hints
  debug panel
  validate release panel
  operate panel
  audit panel

Core Adapters
  authoring command adapter
  validation/readiness adapter
  runtime monitor adapter
  package/export adapter
```

建议模块：

```text
src/visualizer/studio-client/
  studio-workspace.ts
  studio-lifecycle.ts
  studio-graph.ts
  studio-inspector.ts
  studio-command-forms.ts
  studio-debug-panel.ts
  studio-validate-release-panel.ts
  studio-operate-panel.ts
  studio-audit-panel.ts
  studio-validation.ts
```

约束：

- `client-app.ts` 应逐步退化为 shell/bootstrap，不继续承载大段业务渲染。
- X6 只在 `src/visualizer/studio-client/**` 内部使用。
- `src/runtime/**`、parser/compiler 相关模块不得 import X6 或 Visualizer UI。
- Build editable graph 和 Operate readonly graph 可以复用 projection renderer，但 controller 必须隔离。

## 8. User Experience Standards

### 8.1 Navigation

- 用户始终知道自己处于 Project / Build / Validate & Release / Operate 的哪个阶段。
- Debug 通过 Build 内的 mode switch 进入，不打断编排上下文。
- Audit 通过 Operate 的底部面板或详情面板进入，不打断运行监控上下文。
- 主动作与阶段一致：Build 显示 Validate / Dry Run；Validate & Release 显示 Package / Export；Operate 显示 Refresh / Diagnose / Resume。
- 不重复暴露同类按钮。

### 8.2 Graph Workspace

- Graph 占据主视觉区域。
- 长图支持搜索、mini-map、fit、auto layout、分组。
- 选中节点/边后 Inspector 立即更新，不重建整页。
- PC 端避免左右栏高度不均导致大面积空白。
- 窄屏下 Inspector 和 bottom panel 可折叠。

### 8.3 Terminology And i18n

- 所有 UI 文案、placeholder、aria label、状态、错误、empty state 都必须 i18n。
- 专业术语需要本地化解释，例如 contract、binding、readiness、audit、runtime error flow。
- 机器字段如 roleId、eventType、flowKey、modelRef 不随 locale 改变。
- `t()` 只返回文本，HTML escape 由 renderer / DOM textContent 负责。

### 8.4 Accessibility

- Dialog 使用 `role="dialog"`、`aria-modal`、focus trap 和 Esc 关闭。
- Toolbar button 使用本地化 `aria-label`。
- 字段错误通过 `aria-describedby` 关联 input。
- 只读图与编辑图在键盘操作上有明确边界。

## 9. Implementation Roadmap

Completion update (2026-04-30):

- [x] Phase 0: Lifecycle shell / strangler migration is implemented with Project / Build / Validate & Release / Operate, legacy fallback tabs, and query-state deep-link compatibility.
- [x] Phase 1: Build Studio is anchored on the existing real X6 Studio Bridge, with graph-first authoring, inspector/config panels, validation/readiness badges, and role/edge commands.
- [x] Phase 2: Debug Mode remains inside Build via dry-run entrypoints and projects run/debug state onto the runtime graph after execution.
- [x] Phase 3: Validate & Release uses the existing validation/readiness/contracts/role-package/export projections as a release candidate gate without changing runtime/API semantics.
- [x] Phase 4: Operate Workbench groups run list, readonly runtime graph, logs, failure triage, resume readiness, review/audit detail, and artifacts under Operate without exposing Build edit controls.

Validation completed:

- [x] `pnpm run build`
- [x] `pnpm run test:visualizer`
- [x] `pnpm run test:visualizer-browser`
- [x] `pnpm test`

### Phase 0: Lifecycle Shell / Strangler Migration

- 不改 runtime/API。
- 只新增生命周期路由和布局壳。
- 将当前 tab 重组为 Project / Build / Validate & Release / Operate。
- 把现有 Project、Run Debug、Config、Logs、Artifacts 面板重新挂到新区域。
- Debug 先作为 Build 内的 mode slot，Audit 先作为 Operate 内的 panel slot。
- 第一阶段不重写 X6，只重排现有面板和入口。
- `client-app.ts` 开始只负责路由、状态、调度，不继续扩业务 UI。

Exit criteria:

- 用户能按四个生命周期入口找到新建、编排、调试、打包、监控、审计入口。
- 旧 tab 能通过 feature flag 或 fallback route 暂时访问。
- route compatibility 不破坏已有 deep link。
- 现有功能无回归。

### Phase 1: Build Studio

- X6 graph 成为 Build 主区域。
- Inspector 只服务选中 role / edge / project。
- validation/readiness badge 上图。
- 保持现有 API 和 runtime 不变。
- 不急着做 package/release UI。

Exit criteria:

- 用户主要通过 graph 完成编排与配置。
- 新增 role/edge 不需要跨 tab 查找上下文。
- 配置错误能定位到节点、边或字段。

### Phase 2: Debug Mode

- 在 Build 内切 Debug 模式。
- Dry-run / simulation 结果投影到同一个 graph。
- 执行路径、节点状态、失败位置显示在图上。
- Timeline/logs/diagnostics 与图选中对象联动。
- Debug 不成为一级入口。

Exit criteria:

- 用户能从图上理解一次调试执行。
- 用户能定位失败节点并看到修复建议。
- Debug 模式退出后能回到同一 Build graph 上下文。

### Phase 3: Validate & Release

- 先定义 release manifest / digest / report 数据结构。
- 再做 UI checklist 和 export。
- 增加 validation/readiness/contract/model/profile reports。
- 导出 deployable artifact。
- 记录 digest 和 release metadata。
- 避免先做漂亮 release 页但没有稳定 artifact contract。

Exit criteria:

- 用户能完成从可视化编排到投产包导出的闭环。
- 阻断问题不能误发布。
- release artifact contract 有测试覆盖。

### Phase 4: Operate Workbench

- Runtime readonly graph 显示运行状态。
- Run list、metrics、logs、failure、resume readiness、audit trail 统一上下文。
- Resume readiness、review queue、failure diagnostics 进入统一 Operate 工作台。
- Operate 不暴露编辑能力。
- Operate 不共享 Build controller 或 undo stack。

Exit criteria:

- 用户能从投产项目定位失败、查看审计、判断恢复动作。
- Operate readonly graph 不暴露编辑入口。

## 10. Risk Controls

第一轮实施必须按 strangler migration 控制风险：

- Feature flag: 新 lifecycle shell 可通过配置打开，旧 tab shell 保留 fallback。
- Route compatibility: 旧 URL / query-state deep link 继续可用，必要时映射到新 lifecycle route。
- No runtime/API rewrite: Phase 0 不改 runtime、parser、compiler 或 Visualizer API contract。
- Browser smoke gate: 每个阶段必须覆盖核心 lifecycle route、旧 route fallback、真实 X6 非空渲染和 readonly graph 边界。
- Incremental extraction: `client-app.ts` 只做增量瘦身，不在 Phase 0 做大规模文件搬迁。
- Rollback path: 新 shell 出现阻断问题时可回到旧 tab shell。
- i18n parity: 新导航、mode、panel、empty state、error state 必须同步中英文。

## 11. Deferred Vision Items

以下能力属于愿景，不纳入第一轮 shell 改造：

- 独立 Debug 一级入口。
- 独立 Audit 一级入口。
- 完整 release 页面视觉重设计。
- 大规模重写 X6 graph controller。
- 新前端状态框架。
- 新后端部署系统。

这些能力只有在四入口生命周期模型稳定、release artifact contract 明确、Operate readonly workbench 跑通后再评估。

## 12. Superseded Broad Roadmap

以下原始大路线仅作为历史背景，保留用于解释方案收敛前的取舍。不得作为 implementation backlog、任务拆分或排期依据；实际实施只以第 9 节的 Phase 0-4 为准。

### Original Phase 1: Lifecycle IA Reorganization

- 将当前 tab 重组为 Project / Build / Debug / Release / Operate / Audit。
- 保持现有 API 和 runtime 不变。
- 把现有面板重新归位到生命周期阶段。
- 明确 Build editable 与 Operate readonly。

Exit criteria:

- 用户能按生命周期找到新建、编排、调试、打包、监控、审计入口。
- 旧 tab 不再作为主要信息架构。
- 现有功能无回归。

### Original Phase 2: X6-Centered Build Workspace

- 将 role/edge 配置、validation、readiness、inspector 围绕 X6 graph 组织。
- 增强 role/edge command forms。
- 支持更成熟的 graph 操作：复制、分组、搜索、mini-map、批量 layout。
- 统一节点/边 badge 和 diagnostics overlay。

Exit criteria:

- 用户主要通过 graph 完成编排与配置。
- 新增 role/edge 不需要跨 tab 查找上下文。
- 配置错误能定位到节点、边或字段。

### Original Phase 3: Graph-Based Debug

- Dry-run / simulation 与 Build graph 联动。
- 执行路径、节点状态、失败位置显示在图上。
- Timeline/logs/diagnostics 与图选中对象联动。

Exit criteria:

- 用户能从图上理解一次调试执行。
- 用户能定位失败节点并看到修复建议。

### Original Phase 4: Release Gate And Export

- 增加 release checklist。
- 生成 validation/readiness/contract/model/profile reports。
- 导出 deployable artifact。
- 记录 digest 和 release metadata。

Exit criteria:

- 用户能完成从可视化编排到投产包导出的闭环。
- 阻断问题不能误发布。

### Original Phase 5: Operate And Audit Workbench

- Runtime readonly graph 显示运行状态。
- Run list、metrics、logs、audit trail 与 graph 联动。
- Resume readiness、review queue、failure diagnostics 进入统一 Operate/Audit 工作台。

Exit criteria:

- 用户能从投产项目定位失败、查看审计、判断恢复动作。
- Operate 不暴露编辑能力。

## 13. Test And Validation Plan

Regression:

- `pnpm run build`
- `pnpm run test:visualizer`
- `pnpm run test:visualizer-browser`
- `pnpm test`

Browser smoke:

- 新建项目后进入 Build graph。
- Build graph 新增 role / edge。
- 配置错误显示到字段和图 overlay。
- Build Debug mode 中 dry-run 后图上高亮执行路径。
- Validate & Release gate 阻断 invalid project。
- Operate readonly graph 不暴露编辑按钮或 undo stack。
- 旧 tab fallback route 仍可用。
- lifecycle route deep link 兼容 query-state。
- 中文和英文核心路径无混杂文案。

User validation:

- 用户能从空项目完成新建、编排、配置、调试、打包。
- 用户能从已投产项目完成监控、失败定位、审计查看、恢复判断。
- 用户能理解 Build 与 Operate 的区别。
- 用户能理解专业术语和修复建议。

## 14. Acceptance Criteria

Product acceptance:

- Studio 从 tab 控制台升级为生命周期平台。
- 投产前路径完整：Create -> Build -> Debug mode -> Validate & Release。
- 投产后路径完整：Operate -> Diagnose -> Audit panel -> Recover。
- X6 graph 成为主工作区。
- 用户能通过图完成主要编排与配置任务。
- 用户能通过图理解调试和运行状态。
- 一级导航保持少而清晰：Project / Build / Validate & Release / Operate。
- 成熟产品对标用于运行时产品取舍，不复制单一产品 UI；最终体验必须符合 OGSystem 的 authoring truth、runtime truth 和 audit/recovery 边界。

Engineering acceptance:

- Runtime/parser/compiler 不依赖 X6 或 Visualizer UI。
- Build editable controller 与 Operate readonly controller 隔离。
- `client-app.ts` 逐步收敛为 shell/bootstrap。
- 新增 UI 全量 i18n。
- Browser smoke 覆盖真实 X6 行为。
- Feature flag、旧 tab fallback、route compatibility 均有验证。
- 全量回归通过。
