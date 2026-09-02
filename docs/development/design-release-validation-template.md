# Design Release Validation Template

Use this template for any release or merge that changes:

- `src/visualizer/client-app.ts`
- `src/visualizer/studio-client/*`
- design-page layout, tabs, debug flow, or graph authoring behavior
- starter templates that are taught through the Design page

This is a reusable template. For a dated execution record, copy it to a dated checklist file and fill in the results.

## Metadata

- Date:
- Branch:
- Commit range:
- Operator:
- Scope summary:
- Risk level: `low | medium | high`

## 1. Automated Gate

Run in this order:

```bash
pnpm run test:visualizer
node --test tests/cli-lifecycle.test.mjs
```

Record:

- `pnpm run test:visualizer`:
- `node --test tests/cli-lifecycle.test.mjs`:
- Extra targeted tests:

Pass criteria:

- No failing visualizer tests
- No failing CLI lifecycle tests
- No new flaky behavior across reruns for touched surfaces

## 2. Design Shell Baseline

Check:

1. Open `Design`.
2. Confirm the graph workspace renders without lower blank whitespace.
3. Confirm the default right-side tab shows `检索 / Browse`.
4. Switch `检索 -> 图编排/选择 -> 调试 -> 日志 -> 结果`.

Pass criteria:

- No dead area between shell body and card boundary
- No full-page flash during tab switching
- No panel overlap or clipped content

Result:

- Pass / Fail:
- Notes:

## 3. Quick Debug Workflow

Check:

1. Trigger graph-toolbar `快捷调试 / Quick debug`.
2. Enter run input and confirm.
3. Verify the modal closes after launch succeeds.
4. Verify the right-side surface stays usable for rerun.
5. Run again from the debug tab input.

Pass criteria:

- Modal closes after successful launch preparation
- Debug input remains editable after first run
- Rerun works without leaving Design

Result:

- Pass / Fail:
- Notes:

## 4. Selection And Editing Stability

Check:

1. Select a role.
2. Edit role title continuously.
3. Change `binding kind`, then switch back.
4. Select a flow and edit label / event metadata.

Pass criteria:

- Title input does not lose caret while typing
- Save / Revert enable correctly
- Structural field refreshes do not corrupt current draft
- Switching role/flow still honors dirty-state guards

Result:

- Pass / Fail:
- Notes:

## 5. Layout Switching

Check:

1. Click `切换布局 / Switch layout` repeatedly.
2. Confirm modes cycle through:
   - `流向布局 / Flow`
   - `紧凑布局 / Compact`
   - `纵向布局 / Stacked`
3. Validate readability after each switch on both narrow and wide workspace widths.

Pass criteria:

- Layout visibly changes
- Nodes and edges stay readable
- No overlap regression
- Graph remains interactive after each switch

Result:

- Pass / Fail:
- Notes:

## 6. Responsive Workbench

Check:

1. Resize the inspector / workbench split.
2. Verify graph width updates in place.
3. Verify narrow mode still keeps graph readable and tabs usable.

Pass criteria:

- No canvas flash on resize
- Graph uses available space cleanly
- Inspector and graph remain operable

Result:

- Pass / Fail:
- Notes:

## 7. Advanced Template End-To-End

Check:

1. Create a project with template `advanced-features`.
2. Start a run.
3. Confirm first pass stops at human review.
4. Issue `rework`.
5. Resume and confirm flow returns to `advanced-coordinator`.
6. Approve the next review.
7. Resume and confirm final completion.

Pass criteria:

- Template demonstrates split + join + human review + explicit rework loop
- First run pauses for review instead of failing
- Rework path is visible and resumable
- Final approval path completes successfully

Result:

- Pass / Fail:
- Notes:

## 8. Template Readability

Check:

1. Open the advanced template in Design.
2. Confirm the rework loop is visible on the graph.
3. Confirm `advanced-reviewer` supports `REVIEW_READY` and `REWORK`.

Pass criteria:

- The template is teachable to a new user
- Loop capability is visible without breaking first-run UX

Result:

- Pass / Fail:
- Notes:

## 9. Release Decision

- Ready to merge / release:
- Blockers:
- Follow-up issues:
- Owner:
