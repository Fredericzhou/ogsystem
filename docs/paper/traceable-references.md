# OGSystem 理论与工程可溯源文献库 (2015–2026)
# Traceable Literature and Standards Baseline

本文档为 OGSystem 论文提供经筛选的可查验学术文献、公开项目与标准核验线索；它不是穷尽式系统综述。

---

## 1. 分布式状态机与持久化工作流的理论/工业参照 (可查地址)

本节汇集状态机、工作流和持久化执行的经典理论与工业系统。下列工作是 OGS 的先行基础和工程参照，不表示其理论始于这些产品，也不表示 OGS 首创持久化执行。

*   **[AWS Step Functions 2016]** Amazon Web Services. *New – AWS Step Functions: Build Distributed Applications Using Visual Workflows*. AWS Official Launch Announcement & Documentation, Dec 2016.  
    *   **官方发布地址:** [https://aws.amazon.com/blogs/aws/new-aws-step-functions-build-distributed-applications-using-visual-workflows/](https://aws.amazon.com/blogs/aws/new-aws-step-functions-build-distributed-applications-using-visual-workflows/)  
    *   **规范标准 (Amazon States Language - ASL):** [https://states-language.net/spec.html](https://states-language.net/spec.html)  
    *   **本论文中的归属:** 作为声明式状态机工作流的工业实例；不将其视为状态机理论或分布式工作流的起源。
*   **[Uber Cadence / Temporal]** Uber Engineering / Temporal Technologies. Cadence is an open-source workflow orchestration system; Temporal continued this line of durable execution systems.
    *   **Cadence 开源项目:** [https://github.com/uber/cadence](https://github.com/uber/cadence)
    *   **Temporal 官方文档:** [https://docs.temporal.io/](https://docs.temporal.io/)
    *   **本论文中的归属:** 作为持久化工作流执行、事件历史和恢复的工业参照；不将其描述为 WAL、事件溯源或持久化执行理论的起源。
*   **[Newman 2015]** Newman, S. *Building Microservices: Designing Fine-Grained Systems*. O'Reilly Media, 2015. ISBN: 978-1491950357.  
    *   **官方可查地址:** [https://samnewman.io/books/building_microservices/](https://samnewman.io/books/building_microservices/)  
    *   **本论文中的归属:** 作为中心编排与自由编舞的工程设计参考；不据此断言所有复杂多节点协作都必须采用单一全局编排器。
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
    *   **DOI / 可查地址:** [https://doi.org/10.1145/157485.164585](https://doi.org/10.1145/157485.164585)
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
*   **[Saga 长事务协调]** Garcia-Molina, H., & Salem, K. *Sagas*. Proceedings of the 1987 ACM SIGMOD International Conference on Management of Data, pp. 249–259, 1987. DOI: [10.1145/38713.38742](https://doi.org/10.1145/38713.38742).
    *   **理论贡献:** 将长事务拆分为一系列子事务，并讨论失败时的补偿执行。OGS Release 的 prepare、materialize、canonical-ref 更新、publish 与 reconcile 状态应放在既有多阶段事务/补偿工作流背景下讨论；本论文不将分阶段发布或失败协调本身称为原创。
*   **[工作流异常模式]** Russell, N., van der Aalst, W. M. P., & ter Hofstede, A. H. *Workflow Exception Patterns*. In *Advanced Information Systems Engineering (CAiSE 2006)*, LNCS Vol. 4001, pp. 288–302, 2006. DOI: [10.1007/11767138_20](https://doi.org/10.1007/11767138_20).
    *   **理论贡献:** 对工作流异常处理模式作系统分类。它支持“异常/失败处理是既有工作流研究问题”，但不直接证明 OGS 四值 Join 状态和 Workspace/Release 组合已被覆盖。
*   **[工作流系统异常处理]** Luo, Z., Sheth, A., Kochut, K., & Miller, J. *Exception Handling in Workflow Systems*. Applied Intelligence, 13(2): 125–147, 2000. DOI: [10.1023/A:1008388412284](https://doi.org/10.1023/A:1008388412284).
    *   **理论贡献:** 研究工作流运行期间的异常检测与处理。用于界定 OGS 的失败策略和超时动作所处的先行领域，不作为 OGS 特定状态不变量同质性的直接证据。
*   **[Durable Functions]** Burckhardt, S., Gill, G., Justo, D., Kallas, K., McMahon, C., & Meiklejohn, C. *Durable Functions: Semantics for Stateful Serverless*. Proceedings of the ACM on Programming Languages, 5(OOPSLA), Article 133, 2021. DOI: [10.1145/3485510](https://doi.org/10.1145/3485510).
    *   **理论贡献:** 形式化有状态 serverless 函数的持久化执行语义。与 Gray–Reuter 和 Temporal 一起作为持久执行/恢复先行工作；不替代 OGS 在同一故障条件下的比较评估。

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
*   **[ChatDev ACL 2024]** Qian, C., Liu, W., Liu, H., et al. *ChatDev: Communicative Agents for Software Development*. In Proceedings of the 62nd Annual Meeting of the Association for Computational Linguistics (ACL), pp. 15174–15186, 2024.
    *   **DOI:** [10.18653/v1/2024.acl-long.810](https://doi.org/10.18653/v1/2024.acl-long.810)
    *   **ACL Anthology 地址:** [https://aclanthology.org/2024.acl-long.810/](https://aclanthology.org/2024.acl-long.810/)
    *   **arXiv 地址:** [https://arxiv.org/abs/2307.07924](https://arxiv.org/abs/2307.07924)  
    *   **开源代码库:** [https://github.com/OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev)
*   **[AutoGen 2023]** Wu, Q., Bansal, G., Zhang, J., et al. *AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation*. arXiv preprint arXiv:2308.08155, 2023.  
    *   **arXiv 地址:** [https://arxiv.org/abs/2308.08155](https://arxiv.org/abs/2308.08155)  
    *   **开源代码库:** [https://github.com/microsoft/autogen](https://github.com/microsoft/autogen)
*   **[LangGraph Documentation]** LangChain Inc. *LangGraph Documentation and Test Guide*. Official framework documentation; not a peer-reviewed task-quality evaluation.
    *   **官方文档地址:** [https://docs.langchain.com/oss/python/langgraph/overview](https://docs.langchain.com/oss/python/langgraph/overview)
    *   **测试指南:** [https://docs.langchain.com/oss/python/langgraph/test](https://docs.langchain.com/oss/python/langgraph/test)
    *   **开源代码库:** [https://github.com/langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)
    *   **本论文中的归属:** StateGraph、循环、路由和 checkpoint 是 LangGraph 的公开执行能力；OGS 当前以 LangGraph 执行编译计划，并在 OGS Runtime 定义 Role、业务合同和 Workspace/Release 语义。LangGraph 将作为纯引擎匹配基线；本条不是 LangGraph 的性能论文，也不表示图执行引擎可替换已经得到验证。
*   **[Temporal Durable Execution]** Temporal Technologies. *Temporal Documentation: Durable Execution*.
    *   **官方文档:** [https://docs.temporal.io/](https://docs.temporal.io/)
    *   **本论文中的归属:** 持久化执行、事件历史和恢复是既有工程思想，作为 OGS 状态持久化与恢复设计的参照，不作为 OGS 原创。
*   **[Git Worktree]** Git Project. *git-worktree Documentation*.
    *   **官方文档:** [https://git-scm.com/docs/git-worktree](https://git-scm.com/docs/git-worktree)
    *   **本论文中的归属:** Worktree 隔离和 commit 版本历史是 OGS 所依赖的 Git 能力；OGS 的候选贡献是其在多 Role Workspace 协作合同中的使用方式。
*   **[Chubby Lock Service]** Burrows, M. *The Chubby Lock Service for Loosely-Coupled Distributed Systems*. Proceedings of OSDI 2006. [USENIX paper](https://www.usenix.org/legacy/event/osdi06/tech/full_papers/burrows/burrows.pdf). Distributed lock services and sequencer-based fencing are prior art for coordinating authoritative mutations.
*   **[in-toto]** Torres-Arias, S., Afzali, H., Kuppusamy, T. K., Curtmola, R., & Cappos, J. *in-toto: Providing Farm-to-Table Guarantees for Bits and Bytes*. USENIX Security Symposium, 2019. [USENIX paper](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias). Software supply-chain provenance and attestations are prior art for traceable build/release records.
*   **[SLSA Provenance]** OpenSSF. *SLSA Provenance Specification, v1.0*. [Specification](https://slsa.dev/spec/v1.0/provenance). A contemporary public specification for build provenance; included as an attribution reference, not as proof of OGS conformance.
*   **[运行时监控与护栏 Shielding 2018]** Alshiekh, M., Bloem, R., Ehlers, R., Könighofer, B., Niekum, S., & Topcu, U. *Safe Reinforcement Learning via Shielding*. In Proceedings of the AAAI Conference on Artificial Intelligence (AAAI), 2018. ([arXiv:1708.08611](https://arxiv.org/abs/1708.08611))

### 3.1 近三年可核验论文（2024–2026，相关工作与对照基线）

下列条目由 Crossref、ACL Anthology、OpenReview 或 arXiv 元数据核验；OpenAlex 引用数仅作公开索引覆盖度旁证，检索日期为 2026-11-19，不等同于 Google Scholar 数值。DOI 条目可按 `https://api.openalex.org/works/https://doi.org/{DOI}` 查询复核。它们用于相关工作和对照基线，不构成 OGS 的实证证据。

* **[Autonomous Agents Survey 2024]** Wang, L., et al. *A Survey on Large Language Model Based Autonomous Agents*. Frontiers of Computer Science, 18, 186345, 2024. DOI: [10.1007/s11704-024-40231-1](https://doi.org/10.1007/s11704-024-40231-1); preprint [arXiv:2308.11432](https://arxiv.org/abs/2308.11432). 用于校准 Agent 架构、规划、记忆、工具和评估的研究范围，不作为特定 Workspace/Release 协议新颖性的证据。OpenAlex cited_by_count: **5,383**（retrieved 2026-11-19）。
* **[LLM-Based Agents Survey 2025]** Xi, Z., et al. *The Rise and Potential of Large Language Model Based Agents: A Survey*. *Science China Information Sciences*, 68(2), 2025. [DOI: 10.1007/s11432-024-4222-0](https://doi.org/10.1007/s11432-024-4222-0) · [arXiv:2309.07864](https://arxiv.org/abs/2309.07864). Used as a broad agent-literature map, not as evidence for OGS novelty or effects. OpenAlex cited_by_count: **3,314** (retrieved 2026-11-19); this is an OpenAlex index count, not a Google Scholar count.

### 3.2 组织管理与 AI 风险治理参照

* **[Organization Design]** Mintzberg, H. *The Structuring of Organizations: A Synthesis of the Research*. Prentice-Hall, 1979. [Google Books bibliographic record](https://books.google.com/books?id=kw1HAAAAMAAJ). 用于职责分化与协调机制的经典组织设计背景；不将管理理论本身归为 OGS 创新。
* **[Agency Theory Review]** Eisenhardt, K. M. “Agency Theory: An Assessment and Review.” *Academy of Management Review*, 14(1), 57–74, 1989. [DOI: 10.2307/258191](https://doi.org/10.2307/258191). 用于委托、信息不对称与监督问题的概念背景；本文仅将其映射到运行时控制点。
* **[NIST AI RMF 1.0]** National Institute of Standards and Technology. *Artificial Intelligence Risk Management Framework (AI RMF 1.0)*, 2023. [DOI: 10.6028/NIST.AI.100-1](https://doi.org/10.6028/NIST.AI.100-1) · [official PDF](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf). Public risk-management reference; OGS does not claim full implementation or conformance.
* **[NIST Generative AI Profile]** National Institute of Standards and Technology. *Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile*, 2024. [DOI: 10.6028/NIST.AI.600-1](https://doi.org/10.6028/NIST.AI.600-1) · [official PDF](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf). GenAI-specific risk reference; not an OGS evaluation or conformance claim.
* **[SWE-agent NeurIPS 2024]** Yang, J., Jimenez, C. E., Wettig, A., et al. *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*. NeurIPS 2024. DOI: [10.52202/079017-1601](https://doi.org/10.52202/079017-1601); [arXiv:2405.15793](https://arxiv.org/abs/2405.15793). 对照 Workspace/Execution 隔离、工具边界与可验证软件交付。OpenAlex cited_by_count: **3,585**（retrieved 2026-11-19）。
* **[SWE-bench ICLR 2024]** Jimenez, C. E., Yang, J., Wettig, A., et al. *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?* ICLR 2024; [arXiv:2310.06770](https://arxiv.org/abs/2310.06770). 对照真实 Git 仓库问题的端到端验证基准。
* **[ChatDev ACL 2024]** Qian, C., Liu, W., Liu, H., et al. *ChatDev: Communicative Agents for Software Development*. ACL 2024, pp. 15174–15186. DOI: [10.18653/v1/2024.acl-long.810](https://doi.org/10.18653/v1/2024.acl-long.810); [ACL Anthology](https://aclanthology.org/2024.acl-long.810/); [arXiv:2307.07924](https://arxiv.org/abs/2307.07924). 对照角色/对话式协作编排。OpenAlex cited_by_count: **1,589**（retrieved 2026-11-19）。
* **[OSWorld NeurIPS 2024]** Xie, T., et al. *OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments*. NeurIPS 2024. DOI: [10.52202/079017-1650](https://doi.org/10.52202/079017-1650); [arXiv:2404.07972](https://arxiv.org/abs/2404.07972). 对照真实执行环境、任务状态与证据采集。OpenAlex cited_by_count: **1,926**（retrieved 2026-11-19）。
* **[OpenHands ICLR 2025; preprint 2024]** Wang, X., et al. *OpenHands: An Open Platform for AI Software Developers as Generalist Agents*. ICLR 2025; preprint [arXiv:2407.16741](https://arxiv.org/abs/2407.16741). 对照软件开发 Agent 的 runtime、工具交互和执行环境；其具体 WorkspaceRef、canonical-ref 更新、Evidence 与 Release 协议是否等价，仍须逐项查证，不能由平台定位推断。OpenAlex cited_by_count: **1,051**（retrieved 2026-11-19）。
* **[Agentless 2024]** Xia, C. S., et al. *Agentless: Demystifying LLM-based Software Engineering Agents*. arXiv 2024; [arXiv:2407.01489](https://arxiv.org/abs/2407.01489). 对照简化的定位、规划和编辑流程。
* **[CodeAct ICML 2024]** Wang, G., et al. *CodeAct: Executable Code Actions Elicit Better LLM Agents*. ICML 2024; [arXiv:2402.01030](https://arxiv.org/abs/2402.01030). 对照 Execution 层的可执行工具动作与隔离环境。
* **[MALLM EMNLP 2025]** Becker, J., et al. *MALLM: Multi-Agent Large Language Models Framework*. EMNLP 2025 System Demonstrations. DOI: [10.18653/v1/2025.emnlp-demos.29](https://doi.org/10.18653/v1/2025.emnlp-demos.29). 对照多智能体角色和通信编排。OpenAlex cited_by_count: **25**（retrieved 2026-11-19）。
* **[SWE-bench Goes Live NeurIPS 2025]** Zhang, L., et al. *SWE-bench Goes Live!* NeurIPS 2025. DOI: [10.52202/085713-4923](https://doi.org/10.52202/085713-4923). 对照持续、动态的软件工程评测与 Evidence 层。OpenAlex cited_by_count: **199**（retrieved 2026-11-19）。
* **[Code Graph Model NeurIPS 2025]** Tao, H., et al. *Code Graph Model (CGM): A Graph-Integrated Large Language Model for Repository-Level Software Engineering Tasks*. NeurIPS 2025. DOI: [10.52202/085713-0537](https://doi.org/10.52202/085713-0537). 对照代码图、Workspace 内容关系与仓库级任务。OpenAlex cited_by_count: **53**（retrieved 2026-11-19）。
* **[Embedding Traceability FSE Companion '25]** Wang, F., et al. *Embedding Traceability in Large Language Model Code Generation: Towards Trustworthy AI-Augmented Software Engineering*. FSE Companion '25 (33rd ACM International Conference on the Foundations of Software Engineering). DOI: [10.1145/3696630.3730569](https://doi.org/10.1145/3696630.3730569). 对照 Evidence、provenance 与 traceability。OpenAlex cited_by_count: **9**（retrieved 2026-11-19）。
* **[ReqInOne IEEE RE 2025]** Zhu, T., et al. *ReqInOne: A Large Language Model-Based Agent for Software Requirements Specification Generation*. IEEE RE 2025. DOI: [10.1109/re63999.2025.00054](https://doi.org/10.1109/re63999.2025.00054). 对照 Business 层需求与 Role Contract 的输入/输出边界。OpenAlex cited_by_count: **17**（retrieved 2026-11-19）。

### 3.3 高引用协作系统的补充先行基线（2023）

以下工作早于近三年窗口或处于窗口边界，但其引用覆盖和与多角色协作的直接相关性使其适合作为先行基线；不把它们混称为 2024–2026 新近研究。

* **[AutoGen 2023]** Wu, Q., Bansal, G., Zhang, J., et al. *AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation*. [arXiv:2308.08155](https://arxiv.org/abs/2308.08155). 作为可编程多 Agent 对话、消息交互与控制转移先例。OpenAlex cited_by_count: **4,086**（retrieved 2026-11-19）。
* **[MetaGPT ICLR 2024 / preprint 2023]** Hong, S., Zheng, X., Chen, J., et al. *MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework*. [OpenReview](https://openreview.net/forum?id=VtmBAGCN7o); [arXiv:2308.00352](https://arxiv.org/abs/2308.00352). 作为标准化角色和软件生产流程的直接先例。OpenAlex cited_by_count: **2,831**（retrieved 2026-11-19）。

### 3.4 头部前沿实验室智能体技术路线与文献 (Anthropic, OpenAI, Google, xAI)

*   **[Anthropic: Building Effective Agents 2024]** Schluntz, E., & Zhang, B. *Building Effective Agents*. Anthropic Research Blog & Technical Guide, Dec 2024.  
    *   **官方发布地址:** [https://www.anthropic.com/research/building-effective-agents](https://www.anthropic.com/research/building-effective-agents)  
    *   **核心论点:** 明确批判盲目构建复杂多 Agent Swarm，论证最可靠的智能体系统是“确定性工作流模式（Workflows over Autonomous Agents）”。总结了 Chaining、Routing、Parallelization、Orchestrator-Workers、Evaluator-Optimizer 五大高可靠设计模式。
*   **[OpenAI: Swarm & Assistants API 2024]** OpenAI. *Swarm: An educational framework exploring ergonomic, lightweight multi-agent orchestration*. OpenAI GitHub & Docs, 2024.  
    *   **Swarm 开源地址:** [https://github.com/openai/swarm](https://github.com/openai/swarm)  
    *   **Assistants API 状态机模型:** [https://platform.openai.com/docs/assistants/overview](https://platform.openai.com/docs/assistants/overview)  
    *   **本论文中的归属:** 作为轻量 Agent 与 Handoff 抽象的公开参照；本文不将其产品范围概括为所有 OpenAI Agent 服务，也不据公开介绍未提及某项能力推断其缺失。
*   **[Google DeepMind: Gemini 超长上下文与 Agent 系统 2024]** Gemini Team, Google. *Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context*. arXiv preprint arXiv:2403.05530, 2024.  
    *   **arXiv 地址:** [https://arxiv.org/abs/2403.05530](https://arxiv.org/abs/2403.05530)  
    *   **Vertex AI Agent Builder 官方文档:** [https://cloud.google.com/products/agent-builder](https://cloud.google.com/products/agent-builder)  
    *   **本论文中的归属:** 作为长上下文模型能力的背景来源；本文未使用该论文证明长上下文普遍导致注意力稀释，也未将 Context Map 效果与长上下文方案作对照测量。
*   **[xAI: Grok 实时环境对齐与强推理 2024-2025]** xAI. *Grok: Real-time Truth-Seeking and Augmented Inference*. xAI Engineering Blog & Documentation, 2024–2025.  
    *   **官方地址:** [https://x.ai/](https://x.ai/)  
    *   **本论文中的归属:** 作为模型推理和实时信息能力的厂商背景来源；本文不据此对单模型方案与多角色组织设计作优劣判断。

### 3.5 主流厂商自研协作产品与新兴通用智能体 (可查地址)

*   **[OpenAI Codex Multi-Agent v2 (CLI v0.137+ / Desktop)]** OpenAI. *OpenAI Codex Multi-Agent Architecture and Subagent Orchestration*. OpenAI Platform & CLI Documentation, 2025–2026.  
    *   **官方文档:** [https://platform.openai.com/docs/guides/codex](https://platform.openai.com/docs/guides/codex) 与 [https://github.com/openai/codex](https://github.com/openai/codex)  
    *   **本论文中的归属:** 作为父子任务委派和线程级执行配置的公开参照。本文不对特定配置中的元数据可见性作价值判断，也不据此对其所有产品能力或兼容性作结论。
*   **[Anthropic Claude Code / Subagent Architecture]** Anthropic. *Claude Code: Autonomous Agentic Software Engineering in Terminal and Subagent Design*. Anthropic Docs, 2025–2026.  
    *   **官方文档:** [https://docs.anthropic.com/](https://docs.anthropic.com/)  
    *   **结构特性:** 基于明确划分的子智能体分工（如 `general-purpose`, `Explore`, `Plan`, `fork`），将长耗时或多文件分析派发至沙箱子会话，主会话保留摘要结论；强调 Model Context Protocol (MCP) 标准化工具连接。
*   **[Google Opal (opal.google) & Google ADK]** Google Labs. *Google Opal: Visual Workflow Mini-Apps and Dynamic Agent Mode*. Google Labs, 2025–2026.  
    *   **官方平台入口:** [https://opal.google](https://opal.google) (产品公告: [https://blog.google/technology/ai/google-labs-opal/](https://blog.google/technology/ai/google-labs-opal/))  
    *   **Google Agent Development Kit (ADK):** [https://adk.dev/](https://adk.dev/)  
    *   **本论文中的归属:** 作为视觉工作流与办公自动化产品的公开参照；本文未对其内部状态管理、交付或安全能力作系统测试。
*   **[LangChain LangGraph + LangSmith]** LangChain Inc. *LangSmith: Observability, Multi-Agent Tracing, and Lifecycle Evaluation for Agent Graphs*. LangChain Documentation, 2024–2026.  
    *   **LangSmith 官方主页与文档:** [https://www.langchain.com/langsmith](https://www.langchain.com/langsmith) 与 [https://docs.smith.langchain.com/](https://docs.smith.langchain.com/)  
    *   **结构特性:** 构筑了“LangGraph 图调度引擎 + LangSmith 可观测控制塔”的双层架构。支持多智能体嵌套跨度追踪（Nested Tracing）、多轮意图与轨迹评估（Trajectory Scoring）以及人工评审队列（Annotation Queues）；其核心关注遥测与评测，底层仍由开发者编写任意 Python 状态函数，未形成开箱即用的责任席位契约约束。
*   **[Manus AI (Butterfly Effect)]** Manus Inc. *Manus: General Agent Action Engine in Cloud-Sandboxed Virtual Computer*. Launched March 2025.  
    *   **官方平台:** [https://manus.im](https://manus.im)  
    *   **本论文中的归属:** 作为面向通用任务的云端 Agent 产品参照；本文未对其内部多角色协作、状态或交付合同作系统验证。
*   **[Tencent WorkBuddy (腾讯工作伙伴)]** 腾讯云 (Tencent Cloud). *WorkBuddy: AI Agent Desktop Workstation and Multi-Expert Collaboration*. 2025–2026.  
    *   **官方平台入口:** [https://workbuddy.ai](https://workbuddy.ai) 与 [https://cloud.tencent.com/](https://cloud.tencent.com/)  
    *   **本论文中的归属:** 作为桌面 Agent 工作台和多角色协作产品的公开参照；本文未对其内部图编译、状态合同或交付机制作系统验证。

### 3.6 主流多智能体协作编程软件与协同模型 (可查代码库与文档)

*   **[Orca Open-Source Product (StablyAI)]** StablyAI. Public product repository and documentation; not treated here as a peer-reviewed evaluation paper.
    *   **官方开源仓库:** [https://github.com/stablyai/orca](https://github.com/stablyai/orca)  
    *   **官方主页与文档:** [https://onorca.dev](https://onorca.dev)  
    *   **协作模型 (Collaboration Model):** **基于 Git Worktree 物理隔离的终端代理总线架构 (Worktree-Isolated Terminal Fleet Bus)**。  
    *   **结构特性:**  
        1. **物理执行隔离:** Orca 为每个协作智能体分配独立的 Git Worktree、专用终端进程与无头浏览器会话，避免多 Agent 并发写入产生文件系统脏写与 Git 冲突；  
        2. **进程间通信 (IPC) 协议:** 创新实现了基于终端 CLI 的进程间通信原语（`orca terminal list`, `orca terminal send`, `orca terminal wait`），支持 Agent 间交互式问答、阻塞等待与任务派发 (Task DAGs)；  
        3. **移动与桌面控制面:** 提供桌面与移动端监控套件，支持异步 PR Diff 评审与人工介入；  
    *   **本论文中的归属:** 作为 Worktree 隔离、终端委派和开发环境管理的公开产品参照；建议固定版本后做外部产品级对照。本文未对其业务状态、字段授权和发布能力作系统验证。

*   **[OMP (oh-my-pi)]** Can Bölük / Stencil Labs. *OMP: High-Performance Agentic CLI with Role-Based Model Routing and Parallel Subagents*. 2025–2026.  
    *   **官方开源仓库:** [https://github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)  
    *   **官方主页与文档:** [https://omp.sh](https://omp.sh)  
    *   **协作模型 (Collaboration Model):** **角色感知模型分流与伴生守护者/评审员架构 (Role-Based Model Dispatcher & Advisor/Reviewer Companion)**。  
    *   **结构特性:**  
        1. **异构模型动态路由:** OMP 创造性地将“角色（Role）”映射为面向不同任务特性的模型调度策略——`default`（主驱动）、`plan`（高逻辑推理）、`slow`（超长思考与反思）、`task`（轻量并发子代理）、`smol/tiny`（低成本工具解析）、`advisor`（后台流式旁路监听与潜在风险警示）；  
        2. **子代理并行委托与同行评审:** 主代理通过 `task` 工具派发多个子智能体并发执行复杂调研，并内置 `/review` 命令拉起专用评审子智能体执行 P0–P3 等级缺陷审核；  
        3. **工程实现:** 采用 Rust 核心与 TypeScript/Bun CLI 混合架构，并介绍 Hashline 行哈希编辑及 LSP/DAP 集成。本文不验证其 Token 节省幅度或对上下文使用的影响；
    *   **本论文中的归属:** 作为 Agent CLI 中角色标签、模型路由、子任务和评审功能的公开参照；本文不据此概括其全部使用方式或未公开的持久化与数据授权能力。

*   **[Herdr (HerdrDev)]** Herdr Team. *Herdr: The Terminal Multiplexer Runtime and Cross-Pane Delegation Platform for Coding Agents*. 2025–2026.  
    *   **官方主页与文档:** [https://herdr.dev](https://herdr.dev) 与 [https://docs.herdr.dev](https://docs.herdr.dev)  
    *   **官方开源仓库:** [https://github.com/herdrdev/herdr](https://github.com/herdrdev/herdr) 及核心守护进程 [https://github.com/herdrdev/herdr-core](https://github.com/herdrdev/herdr-core)  
    *   **协作模型 (Collaboration Model):** **终端多路复用与跨窗格委派运行底座 (Terminal Multiplexer & Cross-Pane Delegation Runtime / "tmux for AI Agents")**。  
    *   **结构特性:**  
        1. **运行守护进程架构:** 采用 Rust 构建常驻后台守护服务 `herdr-core`（命令行客户端 `hc`），接管多终端窗格（Panes）、标签页（Tabs）与工作区（Workspaces）的生命周期；  
        2. **跨代理委派与通信工具 (IPC Protocol):** 提供了丰富的窗格间委派通信原语：`hc run --bg`（后台启动从属代理）、`hc send <pane-id> <msg>`（跨窗格单向注入指令）、`hc wait <pane-id>`（阻塞等待下游从属代理完成）与 `hc read <pane-id>`（捕获从属代理终端真实输出）；开放基于 Unix Domain Socket 的 OpenRPC API 接口供第三方调度；  
        3. **终端状态感知协议 (OSC 7501 ANSI Protocol):** 采用 Mitchell Hashimoto 提出的通用终端状态扩展协议（OSC 7501 Program Status Protocol，键名 `state=<value>`）感知智能体运行状态，从终端层实时上报 `working`、`blocked`、`done`、`idle`、`error` 等状态，并在窗格边框显示执行耗时与状态指示器；
    *   **本论文中的归属:** 作为终端多路复用和跨窗格委派运行时的公开参照；本文未对其上层业务状态、数据授权或交付机制作系统验证。

*   **[Aider (Architect/Editor Mode)]** Paul Gauthier. *Aider: AI Pair Programming in Your Terminal with Multi-Model Architect/Editor Architecture*. 2024–2026.  
    *   **官方开源仓库:** [https://github.com/paul-gauthier/aider](https://github.com/paul-gauthier/aider)  
    *   **官方文档:** [https://aider.chat/docs/architect.html](https://aider.chat/docs/architect.html)  
    *   **协作模型:** **双智能体结对协作模式（Paired Architect/Editor Pattern）**。通过将高智商模型（如 o1/Claude-3.5-Sonnet）作为“架构师”生成修改方案，并将高速/低成本模型作为“编辑者”生成 Git Diff 并验证，形成双人互锁校验。
*   **[OpenHands (All-Hands-AI)]** All-Hands-AI. *OpenHands: An Open Platform for AI Software Developers as Event-Driven Agents*. 2024–2026.  
    *   **官方开源仓库:** [https://github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)  
    *   **官方主页与文档:** [https://docs.all-hands.dev/](https://docs.all-hands.dev/)  
    *   **本论文中的归属:** 作为事件流驱动软件 Agent 与隔离执行的公开参照；本文未对其责任模型和循环预算能力作系统验证。

---

## 4. 2026 中国人工智能智能体国家标准与条款核验边界

以下国家标准化指导性技术文件（`GB/Z`）的标准编号与正式题名已于 2026 年 5 月—8 月经国家市场监督管理总局、国家标准化管理委员会公开发布核实；**但本目录尚未取得并逐条核验标准全文条款，因此不构成对 OGS 的条款级映射或符合性证明**。如需条款级引用，仍须通过官方平台检索标准全文核对：

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

---

## 6. 实验设计与结果度量参考文献

以下来源用于设计仓库任务基准、幻觉标注和评审一致性方法。它们不构成 OGS 的实验结果；引用量若需报告，应标注数据库与检索日期。

* **[SWE-bench, ICLR 2024]** Jimenez, C. E., et al. *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?* 真实 GitHub 仓库问题解决基准。 [arXiv](https://arxiv.org/abs/2310.06770) · [OpenReview](https://openreview.net/forum?id=VTF8yNQM66)
* **[SWE-bench Verified, 2024]** OpenAI. *Introducing SWE-bench Verified.* 500 个 SWE-bench 样本的人类筛查子集及筛查说明。 [OpenAI 官方介绍](https://openai.com/index/introducing-swe-bench-verified/)
* **[SWE-agent, NeurIPS 2024]** Yang, J., et al. *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering.* Agent 与软件工程工具交互及执行基线。 [arXiv](https://arxiv.org/abs/2405.15793)
* **[Multiagent Debate, 2023 preprint]** Du, Y., et al. *Improving Factuality and Reasoning in Language Models through Multiagent Debate.* 多 Agent 讨论对事实性和推理效果的研究先例；OGS 是否改善任务表现仍需独立实验。 [arXiv](https://arxiv.org/abs/2305.14325)
* **[LLM Hallucination Survey, 2023 preprint]** Huang, L., et al. *A Survey on Hallucination in Large Language Models: Principles, Taxonomy, Challenges, and Open Questions.* 幻觉分类与评价问题综述。 [arXiv](https://arxiv.org/abs/2311.05232)
* **[RAGTruth, ACL 2024]** Niu, C., Wu, Y., Zhu, J., Xu, S., Shum, K., Zhong, R., Song, J., & Zhang, T. *RAGTruth: A Hallucination Corpus for Developing Trustworthy Retrieval-Augmented Language Models.* 含人工个案及词级标注的 RAG 幻觉语料；仅作为标注方法参考，不是软件工程 Agent 基准。 [ACL Anthology](https://aclanthology.org/2024.acl-long.585/) · [DOI](https://doi.org/10.18653/v1/2024.acl-long.585) · [arXiv](https://arxiv.org/abs/2401.00396)
* **[Inter-rater Agreement, 1960]** Cohen, J. *A Coefficient of Agreement for Nominal Scales.* *Educational and Psychological Measurement*, 20(1), 37–46. 标注员名义类别一致性统计方法。 [DOI](https://doi.org/10.1177/001316446002000104)
