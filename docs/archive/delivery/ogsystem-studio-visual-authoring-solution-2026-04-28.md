# OGSystem Studio Visual Authoring Solution

Date: 2026-04-28  
Status: proposal  
Scope: 在不影响现有内核的前提下，为 OGSystem 增加类似 X6 的可视化编辑工作台，并稳定生成 `system.mmd`

## 1. Decision Summary

OGSystem 不应继续把 `mmd` 文本编辑作为主 authoring 入口。

最佳实践是引入一层独立的 `Studio Authoring Document` 作为设计真相，再把它投影到可视画布，最后稳定导出 `system.mmd` 供现有 runtime 使用。

推荐主路径：

```text
Studio Authoring Document
<-> Canvas Document
-> Mermaid Serializer
-> system.mmd
-> existing parse / compiler / doctor / runtime
```

这条路径的关键点是：

1. 画布编辑的真相不是 Mermaid 字符串。
2. `system.mmd` 是导出产物，不是内部状态。
3. 现有 `src/runtime/*` 不改执行语义，只继续消费 `system.mmd`。

## 2. Constraints

本方案必须同时满足以下约束：

1. UI 形态直接决定可用性，因此必须以可视 authoring 主路径为中心，而不是在调试页里塞更多表单。
2. 不影响现有内核。现有 `parse-mermaid -> SystemDefinition -> compiler -> runtime` 主链保持不变。
3. `system.mmd` 仍然保留为项目内可读、可 diff、可运行的标准产物。

## 3. Why MMD Text Should Not Stay the Main Editing Surface

当前 `Mermaid Workbench` 仍以文本为中心，问题不是“不能编辑”，而是它让用户承担了太多低层负担：

- 用户需要同时理解 Mermaid 语法、metadata 规则和运行时约束。
- `join.mode.*`、`join.sources.*`、`context.map.*`、`review.*`、`loop.max.*` 这类语义并不适合直接手写。
- 用户每次改图后都要自己重新建立“图结构”和“配置元信息”的映射。
- 文本方式对新用户和调试场景都不友好，容易得到“能 parse，但不好用”的项目。

因此，文本 Mermaid 应退居二线：

- 默认作为导出预览。
- 作为高级模式保留。
- 不再作为主 authoring 真相。

## 4. Core Product Shape

推荐把现有 `visualizer` 产品化为正式 `ogs console`，并分成 4 个明确视图。

### 4.1 Project Home

面向项目状态，而不是面向某个 run。

展示：

- project readiness
- 当前系统摘要
- 最近运行
- 最近失败/待 review
- 快捷动作：`Open Studio`、`Dry Run`、`Open Ops`

### 4.2 Studio

这是主入口，面向“生成一个真正可用的 OGS 项目”。

Studio 只负责：

- 画布建模
- role / edge / metadata 编辑
- 配置联动
- 生成 `system.mmd`
- 运行前验证

### 4.3 Run Console

面向当前 run 的执行与调试。

展示：

- graph
- timeline
- logs
- review
- resume diagnostics

### 4.4 Ops

面向历史 run、恢复、审计和运行维护。

## 5. Studio UI Best Practice

可用性主要由 Studio 决定。推荐采用“画布居中、属性右置、诊断下沉”的形态，而不是把图、运行态、项目配置混在一个页面里。

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

建议 4 个 tab：

- `Diagnostics`
- `Mermaid Preview`
- `Compile Snapshot`
- `Run Setup`

其中：

- `Diagnostics` 显示 parse/compile/static errors
- `Mermaid Preview` 只读展示将要写入的 `system.mmd`
- `Compile Snapshot` 展示 role/join/flow summary
- `Run Setup` 提供一键 `dry-run` 或运行参数预填

## 6. Authoring Data Model

Studio 需要一个独立于 `mmd` 的 canonical 数据结构。建议新增：

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
  layout: {
    nodes: Record<string, { x: number; y: number; width?: number; height?: number }>;
    viewport?: { x: number; y: number; zoom: number };
  };
};
```

设计原则：

- 运行时语义字段和画布布局字段分开。
- 只保留 OGSystem 真正执行需要的概念。
- 不把纯 UI 状态混进 `system.mmd`。

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
- layout -> node positions

### 7.2 `canvas -> authoring`

用于用户拖拽和连接后的保存：

- 更新节点位置
- 更新拓扑连接
- 保留 role/flow 语义字段
- 删除和新增 role/flow

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

## 8. Recommended Save Contract

为了不影响内核，建议引入双文件模式：

- `system.mmd`
  - runtime truth
  - CLI 与现有内核直接消费
- `.ogs/studio/system.authoring.json`
  - Studio truth
  - 画布与 Inspector 直接消费

保存时序：

1. `canvas -> authoring`
2. `authoring -> mermaid`
3. 调用现有校验链验证生成结果
4. 校验通过后写入 `system.mmd`
5. 同时保存 `.ogs/studio/system.authoring.json`

校验失败时：

- 不覆盖已存在的 `system.mmd`
- 保留 draft
- 在 Diagnostics 中精确定位字段

## 9. Import Strategy

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

## 10. Validation Flow

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

这样可以保证：

- 前端先给即时反馈
- 后端再给权威语义反馈
- 内核规则只有一套

## 11. Runtime Isolation

本方案不应改变以下内核边界：

- `src/runtime/parse-mermaid.ts`
- `src/runtime/compiler.ts`
- `src/runtime/adapter.ts`
- `src/runtime/graph-runner.ts`
- `src/runtime/role-executor.ts`

Studio 只能做两类事：

1. 生成或更新 `system.mmd`
2. 调用现有 `validate / doctor / run start`

这意味着：

- runtime 不认识 X6
- runtime 不认识 authoring document
- runtime 仍只认识 `system.mmd` 和现有 `.ogs/*` 配置

## 12. Recommended Frontend Stack

如果目标是类似 X6 的交互，推荐直接采用 X6 作为画布引擎，但只把它当作 view layer。

推荐边界：

- `@antv/x6`: 画布、拖拽、连线、节点布局、缩放、minimap
- 原生 `HTML/CSS/JS` 或轻量客户端脚本：页面壳与状态
- Node 内置 `http`: 服务端

不建议一开始做的事：

- 不要把 X6 的 cell schema 直接当永久存储格式
- 不要让前端直接读写 `.ogs/runs/*`
- 不要要求用户先学 Mermaid 再学画布
- 不要把 run observability 和 Studio 编辑混成一个单页长面板

## 13. Suggested Module Layout

推荐新增 Studio 外壳，不碰 runtime 目录：

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
- `authoring-validate.ts`
  - Studio 前置诊断和现有静态校验编排

## 14. MVP Scope

第一阶段不要追求完整可视化平台，只做真正提升可用性的最小闭环。

### Phase 1

- 正式 `ogs console`
- `Project Home`
- `Studio` 基础布局
- `authoring document`
- `Import MMD`
- `Generate MMD`
- `Validate`
- `Dry Run`

### Phase 2

- X6 画布
- role/edge Inspector
- 自动 `join.sources`
- 诊断内联高亮
- 草稿自动保存

### Phase 3

- 模板库
- 从示例生成
- `nl2mmd` 生成 Studio 初稿
- 一键打开 Run Console

## 15. Non-Goals

当前不建议把以下内容纳入首版：

- 协作编辑
- 多人实时同步
- 浏览器直接操作运行目录
- 替换现有 runtime DSL
- 让 Studio 绕过 `system.mmd` 直接驱动运行

## 16. Final Recommendation

如果目标是“像 X6 一样可视化编辑，但不破坏现有 OGSystem”，正确做法不是把文本编辑器换成画布，而是：

1. 新增 `Studio Authoring Document` 作为设计真相。
2. 用 X6 风格画布做图形编辑入口。
3. 用 Inspector 承接 OGSystem 的 metadata 语义。
4. 稳定导出 `system.mmd`。
5. 继续让现有内核消费 `system.mmd`。

这样既能显著提升可用性和便捷性，也不会触碰现有 runtime 内核边界。
