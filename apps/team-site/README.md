# OGS Projects

OGS Projects 与 OGS Studio 共用一个 Origin 和 SPA Shell。OGS Studio 面向团队工程，负责团队草稿、图谱设计、Simulation 调试、诊断和发布；Projects 面向业务协作，负责项目材料、Task 生命周期和业务结果。模型发现和默认设置由共享 Platform 页面提供：

当前版本只接受最新业务数据格式，不提供旧 schema/API 字段兼容或自动迁移。升级前由运行方显式准备新的数据根或清理旧数据；应用启动不会自动删除用户数据。

- **OGS Studio**：创建和编辑团队草稿，配置角色执行与编排参数、角色资产包、Context Map 和 Flow Contract/Schema，运行隔离 Simulation、查看历史并发布 TeamVersion。专业编辑能力已实现；自动化覆盖部分字段、保存与回读场景，完整字段矩阵和设计到发布的人工 UAT 尚未签收。
- **OGS Projects**：创建协作项目，挂载已发布 TeamVersion，管理项目材料、Task 生命周期和业务结果。
- **团队工程**：团队仓库、团队创建和角色仓库分别管理 Team 草稿/发布版本、工程设计入口和不可变角色模板。
- **要素配置**：模型、数据集、工具元数据和存储目标。模型目录提供发现结果；数据集可发布不可变快照，但尚未绑定到 Task/Simulation 输入；工具与存储目录只保存能力元数据和凭据引用。
- **平台配置**：查看自动发现的 Codex、OpenCode 及其模型，设置默认底座、模型请求等待时间和失败重试次数。

模块之间只通过已发布 TeamVersion 建立业务连接：Studio 发布后，用户在 Project 中显式挂载版本；Task 创建时固定该版本，后续重试沿用它。Task 承载业务请求，Run 保存每次尝试的只读证据，Deliverable 则是成功 Run 输出的独立只读快照。

## 核心规则

1. 创建或编辑团队不会创建项目，也不包含工作目录、项目材料或任务。
2. 创建项目不会创建团队。项目只能挂载已发布的团队版本；内置案例在服务启动时按正式发布规则物化为持久化 TeamVersion，案例页的“用于项目”复用该规范版本 ID。需要修改案例设计时，可先从该团队复制草稿，调整并发布后再挂载；切换界面语言不会创建新版本。
3. 一个项目只挂载一个已发布 TeamVersion。需要使用其他团队时，在 Studio 完成设计与发布后，于项目中切换版本；不同项目可以使用不同团队。
4. 一个工作目录只能绑定一个协作项目，但该项目可以使用已挂载团队多次执行不同任务。
5. 当前一个项目最多只有一个任务关联活动 Run；从计划创建、就绪、运行和控制请求待收敛，到暂停或等待审核期间，该执行槽都被占用。Run 进入终态后才能开始下一项。
6. Task 是用户提交的一次工作请求；Run 是执行该请求的一次尝试。一次 Run 成功完成并满足适用验收条件后，Task 即完成；不为重复执行而自动创建新 Run。失败或异常后的重试属于同一个 Task，并创建新的 Run 尝试。暂停、待审核及符合恢复契约的中断从原检查点继续，仍是同一个 Run。
7. 失败的 Task 从 Task 操作发起重试。Task 保留有序 `runIds`，`currentRunId` 指向最新尝试；每个 Run 有递增的 `attemptNumber`，历史 Run 只读。重复重试请求由尝试幂等键去重；这保证重复请求不会重复预留同一尝试，不保证任意外部副作用恰好执行一次。删除 Task 只隐藏清单项，Run 快照仍保留审计记录。
8. Runtime 在恢复权威文件有效时可从 checkpoint 恢复中断 Run。OGS Projects 服务重启时会把遗留活动 Run 标为失败；之后通过 Task 重试会新建 Run，不会自动续跑原 Run。

## 业务对象

| 对象 | 用户含义 | 生命周期与关系 |
| --- | --- | --- |
| Team | 可复用的协作团队身份 | Studio 负责编辑和发布，Projects 负责在业务项目中使用。 |
| TeamVersion | Team 的一次已发布定义快照 | 保存草稿不会创建已发布版本；发布后不可原位修改。Project 挂载具体版本，Task 创建时固定引用该版本；后续卸载或发布新版本不改变已有 Task。 |
| Collaboration Project | 一项持续的业务工作 | 保存项目目标、材料、已挂载 TeamVersion 和 Task 清单。 |
| Task | 用户希望团队完成的一项工作请求 | 创建时固定一个 TeamVersion，并分配不复用的项目内 `taskNumber`；在 Run 启动前可排队或删除，状态投影当前 Run。 |
| Run | 一次具体执行尝试及其审计记录 | 独立保存输入快照、执行状态、事件、审核和结果。重试从 Task 发起并创建新 Run；历史 Run 状态和结果不变。 |

Run DTO 以 `runKind` 和 `owner` 明确运行领域及归属；Project Task Run 使用 `owner.projectId + owner.taskId + runId` 定位，TeamVersion 通过 `owner.teamVersionId` 标识。运行文件位于项目自己的 `.ogs/runs/<runId>/`，团队资产目录只作为只读来源。最近运行页只列出 Projects Task Attempts；Studio Simulation 通过独立历史 API 读取。

版本用于冻结发布内容和保证项目执行可复现，不要求用户为每次保存管理一个版本。专业编辑和发布在 OGS Studio 完成。Projects 用户可以发起自然语言团队调整；Studio 创建新草稿，用户检查并发布后，回 Projects 显式挂载新版本。

Task 与 Run 不能互换使用：任务列表展示业务请求和尝试时间线，Run 详情展示一次尝试的执行证据。Task 选择一个已挂载 TeamVersion，所有重试都沿用该版本。一次 Run 成功完成并满足适用验收条件后，Task 即成功；失败或异常才创建新的 Run 尝试。暂停、继续、审核恢复和有效检查点上的中断恢复继续当前 Run；历史 Run 只读。Run 状态文件是执行状态权威；绑定 Run 后 Task 状态是便于列表查询的投影。列表只显示结果摘要，展开后按需读取经 Runtime 凭据脱敏的完整结果；完整结果不可用时会明确说明当前仅有摘要。readiness 阻塞发生在 Run 预留前，Task 保持待执行且不会增加尝试。Studio Simulation 独立保存在 `.studio/simulations/<teamVersionId>/<simulationId>/`，可在 Studio 历史中回放，并按独立保留策略清理；不会创建 Project Task、占用项目执行槽或进入项目运行历史。

Project Run 工作目录位于 `<projectId>/.ogs/runs/<runId>/`，其中保存从固定 TeamVersion 物化的只读资产快照、Materials 快照、Runtime 状态与审计证据；TeamVersion 不接收业务 Run 写入。成功 Run 可归档为独立 Deliverable，索引位于 `.site/deliverables.json`，内容快照位于 `workspace/deliverables/<deliverableId>/`，并记录来源 Task、Run、attempt 和内容摘要。Run 目录隔离状态与证据，不等于隔离角色对项目代码或外部系统的副作用；per-Run Git worktree、网络、凭据和外部服务仍需额外沙箱与权限控制。

## 用户入口

| 页面 | 地址 | 用途 |
| --- | --- | --- |
| OGS Projects | `/projects` | 业务协作台，管理项目、资料、Task、Review 与 Deliverables |
| OGS Studio | `/studio` | 团队工程台，管理团队草稿、图谱设计、Simulation 和发布版本 |
| 已发布团队目录 | `/teams` | 浏览已发布团队版本及案例 |
| 创建团队 | `/studio/new` | 通过自然语言创建团队草案 |
| 团队设计 | `/studio/teams/:id/design` | 图谱、角色执行与编排、Context Map、角色资产包和 Flow Contract/Schema 编辑；保存后可校验、Simulation 并进入发布门禁 |
| Studio Simulation | `/studio/teams/:teamVersionId/run`、`/studio/teams/:teamVersionId/run/:simulationId` | 启动仿真并查看对应 TeamVersion 的隔离历史与回放 |
| 项目运行历史 | `/history` | 只列出 Projects Task Runs，不混入 Studio Simulation |
| 创建项目 | `/projects/new` | 创建工作目录并挂载已发布团队 |
| 项目详情 | `/projects/:id` | 管理材料、Task、执行控制、审核、重试和 Deliverables |
| 项目运行详情 | `/projects/:id/runs/:runId` | 查看一次 Project Task Run 的状态、结果和审计证据 |
| 平台配置 | `/platform` | 查看底座/模型探测结果和默认执行设置 |

团队建设页面不会提供“导出团队”。导出属于团队仓库的资产管理操作；导入入口统一称为“导入团队”。

## 本地启动

在仓库根目录执行：

```powershell
pnpm build
pnpm --dir apps/team-site start
```

本地产品入口为 `http://127.0.0.1:4173/projects`；根路径 `/` 自动进入此入口，可用 `PORT` 覆盖。项目、团队设计、运行诊断和平台配置
都从这个 Team Site Origin 进入。Visualizer 服务默认监听本机 `4177`，由 Team Site 服务端 adapter 调用；它是
内部上游服务，不是另一个产品入口。需要自定义服务地址时，在启动 Team Site 前设置 `OGS_VIS_URL`。

## Tailnet 访问

Windows 上从仓库根目录执行：

```powershell
pnpm start:team-site:tailnet
```

脚本会将 Team Site 绑定到 `0.0.0.0:4174`，因此可通过本机 Tailnet 地址访问，例如
`http://100.66.215.15:4174/projects`。团队设计、平台配置和运行诊断仍从该站点入口打开；Visualizer 上游服务
不作为单独的产品地址提供给用户。脚本会输出站点地址、当前节点信息和日志目录。

## 底座与模型

平台配置会调用本机 CLI 的探测能力，展示已发现的 Codex、OpenCode 服务及可用模型。站点不接管这些
CLI 的账号或凭据。模型请求超时只表示等待**单次模型请求返回**的最长时间，不限制一个任务的总执行时间；
任务仍可能因为多角色、多轮处理或人工审核而持续更久。

## 验证

运行团队案例的真实底座验证前，请先完成对应 CLI 的登录：

```powershell
pnpm --dir apps/team-site verify:cases
```

也可以通过 `OGS_DEMO_BACKEND` 和 `OGS_DEMO_MODEL` 选择 Codex 或 OpenCode 的具体模型。Team Site 页面和
Visualizer 图编辑器有不同的自动化测试入口；测试使用隔离的数据目录，不代表它们是两个面向用户的站点。
