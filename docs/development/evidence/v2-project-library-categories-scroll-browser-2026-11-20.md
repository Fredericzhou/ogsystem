# V2 Project Library Categories, Navigation, and Scroll Check

## Scope

- Executor: Codex acting as workflow operator with Playwright and Orca.
- Date: 2026-11-20.
- Team Site: `http://127.0.0.1:4173/projects`.

## Results

The Project library now has status categories and a Team filter. Playwright exercised all five
categories and confirmed the visible card counts match the displayed counts:

| Category | Projects |
| --- | ---: |
| All | 13 |
| In progress | 2 |
| Failed | 2 |
| Completed | 9 |
| Not started | 0 |

The Team filter offers the four mounted TeamVersions represented by these Projects. Selecting the
first team narrowed the visible list to four Projects. Cards no longer repeat a team-count badge;
each mounted TeamVersion name links to its Studio structure route.

Playwright mouse-wheel input moved the Project page scroll position from 0 to 600px at desktop
1440x900 and mobile 390x844. At 390px, document width remained 390px. The linked route
`/studio/teams/new-team-0b2feb81/design` loaded the team graph, displayed `已练成`, and labeled the
Studio tab `练成`. Orca repeated the visible team-link click and returned to the Project library.
There were no page or console errors during the browser checks.

Desktop Orca capture: [`v2-project-library-categories-scroll-orca-2026-11-20.png`](screenshots/v2-project-library-categories-scroll-orca-2026-11-20.png),
SHA-256 `5272aee892e852f627b033c155fd1b62d08eee45f08cb25a32568cf9d007512b`.

This closes the Project-library categorization, team navigation, and scrolling UX check. It does
not close the remaining responsive workflow, accessibility, or product-owner acceptance items in
Scenario 9.
