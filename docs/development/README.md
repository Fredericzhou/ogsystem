# OGS Development Documentation

This directory contains the constitution, current engineering rules, architecture decisions, contracts, the single
unified plan and backlog, and dated verification records. Product usage belongs in `../usage/`.
Implemented behavior is reported by source code and tests. Normative behavior is defined by the
active decision, architecture, contract, design, and acceptance documents below.

This branch uses Contract Set v2 as its active architecture and release target; the release target is
not a claim that UAT approval has been signed. Normative conflicts
are resolved in this order: the Constitution and `DECISIONS.md` (governance layer; `DECISIONS.md`
controls immutable choices within it), Role Execution Architecture, V2 Workspace Contracts,
Workspace Design, V2 Validation and Acceptance, Release UAT, and finally the Implementation Runbook.
The Implementation Runbook describes execution steps only and cannot add a field, state, event, API,
or architecture rule. The Backend tools document is an
Adapter/Backend implementation reference only. v1 documents remain historical implementation
references and rejection fixtures; v2 does not migrate, dual-write, or compatibility-read v1 data.

## Unified Plan & Backlog

- [Constitution, design principles, and rules](ogsystem-constitution-v2.md): compact source for v2 governance boundaries and the active documentation map.
- [Archived v1 plan and backlog](archive/v1/todo-backlog.md): retained for historical context; it does not define v2 work.

## Architecture Decisions & Engineering Contracts

- [v2 Constitution](ogsystem-constitution-v2.md): governance layer and normative authority order.
- [Decisions](DECISIONS.md): v2 governance decisions and current system invariants.
- [Archived v1 product boundary and evolution](archive/v1/ogs-product-boundary-and-evolution.md)
- [Archived v1 shared resource architecture](archive/v1/shared-resource-architecture.md)
- [Archived v1 Native CLI integration contract](archive/v1/cli-integration-plan.md)
- [Archived v1 model availability probe API](archive/v1/model-availability-probe-api.md)
- [Archived v1 business event protocol](archive/v1/business-event-protocol-v1.md)
- [Archived v1 decision criteria and event branching](archive/v1/minimal-decision-criteria-and-event-branching.md)
- [Archived v1 compiler semantics](archive/v1/compiler-semantics-v1.md)
- [Archived v1 release compatibility policy](archive/v1/release-compatibility-policy.md): historical artifact and CLI boundary.

## Active Contract Set v2

- [Role execution architecture](role-execution-architecture.md): sole architecture and direct replacement standard.
- [V2 Workspace contracts](v2-workspace-contracts.md): sole machine contract for Workspace fields, states, events, provenance, manifests, and APIs.
- [V2 workspace collaboration design and acceptance](v2-workspace-collaboration-design-and-acceptance.md): framework-managed Git/LFS commits, Worktree isolation, canonical locking, Release materialization, and Workspace-specific acceptance.
- [v2 validation and acceptance](v2-validation-and-acceptance.md): semantic, technical, recovery, and production workflow acceptance baseline.
- [Release UAT checklist](release-uat-checklist.md): execution evidence, scenario status, responsible roles, and sign-off; it does not define another contract or acceptance model.
- [V2 Workspace implementation runbook](v2-workspace-implementation-runbook.md): implementation and operations sequence; not a contract source.
- [Backend native tools standardization](backend-native-tools-standardization.md): capability discovery and Adapter mapping reference only.

## Reference / Research

- [Runtime and NL2MMD file sets](file-sets.md): ownership boundaries, direct import exceptions, shared contracts, build output, and test ownership.
- [Source commenting style](commenting-style.md): low-noise rules for invariants, recovery context, boundaries, and generated source.
- [Bilingual extended state-machine reference](extended-state-machine-and-dag-bilingual.md): mathematical, socio-technical, DAG, and AI execution model.
- [Framework comparison](framework-comparison.md): capability-boundary comparison; not an OGS contract.
- [Archived AI agent standards coverage assessment (2026)](archive/v1/ai-agent-standards-coverage-2026.md): dated non-normative coverage assessment.
- [Archived role reasoning effort adaptation](archive/v1/reasoning-effort-adaptation-plan.md): v1 extension reference; not a v2 core contract.

## Verification, UAT & Release Records

- [Historical v1 validation record (2026-11-10)](current-version-validation-2026-11-10.md): retained for archaeology; it does not close a v2 gate.
- [v2 Gate C real workflow execution record](evidence/v2-gate-c-real-workflow-success-2026-11-16.md): historical Codex/gpt-6-luna software and documentation execution diagnostics; it does not close current Release or UAT gates.
- [v2 Gate C failure attempts](evidence/v2-gate-c-real-workflow-attempts-2026-11-16.md): retained historical diagnostics; they do not establish current final-contract acceptance.
- [v2 Workspace fault-injection engineering evidence](evidence/v2-workspace-fault-injection-2026-11-18.md): local fail-closed and recovery checks; it does not close real-Run UAT rows.
- [v2 Workspace fault-injection audit](evidence/v2-workspace-fault-injection-audit-2026-11-19.md): current ten-case implementation matrix, including cleanup and retention; it does not close real-Run UAT rows.
- [Post-merge validation (2026-11-24)](evidence/post-merge-validation-2026-11-24.md): local build, core/Team Site tests, package-install smoke, browser smoke, examples, and Doctor boundaries after the fast-forward to `main`.
- [v2 no-content-change Release lock/CAS audit](evidence/v2-noop-release-lock-cas-audit-2026-11-20.md): closes a coordinator/design mismatch for same-value Release CAS; it does not close UAT scenario 19.
- [v2 Studio Simulation Workspace smoke](evidence/v2-studio-simulation-workspace-smoke-2026-11-19.md): engineering evidence for isolated Git + LFS Simulation workspaces and internal materialization; it does not close Sandbox or operator UAT.
- [v2 UAT Project creation and refresh evidence](evidence/v2-uat-project-refresh-2026-11-19.md): browser evidence for a persisted Collaboration Project and queued Task after refresh; it does not close workflow-operator UAT or sign-off.
- [v2 Software Team Sandbox baseline](evidence/v2-software-team-baseline-2026-11-19.md): completed real-model baseline and release-readiness evidence; it does not close formal Project/UAT rows.
- [v2 formal software Project Run](evidence/v2-formal-software-project-run-2026-11-19.md): earlier completed Sandbox Run with no Project Release; engineering evidence only.
- [v2 formal software collaboration output](evidence/v2-formal-software-project-release-2026-11-19.md): historical Project/Task/Run output evidence; the filename retains the old internal record name, and the record does not close manual UAT rows.
- [v2 formal structured-debate collaboration output](evidence/v2-formal-structured-debate-project-release-2026-11-19.md): real Project/Task/Run, Join/rework, and Workspace materialization evidence; it does not close manual UAT rows or four-team coverage.
- [v2 formal structured-debate collaboration project output](evidence/v2-formal-structured-debate-collaboration-project-release-2026-11-19.md): current real Collaboration Project, branch/quorum/loop, and Workspace evidence; it does not close browser or sign-off UAT rows.
- [v2 formal management-consulting collaboration output](evidence/v2-formal-management-consulting-project-release-2026-11-19.md): real Project/Task/Run, Join/quorum, and Workspace evidence; it does not close manual UAT rows or four-team coverage.
- [v2 shared Workspace boundary with two TeamVersion Runs](evidence/v2-workspace-boundary-two-team-runs-2026-11-19.md): two real Project Runs against one Git+LFS Workspace, with independent Project control-root evidence and the final forbidden-directory check; it does not close UAT scenario 14 without review and sign-off.
- [v2 four-team coverage engineering evidence](evidence/v2-four-team-coverage-engineering-2026-11-19.md): completed Sandbox baselines and formal Project/Task/Run/Release records for all four built-in teams; it does not close UAT scenario 18 without review and sign-off.
- [v2 four-team browser review](evidence/v2-four-team-browser-review-2026-11-20.md): authorized read-only Project/Task/Run/Release review for all four teams; records output/evidence mismatches and does not close UAT scenario 18 without product-owner acceptance.
- [v2 Debug History viewport engineering evidence](evidence/v2-debug-history-viewport-engineering-2026-11-19.md): desktop and mobile captures for a real Studio Simulation after the mobile history drawer fix; it does not close UAT scenario 17 without refresh review and sign-off.
- [v2 Debug History refresh browser evidence](evidence/v2-debug-history-refresh-browser-2026-11-20.md): read-only refresh, event, evidence, and mobile overflow checks for an isolated Studio Simulation; it does not close UAT scenario 17's formal Project requirement or sign-off.
- [v2 failed Project Run responsive browser review](evidence/v2-project-failed-run-responsive-review-2026-11-20.md): read-only failure and retry-action review at desktop, tablet, and mobile widths; it does not close UAT scenario 9 without review-state evidence, captures, and operator sign-off.
- [v2 Studio Build layout browser regression](evidence/v2-visualizer-build-layout-browser-regression-2026-11-20.md): current Playwright coverage for graph editing, lifecycle controls, docked inspector geometry, and narrow viewports; it does not close UAT scenario 9 without Project operator-flow evidence and sign-off.
- [v2 TeamVersion freeze and namespace engineering evidence](evidence/v2-team-version-freeze-namespace-engineering-2026-11-19.md): trained-version immutability and Studio/Project namespace rejection checks; it does not close UAT scenario 15 without Run snapshot review and sign-off.
- [v2 TeamVersion accuracy gate browser evidence](evidence/v2-team-accuracy-gate-browser-2026-11-21.md): training-review persistence, `/train` route, and mobile team-card geometry; it does not replace product-owner review or UAT sign-off.
- [v2 management-consulting TeamVersion accuracy review](evidence/v2-team-accuracy-review-management-consulting-2026-11-21.md): role-by-role content review and verified Sandbox output readback; it identifies an empty Role Contract blocker and is not a training or UAT sign-off.
- [Release UAT checklist](release-uat-checklist.md): manual and browser release verification gates.
- [Design release validation template](design-release-validation-template.md): repeatable evidence template for design and release validation runs.
- [Runtime replay benchmark](benchmarks/runtime-replay.md): baseline replay throughput and latency measurements.

## Archive

- [Archived development plans](archive/README.md): completed or superseded proposals retained for history.
