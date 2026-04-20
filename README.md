# OGSystem

OGSystem is a console runtime for a restricted Mermaid flowchart DSL.

Implemented scope:

- DSL: Mermaid `flowchart` restricted subset
- Root semantics: `Law / System / AuditTrail`
- Runtime outputs: `SystemState / Stage`
- Engine: one graph runtime for sequential, branching, parallel, join, and loop systems
- Role resolution: auto-load from project-local `og-roles/roles/<roleId>/`

Non-goals:

- No cross-host distributed runtime
- No recursive child-system runtime
- No `start/end` boundary alias mode
- No assembly layer

## Quick Start

Product introduction:

- `docs/product-introduction.md`
- `docs/README.md`
- `docs/todo-backlog.md`

Detailed usage manual:

- `docs/usage-manual.md`
- `examples/README.md` (minimal training set + capability coverage)

CLI installation prerequisites:

```bash
node >= 20
```

Install the published CLI with npm:

```bash
npm install -g ogsystem
```

Install the published CLI with pnpm:

```bash
pnpm add -g ogsystem
```

Quick start with the installed CLI:

```bash
ogs project create demo-app
cd demo-app

# for a runnable starter graph instead of an empty scaffold:
# ogs project create demo-app --template minimal
```

Minimal runnable quick start:

```bash
ogs project create demo-app --template minimal
cd demo-app
ogs run start --system system.mmd --input "smoke" --dry-run
ogs visualizer --workdir .
```

Generated projects always include `.ogs/`, `system.mmd`, and local `og-roles/` / `og-models/` repos. The default `create` scaffold is empty and also writes `system.example.mmd`; runnable templates import only the role/model dependencies they reference.

Local source install:

```bash
npm install -g .

# pnpm global installs should use an absolute path, not "."
pnpm add -g "$PWD"
```

Develop from source (macOS/Linux/Windows):

```bash
corepack enable
corepack prepare pnpm@10.14.0 --activate
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
- Source repository development still expects `pnpm` and keeps the lockfile/CI workflow pinned to `pnpm@10.14.0`.
- Repository docs use installed `ogs*` commands first, then note `pnpm run ...` equivalents where relevant.

For day-to-day use, start with `docs/usage-manual.md`. It keeps the command matrix and example systems in one place and avoids repeating the same examples here.

## Runtime Guarantees

- The adapter runs one graph-based execution model. The entry role becomes the initial active branch, each role execution emits one structured result, and completion happens only when active branches are exhausted or a transition reaches the terminal `output` boundary.
- Executable roles always resolve to one JSON object: `{"event":"EVENT_NAME","content":"..."}`. For `model.bind`, the runtime sends `prompt + output.schema.json` to OpenCode SDK v2 and reads `info.structured`; if `info.structured` is absent or string-encoded, the runtime falls back to assistant text parts and applies JSON extraction. For legacy `exec.bind`, the runtime still parses tool stdout as one JSON object. `event` is required for roles with outgoing flows and must match one Mermaid edge label exactly.
- For `model.bind`, one run now starts one shared `opencode serve`, and each role/node keeps one isolated OpenCode session on that server for the duration of the run.
- Executable roles are resolved by `roleId` directly from the project-local role repo. For each Mermaid `Role:<roleId>`, the runtime loads `og-roles/roles/<roleId>/role.json`, renders `prompt.md`, validates the built-in runtime prompt-input shell, and validates `output.schema.json`.
- The runtime now supports `model.bind.<roleId>=<modelId>` with auto-discovered `.ogs/runtime.json`, `.ogs/user-profile.json`, `.ogs/laws.json`, and project-local `og-models/`.
- `model.bind` retries transient OpenCode/provider failures on the same role session while keeping the same run-level shared server.
- The runtime supports `role.mode.*=parallel_split`, `join.mode.*=all_of|quorum_of`, `join.sources.*`, `join.min.*`, `context.map.*`, and `loop.max.*`. `join.sources.*` must list unique source role ids and match the join node's Mermaid incoming role edges exactly. Legacy `%% engine=langgraph` metadata is accepted as compatibility input but is not required DSL semantics.
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
- Runs persist `activeBranches`, `completedBranches`, `loopIterations`, and `graphState` inside `state.json`, and support `--resume-run` against the same run directory.
- `audit/summary.md` and result JSON now expose `totalTransitions`, `okCount`, `failedCount`, `handledFailureCount`, `unhandledFailureCount`, `handledFailureByEvent`, `handledFailureByTargetRole`, `noopCount`, structured `failureCountsByErrorCode`, and repair statistics.
- Runtime failure routing supports explicit error flows expressed as `ERROR*` edge labels behind `runtime.error_flows.v1` (default `false`): exact `ERROR.<errorCode>` first, then fallback `ERROR`; no match remains fail-stop.
- `ERROR*` routing is evaluated only after executor-level retries for the attempt are exhausted.
- Mermaid parsing is fail-closed for reserved error events: only `ERROR` and `ERROR.<errorCode>` are accepted.
- Role outputs cannot proactively emit `ERROR*` events; `ERROR*` is reserved for runtime failure routing only.
- run progress logs are printed to `stderr` by default; final result JSON remains on `stdout`. Use `--quiet-run` to silence progress logs.
- Roles without execution binding fail fast by default. A law may opt into `allowNoopWithoutExecutionBinding`, but noop remains explicit and is rejected on branching nodes.
- `user-profile.json` is injected into role prompts as delivery preference; role packages decide how to apply it.

## Configuration Boundaries

- Target architecture uses `model.bind.<roleId>=<modelId>` with project-local `og-models/`.
- Legacy runtime still reads `exec.bind.<roleId>` with `profiles/tools`.
- Profiles are single-tool only: `profileId`, `toolRef`, optional `timeoutMs`, optional `maxOutputBytes`.
- Tools are minimal shell adapters: `toolRef`, `runner`, `command`, `argsTemplate`, `stdinMode`.
- The law catalog currently resolves only `law.global` and the constraints `forbiddenToolRefs`, `maxTransitions`, `allowNoopWithoutExecutionBinding`.
- `talentBinding` is preserved as metadata-only sidecar in the parsed system definition. It is not part of runtime execution.
- Role packages live under `og-roles/roles/<roleId>/` and provide `role.json`, `prompt.md`, optional `persona.md`, optional `work.md`, and required `output.schema.json`.
- The runtime-owned prompt-input shell remains fixed across roles and currently exposes `task`, `context`, `allowed_events`, `last_output`, `system_notes`, `round`, and `user_profile`.
- The installed CLI ships bundled role/model templates, but those are import sources, not runtime execution dependencies.
- `system.mmd` owns flow and role-to-model binding (`model.bind.*`; `exec.bind.*` in legacy runtime); role packages own prompt and I/O contract.

## Target Scaffolding

- `og-models/catalog/opencode-models.json` snapshots the current local `opencode models` list.
- `og-models/models/*/model.json` provides curated reusable model bindings.
- `.ogs/runtime.json` provides runtime defaults for role repo, model repo, and runs directory.
- `.ogs/runtime.json` may include `configVersion: "1"`; unsupported versions fail fast.
- `.ogs/user-profile.json` provides user delivery preference sample.
- `.ogs/laws.json` provides sample law catalog colocated with runtime config.
- `ogs project init` scaffolds the current directory as a runnable project using the selected template.
- `ogs project create <name> [--template <...>]` scaffolds the same structure in a new project directory.
- `ogs project sync --system <file.mmd>` imports only the roles/models referenced by that system into the project-local repos.
- `ogs visualizer --workdir .` starts the read-only run visualizer, and `ogs run start --visualize` attaches a temporary visualizer that auto-closes when the run ends.
- `examples/target-model-binding-system.mmd` shows `model.bind.*` usage.
- `examples/langgraph-debate-current/` shows a minimal debate with loop + parallel + join.
- `examples/langgraph-expert-consultation/` shows a minimal expert consultation with parallel + join.
- `examples/medical-quorum-consultation/` shows quorum join + context projection in a professional consultation flow.
- `examples/error-flow-compensation/` shows failure-to-compensation routing via error flows expressed as `ERROR*` edge labels.
- `examples/human-gate-workflow/` shows template-based human approval/signal gate flow.
- `examples/incident-response-playbook/` shows integrated exception-routing + human-in-the-loop incident handling.
- `examples/README.md` is the training handbook for minimal example set and coverage matrix.
- `og-roles/roles/error-handler-base/`, `og-roles/roles/human-approve-gate/`, and `og-roles/roles/human-signal-wait/` provide reusable template role packages.

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
- `docs/product-introduction.md` is the project-level overview.
- `docs/usage-manual.md` is the main operator/developer manual.
- `docs/ogsystem-orchestration-semantics-v1.md` is the orchestration semantics source of truth.
- `docs/DECISIONS.md` records architecture decisions.
