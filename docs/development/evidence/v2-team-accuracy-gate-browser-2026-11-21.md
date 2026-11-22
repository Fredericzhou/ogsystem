# V2 Team Accuracy Gate Browser Evidence

Status: engineering and browser evidence. This record is not a product owner sign-off and does not
close a UAT scenario.

## Scope

- Verify the public Studio training route uses `/train`; the old `/release` page is not served.
- Verify a draft TeamVersion exposes the accuracy review form and keeps training disabled until the
  review and Sandbox baseline gates are satisfied.
- Verify a built-in case's current materialized structure does not bypass the accuracy review gate.
- Verify the TeamVersion accuracy review is persisted with the current `teamCoreDigest` and the
  current Sandbox Simulation evidence IDs.
- Check the team library card actions at a 390 x 844 mobile viewport.

## Execution

- Server: `apps/team-site/server.mjs`, isolated temporary `OGS_SITE_PROJECTS_DIR`, port `4199`.
- Browser: Playwright with the installed system Chrome executable.
- Viewport: 390 x 844, device scale factor 1.
- TeamVersion: a newly provisioned built-in `management-consulting` template.
- Follow-up browser runs: newly provisioned built-in TeamVersions on ports `4201` and `4202`, with
  no provider credentials available for a Sandbox baseline.

## Observed results

| Check | Result |
| --- | --- |
| `GET /studio/teams/<id>/train` | HTTP 200 |
| `GET /studio/teams/<id>/release` | HTTP 404 |
| Accuracy review form present | Yes |
| Train button before review/baseline | Disabled |
| Built-in materializer current check without review | Still blocked; `TEAM_ACCURACY_REVIEW_REQUIRED` |
| Baseline evidence selector | Visible and requires every current Sandbox Simulation ID; with no completed baseline the review save action is disabled |
| Training gate | Disabled while baseline evidence and accuracy review are incomplete |
| Final route check after baseline field rename | Draft TeamVersion loaded on port `4202`; accuracy form present, training disabled, 390px body had no overflow, and no browser errors |
| Team card action right edge | 365px, card right edge 378px |
| Document body width | 390px; no horizontal overflow |
| Browser console/page errors | None observed |

## Evidence inspection follow-up

- After the review form was tightened, each passed Sandbox baseline is rendered with direct links to
  the Simulation run and its Evidence directory. The reviewer can inspect role outputs, handoffs,
  events, and persisted files before selecting the evidence checkbox.
- The form displays the current TeamVersion `teamCoreDigest` so the reviewer can distinguish a run
  from the exact immutable team content under review.
- A local Playwright pass on the current service at port `4173` used the draft
  `v2-uat-draft-initializer-validation-2026-11-21-9334be89` at 1440 x 900, 768 x 1024, and 390 x
  844. All three routes returned HTTP 200; the review panel was present, training stayed disabled,
  body width equaled viewport width, and no console or page errors were reported.
- The same mobile pass found six TeamVersion/example cards. Every visible action's right edge was
  inside its card right edge (`378px`), with body width `390px`; no console or page errors occurred.
- The legacy `/release` URL returned HTTP 404 in each viewport. The 404 is an intentional route
  boundary check, not a failure of the `/train` page.

This follow-up does not close the team accuracy gate: the provider/model channel was unavailable, so
no Sandbox Simulation ID was available to review. A responsible workflow operator and product owner
must inspect the TeamVersion against the target task, attach each completed baseline Simulation ID,
and sign the applicable UAT scenario before acceptance.
