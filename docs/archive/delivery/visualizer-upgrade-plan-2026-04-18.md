# Visualizer Upgrade Plan

## Goal
Upgrade the existing `visualizer` with lightweight command visualization and dialog-based Mermaid generation, without changing the current tech stack.

## Status

Completed.

## Delivered

- Shared command registry as the single source of truth for `ogs project/*`, `ogs run/*`, `run:nl2mmd`, and `run:visualizer`.
- Deterministic Mermaid command graph generation from the shared registry.
- Read-only visualizer APIs for command metadata, command graph, and NL2MMD preview.
- Inline HTML `Commands` and `Compose` views.
- Registry, graph, and visualizer regression tests.
- Usage manual updates.

## Constraints Kept

- No new database.
- No new frontend framework.
- No runtime execution stack changes.
- `visualizer` remains read-only.
- Generating and saving `.mmd` stays in `run:nl2mmd`.

## Notes

- `T1` is the single source of truth for help text, parser wiring, and graph generation.
- `T5` and `T6` remain read-only and do not write `.mmd` files or mutate runtime state.
- Stable read-only endpoints are `/api/v1/commands`, `/api/v1/commands/graph`, and `/api/v1/nl2mmd/preview`.
