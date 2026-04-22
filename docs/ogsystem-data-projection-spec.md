# OGSystem Data Projection Spec

Date: 2026-04-12  
Status: landed design record (implemented in runtime; semantics source of truth remains `docs/ogsystem-orchestration-semantics-v1.md`)  
Scope: minimal extension design for projection and quorum joins

## 1. Objective

This spec defines the smallest next-step extension that improves data authorization and join flexibility without introducing a second DSL, hidden reducers, or a new runtime state model.

Target outcomes:

- keep the current prompt input contract stable
- reduce irrelevant context passed to roles
- support `N-of-M` join readiness without adding multiple overlapping join modes
- remain fail-closed and easy to test

## 2. Current Behavior

Current OGSystem behavior remains unchanged when the new metadata is absent.

### 2.1 Ordinary nodes

- `input` is the direct upstream branch `content`
- no full `graphState` is injected into prompts

### 2.2 `all_of` join nodes

- readiness is gated by `join.sources + lineageId + loopIteration`
- `input` is a JSON namespace keyed by `join.sources`
- each source value retains `event`, `content`, and optional `data`

### 2.3 Multi-incoming without join

- there is no implicit merge
- the target role executes once per active branch
- each execution still sees only its own direct upstream context

## 3. Design Principles

### 3.1 Extend the existing metadata surface

Projection and quorum semantics must extend the current `role.mode.*` / `join.mode.*` / `join.sources.*` family.

Non-goal:

- no second syntax such as `@ogs-input` or `@ogs-trigger`

### 3.2 Preserve current defaults

If no projection metadata is provided, current behavior remains exactly the same.

### 3.3 Framework projects, roles consume

Projection is owned by the runtime. Roles consume projected prompt fields but do not query runtime state directly as part of the framework contract.

### 3.4 Fail closed

Invalid selectors, illegal source references, missing required projection fields, or invalid quorum settings must fail validation or execution explicitly. Silent fallback is not allowed.

### 3.5 Do not couple prompt semantics to `state.json` layout

Projection sources are defined in terms of normalized runtime facts, not raw serialization structure. `state.json` is a persistence artifact, not a query language.

## 4. Minimal vNext Surface

This spec intentionally limits the first iteration to two additions:

1. `quorum_of` join readiness
2. field-level read-only context projection

Everything else is deferred.

## 5. Join Semantics

### 5.1 Supported join modes

Current:

- `all_of`

Planned minimal extension:

- `quorum_of`

### 5.2 Metadata

```mermaid
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b,worker_c
%% join.min.review=2
```

Rules:

- `join.min.<roleId>` is required when `join.mode.<roleId>=quorum_of`
- `1 <= join.min <= |join.sources|`
- `join.sources.<roleId>` must not contain duplicate role ids
- `join.sources.<roleId>` must match the join node's Mermaid incoming role edges exactly
- `join.min=1` is semantically equivalent to `any`
- `join.min=|join.sources|` is semantically equivalent to `all`

### 5.3 Readiness contract

Readiness is evaluated by:

- the current `lineageId`
- the current `loopIteration`
- unique completed source roles listed in `join.sources`

Rules:

- count unique source role ids, not arrival attempts
- a join node activates at most once for a given `lineageId + loopIteration`
- late-arriving additional sources are recorded for audit but do not retrigger the join node
- `all_of` remains the strict exact-match mode already implemented

### 5.4 Why no standalone `any_of`

`any_of` is not introduced as a separate first-class mode because it is just `quorum_of + join.min=1`. Adding both would expand the surface without increasing expressive power.

## 6. Projection Semantics

### 6.1 Metadata shape

Projection metadata is attached to the target role:

```mermaid
%% context.map.review.summary=source(worker_a).content
%% context.map.review.risks=source(worker_b).data.risks
%% context.map.review.task=global.task
```

General form:

```txt
context.map.<targetRoleId>.<fieldName>=<selector>
```

### 6.2 Runtime effect

- if no `context.map.<roleId>.*` exists, keep current `input` behavior
- if one or more `context.map.<roleId>.*` entries exist, runtime builds one projected object
- the projected object is serialized into the existing `input` field

This keeps the prompt input contract stable while allowing finer-grained context shaping.

### 6.3 Supported selectors in the first iteration

Ordinary nodes:

- `direct.content`
- `direct.event`
- `direct.data`
- `direct.data.<path>`
- `global.task`
- `global.user_profile`
- `global.user_profile.<path>`

Join nodes (`all_of` / `quorum_of`):

- `source(<roleId>).content`
- `source(<roleId>).event`
- `source(<roleId>).data`
- `source(<roleId>).data.<path>`
- `global.task`
- `global.user_profile`
- `global.user_profile.<path>`

### 6.4 Path rules

To avoid an early complex expression language, the first iteration supports only dot-path lookup over object fields.

Examples:

- `direct.data.summary`
- `source(worker_b).data.risks.primary`
- `global.user_profile.language`

Initial restrictions:

- object fields only
- no array indexing
- no transforms
- no expressions
- no fallback operator

### 6.5 Visibility restrictions

Projection may reference only already authorized runtime facts:

- ordinary nodes may not reference arbitrary ancestors
- ordinary nodes may not reference sibling branches
- join nodes may only reference role ids declared in `join.sources.<roleId>`
- cross-branch reads without an explicit join remain invalid

## 7. Determinism Rules

To keep projection testable and replay-safe:

- projected fields are materialized in stable field-name order
- selector evaluation must be pure and side-effect free
- identical runtime inputs must produce byte-stable serialized `context`
- missing required source fields fail execution with a stable error code

## 8. Failure Model

### 8.1 Validation-time failures

- unknown `join.mode`
- missing `join.min` for `quorum_of`
- invalid `join.min`
- duplicate role ids inside `join.sources`
- `join.sources` does not match the join node's Mermaid incoming role edges
- `source(<roleId>)` referencing a role outside `join.sources`
- `context.map.<targetRoleId>.*` referencing an undefined role
- unsupported selector grammar

### 8.2 Execution-time failures

- selector path does not exist on a required source object
- source result not yet available when a projection is evaluated
- projected payload exceeds future context size limit policy

The first iteration should fail closed instead of auto-filling `null`.

## 9. Out of Scope

The following are intentionally excluded from the first iteration:

- arbitrary ancestor traversal
- sibling projection without join
- `metrics` projection
- `role` identity projection
- raw `state.json` querying
- inline transforms or reducers
- expression language
- array slicing/indexing
- implicit merge for non-join multi-incoming nodes
- policy hot reload through projection metadata

## 10. Recommended Examples

### 10.1 Ordinary node projection

```mermaid
%% context.map.reviewer.brief=direct.data.brief
%% context.map.reviewer.risk=direct.data.risk
%% context.map.reviewer.task=global.task
```

Projected `context`:

```json
{
  "brief": "...",
  "risk": "...",
  "task": "..."
}
```

### 10.2 Quorum join projection

```mermaid
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b,worker_c
%% join.min.review=2
%% context.map.review.summary_a=source(worker_a).content
%% context.map.review.summary_b=source(worker_b).content
%% context.map.review.task=global.task
```

Notes:

- only roles that have actually completed may be projected successfully
- missing source fields fail closed unless the runtime later introduces an explicit optional-field design

## 11. Test Expectations

The implementation of this spec should add contract tests for:

1. default behavior unchanged when no projection metadata is present
2. `quorum_of` readiness with `join.min=1`, `join.min=2`, and `join.min=|sources|`
3. multi-incoming non-join still executes once per active branch
4. join activation occurs once only
5. late arrivals do not retrigger a satisfied join
6. projected field ordering is deterministic
7. invalid selectors fail closed
8. unauthorized source references fail validation

## 12. Usage Guidance

- existing systems using default direct-context or `all_of` join require no changes
- prefer `quorum_of` over introducing a separate `any_of`
- projection metadata should be added only where prompt-noise reduction or audit clarity is materially beneficial
