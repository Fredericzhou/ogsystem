# OGSystem Archive Index

`docs/archive/` stores inactive documentation so historical plans, phase reviews, and completed checklists do not mix with active source-of-truth docs.

## Directories

- `delivery/`: completed delivery records, phase plans, validation closures, reviews, benchmarks, and checklists.
- `history/`: early proposals, compatibility discussions, and historical exploration material.

## Rules

1. Archive docs are not authoritative for current behavior or semantics by default.
2. Conclusions that still matter must be copied back to active docs such as `docs/usage-manual.md`, `docs/DECISIONS.md`, or semantic docs.
3. New archive files should use dated names and should be referenced from `docs/README.md` when they are recent or important.
4. Phase plans, reviews, benchmarks, and checklists belong in `delivery/`.
5. Early explorations, superseded proposals, and compatibility discussions belong in `history/`.
6. If an archive record is superseded, add `Superseded by:` at the top of the old file. Do not delete the historical body.

## Current Conventions

- Current run directories use `.ogs/`.
- Current CLI entrypoints are the installed `ogs` command and repository `pnpm run ...` scripts.
- Old paths, old CLI forms, machine-local absolute paths, and one-off debugging commands inside archive docs are historical context only.

## Theme Consolidation

- Completed Visualizer UX convergence is preserved in `delivery/visualizer-refactor-plan-2026-05-13.md` and its closure summary; unfinished semantic-layout/ELK work remains active in `docs/ogs-visualizer-refactor-plan.md`.
- Responsibility-seat review conclusions are preserved in `delivery/ogsystem-visualizer-responsibility-seat-review-2026-09-02.md` and copied into the active semantics and visualizer documents.
- Completed semantic hardening is summarized in the active semantics manuals and tracked as closed work in `docs/todo-backlog.md`; future gaps remain in `docs/semantic-gap-implementation-plan.md`.
