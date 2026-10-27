# OGS Development Documentation

This directory contains current engineering rules, architecture decisions, contracts, active
plans, and dated implementation records. Product usage belongs in `../usage/`. Historical plans
are labeled as such; current behavior is described by source code, tests, and active manuals.

- Current engineering guidance and plans live in this directory.
- [OGS semantic capability backlog](ogs-semantic-capability-backlog.md): current productization work and acceptance criteria for the accepted orchestration semantics.
- [Team IR v2 Handoff 设计方案](team-ir-handoff-v2-design.md)：下一代 Team IR、端口与映射规则、编译器/Runtime 边界、Studio 体验、实施阶段和验收矩阵。
- [Team IR v2 落地与验证台账](team-ir-v2-implementation-and-verification.md)：记录 v2 阶段状态、代码与测试证据、场景验收和发布完成门槛；不替代设计规范。
- [面向社会分工协作的设计理念](../usage/team-ir-social-collaboration.md)：以社会分工实践解释 Team IR 的建模理念、典型场景、价值和适用边界。
- [Team IR 协作边界 ADR](adr-team-ir-collaboration-boundaries.md)：待批准的设计提案，记录显式数据流、条件分支、Join/Loop 语义和不提供机密保证等架构取舍。
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
