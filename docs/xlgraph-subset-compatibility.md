# OGSystem x xlgraph Subset Compatibility

Date: 2026-04-09  
Status: stable-minimal

## 1. Positioning

`OGSystem` is a minimal console-oriented implementation.

Compatibility target:

- Keep semantic names compatible with `xlgraph`
- Keep runtime behavior as a strict subset of `xlgraph` public semantics
- Keep implementation intentionally smaller (minimal runtime + object surface)

## 2. Compatibility Scope

Semantic names kept:

- `Law`
- `System`
- `SystemState`
- `AuditTrail`
- `Stage`

Boundary/I/O subset mapping:

- System entry/exit are represented by boundary tokens `input` / `output`
- This project does not implement full `SystemBoundary` object contracts

## 3. Mapping to xlgraph

1. `Law`: same governing intent, minimal constraints implemented.
2. `System`: same top-level executable unit with reduced structure.
3. `SystemState`: runtime snapshot from adapter output.
4. `AuditTrail`: append-only transition evidence.
5. `Stage`: runtime projection from audit trail.
6. `System I/O`: represented by Mermaid boundary edges:
   - `input -->|EVENT| Role`
   - `Role -->|EVENT| output`

## 4. DSL Compatibility Rules

1. `input/output` are boundary tokens, not roles.
2. `input/output/start/end/done` are reserved and cannot be role ids.
3. `start/end/done` are not boundary aliases in this project.
4. Entry role can be provided by:
   - `%% entry.role=<roleId>`
   - or inferred from `input --> ...`
5. Metadata keys outside allow-list fail validation.

## 5. Intentional Differences (Implementation, not Semantics)

1. Console-first runtime adapter, not full platform runtime.
2. Edge-level boundary semantics only.
3. Single global law binding (`law.global`) in runtime v1.
4. Minimal `Stage` projection fields only.
5. No claim to full execution feature parity.

## 6. Non-goals

1. Do not introduce a parallel naming system.
2. Do not expand object families beyond minimal executable scope.
3. Do not evolve this project into full platform scope.
