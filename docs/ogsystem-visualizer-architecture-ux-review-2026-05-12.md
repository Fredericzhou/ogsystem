# Visualizer Architecture and UX Review (2026-05-12)

## Scope

This note records the review conclusion for the current `src/visualizer/` implementation, based on direct inspection of:

- `src/visualizer/client-app.ts`
- `src/visualizer/client-renderers.ts`
- `src/visualizer/page-shell-template.ts`
- `src/visualizer/page-shell-styles.ts`
- `src/visualizer/studio-client/studio-graph.ts`
- `src/visualizer/studio-client/studio-graph-render.ts`
- `src/visualizer/studio-client/studio-graph-adapter.ts`
- `src/visualizer/run-graph-projection.ts`
- `src/visualizer/studio-authoring.ts`

The baseline conclusion is:

- The current visualizer is functionally capable.
- The main bottlenecks are now maintainability, graph-model duplication, and interaction complexity.
- The proposed optimization direction is broadly correct.

## Overall Position

I agree with the optimization list in direction and in most of its priority ordering.

The strongest points are:

1. The current front-end assembly model is too monolithic.
2. Studio graph rendering is being protected by manual DOM preservation instead of a clean rendering boundary.
3. Selection and editing flows are too modal and too eager.
4. Build-mode graph and runtime graph are split into different rendering and interaction models.
5. The current graph UI still behaves like a collection of features rather than a stable graph workbench.

The review should now be read with four clarifications:

1. The visualizer is not fully string-rendered end-to-end anymore.
2. The upper graph model layers are mostly necessary; the main redundancy is in render projections.
3. The top-level product shape should converge toward `Design / Run / Release`.
4. Undo consistency and graph-anchored diagnostics deserve explicit priority.

## Points I Agree With

### 1. Giant single-file and string-rendering architecture is the main maintenance cost

This is accurate.

- `src/visualizer/client-app.ts` is the current orchestration center and has grown too large.
- `src/visualizer/client-renderers.ts` and `src/visualizer/page-shell-styles.ts` show the same pressure on rendering and presentation boundaries.
- `src/visualizer/page-shell-template.ts` still mounts a large amount of hidden or mode-dependent structure in one shell.

The current approach was acceptable while the visualizer was proving product shape. It is now a drag on iteration speed.

The wording needs to stay precise, though.

This is not a case where the entire client is still raw string rendering. The more accurate statement is:

- the page shell and main `client-app` path are still assembled as strings and injected by the server
- `buildClientAppScript()` still embeds a large amount of logic and `function.toString()` output
- but `studio-graph.js` is already shipped as a separate static asset

So the next step is not a blanket rewrite. The cleaner migration path is:

1. keep the existing `studio-graph` ESM/static-asset pattern
2. split `client-app` by lifecycle concern into islands
3. let each island own its own mount and update boundary

### 2. `preserveGraphRoot` style DOM retention is a workaround, not a stable rendering model

I agree.

The outer shell still relies on partial DOM protection to avoid destroying the X6 graph mount. That is a sign the render boundary is in the wrong place.

The better direction is:

- mount the graph island once
- feed it state through explicit props or commands
- stop rebuilding surrounding subtrees that are logically persistent

### 3. Navigation and top-level layout carry too much cognitive load

I agree with the diagnosis.

The current structure mixes:

- lifecycle navigation
- operate sub-navigation
- panel-local segmented controls
- global actions
- workspace identity and locale controls

This creates too many simultaneous navigation systems. The visualizer should feel task-oriented, not console-oriented.

### 4. Selection overlay state space is too large

I agree strongly here.

The current `open / docked / collapsed` combinations create avoidable UI state complexity and additional sync logic. A stable inspector column is a better fit for graph authoring than a multi-mode overlay system.

### 5. Graph editing interaction is too interrupt-driven

This is one of the highest-value observations.

The current behavior makes selection and editing too tightly coupled:

- selecting a node quickly turns into editing
- drawing an edge immediately escalates into a form flow
- modal or quasi-modal editing interrupts spatial thinking

For a graph editor, selection should primarily mean inspection. Editing should be explicit.

### 6. Runtime graph is not yet a first-class continuation of the build graph

I agree.

This is currently one of the biggest product-level inconsistencies:

- build graph uses X6
- operate graph is rendered separately
- users switch mental models when switching from authoring to diagnosis

The product should converge toward one graph surface with multiple modes.

## Points I Would Adjust

I agree with the direction, but I would change the implementation order in a few places.

### 1. I would not force a framework migration first

I do not think the first move should be an immediate switch to Preact, Solid, or another reactive UI layer.

A safer order is:

1. carve out stable islands
2. make graph and inspector long-lived mounts
3. narrow render ownership per panel
4. then decide whether a framework is still necessary

The architecture problem is real, but the first fix should be boundary cleanup, not automatic framework adoption.

### 2. I would not assume X6 History is the final undo solution

I agree that the current dual-stack undo model is fragile.

However, I would not automatically switch the whole solution back to X6 History, because the real problem is not only canvas mutation history. It is the consistency of:

- authoring state
- canvas state
- semantic commands
- server-applied mutations

The better long-term direction is likely a semantic command reducer with snapshots derived from it, not a pure editor-mutation history model.

This should also be called out as a distinct risk item:

- X6 built-in history is disabled
- custom `sharedHistory` and `readonlyHistory` stacks are maintained manually
- rollback behavior is partly dependent on outer call discipline

That makes undo/redo consistency a first-order refactor target, not just a secondary implementation detail.

### 3. Chat should move to semantic patch, not just raw diff

I agree that full replace is too destructive.

But instead of raw JSON Patch as the end state, I would prefer semantic patch operations such as:

- `add-role`
- `delete-edge`
- `set-review-policy`
- `change-join-mode`

That will be easier to review, undo, and scope to a selected subgraph.

## The Most Important Missing Emphasis

If I add one thing to the optimization list, it is this:

### Graph-model duplication is a deeper issue than the current UI stack

Right now the visualizer has too many graph representations in flight:

- `SystemDefinition`
- `StudioAuthoringDocument`
- `StudioCanvasDocument`
- `StudioGraphProjection`
- run-time graph projection

This needs one important distinction between necessary layering and avoidable duplication.

The upper three layers are justified:

- `SystemDefinition` is runtime truth
- `StudioAuthoringDocument` is authoring truth
- `StudioCanvasDocument` is layout truth

Those three should remain separate.

The real duplication starts in the render-facing projections.

This projection split is visible across:

- `src/visualizer/studio-authoring.ts`
- `src/visualizer/studio-client/studio-graph-adapter.ts`
- `src/visualizer/run-graph-projection.ts`

That means the same graph is being reinterpreted multiple times for:

- editing
- layout
- diagnostics
- runtime state
- readonly rendering

So the convergence target should be a shared render-facing `GraphViewModel`, with layers such as:

- `structure`
- `layout`
- `runtime`
- `diagnostics`

This is the architectural issue most worth reducing. If the projection layer remains split, UI improvements will continue to pay translation tax.

## Recommended Product Shape

The top-level product structure should converge toward three primary views:

1. `Design`
2. `Run`
3. `Release`

This is a better fit than keeping `Project` and `Build` as separate first-class siblings.

Reason:

- project initialization and graph authoring are part of the same preparation task
- run observation, recovery, logs, and reviews belong to the post-start operational task
- release validation and export belong to a distinct finalization task

## Recommended CTA Behavior

Top-level actions should be contextual, not statically present in all modes.

Recommended model:

- `Design`: primary `Validate`, secondary `Save`
- `Run`: primary `Resume` or `Stop` depending on run status, secondary `Reindex`
- `Release`: primary `Export`

This is cleaner than permanently showing `refresh / resume / stop` in the same visual rank even when there is no selected run.

## Recommended Priority

If the goal is to improve both maintainability and user experience with the least architectural thrash, I would prioritize work in this order.

### P0

1. Replace selection modal complexity with a stable three-column layout.
2. Decouple selection from editing.
3. Make diagnostics anchor directly on the graph surface.

### P1

1. Unify build and runtime graph rendering around a shared graph surface.
2. Reduce graph-model duplication and define a canonical graph view model.
3. Move Studio Bridge to a true `mount once + update props` island boundary.
4. Replace the current dual undo stacks with reducer-driven semantic history.

### P2

1. Add minimap and search-to-focus graph navigation.
2. Convert chat generation from full replace to scoped semantic patch.
3. Simplify navigation by removing legacy tab debt and flattening route structure around `Design / Run / Release`.
4. Revisit framework adoption only after render boundaries are stable.

## Recommended UX Direction

The highest-value UX shape is:

- left: outline and search
- center: graph canvas
- right: persistent inspector

On top of that, use mode switching on the same graph surface:

- `Build`
- `Runtime`
- `Audit`

This would reduce mode switching cost, improve discoverability, and make authoring and diagnosis feel like one continuous workflow.

One of the highest-leverage additions on this path is graph-anchored diagnostics.

The validator and readiness paths already emit diagnostics keyed by role or flow, and the graph adapter already maps severity onto nodes and edges. The missing part is expression, not data.

So diagnostics should be upgraded from:

- border color only

to:

- node or edge badges
- hover cards with blocking reason
- missing inputs
- recent failure code
- waiting review cause
- loop count

## Final Conclusion

I agree with the optimization list overall.

More specifically:

- I agree with the diagnosis almost entirely.
- I agree with the priority direction in broad terms.
- I would adjust the implementation order in three areas:
  - framework migration should not be first
  - undo should move toward semantic command consistency, not only editor history
  - chat should move toward semantic patch, not only raw replace or raw diff

The sharpened version of the conclusion is:

- keep the upper graph model layers
- converge the render projection layers
- move the product shape toward `Design / Run / Release`
- make CTA behavior contextual
- treat undo consistency and graph-anchored diagnostics as explicit refactor items

If this review is used as a delivery input, the next practical step should be a concrete refactor plan grouped by:

- `P0 / P1 / P2`
- affected files
- migration risk
- test coverage needed for each step
