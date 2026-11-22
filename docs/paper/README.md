# OGSystem 学术与工程实践论文专区 (Paper & Publications Hub)

本目录为 **OGSystem** 的多角色 AI 协作论文、工程证据、可溯源文献与实验方案。其应用范围包括办公及其他文件型项目协作；软件开发是其中一种应用和已有运行验证场景。

---

## 目录文件索引 (Files Navigation)

| 文件名 | 类型 / 定位 | 适用目标 |
| :--- | :--- | :--- |
| **[`ogsystem-paper-zh.md`](ogsystem-paper-zh.md)** | **中文版工程实践论文** (完整文稿) | 面向多角色 AI 协作、智能体运行时治理与协同工作流相关期刊或会议。 |
| **[`ogsystem-paper-en.md`](ogsystem-paper-en.md)** | **英文版工程实践论文** (完整文稿) | 面向多智能体系统、AI 协作治理与可信工作流相关期刊或会议。 |
| **[`ogsystem-submission-paper-en.md`](ogsystem-submission-paper-en.md)** | **英文投稿稿（V2）** | 按 RQ 组织的系统设计与工程验证论文；含先行工作归属、四层架构、共享 Workspace/Join/Release 状态、证据边界和研究限制。 |
| **[`experimental-validation-plan-bilingual.md`](experimental-validation-plan-bilingual.md)** | **中英双语实验设计** | 预注册导向的单 Agent / 通用多 Agent / OGS V2 对照方案；定义交付成功、Evidence 支持陈述、幻觉测量边界、故障恢复、样本量规划、统计方法和论文直达地址。 |
| **[`multi-agent-collaboration-models-and-tech-stacks.md`](multi-agent-collaboration-models-and-tech-stacks.md)** | **多智能体编排与协作模型专题调研报告** (深度对照) | 深度解构 9 种编排范式、通信工具、底层技术栈（Herdr, Orca, OMP, Codex v2, Claude Code 等）及 EFSM/DAG 模型包含关系，**方便快速参考与横向对照**。 |
| **[`traceable-references.md`](traceable-references.md)** | **可溯源文献与标准研究线索** | 包含经典理论与 2024–2026 MAS 研究的 DOI、代码库、公开地址，以及待官方核验的 GB/Z 候选条目。 |

---

## 理论基础、公开能力与候选贡献边界

```text
【公开理论与工程能力】                    【OGS 工程实现】
LTS / EFSM / Workflow Patterns             四层产品责任划分
WAL / durable execution / Git / CAS        LangGraph 图执行引擎
最小特权 / provenance / attestation       Harness / Backend / Model 绑定
LangGraph / 多角色 Agent / Git Worktree   V2 单 Project Workspace 状态协议
                    │                     Role Worktree / WorkspaceRef / Evidence
                    │                     Join / CAS / Release Materialization
                    └─────────┬───────────┘
                              ▼
              【候选系统集成贡献】
       语义合同边界 + 单一 Workspace 状态模型
       + 四值源状态及声明式异常策略的 Join/Release 协议

尚未排除 OpenHands、Orca 与持久化工作流系统中的同类组合；学术新颖性仍需更广泛检索和同条件比较。
四层架构、适配器接线与验证结果属于工程实现证据，不单独构成学术创新主张。
```

## 2026-11-19 V2 工程增补与证据边界

> **文档边界：** 本论文和研究材料以 Contract Set v2 为当前架构基线。四层产品架构是
> Business、Technical Binding、Execution、Evidence；Studio、Team Site、CLI 是跨层产品投影，
> 不是第五层。Workspace 字段、状态、事件、来源和 API 以 V2 Workspace Contracts 为唯一规范来源。

V2 将每个 Project 绑定到一个 Git + LFS Workspace。Role 从固定 `baseCommit` 进入独立
worktree，Framework 创建并记录 Role commit，Join 在独立 merge worktree 中按候选集合和血缘
确定性合并；canonical ref 的更新必须经过 canonical lock 与 expected-head CAS。冲突进入
`join_conflict` 和 Run evidence，canonical Workspace 保持不变。

跨 Role 文件交接使用只读 `WorkspaceRef`（Workspace ID、完整 commit、仓库相对路径和 digest），
默认不投影，必须由显式 HandoffProjection 授权。Checkpoint、commit provenance、Evidence
manifest 和 Release record 形成双向审计链；Release 从 `releaseCommit` 生成 Materialization
manifest 和 output digest，只有 published Release 暴露 download reference。

真实模型证据包括 2026-11-15 与 2026-11-16 的 Python 计算器团队运行（基于 `gpt-6-luna`，仓库证据分别记录了 8 项 unittest 通过与 10 项测试通过的端到端 `dispatch -> implementation/tests -> join`、Role commit、Join/final merge 与 fast-forward publish）。该样本证明端到端可用性，不证明跨模型或长期稳定性；并行同路径冲突、陈旧 canonical head 的 CAS 拒绝和 whitespace 拒绝也已作为边界证据记录。确定性 `local_shell` 回归测试与真实模型运行在论文中分开统计。当前仓库最新全量 `pnpm test` 共发现 587 项测试（核心套件 486 项通过、1 项按 Windows 环境跳过，Team Site 100 项通过，0 失败；早期文档中的 819 项为将旧版 v1 测试移入 `tests/archive/v1/` 之前的历史计数）。

当前限制包括：没有 AI resolver；外部系统的发布补偿、自动质量门禁和跨系统事务仍由调用方负责。
Framework 管理 canonical ref、Worktree、Git LFS、锁、checkpoint、merge、restore 和 Release；
Role 不能直接 commit、push、update-ref、操作 LFS 锁或修改 checkpoint。

---

## 多智能体（Multi-Agent）主流协作模型、特点与底层技术栈全景

本论文体系将当前工业界与开源界的多智能体系统深度解构为九大形式化范式：

| 范式编号与名称 | 代表系统 / 产品 | 核心协作模型 (Collaboration Model) | 关键核心特点 (Key Characteristics) | 底层技术栈与通信协议 (Tech Stack & Protocols) |
| :--- | :--- | :--- | :--- | :--- |
| **1. 前向数据流图 (DAG)** | n8n, Dify, Coze Workflow, Google Opal | **有向无环依赖模型**；产品级循环、条件路由、持久化和数据传递取决于具体控制结构 | 本文仅将 DAG 本身定义为无环，不据此推断产品整体禁止循环或缺少状态治理 | 各产品技术栈依公开文档和具体部署而异 |
| **2. 分层树状派生 (Tree-Forking)** | Anthropic Claude Code, OpenAI Codex v2 | **父子任务委派**：派发子任务并收集结果 | 上下文暴露、权限和控制边界依产品与配置而异 | 依具体产品公开的 CLI、工具接口和运行能力 |
| **3. 动态交接编舞 (Choreography)** | OpenAI Swarm, AutoGen, ChatDev | **点对点交接或群聊调度**：在 Agent 之间传递控制 | 持久化、终止和状态约束依具体框架及部署方式而异 | 依具体项目的语言、工具接口和调度机制而异 |
| **4. 终端多路复用底座 (Mux Harness)** | Herdr (`herdr.dev`, `herdr-core`) | **窗格多路复用与跨窗格委派** ("tmux for Agents") | 后台守护服务管理 Panes/Tabs；`hc send/wait/read` 跨窗格注入；ANSI 状态感知 | 高性能 Rust, Unix Domain Socket, OpenRPC 规范, ANSI OSC 7501 扩展 |
| **5. 终端工作树总线 (Fleet Bus)** | Orca (`onorca.dev`, `stablyai/orca`) | **Git Worktree 与终端会话隔离任务执行** | 隔离工作目录可减少共享工作树写入干扰，但不消除提交合并冲突；此处只归纳公开产品资料 | 按项目公开文档和具体版本记录，不推断未公开组件 |
| **6. 角色模型分流 (Dispatcher)** | OMP (`omp.sh`, `can1357/oh-my-pi`) | **算力标签模型路由与伴生守护者** | 将角色映射为模型调度策略 (`plan/slow/advisor`)；内置 P0–P3 缺陷专用评审 | Rust 核心 + TypeScript/Bun CLI, Hashline 行哈希紧凑编辑, Tree-sitter, 内置 LSP/DAP |
| **7. 消息与共享状态协作** | MetaGPT, OpenHands | **项目各自定义角色、消息、事件或共享工作区机制** | 两个项目不是同一种黑板实现；其状态/执行细节应分别按论文和版本文档核对 | 依具体项目公开资料而异 |
| **8. 命令式状态图 (StateGraph)** | LangGraph；LangSmith（独立追踪产品） | **LangGraph 提供节点、边、条件路由、循环与 checkpoint 等执行能力** | 应用状态结构和失败策略由应用与配置决定；不概括为任意回边或统一共享状态字典 | LangGraph / LangSmith 的技术栈和 checkpoint 后端依具体配置而异 |
| **9. 责任席位状态机 (EFSM/LTS)** | **OGSystem (本系统)** | **闭合有向图责任席位扩展状态机** ($DAG \subset EFSM$) | 席位与执行器解耦；离散业务事件驱动；Fail-Closed 上下文投影；有界循环预算；四层产品架构；Git+LFS Workspace、checkpoint、canonical lock/CAS、Evidence 与 Release Materialization | **TypeScript/Node.js, Semantic IR, WAL (`events.ndjson`), CAS (`state.json`), Git/LFS provenance, Worktree/Join, Workspace 与 Release verifier** |

### 拓扑结构原型与形式化对照速查 (Topological Archetypes Summary)

```text
[1. DAG 流水线]            [2. 分层树状派生]             [3. 动态网状编舞]
  A ──► B ──► C ──► End          Master Coordinator            Agent A ◄────► Agent B
        │       ▲                │                │               ▲  \        /  ▲
        └── D ──┘          Child Sub 1      Child Sub 2           │   ▼      ▼   │
  (DAG 模型无环)            (父子委派)                            Agent C ◄────► Agent D
                                                             (点对点交接)

[4. 平铺总线/窗格阵列]                         [5. 责任席位闭合有向图 (OGSystem)]
  Daemon / IPC Bus                                Role A (Architect)
  ══╦════════╦════════╦════════╦══                       │ APPROVED (LTS 业务事件)
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
                                        │ NEEDS_REWORK (有界拓扑回边)      │ APPROVED
                                        ▼                                 ▼
                                 [Loop Budget]                     [Release]
                                 iter <= maxIter ? 回跳 : CAS 挂起
```

### 工业界同质化模式与 OGS 设计/新颖性边界

本目录把先行技术与 OGS 的工程集成分开归属：LangGraph 提供当前已验证的图执行能力，LTS/EFSM、Git、WAL/CAS、最小特权和多角色 Agent 均有公开先例。候选集成包括责任合同、事件路由、数据投影和 Workspace/Release 状态协议；OpenHands、Orca 与持久化工作流系统尚未完成同条件协议比较，故不主张首创或相对优势。Codex -> OpenCode 运行中 Implementer 未产生文件改动，不能证明下游实际消费 `WorkspaceRef`；该运行也没有证明跨模型泛化、双向后端互操作或图执行引擎替换。详细归属、研究问题和证据边界见中英文论文第 3.0–3.1 节。

| 核心维度 | 行业主流同质化模式 (Homogenized Patterns) | OGS 设计画像与新颖性边界 |
| :--- | :--- | :--- |
| **1. 节点本体** | 各系统以不同方式表示 Agent、Role、会话和执行器。 | **责任席位优先 (Role-First Seat)**：OGS 将稳定 Role Contract 与运行时 Backend/模型绑定分别建模；角色化协作本身已有先例。 |
| **2. 控制代数** | 不同系统采用自然语言交接、工具调用或显式路由等机制。 | **标记转移系统 (LTS) 离散业务事件代数**（$\Sigma_{\text{fixed}}$ 离散封闭字典，未声明事件不能驱动转移）。 |
| **3. 数据安全** | 不同系统采用不同上下文传递和授权策略；本文不将其归为单一行业模式。 | **Fail-Closed 字段级 Context Map**（按声明投影跨 Role 字段和只读文件引用；安全效果尚未作对照测量）。 |
| **4. 并发汇聚** | 通用 Join 与同步模式已有工作流理论和框架实现；失败处理取决于具体实现。 | **四值源状态跟踪**（OGS 不将 `failed` 静默改写为 `skipped`）。 |
| **5. 循环博弈** | 循环和回退行为取决于工作流模型及具体运行时实现。 | **血缘绑定有界配额与 CAS 决策凭证**（配额耗尽进入审核路径，决策绑定 Run、血缘和状态版本）。 |
| **6. 交付边界** | Agent 工具对工作区的修改边界依产品和权限配置而异；本文未作逐产品比较。 | **WorkspaceRef + Release Materialization**（Git/LFS commit 溯源、内容验证、Materialization manifest 与 output digest）。 |
| **7. 社会技术分权**| 不同产品以各自方式组织设计、配置、执行和审计界面；本文不作统一优劣判断。 | **四层产品架构**（Business / Technical Binding / Execution / Evidence；Studio、Team Site、CLI 为跨层投影）。 |
| **8. 崩溃一致性** | **不同的会话恢复策略**（恢复行为随框架和持久化配置而异） | **WAL + CAS + SHA-256 语义指纹校验**（恢复时检查计划指纹；故障注入测试覆盖指定崩溃窗口）。 |

### 标准主题候选线索（条款全文待核验）

下列 2026 年中国国家标准化指导性技术文件（`GB/Z 185.1~185.7—2026`、`GB/Z 242—2026`）的标准编号与题名已公开发布核实，但**本目录尚未核验标准全文具体条款**，因此下列主题关联仅作研究线索，不构成权威条款映射、标准符合性或性能优越性证明：
* **原则 1（责任席位抽象六元组）：** 遵循 Milner 1989 (LTS) 与 Meyer 1992 (DbC)，主题关联 **GB/Z 185.1—2026**（总体架构）与 **GB/Z 185.4—2026**（智能体描述）（条款待核验）。
* **原则 2（离散标记业务事件转移）：** 遵循 Milner 1989 与 Newman 2015，主题关联 **GB/Z 185.6—2026**（智能体交互）（条款待核验）。
* **原则 3（全要素状态元组持久化）：** 遵循 Cheng & Krishnakumar 1993 (EFSM) 与 Gray 1992 (WAL)，主题关联 **GB/Z 242—2026**（智能体技术要求）与 **GB/Z 185.1—2026**（条款待核验）。
* **原则 4（有界循环配额与 CAS 断点）：** 遵循 Alshiekh et al. 2018 (AAAI, Runtime Shielding) 与 Lee & Yannakakis 1996，主题关联 **GB/Z 242—2026** 与 **GB/Z 185.6—2026**（条款待核验）。
* **原则 5（源状态感知汇聚作用域）：** 遵循 van der Aalst 2003 (Workflow Patterns)，主题关联 **GB/Z 185.1—2026**（条款待核验）。
* **原则 6（Fail-Closed 字段投影）：** 遵循 Saltzer & Schroeder 1975 (Fail-safe Defaults)，主题关联 **GB/Z 185.7—2026**（智能体工具调用）（条款待核验）。
* **原则 7（Workspace 内容验证与 Release Materialization）：** 遵循 SWE-agent NeurIPS 2024 与 SWE-bench，主题关联 **GB/Z 242—2026**（条款待核验）。
* **原则 8（运行事件记录）：** 采用 WAL 记录运行事件并关联审核状态；支持系统内审计追踪，不表示日志存储防篡改或具备形式化因果证明。GB/Z 185.3 为身份管理部分，不据此建立审计标准映射。

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
  Elsevier SoftwareX (SCIE)             ICSE / FSE / ASE (Tool Track)
  - 篇幅约 6~7 页，专收开源软件系统      - 4~5 页短文 + 3分钟 Demo 视频
  - 纯 Gold OA，标准 APC 约 $1,200 USD  - 与全球顶尖学者同台展示系统
    (无免费传统订阅模式；机构协议或 Research4Life 可减免)
  - 审稿人极其看重代码与复现能力
```

---

## 关联研发与语义规范文档
*   [OGSystem v2 宪法与硬规则](../development/ogsystem-constitution-v2.md)
*   [V2 Workspace 合同](../development/v2-workspace-contracts.md)
*   [V2 Workspace 共享协作设计与验收](../development/v2-workspace-collaboration-design-and-acceptance.md)
*   [扩展状态机与社会化协作形式化模型](../development/extended-state-machine-and-dag-bilingual.md)
*   [主流多智能体框架对比分析](../development/framework-comparison.md)
*   [2026 国家智能体标准覆盖评估报告（历史 v1）](../development/archive/v1/ai-agent-standards-coverage-2026.md)
*   [文本产物与代码执行架构方案（历史 v1）](../development/archive/v1/text-artifact-business-delivery-architecture.md)
