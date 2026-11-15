# OGS Development Documentation

This directory contains the constitution, current engineering rules, architecture decisions, contracts, the single
unified plan and backlog, and dated verification records. Product usage belongs in `../usage/`.
Current behavior is defined by source code, tests, active manuals, and [Decisions](DECISIONS.md).

The current release is Contract Set v1. The [Role Execution Architecture](role-execution-architecture.md)
and the v2 sections of the Backend tools document are target proposals only; they do not change the
current Runtime input contract until an explicit cutover updates code, schemas, tests, Studio, CLI,
and active manuals together.

## Unified Plan & Backlog

- [Constitution, design principles, and rules](ogsystem-constitution-v1.md): compact source for governance boundaries and the active documentation map.
- [Unified plan and backlog](todo-backlog.md): single source of truth for workspace planning, P1/P2 low-cost high-reward improvements, completed baseline summary, and explicit non-goals.

## Current v1 Architecture Decisions & Engineering Contracts

- [Decisions](DECISIONS.md): accepted architecture decisions and current system invariants.
- [Product boundary and evolution](ogs-product-boundary-and-evolution.md): rules for keeping the OGS core small while adding standards and governance extensions.
- [Shared resource architecture](shared-resource-architecture.md): shared Platform resource ownership and adapter boundaries.
- [Native CLI integration contract](cli-integration-plan.md): current Pi, Qwen Code, Kimi Code, Codex, OpenCode, and Ollama adapter boundary plus desktop host status.
- [Model availability probe API](model-availability-probe-api.md): Team Site discovery and single-model probe contract for frontend integration.
- [Business event protocol](business-event-protocol-v1.md): active fixed-event contract and shared runtime registry.
- [Minimal decision criteria and event branching](minimal-decision-criteria-and-event-branching.md): acceptance criteria, structured decision evidence, and low-code multi-entry event configuration.
- [Compiler semantics v1](compiler-semantics-v1.md): Mermaid/Semantic IR compilation rules, diagnostics, and lowering invariants.
- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions, shared contracts, build output, and test ownership.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context, boundaries, and generated source.
- [Release compatibility policy](release-compatibility-policy.md): artifact schema compatibility, CLI exit codes, and upgrade guarantees.

## Contract Set v2 Target

- [Role execution architecture](role-execution-architecture.md): target proposal; not read by the current Runtime.
- [Backend native tools standardization](backend-native-tools-standardization.md): v2 supporting material; not a current v1 input contract.
- [v2 validation and acceptance](v2-validation-and-acceptance.md): target semantic, technical, cross-Backend, and production-workflow acceptance baseline.

## Reference / Research

- [Bilingual extended state-machine reference](extended-state-machine-and-dag-bilingual.md): mathematical, socio-technical, DAG, and AI execution model.
- [Framework comparison](framework-comparison.md): capability-boundary comparison; not an OGS contract.
- [AI agent standards coverage assessment (2026)](ai-agent-standards-coverage-2026.md): dated non-normative coverage assessment.
- [Role reasoning effort adaptation](reasoning-effort-adaptation-plan.md): current v1 extension reference and future v2 mapping input; not a v2 core contract.

## Verification, UAT & Release Records

- [Current version validation (2026-11-10)](current-version-validation-2026-11-10.md): latest semantic, provider, Team Site, and visual verification record.
- [Release UAT checklist](release-uat-checklist.md): manual and browser release verification gates.
- [Design release validation template](design-release-validation-template.md): repeatable evidence template for design and release validation runs.
- [Runtime replay benchmark](benchmarks/runtime-replay.md): baseline replay throughput and latency measurements.

## Archive

- [Archived development plans](archive/README.md): completed or superseded proposals retained for history.
