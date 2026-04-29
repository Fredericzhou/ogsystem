# OGSystem Studio Visual Authoring Solution

Date: 2026-04-28  
Status: delivered; Studio Bridge graph-first MVP, visual authoring model, console UX remediation, and regression complete
Scope: 在不影响现有内核的前提下，为 OGSystem 增加 Studio Bridge 和后续 X6 风格可视化编辑工作台，并稳定生成 `system.mmd`

## 1. Decision Summary

OGSystem 不应长期把 `mmd` 文本编辑作为主 authoring 入口。

但根据当前项目状态，Studio 不应跳过已经交付的 debug-first console、Ops Summary 和 Project Readiness 直接进入“大画布重构”。

最佳实践已经调整为：

1. 已先完成 `Studio Bridge / authoring model`，把现有 Mermaid Workbench、Project Readiness、Config Explain、Ops Summary、Run Console 串成一条 authoring-to-debug 闭环。
2. 已引入独立的 `Studio Authoring Document` 和 deterministic Mermaid serializer，作为后续设计层基础。
3. 已把 authoring document 投影到 X6 风格画布工作区，补齐 graph-first MVP editing，并稳定导出 `system.mmd` 供现有 runtime 使用。

推荐主路径：

```text
Existing system.mmd / Mermaid Workbench
-> Studio Bridge
-> Project Readiness / Config Explain / Ops Summary
-> Dry Run
-> Run Console

then:

Studio Authoring Document
<-> Canvas Document
-> Mermaid Serializer
-> system.mmd
-> existing parse / compiler / doctor / runtime
```

这条路径的关键点是：

1. Bridge 阶段已经把现有调试底座接入 authoring 流程，避免了大画布先行。
2. 长期画布编辑的真相不是 Mermaid 字符串，而是 Studio Authoring Document。
3. `system.mmd` 是 runtime truth，也是可读、可 diff、可运行的标准产物。
4. 现有 `src/runtime/*` 不改执行语义，只继续消费 `system.mmd`。

## 1.1 Latest Project State

截至当前状态：

- `debug-first console Phase 0-3` 已交付：failure triage、config explain、review/resume operability 已有 projection / API / client 测试。
- `Phase 4 Project Readiness` 已交付：`GET /api/v1/project/readiness` 和 `Project Readiness` 面板可以在运行前暴露 missing bindings、strict handoff contract coverage、role repo health。
- `Ops Summary` 已交付：`GET /api/v1/project/ops-summary` 和 `Ops Summary` 面板可以聚合 recent failures、role/errorCode/errorCategory 分布、review/rework pending、resume blocking 和 drift sources。
- `Mermaid Workbench` 已存在：支持 project source load、validate、save、save-as、rendered/structure/source 视图和 run start/resume 控制面。
- `Studio Bridge / authoring model` 已交付：Workbench 入口、Bridge inspector、authoring draft、deterministic Mermaid serializer、canvas model projection、template draft 已有 visualizer client/API/unit 测试。
- `X6-style graph-first editing` 已交付 MVP：Bridge 中心画布、role/flow selection、add role、delete role、add edge、fit/move layout、apply-canvas API、deterministic generated MMD、Run Debug/Project/Config/Logs/Artifacts UX 优化已有 visualizer client/API/unit 测试。

因此，Studio 方案必须以这些现有能力为底座，而不是重新发明第二套 readiness、binding、contract、failure 或 resume diagnostics。

### 1.2 Current-State Verification

本方案基于当前仓库状态，而不是原始 proposal 状态。

核对依据：

| 能力 | 当前状态 | 仓库依据 | 对 Studio 的影响 |
| --- | --- | --- | --- |
| Mermaid Workbench | 已存在 | `src/visualizer/client-app.ts`、`src/visualizer/server.ts`、`tests/visualizer.test.mjs` | Studio Bridge 应从现有 workbench 进入，不另建第一套 source editor。 |
| Project Readiness | 已存在 | `src/visualizer/project-readiness.ts`、`GET /api/v1/project/readiness`、`tests/visualizer-project-readiness.test.mjs` | 运行前 blocker 判断直接复用 readiness projection。 |
| Ops Summary | 已存在 | `src/visualizer/ops-summary-projection.ts`、`GET /api/v1/project/ops-summary`、`tests/visualizer-ops-summary.test.mjs` | Studio 不复制 ops 聚合，只提供回链和上下文入口。 |
| Failure / Resume / Review 调试面板 | 已存在 | `src/visualizer/data.ts`、`src/visualizer/client-renderers.ts`、`tests/visualizer-data.test.mjs`、`tests/visualizer-client.test.mjs` | 节点和 flow 的 debug 信息应作为 read-only projection 展示。 |
| Runtime 主链 | 已存在且应保持稳定 | `src/runtime/*`、`src/parser/*`、`src/runtime/compiler.ts` | Studio 只能生成 `system.mmd`，不能绕过 parser/compiler/runtime。 |
| Studio Bridge / authoring model | 已交付 | `src/visualizer/studio-authoring.ts`、`src/visualizer/studio-templates.ts`、`POST /api/v1/project/studio/bridge`、`tests/visualizer-studio-authoring.test.mjs` | Bridge、authoring draft 和 graph-first MVP 已可用，且不引入 runtime 依赖。 |
| X6-style graph-first visual editing | 已交付 MVP | `renderStudioGraphCanvas`、`POST /api/v1/project/studio/authoring/apply-canvas`、`applyCanvasDocumentToAuthoring`、`tests/visualizer-client.test.mjs` | 以现有轻量 visualizer 前端交付 graph-first editing，不引入 runtime 依赖。 |

当前测试入口：

```text
pnpm run test:visualizer
```

该入口当前覆盖 visualizer client/data/API、Project Readiness 和 Ops Summary，是 Studio Bridge 首轮回归的最低测试集。

## 2. Constraints

本方案必须同时满足以下约束：

1. UI 形态直接决定可用性；已在 `Studio Bridge / authoring model` 基础上补 X6-style graph-first editing 和 UX backlog，没有另起大前端重构。
2. 不影响现有内核。现有 `parse-mermaid -> SystemDefinition -> compiler -> runtime` 主链保持不变。
3. `system.mmd` 仍然保留为项目内可读、可 diff、可运行的标准产物。
4. Studio 生成、保存、dry-run 后必须能直接跳到现有 Run Console 调试，不允许形成独立诊断孤岛。
5. Studio 不维护第二套静态语义规则；必须复用现有 validation、project readiness、config explain、contract explain 和 run failure projection。

## 3. Why MMD Text Should Not Stay the Main Editing Surface

当前 `Mermaid Workbench` 仍以文本为中心，问题不是“不能编辑”，而是它让用户承担了太多低层负担：

- 用户需要同时理解 Mermaid 语法、metadata 规则和运行时约束。
- `join.mode.*`、`join.sources.*`、`context.map.*`、`review.*`、`loop.max.*` 这类语义并不适合直接手写。
- 用户每次改图后都要自己重新建立“图结构”和“配置元信息”的映射。
- 文本方式对新用户和调试场景都不友好，容易得到“能 parse，但不好用”的项目。

因此，文本 Mermaid 应逐步退居二线：

- 默认作为导出预览。
- 作为高级模式保留。
- 不再作为主 authoring 真相。

但迁移顺序必须保守：

```text
Mermaid Workbench
-> Studio Bridge with diagnostics
-> Structured Inspector editing
-> X6 Canvas editing
```

这样可以先改善调试和运行前解释能力，再引入更复杂的画布交互。

## 4. Core Product Shape

推荐把现有 `visualizer` 产品化为正式 `ogs console`，并分成 4 个明确视图。

### 4.1 Project Home

面向项目状态，而不是面向某个 run。

展示：

- project readiness（已交付）
- 当前系统摘要
- 最近运行
- 最近失败/待 review（通过 Ops Summary 聚合）
- 快捷动作：`Open Studio Bridge`、`Dry Run`、`Open Ops`、`Open Run Console`

### 4.2 Studio

这是主入口，面向“生成一个真正可用的 OGS 项目”。

Studio 只负责：

- 导入现有 `system.mmd`
- 画布建模
- role / edge / metadata 编辑
- 配置联动
- 生成 `system.mmd`
- 运行前验证
- dry-run 后打开 Run Console

### 4.3 Run Console

面向当前 run 的执行与调试。

展示：

- graph
- timeline
- logs
- review
- failure triage
- resume readiness / diagnostics
- selected binding / contract / role package explanation

### 4.4 Ops

面向历史 run、恢复、审计和运行维护。

当前已具备 `Ops Summary`，Studio 不应复制这部分逻辑，只应从 authoring 页面提供跳转和上下文链接。

### 4.5 Studio Bridge

这是已经完成的过渡层，用于稳定 authoring、validation、graph-first editing 和 debug 闭环。

Studio Bridge 面向“边改边知道会不会跑、为什么不能跑”。

最小能力：

- 从现有 Mermaid Workbench 打开。
- 使用当前 `system.mmd` 生成结构化 role / edge / metadata inspector。
- 保存前调用现有 validate。
- 保存后刷新 Project Readiness、Config Explain、Contract Explain、Role Package Summary。
- dry-run 后打开对应 Run Console。
- run failure 后能回链到相关 role、edge、binding、contract 或 review/resume 面板。

这满足两个底线：

- 不影响内核。
- 更方便调试。

## 5. Studio UI Best Practice

可用性主要由 Studio 决定。完整 Studio 推荐采用“画布居中、属性右置、诊断下沉”的形态。

但当前阶段应避免把运行态、项目配置和画布编辑混成一个长页面。推荐先在现有 console 里增加独立的 `Studio Bridge` 入口，进入后仍然复用 console 的 Project Readiness、Ops Summary 和 Run Console。

### 5.1 Layout

建议的 Studio 布局：

```text
+----------------------------------------------------------------------------------+
| Top Bar: Project / Save / Validate / Generate MMD / Dry Run / Open Run Console |
+-------------------+--------------------------------------+----------------------+
| Left Palette      | Center Canvas                        | Right Inspector      |
| - Add Role        | - X6 graph                           | - Node properties    |
| - Add Review      | - drag / connect / select            | - Edge properties    |
| - Add Loop        | - inline edge labels                 | - binding config     |
| - Add Boundary    | - badges for join/review/loop        | - join/context map   |
| - Templates       | - minimap / zoom / fit               | - diagnostics        |
+-------------------+--------------------------------------+----------------------+
| Bottom Panel: Diagnostics | Mermaid Preview | Compile Snapshot | Run Setup          |
+----------------------------------------------------------------------------------+
```

### 5.2 Top Bar

顶部动作条必须是高频、明确、状态化的：

- `Save Draft`
- `Validate`
- `Generate system.mmd`
- `Dry Run`
- `Open Run Console`
- `Undo / Redo`
- `Fit View`
- `Import MMD`
- `Advanced Text Mode`

同时显示：

- draft status
- validation status
- last generated time
- current target path

### 5.3 Left Palette

左侧不应堆满抽象图元，而应只放对 OGSystem 真正有意义的操作：

- `Role`
- `Input`
- `Output`
- `Review Role`
- `Loop Role`
- `Join Role`
- `Template: Debate`
- `Template: Consultation`
- `Template: Review`

注意：

- `parallel_split` 和 `join` 在 OGSystem 里本质上是 role metadata，不是独立运行节点。
- 因此不要机械照搬 BPMN 或通用流程图工具的图元集。
- 最佳实践是保留 role-centric graph，把 split/join/review/loop 作为 role 的可视状态或快捷模板。

### 5.4 Center Canvas

画布推荐使用 X6 风格的交互，但不要让画布承担所有语义输入。

画布负责：

- 拖拽节点
- 连线
- 选择
- 缩放
- 框选
- 重新布局
- 节点状态徽标显示
- 边标签显示 `eventType`

节点视觉建议：

- 普通 role：矩形
- entry / output：边界态样式
- join role：加 `J` badge
- review role：加 `R` badge
- loop role：加 `L` badge
- `parallel_split` role：加 `P` badge
- 绑定状态：`M` 表示 `model.bind`，`E` 表示 `exec.bind`

边视觉建议：

- 主边显示 `eventType`
- `ERROR*` 路径用警示色
- 当前被 Inspector 选中的边高亮
- 诊断错误边显示红色 outline

### 5.5 Right Inspector

Inspector 是可用性的关键，不能让用户靠文本回忆 metadata key。

选中 role 时显示：

- `roleId`
- role type / label
- binding kind
- `model.bind` / `exec.bind`
- `parallel_split`
- `review.mode`
- `loop.max`
- `join.mode`
- `join.min`
- `context.map`

选中 edge 时显示：

- `fromRoleId`
- `toRoleId`
- `eventType`
- 是否为 `ERROR*`

选中 project 时显示：

- `systemId`
- `systemVersion`
- `entryRoleId`
- `law.global`
- project-level config summary

Inspector 必须做两件额外的事：

1. 给出结构化控件，而不是暴露原始 metadata key。
2. 在当前字段附近显示静态语义诊断，而不是把错误全堆到全局 toast。

### 5.6 Bottom Panel

底部面板不用于编辑主数据，而用于解释和确认结果。

建议 6 个 tab：

- `Diagnostics`
- `Mermaid Preview`
- `Compile Snapshot`
- `Project Readiness`
- `Config Explain`
- `Run Setup`

其中：

- `Diagnostics` 显示 parse/compile/static errors
- `Mermaid Preview` 只读展示将要写入的 `system.mmd`
- `Compile Snapshot` 展示 role/join/flow summary
- `Project Readiness` 复用 `GET /api/v1/project/readiness`
- `Config Explain` 复用 binding / contract / role package projection
- `Run Setup` 提供一键 `dry-run` 或运行参数预填

dry-run 完成后必须提供：

- `Open Run Console`
- `Open Failure Triage`
- `Open Review Queue`
- `Open Resume Readiness`

如果 run 失败，Studio 不应只显示“运行失败”，而应链接到现有 failure projection 给出的 deterministic next checks。

## 5.7 Console UX Remediation Plan

在引入 X6 前后，现有 console 的信息架构也需要收敛。目标不是增加复杂度，而是减少空白、重叠和平铺 JSON，让 Studio 和 Run Debug 都像成熟产品一样稳定可扫。

### 5.7.1 Run Debug

当前问题：

- `Run Snapshot` 在窄宽度或长状态文本下可能重叠。
- `Timeline` 下方容易出现大量空白，主调试视图视觉重心不稳。

推荐改造：

- `Run Snapshot` 使用稳定的 `auto-fit/minmax` stats grid。
- stats 数字和状态文本必须 `min-width: 0`、可换行或省略，不能撑破卡片。
- `Timeline` 与 `Graph View / State` 组成主工作区：桌面端 Timeline 占主列，Graph/State 占侧列；移动端单列堆叠。
- Timeline 卡片高度随内容收缩，长日志或事件列表使用内部滚动，不让 grid 留出空洞。
- Failure Triage、Review Queue、Resume Readiness 作为第二层调试区域，不挤压主工作区。

验收：

- 1366px、1024px、390px 宽度下 `Run Snapshot` 无重叠。
- Timeline 下方无明显无内容空白。
- 选中失败 run 时，Failure / Resume / Logs 的入口仍在首屏附近可达。

### 5.7.2 Project Overview And Rendered Preview

Project 首页应更像项目控制面，而不是长列表：

- `Project Overview` 拆成紧凑多栏：
  - system summary
  - binding summary
  - special roles
  - validation/readiness status
  - recent warnings
- 多栏使用 responsive grid，桌面端 3-4 列，移动端 1 列。
- role 列表只展示摘要，详细信息交给 Studio Bridge / Config Explain。

`Rendered` 不再承担编辑真相，但要成为可用的图预览：

- 使用 X6 或与 X6 同源的 canvas projection 渲染，而不是只读 SVG 列表。
- 支持 pan、zoom in/out、fit view。
- 支持拖拽节点进行临时布局调整。
- 增加显式 `input/start` boundary node 和 `output/__system_end__` boundary node。
- 自动布局必须固定方向：start/input 在左，output/end 在右，role 按拓扑层级排列。
- 修复“看似反向箭头”的布局问题：禁止将 entry role 放到 start/input 左侧，也禁止将 `__system_end__` 放到 role 左侧。

约束：

- Rendered/Canvas 中的拖拽位置只进浏览器缓存或 session state。
- 不写入 `system.mmd`。
- 默认布局必须足够好，即使没有缓存也能正确表达方向。

### 5.7.3 Studio Bridge Graph-First Editing

Studio Bridge 不应长期以 role/flow 列表为主入口。列表只能作为导航，主编辑面必须是 X6 graph。

推荐布局：

```text
+----------------------------------------------------------------------------------+
| Toolbar: Validate | Save system.mmd | Save Draft | Generate MMD | Dry Run | Fit |
+----------------------+--------------------------------------+--------------------+
| Navigator / Palette  | X6 Canvas                            | Inspector          |
| - roles              | - draggable nodes                    | Role / Flow fields |
| - flows              | - connectable edges                  | Diagnostics        |
| - templates          | - boundary start/end nodes           | Config links       |
+----------------------+--------------------------------------+--------------------+
```

编辑能力：

- 新增 role node。
- 删除 role node，必须提示会删除相关 flows。
- 拖出 edge 创建 flow，并在 Inspector 中填写 `eventType`。
- 点击 node 编辑 binding、review、join、loop、context map。
- 点击 edge 编辑 from/to/eventType，并显示 contract/readiness 状态。
- 自动维护 join role 的 `join.sources`，高级模式允许覆盖。
- `parallel_split`、review、join、loop 作为 role badges 和 Inspector 字段，不作为独立 BPMN 节点。

技术边界：

- 引入 `@antv/x6` 是推荐路径。
- X6 cell schema 只作为 view/editor state，不作为持久 authoring truth。
- X6 不进入 `src/runtime/*` import graph。
- X6 不直接读写 `.ogs/runs/*`。
- X6 编辑结果必须先投影到 `StudioAuthoringDocument`，再生成 Mermaid，再走现有 validate/save/dry-run。

### 5.7.4 Config Explain

Config Explain 应按 role/flow 卡片组织，而不是平铺：

- Role card：
  - `roleId`
  - binding kind
  - declared binding
  - resolved model/profile
  - role package path
  - schema health
  - warnings
- Flow card：
  - `fromRoleId -> toRoleId`
  - `eventType`
  - contract id
  - schema path
  - status：covered / missing / failed / pass / unknown
  - missing reason

交互：

- 支持按 role、flow、missing、warning 过滤。
- 从 Studio Bridge 选中 node/edge 后，可以定位到对应 Config card。
- 保持数据来源为现有 binding / contract / role package projection，不复制规则。

### 5.7.5 Logs

Logs 保留现有筛选，但默认视图要支持“不筛选完整查看”：

- 默认展示合并日志流：
  - engine logs
  - role logs
  - lifecycle/audit log 摘要
- 支持分页或 `Load more`。
- 支持 page size：100 / 500 / 1000。
- role / tail / since / type 筛选作为 refinement，而不是默认只能看 latest role。
- 大日志仍按需加载，避免一次性读取所有历史文件。

约束：

- 不改变 run artifact 格式。
- 不让前端直接读文件系统。
- 继续通过 visualizer API 做分页和筛选。

### 5.7.6 Artifacts

Artifacts 需要从 raw dump 改成分组：

- `Summary`
- `Metrics`
- `State`
- `Audit`
- `Timeline`
- `Raw`

推荐默认：

- 首屏展示 Summary + Metrics 卡片。
- State / Audit / Timeline 放到二级 tab 或折叠区。
- Raw JSON 只作为最后的 fallback。
- 大 JSON 使用折叠和复制按钮，避免平铺撑爆页面。

### 5.7.7 Delivery Order

实施顺序已按以下路径落地：

1. 已修 Run Debug 重叠和 Timeline 空白。
2. 已压缩 Project Overview，多栏卡片化。
3. 已引入 X6-style Project Rendered，并补 start/end boundary 和默认拓扑布局。
4. 已将 Studio Bridge 升级为 X6-style graph-first editing MVP。
5. 已将 Config Explain role/flow card 化。
6. 已给 Logs 增加默认完整分页查看。
7. 已给 Artifacts 增加分类 tab / 卡片。

每一步都必须保持：

- 不改 runtime 执行语义。
- 不改 parser/compiler 语义。
- 不让 X6 或浏览器 UI 状态成为 runtime truth。
- 测试入口至少覆盖 `pnpm run test:visualizer`。

## 6. Authoring Data Model

完整 Studio 需要一个独立于 `mmd` 的 canonical 数据结构。建议新增：

```ts
type StudioAuthoringDocument = {
  version: 1;
  project: {
    workdir: string;
    systemPath: string;
  };
  system: {
    systemId: string;
    systemVersion: string;
    entryRoleId: string;
    lawGlobalRef: string;
  };
  roles: Record<string, {
    roleId: string;
    title?: string;
    bindingKind: "model" | "exec" | "noop";
    modelRef?: string;
    profileId?: string;
    routingMode?: "parallel_split";
    joinMode?: "all_of" | "quorum_of";
    joinMin?: number;
    joinSources?: string[];
    loopMax?: number;
    review?: {
      mode: "required";
      timeoutSeconds?: number;
      timeoutAction: "pause" | "terminate";
      reworkTargetRoleId: string;
      reworkMax?: number;
      terminateScope: "branch" | "run";
    };
    contextMap?: Record<string, string>;
  }>;
  flows: Record<string, {
    flowId: string;
    fromRoleId: string;
    toRoleId: string;
    eventType: string;
  }>;
  transientLayout?: {
    nodes?: Record<string, { x: number; y: number; width?: number; height?: number }>;
    viewport?: { x: number; y: number; zoom: number };
    source: "browser_cache" | "session" | "auto_layout";
  };
};
```

设计原则：

- 运行时语义字段和画布布局字段分开。
- 只保留 OGSystem 真正执行需要的概念。
- 不把纯 UI 状态混进 `system.mmd`。
- 节点位置、viewport、selection 属于临时 UI 状态，默认不写入项目文件；可以用浏览器缓存提升体验，但每次打开必须能从 authoring document 自动布局恢复。
- `transientLayout` 只是类型层面的 UI cache envelope，默认不写入 `.ogs/studio/system.authoring.json`；如果后续允许显式保存 layout，也必须标记为纯 UI cache，不能参与 Mermaid 生成、validation、doctor、compiler 或 runtime。

对当前阶段，`StudioAuthoringDocument` 不应一次性替换 Mermaid Workbench。

推荐分两步：

1. `Bridge Draft`
   - 从 `system.mmd` 和现有 projections 生成。
   - 只用于结构化 inspector、diagnostics 和稳定保存。
   - 可以先不持久化，或只作为 `.ogs/studio/system.authoring.json` 草稿持久化。
2. `Studio Authoring Document`
   - 在 Bridge Draft 稳定后成为长期设计真相。
   - 仍必须稳定导出 `system.mmd`。

## 7. Visual Editing Model

X6 风格编辑不等于“让 X6 成为真相”。它只能是 `StudioAuthoringDocument` 的图形投影。

推荐转换链路：

```text
StudioAuthoringDocument
<-> CanvasDocument
-> MermaidText
```

### 7.1 `authoring -> canvas`

用于首次打开和刷新画布：

- role -> node
- flow -> edge
- role metadata -> node badges / node hints
- auto layout / browser cached layout -> node positions

### 7.2 `canvas -> authoring`

用于用户拖拽和连接后的保存：

- 更新拓扑连接
- 保留 role/flow 语义字段
- 删除和新增 role/flow

节点拖拽、缩放、viewport、selection 不作为 authoring truth 保存。推荐策略：

- 默认每次打开基于拓扑和 role metadata 自动布局。
- 用户拖拽位置只写入浏览器缓存或当前 session state。
- 浏览器缓存 miss 时不影响打开和运行。
- `system.mmd` 和 `.ogs/studio/system.authoring.json` 都不能依赖画布坐标才能恢复语义。
- 即使后续提供“保存布局”开关，保存对象也只能是 UI cache，不能改变 Mermaid serializer 输出，不能改变 validation/readiness 结果，不能被 runtime 消费。

注意：

- `join.sources` 不应由用户手动在画布上逐个维护。
- 最佳实践是基于当前所有进入 join role 的边自动生成，再允许高级覆盖。

### 7.3 `authoring -> Mermaid`

Serializer 负责稳定导出：

- 统一 header
- role edge 顺序固定
- metadata 顺序固定
- `join.sources.*` 自动展开
- `context.map.*` 展开为严格 metadata
- 未使用字段不输出

这一步必须做 deterministic output，避免每次保存都产生无意义 diff。

## 8. Rich Node And Flow Content

画布节点和链接应该比普通流程图更“厚”，但必须区分两层：

- `design layer`
  可编辑，写入 Studio Authoring Document，最终序列化为 `system.mmd`。
- `debug projection layer`
  只读，来自现有 failure、readiness、contract、role package、run graph、review/resume projections，不写回 authoring document。

这样可以让画布方便调试，又不污染 runtime 内核。

### 8.1 Rich Role Node

节点本体不应只显示 `roleId`。

推荐节点摘要显示：

- `roleId` / role title
- binding：`model.bind` / `exec.bind` / `noop`
- 状态 badge：`entry`、`review`、`join`、`loop`、`parallel_split`
- role package health：`role.json` / `prompt.md` / `output.schema.json`
- allowed events 数量
- readiness 状态：`ready` / `warning` / `blocked`
- 最近 run 状态：`ok` / `failed` / `waiting_review` / `stopped`
- 最近失败：`errorCode`、`stage`、`retryable`

节点示例：

```text
[delivery-lead]  M  R J
blocked: missing contract
last: waiting_review
```

其中：

- `M` 表示 model binding。
- `E` 表示 exec binding。
- `R` 表示 review role。
- `J` 表示 join role。
- `L` 表示 loop role。
- `P` 表示 parallel split role。

### 8.2 Role Inspector

点击节点后进入右侧 Inspector。

`Edit` tab：

- `roleId`
- title / display label
- binding kind
- `model.bind` / `exec.bind`
- `parallel_split`
- `join.mode`
- `join.min`
- `loop.max`
- `review.mode`
- review timeout / timeout action
- review rework target / rework max
- terminate scope
- `context.map`

`Readiness` tab：

- missing binding
- role package file health
- strict handoff blockers related to this role
- context map source validity

`Debug` tab：

- latest run status for this role
- latest failed audit
- latest input context
- latest output / raw output snapshot
- failure `errorCode`
- failure stage
- retryable flag
- direct links to Failure Triage, Logs, Review Detail, Resume Readiness

`Schema` tab：

- output schema path
- allowed events
- schema validation status
- role package resolved path

节点上的调试信息必须只读。它来自现有 projection，不进入 `system.mmd` 或 authoring document。

### 8.3 Rich Flow Link

链接也不应只是一条线加字符串。

推荐边摘要显示：

- `eventType`
- `fromRoleId -> toRoleId`
- contract 状态：`covered` / `missing` / `failed` / `pass` / `unknown`
- 是否 `ERROR*` flow
- 是否 strict handoff blocker
- 是否参与 join source

链接示例：

```text
IMPLEMENTATION_READY
contract: covered
```

### 8.4 Flow Inspector

点击边后进入右侧 Inspector。

`Edit` tab：

- `fromRoleId`
- `toRoleId`
- `eventType`
- 是否 runtime-only error flow

`Contract` tab：

- contract id
- schema path
- `onViolation`
- lastStatus
- missing reason

`Validation` tab：

- `fromRoleId` / `toRoleId` 是否存在
- `eventType` 是否为空
- strict handoff 下是否有 flow contract
- contract schema 是否存在
- `parallel_split` 出边是否和 `route.order.*` 一致
- join role 的 `join.sources` 是否能由入边自动推导
- context map 是否引用了有效 source role
- `ERROR*` flow 是否符合 runtime 允许语义

`Recent Runs` tab：

- 最近触发时间
- 最近通过 / 失败状态
- 最近失败 run
- 相关 failure / contract / resume diagnostics link

### 8.5 Editing And Debugging Boundaries

保存路径：

```text
Inspector / Canvas edit
-> StudioAuthoringDocument
-> Mermaid serializer
-> validateProjectSystemSource
-> Project Readiness
-> system.mmd
```

调试路径：

```text
Node / Flow selection
-> existing projections
-> Run Console / Failure Triage / Resume Readiness
```

关键约束：

- design layer 才能写入 authoring document。
- debug projection layer 只能展示和跳转。
- layout、viewport、selection、hover state 不写入 `system.mmd`。
- failure、review、resume、log、run artifact 不写入 Studio authoring truth。
- Studio 不直接修改 `.ogs/runs/*`。

## 9. Recommended Save Contract

为了不影响内核，建议引入双文件模式：

- `system.mmd`
  - runtime truth
  - CLI 与现有内核直接消费
- `.ogs/studio/system.authoring.json`
  - Studio truth
  - 画布与 Inspector 直接消费

保存时序：

1. `inspector/canvas -> authoring`
2. `authoring -> mermaid`
3. 调用现有校验链验证生成结果
4. 调用 Project Readiness 生成运行前诊断
5. 校验通过后写入 `system.mmd`
6. 同时保存 `.ogs/studio/system.authoring.json`
7. 刷新 Config Explain、Contract Explain、Role Package Summary

校验失败时：

- 不覆盖已存在的 `system.mmd`
- 保留 draft
- 在 Diagnostics 中精确定位字段

Project Readiness 有 blocker 时：

- 默认不执行 dry-run。
- 允许保存 draft。
- 只有用户明确选择高级覆盖时才允许保存 `system.mmd`，但必须显示 blockers。
- 不允许绕过现有 parser/compiler/runtime 直接启动。

## 10. Import Strategy

为了兼容现有项目，需要提供 `Import MMD`。

推荐流程：

1. 读取 `system.mmd`
2. 用现有 parser 转成 `SystemDefinition`
3. `SystemDefinition -> StudioAuthoringDocument`
4. 自动生成默认 layout
5. 在 Studio 中打开

注意：

- 现有 runtime 已经在 parse 后只工作于 `SystemDefinition`，这使导入链路天然可行。
- 需要新增一个 `SystemDefinition -> Mermaid` 的稳定 serializer，作为 Studio 的导出器。

## 11. Validation Flow

Studio 不应发明第二套规则，而应复用现有静态语义。

推荐验证顺序：

1. 画布级校验
   - 节点是否悬空
   - entry 是否存在
   - edge 是否缺 `eventType`
2. authoring 级校验
   - roleId 唯一
   - join role 配置完整
   - review 配置完整
3. Mermaid 导出校验
   - 使用现有 `parse-mermaid`
4. compile 快照校验
   - 使用现有 `compileExecutionSnapshot`
5. project readiness 校验
   - 使用 `GET /api/v1/project/readiness`
6. explainability 校验
   - 使用 binding / contract / role package projection

这样可以保证：

- 前端先给即时反馈
- 后端再给权威语义反馈
- 内核规则只有一套
- 保存前知道能不能 dry-run
- dry-run 失败后能直接进入 Run Console 定位原因

## 12. Runtime Isolation

本方案不应改变以下内核边界：

- `src/runtime/parse-mermaid.ts`
- `src/runtime/compiler.ts`
- `src/runtime/adapter.ts`
- `src/runtime/graph-runner.ts`
- `src/runtime/role-executor.ts`

Studio 只能做两类事：

1. 生成或更新 `system.mmd`
2. 调用现有 `validate / doctor / run start`
3. 打开现有 debug-first console 的解释面板

这意味着：

- runtime 不认识 X6
- runtime 不认识 authoring document
- runtime 仍只认识 `system.mmd` 和现有 `.ogs/*` 配置
- runtime 不认识 Studio Bridge
- Studio 不能新增 runtime-only DSL 或绕过 `system.mmd`

## 13. Compatibility And Existing Function Impact

按本方案推进，正常不应影响现有功能，因为 Studio 是增量 authoring shell，不是 runtime 替换。

必须坚持以下边界：

- runtime 不改：`parse-mermaid -> compiler -> runtime` 仍只消费 `system.mmd`。
- Studio 不直接驱动运行：只能生成 / 更新 `system.mmd`，再调用现有 validate / dry-run / run start。
- 调试信息只读：failure、readiness、contract status、review 状态都来自现有 projections，不写回 runtime artifact。
- 保存前强校验：任何画布 / Inspector 修改都必须先生成 Mermaid，再走现有 parser / compiler / project readiness。
- 支持回退：高级用户仍可直接编辑 `system.mmd`，Studio Bridge 只是更结构化的入口。

主要风险：

1. `system.mmd` 序列化不稳定
   - 如果 Studio 每次保存都重排 metadata / edge，会造成大量无意义 diff。
   - 必须实现 deterministic serializer。
2. Mermaid Workbench 被替换太早
   - 不要直接移除现有 Workbench。
   - 先并存：Workbench 作为 source / advanced mode，Studio Bridge 作为结构化编辑入口。
3. 画布状态和运行状态混写
   - 布局、选中态、viewport、调试缓存不能写进 `system.mmd`。
   - 默认只放入浏览器缓存或当前 session state。
   - 如果后续提供显式保存 layout，保存对象也只能是纯 UI cache，不得成为 authoring truth、Mermaid serializer 输入、validation 输入或 runtime artifact。

风险分级：

- `Phase 0 Studio Bridge`
  低风险，基本不影响现有功能。
- `Authoring Document + serializer`
  中等风险，重点测试 round-trip 和 diff 稳定性。
- `X6 Canvas`
  UI 风险较高，但只要作为 view layer，不接触 runtime，内核风险仍然低。

验收门槛：

```text
现有 visualizer tests 全绿
现有 runtime tests 全绿
同一个 system.mmd import -> export 无语义变化
保存失败不覆盖 system.mmd
Project Readiness blocker 默认阻止 dry-run
dry-run 失败能打开 Run Console 定位原因
```

这样推进就是增量增强，不是替换现有能力。

## 14. Recommended Frontend Stack

如果目标是类似 X6 的交互，推荐直接采用 X6 作为画布引擎，但只把它当作 view layer。

推荐边界：

- `@antv/x6`: 画布、拖拽、连线、节点布局、缩放、minimap
- 原生 `HTML/CSS/JS` 或轻量客户端脚本：页面壳与状态
- Node 内置 `http`: 服务端

确认后的产品决策：

- 应引入 X6，实现画布内节点和连线编辑能力。
- X6 只属于 visualizer/studio 前端层，不影响 runtime、parser、compiler 或现有 CLI 能力。
- 节点位置不写入项目文件；默认使用自动布局，用户调整只进入浏览器缓存或当前 session。
- 即使浏览器缓存清空，Studio 也必须能从 `system.mmd` / authoring draft 自动恢复可读布局。
- 不为了 X6 引入重型前端重构；优先在现有 visualizer surface 内按需增加客户端依赖和轻量 bundling。

不建议一开始做的事：

- 不要把 X6 的 cell schema 直接当永久存储格式
- 不要让前端直接读写 `.ogs/runs/*`
- 不要要求用户先学 Mermaid 再学画布
- 不要把 run observability 和 Studio 编辑混成一个单页长面板
- 不要把 layout、selection、viewport、hover state 写入 `system.mmd` 或 runtime artifacts

## 15. Suggested Module Layout

推荐新增 Studio 外壳，不碰 runtime 目录。

当前阶段优先放在现有 `src/visualizer/` surface 内，避免为了 Studio Bridge 先迁目录：

```text
src/visualizer/
  studio-bridge.ts
  studio-authoring.ts
  studio-authoring-import.ts
  studio-authoring-export-mermaid.ts
  studio-authoring-validate.ts
  studio-x6-canvas.ts
  studio-layout.ts
  studio-client-renderers.ts
```

未来 console 拆分稳定后，再演进到：

```text
src/console/
  server.ts
  studio/
    api.ts
    authoring.ts
    authoring-import.ts
    authoring-export-mermaid.ts
    authoring-validate.ts
    canvas-model.ts
    page-shell.ts
    client-app.ts
  run-console/
  ops/
```

职责划分：

- `authoring.ts`
  - canonical authoring schema
- `authoring-import.ts`
  - `mmd -> SystemDefinition -> authoring`
- `authoring-export-mermaid.ts`
  - `authoring -> mmd`
- `canvas-model.ts`
  - `authoring <-> canvas`
- `studio-x6-canvas.ts`
  - X6 graph 初始化、节点/边交互、zoom/pan/fit、selection bridge
- `studio-layout.ts`
  - 从 topology 生成默认布局，处理 start/end boundary 和方向约束
- `authoring-validate.ts`
  - Studio 前置诊断和现有静态校验编排

## 16. MVP Scope

第一阶段不要追求完整可视化平台，只做真正提升可用性的最小闭环。

### Phase 0: Studio Bridge

- 在现有 console 中增加 `Open Studio Bridge`
- 从 `system.mmd` 生成结构化 role / edge / metadata inspector
- 保存前复用现有 validate
- 保存后刷新 Project Readiness / Config Explain
- dry-run 后打开 Run Console
- run failure 后回链到相关 role / edge / binding / contract / review / resume 面板

### Phase 1: Authoring Document

- `.ogs/studio/system.authoring.json`
- `Import MMD`
- `Generate MMD`
- deterministic Mermaid serializer
- draft autosave
- field-level diagnostics

### Phase 2: Visual Studio

- 引入 X6 画布作为 view/editor layer
- Project Rendered 支持 start/end boundary、zoom、pan、fit、默认拓扑布局
- Studio Bridge 升级为 graph-first editing，而不是列表主视图
- role/edge Inspector
- 自动 `join.sources`
- 诊断内联高亮
- 节点位置仅缓存到浏览器或 session，不写入 `system.mmd` / authoring truth
- Run Debug / Project Overview / Config / Logs / Artifacts 进行轻量信息架构优化

### Phase 3: Assisted Authoring

- 模板库
- 从示例生成
- `nl2mmd` 生成 Studio 初稿
- 一键打开 Run Console

## 17. Execution Tracking Plan

为保证方案可跟踪执行，Studio 工作不应只用阶段名描述，而应拆成可验证任务。

状态标记：

- `[ ]` pending
- `[~]` in progress
- `[x]` delivered
- `[!]` blocked

### 17.1 Phase 0: Studio Bridge

目标：不引入 X6，不改 runtime，先把现有 authoring、validation、readiness 和 debug console 串成闭环。

| 状态 | 任务 | 交付物 | 验收方式 |
| --- | --- | --- | --- |
| [x] | 新增 Studio Bridge 入口 | Workbench 中出现 `Open Studio Bridge` 和 `Studio Bridge` tab | `tests/visualizer-client.test.mjs` 覆盖入口、切换和渲染 |
| [x] | 从当前 `system.mmd` 生成结构化 role / flow draft | `src/visualizer/studio-authoring.ts`、`POST /api/v1/project/studio/bridge` | `tests/visualizer-studio-authoring.test.mjs`、`tests/visualizer.test.mjs` 覆盖 role、flow、metadata 提取 |
| [x] | Role Inspector MVP | Bridge role inspector 展示 binding、review/join/loop/context 摘要和 badges | `tests/visualizer-client.test.mjs` 覆盖字段渲染 |
| [x] | Flow Inspector MVP | Bridge flow inspector 展示 from/to/eventType、runtime error flow、join source 状态 | `tests/visualizer-client.test.mjs` 覆盖 flow 渲染和选择 |
| [x] | 保存前复用现有 validate | Bridge save 复用 `/api/v1/project/system/save` -> `saveProjectSystemSource` | `tests/visualizer.test.mjs` 覆盖 invalid save 不覆盖 `system.mmd` |
| [x] | 保存后刷新 diagnostics | 保存成功后刷新 Project Readiness、Ops Summary、Config Explain、Contract/Role Package Summary | `tests/visualizer-client.test.mjs` 覆盖保存后刷新请求 |
| [x] | Dry-run 后打开 Run Console | Bridge dry-run 复用 start form，成功后 `selectRun(runId)` 进入 run detail | `tests/visualizer-client.test.mjs` 覆盖 start -> run detail 链接 |
| [x] | 失败后回链到节点或 flow | Bridge 保留 failure next-check links，并沿用现有 failure/check 跳转到 binding、contract、resume 面板 | `tests/visualizer-client.test.mjs`、`tests/visualizer-data.test.mjs` 覆盖 failure next checks |

Phase 0 完成定义：

```text
pnpm run test:visualizer
```

必须通过，并且 runtime 目录没有为 Studio Bridge 引入执行语义变更。

### 17.2 Phase 1: Authoring Document

目标：引入可持久化 draft，但仍以 `system.mmd` 作为 runtime truth。

| 状态 | 任务 | 交付物 | 验收方式 |
| --- | --- | --- | --- |
| [x] | 定义 Studio Authoring schema | `StudioAuthoringDocument` TS type 和 `.ogs/studio/system.authoring.json` draft 保存路径 | `tests/visualizer-studio-authoring.test.mjs` 覆盖 `version: 1`、required fields |
| [x] | `system.mmd -> authoring` import | `importMermaidToAuthoring` / `importSystemToAuthoring` | round-trip test 覆盖 normalized role/flow/metadata |
| [x] | `authoring -> system.mmd` serializer | `serializeAuthoringToMermaid` deterministic serializer | serializer test 覆盖连续输出一致、parse 后语义一致 |
| [x] | Draft 保存 | `POST /api/v1/project/studio/authoring` 只写 `.ogs/studio/system.authoring.json` | `tests/visualizer.test.mjs` 覆盖 draft-only save 不覆盖 `system.mmd` |
| [x] | Field-level diagnostics | Bridge diagnostics 显示 validate diagnostic 的 roleId / selector / line，上下文靠近 inspector | `tests/visualizer-client.test.mjs` 覆盖 diagnostics 渲染 |

Phase 1 完成定义：

```text
同一个 system.mmd import -> export 无语义变化
失败保存不覆盖 system.mmd
pnpm run test:visualizer
```

### 17.3 Phase 2: Canvas Model And Graph-First MVP

目标：交付 canvas model、rich projection、selection inspector 和 X6-style graph-first editing MVP。

| 状态 | 任务 | 交付物 | 验收方式 |
| --- | --- | --- | --- |
| [x] | Canvas model adapter | `authoringToCanvasDocument` / `applyCanvasDocumentToAuthoring` | unit test 覆盖节点/边稳定映射 |
| [x] | Rich role node | Bridge/Canvas role projection 包含 binding、entry/review/join/loop/parallel badges | client/unit test 覆盖 role badge 渲染和 projection |
| [x] | Rich flow link | Bridge/Canvas flow projection 包含 eventType、runtime error flow、join source 状态 | client/unit test 覆盖 flow projection |
| [x] | Canvas selection -> Inspector | Bridge role/flow selection 进入对应 inspector | `tests/visualizer-client.test.mjs` 覆盖 selection state |
| [x] | Inline diagnostics | validate/readiness/failure next-checks 在 Bridge 与现有 debug 面板内联展示 | client/data test 覆盖 projection mapping |
| [x] | Layout state 隔离 | layout/viewport 不进入 `system.mmd`；默认不写 `.ogs/studio/system.authoring.json`，仅作为 browser/session UI state | serializer test 覆盖无 UI 状态泄漏 |
| [x] | Graph-first editing MVP | Bridge 中心画布、add role、delete role、add edge、fit/move、right inspector | `tests/visualizer-client.test.mjs` 覆盖用户动作 |

Phase 2 完成定义：

```text
canvas model 不进入 runtime import graph
system.mmd deterministic output
pnpm run test:visualizer
```

X6-style graph-first MVP 已交付；后续若需要真实 `@antv/x6` 运行时，可在不改变 authoring/runtime contract 的前提下替换 view layer。

### 17.4 Phase 3: Assisted Authoring

目标：在 Bridge 和 Visual Studio 稳定后再增加生成和模板能力。

| 状态 | 任务 | 交付物 | 验收方式 |
| --- | --- | --- | --- |
| [x] | 模板库 | `src/visualizer/studio-templates.ts` 提供 debate / consultation / review 模板和 `GET /api/v1/project/studio/templates` | import/export test 覆盖模板 |
| [x] | 从示例生成初稿 | `createStudioAuthoringFromMermaidDraft` 可把 Mermaid example 转成 authoring draft | fixture-style unit test 覆盖 Mermaid draft |
| [x] | `nl2mmd` 接入 Studio 初稿 | nl2mmd Mermaid output 复用 `createStudioAuthoringFromMermaidDraft` 进入 Bridge draft | integration-style unit test 覆盖生成后 parse/serialize |
| [x] | 一键调试闭环 | Bridge `Generate MMD` / `Dry Run` -> existing start action -> Run Console | end-to-end visualizer client test |

### 17.5 UX / X6-Style Follow-up Backlog

这些任务来自当前产品验收反馈，已作为本轮 visualizer/studio UI 层改造落地，不进入 runtime 内核。

| 状态 | 任务 | 交付物 | 验收方式 |
| --- | --- | --- | --- |
| [x] | 修复 Run Snapshot 重叠 | responsive stats grid、文本溢出处理 | `pnpm run test:visualizer` |
| [x] | 减少 Timeline 下方空白 | Run Debug 主工作区重排，Timeline/Graph 优先，Failure 二层区域 | `pnpm run test:visualizer` |
| [x] | Project Overview 紧凑多栏 | system/binding/special roles/readiness cards responsive grid | `pnpm run test:visualizer` |
| [x] | 引入 X6-style Project Rendered | graph preview、start/end boundary、默认拓扑方向约束 | `pnpm run test:visualizer` |
| [x] | Studio Bridge graph-first editing | canvas-first work area、right inspector、add role、delete role、add edge、fit/move | `tests/visualizer-client.test.mjs` |
| [x] | X6-style layout 不持久化 | layout/viewport 不进入 `system.mmd`，apply-canvas 不直接写项目文件 | `tests/visualizer-studio-authoring.test.mjs`、`tests/visualizer.test.mjs` |
| [x] | Config Explain role/flow 卡片化 | role cards、flow cards、missing/warning filter affordance | `pnpm run test:visualizer` |
| [x] | Logs 默认完整分页查看 | merged logs view、Load more、page size 100/500/1000、all-role default | `tests/visualizer-client.test.mjs` |
| [x] | Artifacts 分类组织 | Summary/Metrics/State/Audit/Timeline/Raw grouped cards | `pnpm run test:visualizer` |

### 17.6 Delivered Implementation Evidence

代码入口：

- `src/visualizer/studio-authoring.ts`
  - Studio Authoring Document type
  - `system.mmd -> authoring`
  - `authoring -> system.mmd`
  - `authoring <-> canvas`
  - `.ogs/studio/system.authoring.json` draft save/load
- `src/visualizer/studio-templates.ts`
  - debate / consultation / review templates
  - Mermaid draft / nl2mmd output -> authoring draft
- `src/visualizer/server.ts`
  - `POST /api/v1/project/studio/bridge`
  - `GET|POST /api/v1/project/studio/authoring`
  - `POST /api/v1/project/studio/authoring/import-mmd`
  - `POST /api/v1/project/studio/authoring/generate-mmd`
  - `GET /api/v1/project/studio/templates`
- `src/visualizer/client-app.ts`、`src/visualizer/client-renderers.ts`
  - Workbench `Open Studio Bridge`
  - Role / Flow inspector
  - Save Draft / Generate MMD / Validate / Save / Dry Run actions

验收证据：

```text
pnpm run test:visualizer
pnpm run test:runtime-regression
pnpm test
```

最新回归记录：

```text
Date: 2026-04-29
pnpm run test:visualizer
1..45
# pass 45

pnpm test
1..317
# pass 317

HTTP user-path smoke:
workdir examples/ogs-gstacklike
Studio Bridge roles 8 / flows 18
apply-canvas validation ok
generate-mmd validation ok
Project Readiness canDryRun true / blockers 0
```

说明：本轮任务完成后已重新执行 visualizer 回归，并用真实示例项目完成用户路径烟测。

内核影响判断：

- 未修改 `src/runtime/*`。
- 未修改 parser/compiler/runtime 执行语义。
- Studio Bridge、Authoring Document、Canvas Document 都位于 `src/visualizer/*`，只生成或验证 `system.mmd`，runtime 仍只消费现有 `system.mmd` 主链。

### 17.7 Tracking Rules

执行过程中每个任务必须同时更新：

1. 任务状态：本节表格 `[ ] / [~] / [x] / [!]`。
2. 代码入口：新增或变更的 `src/visualizer/*`、`tests/*` 路径。
3. 验收证据：至少记录运行过的测试命令。
4. 内核影响判断：明确是否触碰 `src/runtime/*`、`src/parser/*`、compiler 语义。

每个阶段不满足完成定义时，不进入下一阶段的大范围 UI 工作。

## 18. Non-Goals

当前不建议把以下内容纳入首版：

- 协作编辑
- 多人实时同步
- 浏览器直接操作运行目录
- 替换现有 runtime DSL
- 让 Studio 绕过 `system.mmd` 直接驱动运行

## 19. Final Recommendation

如果目标是“像 X6 一样可视化编辑，但不破坏现有 OGSystem”，正确做法不是把文本编辑器换成画布，而是沿着已经落地的 Bridge 路径继续演进：

1. 保持已交付的 `Studio Bridge / authoring model`，继续复用 Workbench、Project Readiness、Config Explain、Ops Summary 和 Run Console。
2. 以已新增的 `Studio Authoring Document` 作为设计层基础。
3. 用 Inspector 承接 OGSystem 的 metadata 语义。
4. 保持 X6-style 画布作为 view/editor layer，后续可按需替换为真实 `@antv/x6` 实现。
5. 稳定导出 `system.mmd`。
6. 继续让现有内核消费 `system.mmd`。

这样既能显著提升可用性和便捷性，也不会触碰现有 runtime 内核边界。

简化成一句话：

Studio 当前已经做到：在已交付 Bridge 和 authoring model 上提供 X6-style preview、graph-first editing 与 UX remediation，同时保持“authoring 每一步都能解释、验证、dry-run，并能立刻跳回 Run Console 调试”。
