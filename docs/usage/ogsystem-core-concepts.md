# OGS Core Concepts

Status: active product concept contract

This document defines the terms used by OGS product and semantic documentation. It prevents
implementation assets, process responsibilities, and runtime facts from being described as the
same thing.

## Product Boundary

OGS is a recoverable workflow runtime for collaboration among abstract responsibility roles. It
models which stable responsibilities cooperate, the events and contracts that connect them, and
the durable facts of a run. It is not an HR directory, an organization chart, or a system for
identifying specific people.

An actual person, model, service, or tool may realize a responsibility through an execution
binding or an external governance integration. That realization is not the identity of the OGS
role and does not change the process graph.

## Core Terms

| Term | Meaning | Is not |
| --- | --- | --- |
| **System** | A versioned, bounded collaboration system: roles, transitions, contracts, policies, and runtime boundary. | A host process, organization, or one run. |
| **Responsibility Role** | A stable abstract responsibility in a System. `roleId` identifies it. A role answers "which responsibility owns this contribution?" | A person, account, model, service instance, or execution. |
| **Responsibility Seat** | The static graph position occupied by one Responsibility Role in one System. In the current graph it is the rendered role node. | A BPMN gateway/event or a runtime instance. |
| **Role Package** | Versioned implementation material associated with a role, such as prompt, manifest, and I/O schema. | The responsibility itself. A package may change while the role identity remains stable. |
| **Transition** | A declared event-bearing relation between responsibility seats. It defines permitted collaboration and routing. | A new role, message participant, or execution instance. |
| **Branch / Lineage** | Runtime execution identity and ancestry. `branchId` identifies one active path; `lineageId` scopes related paths. | A static role or business responsibility. |
| **Role Execution Record** | One durable record of one role activation in one run/branch/lineage/loop context. | The role definition or seat. |
| **Control-plane principal** | An external identity recorded for an operator action, such as a human-review decision. | A Responsibility Role. It never becomes a graph node merely by being recorded in audit. |

The current `actor` field in review and audit payloads has the final meaning of
`control-plane principal`. Product documentation should use that term when explaining semantics;
the wire field remains unchanged until an explicitly versioned API change is made.

## Recursive Responsibility Composition

A Responsibility Role may be responsible for a nested System. This represents **responsibility
and process composition**, not an administrative reporting line:

```text
project-governance role
  -> delivery System
       -> architecture role
       -> implementation role
       -> quality role
```

The parent role is accountable for the nested System's defined scope. It does not automatically:

- become the specific executor of every child role;
- inherit every child capability or control-plane permission;
- make child roles members of an organizational team;
- imply that child roles are people or that distinct roles require distinct people.

The same principle applies at other scopes. A `project-manager` role can be responsible for a
project System and a `legal-representative` role can be responsible for a company-governance
System. Both are abstract roles. Scope and authority must be explicit when they matter; neither
is inferred from hierarchy or a title.

Current implementation status: OGS has independently versioned `SubgraphSpec` data, but it does
not yet expose a frozen `ownerRoleId -> nestedSystem` execution contract. Documentation must not
claim executable recursive role composition until that contract and its tests are delivered.

## Scope And Authority

Responsibility, scope, and authority are separate concepts:

```text
Responsibility Role = what stable responsibility exists
Scope               = which System or governed boundary it applies to
Authority           = an explicitly granted control action, if any
```

The OGS core currently models responsibility roles and runtime capability policies. It does not
model an organization tree, personnel assignment, legal identity, or a general approval authority
framework. Those are optional external governance concerns. A future governance extension may
map to identity and policy systems, but it must not reinterpret `roleId` as a user identifier.

## BPMN And Standards Boundary

OGS aligns terminology selectively with BPMN 2.0 concepts and ISO/IEC 19510:2013:

| External concept | OGS relationship |
| --- | --- |
| BPMN Activity/Task | A business activity may be assigned to one or more OGS Responsibility Roles. It is not automatically the same as a role. |
| BPMN Gateway/Event | Flow-control semantics. It must not be represented as a Responsibility Role merely to render a graph. |
| BPMN Sequence Flow | May inform an OGS Transition where semantics are equivalent. |
| BPMN Participant/Lane | An external collaboration or organization boundary; it is not an OGS role by default. |
| BPMN Token | At most an approximate mapping to OGS branch/lineage execution facts; OGS does not claim token equivalence. |

OGS is currently **BPMN concept-aligned**, not BPMN XML-compatible or BPMN-conformant. JSON
Schema is used for data contracts; CloudEvents and OpenTelemetry may inform integration and
observability projections. None of those standards replaces OGS runtime semantics, recovery
rules, or the responsibility model.

## Modeling Rules

1. Create a Responsibility Role only for a stable responsibility with its own input/output,
   capability, or audit boundary.
2. Model feedback, delegation requests, review outcomes, and other collaboration acts as
   transitions/events between existing roles unless they create an independent responsibility.
3. Keep business activities, gateways, events, organization structures, and concrete executors
   out of the role graph unless an explicit extension defines their mapping.
4. Never use a role node to represent a branch, an event type, a control-plane operator, or a
   visual routing aid.
5. Preserve the distinction `Role -> Branch -> RoleExecutionRecord` in APIs, persistence,
   visualizations, and documentation.
# System and Role Contracts

An OGS System is a bounded collaboration organization: it declares abstract Responsibility Roles, their collaboration routes, contracts, and policies. It is not an organization chart, team roster, or identity directory. A Role is a stable responsibility, while a Role Package is the implementation asset that realizes it for a run. An actor is a control-plane principal, not a Role assignment.

Every `role.json` carries an OGS-owned Role Contract (`contractVersion: 1`). It defines purpose, responsibility boundaries, pre/postconditions, events, state writes, review control actions, tools, failure codes, and required audit evidence. JSON Schema 2020-12 structures payload contracts; CloudEvents and OpenTelemetry/W3C Trace Context are external event and observability projections. BPMN 2.0.2 / ISO/IEC 19510 task, event, gateway, and participant vocabulary and ISO 9001 responsibility/evidence practices are conceptual alignments only. RACI, RAPID, DACI, and DDD bounded context are practices, not OGS standards implemented by this runtime.
