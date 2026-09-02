# OGSystem Compiler Semantics v1

## Scope

`src/runtime/compiler.ts` is the static compilation facade for the runtime. It collects stable
summaries from `SystemDefinition`, role packages, flow contracts, and effective law policy, then
produces a `CompiledExecutionSnapshot`.

## Snapshot

The v1 snapshot keeps the runtime transition path intact:

- `basePlan`
- `diagnostics`
- `digest`
- `roleSummaryByRoleId`
- `flowSummaryByKey`
- `projectionSummaryByRoleId`
- `joinSummaryByRoleId`
- `contractSummaryById`
- `loopSummaryByRoleId`
- `bindingSummaryByRoleId`
- `lawSummary`

## Digest Rules

- Sort all summary maps by stable keys before hashing.
- Include semantic fields only.
- Exclude runtime state, paths, session ids, and other machine-local noise.
- Keep compiler digest separate from the existing runtime components so resume mismatch reports stay readable.

## Diagnostics

The `compiler.ts` facade reports stable diagnostics for manually assembled or inconsistent inputs; its
`CompilerResult.ok` is `false` when an error diagnostic is present. This does not mean all compilation
stages return normally: the Semantic IR source compiler (`semantic-ir-compiler.ts`) rejects malformed
specifications by throwing a stable, coded error. Current facade diagnostic codes cover:

- `COMPILER_CONTEXT_SELECTOR_JOIN_ONLY`
- `COMPILER_CONTEXT_SOURCE_NOT_ALLOWED`
- `COMPILER_CONTEXT_SOURCE_UNDEFINED`
- `COMPILER_CONTEXT_SELECTOR_INVALID`
- `COMPILER_JOIN_SOURCES_MISMATCH`
- `COMPILER_JOIN_MIN_INVALID`
- `COMPILER_ROLE_INPUT_UNBOUND`
- `COMPILER_FLOW_CONTRACT_UNBOUND`
- `COMPILER_LOOP_MAX_INVALID`
- `COMPILER_ROLE_BINDING_MISSING`

## Runtime Boundary

The compiler is a static summary and validation layer, not an execution engine. It does not replace
runtime execution, checkpointing, resume, or audit evidence. Static validation is fail-closed: callers
must not run a plan with `ok === false`, and the Semantic IR compiler rejects invalid source contracts.
The compiler digest is included in `plan-fingerprint.json` so resume becomes sensitive to semantic
compiler changes.
