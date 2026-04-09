# LangGraph Engine Example Systems

Date: 2026-04-09  
Status: design examples

This document provides two Mermaid-first system examples intended for a future `LangGraph` engine mode.

Important:

- These are design examples, not runnable on the current minimal runtime.
- They assume the runtime supports:
  - parallel split
  - `all_of` join
  - loop budget
  - per-role execution binding
  - structured role output

Proposed structured output contract for executable roles:

```json
{"event":"EVENT_NAME","content":"...","data":{}}
```

Proposed LangGraph-oriented metadata extensions used below:

- `%% engine=langgraph`
- `%% role.mode.<roleId>=parallel_split`
- `%% join.mode.<roleId>=all_of`
- `%% join.sources.<roleId>=roleA,roleB,...`
- `%% loop.max.<roleId>=N`
- `%% exec.bind.<roleId>=<profileId>`

Concrete sample files:

- `examples/langgraph-expert-consultation/`
- `examples/langgraph-debate-current/`
- minimal future engine boundary: `src/runtime/langgraph-engine.ts`

## 1. Expert Consultation System

Goal:

- intake one medical problem
- dispatch to multiple specialist roles in parallel
- each specialist uses a different CLI and profile
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
%% exec.bind.diagnosis-intake=profile.intake.codex
%% exec.bind.diagnosis-dispatch=profile.dispatch.codex
%% exec.bind.diagnosis-cardiology=profile.cardiology.claude
%% exec.bind.diagnosis-neurology=profile.neurology.gemini
%% exec.bind.diagnosis-imaging=profile.imaging.python
%% exec.bind.diagnosis-chief-review=profile.chief.codex
%% exec.bind.diagnosis-report=profile.report.codex

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

### Execution Profiles

```json
[
  {
    "profileId": "profile.intake.codex",
    "toolRef": "tool.codex.exec",
    "timeoutMs": 60000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.dispatch.codex",
    "toolRef": "tool.codex.exec",
    "timeoutMs": 60000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.cardiology.claude",
    "toolRef": "tool.claude.exec",
    "timeoutMs": 90000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.neurology.gemini",
    "toolRef": "tool.gemini.exec",
    "timeoutMs": 90000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.imaging.python",
    "toolRef": "tool.python.imaging",
    "timeoutMs": 45000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.chief.codex",
    "toolRef": "tool.codex.exec",
    "timeoutMs": 90000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.report.codex",
    "toolRef": "tool.codex.exec",
    "timeoutMs": 60000,
    "maxOutputBytes": 65536
  }
]
```

### Tool Registry

```json
{
  "tools": [
    {
      "toolRef": "tool.codex.exec",
      "runner": "local_shell",
      "command": "codex",
      "argsTemplate": [
        "exec",
        "--skip-git-repo-check",
        "--color",
        "never",
        "{{prompt}}"
      ],
      "stdinMode": "none"
    },
    {
      "toolRef": "tool.claude.exec",
      "runner": "local_shell",
      "command": "claude",
      "argsTemplate": [
        "--print",
        "{{prompt}}"
      ],
      "stdinMode": "none"
    },
    {
      "toolRef": "tool.gemini.exec",
      "runner": "local_shell",
      "command": "gemini",
      "argsTemplate": [
        "--prompt",
        "{{prompt}}"
      ],
      "stdinMode": "none"
    },
    {
      "toolRef": "tool.python.imaging",
      "runner": "local_shell",
      "command": "python3",
      "argsTemplate": [
        "scripts/imaging_consult.py",
        "{{prompt}}"
      ],
      "stdinMode": "none"
    }
  ]
}
```

### Role Packages

Role behavior is expected to live in role packages resolved by roleId:

- `diagnosis-intake`
- `diagnosis-dispatch`
- `diagnosis-cardiology`
- `diagnosis-neurology`
- `diagnosis-imaging`
- `diagnosis-chief-review`
- `diagnosis-report`

### LangGraph Execution Notes

- `diagnosis-dispatch` is lowered as one parallel split node.
- `diagnosis-chief-review` is lowered as an `all_of` join node that waits for `diagnosis-cardiology`, `diagnosis-neurology`, and `diagnosis-imaging`.
- `REQUEST_RECHECK` forms a bounded loop back to `diagnosis-dispatch`.
- Each specialist role uses a different tool/profile.

## 2. Current Debate Example

Debate topic:

- should OGSystem continue with a minimal implementation, or align early to a larger semantic system

Goal:

- run two debaters in parallel
- judge produces either final decision or one rebuttal round
- use different CLIs for different debate roles

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
%% exec.bind.debate-moderator=profile.moderator.codex
%% exec.bind.debate-round-manager=profile.round.codex
%% exec.bind.debate-minimalist=profile.minimalist.claude
%% exec.bind.debate-alignmentist=profile.alignmentist.gemini
%% exec.bind.debate-judge=profile.judge.codex
%% exec.bind.debate-summary=profile.summary.codex

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

### Execution Profiles

```json
[
  {
    "profileId": "profile.moderator.codex",
    "toolRef": "tool.codex.exec",
    "timeoutMs": 60000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.round.codex",
    "toolRef": "tool.codex.exec",
    "timeoutMs": 60000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.minimalist.claude",
    "toolRef": "tool.claude.exec",
    "timeoutMs": 90000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.alignmentist.gemini",
    "toolRef": "tool.gemini.exec",
    "timeoutMs": 90000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.judge.codex",
    "toolRef": "tool.codex.exec",
    "timeoutMs": 90000,
    "maxOutputBytes": 65536
  },
  {
    "profileId": "profile.summary.codex",
    "toolRef": "tool.codex.exec",
    "timeoutMs": 60000,
    "maxOutputBytes": 65536
  }
]
```

### Role Packages

Role behavior is expected to live in role packages resolved by roleId:

- `debate-moderator`
- `debate-round-manager`
- `debate-minimalist`
- `debate-alignmentist`
- `debate-judge`
- `debate-summary`

### LangGraph Execution Notes

- `debate-round-manager` is lowered to a parallel split.
- `debate-judge` is an `all_of` join that waits for both debaters.
- `REBUTTAL_NEEDED` creates a bounded debate loop.
- This example is intentionally small: two parallel debaters, one judge, one optional rebuttal loop.

## Minimal LangGraph Engine Requirements Behind These Examples

To run these systems, the engine should minimally support:

1. role-level execution binding
2. parallel split from one role into multiple active branches
3. `all_of` join with deterministic merge input
4. bounded loop control
5. audit records with `branchId`, `joinId`, and `loopIteration`
6. projection from runtime state and audit trail rather than exposing LangGraph internal step ids
