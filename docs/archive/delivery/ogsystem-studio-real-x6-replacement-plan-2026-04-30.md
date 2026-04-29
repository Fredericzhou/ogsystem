# OGSystem Studio Graph Island X6 Plan

Date: 2026-04-30
Status: implemented and verified
Scope: 用隔离的真实 `@antv/x6` Studio Graph Island 升级 Studio Bridge 图编辑能力，同时不改变 runtime/parser/compiler 内核。

## 1. Decision

当前 Studio Bridge 已有 X6-style graph-first MVP，但图编辑仍是轻量 HTML/CSS/JS surface，不是真实 X6 交互。

本轮不做“把 `renderStudioGraphCanvas()` 原地替换成 X6”的改造。更稳的方案是参考 `/Users/maple/Documents/WorkSpace/OpipeX/opipex/visual-gateway/` 的图谱方案，引入一个隔离的浏览器端 Studio Graph Island：

```text
existing visualizer shell / Studio Bridge control plane
-> isolated Studio Graph Island bundle
-> @antv/x6 canvas
-> existing Studio authoring APIs
-> generated system.mmd
-> existing validate/save/dry-run/Run Console
```

这个方案必须同时满足：

- 图编辑体验显著升级：真实画布、端口连线、拖拽、选择、删除、fit、auto layout、undo/redo、错误提示。
- 现有基本功能不回退：Project Readiness、Config Explain、Ops Summary、Run Console、validate/save/dry-run 保持可用。
- 内核不受影响：`src/runtime/*`、parser、compiler 不引入 X6，也不消费 X6 cells。
- 项目真相不改变：`StudioAuthoringDocument` 是 authoring truth，`system.mmd` 是 runtime truth。

旧 X6-style UI 兼容只是迁移期策略，最终必须删除。内核隔离和 truth 分层不是迁移策略，而是长期架构约束。

## 2. Non-Goals

本轮不做：

- 不把 X6 cells 持久化为项目真相。
- 不让 runtime、parser、compiler import X6。
- 不让 X6 直接生成或写入 `.ogs/runs`。
- 不重写 visualizer 整体 UI。
- 不引入独立后端服务或数据库。
- 不把 Studio authoring 绕过 `system.mmd` 直接接入运行内核。

## 3. Migration Phases

### Phase 1: Transition

Keep the old X6-style MVP as a development and rollback guard while the real `@antv/x6` Graph Island is wired.

Exit criteria:

- real X6 renders the Studio graph.
- selection updates the existing inspector.
- drag updates canvas layout.
- connect/delete update authoring commands.
- Generate MMD, save, and dry-run still use existing flows.
- import guardrails pass.
- browser smoke passes.
- `pnpm run test:visualizer` passes.

### Phase 2: Switch

Real X6 is the default graph editor. The old X6-style UI may exist only as a hidden fallback or feature flag for release diagnostics.

Rules:

- no user-facing duplicate graph editors.
- fallback must not be the default path.
- fallback must not introduce a second runtime path or second authoring truth.

### Phase 3: Final State

Remove the old X6-style center graph UI and related event handlers. Only the real `@antv/x6` Graph Island remains.

Permanent constraints still apply:

- runtime/parser/compiler still do not import `@antv/x6`.
- `system.mmd` remains runtime truth.
- X6 cells never become project truth.
- `StudioAuthoringDocument` remains authoring truth.

## 4. Core Architecture

新增一个纯浏览器端 bundle：

```text
src/visualizer/studio-client/
  main.ts
  studio-graph.ts
  studio-graph-render.ts
  studio-graph-adapter.ts
  studio-graph-commands.ts
  studio-graph-rules.ts
  styles.ts
```

新增一个纯 contract 文件，供 Node 端和 browser bundle 共享类型：

```text
src/visualizer/studio-contracts.ts
```

`studio-contracts.ts` 只能包含类型、常量和纯数据 helper，不得 import：

- `node:*`
- `src/runtime/*`
- parser/compiler/project projection
- `@antv/x6`

现有 `src/visualizer/studio-authoring.ts` 继续负责 parse/serialize/validate/save authoring draft；browser bundle 不得 value import 该文件。

## 5. Data Contract

保持现有 truth 分层：

```text
StudioAuthoringDocument  authoring truth
StudioCanvasDocument     view/layout + flow adapter boundary
system.mmd               runtime truth
```

新增浏览器端投影 contract：

```text
StudioGraphProjection
  nodes: role nodes + input/output boundary nodes
  edges: flow edges
  capabilities: editable flags
  validation: node/edge diagnostics
```

X6 只消费 `StudioGraphProjection`，不消费 runtime 内部结构。

## 6. Edit Flow

编辑事件分为两类，不能混用。

### 6.1 Canvas Patch

只用于不会改变 authoring 结构的编辑：

- move node
- resize node
- update viewport
- fit / auto layout

流程：

```text
X6 graph snapshot
-> StudioCanvasDocument
-> POST /api/v1/project/studio/authoring/apply-canvas
-> generated systemSource + validation
```

### 6.2 Authoring Command

用于会改变 authoring 结构或语义的编辑：

- add role
- delete role
- update role title/binding metadata
- connect edge
- delete edge
- change edge eventType

流程：

```text
X6 interaction
-> StudioAuthoringCommand
-> update StudioAuthoringDocument in client state
-> derive StudioCanvasDocument
-> POST /api/v1/project/studio/authoring/apply-canvas
-> generated systemSource + validation
```

执行约束：

- 新增/删除 role 必须先更新 `StudioAuthoringDocument.roles`，不能只把 X6 node 放进 canvas。
- 删除 role 必须同步删除相关 authoring flows 和 layout。
- 连接 edge 必须生成或更新 `StudioAuthoringDocument.flows`，默认 `eventType = "DONE"`。
- `apply-canvas` 仍然不写 `system.mmd`，只返回 generated Mermaid 和 validation。

## 7. X6 Interaction Contract

必须支持：

- Select role node -> right inspector role view.
- Select edge -> right inspector flow view.
- Drag node -> dirty layout state.
- Connect role output port to role/input port -> create flow command.
- Delete selected role -> confirm, block entry role deletion.
- Delete selected edge -> remove flow command.
- Fit view -> `graph.zoomToFit({ padding })`.
- Auto layout -> update canvas layout only.
- Undo/redo -> X6 history + resync draft.
- Blank click -> clear selection.
- Validation diagnostics -> node/edge warning/error styling.

Node display:

- label: `title || roleId`
- badges: `entry`, `M`, `E`, `P`, `J`, `L`, `R`
- boundary nodes: `input/start`, `output/__system_end__`
- boundary nodes are view-only and never persisted as roles.

Edge display:

- label: `eventType`
- `ERROR*` edges use warning/error styling.
- join source edges get a join marker.
- selected edge highlights.

## 8. UX Shape

Keep the current Studio Bridge shell and replace only the center graph area:

```html
<div id="studio-graph-root" class="studio-graph-root"></div>
```

The existing shell call boundary remains:

```ts
window.OGSVisualizerClient.mountStudioX6Bridge(root, options)
```

The old X6-style center graph controls are a migration fallback only. During Phase 1 they stay available while the real X6 editing path is wired. During Phase 2 real X6 is default and the old UI may exist only as a hidden fallback or feature flag. During Phase 3 remove the old HTML node/edge buttons and MVP controls such as add-edge/add-role/nudge-left/nudge-right. Those actions move into the X6 toolbar, context menu, and authoring command callbacks.

The graph island owns:

- X6 graph lifecycle.
- toolbar: zoom in/out, fit, auto layout, undo, redo, delete.
- context menu: add downstream role, add upstream role where valid, duplicate role, delete role.
- connection validation and toast feedback.
- non-empty / loading / error states.

The existing shell owns:

- Studio top actions.
- right inspector.
- Project Readiness.
- Config Explain.
- Ops Summary.
- Run Console.
- validate/save/generate/dry-run actions.

The graph island must expose the existing visualizer client global API:

```ts
window.OGSVisualizerClient.mountStudioX6Bridge(root, options)
window.OGSVisualizerClient.disposeStudioX6Bridge(root)
```

The inline app and the bundle must both merge into the shared global object and must not replace the whole object:

```ts
window.OGSVisualizerClient = window.OGSVisualizerClient || {};
Object.assign(window.OGSVisualizerClient, {
  mountStudioX6Bridge,
  disposeStudioX6Bridge
});
```

The page may load the bundle before or after the inline app. Both sides must tolerate either order by using the same merge-only pattern.

`mountStudioX6Bridge` must be idempotent. If the same root is remounted, it must update the existing graph instead of leaking X6 instances.

## 9. Build Strategy

Install dependencies:

```bash
pnpm add @antv/x6 @antv/x6-plugin-history @antv/x6-plugin-keyboard @antv/x6-plugin-selection dagre
pnpm add -D esbuild @types/dagre @playwright/test
```

Add scripts:

```json
{
  "scripts": {
    "typecheck:studio-client": "tsc -p tsconfig.visualizer-client.json --noEmit",
    "build:studio-client": "esbuild src/visualizer/studio-client/main.ts --bundle --format=iife --global-name=OGSStudioGraphBundle --outfile=dist/visualizer/studio-client/studio-graph.js",
    "test:studio-import-guardrails": "node --test tests/visualizer-studio-import-guardrails.test.mjs",
    "test:visualizer-browser": "pnpm build && playwright test tests-e2e/visualizer-studio-graph.spec.ts",
    "build": "pnpm run typecheck:studio-client && pnpm run build:studio-client && tsc -p tsconfig.json",
    "test:visualizer": "pnpm build && pnpm run test:studio-import-guardrails && node --test tests/visualizer-client.test.mjs tests/visualizer-data.test.mjs tests/visualizer-ops-summary.test.mjs tests/visualizer-project-readiness.test.mjs tests/visualizer-studio-authoring.test.mjs tests/visualizer.test.mjs"
  }
}
```

`OGSStudioGraphBundle` is only an internal IIFE namespace produced by esbuild. The shell must never call `window.OGSStudioGraphBundle` directly. The only shell-facing API is `window.OGSVisualizerClient.mountStudioX6Bridge(...)`.

Add `tsconfig.visualizer-client.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": [],
    "noEmit": true
  },
  "include": ["src/visualizer/studio-client/**/*.ts", "src/visualizer/studio-contracts.ts"]
}
```

Update root `tsconfig.json`:

```json
{
  "exclude": ["src/visualizer/studio-client/**"]
}
```

Reason: the browser bundle has DOM/X6 dependencies and must not weaken the NodeNext constraints of the main project.

`styles.ts` injects the graph island CSS into the root element. Keep the first implementation to one JS asset so the server does not need a second static route.

## 10. Static Asset Route

Add allowlisted asset routes only:

```text
GET /assets/studio-graph.js -> dist/visualizer/studio-client/studio-graph.js
```

Rules:

- No generic static directory serving.
- No URL path to filesystem mapping.
- Return `404` for any non-allowlisted asset.
- `pnpm build` must always produce the JS bundle before packaging or tests.

Page shell loads:

```html
<script src="/assets/studio-graph.js"></script>
```

## 11. Integration Steps

1. Extract pure shared types from `studio-authoring.ts` into `studio-contracts.ts`.
2. Add `studio-client` bundle with a minimal non-editing X6 render.
3. Add allowlisted `/assets/studio-graph.js` route.
4. Replace `renderStudioGraphCanvas()` center HTML with `#studio-graph-root`.
5. Keep the old center graph controls temporarily as a fallback while real X6 render/edit paths are being wired.
6. In `renderStudioBridge()`, call `mountStudioX6Bridge(root, options)` after shell render.
7. Wire selection callbacks to existing `state.studioBridgeSelectedRoleId` and `state.studioBridgeSelectedFlowKey`.
8. Add canvas patch support for drag/fit/auto layout.
9. Add authoring commands for add/delete role and add/delete edge.
10. Add X6 history, keyboard, selection, and connection rules.
11. Pass import guardrails and browser smoke for the full X6 editing path.
12. Remove old center-graph event handlers and controls for `studio-bridge-add-role`, `studio-bridge-add-edge`, `studio-bridge-delete-role`, `studio-bridge-fit`, `studio-bridge-nudge-left`, and `studio-bridge-nudge-right`.
13. Add final regression tests and run regression.

## 12. Import Guardrails

Add a hard CI test, preferably `tests/visualizer-studio-import-guardrails.test.mjs`, and run it through `node --test`. It must fail if:

```text
@antv/x6 appears outside src/visualizer/studio-client/**
src/visualizer/studio-client/** imports src/runtime/**
src/visualizer/studio-client/** imports src/visualizer/studio-authoring.ts
src/runtime/** imports @antv/x6
```

The bundle must also avoid Node built-ins:

```text
node:fs
node:path
node:http
node:url
```

## 13. Phase Gates

Phase 1 cannot exit until both gates pass:

1. Import guardrails pass and prove X6 is isolated to `src/visualizer/studio-client/**`.
2. Browser smoke passes the full user path: render, select, drag, connect, delete, validate, generate MMD, save through the existing flow, dry-run through the existing flow.

Only after both gates pass may Phase 2 make real X6 the default editor. Phase 3 removes the old X6-style center graph controls. The final shipped state must not contain two graph editors.

## 14. Testing Plan

Unit tests:

- `StudioGraphProjection -> X6 cells` maps role nodes, boundary nodes, badges, edges.
- `X6 graph snapshot -> StudioCanvasDocument` drops X6-only fields.
- authoring commands add/delete roles and flows correctly.
- entry role deletion is blocked.
- layout changes do not enter generated Mermaid semantics.

Server/API tests:

- `/assets/studio-graph.js` serves only the bundle.
- unknown `/assets/*` returns 404.
- `apply-canvas` still does not write `system.mmd`.
- generated `system.mmd` remains deterministic.
- import guardrails pass.

Client fake DOM tests:

- Studio Bridge mount point exists.
- opening Studio Bridge loads data.
- selection callback updates inspector state.
- save draft works.
- generate MMD works.
- dry-run opens existing run action.
- Phase 3 final state has no old center graph edit buttons.

Browser smoke tests:

- load visualizer.
- open Studio Bridge.
- X6 container is non-empty.
- at least one role node is visible.
- select node and inspector updates.
- drag node and validation remains ok.
- connect role edge and generated Mermaid validates.
- delete edge and generated Mermaid validates.
- fit view does not blank canvas.
- Run Console and Project Readiness still render.

## 15. Regression Commands

Minimum:

```bash
pnpm run test:visualizer
```

Full:

```bash
pnpm test
```

Browser:

```bash
pnpm run test:visualizer-browser
```

Manual user path:

```bash
pnpm exec tsx src/visualizer/cli.ts --workdir examples/ogs-gstacklike --host 127.0.0.1 --port 0
```

Verify:

- page loads.
- Studio Bridge opens.
- X6 graph renders nodes/edges.
- graph edit -> validation ok.
- Generate MMD -> validation ok.
- Save system.mmd uses existing save flow.
- Dry Run opens existing start flow.
- Project Readiness and Run Console remain available.

## 16. Acceptance Criteria

Complete when:

- Real `@antv/x6` renders the Studio graph.
- X6 import is limited to `src/visualizer/studio-client/**`.
- browser bundle does not import runtime/parser/compiler/Node built-ins.
- `StudioAuthoringDocument` remains canonical authoring truth.
- `system.mmd` remains runtime truth.
- X6 cells are never persisted as project truth.
- add/delete role and add/delete edge go through authoring commands.
- layout edits go through canvas patch.
- Phase 1 keeps old controls only as migration fallback.
- Phase 2 defaults to real X6 and allows old UI only as hidden fallback or feature flag.
- Phase 3 removes old X6-style center graph controls, so there is only one graph editor.
- import guardrails and browser smoke are passing phase gates.
- `apply-canvas` does not write `system.mmd`.
- existing visualizer and project/debug panels still work.
- fake DOM tests, API tests, import guardrails, and browser smoke pass.

## 17. Delivery Record Wording

Before implementation, delivery notes may only say:

```text
X6-style MVP delivered.
Real @antv/x6 replacement is planned as an isolated Studio Graph Island.
Runtime/parser/compiler remain unchanged.
```

After implementation, delivery notes must include:

- `@antv/x6` dependency and exact client path.
- bundle output path.
- static asset allowlist.
- import guardrail result.
- browser smoke result.
- `pnpm run test:visualizer` result.
- `pnpm test` result.

Do not claim “real X6 editing complete” until browser smoke confirms non-blank render and editable node/edge interactions.

## 18. Delivery Record

Implemented on 2026-04-30.

- `@antv/x6` dependency: `@antv/x6@^2.19.2`, isolated under `src/visualizer/studio-client/**`.
- X6 plugins: `@antv/x6-plugin-history`, `@antv/x6-plugin-keyboard`, `@antv/x6-plugin-selection`; layout uses `dagre`.
- Shared contract path: `src/visualizer/studio-contracts.ts`.
- Browser bundle entry: `src/visualizer/studio-client/main.ts`.
- Bundle output path: `dist/visualizer/studio-client/studio-graph.js`.
- Static asset allowlist: `GET /assets/studio-graph.js` only; unknown `/assets/*` returns `404`.
- Studio Bridge mount point: `#studio-graph-root`.
- Old center graph edit controls removed: `studio-bridge-add-role`, `studio-bridge-add-edge`, `studio-bridge-delete-role`, `studio-bridge-fit`, `studio-bridge-nudge-left`, `studio-bridge-nudge-right`.
- Import guardrail result: `pnpm run test:studio-import-guardrails` passed.
- Browser smoke result: `pnpm run test:visualizer-browser` passed.
- Visualizer regression result: `pnpm run test:visualizer` passed.
- Full regression result: `pnpm test` passed.
