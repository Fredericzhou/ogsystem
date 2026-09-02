# Debate Semantic Contract Example

This example keeps the graph topology in `system.mmd` and the business contract in
`.ogs/semantics.yaml`.

The business state is intentionally limited to the facts needed by a bounded debate:
`debate_round`, both positions, judge objections and decision, and the final summary.
Role execution and checkpoint fields remain runtime-owned. Event payload schemas
under `.ogs/contracts/` require each role to publish those facts explicitly.

Run from the repository root:

```bash
ogs run start \
  --system system.mmd \
  --laws laws.json \
  --user-profile user-profile.json \
  --workdir examples/langgraph-debate-current \
  --input "是否继续保持最小化"
```

This executes the configured model binding. A dry-run still exercises the graph
but its synthetic role output does not contain the business payload fields, so it
is expected to fail the semantic event contracts.

The judge must publish `consensus_reached: false` with an objection to request
another round, or `consensus_reached: true` with a decision. If the bounded loop
reaches round two, `on_exhausted` sends the flow to `debate-summary` so the run has
an explicit business outcome instead of an unbounded retry.
