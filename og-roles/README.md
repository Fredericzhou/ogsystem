# OGSystem Role Repository

Each executable Mermaid role resolves directly to `og-roles/roles/<roleId>/`.

Full runtime usage:

- `docs/usage-manual.md`

Required files:

- `role.json`
- `prompt.md`
- `output.schema.json`

Optional files:

- `persona.md`
- `work.md`
- `input.schema.json`

Built-in templates:

- `error-handler-base` (runtime failure compensation skeleton)
- `human-approve-gate` (event vocabulary: `APPROVED | REJECTED | TIMEOUT`)
- `human-signal-wait` (event vocabulary: `SIGNAL_OK | SIGNAL_FAIL | EXPIRED`)

Rules:

- `role.json.roleId` must equal the directory name.
- Role packages do not define flow, joins, loops, or execution bindings.
- Role packages do not bind tools or models.
- `system.mmd` owns orchestration and role-to-model binding (`model.bind.*`; `exec.bind.*` in legacy runtime).
- runtime injects `user_profile` into prompt variables; role packages decide how to apply it.
- `talent` and `preferredModelTags` in `role.json` are soft hints only. They are not hard bindings.
