# OGS Development Documentation

This directory contains current engineering rules, architecture decisions, contracts, active
plans, and dated implementation records. Product usage belongs in `../usage/`. Historical plans
are labeled as such; current behavior is described by source code, tests, and active manuals.

- Current engineering guidance and plans live in this directory.
- [OGS semantic capability backlog](ogs-semantic-capability-backlog.md): current productization work and acceptance criteria for the accepted orchestration semantics.
- [Team IR v2 Handoff 设计方案](team-ir-handoff-v2-design.md)：下一代 Team IR、端口与映射规则、编译器/Runtime 边界、Studio 体验、实施阶段和验收矩阵。
- [Product boundary and evolution](ogs-product-boundary-and-evolution.md): rules for keeping the OGS core small while adding standards and governance extensions.
- [Decisions](DECISIONS.md): accepted architecture decisions and current boundaries.
- [Studio System visual configuration](studio-visual-system-configuration.md): configure System, Role, Flow, handoff, and context projection through typed Studio controls while preserving Mermaid semantics.
- [Team Site layout refactor plan](team-site-layout-refactor-plan.md): unified shell, page templates, scroll rules, verifiable acceptance criteria, and progress tracking for the Team Site layout refactor.
- [Team Site 页面框架统一与 Studio 工作台交互优化方案](team-site-page-frame-and-studio-optimization-plan.md)：统一右侧页面框架、面包屑与标题紧凑化规范，以及 Studio 运行态只读锁、面板层级避让和键盘焦点管理。
- [Local desktop and remote control plane plan](local-desktop-remote-control-plane-plan.md): independent portal/downloads, Electron security boundaries, local Runtime, remote configuration, synchronization, and staged delivery.
- [Studio and Projects test/UAT report](ogs-studio-project-run-isolation-validation-report.md): dated verification evidence; consult the latest dated section and Release UAT checklist for status.
- [Shared resource architecture](shared-resource-architecture.md): shared Platform resource ownership and adapter boundaries.
- [OGS control root and shared workspace plan](ogs-control-root-shared-workspace-plan.md): unified `--ogs-dir`/`--workspace-dir` ownership, Studio/Projects boundaries, TeamVersion freezing, and UAT gates.
- [Model backend adapter registry plan](model-backend-adapter-registry-plan.md): backend adapters, Codex/OpenCode/Claude/Antigravity/Ollama support, model source metadata, and Studio backend visuals.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context,
  boundaries, and generated source.
- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions,
  shared contracts, build output, and test ownership.
- Product-facing usage and runtime constitution documents live in `../usage/`.

## Historical Archive

These records describe completed implementation work. They remain available for traceability, but
they are not current contracts, implementation plans, or acceptance status sources:

- [Production governance and evaluation implementation record](ogs-production-governance-and-eval-plan.md)
- [Team Collaboration module refactor record](team-collaboration-module-refactor-plan.md)
- [Studio and Projects isolation design record](ogs-studio-project-run-isolation-plan.md)
- [Team role source catalog implementation record](team-role-source-catalog-plan.md)

Use the product manuals, [Decisions](DECISIONS.md), source code, and current UAT documents for
present behavior.
