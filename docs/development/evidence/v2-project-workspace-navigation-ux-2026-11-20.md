# V2 Project Workspace Navigation UX Review

Evidence type: browser-based engineering review. This record does not close a UAT scenario.

## Findings and Changes

- At 390 x 844, the Collaboration Project detail root had `overflow: hidden`; its 5,837px content
  could not be reached by normal page scrolling. The root now owns vertical scrolling on mobile.
- The Project detail renderer had no section navigation even though the workspace has distinct
  overview, materials, tasks, teams, and Release areas. A narrow-screen navigation bar now links to
  these sections and stays at the top while the Project scrolls.
- The first navigation spacing made the page 12px wider than the viewport. It was adjusted to stay
  within the 390px content width; the section links can scroll horizontally when needed.

## Browser Review

- Team Site: `http://127.0.0.1:4173`
- Project: `v2-formal-management-consulting-20261119-78d35786`
- Mobile viewport: 390 x 844. Project root width and scroll width both measured 390px. Selecting
  “任务与运行” placed the task panel at the top of the content viewport; “新增任务” remained
  inside its panel.
- Desktop viewport: 1602 x 872 as reported by the embedded browser. On the Project library, the
  first eight visible cards were checked and each “打开项目” and “删除项目” button remained
  inside its card.
- Project detail after browser reload: the completed Run and published Release records remained
  visible. Browser console entries were empty.
- Team Site tests: 78 passed, 0 failed. `git diff --check` passed.

Captures:

- Mobile Project task section: [`screenshots/v2-project-task-section-navigation-mobile-2026-11-20.png`](screenshots/v2-project-task-section-navigation-mobile-2026-11-20.png), SHA-256 `badaa554736d72bacc209b4609099a80024d141a25299bcdc40e4b281a2594b7`.
- Desktop Project library: [`screenshots/v2-project-library-desktop-2026-11-20.png`](screenshots/v2-project-library-desktop-2026-11-20.png), SHA-256 `9c1dca7207159f14e4cf32154ce687bc0f0e8680eba4b731dbc9d1be083b8a87`.
