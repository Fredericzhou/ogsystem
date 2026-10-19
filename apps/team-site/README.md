# OGS Projects

OGS Projects 是面向业务用户的项目与团队协作应用。OGS Studio 面向专业团队开发，负责团队专业编辑、调试、运行诊断和平台模型配置；Projects 负责项目材料、Task 生命周期和业务结果：

当前版本只接受最新业务数据格式，不提供旧 schema/API 字段兼容或自动迁移。升级前由运行方显式准备新的数据根或清理旧数据；应用启动不会自动删除用户数据。

- **OGS Studio**：创建和专业编辑团队、调试运行、查看运行诊断，并管理平台模型配置。未发布草稿只在 Studio 管理。
- **OGS Projects**：创建协作项目，挂载已发布 TeamVersion，管理项目材料、Task 生命周期和业务结果。
- **平台配置**：查看自动发现的 Codex、OpenCode 及其模型，设置默认底座、模型请求等待时间和失败重试次数。
- **OGS Studio**：专业团队开发工作台，负责精确编辑结构和契约、调试与运行诊断；Projects 的日常操作不需要专业技术配置。

## 核心规则

1. 创建或编辑团队不会创建项目，也不包含工作目录、项目材料或任务。
2. 创建项目不会创建团队。项目只能挂载已发布的团队版本；内置案例在服务启动时按正式发布规则物化为持久化 TeamVersion，案例页的“用于项目”复用该规范版本 ID。需要修改案例设计时，可先从该团队复制草稿，调整并发布后再挂载；切换界面语言不会创建新版本。
3. 一个项目可以挂载多个团队，共享同一个工作目录和项目资源。
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

Run DTO 用 `collaborationProjectId`、`taskId`、`teamVersionId` 和 `runtimeProjectId` 分别表示业务项目、Task、团队版本和运行文件所在工作区，不返回含义不定的 `projectId`。最近运行页用业务项目 ID 恢复项目，用 Runtime ID 打开运行诊断。

版本用于冻结发布内容和保证项目执行可复现，不要求用户为每次保存管理一个版本。专业编辑和发布在 OGS Studio 完成。Projects 用户可以发起自然语言团队调整；Studio 创建新草稿，用户检查并发布后，回 Projects 显式挂载新版本。

Task 与 Run 不能互换使用：任务列表展示业务请求和尝试时间线，Run 详情展示一次尝试的执行证据。Task 选择一个已挂载 TeamVersion，所有重试都沿用该版本。一次 Run 成功完成并满足适用验收条件后，Task 即成功；失败或异常才创建新的 Run 尝试。暂停、继续、审核恢复和有效检查点上的中断恢复继续当前 Run；历史 Run 只读。Run 状态文件是执行状态权威；绑定 Run 后 Task 状态是便于列表查询的投影。列表只显示结果摘要，展开后按需读取经 Runtime 凭据脱敏的完整结果；完整结果不可用时会明确说明当前仅有摘要。readiness 阻塞发生在 Run 预留前，Task 保持待执行且不会增加尝试。Studio Simulation 是临时调试，不会创建 Project Task 或正式 Run 历史。

Run 工作目录隔离 Runtime 状态、快照和审计产物，不等于隔离其对项目代码或外部系统的副作用。per-Run worktree 隔离、项目归档和 Run 结果显式发布是产品规划，当前尚未实现。Git worktree 不隔离网络、凭据、外部服务及 worktree 外文件，仍需额外沙箱和权限控制。

## 用户入口

| 页面 | 地址 | 用途 |
| --- | --- | --- |
| 首页 | `/` | 查看协作入口和典型案例摘要 |
| OGS Studio 团队仓库 | `/studio` | 管理已发布团队版本、导入团队 |
| OGS Studio | `/factory` | 管理编辑中和待发布团队 |
| 创建团队 | `/factory/new` | 通过自然语言创建团队草案 |
| 团队建设 | `/studio/team/:id` | 对话微调、人工编辑、验证和发布版本 |
| 协作项目 | `/projects` | 查看项目、工作目录、团队和任务记录 |
| 创建项目 | `/studio/project/new` | 创建工作目录并挂载已发布团队 |
| 项目详情 | `/studio/project/:id/run` | 记录任务、执行、暂停、继续、审核、取消和删除 |
| 平台配置 | `/platform` | 查看底座/模型探测结果和默认执行设置 |

团队建设页面不会提供“导出团队”。导出属于团队仓库的资产管理操作；导入入口统一称为“导入团队”。

## 本地启动

在仓库根目录执行：

```powershell
pnpm build
pnpm --dir apps/team-site start
```

本地默认端口为 `4173`，打开 `http://127.0.0.1:4173/`；可用 `PORT` 覆盖。Tailnet 启动脚本使用 `4174`。OGS Studio 默认监听本机 `4177`，打开
`http://127.0.0.1:4177/`。OGS Projects 通过 `/api/v1/config` 读取 Studio 地址，可用 `OGS_VIS_URL` 覆盖。

## Tailnet 访问

Windows 上从仓库根目录执行：

```powershell
pnpm start:team-site:tailnet
```

脚本会将网站绑定到 `0.0.0.0:4174`，因此可通过本机 Tailnet 地址访问，例如
`http://100.66.215.15:4174/`；OGS Studio 仍只监听 `127.0.0.1:4177`，由 Tailscale Serve 提供 HTTPS
入口和身份认证。脚本会输出当前节点的 HTTPS 主机名和日志目录。

## 底座与模型

平台配置会调用本机 CLI 的探测能力，展示已发现的 Codex、OpenCode 服务及可用模型。站点不接管这些
CLI 的账号或凭据。模型请求超时只表示等待**单次模型请求返回**的最长时间，不限制一个任务的总执行时间；
任务仍可能因为多角色、多轮处理或人工审核而持续更久。

## 验证

运行团队案例的真实底座验证前，请先完成对应 CLI 的登录：

```powershell
pnpm --dir apps/team-site verify:cases
```

也可以通过 `OGS_DEMO_BACKEND` 和 `OGS_DEMO_MODEL` 选择 Codex 或 OpenCode 的具体模型。OGS Projects 的产品
页面测试与 OGS Studio 测试应分别运行；两者共享 Runtime Core，但不共享项目数据目录。
