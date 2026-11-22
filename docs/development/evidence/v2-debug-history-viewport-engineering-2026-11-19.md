# V2 Debug History Viewport Engineering Evidence

Status: engineering browser evidence captured on 2026-11-19. This record does not provide
workflow-operator or product-owner sign-off for Release UAT scenario 17.

## Run and Route

- TeamVersion: `new-team-0b2feb81`
- Studio Simulation: `7bcf57ef-a329-436e-a715-7c2d0c3c14e6`
- Route: `/studio/teams/new-team-0b2feb81/run/7bcf57ef-a329-436e-a715-7c2d0c3c14e6`
- Source: running Team Site at `http://127.0.0.1:4173`

## Browser Checks

| Viewport | Capture | Result |
| --- | --- | --- |
| Desktop `1440x1000` | `screenshots/v2-uat-debug-history-desktop-2026-11-19.png` | Debug History is visible with one completed record; graph and execution history render without horizontal overflow. |
| Mobile `390x844`, initial | `screenshots/v2-uat-debug-history-mobile-2026-11-19.png` | Debug History starts collapsed; the navigation control exposes its expand action. No horizontal overflow. |
| Mobile `390x844`, expanded | `screenshots/v2-uat-debug-history-mobile-expanded-2026-11-19.png` | The same control expands Debug History to a visible 366px-wide panel with one record; no horizontal overflow. |

The browser run reported no console errors or page errors. The mobile expansion uses the existing
history navigation control and keeps the history panel bounded to a scrollable 320px maximum height.
The initial mobile collapse is intentional so the execution view remains usable on a narrow screen.

## Evidence Boundary

This proves the viewport behavior and capture path after the mobile history drawer fix. It does not
prove the required refresh comparison, expanded decision review, accessibility evaluation, or human
sign-off. Scenario 17 therefore remains `Not run` until those required records are attached.
