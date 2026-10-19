# Team Collaboration 模块化与分层重构方案

## 文档权威与范围

本文是 Team Site 当前领域契约、目标代码边界和重构验收门槛的唯一工程方案。产品术语以
[OGS 产品概念](../usage/ogs-concepts.md)为准；用户操作入口和现行产品行为以
[OGS Team Site 手册](../../apps/team-site/README.md)为准。已完成的领域、UX 和运行可靠性方案已归档，
只保留交付证据，不再定义现行契约。

## 当前进度

本轮最终 Mac 自动化验证（2026-10-19；代码提交 `617af33`、`0787b9a`）：Team Site 全量 `pnpm --dir apps/team-site test --test-concurrency=1` 为 225/225；`pnpm test` 为 656 项通过、0 项失败、1 项 Windows PowerShell/CMD smoke 按平台条件跳过；`pnpm run test:visualizer` 通过，Studio 主测试 198 项、布局 49/49；构建通过。经典团队 Playwright UAT 点击“查看全流程”打开真实 Studio 服务，验证关联 TeamVersion 工作区可读、错误 Task 关联被拒绝、运行中继续/停止/重索引/审核控件不可见且不可点击，并核对操作前后 Projects Task/Run API 状态不变。既有浏览器路径还覆盖 readiness 阻塞、运行、结果展开、重试、历史尝试与结果隔离，以及桌面、390px 手机和 768px 平板布局。故障注入与恢复覆盖预留失败、计划创建失败、终态 Task 投影写失败、控制写失败、Run 状态缺失/陈旧投影，以及真实活动 Run 中 SIGKILL 后启动恢复；逐项核对持久化、API 读数、Task/Run 关联、重试、清理和恢复幂等性。最终文档更新后的 `pnpm run test:docs-command-drift` 与 `git diff --check` 均通过。Windows、人工 UAT 和真实设备验收不包含在此自动化摘要中。

2026-10-19 后续缺口修复验证：Run 状态初始化现位于 Task/Run 预留清理保护范围内；对 `control/state.json` 原子落盘注入失败，确认 Run 目录被清理、Task 仍为 queued 且之后可启动。协作 Project 定义摘要改由 Application 计算并交给文件 Store 持久化，架构测试禁止 Store 调用摘要计算。新增服务级配置根回归：先在独立平台配置根保存模型设置，更换 `OGS_SITE_PROJECTS_DIR` 后仍能读取同一设置。针对性测试通过；Team Site 全量 `227/227`，构建通过，Visualizer 主测试 `198/198`、布局 `49/49`，`pnpm test:docs-command-drift` 通过，仓库全量 `656` 项通过、`0` 失败、`1` 项 Windows 专属 smoke 跳过，`git diff --check` 通过。Team Site 全量包含现有 Playwright 页面交互验收；Windows 实测、八项人工 Release UAT、真实设备无障碍和产品负责人签收状态不变。

仍未关闭：Windows 实测、八项人工 Release UAT、真实设备键盘/屏幕阅读器签收，以及产品负责人对资源基线代表性和容量门槛必要性的确认。当前 UAT 清单为 2 项 Pass、8 项 Blocked；Blocked 不计为通过。本轮 Playwright Studio 诊断验收是自动化交互证据，不改变人工 UAT 状态。2026-10-19 09:13 CST 记录的一条真实 Codex sandbox 工作负载只作为资源基线，不代表操作员目标工作流或容量验收。

截至 2026-10-19，本轮代码与自动化回归通过，但发布验收尚未签收。Team Site 已采用 Application/Domain/Infrastructure 与按资源拆分的 API routes；旧 `project-repository.mjs` 已删除，文件持久化操作由具名 Infrastructure adapters 提供，包导入导出事务位于独立 adapter。Team draft 创建经 Team Lifecycle Application 用例执行，同名 Team 查重到 workspace 原子提交由 `${projectsRoot}/.site/team-name-creation` 文件锁保护；同名协作 Project 也在独立文件锁内完成查重、创建和初始化。`domain-contract-regression.test.mjs` 确认两种资源的并发同名请求都只提交一个 workspace；`file-team-lifecycle-locks.test.mjs` 确认操作异常后释放锁且同名重试可进入。

Task/Run 使用 `currentRunId`、有序 `runIds`、单调 `attemptNumber` 和按请求指纹校验的幂等键；readiness 在预留前检查；重试从 Task 发起；历史 Run 只读；完整结果按需读取并脱敏。经典团队浏览器回归覆盖项目化、排队、运行、事件与结果、readiness 阻塞、刷新和重试，以及 390px 手机和 768px 平板的溢出、遮挡与控件可达检查。自动化也覆盖 Run 失败持久化、进程重启恢复和后续 Task 重试。

此前完整本机验证（2026-10-19 09:04 CST）早于移除旧 `Task.runId` 兼容逻辑，结果为 Team Site 208/208、Visualizer 198/198、布局 49/49、仓库 656 项通过且 Windows smoke 跳过。该次记录对应 HEAD `d54d97d76cb464a746089d0f96a12fdd7925d3f7` 和当时工作区 SHA-256 `81874419132af88a11b21fbb137327681e2b1b9b865650e36487d36fd165daa8`，仅作为历史背景；本轮最终状态以本节首段的 220/220 与当前验收清单为准。此前 npm 与 pnpm 隔离包安装 smoke 均通过，但不替代本轮 Release UAT。

下方按切片的日期记录保留实施过程，只表示各自记录时的状态，不能代替本轮最终验证或当前验收状态。涉及 `project-repository.mjs` 的迁移前记录均已被后续实现取代；当前权威状态以上述验证与验收清单为准。

Release UAT 本轮已由框架开发者完成 clean install、真实 Codex sandbox Task 预检和 Visualizer `/metrics`、`/healthz`、`/readyz` 检查（见 [Release UAT 清单](release-uat-checklist.md)）；八项人工场景仍为 `Blocked`。资源基线已完成一条目标请求的单次观测，产品负责人尚未确认该工作负载的代表性及用户侧影响；没有既定产品资源承诺，不从单次数据推导容量阈值。归档方案中的历史验收结果不代表本轮重构已验收。

## 技术栈冻结

本轮重构固定使用仓库现有技术栈：Node.js ESM 服务端、`node:test` 自动化测试、Playwright 浏览器验收、当前 JSON/文件工作区持久化，以及 OGSystem Runtime 和 Visualizer 的现有适配器。新用例沿用 Application/Domain/Infrastructure 分层和当前 API/页面结构；不引入新的 Web 框架、ORM、数据库、消息队列、测试框架或全局前端状态库，也不因单个切片重写既有存储或运行协议。

只有当已记录的产品或可靠性需求无法由当前技术栈满足时，才提出技术栈变更。提案必须说明不可满足的验收项、替代方案、迁移影响、回滚路径及验证成本，并先更新本方案后再实施。局部重构不得自行改变技术选择；所有现有和新增验收继续使用同一构建、测试及浏览器工具链。

当前仍未关闭的门禁为 Windows 专属 smoke、八项人工 Release UAT、真实设备无障碍签收，以及产品负责人对单次资源基线代表性和用户影响的确认。自动化恢复场景均有文件/API/Task-Run/重试及重复恢复核验；表内保存了本轮实际 Project/Task/Run ID、读数和测试名称。历史记录中的“21 项通过、12 项未关闭”已过期，不作为当前计数。Release UAT 当前为两项 `Pass`、八项 `Blocked`；资源基线已有一次真实运行观测，容量门槛决策待产品负责人确认。本轮本机自动化门禁通过不等于发布 UAT 已签收，以上未关闭门禁不计为通过。

本轮结构与并发收敛（2026-10-19）：删除旧 `project-repository.mjs` 路径，将实现移至 `infrastructure/file-project-store.mjs` 并更新 composition root、回归测试和架构检查，无兼容 re-export。Team 与 Collaboration Project 名称创建分别用 `.site` 文件锁跨进程串行，查重覆盖到原子提交/初始化与失败补偿；增加同名并发创建和操作异常释放锁测试。Run 控制意图写失败时不推进状态的回归也已补齐。该段中的测试数字是此前切片记录；本轮最终结果以本节开头的 208/208 和 656/657 为准。

本轮修复与分层迁移（2026-10-19）：Task 页面切换任一 Run 尝试时立即清除共享详情区的完整结果缓存；尝试详情请求校验所选尝试和页面请求代次，完整结果响应校验当前选择，旧结果不能覆盖新选择。经典团队浏览器回归先读取当前尝试独有的完整结果，再切换到历史尝试，断言旧结果不再出现且完整结果读取入口恢复。协作 Project 创建、列表、同名冲突检查、规范且已发布 TeamVersion 检查、失败补偿编排已迁入 Collaboration Project Application 用例；repository 的 `createCollaborationProject` 和 `listCollaborationProjects` facade 已删除。Task 控制、审核决策、删除与关联 Run 控制已迁入 Task Lifecycle Application 用例；repository 的 `controlProjectTask`、`reviewProjectTask` 和 `deleteProjectTask` facade 已删除，文件持久化与 Runtime 审核读写由注入端口承担。文件存储端口只提供 Project 列表/创建、协作元数据初始化和受限补偿删除；补偿仅允许删除以 `collaboration-project` 创建的工作区，初始化只接受尚未转换的协作项目工作区。

本轮验证（2026-10-19）：Task Lifecycle 切片后 `pnpm --dir apps/team-site test --test-concurrency=1` 166/166 通过，含经典团队浏览器回归、历史尝试结果隔离、协作项目 HTTP 创建/列表、失败补偿、Task 控制/审核/删除和 Task/Run 恢复用例；`pnpm build` 和 `pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试 198/198、布局测试 49/49 通过；`pnpm test` 657 项中 656 项通过、1 项 Windows 专属测试在 macOS 跳过；`git diff --check` 通过。以上结果不代表真实设备键盘/屏幕阅读器、操作员中断后人工恢复/重试及完整 release UAT 已签收。Team/TeamVersion 工作区创建、Project 挂载与材料事务、Task 启动、Run 编排和 Package 导入导出事务仍在 `project-repository.mjs`；架构与发布验收清单继续保持未通过。

本轮分层切片（2026-10-19）：Project Package 的 schema/material/digest/TeamVersion 依赖校验和冲突预览迁入 `application/project-package-use-cases.mjs`，文件包 digest 和 material path 规则分别归入 Infrastructure 与 Domain；repository 不再导出 Project Package preview facade，Project 导入事务通过注入的 preview 操作继续执行。Task 重试资格、历史尝试幂等重放、旧 Run 状态校验和材料快照选择迁入 Task Retry Application 用例；Run 状态/快照及路径解析通过文件 adapter 提供，repository 重试 facade 已删除。缺失 Run 状态的恢复路径仍允许对已标记失败的 Task 创建新尝试，非失败 Run 不可重试。

本轮验证（2026-10-19）：`pnpm --dir apps/team-site test --test-concurrency=1` 149/149 通过；`pnpm build` 通过。Task Retry 用例单独覆盖普通失败重试、Run 状态丢失后的恢复、非失败 Task 拒绝和非法 ID；现有 Runtime 失败及子进程恢复 HTTP 测试也通过。Project Package 用例覆盖重复项目、Team 依赖映射、嵌套 Team 发布状态、材料路径/格式和 digest 校验。真实设备键盘/屏幕阅读器、操作员执行中断后的恢复/重试、完整 release UAT 和 `project-repository.mjs` 主业务迁移仍未验收；不得据此勾选整体验收清单。

本轮 Task 创建切片（2026-10-19）：Task 输入规范化、协作项目校验、挂载 TeamVersion 校验、请求指纹、幂等重放和 queued Task 持久化由 `application/task-creation-use-cases.mjs` 负责；Task ID 通过 Infrastructure adapter 注入。Team Site composition root 将用例提供给 Task routes，repository 的 `createProjectTask` 实现已删除，架构回归断言禁止该 facade 回归。重试预留前等待同一 Task 的上一 worker 收尾，避免旧 worker 清理期吞掉新尝试的执行启动。

本轮验证（2026-10-19，Task 创建切片）：`pnpm --dir apps/team-site test --test-concurrency=1` 157/157 通过；`pnpm build`、`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试 198/198、布局测试 49/49 通过；`pnpm test` 656 项通过、1 项 Windows 专属测试在 macOS 跳过；`git diff --check` 通过。Team Site 浏览器回归包括经典团队项目化、Task 创建/执行、历史尝试与完整结果查看、390px/768px 布局与操作可达性。以上自动化结果不替代真实设备键盘/屏幕阅读器、操作员中断恢复/重试和完整 release UAT；核心 repository 迁移仍未完成，验收清单保持未通过。

本轮 Project 更新切片（2026-10-19）：团队名称冲突查询收敛至 File Team Catalog；Project 更新的字段规范化、团队改名校验、协作项目 digest 刷新和语义变更时撤销确认状态迁入 `application/project-update-use-cases.mjs`，通过 Project store 端口在写锁内持久化。`project-repository.mjs` 不再导出 `updateProject` 或 `invalidateProjectConfirmation`。

本轮最终验证（2026-10-19，Task 创建与 Project 更新切片）：`pnpm --dir apps/team-site test --test-concurrency=1` 160/160 通过；`pnpm build` 与 `pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试 198/198、布局测试 49/49 通过；`pnpm test` 656 项通过、1 项 Windows 专属用例在 macOS 跳过；`git diff --check` 通过。真实设备键盘/屏幕阅读器、操作员中断恢复/重试和完整 release UAT 仍需人工执行；Project/Team 创建、挂载与材料、Task 控制/审核/删除、Run 编排、Package 导入导出仍留在 `project-repository.mjs`，因此方案验收清单保持未通过。

既有自动化验证记录（2026-10-18，重试契约补充前）：`pnpm build` 通过；Team Site 全量测试 88/88 通过；
`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试 198/198、布局测试 49/49 通过；
`pnpm test` 656 项通过、1 项 Windows 专属用例在 macOS 跳过。浏览器用例覆盖团队发布、项目创建/团队替换、经典团队项目化流程、Task/Run 关联、失败重试和 390px 视口。
这些历史结果不替代本轮回归结果、未完成的分层迁移和人工 UAT 路径。

本轮重试契约和页面体验验证（2026-10-18）：`pnpm build` 通过；Team Site 全量测试 88/88 通过；经典团队项目化浏览器路径覆盖 Task 级重试、刷新恢复和 390px 任务区边界；任务正文/操作无重叠、控件在视口内、触控目标至少 44px、尝试时间线不越界。浏览器回归发现并修复最近运行 DTO 的未定义运行项目 ID。`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试 198/198、布局测试 49/49 通过；最终 `pnpm test` 656 项通过、1 项 Windows 专属用例在 macOS 跳过；`git diff --check` 通过。以上不代表完整 Application/Infrastructure 迁移完成，也不替代真实模型、readiness 阻塞提示、审核和中断恢复的人工 UAT。

本轮持续重构记录（2026-10-18）：Platform 设置和模型发现已迁入 Application 用例与 Infrastructure adapter，资源路由只调用注入的用例；设置 JSON 损坏会显式报错，不再伪装成默认配置。Team Catalog 筛选、排序、分页和统计已迁入 Application 用例，文件目录扫描迁入 Infrastructure；`project-repository.mjs` 不再导出目录查询操作。完整 Run 结果查询已迁入 Application 用例和文件结果 adapter，adapter 只读取 `graphState.finalOutput` 并脱敏；Run 资源级重试入口和 repository 实现已删除，重试统一从 Task 发起。经典团队浏览器验收增加 768px 平板尺寸，并等待当前渲染树的有效布局后检查；修正 Task 测试轮询，使清理目录前等待活动 Run worker 收尾。Team Site 全量测试 97/97 通过；`pnpm build` 通过；`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试 198/198、布局测试 49/49 通过；`pnpm test` 657 项中 656 项通过、1 项 Windows 专属测试在 macOS 跳过；`git diff --check` 通过。

真实模型页面 UAT（2026-10-18）：在隔离数据目录 `/tmp/ogs-team-site-review-projects` 启动 Team Site，以桌面 Chromium 1440×1000 从 `/cases/software-team` 完成“用于项目 → 创建 Collaboration Project → 创建 Task → 选择隔离运行”。平台发现返回 213 个模型，Codex 默认模型可用。项目创建后执行的 Task 只有一个 Run；`task.teamVersionId` 是已挂载的正式 TeamVersion ID，Task 与 Run 均为 `completed`，Run `attemptNumber=1`、mode 为 `sandbox`。五个计划角色（`delivery-coordinator`、`backend-planner`、`experience-planner`、`quality-planner`、`delivery-lead`）及其运行状态全部完成，事件 8 条（7 条含角色证据），脱敏完整结果可按需读取，页面 `pageerror=0`。交付针对记账 SaaS 请求给出功能拆分、关键 UX、实现顺序、验收标准和主要风险。该结果证明一次真实页面隔离运行成功，不替代审核成功、执行中断后人工恢复/重试的人工 UAT；真实设备键盘和屏幕阅读器操作仍需人工检查。

本轮持续重构记录（2026-10-18）：最近 Runs 的 Task 多次尝试展开、按状态时间排序和 limit 收敛到 Application 查询，Run 状态/计划文件读取由 Infrastructure adapter 负责；`listRecentProjectRuns` 旧 repository 聚合已删除。案例目录、案例图、经典团队 use/template 和 Demo Run HTTP 操作移入 `case-routes.mjs`；协作项目列表、最近 Runs 与 Platform config 也由资源 routes 处理。内置案例在 server listen 前按正常发布规则物化为正式 TeamVersion，catalog 仅展示持久化版本；项目挂载、Task 请求及已存储元数据拒绝 `case:*`，案例 Simulation 的临时 case key 不写入业务身份。经典模板编辑创建同一 Team 身份下的新草稿版本；语言只影响展示，不创建额外版本。TeamVersion 归档状态校验已迁入 Application，写锁、原子元数据更新和 team references 同步由 Infrastructure file adapter 承担。跨工作区 Run 终态与 Task 投影不一致的启动恢复故障用例已覆盖，并验证重复恢复幂等。

本轮验证：`pnpm --dir apps/team-site test --test-concurrency=1` 108/108 通过；`pnpm build` 通过；`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 通过（主测试 198/198、布局测试 49/49）；`pnpm test` 657 项中 656 项通过、1 项 Windows 专属测试在 macOS 跳过；`git diff --check` 通过。经典团队浏览器路径验证了规范 TeamVersion 复用、模板分叉、项目化 Task、readiness 阻塞、流程预览完整结果、刷新和 390px/768px 页面边界；另有一次真实 Codex sandbox 项目化 Run 完成五角色执行。以上仍不表示 Application/Infrastructure 完整迁移或审核成功、操作者中断/恢复及真实设备无障碍 UAT 全部完成。

本轮边界收敛（2026-10-18）：Team Studio Simulation 已从 `project-repository.mjs` 迁入 Application 用例和 Runtime adapter；只接受规范且已发布的 TeamVersion，删除临时 `case:*` Simulation 入口。Simulation 在独立临时工作区导入团队快照、执行 dry-run，并在成功或 Runtime 异常时清理；浏览器路径验证 `persisted=false`，且不新增 Collaboration Project、Task 或 TeamVersion Run。持久化身份校验扩展到 `teamId`、`teamRootId`、父版本、挂载 TeamVersion 和 Task 的运行工作区引用；Team Catalog 拒绝目录名与显式 TeamVersion ID 不一致的记录。

本轮验证（2026-10-18）：`pnpm build` 通过；Team Site 全量测试 113/113 通过；`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试与布局测试通过（布局 49/49）；`pnpm test` 657 项中 656 项通过、1 项 Windows 专属用例在 macOS 跳过。经典团队浏览器 UAT 覆盖直接使用、模板编辑、TeamVersion Simulation 不持久化、项目化 Task、readiness 阻塞、流程预览完整结果、刷新恢复、Task 重试及 390px/768px 页面布局和控件可达性。模拟 Runtime 失败临时目录清理、规范身份拒绝和完整结果脱敏均有自动化覆盖。审核成功和中断后的人工恢复/重试、真实设备键盘与屏幕阅读器 UAT 尚未完成；`project-repository.mjs` 的 Project、Task/Run、Package 与 Studio 设计持久化职责迁移仍未完成，方案验收清单保持未通过。

后续收敛（2026-10-18）：Project Readiness 查询已拆为 Application 用例和 Runtime inspector；查询错误 DTO 文案与工作区路径隔离由用例管理，Run 启动中的 Sandbox 准入仍由现有执行编排在 Run 预留前检查。审核成功浏览器路径现覆盖真实 API 批准、Task 投影刷新和焦点转移至更新后的 Task 状态；失败反馈、Escape 和路由切换关闭行为仍覆盖。

本轮最终验证（2026-10-18）：`pnpm build` 通过；`pnpm --dir apps/team-site test --test-concurrency=1` 115/115 通过；`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试与布局测试通过（布局 49/49）；`pnpm test` 657 项中 656 项通过、1 项 Windows 专属测试在 macOS 跳过；`git diff --check` 通过。经典团队浏览器 UAT 覆盖 Simulation 不持久化、项目化 Task、readiness 阻塞、审核成功和失败反馈、Task 重试、刷新恢复及 390px/768px 布局与控件可达。中断后的人工恢复/重试及真实设备无障碍 UAT 尚未完成；Project/Task/Run/Package/Studio 的主要 repository 实现仍在 `project-repository.mjs`，重构验收清单保持未通过。

本轮继续推进（2026-10-18）：Studio 项目设计校验已从 `project-repository.mjs` 迁至 Application 用例和 Visualizer adapter；Natural、Professional 与已保存 Mermaid 三种输入共用同一校验端口，旧 repository 实现已删除。Task 序号在项目页和最近运行页统一显示为任务序号，避免与 Run 的 `attemptNumber` 混淆；手册改为明确的 Task → Run 流程。手机任务操作目标提升到 44px，经典团队 390px 浏览器回归增加可见控件的 pointer hit-test。审核成功自动页面回归状态已与人工 UAT 区分；真实设备键盘/屏幕阅读器及操作者中断后的人工恢复/重试仍未完成。

本轮验证（2026-10-18）：`pnpm build` 通过；`pnpm --dir apps/team-site test --test-concurrency=1` 121/121 通过，含经典团队项目化浏览器回归、390px/768px 页面检查和设计校验用例；`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 通过（主测试与布局测试，布局 49/49）；`pnpm test` 657 项中 656 项通过、1 项 Windows 专属用例在 macOS 跳过；`git diff --check` 通过。相关新验证覆盖 Application 边界、Visualizer adapter 三种输入来源及 API 校验错误映射。以上门禁结果不代表分层迁移和人工 UAT 全部完成，验收清单仍未通过。

本轮继续迁移（2026-10-18）：Studio Project Graph/Design 查询投影移入 Application 与 Visualizer projector，删除 `project-repository.mjs` 的两个旧查询实现。保存设计继续由原写用例负责锁和文件持久化；写后通过 Application projector 组装既有响应，避免保留旧查询 facade。Run/Task 术语已同步到产品词汇表、编排语义和用户手册。经典团队 390px 回归现对可见控件执行 pointer hit-test，手机任务操作目标为 44px。

本轮最终验证（2026-10-18）：`pnpm build`、`pnpm run test:docs-command-drift` 通过；Team Site 全量测试 128/128 通过；`pnpm run test:visualizer` 主测试与布局测试通过（布局 49/49）；`pnpm test` 657 项中 656 项通过、1 项 Windows 专属测试在 macOS 跳过；`git diff --check` 通过。自动页面检查覆盖 Task/Run 展示、经典团队项目化、390px/768px 控件命中及无重叠。执行中断后的人工恢复/重试和真实设备键盘、屏幕阅读器 UAT 仍未完成；Project、Task/Run、Package 其余 repository 持久化与事务职责尚未全部迁移，方案验收清单保持未通过。

本轮缺口修复与边界迁移（2026-10-19）：Task 页面可选择历史 Run，并按所选 Run 读取状态、事件、失败原因、结果摘要和脱敏完整结果；历史尝试不显示 Task 控制，当前尝试保留控制入口。修正 `[hidden]` 被 flex 样式覆盖的问题；经典团队浏览器测试改为轮询真实 API 的 Task/Run 终态，并在 390px、768px 检查尝试切换、结果读取、控件可达和布局边界。发现并修复重试遇到前一 worker 尚在清理时留下已预留但未执行 Run 的竞态：重试在读取最新 Task 和预留前等待前一 worker 收尾。补充 Runtime after-setup 失败的 Task/Run API 集成验证，覆盖失败状态持久化、查询、重启恢复、Task 重试和旧 Run 不变。新增真实 Team Site 子进程启动恢复测试，通过 HTTP 查询恢复后的失败 Run/Task 并重试成功。Team Package preview 冲突规则迁入 Application，preview 与 import 共用同一用例并移除 repository preview facade。Project Design 保存的请求规范化、serializer/validator 编排和 digest 初检迁入 Application；repository 的写入端口只负责锁内 digest 复查和安全持久化。Run detail/events 查询迁入 Application 与 Infrastructure，删除 repository 查询 facade，worker 等待通过注入端口提供。

本轮验证（2026-10-19）：最新 Run query 切片后 `pnpm build` 通过，Team Site 全量测试 141/141 通过；经典团队项目化浏览器回归 1/1、visual-acceptance、interaction-lifecycle、run-polling 合计 5/5 通过；真实 Team Site 子进程启动恢复/HTTP 查询/Task 重试测试 1/1 通过；`pnpm run test:docs-command-drift` 通过；`pnpm run test:visualizer` 主测试 198/198、布局测试 49/49 通过；最新 `pnpm test` 657 项中 656 项通过、1 项 Windows 专属测试在 macOS 跳过。浏览器测试覆盖历史尝试查看和只读边界、当前尝试控制、Task 级重试、完整结果和手机/平板布局。自动子进程测试不替代操作者执行的中断恢复/重试（包括确认不重复已提交角色）；真实设备键盘/屏幕阅读器，以及发布 UAT 清单中的 clean install、linear/branch-join、审核归属、failure compensation、metrics/health、资源增长和产品/操作员签收仍未完成；`project-repository.mjs` 仍承载 Project、Task/Run、Package 等持久化和事务职责，验收清单保持未通过。

## 目标与范围

本方案指导 Team Collaboration 发布前的模块化重构。产品流程和业务规则以本方案的最新契约为准；重构期间可以修正尚未发布的接口和状态语义，完成后统一采用唯一的最新数据结构与 API。

Team Site 现由 Application 用例编排业务规则，`domain/` 持有领域约束，`infrastructure/` 提供文件、Runtime 和 Visualizer adapters，按资源拆分的 API routes 处理 HTTP。`server.mjs` 是 composition root 和静态资源入口。迁移应沿业务用例垂直推进；不保留兼容 facade、旧路由或旧字段规范化。

不拆微服务，不引入通用 Repository 基类、CQRS、事件总线、消息队列或重量级依赖注入框架。模块化单体以清晰的依赖方向、用例边界和可独立验证的规则为目标。

## 核心概念

- **Team**：可复用的团队身份。身份与发布快照分开，便于团队目录稳定引用；版本能力不得扩展成无用户价值的分支/版本管理子系统。
- **TeamVersion**：一次已发布的团队设计快照；只有 `released` 版本可挂载，发布后内容不可原位修改。保存草稿不创建发布版本；项目选择具体 TeamVersion 后，之后的发布不改变该项目正在使用的定义。
- **Collaboration Project**：业务项目，保存项目定义、材料、挂载的 TeamVersion 和 Task 列表。
- **Task**：项目中的一次业务工作请求，明确选择一个已挂载 TeamVersion；Task 可在 Run 创建前排队或删除。一次 Run 成功完成并满足适用验收条件后即完成 Task；失败或异常时的重试仍属于原 Task。
- **Run**：Task 的一次执行尝试，保存执行快照、控制、状态、事件、审核和结果。Task 仅在失败或异常后的重新执行需要时关联多个 Run；暂停、审核等待和有效 checkpoint 中断恢复沿用同一 Run。
- **Studio Simulation**：对草稿或 TeamVersion 的临时调试，不创建正式 Collaboration Project Task 历史。

Team、TeamVersion、Project、Task、Run 是不同实体。禁止使用含义重叠的 `project` 表达 Team 或 Collaboration Project，也禁止把 Task 状态和 Run 执行状态当成同一个状态机。

Run 查询 DTO 以 `collaborationProjectId` 表示业务项目，以 `runtimeProjectId` 表示 Run artifacts 所属 Runtime 工作区；不得额外返回含义不明的 `projectId`。最近运行列表和详情、事件及结果查询使用相同身份命名；独立 Workspace Run 的 `collaborationProjectId` 为 `null`。

Projects 的 Studio 诊断链接保留 `projectId=runtimeProjectId`，并附带 `collaborationProjectId`、`taskId` 和 `runId`。Visualizer 只有在协作项目 Task 记录引用该 Run/Runtime 工作区，且 Runtime 工作区 TeamVersion 元数据匹配时才打开该工作区；缺少或不匹配的关联返回 `PROJECT_NOT_FOUND`。Projects 诊断页隐藏运行与审核控制，Task 控制仍由 Projects 页面发起。

版本边界是发布不可变性和执行可复现性的实现工具，不等于要求用户维护复杂的版本分支。产品默认编辑当前草稿并在发布时生成可挂载快照；只在用户需要比较或选择稳定发布内容时呈现版本信息。

## 目标依赖结构

```text
Frontend -> HTTP/API -> Application -> Domain
                              |
                              +-> Ports
                                    ^
                                    |
                              Infrastructure adapters
                                    |
                         OGSystem Runtime / Visualizer
```

依赖只向内指向 Domain 和 Application 定义的端口。Domain 不依赖 HTTP、文件系统、浏览器、运行时或 Visualizer。API 不直接访问文件或 runtime。Infrastructure 实现存储、锁、运行时和远程协议端口。Composition root 在 `server.mjs` 装配依赖。

## 职责边界

### Frontend

负责页面展示、导航、Natural/Professional 编辑模式、表单状态、dirty guard、请求取消、加载状态和错误呈现。业务规则以服务端为准。Natural 与 Professional 共用同一份 authoring document、校验结果和发布流程。

### HTTP/API

按资源组织路由，负责 HTTP 方法和路径、输入校验、DTO 映射、认证上下文传递、状态码及错误响应。路由调用 Application 用例，不直接调用存储、锁、Visualizer 或 runtime。

### Application

每个公开操作对应明确的用例，例如 `createTeamDraft`、`understandTeamIntent`、`applyTeamAuthoring`、`releaseTeamVersion`、`createCollaborationProject`、`replaceProjectTeams`、`createTask`、`startTask`、`controlRun`、`reviewTask`、`retryRun` 和 `getRunSnapshot`。

Application 负责加载所需数据、调用领域规则、协调端口、设定锁和事务边界、执行失败补偿，并返回服务层 DTO 所需的数据。用例通过构造参数接收依赖，能在不启动 HTTP server 的情况下测试。不得复制旧 repository 大模块到新目录；每个垂直切片迁完后立即删除其旧实现。

### Domain

Domain 负责业务不变量、实体行为、值对象、错误码和合法状态转换。规则至少包括：

- 只有已发布且可用的 TeamVersion 能被挂载。
- Collaboration Project 至少有一个有效挂载；Task 只能选择本项目已挂载的版本。
- 活动 Task/Run 期间不能更换团队挂载。
- 同一 Collaboration Project 同时最多有一个 Task 处于活动 Run 状态。
- 幂等键绑定规范化后的请求指纹；相同键不同请求必须拒绝。
- Team 名称和 Collaboration Project 名称分别唯一，不跨作用域冲突。
- `teamCoreDigest` 只覆盖团队可执行定义；`projectDefinitionDigest` 覆盖项目定义，不覆盖 Task/Run 历史。
- TeamVersion 发布后不可变；编辑通过创建新版本完成。

Domain 模块建议为 `team.mjs`、`project.mjs`、`task.mjs`、`run.mjs`、`contracts.mjs` 和 `errors.mjs`。`run.mjs` 提供转换函数并拒绝非法转换；状态常量不能替代转换规则。错误使用稳定错误码/类型，不以解析错误消息作为业务分支。

### Infrastructure

只实现 Application 声明的端口，包括：

- `file-project-store.mjs`：Team、TeamVersion、Collaboration Project、Task 元数据和材料索引的读取、原子写入、staging 与项目级锁。
- `file-run-store.mjs`：Run 快照、状态、事件、控制请求和审核记录的读取、原子写入与 Run 所属工作区锁。
- `runtime-runner.mjs`：将规范的执行请求映射到 OGSystem Runtime，并返回稳定的 Run 结果。
- `visualizer-client.mjs`：远程 Visualizer HTTP 协议客户端；只实现实际存在并被使用的端点。
- `model-catalog.mjs`：模型发现和缓存。

不为每个函数机械创建端口。只有存在独立责任、需要替换边界或能显著改善用例测试的依赖才设端口。

### Visualizer 与 Runtime

Team Site 持有 Team、TeamVersion、Project、Task、Run 的业务身份和状态。Visualizer 不拥有这些业务实体或 Team Site 元数据。远程 Visualizer adapter 当前只负责实际存在的协议，例如 chat；不要把本地 runtime 调用描述成 Visualizer API。

本地设计生成、校验、模拟与正式执行由 Application 调用对应能力端口；端口的 runtime adapter 封装 OGSystem Runtime。将来只有在存在真实协议、稳定输入输出契约和实现测试时，才可把某项能力迁移到远程 Visualizer。

## 建议目录

```text
apps/team-site/
├── api/
│   ├── team-routes.mjs
│   ├── collaboration-project-routes.mjs
│   ├── task-routes.mjs
│   ├── run-routes.mjs
│   ├── package-routes.mjs
│   └── platform-routes.mjs
├── application/
│   ├── team-use-cases.mjs
│   ├── project-use-cases.mjs
│   ├── task-use-cases.mjs
│   ├── run-use-cases.mjs
│   └── ports.mjs
├── domain/
│   ├── contracts.mjs
│   ├── errors.mjs
│   ├── team.mjs
│   ├── project.mjs
│   ├── task.mjs
│   └── run.mjs
├── infrastructure/
│   ├── file-project-store.mjs
│   ├── file-run-store.mjs
│   ├── runtime-runner.mjs
│   ├── visualizer-client.mjs
│   └── model-catalog.mjs
├── capabilities/
│   └── visualizer-adapter.mjs
├── server.mjs
└── public/app/
```

`server.mjs` 只创建 HTTP server、装配依赖、设置进程生命周期、提供静态资源并分发到 routes。API routes 按业务资源拆分，不能以单个聚合路由模块重新形成大控制器。

## Task 与 Run 状态

Task 表达工作生命周期，Run 表达一次执行。Task 在 Run 绑定前可以是 `queued` 或 `deleted`；绑定 Run 后，列表中的 Task 状态是便于查询的投影。Run 状态由 Run 持久化状态唯一决定。

每个 Task 用有序 `runIds` 保存失败/异常尝试及其后续尝试，`currentRunId` 指向当前或最新 Run；Run 的 `attemptNumber` 从 1 开始单调递增。成功完成并满足适用验收条件后 Task 即成功，不自动创建额外 Run。相同尝试幂等键和请求指纹复用已预留 Run，不同指纹复用同一键必须拒绝；幂等键去重请求/预留，不代表对任意外部副作用恰好一次。Task 状态、错误和摘要仅投影 `currentRunId`；旧 Run 的状态、事件和结果不随重试改写。暂停、继续、审核和取消必须由 Task 解析当前 Run，Run 资源上的历史尝试只提供读取能力。暂停或待审核后从有效 checkpoint 恢复仍使用原 Run；readiness 检查必须先于 Run ID 分配、Task 状态变化和尝试幂等记录写入；失败时 Task 保持原状态且 `runIds` 不变。

每个 Run 的 `.ogs/runs/<runId>/` 只隔离 Runtime 状态、快照和审计文件，不代表角色写入的项目目录或外部系统已隔离。Git 管理的目标代码可采用每 Run 独立 worktree/分支、固定基准 commit、恢复复用同一 worktree、失败重试从相同基准创建新 worktree，并在审查后显式合并。此为隔离设计选项，Team Site 当前尚未自动实现；非 Git 副作用仍由沙箱、权限和操作幂等策略约束。

运行列表及详情只返回摘要。完整结果由独立按需查询读取 Run 目录 `state.json.graphState.finalOutput`，只投影该字符串并强制启用 Runtime 凭据脱敏；不得把整个 Runtime 状态快照返回客户端。完整结果缺失时返回不可用状态，页面仍明确标记已有内容为“结果摘要”。

Run 持久化状态契约必须与 Runtime 对齐，并明确区分请求态、执行态和终态：

```text
planning -> ready -> running
planning | ready | running -> pause_requested -> paused
waiting_review -> paused
paused -> running | waiting_review
running -> waiting_review | completed | failed | cancelled
planning | ready | running -> cancel_requested -> cancelled
paused | waiting_review -> cancelled
planning | ready | running | pause_requested | paused | waiting_review | cancel_requested -> failed
```

规则说明：

- `ready` 是已创建执行计划、尚未进入实际执行的 Run 状态，必须在状态类型、快照和测试中显式处理。
- 暂停和运行中的取消首先记录控制意图，Runner 在安全边界收敛到 `paused` 或 `cancelled`；暂停或等待审核的 Run 可立即完成取消。
- 恢复只允许从 `paused` 或 `waiting_review` 发起；若仍有待审核项，恢复结果继续为 `waiting_review`。
- Resume 继续同一 Run 与运行目录，不增加 `attemptNumber`；Task Retry 仅用于失败/异常后的重新执行并创建新 Run。Team Site 启动恢复把遗留活动 Run 收敛为 `failed`，由用户从 Task 发起后续新尝试。
- `completed`、`failed`、`cancelled` 是不可变终态。重复相同控制请求应幂等；不合法控制返回稳定领域错误。
- 初始状态和外部 Runtime 最终结果是状态机输入。Domain 负责验证业务转换，Infrastructure adapter 负责将 Runtime 生命周期映射到本地 Run 状态，不能让两套状态定义漂移。

所有合法/非法转换必须由一张表驱动契约测试覆盖。端到端测试还需验证控制意图被记录、Runner 收敛状态和 Task 投影最终一致。

## 持久化权威、锁与恢复

- Collaboration Project 定义、团队挂载、Task 请求信息和材料索引保存在 Project 工作区的 `.site/` 数据中。
- Run 的执行快照、控制、状态、事件、审核与结果保存在 Run 目录；`.ogs/runs/<runId>/control/state.json` 是当前 Run 状态的唯一权威。
- `taskRecords.status` 在 Task 绑定 Run 后只是查询投影。读取时以 Run 状态校正；写投影失败可由后续读取或 reconciliation 修复。不得宣称分处不同工作区的 Project 元数据与 Run 状态通过一次文件写入原子提交。
- 用例为 Project 元数据写入和 Run 状态写入分别使用所属工作区锁。若单个操作跨两个工作区，规定固定锁顺序、释放规则和失败后的幂等修复方式，避免死锁及永久分歧。
- Run 预留必须先持久化唯一 runId 和幂等请求信息，再启动执行；相同请求重试复用同一预留或明确返回已有结果，不能创建重复 Run。
- 进程启动恢复扫描活动 Run，将无法续跑的状态收敛为 `failed`，保留错误原因；后续 Task 查询从权威 Run 状态修复投影。恢复重复执行必须幂等。
- Task/Run 历史不进入 Team/Project 定义 digest。Project 元数据只保存必要关联和查询投影，不嵌入事件、计划或完整结果快照。

跨工作区失败策略必须覆盖：Run 预留后崩溃、Run 状态落盘后 Task 投影失败、控制意图落盘后进程退出、Run 结束后响应丢失、启动恢复重复执行。每种场景都要定义可恢复结果，并通过故障注入测试验证。

## 最新契约与数据策略

产品尚未发布，所有环境统一采用重构后的最新 schema、API、字段和状态。上线前确定唯一 schema 版本；应用启动和存储入口校验必需字段与版本，不接受旧版 shape，不做历史项目迁移、旧路由 fallback、旧字段 alias 或兼容 facade。

产品当前需要的内置团队仍是正式能力：内置 Team 应通过与其他 Team 一致的 TeamVersion 身份和发布规则进入团队目录，Project 挂载和 Task 请求一律使用规范 TeamVersion ID。不得把 `case:*` 作为持久化业务身份或旧数据迁移机制。测试使用最新规范数据 fixture，不保留专门模拟 pre-release 历史格式的兼容测试。

导入导出是产品功能，不属于历史兼容。其 schema 必须版本化、校验完整、拒绝不支持版本；当前产品只实现并测试发布契约指定的版本。需要变更时在发布前统一更新生产者、消费者和 fixtures。

## 重构顺序

1. 冻结最新 Team、TeamVersion、Project、Task、Run 和 package 契约，并用契约测试表达状态、错误和字段。
2. 建立 Application 依赖装配入口及端口，再以垂直用例迁移 Team 创建/编辑/发布流程。
3. 迁移 Collaboration Project 创建、团队挂载替换和材料管理；验证事务补偿、digest 和并发锁。
4. 迁移 Task 创建、幂等、启动、控制、审核、重试和删除；明确 Task 投影与 Run 权威状态的协调策略。
5. 迁移 Run 查询、事件读取和进程恢复；按故障边界做注入测试。
6. 按 Team、Project、Task、Run、Package、Platform 拆出 API routes；使 `server.mjs` 收敛为 composition root。
7. 迁移 package 导入导出和 Studio Simulation；移除跨层调用和重复逻辑。
8. [已完成] 删除旧 `project-repository.mjs` 并将文件存储实现移入 `infrastructure/file-project-store.mjs`；旧资源路由已拆分，全仓搜索确认无代码调用方。
9. 完成产品关键路径端到端测试、浏览器验收、故障恢复和发布门禁。

每个切片先迁移行为，再删除旧实现；禁止新旧实现并行长期存在。阶段性提交应保持构建和对应测试通过，避免最后集中替换。

## 高标准验收

### 经典团队项目化 UAT

以“软件研发”经典团队在桌面 Chrome 完成一条真实页面路径；自动化浏览器回归同时断言 API 和持久化关联：

1. 从 `/cases/software-team` 选择“用于项目”，填写项目名称并创建协作项目；项目页应显示已挂载团队、项目资料区和空任务清单，不应进入团队编辑器。
2. 输入一项明确的项目请求并记录任务；Task 出现在当前项目的任务清单，显示请求内容、团队和“待执行”，此时 `currentRunId` 为空且 `runIds` 为空。任务可选择“流程预览”或“隔离运行”。
3. 自动化验收选“流程预览”后开始处理；页面显示该 Task 的运行状态、事件和“流程预览”标记，项目不新增第二条 Task。预览输出以 `[dry-run]` 开头，列表标为“结果摘要”；展开后再读取完整结果，不得显示为真实业务交付。
4. 检查运行详情：Run ID 与 Task 的当前 Run 一致；Run 计划含经典团队五个角色，持久化状态为 `completed`，任务请求、运行事件和角色节点证据可查询。
5. 人工 UAT 选择“隔离运行”，在 Team Studio readiness 无阻塞且平台模型已登录时启动；结果应针对用户请求形成研发方案，覆盖实现拆分、用户体验、验收检查及交付整合。无配置或 readiness 阻塞时，页面应显示可理解的错误，Task 保持可重试，且 `currentRunId`/`runIds` 不变。
6. 从失败 Task 发起重试并刷新页面；原 Task 保留，`runIds` 按顺序增加一个新 ID，`currentRunId` 指向新 Run，`attemptNumber` 递增。时间线显示旧 Run 为历史尝试；旧 Run 仍可读取，但控制操作被拒绝。
7. 桌面 Chrome 和 390px 移动视口检查任务区：无横向溢出、内容与操作区无重叠、可见控件均在视口内；展开/读取结果操作可达，滚动和页面刷新后信息层级仍清楚。

隔离运行依赖用户配置的本机模型底座；自动化回归不调用真实外部模型，以避免模型可用性和内容波动掩盖页面/API 契约问题。

### 架构与边界

- [x] API route 只负责协议、DTO 和错误映射；没有文件系统、锁或 runtime 调用。
- [x] Application 用例可脱离 HTTP 独立测试；依赖由 composition root 注入。
- [x] Domain 无基础设施导入；Team/Project/Task/Run 的不变量只有一个权威实现。
- [x] Infrastructure adapter 只实现明确端口；不反向依赖 API 或页面代码。
- [x] `server.mjs` 不包含产品用例逻辑；路由按资源拆分且无重复匹配。
- [x] 旧 `project-repository.mjs` 已删除并由具名 Infrastructure adapters 完全替代；无旧 API fallback、旧字段规范化或重复业务实现。
- [x] 自动化依赖边界检查阻止 Domain/Application 引入禁止模块；新增业务能力必须从对应 Application 用例进入。

### 领域与数据正确性

- [x] TeamVersion 发布、编辑、挂载、替换和归档规则符合最新契约；发布版本内容不可变。
- [x] Task 必须选择项目已挂载的规范 TeamVersion；项目活动期间拒绝挂载修改。
- [x] 幂等请求在成功、失败和并发重试下均不重复创建 Task/Run；键复用不同请求被拒绝。
- [x] Team/Project digest 对目标定义字段稳定，对 Task/Run 历史和无关元数据不敏感。
- [x] Run 状态机覆盖全部状态、控制命令、Runtime 结果映射、终态规则和非法转换。
- [x] Project 元数据与 Run 状态分属不同工作区时，锁顺序明确；故障后投影能够幂等修复。
- [x] Project 最新 schema 在单项读取和目录查询中拒绝错误数据；内置团队、导入导出和 API 全程使用规范身份。

### 产品全流程

- [x] 浏览器流程覆盖创建团队草稿、Natural 理解/生成、Professional 编辑、校验、模拟、发布及目录展示。
- [x] 浏览器和 API 流程覆盖创建协作项目、挂载多个 TeamVersion、替换团队、添加材料、创建任务、运行、查看事件与结果。
- [x] “经典团队 -> 协作项目 -> Task -> Run -> 交付结果”浏览器 UAT 按上述步骤通过，刷新后关系和结果保持一致。
- [x] Task 流程覆盖排队、启动、并发拒绝、暂停、恢复、等待审核、批准/返工/终止、取消、失败、重试、删除和幂等重放。
- [x] Studio Simulation 不污染正式 Project、Task、Run 历史；Operations Run 保存完整且可查询的执行快照。
- [x] 导入导出覆盖成功往返、无效 schema、digest 篡改、路径穿越、冲突策略及多团队包。
- [x] 所有关键错误在 UI 中可理解、可恢复；重复提交、慢响应、请求取消和页面切换不导致重复写入或未处理异常。

### 并发、恢复与安全

- [x] 并发创建同名 Team/Project、替换挂载、重复启动 Task 和相同幂等键均有确定结果。
- [x] 故障注入覆盖 Run 预留、计划创建、执行中断、控制请求、Run 终态落盘、Task 投影和进程重启。
- [x] 每个恢复场景都验证持久化文件、API 读模型、Task/Run 关联和后续重试，不只验证函数返回值。
- [x] 锁释放、临时目录清理和原子写入在异常路径经过验证；无永久活动锁或半成品 Project。
- [x] 导入路径和静态资源路径防止 traversal/symlink 越界；公开 DTO 不泄漏本地路径、密钥或内部幂等指纹。

恢复场景证据记录在本方案和 Release UAT 的现有验收记录中，不另建平行证据文档。每个注入点记录触发方式、持久化状态、恢复后的 API/Task/Run 读数、关联 ID、后续重试、临时文件/锁清理及重复恢复结果。最低覆盖项如下：

| 注入点 | 本轮实际结果 | 自动化证据 |
| --- | --- | --- |
| Task Run 预留写入失败 | 对 `project.json` 原子 rename 注入一次 EIO。Project `recovery-fault-project-1a2933b3` 的 Task `20261019-085608-7a2f20f2` 在故障后磁盘/API 均为 `queued`，`currentRunId=null`、`runIds=[]`，Run 目录为空；同一 Task 后续创建 Run `20261019-085609-84973639` 并完成。测试 `finally` 清理临时根目录并断言其已删除。 | `task-run-recovery-faults-uat.test.mjs`: `Task Run reservation write failure leaves no Run artifacts and permits a later start`；保留原 use case 单测。 |
| Run 计划创建失败 | 对 `run-plan.json` 原子 rename 注入一次 EIO。Project `recovery-fault-project-5fd583d4`、Task `20261019-085535-fe94dc0a` 的失败 Run `20261019-085537-08901054` 在磁盘和 API 均为 failed、计划缺失；retry Run `20261019-085607-c4c082a7` 完成，旧 Run 状态不变。测试 `finally` 清理临时根目录并断言其已删除。 | `task-run-recovery-faults-uat.test.mjs`: `Task Run plan creation failure is persisted, queryable, and safely retryable`。 |
| 执行中进程退出 | Project `live-process-recovery-project-d4c16732`、Task `20261019-085500-b9c0626b` 的真实 Run `20261019-085500-7464e8d8` 在 running 状态落盘后挂起 worker 并 SIGKILL Team Site。重启后磁盘、Task/Run API 与 events 一致收敛到 failed/RUNNER_RESTARTED；retry Run `20261019-085533-ef06a0f5` 完成并保留旧 Run；再次启动后 metadata 和两份 Run state 字节不变。测试 `finally` 清理临时根目录并断言其已删除。 | `task-run-control-and-recovery-boundaries.test.mjs`: `process termination during a live Run is recovered from durable state, queryable, retryable, and idempotent`。 |
| 控制请求写入失败 | Project `control-failure-project-9df7fd3d`、Task `20261019-085457-ce4c8138`、Run `20261019-085457-ab966fc4`：控制请求原子 rename 注入 EIO 后，Task pause API 返回 400；磁盘与 API Run/Task 均仍为 running，控制目录已提交 JSON 数为 0，重复读数一致。故障解除后 pause 成功，Task/Run 均为 pause_requested，控制意图文件数为 1。测试 `finally` 清理临时根目录并断言其已删除。 | `task-run-control-and-recovery-boundaries.test.mjs`: `Task control write failure leaves control and Run projections unchanged until a successful request`。 |
| Run 终态落盘后 Task 投影写入失败 | Project `recovery-fault-project-99aedd02`、Task `20261019-085609-17ae9821`、failed Run `20261019-085610-b090533f`：注入后磁盘 Task 为 planning，Task API 与 Run state/API 为 failed；重启修复磁盘 Task 为 failed，重复恢复字节稳定；retry Run `20261019-085610-36e0aa13` 完成且旧 Run 不变。测试 `finally` 清理临时根目录并断言其已删除。 | `task-run-recovery-faults-uat.test.mjs`: `recovery repairs a failed Run whose terminal Task projection write failed; retry and repeat recovery are idempotent`。 |
| Run 状态缺失或 Task 投影陈旧 | 缺失状态场景 Project `missing-state-project-3350589b`、Task `20261019-085458-6657787b`、Run `20261019-085458-a7bac92f`：恢复后 Task 磁盘/API 为 failed，Run GET 为 400，retry Run `20261019-085459-6e719df0` 完成。陈旧投影场景 Project `stale-projection-project-6530dccb`、Task `20261019-085458-fdc8363d`、Run `20261019-085458-dbfe9dcf`：Task/Run 磁盘/API 收敛到 failed，retry Run `20261019-085459-95875c56` 完成。两种路径重复恢复持久化字节不变；测试 `finally` 清理临时根目录并断言其已删除。 | `task-run-control-and-recovery-boundaries.test.mjs`: `startup recovery repairs missing Run state and stale Task projection, then supports retry and repeat recovery`；旧跨 workspace 契约测试保留。 |
| staging/锁异常清理 | 名称锁操作失败后锁文件不存在且同名锁可再次进入；服务重启清除 stale staging；HTTP 创建失败没有半成品 Project。 | `file-team-lifecycle-locks.test.mjs`: `collaboration Project name lock releases after a failed operation`; `domain-contract-regression.test.mjs`: `stale staging directories are cleaned on the next process start`、`HTTP project creation failure leaves no half-created project`。 |

### 浏览器与发布门禁

- [x] 关键端到端用例在真实 Team Site server 上运行，至少覆盖一条完整 Studio 到 Operations 路径和一条中断/恢复路径。
- [x] Chrome 页面 `pageerror = 0`、`unhandledrejection = 0`；控制台无本产品未处理错误。
- [x] 桌面与 390px 移动视口完成关键流程；无横向溢出、遮挡、不可操作控件或丢失输入。
- [x] 关键交互具备 loading、empty、error、success 状态；运行状态、审核状态与可用操作一致。
- [ ] 所有平台门禁均有实际结果；当前 macOS 自动化无失败，但 Windows 专属用例未在 Windows 运行，不能关闭此项。
- [x] macOS 自动化通过 `pnpm build`、Team Site 全量测试、`pnpm run test:docs-command-drift`、`pnpm run test:visualizer` 和仓库 `pnpm test`；仓库测试中 1 项 Windows 专属用例按条件跳过。
- [x] 验收记录注明运行命令、结果、浏览器/视口、覆盖的产品路径及未覆盖风险；未通过项不得标记完成。

代码变更后先重跑受影响的专项测试；最终全量命令须针对同一最终代码状态执行并记录代码标识。Windows 专属测试必须在 Windows 执行。尚未执行、缺少证据或标记为 `Blocked` 的门禁均不算通过。

## 明确不做

不支持历史 schema 和旧 API，不做旧数据迁移、旧字段规范化或兼容 fallback。清空旧本地数据后，当前应用只接受最新 schema。当前不引入微服务、事件总线、外部队列、第二套 authoring/validation 实现或复杂全局前端状态框架。任何新增抽象须对应真实替换边界、业务规则或可验证的故障隔离需求。
