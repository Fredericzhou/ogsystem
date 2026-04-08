# Semantic Kernel v1 (Minimal)

Date: 2026-04-09  
Status: stable-minimal

## 1. Scope

OGSystem is a minimal console kernel:

- Authoring DSL: Mermaid flowchart restricted subset
- Runtime engine: explicit state machine
- Compatibility target: semantic naming is a strict subset of `xlgraph`
- Delivery target: minimal, executable, auditable

## 2. Root Semantics

Root semantics:

- `Law`
- `System`
- `AuditTrail`

Derived semantics:

- `SystemState` (runtime snapshot)
- `Stage` (projection from transition history)

## 3. Minimal Semantic Structure

```txt
Law
`- globalLawRef

System
|- systemId
|- systemVersion
|- entryRoleId
|- roleIds[]
|- flows(fromRoleId, eventType, toRoleId)
|- talentBinding? (roleId -> talentRef)
`- executionBinding? (roleId -> executionProfileRef)

Runtime
|- SystemState(status/current/next/final/transitionCount)
`- AuditTrail[] (append-only)

Projection
`- Stage[] (stageId/at/phase/roleId/event/nextRoleId/notes)
```

## 4. Boundary and Flow Semantics

- `input -->|EVENT| Role` defines system entry boundary.
- `Role -->|EVENT| output` defines system terminal boundary.
- `input/output` are boundary tokens, not roles.
- `start/end/done` are not boundary tokens and cannot be role ids.

## 5. Law Semantics

- Runtime resolves only `law.global`.
- Supported constraints:
  - `forbiddenToolRefs`
  - `maxTransitions`
  - `allowNoopWithoutExecutionBinding`
- All violations are recorded in `AuditTrail`.

## 6. Execution Semantics

- `exec.bind.<roleId>` binds one role to one execution profile.
- Profile selects exactly one tool plus optional `timeoutMs` and `maxOutputBytes`.
- Node execution must return strict JSON on stdout:
  - `{"event":"EVENT_NAME","content":"..."}`
  - `event` is required when the role has outgoing flows
  - `content` is optional payload text that becomes `lastOutput`
- Run terminates when:
  - transition target is `output`, or
  - an explicit noop-enabled law allows a no-bind node to move through a single deterministic path.

## 7. Pipeline

```txt
Mermaid DSL
-> parse/validate
-> SystemDefinition (internal IR)
-> law resolution
-> explicit state loop execution
-> SystemState + AuditTrail
-> Stage projection
```

## 8. Non-goals

1. No full platform object family.
2. No recursive child-system runtime in v1.
3. No alias compatibility for `start/end`.

## 9. Runtime Refinements

- The runtime uses an explicit state loop that mirrors `SystemDefinition` directly. Current role, next role, status, and audit trail all live in one runtime state object.
- Tools must emit `{"event":"EVENT_NAME","content":"..."}` on stdout. The runtime parses the full stdout as one JSON object and never falls back to regex or JSONL guessing.
- Nodes without `exec.bind` fail immediately unless the catalog law opts into `allowNoopWithoutExecutionBinding`. Even then, noop only works for terminal or single-outgoing roles.

## 10. P2 Architecture Decision

- Decision: replace LangGraph with a hand-written state loop. The runtime only needs one active cursor, deterministic edge selection, and append-only audit output. A graph framework added type escape hatches and rebuild overhead without adding meaningful execution power for the current kernel scope.
- Trade-off: this lowers abstraction and removes future graph-runtime conveniences, but it keeps the implementation truthful to the current capability surface and easier to audit.
- Benchmark note: no formal throughput benchmark was needed for the current kernel size, but the new design removes an entire graph compile/build phase from every run and keeps runtime startup work linear in the Mermaid role list.

## 9. CN/EN Summary

中文：

- 根语义固定为 `Law / System / AuditTrail`。
- `SystemState` 是运行快照，`Stage` 是运行结果的投影视图。
- 内核只保留最小可运行对象，不扩展到平台级对象族。

English:

- Root semantics are fixed as `Law / System / AuditTrail`.
- `SystemState` is runtime fact and `Stage` is derived projection.
- Kernel scope stays minimal and executable, without platform-level expansion.
