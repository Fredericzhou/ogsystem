# OGSystem Studio Lifecycle UX Follow-up Plan - 2026-05-01

This checklist tracks the next UX and product-logic cleanup after the Studio graph workspace and lifecycle shell split.

## High Priority

- [ ] Remove `Legacy Tabs` from the primary lifecycle navigation.
  - Keep legacy access behind a developer flag, query parameter, or overflow/debug menu.
  - Acceptance: default navigation only shows Project, Build, Validate & Release, and Operate.

- [ ] Reorganize Operate from stacked legacy panels into a run-first workspace.
  - Target structure: run list, read-only graph, selected-run detail, and internal tabs for overview, recovery, logs, reviews, and artifacts.
  - Acceptance: logs, artifacts, recovery, and audit no longer render as one long vertical stack by default.

- [ ] Add explicit Build modes: Edit, Dry Run, and Debug.
  - Dry-run output should project back onto the Build graph first, with a secondary jump to Operate/run detail.
  - Acceptance: users can inspect dry-run results without leaving Build immediately.

- [ ] Clarify Build persistence actions and state.
  - Make the main chain explicit: Validate, Generate Mermaid, Save, Dry Run.
  - Show whether the current content is an authoring draft, generated Mermaid source, dirty source, or disk-saved system.
  - Acceptance: users can tell what will be written before pressing Save.

- [ ] Tighten Validate & Release gates.
  - Gate export on unified release readiness: dirty state, Mermaid validation, readiness blockers, missing contracts, unresolved bindings, unhealthy role packages, and artifact contract status.
  - Acceptance: visible release blockers also block export.

## Medium Priority

- [ ] Make Project a true lifecycle starting point.
  - Add a project wizard for templates, role packages, model/profile selection, entry role, create/import/load.
  - Acceptance: a new project can be created visually without background file operations.

- [ ] Contextualize top-level actions.
  - Show Build actions in Build, run control actions in Operate only, and disable unavailable actions with clear reasons.
  - Acceptance: Run, Resume, and Stop are not globally active-looking controls.

- [ ] Remove duplicated Config exposure.
  - Build configuration should live in the graph inspector around selected project/role/edge.
  - Validate & Release should show checklist and release reports, not the full config explanation panel.
  - Acceptance: users do not read the same configuration explanation in multiple lifecycle phases.

- [ ] Refine desktop Studio layout.
  - Use a graph-first main area with collapsible inspector and bottom diagnostics instead of a pure single-column stack.
  - Acceptance: graph stays dominant while inspector, index, and diagnostics remain reachable.

- [ ] Productize remaining hard-coded messages.
  - Move user-facing strings into i18n and replace engineering errors with actionable guidance.
  - Acceptance: zh-CN mode has no unexpected English operational messages.

## Current Layout Decision

- [x] Convert the left `aside` from a global sidebar into an Operate-only run selector.
  - Project, Build, and Validate & Release should not reserve left sidebar width.
  - Operate and developer fallback views may show the run selector.
