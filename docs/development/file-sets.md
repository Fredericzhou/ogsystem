# Runtime And NL2MMD File Sets

This document records the current source ownership boundaries for `src/runtime/*` and
`src/nl2mmd/*`. It is a dependency and review map, not a second API specification. Code and
tests remain the source of truth when this map and the implementation disagree.

## Authorities

`src/runtime/*` owns execution and runtime contracts:

- Mermaid parsing, static semantics, Semantic IR, execution plans, routing, joins, loops, and
  state reduction;
- role/model binding resolution, model catalog and selection rules, configuration validation, and
  executor contracts;
- graph execution, OpenCode/tool execution, error envelopes, human-review control, persistence,
  checkpoints, resume, audit records, and runtime projections;
- runtime/project lifecycle and the top-level `ogs` CLI dispatch.

`src/nl2mmd/*` owns prompt-to-Mermaid orchestration:

- NL2MMD prompts, conversation turns, response parsing, semantic hints, role/model search, and
  structure templates;
- normalization and stabilization of model-produced Mermaid;
- NL2MMD-facing validation orchestration and text-graph preview.

NL2MMD may ask runtime to validate or resolve a contract, but it must not redefine runtime
execution semantics, model selection semantics, or persisted run authority. Runtime remains the
authority for model selection and execution contracts. NL2MMD remains the authority for turning
natural-language requests into Mermaid candidates and coordinating that workflow.

## Internal File Sets

The following groups are practical ownership sets within runtime. A file may use a lower-level
set, but a change should be reviewed by the owner of the set whose contract it changes.

| Set | Current modules | Owns |
| --- | --- | --- |
| Runtime contracts and planning | `types.ts`, `flow-contract.ts`, `event-contract.ts`, `condition-ast.ts`, `static-semantics.ts`, `semantic-ir.ts`, `semantic-ir-compiler.ts`, `compiler.ts`, `execution-plan.ts`, `plan-fingerprint.ts`, `transition-planner.ts`, `graph-mode-registry.ts`, `join-policy.ts`, `subgraph.ts`, `graph-runtime-state.ts`, `state-reducer.ts`, `capability-policy.ts` | Parsed/compiled contracts, graph semantics, planning, fingerprints, and state transition rules |
| Runtime execution | `graph-runner.ts`, `executor.ts`, `role-executor.ts`, `opencode-executor.ts`, `tool-runner.ts`, `adapter.ts`, `engine-adapter.ts`, `langgraph-engine-adapter.ts`, `filesystem-runtime-services.ts` | Scheduling, role execution, engine ports, and execution backends |
| Runtime persistence and recovery | `artifact-store.ts`, `audit-recorder.ts`, `checkpoint-store.ts`, `run-artifact-policy.ts`, `run-artifacts.ts`, `run-store.ts`, `review-store.ts`, `role-execution-recorder.ts`, `versioned-state.ts`, `timeline-projector.ts` | Durable artifacts, locks, checkpoints, WAL/replay, review records, and recovery evidence |
| Runtime configuration and repositories | `config.ts`, `bundled-repos.ts`, `system-home.ts`, `runtime-loader.ts`, `runtime-setup.ts`, `role-repo.ts`, `model-repo.ts`, `model-catalog.ts`, `model-selection.ts`, `project-target.ts`, `project-lifecycle.ts`, `ogs-spec-loader.ts` | Project/system configuration, role/model repositories, discovery/selection, and lifecycle files |
| Runtime support and entrypoints | `cli.ts`, `lint.ts`, `doctor.ts`, `console-run-log.ts`, `observability.ts`, `run-summary.ts`, `run-summary-schema.ts`, `stage-projector.ts`, `runtime-indexes.ts`, `runtime-support.ts`, `json-file.ts`, `json-schema.ts`, `redaction.ts`, `runtime-errors.ts`, `binding-resolver.ts`, `error-flow-utils.ts`, `human-review.ts`, `role-input-projector.ts`, `role-output-parser.ts`, `role-prompt-input-schema.ts`, `parse-mermaid.ts` | Public command entrypoints, diagnostics, projections, shared utilities, error normalization, and parsing entry |

The NL2MMD set is intentionally smaller and centered on the generation workflow:

| Set | Modules | Owns |
| --- | --- | --- |
| NL2MMD entry and contracts | `cli.ts`, `index.ts`, `types.ts` | Public NL2MMD API, CLI interaction, and NL2MMD-specific shapes |
| NL2MMD context and prompting | `catalog.ts`, `semantic-map.ts`, `prompt.ts` | Local catalog context, search/hints, and prompt construction |
| NL2MMD generation and normalization | `service.ts`, `normalize-mermaid.ts` | Model turn orchestration, response parsing, and candidate stabilization |
| NL2MMD validation and presentation | `validate.ts`, `structure-templates.ts`, `txt-graph.ts`, `logger.ts` | Validation workflow, reusable graph skeletons, text preview, and debug logging |

## Import Direction And Current Exceptions

The preferred dependency direction is: lower-level runtime contracts and adapters are reusable by
NL2MMD; runtime core modules do not depend on NL2MMD. The current source has these direct
cross-set imports:

| Importing file | Runtime dependency | Reason and status |
| --- | --- | --- |
| `nl2mmd/catalog.ts` | `bundled-repos.ts`, `config.ts`, `json-file.ts`, `model-catalog.ts`, `model-selection.ts`, `role-repo.ts` | Builds prompt context from the same project, role, law, and model sources used by runtime. Allowed context adapter; it must not duplicate their validation or selection rules. |
| `nl2mmd/types.ts` | `runtime/types.ts` (type-only: `ModelCatalog`, `ModelSelectionConfig`, `SystemDefinition`) | Shared canonical contracts. Allowed shared-contract boundary; do not create NL2MMD copies of these types. |
| `nl2mmd/service.ts` | `opencode-executor.ts`, `model-selection.ts` | NL2MMD needs a managed OpenCode turn and direct model-reference validation. This is an execution-facade boundary candidate: future extraction should preserve the runtime executor contract and keep NL2MMD from depending on unrelated executor internals. |
| `nl2mmd/validate.ts` | `json-file.ts`, `model-selection.ts`, `parse-mermaid.ts`, `role-repo.ts`, `config.ts` | Candidate validation delegates syntax, runtime semantics, model resolution, role loading, and config validation to their runtime authorities. Allowed validation adapter; it must remain non-executing. |
| `nl2mmd/cli.ts` | `model-selection.ts`, `project-lifecycle.ts` | CLI needs the canonical model-reference check and project dependency synchronization. Boundary candidate if lifecycle operations are later exposed through a narrower runtime CLI/service port. |
| `runtime/cli.ts` | `nl2mmd/cli.ts` | Top-level command dispatch exposes `ogs nl2mmd`. This is an entrypoint exception, not a runtime-core dependency; runtime internals must not import NL2MMD modules. |

There are no current direct imports from `src/runtime/*` into NL2MMD outside the top-level
`runtime/cli.ts` dispatch. The `nl2mmd` to runtime imports above are deliberate integration points,
but the service and lifecycle rows are the first candidates for a narrower facade if the coupling
grows.

Do not infer a new dependency from a same-repository path alone. Before adding one, identify the
contract being consumed and answer:

1. Is the dependency an authoritative runtime contract, a pure adapter, or merely convenient
   implementation reuse?
2. Can the consumer use a stable type/function exported by the owning set instead of importing an
   internal helper?
3. Would the import create a reverse dependency from runtime core to NL2MMD, a cycle, or a second
   source of truth?
4. Can a focused test prove the boundary and the failure behavior?

If the dependency is not clearly justified, extract a narrow port/facade or move the operation to
the owning set first. Update this document in the same change when a new cross-set dependency is
accepted, removed, or changed from an exception into a supported boundary.

## Shared Contracts

Use runtime-owned contracts for values that cross into execution or parsing:

- `runtime/types.ts` is the canonical source for `SystemDefinition`, `ModelCatalog`,
  `ModelSelectionConfig`, and runtime execution/state shapes.
- `runtime/config.ts` owns validation of runtime, laws, profiles, tools, and user-profile data.
- `runtime/parse-mermaid.ts` owns the accepted Mermaid subset and parsed system semantics.
- `runtime/model-selection.ts` owns pinned model resolution and capability checks; NL2MMD may
  display/search the catalog but must not invent a selection policy.
- NL2MMD `types.ts` owns conversation, hint, search, and validation-result shapes that are not
  runtime contracts.

NL2MMD normalization may repair known model-output drift before validation, but the final candidate
must pass the runtime parser and relevant runtime contract checks. A text-graph preview is derived
presentation and is never a resume or execution authority.

## Build And `dist` Boundary

`src/` is the editable source boundary. The TypeScript build emits compiled runtime and NL2MMD
modules under `dist/runtime/` and `dist/nl2mmd/`; `bin/ogs.mjs` starts the compiled runtime CLI.
Tests import these compiled entrypoints, so build-dependent tests must run `pnpm run build` first.

The Studio client is separately bundled by esbuild, and
`dist/visualizer/assets/client-app.js` is generated by `scripts/build-visualizer-client.mjs`.
`dist/` is ignored by git and is not a second source tree. Do not edit, review, or add imports to
compiled files by hand. Change the corresponding `src/` module or generator and rebuild.

## Test Ownership

- `tests/nl2mmd.test.mjs`, `tests/nl2mmd-service.test.mjs`, `tests/nl2mmd-normalize.test.mjs`,
  and `tests/nl2mmd-structure-templates.test.mjs` own NL2MMD context, service, normalization,
  and template behavior.
- Runtime tests own runtime contracts and execution: parser/compiler, model runtime, role
  execution, graph transitions, persistence/recovery, CLI, diagnostics, and projections. Their
  names describe the owned runtime area, for example `parser.test.mjs`, `compiler.test.mjs`,
  `graph-runtime.integration.test.mjs`, and `session-recovery.test.mjs`.
- `tests/nl2mmd-normalize.test.mjs` is a cross-boundary integration test because it checks NL2MMD
  normalization and then parses the stabilized result with the runtime parser.
- `tests/parser.test.mjs` is a cross-boundary integration test because it checks runtime parsing
  together with `validateNl2MmdCandidate`.
- `tests/cli-help.test.mjs` is a cross-boundary CLI integration test because it checks both the
  runtime command dispatcher and the NL2MMD command help.
- A new cross-set behavior should get a focused test at the owning boundary plus an integration
  test only when the public CLI or end-to-end contract is involved. Tests should import `dist`
  after a build, matching the shipped entrypoint path.
