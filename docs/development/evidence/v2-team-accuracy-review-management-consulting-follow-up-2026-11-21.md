# Management Consulting Team Accuracy Follow-up

Status: engineering Sandbox evidence. This record is not a workflow-operator or Product Owner
sign-off, does not train a TeamVersion, and does not close UAT Scenario 12 or any formal Project
coverage row.

## Run Identity

- Isolated Team Site: `http://127.0.0.1:4206`
- Isolated project root: `/tmp/ogs-team-baseline-attempt-20261121`
- TeamVersion: `new-team-0a679c45`, management consulting template, status `draft`
- Team core digest: `b83d8346262b91f164a825597d60f39262f179f006187d1ca787abd7f9c5cbc3`
- Sandbox Simulation: `4ee361dd-3002-48b1-b25a-fa208e8464c5`, completed 9/9 Roles
- Baseline: `classic-management-consulting`, revision `1`
- Backend/model: the isolated run used the configured Codex / `gpt-6-luna` Harness binding;
  provider execution was available in this environment.

## Evidence

- `GET /api/v2/team-versions/new-team-0a679c45/training-readiness` returned:
  `baselineReady=true`, `roleContractReady=true`, `accuracyReady=false`, `ready=false`.
- Passed baseline evidence: `classic-management-consulting` -> Simulation
  `4ee361dd-3002-48b1-b25a-fa208e8464c5`.
- Evidence Manifest endpoint returned HTTP 200. Manifest ID:
  `simulation-4ee361dd-3002-48b1-b25a-fa208e8464c5:evidence`.
- Manifest digest:
  `sha256:09833ac95182d3aadb9e30b6e145a822647644e85c9a19505e347a05d253d39d`.
- Manifest verification covered the persisted event, checkpoint, provenance, and materialization
  references through the current server-owned verifier.
- Materialized collaboration output read successfully at
  `materialization/output/executive-brief.md`. Its content preserved the task scope, separated
  facts from assumptions and unknowns, kept the arrival quorum distinct from business approval, and
  retained the quality review's corrections rather than inventing market evidence.
- The separate sealed Studio verification report endpoint returned HTTP 404
  (`STUDIO_SIMULATION_VERIFICATION_NOT_FOUND`), so this run does not claim a verification report.
- Playwright opened the completed run at `/studio/teams/new-team-0a679c45/run/4ee361dd-3002-48b1-b25a-fa208e8464c5`
  at a 390 x 844 viewport. The page returned HTTP 200, showed the completed state, nine completed
  Role cards, the evidence view, and the materialized executive brief. Body width matched the
  viewport and no page or console errors were observed.

## Accuracy Disposition

For the supplied information-limited market-entry task, the output is semantically consistent with
the requested decision-framing scope. It does not establish that the team can conduct external
market research or validate market figures without additional source capability. The corrected
machine Role Contracts passed the Runtime validator and all nine Roles completed, but a responsible
workflow operator must still inspect the run and a Product Owner must decide whether this team fits
the intended workflow. No accuracy review was persisted in this follow-up.

This is Sandbox evidence only. A formal Project/Task/Run companion, human review, and current-digest
sign-offs remain required before changing UAT status.
