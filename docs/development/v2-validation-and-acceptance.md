# Contract Set v2 Validation and Acceptance

> **Status: Contract Set v2 release acceptance standard.** This document defines the evidence
> required for the active direct replacement and does not accept v1 data or compatibility paths.

## 1. Purpose

OGSystem v2 is accepted only when it demonstrates both of these properties:

```text
Explicit collaboration
  Roles exchange declared events, data, and authorized Workspace references through a durable Flow.

Production usefulness
  A real team can use the system to complete and review software and documentation work,
  with reproducible execution evidence and recoverable failures.
```

Passing schema or adapter tests alone is insufficient. The release must pass semantic,
technical, and production-workflow gates using one final v2 code and schema state.

### Workspace terminology boundary

`Artifact`, `Final Artifact`, and `ArtifactReference` are not V2 public concepts. Public fields and
acceptance evidence use `WorkspaceRef`, Run evidence, and Release materialization. The authoritative
Workspace version is a Git commit, including Git LFS objects; the final downloadable result is a
Release materialization with a digest. Any remaining old field in an active schema, API, UI, or
acceptance record blocks the V2 cutover. No compatibility aliases, migration readers, or dual-write
paths are allowed.

## 2. Three Acceptance Gates

### Gate A: Semantic Conformance

Verify that the Business Layer remains deterministic and explicit:

- Role Contract contains responsibility, inputs, outputs, acceptance, failure semantics, and business review actions only.
- Flow is the only source of routable transitions and registered Business Events.
- HandoffProjection transfers only declared context mappings, Flow Contract payloads, and authorized
  `WorkspaceRef` values.
- No prompt history, workspace path, raw tool output, or implicit shared memory crosses a Role boundary.
- Branch, Join, quorum, Loop, automatic retry, rework, rejection, termination, and recovery preserve lineage and state versions.
- `round`, `loopIteration`, `lineageId`, `branchId`, and `stateVersion` remain distinguishable in Review evidence.
- Ambiguous routes, missing mappings, missing required Workspace references, and stale decisions fail closed.

### Gate B: Execution and Evidence Conformance

Verify the Technical Binding and Execution Layers:

- Role -> Harness Template -> Backend -> Model -> `allowedTools` -> EnvironmentIntent resolves without v1 fields.
- Capability Preview and Run Capability Snapshot contain only verified Backend facts.
- Explicit `allowedTools` entries that are unavailable or unenforceable fail before Backend startup.
- `allowedTools`, `verifiedTools`, EffectiveEnvironmentPolicy, staging root, Law digest, capability digest,
  policy digest, Harness revision, and Adapter version are frozen in the Run configuration.
- Recovery reuses the frozen configuration and does not rediscover or silently change capabilities.
- Codex completes discovery, staging, resource probes, native mapping, tool events, permission
  decisions, errors, and recovery tests for its verified tool profile. OpenCode is verified for
  text-only execution and business handoff; filesystem/process tools remain degraded until its
  staging boundary is proven.
- Pi and Kimi remain unavailable or degraded until their probes pass. Claude is not a verified Backend.
- Unknown tools, dynamic MCP/tool-search requests, unbounded resources, staging escapes, and
  unauthorized Workspace reference reads are denied and audited.
- Studio/debug simulation uses a text-only Harness (`allowedTools=[]`, `filesystem=none`,
  `process=deny`, `network=deny`) and never promotes simulated capability facts into a Run
  Snapshot. Real deliverable-producing classic teams default to the verified Codex staging profile;
  OpenCode/Pi remain text-only unless their Adapter proves the requested resource boundary.
- Review decisions are idempotent and CAS-bound to `reviewId`, `round`, `lineageId`, `branchId`,
  `loopIteration`, and `stateVersion`.
- Evidence is append-only and includes the v2 version fields and the normalized tool/permission events.

### Gate C: Production Workflow Value

At least two real workflows must pass with real verified Backends and real deliverables:

1. **Software development workflow**
   - Start from a real repository, issue, or change request.
   - Use at least two collaborating Roles, such as planner, implementer, tester, reviewer, or release owner.
   - Use explicit handoff data and at least one authorized Workspace reference or repository change.
   - Produce a reviewable code diff, tests or verification output, and delivery notes.
   - A reviewer confirms the result against acceptance criteria before promotion.

2. **Documentation workflow**
   - Start from a real documentation request and source material.
   - Use separate Roles for research/outline, drafting, review, and finalization where appropriate.
   - Produce the final document as a Release materialization with links, structure, terminology, and completeness checks.
   - A reviewer confirms that the document is usable by its intended audience and that unsupported claims are traceable.

### Real-team and real-project coverage

The four built-in teams must each complete both a real Studio Sandbox run and a new formal Project
Run. Coverage is distributed by capability; a team is not required to exercise every capability in
one graph, but every capability must be produced by at least one real Project/Task/Run.

| Built-in team | Required real Project coverage | Required Workspace evidence |
| --- | --- | --- |
| `cross-backend-review-loop` | Two verified Backends execute different Roles, exchange a projected `WorkspaceRef`, and complete a real review or rework decision | Run ID, Project/Task IDs, Backend snapshots, WorkspaceRef, review decision, evidence and Release result |
| `management-consulting` | Multiple specialist Roles work in parallel, converge into synthesis and quality review, and produce a real document or structured file package | Role arrivals, Join evidence, source commit, materialization manifest, output digest, preview and download |
| `software-team` | Roles modify a real repository in parallel; a same-file conflict is created and resolved; a large-file fixture exercises Git LFS; the Run is interrupted and resumed | `baseCommit`, role commits, `join_conflict`, `mergeCommit`, LFS pointer/object evidence, recovery checkpoint, Release record |
| `structured-debate` | Proposition and opposition both execute in a real Run, branch outcomes converge, loop or review behavior is exercised, and a final brief is published | Both Role execution records, branch/quorum/loop evidence, decision background, final commit and materialization digest |

The project coverage pack must also include, across these real Runs:

```text
linear execution
parallel edits to independent paths
same-file text conflict
same-path LFS/binary serialization
branch and Join
quorum decision
loop or rework
human review
checkpoint interruption and resume
restore commit
stale canonical HEAD rejection
Release materialization failure and recovery
WorkspaceRef authorization failure
```

No row is closed by a graph preview, mocked model response, manually inserted event, or API-only
smoke test. Each Workspace row requires a real Project ID, Task ID, Run ID, commit reference,
materialization manifest or failure code, and browser evidence where the workflow is user-facing.

The formal Project coverage is closed only when the run ledger also records the Workspace and
execution facts needed to reproduce the result: `workspaceId`, `worktreeId`, `baseCommit`, role
commits, `mergeCommit`, `releaseCommit` when present, `canonicalRefUpdated` when applicable,
decision/event evidence, checkpoint references, materialization manifest and digest, output digest or
`failureCode`, and the download reference when published. A single successful Run does not close a
failure or recovery case; each companion Run retains its own Run ID and result.

### Real-run scenario mapping

The semantic matrix below must be represented in the real Project pack as well as in deterministic
contract tests. A Run may cover several rows, but the named team must produce the listed evidence.

| Semantic scenarios | Real team/project coverage |
| --- | --- |
| S1, S3, S4, S12, S13, S15 | `cross-backend-review-loop`: two verified Backends, explicit projection, WorkspaceRef allow-set, readiness failure, and denied access attempt |
| S2, S7, S8, S10, S11, S19 | `structured-debate`: both branches execute, quorum/late arrival is recorded, loop/rework and Review decisions are visible, and terminal aggregation is recovered |
| S5, S6, S17 | `management-consulting`: parallel specialist Roles, Join/QA, document and media delivery, materialization and download verification |
| S5, S14, S15, S16, S18 | `software-team`: independent worktrees, interruption/resume, fail-closed tools and paths, code delivery, conflict/timeout compensation |
| S9 | A readiness or failure companion Run in the owning Project: automatic retry exhaustion is recorded and Human Review does not expose retry as a manual action |

The Debug History view is part of the real-run acceptance, not a visual-only check. For a Run with
branch, Join, quorum, loop, or Review decisions, the browser must show a compact collapsed list with
stable rows and secondary typography, then show expanded decision background, Role/node arrival time
and status, selected route/action, quorum calculation, lineage and loop fields, evidence/commit
references, and final state. The same event facts must be available from the supported read boundary
after refresh, while model request, token, and transport events remain excluded from the business event
list.

The workflows must complete through the actual Studio/CLI or supported product path. Mock model
responses, synthetic success events, and a graph preview without a delivered result do not pass
Gate C.

### Current Evidence Status

The engineering execution portion of Gate C is passed for both required workflows. The attached
evidence record [`v2-gate-c-real-workflow-success-2026-11-16.md`](evidence/v2-gate-c-real-workflow-success-2026-11-16.md)
records real Codex `gpt-6-luna` Runs, frozen capability/policy configuration, sealed run evidence,
verification reports, and reviewer decisions. Gate C remains a release gate until the
[Release UAT checklist](release-uat-checklist.md) contains the required workflow-operator and
product-owner sign-offs. Historical v1 validation records, archived Team Site tests, API-only
smoke runs, and dry-run graph previews do not satisfy this gate. A row marked `Blocked` or `Not run`
is an outstanding release blocker.

The cross-Backend business-flow requirement is also exercised by the immutable evidence record
[`v2-cross-backend-real-workflow-2026-11-16.md`](evidence/v2-cross-backend-real-workflow-2026-11-16.md):
Codex `gpt-6-luna` executes the first Role and OpenCode's provider-qualified `gpt-6-luna` executes
the downstream Role in the same Flow. Pi has probe and adapter coverage, but is not claimed as a
verified production Backend until its complete staging, resource, tool, permission, and recovery
evidence is recorded. Earlier failed Codex/OpenCode attempts remain failure evidence and are not
hidden by the latest successful Codex/OpenCode run.

The latest engineering regression baseline is `pnpm test`: 450 passed and 1 skipped;
Team Site tests: 35 passed; `pnpm build` and `git diff --check` also pass. These are code-quality
signals only. They do not replace the immutable Run evidence above or the required human release
signatures.

## 3. Semantic Scenario Matrix

Each scenario requires a fresh v2 Run and a recorded result. Scenarios may share fixtures only when
the fixture is immutable and its digest is recorded.

| ID | Scenario | Required assertion |
| --- | --- | --- |
| S1 | Linear handoff | Registered event, typed data, and declared input/output schema reach the next Role only through the Flow. |
| S2 | Event and condition routing | Each registered event and condition selects the correct edge; unknown or ambiguous routes stop the Run. |
| S3 | Context projection | `context.map` passes only declared fields; undeclared upstream data is unavailable. |
| S4 | Authorized file-reference handoff | Default transfer is empty; declared and authorized references transfer; missing or unauthorized references block handoff. |
| S5 | Parallel split | Branches receive isolated staging, lineage, and session context. |
| S6 | All-of Join | All required source outcomes are durable; late, skipped, or failed sources follow the declared Join policy. |
| S7 | Quorum Join | The threshold is reached exactly once and late arrivals remain evidence without changing the committed result. |
| S8 | Loop budget | `loop_exhausted` enters Review; `continue` obeys loopBudget; rework, reject, and terminate use declared targets and scope. |
| S9 | Automatic retry exhaustion | Runtime automatic retries honor the compiled retry policy; Human Review never exposes `retry`, and the remaining exception policy applies after exhaustion. |
| S10 | Explicit Review | Approve, rework, and reject block or route the declared handoff; duplicate and stale decisions are rejected. |
| S11 | Loop-budget Exception Review | `loop_exhausted` exposes only its declared continue, rework, reject, and terminate actions; targets and terminate scope come from the compiled binding. Other exception Review triggers remain Deferred. |
| S12 | Cross-Backend handoff | Two verified Backends execute different Roles in one Flow without Backend-specific fields entering Business or Semantic IR. |
| S13 | Capability readiness | Missing Model, missing tool, unsupported resource boundary, or invalid Harness binding prevents Backend startup. |
| S14 | Run freeze and recovery | Crash/restart resumes from the original Snapshot, policy, staging identity, and Review scope. |
| S15 | Fail-closed security | Unknown tools, dynamic tools, path escapes, denied resources, and unauthorized Workspace references are blocked and audited. |
| S15a | Harness advanced parameters | `variant` and requested `reasoningEffort` are validated against the selected Backend/model; `auto` is resolved by the Adapter and request/effective values remain technical facts. |
| S16 | Real software delivery | A code change is produced, tested, reviewed, and promoted or explicitly rejected. |
| S17 | Real documentation delivery | A usable document is produced, reviewed, materialized, digest-verified, and delivered with traceable evidence. |
| S18 | Join timeout and compensation | A timed-out or failed source follows the declared exception path; retryable infrastructure failure does not silently consume budget or duplicate committed work. |
| S19 | Start and terminal aggregation | Start dispatch, End quorum/ordering, cancellation, and final Result commit occur once and remain recoverable. |

## 4. Cross-Backend Acceptance

Cross-Backend validation is a business-flow test, not a catalog test. It must prove:

```text
Role A -> Harness A -> verified Backend A
Role B -> Harness B -> verified Backend B
Role A result -> explicit Flow handoff -> Role B input
```

The two Harness Templates may use different models and different native tools. The following
must remain identical across the handoff:

- Business Event and Flow routing;
- declared data and Workspace-reference contract;
- Review and recovery semantics;
- audit and Evidence ownership.

Backend-specific session fields, approval modes, tool names, and protocol messages must remain in
the Adapter evidence boundary. A Backend is not considered verified for cross-Backend production
work until the same scenario passes in both directions where the product claims that support.

## 5. Evidence Package

Every passed scenario must attach one immutable evidence package containing:

- v2 code, schema, and fixture digests;
- TeamVersion and Semantic IR digests;
- Run ID and resolved Harness Template revision;
- Harness `backend`, `model`, optional `variant`, requested/effective reasoning effort, and limits;
- Capability Snapshot and `verifiedTools` digest;
- `resolved-config.json` with `allowedTools`, `verifiedTools`, EffectiveEnvironmentPolicy,
  staging, Law, policy, capability, and Adapter identities;
- Role inputs, outputs, Business Events, HandoffProjection, and Workspace-reference authorization records;
- tool invocation and PermissionDecision events;
- Review request, decision, CAS state, and scope identity;
- checkpoints, recovery/replay output, and final Run status;
- production deliverables, verification reports, code diff or document package;
- operator and product-owner sign-off for Gate C.

Evidence without a reproducible Run identity, required Workspace reference or Release materialization,
or human sign-off cannot close a production acceptance scenario.

## 6. Release Rules

The v2 cutover is blocked when any of the following is true:

- any Gate A semantic scenario is not passed;
- any Gate B security, recovery, readiness, or Evidence scenario is failed or unverified;
- fewer than one software and one documentation workflow pass Gate C;
- cross-Backend collaboration is claimed but only one verified Backend was exercised;
- a scenario relies on mocks, hidden host state, unrecorded manual edits, or an unavailable Backend;
- a required scenario is marked Blocked or Not Run;
- a high-severity authorization, data-integrity, recovery, or audit issue remains open.

Performance and capacity thresholds are not invented without a product commitment. For each real
workflow, record duration, token/model usage when available, materialization size, event count, disk use,
peak memory, and operator effort. Product owners decide whether the observed workload is acceptable
or requires a separate capacity target.

## 7. Execution Order

```text
Schema and contract fixtures
  -> semantic scenario suite
  -> Adapter capability/readiness suite
  -> Run freeze/recovery and Evidence suite
  -> cross-Backend scenario
  -> real software workflow
  -> real documentation workflow
  -> product-owner and workflow-operator sign-off
  -> direct v2 cutover
```

Historical v1 UAT remains archived background. This document is the active v2 acceptance baseline.
