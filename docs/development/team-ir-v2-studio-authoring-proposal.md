# Team IR v2 Studio 作者体验方案

状态：原版图谱外壳与 v2 适配层已接入，当前工作树确定性回归通过；A1 人工体验门仍待完成。实现与机器验收状态以实施台账为准
范围：严格基于已冻结的 Team IR v2 Schema、Compiler、Runtime 与发布合同，设计面向普通用户的配置体验，并为未来 AI 草稿生成预留入口。

## 1. 目标

Studio 应让普通用户通过引导式配置完成常见 Team，同时让高级用户编辑 Team IR v2 的完整合同。两种方式读写同一份 Team IR v2 草稿；Schema、静态校验器、Compiler 和 Runtime 仍是配置语义的唯一权威来源。

未来可增加 AI 辅助，把自然语言需求转换为可审阅的 Team IR v2 草稿。AI 不拥有新的流程语义，不可绕过校验、发布或执行边界。

### 目标用户任务

- 创建 Team，声明调用输入、最终结果及执行预算。
- 添加 Agent，选择已发布角色包和 Binding，配置输入/输出端口合同。
- 创建显式 Handoff，选择双方端口，配置数据和 Artifact 映射。
- 配置路由、条件、Join、Loop 和人工审核，并理解必需来源及可跳过来源的约束。
- 查看并修复精确的 Schema、Compiler 和发布诊断。
- 保存、重开和预检同一份 Team IR v2 草稿；只有无阻断诊断且依赖闭包满足策略的版本才可 Simulation/发布。

## 2. 不可违反的 v2 边界

- 根文档必须是 `schemaVersion: 2`。Studio 不维护与 Team IR 并行的私有语义模型；任何界面状态若不属于 IR 语义，必须放在明确分离的 presentation 或本地编辑状态中。
- 每条 Handoff 都是显式、有类型的端口关系。不得生成无类型连线、隐式数据透传、隐式 task 覆盖或隐式 Join。
- 路由只通过 v2 的 `orchestration.routes`、`when.condition`、`when.priority`、路由模式和 `onNoMatch` 表达。Studio 的快捷操作必须生成这些字段，不得引入新的控制流字段。
- Join 只能是 `all_of` 或 `quorum_of`，必须精确列出 `handoffIds`，并遵循端口字段并集、required/optional、零到达失败和 Loop Scope 规则。
- Loop、`$.loop.previous`、Review、Artifact、Run Result、Binding、deadline、重试和 digest 使用设计方案中的字段与规则，不在 UI 层另行定义行为。
- 复杂 Schema、条件 AST 和 v2 暂不支持的拓扑，不能被表单简化成语义不明的选项。使用高级 IR 编辑和同一套服务端诊断；无法支持的运行拓扑须在编译或发布前明确拒绝。
- Studio 预检、Simulation、发布与服务端必须使用同版本的 Schema、校验器和 Compiler。浏览器推导只用于编辑反馈，不能替代服务端校验。

## 3. 面向人的三层作者体验

普通用户先表达协作意图，再检查参与者和交接关系；不要求先理解 IR 的端口、ValueExpr 或 JSON Pointer。界面分成三层，三层都只编辑同一份 Team IR v2 草稿：

1. **场景与意图**：从经过校验的 v2 场景模板开始，或用自然语言描述目标并取得 AI 草稿建议。此层面向“谁来做、何时交接、谁复核、怎样结案”等人类协作概念。
2. **协作视图与检查器**：沿用原版图谱工作台、节点、边、工具栏和属性抽屉。用户可拖放节点调整本机布局；选择 Agent 或 Handoff 后在右侧检查器编辑同一份 Team IR v2 草稿。日常控件使用角色、工作、必需材料、条件交接、审批和结案等语言；需要时展开对应 IR 字段。移动端抽屉内提供保存动作，避免工具栏被抽屉覆盖。
3. **Team IR 合同**：高级用户查看/编辑完整 v2 JSON、Schema、ValueExpr 和编译诊断。它是同一草稿的精确视图，不是另一种配置源。

模板、画布、检查器、AI 建议和高级编辑都生成或修改根 `schemaVersion: 2` 文档。局部交互状态和布局信息不得成为新的运行语义；坐标只进入 `presentation` 或本地 UI 状态，不影响语义 digest。

主工作区同时提供：

- 清单与画布共享的节点/边状态标记和结构定位；画布是关系总览与快捷操作，不是唯一编辑入口。
- 右侧检查器，按当前选中的 IR 对象展示适用字段、可选项、来源/目标和所需合同。
- 任务清单/诊断侧栏，使用面向用户的说明、下一步动作和修复预览；稳定诊断 code 与 JSON Pointer 可展开查看，并可跳转到控件或高级 JSON。

表单和高级 IR 编辑始终同步到单一草稿。高级 JSON 无法解析时保留原文和上一个有效结构视图，不覆盖草稿。A1b 的最小撤销针对单一草稿编辑事务；完整撤销/重做、未保存修改提示和异常恢复在阶段 B 提供。

提供从当前 IR 确定性生成的只读协作摘要，例如“当 researcher 的 status 为 ready 时，将 findings 交给 writer”。摘要由已声明的 Agent、Handoff、条件和映射按固定模板拼接，不调用 LLM；不支持白话化的条件必须显示为可展开的条件说明，不得省略。模板、快捷操作与 AI diff 预览也使用同一摘要帮助用户核对变更。

| 面向用户的用语 | 对应对象 | 用语边界 |
| --- | --- | --- |
| 参与岗位 / 执行角色 | Agent | 表示一个可执行的责任参与方，不代表具体员工或组织职位 |
| 角色说明 / 可复用职责包 | Role Package / `packageRef` | 描述职责和输出合同；不自动提供身份或权限 |
| 执行方式 | Binding / `bindingRef` | 指向已配置的执行绑定；凭据和授权由外部控制面管理 |
| 工作输入 / 工作成果 | Input Port / Output Port | 对应有 Schema 的端口合同 |
| 交接 | Handoff | 显式连接来源、目标与数据/Artifact 映射 |
| 汇总 | Join | 按显式 `all_of` 或 `quorum_of` 规则聚合贡献，不代表共识 |
| 人工复核 | Review | Runtime 控制面审核门，不在 IR 中指定具体审核人 |
| 最终交付 | Run Result | 满足 `runResult` 合同的对外结果 |

## 4. 普通用户的协作流程

### 4.1 创建 Team

先选一个与真实分工接近的场景，例如软件交付、专家会签、阶段放行、审核返工或远程补件；模板必须是可编辑的原生 Team IR v2。用户也可直接描述“谁负责什么、需要哪些材料、哪些交接按条件发生、由谁汇总或批准、怎样判定完成”。自然语言是需求输入，不是运行时 task 的自动替代品。

作者流程以协作概念组织配置。界面优先呈现“谁负责交付什么、什么条件下发生交接、谁负责汇总或复核”，再把这些选择落到 v2 合同。岗位清单是可操作的主路径，画布提供全局关系视图；两者都可完成同一配置：

1. 选定或描述目标与完成条件。
2. 添加岗位/Agent，选择可用角色包和 Binding；角色名称与职责先显示，IR 的 `packageRef`、`bindingRef` 可在检查器查看。
3. 选择或拖动岗位输出到接收岗位或 Result，明确选择来源和目标端口；多端口时要求选择具体端口，绝不静默选择第一个。
4. 配置交接材料。Schema 已知时显示源字段树和目标合同字段。用户建立连线本身就是应用唯一、同名且类型兼容映射建议的明确动作；建议直接写入 IR，并标记“自动建议”，提供撤销。存在多个候选、必需性不兼容或静态类型未证明时不写入，改为显示待选项/诊断。
5. 用“满足条件时发生这条交接”“等待必需贡献并汇总已到达的可选材料”“收到至少 N 份贡献后启动汇总”“进入人工复核并允许返工”等任务语言创建路由、Join 或 Review 草稿；检查器展开这些操作生成的完整 v2 字段与边。
6. 补齐 Run 输入和最终结果。测试输入由 `runInput` Schema 生成表单，不要求用户手写 JSON；复杂/未支持的 Schema 保留高级合同入口。
7. 查看待办和诊断，完成 Simulation、预检和发布。

空白 Team 也遵循相同协作流程。未完成合同可以留在草稿中，但不能靠不可见默认值伪装为有效配置。模板不得隐去角色、条件、映射、必需性或 Binding 来源。

### 4.2 添加 Agent 和端口

- Agent 必须从当前可用目录选择 v2 可解析的角色包和 Binding；目录项写入对应的 `packageRef`、`bindingRef`。没有可信目录项时保持未配置并阻止发布，不得写死某个模型或凭空生成可解析引用。展示引用摘要和版本，不把角色包提示词或凭据写入 IR。
- 端口 ID、输出事件 ID 和 Schema 字段名是 IR 语义标识。创建时可按稳定规则生成易读建议并立即显示；重命名必须同步更新相关 Handoff、route、Join、Loop 和引用。删除被引用对象时先列出影响范围，确认后原子清理已知引用，取消则保持草稿不变；无法证明安全更新时拒绝操作。
- JSON Schema 表单覆盖常见的 `type`、`properties`、`required`、`items` 等内容，并支持完整高级编辑。未支持的组合通过诊断和 Runtime 校验提示表达，不猜测 Schema 蕴含关系。

### 4.3 创建 Handoff 与映射

连线操作需明确选择来源 Agent/输出端口和目标 Agent/输入端口，或 Run/Result 运行边界。选定后生成显式 `from`、`to` 与 `map` 草稿。

- 字段映射通过源路径树到目标字段的点选器生成 v2 ValueExpr；普通用户不手写 `$.output.data.*`。建立连线是应用唯一、同名且类型兼容字段建议的明确用户动作；映射直接写入显式 `$ref`，标记“自动建议”并提供撤销，不弹确认模态框。存在歧义或兼容性未证明时不自动应用，要求用户选择或查看诊断。不得隐藏已生效的映射。
- 每个映射显示目标字段、来源业务名称、必需状态和兼容状态。缺失必填字段、重复 Join 提供方、可选来源到必需目标等情况要在对应节点/边旁显示白话待办，同时保留稳定诊断和 pointer。
- 条件编辑器使用 v2 封闭条件 AST 的可视构造器，覆盖且只覆盖 `equals`、`notEquals`、`and`、`or`、`not`、`exists`。通过字段选择器和类型匹配的值控件选择字段、运算与值；复杂组合仍可在高级 IR 编辑器中编辑。不得只保留“字段等于值”的有损简化，也不得通过取路径末段丢失引用作用域。
- Artifact 使用独立槽位编辑器，分别展示 producer `mediaTypes`、consumer `acceptedMediaTypes`、`required` 和 `cardinality`。Artifact 引用仍为不透明 ID；不得把存储 URI 或访问凭据暴露为 Team IR 配置。
- 目标为 Result 时，Studio 检查该条结果 Handoff 是否独立满足完整 `runResult` 合同；不提供跨边隐式拼装。

## 5. 必需与可选项的准确表达

界面不提供一个作用于整条边或整个 Team 的通用“可选”开关。必需性属于具体合同位置，控件应显示其 IR 来源和运行影响。

| 配置位置 | UI 表达 | 严格映射到 v2 的规则 |
| --- | --- | --- |
| Object 字段 | “必需”复选框 | 在对应 JSON Schema `required` 数组中添加/移除字段；`null` 是否允许由该字段 Schema 单独决定 |
| Agent 输入 Artifact 槽位 | “必须提供”复选框及接受媒体类型 | 输入端 `artifactSlots` 的 `required`、`acceptedMediaTypes`、`cardinality` |
| Agent 输出 Artifact 槽位 | “必须产出”复选框及可能媒体类型 | 输出端 `artifactSlots` 的 `required`、`mediaTypes`、`cardinality` |
| 条件 Handoff | 条件编辑器和“可能跳过”说明 | 使用该 Handoff 的 `when.condition` 和所属 route；不自动禁用 Agent 的其它边 |
| Join 来源 | 来源列表标示保证到达/可能跳过 | `handoffIds` 精确集合；可能跳过来源只能贡献 optional 项；required 项由保证来源或 `baseMapping` 覆盖 |
| Join 模式 | `all_of` / `quorum_of` 分段选择 | 映射到 `mode` 和 `threshold`；quorum 依据显式阈值触发，非保证到达来源只能贡献 optional 项 |
| Run Result | “要求一次结果”/“允许空结果”选择 | 映射到 `executionPolicy.resultMode`；不是 Result 字段的 required 切换 |
| Run Result 字段/Artifact | 各自合同控件 | 映射到 `runResult.dataSchema` 和 `runResult.artifactSlots`；每条结果边独立完整满足合同 |

控件要区分“字段缺失”和“值为 `null`”。把字段设为可选只允许该字段缺失，不隐含允许 `null`；条件 Handoff 可跳过也不等于 Join 可接受缺少 required 贡献。Studio 应显示诸如“此来源可能跳过，因此只能提供可选字段”的具体解释，并由同一 Compiler 决定是否阻断。

## 6. 将社会协作概念映射到 v2 原语

真实的人类协作通常以角色、责任、材料、交接、会签、复核和结案来思考。Studio 可把这些熟悉概念做成创建向导和语义快捷操作，但每个操作必须可追溯到本节列出的普通 v2 对象；展开后用户可以检查、修改或撤销。

| 人类协作意图 | Studio 的直观操作 | 写入的 v2 原语与必须显示的边界 |
| --- | --- | --- |
| 委派一项工作 | 从负责者连到接收岗位，选择交接材料 | 显式 Handoff、端口及 `map`；不隐式透传 task 或其它字段 |
| 多专业并行 | 选择多个预先声明的岗位并行处理 | 静态 `parallel_fanout` Route 和显式 Handoffs；不动态组队，不承诺物理并发 |
| 按条件征询岗位 | 为一条交接设置条件，并说明条件不满足时该交接不会发生 | 条件 Handoff + Route；它不等于整名 Agent 缺席，也不会自动关闭该 Agent 的其它边 |
| 等待必需贡献并汇总 | 选定 Join 目标和精确贡献来源，分别标明必需与可选材料 | `all_of` Join；required 贡献必须保证到达，optional 条件贡献可跳过，零到达失败；不表示意见一致 |
| 收到至少 N 份贡献后启动汇总 | 输入阈值 N 并选择目标 | `quorum_of` + 明确 threshold；表示贡献数达到阈值后触发一次目标，不代表投票多数、共识或决策通过。不会取消其它分支或屏蔽活动分支故障，Run 仍等待活动工作收敛 |
| 人工批准或拒绝 | 在 Agent 交付后设置复核点、决定和返工去向 | v2 Review gate、显式 approve/reject 条件、反馈 Schema 和 Handoff；实际审核者身份/授权由控制面决定，IR 不指定人，也不提供多人共识。拒绝返工依赖合法 Loop/端口 |
| 允许有限返工 | 选择返工输入和最大轮次 | 显式 revise 输入、Loop entry/continue/exit 和预算；展示展开后的边和预算。只对编译器支持的拓扑启用快捷操作 |
| 形成对外结论 | 选择归口岗位和结果字段 | 每条 Result Handoff 独立满足完整 `runResult`；多方材料先由显式汇总责任方整理，不跨 Result 边拼装 |
| 远程协作待补件 | 选择已有 A2A Binding 和输入合同 | A2A Handoff 与 `paused_input_required` 边界；不暗示原远端任务可以补丁续接 |
| 协商、投票或集体决策 | 不提供会被误认为共识机制的快捷配置；由领域应用明确设计决策规则 | 固定参与者的已知步骤可用显式 Route/Loop 编排；v2 不定义投票资格、分母、弃权、平票、协商策略或共识保证 |
| 指派具体员工并追踪其责任 | 在外部身份/任务系统关联岗位、用户和工作记录 | Team IR 的 Agent/角色包表达执行职责和数据合同，不代表具体自然人、组织职位、劳动关系或责任追究 |

这些“语义快捷操作”只是对 IR 的多步编辑事务，不是新语法或运行时 macro。应用前预览将新增/修改的 Agent、端口、Handoff、Route、Join、Loop、Review、Schema 和预算；用户确认后写入单一草稿，之后可检查变更。宏产物必须符合 v2 JSON Schema，并使用当前 Schema/Compiler 可识别的原语和拓扑；缺映射、缺必需字段等语义诊断可作为可见待办留在草稿中，不能被隐藏默认值掩盖。快捷操作可以提供明确标注的建议合同，例如 Review feedback 的 `{ "comments": "string" }`；它必须作为可见、可编辑的 IR 内容随草稿保存，不得伪装成用户已确认的业务决定。Studio 不应把超出 v2 的组织能力伪装成可配置项；身份授权、工作分派队列、升级流程、多人投票与争议申诉由相应控制面或领域应用负责。

必需/可选必须落在其 v2 合同位置：Schema `required`、Artifact slot `required`、条件来源的到达保证、Join mode/threshold、Result `resultMode`。界面使用“必须提供/可以缺少”等业务文案，并说明编译器为何限制选择；不能通过自动补 `null`、放宽 required、删边或改路由来修复。

## 7. 保存、预检、Simulation 与发布

1. 每次编辑更新单一 Team IR v2 草稿。A1b 提供草稿级最小撤销，至少能撤销刚应用的自动映射建议；更广泛的跨对象 undo/redo、历史浏览和异常恢复属于阶段 B。
2. 本地预检调用与服务端相同版本的 Schema/Compiler；结果包含诊断 code、JSON Pointer、Team semantic digest 和编译计划 digest，并区分“可保存草稿”与“可 Simulation/发布”。
3. 保存 API 分两级校验：可解析且符合 v2 JSON Schema、IR 内部引用及 Schema `$ref` 可解析的文档可保存为草稿，并在保存响应和重开/校验响应中提供可重算的语义诊断；诊断是 IR 的派生结果，不写入 IR，也不纳入 digest。缺映射、缺必需贡献等可修复的阻断诊断不阻止草稿持久化。不能解析、Schema 无效或内部/Schema 引用无法解析的文档拒绝保存。外部 package/Binding 目录或 resolver 尚不能确认的依赖作为显式诊断保留在草稿，但必须阻止 Simulation/发布。浏览器状态不是信任边界。
4. `expectedSemanticDigest` 始终与当前已保存草稿比较，作为并发编辑的 compare-and-set 条件；检查在写入前原子完成。带诊断草稿保存成功后返回该草稿新的 semantic digest，下一次保存必须携带这个新值。诊断是否阻断发布不改变 digest 冲突语义；冲突时不覆盖新版本。

保存状态的真值表：

| 情况 | `ok` | `draftSaveable` | `releaseReady` | `saved` |
| --- | --- | --- | --- | --- |
| 结构错误（Schema、内部引用、无法解析的 ValueExpr） | false | false | false | false |
| 结构有效但有语义诊断（缺映射、缺必需贡献、不支持拓扑） | false | true | false | true |
| 无 IR 诊断但依赖闭包未解析 | true | true | false | true |
| 无 IR 诊断且依赖闭包完整 | true | true | true | true |

`ok` 只表示没有 IR error 诊断；`releaseReady` 还要求可信依赖闭包和发布证据。读取、Simulation、发布、挂载和 Task 必须重新执行服务端校验，不能把 `draftSaveable` 当作可运行。
5. Simulation 和发布要求完整静态校验/Compiler 无阻断诊断。Simulation 运行明确版本的编译计划，并将证据绑定到 semantic digest 和 `compiledPlanDigest`；Fake resolver/Binding 证据清晰标注为测试或预览，不能冒充生产 Sandbox 发布证据。
6. 发布只接受校验通过、依赖闭包可信且所需 release evidence 满足策略的版本。发布失败保留可编辑草稿，不覆盖无关旧数据。
7. 重开时由保存的 IR 重建结构视图与表单；presentation 状态与语义 IR 分离，semantic digest 应稳定。

Schema、Compiler 或 Runtime 不支持的组合在 Simulation/发布前失败关闭。用户不应通过 Studio 控件生成一个运行时必然拒绝的拓扑。

## 8. AI 作为自然入口，但不另造 Team 模型

AI 是作者辅助，不是第二个 Team 模型。AI 输入可以是自然语言、现有 v2 Team 草稿和用户选择的模板；AI 输出必须是：

- 一份 Team IR v2 草稿或针对现有草稿的结构化变更集。
- 每项生成/修改的 JSON Pointer、生成理由和待用户确认项。
- 对缺失信息的澄清问题；不得把模型猜测伪装成用户决策。

用户可以先用一句话描述要完成的协作，也可以从模板或协作视图开始。AI 草稿是独立、可并行的作者辅助轨道，不要求等待完整画布，但其生产接入受部署位置、数据边界和成本决策约束；不得把未完备的生成器作为默认产品入口或发布通道。

推荐交互：

1. 用户描述目标或要求修改，例如增加法务条件审查。
2. AI 提取 Agent、端口、Handoff、条件、Join、结果和待确认值，展示结构预览。
3. 用户审阅差异，逐项接受或拒绝；未接受的变更不写入正式草稿。
4. AI 输出先经 v2 Schema 校验；接受后的草稿再经静态校验和 Compiler 检查。缺少映射等可修复诊断可以留在草稿并显示待办；不支持的原语/拓扑不得以近似语义写入。诊断返回 AI 或用户修正，但修正仍以 diff 展示。
5. 用户手动发起 Simulation 和发布；AI 不可直接发布、挂载或运行 Team。

AI 只能选择 v2 已支持的原语和字段。对任意动态组队、隐式共享状态、`all_active`、自由脚本、未定义错误路由或不支持的拓扑请求，应明确说明无法按当前 v2 合同生成，而不是把需求近似映射成不同语义。社会角色描述不能推断为身份认证、法定授权或匿名保证；需用户选择/确认角色包、Binding、必需性、条件和结果责任人。

提示词、模型供应商、生成温度等 AI 产品配置不写入 Team IR，除非未来经独立设计批准成为有版本的语义字段。AI 生成结果仍须遵循 `$.run.task` 可见性、显式数据映射和 Artifact 白名单边界；UI 不得暗示 AI 能提供保密或匿名保证。

## 9. 当前页面差距与实施顺序

当前 `/ir` 页面已经有多端口呈现、条件 AST、递归 ValueExpr、端点选择、诊断定位、Artifact Simulation 和 Advanced JSON round-trip 的确定性切片，但仍不是完整的普通用户作者工作台。实现分为 A1a 前置能力和 A1b 体验能力；两者都不改变 Team IR v2 语义。

### 阶段 A0：数据正确性闸门

- 表单与高级 IR JSON 双向往返无损；未知/暂不支持字段必须保留，无法安全编辑时明确只读。
- 修复多端口 Agent 的读取、呈现、保存和重开，不得只投影首端口后覆盖其余端口。
- 条件 AST 无损保留；结构化编辑器未覆盖完整表达式时，不得把复杂条件重建为简化条件。
- 新 Agent 不注入固定 `packageRef`、`bindingRef` 或 `modelRef`。没有目录选择时，新 Agent 只存在于编辑器本地，不写入 IR；已经持久化的 Agent 引用仍按服务端诊断和依赖闭包处理。
- 用浏览器回归测试覆盖加载、编辑其它字段、保存、重开后的语义 digest 和关键合同字段稳定性。此闸门使用结构和语义均有效的 fixture；带诊断草稿的持久化合同另由 A1 API 前置任务覆盖。
- 快速 Schema 编辑只能合并用户修改的基础字段，必须保留嵌套属性、枚举、描述、examples、约束和其它未知字段；Artifact 槽位重命名必须保留原槽位的媒体类型、必需性、cardinality 和其它已知元数据。快速编辑新增字段/槽位使用唯一建议名，重复名称不得静默覆盖。
- Join 归属矩阵必须把 `baseMapping.data` 作为 Run input 提供方纳入字段提供者、冲突和到达状态；它是服务端诊断的只读投影，不另行定义 Join 语义。
- Advanced JSON 有效变更后，快速 Schema/Artifact 编辑器必须先刷新自身基线；名称为空、非法或重复时不得写入部分结果，只有整批校验通过才更新原始键和 textarea。

通过 A0 前不开放会重写这些字段的普通用户配置路径，不将当前页面描述为安全的完整作者体验。

### 阶段 A1a：作者前置能力

- 结构有效但有语义诊断的草稿可保存；结构错误拒绝写入；保存响应返回 `ok`、`draftSaveable`、`releaseReady`、`diagnostics` 和 `semanticDigest`。前端把 `/ir/validate` 作为诊断预览，PUT 响应是唯一保存判定；`expectedSemanticDigest` 冲突必须保持拒绝。
- Agent 的 `packageRef`/`bindingRef` 使用受信 resolver 提供的无凭据 Package/Binding 目录选择器；目录不可用时 fail closed，已保存引用仍可显示。未配置的新 Agent 保持编辑器本地，不写入 IR，不生成空引用或伪造引用。
- 多 input/output port、Handoff source/target endpoint、Review output 使用选择器；Schema 和 Artifact 槽位提供简单合同的结构化低门槛编辑，复杂合同保留 Advanced JSON。
- Join 最低归属矩阵展示“目标字段/Artifact slot × 来源 Handoff”，标注 required/optional、保证到达/可能跳过、缺失和重复提供方。矩阵是只读解释，服务端诊断仍是信任边界。
- 删除被引用 Agent/Port/Handoff 时先显示影响范围；确认后原子清理已知 Route、Join、Loop、Review 引用，取消保持草稿不变。

### 阶段 A1b：体验能力

- 提供已校验 v2 场景模板/经典案例入口、互斥分流呈现、输入汇总工作流和 Result 缺失字段提示；这些是现有 IR 原语的结构化编辑和只读解释，不新增 Runtime 语义。
- 提供从 IR 派生的 Agent 输入可见性视图，并明确 `$.run.task` 的固定可见范围；文案不得暗示权限隔离或保密语义。
- 提供草稿级单步/事务撤销，撤销后断言 semantic digest 恢复到应用前值；完整历史 undo/redo、未保存提示和异常恢复属于阶段 B。
- 提供完整条件 AST 协作摘要和稳定的中英文 i18n；无法无损转成白话时显示结构化表达式。
- 当前已实现经典模板入口（空白草稿与 8 个已校验案例均创建独立 v2 draft）、编辑页“参考经典团队/创建新版本”入口，以及 Team IR 编辑器核心标题、操作和状态的中英文切换；完整协作摘要、全量 i18n 和 5 人任务验收仍是未完成项。
- 通过第 10 节的 5 人任务验收后，才能把 A1 标为完成。A1a 和 A1b 的状态与证据只在实施台账记录。

### 阶段 B：真实协作画布与完整 v2 编辑

当前图谱工作台已恢复原版布局、工具栏、画布和属性抽屉，正式 v2 入口为 `/studio/teams/:id/ir`。图谱仅作为 Team IR 的派生视图：节点拖动写入独立的本地布局键，不改变语义 digest；Agent/Handoff 语义修改通过 typed IR patch 回到草稿。已接入的图谱操作覆盖选择 Agent/Handoff、可信目录引用、条件/映射 JSON 应用和 CAS 保存。完整 Join/Loop/Review/Artifact/A2A 检查器、复杂拓扑引导、诊断全矩阵和完整 i18n 仍按本阶段任务继续验收。

- 评估现有图形能力并提供可编辑关系画布；端点、端口、条件、Join 来源和 Result 责任同时可从清单/检查器结构化配置，拖放不是唯一操作方式。
- 提供 v2 封闭 AST 条件构造器、Join 字段并集与可跳过来源说明、Loop dominance、Review/feedback 编辑、Artifact 槽位编辑。
- Review/返工快捷操作按普通 IR 变更生成、预览、确认；Review 编辑和返工宏在此阶段验收，产物符合 v2 Schema，语义缺项可作为待办保存。
- 扩展到完整草稿历史、跨对象 undo/redo、未保存提示和异常恢复；A1 的最小事务撤销不能代替这些能力。
- 诊断待办可在画布标记并直达控件；底层诊断可展开；不接受无法映射到精确 IR 位置的自动修复。
- 窄屏、键盘可达性、撤销/重做、未保存提示、异常恢复和浏览器完整作者流程。

### 阶段 C：AI 草稿生成完善

- 将 AI 独立为可并行的作者辅助轨道，不作为 A1 或阶段 B 的依赖；支持多轮澄清、现有 Team 修改和场景建议，输出限制为 v2 IR/变更集，显示差异、理由和缺失决策，用户接受后再合并。
- AI 开发前单独决策运行位置/模型提供方、输入 IR 与自然语言是否离开部署边界、日志与保留策略、访问控制、成本上限和失败/不可用体验；在该决策完成前只定义合同和离线评测，不接入生产生成服务。
- 以代表性需求集合验收 Schema 有效率、Compiler 通过率、越界需求拒绝率、diff 可审阅性和非接受变更不落盘；这些标准从 AI 轨道首个用户可见试点开始生效，不留到阶段 C 末尾。

AI 可以独立推进，但不能成为发布或运行通道。任何阶段都不改变阶段 4 的默认入口切换门槛。

## 10. 验收标准

- **唯一语义源**：所有保存结果均是结构有效的 Team IR v2 草稿；带语义阻断诊断的草稿不得 Simulation/发布。表单和高级编辑往返后语义等价，服务端与 Studio digest 一致。
- **普通用户可完成**：按业务概念从场景模板或自然语言草稿进入，不必预先理解端口/selector；可添加角色、声明必需/可选材料、显式连线、映射字段、配置基础路由并保存重开预检。
- **必需性准确**：缺失与 `null` 区分；Data、Artifact、Join contribution、Result mode 的必需语义分别按 v2 合同写入；可选来源无法满足必需 Join 项时，在激活 Agent 前给出 Compiler 诊断。
- **不引入新语义**：UI 交互生成的 IR 只使用公开 v2 Schema；不存在隐式边、隐式映射、隐藏默认值或私有运行状态。
- **可修复诊断**：每个受支持的 Schema/Compiler 诊断能定位到对象和控件，或者定位到高级 IR 的 JSON Pointer；保存和发布失败不丢草稿。
- **草稿保存分层**：缺映射/缺必需贡献但结构及内部引用有效的 IR 可保存并在重开后重现诊断；结构、内部引用或 Schema `$ref` 无效的 IR 不可保存；外部依赖未解析或存在阻断诊断的草稿不能 Simulation/发布。并发编辑仍按最新已保存 IR 的 `expectedSemanticDigest` 冲突保护，派生诊断不参与 digest。
- **浏览器流程**：覆盖端口选择、表单/JSON 双向编辑、保存重开、诊断定位、窄屏和服务端拒绝；发布/Simulation 证据按 resolver 信任等级准确标识。
- **A0 正确性闸门**：多端口、完整条件 AST、未知字段和表单/JSON round-trip 经真实浏览器保存重开后不丢失/不改变；未通过不得进入普通用户开放配置。
- **A1 普通用户任务验收**：至少 5 位未参与实现的非技术用户，每人完成两项任务：一项线性委派流程，一项从已校验模板配置多方汇总（含 Join 来源/必需性）。每项任务至少 4/5 用户在 10 分钟内独立完成并通过 v2 Schema/Compiler 检查。主持人只能重复书面任务说明或处理环境故障；不得解释某个业务条件应选什么、指出具体控件、代替选择角色/映射/必需性或修改配置。任何代填语义选择都计为该项未独立完成。未达门槛时先修订交互并用未参与前轮测试的用户重测；记录完成率、耗时、求助点和错误，不把两项任务平均后合并判定。
- **B 阶段普通用户任务验收**：Review/返工编辑完成后，至少 5 位非技术用户完成“撰写 → 人工复核 → 按意见返工”配置；至少 4/5 在 10 分钟内独立完成并通过 v2 Schema/Compiler 检查，使用与 A1 相同的主持规则和失败处理。该门槛不作为 A1 准入条件。
- **可读语义回读**：用户可从 IR 看到确定性生成的协作摘要；摘要覆盖条件、来源、目标和交付字段。黄金用例断言所有六种条件运算、嵌套 `and`/`or`/`not` 和 `exists` 对缺失与显式 `null` 的区别；不能无损简化时显示结构化条件。摘要不得由 LLM 生成。
- **AI 试点验收**：AI 可早期作为独立轨道提供 v2 草稿/diff；每次输出先通过 v2 Schema 校验，提供 Compiler 诊断；拒绝越界需求；未接受 diff 不写入；AI 不能发布、挂载或运行。生产接入还须先完成部署/数据边界/成本决策。

## 11. 与现有规范的关系

Team IR 字段和运行语义以[Team IR v2 Handoff 设计方案](team-ir-handoff-v2-design.md)为准；静态拓扑、显式数据映射、Join 和 Loop 边界以[协作边界 ADR](adr-team-ir-collaboration-boundaries.md)为准；阶段进展和实际证据以[落地与验证台账](team-ir-v2-implementation-and-verification.md)为准。

本提案只规定 Studio 如何呈现和编辑既有 v2 合同，不批准任何 IR Schema 扩展、Runtime 新语义、兼容迁移或产品默认入口切换。若实现中发现现有 v2 合同无法支撑所需交互，先更新设计/ADR 并完成评审，再修改 Studio。

## 12. 当前落地映射与闭合状态

本节不复制运行证据或维护第二份状态表。当前实现、阶段状态、真实模型矩阵、失败记录、A1a/A1b 未完成项和最终回归均以[Team IR v2 落地与验证台账](team-ir-v2-implementation-and-verification.md)为唯一事实来源。

当前口径：机器发布门已通过；Studio A0 已完成本轮数据正确性回归，A1a 已完成目录/端口/低门槛编辑切片，A1b 已完成模板入口和核心 i18n 切片；A1a/A1b 的完整作者能力与 5 人人工任务验收尚未完成，不能称产品整体完成。外部远端 A2A、生产身份提供方和 5 人人工任务验收按第 10 节及台账范围执行。

设计不引入兼容迁移或旧 Team 读取，standalone OGSystem Mermaid/Project Package 能力仍是独立范围，不属于 Team IR v2 产品入口。
