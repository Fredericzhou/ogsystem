# OGSystem: An Event-Driven Persistent Extended Finite State Machine Runtime for Bounded Multi-Agent Collaboration and Engineering Delivery

**Author:** Fred [Your Surname]  
**Affiliation:** Independent Researcher, [City], China  
**Contact:** [your-email@domain.com]  
**ORCID:** [https://orcid.org/0009-XXXX-XXXX-XXXX]  
**Repository & Benchmark Artifacts:** [https://github.com/your-username/ogsystem]

---

### Abstract
While Large Language Model (LLM) Multi-Agent Systems (MAS) demonstrate remarkable capability in complex software tasks, enterprise production demands strict determinism, failure recovery, and auditable deliverables. Prevailing orchestration platforms (e.g., n8n, Dify, Coze Workflow) adhere to the Forward Acyclic Pipeline paradigm (fundamentally Directed Acyclic Graphs, or DAGs). Because DAGs structurally prohibit directed back-edges, they cannot natively model dialectic code reviews, iterative rework, and quorum synchronization without combinatorially unrolling graphs or degrading loops into opaque, intra-node iterations.

To bridge this fundamental gap, this paper presents **OGSystem (OGS)**, a theory-guided, persistent Extended Finite State Machine (EFSM) runtime engineered for bounded socio-technical collaboration. OGS establishes a "Role-First" ontological primitive, decoupling invariant responsibility seats from transient model executors. Transitions are governed by a Labeled Transition System (LTS) over a closed business event vocabulary. The runtime explicitly tracks an extended state tuple comprising execution frontiers, branch lineages, state-aware join scopes ($pending, arrived, skipped, failed$), and loop budget reviews under strict Fail-Closed invariants. Beyond conversational text, OGS incorporates an end-to-end artifact delivery pipeline that sandboxes, compiles, tests, and atomically seals source code into verifiable deliverables. Comprehensive regression testing across 1,228 automated test suites and real-world fault injection experiments demonstrate robust state determinism, loop termination, self-healing after abrupt partial writes, and crash consistency recovery, providing early practical alignment with the 2026 Chinese National Standards for AI Agents (GB/Z 185 / GB/Z 242).

**Keywords:** Multi-Agent Systems; Extended Finite State Machine (EFSM); Labeled Transition System (LTS); Directed Acyclic Graph (DAG); Software Deliverables; Crash Consistency; Fail-Closed Defaults.

---

### 1. Introduction and Domain Evolution

#### 1.1 The Five Milestones of LLM Engineering
The trajectory of LLM-based Software Engineering has evolved through five distinct technological milestones aimed at taming probabilistic variance into deterministic systems:
1. **Prompt Engineering (2022–2023):** Focused on micro-level lexical instructions, few-shot conditioning, and Chain-of-Thought (CoT) prompting for single-turn inferences, inherently lacking multi-step temporal stability.
2. **Context Engineering (2023):** Transitioned focus toward Retrieval-Augmented Generation (RAG) and dynamic token window management. However, in multi-agent workflows, uncurated context propagation inevitably causes severe context pollution and "needle-in-a-haystack" attention decay.
3. **Loop Engineering (2023–2024):** Introduced autonomous step-wise iteration via ReAct (Reason + Act) and Reflexion loops. While granting localized trial-and-error autonomy, unconstrained loops easily diverge into infinite token runaway and goal drift.
4. **Agent Harness Infrastructure (2024):** Realized the critical architectural decoupling of cognitive reasoning from external runtime execution (e.g., SWE-agent sandboxes, tool-calling CLI harnesses). Nevertheless, harnesses are heavily tuned for single-agent autonomy, lacking multi-role governance protocols.
5. **Graph Engineering (2024–2026):** Structured multi-agent collaboration into explicit topologies. However, dominant paradigms split into unconstrained conversational swarms (lacking formal control planes) or rigid Forward Acyclic Pipelines (DAGs, e.g., n8n, Dify, Coze Workflow). By structurally forbidding directed cycles, DAG pipelines cannot natively model iterative reviews, architectural dialectics, and rework cycles without combinatorially unrolling graphs or burying loops within opaque, single-node blackboxes.

#### 1.2 The Decadal Echo of Distributed Systems (2015–2016)
Examining current multi-agent chaos reveals a striking historical parallel: **The MAS domain in 2025–2026 is repeating the exact distributed microservices crisis of 2015–2016.**
A decade ago, point-to-point microservice choreography caused cascading failures. The software industry resolved this by formalizing declarative state machines (AWS Step Functions, 2016) and "Durable Execution with Event Sourcing" (Uber Cadence / Temporal, 2016). 
Unfortunately, the recent generative AI boom largely abandoned these battle-tested principles in favor of ad-hoc chat prompts.

#### 1.3 Trajectories and Controversies across Frontier Labs
Against this backdrop, the leading AI labs have diverged significantly in their agent orchestration philosophies:
1. **Anthropic (Claude) and the "Workflow-First" Doctrine:** In late 2024, Anthropic published its seminal guide *Building Effective Agents*, overtly challenging the industry's rush toward complex multi-agent swarms. They demonstrated that high-assurance implementations stem from "deterministic workflows over autonomous agents," formalizing patterns such as Routing, Orchestrator-Workers, and Evaluator-Optimizer. While Anthropic validated the workflow imperative, it stopped short of offering an open, mathematically proven, persistent EFSM runtime kernel.
2. **OpenAI: Assistants API and the Lightweight Swarm Experiment:** OpenAI evolved from server-side blackbox threads in its Assistants API toward the experimental *Swarm* framework (2024), pioneering "Handoffs" as functions. However, Swarm remains an unpersisted, client-side educational prototype without schema validation, state-aware joins, loop budget review gates, or recovery guarantees.
3. **Google DeepMind and the Inadequacy of the "Infinite Context" Hypothesis:** With Gemini 1.5/2.0 expanding context windows to 1M–2M tokens, an aggressive hypothesis emerged claiming that massive context windows obsolete external state machines. Recent empirical studies disprove this: long contexts suffer from severe "attention dilution" and hallucination compounding. Large context cannot substitute for explicit state transitions and Fail-Closed Context Maps.
4. **xAI (Grok) and the Limits of Monolithic Reasoning:** While xAI pushes test-time compute and real-time search within Grok models, single-model intelligence cannot replace the institutional separation of powers (Architecture $\ne$ Implementation $\ne$ Testing) mandatory in high-stakes software engineering.

#### 1.4 Positioning of OGSystem
Within this evolutionary continuum, **OGSystem (OGS) is positioned as a mission-critical, persistent Extended Finite State Machine (EFSM) coordination and delivery kernel for bounded socio-technical collaboration**.
OGS bridges the decadal divide: it integrates the durable execution and EFSM rigor of 2015–2016 with Anthropic's workflow-first ethos, modern 2026 Agent Harness sandboxes, and Chinese National Standards (GB/Z 185/242), formalizing DAG pipelines as a degenerate, cycle-free subset.

---

### 2. Paradigm Taxonomy and Structural Survey of Collaborative Systems

To formally characterize multi-agent runtimes, this section investigates frontier proprietary platforms (OpenAI Codex Multi-Agent v2, Anthropic Claude Subagents, Google Opal, LangChain LangGraph/LangSmith), emerging generalist autonomous engines (Manus, Tencent WorkBuddy), specialized multi-agent collaborative coding tools (Orca, OMP / oh-my-pi, Aider), and classic workflow pipelines (n8n, Dify, Coze).

#### 2.1 Architectural Taxonomy of Multi-Agent Collaboration
Across system topologies, communication algebras, execution boundaries, and cybernetic control planes, prevailing multi-agent systems cluster into nine formal computational paradigms, exhibiting distinct evolutionary traits in their **collaboration models, core characteristics, and underlying technology stacks**:

1. **Forward Acyclic Dataflow DAG Pipeline (e.g., n8n, Dify, Coze Workflow, Google Opal)**
   *   *Collaboration Model:* Unidirectional dataflow pipeline governed by topological partial order; upstream completion triggers one-shot downstream activation.
   *   *Key Characteristics:* Structurally prohibits directed back-edges; iterative loops are degraded to intra-node blackbox loops (`batch_map`) or unrolled offline; context accumulates globally without fail-closed field projection.
   *   *Tech Stack:* TypeScript / Python, Celery / Redis asynchronous task queues, PostgreSQL relational stores, and web canvas drag-and-drop orchestration engines.
2. **Hierarchical Tree-Forking and Subagent Delegation (e.g., Anthropic Claude Code, OpenAI Codex Multi-Agent v2)**
   *   *Collaboration Model:* Master-Worker tree invocation hierarchy; the parent agent retains full global context and dynamically forks ephemeral child subagents, collecting distilled text summaries upon completion.
   *   *Key Characteristics:* Top-down authoritarian command structure lacking institutional checks-and-balances or peer veto rights; Codex v2 introduced ciphertext delegation (`hide_spawn_agent_metadata = true`), provoking controversy over transparency and open auditability.
   *   *Tech Stack:* Node.js / Rust / Python CLI clients, JSON-RPC / Model Context Protocol (MCP) tool buses, and child process context slicing with sandbox isolation.
3. **Decentralized Handoffs Choreography (e.g., OpenAI Swarm, AutoGen GroupChat, ChatDev)**
   *   *Collaboration Model:* Uncoordinated autonomous choreography driven by point-to-point handoffs (`handoff(target)`) or dynamic LLM speaker selection.
   *   *Key Characteristics:* Agents are modelled as stateless function objects; lacks centralized state orchestration or durable server persistence, frequently suffering from conversational divergence, polite stalling, and state drift.
   *   *Tech Stack:* Pure Python libraries, OpenAI Function Calling schemas, and in-memory event dispatch loops.
4. **Terminal Multiplexer and Cross-Pane Delegation Runtime (e.g., Herdr `herdr.dev`)**
   *   *Collaboration Model:* Operating-system-level multi-agent terminal multiplexing and cross-pane delegation runtime ("tmux for AI coding agents").
   *   *Key Characteristics:* A persistent background daemon manages pane lifecycles and provides rich cross-pane IPC primitives (`hc run --bg`, `hc send`, `hc wait`, `hc read`); leverages ANSI OSC 7501 escape protocols to sense agent states (`working/blocked/done/idle`).
   *   *Tech Stack:* High-performance Rust daemon (`herdr-core`), Unix Domain Sockets, OpenRPC interface schema, PTY/TTY terminal multiplexer drivers, and ANSI status extensions.
5. **Worktree-Isolated Terminal Fleet Bus (e.g., Orca `onorca.dev`)**
   *   *Collaboration Model:* File-bus and terminal fleet architecture physically isolated via Git worktrees.
   *   *Key Characteristics:* Allocates an isolated Git worktree, dedicated terminal session, and headless browser to each task, eliminating concurrent write collisions and merge conflicts at the filesystem level; relies on CLI pipes for inter-agent relay.
   *   *Tech Stack:* Node.js / TypeScript CLI, Git Worktree engine, OS stdio pipe redirection, and Playwright headless browser test harnesses.
6. **Role-Based Model Dispatcher with Companion Advisor (e.g., OMP / oh-my-pi `omp.sh`)**
   *   *Collaboration Model:* Compute-tagged model router with streaming background companion monitoring.
   *   *Key Characteristics:* Re-defines "roles" as compute allocation profiles mapped to heterogeneous models (`plan/slow/task/advisor`); incorporates streaming background audits and dedicated P0–P3 review subagents; achieves extraordinary single-workstation efficiency.
   *   *Tech Stack:* High-performance Rust, Hashline compact line-hash diffing engine, Tree-sitter incremental syntax parsing, and embedded LSP/DAP protocols.
7. **Pub-Sub Blackboard / Message Pool (e.g., MetaGPT, OpenHands)**
   *   *Collaboration Model:* Asynchronous publish-subscribe blackboard architecture structured around Standard Operating Procedures (SOPs).
   *   *Key Characteristics:* Agents publish structured actions and code artifacts to a shared pool; downstream agents subscribe based on declared preconditions; robust structure but rigid topological evolution.
   *   *Tech Stack:* Python asynchronous runtimes, Docker container sandboxes, Pydantic-enforced schemas, and event queues.
8. **Imperative Cyclic StateGraph (e.g., LangChain LangGraph + LangSmith)**
   *   *Collaboration Model:* Programmatic directed cyclic state graphs with conditional edge dispatch.
   *   *Key Characteristics:* Allows arbitrary directed cycles; context flows via permissive shared state dictionaries (State Dict); prioritized for runtime observability (nested traces) and human approval breakpoints.
   *   *Tech Stack:* Python / TypeScript, LangSmith distributed telemetry and evaluation tower, and PostgreSQL / Redis / SQLite state checkpoint stores.
9. **Role-First Persistent EFSM over LTS (e.g., OGSystem, Ours)**
   *   *Collaboration Model:* Closed Directed Graph ($DAG \subset EFSM$), decoupling invariant socio-technical Responsibility Seats ($V$) from transient model executors ($\rho$).
   *   *Key Characteristics:* Transitions driven by a closed LTS discrete business event dictionary ($\Sigma_{\text{fixed}}$); persistent full-element state tuple $\mathbf{X}$; Fail-Closed Context Map field-level projections; lineage-bound loop budgets with CAS human review pause; sandbox verification and atomic deliverable promotion.
   *   *Tech Stack:* Compiled TypeScript / Node.js runtime, restricted Mermaid Semantic IR compiler (v1), append-only Write-Ahead Log (`events.ndjson`), atomic snapshot commit (CAS `state.json`), Sandbox Verifier (npm/pytest), and dual-studio architecture (OGS Studio & OGS Projects).

#### 2.2 Structural Comparison Matrices
Table 1 provides a structural comparison across frontier lab platforms and generalist architectures. Table 2 provides a specialized breakdown of collaborative coding engines, contrasting their **collaboration models, isolation boundaries, IPC mechanisms, role ontologies, loop governance, delivery verification, and underlying technology stacks**.

| Structural Dimension | **OpenAI Codex v2 / Swarm** | **Anthropic Subagents / Claude Code** | **Google Opal (Agent Mode)** | **LangGraph + LangSmith** | **Manus / Tencent WorkBuddy** | **OGSystem (This Work)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Node Primitive** | Ephemeral thread / Stateless function | Task subagent | Visual pipeline block / Adaptive prompt step | Arbitrary Python state computation node | Virtual OS process / Desktop expert pool | **Abstract Responsibility Seat ($V$)** |
| **2. Topology & Transition** | Tree-forking / Ad-hoc function handoffs | Tree-forking & tool-runner aggregation | Forward flow + dynamic step expansion | Custom conditional edge jumping | Task queue dispatch / Monolithic reflection | **LTS over Closed Event Alphabet ($\Sigma_{\text{fixed}}$)** |
| **3. State & Persistence** | In-memory thread / Client polling (no WAL) | Local session cache / Session compaction | Bound to Google Drive workspace files | Checkpoint snapshots / LangSmith thread traces | Cloud VM snapshot / Local desktop SQLite | **Persistent Extended Tuple $\mathbf{X}$ (WAL + CAS + Digests)** |
| **4. Data Boundaries** | Ciphertext delegation or full thread context | Subagent summary return (partial isolation) | Shared workspace document context | Permissive shared dictionary (developer-enforced) | Shared filesystem / Monolithic memory accumulation | **Fail-Closed Context Map (Strict field projections)** |
| **5. Loop & Governance** | Hard-coded concurrency cap (no loop FSM) | Interactive question (`AskUserQuestion`) | Clarifying chat dialogs | Human breakpoints (`interrupt_before`) | Timeout abort / Monolithic retry loops | **Lineage-Bound Loop Budget ($maxIterations \to$ CAS Pause)** |
| **6. Deliverable Pipeline** | Terminal edits / Git PR patch | Local file I/O / Terminal command execution | Generated Drive docs / Google Sheets | Raw streaming text / Custom sink writes | End-to-end web apps, slides, financial reports | **Opaque ArtifactRef $\to$ Sandbox Verifier $\to$ Atomic Promotion** |
| **7. Audit & Transparency** | Controversial: v2 ciphertext delegation hides metadata | Transparent terminal and tool execution logs | Cloud blackbox execution telemetry | High: LangSmith nested traces & evaluations | Cloud session screen recordings / CLI logs | **Constitutional Append-Only Log (`events.ndjson`) & Dual View** |
| **8. Underlying Tech Stack** | Python / Rust clients + proprietary protocol | Node.js / Rust CLI + MCP tool bus | Google Workspace API + Web Canvas | Python/TS + LangSmith + Postgres/Redis | Sandboxed Linux VM + Playwright headless engine | **Compiled TS/Node.js + Semantic IR + WAL/CAS + Sandbox Verifier** |
| **4. Data Boundaries** | Ciphertext delegation or full thread context | Subagent summary return (partial isolation) | Shared workspace document context | Permissive shared dictionary (developer-enforced) | Shared filesystem / Monolithic memory accumulation | **Fail-Closed Context Map (Strict field projections)** |
| **5. Loop & Governance** | Hard-coded concurrency cap (no loop FSM) | Interactive question (`AskUserQuestion`) | Clarifying chat dialogs | Human breakpoints (`interrupt_before`) | Timeout abort / Monolithic retry loops | **Lineage-Bound Loop Budget ($maxIterations \to$ CAS Pause)** |
| **6. Deliverable Pipeline** | Terminal edits / Git PR patch | Local file I/O / Terminal command execution | Generated Drive docs / Google Sheets | Raw streaming text / Custom sink writes | End-to-end web apps, slides, financial reports | **Opaque ArtifactRef $\to$ Sandbox Verifier $\to$ Atomic Promotion** |
| **7. Audit & Transparency** | Controversial: v2 ciphertext delegation hides metadata | Transparent terminal and tool execution logs | Cloud blackbox execution telemetry | High: LangSmith nested traces & evaluations | Cloud session screen recordings / CLI logs | **Constitutional Append-Only Log (`events.ndjson`) & Dual View** |

*Table 1: Structural Comparison of Global Frontier Multi-Agent Systems and OGSystem.*

For dedicated software engineering and collaborative code generation, Table 2 contrasts OGSystem with prevailing multi-agent coding engines:

| Structural Dimension | **Orca (StablyAI)** | **Herdr (HerdrDev)** | **OMP (oh-my-pi / omp)** | **Aider (Architect/Editor)** | **OGSystem (This Work)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Collaboration Model** | **Worktree-Isolated Terminal Fleet Bus** | **Terminal Multiplexer & Cross-Pane Delegation** | **Role-Based Model Dispatcher & Subagent Review** | **Paired Architect-Editor Ping-Pong** | **Role-First Persistent EFSM over LTS** |
| **Execution Boundary** | Physical: Dedicated **Git Worktree**, terminal, and browser per agent | Window & Daemon: Persistent `herdr-core` daemon, multiple panes & tabs | Logical: In-process context slicing, local shell execution | Shared workspace: Main branch, in-memory prompt role handoffs | Isolated: Dedicated Sandbox Workspace & clean staging dirs |
| **Agent IPC Mechanism** | CLI command stream: `orca terminal send`, `orca terminal wait` | Cross-pane primitives: `hc run --bg`, `hc send`, `hc wait`, `hc read`, and OpenRPC socket | Memory dispatch: `task` subagents, streaming `advisor` listener | Prompt alternation: Architect outputs spec, Editor applies diff | **LTS Discrete Business Events** ($\Sigma_{\text{fixed}}$) & Typed Data |
| **Role Ontology** | Transient CLI execution processes / Terminal sessions | Subordinate agent processes hosted in terminal panes | **Model routing configuration tags** (`plan`/`slow`/`task`/`advisor`) | Static two-party prompt roles (Thinker vs. Doer) | **Formal Responsibility Seats $V$** (Decoupled from executors $\rho$) |
| **Context Boundary Control** | Plain terminal output pipes, lacking field-level gating | Cross-pane plain text injection & terminal output scraping | Parent-child task summaries, prompt-based convention | Full chat history & file tree loading (context dilution) | **Fail-Closed Context Map**: Undeclared fields/files strictly abort |
| **Loop & State Governance** | Task DAGs or manual CLI relay, no formal loop budget | ANSI **OSC 7501 protocol** (`working`/`blocked`/`done`), no formal state machine loop budget | Runtime step limits and timeout cutoffs, no EFSM loop recovery | Single-turn chat iterations, interactive human confirmation | **Lineage-Bound Quotas** ($maxIterations$) with CAS Human Review |
| **Deliverable Verification** | Relies on manual Git branch merging and PR reviews | Relies on agent terminal runs and git changes, no sandbox promotion pipeline | Native LSP syntax checks, dedicated `/review` P0–P3 triage | Automated local test command (`test-cmd`), Git reset on fail | **Opaque ArtifactRef $\to$ Sandbox Verifier $\to$ Atomic Store** |
| **Crash Consistency** | Relies on raw Git commits and terminal scrollback | Relies on daemon socket reconnect and scrollback cache, no WAL | In-memory session reconnect, lacking formal WAL | Relies on `.aider.chat.history.md` and Git revert | **WAL (`events.ndjson`) + CAS Commits + Semantic Fingerprints** |
| **Underlying Tech Stack** | Node.js / CLI + Git Worktree + Headless Browser | Rust (`herdr-core`) + Unix Domain Socket + OpenRPC + ANSI OSC 7501 | High-performance Rust + Hashline diff engine + embedded LSP/DAP + Tree-sitter | Python + Tree-sitter AST repo-map + Git Diff engine | **TypeScript/Node.js + Semantic IR + WAL/CAS + Sandbox Verifier** |

*Table 2: Deep Comparison of Collaborative Coding Software Architectures.*

#### 2.3 Structural Differentials and Comparative Analysis

##### (1) Topological Structure Comparison: Graph Theory, Visual Archetypes, and Confluence Algebras
Multi-agent runtimes are fundamentally **Graph-Theoretical Models**. Topology mathematically dictates authority distribution, concurrency, dialectical back-edges, and halting convergence:

```text
[1. Forward DAG Pipeline]     [2. Hierarchical Tree-Forking]      [3. Dynamic Mesh Choreography]
  A ──► B ──► C ──► End             Master Coordinator               Agent A ◄────► Agent B
        │       ▲                   │                │                  ▲  \        /  ▲
        └── D ──┘             Child Sub 1      Child Sub 2              │   ▼      ▼   │
  (Strictly Acyclic)          (Authoritarian, no peer veto)          Agent C ◄────► Agent D
                                                                     (Dynamic P2P, deadlocks)

[4. Flat Fleet Bus / Panes]                  [5. Role-First Closed Directed Graph (OGSystem)]
  Daemon / IPC Bus                                       Seat V1 (Architect)
  ══╦════════╦════════╦════════╦══                              │ APPROVED (LTS Event)
    ▼        ▼        ▼        ▼                                ▼
  Pane 1   Pane 2   Pane 3   Pane 4                      ┌──────┴──────┐
  (No inner graph; OS scheduled)                         ▼             ▼
                                                    Seat V2       Seat V3
                                                         │             │ READY
                                                         └──────┬──────┘
                                                                ▼
                                                      State-Aware Join Scope
                                                         (all_of / quorum)
                                                                ▼
                                                         Seat V4 (Reviewer)
                                                                │
                                               ┌────────────────┴────────────────┐
                                               │ NEEDS_REWORK (Bounded Back-Edge)│ APPROVED
                                               ▼                                 ▼
                                        [Loop Budget]                     [Deliverable]
                                        iter <= maxIter ? Rewind : CAS Pause
```

*   **Forward DAG Pipeline (Strict Partial Order):** Enforces $u \prec v$. Structurally prohibits directed back-edges; iterative rework is forced into intra-node blackbox loops or unrolled combinatorially, destroying top-level dialectical governance.
*   **Tree-Forking Topology ($Tree$ where $|E|=|V|-1$):** Master coordinator forks ephemeral workers and aggregates summaries. Authoritarian dominance prevents institutional parity (e.g., an automated tester cannot assert a topological veto against an architect's specification).
*   **Mesh Choreography ($K_n$ Dynamic Graph):** P2P function handoffs (`handoff(target)`) without centralized invariant enforcement, frequently diverging into conversational oscillation, polite stalling, and state drift.
*   **Flat Array / Bus / Panes ($1 \times N$):** Operating system-level worktrees or terminal multiplexer panes without endogenous graph semantics, delegating coordination to external shell scripts or manual operators.
*   **Role-First Closed Directed Graph (OGSystem, $DAG \subset EFSM$):** Nodes represent invariant responsibility seats ($V$), transitions are governed by discrete LTS business events ($\Sigma_{\text{fixed}}$), bounded back-edges are constrained by quotas ($maxIterations$), and confluence is governed by **State-Aware Join Scopes** ($S_{\text{src}} \in \{pending, arrived, skipped, failed\}$).

##### (2) Collaborative Coding Software: Worktree Bus (Orca), Terminal Multiplexer (Herdr), and Model Dispatcher (OMP) vs. Role-First EFSM (OGSystem)
*   **Orca's Physical Worktree Isolation:** Orca addresses the physical conflict problem in multi-agent coding by allocating an isolated Git worktree, dedicated terminal, and browser tab to each task, coordinating agents through CLI IPC (`orca terminal send/wait`). While effective as an operating environment harness, Orca functions as an external container orchestrator; inter-agent communication remains unstructured terminal text, lacking formal state transition semantics, typed context maps, or compile-time verification.
*   **Herdr's Terminal Multiplexer and Cross-Pane Delegation:** Herdr (`herdr.dev`) positions itself as "tmux for AI agents," providing a persistent background daemon (`herdr-core` / `hc`) that multiplexes agents across terminal panes, tabs, and worktrees. It introduces rich cross-pane delegation primitives (`hc run --bg`, `hc send`, `hc wait`, `hc read`), an OpenRPC socket API, and leverages the ANSI OSC 7501 status protocol to surface agent states (`working`, `blocked`, `done`, `idle`). Herdr excels as an operating system harness for multi-agent visual terminals, but remains an infrastructure multiplexer: cross-pane interactions are unconstrained plain-text streams, lacking business-level state machine formalisms, fail-closed data projections, and sandbox deliverable promotion.
*   **OMP's Role-Based Model Routing:** OMP (`can1357/oh-my-pi`) optimizes single-workstation CLI efficiency by mapping "roles" to heterogeneous model routing profiles (e.g., routing `plan` to heavy reasoning models, `slow` to reflective models, `task` to concurrent subagents, and `advisor` to streaming background monitors). Combined with Hashline edits and in-process LSP, OMP achieves remarkable token thrift. However, its "roles" are compute allocation profiles rather than socio-technical responsibility seats; it lacks persistent Write-Ahead Logging, state-aware join scopes, and compile-time context boundaries.
*   **OGSystem's Role-First EFSM:** OGS formalizes roles as invariant responsibility seats ($V$), decoupling accountability from model executors ($\rho$). Interactions are strictly mediated by LTS event transitions, data transfer is governed by Fail-Closed Context Maps, and generated code undergoes sandbox verification before atomic promotion.

##### (3) Transparency: Ciphertext Delegation vs. Constitutional Audit Chains
*   **The OpenAI Codex v2 Controversy:** Codex v2 introduced encrypted delegation metadata (`hide_spawn_agent_metadata = true`) and a proprietary `agent_message` response format, hiding inter-agent interactions from engineers and hindering integration with third-party open-source models.
*   **OGSystem's Transparent Governance:** OGS enforces a constitutional audit invariant (Rule 3.12). All handoffs are structured in plain text and recorded in an append-only Write-Ahead Log (`events.ndjson`). Every governance intervention is bound to explicit `reviewId` and monotonic state versions, guaranteeing causal traceability.

##### (4) Context Boundaries: Unrestricted Traversal vs. Fail-Closed Projections
*   In Google Opal, Orca, and standard DAG pipelines, context is either concatenated over turns or freely accessible through shared workspaces and global dictionaries.
*   **OGSystem's Context Maps:** Downstream seats receive only explicitly projected fields declared in flow contracts. Access to undeclared memory or unauthenticated file paths triggers immediate execution abortion (Fail-Closed), mathematically eliminating attention dilution and prompt injection escalation.

##### (5) Software Delivery Engineering: Loose Overwrites vs. Opaque Sealed Artifacts
*   Conventional coding agents overwrite repository files in place. If compilation fails or loops diverge, the codebase is left corrupted.
*   **OGSystem's Promotion Pipeline:** Model outputs reference files solely through Opaque ArtifactRefs within isolated staging workspaces. Only code passing comprehensive verifiers (linting, compilation, unit tests) is atomically promoted into the permanent `Deliverable Store`.

##### (6) Underlying Tech Stacks and System IPC Protocols: CLI Pipes, Unix Sockets, LSP, and Durable WAL
*   **Orca (CLI stdio Pipes):** Relies on standard OS streams (`stdin`/`stdout`) and signals for inter-agent relay (`orca terminal send/wait`). Highly ubiquitous across CLI tools, but prone to format drift, ANSI noise, and unstructured stream degradation.
*   **Herdr (Rust Daemon + Unix Domain Socket OpenRPC + ANSI OSC 7501):** Utilizes a persistent Rust daemon (`herdr-core`) managing PTY sessions, exposing an OpenRPC JSON-RPC interface over Unix domain sockets, and using ANSI OSC 7501 terminal escapes to capture real-time agent lifecycle states (`working/blocked/done/idle`). Represents the peak of OS-level terminal multiplexing harnesses, though inter-agent payloads remain untyped terminal text without business state algebra.
*   **OMP (Rust In-Process Dispatch + Hashline Edits + LSP/Tree-sitter):** Leverages Rust's speed and Tree-sitter's incremental AST parsing alongside embedded Language Server Protocols (LSP) and DAP. Introduces Hashline compact line-hash diffing to drastically cut token consumption during code modifications. Unmatched single-seat developer efficiency, yet lacks distributed durable execution or cross-seat join governance.
*   **OGSystem (Compiled TypeScript Engine + Semantic IR + LTS Events + WAL/CAS + Isolated Verifier):** Operates as a lightweight, daemonless Node.js/TypeScript engine directly executing compiled Semantic IR. Inter-seat coordination is mediated through strongly typed discrete LTS events ($\Sigma_{\text{fixed}}$) and Fail-Closed Context Maps. State transitions follow enterprise database semantics: appended to an append-only Write-Ahead Log (`events.ndjson`) prior to CAS state snapshot commits (`state.json`). Code outputs undergo sandbox verification (running test suites) before atomic promotion, establishing full deterministic auditability.

##### (7) Theoretical Principles, National Standards, and Empirical Grounding
To guarantee that every design decision is **mathematically sound, standards-compliant, and empirically grounded**, the table below aligns OGSystem's foundational principles with classic computer science literature, China's 2026 National AI Agent Standards (GB/Z), and empirical lessons from frontier platforms:

| Foundational Principle / Structural Claim | Formal CS Literature Baseline (DOI / Citation) | China 2026 National Standards Alignment (GB/Z) | Frontier Industry Empirical Lessons Learned |
| :--- | :--- | :--- | :--- |
| **Principle 1: Socio-Technical Seat Invariance**<br>($V$ 6-tuple decoupling from executor $\rho$) | Milner 1989 (LTS Concurrency Algebra)<br>Meyer 1992 (Design by Contract, DOI: [10.1109/2.161279](https://doi.org/10.1109/2.161279)) | **GB/Z 185.1—2026** §5.2 (Agent Role Abstract Architecture)<br>**GB/Z 185.4—2026** (Agent Descriptions & Capabilities) | Resolves OMP / ChatDev flaw of treating roles as transient prompts/tags, restoring organizational accountability. |
| **Principle 2: LTS Discrete Business Transitions**<br>($\Sigma_{\text{fixed}}$ closed event vocabulary) | Milner 1989 (LTS, ACM 1989)<br>Newman 2015 (*Building Microservices*, O'Reilly) | **GB/Z 185.6—2026** §6.3 (Discrete Agent Interaction Protocols) | Overcomes conversational divergence, polite stalling, and state drift inherent in Swarm / AutoGen natural language handoffs. |
| **Principle 3: Full-Element Persistent Tuple**<br>($\mathbf{X}$ state vector + WAL + CAS commits) | Cheng & Krishnakumar 1993 (EFSM, DAC '93)<br>Gray & Reuter 1992 (*Transaction Processing*, Turing Award) | **GB/Z 242—2026** §6.4 (Checkpointing & Crash State Recovery)<br>**GB/Z 185.1—2026** §7.1 (State Persistence Requirements) | Incorporates Uber Cadence / Temporal durable execution, eliminating crash inconsistency found in Claude Code / LangGraph. |
| **Principle 4: Bounded Cycles & CAS Review Breakpoints**<br>($Iteration \le Budget \to$ CAS Pause) | Alshiekh et al. 2024 (*Safe Execution via Runtime Monitors*)<br>Lee & Yannakakis 1996 (*FSM Testing Survey*, IEEE) | **GB/Z 242—2026** §5.3 (Planning Safety Boundaries & Circuit Breakers)<br>**GB/Z 185.6—2026** §8.2 (Turn Limits & Human Intervention) | Overcomes DAG acyclic paralysis while preventing runaway infinite loops and token burnouts in AutoGen / Swarm. |
| **Principle 5: State-Aware Confluence Scopes**<br>($S_{\text{src}} \in \{pending, arrived, skipped, failed\}$) | van der Aalst et al. 2003 (*Workflow Patterns*, DOI: [10.1023/A:1022883727209](https://doi.org/10.1023/A:1022883727209)) | **GB/Z 185.1—2026** §6.4 (Branch Confluence & State Synchronization) | Enforces Fail-Closed invariant: upstream branch crashes cannot be silently downgraded to `skipped`, preventing silent deadlocks. |
| **Principle 6: Fail-Closed Context Projections**<br>(Context Map strict gating; undeclared aborts) | Saltzer & Schroeder 1975 (*Fail-safe Defaults Axiom*, IEEE, DOI: [10.1109/PROC.1975.9939](https://doi.org/10.1109/PROC.1975.9939)) | **GB/Z 185.7—2026** §7.2 (Least Privilege for Tool & Data Access) | Prevents attention dilution and prompt injection escalation common in Google Opal and Orca shared workspaces. |
| **Principle 7: Isolated Sandbox Verifier Promotion**<br>(Opaque ArtifactRef $\to$ Verifier $\to$ Store) | Yang et al. NeurIPS 2024 (*SWE-agent: Sandboxed SE*)<br>Jimenez et al. 2023 (*SWE-bench*) | **GB/Z 242—2026** §7.1 (Automated Deliverable Verification & Sealing) | Replaces dirty overwrites with isolated test execution, elevating probabilistic code generation to certified software assets. |
| **Principle 8: Constitutional Append-Only Audit**<br>(Append-only `events.ndjson` auditability) | Gray & Reuter 1992 (Write-Ahead Logging)<br>Saltzer & Schroeder 1975 (Open Design Axiom) | **GB/Z 185.3—2026** §8 (Inter-Agent Audit Logging & Anti-Tampering) | Rejects OpenAI Codex v2 ciphertext delegation (`hide_spawn_agent_metadata`), guaranteeing end-to-end causal transparency. |

##### (8) Superset Relation: Subsuming DAG Pipelines ($DAG \subset EFSM$)
Conventional DAG platforms (n8n, Dify, Coze) enforce single-activation, acyclic constraints, forcing iterative loops into opaque intra-node scripts or combinatorial unrolling. By combining EFSM state tuples with LTS event routing and bounded loop budgets, **OGSystem mathematically subsumes DAG pipelines as a degenerate acyclic subset while providing formal guarantees for cyclic multi-role collaboration.**

---

### 3. System Design and Compilation Pipeline

#### 3.0 Industry Homogenization Traps vs. OGSystem Eight Non-Homogenized Breakthroughs
Contemporary MAS research and products predominantly fall into the trap of *"Agent as prompt, state as conversation, orchestration as unconstrained handoffs, and delivery as in-place dirty overwrites"*. OGSystem deliberately departs from these brittle patterns with eight non-homogenized architectural breakthroughs (Table 2.5):

| Architectural Dimension | Industry Homogenized Patterns | OGSystem Non-Homogenized Breakthroughs |
| :--- | :--- | :--- |
| **1. Node Ontology** | **"Agent = Model + System Prompt + Memory"**<br>Replacing a model alters identity; nodes lack institutional authority boundaries; essentially ephemeral chatbots. | **"Role-First Responsibility Seat" Ontology**<br>Seats $V$ are immutable organizational assets with contractual obligations; models/executors $\rho$ are transient, interchangeable workers. |
| **2. Control Algebra** | **Natural Language Handoffs or Arbitrary Strings**<br>Routing via generated calls like `handoff_to("reviewer")`; vulnerable to hallucinated routing, drift, and polite stalling. | **Labeled Transition System (LTS) Discrete Event Calculus**<br>Control is strictly restricted to a closed dictionary ($\Sigma_{\text{fixed}}$); domain data is typed, guaranteeing mathematical closedness. |
| **3. Context Security** | **Unordered Context Accumulation / Open Shared Dicts**<br>All nodes share chat history or a global StateDict; triggers severe Attention Dilution and prompt injection vulnerabilities. | **Fail-Closed Field-Level Context Map Projection**<br>Only explicitly declared whitelist fields cross boundaries; undeclared fields are physically blocked (Saltzer-Schroeder Least Privilege). |
| **4. Concurrency Join** | **Stateless Indegree Counters (`Promise.all`)**<br>Simple barrier wait; a branch failure either deadlocks execution or silently drops missing data. | **4-Valued State-Aware Join Scope & Anti-Downgrade**<br>Explicitly tracks $S_{\text{src}} \in \{pending, arrived, skipped, failed\}$; strictly forbids rewriting `failed` to `skipped`; quorum fires exactly once. |
| **5. Loop Convergence** | **Unbounded Infinite Recursion or DAG Back-edge Bans**<br>Either back-edges are banned (no real review), or agents loop infinitely burning tokens; approvals lack state binding. | **Lineage-Bound Budget & CAS 5-Tuple Review Tokens**<br>Cycles bound by $maxIterations$; over-budget triggers CAS pause; reviews bound to $\langle reviewId, round, lineageId, branchId, stateVersion \rangle$; infra failure compensations. |
| **6. Artifact Delivery** | **Direct In-Place Dirty Overwriting of Workspaces**<br>LLM writes directly to the repository; syntax errors, test failures, or crashes leave the codebase corrupted. | **Three-Stage Opaque Artifact Promotion Pipeline**<br>`Opaque ArtifactRef` $\to$ Staging Sandbox Verification (`ArtifactVerifier`) $\to$ Seal Manifest Atomic Promotion; zero dirty writes. |
| **7. Socio-Technical Form** | **Monolithic Canvas or Pure Python Code**<br>Either design-time templates and run-time instances are conflated on a low-code canvas, or code lacks visual auditability. | **Two-Tier Workbench (OGS Studio vs. OGS Projects)**<br>Physical decoupling of Studio (DSL modeling, IR compilation, simulation assertions) and Projects (immutable packages, runs, review tickets, deliverables). |
| **8. Crash Consistency** | **Coarse History Serialization or Replay from Scratch**<br>Recovery requires expensive prompt replay with nondeterministic divergence, or dumps untyped memory heaps. | **Dual-Layer WAL + CAS + SHA-256 Semantic Fingerprint**<br>Facts to WAL (`events.ndjson`), snapshots via CAS (`state.json`); resumes verify graph topology SHA-256 hashes for millisecond deterministic recovery. |

*Table 2.5: Comparison between industry homogenized patterns and OGSystem's eight non-homogenized breakthroughs.*

#### 3.1 The Role-First Socio-Technical Model
OGS models human-agent collaboration as a 6-tuple:
$$R = (V, E, \rho, \tau, \kappa, \alpha)$$
*   **$V$ (Responsibility Seats):** Invariant accountability boundaries within an organization (e.g., `Architect`, `Tester`), completely orthogonal to transient LLM executors.
*   **$E$ & $\tau$ (Handoffs & Discrete Events):** Directed flows governed by a Labeled Transition System (LTS) over a closed vocabulary: $\Sigma_{\text{fixed}} = \{\text{READY}, \text{APPROVED}, \text{REJECTED}, \text{NEEDS\_REWORK}, \text{BLOCKED}\}$.
*   **$\kappa$ (Flow Contracts & Context Map):** Downstream nodes receive only explicitly projected fields via declared Context Maps; undeclared memory traversal is rejected (Fail-Closed).
*   **$\alpha$ (Governance Policy):** Formally separates worker execution ($\rho$) from supervisor control authorities ($\alpha$, e.g., budget grants, aborts).

#### 3.2 Compilation and Fail-Closed Invariants
User-defined Mermaid topologies (`system.mmd`) compile into **Semantic IR v1**. The compiler enforces three non-negotiable invariants:
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
*   **All-of Join:** Fires if and only if $\forall u \in \text{Sources}, S_{\text{src}}(u) = \text{arrived}$.
*   **Quorum-of Join ($K$):** Fires when at least $K$ unique sources arrive.
*   **No Silent Downgrade:** If any source fails ($S_{\text{src}} = \text{failed}$), it is strictly prohibited from mutating to $\text{skipped}$; the join aborts or halts closed.

#### 4.3 Bounded Loop and Budget Review
When an iterative rework event (e.g., `NEEDS_REWORK`) exceeds $maxIterations$, the runtime raises `loop_exhausted` and enters `waiting_review`. A human supervisor must authenticate a lineage-bound decision (`continue`, `rework`, or `terminate`) protected by CAS version matching.

#### 4.4 Write-Ahead Logging (WAL) and Crash Consistency
Transitions commit to `events.ndjson` before updating `state.json`. Resuming an interrupted Run enforces an exact hash match between the frozen plan fingerprint and the current disk definition, preventing speculative recovery under semantic drift.

---

### 5. Artifact Verification and Delivery Pipeline

OGS guarantees a clean progression from raw generated text to sealed software deliverables:
1. **Opaque ArtifactRef:** Model outputs reference generated files exclusively via opaque descriptors (relative path, MIME type, SHA-256 hash), preventing filesystem path traversal.
2. **Sandbox Verifier:** Candidate files undergo automated compilation and unit testing (`npm test`, `pytest`) within isolated workspaces.
3. **Atomic Promotion:** Verified files are sealed via a manifest and atomically promoted to the project's permanent `Deliverable Store`, completely segregated from ephemeral execution logs.

---

### 6. Engineering Implementation: Dual Workbenches

OGS is implemented as a lightweight, zero-daemon TypeScript runtime featuring two decoupled environments:
*   **OGS Studio:** Dedicated to workflow authoring, visual graph projection, and dual simulation (`dry-run` for fast topological validation; `sandbox` for isolated model calls). Baseline scenario assertions gate version releases (`team-v2`).
*   **OGS Projects:** Dedicated to business operations, mounting released immutable team packages, scheduling tasks, maintaining isolated Run workspaces (`.ogs/runs/<runId>/`), and archiving verified deliverables.

---

### 7. Empirical Engineering Verification and Standards Alignment

To rigorously and truthfully validate the system's design invariants and resilience, OGSystem implements an exhaustive end-to-end automated test suite built natively on the Node.js test runner (`node:test`). All metrics and behaviors reported below are grounded directly in executable test suites within the open-source repository, without synthetic simulation:

#### 7.1 Automated Test Suite and Invariant Coverage
The codebase contains **1,228 automated regression tests**, providing full lifecycle verification across the runtime kernel, compilation pipeline, storage layers, and dual workbenches (Table 3):

| Subsystem / Test Suite | Test Count | Verified Design Invariants & Behaviors | Pass Rate |
| :--- | :--- | :--- | :--- |
| **Core Runtime & State Machine (`tests/`)** | 753 tests | • Closed LTS discrete event dictionary validation (`business-events.test.mjs`)<br>• Fail-Closed Context Map whitelist field projection (`context-selector.test.mjs`)<br>• 4-valued join convergence and anti-downgrade invariants (`transition-orphan-join.test.mjs`)<br>• Loop budget exhaustion and CAS human review pause (`loop-budget-review.test.mjs`)<br>• Artifact sandbox verification and SealManifest promotion (`artifact-promotion.test.mjs`) | 752 passed<br>(1 environment-skipped) |
| **Business Platform & Studio (`apps/team-site/tests/`)** | 475 tests | • Two-tier physical decoupling & immutable package sealing (`team-version-lifecycle-use-cases.test.mjs`)<br>• Isolated task workspaces and Run directories (`task-execution-use-cases.test.mjs`)<br>• Deliverable store physical archiving & tamper-proof reads (`file-deliverable-store.test.mjs`)<br>• Studio simulation run & baseline scenario assertions (`studio-simulation-use-cases.test.mjs`) | 475 passed |
| **Total System** | **1,228 tests** | **End-to-end coverage across compilation, execution, storage, and delivery** | **99.9% pass rate** |

*Table 3: Comprehensive automated regression test suite and invariant verification metrics.*

#### 7.2 Fault Injection and Crash Consistency Verification
The system incorporates executable fault injection suites in `tests/runtime-fault-injection.test.mjs` and `task-run-recovery-faults-uat.test.mjs`:
1. **Crash After Execution Outcome:** Leveraging the test hook `OGSYSTEM_TEST_CRASH_AFTER_EXECUTION_OUTCOME=1`, the runtime triggers an abrupt child process termination (Exit Code 91) at the critical boundary where a role outcome has been produced but state transitions are in-flight. The resumption suite (`run resume <runId>`) verifies that the system self-heals via buffered append recovery, reliably clears process lockfiles (`RESUME_RUN_LOCK_FILE`), and resumes without state corruption.
2. **Semantic Fingerprint Matching:** Resumption strictly enforces plan fingerprint matching via `plan-fingerprint.ts`. The test suite verifies that modifying `system.mmd` or model runtime configurations out-of-band while paused immediately triggers an integrity rejection, preventing corrupt or speculative execution under semantic drift.

#### 7.3 Boundary Security and Contract Interception
1. **Context Map Invariant:** Tests in `tests/optional-context-projection.test.mjs` confirm that undeclared upstream context variables are physically excluded from downstream role inputs.
2. **Artifact Sandbox Security:** Tests in `tests/workspace-and-verifier.test.mjs` assert that symbolic links, path traversals (e.g., `../`), or files exceeding byte quotas immediately throw `ARTIFACT_SYMLINK_NOT_ALLOWED` or `ARTIFACT_PATH_INVALID`, halting closed.
3. **National Standards Alignment (GB/Z 2026 Series):** OGSystem aligns directly with the 2026 Chinese National Standard Guiding Technical Documents: **GB/Z 185.6** (discrete interaction events and joins), **GB/Z 185.7** (tool boundaries and structured errors), and **GB/Z 242** (execution checkpointing and fault recovery).

---

### 8. Conclusion and Future Work

OGSystem demonstrates that transitioning multi-agent systems from ad-hoc prototypes to reliable industrial reality requires formal control models. By pairing Role-First abstractions with LTS event routing, state-aware joins, bounded loops, and artifact verification pipelines, OGS solves the cyclic coordination challenges inherent in multi-agent collaboration. Future work will extend the EFSM core to distributed multi-host execution via Raft consensus and FRAI-compliant cross-organizational agent federation.

---

### References
*For full traceable citations, DOIs, and official links, see `traceable-references.md`.*
