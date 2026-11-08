# Current Release Validation Record

Date: 2026-11-08  
Scope: current Semantic IR v1 runtime semantics, classic and new Team cases, Team Site and Visualizer browser flows.

This record supersedes the counts in [release-validation-2026-11-05.md](release-validation-2026-11-05.md).
It does not claim live provider quality or native Electron packaging acceptance.

## Automated Verification

| Check | Result |
| --- | --- |
| `pnpm run build` | PASS |
| `pnpm test` | PASS: 742 tests, 741 passed, 1 Windows-only skip |
| `pnpm run test:examples` | PASS: Debate Loop, Medical quorum, Error compensation, GStacklike Review |
| `pnpm --dir apps/team-site test --test-concurrency=1` | PASS: 469 tests, 469 passed, 0 skipped; classic/new Team, Project/Task/Run/Review, Studio Simulation, recovery, and browser acceptance |
| `node --test tests/graph-runtime.integration.test.mjs` | PASS: 24 real runtime cases, including loop budget trigger, durable decision, resume completion, rejected decision audit, and branch-termination Join convergence |
| `node --test tests/cli-lifecycle.test.mjs tests/runtime-fault-injection.test.mjs` | PASS: CLI list/inspect/decide/resume, invalid loop action, state-commit crash recovery, and duplicate decision reconciliation |
| `node --test tests/loop-budget-review.test.mjs tests/human-review-transition.test.mjs tests/human-review-artifacts.test.mjs` | PASS: Loop Budget actions, negative guardrails, multi-round consumption, binding checks, failure compensation, and approve-to-overbudget transition |
| `pnpm run test:visualizer-browser` | PASS: 21 passed, 2 deployment-environment skips (17 Studio graph cases + 4 layout cases) |
| `git diff --check` | PASS |

## Semantic Coverage

| Area | Runtime evidence |
| --- | --- |
| Fixed events | Shared registry is used by compiler, Role output validation, Studio inputs, classic cases, and new Team cases. `READY` is the normal handoff event. |
| Conditional routing | Missing input, explicit `null`, invalid operand type, no-match, and fail-closed route decisions are covered. |
| Join | `pending/arrived/skipped/failed`, required skip, real failure, quorum threshold, late arrival, scope-before-failure, and loop boundary fixtures are covered by unit and runtime tests. |
| Review | `reviewId/round/lineageId/branchId/stateVersion`, stale and duplicate decisions, feedback lineage, loop budget continue/rework/reject/terminate actions, negative guardrails, multi-round authorization consumption, activation failure compensation, empty target diagnostics, and approve-to-overbudget parking are covered. |
| Artifact | Opaque reference, producer provenance, media type, activation-time allowed-set, late quorum exclusion, and denied reads are covered. |
| Result and recovery | Run-level result CAS, idempotent commit event, cancellation and resume reconciliation, history-only result fallback, and runtime semantics fingerprint are covered. |
| Cases | Classic Team flows and new Team flows include Debate Loop, Medical quorum, conditional approval, Artifact evidence, Error compensation, and GStacklike Review. |

## Boundary Behavior

- A loop budget review with no declared `NEEDS_REWORK` or `REJECTED` target disables that action in Team Site,
  reports the missing path through `ogs run review inspect`, and rejects control-plane submission with
  `GRAPH_LOOP_BUDGET_TARGET_UNAVAILABLE`.
- A normal human review `approve` that would activate a target at its loop limit creates the same
  `loop_exhausted` and `waiting_review` boundary as normal execution. It does not partially activate a parallel
  route before the budget review exists.

## Browser and Service Validation

Team Site and Visualizer were restarted from the final build and checked at:

- Team Site: `http://127.0.0.1:4173`
- Visualizer: `https://127.0.0.1:3337` when TLS is enabled; local HTTP remains available for an explicitly non-TLS launch

The LAN deployment was also restarted and checked on `192.168.0.109`:

- Team Site: `http://192.168.0.109:4173/`
- Visualizer: `https://192.168.0.109:3337/`
- Visualizer `/healthz` and `/readyz`: HTTP 200 over HTTPS
- Visualizer UI, API, assets, and metrics: Basic Auth required; health probes remain available for readiness checks

Visualizer `/healthz` and `/readyz` returned HTTP 200. Browser checks covered classic Team, new Team,
multiple TeamVersion selection, Expert Consultation quorum, Studio Simulation, Project/Task/Run/Review,
and graph layout rendering. The existing Team Site/X6 visual framework was preserved.

### Visualizer Changes In This Baseline

The visual layer received semantic projection and operator feedback updates only:

- Flow editing and Role output forms use the centralized fixed event registry, with `READY` as the normal handoff event.
- Run and review views expose loop budget exhaustion, target role, current/max iteration, and budget review actions.
- Join and review timelines label source outcomes and the new rejected-review audit records.
- Ops summaries group loop exhaustion and pending budget reviews without changing the underlying Run evidence format.

The Team Site page shell, Studio/Projects ownership boundary, X6 graph structure, responsive layout,
and service entry points were retained. No separate Studio runtime or UI framework was introduced.

The complete manual provider/Sandbox and Electron clean-install gates remain separate release operations and
are not converted into automated pass claims by this record.
