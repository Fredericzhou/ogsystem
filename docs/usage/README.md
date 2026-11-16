# OGS Product Manual

This directory contains current product-facing documentation: team and project usage, installation
and daily operation, runtime/orchestration contracts, data projection, and natural-language team
authoring guidance.

Start with the [OGSystem Constitution and Rules](../development/ogsystem-constitution-v2.md), then
the [v2 Usage Manual](usage-manual.md) for the product boundary and runtime workflow.

See [开始分发与结束汇聚](multi-entry-and-terminal-output.md) for the structural Start/End contract,
terminal quorum behavior, cancellation rules, and stable result ordering.

For installation, single-host production checks, backups, recovery, and OS scheduler recipes, see
[Single Host Production Runbook](single-host-production.md).

The core modeling rule is role-first: a graph node is a responsibility role/seat, and a Flow is the
direct handoff from one completed role to another. Events, actions, process steps, and runtime facts
belong on flows or in run details, not as Role nodes.

For the user-facing workflow start with [Team Site guide](../../apps/team-site/README.md), then use
[Usage manual](usage-manual.md). The Team Site guide is the
current source for team repository, team factory, collaboration project, task controls, and Tailnet
entry points.

For semantic work, use the [v2 architecture](../development/role-execution-architecture.md),
[v2 acceptance standard](../development/v2-validation-and-acceptance.md), and [v2 usage manual](usage-manual.md).
Former v1 manuals and template catalogs are archived and retained only for rejection fixture maintenance.

- Current guidance lives in this directory.
- Current product contracts and verification guidance live in the manuals and UAT checklist.
- Active development plans and implementation rules live in `../development/`.
- Code and tests remain the final authority when this manual and implementation disagree.

The constitution and development decisions define boundaries; this directory defines product-facing
meaning and operation. Release records provide evidence for a snapshot and do not override either.
