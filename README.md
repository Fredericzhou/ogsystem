# OGSystem

OGSystem is a minimal console runtime for a restricted Mermaid flowchart DSL, with semantic naming kept as an `xlgraph` subset.

Implemented scope:

- DSL: Mermaid `flowchart` restricted subset
- Root semantics: `Law / System / AuditTrail`
- Runtime outputs: `SystemState / Stage`
- Engine: explicit state-machine runtime

Non-goals:

- No full platform parity
- No recursive child-system runtime
- No `start/end` boundary alias mode

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
  --role-prompts examples/console-role-prompts.json \
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
- Roles without `exec.bind` fail fast by default. A law may opt into `allowNoopWithoutExecutionBinding`, but noop remains explicit and is rejected on branching nodes.

## Configuration Boundaries

- Profiles are single-tool only: `profileId`, `toolRef`, optional `timeoutMs`, optional `maxOutputBytes`.
- Tools are minimal shell adapters: `toolRef`, `runner`, `command`, `argsTemplate`, `stdinMode`.
- The law catalog currently resolves only `law.global` and the constraints `forbiddenToolRefs`, `maxTransitions`, `allowNoopWithoutExecutionBinding`.
- `talentBinding` is preserved as metadata-only sidecar in the parsed system definition. It is not part of runtime execution.

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
- `specs/mermaid-dsl-v0.1.md`
# ogsystem
