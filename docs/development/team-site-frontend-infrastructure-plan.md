# Team Site 前端基础设施实施方案

## 状态

一期与二期前端基础设施：已完成；发布验收：通过。

本文只负责路由、请求生命周期、状态渲染和模块边界，不实现领域去重或运行时状态迁移。已接入全局路由委托、案例详情路由、项目创建页、已发布团队选择、SVG 缩略图、资料文件夹选择、模块化入口、请求生命周期治理、脏页保护、弹窗焦点治理和项目 Run 轮询展示。

当前验证证据：Playwright `1.63.0` 及 Chromium/headless shell 已安装；`pnpm build` 通过；完整 Team Site 测试 `30/30` 通过；相关 Playwright 回归 `7/7` 通过；桌面端和 390px 移动端验收通过，页面无 `pageerror`、无横向溢出。项目运行状态采用现有 Run/事件查询接口轮询，不新增后端 SSE 接口。

## 首期范围

- 统一首页、案例列表、案例详情、团队仓库、团队工厂、项目列表、项目创建、项目详情和平台配置路由。
- 保留一个全局 `a[data-route]` 委托，删除页面级重复绑定。
- 页面请求使用 `AbortController` 和 `requestVersion`，旧请求不得覆盖当前页面。
- 项目创建页使用已发布团队列表，并通过一次接口提交多个团队。
- 运行页使用 TaskRecord/Run 查询结果渲染状态。

实现结果：所有动态页面和异步操作统一使用请求上下文；导航会取消旧请求，旧响应和错误不会写入当前页面；`app.js` 保留兼容 bootstrap，业务实现已拆分到 `public/app/` 模块；脏页离开确认、beforeunload、焦点恢复、键盘操作和滚动锁均已接入。

## 二期范围（本版已完成）

- 将 `app.js` 拆为 `state.js`、`router.js`、`api.js`、`i18n.js`、views 和 components。
- 脏页面离开确认、Run 轮询展示、运行控制、平台配置生效提示。当前采用可取消轮询，终态自动停止；后端未提供 SSE，因此不伪造 SSE 能力。
- 弹窗焦点恢复、键盘操作和完整移动端检查。

二期验收已完成：页面不使用 `window.alert` 或 `window.confirm`；Run 状态和最近事件具有明确视觉反馈；平台设置保存后明确显示服务端返回的 `runtimeApplied: false`，提示设置已持久化并将在后续运行生效。

## 路由

```text
/
/examples
/cases/:caseId
/studio
/factory
/studio/team/:id
/projects
/studio/project/new
/studio/project/:id/run
/platform
```

非法路由使用 `history.replaceState`，不得增加重复历史记录。

## 页面状态

```ts
type PageState = {
  route: string;
  locale: "zh-CN" | "en";
  projectId?: string;
  teamId?: string;
  requestVersion: number;
  activeRequest?: AbortController;
  dirty: boolean;
};
```

## 验收标准

- 动态链接单击一次只导航一次；前进、后退和刷新状态正确。
- 页面切换时旧请求不能覆盖新页面。
- 异步提交期间按钮禁用，错误显示在操作区域，不依赖 `alert`。
- 运行状态、错误和进度具有明确视觉反馈。
- 桌面端和 390px 移动端无横向滚动。
- 模块拆分后旧入口和后端接口保持兼容。
- 浏览器流程覆盖“案例详情 -> 创建项目 -> 挂载团队 -> 创建任务 -> 查询 Run”。

## 当前发布闸门

- `/studio` 页面无 `pageerror`，经典团队区使用 SVG 图谱缩略图。
- 资料批量/文件夹上传控件已接入，显示支持格式并保留相对路径。
- 桌面端和 390px 移动端浏览器验收已通过，测试覆盖页面异常、横向溢出和一次点击一次导航。
- 发布闸门已全部通过：请求取消和过期响应保护、模块拆分、脏页面离开确认、弹窗焦点/键盘治理、Run 轮询、平台设置生效提示、桌面端和 390px 移动端检查均有实现和回归证据。

## 回归证据

- `pnpm build`
- `pnpm --dir apps/team-site test`：`30/30` 通过。
- `node --test apps/team-site/tests/visual-acceptance.test.mjs`：桌面端与 390px 移动端通过。
- Run 轮询、dirty guard、路由生命周期、模块入口和平台设置提示均有专门回归测试。
- `git diff --check`、前端模块 `node --check` 和浏览器页面异常检查通过。

## 文件边界

- 前端轨道拥有 `apps/team-site/public/app/`、`app.js` bootstrap 和页面样式。
- 使用 fixture/mock 开发，不直接修改后端领域和运行状态。
- 与后端联调只通过领域轨道和运行轨道已冻结的 API。
