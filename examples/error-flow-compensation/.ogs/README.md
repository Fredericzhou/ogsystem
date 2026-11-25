# .ogs control plane

These files are the local runtime control plane for the project.
Keep JSON files as valid JSON with no comments or extra fields unless the schema already allows them.
Use this README for operator notes and examples instead of adding inline comments to runtime-consumed files.

## File guide

- `runtime.json`: Main runtime config. Safe place to change workspace and execution defaults.
- `execution-bindings.json`: v2 Harness Template references and frozen technical intent.
- `model-catalog.json`: Generated local CLI discovery from `ogs models discover` or `ogs models sync`.
- Backend credentials stay in each CLI's own user-level configuration; OGS does not import or manage them.
- `laws.json`: Project laws and transition constraints used by the runtime.
- `user-profile.json`: Default user preference profile injected into runs.
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
  "tools": {
    "environmentPolicy": "inherit",
    "envAllowlist": []
  },
  "workspace": {
    "rolesDir": "roles",
    "privateDirName": "private",
    "workspaceIsolation": "role"
  }
}
```

Common edits:
- Change `runsDir` if run artifacts should live outside `.ogs/runs`.
- `tools.environmentPolicy` defaults to `inherit`. Set it to `minimal` for production; add only reviewed variable names to `tools.envAllowlist`.
- Minimal environment mode limits inherited credentials, but it is not a filesystem sandbox. Review tool commands and workspace permissions separately.
- Change `workspace.workspaceIsolation` when the execution sandbox policy changes.
- Keep `roleRepo` pointed at the project role repository root.

## Example: execution-bindings.json

```json
{
  "ogsContractVersion": 2,
  "schemaVersion": 1,
  "defaults": { "harnessTemplate": "harness.default" },
  "harnessTemplates": {
    "harness.default": {
      "ogsContractVersion": 2,
      "schemaVersion": 1,
      "kind": "harness",
      "templateId": "harness.default",
      "backend": "<discovered-backend>",
      "model": "<discovered-model>",
      "allowedTools": ["apply_patch", "exec_command"],
      "environment": { "filesystem": "staged", "process": "allow", "network": "deny" }
    }
  },
  "roles": { "proposal-author": { "kind": "harness", "harnessTemplate": "harness.default" } }
}
```

Use Capability Preview or `ogs models capabilities --refresh` to verify native tools before changing a Harness Template. Configure Role-to-Template bindings in Studio or this file.

## Example: laws.json

```json
{
  "laws": [
    {
      "lawId": "law.project.base",
      "constraints": {
        "forbiddenToolRefs": [],
        "maxTransitions": 8,
        "allowNoopWithoutExecutionBinding": false
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
