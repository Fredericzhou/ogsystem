# OGSystem Single Graph Runtime Execution Checklist

Date: 2026-04-10  
Scope: remove `minimal` as a real runtime path and harden one graph-based execution model  
Status: execution plan

## 0. Goal

Make the runtime truthful and singular:

- one runtime path only
- one persisted state model only
- one node execution contract only
- one documentation story only

After this plan, sequential systems, branch systems, join systems, and loop systems must all run through the same graph runtime.

Terminology:

- `graph runtime` means the single active execution path in OGSystem
- `LangGraph` is the current backend implementation of that runtime
- `role.mode.*`, `join.mode.*`, and `loop.max.*` are OGSystem metadata, not LangGraph syntax
- `OpenCode` is the current default model executor, not the desired permanent coupling boundary

## 1. Target End State

The repository should converge to this shape:

- `system.mmd` defines orchestration and bindings
- `parse-mermaid.ts` compiles all systems into one graph-oriented IR
- `graph IR / execution plan` defines OGSystem semantics independent of the backend library
- `adapter.ts` is only the composition root
- `graph runner` is the only execution engine
- `role executor` owns node execution
- `executor` abstraction owns model/tool execution boundary
- `run-artifacts.ts` owns persistence and audit projections
- `state.json` always persists graph-oriented state

Hard rules:

- no runtime branch between `minimal` and `langgraph`
- no `SystemDefinition.engine` split
- no OGSystem DSL metadata interpreted as backend-specific public syntax
- no duplicate role execution logic in multiple files
- no docs describing two active runtime engines

## 2. Non-Goals

Do not combine this migration with unrelated expansion work.

- do not add new DSL syntax beyond compatibility handling
- do not redesign law semantics in the same PR series
- do not add new join/routing modes in the same PR series
- do not replace LangGraph as the backend during the same migration
- do not optimize disk I/O until the runtime shape is stable

## 3. Execution Order

1. Freeze the single-runtime architecture contract
2. Remove dead `minimal` state-machine code
3. Extract shared node execution services
4. Restore type safety in the graph runner
5. Lock regression coverage for the unified runtime
6. Split post-P0 work into bounded parallel streams
7. Finalize artifact policy, recovery ergonomics, and documentation truth
8. Run full verification and freeze the new contract

## 3.1 Parallel Workstreams

This plan supports partial parallel execution, but only after the blocking architectural decisions are frozen.

### Critical Path

These should be treated as mostly serial:

- `P0.1` → `P0.2` → `P0.3` → `P0.4` → `P0.5`

Reason:

- each step reduces ambiguity for the next step
- parallelizing these too early risks duplicate refactors on moving code

### Parallel-Safe After P0.1

These can start once the single-runtime direction is frozen:

- `P1.3a` decision recording
- historical labeling subset of `P1.8`

Reason:

- they depend on architectural truth, but not on the final internal code split

### Parallel-Safe After P0.3

These can proceed once shared role execution ownership is established, but should stay in audit/decision mode:

- `P1.6` config drift cleanup
- discovery-only portion of `P1.7` artifact write policy

Reason:

- they depend on knowing which module owns execution behavior
- they should not yet change persisted layout or resume semantics

### Parallel-Safe After P0.5

These can be split across separate workstreams with disjoint ownership:

- Stream A: semantics boundary
  - `P1.1`
  - plan-normalization portion of `P1.5`
  - owns `parse-mermaid.ts`, new `execution-plan.ts`, normalized-plan tests
- Stream B: executor boundary
  - `P1.3`
  - role-execution portion of `P1.5`
  - owns `executor.ts`, `opencode-executor.ts`, `role-executor.ts`, executor tests
- Stream C: validation and recovery
  - `P1.2`
  - `P1.4`
  - owns schema validation, repair policy, output-handling tests
- Stream D: docs and config truth
  - `P1.3a`
  - `P1.6`
  - remaining `P1.8`
  - owns `docs/DECISIONS.md`, README, usage docs, config docs/tests

Reason:

- regression coverage should exist before these larger refactors diverge
- each stream should avoid simultaneous edits to `adapter.ts`, session ownership, or run-artifact layout unless explicitly coordinated

### P1.7 Implementation Gate

`P1.7` should be split into two stages:

- Stage 1 after `P0.3`: inventory and decision
- Stage 2 after Streams B and C stabilize: write-path changes, resume tests, and doc updates

Reason:

- artifact layout depends on executor session ownership and failure/recovery policy
- changing file layout too early creates avoidable resume regressions

### Do Not Parallelize

Avoid parallelizing these without a frozen contract:

- changing artifact layout while changing resume logic
- introducing executor abstraction while changing backend semantics and repair policy in the same patch
- mass doc cleanup before decisions are recorded

## 3.2 Risk / Benefit By Phase

### P0 Foundation Reset

Primary benefit:

- removes the highest architectural ambiguity and most dangerous technical debt

Primary risk:

- regressions in run behavior while deleting and moving core runtime logic

Control:

- keep each P0 change set small
- run build/tests after each sub-step
- use grep-based dead-code checks, not only code review

### P1A Semantics And Executor Seams

Primary benefit:

- creates durable boundaries between OGSystem semantics, graph execution, and executor implementation

Primary risk:

- refactors may drift into speculative framework work before the runtime contract is frozen

Control:

- require `P0.5` regression coverage before landing Stream A or Stream B
- avoid backend swaps or DSL expansion in the same phase
- keep parser/plan work separate from executor/session work

### P1B Validation, Repair, And Recovery

Primary benefit:

- turns invalid output and resume behavior into explicit runtime policy instead of incidental failure behavior

Primary risk:

- schema strictness or repair retries can change runtime outcomes and mask real package defects if introduced carelessly

Control:

- land tests first for invalid JSON, schema mismatch, unknown event, and session reload
- keep repair policy narrow and observable
- do not mix repair-policy rollout with artifact layout changes in the same patch

### P1C Artifact, Config, And Doc Truth

Primary benefit:

- removes contributor confusion and makes persisted behavior auditable and supportable

Primary risk:

- cleaning docs or artifacts too early can erase operator-useful information or codify the wrong contract

Control:

- record decisions before broad doc cleanup
- inventory artifact consumers before deleting files
- update docs and tests in the same change whenever persisted layout changes

### P2 Operability And Optimization

Primary benefit:

- improves ergonomics, diagnostics, and maintainability after the architecture is stable

Primary risk:

- premature optimization or cleanup that destroys useful operator-facing artifacts

Control:

- optimize only after artifact contract and resume semantics are explicitly frozen

## 4. P0 Must Do

These items are on the critical path. Do not start feature work before they are complete.

### P0.1 Freeze Single Runtime Architecture

- [x] Confirm the repository uses one active execution entry only
- [x] Remove any remaining branching based on `SystemDefinition.engine`
- [x] Remove `SystemEngine` from runtime types
- [x] Ensure graph metadata is optional OGSystem orchestration metadata, not engine selectors
- [x] Keep legacy `%% engine=langgraph` parsing only as compatibility input, not as required semantics
- [x] Document clearly that LangGraph is the current backend, not the DSL surface

Acceptance:

- [x] `runSystemWithAdapter()` always calls the graph runner
- [x] `SystemDefinition` no longer models multiple runtime engines
- [x] graph metadata semantics are described without claiming they are LangGraph-native syntax
- [x] sequential systems run without any engine flag

Verification:

- [x] `npm run build`
- [x] `npm test`
- [x] run one sequential dry-run example
- [x] run one join/loop dry-run example

### P0.2 Delete Dead Minimal Runtime Code

- [x] Remove the old sequential state-machine implementation from `adapter.ts`
- [x] Remove unused `RuntimeState`-style types and helpers
- [x] Remove dead helper functions tied to the old path:
  - `buildRoleInputProjection()`
  - `persistState()`
  - `mergeRuntimeState()`
  - `findFlowByEvent()`
  - `resolveRolePrompt()`
- [x] Make the fate of `findFlowByEvent()` explicit:
  - delete it entirely if branch lookup is handled inline or by existing graph structures, or
  - move it into a shared helper only if another active runtime path truly needs it
- [x] Remove duplicated audit/prompt/execution logic left over from the old path
- [x] Ensure no dead code remains that suggests dual runtime support

Acceptance:

- [x] `adapter.ts` contains orchestration only:
  - config load
  - repo load
  - run dir init
  - opencode lifecycle
  - resume state load
  - graph runner call
- [x] no unreachable state-machine executor remains in runtime code
- [x] branch-event lookup is either removed with the dead path or retained only as an intentional shared helper outside `adapter.ts`

Verification:

- [x] `rg -n "RuntimeState|mergeRuntimeState" src/runtime`
- [x] `rg -n "buildRoleInputProjection|persistState|mergeRuntimeState|findFlowByEvent|resolveRolePrompt" src/runtime/adapter.ts`
- [x] `rg -n "function findFlowByEvent|findFlowByEvent\\(" src/runtime`
- [x] `npm run build`
- [x] `npm test`

### P0.3 Extract Shared Role Execution Layer

- [x] Create a dedicated `role-executor` module
- [x] Move prompt resolution into the shared execution layer
- [x] Move role input projection into the shared execution layer
- [x] Move model/profile/tool binding resolution into the shared execution layer
- [x] Move noop handling into the shared execution layer
- [x] Move parsed output validation into the shared execution layer
- [x] Choose one canonical naming scheme for prompt input resolution and projection
- [x] Return a typed execution result object instead of ad hoc state patches

Acceptance:

- [x] one role execution implementation serves all graph nodes
- [x] one shared role input projection implementation exists with aligned field semantics
- [x] no duplicated prompt/audit/tool selection logic remains across runtime modules

Recommended shape:

- `role-executor.ts`
- `audit-recorder.ts`
- `executor.ts`
- `graph-runner.ts`

Verification:

- [x] `rg -n "makeAuditRecord|resolveRolePrompt|validateRoleOutputSchema|runCliTool|executeOpencodeModelRole" src/runtime`
- [x] `rg -n "buildRoleInputProjection|resolvePromptInput|resolveRolePrompt" src/runtime`
- [x] inspect that each concern has one primary owner

### P0.4 Restore Type Safety In Graph Runner

- [x] Remove `// @ts-nocheck` from the graph runner
- [x] Replace `z.any()` usage where practical
- [x] Define strict types for:
  - graph state
  - node patch shape
  - branch records
  - stored role results
  - audit payload construction
- [x] Eliminate `as never` casts on the main path

Acceptance:

- [x] graph runner builds under `strict: true`
- [x] state reducers and node outputs are type-checked
- [x] type regressions fail CI

Verification:

- [x] `npm run build`
- [ ] add or update tests around typed state transitions
- [x] no `@ts-nocheck` remains in runtime sources

### P0.5 Lock Regression Coverage For The Unified Runtime

- [x] Add explicit tests for sequential systems on graph runtime
- [x] Add branch routing coverage
- [x] Add join coverage
- [x] Add loop budget coverage
- [x] Add noop-with-law coverage
- [x] Add resume-run coverage on the unified runtime
- [ ] Add OpenCode session recovery coverage on `--resume-run`

Acceptance:

- [ ] the test suite proves there is no hidden dependency on the old minimal path
- [ ] resumed runs correctly reload session records and reuse session ids where expected

Verification:

- [x] `npm test`
- [ ] CI green on clean checkout

## 5. P1 Should Do

These items should start immediately after P0 is stable.

### P1.1 Introduce Backend-Neutral Graph Semantics

- [x] Add an explicit `GraphIR` or `ExecutionPlan` layer between Mermaid parsing and LangGraph compilation
- [x] Compile OGSystem metadata into backend-neutral orchestration semantics first
- [x] Make the LangGraph builder consume the normalized plan rather than raw parsed metadata
- [x] Ensure future routing/join modes can be added without scattering direct backend checks across the runner

Acceptance:

- [x] DSL semantics are no longer encoded as ad hoc `if` branches tied directly to the LangGraph builder
- [x] the repository has a clear seam where another backend could be evaluated later

Verification:

- [x] add tests for normalized plan generation
- [x] ensure graph runner consumes the normalized plan rather than raw parser structures where possible

### P1.2 Replace Shallow Schema Validation

- [x] Replace hand-written object-only validation with a standard JSON Schema validator
- [x] Validate both input and output schemas with the same local validation engine
- [x] Preserve the current distinction:
  - `model.bind` gets generation-time schema guidance from the executor plus runtime validation
  - `exec.bind` gets runtime validation and should gain repair/retry support instead of assuming guided generation
- [x] Preserve actionable error format:
  - file path
  - role id
  - failing field path
- [x] Ensure schema features used in role packages are truly supported

Acceptance:

- [x] runtime behavior matches documented schema contract
- [x] documentation clearly distinguishes generation-time schema guidance from runtime validation
- [x] nested object and enum validation are reliable

Verification:

- [x] add tests for nested output schemas
- [x] add tests for invalid additional properties
- [x] add tests for invalid enum values

### P1.3 Define Executor Abstraction And OpenCode Isolation Boundary

- [x] Introduce an `Executor` interface for model execution
- [x] Keep `OpenCode` as the default implementation behind that interface
- [x] Move executor-specific lifecycle and capability checks behind the abstraction
- [x] Define the minimum contract for executor implementations:
  - start or attach
  - execute structured role prompt
  - abort session
  - return structured execution metadata
- [x] Make OpenCode single-server lifecycle an implementation detail rather than a runtime-wide assumption
- [x] Define the executor contract explicitly:
  - required methods
  - parameter and return types
  - session management boundary
  - cleanup boundary
- [x] Decide whether executor registration is needed now or later

Acceptance:

- [x] OGSystem runtime depends on an executor contract, not directly on OpenCode implementation details everywhere
- [x] OpenCode remains the default path without remaining the only architectural shape

Verification:

- [x] executor tests cover OpenCode implementation
- [x] runtime entry path compiles against the abstract executor contract

### P1.3a Record Architecture Decisions Explicitly

- [x] Create `docs/DECISIONS.md`
- [x] Record at least these active decisions:
  - why OGSystem uses one graph runtime
  - why LangGraph is the current backend implementation
  - why OpenCode is the current default executor
  - semantic fan-out vs actual compute concurrency
  - which parts are public runtime contract vs implementation detail

Acceptance:

- [x] contributors can find the current architectural truth without reading historical plans first

Verification:

- [x] `docs/DECISIONS.md` exists and is linked from README or usage docs

### P1.4 Add Output Repair And Recovery Policy

- [x] Define repair policy for invalid role output:
  - invalid JSON
  - schema mismatch
  - unknown event
- [x] Support at least one automated repair attempt where safe
- [x] Decide when to fail fast vs when to allow retry
- [ ] Leave a clean hook for future human-in-the-loop correction

Acceptance:

- [x] invalid output handling is a deliberate policy, not only an immediate hard failure
- [x] repair/retry behavior is explicit and test-covered

Verification:

- [x] tests for invalid JSON repair path
- [x] tests for unknown event recovery or deliberate failure
- [x] docs describe repair boundaries clearly

### P1.5 Split The Graph Runner By Responsibility

- [ ] Keep the graph runner filename and public entry shape aligned with the single-runtime story
- [ ] Complete the runner decomposition started by `P0.3`:
  - leave role execution in `role-executor.ts`
  - keep graph construction and orchestration in the runner
  - move remaining node-closure helper concerns into smaller pure helpers where they still remain in the runner
- [ ] Split remaining runner-local logic into smaller pure helpers:
  - prompt input projection
  - join readiness
  - loop budget resolution
  - branch activation
  - audit assembly
  - state projection
- [ ] Keep the top-level graph builder readable

Acceptance:

- [ ] role execution ownership remains outside the graph runner after `P0.3`
- [ ] no single graph node handler contains every remaining concern
- [ ] pure helpers are individually testable
- [ ] the runner remains primarily responsible for graph construction and state orchestration, not prompt/tool/model execution details

Verification:

- [ ] targeted unit tests for join readiness and loop budget helpers
- [ ] top-level runner delegates join readiness, loop budget, branch activation, audit assembly, and state projection to named helpers or modules
- [ ] inspect that prompt resolution, role input projection, and executor binding do not regress back into the runner

### P1.6 Clean Runtime Config Drift

- [x] Remove fields that are declared but not implemented
- [x] Or implement them fully if they are required now
- [x] Re-evaluate:
  - `linkSharedIntoRoleDir`
  - any unused runtime defaults
  - compatibility-only settings that no longer matter
- [x] Make an explicit decision on `linkSharedIntoRoleDir`:
  - remove it as dead config, or
  - implement it as supported behavior

Acceptance:

- [x] `types.ts`, config validation, docs, and runtime behavior are 1:1 aligned
- [x] no field remains "declared but ignored"

Verification:

- [ ] config tests for every remaining runtime field
- [x] docs/examples updated accordingly

### P1.7 Define Run Artifact Write Policy

- [ ] Audit which files are runtime-consumed, human-facing latest projections, and per-execution history
- [ ] Confirm which files are read on `--resume-run`
- [ ] Decide intentionally whether dual-write into both `roleDir/` and `executions/<id>/` should remain
- [ ] Keep the current latest-per-role projection only if it is part of the supported run contract
- [ ] Record the decision explicitly for each latest-per-role file class:
  - runtime-consumed
  - operator-facing latest snapshot
  - per-execution history only
- [ ] If write duplication is reduced, update tests and docs together rather than treating it as an invisible internal change
- [ ] Re-evaluate `sessions.json`, `roleDir/session.json`, and `executionDir/session.json` ownership and purpose

Acceptance:

- [ ] every persisted file has a declared reason to exist
- [ ] no write path remains purely accidental
- [ ] artifact retention policy is documented and test-covered

Verification:

- [ ] docs name the supported run artifact contract
- [ ] tests assert only files that are intentionally part of that contract

### P1.8 Unify Documentation Story

- [x] Update README to describe one runtime only
- [x] Update usage manual to describe graph runtime as default
- [x] Mark legacy `exec.bind` as compatibility mode, not peer architecture
- [x] Remove wording that implies `minimal` is still an active engine
- [x] Align examples with the new default semantics
- [x] Separate active docs from historical design notes
- [x] Mark outdated plans as historical, archived, or superseded instead of leaving them as live guidance
- [x] Archive or clearly mark as historical:
  - `docs/semantic-kernel-v1.md`
  - `docs/opencode-single-serve-multi-session-plan.md`
- [x] Decide whether `docs/xlgraph-subset-compatibility.md` remains an active compatibility contract or should be marked historical
- [x] Verify no remaining docs imply a hand-written FSM is the target architecture
- [x] Explicitly distinguish:
  - OGSystem graph semantics
  - LangGraph backend implementation
  - semantic fan-out vs actual compute concurrency

Acceptance:

- [x] a new reader sees one architecture, not two competing ones
- [x] a reader can tell which docs are source-of-truth vs historical context
- [x] no reader is misled into assuming semantic branch activation equals backend parallel compute
- [x] `xlgraph` wording is either maintained as a live compatibility claim with clear scope, or clearly marked as historical and removed from source-of-truth doc lists

Verification:

- [ ] `rg -n "minimal runtime|engine=langgraph|two layers|current LangGraph runtime path" README.md docs`
- [ ] `rg -n "xlgraph" README.md docs`
- [ ] historical docs are labeled consistently
- [ ] if `docs/xlgraph-subset-compatibility.md` is historical, README no longer presents it as an active runtime doc

## 6. P2 Later Improvements

These are worthwhile, but only after the single-runtime migration is complete.

### P2.1 Improve Audit And Error Composition

- [ ] Introduce a shared audit recorder / event recorder abstraction
- [ ] Consolidate repeated failure-path audit construction
- [ ] Standardize execution result vs execution error payloads

Acceptance:

- [ ] failure handling is composable and consistent

### P2.2 Optimize Persistence Strategy

- [ ] Measure current per-transition disk write cost
- [ ] Decide whether batching or staged flush is needed
- [ ] Preserve correctness and recoverability first

Acceptance:

- [ ] any optimization keeps `state.json` and `events.ndjson` trustworthy

### P2.3 Expand DSL Only After Versioning Strategy Exists

- [ ] Define DSL versioning before adding new syntax
- [ ] Consider future support only if there is a real need:
  - conditional routing
  - richer join modes
  - subgraph sugar
  - child-system references

Acceptance:

- [ ] syntax growth does not break existing `.mmd` systems silently

### P2.4 Introduce Mode Handler Registry Before Adding New Semantics

- [ ] Add a registration mechanism for routing and join semantics
- [ ] Stop encoding every new mode as a hard-coded branch in the runner
- [ ] Use the registry only after the normalized graph semantics layer is stable

Acceptance:

- [ ] future modes such as `any_of` do not require editing every core runner branch

### P2.5 Consolidate Shared JSON Utility Functions

- [ ] Remove duplicated `readJsonFile` implementations where they are semantically identical
- [ ] Consolidate JSON loading used by:
  - `role-repo.ts`
  - `model-repo.ts`
  - `run-artifacts.ts`
- [ ] Keep one shared utility per responsibility instead of per-module copies

Acceptance:

- [ ] runtime JSON loading behavior is consistent across modules

Verification:

- [ ] `rg -n "async function readJsonFile" src/runtime/`
- [ ] shared JSON-loading callers use one intentional implementation per responsibility

### P2.6 Review Example Config Duplication Deliberately

- [ ] Audit whether repeated `laws.json` and `user-profile.json` files are useful scenario-local examples or unnecessary duplication
- [ ] Extract shared example fixtures only where deduplication improves maintainability without hiding scenario intent
- [ ] Audit legacy console examples separately:
  - `examples/console-laws.json`
  - `examples/console-profiles.json`
  - `examples/console-tools.json`
  - `examples/console-system.mmd`
- [ ] Decide whether console examples remain supported compatibility demos or become deprecated examples

Acceptance:

- [ ] examples stay readable
- [ ] duplicated example config is either deliberate or removed

### P2.7 Maintain Role Inventory Clarity

- [ ] Classify role packages as production-like examples, test-only, demo-only, or historical
- [ ] Decide whether test-only roles should remain in `og-roles/` for simplicity or move under test fixtures
- [ ] Document the decision so future contributors do not mistake test roles for product roles

Acceptance:

- [ ] role package inventory is understandable without guessing from names alone

### P2.8 Strengthen Recovery And Diagnostics UX

- [ ] Expand `doctor` and run inspection capabilities around persisted run state
- [ ] Add commands or documented procedures to inspect:
  - run status
  - active/completed branches
  - executor session state
  - resume prerequisites
- [ ] Treat recovery ergonomics as part of the runtime contract, not only an internal implementation detail

Acceptance:

- [ ] a failed or interrupted run can be diagnosed with documented steps and stable artifacts

### P2.9 Expand Doctor Coverage

- [ ] Extend `run:doctor` to validate:
  - role package completeness
  - model package completeness
  - law references
  - runtime config presence and shape
  - executor availability
- [ ] Add output that clearly separates errors, warnings, and compatibility notes

Acceptance:

- [ ] `run:doctor` becomes a practical preflight check for both contributors and users

## 7. Detailed Task Checklist

### 7.1 Code Changes

- [ ] `src/runtime/types.ts`
  - remove old engine split
  - keep only graph-oriented state contracts
- [ ] `src/runtime/parse-mermaid.ts`
  - parse all systems as graph systems
  - keep compatibility read for `%% engine=langgraph`
  - reject unsupported metadata cleanly
- [x] `src/runtime/execution-plan.ts` or equivalent
  - normalize parsed system metadata into backend-neutral graph semantics
- [x] `src/runtime/adapter.ts`
  - keep only composition-root responsibilities
  - remove dead sequential runtime code
- [x] `src/runtime/executor.ts`
  - define executor abstraction
- [x] `src/runtime/opencode-executor.ts`
  - implement executor contract cleanly
- [x] `src/runtime/langgraph-runner.ts` or `src/runtime/graph-runner.ts`
  - remove `@ts-nocheck`
  - split helpers
- [x] `src/runtime/role-executor.ts`
  - centralize node execution behavior
- [x] `src/runtime/role-repo.ts`
  - replace shallow schema validation
- [ ] `src/runtime/run-artifacts.ts`
  - confirm the persisted contract still matches the unified runtime
  - document and implement the chosen latest-vs-history write policy
- [x] shared utility module(s)
  - consolidate duplicated JSON file readers where appropriate

### 7.2 Test Changes

- [x] parser tests reflect graph-default semantics
- [x] normalized execution-plan tests exist
- [x] branch tests prove sequential/branch systems still work
- [x] law tests cover noop and forbidden tool behavior
- [x] model runtime tests cover graph-default dry-run and run artifacts
- [x] executor tests cover OpenCode implementation behind the executor abstraction
- [x] repair-policy tests cover invalid JSON, schema mismatch, and unknown event handling
- [x] resume tests cover persisted `graphState` recovery
- [ ] resume tests cover session record reload and session reuse where applicable
- [ ] artifact contract tests reflect the chosen write policy rather than accidental file layout

### 7.3 Doc Changes

- [x] README updated
- [x] usage manual updated
- [x] examples updated
- [x] docs explicitly distinguish semantic fan-out from actual compute concurrency
- [x] any obsolete minimal-runtime planning docs either archived or marked historical
- [x] docs taxonomy explains:
  - source-of-truth runtime docs
  - implementation checklists
  - historical design notes
- [x] legacy console examples are marked as compatibility demos or deprecated explicitly

## 8. Verification Commands

Run these before marking the migration complete.

```bash
npm run build
npm test
```

Dead code sanity checks:

```bash
rg -n "SystemEngine" src/runtime
rg -n "@ts-nocheck" src/runtime
rg -n "buildRoleInputProjection|persistState|mergeRuntimeState|findFlowByEvent|resolveRolePrompt" src/runtime/adapter.ts
rg -n "linkSharedIntoRoleDir" src/runtime/
```

Expected result:

- `SystemEngine`, `@ts-nocheck`, and dead minimal-runtime helper checks should return no active hits when their corresponding items are complete.
- `linkSharedIntoRoleDir` should either return no hits after removal, or only aligned hits across supported code/tests/docs if intentionally implemented.

Optional late-phase cleanup check:

```bash
rg -n "async function readJsonFile" src/runtime/
```

Sequential system sanity check:

```bash
npm run run:adapter -- \
  --system tests/fixtures/mermaid/branch-system.mmd \
  --profiles tests/fixtures/profiles/branch-profiles.json \
  --tools tests/fixtures/tools/branch-tools.json \
  --laws tests/fixtures/laws/law-branch.json \
  --prompt "branch routing" \
  --dry-run
```

Graph join/loop sanity check:

```bash
npm run run:adapter -- \
  --system examples/langgraph-debate-current/system.mmd \
  --laws examples/langgraph-debate-current/laws.json \
  --user-profile examples/langgraph-debate-current/user-profile.json \
  --prompt "是否应继续保持 OGSystem 最小化并延后 reducer 与恢复语义？" \
  --dry-run
```

Model-binding sanity check:

```bash
npm run run:adapter -- \
  --system examples/target-model-binding-system.mmd \
  --prompt "讨论当前架构是否继续最小化" \
  --dry-run
```

## 9. Done Criteria

- [ ] one active runtime path exists in code and docs
- [ ] no dead minimal-runtime executor remains
- [ ] a backend-neutral graph semantics layer exists
- [ ] an executor abstraction exists between runtime and OpenCode
- [ ] graph runner is type-checked without `@ts-nocheck`
- [ ] node execution logic has one primary implementation
- [ ] invalid output handling has an explicit repair/fail policy
- [ ] runtime docs match actual behavior
- [ ] build passes
- [ ] tests pass
- [x] dry-run examples pass
- [ ] resume behavior remains valid

## 9.1 Done Evidence

These checks should all be runnable or inspectable at sign-off time.

Box-checking rule:

- A box is complete only when backed by at least one concrete proof source.
- Preferred proof sources:
  - passing command
  - automated test
  - grep result
  - inspectable file or doc change

- [x] `npm run build` passes
- [x] `npm test` passes
- [x] `rg -n "SystemEngine" src/runtime` returns no hits
- [x] `src/runtime/adapter.ts` shows one graph-runner handoff and no runtime-engine branching
- [x] `rg -n "@ts-nocheck" src/runtime` returns no runtime hits
- [x] `rg -n "RuntimeState|executeRoleNode|mergeRuntimeState|buildRoleInputProjection|persistState|resolveRolePrompt" src/runtime/adapter.ts` returns no dead-path hits
- [x] `docs/DECISIONS.md` exists and is linked from active docs
- [x] README and usage docs describe one active runtime path only
- [x] historical docs are clearly labeled historical, archived, or superseded
- [x] artifact contract is documented in an active doc and matched by tests
- [x] sequential dry-run example passes
- [x] join/loop dry-run example passes
- [x] model-binding dry-run example passes
- [x] at least one resume test covers graph state reload
- [ ] at least one resume test covers session record reload where applicable
- [ ] artifact contract tests match the chosen artifact persistence policy

## 10. Sign-Off Checklist

- [ ] architecture review complete
- [ ] implementation review complete
- [ ] docs review complete
- [ ] regression suite green
- [ ] migration notes captured
- [ ] residual risks documented

## 11. Residual Risks To Track

These risks may remain even after the migration is complete.

- OpenCode single-server lifecycle may remain a run-level bottleneck even behind an abstraction
- LangGraph remains the backend implementation dependency until a second backend is actually proven
- graph runner complexity may still be high even after helper extraction
- schema strictness changes may surface latent role-package defects
- documentation cleanup may lag behind code if not enforced in the PR checklist
