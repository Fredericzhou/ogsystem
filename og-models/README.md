# OGSystem Model Repository

The model repo has two layers:

- `catalog/opencode-models.json`: snapshot of models currently available from local `opencode models`
- `models/<modelId>/model.json`: small set of reusable bindings used by systems

Model packages define execution configuration, not role semantics.

Rules:

- model packages do not include role persona/prompt logic
- model packages do not include system routing
- model packages are bound from `system.mmd` via `model.bind.<roleId>=<modelId>`
- legacy runtime may still use `exec.bind.*` during migration
- curated `modelId` aliases should point to models that exist in `catalog/opencode-models.json`
