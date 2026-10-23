# OGS Product Manual

This directory contains current product-facing documentation: team and project usage, installation
and daily operation, runtime/orchestration contracts, data projection, and natural-language team
authoring guidance.

Start with [OGS Core Concepts](ogsystem-core-concepts.md) when evaluating the product boundary or
the meaning of Role, Responsibility Seat, nested System, and runtime execution facts.

See [专业工作台](visualizer-console.md) for precise structure editing, debugging, role handoffs,
human review, role I/O, and run-history views.

See [开始分发与结束汇聚](multi-entry-and-terminal-output.md) for the structural Start/End contract,
terminal quorum behavior, cancellation rules, and stable result ordering.

For installation, single-host production checks, backups, recovery, and OS scheduler recipes, see
[Single Host Production Runbook](single-host-production.md).

The core modeling rule is role-first: a graph node is a responsibility role/seat, and a Flow is the
direct handoff from one completed role to another. Events, actions, process steps, and runtime facts
belong on flows or in run details, not as Role nodes.

For the user-facing workflow start with [Team Site guide](../../apps/team-site/README.md), then use
[Product concepts](ogs-concepts.md) and [Usage manual](usage-manual.md). The Team Site guide is the
current source for team repository, team factory, collaboration project, task controls, and Tailnet
entry points.

- Current guidance lives in this directory.
- Current product contracts and verification guidance live in the manuals and UAT checklist.
- Active development plans and implementation rules live in `../development/`.
- Code and tests remain the final authority when this manual and implementation disagree.
