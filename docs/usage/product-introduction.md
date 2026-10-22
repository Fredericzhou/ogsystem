# OGSystem 产品简介

OGSystem 把一组有明确职责的角色组织成可执行、可恢复、可审计的协作流程。产品由两个对等工作台和共享平台能力组成：OGS Studio 负责团队工程资产的设计、Simulation 调试、诊断和发布；OGS Projects 负责业务项目、Materials、Task、Review 和 Deliverables。两个工作台共用 Team Site Origin、Runtime 能力和平台配置，但各自拥有不同的运行数据与查询 API。工程人员也可以继续使用 CLI。

OGS Studio 提供团队草稿、图谱设计、角色执行与编排属性、Context Map、角色资产包、Flow Contract/Schema 编辑、Simulation 调试与回放，以及发布门禁。模型选项来自共享平台的发现目录；CLI Profile 与可执行工具定义保存在 TeamVersion 草稿中。共享平台工具目录只登记能力元数据，不会自动成为运行时命令。自动化已覆盖部分专业字段保存和回读；完整字段矩阵及设计到发布的人工 UAT 尚未签收。

## 产品如何分工

- **团队**描述“谁负责什么、如何交接、如何协作”。团队是静态、可发布、可版本化的协作结构，循环、分支和
  汇合语义也属于团队定义。团队可以通过自然语言创建，再由人工或 OGS Studio 微调，
  发布后以不可变的 TeamVersion 快照进入团队仓库。团队身份稳定，日常保存草稿不会生成新发布版本，用户不需要
  维护版本分支。
- **协作项目**描述“这次工作在哪里完成、使用哪个团队版本、有哪些工作请求”。一个项目绑定一个项目工作目录，
  只挂载一个已发布团队版本，并管理多条 Task。不同项目可以选择不同团队。
- **Task**描述“用户希望团队完成什么工作”，明确指定一个项目已挂载的团队版本。它可以排队等待执行，并在重试时继续作为
  同一项业务请求。
- **Run**描述 Task 的一次执行尝试，以及本次尝试的状态、事件、审核、结果和审计证据。每次 Run 使用自己的运行工作目录；
  重试由 Task 发起并创建新的 Run，`currentRunId` 指向最新尝试，历史 Run 保持只读。
- **Studio Simulation**用于验证某个 TeamVersion 的设计，不创建业务 Task 或 Project Run。Simulation 输入、状态和事件会持久保存并可在 Studio 中回放，与 Projects 的运行历史分开。
- **Deliverable**是用户从成功 Project Run 显式归档的独立结果快照，保留来源 Task、Run 和 attempt 标识；它与项目 Materials 分开管理。
- **平台配置**负责发现本机的 Codex、OpenCode 和模型，并设置默认执行方式；不接管这些底座的账号和凭据。

团队建设与项目执行是两条独立路径：编辑团队不会创建项目，创建项目也不会修改团队结构。项目只挂载已发布
版本；Projects 用户可发起自然语言调整，由 OGS Studio 创建新草稿。用户检查并发布后，回到 Projects 明确挂载新版本；已有 Task 仍绑定原版本。

## Task 与 Run 控制

当前同一项目最多一个 Task 的 Run 处于任一活动状态，包括计划创建、就绪、运行、控制请求待收敛、暂停或待人工审核。暂停可以继续，待审核可以提交通过、退回
或终止意见；当前 Run 完成或终止后，才能启动下一项。Task 创建和每次尝试都采用幂等处理。失败后从 Task 重试会保留原 Task，
并创建新的、可追溯的执行尝试。列表显示结果摘要；展开 Run 后才读取经凭据脱敏的完整结果。

## 运行时能力

框架提供受限流程结构、角色执行、分支与汇聚、循环、异常路由、人工审核、检查点恢复和审计记录。Project Run
状态保存在所属项目的 `.ogs/runs/<runId>/`；Studio Simulation 保存在 `.studio/simulations/<teamVersionId>/<simulationId>/`。
两者的数据目录、owner 校验、生命周期和 API 查询相互隔离。恢复前会检查状态快照、会话索引和语义指纹的一致性；不一致时会拒绝猜测性恢复。

详细入口：

1. [产品概念](ogs-concepts.md)
2. [使用手册](usage-manual.md)
3. [核心概念](ogsystem-core-concepts.md)
4. [OGS Studio](visualizer-console.md)
