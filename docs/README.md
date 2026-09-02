# OGSystem Documentation Index

This file is the active entry point for `docs/`. Code, tests, and CLI behavior remain the source of truth. Dated plans, reviews, checklists, and closure notes are historical delivery records unless their conclusions have been copied back into active docs.

Archive rules are documented in [docs/archive/README.md](archive/README.md).

## Active Docs

- [Product introduction](product-introduction.md): capability overview for readers.
- [Usage manual](usage-manual.md): install, CLI, run directory, operations, and Visualizer usage.
- [Orchestration semantics](ogsystem-orchestration-semantics-v1.md): runtime semantic contract.
- [Compiler semantics](compiler-semantics-v1.md): static compiler entrypoint and diagnostics contract.
- [NL2MMD structure templates](nl2mmd-structure-templates.md): natural-language to Mermaid structure constraints.
- [Decisions](DECISIONS.md): current architecture decisions and boundaries.
- [Long-term stability roadmap](long-term-stability-roadmap.md): durable direction.
- [PraisonAI comparison roadmap](praisonai-comparison-roadmap.md): what to borrow from a broader agent platform without weakening runtime guarantees.
- [Unified backlog](todo-backlog.md): current active backlog.
- [Semantic gap implementation plan](semantic-gap-implementation-plan.md): current unimplemented semantics, priorities, and acceptance boundaries.
- [OGS workflow DSL upgrade plan](ogs-langgraph-dsl-upgrade-plan.md): backend-neutral DSL, semantic IR, contracts, reliability, standards alignment, and development-test roadmap.
- [Ebook draft](ogsystem-ebook.md): long-form explanatory material.

## Design References

These documents are useful background, but they are not the only authority for current behavior:

- [Design release validation template](design-release-validation-template.md)
- [Context map projection guide](context-map-projection-guide.md)
- [Data projection spec](ogsystem-data-projection-spec.md)
- [Semantics manual](ogsystem-semantics-manual.md)
- [Wait timeout semantics proposal](ogsystem-wait-timeout-semantics-v2.md)

## Recent Delivery Records

Use these recent archive records to understand implementation context:

- [Cross-platform Visualizer validation closure 2026-05-05](archive/delivery/ogsystem-cross-platform-visualizer-validation-closure-2026-05-05.md)
- [Visualizer product usability gate follow-up 2026-05-05](archive/delivery/ogsystem-visualizer-product-usability-gate-followup-2026-05-05.md)
- [Visualizer platform validation execution plan 2026-05-04](archive/delivery/ogsystem-visualizer-platform-validation-execution-plan-2026-05-04.md)
- [Visualizer HTTP runtime isolation decision 2026-05-04](archive/delivery/ogsystem-visualizer-http-runtime-isolation-decision-2026-05-04.md)
- [Visualizer optimization checklist closure 2026-05-03](archive/delivery/ogsystem-visualizer-optimization-checklist-calibrated-2026-05-03.md)
- [Canvas-centered Visualizer architecture roadmap 2026-05-03](archive/delivery/ogsystem-canvas-centered-product-architecture-roadmap-2026-05-03.md)
- [Visualizer responsibility-seat semantic review 2026-09-02](archive/delivery/ogsystem-visualizer-responsibility-seat-review-2026-09-02.md)

The full archive lives under `docs/archive/delivery/` and `docs/archive/history/`. Do not maintain a duplicated full file list here; use `rg` or browse by date when historical context is needed.

## Maintenance Rules

1. Update active docs first when current behavior changes.
2. Put phase plans, delivery reviews, benchmarks, and one-off checklists in `docs/archive/delivery/`.
3. Put early explorations, superseded proposals, and compatibility discussions in `docs/archive/history/`.
4. When adding a dated archive record, update the "Recent Delivery Records" section.
5. When changing CLI, install, package management, run directories, or security boundaries, update `README.md` and the [usage manual](usage-manual.md).
6. When changing orchestration semantics, recovery semantics, or run artifact contracts, update the semantic docs and [decisions](DECISIONS.md).
7. Do not delete superseded historical records. Add `Superseded by:` at the top of the old file or note the replacement here.

## Suggested Reading Order

1. `README.md`
2. [Product introduction](product-introduction.md)
3. [Usage manual](usage-manual.md)
4. [Orchestration semantics](ogsystem-orchestration-semantics-v1.md)
5. [Compiler semantics](compiler-semantics-v1.md)
6. [NL2MMD structure templates](nl2mmd-structure-templates.md)
7. [Decisions](DECISIONS.md)
