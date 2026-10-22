# OGS 产品概念

本文是当前版本的产品词汇表。运行时语义仍以 [核心概念](ogsystem-core-concepts.md) 和
[编排语义](ogsystem-orchestration-semantics-v1.md) 为准。

本页区分通用 Runtime 与网站产品模型：Projects 面向业务用户，管理项目、材料和 Task；Studio 是同一 Team Site
Shell 中面向专业团队的区域，负责团队编辑、调试和运行诊断。Runtime 的一次动态执行称为 `Run`；Projects
中的 `Task` 是用户工作请求，可先排队并关联零个或多个 Run 尝试。页面中的任务指 Task，运行详情指一条 Run。

## 四个边界

| 概念 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| **框架** | 解析、编译、执行、恢复、CLI 和自然语言结构生成 | 团队、项目、用户和运行记录 |
| **平台** | 框架、底座/模型探测、角色资源和 OGS Studio | 用户项目数据和团队业务记录 |
| **团队** | 可复用的静态职责、角色关系、流转图、循环/分支语义和运行规则 | 工作目录、项目材料、Run 实例和运行历史 |
| **协作项目** | 一个项目工作目录、共享资源、已挂载团队版本和 Task 清单 | 修改团队静态结构、替代 Run 目录 |

## 三层核心模型

### 团队：静态协作定义

团队（`Team`）是稳定、可复用的身份；其发布版本（`TeamVersion`）是一次不可变的结构快照。日常编辑保存在当前草稿，
不会因每次保存而创建新发布版本。用户在发布或选择稳定定义时才需要看到版本；不需要自行维护版本分支。团队描述
“有哪些责任角色、角色之间如何流转、哪些循环/分支/汇合语义有效”。循环是团队拓扑和语义的一部分，不是某次运行产生的临时状态。

团队可以包含角色包、交接合同、执行绑定和团队级元数据，但不包含项目材料、工作目录、凭据或运行历史。

### Run：动态执行实例

Run 是某个团队版本的一次执行尝试，并绑定一个运行工作目录。它保存本次请求的输入、执行状态、
中间产物、最终结果、日志、检查点、人工审核和审计证据。暂停或待审核的 Run 在恢复契约有效时从原检查点继续，仍是同一个 Run；符合 Runtime 恢复契约的进程中断也可从已提交的 frontier 恢复。Run 终态后仍可查询和复盘，但不能继续执行。Run 也不能反向修改已发布的团队版本。

在 OGS Projects 中，每个 Task 创建时固定绑定一个不可变 TeamVersion；项目挂载列表只决定新 Task 可选版本，后续卸载或归档不得破坏已有 Task 的启动、重试和历史查询。项目内递增的 `taskNumber` 用于页面和审计展示，稳定不透明的 `taskId` 用于 API 与关联。Task 可以先排队；readiness 在预留 Run 前检查，阻塞时 Task 仍为 queued 且没有 Run。执行失败会保留失败 Run；从同一 Task 重试沿用 Task ID 并创建新的 Run ID。`currentRunId` 指向最新尝试，每个 Run 有单调递增的 `attemptNumber`，历史 Run 状态、结果和事件只读。暂停、人工审核或有效检查点上的中断恢复继续使用原 Run，不增加尝试。Task 状态是当前尝试的查询投影，Run 状态是执行事实。相同幂等键和相同请求可去重重复提交，但这不构成对任意外部副作用的恰好一次保证。通用 Runtime 本身不定义 Projects 的 Task 实体。

Studio Simulation 是团队工程调试记录，以 TeamVersion ID 和摘要固定输入资产，存储调试输入、状态与审计事件，并可在 Studio 历史页回放。它与 Projects Task Run 使用不同的 owner、存储目录和 API，不创建业务 Task、不占项目执行槽、不进入项目运行历史或 Deliverable。

### 项目：资源与运行的聚合范围

项目描述“在哪些资源上工作、使用哪个团队、提交了哪些工作请求”。一个项目只挂载一个已发布
团队版本，也可以有多个 Task；同一 Task 可关联多个 Run 尝试。不同项目可以使用不同团队版本。项目不复制或嵌入团队结构；用户可从 Projects 发起自然语言团队调整，Studio 创建新草稿，用户检查并发布后，再回 Projects 明确切换版本。已有关联继续引用原版本。

## 关系与基数

```text
项目 1 ── 1 TeamVersion 挂载
项目 1 ── * Task
Task 1 ── 0..* Run 尝试
Task * ── 1 TeamVersion
Run * ── 1 Task（Projects Task Run）
Run * ── 1 TeamVersion
Run 1 ── 1 Runtime 工作区
项目 1 ── 1 项目工作目录
```

每个 Task/Run 必须绑定一个确定的团队版本。团队发布新版本或项目重新挂载团队，不得改变既有 Task/Run 的版本引用；
历史运行应继续使用其已冻结的团队/系统指纹和输入快照。

Projects Run DTO 使用 `runKind` 和 `owner` 明确运行领域及归属。Project Task Run 以 `owner.projectId + owner.taskId + runId` 定位，`owner.teamVersionId` 表示不可变团队资产版本。状态、事件、检查点和输出存放在项目自己的 `.ogs/runs/<runId>/`；TeamVersion 只作为资产来源，不接收业务 Run 写入。

成功 Project Run 可由用户归档为 Deliverable。归档会复制出独立只读快照并计算 digest，记录来源 `taskId`、`runId`、`attemptNumber` 和时间；Deliverable 索引位于 `.site/deliverables.json`，内容位于 `workspace/deliverables/<deliverableId>/`。归档不修改 Run 证据，也不改变 Materials。

## 工作目录边界

- **项目工作目录**保存项目级资源、输入材料、项目配置和可复用资产。
- **运行工作目录**对应 `.ogs/runs/<run-id>/`，保存该次 Run 的快照、状态、中间产物、最终结果和审计证据。
- **外部编程工作目录**可以通过项目配置或 `--workspace-dir` 绑定；它是角色工具实际操作的目标，不改变项目对
  团队定义和运行证据的所有权。

项目资源可以被 Run 读取；每次 Attempt 在启动时固定 Materials 快照，重试优先复用源 Attempt 的快照。源 Run 状态缺失而按当前项目材料回退时，系统会将回退原因和策略写入新 Attempt 元数据。Project Run 的工作区位于项目自己的 `.ogs/runs/<runId>/`，其中包含 TeamVersion 资产快照、Materials 快照、Runtime 状态和审计证据。它隔离运行状态和审计产物，不自动隔离角色对共享项目目录、外部目标目录、服务或 API 的写入。对 Git 管理的代码目录，可采用每个 Run 一个 worktree/分支、固定基准 commit、恢复时复用原 worktree、失败重试时从相同基准创建新 worktree，并在检查后显式合并的方案；当前 OGS Projects 尚未提供这一自动化能力。Git worktree 也不限制网络、凭据或 worktree 外写入，需要时仍须使用操作系统或容器沙箱。

## 用户流程

```text
OGS Studio 创建/专业调整 -> 发布 TeamVersion -> OGS Projects 挂载版本 -> 创建 Task -> 执行 Run -> 复盘
```

- **团队仓库**只展示已发布版本，提供导入、复制为新版本和资产管理。
- **OGS Studio**保存编辑中和待发布团队，负责图谱结构、系统与角色配置、角色资产包、Context Map、Flow Contract、静态校验、Simulation 调试与发布。专业配置保存到 TeamVersion 草稿，发布版本不可原地修改。Platform 管理共享模型目录与默认执行设置；Projects 可发起团队调整并在 Studio 完成检查和发布，再显式挂载新版本。TeamVersion 查询、元数据及设计操作使用 TeamVersion API；Project API 管理业务项目及其 TeamVersion 挂载关系。
- **协作项目**单独创建工作目录并挂载一个已发布团队版本。项目页面关注资源、任务清单和运行记录，
  不嵌入团队结构；查看团队时再进入对应团队页面。
- **Task**记录明确的工作输入和执行团队版本。启动后创建 Run；当前同一项目最多一个 Task 的 Run 处于任一活动状态，
  包括计划创建、就绪、运行、控制请求待收敛、暂停或待审核；进入终态后才能开始下一项。

Project Run 与 Studio Simulation 使用独立持久化命名空间：Project Run 证据位于项目 `.ogs/runs/<runId>/`；Studio Simulation 位于共享数据根 `.studio/simulations/<teamVersionId>/<simulationId>/`，并按独立保留策略清理。两类记录通过各自 API 和 owner 校验查询，不能交叉读取。成功 Run 可由用户显式归档为 Deliverable；归档不改写 Run 证据。运行目录隔离状态和证据，但不保证隔离共享代码目录、网络、凭据或外部服务。

当前版本只接受最新业务数据格式，不提供旧 schema/API 字段兼容或自动迁移。运行方须在升级前显式准备新的数据根或清理旧数据；应用不会在启动时自动删除用户数据。

## 团队版本

团队名称和版本号共同标识一个已发布版本。已发布团队可以复制到 OGS Studio 进行编辑，编辑后必须另存为新
版本；同一团队不得存在同名版本。编辑中的版本不会出现在项目挂载列表，只有发布后才能使用。

内置案例可直接用于创建协作项目，项目挂载的是系统解析出的正式团队版本。用户也可以先把案例复制到 OGS Studio，调整并发布自己的团队版本，再用于项目。

## Task 与 Run 状态及控制

Task 在启动前可以排队或删除；启动后显示当前 Run 的执行状态。活动 Run 可以处于计划创建、就绪、运行、控制请求待收敛、暂停或待人工审核，终态包括已完成、
处理失败或已停止。用户可以：

- 开始任务；
- 暂停后继续；
- 在待人工审核时提交通过、退回修改或终止意见；
- 停止无法继续的任务；
- 删除排队 Task，或从清单隐藏已有 Task。已启动 Run 的快照和审计信息仍保留。

Task 创建支持幂等键。相同幂等键和相同请求会复用原 Task，输入变化会被拒绝。Run 重试则创建新的尝试并保留与原 Task 的关联。

## 请求等待时间

平台配置中的“模型请求超时”只限制一次请求等待模型返回的时间。它不是 Run 总时长限制；一次 Run 可能包含
多个角色、多轮处理、暂停或人工审核，因此可以正常超过该值。请求超时后，任务记录会保留异常信息，用户可
根据任务状态继续、停止或重新处理。

## 稳定文件契约

OGS Studio 和 CLI 使用以下稳定路径：

- `.ogs/`：项目运行配置和状态；
- `og-roles/`：角色包；
- `system.mmd`：团队结构源文件；
- `.ogs/runs/`：运行快照、恢复状态和审计产物。

团队导入导出使用当前站点定义的团队包格式。团队包不包含凭据、底座目录或运行历史。
