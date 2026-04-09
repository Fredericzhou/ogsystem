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

Run console example (codex profile):

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
- Roles without `exec.bind` fail fast by default. A law may opt into `allowNoopWithoutExecutionBinding`, but noop remains explicit and is rejected on branching nodes.

## Configuration Boundaries

- Profiles are single-tool only: `profileId`, `toolRef`, optional `timeoutMs`, optional `maxOutputBytes`.
- Tools are minimal shell adapters: `toolRef`, `runner`, `command`, `argsTemplate`, `stdinMode`.
- The law catalog currently resolves only `law.global` and the constraints `forbiddenToolRefs`, `maxTransitions`, `allowNoopWithoutExecutionBinding`.
- `talentBinding` is preserved as metadata-only sidecar in the parsed system definition. It is not part of runtime execution.
- Role packages live under `og-roles/roles/<roleId>/` and provide `role.json`, `prompt.md`, optional `persona.md`, optional `work.md`, optional `input.schema.json`, and required `output.schema.json`.
- `system.mmd` owns flow and `exec.bind.*`; role packages own prompt and I/O contract.

## DSL Hard Rules

- Only `input/output` are system boundary tokens.
- `input/output/start/end/done` cannot be role ids.
- Unknown metadata keys fail validation.

## Runtime Core

- `src/runtime/cli.ts`
- `src/runtime/adapter.ts`
- `src/runtime/parse-mermaid.ts`
- `src/runtime/stage-projector.ts`
- `src/runtime/tool-runner.ts`
- `src/runtime/doctor.ts`

## Docs

- `docs/semantic-kernel-v1.md`
- `docs/xlgraph-subset-compatibility.md`
- `docs/langgraph-engine-example-systems.md`
- `docs/ogsystem-role-repo-minimal-plan.md`
- `specs/mermaid-dsl-v0.1.md`
