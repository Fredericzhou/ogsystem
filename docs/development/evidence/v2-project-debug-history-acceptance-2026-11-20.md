# Project Debug History Browser Acceptance

Status: workflow-operator browser evidence; Product Owner sign-off is pending. This record does not
close V2 release acceptance.

## Run and API Evidence

- Date: 2026-11-20 (Asia/Shanghai)
- Team Site: `http://127.0.0.1:4174`
- Project: `v2-uat-structured-debate-1795057638883-d38a811b`
- Task: `20261120-051853-a8b5fb78`
- TeamVersion: `new-team-0b2feb81`
- Run: `20261120-051917-b467b893`, completed in Sandbox mode
- Release: `release-20261120-051917-b467b893`, published
- Evidence Manifest digest: `sha256:92c1f0cb0f6d271a7a1e7032ad33e4930c6005f8016bf4b46a062cdc75d146b7`
- Events API: HTTP 200, 33 records. The `join_activated` event records `all_of`, both required
  sources (`proponent`, `opponent`) arrived, and a decision-time source snapshot with branch IDs.
- Release API: HTTP 200; release commit `2ef7e14fc71a635f5ac153936c60573fc128e44c`; materialization
  manifest digest `sha256:c2c91379b0e71e889e359b4ba1ccb32193387603ba542d40731e4bafb28a7fc2`.

The Run has one debate round and no `NEEDS_REWORK`, `loop_budget_decision`, or second-round events.
The earlier Role output claim that a rework loop occurred is not supported by this event history.
This record proves the branch/Join Debug History path only; it does not claim loop acceptance.

## Browser Review

The Project Run page now includes a collapsed Debug History list for business flow, routing, Join,
loop, failure, and human-review events. Expanding a Join row shows its mode, required and arrived
sources, branch IDs, loop round, and decision-time source snapshot. On the focused Run route, the
redundant “查看全流程” link to the same route is hidden.

- Desktop viewport: `1440x1000`; document width equals viewport width.
- Mobile viewport: `390x844`; document width equals viewport width.
- Refreshed the page and re-opened Debug History and the Join row; Run status, ID, event summary,
  and decision snapshot remained available.
- Browser console errors and page errors: none.
- The Project page visibly reports the published Release.
- Team Site regression suite: 77 passed, 0 failed; `pnpm --dir apps/team-site build:assets` and
  `git diff --check` passed.

Captures (after refresh, with the Join source snapshot expanded):

- Desktop: [`screenshots/v2-project-debug-history-desktop-2026-11-20.png`](screenshots/v2-project-debug-history-desktop-2026-11-20.png), SHA-256 `1d8c208546705b17a12c1ea7f9cd37fb639a07dd0db413f792df4c4bb7592f13`
- Mobile: [`screenshots/v2-project-debug-history-mobile-2026-11-20.png`](screenshots/v2-project-debug-history-mobile-2026-11-20.png), SHA-256 `9655a4317c0190b2801aa61c2af2152eebb021375d481638093abcac42adaa7c`

Scenario 17 remains Blocked pending Product Owner sign-off and review of the event/output
contradiction. Other UAT scenarios, fault coverage, team coverage, and release gates are unaffected.
