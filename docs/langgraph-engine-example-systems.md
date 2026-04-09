# LangGraph Engine Example Systems

Date: 2026-04-09  
Status: runnable minimal examples

This document records the two Mermaid-first examples that match the current runtime:

- debate: `parallel_split + all_of join + bounded loop`
- expert consultation: `parallel_split + all_of join`

Common metadata:

- `%% engine=langgraph`
- `%% role.mode.<roleId>=parallel_split`
- `%% join.mode.<roleId>=all_of`
- `%% join.sources.<roleId>=roleA,roleB,...`
- `%% loop.max.<roleId>=N`
- `%% model.bind.<roleId>=<modelId>`

Current curated model ids:

- `fast-gpt54`
- `balanced-gpt52`
- `steady-gpt54`
- `deep-o3`

Raw local availability snapshot:

- `og-models/catalog/opencode-models.json`

## 1. Expert Consultation

Goal:

- one difficult case enters once
- three experts analyze in parallel
- chief specialist outputs one final summary
- final summary must preserve disagreement plus overall conclusion

### Mermaid

```mermaid
flowchart TD
%% engine=langgraph
%% system.id=medical.expert.consultation
%% system.version=1.0.0
%% law.global=law.medical.consultation.base
%% entry.role=diagnosis-dispatch
%% role.mode.diagnosis-dispatch=parallel_split
%% join.mode.diagnosis-chief-review=all_of
%% join.sources.diagnosis-chief-review=diagnosis-cardiology,diagnosis-neurology,diagnosis-imaging
%% model.bind.diagnosis-dispatch=fast-gpt54
%% model.bind.diagnosis-cardiology=balanced-gpt52
%% model.bind.diagnosis-neurology=deep-o3
%% model.bind.diagnosis-imaging=steady-gpt54
%% model.bind.diagnosis-chief-review=deep-o3

input -->|CASE_RECEIVED| dispatch[Role:diagnosis-dispatch]
dispatch[Role:diagnosis-dispatch] -->|START_CARDIOLOGY| cardiology[Role:diagnosis-cardiology]
dispatch[Role:diagnosis-dispatch] -->|START_NEUROLOGY| neurology[Role:diagnosis-neurology]
dispatch[Role:diagnosis-dispatch] -->|START_IMAGING| imaging[Role:diagnosis-imaging]
cardiology[Role:diagnosis-cardiology] -->|CARDIOLOGY_DONE| chief[Role:diagnosis-chief-review]
neurology[Role:diagnosis-neurology] -->|NEUROLOGY_DONE| chief[Role:diagnosis-chief-review]
imaging[Role:diagnosis-imaging] -->|IMAGING_DONE| chief[Role:diagnosis-chief-review]
chief[Role:diagnosis-chief-review] -->|CONSULTATION_READY| output
```

### Notes

- `diagnosis-dispatch` is the only split node
- `diagnosis-chief-review` is the final join node
- the example is intentionally loop-free to stay minimal
- example user profile: `examples/langgraph-expert-consultation/user-profile.json`

Run:

```bash
npm run run:adapter -- \
  --system examples/langgraph-expert-consultation/system.mmd \
  --laws examples/langgraph-expert-consultation/laws.json \
  --user-profile examples/langgraph-expert-consultation/user-profile.json \
  --prompt "患者间断高热、皮疹、胸闷、肌无力，常规检查未能解释原因，请组织多学科会诊。" \
  --dry-run
```

## 2. Debate

Goal:

- moderator dispatches both sides directly
- both sides argue in parallel
- judge either asks for one more round or finalizes
- summary writes the final decision for the chosen user profile

### Mermaid

```mermaid
flowchart TD
%% engine=langgraph
%% system.id=architecture.debate.current
%% system.version=1.0.0
%% law.global=law.debate.base
%% entry.role=debate-moderator
%% role.mode.debate-moderator=parallel_split
%% join.mode.debate-judge=all_of
%% join.sources.debate-judge=debate-minimalist,debate-alignmentist
%% loop.max.debate-moderator=2
%% model.bind.debate-moderator=fast-gpt54
%% model.bind.debate-minimalist=balanced-gpt52
%% model.bind.debate-alignmentist=deep-o3
%% model.bind.debate-judge=deep-o3
%% model.bind.debate-summary=steady-gpt54

input -->|DEBATE_REQUEST| moderator[Role:debate-moderator]
moderator[Role:debate-moderator] -->|SEND_MINIMALIST| minimalist[Role:debate-minimalist]
moderator[Role:debate-moderator] -->|SEND_ALIGNMENTIST| alignmentist[Role:debate-alignmentist]
minimalist[Role:debate-minimalist] -->|MINIMALIST_DONE| judge[Role:debate-judge]
alignmentist[Role:debate-alignmentist] -->|ALIGNMENTIST_DONE| judge[Role:debate-judge]
judge[Role:debate-judge] -->|REBUTTAL_NEEDED| moderator[Role:debate-moderator]
judge[Role:debate-judge] -->|DECISION_READY| summary[Role:debate-summary]
summary[Role:debate-summary] -->|SUMMARY_READY| output
```

### Notes

- `debate-moderator` now owns round framing and split dispatch
- `debate-judge` is the only join node
- the loop budget is attached to the moderator node
- example user profile: `examples/langgraph-debate-current/user-profile.json`

Run:

```bash
npm run run:adapter -- \
  --system examples/langgraph-debate-current/system.mmd \
  --laws examples/langgraph-debate-current/laws.json \
  --user-profile examples/langgraph-debate-current/user-profile.json \
  --prompt "是否应继续保持 OGSystem 最小化并延后 reducer 与恢复语义？" \
  --dry-run
```
