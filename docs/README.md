# OGSystem Documentation Index

This is the active documentation entry point. Runtime behavior, source code, and tests define the current product contract.

## Contract Status

The repository currently contains two explicitly separated contract sets:

| Contract set | Status | Authoritative scope | Examples |
| --- | --- | --- | --- |
| Contract Set v1 | **Current** | Released runtime, Studio, CLI, Semantic IR, and usage contracts | `ogsystem-constitution-v1.md`, `usage-manual.md`, `ogsystem-orchestration-semantics-v1.md`, `ogsystem-semantics-manual.md` |
| Contract Set v2 | **Target proposal** | Planned breaking architecture refactor; not read by the current Runtime | `role-execution-architecture.md`, the v2 section of `backend-native-tools-standardization.md` |

Until a separate governance decision approves the v2 cutover, v2 fields must not be added to
current runtime inputs or mixed into v1 examples. A v2 implementation must update schemas, code,
tests, Studio, CLI, and active usage manuals together. The v2 proposal does not provide a runtime
compatibility layer, data migration, or dual-write period after cutover.

The v2 cutover is a release gate, not an active work list. Its governance, contract, Runtime,
Adapter, product-surface, evidence/recovery, direct-replacement, and documentation prerequisites
are defined in [v2 Cutover Gate](development/role-execution-architecture.md#v2-cutover-gate).

The four v2 product layers (Business, Technical Binding, Execution, Evidence) are a product
ownership view. The current five-stage implementation view (Authoring, Compilation, Runtime,
Evidence, Product Projections) remains valid for v1 and is not a competing product architecture.

## Usage

- [Constitution, design principles, and rules](development/ogsystem-constitution-v1.md)
- [Product introduction](usage/product-introduction.md)
- [Core concepts](usage/ogsystem-core-concepts.md)
- [Team Site guide](../apps/team-site/README.md)
- [Usage manual](usage/usage-manual.md)
- [Professional workbench](usage/visualizer-console.md)
- [Orchestration semantics](usage/ogsystem-orchestration-semantics-v1.md)
- [Handoff semantics supplement](usage/ogsystem-handoff-semantics-v1.md)
- [Semantics manual](usage/ogsystem-semantics-manual.md)
- [Context map guide](usage/context-map-projection-guide.md)
- [Data projection spec](usage/ogsystem-data-projection-spec.md)
- [NL2MMD structure templates](usage/nl2mmd-structure-templates.md)
- [Ebook](usage/ogsystem-ebook.md)

## Development

### Current v1 Contract

- [Constitution, design principles, and rules](development/ogsystem-constitution-v1.md): the compact governance entry point and document map.
- [Unified plan and backlog](development/todo-backlog.md)
- [Decisions](development/DECISIONS.md)
- [Product boundary and evolution](development/ogs-product-boundary-and-evolution.md)
- [Shared resource architecture](development/shared-resource-architecture.md)
- [Native CLI integration contract](development/cli-integration-plan.md)
- [Model availability probe API](development/model-availability-probe-api.md)
- [Compiler semantics](development/compiler-semantics-v1.md)
- [Runtime and NL2MMD file sets](development/file-sets.md)
- [Source commenting style](development/commenting-style.md)
- [Release compatibility policy](development/release-compatibility-policy.md)
- [Release UAT checklist](development/release-uat-checklist.md)
- [Current version validation (2026-11-10)](development/current-version-validation-2026-11-10.md)
- [File artifacts and code execution architecture](development/text-artifact-business-delivery-architecture.md)
- [Design release validation template](development/design-release-validation-template.md)

### Contract Set v2 Target

- [Role execution architecture](development/role-execution-architecture.md): target proposal; not read by the current Runtime.
- [Backend native tools standardization](development/backend-native-tools-standardization.md): v2 supporting material and adapter boundary; not a current v1 input contract.

### Reference / Research

- [Extended state machine and social collaboration (bilingual)](development/extended-state-machine-and-dag-bilingual.md)
- [Framework comparison](development/framework-comparison.md)
- [AI agent standards coverage assessment (2026)](development/ai-agent-standards-coverage-2026.md)
- [Role reasoning effort adaptation](development/reasoning-effort-adaptation-plan.md): current v1 extension reference; not a v2 core contract.

## Paper and Publications

- [OGSystem Engineering Paper and Literature Hub (2026)](paper/README.md): Complete Chinese/English manuscripts, traceable references, and independent researcher submission guide.
- [Chinese Paper: 面向有界多智能体协作的持久化扩展状态机运行时与工程实践](paper/ogsystem-paper-zh.md)
- [English Paper: A Persistent Extended Finite State Machine Runtime for Bounded Multi-Agent Collaboration](paper/ogsystem-paper-en.md)
- [Traceable Literature Baseline (2015-2026)](paper/traceable-references.md): Official URLs, DOIs, standards, and repositories.
- [Runtime replay benchmark](development/benchmarks/runtime-replay.md)

## Archive

- [Archived development plans](development/archive/README.md)

## Maintenance

1. Update the active manuals and contracts when behavior changes.
2. Keep plans and checklists only while they guide current work; remove superseded material.
3. Update the usage manual when CLI, installation, run artifacts, or security boundaries change.
4. Keep [Semantic IR v1 Handoff supplement](usage/ogsystem-handoff-semantics-v1.md) aligned with runtime route, Join, review, Artifact, and resume behavior.
5. Update semantic manuals, decisions, tests, and UAT cases when orchestration or recovery contracts change.
6. Mark target proposals and current contracts explicitly; do not describe a v2 design as current behavior.

## Suggested Reading Order

1. [Constitution, design principles, and rules](development/ogsystem-constitution-v1.md)
2. [Product introduction](usage/product-introduction.md)
3. [Core concepts](usage/ogsystem-core-concepts.md)
4. [Usage manual](usage/usage-manual.md)
5. [Orchestration semantics](usage/ogsystem-orchestration-semantics-v1.md)
6. [Handoff semantics supplement](usage/ogsystem-handoff-semantics-v1.md)
7. [Compiler semantics](development/compiler-semantics-v1.md)
8. [Decisions](development/DECISIONS.md)
