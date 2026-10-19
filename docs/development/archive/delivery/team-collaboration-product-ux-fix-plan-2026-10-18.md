# Team Collaboration 产品逻辑优化与修复方案

> Status: completed delivery record, archived 2026-10-18. This document records the UX acceptance at delivery time. Current Team/TeamVersion/Project/Task/Run semantics and architecture gates are defined by [the active refactor plan](../../team-collaboration-module-refactor-plan.md), product terms by [OGS product concepts](../../../usage/ogs-concepts.md), and current user-facing behavior by [the Team Site guide](../../../../apps/team-site/README.md).

## 状态

当前版本：产品流程修复方案（已落地并通过验收）。

本方案先冻结用户可见的产品逻辑，再进行底层模块化。Team Collaboration 是普通用户的唯一产品入口；Visualizer 提供对话、authoring、校验、仿真和运行能力，但不拥有业务生命周期。

本轮实现已覆盖 canonical 团队、项目、任务和运行流程；浏览器验收同时检查桌面端、390px 移动端、`pageerror` 和 `unhandledrejection`。不兼容历史版本，不迁移历史数据。

## 产品目标

```text
团队目标
→ Natural 对话理解
→ Team Studio 完善
→ 校验并发布 TeamVersion
→ 创建 Project
→ 管理挂载团队
→ 创建 Task
→ 运行和监控 Run
```

- Team 是核心业务对象。
- TeamVersion 是可编辑、可校验、可发布和可挂载的版本。
- Project 是团队应用的业务上下文，负责资料和团队组合。
- Task 是一次工作请求。
- Run 是一次执行和审计记录。
- 一个 Task 可关联多次 Run 尝试；重试创建新 Run 并保持原 Task 关联。
- Task 的业务生命周期与 Run 的执行状态分别管理；绑定 Run 后 Task 状态只作为便于查询的投影。
- 普通用户不需要离开 Team Site 才能完成核心流程。
- 不兼容旧路由、旧字段、旧状态或历史数据迁移。

## Canonical 路由

```text
/factory/new
/studio/team/:id
/studio/project/new
/studio/project/:id/teams
/studio/project/:id/run
```

- `/factory/new`：输入团队名称和目标，创建 TeamVersion 草案。
- `/studio/team/:id`：Team Studio，负责团队设计、对话、专业编辑、校验、仿真和发布。
- `/studio/project/new`：创建 Project，只提交项目名称、概述和已发布团队。
- `/studio/project/:id/teams`：编辑现有项目的挂载团队，不创建新项目。
- `/studio/project/:id/run`：管理资料、Task、Run 和运行结果。

## Team Studio

```text
Team Studio
├── Natural
└── Professional
```

Natural 是默认模式，通过自然语言生成摘要、角色、协作关系、待确认问题和 authoring patch。

Professional 使用现有结构化编辑能力，编辑角色、关系和协作配置。两种模式必须共用同一个 `TeamVersion`、authoring 文档、digest、校验、仿真和调试能力。

Professional 不得通过无返回的外部跳转实现。若站内模式尚未完成，入口必须隐藏，不得留下不可用链接。

## 团队流程

1. 用户在 `/factory/new` 输入团队名称和目标。
2. 系统创建草案，不代表已经发布。
3. Team Studio 自动展示意图理解状态和结构化预览。
4. 用户继续对话或切换到 Professional 编辑。
5. 用户应用修改、保存草案并执行结构校验。
6. 校验通过后发布 TeamVersion。

Visualizer 不可用时，草案仍然保留；页面必须显示可重试错误或提供手工编辑，不得永久 loading 或静默失败。

## 项目流程

项目创建请求固定为：

```json
{
  "name": "项目名称",
  "overview": "项目概述",
  "teamVersionIds": ["team-version-id"]
}
```

项目创建页不再显示 `workspaceKey` 或内部工作目录标识。工作目录仍由服务端自动创建。

项目团队管理使用：

```text
GET /api/v1/projects/:projectId/teams
PUT /api/v1/projects/:projectId/teams
```

管理页必须自动回显当前团队，保存使用原子替换，不得调用项目创建接口，不得重复提交项目名称或触发 `PROJECT_NAME_EXISTS`。

活动 Run 期间禁止修改团队挂载；项目至少保留一个已发布 TeamVersion。

## 异步交互要求

- 页面请求使用 request version 和 AbortController。
- 对话、保存、发布、项目团队更新和任务操作均有独立 `try/catch/finally`。
- `AbortError` 静默处理。
- 真实错误显示在当前操作区域。
- 请求期间按钮禁用，结束后恢复。
- 旧请求不能更新新页面。
- 页面无 `pageerror` 和 `unhandledrejection`。

## 产品验收

### 团队

- [x] 输入目标后能获得意图理解摘要。
- [x] 对话请求有 loading、成功、失败和取消状态。
- [x] 应用预览后能保存草案，刷新后内容仍存在。
- [x] Natural 和 Professional 生成相同类型的 TeamVersion。
- [x] 校验失败保留输入和当前编辑状态。
- [x] 发布失败停留在当前团队页面。
- [x] 团队页面不出现项目、资料、任务和工作目录残留。

### 项目

- [x] 新建项目页不存在 `workspaceKey` 输入。
- [x] 一次创建可挂载多个已发布团队。
- [x] 管理团队页正确加载和回显当前选择。
- [x] 团队修改不会创建第二个项目。
- [x] 团队保存失败时保留选择和错误状态。
- [x] 活动 Run 期间修改被明确拒绝。
- [x] 项目创建失败不留下半成品。

### 用户体验

- [x] Back/Forward 经过 dirty guard。
- [x] 页面切换释放弹窗、抽屉、焦点陷阱和滚动锁。
- [x] 桌面端和 390px 移动端无横向溢出。
- [x] 中英文切换不丢失当前输入和状态。
- [x] 浏览器测试 `pageerror = 0`。
- [x] 浏览器测试 `unhandledrejection = 0`。

## 产品冻结门槛

底层模块化开始前必须满足：

- 典型团队从目标输入到发布通过。
- 典型项目从创建、团队管理到任务运行通过。
- Team、Project、Task、Run 语义不混用。
- Visualizer 能力调用稳定，页面不依赖内部 payload。
- 页面和 API 契约已经由浏览器和契约测试覆盖。

## 验证命令

```bash
pnpm build
pnpm --dir apps/team-site test --test-concurrency=1
pnpm run test:docs-command-drift
pnpm run test:visualizer
pnpm test
```
