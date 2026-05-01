# OGSystem Empty Project Visual Lifecycle Solution - 2026-05-01

## 目标

从一个空项目开始，通过可视化能力完成项目创建、系统框架构建、角色和流转细化、试运行、校验发布，并导出可独立运行的项目包。

本方案强调两点：

- 可视化生成不只是图编排。必须支持通过交互对话调整 `system.mmd` 的框架结构，再通过图工作区和 Inspector 细化角色、连线、模型、Profile、review、route、join、loop 等能力。
- 不改变内核语义。parser、compiler、runtime 继续消费确定的项目文件和 `system.mmd`，可视化层只负责生成、校验、冻结和展示这些文件。

## 不影响内核的边界

以下能力属于 Visualizer / Studio / Release 外层产品能力，不进入内核语义：

- Project Wizard 生成项目壳和 authoring draft。
- 框架结构对话生成结构化 `StudioAuthoringDocument`。
- 图工作区编辑角色和流转。
- Inspector 编辑模型引用、Profile、role package、review、route、join、loop、context map。
- Dry Run 前在现有 run artifact 语义上补充 snapshot manifest。
- Release 时基于明确 contract 生成 release manifest 和独立运行包。
- Operate 优先复用 runDir 中已有历史 artifact，结合 snapshot manifest 渲染历史运行的只读图和详情。

以下能力不得在本方案中修改：

- Mermaid parser 语法和语义。
- Compiler 输入输出契约。
- Runtime 执行状态机、事件语义、分支和 join 语义。
- 角色执行器、模型选择、Profile 执行语义。
- 现有 `system.mmd` 作为 runtime truth 的地位。

可视化层的 authoring draft 是编辑真相，生成后的 `system.mmd` 是运行真相。内核只消费运行真相。

## 必须修正的架构约束

### 空项目不得写入真正空的运行源

当前 Visualizer、project readiness、server API 均默认项目目录存在可读、可解析的 `system.mmd`。因此 Project Wizard 创建项目时不得让真正空的 `system.mmd` 进入当前项目加载路径。

推荐规则：

- 创建后必须生成“最小可解析草稿”，哪怕用户选择空白模板。
- 空白模板的最小可解析草稿可以使用 noop 或最小单角色结构，但 UI 必须标识为“草稿 / 未绑定 / 不可发布”状态。
- 如果用户还没有完成业务结构，应在 UI 状态上标记“未生成运行源”或“草稿未保存”，而不是写入空文件。
- Build 可以显示“尚未生成可运行系统”的业务状态，但 parser/readiness 路径始终看到可解析输入。
- `system.mmd` 是否可运行由 validation/readiness 判断，不通过空文件表达。

### run snapshot 必须复用现有 run artifact

当前 run 目录已经保存运行时使用的 `system.mmd`，Operate 也存在从 runDir 读取历史 `system.mmd` 的逻辑。新方案不得另起一套和 run artifact 平行的历史系统。

推荐规则：

- 继续以 runDir 中的 `system.mmd` 和现有运行 artifact 作为历史运行事实来源。
- 新增 `snapshotId`、`sourceHash`、`authoringDigest`、manifest 等字段时，应作为 run artifact 的补充索引和摘要。
- Operate 渲染历史图时优先读取 run artifact 中的运行源，再使用 manifest 摘要增强展示。
- 如果 manifest 和 run artifact 不一致，应以 run artifact 为准，并显示一致性诊断。

### Project Wizard 必须复用受控项目初始化能力

Visualizer 不应直接手写 `.ogs/project.json`、`profiles.json`、`tools.json` 等文件。Project Wizard 应调用受控 API，由后端复用现有 lifecycle/project init 逻辑，再写入 Studio authoring draft。

推荐规则：

- 新增 Project Wizard API，而不是在前端直接写文件。
- API 内部复用现有 project lifecycle / project init 能力。
- Studio authoring draft 作为项目初始化后的附加产物写入。
- 所有创建、导入、加载动作都要有明确 UI 状态和错误反馈。

### 空目录模式必须保护项目独立性

当 visualizer 绑定到一个尚未初始化的空目录或非项目目录时，只有 Project 页可以提供创建或加载项目的写入入口。其他生命周期页不得显示可执行的写入型动作。

推荐规则：

- Build 显示“尚未创建或加载项目”的空状态。
- Validate & Release 显示“需要项目上下文后才能校验和发布”的空状态。
- Operate 显示“暂无项目和运行记录”的空状态。
- Generate MMD、Save、Dry Run、Export、Resume、Stop 等需要项目上下文的动作必须隐藏或禁用，并给出原因。
- 空目录模式下不得创建临时 `system.mmd`、`.ogs/` 或 runs 目录，除非用户在 Project Wizard 中确认创建项目。
- Project Wizard 创建目标目录时必须检查冲突：如果目录非空但不是 OGSystem 项目，应提示用户选择“在当前目录初始化”“选择其他目录”“加载已有项目”，不得默认覆盖已有文件。

### Project Create API 必须有稳定错误契约

`POST /api/v1/project/create` 是 Project Wizard 的关键写入入口。正式落地前需要定义幂等和冲突响应码，避免前端只能展示原始工程错误。

建议错误契约：

```text
400 INVALID_PROJECT_ID
400 INVALID_PROJECT_NAME
400 INVALID_PROJECT_TEMPLATE
400 INVALID_PROJECT_WORKDIR
409 PROJECT_ALREADY_EXISTS
409 PROJECT_DIR_CONFLICT
409 PROJECT_FILE_CONFLICT
422 PROJECT_TEMPLATE_UNAVAILABLE
500 PROJECT_CREATE_FAILED
```

建议语义：

- `PROJECT_ALREADY_EXISTS`：目标目录已经是 OGSystem 项目，前端应提示“加载已有项目”。
- `PROJECT_DIR_CONFLICT`：目标目录非空但不是 OGSystem 项目，前端应提示“在当前目录初始化 / 选择其他目录 / 加载已有项目”。
- `PROJECT_FILE_CONFLICT`：将要写入的文件已存在且不会被覆盖，前端应列出冲突文件。
- `INVALID_PROJECT_ID` / `INVALID_PROJECT_NAME`：前端应定位到对应字段并给出可修正提示。
- `PROJECT_TEMPLATE_UNAVAILABLE`：模板不存在或安装包资源不可用，前端应允许重新选择模板。

幂等建议：

- 相同 requestId 重试同一创建请求时，应返回同一结果或明确的 already-created 响应。
- 创建中途失败不得留下半初始化项目；如果无法回滚，必须返回可读的 remediation 提示。
- 前端错误态必须使用用户可执行文案，不直接暴露 stack trace、内部路径或底层异常。

### 模板和角色资源必须来自安装包 catalog

安装后的 `ogsystem` 包已经包含 CLI、Studio 模板和 `og-roles/roles/**` 角色资源。Project Wizard 可以查询和导入这些资源，但必须通过后端 catalog/API 完成，不能让前端直接读 `node_modules` 或直接复制文件。

推荐规则：

- Studio 模板继续通过受控 API 暴露，例如 `GET /api/v1/project/studio/templates`。
- 安装包内角色资源应通过新增 catalog API 暴露，例如 `GET /api/v1/project/role-catalog?source=installed`。
- 用户选择安装包角色后，通过受控 import API 导入当前项目，例如 `POST /api/v1/project/roles/import`。
- 后端导入逻辑应复用现有 project lifecycle 的角色包导入能力，与 `ogs project sync --system system.mmd` 同源。
- Project Wizard 只展示 roleId、名称、摘要、来源、版本/摘要 hash、健康状态，不暴露安装路径。
- 已导入项目的角色包和安装包 catalog 要区分来源：`project`、`installed`、`external`。

### Release Package 必须先定义 manifest contract

独立运行包是新的发布 contract。当前 bundle/export 能力更接近项目 JSON 导出，不应直接扩展成半定义状态的独立运行包。

推荐规则：

- 先定义 manifest schema、hash 规则、artifact scope、requiredEnv 规则。
- 再实现导出按钮和包结构。
- UI 只展示 manifest preview 和 readiness gate，不在 contract 未定时承诺“可独立运行”。

### 框架结构对话必须结构化优先

框架结构对话可以是表单、向导，也可以未来接入 AI/NL，但所有输出必须是结构化 `StudioAuthoringDocument` patch。

推荐规则：

- 不直接拼接 Mermaid 文本。
- 所有生成结果必须经过 authoring validation。
- 生成 `system.mmd` 后必须经过 Mermaid validation。
- 只有 validation 通过或明确为 warning-only 时，才允许进入 Save、Dry Run、Release。

### 新增 UI 必须同步 i18n 和 browser smoke

Project Wizard、Build framework panel、Inspector、snapshot view、release package 都会新增大量文案和交互。

推荐规则：

- 每个 Phase 必须同步 `en` 和 `zh-CN` 字典。
- 每个 Phase 必须补 Playwright 或等价 browser smoke。
- 机器标识符不翻译，例如 roleId、flowKey、eventType、runId、modelRef、profileId、snapshotId。

## 最佳体验原则

- 四入口保持稳定：Project、Build、Validate & Release、Operate。
- Project 面向当前最新项目，不做复杂历史版本管理。
- Build 面向当前草稿，支持框架结构编辑、图编辑、源码兜底。
- Dry Run 可以和 Build 一体，但运行前必须在现有 run artifact 基础上冻结不可变 snapshot manifest。
- Validate & Release 面向当前可发布草稿，统一展示和阻断 readiness。
- Operate 不用当前最新项目解释旧运行，必须优先使用 run snapshot。
- 用户不应看到底层图技术名。界面使用“图编排”“图工作区”“角色”“流转”等业务文案。
- 所有会写磁盘的动作必须明确说明写入对象，例如 authoring draft、`system.mmd`、release artifact。
- 不做后台隐式创建。需要创建项目、生成 MMD、保存、试运行、导出时，都应有明确按钮、状态和结果反馈。
- 异常和问题必须可读、可定位、可执行，避免只展示内部错误码或底层异常。

## 推荐生命周期

### 0. 空目录启动入口

目标体验应允许用户在一个完全空的工作目录中先启动可视化控制台，再通过 Project Wizard 创建项目。

推荐命令：

```bash
mkdir my-ogs-project
cd my-ogs-project
ogs visualizer --workdir . --port 3337
```

源码仓库开发态等价命令：

```bash
mkdir my-ogs-project
cd my-ogs-project
pnpm --dir /path/to/OGSystem run run:visualizer -- --workdir "$PWD" --port 3337
```

启动后目标 UI 行为：

- Visualizer server 可以在空目录启动，不因缺少 `.ogs/` 或 `system.mmd` 直接退出。
- Project 页显示“此目录尚未初始化为 OGSystem 项目”。
- 主 CTA 是“创建项目”，次要动作是“加载已有项目”。
- Build、Validate & Release、Operate 显示明确空状态，并禁用需要项目上下文的写入型动作。
- 点击“创建项目”进入 Project Wizard。
- Project Wizard 通过受控后端 API 调用现有 project lifecycle / project init 能力。
- 创建成功后，当前 visualizer 绑定到同一个 workdir，刷新 Project、Build、Validate & Release 状态。
- Build 默认进入图编排视图，并显示空白模板草稿的“草稿 / 未绑定 / 不可发布”状态。

空目录启动不得触发后台隐式初始化。启动 visualizer 只是打开控制台；真正写入项目文件必须发生在用户点击“创建项目”并确认配置之后。

如果用户选择的目标目录非空但不是 OGSystem 项目，Project Wizard 必须显示冲突处理选项：

- 在当前目录初始化。
- 选择其他目录。
- 加载已有项目。

不得默认覆盖目录内已有文件。

当前实现尚未完成该目标入口时，可以使用 CLI 兜底路径：

```bash
mkdir my-ogs-project
cd my-ogs-project
ogs project init --template empty
ogs visualizer --workdir . --port 3337
```

兜底路径只用于当前过渡期。正式产品体验应从空目录 visualizer 直接进入 Project Wizard，而不是要求用户先在终端执行 `ogs project init`。

### 1. Project: 新建空项目

Project 页提供“新建项目”向导，支持：

- 项目名称、项目 ID、工作目录。
- 模板选择：空白、单角色、审核流、多角色协作、自定义。
- role package 来源：当前项目角色包、共享 role 仓库、稍后选择。
- 默认模型选择。
- 默认 Profile 策略：使用已有 Profile、创建新 Profile、稍后绑定。
- 默认入口角色策略：不创建入口角色、创建示例入口角色、从模板生成入口角色。

Project Wizard 通过受控后端 API 创建项目。API 内部复用现有 project lifecycle / project init 能力，再附加 Studio authoring draft。前端不得直接写 `.ogs/project.json`、`profiles.json`、`tools.json`。

创建后项目应具备：

```text
.ogs/project.json
.ogs/drafts/studio-authoring.json
system.mmd
profiles.json
tools.json
role package refs
```

空白项目也必须生成最小可解析草稿，不能写入真正空的 `system.mmd`。该草稿可以使用 noop 或最小单角色结构，但必须在 UI 上标识为“草稿 / 未绑定 / 不可发布”。如果用户还没有完成业务结构，Build 页用状态标记“未生成运行源”或“草稿未保存”，而不是让空文件进入 parser/readiness 路径。

### 2. Build: 框架结构对话

Build 首屏应先支持“系统框架”对话或面板，用结构化表单调整 `system.mmd` 的框架元数据：

- `system.id`
- `system.version`
- `entry.role`
- `law.global`
- handoff mode
- handoff contracts
- 默认起始事件和完成事件。
- 是否启用 review。
- 是否启用 route。
- 是否启用 join。
- 是否启用 loop。
- 默认绑定策略：model、exec、noop。

这些编辑先写入 `StudioAuthoringDocument` patch，不要直接用字符串拼接 `system.mmd`。无论是表单、向导还是未来的 AI/NL 对话，最终输出都必须经过 authoring validation；生成 `system.mmd` 后还必须经过 Mermaid validation。

### 3. Build: 图编排和 Inspector 细化

框架结构确定后，用户进入图工作区：

- 图上新增、删除、重命名角色。
- 图上新增、删除、编辑流转。
- 点击角色弹出角色编辑表单。
- 点击连线弹出流转编辑表单。
- 选择角色后，Inspector 展示 role package、模型、Profile、review、route、join、loop、context map。
- 选择连线后，Inspector 展示事件类型、错误流、join 参与关系、source/target。

角色新增体验需要区分：

- 从当前项目角色包选择。
- 从共享 role 仓库选择。
- 自定义角色。

当用户选择“自定义角色”时，不应继续强提示“角色包”是必填项。可以显示“未绑定角色包”状态，并提供后续绑定入口。

Profile 体验需要区分创建和编辑：

- 创建新 Profile 时由系统生成建议 ID，用户可编辑，但保存时生成的是新的 Profile 记录。
- 编辑角色时绑定的是已有 Profile ID，除非用户明确选择“创建新 Profile”。
- 不应把“创建 Profile 的建议 ID”和“绑定已有 Profile ID”混为一个字段。

### 4. Generate MMD 和 Save

Build 顶部主动作保持清晰：

- Validate
- Generate MMD
- Save
- Dry Run

推荐语义：

- `Generate MMD`：从 authoring draft 生成规范化 `system.mmd` 内容。
- `Save`：将当前 `system.mmd` 写入磁盘。
- `Validate`：校验当前草稿或已生成源码。
- `Dry Run`：保存必要输入，在现有 run artifact 基础上写入 snapshot manifest，然后启动试运行。

源码视图作为兜底能力保留。用户手工修改源码后，应支持重新导入为 authoring draft，并提示可能覆盖可视化 draft 的结构。

### 5. Validate & Release

Validate & Release 面向当前最新草稿或已保存项目，展示分类 checklist：

- Source validity: Mermaid parse、compile、diagnostics。
- Project readiness: role package、model、Profile、tool、contracts。
- Release blockers: dirty state、unresolved bindings、missing contracts、unhealthy packages、artifact contract。
- Evidence: readiness report、manifest preview、export scope。

导出阻断必须和 UI 展示使用同一个 readiness decision，避免用户看到风险但仍能导出。

### 6. Dry Run: 基于 run artifact 冻结轻量 snapshot manifest

试运行前自动生成不可变 snapshot manifest。这个 manifest 不是历史项目 UI，也不是替代 run artifact 的平行系统，而是运行记录解释所需的最小索引和摘要。

现有 run artifact 继续作为历史运行事实来源：

```text
runDir/
  system.mmd
  logs/
  artifacts/
  audit/
  ...
```

新增 manifest 应写入 runDir 或与 runDir 强绑定：

建议字段：

```text
snapshotId
projectId
systemVersion
snapshotKind = draft
sourceHash
artifactHash
systemMmdPath
authoringDigest
profileRefs
toolRefs
modelRefs
rolePackageRefs
createdAt
createdBy
```

运行记录绑定：

```text
runId
projectId
snapshotId
systemVersion
sourceHash
startedAt
status
```

这样 Project 和 Build 可以始终只展示最新项目，而 Operate 可以准确解释旧运行。

一致性规则：

- Operate 优先读取 runDir 中实际保存的 `system.mmd`。
- manifest 的 `sourceHash` 用于校验 runDir 中的 `system.mmd`。
- hash 不一致时显示诊断，并以 run artifact 为准。

### 7. Release: 导出独立运行包

独立运行包需要先定义 release manifest contract，再实现 UI 和包结构。发布导出最终生成：

```text
ogs-package/
  manifest.json
  system.mmd
  profiles.json
  tools.json
  model-selection.json
  role-packages/
  contracts/
  readiness-report.json
  run.json
  run.sh
```

`manifest.json` 建议包含：

```text
projectId
releaseId
systemVersion
snapshotId
sourceHash
artifactHash
entryRoleId
rolePackageRefs
profileRefs
toolRefs
modelRefs
requiredEnv
createdAt
```

独立运行包不得包含密钥。只声明 `requiredEnv`，由部署环境注入。

manifest contract 至少需要先定义：

- schema version。
- hash 算法和规范化输入。
- artifact scope。
- requiredEnv 规则。
- role package 打包方式。
- profiles/tools/model-selection 的引用和复制规则。
- readiness report 的阻断和 warning-only 规则。

### 8. Operate: 按运行快照展示

Operate 默认展示运行列表和当前选中运行：

- runId
- 状态
- 项目版本
- snapshotId 或 sourceHash
- draft/release 标记
- 开始时间

点击运行详情时：

- 优先用 run artifact 中的 `system.mmd` 渲染只读图。
- 用 snapshot manifest 展示当时的角色、流转、模型、Profile、role package 摘要。
- 日志、审计、失败分析按 runId 加载。
- 不读取当前最新项目来解释旧运行。

如果 snapshot 缺失，Operate 应显示明确降级提示：

```text
该运行缺少 snapshot manifest，将使用 run artifact 中保存的运行源展示历史图。当前项目结构不会用于解释该历史运行。
```

## 当前项目的推荐优化路线

采用“最新项目 + 运行轻量快照”的折中路线：

- Project 只管理当前最新项目。
- Build 只编辑当前最新草稿。
- Validate & Release 只发布当前最新可发布草稿。
- Operate 展示所有运行，但每个运行使用自己的 snapshot。

这比完整历史项目管理更简单，也比“只存日志，不存快照”更可靠。

## 一致性保障

该方案可以保持一致性，前提是所有项目写入都通过同一组受控后端能力完成，而不是由 Visualizer 前端直接写文件。

一致性来源：

- Project Wizard 复用 project lifecycle / project init。
- 模板列表来自 Studio template API。
- 安装包角色 catalog 来自已安装 `ogsystem` 包内的 `og-roles/roles/**`。
- 角色导入复用 project lifecycle 的角色包导入和 sync 能力。
- `system.mmd` 仍是 runtime truth。
- Dry Run 和 Operate 复用现有 run artifact。
- Release 先定义 manifest contract，再导出独立运行包。

需要新增的受控 API：

```text
GET  /api/v1/project/role-catalog?source=installed
POST /api/v1/project/roles/import
POST /api/v1/project/create
```

建议响应字段：

```text
roleId
name
summary
source = installed | project | external
installedPackageVersion
digest
hasRoleJson
hasPrompt
hasOutputSchema
health
alreadyImported
```

导入规则：

- 导入前只查询 catalog，不写项目文件。
- 用户确认导入后，后端复制安装包内角色包到当前项目 role repo。
- 已存在同名角色时不覆盖，除非用户明确选择 replace 或 import-as。
- 导入后刷新 Project Readiness、role packages、Build Inspector 可选项。
- 导入结果写入 audit/flash，说明导入了哪些 roleId，跳过了哪些已存在角色。

这样可以支持“通过安装的包查询和导入角色/模板资源”，同时保持和 CLI、project lifecycle、runtime artifact 的一致性。

## 实施拆分

本轮落地状态：

- 空目录 Project Wizard、受控创建 API、空状态禁用、冲突错误态、安装包角色 catalog/import、最小可解析空白模板、authoring draft、创建后进入 Build 图工作区已实现并通过回归。
- Dry Run snapshot 与 Release Package 先落最小 manifest contract：`snapshot-manifest.json` 写入 runDir，release export 返回 `releaseManifest`，继续以 run artifact 中的 `system.mmd` 作为历史事实来源，不改变 runtime/parser/compiler 语义。
- Project Wizard 已补充安装包角色 catalog 可视化选择，创建成功后通过受控导入 API 导入所选角色；`POST /api/v1/project/create` 已支持内存级 `requestId` 幂等重放；Operate Artifacts 已展示 snapshot manifest 基础摘要和 hash 校验状态。
- 框架结构和 Inspector 使用现有 Studio authoring command、Mermaid validation、Graph workspace 能力闭环；独立的 Build framework panel / 对话式结构化表单、完整独立运行包目录结构仍是后续产品增强，不作为本轮已完成项表述。

### Phase 1: 文档和产品边界

- [x] 明确 authoring draft、`system.mmd`、run snapshot、release manifest 的边界。
- [x] 明确不修改 parser/compiler/runtime 语义。
- [x] 明确空项目必须生成最小可解析 `system.mmd` 草稿。
- [x] 明确空白模板草稿可以使用 noop 或最小单角色结构，但 UI 必须标识为草稿、未绑定、不可发布。
- [x] 明确 snapshot manifest 与现有 run artifact 的关系。
- [x] 定义独立运行包 manifest schema、hash、requiredEnv、artifact scope。
- [x] 定义安装包角色 catalog API 和导入 API，确保与 `ogs project sync` 同源。
- [x] 定义 `POST /api/v1/project/create` 的冲突响应码、`requestId` 幂等重放和用户可读错误态。
- [x] 同步 en/zh-CN 文案。
- [x] 增加 browser smoke，覆盖方案中新增生命周期入口的空状态。

### Phase 2: Project Wizard

- [x] 允许 `ogs visualizer --workdir <empty-dir>` 在空目录启动并显示未初始化项目状态。
- [x] 空目录启动不隐式写入 `.ogs/`、`system.mmd` 或其他项目文件。
- [x] Project 页提供“创建项目”主 CTA 和“加载已有项目”次要动作。
- [x] Build / Validate & Release / Operate 在未创建或未加载项目时显示空状态。
- [x] Generate MMD、Save、Dry Run、Export 等写入型动作在空目录模式下隐藏或禁用。
- [x] Project Wizard 对非空非项目目录提供“当前目录初始化 / 选择其他目录 / 加载已有项目”冲突策略。
- [x] Project Wizard 根据 `PROJECT_DIR_CONFLICT`、`PROJECT_ALREADY_EXISTS`、`INVALID_PROJECT_ID` 等错误码展示稳定错误态。
- [x] 新建空项目向导。
- [x] 模板选择。
- [x] role package 来源选择。
- [x] 查询安装包角色 catalog，支持从 installed source 导入角色包。
- [x] 导入角色包走受控 API，不由前端复制文件。
- [x] 默认模型和 Profile 策略。
- [x] 通过受控 API 复用现有 project lifecycle / project init。
- [x] 生成最小可解析 `system.mmd` 草稿和 authoring draft。
- [x] 创建成功后自动刷新并绑定当前 visualizer workdir。
- [x] 同步 en/zh-CN 文案。
- [x] 增加 browser smoke，覆盖空目录启动、Build 空状态、禁用写入动作、空白模板创建和创建失败提示；目录冲突策略由 API/client 单元测试覆盖。
- [x] 增加 client/API 单元测试，覆盖安装包角色查询、Wizard 选择导入、导入拒绝、已存在角色跳过提示。

### Phase 3: Build 框架结构对话

- [ ] 独立 Build framework panel 支持系统 ID、版本、入口角色、law、handoff 结构化编辑。
- [ ] 独立 Build framework panel 支持 review、route、join、loop 开关和默认策略。
- [x] 从结构化 draft 生成 `system.mmd`。
- [x] 源码改动重新导入 authoring draft。
- [x] 所有表单或对话输出都经过 authoring validation。
- [x] 生成后的 `system.mmd` 经过 Mermaid validation。
- [ ] 同步独立 framework panel 的 en/zh-CN 文案。
- [ ] 增加 browser smoke，覆盖独立 framework panel 编辑、校验失败、生成成功。

### Phase 4: 图编排和 Inspector 完整可视化

- [x] 角色新增、编辑、删除。
- [x] 连线新增、编辑、删除。
- [x] 角色模型引用可视化。
- [x] Profile 创建和绑定分离。
- [x] role package 来源和自定义角色体验优化。
- [x] review、route、join、loop、context map 可视化编辑。
- [x] 所有角色/连线更新走 authoring command，不直接改 Mermaid 文本。
- [x] 同步 en/zh-CN 文案。
- [x] 增加 browser smoke，覆盖新增角色、编辑角色、创建 Profile、绑定已有 Profile、编辑连线。

### Phase 5: Dry Run Snapshot Manifest

- [x] Dry Run 前在 runDir 中写入 snapshot manifest。
- [x] 继续复用 run artifact 中的 `system.mmd` 作为历史运行事实来源。
- [x] 运行详情绑定 snapshotId、sourceHash，并保留 run artifact 事实源。
- [ ] Build Debug 显示本次试运行对应 snapshot。
- [x] Operate 校验 manifest sourceHash 与 run artifact 一致。
- [x] 同步 en/zh-CN 文案。
- [x] 增加 API 单元测试，覆盖 Dry Run 后 snapshot manifest 写入和 run artifact 事实源关系。

### Phase 6: Release Package

- [x] 先定义 release manifest contract。
- [x] Validate & Release 生成 release manifest。
- [ ] 导出完整独立运行包目录结构。
- [ ] readiness report 和 artifact 逐项 hash 写入 manifest。
- [x] 包内不包含密钥，只声明 requiredEnv。
- [x] 同步 en/zh-CN 文案。
- [x] 增加 client/API 单元测试，覆盖 release 阻断项、release manifest contract 和导出成功。

### Phase 7: Operate Snapshot View

- [ ] 运行列表显示版本和 snapshot 摘要。
- [x] 运行详情优先读取 run artifact 中的 `system.mmd`。
- [x] snapshot manifest 作为摘要和校验补充。
- [x] 只读图展示当时结构。
- [x] snapshot 缺失时在 Artifacts 中降级提示，并继续使用 run artifact 历史源。
- [x] 同步 en/zh-CN 文案。
- [x] 增加浏览器和 API 回归，覆盖试运行后的只读图入口、运行详情和 snapshot manifest 基础展示；snapshot 缺失/hash 不一致降级保留为后续 Operate 深化项。

## 验收标准

- 从空项目可以不写源码完成新建、构建、校验、试运行、导出。
- 可以在空目录中启动 `ogs visualizer --workdir .`，并从 Project 页显式创建新项目。
- 空目录启动不应隐式写入项目文件。
- 空目录模式下，Build / Validate & Release / Operate 不能执行需要项目上下文的写入型动作。
- 非空非项目目录必须提示冲突策略，不得默认覆盖已有文件。
- Project 创建 API 必须有稳定错误码，前端错误态必须可读、可定位、可执行。
- 空白模板也必须生成最小可解析 `system.mmd` 草稿，不能让空文件进入 parser/readiness 路径。
- Project Wizard 可以查询安装包内 Studio 模板和角色资源。
- 导入安装包角色时必须通过受控后端 API，复用 project lifecycle / sync 能力。
- 本轮可通过现有 Studio authoring / Workbench / Graph 能力调整 `system.mmd`；独立“框架结构对话 / framework panel”仍是后续任务。
- 用户可以通过图和 Inspector 细化角色、流转、模型、Profile、review、route、join、loop。
- 生成的 `system.mmd` 可被现有 parser/compiler/runtime 消费。
- Dry Run 在现有 run artifact 基础上生成 snapshot manifest，Operate 使用 run artifact + manifest 展示历史运行。
- Release 本轮先定义并导出最小 `releaseManifest` contract；完整独立运行包目录结构仍是后续任务。
- 默认体验不暴露底层图技术名。
- 所有写入动作都有明确按钮、状态和结果反馈。
- 不新增 runtime/parser/compiler 语义变更。
- 新增 UI 同步 en/zh-CN。
- 新增交互具备 browser smoke 覆盖。

## 回归要求

每个实现阶段至少运行：

```bash
pnpm exec tsc --noEmit
pnpm run test:visualizer
pnpm run test:visualizer-browser
```

涉及打包导出和运行包时，增加：

```bash
pnpm test
```

浏览器回归需要覆盖：

- 空项目创建。
- 框架结构对话生成 authoring draft。
- 图工作区新增角色和连线。
- 点击角色和连线进入编辑。
- Generate MMD、Save、Validate、Dry Run。
- Validate & Release 导出独立运行包。
- Operate 使用 snapshot 展示只读历史图。
