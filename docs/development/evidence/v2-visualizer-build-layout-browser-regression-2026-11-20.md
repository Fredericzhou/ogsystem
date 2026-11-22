# V2 Studio Build Layout Browser Regression

> Evidence type: engineering browser regression. This does not close Release UAT Scenario 9.

## Execution

- Date: 2026-11-20 (Asia/Shanghai)
- Source: current V2 working tree
- Command: `pnpm run test:visualizer-browser`
- Browser: Playwright Chromium, macOS, one worker
- Build: passed as part of the command

## Results

- Studio graph and workflow suite: 17 passed, 2 deployment-only scenarios skipped.
- Build layout suite: 4 passed, including lifecycle tab alignment at 1100px, 960px, and 720px,
  docked inspector geometry, and narrow mobile usability.
- The desktop Build workspace now keeps 15px of horizontal space inside its outer panel, matching
  the updated desktop baseline while retaining the existing narrow-screen layout.
- The screenshot comparison differed by 225 pixels around native filter/dropdown control edges;
  the threshold is 300 pixels. The canvas, graph, inspector, and toolbar geometry are still checked
  by explicit assertions.
- No Project data was modified by these temporary Visualizer test workspaces.

## Current Source Recheck

- Re-executed on 2026-11-20 against the current working tree with `pnpm run test:visualizer-browser`.
- Build passed; Studio graph/workflow: 17 passed, 2 deployment-only skips; Build layout: 4 passed.
- The skipped cases require the deployed Visualizer UAT environment. The browser suite used temporary
  local workspaces and did not modify Project data.

## Acceptance Limit

This evidence verifies Studio graph authoring and responsive Build layout. It does not provide the
Project operator-flow screenshots for graph, failure location, pending Review, and next lifecycle
action, nor tablet comparison or workflow-operator sign-off. Scenario 9 remains `Blocked`.
