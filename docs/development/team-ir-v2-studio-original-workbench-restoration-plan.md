# Team IR v2 Studio 原版图谱工作台恢复与语义替换方案

状态：阶段 1/2 自动化切片已落地，Visualizer 布局与图谱连接回归通过，整体验收进行中

当前状态（2026-11-01）：Team IR typed patch、原版图谱外壳、真实 Agent 端口投影、X6 多端口连线、边表单端口选择、布局隔离和旧写入路径静态门已完成并通过确定性回归；图谱连接取消清理、桌面稳定滚动槽和移动端工具栏布局回归已修复，Visualizer Studio 图谱套件 17 项通过、Build Layout 套件 4/4 通过；完整 Join/Loop/Review/Artifact/A2A 可视编辑、复杂拓扑作者引导、真实 Sandbox/Provider UAT、完整 i18n 和 5 位非技术用户人工验收仍是未完成项。

用途：指导 Team Site Studio 的落地、回归验证和最终验收。

本方案已核对 `origin/main` 当前最新提交 `184cce2` 的 `/studio/teams/:id/design` 工作台，并以它作为视觉、布局和交互基线；以 `f7bff4a` 的 Team IR v2 设计约束作为语义基线，同时把原版语义替换为 Team IR v2。当前本地 `main` 引用仍停在 `f7bff4a`，因此不能用本地分支名代替已核对的 `origin/main`；原版提交只作为结构参考，不作为代码整体回退目标。临时基线服务和正式 `/ir` 对照证据见下方基线核对记录。

### 基线核对记录（2026-10-31）

- 视觉/交互基线已核对：`git show 184cce2:apps/team-site/public/app/views/app.js` 与 `git show 184cce2:apps/team-site/public/styles.css` 中的 `.studio-design-workbench`、`studio-asset-drawer`、右侧停靠、拖动、键盘移动、resize 和 Team configuration 三 Tab 结构，是本方案恢复的基线；`f7bff4a` 是 Team IR v2 设计约束基线，不是可直接运行的页面实现。
- 当前 `0224071` 工作树的 `/studio/teams/:id/ir` 已在 `renderStudioTeamIrWorkbench` 内接入基线 `studio-design-workbench`、X6 图谱、三 Tab 团队配置抽屉和 Team IR v2 typed patch；基线布局/停靠已对齐。完整 Join/Loop/Review/Artifact/A2A 深度可视编辑、复杂拓扑作者引导和全量 Inspector 字段仍未完成，因此不能把当前入口标为完整产品能力完成。
- 浏览器验收基线已恢复到 `0224071^` 的 `apps/team-site/tests/team-ir-studio-browser.test.mjs`（当前 1142 行），并额外增加正式 `/studio/teams/:id/ir` 的 X6 画布、三 Tab、右侧停靠、浮动后重新停靠和无额外“属性”按钮断言。恢复不是有意删减：Advanced JSON、Schema/Artifact 快速编辑、诊断定位、CAS、Loop/Review、Artifact Simulation、模板矩阵和 digest 断言均保留；旧长表单断言明确访问 `?view=long-form`，不把该兼容回归路径当作正式入口。
- 视觉核对证据（2026-10-31）：从 `origin/main` `184cce2` 临时工作树启动基线服务 `4176`，访问 `http://127.0.0.1:4176/studio/teams/new-team-50e31c05/design` 得到 200，并核对 `studio-design-workbench`、X6 工具栏和三 Tab；当前 v2 服务保留 `/design` 兼容入口，但客户端会立即 canonical replace 到正式 `/ir`，不在 `/design` URL 上重复渲染工作台。正式入口在 1440×960 和 1280×900 下核对同一工作台、340px 右侧 `studio-asset-drawer`、角色/流转/全局 Tab、浮动/回停靠和无 page error。截图保存在本机 `/tmp/main-design-baseline.png`、`/tmp/team-ir-docked.png`，机器断言已纳入浏览器测试。
- 视觉语义补齐（2026-10-31）：对照同一 `origin/main` 页面 DOM，Team IR 图谱通过案例只读展示元数据恢复角色标题/首字徽标（如“辩论”“正方”）和本地化 Handoff 边标签（如“任务分发”“评议已完成”）；角色资产列表和 Inspector 使用同一套本地化标题。展示映射停留在 `teamIrToGraphAuthoring` 投影层，未写入 Team IR 语义摘要；1440×960、390×844 以及英文 locale 均无 page error。新增适配器、案例目录和浏览器核对不改变下方仍未完成的独立验收门。
- 临时展示映射（2026-10-31）：`apps/team-site/api/case-routes.mjs` 的 `localizedFlowLabels` 仅为内置案例提供只读本地化标题，将旧案例目录的展示标签映射到当前 v2 Handoff；它不写入 Team IR，也不参与语义摘要。当前启发式在同一端点拆成多个 v2 条件分支时取最后一条内置分支，只对现有 fixtures 有保证；`case-api-routes.test.mjs` 已覆盖该分支形状。长期应把稳定展示标签直接放入 v2 fixture 的 `presentation`，并在替换前不得把该映射当作通用 v2 标签推断器。
- 当前仍未验证（不得由全仓 `pnpm test` 的通过替代）：Visualizer 浏览器验收；Visualizer Team package 导入的路径穿越、符号链接和权限安全测试；`src/visualizer` 本轮 TypeScript 改动的逐行审阅；5 位非技术用户人工验收；真实 Sandbox/Provider UAT。上述事项没有独立通过证据，继续保持未完成。
- 后续适配必须继续在上述原版工作台结构内接入 Team IR v2 语义，保留完整浏览器断言，并将剩余旧选择器迁移到当前 Inspector/停靠结构后再恢复通过状态。
- 审核缺口修复：全局资产列表已加入 Route 列表和 JSON Inspector；图谱命令通过 `selectedFlowId` 传递稳定 Handoff ID；Binding 按 `kind` 区分 A2A 与通用更新；Inspector 控件样式已恢复下拉框、排序操作、checkbox/radio 的基线排版。完整 Join/Loop/Review/Artifact/A2A 深度编辑仍未完成。

## 1. 总体目标

恢复以下原版体验：

- 固定或可停靠的团队配置侧边栏；
- 中文 Agent/Role 列表、Flow/Handoff 列表和全局配置；
- 原版图谱布局、节点、端口、连线、工具栏、动画、抽屉和 Inspector；
- 选中节点显示四周端口桩，并支持端口到端口拖拽连线；
- 仿真、运行历史、Project Task 和 AI 构建入口。

Team IR v2 继续作为唯一语义事实源：

    Team IR draft -> graph view model -> 原版图谱 UI
    UI 操作 -> TeamIrPatchV1 -> 服务端校验与 CAS 保存
              -> 新 Team IR draft -> 重新派生图谱

不得恢复旧 Team 写入 API、旧状态模型、旧 Mermaid 语义、旧迁移逻辑或旧设计数据写入路径。

本方案只针对当前最新 Team IR v2 Schema、Compiler、Runtime 和 Studio 实现。无需兼容历史 Team Design 数据、旧页面状态、旧 API 或旧配置格式，也不建立历史数据迁移路径。

## 1.1 最新 v2 场景可视化验证

新语义必须使用当前格式重新创建的 Team IR v2 场景进行浏览器验证，不以历史页面、历史快照或迁移结果作为验收证据。至少覆盖以下场景：

- 线性 Run -> Agent -> Result；
- 多端口 Handoff 和显式字段映射；
- 并行分发、all_of Join 和 Collector Agent；
- quorum_of Join；
- Loop、Review 和返工；
- Artifact 输入、输出和 Result 交付；
- A2A Binding；

场景与阶段对应关系：

| 场景 | 所属阶段 | 是否阻塞本方案 |
| --- | --- | --- |
| 线性 Run -> Agent -> Result | 阶段 1 至 3 | 是 |
| 多端口 Handoff 和显式字段映射 | 阶段 1 至 3 | 是 |
| 并行分发、all_of Join 和 Collector Agent | 阶段 4 | 是 |
| quorum_of Join | 阶段 4 | 是 |
| Loop、Review 和返工 | 阶段 4 | 是 |
| Artifact 输入、输出和 Result 交付 | 阶段 4 | 是 |
| A2A Binding | 阶段 4 | 是 |

每个当前 v2 场景都必须验证场景实例化、图谱显示、端口和连线、对应 Inspector、保存重开和诊断状态。Simulation 验证统一归入阶段 5；Boundary Extension 场景不属于本方案的阶段 1 至 4 或阶段 5 验收，不能作为本方案的阻塞条件。

## 2. 语义替换矩阵

| 原版位置 | 保留的体验 | v2 语义替换 |
| --- | --- | --- |
| 角色属性 | 角色列表、中文名称、固定 Inspector、折叠分组 | Agent id、packageRef、bindingRef、输入/输出端口合同 |
| 执行绑定 | AI 模型、执行工具、未绑定选择器 | 可信 Binding catalog；活动默认模型统一为 codex/gpt-6-luna |
| 备选模型 | 原位置和说明形式 | 删除旧 fallback 字段，改用 bindings.retry |
| 路由策略 | 原下拉控件 | orchestration.routes |
| 汇聚策略 | 原角色级配置位置 | orchestration.joins，作用于 Agent 输入端口 |
| 循环上限 | 原配置位置 | orchestration.loops |
| 人工审核 | 原配置位置 | orchestration.reviews |
| 上下文映射 | 原编辑入口 | Handoff map.data、map.artifacts 和 Join baseMapping |
| 角色资产包 | 原查看分组 | 只读 Package 摘要和可信引用；Package 不在 Studio 中直接修改 |
| Start | 原节点、桩和连线体验 | kind=run、runInput、Run-to-Agent Handoff |
| End | 原节点、桩和连线体验 | kind=result、runResult、Agent-to-Result Handoff |
| Flow | 流转列表和 Inspector | Handoff；必须选择真实 outputPort 和 inputPort |
| 事件类型 | 原输入控件位置 | 输出 Port/Event 选择器 |
| 错误分支 | 原复选框位置 | 删除无对应 v2 语义的字段，改为诊断、失败策略或显式 Handoff |
| 流转契约 | 原契约区域 | 删除旧独立 Flow Schema 文件；使用端口 Schema、映射、Artifact 和交付期限 |
| 全局配置 | 原全局 Tab 和布局 | Team/TeamVersion、执行策略、Run/Result 合同、边界策略、诊断和发布状态 |

显示名称和技术 ID 必须分离：

- 中文名称写入 presentation.nodes[agentId].label，不进入 semantic digest；
- 技术 ID 修改属于语义操作，必须同步更新 Handoff、Route、Join、Loop、Review、端口引用和布局键；
- 图谱连线不得默认取第一个端口，必须携带真实 source outputPort 和 target inputPort。

## 3. Run/Result 边界语义

### 3.1 当前 v2 默认语义

- Run 向符合条件的 Run-to-Agent Handoff 分发；
- Result 默认采用单一结果写入；
- executionPolicy.resultMode 继续表示 required 或 allow_empty；
- 多方汇总使用显式 Collector Agent、输入 Join 和 Collector-to-Result Handoff；
- 旧版 Start.random_n、End.all_of、End.quorum_of 在边界扩展完成前不得显示为可编辑控件。

Collector Agent 仍是复杂字段合并、Artifact 组装、冲突解决和业务判断的推荐路径。

### 3.2 保留项：Run/Result Boundary Extension

Run random_n、Result all_of/quorum_of 和直接 Result 聚合保留在附录 A，作为独立 Team IR v2 Boundary Extension 方案和独立分支。本方案不新增 orchestration.boundary，不修改当前 v2 Schema、Compiler、Runtime checkpoint、结果写入或语义版本。

在独立扩展完成前，Studio 只展示当前 v2 已支持的 Run/Result 合同（runInput、runResult、resultMode）；复杂汇总使用显式 Collector Agent。Boundary Extension 不是本方案任何阶段的依赖，也不阻塞原版 Studio 外壳恢复。

## 4. TeamIrPatchV1

先定义并测试版本化 typed patch，再开放图谱编辑：

    agent.create/update/remove/rename
    agent.port.upsert/remove
    artifactSlot.upsert/remove
    agent.binding.update
    a2a.binding.update
    handoff.create/update/remove/retarget
    route.upsert/remove
    join.upsert/remove
    loop.upsert/remove
    review.upsert/remove
    runInput.update
    runResult.update
    executionPolicy.update
    presentation.nodeLabel/edgeLabel
    document.replace

合同要求：

- 每个操作有固定版本和字段白名单；
- patch 只在浏览器内对当前 draft 原子应用，不新增服务端 PATCH API；
- 保存统一调用现有 PUT /api/v1/team-versions/:id/ir，提交完整 Team IR 和 expectedSemanticDigest，由服务端完成 Schema、语义校验和 CAS；
- document.replace 仅用于用户明确执行完整文档替换且 Advanced JSON 已成功解析的情况；普通字段或局部 Advanced JSON 应用不得清空缺失字段，未知字段和高级合同必须保留；
- patch 批次事务性应用，任一失败则整体回滚；
- 未知字段、高级 Schema、Artifact 元数据和未显示字段必须保留；
- 服务端按 Schema、引用、映射、语义和 Runtime 拓扑依次校验；
- 保存带 expectedSemanticDigest，冲突返回 CAS 错误，不覆盖他人修改；
- patch 失败时 draft、撤销栈和快速编辑器状态均不改变；
- presentation 修改不改变 semantic digest；
- 删除 Agent、Port、Handoff 时先显示影响范围，确认后原子清理已知引用。

当前实现位置和硬要求：

- apps/team-site/public/app/team-ir-graph-adapter.js 中仍存在 graphAuthoringToTeamIr、applyTeamIrPatch 和 applyTeamIrPatches；
- apps/team-site/public/app/views/app.js 仍有 graphAuthoringToTeamIr 调用，必须在阶段 1/2 完成前移除；
- graphAuthoringToTeamIr 不得继续作为任何写入路径；
- applyTeamIrPatch 及 applyTeamIrPatches 必须扩展为完整的 Agent、Port、Handoff、Route、Join、Loop、Review、Artifact、A2A 和 presentation 操作；
- 适配器缺口修复前不得通过阶段 1/2 退出条件。

## 5. 分阶段实施

### 阶段 1：原版外壳只读恢复

- 从 main 逐文件提取图谱布局、侧边栏、Inspector、工具栏和抽屉；
- 接入 Team IR 到 graph view model 的完整只读投影；
- 覆盖空白草稿和 8 个经典模板；
- 退出条件：模板均能加载，节点、真实端口、边界端点和中文显示名稳定呈现；Join 端口 ID、presentation 显示名、packageRef 和 bindingRef 投影正确。

### 阶段 2：图谱交互与基础语义编辑

- 选中节点显示四周端口桩；
- 只允许合法 outputPort 到 inputPort 的拖拽连线；
- Agent、Port、Handoff、显示名和布局分别走 typed patch 或独立 localStorage；
- 布局键使用 ogs.team-ir-v2.layout.v1:<teamId>:<teamVersionId>:<nodeId>；
- 布局变化不改变 semantic digest；Agent 删除清理布局；技术 ID 修改只迁移或清理 localStorage 布局键，不涉及历史 Team 数据迁移。
- 阶段退出前必须修复以下适配器缺口：Join 查找必须使用 inputPorts 的端口 ID，而不是 Object.values 得到的端口对象；必须投影 presentation.nodes[agentId].label；必须完整投影 packageRef 和 bindingRef；必须移除旧 graphAuthoringToTeamIr 写入调用。

### 阶段 3：Inspector 与侧边栏完整替换

- 恢复角色、流转、全局三个 Tab；
- 保留原版分组、折叠、状态提示和保存按钮；
- 逐项替换旧字段，不留下误导性的旧控件；
- Advanced JSON 使用失焦、显式应用或稳定 debounce；非法 JSON 保留原文和最后一次有效投影。

### 阶段 4：完整 v2 编排能力

- 接入 Join、Loop、Review、Artifact、A2A、Binding 和运行诊断；
- quorum_of Join 仅按当前 Runtime 已支持的拓扑开放编辑；不支持的组合只显示服务端诊断并保持只读或阻断状态；
- Runtime 不支持的拓扑由服务端诊断，前端显示只读、禁用仿真或阻断发布；
- 每条诊断定位到对象、控件或 JSON Pointer。

### 阶段 5：仿真、AI 和独立 Visualizer

- 恢复仿真、运行历史、Project Task、Release Gate 和 AI 构建入口；
- AI 只能生成可审阅的 typed patch，不能绕过保存、CAS、Schema 或发布门；
- Visualizer package 导入单独验收路径安全、符号链接防护和权限检查。

## 6. 测试与验收

### 机器测试

- 图谱适配器快照：空白草稿、8 个经典模板、Run/Result 合同（runInput、runResult、resultMode）和真实多端口；
- 往返测试：IR -> view model -> typed patch -> IR，断言高级字段、Join、Loop、Review、Artifact、A2A 和未知字段不丢失；
- 原子性测试：非法 patch、重复 ID、错误端口、CAS 冲突均保持原 draft 不变；
- 静态检查：旧 Team 写入端点扫描、活动配置中的 gpt-5.6 禁止扫描、活动代码不得调用 graphAuthoringToTeamIr 进行运行时写入、构建、格式检查和完整回归。

### 浏览器验收

- 侧边栏固定、中文 Agent/Role 列表、Flow/Handoff 列表和全局配置；
- 节点选中、端口桩显示、端口拖拽、连线重开和错误端口阻断；
- Agent、Handoff、Join、Loop、Review、Artifact 和 Run/Result 合同 Inspector（runInput、runResult、resultMode）；
- Advanced JSON 改名、改类型、新增/删除槽位后继续快速编辑，不发生旧状态覆盖；
- 布局保存重开，且 semantic digest 不变；
- 窄屏、键盘可达性、撤销/重做、未保存提示、诊断定位和服务端拒绝。

### 阶段 5 Simulation 验收

- 阶段 5 负责为阶段 1 至 4 已通过的当前 v2 场景补做 Simulation；
- 每个场景验证仿真输入、运行状态、Handoff 进度、Result 合同、诊断和运行历史；
- Simulation 失败必须区分场景语义错误、Runtime 不支持拓扑和环境故障，不得回写或隐式修改 Team IR；
- Simulation 证据单独记录，不改变阶段 1 至 4 的图谱外壳和语义正确性结论。

### 最新 v2 场景浏览器验收

- 每个新语义使用当前格式的新 TeamVersion 验证，不复用旧 Design 数据；
- 默认使用 Playwright/Chromium；需要确认真实视觉布局、拖拽、停靠、焦点、动画、滚动或遮挡时，可按需使用 browser-use 和 Chrome 工具；
- 工具验收必须记录实际地址、浏览器和视口、使用场景、操作步骤、截图或诊断结果、保存重开结果以及页面错误；
- 必须验证 Run/Result 合同（runInput、runResult、resultMode）、Join/Loop/Review、Artifact、A2A 和不支持拓扑的只读或阻断状态。

### 分开记录的验收门

1. 当前 pin 的机器发布门；
2. 原版 Studio 外壳与 v2 语义正确性；
3. 最新 v2 场景可视化与语义正确性；
4. 5 位非技术用户人工验收。

5 人人工验收仍是待人工事项，不由代码或机器测试自动标记通过。

Boundary Extension 的独立验收门保留在附录 A，不属于本方案验收列表。

## 7. 文档、文案和运行约束

- 更新 Team IR v2 设计方案、Studio 作者体验方案、实施验证台账和用户手册；
- 明确“开始”是 Run 的视觉名称，“结束”是 Result 的视觉名称；
- 明确当前 v2 能力、Collector 等价方案和 Boundary Extension 为独立保留项；
- 统一使用“输入端口、输出事件、交接、汇聚、运行输入、运行结果”等术语；
- 活动模型默认值和运行入口统一为 gpt-6-luna；
- 实现、Schema、Compiler、Runtime、Studio 和验收均以当前最新版本为准，不提供历史配置兼容、旧 API 兼容或数据迁移；
- 历史台账和审计记录可以保留为事实记录，但不构成最新版本的兼容性验收要求；
- v2 服务默认使用 Team Site `4263`、Visualizer `3637`、OpenCode `4096`；Tailnet 启动使用 `4264/4267`；端口占用时允许通过显式参数切换并记录实际地址。v1 的 `4173/4174/4177/3337` 端口合同保持不变，不在本计划内；
- 清理进程前先核对命令行，4096 的 OpenCode 不停止；
- 布局状态只存独立 localStorage，不进入 Team IR 或 semantic digest；
- AI assist 与 Visualizer 独立验收，不作为原版 Studio 外壳恢复的阻塞依赖。

### 7.1 旧写入端点静态扫描规则

活动前端和 Team Site 运行代码不得向旧 Team 写入端点发起 POST、PUT、PATCH 或 DELETE。扫描范围为 apps/team-site/public/app、apps/team-site/server.mjs、apps/team-site/application 和 apps/team-site/infrastructure。

禁止目标包括旧 team-factory、旧 design、旧 graph、旧 chat、旧 Team Design 保存端点及其等价路径。允许的当前语义写入仅包括：

- PUT /api/v1/team-versions/:id/ir；
- POST /api/v1/team-versions/:id/ir/validate；
- 当前 v2 Simulation、Artifact、Review 和项目挂载接口；
- 只读页面跳转、测试夹具和文档中的历史字符串。

检查必须区分“字符串出现”和“运行时写入调用”：测试与文档可以引用禁止路径，活动代码不得对禁止路径使用写方法。除静态字符串扫描外，阶段验收必须使用 AST、模块调用图或等价运行时断言，确认活动代码不存在 graphAuthoringToTeamIr() 的写入调用；该函数名是否仍存在不能作为通过条件。每次阶段验收都运行静态扫描，并保留命中路径、HTTP 方法和允许列表判定。

### 7.2 最新回归证据（2026-11-01）

- `pnpm run test:visualizer-browser`：Studio 图谱套件 17 项通过、2 项明确 opt-in 跳过；Build Layout 套件 4/4 通过。桌面与移动 Darwin 快照对应当前紧凑导航、移动端分组工具栏和停靠 Inspector 布局。
- 生命周期宽度回归覆盖 1100、960 和 720 像素，并确认切换所有主工作区、运行侧栏开关后 stage/client width 不漂移。桌面滚动槽仅在宽屏保留，移动端不引入横向溢出。
- 图谱关系连接的 `finally`、document-level pointer 捕获和延迟 pending-edge 清理均已由 Studio 图谱回归覆盖；临时调试字段和运行时计数器已移除。
- 仍未完成：A1 人工体验门、完整 i18n、复杂拓扑作者引导、真实 Sandbox/Provider UAT、Visualizer package 导入安全专项和 5 位非技术用户人工验收。

## 附录 A：Run/Result Boundary Extension 保留项

本附录只保存未来独立立项所需的范围，不属于当前 Studio 恢复实施。该扩展必须使用独立分支、独立 Schema/Compiler/Runtime 变更和独立验收记录。

预留能力：

- Run random_n；
- Result all_of/quorum_of；
- 直接 Result 聚合。

独立方案必须另行处理：

- Schema 与 additionalProperties=false 合同；
- Compiler 新语义版本；
- Runtime checkpoint 中的随机选择持久化；
- 条件候选过滤、恢复、超时和 exactly-once 结果写入；
- Result 聚合字段、Artifact 冲突和结果输出合同。

扩展完成前不得在当前 Studio 中新增这些控件或把它们写入当前 v2 Team IR。当前多方汇总使用显式 Collector Agent；不支持的 Runtime 拓扑只做诊断、只读展示或发布阻断。
