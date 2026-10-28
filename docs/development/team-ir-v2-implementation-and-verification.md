# Team IR v2 落地与验证台账

基线日期：2026-10-28  
状态：实施中；阶段 0 已冻结，阶段 1、2 部分通过（仍在推进），阶段 3、4 进行中
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
| Studio v2 作者体验 | 进行中 | 已有独立 `/ir` 作者页、Playwright 保存/重开、advanced IR round-trip、Fake resolver Simulation/发布和窄屏证据；事件桩画布、自动映射、逐字段诊断定位、生产 resolver/UAT 与默认入口仍未完成 |
| v2 端到端或发布验收 | 部分通过 | 有确定性经典 Team IR fixture 和 Fake Binding Runtime 集成；无可信 production closure/evidence/Binding resolver 或真实 Sandbox UAT |

## 3. 实施与验收状态

每个阶段按设计方案第 9 节实施，按第 10 节验收。下表是推进索引；通过前须把具体证据补到第 5 节的日期记录中。

| 阶段 | 主要交付 | 必须通过的门槛 | 状态 |
| --- | --- | --- | --- |
| 0. 设计冻结 | 批准根 Schema、术语、ADR 和版本兼容策略 | 设计评审清单无未决语义冲突；规范示例和运行/API 规则一致；审批状态明确 | 通过 |
| 1. Team IR 包 | `src/team-ir/` 类型、Schema、解析器、引用解析、静态校验、诊断、规范化和 digest | 正例/反例 fixtures 覆盖设计方案全部阻断诊断；路径作用域与受支持 JSON Schema 子集明确 | 部分通过 |
| 2. Compiler / Runtime | `CompiledTeamPlan`、端口投影、Handoff、Join、Loop、审核、错误、Artifact、Checkpoint 和恢复 | 顺序、条件路由、fan-out、Join、Loop、结果、失败、恢复和 A2A 合同测试通过；不经旧编译器语义路径 | 部分通过（进行中） |
| 3. Studio / 发布 | Team IR 作者模型、预检、编辑、模拟、发布、读取与重开 | Studio 与服务端诊断和语义 digest 一致；浏览器验收覆盖核心作者流程和窄屏 | 进行中 |
| 4. 切换与清理 | CLI/API/Studio 默认入口、模板、示例、文档和旧配置拒绝行为 | 版本兼容矩阵通过；历史 Run 只读；活动示例均为 v2；无意外迁移或覆盖 | 进行中；默认切换仍关闭 |

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

### 本地 Team IR v2 Resolver 配置

Team Site 通过 `OGS_TEAM_IR_V2_RESOLVER_MODULE` 加载本地可信 ES module；必须使用绝对路径，并导出 `resolveTeamIrReleaseClosure({ team, teamIR })` 与 `resolveBindings({ team, teamIR, closure, project?, runId?, simulationId?, mode })`。依赖闭包需返回 `complete: true`、每个 package/binding 引用的 SHA-256 digest、每种 Binding adapter 的固定版本；可选返回 Schema digest/resources。Binding resolver 返回以 `bindingRef` 为键的可执行 Binding。缺环境变量时 Simulation、release 和 Project Task 保持 fail closed；缺失或无效导出会阻止服务启动。Resolver 模块由本机运维配置并信任，不能把测试 Fake 当生产 resolver。v2 Studio Simulation 生成的 Sandbox 证据由 Team IR semantic digest 和 compiled plan digest 绑定，不接受旧 Mermaid Simulation 作为发布证明。

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
| IR Schema：runInput/runResult | `tests/team-ir-schema.test.mjs`：最小文档、缺失 root contract 断言；`tests/team-ir-payload-validation.test.mjs`：Run input、Agent input/output 与 result payload 校验；`tests/team-ir-result-mode.test.mjs`：result Schema 失败路径 | 部分；运行时 payload 校验与结果模式有证据；完整结构字段边界、Artifact result 合同及非法 Schema 组合仍待补 |
| IR Schema：executionPolicy | `tests/team-ir-schema.test.mjs`：最小合法文档；`tests/team-ir-validation.test.mjs`：required-result 静态约束；`tests/team-ir-result-mode.test.mjs`：`allow_empty` 零结果完成、非法结果失败和 required 零结果失败 | 部分；运行时结果模式正反例已覆盖；非法预算/Schema 边界矩阵及所有终态组合待补 |
| 映射编译：合法 output/Run 引用 | `tests/team-ir-mapping-validation.test.mjs`：`valid local schema references and required mappings pass`；`tests/team-ir-reference.test.mjs`：`parses the supported root paths and array indexes` | 部分；Run/input 与当前 output 映射静态类型检查有覆盖，完整端口投影 Runtime 未覆盖 |
| 映射编译：合法 Loop 引用 | `tests/team-ir-reference.test.mjs`：Loop 引用语法；`tests/team-ir-mapping-validation.test.mjs`：`Loop previous reference passes when the anchor dominates the reader in the Loop DAG`；`Loop previous references fail closed across Join aggregation and multi-lineage fan-out` | 部分；无环单 lineage DAG 可静态证明；Loop 内 Join 汇聚或多内部分支 fan-out 无法证明同 lineage 唯一执行，稳定以 `IR_LOOP_PREVIOUS_NOT_DOMINATED` 在引用 pointer 拒绝；Runtime 历史实际读取另验 |
| 映射编译：未解析路径 | `tests/team-ir-mapping-validation.test.mjs`：`source path lookup rejects unknown fields and disallowed reference roots`、`missing and unknown target fields are diagnosed` | 已有静态诊断断言 |
| 映射编译：禁用根 | `tests/team-ir-mapping-validation.test.mjs`：`source path lookup rejects unknown fields and disallowed reference roots`；`Join detects duplicate providers, missing required contributions and optional conditional sources` | 部分；普通 Handoff 与 Join baseMapping 代表路径覆盖，所有根/调用点组合待补 |
| 映射编译：非法数组索引 | `tests/team-ir-reference.test.mjs`：`validates root-specific reference shapes and rejects unsupported syntax`；`tests/team-ir-mapping-validation.test.mjs`：`array index references honor items, tuple positions, minItems and maxItems`、`array construction checks tuple item positions and forbidden extra items`、`source path lookup rejects unknown fields and disallowed reference roots` | 部分；常规数组、tuple、`items`、`prefixItems`、`minItems`/`maxItems` 有边界断言；更复杂 Schema 组合仍待补 |
| 映射编译：常量类型错误 | `tests/team-ir-mapping-validation.test.mjs`：`literal mappings check nested object and array item types at the target pointer`、`source optionality and simple type direction are checked against required targets` | 部分；嵌套对象/数组 `$literal` 与简单类型方向有断言；完整 Schema 组合仍待补 |
| 映射编译：缺必填 | `tests/team-ir-mapping-validation.test.mjs`：`missing and unknown target fields are diagnosed`、Join 对应测试 | 已有静态断言；完整诊断码/pointer 追溯仍需扩展 |
| 映射编译：类型不兼容 | `tests/team-ir-mapping-validation.test.mjs`：`source optionality and simple type direction are checked against required targets`、`artifact mappings enforce required slots and media type compatibility` | 部分；简单 JSON 类型及 Artifact media type 覆盖，组合 Schema 交给运行时校验尚未实现 |
| 映射编译：目标冲突 | `tests/team-ir-mapping-validation.test.mjs`：`Join detects duplicate providers, missing required contributions and optional conditional sources`；`tests/team-ir-join-runtime.test.mjs`：`first contribution starts deadline, target conflicts fail closed, and unknown sources reject` | Join 多来源字段/槽位重复写入有静态和运行时拒绝断言。普通单 Handoff 的目标以唯一 JSON object key 表示，不存在多来源字段并集；该语义由 Join 聚合路径承载，不另造普通映射冲突行为 |
| Schema 边界：`$ref` | `tests/team-ir-schema-resolver.test.mjs`：Team-local/package-relative refs、闭包 digest 与拒绝用例；`tests/team-ir-compiler.test.mjs`：`compiler snapshots referenced package Schema resources into the digest`；`tests/team-ir-payload-validation.test.mjs`：含 package refs 的 payload 校验 | 部分；Schema 闭包自动进入 digest 且 payload 校验可执行；闭包恢复拒绝矩阵待补 |
| Schema 边界：type/required/items | `tests/team-ir-mapping-validation.test.mjs`：`source optionality and simple type direction are checked against required targets`、`array index references honor items, tuple positions, minItems and maxItems`、`array construction checks tuple item positions and forbidden extra items`；`tests/team-ir-payload-validation.test.mjs`：`payload validator reports stable runtime diagnostic codes and JSON Pointers` | 部分；object/type/required 与 array `items`/tuple 专项边界有断言；完整组合 Schema 不做静态蕴含推理，须由运行时 validator 覆盖 |
| Schema 边界：optional source 到 required target 拒绝 | 同上 | 已有静态拒绝断言 |
| Schema 边界：复杂 Schema 运行时校验提示 | `tests/team-ir-mapping-validation.test.mjs`：`complex target constraints retain a runtime validation warning`；`tests/team-ir-payload-validation.test.mjs`：`payload validator reports stable runtime diagnostic codes and JSON Pointers`、`invalid mapped Agent input can be rejected before the Binding invocation`；`tests/team-ir-runtime.test.mjs`：`invalid mapped input fails before Binding invocation and invalid output fails before delivery` | 部分；复杂 Schema warning、payload validator 与本地 TeamRuntime 调用前拒绝均有证据；生产 Project Task 全面接线仍受 release closure/resolver 配置限制 |
| Schema 边界：调用前校验失败 | `tests/team-ir-payload-validation.test.mjs`：`invalid mapped Agent input can be rejected before the Binding invocation`；`tests/team-ir-runtime.test.mjs`：`invalid mapped input fails before Binding invocation and invalid output fails before delivery` | 部分；无效输入不调用 Binding，输入/输出错误使 Run 进入失败收敛；Project API 路径未接入 |
| Join：精确 `handoffIds`、目标端口、游离入边 | `tests/team-ir-validation.test.mjs`：`Join requires exact incoming source and valid target ports` | 部分；游离入边和目标端口有断言；精确合法全集与多 Join 冲突组合待补 |
| Join：单边缺必填豁免 | `tests/team-ir-mapping-validation.test.mjs`：`Join single-source contribution is checked with baseMapping as one complete field union` | 已有单来源正例与 baseMapping 字段并集检查；多来源 optional/required 组合见 Join 来源行 |
| Join：条件必需来源约束 | `tests/team-ir-mapping-validation.test.mjs`：`Join detects duplicate providers, missing required contributions and optional conditional sources`、`Join required fields cannot rely on a source behind a conditional Run route`、`Join required fields cannot rely on a source Agent with no guaranteed activation path` | 部分；必达性静态拒绝已覆盖；所有 route/Loop/Join 条件组合待补 |
| Join：字段并集、重复字段拒绝 | `tests/team-ir-mapping-validation.test.mjs`：Join 重复 provider 测试；`tests/team-ir-join-runtime.test.mjs`：`all_of merges baseMapping once, preserves Artifact provenance, and omits skipped optional values`、`first contribution starts deadline, target conflicts fail closed, and unknown sources reject` | 部分；纯状态机合并/冲突已覆盖，尚未接入 Agent 调用及 Schema 校验 |
| Join：`all_of` optional skip / required skip / 零到达 | `tests/team-ir-join-runtime.test.mjs`：`all_of merges baseMapping once, preserves Artifact provenance, and omits skipped optional values`、`all_of fails when a required source skips or every source skips` | 部分；确定性状态机覆盖；上游 scheduler 何时判定全部前驱终止/可标记 skipped 尚未集成 |
| Join：`quorum_of` 早触发 / 不可达 / 迟到来源 | `tests/team-ir-join-runtime.test.mjs`：reducer threshold/late-arrival tests；`tests/team-ir-runtime.test.mjs`：`quorum Join starts at threshold and persists the selected contributions and original deadline across FileTeamRunStore instances`、`quorum Join fails when conditional source skips make the threshold unreachable`、`an active quorum sibling failure after target activation still fails the Run` | 部分；单个无 Loop quorum Join 在 scheduler 内可提前触发、持久选中来源、忽略迟到合并贡献、条件 skip 不可达失败且活动 sibling 失败仍使 Run 失败；多 Join、Loop 和其它复杂拓扑未接入早触发路径 |
| Join：timeout 起点、恢复与迟到幂等 | `tests/team-ir-join-runtime.test.mjs`：`Join deadline starts at first predecessor activation and survives snapshot recovery`；`tests/team-ir-runtime.test.mjs`：all_of/quorum scheduler timeout 与 `FileTeamRunStore recovery arms a collecting Join with only its persisted remaining deadline` | 部分；no-Loop Run-scope all_of/quorum 的持久 deadline、timeout tick、失败收敛和无活动调用 checkpoint 恢复有 Runtime 证据；Loop-scope timeout 和有活动 Binding 的进程崩溃恢复仍未覆盖 |
| Loop：draft/revise 端口及上一轮 data/Artifact 引用 | `tests/team-ir-reference.test.mjs`：`parses the supported root paths and array indexes`；`tests/team-ir-validation.test.mjs`：`Loop declarations validate members, disjoint boundary sets and edge direction` | 部分；路径解析和 Loop 边界结构有覆盖，端口策略与 Artifact 执行未覆盖 |
| Loop：支配关系通过/拒绝、首轮历史缺失 | `tests/team-ir-mapping-validation.test.mjs`：`Loop previous reference passes when the anchor dominates the reader in the Loop DAG`、`Loop previous reference rejects a bypass path, external initialization and conditional route`、`Loop previous references fail closed across Join aggregation and multi-lineage fan-out` | 部分；通过/绕过/外部初始化/条件路由有精确 pointer；同 Scope Join 与多内部分支 fan-out 明确拒绝，不宣称支持其 lineage 证明；首轮实际历史读取需 Runtime 证据 |
| Loop：前轮零次/多次执行、陈旧值拒绝 | `tests/team-ir-runtime.test.mjs`：单 lineage bounded rounds / exhaustion / unsupported topology tests；`tests/team-ir-loop-join-runtime.test.mjs`：classic structured debate 两轮 Loop-scoped all-of Join 和 checkpoint recovery | 部分；单 Scope/lineage 串行及特定单 Loop + 无条件成员内 all-of Join / boundary fanout 有 Runtime 证据；条件 Loop Join 来源、多 Loop/嵌套和一般多 lineage 仍以 `TEAM_LOOP_TOPOLOGY_UNSUPPORTED` fail closed，未证明支持 |
| Loop：耗尽与恢复 | `tests/team-ir-runtime.test.mjs`：`Loop executes bounded sequential rounds and resolves only the immediately previous output`、`scheduler checkpoint resumes from a completed invocation across FileTeamRunStore instances without repeating the Binding call`、`scheduler recovery cancels an active invocation and settles an unknown outcome without replay`、`active Run re-entry without a scheduler checkpoint is rejected without side effects` | 部分；scheduler 持久化 pending/source/skipped/arrived/visited、invocation ID 和 Loop 轮次/激活/历史；File Store 第二实例恢复 completed 输出不重复调用，active invocation 尝试 cancel 后以 `outcomeUnknown` 失败结算；缺少 checkpoint 的老/不完整 Run 仍明确拒绝；Join 状态本身、Artifact output 注册去重与外部副作用的通用 exactly-once 未覆盖 |
| Runtime：本地结构化 handoff、条件 Run 入口、结果写入/收敛/冲突 | `tests/team-ir-runtime.test.mjs`：经典软件团队 scheduler 集成、路由/结果断言、quorum scheduler 集成；`tests/team-ir-result-mode.test.mjs`：`allow_empty` 和 `required` 终态；`tests/team-ir-validation.test.mjs`：`required-result policy and parallel result writes are checked statically` | 部分；`START -> route -> fan-out -> Join -> result -> settlement`、窄拓扑 quorum early fire 与 resultMode 有本地运行证据；静默收敛、并行竞态、Result 原子提交与所有活动分支立即取消/收敛仍缺证据 |
| Runtime：Artifact 来源、越权拒绝、受控登记 | `tests/team-ir-runtime.test.mjs`：Agent Handoff/opaque result tests；`tests/team-ir-join-artifact-runtime.test.mjs`：`all_of Join projects source and baseMapping Artifacts with provenance into the target allowlist`、`quorum Join passes only selected source Artifacts plus baseMapping through the invocation allowlist`；`tests/team-ir-artifact-store.test.mjs`：File Store 跨实例所有权与完整性 | 部分；Run input/Agent output/Handoff/Join all_of 与 quorum 的来源 envelope、下游 invocation allowlist 与越权拒绝有本地证据；Artifact Store 登记与 RunStore checkpoint 仍无原子事务，通用外部副作用 exactly-once 未承诺 |
| Runtime：无效输入失败关闭 | `tests/team-ir-payload-validation.test.mjs`：调用 Binding 前拒绝；`tests/team-ir-runtime.test.mjs`：`invalid mapped input fails before Binding invocation and invalid output fails before delivery` | 部分；Runtime 本地执行路径有证明；Project Task executor 仅拒绝当前不能满足的 Run 输入合同，生产 executor/resolver 未接线 |
| Runtime：Review 暂停/批准/拒绝/反馈/timeout/预算冻结 | `tests/team-ir-review-runtime.test.mjs`：授权、revision、approve/reject 幂等、feedback 校验、独立 deadline、取消、File Store 跨实例与竞争 CAS；`tests/team-ir-runtime.test.mjs`：`TeamRuntime waits for an authorized FileStore Review decision and resumes the same completed output` | 部分；串行单 lineage gate 已接 scheduler，Run 等待不占 Binding active time；授权 approve 后同 checkpoint 重放已完成 output，`$.review.decision/feedback` 投影到下游；reject/timeout fail closed；Loop/Join/Review parallel fanout 拓扑拒绝；外部生产 Review API、Task/UI 接线及有活动并行 siblings 的收敛未覆盖 |
| Runtime：deadline、Binding 重试耗尽、错误归属、取消、checkpoint replay | `tests/team-ir-runtime.test.mjs`：`Runtime persists invocation, retries transport failure and completes once`、`timeout starts failure intent; cancellation and failure settle only their winning intent`、`unconfirmed timeout cancellation records unknown outcome and does not retry` | 部分；单调用生命周期及失败/取消竞态有覆盖；并行 sibling 失败收敛、持久 scheduler replay 和所有中断点未覆盖 |
| Runtime：生产 Project Task v2 执行 | `apps/team-site/tests/team-ir-project-run-executor.test.mjs`：冻结 digest、sandbox mode、输入合同、状态目录 symlink 与 query store 重读；`apps/team-site/tests/task-execution-use-cases.test.mjs`：无可信 resolver 时在 Run 预留前 fail closed | 部分；生产组合根已注入 v2 executor/resolver loader；本机未配置可信 resolver 模块，因此真实 Task 仍 fail closed |
| A2A：Agent Card、Task 状态、Message Parts/Artifact、deadline、幂等 | `tests/team-ir-a2a-binding.test.mjs`：pin Agent Card、媒体/输入映射、Task 状态、幂等 key、取消不确定结果 | 部分；纯 Adapter 合同有覆盖；输出 Artifact 反序列化、持久幂等缓存、deadline 和实际远程 client 未覆盖 |
| A2A：`input-required` 暂停、请求暴露、不可 Resume、取消/新 Run、completed/failed/canceled | 同上：`input-required` 数据与取消 Adapter 合同 | 部分；Adapter 返回形状通过；TeamRuntime 持久暂停、兄弟调用收敛、查询/取消 API 和另起 Run 尚无证据 |
| Studio：连线/自动映射/缺项定位/Handoff/Join/Loop 编辑/发布诊断 | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：Agent/port/Handoff 编辑、advanced Team IR round-trip（含 Join/Loop/Review/routes）、服务器诊断阻止保存；`apps/team-site/tests/team-ir-use-cases.test.mjs`：服务端校验/保存 | 部分；浏览器可编辑基础表单并 round-trip 高级 IR JSON；事件桩画布/直接连线、自动映射建议、逐字段诊断定位仍未完成 |
| Studio：窄屏、保存重开、digest | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：真实 Playwright 保存/重开、semanticDigest、390px 无横溢、Simulation、Fake resolver 发布阻断/成功及发布后只读 | 部分；已覆盖 Fake resolver 下的 simulation/release 浏览器合同，但不是生产 resolver 或真实 Sandbox UAT；完整关闭/重启后重新打开验收仍待补 |
| 数据边界：旧配置拒绝及重建提示 | `apps/team-site/tests/team-ir-legacy-compatibility.test.mjs`：legacy Team API create/read/design/validate/save 旧合同仍委派，legacy 写入口拒绝 v2 payload；旧 Team IR read 返回空且 release snapshot 拒绝、不创建 IR 文件；`apps/team-site/tests/team-api-routes.test.mjs`：legacy TeamVersion release route/error mapping；`apps/team-site/tests/product-logic-acceptance.test.mjs`：真实旧 Team 发布拒绝且整个 Team workspace tree digest 不变；`apps/team-site/tests/classic-team-flow.test.mjs`：重建提示与挂载关系保持 | 部分；create/read/save/validate/release、v2 不误写、挂载身份及拒绝发布不改历史文件有证据；Task/Run/history 的兼容合同仍由既有专用测试分散覆盖，尚无单一端到端矩阵，也未完成默认入口切换 |
| 数据边界：创建/发布不改 `.ogs/runs/`、无迁移副作用 | `apps/team-site/tests/team-ir-legacy-compatibility.test.mjs`：legacy `.ogs/runs/run-old` 树 SHA-256 在 IR read/validate、拒绝发布、拒绝挂载、拒绝 Task 创建前后不变，且未创建 IR 文件；有效 Project Task 历史 Run 经 Recent Run 读取前后 `.ogs/runs/` SHA-256 不变 | 部分；历史内容只读与拒绝边界副作用有本地证据；尚未覆盖 Team IR 变更/删除后历史查询 API 仍可读取绑定原快照，也未覆盖真实发布/真实 Sandbox 后历史 Run 查询 |
| 发布：活动模板/示例/文档/默认入口为 v2 | 入口与模板 inventory 及切换验收矩阵见下方“阶段 4 入口与模板 inventory” | 未切换；Team Site `/studio/new`、草稿续编/版本编辑及经典 case/template provisioning 仍走旧 `/design`/Mermaid materializer。可独立完成 inventory、只读行为测试、示例分类、fixture/schema 校验和非默认 v2 preview；作者默认路由、活动案例/模板 provisioning、legacy draft 的重建入口统一切换，必须等阶段 3 作者/Simulation/生产可信 release 成功门通过 |
| 发布：Compiler/API/Runtime/Team Site/浏览器验收 | Team IR 聚焦测试、Team Site IR API/Project executor 测试及一项 v2 Studio browser 测试 | 部分；各自垂直切片存在；没有生产 closure/evidence/Binding 注入下的端到端发布与 Project Task 真实运行 |
| 发布：`git diff --check` | 每次变更后运行并记录 | 工程卫生检查，不替代任何语义覆盖 |

**阶段 1 尚缺的静态覆盖：** `tests/team-ir-schema.test.mjs`、`tests/team-ir-validation.test.mjs`、`tests/team-ir-mapping-validation.test.mjs` 已对 `validate.ts`、`mapping-validation.ts` 发出的阻断诊断 code 建立逐类断言和精确 JSON Pointer，补充 route 源/候选一致性、fallback/condition、Join target/scope/quorum、Loop boundary、mapping reference/schema/Artifact 与 Join/Quorum 字段分支；Loop previous dominance 限定在无环单 lineage DAG，Loop 内 Join 汇聚或多内部分支 fan-out 均以 `IR_LOOP_PREVIOUS_NOT_DOMINATED` fail closed，并有对应精确 pointer 反例。Schema resolver 测试另对 `TeamSchemaResolverError.code` 的 forbidden/out-of-scope/missing/dialect/invalid 分支作稳定断言。Resolver 自身抛 typed error，不产生带 JSON Pointer 的 `TeamIrDiagnostic`；映射层会把引用解析错误转换为诊断并断言映射目标 pointer。此覆盖闭合阻断诊断 code 的代表性触发分支，不等同于每个 code 所有组合输入的笛卡尔穷举。尚缺复杂 JSON Schema 的静态赋值推理、角色包/Binding 执行策略闭包变化矩阵以及 Join/多 lineage Loop 的可支持控制流证明；被拒绝的拓扑不算已实现支持。普通结果目标完整字段/冲突、Join 单边豁免与字段并集、`$literal`/数组边界已有代表性正反例。复杂 Schema validator API 和 Runtime 调用前校验已有测试；生产 Project Task 集成归阶段 2。Schema resource 闭包已进入 `CompiledTeamPlan` digest 并有包内引用变更测试。动态状态机与 API/Studio/真实 Sandbox UAT 归后续阶段，不计作阶段 1 静态覆盖。

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
| `all_of`/`quorum_of` 后 Join 输入只生成一次，迟到来源仅审计，活动 sibling 失败仍使 Run 失败 | `tests/team-ir-runtime.test.mjs`：单无 Loop quorum threshold/late/failure、scheduler timeout 与 File Store checkpoint；`tests/team-ir-loop-join-runtime.test.mjs`：Loop-scoped all-of 两轮、失败和 checkpoint recovery | TeamRuntime 有受限 scheduler 集成/持久恢复证据；多 Join、Loop quorum、条件 Join 来源、所有拓扑 sibling 取消与 Loop deadline enforcement 仍未覆盖 |
| optional 条件来源按所有前驱终止状态标记 `skipped`；required 缺席失败 | mapping validation 和 Join reducer 的 optional/required skip 测试 | 静态/状态机部分通过；scheduler 尚未把分支路由和 `pending/arrived/skipped` 完整接合 |
| Loop 紧邻前轮唯一成功执行、同 lineage/Scope，零次/多次/陈旧历史拒绝 | Loop 单 Scope/lineage 串行 Runtime 测试覆盖 bounded rounds 和 immediately-previous output | 部分；多 lineage/Join/并行/嵌套 Scope 与进程重启 checkpoint 恢复待做 |
| Review 在下游 route 前暂停；授权决定、reject feedback、独立 timeout、等待不耗 active budget，决定后 sibling 收敛 | `tests/team-ir-review-runtime.test.mjs`；`tests/team-ir-runtime.test.mjs`：`TeamRuntime waits for an authorized FileStore Review decision and resumes the same completed output` | 部分；串行路径接入 TeamRuntime，File Review Store 可跨实例读取/决定，CAS 防止并发不同决定，unauthorized reviewer 被拒；Run 暂停时 scheduler checkpoint 保留且决定后不重复调用已完成 Agent；Loop/Join/fanout 和有活动 siblings 场景显式 fail closed，未接生产 Task API/浏览器，等待预算/下游 deadline 无端到端集成测量 |
| A2A `completed`/`failed`/`canceled`/`input-required`、Artifact Parts、deadline、幂等及输入请求审计 | `tests/team-ir-a2a-binding.test.mjs` 覆盖 adapter 状态；`tests/team-ir-runtime.test.mjs` 覆盖 `paused_input_required`、拒绝同 Run 续跑和 sibling 收敛；`apps/team-site/tests/team-ir-project-run-executor.test.mjs` 覆盖持久 query 的 owner-scoped pendingInput、无成功结果及事件不含请求正文 | adapter + scheduler 切片通过；具体远端 HTTP client/持久远端幂等缓存、用户取消/control API、新输入 Run 的公开产品流程及跨进程恢复时活动 sibling 收敛待做 |
| 首个失败、取消、Review 决定、A2A input-required 通过 revision/CAS 线性化；晚到响应不可提交下游副作用 | `tests/team-ir-runtime.test.mjs` 覆盖单调用 failure/cancel intent winner 和 A2A input-required sibling cancellation/late sibling audit；Review reducer 有 revision token 测试 | 部分；Review 与终态、Result/Artifact 提交竞态及跨重启线性化无集成故障注入 |
| Runtime checkpoint replay 不重复 Binding 副作用、Result/Artifact 登记；恢复重算冻结闭包，不匹配即拒绝 | File Run Store/Runtime 单测覆盖记录持久化、digest 和局部恢复检查 | 部分；完整 scheduler 意图/提交检查点、真实进程重启和全依赖漂移矩阵未覆盖 |
| 历史 Run 绑定原 Team/Plan snapshot，当前 Team IR 改动/缺失不改历史查询；创建/发布不得写 `.ogs/runs/` | `apps/team-site/tests/team-ir-legacy-compatibility.test.mjs`：IR read/validate、拒绝 release/mount/Task 不改 legacy Team `.ogs/runs/` SHA-256；`createFileRecentRunStore` 读取有效历史 Task 输出后 Project `.ogs/runs/` SHA-256 不变；既有 `apps/team-site/tests/run-query-use-cases.test.mjs` 验证 owner 隔离 | 部分；无迁移副作用与历史读取不写入有证据；IR 变更/删除后仍基于历史冻结快照查询及终态只读 API 仍缺 |
| Studio 画布事件桩连线、自动映射、缺项定位、Handoff/Join/Loop 编辑、诊断 code/pointer 一致 | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：schema-driven 高级合同 JSON 编辑，完整 Join/Loop/Review/routes、Run contract、Agent port/Artifact slot、Handoff Artifact mapping、A2A Binding 往返；无效 Review timeout 返回 code/pointer 且不触发 PUT；保存重开 digest 一致、legacy API 409、390px 无横溢 | 部分；高级合同可编辑/往返；尚无事件桩画布、自动映射、逐字段可视化编辑与缺项定位 UX |
| Studio v2 Simulation 独立于 Project Task/旧 Mermaid simulation，保存 simulation evidence 但不写 `.ogs/runs/` | `apps/team-site/tests/team-ir-studio-simulation.test.mjs`、`team-ir-simulation-routes.test.mjs`：原生 TeamRuntime execution、digest 绑定、脱敏持久 evidence、legacy evidence 拒绝；`team-ir-studio-browser.test.mjs`：Fake resolver 下从保存/重开、Simulation、readiness 到发布成功 | 部分；Simulation 独立持久化，FileTeamRunStore checkpoint 可跨实例恢复；启动时扫描恢复已接线，显式 API 仍可按 TeamVersion 恢复。Fake UAT 不证明真实 Sandbox |
| TeamVersion v2 readiness/release 成功和失败路径，发布后只读/重开，冻结完整依赖及专用 Sandbox 证据 | IR lifecycle/use case 测试覆盖 fail closed、digest freeze；基础浏览器只验保存重开 | 部分；服务端 production closure/evidence resolver 未注入，故无可信发布成功路径和 release browser 验收 |
| legacy create/read/save/validate/release/mount/task/run/history 兼容矩阵；拒绝旧定义不迁移、不覆盖；旧页面给重建提示 | `apps/team-site/tests/team-ir-legacy-compatibility.test.mjs`：旧 API 合同委派、v2 payload 旧写入口 409、旧 Team IR 缺失读取为空；legacy Run 树 hash 在 IR read/validate、拒绝 release/mount/Task 后不变，Project 历史 Run 查询前后 `.ogs/runs/` hash 不变；`apps/team-site/tests/product-logic-acceptance.test.mjs`：legacy Team 发布失败前后整个工作区 SHA-256 tree digest 相同且不创建 `team.ir.json`；`apps/team-site/tests/classic-team-flow.test.mjs`：页面重建提示及 Project mount/Task TeamVersion 不变；`apps/team-site/tests/run-query-use-cases.test.mjs`：Run owner 隔离 | 部分；证据来自分散合同，legacy `/design` 仍可写旧格式；缺统一全入口端到端矩阵、IR 改动/删除后的冻结快照历史查询和默认入口切换，阶段 3 完成前保持切换门关闭 |
| 默认作者入口、经典活动模板与活动示例切到 Team IR v2；通用 standalone System 示例明确范围 | 入口与数据路径 inventory、可独立工作及切换 gate 见“阶段 4 入口与模板 inventory”；新增 `examples/team-ir-v2/classic-software-team.json`；standalone `examples/**/system.mmd` 属 OGS System/CLI 示例，不属于 Team Site 活动 Team 模板迁移 | 未完成并受阶段门约束；`/studio/new`、draft/released 编辑及 3 个活动 classic cases/template provisioning 仍走 legacy `/design` 或 Mermaid materializer。inventory、只读合同、v2 fixture/schema 校验可先做；默认入口、活动 Case/template provisioning 和旧 Team 重建 flow 须等待阶段 3 production release 成功门 |

### 阶段 4 入口与模板 inventory

以下 inventory 区分 Team Site 的活动 Team 产品链与 OGS standalone System/CLI 示例。仅列可在代码中确认的入口/物化路径；阶段 3 production release 成功门未通过前不得改变默认路由、既有 TeamVersion 身份或启动时 provision 行为。新建 v2 草稿只能通过明确的 v2 API/页面操作，不得把 legacy `/design` 文件自动解析、迁移或覆盖成 IR。

| 产品面 / 现有文件 | 当前行为与数据合同 | 可先独立完成 | 切换门与验收矩阵 |
| --- | --- | --- | --- |
| 默认创建 `/studio/new`；`apps/team-site/public/app/views/app.js` (`renderNewProject`)；`apps/team-site/api/team-routes.mjs` (`POST /api/v1/team-factory`)；`apps/team-site/application/team-lifecycle-use-cases.mjs` (`createTeamDraft`) | 创建 `source: team-factory` / `templateId: empty` 的 legacy 草稿，成功后导航 `/studio/teams/:id/design`；该页面用旧 `/design` API/authoring，不是 Team IR v2 | 只读路由/API 回归、v2 示例独立 validate/save/reopen、显式 v2 authoring route 的非默认可达性检查 | 生产 release resolver + release evidence + Binding resolver 可用；Studio v2 保存/Simulation/发布成功及发布后只读验收通过。随后分别验收新建成功落 `.ogs/team.ir.json`、digest 重开一致、不得写旧 authoring、不回退 `/design` |
| 草稿续编、已发布版本编辑；`app.js` (`teamCard`, `bindTeamActions`, `renderProjectStudio`)；版本创建在 `team-lifecycle-use-cases.mjs` (`forkTeamVersion`) | Draft `继续编辑` 和 released `编辑团队` 跳 `/design`; fork 复制旧 package/Mermaid 且会复制已有 Team IR（如有），不能默认为 legacy draft 自动生成 IR | 只读确认旧 draft/version 链接与旧 API 写入合同、显式重建提示/不落盘兼容验收 | 新 legacy draft 的 v2 重建应创建独立新 TeamVersion，旧 TeamVersion 与 `.ogs/runs` hash 保持；已有 native v2 fork 复制 IR 且重新冻结成功。分别覆盖 legacy draft、legacy released、native v2 draft/released，不把 ID/版本来源混同 |
| 经典活动案例列表/“使用案例”动作；`apps/team-site/cases.mjs` (`software-team`, `expert-consultation`, `structured-debate`)；`apps/team-site/api/case-routes.mjs` (`POST /api/v1/cases/:id/use`)；`app.js` 案例动作 | 通过 `createClassicTeamProject({ caseId })` 创建并发布 `source: classic` 团队，`templateId: classic:<caseId>`，当前拓扑来自 Case spec/旧 Mermaid materializer | 三个 Case 均有独立 v2 IR fixture；contract tests 覆盖 schema/compiler/digest；expert-consultation 有 Fake Runtime quorum 正反例，structured-debate 有受限 Loop+all_of Runtime 两轮/失败/恢复测试；Case API 当前仍只验 v2 发布失败时拒绝/清理 | 禁止只替换入口。production release gate 通过后，对 3 个 case 逐一验证 v2 Team IR、发布证据、发布版本 immutable digest、Project mount/Task 使用其 frozen compiled digest；案例创建不得再把 Mermaid materializer 当 v2 发布源。对现有 classic TeamVersion 保持原位读取且不自动升级 |
| 内置模板与启动 provision；`apps/team-site/server.mjs` (`provisionBuiltInTeamTemplates`)；`team-lifecycle-use-cases.mjs` (`provisionBuiltInTeamTemplates`, `createClassicTeamProject`)；`infrastructure/case-team-materializer.mjs`；`apps/team-site/demo-runner.mjs` | 每个 case provisioning `source: classic-template` 的旧拓扑模板；按 name/caseId 复用，发现物化不匹配会重写 `system.mmd`；启动后另有 `provisionBuiltInTeamVersions` API/调用路径可能触发 Sandbox release proof | 可先静态确认启动调用、复用/更新条件和现存目录列表；在隔离临时目录验证只读 inventory，不运行可能写用户项目的 provisioning | 生产 release gate 后逐 case 实现可重复且不覆盖历史版本的 v2 provisioning；迁移需明确新旧模板身份/ID、Run hash、重复启动幂等、旧模板仍可读；不得复用“旧 Mermaid 内容变化后原位覆盖”的更新行为改写用户资产 |
| v2 示例；`examples/team-ir-v2/classic-software-team.json` | 目前是一个可独立校验的 classic software Team IR fixture；尚不代表 Team Site 案例/内置模板/default | 可独立扩展其他 Case 对应 IR fixture、离线 schema/compiler fixture validation 和文档示例 | 成为活动案例/默认模板需走上方真实 release/mount/Task 门；fixture 编译通过不算发布/UAT |
| standalone System/CLI 示例；`examples/README.md` 与 `git ls-files 'examples/*system*' 'examples/**/*.mmd'` inventory：根目录 `minimal-system.mmd`、`target-model-binding-system.mmd`、`console-system.mmd`；目录 `error-flow-compensation/`、`langgraph-debate-current/`、`langgraph-expert-consultation/`、`legal-rag-dev-team/`、`medical-quorum-consultation/`、`mulit-debate-ogs/`、`ogs-gstacklike/`、`runtime-native-human-review/`、`rust-hello-pipeline/`、`wechat-miniprogram-factory/` 各自有 `system.mmd`；另有 `mulit-debate-ogs/system.example.mmd` 及 `ogs-gstacklike/scenarios/*.mmd` | 作为 OGSystem standalone System/CLI 运行示例，使用 `system.mmd`/Runtime 语义；不通过 Team Site 案例 API 或 built-in Team provisioning 消费 | 可独立审阅/维护 `examples/README.md` 的分类与命令，确认无 Team Site 活动路由引用；保持各目录原命令与 fixture 回归 | 不属于 Team TeamVersion 模板迁移，不改文件格式或命名以制造“活动示例全 v2”；若未来将某目录明确纳入 Team 案例/模板，需独立登记其 package/Binding/Schema closure、运行合同与切换验收 |

**切换验收顺序：** (1) 独立 inventory 与旧数据只读哈希回归；(2) 阶段 3 production release 成功门及 v2 Simulation/重开合同；(3) `/studio/new` 默认作者路径切换且旧 Team 明确走新建 v2 TeamVersion 重建，不改旧版本；(4) 3 个活动 case 和 built-in template 的逐项 v2 发布/挂载/Task/UAT；(5) 文档、截图/链接、default route/API、创建后的重开和旧路径回归；(6) 全量回归和历史 Run 只读验收。任何步骤失败均保持旧入口可用且不得做隐式迁移。当前可做完第 (1) 项及 v2 fixture/documentation 准备；第 (2) 未通过前第 (3)–(5) 是阻断项。
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
| Artifact Store 安全合同 | 部分通过 | `src/team-ir/artifact-store.ts`、`tests/team-ir-artifact-store.test.mjs` 覆盖 opaque ID、媒体类型、Run input 授权、Project/Run 所有权、跨实例 blob/metadata/grant 持久化、invocation allowlist 与完整性；`tests/team-ir-runtime.test.mjs`：`TeamRuntime hands an Agent Artifact to one downstream allowlist and persists a cross-instance authorized result` 覆盖 Agent 输出 Handoff、下游 allowlist、结果 opaque ref 与跨实例授权查询；scheduler replay 复用 completed invocation，不重复 Binding 调用 | Production Workspace 授权接线、ArtifactStore 与 RunStore 原子提交、外部 Artifact 登记副作用 exactly-once 和结果引用公开 API 未完成 |
| A2A Binding Adapter 合同 | 部分通过 | `src/team-ir/a2a-binding.ts`、`tests/team-ir-a2a-binding.test.mjs`，聚焦验证 `pnpm build && node --test tests/team-ir-a2a-binding.test.mjs && git diff --check` 通过，7/7；覆盖 pin Agent Card 版本/媒体模式、JSON/授权 Artifact 输入映射、Task 状态、幂等键、input-required 信息及取消不确定结果 | 尚无具体网络/SDK client；输出 Artifact Parts 反序列化、持久幂等缓存、TeamRuntime sibling 调用暂停/取消收敛、A2A API 只读/取消接口未完成 |
| Review 控制面状态机 | 部分通过 | `src/team-ir/review-runtime.ts`、`tests/team-ir-review-runtime.test.mjs`，FileTeamReviewStore 跨实例恢复及 CAS 竞争；`tests/team-ir-runtime.test.mjs` 覆盖 Runtime wait/authorized approve+reject/resume 和 completed invocation replay；`pnpm build && node --test tests/team-ir-review-runtime.test.mjs tests/team-ir-runtime.test.mjs && git diff --check`，28/28 | 串行单 lineage 有 scheduler 接线；仍未接生产 Task API/浏览器授权，Loop/Join/parallel fanout 与并行 sibling 收敛 fail closed，等待期间预算冻结和下游 deadline 无集成测量 |

**运行环境：** macOS，Node 项目要求 `>=20`，pnpm `10.33.2`；确定性本地 Fake Binding，无外部服务。
**变更范围：** Team IR 静态映射、Runtime 调度、TeamVersion 独立 IR API。
**未覆盖与风险：** 旧记录中的 114/101 是当时的历史测试数量；当前 core Team IR 定向回归 107/107。聚焦测试不代表全语义覆盖；Review/A2A/Artifact 尚未全部接入调度，API 保存的 IR 尚未经过 production 完整依赖闭包和 v2 Sandbox 发布证明，不能据此进行真实 UAT。
**阶段结论：** 阶段 1 部分通过；阶段 2、3 进行中；阶段 4 未开始。真实 Sandbox UAT、完整仓库回归与提交尚未完成。

**真实 Sandbox UAT 前置检查（当时状态）：** `codex login status` 返回 `Not logged in`；`opencode auth list` 显示 0 credentials；Team Site 已接入执行器，但生产配置未提供可信 Team IR release closure resolver、v2 Sandbox 证据验证器或 v2 Project Task Binding resolver。该检查时尚未发起模型请求。只有本地 deterministic Fake Binding 证据，不是经典团队真实运行。

### 2026-10-28：全量回归修复与此前阶段快照

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| Team Site 全量回归 | 通过 | `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot`，退出码 0；串行 suite 全部完成 | 生产 v2 resolver 接线与真实 Sandbox UAT 未覆盖 |
| 全仓构建与回归 | 通过 | `pnpm test`，build 成功；825 tests，824 pass、0 fail、1 skip（仅 Windows PowerShell/CMD 专项在 macOS 跳过），退出码 0 | 该回归不替代真实 Sandbox UAT 或未实现的 v2 语义集成 |
| Team IR 包导入与定义 digest | 通过（窄合同） | `apps/team-site/tests/product-capability-regression.test.mjs`：`project-v2 imports multiple nested released teams into a clean workspace transaction`；导入保留 Team IR semantic/compiled/compiler digest，定义摘要使用稳定 source TeamVersion 身份 | 需补 reuse 与 create-new 的重开 Store 持久化断言矩阵 |
| 失败 Run 重试和结果脱敏 | 通过（窄合同） | `apps/team-site/tests/domain-contract-regression.test.mjs`：`retrying a collaboration Task creates a new immutable Run attempt`、`a reserved Task with a missing Run state can be retried after recovery`；legacy adapter 仅在 `RUN_NOT_FOUND` 时交给 legacy store 复核；v2 `teamResult` 由结果查询返回并脱敏 | 附件冻结重试快照合同和生产控制/恢复接线仍未完成 |
| Project Task 确定性运行 | 通过（本地测试合同） | `apps/team-site/tests/project-store.test.mjs`：`v2 Collaboration Tasks execute their bound TeamVersion through the deterministic Runtime`；查询新读 Run owner/state/plan 并核验 frozen digest | Fake Binding 不等于 production executor 或真实 Sandbox |
| 阶段 1 静态覆盖 | 部分通过 | 新增 route source/候选完整性、fallback/condition、Join target/scope/quorum、Loop boundary、mapping malformed ref/schema/Artifact/Loop 与 Join/Quorum 分支的稳定 code+pointer 断言；Loop 内 Join 与多内部分支 fan-out dominance fail closed；`tests/team-ir-schema-resolver.test.mjs` 增补 resolver typed error code 断言。Loop 静态定向验证 `pnpm build && node --test tests/team-ir-mapping-validation.test.mjs`，22/22；最终 core 验证 `pnpm build && node --test tests/team-ir-*.test.mjs && git diff --check`，126/126 | 尚缺复杂静态赋值推理、Join/多 lineage Loop 可支持形态的控制流证明与历史引用可达性；当前不支持形态以 `IR_LOOP_PREVIOUS_NOT_DOMINATED` 拒绝；resolver 异常按 error code 验证，不适用 JSON Pointer |
| 阶段 2 Runtime 集成 | 部分通过 | TeamRuntime 经典 fan-out/Join/result、条件 optional Join 来源与单 lineage Loop；scheduler checkpoint replay 覆盖 File Store 跨实例恢复 completed invocation、Loop round/history 持续推进及 active invocation unknown outcome 拒绝重放；Artifact 两角色 Handoff 集成覆盖下游只读 allowlist、结果 opaque ref 与 File Store 重开后的 owner 校验；Review 串行 gate 接入等待/授权决定/feedback 下游映射/恢复，File Review Store 跨实例及 CAS；最终 `pnpm build && node --test tests/team-ir-*.test.mjs && git diff --check`，126/126 | Review 生产 Task API/浏览器、并行 sibling 收敛和 Loop/Join/fanout gate 拓扑、Artifact output 注册与 checkpoint 原子事务、Loop 与 Join组合语义、多 lineage 隔离、Join round checkpoint、Run result 原子提交，以及外部副作用通用 exactly-once 仍未完成 |
| 阶段 3 Studio / 发布 | 进行中 | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：Playwright 覆盖 IR 保存/重开、Simulation、发布 readiness 先阻断，随后 Fake resolver Sandbox evidence 满足 frozen digest 并发布成功、发布后只读及窄屏；Simulation application/API 与 restart recovery 7/7：原生 TeamRuntime、digest 绑定、脱敏持久 evidence、legacy evidence 拒绝、checkpoint 跨实例恢复、active invocation unknown outcome fail closed；`apps/team-site/tests/team-ir-v2-resolvers.test.mjs` 校验本地 resolver 绝对路径/必需导出。启动扫描已接入 Simulation 恢复。Team Site 全量串行回归 exit 0；最终全仓 `pnpm test` 为 825 tests，824 pass/0 fail/1 Windows-only skip | Production resolver 尚未配置，真实模型发布/Task 运行不可用；事件桩画布、逐字段编辑、Review 生产 API/UI 集成仍待完成 |
| 阶段 4 切换 / 清理 | 未开始 | 旧 Team 发布入口 fail closed；旧 API 拒绝 v2 文档 | 默认入口/模板/活动示例切换、全旧配置兼容矩阵与历史 Run 只读验收未完成 |
| 阶段 4 兼容矩阵与切换门禁 | 部分通过（兼容证据） | `node --test apps/team-site/tests/team-ir-legacy-compatibility.test.mjs apps/team-site/tests/team-api-routes.test.mjs apps/team-site/tests/team-ir-use-cases.test.mjs apps/team-site/tests/run-query-use-cases.test.mjs apps/team-site/tests/file-recent-run-store.test.mjs`：27/27；兼容测试锁定旧 API 合同、v2 payload 旧写入口 409、IR read/validate/release/mount/task 边界不改 legacy Team Run 树 hash、历史 Project Run 查询前后 `.ogs/runs/` hash 不变；既有浏览器验收证明拒绝发布时整个旧 Team workspace SHA-256 tree digest 不变及页面重建提示 | 部分；legacy `/design` 仍可写旧格式；证据来自分散合同，缺全入口端到端矩阵、IR 改动/删除后的冻结快照历史查询及默认入口切换；阶段 3 完成前保持切换门关闭 |
| 阶段 4 默认入口 / 模板 / 示例 inventory | Inventory 完成；切换未开始 | 静态追踪 `/studio/new` → `POST /api/v1/team-factory` → `createTeamDraft` → `/design`；draft/released 编辑和 fork；三个活动 Case (`software-team`、`expert-consultation`、`structured-debate`) → `createClassicTeamProject`/旧 materializer；server 启动 `provisionBuiltInTeamTemplates` → `classic-template` Mermaid materialization；独立 `examples/team-ir-v2/classic-software-team.json`；`examples/README.md` 和 tracked standalone `system.mmd` / 场景 `.mmd` 范围 | `/studio/new`、draft/版本编辑、3 个 Case 与 built-in templates 均依赖阶段 3 production release 成功门后再切；standalone CLI 示例不属于 Team Site 活动 Team 迁移。可提前只读回归、fixture/schema/diagnostic 准备及不做默认切换的 v2 preview；不运行会写用户 workspace 的 provisioning | 仍缺逐 Case native v2 fixtures/语义与 closure 验收、built-in template 幂等且不覆盖旧版本验收、legacy draft 独立重建为新 TeamVersion 流程、production resolver/evidence/Binding 成功发布和默认路由浏览器验收 |
| 经典团队真实 Sandbox UAT | 受阻 / 未运行 | 当时记录的 `codex login status` = `Not logged in`、`opencode auth list` = 0 credentials 且未发起模型请求；之后的在线探测见本节后新增的模型探测记录。Resolver loader/注入已实现，但本机未配置可信 closure/Binding resolver | 本机需配置可信 resolver module，并完成 Studio 发布、Project 挂载、真实 Sandbox Task 成功、受控失败/重试、重启查询与人工结果审核 |

**阶段结论（该快照时）：** 阶段 0 通过；阶段 1 部分通过；阶段 2 部分通过；阶段 3 进行中；阶段 4 未开始。该结论由后续日期记录增补，不表示当前全部阶段完成。

### 2026-10-28：Codex / OpenCode 模型真实探测

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 共享模型目录自动发现 | 通过（发现能力） | Team Site `GET /api/v1/platform/discovery` 实时发现 Codex 与 OpenCode CLI；目录包含 `codex/gpt-6-luna` 与 `openai/gpt-6-luna`，两项均标记 runnable。探测通过页面共用的 `POST /api/v1/platform/models/probe`，没有读取或输出凭据 | `runnable` 只是目录发现结果，不代表在线调用成功 |
| Codex GPT-6-Luna 在线探测 | 通过（模型探测） | `codex/gpt-6-luna` 返回 `available`，耗时 5,480 ms；使用 Codex app-server live probe | `codex login status` 同时显示 `Not logged in`，常见 API-key 环境变量不存在；成功调用所用认证来源尚未解释，不据此宣称已验证 API-key 登录流程 |
| OpenCode GPT-6-Luna / 候选模型在线探测 | 未通过 | `openai/gpt-6-luna` 返回 `unavailable`，耗时 10,388 ms；错误仅归类为网络/请求层，未输出原始错误。`opencode/beam-free` 也未通过。`opencode auth list` 为 0 credentials | OpenCode 没有可确认的认证凭据或已通过探测的模型；未写入默认 Provider/Model。需由本机配置 OpenCode 可用认证/路由后重探，再保存设置并读取复核 |
| 模型默认值配置 | 未更改 | `GET /api/v1/platform/settings` 仍为 `defaultProvider=codex`、`defaultModel=default` | 仅在目标 OpenCode 模型 live probe 成功后设置，并经设置 API 重读确认 |
| 经典团队真实 Sandbox UAT 前置条件 | 受阻 | 当前环境变量检查显示 `OGS_TEAM_IR_V2_RESOLVER_MODULE` 未配置；Codex probe 成功不替代 release closure、Sandbox evidence 与 Project Task Binding resolver | 配置可信 resolver 并完成 v2 Studio 保存/重开、真实 Sandbox 模拟、发布、Project 挂载、Task 成功及受控失败/重试、进程重启后查询和人工结果检查。OpenCode probe 阻塞单独保留，不能以目录发现替代 |

**本轮探测说明：** 本节覆盖了之前“未发起模型请求”之后新增的真实在线探测；Codex app-server 探测成功与 `codex login status` 的本机状态存在差异，需继续查明认证来源。未读取、复制或输出任何密钥。模型探测成功本身不改变阶段 1–4 状态，也不构成经典团队真实 Sandbox UAT。

### 2026-10-28：语义切片、经典 Case 发布门与全量回归

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：Run 结果策略 | 通过（运行时窄合同） | `tests/team-ir-result-mode.test.mjs`：`allow_empty` 合法零结果完成且不写 Result、选中的非法结果 Schema 失败、`required` 零结果失败；三条均用 TeamRuntime 与 deterministic Fake Binding | executionPolicy 非法预算/Schema 边界与全部调用组合仍待补，阶段 1 保持部分通过 |
| 阶段 2：quorum scheduler | 通过（无 Loop、单 quorum Join 切片） | `tests/team-ir-runtime.test.mjs`：阈值即触发目标、迟到来源不改已选贡献、条件 skip 后阈值不可达失败、活动 sibling 失败仍使 Run 失败；FileTeamRunStore 新实例重载保留 Join round 与原 deadline | 多 Join、Loop/Join 组合、一般并行失败的立即 sibling cancel、活动 Binding 崩溃恢复与 deadline 自动 tick 未完成 |
| 阶段 2：Join Artifact | 通过（all_of/quorum 本地运行合同） | `tests/team-ir-join-artifact-runtime.test.mjs`：handoff 与 `baseMapping` Artifact 经 Join merged envelope 保留 `sourceHandoffId`；目标 invocation 只读 allowlist 可读取声明槽位，越权 ID 拒绝；quorum 迟到来源不进入 merged；缺 ArtifactStore 在 Binding 前失败 | ArtifactStore/RunStore 跨存储原子提交及通用副作用 exactly-once 未完成 |
| 阶段 4：经典 Case 发布失败收敛 | 通过（fail-closed 窄合同） | `apps/team-site/tests/classic-case-v2-release-gate.test.mjs` 经 Case API 和临时 projects root 验证：legacy materializer 创建后，缺 native Team IR/v2 evidence 时请求失败、旧 Mermaid baseline Simulation 不调用、Team workspace 补偿清除。`team-lifecycle-use-cases.mjs` 在 digest 校验前按 TeamVersion ID 重读完整 Team 实体，避免 `listProjects` 元数据视图缺少 `workdir` | 仍无三种活动 Case 的 native v2 IR 成功发布/挂载/Task 路径；本项只证明不误发布且失败不留半成品 |
| 聚焦回归 | 通过 | `pnpm build && node --test tests/team-ir-*.test.mjs apps/team-site/tests/classic-case-v2-release-gate.test.mjs apps/team-site/tests/team-lifecycle-use-cases.test.mjs apps/team-site/tests/case-api-routes.test.mjs apps/team-site/tests/project-store.test.mjs && git diff --check`：166/166 | Fake Binding / Fake resolver 不等于真实 Sandbox UAT |
| Team Site 全量回归首次运行 | 失败，已修复 | `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot` 首次运行发现模板列表只有 metadata、不含 `workdir`，新 gate 把列表对象交给 digest 计算，触发 `ERR_INVALID_ARG_TYPE`；实现改为通过 TeamVersion ID 重读完整对象；针对性 `visual-acceptance`、lifecycle 和 Case gate 共 16/16 | 需以修复后全量重跑结果作为最终状态 |
| Team Site 全量回归修复后 | 通过 | `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot`，退出码 0；串行完整 suite 无失败输出 | Dot reporter 不提供计数摘要；本次记录退出码，不据此推断未展示的数量 |
| 全仓构建与回归 | 通过 | `pnpm test`：834 tests，833 pass、0 fail、1 skip（Windows PowerShell/CMD 专项在 macOS 跳过），退出码 0 | 全仓确定性回归不替代未实现的运行时组合语义和真实 UAT |

**本轮环境：** macOS，Node 项目要求 `>=20`，pnpm `10.33.2`。测试使用 deterministic Fake Binding；模型探测另见前一节，未将 Fake 验收写成真实 Sandbox。
**阶段结论：** 阶段 0 通过；阶段 1 部分通过；阶段 2 部分通过；阶段 3 进行中；阶段 4 未开始。经典 Case 旧路径现可在 native v2 release gate 失败时安全拒绝并清理；尚不能完成 native Case 成功发布，production resolver 未配置，OpenCode 未有模型通过在线探测，真实 Sandbox UAT 仍受阻。

### 2026-10-28：新增语义切片与 Case Runtime 覆盖

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：Run 合同与执行预算边界 | 部分通过（新增精确诊断覆盖） | tests/team-ir-schema.test.mjs 新增完整 Run input/result/Artifact slot/executionPolicy 正例；字段缺失、类型错误、额外字段及 budget 0、负数、小数均断言 IR_SCHEMA_INVALID 和精确 JSON Pointer；budget 1 合法。pnpm build && node --test tests/team-ir-schema.test.mjs && git diff --check，9/9 | 复杂 Schema 组合、Schema resolver 根诊断集成和全部 executionPolicy 终态/边界仍未闭合，阶段 1 保持部分通过 |
| 阶段 2：经典专家会诊 quorum Runtime | 通过（该场景窄合同） | tests/team-ir-classic-expert-consultation-runtime.test.mjs 使用 classic-expert-consultation.json 和 deterministic Fake Bindings，证明 2/3 达到阈值后 chief 在第三位专家返回前执行、selected 字段投影、迟到来源审计且不污染 Join、唯一结果；条件跳过使阈值不可达时 Run 失败且 chief/result 不执行。pnpm build && node --test tests/team-ir-classic-expert-consultation-runtime.test.mjs，2/2 | 不代表 Loop + Join、一般 branch/lineage 隔离或真实模型/Sandbox；Loop + quorum 当前以 TEAM_QUORUM_TOPOLOGY_UNSUPPORTED fail closed |
| 阶段 2：经典结构化辩论 Loop + Join | 通过（受限拓扑切片） | tests/team-ir-loop-join-runtime.test.mjs 使用 classic-structured-debate.json 和 FileTeamRunStore，覆盖两轮 all_of Join、continue 后 exit/reporter/result、Join target 失败、ready round checkpoint 后模拟崩溃恢复且不重跑首轮贡献，以及 target 每轮独立 activation ID。Runtime 只放行单 Loop + 单 Loop-scoped all_of Join、无条件成员内来源及限定的边界 fanout，其它拓扑 fail closed。pnpm build；node --test tests/team-ir-loop-join-runtime.test.mjs，4/4 | Loop 内 quorum、条件 Join 来源、多 Loop/嵌套及一般 lineage 组合仍不支持；其它拓扑的 fail-closed 需按设计保持明确并继续扩展验证 |
| 阶段 2：并行失败 fail-fast 收敛 | 通过（单 fanout、无 Loop/Review 切片） | tests/team-ir-fail-fast-runtime.test.mjs：Binding 确认取消后 sibling 立即关闭；取消未确认则保持 running 至原 attempt deadline 并标记 outcomeUnknown；迟到 completed 被丢弃且不写 Run Result。pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-fail-fast-runtime.test.mjs，26/26 | 有 Loop 或 Review 的 fanout 拓扑 fail closed；Artifact 登记前竞态、通用 sibling cancel/timeout 组合、跨进程活动调用收敛仍未覆盖 |
| 阶段 2：Join timeout scheduler | 通过（no-Loop Run-scope all_of/quorum 切片） | tests/team-ir-runtime.test.mjs：`all_of Join timeout is enforced by the scheduler and cancels an active source`、`quorum_of Join timeout is enforced by the scheduler and cancels an active source`、`pausing for required input disarms the process-local Join timer but preserves its deadline`、`FileTeamRunStore recovery arms a collecting Join with only its persisted remaining deadline`；Fake Clock 验证 deadline=150，恢复时刻 125/149 未超时，150 超时。终态或暂停/Review 挂起会清除进程内 waiter，恢复时从持久 deadline 重新挂载。聚焦 Runtime/Join/Loop 回归 40/40 | Loop-scope Join timeout 和有活动 invocation 的进程崩溃恢复仍未接入；其它 Join/Loop 拓扑保留 fail closed |
| 阶段 3：Team Site 全量串行回归 | 通过（Join waiter 清理后） | `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot`，退出码 0；完整串行 suite 通过。`apps/team-site/tests/team-ir-project-run-executor.test.mjs` 7/7，测试进程在暂停 Run 场景后正常退出 | 本地确定性回归已通过；Production resolver、真实 Sandbox UAT、未实现的 Studio 交互及 Review API/UI 仍未验收 |
| Join 同一 source endpoint 的逐 handoff 选择状态 | 通过（Runtime 回归） | `tests/team-ir-runtime.test.mjs`：`Join tracks selected and skipped Handoffs separately when candidates share one source endpoint`，两条互斥条件候选共用一个 source endpoint，断言只合并命中条件的 handoff 字段；`tests/team-ir-loop-join-runtime.test.mjs`：`Join readiness tracks selected and skipped handoff IDs when two sources share one endpoint`，断言逐 handoff `sourceStates`。`pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-loop-join-runtime.test.mjs` 通过 | 不同 lineage 下的 source 隔离仍未覆盖 |
| 经典团队真实 Sandbox UAT | 受阻 / 未运行 | 当前 OGS_TEAM_IR_V2_RESOLVER_MODULE 未配置，codex login status 为 Not logged in，opencode auth list 为 0 credentials；Codex GPT-6-Luna 之前的 live probe 成功但认证来源未解释，OpenCode GPT-6-Luna probe 未通过。生产 executor 缺 closure/evidence/Binding resolver 会 fail closed | 需要可信绝对路径 resolver、可执行真实 Sandbox Binding 和已确认认证模型；之后按本节 UAT 流程完成 Studio、发布、挂载、成功及失败/重试、重启查询和人工审核。Fake Runtime/旧 Mermaid/compile 不计真实 UAT |

运行环境：macOS，Node 项目要求 >=20，pnpm 10.33.2；Schema、Runtime 测试使用 deterministic Fake；Team Site 全量串行套件退出码 0。
变更范围：Team IR Schema 测试、经典 Case fixtures/合同、经典专家会诊 Runtime 测试、Case 发布 fail-closed gate、quorum scheduler、Join timeout waiter 生命周期。
未覆盖与风险：Review reject revise Loop、Result 与终态原子提交、一般 lineage 隔离、Loop-scope Join timeout 仍有独立缺口；fail-fast 仅在受限单 fanout 拓扑有证据，Artifact 登记竞态和有活动 invocation 的进程恢复未验证；真实 Sandbox UAT 受 resolver/认证条件阻塞。Join timeout 切片后 `pnpm test` 为 850 tests，849 pass、0 fail、1 Windows-only skip，退出码 0；Join waiter 清理修复后再次运行 `pnpm test` 为 851 tests，850 pass、0 fail、1 Windows-only skip，退出码 0；其后 Team Site 全量串行回归退出码 0。
阶段结论：阶段 0 通过；阶段 1 部分通过；阶段 2 部分通过（已新增 quorum 与受限 Loop + Join 运行切片）；阶段 3 进行中；阶段 4 进行中且默认切换关闭。不得宣称所有阶段通过。

### 2026-10-28：继续关闭 Schema、Join、Artifact 与历史 Run 缺口

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：Run 根合同 Schema 引用诊断 | 通过（公开校验入口窄合同） | `tests/team-ir-index.test.mjs`：`public validator maps a missing root-contract Schema reference to a stable diagnostic pointer`，经 `validateTeamIr` 断言缺失 `$ref` 产出 `IR_UNKNOWN_SCHEMA_REF` 和 `/runInput/dataSchema/$ref`；`node --test tests/team-ir-index.test.mjs tests/team-ir-schema-resolver.test.mjs` 与 Artifact 测试合并复核共 19/19 | 其他根合同/嵌套 Schema resolver 错误组合和 executionPolicy 全边界仍待补，阶段 1 保持部分通过 |
| 阶段 2：Loop-scope Join timeout | 通过（单 Loop、单 Loop-scoped `all_of` 切片） | `src/team-ir/runtime.ts` 在成员来源激活时持久化 round deadline、恢复时重挂 waiter、timeout 时取消活跃来源并失败收敛；`tests/team-ir-loop-join-runtime.test.mjs` 覆盖 Fake Clock deadline=150、FileTeamRunStore 新实例在 125/149 不超时、150 超时。`pnpm build`、`node --test tests/team-ir-runtime.test.mjs tests/team-ir-loop-join-runtime.test.mjs`：34/34 | Loop quorum、多 Loop/嵌套、条件来源及不同 lineage 隔离仍未实现或未覆盖；阶段 2 保持部分通过 |
| 阶段 2：Run input Artifact 授权不可变 | 通过（File/Memory 授权合同切片） | `src/team-ir/artifact-store.ts`：同一 Project/Run 的相同授权清单幂等、不同清单拒绝；File backend 用同目录 create-if-absent 链接线性化跨实例并发。`tests/team-ir-artifact-store.test.mjs` 验证竞争只有一个获胜、获胜清单可读且失败方未获授权；Artifact Store 7/7 | 未注入进程崩溃/fsync 故障；Artifact blob 成功写入但索引提交失败可能遗留孤儿 blob；不代表 Artifact/Run checkpoint 跨存储原子提交 |
| 阶段 4：Team IR 变更/删除后的历史 Run 查询 | 通过（查询只读与冻结 digest 切片） | `apps/team-site/tests/team-ir-history-after-source-change.test.mjs` 使用真实 Project Run executor、会诊 v2 fixture 和 Fake Bindings 完成 Run；把源 Team IR 改为新 packageRef、再删除后，Run detail/events/result API 均仍返回原 owner digest、事件及历史结果，且查询不依赖现行 IR；测试 1/1 | 持久化 Run 证据包含 Team IR semantic digest 和 compiled plan digest，不含完整 `CompiledTeamPlan` 文档；真实 Sandbox 后查询及终态只读 API 矩阵仍待验收 |
| 经典团队真实 Sandbox UAT | 受阻 / 未运行 | 本轮检查：`OGS_TEAM_IR_V2_RESOLVER_MODULE` 未配置；`codex login status` 为 `Not logged in`；`opencode auth list` 为 0 credentials；当前进程环境没有 OpenAI/Codex API key 环境变量。真实 UAT 需可信 resolver、有效模型认证和可执行 Sandbox Binding | 配置可信绝对路径 resolver 和真实模型认证后，完成 Studio 保存/重开、Sandbox 模拟、发布、项目挂载、真实 Task 成功及受控失败/重试、重启查询和人工结果审核；Fake 不计真实 UAT |

本轮聚焦回归：`node --test tests/team-ir-artifact-store.test.mjs tests/team-ir-index.test.mjs tests/team-ir-schema-resolver.test.mjs`，19/19；Loop Join 切片 `pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-loop-join-runtime.test.mjs`，34/34；历史 Run 专项测试 1/1。完整仓库 `pnpm test`：855 项，854 通过、0 失败、1 项 Windows PowerShell/CMD 专项在 macOS 跳过，退出码 0。Team Site 全量串行回归 `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot` 退出码 0，包含新增历史 Run 查询用例；dot reporter 不输出精确计数。
阶段结论：阶段 0 通过；阶段 1 部分通过；阶段 2 部分通过；阶段 3 进行中；阶段 4 进行中且默认切换关闭。真实 Sandbox UAT 仍受阻，不得宣称发布完成。

### 2026-10-28：Studio 诊断定位与 v2 Review API

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：公开校验入口嵌套 Schema resolver 诊断 | 通过（missing/out-of-scope/forbidden 窄矩阵） | `tests/team-ir-index.test.mjs`：`public validator preserves nested Schema reference pointers for missing, out-of-scope and forbidden refs` 精确断言 `IR_UNKNOWN_SCHEMA_REF`、`IR_SCHEMA_PATH_OUT_OF_SCOPE`、`IR_SCHEMA_REF_FORBIDDEN` 与 `/runInput/dataSchema/properties/payload/$ref`。`pnpm build && node --test tests/team-ir-index.test.mjs tests/team-ir-schema-resolver.test.mjs` 13/13 | 阶段 1 仍缺完整 endpoint-kind/field 诊断矩阵、复杂 Schema 组合、执行预算/结果组合和闭包漂移矩阵 |
| 阶段 3：Studio 诊断 pointer 可操作定位 | 通过（当前 v2 表单与高级合同编辑器切片） | `apps/team-site/public/app/views/app.js` 将诊断 pointer 映射到基础 Team/Agent/Handoff 控件，端口/高级语义定位到 JSON 合同选区；支持 JSON Pointer `~0`/`~1` 转义，未知结构退化到高级 JSON 开头。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 覆盖基础映射定位、Review timeout 的 `0` 选区和含 `/`、`~` key 的嵌套路径。`pnpm build && node --test apps/team-site/tests/team-ir-studio-browser.test.mjs` 1/1 | 事件桩画布/直接连线、自动映射、完整 Join/Loop 可视化编辑及完整作者流程仍未完成 |
| 阶段 3：Team IR v2 Review owner-scoped API | 部分通过 | 新增独立 GET/POST `/api/v1/projects/:projectId/tasks/:taskId/runs/:runId/team-ir-reviews/:reviewId`；校验当前 Task/Run owner 与 Team IR semantic/compiled digest，ReviewRuntime 承接 authenticated reviewer、revision CAS、幂等和 feedback Schema；可信 resolver 可选导出 `resolveTeamIrReviewContext`，未提供时 fail closed。`apps/team-site/tests/team-ir-review-api.test.mjs` 与 resolver 测试覆盖 owner、授权、错误 feedback、stale revision、legacy route 隔离和 runtime unavailable。 | 生产 resolver 未配置；Task waiting-review 状态映射、同一 FileTeamRunStore checkpoint 重建与 resume 调度桥、浏览器审核流程未接线；因此此项不构成生产 Review 完成 |

本轮聚焦回归：`pnpm build && node --test tests/team-ir-index.test.mjs tests/team-ir-schema-resolver.test.mjs apps/team-site/tests/team-ir-v2-resolvers.test.mjs apps/team-site/tests/team-ir-review-api.test.mjs apps/team-site/tests/team-ir-studio-browser.test.mjs`：20/20，退出码 0。新增该批用例后重跑 `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot` 退出码 0；`pnpm test`：856 tests，855 pass、0 fail、1 Windows-only skip，退出码 0。
阶段结论：阶段 0 通过；阶段 1 部分通过；阶段 2 部分通过；阶段 3 进行中；阶段 4 进行中且默认切换关闭。真实 Sandbox UAT 仍受 resolver/模型认证条件阻塞。

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
