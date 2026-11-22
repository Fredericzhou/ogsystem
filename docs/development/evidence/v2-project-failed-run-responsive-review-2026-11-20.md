# V2 Project Failed-Run Responsive Browser Review

Status: supplemental read-only Project UX evidence. It does not close Release UAT Scenario 9;
the review state, required screenshots, and workflow-operator sign-off remain outstanding.

## Execution

- Date: 2026-11-20 (Asia/Shanghai)
- Application: Team Site at `http://127.0.0.1:4173`
- Project: `v2-formal-cross-backend-review-20261119-b47ed0ae`
- Task: `20261119-094024-ba2a2873`
- Failed Run: `20261119-094113-5cbcad4e`, Sandbox attempt 1
- TeamVersion: `new-team-16ecab51`
- Browser: Orca embedded Chromium; read-only review, no retry submitted

## Findings

- Project Run API reports `failed`; the `implementer` attempt failed because its output had an
  additional `data` property not allowed by the configured output schema. The Run retains its
  attempt record and evidence is available.
- The Project page showed the failed Run and an enabled `重试此任务` action. No published Release
  or pending Review was present for this task; the Run plan has no review-required nodes and the
  state has an empty `reviews` list.
- The failed Run and retry action remained visible at desktop `1602x872`, tablet `768x900`, and
  mobile `390x844`. At all three viewports, `document.documentElement.scrollWidth` equaled the
  viewport width. The browser console had no errors.
- Project overview screenshots for all three viewports and task-focused tablet/mobile screenshots
  are attached below. The focused captures show the failure status and retry action inside the task
  card.

## Captures

- Desktop `1602x872`: [`screenshots/v2-project-failed-run-desktop-2026-11-20.png`](screenshots/v2-project-failed-run-desktop-2026-11-20.png), SHA-256 `4637aede34ac9c6786988bd708789fdc9eafd8b257892e271fc27e8f5ee57dba`
- Tablet `768x900`: [`screenshots/v2-project-failed-run-tablet-2026-11-20.png`](screenshots/v2-project-failed-run-tablet-2026-11-20.png), SHA-256 `e9b56e79488412a0155310f2bcf84e8ff7638581c26e91308c31a81cfac65da7`
- Mobile `390x844`: [`screenshots/v2-project-failed-run-mobile-2026-11-20.png`](screenshots/v2-project-failed-run-mobile-2026-11-20.png), SHA-256 `9ae0b2cbdd9665f0f2a44c9e267030e5882b304b63dd634d9d174b94b01ed590`
- Tablet, task-focused: [`screenshots/v2-project-failed-run-tablet-detail-2026-11-20.png`](screenshots/v2-project-failed-run-tablet-detail-2026-11-20.png), SHA-256 `3c47add5d4ddd37ae8c2cae78b1b513038a3640de32a2141d68ba3649dde2dd7`
- Mobile, task-focused: [`screenshots/v2-project-failed-run-mobile-detail-2026-11-20.png`](screenshots/v2-project-failed-run-mobile-detail-2026-11-20.png), SHA-256 `259ddeead2b89df0908cda6ab0d56fac6b29bb50f42adeeaac656b8e22160809`

This validates the display of one real failure and its next action across three viewport widths.
It does not cover a pending Review, the complete operator workflow, or operator sign-off. Scenario
9 remains Blocked.
