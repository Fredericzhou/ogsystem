# Team Site 前端基础设施实施方案

## 状态

最新方案：已实现；发布验收：通过。

本文只负责路由、请求生命周期、状态渲染、模块边界和用户交互治理，不实现领域去重、摘要计算或运行时状态迁移。当前版本按最新路由和字段契约工作，不保留旧入口兼容。

验证证据：Playwright `1.63.0` 与 Chromium/headless shell 已安装；`pnpm build` 通过；Team Site 全量测试 `50/50` 通过；浏览器验收覆盖案例详情、SVG 图谱缩略图、`/factory/new`、`/studio/project/new`、多团队项目、资料上传、Run 轮询、平台设置、桌面端和 390px 移动端。

## 已实现能力

- 路由统一覆盖首页、案例列表、案例详情、团队仓库、团队工厂、项目列表、项目创建、项目详情和平台配置。
- 保留一个全局 `a[data-route]` 委托，删除页面级重复路由绑定。
- 页面请求使用 `AbortController` 和 `requestVersion`；导航会取消旧请求，旧响应和错误不能写入当前页面。
- 任务提交、暂停、继续、取消、审核和资料上传都处理取消异常；AbortError 被静默忽略，真实失败显示在操作区域。
- 路由切换会关闭抽屉和审核弹窗，释放焦点陷阱与滚动锁；非法路由规范化后同步 Router 当前路径，避免重复历史记录。
- 项目创建页使用已发布团队列表，通过一次接口提交多个团队；项目页支持批量资料与文件夹相对路径上传。
- 经典团队卡片展示 SVG 图谱缩略图并进入 `/cases/:caseId`；团队详情、协作项目和 Run 页面均有明确加载、错误和空状态。
- `app.js` 保留稳定 bootstrap 入口，业务实现拆分到 `public/app/` 的 state、router、api、i18n、views 和 components 模块。
- Run 页面通过 TaskRecord/Run/events 查询接口轮询，终态自动停止；不新增或伪造 SSE。
- 脏页离开确认、`beforeunload`、弹窗焦点恢复、Escape、键盘操作和滚动锁已接入。
- 平台设置保存后明确显示服务端返回的 `runtimeApplied: false`。

## 路由

```text
/
/examples
/cases/:caseId
/studio
/factory
/factory/new
/studio/team/:id
/projects
/studio/project/new
/studio/project/:id/run
/platform
```

非法路由使用 `history.replaceState` 并同步 Router 当前路径，不增加重复历史记录。

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

## 发布验收清单

- [x] 动态链接单击一次只导航一次；前进、后退、刷新和非法路由规范化正确。
- [x] 页面切换时旧请求被取消，过期响应不会覆盖新页面。
- [x] 异步提交期间按钮禁用；取消请求不产生未处理 rejection，真实错误显示在操作区域。
- [x] 路由切换会清理审核对话框、抽屉、焦点陷阱和滚动锁。
- [x] 运行状态、错误、进度和最近事件具有明确视觉反馈。
- [x] 桌面端和 390px 移动端无横向滚动。
- [x] 浏览器流程覆盖“案例详情 -> 创建团队/项目 -> 挂载多个团队 -> 批量资料 -> 创建任务 -> 查询 Run”。
- [x] 浏览器页面无 `pageerror`、无未处理 rejection，SVG 图谱缩略图正常渲染。

## 非目标与边界

- 不支持 `/studio/new`；团队创建入口为 `/factory/new`，协作项目创建入口为 `/studio/project/new`。
- 不保留旧字段或旧状态兼容；前端不迁移数据。
- 运行状态采用可取消轮询；SSE 属于后续独立能力，不在当前版本宣称完成。

## 回归命令

```bash
pnpm build
pnpm --dir apps/team-site test --test-concurrency=1
pnpm run test:docs-command-drift
pnpm run test:visualizer
pnpm test
```

## 文件边界

- 前端轨道拥有 `apps/team-site/public/app/`、`app.js` bootstrap 和页面样式。
- 使用 fixture/mock 开发，不直接修改后端领域和运行状态。
- 与后端联调只通过领域轨道和运行轨道冻结的 API。
