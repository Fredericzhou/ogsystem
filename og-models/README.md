# OGSystem Legacy Model Repository

`og-models/` is no longer the active user-facing model configuration path.

Current runtime and scaffolding use:

- `.ogs/execution-bindings.json` for Harness Template backend/model, tools, and environment binding
- `.ogs/model-catalog.json` for local CLI model discovery snapshots
- the Mermaid graph for business topology only; it never carries Backend/model binding

This directory remains only as a legacy/internal compatibility fixture for older low-level tests and archived design history. New projects should not read from or write to `og-models/`.
