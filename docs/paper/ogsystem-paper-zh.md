# 面向多角色 AI 协作的契约化运行治理：OGSystem V2 设计与工程证据

**作者：** Fred [真实姓名]  
**作者身份/单位：** 独立研究者（Independent Researcher），[省份/城市]，中国  
**联系邮箱：** [your-email@domain.com]  
**ORCID:** [https://orcid.org/0009-XXXX-XXXX-XXXX]  
**开源代码库与基准测试:** [https://github.com/your-username/ogsystem-core]（内核与可复现套件遵循 Apache-2.0 许可证开源；上层商业协作工作台与专有角色资产保持私有）

---

### 摘要
多角色 AI 协作可用于软件开发、办公文档、咨询分析和结构化讨论等项目任务。无论交付物是源代码还是其他文件，运行时都需要显式处理职责、授权、并发修改、状态一致性、恢复与交付。DAG 表达有向无环依赖；带有返工边的协作需使用支持循环的图或其他控制结构，不同工作流产品对相关能力的实现各异。

本文报告 **OGSystem（简称 OGS）**，一个面向有界多角色协作项目的持久化 EFSM Runtime 工程实现。其应用范围不限于软件开发，而是面向办公及更广泛的文件型协作任务；软件开发、管理咨询和结构化辩论是当前已有工程运行记录的场景。从组织管理视角，OGS 将职责分化、执行授权、协作协调和运行问责映射为 Role 合同、Harness 策略、事件/Join 控制与 Evidence/Release 记录；这一映射是运行时工程化，不是完整组织治理方案，最终责任仍属于部署组织和人类决策者。OGS 组合既有状态机、工作流、持久化执行、最小授权和 Git 版本控制思想，形成责任 Role 合同、离散业务事件、Context Map、状态感知 Join 与共享 Workspace/Release 状态协议。V2 中每个 Project 使用一个文件型 Git + LFS Workspace，内容可包括代码、文档及其他项目文件；Role 从固定 `baseCommit` 在隔离 Worktree 中工作，以提交快照和 Framework 管理的状态更新维持内容一致性并支持恢复与回退。Framework 管理 canonical lock、expected-head CAS、只读 `WorkspaceRef`、Evidence 和 Release Materialization。工程验证包括当前全量 587 项自动化测试（核心套件 486 通过、1 项按 Windows 平台跳过、Team Site 100 通过，0 失败；早期 819 项为旧版 v1 测试归档前的历史计数）、基于 `gpt-6-luna` 的 Python 计算器团队运行记录（2026-11-15 8 项 unittest 与 2026-11-16 10 项测试通过），以及 Codex Planner 到 OpenCode Implementer、管理咨询和结构化辩论等 Project Run/Release 记录。Codex 到 OpenCode 的一次运行中 Implementer 没有产生文件改动，且现有证据未证明跨模型泛化、双向互操作或图执行引擎可替换。本文的贡献主张限于上述语义与协议的系统组合及其工程实现；跨场景治理效益和学术新颖性仍需受控实验及更广泛先行工作比较。

**关键词：** 多角色 AI 协作；AI 运行治理；职责与授权；扩展有限状态机（EFSM）；共享 Workspace；状态恢复；可审计交付

---

### 1. 引言与背景演进

#### 1.1 大模型工程的演进脉络与领域断点
已有研究和产品逐步形成提示词设计、上下文管理、工具执行、迭代控制和图工作流等技术方向。它们并非严格的历史阶段，也不是互斥范式；具体系统可组合多种做法。本文关注这些机制如何与责任、状态、授权及工程交付边界结合。

#### 1.2 持久化工作流系统的工程参照
声明式工作流和持久化执行为当前多智能体运行时提供了工程参照。AWS Step Functions 和 Uber Cadence 是工作流产品实例；Temporal 延续持久化执行系统的发展路线。状态机、WAL、事件历史和崩溃恢复的理论基础早于这些产品。本文不声称软件行业曾经历单一路径的编排迁移，也不将当下多智能体系统描述为对微服务危机的重复。

#### 1.3 相关产品与研究路线
Anthropic 的 *Building Effective Agents* 总结了 routing、orchestrator-workers、evaluator-optimizer 等组合式工作流模式；OpenAI Swarm 展示了轻量 handoff 抽象；Google Gemini 1.5 研究长上下文能力；xAI 等厂商探索推理与工具增强。这些材料提供设计背景，并非对 OGS 的比较评估。本文不将其概括为路线冲突，也不从其公开资料未描述某种能力推断系统缺少该能力。

#### 1.4 OGSystem 的核心定位
**OGSystem（简称 OGS）是一个面向有界社会技术协作的事件驱动持久化 EFSM Runtime 工程实现。** OGS 组合既有状态机、工作流、持久化执行、最小授权和 Git 版本控制思想，形成责任 Role 合同、离散业务事件、Context Map、状态感知 Join 与共享 Workspace/Release 状态协议。在本文定义下，DAG 可表示为无环、单次激活的受限情形；该模型关系不表示对现有图运行时的功能或性能优势。

#### 1.5 组织管理视角下的 AI 运行治理
本文将经典组织管理作为工程设计透镜，而不是把 AI Agent 等同于员工或法人责任主体。分工与协调理论强调职责分化后仍需可理解的协调机制；委托代理理论关注授权、信息不对称和监督成本（Mintzberg 1979; Eisenhardt 1989，见 `traceable-references.md`）。OGS 将这些问题限定到有明确目标、交付物和验收条件的多角色协作项目：谁负责、可以调用什么、如何交接和汇聚、如何核验和发布。其场景可包括办公文档、分析报告、讨论结论和软件制品。组织及其人类负责人仍承担最终决策和责任；Evidence 也不等于完整法规合规或防篡改审计。

| 组织管理问题 | OGS V2 运行控制 | 可检验的长期价值假设 |
| --- | --- | --- |
| 职责分化与任务责任 | Business 层 Role Contract 固定责任边界，执行器单独绑定 | 在模型或 Harness 调整时，职责定义和验收标准可保持可追溯；稳定性需跨版本实验验证。 |
| 授权与委托 | Technical Binding 配置 Harness、`allowedTools` 和 EnvironmentIntent；Runtime 冻结可执行权限 | 降低越权工具和环境调用进入执行阶段的机会；需以授权绕过和拒绝正确率实测。 |
| 协调与监督 | 业务事件、Context Map、Join、Loop 和 Review 限定交接与决策点 | 降低跨 Role 状态歧义和人工核对负担；需以错误率和审查工时验证。 |
| 问责与持续改进 | Evidence、commit provenance、Workspace 与 Release 状态提供逐 Run 记录 | 支持事后还原责任 Role、输入版本和发布结果；需测量还原完整度、耗时及多轮策略变更后的漂移。 |

这一映射与 NIST AI RMF 1.0（DOI: `10.6028/NIST.AI.100-1`）的 Govern、Map、Measure、Manage 风险管理职能相关，生成式 AI Profile（NIST AI 600-1，DOI: `10.6028/NIST.AI.600-1`）提供补充风险背景；OGS 当前只实现受限工作流中的部分运行控制与证据记录，不声称实现完整组织治理生命周期或符合该框架。自主 Agent 综述（Wang et al. 2024）和 2025 年 Agent 综述（Xi et al. 2025）描述了持续扩大的架构、工具、评测和风险面，但不替代 OGS 自身的受控验证。

#### 1.6 近三年研究对照（2024–2026）

下表选取已由 DOI、ACL Anthology、OpenReview 或 arXiv 元数据核验的研究，作为 OGS 四层架构和共享协作数据状态的相关工作对照。OpenAlex 引用数仅表示公开索引覆盖度（检索日期 2026-11-19），不代表 OGS 实证结果。

| 研究 | 主要关注 | 对 OGS 的对照关系 |
| --- | --- | --- |
| SWE-agent（NeurIPS 2024） | Agent-Computer Interface、工具边界、软件工程执行 | 对照 Technical Binding / Execution；OGS 增加 WorkspaceRef、canonical lock 与 Release Materialization。 |
| SWE-bench（ICLR 2024） | 真实 GitHub issue 的端到端修复评测 | 对照 Evidence；OGS 将验证结果绑定到 Run Evidence 和 commit provenance。 |
| ChatDev（ACL 2024） | 角色化对话和软件开发协作 | 对照 Business / Role Contract；OGS 使用 LTS 事件和显式 HandoffProjection。 |
| OSWorld（NeurIPS 2024） | 真实计算机环境中的多模态任务执行 | 对照 Execution / Evidence；OGS 将 Workspace 内容和证据分开持久化。 |
| MALLM、SWE-bench Goes Live、CGM（2025） | 多智能体框架、持续评测、仓库级代码图 | 对照通信编排、动态验证和 Workspace 内容关系；OGS 保持单一 Git/LFS 内容事实。 |
| Wang 等（2024）自主 Agent 综述 | 汇总自主 Agent 的架构、记忆、规划、工具和评估路线 | 用于扩大相关工作覆盖与校准分类；综述不证明 OGS 特定 Workspace/Release 协议的新颖性。 |
| Xi 等（2025）Agent 综述 | 总结 LLM Agent 的能力、架构与研究方向 | OpenAlex cited_by_count 为 3,314（2026-11-19）；用于定位 Agent 研究趋势，不作为 OGS 治理有效性证据。 |
| OpenHands（ICLR 2025；预印本 2024） | 开放式软件开发 Agent 平台及运行时 | 直接相关的软件 Agent 执行与工作区参照；本文尚未完成 WorkspaceRef、合并、Evidence、Release 协议的同条件逐项比较。 |

---

### 2. 主流协同系统调查与结构性深度对比

为深入探讨多智能体协同运行时的系统本质，本节对当前全球代表性厂商的自研协作产品（OpenAI Codex Multi-Agent v2、Anthropic Claude Subagents、Google Opal、LangChain LangGraph/LangSmith）、新兴通用智能体（Manus、腾讯 WorkBuddy）、主流多智能体协作编程软件（Orca、OMP / oh-my-pi、Aider）、经典多智能体框架（MetaGPT、AutoGen、ChatDev）以及主流工作流平台（n8n、Dify、Coze）进行形式化计算模型调查与全景对比。

#### 2.1 多智能体编排能力与协作模型的形式化分类学（Orchestration & Collaboration Taxonomy）
下列分类是用于组织相关工作的分析视角，不是完备或互斥的产品分类。外部系统条目概述其公开产品文档、论文或代码中可确认的能力；不同版本和配置可能不同。没有在所引资料中确认某项能力，不表示产品不具备该能力。表格不是同条件功能或性能评测。

1. **前向有向无环数据流图（Forward Acyclic Dataflow DAG Pipeline，如 n8n、Dify、Coze Workflow、Google Opal）**
   *   **协作模型：** 基于拓扑偏序的单向数据流管道；前置依赖就绪即激发单次激活。
   *   **核心特点：** DAG 模型本身表示无环依赖；循环、条件路由和持久化由具体产品及其附加控制结构决定。
   *   **底层技术栈：** 依具体产品而异；本条不对各产品未公开的内部组件作推断。
2. **分层树状派生与上下文汇聚（Hierarchical Tree-Forking / Subagents，如 Anthropic Claude Code、OpenAI Codex Multi-Agent v2）**
   *   **协作模型：** 主控-工作者（Master-Worker）树状调用模型；主控 Agent 持有全局上下文，按需派生临时子 Agent 并在完成后回收文本摘要。
   *   **核心特点：** 通过父子关系派发和汇集任务；上下文暴露、权限和控制边界依产品及配置而异。
   *   **底层技术栈：** 依具体产品而异；公开文档和代码库列有 CLI、工具接口及子任务能力。
3. **去中心化动态交接与即兴编舞（Decentralized Handoffs Choreography，如 OpenAI Swarm、AutoGen GroupChat、ChatDev）**
   *   **协作模型：** 基于点对点交接（P2P Handoffs）或大模型意图路由的无中心自主编舞。
   *   **核心特点：** 通过 handoff 或群聊调度在角色间传递控制；持久化、终止和状态约束取决于具体框架及其部署方式。
   *   **底层技术栈：** 各项目实现与依赖不同；本分类不把 Python、Function Calling 或内存事件循环归为所有项目共有的技术栈。
4. **终端多路复用与跨窗格委派运行底座（Terminal Multiplexing & Cross-Pane Delegation，如 Herdr `herdr.dev`）**
   *   **协作模型：** 操作系统级的多智能体终端视窗复用与跨窗格委派调度（"tmux for AI Agents"）。
   *   **核心特点：** 公开提供多窗格管理、跨窗格委派原语和 OSC 7501 状态报告。
   *   **底层技术栈：** 高性能 Rust 核心守护进程（`herdr-core`），Unix Domain Socket 进程间通信，OpenRPC 协议规范，PTY/TTY 终端多路复用驱动。
5. **物理隔离工作树与终端代理总线（Worktree-Isolated Terminal Fleet Bus，如 Orca `onorca.dev`）**
   *   **协作模型：** 基于 Git 物理工作树隔离的文件总线与终端代理车队（Fleet）架构。
   *   **核心特点：** 使用独立 Worktree 和终端会话隔离任务工作区；Worktree 隔离减少同一工作目录中的并发写入，但不消除分支合并冲突。
   *   **底层技术栈：** Node.js / TypeScript CLI 客户端，Git Worktree 引擎，操作系统终端 stdio 管道重定向，Playwright 无头浏览器测试套件。
6. **角色感知模型分流与伴生守护者（Role-Based Model Dispatcher & Advisor Companion，如 OMP `omp.sh`）**
   *   **协作模型：** 算力标签化模型路由器与后台流式伴生监听架构。
   *   **核心特点：** 将“角色”映射为面向不同推理特性的异构模型调度策略（`plan/slow/task/advisor`）；引入流式旁路监听与内置 P0–P3 缺陷专用评审；单兵开发能效极高。
   *   **底层技术栈：** 高性能 Rust，Hashline 行哈希紧凑编辑引擎，Tree-sitter 增量语法解析，内嵌语言服务器协议（LSP）与调试适配器协议（DAP）。
7. **消息池订阅与黑板架构（Pub-Sub Blackboard / Message Pool，如 MetaGPT、OpenHands）**
   *   **协作模型：** 角色、消息或共享工作区驱动的协作模型；各项目的机制不同。
   *   **核心特点：** 相关项目公开了角色化流程、消息传递或事件驱动 Agent 能力；本条不将它们归为同一黑板实现。
   *   **底层技术栈：** 各项目实现与部署选项不同；本分类不将 Python、Docker、Pydantic 或事件队列归为共有依赖。
8. **代码级自由状态图（Imperative Cyclic StateGraph，如 LangChain LangGraph + LangSmith）**
   *   **协作模型：** 编程式有向循环状态图与条件边跳转。
   *   **核心特点：** 提供节点、边、条件路由、循环和 checkpoint 等图运行能力；状态结构和应用级合同由开发者定义。
   *   **底层技术栈：** LangGraph 提供图执行能力，LangSmith 是独立的追踪与评估产品；检查点后端取决于具体配置，不将 PostgreSQL、Redis 或 SQLite 视为必选依赖。
9. **责任席位优先的持久化扩展状态机（Role-First Persistent EFSM over LTS，如 OGSystem 本产品）**
   *   **协作模型：** 闭合有向图（Closed Directed Graph，DAG 的形式化超集），抽象责任席位集 $V$ 与具体执行器 $\rho$ 严格解耦。
   *   **核心特点：** 离散业务事件字典驱动转移（LTS $\Sigma_{\text{fixed}}$）；全要素扩展状态元组 $\mathbf{X}$ 持久化；Fail-Closed Context Map 字段级投影；有界循环配额与 CAS 人工审核断点；四层产品架构；Git + LFS Workspace 与 Release Materialization。
   *   **底层技术栈：** 编译型 TypeScript / Node.js 运行时，受限 Mermaid 语义编译器（Semantic IR），追加式预写日志（WAL `events.ndjson`），原子快照提交（CAS `state.json`），Git/LFS、Worktree、canonical lock、Workspace content verifier 与 Materialization verifier。

#### 2.2 结构性全景对比矩阵（Structural Comparison Matrix）
表 1 与表 2 汇总截至 2026-11-19 查阅的部分公开文档和项目资料所描述的能力。斜线连接的表头表示为节省篇幅合并展示多个独立产品，不代表它们构成一个实现；涉及差异时在单元格中注明能力归属。产品行为依版本、配置与部署方式而异；这些表不是同条件对照实验，也不从未列出的能力推断产品不具备该能力。

| 结构维度 | **OpenAI Codex v2 / Swarm** | **Anthropic Subagents / Claude Code** | **Google Opal (Agent Mode)** | **LangGraph + LangSmith** | **Manus / 腾讯 WorkBuddy** | **OGSystem (本系统)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 图本体原语<br>(Node Primitive)** | Codex：Agent task/thread；Swarm：Agent/function | 任务子智能体 (Task Subagent) | 可视化工作流/Agent 步骤 | LangGraph：图节点；LangSmith：可观测性产品 | Agent/task 抽象依具体产品而异 | **抽象责任席位<br>(Responsibility Seat)** |
| **2. 拓扑与转移<br>(Topology & Transition)** | Codex：任务委派；Swarm：函数 handoff | 子智能体委派与工具调用 | 工作流步骤与分支 | LangGraph 节点、边和条件路由 | 任务编排依具体产品而异 | **LTS 标记转移系统<br>(声明的离散业务事件字典)** |
| **3. 状态与持久化<br>(State & Persistence)** | 会话与运行状态依产品而异 | 会话与运行状态依产品而异 | 工作流状态依产品而异 | 公开提供 checkpoint 与追踪能力 | 运行或环境状态依产品而异 | **持久化扩展状态、WAL/CAS 与语义检查** |
| **4. 数据边界治理<br>(Data Boundaries)** | 上下文和委派控制依产品与配置而异 | 上下文和委派控制依产品与配置而异 | 工作区和步骤上下文依产品行为而异 | 应用状态结构与投影由开发者定义 | 上下文和工作区控制依产品与配置而异 | **合同声明的 Fail-Closed Context Map 投影** |
| **5. 循环与控制面<br>(Loop & Governance)** | 委派与控制能力依产品和配置而异 | 委派与控制能力依产品和配置而异 | 工作流控制能力依产品和配置而异 | 支持条件路由与循环 | 任务控制能力依产品和配置而异 | **血缘绑定循环预算与绑定状态版本的审核决策** |
| **6. 交付物闭环<br>(Workspace Delivery)** | 终端代码生成 / Git PR 补丁 | 本地文件读写 / 终端命令输出 | 自动生成 Drive 文档 / 电子表格 | 文本流 / 任意应用侧写入 | 自动生成演示文稿、研报、Web 页面 | **WorkspaceRef 内容验证<br>$\to$ Release Materialization manifest / output digest** |
| **7. 审计与透明度<br>(Audit & Transparency)** | 委派元数据和运行记录依产品及配置而异 | 公开的终端调用和工具执行记录 | 产品特定的运行记录 | LangSmith 提供追踪与评估能力 | 产品特定的会话与执行记录 | **运行事件追加记录 (`events.ndjson`)<br>与 Evidence 投影** |
| **8. 核心底层技术栈<br>(Underlying Tech Stack)** | Codex 与 Swarm 分别按各自公开资料描述，不合并为同一栈 | 依各自产品公开资料 | 依产品公开资料；不推断内部组件 | LangGraph 与 LangSmith 是独立产品；具体语言和 checkpoint 后端依版本/配置 | 依具体产品公开资料 | **TypeScript/Node.js、Semantic IR、WAL/CAS、Git/LFS Workspace、Verifiers** |

*表 1：全球主流多智能体自研协同系统与 OGSystem 的结构性全方位对比*

针对专业软件工程与代码研发场景，表 2 进一步将 OGSystem 与当前主流的多智能体协作编程软件进行结构性解构：

| 结构对比维度 | **Orca (StablyAI)** | **Herdr (HerdrDev)** | **OMP (oh-my-pi / omp)** | **Aider (Architect/Editor)** | **OGSystem (本系统)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **核心协作模型<br>(Collaboration Model)** | **工作树隔离终端代理总线**<br>(Worktree-Isolated Terminal Fleet Bus) | **终端多路复用与跨窗格委派底座**<br>(Terminal Multiplexer & Cross-Pane Delegation) | **角色感知模型分流与伴生评审**<br>(Role Model Routing & Subagent Review) | **双人结对互锁协作**<br>(Paired Architect-Editor Ping-Pong) | **责任席位扩展状态机**<br>(Role-First EFSM over LTS) |
| **执行隔离边界<br>(Execution Boundary)** | 物理隔离：每个 Agent 独占 **Git Worktree**、独立终端与浏览器 | 视窗与进程隔离：常驻后台守护进程 `herdr-core`、多窗格 (Panes) 与工作区 | 逻辑隔离：单进程内上下文分片，本地环境直接执行 | 共享工作区：主 Git 分支，通过内存 Prompt 进行角色交接 | **单一 Project Git + LFS Workspace；Framework 管理 Role Worktree、canonical ref、lock 与 CAS** |
| **智能体通信机制<br>(Inter-Agent IPC)** | 终端 CLI 命令流：`orca terminal send`、`orca terminal wait` | 跨窗格 CLI 原语：`hc run --bg`、`hc send`、`hc wait`、`hc read` 与 OpenRPC 域套接字 | 内存调度：`task` 工具派发子代理，`advisor` 旁路流式监听 | 提示词双向交替：Architect 输出计划，Editor 生成并应用 Diff | **LTS 离散业务事件字典** ($\Sigma_{\text{fixed}}$) 与显式数据负载 |
| **角色本体本质<br>(Role Ontology)** | 动态派生的命令执行进程 / 终端会话 | 挂载于终端窗格的 CLI 智能体子进程 (如 Pane 宿主) | **异构模型调度配置标签**<br>(plan/slow/task/advisor 模型策略) | 固定双人静态提示词角色<br>(思考者 vs. 执行者) | **形式化责任席位集 $V$**<br>(组织职责与执行器动态解耦) |
| **上下文边界控制<br>(Context Map Control)** | 依产品与配置而异 | 依产品与配置而异 | 依产品与配置而异 | 依产品与配置而异 | **合同声明的 Context Map 投影** |
| **循环与状态收敛<br>(Loop & Governance)** | 公开任务与控制能力依配置而异 | 公开任务与控制能力依配置而异 | 公开运行时任务控制能力 | 公开评审与编辑迭代能力 | **血缘绑定循环预算与绑定状态版本的审核决策** |
| **Workspace 与 Release 验证<br>(Workspace and Release Verification)** | Worktree 与 Git 协作能力 | 终端与仓库协作能力 | LSP 与评审能力 | 测试命令与 Git 能力 | **WorkspaceRef 验证、provenance、canonical lock/CAS 与 Release Materialization** |
| **状态一致性与恢复<br>(Crash Consistency)** | 恢复行为依产品与配置而异 | 恢复行为依产品与配置而异 | 恢复行为依产品与配置而异 | 恢复行为依产品与配置而异 | **WAL、CAS 快照与语义指纹检查；故障注入覆盖已指定的崩溃窗口** |
| **核心底层技术栈<br>(Underlying Tech Stack)** | Node.js / CLI + Git Worktree + Headless Browser 驱动 | Rust (`herdr-core`) + Unix Domain Socket + OpenRPC + ANSI OSC 7501 | 高性能 Rust + Hashline 行哈希引擎 + 内置 LSP/DAP + Tree-sitter | Python + Tree-sitter AST repo-map + Git Diff 引擎 | **TypeScript/Node.js + Semantic IR + WAL/CAS + Git/LFS Workspace + Verifiers** |


*表 2：主流多智能体协作编程软件与 OGSystem 的协作模型及结构性对比*

#### 2.3 关键结构的本质差异剖析

##### （1）编排机制与计算模型：DAG 与 EFSM 的模型包含关系
*   **DAG 与迭代协作的表达差异：** DAG 按无环拓扑偏序执行；显式返工边需要由支持循环的运行时或额外控制结构表达。不同工作流产品对循环、状态和恢复的支持并不相同，本文不将 n8n、Dify、Coze 等所有实现归为单一能力模型，也不据此主张其无法治理多角色流程。
*   **普通 FSM 与显式扩展状态：** 普通有限状态机仅维护有限控制状态集，其转移关系为 $(ControlState, Event) \to NextControlState$。OGS 采用扩展状态承载循环计数、分支状态和业务数据等运行信息；这一选择与 EFSM 先行理论一致，不据此推断所有普通 FSM 实现均存在状态爆炸或不能安全承载数据。
*   **扩展有限状态机（EFSM）对 DAG 的模型包含：**
    OGSystem 采用形式化扩展状态机模型：
    $$(ControlState, Event, \mathbf{X}) \xrightarrow{Guard} (NextControlState, \mathbf{X}', EmittedFacts)$$
    其中 $\mathbf{X}$ 为显式建模的持久化全要素扩展状态向量。当协作图拓扑中不存在有向回边，且扩展状态中循环计数器 $c_{\text{iter}} \equiv 1$、汇聚作用域退化为静态前向依赖时，EFSM 的状态转移语义可退化为标准 DAG 的拓扑偏序推进。因此在本文的形式化定义下，**DAG 可视为 EFSM 的无环退化子集（$DAG \subset EFSM$）**；这是一项模型包含关系，不是对所有 DAG 引擎性能或正确性的实证证明。

##### （2）协作拓扑形式化对比：DAG vs. 分层调用树 (Tree) vs. 动态编舞 (Mesh) vs. 平铺总线 (Bus) vs. 闭合有向图 (OGSystem)
多智能体协同运行时的本质是**图论模型（Graph-Theoretical Models）**。系统拓扑从根本上决定了权限分配、并发能力、回环博弈与停机收敛性：

```text
[1. DAG 流水线拓扑]         [2. 分层调用树拓扑]              [3. 动态网状编舞拓扑]
  A ──► B ──► C ──► End          Master Coordinator            Agent A ◄────► Agent B
        │       ▲                │                │               ▲  \        /  ▲
        └── D ──┘          Child Sub 1      Child Sub 2           │   ▼      ▼   │
  (静态无环拓扑)            (父子委派拓扑)                         Agent C ◄────► Agent D
                                                             (动态点对点交接)

[4. 平铺总线/复用阵列拓扑]                     [5. 责任席位闭合有向图拓扑 (OGSystem)]
  Daemon / IPC Bus                                Role A (Architect)
  ══╦════════╦════════╦════════╦══                       │ APPROVED (LTS 事件)
    ▼        ▼        ▼        ▼                         ▼
  Pane 1   Pane 2   Pane 3   Pane 4               ┌──────┴──────┐
  (无内生图结构，外置调度)                         ▼             ▼
                                             Role B       Role C
                                                  │             │ READY
                                                  └──────┬──────┘
                                                         ▼
                                               State-Aware Join Scope
                                                  (all_of / quorum)
                                                         ▼
                                                  Role D (Reviewer)
                                                         │
                                        ┌────────────────┴────────────────┐
                                        │ NEEDS_REWORK (有界回边)          │ APPROVED
                                        ▼                                 ▼
                                 [Loop Budget]                     [Release]
                                 iter <= maxIter ? 回跳 : CAS 挂起
```

*   **DAG 流水线拓扑（单向无环）：** 按偏序关系推进节点；循环、条件路由和恢复能力取决于具体产品实现，不从 DAG 这一抽象本身推断产品限制；
*   **分层树状派生拓扑（Tree-Forking，如 Codex、Claude Subagents）：** 通过父子关系派发并回收子任务结果；上下文、权限和父子控制边界因产品与配置而异；
*   **点对点交接拓扑（如 Swarm、AutoGen）：** 通过 handoff 等机制将控制权转给其他 Agent；具体系统可采用不同的调度、状态持久化和终止策略；
*   **终端与工作树协作环境（如 Orca、Herdr）：** 提供终端复用、进程委派或工作树隔离等运行环境能力；上层协作拓扑和业务状态语义由具体系统决定；
*   **OGS 责任席位协作图：** 节点代表责任席位 $V$，边承载声明的 LTS 业务事件（$\Sigma_{\text{fixed}}$）；执行合同、字段投影、有界循环、源状态 Join 和 Workspace/Release 状态由 OGS 定义。这是架构描述，不构成对其他拓扑的优越性证明。

##### （3）协同编程软件：物理工作树总线 (Orca)、终端复用底座 (Herdr) 与模型路由分流 (OMP) vs. 责任席位状态机 (OGSystem)
*   **Orca 的物理工作树协同：** Orca 提供 Git Worktree 隔离和终端 CLI 委派能力。本文将其作为执行环境和任务协调能力的公开参照；不据此判断其在其他使用方式下缺少业务状态语义，也不将 Worktree 隔离归为 OGS 创新。
*   **Herdr 的终端多路复用与跨窗格委派：** Herdr 提供常驻守护服务、跨窗格委派接口和 OSC 7501 状态报告能力。本文将其作为终端协作 Harness 的公开参照；本文未对其内部业务合同、数据授权和交付能力作系统验证，因此不作缺失或优劣判断。
*   **OMP 的角色感知模型分流：** OMP（oh-my-pi）公开了角色标签、模型路由、子任务和评审等 CLI 能力。本文将其作为角色化 Agent 工具链的参照；不同产品对角色、权限和汇聚的语义不同，本文不将 OMP 归结为单一角色定义，也不推断其不适用于组织级场景。
*   **OGSystem 的责任席位状态机：** OGSystem 将角色定义为责任席位集 $V$，并通过执行器绑定 $\rho$ 连接 Agent Backend。席位协作使用声明的 LTS 业务事件和字段投影合同；Framework 管理 Worktree、canonical lock/CAS、checkpoint、Evidence manifest 与 Release Materialization。该组合是本文的系统实现对象，尚不据此主张对其他系统的普遍优越性。

##### （4）透明度与可审计性：运行记录与审计合同
*   Agent Backend 对委派元数据和交互记录的暴露方式由具体产品、版本和配置决定；本文不将某一种产品设置概括为通用的黑盒属性。
*   OGS 将运行事件追加记录于 `events.ndjson`，并记录与审核决策相关的标识和状态版本；该记录支持本系统内的审计追踪，不等同于防篡改存储或形式化因果证明。

##### （5）上下文与数据边界：Context Map 字段投影
*   多智能体和工作流系统采用不同的上下文存储及传递策略；本文不据产品类别推断其均使用全量上下文透传。
*   OGS 通过 Context Map 声明跨 Role 字段投影，并默认不投影 `WorkspaceRef`；运行时对未授权字段和文件引用执行拒绝策略。该设计落实最小授权原则，但本文未测量其对注意力稀释或提示词攻击风险的影响。

##### （6）代码交付与验证工程：Commit-Backed Workspace Delivery
*   Agent 工具对工作区和文件的修改边界由产品与权限配置决定，不作“常规代码智能体”统一概括。
*   OGS 中 Role 从固定 `baseCommit` 进入隔离 Worktree，由 Framework 创建 Role commit 并记录 provenance；Workspace verifier 检查路径、符号链接及 Git/LFS 内容，Join 生成 merge commit，Release 从 release commit 生成 Materialization manifest 与 output digest。只有 published Release 暴露下载引用。

##### （7）底层技术栈与系统级通信协议对比：CLI 管道、Unix 套接字、LSP 与持久化 WAL
*   **Orca 与 Herdr：** 分别作为 Worktree 隔离/终端委派及多窗格运行时的公开参照；本文未对其端到端业务状态、授权和审计合同作统一实验比较。
*   **OMP（Rust 内存调度 + Hashline 编辑 + 内置 LSP/Tree-sitter）：** 该项目使用 Rust、Tree-sitter、LSP/DAP 和 Hashline 行哈希编辑，以行标识定位代码修改，并在进程内调度子任务。本文将其作为单工作站 Agent 工具链进行对照；不据此判断其在其他任务或配置下的整体能效，也不将其具体实现能力归为 OGS 的对照创新。
*   **OGSystem（TypeScript 编译型引擎 + Semantic IR + LTS 业务事件 + WAL/CAS + Git/LFS Workspace）：** 采用轻量化、无常驻守护进程的 TypeScript/Node.js 实现，直接运行在语义编译器生成的 IR 之上。席位间通信严格依托离散强类型 LTS 业务事件（$\Sigma_{\text{fixed}}$）与显式 Context Map 载荷；事实先追加写入预写日志（WAL `events.ndjson`），再通过 CAS 原语提交全要素状态快照（`state.json`）。Framework 管理 Worktree、Role/merge commit、canonical lock、Git/LFS provenance、Workspace 内容验证和 Release Materialization，形成可恢复、可审计的交付链。

##### （8）理论来源、潜在标准相关性与工程实践
下表区分计算机科学理论来源、按标准名称推测的潜在主题相关性和工程背景。GB/Z 编号及条款仅作为待核验线索，本文没有核验条款文本，不构成标准映射、符合性判断或经验优越性证明：

| OGS 设计原则 / 架构结论 | 计算机科学理论来源 (Citation & DOI) | 潜在标准主题 (GB/Z；条款未核验) | 工业工程背景 (非同条件比较) |
| :--- | :--- | :--- | :--- |
| **原则 1：责任席位本体与执行器解耦**<br>($V$ 抽象六元组，席位不可变) | Milner 1989 (LTS 并发代数)<br>Meyer 1992 (契约式设计 DbC, DOI: 10.1109/2.161279) | **GB/Z 185.1—2026**（总体架构；条款待核验）<br>**GB/Z 185.4—2026**（智能体描述；条款待核验） | OGS 将责任模型与 Backend/model 绑定分开表示；本文不据此作 OMP 或 ChatDev 的比较结论。 |
| **原则 2：离散标记转移与业务事件驱动**<br>($\Sigma_{\text{fixed}}$ 受限离散字典) | Milner 1989 (LTS 标记转移系统, ACM 1989)<br>Newman 2015 (*Building Microservices*, O'Reilly) | **GB/Z 185.6—2026**（智能体交互；条款待核验） | 为自由文本交接增加可校验的事件路由和数据合同；对照不构成对 Swarm / AutoGen 所有使用方式的实证结论。 |
| **原则 3：全要素扩展状态元组与持久化**<br>($\mathbf{X}$ 向量 + WAL + CAS) | Cheng & Krishnakumar 1993 (EFSM 扩展状态机, DAC '93, DOI: 10.1145/157485.164585)<br>Gray & Reuter 1992 (*Transaction Processing*, 图灵奖著作) | **GB/Z 242—2026**（智能体技术要求；条款待核验）<br>**GB/Z 185.1—2026**（总体架构；条款待核验） | 结合持久化执行与事务恢复先行实践；本文未对 LangGraph、Claude Code 等进行相同故障条件下的比较。 |
| **原则 4：有界循环配额与 CAS 审核断点**<br>($Iteration \le Budget \to$ CAS Pause) | Alshiekh et al. 2018 (*Safe Reinforcement Learning via Shielding*, AAAI 2018)<br>Lee & Yannakakis 1996 (*FSM Testing Survey*, IEEE) | **GB/Z 242—2026**（智能体技术要求；条款待核验）<br>**GB/Z 185.6—2026**（智能体交互；条款待核验） | 为显式循环增加预算和审核断点；这些控制不构成对其他框架风险的实测比较。 |
| **原则 5：源状态感知汇聚作用域**<br>($S_{\text{src}} \in \{pending, arrived, skipped, failed\}$) | van der Aalst et al. 2003 (*Workflow Patterns*, Dist. & Parallel DB, DOI: 10.1023/A:1022883727209) | **GB/Z 185.1—2026**（总体架构；条款待核验） | OGS 规定 `failed` 不可静默降级为 `skipped`；这是针对指定状态转移的 fail-closed 约束，不是对任意分支故障均无死锁的普遍证明。 |
| **原则 6：Fail-Closed 字段投影与数据闭锁**<br>(Context Map 未显式声明即阻断) | Saltzer & Schroeder 1975 (*Fail-safe Defaults Axiom*, IEEE, DOI: 10.1109/PROC.1975.9939) | **GB/Z 185.7—2026**（智能体工具调用；条款待核验） | OGS 将最小特权应用于跨 Role 字段投影；本文未通过对照实验测量注意力稀释或提示词攻击风险变化。 |
| **原则 7：Workspace 内容验证与 Release 物化**<br>(WorkspaceRef $\to$ Verifier $\to$ Materialization) | Yang et al. NeurIPS 2024 (*SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*)<br>Jimenez et al. ICLR 2024 (*SWE-bench*) | **GB/Z 242—2026**（智能体技术要求；条款待核验） | Git/LFS commit、只读引用和发布后物化构成 OGS 的可追溯交付路径；此处不主张 Git、manifest 或 provenance 机制原创。 |
| **原则 8：运行事件记录**<br>(`events.ndjson` 与审核状态标识) | Gray & Reuter 1992 (WAL 预写日志)<br>Saltzer & Schroeder 1975 (Open Design 公理) | 不主张条款级标准映射；本文所引 GB/Z 185.3 是身份管理部分。 | OGS 记录运行事件和审核状态标识以支持系统内审计追踪；不据此主张防篡改存储或形式化因果证明。 |

##### （9）模型包含关系与相关系统定位
本文将无环、单次激活的 DAG 表示为 EFSM 的一种受限情形。这是对本文模型定义的说明，不构成对 LangGraph 或其他图引擎的性能、可靠性或功能优越性结论。LangSmith、Orca、Herdr、OMP、ChatDev 等项目在可观测性、隔离执行、终端协作和角色化开发方面提供相关能力与对照；本文讨论其公开能力边界，不据此判断这些项目在所有应用中存在普遍局限。

---

### 3. OGSystem 的设计归属与编译治理

#### 3.0 研究问题
本文是一项系统设计与工程验证报告，不是受控性能比较。研究问题限定为：

| 研究问题 | 关注内容 | 本文证据 |
| --- | --- | --- |
| **RQ1：** V2 如何表达并执行责任、技术绑定、执行与证据之间的边界？ | 四层职责、Role 合同、Backend/Harness 绑定、工具授权和环境策略解析。 | V2 合同、运行时实现与自动化回归测试；不据此推断相对其他产品的安全优势。 |
| **RQ2：** 多 Role 并发工作如何共享 Workspace 内容事实，并把 Join、Evidence 与 Release 状态连接起来？ | 单 Project Workspace、固定 `baseCommit`、只读 `WorkspaceRef`、四值 Join 源状态及 Release 状态。 | 合同、实现与故障注入记录用于核对协议关系和指定失败路径；端到端运行只证明各记录中列明的具体链路，不代表完整状态协议均已端到端验证。 |
| **RQ3：** 现有工程证据支持哪些运行能力，哪些泛化主张仍未验证？ | 指定不变量、真实模型任务及一次跨 Agent Backend 流程的可运行性和边界。 | 当前 587 项自动化测试记录、Python 计算器运行记录、一次 Codex 到 OpenCode Project Run；Implementer 未产生文件变更，不证明下游实际消费 `WorkspaceRef`，也不证明跨模型泛化、双向互操作或图引擎可替换。 |

这些问题描述设计及其工程验证范围，不预设方案具有学术新颖性或优于相关系统。

#### 3.1 现有协同系统同质化困境与 OGS 新颖性边界
本节区分已有技术、OGS 的组合性工程贡献和尚未被直接验证的研究主张，不把公开的 LangGraph、LTS/EFSM、Git、WAL/CAS、最小特权或 Role-based Agent 能力重复归为 OGS 创新。表 2.5 是设计维度对照，不等同于八项独立学术发明。

**理论设计创新与工程底座的明确界定：**
1. **理论与架构设计创新（论文核心创新价值）：** OGS 核心创新在于构建了**面向多智能体社会化协作的责任席位扩展状态机（Role-First EFSM over LTS）**。通用图执行框架（如 LangGraph 原生）仅将状态视为弱类型的字典对象、将节点转移视为任意代码执行；2026 年顶会前沿探索中，NeuralFSM（ACL 2026）将多 Agent 求解抽象为有限状态执行过程、Agent-SAMA（AAAI 2026）协同维护 FSM 状态机进行故障自愈、GraphFlow（ICML 2026）通过图拓扑管理多 Agent 状态，HEXIS（2026）与 Sun 等人（2026）探索了 EFSM Skill 编译与外部状态控制——这些最新研究有力印证了“以状态机治理大模型执行不确定性”已成为顶级学术共识；但现有研究大多停留在单 Agent 内部提示词、内存变量或 UI 操作的状态约束。OGS 将经典 EFSM 形式化推进至多 Agent 组织社会技术协作——确立不可变的责任席位本体 ($V$)、受限业务事件驱动跃迁 ($\Sigma$)、Fail-Closed 上下文投影守卫条件、有界循环配额与终止路径、四值汇聚代数 ($S_{src} \in \{pending, arrived, skipped, failed\}$) 以及状态跃迁与物理资产快照 (`WorkspaceRef`) / Release 物化状态机的原子绑定。这套状态机形式化模型构成了本文的主要理论与设计创新。
2. **工程实现底座：** 在工程上，OGS 同时兼顾并实现了类似 LangGraph 与 Temporal 的**全流程可追溯可审计保障**（基于 WAL `events.ndjson`、CAS `state.json` 与 Git Commit 不可变历史）。2026 年最新研究中，Auditable Agents（Nian 等人 2026）系统形式化了智能体可审计性的五大基石（动作可恢复性、生命周期覆盖、策略可检验性、责任归属、证据完整性），TraceDev（ISSTA 2026）实证了跨阶段制品可追溯图对消除多 Agent 协作漂移的关键作用，Automata from Agent Traces（Cho 等人 2026）实证发现智能体的全局行为拓扑本质上由部署环境和 Harness 状态机决定；OGS 的工程实现恰好在底层以单一文件工作区、原子 CAS 快照与加密签名 Release 兑现了这些审计维度与拓扑控制。全流程可审计性是企业级落地的关键工程保障，而面向多角色的扩展状态机模型则是支撑其协作确定性的理论核心。

##### 先行工作与公开能力归属

下表说明 OGS 采用了哪些已有思想或项目能力，以及论文中的候选贡献落在哪里。“采用/借鉴”指技术来源和相关工作关系，不表示 OGS 直接复制特定实现；候选贡献也不表示已完成穷尽式新颖性检索。

| 先行工作或公开能力 | 已公开内容 | OGS 中的采用方式 | 归属判断 |
| --- | --- | --- | --- |
| [LTS](https://dl.acm.org/doi/book/10.5555/63442)、[EFSM](https://doi.org/10.1145/157485.164585)、[Workflow Patterns](https://doi.org/10.1023/A:1022883727209) | 离散状态转移、扩展状态、同步、汇聚和多种 Join 模式已有经典理论。 | 作为 OGS Flow、循环和 Join 语义的理论基础。 | 状态机和一般 Join 能力不是 OGS 原创；候选贡献限于特定源状态、防降级约束与 Workspace/Release 状态的协议组合。 |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) | StateGraph、节点/边执行、条件路由、循环、checkpoint 等图运行能力已公开。 | OGS 当前使用 LangGraph 执行编译后的计划；业务合同、Role、Workspace 和 Release 语义由 OGS 定义。 | 执行引擎能力属于 LangGraph；OGS 与其语义边界的具体组合是候选系统贡献。当前未验证替换为另一种图执行引擎。 |
| [ChatDev](https://aclanthology.org/2024.acl-long.810/)、[MetaGPT](https://openreview.net/forum?id=VtmBAGCN7o)、[AutoGen](https://arxiv.org/abs/2308.08155) | 多角色分工、对话协作、角色化软件开发流程。 | 作为多角色协作的相关工作和对照。 | 多角色协作本身不是 OGS 原创；OGS 的区别主张限于责任席位、合同和授权边界的组合。 |
| [OpenHands](https://arxiv.org/abs/2407.16741) 与 [Orca](https://github.com/stablyai/orca) | OpenHands 研究开放式软件开发 Agent 平台；Orca 公开 Worktree 隔离和终端委派能力。 | 作为 Agent 执行环境、工作区协作与委派的直接相关参照。 | 本文没有对它们与 OGS 的 WorkspaceRef、合并、Evidence 和 Release 协议作同条件逐项比较；共享 Workspace 状态模型仍是待比较的工程集成候选。 |
| [Cadence](https://github.com/uber/cadence) / [Temporal](https://docs.temporal.io/) 与事务恢复实践 | 持久化执行、事件历史、恢复和工作流状态管理。 | 作为运行时持久化、checkpoint/WAL 和故障恢复的工程参照。 | 持久化执行思想已有先例；OGS 的实现和状态合同属于工程组合。 |
| [Saga（1987）](https://doi.org/10.1145/38713.38742)、[Workflow Exception Patterns（2006）](https://doi.org/10.1007/11767138_20)、[Luo et al.（2000）](https://doi.org/10.1023/A:1008388412284) | 长事务分解、补偿执行及工作流异常/失败处理已有研究。 | 作为 Release 多阶段发布、重试/协调及 Join 异常策略的先行背景。 | 分阶段发布、失败策略和异常处理本身不是新主张；这些来源不直接覆盖 OGS 四值 Join 与 Workspace/Release 的特定协议组合。 |
| [Git Worktree](https://git-scm.com/docs/git-worktree) / Git LFS | commit 内容寻址、工作树隔离、对象存储和版本历史。 | 作为 Project 的单一 Workspace 内容事实及 Role 隔离执行基础。 | 底层版本控制机制不是 OGS 原创；单一 Workspace、只读 `WorkspaceRef`、Evidence 与 Release 的协作状态组合是待比较的工程集成候选。 |
| [SWE-agent](https://arxiv.org/abs/2405.15793)；[SWE-bench](https://arxiv.org/abs/2310.06770) | SWE-agent 研究 Agent-Computer Interface 与软件工程 Agent；SWE-bench 提供真实 GitHub issue 修复基准。 | 分别作为执行/工具交互及真实仓库任务评估的相关工作。 | 两者不证明 OGS 交付协议新颖，也不构成 OGS 的实证证据。 |
| [Chubby](https://www.usenix.org/legacy/event/osdi06/tech/full_papers/burrows/burrows.pdf)、[in-toto](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias) 与 [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) | 分布式锁与 fencing/sequencer、软件供应链 provenance 和构建来源证明已有公开方案。 | 作为 canonical lock/CAS、提交 provenance、Evidence manifest 与 Release 记录的工程参照。 | 锁、CAS 和 provenance 单项机制不是 OGS 原创；候选贡献是其在单一 Workspace 多 Role 协作与发布协议中的组合。 |
| [Saltzer–Schroeder 最小特权原则](https://doi.org/10.1109/PROC.1975.9939) | 默认拒绝与最小授权等安全原则。 | 用于解释 Context Map 和 `HandoffProjection` 的 fail-closed 设计。 | 安全原则已有先例；具体字段投影合同及其与 WorkspaceRef 的衔接是 OGS 的设计选择。 |
| 四层产品责任划分 | 常见的软件分层与控制面/执行面/审计面分离思想。 | OGS 以 Business、Technical Binding、Execution、Evidence 组织产品责任。 | 产品架构选择，不单独主张学术创新。 |

实现边界也需区分两种“引擎”：LangGraph 是当前已验证的图执行引擎；Codex 与 OpenCode 是 Agent Backend/Harness。2026-11-19 的正式 V2 证据记录了 Codex Planner 到 OpenCode Implementer 的一次真实 Project Run 和已发布 Release。该次运行中 Planner 生成了 `WorkspaceRef`，但 OpenCode 角色没有产生文件改动，故未证明 Implementer 实际消费该引用；两端使用同一基础模型 `gpt-6-luna`，OpenCode 记录为 provider-qualified ID `codex-gateway/gpt-6-luna`。因此它证明的是一次跨 Agent Backend 流程及 Release 可运行，不证明跨模型泛化、双向互操作或图执行引擎可替换。详见[正式运行证据](../development/evidence/v2-formal-cross-backend-project-release-2026-11-19.md)。

基于当前相关工作和仓库实现，本文将以下内容作为候选系统集成贡献，而非已确认的学术创新：语义合同边界；单一 Workspace 状态模型；包含四值源状态和声明式异常策略的 Join/Release 协议组合。Join/Release 的具体状态不变量有直接实现证据；语义合同边界和共享 Workspace 状态模型仍需与 OpenHands、Orca 及持久化工作流系统开展同条件逐项比较。现有材料不足以排除同质先行方案，因此不主张首创或相对优势。

| 候选贡献 | 对应研究问题 | 支持证据 | 结论边界 |
| --- | --- | --- | --- |
| 语义合同边界与四层责任划分 | RQ1 | V2 设计合同、运行时配置解析和回归测试 | 已实现的领域建模与工程边界；不是独立学术创新，也未证明优于其他系统或可移植到另一图执行引擎。 |
| 单一 Workspace 状态模型 | RQ2 | Workspace 合同、commit/WorkspaceRef/Evidence/Release 实现、故障注入记录 | 已实现的 V2 工程集成；OpenHands、Orca 等直接参照尚未完成同条件协议比较。 |
| 四值 Join 源状态与 Join/Release 状态连接 | RQ2 | Join policy 实现、Workspace/Release 合同及指定失败路径测试 | 源码实现了 `failed` 粘滞不变量，但未找到专门断言 failed 不会被后续 skipped 覆盖的测试；一般 Join 和四值枚举本身不主张新颖，学术新颖性未确认。 |
| 工程可运行性与后端边界 | RQ3 | 当前 587 项测试记录、Python 计算器运行记录、一次跨 Agent Backend Project Run | 支持有限工程可行性，不支持性能、安全效果、跨模型泛化或图引擎可替换结论。 |

四层产品架构、适配器接线、测试数量和 Python 计算器运行属于工程实现证据；它们不能单独证明学术新颖性、跨系统优越性、长期稳定性或国家标准合规性。

| 架构与协作维度 | 行业主流同质化模式 (Homogenized Patterns) | OGS 设计画像与新颖性边界 |
| :--- | :--- | :--- |
| **1. 节点本体论<br>(Node Ontology)** | **“智能体 = 模型 + 提示词 + 内存”**<br>部分系统将角色与特定模型/会话绑定，职责边界依实现而异。 | **责任席位与执行器分离**<br>OGS 将稳定 Role Contract 与运行时 Backend/模型绑定分别建模；角色化协作已有先例，此处是 OGS 的领域建模选择。 |
| **2. 控制与转移代数<br>(Control Algebra)** | **自然语言交接或自由字符串路由**<br>通过 Prompt 生成 `handoff_to("tester")`，可能造成目标漂移或路由不确定。 | **标记转移系统 (LTS) 离散业务事件代数**<br>控制面限制在声明的事件字典（$\Sigma_{\text{fixed}}$）；模型不能直接引入未声明事件，业务数据由 Schema 约束。 |
| **3. 上下文与数据安全<br>(Context Security)** | **共享历史或状态字典**<br>具体系统对共享状态与投影的控制方式不同，未作逐产品同条件测量。 | **Fail-Closed 字段级 Context Map 显式投影**<br>OGS 仅允许合同声明的字段跨 Role 投影；这是最小特权原则在本系统中的具体应用，不表示已消除所有提示词注入风险。 |
| **4. 并发分支汇聚<br>(Concurrency Join)** | **Join / Synchronization 模式已有工作流理论与框架实现**<br>同步、OR-Join、quorum 等一般汇聚能力不是 OGS 首创。 | **四值源状态跟踪与防静默降级**<br>OGS 追踪 $S_{\text{src}} \in \{pending, arrived, skipped, failed\}$，并约束 `failed` 不可被静默改写为 `skipped`。候选贡献限于这一特定状态不变量与交付协议的组合。 |
| **5. 循环与博弈收敛<br>(Loop Convergence)** | **无界递归或 DAG 结构性禁止回边**<br>无界循环可能不收敛；无回边的图不表达显式返工。 | **血缘绑定有界配额与 CAS 决策凭证**<br>循环绑定整数预算 $maxIterations$；超额进入 CAS 审核断点；决策绑定 $\langle reviewId, round, lineageId, branchId, stateVersion \rangle$，降低过期决策生效风险。 |
| **6. 代码与产物交付<br>(Delivery Pipeline)** | Agent 工具对工作区的修改边界依产品和权限配置而异；本文未作逐产品比较。 | **WorkspaceRef 与 Release 物化管道**<br>Workspace 内容由 Git/LFS commit 版本化；只读 `WorkspaceRef` 经过内容验证，Release 从 `releaseCommit` 生成 Materialization manifest、output digest 和受控下载引用。 |
| **7. 社会技术学分权<br>(Four-Layer Architecture)** | **不同产品形态**<br>画布、代码和运维视图的职责划分因产品而异，不能一概而论。 | **四层产品架构**<br>OGS 以 Business、Technical Binding、Execution、Evidence 组织产品责任；Studio、Team Site、CLI 是跨层投影。这是产品架构选择，不单独主张学术创新。 |
| **8. 容灾与系统恢复<br>(Crash Consistency)** | **粗粒度会话恢复或从头重放**<br>恢复策略不同，可能重新调用模型并产生额外成本或输出差异。 | **WAL + CAS + SHA-256 拓扑语义指纹校验**<br>事实追加至 `events.ndjson`，快照经 CAS 提交至 `state.json`；恢复时检查计划语义指纹，并通过故障注入测试覆盖指定崩溃窗口。 |

*表 2.5：工业界多智能体系统同质化模式与 OGS 设计画像及新颖性边界对照*

#### 3.2 责任席位优先（Role-First）六元组模型
OGSystem 将多角色协作系统抽象为形式化六元组：
$$R = (V, E, \rho, \tau, \kappa, \alpha)$$

1. **抽象责任席位集 $V$：** 节点代表系统中的稳定责任边界（如 `Architect`, `Reviewer`）。席位是静态资产，具体执行者（Executor：某个 LLM、CLI 工具或人类专家）仅是运行时的动态绑定（Binding）。更换模型或执行环境绝不改动图拓扑。
2. **交接流 $E$ 与有限事件标记 $\tau$：** 边表示职责转交。边上承载的不是自由文本，而是来自标记转移系统（LTS）的受限业务事件字典：
   $$\Sigma_{\text{fixed}} = \{\text{READY}, \text{APPROVED}, \text{REJECTED}, \text{NEEDS\_REWORK}, \text{BLOCKED}\}$$
3. **数据流契约 $\kappa$ 与 Context Map 显式投影：** 跨席位流转时，下游节点绝无权漫游全局状态，仅接收经过 `Context Map` 显式声明和筛选的投影数据。未声明字段一律阻断（Fail-Closed）。
4. **控制面权限策略 $\alpha$：** 将执行角色的“工作责任（$\rho$）”与人类监管者的“特权治理动作（$\alpha$）”在权限上严格隔离。

#### 3.2 编译管道与安全不变量（Fail-Closed Invariants）
系统前端支持受限 Mermaid DSL（`system.mmd`），通过编译器解析并生成标准中间表示 **Semantic IR**；其 `SemanticIR.version` 与外层 `ogsContractVersion: 2` 分别记录，不再保留旧版运行时兼容分支。编译器强制执行三项发布阻断规则：
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
*   **多数汇聚（`quorum_of` $K$）：** 当达到配置阈值的唯一来源分支到达时满足汇聚条件；后续迟到来源作为证据记录，不改变已提交结果；
*   **失败状态保持：** `failed` 不得静默改写为 `skipped`。源失败由 `failurePolicy`（`wait`、`fail`、`quorum_continue`）处理；`all_of` 中必需来源为 `skipped` 时失败。超时由 `onTimeout` 决定 `fail`、`quorum_continue`、`pause` 或 `terminate`；`quorum_continue` 仅适用于 quorum，未达到阈值时失败。

#### 4.3 有界循环与预算审核（Loop Budget Review）
当 reviewer 发射 `NEEDS_REWORK` 事件且循环预算耗尽时，系统触发 `loop_exhausted` 并进入 `waiting_review`。人类控制者提交与当前血缘和 CAS 状态版本绑定的决策（`continue / rework / terminate`）。该机制限制配置内的返工循环，不保证防止所有 Token 消耗或运行故障。

#### 4.4 预写日志与崩溃一致性恢复（WAL & Crash Consistency）
运行时采用预写日志（WAL）机制，先将事实追加至 `events.ndjson`，再原子提交 `state.json`。重启或断点恢复（Resume）时，运行时严格校验磁盘当前 Team 定义指纹与快照指纹的一致性，拒绝任何语义漂移下的推测性恢复。

---

### 5. Workspace 共享协作与可审计交付

V2 不把共享可写目录当成交接协议。每个 Project 只有一个 Git + LFS Workspace；所有 Role 从
固定 `baseCommit` 进入隔离 worktree，Framework 创建并记录 Role commit，Join 在独立 merge
worktree 中集成候选。合并冲突产生 `join_conflict` 并暂停流程，canonical ref 保持不变。

跨 Role 文件交接使用只读 `WorkspaceRef`，包含 Workspace ID、完整 commit、仓库相对路径和
digest；未显式授权的引用默认不投影。Checkpoint、Git commit/LFS object provenance 与 Run
Evidence 形成双向审计链，worktree 本地路径不作为恢复身份。

canonical ref、restore、Release publication 和其他权威引用更新必须取得 canonical lock，随后
校验 `expectedCanonicalHead` 并执行 CAS。陈旧 head、锁失效和外部直接写入均 fail closed；候选
commit 保留用于重试或 rebase，不覆盖最新 canonical 内容。

Release 默认使用 `mergeCommit` 作为 `releaseCommit`；仅当发布元数据或其他权威 Workspace 内容
变化时才创建子 commit。Framework 从 release commit 生成 Materialization manifest 和 output
digest，完成验证并持久化后才进入 `published`，此前的输出和 download reference 对消费者不可见。

#### 5.1 共享协作数据状态模型

V2 的共享协作数据不再以“产物引用”或“晋升对象”组织，而由以下状态关系构成：

| 数据对象 | 关键状态或字段 | 状态含义与约束 |
| --- | --- | --- |
| Project / Workspace | `workspaceId`、canonical ref、canonical HEAD | 一个 Project 只有一个 Git + LFS Workspace；Git commit 是唯一内容版本事实。 |
| Role work | `baseCommit`、`worktreeId`、`branch`、`roleCommit` | Role 只能在 Framework 创建的隔离 Worktree 中工作；commit 产生后才可形成 WorkspaceRef。 |
| Handoff | `workspaceRefs[]`、`WorkspaceRef` | 默认空投影；只有显式授权的 commit/path/digest 引用可跨 Role 读取，不授予写权限。 |
| Checkpoint / Evidence | `state`、`branchId`、`lineageId`、`round`、`loopIteration`、`stateVersion`、commit refs | Checkpoint 保存工作流恢复状态，Evidence manifest 汇总事件、checkpoint、日志、验证、provenance 和 Review。 |
| Canonical lock | `owner`、`leaseUntil`、`fencingToken`、`expectedCanonicalHead` | 保护 canonical ref、restore、Release publication 等权威变更；陈旧 head 必须 fail closed。 |
| Join / integration | candidate commits、`mergeCommit`、`join_conflict` | Merge Worktree 集成不抢 canonical lock；冲突只写 Evidence，canonical ref 保持不变。 |
| Release / Materialization | `prepared -> materialized -> ref_updated -> published` 或 `failed`；`releaseCommit`、manifest、`outputDigest` | Release 是发布记录，不是第二版本系统；只有 `published` 才公开 download reference。 |

因此，`WorkspaceRef`、Run Evidence、Release 和 Materialization 是 V2 唯一公共文件与交付边界；
Manifest 不创建新的内容历史，checkpoint 不创建平行状态枚举，Release 状态也不复制为第二套事件模型。

该设计从根本上解决了现有协作框架普遍存在的**“破坏性原地写入（Destructive In-place Mutation）”**难题。现有主流多智能体系统（如 ChatDev、MetaGPT、CrewAI、AutoGen 等）在文件型协作中普遍采用平铺共享目录，各 Agent 对文件进行原地覆写。当后续的 Editor、Reviewer 或下游专员修改产物时（无论是多章节研报、咨询方案、财务测算表还是代码模块），前序角色的中间草稿被直接抹除。这在企业级场景与合规审计中带来三大致命隐患：
1. **中间过程不可审计（Loss of Intermediate Auditability）：** 各角色的独立贡献被抹去，事后无法审计是哪一个 Agent 引入了事实性错误、违规数据或幻觉推断；
2. **不可逆的内容丢失与静默退化（Irreversible Content Loss）：** 后续审查角色若发生幻觉或过度概括，前序专家角色产出的有效章节与推导过程会被永久删除，且因缺乏版本对象而无法查看 diff 或一键回滚；
3. **并发脏写冲突（Concurrent Dirty Writes）：** 多角色并行协同编辑交叠文件时，缺乏并发控制，最终产物取决于随机的写完成顺序。

OGS 通过为每个 Role 分配基于 `baseCommit` 的物理隔离 Git Worktree、强制要求中间修改必须形成不可变 Git Commit、且跨角色交接仅传递密码学寻址的只读 `WorkspaceRef`，将软件工程与通用办公知识工作中的每一次角色动作转化为可精确比对、可完整还原、不可篡改的版本对象，从而在企业协作中实现了全流程的中间状态可审计与可追溯性。该设计同时回应了 2026 年多智能体代码协同前沿研究（如 STORM, Liu & Dong et al. 2026, arXiv:2605.20563）指出的朴素 Git worktree 隔离将冲突推迟到事后合并的痛点；OGS 通过 Role 契约与 Context Map 约束写权限、以 expected-head CAS 串行化权威变更、并在非权威 Merge Worktree 中隔离冲突，保证了冲突发生时安全 fail-closed 而不污染权威主干。

---

### 6. 系统工程实现与四层产品架构

OGSystem 采用轻量化 TypeScript/Node.js 实现。V2 的产品责任边界为：
* **Business：** Role Contract、Flow Semantic IR、Join、Loop、Review 与 Handoff 语义。
* **Technical Binding：** Harness Template 配置 Backend、Model、`allowedTools`、`EnvironmentIntent` 与限制；`EnvironmentIntent` 是意图输入，不是已解析的执行策略。
* **Execution：** Git、LFS、Worktree、canonical lock、CAS、合并、恢复与 Materialization。
* **Evidence：** checkpoint、事件、provenance、Evidence manifest 与 Release record。

OGS Studio、Team Site 与 CLI 是这些层的配置和运行投影，不构成第五层；
`WorkspaceRef` 是跨层只读值对象，不是新的产品层或第二套内容版本模型。

#### 6.1 工具授权与执行目录投影
每个可执行 Role 必须绑定 Harness Template；Technical Binding 配置 Backend、Model、`allowedTools` 和 `EnvironmentIntent`。Runtime 在 Backend 启动前解析并冻结 `verifiedTools`、`allowedTools`、`EffectiveEnvironmentPolicy` 及其摘要；Adapter 将有效策略映射为 backend-native 配置。可执行工具集合为 `allowedTools ∩ verifiedTools`，只存在于 Runtime 内存中。未知、动态、不可用或无法执行授权策略的能力按拒绝处理。V1 的 `allowedToolsByRoleId`、`constraints.allowedTools` 和兼容读取路径不属于 Contract Set v2。

---

### 7. 工程验证与自动化测试基准

为如实检验系统的设计不变量与稳定性，系统构建了基于 Node.js 原生测试框架（`node:test`）的自动化测试体系。确定性 local-shell/fixture 测试用于回归运行时不变量；真实模型运行单独记录，不能用回归测试替代。

#### 7.1 自动化测试覆盖与架构断言
当前仓库最新全量 `pnpm test` 发现 **587 项测试（核心套件 486 项通过、1 项按 Windows 环境跳过，Team Site 100 项通过，0 项失败）**（早期记录的 819 项为将旧版 v1 测试移入 `tests/archive/v1/` 之前的历史计数）。测试覆盖底层状态机、编译管道、存储层、Workspace 内容与 Release 物化、Git 协作和跨层投影（表 3）：

| 验证模块 / 测试套件 | 测试用例数 | 核心验证的不变量与工程行为 | 实测通过情况 |
| :--- | :--- | :--- | :--- |
| **状态机与编译运行时** | 纳入核心套件（487 项含 1 跳过） | 包含 LTS、Context Map、Join、Loop、WAL/CAS 等核心回归 | 全部通过（Windows 专测按平台跳过） |
| **Workspace 与 Release 交付** | 纳入核心套件 | 包含 WorkspaceRef、路径/符号链接门禁、worktree、commit provenance、Join merge、canonical lock/CAS、冲突和 Release 失败路径 | 全部通过 |
| **平台与跨层投影（含 Team Site）** | 含 Team Site 100 项及核心 CLI/Studio 回归 | 包含 Workspace capability 投影、Studio、Team Site、CLI 与 Evidence/Release 相关回归 | 全部通过 |
| **全系统总计** | **587 项** | **586 通过，1 跳过，0 失败** | **99.8% 通过率（按测试发现数计算，0 失败）** |

*表 3：OGSystem 自动化工程测试套件与不变量实测统计*

#### 7.2 故障注入与崩溃恢复机制 (Fault Injection & Crash Consistency)
系统在运行时代码中内置了故障注入和恢复机制（注：对应的历史测试脚本 `runtime-fault-injection.test.mjs` 与 `resume-session.test.mjs` 目前已归档至 `tests/archive/v1/`，不随当前 `pnpm test` 自动执行，V2 非归档的端到端中断恢复实测仍处于待补齐状态）：
1. **进程强杀与恢复（Crash After Execution Outcome）：** 运行时内置钩子环境变量 `OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME=1`，可在模型执行结果产生并尝试持久化的临界时刻触发子进程退出（Exit Code 91），配合断点恢复（`run resume <runId>`）与进程排他锁（`RESUME_RUN_LOCK_FILE`）进行缓冲日志回放（Buffered Append Recovery）。
2. **拓扑防篡改与语义指纹校验（Plan Fingerprint Match）：** 恢复执行时，系统通过 `plan-fingerprint.ts` 实时重新计算当前磁盘定义的 SHA-256 语义指纹；若崩溃后 `system.mmd` 或配置发生变更，系统拒绝推测性恢复并抛出指纹不匹配异常；该机制限制了语义漂移下的恢复，不等同于消除所有状态漂移。

#### 7.3 真实模型驱动的软件开发案例：Python 计算器验收
仓库运行记录包含 2026-11-15 与 2026-11-16 使用本机真实 Codex `gpt-6-luna` 运行的 Python 计算器项目，拓扑为 `dispatch -> implementation/tests (parallel) -> join`：2026-11-15 记录完成 4 个 Role commit、Join merge、final merge 与调用方 fast-forward publish，8 项 unittest 通过；2026-11-16 复测记录 10 项测试通过（另记录到后续某次有界重试挂起）。

这组运行证明了真实模型可以穿过完整协作链路，但不构成统计意义上的稳定性证明：样本来自单一模型、单一任务和有限次数，路径所有权、Git-only source delivery 和验收入口由任务显式约束。额外边界运行确认并行同路径修改会产生冲突并停止发布，陈旧 canonical head 会被 CAS 拒绝，whitespace 错误会被 `git diff --check` 拒绝。历史确定性回归脚本 `tests/archive/v1/python-app-collaboration.test.mjs` 只证明 Runtime 接线，不属于真实模型证据。

#### 7.4 边界安全性与契约拦截实测
1. **Context Map 字段闭锁：** `tests/optional-context-projection.test.mjs` 测试验证，未在图契约中显式声明的上下文变量，下游席位读取时一律返回空或触发契约异常，杜绝了上下文隐式穿透。
2. **Workspace 内容安全边界：** `tests/workspace-and-verifier.test.mjs` 验证了跨目录相对路径（如 `../`）与单文件字节配额拒绝，符号链接（Symlink）拒绝则由 `tests/workspace-coordinator.test.mjs` 与 `tests/artifact-promotion.test.mjs` 验证；Release materialization verifier 单独校验最终文件集、manifest 与 output digest。
3. **国家标准相关性（GB/Z 2026 系列）：** OGS 的事件合同、工具边界和持久化执行可能与 **GB/Z 185.6**、**GB/Z 185.7** 和 **GB/Z 242** 涉及的主题相关。本研究尚未完成逐条款标准核验，不主张符合标准或与条款直接对齐。

#### 7.5 当前边界与可恢复性责任
V2 Framework 管理 Workspace、Git LFS、Worktree、canonical lock、checkpoint、merge、restore 和
Release。Role 被拒绝直接 commit、push、update-ref、操作 LFS 锁或修改 checkpoint。OGS 仍不内置
AI resolver、跨系统事务或外部发布补偿；失败 Run 不发布 canonical Workspace 或官方 download
reference，merge/Release 证据和可能的部分外部生效状态写入 Run，调用方必须据此执行外部核查和补偿。

#### 7.6 后续对照实验设计（尚未执行）
不同交付类型须使用对应验收器：代码可用隐藏测试，办公文档与分析材料应采用冻结的需求覆盖清单和盲法评审；各任务层先独立报告，不把代码测试通过率直接外推为一般协作质量。
现有工程证据包含软件实现、管理咨询和结构化辩论等不同 Project 场景，但缺少受控对照，不能证明跨场景任务质量提高或幻觉减少。主实验建议设置三组：A) 相同模型和验证器的单 Agent；B) 使用 LangGraph、相同角色图、提示词、工具及隔离工作区，但不使用 OGS Context Map、WorkspaceRef、Join/Release 合同的多 Agent 流程；C) 完整 OGS V2。另在软件任务层增加 MetaGPT 和 ChatDev 产品比较组，在办公与知识工作任务层增加 CrewAI 产品比较组，在同一冻结任务子集上重新运行；不把各系统已发表分数或默认输出直接当作 OGS 对照结果。MetaGPT、ChatDev 与 CrewAI 的同类系统比较可借鉴任务比较和指标设计，但这些外部产品组不能单独识别 OGS 合同的因果效应。任务集覆盖软件项目协作（借鉴 MetaGPT SoftwareDev 及 SWE-EVO 跨多文件长周期版本演进任务）、办公文档/报告起草与审阅（借鉴 OfficeBench 及 GAIA 通用办公助手任务）、结构化分析或辩论总结等文件型交付，并按任务类型分层报告。B 组用于识别协议贡献，A 组用于估计角色拆分的收益和成本。固定模型版本、token 上限、工具、验收器和重试策略，按任务类型、任务和随机种子配对随机化。

主要指标为“可验证交付成功率”：隐藏测试和需求验收通过、既有测试无回归、提交来源可追溯、Release digest 校验通过且状态为 `published`。报告分母、绝对百分点差和 95% 置信区间。幻觉相关指标仅定义为交接/最终报告中可与日志、Git、测试和 Release 证据核对的原子事实陈述：由盲法人工标注员统计每百条可验证陈述中的无支持陈述、矛盾率和虚报完成率；这不等同于测量模型的全部幻觉。另统计冲突恢复、过期引用拒绝、未授权字段泄漏、无效发布、时延、token/API 成本和每次成功交付成本。任务通过率持平但虚报完成/无效发布下降，可支持交付可靠性价值，不代表模型更准确。探索性 H5 可在声明的策略或模型版本变更后重跑固定版本工作流，记录策略违规逃逸率、Evidence 还原完整度、审计耗时和控制漂移；这些是有界工作流的运行连续性指标，不代表组织治理成熟度。建议先以 20–30 个任务开展 pilot，再按配对效应和任务聚类做功效分析；例如配对不一致率 0.25、目标差异 10 个百分点时，近似需 196 个独立任务配对；最终样本量应据 pilot 重算。检验零效果和额外成本也应如实报告。

实验操作细则、指标定义、统计方法与文献地址见[中英双语实验方案](experimental-validation-plan-bilingual.md)。正式样本量应从 pilot 估计配对不一致率；例如不一致率 0.25、检出 10 个百分点差异的近似功效分析约需 196 个独立任务配对，实际值须按 pilot 和任务聚类重新计算。AutoGen 作为高引用多 Agent 框架先行工作；MetaGPT 和 ChatDev 提供软件协作产品之间的同任务比较实例；近期 MetaAgent (ICML 2025)、StateFlow (COLM 2024)、NeuralFSM (ACL 2026)、Agent-SAMA (AAAI 2026)、GraphFlow (ICML 2026)、HEXIS (2026) 与 Sun 等人 (2026) 进一步验证了有限状态机对 LLM 智能体控制流与任务成功率的积极作用；Auditable Agents (2026)、TraceDev (ISSTA 2026) 与 Cho 等人 (2026) 强力佐证了多智能体工程中可追溯性、状态拓扑监控与可审计性的核心地位。多 Agent Debate、LLM 幻觉综述、SWE-EVO、OfficeBench 及 RAGTruth 仅用于讨论任务基准与测量方法，不作为产品对照。这些工作均不构成 OGS 效果的证据。

---

### 8. 结论与工程展望

OGSystem 将既有状态机、契约、持久化执行和版本控制机制用于多角色协作项目，并以四层产品架构和单一文件型 Git/LFS Workspace 连接责任、执行、证据与发布状态。Worktree 提供基于提交快照的隔离工作视图，Framework 管理的状态变更用于维持一致性并支持恢复和回退。现有运行记录覆盖软件开发、管理咨询和结构化辩论；这支持文件型多角色协作的工程可行性描述，但不等于对所有办公或社会协作场景完成验证。相对先行系统的学术新颖性仍需扩大文献检索和同条件比较。未来工作包括按第 7.6 节和双语实验方案开展分场景预注册对照实验；交付质量、证据支持度、成本与恢复价值在取得数据前不作效果结论。

---

### 软件与数据可用性声明 (Software and Data Availability)

本文报告的形式化责任契约、EFSM 运行时执行引擎、Context Map 投影规范、Git/LFS WorkspaceRef 与 Join/CAS 状态协议，以及完整的学术可复现性套件（包括离线证据验算脚本、原始 `events.ndjson` 轨迹、任务验收评测套件和 Docker 镜像定义）均基于 Apache-2.0 许可证在公开开源仓库开放（代码库：`https://github.com/your-username/ogsystem-core`，Zenodo 永久归档 DOI: `10.5281/zenodo.xxxxxx`）。

任何研究人员均可通过仓库内置的 `pnpm run reproduce:paper-evidence` 脚本，在**无需任何外部商业大模型 API 凭据与成本**的前提下，离线校验并复算本文所有表格（Table 1, Table 2, Table 3）与真实运行凭据指纹（SHA-256 Digest）。面向终端团队的商业化协作工作台（Team Site）与专有行业角色资产属于企业应用层投影，按独立商业协议保留；该部分的闭源不影响本文核心协议与实证结果的独立复现与验证。

---

### 参考文献（References）
*引用论文的 DOI、arXiv、会议论文集和官方项目地址见本目录下的 [`traceable-references.md`](traceable-references.md)；实验方法和文献直达链接见[双语实验方案](experimental-validation-plan-bilingual.md)。V2 Workspace 字段、事件、状态与 API 以 [`v2-workspace-contracts.md`](../development/v2-workspace-contracts.md) 为规范来源；共享协作行为以 [`v2-workspace-collaboration-design-and-acceptance.md`](../development/v2-workspace-collaboration-design-and-acceptance.md) 为设计来源。*
