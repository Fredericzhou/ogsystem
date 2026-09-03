# OGS Development Documentation

This directory contains engineering rules and work planning: architecture decisions, DSL/IR and
compiler contracts, implementation-gap plans, visualizer design, roadmaps, development templates,
and the active backlog.

- Current engineering guidance and plans live in this directory.
- [Product boundary and evolution](ogs-product-boundary-and-evolution.md): rules for keeping the OGS core small while adding standards and governance extensions.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context,
  boundaries, and generated source.
- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions,
  shared contracts, build output, and test ownership.
- [Released CLI compatibility policy](release-compatibility-policy.md): supported release lines,
  migrations, deprecations, and development-test boundaries.
- Completed engineering plans, reviews, and validation records live in `archive/delivery/`.
- Superseded proposals and early explorations live in `archive/history/`.
- Product-facing usage and runtime constitution documents live in `../usage/`.
