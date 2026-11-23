# Contract-Based Runtime Governance for Multi-Role AI Collaboration: OGSystem V2 Design and Engineering Evidence

**Author:** Fred [Your Surname]  
**Affiliation:** Independent Researcher, [City], China  
**Contact:** [your-email@domain.com]  
**ORCID:** [https://orcid.org/0009-XXXX-XXXX-XXXX]  
**Repository & Benchmark Artifacts:** Anonymized replication package provided during peer review; permanent public repository and Zenodo archive DOI will be assigned upon formal publication (Open-source core runtime under Apache-2.0; enterprise application suite proprietary)

---

### Abstract
Multi-role AI collaboration can support software development, office documents, consulting analysis, and structured discussion. Regardless of whether the deliverable is source code or another file, the runtime must handle responsibility, authorization, concurrent changes, state consistency, recovery, and delivery. DAGs represent acyclic dependencies; workflows with rework edges require a graph runtime or another control structure that supports iteration. Workflow products differ in how they implement these capabilities.

This paper reports **OGSystem (OGS)**, a persistent EFSM runtime implementation for bounded multi-role collaboration projects. Its scope is not limited to software development: it targets office and broader file-based collaboration, with software development, management consulting, and structured debate among the scenarios represented in current engineering records. As a bounded management lens, it maps responsibility differentiation, delegated authority, coordination, and accountability to Role contracts, Harness policy, event/Join controls, and Evidence/Release records. This is an engineering mapping, not a complete organizational governance program; ultimate responsibility remains with the deploying organization and human decision-makers. OGS composes established state-machine, workflow, durable-execution, least-privilege, and Git version-control ideas into Role contracts, discrete business events, Context Maps, state-aware joins, and a shared Workspace/Release state protocol. Under Contract Set v2, each Project has one file-based Git + LFS Workspace for source code, documents, and other project files. Roles work from a fixed `baseCommit` in isolated Worktrees; commit snapshots and Framework-managed updates support content consistency, recovery, and rollback. The Framework manages canonical locking, expected-head CAS, read-only `WorkspaceRef` values, Evidence, and Release Materialization. Engineering evidence includes the current repository-wide suite of 596 automated tests (488 core passed, one Windows-specific skip, 107 Team Site passed, zero failed; the earlier 587 count reflected the 2026-11-19 checkpoint, while the historical 819 count predated archiving legacy v1 tests to `tests/archive/v1/`), recorded `gpt-6-luna` Python-calculator runs (8 unittest cases passed on 2026-11-15 and 10 tests passed on 2026-11-16), and Project Run/Release records for Codex-to-OpenCode, management-consulting, and structured-debate workflows. In one Codex-to-OpenCode run, the Implementer made no file changes; current records do not establish cross-model generalization, bidirectional interoperability, or graph-engine portability. The contribution claim is limited to the system-level composition of these semantics and protocols and their engineering implementation; cross-scenario governance effects and academic novelty remain unverified and require controlled evaluation and broader prior-art comparison.

**Keywords:** multi-role AI collaboration; AI runtime governance; responsibility contracts; delegated authority; EFSM; shared Workspace; state recovery; evidence-based release.

---

### 1. Introduction and Domain Evolution

#### 1.1 The Five Milestones of LLM Engineering
The trajectory of LLM-based Software Engineering has evolved through five distinct technological milestones aimed at taming probabilistic variance into deterministic systems:
1. **Prompt Engineering (2022–2023):** Focused on instructions, few-shot conditioning, and Chain-of-Thought (CoT) prompting. Multi-step behavior also depends on orchestration and runtime support.
2. **Context Engineering (2023 onward):** Added retrieval, context selection, and token-window management to agent systems. Context propagation strategies vary across systems; this paper does not assume that all multi-agent workflows forward uncurated context.
3. **Loop Engineering (2023–2024):** Introduced autonomous step-wise iteration via ReAct (Reason + Act) and Reflexion loops. While granting localized trial-and-error autonomy, unconstrained loops easily diverge into infinite token runaway and goal drift.
4. **Agent Harness Infrastructure (2024 onward):** Decoupled model reasoning from external execution in systems such as SWE-agent and tool-calling CLI harnesses. Some harnesses focus on single-agent execution; multi-role governance may be provided by an application or framework.
5. **Graph Engineering (2024–2026):** Multi-agent collaboration is increasingly expressed through explicit topologies. DAGs represent acyclic dependencies, while iterative review requires a loop construct or another control structure. Workflow products differ in their support for loops, shared state, and recovery; no single capability profile is assigned here to n8n, Dify, or Coze.

#### 1.2 Durable Workflow Systems as Engineering Precedents
Durable workflow systems provide an engineering precedent for current multi-agent runtimes. AWS Step Functions and Uber Cadence are industrial workflow references; Temporal continues the durable-execution line. State-machine theory, WAL, event histories, and crash recovery predate these products. This paper does not claim that the software industry followed one uniform migration from choreography to orchestration or that current multi-agent systems repeat an identical historical crisis.

#### 1.3 Trajectories and Controversies across Frontier Labs
Against this backdrop, the leading AI labs have diverged significantly in their agent orchestration philosophies:
1. **Anthropic (Claude) and workflow patterns:** Anthropic's *Building Effective Agents* guide describes composable workflow patterns such as Routing, Orchestrator-Workers, and Evaluator-Optimizer. OGS treats this as related design guidance; the guide is not a comparative evaluation of OGS or an EFSM implementation.
2. **OpenAI Swarm:** The 2024 Swarm project presented lightweight agent handoffs as an educational framework. OGS compares its own persistence, schema, join, and review contracts with that project scope; this comparison is not a claim about every OpenAI agent product or deployment.
3. **Long Context and Explicit State:** Long-context models do not remove the need to define durable business state, authorization, and artifact boundaries for a workflow. OGS uses explicit contracts and Context Maps; this paper does not claim that long-context systems are categorically inadequate or measure an attention-dilution reduction.
4. **Role Separation:** OGS assigns distinct responsibility seats to selected workflow stages. The value of a particular separation of duties depends on the application and requires task-specific evaluation.

#### 1.4 Positioning of OGSystem
Within this landscape, **OGSystem (OGS) is a persistent EFSM runtime implementation for bounded socio-technical collaboration**.
OGS combines established state-machine and workflow ideas with its Role contracts, event routing, Workspace state model, and delivery protocol. The paper treats DAG as a restricted model case under its definitions; this does not establish superiority over other graph runtimes or conformance to national standards.

#### 1.5 Organizational Management as a Lens for AI Runtime Governance

Classical organization theory is used here as a design lens, not as a claim that AI agents are employees or legal persons. Organization design distinguishes responsibility assignment from coordination mechanisms; agency theory examines delegation, information asymmetry, and monitoring costs (Mintzberg 1979; Eisenhardt 1989; see `traceable-references.md`). OGS applies these questions to bounded multi-role projects with explicit deliverables and acceptance criteria, including office documents, analysis reports, discussion outputs, and software artifacts: who owns a task, which actions are authorized, how work is coordinated, and how outputs are verified before release. The organization and its human operators retain ultimate accountability. Run Evidence is not, by itself, regulatory compliance or tamper-proof audit.

| Management concern | OGS V2 control | Long-term value hypothesis to test |
| --- | --- | --- |
| Differentiated responsibility | Business-layer Role Contracts separate responsibility from the execution backend | Responsibility and acceptance definitions may remain traceable across model or Harness changes; this requires longitudinal testing. |
| Delegation and authority | Technical Binding configures the Harness, `allowedTools`, and EnvironmentIntent; Runtime freezes the effective tool policy | Unauthorized tool/environment actions may be blocked before execution; test bypass and denial correctness. |
| Coordination and supervision | Business events, Context Maps, Join, Loop, and Review define handoff and decision points | Cross-Role state ambiguity and manual checking may decline; measure error rates and review effort. |
| Accountability and learning | Evidence, commit provenance, Workspace and Release states record each Run | Reviewers may reconstruct the responsible Role, input version, and release outcome; measure completeness, time, and drift after policy changes. |

This mapping is related to the Govern, Map, Measure, and Manage functions in the [NIST AI RMF 1.0](https://doi.org/10.6028/NIST.AI.100-1), with generative-AI context in the [NIST GenAI Profile](https://doi.org/10.6028/NIST.AI.600-1). OGS implements only selected runtime controls and evidence records for bounded workflows; it does not implement a complete organizational governance lifecycle or claim conformance. Recent autonomous-agent surveys (Wang et al. 2024; Xi et al. 2025) describe the expanding architecture, tooling, evaluation, and risk landscape, but do not substitute for controlled validation of OGS.

#### 1.6 Recent Research Comparators (2024–2026)

The following studies were checked against DOI, ACL Anthology, OpenReview, or arXiv metadata and are used as related-work comparators for OGS's four layers and shared collaboration state. OpenAlex citation counts indicate public index coverage only (retrieved 2026-11-19) and are not OGS evidence.

| Study | Primary focus | Comparator relationship to OGS |
| --- | --- | --- |
| SWE-agent (NeurIPS 2024) | Agent-computer interfaces, tool boundaries, software-engineering execution | Technical Binding / Execution comparator; OGS adds WorkspaceRef, canonical locking, and Release Materialization. |
| SWE-bench (ICLR 2024) | End-to-end repair evaluation on real GitHub issues | Evidence comparator; OGS binds verification to Run Evidence and commit provenance. |
| ChatDev (ACL 2024) | Role-based conversational software collaboration | Business / Role Contract comparator; OGS uses LTS events and explicit HandoffProjection. |
| OSWorld (NeurIPS 2024) | Multimodal tasks in real computer environments | Execution / Evidence comparator; OGS persists Workspace content separately from evidence. |
| MALLM, SWE-bench Goes Live, and CGM (2025) | Multi-agent frameworks, live evaluation, repository-level code graphs | Comparators for communication, dynamic verification, and Workspace content relations; OGS retains one Git/LFS content fact. |
| Wang et al. (2024) survey of autonomous LLM agents | Surveys agent architectures, memory, planning, tools, and evaluation | Used to broaden related-work coverage and calibrate the taxonomy; it does not establish novelty of OGS's specific Workspace/Release protocol. |
| Xi et al. (2025) survey of LLM-based agents | Surveys agent capabilities, architectures, and research directions | OpenAlex cited_by_count 3,314 (2026-11-19); used to position agent research, not as evidence that OGS governance works. |
| OpenHands (ICLR 2025; 2024 preprint) | Open platform and runtime for software-development agents | Directly relevant software-agent execution and workspace reference; this paper has not completed a matched, item-by-item comparison of WorkspaceRef, merge, Evidence, and Release protocols. |

---

### 2. Paradigm Taxonomy and Structural Survey of Collaborative Systems

To formally characterize multi-agent runtimes, this section investigates frontier proprietary platforms (OpenAI Codex Multi-Agent v2, Anthropic Claude Subagents, Google Opal, LangChain LangGraph/LangSmith), emerging generalist autonomous engines (Manus, Tencent WorkBuddy), specialized multi-agent collaborative coding tools (Orca, OMP / oh-my-pi, Aider), and classic workflow pipelines (n8n, Dify, Coze).

#### 2.1 Architectural Taxonomy of Multi-Agent Collaboration
The following categories are an analytical aid for organizing related work, not an exhaustive or mutually exclusive product taxonomy. External-system descriptions summarize capabilities confirmed in public documentation, papers, or code; capabilities may vary by version and configuration. A capability not confirmed in the cited material is not evidence that a product lacks it. These tables are not same-condition feature or performance evaluations.

1. **Forward Acyclic Dataflow DAG Pipeline (e.g., n8n, Dify, Coze Workflow, Google Opal)**
   *   *Collaboration Model:* Unidirectional dataflow pipeline governed by topological partial order; upstream completion triggers one-shot downstream activation.
   *   *Key Characteristics:* DAG models represent acyclic dependencies; loop, conditional routing, and persistence behavior depend on the product and its additional control structures.
   *   *Tech Stack:* Product-specific; no inference is made here about internal components that are not publicly documented.
2. **Hierarchical Tree-Forking and Subagent Delegation (e.g., Anthropic Claude Code, OpenAI Codex Multi-Agent v2)**
   *   *Collaboration Model:* Master-Worker tree invocation hierarchy; the parent agent retains full global context and dynamically forks ephemeral child subagents, collecting distilled text summaries upon completion.
   *   *Key Characteristics:* Tasks are delegated and results gathered through parent-child relations; context exposure, permissions, and control boundaries depend on the product and configuration.
   *   *Tech Stack:* Product-specific; public materials document CLI, tool interfaces, and subtask capabilities.
3. **Decentralized Handoffs Choreography (e.g., OpenAI Swarm, AutoGen GroupChat, ChatDev)**
   *   *Collaboration Model:* Uncoordinated autonomous choreography driven by point-to-point handoffs (`handoff(target)`) or dynamic LLM speaker selection.
   *   *Key Characteristics:* Control is transferred between agents through handoff or group-chat scheduling; persistence, termination, and state constraints depend on the framework and deployment.
   *   *Tech Stack:* Implementations and dependencies differ; Python, Function Calling, and in-memory event loops are not attributed as common to all projects in this category.
4. **Terminal Multiplexer and Cross-Pane Delegation Runtime (e.g., Herdr `herdr.dev`)**
   *   *Collaboration Model:* Operating-system-level multi-agent terminal multiplexing and cross-pane delegation runtime ("tmux for AI coding agents").
   *   *Key Characteristics:* Public materials describe pane management, cross-pane delegation primitives, and OSC 7501 status reporting.
   *   *Tech Stack:* High-performance Rust daemon (`herdr-core`), Unix Domain Sockets, OpenRPC interface schema, PTY/TTY terminal multiplexer drivers, and ANSI status extensions.
5. **Worktree-Isolated Terminal Fleet Bus (e.g., Orca `onorca.dev`)**
   *   *Collaboration Model:* File-bus and terminal fleet architecture physically isolated via Git worktrees.
   *   *Key Characteristics:* Uses worktree and terminal-session isolation for task workspaces. Worktree isolation reduces concurrent writes to one working directory but does not eliminate branch merge conflicts.
   *   *Tech Stack:* Node.js / TypeScript CLI, Git Worktree engine, OS stdio pipe redirection, and Playwright headless browser test harnesses.
6. **Role-Based Model Dispatcher with Companion Advisor (e.g., OMP / oh-my-pi `omp.sh`)**
   *   *Collaboration Model:* Compute-tagged model router with streaming background companion monitoring.
   *   *Key Characteristics:* Public materials describe role labels, model routing, subtask delegation, and review features in an agent CLI.
   *   *Tech Stack:* High-performance Rust, Hashline compact line-hash diffing engine, Tree-sitter incremental syntax parsing, and embedded LSP/DAP protocols.
7. **Pub-Sub Blackboard / Message Pool (e.g., MetaGPT, OpenHands)**
   *   *Collaboration Model:* Role-, message-, or shared-workspace-based collaboration; mechanisms differ across projects.
   *   *Key Characteristics:* The cited projects describe role workflows, message passing, or event-driven agent capabilities; they are not treated as one shared blackboard implementation.
   *   *Tech Stack:* Implementations and deployment options differ; Python, Docker, Pydantic, or event queues are not attributed as common dependencies.
8. **Imperative Cyclic StateGraph (e.g., LangChain LangGraph + LangSmith)**
   *   *Collaboration Model:* Programmatic directed cyclic state graphs with conditional edge dispatch.
   *   *Key Characteristics:* Provides graph execution capabilities such as nodes, edges, conditional routing, loops, and checkpoints; application-level state structure and contracts are developer-defined.
   *   *Tech Stack:* LangGraph provides graph execution and LangSmith is a separate tracing/evaluation product; checkpoint backends depend on configuration, so PostgreSQL, Redis, and SQLite are not treated as required dependencies.
9. **Role-First Persistent EFSM over LTS (e.g., OGSystem, Ours)**
   *   *Collaboration Model:* Closed Directed Graph ($DAG \subset EFSM$), decoupling invariant socio-technical Responsibility Seats ($V$) from transient model executors ($\rho$).
   *   *Key Characteristics:* Transitions driven by a closed LTS discrete business event dictionary ($\Sigma_{\text{fixed}}$); persistent full-element state tuple $\mathbf{X}$; Fail-Closed Context Map field-level projections; lineage-bound loop budgets with CAS human review pause; four product layers; Git + LFS Workspace collaboration and Release Materialization.
   *   *Tech Stack:* Compiled TypeScript / Node.js runtime, restricted Mermaid Semantic IR compiler, append-only Write-Ahead Log (`events.ndjson`), atomic snapshot commit (CAS `state.json`), Git/LFS Workspaces, canonical locks, Workspace and Release materialization verifiers.

#### 2.2 Structural Comparison Matrices
Tables 1 and 2 summarize capabilities described in selected public documentation and project sources reviewed on 2026-11-19. Slash-separated labels group separate products for compact presentation, not a single implementation; cells identify a product where the distinction matters. Product behavior depends on version, configuration, and deployment. These tables are not matched evaluations and do not infer that an unlisted capability is absent.

| Structural Dimension | **OpenAI Codex v2 / Swarm** | **Anthropic Subagents / Claude Code** | **Google Opal (Agent Mode)** | **LangGraph + LangSmith** | **Manus / Tencent WorkBuddy** | **OGSystem (This Work)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Node Primitive** | Codex: agent task/thread; Swarm: agent/function | Task subagent | Visual workflow/agent step | LangGraph: graph node; LangSmith: observability product | Product-specific agent/task abstractions | **Abstract Responsibility Seat ($V$)** |
| **2. Topology & Transition** | Codex: task delegation; Swarm: function handoffs | Subagent delegation and tool use | Workflow steps and branching | LangGraph nodes, edges, and conditional routing | Product-specific task orchestration | **LTS over a declared business-event vocabulary** |
| **3. State & Persistence** | Product-specific session and run state | Product-specific session and run state | Product-specific workflow state | Checkpoint and tracing capabilities are publicly documented | Product-specific run or environment state | **Persistent extended state with WAL/CAS and semantic checks** |
| **4. Data Boundaries** | Context and delegation controls vary by product/configuration | Context and delegation controls vary by product/configuration | Workspace and step context depend on product behavior | Application state schema and projections are developer-defined | Context and workspace controls vary by product/configuration | **Fail-closed Context Map projections declared by contract** |
| **5. Loop & Governance** | Delegation and control features vary by product/configuration | Delegation and control features vary by product/configuration | Workflow control features vary by product/configuration | Conditional routing and cycles are supported | Task control features vary by product/configuration | **Lineage-bound loop budget and version-bound review decision** |
| **6. Workspace Delivery** | Terminal edits / Git PR patch | Local file I/O / Terminal command execution | Generated Drive docs / Google Sheets | Raw streaming text / Custom sink writes | End-to-end web apps, slides, financial reports | **WorkspaceRef verification $\to$ Release Materialization manifest / output digest** |
| **7. Audit & Transparency** | Delegation metadata and logs vary by product and configuration | Public terminal and tool execution records | Product-specific execution records | LangSmith tracing and evaluation features | Product-specific session and execution records | **Append-only runtime event log (`events.ndjson`) & Evidence projections** |
| **8. Underlying Tech Stack** | Codex and Swarm are described separately from their public materials | Product-specific public materials | Product-specific public materials; internal components are not inferred | LangGraph and LangSmith are separate products; language and checkpoint backend depend on version/configuration | Product-specific public materials | **TypeScript/Node.js, Semantic IR, WAL/CAS, Git/LFS Workspace, verifiers** |
*Table 1: Structural Comparison of Global Frontier Multi-Agent Systems and OGSystem.*

For dedicated software engineering and collaborative code generation, Table 2 contrasts OGSystem with prevailing multi-agent coding engines:

| Structural Dimension | **Orca (StablyAI)** | **Herdr (HerdrDev)** | **OMP (oh-my-pi / omp)** | **Aider (Architect/Editor)** | **OGSystem (This Work)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Collaboration Model** | **Worktree-Isolated Terminal Fleet Bus** | **Terminal Multiplexer & Cross-Pane Delegation** | **Role-Based Model Dispatcher & Subagent Review** | **Paired Architect-Editor Ping-Pong** | **Role-First Persistent EFSM + Git/LFS Workspace** |
| **Execution Boundary** | Physical: Dedicated **Git Worktree**, terminal, and browser per agent | Window & Daemon: Persistent `herdr-core` daemon, multiple panes & tabs | Logical: In-process context slicing, local shell execution | Shared workspace: Main branch, in-memory prompt role handoffs | **One Project Workspace; Framework-managed Role Worktrees, canonical ref, lock, and CAS** |
| **Agent IPC Mechanism** | CLI command stream: `orca terminal send`, `orca terminal wait` | Cross-pane primitives: `hc run --bg`, `hc send`, `hc wait`, `hc read`, and OpenRPC socket | Memory dispatch: `task` subagents, streaming `advisor` listener | Prompt alternation: Architect outputs spec, Editor applies diff | **LTS Discrete Business Events** ($\Sigma_{\text{fixed}}$) & Typed Data |
| **Role Ontology** | Transient CLI execution processes / Terminal sessions | Subordinate agent processes hosted in terminal panes | **Model routing configuration tags** (`plan`/`slow`/`task`/`advisor`) | Static two-party prompt roles (Thinker vs. Doer) | **Formal Responsibility Seats $V$** (Decoupled from executors $\rho$) |
| **Context Boundary Control** | Product and configuration dependent | Product and configuration dependent | Product and configuration dependent | Product and configuration dependent | Contract-declared Context Map projections |
| **Loop & State Governance** | Public task/control features vary by configuration | Public task/control features vary by configuration | Runtime task controls are documented | Review and edit iterations are documented | Lineage-bound quota and version-bound review decision |
| **Workspace and Release Verification** | Worktree and Git collaboration features | Terminal and repository collaboration features | LSP and review features | Test command and Git features | WorkspaceRef verification, provenance, canonical lock/CAS, Release Materialization |
| **Crash Consistency** | Recovery behavior depends on product and configuration | Recovery behavior depends on product and configuration | Recovery behavior depends on product and configuration | Recovery behavior depends on product and configuration | WAL, CAS snapshots, and semantic fingerprint checks; specified crash windows are covered by fault-injection tests |
| **Underlying Tech Stack** | Node.js / CLI + Git Worktree + Headless Browser | Rust (`herdr-core`) + Unix Domain Socket + OpenRPC + ANSI OSC 7501 | High-performance Rust + Hashline diff engine + embedded LSP/DAP + Tree-sitter | Python + Tree-sitter AST repo-map + Git Diff engine | **TypeScript/Node.js + Semantic IR + WAL/CAS + Git/LFS Workspace + Verifiers** |

*Table 2: Deep Comparison of Collaborative Coding Software Architectures.*

#### 2.3 Structural Differentials and Comparative Analysis

##### (1) Topological Structure Comparison: Graph Theory, Visual Archetypes, and Confluence Algebras
Multi-agent runtimes are fundamentally **Graph-Theoretical Models**. Topology mathematically dictates authority distribution, concurrency, dialectical back-edges, and halting convergence:

```text
[1. Forward DAG Pipeline]     [2. Hierarchical Tree-Forking]      [3. Dynamic Mesh Choreography]
  A ──► B ──► C ──► End             Master Coordinator               Agent A ◄────► Agent B
        │       ▲                   │                │                  ▲  \        /  ▲
        └── D ──┘             Child Sub 1      Child Sub 2              │   ▼      ▼   │
  (Acyclic topology)          (Parent-child delegation)              Agent C ◄────► Agent D
                                                                     (Peer-to-peer handoffs)

[4. Flat Fleet Bus / Panes]                  [5. Role-First Closed Directed Graph (OGSystem)]
  Daemon / IPC Bus                                       Role A (Architect)
  ══╦════════╦════════╦════════╦══                              │ APPROVED (LTS Event)
    ▼        ▼        ▼        ▼                                ▼
  Pane 1   Pane 2   Pane 3   Pane 4                      ┌──────┴──────┐
  (No inner graph; OS scheduled)                         ▼             ▼
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
                                               │ NEEDS_REWORK (Bounded Back-Edge)│ APPROVED
                                               ▼                                 ▼
                                        [Loop Budget]                     [Release]
                                        iter <= maxIter ? Rewind : CAS Pause
```

*   **Forward DAG Pipeline:** Represents acyclic dependencies. Rework requires an additional loop construct, another control structure, or finite expansion; implementation details vary by product.
*   **Tree-Forking Topology ($Tree$ where $|E|=|V|-1$):** Parent-child task delegation with result aggregation is one common collaboration structure; authority and review policies depend on the application.
*   **Mesh Choreography:** Peer-to-peer handoffs can transfer control between agents; state, persistence, and termination behavior depend on framework and deployment.
*   **Flat Array / Bus / Panes ($1 \times N$):** Worktrees and terminal panes provide execution isolation or process multiplexing; coordination may be provided by the surrounding harness or application.
*   **Role-First Closed Directed Graph (OGSystem, $DAG \subset EFSM$):** Nodes represent invariant responsibility seats ($V$), transitions are governed by discrete LTS business events ($\Sigma_{\text{fixed}}$), bounded back-edges are constrained by quotas ($maxIterations$), and confluence is governed by **State-Aware Join Scopes** ($S_{\text{src}} \in \{pending, arrived, skipped, failed\}$).

##### (2) Collaborative Coding Software: Worktree Bus (Orca), Terminal Multiplexer (Herdr), and Model Dispatcher (OMP) vs. Role-First EFSM (OGSystem)
*   **Orca and Herdr:** Public references for worktree isolation, terminal delegation, and terminal multiplexing. This paper does not provide a uniform end-to-end evaluation of their business-state, authorization, or audit contracts.
*   **OMP:** A public reference for role labels, model routing, subtask delegation, and review features in an agent CLI. Role and join semantics differ by product; this paper does not infer that OMP lacks organizational use cases.
*   **OGSystem's Role-First EFSM:** OGS formalizes roles as invariant responsibility seats ($V$), decoupling accountability from model executors ($\rho$). Interactions are mediated by LTS event transitions, data transfer is governed by Fail-Closed Context Maps and read-only `WorkspaceRef` values, and Framework-managed Worktree, lock/CAS, checkpoint, and Release Materialization operations provide the auditable delivery boundary.

##### (3) Runtime Records and Audit Contracts
*   Agent Backends expose delegation metadata and interaction records according to product, version, and configuration; this paper does not generalize a particular setting to all products.
*   OGS records runtime events in `events.ndjson` and stores identifiers and state versions for review decisions. This supports audit tracing within OGS; it is not a claim of tamper-proof storage or formal causal proof.

##### (4) Context Boundaries: Context Map Projections
*   Multi-agent and workflow systems use different context storage and transfer strategies; this paper does not infer that product categories uniformly forward full context.
*   OGS declares cross-Role field projections through Context Maps and does not project `WorkspaceRef` by default. Runtime rejects unauthorized fields and file references. The design applies least-privilege reasoning; this paper does not measure changes to attention dilution or prompt-injection risk.

##### (5) Software Delivery Engineering: Commit-Backed Workspace Delivery
*   Agent tools apply different workspace modification and permission models; this paper does not generalize across all coding agents.
*   In OGS, Roles start from a fixed `baseCommit` in isolated Worktrees. The Framework creates Role commits with provenance, verifies Workspace content and LFS objects, and materializes a Release manifest and output digest from `releaseCommit`; only a published Release exposes a download reference.

##### (6) Underlying Tech Stacks and System IPC Protocols: CLI Pipes, Unix Sockets, LSP, and Durable WAL
*   **Orca and Herdr:** Public references for worktree isolation/terminal delegation and terminal multiplexing, respectively. This paper does not compare their end-to-end business-state, authorization, or audit contracts under common conditions.
*   **OGSystem (Compiled TypeScript Engine + Semantic IR + LTS Events + WAL/CAS + Git/LFS Workspace):** Operates as a lightweight, daemonless Node.js/TypeScript engine executing compiled Semantic IR. Inter-seat coordination uses declared LTS business events ($\Sigma_{\text{fixed}}$) and Context Map projections. State transitions are appended to `events.ndjson` before CAS state snapshots are committed to `state.json`. Framework-managed Worktrees, canonical locks, Git/LFS provenance, Workspace verification, and Release Materialization provide traceable delivery records under the implemented contracts; this is not a claim of tamper-proof storage or deterministic external Agent behavior.

##### (7) Theoretical Sources, Potential Standards Relevance, and Engineering Context
The table separates established computer-science sources, possible topic relevance inferred from GB/Z document titles, and engineering context. Clause-level mappings have not been verified; this is not a standards-conformance assessment or a matched product comparison:

| Foundational Principle / Structural Claim | Formal CS Literature Baseline (DOI / Citation) | Potential Standards Relevance (GB/Z; clauses not verified) | Engineering Context (not a matched comparison) |
| :--- | :--- | :--- | :--- |
| **Principle 1: Responsibility Seat / Executor Separation**<br>($V$ responsibility model and runtime executor binding $\rho$) | Milner 1989 (LTS Concurrency Algebra)<br>Meyer 1992 (Design by Contract, DOI: [10.1109/2.161279](https://doi.org/10.1109/2.161279)) | **GB/Z 185.1—2026** (General Architecture; clauses not verified)<br>**GB/Z 185.4—2026** (Agent Description; clauses not verified) | OGS models responsibility separately from Backend/model binding; this is a design distinction, not a comparative finding about OMP or ChatDev. |
| **Principle 2: LTS Discrete Business Transitions**<br>($\Sigma_{\text{fixed}}$ declared event vocabulary) | Milner 1989 (LTS, ACM 1989)<br>Newman 2015 (*Building Microservices*, O'Reilly) | **GB/Z 185.6—2026** (Agent Interaction; clauses not verified) | Adds schema-checked event routing to the OGS contract; this is not an empirical claim about every use of Swarm or AutoGen. |
| **Principle 3: Full-Element Persistent Tuple**<br>($\mathbf{X}$ state vector + WAL + CAS commits) | Cheng & Krishnakumar 1993 (EFSM, DAC '93, DOI: [10.1145/157485.164585](https://doi.org/10.1145/157485.164585))<br>Gray & Reuter 1992 (*Transaction Processing*, Turing Award) | **GB/Z 242—2026** (Technical Requirements for AI Agents; clauses not verified)<br>**GB/Z 185.1—2026** (General Architecture; clauses not verified) | Incorporates durable-execution ideas from Cadence/Temporal and targets crash-consistency risks; no comparative failure-rate study against Claude Code or LangGraph is claimed. |
| **Principle 4: Bounded Cycles & CAS Review Breakpoints**<br>($Iteration \le Budget \to$ CAS Pause) | Alshiekh et al. 2018 (*Safe Reinforcement Learning via Shielding*, AAAI 2018)<br>Lee & Yannakakis 1996 (*FSM Testing Survey*, IEEE) | **GB/Z 242—2026** (Technical Requirements; clauses not verified)<br>**GB/Z 185.6—2026** (Agent Interaction; clauses not verified) | Adds explicit budgets and review breakpoints to OGS cycles; this is not a measured comparison of risks in other frameworks. |
| **Principle 5: State-Aware Confluence Scopes**<br>($S_{\text{src}} \in \{pending, arrived, skipped, failed\}$) | van der Aalst et al. 2003 (*Workflow Patterns*, DOI: [10.1023/A:1022883727209](https://doi.org/10.1023/A:1022883727209)) | **GB/Z 185.1—2026** (General Architecture; clauses not verified) | OGS prohibits silently downgrading `failed` to `skipped`; this constraint is not a general proof that arbitrary branch failures cannot deadlock. |
| **Principle 6: Fail-Closed Context Projections**<br>(Context Map blocks undeclared fields) | Saltzer & Schroeder 1975 (*Fail-safe Defaults Axiom*, IEEE, DOI: [10.1109/PROC.1975.9939](https://doi.org/10.1109/PROC.1975.9939)) | **GB/Z 185.7—2026** (Agent Tool Invocation; clauses not verified) | Applies least-privilege reasoning to cross-Role projections; no experiment here measures changes to attention dilution or prompt-injection risk. |
| **Principle 7: Workspace Content Verification and Release Materialization**<br>(WorkspaceRef $\to$ Verifier $\to$ Materialization) | Yang et al. NeurIPS 2024 (*SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*)<br>Jimenez et al. ICLR 2024 (*SWE-bench*) | **GB/Z 242—2026** (Technical Requirements; clauses not verified) | Git/LFS commits, read-only references, and post-verification materialization form OGS's traceable delivery path; Git, manifests, and provenance are not claimed as original mechanisms. |
| **Principle 8: Runtime Event Records**<br>(`events.ndjson` and review-state identifiers) | Gray & Reuter 1992 (Write-Ahead Logging)<br>Saltzer & Schroeder 1975 (Open Design Axiom) | No clause-level standards mapping is claimed; the cited GB/Z 185.3 is the identity-management part. | OGS records runtime events and review-state identifiers for audit tracing within the implementation; this is not a claim of tamper-proof storage or formal causal proof. |

##### (8) Superset Relation: Subsuming DAG Pipelines ($DAG \subset EFSM$)
An explicit rework edge is not part of an acyclic DAG topology and must be represented by a runtime or control construct that supports iteration. Workflow products differ in their support for loops, state, and recovery; this paper does not assign one capability model to all n8n, Dify, or Coze implementations. Under the state-transition definitions used here, EFSM can represent a DAG as an acyclic, single-activation case. This model relation does not establish superiority over DAG implementations or provide a measured guarantee for cyclic collaboration.

---

### 3. System Design and Compilation Pipeline

#### 3.0 Research Questions
This paper is a system-design and engineering-verification report, not a controlled performance comparison. It addresses three questions:

| Research question | Focus | Evidence in this paper |
| --- | --- | --- |
| **RQ1:** How does V2 express and enforce boundaries among responsibility, technical binding, execution, and evidence? | Four-layer ownership, Role contracts, Backend/Harness binding, tool authorization, and environment-policy resolution. | V2 contracts, runtime implementation, and regression tests; no comparative security advantage over other products is inferred. |
| **RQ2:** How do concurrent Roles share Workspace content facts and connect Join, Evidence, and Release state? | One Project Workspace, fixed `baseCommit`, read-only `WorkspaceRef`, four-valued Join source state, and Release state. | Contracts, implementation, and fault-injection records support the protocol relationships and selected failure paths; end-to-end runs establish only the specific paths recorded and do not validate the full state protocol end to end. |
| **RQ3:** Which runtime claims are supported by current engineering evidence, and which generalization claims remain untested? | Enforcement of selected invariants, real-model tasks, and one cross-Agent-Backend workflow. | The current 596-test run, recorded Python-calculator runs, and one Codex-to-OpenCode Project Run; the Implementer made no file changes, so downstream consumption of `WorkspaceRef` was not demonstrated. The runs do not establish cross-model generalization, bidirectional interoperability, or graph-engine portability. |

These questions define the design and verification scope; they do not presuppose academic novelty or superiority over related systems.

#### 3.1 Prior Art Attribution and the OGS Novelty Boundary
This section separates prior art, OGS's system-level engineering contribution, and claims that are not directly validated. Public capabilities such as LangGraph, LTS/EFSM, Git, WAL/CAS, least privilege, and role-based agents are not presented as OGS inventions. Table 2.5 is a design comparison, not eight independent academic discoveries.

**Distinguishing Theoretical Innovation from Engineering Foundation:**
1. **Design and Scholarly Innovation (Core Novelty Value):** The primary academic contribution of OGS lies in formalizing a **Role-First Extended Finite-State Machine (EFSM over LTS)** specifically designed for multi-agent socio-technical collaboration. While generic graph runtimes (such as native LangGraph) treat state as untyped dictionaries and node hops as arbitrary code executions, and recent 2026 frontiers—such as NeuralFSM (ACL 2026) modeling multi-agent coordination as finite-state execution, Agent-SAMA (AAAI 2026) managing FSMs for error recovery, GraphFlow (ICML 2026) utilizing graph topology for state management, and HEXIS (2026) compiling agent skills into EFSMs—corroborate that finite-state control is the prevailing academic paradigm for curbing LLM non-determinism, they operate primarily on in-memory prompt routing or single-agent tool execution. OGS extends classical EFSM theory into multi-role organizational collaboration: formalizing immutable responsibility seats ($V$), discrete-event labeled transitions ($\Sigma$), compile-time bounded loop budgets with static exhaustion routes, fail-closed Context Maps as transition guard conditions, four-valued stochastic Join calculus ($S_{src} \in \{pending, arrived, skipped, failed\}$), and physical state binding to immutable repository commits (`WorkspaceRef`) and Release materialization. This domain-specific state-machine model constitutes the paper's principal theoretical contribution.
2. **Engineering Implementation Foundation:** Concurrently, at the engineering layer, OGS balances this formal EFSM design with **end-to-end auditability and traceability** (grounded in WAL `events.ndjson`, CAS `state.json`, and Git commit lineages). Recent 2026 research, such as *Auditable Agents* (Nian et al. 2026), systematically formalizes the five foundational dimensions of agent auditability (action recoverability, lifecycle coverage, policy checkability, responsibility attribution, and evidence integrity), TraceDev (ISSTA 2026) demonstrates the necessity of explicit artifact traceability graphs, and Cho et al. (2026) empirically show that agent behavior topology is fundamentally governed by environmental harness state machines; OGS directly operationalizes these exact auditability principles and topological controls through its append-only WAL/CAS, immutable Git commit lineages, and cryptographic Release gates. While full-lifecycle auditability is a vital engineering prerequisite for enterprise adoption, the formal EFSM collaboration model provides the theoretical foundation for coordination determinism.

##### Prior Work and Public Capability Attribution

The table identifies prior ideas and project capabilities used by OGS and locates the candidate contribution. “Adopted” describes technical lineage or related work; it does not imply direct copying. Candidate contributions are not claims of exhaustive novelty review.

| Prior work or public capability | What is already public | How OGS uses it | Attribution |
| --- | --- | --- | --- |
| [LTS](https://dl.acm.org/doi/book/10.5555/63442), [EFSM](https://doi.org/10.1145/157485.164585), [Workflow Patterns](https://doi.org/10.1023/A:1022883727209) | Discrete transitions, extended state, synchronization, confluence, and multiple Join patterns have established foundations. | Foundations for OGS Flow, loops, and Join semantics. | State machines and general Join capabilities are not OGS inventions; the candidate contribution is limited to the specific source-state anti-downgrade constraint combined with Workspace/Release state. |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) | StateGraph execution, nodes/edges, conditional routing, loops, and checkpoints are public runtime capabilities. | OGS currently uses LangGraph to execute compiled plans; OGS defines its own business contracts, Roles, Workspace, and Release semantics. | Graph-engine capabilities belong to LangGraph; the specific OGS semantic boundary and integration are candidate system contributions. Replacement by another graph engine has not been validated. |
| [ChatDev](https://aclanthology.org/2024.acl-long.810/), [MetaGPT](https://openreview.net/forum?id=VtmBAGCN7o), [AutoGen](https://arxiv.org/abs/2308.08155) | Multi-role division, conversational collaboration, and role-based software workflows. | Related work and comparators for multi-role collaboration. | Multi-role collaboration itself is not novel to OGS; the distinction claimed is the composition with responsibility contracts and authorization boundaries. |
| [OpenHands](https://arxiv.org/abs/2407.16741) and [Orca](https://github.com/stablyai/orca) | OpenHands studies an open platform for software-development agents; Orca publicly describes worktree isolation and terminal delegation. | Directly relevant references for agent execution environments, workspace collaboration, and delegation. | This paper has not compared their WorkspaceRef, merge, Evidence, and Release protocols with OGS under matched conditions; the shared Workspace state model remains a candidate integration contribution pending that comparison. |
| [Cadence](https://github.com/uber/cadence) / [Temporal](https://docs.temporal.io/) and transaction recovery practice | Durable execution, event histories, recovery, and workflow state management. | Engineering references for persistence, checkpoints/WAL, and recovery. | Durable execution is prior art; OGS state contracts and implementation are an engineering composition. |
| [Saga (1987)](https://doi.org/10.1145/38713.38742), [Workflow Exception Patterns (2006)](https://doi.org/10.1007/11767138_20), and [Luo et al. (2000)](https://doi.org/10.1023/A:1008388412284) | Long-transaction decomposition, compensation, and workflow exception/failure handling have prior work. | Prior context for multi-stage Release publication, retry/reconciliation, and Join exception policies. | Staged publication, failure policies, and exception handling are not novel claims; these sources do not directly cover OGS's particular four-valued Join and Workspace/Release protocol composition. |
| [Git Worktree](https://git-scm.com/docs/git-worktree) / Git LFS | Commit-addressed content, isolated worktrees, object storage, and version history. | The single Project Workspace content fact and isolated Role execution substrate. | Underlying version-control mechanisms are not OGS inventions; the collaboration state model combining one Workspace, read-only `WorkspaceRef`, Evidence, and Release is a candidate engineering integration pending comparison. |
| [SWE-agent](https://arxiv.org/abs/2405.15793); [SWE-bench](https://arxiv.org/abs/2310.06770) | SWE-agent studies Agent-Computer Interfaces and software-engineering agents; SWE-bench provides a benchmark for real GitHub issue resolution. | Related work respectively for execution/tool interaction and real-repository task evaluation. | Neither establishes novelty of OGS's delivery protocol or provides empirical evidence for OGS. |
| [Chubby](https://www.usenix.org/legacy/event/osdi06/tech/full_papers/burrows/burrows.pdf), [in-toto](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias), and [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) | Distributed locks and fencing/sequencers, software-supply-chain provenance, and build-origin attestations have public prior art. | Engineering references for canonical locking/CAS, commit provenance, Evidence manifests, and Release records. | Locking, CAS, and provenance mechanisms are not individually novel to OGS; the candidate contribution is their composition in a single-Workspace multi-Role collaboration and release protocol. |
| [Saltzer–Schroeder least privilege](https://doi.org/10.1109/PROC.1975.9939) | Established security principles including fail-safe defaults and least privilege. | Rationale for fail-closed Context Maps and `HandoffProjection`. | The security principle is prior art; the specific projection contract and its connection to WorkspaceRef are OGS design choices. |
| Four product layers | Software layering and separation of control, execution, and audit concerns are established design practices. | OGS organizes product ownership as Business, Technical Binding, Execution, and Evidence. | Product architecture choice, not a standalone academic novelty claim. |

Two uses of “engine” must be distinguished: LangGraph is the currently validated graph execution engine, while Codex and OpenCode are Agent Backends/Harnesses. The formal V2 evidence dated 2026-11-19 records one real Project Run from a Codex Planner to an OpenCode Implementer and a published Release. The Planner produced a `WorkspaceRef`, but the OpenCode Role made no file changes, so actual downstream consumption of that reference was not demonstrated. Both used the same base model, `gpt-6-luna`, with OpenCode recording the provider-qualified ID `codex-gateway/gpt-6-luna`. This demonstrates one runnable flow across Agent Backends and a published Release; it does not establish cross-model generalization, bidirectional interoperability, or graph-engine portability. See the [formal run evidence](../development/evidence/v2-formal-cross-backend-project-release-2026-11-19.md).

Based on the current related-work review and repository implementation, this paper treats the following as candidate system-integration contributions, not established academic novelties: semantic contract boundaries; a single-Workspace state model; and a Join/Release protocol combining four-valued source state with declared exception policies. The Join/Release invariants have direct implementation evidence. The semantic boundary and shared Workspace model still require matched, item-by-item comparisons with OpenHands, Orca, and durable workflow systems. Current evidence does not rule out homogeneous prior solutions; no first-invention or superiority claim is made.

| Candidate contribution | Research question | Supporting evidence | Claim boundary |
| --- | --- | --- | --- |
| Semantic contract boundaries and four-layer responsibility model | RQ1 | V2 design contracts, runtime configuration resolution, and regression tests | Implemented domain model and engineering boundary; not a standalone academic novelty, proof of superiority, or validation of portability to another graph engine. |
| Single-Workspace state model | RQ2 | Workspace contracts, commit/WorkspaceRef/Evidence/Release implementation, and fault-injection records | Implemented V2 engineering integration; matched protocol comparisons with OpenHands, Orca, and related systems remain incomplete. |
| Four-valued Join source state and Join/Release state connection | RQ2 | Join policy implementation, Workspace/Release contracts, and selected failure-path tests | The source implements a sticky `failed` invariant, but no dedicated test asserting that a later `skipped` cannot overwrite `failed` was found; general Join and the four-value enum are not claimed as novel, and academic novelty is unconfirmed. |
| Engineering feasibility and backend boundary | RQ3 | Current 596-test run, recorded Python-calculator runs, and one cross-Agent-Backend Project Run | Supports limited engineering feasibility, not performance, security-effectiveness, cross-model generalization, or graph-engine portability. |

The four-layer architecture, adapter wiring, test counts, and recorded Python-calculator runs are engineering evidence. They do not by themselves establish academic novelty, cross-system superiority, long-term stability, or standards compliance.

| Architectural Dimension | Industry Homogenized Patterns | OGS Design Profile |
| :--- | :--- | :--- |
| **1. Node Ontology** | **"Agent = Model + System Prompt + Memory"**<br>Some systems bind a role to a model or conversation; responsibility boundaries vary by implementation. | **Responsibility Seat / Executor Separation**<br>OGS models stable Role Contracts separately from runtime Backend/model bindings. Role-based collaboration is prior art; this is OGS's domain-modeling choice. |
| **2. Control Algebra** | **Natural Language Handoffs or Arbitrary Strings**<br>Routing may rely on generated calls such as `handoff_to("reviewer")`. | **LTS Discrete Business Events**<br>OGS restricts control events to a declared vocabulary ($\Sigma_{\text{fixed}}$) and validates business data with schemas. This applies established LTS and contract ideas. |
| **3. Context Security** | **Shared History or State Dictionaries**<br>Products differ in how they control shared state and projections; no matched product-level evaluation is claimed here. | **Fail-Closed Field-Level Context Map Projection**<br>Only contract-declared fields cross Role boundaries. This applies least-privilege reasoning in OGS and does not establish elimination of all prompt-injection risks. |
| **4. Concurrency Join** | **Join and synchronization patterns**<br>General synchronization, OR-Join, quorum, and related modes are established workflow patterns and framework capabilities. | **Four-Valued Source-State Tracking**<br>OGS tracks $S_{\text{src}} \in \{pending, arrived, skipped, failed\}$ and prevents silent rewriting of `failed` to `skipped`; the candidate contribution is this specific invariant in the delivery protocol, not Join itself. |
| **5. Loop Convergence** | **Unbounded Recursion or DAG Back-edge Constraints**<br>Control and recovery behavior varies across systems. | **Lineage-Bound Budget & CAS Review Identity**<br>OGS bounds cycles by $maxIterations$ and binds review decisions to $\langle reviewId, round, lineageId, branchId, stateVersion \rangle$; these are implemented controls, not a general halting proof for arbitrary agent behavior. |
| **6. Workspace Delivery** | Workspace modification boundaries depend on each Agent tool and its permission configuration; no product-level comparison is claimed here. | **WorkspaceRef and Release Materialization**<br>Git/LFS commits provide the content fact; read-only `WorkspaceRef` values are verified, and a Release materializes `releaseCommit` into a manifest, output digest, and controlled download reference. |
| **7. Socio-Technical Form** | **Different Product Forms**<br>Canvas, code, and operations views organize responsibilities differently; no universal product comparison is implied. | **Four-Layer Product Architecture**<br>OGS organizes ownership as Business, Technical Binding, Execution, and Evidence; Studio, Team Site, and CLI are cross-layer projections. This is a product architecture choice, not a standalone novelty claim. |
| **8. Crash Consistency** | **Different Recovery Strategies**<br>Recovery behavior depends on the framework and persistence configuration. | **WAL + CAS + Semantic Fingerprint Checks**<br>OGS appends events to `events.ndjson`, commits snapshots to `state.json`, and checks the plan fingerprint during recovery; fault-injection tests cover specified crash windows. |

*Table 2.5: Design profile and novelty boundary compared with common industry patterns.*

#### 3.2 The Role-First Socio-Technical Model
OGS models human-agent collaboration as a 6-tuple:
$$R = (V, E, \rho, \tau, \kappa, \alpha)$$
*   **$V$ (Responsibility Seats):** Invariant accountability boundaries within an organization (e.g., `Architect`, `Tester`), completely orthogonal to transient LLM executors.
*   **$E$ & $\tau$ (Handoffs & Discrete Events):** Directed flows governed by a Labeled Transition System (LTS) over a closed vocabulary: $\Sigma_{\text{fixed}} = \{\text{READY}, \text{APPROVED}, \text{REJECTED}, \text{NEEDS\_REWORK}, \text{BLOCKED}\}$.
*   **$\kappa$ (Flow Contracts & Context Map):** Downstream nodes receive only explicitly projected fields via declared Context Maps; undeclared memory traversal is rejected (Fail-Closed).
*   **$\alpha$ (Governance Policy):** Formally separates worker execution ($\rho$) from supervisor control authorities ($\alpha$, e.g., budget grants, aborts).

#### 3.2 Compilation and Fail-Closed Invariants
User-defined Mermaid topologies (`system.mmd`) compile into **Semantic IR**. Its `SemanticIR.version`
is recorded independently from the outer `ogsContractVersion: 2`; legacy runtime compatibility branches
are not part of the active contract. The compiler enforces three non-negotiable invariants:
1. *Seat Purity:* Nodes must map exclusively to responsibility seats (no raw tool or gateway nodes).
2. *Bounded Cycles:* Every directed cycle must declare a finite budget ($maxIterations \in \mathbb{Z}^+$) and an exhaustion route.
3. *Join Closedness:* Prerequisite branch sources converging into a join node must be statically verified at compile time.

---

### 4. Runtime Orchestration and State Control

#### 4.1 Persistent Extended State Tuple
The runtime continuously persists an extended state tuple:
$$\mathbf{X} = \langle s_{\text{biz}}, \mathbf{t}_{\text{task}}, \mathbf{i}_{\text{input}}, \mathcal{F}_{\text{frontier}}, \mathcal{L}_{\text{lineage}}, \mathcal{J}_{\text{scopes}}, \mathcal{C}_{\text{budgets}}, \mathcal{H}_{\text{review}}, \mathcal{V}_{\text{cas}} \rangle$$
recording reduced business states, branch lineages, join synchronization progress, review locks, and monotonic CAS versions.

#### 4.2 State-Aware Join Semantics
For join scope $J = \langle \text{runId}, \text{lineageId}, \text{loopIteration} \rangle$, source branch statuses are tracked as:
$$S_{\text{src}} \in \{\text{pending}, \text{arrived}, \text{skipped}, \text{failed}\}$$
*   **All-of Join:** Requires all configured source outcomes to satisfy the declared Join policy.
*   **Quorum-of Join ($K$):** The threshold is satisfied when the configured number of unique sources arrive; late arrivals remain evidence and do not change a committed result.
*   **Failure-State Preservation:** A `failed` source is not silently rewritten as `skipped`. Source failures follow `failurePolicy` (`wait`, `fail`, or `quorum_continue`); a required `skipped` source fails an `all_of` Join. At timeout, `onTimeout` selects `fail`, `quorum_continue`, `pause`, or `terminate`; `quorum_continue` applies only to quorum joins and fails if the threshold is not met.

#### 4.3 Bounded Loop and Budget Review
When an iterative rework event (e.g., `NEEDS_REWORK`) exceeds $maxIterations$, the runtime raises `loop_exhausted` and enters `waiting_review`. A human supervisor must authenticate a lineage-bound decision (`continue`, `rework`, or `terminate`) protected by CAS version matching.

#### 4.4 Write-Ahead Logging (WAL) and Crash Consistency
Transitions commit to `events.ndjson` before updating `state.json`. Resuming an interrupted Run enforces an exact hash match between the frozen plan fingerprint and the current disk definition, preventing speculative recovery under semantic drift.

---

### 5. Workspace Collaboration and Auditable Delivery

V2 never treats a shared writable directory as a handoff protocol. Each Project has exactly one Git + LFS
Workspace. Roles start from a fixed `baseCommit` in isolated worktrees; the Framework creates and records
Role commits, and Join integrates candidates in a separate merge worktree. A conflict emits
`join_conflict` and leaves the canonical ref unchanged.

Cross-Role file transfer uses a read-only `WorkspaceRef` containing Workspace ID, full commit, repository-
relative path, and digest. References are empty by default and require an explicit authorized
HandoffProjection. Checkpoints, Git commit/LFS object provenance, and Run Evidence form a bidirectional
audit relationship; a local worktree path is never a recovery identity.

Canonical ref updates, restore, Release publication, and other authoritative mutations acquire the
canonical lock, validate `expectedCanonicalHead`, and use CAS. Stale heads, invalid leases, and external
direct writes fail closed; candidates remain available for retry or rebase.

By default `releaseCommit = mergeCommit`. A child commit is created only when release metadata or other
authoritative Workspace content changes. The Framework materializes `releaseCommit`, verifies its manifest
and output digest, and exposes a download reference only after the Release reaches `published`.

#### 5.1 Shared Collaboration Data-State Model

V2 does not organize collaboration around an artifact reference or promotion object. Its durable state
relationship is:

| Data object | Key state or fields | Meaning and constraint |
| --- | --- | --- |
| Project / Workspace | `workspaceId`, canonical ref, canonical HEAD | Each Project has one Git + LFS Workspace; Git commit is the only content version fact. |
| Role work | `baseCommit`, `worktreeId`, `branch`, `roleCommit` | A Role works only in a Framework-created isolated Worktree; a WorkspaceRef exists only after a commit. |
| Handoff | `workspaceRefs[]`, `WorkspaceRef` | Empty by default; only an explicitly authorized commit/path/digest reference crosses a Role boundary, with no write authority. |
| Checkpoint / Evidence | `state`, `branchId`, `lineageId`, `round`, `loopIteration`, `stateVersion`, commit refs | Checkpoints recover workflow state; the Evidence manifest indexes events, checkpoints, logs, verification, provenance, and reviews. |
| Canonical lock | `owner`, `leaseUntil`, `fencingToken`, `expectedCanonicalHead` | Guards canonical ref, restore, and Release publication; a stale head fails closed. |
| Join / integration | candidate commits, `mergeCommit`, `join_conflict` | Candidate integration occurs in a Merge Worktree; conflicts remain evidence and leave the canonical ref unchanged. |
| Release / Materialization | `prepared -> materialized -> ref_updated -> published` or `failed`; `releaseCommit`, manifest, `outputDigest` | Release is a publication record, not a second version system; a download reference is public only when `published`. |

Therefore, `WorkspaceRef`, Run Evidence, Release, and Materialization are the only public V2 file and
delivery boundaries. Manifests do not create another content history, checkpoints do not create a parallel
status enum, and Release status is not duplicated as a second event model.

This design systematically resolves the **destructive in-place mutation problem** prevalent in existing multi-agent collaboration frameworks (such as ChatDev, MetaGPT, CrewAI, and AutoGen). In conventional agent workflows, multiple roles collaborate over a shared flat directory via in-place file overwrites. When an Editor, Reviewer, or downstream Specialist modifies an artifact—whether a multi-chapter consulting report, a financial spreadsheet, or a code module—the intermediate drafts produced by prior roles are directly wiped out. In enterprise settings and compliance auditing, this creates three critical vulnerabilities:
1. **Loss of Intermediate Auditability:** Individual role contributions are obliterated, making it impossible to audit which agent introduced an erroneous claim, hallucinated statistic, or policy violation.
2. **Irreversible Content Loss and Silent Regressions:** When reviewing agents hallucinate or over-prune previous work, valid sections written by upstream specialists are permanently deleted without diff inspection or rollback capability.
3. **Concurrent Dirty Writes:** Parallel agents operating on overlapping files uncoordinatedly overwrite each other's outputs.

By isolating each Role in a dedicated Git Worktree, requiring all intermediate drafts to be captured as immutable Git commits, and passing only cryptographically addressed read-only `WorkspaceRef` values integrated through a dedicated Merge Worktree, OGS turns every intermediate artifact into a verifiable, tamper-evident version object, ensuring full intermediate auditability and rollback capability in enterprise collaboration.

---

### 6. Engineering Implementation: Four Product Layers

OGS is implemented as a lightweight TypeScript runtime. Contract Set v2 separates product ownership into:
* **Business:** Role Contracts, Flow Semantic IR, Joins, Loops, Reviews, and Handoffs.
* **Technical Binding:** The Harness Template configures Backend, Model, `allowedTools`, `EnvironmentIntent`, and limits; `EnvironmentIntent` is an input intent, not the resolved execution policy.
* **Execution:** Git, LFS, Worktrees, canonical lock, CAS, merge, recovery, and Materialization.
* **Evidence:** checkpoints, events, provenance, Evidence manifests, and Release records.

OGS Studio, Team Site, and the CLI are configuration and operational projections over these
layers, not a fifth layer. `WorkspaceRef` is a cross-layer read-only value object, not another content-version model.

#### 6.1 Tool authorization and workspace projection
Each executable Role must bind to a Harness Template. Technical Binding configures Backend, Model, `allowedTools`, and `EnvironmentIntent`. Before Backend startup, Runtime resolves and freezes `verifiedTools`, `allowedTools`, `EffectiveEnvironmentPolicy`, and their digests; the Adapter maps the effective policy to backend-native configuration. The executable set is `allowedTools ∩ verifiedTools` and exists only in Runtime memory. Unknown, dynamic, unavailable, or unenforceable capabilities are denied. V1 fields such as `allowedToolsByRoleId` and `constraints.allowedTools` and compatibility reads are not part of Contract Set v2.

---

### 7. Engineering Verification

OGSystem uses Node.js native tests (`node:test`) to check selected implementation invariants. Deterministic local-shell and fixture tests are reported separately from real model runs.

#### 7.1 Automated Test Suite and Invariant Coverage
The current repository-wide `pnpm test` run discovers **596 tests (488 core passed, one Windows-specific test skipped, 107 Team Site passed, and zero failed)** (the earlier 587 count reflected the 2026-11-19 checkpoint, while the historical 819 count predates archiving legacy v1 tests to `tests/archive/v1/`). Coverage includes the state-machine kernel, compilation, storage, Workspace content and Release verification, Git collaboration, and visual projections (Table 3):

| Subsystem / Test Suite | Test Count | Verified Design Invariants & Behaviors | Pass Rate |
| :--- | :--- | :--- | :--- |
| **State machine and compilation runtime** | Included in core suite (489 tests incl. 1 skip) | LTS, Context Maps, Joins, Loops, WAL/CAS, and core regressions | All executed tests passed (1 Windows-only skipped) |
| **Workspace and Release delivery** | Included in core suite | WorkspaceRef, path/symlink gates, worktrees, commit provenance, Join merge, canonical lock/CAS, conflicts, and Release failure paths | All passed |
| **Platform and cross-layer projections (incl. Team Site)** | 107 Team Site tests + core CLI/Studio regressions | Workspace capability projection and Studio, Team Site, CLI, Evidence, and Release regressions | All passed |
| **Total system** | **596 tests** | **595 passed, one skipped, zero failed** | **99.8% pass rate by discovered tests (0 failed)** |

*Table 3: Comprehensive automated regression test suite and invariant verification metrics.*

#### 7.2 Fault Injection and Crash Consistency Mechanisms
The runtime implements fault-injection and recovery hooks (note: the corresponding legacy test suites `runtime-fault-injection.test.mjs` and `resume-session.test.mjs` are currently archived under `tests/archive/v1/` and are not executed by active `pnpm test`; non-archive V2 end-to-end interrupt/resume proof remains open):
1. **Crash After Execution Outcome:** Leveraging the runtime hook `OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME=1`, the runtime can trigger an abrupt child process termination (Exit Code 91) at the critical boundary where a role outcome has been produced and state transitions are in-flight, paired with `run resume <runId>`, buffered append recovery, and process lockfiles (`RESUME_RUN_LOCK_FILE`).
2. **Semantic Fingerprint Matching:** Resumption strictly enforces plan fingerprint matching via `plan-fingerprint.ts`: modifying `system.mmd` or runtime configurations out-of-band while paused triggers an integrity rejection, preventing speculative execution under semantic drift.

#### 7.3 Real model-driven Python calculator acceptance
Repository records include real local Codex `gpt-6-luna` runs of a Python calculator project on 2026-11-15 and 2026-11-16 using the topology `dispatch -> implementation/tests (parallel) -> join`. The 2026-11-15 record documents four Role commits, Join merge, final merge, caller-side fast-forward publish, and 8 passing unittest cases; the 2026-11-16 re-verification documents 10 passing tests (while also noting a later bounded retry hung).

This demonstrates that a real model can traverse the complete collaboration path, but it is not a statistical stability result. The sample uses one model, one task, and a small number of runs; path ownership, Git-only source delivery, and acceptance entrypoints were explicit task constraints. Boundary runs also confirmed that same-path parallel edits stop at a Git conflict, stale canonical heads are rejected by CAS, and whitespace errors are rejected by `git diff --check`. The archived deterministic script `tests/archive/v1/python-app-collaboration.test.mjs` is a local-tool regression and is not real-model evidence.

#### 7.4 Boundary Security and Contract Interception
1. **Context Map Invariant:** Tests in `tests/optional-context-projection.test.mjs` confirm that undeclared upstream context variables are physically excluded from downstream role inputs.
2. **Workspace Content Security:** Tests in `tests/workspace-and-verifier.test.mjs` verify that path traversals (e.g., `../`) and files exceeding byte quotas are rejected, while symbolic link (symlink) rejection is verified in `tests/workspace-coordinator.test.mjs` and `tests/artifact-promotion.test.mjs`. The Release materialization verifier separately checks the final file set, manifest, and output digest.
3. **Potential Standards Relevance (GB/Z 2026 Series):** OGS event contracts, tool boundaries, and persistent execution may be relevant to topics covered by **GB/Z 185.6**, **GB/Z 185.7**, and **GB/Z 242**. The present work has not completed a clause-by-clause standards review and makes no conformance or direct-alignment claim.

#### 7.5 Current boundaries and recovery responsibilities
The V2 Framework owns the Workspace, Git LFS, Worktrees, canonical lock, checkpoints, merge, restore,
and Release operations. Roles cannot directly commit, push, update refs, operate LFS locks, or edit
checkpoints. OGS still has no AI resolver, cross-system transaction, or external publication compensation;
failed Runs do not publish the canonical Workspace or an official download reference. Merge/Release
evidence and possible partial external effects remain in the Run for caller-side reconciliation.

#### 7.6 Proposed Controlled Evaluation (Not Yet Executed)
Each deliverable type requires an appropriate oracle: hidden tests for code and frozen requirement-coverage rubrics plus blinded review for office documents and analysis. Report each task stratum separately before aggregation; code test pass rates do not directly measure general collaboration quality.
Current engineering records cover software implementation, management consulting, and structured debate Projects, but there is no controlled comparison; they cannot show cross-scenario gains in task quality or lower hallucination. Use three primary arms: A) a single agent with the same model and verifier; B) a generic multi-agent workflow with the same role graph, prompts, tools, and isolated workspaces, but without OGS Context Maps, WorkspaceRefs, and Join/Release contracts; and C) full OGS V2. Add MetaGPT and ChatDev as product-comparison arms for the software-task stratum, and CrewAI as a product-comparison arm for the office/knowledge-work stratum. Include file-based deliverables from repository changes (informed by MetaGPT SoftwareDev and long-horizon evolution tasks from SWE-EVO), office-document/report drafting and review (informed by OfficeBench and GAIA), and structured analysis or debate synthesis. Stratify and report results by task type. Arm B isolates the protocol contribution; Arm A estimates the benefit and cost of role decomposition. Fix model version, token ceiling, tools, acceptance oracle, and retry policy, and randomize paired runs by task type, task, and seed.

The primary outcome should be **verified delivery success**: hidden tests and requirement acceptance pass, no existing tests regress, commit provenance resolves, the Release digest verifies, and status is `published`. Report denominators, absolute percentage-point differences, and 95% confidence intervals. Define hallucination-related outcomes narrowly as atomic factual claims in handoffs and final reports that can be checked against logs, Git, tests, and Release evidence. Blinded human annotators should measure unsupported claims per 100 verifiable claims, contradiction rate, and false-completion rate. This does not measure every form of model hallucination. Also record conflict recovery, stale-reference rejection, unauthorized-field leakage, invalid publication, latency, token/API cost, and cost per verified success. Unchanged task pass rate with fewer false-completion or invalid-publication events can support a delivery-reliability claim, but not a claim that the model is generally more accurate. For exploratory H5, repeat the same versioned workflow after declared policy or model revisions and measure policy-violation escape rate, evidence-reconstruction completeness, audit time, and control drift. This tests operational continuity within a bounded workflow, not organizational governance maturity. Start with a 20–30-task pilot; a 0.25 discordant-pair rate and 10-point target difference would imply about 196 independent task pairs under a normal approximation, subject to recalculation for task clustering. Report null effects and additional cost.

The [bilingual experiment plan](experimental-validation-plan-bilingual.md) gives the protocol, metrics, analysis, and direct literature links. Final sample size should be estimated from pilot discordance; for example, a 0.25 discordant-pair rate and a 10-percentage-point target difference yields an approximate 196 independent task pairs, subject to recalculation for task clustering. Relevant public sources include [SWE-bench](https://arxiv.org/abs/2310.06770), [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/), [SWE-EVO](https://arxiv.org/abs/2512.18470), [OfficeBench](https://arxiv.org/abs/2407.19056), [GAIA](https://arxiv.org/abs/2311.12983), [Multiagent Debate](https://arxiv.org/abs/2305.14325), a [survey of LLM hallucination](https://arxiv.org/abs/2311.05232), and [RAGTruth](https://aclanthology.org/2024.acl-long.585/). Recent works such as MetaAgent (ICML 2025), StateFlow (COLM 2024), NeuralFSM (ACL 2026), Agent-SAMA (AAAI 2026), GraphFlow (ICML 2026), HEXIS (2026), and Sun et al. (2026) corroborate the value of finite state machines in structuring LLM workflows, while Auditable Agents (2026), TraceDev (ISSTA 2026), and Cho et al. (2026) reinforce the foundational requirement for multi-agent auditability, behavioral topology control, and artifact traceability. They motivate benchmark and measurement choices; they are not evidence of an OGS effect.

---

### 8. Conclusion and Future Work

OGSystem applies established state-machine, contract, durable-execution, and version-control mechanisms to bounded multi-role collaboration projects, connecting responsibility, execution, evidence, and release state through a four-layer product architecture and one file-based Git/LFS Workspace. Worktrees provide isolated views over commit snapshots; Framework-managed state changes support consistency, recovery, and rollback. Current records cover software development, management consulting, and structured debate. They support an engineering account of file-based multi-role collaboration, but do not validate every office or broader social-collaboration setting. Academic novelty relative to prior systems requires broader literature review and matched comparison. Future work includes the stratified evaluation in Section 7.6 and the bilingual experiment plan. No cross-scenario task-quality or hallucination effect is claimed before those measurements.

---

### Software and Data Availability Statement

The formal responsibility contracts, EFSM execution runtime, Context Map projections, Git/LFS WorkspaceRef and Join/CAS protocols, and the academic replication package reported in this paper are prepared for open-source release under the Apache-2.0 license. During peer review, an anonymized replication package is provided. Upon formal publication, the open-core repository and raw run traces will be permanently archived on Zenodo with an assigned DOI.

The replication suite includes the offline evidence verification script (`pnpm run reproduce:paper-evidence`), raw event traces (`events.ndjson`), and verification rubrics, allowing independent reviewers to verify all reported tables (Table 1, Table 2, Table 3) and cryptographic SHA-256 digests without requiring external commercial API keys. End-user enterprise application suites (e.g., the Team Site web collaboration shell) and proprietary domain roles are maintained under commercial licenses and are omitted; their omission does not affect the formal verification or reproducible findings of the core runtime protocol.

---

### References
*For full traceable citations, DOIs, publisher/arXiv pages, and official project links, see [`traceable-references.md`](traceable-references.md). Experimental sources and direct addresses are also listed in the [bilingual experiment plan](experimental-validation-plan-bilingual.md). V2 Workspace fields, events, states, and APIs are normative in [`v2-workspace-contracts.md`](../development/v2-workspace-contracts.md); collaboration behavior is defined by [`v2-workspace-collaboration-design-and-acceptance.md`](../development/v2-workspace-collaboration-design-and-acceptance.md).*
