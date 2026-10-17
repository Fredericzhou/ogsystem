# OGS Development Documentation

This directory contains current engineering rules, architecture decisions, contracts, and the
active backlog. Product usage belongs in `../usage/`; completed or superseded delivery records
belong in `archive/`.

- Current engineering guidance and plans live in this directory.
- [OGS semantic capability backlog](ogs-semantic-capability-backlog.md): current productization work and acceptance criteria for the accepted orchestration semantics.
- [Product boundary and evolution](ogs-product-boundary-and-evolution.md): rules for keeping the OGS core small while adding standards and governance extensions.
- [Decisions](DECISIONS.md): accepted architecture decisions and current boundaries.
- [Studio System visual configuration](studio-visual-system-configuration.md): configure System, Role, Flow, handoff, and context projection through typed Studio controls while preserving Mermaid semantics.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context,
  boundaries, and generated source.
- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions,
  shared contracts, build output, and test ownership.
- Completed engineering plans, dated execution plans, reviews, and validation records live in
  `archive/delivery/` or `archive/history/`. They are retained for traceability and are not current
  implementation instructions.
- Superseded proposals and early explorations live in `archive/history/`.
- Product-facing usage and runtime constitution documents live in `../usage/`.
