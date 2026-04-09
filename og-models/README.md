# OGSystem Model Repository

Each model package lives under `og-models/models/<modelId>/model.json`.

Model packages define execution configuration, not role semantics.

Rules:

- model packages do not include role persona/prompt logic
- model packages do not include system routing
- model packages are bound from `system.mmd` via `model.bind.<roleId>=<modelId>`
- legacy runtime may still use `exec.bind.*` during migration
