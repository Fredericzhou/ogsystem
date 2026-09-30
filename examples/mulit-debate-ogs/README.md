# Multi Debate OGS Project

This project adapts the role based investment debate flow in `D:\Coder\AAI\mulit-debate` to the current OGSystem graph runtime.

The project has five seats: `investment-proposer`, `investment-critic`, `investment-optimizer`, `debate-judge`, and `debate-summary`. The proposer fans work out to the critic and optimizer, the judge joins both reviews, and `loop.max.investment-proposer=2` bounds a rebuttal cycle.

The source workflow runs its optimizer and critic sequentially, gathers their judge feedback, and only requests manual finalization when both reject the judge's proposal. The current Mermaid graph runtime cannot express those state dependent route conditions or conditional review gate. This OGS adaptation therefore uses a parallel review join and routes review through the judge's `REBUTTAL_NEEDED` or `DECISION_READY` events. It does not claim behavioral parity with the source LangGraph workflow.

## Validate

From the OGSystem repository root:

```powershell
ogs project sync --system examples/mulit-debate-ogs/system.mmd --ogs-dir examples/mulit-debate-ogs
ogs lint --system examples/mulit-debate-ogs/system.mmd
ogs run start --system examples/mulit-debate-ogs/system.mmd --ogs-dir examples/mulit-debate-ogs --input "评估该投资方案的主要收益、风险与验证条件" --dry-run
```

The project uses the locally discovered Codex `gpt-6-luna` model as its default for each role. Role-specific backend/model overrides can be added in `.ogs/model-selection.json`; `system.mmd` remains the source of graph semantics. The dry-run validates graph execution without calling the selected model.
