# OGS Development Documentation

This directory contains engineering rules and work planning: architecture decisions, DSL/IR and
compiler contracts, implementation-gap plans, visualizer design, roadmaps, development templates,
and the active backlog.

- Current engineering guidance and plans live in this directory.
- [Product boundary and evolution](ogs-product-boundary-and-evolution.md): rules for keeping the OGS core small while adding standards and governance extensions.
- [OGS GStacklike productionization proposal](ogs-gstacklike-productionization-plan.md): deferred reference; this project provides framework capabilities and application templates/examples, not complex applications built with the framework.
- [Studio System visual configuration](studio-visual-system-configuration.md): configure System, Role, Flow, handoff, and context projection through typed Studio controls while preserving Mermaid semantics.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context,
  boundaries, and generated source.
- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions,
  shared contracts, build output, and test ownership.
- [Released CLI compatibility policy](release-compatibility-policy.md): supported release lines,
  migrations, deprecations, and development-test boundaries.
- [Release UAT checklist](release-uat-checklist.md) and
  [release evidence template](release-evidence/TEMPLATE.md): first stable release gates and
  per-candidate verification records.
- Completed engineering plans, reviews, and validation records live in `archive/delivery/`.
- Superseded proposals and early explorations live in `archive/history/`.
- Product-facing usage and runtime constitution documents live in `../usage/`.
