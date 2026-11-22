# 多智能体编排能力、协作模型与底层技术栈专题调研报告
# Multi-Agent Orchestration Capabilities, Collaboration Models, and Underlying Technology Stacks

**报告定位：** 本报告作为 OGSystem 理论与工程论文专区的专题支撑技术文献，深入调研 2024–2026 年全球前沿实验室与工业界主流多智能体系统（MAS），系统性解构其**编排机制（Orchestration）、协作模型（Collaboration Models）、通信工具与 IPC 协议、底层技术栈（Technology Stacks）**，并与 OGSystem 的责任席位扩展状态机（Role-First EFSM over LTS）进行形式化对比与模型包含关系分析。

---

## 1. 多智能体协作与编排计算范式分类谱系 (Taxonomy)

本报告采用九种分析范式组织相关系统；分类并非穷尽或互斥。产品描述依据所列公开来源，不代表对内部实现的全面审计或同条件对比。未在公开资料中确认某项能力，不表示产品不具备该能力：

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               多智能体协作与编排计算范式演进谱系 (Taxonomy)                               │
├────┬─────────────────────────────┬───────────────────────────┬────────────────────────────────────────┤
│ 序 │ 计算范式名称 (Paradigm)     │ 代表系统 / 产品           │ 拓扑与核心控制特征                     │
├────┼─────────────────────────────┼───────────────────────────┼────────────────────────────────────────┤
│ 1  │ 前向有向无环数据流图 (DAG)   │ n8n, Dify, Coze, Opal     │ 无环依赖模型；产品控制能力依实现而异   │
│ 2  │ 分层调用树 (Tree-Forking)    │ Claude Code, Codex v2     │ 父子委派、子任务执行与结果回收         │
│ 3  │ 动态交接 (Handoffs)          │ OpenAI Swarm, AutoGen     │ 点对点交接或群聊调度；状态策略依实现   │
│ 4  │ 终端多路复用底座 (Mux/IPC)   │ Herdr (herdr.dev)         │ 窗格生命周期托管、OpenRPC、ANSI 状态口令│
│ 5  │ 终端工作树总线 (Fleet Bus)   │ Orca (onorca.dev)         │ Git Worktree 物理隔离、CLI 管道总线    │
│ 6  │ 角色模型分流 (Dispatcher)    │ OMP (oh-my-pi / omp.sh)   │ 算力标签路由、Hashline 紧凑编辑、伴生  │
│ 7  │ 消息池黑板 (Blackboard SOP)  │ MetaGPT, OpenHands        │ 规范化异步发布-订阅、模式契约驱动      │
│ 8  │ 命令式状态图 (StateGraph)    │ LangGraph + LangSmith     │ 任意条件回边、共享状态字典、全链路追踪 │
│ 9  │ 责任席位状态机 (EFSM/LTS)    │ OGSystem (本系统)         │ LTS离散事件、全要素元组、Fail-Closed   │
└────┴─────────────────────────────┴───────────────────────────┴────────────────────────────────────────┘
```

### 1.1 九大范式的核心模型、特点与技术栈深度解构

#### （1）前向有向无环数据流图（Forward Acyclic Dataflow DAG Pipeline）
*   **代表系统：** n8n, Dify, Coze Workflow, Google Opal Pipeline.
*   **核心协作模型：** 基于拓扑偏序的单向数据流管道。前置节点满足输入依赖后被激活并执行单次计算。
*   **关键特点：** DAG 模型表示无环依赖；循环、条件路由、状态持久化和字段投影由具体产品及附加控制结构决定。
*   **底层技术栈：** 依具体产品而异；本报告不推断未公开的内部组件。

#### （2）分层树状派生与上下文汇聚（Hierarchical Tree-Forking / Subagents）
*   **代表系统：** Anthropic Claude Code (`general-purpose`, `Explore`, `Plan`, `fork`), OpenAI Codex Multi-Agent v2.
*   **核心协作模型：** 主控-工作者（Master-Worker）调用树。主控 Agent 持有全局上下文与对话历史，通过工具调用动态 Fork 出轻量级临时子 Agent，子 Agent 执行完成后返回压缩的文本摘要。
*   **关键特点：** 通过父子关系派发子任务并汇集结果；上下文、权限与控制边界取决于具体产品和配置。本文不对其是否支持人工否决或审计作一般化判断。
*   **底层技术栈：** Node.js / Rust / Python CLI 客户端，JSON-RPC / Model Context Protocol (MCP) 工具总线，子进程上下文切片与临时运行沙箱。

#### （3）去中心化动态交接与即兴编舞（Decentralized Handoffs Choreography）
*   **代表系统：** OpenAI Swarm, AutoGen GroupChat, ChatDev.
*   **核心协作模型：** 点对点自主交接（P2P Function Handoffs）。智能体自身通过函数调用返回下一个接管任务的智能体（`return agent_b`）或由 LLM 在聊天室中动态评定发言者。
*   **关键特点：** 通过 handoff 或群聊调度在角色间传递控制；持久化、终止和状态约束取决于具体框架及部署方式。
*   **底层技术栈：** Pure Python 轻量库，OpenAI Function Calling 机制，内存轮询消息循环（In-memory Event Loop）。

#### （4）终端多路复用与跨窗格委派运行底座（Terminal Multiplexing & Cross-Pane Delegation）
*   **代表系统：** Herdr (`herdr.dev`, `github.com/herdrdev/herdr`, `github.com/herdrdev/herdr-core`).
*   **核心协作模型：** 操作系统级的多智能体终端视窗复用与跨窗格委派调度底座（"tmux for AI Coding Agents"）。
*   **关键特点：** 由常驻后台守护服务统一管理终端 Panes/Tabs 的生命周期；支持跨窗格委派与等待原语；采用 ANSI OSC 7501 扩展口令感知智能体运行态。
*   **底层技术栈：** 高性能 Rust 核心守护进程（`herdr-core`），Unix Domain Socket 进程间通信，OpenRPC 规范接口，PTY/TTY 终端多路复用驱动，ANSI OSC 7501 状态扩展。

#### （5）物理隔离工作树与终端代理总线（Worktree-Isolated Terminal Fleet Bus）
*   **代表系统：** Orca (`onorca.dev`, `github.com/stablyai/orca`).
*   **核心协作模型：** 基于 Git 物理工作树隔离的文件总线与终端代理车队（Fleet）架构。
*   **关键特点：** 公开资料描述为任务分配独立 Git Worktree 目录和终端会话；该隔离减少共享工作目录中的并发写入干扰，但不消除后续合并冲突。CLI 命令流属于其公开交互方式。
*   **底层技术栈：** Node.js / TypeScript CLI 客户端，Git Worktree 引擎，操作系统终端 stdio 管道重定向，Playwright 无头浏览器测试套件。

#### （6）角色感知模型分流与伴生守护者（Role-Based Model Dispatcher & Advisor Companion）
*   **代表系统：** OMP (`omp.sh`, `github.com/can1357/oh-my-pi`).
*   **核心协作模型：** 算力标签化模型路由器与后台流式伴生监听架构。
*   **关键特点：** 将“角色”映射为面向不同推理特性的异构模型调度策略（`plan/slow/task/advisor`）；引入流式旁路监听与内置 P0–P3 缺陷专用评审；单兵开发能效极高。
*   **底层技术栈：** 高性能 Rust，Hashline 行哈希紧凑编辑引擎，Tree-sitter 增量语法解析，内嵌语言服务器协议（LSP）与调试适配器协议（DAP）。

#### （7）角色化协作、消息传递与共享状态机制
*   **代表系统：** MetaGPT, OpenHands.
*   **核心协作模型：** 两个项目均涉及软件开发 Agent 协作，但其角色组织、事件/消息和执行环境机制不同；本文不将它们归为同一种黑板或发布-订阅实现。
*   **关键特点：** MetaGPT 描述角色化软件生产流程；OpenHands 描述通用软件开发 Agent 平台及其运行环境。具体 Workspace、消息和状态语义按各自论文/版本文档判断。
*   **底层技术栈：** 本报告不把 Python、Docker、Pydantic 或事件队列归为两项目的共同依赖。

#### （8）代码级状态图（Imperative StateGraph）
*   **代表系统：** LangChain LangGraph + LangSmith.
*   **核心协作模型：** 编程式有向循环状态图与条件边跳转。
*   **关键特点：** LangGraph 公开支持图节点、边、条件路由、循环与 checkpoint；应用状态、并发更新和失败处理由具体应用与配置决定。LangSmith 是独立的追踪与评估产品。
*   **底层技术栈：** 不将某一语言或 PostgreSQL、Redis、SQLite 存储后端视为所有部署的必选项；以 LangGraph/LangSmith 当前官方文档和具体配置为准。

#### （9）责任席位优先的持久化扩展状态机（Role-First Persistent EFSM over LTS）
*   **代表系统：** **OGSystem (本系统)**.
*   **核心协作模型：** 闭合有向图（Closed Directed Graph，DAG 的形式化超集），抽象责任席位集 $V$ 与具体执行器 $\rho$ 严格解耦。
*   **关键特点：** 离散业务事件字典驱动转移（LTS $\Sigma_{\text{fixed}}$）；全要素扩展状态元组 $\mathbf{X}$ 持久化；Fail-Closed Context Map 字段级投影；有界循环配额与 CAS 人工审核断点；四层产品架构；Git + LFS Workspace 协作与 Release Materialization。
*   **底层技术栈：** 编译型 TypeScript / Node.js 运行时，受限 Mermaid 语义编译器（Semantic IR），追加式预写日志（WAL `events.ndjson`），原子快照提交（CAS `state.json`），Git + LFS Workspace、Worktree、canonical lock/CAS、Workspace content verifier 与 Release Materialization；产品责任按 Business、Technical Binding、Execution、Evidence 四层划分。

---

## 2. 协作编程平台通信机制与技术栈深度解构

针对目前前沿的协作编程平台（Herdr, Orca, OMP, Aider, OGSystem），本节深入解构其跨代理通信机制、命令工具与底层协议。

### 2.1 Herdr：终端多路复用与跨窗格委派通信工具
Herdr 采用典型的 **Client-Daemon 双层架构**：

```text
┌────────────────────────────────────────────────────────┐
│                      Herdr 架构                        │
├────────────────────────────────────────────────────────┤
│           开发者终端 / CLI 客户端 (`hc`)               │
│                            │ (Unix Domain Socket /     │
│                            │  OpenRPC Protocol)        │
│                            ▼                           │
│        常驻守护服务: herdr-core (Rust 编写)             │
│   ┌────────────────────────┬───────────────────────┐   │
│   │ Pane 1 (Primary Agent) │ Pane 2 (Worker Agent) │   │
│   │ [hc-claude / codex]    │ [reviewer subagent]   │   │
│   │ 状态: OSC 7501 working │ 状态: OSC 7501 done   │   │
│   └────────────────────────┴───────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

*   **进程间通信原语 (IPC Primitives)：**
    *   `hc run --bg "<command>"`：后台静默派生从属 Agent 终端窗格；
    *   `hc send <pane-id> "<msg>"`：向目标窗格的 PTY 伪终端无阻塞注入标准输入（`stdin`）；
    *   `hc wait <pane-id>`：主控 Agent 挂起，直到目标窗格命令退出或到达稳态；
    *   `hc read <pane-id>`：读取目标窗格的最新终端输出（已去除 ANSI 颜色序列的纯文本）；
    *   `hc status`：查询全局窗格拓扑与状态。
*   **ANSI OSC 7501 状态感知协议：**
    *   采用 Mitchell Hashimoto 提出的通用终端状态转义序列：`\x1b]7501;state=<value>[:<key>=<value>]...\x07`（或以 `\x1b\\` 终止）
    *   支持核心状态值：`working`（思考/执行中）、`blocked`（等待用户输入/确认）、`done`（任务完成）、`idle`（就绪待命）、`error`（异常）等；
    *   终端边框与标题栏根据协议上报的状态实时更新提示与执行耗时计数器。
*   **架构边界评述：** 本报告将 Herdr 作为终端多路复用和跨窗格委派能力的公开参照；未对其应用级状态、授权和审计合同作系统验证。

### 2.2 Orca：Git Worktree 物理隔离与 CLI 管道总线
Orca 将操作系统层面的冲突消解在文件系统最前端：

*   **物理隔离：**
    *   调用 `git worktree add -b task-<uuid> <path>` 为每个并发 Agent 创建干净的分支目录；
    *   为每个 Worktree 分配独占的伪终端环境与 Playwright 无头浏览器端口；
*   **通信工具与命令：**
    *   `orca terminal list`：列出当前活跃的工作树 Agent；
    *   `orca terminal send <agent-id> "<prompt>"`：通过标准输入管道向目标工作树投递审查意见；
    *   `orca terminal wait <agent-id>`：同步等待审查结束；
*   **架构边界评述：** 本报告将 Orca 作为 Worktree 隔离和终端任务委派能力的公开参照；未对其应用级 Join 与循环控制作系统验证。

### 2.3 OMP (oh-my-pi)：Rust 核心 + TypeScript/Bun CLI 算力路由器与 Hashline 协议
OMP 专注于终端环境下的工具集成、模型路由与紧凑编辑：

*   **模型角色路由策略：**
    *   `default`：主任务执行（如 Claude-3.5-Sonnet / GPT-4o）；
    *   `plan`：挂载高逻辑推理模型（如 o1/o3-mini）；
    *   `slow`：挂载带超长思考链（CoT）的大模型进行深思反思；
    *   `task`：派发轻量并发子代理探索文件目录与搜索符号；
    *   `advisor`：常驻后台的伴生流式监听者，旁路检测安全隐患并在终端高亮警告。
*   **Hashline 紧凑行哈希编辑技术：**
    *   传统 Diff 生成要求大模型输出大量上下文行；
    *   Hashline 预先为代码文件的每一行计算短哈希（如 `a1b: let x = 1;`），大模型仅需返回目标行哈希与修改内容（`replace a1b with let x = 2;`）；
    *   结合 Rust 核心与 Tree-sitter 增量语法解析，旨在降低行号漂移与编辑失败率（本文不对其 Token 节省比例作实测验证）。

### 2.4 OGSystem：LTS 离散事件、全要素元组与 Workspace 内容验证
OGSystem 在架构设计上强调确定性、强类型与可追溯运行事件记录（注：WAL 记录用于系统内审计追踪，不主张底层存储防篡改）：

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              OGSystem 运行时核心                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│  责任席位 $V_1$ (Architect)                                                     │
│       │                                                                         │
│       ▼ 发射受限 LTS 业务事件: APPROVED, NEEDS_REWORK, READY                    │
│  LTS 标记转移内核 (Labeled Transition System)                                   │
│       │                                                                         │
│       ├─► 1. 字段级强契约投影 (Fail-Closed Context Map，未声明字段直接拦截)       │
│       ├─► 2. 事务先写入 WAL (events.ndjson，运行事件追加记录)                     │
│       ├─► 3. CAS 原子提交全要素状态快照 (state.json，语义指纹强校验)            │
│       │                                                                         │
│       ▼                                                                         │
│  Role B (Developer) 在 Framework 创建的独立 Git Worktree 中运行                 │
│       │                                                                         │
│       ▼ 产生 WorkspaceRef (commit / 相对路径 / digest，默认不跨 Role 投影)       │
│  Workspace 内容 Verifier / QA (执行 npm test / pytest / lint 自动化校验)        │
│       │                                                                         │
│       ├─► 跑测失败 ──► 发射 NEEDS_REWORK ──► 消耗循环预算 (maxIterations)       │
│       │                                          │                              │
│       │                                          ▼ 超限挂起等待人工 CAS 决策    │
│       └─► 内容验证通过 ──► Release Materialization Service                     │
│                           │                                                     │
│                           ▼                                                     │
│                    生成 manifest / outputDigest，published 后暴露下载引用        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 多智能体拓扑结构（Topology）深度对比与图论形式化

多智能体系统在运行时的本质是**图论模型（Graph-Theoretical Models）**。拓扑结构从数学上决定了系统能否支持并发、能否表达制度分权与对等制衡、能否容纳循环返工，以及是否具备因果收敛性。

### 3.1 五大核心拓扑原型（Topological Archetypes）直观对比图

```text
（1）前向有向无环图拓扑 (Forward DAG Pipeline，如 n8n / Dify / Google Opal)
    [Start] ──► [Node A] ───────────────► [Node B] ──► [End]
                   │                        ▲
                   └──────► [Node C] ───────┘ (严禁有向回边，单向激活)

（2）分层调用树拓扑 (Tree-Forking / Master-Worker Star，如 Claude Code / Codex v2)
                     ┌─────── [Master Coordinator] ───────┐
                     │ (持有全局上下文，自上而下派发)      │
                     ▼                                    ▼
             [Child Subagent 1]                   [Child Subagent 2]
             (局部探查，回收摘要)                  (局部执行，回收摘要)
                     │                                    │
                     └────────► 无横向对等交互与反向否决 ◄─┘

（3）点对点即兴编舞网状拓扑 (Dynamic Mesh / P2P Choreography，如 OpenAI Swarm / AutoGen)
                 [Agent A] ◄───────────────────► [Agent B]
                     ▲   \                       /   ▲
                     │    \                     /    │
                     │     ▼                   ▼     │
                     │    [Agent C] ◄───────► [Agent D]
                     │                               │
                     └── handoff(target)，控制策略依具体系统实现 ─────────┘

（4）一维平铺总线与视窗阵列拓扑 (Flat Array / Bus / Multiplexer Panes，如 Herdr / Orca)
    [Daemon / IPC Bus] ══════════════════════════════════════════════════
          ║                  ║                  ║                  ║
          ▼                  ▼                  ▼                  ▼
    [Pane 1/Worktree 1] [Pane 2/Worktree 2] [Pane 3/Worktree 3] [Pane 4/Worktree 4]
    (无内生业务图拓扑，拓扑外置于操作系统进程调度或脚本管道中继)

（5）基于责任席位的闭合有向图拓扑 (Role-First Closed Directed Graph - OGSystem)
                   ┌──────────────────────────────────────────┐
                   │             [Start Event]                │
                   └─────────────────────┬────────────────────┘
                                         ▼
                            ┌─────────────────────────┐
                            │    Role A: Architect    │
                            └────────────┬────────────┘
                                         │ APPROVED (LTS 离散业务事件)
                                         ▼
                     ┌───────────────────┴───────────────────┐
                     ▼                                       ▼
            ┌─────────────────┐                     ┌─────────────────┐
            │ Role B: CodeDev │                     │ Role C: DocDev │
            └────────┬────────┘                     └────────┬────────┘
                     │ READY                                 │ READY
                     └───────────────────┬───────────────────┘
                                         ▼
                               ┌───────────────────┐
                               │ State-Aware Join  │ 汇聚作用域 J = ⟨run, lineage, iter⟩
                               │ (all_of / quorum) │ 追踪 pending/arrived/skipped/failed
                               └─────────┬─────────┘
                                         ▼
                            ┌─────────────────────────┐
                            │    Role D: Reviewer    │
                            └────────────┬────────────┘
                                         │
               ┌─────────────────────────┴─────────────────────────┐
               │ NEEDS_REWORK (有界拓扑回边)                        │ APPROVED (推进)
               ▼                                                   ▼
       [Loop Budget Invariant]                               ┌───────────┐
       iter <= maxIterations ? 回跳 Role B : CAS 挂起人工决策 │ [Release] │
                                                             └───────────┘
```

### 3.2 拓扑图论属性形式化对比矩阵 (Topological Properties Matrix)

| 拓扑对比维度 | **DAG 流水线<br>(n8n/Dify/Opal)** | **分层树状派生<br>(Claude Code/Codex v2)** | **网状动态编舞<br>(Swarm/AutoGen)** | **平铺总线/复用底座<br>(Herdr/Orca)** | **责任席位状态机<br>(OGSystem, Ours)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 图论拓扑分类<br>(Graph Classification)** | 有向无环图 ($DAG$)<br>无回路拓扑偏序 | 有向树 ($Tree$)<br>根节点支配，无横向边 | 动态全连通图 ($K_n$)<br>无向/有向即兴切换 | 一维平铺阵列 ($1 \times N$)<br>无内生业务拓扑 | **闭合有向图 ($DAG \subset EFSM$)<br>强连通分量受控子图** |
| **2. 节点本体纯粹性<br>(Node Ontology)** | 工具算子 / 逻辑网关 / 脚本函数混杂 | 内存临时线程 / 提示词上下文副本 | 无状态 Python 函数对象 / 提示词会话 | 终端窗格进程 / 物理 Git Worktree | **形式化责任席位集 $V$<br>(组织职责与执行器 $\rho$ 严格解耦)** |
| **3. 拓扑绑定时刻<br>(Binding Time)** | 运行前连线确定 (静态无环) | 运行期动态派生 (主控决策) | 运行期即兴跳转 (自然语言漂移) | 外部脚本/人工动态拉起 | **编译期生成 Semantic IR<br>(外层 `ogsContractVersion: 2`，静态拓扑闭包，严禁旁路注入)** |
| **4. 有向回边机制<br>(Back-Edge Semantics)** | DAG 抽象中不包含回边；具体产品可能通过其他控制结构实现循环 | 父子调用图的回边行为依实现而异 | handoff/群聊中的控制转移依应用和调度策略而异 | 外部调度能力依产品及调用方式而异 | **有界循环策略**<br>OGS 绑定配额 ($maxIterations$) 与 CAS 审核路径 |
| **5. 汇聚代数语义<br>(Join Algebra)** | 简单入度计数器<br>(In-degree Barrier) | 栈帧返回汇集<br>(Parent wait child) | 无汇聚语义<br>(单点跳跃式通信) | CLI `wait` 进程退出<br>(无细粒度状态代数) | **源状态感知汇聚作用域<br>($S_{\text{src}} \in \{pending, arrived, skipped, failed\}$)** |
| **6. 制度分权制衡<br>(Checks & Balances)** | 产品权限与审批机制依实现而异 | 产品权限与审批机制依实现而异 | 产品权限与审批机制依实现而异 | 产品权限与审批机制依实现而异 | **OGS 定义责任席位和审核转移**<br>这是本系统的领域合同，不作其他产品的优劣判断 |
| **7. 循环预算与停止条件<br>(Loop Budget / Stop Conditions)** | 无环拓扑提供有限的图调度路径<br>不涵盖节点外部行为 | 递归或步数上限<br>具体语义依实现而异 | 由应用逻辑和终止条件控制 | 由外部调度和进程状态控制 | **对图循环设置 $maxIterations$ 与耗尽策略**<br>该限制不证明任意模型/工具行为都会终止。 |

---

## 4. 全景结构对比矩阵
以下矩阵按选定版本的公开文档和项目资料归纳能力，不是同条件比较。产品能力随版本、配置与部署方式而异；未列出某项能力不代表该产品不具备该能力。

### 4.1 前沿厂商系统与通用多智能体架构对比 (Table 1)

| 结构对比维度 | **OpenAI Codex v2 / Swarm** | **Anthropic Subagents / Claude Code** | **Google Opal (Agent Mode)** | **LangGraph + LangSmith** | **Manus / 腾讯 WorkBuddy** | **OGSystem (本系统)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 图本体原语** | 临时线程 / 无状态函数对象 | 任务子智能体 (Task Subagent) | 可视化组件 / 动态 Agent 步进 | 任意 Python 状态计算节点 | 虚拟 OS 进程 / 桌面专家池 | **抽象责任席位 ($V$)** |
| **2. 拓扑与转移** | 父子树状派生 / 自由函数交接 | 树状分发与 Fork 汇聚 | 前向流 + 动态展开步骤 | 开发者自定义条件跳转边 | 任务队列派发 / 单体自反思单工流 | **LTS 标记转移系统 ($\Sigma_{\text{fixed}}$)** |
| **3. 状态与持久化**| 会话和运行状态依产品与配置而异 | 会话和运行状态依产品与配置而异 | 工作流状态依产品行为而异 | 公开提供 checkpoint 与追踪能力 | 运行或环境状态依产品而异 | **扩展状态、WAL/CAS 与语义检查** |
| **4. 数据边界治理**| 上下文和委派控制依产品与配置而异 | 上下文和委派控制依产品与配置而异 | 工作区和步骤上下文依产品行为而异 | 应用状态结构与投影由开发者定义 | 上下文和工作区控制依产品与配置而异 | **合同声明的 Fail-Closed Context Map 投影** |
| **5. 循环与控制面**| 委派与控制能力依产品和配置而异 | 委派与控制能力依产品和配置而异 | 工作流控制能力依产品和配置而异 | 支持条件路由与循环 | 任务控制能力依产品和配置而异 | **血缘绑定循环预算与绑定状态版本的审核决策** |
| **6. 交付物闭环** | 终端代码生成 / Git PR 补丁 | 本地文件读写 / 终端命令输出 | 自动生成 Drive 文档 / 电子表格 | 文本流 / 任意应用侧写入 | 自动生成演示文稿、研报、Web 页面 | **WorkspaceRef + Git/LFS provenance + Release Materialization** |
| **7. 审计与透明度**| 委派元数据和运行记录依产品及配置而异 | 公开的终端调用和工具执行记录 | 产品特定的运行记录 | LangSmith 提供追踪与评估能力 | 产品特定的会话与执行记录 | **运行事件追加记录 (`events.ndjson`)** |
| **8. 核心底层技术栈**| Codex、Swarm 分别按其公开资料描述 | 按具体产品公开资料 | 按产品公开资料；不推断内部组件 | LangGraph 与 LangSmith 分属独立产品；后端依版本/配置 | 按具体产品公开资料 | **编译型 TS/Node.js + Semantic IR + WAL/CAS + Workspace verifier + Git/LFS provenance** |

### 4.2 协作编程软件专用对比矩阵 (Table 2)

| 结构对比维度 | **Orca (StablyAI)** | **Herdr (HerdrDev)** | **OMP (oh-my-pi / omp)** | **Aider (Architect/Editor)** | **OGSystem (本系统)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **核心协作模型** | **工作树隔离终端代理总线** | **终端多路复用与跨窗格委派底座** | **角色感知模型分流与伴生评审** | **双人结对互锁协作** | **责任席位扩展状态机 + Git/LFS Workspace (Role-First EFSM)** |
| **执行隔离边界** | 物理隔离：独占 **Git Worktree** 与终端 | 视窗隔离：常驻后台守护服务 `herdr-core` | 逻辑隔离：单进程内上下文分片 | 共享工作区：主 Git 分支结对交接 | **Project 单一 Git + LFS Workspace；Role 独立 Worktree，Framework 管理 canonical ref** |
| **智能体通信机制**| 终端 CLI 命令流：`orca terminal send/wait`| 跨窗格原语：`hc run/send/wait/read` 与 OpenRPC | 内存调度：`task` 子代理，`advisor` 旁路 | 提示词双向交替：计划与 Diff 交替 | **LTS 离散业务事件字典** ($\Sigma_{\text{fixed}}$) |
| **角色本体本质** | 动态派生的命令执行进程 / 终端会话 | 挂载于终端窗格的 CLI 智能体子进程 | **异构模型调度配置标签** | 固定双人静态提示词角色 | **形式化责任席位集 $V$** (组织权责解耦) |
| **上下文边界控制**| 依产品与配置而异 | 依产品与配置而异 | 依产品与配置而异 | 依产品与配置而异 | **合同声明的 Context Map 投影** |
| **循环与状态收敛**| 公开任务与控制能力依配置而异 | 公开任务与控制能力依配置而异 | 公开运行时任务控制能力 | 公开评审与编辑迭代能力 | **血缘绑定循环预算与绑定状态版本的审核决策** |
| **产物交付与验证**| Worktree 与 Git 协作能力 | 终端与仓库协作能力 | LSP 与评审能力 | 测试命令与 Git 能力 | **WorkspaceRef 验证、provenance、canonical lock/CAS 与 Release Materialization** |
| **状态一致性与恢复**| 恢复行为依产品与配置而异 | 恢复行为依产品与配置而异 | 恢复行为依产品与配置而异 | 恢复行为依产品与配置而异 | **WAL、CAS 快照与语义指纹检查** |
| **核心底层技术栈**| Node.js/CLI + Git Worktree + Headless Browser | Rust (`herdr-core`) + Unix Socket + OpenRPC + ANSI OSC 7501 | Rust + Hashline + 内置 LSP/DAP + Tree-sitter | Python + Tree-sitter AST repo-map + Git Diff | **TypeScript/Node.js + Semantic IR + WAL/CAS + Git/LFS Workspace + Verifiers** |

### 4.2.1 OGS V2 Workspace 交付路径与验证边界

OGS 的文件交付和源码协作共享同一个 Project Git + LFS Workspace，但不共享未经授权的可写目录。
文档、媒体和源码都从固定 `baseCommit` 进入独立 Worktree；Framework 记录 Role commit provenance，
Join 在独立 merge worktree 中按候选集合、顺序、祖先关系、工作树 clean 与 `git diff --check` 验证。
跨 Role 读取使用只读 `WorkspaceRef`，默认不投影。canonical ref 更新需要 canonical lock 与
expected-head CAS；冲突产生 `join_conflict` 并保留在 Run evidence。Release 从 release commit
生成 Materialization manifest 与 output digest，只有 published 状态暴露 download reference。

每个可执行 Role 必须绑定 Harness Template；Technical Binding 配置 Backend、Model、`allowedTools` 与 `EnvironmentIntent`。Runtime 在 Backend 启动前解析并冻结 `verifiedTools`、`allowedTools`、`EffectiveEnvironmentPolicy` 及其摘要，Adapter 再映射为 backend-native 配置；可执行工具集合为 `allowedTools ∩ verifiedTools`，只存在于 Runtime 内存中。未知、动态、不可用或无法执行授权策略的能力按拒绝处理。V1 字段和兼容读取不属于 Contract Set v2。

2026-11-15 的真实模型 Python 计算器验收在同一 `gpt-6-luna` 配置下连续 3 次通过 `dispatch -> implementation/tests -> join`，每次完成 4 个 Role commit、Join/final merge、fast-forward publish 和 8 项 unittest。该结果证明端到端链路可用，不足以证明跨模型或长期稳定性。并行同路径冲突、陈旧 canonical head 的 CAS 拒绝和 whitespace 拒绝属于已验证边界；确定性 local-shell 回归测试不计入真实模型证据。

### 4.3 工业界同质化模式与 OGS 设计/新颖性边界

本节将公开基础机制与 OGS 的工程组合分开：LTS/EFSM、Role-based Agent、LangGraph、Git Worktree、WAL/CAS、最小特权和 manifest/provenance 均有公开先例。OGS 当前通过 LangGraphEngineAdapter 使用 LangGraph；业务合同和 Workspace/Release 语义由 OGS 定义。候选系统集成包括语义合同边界、单一 Git/LFS Workspace 跨 Role 状态模型，以及包含四值源状态和声明式异常策略的 Join/Release 协议组合。OpenHands、Orca 与持久化工作流系统尚未和 OGS 的 WorkspaceRef、合并、Evidence、Release 协议作同条件逐项比较，故不主张首创或相对优势。一次 Codex -> OpenCode 的正式 Project Run 中，Implementer 未产生文件改动，因此没有证明下游实际消费 WorkspaceRef；该运行也不证明跨模型泛化、双向互操作或图执行引擎可替换。四层架构和测试结果属于工程实现证据。

表 2.5 对照若干设计维度，不能代表整个多智能体领域的统一实现模式。其中候选系统集成限于语义合同边界、单一 Workspace 状态模型和带声明式异常策略的 Join/Release 协议组合；尚未完成足以确认学术新颖性的全面先行工作审查，其他行是先行机制的组合或工程实现。

| 核心维度 | 行业主流同质化模式 (Homogenized Patterns) | OGS 设计画像与新颖性边界 |
| :--- | :--- | :--- |
| **1. 节点本体论** | 各系统以不同方式表示 Agent、Role、会话和执行器；职责边界依实现而异。 | **责任席位优先 (Role-First Seat)**<br>OGS 将 Role Contract 与运行时 Backend/模型绑定分别建模；角色化协作本身已有先例。 |
| **2. 控制与转移代数**| **自然语言交接或自由字符串路由**<br>Prompt 自主输出 `handoff_to("tester")`，路由约束依实现而异。 | **标记转移系统 (LTS) 离散业务事件代数**<br>OGS 将控制事件限制在声明字典（$\Sigma_{\text{fixed}}$），并以 Schema 校验业务数据。 |
| **3. 上下文与数据安全**| 不同系统采用不同的上下文传递和授权策略；本文不将其归为单一行业模式。 | **Fail-Closed 字段级 Context Map 显式投影**<br>按声明投影跨席位字段和只读文件引用；安全效果尚未作对照测量。 |
| **4. 并发分支汇聚** | 通用 Join 与同步模式已有工作流理论和框架实现；失败处理取决于具体实现。 | **四值源状态跟踪与防静默降级（候选组合）**<br>追踪 $S_{\text{src}} \in \{pending, arrived, skipped, failed\}$；源码实现 `failed` 粘滞不变量，但未找到专门断言其不会被后续 `skipped` 覆盖的测试。 |
| **5. 循环与博弈收敛**| 循环和回退支持依赖工作流模型及具体运行时实现；预算策略也各不相同。 | **血缘绑定有界配额与 CAS 决策凭证**<br>OGS 为循环配置整数预算 $maxIterations$；预算耗尽时进入人工审核路径，决策与 Run、血缘和状态版本绑定。 |
| **6. 代码与产物交付**| Agent 工具对工作区的修改边界依产品和权限配置而异；本文未作逐产品比较。 | **WorkspaceRef 与 Release Materialization**<br>Git/LFS commit 是内容事实；只读 `WorkspaceRef` 经内容验证，Release 生成 manifest、output digest 和受控下载引用。 |
| **7. 社会技术学分权**| 不同产品以各自方式组织设计、配置、执行和审计界面；本文不作统一优劣判断。 | **四层产品架构**<br>Business、Technical Binding、Execution、Evidence 分离职责；Studio、Team Site、CLI 是跨层投影。 |
| **8. 容灾与系统恢复**| **不同持久化和恢复策略**<br>具体恢复行为依赖框架及配置。 | **WAL + CAS + SHA-256 拓扑语义指纹校验**<br>OGS 追加 `events.ndjson`、以 CAS 提交 `state.json`，并在恢复时检查计划指纹；故障注入覆盖指定崩溃窗口。 |

---

## 5. 关键架构差异、模型推导与标准主题参照

### 5.1 DAG 拓扑与显式返工边的表示
设工作流由有向图 $G = (V, E)$ 建模。DAG 引擎的执行依赖节点拓扑排序（Topological Sort）：
$$\forall (u, v) \in E \implies \text{rank}(u) < \text{rank}(v)$$
在真实软件工程协同中，“架构评审驳回”、“测试红灯返工”是绝对核心业务。当 `Reviewer`（节点 $v$）判定产物不合格并发射 `NEEDS_REWORK` 事件回指 `Developer`（节点 $u$）时，拓扑上必然引入有向回边 $(v, u) \in E$。
此时产生拓扑矛盾：
$$\text{rank}(u) < \text{rank}(v) \quad \text{且} \quad \text{rank}(v) < \text{rank}(u) \implies \text{拓扑排序无解（环路异常抛出）}$$
显式返工边不属于 DAG 拓扑本身；工作流需由支持迭代的运行时或额外控制结构表达。节点内部循环和有限展开是可能的表达方式，但产品支持和可观测性依具体实现与配置而异。本文不据此断言 n8n、Dify 或其他工作流产品只能采用其中某种方式。

### 5.2 扩展有限状态机（EFSM）对 DAG 的模型包含关系
OGSystem 采用形式化扩展状态机模型：
$$(ControlState, Event, \mathbf{X}) \xrightarrow{Guard} (NextControlState, \mathbf{X}', EmittedFacts)$$
其中 $\mathbf{X}$ 为显式持久化的全要素扩展状态元组：
$$\mathbf{X} = \langle s_{\text{biz}}, \mathbf{t}_{\text{task}}, \mathbf{i}_{\text{input}}, \mathcal{F}_{\text{frontier}}, \mathcal{L}_{\text{lineage}}, \mathcal{J}_{\text{scopes}}, \mathcal{C}_{\text{budgets}}, \mathcal{H}_{\text{review}}, \mathcal{V}_{\text{cas}} \rangle$$

*   **退化条件推导：**
    1. 当协作图拓扑中不存在有向回边，即拓扑无环：$\nexists \text{ path } v \leadsto u \text{ 满足 } (u, v) \in E$；
    2. 扩展状态中循环计数器恒为初始值：$c_{\text{iter}} \equiv 1$；
    3. 汇聚作用域（Join Scope）退化为静态前置依赖闭包：$J = \text{Predecessors}(v)$。
*   **关系结论：** 在此退化条件下，EFSM 的离散状态转移序列与图 $G$ 拓扑偏序相符，节点激发退化为单向数据流流水线。因此，在本文定义下，**DAG 属于 EFSM 在无环拓扑与单次激发约束下的退化子集（$DAG \subset EFSM$）**。该关系不等于对所有 DAG 引擎的性能优越性证明；循环场景的行为仍需由具体预算和运行时测试验证。

### 5.3 源状态感知汇聚代数（State-Aware Join）
工作流理论和产品实现包含多种同步与汇聚模式。Join 对分支失败的处理取决于源状态定义、终止条件和运行时实现；本文不将所有引擎概括为仅支持 `AND`/`OR`，也不推断任意分支失败都会导致死锁。
OGSystem 形式化定义了分支源状态代数：
$$S_{\text{src}} \in \{\text{pending}, \text{arrived}, \text{skipped}, \text{failed}\}$$
*   **全汇聚（`all_of`）：** 要求全量源分支均处于 `arrived` 态；
*   **多数汇聚（`quorum_of` $K$）：** 当唯一到达来源数达到配置阈值 $K$ 时满足该汇聚条件；
*   **失败状态保持：** `failed` 不得静默改写为 `skipped`；Join 按定义的源状态处理策略结束或等待控制面决策。该约束针对 OGS 状态不变量，不表示任意故障均不会造成阻塞。

### 5.4 理论来源、潜在标准相关性与工程实践

下表区分计算机科学理论来源、按标准名称推测的潜在主题相关性和工程背景。GB/Z 编号及条款仅作为待核验线索，本文没有核验条款文本，不构成标准映射、符合性判断或经验优越性证明：

| OGS 设计原则 / 架构结论 | 计算机科学理论来源 (Citation & DOI) | 潜在标准主题 (GB/Z；条款未核验) | 工业工程背景 (非同条件比较) |
| :--- | :--- | :--- | :--- |
| **原则 1：责任席位本体与执行器解耦**<br>($V$ 抽象六元组，席位不可变) | Milner 1989 (LTS 并发代数)<br>Meyer 1992 (契约式设计 DbC, DOI: [10.1109/2.161279](https://doi.org/10.1109/2.161279)) | **GB/Z 185.1—2026**（总体架构；条款待核验）<br>**GB/Z 185.4—2026**（智能体描述；条款待核验） | OGS 将责任模型与 Backend/model 绑定分开表示；本文不据此作 OMP 或 ChatDev 的比较结论。 |
| **原则 2：离散标记转移与业务事件驱动**<br>($\Sigma_{\text{fixed}}$ 受限离散字典) | Milner 1989 (LTS 标记转移系统, ACM 1989)<br>Newman 2015 (*Building Microservices*, O'Reilly) | **GB/Z 185.6—2026**（智能体交互；条款待核验） | 为自由文本交接增加可校验的事件路由和数据合同；对照不构成对 Swarm / AutoGen 所有使用方式的实证结论。 |
| **原则 3：全要素扩展状态元组与持久化**<br>($\mathbf{X}$ 向量 + WAL + CAS) | Cheng & Krishnakumar 1993 (EFSM 扩展状态机, DAC '93, DOI: [10.1145/157485.164585](https://doi.org/10.1145/157485.164585))<br>Gray & Reuter 1992 (*Transaction Processing*, 图灵奖著作) | **GB/Z 242—2026**（智能体技术要求；条款待核验）<br>**GB/Z 185.1—2026**（总体架构；条款待核验） | 结合持久化执行与事务恢复先行实践；本文未对 LangGraph、Claude Code 等进行相同故障条件下的比较。 |
| **原则 4：有界循环配额与 CAS 审核断点**<br>($Iteration \le Budget \to$ CAS Pause) | Alshiekh et al. 2018 (*Safe Reinforcement Learning via Shielding*, AAAI 2018)<br>Lee & Yannakakis 1996 (*FSM Testing Survey*, IEEE) | **GB/Z 242—2026**（智能体技术要求；条款待核验）<br>**GB/Z 185.6—2026**（智能体交互；条款待核验） | 为显式循环增加预算和审核断点；这些控制不构成对其他框架风险的实测比较。 |
| **原则 5：源状态感知汇聚作用域**<br>($S_{\text{src}} \in \{pending, arrived, skipped, failed\}$) | van der Aalst et al. 2003 (*Workflow Patterns*, Dist. & Parallel DB, DOI: [10.1023/A:1022883727209](https://doi.org/10.1023/A:1022883727209)) | **GB/Z 185.1—2026**（总体架构；条款待核验） | OGS 规定 `failed` 不可静默降级为 `skipped`；这是针对指定状态转移的 fail-closed 约束，不是任意故障下无死锁的普遍证明。 |
| **原则 6：Fail-Closed 字段投影与数据闭锁**<br>(Context Map 未显式声明即阻断) | Saltzer & Schroeder 1975 (*Fail-safe Defaults Axiom*, IEEE, DOI: [10.1109/PROC.1975.9939](https://doi.org/10.1109/PROC.1975.9939)) | **GB/Z 185.7—2026**（智能体工具调用；条款待核验） | OGS 将最小特权应用于跨 Role 字段投影；本文未测量其对注意力稀释或提示词攻击风险的影响。 |
| **原则 7：Workspace 内容验证与 Release 物化**<br>(WorkspaceRef -> verifier -> Materialization manifest) | Yang et al. NeurIPS 2024 (*SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*)<br>Jimenez et al. ICLR 2024 (*SWE-bench*) | **GB/Z 242—2026**（智能体技术要求；条款待核验） | Git/LFS、只读引用和发布后物化构成 OGS 的可追溯交付路径；不主张这些底层机制原创。 |
| **原则 8：运行事件记录**<br>(`events.ndjson` 与审核状态标识) | Gray & Reuter 1992 (WAL 预写日志)<br>Saltzer & Schroeder 1975 (Open Design 公理) | 不主张条款级标准映射；GB/Z 185.3 是身份管理部分。 | OGS 记录运行事件和审核状态标识以支持系统内审计追踪；不据此主张防篡改存储或形式化因果证明。 |

---

## 6. 权威可查验信息源与可访问官方地址清单

本报告所有引用的系统、产品、标准及理论依据均具备权威公开发布通道：

### 6.1 主流多智能体协作编程软件与终端 Harness
*   **Herdr (HerdrDev):**
    *   官方平台主页与文档：[https://herdr.dev](https://herdr.dev) 与 [https://docs.herdr.dev](https://docs.herdr.dev)
    *   官方开源仓库：[https://github.com/herdrdev/herdr](https://github.com/herdrdev/herdr)
    *   核心守护进程仓库：[https://github.com/herdrdev/herdr-core](https://github.com/herdrdev/herdr-core)
*   **Orca (StablyAI):**
    *   官方开源仓库：[https://github.com/stablyai/orca](https://github.com/stablyai/orca)
    *   官方产品文档主页：[https://onorca.dev](https://onorca.dev)
*   **OMP (oh-my-pi / Can Bölük):**
    *   官方开源仓库：[https://github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)
    *   官方主页与安装指南：[https://omp.sh](https://omp.sh)
*   **Aider (Architect/Editor Mode):**
    *   官方开源仓库：[https://github.com/paul-gauthier/aider](https://github.com/paul-gauthier/aider)
    *   架构师模式说明文档：[https://aider.chat/docs/architect.html](https://aider.chat/docs/architect.html)
*   **OpenHands (All-Hands-AI):**
    *   官方开源仓库：[https://github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)
    *   官方技术文档：[https://docs.all-hands.dev/](https://docs.all-hands.dev/)

### 6.2 头部前沿实验室智能体架构与官方技术报告
*   **Anthropic (Building Effective Agents & Claude Code):**
    *   官方研究长文与工作流模式：[https://www.anthropic.com/research/building-effective-agents](https://www.anthropic.com/research/building-effective-agents)
    *   Claude Code 官方文档：[https://docs.anthropic.com/](https://docs.anthropic.com/)
*   **OpenAI (Codex CLI / Swarm / Assistants API):**
    *   Codex 官方文档与开源项目：[https://platform.openai.com/docs/guides/codex](https://platform.openai.com/docs/guides/codex) 与 [https://github.com/openai/codex](https://github.com/openai/codex)
    *   Swarm 轻量交接原语框架：[https://github.com/openai/swarm](https://github.com/openai/swarm)
*   **Google Labs (Google Opal & Google ADK):**
    *   Google Opal 官方入口与产品公告：[https://opal.google](https://opal.google) 与 [https://blog.google/technology/ai/google-labs-opal/](https://blog.google/technology/ai/google-labs-opal/)
    *   Google Agent Development Kit (ADK)：[https://adk.dev/](https://adk.dev/)
*   **LangChain (LangGraph & LangSmith):**
    *   LangGraph 状态图框架主页：[https://langchain-ai.github.io/langgraph/](https://langchain-ai.github.io/langgraph/)
    *   LangSmith 多智能体监控平台：[https://www.langchain.com/langsmith](https://www.langchain.com/langsmith)

### 6.3 2015–2016 状态机与持久化执行基座文献
*   **AWS Step Functions (2016 ASL 状态机规范):** [https://states-language.net/spec.html](https://states-language.net/spec.html)
*   **Uber Cadence / Temporal (持久化执行理论):** [https://github.com/uber/cadence](https://github.com/uber/cadence) 与 [https://docs.temporal.io/temporal](https://docs.temporal.io/temporal)
*   **Sam Newman (编排与编舞边界，2015):** [https://samnewman.io/books/building_microservices/](https://samnewman.io/books/building_microservices/)

### 6.4 2026 中国人工智能智能体国家标准 (官方查验通道；标准文号已核实，条款全文待核验)
*   **全国标准信息公共服务平台 (SAMR / SAC):** [https://openstd.samr.gov.cn/](https://openstd.samr.gov.cn/)
*   **标准文号索引（2026 年 5 月—8 月公开发布，本报告未做条款级符合性核验）：**
    *   `GB/Z 185.1—2026` 至 `GB/Z 185.7—2026`《人工智能 智能体互联》（总体架构、身份码、身份管理、智能体描述、发现、交互、工具调用）
    *   `GB/Z 242—2026`《人工智能 智能体技术要求》
