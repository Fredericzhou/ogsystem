# OGSystem Decisions

Status: Contract Set v2 current

These decisions are subordinate to the v2 Constitution and the Role Execution Architecture.

## D1: Direct Replacement

Contract Set v2 is a breaking replacement. Runtime reads only roots marked
`ogsContractVersion: 2`; released v1 data is archived and is not migrated or imported.

## D2: One Business and Execution Model

Role Contract, Business Graph/Flow, HandoffProjection, Harness Template, Runtime Policy, and
Evidence are the only v2 objects. Backend, Adapter, Capability, Policy, and Permission are
execution modules, not additional product layers.

## D3: Harness and Capability Freeze

`allowedTools` is the Harness selection set. Capability Discovery produces verified Backend facts;
Runtime intersects those facts with EnvironmentIntent, Law, staging, and quota in memory. Persisted
Run facts contain `allowedTools` and `verifiedTools`; the executable intersection is recomputed only
from those frozen facts during execution and recovery.

## D4: Fail Closed

Missing model, unavailable tool, unsupported resource boundary, dynamic tool request, path escape,
stale Review decision, or unauthorized Artifact blocks the operation and writes evidence.

## D5: Product and Evidence Gates

Studio, CLI, API, tests, examples, and manuals use v2 roots and Harness bindings. Release requires
semantic scenarios, Backend/Adapter probes, freeze/recovery evidence, cross-Backend collaboration,
one real software delivery, and one real documentation delivery as defined by the acceptance plan.

Historical v1 decisions are retained at `archive/v1/DECISIONS-v1.md` for implementation archaeology.
