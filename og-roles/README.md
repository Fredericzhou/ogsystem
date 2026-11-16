# OGSystem Role Repository

Each executable Mermaid role resolves directly to `og-roles/roles/<roleId>/`.

Full runtime usage:

- `docs/usage-manual.md`

Required files:

- `role.json`

`role.json` includes a mandatory Role Contract. A role is an abstract responsibility, not a person, model, vendor, or execution instance. Keep every contract array explicit, sorted, and duplicate-free. `responsibility.contributes` must reference a top-level System state field or a top-level field in a declared event payload schema. `purpose` must remain abstract and must not name concrete people, providers, models, or runtime instances.
- `agent.md`
- `prompt.md`
- `output.schema.json`

Optional files:

- `source.json`

Built-in templates:

- `error-handler-base` (runtime failure compensation skeleton)

Rules:

- `role.json.roleId` must equal the directory name.
- Role packages do not define flow, joins, loops, or execution bindings.
- Role packages do not bind tools or models.
- `system.mmd` owns the business graph and Role-to-Role handoffs. Backend, model, and tool
  choices are configured through v2 Harness Templates in `.ogs/execution-bindings.json`;
  `model.bind.*` and `exec.bind.*` are rejected legacy inputs.
- runtime injects `allowed_events`, `user_preferences`, `task`, and `input` into prompt variables; role packages decide how to apply them.
- runtime only executes canonical role packages from `roles/<roleId>/`; `source.json` and `tools/agent-source/sources.lock.json` are traceability metadata, not runtime contract.
- upstream source checkouts under `agent-sources/` are development-only and must be normalized through an importer before they become executable roles.
- `talent` and `preferredModelTags` in `role.json` are soft hints only. They are not hard bindings.
