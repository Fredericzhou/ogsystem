---
name: ogsystem-nl-to-mmd
description: Generate OGSystem Mermaid system graphs from natural language requirements. Use when the user wants a runnable .mmd for the current OGSystem minimal kernel, or wants an LLM prompt/skill that converts natural language workflows into constrained Mermaid flowcharts and validates them against OGSystem semantics.
---

# OGSystem NL To MMD

Generate Mermaid for the current `OGSystem` minimal kernel, not an imagined future engine.

Default target:

- runnable on the current parser/runtime
- one `flowchart TD|LR`
- only supported metadata
- only `input` and `output` boundaries
- role ids that can resolve to `og-roles/roles/<roleId>/`

If the user asks for parallel join, loop metadata, or other future-engine semantics, either:

- say the graph is design-only and not runnable on the current minimal kernel, or
- reduce it to the closest minimal runnable form

Prefer the second option unless the user explicitly wants future-engine design.

## Output Contract

When asked to generate the graph, return:

1. one Mermaid block
2. a short assumptions list only if required
3. the validation command

Do not emit prose inside the Mermaid block.

## Required Metadata

Always include:

- `%% system.id=...`
- `%% system.version=...`
- `%% law.global=...`
- `%% entry.role=...`

Allowed extra metadata in the current minimal kernel:

- `%% exec.bind.<roleId>=<profileId>`
- `%% talent.bind.<roleId>=<value>`

Do not generate:

- `%% engine=...`
- `%% role.mode...`
- `%% join.mode...`
- `%% join.sources...`
- `%% loop.max...`

Those are not supported by the current minimal parser.

## Node And Edge Rules

Allowed node forms:

- `input`
- `output`
- `nodeId[Role:roleId]`

Allowed edge forms:

- `input -->|EVENT| node[Role:roleId]`
- `nodeA[Role:roleA] -->|EVENT| nodeB[Role:roleB]`
- `node[Role:roleId] -->|EVENT| output`

Constraints:

- use `input` and `output` only as boundaries
- do not use `start`, `end`, or `done`
- `entry.role` must exist in the graph
- one role id must map to exactly one node id
- one node id must map to exactly one role id

## Naming Rules

Use these defaults unless the user gives exact names:

- `roleId`: lowercase kebab-case, stable, semantic
- `nodeId`: same as `roleId` when possible
- `event`: uppercase snake case
- `system.id`: dotted lowercase id
- `profileId`: preserve user input if given; otherwise use placeholder `profile.todo.<roleId>`

Good role ids:

- `task-intake`
- `solution-review`
- `final-report`

Good event names:

- `REQUEST_RECEIVED`
- `ANALYSIS_DONE`
- `REPORT_READY`

Avoid vague names:

- `DONE`
- `NEXT`
- `OK`

## Generation Procedure

Before writing Mermaid, normalize the user request into:

- system goal
- roles
- entry role
- terminal condition
- transitions and events
- required execution bindings
- known law id

Then generate the smallest graph that satisfies the request.

Default simplifications:

- one role per distinct responsibility
- one outgoing event per unambiguous step
- prefer linear flow unless branching is explicitly required
- if a branch exists, make the decision role explicit
- if the user does not provide profiles, still emit `exec.bind.<roleId>` placeholders for runnable intent

## Self-Check Before Returning

Check all of these:

- Mermaid starts with `flowchart TD` or `flowchart LR`
- all required metadata exists
- no unsupported metadata keys exist
- every `Role:<roleId>` is legal and non-reserved
- every edge has a non-empty event label
- `entry.role` is present in the graph
- at least one terminal role or `--> output` path exists
- each executable role has `exec.bind.<roleId>` unless you intentionally describe a noop path

If the graph is meant to be runnable, tell the user to validate it with:

```bash
node skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs --system <file.mmd>
```

## Validator

Use the bundled validator after generation. It checks:

- Mermaid parsing against the current OGSystem parser
- role package existence under `og-roles/roles/`
- required role files
- role manifest consistency
- optional profile file consistency
- optional law file consistency
- event enum alignment when `output.schema.json` declares an enum

Script:

- `skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs`

## When To Read More

Read these only if needed:

- `docs/usage-manual.md` for current runtime behavior
- `specs/mermaid-dsl-v0.1.md` for DSL details
- `src/runtime/parse-mermaid.ts` for exact parser truth
