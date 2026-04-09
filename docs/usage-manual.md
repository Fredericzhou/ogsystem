# OGSystem Usage Manual

## 1. Runtime Status

This repository currently has two layers of documentation:

- target architecture: `model.bind + model repo + user profile`
- legacy-compatible runtime path: `exec.bind + profiles/tools`

Use this rule:

- preferred runtime path: use `model.bind.<roleId>=<modelId>`
- legacy compatibility path: `exec.bind.<roleId>` still works when paired with `profiles/tools`

## 2. Semantic Layers

- `system.mmd`: role graph, events, law binding, role-to-model binding
- `role repo`: role semantics and I/O contracts
- `model repo`: executor and model runtime config
- `user profile`: delivery preference only

Hard boundary:

- role is semantic
- model is execution
- user profile is delivery preference
- system is orchestration

## 3. Recommended Directory Layout

```txt
OGSystem/
  .ogsystem/
    runtime.json
    user-profile.json
    laws.json

  og-roles/
    roles/
      <roleId>/
        role.json
        prompt.md
        output.schema.json
        persona.md
        work.md
        input.schema.json

  og-models/
    models/
      <modelId>/
        model.json

  examples/
    target-model-binding-system.mmd
    console-system.mmd
    console-profiles.json
    console-tools.json
    console-laws.json
```

## 4. system.mmd

Target example:

```mermaid
flowchart TD
%% system.id=demo.target.model.binding
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=debate-moderator
%% model.bind.debate-moderator=fast-gpt54
%% model.bind.debate-minimalist=claude-sonnet
%% model.bind.debate-judge=deep-o3

input -->|DEBATE_REQUEST| moderator[Role:debate-moderator]
moderator[Role:debate-moderator] -->|ROUND_READY| minimalist[Role:debate-minimalist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| judge[Role:debate-judge]
judge[Role:debate-judge] -->|DECISION_READY| output
```

Legacy-compatible execution example (current adapter):

```mermaid
flowchart TD
%% system.id=demo.console
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=demo-analyst
%% exec.bind.demo-analyst=exec.console.codex.v1

input -->|ENTER| analyst[Role:demo-analyst]
analyst[Role:demo-analyst] -->|ANALYSIS_DONE| output
```

## 5. Role Package Contract

Required:

- `role.json`
- `prompt.md`
- `output.schema.json`

Optional:

- `persona.md`
- `work.md`
- `input.schema.json`
- `talent` and `preferredModelTags` in `role.json` (soft hints only)

Role rules:

- `role.json.roleId` must equal directory name
- role packages do not define routing
- role packages do not hard-bind model ids

## 6. Model Package Contract

`og-models/models/<modelId>/model.json` defines execution configuration.

Example:

```json
{
  "modelId": "deep-o3",
  "executor": "opencode",
  "model": "o3",
  "args": {
    "reasoningEffort": "high"
  },
  "timeoutMs": 180000,
  "maxOutputBytes": 65536,
  "tags": ["reasoning", "long-context"]
}
```

Model rules:

- model packages do not include persona/prompt logic
- model packages do not include routing logic

## 7. User Profile Contract

`.ogsystem/user-profile.json` contains delivery preference.

Example:

```json
{
  "userProfileId": "default.zh.concise",
  "language": "zh-CN",
  "style": "concise",
  "riskPreference": "medium",
  "outputLength": "short",
  "domainBackground": ["software-architecture"]
}
```

User profile rules:

- must not directly select model id
- should only affect language/style/detail/risk framing

## 8. Runtime Config

`.ogsystem/runtime.json` keeps runtime-level defaults:

- executor
- repo roots
- runs directory
- shared workspace policy

Example:

```json
{
  "executor": "opencode",
  "roleRepo": "./og-roles",
  "modelRepo": "./og-models",
  "runsDir": ".ogsystems",
  "sharedDir": "."
}
```

## 9. Run Directory Contract

When a run starts, `.ogsystems/<run-id>/` should persist:

- run-level files: `run.md`, `request.md`, `system.mmd`, `state.json`, `events.ndjson`
- audit files: `audit/summary.md`, `audit/transitions.md`
- per-role files: `role.md`, `inbox.md`, `prompt.md`, `result.json`, `outbox.md`, `audit.md`, `private/`
- role workspace link: `shared -> <cwd>` when shared linking is enabled

Markdown files are human projections.
`state.json` and `events.ndjson` are authoritative machine state.
`inbox.md` is a projection of normalized runtime input, not a free-form summary.
`.ogsystems/` is generated runtime state and should be ignored by git.

## 10. Commands

Preferred runtime command:

```bash
npm run run:adapter -- \
  --system examples/target-model-binding-system.mmd \
  --prompt "讨论当前架构是否继续最小化" \
  --dry-run
```

This path auto-discovers:

- `.ogsystem/runtime.json`
- `.ogsystem/user-profile.json`
- `.ogsystem/laws.json`
- `og-models/`
- `og-roles/`

Legacy-compatible runtime command:

```bash
npm run run:adapter -- \
  --system examples/console-system.mmd \
  --profiles examples/console-profiles.json \
  --tools examples/console-tools.json \
  --laws examples/console-laws.json \
  --prompt "analyze this repository" \
  --dry-run
```

Validation command for generated Mermaid:

```bash
node skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs \
  --system examples/target-model-binding-system.mmd
```

Validation command for an actual generated run:

```bash
node skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs \
  --system examples/target-model-binding-system.mmd \
  --user-profile .ogsystem/user-profile.json \
  --laws .ogsystem/laws.json \
  --run-dir .ogsystems/<run-id>
```

## 11. Migration Notes

- new docs and templates should use `model.bind.*`
- during migration, `exec.bind.*` remains a compatibility path
- runtime precedence is:
  - `model.bind.<roleId>`
  - then `exec.bind.<roleId>`
