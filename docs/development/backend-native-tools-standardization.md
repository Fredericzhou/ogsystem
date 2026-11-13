# Backend 内置工具标准化与 Studio 极简配置方案

## 核心设计哲学

> **“底座决定工具集的物理上限；工具层面坚决避免自建，保持架构零负担、纯映射、极度轻量。”**

OGSystem 的核心定位是**多智能体拓扑编排、企业法则（Law）治理与可信交付物封签**，而不是底层工具的执行引擎。

在实际运行时，**“当选定模型底座（CLI / Backend）时，实际上就已经锁定了可用工具集的物理边界”**。现代主流 Coding Agent（Claude Code、Codex、OpenCode、Pi、Cursor、Qwen Code 等）在本地代码编辑（Fuzzy Patching、AST 感知）、终端执行及网络检索（服务端 Grounding、权威重排、时效校验）上已经过深度微调优化。

### 借鉴开源标杆：T3 Code 与 Orca 的架构精髓
本方案深入吸收了业界前沿开源 Agent 平台 **T3 Code (`pingdotgg/t3code`)** 与 **Orca (`stablyai/orca`)** 的成功经验：
1. **参考 T3 Code 的“BYOS 控制面”哲学**：
   - T3 Code 坚持作为 Agent Harness Control Surface，自身不写任何文件编辑算法或爬虫代码，完全信任底层 Agent 原生工具能力；
   - 通过中立协议（ACP）切分职责：底座提供原生工具与模型推理，上层仅负责项目工作区快照、DAG 任务委派与 3 档安全确认（Supervised / Auto-accept / Full access）。
2. **参考 Orca 的“Worktree 物理沙箱”哲学**：
   - Orca 作为底座无关包装器（Agent-Agnostic Wrapper），深刻践行“工具层越薄，物理隔离层越硬”的原则；
   - 将安全交给文件系统级物理隔离（每个任务独占 Git Worktree / 独立目录），协调层只监听 `worker_done` 并做最终 Diff 审查与交付封签，绝不介入底层的编辑细节。

基于此，OGS 严格遵循以下五项铁律：
1. **底座反向约束工具集（Capability Projection）**：工具选项不是全局静态任意挑选的，而是由角色绑定的 `modelRef` 所属底座动态投影出可选范围；
2. **OGS 零自建工具执行器**：OGS 不写文件编辑算法，不写网络抓取爬虫，不自建搜索引擎，坚决避免重复造轮子；
3. **纯映射与策略开关（Pure Mapping & Switch）**：OGS 只负责“意图声明（`toolId`） $\to$ 底座原生参数/网络沙箱开关透传”；
4. **刚性安全由现有基础设施兜底**：执行过程由 Runtime 现成的 Staging Clean Room 目录隔离与配额门禁兜底，执行后由 `artifact-verifier.ts` 做防逃逸检查与 SHA-256 存证封签；
5. **Studio 极简联动内嵌**：不建独立的“工具库”或大盘页面，在角色检查器内提供“底座联动投影的 6 个复选框 + 3 档权限单选 + 行内就绪诊断”，10 秒内完成配置。

本文是基于当前实现的极简落地方案。文中标记为“当前”内容来自源码；标记为“目标”内容需要后续实现。

---

## 主流 CLI 内置工具集全景调查现状

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

---

## 目标标准工具契约与底座反向投影

### 1. 标准化工具列表

系统统一定义 6 个中立的标准工具 ID：

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

### 2. 底座反向约束矩阵（Capability Projection Matrix）

**核心机制：底座决定可选范围。** 在配置和校验时，根据角色绑定的底座物理能力进行投影与门禁拦截：

| 标准工具 ID | OpenCode | Claude Code | Codex (App Server) | Qwen Code | Cursor Agent | Pi (pi.dev) | 纯离线 Ollama |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `workspace.read` | ✅ `{ read: true }` | ✅ 放行 Read | ✅ `read-only` 沙箱 | ✅ 原生 read | ✅ 放行 read_file | ✅ 原生 read | ✅ 原生 read |
| `workspace.write` | ✅ `{ edit: true }` | ✅ 放行 Write | ✅ `workspace-write` | ✅ 原生 write | ✅ 放行 edit_file | ✅ 原生 write | ✅ 原生 write |
| `workspace.patch_text`| ✅ `{ edit: true }` | ✅ 放行 Edit | ✅ `apply_patch` 沙箱| ✅ 原生 edit | ✅ 放行 edit_file | ✅ 原生 edit | ✅ 原生 edit |
| `workspace.list` | ✅ `{ list: true }` | ✅ 放行 LS/Glob | ✅ 沙箱内列举 | ✅ 原生 list | ✅ 放行 list_dir | ✅ 原生 list | ✅ 原生 list |
| `workspace.run` | ✅ `{ bash: true }` | ✅ 放行 Bash | ✅ `exec_command` | ✅ 原生命令 | ✅ 放行 terminal | ✅ 原生 bash | ⚠️ 受限 Bash |
| `web.search` | ✅ 开启 search 插件 | ✅ 放行 WebSearch | ✅ `web_search="live"`<br>+ `network_access` | ✅ 原生 `web_search` | ✅ 放行 web_search | ❌ 需扩展/MCP (默认置灰) | ❌ **不支持 (置灰/阻断)** |

* **刚性 Fail-Closed 门禁**：若底层配置被绕过，Runtime 执行前校验（Readiness Check）如果发现角色声明了当前底座不支持的工具（例如 Ollama + `web.search`，或 Pi 默认内核 + `web.search`），直接抛出明确的阻断异常：
  ```text
  [READINESS_ERROR] Role "${roleId}" requires tool "web.search",
  which is unsupported by backend "${backend}".
  Please switch backend to a search-capable model (e.g. codex, qwen, claude, opencode) or remove the tool.
  ```

### 3. 简明的三档安全模式（参考业界成熟体验）

不为每个工具配置繁琐的审批条件，在角色级别抽象为直观的 3 档安全模式：

| 模式 (executionMode) | 行为语义与安全机制 | 推荐场景 |
| :--- | :--- | :--- |
| **Supervised (完全监督)** | 任何产生副作用的操作（写文件、打补丁、命令执行）均挂起触发审批卡片，必须人工 Review 确认后方可执行。 | 生产发布、敏感代码修改、关键文档定稿。 |
| **Auto-accept (自动接受安全编辑)** | **默认推荐模式**。在独立 Staging 目录与配额范围内，自动放行工作区读写、打补丁及联网搜索；遇到 `workspace.run`（Shell 执行/出站 HTTP）时强行挂起待审批。 | 日常开发、文档编写、代码分析。兼顾吞吐与安全。 |
| **Full access (全自动信任)** | 在 Staging 沙箱与配额硬性保护下，自动放行所有已授权工具（含受控命令执行与出站 HTTP），追求最高自动化协作吞吐。 | 自动化沙箱跑测、批量格式转换、自闭环修复重试。 |

### 4. CLI 工具保持独立

`local_shell` 用于固定的发布脚本、转换器和其他受控宿主机命令。它继续由 `profiles.json` 绑定到 `tools.json`，并经过现有的命令解析、依赖 Readiness、超时、输出上限和工作区隔离。

模型标准工具和 `local_shell` 不合并成一个执行器：前者由模型发起调用，后者由流程中的 CLI Tool Role 启动。

---

## Studio 极简可视化配置：底座联动投影

无需开辟独立一级页面，配置直接内嵌在 **角色检查器（Role Inspector）** 中。**用户先选底座模型（`modelRef`），工具选项根据底座物理能力动态联动启用或置灰：**

```text
┌────────────────────────────────────────────────────────┐
│ 角色检查器 - 标准能力与安全配置                         │
├────────────────────────────────────────────────────────┤
│ 绑定底座模型: [ codex / gpt-6-luna                   ▼] │
├────────────────────────────────────────────────────────┤
│ [安全模式]                                             │
│ ( ) Supervised (完全监督，写操作与命令均需审批)         │
│ (•) Auto-accept (自动接受文件编辑与搜索，命令需审批 - 推荐)│
│ ( ) Full access (全自动信任，仅限受限沙箱内)            │
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

### 交互规则
1. **联动投影**：切换 `modelRef` 时，工具复选框即时刷新状态。当切换到纯离线模型（如 Ollama）或默认 Pi 时，`web.search` 自动置灰并展示禁用原因；当切换到 Codex、Claude、OpenCode、Qwen 时，全部 6 项高亮可用；
2. **三选一单选框**：快捷选择 `Supervised` / `Auto-accept` / `Full access`；
3. **专业模式折叠**：专业人员可展开查看底层 JSON 结构（`allowedTools` 数组与 `executionMode`）以及 `local_shell` 绑定的 CLI Profile 参数。

---

## 分期落地顺序（预计 2~3 天）

1. **第一步：Studio 角色面板增加底座联动与极简配置（Day 1）**
   - 在角色检查器中增加复选框与权限单选框，依据当前 `modelRef` 动态投影工具可用性；
   - 数据直接保存到角色的 `constraints.allowedTools` 与 `constraints.executionMode`。
2. **第二步：Runtime 各 Adapter 极薄映射与门禁（Day 2）**
   - 在 OpenCode、Codex（透传 `network_access` 与 `web_search`）、Qwen、Claude adapter 中增加几行纯参数映射逻辑；
   - 增加运行前 Readiness 强校验：拦截不支持的工具组合（如 Ollama + `web.search`）。
3. **第三步：串联现有 Staging 隔离与审计（Day 3）**
   - 统一由现有的 `role-executor.ts` + `artifact-verifier.ts` 提供 Staging 隔离与 SHA-256 封签；
   - 记录 `toolId`、`nativeTool`、`status`、`durationMs` 统一审计日志。

---

## 验收标准

- **底座约束严格对齐**：Studio 界面与运行前校验严格遵守“底座决定工具集上限”，不支持的工具（如 Ollama + `web.search`）在界面置灰并在运行前阻断；
- **全底座能力释放**：在 Codex（沙箱放行与实时搜索）、Claude、OpenCode、Qwen 等主流后端上成功激活其原生工作区与网络检索能力；
- **架构零自建与极轻量**：Runtime 内部无自建文件编辑算法，无自建网页爬虫或搜索服务器，完全依赖 Backend 原生能力；
- **配置极简无冗余**：业务人员在角色检查器中通过联动复选框和 3 档单选框完成配置，无须编辑 JSON；
- **执行安全刚性兜底**：即便在 `Full access` 模式下，底层依然由 Staging Clean Room、防逃逸（`isWithin`）、禁止符号链接（`O_NOFOLLOW`）与文件配额硬性保护；
- **产物可信封签**：角色输出声明的产物通过 SHA-256 校验并封签提升至只读共享区；
- **审计记录统一**：工具调用与搜索生成规范的审计条目，且不泄露敏感明文凭据。
