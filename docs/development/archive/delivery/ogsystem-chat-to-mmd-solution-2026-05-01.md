# 页面内对话式 MMD 生成与编辑方案

## 目标
在 `Build` 内提供一个对话式编排面板，让用户可以直接用自然语言生成、调整、修复 `system.mmd`，同时保持当前架构边界不变。

## 基本原则
- `StudioAuthoringDocument` 仍是编辑真相。
- `system.mmd` 仍是运行真相。
- `X6` 只负责图形视图，不进入内核。
- 对话结果必须先经过 `authoring validation`，再经过 `Mermaid validation`，才能应用或落盘。

## 推荐形态
把功能放在 `Build -> Studio Bridge` 旁边，作为同一工作台里的对话面板，而不是独立新页或另一套编辑器。

### 页面结构
- 左侧：对话输入与历史
- 中间：图预览或选中对象上下文
- 右侧：结构化草稿、差异预览、校验结果
- 底部：`Apply` / `Refine` / `Regenerate` / `Save draft`

## 交互流程
1. 用户输入自然语言。
2. 系统基于当前项目上下文生成结果。
3. 若信息不足，返回 `ask`，追问 1 到 3 个关键问题。
4. 若信息足够，返回 `draft` 或 `final`。
5. 先产出 `authoring patch`。
6. 再生成 `system.mmd`。
7. 先展示建议草稿和差异预览，用户确认后再应用。
8. 校验通过后，应用到当前图和工作区。
9. 用户继续对话微调，或切回图编辑。

## 复用路径
直接复用现有能力，不另起一套生成器。

- 复用 `src/nl2mmd/service.ts`
- 复用 `src/visualizer/studio-authoring.ts`
- 复用现有 project / workbench / validation 流程
- 新增一个面向视觉工作区的会话 API，但不要拆成彼此割裂的多套契约

### 建议新增 API
```txt
POST /api/v1/project/studio/chat
```

### 输入建议
- `message`
- `selectedRoleId`
- `selectedFlowKey`
- `currentAuthoring`
- `currentValidation`
- `currentSystemSource`
- project context

### 输出建议
- `sessionId`
- `mode`
- `summary`
- `questions`
- `assumptions`
- `authoringPatch`
- `previewMermaid`
- `warnings`
- `validation`
- `actions`

其中 `actions` 可以包含 `preview`、`apply`、`refine` 等显式动作，但主入口仍应保持单一会话式契约，避免后续演化成多套松散 API。

## 编辑边界
- 聊天只能改 `authoring`
- 不允许直接写 `system.mmd`
- 不允许跳过 validation
- 不允许绕过受控 API 写项目文件
- 当前选中节点或连线时，优先围绕选中对象做定向编辑

## 体验建议
- 对话结果先显示“建议草稿”，用户确认后再应用
- 选中角色时，聊天输入默认带上下文
- 选中连线时，聊天优先处理 flow 语义
- 如果当前 Mermaid 解析失败，自动进入“修复模式”
- 修复模式下只给修复建议，不允许直接发布

## 分阶段落地
### Phase 1
- 已实现：只读对话生成、输出草稿和预览、受控会话契约、Build 内 chat 面板、authoring patch 预览
- 已实现：browser smoke 覆盖主路径和空目录创建后进入 Build 的回归
- 已实现：i18n 基础覆盖，chat 面板和 Studio Bridge 文案可切换
- 已实现：API 契约统一为 `POST /api/v1/project/studio/chat`，不再使用 `/chat/mmd` 旁路路径
- 仍待做：真正的独立 chat page、连续对话深修订、AI 结果更丰富的结构化补丁合并

### Phase 2
- 已实现：`Apply patch`
- 已实现：角色和连线定向编辑
- 已实现：Apply 前校验阻断，validation 不通过时禁止应用到 Studio Bridge
- 仍待做：更细的选中对象上下文编辑和冲突解释

### Phase 3
- 仍待做：连续对话修订
- 已实现：与图编辑双向同步的基础闭环

### Phase 4
- 仍待做：异常态和空状态的更细分产品化

## 验收标准
- 能在页面内直接对话生成 MMD
- 能基于当前选中角色或连线继续编辑
- 所有结果都经过 authoring 和 Mermaid 校验
- 不影响 runtime / parser / compiler 内核
- `Build` 内可完成生成、预览、应用、保存的闭环
- 当前实现满足最小闭环，但仍不是完整独立 chat editor

## 本轮验证
- `pnpm build`
- `node --test --test-name-pattern='chat-to-MMD' tests/visualizer-client.test.mjs`
- 新增 client 行为断言：
  - chat 请求只走 `/api/v1/project/studio/chat`
  - 请求包含当前 `authoring`、`systemSource` 和选中 role 上下文
  - validation 通过时可 `Apply`，并同步到 Studio Bridge 与 source workbench
  - validation 失败时 `Apply` 禁用，不能误应用
- 新增 server 契约断言：空消息在 `/api/v1/project/studio/chat` 返回 `CHAT_MESSAGE_REQUIRED`

## 结论
这条路线是可行的，且最符合当前架构。现阶段已经落到“对话生成草稿 + 显式确认应用 + 受控落盘”的最小闭环；后续再补连续对话、异常态产品化和更完整的独立聊天页。
