# Scenario 10 Graph Editor Engineering Evidence

Status: engineering evidence only. This record does not change UAT Scenario 10 from Blocked.

On 2026-11-21, the browser workflow operator opened the isolated draft TeamVersion
`v2-uat-scenario-10-graph-editor-2026-11-21-6efe75a9` in the Team Site at
`/studio/teams/v2-uat-scenario-10-graph-editor-2026-11-21-6efe75a9/design`.

The graph rendered through the X6 canvas with `开始 -> 流程负责人 -> 结束`. Selecting the first
edge opened its relationship editor, which showed the saved endpoints `开始 -> 流程负责人`,
structure event `开始`, and display name `任务分发`. The graph was refreshed; the same edge and
endpoints remained present and selectable afterward. The page showed localized `开始` and `结束`
node labels. The Team configuration side panel exposed the `全局` tab and its Global configuration
form; it remained in the Team configuration panel rather than becoming a graph node or edge.

An exploratory edit added a Team role from the installed Technical Writer package, then dragged an
X6 connection from the Start port to that role's input port. X6 accepted the connection and opened
the relationship editor showing `开始 -> Scenario 10 Reviewer`. Saving first failed with
`TEAM_HANDOFF_MODE_REQUIRED` while Global flow mode was disabled. After selecting `transition`,
the save API still returned HTTP 400 with design validation errors: missing/non-integer revision,
missing `system.systemId`, unresolved Start/business-role-to-End connectivity, and inconsistent
`owner` Seat/role-package/Harness bindings. The connection was therefore not persisted. A separate
attempt with a newly-created custom role was rejected because its role package file did not exist;
that unsaved role was removed. The page's browser console remained empty.

Before the exploratory edit, the save control reported `没有待保存的修改`, so that check verified
persisted readback. Screenshots record the refreshed canvas and relationship editor, Global
configuration in Team assets, the unobstructed graph, and the unsaved X6 connection with validation
errors:

- `evidence/screenshots/v2-uat-scenario-10-graph-editor-2026-11-21.png`
- `evidence/screenshots/v2-uat-scenario-10-global-panel-2026-11-21.png`
- `evidence/screenshots/v2-uat-scenario-10-graph-canvas-2026-11-21.png`
- `evidence/screenshots/v2-uat-scenario-10-x6-save-blocked-2026-11-21.png`

## Follow-up: V2 Role Import and Saved Graph Readback

On 2026-11-21, the browser operator used the role-source conversion endpoint for the indexed
Anthropologist source role and confirmed HTTP 200. The converted package had
`ogsContractVersion=2` and `schemaVersion=2`, with no `contractVersion`, `outputs.events`, or
`constraints.allowedTools`. Studio then imported the role, connected X6 ports, and saved
`Start -> Anthropologist -> owner -> End`; the save endpoint returned HTTP 200. After page refresh,
the Studio graph retained the Anthropologist label and all three relationships. The design API
readback returned the same role title and source/target endpoints. The persisted `role.json` was
also checked for the V2 fields and absence of legacy fields. Screenshot SHA-256:
`45c06250a637b53315c0e862b20bc28c653b9097d5add62d554a977f0f909a95`.

The AI Builder request in this session returned `TEAM_ASSISTANT_UNAVAILABLE: fetch failed` because
the configured Visualizer endpoint was unreachable, so the operator used the manual role-library
and graph controls. This is an isolated draft-initializer validation, not the designated Scenario
10 TeamVersion. The earlier Global-panel capture remains evidence for the designated draft, but this
follow-up does not replace the required persisted X6 edit and complete interaction recording on that
TeamVersion, content review, or Product Owner sign-off. The engineering defect and its targeted
regression tests are recorded in the current implementation changes; Scenario 10 remains Blocked.

This follow-up does not cover a successful persisted graph editing session on the designated
Scenario 10 TeamVersion, review of its saved Flow by the Product Owner, or Product Owner sign-off.
The current design-validation blockers and those human requirements keep Scenario 10 Blocked.
