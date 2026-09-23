# OGS Product Manual

This directory contains product-facing documentation: product positioning, installation and daily
operation, runtime/orchestration contracts (“constitution”), data projection, and NL2MMD usage
guidance.

Start with [OGS Core Concepts](ogsystem-core-concepts.md) when evaluating the product boundary or
the meaning of Role, Responsibility Seat, nested System, and runtime execution facts.

The core modeling rule is role-first: a graph node is a responsibility role/agent seat, and a
Flow is the direct handoff from one completed role to another. Events, actions, process steps,
and runtime facts belong on flows or in run details, not as Role nodes.

- Current guidance lives in this directory.
- Completed product validation records live in `archive/`.
- Development plans, implementation rules, and historical engineering records live in
  `../development/`.
- Code and tests remain the final authority when this manual and implementation disagree.
