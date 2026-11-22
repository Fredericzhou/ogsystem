# OGSystem Decisions

Status: Contract Set v2 normative decisions (release status is tracked by the acceptance documents)

`current` here means that these decisions are the active normative baseline. It does not mean that
the V2 release gate has passed or that the product is released.

These decisions record the immutable v2 choices made under the v2 Constitution. The Constitution
and this document form the governance layer at the top of the normative chain; within that layer,
this document is authoritative for immutable decisions. The Role Execution Architecture, Workspace
contracts, design, acceptance, and implementation guidance must conform to these choices and cannot
redefine them.

For conflicts across active documents, the normative order is Constitution and `DECISIONS.md`
(`DECISIONS.md` controls immutable choices within the governance layer) -> Role Execution
Architecture -> V2 Workspace Contracts -> Workspace Design -> V2 Validation and Acceptance ->
Release UAT -> Implementation Runbook. The Implementation Runbook is last and cannot add a field,
state, event, API, or architecture rule.

## D1: Direct Replacement

Contract Set v2 is a breaking replacement. Runtime reads only roots marked
`ogsContractVersion: 2`; released v1 data is archived and is not migrated or imported.

## D2: One Business and Execution Model

Role Contract, Business Graph/Flow, HandoffProjection, Harness Template, Runtime Policy, and
Evidence are the v2 Role/Execution model's core product objects. Workspace contract records
(`WorkspaceRef`, Checkpoint, Lock, Release, Manifest, and Event) are governed by
`v2-workspace-contracts.md`; they are not additional product layers. Backend, Adapter, Capability,
Policy, and Permission are execution modules, not additional product layers.

## D3: Harness and Capability Freeze

`allowedTools` is the Harness selection set. Capability Discovery produces verified Backend facts;
Runtime intersects those facts with EnvironmentIntent, Law, staging, and quota in memory. Persisted
Run facts contain `allowedTools` and `verifiedTools`; the executable intersection is recomputed only
from those frozen facts during execution and recovery.

## D4: Fail Closed

Missing model, unavailable tool, unsupported resource boundary, dynamic tool request, path escape,
stale Review decision, or unauthorized WorkspaceRef blocks the operation and writes evidence.

## D5: Product and Evidence Gates

Studio, CLI, API, tests, examples, and manuals use v2 roots and Harness bindings. Release requires
semantic scenarios, Backend/Adapter probes, freeze/recovery evidence, cross-Backend collaboration,
one real software delivery, and one real documentation delivery as defined by the acceptance plan.

## D6: One Git + LFS Workspace

Each Project has exactly one Git + LFS Workspace. A Git commit is the only Workspace content-version
fact; Git LFS stores large objects referenced by those commits. The Framework-private Release
materialization store holds verified output records and is not a second Workspace backend or a
Project publication lifecycle.

Contract Set v2 has no persisted-data migration, compatibility reader, dual-write path, or
compatibility alias. The active Runtime accepts only v2 roots and public Workspace content and
delivery boundaries are defined by the Workspace contracts.

Historical v1 decisions are retained at `archive/v1/DECISIONS-v1.md` for implementation archaeology.
