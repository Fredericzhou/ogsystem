# OGSystem Constitution and Rules v2

Status: Contract Set v2 normative baseline (release status is tracked by the acceptance documents)

`current` means this is the active v2 governance baseline; it does not mean that the release gate
has passed or that the product is released.

This is the governance entry point for the direct v2 replacement. The sole architecture standard is
[Role Execution Architecture](role-execution-architecture.md); the sole Workspace machine contract
is [V2 Workspace Contracts](v2-workspace-contracts.md); the release acceptance baseline is
[V2 Validation and Acceptance](v2-validation-and-acceptance.md). The Release UAT checklist records
execution evidence and sign-off against that baseline; it does not define another acceptance model.

## Authority

1. The Constitution and `DECISIONS.md` form the governance layer at the top of the normative chain;
   `DECISIONS.md` defines immutable choices and controls conflicts within that layer.
2. The Role Execution Architecture defines the v2 model and layer boundaries.
3. V2 Workspace Contracts define Workspace fields, states, events, provenance, manifests, and APIs.
4. Workspace Design defines target collaboration behavior.
5. V2 Validation and Acceptance defines the required validation evidence.
6. Release UAT defines execution status, responsibility, and final sign-off.
7. The implementation Runbook defines implementation and operations steps only.
8. Backend native tools documentation is an Adapter mapping reference only.
9. Source code and executable tests report implemented behavior; they do not override the normative chain.
10. `archive/` and `todo-backlog.md` do not define v2 behavior.

## Core Rules

- Every persisted v2 contract root carries `ogsContractVersion: 2`.
- Business Role Contracts contain responsibility, inputs, outputs, acceptance, and failure semantics.
- Technical execution is configured through Harness Templates. `allowedTools` belongs only there.
- Flow is the only source of routable events. HandoffProjection is read-only and explicit.
- Runtime computes and freezes `verifiedTools`, `allowedTools`, EffectiveEnvironmentPolicy,
  capability/policy digests, staging identity, and recovery identity before Backend startup,
  enforcing a fail-closed subset check (`allowedTools ⊆ verifiedTools`, rejecting unverified tools with
  `V2_READINESS_TOOL_MISSING`) and resource checks; the effective executable tool set (`allowedTools`)
  exists only in Runtime memory.
- Permission decisions are only `allow` or `deny`; tool approval never becomes Human Review.
- Unknown, dynamic, unavailable, or unenforceable capabilities fail closed.
- Evidence is append-only. Review decisions are CAS-bound to run, lineage, branch, loop, and state.
- v1 roots, schemas, `exec.bind`, `profiles.json`, `tools.json`, `local_shell`, `noop`, and
  `allowedToolsByRoleId` are rejected. There is no migration, compatibility reader, or dual write.

## Change Procedure

Update the canonical source, focused tests, runtime evidence, and active documentation together.
Before release, execute the cutover gates and both production workflows in the validation document.
