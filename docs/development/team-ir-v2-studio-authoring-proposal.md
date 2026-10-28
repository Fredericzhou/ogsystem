# Team IR v2 Studio 作者体验方案

状态：提案，供阶段 3 设计与实现使用
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
- 保存、重开、预检、模拟和发布同一份 Team IR v2。

## 2. 不可违反的 v2 边界

- 根文档必须是 `schemaVersion: 2`。Studio 不维护与 Team IR 并行的私有语义模型；任何界面状态若不属于 IR 语义，必须放在明确分离的 presentation 或本地编辑状态中。
- 每条 Handoff 都是显式、有类型的端口关系。不得生成无类型连线、隐式数据透传、隐式 task 覆盖或隐式 Join。
- 路由只通过 v2 的 `orchestration.routes`、`when.condition`、`when.priority`、路由模式和 `onNoMatch` 表达。Studio 的快捷操作必须生成这些字段，不得引入新的控制流字段。
- Join 只能是 `all_of` 或 `quorum_of`，必须精确列出 `handoffIds`，并遵循端口字段并集、required/optional、零到达失败和 Loop Scope 规则。
- Loop、`$.loop.previous`、Review、Artifact、Run Result、Binding、deadline、重试和 digest 使用设计方案中的字段与规则，不在 UI 层另行定义行为。
- 复杂 Schema、条件 AST 和 v2 暂不支持的拓扑，不能被表单简化成语义不明的选项。使用高级 IR 编辑和同一套服务端诊断；无法支持的运行拓扑须在编译或发布前明确拒绝。
- Studio 预检、Simulation、发布与服务端必须使用同版本的 Schema、校验器和 Compiler。浏览器推导只用于编辑反馈，不能替代服务端校验。

## 3. 信息架构

主工作区由三个相互联动的区域组成：

1. **结构视图**：以 Run、Agent、Result 节点和显式 Handoff 展示当前拓扑。节点与边的显示来自 Team IR；选择它们进入属性编辑。布局只属于 presentation，不影响语义 digest。
2. **配置面板**：按所选 Team、Agent、端口、Handoff、Join、Loop、Review 或 Binding 展示与该 IR 对象对应的表单。
3. **诊断面板**：显示 Schema/Compiler/发布返回的稳定 code、JSON Pointer、相关对象和修复入口。诊断项可定位到结构视图和具体控件；无法映射到控件时定位到高级 IR 中对应 JSON Pointer。

提供两种编辑视图：

- **引导配置**：默认入口，以场景模板、表单、端口选择器和显式连线操作覆盖普通用户常见需求。不隐藏关键语义；高级规则显示简洁说明和来源状态。
- **高级 IR**：展示和编辑完整 Team IR v2 JSON，包括引导表单未覆盖的 Schema 关键字与全部已支持字段。解析失败时保留原文，不覆盖草稿；成功解析后调用相同校验器。

视图切换不转换成不同格式。表单修改立即更新规范化 IR 草稿；高级编辑保存成功后刷新结构视图与表单。存在未保存改动时切换、重载或关闭应提示，不能静默丢弃。

## 4. 普通用户的配置流程

### 4.1 创建 Team

提供“从模板开始”和“从空白 Team 开始”。模板是有效、可编辑的 Team IR v2 文档，不是独立运行模型。用户可以先选场景，例如顺序委派、并行专家汇总、条件会签、审核返工；模板中的角色、Schema、条件和 Binding 必须显式可见且可修改。

引导流程依次配置：

1. Team ID 和业务版本。
2. Run 输入字段、偏好与附件槽位。
3. Agent 及其角色包、Binding、输入端口和输出事件。
4. Handoff 与字段/Artifact 映射。
5. 路由和可选的 Join、Loop、Review。
6. Run Result 与 `executionPolicy`。
7. Schema/Compiler 预检、Simulation、发布。

用户可以从任意步骤进入对应对象编辑。缺少前置合同的对象保持草稿并展示待完成项；不创建无效的隐式默认值。

### 4.2 添加 Agent 和端口

- Agent 必须选择 v2 可解析的 `packageRef` 和 `bindingRef`。展示引用摘要和版本，不把角色包提示词、模型选择或凭据写进不属于 IR 的字段。
- 端口 ID、输出事件 ID 和 Schema 字段名均是 IR 语义标识。Studio 可默认建议 ID，但保存前展示并允许用户确认；重命名需明确更新所有相关 Handoff 和引用，否则校验失败。
- JSON Schema 表单覆盖常见的 `type`、`properties`、`required`、`items` 等内容，并支持完整高级编辑。未支持的组合通过诊断和 Runtime 校验提示表达，不猜测 Schema 蕴含关系。

### 4.3 创建 Handoff 与映射

连线操作需明确选择来源 Agent/输出端口和目标 Agent/输入端口，或 Run/Result 运行边界。选定后生成显式 `from`、`to` 与 `map` 草稿。

- 字段映射建议仅在源路径存在、类型方向兼容且必填性质允许时展示。自动建议不是语义，须由用户接受后写入 `map.data` 或 `map.artifacts`。
- 每个映射显示目标字段、来源表达式、必需状态和静态兼容状态。缺失必填字段、重复 Join 提供方、可选来源到必需目标等情况要在对象旁给出诊断。
- 引用表达式通过路径选择器生成 v2 ValueExpr，例如 `$.run.input.*`、`$.output.data.*`、`$.review.feedback.*` 和合法的 `$.loop.previous.*`。UI 不提供任意脚本、函数或 v2 不支持的 selector。
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

## 6. 路由、Join、Loop 和 Review 的渐进配置

- **路由**：初级表单展示来源端点、候选 Handoff、`exclusive_priority` 或 `parallel_fanout`、条件优先级及 `onNoMatch`。只允许在单个无条件 Handoff 等符合规范的场景省略 route；不提供“自动分支”等额外模式。
- **Join**：用户先选目标 Agent 输入端口和精确来源 Handoff，再选 `all_of` 或 `quorum_of`。界面展示字段并集预览、来源状态、required 提供方、optional 来源及阈值；`baseMapping` 单独编辑并只提供规范允许的引用根。
- **Loop**：通过成员、边界 Agent、entry/continue/exit Handoff、轮数/激活预算和耗尽策略编辑 v2 Loop 声明。显示 `$.loop.previous` 的 Scope/dominance 诊断，不自动推断旧结果回退。
- **Review**：在合法 Agent 输出上添加 v2 Review gate，编辑 feedback Schema 和 timeout；展示批准、拒绝、返工端口和 Loop 约束。审核身份与授权仍由控制面提供，不由 Team IR 表单伪造。
- **端点选择**：来源、目标和端口必须显式选择。多端口 Agent 不得静默取第一个端口；若对象缺少端口，先提示用户补全合同。

引导配置可隐藏原始 JSON 细节，但必须显示编译器拒绝的真实原因；它不得通过自动补 `null`、放宽 `required`、删除边或改 route 来“修复”合同。

## 7. 保存、预检、Simulation 与发布

1. 每次编辑更新单一 Team IR v2 草稿，并保留可撤销的编辑变更。
2. 本地预检调用与服务端相同版本的 Schema/Compiler；结果包含诊断 code、JSON Pointer、Team semantic digest 和编译计划 digest。
3. 保存时服务端重新解析和校验 IR；浏览器状态不是信任边界。
4. Simulation 运行明确版本的编译计划，并将证据绑定到 semantic digest 和 `compiledPlanDigest`；Fake resolver/Binding 证据清晰标注为测试或预览，不能冒充生产 Sandbox 发布证据。
5. 发布只接受校验通过、依赖闭包可信且所需 release evidence 满足策略的版本。发布失败保留可编辑草稿，不覆盖无关旧数据。
6. 重开时由保存的 IR 重建结构视图与表单；presentation 状态与语义 IR 分离，semantic digest 应稳定。

Schema、Compiler 或 Runtime 不支持的组合在 Simulation/发布前失败关闭。用户不应通过 Studio 控件生成一个运行时必然拒绝的拓扑。

## 8. 为未来 AI 配置预留的合同

AI 是作者辅助，不是第二个 Team 模型。AI 输入可以是自然语言、现有 v2 Team 草稿和用户选择的模板；AI 输出必须是：

- 一份 Team IR v2 草稿或针对现有草稿的结构化变更集。
- 每项生成/修改的 JSON Pointer、生成理由和待用户确认项。
- 对缺失信息的澄清问题；不得把模型猜测伪装成用户决策。

推荐交互：

1. 用户描述目标或要求修改，例如增加法务条件审查。
2. AI 提取 Agent、端口、Handoff、条件、Join、结果和待确认值，展示结构预览。
3. 用户审阅差异，逐项接受或拒绝；未接受的变更不写入正式草稿。
4. 接受后的草稿经 v2 Schema、静态校验和 Compiler 检查；诊断返回 AI 或用户修正，但修正仍以 diff 展示。
5. 用户手动发起 Simulation 和发布；AI 不可直接发布、挂载或运行 Team。

AI 只能选择 v2 已支持的原语和字段。对任意动态组队、隐式共享状态、`all_active`、自由脚本、未定义错误路由或不支持的拓扑请求，应明确说明无法按当前 v2 合同生成，而不是把需求近似映射成不同语义。

提示词、模型供应商、生成温度等 AI 产品配置不写入 Team IR，除非未来经独立设计批准成为有版本的语义字段。AI 生成结果仍须遵循 `$.run.task` 可见性、显式数据映射和 Artifact 白名单边界；UI 不得暗示 AI 能提供保密或匿名保证。

## 9. 实施顺序

### 阶段 A：稳定 IR 表单编辑

- Team、Run Input/Result、Agent、Binding、端口、Handoff 和基础映射表单。
- 基础结构视图、显式 Source→Target 创建、端口选择和接受式映射建议。
- 必需字段、Artifact 槽位、类型兼容与精确诊断定位。
- 表单/高级 JSON 同步，保存重开和语义 digest 稳定。

### 阶段 B：完整 v2 作者体验

- Route、Join、Loop、Review 的结构化编辑。
- Join 来源状态和字段并集预览、Loop Scope/dominance 诊断、Review feedback/timeout 编辑。
- 窄屏、键盘可达性、撤销/重做、未保存提示和错误恢复。
- 以真实浏览器和服务端 API 验收普通用户完整创建、修改、保存、重开、Simulation、发布前预检流程。

### 阶段 C：AI 草稿生成

- 在完整 v2 编辑能力稳定后增加自然语言生成与变更建议。
- 输出限制为 v2 IR/变更集；显示差异、理由和缺失决策；用户接受后再合并。
- 用代表性需求集合验收 schema 有效率、Compiler 通过率、拒绝越界需求、diff 可审阅性和非接受变更不落盘。

每一阶段都可独立发布为作者体验增量；阶段 C 不应成为阶段 A/B 的前置依赖，也不改变阶段 4 默认入口切换门槛。

## 10. 验收标准

- **唯一语义源**：所有保存结果均是合法 Team IR v2；表单和高级编辑往返后语义等价，服务端与 Studio digest 一致。
- **普通用户可完成**：无需手写 JSON/selector，即可从模板或空白创建 Team、添加 Agent、声明必需/可选输入、连线、映射字段、配置基础路由、保存重开并完成预检。
- **必需性准确**：缺失与 `null` 区分；Data、Artifact、Join contribution、Result mode 的必需语义分别按 v2 合同写入；可选来源无法满足必需 Join 项时，在激活 Agent 前给出 Compiler 诊断。
- **不引入新语义**：UI 交互生成的 IR 只使用公开 v2 Schema；不存在隐式边、隐式映射、隐藏默认值或私有运行状态。
- **可修复诊断**：每个受支持的 Schema/Compiler 诊断能定位到对象和控件，或者定位到高级 IR 的 JSON Pointer；保存和发布失败不丢草稿。
- **浏览器流程**：覆盖端口选择、表单/JSON 双向编辑、保存重开、诊断定位、窄屏和服务端拒绝；发布/Simulation 证据按 resolver 信任等级准确标识。
- **AI 预留/后续验收**：AI 仅产生 v2 草稿/diff；未接受的 diff 不写入；Schema/Compiler 拒绝越界结果；AI 不能发布或运行。

## 11. 与现有规范的关系

Team IR 字段和运行语义以[Team IR v2 Handoff 设计方案](team-ir-handoff-v2-design.md)为准；静态拓扑、显式数据映射、Join 和 Loop 边界以[协作边界 ADR](adr-team-ir-collaboration-boundaries.md)为准；阶段进展和实际证据以[落地与验证台账](team-ir-v2-implementation-and-verification.md)为准。

本提案只规定 Studio 如何呈现和编辑既有 v2 合同，不批准任何 IR Schema 扩展、Runtime 新语义、兼容迁移或产品默认入口切换。若实现中发现现有 v2 合同无法支撑所需交互，先更新设计/ADR 并完成评审，再修改 Studio。
