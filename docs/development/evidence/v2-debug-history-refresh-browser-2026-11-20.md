# V2 Debug History Refresh Browser Evidence

Status: supplemental Studio Simulation engineering evidence only. It does not close Release UAT
Scenario 17, which still requires a formal Project/Task/Run Debug History review and responsible
sign-off.

## Execution

- Date: 2026-11-20 (Asia/Shanghai)
- Application: Team Site at `http://127.0.0.1:4173`
- Browser: Orca embedded Chromium
- TeamVersion: `new-team-0b2feb81`
- Studio Simulation: `7bcf57ef-a329-436e-a715-7c2d0c3c14e6`, status `completed`
- Route: `/studio/teams/new-team-0b2feb81/run/7bcf57ef-a329-436e-a715-7c2d0c3c14e6`
- Data scope: isolated Studio Simulation; not a Project Run

## Results

- The Simulation detail API and Events API returned HTTP 200 before and after browser refresh.
- The Events API returned 59 records, including `role.started`, `result_committed`,
  `join_activated`, `flow.activated`, and `workspace_integrated`. Both `join_activated` records
  report `all_of`, two required sources, and `proponent` plus `opponent` satisfied.
- The Debug History showed the same Simulation ID, completed status, and nine transitions after
  refresh. The second `neutral-judge` output could be expanded again after refresh.
- The Run Evidence page returned HTTP 200 and listed persisted execution outcomes and role result
  files. No console errors were present.
- At mobile emulation `390x844`, the Debug History drawer remained visible and
  `document.documentElement.scrollWidth` equaled `innerWidth` at 390px.
- Desktop and mobile screenshots were saved after filesystem capacity recovered. The mobile capture
  shows the expanded Debug History drawer and role transcript; no horizontal overflow was observed.

## Captures

- Desktop, expanded role output: [`screenshots/v2-debug-history-refresh-desktop-2026-11-20.png`](screenshots/v2-debug-history-refresh-desktop-2026-11-20.png), SHA-256 `10b32ea12a4630b15f36c895d4e55fb179ace77b04e45bd6797a92a5957693d7`
- Desktop, after refresh: [`screenshots/v2-debug-history-refresh-desktop-after-2026-11-20.png`](screenshots/v2-debug-history-refresh-desktop-after-2026-11-20.png), SHA-256 `0ab2cc75e27b0395bab88a733555acc183e95406b7c278eaf1d6466e1ad90222`
- Mobile `390x844`, after refresh: [`screenshots/v2-debug-history-refresh-mobile-2026-11-20.png`](screenshots/v2-debug-history-refresh-mobile-2026-11-20.png), SHA-256 `1c321383bd28ff1507601fc860495d1483fe25a094e8ed604d9a83e06f51aee5`

Desktop captures are `1602x872`; mobile capture is `390x844` CSS pixels at device scale factor 3.
This evidence validates Studio Simulation history persistence and mobile overflow behavior only.
It does not satisfy Scenario 17's formal Project requirement or provide workflow-operator/product-
owner acceptance.
