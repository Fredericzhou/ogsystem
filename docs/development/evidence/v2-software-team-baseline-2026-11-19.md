# V2 Software Team Sandbox Baseline

Status: engineering baseline evidence; this record does not close the formal Project/UAT or
workflow-operator/product-owner sign-off rows.

Date: 2026-11-19

## Run record

- TeamVersion: `new-team-6258e432`
- Team core digest: `d432ac9ba4f581739d0d1c8e4937c3cd58f5c72b9948b5e3edc78d72b68b85df`
- Scenario: `classic-software-team`, revision `1`
- Scenario digest: `e5ae31030548bcb5ed7b094b879b10c281f564bec64eafb1332b551166b381f0`
- Batch: `ca41f7e8-2a01-479b-a3c8-b736549fdc9b`
- Simulation: `6a004afd-e35d-40fb-a1ec-f72395c9c7f1`
- Runtime Run: `simulation-854b51f8-6d0b-4af8-a31f-d89ccf3a0b25`
- Mode: `sandbox`
- Backend/model: Codex / `gpt-6-luna`
- Result: `completed`; five expected Roles completed
- Release readiness: `ready: true`, proof `baseline-sandbox`

## Workspace and Release facts

- Workspace: `workspace-0897bae108b5e13c8e4c22a8`
- Base commit: `a3e1ae94e50ec0b85d20b5005ef6efdafa3b5230`
- Final Release: `release-simulation-854b51f8-6d0b-4af8-a31f-d89ccf3a0b25`
- Release commit: `5a9773ae030fd2ef80621869d75f82a5a40d6256`
- Materialization manifest digest: `sha256:d97e35534157d54a0a8471b3dea2c7b1f99d248a670bf2e93fb9bc1d9fbc0f99`
- Output digest: `sha256:689d62b5b10777132150863a18694f329343c72ffb0f4ea74411b769e9e68b02`
- Download reference: `simulation://new-team-6258e432/simulation-854b51f8-6d0b-4af8-a31f-d89ccf3a0b25/release`

The run evidence records Role commits, the merge event, Checkpoints, the Git + LFS Workspace,
Release materialization, and the readiness result. The batch initially remained running while the
host was out of disk space; after old generated runtime data was pruned, the existing batch completed
without changing the TeamVersion or scenario digest. No compatibility read, migration, dual write,
or alternate Workspace backend was used.

This record is an engineering trace. It does not provide the required browser captures, refresh
comparison, formal Project/Task/Run ledger, binary/media LFS Project delivery, accessibility review,
Windows lifecycle result, or human sign-off.
