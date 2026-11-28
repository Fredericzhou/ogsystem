# OGSystem v2 Usage Manual

This manual describes the active Contract Set v2 workflow. Start with the [v2 architecture](../development/role-execution-architecture.md)
and [v2 acceptance standard](../development/v2-validation-and-acceptance.md).

## Authoring

Create a Business Graph whose nodes reference v2 Role Contracts. Declare events, context mappings,
Flow Contracts, WorkspaceRef projections, Join/Loop rules, and Human Review actions explicitly.
Persist technical execution in a v2 Harness Template and Execution Binding root:

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "harnessTemplates": {
    "default": {
      "templateId": "default",
      "backend": "codex",
      "model": "gpt-6-luna",
      "allowedTools": [],
      "environment": {"filesystem": "read_only", "process": "deny", "network": "deny"}
    }
  },
  "roles": {"planner": {"kind": "harness", "harnessTemplate": "default"}}
}
```

Role Contracts must carry `ogsContractVersion: 2` and must not contain Backend, native tool,
permission profile, `exec.bind`, or local command fields. Native tool selection is never authored
on a Role.

## Run and Recovery

At Run start, Runtime discovers the selected Backend, verifies the model and native tools, creates
staging, calculates the effective policy, and writes a frozen `resolved-config.json`. The snapshot
contains `allowedTools`, `verifiedTools`, EffectiveEnvironmentPolicy, adapter/capability/policy
digests, and recovery identity. Runtime enforces fail-closed subset validation (`allowedTools ⊆ verifiedTools`) and checks resources in memory. Resume uses
those records and does not rediscover or widen access.

## Evidence and Review

Role results carry a registered Business Event, declared data, and authorized WorkspaceRef values or
Run evidence references. A Project records collaboration outcomes through its Task Runs and shared
Workspace; verified files are materialized from committed Workspace content for access and download.
Evidence events are append-only. Human Review decisions are idempotent and bound to the Review
scope (`reviewId`, round, lineage, branch, loop iteration, and state version).

## CLI and API

The active API prefix is `/api/v2`. Team and project package labels such as `team-v2` identify
containers; the contract marker is always `ogsContractVersion: 2`. v1 endpoints and package roots
are rejected.

The installed CLI exposes the following operational entry points:

```bash
ogs doctor --system system.mmd --ogs-dir .
ogs models discover --ogs-dir .
ogs models sync --ogs-dir .
ogs serve --ogs-dir .
ogs vis --ogs-dir .
ogs run start --system system.mmd --input "smoke" --dry-run
ogs run resume <run-id>
ogs run review list <run-id>
```

`ogs doctor` checks local readiness, `ogs models discover|sync` refreshes the local backend/model
catalog, and `ogs serve` manages interactive Sessions. `ogs vis` starts the read-mostly run
visualizer. `ogs run start --visualize` is the temporary visualizer mode for one run. For a source
checkout, contributor-only helpers are `pnpm run run:doctor`, `pnpm run run:nl2mmd`, and
`pnpm run lint:system`; installed operators should use the `ogs` commands above.

## Verification

```bash
pnpm build
pnpm test
```

For production evidence execute the semantic scenarios and representative collaboration workflows in
`v2-validation-and-acceptance.md`. A dry-run graph preview does not count as evidence of a completed
collaboration outcome.

Historical v1 operating instructions are archived at `docs/usage/archive/usage-manual-v1.md`.
