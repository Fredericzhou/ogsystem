# V2 UAT Scenario 17 Rework Loop Follow-up

Evidence type: formal Project/Task/Run workflow and browser review. Product Owner acceptance is
still outstanding; this record alone does not change the Scenario 17 UAT status.

## Run and persisted evidence

- Project: `v2-uat-structured-debate-1795057638883-d38a811b`
- Task: `20261120-062953-427f5a68`
- TeamVersion: `new-team-0b2feb81` (`正反方辩论`, released v1)
- Run: `20261120-063220-949c69f3`, Sandbox, completed
- Run API: `GET /api/v2/projects/{projectId}/tasks/{taskId}/runs/{runId}` returned `completed`.
- Event API: `GET .../runs/{runId}/events` returned 43 persisted business events. It records a
  `NEEDS_REWORK` flow from `neutral-judge` to `debate-host` at loop iteration 2, a second `all_of`
  Join with both `proponent` and `opponent` arrived, and the final route to `document-publisher`.
- Evidence Manifest API: `GET .../runs/{runId}/manifest` returned manifest
  `20261120-063220-949c69f3:evidence`, digest
  `sha256:cb625b4456c75b441a35aad2f7ed140beb635df0c9855ecb6c1c040a437a622c`, 2,970 event refs,
  30 checkpoint refs, and 2 provenance refs.
- Release API: `GET /api/v2/projects/{projectId}/releases/release-20261120-063220-949c69f3`
  returned a published Release at commit `95556ffa68511ff4c564e18f9e35c8332432d536`, materialization
  manifest digest `sha256:957ad8d085cd0837bfc8c0cbae95fa554c0a207fc9715f1f15b5dcb39c4b7f66`, and output
  digest `sha256:7c78561467e3669301fffcb2707cbe7916fbad0be3490267f08ab7f31aceef12`.
- Release file API returned `debate-brief.md` (1,418 bytes; digest
  `sha256:4ec127da6e32c4b4f5a45f9364ed9808ab1d9303a7ed7ec27bb543a3628584a0`). Its decision is
  `NEEDS_REWORK`, says public release is not allowed, and identifies the missing Scenario 19 fault
  Run matrix and Product Owner review. The published Release status is the Workspace release
  lifecycle result, not a product acceptance decision.

## Browser review

- Application: Team Site `http://127.0.0.1:4173`
- Route: `/projects/v2-uat-structured-debate-1795057638883-d38a811b/runs/20261120-063220-949c69f3`
- Browser: Orca embedded Chromium
- Desktop: 1440x900; Debug History shows 13 decisions/transitions, including `NEEDS_REWORK`,
  the second 2/2 Join, and the final route.
- Mobile: 390x844; the same loop event is visible, page scroll width equals viewport width, and
  Debug History rows do not overflow horizontally.
- Refresh: Run detail and the same 13-item history remained visible after reload.
- Browser console: no errors.
- Captures:
  - Desktop: [`screenshots/v2-project-debug-history-rework-loop-desktop-2026-11-20.png`](screenshots/v2-project-debug-history-rework-loop-desktop-2026-11-20.png), SHA-256 `e71125ef23c2ce6d9754eba0519a1a36aeb37592a58232a099c40dee1b18a4d7`
  - Mobile: [`screenshots/v2-project-debug-history-rework-loop-mobile-2026-11-20.png`](screenshots/v2-project-debug-history-rework-loop-mobile-2026-11-20.png), SHA-256 `24ab8804df50710ba940b9f2d1764bb2841212c3d17b22946c557fe75f73b43b`

## Defect and boundary

The live Project page originally showed 6 decisions/transitions for this Run because its polling
path requested only the first 20 business events. The persisted API contained 43 events and 13
decision/transition events, so the second-round `NEEDS_REWORK` and Join were omitted from Debug
History. Project Run polling now reads event pages using the contract cursor and accumulates them;
the page shows all 13 entries after refresh. A regression test covers a decision event arriving on
the next event page.

Scenario 17 remains Blocked until the Product Owner reviews the Run summary and published brief,
resolves the remaining acceptance interpretation, and signs off. The evidence does not claim V2 is
accepted or ready for public release.
