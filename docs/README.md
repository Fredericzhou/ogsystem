# OGSystem Documentation Index

This file is the active entry point for `docs/`. Code, tests, and CLI behavior remain the source of truth. Documentation is organized into two domains: `usage/` contains product use and runtime contracts; `development/` contains engineering rules, plans, and active work. Each domain has its own `archive/` for completed records.

Archive rules are documented in [development/archive/README.md](development/archive/README.md). Product-facing historical material belongs under [usage/archive/](usage/archive/README.md).

## Usage Docs

Product-facing usage, runtime constitution, and operational contracts live under `usage/`.

- [Product introduction](usage/product-introduction.md): capability overview for readers.
- [Core concepts](usage/ogsystem-core-concepts.md): product boundary and normative terms for System, Role, Seat, runtime facts, and standards alignment.
- [Usage manual](usage/usage-manual.md): install, CLI, run directory, operations, and Visualizer usage.
- [Orchestration semantics](usage/ogsystem-orchestration-semantics-v1.md): runtime semantic contract.
- [Semantics manual](usage/ogsystem-semantics-manual.md): implementation-aligned reference.
- [Context map guide](usage/context-map-projection-guide.md): projection selectors and boundaries.
- [Data projection spec](usage/ogsystem-data-projection-spec.md): runtime data projection contract.
- [NL2MMD structure templates](usage/nl2mmd-structure-templates.md): natural-language to Mermaid constraints.
- [Ebook draft](usage/ogsystem-ebook.md): long-form explanatory material.

## Development Docs

Engineering rules, plans, specifications, and active backlog live under `development/`.

- [Decisions](development/DECISIONS.md): current architecture decisions and boundaries.
- [Compiler semantics](development/compiler-semantics-v1.md): compiler and diagnostics contract.
- [OGS workflow DSL upgrade plan](development/ogs-langgraph-dsl-upgrade-plan.md): DSL, IR, reliability, and standards roadmap.
- [OGS product boundary and evolution](development/ogs-product-boundary-and-evolution.md): core, enhancement, extension tiers and admission rules.
- [OGS visualizer refactor plan](development/ogs-visualizer-refactor-plan.md): semantic layout and graph interaction plan.
- [Semantic gap implementation plan](development/semantic-gap-implementation-plan.md): current runtime gaps and priorities.
- [Unified backlog](development/todo-backlog.md): current active backlog.
- [Unified backlog execution plan](development/todo-backlog-execution-plan-2026-09-03.md): executable task breakdown, dependencies, acceptance gates, and evidence requirements.
- [Released CLI compatibility policy](development/release-compatibility-policy.md): supported release lines, migrations, deprecations, and development-test boundaries.
- [Long-term stability roadmap](development/long-term-stability-roadmap.md): durable direction.
- [PraisonAI comparison roadmap](development/praisonai-comparison-roadmap.md): bounded capability roadmap.
- [Runtime storage/engine roadmap](development/runtime-storage-engine-decoupling-roadmap.md): backend decoupling direction.
- [Design release validation template](development/design-release-validation-template.md): reusable development checklist template.
- [Join wait timeout RFC](development/ogsystem-wait-timeout-semantics-v2.md): unimplemented proposal.

## Recent Delivery Records

Use these recent archive records to understand implementation context:

- [Cross-platform Visualizer validation closure 2026-05-05](development/archive/delivery/ogsystem-cross-platform-visualizer-validation-closure-2026-05-05.md)
- [Visualizer product usability gate follow-up 2026-05-05](development/archive/delivery/ogsystem-visualizer-product-usability-gate-followup-2026-05-05.md)
- [Visualizer platform validation execution plan 2026-05-04](development/archive/delivery/ogsystem-visualizer-platform-validation-execution-plan-2026-05-04.md)
- [Visualizer HTTP runtime isolation decision 2026-05-04](development/archive/delivery/ogsystem-visualizer-http-runtime-isolation-decision-2026-05-04.md)
- [Visualizer optimization checklist closure 2026-05-03](development/archive/delivery/ogsystem-visualizer-optimization-checklist-calibrated-2026-05-03.md)
- [Canvas-centered Visualizer architecture roadmap 2026-05-03](development/archive/delivery/ogsystem-canvas-centered-product-architecture-roadmap-2026-05-03.md)
- [Visualizer responsibility-seat semantic review 2026-09-02](development/archive/delivery/ogsystem-visualizer-responsibility-seat-review-2026-09-02.md)
- [Unified backlog execution delivery 2026-09-03](development/archive/delivery/todo-backlog-execution-2026-09-03.md)

The full development archive lives under `docs/development/archive/delivery/` and `docs/development/archive/history/`; the usage archive is at `docs/usage/archive/`. Do not maintain a duplicated full file list here; use `rg` or browse by date when historical context is needed.

## Maintenance Rules

1. Update active docs first when current behavior changes.
2. Put phase plans, delivery reviews, benchmarks, and one-off checklists in `docs/development/archive/delivery/`.
3. Put early explorations, superseded proposals, and compatibility discussions in `docs/development/archive/history/`.
4. When adding a dated archive record, update the "Recent Delivery Records" section.
5. When changing CLI, install, package management, run directories, or security boundaries, update `README.md` and the [usage manual](usage/usage-manual.md).
6. When changing orchestration semantics, recovery semantics, or run artifact contracts, update the usage semantic docs and [decisions](development/DECISIONS.md).
7. Do not delete superseded historical records. Add `Superseded by:` at the top of the old file or note the replacement here.

## Suggested Reading Order

1. `README.md`
2. [Product introduction](usage/product-introduction.md)
3. [Core concepts](usage/ogsystem-core-concepts.md)
4. [Usage manual](usage/usage-manual.md)
5. [Orchestration semantics](usage/ogsystem-orchestration-semantics-v1.md)
6. [Compiler semantics](development/compiler-semantics-v1.md)
7. [NL2MMD structure templates](usage/nl2mmd-structure-templates.md)
8. [Decisions](development/DECISIONS.md)
