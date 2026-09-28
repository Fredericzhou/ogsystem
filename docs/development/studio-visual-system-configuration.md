# Studio System 可视化配置方案

## 目标

让用户在 Studio 图形界面中配置 System 结构和运行语义，常用场景无需编辑 Mermaid 元数据或记忆 Selector 语法。`system.mmd` 继续作为版本化、可审阅的 System 定义文件，由 Studio 根据结构化配置确定性生成。

设计约束：

- 复用现有 `StudioAuthoringDocument`、解析器、编译器和 Mermaid 序列化器，不新建平行的配置存储或通用表单框架。
- 每项配置只有一个权威编辑入口。图形表单和源码视图读写同一个作者模型。
- 图形保存必须保留所有已支持且可建模的语义；不能静默丢弃源码配置。
- Session 跨轮上下文不在本方案中实现。待 SessionContext 语义和 API 确定后，再作为显式 Context 来源接入。

## 当前能力与缺口

Studio 已支持图上 Role/Flow 的增删改、部分执行绑定配置，并用结构化作者模型生成 Mermaid。Context Map 可编辑受限嵌套来源路径，Selector 规则由 runtime 与客户端共用的纯模块提供；预览显示映射后的目标字段形状、来源和必需性，不模拟运行时值。配置了 Role Input 合同 Schema 时，会检查缺少的必需字段和不允许的额外字段。合同工作区可查看覆盖表、逐项编辑合同匹配和单独编辑 Schema JSON；候选在服务端校验后才原子写入。首期仍不提供 Role Output Schema 浏览器、字段类型推断、值转换或对象组装。

| System 定义 | 当前可视化能力 | 处理方案 |
|---|---|---|
| Role、Flow、事件标签、输入/输出拓扑 | 图上可视化编辑 | 保持现有图编辑，补齐拓扑与事件校验 |
| `exec.bind.<roleId>`、项目模型选择 | Role 配置面板可选 Tool/Profile 或 Agent/Model；模型选择属于项目配置 | 保持职责边界，不把模型绑定搬回 System DSL |
| `context.map.<roleId>.<field>` | Role 面板支持受限嵌套路径、Human Review Optional 限制、目标形状预览和 Role Input Schema 的必需/额外字段提示 | Selector 语法与运行时共用；首期不支持值变换、聚合或对象组装 |
| `role.mode.*`、`route.order.*`、`loop.max.*` | Role 面板支持标准/并行分发、目标排序和循环预算编辑 | Role 的“路由”设置维护策略；只有检测到环路时才启用循环预算 |
| `join.mode.*`、`join.sources.*`、`join.min.*` | Flow 可标记 Join 入边；Join Role 面板支持模式/阈值；序列化时 Join 来源由实际入边生成 | Join Role 设置模式/阈值；入边是来源集合的唯一事实来源 |
| `review.*` | Role 面板支持评审开关、超时、超时动作、返工目标/轮数和终止范围 | Role 的“人工评审”设置维护评审和恢复策略 |
| `system.id`、`system.version`、`law.global`、`entry.role` | Structure 无选择状态显示唯一 System 设置入口；Role/Flow 面板提供跳转按钮 | 继续复用单一作者模型和正式源码校验流程 |
| `handoff.mode`、`handoff.contracts` | 固定 System 入口包含 Flow/Role Input 覆盖表、合同逐项表单及 Schema JSON 编辑；专用 API 限制项目真实路径并校验后原子保存 | 持续完善错误跳转和更丰富的 Schema 诊断，不扩为通用文件管理器 |
| `context.map` Selector 语法 | 来源候选遵守 Join/普通入边规则；受限字段路径由共享 Selector 语义模块校验；Role Input Schema 提供必需字段缺失和额外字段诊断 | Schema 字段类型浏览与 Role Output Schema 联动留待有稳定摘要来源后评估 |
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
- **System 设置**：Structure 无选择状态时提供唯一编辑入口；Role/Flow 属性面板提供跳转按钮，不复制全局表单。入口包含基本信息、入口与路由及 Handoff 合同工作区。
- **Role 属性面板**：按需展示“执行”“路由”“Join”“上下文”“人工评审”配置。只显示适用于所选 Role 的区域；非 Join Role 不显示 Join 阈值。
- **Flow 属性面板**：编辑事件标签、目标 Role，以及该 Flow 是否属于目标 Join 的入边。Join 来源集合以实际入边为准，Flow 勾选状态和 Join 来源列表保持单一事实来源。
- **源码视图**：作为高级编辑入口，显示确定性生成的 Mermaid。源码修改后解析回同一作者模型；图形/源码来回切换不得丢失已支持语义。

不新建独立的“上下文管理中心”、可扩展插件表单系统或额外持久化文件。

### 映射能力与边界

当前编辑器使用逐行表单维护目标字段、Selector 来源、受限字段路径和可选性。路径作为一个文本字段输入，不提供逐段 Schema 浏览、Role Output Schema 类型推断或高级映射模式。Role Input 合同 Schema 可即时提示缺少的 `required` 字段和被 `additionalProperties: false` 拒绝的额外字段。预览显示目标字段形状、来源和必需性，不执行投影或伪造运行时值。

Selector 语法及图结构候选由 runtime 与客户端共享的纯模块提供。普通来源和 Join 来源依运行时规则过滤；Optional 只允许用于受支持的 Human Review 字段。目标字段仍是运行时支持的扁平键名。

多来源回退、对象/数组组装、常量默认值、条件映射、筛选和聚合都需要新增运行语义，本次不提供 UI 或 DSL。只有基础 Selector 被真实场景证明不足后，才评估版本化类型化 AST；届时需同时实现 Parser、Compiler、投影器及迁移测试。不会把任意表达式或 JSONPath 作为短期扩展。

### 合同编辑工作区

Handoff 合同入口从 System 设置进入合同工作区。覆盖表按当前运行时摘要列出 Flow 与 Role Input 合同状态；当前列为 Flow/Role 标识、合同 ID、状态和 Schema 路径。合同清单表单负责编辑匹配项和违规策略；覆盖表尚不支持点击行跳转，也不承诺独立列出所有诊断类别。

合同工作区当前包含 Flow/Role Input 覆盖表、合同清单表单和逐个 Schema JSON 编辑器。清单表单维护合同 ID、类型、Flow/Role 匹配、Schema 路径及 `FAIL`/`WARN`；不提供可视化 Schema 构建器、字段自动导入或 `$ref` 树预览。合同和 Schema 文件分别保存，服务端逐个校验候选文件后原子替换；失败时原文件不变且保留当前编辑输入。路径限制在项目内，拒绝目录穿越、项目外符号链接及不允许的外部 `$ref`。成功后刷新合同工作区数据。

合同文件仍是版本控制下的权威项目文件，不另存浏览器影子数据。一次保存只涉及一个文件，因此清单与 Schema 的跨文件原子事务不在当前 API 范围内。覆盖状态复用现有项目就绪度和合同运行时校验结果；合同缺失或未匹配的处理以当前运行时诊断为准。

合同模式仍使用 `strict`、`transition` 和关闭三种运行时语义。工作区显示当前覆盖数量与行状态；更细的逐条模式影响解释和诊断跳转可在后续有明确用例时补充，不以单一覆盖率替代运行时校验结果。

### 编辑状态与错误交互

- **改动状态**：Studio 作者模型草稿与正式 System 保存沿用现有工作区流程。合同文件有独立的单文件保存动作；无效候选不会覆盖文件，Schema 编辑失败时保留输入及错误。
- **切换与关闭**：Role/Flow 编辑器保留各自现有局部草稿行为；尚未实现覆盖所有视图的统一未保存离开保护或全局撤销框架，不应在 UI 或文档中宣称具备这些保证。
- **校验时机**：客户端即时检查映射字段和表单约束；服务端复用 Parser/Compiler 及合同加载器校验正式候选。诊断可用于定位 Role/Flow，但尚未覆盖所有合同问题的一键跳转。
- **复杂度控制**：当前没有批量合同检查、按错误筛选、通用 Schema 表单或表达式编辑器。新增这些交互前应先确认存在重复高频任务，并复用现有控件模式。
- **可访问性与响应式**：现有工作区支持键盘操作；浏览器 UAT 覆盖窄屏合同 JSON 编辑与保存。新增控制仍需提供可访问名称、焦点状态，并验证不会遮挡关键操作。

### 上下文映射器

Context Map 统一在目标 Role 的“上下文”设置中维护。每行包含：

| 字段 | 用途 |
|---|---|
| 目标字段 | 写入 Role `input` 对象的字段名 |
| 来源类型 | 全局值、直接上游或 Join 来源 |
| 来源 Role | 来源为 Role 结果时选择，选项按当前图结构过滤 |
| 来源字段 | 共享 Selector 候选及受限的嵌套 `data` 路径输入 |
| 缺失策略 | 必需或可选；可选字段生成现有 `?` Selector 语义 |

选择器选项严格遵循运行时规则：普通 Role 可选 `direct.*` 和允许的 `global.*`；Join Role 可选 `source(<roleId>).*` 及允许的 `global.*`，且 Role 来源必须是该 Join 的入边。全局来源包括本轮任务、用户配置，以及当前可用时的 Human Review 返工上下文。候选与语法校验使用共享纯模块；UI 生成现有 Selector，不要求手输 Selector 语法。受限 `data` 路径由单个字段路径输入编辑，不做 Schema 浏览或类型推导。

面板提供只读的目标 JSON 形状预览，不执行数据投影或模型调用。来源选项限于当前图结构允许的 Selector 和内置全局字段；可选标记只对运行时支持的 Human Review 全局字段有效。配置 Role Input Schema 时会提示必需字段缺失及禁止的额外字段。映射最终仍由 Parser/Compiler 与运行时合同校验。

### Role 运行策略

- **路由**：标准事件路由或 `parallel_split`；并行目标顺序通过目标 Role 列表排序，对应 `route.order`；有环图配置正整数 `loop.max`。
- **Join**：选择 `all_of` 或 `quorum_of`。来源从实际入边自动计算；`quorum_of` 显示 `join.min` 步进器并校验 `1 <= min <= 来源数`。当 `join.min` 小于来源数时，运行时不允许使用 `source(...)` Selector，映射器应禁用这些来源并说明原因；只有阈值等于来源数时才允许选择 Join 来源。`all_of` 不显示无效阈值。
- **人工评审**：开关评审；开启后设置超时时间、超时动作、返工目标、最大返工轮数和终止范围。控件选项与当前 Parser/Compiler 和运行时约束一致：超时动作仅支持 `pause` 或 `terminate`，终止范围仅支持 `branch` 或 `run`；必需项给出默认值并显示在保存摘要中。

### System 与 Handoff

System 设置提供必填项和引用选择器。入口 Role 与 `input` 起始边同步，避免 `entry.role` 和起始边目标冲突。全局 Law 从当前项目 Law Catalog 选择，找不到引用时显示错误，不要求手写 ID。Law Catalog 当前由 `.ogs/laws.json` 提供，项目上下文经 `GET project/config` 返回 `laws`；选择器可复用该配置数据，无需假设 Catalog 不存在或另建数据源。当前 DTO 将 `laws` 暴露为 `unknown | null`，因此客户端需在选择器边界做窄化和字段校验，再作为 Law 选项使用。

Handoff 模式可选择关闭、`transition` 或 `strict`，并填写项目内合同文件路径。System 无选择状态时可直接进入 System 设置；选中 Role/Flow 后可用跳转按钮回到该工作区。合同清单与 Schema 在同一工作区分别编辑、分别保存，服务端以运行时相同的合同规则验证候选文件。作者草稿保存不写合同文件；正式源码保存和运行时 Parser/Compiler 门禁仍是权威校验。

## 建议实施顺序

以下记录首期实现状态及有证据再启动的后续工作，避免把未验证的通用能力提前做成基础设施。

1. **基础工作区**：已交付无选择状态的 System 设置入口、Role/Flow 跳转、结构化映射行、Optional 限制、嵌套 `data` 路径、目标形状预览、Role Input 即时诊断及共享 Selector 规则。
2. **合同编辑**：已交付覆盖表、合同清单表单、单文件 Schema JSON 编辑、候选校验、路径边界及失败不覆盖。可视化 Schema 表单、跨文件事务与 `$ref` 解析树未实现，当前没有明确用例要求增加。
3. **验证与回归**：持续维护导入保真、共享语义、合同 API 安全、桌面与窄屏键盘 UAT；完善具体失败诊断和导航时以可复现用户流程为依据。
4. **高级映射运行语义**：只有基础 Selector 被真实场景证明不足后，再评估有版本的 AST/DSL，并同步实现 Parser、Compiler、投影器和兼容迁移。

上下文映射器、Role 策略和 System/Handoff 引用可以独立使用；合同正文仍由项目文件流程维护。

## 验收标准

### 功能

- 用户能通过页面完成 System、Role、Flow、路由、Join、循环、人工评审、Handoff 引用和输入映射的常用配置，不需要编辑 Mermaid 元数据或手输 Selector。
- Context Map 在页面只有一个编辑入口；删除映射会同步删除对应元数据，不遗留重复值。
- 上下文映射器仅提供当前节点类型和图结构允许的来源；Join 来源变化后，映射器立即更新来源选项。`quorum_of` 的 `join.min` 小于来源数时，禁用 `source(...)` 选项；若当前映射已使用该来源，则保留并禁用它以便识别和修复，阈值覆盖全部来源后才可选择。
- 每个 Role 可查看目标字段、来源、必需性和只读 JSON 形状；配置 Role Input Schema 时提示必需字段缺失及额外字段。首期不声称推断值类型或预览实际投影值。UI 与服务端使用共享 Selector 规则，最终有效性由 Parser/Compiler 校验。
- System 入口 Role 与输入边目标保持一致；Join 配置与 Mermaid 入边精确一致；`quorum_of` 阈值合法；Review 和 Loop 设置符合 Parser/Compiler 约束。
- `.ogs/model-selection.json` 仍是模型绑定唯一配置来源；`exec.bind` 仍解析到项目执行 Profile。
- System 设置无需先选中 Role/Flow 即可到达；从任一 Role/Flow 可一键跳转到相关设置。
- 合同工作区能按当前图列出符合运行时规则的 Flow 与已有 Role Input 合同，明确显示覆盖和引用；保存时报告清单绑定、Schema 及本地 `$ref` 校验错误，失败时原文件与当前输入保持不变。
- Schema 编辑基础模式覆盖常见对象/数组约束；高级模式往返保留未知于基础表单但被 JSON Schema 解析器接受的关键字，不静默降级或删除。

### 数据保真与安全

- 对所有可视化支持的配置，导入 `system.mmd`、保存、再导入后的作者模型语义相等；序列化结果确定、稳定，不产生重复元数据键。
- 旧 `engine=langgraph` 输入经过导入和序列化后仍存在；未知/无效元数据由 Parser 拒绝，不能被误报为已成功图形编辑。
- 客户端校验提供及时反馈，服务端 Parser/Compiler 校验仍是最终门禁；失败时不覆盖已保存的有效 System。
- 映射器只允许当前运行时 Selector 语法中的 `direct`、Join 入边 `source(...)` 和受支持的 `global` 来源；不开放祖先 Role 任意递归读取或隐式 Session 状态。

### 回归测试

- 单元测试覆盖嵌套 Selector 行编辑、共享语法校验、来源过滤、可选字段限制、Role Input 必需字段诊断、删除/重命名 Role 后映射和合同引用诊断。
- 单元测试覆盖路由模式、目标顺序、Join 模式/阈值、Review 超时和返工策略的表单校验。
- 集成测试覆盖设置导入/序列化往返、兼容 engine 保留、映射 Schema/Selector 校验、合同 `$ref` 和匹配覆盖、无效候选文件不覆盖有效文件，以及草稿与正式 `system.mmd` 保存边界。
- 端到端 UAT 覆盖图形工作区、桌面和窄屏布局及运行视图；合同 API 集成用例覆盖路径越界、项目外符号链接、外部 `$ref`、无效清单/Schema 不覆盖原文件和有效候选保存。浏览器合同 UAT 覆盖窄屏键盘展开、无效 Schema 输入保留、有效 Schema 保存和合同 ID 保存；不代表覆盖了所有合同诊断和错误跳转。
- 浏览器用例覆盖 System 无选择入口及 Role/Flow 跳转、嵌套 `direct.data` 和 Join `source(...).data` 映射保存、Join/quorum 来源门禁、可选 Human Review 来源、Schema JSON 校验失败恢复，以及窄屏合同键盘流程。

## 不纳入本次范围

- Session 级跨轮上下文的存储、更新、冲突合并和 `session_context` Selector；这些属于后续 Session 运行语义设计。
- 新的执行后端、模型绑定 DSL、任意表达式/JSONPath、从祖先 Role 任意递归取值。
- 通用表单生成框架或新的 System sidecar 配置文件。
- 任意代码、任意 JSONPath 或由模型生成并直接执行的映射表达式；高级映射必须先经过类型化 DSL/运行时设计。

## 首期实施基线

本节是首期实现的范围基准；与前文长期目标描述冲突时，以本节为准。首期优先改善常见配置任务，不提前构建通用映射语言、Schema 表单平台或项目文件管理器。

### 映射

- 编辑器提供共享语义约束下的 Selector 来源下拉与受限路径输入；不读取 Role Output Schema，也不根据输出字段推断类型或标记 Schema 未验证。目标字段继续使用运行时当前支持的扁平键名。
- Optional 仅对运行时支持的 Human Review 字段启用；没有 Schema 时仍可填写受限的 `data` 路径，最终由 Parser/Compiler 校验。
- 保留只读的目标形状预览，标明它不是实际数据预演。首期不实现值转换、拼接、条件、回退、对象/数组组装或聚合，也不新增映射 AST/DSL。
- 只有真实用例证明基础 Selector 不足时，才单独评估有版本的受限表达式语义；需同时扩展 Parser、Compiler、投影器和测试后才能开放相应 UI。

### 合同

- 从固定 System 设置入口进入合同工作区。用现有覆盖与就绪度数据列出 Flow 和 Role Input 状态；合同清单用表单编辑匹配项和 Schema 路径。
- Schema 使用 JSON 编辑器并提供解析/运行时校验诊断。首期不做可视化 Schema 构建器、通用文件浏览器或合同数据影子存储。
- 已实现的首期 Schema 诊断复用合同编译器校验 `$ref`、结构、角色/Flow 绑定和运行时 Schema 约束；Role 配置面板仅做 Role Input `required` 与 `additionalProperties: false` 的即时字段级提示。
- 仅增加合同专用的读取和写入边界，只允许项目内合同清单及其引用的 Schema 文件。一次只保存一个文件：服务端先验证候选内容，验证通过后原子替换；失败时保持原文件和用户输入。不得引入通用任意路径文件读写 API。
- 验证复用现有合同加载和 Schema 校验规则；覆盖结果复用现有就绪度/发布模型。错误须区分缺少合同、无效引用、未匹配 Flow 和无效 Schema，并可跳转到相应 Flow/Role。

### 全局交互

- System 设置提供固定入口，无须先选择 Role 或 Flow；属性面板仅提供跳转，不重复嵌入全局设置。
- 明确显示作者草稿已保存、校验通过和正式 `system.mmd` 已保存三种状态。合同文件使用明确的单文件保存动作，不把草稿保存误报为正式保存。
- 首期复用现有局部草稿和保存交互，不增加全局撤销框架、批量编辑、插件表单、通用 Schema 服务或新的持久化格式。键盘可操作和窄屏可用由 UAT 覆盖；跨所有编辑器的未保存离开保护不在首期实现范围。

### 接口与验收

- 复用现有 Studio 项目上下文中的合同和 Role Input Schema 数据；首期不建设 Role Output Schema 浏览器或通用 Schema 服务。
- 合同 API 只负责读取合同工作区所需数据及保存单个受限文件；服务端负责路径边界、候选校验和原子写入。
- 单元/集成覆盖来源限制、嵌套路径、Human Review Optional、Role Input 必需/额外字段诊断、合同覆盖诊断、Schema `$ref` 校验、路径越界、无效候选不覆盖现有文件。
- 浏览器 UAT 覆盖无节点选中时的 System 设置入口、Role/Flow 跳转、普通 Role 嵌套映射、Join 来源映射及 quorum 来源门禁、可选 Human Review 来源、合同覆盖缺失后的修复、合同清单与 Schema 保存、Schema JSON 校验失败后保留输入，以及窄屏键盘操作。完整诊断跳转仍由后续用例补齐。
