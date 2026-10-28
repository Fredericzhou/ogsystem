# Team IR v2 落地与验证台账

基线日期：2026-10-29
状态：实施中；阶段 0、1 通过，阶段 2 部分通过，阶段 3、4 进行中；结构化辩论、Maker-Checker、Software Team adapter /3、条件会签、阶段放行 PASS/REJECT 的真实 Project Task UAT、Run-scope 多 Join、Loop-scope quorum、Studio 自由布局端口画布与 Artifact/Run 可恢复发布协议新增通过；远端 A2A 和其他发布门仍未完成
范围：记录 Team IR v2 从设计批准到发布切换的实施状态、验证证据和未完成项。

## 1. 使用方式与权威来源

本文件是推进台账，不是第二份规范。字段、诊断、运行状态和产品边界以[Team IR v2 Handoff 设计方案](team-ir-handoff-v2-design.md)为准；架构选择以[协作边界 ADR](adr-team-ir-collaboration-boundaries.md)为准；面向用户的场景说明以[社会分工协作设计理念](../usage/team-ir-social-collaboration.md)为准。

本节后的日期记录按发生时的代码和证据保存；较早记录中的“未开始/受阻/未配置”是历史快照。判断当前状态以第 2、3 节和最新日期记录为准。

每次实施工作都更新本文件：开始前确认阶段和验收项；完成后记录代码位置、测试命令、结果、日期和未覆盖边界。不能用旧版能力相似、单元测试通过或文档写完来代替 v2 自身验收。

状态含义：

- **未开始**：没有 v2 实现和有效验收证据。
- **进行中**：实现或验证正在进行，至少有一项验收未完成。
- **部分通过**：有明确通过项，但仍有必需验收项未完成。
- **通过**：该阶段全部门槛通过，证据已记录，相关文档与实现一致。
- **受阻**：存在明确外部依赖或无法由当前工作继续解决的问题；必须记录影响、已完成部分和解除条件。

不得将未验证写成通过。测试失败、未运行、跳过和环境阻塞必须分别记录；不得只记录最后一次成功而删除相关失败证据。

## 2. 当前基线

截至 2026-10-29，本仓库已建立 Team IR v2 Schema、Compiler、Runtime、Studio/API、Sandbox resolver 与 8 个最新经典场景 fixture。旧 Team 作者/运行模块正在清理，standalone OGSystem System/CLI 仍有独立用途，不作为 Team 配置或执行路径。旧测试只在明确验证遗留拒绝/无副作用时保留，不能替代 v2 语义证据。

| 项目 | 状态 | 当前证据或限制 |
| --- | --- | --- |
| Team IR v2 设计方案 | 已冻结为实施基线 | `docs/development/team-ir-handoff-v2-design.md`；阶段 0 语义复核完成，包含并行 Review、A2A 暂停/兄弟调用、重试/deadline 与失败竞态决策 |
| 协作边界 ADR | 已批准为实施基线 | `docs/development/adr-team-ir-collaboration-boundaries.md` |
| v2 Schema / Compiler / Runtime | 部分通过 | 阶段 1 Schema/Compiler 静态合同已通过设计 §10 阶段门审计（86/86 聚焦测试）；阶段 2 Runtime 仍部分通过。多个独立 Run-scope `all_of`/`quorum_of` Join、单 Loop-scope quorum、无 Loop/Join 的 Run-entry parallel fan-out + 多独立 Review gate、Run-scope all-of Join 目标 Review 和 Artifact publication intent/CAS/恢复协议已支持。一般 Loop 多 lineage、更多 Review/Join 组合、跨进程活动调用和 prepared Artifact 物理回收仍未闭合，见追溯矩阵 |
| Studio v2 作者体验 | 进行中 | `/studio/new` 创建原生 v2，团队版本进入 `/studio/teams/:id/ir`；保存重开、诊断定位、窄屏、自由布局端口画布、多 input/output port 的 Schema/Artifact slot 编辑、Review gate 创建/编辑、高级 JSON 同步及 Simulation Run input 基础标量表单均有浏览器证据。引用中的 Agent/port 删除会阻止并说明原因；完整生产发布浏览器矩阵、Review 身份 UAT、诊断全矩阵、复杂条件/映射的渐进式结构化编辑仍未闭合 |
| v2 端到端或发布验收 | 部分通过 | 真实 Docker/OpenCode resolver 已完成 Release Gate、Artifact Evidence、专家会诊、条件会签、结构化辩论、Maker-Checker reject/revise/approve 和软件交付 fan-out/Join 的 Project Task。Software Team adapter /3 Project Task 已成功完成且结果写入；此前 adapter /2 两次失败记录保留作历史，见本日 UAT 记录。Artifact 输入固定快照、同 Run Review 恢复、幂等重放与重启查询已有真实 UAT。Maker-Checker 使用本机 OS principal，不代表独立审核用户/外部身份服务。Artifact Evidence provenance、远端 A2A 和全部经典场景矩阵仍未通过 |

## 3. 实施与验收状态

每个阶段按设计方案第 9 节实施，按第 10 节验收。下表是推进索引；通过前须把具体证据补到第 5 节的日期记录中。

| 阶段 | 主要交付 | 必须通过的门槛 | 状态 |
| --- | --- | --- | --- |
| 0. 设计冻结 | 批准根 Schema、术语、ADR 和版本兼容策略 | 设计评审清单无未决语义冲突；规范示例和运行/API 规则一致；审批状态明确 | 通过 |
| 1. Team IR 包 | `src/team-ir/` 类型、Schema、解析器、引用解析、静态校验、诊断、规范化和 digest | 设计方案第 10 节所有阻断语义有稳定 code/pointer 与正反例；复杂 Schema 由运行时校验承接，不要求静态任意蕴含推理 | 通过；阶段 1 审计及 86/86 聚焦测试确认硬门闭合，见 2026-10-29 阶段 1 追溯复核记录 |
| 2. Compiler / Runtime | `CompiledTeamPlan`、端口投影、Handoff、Join、Loop、审核、错误、Artifact、Checkpoint 和恢复 | 支持拓扑的状态机与恢复合同通过；明确拒绝的拓扑不能算支持；所有并行故障、Result/Artifact 及 A2A 边界符合设计 | 部分通过；独立 Run-scope 多 Join、单 Loop/Loop-scope quorum、Run-entry fan-out + 多 Review、Run-scope all-of Join 目标 Review 和 Artifact publication intent/commit 恢复已支持；其它 Review/Join/Loop 组合、一般 Loop 多 lineage、prepared Artifact 回收和跨进程活动调用恢复仍未闭合 |
| 3. Studio / 发布 | Team IR 作者模型、预检、编辑、模拟、发布、读取与重开 | Studio 与服务端诊断和 digest 一致；浏览器覆盖当前入口/窄屏；生产 resolver 下完成保存、发布、Project Task 和 Review 用户流程 | 进行中；自由布局端口画布、多端口合同、Review gate 编辑和 Simulation Run input 基础标量表单已有浏览器合同；Review 用户流程和完整生产发布浏览器矩阵未闭合 |
| 4. 切换与清理 | CLI/API/Studio 默认入口、最新经典团队集、模板、示例和文档切到 v2 | 干净 workspace 下创建、保存、发布、挂载、运行和查询；旧 Team 配置不迁移、不覆盖无关路径 | 进行中；默认创建、fork、Case/template 已切 v2；无调用方旧 Team Author/Run 模块已清理；standalone OGS System/CLI 有独立用例而保留；远端 A2A 真实 UAT 未闭合 |

### 阶段门

- 阶段 0 已冻结；实现可据此推进，但新发现的合同缺口必须经设计复核并留下变更记录。
- 阶段 1 未通过前，不开始依赖未冻结语义的 Studio 大规模实现；确需并行时记录风险和受影响合同。
- 阶段 2 未通过前，不把 v2 场景描述为端到端可用。
- 阶段 3 未通过前，不切换默认产品作者入口。
- 阶段 4 未通过前，不宣称最新 v2 发布完成。
- 阶段间可以有经评审的并行工作，但不得跳过前置合同、验收证据或最新版本入口/API 合同矩阵。

## 4. 验证要求

### 自动化验证

- **Schema / Compiler**：每条规范规则至少有合法正例、非法反例和稳定诊断断言；静态无法证明的情况必须断言运行时校验提示。
- **Runtime 状态机**：使用确定性 Fake Binding，不依赖真实模型、网络时序或不可控服务。断言终态、激活集合、Join 来源状态、结果写入次数、审计事件和 checkpoint 内容。
- **恢复与幂等**：对关键状态边界注入中断，验证恢复不重复执行已提交副作用、不改变路由选择，并验证编译闭包变化时拒绝继续。
- **Studio / API**：分别覆盖服务端合同与真实浏览器交互；保存后重载并比较规范化 IR、诊断和 digest。
- **版本边界**：验证最新版本只创建/读取 v2 Team IR，不迁移或覆盖无关数据；不要求读取旧 Team 配置或历史 Run。Artifact 授权仍须验证越权读取失败。
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
| 最新经典团队真实运行集 | 完整场景定义见设计方案 §10.1；至少覆盖软件交付与 Artifact、条件会签与同端点候选 Handoff、结构化辩论 Loop、Maker-Checker Review/revise、远程 A2A 补件、阶段放行与结果策略。不限于当前三例，可新增场景 Team | 每个场景的隔离 Sandbox Project Task 记录、Team/Plan digest、模型与 Binding 标识、Project/Task/Run ID、关键角色/Join/Review/Loop/A2A/Artifact 状态、失败/重试或恢复证据、人工检查结论 |

每个场景都需列出前置条件、输入、预期状态变化、预期终态、失败分支、证据链接和未覆盖范围。演示成功不能替代失败路径验收。

#### 最新版本范围澄清（2026-10-28）

最新版本按全新设计交付，不承诺读取或运行历史 Team 配置和历史 Run，不提供兼容层或迁移流程。历史 Run 查询和旧 API 兼容测试是既有证据记录，不再是阶段 4 的发布门槛；最新版本新建/发布流程不得主动迁移、改写或删除用户无关文件。阶段 4 只验最新格式入口和新 workspace 全链路。

#### v2 语义覆盖追溯

设计方案第 10 节的每一项适用验收语义都必须能追溯到至少一个 fixture/测试、断言和结果记录；不得用本节的场景名称或一次真实运行概括性地替代逐项覆盖。实现阶段应维护逐项矩阵，包含设计方案条目、测试/fixture ID、覆盖层级（Schema、Compiler、Runtime、API/Studio、真实运行）、通过证据和未覆盖状态。若某项不适用，须记录理由及评审结论；若由多项测试共同覆盖，逐项列明，不留无主条目。

以下矩阵保留阶段 1 各切片首次补齐时的窄范围状态和证据，逐条对应设计方案第 10 节。2026-10-29 阶段门复核确认各适用阻断语义均有合法正例、非法反例、稳定 code/pointer 或复杂 Schema runtime warning/调用前校验；阶段 1 聚焦测试 86/86 通过，因此这些历史行中的“部分”表示该次切片的范围，不再代表阶段 1 当前未完成。未穷举的笛卡尔组合不是设计硬门；静态任意复杂 Schema 蕴含推理也不是本合同。此结论不扩展为 Runtime、API、Studio 或真实 UAT 通过。测试文件名后的测试标题是断言 ID；阶段 2–4 实施时须在对应行追加新证据和命令结果。

| 设计方案第 10 节条目 | 当前覆盖与精确测试证据 | 状态 / 尚缺证据 |
| --- | --- | --- |
| IR Schema：合法 v2 | `tests/team-ir-schema.test.mjs`：`Team IR v2 schema declares Draft 2020-12 and accepts a minimal document`、`public Schema validator accepts every latest classic Team IR fixture` | 完整根 Schema 接受最小合法文档和 8 个最新经典 fixture；其它非法字段矩阵见下列各条 |
| IR Schema：重复 ID | `tests/team-ir-validation.test.mjs`：`cross-reference validation reports duplicate semantic IDs and unknown references` | 已有静态诊断断言 |
| IR Schema：Binding kind 与后端引用互斥 | `tests/team-ir-schema.test.mjs`：`Binding kind accepts exactly its matching backend reference` | Schema 覆盖 model/tool/a2a 合法正例及六种不匹配引用反例；build 与 Node 测试通过，最近定向命令见 2026-10-29 记录 |
| IR Schema：未知端点/端口/Binding | `tests/team-ir-validation.test.mjs`：`cross-reference validation reports duplicate semantic IDs and unknown references`、`Handoff and route endpoint references diagnose each unknown Agent and port at its field pointer` | 部分；未知 Agent/port/Binding 有精确诊断，Handoff from/to 与 route from 的六个 Agent/port pointer 已断言；Run/Result endpoint discriminator 非法组合仍由 Schema 非法端点行追踪 |
| IR Schema：非法端点类型 | `tests/team-ir-schema.test.mjs`：`endpoint schema rejects implicit endpoints and malformed agent ports`、`Handoff endpoint kinds and Run/Result endpoint fields are exact` | 部分；Run/Result kind、Run source 混入 Agent 字段、Result target 混入 Agent/未知字段，以及 Agent source/target 必需字段和额外字段均有精确 pointer 反例；尚未穷举所有 schema `oneOf` 交叉组合 |
| IR Schema：无效 Schema 引用 | `tests/team-ir-schema-resolver.test.mjs`：`rejects missing resources, pointers and malformed pointer escapes`、`rejects network, absolute, escaping and unsupported Team-local references`、`fails closed for network refs hidden inside a referenced schema closure`；`tests/team-ir-index.test.mjs`：`public validator maps package-closure resolver failures to each embedded reference pointer` | 部分；公开 `validateTeamIr` 对 6 类嵌入 Schema 根逐一覆盖包内闭包的 missing/forbidden/out-of-scope/unsupported-dialect/invalid typed error，精确映射至发起 `$ref` pointer，并有合法嵌套闭包对照。Resolver error code/pointer 集成代表矩阵通过；尚未穷举所有 `$ref` pointer grammar、闭包深度与交叉组合 |
| IR Schema：runInput/runResult | `tests/team-ir-schema.test.mjs`：最小文档、缺失 root contract 断言；`tests/team-ir-payload-validation.test.mjs`：Run input、Agent input/output、Result 与 Review feedback payload 校验；`tests/team-ir-result-mode.test.mjs`：result Schema 失败路径 | 部分；运行时 payload 校验与结果模式有证据；完整结构字段边界、Artifact result 合同及全部非法 Schema 组合仍待补 |
| IR Schema：executionPolicy | `tests/team-ir-schema.test.mjs`：最小合法文档；`runtime budget, deadline, attempt, and backoff durations use positive integer boundaries` 对 execution budget、Handoff deadline、attempt timeout、maxAttempts 和 backoff delay 精确断言 0/负数/小数/null/string/boolean 均在字段 pointer 报错，并验证最小值 1；`tests/team-ir-validation.test.mjs`：required-result 静态约束；`tests/team-ir-result-mode.test.mjs`：`allow_empty` 零结果完成、非法结果失败和 required 零结果失败 | 部分；正整数域类型/下界矩阵已有代表性 Schema 证据；结果策略其他终态组合和更复杂的策略组合仍待补 |
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
| Schema 边界：type/required/items | `tests/team-ir-mapping-validation.test.mjs`：`source optionality and simple type direction are checked against required targets`、`array index references honor items, tuple positions, minItems and maxItems`、`array construction checks tuple item positions and forbidden extra items`；`tests/team-ir-payload-validation.test.mjs`：`payload validator reports stable runtime diagnostic codes and JSON Pointers` 精确区分缺失属性与显式 `null` | 部分；object/type/required 与 array `items`/tuple 专项边界有断言；完整组合 Schema 不做静态蕴含推理，须由运行时 validator 覆盖 |
| Schema 边界：optional source 到 required target 拒绝 | 同上 | 已有静态拒绝断言 |
| Schema 边界：复杂 Schema 运行时校验提示 | `tests/team-ir-mapping-validation.test.mjs`：`complex target constraints retain a runtime validation warning`；`tests/team-ir-payload-validation.test.mjs`：`complex oneOf, not, and if-then-else constraints warn at compile time and reject invalid payloads at runtime` 精确断言 warning `/handoffs/0/map/data/prompt` 与 runtime error `/agents/0/inputPorts/draft/dataSchema/prompt`；`tests/team-ir-runtime.test.mjs`：`invalid mapped input fails before Binding invocation and invalid output fails before delivery` | 部分；复杂 Schema warning、payload validator 与本地 TeamRuntime 调用前拒绝均有精确字段 pointer 证据；其它 payload 根和生产 Project Task 全面接线仍归阶段 2–4 |
| Schema 边界：调用前校验失败 | `tests/team-ir-payload-validation.test.mjs`：`invalid mapped Agent input can be rejected before the Binding invocation`；`tests/team-ir-runtime.test.mjs`：`invalid mapped input fails before Binding invocation and invalid output fails before delivery`；`apps/team-site/tests/team-ir-project-run-executor.test.mjs`：Task 输入合同在 Binding 前拒绝 | 通过（调用前验证窄合同）；模型输入/输出与 Project Task 都在执行前校验。完整 release/Task 场景覆盖仍归阶段 2–4 |
| Join：精确 `handoffIds`、目标端口、游离入边 | `tests/team-ir-validation.test.mjs`：`Join accepts the exact inbound Handoff set and rejects omitted or unrelated IDs`、`Join requires exact incoming source and valid target ports` | 已覆盖精确全集、漏声明/无关来源、目标端口和游离入边的代表性正反例；其它 Join/Loop 组合见 Runtime 行 |
| Join：单边缺必填豁免 | `tests/team-ir-mapping-validation.test.mjs`：`Join single-source contribution is checked with baseMapping as one complete field union` | 已有单来源正例与 baseMapping 字段并集检查；多来源 optional/required 组合见 Join 来源行 |
| Join：条件必需来源约束 | `tests/team-ir-mapping-validation.test.mjs`：`Join detects duplicate providers, missing required contributions and optional conditional sources`、`Join required fields cannot rely on a source behind a conditional Run route`、`Join required fields cannot rely on a source Agent with no guaranteed activation path` | 部分；必达性静态拒绝已覆盖；所有 route/Loop/Join 条件组合待补 |
| Join：字段并集、重复字段拒绝 | `tests/team-ir-mapping-validation.test.mjs`：Join 重复 provider；`tests/team-ir-join-artifact-runtime.test.mjs`：all_of/quorum provenance 与 allowlist；`tests/team-ir-join-runtime.test.mjs`：合并、冲突和越权来源；`tests/team-ir-runtime.test.mjs`：Agent 调用前输入校验与 Join 目标 Review | Runtime 已将 Join 合并接入 Agent 输入与 Schema 校验；Artifact 可见性通过 RunRecord publication intent 恢复，物理孤儿回收不在当前协议内 |
| Join：`all_of` optional skip / required skip / 零到达 | `tests/team-ir-join-runtime.test.mjs`：reducer skip/零到达；`tests/team-ir-runtime.test.mjs`：`Join tracks selected and skipped Handoffs separately when candidates share one source endpoint`；`tests/team-ir-loop-join-runtime.test.mjs`：同端点候选逐 Handoff 状态与 Loop round | scheduler 已按 Handoff ID 持久化 `pending/arrived/skipped` 并覆盖同 source endpoint 多候选；Loop/Join 其它组合仍按拓扑限制处理 |
| Join：`quorum_of` 早触发 / 不可达 / 迟到来源 | `tests/team-ir-join-runtime.test.mjs`：reducer threshold/late-arrival tests；`tests/team-ir-runtime.test.mjs`：`quorum Join starts at threshold and persists the selected contributions and original deadline across FileTeamRunStore instances`、`quorum Join fails when conditional source skips make the threshold unreachable`、`an active quorum sibling failure after target activation still fails the Run`、`independent quorum and all_of Joins execute and persist separate rounds`；`tests/team-ir-loop-join-runtime.test.mjs`：bounded Loop quorum threshold/late/timeout/recovery | 多个独立 Run-scope Join 和单 Loop/单 Loop-scope quorum Join 在受限拓扑内均支持早触发、持久选中来源、忽略迟到合并贡献、条件 skip 不可达失败、活动 sibling 失败和原 deadline 恢复；Review 混合、多个 Loop 和一般 lineage 拓扑仍未支持 |
| Join：timeout 起点、恢复与迟到幂等 | `tests/team-ir-join-runtime.test.mjs`：`a late source arrival cannot mutate a failed timeout Join round`；`tests/team-ir-runtime.test.mjs`：all_of/quorum scheduler timeout 与 collecting round 恢复；`tests/team-ir-loop-join-runtime.test.mjs`：`Loop-scoped all_of Join timeout fails the Run and cancels active round sources`、`FileTeamRunStore recovery preserves a Loop Join round deadline and waits only the remaining time`、round checkpoint 恢复 | Run-scope all_of/quorum 与受限 Loop-scope all_of 的 deadline/剩余时间恢复有证据；失败终态忽略所有后续 arrival，保持 source state/contributions/merged/result 与失败 checkpoint 不变；其它不支持拓扑仍 fail closed，活动 invocation 崩溃的跨进程恢复边界另见 Runtime |
| Loop：draft/revise 端口及上一轮 data/Artifact 引用 | `tests/team-ir-reference.test.mjs`：`parses the supported root paths and array indexes`；`tests/team-ir-validation.test.mjs`：`Loop declarations validate members, disjoint boundary sets and edge direction` | 部分；路径解析和 Loop 边界结构有覆盖，端口策略与 Artifact 执行未覆盖 |
| Loop：支配关系通过/拒绝、首轮历史缺失 | `tests/team-ir-mapping-validation.test.mjs`：`Loop previous reference passes when the anchor dominates the reader in the Loop DAG`、`Loop previous reference rejects a bypass path, external initialization and conditional route`、`Loop previous references fail closed across Join aggregation and multi-lineage fan-out` | 部分；通过/绕过/外部初始化/条件路由有精确 pointer；同 Scope Join 与多内部分支 fan-out 明确拒绝，不宣称支持其 lineage 证明；首轮实际历史读取需 Runtime 证据 |
| Loop：前轮零次/多次执行、陈旧值拒绝 | `tests/team-ir-runtime.test.mjs`：单 lineage bounded rounds / exhaustion / unsupported topology tests；`tests/team-ir-loop-join-runtime.test.mjs`：classic structured debate 两轮 Loop-scoped all-of Join 和 checkpoint recovery | 部分；单 Scope/lineage 串行及特定单 Loop + 无条件成员内 all-of Join / boundary fanout 有 Runtime 证据；条件 Loop Join 来源、多 Loop/嵌套和一般多 lineage 仍以 `TEAM_LOOP_TOPOLOGY_UNSUPPORTED` fail closed，未证明支持 |
| Loop：耗尽与恢复 | `tests/team-ir-runtime.test.mjs`：`Loop executes bounded sequential rounds and resolves only the immediately previous output`、`scheduler checkpoint resumes from a completed invocation across FileTeamRunStore instances without repeating the Binding call`、`scheduler recovery cancels an active invocation and settles an unknown outcome without replay`、`active Run re-entry without a scheduler checkpoint is rejected without side effects`；`multiple independent all_of Joins recover after a ready round checkpoint` | 部分；scheduler 持久化 pending/source/skipped/arrived/visited、invocation ID 和 Loop 轮次/激活/历史；File Store 第二实例恢复 completed 输出不重放 Binding，active invocation cancel 未确认时以 `outcomeUnknown` 失败结算；多 Join ready checkpoint 恢复不重放来源；缺少 checkpoint 的不完整 Run 明确拒绝。Artifact 输出登记现由 RunRecord intent 与 Artifact prepared/committed 状态恢复；CAS 前孤儿回收、跨进程活动调用通用恢复和外部 Binding 副作用 exactly-once 未覆盖 |
| Runtime：本地结构化 handoff、条件 Run 入口、结果写入/收敛/冲突 | `tests/team-ir-runtime.test.mjs`：路由/Join/result、`a cancellation intent that wins the Result CAS race prevents Result commit`、`a crash before terminal commit keeps Result private and recovery commits it without repeating the Binding`、`a lost response after terminal Result commit returns the committed Result without replay`；`tests/team-ir-result-mode.test.mjs` | 单 RunRecord 的 Result/终态 CAS、崩溃恢复和丢失响应重放通过；并行 Result 写入另由静态诊断拒绝。一般并行失败/取消收敛竞态仍不完整 |
| Runtime：Artifact 来源、越权拒绝、受控登记与可恢复发布 | `tests/team-ir-runtime.test.mjs`：授权 Artifact refs、只读 resolver、受控登记、CAS 前后故障、Run CAS 丢失响应恢复及进程重启提交恢复；`tests/team-ir-join-artifact-runtime.test.mjs`：all_of/quorum provenance/allowlist；`tests/team-ir-artifact-store.test.mjs`：prepared 不可见、blob/index 故障、跨实例所有权与完整性 | RunRecord 持久 publication intent 是可见性提交点；prepared Artifact 不可授权读取，恢复会幂等完成 Artifact commit。CAS 前崩溃仍可能留不可访问 prepared blob/index，物理回收和任意外部副作用 exactly-once 不在当前合同内 |
| Runtime：无效输入失败关闭 | `tests/team-ir-payload-validation.test.mjs`、`tests/team-ir-runtime.test.mjs`；`apps/team-site/tests/team-ir-project-run-executor.test.mjs`：缺失必需 Run input Artifact 在 Binding resolution 前拒绝 | 本地 Runtime 与 Project Task executor 均有 fail-closed 证据；真实模型 UAT 是组合验证，不替代所有 Schema 错误组合 |
| Runtime：Review 暂停/批准/拒绝/反馈/timeout/预算冻结 | `tests/team-ir-review-runtime.test.mjs`：授权、revision、approve/reject 幂等、feedback 校验、独立 deadline、取消、File Store 跨实例与竞争 CAS；`tests/team-ir-runtime.test.mjs`：串行 Review、平行独立 Reviews、`Review on a Run-scope all_of Join target uses its own deadline and resumes after FileStore restart`、reject/timeout fail closed | 串行 gate、Run-entry fan-out 每分支一个 Review、以及唯一 Run-scope all-of Join 目标 Review 有 FileStore 恢复证据；Join deadline 到期后 Review 仍按独立 deadline 等待，批准不重放来源/目标并只写一次 Result。其它 Review/Join/Loop/Agent-source fan-out 组合仍 fail closed/未支持；生产 Sandbox 独立审核身份 UAT 未完成 |
| Runtime：deadline、Binding 重试耗尽、错误归属、取消、checkpoint replay | `tests/team-ir-runtime.test.mjs`：单调用 lifecycle/CAS/checkpoint、Artifact publication intent 故障注入；`tests/team-ir-fail-fast-runtime.test.mjs`：并行 fail-fast sibling cancel、迟到响应审计和 outcomeUnknown | 首个 Run failure intent 不被 sibling cancel 错误覆盖；pending Result 在 FileStore 新实例恢复后只提交一次 Result/Completed 事件且 Binding 不重放；Artifact publication 经 Run intent 和 FileStore 新实例恢复。Runtime/fail-fast/Join 定向测试仍有未闭合的任意 Join/quorum/Review 竞态、跨进程活动调用和完整 scheduler 中断点 |
| Runtime：生产 Project Task v2 执行 | `apps/team-site/tests/team-ir-project-run-executor.test.mjs`、Task retry/recovery 测试；本机真实 UAT 记录见 2026-10-29 条目 | 固定 Docker/OpenCode resolver 已接入，真实 Task 完成/失败/重启查询有场景证据；Review、内容质量、全部经典场景和生产级 egress 隔离仍未闭合 |
| A2A：Agent Card、Task 状态、Message Parts/Artifact、deadline、幂等 | `tests/team-ir-a2a-binding.test.mjs`：pin/状态/Artifact/deadline/idempotency；`src/team-ir/a2a-http-client.ts` 与 `tests/team-ir-a2a-http-client.test.mjs`：官方 `@a2a-js/sdk@1.3.0` client、origin/auth 限制、Parts/Task 映射、错误脱敏及 SDK Server localhost E2E；Team Site resolver pin drift | 本地 HTTP/官方 SDK interoperability 合同 20/20；仍缺跨进程持久远端幂等缓存、已配置的真实 HTTPS Agent Card/认证和兼容远端服务真实 UAT |
| A2A：`input-required` 暂停、请求暴露、不可 Resume、取消/新 Run、completed/failed/canceled | `tests/team-ir-runtime.test.mjs`：`A2A input-required durably pauses, cancels fanout siblings, rejects resume, and requires a new Run for changed input`、`a restarted Runtime cancels a persisted A2A input-required task and settles the Run`；`tests/team-ir-a2a-binding.test.mjs`：persisted remote Task ID cancel；`apps/team-site/tests/team-ir-project-run-executor.test.mjs`：owner-scoped pendingInput、Task control 远程取消、无成功结果及事件不含请求正文 | 持久暂停、同 Run 不可续跑、新输入需新 Run、owner-scoped 请求查询和产品 Task 取消现有确定性证据；跨进程活动 sibling 收敛与远端 HTTP 服务持久幂等缓存仍未完成；真实远端 UAT 受无兼容服务阻塞 |
| Studio：连线/自动映射/缺项定位/Handoff/Join/Loop/Review 编辑/发布诊断 | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：多 input/output port 增删、完整 data Schema/Artifact slots JSON、引用端口/Agent 删除阻断、保存重开/digest 和非首端口 Handoff；字段映射/建议、Join/Loop/Review 字段、高级 JSON 往返、Review 无效位置 preflight、自由布局端口画布和诊断定位；`apps/team-site/tests/team-ir-use-cases.test.mjs`：服务端校验/保存 | 部分；Review gate 和多端口合同结构化编辑、自由布局画布已有浏览器合同；复杂映射、Join `baseMapping` 和其它复杂合同继续用高级 JSON；全部诊断 code/pointer、完整发布与独立 Review 身份矩阵仍未闭合 |
| Studio：窄屏、保存重开、digest | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：真实 Playwright 保存/重开、semanticDigest、390px 无横溢、Simulation、Fake resolver 发布阻断/成功及发布后只读 | 部分；已覆盖 Fake resolver 下的 simulation/release 浏览器合同，但不是生产 resolver 或真实 Sandbox UAT；完整关闭/重启后重新打开验收仍待补 |
| 数据边界：旧配置拒绝且不迁移 | `apps/team-site/tests/team-ir-legacy-compatibility.test.mjs`：旧配置不会创建 Team IR 文件；旧 `/design`、`/graph`、`/chat`、release baseline API 由 `team-routes.mjs` 统一 409 拒绝；旧 TeamVersion 发布失败且 workspace tree digest 不变 | 部分；拒绝与无写入已有合同证据；最新入口的完整创建/发布/挂载/Task 矩阵和遗留本地数据清理仍未闭合 |
| 数据边界：创建/发布不改 `.ogs/runs/`、无迁移副作用 | `apps/team-site/tests/team-ir-legacy-compatibility.test.mjs`：legacy `.ogs/runs/run-old` 树 SHA-256 在 IR read/validate、拒绝发布、拒绝挂载、拒绝 Task 创建前后不变，且未创建 IR 文件；有效 Project Task 历史 Run 经 Recent Run 读取前后 `.ogs/runs/` SHA-256 不变 | 部分；历史内容只读与拒绝边界副作用有本地证据；尚未覆盖 Team IR 变更/删除后历史查询 API 仍可读取绑定原快照，也未覆盖真实发布/真实 Sandbox 后历史 Run 查询 |
| 发布：活动模板/示例/默认入口为 v2 | 入口与模板 inventory 及切换验收矩阵见下方“阶段 4 入口与模板 inventory” | 默认创建、版本 fork、8 个活动 Case fixture 和 built-in template provisioning 已使用原生 v2；8 个 Case 的 provisioning 失败补偿已有测试。所有场景逐一真实 Project Task UAT、遗留作者代码删除和完整新入口验收仍未完成 |
| 发布：Compiler/API/Runtime/Team Site/浏览器验收 | Team IR 聚焦测试、Team Site IR API/Project executor 测试及一项 v2 Studio browser 测试 | 部分；各自垂直切片存在；没有生产 closure/evidence/Binding 注入下的端到端发布与 Project Task 真实运行 |
| 发布：`git diff --check` | 每次变更后运行并记录 | 工程卫生检查，不替代任何语义覆盖 |

**阶段 1 边界说明：** `tests/team-ir-schema.test.mjs`、`tests/team-ir-validation.test.mjs`、`tests/team-ir-mapping-validation.test.mjs` 已对 `validate.ts`、`mapping-validation.ts` 发出的阻断诊断 code 建立逐类断言和精确 JSON Pointer，覆盖 route 源/候选一致性、fallback/condition、Join target/scope/quorum、Loop boundary、mapping reference/schema/Artifact 与 Join/Quorum 字段分支；Loop previous dominance 限定在无环单 lineage DAG，Loop 内 Join 汇聚或多内部分支 fan-out 均以 `IR_LOOP_PREVIOUS_NOT_DOMINATED` fail closed，并有对应精确 pointer 反例。Schema resolver 测试另对 `TeamSchemaResolverError.code` 的 forbidden/out-of-scope/missing/dialect/invalid 分支作稳定断言。Resolver 自身抛 typed error，不产生带 JSON Pointer 的 `TeamIrDiagnostic`；映射层会把引用解析错误转换为诊断并断言映射目标 pointer。阶段门复核确认阻断语义均有合法正例、非法反例、稳定 code/pointer 或复杂 Schema runtime warning/调用前校验；阶段 1 聚焦测试 86/86 通过。此覆盖不等同于每个 code 所有组合输入的笛卡尔穷举；复杂 JSON Schema 的任意静态赋值推理不属于冻结合同。普通结果目标完整字段/冲突、Join 单边豁免与字段并集、`$literal`/数组边界已有代表性正反例。Schema resource 闭包进入 `CompiledTeamPlan` digest 并有包内引用变更测试。生产 Project Task 集成、动态状态机、依赖闭包漂移矩阵及 Join/Loop 可支持拓扑均归阶段 2–4 追踪，不是阶段 1 未完成项。

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
| 结果 Handoff 的每条边独立满足完整 data/Artifact 合同；并行冲突静态拒绝 | mapping/validation 结果合同测试；`tests/team-ir-runtime.test.mjs` 的 Result CAS race、terminal commit recovery、lost commit response replay | RunRecord 单记录 Result 原子 CAS 与恢复通过；跨 ArtifactStore/RunStore 无事务，普通并行冲突静态拒绝，通用并行竞态矩阵仍缺 |
| `required`、`allow_empty`、`finish`、活动工作收敛及缺结果终态 | `tests/team-ir-result-mode.test.mjs`；Runtime `finish`、Result CAS 和 failure intent 测试 | `required`/`allow_empty` 与单记录 Result/终态提交有证据；普通 fan-out 下所有 sibling 失败/取消/迟到响应的组合收敛未闭合 |
| `all_of`/`quorum_of` 后 Join 输入只生成一次，迟到来源仅审计，活动 sibling 失败仍使 Run 失败 | `tests/team-ir-runtime.test.mjs`：no-Loop quorum early/late/failure、Join timeout/recovery、同端点逐 Handoff skip、独立多个 Join 与 Join target Review；`tests/team-ir-loop-join-runtime.test.mjs`：Loop all-of/quorum、timeout、恢复与 skip | 受支持拓扑内有 scheduler 与 File Store 恢复证据；其它 Loop/Review 混合拓扑、多 lineage 和任意 fan-out 故障组合仍不支持或未闭合 |
| optional 条件来源按所有前驱终止状态标记 `skipped`；required 缺席失败 | mapping/Join reducer；`tests/team-ir-runtime.test.mjs` 与 `tests/team-ir-loop-join-runtime.test.mjs` 同端点多 Handoff 回归 | scheduler 已按 Handoff ID 接合路由和 `pending/arrived/skipped`；Join/Loop 之外的全部条件组合矩阵仍需核对 |
| Loop 紧邻前轮唯一成功执行、同 lineage/Scope，零次/多次/陈旧历史拒绝 | `tests/team-ir-runtime.test.mjs` bounded rounds/dominance；`tests/team-ir-loop-join-runtime.test.mjs` 两轮 Join、timeout 与 checkpoint recovery | 单 Loop/lineage 和受限单 Loop + all_of 有运行恢复证据；多 Loop、嵌套、Loop quorum 和一般多 lineage 保持拒绝/未支持 |
| Review 在下游 route 前暂停；授权决定、reject feedback、独立 timeout、等待不耗 active budget，决定后 sibling 收敛 | `tests/team-ir-review-runtime.test.mjs`；`tests/team-ir-runtime.test.mjs` 同 Run checkpoint、独立并行 gate、Run-scope all_of Join target Review resume；`apps/team-site/tests/team-ir-review-api.test.mjs` owner/checkpoint/dispatch；Project Task Review restart UAT；`apps/team-site/tests/team-ir-studio-browser.test.mjs`：Review 状态读取临时 503 后页面内重试成功，后续 reject feedback 与提交丢失后幂等重放 | 串行、Maker-Checker boundary Loop、Run-entry parallel 多 Review、唯一 Run-scope all_of Join target Review 有确定性证据；生产 API/resume bridge 和 local OS principal 已装配。真实独立审核用户 UAT 仍未完成；其它 fan-out/Join/Loop 组合 fail closed |
| A2A `completed`/`failed`/`canceled`/`input-required`、Artifact Parts、deadline、幂等及输入请求审计 | `tests/team-ir-a2a-binding.test.mjs` 覆盖 adapter 状态；`tests/team-ir-runtime.test.mjs` 覆盖 `paused_input_required`、拒绝同 Run 续跑和 sibling 收敛；`apps/team-site/tests/team-ir-project-run-executor.test.mjs` 覆盖持久 query 的 owner-scoped pendingInput、无成功结果及事件不含请求正文 | adapter + scheduler 切片通过；具体远端 HTTP client/持久远端幂等缓存、用户取消/control API、新输入 Run 的公开产品流程及跨进程恢复时活动 sibling 收敛待做 |
| 首个失败、取消、Review 决定、A2A input-required 通过 revision/CAS 线性化；晚到响应不可提交下游副作用 | `tests/team-ir-runtime.test.mjs` 单调用意图竞态、`a cancellation intent that wins the Result CAS race prevents Result commit`、File Store A2A cancel restart；`tests/team-ir-fail-fast-runtime.test.mjs` sibling cancel 与 late audit；Review reducer revision token tests | Run 失败/取消 intent CAS、结果提交竞态及 persisted A2A Task cancel 有定向证据；Review 与终态、Result/Artifact 提交竞态以及跨重启并行活动 sibling 线性化仍无集成故障注入 |
| Runtime checkpoint replay 不重复 Binding 副作用、Result/Artifact 登记；恢复重算冻结闭包，不匹配即拒绝 | `tests/team-ir-runtime.test.mjs`：pending Result FileStore 新实例恢复、Run CAS 丢失响应及 Artifact commit 后响应丢失/进程重启恢复；`tests/team-ir-artifact-store.test.mjs`：prepared 不可见和 blob/index 中断；另有活动 invocation 未知结果 fail closed 与编译闭包漂移检查 | RunRecord publication intent 现提供 Artifact 可见性与恢复协议；prepared Artifact 不可授权，pending intent 重启幂等完成。CAS 前不可见孤儿物理清理、真实 OS kill/restart 覆盖、跨进程活动 invocation 收敛与全依赖漂移矩阵未覆盖 |
| 历史 Run 绑定原 Team/Plan snapshot，当前 Team IR 改动/缺失不改历史查询；创建/发布不得写 `.ogs/runs/` | `apps/team-site/tests/team-ir-legacy-compatibility.test.mjs`：IR read/validate、拒绝 release/mount/Task 不改 legacy Team `.ogs/runs/` SHA-256；`createFileRecentRunStore` 读取有效历史 Task 输出后 Project `.ogs/runs/` SHA-256 不变；既有 `apps/team-site/tests/run-query-use-cases.test.mjs` 验证 owner 隔离 | 部分；无迁移副作用与历史读取不写入有证据；IR 变更/删除后仍基于历史冻结快照查询及终态只读 API 仍缺 |
| Studio 画布事件桩连线、自动映射、缺项定位、Handoff/Join/Loop 编辑、诊断 code/pointer 一致 | `apps/team-site/tests/team-ir-studio-browser.test.mjs`：schema 驱动 source/target 字段下拉、同名字段建议与显式接受、保存重开；基础 Team ID 与 Review timeout/escaped pointer 定位；高级 JSON 覆盖完整 Join/Loop/Review/routes、Run contract、Artifact slot/mapping；移动窄屏横向画布滚动、节点拖动并本机持久化、SVG Handoff 几何及 `BLOCKED` 到 `audit` 独立端口拖连；诊断 code/pointer 阻止 PUT | 部分；自由布局及独立端口几何连线已通过浏览器窄合同；复杂/嵌套合同和 Join `baseMapping` 继续使用高级 JSON，诊断全部 code/pointer 与发布/Review 全流程矩阵未闭合 |
| Studio v2 Simulation 独立于 Project Task/旧 Mermaid simulation，保存 simulation evidence 但不写 `.ogs/runs/` | `apps/team-site/tests/team-ir-studio-simulation.test.mjs`、`team-ir-simulation-routes.test.mjs`：原生 TeamRuntime execution、digest 绑定、脱敏持久 evidence、legacy evidence 拒绝；`team-ir-studio-browser.test.mjs`：Fake resolver 下从保存/重开、Simulation、readiness 到发布成功 | 部分；Simulation 独立持久化，FileTeamRunStore checkpoint 可跨实例恢复；启动时扫描恢复已接线，显式 API 仍可按 TeamVersion 恢复。Fake UAT 不证明真实 Sandbox |
| TeamVersion v2 readiness/release 成功和失败路径，发布后只读/重开，冻结完整依赖及专用 Sandbox 证据 | IR lifecycle/use case 测试覆盖 fail closed、digest freeze；基础浏览器只验保存重开 | 部分；服务端 production closure/evidence resolver 未注入，故无可信发布成功路径和 release browser 验收 |
| 旧 Team 定义拒绝；默认入口、经典活动模板和案例切到 Team IR v2 | `apps/team-site/tests/team-ir-legacy-compatibility.test.mjs`、`team-api-routes.test.mjs`；8 个 `examples/team-ir-v2/classic-*.json`；`classic-case-v2-release-gate.test.mjs` | 默认作者入口、版本 fork、案例和模板 provisioning 已切到 v2；旧 Team 编辑 API 只拒绝、不迁移。真实运行 UAT 仅覆盖部分场景；完整版本入口与数据清理验收尚缺 |
| 最新经典团队真实 UAT 集 | 8 个活动案例及同名 v2 fixture；当前真实 Sandbox 证据见后续 UAT 记录 | 部分；软件交付、专家会诊、结构化辩论、Artifact Evidence、条件会签、Maker-Checker 和 Release Gate 均有真实 Sandbox 运行证据；A2A intake 缺远端 Agent；各场景的失败/重试/重启矩阵与完整人工验收仍未全通过 |

### 阶段 4 入口与模板 inventory

以下 inventory 区分 Team Site 的活动 Team 产品链与 OGS standalone System/CLI 示例。默认创建、fork、Case 和模板 provisioning 已使用 Team IR v2；历史记录不得被理解为当前仍关闭默认入口。最新 Team 创建/发布路径不解析或迁移 legacy `/design` 文件，也不覆盖无关文件。

| 产品面 / 现有文件 | 当前行为与数据合同 | 可先独立完成 | 切换门与验收矩阵 |
| --- | --- | --- | --- |
| 默认创建 `/studio/new`；`renderNewProject`、`POST /api/v1/team-ir-drafts` | 默认入口直接创建原生 v2 草稿；没有 `/studio/ir/new` 别名和 legacy `/design` 写路径 | 浏览器覆盖 v2 创建、保存、重开和窄屏；Case/template 创建也只物化 v2 fixture | 真实 resolver 下完整作者、Simulation、发布和发布后只读浏览器验收以及全入口回归未完成 |
| 草稿续编与发布版本编辑；`teamCard`、`forkTeamVersion` | 编辑动作进入 `/studio/teams/:id/ir`；fork 只复制原生 Team IR v2，缺 IR 的源版本明确拒绝 | lifecycle tests 覆盖 v2 fork 和缺少原生 IR 时拒绝旧版本回退复制 | Team 编辑页面完整浏览器验收、跨关闭重开和真实发布版本编辑验证仍缺 |
| 经典活动案例、Case API 与 built-in template provisioning | `apps/team-site/cases.mjs` 包含 8 个案例；每个案例映射同名 `examples/team-ir-v2/classic-*.json` fixture；创建时写入 native Team IR，模板按 `templateId: team-ir-v2` 复用 | 8 个 fixture 全部 schema/compiler/digest 校验；`classic-case-v2-release-gate.test.mjs` 覆盖每个 Case 缺少 release evidence 时失败补偿；旧 `case-team-materializer.mjs` 已删除 | 八个场景的真实发布/挂载/Project Task UAT 尚未逐一通过；不得把 fixture/失败补偿测试当真实运行证据 |
| v2 示例；`examples/team-ir-v2/classic-*.json` | 8 个最新经典团队 IR fixture 是 Case catalog 和启动 template provisioning 的唯一拓扑来源 | 全部 fixture 有稳定 semantic/compiled digest 和发布包闭包检查 | 静态合同不替代真实 Sandbox Task、人工 Review、远端 A2A UAT |
| standalone System/CLI 示例；`examples/README.md` 与 `git ls-files 'examples/*system*' 'examples/**/*.mmd'` inventory：根目录 `minimal-system.mmd`、`target-model-binding-system.mmd`、`console-system.mmd`；目录 `error-flow-compensation/`、`langgraph-debate-current/`、`langgraph-expert-consultation/`、`legal-rag-dev-team/`、`medical-quorum-consultation/`、`mulit-debate-ogs/`、`ogs-gstacklike/`、`runtime-native-human-review/`、`rust-hello-pipeline/`、`wechat-miniprogram-factory/` 各自有 `system.mmd`；另有 `mulit-debate-ogs/system.example.mmd` 及 `ogs-gstacklike/scenarios/*.mmd` | 作为 OGSystem standalone System/CLI 运行示例，使用 `system.mmd`/Runtime 语义；不通过 Team Site 案例 API 或 built-in Team provisioning 消费 | 可独立审阅/维护 `examples/README.md` 的分类与命令，确认无 Team Site 活动路由引用；保持各目录原命令与 fixture 回归 | 不属于 Team TeamVersion 模板迁移，不改文件格式或命名以制造“活动示例全 v2”；若未来将某目录明确纳入 Team 案例/模板，需独立登记其 package/Binding/Schema closure、运行合同与切换验收 |

**切换验收顺序：** 默认入口、Team fork、Case 与模板 provisioning 已按 v2 实现；后续门槛为 (1) 按当前设计逐项完结语义/浏览器矩阵；(2) 8 个经典场景各自通过真实 Simulation/release/mount/Project Task UAT；(3) Review 与 A2A 产品合同、受控失败/重试和重启查询通过；(4) 删除所有未使用的 legacy Team 源码及旧 Team 活动数据；(5) 全量回归、页面 UAT、清理数据边界和最终提交。任何未运行项保持未完成，不以兼容历史或迁移数据作为门槛。
| Team Site production Project Task v2 真实 Sandbox 执行、Run query/retry/control/recovery | `apps/team-site/tests/team-ir-project-run-executor.test.mjs`、`apps/team-site/tests/task-run-runtime-failure.test.mjs` 和 `apps/team-site/tests/file-task-retry-store.test.mjs`；另有 Runtime A2A input-required 的 owner-scoped pending input query 集成 | 部分；`server.mjs` 已注入正式 executor，但 trusted closure/evidence/Binding resolver 未配置，生产仍 fail closed；v2 附件没有冻结重试快照合同并会拒绝重试；TeamRuntime user cancel/control、跨重启暂停恢复和 sibling 收敛仍未接完 |
| 经典团队真实 Sandbox UAT：经 Studio、发布、挂载、Task 启动，成功与失败/重试，重启后查询 | 本地 classic Team IR fixture + Fake Binding 集成测试；Codex custom provider CLI 和 OpenCode serve 模型探测 | 未运行/受实现配置阻塞；自定义 provider 模型调用已通过且不依赖 Codex 登录态。仍缺可信 production closure、release evidence、Sandbox Binding resolver 及真实 Project Task UAT；Fake、CLI 探测、旧 Mermaid 或 dry-run 均不计 |

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
| Join 同一 source endpoint 的逐 handoff 选择状态 | 通过（Runtime 回归） | `tests/team-ir-runtime.test.mjs`：`Join tracks selected and skipped Handoffs separately when candidates share one source endpoint`，两条互斥条件候选共用一个 source endpoint，断言只合并命中条件的 handoff 字段；`tests/team-ir-loop-join-runtime.test.mjs`：`Join readiness tracks selected and skipped handoff IDs when two sources share one endpoint`，断言逐 handoff `sourceStates`。`tests/team-ir-join-runtime.test.mjs`：`Join source state is isolated by lineage and Loop round`，相同 Run/Join 在不同 lineage 与 Loop round 的 key、source state、status 和 merged result 相互独立。`pnpm build`；`node --test tests/team-ir-join-runtime.test.mjs`，9/9 | 已证明 Join 状态机身份隔离；Runtime 当前仍将支持的普通 Join 限定在 Run lineage、Loop Join 限定在单一 Loop round，多 lineage 编排仍不支持并 fail closed |
| 经典团队真实 Sandbox UAT | 受阻 / 未运行 | 本行是 2026-10-28 的历史检查快照：当时 provider 在线调用和 resolver 状态尚未查清。后续 custom provider CLI 与 OpenCode serve 调用已通过（见本台账对应验收）；当前仍缺可信 closure/evidence/Sandbox Binding resolver 与真实 Task UAT，production executor 缺项时 fail closed | 配置可信绝对路径 resolver 和可执行真实 Sandbox Binding；完成 Studio、发布、挂载、真实 Task 成功及受控失败/重试、重启查询和人工审核。Fake Runtime/旧 Mermaid/compile 不计真实 UAT |

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
| 阶段 3：Team IR v2 Review owner-scoped API | 部分通过（含 Maker-Checker round-scoped 合同） | 独立 GET/POST `/api/v1/projects/:projectId/tasks/:taskId/runs/:runId/team-ir-reviews/:reviewId` 校验当前 Task/Run owner、冻结 semantic/compiled digest，以及 resolver 返回的持久 TeamRunRecord checkpoint：Run 必须处于 `waiting_human_review`，reviewId/lineage/loopRound 必须与请求和当前 activation 一致。Runtime 查询/决策显式传递 lineage 与 loopRound；同 reviewId 的 round 1/2 独立读取和决策，round 3 checkpoint、跨轮旧 revision token 被拒绝。resolver 可选导出 `resolveTeamIrReviewContext`，必须提供 `{ runtime, plan, reviewerId, runRecord, lineage, loopRound }`；未提供时 fail closed。`apps/team-site/tests/team-ir-review-api.test.mjs` 与 resolver 测试覆盖 owner、checkpoint round、授权、反馈 Schema、revision、legacy route 隔离和 runtime unavailable；`node --test apps/team-site/tests/team-ir-review-api.test.mjs apps/team-site/tests/team-ir-v2-resolvers.test.mjs tests/team-ir-review-runtime.test.mjs tests/team-ir-runtime.test.mjs` 46/46。 | 生产 resolver 未配置；Task waiting-review 状态映射、持久 FileTeamRunStore/ReviewStore 恢复接线和 resume 调度桥、浏览器真实身份/UAT 未闭合；这是 API 合同回归，不代表生产人工审核端到端 |

本轮聚焦回归：`pnpm build && node --test tests/team-ir-index.test.mjs tests/team-ir-schema-resolver.test.mjs apps/team-site/tests/team-ir-v2-resolvers.test.mjs apps/team-site/tests/team-ir-review-api.test.mjs apps/team-site/tests/team-ir-studio-browser.test.mjs`：20/20，退出码 0。新增该批用例后重跑 `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot` 退出码 0；`pnpm test`：856 tests，855 pass、0 fail、1 Windows-only skip，退出码 0。
阶段结论：阶段 0 通过；阶段 1 部分通过；阶段 2 部分通过；阶段 3 进行中；阶段 4 进行中且默认切换关闭。真实 Sandbox UAT 仍受 resolver/模型认证条件阻塞。

### 2026-10-28：结果竞态、活动调用恢复与 v2 Review 浏览器流程

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：`executionPolicy.resultMode` 缺失/null 诊断 | 通过（Schema 字段合同） | `tests/team-ir-schema.test.mjs` 增加字段缺失与显式 `null` 反例，均断言 `IR_SCHEMA_INVALID` 和 `/executionPolicy/resultMode`；与 `tests/team-ir-result-mode.test.mjs` 合并聚焦验证 12/12 | 阶段 1 其他 Schema/映射/闭包矩阵仍未闭合 |
| 阶段 2：终态意图与 Result 提交竞态 | 通过（同一 RunStore 原子终态提交窄合同） | `src/team-ir/runtime.ts` 先将候选结果存为非公开的 `pendingResult` checkpoint，最终单次 CAS 同时提交 `result`、`resultWritten`、`run.result.written` 与 `run.completed`；`tests/team-ir-runtime.test.mjs` 受控 CAS 证明取消先赢时不公开 Result，崩溃注入证明终态 CAS 前 Result 仍未公开、恢复后复用已完成 invocation 且只提交一次 Result/完成事件。Runtime 聚焦测试 33/33 | File Run Store 进程崩溃/磁盘故障和 fsync 耐久性未注入；Artifact Store 与 RunStore 仍无跨存储事务，外部 Artifact 登记副作用 exactly-once 未承诺 |
| 阶段 2：活动 Binding 跨进程恢复 | 通过（明确 fail-closed 恢复合同） | `tests/team-ir-runtime.test.mjs` 将活动 invocation 恢复改为 FileTeamRunStore 第二实例：尝试 cancel 后以 `failed/outcomeUnknown` 结算，Binding 调用数为 0；第三实例重入读取相同终态且不重复 cancel/invoke；`pnpm build`、`node --test tests/team-ir-runtime.test.mjs` 29/29 | 活动 invocation 不自动续接；cancel 缺失/抛错也保持 unknown/fail closed，不提供外部副作用 exactly-once |
| 阶段 3：Team IR v2 Review 浏览器流程 | 部分通过（Run 详情审核 UI 切片） | `apps/team-site/public/app/views/app.js` 在匹配冻结 Team digest 的当前 Run 详情内读取 pending v2 Review；独立使用 v2 Review API、revisionToken 和随机幂等 key，不提交 reviewer 身份；支持 approve/reject、JSON feedback 校验、409 stale 提示与重读。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 覆盖 pending、客户端 JSON 拒绝、服务端 feedback 拒绝、合法 reject payload、无 reviewerId 和 stale 状态；浏览器 1/1 | 生产 Review resolver、Task 状态映射、checkpoint resume 调度桥和真实身份集成仍未配置/实现；本项是 Fake/API UI 合同，不是生产人工审核 UAT |

本轮局部验证：`pnpm build`；`node --test tests/team-ir-runtime.test.mjs` 29/29；Result/File Run Store 测试 33/33；`node --test tests/team-ir-schema.test.mjs tests/team-ir-result-mode.test.mjs` 12/12；`node --test apps/team-site/tests/team-ir-studio-browser.test.mjs` 1/1；Runtime/Store/Schema/Review/Browser 综合聚焦套件 52/52。集成后 `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot` 退出码 0；`pnpm test`：857 tests，856 pass、0 fail、1 Windows-only skip，退出码 0。
阶段结论：阶段 0 通过；阶段 1、2 部分通过；阶段 3 进行中；阶段 4 进行中且默认切换关闭。真实 Sandbox UAT 仍受 resolver/模型认证条件阻塞。

### 2026-10-28：Run Artifact 消费合同、双轮 Join 隔离与 Studio 结构投影

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：Run input/result Artifact 消费端 Schema | 通过（静态合同切片） | `schemas/team-ir-v2.schema.json` 新增 `acceptedArtifactSlots`，Run input 和 Run result 要求 `acceptedMediaTypes` 且拒绝 producer-only `mediaTypes`。`tests/team-ir-schema.test.mjs` 对两种消费端精确 pointer 正反例；`tests/team-ir-mapping-validation.test.mjs` 覆盖媒体兼容、不匹配、required 缺失、optional source→required target 拒绝及 optional target 正例。聚焦 Schema/Mapping/Runtime/Loop Join 回归 67/67 | 运行时 Artifact 媒体登记与跨存储事务不属于本静态切片；其他完整规范语义矩阵仍未闭合 |
| 阶段 2：双轮 Loop Join 来源隔离 | 通过（单 Loop Run lineage 窄合同） | `tests/team-ir-loop-join-runtime.test.mjs` 对经典结构化辩论两轮断言 Join key 含 Run/lineage/round，各轮 sourceStates、contributions、merged data 只保留各自 pro/con 输出；Loop Join suite 6/6 | Runtime 仍限单 Run lineage 的受限串行拓扑；没有多个并发 lineage 的实现/证明，继续 fail closed |
| 阶段 3：Team IR v2 结构图节点/边定位 | 通过（只读投影窄合同） | `apps/team-site/public/app/views/app.js` 从 Team IR 投影 Run、Agent、Run Result 节点及 Handoff 列表；点击定位到 Team/Agent/Handoff 表单或 Result 高级 JSON。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 在 1280px 验证节点和边定位、390px 验证无横溢与节点/边数量；浏览器 1/1 | 当前是只读结构投影，不支持自由布局事件桩连线、直接拖拽建边、自动映射及 Join/Loop/Review/Artifact 可视化编辑；这些仍是阶段 3 任务 |

本轮聚焦验证：`pnpm build && node --test tests/team-ir-schema.test.mjs tests/team-ir-mapping-validation.test.mjs tests/team-ir-loop-join-runtime.test.mjs tests/team-ir-runtime.test.mjs`，67/67；Studio Playwright 专项 1/1；`git diff --check` 通过。集成后 `pnpm test`：858 tests，857 pass、0 fail、1 Windows-only skip，退出码 0；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot` 退出码 0（dot reporter 不提供精确计数）。
阶段结论：阶段 0 通过；阶段 1、2 部分通过；阶段 3 进行中；阶段 4 进行中且默认切换关闭。真实 Sandbox UAT 仍受 resolver/模型认证条件阻塞。

### 2026-10-28：依赖 digest 恢复拒绝与活动 Case 兼容矩阵

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：依赖闭包 digest 维度与恢复拒绝 | 通过（代表性漂移窄合同） | `tests/team-ir-compiler.test.mjs` 补 `bindingDigests` 变化导致 `compiledPlanDigest` 改变；`tests/team-ir-runtime.test.mjs`：`active Run resume rejects a changed compiled dependency digest without side effects`，改变 package digest 后恢复拒绝、Run 记录/events 不变、Binding 调用数为 0。Compiler/Runtime 聚焦回归 34/34 | 真实 resolver 加载实际角色包/Binding 策略闭包的漂移矩阵未运行；不穷举每类 checkpoint/依赖变化；阶段 1 保持部分通过 |
| 阶段 4：活动 Case 发布兼容矩阵 | 通过（3 个活动 Case 的失败安全合同） | `apps/team-site/tests/classic-case-v2-release-gate.test.mjs` 从真实 Case catalog 参数化覆盖 `software-team`、`expert-consultation`、`structured-debate`：缺 native v2 IR 时 API 拒绝、旧 Mermaid baseline Simulation 不执行、临时 Team workspace 补偿清理。兼容专项包含 `team-ir-legacy-compatibility`、历史 Run、classic flow 与 CLI 边界，合计 12/12 | 证明失败安全而非 native v2 Case 成功路径；built-in template 防覆盖、legacy draft 重建、单一整合端到端兼容矩阵，以及阶段3后入口/模板切换仍未完成 |
| 阶段 2：Maker-Checker Review reject/revise Loop | 通过（单 Agent boundary Loop 窄拓扑） | `src/team-ir/runtime.ts` 仅放行单成员 boundary Loop + 单 Review + 单 Run entry + reject feedback 到 revise continue + approve 到 Result exit、无 Join/fanout；其他 Review+Loop 拓扑仍 `TEAM_REVIEW_TOPOLOGY_UNSUPPORTED`。`tests/team-ir-runtime.test.mjs` FileTeamRunStore 场景覆盖 round 1 reject、重启后 feedback 映射到同 Agent revise、round 2 approve、每轮 Review key 隔离、timeout fail closed、completed invocation 不重跑及审计事件。最新 Runtime/Loop Join 回归 42/42 | Review API 已有 owner/checkpoint round scope 合同；生产 Review resolver、Task 状态映射与 resume 调度桥、浏览器真实身份仍未完成；不代表生产人工审核端到端 |
| 阶段 3：Maker-Checker Review API 回合校验与 resume dispatch | 部分通过（注入式 API 合同） | `apps/team-site/application/team-ir-review-use-cases.mjs` 要求 resolver 返回持久 Run checkpoint，并校验当前 Run、waiting 状态、Review ID、lineage、loopRound；读写均将 scope 传给 Review Runtime。approve/reject 要求 context 提供可信 `resumeTeamIrRun`，缺失时在决策写入前 fail closed；Review 决策持久化后才 dispatch，并传递稳定的 Run/Review/scope `dispatchId`。API 测试验证 round 1/2 隔离、错误 checkpoint、跨轮 token、hook 缺失无副作用、决定先落盘和 dispatch 失败后同幂等请求重试。`node --test apps/team-site/tests/team-ir-review-api.test.mjs` 6/6 | 生产 resolver 尚未提供 Review context 与同 Run resume hook；Task waiting 状态投影已接线，但 Project Task 的 resolver、checkpoint 恢复与真实身份仍未连成端到端；真实审核 UAT 未完成 |
| 阶段 1：Run/Result Handoff endpoint-kind 与封闭字段 | 通过（Schema 窄矩阵） | `tests/team-ir-schema.test.mjs`：`Handoff endpoint kinds and Run/Result endpoint fields are exact`；校验 Run source 拒绝额外 `agentId`、source 不接受 `result`/`run` 错误语义、Result target 不接受 `run` 或 `outputPort`，并分别断言 `/handoffs/0/from/agentId`、`/handoffs/0/from/kind`、`/handoffs/1/to/kind`、`/handoffs/1/to/outputPort`、`/handoffs/1/from/kind`。`pnpm build && node --test tests/team-ir-schema.test.mjs` 11/11 | 只覆盖 Handoff endpoint discriminator/额外字段的代表性非法组合；完整 Schema oneOf 诊断交叉组合仍未穷举，阶段 1 保持部分通过 |

本轮聚焦验证：`pnpm build && node --test tests/team-ir-compiler.test.mjs tests/team-ir-runtime.test.mjs tests/team-ir-loop-join-runtime.test.mjs` 42/42；`node --test apps/team-site/tests/team-ir-review-api.test.mjs apps/team-site/tests/team-ir-v2-resolvers.test.mjs apps/team-site/tests/classic-case-v2-release-gate.test.mjs` 10/10；兼容矩阵命令 `pnpm build && node --test apps/team-site/tests/classic-case-v2-release-gate.test.mjs apps/team-site/tests/team-ir-legacy-compatibility.test.mjs apps/team-site/tests/team-ir-history-after-source-change.test.mjs apps/team-site/tests/classic-team-flow.test.mjs tests/cli-help.test.mjs` 12/12。`pnpm test`：861 tests，860 pass、0 fail、1 Windows-only skip，退出码 0；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot` 退出码 0（dot reporter 不提供精确计数）。真实 resolver 与 Sandbox UAT 未运行。
阶段结论：阶段 0 通过；阶段 1、2 部分通过；阶段 3 进行中；阶段 4 进行中且默认切换关闭。Maker-Checker Runtime 与 Team Site Review API 回合合同已接线；生产 resolver、Task 状态/恢复调度集成和真实 Sandbox UAT 仍未闭合。

### 2026-10-28：Studio 同名字段映射建议

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 3：Studio 自动映射建议 | 部分通过（结构相同 Schema 窄合同） | v2 Handoff 编辑器从当前 IR 源/目标 Schema 查找同名属性；仅当来源必填、源/目标属性 Schema 在键序归一化后完全相同且不含 `$ref` 时提供建议，已经映射的目标不重复建议。用户必须点击候选按钮后才会更新映射输入框。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 覆盖 Run→Agent、Agent→Result 的建议及明确接受，并断言 pattern 约束不同的同名字段不被建议；`pnpm build && node --test apps/team-site/tests/team-ir-studio-browser.test.mjs`，1/1 | 更广泛 JSON Schema 蕴含不推导，复杂 Schema 与引用资源不建议；自由布局事件桩画布和 Join/Loop 可视编辑仍未完成，阶段 3 保持进行中 |
| 阶段 3：Studio 事件桩 Source→Target 连接 | 部分通过（显式端点选择窄合同） | 图投影可对 Run/Agent 选 Source、对 Agent/Result 选 Target；必须 Source 在先，支持取消；成功后创建显式 `from`/`to`、空 `map.data` 和默认 Handoff 草稿，若来源已有 route 则追加 ID；不自动保存。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 覆盖 target-first 不创建、取消不改 IR、Run→Agent 成功生成、已有 Agent route 更新全部 outgoing IDs，以及同 Agent 不同端口 Handoff。 | 当前 Agent 默认选首个 output/input port；多端口选择、自由布局连线和 Join/Loop 可视编辑仍未完成；映射仍需手动/明确建议接受，保存仍经服务端校验，阶段 3 保持进行中 |

### 2026-10-28：Project Task Review 状态投影

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 3：Team Run 到 Task 状态映射 | 通过（Task 持久化投影窄合同） | `apps/team-site/application/task-execution-use-cases.mjs` 在 `completeAttempt` 的 Task 持久化边界将 `waiting_human_review` 映射到 Task 域 `waiting_review`，将 A2A `paused_input_required` 映射到 `paused`，失败/取消中间态映射到对应活动 Task 状态；原始 `result.state` 只在传给 Task attempt store 的副本中投影，executor 返回及 Team Run checkpoint 保持原始 Runtime 状态。`apps/team-site/tests/task-execution-use-cases.test.mjs` 验证 Review wait Task 投影及 `waitingReview` / `loopRound` checkpoint 保真；`apps/team-site/tests/team-ir-project-run-executor.test.mjs` 原有 Run Query 测试验证 Runtime 的 `paused_input_required` 继续对外可见。`pnpm build && node --test apps/team-site/tests/task-execution-use-cases.test.mjs apps/team-site/tests/team-ir-project-run-executor.test.mjs`，18/18 | 仅证明状态 projection；production executor 当前未注入 ReviewRuntime，可信 resolver、Review API 后的 Task resume 调度桥与决定后最终 Task/Run 查询验收未完成 |

本轮验证：`pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-schema.test.mjs apps/team-site/tests/task-execution-use-cases.test.mjs apps/team-site/tests/team-ir-project-run-executor.test.mjs apps/team-site/tests/team-ir-studio-browser.test.mjs && git diff --check`，63/63；`pnpm test`：863 tests，862 pass、0 fail、1 Windows-only skip，退出码 0；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=dot` 退出码 0（dot reporter 不提供精确计数）。本轮 Studio 连接只覆盖显式端点选择合同，不构成完整作者流程或生产发布验收。
阶段结论：阶段 0 通过；阶段 1、2 部分通过；阶段 3 进行中；阶段 4 进行中且默认切换关闭。

### 2026-10-28：Run input/result Artifact slot 封闭边界

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：Run input/result consumer Artifact slot 边界 | 通过（Schema 窄矩阵） | `tests/team-ir-schema.test.mjs`：`Run input and result Artifact consumers reject open slot fields and producer media declarations` 覆盖 input slot 的额外字段和错误声明 producer-only `mediaTypes`、result slot 缺少 `required`、重复 `acceptedMediaTypes`；每个案例断言精确 JSON Pointer，重复媒体断言规范化诊断 `IR_DUPLICATE_VALUE`。`pnpm build && node --test tests/team-ir-schema.test.mjs`，12/12 | 只证明 Run input/result 消费端 slot 的代表性封闭字段与媒体声明边界；完整 Schema 组合和 resolver/运行时 Artifact 行为仍按阶段 1/2 追溯项验证，阶段 1 保持部分通过 |

本轮验证：`pnpm build && node --test tests/team-ir-schema.test.mjs` 12/12；`git diff --check` 通过。该测试只覆盖 Schema consumer slot 边界，不代表 Run Artifact 的运行时登记或跨存储事务通过。

### 2026-10-28：Join/Loop 作者合同、审核恢复及模板兼容边界

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：Join 声明精确入边集合 | 通过（引用校验窄矩阵） | `tests/team-ir-validation.test.mjs`：`Join accepts the exact inbound Handoff set and rejects omitted or unrelated IDs` 覆盖精确合法双来源集合、漏声明实际入边（`IR_JOIN_UNDECLARED_INBOUND`，`/handoffs/1/to`）和错误纳入 Result 出边（`IR_JOIN_TARGET_MISMATCH`，`/orchestration/joins/0/handoffIds/2`）；聚焦验证 16/16 | 仅覆盖 Join 精确来源集合代表性正反例；所有 Join/Loop/route 静态组合仍有未覆盖项，阶段 1 保持部分通过 |
| 阶段 1：Handoff/route 端点引用诊断 | 通过（引用诊断窄矩阵） | `tests/team-ir-validation.test.mjs`：`Handoff and route endpoint references diagnose each unknown Agent and port at its field pointer` 覆盖 Handoff from/to 与 route from 的未知 Agent 和未知 port，断言六个精确 JSON Pointer；`pnpm build && node --test tests/team-ir-validation.test.mjs && git diff --check`，17/17 | 不覆盖全量 Schema endpoint discriminator 非法组合，也不等于跨所有 orchestration 声明的引用矩阵；阶段 1 保持部分通过 |
| 阶段 1：映射 nullability 与必填存在性 | 通过（映射类型窄矩阵） | `tests/team-ir-mapping-validation.test.mjs`：`nullable required sources differ from optional sources during mapping validation` 覆盖 required nullable 来源到 nullable 目标通过、nullable 来源到非 nullable 目标为 `IR_MAPPING_TYPE_INCOMPATIBLE`，以及可选属性到 required target 独立产生 `IR_MAPPING_OPTIONAL_TO_REQUIRED`；聚焦验证 23/23 | 仍未对复杂 Schema 建立静态蕴含判断，需保留运行时校验提示；阶段 1 保持部分通过 |
| 阶段 1：预算、deadline、重试与 backoff 数值边界 | 通过（Schema 窄矩阵） | `tests/team-ir-schema.test.mjs`：`runtime budget, deadline, attempt, and backoff durations use positive integer boundaries` 对 active execution budget、Handoff deadline、Binding attempt timeout、retry maxAttempts、constant delay、exponential initial/max delay 分别拒绝 0、负数、小数并断言精确 pointer，同时接受最小值 1；聚焦验证 13/13 | 正整数范围符合设计，不另造未定义的上限；其它 Schema 字段组合仍未完整穷举，阶段 1 保持部分通过 |
| 阶段 2：Maker-Checker Review 等待与活动预算 | 通过（Review Loop 窄拓扑） | `tests/team-ir-runtime.test.mjs`：`Maker-Checker reject then approve uses round-scoped Review and resumes without repeating a completed invocation` 在每轮 Review wait 注入 6 秒时钟推进，Run 活动预算为 5 秒；断言两轮等待分别保持累计 `activeExecutionMs` 为 5/10ms，最终仍完成且不重放已完成调用。Runtime 聚焦回归 33/33 | 单一 Review Loop 拓扑的活动预算证据；其他暂停类型、并行 siblings 和跨进程活动调用恢复矩阵仍未闭合，阶段 2 保持部分通过 |
| 阶段 2：多个活动分支 fail-fast 收敛 | 通过（多 sibling 窄矩阵） | `tests/team-ir-fail-fast-runtime.test.mjs`：`parallel fail-fast waits for every active sibling outcome before settling` 覆盖一个确认取消 sibling 与一个拒绝取消 sibling；Run 保持 failing 到未确认 sibling 的原始 deadline，迟到成功不能写 Result。Runtime 聚焦验证 3/3 | 仍未穷举多个未确认活动调用、跨进程活动调用恢复及各类取消错误组合；阶段 2 保持部分通过 |
| 阶段 2：同一 Run 内多个独立 all_of Join 与 ready checkpoint 恢复 | 通过（无 Loop 窄拓扑） | `tests/team-ir-runtime.test.mjs`：`multiple independent all_of Joins recover after a ready round checkpoint` 从同一并行 Run fan-out 驱动两个不同目标 Join；FileTeamRunStore wrapper 在 Join ready CAS 已落盘、任何 Join target invocation 尚未创建时模拟崩溃；第二 Runtime 实例完成两个独立 Join，断言 target 输入/贡献集合正确、来源 Binding 调用数不变且恰有两个 target invocation；`pnpm build && node --test tests/team-ir-runtime.test.mjs`，34/34 | 仅证明 no-Loop、Run-scope、多个 all_of Join 在 ready-before-target-dispatch 崩溃点恢复；Loop/multi-Join、quorum multi-Join、ready Join target 活动调用中断仍未覆盖或不支持，阶段 2 保持部分通过 |
| 阶段 3：Join/Loop 结构化作者编辑 | 部分通过（浏览器编辑窄合同） | `apps/team-site/tests/team-ir-studio-browser.test.mjs` 增加 Join/Loop 行编辑、保存重开、高级 JSON 双向同步、Join Handoff ID/高级字段保留、无效合同显示服务端 JSON Pointer 诊断且不调用保存 API、已发布版本禁用编辑，以及 Add/Remove 同步 advanced JSON 且保留预存 Handoff IDs；旧高级 JSON round-trip 仍覆盖 Review、Artifact、A2A 与 routes | 还没有自由布局事件桩画布/直接拖线；Review 和 Artifact 仍依赖 advanced JSON；未覆盖完整真实浏览器发布作者流程，阶段 3 保持进行中 |
| 阶段 3：Review 决定到同 Run 恢复派发 | 部分通过（Project Task 集成合同） | 提交 `97be5a2`：Review context 从冻结 Plan 和 Project-owned FileTeamRunStore/FileTeamReviewStore 重建；同 Run/同 attempt 恢复经 Task 状态投影；稳定 dispatch/idempotency replay、resume worker 锁、loopback principal、TLS-only remote Basic 和伪造 body reviewerId 拒绝均有测试；本轮 `team-ir-review-api`、Project Run executor、Studio browser、Team lifecycle 和 classic release gate 定向集 51/51 | 本轮已将 API/executor/Run query/UI 适配持久 `waitingReviews` 集合，并测试任一激活 Review 可读取和决定；多 Review 生产 Sandbox UAT、跨主机锁、正式远程身份服务和独立审核用户 UAT 未完成，阶段 3 保持进行中 |
| 阶段 4：经典模板保护原生 v2 IR | 通过（模板覆盖防护窄合同） | `apps/team-site/application/team-lifecycle-use-cases.mjs` 对已存在的原生 `schemaVersion: 2` 模板停止旧 Mermaid materializer 覆写；IR 读取错误 fail closed。`apps/team-site/tests/team-lifecycle-use-cases.test.mjs` 覆盖保留原生 v2、检查失败不覆盖，并保留 legacy stale template rematerialization 正例；生命周期聚焦测试 16/16 | 仅防止经典模板 provisioning 覆盖已存在的 v2 IR；活动 Case 原生 v2 成功路径、默认作者入口与模板统一切换仍未完成，阶段 4 保持进行中且默认切换关闭 |

本轮验证：`pnpm test`：856 个顶层测试、870 个含子测试项，869 通过、0 失败、1 项 Windows-only 跳过，退出码 0。Team Site 串行 spec 回归最近为 485 通过、0 失败、0 跳过，退出码 0。聚焦回归：端点引用 17/17，Schema 非法端点矩阵 12/12，映射 validation 23/23，fail-fast Runtime 3/3，Studio browser 1/1，multi-Join Runtime 34/34，预算边界 Schema 13/13。该快照当时把 Codex 登录状态和 OpenCode auth store 状态列为 UAT 条件；后续自定义 provider 实测及回归见下节。真实 resolver 与 Sandbox UAT 尚未完成。

### 2026-10-28：多个 all_of Join ready checkpoint 恢复

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 2：多 Join ready checkpoint 恢复 | 通过（no-Loop Run-scope 窄合同） | `tests/team-ir-runtime.test.mjs`：`multiple independent all_of Joins recover after a ready round checkpoint` 在第一个 Join round 持久化为 ready、Join target invocation 尚未创建的 CAS 边界模拟崩溃；FileTeamRunStore 第二实例恢复两个 Join，来源调用各执行一次，两个 target 各调用一次并得到各自字段并集。`pnpm build && node --test tests/team-ir-runtime.test.mjs`，34/34 | 不覆盖 Loop/multi-Join、quorum multi-Join、ready Join target 活动调用中断和跨存储 Artifact 原子性；阶段 2 保持部分通过 |

本轮聚焦验证：`pnpm build && node --test tests/team-ir-runtime.test.mjs`，34/34；`git diff --check` 通过。该恢复合同只覆盖 Run-scope 多 all_of Join 的 ready-before-target-dispatch 中断点，不代表 Runtime 全阶段或真实 Sandbox UAT 通过。

### 2026-10-28：Codex 自定义 provider 与登录态隔离回归

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| Codex 自定义 provider 与 `codex login status` 解耦 | 通过（模型发现与执行窄合同） | `tests/codex-app-server.test.mjs` 的 fake app-server 对 `login/status` 请求返回错误；同一回归完成模型分页发现和 `gpt-6-luna` turn，断言 `thread/start`、`turn/start` 使用自定义模型且没有登录态请求。`node --test tests/codex-app-server.test.mjs`，2/2 | 锁定 app-server 发现/执行路径不依赖 Codex 登录态；本机 CLI 探测另证 provider API 调用可用，不代表 Sandbox UAT 已通过 |
| Codex CLI 自定义 provider 模型调用 | 通过（本机模型探测） | `gpt-6-luna` 自定义 provider 配置不要求 OpenAI 登录；`codex login status` 为未登录时，`codex exec --ephemeral --sandbox read-only --model gpt-6-luna ...` 仍返回预期响应 | 证明 CLI 模型调用可用，不证明 Team IR production resolver 或真实 Sandbox Task 已接线 |
| OpenCode serve 持久 provider 模型调用 | 通过（本机模型探测） | 用户级 OpenCode 配置使用自定义 `fedgroup/gpt-6-luna` provider；本机 `opencode serve` 通过 SDK session/prompt 返回预期响应。Bearer 由本机启动脚本从 Codex 配置提取并仅注入进程环境，未写入仓库配置 | 不证明 Team Site production resolver/Binding 已配置；不构成真实 Sandbox UAT |
| 经典团队真实 Sandbox UAT | 受阻 / 未运行 | 模型认证链已验证可用；当前阻塞是 `OGS_TEAM_IR_V2_RESOLVER_MODULE` 未配置，以及 production closure、Sandbox evidence、Project Task Binding 与真实 Task 调度/恢复链未接线 | 配置可信 resolver 并完成 Studio 保存/重开、发布、Project 挂载、真实 Sandbox Task 成功与受控失败/重试、重启后查询及结果审核；Fake 或 CLI 探测不计入真实 UAT |

**运行环境：** macOS，本机 Codex custom provider `gpt-6-luna` 与 OpenCode serve `fedgroup/gpt-6-luna`；未读取或提交任何凭据。\
**变更范围：** 新增 Codex app-server 登录态隔离回归，以及全部活动 classic Case 的 native v2 fixture/digest pre-cutover gate；更新本台账，区分登录态回归、历史状态观察与真实 UAT 阻塞。\
**本轮聚焦验证：** `node --test tests/codex-app-server.test.mjs`，2/2；`node --test tests/team-ir-classic-case-v2-contract.test.mjs`，3/3；`git diff --check` 通过。此前全仓记录：`pnpm test` 871 项（含子测试）中 870 通过、0 失败、1 项 Windows-only 跳过；Team Site 串行 spec 回归 485 通过、0 失败、0 跳过。\
**未覆盖与风险：** 真实 Sandbox UAT 仍未运行；production resolver、Sandbox evidence、Project Task Binding 与真实 Task 调度/恢复链未接线。阶段 1、2 仍部分通过，阶段 3、4 未完成，默认入口切换保持关闭。

| 阶段 4：活动 classic Case 原生 v2 fixture pre-cutover gate | 通过（fixture/digest 窄合同） | `tests/team-ir-classic-case-v2-contract.test.mjs` 从 `apps/team-site/cases.mjs` 读取全部活动 Case，要求每个 Case 有对应 native v2 fixture；逐项验证 schemaVersion、Team IR identity、无阻断 schema 诊断，以及 semantic digest 和带 fixture closure 的 compiled plan digest 可重复。`node --test tests/team-ir-classic-case-v2-contract.test.mjs`，3/3 | 仅验证 fixture/schema/编译合同；不代表活动 Case 的真实发布、Project 挂载、Sandbox Task 执行及失败恢复 UAT 通过，默认入口切换仍关闭 |

### 2026-10-28：阶段 1–4 增量验收与真实 Sandbox UAT readiness

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：Handoff endpoint oneOf 诊断矩阵 | 通过（窄矩阵） | 提交 `d90a8ca`；`tests/team-ir-schema.test.mjs` 覆盖缺失/未知 kind、Run/Result 跨分支字段、Agent source/target 必需字段及方向错误的精确 JSON Pointer；`pnpm build && node --test tests/team-ir-schema.test.mjs`，13/13 | 复杂 Schema 推理、其它完整字段组合和全部静态诊断追溯仍未闭合，阶段 1 部分通过 |
| 阶段 1：公开 Schema resolver 诊断与 pointer 保真 | 通过（公开 validator 窄矩阵） | 提交 `83d1621`；`tests/team-ir-index.test.mjs` 从公开 `validateTeamIr` 入口覆盖 runInput preferences、runResult、Agent input/output、Review feedback 的嵌套 resolver 诊断，转义 `/`、`~` key、缺失资源、坏 pointer escape 及外部 Draft-07 dialect；`pnpm build && node --test tests/team-ir-index.test.mjs`，7/7 | 未穷举所有嵌套 Schema 构造和阻断 code 组合；阶段 1 仍部分通过 |
| 阶段 1/2：依赖闭包漂移后恢复拒绝 | 通过（四类 digest 窄矩阵） | 提交 `1ec5535`；`tests/team-ir-runtime.test.mjs` 以新 FileTeamRunStore/Runtime 实例分别改变 package、Binding、adapter、Schema digest；均以 `compiledPlanDigest mismatch` 拒绝，持久记录不变且 Binding 调用数为 0；`pnpm build && node --test tests/team-ir-runtime.test.mjs`，35/35 | 尚无生产 resolver 真实依赖闭包及所有 checkpoint/漂移时序矩阵，阶段 1/2 保持部分通过 |
| 阶段 2：多 all_of Join ready checkpoint 恢复 | 通过（no-Loop Run-scope 窄拓扑） | 提交 `f30776b`；FileTeamRunStore 在 Join ready CAS 落盘、目标 invocation 创建前注入崩溃，第二 Runtime 实例恢复两个 Join，不重跑来源 Binding，并各执行一次目标；Runtime 聚焦回归 34/34 | Loop/multi-Join、quorum/multi-Join、active target invocation 恢复及 Artifact 跨存储原子性仍未覆盖 |
| 阶段 2：Artifact 登记后的完成 checkpoint 故障边界 | 通过（fail-closed 恢复合同） | 提交 `119e281`；分离 Binding invoke 与 Artifact resolver/Run completion checkpoint 错误边界；FileTeamRunStore 故障注入证明完成 CAS 失败不被误当成 Binding retry，跨实例恢复将结果未知 invocation fail closed，不重跑 Binding、不发布 Artifact ref/Run Result。`pnpm build && node --test tests/team-ir-runtime.test.mjs`，37/37 | 跨存储不具备事务；可能遗留随机 ID、未引用 blob/index 孤儿。本项不宣称物理回收或 exactly-once |
| 阶段 3：Project Task Review 持久恢复与身份 | 部分通过（生产组合根合同） | 提交 `97be5a2`；从 Project-owned File Run/Review Store 和冻结 Plan 重建 Review context；同 Run/attempt 恢复、Task 状态投影、稳定 dispatch/idempotency 重放、loopback principal、TLS-only remote Basic 和不可信 body reviewerId 拒绝均有覆盖。聚焦 33/33；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec`，493/493 | 无可信 resolver/evidence/Sandbox Binding，远程身份服务及真实 Review/Task UAT 未接线；Studio Review UI、跨主机锁语义未闭合 |
| 阶段 4：活动 classic Case v2 fixture pre-cutover gate | 通过（fixture/digest 窄合同） | 提交 `b1fd9e7`；测试从活动 Case inventory 校验全部三个 native v2 fixture、无阻断诊断、semantic digest 和 compiled plan digest 稳定；3/3 | 只验证静态 fixture/编译合同；生产发布/挂载/Task 未通过，默认入口和活动模板切换仍关闭 |
| Codex 自定义 provider 与登录态隔离 | 通过（本机探测和自动化窄合同） | 提交 `6cdcb81`；Codex custom provider 在 `codex login status` 未登录时，CLI `codex exec` 返回预期输出；fake app-server 的 `login/status` 返回错误时，模型发现和 `gpt-6-luna` turn 仍成功。OpenCode serve `fedgroup/gpt-6-luna` 经 SDK session/prompt 返回预期文本。未读取或提交凭据 | 模型调用可用不等于 Team IR Binding/Sandbox UAT；不应把 Codex login status 或 OpenCode CLI auth store 作为自定义 provider 可用性的判定条件 |
| Codex/OpenCode 本机 provider 真实请求与配置 | 通过（本机模型连通性） | 2026-10-28：Codex CLI `CODEX_MODEL_OK`；独立 OpenCode CLI 读取 `~/.config/opencode/gpt6-luna-client.json` 返回 `OPENCODE_MODEL_OK`；本机 OpenCode serve SDK session/prompt 返回 `OPENCODE_SERVE_MODEL_OK`。修正 OpenCode 客户端配置为 `codex-gateway/gpt-6-luna` 的 provider 块，配置保留于用户目录且权限为 `0600`；服务健康检查带认证 `200`、未认证 `401`。命令和路径见 `docs/development/local-model-provider-setup.md` | 只证明模型服务可请求；不构成 resolver、Sandbox Binding、发布或 Project Task UAT |
| 无用 provider 清理审计 | 完成（无安全删除项） | 只读审计确认 Codex/OpenCode 是实际执行及在线探测后端；Claude/Antigravity 仍在发现和选择合同中；OpenCode provider/model namespace 动态发现；`og-models/` 仍被测试与 Skill 示例引用 | 本轮不删除产品 provider、发现合同或 legacy fixtures；未发现本地 provider 配置以外的可安全清理项 |
| 经典团队真实 Sandbox UAT readiness | 受阻 / 未运行 | 本机检查未发现 Sandbox Binding 实现/依赖；`OGS_TEAM_IR_V2_RESOLVER_MODULE` 未设置；Team Site 4173、OpenCode serve 4097 在监听，3000 未监听。三个活动 fixture 的 synthetic `role:software-*` packageRef 不存在于本地 `og-roles`。本地 `mode: sandbox` 只是运行选项，不能证明实际隔离；没有启动 Project Task 或将 CLI/model probe 记作 UAT | 需要受信任 resolver 提供固定 package/binding/schema digests、release evidence validator 和真实隔离 Sandbox Binding；为活动 Case 提供不可变角色包；之后从 Studio 保存/重开、真实 evidence、发布、挂载、Project Task 成功及受控失败/重试、服务重启后查询并人工审核 |
| 阶段 3：v2 Review 响应丢失后的浏览器恢复 | 通过（UI 重放窄合同） | 提交 `fe7ce19`；`apps/team-site/public/app/views/app.js` 对每个决定/反馈签名保留稳定 `idempotencyKey`；错误后相同内容复用 key、内容变更产生新 key；成功后刷新 Run/Task，已完成 Review 不再显示表单。Playwright 模拟服务端已提交 reject 但 503 响应丢失，断言同 key 重试、请求不含 reviewerId、成功后 panel 消失；定向 11/11 | 真实 resolver、Sandbox UAT 和真实身份环境仍未完成；本次 UI/Fake route 测试不是生产审核 UAT |

**本轮全量回归：** `pnpm test`，构建成功；859 个顶层测试、873 个含子测试项，872 通过、0 失败、1 项 Windows-only skip，退出码 0。Team Site 串行回归再次运行退出码 0；精确计数使用 agent 在同一代码提交基线记录的 493/493。`git diff --check` 待最终提交前执行。

**当前阶段状态：** 阶段 0 通过；阶段 1、2 部分通过；阶段 3、4 进行中，默认入口切换关闭。真实 Sandbox UAT 因缺少可信 resolver、真实 Sandbox Binding/evidence 和匹配活动角色包而不可执行；不能据模型连通或 Fake/本地运行宣布发布完成。

### 2026-10-28：最新经典团队集扩充与条件 Join 结算

| 场景 | Fixture / 验收证据 | 覆盖结论与边界 |
| --- | --- | --- |
| 软件交付与 Artifact | `classic-software-team.json` + `tests/team-ir-runtime.test.mjs`（成功 fan-out/Join、单次结果及 planner transport 失败后第 2 次尝试成功）；`classic-artifact-evidence.json` + `tests/team-ir-classic-artifact-evidence.test.mjs` | Fake Runtime 覆盖场景级 retry、fan-out/Join/唯一结果，以及 Run Artifact grant、producer provenance、allowlist 拒绝、opaque Result ref。未在经典场景级注入 deadline timeout；Artifact 场景不覆盖生产上传 UI、Project Task 附件输入或 Sandbox 存储 |
| 条件会签与同端点候选 Handoff | `classic-conditional-signoff.json` + `tests/team-ir-classic-conditional-signoff.test.mjs` | 覆盖同一 source endpoint 按 Handoff ID 记录 arrived/skipped、optional 字段省略、required source 拒绝及全跳过 `JOIN_NO_ARRIVALS`。全跳过路径此前落为 `RUN_RESULT_REQUIRED`，本轮补了 Join checkpoint/failure 收敛 |
| 结构化辩论 Loop | 活动 Case `structured-debate` fixture + `tests/team-ir-loop-join-runtime.test.mjs`、`tests/team-ir-classic-case-v2-contract.test.mjs` | 有限范围的 Loop + all_of Join、多轮、互斥出口和恢复；不扩展为 Loop 内多 lineage/fan-out 或任意 Join 组合 |
| Maker-Checker / revise | `classic-maker-checker.json` + `tests/team-ir-classic-maker-checker.test.mjs`、`tests/team-ir-runtime.test.mjs` | Fake File Run/Review Store 重建覆盖 reject -> revise -> approve 和已完成 Maker 不重跑；未证明生产身份服务、Task 审核 UI 或 Sandbox 重启 UAT |
| A2A 待补件 | `classic-a2a-intake.json` + `tests/team-ir-classic-a2a-intake.test.mjs` | Stub A2A client 覆盖 pinned card 合同、持久 `input-required`、审计脱敏、拒绝同 Run 续接、新 Run 输入和活动远端 Task 取消；未连接真实远端 A2A 服务 |
| 阶段门禁与结果策略 | `classic-release-gate.json` + `tests/team-ir-classic-release-gate.test.mjs` | 覆盖 PASS/REJECT 唯一路由、`required`/`allow_empty` 和并行 Result 的静态冲突拒绝；并发写冲突运行时竞态仍由通用 Runtime 证据覆盖，不在本 fixture 宣称通过 |
| 场景级真实 Sandbox Project Task UAT | 六类场景的 v2 fixtures | 未运行。可信 resolver、真实 Sandbox Binding/evidence、缺失角色包和 Project Task Artifact 输入合同仍阻塞；Fake、Stub A2A、模型 CLI 请求及本地 `mode: sandbox` 不计作真实 UAT |

**本轮实现：** `src/team-ir/runtime.ts` 在 Run-scope Join 的全部来源被条件跳过时，先持久化 Join round 并由 Join 状态机产生 `JOIN_NO_ARRIVALS`；`tests/team-ir-runtime.test.mjs` 另覆盖 invocation running checkpoint 发布期间的 timeout cancellation 闸门。修正 Conditional Signoff 独占路由 priority，并将 Release Gate 的 fake clock 改为不保留真实 timeout timer。

**聚焦验证：** `pnpm build` 通过；`node --test tests/team-ir-runtime.test.mjs`，39/39；六个新增经典场景及活动 Case 聚焦回归，16/16；全仓 `pnpm test`，878 个顶层测试、892 含子测试，891 通过、0 失败、1 项 Windows 专项跳过；Team Site 串行 spec，493/493；`git diff --check` 通过。真实 Sandbox UAT 未运行，阶段 1、2 仍部分通过，阶段 3、4 仍未完成。

#### 同日后续增量

| 范围 | 实现与证据 | 结论 / 限制 |
| --- | --- | --- |
| 阶段 1：最新经典 fixture 的公开 Schema 正例 | `tests/team-ir-schema.test.mjs`：`public Schema validator accepts every latest classic Team IR fixture`，枚举并验证 `examples/team-ir-v2/` 全部 8 个 JSON fixture；Schema 专项 14/14 | 关闭 fixture inventory 漂移的正例缺口；不替代完整阻断诊断/复杂 Schema 组合矩阵 |
| 阶段 2：A2A file Message Part 与 Artifact | `src/team-ir/a2a-binding.ts`、`tests/team-ir-a2a-binding.test.mjs`：显式唯一 slot、base64、pinned output media type、并发相同 idempotency key 共享 Task、Runtime deadline 触发一次远端 cancel；A2A + Schema 聚焦测试 26/26 | A2A Adapter 合同通过；未连接真实远端 A2A service，未证明跨进程持久幂等缓存 |
| 阶段 3：多端口 Handoff 编辑 | `apps/team-site/public/app/views/app.js`、`apps/team-site/public/styles.css`、`apps/team-site/tests/team-ir-studio-browser.test.mjs`：多 output/input port 显示窄屏可用的选择器，Playwright 选择 `BLOCKED` → `audit` 并断言所存 IR endpoint；浏览器验收 1/1 | 解决创建连线时默认首端口的问题；自由布局拖线和 Join/Loop 字段并集可视编辑仍未完成 |
| 最新版页面与回归 | `pnpm test`：884 个顶层测试、898 含子测试，897 通过、0 失败、1 项 Windows 专项跳过；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec`：493/493 | Playwright 属于本地浏览器合同验收，不等于生产发布或 Sandbox 用户验收 |
| 旧数据盘点与清理 | 回归结束后发现根 `.ogs/runs/` 有 256 个被 Git 忽略的旧 Runtime 运行目录（约 52 MB），含 `run-plan.json`/`state.json`，无 Team IR v2 Run 格式；根 `.site/` 为空；示例目录 `.ogs/` 是版本控制 fixture | 根 `.ogs/runs/` 已移出工作区到 `/tmp/team-ir-v2-legacy-runs-20261028`，可恢复；系统拒绝永久递归删除。保留被跟踪的示例 fixture；用户数据备份尚未永久清除 |

**此增量未覆盖：** 真实 Sandbox UAT 仍不可执行：没有配置可信 `OGS_TEAM_IR_V2_RESOLVER_MODULE`，仓库没有接入 Team IR 的真实隔离 Sandbox Binding，部分经典场景角色包不存在，Project Task 输入合同不接 Artifact。默认新建仍缺原生 v2 草稿 API 并走旧 `/design`；阶段 3 发布门未通过前不切换默认入口。不得将本地 Fake、Stub A2A 或浏览器验收称为真实 UAT。

### 2026-10-28：最新版 Studio 浏览器验收与旧运行索引归档

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 3：当前 v2 Studio 页面浏览器验收 | 通过（隔离浏览器合同） | `pnpm --dir apps/team-site exec node --test tests/team-ir-studio-browser.test.mjs`，1/1。390px Playwright 流程覆盖 `/studio/new` 建 TeamVersion 后进入 v2 编辑器、Agent/端口/Handoff 编辑、显式映射建议接受、服务端校验、保存后重开与 semantic digest 一致、legacy API 拒绝；测试断言无浏览器 page error。测试使用临时目录和 browser fake resolver | 这是本地隔离页面/API 合同验收，不是生产用户流程；没有可信 resolver、生产 Sandbox Binding、真实发布与 Project Task，不计作真实 Sandbox UAT。自由布局拖线、Join/Loop/Review/Artifact 的完整可视编辑仍未完成 |
| 旧版本运行数据清理 | 通过（从活动 workspace 移除，可恢复归档） | 根 `.ogs/runs/` 的 256 个旧 Runtime Run 目录及生成索引 `.ogs/runs-index.json` 已移至 `/tmp/team-ir-v2-legacy-runs-20261028`；runtime 配置不变，示例目录中受版本控制的 `.ogs/` fixtures 保留 | 归档未永久销毁；系统此前拒绝永久递归删除。若需永久销毁，需经用户确认后由本机明确清理归档 |
| 阶段 3/4：显式原生 Team IR v2 创建 | 通过（非默认入口合同） | `apps/team-site/application/team-lifecycle-use-cases.mjs` 原生创建 TeamVersion 并保存可校验 starter IR；失败时补偿删除；`POST /api/v1/team-ir-drafts`；`/studio/ir/new` 提供独立入口，团队卡续编回到 `/ir`。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 验证直达路由、创建、`team.ir.json`、无 `system.mmd`/`.ogs/authoring.json`、schemaVersion 2、digest 重开和卡片路由；API routes 9/9，Studio Playwright 1/1 | 不切换 `/studio/new` 默认路径；未接生产 resolver、Sandbox Binding 或发布/Task 运行，当前只关闭原生 v2 草稿创建和数据隔离合同 |
| Codex/OpenCode 模型发现与项目默认配置 | 通过（本机发现与默认值更新） | `pnpm exec tsx src/runtime/cli.ts models discover`：Codex 和 OpenCode 来源均 `available`，发现 GPT-6-Luna 候选 `codex/gpt-6-luna` 与 `openai/gpt-6-luna`，本机目录共 211 个模型；`.ogs/model-selection.json`、新生成的 `.ogs/README.md` 模板和使用手册默认示例统一为已验证的 GPT-6-Luna。`tests/model-runtime.test.mjs` 同步断言；`node --test tests/model-runtime.test.mjs tests/model-contract.test.mjs`，12/12 | 首次定向回归 11/12，唯一失败是旧 `gpt-5.6-sol` 硬编码期望，更新断言后 12/12。机器生成的 211 模型目录已还原，不提交用户环境快照；Claude/Antigravity 仅检测到 CLI、没有 OGS 持久适配器，不是可运行 Provider。独立 `gpt6-luna-client.json` 只含 `codex-gateway`；OpenCode 全局配置里的其他 Provider 用途不归本 Team IR 项目管理，未删除 |
| 最新页面人工验收入口 | 待用户验收 | 隔离 Team Site 已运行于 `http://127.0.0.1:4180`，项目根为 `/tmp/team-ir-v2-site-uat-20261028`。可直达 `/studio/ir/new` 创建；样例 v2 作者页为 `http://127.0.0.1:4180/studio/teams/native-v2-acceptance-0596ad4f/ir`。390px 浏览器实测创建、`team.ir.json`、无 `system.mmd`、schemaVersion 2、重开 digest 一致、无横溢或 JS 错误；点击 Simulation 返回 `TEAM_IR_V2_SIMULATION_UNAVAILABLE`，且未生成 `.ogs/runs/` | 用户需确认页面信息层级、表单/连线编辑和窄屏体验；人工页面观感确认不替代生产发布与 Sandbox UAT |
| 最新完整回归 | 通过（本轮仓库状态） | `pnpm test`：884 个顶层测试、898 含子测试，897 通过、0 失败、1 项 Windows 专项跳过；最新代码 `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec` 通过 496/496；另有 Studio Playwright 1/1、Team API 9/9、lifecycle 19/19、model 12/12，及手工 390px 原生创建/重开检查 | 全仓套件在最后的服务端白名单和 lifecycle 测试改动前通过；Team Site 全套与相关目标套件在这些改动后通过 |
| 回归生成的旧格式 Run 数据 | 通过（从活动 workspace 移除，可恢复归档） | 两轮全仓回归分别在 `.ogs/runs/` 生成 8 个约 1.6 MB 的 Runtime 目录及 `.ogs/runs-index.json`；已分别移入 `/tmp/team-ir-v2-legacy-runs-20261028/post-regression-runs/` 和 `post-runtime-doc-regression/`，与原 256 个旧 Run 目录分开保存 | 归档仍可恢复、未永久销毁；系统拦截了之前的永久递归删除请求 |

**阶段结论：** 本次关闭显式原生 v2 草稿创建/数据隔离及当前浏览器合同验收，并将旧和回归生成的 Run 数据从活动 workspace 可恢复归档；未改变默认作者入口。阶段 1、2 仍部分通过，阶段 3、4 仍未完成，真实 Sandbox UAT 未运行。不得据此宣称 Team IR v2 发布完成。

### 2026-10-28：旧 Team 源码清理审计（后由下方增量更新）

| 范围 | 审计结果 | 清理门槛 / 后续动作 |
| --- | --- | --- |
| Team 作者入口 | 当前 `/studio/new` 仍是默认 legacy 创建流程；`/studio/ir/new` 是明确的非默认 v2 创建流程。路由和浏览器测试仍覆盖两者 | 阶段 3 生产发布门通过、默认入口切换并完成人工 UAT 后，再移除旧页面、路由和专属测试；切换前删除会破坏当前默认创建路径 |
| 旧 Team 设计与版本保存用例 | `team-design-use-cases.mjs`、`team-version-save-use-cases.mjs` 仍由 `/design`、角色源导入及 TeamVersion fork/edit 流程调用；对应测试覆盖这些合同 | 原生 v2 的角色源/版本编辑、保存、重开和 API 合同接管全部调用方并通过回归后，删除 legacy 用例及只服务旧合同的测试 |
| Case Team materializer | `case-team-materializer.mjs` 仍由带 `caseId` 的项目创建和 Team lifecycle 的 Case、模板、启动 provisioning 调用；活动 Case 和内置模板尚无真实 v2 发布、挂载、Project Task UAT 证据 | 每个活动 Case 与模板先通过原生 v2 发布、挂载和真实 Task UAT；随后切换生命周期调用方，回归项目创建、模板启动、Case provisioning 和故障补偿后再删除 materializer |
| System 示例与历史数据 | `examples/**/system.mmd` 属于 OGS System/CLI 示例，不是 Team Site 的旧 Team 模板；示例 `.ogs/` fixtures 由版本控制维护。根 `.ogs/runs/` 旧运行数据已移出活动 workspace 至可恢复归档 | 保留独立 System 示例和受版本控制 fixtures。旧 Run 归档已不在活动 workspace，但尚未永久销毁；永久删除前需由维护者确认归档内容与保留要求 |

**审计结论（当时状态）：** 当时调用图仍指向旧实现；后续增量已切换默认创建、Case/template provisioning 与 Team fork，并删除 Case materializer。以文末最新清理增量为当前状态；以上仅保留审计历史。

### 2026-10-28：经典 Team IR 角色包闭包

| Fixture | 固定 packageRef | 包状态 |
| --- | --- | --- |
| `classic-software-team.json` | `role:software-planner@1`、`role:software-implementer@1`、`role:software-tester@1`、`role:software-lead@1` | 本轮新增 4 个不可变角色包；每包含 `role.json`、角色说明、提示词和匹配 v2 output port 的 JSON Schema，无工具权限 |
| `classic-expert-consultation.json` | `role:consultation-dispatcher@1`、`role:cardiology-expert@1`、`role:neurology-expert@1`、`role:imaging-expert@1`、`role:chief-reviewer@1` | 本轮新增 5 个不可变角色包；专业意见强调证据边界，角色包无工具权限 |
| `classic-structured-debate.json` | `role:debate-host@1`、`role:debate-proponent@1`、`role:debate-opponent@1`、`role:neutral-judge@1`、`role:debate-reporter@1` | 本轮新增 5 个不可变角色包；主持、双方论证、裁决、报告职责与输出合同匹配，无工具权限 |
| `classic-conditional-signoff.json` | `role:primary-reviewer@1`、`role:compliance-reviewer@1`、`role:signoff-chair@1` | 本轮新增 3 个不可变角色包，输出 enum/字段按 v2 fixture 合同固定，无工具权限 |
| `classic-maker-checker.json` | `role:maker@1` | 本轮新增不可变 Maker 包，输出合同包含 answer/again，无工具权限 |
| `classic-release-gate.json` | `role:release-gate@1` | 本轮新增不可变 gate 包，PASS/REJECT/ABSTAIN 输出合同与 fixture 一致，无工具权限 |
| `classic-artifact-evidence.json` | `role:advanced-worker-a@1`、`role:advanced-worker-b@1` | 已有本地包；本轮验证文件存在、包身份和 published package allowlist，不改变既有工具合同 |
| `classic-a2a-intake.json` | `role:imported.agency.legal-client-intake@1.0.0` | 已有本地包；本轮将该精确包路径加入 published package allowlist，并校验 Role Package Loader 可加载 |

**闭包与验证：** 8 个 `examples/team-ir-v2/*.json` 共引用 22 个不同 packageRef；19 个此前缺包的引用已补入 `og-roles/roles/`，并加入根 `package.json` 发布白名单。新增 `tests/team-ir-classic-role-packages.test.mjs` 从 fixture inventory 逐个加载实际包，调用正式 `loadRolePackage`，校验新增包无工具、输出 Schema 与 fixture output port 完全一致，按包内文件内容计算 SHA-256 packageDigests，并用真实闭包编译全部 fixture、断言 compiled plan digest 重复稳定。`node --test tests/team-ir-classic-role-packages.test.mjs tests/package-publish-policy.test.mjs tests/role-package-adapter.test.mjs`，4/4；前置 `pnpm build` 通过。

**边界：** 此项关闭的是经典 fixture 的静态角色包/发布归档缺口，不代表生产 resolver 当前从已安装发布包解析闭包，也不代表真实 Sandbox Binding、模型 Task、Artifact 或 A2A 远端 UAT 已通过。Stage 3/4 和真实 Sandbox UAT 状态不因本项变更而提升。

### 2026-10-28：Loop Join 条件来源按 Handoff ID 结算

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 2：Loop-scoped `all_of` Join 条件 optional 来源与同端点候选 | 通过（现有单 Loop/单 Join 拓扑内的窄合同） | `src/team-ir/runtime.ts` 放开 Loop `all_of` Join 对条件来源的拓扑拒绝；本轮路由跳过写入对应 `(joinId, loopRound)` 的持久 Join round，Join 汇总只从本轮被选中的 Handoff ID 收集贡献。`tests/team-ir-loop-join-runtime.test.mjs`：`Loop Join skips an unselected candidate sharing an arrived source endpoint` 构造同一来源端点两条候选边，跨两轮断言 selected/ skipped 状态、Join 输入和目标调用次数；`pnpm build && node --test tests/team-ir-loop-join-runtime.test.mjs`，7/7 | 仅支持既有单 Loop、单 Loop-scoped `all_of` Join 调度拓扑；不代表 Loop `quorum_of`、多 Loop/多 Join、嵌套 Loop 或任意并行拓扑已支持。Run-scope 同端点候选仍由 `tests/team-ir-runtime.test.mjs` 的既有回归覆盖 |

**本轮聚焦验证：** `pnpm build && node --test tests/team-ir-loop-join-runtime.test.mjs`，7/7；`node --test tests/team-ir-runtime.test.mjs tests/team-ir-loop-join-runtime.test.mjs`，46/46；`git diff --check` 通过。阶段 2 仍部分通过，真实 Sandbox UAT、发布和源码切换/清理未因此关闭。

### 2026-10-28：Project Task Run Artifact 输入/结果合同盘点

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| Project Task 对 Run 输入 Artifact 槽位的 fail-closed（历史，2026-10-28） | 当时通过（阻断合同） | 当时 `runtime-team-ir-project-run-executor.mjs` 拒绝必需 Run input Artifact；随后已实现 TeamArtifactStore 登记、slot 选择、Task/retry 冻结附件快照、executor 授权读取、结果元数据和 owner-scoped 结果 API，真实验收见 2026-10-29 Artifact Evidence UAT | 当前验收已覆盖一次成功 Task、两次模型输出合同失败及第三次 Simulation 修正成功；跨存储提交原子性与通用 orphan cleanup 仍在阶段 2 Runtime 矩阵跟踪 |

**阶段结论：** 仅确认 Project Task 对必需 Artifact 输入保持 fail-closed；经典 Artifact Team 的真实 Project Task UAT 仍不可执行。阶段 3/4 发布门和默认入口切换不受本项通过状态影响。

### 2026-10-28：本机 Docker/OpenCode 模型 Binding 配置与验证

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 可信 Team IR 模型 Binding resolver | 通过（本机 model-only adapter 合同） | `apps/team-site/infrastructure/team-ir-v2-opencode-docker-resolver.mjs` 和 `team-ir-v2-opencode-docker-adapter.mjs` 固定使用发布白名单中的 Role Package SHA-256、`codex-gateway/gpt-6-luna`、本机 OpenCode serve 的固定 HTTP endpoint/path 与 Node image digest。密码从 `OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE` 指向的 `0600` 文件中严格读取唯一 `OPENCODE_API_KEY` assignment，单独经 stdin 传入一次性 Docker 容器；容器不挂载主机或 Project 文件，使用非 root、只读根文件系统、无 capabilities、no-new-privileges 与 CPU/内存/PID 限额。Model 输出 JSON、事件、数据 Schema 和 Artifact media/slot 均在 Host adapter 检查。配置和已知限制见 `docs/development/team-ir-v2-docker-binding-setup.md` | Bridge 网络没有强制 egress allowlist，不能用于不可信 Team/调用者或宣称生产级隔离；需要网络层 egress policy 与生产 secret 管理。该 resolver 只支持 model Binding；A2A fixture 需独立的可信远端 A2A resolver/client |
| 最新模型型经典 fixture 与绑定闭包 | 通过（静态闭包） | 8 个最新 classic fixture 的 21 个模型角色 packageRef 已按内容 digest 固定于 resolver pin 清单；模型型 fixture 的旧 `sandbox/default` 均更新为已验证 `codex-gateway/gpt-6-luna`。`apps/team-site/tests/team-ir-v2-opencode-docker-resolver.test.mjs` 通过 resolver 解析闭包并编译每个模型型 fixture；A2A 的第 8 个场景不被伪装成模型 Binding | 静态编译不代表各协作拓扑已通过真实 Project Task 或人工场景验收；maker-checker 身份授权、结果审核和重启查询仍须沿真实产品链验证 |
| 原生 v2 Studio 新 Agent 默认模型 | 通过（浏览器合同） | `apps/team-site/public/app/views/app.js` 中新增 Agent 和保存时重建 Binding 的默认值统一为 `codex-gateway/gpt-6-luna`；`apps/team-site/tests/team-ir-studio-browser.test.mjs` 在实际浏览器创建 Agent 后断言 Advanced IR 中的新 Binding 引用。`pnpm build && node --test apps/team-site/tests/team-ir-studio-browser.test.mjs`，1/1 | 该默认值匹配本机 resolver；其它部署若使用不同可信 resolver/模型，需在作者页选择和验证其固定 Binding |
| Docker 隔离的真实模型 Binding 请求 | 通过（单次本机 adapter UAT） | `OGS_TEAM_IR_V2_DOCKER_BINDING_UAT=1 OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE="$HOME/.config/opencode/gpt6-luna-serve.env" node --test apps/team-site/tests/team-ir-v2-opencode-docker-resolver.test.mjs`，6/6。实际调用经 pinned Docker 容器到 OpenCode serve，返回 event `A_DONE`、Schema 合法、一个 269-byte `text/markdown` Artifact、退出码 0；测试仅输出这些摘要，不记录模型正文或凭据 | 这是一次真实模型 Binding 请求，不是 Team IR Studio release evidence、Project mount/Task UAT 或完整隔离网络证明 |
| 真实 Project Task 与 classic scenario UAT（截至本节记录时） | 未运行 / 受阻 | resolver 尚未在可审计的隔离 UAT Team Site 进程下完成 Studio 保存重开、真实 Sandbox Simulation/release、发布版本挂载、Task 成功/受控失败重试、进程重启后查询和人工审核 | 后续验收进展见本文件最后的 2026-10-28 UAT 记录；未覆盖的 Artifact slot、Review identity 和远端 A2A 仍是发布门 |
| 默认作者入口与旧 Team 源码切换 | 未开始（发布门未通过） | `/studio/ir/new` 保持原生 v2 非默认入口；旧作者流程和 Case materializer 仍有实际调用方，清理调用图见前述审计 | 生产发布 gate、所有经典场景 UAT 和人工验收全部通过后，才能按最新设计切换默认入口、provisioning 与活动 Case，再删掉调用方已清零的旧 Team 源码 |

**本轮回归：** `pnpm test` 构建通过，900 个含子测试项中 899 通过、0 失败、1 项 Windows-only 跳过；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec`，503 项中 502 通过、0 失败、1 项 opt-in Docker Binding UAT 跳过。Loop Join/Runtime + Project executor + Role closure + package policy 定向组合 65 项中 64 通过、0 失败、1 项 opt-in 跳过；opt-in Docker Binding 单独运行 6/6。测试生成的旧 Runtime `.ogs/runs/` 与 `runs-index.json` 已移至 `/tmp/team-ir-v2-legacy-runs-20261028/post-full-regression-20261028/`，可恢复；项目默认 `.ogs/model-selection.json` 仍为已验证的 `codex/gpt-6-luna`。

**阶段结论：** resolver 与固定模型型 fixture 闭包已就绪；阶段 1、2 仍按原矩阵部分通过，阶段 3、4 仍进行中，默认作者入口保持未切换。单次真实模型 Binding 请求不能代替真实 Project Task、Release Gate、Artifact/A2A/Review 场景 UAT，因此本轮没有将发布标为完成。

### 2026-10-28：Team IR v2 readiness、Task 恢复与真实 Release Gate UAT

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 原生 Team IR v2 Project Readiness 与 Sandbox 确认 | 通过（当前 release-gate fixture） | `runtime-project-readiness.mjs` 将原生 IR 分流至 v2 Schema、trusted closure、compiled digest 和 Binding 检查；Project/Task readiness 将 TeamVersion 快照传入，不再要求 `system.mmd`。Task 确认调用 `createRuntimeTeamConfirmation({ teamIrStore })`，以 semantic digest 确认冻结 IR。`node --test apps/team-site/tests/runtime-project-readiness.test.mjs apps/team-site/tests/runtime-team-confirmation-v2.test.mjs apps/team-site/tests/runtime-task-execution-readiness-v2.test.mjs apps/team-site/tests/project-readiness-use-cases.test.mjs`，10/10；隔离 Project Readiness API 返回 `canDryRun: true`、无阻断 | 多 Team mount 的 closure drift 和 resolver 变化时序仍归阶段 2 恢复矩阵 |
| Team IR v2 Project Task 状态查询与进程恢复 | 通过（终态、失败、等待审核与中断调用窄矩阵） | 新增 `v2-aware-task-attempt-store.mjs` 接入生产 Task/Run 查询；`file-run-recovery-store.mjs` 从 `FileTeamRunStore` 读取 v2 checkpoint、同步 Task 终态，保留 waiting Review/paused 状态，对中断的活动 Binding 记录 outcome unknown 并 fail closed；Run/Task 查询从 `run.failing` 事件投影失败码。定向 Runtime/恢复/查询回归 14/14 | 仅验证单本机进程重启；多主机 lease/fencing 和并发恢复仍未通过；跨存储 Artifact 完成边界仍按既有 fail-closed 合同 |
| Project Task 友好的经典 gate 与 maker-checker 输入 | 通过（fixture 合同） | `classic-release-gate.json`、`classic-maker-checker.json` 的 `runInput.dataSchema` 统一使用 Project Task 提供的唯一 `request` 字段，并映射至各 Agent 输入。`tests/team-ir-classic-case-v2-contract.test.mjs` 新增兼容断言；经典 fixture / executor 合同聚焦测试 4/4 | Artifact 输入场景仍有必填 `runInput.artifactSlots`，因 Task API 未有受控 Artifact ID/slot 输入而保持 fail closed |
| 真实 Release Gate Sandbox Simulation 与 TeamVersion 发布 | 通过（单一 classic gate 场景） | 使用本机 Team Site `127.0.0.1:4182` 隔离数据根 `/tmp/team-ir-v2-configured-site-uat-20261028`，真实 pinned Docker/OpenCode `codex-gateway/gpt-6-luna` resolver。通过 v2 草稿 API 保存最新 `classic-release-gate.json` 后，Simulation `a0ed8713-fcda-4502-bf8e-148050d710fa` 依据实际本地 Node assertion 返回 `PASS`，仅选中 `gate-pass-result` 并写入唯一结果；Release Readiness `ready: true`，TeamVersion `release-gate-task-uat-a004369d` 成功发布。前一版输入字段尚未统一时 `33464754-f9c8-4fbb-8102-73cd14da2a5d` 产生受控 `RUN_RESULT_REQUIRED`，作为失败记录保留 | 仅一个模型型 classic gate 通过；未覆盖三支活动 Case 和其他新增经典场景的真实 Task；本轮 v2 保存通过 API，不是完整 Studio 浏览器编辑验收 |
| 真实 Project mount、Task 成功、失败与 retry | 通过（Release Gate 单场景） | Project `release-gate-task-uat-project-16e438f9` 挂载已发布 TeamVersion。Task `20261028-201158-8209a6d2` / Run `20261028-201217-d6e3e410` 由真实 Sandbox Binding 返回 PASS；在隔离 Project workspace 中保存 `workspace/greet.mjs` 与 `workspace/greet.test.mjs`，执行 `node --test workspace/greet.test.mjs`，1/1 通过。Task `20261028-200943-5fd30068` 首次因 gate 没有足够实现证据而 `RUN_RESULT_REQUIRED`；retry 建立新 Run `20261028-201342-7ac5d6e1`，原 Run 和新 Run 各自失败且均可查询，失败原因正确显示。失败只产生 Run 状态/事件，没有提交 Artifact/业务副作用 | Run 查询的 `mode` 列表对 Team IR v2 仍显示 `unknown`；非目标状态展示问题，需统一 Task/Run 视图投影。模型输出是 gate 审核结果，不证明 Team Agent 会直接写 Project 文件 |
| 真实 v2 Task 服务重启后查询 | 通过（本机单进程） | Task 完成/失败后重启隔离 Team Site；重启后成功 Task 保留 `completed`、`lastError: null`，失败 Task 保留两次 failed attempts、`RUN_RESULT_REQUIRED` 和原始 Run ID，Readiness 仍通过。此前复现并修复 legacy `control/state.json` 的 `planning` 覆盖 v2 TeamRun checkpoint，以及重启恢复错误标记已完成 Task 的问题 | 不替代故障注入于活跃模型调用、Review resume 和跨主机恢复矩阵 |

**本轮聚焦验证：** `pnpm build` 通过；readiness/confirmation 用例 10/10；`node --test apps/team-site/tests/team-ir-v2-run-recovery.test.mjs apps/team-site/tests/team-ir-project-run-executor.test.mjs apps/team-site/tests/v2-aware-task-attempt-store.test.mjs`，14/14；`node --test tests/team-ir-classic-case-v2-contract.test.mjs tests/team-ir-project-run-executor.test.mjs`，4/4；本机真实 Team Run gate 成功、受控失败+retry、服务重启后查询均通过。全仓和 Team Site 完整回归待本批更改合并前重跑。

**未覆盖与风险：** Project Task 目前只接受 request string；Run input 必需 Artifact、Artifact Task 引用/授权读取与结果下载未实现。Maker-Checker 真实 Review 身份授权/产品 UI、兼容远端 A2A `input-required`/cancel/retry、所有经典场景逐一 Sandbox Task、活动 Case provisioning 和最新作者入口切换仍未验收。真实 gate Task 成功不代表所有 Team IR v2 语义或阶段 1–4 全通过。隔离 UAT 含模型输出及临时数据，提交前须将必要脱敏证据写入本台账，再归档/清理生成数据并复核默认工作区。

**阶段结论：** 阶段 0 通过；阶段 1、2 部分通过；阶段 3、4 进行中。当前一个真实 Release Gate Scenario 已完成 Simulation、Release、Project mount、Sandbox Task 成功/受控失败 retry 和单进程重启查询；不满足发布完成定义。默认作者入口仍关闭，旧 Team 源码尚有调用方，不删除未完成调用图审计的源码。

### 2026-10-28：Artifact Evidence 真实 Sandbox Simulation 与 Project Task UAT

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| Team IR v2 创建、Artifact fixture 保存、重开与窄屏 | 通过（本机隔离 Team Site） | `127.0.0.1:4196` 使用全新数据根 `/tmp/team-ir-v2-artifact-uat-20261028`、固定 Docker/OpenCode `codex-gateway/gpt-6-luna` resolver。经 `/studio/new` 创建 `artifact-evidence-team-uat-32c247b9`，在原生 `/studio/teams/:id/ir` 页面重开编辑器；先读当前 semantic digest 再保存完整 `classic-artifact-evidence.json`，避免覆盖创建时的默认 IR。Playwright 页面错误为 0，390px 下 `scrollWidth === clientWidth === 390` | UAT 用 API 导入 fixture 内容，未逐字段通过 Studio 表单编辑；自由布局画布仍未完成 |
| 必需 Simulation Artifact 上传、真实模型 Simulation 与发布 | 通过 | 将 `text/markdown` 上传到必需 `brief` slot 后运行真实 Sandbox Simulation `d0ebdf6b-064a-4eca-ab1b-e9ebff849622`，状态 `completed`、`resultWritten: true`；发布 TeamVersion。IR semantic digest `5a93b3299c6de4a30173fc1e7b2c44a4a2fc10ccbdecebc336c012ae0552bbaf`，compiled digest `bfa0ec60f275cdf253483325dc6b1aee1119aa3abce38d5bef044a6227c8675d` | 本次只验收 Artifact Evidence 单一经典场景，模型生成内容由人工检查范围限于输出合同和摘要 |
| Project Artifact 登记、Task 快照、受控 retry 与授权读取 | 通过（第二 attempt） | Project `artifact-evidence-uat-project-7aa8cd47`；Task `20261028-215342-6c80a132` 冻结 `brief` Artifact 引用。首次启动故意记录为失败但原因是 UAT 请求误传 `dry-run`，被 v2 明确拒绝 `TEAM_IR_V2_SANDBOX_REQUIRED`；用 `sandbox` retry 创建新 Run `20261028-215509-1c7fd1cd`，第二 attempt `completed`，产出 `report` Artifact 引用和结果摘要。Task 页面 1440px/390px 均显示已完成、无页面错误/水平溢出 | 首个 attempt 是测试调用配置错误，不作为 Team 语义失败证据；没有对输出 Artifact 增加下载/内容读取的人工验收 |
| 隔离 Team Site 重启后查询 | 通过（单进程重启） | 停止并重启同一隔离服务后，Task 仍为 `completed`、`lastError: null`，两条 Run attempt 与原始 Artifact 输入引用可查询，成功结果仍包含 `report` 引用 | 不替代跨主机并发恢复或活动 Binding 中断故障注入 |
| 架构与 Artifact/Simulation 聚焦回归 | 通过 | `node --test apps/team-site/tests/architecture-boundaries.test.mjs apps/team-site/tests/team-ir-artifact-use-cases.test.mjs apps/team-site/tests/team-ir-studio-simulation.test.mjs apps/team-site/tests/team-ir-artifact-routes.test.mjs apps/team-site/tests/team-ir-project-run-executor.test.mjs`，27/27；修复 Application 用例直接导入文件存储、路径和 Node crypto 的架构边界违规，改由组合根和 ID 端口注入 | 全 Team Site 串行回归仍有失败项，见本轮回归记录；不可据聚焦通过标记整仓回归通过 |

**本轮全量回归结果：** `pnpm test` 通过，903 个含子测试项中 902 通过、0 失败、1 项 Windows 专项跳过。最近一次完整 Team Site 串行套件在更新默认作者页验收前非零退出，包含旧 Case/template materializer 生成的 Team 缺少冻结 v2 摘要，以及依赖旧 `/design` 页面/路由的浏览器断言；本轮已将默认视觉验收改为 v2、移除过期 legacy Studio Simulation 浏览器验收、更新重复创建页路由断言。随后 `node --test apps/team-site/tests/team-ir-studio-browser.test.mjs apps/team-site/tests/visual-acceptance.test.mjs --test-name-pattern='Team IR v2 Studio validates|default Team Studio creation'` 2/2，`node --test --test-name-pattern='duplicate team and project creation' apps/team-site/tests/product-logic-acceptance.test.mjs` 1/1；Team Site 完整套件尚未对这批最新改动重跑。`git diff --check` 通过。默认工作区 `.ogs/model-selection.json` 是既有用户改动，本轮未触碰。

**未覆盖与风险：** 真实 A2A intake 仍无远端 endpoint/认证配置；本机 Docker resolver 未提供强制网络 egress allowlist，不满足生产隔离要求。`/studio/new` 是唯一原生 v2 创建页且 `/studio/ir/new` 已移除，但启动时的活动经典模板 provisioning、Case API、项目 Case materializer、Team 版本编辑/调整和 `/design` 仍会创建或访问旧 Team 格式；尚未按最新要求切断这些消费者。阶段 1/2 语义矩阵尚有未支持拓扑/恢复边界。未完成这些门槛前，不得宣称旧内容清理完毕或发布完成。

**阶段结论：** Artifact Evidence 单场景真实 UAT 通过；阶段 0 通过，阶段 1/2 部分通过，阶段 3/4 进行中。UAT 记录不是全阶段通过或生产发布完成证明。

### 2026-10-28：v2 默认链路与旧入口清理增量

| 项目 | 当前实现与证据 | 状态 / 剩余项 |
| --- | --- | --- |
| 默认 Team 作者入口和版本编辑 | `/studio/new` 创建原生 v2；版本编辑进入 `/studio/teams/:id/ir`；`forkTeamVersion` 只复制原生 v2 IR，拒绝缺少 v2 IR 的旧 TeamVersion | 实现已切换；真实 resolver 下完整创建、保存、发布、关闭重开和发布后只读浏览器 UAT 尚需补齐 |
| 经典 Case 与内置模板 | 8 个 `cases.mjs` 条目各自对应 `examples/team-ir-v2/classic-*.json`；启动 provisioning 只使用 `templateId: team-ir-v2`，不再通过旧 Mermaid materializer | 8 个 provisioning 补偿测试及 fixture digest/compiler 合同通过；8 个场景的真实 Project Task UAT 尚未全覆盖 |
| 旧 Team API/Assistant | TeamVersion `/design`、`/graph`、`/chat`、`/release-baselines` 由统一 guard 返回 `TEAM_IR_V2_REQUIRED`；生产组合根已移除旧 Team Assistant use case、模型选择能力和 Visualizer HTTP adapter；旧 Team Design/asset、Mermaid design store/validator、Team package Simulation 与 Studio Simulation 独立模块已删除；已删未引用的旧 Assistant 错误 renderer/Simulation debug formatter | 当前 `app.js` 已无旧 Assistant/Graph/Draft renderer 与 release-baseline 调用分支，平台模型说明已改为 Codex/OpenCode 自动探测状态。旧 API 409 guard 保留为拒绝合同；standalone Visualizer 的 Mermaid/Project Package API 与 Run 路径仍有独立消费者，未计为可删除死代码，不能称全仓旧源码清零 |
| 旧数据与独立 OGS System 示例 | 本轮没有删除用户数据；本地旧 Run 归档位置见前序记录，仍为可恢复归档。独立 `examples/**/system.mmd` 不是 Team catalog/template 输入 | 旧数据尚未永久清除；只在确认属项目生成的旧 Team 配置与旧 Team Simulation 数据后，才删除对应活动数据，不触碰其他用户数据 |

**验证：** `pnpm build` 通过；`node --test apps/team-site/tests/team-api-routes.test.mjs apps/team-site/tests/case-api-routes.test.mjs apps/team-site/tests/team-ir-legacy-compatibility.test.mjs apps/team-site/tests/classic-case-v2-release-gate.test.mjs apps/team-site/tests/team-ir-studio-browser.test.mjs tests/team-ir-classic-case-v2-contract.test.mjs`，28/28；`node --check`（app.js/server.mjs/team-routes.mjs）与 `git diff --check` 通过。完整 Team Site 串行回归仍在运行，结果写于下一条记录；未以本组聚焦测试表示整套回归通过。

### 2026-10-29：旧 Team 代码清理增量

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 脱离生产装配的旧 Team Design/Simulation 源码 | 部分完成 | 移除旧 `team-design-use-cases`、Team Design asset store、Mermaid design store/validator、旧 Team package Simulation、旧 Studio Simulation use case/API/store/redaction 及其专属测试；v2 Simulation 脱敏工具迁为 `team-ir-simulation-redaction.mjs` 并更新调用点。`app.js` 删除未引用的 Assistant/Simulation 错误 renderer 与旧模型提示；`team-ir-legacy-compatibility.test.mjs` 静态防回流 Team Assistant 与旧 authoring handler | `server.mjs` 未装配的通用旧 Visualizer Run 路径及 standalone Visualizer 的 Mermaid/Project Package API 仍有调用方；它们与 Team IR v2 浏览器入口的隔离边界需单独确认，不能宣称旧源码已清零 |
| 旧测试装配 | 部分通过 | Team lifecycle 测试改用原生 FileStore 创建端口；产品回归移除已不存在的 `provisionBuiltInTeamVersions` 与旧 Team Design 用例；旧 classic graph、旧 Team package Simulation、Assistant、Team Role Source 导入浏览器测试已删除 | 其他 Project bundle 用例仍创建无 v2 IR 的 Team，导出时依赖 `system.mmd`；需明确删除该旧包行为或将项目包合同改为 Team IR v2 |
| Build 与 Team IR v2 聚焦回归 | 通过 | `pnpm build`；`node --test apps/team-site/tests/team-ir-studio-browser.test.mjs apps/team-site/tests/team-ir-studio-simulation.test.mjs apps/team-site/tests/team-ir-project-run-executor.test.mjs`，19/19；`git diff --check` 通过 | 仅为构建和 v2 定向覆盖，不代表完整 Team Site 回归通过 |
| Team Site 完整串行回归 | 失败（清理前基线） | `pnpm --dir apps/team-site test --test-concurrency=1`，501 项中 474 通过、26 失败、1 跳过；发现旧 Graph/Assistant/Simulation UI 测试失败、无 v2 IR 的旧包 fixture 依赖 Mermaid、Projects Task 创建/恢复以及团队同名并发测试失败 | 旧测试与模块删除之后尚未重跑全套；并发重名、Projects Task 页面和 Run 恢复失败需按最新 v2 合同复核并修复或替换有效验收 |

**未覆盖与风险：** 本轮未运行全 Team Site 回归、全部经典场景真实 Project Task UAT、远端 A2A UAT，也未提交。已有 Release Gate/Maker-Checker/Artifact Evidence 单场景 UAT 不能替代完整经典团队集验收。`.ogs/model-selection.json` 是既有用户修改，保留未动。

**阶段结论：** 旧 Team 代码清理尚未完成；阶段 1/2 仍按原矩阵部分通过，阶段 3/4 进行中。默认 v2 链路和 v2 定向测试通过，不代表完整发布门通过。

### YYYY-MM-DD：阶段 / 任务标识

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 示例 | 进行中 / 通过 / 失败 / 未运行 / 跳过 / 受阻 | 源码路径、测试路径、命令与退出结果 | 具体未完成项或无 |

**运行环境：** Node/pnpm 版本、OS、必要服务或配置。  
**变更范围：** 代码、Schema、Studio、API、示例和文档。  
**未覆盖与风险：** 写明未运行的验证及其影响；没有则写“无已知未覆盖项”。  
**阶段结论：** 仅当该阶段所有必需门槛均通过时写“通过”；否则写“部分通过”或“受阻”。

### 2026-10-29：继续清理新版本旧 Team/Run 入口（历史快照）

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 缺少原生 Team IR v2 时拒绝 Team readiness | 通过（窄合同） | `apps/team-site/infrastructure/team-ir-v2-readiness.mjs` 对 IR store 缺失和 Team IR v2 文档缺失分别返回阻断项；`runtime-project-readiness.mjs` 不再回退 Mermaid readiness。`apps/team-site/tests/runtime-project-readiness.test.mjs` 覆盖两种 fail-closed 情况及有效 v2 resolver | 全量 Team Site 回归和新版本全入口矩阵仍未通过 |
| Team 确认摘要仅以 Team IR v2 为源 | 通过（窄合同） | `runtime-team-confirmation.mjs` 删除 Mermaid 拓扑、Team Package 和旧 Project Asset digest 计算路径；缺失 Team IR v2 时拒绝确认。`runtime-team-confirmation-v2.test.mjs` 与 `runtime-task-execution-readiness-v2.test.mjs` 通过 | 所有确认、创建、发布入口的全量回归待清零 |
| Project Task 只调用 v2 Runtime | 通过（窄合同） | `task-execution-use-cases.mjs` 无条件要求 Task 和 TeamVersion 的冻结 semantic/compiled digest 相等，删除旧 Run Store 执行分支；生产组合不再注入旧 Run Store。测试加入 unbound Task 不 reserve 且不调用任一 executor 的拒绝合同 | 全量 Task retry/recovery/control、经典场景 UAT 尚未闭合 |
| Team Studio 缺 IR 不生成新草稿或引导迁移 | 通过（源码合同） | `renderStudioTeamIr` 缺少 v2 IR 时显示错误，不再使用本地 starter Team IR；删除“重建旧 Team”页面分支和未引用的 `starterTeamIr` | 缺 IR 的实际浏览器验收待补 |
| 旧 Project Package Team/Run 入口 | 部分通过 | 从 Team Site server 移除旧 Project Package import/export 路由及其 Mermaid Team package 生产组合；`projectVisualizerStore` 现在只暴露 Project workspace create/inspect，`apps/team-site/tests/project-store.test.mjs` 断言适配层不再导出 `exportTeamPackage`/`loadTeamPackage` | standalone Visualizer 仍实现并注册通用 Project Package API 和 Mermaid 读写路径；须另行确认是否属于新版本边界后删除其路由、核心函数与专属测试，不能称旧包源码已清零 |
| 构建与 v2 定向回归 | 通过 | `pnpm build`；`node --test apps/team-site/tests/team-ir-studio-browser.test.mjs apps/team-site/tests/runtime-project-readiness.test.mjs apps/team-site/tests/runtime-team-confirmation-v2.test.mjs apps/team-site/tests/runtime-task-execution-readiness-v2.test.mjs apps/team-site/tests/task-execution-use-cases.test.mjs`，22/22 | 不代表完整 Team Site 或全仓回归通过 |
| Team Site 完整串行回归 | 失败 | `pnpm --dir apps/team-site test --test-concurrency=1`，432 含子测试项，394 通过、37 失败、1 跳过。失败包含旧 Project Run readiness/confirmation 测试夹具、旧 Mermaid Team Package import/export 与测试、旧 Project Run 控制/重试和页面布局断言；未运行全仓回归 | 逐项把仍属于最新 Project Task/恢复/UI 的失败修到通过；过时旧 Team Package/Run 断言删除或改成 v2 拒绝合同，再重跑完整套件 |

**未覆盖与风险：** 当前仍存在旧 Mermaid Project Run executor、旧 Team/Project Package 相关模块和不可达 Team Graph/Assistant/调试工作区脚本。运行时部分入口现已 fail closed 或不再路由，但不能据此称旧源码清理、阶段 3/4 或发布验收完成。工作区中 `.ogs/model-selection.json` 用户修改未覆盖。

**阶段结论：** 阶段 0 通过；阶段 1、2 仍部分通过；阶段 3、4 进行中。旧 Team/Run 清理推进中，完整回归失败，真实经典场景 Project Task UAT、本轮用户验收和提交均未完成。

### 2026-10-29：结构化辩论真实 Sandbox Project Task UAT 与回归

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 真实 Team IR v2 保存/重开、Simulation、发布 | 通过（Structured Debate Reporter） | macOS、Node v22.21.1、pnpm；隔离 Team Site 使用 v2 OpenCode Docker resolver、仅本机 `0600` OpenCode serve 密钥文件和数据根 `/tmp/team-ir-v2-classic-real-uat-20261029`。经 `/api/v1/team-ir-drafts` 创建并保存当前 `classic-structured-debate.json`，重开校验 semantic digest `cc1c9151ffe7628549aaee7dbf0af539c27e2e77245cb263f09df7a414b572df`；真实 Simulation `4e50d1a9-2617-459f-b0c1-2133998ee34b` completed；发布 compiled digest `5fd24a75275afc47abb1f3f4ff4c4c34f3c7f00c04cc2e152267df32bc69a120` | 使用 API 导入 fixture 内容，不是逐字段 Studio 表单编辑；完整真实浏览器作者流程仍待验收 |
| 真实 Project mount 与两轮 Loop/Reporter Task | 通过（真实模型 Task） | 模型/Binding `codex-gateway/gpt-6-luna` / `modelRef: codex-gateway/gpt-6-luna`，`ogs-opencode-docker-adapter/1`，固定 Node image digest `sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`，调用经受限 Docker 容器到本机 OpenCode serve `http://host.docker.internal:4096`。Project `uat-debate-reporter-result-20261029-c44262f4`，Task `20261029-020454-e4ab349a`，Run `20261029-020454-93f1ea08` completed 且 `resultWritten=true` | 本机 Docker 网络未强制 egress allowlist；不构成生产隔离证明 |
| 真实辩论内容及运行语义检查 | 通过（9/9） | 检查持久 checkpoint `.../.ogs/runs/20261029-020454-93f1ea08/team-ir-v2-state/20261029-020454-93f1ea08.json`：Run completed、Loop 两轮、Judge 含 `proponentSummary`/`opponentSummary`/`rationale`，Reporter 同时呈现双方论点与裁判理由，明确记录 rebuttal 决定和未决结论；文本未错误声称缺少论点、证据或输入。全部 9 项运行/内容断言通过 | 这是 `classic-structured-debate` 单场景真实 UAT；其它场景、Review 用户决定、A2A 远端、失败重试和跨进程恢复仍需各自证据 |
| Artifact Evidence 的真实 Run input Artifact 登记、Task 快照、消费和授权结果读取 | 通过（真实 Project Task） | 隔离数据根 `/tmp/team-ir-v2-artifact-input-uat-20261029`；TeamVersion `artifact-input-real-uat-20759aca`，semantic digest `0753ee4bb6fc35aca93ad43285f0e74de971dfb62300da1e246e0ee82773f8be`，compiled digest `1b100c281ea784baddb4b7536d35c2244720ec5da825968f46ab5ccd05dfe0ec`。真实模型/Binding `codex-gateway/gpt-6-luna` / `modelRef=codex-gateway/gpt-6-luna`，`ogs-opencode-docker-adapter/1`，固定 Node image digest `sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`；opt-in adapter UAT 8/8。经 slot discovery 确认必填 `brief:text/markdown`，Simulation upload API 登记附件并传入 `attachments.brief`；发布后 Project `artifact-input-uat-project-8008b1ff` 登记 Artifact `art_337494cf-591c-410e-bce1-c6e197f230d9`，Task `20261029-021726-574decf4` 的 `runInputAttachments` 与请求快照一致，Run `20261029-021726-a603a7c7` completed 且 `resultWritten=true` | 未覆盖失败 Task 的 Artifact retry 快照重用与跨进程重启；Project Task 此场景成功后无需重试 |
| Artifact 输入 UAT 的失败恢复与内容授权检查 | 通过（受控 Simulation 修正和 owner scope） | 前两次真实 Simulation 分别以 `BINDING_SERVER_ERROR`（`dc9ffec4-4916-463c-92bf-69754ff7069f`）和 `BINDING_INVALID_OUTPUT`（`9b1d060a-2f01-45f3-a944-5c3e5353e064`）失败；适配器真实调用 probe 8/8 证明 provider/container 可达。将输出契约明确为 Team IR envelope 后，Simulation `aebd930e-48b0-4d82-8a3c-139914df4230` 成功，两 Agent completed。通过 owner-scoped Run result API 读取唯一 Result 和报告 Artifact；错误 Task ID 对同一 Run 返回 404。Artifact 内容确认模型实际引用 brief 中的产品要求，并产出含价值、数据处理、无障碍、风险与验收标准的 Markdown 报告 | 此 UAT 是 Artifact Evidence 场景的真实内容抽查；不能替代其它 classic 场景和 Artifact/Run 跨存储崩溃边界测试 |
| Studio 浏览器真实创建/保存重开/Simulation/发布/只读 UAT | 通过（真实 Chromium + trusted resolver） | TeamVersion `studio-browser-uat-2026-10-29-4bb9ae59`，semantic digest `d404427f606fa7ca3fa68de5ff791af0990fb8152fbbe695639fccadb3ab8e96`；真实浏览器在 `/studio/new` 创建 Team、编辑 packageRef/Handoff、保存并关闭重开，页面/API digest 一致。Simulation/Run `bed21b4e-6b33-4b99-8c94-cfafeb4228ef` completed 且 `resultWritten=true`；Release Readiness `ready=true`、proof=`team-ir-v2-sandbox`，发布 compiledPlanDigest `402b20abdb4f624ddba15661dfccdafa094fd6d2a7750f00b0623cc544c0ae4f`；published 后编辑控件禁用。1440px/390px 均无横向溢出、pageerror=0。两张截图已由 UAT 人工检查，临时截图文件现已清理，不作为持久附件 | 浏览器只编辑单 Agent/Handoff 简化 Team；直接拖线画布、Join/Loop/Review/Artifact 全字段可视化作者体验仍未完成 |
| Software Team Evidence 真实 Simulation、发布和 Project Task | Simulation/Release 通过；Project Task 受阻（模型输出无效） | Team `software-team-evidence-uat-09390124`，semantic digest `044110d6ca480ee84499d676cfdfb0b9f247cffe394b804f6af92c538842a81b`；成功 Simulation `745b8cc9-4f04-424e-a1fb-317ae23dd1d9` 跑过真实 Planner→Implementer/Tester parallel fan-out→Lead `all_of` Join→Result，产出三个 required Artifact，resultWritten=true；compiled digest `e1e6cdac…15baf`。据此发布并创建 Project `software-evidence-dashboard-project-uat-20261029-433b9397`，登记 brief `art_5a9fc5c6-84c2-4f14-9e9e-3705c1815202`，Task `20261029-024134-6704114e` 冻结附件引用。首次及 adapter `/2` 重启后的 retry Run `20261029-024135-8cd2dff8`、`20261029-024158-2f1eaf64` 均 `BINDING_INVALID_OUTPUT`；Task/API/Event 查询确认 retry 使用相同 brief ref 且创建新 Run。adapter `/2` 加强 required Artifact slot prompt，resolver 聚焦测试 7 通过、1 项 opt-in Docker skip | 两个持久 checkpoint 只保存 generic `invalid_output`，不保存模型文本或具体 validation 子原因；无法区分 JSON/envelope/data schema/artifact slot 哪个条件。没有 Project Task 成功 Result/provenance，不计通过；需提高输出稳定性后重跑 |
| A2A HTTP/SDK client 合同与真实远端前置条件 | 本地合同通过；远端 UAT 受阻 | `@a2a-js/sdk@1.3.0` 提供受信 origin/HTTPS client、配置 auth header、Agent Card discovery/Task/Parts/Artifact 映射与脱敏 HTTP 状态；官方 SDK `DefaultRequestHandler` localhost E2E 覆盖 discovery、认证 send、poll、typed envelope；A2A 三文件 20/20，`pnpm build` 与 `git diff --check` 通过 | 本机/Team Site 未发现兼容远端 A2A Agent Card URL、认证配置和测试 Agent；远端 UAT 未运行。需要 HTTPS Agent Card、授权方式和能处理 Team IR envelope/Artifact 的测试服务 |
| 并行首错意图不被 sibling cancel 覆盖 | 通过（Runtime 回归窄合同） | `src/team-ir/runtime.ts` 仅首个 failure intent 写入 `run.failing`，每个 invocation 仍记录自身失败；`tests/team-ir-fail-fast-runtime.test.mjs` 断言初始 `BINDING_POLICY` 保留，不被 sibling cancel 覆盖；`pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-fail-fast-runtime.test.mjs`，44/44 | 任意 Join/quorum/Review 并行竞态、多拓扑故障收敛和所有跨存储/中断边界仍未全部闭合 |
| Software Team adapter v3 真实 Project Task | 通过（无 Artifact 的 classic software Team 切片） | macOS、Node v22.21.1、OpenCode serve 127.0.0.1:4096、固定 Docker Node image digest sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914、adapter ogs-opencode-docker-adapter/3。隔离 Team Site 数据根 /tmp/team-ir-v2-software-uat-v3-20261029 已在验收后删除；TeamVersion software-team-evidence-uat-v3-f6932b4a 从 classic-software-team.json 创建（只替换 Team ID），semantic digest 0d6da84458ee0a3958b9f2b81985dc09cf2ef67e59d986b86a79c830420a78b5、compiled digest 0133cd9a162722b5849073cc99decfb558e9b380ac4b7476ecf10ddf6a5f8642。真实 Simulation 0a7096aa-b670-4bf4-b2ce-63ec33416937 完成，Planner、Implementer/Tester 并行 fan-out、Lead Join、Result 均成功且 resultWritten=true。基于相同 digest 发布；Project software-team-v3-project-task-uat-5d2e8927 mount 该 TeamVersion。单次 Project Task 20261029-025004-b484ad0b / Run 20261029-025004-e043f493 attempt 1 completed，Result API available=true、teamResult.summary 非空，run.result.written 一次，四个 Handoff 完成，错误/诊断为空；Task owner/frozen semantic 与 compiled digest 匹配。只对结果结构和非空作断言，没有输出或保留模型正文。该 classic software fixture 不定义 Artifact 输入/输出，因此本项不提供 Artifact provenance 证据 | 仅证明 adapter /3 下 classic software fan-out/Join/result 的单次 Project Task 成功；未覆盖 Artifact provenance、Task 重试、全部经典 Team 和生产网络 egress 隔离 |
| A2A 真实远端 UAT | 受阻（用户确认外部服务缺失） | 用户于 2026-10-29 明确回复“暂无远端服务”；本地 `@a2a-js/sdk@1.3.0` HTTP/localhost server interoperability 合同已完成 | 解除条件：提供 HTTPS Agent Card endpoint、认证配置名/本机凭据文件路径，以及能处理 Team IR JSON/Artifact 的测试 Agent；未提供密钥文本，不以 localhost SDK E2E 替代远端 UAT |
| Review 与并行 fan-out 拓扑拒绝 | 通过（fail-closed Runtime 回归） | `tests/team-ir-runtime.test.mjs`：`Review on a parallel fan-out route fails closed before any Binding invocation`；`pnpm build && node --test tests/team-ir-runtime.test.mjs`，41/41。断言稳定 `TEAM_REVIEW_TOPOLOGY_UNSUPPORTED`、Run 失败、0 次 Binding 调用且未创建 Review activation | 该组合仍不支持；多 Review Store/reducer 独立 deadline 测试不意味着 scheduler 并行 Review 已支持 |
| Maker-Checker 真实模型 Task Review reject/revise/approve | 通过（本机 OS principal/API 流程） | 隔离 TeamVersion `maker-checker-real-uat-0905c361`，semantic digest `7e0eebd04477eb7bfc651e3fd4bab39012995c40435a9e1c14bb0b419b4c1041`，Simulation `9258cb26-1a84-4b28-a0fc-e222f402828b` completed，compiled digest `7df117f7778cd5e200b03bc25cf98b665168caacc45da631a05c2cdca41e444c`。Project `maker-checker-review-uat-b907af2c`，Task `20261029-022236-0abf9e76`，Run `20261029-022236-65e8aaf1`；Run 进入 `waiting_human_review`，Review round 1 reject 通过 Schema 校验并在同 Run 进入 round 2，approve 后同 Run completed，结果非空；相同 approve/idempotency key 重放返回 200，服务重启后 Task/Run/Review round 2/result 仍可查询 | 验证了 API/本机 principal，不是独立审核员或外部身份服务；Review 产品页面操作与外部身份仍待验收 |
| 旧版本运行与隔离 UAT 数据清理 | 已从活动路径清理 | 核实根 `.ogs/runs/` 的 48 个 Run 均无 `team-ir-v2-state` checkpoint，并连同旧归档 `/tmp/team-ir-v2-legacy-runs-20261028`（256 个旧 Runtime 目录）、`.ogs/runs-index.json` 移入系统废纸篓；本轮已记录证据的隔离真实 UAT 根、旧隔离站点根一并清理。`.ogs/model-selection.json` 用户修改保留 | 废纸篓提供短期恢复能力；新版本不读取或迁移这些历史 Run |
| 旧 Team Design 孤儿 projector 清理 | 已删除 | 调用图审计确认 `visualizer-project-design-projector.mjs` 只由其自身测试引用、没有生产调用；删除该 `system.mmd` 读取/解析路径及专属旧测试 | OGS standalone Visualizer 不受此删除影响 |
| 根入口旧访客 Demo 清理 | 通过（入口与浏览器合同） | 删除旧 guest landing、demo 运行抽屉、本地假运行状态和 `/api/v1/demo-runs` 客户端调用；根路径服务端 302 与 SPA 导航统一进入 `/projects`。移除只服务 demo 的 landing/drawer CSS、dark-theme 规则及双语字典项；保留 `/teams` 原生 v2 案例库、`/history` Project Run 查询和 Team IR 结构图。Chromium 验收确认无 Authorization 请求时根入口指向项目页、`/studio/new` 返回原生 v2 创建页；`node --test apps/team-site/tests/visual-acceptance.test.mjs apps/team-site/tests/interaction-lifecycle.test.mjs` 3/3；`node --check`（app.js/state.js/server.mjs）和 `git diff --check` 通过 | Team Site 本机默认绑定 `127.0.0.1` 且不提供交互登录；本项未增加认证层。Review API 的 principal/authentication 合同保持原样 |
| Build、Team Site 与全仓完整回归 | 通过 | `pnpm build` 退出码 0；删除孤儿 projector 后 `pnpm --dir apps/team-site test --test-concurrency=1`：346 个含子测试项，345 通过、0 失败、1 项跳过，退出码 0；Visualizer fixture 切换后 `pnpm build && node --test tests/visualizer.test.mjs`，39/39；最终 `pnpm test` 通过，906 个含子测试项中 905 通过、0 失败、1 项 Windows 专项跳过，退出码 0 | 经典团队集、Review 外部用户、真实远端 A2A、未支持拓扑、完整 Studio 作者体验仍是阶段发布门 |

**补充经典场景真实 UAT：** `classic-conditional-signoff.json` 已在独立 Team Site 数据根 `/tmp/team-ir-v2-conditional-signoff-uat-20261029.gSTMMC` 完成真实 Simulation、发布、Project mount 和 Task。环境为 macOS、Node v22.21.1、`codex-gateway/gpt-6-luna`、`ogs-opencode-docker-adapter/3`、固定 Node image digest `sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`；容器请求经本机 OpenCode serve `127.0.0.1:4096`。TeamVersion `conditional-signoff-real-uat-20261029-dea31d21`，semantic digest `3d8c339dc9a529c5efdc17983010a3fde565d5156a18aff3dde78ee172f807e5`、compiled digest `f2a1a1d6405547ec587f2d2b38baf362235ca392b1bf7a75b7b7c29328ecc9ea`；Simulation `4071a9a3-e7c0-453b-aaeb-cc02d0454167` completed/resultWritten。Project `conditional-signoff-uat-project-20261029-9aaaa715`，Task `20261029-031743-54cea6ce`、Run `20261029-031743-be487471` completed，三个 Agent invocation 均 completed，`run.result.written` 一次。checkpoint 证明 primary 选中 `standard` 并到达 `primary-standard-signoff`，`primary-clinical-signoff` 被按 handoff ID 跳过，`compliance-signoff` 到达；人工抽查确认主审判断常规门诊采购无需临床升级，合规审查未凭空捏造特定隐私/流程问题，Chair 汇总与 Result 非空。未保留模型正文或凭据。隔离数据根在写入本记录后移入系统废纸篓；本 UAT 不覆盖独立审核身份、失败重试/重启、A2A 或全 8 个经典场景矩阵。

**条件会签真实 Project Task 受控失败、重试与进程重启查询 UAT：** 使用独立 Team Site `127.0.0.1:4189`、数据根 `/tmp/team-ir-v2-failure-retry-uat-20261029` 和临时 resolver wrapper；`classic-conditional-signoff.json` 的 TeamVersion `conditional-signoff-failure-retry-uat-3980f7c1`，semantic digest `44153b36807081e63898debd50781cab068b799bd9018db28ec3347b1ee2f838`、compiled digest `0dc7517f438811367f73e9ca3895286769e573caf69e67abd2fcb43925456632`，真实 Simulation `a5f77f80-a1aa-4a6d-a76c-c006bfa978d3` completed 后发布。Project `conditional-signoff-failure-retry-uat-valid-inpu-c12c7ad9`、Task `20261029-035927-ce77d659` 使用 131 字符字符串请求（SHA-256 `57f0dbc7262983593180a5b9b8f30e54651a736ab504e900a9c8f415533f7c58`）；冻结 Team semantic/compiled digest 与 mounted TeamVersion 一致。wrapper 仅对 Project Task 的首次真实模型 Binding 调用，在真实响应返回后丢弃响应并注入一次 `TeamBindingError(server_error)`；Simulation、Release 和 retry 均调用原真实 resolver。attempt 1 Run `20261029-035927-60f42e49` 失败码 `BINDING_SERVER_ERROR` 且之后仍可查询；同一 Task retry 创建 attempt 2 Run `20261029-035930-290a67fd`，状态 `completed`，Result API 可读，summary 长度 300，决策/临床升级/门诊场景关键词检查通过，`run.result.written` 恰为一次。Team Site 完整停止并以相同隔离数据根重启后，Task completed、attempt 1 failed、attempt 2 completed、两个 Run evidence 和 retry Result 均仍可查询；请求文本、模型输出和凭据均未写入台账。首次尝试将对象传入仅接受字符串的 Task API，导致 `[object Object]` 并产生无效结果；该错误尝试不计验收，改用上述字符串请求的新 Project 重新完成全链。验收完成后停止独立服务并删除临时 wrapper 与隔离数据根。此项证明条件会签单场景的受控失败/重试/重启持久查询，不证明其它语义、全部经典团队或发布完成。

**未覆盖与风险：** 结构化辩论、Artifact Evidence、Maker-Checker、Software Team 和条件会签已有真实模型 Task UAT；条件会签另有受控失败/重试/重启查询证据，但不代表六类必需语义团队及八个经典 fixture 全部完成。阶段 1/2 的复杂语义/受限拓扑边界、阶段 3 的自由布局和 Review 外部身份流程、阶段 4 的其余经典 UAT、独立 Review 身份、远端 A2A 仍未闭合。全仓和 Team Site 回归通过，但发布完成定义尚未满足。工作区 `.ogs/model-selection.json` 是既有用户改动，保留未动。

**最新回归与清理（2026-10-29）：** 最终 `pnpm test` 含 916 项，915 通过、0 失败、1 项 Windows 专项跳过，退出码 0；该命令包含 `pnpm build`。最终 `pnpm --dir apps/team-site test --test-concurrency=1` 含 349 项，348 通过、0 失败、1 项 opt-in Docker 跳过，退出码 0。另有 Schema resolver 诊断定向测试 16/16、Runtime/fail-fast/Join 联合测试 55/55、Team IR browser/legacy compatibility/Project Store 定向测试 15/15；Join timeout 迟到 arrival reducer 单测 10/10。曾有一次 Team Site 串行回归返回 314 通过、33 失败、1 跳过（控制台输出截断，失败标题未留存），其后完整重跑均通过；根级 `pnpm test` 曾有一次 845 通过、61 失败、1 跳过（失败标题未留存），之后完整重跑通过。两次异常失败原因未能确认，作为未复现风险保留。`node --test apps/team-site/tests/visual-acceptance.test.mjs apps/team-site/tests/interaction-lifecycle.test.mjs` 为 3/3。测试后将本轮测试新生成的 `.ogs/runs/` 与 `.ogs/runs-index.json` 移至系统废纸篓；本轮开始前两者不存在。保留 `.ogs/model-selection.json` 用户配置及其余原有 `.ogs` 文件。先前 adapter `/2` 的 Software Task 失败保留为历史证据，最新 adapter `/3` 成功见上方独立记录。

**阶段结论：** 阶段 0 通过；阶段 1、2 部分通过；阶段 3、4 进行中。默认创建、fork、Case/template 已切到 v2，但发布完成定义尚未满足。

### 2026-10-29：Join 超时迟到结果与 Schema 端点分支补充

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：Handoff endpoint discriminator 非法字段组合 | 通过（字段分支窄矩阵） | `tests/team-ir-schema.test.mjs`：`endpoint discriminator rejects every incompatible branch field at its exact pointer`，表驱动覆盖 Run/Agent source 与 Agent/Result target 的跨分支字段和未知字段，并断言精确 JSON Pointer；同文件 `Handoff endpoint kinds and Run/Result endpoint fields are exact` 保留 kind、必需字段和方向非法用例 | 不替代全根 Schema 字段域、嵌套组合与所有静态诊断 code/pointer 的完整追溯矩阵 |
| 阶段 2：Run-scope Join timeout 迟到成功与 File Store deadline 恢复 | 通过（当前单 Join 调度拓扑窄合同） | `tests/team-ir-runtime.test.mjs`：`an unconfirmed Join timeout keeps a late successful source from invoking the Join target` 断言取消未确认后来源迟到成功仍使 Run 以 `JOIN_TIMEOUT` 失败、Join target 不执行、没有 pending Result；`FileTeamRunStore recovery preserves the remaining deadline for collecting all_of and quorum_of Joins` 覆盖两种模式沿用持久 deadline，截止前保持 running、到期后失败并只请求取消一次 | 不覆盖多 Join/quorum、Loop/Join 组合及跨 ArtifactStore/RunStore 原子边界；这些拓扑仍按当前受限合同拒绝或未实现 |
| 本轮聚焦验证 | 通过 | `pnpm build && node --test tests/team-ir-schema.test.mjs tests/team-ir-runtime.test.mjs && git diff --check`，60/60；`pnpm --dir apps/team-site test --test-concurrency=1`，349 项中 348 通过、0 失败、1 项 opt-in Docker UAT 跳过；`pnpm test`，918 项中 917 通过、0 失败、1 项 Windows 专项跳过，退出码 0 | Team Site 同一代码首轮曾报告 1 项失败、1 项跳过，进度输出未保留失败标题；用 `pnpm --dir apps/team-site exec node --test --test-concurrency=1 --test-reporter=spec` 完整重跑为 349 项中 348 通过、0 失败、1 项跳过。首轮异常未复现，保留为风险 |
| 回归生成数据与工作区 | 已清理测试产物 | 全仓回归新生成的 18 个 `.ogs/runs/` Runtime 目录（约 3.2 MB）和 `.ogs/runs-index.json` 已移入系统废纸篓；原有 `.ogs/model-selection.json` 用户改动保留 | 废纸篓提供短期恢复；本轮未改动或提交本机模型选择配置 |

**阶段结论：** 本轮补齐若干阶段 1/2 定向边界证据，但不支持将阶段 1、2 标为通过。阶段 3/4、全部经典场景真实 UAT、独立 Review 身份、远端 A2A、发布门和旧源码剩余清理仍未闭合。

### 2026-10-29：阶段放行 PASS/REJECT 真实 Project Task UAT

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 真实 Team IR v2 保存/重开、Simulation 与发布 | 通过（隔离本机 Team Site） | Team Site `127.0.0.1:4174` 使用全新 `/tmp/team-ir-v2-release-gate-uat-20261029` 数据根及已验证 Docker/OpenCode resolver。TeamVersion `classic-release-gate-uat-1e32a752`，semantic digest `e13495b474668be6fd0d023b73fae4f80d32429194d4f6229a9c42925fcc5015`、compiled digest `87d706b6ce5d239edce9a5737103cc122a9b7fd356f853f8bc32dfd10377a41a`；保存后重读 digest 相同。第一次 Simulation 因材料不足触发角色 `ABSTAIN`，Run 正确以 required Result 缺失失败；该次不计通过。补充每项已验证的释放证据后 Simulation `b1f91b31-590f-41d8-8438-f09357024966` completed 且写入结果，随后同 digest 发布 | API 导入最新 fixture，不是逐字段 Studio 编辑；初次 ABSTAIN 失败保留作诊断证据 |
| Project mount 与 PASS 路由真实模型 Task | 通过（真实 Task 结果） | Project `classic-release-gate-project-uat-27800137` mount 上述 released TeamVersion；Task `20261029-042733-4ffe1872` / Run `20261029-042733-2fae3851` completed，Result API `available=true`，决策 `PASS`、summary 191 字符，`run.result.written` 的 `handoffId=gate-pass-result` | 本机 Docker bridge 未强制网络 egress allowlist；只检查了决策与摘要非空，未保存模型正文；本场景没有跨进程重启查询 |
| 同一 Project 的 REJECT 路由真实模型 Task | 通过（真实 Task 结果） | Task `20261029-042813-6868a558` / Run `20261029-042813-2d8cdc57` 使用明确阻断证据，completed；Result API `available=true`，决策 `REJECT`、summary 204 字符，`run.result.written` 的 `handoffId=gate-reject-result` | 与 PASS 相同的网络隔离限制；未对自然语言理由做语义抽查 |

**阶段结论：** 阶段放行团队的真实 Project Task 现证明 PASS/REJECT 两条互斥结果路径、唯一 Result 写入和持久路由 handoff ID；不代替 Release Gate 对活动并行失败、checkpoint 重启、通用结果冲突和其它经典场景的独立验收。阶段 1/2 仍部分通过，阶段 3/4 仍进行中。

### 2026-10-29：Studio 诊断目标定位反馈

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 3：点击诊断后定位基础字段和高级 JSON | 通过（浏览器窄合同） | `apps/team-site/public/app/views/app.js` 在目标控件上聚焦、选中值、滚动居中，并短暂增加定位高亮；`apps/team-site/public/styles.css` 定义高亮样式。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 在真实 Chromium 页面中提交非法 Team ID 后点击 `/team/id` 诊断，断言基础字段焦点、选区和高亮；同一测试继续验证 Review timeout JSON Pointer 和带 `/`、`~` 转义的高级 JSON 精确选区。`pnpm --dir apps/team-site exec node --test tests/team-ir-studio-browser.test.mjs`，1/1 | 只覆盖一个基础字段及两个高级 JSON pointer 形态；还未对所有诊断 code/pointer、移动端滚动边界和不同类型控件做完整矩阵；不是生产 resolver/Review 身份 UAT |

**阶段结论：** 诊断目标定位的浏览器反馈闭合一个阶段 3 窄切片。自由布局拖线、Join/Loop 全字段可视化编辑、诊断全矩阵、生产 Review 用户流程及完整发布浏览器验收仍未完成，阶段 3 保持进行中。

### 2026-10-29：Join 来源失败收敛与集成回归

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 2：`all_of` 必需来源失败收敛 | 通过（单 Run-scope Join） | `tests/team-ir-runtime.test.mjs`：`an all_of source failure prevents the Join target and Result after another source has completed` 让一个来源成功、另一个来源以 transport 错误失败，断言 Run 保留失败意图、失败来源失败、Join target 未调用且没有 pending/已写 Result；与前两项 Join timeout 窄合同合计 Runtime 专项 45/45 | 不覆盖多 Join/quorum、Review/Loop 并行组合、跨 ArtifactStore/RunStore 崩溃边界和外部 Binding exactly-once |
| 当前工作树完整回归 | 通过 | `pnpm test`（含构建）：919 个子测试项，918 通过、0 失败、1 项 Windows 专项跳过，退出码 0；`pnpm --dir apps/team-site test --test-concurrency=1`：349 项，348 通过、0 失败、1 项 opt-in Docker UAT 跳过，退出码 0；Studio Playwright 定向用例 1/1，`git diff --check` 通过 | 完整回归通过不改变阶段 1–4 的未完成范围；opt-in Docker 测试本次未运行 |
| 回归生成数据清理 | 已清理测试产物 | 全仓回归生成的 8 个 `.ogs/runs/` 目录（约 1.6 MB）及 `.ogs/runs-index.json` 已移入系统废纸篓；保留用户 `.ogs/model-selection.json` | 废纸篓提供短期恢复；本机模型配置没有提交 |

**阶段结论：** 本轮关闭 `all_of` 来源失败时不启动 Join/Result 的确定性断言，并通过全仓与 Team Site 回归。阶段 1/2 仍部分通过，阶段 3/4 仍进行中；自由布局作者画布、Review 独立身份、完整经典场景矩阵、远端 A2A 和全部旧源码/发布门仍未清零。

### 2026-10-29：复杂 Schema pointer 与并发 quorum Artifact 回归

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1：复杂 JSON Schema 静态提示及 Runtime 校验 | 通过（Agent input 窄合同） | `tests/team-ir-payload-validation.test.mjs` 覆盖 `oneOf`、`not`、`if/then/else` 组合；mapping validator 对复杂约束发出 `IR_MAPPING_RUNTIME_CHECK_REQUIRED` warning，精确定位 `/handoffs/0/map/data/prompt`；合法 payload 通过，三种非法 payload 以 `IR_RUNTIME_SCHEMA_INVALID` 精确定位 `/agents/0/inputPorts/draft/dataSchema/prompt`。`pnpm build && node --test tests/team-ir-payload-validation.test.mjs tests/team-ir-mapping-validation.test.mjs`，27/27；pointer 增断言后 `node --test tests/team-ir-payload-validation.test.mjs`，4/4 | 只证明 Agent input 一组复杂关键字；其它 Run/Result/Agent output/Review/Artifact schema 根及更大组合仍需追溯。静态任意蕴含推理不属于本合同，复杂约束由 Runtime validator 承接 |
| 阶段 2：quorum Join Artifact 选择不依赖并发先后 | 通过（单 quorum Join） | `tests/team-ir-join-artifact-runtime.test.mjs` 不再假设固定来源先到；断言达到 threshold 时仅将一个被选中来源的 Artifact 加入 allowlist 和 merged provenance，另一个来源只记为 late arrival。`node --test tests/team-ir-join-artifact-runtime.test.mjs`，3/3 | 多 quorum Join、quorum+Loop 及其它并行故障组合仍未支持或未覆盖 |
| 当前完整回归 | 通过 | `pnpm test`（含 build），920 个含子测试项：919 通过、0 失败、1 项 Windows-only skip，退出码 0；`pnpm --dir apps/team-site test --test-concurrency=1`，349 项：348 通过、0 失败、1 项 opt-in Docker skip，退出码 0；最后加入 missing/null pointer 断言后再次运行 `pnpm build && node --test tests/team-ir-schema.test.mjs tests/team-ir-payload-validation.test.mjs tests/team-ir-mapping-validation.test.mjs`，43/43，`git diff --check` 通过 | Docker UAT skip 不等于生产 resolver/UAT 通过；完整回归通过不改变阶段 1–4 的剩余门槛 |
| 测试产物和工作区配置 | 已清理测试产物 | 全量与定向测试生成的 16 个 `.ogs/runs/` Runtime 目录及 `.ogs/runs-index.json` 均已移入系统废纸篓；`.ogs/model-selection.json` 用户改动保持未暂存、未提交 | 无 |

**阶段结论：** 本轮补强复杂 Schema warning/runtime pointer 与 quorum Artifact 并发中立断言；阶段 1/2 仍部分通过，阶段 3/4 仍进行中。自由布局 Studio、受限拓扑实现、独立 Review 身份、完整经典团队 UAT、远端 A2A 与旧源码清理仍是未清零门槛。

### 2026-10-29：跨进程 A2A input-required 取消

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| Runtime 新实例取消已暂停的 A2A Task | 通过（持久 checkpoint 窄合同） | `TeamBindingInvocation` 增加可选 `remoteTaskId`；Runtime 取消 `input-required` invocation 时将 checkpoint 中的 Task ID 传给 Binding，记录 outcome、清除当前 pendingInput 并结算暂停 Run。`createTeamA2ABinding` 在本进程没有 invocation control 时使用持久 Task ID 调用 `cancelTask`。`tests/team-ir-runtime.test.mjs` 用两个 `FileTeamRunStore`/Runtime 实例验证不重放 Binding、远端 Task 被取消且 Run 进入 `cancelled`；`tests/team-ir-a2a-binding.test.mjs` 覆盖 adapter 直接恢复取消；`apps/team-site/tests/team-ir-project-run-executor.test.mjs` 覆盖 Project Task control 经新 executor 实例取消远端 ID。`pnpm build && node --test tests/team-ir-a2a-binding.test.mjs tests/team-ir-runtime.test.mjs apps/team-site/tests/team-ir-project-run-executor.test.mjs`，71/71 | 未确认远端取消仍记录 `outcomeUnknown`；跨进程活动 sibling 仍 fail closed/需单独收敛验证。该合同不替代真实 HTTPS A2A Agent UAT |
| 当前完整回归 | 通过 | `pnpm test`（含 build），922 个含子测试项：921 通过、0 失败、1 项 Windows-only skip，退出码 0；`pnpm --dir apps/team-site test --test-concurrency=1`，349 项：348 通过、0 失败、1 项 opt-in Docker skip，退出码 0；`git diff --check` 待本轮文档更新后重跑 | Docker UAT skip 不代表真实 Sandbox/A2A UAT；发布阶段仍有未完成门槛 |
| 回归产物 | 已清理 | 上述回归生成的 8 个 `.ogs/runs/` Runtime 目录及 `.ogs/runs-index.json` 已移入系统废纸篓；`.ogs/model-selection.json` 本机用户改动未暂存、未提交 | 无 |

### 2026-10-29：Studio 事件端口拖放连线

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 3：从结构图来源拖到目标创建 Handoff | 通过（浏览器合同切片） | `apps/team-site/public/app/views/app.js` 为 Run/Agent 来源操作及 Agent/Run Result 目标操作增加原生拖放；拖放仍复用现有连接创建路径和端口选择器，生成显式 Handoff、路由与空字段映射草稿。点击式来源/目标操作继续可用，便于键盘操作。`apps/team-site/public/styles.css` 增加拖动源与可放置目标状态。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 在 Chromium 中选择 Agent `BLOCKED` 输出和 `audit` 输入，实际 `dragTo` 后断言两个 endpoint，并继续断言 IR 保存、重载和 digest 语义；`pnpm build && pnpm --dir apps/team-site exec node --test tests/team-ir-studio-browser.test.mjs`，1/1 | 当前结构图仍是自动排布节点卡片和 Handoff 列表，不提供节点自由布局、画布上的独立端口桩/连线几何编辑；Review 使用外部身份的完整 Project Task 浏览器验收也仍未完成 |

**阶段结论：** 本轮闭合事件端口拖放创建 Handoff 的浏览器合同，不宣称完整 Studio 完成。现有浏览器 resolver 是隔离测试 Fake，只证明页面/API 和 Runtime 模拟合同；生产 Review 用户操作仍需配置并验收真实身份主体、授权决策和服务重启后的待审恢复。阶段 3 继续进行中。

### 2026-10-29：独立 Run-scope 多 quorum Join

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 2：多个独立 quorum/all_of Join | 通过（无 Loop 的 Run-scope Join） | `src/team-ir/runtime.ts` 不再把 `quorum_of` 限制为全 Team 唯一 Join；各 quorum 按 Join ID 独立记录来源状态、deadline、merged contribution 与目标触发状态，条件 skip 分别结算到每个参与 Join。`tests/team-ir-runtime.test.mjs` 的 `independent quorum and all_of Joins execute and persist separate rounds` 运行两个独立 quorum，并将第二个改为 all_of 再跑一次，断言两个 Join round 均 ready、各目标仅调用一次；Loop + quorum 仍在 Binding 调用前 fail closed。`pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-join-runtime.test.mjs tests/team-ir-loop-join-runtime.test.mjs tests/team-ir-join-artifact-runtime.test.mjs tests/team-ir-fail-fast-runtime.test.mjs`，71/71 | 不扩展 quorum + Loop、Review + parallel fan-out、Loop 多 lineage、跨 ArtifactStore/RunStore 原子事务；各限制仍需在设计的首版边界内保持 fail closed |
| standalone OGS System/CLI 旧格式源码清理审计 | 保留（有独立用途） | `src/visualizer/client-app.ts` 的 System Release Export 经 `/api/v1/ogs/workspace/export` 导出 standalone OGS System 项目；该流程被活动 UI 使用，处理 `system.mmd`、角色和运行配置。`src/visualizer/project-projection.ts` 的 `loadTeamPackage` 仅测试调用，无生产 HTTP 调用，可在归并旧内容清理时删除；Team Site v2 组合根不暴露 Project Package import/export，`apps/team-site/tests/project-store.test.mjs` 已断言只提供 `createWorkspace`/`inspectWorkspace` | 本阶段清理只删除无 v2 调用方的旧 Team 代码，不移除 standalone System 的有效 Release Export/CLI。移除该活动功能需要另行替换 System artifact 导出，不属于 Team IR v2 切换合同 |
| 当前全仓与 Team Site 回归 | 通过 | `pnpm test`（含 build）：923 个含子测试项，922 通过、0 失败、1 项 Windows 专项跳过；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec`：349 项，348 通过、0 失败、1 项 opt-in Docker UAT 跳过。Team Site 首次回归时系统临时卷仅剩 102 MiB，`mkdtemp` 报 `ENOSPC` 并产生级联失败；空间恢复至 5 GiB 后完整重跑通过，故首次失败保留作环境证据，不计作代码失败。`git diff --check` 通过 | 本轮未运行 opt-in Docker Test；真实远端 A2A UAT 仍缺服务 |
| 回归生成数据和工作区 | 已清理测试产物 | `pnpm test` 在仓库 `.ogs/runs/` 生成的 8 个 Runtime 目录（共约 1.6 MiB）及 `.ogs/runs-index.json` 已移除；时间戳均为本轮运行时间。`.ogs/model-selection.json` 用户配置保留 | 用户已有配置未暂存、未提交 |

**阶段结论：** 多个互相独立的 Run-scope quorum/all-of Join 已接入并通过状态机回归。设计矩阵仍要求跨 Scope/Review 并行等已列明组合与 Artifact/Run 存储边界继续验收；不能将 fail-closed 拒绝或本地合同替代真实远端 A2A。阶段 2 仍为部分通过。

### 2026-10-29：阶段 1 追溯复核与 Loop-scope quorum Join

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 1 Schema、静态诊断、引用和映射门槛 | 通过 | 复核 `team-ir-handoff-v2-design.md` §10 与追溯矩阵，逐项核对合法/非法例、稳定诊断 code/pointer、复杂 Schema warning 与调用前 Runtime 校验；独立审计未发现设计硬门缺项。本轮复跑 `node --test tests/team-ir-schema.test.mjs tests/team-ir-validation.test.mjs tests/team-ir-mapping-validation.test.mjs tests/team-ir-reference.test.mjs tests/team-ir-schema-resolver.test.mjs tests/team-ir-index.test.mjs tests/team-ir-payload-validation.test.mjs`，83/83；另有此前阶段 1 聚焦集合 86/86 记录 | 非必需的 Schema 笛卡尔组合未穷举；不属于阶段 1 硬门。Runtime/API/Studio 另按各自阶段验收 |
| Loop-scope `quorum_of` Join | 通过（单 Loop/单 Join 的受限拓扑） | 提交 `cbc6864 feat(team-ir): support bounded loop quorum joins`；`src/team-ir/runtime.ts` 仅放行单 Loop、单匹配 Loop-scope quorum Join，并按 Loop round 独立持久化状态；其它 Loop+quorum 组合仍 fail closed。`tests/team-ir-loop-join-runtime.test.mjs` 覆盖 threshold=1 早触发与迟到贡献不改 merged 输入、threshold=2 超时取消活跃来源、FileTeamRunStore 新实例保留 `startedAt`/deadline 并按原期限失败。`pnpm build && node --test tests/team-ir-loop-join-runtime.test.mjs`，11/11；`node --test tests/team-ir-runtime.test.mjs tests/team-ir-loop-join-runtime.test.mjs`，58/58；`git diff --check` 通过 | 不支持多 Loop、嵌套 Loop、quorum + 其它 Join、并发多 lineage；Review 并行、跨 ArtifactStore/RunStore 提交和一般 Loop lineage 仍待阶段 2 |
| 当前 OpenCode CLI provider 请求 | 通过（模型连通性） | `OPENCODE_CONFIG="$HOME/.config/opencode/gpt6-luna-client.json" opencode run --pure --format json --model codex-gateway/gpt-6-luna --dir "$PWD" 'Return exactly MODEL_CONNECTIVITY_OK and nothing else.'` 返回 `MODEL_CONNECTIVITY_OK`；不输出或复制本机配置中的 API key | 只证明 provider 请求可用，不构成 Docker Binding、真实 Team Project Task 或 A2A UAT |
| 本轮真实 Docker Binding opt-in 请求 | 未通过 / 环境阻塞 | 执行 `OGS_TEAM_IR_V2_DOCKER_BINDING_UAT=1 OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE="$HOME/.config/opencode/gpt6-luna-serve.env" node --test apps/team-site/tests/team-ir-v2-opencode-docker-resolver.test.mjs`；8 个前置 resolver/pin 测试通过后卡在 `docker run`，本次未返回模型结果。独立 `docker ps` 同样超过 60 秒无响应；中断了本轮启动的测试与 Docker CLI，不终止 Docker Desktop 后端 | Docker daemon 恢复响应后重跑 opt-in 模型 Binding 和真实 Project Task UAT；本项不得计为通过 |

**阶段结论：** 阶段 0、1 通过；阶段 2 仍部分通过；阶段 3、4 仍进行中。Loop-scope quorum 已从明确拒绝推进到受限支持。当前 OpenCode CLI provider 请求可用，但本轮 Docker daemon 无响应，不能据此继续确认 Sandbox Binding；Review/并行、一般多 lineage、跨存储提交、完整浏览器/身份验收和远端 A2A 仍未清零。Proposal 继续等待本台账所有必需门槛清零。

### 2026-10-29：并行 Review 收敛、旧 Team Package helper 清理

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| Run-entry parallel fan-out 的独立 Review gates | 通过（无 Loop/Join 的受限组合） | 提交 `cbc6864` 之后的 Runtime slice 增加 `waitingReviews`，仍将首个待审 gate 投影到 `waitingReview` 供现有单项 UI 使用。仅支持 Run-entry parallel fan-out、无 Loop/Join、每个来源分支一个 Review；各 Review activation/deadline 单独持久化，第一次批准后 checkpoint 只保留仍 pending 项，全部批准后才恢复分发，且不重放已完成来源调用。跨 FileTeamRunStore/Runtime 新实例恢复由 Runtime 聚焦测试覆盖；API resolver/decision 以 handoff ID 在 `waitingReviews` 中定位；File Run Query 与运行页面暴露待审集合。`pnpm build` 通过；`node --test tests/team-ir-runtime.test.mjs tests/team-ir-review-runtime.test.mjs tests/team-ir-fail-fast-runtime.test.mjs` 58/58（代理运行）；本轮 Team Site Review API、Project Run executor、Studio browser、Team lifecycle、classic release gate 定向集 51/51 | Review + Join/Loop/Agent-source fan-out 组合仍 fail closed 或未实现；真实身份和真实 Sandbox 下多 Review Task UAT 尚未完成 |
| 无调用方的 standalone Project Package Team importer 清理 | 已删除孤儿实现 | 审计确认 `projectVisualizerStore` 与 standalone Visualizer HTTP server 均无 `loadTeamPackage` 生产调用，仅一条 Visualizer 测试直接调用。删除 `src/visualizer/project-projection.ts` 中 `loadTeamPackage` 及仅为其服务的安全写入辅助函数，移除 Team Site 生命周期测试中的死 `packageStore` mock；保留仍被活动 System Release UI/API 使用的 `exportTeamPackage` standalone System 导出。`rg loadTeamPackage` 不再匹配生产源码，相关回归 `node --test tests/visualizer.test.mjs` 39/39、Team lifecycle/release-gate 定向回归通过 | standalone System 的 `system.mmd`、Release Export 与通用 Project Package 路径有活动独立用户，不作为 Team IR v2 孤儿删除；需继续核查其它旧 Team 源码 inventory |
| 本轮代码/文档完整回归 | 通过（非 opt-in UAT） | `pnpm test` 含 build：927 个子测试，926 通过、0 失败、1 个 Windows 专项跳过，退出码 0；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec`：350 项，349 通过、0 失败、1 个 opt-in Docker 跳过，退出码 0。`pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-loop-join-runtime.test.mjs tests/team-ir-review-runtime.test.mjs apps/team-site/tests/team-ir-review-api.test.mjs apps/team-site/tests/team-ir-project-run-executor.test.mjs` 有一次 88/89；失败未保留诊断标题，随后同一命令重跑未产生失败匹配，且独立 Loop Join spec 11/11、全仓完整回归全绿。`tests/visualizer.test.mjs` 39/39；`git diff --check` 与修改 JS `node --check` 通过 | 完整确定性套件绿不代表 Docker 模型 Binding/真实 Project Task 已通过；opt-in Docker 测试本轮因 Docker CLI 无响应未完成 |

**阶段结论：** 阶段 0、1 通过；阶段 2 仍部分通过；阶段 3、4 仍进行中。并行 Review 有了 Runtime checkpoint 与 API/查询桥的本地合同证据，但不等于生产身份/真实 Sandbox UAT。loop-lineage、跨 Artifact/Run 存储恢复、全部经典团队运行矩阵、完整作者体验和远端 A2A 仍未清零。

### 2026-10-29：Artifact 发布恢复、Studio 自由布局画布与经典场景矩阵

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 2：ArtifactStore/RunStore 发布边界恢复 | 通过（可恢复可见性协议） | `src/team-ir/artifact-store.ts` 增加 prepared/committed publication；Runtime 先持久化 invocation 输出引用和 publication intent，RunRecord CAS 是 Artifact 可见性提交点，之后幂等提交 Artifact index 并标记 intent committed。`tests/team-ir-artifact-store.test.mjs` 覆盖 prepared 不可读取、blob/index 中断；`tests/team-ir-runtime.test.mjs` 覆盖 Run CAS 前失败、CAS 成功但响应丢失、Artifact 已提交但响应丢失后以新 FileStore/Runtime 恢复；Binding 只调用一次。`pnpm build && node --test tests/team-ir-artifact-store.test.mjs tests/team-ir-runtime.test.mjs && git diff --check`，62/62 | Run CAS 前的 prepared blob/index 可能成为不可访问孤儿；当前无物理回收。该协议不代表所有外部 Binding 副作用 exactly-once，活动调用跨进程恢复和任意调度中断仍按阶段 2 未完成项处理 |
| 阶段 3：Studio 自由布局与独立端口画布 | 通过（浏览器切片） | `apps/team-site/public/app/views/app.js` 将节点坐标存于按 Team ID 隔离的本地浏览器状态，不写入 Team IR/digest；每个 Run/Agent/Result 端口有明确锚点，Handoff 以 SVG 几何连线显示。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 在窄屏验证画布可横向滚动、拖动 Run 节点并持久化布局、检查连线路径并从 Agent `BLOCKED` 输出拖到 `audit` 输入；`pnpm build && pnpm --dir apps/team-site exec node --test tests/team-ir-studio-browser.test.mjs`，1/1 | 这是自由布局画布合同切片；生产 resolver 下完整保存/发布/Project Task 浏览器验收、Review 身份流程、全部诊断定位矩阵和复杂合同字段作者体验仍未闭合 |
| 阶段 2：Run-scope all-of Join 目标 Review | 通过（受限拓扑） | `src/team-ir/runtime.ts` 仅支持无 Loop、单 Run-scope all-of Join、Run-entry parallel fan-out producer 与 Join 来源一一对应、Join target 唯一 Review 的组合；其它 Review + Join/Loop/fanout 组合继续 fail closed。`tests/team-ir-runtime.test.mjs` 验证 Join deadline=150，Review deadline=200；Join timeout 后仍在审核等待，FileStore 新 Runtime 恢复不重放来源/目标 Binding，并发 resume 有单一 scheduler 状态转换、Result 单写；reject 与 `REVIEW_TIMEOUT` 均失败关闭。`pnpm build && node --test tests/team-ir-runtime.test.mjs && git diff --check`，54/54 | 生产身份下完整 Review 用户流程和更广泛 Review/Join/Loop 拓扑仍未通过 |
| 阶段 3：Agent 多 input/output port 结构化编辑 | 通过（浏览器合同切片） | `/studio/teams/:id/ir` 逐端口编辑 ID、完整 `dataSchema` 和 Artifact slots JSON，可添加/删除；仍被 Handoff/Route/Join/Review 引用的端口无法删除。高级 JSON 未改动的完整合同保留；浏览器创建非首 input/output port、添加/删除与 Handoff 使用 `ALT_DONE`，保存重开后断言完整 Schema、Artifact slot 和 digest。`apps/team-site/tests/team-ir-studio-browser.test.mjs`，1/1 | 复杂合同仍可直接使用高级 JSON；生产 resolver 发布和 Project Task 浏览器流程、诊断全矩阵与独立 Review 身份 UAT 未闭合 |
| 阶段 3：Studio Review gate 结构化编辑 | 通过（浏览器合同切片） | `/studio/teams/:id/ir` 支持添加/移除 Review，编辑 ID、已存在的 Agent output 位置、feedback Schema JSON 与 timeout；`onTimeout` 固定 fail-closed。Review 表单与高级 JSON 双向同步，保存/重开保留语义合同；无效位置在 validate/save API 调用前阻断。删除被 Handoff/Route/Join/Loop/Review 引用的 Agent 也会被阻止；`apps/team-site/tests/team-ir-studio-browser.test.mjs` 1/1 | 只证明作者合同；Project Task 中独立审核身份、Review resolver 和生产用户审核流程仍未通过 UAT |
| 阶段 4：8 个 classic fixture 的确定性执行追溯 | 通过（Fake Binding 场景矩阵） | Software、Artifact Evidence、Expert Consultation、Conditional Signoff、Structured Debate、Maker-Checker、A2A Intake、Release Gate 八个 `examples/team-ir-v2/classic-*.json` 均有对应 Fake Binding Runtime 执行测试。另补 `tests/team-ir-classic-conditional-signoff.test.mjs` 的同端点条件来源、超时 checkpoint 恢复与迟到来源断言（与 Join 测试 15/15），以及 `tests/team-ir-classic-maker-checker.test.mjs` 的 reject 同幂等键重放只落一个审核事件（与 Review Runtime 测试 9/9） | Fake Binding 覆盖不等于八个真实 Sandbox Project Task UAT；Artifact 与软件 fan-out/retry 主要是分开的经典场景合同。远端 A2A 的真实服务仍缺失 |
| 阶段 4：旧 Team 源码与用户文档核对 | 通过（本轮 inventory） | 审核 Team Site 生产组合仅暴露 workspace create/inspect，旧 Team authoring API 统一 409；`loadTeamPackage` 无生产调用，standalone `system.mmd`/Project Package export 有活动 OGS System 调用方，故保留。修正 `apps/team-site/README.md` 中旧 confirmed/projectDigest、`/design` 和 Mermaid Team 作者流程说明；legacy refusal、catalog、Team API 定向回归 15/15 | 未发现可安全删除且会影响新 Team IR v2 的额外生产旧模块。独立 standalone OGS System/CLI 格式不属于 Team authoring 迁移范围 |
| 当前全仓与 Team Site 回归 | 通过（非真实 Docker UAT） | 最终 `pnpm test` 含 build：920 个顶层测试、938 个含子测试项，937 通过、0 失败、1 个 Windows 专项跳过，退出码 0。`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec`：350 项，349 通过、0 失败、1 个 opt-in Docker 项跳过，退出码 0。Studio 浏览器切片 1/1；Runtime/Artifact 定向集 73/73；Maker-Checker/Review 9/9；Conditional Signoff/Join 15/15；legacy/catalog/API 15/15；`git diff --check` 通过。首次全仓回归 936 通过、1 失败、1 跳过（初次输出未保留失败标题）；完整复跑没有失败，具体失败原因未能确定，保留为未复现环境/竞态风险 | opt-in Docker 跳过不代表模型 Binding 或真实 Project Task 通过；全量确定性回归不关闭剩余发布门 |
| 真实 Sandbox 模型 UAT 前置条件 | 受阻，未运行 | 本机已有 OpenCode serve env 文件且 resolver 源码/启动路径见 `docs/development/team-ir-v2-docker-binding-setup.md`，但本轮进程未设置 `OGS_TEAM_IR_V2_RESOLVER_MODULE`。`http://127.0.0.1:4096/global/health` 返回 401，符合未认证行为；`timeout 6 docker ps` 退出 124，Docker Desktop backend 进程存在但 Engine 不响应。没有执行 opt-in 容器请求或新的真实 Task | Docker Engine 恢复响应后设置文档列明的绝对 resolver/密码文件路径，跑真实 Sandbox Binding；逐一完成经典 Team 的 Project Task 成功及受控失败/重试/重启查询和人工检查。此前真实场景记录只覆盖其中部分，不能外推到 8 个 fixture |
| 真实远端 A2A UAT | 外部阻塞，未运行 | 用户确认暂无兼容远端服务；本地官方 SDK/HTTP 与 Fake A2A 合同测试不代替 HTTPS 远端。 | 解除条件：提供 HTTPS Agent Card、认证配置名或本机凭据路径，以及能处理 Team IR JSON/Artifact 的测试 Agent。继续保留阻塞，不标成通过 |

**阶段结论：** 阶段 0、1 通过；阶段 2 部分通过，Artifact publication recovery 和 Run-scope all-of Join target Review 已进入受限支持；一般 Loop 多 lineage、其它 Review/Join 混合拓扑、prepared 孤儿回收和跨进程活动调用仍未闭合。阶段 3 仍进行中，自由布局端口画布、多端口合同和 Review gate 结构化编辑切片通过，但完整生产发布/审核身份/诊断矩阵、Run input 表单和复杂条件/映射作者体验未闭合。阶段 4 仍进行中，八个 fixture 的 Fake Runtime 追溯通过，真实 Sandbox 全矩阵和远端 A2A 仍未完成。`team-ir-v2-studio-authoring-proposal.md` 继续等待本台账所有必需阶段门清零。

### 2026-10-29：Simulation Run input 表单与 Artifact 失败清理

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 3：Simulation Run input Schema 表单 | 通过（基础标量与 JSON 回退浏览器合同） | `apps/team-site/public/app/views/app.js` 按 `runInput.dataSchema` 为简单 object Schema 生成 string/number/integer/boolean 输入、默认值和长度/数值边界校验；遇到 `$ref`、复杂类型或不支持的 Schema 关键字时保留 JSON 输入。高级合同变更刷新表单时保留已有值和未知字段；Simulation 使用用户输入并在启动前校验必填项。浏览器用例覆盖控件、复杂 Schema 回退、未知字段保留、保存重开和一次成功 Simulation。初次回归在 Simulation 发请求前失败，原因是未声明的 `maxlength` DOM 属性值 `-1` 被当作长度限制；修复为只在属性实际存在时检查。`pnpm --dir apps/team-site exec node --test tests/team-ir-studio-browser.test.mjs`：1/1 | JSON Schema 的复杂组合依旧使用 JSON 编辑；生产 resolver 下完整发布/Project Task 浏览器流程和 Review 身份仍未闭合 |
| 阶段 2：Artifact prepared 输出在可观测失败时清理并收敛 | 通过（当前 Runtime 可处理失败路径） | `src/team-ir/artifact-store.ts` 增加 owner/publication 校验的 `abortOutput`，File backend 删除匹配的 prepared index/blob；`put` 失败清除内存 metadata。Runtime 遇到非法 Artifact、必需 Artifact 缺失、活跃预算超限或 Run 完成 CAS 未提交时清理已返回的 prepared refs；Artifact 合同错误以稳定 code 失败 Run。`tests/team-ir-artifact-store.test.mjs` 覆盖幂等 abort、不能删除已提交输出/Run input，以及 File backend index/blob 中断残留清理；`tests/team-ir-runtime.test.mjs` 验证先准备一个有效槽、后遇无效槽时 Run 以 `ARTIFACT_OUTPUT_INVALID` 失败且无 Artifact 泄漏。`pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-artifact-store.test.mjs`：72/72 | 进程在 Run intent 持久化前崩溃仍可能留下不可见 prepared 文件；没有对已存在孤儿的全局扫描/回收。跨 ArtifactStore/RunStore 仍非原子事务 |
| 本轮完整回归 | 通过（保留一次未复现失败） | `pnpm build && node --test tests/team-ir-runtime.test.mjs tests/team-ir-artifact-store.test.mjs`：72/72；`pnpm --dir apps/team-site exec node --test tests/team-ir-studio-browser.test.mjs`：1/1；`pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec`：350 项，349 通过、0 失败、1 项 opt-in Docker skip；全仓 `pnpm test` 首次 944 项中 942 通过、1 失败、1 Windows-only skip，退出码 1（失败标题未包含在返回片段）；完整日志复跑 944 项中 943 通过、0 失败、1 Windows-only skip，退出码 0。首次全仓失败原因未查明，保留为未复现竞态/环境风险；所有命令均在本机 macOS 执行 | opt-in Docker skip 不代表真实 UAT 通过；真实 Sandbox 和远端 A2A 阻塞仍在 |
| 真实 Sandbox / A2A 前置条件复查 | 受阻 / 未运行 | 本轮 `OGS_TEAM_IR_V2_RESOLVER_MODULE` 未设置；`timeout 6 docker ps` 退出 124；OpenCode serve `http://127.0.0.1:4096/global/health` 无认证返回 401。用户此前确认暂无兼容远端 A2A 测试服务 | Docker daemon 响应后按 setup 文档运行真实 Project Task UAT；远端 A2A 解除条件仍为 HTTPS Agent Card、认证配置名或本机凭据路径、兼容的测试 Agent |

**本轮阶段结论：** Run input 表单基础合同及 Artifact 可观测失败清理切片通过；阶段 2 仍有 Artifact 进程崩溃孤儿回收、活动调用恢复及受限拓扑以外的语义缺口；阶段 3 仍缺生产 resolver/Review 完整用户流程和完整发布浏览器验收；阶段 4 仍缺真实 Sandbox 全经典场景 UAT 与远端 A2A。完整回归已复跑通过，但一次失败未复现。主台账未清零，proposal 暂不进入实施。

### 2026-10-29：Join、Loop、Review 诊断定位

| 验收项 | 状态 | 实现与证据 | 剩余工作 |
| --- | --- | --- | --- |
| 阶段 3：结构化 Join/Loop/Review 字段诊断定位 | 通过（字段级浏览器合同） | `apps/team-site/public/app/views/app.js` 将 `/orchestration/joins/{i}`、`loops`、`reviews` 字段 pointer 映射到相应结构化控件，并将诊断对应的 IR 值同步到控件；number 控件聚焦并保留非法值，文本控件支持选中值。`apps/team-site/tests/team-ir-studio-browser.test.mjs` 覆盖 Join timeout、Review timeout、Loop maxRounds 聚焦及非法值；已有复杂 Schema 转义 pointer 仍定位高级 JSON 精确范围。`pnpm --dir apps/team-site exec node --test tests/team-ir-studio-browser.test.mjs`：1/1；其后 `pnpm --dir apps/team-site test --test-concurrency=1 --test-reporter=spec`：350 项，349 通过、0 失败、1 项 opt-in Docker skip | 仅覆盖指定结构化字段与现有 JSON 回退合同；所有稳定诊断 code/pointer 的可定位全矩阵仍未完成，生产 resolver/Review 身份 UAT 仍未完成 |

**本轮阶段结论：** Studio 诊断导航对已结构化的 Join、Loop、Review 字段已补齐代表合同；不据此标记完整诊断矩阵通过。Artifact 孤儿回收需要预备 reservation 与跨进程写入 fence，当前按并发风险审计不安全的启动扫描不实施。阶段 2–4 与 proposal 门槛仍未清零。

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
