# OGSystem

OGSystem is a console runtime for a restricted Mermaid flowchart DSL.

Implemented scope:

- DSL: Mermaid `flowchart` restricted subset
- Root semantics: `Law / System / AuditTrail`
- Runtime outputs: `SystemState / Stage`
- Engine: one graph runtime for sequential, branching, parallel, join, and loop systems
- Role resolution: auto-load from `og-roles/roles/<roleId>/`

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

Prerequisites:

```bash
node >= 20
corepack enabled
pnpm 10.14.0
```

Install (macOS/Linux):

```bash
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm install --frozen-lockfile
```

Install (Windows PowerShell):

```powershell
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm install --frozen-lockfile
```

Install (Windows CMD):

```bat
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm install --frozen-lockfile
```

Build (all platforms):

```bash
pnpm run build
```

Package manager policy (best practice):

- Install phase is hard-enforced as `pnpm-only` (`packageManager` + `preinstall` guard).
- Script execution phase is standardized on `pnpm run ...` in docs and CI.
- `npm run ...` may still work when dependencies are already installed; this is compatibility behavior, not the supported workflow.

Lifecycle commands (preferred):

```bash
pnpm run run:adapter -- project init
pnpm run run:adapter -- run start --system examples/target-model-binding-system.mmd --prompt "demo" --dry-run
pnpm run run:adapter -- run list
pnpm run run:adapter -- run status <run-id>
pnpm run run:adapter -- run logs <run-id> --engine
```

Run minimal example (no external CLI execution):

```bash
pnpm run run:adapter -- \
  --system examples/minimal-system.mmd \
  --laws examples/console-laws.json \
  --prompt "demo" \
  --dry-run
```

Run target model-binding example with auto-discovered `.ogs/` config:

```bash
pnpm run run:adapter -- \
  --system examples/target-model-binding-system.mmd \
  --prompt "讨论当前架构是否继续最小化" \
  --dry-run
```

Run console example (legacy compatibility path):

```bash
pnpm run run:adapter -- \
  --system examples/console-system.mmd \
  --profiles examples/console-profiles.json \
  --tools examples/console-tools.json \
  --laws examples/console-laws.json \
  --prompt "分析当前仓库结构并输出摘要" \
  --dry-run
```

Run graph debate example:

```bash
pnpm run run:adapter -- \
  --system examples/langgraph-debate-current/system.mmd \
  --laws examples/langgraph-debate-current/laws.json \
  --user-profile examples/langgraph-debate-current/user-profile.json \
  --prompt "是否应继续保持 OGSystem 最小化并延后 reducer 与恢复语义？" \
  --dry-run
```

Run graph expert consultation example:

```bash
pnpm run run:adapter -- \
  --system examples/langgraph-expert-consultation/system.mmd \
  --laws examples/langgraph-expert-consultation/laws.json \
  --user-profile examples/langgraph-expert-consultation/user-profile.json \
  --prompt "患者间断高热、皮疹、胸闷、肌无力，常规检查未能解释原因，请组织多学科会诊。" \
  --dry-run
```

Run Rust hello-world three-role full-flow validation (requires `cargo`):

```bash
pnpm run run:adapter -- \
  --system examples/rust-hello-pipeline/system.mmd \
  --profiles examples/rust-hello-pipeline/profiles.json \
  --tools examples/rust-hello-pipeline/tools.json \
  --laws .ogs/laws.json \
  --prompt "validate rust hello pipeline"
```

Check required CLI tools:

```bash
pnpm run run:doctor -- --required opencode
```

Lint a system with the runtime parser/validator:

```bash
pnpm run lint:system -- --system examples/target-model-binding-system.mmd
```

Show simple role/transition progress in the console while keeping final JSON on stdout:

```bash
pnpm run run:adapter -- \
  --system examples/target-model-binding-system.mmd \
  --prompt "讨论当前架构是否继续最小化" \
  --dry-run \
  --log-run
```

## Runtime Guarantees

- The adapter runs one graph-based execution model. The entry role becomes the initial active branch, each role execution emits one structured result, and completion happens only when active branches are exhausted or a transition reaches the terminal `output` boundary.
- Executable roles always resolve to one JSON object: `{"event":"EVENT_NAME","content":"..."}`. For `model.bind`, the runtime sends `prompt + output.schema.json` to OpenCode SDK v2 and reads `info.structured`; if `info.structured` is absent or string-encoded, the runtime falls back to assistant text parts and applies JSON extraction. For legacy `exec.bind`, the runtime still parses tool stdout as one JSON object. `event` is required for roles with outgoing flows and must match one Mermaid edge label exactly.
- For `model.bind`, one run now starts one shared `opencode serve`, and each role/node keeps one isolated OpenCode session on that server for the duration of the run.
- Executable roles are resolved by `roleId` directly. For each Mermaid `Role:<roleId>`, the runtime loads `og-roles/roles/<roleId>/role.json`, renders `prompt.md`, validates optional `input.schema.json`, and validates `output.schema.json`.
- The runtime now supports `model.bind.<roleId>=<modelId>` with auto-discovered `.ogs/runtime.json`, `.ogs/user-profile.json`, `.ogs/laws.json`, and `og-models/`.
- `model.bind` retries transient OpenCode/provider failures on the same role session while keeping the same run-level shared server.
- The runtime supports `role.mode.*=parallel_split`, `join.mode.*=all_of`, `join.sources.*`, and `loop.max.*`. Legacy `%% engine=langgraph` metadata is accepted as compatibility input but is not required DSL semantics.
- Role output repair is intentionally narrow: wrapped JSON object extraction and single-allowed-event normalization are auto-repaired; schema mismatch still fails fast.
- Runtime, audit, and CLI failures now carry one machine-parseable error envelope: `errorCode`, `errorCategory`, `message`, `retryable`, `stage`, plus role/run/branch/line context when available.
- Each run persists under `.ogs/runs/<run-id>/`, including run-level state, `sessions.json`, and per-role execution history under `roles/<roleId>/executions/`.
- Run-id format is `YYYYMMDD-HHMMSS-<shortHash>`.
- Each run gets its own isolated `.ogs/runs/<run-id>/shared/` directory, and role directories do not receive a `shared` symlink by default.
- `.ogs/runs/` is generated runtime state and should stay out of version control.
- `state.json.graphState` and `sessions.json` are the runtime-consumed resume sources. `events.ndjson` remains append-only audit history.
- `state.json` and `sessions.json` writes are atomic, and resume rejects partial/corrupted snapshots before execution starts.
- Runs persist `activeBranches`, `completedBranches`, `loopIterations`, and `graphState` inside `state.json`, and support `--resume-run` against the same run directory.
- `audit/summary.md` and result JSON now expose `totalTransitions`, `okCount`, `failedCount`, `noopCount`, structured `failureCountsByErrorCode`, and repair statistics.
- `--log-run` prints simple run/role/transition progress lines to `stderr`; final result JSON remains on `stdout`.
- Roles without execution binding fail fast by default. A law may opt into `allowNoopWithoutExecutionBinding`, but noop remains explicit and is rejected on branching nodes.
- `user-profile.json` is injected into role prompts as delivery preference; role packages decide how to apply it.

## Configuration Boundaries

- Target architecture uses `model.bind.<roleId>=<modelId>` with `og-models/`.
- Legacy runtime still reads `exec.bind.<roleId>` with `profiles/tools`.
- Profiles are single-tool only: `profileId`, `toolRef`, optional `timeoutMs`, optional `maxOutputBytes`.
- Tools are minimal shell adapters: `toolRef`, `runner`, `command`, `argsTemplate`, `stdinMode`.
- The law catalog currently resolves only `law.global` and the constraints `forbiddenToolRefs`, `maxTransitions`, `allowNoopWithoutExecutionBinding`.
- `talentBinding` is preserved as metadata-only sidecar in the parsed system definition. It is not part of runtime execution.
- Role packages live under `og-roles/roles/<roleId>/` and provide `role.json`, `prompt.md`, optional `persona.md`, optional `work.md`, optional `input.schema.json`, and required `output.schema.json`.
- `system.mmd` owns flow and role-to-model binding (`model.bind.*`; `exec.bind.*` in legacy runtime); role packages own prompt and I/O contract.

## Target Scaffolding

- `og-models/catalog/opencode-models.json` snapshots the current local `opencode models` list.
- `og-models/models/*/model.json` provides curated reusable model bindings.
- `.ogs/runtime.json` provides runtime defaults for role repo, model repo, and runs directory.
- `.ogs/runtime.json` may include `configVersion: "1"`; unsupported versions fail fast.
- `.ogs/user-profile.json` provides user delivery preference sample.
- `.ogs/laws.json` provides sample law catalog colocated with runtime config.
- `examples/target-model-binding-system.mmd` shows `model.bind.*` usage.
- `examples/langgraph-debate-current/` shows a minimal debate with loop + parallel + join.
- `examples/langgraph-expert-consultation/` shows a minimal expert consultation with parallel + join.

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
