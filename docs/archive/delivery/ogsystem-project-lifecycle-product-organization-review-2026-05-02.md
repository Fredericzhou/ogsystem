# OGSystem Project Lifecycle Product Organization Review

Date: 2026-05-02

## Conclusion

当前四段生命周期方向符合 OGSystem 的逻辑能力，但页面组织还没有完全达到平台软件产品体验。

OGSystem 的自然产品逻辑应是：

```text
Project -> Build -> Validate & Release -> Operate
```

- `Project`：确定项目上下文、当前 workdir、创建/加载项目。
- `Build`：编排 `StudioAuthoringDocument`，生成和编辑 `system.mmd`。
- `Validate & Release`：校验 readiness、manifest contract、release candidate。
- `Operate`：查看运行事实、恢复、审计、日志、review、artifact。

这个生命周期模型是正确的。当前主要问题不是能力缺失，而是页面组织仍偏“功能按钮集合”，还不是“项目工作台 + 菜单命令 + 阶段工作区”的平台产品形态。

## Current Fit

### 符合 OGS 逻辑的部分

- `Project / Build / Validate & Release / Operate` 四段生命周期方向正确。
- `system.mmd` 仍是运行真相，run artifact 仍是历史事实。
- `StudioAuthoringDocument` 作为编辑真相，Build 中图编辑和 Chat to MMD 围绕 authoring 展开，边界合理。
- Operate 作为只读运行态工作区，与 Build 编辑态分开，方向正确。

### Pre-Implementation Source Status

基于当前源码复核：

- Chat to MMD API 已从临时路径收敛到 `POST /api/v1/project/studio/chat`，不再使用 `/project/studio/chat/mmd`。
- client test 已覆盖 Chat 输入会请求 `/project/studio/chat`，并确认不会再调用 `/project/studio/chat/mmd`。
- Build Chat 输入/发送路径已有测试覆盖，风险低于上一轮评审时的状态。
- 默认 `consoleTab` 仍是 `operate`，无 deep link 时还没有默认进入 Project。
- 落地前 `#project-wizard-load` 存在。
- 落地前 `Project Load` 通过 `#action-form-section` / `projectLoad` / `#action-project-workdir` 承载。
- 落地前 `#project-load` 是散按钮，不是 Project 菜单项。
- 落地前 Role catalog 是 `roleCatalogExpanded + Show more`。分页、过滤和已选摘要属于合理体验增强项，但不是与 Project 菜单/加载结构同级的架构阻塞。
- 落地前不具备 `Project > Overview / New Project / Open Project / Recent Projects / Project Settings` 菜单。

### 不完全符合产品体验的部分

1. 默认进入 `Operate` 不合理。

   如果用户没有指定 `runId`、`reviewId` 或 operate deep link，应默认进入 `Project`。OGSystem 所有能力都依赖当前 project/workdir，上来先看运行态会让用户先面对结果层，而不是上下文层。

2. `Project Load` 不应是 action form。

   加载项目是项目级导航命令，不是临时操作表单。它应属于 `Project > Open Project`，通过目录选择/目录浏览弹窗完成，而不是在 `#action-form` 中手工输入路径。

3. Project 页面不应重复堆多个 Load 入口。

   `#project-load`、`#project-wizard-load`、`action-form projectLoad` 同时存在，会让用户不知道哪个才是主路径。平台产品里应只有一个清晰入口：`Project menu > Open Project`。

4. 创建与加载的心智应分离。

   新建项目是表单流程；加载项目是目录选择流程。当前二者混在 wizard/action form 里，逻辑上能运行，但体验上不干净。

5. `workdir` 不应在多个地方任意编辑。

   当前绑定目录是项目上下文。要换目录，应走 `Open Project`。Create form 里应只读展示目标目录，避免用户误以为随便改路径就能切换项目上下文。

6. Build Chat 位置合理，但输入必须稳定。

   Chat to MMD 放在 Build / Studio Bridge 内符合逻辑。如果提示词输入不可用或被重渲染/遮罩影响，它就是 Build 主路径阻塞，优先级高于继续加功能。

7. Role catalog 仍有体验增强空间。

   大量角色只靠 `Show more` 不够理想。分页、搜索、分类、健康状态过滤和已选摘要是合理的体验升级，但它不是与默认入口、Project 菜单、加载流程同级的架构问题。

## Target Product Organization

### Top-Level Navigation

```text
Project | Build | Validate & Release | Operate
```

默认行为：

- 无 deep link：进入 `Project > Overview`。
- 有 `runId` / `reviewId` / operate deep link：进入 `Operate`。
- 空目录、非项目目录、已有项目目录都先落在 Project，由 Project 明确展示当前目录状态。

### Project Menu

`Project` 应是项目上下文菜单，而不是单个散按钮：

```text
Project
  Overview
  New Project
  Open Project
  Recent Projects
  Project Settings
```

### Project Workspace Layout

Project 页面建议三段式：

```text
Project Header
  当前项目/目录状态
  Project menu: New Project / Open Project / Recent

Main
  Overview card: 当前 workdir、项目状态、readiness 摘要
  Primary task panel:
    - 未初始化目录：显示 New Project 表单
    - 已有项目：显示项目摘要、模板、角色、模型/Profile 摘要

Secondary
  Readiness / role packages / config summary
```

### Build Workspace Layout

```text
Build
  Graph Workspace
  Chat to MMD
  Source
  Inspector
  Diagnostics
```

Build 的第一视角应是图工作区。Chat to MMD 是辅助生成和修订能力，不应变成独立新页或第二套编辑器。

### Validate & Release Layout

```text
Validate & Release
  Readiness
  Manifest Contract
  Export Candidate
```

文案应继续使用 `release candidate` / `manifest contract`，不能暗示完整独立运行包已经完成。

### Operate Layout

```text
Operate
  Runs
  Runtime Graph
  Recovery
  Logs
  Reviews
  Artifacts
```

Operate 负责运行后的事实，不承载 authoring 编辑命令。

## Project Create And Load Rules

### New Project

- 入口：`Project > New Project`。
- 主体：`#project-create-form`。
- 目标目录默认是当前绑定目录，只读展示。
- 不允许用户在 create form 中随意编辑路径。
- “改用其他目录”应打开 `Open Project` 的目录浏览与服务端校验弹窗。
- Model/Profile/Tool 放入高级配置折叠区。
- Role catalog 使用分页和已选摘要。

### Open Project

- 入口：`Project > Open Project`。
- 不再走 `#action-form`。
- 使用 Project Load Dialog，以目录浏览和服务端校验为主路径。
- Dialog 内容：
  - 当前目录。
  - 最近项目。
  - 父/子目录浏览。
  - 路径输入作为高级兜底，而不是主路径。
  - 自动校验：是否存在、是否 OGSystem project、是否空目录、是否冲突目录。
- 成功后 visualizer 绑定到该目录。后续默认使用该目录，除非再次 Open Project。

浏览器限制：普通网页不能可靠打开系统原生目录选择器并读取绝对路径。Web 形态下更稳妥的产品表述和实现是“目录浏览 + 服务端校验”的项目加载弹窗。如果后续包装成桌面端，再考虑接入原生目录选择器。

## Entries To Remove Or Consolidate

建议删除或迁移：

- 删除 `#project-wizard-load`。
- `Project Load` 不再渲染到 `#action-form-section`。
- `#action-form` 只保留运行类临时表单：Start / Resume / Stop / Review / Save As / Reindex。
- `#project-load` 保留为 Project 菜单中的 `Open Project` 命令，不作为页面散按钮。

## Role Catalog Experience Enhancement

该项属于体验增强，不是与 Project 菜单和加载结构同级的架构阻塞。

从：

```text
Search + Show more
```

改为：

```text
Search
Filter: category / health / imported
Selected summary
Page size: 12 / 24
Prev / Next
```

建议状态：

```ts
roleCatalogPage: 0
roleCatalogPageSize: 12
roleCatalogFilter: ""
selectedRoleIds: []
```

搜索后分页基于 filtered result，已选角色固定展示在 catalog 顶部。

## Build Chat Requirements

Chat to MMD 是 Build 主路径能力，必须稳定可输入、可发送、可预览、可应用。

要求：

- `#studio-chat-input` 不被 graph island overlay 覆盖。
- chat panel 使用独立 region，`pointer-events: auto`。
- textarea 输入只更新 `state.studioChatDraftMessage`，不触发整个 `renderWorkbench()` / `renderStudioBridge()`。
- Send 后再 patch chat panel。
- browser smoke 覆盖聚焦 textarea、输入 prompt、发送、看到 assistant/preview、Apply。

## Recommended Execution Order

1. 默认 `consoleTab` 改为 `project`，保留 deep link 覆盖。
2. 引入 Project menu：Overview / New Project / Open Project / Recent。
3. 删除 `#project-wizard-load`，Project load 从 action form 迁到 dialog。
4. Create form 的 workdir 改成只读当前绑定目录。
5. 实现目录浏览 + 服务端校验的 Project Load Dialog。
6. Role catalog 体验增强：分页、过滤和 selected summary。
7. 修复 Build Chat textarea 输入和重渲染问题。
8. 补 i18n、client tests、browser smoke。

## Acceptance Criteria

- [x] 打开 visualizer 默认看到 Project，而不是运行列表。
- [x] Project 菜单包含 `Overview` / `New Project` / `Open Project` / `Recent` / `Settings`。
- [x] 加载项目通过 Project 内的 Open Project 面板完成，不再依赖 action form。
- [x] 创建项目只在当前绑定目录执行，目标目录只读展示；换目录必须走 `Open Project`。
- [x] 页面不再重复出现多个 Load Project 按钮，`#project-wizard-load` 已移除。
- [x] `#action-form` 不再承载 Project Load，仅保留运行、评审、停止、保存副本、重建索引等临时操作。
- [x] Role catalog 支持搜索、分页、每页数量和已选摘要，跨分页/过滤保留已选角色。
- [x] Build Chat 能输入、发送、预览、Apply，沿用 `POST /api/v1/project/studio/chat` 契约和既有测试覆盖。

## Implementation Status

落地日期：2026-05-02

本轮已完成：

- 默认生命周期入口从 `Operate` 调整为 `Project`；存在 `runId` / `reviewId` / log/tail/since 等运行态 deep link 时仍进入 `Operate`。
- Project 页面改为项目菜单组织：`Overview`、`New Project`、`Open Project`、`Recent`、`Settings`。
- `Project Load` 从 `#action-form` 迁移到 Project 内 `#project-open-form`，并保留最近项目列表和路径兜底输入。
- 删除 `#project-wizard-load`，全局 Project toolbar 中的加载入口改为上下文化的 `Open Project`。
- `#project-create-form input[name="workdir"]` 改为只读当前绑定目录，避免 create form 暗含切换目录语义。
- Role catalog 从 `Show more` 改为分页、搜索、每页数量和 selected summary。
- 更新 en / zh-CN i18n、client test、browser smoke。

验证结果：

- `pnpm build`：通过。
- `node --test tests/visualizer-client.test.mjs`：30/30 通过。
- `pnpm run test:visualizer`：69/69 通过。
- `pnpm run test:visualizer-browser`：2/2 通过。

边界确认：

- 未修改 runtime / parser / compiler 语义。
- `system.mmd` 仍是运行真相；Project/Build 调整仅作用于 Visualizer 产品组织和 UI 交互。
- X6/Studio Graph 仍保持在浏览器图编辑边界内。
