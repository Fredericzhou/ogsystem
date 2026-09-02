# OGSystem vs PraisonAI Comparison Roadmap

Date: 2026-05-22
Status: active

## 1. Purpose

This document turns the PraisonAI comparison into an OGSystem roadmap with explicit boundaries.

The goal is not to copy PraisonAI feature-for-feature. The goal is to borrow the parts that improve OGSystem's operator surface, ecosystem reach, and runtime efficiency without weakening the current core guarantees:

- one runtime path
- fail-closed orchestration semantics
- file-first recovery authority
- durable audit and human-review reconciliation

## 2. Comparison Summary

### 2.1 Where PraisonAI is stronger

PraisonAI currently presents itself as a broad agent platform rather than a narrow orchestration kernel. Its visible strengths are:

- broader product surface: SDK, CLI, UI, dashboard, flow builder, memory, RAG, and deployment-facing capabilities
- broader ecosystem surface: multi-model support, external agent/tool integrations, and product-level observability hooks
- faster application assembly: more "ready-to-compose" app patterns for research, support, coding, and automation workflows

### 2.2 Where OGSystem is stronger

OGSystem is materially stronger in runtime contract discipline:

- Mermaid is an executable DSL, not a loose design layer
- resume authority is explicit: `state.json`, `sessions.json`, `plan-fingerprint.json`, `checkpoints/`, and durable outcomes
- audit and operator projections are intentionally separated
- human review is runtime-native instead of emulated as another agent node
- graph semantics are fail-closed for join, loop, context projection, and error routing

### 2.3 Strategic interpretation

The projects are adjacent, but they are not substitutes:

- PraisonAI is closer to a general agent application platform
- OGSystem is closer to a recoverable graph orchestration kernel with an operator console

That means OGSystem should borrow product-layer ideas from PraisonAI, not its looser execution model.

## 3. Non-Goals

The following are out of scope for this roadmap:

- replacing OGSystem's Mermaid-first semantic surface with open-ended agent autonomy
- introducing a second runtime path
- making memory, RAG, or retrieval an implicit hidden context source
- weakening fingerprint, review, or recovery boundaries for convenience
- chasing connector breadth before operator and runtime surfaces are coherent

## 4. Priority Themes

### 4.1 Framework Layer

#### Theme A: Clear product layering

PraisonAI benefits from being legible as a product stack, not only as a runtime package. OGSystem should make its layers equally explicit:

- `core runtime`: parser, compiler, execution plan, graph runner, executor boundary, run artifacts
- `operator surface`: CLI lifecycle plus Visualizer/Operate
- `authoring surface`: Build/Studio, templates, NL2MMD, project scaffolding
- `integration surface`: providers, external workers, telemetry, future channel adapters

Target outcome:

- contributors and users can tell which module owns runtime truth, which module owns authoring UX, and which module owns integrations

#### Theme B: Executor and provider modularity

PraisonAI gains adoption partly because the model/provider surface is broad. OGSystem should strengthen this without expanding runtime semantics:

- keep `Executor` as the only execution boundary
- reduce product dependence on OpenCode-specific assumptions where possible
- introduce a clearer provider/router abstraction for model selection, fallback, and capability checks
- preserve direct `provider/model` runtime refs and fingerprint participation

Target outcome:

- more providers and model-routing strategies can be added without touching graph semantics or resume authority

#### Theme C: External agent worker boundary

PraisonAI treats tools and external execution bodies as first-class building blocks. OGSystem should do the same for bounded external workers:

- standardize `exec.bind` workers for external CLI agents and local automation tools
- define worker capability, timeout, retry, and output-contract metadata more explicitly
- keep external workers behind the same durable role execution and audit path as model-bound roles

Target outcome:

- external coding/research agents become a supported execution class rather than an ad hoc shell pattern

### 4.2 Functional Layer

#### Theme D: Productized capability packs

PraisonAI is ahead on memory, knowledge, and application-ready composition. OGSystem should not push these into the core runtime, but it should define explicit capability packs around the runtime:

- provider readiness and model capability diagnostics
- memory pack: explicit run-scoped or project-scoped memory with visible storage and fingerprint rules
- knowledge pack: explicit retrieval/index references, not hidden prompt injection
- telemetry pack: traces, spans, cost, retries, review decisions, and role-level outcomes

Target outcome:

- OGSystem gains product usefulness without collapsing runtime truth into opaque side effects

#### Theme E: Better application templates

PraisonAI lowers time-to-first-app with more complete examples. OGSystem should upgrade from semantic demos toward runnable solution templates:

- consultation template
- review-and-rework template
- compensation/error-flow template
- external-worker coding template
- knowledge-assisted analysis template

Target outcome:

- the first successful project is assembled from a stable pattern, not from low-level primitives alone

#### Theme F: Stronger operator console

PraisonAI's product surface is easier to inspect operationally. OGSystem already has the harder runtime core, so it should continue turning Visualizer into a real operator console:

- provider readiness panel
- review queue and reconciliation health
- disk-growth and retention guidance
- run failure localization and next-action recommendations
- role/session/provider drill-down views

Target outcome:

- operating a real run no longer requires reading raw run artifacts unless intentionally debugging internals

### 4.3 Performance Layer

#### Theme G: Runtime efficiency around the file-first model

PraisonAI advertises lightweight runtime overhead. OGSystem should improve efficiency without abandoning file-first authority:

- continue replay benchmarking and checkpoint-tail timing tracking
- add thresholds for long-loop and fan-out/fan-in scenarios
- make retention and execution-history cleanup more visible and measurable
- optimize hot read paths for active runs without making projections authoritative

Target outcome:

- long-running and repeatedly resumed systems stay operationally cheap enough before any storage-engine expansion is justified

#### Theme H: Controlled concurrency as execution policy

PraisonAI's broader workflow orientation makes concurrency tuning more visible. OGSystem should add bounded execution policy while keeping semantics stable:

- preserve `parallel_split` as semantic fan-out only
- add optional bounded concurrency controls at execution strategy level
- expose queueing/backpressure metrics when the executor cannot keep up

Target outcome:

- high-fan-out systems can be resource-governed without inventing new graph semantics

#### Theme I: Prompt/context cost control

PraisonAI highlights prompt caching and context compaction. OGSystem should borrow the idea carefully:

- make prompt/context volume measurable per role execution
- add explicit, inspectable context compaction policies where the behavior is deterministic
- never hide compaction behind silent prompt mutation that bypasses auditability

Target outcome:

- token and latency reductions become available without making runs harder to explain or reproduce

## 5. Recommended Sequence

### 5.1 Next 30 Days

- add this roadmap to the active docs index
- define the product-layer boundaries in docs with explicit ownership of runtime, authoring, and operator concerns
- design a provider readiness surface backed by existing doctor/runtime diagnostics
- define an external worker contract for `exec.bind` beyond basic shell execution
- add backlog entries for telemetry, provider readiness, and template upgrades

### 5.2 Day 31-60

- implement provider readiness UI and API projections
- add at least one application-grade template built on current stable semantics
- formalize a telemetry event model that maps runtime facts to traces and cost reporting
- design bounded concurrency execution policy without changing `parallel_split` semantics

### 5.3 Day 61-90

- prototype a memory/knowledge pack with explicit persistence and fingerprint rules
- add role-level context-size and prompt-cost observability
- evaluate deterministic context compaction only after visibility and audit fields exist
- add one external-agent worker template that proves `exec.bind` can orchestrate non-model executors cleanly

## 6. Concrete Backlog Candidates

The following items should be considered for the unified backlog:

- provider readiness visualization backed by doctor and runtime capability checks
- telemetry/tracing export boundary for runs, roles, retries, and review decisions
- external worker contract for `exec.bind` agents and tools
- application-grade project templates beyond semantic examples
- bounded execution concurrency policy and metrics
- prompt/context volume metrics and explicit compaction policy design
- memory/knowledge capability packs with explicit runtime boundaries

## 7. What Not To Copy From PraisonAI

The following would likely damage OGSystem's current strengths:

- replacing explicit graph semantics with open-ended autonomous planning inside the runtime core
- allowing hidden memory or retrieval to influence outputs without config, fingerprint, and audit visibility
- optimizing for ecosystem breadth before the operator surface and recovery model stay coherent
- building a large platform layer that leaks into core execution and makes resume behavior ambiguous

## 8. Success Criteria

This roadmap is successful only if all of the following remain true while capabilities expand:

- runtime truth still lives in the current recovery authority set
- Visualizer and templates become more product-grade without owning runtime semantics
- external integrations stay behind explicit execution and persistence contracts
- performance work is justified by measured replay, fan-out, and prompt-cost pressure
- OGSystem becomes easier to adopt without becoming less explainable

## 9. Summary

PraisonAI is a useful comparison target because it exposes what OGSystem currently lacks at the product and ecosystem layers. It is not the right target for OGSystem's semantic core.

The right move is:

- keep the current strict orchestration kernel
- improve provider, telemetry, template, and operator layers around it
- add execution efficiency and external-worker support as bounded extensions

That path preserves OGSystem's main differentiator while addressing the most visible adoption gaps.
