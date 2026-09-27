# Studio System 可视化配置方案

## 目标

让用户在 Studio 图形界面中配置 System 结构和运行语义，常用场景无需编辑 Mermaid 元数据或记忆 Selector 语法。`system.mmd` 继续作为版本化、可审阅的 System 定义文件，由 Studio 根据结构化配置确定性生成。

设计约束：

- 复用现有 `StudioAuthoringDocument`、解析器、编译器和 Mermaid 序列化器，不新建平行的配置存储或通用表单框架。
- 每项配置只有一个权威编辑入口。图形表单和源码视图读写同一个作者模型。
- 图形保存必须保留所有已支持且可建模的语义；不能静默丢弃源码配置。
- Session 跨轮上下文不在本方案中实现。待 SessionContext 语义和 API 确定后，再作为显式 Context 来源接入。

## 当前能力与缺口

Studio 已支持图上 Role/Flow 的增删改、部分执行绑定配置，并用结构化作者模型生成 Mermaid。当前 Context Map 已在 Role 配置面板提供行编辑，Flow 面板不再编辑目标 Role 的同一映射；但来源仍是扁平候选项，缺少 Schema 辅助、类型诊断和复杂映射能力。本文描述当前基础能力及后续目标体验，未实现的目标项以实施顺序和验收标准跟踪。

| System 定义 | 当前可视化能力 | 处理方案 |
|---|---|---|
| Role、Flow、事件标签、输入/输出拓扑 | 图上可视化编辑 | 保持现有图编辑，补齐拓扑与事件校验 |
| `exec.bind.<roleId>`、项目模型选择 | Role 配置面板可选 Tool/Profile 或 Agent/Model；模型选择属于项目配置 | 保持职责边界，不把模型绑定搬回 System DSL |
| `context.map.<roleId>.<field>` | 已在 Role 面板提供结构化行编辑；Flow 不再编辑同一映射 | 继续完善 Schema 辅助、复杂路径交互和映射诊断 |
| `role.mode.*`、`route.order.*`、`loop.max.*` | Role 面板支持标准/并行分发、目标排序和循环预算编辑 | Role 的“路由”设置维护策略；只有检测到环路时才启用循环预算 |
| `join.mode.*`、`join.sources.*`、`join.min.*` | Flow 可标记 Join 入边；Join Role 面板支持模式/阈值；序列化时 Join 来源由实际入边生成 | Join Role 设置模式/阈值；入边是来源集合的唯一事实来源 |
| `review.*` | Role 面板支持评审开关、超时、超时动作、返工目标/轮数和终止范围 | Role 的“人工评审”设置维护评审和恢复策略 |
| `system.id`、`system.version`、`law.global`、`entry.role` | Role/Flow 选择面板内有 System 设置折叠区；没有独立、始终可达的入口 | 提升为不依赖图选择状态的固定 System 设置入口 |
| `handoff.mode`、`handoff.contracts` | 可选模式和合同文件引用；就绪度/发布视图显示合同覆盖结果；正文在项目文件中维护 | 增加专用合同工作区，支持覆盖矩阵、Schema 编辑和候选文件校验 |
| `context.map` Selector 语法 | 有来源下拉和占位 JSON 形状预览；不支持 Schema 字段浏览或来源细节分步选择 | 使用 Schema 感知的来源/字段选择器；高级模式只提供受限、可静态验证的映射结构 |
| `model.bind.<roleId>` | 解析器识别，但模型选择运行时要求配置在 `.ogs/model-selection.json` | 不提供 System 图形配置；验证时提示改用项目模型选择设置 |
| `engine` | Parser 为旧 System 保留 `langgraph` 兼容输入；它不参与运行语义 | UI 不提供该设置；Studio 导入和生成时保留此兼容元数据，避免往返丢失 |

`.ogs/runtime.json` 中 `runtime.error_flows.v1` 是项目/运行级功能开关，默认值为 `false`；Flow 上的 `runtimeOnlyErrorFlow` 是单条边的标记。前者决定运行时是否启用错误流路由，后者随 System 图保存。它们分属不同配置层：本方案只处理 Flow 标记，不把全局运行开关并入 `system.mmd`；运行开关继续由运行配置界面或 `.ogs/runtime.json` 管理。角色 Prompt、Role Contract 和工具实现也不属于本方案的 System 图配置。

## 方案

### 作者模型与保存

继续以 `StudioAuthoringDocument` 作为编辑态权威模型。现有模型包含 System、Role、Flow、Join、Context Map、Review、Loop 和布局字段；补充字段或验证逻辑时，优先扩展这些类型及现有命令，不另建第二个 DSL 或通用元数据存储。

图形操作更新作者模型，现有序列化器生成 Mermaid。Studio 图形编辑保存到 `.ogs/studio/system.authoring.json` 草稿，不会直接写正式 `system.mmd`；Role 模型绑定变更还会经独立校验同步到 `.ogs/model-selection.json`。正式 System 保存仍走源码编辑器的保存 API：服务端执行 Parser/Compiler 校验，校验失败不会覆盖已保存的有效 `system.mmd`。Parser 当前拒绝未知或无效元数据，因此这些内容不能作为有效 System 导入；已支持的兼容 `engine=langgraph` 元数据由作者模型保留并参与序列化。图形草稿不是正式源码保存，不应把“草稿已保存”描述为“System 已发布”。

`engine` 不进入新的可视化表单。旧 `engine=langgraph` 仅作兼容输入，Studio 往返时保留；不要将它解释为运行时选择。`model.bind` 不进入可视化表单，模型设置仍以 `.ogs/model-selection.json` 为准。

### 页面信息架构

- **图画布**：负责 Role、Flow、事件、入口/终点以及拓扑关系。
- **System 设置**：从画布工具栏的固定入口打开，不依赖是否选中节点。分为“基本信息”“入口与路由”“Handoff 合同”三个短区段；当前 System ID、入口 Role、校验状态和未保存状态始终可见。Role/Flow 面板只提供跳转链接，不嵌入一份全局设置副本。
- **Role 属性面板**：按需展示“执行”“路由”“Join”“上下文”“人工评审”配置。只显示适用于所选 Role 的区域；非 Join Role 不显示 Join 阈值。
- **Flow 属性面板**：编辑事件标签、目标 Role，以及该 Flow 是否属于目标 Join 的入边。Join 来源集合以实际入边为准，Flow 勾选状态和 Join 来源列表保持单一事实来源。
- **源码视图**：作为高级编辑入口，显示确定性生成的 Mermaid。源码修改后解析回同一作者模型；图形/源码来回切换不得丢失已支持语义。

不新建独立的“上下文管理中心”、可扩展插件表单系统或额外持久化文件。

### 复杂映射设计

映射器采用渐进披露，不把简单用户放进通用表达式编辑器，也不把复杂映射伪装成一组无法解释的字符串。

**基础模式**是一行一个输入字段：目标字段、来源类型、来源 Role、来源对象、字段路径、必需性。来源 Role 和来源对象按所选 Role、Join 入边和当前运行语义联动过滤。字段路径选择器读取可用的上游输出 Schema；没有 Schema 时仍允许从受限的 `data` 路径手动添加字段段，并在验证结果中标记为“未能由 Schema 确认”，而不是猜测字段一定存在。允许用户通过新增/删除字段段构造嵌套源路径，不要求记忆点号语法。

目标字段保持当前运行时支持的扁平键名。UI 不把 `a.b` 显示成嵌套对象，除非运行时投影语义也明确支持这种解释；这是为了避免显示结构与传给 Role 的实际 JSON 不一致。预览明确标注“形状预览”，显示目标字段、必需性和来源说明，不用伪造值冒充真实运行结果。

**高级映射**只在用户明确切换后出现，分为两个层次：

1. **当前 DSL 可表达的高级项**：完整嵌套 `data` 路径、Human Review 的可选来源、字段重命名及 schema/来源诊断。编辑器仍生成单一 Selector，不展示原始语法。
2. **需要新增运行语义的组合映射**：多来源回退、对象/数组组装、常量默认值、条件映射、数组筛选/聚合等不能由当前 `context.map` Selector 表达。若纳入产品，先定义有限的类型化表达式 AST 和版本化 Mermaid 语法，再由 Parser、Compiler、运行时投影器共同实现；UI 只能组合白名单节点。每个表达式都显示来源依赖、静态类型和展开后的 JSON 形状，并在保存前做静态检查。首期不接受 JavaScript、任意表达式、JSONPath 或运行时模型生成映射。

复杂模式以只读图形预览为主，原始 AST/Mermaid 仅作为高级源码视图。错误直接定位到字段或表达式节点，说明缺失来源、类型不兼容、未满足 Join 来源条件或 Schema 不匹配，并提供跳转到对应 Role/Flow/合同的操作。无效映射可留在草稿继续编辑，但不能通过正式 System 校验。

### 合同编辑工作区

Handoff 合同入口从 System 设置进入一个聚焦的合同工作区。工作区以当前图的可部署 Flow 为行展示覆盖矩阵，并额外列出 Role Input 合同；列包括 Flow/目标 Role、合同状态、匹配条件、Schema、违规策略和最近校验结果。状态区分“未配置”“引用缺失”“匹配不到边”“Schema 无效”“有效”，点击行可定位画布边或 Role。

合同编辑分为基础表单和高级 Schema 两层：

- **基础表单**维护合同 ID、类型、Flow/Role 匹配、Schema 文件、`FAIL`/`WARN` 策略。Flow 匹配优先从现有图边选择，避免用户手工拼 `from/event/to`。
- **Schema 表单**覆盖常见对象字段：类型、必需字段、描述、枚举、数组元素、额外属性策略和嵌套对象。字段列表可从目标 Role Input Schema 或来源 Role Output Schema 引入，再由用户确认，不自动覆盖已有 Schema。
- **高级 Schema**在折叠区域编辑完整 JSON Schema，保留 `$ref` 能力和当前解析器支持的约束；远程引用继续由运行时拒绝。切换基础/高级模式前检测无法映射的关键字，提示用户保留高级模式，不能静默丢字段。
- **预览与校验**展示规范化 JSON、引用解析树、匹配到的边、缺少覆盖的边及 Schema 诊断。修改只进入合同草稿；服务端用与运行时相同的合同加载器和校验器检查候选文件。

合同文件仍是版本控制下的权威项目文件。编辑器应显示实际文件路径与变更摘要，不在浏览器额外保存一份影子合同数据库。若一次编辑同时改合同清单和 Schema 文件，服务端先在项目内临时目录构建完整候选集并校验，全部通过后再提交文件；失败时不替换现有有效文件。路径必须限制在项目目录，拒绝绝对路径、目录穿越和运行产物目录。保存成功后刷新项目上下文、合同覆盖报告和源码校验状态。

合同模式影响提示必须具体：`strict` 下未覆盖的可部署 Flow 会阻止正式校验/运行；`transition` 下哪些 Flow 可继续、哪些违规仅告警，应以当前运行时真实行为说明；关闭模式明确表示合同不参与交接校验。不要只显示抽象的“覆盖率”。

### 编辑状态与错误交互

- **改动状态**：字段修改后立即标记局部 Dirty；Studio 作者模型草稿可自动保存或显式保存，但正式 System 与合同文件继续使用明确的“保存并校验”动作。清楚区分“草稿已保存”“校验通过”“正式文件已保存”。
- **切换与关闭**：存在未保存改动时提供保存、放弃、继续编辑三个选择；跨 Role/Flow 切换时优先保留局部草稿，不静默丢输入。服务端保存失败时保持用户输入和错误详情。
- **校验时机**：本地校验即时检查必填、重复键、引用范围和明显类型错误；服务端校验负责 Parser/Compiler/合同解析最终门禁。错误按字段分组，画布诊断和面板诊断互相链接。
- **复杂度控制**：常用字段默认展开，高级 Schema/表达式默认折叠；表格支持键盘导航、批量检查、搜索/过滤和按错误筛选。破坏性删除需可撤销；Role/Flow 删除前列出受影响映射和合同。
- **可访问性与响应式**：所有控件有标签、错误关联和键盘焦点状态；窄屏将属性面板改为全屏/抽屉式单列布局，表格行改为可读的字段分组，不通过横向挤压隐藏关键列。

### 上下文映射器

替换 Role 和 Flow 两处 JSON 文本框，统一在目标 Role 的“上下文”设置中维护映射。每行包含：

| 字段 | 用途 |
|---|---|
| 目标字段 | 写入 Role `input` 对象的字段名 |
| 来源类型 | 全局值、直接上游或 Join 来源 |
| 来源 Role | 来源为 Role 结果时选择，选项按当前图结构过滤 |
| 来源字段 | 当前 UI 提供 `content`、`event`、`data` 固定候选；Parser 另支持受限的 `data` 路径语法 |
| 缺失策略 | 必需或可选；可选字段生成现有 `?` Selector 语义 |

选择器选项严格遵循运行时规则：普通 Role 可选 `direct.*` 和允许的 `global.*`；Join Role 可选 `source(<roleId>).*` 及允许的 `global.*`，且 Role 来源必须是该 Join 的入边。全局来源包括本轮任务、用户配置，以及当前可用时的 Human Review 返工上下文（评审意见、轮次、上一轮产物）。来源可用性依赖当前图结构，因此实现时应优先评估把无副作用的 Selector 语义规则提取到可由 Parser 和客户端共享的纯模块，并据此精确调整 `studio-client` 导入守卫；这属于架构决策，不是当前必须复制规则的限制。若共享模块边界不合适，可由服务端/API 提供候选项。无论采用哪种供数方式，客户端不得另行维护与运行时不一致的规则；来源不可用时不展示必需选项，仅在现有可选 Selector 语义适用时提供“可选”设置。UI 生成现有 `context.map` Selector，不让用户手输语法。

面板提供只读的 JSON 形状预览；当前预览使用占位值，不执行数据投影或模型调用。来源选项限于当前图结构允许的 Selector 和内置全局字段；可选标记只对运行时支持的 Human Review 全局字段有效。当前 UI 不从输出 Schema 推导嵌套字段，也不展示 `role_input` Schema 诊断。映射能否用于运行仍由 Parser/Compiler 与运行时合同校验负责。

### Role 运行策略

- **路由**：标准事件路由或 `parallel_split`；并行目标顺序通过目标 Role 列表排序，对应 `route.order`；有环图配置正整数 `loop.max`。
- **Join**：选择 `all_of` 或 `quorum_of`。来源从实际入边自动计算；`quorum_of` 显示 `join.min` 步进器并校验 `1 <= min <= 来源数`。当 `join.min` 小于来源数时，运行时不允许使用 `source(...)` Selector，映射器应禁用这些来源并说明原因；只有阈值等于来源数时才允许选择 Join 来源。`all_of` 不显示无效阈值。
- **人工评审**：开关评审；开启后设置超时时间、超时动作、返工目标、最大返工轮数和终止范围。控件选项与当前 Parser/Compiler 和运行时约束一致：超时动作仅支持 `pause` 或 `terminate`，终止范围仅支持 `branch` 或 `run`；必需项给出默认值并显示在保存摘要中。

### System 与 Handoff

System 设置提供必填项和引用选择器。入口 Role 与 `input` 起始边同步，避免 `entry.role` 和起始边目标冲突。全局 Law 从当前项目 Law Catalog 选择，找不到引用时显示错误，不要求手写 ID。Law Catalog 当前由 `.ogs/laws.json` 提供，项目上下文经 `GET project/config` 返回 `laws`；选择器可复用该配置数据，无需假设 Catalog 不存在或另建数据源。当前 DTO 将 `laws` 暴露为 `unknown | null`，因此客户端需在选择器边界做窄化和字段校验，再作为 Law 选项使用。

Handoff 模式可选择关闭、`transition` 或 `strict`，并填写项目内合同文件路径。目标体验是在不另建影子存储的前提下增加合同工作区：编辑项目合同清单和 Schema 文件，按当前图显示覆盖矩阵，服务端以运行时相同的加载器校验候选文件后提交。System 作者草稿保存不写合同文件；正式源码保存和运行时 Parser/Compiler 门禁仍是权威校验。

## 建议实施顺序

以下顺序用于控制实施风险和保持可独立验收；它是目标设计的后续工作清单，不代表其中所有能力已经交付，也不构成工期估算。

1. **基础体验收口**：把 System 设置移到固定入口；打磨映射行的 source type/Role/path 分步选择、必需性限制、键盘操作、删除确认和错误跳转。
2. **Schema 辅助**：从项目 Role Output Schema 和 `role_input` Contract Schema 建立安全的属性树；支持嵌套源路径、类型提示、Schema 缺失回退和 stale reference 诊断。
3. **合同工作区**：实现 Flow/Role Input 覆盖矩阵、基础 Schema 表单、高级 JSON Schema 编辑、$ref 解析预览、候选文件校验及失败不覆盖。
4. **高级映射运行语义**：只有在基础映射不足以支持真实场景时，再定义有版本的受限 AST/DSL；同步实现 Parser、Compiler、投影器和兼容迁移，再开放组合/对象/数组/默认值等 UI 节点。
5. **体验与回归**：补充未保存保护、撤销、键盘/窄屏支持和分层 UAT；保持旧 `engine=langgraph` 往返及 `.ogs/model-selection.json` 配置边界。

上下文映射器、Role 策略和 System/Handoff 引用可以独立使用；合同正文仍由项目文件流程维护。

## 验收标准

### 功能

- 用户能通过页面完成 System、Role、Flow、路由、Join、循环、人工评审、Handoff 引用和输入映射的常用配置，不需要编辑 Mermaid 元数据或手输 Selector。
- Context Map 在页面只有一个编辑入口；删除映射会同步删除对应元数据，不遗留重复值。
- 上下文映射器仅提供当前节点类型和图结构允许的来源；Join 来源变化后，映射器立即更新来源选项。`quorum_of` 的 `join.min` 小于来源数时，不提供 `source(...)` 选项；达到全部来源数后才允许选择。
- 每个 Role 可查看目标字段、来源、类型/Schema 状态和占位 JSON 形状；UI 只生成运行时支持的 Selector，最终有效性由服务端 Parser/Compiler 校验。
- System 入口 Role 与输入边目标保持一致；Join 配置与 Mermaid 入边精确一致；`quorum_of` 阈值合法；Review 和 Loop 设置符合 Parser/Compiler 约束。
- `.ogs/model-selection.json` 仍是模型绑定唯一配置来源；`exec.bind` 仍解析到项目执行 Profile。
- System 设置无需先选中 Role/Flow 即可到达；从任一 Role/Flow 可一键跳转到相关设置。
- 合同工作区能按当前图列出所有符合运行时规则的可部署 Flow 与 Role Input，并明确呈现覆盖、引用和 Schema 错误；保存失败时项目内原有效文件保持不变。
- Schema 编辑基础模式覆盖常见对象/数组约束；高级模式往返保留未知于基础表单但被 JSON Schema 解析器接受的关键字，不静默降级或删除。

### 数据保真与安全

- 对所有可视化支持的配置，导入 `system.mmd`、保存、再导入后的作者模型语义相等；序列化结果确定、稳定，不产生重复元数据键。
- 旧 `engine=langgraph` 输入经过导入和序列化后仍存在；未知/无效元数据由 Parser 拒绝，不能被误报为已成功图形编辑。
- 客户端校验提供及时反馈，服务端 Parser/Compiler 校验仍是最终门禁；失败时不覆盖已保存的有效 System。
- 映射器只允许当前运行时 Selector 语法中的 `direct`、Join 入边 `source(...)` 和受支持的 `global` 来源；不开放祖先 Role 任意递归读取或隐式 Session 状态。

### 回归测试

- 单元测试覆盖 Selector 行编辑、Schema 路径浏览、来源过滤、可选字段限制、删除/重命名 Role 后映射和合同引用诊断。
- 单元测试覆盖路由模式、目标顺序、Join 模式/阈值、Review 超时和返工策略的表单校验。
- 集成测试覆盖设置导入/序列化往返、兼容 engine 保留、映射 Schema/Selector 校验、合同 `$ref` 和匹配覆盖、无效候选文件不覆盖有效文件，以及草稿与正式 `system.mmd` 保存边界。
- 端到端 UAT 覆盖基础映射、嵌套源路径、Join 来源约束、Human Review 可选字段、合同覆盖修复、Schema 基础/高级模式往返、服务端保存失败恢复和图形/源码切换。
- 现有源码编辑、图编辑、运行预览和保存流程回归通过；宽屏和窄屏下检查系统设置、Role 与 Flow 配置面板不重叠、不被遮挡；键盘可完成映射和合同的新增、编辑、校验与保存。

## 不纳入本次范围

- Session 级跨轮上下文的存储、更新、冲突合并和 `session_context` Selector；这些属于后续 Session 运行语义设计。
- 新的执行后端、模型绑定 DSL、任意表达式/JSONPath、从祖先 Role 任意递归取值。
- 通用表单生成框架或新的 System sidecar 配置文件。
- 任意代码、任意 JSONPath 或由模型生成并直接执行的映射表达式；高级映射必须先经过类型化 DSL/运行时设计。
