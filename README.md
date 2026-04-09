# OGSystem

OGSystem is a minimal console runtime for a restricted Mermaid flowchart DSL.

Implemented scope:

- DSL: Mermaid `flowchart` restricted subset
- Root semantics: `Law / System / AuditTrail`
- Runtime outputs: `SystemState / Stage`
- Engine: explicit state-machine runtime
- Role resolution: auto-load from `og-roles/roles/<roleId>/`

Non-goals:

- No full platform parity
- No recursive child-system runtime
- No `start/end` boundary alias mode
- No assembly layer

## Quick Start

Detailed usage manual:

- `docs/usage-manual.md`

Install:

```bash
npm install
```

Build:

```bash
npm run build
```

Run minimal example (no external CLI execution):

```bash
npm run run:adapter -- \
  --system examples/minimal-system.mmd \
  --laws examples/console-laws.json \
  --prompt "demo" \
  --dry-run
```

Run target model-binding example with auto-discovered `.ogsystem/` config:

```bash
npm run run:adapter -- \
  --system examples/target-model-binding-system.mmd \
  --prompt "讨论当前架构是否继续最小化" \
  --dry-run
```

Run console example (legacy compatibility path):

```bash
npm run run:adapter -- \
  --system examples/console-system.mmd \
  --profiles examples/console-profiles.json \
  --tools examples/console-tools.json \
  --laws examples/console-laws.json \
  --prompt "分析当前仓库结构并输出摘要" \
  --dry-run
```

Check required CLI tools:

```bash
npm run run:doctor -- --required codex
```

## Runtime Guarantees

- The adapter progresses through an explicit state machine. The entry role becomes the initial state, each role execution emits one structured result, and completion happens only when a transition reaches the terminal `output` boundary or an explicit noop law allows a single-path pass-through.
- Executable roles must emit strict JSON on stdout: `{"event":"EVENT_NAME","content":"..."}`. `event` is required for roles with outgoing flows and must match one Mermaid edge label exactly. Regex matching and line-by-line event guessing are not supported.
- Executable roles are resolved by `roleId` directly. For each Mermaid `Role:<roleId>`, the runtime loads `og-roles/roles/<roleId>/role.json`, renders `prompt.md`, validates optional `input.schema.json`, and validates `output.schema.json`.
- The runtime now supports `model.bind.<roleId>=<modelId>` with auto-discovered `.ogsystem/runtime.json`, `.ogsystem/user-profile.json`, `.ogsystem/laws.json`, and `og-models/`.
- Each run persists under `.ogsystems/<run-id>/`, including run-level state and per-role prompt/result/audit artifacts.
- `.ogsystems/` is generated runtime state and should stay out of version control.
- Roles without execution binding fail fast by default. A law may opt into `allowNoopWithoutExecutionBinding`, but noop remains explicit and is rejected on branching nodes.

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

- `og-models/models/*/model.json` provides model repository samples.
- `.ogsystem/runtime.json` provides runtime defaults for shared workspace and runs directory.
- `.ogsystem/user-profile.json` provides user delivery preference sample.
- `.ogsystem/laws.json` provides sample law catalog colocated with runtime config.
- `examples/target-model-binding-system.mmd` shows `model.bind.*` usage.

Validate a generated run directory against the runtime contract:

```bash
node skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs \
  --system examples/target-model-binding-system.mmd \
  --user-profile .ogsystem/user-profile.json \
  --laws .ogsystem/laws.json \
  --run-dir .ogsystems/<run-id>
```

## DSL Hard Rules

- Only `input/output` are system boundary tokens.
- `input/output/start/end/done` cannot be role ids.
- Unknown metadata keys fail validation.

## Runtime Core

- `src/runtime/cli.ts`
- `src/runtime/adapter.ts`
- `src/runtime/model-repo.ts`
- `src/runtime/parse-mermaid.ts`
- `src/runtime/stage-projector.ts`
- `src/runtime/tool-runner.ts`
- `src/runtime/doctor.ts`

## Docs

- `docs/role-model-user-profile-minimal-spec.md`
- `docs/implementation-checklist-role-model-opencode-langgraph.md`
- `docs/usage-manual.md`
- `docs/semantic-kernel-v1.md`
- `docs/xlgraph-subset-compatibility.md`
- `docs/langgraph-engine-example-systems.md`
- `docs/ogsystem-role-repo-minimal-plan.md`
- `specs/mermaid-dsl-v0.1.md`
