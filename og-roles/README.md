# OGSystem Role Repository

Each executable Mermaid role resolves directly to `og-roles/roles/<roleId>/`.

Full runtime usage:

- `docs/usage-manual.md`

Required files:

- `role.json`
- `agent.md`
- `prompt.md`
- `output.schema.json`

Optional files:

- `source.json`

Built-in templates:

- `error-handler-base` (runtime failure compensation skeleton)
- `human-approve-gate` (event vocabulary: `APPROVED | REJECTED | TIMEOUT`)
- `human-signal-wait` (event vocabulary: `SIGNAL_OK | SIGNAL_FAIL | EXPIRED`)

Rules:

- `role.json.roleId` must equal the directory name.
- Role packages do not define flow, joins, loops, or execution bindings.
- Role packages do not bind tools or models.
- `system.mmd` owns orchestration and role-to-model binding (`model.bind.*`; `exec.bind.*` in legacy runtime).
- runtime injects `allowed_events`, `user_preferences`, `task`, and `input` into prompt variables; role packages decide how to apply them.
- runtime only executes canonical role packages from `roles/<roleId>/`; `source.json` and `sources.lock.json` are traceability metadata, not runtime contract.
- upstream source checkouts under `agent-sources/` are development-only and must be normalized through an importer before they become executable roles.
- `talent` and `preferredModelTags` in `role.json` are soft hints only. They are not hard bindings.
