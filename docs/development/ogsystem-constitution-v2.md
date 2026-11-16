# OGSystem Constitution and Rules v2

Status: Contract Set v2 current

This is the governance entry point for the direct v2 replacement. The sole architecture standard
is [Role Execution Architecture](role-execution-architecture.md); the sole release standard is
[V2 Validation and Acceptance](v2-validation-and-acceptance.md).

## Authority

1. Source code and executable tests define implemented behavior.
2. This constitution and `DECISIONS.md` define governance and ownership boundaries.
3. The Role Execution Architecture defines the v2 model.
4. V2 Validation and Acceptance defines release evidence and sign-off.
5. Backend native tools documentation is an Adapter mapping reference only.
6. `archive/` and `todo-backlog.md` do not define v2 behavior.

## Core Rules

- Every persisted v2 contract root carries `ogsContractVersion: 2`.
- Business Role Contracts contain responsibility, inputs, outputs, acceptance, and failure semantics.
- Technical execution is configured through Harness Templates. `allowedTools` belongs only there.
- Flow is the only source of routable events. HandoffProjection is read-only and explicit.
- Runtime computes and freezes `verifiedTools`, `allowedTools`, EffectiveEnvironmentPolicy,
  capability/policy digests, staging identity, and recovery identity before Backend startup.
  The `allowedTools ∩ verifiedTools` executable set exists only in Runtime memory.
- Permission decisions are only `allow` or `deny`; tool approval never becomes Human Review.
- Unknown, dynamic, unavailable, or unenforceable capabilities fail closed.
- Evidence is append-only. Review decisions are CAS-bound to run, lineage, branch, loop, and state.
- v1 roots, schemas, `exec.bind`, `profiles.json`, `tools.json`, `local_shell`, `noop`, and
  `allowedToolsByRoleId` are rejected. There is no migration, compatibility reader, or dual write.

## Change Procedure

Update the canonical source, focused tests, runtime evidence, and active documentation together.
Before release, execute the cutover gates and both production workflows in the validation document.
