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
- prefer semantic alias names for `modelId` (for example `general-fast`, `general-balanced`, `general-steady`) instead of provider/version names
- upgrade provider models by editing `models/<modelId>/model.json` mapping, so `system.mmd` remains stable across model refreshes
