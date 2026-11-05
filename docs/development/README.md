# OGS Development Documentation

This directory contains current engineering rules, architecture decisions, contracts, the single
unified plan and backlog, and dated verification records. Product usage belongs in `../usage/`.
Current behavior is defined by source code, tests, active manuals, and [Decisions](DECISIONS.md).

## Unified Plan & Backlog

- [Unified plan and backlog](todo-backlog.md): single source of truth for workspace planning, P1/P2 low-cost high-reward improvements, completed baseline summary, and explicit non-goals.

## Architecture Decisions & Engineering Contracts

- [Decisions](DECISIONS.md): accepted architecture decisions and current system invariants.
- [Product boundary and evolution](ogs-product-boundary-and-evolution.md): rules for keeping the OGS core small while adding standards and governance extensions.
- [Shared resource architecture](shared-resource-architecture.md): shared Platform resource ownership and adapter boundaries.
- [Native CLI integration contract](cli-integration-plan.md): current Pi, Qwen Code, Kimi Code, Codex, OpenCode, and Ollama adapter boundary plus desktop host status.
- [Model availability probe API](model-availability-probe-api.md): Team Site discovery and single-model probe contract for frontend integration.
- [Framework comparison](framework-comparison.md): capability-boundary comparison with LangGraph, DeerFlow, and DeepSeek Harness.
- [Business event protocol](business-event-protocol-v1.md): target fixed-event design, explicitly not the current runtime contract.
- [Role reasoning effort adaptation](reasoning-effort-adaptation-plan.md): long-term reasoning/thinking capability contract, adapter mapping, and acceptance method.
- [Compiler semantics v1](compiler-semantics-v1.md): Mermaid/Semantic IR compilation rules, diagnostics, and lowering invariants.
- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions, shared contracts, build output, and test ownership.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context, boundaries, and generated source.
- [Release compatibility policy](release-compatibility-policy.md): artifact schema compatibility, CLI exit codes, and upgrade guarantees.
- [Bilingual extended state-machine reference](extended-state-machine-and-dag-bilingual.md): mathematical, socio-technical, DAG, and AI execution model.
- [Documentation audit](documentation-audit-2026-11-05.md): classification, alignment findings, and open release gaps.

## Verification, UAT & Release Records

- [Release UAT checklist](release-uat-checklist.md): manual and browser release verification gates.
- [Studio and Projects test/UAT report](ogs-studio-project-run-isolation-validation-report.md): dated verification evidence for Studio/Projects isolation and lifecycle checks.
- [Design release validation template](design-release-validation-template.md): repeatable evidence template for design and release validation runs.
- [Release 1.0.0 notes](release-notes-1.0.0.md) & [Release 1.0.0 acceptance](release-acceptance-1.0.0.md): baseline release records.
- [Runtime replay benchmark](benchmarks/runtime-replay.md): baseline replay throughput and latency measurements.

## Archive

- [Archived development plans](archive/README.md): completed or superseded proposals retained for history.
