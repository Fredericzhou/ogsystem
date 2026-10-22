# OGS Studio / Projects Test and UAT Report

Date: 2026-10-22
Scope: Studio and Projects dual-workbench boundaries, Project Run and Studio Simulation isolation, Task lifecycle, Deliverables, browser flows, and persistence.

## Latest Final Verification 2026-10-22

This update supersedes all older test counts, service addresses, and UAT conclusions below where the same checks were rerun. Historical failures are retained as evidence and are not counted as successful attempts.

### Automated Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Repository `pnpm test` | PASS, 667/667 | Exit code 0; includes Studio graph typecheck, TypeScript build, browser bundles, root `tests/*.mjs`, and Windows PowerShell/CMD lifecycle smoke. This script does not include the separate Team Site suite below. Duration: 608,775 ms. |
| Team Site serial suite | PASS, 366/366 | `node --test --test-concurrency=1 apps/team-site/tests/*.test.mjs`; 342 top-level tests plus 24 nested cases, including Studio settings, role asset save, Project lifecycle, path security, and browser flows. Duration: 304,746 ms. |
| Team Site visual acceptance | PASS, 1/1 in serial suite and focused rerun | Studio/Projects routes, Team creation, graph layout, themes, Project task flow, and repository export passed. Test fixture setup no longer invokes a real model-backed Team release. |
| Post-restart page and viewport smoke | PASS, 12/12 route/viewport pairs | The restarted `14308` service returned HTTP 200 for Projects, Studio repository, and Studio team creation at 1440/1024/768/390px. No horizontal overflow or browser page errors. This check exposed and verified the fix for a 5px Studio repository overflow at 768px by switching the card grid to two columns below 900px. |
| Studio new-role save flow | PASS, 1/1 focused and in full suite | A new role and its `agent.md`, `prompt.md`, `role.json`, and `output.schema.json` were saved together; the browser test waits for both asset and design writes before reading persisted state. |
| Studio professional settings matrix | PASS, 1/1 focused and in full suite | Browser assertions now include quorum Join mode/minimum, Review timeout/action/rework target/rework limit/branch termination, the role's required review control actions, Flow contract violation policy, model and CLI bindings, and persisted API readback. This is expanded coverage; it does not yet cover every field combination or a full manual release flow. |
| Team Site result history assertion | PASS, 1/1 focused and in full suite | The browser test locates the full-result section by its content rather than depending on an optional summary section's array position. |

The Studio team-creation browser state is retained at [studio-team-create-2026-10-22.png](evidence/studio-team-create-2026-10-22.png); it is visual evidence only and does not imply manual accessibility sign-off.

The initial Team Site run had two browser-test failures: one selected the wrong optional result block; the other read persisted design before the asynchronous design PUT had completed. The test synchronization and locators were corrected; no product behavior or server validation was weakened. Both focused cases and the complete Team Site suite then passed.

The latest serial rerun exposed that the visual acceptance test provisioned classic teams through the production release endpoint, which correctly required a real Sandbox baseline and timed out without deterministic provider behavior. The test now seeds released TeamVersions through the test-only lifecycle fixture; the Project browser flow remains in the test. The focused visual test passed 1/1 in 30.6 seconds and the full Team Site suite passed 366/366.

### Real Studio-to-Projects UAT

The UAT service used `http://127.0.0.1:14308` with the isolated data root `%TEMP%/ogs-opencode-release-uat-20261022`. This root was retained and the service was restarted after the final test run using the same root.

- TeamVersion `uat-2026-10-22-585ee2b3` (Team `new-team-82fe125b`) was published and mounted in Collaboration Project `opencode-release-flow-verification-project-8d143013`.
- Project Task `20261022-065920-b474cd87` used the attached product brief and ran with the real OpenCode Sandbox adapter. Attempt 1 (`20261022-065928-10229f71`) failed after the 120-second provider timeout and remained queryable as a failed attempt. Retry attempt 2 (`20261022-070220-09d71638`) completed. All five roles completed; the run used parallel planner branches and a Join synthesis. There were no failed/noop role executions in the accepted attempt.
- The retry owner tuple matched Project, Task, task number, Run, attempt 2, TeamVersion, and TeamVersion digest. Its material policy referenced attempt 1's immutable snapshot. Project material, retry snapshot bytes, and Run Plan hash all equal `efc8f714141002960d4fbbe252b0fef1e31d80fdaecb0fcb3bc84bf9bdf4c0a4`.
- The generated plan was opened and checked for the requested user flow, backend/data plan, quality checks, security risks, unresolved decisions, and the brief's explicit exclusions.
- Deliverable `fa91358b-fa65-4096-96a6-9acca75c23b5` (attempt 2) was reopened from the Project page after service restart. Its file SHA-256, metadata digest, and index digest all equal `c5f65625af341b1ef59910232ab39173bd27bf9b67d150337c6bd6fbc40720ff`. A repeated archive had previously returned the same Deliverable ID idempotently.
- Classic-team Sandbox baseline evidence is retained for the software team (`e094d4cc-3700-4b16-8918-c10ab821b9e3`), expert consultation (`9e1ea2b0-0de5-406a-955c-2bedb2f0fab5`), and structured debate (`19ba2f12-a777-4a5f-b004-e96923786a78`, `b2866fd8-aadb-4a5f-b004-e96923786a78`). Separate exploratory baseline attempts remain failed because their generated output did not match the saved baseline schema; they are not counted as accepted evidence.

### Classic Team Project UAT

Three additional Projects were created against the three released built-in classic TeamVersions. Each used a real OpenCode Sandbox Task with Project-owned material and a separate Deliverable. These runs validate the Project consumer flow for all classic teams; they do not prove Human Review, because none of these published classic TeamVersions declares a runtime Human Review policy.

| Classic TeamVersion | Project / Task / Run | Result and archived Deliverable |
| --- | --- | --- |
| Software development `new-team-82fe125b` | Project `classic-software-team-project-uat-2026-10-22-14adb42b`; Task `20261022-075156-9b9b5f0e`; Run `20261022-075210-08c62387` | Sandbox completed with all five roles completed, including the parallel planner branches and Join synthesis. Deliverable `846178ca-c386-4ef8-a120-890ecbc911cb`; digest `8648dde97fd43008d5764d49a19e03a9acad89c2e8552720623d9ac0d2065162`. |
| Expert consultation `new-team-fb816d00` | Project `classic-expert-consultation-project-uat-2026-10--0c9846b1`; Task `20261022-075425-e3db83c6`; Run `20261022-075425-ada7f816` | Sandbox completed with the expert roles and synthesis. The prompt/material were explicitly synthetic; output identified uncertainty, red flags, and professional evaluation rather than asserting a diagnosis. Deliverable `b49208bd-8e7e-496b-9d0e-4f0a3a0b940d`; digest `433e9949a562d1360766ba5aa95c9928bd0805d5bfb238b16b1ac2a3df44e725`. |
| Structured debate `new-team-9041a384` | Project `classic-structured-debate-project-uat-2026-10-22-a16209e2`; Task `20261022-075549-f92028d5`; Run `20261022-075549-e6b70935` | Sandbox completed with balanced arguments, uncertainties, measures, and a reversible pilot. Deliverable `e4924d8b-a0be-4fb7-960e-75eba3ef76a1`; digest `1dea455391a452a8cb04f7b664e546be4ca7f8f4be72a8dd704407930bcefd06`. |

For all three runs, the persisted `runKind` was `project_task`; owner Project, Task, TeamVersion, attempt 1, and TeamVersion digest matched the corresponding Project records. The Run Plan material snapshot SHA-256 matched the original Project material SHA-256 for each case. Run evidence exists under each owning Project's `.ogs/runs/<runId>` path, while the corresponding TeamVersion `.ogs/runs/<runId>` path does not exist. Each Deliverable's opened UI content exactly matched both the Run result API and Deliverable content API.

Playwright Chromium opened all three Project pages and Deliverables. At 1440px and 390px, each page had no horizontal overflow and no page errors. The first viewport pass exposed a desktop overflow defect: a root `<pre class="task-run-output">` did not receive the nested-pre wrapping rule. The selector now wraps and constrains that root element; all three cases then passed at both widths.

### Isolation and Restart Verification

- The Project contains one business Task and two Project Run attempts. Both Run owners point to the Project/Task/TeamVersion tuple and both Run directories are under that Project's `.ogs/runs` namespace.
- The published TeamVersion has no `.ogs/runs` evidence for this Project Task. Studio evidence is stored under `.studio/simulations/<teamVersionId>`; the Project has no Studio Simulation namespace and its Task/Recent Run/Deliverable collections contain no Simulation records.
- Material snapshots and archived Deliverables remain Project-owned. The three classic Task snapshots each match their source material hash. Simulation history remains TeamVersion-owned. The two product lifecycles share the Runtime implementation but not their persisted records or storage paths.
- After restart, `/api/v1/projects/<projectId>` returned the mounted TeamVersion, completed Task, both attempts, and material summary. Playwright Chromium verified `/` redirects to `/projects`, the Studio design graph mounts with seven nodes, Simulation history loads, the Project shows its completed Task, and the archived snapshot opens with 945 characters of content. Checks at 1440px and 390px had no horizontal overflow or page errors.
- The service was restarted after final verification at `http://127.0.0.1:14308` (PID 20704) against the retained isolated UAT root `%TEMP%/ogs-opencode-release-uat-20261022`; `GET /api/v1/platform/models` returned HTTP 200 after restart.

### Remaining Release Acceptance

**Release acceptance remains blocked.** The code suites and the accepted OpenCode Project happy path pass, but these items are not signed off:

- A real Project Sandbox Human Review flow covering approval, rework, and branch-scoped termination, including reviewer ownership and duplicate/stale request handling. Automated lifecycle and security tests pass, but the accepted OpenCode Task did not encounter a Review node.
- The complete Studio Professional editor field matrix and a full manual design-to-release-to-mount workflow. Current browser tests cover selected bindings, Context Map, role assets, contracts, schema, new-role same-save, and failure recovery; they do not cover every field/control combination.
- Conditional Flow editing for a new TeamVersion is implemented: Studio authoring generates the missing TeamVersion-owned Semantic IR specification and compiles it during save. Automated regressions cover saving/reloading a conditional route and creating the missing Semantic IR files. A complete manual Studio design-to-release-to-mount acceptance is still open and is tracked separately below.
- Native-device keyboard and screen-reader acceptance. Automated Playwright viewports and focus checks are not a substitute. Orca could inspect the visible Chrome tree, but the desktop provider returned `window_not_focused` for keyboard activation even after one restore attempt, so no native keyboard or screen-reader result is claimed.

The three classic Project runs expand real consumer-flow evidence but do not close these acceptance items. The API review context for the expert-consultation run was empty; its “reviewer” roles are model roles, not Human Review checkpoints. Do not promote these successful task runs into a claim that every Review, editor, and assistive-technology scenario passed.

## Earlier Final Verification Update 2026-10-22

This section supersedes earlier test counts and UAT conclusions where the same check was rerun against the final code. Earlier entries remain as dated history.

### Structural Findings and Fixes

- Classic TeamVersion forks lost their trusted graph topology after the first edit because later versions use `source=version-edit`. Trust is now inherited only when the persisted control-flow topology digest still matches. Role assets and model bindings can change without losing topology trust; changing roles, edges, dispatch, Join, Loop, or Review semantics invalidates it. A changed topology does not inherit the exception.
- Project confirmation included `.ogs/model-catalog.json`, although that file is an environment discovery cache and the role model binding already belongs to TeamVersion design and `.ogs/model-selection.json`. Refreshing discovery therefore made an otherwise unchanged published version appear stale. The model catalog is now excluded from the stable asset digest; execution configuration and selected bindings remain covered.
- Focused regressions passed for the digest boundary, TeamVersion fork trust inheritance/invalidation, and Project Run ownership: `pnpm build` plus focused tests passed 26/26; the final topology-fork lifecycle test passed 8/8 after its added chain case.

### Final Automated Verification

| Check | Result | Evidence / limits |
| --- | --- | --- |
| `pnpm test` | PASS, 667/667 on 2026-10-22 | Exit code 0 on the current code state. Includes Studio graph type checking, TypeScript build, Studio/Visualizer bundles, the complete repository Node test suite, and Windows PowerShell/CMD lifecycle smoke. |
| Studio / Projects browser UAT | PASS for the recorded scenarios below | Playwright Chromium performed actual UI actions in Studio Release Gate and Projects create/upload/task/archive pages. No page or console errors were observed on the accepted task and archive flows. This is browser-driven UAT, not physical-device or screen-reader sign-off. |
| Project Run owner and evidence | PASS | Accepted Run `20261022-050805-29e39653` is owned by Project `classic-software-uat-project-accepted-3906c944`, Task `20261022-050803-9acb61cd`, TeamVersion `new-team-a78637d0`, attempt 1. Evidence and run files are under that Project's `.ogs/runs` namespace. |
| Material snapshot integrity | PASS | Project source material, Run Plan `inputRefs[0].contentHash`, and the bytes in the Run `inputs/` snapshot all have SHA-256 `9f1a2f25e0d15bc6984a1cf4268a0809b386395faa7adbf514a8a8bc3d6dff4c`. |
| Deliverable integrity and replay | PASS | Deliverable `f03b957c-394a-4c56-9713-9ff0ed80d990` was opened through the Project UI, persisted after page reload, and its content digest matched the index. A repeated archive returned the same ID with `idempotentReplay=true`. |
| Studio / Project data isolation | PASS for the accepted Run | The Project contains one Task and one Run. The accepted business Run does not exist under the TeamVersion `.ogs/runs`; the TeamVersion has no Project Task records. Studio Simulations are separately stored under `.studio/simulations/<teamVersionId>` and do not appear in the Project Task or Deliverable list. |

### Real Studio-to-Projects UAT

The isolated service used `http://127.0.0.1:4228` and `%TEMP%/ogs-release-uat-20261022`; the user's existing port 4173 service and default project data root were not used.

- In Studio, a draft based on the built-in classic `software-team` was forked as TeamVersion `new-team-a78637d0` (version 5). It retained five real model-bound roles: `delivery-coordinator`, `backend-planner`, `experience-planner`, `quality-planner`, and `delivery-lead`.
- The TeamVersion passed Studio release readiness and was released with `teamCoreDigest=ad4b2c1b00636e6e795e8cb2c109d2bfd796febe40d412cf3238539d6fc4b471` and `projectDigest=0320ec4bd60a6335ede722806cd230988c60109b4f5ee39c4f0b22960a4fff52`.
- In Projects, a new Collaboration Project was created and the product brief was uploaded from the page. Static readiness passed. A Task was queued and started in `mode=sandbox` from the Project UI.
- The real Codex Sandbox Task completed successfully. All five expected role states were `completed`; the coordinator dispatched parallel backend, experience, and quality work, and the delivery lead completed the Join synthesis. The output explicitly excludes unrequested bank, tax, and currency-conversion features and records unresolved decisions.
- The Run owner is `runKind=project_task` and the Project/Task/Run/attempt/TeamVersion/digest tuple matches persisted Project data. Role evidence, plan, events, state, and result are readable from the Project-scoped API.
- The result was archived from the Project page as a Deliverable and verified after reload. Its digest is `789a22e8b70fa13d2048ca66e632ab2f92dd953f56371a3d0904dc7e8f652d02`.
- Studio and Project records remained separate: Studio Simulation history is in the Studio namespace; the TeamVersion has no Project Run; the Project's Task list contains only the business Task; the Deliverable is under Project workspace storage.

### Rejected Attempts and Limits

- The first TeamVersion created before the stable-digest fix remained rejected with `PROJECT_CONFIRMATION_STALE` after model discovery refreshed. This was correct fail-closed behavior for a version confirmed under the old digest algorithm. No compatibility migration was performed. A fresh TeamVersion and Project under the current digest contract completed successfully.
- A first release attempt on an edited classic topology was rejected as linear-only because classic topology trust was lost across version edits. The topology-fingerprint inheritance fix preserves the exemption only when the current graph fingerprint matches the trusted one. The exact cross-version case is covered by focused unit tests; the successful final UAT used the corrected lineage and a fresh TeamVersion.
- Historical note: the 664/664 run preceded the topology-fork propagation fix. This was superseded by the current 667/667 full-suite run recorded above.
- This UAT validates Codex Sandbox execution. OpenCode-backed Project Task completion, live Project Human Review approval/rework/branch termination, physical-device keyboard testing, and screen-reader testing remain unaccepted. Existing automated review lifecycle and browser tests pass, but they do not substitute for those live/manual scenarios.

## Historical Verification Log

### Snapshot 2026-10-21

| Check | Result | Evidence / limits |
| --- | --- | --- |
| `pnpm test` | PASS, 663/663 on 2026-10-22 | Includes Studio graph TypeScript checking, TypeScript build, client bundles, the repository Node test suite, and Windows lifecycle smoke. Completed against the current workspace after the Studio professional-inspector fixture ordering fix. |
| Team Site full serial suite | PASS, 320/320 tests | `node --test --test-concurrency=1 apps/team-site/tests/*.test.mjs` completed in about 244 seconds on 2026-10-21 after the Studio save-flow changes. The classic team browser flow, Professional inspector edits and failure handling, recovery fault injection, Project Run isolation, Simulation persistence, and evidence-path security tests passed. |
| Team / Project API boundary | PASS for Team reads, metadata, and design; Project APIs remain responsible for Project data | Studio reads and updates TeamVersion metadata through `/api/v1/team-versions/:id`, and reads, saves, validates, and edits design assets through `/api/v1/team-versions/:id/design...`. Project APIs continue to own collaboration-project data and TeamVersion attachment membership (for example `/api/v1/projects/:id/teams`). The Project metadata PATCH route rejects Team records. Covered by Team route, use-case, and Project route tests. |
| Studio Professional property inspector | Focused browser acceptance PASS; full manual UAT not signed off | Browser acceptance edits and reloads model binding, Context Map, `prompt.md`, Flow Contract, and JSON Schema using actual browser input. Layout checks cover 1440, 1024, 768, and 390 CSS pixels. The focused test passed on 2026-10-22 after correcting its selection order. This does not cover every editor field or the complete publish lifecycle. |
| Studio design and asset save failure semantics | PASS for new-role ownership and explicit partial status | Asset validation uses the submitted draft role set, including newly added roles. UI writes assets before design validation/persistence because design compilation consumes contract files. If asset writing fails, it reports that design was not saved and asset files may be partial; if design validation or persistence fails after assets are written, it reports the saved assets, incomplete design save, and possibility of partial draft files. Both cases remain retryable. Design and multi-file asset writes are not one filesystem transaction. |
| Project-to-Studio browser flow | PASS | Adjustment, Studio release, simulated mount failure, retry, and Project remount passed in `classic-team-flow.test.mjs` as part of the full Team Site suite. |
| Isolated live HTTP smoke | PASS | Team Site started at `http://127.0.0.1:4191` with a temporary projects root. Team Factory created a draft, TeamVersion GET/PATCH read and saved metadata, and Project PATCH against that TeamVersion returned 404. |
| Run reservation recovery fault injection | PASS, 2/2 on focused rerun | The two cases that had timed out during Team Site startup passed after increasing the helper's startup allowance. |
| Studio import guardrail | PASS, 1/1 | `pnpm test:studio-import-guardrails`, rerun during this report refresh. |
| Docs command drift | PASS | `pnpm test:docs-command-drift`, rerun during this report refresh. |

The Team Site UAT helpers wait up to 45 seconds for service startup and terminate the service process they spawned when readiness times out. The full Team Site suite passed in this refresh, including the Project-to-Studio adjustment, Studio release, failed-mount recovery, and remount browser flow. The suite reports 314 tests (293 top-level subtests); the 21 nested cases are included in the test total.

### Previous Recorded Automated Results

The Team Site full-suite result above is retained as a focused validation run. The repository `pnpm test` result below is the latest full validation and supersedes the earlier count/date.

### Intermediate Verification 2026-10-22

- Fixed the Studio professional-inspector browser fixture so the `prompt.md` edit is made while `backend-planner` is selected, before switching roles to test route order.
- `node --test --test-name-pattern="Studio professional inspector" apps/team-site/tests/product-logic-acceptance.test.mjs` passed 1/1.
- `pnpm test` passed 663/663 with exit code 0. Build, Studio graph typecheck, TypeScript build, Studio and Visualizer bundles, all repository Node tests, and Windows lifecycle smoke passed. Duration was about 583 seconds.
- Team Site was restarted with the existing persistent data root `C:\Users\zhouf\.ogsystem\projects-20261021-latest`; no project data was removed or migrated. Smoke checks returned HTTP 200 for `/`, `/projects`, `/studio`, `/studio/roles`, `/platform/models`, `/platform/data`, `/platform/tools`, `/platform/storage`, and `/api/v1/projects`.
- Playwright against the restarted service confirmed `/` navigates to `/projects`, the product title and all 9 primary navigation links render, and there are no browser page errors or console errors at 1440x960.
- The full test result verifies automated behavior only. It does not change the recorded outcome of the real OpenCode Project Task, which timed out, nor does it supply missing real Sandbox Review or signed manual lifecycle UAT evidence.

### Historical UAT Log

#### Previously Recorded Successful Scenarios

The implementation record reports these UAT scenarios as completed using the isolated data root `%TEMP%/ogs-isolation-final-uat-20261021` and Team Site URL `http://127.0.0.1:4190`:

- Codex App Server Sandbox Project Task completed with five roles. The Task and Run owner identified the Collaboration Project, Task, and fixed TeamVersion.
- Project Materials source digest matched the copied Run input snapshot digest. Project Run evidence remained under the Project namespace; the TeamVersion had no Run evidence writes.
- A successful Run was archived as an independent Deliverable snapshot. Repeating the archive returned the same Deliverable ID with `idempotentReplay=true`.
- A Studio Simulation completed with `runKind=studio_simulation` and `mode=dry-run`, persisted seven replay events, and remained absent from Project Tasks, Recent Runs, and Deliverables.
- After restarting the Team Site service, Task, Deliverable, and Simulation history remained readable and Simulation events remained replayable.
- Playwright checks covered product landing/navigation, mode persistence, SPA route cancellation, Studio graph mount/unmount, Simulation history replay, and graph bounds at 1440, 1024, 768, 390, and 320 CSS pixels.

These scenarios are prior recorded UAT results, not rerun in this report refresh. The isolated UAT dataset is retained for audit review; it is not production data.

The current Team Site serial run also executed the Playwright classic-team browser flow successfully, including Team adjustment, Release Gate validation, a simulated mount failure, retry, and final mount verification. This is current automated browser UAT; it does not replace the unexecuted real Harness/Review scenarios below.

The current browser suite also checked the Project landing route and navigation, Team creation and editing, graph visibility at 1440px and 1024px, mobile graph and navigation behavior at 390px and 320px, Release Gate readability, Project Task retry and attempt history, and absence of browser errors or unhandled rejections. The focused Studio Professional inspector browser test covers the graph and inspector at 1440px, 1024px, 768px, and 390px; it edits model binding, Context Map, Prompt, Flow Contract, and Schema, checks assets-before-design request ordering, reloads persisted values, retries an injected asset-write failure, and injects a design-save conflict to confirm accurate partial-state messaging. This is partial automated coverage, not a signed-off complete professional design-to-release UAT.

A prior isolated live-server smoke test created `boundary-verification-team-6b5f8f5f`, read it through `/api/v1/team-versions/:id`, updated its name and overview through PATCH on the same TeamVersion resource, and verified the old Project PATCH surface returned 404. That validation server used port 4191 and a temporary data root; it is not the current local service.

#### Not Accepted / Not Yet Executed

- Studio Professional property editing is implemented; automated browser coverage passes for selected fields, save ordering, reload, and explicit partial failure messaging. The complete field matrix and Studio design-to-release manual UAT remain open.
- The supplemental UAT below attempted a real OpenCode-backed Project Task. OpenCode returned a valid response through a direct SDK probe after removing the inherited Conda `SSL_CERT_FILE`; the Project Task itself timed out in the model-provider stage after 120 seconds. Therefore provider discovery and a direct SDK probe pass, but a real OpenCode Project Task is not accepted. `opencode auth list` reports zero CLI credentials; the selected OpenCode service can still answer the direct probe. Claude and Antigravity do not have configured persistent execution adapters in this product build.
- A real Sandbox Project Task Human Review flow covering approval, rework, and branch termination has not been accepted.
- The focused Project-to-Studio team adjustment and release recovery flow passes. Real Harness-backed Project execution and Project Review acceptance remain open.
- Full manual Studio-to-Projects release, mount, run, review, retry, and Deliverable acceptance has not been recorded.

### Historical Data Isolation Assessment

Automated tests and recorded Codex Sandbox UAT support the following invariants: Project Runs are owned by Project/Task/Run and use Project evidence directories; Studio Simulations use a separate owner, namespace, API, and history; Simulation records do not consume Project execution capacity or appear in business history or Deliverables. The previous UAT also checked a real Project materials digest against its Run snapshot and confirmed Deliverable archive idempotency.

The unexecuted real Harness/Review scenarios and broader manual lifecycle acceptance mean this report does not establish release-level confidence for every product handoff.

### Historical Release Decision

**Not ready for release acceptance.** The Project-to-Studio adjustment browser flow, recorded Team Site and repository suites, Team/Project API ownership checks, and the covered Studio Professional inspector flow pass. TeamVersion reads, metadata, and design belong to TeamVersion routes; Project routes own collaboration-project data and attachment membership. Real OpenCode-backed Project execution, a real Sandbox Project Review workflow, and broader manual Studio-to-Projects lifecycle acceptance remain unaccepted.

### Supplemental Verification 2026-10-21

### Code and Automated Verification

- Studio role asset storage and the property inspector now include all four runtime package files: `agent.md`, `prompt.md`, `role.json`, and `output.schema.json`.
- The focused asset-store and Studio browser suite passed 9/9. It covers repository selection, malformed input and symlink rejection, injected failure after one atomic file publish followed by retry convergence, selected Professional editor fields, and creating a role and saving all four package files in the same save request with readback.
- The complete Team Site suite passed 329/329, including the Studio browser scenarios and the existing Project/Studio adjustment and release-recovery flow.
- `pnpm test` passed 663/663 after removing the stale inherited `SSL_CERT_FILE` environment override. This run includes build, Studio client type checking, Visualizer bundle, runtime, Team Site, browser and Windows lifecycle tests.
- `pnpm run smoke:windows-lifecycle` passed. `pnpm test:studio-import-guardrails` passed 1/1. `pnpm test:docs-command-drift` passed. The Visualizer health/readiness test that failed once during an earlier full run passed on isolated rerun and in the final full run.

The Professional inspector browser coverage remains partial: it does not exercise every field combination, every release-gate branch, or a complete manual design-to-release workflow. All four role package file controls and same-save creation are now covered, but the complete field matrix remains open.

### Real OpenCode Project Attempt

An isolated Team Site server used a temporary projects root under `%TEMP%`; the normal Projects data root was not used. A `software-team` draft was model-bound to the discovered `opencode/beam-free` model, its catalog was refreshed with `ogs project sync-models`, and it was released and mounted to a new Collaboration Project. Readiness passed. A Task was created and started from the Project page in Playwright using `mode=sandbox`.

The first real Task attempt reserved a `project_task` Run and failed after 120 seconds while the `delivery-coordinator` waited on the OpenCode model provider. The Task reached `failed`, Run attempt 1 was retained, and the failure was visible in the Run evidence. A separate direct `executeOpencodeModelRole` probe against the same OpenCode model returned schema-valid JSON, so the remaining failure is specific to the Project Task prompt/runtime path, not model discovery alone. The failed Project Run evidence is retained under `%TEMP%/ogs-opencode-project-uat-3xDoPp` for diagnosis.

Isolation checks on that attempt passed: `run-owner.json` identifies the exact Project, Task, TeamVersion, attempt and TeamVersion digest; the Run files are under `<projectId>/.ogs/runs/<runId>`; the TeamVersion `.ogs/runs` directory is empty; and Project Recent Runs lists the Run as `runKind=project_task`. The Task did not complete, so no Review, retry-success, or Deliverable acceptance was claimed.

### Interaction and Accessibility Boundary

Automated browser coverage ran with Playwright Chromium across the recorded desktop and mobile widths. Orca inspected the visible Chrome window, which was displaying an unrelated external administration page; no controls on that page were changed. Native-device keyboard and screen-reader acceptance was not performed. Playwright keyboard/focus checks do not replace that manual assistive-technology sign-off.

### Current Acceptance

The automatic code suites and Windows lifecycle smoke pass. Studio same-save support for new roles and all four runtime package files passes automated browser coverage. The real Project Run owner and filesystem separation pass for the attempted Run, but its model-provider call timed out; OpenCode Project Task completion, real Sandbox Review decisions, full Studio-to-Projects lifecycle UAT, complete Professional field matrix, and native keyboard/screen-reader acceptance remain unaccepted. **Release acceptance is still blocked.**

| UAT scenario | Result | Evidence or limit |
|---|---|---|
| New Studio role plus `agent.md`, `prompt.md`, `role.json`, and `output.schema.json` saved in one action | PASS | Playwright created the role, saved all four files together, and verified API readback. |
| Multi-file asset write interrupted after a prior file publish, then retried | PASS | Injected publish failure showed partial state; retry converged all target files to the requested contents. |
| Studio Professional property editor | PARTIAL | Selected binding, Context Map, prompt, contract, schema, save/reload, and error paths pass. Complete field matrix and full Release Gate interaction remain open. |
| Real Project Readiness and Sandbox start | PARTIAL | Readiness passed; a `project_task` Run was reserved and started from the Project page. |
| OpenCode-backed Project Task completion | FAIL | The coordinator remained in `model_provider` until the 120-second timeout. No successful Task, Review, or Deliverable was produced. |
| Project Run/TeamVersion data separation | PASS | The retained failed Run has a matching Project/Task/TeamVersion owner and digest under the Project `.ogs/runs` directory; TeamVersion `.ogs/runs` is empty and Recent Runs lists only the Project Run. |
| Project Human Review approve/rework/branch termination | NOT RUN | No real Sandbox Review request was produced in this attempt. |
| Full Studio publish -> Project mount -> Run -> Review -> retry -> Deliverable lifecycle | NOT ACCEPTED | Existing browser tests cover adjustment/release recovery, but the real model-backed lifecycle did not complete. |
| Desktop/mobile browser and keyboard/focus automation | PASS / PARTIAL | Automated Chromium tests cover listed desktop/mobile widths and selected focus/keyboard flows. Native device and assistive technology checks remain open. |
| Windows lifecycle smoke and complete repository regression | PASS | Windows PowerShell/CMD lifecycle smoke passed as part of the final `pnpm test` run, which passed 667/667. |

### Local Service Restart


## Supplemental Fix Verification 2026-10-22

- Baseline Simulation input now accepts the full 4,000-character limit declared by Team Design. Ad hoc Simulation remains limited to 1,200 characters. The regression accepts a required baseline at exactly 4,000 characters and rejects ad hoc and baseline inputs beyond their limits.
- Runtime-backed Simulation evidence now preserves the resolved `backend`, `modelId`, `profileId`, and `toolRef` from each role audit record. A file-store readback test verifies these identifiers survive persistence; command text and credentials are not copied into the new fields.
- New-TeamVersion conditional Flow saves generate missing Semantic IR files and compile the resulting design. Conditional save/reload and missing-file generation regressions passed 2/2; the earlier statement that this path fails with `IR_SEMANTIC_SPEC_REQUIRED` is obsolete. A complete manual Studio design-to-release-to-mount UAT remains open.
- Final automated verification passed: `pnpm test` 667/667, focused Studio Simulation use cases 14/14 (including a follow-up exact-4,000-character boundary run), Runtime Simulation audit identity mapping 1/1, Simulation file-store persistence 7/7, and Semantic IR conditional-route regressions 2/2.
