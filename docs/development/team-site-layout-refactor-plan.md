# Team Site 版面重构方案（迁移与仓库内收尾完成，人工目视验收待签）

## 文档权威与范围

本文是 Team Site 前端（`apps/team-site/public`）版面重构的唯一方案，同时记录实施进展。当前状态为**迁移主体与仓库内收尾完成；阶段 0 基线截图逐页对照及浅/深色逐模板目视签收仍待人工完成**。范围只含 Team Site 的应用外壳与各产品页面的**版面、响应式和视觉一致性**；`src/visualizer` 的 page-shell 与 Studio 图编辑器画布本身不在本轮范围，之后单独评估。

硬性约束：

- 不改功能逻辑：API 调用、路由、渲染函数的数据处理、`isDirty` 离开确认、轮询与恢复逻辑保持不变。
- 不改 DOM 钩子：现有 `id`、`data-*`、`aria-*`、测试依赖的 class 不删除、不改名。需要新增的钩子只加不改。
- 技术栈不变：原生 ESM、`styles.css`、`node:test`、Playwright。不引入框架或构建步骤。
- 只改本方案列出的文件。`public/app/views/shared-resources.js` 承担角色仓库和平台数据/工具/存储页面，属于页面迁移文件；`public/app/views/app.js` 的渲染函数仍只做容器与页面布局改动。工作区里已有的未提交改动属于其他工作，不在本方案范围内，见“阶段 0”。

## 现状（已核实）

### 外壳与样式

| 项 | 现状 | 依据 |
|---|---|---|
| 外壳 | `.app-shell` 为 232px 侧栏 + 主区；页面靠浏览器整页滚动，侧栏用 `position:sticky; height:100vh` 固定 | `styles.css:120-121` |
| 页面容器 | 每个视图自带 `.page-content`：`max-width:1500px; margin:0 auto`，另有 `.alternate-view{min-height:calc(100vh - 61px)}` | `styles.css:161,703` |
| 重复覆盖 | `.page-content` padding 在 6 处定义，`.page-heading h1` 字号在 3 处定义 | `styles.css:161/767/789/900/938/1565`、`165/791/902` |
| 断点 | 约 35 个 `@media`，涉及 420/560/600/620/700/760/900/1000/1050/1100 共 10 个宽度 | `styles.css` |
| 高度魔法数字 | 团队设计工作台 `calc(100dvh - 190/235/185/248px)` | `styles.css:1246-1274` |
| 侧栏 | 不可收起；导航图标 5 项共用 `glyph-grid`；手机端变成顶部横条并隐藏工作区切换与状态 | `index.html`、`styles.css:938` |
| 深色模式 | `:root[data-visualizer-theme="dark"] .xxx` 逐选择器覆盖，颜色硬编码 | `styles.css:1086` 起 |
| 路由切换滚动 | `window.scrollTo({top:0})` | `app/router.js` |

### 路由与视图映射（以 `syncRoute()` 为准）

| 路由 | 渲染函数 | 视图容器 |
|---|---|---|
| `/projects` | `renderCollaborationProjects` | `projects-view` |
| `/projects/new` | `renderProjectCreate` | `new-project-view` |
| `/projects/:id`、`/projects/:id/runs/:runId` | `renderProjectRun` | `project-workspace-view` |
| `/projects/:id/teams` | `renderProjectTeams` | `project-workspace-view` |
| `/history` | `renderHistory` | `history-view` |
| `/teams` | `renderProjectLibrary` | `workspace-view`（落地与案例选择） |
| `/examples`、`/cases/:id` | `renderCases` / `renderDetail` | `examples-view`、`case-detail-view` |
| `/studio` | `renderStudioOverview` | `studio-view` |
| `/studio/roles` | `renderSharedResourcePage(...,"roles")` | `studio-view` |
| `/studio/new` | `renderNewProject` | `new-project-view` |
| `/studio/teams/:id/info` | `renderStudioTeamInfo` | `studio-view` |
| `/studio/teams/:id/design` | `renderProjectStudio` | `studio-view` |
| `/studio/teams/:id/run` | `renderStudioRunPage` | `studio-view` |
| `/studio/teams/:id/run/:runId` | `renderStudioRunDetail` | `studio-view` |
| `/studio/teams/:id/release` | `renderStudioReleaseGate` | `studio-view` |
| `/platform`、`/platform/models` | `renderPlatformConfig` | `platform-view` |
| `/platform/data|tools|storage` | `renderSharedResourcePage` | `platform-view` |

两个与早期设想不同的事实：

1. **项目运行详情不是独立页面。** `/projects/:id` 与 `/projects/:id/runs/:runId` 渲染同一个 `renderProjectRun`，`runId` 只用于聚焦并滚动到对应运行。因此项目工作区按“一个页面、多个分区”处理，不拆出主从详情页。
2. **团队仿真有两个真实路由：** `/studio/teams/:id/run`（列表）与 `/studio/teams/:id/run/:runId`（证据详情）。

### 数据能力与分页

| 数据 | 来源 | 服务端分页 |
|---|---|---|
| 团队仓库 | `GET /api/v1/team-repository` 支持 `query/category/status/sort/page/pageSize`，返回 `pagination` | 有，但 `pageSize` 上限 50 |
| 协作项目、平台、共享资源 | 各自列表接口 | 无 |
| 最近运行 | `GET /api/v1/projects/runs/recent?limit=50` | 仅 `limit` |
| 运行事件 | `cursor/limit` | 有，属于事件流，不是列表页分页 |

页面当前的用法决定了**本轮不新增分页控件**：

- 团队仓库页请求 `pageSize=50` 后在前端过滤掉协作团队（`teamProjectId` / `projectType === "collaboration"`），所以服务端的 `total/totalPages` 与页面可见数量不一致。把它接成分页器会得到错误页数。
- 其余列表没有分页接口。只给当前数据做“前端分页”会制造完整分页的假象。

结论：所有列表页用“区域内滚动 + 前端搜索/筛选”，不做分页器。分页留作单独的后续事项（需要先让团队仓库页改为由服务端过滤协作团队，并修正 `pageSize` 上限与调用方的不一致，见“已知相关问题”）。

### 已知相关问题（只记录，不在本轮修）

- `shared-resources.js:100` 请求 `pageSize=100`，而服务端把 `pageSize` 限制在 50 以内，角色仓库实际最多拿到 50 条。

## 设计规则

### 滚动规则

浏览器文档不滚动（`html, body {height:100dvh; overflow:hidden}`）。顶栏和侧栏不随内容滚动。滚动区域由模板明确，可以包含一个或多个主滚动区；面板内部只在下表允许的位置再设滚动，禁止其他嵌套。

| 模板 | 主滚动区（可多个） | 允许的额外滚动区 | 禁止 |
|---|---|---|---|
| A 列表 | 列表/网格区 | 无 | 页头、工具栏滚动 |
| B 工作台 | 各面板（左、主、右）各自滚动 | 面板内表格；Studio 画布自身已有的横向视口滚动 | 外层 `.page` 再滚动 |
| C 主从详情 | 左列表、右详情各自滚动 | 无 | 外层 `.page` 再滚动 |
| D 配置 | 表单/表格主体 | 宽表格的横向滚动 | 保存条随内容滚走 |
| E 表单页 | `.page` 整体 | 无 | 内部再设滚动 |
| 落地页 | 文档级（独立布局，不套外壳规则） | 无 | — |

侧栏自身内容过长时内部纵向滚动，这是外壳规则，不计入页面滚动区。

### 令牌

在 `:root` 定义，旧变量保留并逐步改为引用新令牌：

- 尺寸：`--nav-w`（232px / 收起 56px）、`--topbar-h`（48px）、`--gutter: clamp(12px, 1.6vw, 24px)`、`--gap-1..4`（4/8/12/16px）、`--radius: 6px`。
- 断点只保留三个：`<768` 手机、`768–1199` 平板、`≥1200` 桌面。面板内部自适应优先用 container query。

### 字号与点击区域

不做全局硬替换。规则：

- 触屏（`@media (pointer: coarse)`）下，可点击控件的点击区域不小于 44px，表单控件字号不小于 16px。
- 桌面保持信息密度：工具栏、密集表格、徽标可保留现有 11–13px，逐页评估后再调整。
- 不批量删除 9–11px 样式。只有逐页检查确认影响可读性的才改，并在进度表“备注”列记录。

### 组件层（先做薄）

新增 `public/app/components/page-frame.js`，**第一版只提供一个函数**：

```
pageFrame({ template, title, subtitle, back, status, actions, tabs, body })
```

只负责输出页头、Tab 栏和正文容器，并设置 `data-template` 与 `data-fit`。`splitPane`、`bottomSheet`、统一的空/载入/错误状态组件**不预先抽取**，只有在迁移中同一结构在三处以上重复出现时再提取，并在进度表记录。各视图的业务渲染函数、事件绑定保持不变，只替换外层容器。

## 目标版面

### 外壳

```
┌───────┬────────────────────────────────────────┐
│ 侧栏   │ 顶栏（固定 48px）面包屑 · 页面操作 · 工具 │
│ 232 /  ├────────────────────────────────────────┤
│ 56px   │ 页面区（按模板，见滚动规则）               │
└───────┴────────────────────────────────────────┘
```

- 侧栏：顶部品牌与收起按钮（快捷键 `[`）；收起后仅图标，悬停显示 tooltip；8 个导航链接各用独立图标；分组标签收起后变分隔线；底部保留工作区切换与运行状态。状态存 `localStorage`，读写必须 try/catch，失败时按视口默认值渲染。
- 响应式：`≥1200` 默认展开；`768–1199` 默认收起为图标栏；`<768` 为抽屉（顶栏汉堡按钮打开，带遮罩，路由切换后关闭，打开时焦点移入、关闭后焦点还原、Esc 关闭）。
- 顶栏：手机只保留汉堡、面包屑、页面主操作和“更多”菜单，其余工具（模式、主题、语言）收入菜单。
- 路由切换：重置当前主滚动区的 `scrollTop`，替换 `window.scrollTo`。

### 模板

| 模板 | 页面 | 结构 |
|---|---|---|
| A 列表 | `/projects`、`/history`、`/studio`、`/studio/roles`、`/examples` | 单行页头（标题、数量、搜索/筛选、主操作）→ 列表区。网格 `repeat(auto-fill, minmax(260px,1fr))` 或紧凑行；不做分页器 |
| B 工作台 | `/projects/:id`（含 `/projects/:id/runs/:runId`）、`/projects/:id/teams`、`/studio/teams/:id/design` | 单行页头 + Tab（资料/任务/运行/团队）→ 面板区。项目工作区为一页多分区；设计页高度由 grid 的 `1fr` 提供，删除 `calc(100dvh - Npx)`，画布组件不改 |
| C 主从详情 | `/studio/teams/:id/run`（列表）与 `/studio/teams/:id/run/:runId`（证据） | 左 320px 列表 + 右详情；手机端栈式切换，带返回 |
| D 配置 | `/studio/teams/:id/info`、`/studio/teams/:id/release`、`/platform/*` | 页内 Tab + 两列表单区；保存条固定在底部。`/platform/*` 合并为一个页面框架，Tab 对应路由。团队全局配置仍在团队设计的资产弹框中，不迁移至此页 |
| E 表单页 | `/projects/new`、`/studio/new` | 单列表单（`max-width:880px` 靠左）+ 右侧说明面板；手机单列 |
| 独立 | `/teams`、`/cases/:id` | `/teams` 为落地与案例选择，保留独立布局；`/cases/:id` 沿用外壳，内容单页滚动 |

通用规则：取消 `.page-content` 的 `max-width:1500px` 居中，内容铺满页面区，仅纯文本与表单限宽；去掉 eyebrow 和 31px 大标题，副标题改为标题旁单行；不嵌套卡片，仅可点击对象用卡片；空/载入/错误提示在所在区域内显示，不撑高整页。

浮层统一为确认对话框、右侧抽屉（`run-drawer`、任务审核）和手机端底部面板，沿用现有元素，只统一尺寸与层级令牌。

## 实施阶段

每阶段按退出条件验收并更新文档。工作区含有先前的未提交改动；本轮不提交、不暂存这些改动，是否提交由用户在所有工作完成后决定。`docs/development/release-uat-checklist.md` 属于独立发布验收清单，不纳入本布局方案的文件范围或布局提交。

### 阶段 0：基线（不提交、不改动现有改动）

- [x] 不提交、不 stash、不还原工作区里已有的未提交改动；记录当前 `git status --short` 与 `git diff --stat` 到“进展记录”。
- [x] 运行 `pnpm --dir apps/team-site test --test-concurrency=1`，记录通过/失败/跳过数与失败项（如有，标注为改动前既有失败）。
- [x] 为后续迁移清单中的每个页面各截一张基线图，视口为 1440×900、1024×768、390×844；项目和团队使用固定的本地测试数据，避免截图间内容变化。路由覆盖：`/projects`、`/projects/new`、一个项目工作区及其 `/projects/:id/runs/:runId` 聚焦状态、`/projects/:id/teams`、`/history`、`/studio`、`/studio/roles`、`/studio/new`、一个团队的 info/design/run 列表/run 详情/release、`/platform/models`、`/platform/data`、`/platform/tools`、`/platform/storage`、`/teams`、`/examples`、一个 `/cases/:id` 详情页。
- [x] 基线图仅用于本轮人工对照，不作为长期测试快照提交。保存在 `apps/team-site/tests/layout-baseline/`，将该目录加入本机 `.git/info/exclude`，不改共享 `.gitignore`；在“进展记录”注明目录、截图路由和视口。截图保留到所有页面迁移及对照验收完成，再按本机工作区清理；如后续需要长期视觉回归，只将选定页面的正式 Playwright 快照纳入版本控制。
- [x] 记录当前 `tests/visual-acceptance.test.mjs` 中与布局相关的断言（`.primary-nav` 可见性、手机导航不撑宽页面、`documentElement.scrollWidth` 不超出）作为需保持的不变量。

退出条件：基线测试结果、截图与不变量清单写入“进展记录”。

### 阶段 1：外壳与令牌

文件：`public/index.html`、`public/shell.css`（令牌与外壳段，加载在旧 `styles.css` 后）、`public/app/router.js`、`public/app/views/app.js`（仅侧栏收起、抽屉、滚动重置相关）、`public/app/state.js`（仅本地化存储不可用时的默认语言回退）。

- [x] `html, body` 固定为视口高度、不滚动；`.app-shell` 改为 grid，主区为“顶栏 + 页面区”。
- [x] 侧栏收起/展开、`localStorage` 持久化、快捷键、tooltip、抽屉模式与焦点管理。
- [x] 8 个导航链接各配独立图标。
- [x] 顶栏手机端折叠。
- [x] 路由切换重置主滚动区。

退出条件：所有现有页面可打开且无整页滚动条；现有测试与阶段 0 结果一致；外壳验收项（见下）全部通过。此阶段页面内部尚未重排，允许内容过长时由页面区整体滚动。

### 阶段 2：`pageFrame` 与样板页

文件：`public/app/components/page-frame.js`、`public/styles.css`、`public/app/views/app.js`（仅 `renderCollaborationProjects`）。第一版逐页迁移页头结构，保留现有主操作、状态、返回入口与测试钩子；不把旧页面整体包进新容器后视作统一完成。

- [x] 实现 `pageFrame` 与模板 A 的 CSS。
- [x] 迁移 `/projects`，保留 `#projects-view` 内所有既有 id/data 钩子。

退出条件：样板页在 1440×900、1024×768、390×844 下均可见；固定 fixture 下列表区实际滚动而页头不动；无横向溢出；项目创建、列表加载/空/错误状态、删除与打开项目行为通过测试。人工截图对照统一按下方“人工”验收项跟踪，不因样板页自动化通过而视为完成。

### 阶段 3：A 类与 E 类

为 `/history`、`/studio`、`/studio/roles`、`/examples`、`/projects/new`、`/studio/new` 接入外层页面框架；除模板 E 的表单外层布局外，旧视图内部结构保留，不把包装计作内部重排。`/studio/roles` 的 renderer 位于 `public/app/views/shared-resources.js`。不新增分页器。保留现有表单 ID/data 钩子，并验证桌面双栏与手机单列。

- [x] 完成逐页外框接入和样式审查；共享 CSS 未按单页误删。旧的共享选择器仍服务于原页面内部结构和独立工作区，精确删除范围列入阶段 7 收尾记录。

退出条件：以上 6 个路由通过三视口自动几何/溢出检查、L2/L8/L11 检查和既有表单/筛选/历史清理交互回归；截图的人工逐页目视对照单独留在人工验收项，不能以通用滚动标记或自动几何检查代替。所有既有 ID/data 钩子保留。共享 CSS 消费者分析延后到阶段 7。

### 阶段 4：D 类

为 `/platform/*`、`/studio/teams/:id/info`、`/studio/teams/:id/release` 接入框架包装。平台四页共用外层框架，Tab 与路由联动，侧栏“要素配置”保留四个入口（避免改变既有导航行为），Tab 作为页内同步切换；原有设置和表单内容由各视图继续渲染。共享数据、工具、存储及角色仓库由 `shared-resources.js` 渲染；团队信息页不承载全局配置，全局配置继续留在团队设计资产弹框。

退出条件：平台 Tab 点击、直接 URL、浏览器前进/后退均与路由一致（已由 `tests/layout-acceptance.test.mjs` 验证）；模型发现与缓存（`tests/platform-use-cases.test.mjs`）、模型探测（`tests/platform-use-cases.test.mjs`）、平台设置读写持久化（`tests/platform-api-routes.test.mjs` 与 `tests/run-polling.test.mjs`）、数据集/工具/存储资源路由（`tests/shared-resource-api-routes.test.mjs`）以及端到端模型发现流程（`tests/classic-team-flow.test.mjs`、`tests/product-logic-acceptance.test.mjs`）均有自动化用例覆盖；团队信息和发布检查原有操作可用；三视口自动几何检查通过。浅/深色全模板截图人工验收仍单独待签。

### 阶段 5：C 类

将 `/studio/teams/:id/run` 与 `/studio/teams/:id/run/:runId` 接入 C 类外框。两个路由仍分别渲染列表与证据详情，并以现有组合视图实现主从关系和手机端返回列表状态。保留证据加载、轮询与错误状态逻辑，详情轮询不得重置列表滚动位置或选中项。

退出条件：以真实/固定仿真记录验证列表选择、详情证据、轮询更新、错误状态、返回列表、刷新和浏览器前进/后退；桌面左右独立滚动、手机栈式切换与三视口截图通过。

### 阶段 6：B 类（完成）

目标范围是项目工作区、项目团队页、团队设计页。三者均已接入 B 模板外框；项目工作区提供“概况 / 资料 / 任务与运行 / 团队”分区导航。桌面与平板宽屏（≥1024px）下，概况、资料、交付和任务面板独立滚动；窄屏改为纵向页面滚动。保留原有项目操作和运行详情聚焦行为。

退出条件：项目工作区的分区导航及响应式滚动行为由 `layout-acceptance.test.mjs` 验证；`visual-acceptance.test.mjs` 覆盖项目创建、团队挂载调整、资料上传、任务运行、Run 聚焦路由和重试。Studio 图谱画布尺寸、缩放、拖拽、资产浮窗、调试浮窗和固定侧栏由布局及 Studio 浏览器回归覆盖。真实目标业务流程及真实设备签收仍由独立 Release UAT 清单管理，不作为本阶段的自动化退出条件。

### 阶段 7：收尾（仓库内工作完成；人工签收见下方）

- [x] 审计并合并可证明等价的重复 `@media` 规则和逐选择器深色覆盖；外壳断点收敛为三个。`styles.css` 仍保留组件宽度、横屏高度与减少动态效果规则，它们不等价于外壳断点；`shell.css` 保留粗指针触屏规则。逐项合并/删除会改变 Studio 图谱、平台表单或窄屏列表行为，因此保留。
- [x] 逐页检查密集区域的字号与触屏点击区域，按“字号与点击区域”规则调整。`layout-acceptance.test.mjs` 对 19 个路由执行 390px 触屏目标尺寸检查；发现并修正调试主按钮与平台保存按钮低于 44px 的级联问题。
- [x] 删除可由仓库内消费者搜索确认不再引用的旧 CSS，记录行数变化。移除 `.nav-glyph`、`.glyph-grid`、`.glyph-spark`、`.glyph-clock`、`.glyph-info` 与 `.avatar-button` 的旧基础、响应式和深色规则；侧栏实际使用 `.nav-icon`、`.workspace-avatar`，相关 CSS 保留。`styles.css` 累计差异为 +3/-33 行（净减 30 行，含媒体规则合并和重复 active 规则删除）。仅按仓库内静态引用确认；动态模板、API 生成内容和图编辑器相关规则保留。
- [x] 按需抽取重复组件，并在进度表记录抽取依据。`pageFrame` 是多个页面共用的唯一新组件；没有三处重复结构需要继续抽取 `splitPane`、`bottomSheet` 或状态组件。
- [x] 更新 `apps/team-site/README.md` 中与版面、导航相关的描述。

## 验收

### 自动化（新增 `tests/layout-acceptance.test.mjs`，沿用 `visual-acceptance.test.mjs` 的 Playwright 启动方式）

对“页面清单”中的每个路由，在三种视口下执行：

| 编号 | 断言 | 视口 |
|---|---|---|
| L1 | 根元素和 `body` 的 `scrollHeight <= clientHeight + 1`（模板 A–D，文档不滚动；模板 E 与独立落地页按规则豁免） | 1440×900、1024×768 |
| L2 | `document.documentElement.scrollWidth <= clientWidth + 1`（无横向滚动） | 全部 |
| L3 | 先确认模板的指定滚动区可滚动并使 `scrollTop` 实际改变，再验证顶栏与侧栏 `getBoundingClientRect().top` 不变 | 1440×900 |
| L4 | 使用固定数据确保至少一个模板 A 列表区实际溢出；验证该区滚动后页头位置不变，不能因没有溢出而跳过 | 1440×900 |
| L5 | 侧栏收起后宽度为 56±1px，展开后为 232±1px；刷新后状态保持；`localStorage` 抛错时仍能按视口默认值渲染 | 1440×900 |
| L6 | 390px 下抽屉默认关闭；点击汉堡后可见且焦点在抽屉内；Esc 或点击遮罩或路由切换后关闭并还原焦点 | 390×844 |
| L7 | 1920×1080 下模板 A 页面的内容区宽度不小于页面区宽度的 95%（无居中留白） | 1920×1080 |
| L8 | 触屏模拟（`hasTouch`/`isMobile`）下，页面内可见交互控件的实际点击框不小于 44×44px；仅带 `data-touch-target-exempt` 的密集表格行内控件可豁免，隐藏元素、徽标和非交互图标不计。该豁免只用于确有密度要求的单个控件，并记录原因 | 390×844 |
| L9 | 检查预期滚动区的显式标记及其实际滚动行为；标记本身不证明页面结构正确。`frameExistingPage` 会给框架正文添加标记，因此框架包装页面只能据此说明正文容器可滚动，不能据此声称列表/面板已独立滚动。当前固定列表 fixture 验证 `/projects` 的列表真实滚动；其他路由的内容可达由 L11 验证，但仍需页面级结构审查。Studio 画布视口、抽屉等独立交互区域按滚动规则单独允许 | 三视口 |
| L10 | 深色模式下顶栏、侧栏和页面区的实际背景符合深色令牌；沿祖先解析透明背景后，代表性正文及辅助文本与实际背景的对比度均不低于 4.5:1 | 1440×900 |
| L11 | 对每个路由将最后一个可见内容元素滚入视口，并检查其未被任何滚动/裁切祖先截断；带 `[data-layout-scroll]` 的区域滚到底后末尾内容可见，避免“文档不滚动但内容被隐藏”的空通过 | 1440×900、1024×768、390×844 |

### 回归

- [x] `pnpm --dir apps/team-site test --test-concurrency=1` 结果不差于阶段 0 记录（失败项只能是阶段 0 已记录的既有失败）。2026-10-24 复跑结果 383 passed / 0 failed / 0 skipped。
- [x] 与布局相关的既有断言（见阶段 0 清单）全部保持通过。项目视觉流程、团队画布和响应式导航断言均通过；项目流程中的就绪确认弹窗竞态已通过显式等待修复。
- [x] 未改动功能逻辑：`git diff` 中 `views/app.js` 的改动仅限页面框架、列表详情组合、侧栏/抽屉逻辑和滚动重置；无领域/API/运行逻辑改动。
- [x] 所有页面源码中的静态 id/data/aria 钩子对比阶段 0，无删除。使用 `/tmp/hooks-diff.mjs` 对 `index.html`、`app.js`、`shared-resources.js` 扫描：id 119→129、data-* 90→93、aria-* 17→17，三类均无删除；新增 id 包含 6 个外壳控件和 4 个项目区块锚点。这是源码文本静态扫描，不覆盖运行时拼接的属性和 class。

### 人工

- [ ] 1440×900、1024×768、390×844 下逐页人工对照基线截图，确认无信息丢失、无大片空白、无错位。Playwright 已覆盖 20 个桌面核心路由状态、19 个触屏路由的几何、溢出和内容可达；63 张阶段 0 基线图仍待人工逐页像素对照，自动断言不等同于目视验收。
- [x] 键盘可操作侧栏、抽屉、Tab；焦点环可见。浏览器验收覆盖抽屉焦点进入、Escape/遮罩关闭、焦点恢复和菜单键盘关闭。
- [ ] 浅色与深色模式各过一遍所有模板页。自动化检查了代表性深色页面对比度；全模板逐页人工主题对照尚未留存签收记录。

说明：本方案负责版面重构本身的验收，包括阶段 0 基线截图逐页对照、模板浅/深色目视检查、CSS 收尾和项目工作区面板滚动。自动化几何检查不替代这些项目级目视验收。真实目标工作流、Windows 生命周期检查、真实设备与读屏签收属于 [Release UAT 清单](release-uat-checklist.md)；该清单中的 Blocked 状态由其自身证据记录维护，不因本方案的布局测试自动转为通过。两份清单各自跟踪，不互相代替。

## 进度表

状态：`未开始` / `进行中` / `完成` / `阻塞`。完成的阶段需填写日期、提交与验证结果。

| 阶段 | 状态 | 日期 | 提交 | 验证 | 备注 |
|---|---|---|---|---|---|
| 0 基线 | 完成 | 2026-10-24 | 未提交 | `pnpm --dir apps/team-site test --test-concurrency=1`: 382 passed / 0 failed / 0 skipped; 63 baseline screenshots | 真实 Project Run 和 Team simulation 详情已覆盖 |
| 1 外壳与令牌 | 完成 | 2026-10-24 | 未提交 | layout-acceptance 1/1；router-lifecycle 与 visual-acceptance 3/3 | 修复移动抽屉方向和工作区入口被旧媒体规则覆盖；存储异常回退 |
| 2 pageFrame 与样板页 | 完成 | 2026-10-24 | 未提交 | layout-acceptance 通过；项目创建/Studio 产品流 10/10；全量测试 383/383 | `/projects` 三视口几何、列表真实滚动、宽屏铺满、空状态和既有交互均通过 |
| 3 A 类与 E 类 | 完成 | 2026-10-24 | 未提交 | 17 个路由状态三视口无横向溢出；全量测试 383/383 | A 列表、两种创建表单均按 pageFrame 迁移；创建页含说明区，手机单列 |
| 4 D 类 | 完成 | 2026-10-24 | 未提交 | 页面框架/平台活动 Tab/路由同步通过；全量测试 383/383 | 团队信息和发布保持原操作；全局配置仍在资产弹框，不移入新页面 |
| 5 C 类 | 完成 | 2026-10-24 | 未提交 | 仿真浏览器测试通过；布局 fixture 验证详情主从及选中项 | 轮询恢复左右滚动位置；手机隐藏列表并保留返回历史入口 |
| 6 B 类 | 完成 | 2026-10-25 | 未提交 | 布局验收：桌面/平板宽屏面板独立滚动、窄屏连续滚动与内容可达通过；视觉验收覆盖项目创建、团队调整、资料上传、任务运行、Run 聚焦和重试；全量测试 383/383 | ≥1024px 面板化；较窄视口纵向堆叠；Studio 图谱回归通过 |
| 7 收尾 | 仓库内完成，人工签收待办 | 2026-10-25 | 未提交 | `shell.css` 已从 `styles.css` 分离；媒体规则及旧 CSS 消费者审计完成；全量 Team Site 测试 383/383；布局验收和视觉验收通过；`git diff --check` 通过 | 仓库内可执行项已完成；仍待 63 张基线图逐页对照和浅/深色逐模板目视签收。真实工作流、Windows、真实设备与读屏验收另见 Release UAT 清单 |

### 页面迁移明细

“完成”表示该路由达到对应阶段的外层页面框架和已列出的验收范围，不自动代表内部内容已重排。实现方式分为：**原生页面结构**（页面内容直接按模板组织）、**框架包装**（`frameExistingPage` 将旧页面节点移入通用外框，内部结构仍由原视图/CSS负责）、**独立继承外壳**（不使用 pageFrame）。L9 的通用正文标记不能替代逐页结构迁移证据；未列出独立滚动区的包装页按现有结构滚动，不视为已完成面板化改造。

| 路由 | 模板 | 状态 | 实现方式 | 删除的旧 CSS | L1–L11 | 备注 |
|---|---|---|---|---|---|---|
| `/projects` | A | 完成 | 原生页面结构 | | L2/L4/L5/L7/L8/L9/L11 | 固定项目列表实际溢出并在列表区滚动 |
| `/history` | A | 完成 | 框架包装 | | L1/L2/L8/L9/L11 | 保留历史视图内部结构，框架正文滚动 |
| `/studio` | A | 完成 | 框架包装 | | L1/L2/L8/L9/L11 | 团队仓库搜索与筛选保留 |
| `/studio/roles` | A | 完成 | 框架包装 | | L1/L2/L8/L9/L11 | renderer 位于 shared-resources.js；模板发布表单和模板列表保留原内部结构 |
| `/examples` | A | 完成 | 框架包装 | | L1/L2/L8/L9/L11 | 案例卡片/选择功能保留 |
| `/projects/new` | E | 完成 | 框架包装 + 表单外层布局 | | L2/L8/L9/L11 | 项目创建与 dirty form 回归通过 |
| `/studio/new` | E | 完成 | 框架包装 + 表单外层布局 | | L2/L8/L9/L11 | 团队创建偏好/提交回归通过 |
| `/platform/models` | D | 完成 | 框架包装 + 路由 Tab | | L1/L2/L8/L9/L10/L11 | 模型目录和服务发现列表有自身滚动区 |
| `/platform/data` | D | 完成 | 框架包装 + 路由 Tab | | L1/L2/L8/L9/L11 | 数据集发布表单保留 |
| `/platform/tools` | D | 完成 | 框架包装 + 路由 Tab | | L1/L2/L8/L9/L11 | 工具登记表单保留 |
| `/platform/storage` | D | 完成 | 框架包装 + 路由 Tab | | L1/L2/L8/L9/L11 | 存储登记表单保留 |
| `/studio/teams/:id/info` | D | 完成 | 框架包装 | | L1/L2/L8/L9/L11 | 版本信息、编辑/分叉操作保留 |
| `/studio/teams/:id/release` | D | 完成 | 框架包装 | | L1/L2/L8/L9/L11 | 发布门禁、基线编辑和运行操作保留 |
| `/studio/teams/:id/run` | C | 完成 | 框架包装 + 列表详情组合 | | L1/L2/L8/L9/L11 | 列表页和清理操作保留 |
| `/studio/teams/:id/run/:runId` | C | 完成 | 框架包装 + 列表详情组合 | | L1/L2/L8/L9/L11 | 主从布局及选中记录由固定证据验证 |
| `/projects/:id`（含 `/runs/:runId`） | B | 完成 | 框架包装 + 分区导航 | | L2/L8/L11 | ≥1024px 面板独立滚动；窄屏正文连续滚动；运行详情聚焦由浏览器流程验证 |
| `/projects/:id/teams` | B | 完成 | 框架包装 | | L1/L2/L8/L9/L11 | 项目团队配置保留原内部结构 |
| `/studio/teams/:id/design` | B | 完成 | 框架包装，保留图谱布局 | | L2/L8/L9/L11 | 移动图谱高度 ≥200px；图谱使用独立视口；资产与调试面板用产品测试回归 |
| `/teams` | 独立继承外壳 | 完成 | 独立页面 | | L1/L2/L11 | 不迁移为模板；沿用页面滚动，布局验收纳入三视口 |
| `/cases/:id` | 独立继承外壳 | 完成 | 独立页面 | | L1/L2/L11 | 不迁移为模板；独立案例详情，布局验收纳入三视口 |

### 进展记录

按时间倒序追加：日期、做了什么、验证结果、遗留问题。当前阶段不创建提交、不暂存工作区改动；各阶段通过文档状态和测试证据验收，最终由用户决定是否提交。

- 2026-10-25：修复触屏与移动端交互目标尺寸及首页滚轮响应复核。在 `shell.css` 中为移动端 `.studio-graph-toolbar button, .studio-graph-toolbar select` 补充内边距和尺寸保底（min-height/min-width 44px），在 `src/visualizer/studio-client/styles.ts` 移动端样式中同步基准尺寸（42px → 44px），消除移动端图谱工具栏 6 个按钮（AI构建、调试、新增角色、团队结构、校验、保存）42px~43px 的欠规整问题。运行 Playwright 测试验证首页 `http://127.0.0.1:4173/` 鼠标滚轮在文案区、图解区、右侧装订线全区域响应正常，`#landing-view` 独立容器纵向滚动平滑。`layout-acceptance.test.mjs` 全量通过；`git diff --check` 无语法及空白异常。
- 2026-10-25：完成阶段 6 项目工作区面板滚动，≥1024px 下四个工作面板独立滚动，窄屏使用纵向页面滚动；布局验收验证面板实际溢出、页头固定及手机内容可达。浏览器产品流程补充项目资料上传和 `/projects/:id/runs/:runId` 聚焦路由，并覆盖项目创建、团队挂载调整、任务运行与重试。新增触屏级联规则，恢复窄屏任务操作按钮的 44px 目标。根路由测试现验证独立落地页；Studio 创建操作断言已更新到实际工具栏位置。CSS 消费者审计移除仓库内無引用的 `.nav-glyph` / `.glyph-*` 旧伪图标及 `.avatar-button` 基础、响应式、深色规则，保留实际使用的 `.nav-icon`、`.workspace-avatar`；可安全合并的重复媒体规则和重复 active 规则已处理。`styles.css` 累计 +3/-33 行（净减 30 行）。保留仍服务组件宽度、横屏、粗指针和减少动态效果的媒体规则，以及无法静态证明无消费者的动态模板/图编辑器样式。最终 `pnpm --dir apps/team-site test --test-concurrency=1` 为 383 passed / 0 failed / 0 skipped，布局验收和视觉验收通过，`git diff --check` 通过。视觉检查查看了 17 个可复现路由的桌面与手机截图，以及桌面浅/深色截图；抽查未发现明显遮挡或横向溢出。63 张阶段 0 图依赖的项目/仿真 fixture 当前无法在默认服务数据中同条件重建，逐图基线对照尚未签收；完整主题逐模板目视记录也未完成，保留为人工验收待办。真实目标工作流、Windows、真实设备及读屏验收仍由 Release UAT 清单跟踪。
- 2026-10-24：布局终验 `pnpm --dir apps/team-site test --test-concurrency=1` 为 383 passed / 0 failed / 0 skipped；布局验收 1/1，定向视觉、Studio 仿真、项目逻辑与路由回归 10/10。全量测试首次发现项目运行视觉流程未等待异步模型就绪确认，修复为等待确认弹框或任务请求后，孤立及全量复跑通过。触屏验收发现两个高优先级按钮规则覆盖 44px 目标，已在触屏规则中覆盖并通过 L8。全量测试前因系统临时目录有约 31,000 个条目而触发 ENOSPC；仅清理无活动测试进程占用的 `ogs-*` 测试临时目录（保留 `ogs-full-run-uat-*` 与视觉证据），恢复后测试通过。复核项目工作区状态后，将阶段 6 明确记录为“已迁移外框/分区导航，面板滚动和完整产品流仍待完成”，不以三视口可达性代替工作台验收。
- 2026-10-24：复核路由实现方式，将历史、仓库、平台、表单及项目工作区记录为框架包装或外层布局，不再把 `frameExistingPage` 的节点搬移描述为内部内容重排。使用 `/tmp/hooks-diff.mjs` 复核后，静态钩子为 id 119→129、data-* 90→93、aria-* 17→17，未删除既有钩子。修正 Release UAT 第 10 条与自动化用例一致：测试在 Team assets 保持打开时连接并保存 Flow，人工录屏仍待签收；Global 配置留在资产浮窗。重新运行布局、视觉、项目操作和 Studio 仿真 Playwright 文件，共 9/9 通过。
- 2026-10-24：在运行中的 Team Site 上用 Playwright 只读打开 `/projects`、`/studio`、`/studio/roles`、`/platform/models`，分别检查桌面与手机视口并保存 8 张临时截图供目视检查。8 个页面响应均为 HTTP 200、无水平溢出；未发现标题、主要操作或页面内容遮挡。截图保存在系统临时目录，不纳入仓库。
- 2026-10-24：目视检查发现桌面空项目状态仅占三列网格中的一列；在 `shell.css` 中增加跨列规则，并给布局验收增加“空状态宽度覆盖整个列表网格”断言。Playwright 布局/视觉/项目操作/Studio 仿真四文件复跑 9/9 通过；桌面截图复核空状态边界宽度为 1147px，与网格宽度一致。之前一次复跑因 Playwright 缓存中的 Chromium 被清理而中断；安装匹配版本后重跑通过。
- 2026-10-24：布局终验 `pnpm --dir apps/team-site test --test-concurrency=1` 为 383 passed / 0 failed / 0 skipped；布局验收 1/1，定向视觉、Studio 仿真、项目逻辑与路由回归 10/10。全量测试首次发现项目运行视觉流程未等待异步模型就绪确认，修复为等待确认弹框或任务请求后，孤立及全量复跑通过。触屏验收发现两个高优先级按钮规则覆盖 44px 目标，已在触屏规则中覆盖并通过 L8。全量测试前因系统临时目录有约 31,000 个条目而触发 ENOSPC；仅清理无活动测试进程占用的 `ogs-*` 测试临时目录（保留 `ogs-full-run-uat-*` 与视觉证据），恢复后测试通过。复核项目工作区状态后，将阶段 6 明确记录为“已迁移外框/分区导航，面板滚动和完整产品流仍待完成”，不以三视口可达性代替工作台验收。
- 2026-10-24：阶段 1 修复手机侧栏旧媒体规则造成的横排裁切，并恢复抽屉中的工作区切换；验收增加导航链接与工作区入口可见性。`layout-acceptance.test.mjs` 1/1，`router-lifecycle.test.mjs` 与 `visual-acceptance.test.mjs` 共 3/3 通过；语法和 `git diff --check` 通过。真实手机、读屏和 Windows UAT 仍按 Release UAT 清单管理。
- 2026-10-24：阶段 2–6 初次迁移记录曾把所有范围记为完成；后续复核确认项目工作区没有独立滚动面板，阶段 6 保持部分。自动布局测试新增末尾内容可达断言后覆盖 20 个桌面几何状态及 19 个触屏路由；本次全量结果为 383/383。自动检查不替代人工截图签收。
- 2026-10-24：复核并修正案例详情路由未隐藏前一页面的问题；增加 `/teams`、`/cases/software-team` 三视口可达性/溢出检查。内容可达验收发现平台模型目录是独立滚动区，已增加显式滚动标记。新增外壳样式已原样拆入 `shell.css` 并在旧样式后加载；`styles.css` 恢复到原有规则，不再因新增外壳规则增长。`release-uat-checklist.md` 不属于布局方案文件范围，保持其独立状态。
- 2026-10-24：观察到 Studio 设计页手机断点将新页头包裹后，旧直系选择器不再命中，导致图谱只剩 84.75px；补充针对框架的断点样式后，画布恢复 330.9px，视觉验收通过。项目运行工作区试接通用 frame 曾触发移动图谱缩高；后续接入了 B 外框和锚点导航，但仍保留纵向连续内容，没有完成独立面板滚动。

- 2026-10-24：阶段 0 基线完成。测试前工作区为 `M docs/development/README.md`、`?? docs/development/team-site-layout-refactor-plan.md`；`git diff --stat` 显示 README 1 行新增（新方案文档为 untracked，不会计入该统计）。Team Site 测试 382 通过、0 失败、0 跳过，约 219 秒。基线目录为本机忽略的 `apps/team-site/tests/layout-baseline/`，共 63 张 PNG，覆盖 21 个页面/路由状态和 1440×900、1024×768、390×844 三种视口；真实项目 Task `20261024-033600-d35770b2` / Run `20261024-033600-17955297` 与团队仿真 `391ed190-349a-4837-b8c4-2f61e6c32bd1` 均已完成并用于详情截图。既有布局不变量：专业模式导航可见、图谱页面宽度不越界、手机主导航可达且不扩大页面宽度；断言位于 `tests/visual-acceptance.test.mjs`。人工抽查：390×844 团队设计页的旧横向导航发生窄列换行并挤压页头；这是待外壳阶段解决的问题，不是基线失败。阶段 0 未提交、暂存、stash 或还原任何既有改动。

## 风险与应对

| 风险 | 应对 |
|---|---|
| `views/app.js` 约 4200 行，HTML 为内联模板字符串，批量替换易破坏逻辑 | 逐页迁移；每页只替换外层容器；用钩子对比脚本做回归 |
| 团队设计页的拖拽、缩放、调试面板对容器高度敏感 | 放在最后；迁移前后对比画布与面板宽高；失败时只回滚该页 |
| 工作区存在其他未提交改动 | 阶段 0 只记录；提交时仅暂存本方案涉及的文件；涉及同一文件时用 `git add -p` 区分 |
| 现有测试依赖旧布局 | 先记录原因，再改断言，保留原意 |
| 页面区与面板的嵌套滚动造成高度计算问题 | 严格按“滚动规则”表；L9 自动检查滚动区个数 |
