# OGSystem V2 Literature-Grounded Experimental Design & Evaluation Harness
# 基于前沿文献对标的 OGSystem V2 实验设计与评测方案

> **Status / 状态:** Executable benchmark specification and protocol harness design.  
> **Evidence Discipline / 证据纪律:** Deterministic protocol benchmarks (`--mode=deterministic`) validate framework invariants and scoring pipelines at $0 API cost; live LLM empirical claims require executing the pinned `--mode=live-llm` Pilot & Main Study across real models. Never conflate deterministic harness scores with live-model task accuracy.

> **Current-paper boundary (v3):** This document is a literature-grounded design catalogue, not the frozen protocol for the current submission. The current paper uses the narrower five-task v3 protocol in [`paper-experiment-master-plan.md`](paper-experiment-master-plan.md): A/B1/B2/C only, hidden tests evaluated post-arm, four audit dimensions, and the zero-LLM EFSM ablation. The older VDS, external-arm, office-task, and multi-ablation proposals below are deferred and must not be used to interpret `benchmarks/results/v3-seed*.json`.

> **Metric note:** The historical `VDS`, `Cost_eff`, and `Time_eff` rows below are retained for literature mapping only. The current paper reports `VerifiedDelivery`, `FCR`, `RawPass`, audit dimensions, wall time, and recorded LLM calls as defined in the master plan and reproduction guide.

---

## 1. Design Grounding in 2024–2026 Peer Literature / 前沿论文实验范式对标

To ensure our evaluation directly answers the questions top SE/AI venues (ACL, ICML, NeurIPS, ISSTA, SCICO/SoftwareX) ask, every arm, task stratum, and metric in OGSystem V2 is explicitly mapped from our closest downloaded peer papers in [`docs/paper/references/`](references/README.md):

| Peer Paper | Venue / Year | Key Experimental Paradigm Borrowed | How OGSystem V2 Adapts It |
| :--- | :--- | :--- | :--- |
| **STORM** (`storm-arxiv-2605.20563.pdf`) | Preprint 2026 | Compares `Single-Agent` vs naive `GitWorktree` (post-hoc merge) vs state-managed workspace across 3 LLMs; reports `Score`, `Cost_eff = Cost/Score`, `Time_eff = Time/Score`. | Adds **Arm B2 (Naive GitWorktree without Join/CAS/Release contracts)** alongside **Arm B1 (Flat-Dir Shared)** so we test whether OGS's Context Map + 4-valued Join + Expected-Head CAS overcomes naive worktree pain points while preserving commit history. |
| **Executable-FSM** (`executable-fsm-arxiv-2611.10884.pdf`) | Preprint 2026 | Distinguishes raw `Strict Accuracy` from process-faithful **`FC = Σ 1[compliant ∧ correct]`** across multiple seeds and drifting vs non-drifting models. | Adopts dual reporting: **Raw Outcome Pass Rate (`RawPass`)** vs **Verified Delivery Success (`VDS = outcome_pass ∧ provenance_valid ∧ release_published ∧ policy_compliant`)**, preventing "lucky shortcut" runs from masking governance failures. |
| **TraceDev** (`tracedev-arxiv-2607.18886.pdf`) | ISSTA 2026 | Structures evaluation around **RQ1 (Effectiveness vs MAS)**, **RQ2 (Per-mechanism Ablation)**, **RQ3 (Efficiency)** on multi-artifact requirement-to-code tasks. | Organizes OGS experiments into RQ1 (Arm A/B1/B2/C + external product arms), RQ2 (3 single-mechanism ablations), and RQ3 (`Cost_eff`, `Time_eff`, overhead breakdown). |
| **Auditable Agents** (`auditable-agents-arxiv-2604.05485.pdf`) | Preprint 2026 | Five auditability dimensions: action recoverability, lifecycle coverage, policy checkability, responsibility attribution, evidence integrity. | Operationalizes these 5 dimensions into quantitative **Intermediate Auditability Score**, **Rollback Success Rate**, and **Evidence Reconstruction Completeness** in [`benchmarks/`](../../benchmarks/). |
| **Sustainable Agents** (`sustainable-agents-arxiv-2610.03010.pdf`) | Preprint 2026 | Multi-agent systems incur 6.36× energy and 6.07× latency vs single-agent; demands Pareto efficiency accounting. | Reports **Cost per Verified Success (`Cost_eff`)**, **Wall-Clock per Verified Success (`Time_eff`)**, and token breakdown per role rather than hiding overhead. |
| **MetaGPT / ChatDev / CrewAI** | ICLR/ACL 2024 | Same-task external product comparisons (software stratum for MetaGPT/ChatDev; office stratum for CrewAI) with blinded human/rubric judging. | Keeps external product arms (D/E/F) **strictly separated** from the causal A/B1/B2/C comparison, running on the exact same frozen task subset with mismatches disclosed. |

---

## 2. Experimental Arms & Controlled Variables / 实验组与变量控制

### 2.1 Primary Causal Arms (All Strata: Software + Office/Knowledge)

| Arm | Workspace Model | Control & Handoff | Join / Release Gate | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **A: Single-Agent** | Single working dir | Single prompt loop (matched iteration/token cap) | None | Baseline for role-decomposition gain vs sustainability cost (STORM / Sustainable Agents). |
| **B1: LangGraph Flat-Dir** | Shared flat directory (in-place writes) | Same role graph & prompts, unconstrained dict state | None | Isolates **destructive in-place overwrite**, canary leakage, and false completion. |
| **B2: LangGraph Naive Worktree** | Isolated Git worktrees, post-hoc merge | Same role graph & prompts, no Context Map / no CAS | Naive post-hoc `git merge` | Directly tests **STORM's critique** of naive worktrees vs OGS's governed worktree protocol. |
| **C: OGSystem V2 (Full)** | Single Git+LFS Workspace + Role Worktrees | EFSM + LTS events + Fail-Closed Context Map + `WorkspaceRef` | 4-Valued Join + Expected-Head CAS + Release Materialization | Full OGS V2 headless Open-Core runtime. |

### 2.2 Single-Mechanism Ablations (RQ2 — Sandbox Only)

| Ablation | Disabled Mechanism | Target Hypothesis Tested |
| :--- | :--- | :--- |
| **C-abl-1 (`no-context-map`)** | Disable field-level Context Map projection (pass full state dict) | Measures increase in **Canary-Field Leakage Rate** and unauthorized `WorkspaceRef` exposure. |
| **C-abl-2 (`no-workspace-ref`)** | Replace immutable commit-bound `WorkspaceRef` with raw text/path handoffs | Measures increase in **Stale-Reference / Dirty-Read** errors and **Audit Reconstruction loss**. |
| **C-abl-3 (`no-join-cas-gate`)** | Disable 4-valued sticky-fail Join & Expected-Head CAS Release gate | Measures **Silent `failed -> skipped` downgrades**, **Lost Updates**, and **Invalid Publications**. |

### 2.3 External Product Comparators (Stratified, Reported Separately)

- **Software Stratum:** Arm D (**MetaGPT** pinned release), Arm E (**ChatDev** pinned release)
- **Office & Knowledge Stratum:** Arm F (**CrewAI** pinned release)

### 2.4 Fixed Control Variables (Pinned per Task/Seed Block)

- **Unified Model (Zero Model-Confounding):** All live-LLM causal arms (Arm A, B1, B2, C) are pinned to **`gpt-6-luna`** via the local Codex backend (`.ogs/execution-bindings.json` -> `default-codex`). Cross-model replication is explicitly deferred to a separate sensitivity track so the primary study isolates protocol effect without model variance.
- **Budgets:** Identical wall-clock timeout (`600s` per role step), max loop/step budget, tool allowlist, and independent `pytest` acceptance oracle.
- **Randomization:** Paired randomization of arm execution order per `(task_id, seed)` block; minimum 2–3 seeds in Pilot.

---

## 3. Metric Matrix & Exact Formulas / 评测指标矩阵与计算公式

| Category | Metric | Formula / Operational Definition | Direction |
| :--- | :--- | :--- | :---: |
| **Primary Effectiveness** | **Verified Delivery Success (`VDS`)** | $\frac{\#\{\text{oracle\_pass} \land \text{no\_regression} \land \text{provenance\_valid} \land \text{release\_published}\}}{N_{\text{assigned}}}$ | $\uparrow$ |
| **Outcome Only** | **Raw Outcome Pass (`RawPass`)** | $\frac{\#\{\text{oracle\_pass}\}}{N_{\text{assigned}}}$ (reported alongside `VDS` per Executable-FSM) | $\uparrow$ |
| **Hallucination / Grounding** | **False-Completion Rate (`FCR`)** | $\frac{\#\{\text{claimed\_complete} \land \neg\text{oracle\_pass}\}}{\#\{\text{claimed\_complete}\}}$ | $\downarrow$ |
| **Hallucination / Grounding** | **Unsupported Claims (`UC/100`)** | Unsupported atomic factual claims per 100 verifiable claims (2 blinded annotators + adjudicator, Cohen's $\kappa$) | $\downarrow$ |
| **Workspace Integrity** | **Destructive Overwrite Rate (`DOR`)** | Fraction of multi-role tasks where an intermediate role draft is lost/overwritten without commit provenance | $\downarrow$ |
| **Workspace Integrity** | **CAS / Conflict Safety (`CSS`)** | Fraction of injected stale-head & parallel-conflict faults handled fail-closed without corrupting canonical ref | $\uparrow$ |
| **Boundary Security** | **Canary Leakage Rate (`CLR`)** | Fraction of canary-seeded tasks where undeclared secret/canary fields appear in downstream role input | $\downarrow$ |
| **Join Correctness** | **Sticky-Fail Violation (`SFV`)** | Count of Join scopes where a `failed` source is silently downgraded to `skipped` or `arrived` | $\downarrow$ (target 0) |
| **Auditability** | **Audit Reconstruction (`ARS`)** | Fraction of 5 audit facts (Role, Harness/Policy, Base/Result Commit, Verification, Release) reconstructible from Evidence | $\uparrow$ |
| **Efficiency (Pareto)** | **Cost Efficiency (`Cost_eff`)** | $\frac{\text{Total API Cost (\$)}}{\text{VDS} \times 100}$ (lower is better; per STORM & Sustainable Agents) | $\downarrow$ |
| **Efficiency (Pareto)** | **Time Efficiency (`Time_eff`)** | $\frac{\text{Total Wall-Clock Minutes}}{\text{VDS} \times 100}$ (lower is better) | $\downarrow$ |

---

## 4. Frozen Pilot Task Suite (`benchmarks/tasks/pilot-suite.json`)

The initial Pilot suite defines **10 frozen, stratified tasks** (5 Software + 5 Office/Knowledge), each equipped with:
- Role topology & required handoffs
- Independent acceptance oracle (hidden unit tests or frozen requirement rubric)
- **Canary field** (for `CLR` boundary testing)
- **Fault-injection profile** (concurrent same-path edit, stale canonical head, role failure in Join, or rework loop exhaustion)

---

## 5. Executable Evaluation Harness (`benchmarks/run-protocol-eval.mjs`)

Run the zero-cost deterministic protocol verification and table generator:

```bash
# Run deterministic protocol-level comparison across Arms B1/B2/C + 3 Ablations
node benchmarks/run-protocol-eval.mjs --mode=deterministic

# Export JSON metrics & LaTeX Table for paper drafting
node benchmarks/run-protocol-eval.mjs --mode=deterministic --json
node benchmarks/run-protocol-eval.mjs --mode=deterministic --latex
```

> **Next Step for Live LLM Runs:** Once `paper-eval-v1` tag is frozen and API budgets/models are selected, wire `--mode=live-llm --model=<id> --seeds=3` to execute the exact same `pilot-suite.json` through OGS V2 headless runtime (`src/runtime/adapter.ts`) and matched LangGraph baselines, reusing the identical independent oracle and statistical aggregator.
