# Team Collaboration 模块化与分层重构方案

## 状态

当前版本：产品流程冻结后的最小分层重构方案（已落地并通过验收）。

本方案只能在 `team-collaboration-product-ux-fix-plan.md` 的产品验收通过后执行。重构只改变代码组织，不改变已验收的路由、接口、状态和用户行为。

本轮采用模块化单体的最小拆分：项目创建和团队管理路由位于 `api/project-routes.mjs`，Team/Project/Task 规则位于 `domain/`，Visualizer 上游协议位于 `capabilities/visualizer-adapter.mjs`。稳定的存储编排仍集中在 `project-repository.mjs`，避免为了拆分而制造大量薄封装。

## 目标架构

```text
Team Collaboration
├── Team Studio
│   ├── Natural
│   ├── Professional
│   ├── Authoring Core
│   └── Debug / Simulation
├── Team Operations
│   ├── Task Management
│   ├── Run Control
│   ├── Monitoring
│   └── Review
├── Domain
├── Application
├── API
├── Visualizer Adapter
└── Infrastructure
```

Team Collaboration 是产品和业务生命周期；Team Studio 是团队设计工作区；Team Operations 是任务执行工作区；Visualizer/Runtime 是底层能力提供方。

## 分层职责

### Frontend Experience

负责页面、路由、Natural/Professional 模式、表单状态、dirty guard、请求取消和错误展示。

不负责 digest、发布规则、Run 状态转换、文件写入或 Visualizer 内部协议。

### HTTP/API

负责路由匹配、请求验证、DTO 转换、HTTP 状态码和错误码映射。

不直接实现领域规则、文件系统操作或 Visualizer 内部逻辑。

### Application

集中编排完整用例：

```text
createTeamDraft
understandTeamIntent
applyTeamAuthoring
releaseTeamVersion
createProject
replaceProjectTeams
createTask
reserveRun
controlRun
reviewTask
```

### Domain

定义 `Team`、`TeamVersion`、`Project`、`Task` 和 `Run` 及其状态规则：

- 只有 released TeamVersion 才能挂载。
- 项目至少保留一个团队。
- 活动 Run 期间不能修改挂载。
- Run 只能进行合法状态转换。
- 项目 digest 不包含运行历史。
- Team 和 Project 名称属于不同作用域。

Domain 不依赖 HTTP、浏览器、文件系统或 Visualizer。

### Visualizer Adapter

统一封装：

```text
understandIntent()
generateAuthoring()
validateDesign()
simulateTeam()
executeRun()
queryTechnicalRun()
```

Visualizer 不拥有 Team、Project、Task、Run 的业务身份、发布状态、挂载关系或 Team Site 元数据。它只接收设计快照或执行请求，并返回稳定的结构化结果。

### Infrastructure

负责 Team/Project/Task/Run 存储、原子写入、staging、锁、Run 状态文件、事件快照、Visualizer HTTP client、平台配置和模型发现。

## 推荐代码结构

```text
apps/team-site/
├── api/
│   └── project-routes.mjs
├── domain/
│   ├── contracts.mjs
│   ├── team.mjs
│   ├── project.mjs
│   └── task.mjs
├── capabilities/
│   ├── visualizer-adapter.mjs
│   └── (Visualizer authoring and runtime remain in the shared runtime package)
├── project-repository.mjs  # current file-backed application/storage orchestration
├── run-service.mjs         # restart recovery for persisted Run state
└── public/app/
```

这是模块化单体，不要求立即拆分微服务，也不引入通用 `BaseRepository`、事件总线、CQRS 或复杂依赖注入框架。

## 共享契约

Natural 和 Professional 共用：

```text
TeamAuthoringDocument
TeamVersion
ValidationResult
SimulationResult
```

Operations 共用：

```text
TaskExecutionRequest
RunSnapshot
RunEvent
RunControl
```

Team Site 是业务真相源；Visualizer 只处理能力调用和技术投影。

## 调试与正式运行

- Studio 调试面向草案或 TeamVersion，使用 sandbox/preview，不创建正式项目任务历史。
- Operations 运行面向 Project Task，创建正式 Run，持久化状态、事件和结果。
- 两者共用执行引擎，但使用不同的 Application 用例和持久化策略。

## 重构步骤

1. 完成产品流程和浏览器 UAT。
2. 为当前 API 增加契约测试，建立行为保护网。
3. 从 `server.mjs` 拆出项目创建和团队管理 API route 层。
4. 将 Team、Project、Task 的可复用状态规则从存储编排中提取到 `domain/`。
5. 提取 Visualizer Adapter，禁止页面和 API 路由直接拼接 Visualizer 上游协议。
6. Natural 和 Professional 继续共用同一个 TeamVersion、authoring、校验和调试能力。
7. 任务、Run、监控和审核继续由 Team Site 的 Operations 用例管理，运行状态以持久化状态文件为权威。
8. 清理旧 project 命名、专业模式外部跳转和重复页面逻辑。
9. 删除本次变更涉及的无调用方旧函数和兼容分支，更新文档与测试。
10. 完成全量回归、UAT、审查并提交。

## 重构验收

- [x] 产品流程与重构前一致。
- [x] Natural 和 Professional 使用同一 TeamVersion 和 authoring 模型。
- [x] Team Site 不重复实现 Visualizer 能力。
- [x] Visualizer 不拥有 Team/Project/Task/Run 业务状态。
- [x] Project 团队替换不会创建新项目。
- [x] Run 状态仍以持久化状态文件为权威。
- [x] API 契约测试全部通过。
- [x] Team Site 浏览器测试全部通过。
- [x] `pageerror = 0`。
- [x] `unhandledrejection = 0`。
- [x] 桌面端和 390px 移动端无横向溢出。
- [x] 无新增旧路由、旧字段、旧状态兼容代码。
- [x] 无本次变更遗留的无调用方旧模块和重复能力。
- [x] `pnpm build` 通过。
- [x] `pnpm --dir apps/team-site test --test-concurrency=1` 通过。
- [x] `pnpm run test:docs-command-drift` 通过。
- [x] `pnpm run test:visualizer` 通过。
- [x] `pnpm test` 通过。
- [x] `git diff --check` 通过。

## 反过度设计约束

当前不新增微服务、事件总线、外部消息队列、第二套 authoring/校验实现、历史迁移、旧 API fallback 或复杂全局前端状态框架。
