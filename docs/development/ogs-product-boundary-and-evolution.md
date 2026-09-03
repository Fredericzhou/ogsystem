# OGS Product Boundary And Evolution

Status: active architecture guidance
Date: 2026-09-03

This document freezes the scope rule for OGS evolution. OGS keeps a small, strict execution core
and adds domain integrations as independent extensions. A concept is not part of the core merely
because it is useful in BPMN or enterprise organization management.

## Product Position

OGS is a recoverable workflow runtime for collaboration among abstract Responsibility Roles. A
Role is a stable responsibility in a System and may recursively own a bounded nested System. It is
not a person, organization member, model, service instance, or run instance.

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
required in the development-test release:

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
execution is not implemented in this development-test release. Atomic roles must not include
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
   compatible System build under the current strict development-test policy.
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
