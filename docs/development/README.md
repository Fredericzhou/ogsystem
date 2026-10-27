# OGS Development Documentation

This directory contains current engineering rules, architecture decisions, contracts, active
plans, and dated implementation records. Product usage belongs in `../usage/`. Historical plans
are labeled as such; current behavior is described by source code, tests, and active manuals.

- Current engineering guidance and plans live in this directory.
- [OGS semantic capability backlog](ogs-semantic-capability-backlog.md): current productization work and acceptance criteria for the accepted orchestration semantics.
- [OGS production governance and eval plan](ogs-production-governance-and-eval-plan.md): implementation plan for untrusted external data isolation, full-prompt resource budgets, batch release baseline execution, version comparison, and scoped model fallback.
- [Product boundary and evolution](ogs-product-boundary-and-evolution.md): rules for keeping the OGS core small while adding standards and governance extensions.
- [Decisions](DECISIONS.md): accepted architecture decisions and current boundaries.
- [Studio System visual configuration](studio-visual-system-configuration.md): configure System, Role, Flow, handoff, and context projection through typed Studio controls while preserving Mermaid semantics.
- [Team Collaboration module refactor record](team-collaboration-module-refactor-plan.md): archived implementation history for the October 2026 modularization; current product behavior lives in the Team Site manual and OGS product concepts, architecture decisions live in [Decisions](DECISIONS.md), and current verification/UAT status lives in the validation report and [Release UAT checklist](release-uat-checklist.md).
- [Team Site layout refactor plan](team-site-layout-refactor-plan.md): unified shell, page templates, scroll rules, verifiable acceptance criteria, and progress tracking for the Team Site layout refactor.
- [Studio and Projects isolation plan](ogs-studio-project-run-isolation-plan.md): design record for storage ownership, Runtime inputs, and recovery/security requirements. Read alongside current product concepts and implementation; its historical TeamVersion descriptions are not lifecycle authority.
- [Studio and Projects test/UAT report](ogs-studio-project-run-isolation-validation-report.md): dated verification evidence; consult the latest dated section and Release UAT checklist for status.
- [Shared resource architecture](shared-resource-architecture.md): shared Platform resource ownership and adapter boundaries.
- [Team role source catalog plan](team-role-source-catalog-plan.md): upstream Git role sources, immutable indexing, Markdown adaptation, Draft copying, package validation, and release acceptance.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context,
  boundaries, and generated source.
- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions,
  shared contracts, build output, and test ownership.
- Product-facing usage and runtime constitution documents live in `../usage/`.
