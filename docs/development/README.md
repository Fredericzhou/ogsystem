# OGS Development Documentation

This directory contains the constitution, current engineering rules, architecture decisions, contracts, the single
unified plan and backlog, and dated verification records. Product usage belongs in `../usage/`.
Current behavior is defined by source code, tests, active manuals, and [Decisions](DECISIONS.md).

This branch uses Contract Set v2 as its active architecture and release target. The [Role Execution
Architecture](role-execution-architecture.md) is the sole v2 architecture standard, and [v2 validation
and acceptance](v2-validation-and-acceptance.md) is the sole release acceptance standard. The Backend
tools document is an Adapter/Backend implementation reference only. v1 documents remain historical
implementation references and rejection fixtures; v2 does not migrate, dual-write, or compatibility-read
v1 data.

## Unified Plan & Backlog

- [Constitution, design principles, and rules](ogsystem-constitution-v2.md): compact source for v2 governance boundaries and the active documentation map.
- [Archived v1 plan and backlog](archive/v1/todo-backlog.md): retained for historical context; it does not define v2 work.

## Historical v1 Architecture Decisions & Engineering Contracts

- [Decisions](DECISIONS.md): v2 governance decisions and current system invariants.
- [Archived v1 product boundary and evolution](archive/v1/ogs-product-boundary-and-evolution.md)
- [Archived v1 shared resource architecture](archive/v1/shared-resource-architecture.md)
- [Archived v1 Native CLI integration contract](archive/v1/cli-integration-plan.md)
- [Archived v1 model availability probe API](archive/v1/model-availability-probe-api.md)
- [Archived v1 business event protocol](archive/v1/business-event-protocol-v1.md)
- [Archived v1 decision criteria and event branching](archive/v1/minimal-decision-criteria-and-event-branching.md)
- [Archived v1 compiler semantics](archive/v1/compiler-semantics-v1.md)
- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions, shared contracts, build output, and test ownership.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context, boundaries, and generated source.
- [Archived v1 release compatibility policy](archive/v1/release-compatibility-policy.md): historical artifact and CLI boundary.

## Active Contract Set v2

- [Role execution architecture](role-execution-architecture.md): sole architecture and direct replacement standard.
- [v2 validation and acceptance](v2-validation-and-acceptance.md): semantic, technical, recovery, and production workflow acceptance baseline.
- [Backend native tools standardization](backend-native-tools-standardization.md): capability discovery and Adapter mapping reference only.

## Reference / Research

- [Bilingual extended state-machine reference](extended-state-machine-and-dag-bilingual.md): mathematical, socio-technical, DAG, and AI execution model.
- [Framework comparison](framework-comparison.md): capability-boundary comparison; not an OGS contract.
- [Archived AI agent standards coverage assessment (2026)](archive/v1/ai-agent-standards-coverage-2026.md): dated non-normative coverage assessment.
- [Archived role reasoning effort adaptation](archive/v1/reasoning-effort-adaptation-plan.md): v1 extension reference; not a v2 core contract.

## Verification, UAT & Release Records

- [Historical v1 validation record (2026-11-10)](current-version-validation-2026-11-10.md): retained for archaeology; it does not close a v2 gate.
- [v2 Gate C real workflow success evidence](evidence/v2-gate-c-real-workflow-success-2026-11-16.md): final Codex/gpt-6-luna software and documentation Runs, sealed Artifacts, reviewer decisions, and promotion receipts.
- [v2 Gate C failure attempts](evidence/v2-gate-c-real-workflow-attempts-2026-11-16.md): retained diagnostic evidence; it does not override the successful final Runs.
- [Release UAT checklist](release-uat-checklist.md): manual and browser release verification gates.
- [Design release validation template](design-release-validation-template.md): repeatable evidence template for design and release validation runs.
- [Runtime replay benchmark](benchmarks/runtime-replay.md): baseline replay throughput and latency measurements.

## Archive

- [Archived development plans](archive/README.md): completed or superseded proposals retained for history.
