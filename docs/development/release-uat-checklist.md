# OGSystem Release UAT

This checklist gates the first stable local-first release. It starts from a clean install and a
new project; historical development data and interfaces are not migration or compatibility targets.

## Participants

- Framework developer: checks install, configuration diagnostics, API contracts, and recovery evidence.
- Workflow operator: completes the scenarios without editing runtime files by hand.
- Product owner: records pass/fail and accepts any non-blocking findings.
- At least one real target workflow is required in addition to repository examples.

## Scenarios

1. Install the package on a clean supported machine, create a project, configure one Role and its
   executor, validate readiness, and run the minimal linear example.
2. Run a branch-and-join example; inspect initial input, each Role's input/output and handoff in
   the Visualizer Flow view, then verify the event stream and execution records through `/api/v1`.
3. Stop at human review, record approve and rework decisions, verify principal attribution, resume,
   and confirm that duplicate or stale decisions are rejected without changing the run.
4. Trigger a configured failure-compensation route, inspect the failure and audit evidence, and
   resume an interrupted run without repeating a committed role execution.
5. Scrape `/metrics`, check `/healthz` and `/readyz`, and verify that sensitive prompt/result data
   is absent from metric labels and operational summaries.
6. Complete the same operator workflow at desktop and mobile viewport sizes; confirm the graph,
   failure location, pending review action, and next lifecycle action remain discoverable.

## Release Gate

- Required build, unit, contract, integration, fault-injection, package-install, and browser E2E
  checks pass on supported CI platforms.
- UAT evidence records package version, OS/runtime, workflow fixture, API/UI paths used, outcome,
  and issue references.
- No unresolved blocker or high-severity data-integrity, authorization, recovery, or audit issue.
- Flow-contract gaps block release only when `handoff.mode=strict`; `transition` gaps remain readiness warnings, and projects without `handoff.mode` do not enforce flow contracts.
- Product owner and workflow operator sign off the real target workflow.
- Record local-run resource and artifact growth for the representative workload; set release limits
  from observed results rather than speculative cross-host targets.
