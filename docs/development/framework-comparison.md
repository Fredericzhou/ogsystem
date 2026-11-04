# Framework Comparison

## Scope

This document compares OGSystem with ByteDance DeerFlow, DeepSeek Harness/DSH Superagent, and LangGraph. The comparison is about capability boundaries and architecture, not a claim that these projects are interchangeable products.

## Positioning

```text
OGSystem  = event-driven persistent extended-state-machine workflow runtime
DeerFlow  = long-horizon SuperAgent harness and workbench
DSH       = event-driven autonomous agent work system
LangGraph = graph execution framework and runtime substrate
```

## LangGraph Usage

DeerFlow 2.0 is LangGraph-first. It is built on LangGraph and LangChain, depends on `langgraph-sdk`, includes `backend/langgraph.json`, and exposes LangGraph Server/Studio-compatible execution paths. Threads, runs, checkpoints, streaming, and sub-agent execution are organized around the LangGraph runtime.

OGSystem also uses LangGraph, but at a different boundary:

```text
OGSystem Semantic IR / Execution Plan
  -> LangGraphEngineAdapter
    -> LangGraph StateGraph execution
```

OGSystem uses LangGraph for graph node execution, scheduling, state transitions at the engine layer, and selected runtime controls. OGSystem itself owns the public semantics and durable contracts:

- Mermaid DSL compilation
- responsibility Roles and handoffs
- Semantic IR
- Flow Contracts and output Schemas
- Laws and authorization boundaries
- branch, Join, quorum, and Loop semantics
- Context Map projections
- plan fingerprints
- checkpoint recovery
- run artifacts, audit, and replay

The distinction is:

```text
DeerFlow = LangGraph-first Agent Harness
OGSystem = OGSystem-semantics-first extended state-machine Runtime + LangGraph execution adapter
```

LangGraph is therefore an implementation engine in OGSystem, not the public OGSystem DSL or product data model. Replacing the engine remains possible in principle because the runtime exposes an engine adapter boundary, although the current production implementation uses LangGraph.

## Capability Matrix

| Capability | OGSystem | DeerFlow | DSH Superagent |
| --- | --- | --- | --- |
| Open-ended research and writing | Requires configured roles/tools | Strong | Medium |
| Browser, web search, documents, spreadsheets | External tools required | Strong | Medium |
| Long-running autonomous tasks | Partial and improving | Strong | Strong |
| Explicit responsibility seats | Strong | Weak/implicit | Mainly lead/worker |
| Static graph and flow contracts | Strong | Limited as a product surface | Limited |
| Branch, Join, quorum, Loop semantics | Explicit and validated | Mostly agent/graph driven | Not the core model |
| Model and native CLI backends | Strong | Provider/Harness centered | DeepSeek Harness centered |
| Sandbox and filesystem execution | Controlled workspace/tool boundary | Strong | Strong per ticket/session |
| Human review and authorization | Law, Mandate direction, Review | Permissions and approvals | Policy, Gate, Mandate |
| Long-term memory | Not a core feature | Strong | Present through session/workflow design |
| External channels and scheduled work | Project direction, narrower coverage | Strong | Strong |
| Run evidence, replay, checkpoints | Strong and contract-driven | Strong trace/checkpoint support | Strong event/store design |
| Local lightweight CLI use | Strong | Heavier Python/Node/service setup | Harness dependent |
| Deterministic business workflow | Strong | Medium | Medium |

## OGSystem Strengths

- Stable responsibility Roles rather than ad hoc agent delegation.
- Explicit graph semantics that can be compiled and checked before execution.
- Join, quorum, Loop, and Context Map behavior is part of the runtime contract.
- Native backend registry supports OpenCode, Codex, Ollama, Pi, Qwen Code, Kimi Code, and future clients.
- Durable run artifacts separate execution truth, timeline projections, checkpoints, and operator summaries.
- Laws, Schemas, Flow Contracts, and human review provide stronger business boundaries than prompt-only rules.
- The same execution base can serve Studio Simulation and Project Runs while keeping their ownership and storage separate.

## DeerFlow Strengths

- Strong out-of-the-box research, browser, search, document, spreadsheet, and code workflows.
- Built-in skills, tools, memory, sandbox, sub-agents, scheduled tasks, projects, and message gateways.
- Better fit for a general-purpose Agent workbench and long-horizon personal/team tasks.
- LangGraph and LangChain ecosystem integration is a primary design goal.
- Richer product surface for chat, archives, task goals, trace inspection, and background work.

## DSH Superagent Strengths

- Clear external-event model: Source, Trigger, Thread, Eval, Mandate, Ticket, Assignment, and Channel.
- Strong attention management: notify people only when a result or decision is needed.
- Durable outbox delivery with retry, ordering, and idempotency ideas.
- Good separation between long-lived work and one executor/session attempt.
- Useful reference for GitHub/Feishu/event-driven autonomous project operations.

## Limitations and Risks

### OGSystem

- Requires users to model roles and flows before open-ended work can start.
- Does not provide DeerFlow's broad research and browser capabilities by default.
- Has a narrower built-in channel, scheduling, and memory surface.
- Strict contracts reduce flexibility for tasks whose workflow is unknown in advance.

### DeerFlow

- More execution decisions depend on agent planning and prompt behavior.
- A large Python/Node/service stack increases local and production deployment cost.
- Rapid 2.0 evolution and multiple provider/tool integrations require compatibility testing.
- It does not expose OGSystem's responsibility-seat and Flow Contract semantics as its primary product model.

### DSH Superagent

- The public project is a research prototype rather than a stable independent CLI backend.
- Its execution model is closely coupled to DeepSeek Harness Sessions.
- Its lead/worker model is less expressive than OGSystem's explicit graph semantics.
- Authorization and assessment are more dependent on prompts and Harness behavior.

## Recommended Composition

These systems are best composed by capability boundary:

```text
External Source / Project Event
  -> Admission and Mandate
  -> OGSystem Project Task
  -> OGSystem Graph Run
  -> Pi / Qwen / Kimi / OpenCode / Codex / DeerFlow worker
  -> Artifact / Review / Channel
```

Recommended integration modes:

1. **OGSystem as controller, DeerFlow as a role executor**: use DeerFlow for research, browser, or document-heavy roles and return a schema-validated result to the OGS graph.
2. **DeerFlow as a general workbench, OGSystem as a controlled workflow service**: DeerFlow invokes a released OGS TeamVersion through an API when approval, multi-role routing, or auditable delivery is required.
3. **DSH-inspired Project Orchestration above the OGS Graph Runtime**: add Trigger, Mandate, Task/Assignment, Attention, and Outbox concepts without replacing System, Role, Run, or Semantic IR.

## Designs to Borrow

The highest-value ideas for OGSystem are:

- long-task scheduling and background execution
- sub-agent budgets and scoped context
- sandbox capabilities
- structured waiting/blocked/failed/ready attention states
- external event cursors and source health
- durable Outbox side effects
- low-noise notifications
- trace views that make every model/tool/context event inspectable

## Designs Not to Replace

OGSystem should retain:

- Responsibility Role semantics
- Semantic IR and Execution Plan
- Flow Contract and output Schema validation
- Laws and authorization checks
- Join, quorum, Loop, and Context Map semantics
- checkpoint, replay, and artifact policy
- backend registry and native CLI adapters

The goal is to add DeerFlow/DSH-style long-horizon product capabilities above the existing runtime, while keeping the runtime's deterministic and auditable workflow boundary.

## Decision

DeerFlow is a strong candidate for complementary research and long-task execution, but it is not a replacement for OGSystem's graph runtime. LangGraph is shared technology, not a shared product model: DeerFlow centers its harness on LangGraph, while OGSystem uses LangGraph behind its own semantic and audit contracts.
