# Historical Release Validation Record (Superseded)

Date: 2026-11-05
Status: superseded by [release-validation-2026-11-08.md](release-validation-2026-11-08.md).
Scope: current runtime, model discovery, native CLI integrations, role repository trial, Studio/Projects browser flows, and documentation alignment.

## Automated Verification

| Check | Result |
| --- | --- |
| `pnpm build` | PASS: Studio client typecheck, TypeScript build, Studio bundle, and Visualizer bundle |
| Root `pnpm test` | PASS: 710/710 executable tests; 1 Windows-only test skipped on macOS |
| Team Site `pnpm --dir apps/team-site test` | PASS: 454/454 tests |
| Role trial focused tests | PASS: 2/2 |
| Platform model browser test | PASS: 1/1 |
| `git diff --check` | PASS |

The first root-suite attempt exposed a stale example fixture using model catalog version 3. The example was updated to the current catalog version 4 and the affected end-to-end test passed before the final 710-test run. A parallel Team Site run temporarily exhausted the local temporary volume; the suite was rerun serially after cleanup and passed in full.

## Browser Validation

The Team Site was restarted from the final code state with `HOST=0.0.0.0`.

- LAN URL: `http://192.168.0.109:4173`
- Platform model page: independent backend rows render progressively. OpenCode, Codex, Ollama, Pi, and Qwen Code reported runnable; Kimi Code reported an actionable environment error because the OGS process did not contain `OGS_CODEX_BEARER_TOKEN`.
- Role repository: 18 roles loaded without browser errors. A real Brand Guardian role trial completed through OpenCode `codex-gateway/gpt-6-luna` in about 16 seconds and returned structured output.
- Role trial verification confirmed the temporary package uses `team-roles/roles/<roleId>`, embeds a verified source record only in the isolated trial package, and does not generate `system.mmd`.
- Platform discovery regression: the UI now consumes `sources[0]` from each backend response and no longer waits on aggregate discovery before starting independent backend checks.

Playwright was used for the detailed final user-flow checks. Orca/Chrome accessibility inspection was also used for the LAN platform and role pages before a later macOS accessibility-window interruption; no native screen-reader sign-off is claimed.

## Runtime Semantic Execution Validation

The semantic checks below run the real Runtime Adapter and filesystem evidence path. Each case creates a run directory, executes Role transitions, persists state and audit artifacts, and inspects the resulting evidence. Role model calls use the repository's deterministic `dryRun` executor so the semantic result is repeatable; this is not a live provider acceptance test.

Command:

```bash
node --test \
  tests/graph-runtime.integration.test.mjs \
  tests/semantic-ir.test.mjs \
  tests/graph-runtime-state.test.mjs \
  tests/transition.test.mjs \
  tests/role-executor-projection.test.mjs \
  apps/team-site/tests/studio-simulation-use-cases.test.mjs
```

Result: `98/98` passed.

| Semantic capability | Real execution evidence covered |
| --- | --- |
| Task and input propagation | The immutable user task is present in each Role inbox; per-hop `input` is projected from upstream output and Join context. |
| Role event contract | Role outputs are schema-checked against declared events; the selected event is persisted in audit records and drives the next transition. |
| Conditional routing | Route conditions select the matching edge, persist a value-free route decision trace, and fail closed for no-match or ambiguous routes. |
| Parallel branch | `parallel_split` activates distinct branches, preserves branch/lineage identity, excludes runtime `ERROR*` edges from normal routing, and aggregates terminal outputs in graph order. |
| All-of Join | A Join waits for every declared source, creates a Join scope keyed by lineage and loop iteration, and receives source event/data through the configured context projection. |
| Quorum Join | `quorum_of` activates at the configured minimum, isolates readiness by lineage, and rejects unavailable required context instead of fabricating input. |
| Bounded Loop | The debate scenario executes the moderator twice, records `loopIteration = 2`, follows the bounded rework event, and reaches the summary Role without exceeding the loop budget. |
| State and recovery | CAS checkpoints, `state.json`, `summary.json`, `metrics.json`, timeline, and append-only events are written; resuming the completed run does not duplicate Role executions. |
| Studio Simulation boundary | Simulation owner, incremental Role events, terminal state, redacted failures, and event retrieval are persisted in the Studio namespace without creating a Project Task or business Run. |

This validates the current semantic contract as an event-driven persistent extended state machine: Roles produce events and data, the Runtime carries task/input context, and Flow metadata selects the next Role. It does not claim live API-provider/model quality; that requires valid provider credentials and is tracked separately.

## Documentation Alignment

Current product documentation describes OGS as an event-driven, persistent extended state-machine workflow runtime. It distinguishes task, input, event, data, lifecycle state, and Flow routing, and identifies LangGraph as an implementation engine rather than the public semantic contract.

The fixed business-event protocol document is explicitly marked as a target protocol. The active runtime still accepts the current Role Contract event declarations; the target protocol is not described as already enforced.

Native CLI documentation records API-provider configuration and current local paths for Pi, Qwen Code, and Kimi Code. Credentials are not copied into projects or run artifacts.

## Release Notes

This record supersedes older validation counts for the checks listed above. Historical UAT records remain in `ogs-studio-project-run-isolation-validation-report.md`; they are not silently rewritten. Remaining release work is limited to real-device accessibility sign-off, full manual human-review acceptance, and live provider credentials where required.
