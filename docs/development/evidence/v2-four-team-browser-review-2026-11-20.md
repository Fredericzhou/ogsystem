# V2 Four-Team Browser Review

Evidence type: authorized browser-simulated workflow-operator read-only review of the formal
Project Run pages. This review does not provide product-owner acceptance or close UAT Scenario 18.

## Execution

- Date: 2026-11-20 (Asia/Shanghai)
- Application: running Team Site at `http://127.0.0.1:4173`
- Browser: Playwright Chromium, headless, viewport 1440x1000, device scale factor 1
- Action: opened each recorded formal Project Run through its Project page and checked the selected
  Run summary, event list, published Release, and the matching Project/Task/Run/Release API records.
- Result: all four Task and Run reads returned HTTP 200; all four Tasks and Runs were `completed`;
  all four Releases were `published`; screenshots have no browser page errors.

## Project and Release Records

| Team | Project / TeamVersion | Task / Run | Release | Release commit | Manifest digest | Output digest |
| --- | --- | --- | --- | --- | --- | --- |
| Management consulting | `v2-formal-management-consulting-20261119-78d35786` / `new-team-1bd7e229` | `20261119-093300-e3fd2cf9` / `20261119-093344-c9ee996e` | `release-20261119-093344-c9ee996e` | `6774ca3a7a8d741572912f24f7683f33186ac77f` | `sha256:9da25ae015202664eef1c0097a7bba7a3f2ab0905bf1320a57759849b25f3175` | `sha256:e4439919ddb26611f061cd3c78b0131e45355b996fdb26e47872d794471dd475` |
| Structured debate | `v2-uat-structured-debate-1795057638883-d38a811b` / `new-team-0b2feb81` | `20261119-110721-fd7ec183` / `20261119-110752-a8fabc5d` | `release-20261119-110752-a8fabc5d` | `304a42b702aaa7eface8b3d7e4f3e588dd36e6d0` | `sha256:83e370c3a904d204d33774d3f368b8c4d9c8308c331dc287169f75713a86832` | `sha256:0faf9b92e1b1c384fd323d4116e33c1b29b40a5fa6e41e0030f37e34cc3ab2ca` |
| Cross-Backend review | `v2-formal-cross-backend-fixed2-mwmxgszv-6ac9440c` / `new-team-16ecab51` | `20261119-102515-00e92ec2` / `20261119-102515-dc926bb5` | `release-20261119-102515-dc926bb5` | `5bdec59303ab20aa33d8caeaf9de315c3c3c02d5` | `sha256:5b2c533dfeff31b907f7e24f2f6c9d1ad61790e40f9deec34193cfb70f50121b` | `sha256:6e174d12318a96321bae92cc13191c341e8480893a91b2f3b9ea8a28f61ae4d1` |
| Software | `v2-formal-software-uat-20261119-21e3cdd3` / `new-team-6258e432` | `20261119-084808-b24517ed` / `20261119-084816-966ecb55` | `release-20261119-084816-966ecb55` | `bb4dc4b0ac6418920131057e4ae552546ede88bc` | `sha256:3d3e760101b82f5fcb6ede64c0660c45a7de8fc3559b5e1a54f6fbf136a7d619` | `sha256:6951bfaedd54a39988ecb1f379e0473690fabaf6ab057a25ee3227cca4ef630d` |

The structured-debate Project also has a second published Run, `20261119-111908-9ba238d1`,
which carries the PNG fixture as a verified Git LFS materialization. Its identity and digest are
recorded in [`v2-formal-structured-debate-collaboration-project-release-2026-11-19.md`](v2-formal-structured-debate-collaboration-project-release-2026-11-19.md).

## Review Findings

- The management-consulting final Role summary says only 3/4 source analyses arrived and says it
  could not verify a Project Workspace Release. The Task is completed and the API/UI show a
  published Release. The business result therefore needs a human content review against its
  Runtime and Release evidence.
- The structured-debate final Role summary says the branch/quorum path and binary fixture could not
  be verified, while its Run events include `join_activated`, and the same Project has a published
  PNG Git LFS companion Release. The product owner must resolve this result/evidence discrepancy.
- The cross-Backend final Role summary says no Workspace commit or Markdown handoff was available,
  while the formal Run ledger records a Planner `WorkspaceRef`, a final merge commit, and a published
  Markdown Release. Its business handoff is not accepted until reviewed against those records.
- The software output explicitly describes a delivery plan and says implementation and deployment
  are not complete. It does not satisfy the software implementation workflow on its own.

These mismatches block Scenario 18. `completed` and `published` prove runtime lifecycle outcomes;
they do not prove that each team delivered content meeting the acceptance criteria. Workflow-operator
review is recorded here; product-owner acceptance remains pending. No scenario status is changed to
`Pass` by this review.

## Browser Captures

- Management consulting: [`screenshots/v2-four-team-run-browser-2026-11-20-management-consulting.png`](screenshots/v2-four-team-run-browser-2026-11-20-management-consulting.png), SHA-256 `e4f59ff9230c72657885dd046f59313ea360d83498b180ee7d80549da0627236`
- Structured debate: [`screenshots/v2-four-team-run-browser-2026-11-20-structured-debate.png`](screenshots/v2-four-team-run-browser-2026-11-20-structured-debate.png), SHA-256 `3615f2850a9488502e8d8bc7c36f849f6d1cd8efde709e125093c21e6ba1c4a6`
- Cross-Backend review: [`screenshots/v2-four-team-run-browser-2026-11-20-cross-backend.png`](screenshots/v2-four-team-run-browser-2026-11-20-cross-backend.png), SHA-256 `6b52e8e3833cbd5ea30919816cbf657ebc4001884c9bb17cdf728b5152521031`
- Software: [`screenshots/v2-four-team-run-browser-2026-11-20-software.png`](screenshots/v2-four-team-run-browser-2026-11-20-software.png), SHA-256 `6906d48748d0c6496e902b57362bb797e4b23f82478267ccda108b3e1232c760`
