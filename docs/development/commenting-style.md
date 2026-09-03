# Source Commenting Style

This is the source-commenting guide for `src/runtime/*`, `src/nl2mmd/*`, and
`src/visualizer/*`. It describes the current low-noise style; it does not require a formatter,
comment-count target, or broad rewrite of existing files.

## Purpose

Comments should preserve information that a reader cannot reliably derive from the syntax alone.
Use them to explain:

- an invariant that must remain true across a state transition or I/O operation;
- a failure window and what recovery does after a partial write or process crash;
- a trade-off, compatibility constraint, or intentionally conservative behavior;
- a boundary between an authority and a derived projection;
- a non-obvious reason for a fallback, ordering rule, or fail-closed decision.

Prefer comments that answer **why this shape is required**. If changing the code would make the
comment false, the comment belongs close to that code or in the same change.

Comments do not replace executable contracts, tests, error handling, or the authoritative runtime
and usage documentation. Do not use a comment to promise behavior that the implementation does
not enforce.

## Placement And Form

### File overview

For a source module with meaningful ownership or boundary decisions, put a short overview before
the imports. Existing files use `@fileoverview`, `File Set`, `Responsibilities`, and `Boundaries`
fields, for example [`src/nl2mmd/catalog.ts`](../../src/nl2mmd/catalog.ts:1) and
[`src/runtime/runtime-support.ts`](../../src/runtime/runtime-support.ts:1). Keep this overview
stable and architectural; do not turn it into a changelog.

### Exported contracts

Put TSDoc immediately before an exported type, interface, class, or function when its name and
fields do not fully expose the contract. Describe optionality, ordering, authority, lifecycle,
or recovery meaning. Field comments are appropriate for a field whose semantics would otherwise
be guessed, such as the mode distinction in
[`src/runtime/types.ts`](../../src/runtime/types.ts:155).

### Decision points

Put an inline comment immediately before the branch, loop, write, or fallback it explains. Keep
the comment close enough that a future edit cannot easily separate the rationale from the code.
Useful labels already present in the codebase include `Invariant`, `Failure window`, `Recovery
semantics`, `Trade-off`, `Fail-closed default`, and `Idempotency`.

Examples of useful context in the current source:

- The scheduler documents why active roles must be drained before `END` in
  [`src/runtime/graph-runner.ts`](../../src/runtime/graph-runner.ts:1243).
- Resume documents the crash window between durable role outcomes and checkpoint projection in
  [`src/runtime/graph-runner.ts`](../../src/runtime/graph-runner.ts:648).
- The resume lock documents its single-machine advisory-lock trade-off in
  [`src/runtime/run-artifacts.ts`](../../src/runtime/run-artifacts.ts:273).
- NL2MMD normalization explains why a conservative loop budget is injected for generated cycles
  in [`src/nl2mmd/normalize-mermaid.ts`](../../src/nl2mmd/normalize-mermaid.ts:528).

Short same-line comments are allowed for a local exception, such as tolerating a partially
written final log line. They should still state the reason, as in
[`src/visualizer/run-query-service.ts`](../../src/visualizer/run-query-service.ts:73).

## Good And Bad Comments

### Useful context

```ts
// Failure window: role execution may be durable before checkpoint emission, so resume reconciles
// committed outcomes after replaying the checkpoint WAL.
```

This identifies a crash window and the recovery contract. It gives a maintainer something to
check when changing either persistence step.

```ts
// Trade-off: use the same short-lived OpenCode server for all probes so doctor latency stays
// bounded while each model binding is still checked independently.
```

This records a deliberate performance/coverage choice that is not visible from the call shape.

### Redundant or misleading comments

Avoid comments that merely narrate syntax:

```ts
// Increment the counter.
counter += 1;
```

The code already says this. Comment the contract instead, if there is one:

```ts
// The persisted transition count is monotonic and is used as the resume frontier.
counter += 1;
```

Avoid claims broader than the implementation:

```ts
// This lock prevents concurrent resumes everywhere.
```

An advisory PID/hostname lock is not distributed coordination. The accurate version records the
single-machine assumption and the required caller behavior, as the implementation does in
[`src/runtime/run-artifacts.ts`](../../src/runtime/run-artifacts.ts:273).

Avoid comments that restate a function name or make a universal claim about a best-effort path:

```ts
// Load the snapshot.
const snapshot = await loadSnapshot();

// The refresh always succeeds.
await refreshProjection();
```

The first is noise; the second is false if the operation can observe a missing or concurrently
rotated file. Explain the fallback or the tolerated failure at the actual catch/branch instead.

## Generated And Bundled Source

- Edit TypeScript source under `src/`; do not hand-edit compiled files under `dist/`.
- `tsc` emits the runtime and NL2MMD module tree into `dist/`. `bin/ogs.mjs` and the Node tests
  consume those compiled entrypoints after a build.
- `esbuild` bundles the Studio client, and `scripts/build-visualizer-client.mjs` emits the
  generated visualizer asset. The generated asset explicitly says not to edit it by hand.
- Comments needed in generated output must be added to the source or to the generator template.
  Do not add source-style headers to every generated file just to increase coverage.
- Generated project JSON remains comment-free because it is validated as data. Put operator
  guidance in the generated `.ogs/README.md`, not inside JSON.

When reviewing a diff, generated output is evidence of the build, not an additional source file
to maintain. Run the build when generated output is needed for tests or packaging, then review
source changes for the actual comment decision.

## Review Checklist

- Does each new comment explain an invariant, failure/recovery window, trade-off, boundary, or
  non-obvious fallback?
- Is it placed immediately before the code or contract it explains?
- Is the statement precise, current, and no broader than the implementation?
- Would a test, type, error contract, or authoritative document be a better place for the claim?
- Is the comment redundant with a clear name or the next line of code?
- If source moved or a generated artifact changed, was the source edited rather than `dist/`?
- For persistence and execution changes, does the comment cover the relevant partial-failure or
  resume behavior without claiming more than the tests establish?
