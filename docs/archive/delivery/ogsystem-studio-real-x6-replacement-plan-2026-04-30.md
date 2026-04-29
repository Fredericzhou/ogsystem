# OGSystem Studio Real X6 Replacement Plan

Date: 2026-04-30
Status: replacement plan
Scope: 将当前 X6-style MVP 替换为真实 `@antv/x6` view layer，同时保持 Studio authoring/API/runtime contract 不变。

## 1. Goal

当前 Studio Bridge 已交付 X6-style graph-first MVP，但没有安装或运行 `@antv/x6`。

本方案目标是把当前 `renderStudioGraphCanvas` 替换为真实 `@antv/x6` 画布层，同时保持：

- `StudioAuthoringDocument` 仍是 authoring truth。
- `StudioCanvasDocument` 仍是 canvas/view adapter contract。
- `system.mmd` 仍是 runtime truth。
- `src/runtime/*`、parser、compiler 不引入 X6。
- 现有 validate/save/dry-run/Run Console 调试闭环不变。

## 2. Target Data Flow

真实 X6 替换后，数据流必须保持为：

```text
StudioAuthoringDocument
-> StudioCanvasDocument
-> X6 Graph cells
-> StudioCanvasDocument
-> POST /api/v1/project/studio/authoring/apply-canvas
-> generated system.mmd
-> existing validate/save/dry-run
```

禁止：

```text
X6 cells -> system.mmd
X6 cells -> runtime
X6 cells -> .ogs/runs
X6 cells -> parser/compiler direct import
```

## 3. Frontend Build Strategy

当前 visualizer 是服务端生成 HTML + 内联原生 JS。真实 `@antv/x6` 需要浏览器 bundle。

推荐引入最小打包链：

- `esbuild`：轻量 browser bundle。
- `@antv/x6`：画布、节点、连线、缩放、拖拽。
- 可选 `@antv/x6-plugin-minimap`：如需 minimap。
- 可选 `@antv/x6-plugin-selection`：如需框选增强。
- 可选 `@antv/x6-plugin-transform`：如需节点尺寸调整。

建议新增脚本：

```json
{
  "scripts": {
    "build:visualizer-client": "esbuild src/visualizer/client/main.ts --bundle --format=iife --global-name=OGSVisualizerClient --outfile=dist/visualizer/client/visualizer.js",
    "build": "pnpm run build:visualizer-client && tsc -p tsconfig.json"
  }
}
```

如果不想让全局 `build` 依赖前端 bundle，可先新增独立脚本：

```json
{
  "scripts": {
    "build:visualizer-client": "esbuild src/visualizer/client/main.ts --bundle --format=iife --global-name=OGSVisualizerClient --outfile=dist/visualizer/client/visualizer.js"
  }
}
```

再由 visualizer 测试或发布流程显式调用。

执行约束：

- 如果页面固定加载 `/assets/visualizer-client.js`，则 `pnpm build` 必须生成这个 bundle。
- 不允许只提供独立脚本但不接入默认 build；否则包发布、测试环境或用户本地运行时容易缺静态文件。
- 可在迁移早期保留独立脚本做开发验证，但最终合入前必须让默认 build 覆盖 browser bundle。

## 4. Suggested Module Layout

新增浏览器端模块：

```text
src/visualizer/client/
  main.ts
  studio-x6-canvas.ts
  studio-canvas-adapter.ts
  studio-x6-styles.css
```

职责：

- `main.ts`
  - 暴露全局 `mountStudioX6Bridge(...)`。
  - 负责从服务端内联 app 接收 bridge/canvas state。

- `studio-x6-canvas.ts`
  - 初始化 X6 `Graph`。
  - 注册节点、边、事件处理。
  - 处理 select、drag、connect、delete、fit、zoom。

- `studio-canvas-adapter.ts`
  - `StudioCanvasDocument -> X6 cells`。
  - `X6 cells -> StudioCanvasDocument`。
  - 不包含 Mermaid serializer。
  - 不 import runtime。

- `studio-x6-styles.css`
  - X6 container 和节点/边样式。
  - 可先由 esbuild loader inline，或由 server 静态服务。

Import 约束：

- `@antv/x6` 只能出现在 `src/visualizer/client/*` 浏览器端模块中。
- `src/visualizer/client-app.ts` 不得直接 import `@antv/x6`。
- `src/visualizer/server.ts` 不得直接 import `@antv/x6`。
- `src/visualizer/page-shell.ts` 不得直接 import `@antv/x6`。
- `src/runtime/*` 不得直接或间接 import `@antv/x6`。
- 当前 inline app 仍是控制面；它只能通过 `window.OGSVisualizerClient.mountStudioX6Bridge(...)` 调用 bundle。

TypeScript 约束：

- 当前主 `tsconfig` 使用 NodeNext 语义时，相对 import 需要兼容 `tsc`。
- 如果浏览器端模块的 import 形式或 loader 配置与主 `tsconfig` 冲突，应新增 `tsconfig.visualizer-client.json` 给 esbuild/browser bundle 使用。
- 不要为了 X6 browser bundle 降低主工程 TypeScript 约束。

## 5. Server Static Asset Route

新增静态资源路由：

```text
GET /assets/visualizer-client.js
GET /assets/studio-x6-styles.css
```

初期可只服务 JS bundle：

```text
dist/visualizer/client/visualizer.js
```

安全约束：

- 静态资源路由只服务固定 allowlist 文件。
- 不做通用目录静态服务。
- 不允许通过 URL path 任意读取 `dist/` 或项目文件。
- 推荐 allowlist：

```text
/assets/visualizer-client.js -> dist/visualizer/client/visualizer.js
/assets/studio-x6-styles.css -> dist/visualizer/client/studio-x6-styles.css
```

页面壳在 `renderPageHtml()` 中插入：

```html
<script src="/assets/visualizer-client.js"></script>
```

或者按需加载：

```js
await import("/assets/visualizer-client.js");
```

如果使用 IIFE bundle，则由全局对象调用：

```js
window.OGSVisualizerClient.mountStudioX6Bridge(...)
```

## 6. Studio Bridge Integration

当前 `renderStudioBridgePanel()` 中心画布区域应替换为 mount point：

```html
<div id="studio-x6-root" class="studio-x6-root"></div>
```

原有 role/flow navigator 和 right inspector 可以保留，X6 selection 只同步现有 state：

```text
X6 node selected -> state.studioBridgeSelectedRoleId
X6 edge selected -> state.studioBridgeSelectedFlowKey
state change -> renderStudioBridge() / inspector update
```

真实 X6 只替换中间画布，不重写 Project Readiness、Config Explain、Ops Summary、Run Console。

## 7. X6 Interaction Contract

### 7.1 Node

Role node:

- label: `roleId` or `title`
- badges:
  - `entry`
  - `M` for `model.bind`
  - `E` for `exec.bind`
  - `P` for `parallel_split`
  - `J` for join
  - `L` for loop
  - `R` for review

Boundary node:

- `input/start`
- `output/__system_end__`
- boundary nodes are not persisted as roles.

### 7.2 Edge

Edge label:

- `eventType`

Edge state:

- `ERROR*` uses warning/error styling.
- join source edge gets join marker.
- selected edge highlights.

### 7.3 Editing

Required MVP behavior:

- Select node -> right inspector role view.
- Select edge -> right inspector flow view.
- Drag node -> update `StudioCanvasDocument.nodes[].x/y`.
- Connect edge -> create canvas edge with default `eventType = "DONE"`.
- Delete node -> delete role and related canvas edges, except entry role.
- Delete edge -> remove canvas edge.
- Fit view -> X6 `graph.zoomToFit()` / `graph.centerContent()`.
- Generate MMD -> call existing generate flow.
- Save system.mmd -> existing save flow.
- Dry Run -> existing start action.

## 8. API Contract

Continue using:

```text
POST /api/v1/project/studio/authoring/apply-canvas
```

Request:

```json
{
  "authoring": {},
  "canvas": {}
}
```

Response:

```json
{
  "authoring": {},
  "canvas": {},
  "systemSource": "flowchart TD...",
  "validation": {}
}
```

Server rules:

- Validate generated Mermaid.
- Do not write `system.mmd`.
- Do not write run artifacts.
- Do not import X6.

## 9. Adapter Rules

`StudioCanvasDocument -> X6 cells`:

```text
canvas.nodes[] -> x6 node cells
canvas.edges[] -> x6 edge cells
node badges -> node attrs / data
edge eventType -> edge label
```

`X6 cells -> StudioCanvasDocument`:

```text
x6 node position -> canvas.nodes[].x/y
x6 node size -> canvas.nodes[].width/height
x6 edge source/target -> canvas.edges[].source/target
x6 edge label/data.eventType -> canvas.edges[].eventType
```

Do not serialize X6-only fields:

- selection state
- hover state
- z-index
- ports internal ids
- plugin metadata
- X6 cell schema itself

## 10. Testing Plan

### 10.1 Unit Tests

Add tests for `studio-canvas-adapter.ts`:

- role nodes convert to X6 cells with badges.
- boundary nodes convert correctly.
- X6 edge converts back to canvas edge with `eventType`.
- X6-only metadata is dropped.
- layout does not enter generated Mermaid.

### 10.2 Server/API Tests

Keep existing coverage:

- `tests/visualizer-studio-authoring.test.mjs`
- `tests/visualizer.test.mjs`

Add if needed:

- static asset route returns JS bundle.
- apply-canvas still does not write `system.mmd`.

### 10.3 Client Tests

Current fake DOM tests should still verify:

- Studio Bridge mount point exists.
- open Bridge loads data.
- save draft works.
- generate MMD works.
- dry-run opens run detail.

Fake DOM is not enough for X6 canvas behavior. Add browser smoke tests.

### 10.4 Browser Smoke Tests

Use Playwright or equivalent:

- Load visualizer page.
- Open Studio Bridge.
- Assert X6 container is non-empty.
- Assert at least one node is visible.
- Select node and verify inspector updates.
- Drag node and call apply-canvas.
- Create edge and verify generated Mermaid validates.
- Fit view does not blank canvas.

执行约束：

- Fake DOM 测试必须保留，用于覆盖 inline app 的控制面、API 调用和非 X6 面板。
- 真实 X6 行为必须通过 Playwright 或等价 browser smoke 验证。
- 不允许只靠 fake DOM 声明 X6 canvas 可用，因为 fake DOM 无法验证真实 canvas/SVG/HTML interaction。

## 11. Implementation Order

1. Install dependencies:

```bash
pnpm add @antv/x6
pnpm add -D esbuild
```

2. Add browser bundle script.

3. Add static asset route.

4. Add `src/visualizer/client/*` modules.

5. Replace Studio Bridge center canvas with `#studio-x6-root`.

6. Wire mount lifecycle:

```text
renderStudioBridge()
-> mountStudioX6Bridge(root, { authoring, canvas, selectedRoleId, selectedFlowKey })
```

7. Wire X6 events:

```text
node:selected
edge:selected
node:moved
edge:connected
node:removed
edge:removed
```

8. On edit, submit:

```text
X6 graph -> StudioCanvasDocument -> apply-canvas
```

9. Update tests.

10. Run regression.

## 12. Regression Commands

Minimum:

```bash
pnpm run test:visualizer
```

Full:

```bash
pnpm test
```

User-path smoke:

```bash
pnpm exec tsx src/visualizer/cli.ts --workdir examples/ogs-gstacklike --host 127.0.0.1 --port 0
```

Then verify:

- page loads
- Studio Bridge opens
- X6 canvas renders nodes/edges
- apply-canvas validation ok
- generate-mmd validation ok
- Project Readiness remains available

## 13. Acceptance Criteria

The replacement is complete when:

- `@antv/x6` is present only in visualizer client bundle code.
- `src/runtime/*` does not import X6.
- `StudioAuthoringDocument` remains canonical authoring truth.
- `StudioCanvasDocument` remains the X6 adapter boundary.
- X6 cells never become persisted project truth.
- `system.mmd` output remains deterministic.
- `apply-canvas` does not write `system.mmd`.
- Existing visualizer tests pass.
- Full test suite passes.
- Browser smoke confirms X6 canvas is non-blank and editable.

## 14. Final Delivery Record Wording

最终交付记录必须明确区分两个阶段：

```text
Before replacement:
X6-style MVP delivered.
No @antv/x6 installed or running.
Graph-first editing is implemented by lightweight HTML/CSS/JS visualizer surface.

After replacement:
Real @antv/x6 introduced in visualizer client bundle.
X6 remains view/editor layer only.
StudioAuthoringDocument remains authoring truth.
system.mmd remains runtime truth.
```

禁止在真实替换完成前写：

```text
@antv/x6 delivered
X6 runtime installed
real X6 canvas editing complete
```

真实替换完成后，交付记录应同时写清：

- `@antv/x6` 已引入的位置。
- browser bundle 产物路径。
- server 静态资源 allowlist。
- runtime/parser/compiler import graph 未引入 X6。
- Playwright/browser smoke 结果。
- `pnpm run test:visualizer` 和 `pnpm test` 结果。
