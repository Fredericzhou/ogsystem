# Team 角色上游仓库与适配方案

状态：已落地并完成自动验证
日期：2026-10-27

## 目标与边界

建立一条从独立 Git 角色源到可运行 TeamVersion 的受控流程：

```text
独立 Git 角色源
  -> Team Site 同步与索引
  -> 角色库浏览和预览
  -> 用户选择角色并确认转换选项
  -> Team Draft 中的标准角色副本
  -> 校验、模拟并发布 TeamVersion
  -> Runtime 加载已发布的标准角色包
```

- 上游仓库负责提供原始角色内容。Team Site 对上游内容只读，不将用户编辑写回上游。
- Team Site 负责来源配置、同步、索引、原文预览、适配、确认、校验和复制到 Draft。
- Team Draft 中的副本由 Team 所有，可独立编辑；重新同步上游不会修改它。
- TeamVersion 发布时固定拓扑、角色文件、来源记录、合同版本和摘要。已发布版本不受后续同步或模板变化影响。
- Runtime 只加载、校验和执行标准 OGSystem 角色包，不连接或读取上游仓库。
- 同步和转换过程只把上游文件当作数据读取。不得运行仓库中的脚本、工作流、构建任务或其他可执行内容。

## 起始实现基线

以下描述记录方案编写时的代码状态，便于理解本次改造范围；当前落地状态见“实施阶段”。

- `tools/agent-source/importers/generic-markdown.mjs` 提供 Markdown 适配器骨架，但当前以正则提取 `name` 和 `description`，并把整份 Markdown（包括 front matter）写入 `agent.md`。
- `tools/agent-source/importers/agency-agents.mjs` 已识别 Agency Agents 的类别目录，并过滤不含名称元数据的 Markdown 文件；它继承通用导入器的正文处理和固定输出事件行为。
- `tools/agent-source/sync-agent-sources.mjs` 是仓库内的角色导入/同步工具，不是 Team Site 的角色库实现。它会写入规范角色目录，并删除来源中已消失的导入角色；不能直接作为新的 Team Site 版本化同步流程。
- `apps/team-site/infrastructure/file-shared-resource-store.mjs` 维护不可变角色模板快照，但 `ROLE_FILES` 目前只有 `agent.md`、`prompt.md`、`role.json`、`output.schema.json`，模板摘要也只覆盖这些允许文件。
- `apps/team-site/infrastructure/file-team-design-asset-store.mjs` 和 Team Studio 编辑器也采用四文件白名单。来源记录要进入 Draft 和发布摘要，所有相关存储、编辑和导出路径都需要支持它。
- Team Site 已具备不可变角色模板、复制模板到 Draft、Draft 角色文件编辑和 TeamVersion 发布能力。新能力应沿用现有 Application/Domain/Infrastructure 边界及不可变版本模式。

## 数据模型与版本边界

### 上游来源

每个来源至少包含：

```json
{
  "sourceId": "agency-agents",
  "gitUrl": "https://github.com/msitarzewski/agency-agents.git",
  "branch": "main",
  "adapterId": "agency-agents-markdown",
  "adapterVersion": "1",
  "enabled": true
}
```

凭据若未来需要，应通过服务端凭据引用管理，不写入此配置、日志或来源记录。来源配置仅允许管理员修改。
来源登记、同步和刷新索引接口仅接受 loopback 或 Tailnet 来源。来源概览和角色仓库不显示 Git 地址/分支；新增来源时可展开 Git 连接字段填写地址和分支，已保存来源的身份字段保持不可变，变更时新增来源 ID。

### ID 规范与默认 slug

共享校验代码按 ID 所属存储域调用显式规则，不用一个正则覆盖所有 ID。本方案只实现当前合同，不迁移旧来源目录数据，也不承诺兼容旧角色源格式：

| 存储域 | ID 字段 | 规则 | 默认值/生成方式 |
| --- | --- | --- | --- |
| Team Site 来源目录与来源配置 | `sourceId` | `^[a-z0-9][a-z0-9-]{0,79}$`，与共享资源目录 ID 对齐 | 管理员配置；不从 URL 自动推导 |
| 适配器注册表 | `adapterId` | `^[a-z0-9][a-z0-9-]{0,79}$` | 由服务端注册，不接受任意用户代码或动态模块路径 |
| 共享角色模板 | `roleId`、`versionId` | `^[a-z0-9][a-z0-9-]{0,79}$` | 模板 ID 默认 `<source-slug>-<role-slug>`；版本 ID 默认 `c-<commit前12位>` |
| Team Draft 角色目录 | `roleId` | `^[a-z0-9][a-z0-9_-]{0,63}$` | 默认由角色显示名生成 slug；冲突时要求用户选择/修改，不静默追加或覆盖 |
| 上游相对路径 | `path` | 不属于 ID；按相对 POSIX 路径校验并拒绝绝对路径、空段、`.`、`..`、符号链接逃逸 | 只能取自已索引的仓库路径 |

Slug 生成使用 Unicode NFKD 规范化、转小写、去除组合音标、把连续非 ASCII 字母数字字符压成单个 `-`，并去掉首尾 `-`。若显示名 slug 为空，则回退到经安全校验的文件 basename；仍为空时使用 `role-<原始来源路径 SHA-256 前10位>`。共享模板默认 slug 加来源前缀以降低跨来源碰撞；Team 内默认 slug 不带来源前缀，保持短且可读。生成后仍分别通过目标存储域的 ID 校验，失败时要求用户提供合法 ID。

`sourceId`、模板 ID 和 Team role ID 按各自存储域规则校验。新增代码不得隐式迁移现有 Team 角色目录；本功能创建的来源副本使用当前 Team role ID 规则。

同步元数据记录来源 ID、规范化 Git 地址、分支、完整 commit SHA、同步时间、适配器 ID/版本、索引版本及每条角色记录的原始相对路径、语言和内容摘要。来源内容摘要针对 checkout 中原始文件字节计算。角色版本由来源 ID、角色相对路径和 commit 确定；同 commit 重复同步幂等，不覆盖已有快照。新 commit 成为角色库当前显示版本，旧 commit 快照保留用于来源追溯、预览和复制。

来源同步仅由管理员在“平台配置 > 角色源配置”显式启动；服务启动、来源登记和启用状态变更都不触发 Git 操作，也不运行周期定时同步。手动同步作为 Team Site 后台任务执行，接口快速返回，页面读取持久化任务状态。Git 更新采用快进策略（等价于 `git pull --ff-only`），拉取配置分支当前最新 commit 并立即索引。拒绝本地分叉、未提交改动和无法快进的更新；界面给出错误，不自动 reset、clean 或覆盖管理员的 checkout。另提供“重新索引”操作，用于管理员手动 pull 后重扫当前 checkout。同步和索引都在临时索引上完成，通过校验后原子切换，失败时保留上一次可用索引。服务重启后将遗留的 running 状态标记为中断失败，保留上一次成功 commit 和时间，不自动重试。

上游未找到权威的全量 role 清单，角色列表必须通过扫描当前 commit 的 Git tree 动态发现，不能将结果标成“完整清单”。Agency Agents 以 Markdown 文件所在 Git 路径首层目录作为分类，支持新增目录类别和更深层相对路径；适配器排除已知非角色目录，并对候选文件解析。索引统计分别记录候选 Markdown 数、成功适配角色数和未适配候选数；页面显示统计及“发现结果不保证全量”的提示。

Git checkout 放在 Team Site 自身数据目录，和 OGSystem 内核仓库、运行时角色目录分离。只从配置的分支 checkout；不执行钩子、安装步骤或仓库内脚本。路径解析、符号链接、文件数量、单文件大小和总索引大小均受限。

来源 Git 地址只接受 HTTPS，不接受用户名/密码、显式端口、IP 字面量、localhost 或 local/internal/lan/test/invalid 后缀主机名。登记来源以及每次同步前都解析主机名；必须至少得到一个地址且所有 IPv4/IPv6 结果均为公网单播地址，拒绝环回、私网、链路本地、共享地址、文档示例、基准测试、组播和保留地址。同步时用 Git 的 `http.curloptResolve` 将连接固定到这批已检查的 IP，关闭 Git HTTP 重定向，并清除进程代理环境变量、拒绝 checkout 中的代理配置；Git 版本须支持 `http.curloptResolve`。自托管 Git 主机需解析到公网地址并使用标准 HTTPS 端口；网络层仍应阻止 Team Site 出站访问内网和云元数据地址。

### 标准角色副本

复制流程把选定的不可变来源快照通过适配器转换成 Team Draft 标准包。副本获得 Team 内唯一 role ID，需显式处理目标 ID 冲突；来源角色 ID 不直接假设可用作 Team 内 ID。复制和后续编辑不改变上游索引及模板。

来源记录进入 Draft 角色资产和发布包完整性摘要。建议将 `source.json` 视为系统管理的来源证明：普通角色编辑器只读显示，转换/重新关联来源时由受控命令更新。来源记录随副本发布后不可变。记录本身不放密钥，可包含：

```json
{
  "version": 1,
  "sourceId": "agency-agents",
  "gitUrl": "https://github.com/msitarzewski/agency-agents",
  "commit": "<40-character-sha>",
  "path": "engineering/engineering-frontend-developer.md",
  "adapterId": "agency-agents-markdown",
  "adapterVersion": "1",
  "language": "en",
  "sourceContentDigest": "<sha256>",
  "importedAt": "<ISO-8601>"
}
```

模板文件白名单、Draft 存储/读取、前端资产编辑、TeamVersion 导出和规范包摘要必须一起升级。`source.json` 若作为角色包文件，应纳入白名单、大小/路径限制和摘要；若采用模板/角色包元数据，则该元数据必须进入同一不可变发布摘要，并随 TeamVersion 导出。不能仅在页面显示来源而不固定来源记录。

上游模板快照与 Team Draft 是两种不同资源：前者以来源 commit 为版本，不允许编辑；后者属于 Team，可编辑。发布 TeamVersion 时只依赖 Draft 快照及其摘要，不在运行时解析模板或 Git 源。

## Markdown 适配规则

Agency Agents Markdown 适配器的输入是受限 Markdown 数据格式，不是可执行 Agent 配置。

1. 解析开头的 YAML front matter，使用安全 YAML 解析器，不允许自定义标签、对象实例化或执行表达式。front matter 缺失、重复键、格式错误或类型不符合约定时，索引条目标记为不支持/解析错误并保留可诊断原因，不猜测字段。
2. `name`、`description`、`color`、`emoji`、`vibe` 等识别出的元数据单独存放。允许未知的纯标量元数据留在原始来源快照中；只将有明确定义的字段映射到展示元数据。元数据不得重复拼入角色指令正文。
3. `agent.md` 保留 front matter 之后的正文：去除 front matter 结束分隔行及紧随其后的结构性换行，之后的正文内容（包括空白和换行）原样保留，不重写段落、标题、列表、引用或代码块。转换器不摘要、不翻译、不“清理”上游指令。原文件仍保存在来源快照，可供逐字对照。
4. `role.json` 生成当前版本 OGSystem Role Contract：Team 内角色 ID、名称、职责/用途、输入前置条件、输出事件、权限、约束、失败策略、审计要求，以及 prompt/schema 引用。上游 description 可作为初始职责说明；输入、事件、权限、失败策略和审计字段不得从普通 Markdown 推断为已授权契约。
5. 复制向导要求用户确认本 Team 流程中的输出事件，并确认允许工具。事件集合必须与该角色在 Team 图中的有效出边一致；工具权限默认空，且只能从 Team 管理员明确允许的工具中选择。用户未完成确认时允许保存 Draft，但角色标记为未验证，不允许发布或执行。
6. `prompt.md` 由当前 Runtime 支持的模板生成器产生。所有模板变量通过共享的 Runtime 模板定义验证；适配器不得沿用外部 Agent 平台专有变量。没有必要的变量不添加占位符。
7. `output.schema.json` 根据确认后的事件集合和每个事件的数据结构生成。Schema 中事件枚举与 `role.json.outputs.events` 完全一致；事件 payload 定义来自 OGSystem 输出契约，不照抄上游文档中的任意示例 JSON。
8. 来源语言显式记录。语言识别不能可靠确定时标为 `und` 并提示用户，而不是仅凭文件夹名猜测。翻译来源是独立来源、独立版本，记录其上游地址、commit、路径、语言以及可选的原文来源关联；不得覆盖英文来源。

## Agency Agents 适配抽样

上游地址：[msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)。方案编写时 `main` 的核验 commit 为 `b37b5bb33b78f2c1d6567d98e25ca818e3259219`。固定回归样例从该 commit 取文件，避免跟随 `main` 漂移。升级 fixture 时先审查上游差异，再有意更新锁定 SHA 和期望结果。

| 类别 | 固定样例路径 | Front matter 核验值 | 适配覆盖点 |
| --- | --- | --- | --- |
| engineering | `engineering/engineering-frontend-developer.md` | `name: Frontend Developer`；含 description、color、emoji、vibe | 正常 front matter；正文含多级标题、列表、规则和代码块；验证正文保真和元数据分离 |
| design | `design/design-ux-researcher.md` | `name: UX Researcher`；含 description、color、emoji、vibe | 长正文、方法步骤和多个模板代码块；验证只分离头部元数据，不误删正文模板 |
| testing | `testing/testing-accessibility-auditor.md` | `name: Accessibility Auditor`；含 description、`color: "#0077B6"`、emoji、vibe | 引号包裹的颜色标量和 emoji；验证 YAML 类型与 Unicode 展示信息保真 |
| support | `support/support-support-responder.md` | `name: Support Responder`；含 description、color、emoji、vibe | 不同类别/文件名前缀；验证分类映射与目标 role ID 不依赖原始文件名猜名字 |
| specialized | `specialized/specialized-mcp-builder.md` | `name: MCP Builder`；含 description、color、emoji、vibe | 专业集成说明；验证外部工具/MCP 能力文字不会自动转换成 OGSystem 工具授权 |

角色仓库 UI 可以按来源特点呈现角色，但展示层使用适配器输出的受限展示元数据，不把来源格式泄漏成统一目录结构。列表和详情应保留基本可扫描信息（名称、类别、来源、语言、commit、更新时间），并可按来源增加标识或短描述。Agency Agents 将 `emoji` 映射为列表和详情中的图标；`color` 仅可映射到受限的展示色值，不影响权限、执行或合同语义。没有来源图标时显示 Team Site 内置的类别图标或通用角色图标，并保留可访问名称。

上游图标按不可信数据处理：优先支持 emoji/纯文本符号或由适配器映射到内置图标 key；不得直接执行/内嵌上游 SVG、HTML、脚本，也不得自动请求任意远程图像 URL。渲染时转义文本、限制长度，并为图标提供角色名称等可访问标签。原始元数据和来源文件仍保留在来源快照以便追溯。

这些样例覆盖已核验的 front matter 基本结构、跨类别路径、Unicode/引号值、长篇正文与代码块，以及必须由用户显式决定的权限边界。不能据这五个文件推断全仓库格式只有一种；索引器还需要错误 fixture 和结构变体 fixture。当前仓库锁文件曾记录旧同步 commit `54573734191790031cfe294c98d2a6b002136956`，该记录是历史同步证据，不作为本次 fixture 的基准。

每个固定样例应由以下资料组成：锁定上游 SHA、原始 Markdown、解析后的 front matter 预期值、front matter 之后正文的 SHA-256、转换结果 fixture、来源记录 fixture，以及人工复核记录。测试不能通过对转换器重新运行并生成期望值来“自证正确”；预期正文摘取、元数据映射和合同差异由人工审阅后固定。

## 统一校验与可用性

Team Site 和 Runtime 应共享同一 Role Contract 结构校验实现/版本，避免两套规则漂移。共享代码只依赖角色包合同，不依赖 Team Site、Git 或 UI。Team Site 在它之上增加 Team 上下文校验；Runtime 在加载时验证标准包、摘要和运行约束。发布和运行都必须 fail closed。

标准包校验至少检查：

- 必需文件存在且 manifest 引用路径安全、有效；文件数、文件大小、总包大小和摘要符合限制。
- `role.json` 合同版本、字段、枚举和类型符合 Runtime 支持版本；角色 ID 唯一并符合各自存储域的 ID 规则。
- `prompt.md` 只使用 Runtime 注册的模板变量；缺失或未知变量均报错。
- `output.schema.json` 是有效 JSON Schema，且事件和事件 payload 与 `role.json` 声明一致。
- Team 发布上下文中，角色输出事件与该角色有效出边一致；所有目标和终结事件都可解析。
- `allowedTools` 仅包含 Team 明确允许且 Draft 配置存在的工具；缺失确认时权限为空且状态未验证。
- 来源路径为仓库内规范相对路径，拒绝绝对路径、`..`、符号链接逃逸和危险文件类型；来源摘要与固定源快照一致。
- Draft 可以保存不完整包，并显示可定位的校验错误；未通过统一校验或仍未验证的角色不得发布或运行。
- 发布完成后，来源记录、四个运行时文件、Team 拓扑、合同版本与摘要均属于不可变 TeamVersion 输入。

如果允许已验证 Draft 做设计期模拟，模拟运行仍须运行同一角色包校验，并拒绝未验证角色；“Draft”身份本身不应绕过校验。

## Team Site 工作流

1. 管理员在“平台配置 > 角色源配置”登记来源 ID、Git URL、分支和适配器；来源概览显示更新时间与同步状态，不展示 Git 地址和分支。来源 ID、Git URL、分支及适配器不可变；可修改显示名称和启用状态。
2. 管理员手动启动后台同步或重新索引。页面展示运行、成功、失败状态和最近成功更新时间；来源登记和启停不触发同步。
3. 角色库只加载已生成的角色快照，按角色文件首层 Git 目录分类，展示名称、图标、说明、语言、来源版本、更新时间和适配状态。不得把 Git 目录当作主要浏览层级，也不提供 Git 来源配置或更新控件。
4. 详情页展示来源元数据、原始说明预览和解析诊断。预览按纯文本/Markdown 渲染，转义 HTML，不执行脚本或远程资源。
5. 用户选择“复制到 Team”，选定 Team Draft 和目标 role ID；向导预览生成包并要求确认事件、工具权限和语言变体。
6. 转换后写入 Draft，保留独立副本和来源记录；显示验证状态。之后的编辑只作用于 Draft 副本。
7. 发布 TeamVersion 前执行包校验、Team 出边一致性校验、权限校验和既有发布证据流程。校验失败时不产生可运行版本。
8. Runtime 从不可变 TeamVersion 加载包，不访问上游 checkout、模板目录或当前来源索引。

## 实施阶段

### 阶段 A：共享契约与适配器（完成）

- [x] Team Site 发布就绪检查与 Runtime loader 共用 Role Contract、prompt 变量、JSON Schema 和来源证明校验逻辑。
- [x] 实现安全 front matter 解析、逐字保留正文、未确认状态和稳定来源记录；按当前合同创建新包，不迁移旧来源数据。
- [x] 固定五个 Agency Agents 上游 fixture，并覆盖缺失/非法/重复 front matter、错误类型、超限、恶意路径及未知模板变量等失败场景。

### 阶段 B：来源同步与索引（完成）

- [x] 实现 Team Site 独立来源配置、Git checkout、快进同步、手动刷新索引和按 commit 保存的不可变索引。
- [x] 动态发现新 Git 目录和嵌套 Markdown，按首层目录分类；记录候选/可用/未适配统计，并明确上游没有权威全量 role 清单。
- [x] 同步/索引失败时保留上一次有效索引；按来源串行化更新，重复 commit 幂等，拒绝 dirty checkout 和非快进更新。
- [x] 不向 `sync-agent-sources.mjs` 加入 Team Site 运行时职责；同步只读取 Git blob，不执行 hooks、子模块、过滤器或仓库脚本。

### 阶段 C：浏览、复制与 Draft 集成（完成）

- [x] 提供按角色浏览、Git 目录分类及筛选、来源/语言筛选、原文预览、解析诊断、来源特性展示、安全图标和历史 commit 选择；Git 更新操作在平台配置页管理。
- [x] 角色仓库页移除并列的旧手工模板发布区，聚焦 Git 角色发现和转换；角色列表及底部操作通过页面滚动验收。
- [x] 提供复制向导；Team 拓扑事件和工具权限需要显式确认，服务端校验实际出边和 Team 工具清单，来源语言只读。
- [x] 将 `source.json` 纳入不可变模板、Draft 资产、TeamVersion 导出包和摘要；普通角色编辑允许原样回传但不能修改来源证明。
- [x] 相同来源副本不会静默覆盖已有 Draft，冲突时返回明确错误。

### 阶段 D：发布和运行闭环（完成）

- [x] Team 发布就绪检查对每个角色执行共享包校验、运行时变量/Schema 检查、来源确认检查和 Team 出边校验；不完整 Draft 可保存但不可发布或运行。
- [x] Runtime 只消费标准角色包；未确认来源证明、无效包和不支持的变量会 fail closed，来源文件随 TeamVersion 执行文件摘要固定。
- [x] Runtime loader、来源角色输出 Schema 校验和 Team Studio 模拟执行路径均有自动覆盖；发布与执行不会读取上游 Git checkout。

### 阶段 E：平台配置与手动后台更新（完成）

- [x] 导航改为“平台配置 > 模型服务 / 角色源配置”，角色源管理从角色浏览页移出。
- [x] 手动更新和重新索引作为 Team Site 后台任务执行，状态与最近成功时间持久化；没有启动同步或周期定时任务，服务重启会恢复中断状态。
- [x] 角色源概览不显示 Git 地址或分支；角色仓库只读加载当前快照，展示状态、更新时间和上游清单完整性提示。
- [x] 来源显示名称和启用状态可修改；来源 ID、Git 地址、分支和适配器身份不可变。
- [x] 覆盖手动后台任务状态、失败保留旧快照、Tailnet/loopback 管理访问、配置页浏览器流程和真实 Team 三案例转换验证。

### 安全验证

- Git URL 仅接受 HTTPS 公网地址；同步前检查 DNS 结果并在 Git/libcurl 请求中固定解析地址、禁用重定向和代理，拒绝 URL 重写、凭据助手、代理、钩子及过滤器设置。
- 来源登记和 Git 更新接口只接受 loopback 或 Tailnet 来源；角色图标只渲染受限 emoji 或内置图标 key，原文预览使用文本节点，不执行 HTML、脚本或远程图片。
- `source.json` 是受保护来源证明；其内容进入 Draft 快照和 TeamVersion 摘要，来源记录变更会使包校验或摘要验证失败。

### 自动验证结果

- `pnpm build` 通过。
- `node --test --test-concurrency=1 apps/team-site/tests/*.test.mjs` 通过：420 项测试，0 失败；`pnpm build` 与 `pnpm run test:docs-command-drift` 通过。
- 来源目录、适配器、Runtime 角色包和来源浏览器定向测试通过；五个 Agency Agents fixture 均与锁定 commit 的上游 raw 文件逐字节一致。
- 真实 Team Site 浏览器流程至少覆盖三个场景：角色自动转换并写入 Team Draft、事件与 Team 出边不符时拒绝、未确认副本不能通过发布就绪检查。

## 验收标准

- 能同步 Agency Agents 指定分支的新 commit；非快进更新失败时旧索引仍可用。管理员手动更新 checkout 后，“刷新索引”能检出变化。
- 以锁定 commit 中五个代表样例验证元数据准确映射；front matter 不进入 `agent.md`，正文 SHA 与上游去除 front matter 后的预期一致，代码块/标题/列表没有丢失或改写。
- 对负向 fixture 给出稳定、可定位错误；上游脚本和其他可执行内容在同步/索引/预览/转换期间从未执行。
- 角色库按角色及 Git 首层目录分类展示 commit 和语言；目录类别可动态扩展。页面展示候选、可用、未适配数量并注明无权威完整清单；同步最新 commit 后旧来源快照及 TeamVersion 摘要不变。
- 复制流程能保存未完成确认的 Draft，但发布和运行都被拒绝；确认事件后与 Team 实际出边一致，默认无工具授权，明确允许的工具才会进入包。
- 编辑 Team Draft 副本不改变上游源、源快照或角色模板；后续 pull 不改变 Draft。
- 校验覆盖文件/manifest、合同字段、Runtime 变量、Schema/事件对应、Team 出边、工具白名单、ID 冲突、路径安全、限制值和摘要。
- 发布 TeamVersion 后检查其归档内容包含角色资产、来源证明、合同版本及摘要；之后更新上游或适配器不能改变已发布包。
- 用发布后的 TeamVersion 通过 Runtime loader 加载副本，完成一次模拟执行并产生符合 Schema 的输出事件；篡改任一包文件或来源记录会导致摘要/校验失败。
- 中文翻译或语言变体以独立来源/版本保存，标记语言和原文关联；翻译不会覆盖英文来源，且通过同一套角色包与 Team 校验。

## 主要实现文件

- 当前适配器参考：`tools/agent-source/importers/generic-markdown.mjs`、`tools/agent-source/importers/agency-agents.mjs`
- 现有仓库同步工具（非 Team Site 实现）：`tools/agent-source/sync-agent-sources.mjs`
- 不可变角色模板：`apps/team-site/infrastructure/file-shared-resource-store.mjs`
- Draft 角色资产：`apps/team-site/infrastructure/file-team-design-asset-store.mjs`
- 共享资源边界：`docs/development/shared-resource-architecture.md`
