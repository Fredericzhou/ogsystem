# OGSystem Role Repository

This repository stores reusable role packages consumed by `OGSystem`. Each package provides:

- a `role.json` manifest validated by `schemas/role.schema.json`
- a `prompt.md` template rendered with runtime context
- an `output.schema.json` ensuring structured JSON outputs
- optional `persona.md` and `work.md` for human-readable guidance

To add a role:

1. Create `roles/<roleId>/role.json` with the required keys.
2. Supply `prompt.md` that references `{{task}}`, `{{allowed_events}}`, and other runtime tokens.
3. Define `output.schema.json` to match the JSON contract your role emits.
4. Update `registry.json` with the new role entry.

Role packages must never reference `toolRef`, `command`, or execution-time policies.
The system assigns those via `assembly.json` when building concrete graphs.
