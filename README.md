# OGSystem

OGSystem is a console runtime for a restricted Mermaid flowchart DSL. Current stable release
candidate: `1.0.0`; not published.

Implemented scope:

- DSL: Mermaid `flowchart` restricted subset
- Root semantics: `Law / System / AuditTrail`
- Each System Role is a stable unique seat with one current executor binding. Current bindings resolve to a model or configured execution profile; nested System execution is not supported.
- Runtime outputs: `SystemState / Stage`
- Engine: one graph runtime for sequential, branching, parallel, join, and loop systems
- Role resolution: auto-load from project-local `og-roles/roles/<roleId>/`
- Semantic IR: explicit responsibility seats, conditions, event/state contracts, JoinScope, Loop Scope, and capability budgets
- Reliability: versioned state snapshots, CAS/idempotent commits, checkpoint replay, and runtime audit adapter ports
- Visualizer: responsibility-seat graph projections, semantic edge labels, loop channels, modes, Join overlays, and run-state overlays

Graph modeling invariant:

- A node is a responsibility role/agent seat, not an event, action, task, gateway, process step, or runtime record.
- A flow is a direct role-to-role handoff after the source role completes its responsibility; edge labels carry the event or handoff outcome.

Non-goals:

- No cross-host distributed runtime
- No recursive child-system runtime
- No `start/end` boundary alias mode
- No assembly layer

## Quick Start

Product introduction:

- `docs/usage/product-introduction.md`
- `docs/README.md`
- `docs/development/todo-backlog.md`

Detailed usage manual:

- `docs/usage/usage-manual.md`
- `docs/development/release-compatibility-policy.md`
- `examples/README.md` (minimal training set + capability coverage)

CLI installation prerequisites:

```bash
node 22.x or 24.x
```

Install the current development-test CLI from the source checkout:

```bash
npm install -g .
```

The package is not currently published to the public npm registry. From another directory, use an
absolute path to this checkout:

```bash
pnpm add -g /absolute/path/to/OGSystem
```

After a public registry release, the published package can be installed with:

```bash
npm install -g ogsystem
pnpm add -g ogsystem
```

Uninstall the globally installed CLI:

```bash
npm uninstall -g ogsystem
pnpm remove -g ogsystem
```

These commands remove the CLI package only. They do not remove shared role packages under `~/.ogsystem` or any project directories.

Quick start with the installed CLI:

```bash
ogs project create demo-app
cd demo-app
```

Minimal runnable quick start:

```bash
ogs project create demo-app --template minimal
cd demo-app
ogs run start --system system.mmd --input "smoke" --dry-run
ogs run list
ogs run status <run-id>
ogs run logs <run-id> --engine --tail 50
ogs vis --ogs-dir .
ogs visualizer --ogs-dir .
```

Stable lifecycle command anchors:

```bash
npm install -g .
pnpm add -g "$PWD"
npm uninstall -g ogsystem
pnpm remove -g ogsystem
ogs project create demo-app --template minimal
ogs project init
ogs run start --system system.mmd --input "smoke" --dry-run
ogs run list
ogs run status <run-id>
ogs run logs <run-id> --engine --tail 50
ogs vis --ogs-dir .
ogs visualizer --ogs-dir .
```

Generated projects always include `.ogs/`, `system.mmd`, and a local `og-roles/` repo. Backend/model choices live in `.ogs/model-selection.json`; `.ogs/model-catalog.json` records locally discovered CLI services and runnable models. OGS invokes persistent CLI services and uses each CLI's own user configuration; it does not import or manage credentials. The scaffold also writes `.ogs/README.md` with operator notes and JSON examples.

Version `1.0.0` is the first stable release candidate and is not published yet. It uses the current
Semantic IR v1 and versioned runtime contracts directly; historical DSL, API, and run-data migration
is not supported.

Released CLI compatibility policy: released versions support the latest two minor lines of the
current major release, with documented migrations for changed config or schema contracts. The
current `1.0.0` candidate defines the initial release line; its public support window starts when it
is published. Run `ogs help compatibility` for the
installed CLI's summary, unsupported-input boundary, and deprecation timing; see
`docs/development/release-compatibility-policy.md` for the full policy.

OGS invokes installed CLI services using their own user-level configuration and credentials. It does not load a separate OGS credential file or manage provider credentials.

Local source install:

```bash
npm install -g .

# pnpm global installs should use an absolute path, not "."
pnpm add -g "$PWD"
```

Develop from source (macOS/Linux/Windows):

```bash
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm install --frozen-lockfile
```

Build (all platforms):

```bash
pnpm run build
```

Validate and inspect coverage:

```bash
pnpm test
pnpm run test:examples
pnpm run test:doctor
pnpm run test:coverage
```

Coverage note:

- `pnpm run test:coverage` uses the Node test runner's built-in coverage table against `tests/*.mjs`.
- When interpreting coverage deltas, prioritize compiled runtime entrypoints under `dist/runtime/*` and `dist/nl2mmd/*`; temporary fixture scripts and generated test helpers are not coverage gates.

Package manager policy:

- Published package installs support `npm` and `pnpm`.
- Source repository development still expects `pnpm` and keeps the lockfile/CI workflow pinned to `pnpm@10.33.2`.
- Repository docs use installed `ogs*` commands first, then note `pnpm run ...` equivalents where relevant.

For day-to-day use, start with `docs/usage/usage-manual.md`. It keeps the command matrix and example systems in one place and avoids repeating the same examples here.

## Runtime Guarantees

- The adapter runs one graph-based execution model. The entry role becomes the initial active branch, each role execution emits one structured result, and completion happens only when active branches are exhausted or a transition reaches the terminal `output` boundary.
- Executable roles return one JSON object: `{"event":"EVENT_NAME","content":"..."}`. Agent roles use their selected persistent CLI backend and retain a role/thread session for the run; tool-bound roles use `exec.bind` and parse tool stdout as JSON. `event` must match an outgoing handoff label.
- OpenCode roles share one run-scoped `opencode serve`; Codex roles share one run-scoped `codex app-server` and resume the same thread for each role branch.
- Directory ownership is explicit: `--ogs-dir` owns the System, runtime configuration, Sessions, and `.ogs/runs/`; `--workspace-dir` is the project directory given to coding Roles. Explicit System and workspace paths are relative to the command directory; omitted `--system` selects `<ogs-dir>/system.mmd`.
- An OGS project may bind a separate workspace through `.ogs/project.json.target.directory`. Without an explicit `--workspace-dir`, the binding is used, then `ogs-dir` is the default. `ogs serve` manages interactive Sessions; every Turn creates a fresh Run and fresh Role backend contexts. A changed System or execution configuration makes existing Sessions stale and creates a linked child Session on the next Turn request.
- For `exec.bind`, relative tool arguments are materialized from the control project while the role process uses its run-local workspace; this keeps generated control-plane tools available in independent-target mode.
- Executable roles are resolved by `roleId` directly from the project-local role repo. For each Mermaid `Role:<roleId>`, the runtime loads `og-roles/roles/<roleId>/role.json`, renders `prompt.md`, validates the built-in runtime prompt-input shell, and validates `output.schema.json`.
- Each role's model binding is configured in `.ogs/model-selection.json` as a `backend` and `modelId` pair. `system.mmd` defines roles and handoffs, not model bindings.
- Agent execution retries transient service failures on the same role session while keeping the run-level service alive.
- The runtime supports `role.mode.*=parallel_split`, `join.mode.*=all_of|quorum_of`, `join.sources.*`, `join.min.*`, `context.map.*`, and `loop.max.*`. `join.sources.*` must list unique source role ids and match the join node's Mermaid incoming role edges exactly.
- `quorum_of` counts unique completed source roles within the same `lineageId + loopIteration`, activates at most once, and records late arrivals without retriggering the join node.
- `context.map.<roleId>.<field>` can replace the default `context` payload with a fail-closed, deterministic JSON projection built from `direct.*`, `source(<roleId>).*`, and `global.*` selectors.
- Role output repair is intentionally narrow: wrapped JSON object extraction and single-allowed-event normalization are auto-repaired; schema mismatch still fails fast.
- Runtime, audit, and CLI failures now carry one machine-parseable error envelope: `errorCode`, `errorCategory`, `message`, `retryable`, `stage`, plus role/run/branch/line context when available.
- Each run persists under `.ogs/runs/<run-id>/`, including run-level state, `sessions.json`, and per-role execution history under `roles/<roleId>/executions/`.
- Run-id format is `YYYYMMDD-HHMMSS-<shortHash>`.
- Each run gets its own isolated `.ogs/runs/<run-id>/shared/` directory, and role directories do not receive a `shared` symlink by default.
- `.ogs/runs/` is generated runtime state and should stay out of version control.
- `state.json.graphState` and `sessions.json` are the runtime-consumed resume sources. `events.ndjson` remains append-only audit history.
- `state.json` and `sessions.json` writes are atomic, and resume rejects partial/corrupted snapshots before execution starts.
- Runs persist `activeBranches`, `completedBranches`, `loopIterations`, and `graphState` inside `state.json`, and support `ogs run resume <run-id>` against the same run directory.
- `audit/summary.md` and result JSON now expose `totalTransitions`, `okCount`, `failedCount`, `handledFailureCount`, `unhandledFailureCount`, `handledFailureByEvent`, `handledFailureByTargetRole`, `noopCount`, structured `failureCountsByErrorCode`, and repair statistics.
- Runtime failure routing supports explicit error flows expressed as `ERROR*` edge labels behind `runtime.error_flows.v1` (default `false`): exact `ERROR.<errorCode>` first, then fallback `ERROR`; no match remains fail-stop.
- `ERROR*` routing is evaluated only after executor-level retries for the attempt are exhausted.
- Mermaid parsing is fail-closed for reserved error events: only `ERROR` and `ERROR.<errorCode>` are accepted.
- Role outputs cannot proactively emit `ERROR*` events; `ERROR*` is reserved for runtime failure routing only.
- run progress logs are printed to `stderr` by default; final result JSON remains on `stdout`. Use `--quiet-run` to silence progress logs.
- Roles without execution binding fail fast by default. A law may opt into `allowNoopWithoutExecutionBinding`, but noop remains explicit and is rejected on branching nodes.
- `user-profile.json` is injected into role prompts as delivery preference; role packages decide how to apply it.

## Configuration Boundaries

- `.ogs/model-selection.json` is the single backend/model binding source, with project defaults and per-role overrides.
- The law catalog currently resolves only `law.global` and the constraints `forbiddenToolRefs`, `maxTransitions`, `allowNoopWithoutExecutionBinding`.
- Role packages live under `og-roles/roles/<roleId>/` and provide `role.json` with the complete current Role Contract, plus `agent.md`, `prompt.md`, `output.schema.json`, and optional `source.json`.
- The runtime-owned prompt-input shell remains fixed across roles and exposes `allowed_events`, `user_preferences`, `task`, and `input`.
- Upstream agent repositories live under `agent-sources/` only during development; runtime executes only canonical role packages under `og-roles/roles/`.
- `node tools/agent-source/sync-agent-sources.mjs --source agency-agents` imports an upstream checkout into canonical `imported.<source>.*` role packages and updates `tools/agent-source/sources.lock.json`.
- Prompt-shell field names and selector syntax are separate layers: prompts use `user_preferences`, while `context.map` selectors still use `global.user_profile.*`.
- The installed CLI ships bundled role/model templates, but those are import sources, not runtime execution dependencies.
- `system.mmd` owns role and handoff structure; role packages own prompt and I/O contract; `.ogs/model-selection.json` owns backend/model selection.

## Target Scaffolding

- `.ogs/model-catalog.json` records discovered CLI backends and runnable model IDs; `.ogs/model-selection.json` stores `backend` and `modelId` selections.
- `.ogs/runtime.json` provides runtime defaults for the role repo and runs directory.
- `~/.ogsystem/` stores shared system role packages; CLI backend credentials remain in each CLI's own user-level configuration.
- `.ogs/runtime.json` may include `configVersion: "2"`; unsupported versions fail fast.
- `.ogs/user-profile.json` provides user delivery preference sample.
- `.ogs/laws.json` provides sample law catalog colocated with runtime config.
- `ogs project init` scaffolds the current directory as a runnable project using the selected template.
- `ogs project create <name> [--template <...>]` scaffolds the same structure in a new project directory.
- `ogs project sync --system <file.mmd>` imports only the roles referenced by that system into the project-local role repo.
- `ogs models discover` refreshes installed CLI/model discovery; `ogs models sync` also creates `.ogs/model-selection.json` when missing without replacing existing choices.
- `ogs vis --ogs-dir .` starts the read-mostly run visualizer. It keeps project/run/review/resume projections read-first, uses incremental timeline streaming instead of full run reloads on every event, loads resume diagnostics on demand, keeps project cold-start on persisted projections instead of forcing a runs-directory scan, and routes review decide / stop / reindex through existing lifecycle entrypoints with confirmation + audit input prompts. Review views now expose lifecycle `currentStatus` separately from durable decision `decisionPhase` (`recorded`, `pending_reconcile`, `applied`). `ogs run start --visualize` attaches a temporary visualizer that auto-closes when the run ends.
- The Visualizer API contract is in `schemas/openapi.yaml`. `/healthz`, `/readyz`, and `/metrics` expose liveness, readiness, and low-cardinality Prometheus metrics.
- The initial trust model is single-machine/local-user: Visualizer defaults to `127.0.0.1`, and loopback audit identity is the OS account running OGS, not a distinct browser operator. Non-loopback binds require an injected identity provider and authorization policy; no built-in remote or multi-user identity setup is promised. Control actions record the resolved principal, never an actor supplied in the request body.
- `exec.bind` runs configured local tools with the caller's OS permissions and is not a security sandbox. Use it only with trusted project configuration and role packages. CLI backend credentials remain under each CLI's user-level configuration.
- Remote execution protocol v1 and its runtime validators are documented in `src/runtime/remote-execution-contract.ts`; it defines the replaceable-call boundary but does not enable remote worker dispatch in this release.
- Model backend/model configuration is managed in Studio or `.ogs/model-selection.json`, not in Mermaid metadata.
- `examples/langgraph-debate-current/` shows a minimal debate with loop + parallel + join.
- `D:\Coder\AAI\mulit-debate-ogs\` is a standalone OGSystem application adapted from the sibling `mulit-debate` project, with bounded parallel debate and required human review.
- `examples/langgraph-expert-consultation/` shows a minimal expert consultation with parallel + join.
- `examples/medical-quorum-consultation/` shows quorum join + context projection in a professional consultation flow.
- `examples/error-flow-compensation/` shows failure-to-compensation routing via error flows expressed as `ERROR*` edge labels.
- `examples/runtime-native-human-review/` shows the smallest runtime-native stop-review-resume path.
- `examples/ogs-gstacklike/` shows a project-style flow with project-local `og-roles/`, runtime-native human review, run-level shared artifacts, and compensation routing.
- `examples/README.md` is the training handbook for minimal example set and coverage matrix.
- `og-roles/roles/error-handler-base/` provides the reusable compensation template role package.

Validate a generated run directory against the runtime contract:

```bash
node skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs \
  --system examples/target-model-binding-system.mmd \
  --user-profile .ogs/user-profile.json \
  --laws .ogs/laws.json \
  --run-dir .ogs/runs/<run-id>
```

## DSL Hard Rules

- Only `input/output` are system boundary tokens.
- `input/output/start/end/done` cannot be role ids.
- Unknown metadata keys fail validation.

## Runtime Core

- `src/runtime/cli.ts`
- `src/runtime/adapter.ts`
- `src/runtime/execution-plan.ts`
- `src/runtime/executor.ts`
- `src/runtime/graph-runner.ts`
- `src/runtime/role-executor.ts`
- `src/runtime/model-repo.ts`
- `src/runtime/parse-mermaid.ts`
- `src/runtime/stage-projector.ts`
- `src/runtime/tool-runner.ts`
- `src/runtime/doctor.ts`

## Documentation

- `docs/README.md` is the authoritative document index and archive policy.
- `docs/usage/product-introduction.md` is the project-level overview.
- `docs/usage/usage-manual.md` is the main operator/developer manual.
- `docs/usage/ogsystem-orchestration-semantics-v1.md` is the orchestration semantics source of truth.
- `docs/development/DECISIONS.md` records architecture decisions.
