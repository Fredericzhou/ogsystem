# OGSystem Graph-Centric Build And Debug Solution

Date: 2026-05-09

## Implementation Status Update

Status snapshot updated: 2026-05-09

Implemented in current frontend baseline:

- Build graph mount waits for visible, usable container size before mounting
- trial run readonly graph follows the same guarded mount strategy
- returning from Operate or dry-run paths back to Build restores `edit + bridge` as the visible default
- Build footer hosts the graph/source toggle entry
- Build graph and docked inspector alignment has UAT coverage
- docked inspector collapse and expand behavior is present and now covered by test baselines
- Build -> source -> bridge recovery path is covered as the fallback path after graph redraw-sensitive commands

Not implemented yet in the current frontend baseline:

- runtime summary rail
- graph-centered human gate action entry points
- runtime overlay badges and counters on readonly graph
- motion adapter and the minimum animation package
- reduced-motion runtime behavior
- payload folding cleanup in Operate and audit detail views

Document caution:

- sections below describing runtime overlays, summary rail, human gate graph actions, and animation remain target design, not completed implementation
- UAT and automated tests should distinguish between already-shipped baseline behavior and planned capability

## Goal

Use the X6 orchestration graph as the primary surface for Build, trial run, and runtime observation.

The solution must:

- keep kernel semantics unchanged
- prioritize stability, clarity, and predictable behavior
- avoid overdesign and avoid information stacking
- keep heavy details in audit and diagnosis modules
- support responsive layout and controlled rendering cost

## Scope

This plan covers:

- Build workbench graph editing experience
- trial run readonly graph visibility and return-to-Build stability
- runtime status projection on graph nodes and flows
- human gate interaction entry points
- key runtime summary lists beside the graph
- information folding and classification in Operate and audit-adjacent views

This plan does not cover:

- kernel execution model changes
- runtime protocol changes unless an existing API is insufficient
- large visual redesign unrelated to graph-centered workflow

## Product Principles

1. Graph first
The graph is the main editing and runtime understanding surface. Source, logs, and audit are supporting views.

2. Stable before rich
If a richer interaction risks mount timing, rerender churn, or ambiguous state, prefer the simpler stable version.

3. Read state at a glance
The user should identify current active roles, recent transitions, waiting human gates, and last failure cause in seconds.

4. Details move down one level
The graph and side summary show only decision-grade information. Long payloads, raw messages, and full evidence stay collapsed or move to audit.

5. Runtime emphasis, not decorative emphasis
Loops, retries, and repeated transitions should use counters and badges, not thicker lines or noisy animation.

6. Motion must explain state
Animation is allowed only when it helps the user understand focus, transition, waiting, or completion.

7. Version-safe motion
The repository currently uses `@antv/x6@2.19.2`. Animation design should be wrapped behind a thin frontend adapter so it can stay stable now and map cleanly to newer X6 animation APIs later.

## Confirmed Problems

### P1. Trial run readonly graph may not appear

Cause:

- X6 can mount while the graph panel is hidden or not fully sized
- the readonly runtime graph path previously lacked the same mount guard used by Build graph

Fix direction:

- mount only when panel is visible and graph root has usable size
- retry for a short bounded window instead of mounting immediately

### P2. Returning from trial run to Build can appear blank

Cause:

- returning to Build may preserve a non-edit workbench mode such as `debug`
- the user expects to return to graph editing, but the page can still show the dry-run/debug information panel

Fix direction:

- entering Build should always normalize to `edit + bridge`
- preserve graph state where safe, but restore the editing surface as the visible default

### P3. Build graph still has frontend redraw sensitivity

Observed risk:

- after some graph editing commands, the graph container may briefly become hidden during panel patching

Fix direction:

- reduce full-panel replacements around graph actions
- preserve graph root and selection shell where possible
- isolate list and inspector updates from graph remounts

Current status:

- still an active frontend risk area
- current tests cover Build graph persistence across key navigation flows and dock collapse
- graph redraw sensitivity after some authoring commands still needs product-side stabilization work
- current browser UAT confirms structure updates are retained and graph visibility can be restored through normal Build view switching, but does not yet prove zero-flicker continuity after every authoring command

## Target Experience

## Build

- default entry opens `Build -> 编排工作台 -> 图谱`
- source view is secondary and explicitly switched
- graph remains mounted across small side-panel and list updates
- graph layout and inspector align consistently on desktop
- mobile and narrow layouts stack cleanly with the inspector below the graph

## Trial Run

- trial run keeps the same graph language as Build
- the runtime graph is readonly
- active status is projected onto node and edge state, not exposed as a second competing diagram

## Operate

- `Operate -> Graph` becomes the concise runtime understanding page
- the graph is primary
- a compact summary rail shows only critical runtime facts
- audit, logs, failure forensics, and full payloads remain downstream modules

## Runtime Projection Model

### Node state

Each role node can show:

- status: `idle`, `running`, `done`, `failed`, `waiting_review`, `paused`
- active branch count
- pending human gate count
- loop visit count
- last error code if present
- last transition event label if useful

Presentation rules:

- use small badges and counters
- avoid long text inside the node
- one node should not display more than 3 short state signals at once

### Edge state

Each flow edge can show:

- recently activated state
- current active traversal state
- loop traversal count
- error flow marker
- human gate related transition marker if applicable

Presentation rules:

- use color/state tokens and small count chips
- repeated traversals use count accumulation such as `x3`, `x8`
- do not use progressive thickening for loops
- animation should be minimal and bounded to currently active edges only

## Animation Capability Plan

### Version note

X6 official guidance treats animation as a first-class capability and recommends using built-in animation support rather than ad hoc DOM effects when graph semantics need motion.

For this repository:

- current dependency is `@antv/x6@2.19.2`
- animation implementation must not assume a 3.x-only API surface directly in business code
- introduce a `graph motion adapter` in the visual layer so animation policy is stable even if the X6 integration evolves

### Motion goals

Animation should answer only a few questions:

- what just started
- what is active now
- what just finished
- what is blocked waiting for human action
- where the user focus moved

Animation should not be used to:

- decorate static topology
- imply false progress when nothing changed
- represent loop severity by ever-increasing visual weight

### Allowed animation classes

#### 1. Viewport motion

Use light motion for:

- first graph fit on initial ready
- focus-to-node after select
- optional pan-to-active-region when user explicitly requests follow mode

Rules:

- short duration
- ease-out
- interruptible
- never auto-pan repeatedly during high-frequency runtime updates unless follow mode is on

#### 2. Node focus motion

Use for:

- selecting a role
- first activation of a role in current run
- human gate waiting state

Recommended style:

- one-shot soft pulse or ring emphasis
- very small scale or shadow change only
- no infinite bouncing

#### 3. Edge traversal motion

Use for:

- recently activated flow
- currently active transition path
- recovery/error branch transition

Recommended style:

- moving dash, stroke offset, or short traveling highlight
- single pass or short bounded repeat
- use `xN` count badge for repeated traversals instead of stronger repeated motion

#### 4. Status settle motion

Use for:

- running to done
- running to failed
- waiting review entered
- review resolved

Recommended style:

- brief color interpolation or opacity settle
- one-shot only
- final state must remain understandable after motion ends

#### 5. Human gate waiting motion

Use for:

- pending review
- paused for confirmation

Recommended style:

- low-frequency breathing highlight on the waiting node badge only
- optional review icon pulse
- stop immediately after gate is resolved

#### 6. Expand and collapse motion

Use for:

- summary rail section folding
- detail payload expand/collapse
- docked inspector collapse

Recommended style:

- CSS height/opacity transitions outside the X6 core canvas
- no graph remount caused by UI fold animations

### Runtime motion semantics

#### Active node

- on first activation: one brief pulse
- while active: stable `running` badge, no repeated pulse spam
- if re-entered by loop: increment count only, optional single re-entry flash if enough time passed since last flash

#### Active edge

- recent traversal: short highlight pass
- repeated loop traversal: keep count increasing, avoid speeding up or thickening the line
- current hot path: one subtle moving indicator at a time

#### Failed node or edge

- one short failure flash
- persist final `failed` state color and error code badge
- no infinite blinking

#### Human gate

- entering gate: one emphasis pulse
- waiting: low-frequency breathing marker
- resolved: stop wait motion, settle to next state

### Motion limits

To protect readability and performance:

- at most one active traversal animation per edge
- at most one continuous waiting animation per gated node
- cap simultaneous animated nodes and edges in the viewport
- if too many runtime changes happen at once, degrade to state change only and skip motion
- viewport motion should not trigger more than once per explicit user navigation or follow-mode step
- one node should not run overlapping pulse and settle animations at the same time
- one runtime update cycle should resolve into a bounded motion set, not an event-by-event animation queue

### Animation budget

Keep motion within a small explicit budget:

- viewport transition: short and one-shot
- node pulse: short and one-shot
- edge traversal highlight: short pass or bounded repeat
- human gate breathing: the only allowed continuous motion, low frequency only
- summary rail and fold transitions: short CSS transitions outside the graph

If the budget would be exceeded:

- preserve counts and state colors
- drop secondary animations first
- keep only the most recent active edge and the most important gate state

### Reduction and degradation rules

Animation should degrade automatically when:

- browser tab is hidden
- graph panel is hidden
- device prefers reduced motion
- run update rate is too high
- graph has too many simultaneously hot cells

Fallback behavior:

- keep color and counter updates
- skip moving highlights
- skip pulsing
- skip viewport auto-follow

### Recommended technical shape

Use a visual-layer motion adapter with responsibilities:

- map runtime state deltas to motion intents
- deduplicate repeated animation requests
- cancel stale motion when selection or run changes
- enforce animation budgets and cooldowns
- expose a version-safe interface to the rest of the app

Suggested intent types:

- `focus-node`
- `activate-node`
- `activate-edge`
- `settle-success`
- `settle-failure`
- `wait-human-gate`
- `clear-runtime-motion`

### Rendering strategy

Prefer this priority order:

1. X6-native or X6-compatible cell/view animation hooks for graph semantics
2. attribute-based SVG changes on existing cells
3. CSS transitions for non-canvas chrome such as rails, badges, and fold panels

Avoid:

- rebuilding graph cells just to animate
- forcing relayout for status-only motion
- long-running timers attached to stale cells

### Event and lifecycle rules

Animation must bind to runtime state transitions, not blind intervals.

Trigger from:

- run detail refresh delta
- stream event aggregation result
- review state change
- explicit graph selection

Stop or cancel when:

- selected run changes
- graph panel unmounts or hides
- cell leaves current visible graph model
- a newer state supersedes the current motion

## X6 Best-Practice Mapping

### Graph-centered motion that fits this product

- initial graph ready: one fit-to-content transition
- role selection: focus and short ring emphasis
- active flow: short edge highlight pass
- waiting review: badge breathe, not full-node bounce
- loop: count increment only, optional throttled re-entry flash
- failure: one-shot error flash then static failure badge

### Minimum animation package

The first implementation should include only this minimal set:

1. node selection focus animation
2. active edge short traversal animation
3. human gate waiting badge breathing
4. reduced-motion and hidden-panel pause behavior

This package is sufficient to validate product value without introducing broad rendering risk.

### Motion that should be avoided

- always-on animated topology
- infinite edge travel on all active branches
- repeated viewport auto-jumps during streaming
- using motion as a substitute for counts or labels
- per-event full graph repaint to “replay” execution

### Loop handling

Loops should be understandable without visual noise.

Recommended rules:

- per edge count: show total traversals in the current run window
- per node count: show total entries for the role in the current run window
- if counts are large, compact to `99+`
- counts reset when switching selected run
- long-running streams can optionally support windowed counts later, but initial implementation should use current loaded run/session totals only

## Human Gate Design

Human gate is a first-class runtime state and must be visible on the graph.

### Node and edge indicators

- roles waiting on review show `waiting_review`
- the edge that led into the gate can show a review marker
- the summary rail shows pending gate items grouped separately

### Required interactions

Support from graph selection or summary rail:

- confirm / approve
- cancel / reject / rework
- terminate scoped branch or run when allowed

Interaction rules:

- action entry can start from graph node, graph edge, or summary rail
- actual detailed context opens in the existing review panel or action form
- graph surface should not host the full review transcript
- graph only presents enough context to choose whether to open and act

### Human gate information shown on graph side

Only show:

- role id
- gate status
- waiting duration
- branch or scope
- latest requested action

Hide by default:

- long prompt bodies
- raw model output
- detailed comments history

Those remain in review and audit detail views.

## Summary Rail Design

Place a compact summary rail beside or below the graph depending on viewport.

Recommended groups:

1. Active roles
Current running roles with status and branch count.

2. Recent transitions
Recent edge traversals, grouped and folded by role or branch.

3. Waiting human gates
Pending review items with direct action entry.

4. Last failure / last warning
Top error code, short message, and entry to triage.

5. Runtime counters
Total transitions, active branches, looped edges count, pending gates count.

### Folding rules

- each group is collapsible
- default open: active roles, waiting human gates, last failure
- default collapsed: recent transitions if list is long
- persist collapse preference per page session if cheap to implement

## Information Architecture Cleanup

Current issue:

- long messages, raw payloads, and overly long text blocks reduce scan efficiency

Required restructuring:

### Level 1: graph surface

Only:

- status
- counts
- short labels
- minimal action affordances

### Level 2: summary rail / side panel

Only:

- concise grouped runtime facts
- short reason text
- action entry buttons

### Level 3: detail panels

Only open when requested:

- full review content
- full logs
- long error body
- raw event payload
- request/response bodies

### Content formatting rules

- classify by type: `state`, `warning`, `error`, `review`, `payload`, `audit`
- long payloads default collapsed
- show a short synopsis first, such as first line, code, timestamp, actor, affected role
- provide explicit expand actions instead of rendering full text inline

## Layout Plan

### Desktop

- graph is primary column
- summary rail or docked inspector is secondary column
- top and bottom alignments must stay straight, not diagonal
- footer holds view mode and source toggle where already decided

### Tablet

- graph remains first
- summary rail moves below graph if width is insufficient
- inspector collapses more aggressively

### Mobile

- single column
- graph first
- summary groups as accordions
- avoid persistent side-by-side panes

### Responsive constraints

- avoid fixed widths except for bounded min/max side panels
- avoid nested scroll regions when possible
- keep graph root measurable before X6 mount

## Stability And Performance Plan

### Rendering constraints

- keep the graph root mounted across non-graph updates where possible
- patch summary and inspector regions independently
- avoid rebuilding the whole Build body for selection-only changes
- avoid full graph remounts on every stream event
- do not trigger animation by remounting cells

### Runtime update strategy

- coalesce stream updates into small batches
- update graph overlay state on a short cadence instead of every raw event if event volume is high
- do not recompute full layout during runtime state updates
- layout changes should only happen on authoring changes, not status changes
- derive motion from delta snapshots, not every raw event line

### Mount safety

- mount only when container is visible
- mount only when container has stable size
- bounded retry with small delay
- clear retry timers on panel transitions and dispose

### X6 update policy

- structure change: patch graph model
- status change: patch node/edge attrs only
- selection change: patch selection only
- list and summary change: no graph remount

### Performance guardrails

- limit animated active edges to current hot path only
- cap visible recent transitions list
- compact loop counters
- virtualize or paginate long side lists later if needed, but initial version should prefer hard limits and folding
- enforce animation cooldowns for repeated loop hits
- pause continuous motion when canvas is hidden or document is not visible
- respect `prefers-reduced-motion`

## Suggested Data Usage

Prefer using existing projections first:

- `/runs/:id`
- `/runs/:id/graph`
- `/runs/:id/events`
- existing review and failure endpoints

Derived frontend-only fields can include:

- role visit counts
- edge traversal counts
- recent active edge set
- pending human gate grouping
- top-level summary buckets

This keeps runtime semantics unchanged.

## Implementation Phases

### Phase 1. Stability baseline

- fix readonly runtime graph mount timing
- normalize return to Build into `edit + bridge`
- reduce graph remounts during Build patching
- verify graph and inspector alignment

Exit criteria:

- no blank graph on Build first entry
- no blank graph on trial run graph entry
- no blank graph after returning from trial run to Build

### Phase 2. Runtime overlay minimal version

- node status badges
- edge active/error/review markers
- loop counts on nodes and edges
- compact summary rail with grouped sections
- minimal motion adapter with bounded node and edge animation
- minimum animation package includes node selection focus animation
- minimum animation package includes active edge short traversal animation
- minimum animation package includes human gate waiting badge breathing
- minimum animation package includes reduced-motion and hidden-panel pause behavior

Exit criteria:

- user can identify active role, waiting gate, and last failure from graph view alone
- animation improves understanding without causing rerender churn
- the minimum animation package works without full graph remounts

### Phase 3. Human gate interaction

- action entry from graph selection and summary rail
- approve / rework / pause / terminate flows routed to existing action infrastructure
- keep detailed reasoning in review panels

Exit criteria:

- human gate can be discovered and acted on without leaving graph context first

### Phase 4. Detail cleanup

- fold long payloads by default
- classify and group detail sections
- keep audit full-fidelity but default collapsed for non-key text

Exit criteria:

- long messages no longer dominate primary views
- top-level pages remain scannable

## UAT Checklist

### Current automated baseline coverage

Covered now by tests:

- Build opens the graph workbench and keeps source toggle in footer
- Build graph and docked inspector stay aligned
- Build graph survives Build -> Operate -> Build return path
- readonly run graph appears in Operate Graph and remains readonly
- returning to Build restores editable graph view rather than leaving the user in debug or dry-run info mode
- docked inspector collapse and expand keep the graph visible and do not require remount
- Build graph content can be recovered through normal source/bridge switching after redraw-sensitive authoring commands

Planned but not yet covered because the product capability is not implemented:

- runtime node and edge overlay badges
- grouped summary rail folding behavior
- graph-entry human gate actions
- reduced-motion animation downgrade behavior
- hidden-panel animation pause behavior

### Build

- entering Build always shows graph workbench by default
- source and graph toggle work from footer
- graph and inspector stay aligned
- graph does not disappear after add role, add edge, edit edge, undo, redo

### Trial run

- readonly graph appears on first entry without refresh
- returning to Build restores editable graph
- no mode confusion after returning from Operate

### Runtime graph

- active role is visible within 2 seconds of transition stream update
- loop counts increase without noisy restyling
- pending human gate is visible and grouped
- human gate actions can be opened from graph context
- active motion stops when panel hides or run changes
- reduced-motion mode keeps state readable without movement
- only the bounded minimum animation package is enabled in the first rollout

Implementation note:

- these runtime graph items are target acceptance checks for the next implementation phases
- current shipped baseline only guarantees readonly graph visibility and stable return navigation

### Information density

- recent transitions do not flood the page
- long payloads are collapsed by default
- top failure summary is visible without reading raw bodies

### Performance

- no full graph rerender on simple status update
- no forced relayout on runtime-only updates
- no visible jank during normal stream refresh cadence
- no unbounded animation accumulation in long-running loop scenarios

Current validation note:

- the present test baseline can detect graph remount regressions across main lifecycle transitions
- it does not yet measure runtime overlay patch cost because runtime overlay is not implemented
- a remaining product risk is immediate post-command graph visibility after some Build authoring operations; current UAT treats this as a known stability gap rather than a solved behavior

## Non-Goals

- no second competing runtime diagram
- no excessive motion design
- no embedding full audit transcript into graph
- no kernel-level event semantics rewrite

## Recommended Next Execution Order

1. Finish the remaining Build graph redraw stability issue after graph editing commands.
2. Add minimal readonly runtime overlay with node and edge status plus counters.
3. Add the minimum animation package with motion adapter and degradation rules.
4. Add grouped summary rail with default folding.
5. Add human gate action entry points from graph and summary rail.
6. Clean up long-form payload presentation in detail modules.

## Test Baseline Notes

The current test baseline intentionally stays conservative.

What is now asserted:

- guarded graph mount for Build and readonly runtime graph
- visible readonly behavior for trial run graph
- Build return path normalizes to editable bridge view
- docked selection collapse keeps graph context intact

What is explicitly not asserted yet:

- CSS or X6 animation details
- `prefers-reduced-motion` downgrade behavior
- summary rail grouping and folding
- human gate inline actions from graph context

Reason:

- those capabilities are not yet implemented in the product layer, so adding tests now would create false confidence

## Document Review Notes

This document has been checked against the current product direction and should be treated as the working baseline for implementation.

Key checks completed:

- graph remains the single primary surface across Build and runtime views
- no kernel behavior changes are required
- animation scope is bounded and version-safe
- loop handling prefers counters over stronger motion
- human gate remains actionable but not overloaded into the graph
- long-form payloads are explicitly pushed into folded detail layers
- stability and performance constraints are attached to every richer interaction

Open implementation caution:

- before broader runtime overlay work, finish the remaining Build graph redraw stability issue after graph editing commands so motion and overlay logic are not built on top of a fragile rerender path

## Implementation Update 2026-05-09

- Build graph authoring no longer falls back to native form navigation during `add-role` and `add-edge`; local authoring and canvas state now stay in sync after command apply.
- The browser client script now injects the full renderer helper set required by `Studio Bridge` side panels and execution-config editor, removing runtime `is not defined` failures in Build.
- Returning from `Operate / Graph` back to `Build` now normalizes to editable `Bridge` mode, and switching back into readonly runtime graph explicitly remounts when the graph tab becomes visible.
- Workbench footer view toggles are rebound at render time and use `type="button"` plus `aria-pressed`, which stabilizes `Graph <-> Source` switching after graph edits.
- Docked selection controls were hardened with delegated click handling so collapse, close, pin, and side-tab actions remain functional after partial panel rerenders.
- Browser UAT now covers the graph-to-source-to-graph loop, readonly graph remount, and docked selection collapse. The lower-fidelity client harness still keeps one collapse case skipped because real-browser coverage is now the authoritative regression guard.
