# OGSystem Documentation Index

This is the active documentation entry point. Runtime behavior, source code, and tests define the current product contract.

## Contract Status

The repository contains a direct replacement from the historical v1 contract to the active v2 contract:

| Contract set | Status | Authoritative scope | Examples |
| --- | --- | --- | --- |
| Contract Set v2 | **Current** | Role Contract, Business Graph/Flow, Harness, Runtime, Evidence, Studio, CLI, and release acceptance | `role-execution-architecture.md`, `v2-validation-and-acceptance.md` |
| Contract Set v1 | **Historical** | Implementation background and explicit rejection fixtures; never imported or read by v2 Runtime | versioned v1 manuals and `archive/` |

The v2 Runtime requires `ogsContractVersion: 2` on persisted contract roots and rejects v1 roots,
fields, schemas, and package data. There is no compatibility reader, migration utility, or
dual-write path. Source code and tests define implemented behavior; the v2 architecture defines
model boundaries and the v2 validation document defines release evidence.

The governance, contract, Runtime, Adapter, product-surface, evidence/recovery, direct-replacement,
and documentation prerequisites are defined in [v2 Cutover Gate](development/role-execution-architecture.md#v2-cutover-gate).

The four v2 product layers (Business, Technical Binding, Execution, Evidence) are the product
ownership boundary. Adapter implementation details must project into those layers and cannot
create a parallel Role, Semantic IR, or Harness model.

## Usage

- [v2 architecture and governance](development/role-execution-architecture.md)
- [v2 release validation and acceptance](development/v2-validation-and-acceptance.md)
- [v2 Gate C real workflow evidence](development/evidence/v2-gate-c-real-workflow-success-2026-11-16.md)
- [Constitution, design principles, and rules](development/ogsystem-constitution-v2.md)
- [Product introduction and core concepts](usage/usage-manual.md)
- [Team Site guide](../apps/team-site/README.md)
- [Usage manual](usage/usage-manual.md)
- [Start/End and terminal aggregation](usage/multi-entry-and-terminal-output.md)
- [Ebook](usage/ogsystem-ebook.md)

## Development

### Historical v1 Contract

- [Archived Constitution and rules](development/archive/v1/ogsystem-constitution-v1.md): historical implementation reference.
- [Archived v1 plan and backlog](development/archive/v1/todo-backlog.md)
- [Archived v1 product boundary and evolution](development/archive/v1/ogs-product-boundary-and-evolution.md)
- [Archived v1 shared resource architecture](development/archive/v1/shared-resource-architecture.md)
- [Archived v1 Native CLI integration contract](development/archive/v1/cli-integration-plan.md)
- [Archived v1 model availability probe API](development/archive/v1/model-availability-probe-api.md)
- [Archived v1 compiler semantics](development/archive/v1/compiler-semantics-v1.md)
- [Runtime and NL2MMD file sets](development/file-sets.md)
- [Source commenting style](development/commenting-style.md)
- [Archived v1 release compatibility policy](development/archive/v1/release-compatibility-policy.md)
- [Release UAT checklist](development/release-uat-checklist.md)
- [Historical v1 validation record (2026-11-10)](development/current-version-validation-2026-11-10.md)
- [Archived v1 file artifacts and code execution architecture](development/archive/v1/text-artifact-business-delivery-architecture.md)
- [Design release validation template](development/design-release-validation-template.md)

### Active Contract Set v2

- [Role execution architecture](development/role-execution-architecture.md): sole v2 architecture and direct replacement standard.
- [v2 validation and acceptance](development/v2-validation-and-acceptance.md): sole v2 release and production acceptance standard.
- [Backend native tools standardization](development/backend-native-tools-standardization.md): Adapter/Backend capability mapping reference only.

### Reference / Research

- [Extended state machine and social collaboration (bilingual)](development/extended-state-machine-and-dag-bilingual.md)
- [Framework comparison](development/framework-comparison.md)
- [Archived AI agent standards coverage assessment (2026)](development/archive/v1/ai-agent-standards-coverage-2026.md)
- [Archived role reasoning effort adaptation](development/archive/v1/reasoning-effort-adaptation-plan.md): v1 extension reference; not a v2 core contract.

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
4. Update v2 architecture, validation, decisions, tests, and UAT evidence together when orchestration or recovery contracts change.
5. Keep v1 historical material out of active v2 authoring and execution workflows.

## Suggested Reading Order

1. [v2 architecture and governance](development/role-execution-architecture.md)
2. [v2 validation and acceptance](development/v2-validation-and-acceptance.md)
3. [v2 Constitution](development/ogsystem-constitution-v2.md)
4. [v2 usage manual](usage/usage-manual.md)
5. [Start/End and terminal aggregation](usage/multi-entry-and-terminal-output.md)
6. [v2 validation and acceptance](development/v2-validation-and-acceptance.md)
7. [Decisions](development/DECISIONS.md)
