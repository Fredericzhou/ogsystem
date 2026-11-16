# .ogs control plane

These files are the local runtime control plane for the project.
Keep JSON files as valid JSON with no comments or extra fields unless the schema already allows them.
Use this README for operator notes and examples instead of adding inline comments to runtime-consumed files.

## File guide

- `runtime.json`: Main runtime config. Safe place to change workspace and execution defaults.
- `model-selection.json`: Default and per-role CLI backend/model choices.
- `model-catalog.json`: Generated local CLI discovery from `ogs models discover` or `ogs models sync`.
- Backend credentials stay in each CLI's own user-level configuration; OGS does not import or manage them.
- `laws.json`: Project laws and transition constraints used by the runtime.
- `user-profile.json`: Default user preference profile injected into runs.
- `profiles.json`: Exec profiles that bind `exec.bind.*` roles to local tools.
- `tools.json`: Local tool registry consumed by `profiles.json`.
- `project.json`: Project identity and creation metadata. Usually generated once and then left alone.
- `project.json.target`: Optional external coding project bound to OpenCode; omit it to use this project directory.
- `runs-index.json`: Generated run index. Rebuilt by lifecycle commands.

## Example: runtime.json

```json
{
  "configVersion": "2",
  "executor": "opencode",
  "roleRepo": "og-roles",
  "runsDir": ".ogs/runs",
  "workspace": {
    "rolesDir": "roles",
    "privateDirName": "private",
    "workspaceIsolation": "role"
  }
}
```

Common edits:
- Change `runsDir` if run artifacts should live outside `.ogs/runs`.
- Change `workspace.workspaceIsolation` when the execution sandbox policy changes.
- Keep `roleRepo` pointed at the project role repository root.

## Example: model-selection.json

```json
{
  "configVersion": "2",
  "defaults": {
    "backend": "<opencode|codex>",
    "modelId": "<cli-model-id>",
    "variant": "<optional-variant>",
    "timeoutMs": 120000,
    "maxOutputBytes": 65536
  },
  "roles": { "proposal-author": { "backend": "codex", "modelId": "gpt-5.6-sol" } }
}
```

Run `ogs models sync` to discover installed CLI services and initialize this file. Configure each role's backend and modelId in Studio or here.

## Example: laws.json

```json
{
  "laws": [
    {
      "lawId": "law.project.base",
      "constraints": {
        "forbiddenToolRefs": [],
        "maxTransitions": 8,
        "allowNoopWithoutExecutionBinding": true
      }
    }
  ]
}
```

## Example: user-profile.json

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

## Reference-only files

- `project.json`, `model-catalog.json`, and `runs-index.json` are mostly generated artifacts. Manual edits may be overwritten by lifecycle commands.
