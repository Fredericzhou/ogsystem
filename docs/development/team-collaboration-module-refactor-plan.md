# Team Collaboration 模块化与分层重构方案

## 状态

当前版本：产品流程冻结后的最小分层重构方案。核心产品边界已落地，代码分层仍在收敛中。

本方案只能在 `team-collaboration-product-ux-fix-plan.md` 的产品验收通过后执行。重构只改变代码组织，不改变已验收的路由、接口、状态和用户行为。

本轮采用模块化单体，不引入微服务、CQRS 或事件总线。已经完成的最小拆分包括：部分项目路由位于 `api/project-routes.mjs`，部分 Team/Project/Task 断言位于 `domain/`，Visualizer 上游聊天协议位于 `capabilities/visualizer-adapter.mjs`。

这不等同于完整分层已经完成。当前 `project-repository.mjs` 仍同时承担用例编排、文件存储、锁与 staging、任务和 Run 编排、导入导出，以及本地 Visualizer/runtime 调用；大部分 API 仍在 `server.mjs`。本方案以渐进式迁移这些边界为目标，不把现状描述为已经达到目标架构。

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

Application 是唯一可以编排领域规则、端口和事务边界的层。它不直接拼接 HTTP 响应，不直接由页面调用，也不把状态字符串散落在用例中。初始用例按聚合拆分为 `team-use-cases.mjs`、`project-use-cases.mjs`、`task-use-cases.mjs` 和 `run-use-cases.mjs`；文件存储和 runtime 调用通过端口注入或集中适配，避免把现有巨型模块原样复制到新目录。

### Domain

定义 `Team`、`TeamVersion`、`Project`、`Task` 和 `Run` 及其状态规则：

- 只有 released TeamVersion 才能挂载。
- 项目至少保留一个团队。
- 活动 Run 期间不能修改挂载。
- Run 只能进行合法状态转换。
- 项目 digest 不包含运行历史。
- Team 和 Project 名称属于不同作用域。

Domain 不依赖 HTTP、浏览器、文件系统或 Visualizer。

当前 `domain/` 已有 released TeamVersion、项目挂载锁和任务并发槽等断言，但还不是完整领域模型。目标是补齐 `run.mjs` 与 `errors.mjs`，并把 Task/Run 的转换和错误码集中在领域层。`contracts.mjs` 中的状态集合仅是共享常量，不能替代状态机。

Task 与 Run 是两个不同对象，不能共享一个含义不明的 `status`：

- Task 生命周期至少包括 `queued`、`deleted` 及其绑定的 `runId`；它属于协作项目的业务记录。
- Run 执行状态包括 `planning`、`running`、`pause_requested`、`paused`、`waiting_review`、`cancel_requested`、`completed`、`failed`、`cancelled`；它属于一次执行。
- 绑定 `runId` 后，`taskRecords.status` 是 Run 状态的反规范化投影，供列表和任务工作流使用，不能与 Run 状态文件冲突。

`run.mjs` 必须定义并校验转换，而非由 Application 拼接状态文本。现有运行语义的最小目标流转为：

```text
queued Task -> planning Run -> running
running | planning -> pause_requested -> paused
paused | waiting_review -> running (or waiting_review when unresolved review remains)
running -> waiting_review -> running
planning | running | paused | waiting_review -> cancel_requested -> cancelled
planning | running | pause_requested | paused | waiting_review | cancel_requested -> failed
running -> completed
```

其中暂停和取消是请求态，实际执行器在安全边界收敛；`waiting_review` 的批准或返工恢复由同一 Run 控制规则处理。实现时应以 runtime 当前的 `applyRunControl()` 和最终执行结果为准，新增或收紧转换必须有契约测试，不能只修改状态数组。

### Visualizer Adapter

当前适配器的边界是远程 Visualizer 的 HTTP chat 客户端，实际只提供 `chat()`。因此本阶段文档不把本地运行时能力误称为 Visualizer 协议。

若未来需要完整能力端口，统一封装：

```text
understandIntent()
generateAuthoring()
validateDesign()
simulateTeam()
executeRun()
queryTechnicalRun()
```

Visualizer 不拥有 Team、Project、Task、Run 的业务身份、发布状态、挂载关系或 Team Site 元数据。它只接收设计快照或执行请求，并返回稳定的结构化结果。

届时必须为每项能力提供真实实现，并把本地 runtime 与远程 Visualizer 分别实现该端口；在此之前，`simulateTeamVersion()`、设计校验和 Run 执行继续是 Team Site Application 用例对本地 runtime 的调用，不能伪装成当前 adapter 的职责。

### Infrastructure

负责 Team/Project/Task/Run 存储、原子写入、staging、锁、Run 状态文件、事件快照、Visualizer HTTP client、平台配置和模型发现。

## 推荐代码结构

```text
apps/team-site/
├── api/
│   ├── team-routes.mjs
│   ├── collaboration-project-routes.mjs
│   ├── task-routes.mjs
│   ├── run-routes.mjs
│   └── package-routes.mjs
├── application/
│   ├── team-use-cases.mjs
│   ├── project-use-cases.mjs
│   ├── task-use-cases.mjs
│   └── run-use-cases.mjs
├── domain/
│   ├── contracts.mjs
│   ├── team.mjs
│   ├── project.mjs
│   └── task.mjs
│   ├── run.mjs
│   └── errors.mjs
├── infrastructure/
│   ├── file-project-store.mjs
│   ├── file-run-store.mjs
│   ├── visualizer-client.mjs
│   └── model-discovery.mjs
├── capabilities/
│   └── visualizer-adapter.mjs # current remote Visualizer chat protocol
├── project-repository.mjs  # temporary compatibility facade, then removed
├── run-service.mjs         # restart recovery for persisted Run state
└── public/app/
```

`server.mjs` 最终只负责进程初始化、中间件、依赖装配、静态资源和总路由分发。按资源拆分路由不要求一次性迁移所有端点：先将 Team、Task、Run 和 package 路由移出，再收敛平台发现等横切接口。保留 `project-routes.mjs` 作为过渡模块时，应将其重命名或拆分，避免它继续成为新的聚合路由文件。

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

### 持久化权威与恢复

- 协作项目定义、团队挂载、Task 生命周期和材料索引保存在项目的 `.site/project.json` 及其关联工作区文件中。
- 对已绑定 `runId` 的执行事实，`.ogs/runs/<runId>/control/state.json` 是唯一权威；Run 计划、事件和审查记录存放在同一 Run 目录。
- `taskRecords.status` 是面向任务查询的投影。读模型应以 Run 状态文件校正它；命令应先通过 Run 状态转换写入权威状态，再在同一锁范围内更新投影。无 Run 的 `queued`、`deleted` 等 Task 生命周期不由 Run 文件表示。
- 进程重启时，`run-service.mjs` 扫描活动 Run 并将无法续跑的 Run 收敛为 `failed`，随后刷新关联 Task 投影。恢复逻辑必须幂等。
- `project.json` 不记录 Run 的事件、计划或结果快照；Run 历史不得参与项目定义 digest。允许保存 `runId`、投影状态、时间戳、摘要和错误引用，以便查询与恢复关联。

## 调试与正式运行

- Studio 调试面向草案或 TeamVersion，使用 sandbox/preview，不创建正式项目任务历史。
- Operations 运行面向 Project Task，创建正式 Run，持久化状态、事件和结果。
- 两者共用执行引擎，但使用不同的 Application 用例和持久化策略。

## 重构步骤

1. 完成产品流程和浏览器 UAT。
2. 为当前 API 增加契约测试，建立行为保护网。
3. 先冻结 `project-repository.mjs` 的公开函数签名，并用兼容 facade 转发给新增 Application 用例；新 API 路由不得再直接增加对 facade 的依赖。
4. 从 `server.mjs` 按 Team、协作项目、Task、Run、package 拆出 API route 层，保留薄的装配入口。
5. 将 Team、Project、Task 的可复用规则和 Run 状态机从存储编排中提取到 `domain/`，为合法与非法转换增加表驱动契约测试。
6. 将文件读写、staging、项目锁、Run 状态/事件读取、模型发现和远程 HTTP 分别迁移到 `infrastructure/`；每迁移一个用例，删除 facade 中对应实现而非复制。
7. 保持 `visualizer-adapter.mjs` 只描述当前远程 chat 协议。只有在完整能力端口与实现同时交付时，才扩展到 authoring、校验、模拟或执行。
8. Natural 和 Professional 继续共用同一个 TeamVersion、authoring、校验和调试能力；Operations 通过 Task/Run 用例管理正式运行。
9. 落实 Run 状态权威、读模型校正和重启恢复；验证崩溃发生在预留、创建 Run、控制、结束和投影更新各阶段时不会产生重复 Run 或永久不一致。
10. 清理旧 project 命名、专业模式外部跳转和重复页面逻辑；仅在迁移完成后删除 facade 与无调用方模块。
11. 完成全量回归、UAT、审查并提交。

### 旧数据兼容与懒物化

不做一次性全量历史迁移，但不等于不支持旧数据。当前 `case:<id>` 挂载已采用懒物化：在首次需要实际 TeamVersion 时创建或复用 released TeamVersion，在项目写锁内替换挂载和关联 Task 的引用、重算项目定义 digest，并以原子写入提交；失败时清理本次新建的 TeamVersion。

迁移期间必须遵守以下规则：

- 仅在明确的读写触发点执行物化，重复请求返回相同的规范 TeamVersion，过程幂等。
- 对外接受旧 `case:<id>` 仅作为迁移入口；成功后 API 响应和新写入一律使用规范 TeamVersion ID。旧 ID 的支持范围和移除版本必须明确记录。
- 物化失败不得留下半写入的挂载、Task 引用或 staging 目录；失败后可安全重试。
- 每类旧结构都要有 fixture，覆盖成功物化、重复物化、并发竞争、失败回滚和后续 Run。

## 重构验收

- [ ] 新增或迁移的 API 均只做 HTTP/DTO/error mapping，不直接读写文件或调用 runtime。
- [ ] Application 用例可在不启动 HTTP server 的情况下测试，并通过领域对象/端口完成编排。
- [ ] Team、Project、Task、Run 的规则均有领域层入口；Run 的全部允许和拒绝转换有契约测试。
- [ ] `state.json`、Task 投影、重启恢复和运行控制在失败/重试场景下满足上述权威规则。
- [ ] `server.mjs` 只保留初始化和路由装配；业务资源路由已按目标结构拆分。
- [ ] `visualizer-adapter.mjs` 的文档、导出接口和测试一致；未实现的能力不列为已有协议。
- [ ] lazy materialization 覆盖幂等、并发、失败回滚和 canonical ID 返回。
- [ ] Natural 和 Professional 使用同一 TeamVersion 和 authoring 模型；Studio 调试不创建正式 Run 历史。
- [ ] Project 团队替换不会创建新项目，且活动 Run 期间拒绝替换。
- [ ] API 契约、Team Site 浏览器、状态机、恢复、导入导出和兼容 fixture 测试全部通过。
- [ ] `pageerror = 0`、`unhandledrejection = 0`，桌面端和 390px 移动端无横向溢出。
- [ ] `pnpm build`、`pnpm --dir apps/team-site test --test-concurrency=1`、`pnpm run test:docs-command-drift`、`pnpm run test:visualizer`、`pnpm test` 和 `git diff --check` 通过。

## 反过度设计约束

当前不新增微服务、事件总线、外部消息队列、第二套 authoring/校验实现、一次性全量历史迁移、无期限旧 API fallback 或复杂全局前端状态框架。为保证已存数据可运行，受控的 lazy materialization 不属于“无兼容代码”，但必须有明确入口、幂等性、回滚和退出计划。
