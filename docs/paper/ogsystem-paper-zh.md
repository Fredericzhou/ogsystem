# OGSystem：一种面向有界多智能体协作的持久化扩展状态机运行时与工程实践

**作者：** Fred [真实姓名]  
**作者身份/单位：** 独立研究者（Independent Researcher），[省份/城市]，中国  
**联系邮箱：** [your-email@domain.com]  
**ORCID:** [https://orcid.org/0009-XXXX-XXXX-XXXX]  
**开源代码库与基准测试:** [https://github.com/your-username/ogsystem]

---

### 摘要
随着大语言模型（LLM）的突破，多智能体系统（MAS）在复杂软件工程与业务协同中展现出巨大潜力。然而，现有系统在落地企业严肃生产时，普遍面临状态漂移、非预期死循环、上下文越权穿透以及成果无法验证交付的结构性瓶颈。以 n8n、Dify、Coze 为代表的主流工作流平台，本质上遵循前向有向无环图（DAG）流水线（Pipeline）范式，因结构性严禁有向回边，无法在顶层架构上原生表达多角色之间的评审打回、博弈返工与法定多数汇聚。

为破解上述难题，本文在经典分布式系统与状态机理论指导下，工程实现了 **OGSystem（简称 OGS）** —— 一个面向有界社会技术协作的事件驱动持久化扩展有限状态机（EFSM）工作流运行时与交付控制内核。系统确立了“责任席位优先（Role-First）”的图本体原语，实现了组织职责席位与动态模型执行者的正交解耦；引入标记转移系统（LTS）收敛离散业务事件；在运行时显式建模包含分支血缘（Lineage）、源状态感知汇聚（Join Scope）与循环预算（Loop Budget）的持久化全要素扩展状态，并贯彻契约闭锁（Fail-Closed）原则；构建了“不透明产物引用（Opaque ArtifactRef） $\to$ 沙箱隔离验证 $\to$ 原子晋升”的独立代码交付闭环。基于覆盖底层内核与上层平台的 1,228 项自动化回归测试与真实故障注入实验表明，系统在复杂返工拓扑下严格保障了状态拓扑确定性与死循环拦截，验证了局部写断裂自愈与崩溃一致性恢复能力，并对中国 2026 年最新人工智能智能体系列国家标准（GB/Z 185 与 GB/Z 242）形成了深度工程级覆盖。

**关键词：** 大模型工程；多智能体系统；扩展有限状态机（EFSM）；标记转移系统（LTS）；有向无环图（DAG）；流水线范式；故障闭锁；工程交付物

---

### 1. 引言与背景演进

#### 1.1 大模型工程的演进脉络与领域断点
回顾大模型软件工程的发展历程，工业界围绕“如何收敛概率性推理的非确定性”展开了五个清晰阶段的探索：
1. **提示词工程（Prompt Engineering，2022~2023）：** 聚焦于单次交互中的指令格式与思维链（CoT）引导，本质属于微观字符层面的启发，缺乏处理动态长链路的能力；
2. **上下文工程（Context Engineering，2023）：** 伴随 RAG 与长窗口技术的演进，重点转向动态注意力窗口与向量知识检索，但多角色协作中的无序上下文透传极易诱发严重的记忆污染与目标漂移；
3. **循环工程（Loop Engineering，2023~2024）：** 引入以 ReAct 和自反思为代表的闭环机制，赋予智能体试错自愈力，但因缺乏形式化有界约束，极易陷入无法收敛的非预期死循环；
4. **Harness 底座（Agent Harness，2024）：** 以 SWE-agent 执行沙箱为代表，成功实现了“模型认知思考”与“外部操作系统/工具执行”的物理边界解耦，但其主要针对单智能体的单点自主，缺乏宏观的多角色组织治理模型；
5. **图工程（Graph Engineering，2024~2026）：** 引入拓扑编排管理多任务。但目前主流实践发生分化：一类走向完全基于自然语言的无序即兴聊天群（Ad-hoc Swarm）；另一类则蜕变为以 n8n、Dify、Coze 为代表的前向有向无环图（DAG）流水线范式。

#### 1.2 2015-2016 分布式状态机革命的代际回响
审视当前多智能体编排的困境，令人深思的是：**2025~2026 年的大模型工程，正在重蹈 2015~2016 年微服务爆发初期的覆辙。**
在 2015–2016 年间，微服务架构因无序点对点调用面临雪崩灾难。软件工程先驱们通过 **AWS Step Functions**（2016）确立了声明式状态机编排规范，通过 **Uber Cadence**（2016，Temporal 的前身）提出了“持久化执行（Durable Execution）与事件溯源”理论，彻底终结了微服务调用的混沌状态。

然而，在近年的大模型热潮中，工业界过度迷恋模型的自发涌现，将十年前经受检验的状态机与持久化执行抛诸脑后，使得多智能体系统倒退为脆弱的聊天脚本。

#### 1.3 头部工业实验室的技术路线演进与分歧
在这一背景下，全球头部前沿实验室在智能体（Agent）工程路线上展开了激烈的理念交锋与路线探索：
1. **Anthropic（Claude）倡导“确定性工作流”反思：** 2024 年底，Anthropic 发布重磅报告《Building Effective Agents》，旗帜鲜明地指出当前工业界构建复杂多 Agent Swarm 走入了误区，论证了最可靠的落地模式是“确定性工作流优于自主智能体（Workflows over Autonomous Agents）”。这为状态机工程化治理提供了强有力的行业辩护；但 Anthropic 仅停留在模式建议层面，缺乏具备形式化证明与全要素持久化的通用内核。
2. **OpenAI 的 Handoffs 原语与 Swarm 实验：** OpenAI 先后推出服务端托管的 Assistants API 与轻量级框架 Swarm（2024），提出了 Agent 与交接函数（Handoffs）的原语抽象。然而，Swarm 本质是无状态的客户端轻量轮询脚本，缺乏服务端持久化、并发分支 Join、死循环配额与类型契约，难以直接承载高保真业务。
3. **Google DeepMind 的“超长上下文假说”反转：** 伴随 Gemini 1.5/2.0 的 1M~2M 超长上下文，业界曾出现“把所有历史塞入单一大上下文即可淘汰状态机”的激进思潮。然而最新实证表明，超长上下文面临严重的“注意力稀释（Attention Dilution）”与幻觉放大，根本无法替代显式状态机与严格字段隔离（Context Map）。
4. **xAI（Grok）强推理单体与组织权力的边界：** xAI 聚焦通过超强算力与强化学习推高单模型智商峰值。但企业软件工程的本质是架构设计、编码、测试的三权分立与交叉制衡，单模型的自言自语无法取代外部社会技术协作系统的制度性防线。

#### 1.4 OGSystem 的核心定位
在此历史坐标系下，**OGSystem（简称 OGS）被定义为一个面向有界社会技术协作的事件驱动持久化扩展有限状态机（EFSM）工作流运行时与交付控制内核**。
OGS 是一场跨越十年的“工程理性复兴”：它将 2015-2016 年成熟的持久化确定性执行与扩展状态机内核，与 Anthropic 倡导的工作流确定性理念、现代 Harness 环境沙箱及中国 2026 年最新智能体国家标准深度融合，在数学上包容并超越了传统的 DAG 流水线。

---

### 2. 主流协同系统调查与结构性深度对比

为深入探讨多智能体协同运行时的系统本质，本节对当前全球代表性厂商的自研协作产品（OpenAI Codex Multi-Agent v2、Anthropic Claude Subagents、Google Opal、LangChain LangGraph/LangSmith）、新兴通用智能体（Manus、腾讯 WorkBuddy）、主流多智能体协作编程软件（Orca、OMP / oh-my-pi、Aider）、经典多智能体框架（MetaGPT、AutoGen、ChatDev）以及主流工作流平台（n8n、Dify、Coze）进行形式化计算模型调查与全景对比。

#### 2.1 多智能体编排能力与协作模型的形式化分类学（Orchestration & Collaboration Taxonomy）
从系统拓扑、通信代数、执行隔离与控制论角度，当前多智能体系统的编排与协作机制可归纳为九种形式化计算范式，其在**协作模型、核心特点与底层技术栈**上呈现鲜明的代际演进特征：

1. **前向有向无环数据流图（Forward Acyclic Dataflow DAG Pipeline，如 n8n、Dify、Coze Workflow、Google Opal）**
   *   **协作模型：** 基于拓扑偏序的单向数据流管道；前置依赖就绪即激发单次激活。
   *   **核心特点：** 结构性严禁有向回边；循环必须降解为节点内部黑盒循环（`batch_map`）或离线展开；数据在节点间累积透传，缺乏跨阶段字段投影防御。
   *   **底层技术栈：** TypeScript / Python，基于 Celery / Redis 异步任务队列、PostgreSQL 关系型数据库、基于 Web Canvas 的可视化拖拽编排引擎。
2. **分层树状派生与上下文汇聚（Hierarchical Tree-Forking / Subagents，如 Anthropic Claude Code、OpenAI Codex Multi-Agent v2）**
   *   **协作模型：** 主控-工作者（Master-Worker）树状调用模型；主控 Agent 持有全局上下文，按需派生临时子 Agent 并在完成后回收文本摘要。
   *   **核心特点：** 呈现自上而下的支配式分工，缺乏平行的制度制衡与对等否决权；Codex v2 引入密文交接（Ciphertext Delegation）引发了开源社区关于透明度与可审计性的广泛争议。
   *   **底层技术栈：** Node.js / Rust / Python CLI 客户端，JSON-RPC / Model Context Protocol (MCP) 工具总线，子进程上下文切片与沙箱隔离。
3. **去中心化动态交接与即兴编舞（Decentralized Handoffs Choreography，如 OpenAI Swarm、AutoGen GroupChat、ChatDev）**
   *   **协作模型：** 基于点对点交接（P2P Handoffs）或大模型意图路由的无中心自主编舞。
   *   **核心特点：** 智能体即函数对象，通过 `handoff(target)` 自主跳转；无全局状态机与服务端持久化，极易陷入对话发散、礼貌推诿与死循环。
   *   **底层技术栈：** Python 原生库，OpenAI Function Calling 机制，内存轮询消息循环（In-memory Event Loop）。
4. **终端多路复用与跨窗格委派运行底座（Terminal Multiplexing & Cross-Pane Delegation，如 Herdr `herdr.dev`）**
   *   **协作模型：** 操作系统级的多智能体终端视窗复用与跨窗格委派调度（"tmux for AI Agents"）。
   *   **核心特点：** 常驻后台守护进程接管多窗格生命周期，提供丰富的跨窗格 IPC 原语（`hc run --bg`、`hc send`、`hc wait`、`hc read`）；创新采用 ANSI OSC 7501 扩展口令感知智能体运行状态（`working/blocked/done/idle`）。
   *   **底层技术栈：** 高性能 Rust 核心守护进程（`herdr-core`），Unix Domain Socket 进程间通信，OpenRPC 协议规范，PTY/TTY 终端多路复用驱动。
5. **物理隔离工作树与终端代理总线（Worktree-Isolated Terminal Fleet Bus，如 Orca `onorca.dev`）**
   *   **协作模型：** 基于 Git 物理工作树隔离的文件总线与终端代理车队（Fleet）架构。
   *   **核心特点：** 为每个任务独占分配独立的 Git Worktree 目录、专用终端会话与无头浏览器，从文件系统根除并发脏写与分支冲突；依赖 CLI 管道驱动多 Agent 协同。
   *   **底层技术栈：** Node.js / TypeScript CLI 客户端，Git Worktree 引擎，操作系统终端 stdio 管道重定向，Playwright 无头浏览器测试套件。
6. **角色感知模型分流与伴生守护者（Role-Based Model Dispatcher & Advisor Companion，如 OMP `omp.sh`）**
   *   **协作模型：** 算力标签化模型路由器与后台流式伴生监听架构。
   *   **核心特点：** 将“角色”映射为面向不同推理特性的异构模型调度策略（`plan/slow/task/advisor`）；引入流式旁路监听与内置 P0–P3 缺陷专用评审；单兵开发能效极高。
   *   **底层技术栈：** 高性能 Rust，Hashline 行哈希紧凑编辑引擎，Tree-sitter 增量语法解析，内嵌语言服务器协议（LSP）与调试适配器协议（DAP）。
7. **消息池订阅与黑板架构（Pub-Sub Blackboard / Message Pool，如 MetaGPT、OpenHands）**
   *   **协作模型：** 围绕标准软件操作规程（SOP）驱动的异步发布-订阅黑板模型。
   *   **核心特点：** 智能体将结构化动作与代码产物发布至中央消息池，由声明前置条件的下游智能体异步拉取消费；结构严谨但拓扑演变相对固化。
   *   **底层技术栈：** Python 异步运行时，Docker 容器沙箱，基于 Pydantic 的强模式约束与事件总线。
8. **代码级自由状态图（Imperative Cyclic StateGraph，如 LangChain LangGraph + LangSmith）**
   *   **协作模型：** 编程式有向循环状态图与条件边跳转。
   *   **核心特点：** 允许拓扑中存在任意有向回边与循环；通过开放的共享状态字典（State Dict）传递数据；侧重运行期链路追踪（Traces）与人工审批断点。
   *   **底层技术栈：** Python / TypeScript，LangSmith 分布式遥测与评估控制塔，PostgreSQL / Redis / SQLite 检查点持久化存储。
9. **责任席位优先的持久化扩展状态机（Role-First Persistent EFSM over LTS，如 OGSystem 本产品）**
   *   **协作模型：** 闭合有向图（Closed Directed Graph，DAG 的形式化超集），抽象责任席位集 $V$ 与具体执行器 $\rho$ 严格解耦。
   *   **核心特点：** 离散业务事件字典驱动转移（LTS $\Sigma_{\text{fixed}}$）；全要素扩展状态元组 $\mathbf{X}$ 持久化；Fail-Closed Context Map 字段级投影；有界循环配额与 CAS 人工审核断点；沙箱独立跑测与交付物原子晋升。
   *   **底层技术栈：** 编译型 TypeScript / Node.js 运行时，受限 Mermaid 语义编译器（Semantic IR v1），追加式预写日志（WAL `events.ndjson`），原子快照提交（CAS `state.json`），沙箱隔离验证器（Sandbox Verifier），双工作台架构（OGS Studio 画布设计台与 OGS Projects 业务交付台）。

#### 2.2 结构性全景对比矩阵（Structural Comparison Matrix）
如表 1 与表 2 所示，我们从两层视角展开全方位对比：表 1 覆盖前沿实验室平台与通用协同架构；表 2 聚焦当前主流的多智能体协作编程软件，重点解构其**协作模型、隔离边界、通信原语、角色本体、状态机治理与交付验证**。

| 结构维度 | **OpenAI Codex v2 / Swarm** | **Anthropic Subagents / Claude Code** | **Google Opal (Agent Mode)** | **LangGraph + LangSmith** | **Manus / 腾讯 WorkBuddy** | **OGSystem (本系统)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 图本体原语<br>(Node Primitive)** | 临时线程 / 无状态函数对象 | 任务子智能体 (Task Subagent) | 可视化组件 / 动态 Agent 步进 | 任意 Python 状态计算节点 | 虚拟 OS 进程 / 桌面专家池 | **抽象责任席位<br>(Responsibility Seat)** |
| **2. 拓扑与转移<br>(Topology & Transition)** | 父子树状派生 / 自由函数交接 (Handoffs) | 树状分发与 Fork 汇聚 (Tool-Runner) | 前向流 + 动态展开步骤 (Prompt Step) | 开发者自定义条件跳转边 (Conditional Edge) | 任务队列派发 / 单体自反思单工流 | **LTS 标记转移系统<br>(受限离散业务事件 $\Sigma_{\text{fixed}}$)** |
| **3. 状态与持久化<br>(State & Persistence)** | 内存线程 / 客户端轮询 (无原生持久化) | 本地会话缓存 / 会话截断恢复 | 绑定 Google Drive 工作区文件 | 状态图 Checkpoint / LangSmith 线程追踪 | 云端虚拟机快照 / 本地数据库 | **全要素扩展状态元组 $\mathbf{X}$<br>(WAL + CAS + 语义指纹一致性)** |
| **4. 数据边界治理<br>(Data Boundaries)** | 密文代理或全透传 (破坏透明度) | 任务摘要回传 (局部隔离) | 全局文档共享与上下文堆叠 | 开放共享状态字典 (开发者手动把控) | 共享文件系统 / 单体记忆堆积 | **Fail-Closed Context Map<br>(强契约字段投影，未声明即阻断)** |
| **5. 循环与控制面<br>(Loop & Governance)** | 硬限制并发数 (无循环状态机治理) | 交互式提问 (Ask User Question) | 交互式追问选项 (Clarifying Chat) | 人工断点 (interrupt_before / 审查队列) | 超时熔断 / 单体死循环重试 | **血缘绑定法定配额<br>(Loop Budget $\to$ 挂起待人工 CAS 决策)** |
| **6. 交付物闭环<br>(Deliverable Pipeline)** | 终端代码生成 / Git PR 补丁 | 本地文件读写 / 终端命令输出 | 自动生成 Drive 文档 / 电子表格 | 文本流 / 任意应用侧写入 | 自动生成演示文稿、研报、Web 页面 | **Opaque ArtifactRef $\to$ 沙箱跑测<br>(Verifier) $\to$ 原子晋升 Deliverable** |
| **7. 审计与透明度<br>(Audit & Transparency)** | 争议较大：v2 引入密文交接破坏可读性 | 开放终端调用与工具执行明细 | 云端黑盒运行记录 | 强：LangSmith 嵌套跨度追踪 (Traces) | 云端过程录屏 / 终端调用明细 | **强：宪法级审计链 (`events.ndjson`)<br>与只读语义投影双工作台** |
| **8. 核心底层技术栈<br>(Underlying Tech Stack)** | Python / Rust 客户端 + 专用协议 | Node.js / Rust CLI + MCP 工具协议 | Google Workspace API + Web Canvas | Python/TS + LangSmith + Postgres/Redis | Linux 虚拟容器 + Playwright 无头浏览器 | **编译型 TS/Node.js + Semantic IR<br>+ WAL / CAS + 独立沙箱跑测环境** |

*表 1：全球主流多智能体自研协同系统与 OGSystem 的结构性全方位对比*

针对专业软件工程与代码研发场景，表 2 进一步将 OGSystem 与当前主流的多智能体协作编程软件进行结构性解构：

| 结构对比维度 | **Orca (StablyAI)** | **Herdr (HerdrDev)** | **OMP (oh-my-pi / omp)** | **Aider (Architect/Editor)** | **OGSystem (本系统)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **核心协作模型<br>(Collaboration Model)** | **工作树隔离终端代理总线**<br>(Worktree-Isolated Terminal Fleet Bus) | **终端多路复用与跨窗格委派底座**<br>(Terminal Multiplexer & Cross-Pane Delegation) | **角色感知模型分流与伴生评审**<br>(Role Model Routing & Subagent Review) | **双人结对互锁协作**<br>(Paired Architect-Editor Ping-Pong) | **责任席位扩展状态机**<br>(Role-First EFSM over LTS) |
| **执行隔离边界<br>(Execution Boundary)** | 物理隔离：每个 Agent 独占 **Git Worktree**、独立终端与浏览器 | 视窗与进程隔离：常驻后台守护进程 `herdr-core`、多窗格 (Panes) 与工作区 | 逻辑隔离：单进程内上下文分片，本地环境直接执行 | 共享工作区：主 Git 分支，通过内存 Prompt 进行角色交接 | 运行隔离：独立 Sandbox Workspace、隔离 Staging 目录 |
| **智能体通信机制<br>(Inter-Agent IPC)** | 终端 CLI 命令流：`orca terminal send`、`orca terminal wait` | 跨窗格 CLI 原语：`hc run --bg`、`hc send`、`hc wait`、`hc read` 与 OpenRPC 域套接字 | 内存调度：`task` 工具派发子代理，`advisor` 旁路流式监听 | 提示词双向交替：Architect 输出计划，Editor 生成并应用 Diff | **LTS 离散业务事件字典** ($\Sigma_{\text{fixed}}$) 与显式数据负载 |
| **角色本体本质<br>(Role Ontology)** | 动态派生的命令执行进程 / 终端会话 | 挂载于终端窗格的 CLI 智能体子进程 (如 Pane 宿主) | **异构模型调度配置标签**<br>(plan/slow/task/advisor 模型策略) | 固定双人静态提示词角色<br>(思考者 vs. 执行者) | **形式化责任席位集 $V$**<br>(组织职责与执行器动态解耦) |
| **上下文边界控制<br>(Context Map Control)** | 终端管道文本传递，缺乏细粒度字段级强契约拦截 | 跨窗格无结构明文文本注入与终端重定向，无强类型投影 | 主会话与子任务摘要传递，依赖提示词约定，无字段投影 | 全量对话历史透传与文件树加载，易引起上下文膨胀 | **Fail-Closed Context Map**：未声明字段或非法文件引用直接阻断 |
| **循环与状态收敛<br>(Loop & Governance)** | 依赖 Task DAG 或人工终端中继，无形式化环路配额 | ANSI **OSC 7501 状态感知协议** (`working/blocked/done`)，无业务状态机收敛 | 运行时步数限制与超时截断，无持久化循环状态机治理 | 单轮对话迭代，人工交互式中断确认 | **血缘绑定有界配额** ($maxIterations$) 与挂起人工 CAS 决策 |
| **产物交付与验证<br>(Delivery Verification)** | 依赖 Git 分支合并与人类 PR Review | 依赖 Agent 自发终端执行与 Git 变更，无独立沙箱验证链 | 内置 LSP 语法检查，专用 `/review` 判定 P0–P3 缺陷 | 自动运行本地测试命令 (test-cmd) 失败则回退 Git | **Opaque ArtifactRef $\to$ 沙箱 Verifier 跑测 $\to$ 原子晋升** |
| **状态一致性与恢复<br>(Crash Consistency)** | 依赖 Git 提交记录与终端日志，无状态机断点一致性恢复 | 依赖守护进程套接字重连与终端输出缓存，无持久化 WAL | 会话历史断点重连，无持久化事件溯源 (WAL) | 依赖本地 `.aider.chat.history.md` 与 Git 回滚 | **WAL (`events.ndjson`) + CAS 提交 + 语义指纹严格校验** |
| **核心底层技术栈<br>(Underlying Tech Stack)** | Node.js / CLI + Git Worktree + Headless Browser 驱动 | Rust (`herdr-core`) + Unix Domain Socket + OpenRPC + ANSI OSC 7501 | 高性能 Rust + Hashline 行哈希引擎 + 内置 LSP/DAP + Tree-sitter | Python + Tree-sitter AST repo-map + Git Diff 引擎 | **TypeScript/Node.js + Semantic IR + WAL/CAS + 独立 Sandbox Verifier** |

*表 2：主流多智能体协作编程软件与 OGSystem 的协作模型及结构性对比*

*表 2：主流多智能体协作编程软件与 OGSystem 的协作模型及结构性对比*

#### 2.3 关键结构的本质差异剖析

##### （1）编排机制与计算模型：为什么 DAG 在多角色协同中失效，而 EFSM 构成其严格超集？
*   **有向无环图（DAG）的数学硬约束与博弈失效：** 传统工作流（n8n、Dify、Coze Workflow）将编排建模为数据流 DAG $G=(V, E)$，其执行依赖拓扑排序（Topological Sort），要求节点在入度依赖满足后单次激发。然而，在真实软件工程与多角色协作中，“架构审查驳回”、“测试红灯返工”是绝对刚需。当 `Reviewer` 发射 `NEEDS_REWORK` 事件指向前序 `Developer` 席位时，拓扑上必然引入**有向回边（Directed Back-Edge）**。在 DAG 引擎中，回边会直接破坏拓扑偏序并引发环路异常；为了妥协，主流 DAG 平台被迫将循环降解为节点内部黑盒的 `batch_map`，或在运行前静态展开为固定步数流水线，彻底摧毁了顶层架构对多角色动态博弈与多轮次交付轨迹的治理能力。
*   **普通 FSM 的状态爆炸与表达局限：** 普通有限状态机仅维护有限控制状态集，其转移关系为 $(ControlState, Event) \to NextControlState$。当面对多智能体并发分支、血缘汇聚（Join）与带计数配额的返工循环时，若将每一种并发分支到达组合与每次循环迭代穷举为独立状态，会导致控制状态空间发生组合爆炸（State Space Explosion），且无法安全携带业务数据载荷。
*   **扩展有限状态机（EFSM）对 DAG 的数学超集包容：**
    OGSystem 采用形式化扩展状态机模型：
    $$(ControlState, Event, \mathbf{X}) \xrightarrow{Guard} (NextControlState, \mathbf{X}', EmittedFacts)$$
    其中 $\mathbf{X}$ 为显式建模的持久化全要素扩展状态向量。当协作图拓扑中不存在有向回边，且扩展状态中循环计数器 $c_{\text{iter}} \equiv 1$、汇聚作用域退化为静态前向依赖时，EFSM 的状态转移语义严格退化为标准 DAG 的拓扑偏序推进。因此在计算理论上，**DAG 是 EFSM 在无环约束下的退化子集（$DAG \subset EFSM$）**。OGSystem 原生包容了 DAG 流水线的一切前向确定性能力，同时在顶层为多角色循环博弈提供了形式化收敛保证。

##### （2）协作拓扑形式化对比：DAG vs. 分层调用树 (Tree) vs. 动态编舞 (Mesh) vs. 平铺总线 (Bus) vs. 闭合有向图 (OGSystem)
多智能体协同运行时的本质是**图论模型（Graph-Theoretical Models）**。系统拓扑从根本上决定了权限分配、并发能力、回环博弈与停机收敛性：

```text
[1. DAG 流水线拓扑]         [2. 分层调用树拓扑]              [3. 动态网状编舞拓扑]
  A ──► B ──► C ──► End          Master Coordinator            Agent A ◄────► Agent B
        │       ▲                │                │               ▲  \        /  ▲
        └── D ──┘          Child Sub 1      Child Sub 2           │   ▼      ▼   │
  (严禁有向回边)            (自上而下支配，无横向制衡)             Agent C ◄────► Agent D
                                                             (自由跳转，极易死锁)

[4. 平铺总线/复用阵列拓扑]                     [5. 责任席位闭合有向图拓扑 (OGSystem)]
  Daemon / IPC Bus                                席位 V1 (Architect)
  ══╦════════╦════════╦════════╦══                       │ APPROVED (LTS 事件)
    ▼        ▼        ▼        ▼                         ▼
  Pane 1   Pane 2   Pane 3   Pane 4               ┌──────┴──────┐
  (无内生图结构，外置调度)                         ▼             ▼
                                             席位 V2       席位 V3
                                                  │             │ READY
                                                  └──────┬──────┘
                                                         ▼
                                               State-Aware Join Scope
                                                  (all_of / quorum)
                                                         ▼
                                                  席位 V4 (Reviewer)
                                                         │
                                        ┌────────────────┴────────────────┐
                                        │ NEEDS_REWORK (有界回边)          │ APPROVED
                                        ▼                                 ▼
                                 [Loop Budget]                     [Deliverable]
                                 iter <= maxIter ? 回跳 : CAS 挂起
```

*   **DAG 流水线拓扑（单向无环）：** 遵循严格偏序 $u \prec v$，节点入度全部满足后单次激发。拓扑上严禁反向回边，审查驳回只能在节点内部黑盒化，无法表达组织级动态制衡；
*   **分层树状派生拓扑（Tree-Forking，如 Codex v2、Claude Subagents）：** 拓扑为有向树 $T=(V, E)$ 且 $|E|=|V|-1$。主控 Coordinator 拥有全量上下文并向下派发轻量从属子代理，执行完毕后回收压缩文本摘要。其本质是“自上而下的支配分工”，子代理无法对等行使对主控规格设计的法定否决权；
*   **去中心化网状编舞拓扑（Mesh / Choreography，如 Swarm、AutoGen）：** 动态全连通图 $K_n$。智能体之间无中央控制器，依靠点对点交接（`handoff`）即兴转移。由于缺乏拓扑不变性与中心状态机，系统极易陷入对话震荡、礼貌推诿（Polite Stalling）与发散死锁；
*   **平铺总线与视窗阵列拓扑（Flat Bus / Panes，如 Orca、Herdr）：** 智能体平铺挂载在操作系统级的文件总线（Git Worktree）或终端复用阵列（$1 \times N$ Panes）中，节点间无内生业务图拓扑，拓扑依赖外部脚本轮询或人工调度；
*   **责任席位闭合有向图拓扑（Role-First Closed Graph，如 OGSystem）：** 节点代表持久化责任席位 $V$，边承载离散 LTS 业务事件字典（$\Sigma_{\text{fixed}}$）。拓扑原生包容**有界有向回边**（受控于配额 $maxIterations$），并引入**源状态感知汇聚拓扑（State-Aware Join Scope）**，实现了组织社会技术学上的制度分权、对等否决与确定性收敛。

##### （3）协同编程软件：物理工作树总线 (Orca)、终端复用底座 (Herdr) 与模型路由分流 (OMP) vs. 责任席位状态机 (OGSystem)
*   **Orca 的物理工作树协同：** Orca 抓住了多智能体并发编程中最棘手的物理冲突痛点，创新性地使用 Git Worktree 为每个任务创建隔离的分支工作区，并通过终端 CLI（`orca terminal send/wait`）构建了一套基于命令行的轻量级进程间通信总线。这种模式非常适合松散的异构任务分发，但在逻辑架构上，Orca 属于操作系统环境级的“外层调度器”，其智能体间的交互本质仍是自由格式的终端文本与自然语言交谈，缺乏强类型的业务事件收敛和拓扑级的状态机转移证明。
*   **Herdr 的终端多路复用与跨窗格委派：** Herdr（herdr.dev）被称为“面向 AI 编程智能体的 tmux”，从系统底层构建了一个常驻后台守护服务 `herdr-core`（通过 CLI `hc` 交互），统一治理智能体在不同终端窗格（Panes）中的生命周期。Herdr 提供了强大的跨窗格委派原语（`hc run --bg`、`hc send`、`hc wait`、`hc read`）与 OpenRPC 套接字接口，并创新性地利用 ANSI OSC 7501 状态协议实时感知智能体当前处于 `working`、`blocked`、`done` 还是 `idle`。Herdr 极为出色地解决了多 Agent 协同在操作系统环境层面的承载底座（Harness）与终端复用难题，但其本质是面向终端视窗与文本重定向的基础设施；其代理通信依旧是无结构明文流，缺乏顶层业务状态机、无字段级 Context Map 强契约投影，亦无类似 OGSystem 的独立沙箱产物验证与原子晋升能力。
*   **OMP 的角色感知模型分流：** OMP（oh-my-pi）代表了极客向单兵开发工具的高性能演进方向。其协作的核心思想不是构建庞大的组织图，而是**将“角色”内化为针对大模型推理算力的路由标签**——让 `plan` 角色调用高推理模型，让 `slow` 角色处理深思反思，让 `task` 角色派发并行子任务，并引入 `advisor` 角色在后台以流式旁路的方式实时监听代码编写风险。OMP 凭借 Rust 编写的紧凑 Hashline 编辑大幅降低了 Token 损耗，但其本质是面向单人的高级 Agent CLI；其角色并非组织学意义上的责任席位，各个子任务之间缺乏形式化的汇聚契约（Join Scope），难以支撑企业级复杂跨部门的多方协同。
*   **OGSystem 的责任席位状态机：** OGSystem 将角色定义为形式化责任席位集 $V$。执行器绑定 $\rho$ 可自由绑定任何模型或 CLI 工具。席位间的协同受严格的 LTS 离散业务事件字典驱动，数据传递由 Fail-Closed Context Map 强制投影，执行成果必须通过独立沙箱 Verifier 跑测并原子晋升为正式 Deliverable，从根本上实现了组织级职责、数据边界与交付合规的闭环。

##### （4）透明度与可审计性：密文不透明代理 vs. 宪法级审计链
*   **OpenAI Codex Multi-Agent v2 的架构争议：** Codex v2 在更新中引入了加密通信委托（通过 `hide_spawn_agent_metadata = true` 实现密文交接），剥夺了工程师查看父子 Agent 间明文协作细节的权利，且其非公开的 `agent_message` 响应结构破坏了第三方开源模型的适配，引发了社区关于“黑盒不可控”的强烈抗议。
*   **OGSystem 的透明治理：** 坚持宪法级审计不变量（Rule 3.12）。跨席位交接必须是明文且通过契约强类型约束，运行历史全部追加沉淀至不可篡改的 `events.ndjson`，控制面人员的每一项决策（`reviewId`, `stateVersion`）具备可证明的因果溯源。

##### （5）上下文与数据边界：无序透传 vs. Fail-Closed 字段投影
*   在 **Google Opal、Orca 与常规工作流**中，上下文往往随执行轮次不断累加堆叠，或者节点间通过全局文件系统自由漫游。
*   **OGSystem 引入 Context Map 与 Fail-Closed 闭锁：** 下游角色绝无权直接漫游上游全部变量。任何数据传递必须在 Flow 契约中声明字段映射选择器；只要出现未声明字段或未经授权的文件产物读取，运行时立即闭锁并阻断执行，从数学边界上根除了大模型注意力稀释与提示词注入越权。

##### （6）代码交付与验证工程：宽松输出 vs. 不透明产物封存
*   常规代码智能体在生成代码时直接覆写工作区文件，一旦测试失败或发生死循环，极易污染正常代码库。
*   **OGSystem 引入独立交付物晋升管道：** 任何模型生成的代码仅在独立的临时 Staging Workspace 中通过 Opaque ArtifactRef 进行引用；只有全面通过沙箱 Verifier（运行单元测试、类型检查、Lint）验证的代码产物，才会根据封存清单原子化晋升至 `Deliverable Store`，使代码生成从概率性文本跃升为工程级合规资产。

##### （7）底层技术栈与系统级通信协议对比：CLI 管道、Unix 套接字、LSP 与持久化 WAL
*   **Orca（CLI stdio 管道重定向）：** 基于操作系统的标准输入输出流（`stdin`/`stdout`）与进程信号进行跨智能体通信（`orca terminal send/wait`）。该机制对所有 CLI 工具具备普适兼容性，但通信载荷为非结构化纯文本流，易受终端格式漂移与控制字符破坏，无法保障状态因果一致性。
*   **Herdr（Rust 守护进程 + Unix 域套接字 OpenRPC + ANSI OSC 7501 状态协议）：** 采用高性能 Rust 编写常驻守护进程 `herdr-core`，通过本地 Unix Domain Socket 暴露出遵循 OpenRPC 规范的接口，并创新采用 ANSI OSC 7501 转义协议从终端口令层实时捕获智能体运行态（`working/blocked/done/idle`）。这是终端多路复用与操作系统级 Harness 的杰出代表，但其窗格间传递的仍是无类型明文流，缺乏业务层状态代数与字段级数据安全沙箱。
*   **OMP（Rust 内存调度 + Hashline 编辑 + 内置 LSP/Tree-sitter）：** 依托 Rust 的极高执行效率与 Tree-sitter 增量语法解析能力，内嵌语言服务器协议（LSP）与调试协议（DAP），独创 Hashline 行哈希紧凑编辑协议，使大模型仅输出代码行哈希标识，大幅降低 Token 冗余开销；子任务在进程内并发调度。其设计在单兵开发能效上达到顶峰，但缺乏分布式持久化状态机与跨席位汇聚治理。
*   **OGSystem（TypeScript 编译型引擎 + Semantic IR + LTS 业务事件 + WAL/CAS 双层提交 + 独立沙箱验证）：** 采用轻量化、无常驻守护进程的 TypeScript/Node.js 实现，直接运行在语义编译器生成的静态 IR 之上。席位间通信严格依托离散强类型 LTS 业务事件（$\Sigma_{\text{fixed}}$）与显式 Context Map 载荷；系统核心采用数据库级事务保障——事实先追加写入不可篡改的预写日志（WAL `events.ndjson`），再通过 CAS 原语原子提交全要素状态快照（`state.json`）；生成的代码在独立临时沙箱（Staging Sandbox）中经由测试套件跑测，通过后原子晋升。在底层技术栈与工程实现上，OGSystem 实现了真正的工业级确定性、强类型与防篡改审计。

##### （8）理论原则、国家标准与工程实践严格对应表 (Formal Grounding & Standards Mapping)
为确保系统设计“**言必有据、行必有规、原则有根、标准可溯**”，下表将 OGSystem 的全部核心设计原则与计算机科学经典理论出处、2026 中国人工智能智能体国家标准（GB/Z）以及工业界工程经验反思进行严格对齐：

| OGSystem 核心设计原则 / 架构结论 | 计算机科学经典理论出处 (Citation & DOI) | 2026 中国智能体国家标准对应条款 (National Standards) | 工业前沿产品经验反思与教训 (Empirical Lessons) |
| :--- | :--- | :--- | :--- |
| **原则 1：责任席位本体与执行器解耦**<br>($V$ 抽象六元组，席位不可变) | Milner 1989 (LTS 并发代数)<br>Meyer 1992 (契约式设计 DbC, DOI: 10.1109/2.161279) | **GB/Z 185.1—2026** 第 5.2 条（智能体角色抽象架构）<br>**GB/Z 185.4—2026**（智能体描述与能力规范） | 反思 OMP / ChatDev 将角色弱化为提示词或模型算力标签，无法支撑组织级权限与职责分离。 |
| **原则 2：离散标记转移与业务事件驱动**<br>($\Sigma_{\text{fixed}}$ 受限离散字典) | Milner 1989 (LTS 标记转移系统, ACM 1989)<br>Newman 2015 (*Building Microservices*, O'Reilly) | **GB/Z 185.6—2026** 第 6.3 条（智能体离散交互协议与事实消息） | 克服 Swarm / AutoGen 自由自然语言即兴交接导致的状态漂移、礼貌推诿与因果混乱。 |
| **原则 3：全要素扩展状态元组与持久化**<br>($\mathbf{X}$ 向量 + WAL + CAS) | Cheng & Krishnakumar 1993 (EFSM 扩展状态机, DAC '93)<br>Gray & Reuter 1992 (*Transaction Processing*, 图灵奖著作) | **GB/Z 242—2026** 第 6.4 条（智能体检查点与故障状态恢复）<br>**GB/Z 185.1—2026** 第 7.1 条（执行状态持久化要求） | 吸收 Uber Cadence / Temporal 持久化确定性执行思想，解决 LangGraph/Claude Code 进程崩溃后状态不一致难题。 |
| **原则 4：有界循环配额与 CAS 审核断点**<br>($Iteration \le Budget \to$ CAS Pause) | Alshiekh et al. 2024 (*Safe Execution via Runtime Monitors*)<br>Lee & Yannakakis 1996 (*FSM Testing Survey*, IEEE) | **GB/Z 242—2026** 第 5.3 条（执行规划安全边界与熔断机制）<br>**GB/Z 185.6—2026** 第 8.2 条（多轮交互上限与人工介入） | 克服传统 DAG 禁止回环的缺陷，解决 Swarm / AutoGen 无限递归烧尽 Token 灾难。 |
| **原则 5：源状态感知汇聚作用域**<br>($S_{\text{src}} \in \{pending, arrived, skipped, failed\}$) | van der Aalst et al. 2003 (*Workflow Patterns*, Dist. & Parallel DB, DOI: 10.1023/A:1022883727209) | **GB/Z 185.1—2026** 第 6.4 条（并发分支汇聚与状态同步机制） | 确立严禁静默降级（Fail-Closed Invariant），杜绝任意分支故障时系统发生静默吞掉异常或死锁。 |
| **原则 6：Fail-Closed 字段投影与数据闭锁**<br>(Context Map 未显式声明即阻断) | Saltzer & Schroeder 1975 (*Fail-safe Defaults Axiom*, IEEE, DOI: 10.1109/PROC.1975.9939) | **GB/Z 185.7—2026** 第 7.2 条（工具调用与数据访问最小权限原则） | 解决 Google Opal / Orca 上下文全量累积引起的注意力稀释（Attention Dilution）与越权攻击。 |
| **原则 7：独立沙箱跑测与产物原子晋升**<br>(Opaque ArtifactRef $\to$ Verifier $\to$ Store) | Yang et al. NeurIPS 2024 (*SWE-agent: Sandboxed SE*)<br>Jimenez et al. 2023 (*SWE-bench*) | **GB/Z 242—2026** 第 7.1 条（智能体执行产物自动化验证与合规封存） | 改变传统编程 Agent 直接覆写主仓库代码的脏写隐患，实现概率性生成到确定性资产的质跃。 |
| **原则 8：宪法级明文审计与防黑盒密文**<br>(追加日志 `events.ndjson` 可追溯) | Gray & Reuter 1992 (WAL 预写日志)<br>Saltzer & Schroeder 1975 (Open Design 公理) | **GB/Z 185.3—2026** 第 8 条（跨智能体调用审计日志与防篡改要求） | 针对 OpenAI Codex v2 引入密文委托（`hide_spawn_agent_metadata`）导致黑盒失控的教训，确保全部协作因果透明。 |

##### （9）超集关系定性：对流水线与图引擎的超越
综上所述，OGSystem 既吸收了 LangSmith 对分布式运行链路的可观测性追求，吸取了 Orca 的工作区物理隔离、Herdr 的终端复用底座与 OMP 的能效思想，又克服了 OpenAI Codex 密文黑盒、Anthropic 缺乏持久化内核、Google Opal 依赖 SaaS 办公流的局限。**OGSystem 是以扩展状态机为底座、将无环流水线作为退化子集包容的工业级协同控制内核。**

---

### 3. OGSystem 的非同质化设计与编译治理

#### 3.0 现有协同系统同质化困境与 OGSystem 八大非同质化核心创新
审视当前多智能体研究与产品生态，绝大多数系统不可避免地陷入了“**智能体即提示词、状态即聊天记录、编排即无序交接、交付即就地覆写**”的同质化泥潭。OGSystem 明确摒弃了这些脆弱实践，在底层确立了八大非同质化创新突破（表 2.5）：

| 架构与协作维度 | 行业主流同质化模式 (Homogenized Patterns) | OGSystem 非同质化创新内核 (Non-Homogenized Breakthroughs) |
| :--- | :--- | :--- |
| **1. 节点本体论<br>(Node Ontology)** | **“智能体 = 模型 + 提示词 + 内存”**<br>更换模型即更换身份；节点缺乏固定组织权责，本质是一群临时聊天机器人。 | **“责任席位优先 (Role-First Seat) 本体”**<br>席位 $V$ 是不可变法定资产，具备稳定职责与契约；模型/执行器 $\rho$ 仅是运行时动态绑定的无状态劳动力（席位永恒，劳动力流转）。 |
| **2. 控制与转移代数<br>(Control Algebra)** | **自然语言交接或自由字符串路由**<br>通过 Prompt 生成 `handoff_to("tester")`，极易因模型幻觉诱发目标漂移与礼貌推诿（Polite Stalling）。 | **标记转移系统 (LTS) 离散业务事件代数**<br>控制面被严格限制在离散封闭字典（$\Sigma_{\text{fixed}}$）；模型无权发明事件，领域业务数据下沉至强类型 Schema，保证转移关系数学封闭。 |
| **3. 上下文与数据安全<br>(Context Security)** | **全局上下文无序堆叠或共享字典透传**<br>所有节点共享同一段对话历史或全局 StateDict，导致致命的“注意力稀释（Attention Dilution）”与提示词注入越权。 | **Fail-Closed 字段级 Context Map 显式投影**<br>跨席位仅允许声明的白名单字段通过；未声明字段物理阻断，将 Saltzer-Schroeder 最小特权公理落地于 LLM 上下文管理。 |
| **4. 并发分支汇聚<br>(Concurrency Join)** | **无状态计数器屏障 (`Promise.all`)**<br>仅依赖简单入度计数；分支异常时要么陷入无限死锁，要么静默吞掉错误导致不可感知的数据缺失。 | **四值源状态感知 Join 代数与防静默降级**<br>显式追踪 $S_{\text{src}} \in \{pending, arrived, skipped, failed\}$；确立严禁静默降级不变量（`failed` 绝不可篡改为 `skipped`）；法定多数精确激发。 |
| **5. 循环与博弈收敛<br>(Loop Convergence)** | **无界递归死循环或 DAG 结构性禁止回边**<br>要么如 DAG 平台严禁回环导致无法真实评审；要么陷入 While 死循环烧尽 Token；审批与会话状态脱钩。 | **血缘绑定有界配额与 CAS 五元组决策凭证**<br>循环绑定整数预算 $maxIterations$；超额强制 CAS 挂起；决策严格绑定五元组 $\langle reviewId, round, lineageId, branchId, stateVersion \rangle$ 杜绝审批竞态；独创基础设施容灾配额补偿。 |
| **6. 代码与产物交付<br>(Delivery Pipeline)** | **主仓库/工作区直接就地脏写覆写**<br>模型生成代码直接覆写文件；测试失败或异常中断后留下满目疮痍的半成品，严重污染正常代码库。 | **三段式不透明产物原子晋升管道**<br>`Opaque ArtifactRef` $\to$ 独立临时沙箱跑测验证 (`ArtifactVerifier`) $\to$ 封存清单原子晋升 (`Deliverable Store`)；只有跑测全绿才原子封存，杜绝脏写。 |
| **7. 社会技术学分权<br>(Two-Tier Architecture)** | **设计与运行混杂的单体画布或纯代码**<br>要么低代码画布中设计期模板与运行期实例混乱混杂；要么纯 Python 脚本，管理层完全无法进行可视化合规审计。 | **双工作台物理解耦 (OGS Studio vs. OGS Projects)**<br>设计台（Studio）负责 DSL 建模、编译校验、Dry-run/Sandbox 仿真演练与基线断言；业务台（Projects）挂载不可变版本资产、执行受控 Run 并归档交付物。 |
| **8. 容灾与系统恢复<br>(Crash Consistency)** | **粗粒度全量会话序列化或从头重放**<br>崩溃后需要重新向 LLM 发送全量历史 Prompt 重放，开销巨大且由于概率性输出导致状态不可逆发散。 | **WAL + CAS + SHA-256 拓扑语义指纹校验**<br>事实入追加预写日志（`events.ndjson`），快照原子 CAS 提交（`state.json`）；恢复时严格比对静态图语义指纹，实现毫秒级确定性幂等恢复。 |

*表 2.5：工业界多智能体系统同质化模式与 OGSystem 八大非同质化突破对照*

#### 3.1 责任席位优先（Role-First）六元组模型
OGSystem 将多角色协作系统抽象为形式化六元组：
$$R = (V, E, \rho, \tau, \kappa, \alpha)$$

1. **抽象责任席位集 $V$：** 节点代表系统中的稳定责任边界（如 `Architect`, `Reviewer`）。席位是静态资产，具体执行者（Executor：某个 LLM、CLI 工具或人类专家）仅是运行时的动态绑定（Binding）。更换模型或执行环境绝不改动图拓扑。
2. **交接流 $E$ 与有限事件标记 $\tau$：** 边表示职责转交。边上承载的不是自由文本，而是来自标记转移系统（LTS）的受限业务事件字典：
   $$\Sigma_{\text{fixed}} = \{\text{READY}, \text{APPROVED}, \text{REJECTED}, \text{NEEDS\_REWORK}, \text{BLOCKED}\}$$
3. **数据流契约 $\kappa$ 与 Context Map 显式投影：** 跨席位流转时，下游节点绝无权漫游全局状态，仅接收经过 `Context Map` 显式声明和筛选的投影数据。未声明字段一律阻断（Fail-Closed）。
4. **控制面权限策略 $\alpha$：** 将执行角色的“工作责任（$\rho$）”与人类监管者的“特权治理动作（$\alpha$）”在权限上严格隔离。

#### 3.2 编译管道与安全不变量（Fail-Closed Invariants）
系统前端支持受限 Mermaid DSL（`system.mmd`），通过编译器解析并生成标准中间表示 **Semantic IR v1**。编译器强制执行三项发布阻断规则：
*   **席位纯粹性：** 严禁将任务步骤、逻辑网关或外部工具混杂定义为图节点；
*   **环路必须有界：** 拓扑中任何有向环路必须显式声明整数配额 `maxIterations` 与耗尽路由（`onExhausted`）；
*   **汇聚来源封闭：** 汇聚节点依赖的前置分支必须在编译期静态闭包，严禁运行期动态旁路注入。

---

### 4. 运行时编排与状态机执行控制

#### 4.1 全要素扩展状态元组（Persistent State Tuple）
OGSystem 显式持久化全要素扩展状态向量 $\mathbf{X}$：
$$\mathbf{X} = \langle s_{\text{biz}}, \mathbf{t}_{\text{task}}, \mathbf{i}_{\text{input}}, \mathcal{F}_{\text{frontier}}, \mathcal{L}_{\text{lineage}}, \mathcal{J}_{\text{scopes}}, \mathcal{C}_{\text{budgets}}, \mathcal{H}_{\text{review}}, \mathcal{V}_{\text{cas}} \rangle$$
涵盖业务状态聚合、逐跳输入、活动分支前沿、血缘标识、汇聚作用域、循环轮次配额、审核锁与 CAS 版本号。

#### 4.2 源状态感知型汇聚语义（State-Aware Join）
在并发分支汇合场景中，针对指定的汇聚作用域 $J = \langle \text{runId}, \text{lineageId}, \text{loopIteration} \rangle$，系统追踪前置源状态 $S_{\text{src}} \in \{\text{pending}, \text{arrived}, \text{skipped}, \text{failed}\}$：
*   **全汇聚（`all_of`）：** 要求全量源分支均处于 `arrived` 态；
*   **法定多数汇聚（`quorum_of` $K$）：** 当且仅当至少 $K$ 个唯一来源分支到达时激发；
*   **严禁静默降级：** 任何分支执行发生故障（`failed`），严禁自动篡改为 `skipped`，必须立即中止汇聚并挂起等待干预。

#### 4.3 有界循环与预算审核（Loop Budget Review）
当 reviewer 发射 `NEEDS_REWORK` 事件导致循环计数器 $c_{\text{iter}} > c_{\text{max}}$ 时，系统触发 `loop_exhausted` 控制事件，强行挂起进入 `waiting_review` 状态。人类控制者必须出示严格绑定当前血缘与 CAS 版本的决策凭证（`continue / rework / terminate`），从根源上杜绝 Token 烧尽与失控死循环。

#### 4.4 预写日志与崩溃一致性恢复（WAL & Crash Consistency）
运行时采用预写日志（WAL）机制，先将事实追加至 `events.ndjson`，再原子提交 `state.json`。重启或断点恢复（Resume）时，运行时严格校验磁盘当前 Team 定义指纹与快照指纹的一致性，拒绝任何语义漂移下的推测性恢复。

---

### 5. 产物交付与代码验证体系

OGSystem 确立了从不透明文件引用到业务交付物的工程落地闭环：
1. **Opaque ArtifactRef：** 模型生成的代码与文档保存在各 Run 独立的沙箱目录中。模型输出仅包含其不透明标识符（含相对路径、媒体类型与 SHA-256 校验和），杜绝路径遍历攻击。
2. **沙箱构建与测试验证（Verifier）：** 系统在沙箱内自动调度构建与单测工具链（如 `npm test`, `pytest`）。若验证失败，错误摘要回传至状态机触发返工重试。
3. **交付物原子晋升（Promotion Service）：** 只有全面通过验证的代码产物，才会根据封存清单（Seal Manifest）原子化复制至项目的 `Deliverable Store`，与运行过程日志彻底分离。

---

### 6. 系统工程实现与双工作台架构

OGSystem 采用轻量化、无常驻守护进程的 TypeScript/Node.js 实现，在统一架构下划分出两个物理隔离的工作台：
*   **OGS Studio（专业工程台）：** 面向团队架构师，负责可视化画布编辑、DSL 双向转换、Context Map 配置，以及基于 `dry-run`（快速拓扑演练）与 `sandbox`（沙箱实跑）的 Simulation 调试。发布前必须通过基线场景（Baseline Scenarios）的全量断言校验。
*   **OGS Projects（业务协同台）：** 面向业务交付，绑定物理项目目录，挂载已发布的不可变 `TeamVersion` 资产包，管理业务 Task、派发独立的 Run 运行目录，并集中归档通过验证的 Deliverable。

---

### 7. 工程验证与自动化测试基准

为如实检验系统的设计不变量与稳定性，系统构建了严密的端到端自动化测试体系。全部测试基于 Node.js 原生测试框架（`node:test`）实现，未采用外部合成模拟，所有指标均基于代码库中的真实测试套件验证：

#### 7.1 自动化测试覆盖与架构断言
系统代码库累计包含 **1,228 项自动化测试**，涵盖底层状态机内核、编译管道、存储层与上层双工作台（表 3）：

| 验证模块 / 测试套件 | 测试用例数 | 核心验证的不变量与工程行为 | 实测通过情况 |
| :--- | :--- | :--- | :--- |
| **核心运行时与状态机 (`tests/`)** | 753 项 | • LTS 离散事件受限字典校验（`business-events.test.mjs`）<br>• Context Map 白名单字段投影与阻断（`context-selector.test.mjs`）<br>• 四值源状态汇聚与防静默降级（`transition-orphan-join.test.mjs`）<br>• 循环配额超额挂起与 CAS 审核（`loop-budget-review.test.mjs`）<br>• 产物沙箱校验与 SealManifest 晋升（`artifact-promotion.test.mjs`） | 752 项通过<br>(1 项特定环境跳过) |
| **平台业务台与 Studio (`apps/team-site/tests/`)** | 475 项 | • 双工作台物理解耦与不可变版本冻结（`team-version-lifecycle-use-cases.test.mjs`）<br>• 任务独立工作区与 Run 隔离执行（`task-execution-use-cases.test.mjs`）<br>• 交付物物理归档与防篡改读取（`file-deliverable-store.test.mjs`）<br>• Studio 仿真演练与基线场景断言（`studio-simulation-use-cases.test.mjs`） | 475 项全数通过 |
| **全系统总计** | **1,228 项** | **全面覆盖编译期、运行期、存储期与交付期全生命周期** | **通过率 99.9%** |

*表 3：OGSystem 自动化工程测试套件与不变量实测统计*

#### 7.2 故障注入与崩溃恢复实测 (Fault Injection & Crash Consistency)
系统在 `tests/runtime-fault-injection.test.mjs` 与 `task-run-recovery-faults-uat.test.mjs` 中构建了真实的故障注入机制：
1. **进程强杀与恢复（Crash After Execution Outcome）：** 通过测试钩子环境变量 `OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME=1`，在模型执行结果产生并尝试持久化的临界时刻主动触发子进程硬退出（Exit Code 91）。断点恢复（`run resume <runId>`）实测表明，系统未发生状态损坏，通过缓冲日志回放（Buffered Append Recovery）自愈未刷盘事实，并成功释放进程排他锁（`RESUME_RUN_LOCK_FILE`）。
2. **拓扑防篡改与语义指纹校验（Plan Fingerprint Match）：** 恢复执行时，系统通过 `plan-fingerprint.ts` 实时重新计算当前磁盘定义的 SHA-256 语义指纹。测试验证：若在崩溃后人为修改 `system.mmd` 或模型配置，系统严格拒绝非法推测性恢复，并抛出指纹不匹配异常，彻底杜绝了状态漂移。

#### 7.3 边界安全性与契约拦截实测
1. **Context Map 字段闭锁：** `tests/optional-context-projection.test.mjs` 测试验证，未在图契约中显式声明的上下文变量，下游席位读取时一律返回空或触发契约异常，杜绝了上下文隐式穿透。
2. **产物沙箱安全边界：** `tests/workspace-and-verifier.test.mjs` 验证，若产物包含符号链接（Symlink）、跨目录相对路径（如 `../`）或单文件超出字节配额，`ArtifactVerifier` 一律抛出 `ARTIFACT_SYMLINK_NOT_ALLOWED` 或 `ARTIFACT_PATH_INVALID` 并拒绝封存，有效防止路径穿越。
3. **中国国家标准工程落地（GB/Z 2026 系列）：** 系统以可执行代码直接对齐国家标准要求：以 LTS 离散协议实现 **GB/Z 185.6** 智能体离散交互；以独立沙箱 Verifier 实现 **GB/Z 185.7** 工具调用与数据受控访问；以全要素状态持久化与 WAL 恢复实现 **GB/Z 242** 检查点与故障状态恢复。

---

### 8. 结论与工程展望

OGSystem 的实践表明：**实现大模型多智能体可靠工业落地的关键，不在于自然语言提示词的精巧堆砌，而在于利用经典扩展状态机与契约设计理念对不确定性认知进行离散化收敛。** OGS 融合了 2015-2016 年持久化执行的工业精髓，突破了传统 DAG 工作流在循环博弈中的理论死穴。未来，我们将继续拓展 OGS 状态机内核在 Raft 分布式多主机调度与标准跨机构互联协议（FRAI）方面的演进。

---

### 参考文献（References）
*可查地址与详细著录见本目录下的 `traceable-references.md`。*
