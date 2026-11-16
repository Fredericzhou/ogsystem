# OGSystem 学术与工程实践论文专区 (Paper & Publications Hub)

本目录为 **OGSystem** 的论文全套成果文稿、可溯源文献数据库与独立研究者发表指南。

---

## 目录文件索引 (Files Navigation)

| 文件名 | 类型 / 定位 | 适用目标 |
| :--- | :--- | :--- |
| **[`ogsystem-paper-zh.md`](ogsystem-paper-zh.md)** | **中文版工程实践论文** (完整文稿) | 面向中国大陆计算机学报、核心期刊（如《计算机系统应用》《计算机工程与设计》《计算机集成制造系统》）或大模型软件工程专刊。 |
| **[`ogsystem-paper-en.md`](ogsystem-paper-en.md)** | **英文版工程实践论文** (完整文稿) | 面向国际顶级软件工程期刊（如 Elsevier *SoftwareX*, IEEE *Software*）或顶会工程轨（*ICSE/FSE/ASE Tool Track*）。 |
| **[`multi-agent-collaboration-models-and-tech-stacks.md`](multi-agent-collaboration-models-and-tech-stacks.md)** | **多智能体编排与协作模型专题调研报告** (深度对照) | 深度解构 9 种编排范式、通信工具、底层技术栈（Herdr, Orca, OMP, Codex v2, Claude Code 等）及数学超集证明，**方便快速参考与横向对照**。 |
| **[`traceable-references.md`](traceable-references.md)** | **可溯源文献与标准数据库** | 包含 2015–2016 分布式状态机奠基、形式化理论、2024–2026 MAS 前沿以及 2026 中国智能体国家标准的全部可查官方网址、DOI 与代码库。 |

---

## 核心立论体系概览

```text
【理论基座 (2015-2016)】                          【时代挑战与前沿路线 (2024-2026)】
AWS Step Functions (声明式状态机)                 Anthropic: "确定性工作流优于自主Swarm"
Uber Cadence / Temporal (持久化执行)   ───反思融合──>   OpenAI Codex v2: 密文交接争议 / 树状派生缺乏对等制衡
Sam Newman (中心编排 vs 自由编舞)                  Google Opal: SaaS 办公流水线 / 超长上下文注意力稀释
                                                  Orca: Git Worktree 终端总线 / 缺乏应用层契约与状态机
                                                  Herdr: 终端多路复用与跨窗格委派 / 缺乏业务状态代数
                                                  OMP: 角色感知模型分流 / 缺乏持久化 WAL 与责任席位
                                                  DAG 流水线 (n8n/Dify/Coze): 严禁回环的退化子集
                                                          │
                                                          ▼
                                            【OGSystem 核心创新突破】
                                   1. 责任席位优先 (Role-First 抽象六元组)
                                   2. 标记转移系统 (LTS 离散业务事件字典)
                                   3. 扩展有限状态机 (EFSM 持久化全要素状态)
                                   4. 源状态感知汇聚 (State-Aware Join 代数)
                                   5. 有界循环预算 (Bounded Loop Review)
                                   6. 双路径交付 (Artifact Promotion + Git Worktree Merge)
                                   7. 工具能力投影 (Role Contract + Backend Policy)
                                   8. 2026 智能体国家标准 (GB/Z 185/242 落地)
```

## 2026-11-15 工程增补与证据边界

> **文档边界：** 本论文和研究材料描述当前 Contract Set v1 的实现证据与行业对照，或明确
> 标注为目标架构；其中的 `allowedToolsByRoleId`、`constraints.allowedTools` 和
> `workspace.*` 三层能力描述不是 Contract Set v2 的规范输入，也不应被当作 v2 Studio 设计。

当前实现把协作交付明确分成两条路径：文档和普通文件经过 per-Run staging、路径/符号链接/配额/SHA-256 校验、单一 sealed bundle 和 Promotion；并行源码从固定 `baseCommit` 进入独立 Git worktree，Role commit 记录 provenance，由 Join 在独立 merge worktree 中按确定顺序合并，最终只选择每条 lineage 的最新成功 leaf。冲突只进入 Run evidence，不向业务目录写入编号冲突文件。

工具访问由 Semantic IR 的 `allowedToolsByRoleId`、Role Contract 的 `constraints.allowedTools` 和 backend workspace capability policy 三层约束。`workspace.write`、`workspace.patch_text`、`workspace.run` 分别显式授权；缺少 policy 的旧 adapter 仍是兼容放行路径，不能表述为完整 fail-closed 门禁。

真实模型证据来自 2026-11-15 的 Python 计算器团队：同一 `gpt-6-luna` 配置连续 3 次完成 `dispatch -> implementation/tests -> join`、4 个 Role commit、Join/final merge、fast-forward publish 和 8 项 unittest。该样本证明端到端可用性，不证明跨模型或长期稳定性；并行同路径冲突、并行 artifact 互斥和 whitespace 拒绝也已作为边界证据记录。确定性 `local_shell` 回归测试与真实模型运行在论文中分开统计。最近一次全量 `pnpm test` 共发现 819 项测试，818 项通过，1 项按 Windows 环境跳过。

当前限制包括：没有 AI resolver；项目级 promotion lock/CAS、外部发布补偿和自动构建/测试质量门禁由调用方负责；Git capability probe 已拒绝 tracked submodule、LFS attributes 和 sparse checkout，Graph Runner 会在显式启用 Git 协作时调用 probe，底层直接调用者仍需自行调用。

---

## 多智能体（Multi-Agent）主流协作模型、特点与底层技术栈全景

本论文体系将当前工业界与开源界的多智能体系统深度解构为九大形式化范式：

| 范式编号与名称 | 代表系统 / 产品 | 核心协作模型 (Collaboration Model) | 关键核心特点 (Key Characteristics) | 底层技术栈与通信协议 (Tech Stack & Protocols) |
| :--- | :--- | :--- | :--- | :--- |
| **1. 前向数据流图 (DAG)** | n8n, Dify, Coze Workflow, Google Opal | **有向无环偏序管道**：前置节点数据满足即单次激发 | 严格禁止有向回边；循环退化为节点内黑盒或离线展开；数据无防御累加 | TypeScript/Python, Celery/Redis, PostgreSQL, Canvas 连线引擎 |
| **2. 分层树状派生 (Tree-Forking)** | Anthropic Claude Code, OpenAI Codex v2 | **主从调用树 (Master-Worker)**：主控动态派生子 Agent 并收敛摘要 | 支配式分工，子代理无法对等否决；Codex v2 引入密文委托破坏可审计性 | Node.js/Rust/Python CLI, JSON-RPC / MCP 工具协议, 子进程沙箱 |
| **3. 动态交接编舞 (Choreography)** | OpenAI Swarm, AutoGen, ChatDev | **点对点动态交接 (P2P Handoffs)**：无中心即兴自主编舞 | 智能体即函数对象；无全局状态持久化，极易陷入对话发散与死循环 | Pure Python, OpenAI Function Calling, 内存事件循环 |
| **4. 终端多路复用底座 (Mux Harness)** | Herdr (`herdr.dev`, `herdr-core`) | **窗格多路复用与跨窗格委派** ("tmux for Agents") | 后台守护服务管理 Panes/Tabs；`hc send/wait/read` 跨窗格注入；ANSI 状态感知 | 高性能 Rust, Unix Domain Socket, OpenRPC 规范, ANSI OSC 7501 扩展 |
| **5. 终端工作树总线 (Fleet Bus)** | Orca (`onorca.dev`, `stablyai/orca`) | **Git 物理隔离终端总线**：每任务独占 Worktree 与终端 | 从文件系统层面物理杜绝并发脏写；基于 CLI 终端管道交互驱动 | Node.js/CLI, Git Worktree 引擎, stdio 管道重定向, Playwright 浏览器 |
| **6. 角色模型分流 (Dispatcher)** | OMP (`omp.sh`, `can1357/oh-my-pi`) | **算力标签模型路由与伴生守护者** | 将角色映射为模型调度策略 (`plan/slow/advisor`)；内置 P0–P3 缺陷专用评审 | 高性能 Rust, Hashline 行哈希紧凑编辑, Tree-sitter, 内置 LSP/DAP |
| **7. 消息池黑板 (Blackboard)** | MetaGPT, OpenHands | **标准 SOP 驱动的异步发布-订阅黑板** | 围绕规范将结构化动作与产物发布至消息池；下游按需拉取；拓扑较固化 | Python 异步运行时, Docker 容器沙箱, Pydantic Schema, 事件队列 |
| **8. 命令式状态图 (StateGraph)** | LangGraph + LangSmith | **编程式有向循环状态图与条件跳转边** | 允许任意有向回边；通过开放共享状态字典传参；侧重链路可观测与追踪 | Python/TS, LangSmith 链路控制塔, PostgreSQL/Redis/SQLite Checkpoints |
| **9. 责任席位状态机 (EFSM/LTS)** | **OGSystem (本系统)** | **闭合有向图责任席位扩展状态机** ($DAG \subset EFSM$) | 席位与执行器解耦；离散业务事件字典驱动；Fail-Closed 上下文投影；有界循环预算；Artifact 与 Git Worktree 双路径交付；独立沙箱跑测与产物原子晋升 | **TypeScript/Node.js, Semantic IR 编译器, 追加 WAL (`events.ndjson`), CAS 提交 (`state.json`), Verifier, Git provenance/Join merge** |

### 拓扑结构原型与形式化对照速查 (Topological Archetypes Summary)

```text
[1. DAG 流水线]            [2. 分层树状派生]             [3. 动态网状编舞]
  A ──► B ──► C ──► End          Master Coordinator            Agent A ◄────► Agent B
        │       ▲                │                │               ▲  \        /  ▲
        └── D ──┘          Child Sub 1      Child Sub 2           │   ▼      ▼   │
  (严禁有向回边)            (支配式分工，无对等否决)              Agent C ◄────► Agent D
                                                             (自由跳转，极易死锁)

[4. 平铺总线/窗格阵列]                         [5. 责任席位闭合有向图 (OGSystem)]
  Daemon / IPC Bus                                席位 V1 (Architect)
  ══╦════════╦════════╦════════╦══                       │ APPROVED (LTS 业务事件)
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
                                        │ NEEDS_REWORK (有界拓扑回边)      │ APPROVED
                                        ▼                                 ▼
                                 [Loop Budget]                     [Deliverable]
                                 iter <= maxIter ? 回跳 : CAS 挂起
```

### 工业界同质化沉疴与 OGSystem 八大非同质化创新突破 (Non-Homogenized Breakthroughs)

| 核心维度 | 行业主流同质化模式 (Homogenized Patterns) | OGSystem 非同质化突破 (Non-Homogenized Breakthroughs) |
| :--- | :--- | :--- |
| **1. 节点本体** | **智能体 = 模型 + 提示词 + 内存**（换模型即换身份，无固定职责边界） | **责任席位优先 (Role-First Seat) 本体**：席位是不可变组织资产，模型仅是动态绑定的无状态劳动力。 |
| **2. 控制代数** | **自然语言即兴交接或随意字符串**（`handoff_to("tester")` 易漂移、礼貌推诿） | **标记转移系统 (LTS) 离散业务事件代数**（$\Sigma_{\text{fixed}}$ 离散封闭字典，模型无权发明事件）。 |
| **3. 数据安全** | **全局上下文无序堆叠透传**（造成注意力稀释 Attention Dilution 与提示词越权） | **Fail-Closed 字段级 Context Map 显式投影**（未声明字段物理阻断，最小特权安全闭锁）。 |
| **4. 并发汇聚** | **无状态计数器屏障 (`Promise.all`)**（分支异常易致死锁或静默吞掉错误） | **四值源状态感知 Join 代数**（$S_{\text{src}} \in \{pending, arrived, skipped, failed\}$，严禁静默降级为 skipped）。 |
| **5. 循环博弈** | **无界递归死循环或 DAG 禁止回环**（While 循环烧尽 Token，审批缺乏状态绑定） | **血缘绑定有界配额与 CAS 五元组凭证**（配额超额挂起，绑定 $\langle reviewId, round, lineageId, branchId, stateVersion \rangle$；容灾配额补偿）。 |
| **6. 产物交付** | **主代码库就地脏写覆写**（测试失败或中断后严重污染代码库） | **三段式不透明产物原子晋升管道**（`Opaque ArtifactRef` $\to$ 独立沙箱跑测验证 $\to$ 封存清单原子晋升）。 |
| **7. 社会技术分权**| **单体画布混杂或纯 Python 代码**（模板与实例混淆，或缺乏可视化合规审计） | **双工作台分权解耦**（OGS Studio 架构设计/编译仿真 vs. OGS Projects 业务交付/运行归档）。 |
| **8. 崩溃一致性** | **粗粒度会话序列化或重头重放**（重发历史 Prompt 成本高且输出发散） | **WAL + CAS + SHA-256 语义指纹校验**（追加预写事实 + 原子快照提交 + 拓扑防篡改，毫秒级幂等恢复）。 |

### 理论原则与国家标准严格对应索引 (Standards Mapping Index)

所有结论与设计原则均严格对齐权威文献与国家标准（详见 [`traceable-references.md`](traceable-references.md) 与 [`multi-agent-collaboration-models-and-tech-stacks.md`](multi-agent-collaboration-models-and-tech-stacks.md)）：
* **原则 1（责任席位抽象六元组）：** 遵循 Milner 1989 (LTS) 与 Meyer 1992 (DbC)，对标 **GB/Z 185.1—2026** 第 5.2 条与 **GB/Z 185.4—2026**。
* **原则 2（离散标记业务事件转移）：** 遵循 Milner 1989 与 Newman 2015，对标 **GB/Z 185.6—2026** 第 6.3 条。
* **原则 3（全要素状态元组持久化）：** 遵循 Cheng & Krishnakumar 1993 (EFSM) 与 Gray 1992 (WAL)，对标 **GB/Z 242—2026** 第 6.4 条与 **GB/Z 185.1—2026** 第 7.1 条。
* **原则 4（有界循环配额与 CAS 断点）：** 遵循 Alshiekh 2024 (Runtime Shielding) 与 Lee & Yannakakis 1996，对标 **GB/Z 242—2026** 第 5.3 条与 **GB/Z 185.6—2026** 第 8.2 条。
* **原则 5（源状态感知汇聚作用域）：** 遵循 van der Aalst 2003 (Workflow Patterns)，对标 **GB/Z 185.1—2026** 第 6.4 条。
* **原则 6（Fail-Closed 字段投影）：** 遵循 Saltzer & Schroeder 1975 (Fail-safe Defaults)，对标 **GB/Z 185.7—2026** 第 7.2 条。
* **原则 7（沙箱独立跑测与产物晋升）：** 遵循 SWE-agent NeurIPS 2024 与 SWE-bench，对标 **GB/Z 242—2026** 第 7.1 条。
* **原则 8（宪法级明文防黑盒审计）：** 遵循 WAL 事务一致性与 Open Design 公理，对标 **GB/Z 185.3—2026** 第 8 条。

---

## 独立研究者 (Independent Researcher) 投稿行动路径

对于无高校或大型科研院所背书的个人作者，推荐采用“**预印本锁定优先权 $\to$ 权威开源软件顶刊发表**”的最佳路径：

```text
┌────────────────────────────────────────────────────────┐
│ 步骤 1: 注册个人终身学术 ID (ORCID)                     │
│         - 免费注册: https://orcid.org                  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 步骤 2: 提交预印本 (Preprint) 锁定全球原创时间戳        │
│         - 推荐平台: IEEE 官方 TechRxiv (techrxiv.org)  │
│         - 优势: 个人零门槛、免背书推荐、自动分配永久 DOI │
└───────────────────────────┬────────────────────────────┘
                            │
         ┌──────────────────┴──────────────────┐
         ▼                                     ▼
【方案 A: 国际高水平 SCI (推荐)】     【方案 B: 顶会工业演示轨 (高曝光)】
  Elsevier SoftwareX (SCIE Q2)          ICSE / FSE / ASE (Tool Track)
  - 篇幅约 6~7 页，专收开源软件系统      - 4~5 页短文 + 3分钟 Demo 视频
  - 零版面费 (选择传统订阅模式)         - 与全球顶尖学者同台展示系统
  - 审稿人极其看重代码与复现能力
```

---

## 关联研发与语义规范文档
*   [OGSystem v2 宪法与硬规则](../development/ogsystem-constitution-v2.md)
*   [扩展状态机与社会化协作形式化模型](../development/extended-state-machine-and-dag-bilingual.md)
*   [主流多智能体框架对比分析](../development/framework-comparison.md)
*   [2026 国家智能体标准覆盖评估报告（历史 v1）](../development/archive/v1/ai-agent-standards-coverage-2026.md)
*   [文本产物与代码执行架构方案（历史 v1）](../development/archive/v1/text-artifact-business-delivery-architecture.md)
