# Team IR v2 落地与验证台账

基线日期：2026-10-28  
状态：实施中；阶段 0 已冻结，阶段 1 部分通过，阶段 2、3 进行中，阶段 4 未开始
范围：记录 Team IR v2 从设计批准到发布切换的实施状态、验证证据和未完成项。

## 1. 使用方式与权威来源

本文件是推进台账，不是第二份规范。字段、诊断、运行状态和产品边界以[Team IR v2 Handoff 设计方案](team-ir-handoff-v2-design.md)为准；架构选择以[协作边界 ADR](adr-team-ir-collaboration-boundaries.md)为准；面向用户的场景说明以[社会分工协作设计理念](../usage/team-ir-social-collaboration.md)为准。

每次实施工作都更新本文件：开始前确认阶段和验收项；完成后记录代码位置、测试命令、结果、日期和未覆盖边界。不能用旧版能力相似、单元测试通过或文档写完来代替 v2 自身验收。

状态含义：

- **未开始**：没有 v2 实现和有效验收证据。
- **进行中**：实现或验证正在进行，至少有一项验收未完成。
- **部分通过**：有明确通过项，但仍有必需验收项未完成。
- **通过**：该阶段全部门槛通过，证据已记录，相关文档与实现一致。
- **受阻**：存在明确外部依赖或无法由当前工作继续解决的问题；必须记录影响、已完成部分和解除条件。

不得将未验证写成通过。测试失败、未运行、跳过和环境阻塞必须分别记录；不得只记录最后一次成功而删除相关失败证据。

## 2. 当前基线

截至基线日期，设计和协作边界文档存在，`src/team-ir/` 尚未建立。仓库当前实现主要是 Mermaid / 旧 System 编译与运行路径。既有 `all_of`、`quorum_of`、人工审核、错误流、Artifact 和恢复测试可用于理解现状或复用测试设施，但不证明 v2 的端口映射、Join `skipped`、唯一 `runResult`、Loop dominance 或 `compiledPlanDigest` 已实现。

| 项目 | 状态 | 当前证据或限制 |
| --- | --- | --- |
| Team IR v2 设计方案 | 已冻结为实施基线 | `docs/development/team-ir-handoff-v2-design.md`；阶段 0 语义复核完成，包含并行 Review、A2A 暂停/兄弟调用、重试/deadline 与失败竞态决策 |
| 协作边界 ADR | 已批准为实施基线 | `docs/development/adr-team-ir-collaboration-boundaries.md` |
| v2 Schema / Compiler / Runtime | 进行中 | `src/team-ir/` 已含 Schema、引用表达式、映射静态校验、digest、编译计划初稿和 Runtime 状态机初稿；逐项缺口见追溯矩阵 |
| Studio v2 作者体验 | 进行中 | 已有独立 `/ir` 基础作者页和 Playwright 保存/重开证据；设计方案要求的画布、Join/Loop、simulation、发布和默认入口尚未完成 |
| v2 端到端或发布验收 | 部分通过 | 有确定性经典 Team IR fixture 和 Fake Binding Runtime 集成；无可信 production closure/evidence/Binding resolver 或真实 Sandbox UAT |

## 3. 实施与验收状态

每个阶段按设计方案第 9 节实施，按第 10 节验收。下表是推进索引；通过前须把具体证据补到第 5 节的日期记录中。

| 阶段 | 主要交付 | 必须通过的门槛 | 状态 |
| --- | --- | --- | --- |
| 0. 设计冻结 | 批准根 Schema、术语、ADR 和版本兼容策略 | 设计评审清单无未决语义冲突；规范示例和运行/API 规则一致；审批状态明确 | 通过 |
| 1. Team IR 包 | `src/team-ir/` 类型、Schema、解析器、引用解析、静态校验、诊断、规范化和 digest | 正例/反例 fixtures 覆盖设计方案全部阻断诊断；路径作用域与受支持 JSON Schema 子集明确 | 部分通过 |
| 2. Compiler / Runtime | `CompiledTeamPlan`、端口投影、Handoff、Join、Loop、审核、错误、Artifact、Checkpoint 和恢复 | 顺序、条件路由、fan-out、Join、Loop、结果、失败、恢复和 A2A 合同测试通过；不经旧编译器语义路径 | 进行中 |
| 3. Studio / 发布 | Team IR 作者模型、预检、编辑、模拟、发布、读取与重开 | Studio 与服务端诊断和语义 digest 一致；浏览器验收覆盖核心作者流程和窄屏 | 进行中 |
| 4. 切换与清理 | CLI/API/Studio 默认入口、模板、示例、文档和旧配置拒绝行为 | 版本兼容矩阵通过；历史 Run 只读；活动示例均为 v2；无意外迁移或覆盖 | 未开始 |

### 阶段门

- 阶段 0 已冻结；实现可据此推进，但新发现的合同缺口必须经设计复核并留下变更记录。
- 阶段 1 未通过前，不开始依赖未冻结语义的 Studio 大规模实现；确需并行时记录风险和受影响合同。
- 阶段 2 未通过前，不把 v2 场景描述为端到端可用。
- 阶段 3 未通过前，不切换默认产品作者入口。
- 阶段 4 未通过前，不宣称 v2 发布完成或旧配置断代完成。
- 阶段间可以有经评审的并行工作，但不得跳过前置合同、验收证据或兼容矩阵。

## 4. 验证要求

### 自动化验证

- **Schema / Compiler**：每条规范规则至少有合法正例、非法反例和稳定诊断断言；静态无法证明的情况必须断言运行时校验提示。
- **Runtime 状态机**：使用确定性 Fake Binding，不依赖真实模型、网络时序或不可控服务。断言终态、激活集合、Join 来源状态、结果写入次数、审计事件和 checkpoint 内容。
- **恢复与幂等**：对关键状态边界注入中断，验证恢复不重复执行已提交副作用、不改变路由选择，并验证编译闭包变化时拒绝继续。
- **Studio / API**：分别覆盖服务端合同与真实浏览器交互；保存后重载并比较规范化 IR、诊断和 digest。
- **安全与历史数据**：验证 Artifact 越权读取失败、旧 Team 配置明确拒绝、历史 Run 查询不依赖当前项目定义且保持只读。
- **完整回归**：阶段验收使用当时仓库定义的完整测试命令；记录精确命令、退出码、通过/失败/跳过数量和运行环境。若完整套件耗时或环境不适用，必须列出替代范围及未覆盖测试，不能称为完整通过。

### 场景验收

场景验收验证跨模块合同，不能只由单元测试替代。至少选择并记录以下代表场景：

| 场景 | 需要证明的 v2 合同 | 验收证据 |
| --- | --- | --- |
| 条件会签 | required 必到、optional 可跳过、all-of 汇总与零到达失败 | 规范 fixture、Runtime 集成测试、Run 状态/审计记录 |
| Maker-Checker / 四眼核对 | 独立投影、结果比较、返工 Loop、上一轮引用约束 | 编译诊断测试、Runtime 回合测试、恢复测试 |
| 阶段门禁 | 互斥 PASS / REJECT 路径、完整结果、并行冲突拒绝 | 路由编译测试、结果唯一性测试、集成 Run |
| 固定 roster 主持人博弈 | 按条件跳过席位、optional Join、baseMapping、首轮和零到达边界 | dominance 测试、Join 状态机测试、多轮恢复测试 |
| 人工审核 | 审核暂停、授权决定、反馈映射、独立 timeout、活跃预算冻结 | 控制面/API 测试、Runtime 集成、浏览器审核流程 |
| A2A 待补件 | `paused_input_required` 持久化、不支持续接、取消和新 Run 边界 | Fake A2A Agent 测试、状态/审计检查、API 验收 |
| Team-as-a-Service | 仅在远程服务实际暴露兼容 A2A 合同时验证上层调用 | Agent Card 合同、Binding 集成测试；不得宣称 Team 自动发布能力 |
| 经典团队真实运行 | 用 v2 原生 Team IR 重建一个有代表性的经典团队（优先软件研发），经 Studio 保存/重开、发布、项目挂载和 Task 启动，以真实 Sandbox Binding 完成一次端到端运行；校验多角色交接、并行/Join、结果和持久化归属 | 隔离环境运行记录、Team/Plan digest、模型与 Binding 标识、Project/Task/Run ID、角色与 Join 状态、结果/Artifact 摘要、重启后查询证据及人工结果检查清单 |

每个场景都需列出前置条件、输入、预期状态变化、预期终态、失败分支、证据链接和未覆盖范围。演示成功不能替代失败路径验收。

#### v2 语义覆盖追溯

设计方案第 10 节的每一项适用验收语义都必须能追溯到至少一个 fixture/测试、断言和结果记录；不得用本节的场景名称或一次真实运行概括性地替代逐项覆盖。实现阶段应维护逐项矩阵，包含设计方案条目、测试/fixture ID、覆盖层级（Schema、Compiler、Runtime、API/Studio、真实运行）、通过证据和未覆盖状态。若某项不适用，须记录理由及评审结论；若由多项测试共同覆盖，逐项列明，不留无主条目。

以下矩阵是阶段 1 的当前追溯基线，逐条对应设计方案第 10 节。状态只表示已有测试可证明的范围，不表示阶段门通过；带“部分”的条目不得推定其余运行时/API 行为已覆盖。测试文件名后的测试标题是断言 ID。阶段 2–4 实施时须在同一行追加新证据和命令结果。

| 设计方案第 10 节条目 | 当前覆盖与精确测试证据 | 状态 / 尚缺证据 |
| --- | --- | --- |
| IR Schema：合法 v2 | `tests/team-ir-schema.test.mjs`：`Team IR v2 schema declares Draft 2020-12 and accepts a minimal document` | 部分；仅最小合法文档，不是完整规范 fixture |
| IR Schema：重复 ID | `tests/team-ir-validation.test.mjs`：`cross-reference validation reports duplicate semantic IDs and unknown references` | 已有静态诊断断言 |
| IR Schema：未知端点/端口/Binding | 同上；`cross-reference validation accepts a minimal Team and resolves Agent bindings and ports` | 部分；未知 Agent/端口/Binding 有断言，未知 Run/Result endpoint 变体待补 |
| IR Schema：非法端点类型 | `tests/team-ir-schema.test.mjs`：`endpoint schema rejects implicit endpoints and malformed agent ports` | 部分；须补齐每个非法 kind/字段组合及诊断 pointer |
| IR Schema：无效 Schema 引用 | `tests/team-ir-schema-resolver.test.mjs`：`rejects missing resources, pointers and malformed pointer escapes`、`rejects network, absolute, escaping and unsupported Team-local references`、`fails closed for network refs hidden inside a referenced schema closure` | 已有 resolver 静态拒绝；根合同调用前诊断集成仍需补齐 |
| IR Schema：runInput/runResult | `tests/team-ir-schema.test.mjs`：最小文档、缺失 root contract 断言；`tests/team-ir-validation.test.mjs`：`required-result policy and parallel result writes are checked statically` | 部分；runInput 具体输入验证、完整 result 合同/allow_empty 边界待补 |
| IR Schema：executionPolicy | `tests/team-ir-schema.test.mjs`：最小合法文档；`tests/team-ir-validation.test.mjs`：`required-result policy and parallel result writes are checked statically` | 部分；非法预算、显式空结果和终态行为待补 |
| 映射编译：合法 output/Run 引用 | `tests/team-ir-mapping-validation.test.mjs`：`valid local schema references and required mappings pass`；`tests/team-ir-reference.test.mjs`：`parses the supported root paths and array indexes` | 部分；Run/input 与当前 output 映射静态类型检查有覆盖，完整端口投影 Runtime 未覆盖 |
| 映射编译：合法 Loop 引用 | `tests/team-ir-reference.test.mjs`：Loop 引用语法；`tests/team-ir-mapping-validation.test.mjs`：`Loop previous reference passes when the anchor dominates the reader in the Loop DAG` | 部分；受支持 DAG 子集有静态支配证明，Join 控制流、多 lineage 频次与执行期历史解析未覆盖 |
| 映射编译：未解析路径 | `tests/team-ir-mapping-validation.test.mjs`：`source path lookup rejects unknown fields and disallowed reference roots`、`missing and unknown target fields are diagnosed` | 已有静态诊断断言 |
| 映射编译：禁用根 | `tests/team-ir-mapping-validation.test.mjs`：`source path lookup rejects unknown fields and disallowed reference roots`；`Join detects duplicate providers, missing required contributions and optional conditional sources` | 部分；普通 Handoff 与 Join baseMapping 代表路径覆盖，所有根/调用点组合待补 |
| 映射编译：非法数组索引 | `tests/team-ir-reference.test.mjs`：`validates root-specific reference shapes and rejects unsupported syntax`；`tests/team-ir-mapping-validation.test.mjs`：`source path lookup rejects unknown fields and disallowed reference roots` | 部分；语法负索引/格式断言有覆盖，Schema items 越界/类型组合待补 |
| 映射编译：常量类型错误 | `tests/team-ir-mapping-validation.test.mjs`：`source optionality and simple type direction are checked against required targets` | 部分；简单类型方向覆盖，所有 `$literal` 目标组合待补 |
| 映射编译：缺必填 | `tests/team-ir-mapping-validation.test.mjs`：`missing and unknown target fields are diagnosed`、Join 对应测试 | 已有静态断言；完整诊断码/pointer 追溯仍需扩展 |
| 映射编译：类型不兼容 | `tests/team-ir-mapping-validation.test.mjs`：`source optionality and simple type direction are checked against required targets`、`artifact mappings enforce required slots and media type compatibility` | 部分；简单 JSON 类型及 Artifact media type 覆盖，组合 Schema 交给运行时校验尚未实现 |
| 映射编译：目标冲突 | `tests/team-ir-mapping-validation.test.mjs`：`Join detects duplicate providers, missing required contributions and optional conditional sources` | 已有 Join 字段重复提供者断言；普通目标冲突覆盖需补 |
| Schema 边界：`$ref` | `tests/team-ir-schema-resolver.test.mjs`：Team-local/package-relative refs、闭包 digest 与拒绝用例；`tests/team-ir-compiler.test.mjs`：`compiler snapshots referenced package Schema resources into the digest`；`tests/team-ir-payload-validation.test.mjs`：含 package refs 的 payload 校验 | 部分；Schema 闭包自动进入 digest 且 payload 校验可执行；闭包恢复拒绝矩阵待补 |
| Schema 边界：type/required/items | `tests/team-ir-mapping-validation.test.mjs`：`source optionality and simple type direction are checked against required targets`；`tests/team-ir-payload-validation.test.mjs`：`payload validator reports stable runtime diagnostic codes and JSON Pointers` | 部分；object property/type 与复杂约束有实际校验，数组 `items` 专项边界待补 |
| Schema 边界：optional source 到 required target 拒绝 | 同上 | 已有静态拒绝断言 |
| Schema 边界：复杂 Schema 运行时校验提示 | `tests/team-ir-mapping-validation.test.mjs`：`complex target constraints retain a runtime validation warning`；`tests/team-ir-payload-validation.test.mjs`：`payload validator reports stable runtime diagnostic codes and JSON Pointers` | 部分；复杂 JSON Schema 完整校验 API 已实现，尚未接入 TeamRuntime 调用路径 |
| Schema 边界：调用前校验失败 | `tests/team-ir-payload-validation.test.mjs`：`invalid mapped Agent input can be rejected before the Binding invocation`；`tests/team-ir-runtime.test.mjs`：`invalid mapped input fails before Binding invocation and invalid output fails before delivery` | 部分；无效输入不调用 Binding，输入/输出错误使 Run 进入失败收敛；Project API 路径未接入 |
| Join：精确 `handoffIds`、目标端口、游离入边 | `tests/team-ir-validation.test.mjs`：`Join requires exact incoming source and valid target ports` | 部分；游离入边和目标端口有断言；精确合法全集与多 Join 冲突组合待补 |
| Join：单边缺必填豁免 | `tests/team-ir-mapping-validation.test.mjs`：`Join single-source contribution is checked with baseMapping as one complete field union` | 已有单来源正例与 baseMapping 字段并集检查；多来源 optional/required 组合见 Join 来源行 |
| Join：条件必需来源约束 | `tests/team-ir-mapping-validation.test.mjs`：`Join detects duplicate providers, missing required contributions and optional conditional sources`、`Join required fields cannot rely on a source behind a conditional Run route`、`Join required fields cannot rely on a source Agent with no guaranteed activation path` | 部分；必达性静态拒绝已覆盖；所有 route/Loop/Join 条件组合待补 |
| Join：字段并集、重复字段拒绝 | `tests/team-ir-mapping-validation.test.mjs`：Join 重复 provider 测试；`tests/team-ir-join-runtime.test.mjs`：`all_of merges baseMapping once, preserves Artifact provenance, and omits skipped optional values`、`first contribution starts deadline, target conflicts fail closed, and unknown sources reject` | 部分；纯状态机合并/冲突已覆盖，尚未接入 Agent 调用及 Schema 校验 |
| Join：`all_of` optional skip / required skip / 零到达 | `tests/team-ir-join-runtime.test.mjs`：`all_of merges baseMapping once, preserves Artifact provenance, and omits skipped optional values`、`all_of fails when a required source skips or every source skips` | 部分；确定性状态机覆盖；上游 scheduler 何时判定全部前驱终止/可标记 skipped 尚未集成 |
| Join：`quorum_of` 早触发 / 不可达 / 迟到来源 | `tests/team-ir-mapping-validation.test.mjs`：`quorum contributions that may arrive after threshold cannot fill required target fields`；`tests/team-ir-join-runtime.test.mjs`：`quorum fires once at threshold and later source arrivals are audit-only for merged input`、`active quorum sibling failure after trigger still fails the Run`、`quorum fails immediately when pending sources cannot reach threshold` | 部分；early fire、迟到幂等、不可达和活动 sibling 失败已覆盖；需与真实并行调度接合 |
| Join：timeout 起点、恢复与迟到幂等 | `tests/team-ir-join-runtime.test.mjs`：`Join deadline starts at first predecessor activation and survives snapshot recovery`、`quorum fires once at threshold and later source arrivals are audit-only for merged input` | 部分；纯快照恢复沿用原 deadline、ready 后迟到来源不重触发；持久化 Store/进程重启未覆盖 |
| Loop：draft/revise 端口及上一轮 data/Artifact 引用 | `tests/team-ir-reference.test.mjs`：`parses the supported root paths and array indexes`；`tests/team-ir-validation.test.mjs`：`Loop declarations validate members, disjoint boundary sets and edge direction` | 部分；路径解析和 Loop 边界结构有覆盖，端口策略与 Artifact 执行未覆盖 |
| Loop：支配关系通过/拒绝、首轮历史缺失 | `tests/team-ir-mapping-validation.test.mjs`：`Loop previous reference passes when the anchor dominates the reader in the Loop DAG`、`Loop previous reference rejects a bypass path, external initialization and conditional route` | 部分；DAG 子集支配检查覆盖通过/绕过/外部初始化/条件路由；首轮实际历史读取需 Runtime 证据 |
| Loop：前轮零次/多次执行、陈旧值拒绝 | `tests/team-ir-runtime.test.mjs`：`Loop executes bounded sequential rounds and resolves only the immediately previous output`；`Loop exhaustion fails closed and finish selects a declared exit only` | 部分；单 Scope/lineage 串行路径和耗尽有覆盖；多 Scope、多 lineage、Join/并行路径与 checkpoint 恢复未覆盖 |
| Loop：耗尽与恢复 | 同上；Run Store 保存 Loop 轮数、激活预算及上一轮输出 | 部分；耗尽和声明出口有覆盖；跨进程中断恢复、历史零次/多次歧义矩阵未覆盖 |
| Runtime：本地结构化 handoff、条件 Run 入口、结果写入/收敛/冲突 | `tests/team-ir-runtime.test.mjs`：经典软件团队 `executeRun` 集成、路由/结果断言；`tests/team-ir-validation.test.mjs`：`required-result policy and parallel result writes are checked statically` | 部分；`START -> route -> fan-out -> Join -> result -> settlement` 已接通；静默收敛、显式空结果、并行竞态/原子提交与活动分支全收敛仍缺运行时证据 |
| Runtime：Artifact 来源、越权拒绝、受控登记 | `tests/team-ir-artifact-store.test.mjs`：登记、调用方授权、invocation allowlist、完整性；mapping 测试覆盖 media/slot | 部分；独立 Store 合同通过；尚未接 TeamRuntime Handoff 投影/Agent 只读 Resolver/结果槽位、所有者持久授权 |
| Runtime：无效输入失败关闭 | `tests/team-ir-payload-validation.test.mjs`：调用 Binding 前拒绝；`tests/team-ir-runtime.test.mjs`：`invalid mapped input fails before Binding invocation and invalid output fails before delivery` | 部分；Runtime 本地执行路径有证明；Project Task executor 仅拒绝当前不能满足的 Run 输入合同，生产 executor/resolver 未接线 |
| Runtime：Review 暂停/批准/拒绝/反馈/timeout/预算冻结 | `tests/team-ir-review-runtime.test.mjs`：授权、revision、approve/reject 幂等、feedback 校验、独立 deadline 与取消 | 部分；独立 reducer/store 合同通过；尚未接 scheduler 暂停/恢复、sibling 收敛、活跃预算冻结、生产 API/浏览器审核 |
| Runtime：deadline、Binding 重试耗尽、错误归属、取消、checkpoint replay | `tests/team-ir-runtime.test.mjs`：`Runtime persists invocation, retries transport failure and completes once`、`timeout starts failure intent; cancellation and failure settle only their winning intent`、`unconfirmed timeout cancellation records unknown outcome and does not retry` | 部分；单调用生命周期及失败/取消竞态有覆盖；并行 sibling 失败收敛、持久 scheduler replay 和所有中断点未覆盖 |
| Runtime：生产 Project Task v2 执行 | `apps/team-site/tests/team-ir-project-run-executor.test.mjs`：冻结 digest、sandbox mode、输入合同、状态目录 symlink 与 query store 重读 | 部分；确定性 fake executor 垂直切片通过；生产 `server.mjs` 未注入 v2 executor 和可信 resolver，真实 Task 仍 fail closed |
| A2A：Agent Card、Task 状态、Message Parts/Artifact、deadline、幂等 | `tests/team-ir-a2a-binding.test.mjs`：pin Agent Card、媒体/输入映射、Task 状态、幂等 key、取消不确定结果 | 部分；纯 Adapter 合同有覆盖；输出 Artifact 反序列化、持久幂等缓存、deadline 和实际远程 client 未覆盖 |
| A2A：`input-required` 暂停、请求暴露、不可 Resume、取消/新 Run、completed/failed/canceled | 同上：`input-required` 数据与取消 Adapter 合同 | 部分；Adapter 返回形状通过；TeamRuntime 持久暂停、兄弟调用收敛、查询/取消 API 和另起 Run 尚无证据 |
| Studio：连线/自动映射/缺项定位/Handoff/Join/Loop 编辑/发布诊断 | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：基础 IR 保存/重开与旧 API 409；`apps/team-site/tests/team-ir-use-cases.test.mjs`：服务端校验/保存 | 部分；当前页面只支持基础 Agent/端口/Handoff 表单和有限条件；无画布连线、自动映射、缺项定位、Join/Loop/高级 Schema 编辑、simulation 或发布流程 |
| Studio：窄屏、保存重开、digest | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：真实 Playwright 草稿、校验/保存/重开、semanticDigest、390px 无横溢 | 部分；仅基础流程，未覆盖关闭后再次打开、已发布只读、条件诊断 UX、模拟和发布 |
| 数据边界：旧配置拒绝及重建提示 | `apps/team-site/tests/team-api-routes.test.mjs`：legacy design endpoints reject v2 documents；`apps/team-site/tests/team-ir-use-cases.test.mjs` / lifecycle tests：缺少 IR 的读取/发布拒绝 | 部分；API fail closed 有覆盖；旧 Team Studio 页面重建提示与 create/read/save/validate/release/mount/task/run/history 全矩阵未覆盖 |
| 数据边界：创建/发布不改 `.ogs/runs/`、无迁移副作用 | executor 和 query store 有路径/symlink 检查；`apps/team-site/tests/team-ir-project-run-executor.test.mjs` 重建 query store 后读取证据 | 部分；Run state 路径保护与重读有覆盖；IR 创建/发布前后 sentinel/hash 不变、Team 定义改变后历史证据保持可读的副作用测试未覆盖 |
| 发布：活动模板/示例/文档/默认入口为 v2 | `examples/team-ir-v2/classic-software-team.json` 为 v2 示例 | 未覆盖；Team Site `/studio/new`、草稿续编和内置经典 cases 仍走旧 `/design`/Mermaid materializer；通用 CLI System 示例需先明确排除范围 |
| 发布：Compiler/API/Runtime/Team Site/浏览器验收 | Team IR 聚焦测试、Team Site IR API/Project executor 测试及一项 v2 Studio browser 测试 | 部分；各自垂直切片存在；没有生产 closure/evidence/Binding 注入下的端到端发布与 Project Task 真实运行 |
| 发布：`git diff --check` | 每次变更后运行并记录 | 工程卫生检查，不替代任何语义覆盖 |

**阶段 1 尚缺的静态覆盖：** 全部阻断诊断的稳定 code/pointer fixture 穷举、Join 控制流/多 lineage 下的 Loop dominance 与历史引用可达性、复杂 JSON Schema 的静态赋值推理、角色包/Binding 执行策略闭包变化矩阵。普通结果目标完整字段/冲突、Join 单边豁免与字段并集、`$literal`/数组边界已有代表性正反例。复杂 Schema validator API 和 Runtime 调用前校验已有测试，但 Project Task production 执行链未接入。Schema resource 闭包已进入 `CompiledTeamPlan` digest 并有包内引用变更测试。动态状态机与 API/Studio/真实 Sandbox UAT 归后续阶段，不计作阶段 1 静态覆盖。

追溯矩阵至少明确覆盖以下 v2 语义族，且以设计方案第 10 节的完整条目为准，不限于下列摘要：

| v2 语义族 | 必须可追溯的新增/关键行为 | 主要证明方式 |
| --- | --- | --- |
| IR、Schema 与诊断 | v2 根合同、端点/端口/Binding、Schema 引用、输入/结果及执行策略；引用解析、缺失与 `null` 区分、类型方向、必填唯一提供方、复杂 Schema 的运行时校验提示及稳定诊断 | 正反例 fixtures、诊断码与 JSON Pointer 断言、调用前校验测试 |
| 显式映射与 Artifact | 不隐式透传；允许/禁止引用根、数组索引和 `$literal`；端口投影、媒体类型/槽位、受控登记、来源保留、调用范围 Artifact 白名单及越权拒绝 | Parser/Compiler/Runtime 合同测试、安全测试 |
| 路由与 Handoff | Run `START` 路由、`exclusive_priority` 优先级唯一、`parallel_fanout` 静态集合、`onNoMatch`、条件跳过、总 deadline、Binding 单一重试所有者、错误归属与失败关闭 | 路由表 fixtures、Fake Binding 状态机与失败注入 |
| Join 新语义 | 精确来源集合、目标端口无游离边、互斥字段槽位、一次性 `baseMapping`、条件来源 required/optional 约束；`pending/arrived/skipped`、`all_of` 零到达/必需跳过、`quorum_of` 早触发/不可达/迟到来源、活动分支故障、超时恢复不重置 | 编译正反例、确定性 Join 状态机、checkpoint 恢复测试 |
| Loop 与历史引用 | `draft`/`revise` 端口、同 Scope/lineage 紧邻上一轮唯一成功执行、Loop 内初始化、dominance 通过/失败、零次/多次执行拒绝、不得回退旧值、预算/耗尽及恢复 | 展开控制流图编译 fixtures、多轮确定性运行及中断恢复 |
| 结果与终态 | 每条结果边独立满足完整合同、原子唯一写入、并行冲突拒绝、`required`/`allow_empty`、`finish` 不等于 Run 完成、活动分支收敛和缺结果失败 | 静态冲突测试、Runtime 写入次数/终态断言、并发测试 |
| Review 控制面 | 路由前暂停、授权身份、approve/reject、反馈 Schema、reject 反馈必需、返工 Loop、审核 timeout 持久化且失败关闭、活跃预算冻结、下游 deadline 尚未启动 | API/权限测试、Fake Clock Runtime 测试、浏览器审核和恢复流程 |
| 状态、恢复与 digest | checkpoint 幂等、审计追加、恢复前闭包重算；Schema、角色包、Binding 策略、编译语义/Adapter 变化导致 digest 不匹配时拒绝续跑；历史 Run 隔离 | 中断点注入、重启进程/API 读取、digest 变更矩阵 |
| A2A 边界 | Agent Card/能力摘要、Message Parts/Artifact 映射、Task 状态和幂等；`input-required` 保存请求、暂停但不可 Resume、可取消、改输入后新 Run | Fake A2A 合同测试、状态/审计/API 测试；真实远端仅在有兼容服务时追加 |
| Studio、发布与断代 | Studio/服务端诊断和 digest 一致、保存重开、Handoff/Join/Loop 编辑、发布阻断；旧配置拒绝且不迁移/覆盖，历史 `.ogs/runs/` 保持只读，示例与默认入口为 v2 | API/浏览器测试、旧配置兼容矩阵、文件副作用断言 |

以下为阶段 2–4 的原子验收状态补充；状态不由上面的语义族描述推定，只有右列列出的证据才算覆盖：

| 原子语义 / 产品边界 | 当前证据 | 状态与未完成项 |
| --- | --- | --- |
| 结果 Handoff 的每条边独立满足完整 data/Artifact 合同；并行冲突静态拒绝 | `tests/team-ir-mapping-validation.test.mjs`：结果字段完整性、类型和冲突测试；`tests/team-ir-validation.test.mjs`：required-result policy/并行写入静态测试；`tests/team-ir-runtime.test.mjs`：Artifact output slot 登记和结果只保留 opaque reference | 映射与 Artifact output ref 通过；Result 整体原子唯一提交和 commit 中断恢复仍无覆盖 |
| `required`、`allow_empty`、`finish`、活动工作收敛及缺结果终态 | Runtime 测试覆盖 `finish` 仅选声明出口、`executeRun` 经典路径与失败收敛 | 部分；显式空结果策略、静默收敛与活动分支竞争没有独立断言 |
| `all_of`/`quorum_of` 后 Join 输入只生成一次，迟到来源仅审计，活动 sibling 失败仍使 Run 失败 | `tests/team-ir-join-runtime.test.mjs` 中 ready/late、quorum sibling failure 测试 | Join reducer 通过；尚未有同一 TeamRuntime 并行 scheduler 集成/持久恢复证据 |
| optional 条件来源按所有前驱终止状态标记 `skipped`；required 缺席失败 | mapping validation 和 Join reducer 的 optional/required skip 测试 | 静态/状态机部分通过；scheduler 尚未把分支路由和 `pending/arrived/skipped` 完整接合 |
| Loop 紧邻前轮唯一成功执行、同 lineage/Scope，零次/多次/陈旧历史拒绝 | Loop 单 Scope/lineage 串行 Runtime 测试覆盖 bounded rounds 和 immediately-previous output | 部分；多 lineage/Join/并行/嵌套 Scope 与进程重启 checkpoint 恢复待做 |
| Review 在下游 route 前暂停；授权决定、reject feedback、独立 timeout、等待不耗 active budget，决定后 sibling 收敛 | `tests/team-ir-review-runtime.test.mjs` 覆盖授权、revision、幂等、feedback、timeout、cancel | reducer 合同通过；与 TeamRuntime 调度、预算计时、下游 Handoff deadline、API/浏览器及持久恢复未接合 |
| A2A `completed`/`failed`/`canceled`/`input-required`、Artifact Parts、deadline、幂等及输入请求审计 | `tests/team-ir-a2a-binding.test.mjs` 覆盖 adapter 状态；`tests/team-ir-runtime.test.mjs` 覆盖 `paused_input_required`、拒绝同 Run 续跑和 sibling 收敛；`apps/team-site/tests/team-ir-project-run-executor.test.mjs` 覆盖持久 query 的 owner-scoped pendingInput、无成功结果及事件不含请求正文 | adapter + scheduler 切片通过；具体远端 HTTP client/持久远端幂等缓存、用户取消/control API、新输入 Run 的公开产品流程及跨进程恢复时活动 sibling 收敛待做 |
| 首个失败、取消、Review 决定、A2A input-required 通过 revision/CAS 线性化；晚到响应不可提交下游副作用 | `tests/team-ir-runtime.test.mjs` 覆盖单调用 failure/cancel intent winner 和 A2A input-required sibling cancellation/late sibling audit；Review reducer 有 revision token 测试 | 部分；Review 与终态、Result/Artifact 提交竞态及跨重启线性化无集成故障注入 |
| Runtime checkpoint replay 不重复 Binding 副作用、Result/Artifact 登记；恢复重算冻结闭包，不匹配即拒绝 | File Run Store/Runtime 单测覆盖记录持久化、digest 和局部恢复检查 | 部分；完整 scheduler 意图/提交检查点、真实进程重启和全依赖漂移矩阵未覆盖 |
| 历史 Run 绑定原 Team/Plan snapshot，当前 Team IR 改动/缺失不改历史查询；创建/发布不得写 `.ogs/runs/` | executor 测试重建新 query store 后读取状态、事件、结果；Run path/symlink 防护测试 | 部分；Team IR 前后 Run 树 sentinel/hash 不变、IR 变更/删除后历史查询、终态只读 API 无覆盖 |
| Studio 画布事件桩连线、自动映射、缺项定位、Handoff/Join/Loop 编辑、诊断 code/pointer 一致 | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：schema-driven 高级合同 JSON 编辑，完整 Join/Loop/Review/routes、Run contract、Agent port/Artifact slot、Handoff Artifact mapping、A2A Binding 往返；无效 Review timeout 返回 code/pointer 且不触发 PUT；保存重开 digest 一致、legacy API 409、390px 无横溢 | 部分；高级合同可编辑/往返；尚无事件桩画布、自动映射、逐字段可视化编辑与缺项定位 UX |
| Studio v2 Simulation 独立于 Project Task/旧 Mermaid simulation，保存 simulation evidence 但不写 `.ogs/runs/` | 无 v2 Studio Simulation API/浏览器链路 | 未覆盖；旧 Studio Simulation 不作为替代证据 |
| TeamVersion v2 readiness/release 成功和失败路径，发布后只读/重开，冻结完整依赖及专用 Sandbox 证据 | IR lifecycle/use case 测试覆盖 fail closed、digest freeze；基础浏览器只验保存重开 | 部分；服务端 production closure/evidence resolver 未注入，故无可信发布成功路径和 release browser 验收 |
| legacy create/read/save/validate/release/mount/task/run/history 兼容矩阵；拒绝旧定义不迁移、不覆盖；旧页面给重建提示 | Team API v2 payload 对旧 design 入口 409、legacy Team 无 IR 发布/Task 拒绝测试 | 部分；旧 `/design` 仍保留 legacy 写入；浏览器重建提示与全入口矩阵/文件哈希证明待做 |
| 默认作者入口、经典活动模板与活动示例切到 Team IR v2；通用 standalone System 示例明确范围 | 新增 `examples/team-ir-v2/classic-software-team.json` | 未完成；`/studio/new`/草稿续编仍到 `/design`，Team Site classic cases 仍由 Mermaid materializer 生成；需明确通用 CLI 示例是否排除 |
| Team Site production Project Task v2 真实 Sandbox 执行、Run query/retry/control/recovery | `apps/team-site/tests/team-ir-project-run-executor.test.mjs`、`apps/team-site/tests/task-run-runtime-failure.test.mjs` 和 `apps/team-site/tests/file-task-retry-store.test.mjs`；另有 Runtime A2A input-required 的 owner-scoped pending input query 集成 | 部分；`server.mjs` 已注入正式 executor，但 trusted closure/evidence/Binding resolver 未配置，生产仍 fail closed；v2 附件没有冻结重试快照合同并会拒绝重试；TeamRuntime user cancel/control、跨重启暂停恢复和 sibling 收敛仍未接完 |
| 经典团队真实 Sandbox UAT：经 Studio、发布、挂载、Task 启动，成功与失败/重试，重启后查询 | 本地 classic Team IR fixture + Fake Binding 集成测试 | 未运行/受外部条件阻塞；`codex login status` 为未登录、OpenCode credential 数为 0，生产 closure、release evidence、Binding resolver 未配置；Fake、旧 Mermaid 或 dry-run 均不计 |

确定性 Fake Binding、Fake Clock 和故障注入是精确语义断言的权威证据；真实 Sandbox 运行验证组合后的执行链在真实 Binding、运行环境和持久化路径中可用，不替代上述语义覆盖矩阵。真实模型输出采用人工检查清单或不依赖逐字一致的业务断言；不得以快照文本稳定性作为路由、Join、结果唯一性或恢复正确性的证明。

经典团队真实运行须使用 v2 原生 IR 和隔离数据根，不得把旧 Mermaid/System 运行、旧版经典团队的历史证据或 Studio `dry-run` 计作 v2 真实运行。至少保存一次通过运行和一次有解释的失败/重试证据；失败路径可由受控 Binding 超时或可复现故障触发，须验证失败 Run 可查询、重试生成新尝试且已提交副作用不重复。记录运行日期、OS/Node、Sandbox/Binding 与模型语义标识、脱敏后的输入、digest、Run/Task 关联、各角色/Join/结果状态、Artifact 摘要、重启后查询、人工检查结论及未覆盖项；不得记录凭据值。人工审核、A2A `input-required`、旧配置拒绝等需专门场景验证，不因经典团队真实运行通过而推定通过。

## 5. 落地与验证记录

阶段验收按日期追加，不覆盖旧的验证历史：

### 2026-10-28：阶段 0 完成、阶段 1 部分通过与阶段 2 起步

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 0 设计冻结 | 通过 | 设计审计决策已写入 `team-ir-handoff-v2-design.md`；ADR 状态更新为本次落地任务基线 | 随实现发现的合同缺口须回到设计评审，不可静默改变语义 |
| 阶段 0 语义复核 | 通过 | 独立复核确认条件 AST、Loop 耗尽、Binding 重试和 attempt timeout、Handoff/Join/Review deadline、Artifact 授权、Run 结果/失败/取消竞态、多 Review 状态和 A2A input-required 兄弟分支收敛规则已明确；路由 priority 数值顺序为小值优先，修订见设计 §6.1、§6.5、§7.0–7.2 | 实现须由阶段 1–4 的逐项测试证明，不得推定已实现 |
| 阶段 1 根 Schema / 解析 | 部分通过 | `schemas/team-ir-v2.schema.json`、`src/team-ir/schema.ts`、`src/team-ir/types.ts`；2026-10-28 聚焦验证 `pnpm build && node --test tests/team-ir-*.test.mjs && git diff --check` 通过，114/114 | 完整规范正反例与全部阻断诊断追溯未完成 |
| 阶段 1 引用表达式 / Schema resolver | 进行中 | `src/team-ir/reference.ts`、`src/team-ir/schema-resolver.ts`；引用条件、局部/包内引用、安全拒绝测试通过 | 完成静态 Schema 路径/类型检查接合 |
| 阶段 1 交叉引用与 digest | 部分通过 | `src/team-ir/validate.ts`、`src/team-ir/canonical.ts`、`src/team-ir/compiler.ts`；route/Join/Loop/Review 引用、canonical snapshot 与依赖摘要变化测试通过 | schema 闭包自动捕获/恢复拒绝和角色包、Binding 策略真实闭包验证仍待阶段 2 |
| 阶段 1 映射静态校验 | 部分通过 | `src/team-ir/mapping-validation.ts`、`src/team-ir/payload-validation.ts`；引用作用域、必填/类型、Artifact 槽位、条件来源、保守 Join 必达性、DAG 子集 Loop dominance、Join 单来源必填豁免、结果目标校验、`$literal`/数组边界及完整 payload Schema 校验均有聚焦测试 | 完整诊断 code/pointer 矩阵、多 lineage/Join 控制流下 Loop dominance 和复杂 JSON Schema 静态赋值推理仍待完成 |
| 阶段 2 编译器、Runtime 与 Join 初稿 | 进行中 | `src/team-ir/compiler.ts`、`src/team-ir/runtime.ts`、`src/team-ir/join-runtime.ts`；经典团队 fan-out/Join/result、单 lineage Loop、Review reducer、A2A adapter 和 Artifact 合同均有各自确定性聚焦测试。统一 Team IR 聚焦回归 114/114 | Review/A2A/Artifact 尚未接 TeamRuntime scheduler/持久控制面；Loop 多 lineage/Join/并行/恢复、调度持久恢复、条件 optional Join 来源尚缺 |

**运行环境：** macOS，Node 项目要求 `>=20`，pnpm `10.33.2`；使用本地确定性测试，无外部服务。
**变更范围：** 设计、ADR、Schema、Team IR 类型/解析/引用/digest 与聚焦测试。
**未覆盖与风险：** 完整阶段 1 静态验证、Compiler/Runtime、Studio/API、真实 Sandbox UAT、完整回归均未完成。
**阶段结论：** 阶段 0 通过；阶段 1 部分通过；阶段 2 进行中。真实 Sandbox UAT、Studio/API、完整回归与提交尚未完成。

### 2026-10-28：阶段 1 静态映射补充、Team IR API 与调度接线进行中

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1–2 Team IR 聚焦回归 | 通过 | `pnpm build && node --test tests/team-ir-*.test.mjs && git diff --check`，114/114；Run 创建审计事件只保留 `compiledPlanDigest`，不复制 task/input；Artifact ID 使用随机不透明标识 | 完整诊断码/JSON Pointer 矩阵、Runtime/API 接线及其余阶段语义仍需覆盖 |
| 阶段 1 Join/结果映射静态语义 | 部分通过 | `src/team-ir/mapping-validation.ts`、`src/team-ir/validate.ts`；`pnpm build && node --test tests/team-ir-schema.test.mjs tests/team-ir-validation.test.mjs tests/team-ir-mapping-validation.test.mjs && git diff --check` 通过，37/37；覆盖 Join 单来源豁免、baseMapping 必填并集、结果 Handoff 完整字段/类型、`$literal` 递归、`items/prefixItems` 边界、结果并发冲突与 fallback 优先级 | 全部阻断诊断 code/pointer 穷举、多 lineage/Join 控制流 Loop dominance、复杂 JSON Schema 赋值推理仍未覆盖 |
| Team Site 独立 IR API / 发布冻结 | 部分通过 | 独立 IR 保存/读取/校验、旧 `/design` 拒绝；TeamVersion release 要求完整依赖闭包和专用 v2 Sandbox 证据，semantic/compiled digest 冻结并贯穿 mount/Task；发布/挂载/Task 聚焦测试 66/66 | 生产未配置 closure resolver、v2 Sandbox 证据端口和 Binding resolver，readiness/release/Task execution fail closed；真实 UAT 未完成 |
| Studio v2 保存与重开 | 部分通过 | `apps/team-site/tests/team-ir-studio-browser.test.mjs` 真实 Playwright 浏览器验收 1/1：草稿、Agent/port、Handoff 显式映射、高级 Join/Loop/Review/routes、Run contract、Artifact slots/mappings、A2A Binding JSON round-trip；错误 code/pointer 阻止保存、保存重开 digest、390px 无横溢、legacy API 409 | 仍为 schema-driven JSON 合同编辑，缺事件桩画布、自动映射、逐字段诊断定位；未接 Studio Simulation 与发布按钮；不是阶段 3 全语义通过 |
| Project Task v2 Run Store / Query 切片 | 部分通过 | `apps/team-site/infrastructure/runtime-team-ir-project-run-executor.mjs` 核验 frozen digest、强制 sandbox mode、校验输入能力、拒绝状态目录 symlink；注入 Fake Binding 集成并用新 query store 实例重读持久状态/事件/结果；production 组合根现已注入 executor，另有隔离 HTTP 测试验证无 resolver 时预留 Run 前拒绝且无 Run evidence | production closure/Binding resolver 缺失时 fail closed；生产控制、取消、暂停、恢复和真实 Sandbox 未接完成 |
| TeamRuntime 调度与 Join 接线 | 部分通过 | `src/team-ir/runtime.ts` 的 `executeRun` 接通 `START -> route -> fan-out -> Join -> result -> settlement`；经典软件团队 fixture 集成测试通过。Loop 单 scope/lineage 串行子集和测试恢复拒绝规则也已加入；统一聚焦命令 `pnpm build && node --test tests/team-ir-*.test.mjs && git diff --check` 通过，101/101 | 条件 optional Join 来源、Loop Join/并行/恢复、Review 控制面接线、A2A sibling 收敛、Artifact 接线、持久调度恢复和 Project Task 集成未完成；不代表阶段 2 通过 |
| Loop Runtime | 部分通过 | `Loop executes bounded sequential rounds and resolves only the immediately previous output`、`Loop exhaustion fails closed and finish selects a declared exit only`；Run Store 保存 Loop 轮次、激活预算和上一轮输出；运行时优先级已修正为小数值优先。`pnpm build && node --test tests/team-ir-runtime.test.mjs && git diff --check`，11/11 | 单 Scope/单 lineage/串行子集；Loop Join、并行分支、嵌套/多 Scope、多锚点零/多次运行时拒绝与 checkpoint 恢复未完成 |
| Artifact Store 安全合同 | 部分通过 | `src/team-ir/artifact-store.ts`、`tests/team-ir-artifact-store.test.mjs` 覆盖 opaque ID、媒体类型、Run input 授权、Project/Run 所有权、跨实例 blob/metadata/grant 持久化、invocation allowlist 与完整性；`tests/team-ir-runtime.test.mjs` 覆盖 Handoff 投影、Agent resolver、output 登记和 Run result 引用 | Production Workspace 授权接线、结果引用公开 API、scheduler replay 不重复登记仍未完成 |
| A2A Binding Adapter 合同 | 部分通过 | `src/team-ir/a2a-binding.ts`、`tests/team-ir-a2a-binding.test.mjs`，聚焦验证 `pnpm build && node --test tests/team-ir-a2a-binding.test.mjs && git diff --check` 通过，7/7；覆盖 pin Agent Card 版本/媒体模式、JSON/授权 Artifact 输入映射、Task 状态、幂等键、input-required 信息及取消不确定结果 | 尚无具体网络/SDK client；输出 Artifact Parts 反序列化、持久幂等缓存、TeamRuntime sibling 调用暂停/取消收敛、A2A API 只读/取消接口未完成 |
| Review 控制面状态机 | 部分通过 | `src/team-ir/review-runtime.ts`、`tests/team-ir-review-runtime.test.mjs`，`pnpm build && node --test tests/team-ir-review-runtime.test.mjs && git diff --check`，6/6；覆盖多个 Review lineage/round、授权、revision token、approve/reject 幂等、feedback Schema/reject required、deadline timeout 和取消 | 未接 TeamRuntime route 前暂停/恢复、scheduler sibling 收敛、生产持久化/API/浏览器审核；预算冻结和下游 deadline 尚无跨 Runtime 集成证据 |

**运行环境：** macOS，Node 项目要求 `>=20`，pnpm `10.33.2`；确定性本地 Fake Binding，无外部服务。
**变更范围：** Team IR 静态映射、Runtime 调度、TeamVersion 独立 IR API。
**未覆盖与风险：** 旧记录中的 114/101 是当时的历史测试数量；当前 core Team IR 定向回归 107/107。聚焦测试不代表全语义覆盖；Review/A2A/Artifact 尚未全部接入调度，API 保存的 IR 尚未经过 production 完整依赖闭包和 v2 Sandbox 发布证明，不能据此进行真实 UAT。
**阶段结论：** 阶段 1 部分通过；阶段 2、3 进行中；阶段 4 未开始。真实 Sandbox UAT、完整仓库回归与提交尚未完成。

**真实 Sandbox UAT 前置检查：** `codex login status` 返回 `Not logged in`；`opencode auth list` 显示 0 credentials；Team Site 已接入执行器，但生产配置未提供可信 Team IR release closure resolver、v2 Sandbox 证据验证器或 v2 Project Task Binding resolver。未发起模型请求。只有本地 deterministic Fake Binding 证据，不是经典团队真实运行；解除条件为完成上述可信 resolver 接线并配置已登录的真实 Sandbox 模型/Binding。

### 2026-10-28：全量回归修复与当前阶段复核

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| Team Site 全量回归 | 通过 | `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot`，退出码 0；串行 suite 全部完成 | 生产 v2 resolver 接线与真实 Sandbox UAT 未覆盖 |
| 全仓构建与回归 | 通过 | `pnpm test`，build 成功；809 tests，808 pass、0 fail、1 skip（仅 Windows PowerShell/CMD 专项在 macOS 跳过） | 该回归不替代真实 Sandbox UAT 或未实现的 v2 语义集成 |
| Team IR 包导入与定义 digest | 通过（窄合同） | `apps/team-site/tests/product-capability-regression.test.mjs`：`project-v2 imports multiple nested released teams into a clean workspace transaction`；导入保留 Team IR semantic/compiled/compiler digest，定义摘要使用稳定 source TeamVersion 身份 | 需补 reuse 与 create-new 的重开 Store 持久化断言矩阵 |
| 失败 Run 重试和结果脱敏 | 通过（窄合同） | `apps/team-site/tests/domain-contract-regression.test.mjs`：`retrying a collaboration Task creates a new immutable Run attempt`、`a reserved Task with a missing Run state can be retried after recovery`；legacy adapter 仅在 `RUN_NOT_FOUND` 时交给 legacy store 复核；v2 `teamResult` 由结果查询返回并脱敏 | 附件冻结重试快照合同和生产控制/恢复接线仍未完成 |
| Project Task 确定性运行 | 通过（本地测试合同） | `apps/team-site/tests/project-store.test.mjs`：`v2 Collaboration Tasks execute their bound TeamVersion through the deterministic Runtime`；查询新读 Run owner/state/plan 并核验 frozen digest | Fake Binding 不等于 production executor 或真实 Sandbox |
| 阶段 1 静态覆盖 | 部分通过 | Team IR 语义矩阵已有 Schema、引用、映射、条件、Join、Loop dominance 子集、Review/Artifact/A2A adapter 测试；全仓回归通过 | 全阻断诊断 code/pointer 矩阵、复杂静态赋值推理、多 lineage/Join 下 Loop dominance 和恢复仍缺 |
| 阶段 2 Runtime 集成 | 部分通过 | TeamRuntime 经典 fan-out/Join/result、单 lineage Loop；A2A `input-required` pause/query/sibling cancel/new Run boundary 已接 scheduler；独立 Review reducer、Artifact store 有确定性测试 | Review scheduler/API、Artifact scheduler/project ownership/Handoff projection、Loop 并行/Join/恢复、Run result 原子提交/恢复和完整 scheduler checkpoint replay 未完成 |
| 阶段 3 Studio / 发布 | 进行中 | `node --test apps/team-site/tests/team-ir-studio-browser.test.mjs` 1/1：高级语义 JSON round-trip、服务端诊断阻止保存、digest、legacy API 和窄屏；Team IR API lifecycle 有 fail-closed 合同 | 事件桩画布、逐字段编辑体验、Simulation、可信 release resolver 与完整发布成功流程待完成 |
| 阶段 4 切换 / 清理 | 未开始 | 旧 Team 发布入口 fail closed；旧 API 拒绝 v2 文档 | 默认入口/模板/活动示例切换、全旧配置兼容矩阵与历史 Run 只读验收未完成 |
| 经典团队真实 Sandbox UAT | 受阻 / 未运行 | 已复查 `codex login status` = `Not logged in`、`opencode auth list` = 0 credentials；`server.mjs` 已注入 Team IR executor，但无可信 closure/evidence/Binding resolver；未发起模型请求 | 需完成 production resolver 接线，并配置已登录的真实 Sandbox Binding；随后经 Studio 发布、Project 挂载、成功运行、受控失败/重试、重启查询与人工结果审核 |

**阶段结论：** 阶段 0 通过；阶段 1 部分通过；阶段 2 部分通过；阶段 3 进行中；阶段 4 未开始。全仓确定性回归已通过，但设计方案第 10 节仍有多项无覆盖集成语义，且真实 UAT 受阻；不得宣称全部阶段完成。

### YYYY-MM-DD：阶段 / 任务标识

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 示例 | 进行中 / 通过 / 失败 / 未运行 / 跳过 / 受阻 | 源码路径、测试路径、命令与退出结果 | 具体未完成项或无 |

**运行环境：** Node/pnpm 版本、OS、必要服务或配置。  
**变更范围：** 代码、Schema、Studio、API、示例和文档。  
**未覆盖与风险：** 写明未运行的验证及其影响；没有则写“无已知未覆盖项”。  
**阶段结论：** 仅当该阶段所有必需门槛均通过时写“通过”；否则写“部分通过”或“受阻”。

## 6. Codex / 实施代理工作约定

为减少中途停留后丢失进度，每次委派或启动实施都应引用本文件和目标阶段，并要求：

1. 开始时读取当前阶段、未完成验收项和仓库状态；先报告范围、依赖与可独立完成的工作。
2. 按一个可审查的阶段或垂直切片推进；每完成一项立即更新状态和证据，不把未做事项整体留到最后。
3. 遇到失败先诊断并继续修复；遇到外部阻塞时记录具体阻塞和已完成工作，不把阻塞表述为完成，也不丢弃可独立推进的部分。
4. 结束前重新读取台账，运行本次范围所需验证和 `git diff --check`，核对代码、测试、文档一致。
5. 只有验收矩阵全部通过、证据已记录、无必需工作遗漏时，才把阶段状态改为“通过”。最终回复列出完成项、命令及结果、未完成项和阻塞。

工具或会话中断后，恢复工作必须从本台账的最后一个未完成项继续，不重复宣称已完成，也不因单次测试失败结束整个阶段。

这些约定能让进度可恢复、完成状态可审计，但不能消除外部服务中断、权限变化或用户取消等运行条件。发生此类情况时应留下状态和续作入口，而不是伪报通过。

### 建议的实施指令

每次启动一个阶段时，把阶段编号和范围填入下面的指令，并要求实施代理实际修改、验证和更新台账，而不是只提供计划：

```text
继续 Team IR v2 落地，依据
docs/development/team-ir-handoff-v2-design.md 和
docs/development/team-ir-v2-implementation-and-verification.md。

本次目标：完成阶段 <编号> 中 <明确范围>。
请先检查工作区和台账，从当前未完成项继续；然后直接实施，不要停留在方案建议。
持续推进到本次范围的验收项全部通过。失败时先定位和修复，再重跑相关验证。
同步更新台账中的状态、源码/测试证据、精确命令和未覆盖项。
若遇到确实无法自行解除的外部阻塞，完成所有不依赖该阻塞的工作，记录阻塞及续作入口。
只有验收门槛全部满足才标记通过；最后报告通过项、验证结果、未完成项和阻塞。
```

## 7. 发布完成定义

只有同时满足以下条件，才可将 Team IR v2 标为“落地并验证通过”：

- 设计批准状态明确，规范版本和语义变更记录齐全。
- 阶段 1–4 的完成标准全部通过；设计方案第 10 节所有适用验收项有对应证据或经批准的明确排除项。
- Schema、Compiler、Runtime、Studio、API、A2A、旧配置拒绝、历史 Run 隔离和发布矩阵均有自动化或场景级证据。
- 代表性社会协作场景通过端到端验证，产品文档清楚区分设计能力、已实现能力和首版边界。
- 完整回归和发布检查通过；未覆盖范围与已知风险有负责人和后续处理方式。
- 台账、设计文档、ADR、使用文档、示例和实际实现保持一致。

“代码已合并”“主要测试通过”“示例能跑”或“本轮没有报错”均不足以单独满足发布完成定义。
