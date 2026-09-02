# Runtime Storage And Engine Decoupling Roadmap

## Background

OGSystem current architecture is usable and internally layered, but it is not yet fully decoupled in the two directions that matter for long-term evolution:

1. Storage replacement
   Replace the current filesystem-backed run artifacts with database-backed persistence without forcing a broad rewrite.
2. Engine extensibility
   Keep OGSystem orchestration semantics independent enough that LangGraph remains a strong default backend, not an irreversible product-wide lock-in.

These are related, but they are not the same problem and should not be solved with the same abstraction.

## Current State

### What is already in good shape

- OGSystem has a clear semantic core:
  - `SystemDefinition`
  - `ExecutionPlan`
  - `GraphState`
  - review / join / route / contract semantics
- Runtime entry layering is directionally sound:
  - `adapter`
  - `runtime-setup`
  - `graph-runner`
- Join and routing semantics already have an extension seam through the mode registry.

### What is still coupled

#### 1. LangGraph is a hard execution dependency

- `src/runtime/graph-runner.ts` directly imports and constructs `StateGraph`.
- `src/runtime/parse-mermaid.ts` only accepts `engine=langgraph`.

Result:
- OGSystem semantics are partially independent.
- OGSystem execution is not yet backend-agnostic.

#### 2. Filesystem artifacts are a de facto internal API

- `src/runtime/run-artifacts.ts` defines the persistence model through concrete files and directories:
  - `state.json`
  - `summary.json`
  - `events.ndjson`
  - `timeline.jsonl`
  - `control/reviews/*.json`
  - `checkpoints/*.json`
- `src/runtime/project-lifecycle.ts` reads these directly.
- `src/visualizer/server.ts` and projection modules also read these directly.

Result:
- Runtime persistence is not abstracted.
- Visualizer and lifecycle logic are coupled to storage format, not just to runtime semantics.

#### 3. Resume locking is explicitly single-machine

- `src/runtime/run-artifacts.ts` uses lock files with `pid` and `hostname`.

Result:
- Good for local and single-host resilience.
- Not sufficient for multi-instance or database-backed service execution.

## Architectural Position

## Principle 1

Storage decoupling and engine decoupling must be treated as separate layers.

- Storage decoupling answers:
  - Where are run state and artifacts stored?
  - How are they queried?
  - How are review decisions persisted?
- Engine decoupling answers:
  - Who schedules graph execution?
  - Who owns transition progression?
  - Which execution backend realizes OGSystem semantics?

## Principle 2

OGSystem must own orchestration semantics; the backend must only realize them.

OGSystem should continue to own:

- Mermaid DSL
- parsing and validation
- execution plan compilation
- review / rework semantics
- routing / join semantics
- flow contracts
- projection and operator-facing meaning

LangGraph or any future backend should only own:

- graph scheduling
- reducer execution
- async state progression
- interruption / resume mechanics

## Principle 3

Visualizer should depend on stable projection services, not raw storage layout.

The UI should not care whether the source is:

- local files
- SQLite
- Postgres
- object storage plus metadata DB

## Target Architecture

```text
Mermaid DSL
  -> Parser / Validator
  -> SystemDefinition
  -> ExecutionPlan
  -> Runtime Services
       -> Engine Adapter
       -> Persistence Ports
       -> Projection Services

Persistence Ports
  -> Fs implementations
  -> Db implementations

Engine Adapter
  -> LangGraphEngineAdapter
  -> Future alternative adapters

Visualizer / CLI / Lifecycle
  -> Runtime Query Services
  -> Runtime Command Services
```

## Recommended Module Split

### A. Semantic core

Keep or strengthen these as backend-independent:

- `types.ts`
- `parse-mermaid.ts`
- `compiler.ts`
- `execution-plan.ts`
- `transition-planner.ts`
- `graph-mode-registry.ts`
- review and contract semantics

This layer should not know:

- file names
- directory layout
- HTTP details
- LangGraph-specific runtime objects

### B. Engine adapter layer

Introduce an explicit execution adapter contract.

Suggested interface:

```ts
export type EngineRunInput = {
  plan: ExecutionPlan;
  initialState?: GraphState;
  runtimeServices: RuntimeExecutionServices;
  prompt: string;
};

export type EngineRunResult = AdapterRunResult;

export interface ExecutionEngineAdapter {
  readonly engineId: string;
  run(input: EngineRunInput): Promise<EngineRunResult>;
}
```

Suggested first implementation:

- `LangGraphEngineAdapter`

What moves behind this interface:

- `StateGraph` construction
- graph node wiring
- scheduler loop implementation
- backend-specific state machine details

What should stay outside:

- semantic plan creation
- review decision model
- contract validation model
- artifact policy

### C. Persistence ports

Introduce storage interfaces before implementing a database backend.

Suggested split:

```ts
export interface RunStore {
  createRunContext(...): Promise<RunContextRecord>;
  loadRun(runId: string): Promise<RunRecord | undefined>;
  saveRunSummary(...): Promise<void>;
  saveRunState(...): Promise<void>;
  acquireResumeLease(...): Promise<LeaseHandle>;
}

export interface CheckpointStore {
  appendCheckpoint(...): Promise<void>;
  listCheckpoints(runId: string): Promise<RuntimeCheckpointRecord[]>;
  saveExecutionOutcome(...): Promise<void>;
  markExecutionOutcomeReconciled(...): Promise<void>;
}

export interface ReviewStore {
  saveReviewRequest(...): Promise<void>;
  saveReviewDecision(...): Promise<void>;
  listReviews(runId: string): Promise<ReviewProjection[]>;
  loadReview(runId: string, reviewId: string): Promise<ReviewProjection | undefined>;
}

export interface ArtifactStore {
  appendEvent(...): Promise<void>;
  appendTimeline(...): Promise<void>;
  appendRoleLog(...): Promise<void>;
  saveSystemSnapshot(...): Promise<void>;
  loadRequestPrompt(...): Promise<string>;
}
```

Recommended first implementations:

- `FsRunStore`
- `FsCheckpointStore`
- `FsReviewStore`
- `FsArtifactStore`

Future implementations:

- `SqliteRunStore`
- `PostgresRunStore`
- `PostgresCheckpointStore`
- `PostgresReviewStore`

### D. Query / projection services

Add stable read services between runtime persistence and visualizer.

Suggested services:

- `RunInspectionService`
- `RunListService`
- `ReviewInspectionService`
- `ResumeDiagnosticsService`
- `ProjectReadinessService`
- `OpsSummaryService`

These services should return DTO-like records rather than raw storage shapes.

The visualizer should call services like:

- `inspectRun(runId)`
- `listRuns()`
- `inspectReview(runId, reviewId)`

It should not read:

- `state.json`
- `events.ndjson`
- `timeline.jsonl`
- `control/reviews/*.json`

directly.

## Database Evolution Strategy

## Goal

Support both:

- local single-project filesystem mode
- service-grade database-backed mode

without bifurcating semantics.

## Recommended storage shape

### Core relational records

- `runs`
  - `run_id`
  - `system_id`
  - `status`
  - `created_at`
  - `updated_at`
  - `workdir_ref`
- `run_state_snapshots`
  - latest materialized `GraphState`
  - versioned snapshot metadata
- `runtime_checkpoints`
  - append-only WAL records
- `execution_outcomes`
  - one row per durable role execution outcome
- `review_requests`
- `review_decisions`
- `run_events`
- `run_timeline`
- `session_records`
- `resume_leases`

### Blob / large payload strategy

Do not force every artifact into one table.

Keep flexibility for:

- structured rows for query-critical fields
- blob/text storage for large logs and snapshots
- optional object storage for exported artifacts

## Resume and concurrency model

Current file lock semantics should evolve into leases.

Recommended database model:

- `resume_leases`
  - `run_id`
  - `owner_id`
  - `lease_version`
  - `expires_at`
  - heartbeat / renewal support

Required behavior:

- single active resume owner
- stale lease replacement
- compare-and-swap semantics
- host-independent coordination

## LangGraph extensibility strategy

Do not try to remove LangGraph immediately.

Recommended position:

- LangGraph remains the default execution backend.
- OGSystem introduces an execution adapter boundary around it.
- Alternative engines become optional, not mandatory.

This preserves current product momentum while preventing backend leakage into product semantics.

## How to better use LangGraph without over-coupling

Use LangGraph for:

- compiled graph execution
- node scheduling
- reducer orchestration
- pause/resume mechanics where appropriate

Do not let LangGraph define:

- OGSystem DSL concepts
- review semantics
- flow contract semantics
- run artifact schema
- operator-facing lifecycle meaning

In practical terms:

- `GraphState` remains an OGSystem type.
- `ExecutionPlan` remains an OGSystem type.
- review and contract decisions remain OGSystem types.
- LangGraph consumes and updates those types through the adapter.

## Risks To Address

### High priority

#### 1. Storage-format leakage into visualizer

Impact:

- Slows database adoption.
- Makes runtime persistence changes risky.

Fix:

- introduce query services and DTO projections
- stop direct file reads in visualizer

#### 2. Storage-format leakage into lifecycle services

Impact:

- `project-lifecycle` becomes a second persistence implementation
- changes must be synchronized in multiple places

Fix:

- route run inspection, review listing, and reindexing through store-backed services

#### 3. Single-machine resume lock assumptions

Impact:

- blocks service deployment
- unsafe for distributed resume

Fix:

- move from lock files to lease abstraction

### Medium priority

#### 4. Engine selection is parse-time fixed to LangGraph

Impact:

- alternative runtimes become invasive

Fix:

- allow `engine` resolution through a registry
- keep `langgraph` as default

#### 5. Projection logic mixes domain meaning with raw artifact scanning

Impact:

- query performance and consistency become harder under database mode

Fix:

- separate domain projection from raw storage traversal

## Phased Refactor Plan

## Phase 1: Storage ports without behavior changes

Goal:

- no product behavior change
- no engine change
- filesystem remains default

Tasks:

1. Introduce store interfaces.
2. Wrap current `run-artifacts.ts` behavior behind filesystem implementations.
3. Route runtime writes through interfaces.
4. Route runtime reads for resume through interfaces.

Exit criteria:

- filesystem remains fully green
- no direct file writes from runner outside store layer

## Phase 2: Query service isolation

Goal:

- visualizer and lifecycle stop depending on raw artifact layout

Tasks:

1. Add `RunInspectionService`, `RunListService`, `ReviewInspectionService`.
2. Refactor `project-lifecycle.ts` to depend on those services.
3. Refactor `visualizer/server.ts` and projection modules to depend on those services.

Exit criteria:

- visualizer does not read run files directly
- lifecycle no longer reconstructs state by hand from file layout

## Phase 3: Resume lease abstraction

Goal:

- runtime resume coordination no longer assumes single host

Tasks:

1. Introduce `ResumeLeaseStore`.
2. Move file lock implementation into `FsResumeLeaseStore`.
3. Add database-backed lease semantics.

Exit criteria:

- resume lock logic is backend-swappable

## Phase 4: Engine adapter boundary

Goal:

- make LangGraph an implementation, not the only possible runtime

Tasks:

1. Introduce `ExecutionEngineAdapter`.
2. Move LangGraph-specific code into `LangGraphEngineAdapter`.
3. Keep `adapter.ts` and `runtime-setup.ts` backend-neutral.

Exit criteria:

- runtime setup no longer directly assumes LangGraph runner internals
- parser and runtime can resolve engine adapters by id

## Phase 5: Database-backed mode

Goal:

- add service-grade persistence while preserving local developer mode

Tasks:

1. Implement DB-backed stores.
2. Add runtime mode selection in config.
3. Add migration/version policy for state and artifacts.
4. Add operational tooling for cleanup, inspection, and replay.

Exit criteria:

- same semantic tests pass on filesystem and DB backends

## Non-Goals

- Do not rewrite semantics to match database shape.
- Do not remove local filesystem mode.
- Do not redesign Mermaid DSL just to support storage changes.
- Do not force full engine replacement before storage abstraction lands.

## Testing Strategy

Every phase should preserve the same test matrix:

- semantic parser tests
- compiler tests
- runtime integration tests
- resume/recovery tests
- review/rework tests
- visualizer tests

Add backend parity tests:

- `fs backend`
- `db backend`

Use the same scenario suite on both.

## Recommended Immediate Next Steps

1. Create a small `src/runtime/store/` package with interface definitions only.
2. Move current filesystem lock and artifact logic into `Fs*` implementations.
3. Introduce a `RuntimeQueryService` and migrate one read path first:
   - recommended first candidate: `inspectRun`
4. Refactor visualizer run detail loading to use the query service.
5. After read isolation is stable, introduce lease abstraction.

## Summary

The current architecture is not fundamentally blocked, but it is not yet ready for painless migration to database-backed or multi-instance runtime operation.

The right approach is:

- first decouple storage
- then isolate read/query projections
- then abstract resume coordination
- then formalize the execution adapter boundary around LangGraph

This keeps current product velocity intact while creating a realistic path to:

- database persistence
- multi-instance runtime operation
- cleaner visualizer/runtime boundaries
- future backend extensibility without semantic drift
