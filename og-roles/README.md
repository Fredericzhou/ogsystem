# OGSystem Role Repository

Each executable Mermaid role resolves directly to `og-roles/roles/<roleId>/`.

Required files:

- `role.json`
- `prompt.md`
- `output.schema.json`

Optional files:

- `persona.md`
- `work.md`
- `input.schema.json`

Rules:

- `role.json.roleId` must equal the directory name.
- Role packages do not define flow, joins, loops, or execution bindings.
- Role packages do not bind tools or models.
- `system.mmd` owns orchestration and `exec.bind.*`.
