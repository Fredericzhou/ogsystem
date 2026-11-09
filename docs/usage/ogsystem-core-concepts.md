# OGS Core Concepts

Status: active product concept contract

治理边界和不可违反规则见 [OGSystem Constitution and Rules](../development/ogsystem-constitution-v1.md)。
本文只定义产品词汇、所有权和 Role-first 图模型，避免与运行语义手册重复。

This document defines the terms used by OGS product and semantic documentation. It prevents
implementation assets, process responsibilities, and runtime facts from being described as the
same thing.

## Product Boundary

OGS is an event-driven, persistent extended state-machine workflow runtime for collaboration among
abstract responsibility roles. It models which stable responsibilities cooperate, the events and
contracts that connect them, and the durable facts of a run. A Role execution emits an event and
structured data; the Runtime applies the state transition and selects the matching Flow. Branches,
Joins, Loops, human review, checkpoints, recovery, and audit extend the state machine beyond a
simple finite-state model. LangGraph is the current execution engine behind this boundary; it is
not the public OGS semantic model or DSL. OGS is not an HR directory, an organization chart, or a
system for identifying specific people.

An actual person, model, service, or tool may realize a responsibility through an execution
binding or an external governance integration. That realization is not the identity of the OGS
role and does not change the process graph.

## Product Layers And Assets

| Term | Contains | Does not contain |
| --- | --- | --- |
| **Framework** | Runtime core, parser/compiler, CLI, and `nl2mmd`. | Role library, model library, Vis UI, or product-site data. |
| **Platform** | Framework plus model adapters/catalog, installed role library, and the professional workbench. | User teams, projects, or project run history. |
| **Team** | A reusable static collaboration definition: roles, relationships, handoffs, loops/branches, execution bindings, and team metadata. | Framework code, credentials, workspace materials, task runs, or `.ogs/runs`. |
| **Run** | One dynamic execution attempt of a released Team version, bound to one run workspace and its inputs, state, artifacts, and audit evidence. | The static Team definition, a business Task, or the whole Project. |
| **Collaboration Project** | One project work directory, shared materials, released Team versions, business Tasks, and their Run attempts. | A Team editor or a second Team structure embedded in the project. |
| **Product Site** | Platform plus team repository/factory, collaboration projects, users, materials, Tasks, and Runs. | A second runtime. |

The operating boundary can also be read by ownership:

| Area | Owns | Does not own |
| --- | --- | --- |
| **Framework** | Parsing, compilation, execution, recovery, CLI, and natural-language structure generation. | Teams, projects, users, or run records. |
| **Platform** | Framework, backend/model discovery, shared role resources, and OGS Studio. | User project data, team business records, or project run history. |
| **Team** | Reusable responsibilities, role relationships, handoff graph, loop/branch semantics, and run rules. | Work directories, project materials, credentials, or Run instances. |
| **Collaboration Project** | One project workspace, shared materials, mounted Team versions, and Task list. | Editing a released Team definition or owning its Run workspace. |

In the product, **Projects** is the business-facing area for projects, materials, and Tasks. **Studio** is the professional area in the same Team Site shell for team editing, debugging, and run diagnosis. This is a product navigation distinction, not a second Runtime or a change to the ownership model above.

The product site stores editable teams in the team factory and released versions in the team
repository. A project mounts one or more released versions and keeps its own resources and Task
list. A **Task** is a user's business work request bound to one mounted Team version; each execution
attempt is a separate **Run**. One successful Run completes the Task once applicable acceptance
conditions are met. Retry after failure or abnormal termination keeps the same Task and creates
another Run. Pause, review interruption, and checkpoint recovery resume the same Run. The same
Runtime Core serves the product site and the professional workbench; Runtime itself does not define
the Team Site Task entity.

Task is not a reusable task template or scheduler definition. Runtime Run remains the durable
execution record and is never renamed to Task in Runtime APIs or storage.

The domain relationships are:

```text
Project 1 -- * mounted Team versions
Project 1 -- * Tasks
Task 1 -- 0..* Run attempts
Run * -- 1 Team version
Run 1 -- 1 run workspace
Project 1 -- 1 project workspace
```

A Run freezes the selected Team version, project inputs, and execution fingerprint at start.
Later Team releases or Project attachment changes must not alter the meaning of an existing Run.
The Run workspace isolates runtime artifacts, not arbitrary writes to a shared target directory or
external systems. Model-native file and command tools are still subject to the Role's workspace
capability policy: write access and command execution are separate grants, and backend permission
prompts cannot widen the execution workspace. A per-Run Git worktree is a possible code-change
isolation mechanism, but Team Site does not currently create or manage one automatically; external
effects still require sandboxing or explicit permissions.

Team validation confirms the static structure and supported topology; it does not certify provider
connectivity or credentials. Project readiness is a separate, read-only projection of static
execution blockers and warnings. Current project scheduling allows at most one task in preparation,
execution, pause, or human-review state at a time.

The portable team package format is `team-v2`. It contains the static released team definition
and excludes framework code, credentials, model catalogs, `.ogs/runs`, logs, checkpoints, review
records, and other execution history. Collaboration project packages use `project-v2` and embed
their released `team-v2` dependencies. The stable on-disk framework contracts remain `.ogs/`,
`og-roles/`, `system.mmd`, and `.ogs/runs/`.

## Role-first Graph Contract

The OGS graph is intentionally **role-first**:

- A graph node is one stable Responsibility Role / Responsibility Seat. In product language, it
  may be presented as a team responsibility. A configured Executor (agent, model, person, service,
  or tool) performs that responsibility under its Role Contract.
- A `Flow` is a direct role-to-role handoff. The source role completes its responsibility and
  hands an event, outcome, or contracted context to the target role.
- The edge label carries the event, handoff outcome, or error route. The event is not a node.
- Events, actions, tasks, gateways, process steps, branches, run instances, and runtime states
  must not be modeled as Responsibility Role nodes. Keep those concepts in Role Contracts, edge
  labels, runtime overlays, or run details.

The canonical graph shape is therefore:

```text
start[开始] -> Responsibility A --handoff event--> Responsibility B -> end[结束]
```

The role graph describes stable accountability and collaboration boundaries. It does not expand
an agent's internal task list into process-step nodes. Add another role only when there is a
distinct responsibility, capability, input/output contract, or audit boundary.

## Core Terms

| Term | Meaning | Is not |
| --- | --- | --- |
| **System** | A versioned, bounded collaboration system: roles, transitions, contracts, policies, and runtime boundary. | A host process, organization, or one run. |
| **Responsibility Role** | A stable, unique responsibility seat in a System. `roleId` identifies the seat. Exactly one current executor is bound to the seat in an effective System configuration. | A person, task, event, process step, gateway, runtime instance, or the executor's personal identity. |
| **Responsibility Seat** | The static graph position occupied by one Responsibility Role in one System. In the current graph it is the rendered role node. | A BPMN gateway/event or a runtime instance. |
| **Executor** | The current agent bound to a Role; it may represent a person, an agent service, or a bounded System. The assignment is one-to-one within one effective System configuration. | The stable Role/seat identity. Replacing an executor does not rename or replace the Role. |
| **Role Package** | Versioned implementation material associated with a role, such as prompt, manifest, and I/O schema. | The responsibility or executor identity. A package may change while the role identity remains stable. |
| **Flow / Transition** | A declared event-bearing, role-to-role handoff. The source role completes work and transfers the contracted outcome to the target role. | An event node, action node, process step, message participant, or execution instance. |
| **Project** | The resource and execution-history boundary that mounts Team versions and owns business Tasks and Runs. | A Team definition or a single Run workspace. |
| **Run** | One dynamic execution attempt of a Team version with a run workspace, state, artifacts, and audit evidence. | A Team graph, a business Task, or a Branch. |
| **Branch / Lineage** | Runtime execution identity and ancestry inside one Run. `branchId` identifies one active path; `lineageId` scopes related paths. | A static role, Team, Project, or business responsibility. |
| **Role Execution Record** | One durable record of one role activation in one run/branch/lineage/loop context. | The role definition or seat. |
| **Control-plane principal** | An external identity recorded for an operator action, such as a human-review decision. | A Responsibility Role. It never becomes a graph node merely by being recorded in audit. |

Human review and control actions are attributed to a `control-plane principal` resolved by the
active identity provider. Caller-supplied actor labels are not authentication and are not accepted
as audit identity. The `actor` wire field is populated from the resolved principal ID.

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

An OGS System is a bounded collaboration system: it declares abstract Responsibility Roles, their collaboration routes, contracts, and policies. It is not an organization chart, team roster, or identity directory. A Role is a stable responsibility, while a Role Package is the implementation asset that realizes it for a run. An actor is a control-plane principal, not a Role assignment.

Every `role.json` carries an OGS-owned Role Contract (`contractVersion: 1`). It defines purpose, responsibility boundaries, pre/postconditions, events, state writes, review control actions, tools, failure codes, and required audit evidence. JSON Schema 2020-12 structures payload contracts; CloudEvents and OpenTelemetry/W3C Trace Context are external event and observability projections. BPMN 2.0.2 / ISO/IEC 19510 task, event, gateway, and participant vocabulary and ISO 9001 responsibility/evidence practices are conceptual alignments only. RACI, RAPID, DACI, and DDD bounded context are practices, not OGS standards implemented by this runtime.
