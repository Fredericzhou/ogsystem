# V2 Project Creation Readiness UX Follow-up

Evidence type: browser-based engineering regression. This record does not close a UAT scenario.

## Finding

When creating a project from an empty directory, the create action returned after the Project API
request while Project, Workbench, and Studio graph refresh continued in a detached background task.
The lifecycle tab could become available before the graph was ready, so a fast switch to Design
showed the stale empty-directory message.

## Change and Verification

- Project creation now waits for Project and Workbench reload, Run listing, and Studio graph
  readiness before completing the action state. A refresh failure leaves the created Project usable
  and displays the existing refresh warning.
- The focused Playwright cases passed: empty-directory creation produced the expected graph before
  the create action completed; the fan-out connection case also passed on repeat without a graph
  code change.
- Full browser regression passed on 2026-11-20: Studio graph/workflow 17 passed, 2 deployment-only
  tests skipped; Build layout 4 passed.
- Full `pnpm test` passed, including 78/78 Team Site tests; package-install smoke passed through
  both pnpm and npm; `pnpm run test:docs-command-drift` and `git diff --check` passed.

This is engineering evidence for Scenario 9 only. Desktop/mobile operator-flow review, a real pending
Review state, recording, issue disposition, and workflow-operator sign-off remain required.
