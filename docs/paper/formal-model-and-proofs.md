# OGSystem V2 Formal Model and Protocol Safety Invariants
# OGSystem V2 形式化模型与协议安全不变量

> **Status / 状态:** Formal protocol specification and proof appendix supporting [`ogs-submission-paper-en.md`](ogs-submission-paper-en.md).  
> **Scope Boundary / 证明边界:** Every proposition below is proved over the **OGSystem V2 protocol model** under explicit system assumptions (stated in §6). These proofs establish structural safety and termination invariants of the Framework runtime; they do **not** claim semantic correctness of LLM outputs, cryptographic tamper-proofing of local disk storage, or immunity to host OS compromises.

---

## 1. Responsibility-Seat EFSM Algebra / 责任席位 EFSM 代数系统

### Definition 1 (Collaboration Graph and Responsibility-Seat EFSM)

An OGSystem V2 workflow is compiled from a restricted Mermaid topology and Role contracts into an **Extended Finite-State Machine (EFSM)** tuple:

$$
\mathcal{M} = (V, E, \Sigma, \mathcal{X}, \delta, s_0, F, \kappa, \alpha, \beta)
$$

where:
- $V$ is a finite set of **invariant responsibility seats** (Roles), decoupled from transient model sessions or backend processes.
- $E \subseteq V \times V$ is the directed handoff relation.
- $\Sigma$ is a finite, closed **LTS business-event vocabulary** declared in Semantic IR (`SemanticIR.version`). Any event $e \notin \Sigma$ is rejected fail-closed at runtime.
- $\mathcal{X} = \mathcal{X}_{\text{biz}} \times \mathcal{X}_{\text{ctx}} \times \mathcal{X}_{\text{join}} \times \mathcal{X}_{\text{loop}} \times \mathcal{X}_{\text{ws}} \times \mathcal{X}_{\text{ctrl}}$ is the typed, persisted extended state space:
  - $\mathcal{X}_{\text{biz}}$: structured business state and reducer outputs;
  - $\mathcal{X}_{\text{ctx}}$: immutable task brief and per-hop projected context;
  - $\mathcal{X}_{\text{join}}$: Join-scope source outcome maps indexed by $(v_{\text{join}}, \text{lineageId}, \text{loopIter})$;
  - $\mathcal{X}_{\text{loop}}$: lineage-bound loop iteration counters $c(\ell) \in \mathbb{N}$ for each static cycle $\ell$;
  - $\mathcal{X}_{\text{ws}}$: Git + LFS Workspace state (canonical ref head $h_{\text{canon}}$, Role commits, merge commits, Release records);
  - $\mathcal{X}_{\text{ctrl}}$: human-control / review pause state, checkpoint version, and plan fingerprint $H(\mathcal{M})$.
- $\kappa : E \to \mathcal{P}(\mathcal{F}_{\text{data}}) \times \mathcal{P}(\mathcal{F}_{\text{ref}})$ assigns each handoff edge a typed **Context Map contract** specifying the exact permitted data fields $\mathcal{F}_{\text{data}}$ and authorized read-only `WorkspaceRef` projections $\mathcal{F}_{\text{ref}}$.
- $\alpha : V \to 2^{\mathcal{T}} \times \Pi_{\text{env}}$ binds each Role seat to its Technical Binding (`allowedTools`, `EnvironmentIntent`), which Runtime intersects with independently verified backend capabilities:
  $$
  \mathcal{T}_{\text{eff}}(v) = \text{allowedTools}(v) \cap \text{verifiedTools}(v).
  $$
- $\beta : \mathcal{L}(\mathcal{M}) \to \mathbb{N}^+$ assigns every directed cycle $\ell \in \mathcal{L}(\mathcal{M})$ a compile-time **finite loop budget** $B(\ell) \ge 1$ together with a static exhaustion exit edge $e_{\text{exhaust}}(\ell)$.
- $\delta : (V \times \Sigma \times \mathcal{X}) \rightharpoonup (2^V \times \mathcal{X} \times \mathcal{W})$ is the partial transition function emitting next active seats, updated extended state, and durable WAL facts $\mathcal{W}$ (`events.ndjson`) prior to CAS state-snapshot updates (`state.json`).
- $s_0 \in V \times \mathcal{X}$ is the initial configuration; $F \subseteq V \times \mathcal{X}$ is the set of terminal configurations (`completed`, `failed`, `terminated`, `paused_for_review`).

### Remark 1 (Strict Inclusion of DAGs: $\text{DAG} \subsetneq \text{EFSM}_{\text{OGS}}$)

Any acyclic workflow graph $G = (V, E)$ with $\mathcal{L}(G) = \emptyset$ is a degenerate instance of $\mathcal{M}$ with trivial loop budget map $\beta = \emptyset$ and singleton event alphabet $\Sigma = \{\text{DONE}\}$. Conversely, $\mathcal{M}$ strictly subsumes DAGs by supporting bounded review/rework cycles ($\mathcal{L}(\mathcal{M}) \neq \emptyset$) with static exhaustion exits and four-valued concurrent Join scopes.

---

## 2. Context Map Projection Closure / 上下文映射投影封闭性

Let $\mathcal{U}$ be the universe of candidate context keys and workspace references available in the global extended state $x \in \mathcal{X}$. For a handoff edge $e = (u, v) \in E$ with declared contract $\kappa(e) = (K_{\text{data}}(e), K_{\text{ref}}(e))$, define the **Context Map projection operator** $\pi_{\text{in}}(x, e)$:

$$
\pi_{\text{in}}(x, e) = \Big(
  \{(k, x.\text{biz}[k]) \mid k \in K_{\text{data}}(e) \cap \text{dom}(x.\text{biz})\},\;
  \{r \in x.\text{refs} \mid \text{authorized}(r, K_{\text{ref}}(e)) \land \text{validRef}(r)\}
\Big)
$$

where $\text{validRef}(r)$ requires: (i) $r.\text{commit}$ is a full 40-char immutable Git commit hash in the project Workspace; (ii) $r.\text{path}$ is normalized inside the committed tree with no symlink escape or path traversal; and (iii) the content digest of `(r.commit, r.path)` matches $r.\text{digest}$.

### Proposition 1 (Fail-Closed Field Closure and Default Non-Exposure of Workspace References)

Under the V2 Context Map contract:
1. **Field Closure:** For every Role invocation on edge $e = (u, v)$, the input domain visible to Role $v$ satisfies $\text{dom}(\pi_{\text{in}}(x, e)_{\text{data}}) \subseteq K_{\text{data}}(e)$. Any undeclared field $k^* \in \text{dom}(x.\text{biz}) \setminus K_{\text{data}}(e)$ (including canary fields) is absent from $v$'s projected input.
2. **Default Ref Non-Exposure:** If $K_{\text{ref}}(e) = \emptyset$ (the default), then $\pi_{\text{in}}(x, e)_{\text{ref}} = \emptyset$; no `WorkspaceRef` crosses the Role boundary.
3. **Commit Immutability:** Every reference $r \in \pi_{\text{in}}(x, e)_{\text{ref}}$ resolves to an immutable committed Git object rather than a mutable working-tree path.

**Proof.**
1. By construction, $\pi_{\text{in}}$ iterates exclusively over the statically compiled allowlist $K_{\text{data}}(e)$ rather than blacklisting fields from $\text{dom}(x.\text{biz})$. Hence $k^* \notin K_{\text{data}}(e) \implies k^* \notin \text{dom}(\pi_{\text{in}}(x, e)_{\text{data}})$. Missing required fields fail compilation/projection rather than falling back to unfiltered state.
2. When $K_{\text{ref}}(e) = \emptyset$, $\text{authorized}(r, \emptyset) = \bot$ for all $r$, yielding $\pi_{\text{in}}(x, e)_{\text{ref}} = \emptyset$.
3. The predicate $\text{validRef}(r)$ (implemented in `assertWorkspaceRef` in [`src/runtime/workspace-contracts.ts`](../../src/runtime/workspace-contracts.ts)) rejects symbolic refs, branch names, tags, uncommitted paths, path traversals, and digest mismatches before projection. $\blacksquare$

*Implementation reference:* [`tests/context-map-compiler.test.mjs`](../../tests/context-map-compiler.test.mjs), [`tests/context-selector.test.mjs`](../../tests/context-selector.test.mjs), [`tests/workspace-contracts.test.mjs`](../../tests/workspace-contracts.test.mjs).

---

## 3. Four-Valued Join Calculus & Sticky-Failure Invariant / 四值并发 Join 演算与粘滞失败不变量

For a Join scope $\sigma = (v_{\text{join}}, \text{lineageId}, \text{loopIter})$ with declared source roles $S = \{u_1, \dots, u_m\}$, each source carries a state in the four-valued domain:

$$
\mathbb{J} = \{\texttt{pending}, \texttt{arrived}, \texttt{skipped}, \texttt{failed}\}.
$$

Define the binary merge operator $\sqcup : \mathbb{J} \times \mathbb{J} \to \mathbb{J}$ (implemented as `mergeJoinSourceStatus(previous, next)` in [`src/runtime/graph-mode-registry.ts`](../../src/runtime/graph-mode-registry.ts)):

| `previous \ next` | `pending` | `arrived` | `skipped` | `failed` |
| :--- | :---: | :---: | :---: | :---: |
| **`pending`** | `pending` | `arrived` | `skipped` | `failed` |
| **`arrived`** | `arrived` | `arrived` | `arrived` | `failed` |
| **`skipped`** | `skipped` | `skipped` | `skipped` | `failed` |
| **`failed`** | `failed` | `failed` | `failed` | `failed` |

### Proposition 2 (Sticky-Failure Absorption and Monotonic Progression)

1. **Absorbing Failure ($\top$-Property):** `failed` is a two-sided absorbing element under $\sqcup$:
   $$
   \forall s \in \mathbb{J},\quad \texttt{failed} \sqcup s = \texttt{failed} \quad\land\quad s \sqcup \texttt{failed} = \texttt{failed}.
   $$
   In particular, a source recorded as `failed` can **never** be silently downgraded to `skipped`, `arrived`, or `pending` by subsequent branch events or timeout sweeps.
2. **Irreversibility of Resolution:** Once a source leaves `pending` to enter $\{\texttt{arrived}, \texttt{skipped}\}$, it can never revert to `pending`, nor flip between `arrived` and `skipped`; the only further transition permitted is escalation to `failed`.
3. **Deterministic Activation Boundary:**
   - Under `all_of`, activation requires $\forall u \in S,\; \text{status}(u) = \texttt{arrived}$; any source in `failed` or `skipped` blocks normal `all_of` activation and routes to the declared failure/exception policy.
   - Under `quorum_of(K)`, activation occurs as soon as $|\{u \in S \mid \text{status}(u) = \texttt{arrived}\}| \ge K$, freezing the `sourceSnapshot` in the WAL (`join_quorum_reached`); late source arrivals do not rewrite the committed quorum snapshot.

**Proof.**
Direct exhaustive verification over the 16 entries of the $\sqcup$ transition table above (and mirrored in `buildJoinSourceStatus` precedence `failed > skipped > arrived > pending`). Since `previous === "failed" || next === "failed"` is checked first, absorption holds unconditionally. For `previous ∈ {arrived, skipped}` and `next ≠ failed`, `mergeJoinSourceStatus` returns `previous`, proving irreversibility. $\blacksquare$

*Implementation reference:* `mergeJoinSourceStatus` & `buildJoinSourceStatus` in [`src/runtime/graph-mode-registry.ts`](../../src/runtime/graph-mode-registry.ts#L33-L59); verified exhaustively in [`tests/join-source-snapshot.test.mjs`](../../tests/join-source-snapshot.test.mjs).

---

## 4. Workspace Isolation & Expected-Head CAS Consistency / 工作区隔离与 CAS 一致性证明

Let $h_{\text{canon}} \in \mathcal{H}$ denote the full Git commit SHA pointed to by the Project's canonical ref. Every Role $v$ executes inside a dedicated Git Worktree initialized at a fixed commit $b_v \in \mathcal{H}$ and produces an immutable Role commit $c_v$ recorded by the Framework.

Every authoritative canonical mutation $M$ (Join merge publish, Restore, or Release publication) must execute the guarded protocol:

1. **Acquire Canonical Lock:** Acquire lock $L = (\text{owner}, \text{lease}, \text{fencingToken}, h_{\text{exp}})$ with monotonically increasing `fencingToken`.
2. **Pre-CAS Materialization / Verification:** Perform integration in an unauthoritative Merge Worktree and (for Release) materialize outputs and verify manifest + output digest *before* touching the canonical ref.
3. **Expected-Head CAS:** Atomically execute `update-ref(canonRef, h_new, expected = h_exp)`. If the current canonical head $h_{\text{canon}} \neq h_{\text{exp}}$, the operation **fails closed** with a stale-head rejection; $h_{\text{canon}}$ remains untouched and the candidate commit remains preserved for recovery/rebase.

### Proposition 3 (No Silent Lost Updates and No Dirty Overwrites)

Assume Git's ref-update CAS primitive is atomic with respect to concurrent ref writers and Roles have no direct write access to the canonical ref or other Roles' worktrees. Then:
1. **No Concurrent Dirty Write:** Two concurrently executing Roles $v_1, v_2$ cannot overwrite each other's in-progress files on disk.
2. **No Silent Lost Update:** If two authoritative mutations $M_1, M_2$ observe the same base head $h_0$ and both attempt to advance the canonical ref to $h_1$ and $h_2$ respectively ($h_1 \neq h_2$), at most one succeeds; the second is deterministically rejected by Expected-Head CAS.
3. **Conflict Safety:** If merging candidate Role commits $\{c_1, \dots, c_k\}$ produces a content conflict, the conflict is isolated inside the Merge Worktree, recorded as `join_conflict` in Run Evidence, and $h_{\text{canon}}$ is invariant.
4. **Release Publication Gate:** A download reference is exposed if and only if the Release state reaches `published` after `prepared -> materialized -> ref_updated -> published`. A failure at `prepared` or `materialized` leaves $h_{\text{canon}}$ unchanged; a failure after `ref_updated` enters explicit reconciliation rather than silent publication.

**Proof.**
1. Each Role $v_i$ operates in a disjoint filesystem directory (`worktreeId_i`) checked out from immutable commit $b_{v_i}$. Disjoint directories prevent unsynchronized in-place file overwrites.
2. Suppose $M_1$ and $M_2$ both hold $h_{\text{exp}} = h_0$. Serialization by canonical lock $L$ (with fencing token) orders their CAS attempts; without loss of generality let $M_1$ commit first, updating $h_{\text{canon}} \leftarrow h_1$. When $M_2$ executes `update-ref(canonRef, h_2, expected = h_0)`, since $h_{\text{canon}} = h_1 \neq h_0$, Git's atomic CAS rejects $M_2$.
3. Because merge execution occurs in a separate Merge Worktree prior to Step 3, any merge conflict aborts before `update-ref` is invoked, preserving $h_{\text{canon}}$.
4. Follows directly from the Release state machine transition guards in [`src/runtime/workspace-release.ts`](../../src/runtime/workspace-release.ts). $\blacksquare$

*Implementation reference:* [`src/runtime/workspace-coordinator.ts`](../../src/runtime/workspace-coordinator.ts), [`src/runtime/workspace-lock.ts`](../../src/runtime/workspace-lock.ts), [`src/runtime/workspace-release.ts`](../../src/runtime/workspace-release.ts), [`tests/workspace-coordinator.test.mjs`](../../tests/workspace-coordinator.test.mjs).

---

## 5. Bounded Control-Loop Termination / 有界控制循环终止性

### Proposition 4 (Finite Control-Flow Termination under Static Loop Budgets)

Let $\mathcal{M}$ be a compiled V2 workflow with finite Role set $|V| < \infty$, finite cycle set $\mathcal{L}(\mathcal{M})$, and positive integer budgets $B(\ell) \in \mathbb{N}^+$ for every directed cycle $\ell \in \mathcal{L}(\mathcal{M})$. Assume every individual Role invocation terminates within its configured execution timeout (returning either a declared event $e \in \Sigma$ or a timeout/failure status). Then every Run of $\mathcal{M}$ terminates in a finite number of control transitions bounded by:

$$
T_{\max}(\mathcal{M}) \le |V| \cdot \prod_{\ell \in \mathcal{L}(\mathcal{M})} \big(B(\ell) + 1\big).
$$

**Proof.**
Define the lexicographic progress measure over the finite set of active cycle budgets and remaining acyclic topological depth:
$$
\Phi(x) = \Big(\sum_{\ell \in \mathcal{L}(\mathcal{M})} \max(0, B(\ell) - c(\ell)),\; d_{\text{DAG}}(v)\Big) \in \mathbb{N} \times \mathbb{N},
$$
where $d_{\text{DAG}}(v)$ is the longest acyclic path length from seat $v$ to a terminal seat in the cycle-broken condensation graph. Every back-edge along cycle $\ell$ strictly increments $c(\ell)$ (strictly decreasing the first component of $\Phi$) while $c(\ell) < B(\ell)$; once $c(\ell) = B(\ell)$, the runtime forces transition along the static exhaustion exit $e_{\text{exhaust}}(\ell)$ (e.g., `paused_for_review` or terminal failure). Every non-back-edge strictly decreases $d_{\text{DAG}}(v)$ while keeping the first component non-increasing. Since $(\mathbb{N} \times \mathbb{N}, <_{\text{lex}})$ is well-founded, no infinite control-transition sequence exists. $\blacksquare$

*Note on Scope:* Proposition 4 guarantees termination of the **Framework control plane** (preventing unbounded agent ping-pong loops). It relies on per-invocation timeouts to bound individual LLM/tool calls.

---

## 6. Explicit Formal Assumptions & Evidence Boundary / 形式化假设与证据边界

To maintain strict academic rigor (aligned with [`ogs-submission-paper-en.md`](ogs-submission-paper-en.md) §8):

| Assumption | What the Proof Guarantees | What Remains Outside Scope |
| :--- | :--- | :--- |
| **A1. Trusted Framework Runtime** | Framework executes projection, Join merge, locking, and CAS faithfully. | Host OS compromise, malicious modification of `.ogs/` files on disk, or bypassing the runtime. |
| **A2. Atomic Git Ref CAS & Filesystem Rename** | Local single-host expected-head CAS and WAL/snapshot atomicity. | Distributed multi-host split-brain without an external consensus lock service. |
| **A3. Bounded Per-Step Tool/LLM Execution** | Control-plane termination under static loop budgets. | Semantic quality, factual accuracy, or convergence of LLM-generated content. |
| **A4. Explicit Scope of Evidence** | Protocol properties are backed by formal proofs + deterministic unit/fault tests (486+ core tests). | Comparative task accuracy, hallucination reduction, and cost-efficiency require the controlled empirical study in [`experimental-validation-plan-bilingual.md`](experimental-validation-plan-bilingual.md). |
