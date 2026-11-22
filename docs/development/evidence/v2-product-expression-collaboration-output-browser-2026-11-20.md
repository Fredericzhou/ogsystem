# V2 Product Expression and Collaboration Output Browser Check

## Scope

- Executor: Codex acting as workflow operator in Orca and Playwright.
- Date: 2026-11-20.
- Team Site: `http://127.0.0.1:4173` using the managed local service and current working tree.
- Project: `v2-uat-scenario-1-2026-11-19-ec97bcb6`.
- Task: `20261119-200714-f5ba5344`.
- Run: `20261119-220045-b5a5cac7`.

## Browser path and results

The pre-existing Project tab initially showed stale page content. Reloading it showed the current
Project language: `协作产物`, with a description that assigns run process, Role outputs, and review
records to their Task Run. The Project had no `已发布成果` heading. The Run-owned output appeared
in the Project's collaboration output list and beside its Task summary.

The first API request to `/api/v2/projects/{projectId}/collaboration-outputs` returned `404` because
the managed Team Site process had been started before the current route was added. The repository's
Team Site service restart completed its normal asset build and loaded the current route. The same
request then returned `200` with the output for Task `20261119-200714-f5ba5344` and Run
`20261119-220045-b5a5cac7`. A Project with no outputs returned `200` and an empty list.

In Orca, the workflow operator opened `查看产物`; the dialog displayed Run `20261119-220045-b5a5cac7`
and the `.gitattributes` file content. The capture is
[`v2-product-expression-collaboration-output-orca-2026-11-20.png`](screenshots/v2-product-expression-collaboration-output-orca-2026-11-20.png),
SHA-256 `fe0adc3a64fb0abcc2e3493e0557951de5cb85e31cac4584846254a41875afc3`.

A targeted Playwright check confirmed the collaboration output link is present before and after a
page refresh at 375px. At viewport widths 1440, 1024, 768, 390, and 375px, both document and body
scroll widths matched the viewport. The output dialog opened and showed file content. There were no
browser console errors, page errors, or HTTP responses at status 400 or higher after the service
restart.

## Acceptance boundary

This closes the live product-expression and Task-owned output UI check for this Project. It does not
sign off the historical software delivery content, the other UAT scenarios, or product-owner and
accessibility acceptance. The relevant UAT statuses remain unchanged.
