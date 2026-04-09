# Implementation Checklist: Role / Model / OpenCode / LangGraph

Date: 2026-04-09  
Status: phase-1 runtime complete; LangGraph execution pending

## Goal

Move `OGSystem` toward this target:

- `system.mmd` owns orchestration
- `role repo` owns role semantics
- `model repo` owns execution configuration
- `user profile` owns delivery preference
- `OpenCode` is the default executor
- each role runs in an independent process
- each run is persisted under `.ogsystems/`
- future `LangGraph` support is added on top of a stable runtime contract

This checklist is ordered by dependency, not by desirability.

## A. Must Do First

These items are on the critical path. Do not start real `LangGraph` execution work before these are stable.

### A1. Freeze Semantic Boundaries

- [x] Finalize terminology:
  - `role repo`
  - `model repo`
  - `user profile`
  - `system`
- [x] Declare the hard rule:
  - `role` is semantic
  - `model` is execution
  - `user profile` is delivery preference
  - `system` is orchestration
- [x] Document priority order:
  - `law > system binding > role contract > user profile > role/model preference`
- [x] Explicitly ban:
  - role hard-binding a model
  - user profile selecting model id
  - model package containing role persona

Acceptance:

- one spec document exists and is treated as the source of truth
- naming drift between docs is eliminated

### A2. Define Run Directory As The Runtime Contract

- [x] Freeze `.ogsystems/<run-id>/` layout
- [x] Freeze top-level files:
  - `run.md`
  - `request.md`
  - `system.mmd`
  - `state.json`
  - `events.ndjson`
  - `audit/summary.md`
  - `audit/transitions.md`
- [x] Freeze per-role files:
  - `role.md`
  - `inbox.md`
  - `prompt.md`
  - `result.json`
  - `outbox.md`
  - `audit.md`
  - `private/`
- [x] Specify which files are:
  - runtime-owned
  - role-owned
  - shared read/write

Acceptance:

- the same run can be inspected by humans and tooling without ambiguity
- file names are stable enough for automation

### A3. Define OpenCode Process Contract

- [x] Specify how one role execution launches one `OpenCode` process
- [x] Define working directory policy:
  - current cwd is shared workspace
  - role private dir is process cwd
  - shared dir is linked or mounted into the role dir
- [x] Define environment variables:
  - `OGSYSTEM_RUN_DIR`
  - `OGSYSTEM_SHARED_DIR`
  - `OGSYSTEM_ROLE_DIR`
  - `OGSYSTEM_ROLE_ID`
  - `OGSYSTEM_MODEL_ID`
  - `OGSYSTEM_ALLOWED_EVENTS`
- [x] Define process I/O contract:
  - prompt source
  - stdout/stderr capture
  - expected JSON output file or stdout contract
  - exit code semantics

Acceptance:

- every role run is reproducible from its directory contents
- process launch rules are deterministic

### A4. Introduce Model Repo

- [x] Create `og-models/models/<modelId>/model.json`
- [x] Define minimal `model.json` contract:
  - `modelId`
  - `executor`
  - `model`
  - `args`
  - `timeoutMs`
  - `maxOutputBytes`
  - `tags`
- [ ] Move current execution-specific configuration out of `profiles/tools`
- [x] Keep `OpenCode` as default executor in the first version

Acceptance:

- the system can resolve `modelId` without needing `tools.json`
- execution configuration is reusable across systems

### A5. Introduce System-Level Model Binding

- [x] Add `model.bind.<roleId>=<modelId>` to the target system spec
- [x] Keep compatibility plan for `exec.bind.<roleId>` during migration
- [x] Define conflict rule if both exist:
  - recommend `model.bind` wins
- [x] Update parser/runtime design docs accordingly

Acceptance:

- each role can be bound to a distinct model package
- model choice is explicit in `system.mmd`

### A6. Freeze Authoritative State Model

- [x] Define `state.json` as the authoritative persisted run state
- [x] Define `events.ndjson` as append-only event log
- [x] Treat `md` files as human-readable projections, not the source of truth
- [x] Define recovery minimum:
  - current stage
  - completed roles
  - pending roles
  - last selected events
  - loop iteration

Acceptance:

- a crashed run can be reasoned about from persisted state
- future resume logic has a stable substrate

## B. Do Next

These items should start after section A is stable.

### B1. Extend Role Contract

- [x] Add `talent` to `role.json`
- [x] Add `preferredModelTags` to `role.json`
- [x] Keep them as soft hints only
- [x] Inject `user_profile` into prompt rendering
- [x] Clarify which prompt fields are runtime-generated vs role-authored

Acceptance:

- role packages remain semantic and portable
- user profile is available without leaking execution config into the role

### B2. Add User Profile Layer

- [x] Define `.ogsystem/user-profile.json`
- [x] Freeze minimal fields:
  - `userProfileId`
  - `language`
  - `style`
  - `riskPreference`
  - `outputLength`
  - `domainBackground`
- [x] Define prompt injection rules
- [x] Define safety rule:
  - user profile may change wording and detail
  - user profile must not change routing constraints

Acceptance:

- user delivery preference is explicit and reusable
- model selection remains independent

### B3. Add Runtime Config

- [x] Define `.ogsystem/runtime.json`
- [x] Freeze:
  - `executor`
  - `roleRepo`
  - `modelRepo`
  - `runsDir`
  - `sharedDir`
  - workspace policy
  - common `OpenCode` args
- [x] Add default auto-discovery rules:
  - current cwd is shared workspace
  - `.ogsystem/` is runtime config root

Acceptance:

- common commands become short
- runtime behavior is discoverable without many CLI flags

### B4. Add Validation Tooling

- [x] Add validator for:
  - `system.mmd`
  - role package existence
  - model package existence
  - user profile shape
  - law existence
- [x] Add compatibility checks:
  - `model.bind` role coverage
  - output schema event enum alignment
  - missing run-contract files
- [x] Keep validation reusable from CI and local CLI

Acceptance:

- invalid system assemblies fail before runtime execution

## C. Parallelizable Work

These can run in parallel once section A is reasonably stable.

### C1. Documentation

- [x] update usage manual for target architecture
- [x] add worked examples:
  - one linear system
  - one branching system
  - one future LangGraph design-only system
- [x] document run directory inspection workflow

### C2. Role Repo Cleanup

- [ ] align role ids and node ids where possible
- [x] add shared input schema conventions
- [x] add event enum to more `output.schema.json` files
- [x] remove stale terminology like `profile` from role docs

### C3. Model Repo Seed Set

- [x] create a minimal model catalog:
  - `fast-gpt54`
  - `deep-o3`
  - `claude-sonnet`
- [x] define consistent tag vocabulary:
  - `fast`
  - `reasoning`
  - `long-context`
  - `low-cost`

### C4. OpenCode Runtime Experiments

- [x] test role-private workspace behavior
- [ ] test shared directory write collisions
- [ ] test prompt size growth over multiple rounds
- [ ] test audit file usefulness for progressive loading

## D. Do Only After The Runtime Contract Is Stable

These are important, but should not be implemented first.

### D1. Real LangGraph Parallel Execution

- [ ] lower Mermaid metadata into actual parallel branches
- [ ] support `all_of` join
- [ ] add branch-aware audit records
- [ ] persist branch-local state

Prerequisite:

- authoritative persisted state model is already stable

### D2. State Merge / Reducer Semantics

- [ ] define join input shape
- [ ] define reducer semantics
- [ ] define deterministic merge order
- [ ] define conflict policy

Prerequisite:

- real parallel execution exists

### D3. Loop Resume Semantics

- [ ] define loop iteration record
- [ ] define loop carry-over state
- [ ] define loop termination rule
- [ ] define replay/recovery behavior

Prerequisite:

- branch/join persistence is already stable

## E. Do Not Do Yet

These items are likely to create churn if started too early.

- [ ] do not optimize for remote role/model repos before local contracts are stable
- [ ] do not add complex auto-selection logic from role talent to model binding yet
- [ ] do not make user profile influence routing or law semantics
- [ ] do not make markdown files the only runtime truth
- [ ] do not implement broad plugin/tool abstractions if executor is effectively fixed to `OpenCode`
- [ ] do not add deep LangGraph metadata support to the current minimal parser before runtime semantics exist

## F. Recommended Execution Order

1. Freeze semantics and naming
2. Freeze `.ogsystems/` directory contract
3. Freeze `OpenCode` process contract
4. Introduce `model repo`
5. Introduce `model.bind`
6. Freeze authoritative state files
7. Add `user-profile.json`
8. Add runtime auto-discovery
9. Add validators and CI checks
10. Start real LangGraph execution work

## G. Definition Of Done For Phase 1

Phase 1 should be considered done only if all of these are true:

- [x] a system can bind each role to a model through `model.bind`
- [x] current working directory is treated as shared workspace
- [x] each role execution gets a private directory
- [x] each role execution persists prompt, result, and audit files
- [x] run-level authoritative state is persisted
- [x] user profile is injected but does not control model selection
- [x] docs and validators match the runtime contract
- [x] the design remains minimal and local-first
