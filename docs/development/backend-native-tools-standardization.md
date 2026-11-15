# Backend 内置工具标准化与 Studio 极简配置方案

> 本文按 **OGS Contract Set v2** 解读。旧版 `constraints.allowedTools`、三档
> `Supervised / Auto-accept / Full access` 和技术 Permission Review 均已废弃，
> 不属于 v2 运行时或 Studio 配置模型。本文保留 Backend 能力调查和 Adapter 纯映射参考。

## 核心设计哲学

> **“底座决定工具集的物理上限；工具层面坚决避免自建，保持架构零负担、纯映射、极度轻量。”**

OGSystem 的核心定位是**多智能体拓扑编排、企业法则（Law）治理与可信交付物封签**，而不是底层工具的执行引擎。

在目标运行时，**“当选定模型底座（CLI / Backend）时，应该锁定可用工具集的物理边界”**。现代主流 Coding Agent（Claude Code、Codex、OpenCode、Pi、Cursor、Qwen Code 等）在本地代码编辑、终端执行及网络检索上已经提供成熟能力；OGS 只投影并验证实际接入 adapter 暴露的能力，不据此推断当前所有 backend 都已具备这些工具。

### 借鉴开源标杆：T3 Code 与 Orca 的架构精髓
本方案深入吸收了业界前沿开源 Agent 平台 **T3 Code (`pingdotgg/t3code`)** 与 **Orca (`stablyai/orca`)** 的成功经验：
1. **参考 T3 Code 的“BYOS 控制面”哲学**：
   - T3 Code 坚持作为 Agent Harness Control Surface，自身不写任何文件编辑算法或爬虫代码，完全信任底层 Agent 原生工具能力；
   - 通过中立协议（ACP）切分职责：底座提供原生工具与模型推理，上层负责项目工作区快照、任务委派和 OGS 的 allow/deny 策略映射。
2. **参考 Orca 的“Worktree 物理沙箱”哲学**：
   - Orca 作为底座无关包装器（Agent-Agnostic Wrapper），深刻践行“工具层越薄，物理隔离层越硬”的原则；
   - 在启用 Git 协作模式时，可将安全交给文件系统级物理隔离（每个并行任务独占 Git Worktree）；普通 Role 当前仍使用 per-execution staging。协调层只监听 `worker_done` 并做最终 Diff 审查与交付封签，绝不介入底层的编辑细节。

基于此，OGS 严格遵循以下五项铁律：
1. **底座反向约束工具集（Capability Projection，目标）**：工具选项不是全局静态任意挑选的，而是由角色绑定的 `modelRef` 所属底座动态投影出可选范围；MVP 先依赖已实现的 role contract 与 capability policy 门禁；
2. **OGS 零自建工具执行器**：OGS 不写文件编辑算法，不写网络抓取爬虫，不自建搜索引擎，坚决避免重复造轮子；
3. **纯映射与策略开关（Pure Mapping & Switch）**：OGS 只负责“意图声明（`toolId`） $\to$ 底座原生参数/网络沙箱开关透传”；
4. **刚性安全由现有基础设施兜底**：执行过程由 Runtime 现成的 Staging Clean Room 目录隔离与配额门禁兜底，执行后由 `artifact-verifier.ts` 做防逃逸检查与 SHA-256 存证封签；
5. **Studio 极简联动内嵌（目标）**：不建独立的“工具库”或大盘页面，在角色检查器内提供“底座联动投影的工具选项 + 环境意图摘要 + 行内就绪诊断”，10 秒内完成配置。Studio 只编辑 Harness Template 的 `allowedTools` 和 EnvironmentIntent。

本文同时描述当前实现和目标方案。为了避免把设计草图误当成现有能力，使用以下标记：

- **当前**：已经由 Runtime/Studio 源码提供并可通过现有测试验证的行为。
- **MVP**：文件交付与 Git 协作所需的最小扩展，按本文的实施顺序逐步接入。
- **后续**：需要新增 adapter、权限协议或产品界面的能力，不能作为当前运行前提。

当前后端注册表实际包含 `opencode`、`codex`、`ollama`、`pi`、`qwen` 和 `kimi`。Claude Code、Cursor Agent 等可作为外部对照，不代表 OGS 已经提供对应 adapter。

本文的两个语义区必须分开阅读：

```text
Current pre-cutover implementation
  仅记录现有源码、旧字段和迁移对象，不构成 Contract Set v2 输入。

Normative Contract Set v2
  Harness.allowedTools、EnvironmentIntent、EffectiveExecutionPolicy 和 allow/deny
  是唯一目标模型。v2 不读取旧字段，也不保留旧权限分支。
```

---

## 主流 CLI 内置工具集全景调查（外部参考，不等于 OGS 已接入）

经过对各平台官方最新手册（2026）与底层运行时的深入调查，各大主流底座的内置工具集与能力特征如下：

| 底座 (CLI / Backend) | 内置工具集全景 (Built-in Tools) | 出站 HTTP / 搜索支持机制 | 权限与沙箱控制机制 |
| :--- | :--- | :--- | :--- |
| **OpenAI Codex** (App Server) | • 终端命令：`exec_command`<br>• 文件补丁：`apply_patch`<br>• 扩展：`code_mode` (`exec` 脚本内批量嵌套调用)、`image_gen`、MCP | **原生支持网络与搜索**：<br>• 沙箱网络：配置 `network_access = true` 后放行出站 HTTP（通过 `exec_command` 执行 `curl` / `fetch`）<br>• 内置搜索：配置 `web_search = "live"` 开启原生网页检索 | • `sandboxPolicy`: `workspaceWrite` / `readOnly`<br>• `approvalPolicy`: `never` / `untrusted` / `on-request` |
| **Claude Code** (Anthropic) | • 读写：`Read`、`Edit`、`MultiEdit`、`Write`、`NotebookRead/Edit`<br>• 检索：`Glob`、`Grep`、`LS`<br>• 执行：`Bash`<br>• 外部：`WebSearch` (服务端子 Agent)、`WebFetch`<br>• 调度：`Agent`、`TodoRead/Write` | **原生支持网络与搜索**：<br>• 通过 `Bash` 支持 HTTP<br>• 原生内置 `WebSearch` 与 `WebFetch` | • 参数 `--bare`（仅保留 Read/Edit/Bash）<br>• 参数 `--tools` 白名单<br>• 运行模式 Ask / Auto / Supervised |
| **OpenCode** (OpenCode AI) | • 基础：`read`、`edit`（归口管理 write/patch/multiedit）、`write`、`bash`<br>• 检索：`glob`、`grep`<br>• 外部：`websearch`、`webfetch`<br>• 扩展：`task`、`lsp`、`skill`、MCP | **原生支持网络与搜索**：<br>• 通过 `bash` 支持 HTTP 命令<br>• 会话级原生内置 `websearch` / `webfetch` 插件 | • `opencode.json` 的 `permission` 字段（`allow`, `deny`, `ask`）<br>• 会话启动参数 `--tools` |
| **Pi** (pi.dev / Mario) | • 默认 4 原语：`read`、`write`、`edit`、`bash`<br>• 选配只读工具：`grep`、`find`、`ls`、`powershell`<br>• 扩展：`codemode`、`tool_search`、MCP | **支持出站 HTTP，默认无内置搜索**：<br>• 通过 `bash` 支持系统 `curl`/HTTP 脚本<br>• 默认无独立网络搜索工具（需通过扩展或 MCP 挂载） | • `defaultTools: ["+grep", "-bash"]`<br>• 命令行参数 `--tools` 白名单<br>• 细粒度生命周期事件监听 |
| **Cursor Agent** (Cursor IDE) | • 文件操作：`read_file`、`edit_file`、`delete_file`、`list_dir`<br>• 检索：`file_search`、`grep_search`、`codebase_search`<br>• 执行：`run_terminal_command`<br>• 外部：`web_search`、`fetch_rules`、MCP | **原生支持网络与搜索**：<br>• 终端命令支持 HTTP 请求<br>• 原生内置 `web_search` 搜索引擎 | • IDE 弹窗审批卡片<br>• Run Modes（Auto-accept / Supervised） |
| **Qwen Code** (DashScope CLI) | • 基础文件读写与终端命令执行 (`execute_command`)<br>• 外部工具：`web_search`、`web_fetch`<br>• 架构：子智能体分发 (`sub_agents`)、MCP | **原生支持网络与搜索**：<br>• 终端命令支持 HTTP<br>• Responses API 原生提供服务端内置 `web_search` 工具与引用角标 | • 5 档模式：`Plan`, `Ask`, `Auto-Edit`, `Auto`, `YOLO`<br>• `settings.json` 权限管控 |
| **纯离线 Ollama** | 仅承载模型本地前向推理，无任何原生外部工具、网络访问或沙箱基础设施。 | ❌ **不支持网络与搜索**（严格离线运行） | 依赖宿主外挂控制 |

### 现成可用资产：Staging 隔离与门禁封签

Runtime 内部已经拥有完善的物理隔离与安全基础设施（位于 `src/runtime/role-executor.ts` 及 `src/runtime/artifact-verifier.ts`），无需新造轮子：
- **Clean Room 独立目录**：每次角色激活（Attempt/Retry）均在 `roles/<roleId>/executions/<executionId>/workspace/` 创建全新工作区；
- **防路径逃逸**：`safeRelativePath` 与 `isWithin` 拦截所有绝对路径与 `..` 相对段；
- **禁止符号链接**：底层句柄携带 `O_NOFOLLOW`，严禁跨区软链逃逸；
- **硬性安全配额**：单文件大小（默认 50MB）、总字节数（默认 200MB）、文件总数等硬配额限制；
- **原子提升与哈希封签**：校验通过后通过 `flag: "wx"` 提升至 `run/shared/artifacts/`，生成不可变的 `seal-manifest.json` 与不透明 `artifactRef`。

### 当前实现边界（以源码为准）

当前链路已经把 Role 的工具声明接到 execution staging 的能力策略：

```text
role.json constraints.allowedTools
        -> semantic capability policy / contract check
        -> workspaceCapabilityPolicy
           read=true（当前 staging 默认可读）
           write=workspace.write 或 workspace.patch_text
           command=workspace.run
        -> backend adapter
           -> 原生会话的工作目录和权限参数
```

这条链路的关键约束是“能力声明不能超过 capability policy，实际工作目录不能离开本次 execution staging”。`workspace.write`、`workspace.patch_text` 和 `workspace.run` 是当前代码中有明确运行语义的工具引用；读取 staging 是会话的默认能力，`workspace.list` 尚未作为独立的 Runtime 门禁实现。`web.search` 也尚未形成统一的 OGS tool contract、adapter 映射或 Readiness 检查，不能把它当作当前已启用的能力。

MVP 的 backend contract 位于 `src/runtime/backend-capabilities.ts`：它校验 capability policy 的绝对 `root` 和布尔字段，把已启用的 workspace 能力投影为稳定的 tool ID，并在 `Executor` 启动/复用 backend session 前检查 adapter 即将使用的 execution directory 是否仍在该 root 内。提供 policy 时，越界、相对路径和未知字段都会 fail-closed；缺少 policy 是为兼容未接入 capability contract 的旧 adapter 而保留的有意放行，此时函数只返回规范化目录，不提供额外 root 门禁。Role 执行路径在启用该契约时应始终传入 policy。这项校验不替代 staging 的符号链接、配额和 artifact 验证。`projectWorkspaceCapabilities()` 目前只是由 adapter 导出的纯投影辅助函数和契约单测，尚未接入运行时门禁、tool 审计或 Studio 投影；它不能被当作已经生效的项目能力 enforcement。

当前 `BackendDescriptor.capabilities` 表示后端会话层的通用能力（文本输入、tool call、结构化输出、会话复用和中止），不是本文标准工具 ID 的完整能力矩阵。后端 adapter 会转发工作目录及 `workspaceCapabilityPolicy`，但 OGS 不会替代各 CLI 内部的文件编辑、搜索或网络实现。

`executionMode` 由 Project/Studio Runtime 表示 `dry-run`、`sandbox` 和 `real` 等运行方式，
不表示工具权限。Backend 原生 approval/sandbox 参数只存在于 Adapter。OGS v2 的技术 Permission
只有 `allow` 和 `deny`，不创建工具调用级 Human Review。

因此，v2 Studio 编辑 Harness Template 的 `allowedTools` 和 EnvironmentIntent，并显示
Backend Capability Preview。工具选项只能来自当前 Backend 的已验证能力；不能创建工具，也不能配置三档审批模式。

---

## MVP 标准工具契约与底座反向投影

以下契约是面向 v2 Adapter 的稳定意图命名，不要求 Runtime 在 OGS 内实现独立工具执行器。
Pre-cutover 源码中的旧 `constraints.allowedTools` 只作为迁移对象记录；v2 使用 Harness Template
的 `allowedTools` 和 staging 策略。新增能力必须先在对应 Adapter 和测试中落地，再进入 Studio 投影。

### 1. 标准化工具列表

目标上系统可以统一定义 6 个中立的标准工具 ID：

```text
【工作区操作 - 映射 Backend 原生文件读写】
workspace.list        # 枚举工作区文件
workspace.read        # 读取文本文件
workspace.write       # 写入文件
workspace.patch_text  # 增量打补丁
workspace.run         # 执行工作区受控命令/脚本 (含 curl 出站 HTTP)

【网络检索 - 映射 Backend 原生联网能力】
web.search            # 原生联网检索与时效性增强
```

### 2. 底座反向约束矩阵（目标 Capability Projection Matrix）

**目标机制：底座决定可选范围。** 在配置和校验时，根据角色绑定的底座物理能力进行投影与门禁拦截。下表是待 adapter 验证的设计矩阵，不是当前 Runtime 的承诺；当前实现只保证上文列出的三项 workspace capability policy。

| 标准工具 ID | OpenCode | Claude Code | Codex (App Server) | Qwen Code | Cursor Agent | Pi (pi.dev) | 纯离线 Ollama |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `workspace.read` | ✅ `{ read: true }` | ✅ 放行 Read | ✅ `read-only` 沙箱 | ✅ 原生 read | ✅ 放行 read_file | ✅ 原生 read | ✅ 原生 read |
| `workspace.write` | ✅ `{ edit: true }` | ✅ 放行 Write | ✅ `workspace-write` | ✅ 原生 write | ✅ 放行 edit_file | ✅ 原生 write | ✅ 原生 write |
| `workspace.patch_text`| ✅ `{ edit: true }` | ✅ 放行 Edit | ✅ `apply_patch` 沙箱| ✅ 原生 edit | ✅ 放行 edit_file | ✅ 原生 edit | ✅ 原生 edit |
| `workspace.list` | ✅ `{ list: true }` | ✅ 放行 LS/Glob | ✅ 沙箱内列举 | ✅ 原生 list | ✅ 放行 list_dir | ✅ 原生 list | ✅ 原生 list |
| `workspace.run` | ✅ `{ bash: true }` | ✅ 放行 Bash | ✅ `exec_command` | ✅ 原生命令 | ✅ 放行 terminal | ✅ 原生 bash | ⚠️ 受限 Bash |
| `web.search` | ✅ 开启 search 插件 | ✅ 放行 WebSearch | ✅ `web_search="live"`<br>+ `network_access` | ✅ 原生 `web_search` | ✅ 放行 web_search | ❌ 需扩展/MCP (默认置灰) | ❌ **不支持 (置灰/阻断)** |

* **目标 Fail-Closed 门禁**：当后端能力目录和 adapter 映射接入后，Runtime 执行前校验应阻断角色声明但后端不支持的工具（例如离线后端 + `web.search`）。当前已经存在的是 role contract 与 semantic capability policy 的 fail-closed 检查；它校验声明是否被项目能力策略允许，不会推断 `web.search` 等后端原生能力。
  ```text
  [READINESS_ERROR] Role "${roleId}" requires tool "web.search",
  which is unsupported by backend "${backend}".
  Please switch backend to a search-capable model (e.g. codex, qwen, claude, opencode) or remove the tool.
  ```

### 3. v2 Permission 与 Human Review 边界

OGS v2 不提供工具级三档安全模式。技术执行使用：

```text
Capability + allowedTools + EnvironmentIntent + Law / quota / staging
  -> EffectiveExecutionPolicy
  -> PermissionDecision: allow | deny
```

Human Review 只使用统一的 `HumanReviewRequest` 和动作枚举。它可以在 Role 结果交接前
触发，也可以由配置的 Runtime 异常触发；它不会暂停等待单个 Backend 工具的批准。

### 4. CLI 工具保持独立

`local_shell` 用于固定的发布脚本、转换器和其他受控宿主机命令。它继续由 `profiles.json` 绑定到 `tools.json`，并经过现有的命令解析、依赖 Readiness、超时、输出上限和工作区隔离。

模型标准工具和 `local_shell` 不合并成一个执行器：前者由模型发起调用，后者由流程中的 CLI Tool Role 启动。

---

## Studio 极简可视化配置：底座联动投影（后续）

无需开辟独立一级页面，配置直接内嵌在 **角色检查器（Role Inspector）** 中。**用户先选底座模型（`modelRef`），工具选项根据底座物理能力动态联动启用或置灰：**

```text
┌────────────────────────────────────────────────────────┐
│ 角色检查器 - 标准能力与安全配置                         │
├────────────────────────────────────────────────────────┤
│ 绑定底座模型: [ codex / gpt-6-luna                   ▼] │
├────────────────────────────────────────────────────────┤
│ [环境意图]                                             │
│ 文件读写、进程、网络由 Harness Template 配置           │
│ Runtime 根据 Capability、Law、staging 计算最终策略      │
│                                                        │
│ [工作区操作 (Backend 原生执行)]                        │
│ [x] workspace.list       文件列表枚举 (只读)            │
│ [x] workspace.read       文本文件读取 (只读)            │
│ [x] workspace.write      文件写入 (沙箱修改)            │
│ [x] workspace.patch_text 增量补丁编辑 (沙箱修改)        │
│ [ ] workspace.run        执行工作区命令 (支持 curl/HTTP)│
│                                                        │
│ [网络检索 (Backend 原生联网)]                          │
│ [x] web.search           联网检索 (原生支持实时联网搜索) │
│                                                        │
│ [就绪诊断]                                             │
│ ℹ️ 当前 Backend: codex (工作区沙箱已就绪，原生搜索可用) │
└────────────────────────────────────────────────────────┘
```

### 交互规则（后续 Studio 能力）
1. **联动投影**：切换 `modelRef` 时，工具复选框即时刷新状态。当切换到纯离线模型（如 Ollama）或默认 Pi 时，`web.search` 自动置灰并展示禁用原因；当切换到 Codex、Claude、OpenCode、Qwen 时，全部 6 项高亮可用；
2. **策略诊断**：显示 `EffectiveExecutionPolicy` 和每项 allow/deny 原因；
3. **专业模式折叠**：专业人员可展开查看 `allowedTools`、EnvironmentIntent 和 `local_shell` Profile 参数。

---

## 实施顺序与依赖（MVP 优先）

文件产物交付文档是本能力层的前置依赖。Role 必须先能在独立 staging 中产生可验证 artifact，并通过 handoff 交给串行下游或通过 Git worktree 进入 Join 后 Merge Stage；backend 工具标准化只决定 Role 如何在 staging 中工作，不改变 artifact、handoff、merge 和 promotion 的所有权。

推荐按以下顺序落地：

1. **交付基线（前置）**：完成 `staging -> artifact verify/seal -> handoff -> promotion` 的可恢复链路，保留当前单 Role 和串行 handoff 行为。
2. **MVP 能力契约**：把现有 `workspace.write`、`workspace.patch_text`、`workspace.run` 的 capability policy、backend 工作目录传递和失败审计固化为测试；读取继续使用当前 staging 默认能力。此阶段不新增 `web.search` 或独立 `workspace.list` 执行器。
3. **Git 协作接入**：`src/runtime/git-collaboration.ts` 已提供受控 native Git CLI wrapper、worktree 生命周期、固定基线、commit provenance、merge/conflict 和合并工作树验证 API；Graph Runner 在显式传入 coordinator 时已接入并行代码 Role、Join 后 Merge Stage、commit/merge 事件和 verify 门禁，并有真实临时仓库端到端测试。项目级自动构造、CAS promotion adapter 仍由调用方接线。Git 合并失败必须保留冲突证据并停止 promotion，不向业务目录写入编号冲突文件。
4. **后端投影（后续）**：为实际注册的 backend 逐个补充可验证的 native capability descriptor 和 readiness probe。每次只接入一个能力，先实现 workspace 工具，再评估 `web.search`；不得仅凭 CLI 宣传文档把能力标为可用。
5. **Studio 投影**：按 Harness Template 的 Backend reference 动态投影 Capability Preview 和 `allowedTools`，并显示 EffectiveExecutionPolicy。不得使用 `dry-run` / `sandbox` / `real` 表达工具权限。

切换前的 v1 运行保持现状，作为迁移基线；切换到 v2 后，未完成能力验证的绑定进入 readiness error，
不回退到 v1 字段或旧权限模式。

---

## 验收标准

### 当前/MVP 验收

- **能力边界可验证**：`role contract` 和 semantic capability policy 拒绝未授权的 tool reference；`workspace.write`、`workspace.patch_text`、`workspace.run` 分别控制 staging 写入、补丁写入和命令执行。
- **后端工作目录正确**：每个 adapter 收到本次 execution staging 目录，不能写入 `project.workspaceDir`；单 Role 与串行 handoff 的现有行为保持不变。
- **执行安全刚性兜底**：防逃逸、符号链接检查、文件配额、artifact manifest/seal 和 promotion 门禁继续由 Runtime 基础设施负责。
- **Git 协作 MVP 可验证**：并行 worktree 的 commit provenance、固定基线、Join 后确定性 merge、Join 重试复用合并工作树、最新成功 leaf 的最终合并、冲突事件和合并工作树验证有真实端到端测试；publish 异常会持久化失败 Run 和可能部分生效的证据。项目级 Git-aware promotion lock/CAS adapter 仍需后续接线，合并失败不得污染业务目录。
- **架构保持轻量**：不在 OGS 内实现文件编辑算法、搜索爬虫或 Git 语义合并引擎；优先使用 backend 原生工具和 Git CLI。

### 后续能力验收

- 只有在 backend descriptor、adapter 映射、readiness probe 和测试同时存在时，才能把某个 native tool 标为可用；未实现的 backend 或 `web.search` 必须显示为不可用/未验证。
- 技术 Permission 只能产生 `allow` 或 `deny`；Human Review 必须使用统一 Review Request、动作枚举、超时和恢复语义。
- 工具审计至少记录声明的 `toolId`、实际 adapter/backend、状态和耗时；凭据和搜索响应按现有 redaction 策略处理。
