# Design / Advanced Template Smoke Checklist

Date: 2026-05-15

Scope:
- Design page debug workflow
- X6 graph layout switching
- Advanced project template review / rework loop

## Automated Baseline

Run these before manual smoke:

```bash
pnpm run test:visualizer
node --test tests/cli-lifecycle.test.mjs
```

## Manual Smoke

### 1. Design page initial state

1. Open `Design`.
2. Confirm the graph workspace renders without blank lower whitespace.
3. Confirm the default right-side tab shows `检索 / Browse`.
4. Confirm switching `检索 -> 图编排 / 选择 -> 调试 -> 日志 -> 结果` does not collapse or refresh the whole shell.

Expected:
- No empty dead area between `.body` and `.card span-12`.
- No full-page flash when selecting nodes or flows.

### 2. Quick debug flow

1. In graph toolbar, click `快捷调试 / Quick debug`.
2. Enter a prompt and confirm run.
3. Verify the modal closes immediately after launch succeeds.
4. Verify the right-side surface stays on `调试 / Debug`, not forced back to `日志 / Logs`.
5. Enter a second prompt directly in the debug tab and run again.

Expected:
- Modal closes after successful launch preparation.
- Debug input remains editable after the first run.
- User can rerun without leaving Design.

### 3. Role editing focus stability

1. Select a role.
2. Open the right-side role config editor.
3. Edit the role title continuously.
4. Edit `binding kind` and switch back.

Expected:
- Caret does not jump out while typing title.
- Save / Revert become enabled without tearing down the editor.
- Structural field changes still refresh the correct dependent fields.

### 4. Layout switching

1. Click graph toolbar `切换布局 / Switch layout` repeatedly.
2. Confirm it cycles through:
   - `流向布局 / Flow`
   - `紧凑布局 / Compact`
   - `纵向布局 / Stacked`
3. After each switch, drag-free layout remains readable and graph stays within viewport.

Expected:
- Layout mode changes are visible.
- Nodes do not collapse into overlap.
- Graph remains interactive after each switch.

### 5. Advanced template full chain

1. Create project with template `advanced-features`.
2. Start a run with arbitrary input.
3. Confirm first pass stops at human review instead of failing.
4. Inspect review detail and issue `rework`.
5. Resume the run and confirm flow returns to `advanced-coordinator`.
6. Approve the next review and resume again.

Expected:
- Template demonstrates:
  - parallel split
  - join
  - human review
  - explicit rework loop
- Final resume completes successfully.

### 6. Graph / template readability

1. In the advanced template graph, confirm the rework loop is visible on canvas.
2. Confirm `advanced-reviewer` permits both `REVIEW_READY` and `REWORK`.
3. Confirm the normal default path still prefers `REVIEW_READY`, so first run reaches review pause cleanly.

Expected:
- Template is teachable for new users.
- Loop capability is visible but does not break first-run UX.
