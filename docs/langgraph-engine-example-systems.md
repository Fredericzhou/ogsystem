# LangGraph Engine Example Systems

Date: 2026-04-09  
Status: design examples

This document provides Mermaid-first examples for a future `LangGraph` engine mode.

Important:

- these are design examples, not runnable on the current minimal runtime
- they use target terminology: `model.bind.<roleId>=<modelId>`
- runtime migration may still keep `exec.bind.*` compatibility in implementation

Assumed capabilities:

- parallel split
- `all_of` join
- loop budget
- per-role model binding
- structured role output

Proposed executable output contract:

```json
{"event":"EVENT_NAME","content":"...","data":{}}
```

Proposed metadata extensions:

- `%% engine=langgraph`
- `%% role.mode.<roleId>=parallel_split`
- `%% join.mode.<roleId>=all_of`
- `%% join.sources.<roleId>=roleA,roleB,...`
- `%% loop.max.<roleId>=N`
- `%% model.bind.<roleId>=<modelId>`

## 1. Expert Consultation System

Goal:

- intake one medical problem
- dispatch to multiple specialist roles in parallel
- each specialist can use a different model package
- chief physician merges parallel diagnoses
- if evidence conflicts, run one more consultation loop

### Mermaid

```mermaid
flowchart TD
%% engine=langgraph
%% system.id=medical.expert.consultation
%% system.version=1.0.0
%% law.global=law.medical.consultation.base
%% entry.role=diagnosis-intake
%% role.mode.diagnosis-dispatch=parallel_split
%% join.mode.diagnosis-chief-review=all_of
%% join.sources.diagnosis-chief-review=diagnosis-cardiology,diagnosis-neurology,diagnosis-imaging
%% loop.max.diagnosis-dispatch=2
%% model.bind.diagnosis-intake=fast-gpt54
%% model.bind.diagnosis-dispatch=fast-gpt54
%% model.bind.diagnosis-cardiology=claude-sonnet
%% model.bind.diagnosis-neurology=deep-o3
%% model.bind.diagnosis-imaging=deep-o3
%% model.bind.diagnosis-chief-review=deep-o3
%% model.bind.diagnosis-report=fast-gpt54

input -->|CASE_RECEIVED| intake[Role:diagnosis-intake]
intake[Role:diagnosis-intake] -->|READY_FOR_PARALLEL| parallel_dispatch[Role:diagnosis-dispatch]

parallel_dispatch[Role:diagnosis-dispatch] -->|START_CARDIOLOGY| cardiology[Role:diagnosis-cardiology]
parallel_dispatch[Role:diagnosis-dispatch] -->|START_NEUROLOGY| neurology[Role:diagnosis-neurology]
parallel_dispatch[Role:diagnosis-dispatch] -->|START_IMAGING| imaging[Role:diagnosis-imaging]

cardiology[Role:diagnosis-cardiology] -->|CARDIOLOGY_DONE| chief_review[Role:diagnosis-chief-review]
neurology[Role:diagnosis-neurology] -->|NEUROLOGY_DONE| chief_review[Role:diagnosis-chief-review]
imaging[Role:diagnosis-imaging] -->|IMAGING_DONE| chief_review[Role:diagnosis-chief-review]

chief_review[Role:diagnosis-chief-review] -->|REQUEST_RECHECK| parallel_dispatch[Role:diagnosis-dispatch]
chief_review[Role:diagnosis-chief-review] -->|CONSENSUS_READY| final_report[Role:diagnosis-report]
final_report[Role:diagnosis-report] -->|REPORT_READY| output
```

### Model Packages

Role execution is expected to resolve from `og-models/models/<modelId>/model.json`.

Example package ids used above:

- `fast-gpt54`
- `deep-o3`
- `claude-sonnet`

### Role Packages

Role behavior is expected to resolve from `og-roles/roles/<roleId>/`:

- `diagnosis-intake`
- `diagnosis-dispatch`
- `diagnosis-cardiology`
- `diagnosis-neurology`
- `diagnosis-imaging`
- `diagnosis-chief-review`
- `diagnosis-report`

### Notes

- `diagnosis-dispatch` is lowered as one parallel split node
- `diagnosis-chief-review` is an `all_of` join waiting for all specialists
- `REQUEST_RECHECK` forms a bounded loop back to dispatch

## 2. Current Debate Example

Goal:

- run two debaters in parallel
- judge produces either final decision or one rebuttal round
- each role may use a different model package

### Mermaid

```mermaid
flowchart TD
%% engine=langgraph
%% system.id=architecture.debate.current
%% system.version=1.0.0
%% law.global=law.debate.base
%% entry.role=debate-moderator
%% role.mode.debate-round-manager=parallel_split
%% join.mode.debate-judge=all_of
%% join.sources.debate-judge=debate-minimalist,debate-alignmentist
%% loop.max.debate-round-manager=2
%% model.bind.debate-moderator=fast-gpt54
%% model.bind.debate-round-manager=fast-gpt54
%% model.bind.debate-minimalist=claude-sonnet
%% model.bind.debate-alignmentist=deep-o3
%% model.bind.debate-judge=deep-o3
%% model.bind.debate-summary=fast-gpt54

input -->|DEBATE_REQUEST| moderator[Role:debate-moderator]
moderator[Role:debate-moderator] -->|ROUND_READY| parallel_round[Role:debate-round-manager]

parallel_round[Role:debate-round-manager] -->|SEND_MINIMALIST| minimalist[Role:debate-minimalist]
parallel_round[Role:debate-round-manager] -->|SEND_ALIGNMENTIST| alignmentist[Role:debate-alignmentist]

minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| judge[Role:debate-judge]
alignmentist[Role:debate-alignmentist] -->|ALIGNMENTIST_DONE| judge[Role:debate-judge]

judge[Role:debate-judge] -->|REBUTTAL_NEEDED| parallel_round[Role:debate-round-manager]
judge[Role:debate-judge] -->|DECISION_READY| summary[Role:debate-summary]
summary[Role:debate-summary] -->|SUMMARY_READY| output
```

### Role Packages

- `debate-moderator`
- `debate-round-manager`
- `debate-minimalist`
- `debate-alignmentist`
- `debate-judge`
- `debate-summary`

### Notes

- `debate-round-manager` is lowered to a parallel split
- `debate-judge` is an `all_of` join waiting for both debaters
- `REBUTTAL_NEEDED` creates a bounded loop

## 3. Minimal Future Engine Requirements

To run these systems, the engine should minimally support:

1. role-level model binding
2. parallel split into multiple active branches
3. `all_of` join with deterministic merge input
4. bounded loop control
5. audit records with `branchId`, `joinId`, and `loopIteration`
6. projections from runtime state and audit trail rather than leaking internal engine step ids
