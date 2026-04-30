# OGSystem Studio Lifecycle UX Follow-up Plan - 2026-05-01

This checklist tracks the next UX and product-logic cleanup after the Studio graph workspace and lifecycle shell split.

## Execution Principles

- Keep this follow-up scoped to Visualizer / Studio UX and product logic. Do not change runtime/parser/compiler execution semantics.
- Treat the current four-entry lifecycle shell as the product default: Project, Build, Validate & Release, Operate.
- Keep Build editable graph and Operate readonly graph isolated. They may share projection rendering, but must not share controller state, command state, or undo history.
- Prefer moving existing panels into better lifecycle structure before introducing new backend contracts.
- Do not start Project Wizard until High Priority items are complete and browser smoke is stable.
- Every item must include i18n updates, browser smoke coverage, and regression commands before being marked done.

## Recommended Delivery Order

1. Navigation cleanup: remove `Legacy Tabs` from primary navigation while preserving fallback access behind an explicit developer path.
2. Operate workbench: restructure the runtime experience around selected run context.
3. Build modes: add Edit / Dry Run / Debug without changing runtime dry-run semantics.
4. Build persistence clarity: make Validate / Generate Mermaid / Save / Dry Run state explicit.
5. Validate & Release gate: unify visible blockers with actual export blocking.
6. Medium-priority UX refinements: Project Wizard, contextual actions, config dedupe, desktop layout polish, i18n hardening.

Each step should be independently shippable and revertible.

## High Priority

- [ ] Remove `Legacy Tabs` from the primary lifecycle navigation.
  - Keep legacy access behind a developer flag, query parameter, or overflow/debug menu.
  - Do not delete legacy panel rendering in the same change; only remove it from the default user-facing navigation.
  - Preserve route compatibility for existing `tab=` / query-state deep links.
  - Acceptance: default navigation only shows Project, Build, Validate & Release, and Operate.
  - Browser smoke: default page has four primary lifecycle buttons; developer fallback can still open old panels.

- [ ] Reorganize Operate from stacked legacy panels into a run-first workspace.
  - Target structure: run list, read-only graph, selected-run detail, and internal tabs for overview, recovery, logs, reviews, and artifacts.
  - Keep audit as an Operate detail capability, not a primary navigation item.
  - Keep logs lazy-loaded; switching internal Operate tabs must not fetch logs unless the user opens logs or refreshes them.
  - Maintain readonly graph guarantees: no edit toolbar, no edit commands, no shared Build undo stack.
  - Acceptance: logs, artifacts, recovery, and audit no longer render as one long vertical stack by default.
  - Browser smoke: selecting a run updates readonly graph and detail tabs without exposing edit controls.

- [ ] Add explicit Build modes: Edit, Dry Run, and Debug.
  - Dry-run output should project back onto the Build graph first, with a secondary jump to Operate/run detail.
  - Build Debug mode is a mode switch, not a new top-level route.
  - Dry-run must continue using existing runtime/API behavior; only the projection and navigation behavior change.
  - If dry-run creates a run id, keep that run id visible in Build and offer "Open in Operate" as a secondary action.
  - Acceptance: users can inspect dry-run results without leaving Build immediately.
  - Browser smoke: dry-run from Build leaves the user in Build Debug mode and highlights the generated/simulated graph state.

- [ ] Clarify Build persistence actions and state.
  - Make the main chain explicit: Validate, Generate Mermaid, Save, Dry Run.
  - Show whether the current content is an authoring draft, generated Mermaid source, dirty source, or disk-saved system.
  - Keep machine truth explicit: `StudioAuthoringDocument` is authoring truth, generated `system.mmd` is runtime truth.
  - Avoid hidden writes. Any action that writes to disk must say what file or draft it writes.
  - Restore or replace any removed save/generate affordance with a clearer lifecycle action.
  - Acceptance: users can tell what will be written before pressing Save.
  - Browser smoke: editing graph marks state dirty; Generate Mermaid explains generated source; Save clears dirty state only after success.

- [ ] Tighten Validate & Release gates.
  - Gate export on unified release readiness: dirty state, Mermaid validation, readiness blockers, missing contracts, unresolved bindings, unhealthy role packages, and artifact contract status.
  - The UI checklist and `exportProject()` must consume the same readiness decision helper so visible blockers cannot diverge from export behavior.
  - Keep release manifest / digest / report contract explicit before adding more release UI.
  - Warning-only items may allow export, but must be included in release notes / report.
  - Acceptance: visible release blockers also block export.
  - Browser smoke: each visible blocking category prevents export and focuses the user on Validate & Release.

## Medium Priority

- [ ] Make Project a true lifecycle starting point.
  - Add a project wizard for templates, role packages, model/profile selection, entry role, create/import/load.
  - Start with templates already exposed by Studio APIs; do not add a new project backend until the UI contract is clear.
  - Keep this behind a follow-up milestone after High Priority items are stable.
  - Acceptance: a new project can be created visually without background file operations.

- [ ] Contextualize top-level actions.
  - Show Build actions in Build, run control actions in Operate only, and disable unavailable actions with clear reasons.
  - If an action is hidden because the current phase does not support it, provide the equivalent phase action where appropriate.
  - Resume and Stop must only look active when a selected run can actually use them.
  - Acceptance: Run, Resume, and Stop are not globally active-looking controls.

- [ ] Remove duplicated Config exposure.
  - Build configuration should live in the graph inspector around selected project/role/edge.
  - Validate & Release should show checklist and release reports, not the full config explanation panel.
  - Keep config explanation reachable from diagnostics or details, but do not duplicate the whole panel across lifecycle phases.
  - Acceptance: users do not read the same configuration explanation in multiple lifecycle phases.

- [ ] Refine desktop Studio layout.
  - Use a graph-first main area with collapsible inspector and bottom diagnostics instead of a pure single-column stack.
  - Avoid returning to the old two-column layout that left large blank space under the timeline or inspector.
  - Target desktop layout: graph-dominant workspace, collapsible inspector, bottom diagnostics/logs.
  - Target mobile layout: stacked graph, inspector, diagnostics with explicit collapse controls.
  - Acceptance: graph stays dominant while inspector, index, and diagnostics remain reachable.

- [ ] Productize remaining hard-coded messages.
  - Move user-facing strings into i18n and replace engineering errors with actionable guidance.
  - Cover flash messages, fetch failures, empty states, disabled reasons, release blockers, and developer fallback labels.
  - Keep machine identifiers such as roleId, flowKey, eventType, runId, modelRef, and errorCode untranslated.
  - Acceptance: zh-CN mode has no unexpected English operational messages.

## Current Layout Decision

- [x] Convert the left `aside` from a global sidebar into an Operate-only run selector.
  - Project, Build, and Validate & Release should not reserve left sidebar width.
  - Operate and developer fallback views may show the run selector.

## Cross-Cutting Acceptance

- `pnpm run build`
- `pnpm run test:visualizer`
- `pnpm run test:visualizer-browser`
- `pnpm test`
- Browser screenshots or smoke assertions must cover desktop and mobile widths for Build, Validate & Release, and Operate.
- No new direct `@antv/x6` import outside `src/visualizer/studio-client/**`.
- No runtime/parser/compiler import from Visualizer UI modules.
- No default user path depends on `Legacy Tabs`.

## Out Of Scope For This Follow-up

- Rewriting runtime execution semantics.
- Replacing the current Visualizer API contract.
- Adding a new deployment backend.
- Adding independent Debug or Audit top-level navigation.
- Replacing X6 with another graph runtime.
- Large-scale `client-app.ts` rewrite in a single change.
