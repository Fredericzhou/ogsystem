# .ogs control plane

These files are the local runtime control plane for the project.
Keep JSON files as valid JSON with no comments or extra fields unless the schema already allows them.
Use this README for operator notes and examples instead of adding inline comments to runtime-consumed files.

## File guide

- `runtime.json`: Main runtime config. Safe place to change workspace and execution defaults.
- `model-selection.json`: Default model routing and per-system overrides.
- `model-catalog.json`: Generated catalog from `ogs project sync-models`. Usually do not edit manually.
- `providers/opencode.json`: Reference template for wiring OpenCode provider config on the local machine.
- `laws.json`: Project laws and transition constraints used by the runtime.
- `user-profile.json`: Default user preference profile injected into runs.
- `project.json`: Project identity and creation metadata. Usually generated once and then left alone.
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
  "configVersion": "1",
  "defaults": {
    "model": "opencode/gpt-5.4",
    "variant": "medium",
    "timeoutMs": 120000,
    "maxOutputBytes": 65536
  },
  "systems": {
    "template.minimal": {
      "defaults": {
        "model": "opencode/gpt-5.4",
        "variant": "high"
      }
    }
  }
}
```

Use `ogs project sync-models` to refresh `model-catalog.json` first, then pick refs from that catalog.
For this example, `model-selection.json` and `system.mmd` default to `gkgk/gpt-5.4`; keep them aligned if you switch to another locally available model.

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

- `providers/opencode.json` is a local wiring reference. Copy the recommended provider entry into the real OpenCode config and replace placeholder secrets locally.
- `project.json`, `model-catalog.json`, and `runs-index.json` are mostly generated artifacts. Manual edits may be overwritten by lifecycle commands.
