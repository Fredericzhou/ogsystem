# Documentation Audit And Classification

Date: 2026-11-05  
Scope: all Markdown under `docs/`, current source/test alignment, and release-state claims.

> Status: historical audit. The active governance entry point is
> [OGSystem Constitution and Rules](ogsystem-constitution-v1.md), and the current acceptance
> evidence is [release-validation-2026-11-08.md](release-validation-2026-11-08.md).

## Authority Order

1. Source code and executable tests define current behavior.
2. `docs/development/DECISIONS.md` defines accepted architecture invariants.
3. `docs/usage/` defines the current product and semantic contracts.
4. Dated validation and release records provide evidence for a specific code state.
5. `docs/development/todo-backlog.md` contains the only active work list.
6. `docs/development/archive/` contains historical plans and proposals only.

When documents disagree, the higher item wins and the lower document must be corrected or archived.

## Classification

| Area | Current source of truth | Supporting material |
| --- | --- | --- |
| Product boundary and vocabulary | `docs/usage/ogsystem-core-concepts.md`, `docs/usage/product-introduction.md` | `docs/usage/usage-manual.md` |
| Runtime semantics | `docs/usage/ogsystem-orchestration-semantics-v1.md`, `docs/development/DECISIONS.md` | `docs/usage/ogsystem-semantics-manual.md`, `docs/usage/context-map-projection-guide.md`, `docs/usage/ogsystem-data-projection-spec.md` |
| Abstract collaboration model | `docs/development/extended-state-machine-and-dag-bilingual.md` | `docs/development/ogs-product-boundary-and-evolution.md` |
| Compiler and file boundaries | `docs/development/compiler-semantics-v1.md`, `docs/development/file-sets.md` | source comments and tests |
| CLI and model backends | `docs/development/cli-integration-plan.md`, `docs/development/model-availability-probe-api.md` | `docs/usage/usage-manual.md` model configuration section |
| Team Site and Studio operation | `apps/team-site/README.md`, `docs/usage/visualizer-console.md`, `docs/usage/usage-manual.md` | browser tests and current release record |
| Release evidence | `docs/development/release-validation-2026-11-08.md`, active `release-uat-checklist.md` | dated acceptance, benchmark, and isolation reports |
| Active work | `docs/development/todo-backlog.md` | issue-specific tests and records |
| Historical plans | `docs/development/archive/` | never used as current acceptance evidence |

## Findings

### Corrected In This Audit

- The backlog previously listed the Backend Registry, Pi/Qwen/Kimi adapters, and optional Context Map
  selectors as not started even though the implementation and tests are present. These are now in the
  closed baseline and removed from the active queue.
- The backlog previously declared that OGS would not maintain an Electron/Tauri desktop shell while
  the repository already contains a minimal Electron host and desktop readiness tests. The wording now
  keeps the thin Electron host in scope and moves packaging/IPC hardening to an explicit active item.
- The native CLI document previously described the adapters and Electron host as future work. It now
  records the current adapters and minimal host as landed, with remaining acceptance gaps called out.
- Completed or superseded Studio UI plans were moved to `development/archive/`. Their historical test
  counts are no longer presented as current release evidence.
- Product vocabulary duplicated by `ogs-concepts.md` was consolidated into the core concept contract;
  all active links now point to the canonical file.

### No Contract Drift Found In The Reviewed Semantic Areas

The current source and targeted tests at the time of this audit agreed with the documented model for Role-first graphs, typed
events, task/input separation, conditional routing, `parallel_split`, `all_of`/`quorum_of` Join,
bounded Loop, checkpoints, and Studio Simulation isolation. The latest semantic execution record
reports `98/98` focused tests passed; the latest full records remain in
`release-validation-2026-11-08.md`.

The fixed business-event protocol was a target at the time of this audit. The current implementation
has since promoted it to the active contract; see the dated validation record and
`business-event-protocol-v1.md` for the current registry-backed behavior.

## Open Items That Do Not Match The Release Design Yet

These are implementation or acceptance gaps, not documentation-only cleanup:

### P1: Desktop Host Release Hardening

- Add a packaged or clean-install smoke test and one real desktop UAT pass before calling desktop
  support release-ready.

### P1: Real Provider And Manual Acceptance

- Complete release UAT scenarios 12-15, including real Sandbox human review, two control roots with
  one workspace, TeamVersion freeze, and a long-running stop/recovery flow.
- Run the condition-route and Join wait/timeout browser/operator scenarios against a real Runtime.
- Repeat provider-backed checks with valid credentials; Kimi currently cannot be called without its
  configured bearer/API credential.

### P2: Deferred Engineering Improvements

- Replace the Visualizer generated function-string bundle with a direct esbuild entry when measured
  loading cost justifies it.
- Add requestAnimationFrame batching for high-rate Visualizer streams after a benchmark demonstrates
  UI pressure; retain the existing escaping audit.
- Split the large Team Site and Visualizer client modules incrementally at ownership boundaries, without
  introducing a new frontend framework or global event bus.

## Review Result

The active documentation set is now separated from historical plans, and current semantic claims are
aligned with the implementation records available in this workspace. The P1 items above remain open;
they prevent claiming a fully packaged desktop release and a complete real-provider/manual UAT sign-off,
but they do not invalidate the current Runtime semantic model or the automated release checks.
