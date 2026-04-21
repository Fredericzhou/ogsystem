# OGSystem Legacy Model Repository

`og-models/` is no longer the active user-facing model configuration path.

Current runtime and scaffolding use:

- `.ogs/model-selection.json` for defaults and overrides
- `.ogs/model-catalog.json` for local `opencode models --verbose` snapshots
- direct `model.bind.<roleId>=provider/model` refs when a system needs explicit per-role binding

This directory remains only as a legacy/internal compatibility fixture for older low-level tests and archived design history. New projects should not read from or write to `og-models/`.
