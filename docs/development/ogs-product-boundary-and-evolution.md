# OGS Product Boundary And Evolution

Status: active architecture guidance
Date: 2026-09-03

This document freezes the scope rule for OGS evolution. OGS keeps a small, strict execution core
and adds domain integrations as independent extensions. A concept is not part of the core merely
because it is useful in BPMN or enterprise organization management.

## Product Position

OGS is an event-driven, persistent extended state-machine workflow runtime for collaboration among
abstract Responsibility Roles. A Run persists the current business state and execution frontier;
each Role produces a typed business result, the Runtime applies the result, and the matching Flow
determines the next activation. Branches, Joins, Loops, human review, checkpoints, recovery, and
audit are extensions of this state machine. LangGraph is the current engine implementation behind
the Runtime boundary, while OGS owns the public semantics and durable contracts. A Role is a stable
responsibility in a System and may recursively own a bounded nested System. It is not a person,
organization member, model, service instance, or run instance.

The product execution model is:

```text
Run state -> Role -> event/data -> state reduction -> Flow routing -> next activation
```

```text
Role        = who is responsible
System      = bounded collaboration scope
Transition  = how declared responsibilities cooperate
Branch      = one runtime path
Lineage     = runtime ancestry
Activity    = optional description of what work occurs
Actor       = external control/execution identity, outside core semantics
Authority   = explicit control permission, not implied by responsibility
```

### Ordinary FSM Versus OGS Extended State

An ordinary finite state machine has a finite control-state set and an event transition relation:

```text
(controlState, event) -> (nextControlState, action)
```

OGS keeps this transition core, but uses an explicitly persisted extended state:

```text
(controlState, event, extendedState)
  -> (nextControlState, updatedExtendedState, durableFacts)
```

The extended state carries business data, the original task, per-hop input, active branch and
lineage identity, Join readiness and source results, bounded Loop iteration, review/control state,
checkpoint versions, and audit evidence. A Role emits an event and structured data; reducers and
Flow guards use the extended state to determine the next activation.

This distinction matters for three runtime behaviors:

- Join readiness is a predicate over completed source Roles in one execution scope. Enumerating
  every partial branch combination as an ordinary FSM control state causes state explosion and
  does not preserve the source payload needed by the Join Role.
- A Loop needs a persisted iteration and a maximum budget, plus an exhausted path. A graph back
  edge alone expresses repetition but not bounded, recoverable termination.
- Parallel branches need a runtime frontier with multiple active paths. OGS records this frontier
  as branch and lineage state instead of expanding every combination into a separate graph state.

These are controlled semantic extensions. Semantic IR fixes the state fields, event contracts,
guard shape, Join modes, Loop budgets, persistence, and failure rules; invalid or ambiguous input
fails closed. OGS is aligned with the event/guard/action vocabulary used by UML state machines and
with workflow control-flow concepts such as BPMN gateways and tokens, but it is not a claim of UML
execution-semantic or BPMN XML conformance. LangGraph implements the current adapter boundary;
OGS remains the owner of the Role/Flow, recovery, and audit contracts.

### Value And Necessity Compared With A Workflow DAG

A conventional workflow DAG can be modeled as `G = (V, E)` where `E` is acyclic. Its execution
frontier is a partial order: a node becomes eligible after its predecessor condition is met, and
each node is normally activated at most once in one workflow instance. A fixed DAG provides strong
properties:

- a topological execution order exists;
- termination is structurally guaranteed when every node finishes;
- static critical-path, dependency, and parallel-capacity analysis is straightforward;
- the state space is small and easy to visualize for batch pipelines.

Those properties make a DAG the better default for fixed ETL, build, approval, and batch pipelines.
OGS does not replace that model. An acyclic OGS Team with no Loop and no repeated activation is a
DAG-shaped subset of the OGS semantic space and should be kept simple.

The difference appears when the business contract contains feedback, partial completion, or a
long-lived control decision. An OGS execution is a transition system over extended state:

```text
X_t = (S_t, F_t, L_t, J_t, C_t, H_t, R_t)
X_{t+1} = delta(X_t, event_t)
```

Here `S` is business state, `F` the active branch frontier, `L` lineage, `J` Join scopes, `C` loop
counters/budgets, `H` human-control state, and `R` recovery/audit identity. A DAG can simulate a
bounded loop by unrolling it, but a loop with `M` rounds multiplies the graph by roughly `M`; nested
loops and branch combinations can grow multiplicatively or exponentially. An unbounded loop
cannot be represented by a finite DAG without hiding the loop inside an opaque node. Hiding it loses
Role-level events, per-round input, Join scope, checkpoint, and audit visibility.

The same distinction applies to parallel collaboration. A DAG Join can wait for all static
predecessors, but a quorum Join needs a readiness predicate over unique sources in one
`runId + lineageId + loopIteration` scope and must retain their payloads. A DAG can enumerate each
partial-completion case as a separate node, but the number of cases grows with the source count and
the resulting graph no longer expresses the actual business rule. OGS stores the predicate and
source evidence as data.

| Dimension | Conventional workflow DAG | OGS extended state machine |
| --- | --- | --- |
| Control structure | Acyclic partial order | DAG subset plus bounded cycles, feedback, and repeated Role activations |
| State | Node status and workflow variables | Typed business state, task/input, branch/lineage, Join scopes, Loop budget, review and recovery state |
| Loop | Unroll to a fixed graph or hide inside one node | Explicit bounded Loop Scope with iteration and exhausted route |
| Join | Usually static predecessor completion | `all_of` or `quorum_of` predicate scoped by lineage and loop iteration, with source payload projection |
| Termination | Structural from acyclicity | Guaranteed by explicit budgets, finite work, and fail-closed guards; cycles without a budget are invalid |
| Static analysis | Simpler critical path and capacity planning | Richer runtime semantics, but more state-space and scheduling analysis |
| Recovery/audit | Usually task-level checkpoints | Role execution, event, branch, Join, Loop, checkpoint, and control-plane evidence |
| Best fit | Fixed, predictable batch pipelines | Adaptive AI collaboration, feedback, partial consensus, review, and long-running recovery |

The extension is necessary only when the product promises these semantics at the Role/Flow level.
It is not necessary merely because a workflow uses AI. For a fixed sequence of model calls, a DAG
remains clearer and cheaper. It becomes valuable for AI work when model output is an explicit,
contracted event that can select a route; when reviewers or specialist Roles must iterate; when
parallel opinions require a quorum or synthesis; or when a long-running run must pause, resume, and
explain every attempt. AI outputs are probabilistic, so keeping feedback and uncertainty inside an
opaque DAG node makes routing and failure evidence difficult to inspect. OGS makes those decisions
durable and bounded without turning arbitrary model planning into unbounded graph mutation.

The trade-off is real: OGS carries more state, writes more evidence, and requires stricter semantic
validation than a DAG engine. It should therefore use the smallest model that satisfies the business
contract: keep fixed acyclic work as a DAG-shaped Team, use explicit Join/Loop only for observable
cross-Role semantics, and keep uncertain item-level iteration inside a Role or pre-expansion as
documented by the Heavy Node boundary.

### Social Collaboration And Mathematical Model

OGS models a socialized collaboration relation at the level of responsibilities and handoffs, not
at the level of an employee social graph. A static Team can be represented as a labeled directed
role graph:

```text
R = (V, E, rho, tau, kappa)
```

`V` is the set of stable Responsibility Roles, and each edge in `E` is a possible handoff. `rho`
describes the responsibility boundary, `tau(e)` is the declared business event carried by the
handoff, and `kappa(e)` is the input/output contract and authority boundary. A person, model,
service, or tool may realize a Role through a binding, but it is not the Role vertex. Identity,
authorization, and accountability evidence are separate control-plane projections.

This separation matters socially as well as technically:

- **Responsibility** answers who is accountable for a kind of work.
- **Handoff** answers what outcome is transferred and who may consume it.
- **Coordination** answers whether several responsibilities must all, or only sufficiently,
  contribute before another responsibility acts.
- **Governance** answers who may pause, approve, rework, or terminate a run.

The runtime then adds an execution state to the static relation:

```text
X = (s, b, l, j, c, h, q)
```

`s` is business state, `b` the active branch frontier, `l` lineage, `j` Join scopes, `c` loop
counters/budgets, `h` human-control state, and `q` checkpoint/audit identity. A Role execution is
a labeled transition that consumes an input context and produces an event/data result:

```text
(X, role, input) --event/data--> (X', nextRoles)
```

This is close to a colored Petri-net interpretation: a Role activation is a transition, event/data
is a typed token, parallel branches are multiple tokens, and a Join is a synchronization
transition. `all_of` consumes all declared source tokens; `quorum_of` consumes a threshold of
unique source tokens. OGS does not claim Petri-net conformance; the analogy explains why Join
readiness is state over a set of tokens rather than a single node status.

Social collaboration naturally creates structures that a plain DAG treats poorly:

- peer review and rework are feedback edges;
- several specialists forming a consensus are parallel token production plus Join synchronization;
- an escalation path is a conditional handoff based on business state and authority;
- a human approval pause is a control-plane state that can outlive the process that requested it.

The mathematical gain is that these relations remain explicit and auditable. The mathematical cost
is that the reachable state space grows with active branches, Join combinations, loop budgets, and
review decisions. OGS controls that growth with fixed Role contracts, restricted conditions,
bounded loops, explicit quorum rules, immutable run identity, and fail-closed routing. It therefore
models a bounded socio-technical coordination system, not an unbounded autonomous society or a
general-purpose organization simulator.

## Three Scope Tiers

### Tier 1: OGS Core

These concepts directly determine deterministic execution, recovery, and audit and remain in the
portable Semantic IR:

- `System` and versioned `Responsibility Role/Seat`;
- `Transition` and declared event type;
- `Branch`, `lineageId`, `loopIteration`, and `RoleExecutionRecord`;
- state schema, reducer, condition AST, flow/input contracts;
- fan-out, `all_of`/`quorum_of` Join, bounded Loop, and `ERROR*` flow;
- runtime-native human review control states;
- checkpoint, CAS/idempotency, strict fingerprint, and audit;
- model/tool capability policy as execution governance, not role identity.

The core must run without an HR directory, user identity provider, organization chart, BPMN engine,
or external network.

### Tier 2: Core Enhancements

These are broadly useful but require explicit versioned contracts and focused tests:

- recursive composition: `ownerRoleId -> nestedSystemRef`;
- qualified role references and nested namespaces;
- parent/child input-output contracts and state namespaces;
- explicit error and termination propagation for nested Systems;
- minimal Role scope metadata;
- a small authority policy for review/approve/rework/pause/terminate;
- a unified event envelope with source, target, channel, payload contract, and correlation.

Tier 2 does not introduce people, teams, administrative reporting, or automatic authority
inheritance. A proposal must identify its invariant, failure behavior, digest impact, and
conformance fixtures before implementation.

### Tier 3: Optional Extensions

These remain outside the portable OGS core and are activated only by a concrete requirement:

- `BusinessActivity` and BPMN Activity/Task mapping;
- BPMN XML import/export and BPMN conformance profiles;
- BPMN collaboration participants, pools, lanes, and message choreography;
- Organization/Team/person identity, Assignment, OIDC/SCIM, RBAC/ABAC;
- delegation, proxy, SLA, queue, capacity, and escalation services;
- DMN decision tables and CMMN case management;
- artifact lifecycle, external message brokers, and distributed scheduling.

An extension may map external concepts to OGS roles, but it must not redefine `roleId`, create
synthetic feedback roles, or silently change core routing and recovery semantics.

## Recursive Responsibility Composition

The intended future contract is explicit and minimal:

```ts
type CompositeResponsibilitySpec = {
  ownerRoleId: string;
  nestedSystemRef: string;       // versioned System reference
  inputContract: ContractRef;
  outputContract: ContractRef;
  stateNamespace: string;
  checkpointNamespace: string;
  errorPropagation: "fail" | "route" | "contain";
  terminationPropagation: "propagate" | "contain";
};
```

The compiler must reject unknown references, composition cycles, namespace collisions, undeclared
cross-System data access, and ambiguous completion. A parent Role is responsible for the nested
System's declared scope; child capabilities and control permissions do not automatically inherit.

`SubgraphSpec` currently describes independently versioned subgraphs but is not yet this execution
contract. Until the contract and tests are delivered, recursive composition is a design direction,
not a claimed runtime feature.

## Standards Alignment

OGS uses standards as bounded alignment references:

| Concern | Reference | OGS position |
| --- | --- | --- |
| Process concepts | BPMN 2.0.2 / ISO/IEC 19510:2013 | Concept alignment; Activity, Gateway, Event, and Participant are not automatically Roles. |
| Data contracts | JSON Schema Draft 2020-12 | State, input, output, and event payload validation. |
| Event envelope | CloudEvents 1.0 | Integration envelope; it does not define OGS routing or state transitions. |
| Observability | OpenTelemetry / W3C Trace Context | Trace projection; runtime state and audit remain authoritative. |
| Identity/integration | OIDC, OAuth 2.0, SCIM, RBAC/ABAC | Optional governance integration; no person identity in core IR. |

The current product claim is **OGS Native + BPMN concept-aligned**, not BPMN XML-compatible or full
BPMN conformant.

## Responsibility Role Contract

For multi-agent collaboration, a Role should be treated as a versioned contract rather than a
prompt persona. The contract describes the responsibility boundary and can be realized by a model,
tool, service, or human-operated integration without changing the Role identity.

The current `role.json` manifest uses one flat, strict contract shape. Every section below is
required in the current release:

```json
{
  "roleId": "reviewer",
  "roleVersion": "1.0.0",
  "name": "Reviewer",
  "description": "Reviews a submitted result against declared criteria.",
  "promptTemplate": "prompt.md",
  "outputSchema": "output.schema.json",
  "contractVersion": 1,
  "purpose": "Reviews a submitted result against declared criteria.",
  "responsibility": {
    "kind": "atomic",
    "owns": ["review_decision"],
    "contributes": ["review_findings"],
    "doesNotOwn": ["deployment", "source_document"]
  },
  "inputs": { "preconditions": [] },
  "outputs": {
    "events": ["APPROVED", "REJECTED", "REWORK_REQUIRED"],
    "postconditions": []
  },
  "authority": { "controlActions": ["approve", "rework"] },
  "constraints": {
    "writableStateFields": ["review_decision"],
    "allowedTools": ["document-reader"]
  },
  "failure": {
    "retryableErrorCodes": ["PROVIDER_TIMEOUT", "TEMPORARY_IO"],
    "terminalErrorCodes": ["CONTRACT_VIOLATION"]
  },
  "audit": { "requiredFields": ["decision", "outcome"] }
}
```

The payload contract remains in `output.schema.json`; it is referenced by the manifest path rather
than embedded as an old `inputs.contract` or `outputs.contract` field. Missing contract sections
are invalid input, not a legacy package that the runtime fills in automatically.

`responsibility.contributes` is also schema-bound. Each contribution must be a top-level field in
the System state schema or in the payload schema of an event declared by that Role. A
misspelled or invented contribution is a contract error; it cannot be used as an informal label.
`purpose` describes an abstract responsibility and must not identify a person, provider, model, or
runtime instance. Domain terms such as `human review` and `Model QA` remain valid.
In the illustrative contract below, `review_findings` therefore needs to be declared as a top-level
property in the payload schema of one of the listed output events.

The normative contract sections are:

| Section | Required question |
| --- | --- |
| Identity | Which stable Role is this, and which contract version applies? |
| Purpose | Why does this responsibility exist? |
| Responsibility | Which facts/results does it own, contribute, or explicitly not own? |
| Inputs | Which data, event, and preconditions may it consume? |
| Outputs | Which schema-validated result and events may it produce? |
| Authority | Which business/control actions may it perform, and which are forbidden? |
| Constraints | Which tools, state fields, resources, and time limits apply? |
| Failure | Which failures are retryable, routable, compensatable, or terminal? |
| Audit | Which decision, source version, digest, and outcome evidence is required? |

`responsibility.kind` is mandatory. `atomic` is the current executable form. A `composite` role
must also carry the complete `composition` contract; it is parsed and validated, but nested
execution is not implemented in this release. Atomic roles must not include
composition fields.

Role completion is a runtime fact only after output schema, event, state-write, precondition, and
postcondition checks pass. A model's claim that it is finished is not completion evidence. Roles
must collaborate through declared transitions and payload contracts; they must not depend on hidden
shared memory. Feedback remains an event between existing roles, for example
`A --|FEEDBACK|--> B`, and does not create a feedback Role.

### Contract design rules

1. Name Roles by stable responsibility, not by model family, speed, vendor, or person.
2. Keep inputs, outputs, writable state, events, and tools minimal and explicit.
3. Separate `owns`, `contributes`, `may_decide`, and `may_not_decide` to prevent conflicting writes
   and ambiguous authority.
4. Define preconditions, postconditions, invariants, failure behavior, idempotency, and audit
   evidence independently of the prompt text.
5. Version and digest the contract; changes that affect recovery or routing require a new
   System build under the current strict policy.
6. Test contracts with deterministic fixtures and adversarial invalid outputs without requiring a
   real model or network.

These rules are an OGS synthesis of the references below. They are an OGS contract, not a claim
that any one referenced standard defines AI agent job contracts.

## Reference Catalog

The catalog distinguishes normative standards from industry specifications and management methods.
Links are official publishers or governing communities and are provided for implementation review.

### Process and responsibility boundaries

- [OMG BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2/): task, gateway, event, sequence flow, participant, and collaboration concepts.
- [ISO/IEC 19510:2013](https://www.iso.org/standard/62652.html): international standard publication of BPMN 2.0 process notation.
- [ISO 9001:2015](https://www.iso.org/standard/62085.html): process responsibility, competence, documented information, and corrective action practices.
- [ISO 30408:2016](https://www.iso.org/standard/64150.html): human governance guidance; reference only for governance extensions, not OGS core execution.
- [ISO 21502:2020](https://www.iso.org/standard/74947.html): project management roles, governance, and delivery context.

### Contracts, data, and integration

- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core.html): machine validation for Role input/output and state contracts.
- [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0): HTTP/control-plane API contracts.
- [CloudEvents 1.0](https://github.com/cloudevents/spec/tree/v1.0.2): event context and transport envelope; it does not define OGS routing semantics.
- [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/): trace and metric projection; it does not replace OGS audit or runtime state.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/): propagation of distributed trace context.

### Identity and authorization extensions

- [NIST RBAC project](https://csrc.nist.gov/projects/role-based-access-control): role-based authorization vocabulary; OGS Role responsibility is not an identity account.
- [NIST ABAC guide, SP 800-162](https://csrc.nist.gov/publications/detail/sp/800-162/final): attribute-based authorization for governance integrations.
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html): external identity authentication.
- [OAuth 2.0, RFC 6749](https://www.rfc-editor.org/rfc/rfc6749): delegated API authorization.
- [SCIM 2.0, RFC 7644](https://www.rfc-editor.org/rfc/rfc7644): external identity and group provisioning.

RACI, RAPID, and DACI are useful responsibility-assignment methods but are not ISO or OMG
standards. Domain-driven design bounded contexts are an established software design practice, not
a formal workflow standard. OGS may borrow their vocabulary while keeping the Semantic IR and
runtime contracts authoritative.

## Admission Rules For New Design

A proposal enters OGS Core only when all are true:

1. It changes a cross-system execution invariant or is required for deterministic recovery.
2. It has a stable, implementation-independent IR contract.
3. It runs without a specific organization, identity provider, BPMN tool, or vendor service.
4. It has positive and negative conformance tests, stable diagnostics, and digest/version behavior.

Otherwise classify it as Tier 2 or Tier 3. Do not implement speculative concepts only to increase
standards vocabulary.

## Delivery Sequence

```text
stabilize OGS Core
  -> deliver recursive composition contract
  -> add minimal scope/authority/event refinements
  -> expose BusinessActivity as a projection when needed
  -> add organization, identity, BPMN, DMN, or CMMN integrations per demand
```

This keeps OGS broadly useful for project delivery, expert review, approval, research, and
human-AI collaboration without turning the runtime into an HR system or generic BPMN clone.
