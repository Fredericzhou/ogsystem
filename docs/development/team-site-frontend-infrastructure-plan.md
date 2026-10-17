# Team Site 前端基础设施实施方案

## 状态

一期基线：部分具备，可继续实施；发布验收：未通过。

本文只负责路由、请求生命周期、状态渲染和模块边界，不实现领域去重或运行时状态迁移。当前已接入全局路由委托、案例详情路由、项目创建页、已发布团队选择、SVG 缩略图和资料文件夹选择；页面模块化和完整生命周期治理仍属后续工作。

当前验证证据：Playwright `1.63.0` 及 Chromium/headless shell 已安装；完整 Team Site 测试 `24/24` 通过，桌面端和 390px 移动端浏览器验收通过，页面无 `pageerror`。

## 首期范围

- 统一首页、案例列表、案例详情、团队仓库、团队工厂、项目列表、项目创建、项目详情和平台配置路由。
- 保留一个全局 `a[data-route]` 委托，删除页面级重复绑定。
- 页面请求使用 `AbortController` 和 `requestVersion`，旧请求不得覆盖当前页面。
- 项目创建页使用已发布团队列表，并通过一次接口提交多个团队。
- 运行页使用 TaskRecord/Run 查询结果渲染状态。

当前差异：请求取消和 `requestVersion` 主要覆盖项目创建页，其他动态页面仍有未统一请求生命周期；`app.js` 尚未按计划拆分为模块，脏页面离开确认和完整焦点治理仍待实施。

## 二期范围

- 将 `app.js` 拆为 `state.js`、`router.js`、`api.js`、`i18n.js`、views 和 components。
- 脏页面离开确认、SSE/轮询展示、运行控制、平台配置生效提示。
- 弹窗焦点恢复、键盘操作和完整移动端检查。

二期范围不应反向阻塞一期接口联调，但在发布验收中必须明确为未完成能力。当前仍存在 `window.alert`，`app.js` 也尚未拆分为文档规划的模块结构。

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
- 后续仍需统一所有动态页面的 AbortController、requestVersion 和过期响应保护，并完成模块拆分、脏页面离开确认和焦点治理。

## 文件边界

- 前端轨道拥有 `apps/team-site/public/app/`、`app.js` bootstrap 和页面样式。
- 使用 fixture/mock 开发，不直接修改后端领域和运行状态。
- 与后端联调只通过领域轨道和运行轨道已冻结的 API。
