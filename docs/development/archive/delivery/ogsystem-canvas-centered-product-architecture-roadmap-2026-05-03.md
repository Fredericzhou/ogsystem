# OGSystem Canvas-Centered Product Architecture Roadmap

Date: 2026-05-03
Status: in progress
Scope: 针对 Visualizer / Studio 的菜单呈现、内容布局、项目创建流程、打开与最近项目、国际化和产品信息架构进行产品一致性评审与技术路线规划。

Implementation update:

- Phase 1 已完成：页面壳已切换为 `top-nav + main-stage + status-bar`，同时保留原有 console panel / workbench / sidebar 挂载点。
- Phase 2 已完成：Project 菜单已调整为二级子菜单，`projectMenuTab` 与 `projectPanelMode` 已拆分并接入客户端状态。
- Phase 3 部分完成：新建已改为 `location -> details -> structure -> review` 多步骤向导，支持空白/模板创建与可选角色导入；`nl2mmd` 当前通过 Build 中的 Chat / Generate 路径承接，尚未内嵌为新建向导会话。
- Phase 4 部分完成：`project/browse` 与 `project/validate-open` 已返回稳定 `code`，打开与最近项目已接入校验后切换；最近项目“失效移除”体验仍待补完。
- Phase 5 部分完成：项目打开/新建相关 i18n key 和前端文案映射已补齐，相关 visualizer 回归已覆盖。

## 1. 结论

结论是：这次调整方向符合 OGSystem 的产品发展理念，而且具备良好的可扩展性，前提是不要把它当作一次纯样式修复，而要把它作为一次“信息架构 + 交互架构 + visualizer API 契约”的升级来做。

原因：

- OGSystem 的核心不是表单平台，而是图优先、生命周期明确、运行可观测的项目工作台。
- 当前布局仍保留“左侧列表 + 中间卡片 + 局部向导”的过渡态实现，不符合“以画布为中心”的主工作面模型。
- 如果继续在现有 `project-wizard` 上叠加字段和按钮，只会让新建、打开、最近、设置进一步耦合，后续接入更复杂的 nl2mmd、多项目切换、历史快照、协作编辑时会越来越难维护。

边界强调：

- `runtime truth` 仍然是项目文件和 `system.mmd`。
- 不改变 `src/runtime/*`、parser、compiler、执行计划、持久化和 resume contract 的核心语义。
- 本路线影响的是 `src/visualizer/*` 壳层、项目相关 visualizer API 和 i18n 呈现，不影响内核协议。

## 2. 与产品理念的一致性

本次方向与产品理念一致，具体体现在以下几方面。

### 2.1 图优先而不是表单优先

Build / Studio 的主舞台应该是 X6 画布和图工作区，而不是默认暴露大块表单。表单、向导、聊天式创建、属性编辑都应作为辅助面板或抽屉出现。

这符合 OGSystem 在构建阶段的核心心智模型：

- 用户先看到系统结构。
- 用户围绕角色、关系、评审、路由、循环等图语义进行编辑。
- 表单是图的属性编辑器，不是产品中心。

限制说明：

- “画布优先”只适用于 `Build / Studio`。
- `Operate / Review / Resume / Logs / Artifacts` 仍然是控制面和观测面，不应被强行画布中心化。
- 对于 `Operate`，图只是一种辅助投影，不应取代时间线、失败分诊、日志和恢复决策面板。

### 2.2 生命周期优先而不是页面堆叠

OGSystem 已经在产品层收敛到：

```text
Project -> Build -> Validate & Release -> Operate
```

本次改造会进一步强化这个结构：

- 顶部导航承载生命周期入口。
- 中部主舞台承载当前阶段的主工作内容。
- 底部状态栏承载状态和上下文。

这比“在一个页面里平铺多个 card + 多个 segmented tabs”更接近成熟产品工作台。

### 2.3 显式创建而不是隐式写入

新建项目、加载项目、通过 nl2mmd 生成框架、导入角色、保存系统、试运行，都应是明确动作，不应依赖隐式后台写入。

这与 OGSystem 既有原则一致：

- runtime truth 仍然是项目文件和 `system.mmd`
- visualizer 负责生成、编辑、校验和展示
- 不改变 runtime / parser / compiler 的核心语义

### 2.4 面向增长的产品组织

如果未来接入：

- 更强的对话式建模
- 多种模板市场
- 项目切换器
- 团队协作
- 云端项目目录
- 发布包和版本快照

那么“顶部导航 + Build 画布主舞台 + 右侧上下文面板 + 底部状态栏”的结构天然比当前结构更容易扩展；同时 `Operate` 继续保持控制台 / 观测台属性，不必跟随 Build 的画布中心布局。

## 3. 可扩展性判断

结论是：可扩展，但必须先做边界拆分。

### 3.1 当前主要扩展阻力

当前阻力不在 X6，而在前端状态和渲染职责耦合过重。

现状：

- 页面壳在 `src/visualizer/page-shell-template.ts`
- 样式集中在 `src/visualizer/page-shell-styles.ts`
- 项目菜单与新建/打开/最近的 HTML 拼接集中在 `src/visualizer/client-app.ts`
- 打开校验和新建冲突规则在 `src/visualizer/server.ts`

其中最明显的问题是：

- `renderProjectWizard()` 同时承担菜单渲染、创建表单渲染、打开流程渲染、最近项目渲染、已加载项目概览渲染。
- `projectMenuTab` 同时承担导航状态和内容状态。
- 服务端打开校验 message 仍以英文自然语言为主，前端难以统一国际化。

如果不拆分，上层功能会持续堆进一个大函数。

### 3.2 推荐扩展边界

建议拆成四层。

#### A. Shell 层

职责：

- 顶部导航
- 主舞台布局
- 底部状态栏
- 全局 flash / modal / drawer 容器

建议文件边界：

- `page-shell-template.ts`
- `page-shell-styles.ts`

#### B. Workspace 层

职责：

- Project workspace
- Build workspace
- Validate workspace
- Operate workspace

建议状态：

```ts
primaryNav: "project" | "build" | "validate-release" | "operate"
rightPanelMode: "closed" | "project-new" | "project-open" | "project-recent" | "project-settings" | "inspector" | "chat-to-mmd"
```

#### C. Flow 层

职责：

- 新建向导状态机
- 打开项目流程
- 最近项目切换流程
- nl2mmd 会话流程

建议拆出独立 renderer / controller，而不是继续塞进 `client-app.ts`。

#### D. Contract 层

职责：

- 新建项目 API contract
- 打开校验 API contract
- 最近项目校验 contract
- i18n message code contract

这层要保证前端显示文案不直接依赖服务端英文 message。

边界限制：

- 这里的 contract 只指 `src/visualizer/server.ts` 暴露的 visualizer API 和 project lifecycle 相关控制面接口。
- 不包括 runtime error envelope、Mermaid DSL、resume/persistence contract、run artifact schema。
- UI 重构不应借机修改内核错误模型或运行时持久化协议。

## 4. 目标产品结构

建议的产品结构如下：

```text
Top Navigation
  Project | Build | Validate & Release | Operate
  Project submenu: Overview | New | Open | Recent | Settings

Main Stage
  Left/Center: primary content
  Right: contextual drawer / inspector / wizard / assistant

Bottom Status Bar
  current workdir | project state | validation state | live run state | locale
```

关键交互原则：

- 在 `Build / Studio` 中，默认主视图优先显示画布。
- 在 `Project` 中，主视图优先显示项目工作区与流程入口，而不是运行图。
- 在 `Operate` 中，主视图优先显示控制面和观测信息，而不是强制以画布为中心。
- 只有当用户执行某项功能时，右侧面板才展开。
- Project 的“新建/打开/最近/设置”是子菜单，不是主内容区里堆的 tab 卡片。
- “最近”支持继续下钻为最近项目列表，行为类似最近文档。

## 5. 新建项目的技术路线

### 5.1 产品原则

“角色仓库”不是新建前置条件。

新建必须支持三种起点：

- 空白框架
- 模板框架
- nl2mmd 对话创建基础框架

### 5.2 流程建议

建议把新建做成显式步骤型向导：

```text
Step 1. 选择位置
Step 2. 输入项目名称与项目 ID
Step 3. 选择创建方式
Step 4. 预览与确认
```

### 5.3 目录规则

建议规则：

- 当前目录为空目录：允许在本目录初始化。
- 当前目录非空且不是 OGSystem 项目：不允许直接初始化本目录，必须选其他根目录并创建新项目目录，除非用户进入明确的冲突处理流程。
- 当前目录已是 OGSystem 项目：只能打开或切换，不应在同目录继续新建。

这与现有后端冲突判断方向一致，但前端还没有把它组织成完整流程。

### 5.4 nl2mmd 接入原则

nl2mmd 不应作为“另一个页面”存在，而应作为新建流程中的一种创建模式，或 Build 侧边抽屉中的“生成基础框架”命令。

建议行为：

- 在新建时选择“通过对话生成”
- 打开右侧会话面板
- 用户描述业务流程
- 返回结构化 authoring patch
- 生成基础 `StudioAuthoringDocument`
- 再进入 X6 画布细化

## 6. 打开与最近项目的技术路线

### 6.1 打开

打开必须是“先校验，再切换”。

现有服务端已经具备：

- 目录浏览
- 是否为项目目录校验
- 是否为空目录校验
- 冲突路径提示

后续建议补充稳定 code，而不是只返回自然语言 message。

推荐返回：

```json
{
  "code": "OPEN_TARGET_READY",
  "isProject": true
}
```

或：

```json
{
  "code": "OPEN_TARGET_NOT_PROJECT",
  "isProject": false,
  "isEmpty": false,
  "hasConflict": true
}
```

前端再按 code 做国际化展示。

注意：

- 这些稳定 code 只用于 visualizer 的项目控制面接口。
- 不把这套 code 契约向下扩散到 runtime 内核错误包络。

### 6.2 最近项目

最近项目建议分两层：

- 最近入口是二级菜单
- 最近列表是子子菜单或右侧面板列表

行为要求：

- 点击最近项时先 validate
- 校验通过后切换
- 校验失败则标记“失效”
- 允许用户移除失效记录

这样更接近成熟办公产品的体验，也能减少“点了打不开”的困惑。

## 7. 国际化路线

### 7.1 当前问题

当前仍存在服务端英文 message 直出，例如目录冲突和打开校验提示。

这会带来：

- 中英文混排
- 前端文案无法统一控制
- 后续无法细分不同中文表达场景

### 7.2 建议方案

服务端返回稳定 code，前端映射本地化文案：

```text
OPEN_TARGET_READY
OPEN_TARGET_EMPTY
OPEN_TARGET_NOT_DIRECTORY
OPEN_TARGET_NOT_READABLE
OPEN_TARGET_NOT_PROJECT
OPEN_TARGET_PARTIAL_PROJECT_CONFLICT
PROJECT_DIR_CONFLICT
PROJECT_ALREADY_EXISTS
```

原则：

- 服务端负责事实与状态
- 前端负责文案与语言
- 机器可读字段不翻译
- 用户可见 UI 文案必须统一走 i18n
- 不改变 runtime / parser / compiler 现有机器契约

## 8. 分阶段实施路线

### Phase 1: Shell 重构

目标：

- 顶部导航
- 中部主舞台布局
- 底部状态栏
- 右侧上下文面板容器

交付：

- 新的页面壳
- 原有 Project / Build / Operate 内容完成迁移
- 不改变 runtime 和 API 语义

当前状态：已完成。

### Phase 2: 菜单与状态拆分

目标：

- 一级导航和二级菜单解耦
- `projectMenuTab` 拆分为更清晰状态

交付：

- Project submenu
- right panel mode
- route state 同步更新

当前状态：已完成。

### Phase 3: 新建向导重做

目标：

- 单页大表单改为多步骤流程
- 支持空白 / 模板 / nl2mmd 三种路径
- 角色仓库降级为可选导入

交付：

- wizard state machine
- 新建确认页
- 创建后自动进入 Build 画布

当前状态：部分完成。

- 已完成多步骤向导状态机、确认页、创建后进入 Build。
- “通过对话生成”目前落在 Build 的 Chat / Generate 路径，尚未在新建向导内提供完整对话式创建面板。

### Phase 4: 打开与最近增强

目标：

- 打开前强校验
- 最近项目可验证、可移除、可标记失效

交付：

- recent validity UX
- open validation code 契约
- 项目切换体验稳定化

当前状态：部分完成。

- 已完成 `project/browse` / `project/validate-open` 的稳定 code 契约和客户端文案映射。
- 已完成打开与最近项目的“先校验，再切换”流程。
- 最近项目的“失效标记 / 移除”体验尚未实现。

### Phase 5: 国际化收口

目标：

- 所有打开/创建相关 message key 化
- 去掉英文自然语言直出

交付：

- 新 message keys
- 前后端稳定错误码
- 浏览器回归覆盖

当前状态：部分完成。

- 已完成项目打开和新建主流程相关 message keys、稳定错误码映射和客户端/服务端回归测试。
- 仍需继续清查更广范围的 visualizer 文案是否存在英文自然语言漏出。

## 9. 测试与验收路线

建议增加三类验证。

### 9.1 Client 单元测试

覆盖：

- 一级导航状态
- 二级菜单切换
- 新建向导步骤切换
- 最近项目失效态
- i18n 文案映射

### 9.2 Browser Smoke

覆盖：

- 默认进入画布主视图
- 点击新建后右侧打开向导
- 通过打开校验后切换项目
- 最近项目校验失败时不切换
- 中文界面不再出现英文冲突文案

### 9.3 API Contract Test

覆盖：

- `project/browse`
- `project/validate-open`
- `project/create`
- 稳定 `code` 字段
- 冲突路径与空目录语义

## 10. 风险与控制

主要风险：

- 在 `client-app.ts` 中继续叠加逻辑，导致重构只换皮不解耦
- 新建向导与 Build 聊天式建模重复建设
- i18n 只补字典，不补 code 契约，导致后续仍有英文漏出
- 在 visualizer API 契约化过程中误碰 runtime error envelope 或持久化协议
- e2e 覆盖不足，布局改完后交互回归不稳

控制建议：

- 先改 shell 和状态边界，再改具体流程
- 向导、打开、最近拆出独立渲染函数或模块
- 服务端 message 逐步 code 化，但只限 visualizer / project lifecycle 控制面接口
- 每个 phase 配套 browser smoke

## 11. 代码落点建议

建议优先改造以下文件：

- `src/visualizer/page-shell-template.ts`
- `src/visualizer/page-shell-styles.ts`
- `src/visualizer/client-app.ts`
- `src/visualizer/client-project-menu-controls.ts`
- `src/visualizer/client-project-workspace.ts`
- `src/visualizer/server.ts`
- `src/visualizer/i18n/en.ts`
- `src/visualizer/i18n/zh-CN.ts`

建议新增或拆分的模块方向：

- `client-project-wizard-render.ts`
- `client-project-open-render.ts`
- `client-project-recent-render.ts`
- `client-shell-layout.ts`
- `client-project-open-i18n.ts`

是否真的新增这些文件，可以根据当前 repo 对模块数量的容忍度决定；但职责拆分本身是必要的。

## 12. 最终判断

最终判断如下：

- 符合产品发展理念。
- 可扩展，但必须以“Build 画布主舞台 + 生命周期导航 + 右侧上下文面板 + 稳定 visualizer API/i18n 契约”为前提。
- 这次不应按“UI 修补”执行，而应按“产品架构升级”执行。
- 最值得优先投入的不是细节样式，而是 shell、状态边界、向导流和 visualizer 控制面错误契约。
- 只要守住边界，这次演进不会影响内核；它影响的是 `src/visualizer/*`、项目相关 visualizer API，以及 i18n 文案映射方式。

如果按这个路线实施，后续接入更强的 nl2mmd、模板市场、最近项目管理、历史快照和协作能力时，结构上是顺的。
