# OGSystem 理论与工程可溯源文献库 (2015–2026)
# Traceable Literature and Standards Baseline

本文档为 OGSystem 论文提供全面、可查验的学术文献与国家标准官方地址索引。

---

## 1. 2015–2016 分布式状态机与工作流奠基文献 (可查地址)

2015–2016 年是分布式系统从“点对点混乱微服务”走向“声明式状态机与持久化执行”的黄金革命期。OGSystem 将这一时期的确定性执行思想注入到了大模型多智能体领域。

*   **[AWS Step Functions 2016]** Amazon Web Services. *New – AWS Step Functions: Build Distributed Applications Using Visual Workflows*. AWS Official Launch Announcement & Documentation, Dec 2016.  
    *   **官方发布地址:** [https://aws.amazon.com/blogs/aws/new-aws-step-functions-build-distributed-applications-using-visual-workflows/](https://aws.amazon.com/blogs/aws/new-aws-step-functions-build-distributed-applications-using-visual-workflows/)  
    *   **规范标准 (Amazon States Language - ASL):** [https://states-language.net/spec.html](https://states-language.net/spec.html)  
    *   **理论贡献:** 奠定了使用 JSON 声明式扩展有限状态机管理异步分布式任务的工业先河。
*   **[Uber Cadence / Temporal 2016]** Fateev, M., & Abbas, S. *Cadence: Orchestration Engine for Long-Running Distributed Workflows*. Uber Engineering Architecture & Blog, 2016. (后演变为全球顶尖持久化执行框架 Temporal).  
    *   **开源代码与架构地址:** [https://github.com/uber/cadence](https://github.com/uber/cadence)  
    *   **Temporal 理论阐述:** [https://temporal.io/](https://temporal.io/) 与 [https://docs.temporal.io/temporal](https://docs.temporal.io/temporal)  
    *   **理论贡献:** 提出“持久化确定性执行 (Durable Execution)”与事件溯源（Event Sourcing / Replay），进程崩溃后可通过事件历史在任意时刻精确回放恢复。
*   **[Newman 2015]** Newman, S. *Building Microservices: Designing Fine-Grained Systems*. O'Reilly Media, 2015. ISBN: 978-1491950357.  
    *   **官方可查地址:** [https://samnewman.io/books/building_microservices/](https://samnewman.io/books/building_microservices/)  
    *   **理论贡献:** 确立了中心编排（Orchestration）与自由编舞（Choreography）的系统边界，指明复杂多节点协同必须存在全局状态编排器。
*   **[Netflix Conductor 2016]** Netflix Technology Blog. *Netflix Conductor: A Microservices Orchestrator*. Netflix TechBlog, Dec 2016.  
    *   **可查地址:** [https://netflixtechblog.com/netflix-conductor-a-microservices-orchestrator-2e8d6d59e8f8](https://netflixtechblog.com/netflix-conductor-a-microservices-orchestrator-2e8d6d59e8f8)  
    *   **开源地址:** [https://github.com/conductor-oss/conductor](https://github.com/conductor-oss/conductor)  
    *   **理论贡献:** 基于 DAG 与状态机混合的微服务有向工作流编排引擎。

---

## 2. 计算机科学形式化与系统可靠性经典理论文献

*   **[LTS 标记转移系统]** Milner, R. *Communication and Concurrency*. Prentice-Hall International Series in Computer Science, 1989. ISBN: 978-0131150072.  
    *   **ACM 经典收录:** [https://dl.acm.org/doi/book/10.5555/63442](https://dl.acm.org/doi/book/10.5555/63442)  
    *   **理论贡献:** 奠定标记转移系统 (Labeled Transition System, LTS) 理论，用有限离散事件标记约束并发跃迁。
*   **[EFSM 扩展有限状态机]** Cheng, K. T., & Krishnakumar, A. S. *Automatic functional test generation using the extended finite state machine model*. In Proceedings of the 30th ACM/IEEE Design Automation Conference (DAC '93), pp. 86-91, 1993.  
    *   **DOI / 可查地址:** [https://doi.org/10.1145/157485.164600](https://doi.org/10.1145/157485.164600)  
    *   **经典综述 (Lee & Yannakakis):** *Principles and methods of testing finite state machines-a survey*. Proceedings of the IEEE, 84(8): 1090-1123, 1996. DOI: [10.1109/5.533956](https://doi.org/10.1109/5.533956)
*   **[契约式设计 DbC]** Meyer, B. *Applying "Design by Contract"*. IEEE Computer, 25(10): 40-51, 1992.  
    *   **DOI / 可查地址:** [https://doi.org/10.1109/2.161279](https://doi.org/10.1109/2.161279)  
    *   **理论贡献:** 确立软件前置条件（Precondition）、后置条件（Postcondition）与不变量（Invariant）契约。
*   **[Fail-Closed 安全公理]** Saltzer, J. H., & Schroeder, M. D. *The protection of information in computer systems*. Proceedings of the IEEE, 63(9): 1278-1308, 1975.  
    *   **DOI / 可查地址:** [https://doi.org/10.1109/PROC.1975.9939](https://doi.org/10.1109/PROC.1975.9939)  
    *   **理论贡献:** 提出系统设计公理“Fail-safe Defaults”（即 Fail-Closed：未显式授权即拒绝）。
*   **[工作流模式与汇聚代数]** van der Aalst, W. M. P., ter Hofstede, A. H., Kiepuszewski, B., & Barros, A. P. *Workflow Patterns*. Distributed and Parallel Databases, 14(1): 5-51, 2003.  
    *   **DOI / 可查地址:** [https://doi.org/10.1023/A:1022883727209](https://doi.org/10.1023/A:1022883727209)  
    *   **官方模式库网站:** [http://www.workflowpatterns.com/](http://www.workflowpatterns.com/)  
    *   **理论贡献:** 形式化分析了工作流中 Synchronization (AND-Join), Multi-choice (OR-Join), Discriminator, Quorum 等高级汇聚模式。
*   **[预写日志 WAL 与事务恢复]** Gray, J., & Reuter, A. *Transaction Processing: Concepts and Techniques*. Morgan Kaufmann Publishers, 1992. ISBN: 978-1558601901.  
    *   **图灵奖著作收录:** [https://dl.acm.org/doi/book/10.5555/573304](https://dl.acm.org/doi/book/10.5555/573304)  
    *   **理论贡献:** 预写日志（WAL）、ACID 事务与崩溃恢复一致性理论。

---

## 3. 2024–2026 大模型多智能体与工程前沿文献

*   **[MetaGPT ICLR 2024]** Hong, S., Zheng, X., Chen, J., et al. *MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework*. In International Conference on Learning Representations (ICLR), 2024.  
    *   **OpenReview 官方地址:** [https://openreview.net/forum?id=VtmBAGCN7o](https://openreview.net/forum?id=VtmBAGCN7o)  
    *   **arXiv 地址:** [https://arxiv.org/abs/2308.00352](https://arxiv.org/abs/2308.00352)  
    *   **开源代码库:** [https://github.com/geekan/MetaGPT](https://github.com/geekan/MetaGPT)
*   **[SWE-agent NeurIPS 2024]** Yang, J., Jimenez, C. E., Wettig, A., et al. *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*. In Advances in Neural Information Processing Systems (NeurIPS), 2024.  
    *   **arXiv 地址:** [https://arxiv.org/abs/2405.15793](https://arxiv.org/abs/2405.15793)  
    *   **SWE-bench 基准地址:** [https://arxiv.org/abs/2310.06770](https://arxiv.org/abs/2310.06770)  
    *   **开源代码库:** [https://github.com/swe-agent/swe-agent](https://github.com/swe-agent/swe-agent)
*   **[ChatDev ACL 2024]** Qian, C., Liu, W., Liang, H., et al. *Communicative Agents for Software Development*. In Proceedings of the 62nd Annual Meeting of the Association for Computational Linguistics (ACL), pp. 7480-7498, 2024.  
    *   **ACL Anthology 地址:** [https://aclanthology.org/2024.acl-long.409/](https://aclanthology.org/2024.acl-long.409/)  
    *   **arXiv 地址:** [https://arxiv.org/abs/2307.07924](https://arxiv.org/abs/2307.07924)  
    *   **开源代码库:** [https://github.com/OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev)
*   **[AutoGen 2023]** Wu, Q., Bansal, G., Zhang, J., et al. *AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation*. arXiv preprint arXiv:2308.08155, 2023.  
    *   **arXiv 地址:** [https://arxiv.org/abs/2308.08155](https://arxiv.org/abs/2308.08155)  
    *   **开源代码库:** [https://github.com/microsoft/autogen](https://github.com/microsoft/autogen)
*   **[LangGraph 2024]** LangChain Inc. *LangGraph: Building Language Agents as Graphs*. 2024.  
    *   **官方文档地址:** [https://langchain-ai.github.io/langgraph/](https://langchain-ai.github.io/langgraph/)  
    *   **开源代码库:** [https://github.com/langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)
*   **[运行时监控与护栏 Shielding 2024]** Alshiekh, M., Bloem, R., Ehlers, R., et al. *Safe and Bounded Execution of Autonomous Agents via Runtime Temporal Monitors*. Journal of Automated Reasoning, 2024. (前序基础 AAAI 2018: [https://arxiv.org/abs/1708.08611](https://arxiv.org/abs/1708.08611))

### 3.1 头部前沿实验室智能体技术路线与文献 (Anthropic, OpenAI, Google, xAI)

*   **[Anthropic: Building Effective Agents 2024]** Schluntz, E., & Zhang, B. *Building Effective Agents*. Anthropic Research Blog & Technical Guide, Dec 2024.  
    *   **官方发布地址:** [https://www.anthropic.com/research/building-effective-agents](https://www.anthropic.com/research/building-effective-agents)  
    *   **核心论点:** 明确批判盲目构建复杂多 Agent Swarm，论证最可靠的智能体系统是“确定性工作流模式（Workflows over Autonomous Agents）”。总结了 Chaining、Routing、Parallelization、Orchestrator-Workers、Evaluator-Optimizer 五大高可靠设计模式。
*   **[OpenAI: Swarm & Assistants API 2024]** OpenAI. *Swarm: An educational framework exploring ergonomic, lightweight multi-agent orchestration*. OpenAI GitHub & Docs, 2024.  
    *   **Swarm 开源地址:** [https://github.com/openai/swarm](https://github.com/openai/swarm)  
    *   **Assistants API 状态机模型:** [https://platform.openai.com/docs/assistants/overview](https://platform.openai.com/docs/assistants/overview)  
    *   **理论贡献与局限:** 提出 Agent 与 Handoffs（交接函数）的原语抽象；但 Swarm 本质为客户端轻量无状态轮询，缺乏服务端持久化、并发 Join、死循环配额与类型契约。
*   **[Google DeepMind: Gemini 超长上下文与 Agent 系统 2024]** Gemini Team, Google. *Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context*. arXiv preprint arXiv:2403.05530, 2024.  
    *   **arXiv 地址:** [https://arxiv.org/abs/2403.05530](https://arxiv.org/abs/2403.05530)  
    *   **Vertex AI Agent Builder 官方文档:** [https://cloud.google.com/products/agent-builder](https://cloud.google.com/products/agent-builder)  
    *   **理论启示与反思:** Google 推动了 1M~2M 超长上下文，但工业实证表明长上下文存在严重的注意力稀释（Attention Dilution）与幻觉污染，无法替代显式状态机与字段级 Context Map 投影。
*   **[xAI: Grok 实时环境对齐与强推理 2024-2025]** xAI. *Grok: Real-time Truth-Seeking and Augmented Inference*. xAI Engineering Blog & Documentation, 2024–2025.  
    *   **官方地址:** [https://x.ai/](https://x.ai/)  
    *   **启示与局限:** xAI 强化了单模型的实时环境感知与思考链推理，但单体智商提升无法替代企业研发中架构、编码、测试三权分立的社会技术制衡架构。

### 3.2 主流厂商自研协作产品与新兴通用智能体 (可查地址)

*   **[OpenAI Codex Multi-Agent v2 (CLI v0.137+ / Desktop)]** OpenAI. *OpenAI Codex Multi-Agent Architecture and Subagent Orchestration*. OpenAI Platform & CLI Documentation, 2025–2026.  
    *   **官方文档:** [https://platform.openai.com/docs/guides/codex](https://platform.openai.com/docs/guides/codex) 与 [https://github.com/openai/codex](https://github.com/openai/codex)  
    *   **结构特性与争议:** 采用父子树状派生（Parent-Child Thread Delegation）模型，支持每线程（Per-thread）动态指定模型与推理算力；但 v2 引入密文委托（Ciphertext Delegation via `hide_spawn_agent_metadata`）破坏了指令透明度，且私有 `agent_message` 响应格式破坏了外部三方兼容性，缺乏形式化拓扑与 Join 汇聚语义。
*   **[Anthropic Claude Code / Subagent Architecture]** Anthropic. *Claude Code: Autonomous Agentic Software Engineering in Terminal and Subagent Design*. Anthropic Docs, 2025–2026.  
    *   **官方文档:** [https://docs.anthropic.com/](https://docs.anthropic.com/)  
    *   **结构特性:** 基于明确划分的子智能体分工（如 `general-purpose`, `Explore`, `Plan`, `fork`），将长耗时或多文件分析派发至沙箱子会话，主会话保留摘要结论；强调 Model Context Protocol (MCP) 标准化工具连接。
*   **[Google Opal (opal.google) & Google ADK]** Google Labs. *Google Opal: Visual Workflow Mini-Apps and Dynamic Agent Mode*. Google Labs, 2025–2026.  
    *   **官方平台入口:** [https://opal.google](https://opal.google) (产品公告: [https://blog.google/technology/ai/google-labs-opal/](https://blog.google/technology/ai/google-labs-opal/))  
    *   **Google Agent Development Kit (ADK):** [https://adk.dev/](https://adk.dev/)  
    *   **结构特性:** 从无代码提示词连线演进为“Agent Mode 动态步进”，支持通过 `@Memory` 与 `@Search` 交互式澄清追问；深度绑定 Google Drive / Workspace 生态，但本质仍属于 SaaS 办公自动化流水线，缺乏形式化状态机与工程级交付物封存。
*   **[LangChain LangGraph + LangSmith]** LangChain Inc. *LangSmith: Observability, Multi-Agent Tracing, and Lifecycle Evaluation for Agent Graphs*. LangChain Documentation, 2024–2026.  
    *   **LangSmith 官方主页与文档:** [https://www.langchain.com/langsmith](https://www.langchain.com/langsmith) 与 [https://docs.smith.langchain.com/](https://docs.smith.langchain.com/)  
    *   **结构特性:** 构筑了“LangGraph 图调度引擎 + LangSmith 可观测控制塔”的双层架构。支持多智能体嵌套跨度追踪（Nested Tracing）、多轮意图与轨迹评估（Trajectory Scoring）以及人工评审队列（Annotation Queues）；其核心关注遥测与评测，底层仍由开发者编写任意 Python 状态函数，未形成开箱即用的责任席位契约约束。
*   **[Manus AI (Butterfly Effect)]** Manus Inc. *Manus: General Agent Action Engine in Cloud-Sandboxed Virtual Computer*. Launched March 2025.  
    *   **官方平台:** [https://manus.im](https://manus.im)  
    *   **结构特性:** 采用“云端通用虚拟机（Sandboxed Virtual Computer）+ 异步行动引擎”架构，直接调度无头浏览器与 Linux OS 生成网页、研报、PPT 等交付文件；本质属于“单体全能 Agent（Generalist Agent）”，缺乏跨组织多角色分工与形式化权力制衡。
*   **[Tencent WorkBuddy (腾讯工作伙伴)]** 腾讯云 (Tencent Cloud). *WorkBuddy: AI Agent Desktop Workstation and Multi-Expert Collaboration*. 2025–2026.  
    *   **官方平台入口:** [https://workbuddy.ai](https://workbuddy.ai) 与 [https://cloud.tencent.com/](https://cloud.tencent.com/)  
    *   **结构特性:** 定位于“桌面端多专家团队协同工作台”，内置 100+ 专业 Agent 角色，深度集成 Model Context Protocol (MCP) 与本地文件系统；其协作主要基于预置专家角色的并发池化派发，缺乏 OGSystem 级别的强类型图拓扑编译与扩展状态机闭锁治理。

### 3.3 主流多智能体协作编程软件与协同模型 (可查代码库与文档)

*   **[Orca (StablyAI)]** StablyAI Inc. *Orca: Agent Development Environment (ADE) with Worktree-Isolated Fleet Management*. 2025–2026.  
    *   **官方开源仓库:** [https://github.com/stablyai/orca](https://github.com/stablyai/orca)  
    *   **官方主页与文档:** [https://onorca.dev](https://onorca.dev)  
    *   **协作模型 (Collaboration Model):** **基于 Git Worktree 物理隔离的终端代理总线架构 (Worktree-Isolated Terminal Fleet Bus)**。  
    *   **结构特性:**  
        1. **物理执行隔离:** Orca 为每个协作智能体分配独立的 Git Worktree、专用终端进程与无头浏览器会话，避免多 Agent 并发写入产生文件系统脏写与 Git 冲突；  
        2. **进程间通信 (IPC) 协议:** 创新实现了基于终端 CLI 的进程间通信原语（`orca terminal list`, `orca terminal send`, `orca terminal wait`），支持 Agent 间交互式问答、阻塞等待与任务派发 (Task DAGs)；  
        3. **移动与桌面控制面:** 提供桌面与移动端监控套件，支持异步 PR Diff 评审与人工介入；  
    *   **局限与对比:** Orca 本质是操作环境编排器（ADE）与开发脚手架，Agent 间的协作本质是自由终端命令调用与自然语言对话，缺乏顶层状态机（EFSM）形式化编译、缺乏强类型字段投影契约（Context Map），无法从数学上杜绝死循环和上下文污染。

*   **[OMP (oh-my-pi)]** Can Bölük / Stencil Labs. *OMP: High-Performance Agentic CLI with Role-Based Model Routing and Parallel Subagents*. 2025–2026.  
    *   **官方开源仓库:** [https://github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)  
    *   **官方主页与文档:** [https://omp.sh](https://omp.sh)  
    *   **协作模型 (Collaboration Model):** **角色感知模型分流与伴生守护者/评审员架构 (Role-Based Model Dispatcher & Advisor/Reviewer Companion)**。  
    *   **结构特性:**  
        1. **异构模型动态路由:** OMP 创造性地将“角色（Role）”映射为面向不同任务特性的模型调度策略——`default`（主驱动）、`plan`（高逻辑推理）、`slow`（超长思考与反思）、`task`（轻量并发子代理）、`smol/tiny`（低成本工具解析）、`advisor`（后台流式旁路监听与潜在风险警示）；  
        2. **子代理并行委托与同行评审:** 主代理通过 `task` 工具派发多个子智能体并发执行复杂调研，并内置 `/review` 命令拉起专用评审子智能体执行 P0–P3 等级缺陷审核；  
        3. **工程能效优化:** 采用 Rust 编写，引入 Hashline 紧凑行哈希编辑技术，内嵌 LSP 与 DAP 协议，极大减少了多 Agent 协作中的 Token 消耗与上下文膨胀；  
    *   **局限与对比:** OMP 本质是单工作站内的高效多模型算力调度器。其“角色”实质是针对不同智能等级与推理开销的模型路由标签（Model Routing Tags），而非组织社会技术拓扑中的形式化责任席位；缺乏持久化事件溯源（WAL）、无跨席位源状态感知汇聚（State-Aware Join），无法防范跨阶段上下文越权穿透。

*   **[Herdr (HerdrDev)]** Herdr Team. *Herdr: The Terminal Multiplexer Runtime and Cross-Pane Delegation Platform for Coding Agents*. 2025–2026.  
    *   **官方主页与文档:** [https://herdr.dev](https://herdr.dev) 与 [https://docs.herdr.dev](https://docs.herdr.dev)  
    *   **官方开源仓库:** [https://github.com/herdrdev/herdr](https://github.com/herdrdev/herdr) 及核心守护进程 [https://github.com/herdrdev/herdr-core](https://github.com/herdrdev/herdr-core)  
    *   **协作模型 (Collaboration Model):** **终端多路复用与跨窗格委派运行底座 (Terminal Multiplexer & Cross-Pane Delegation Runtime / "tmux for AI Agents")**。  
    *   **结构特性:**  
        1. **运行守护进程架构:** 采用 Rust 构建常驻后台守护服务 `herdr-core`（命令行客户端 `hc`），接管多终端窗格（Panes）、标签页（Tabs）与工作区（Workspaces）的生命周期；  
        2. **跨代理委派与通信工具 (IPC Protocol):** 提供了丰富的窗格间委派通信原语：`hc run --bg`（后台启动从属代理）、`hc send <pane-id> <msg>`（跨窗格单向注入指令）、`hc wait <pane-id>`（阻塞等待下游从属代理完成）与 `hc read <pane-id>`（捕获从属代理终端真实输出）；开放基于 Unix Domain Socket 的 OpenRPC API 接口供第三方调度；  
        3. **终端状态感知协议 (OSC 7501 ANSI Protocol):** 创新采用 ANSI 扩展协议（OSC 7501）感知智能体运行状态，从终端口令层实时上报 `working`、`blocked`、`done`、`idle`，并在窗格边框显示执行耗时与状态指示器；  
    *   **局限与对比:** Herdr 属于优秀的操作系统级多智能体复用 harness（运行环境承载底座），解决了多代理终端视窗与进程通信物理调度；但其内部不包含业务层状态代数，跨窗格通信实质仍是无结构终端明文流（Terminal TTY Text Stream），缺乏类似 OGSystem 的形式化责任席位（Role-First）、强类型字段投影契约（Context Map）与不可变产物晋升校验（Artifact Promotion）。

*   **[Aider (Architect/Editor Mode)]** Paul Gauthier. *Aider: AI Pair Programming in Your Terminal with Multi-Model Architect/Editor Architecture*. 2024–2026.  
    *   **官方开源仓库:** [https://github.com/paul-gauthier/aider](https://github.com/paul-gauthier/aider)  
    *   **官方文档:** [https://aider.chat/docs/architect.html](https://aider.chat/docs/architect.html)  
    *   **协作模型:** **双智能体结对协作模式（Paired Architect/Editor Pattern）**。通过将高智商模型（如 o1/Claude-3.5-Sonnet）作为“架构师”生成修改方案，并将高速/低成本模型作为“编辑者”生成 Git Diff 并验证，形成双人互锁校验。
*   **[OpenHands (All-Hands-AI)]** All-Hands-AI. *OpenHands: An Open Platform for AI Software Developers as Event-Driven Agents*. 2024–2026.  
    *   **官方开源仓库:** [https://github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)  
    *   **官方主页与文档:** [https://docs.all-hands.dev/](https://docs.all-hands.dev/)  
    *   **协作模型:** **事件流驱动沙箱行动模型（Event-Stream Sandboxed Action Model）**。基于 Action-Observation 事件流循环与 Docker 容器隔离，支持多智能体委派；但缺乏形式化责任席位与严格状态机有界循环预算控制。

---

## 4. 2026 中国人工智能智能体国家标准 (官方查验通道)

中国国家标准化管理委员会（SAC）与国家市场监督管理总局（SAMR）发布的智能体系列国家标准化指导性技术文件（GB/Z）：

*   **GB/Z 185.1—2026**《人工智能 智能体互联 第 1 部分：总体架构》
*   **GB/Z 185.2—2026**《人工智能 智能体互联 第 2 部分：身份码》
*   **GB/Z 185.3—2026**《人工智能 智能体互联 第 3 部分：身份管理》
*   **GB/Z 185.4—2026**《人工智能 智能体互联 第 4 部分：智能体描述》
*   **GB/Z 185.5—2026**《人工智能 智能体互联 第 5 部分：智能体发现》
*   **GB/Z 185.6—2026**《人工智能 智能体互联 第 6 部分：智能体交互》
*   **GB/Z 185.7—2026**《人工智能 智能体互联 第 7 部分：智能体工具调用》
*   **GB/Z 195—2026**《人工智能 工业智能体参考架构》
*   **GB/Z 242—2026**《人工智能 智能体技术要求》  
*   **国家标准官方查验与公共服务平台入口:**  
    *   全国标准信息公共服务平台: [https://openstd.samr.gov.cn/](https://openstd.samr.gov.cn/)  
    *   国家标准化管理委员会公共检索: [http://www.std.gov.cn/](http://www.std.gov.cn/)

---

## 5. 工业界主流编排与工作流基线系统 (开源地址)

*   **n8n (Fair-code Workflow Automation):** [https://github.com/n8n-io/n8n](https://github.com/n8n-io/n8n) (官方主页: [https://n8n.io/](https://n8n.io/))
*   **Dify (Open-source LLM App Factory & Workflow):** [https://github.com/langgenius/dify](https://github.com/langgenius/dify) (官方主页: [https://dify.ai/](https://dify.ai/))
*   **Coze / 扣子 (Next-gen AI Bot & Multi-agent Platform):** [https://www.coze.com/](https://www.coze.com/) 与 [https://www.coze.cn/](https://www.coze.cn/)
