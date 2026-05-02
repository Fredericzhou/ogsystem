# OGSystem Project Lifecycle Product UX Optimization Plan

Date: 2026-05-02

## Goal

在已经收敛到 `Project -> Build -> Validate & Release -> Operate` 四段生命周期之后，继续优化 Visualizer 的产品组织，让它更像“项目工作台 + 阶段命令 + 稳定构建流程”，而不是散落按钮和临时表单集合。

当前实现已经完成：

- 默认进入 `Project`。
- `Open Project` 已进入 Project 工作区，不再走 `#action-form`。
- `#project-wizard-load` 已移除。
- Project 内已有 `Overview / New Project / Open Project / Recent / Settings` 菜单。
- Create form 的 workdir 已只读。
- Role catalog 已支持分页、page size 和 selected summary。
- Chat to MMD 已有输入、发送、预览、Apply 的客户端测试覆盖。

剩余优化重点是：消除最后的散按钮感、把 Build 对话构建做成明确命令、优化 Build header 信息布局，并让运行启动前的校验和提示更可靠。

## Review Alignment

关键判断：

- P1 移除最后的 `#project-load` 散按钮：同意。Project menu 已有 `Open Project`，全局 hero 里再放 Load 会破坏平台式菜单结构。
- P2 Chat to MMD 改为 toolbar 触发的 dialog/drawer：同意，但必须保证可发现性。它应是 Build graph toolbar 的主命令之一，不能藏太深。
- Chat Apply 接入 undo/redo：同意。不要另造一套和 graph island 冲突的历史系统，应复用或统一现有 authoring command history。
- P3 Build header 优化：同意。Build header 应是状态条 + 工具带，不应承载大段说明。
- P4 Start Run 输入校验：同意，优先级合理。运行启动前必须明确阻断空 prompt/input。
- P5 Project Open Dialog + directory browse / validate-open API：同意。路径输入作为兜底，主路径用“目录浏览 + 服务端校验”。
- P6 Project 内部 tab route：同意，但优先级低于 P1-P5。

执行建议：

- P2 和 P3 可以合并做产品设计，因为 Chat 入口、Build toolbar、header/status strip 是同一个 Build 工作区信息架构问题。
- P2 和 P3 不建议合并成一个过大的实现提交。优先先把 Chat 入口迁到 graph toolbar + dialog/drawer，并保持现有 Build header 行为稳定；随后再单独整理 header/status strip。
- 每个阶段都应保持 browser smoke 可回归，避免 Build graph root、Chat 输入和 dry-run 主路径互相影响。

## Priority 1: Remove The Last Loose Project Load Button

### Problem

`#project-load` 当前行为已经正确：点击后切到 Project 的 `Open Project` 面板。

但它仍出现在全局 hero toolbar 中，视觉上还是一个散按钮。严格的平台产品形态中，项目打开应属于 Project 菜单命令，而不是所有生命周期阶段附近的全局动作。

### Target

Top-level navigation 只保留生命周期：

```text
Project | Build | Validate & Release | Operate
```

Project 内部承载项目命令：

```text
Overview | New Project | Open Project | Recent | Settings
```

### Proposed Changes

- 从 page shell 的 hero secondary actions 中移除 `#project-load`。
- 删除或调整 `client-app.ts` 中对 `projectLoadButton` 的全局绑定。
- 保留 Project menu 的 `Open Project` 作为唯一主入口。
- 如需保留快捷入口，只在 `Project` panel 内以菜单 tab 或 command button 展示。

### Acceptance Criteria

- 非 Project 阶段不再显示 Load/Open Project 散按钮。
- Project 页面可以通过 `Open Project` menu/tab 加载项目。
- 加载项目不依赖 `#action-form`。

## Priority 2: Turn Build Chat Into A Dialog Command

### Problem

当前 Build 中的对话构建面板：

```xpath
//div[@class='studio-chat-panel structure-list']
```

已经具备 Chat to MMD 能力，但作为常驻面板会占用 Build 工作区空间。Build 的第一视角应是 graph workspace，对话构建更适合作为从图工具栏触发的生成/修订命令。

这个调整不是把 Chat to MMD 降级为隐藏功能，而是释放 Build 工作区空间。Chat / Generate 必须作为 Build graph toolbar 的主命令之一保持一眼可见。

### Target

把 Chat to MMD 从常驻结构列表升级为弹窗或 drawer 功能，触发按钮放到图工具栏：

```xpath
//div[@class='studio-graph-toolbar']
```

建议交互：

```text
Build Graph Toolbar
  Chat / Generate
  Undo
  Redo
  Save Draft
  Validate
  Dry Run
```

点击 `Chat / Generate` 后打开 dialog/drawer：

```text
Chat to MMD Dialog
  Context: selected role / selected flow / whole graph
  Prompt textarea
  Send / Regenerate
  Assistant result
  Preview Mermaid
  Diagnostics
  Apply
  Cancel
```

### Undo / Redo Requirement

对话构建 Apply 后应进入 Build authoring command history，支持 undo / redo。

建议原则：

- Send 只生成 preview，不进入 undo stack。
- Apply 才产生 authoring mutation。
- Apply 前记录 previous `StudioAuthoringDocument` 和 canvas。
- Undo 恢复上一个 authoring/canvas/source snapshot。
- Redo 重放已应用的 chat patch。
- Undo / redo 后刷新 graph、inspector、source 和 diagnostics。

### Proposed State

```ts
studioChatDialogOpen: false
studioAuthoringUndoStack: []
studioAuthoringRedoStack: []
```

每个 history entry 建议包含：

```ts
{
  label: "Apply Chat to MMD",
  before: { authoring, canvas, source },
  after: { authoring, canvas, source },
  createdAt: string
}
```

### Acceptance Criteria

- Build graph toolbar 中有 Chat/Generate 入口。
- Chat/Generate 在 Build graph toolbar 中一眼可见，不藏在二级菜单或低优先级 overflow 中。
- Chat dialog 能输入、发送、预览、Apply。
- Apply 后图和 source 更新。
- Apply 后 Undo 可恢复 Apply 前状态。
- Undo 后 Redo 可恢复 Apply 后状态。
- Dialog 打开/关闭不重建 graph root，不造成输入丢失。

## Priority 3: Optimize Build Header Layout

### Problem

Build header 区域：

```xpath
//*[@id='console-panel-build']//header/div
```

当前承载功能、状态和说明时容易混在一起。Build 是高频工作区，header 应该更像工具带和状态栏，而不是信息说明卡片。

### Target Layout

建议拆成三层信息：

```text
Build Header
  Left: title + current draft/source status
  Center: mode/view segmented controls
  Right: primary actions

Build Status Strip
  saved/dirty
  validation status
  selected role/flow
  last dry-run id

Build Toolbar
  Chat / Generate
  Undo
  Redo
  Save Draft
  Validate
  Dry Run
```

### Proposed Changes

- 把说明性 hint 移到低优先级区域，避免挤占 header。
- 把可点击命令集中到 toolbar。
- 把状态信息压缩成 badge/status strip。
- `Dry Run` 保持 Build 内主动作，`Open in Operate` 仍作为 dry-run 成功后的次动作。

### Acceptance Criteria

- Build header 在桌面和移动宽度下不换行重叠。
- 主要动作一眼可见：Chat/Generate、Save、Validate、Dry Run。
- 状态一眼可见：dirty/saved、validation、selected item、last dry run。
- Header 不承载大段解释文本。

## Priority 4: Validate Start Run Inputs Before Submit

### Problem

启动运行时，用户点击：

```xpath
//button[@id='action-form-submit']
```

如果启动表单中的提示词字段为空，例如：

```xpath
//label[3]
```

当前流程可能静默失败或提示不明显。运行启动是高风险动作，必须在提交前给出明确校验和聚焦提示。

### Target

Start Run 表单提交前做客户端校验：

- prompt/input 必填时，空值直接阻断 submit。
- 显示 inline error。
- 聚焦到对应 textarea/input。
- flash 给出明确提示。
- 不调用后端 start API。

### Proposed Behavior

```text
User clicks Start Run
  if prompt is required and empty:
    show inline error near prompt
    focus prompt field
    show flash warning/error
    do not submit
  else:
    submit start run request
```

### Proposed Changes

- 为启动运行表单中的 prompt 字段增加稳定 id，例如 `#action-run-prompt`。
- 在 `handleActionFormSubmit()` 的 `start` 分支前加入校验。
- 给 prompt field 渲染 `aria-invalid="true"` 和错误 hint。
- 测试覆盖空 prompt 阻断、聚焦、无 API 请求。

### Acceptance Criteria

- 空 prompt 点击 `#action-form-submit` 不会启动运行。
- 用户能看到明确提示。
- 焦点移动到 prompt 输入框。
- 填入 prompt 后可以正常启动运行。
- client test 覆盖静默失败回归。

## Priority 5: Project Open Dialog And Directory Browse

### Problem

当前 `Open Project` 已从 action form 迁入 Project 面板，但核心仍是路径输入。路径输入应该是高级兜底，不应是主要路径。

### Target

升级为 Project Open dialog 或 drawer：

```text
Open Project
  Current directory
  Recent projects
  Parent directory
  Child directories
  Path input as advanced fallback
  Server validation result
  Open button
```

### Suggested APIs

```text
GET /api/v1/project/browse?workdir=...
POST /api/v1/project/validate-open
```

`browse` 返回：

```ts
{
  workdir: string
  parent: string | null
  children: Array<{ name: string; path: string; kind: "directory" | "file" }>
  recent: string[]
}
```

`validate-open` 返回：

```ts
{
  exists: boolean
  readable: boolean
  isProject: boolean
  isEmpty: boolean
  hasConflict: boolean
  message: string
}
```

### Acceptance Criteria

- 用户可以通过目录列表选择项目。
- 路径输入保留为高级兜底。
- 打开前显示校验结果。
- 非项目目录、不可读目录、冲突目录都有明确提示。

## Priority 6: Route Project Internal Tabs

### Problem

生命周期路由已经支持 `Project`，但 Project 内部 tab 如 `open/recent/settings` 还可以进一步 deep link。

### Target

支持：

```text
?lifecycle=project&projectTab=open
?lifecycle=project&projectTab=recent
```

### Acceptance Criteria

- 刷新后保持 Project 内部 tab。
- `Open Project` 可直接 deep link。
- 测试覆盖 route read/write。

## Execution Order

建议顺序：

1. 移除 hero toolbar 中的 `#project-load` 散按钮。
2. 先做 P2 设计稿/DOM 方案，明确 Chat/Generate 在 Build graph toolbar 中的位置，以及 dialog/drawer 与 graph root 的边界。
3. 把 Chat to MMD 改成 Build graph toolbar 触发的 dialog/drawer，保持现有 Build header 行为稳定。
4. 引入 Build authoring undo/redo stack，并让 Chat Apply 接入。
5. 单独优化 Build header：状态 strip + toolbar + primary actions。
6. 给 Start Run 表单补 prompt 必填校验和 inline error。
7. 将 Open Project 从 inline panel 升级为 dialog/drawer。
8. 增加 directory browse / validate-open API。
9. 支持 Project 内部 tab route。

## Test Plan

### Client Tests

- 默认无 route 进入 Project。
- `Open Project` 只通过 Project menu/dialog 进入，不出现 `#project-wizard-load`。
- Build toolbar 能打开 Chat dialog。
- Chat 输入不触发 full workbench render。
- Chat Apply 后 undo/redo 可用。
- Start Run 空 prompt 阻断提交并聚焦输入。
- Project tab route round-trip。

### Browser Smoke

- Desktop/mobile 打开 Project、Build、Validate & Release、Operate。
- Build header 在不同宽度无重叠。
- Graph toolbar 按钮可点击。
- Chat dialog 可输入、发送、Apply、Undo、Redo。
- Start Run 空 prompt 有可见提示。

### Server Tests

- `project/browse` 正常列目录。
- `project/validate-open` 返回稳定状态码和错误 envelope。
- `rebindProject` 保持现有行为和错误语义。
