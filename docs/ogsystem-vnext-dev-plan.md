# OGSystem vNext-dev (Exploratory Notes Only)

Status: exploratory  
Scope: non-authoritative brainstorming and experiment parking lot  
Compatibility mode: no compatibility requirement for experiments

## 1. Purpose

This file is intentionally **not** a source of truth for runtime contracts.
Its only role is to capture optional experiments that may be evaluated later.

## 2. Authority Boundaries

When content here conflicts with active docs or code, use this priority:

1. `src/runtime/*` + tests
2. `docs/ogsystem-orchestration-semantics-v1.md`
3. `docs/DECISIONS.md`
4. `docs/usage-manual.md`
5. `docs/long-term-stability-roadmap.md`
6. `docs/todo-backlog.md`

This file cannot redefine terms, directory contracts, or lifecycle semantics.

## 3. Related Plans

Project CLI and run lifecycle proposal is tracked here:

- `docs/archive/delivery/project-cli-lifecycle-plan-2026-04-12.md`

That delivery proposal already defines:

- `.ogs/runs/` single-track storage
- run lifecycle (`start/resume/stop`)
- config snapshot (`resolved-config.json`)
- engine/role log bifurcation
- pnpm-only baseline

This file should only add ideas that are not already specified there.

## 4. Allowed Experiment Themes

- Developer experience experiments (CLI ergonomics, template UX)
- Optional observability enhancements
- Stress/fault-injection methods
- Performance tuning hypotheses

## 5. Current Experiment Backlog (Non-binding)

1. `ogs run logs --follow` behavior on very large trace files.
2. `runs-index` incremental update strategy under high run churn.
3. Optional `LockProvider` plugin interface shape for future distributed mode.
4. Template quality benchmark for `minimal/software-dev/consultation`.

## 6. DoD For Any Idea Graduating From This File

Before an item moves from exploratory note to implementation:

1. Open a dated delivery plan under `docs/archive/delivery/`.
2. Add test strategy and rollback strategy.
3. Update active docs (`usage-manual`, `DECISIONS`, semantics) in the same PR as code.
4. Prove no conflict with stable-track backlog priorities.
