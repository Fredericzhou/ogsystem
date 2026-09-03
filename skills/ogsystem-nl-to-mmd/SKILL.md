---
name: ogsystem-nl-to-mmd
description: Convert natural-language requirements into runnable OGSystem Mermaid graphs for the current single graph runtime. Use when the user wants dialogue-driven MMD generation, role-repo-aware authoring with @roleId mentions, txt structure previews, or prompt/skill instructions that keep generation inside the repository's supported Mermaid subset.
---

# OGSystem NL To MMD

Generate Mermaid for the current OGSystem graph runtime, not a hypothetical future DSL.

Target outcome:

- runnable on the current parser/runtime
- compatible with `src/runtime/parse-mermaid.ts`
- validated against the local role repo, model selection/catalog, and optional law/profile config
- generated through dialogue confirmation when requirements are incomplete
- accompanied by a plain `txt` structure preview during drafting

## What This Skill Must Do

1. Read the user requirement and normalize it into:
   - system goal
   - entry role
   - roles and responsibilities
   - transitions and event names
   - law id
   - execution bindings
   - whether parallel split / join / loop are actually needed
2. Resolve `@roleId` mentions against `og-roles/roles/<roleId>/`.
3. If key information is missing, ask up to 3 concrete confirmation questions.
4. Once enough information exists, generate Mermaid strictly inside the supported subset.
5. Produce a plain text structure view for human confirmation.
6. Run the validator before treating the graph as final.

## Supported Dictionary

This section is the hard boundary. Do not generate syntax outside this range.

### Flowchart Header

Allowed:

- `flowchart TD`
- `flowchart LR`

### Boundary Tokens

Allowed:

- `input`
- `output`

Forbidden:

- `start`
- `end`
- `done`

### Node Token

Allowed pattern:

- `nodeId[Role:roleId]`

Current parser regex truth:

- `nodeId` and `roleId` may contain `A-Z a-z 0-9 . _ : -`

### Edge Token

Allowed pattern:

- `from -->|EVENT| to`

Allowed executable edge forms:

- `input -->|EVENT| roleNode[Role:roleId]`
- `roleNodeA[Role:roleA] -->|EVENT| roleNodeB[Role:roleB]`
- `roleNode[Role:roleId] -->|EVENT| output`

### Metadata Keys

Exact keys allowed:

- `%% engine=langgraph`
- `%% system.id=...`
- `%% system.version=...`
- `%% law.global=...`
- `%% entry.role=...`

Prefix keys allowed:

- `%% exec.bind.<roleId>=<profileId>`
- `%% model.bind.<roleId>=<modelId>`
- `%% role.mode.<roleId>=parallel_split`
- `%% join.mode.<roleId>=all_of`
- `%% join.mode.<roleId>=quorum_of`
- `%% join.sources.<roleId>=roleA,roleB,...`
- `%% join.min.<roleId>=<positiveInteger>`
- `%% loop.max.<roleId>=<positiveInteger>`
- `%% route.order.<roleId>=roleA,roleB,...`
- `%% handoff.mode=strict`
- `%% handoff.contracts=<relative-json-path>`
- `%% review.mode.<roleId>=required`
- `%% review.timeout.<roleId>=<positiveIntegerSeconds>`
- `%% review.timeout.action.<roleId>=pause|terminate`
- `%% review.rework.target.<roleId>=<roleId>`
- `%% review.rework.max.<roleId>=<nonNegativeInteger>`
- `%% review.terminate.scope.<roleId>=branch|run`
- `%% context.map.<roleId>.<fieldName>=<selector>`

Do not generate any other metadata key.

### Graph Semantics Supported Today

Supported:

- sequential flow
- branching
- `parallel_split`
- `all_of` join
- `quorum_of` join with `join.min`
- bounded loop via `loop.max`
- deterministic route order via `route.order`
- projected role input via `context.map`
- strict handoff contracts via `handoff.mode=strict` and `handoff.contracts`
- runtime-native human review via `review.*`
- runtime failure routing via role-only `ERROR` and `ERROR.<errorCode>` edges
- `model.bind` as the preferred execution binding
- `exec.bind` as the current local-shell execution binding

Not supported:

- custom routing modes
- custom join modes
- arbitrary engine names
- non-Mermaid orchestration syntax
- hidden metadata invented by the model
- executable role outputs using `ERROR*` events; ERROR* is runtime-only failure routing

## Runtime Truth

Prefer these rules for the current development-test release:

- use `model.bind.<roleId>=<modelId>`
- use direct `provider/model` refs or the current project model selection/catalog
- use existing role ids from `og-roles/roles/*`
- keep role semantics in the role repo, not in Mermaid comments
- use `review.*` metadata instead of modeling human review as a fake reviewer role when the user asks for human-in-loop approval
- use JSON Schema role output packages for structured output instead of relying only on prompt text that says "return JSON"

Use `exec.bind` for roles that intentionally execute a local profile/tool; use `model.bind` for
OpenCode model execution. Do not invent a second binding or fallback syntax.

### Context Map Selectors

Allowed selector families:

- `direct.content`
- `direct.data.<field>`
- `source(<roleId>).content`
- `source(<roleId>).data.<field>`
- `global.task`
- `global.user_profile.<field>`
- `global.human_review.current.<field>`
- Optional selectors may end with `?`, for example `global.human_review.current.comment?`.

Rules:

- `source(<roleId>)` selectors are for join roles and must reference roles in `join.sources.<joinRoleId>`.
- If `join.mode.<joinRoleId>=quorum_of` and `join.min` is below the number of sources, do not use `source(<roleId>)` selectors because some sources may be absent.
- Use optional `global.human_review.current.*?` selectors for first-run/rework flows where no review exists yet.

### Human Review Metadata

Use this pattern for runtime-native review:

```mermaid
%% review.mode.<roleId>=required
%% review.timeout.<roleId>=86400
%% review.timeout.action.<roleId>=pause
%% review.rework.target.<roleId>=<roleId>
%% review.rework.max.<roleId>=2
%% review.terminate.scope.<roleId>=branch
%% context.map.<roleId>.review_comment=global.human_review.current.comment?
%% context.map.<roleId>.review_round=global.human_review.current.round?
```

Do not add a synthetic `reviewer` role solely to represent the human decision when runtime-native `review.*` is intended.

### ERROR* Routing

Allowed ERROR* edges:

- `roleNode[Role:roleId] -->|ERROR| handler[Role:error-handler-base]`
- `roleNode[Role:roleId] -->|ERROR.<CODE>| handler[Role:error-handler-base]`

Rules:

- ERROR* edges can only originate from role nodes, never `input`.
- Runtime tries `ERROR.<errorCode>` first, then falls back to `ERROR`.
- Role output schemas should not include ERROR* events; executable roles must not emit `ERROR` or `ERROR.<CODE>` themselves.

## Role Mention Rules

User input may reference roles like:

- `@debate-judge`
- `@diagnosis-dispatch`

When a role is mentioned:

- if it exists in `og-roles/roles/`, keep the exact `roleId`
- if it does not exist, do not silently invent a runnable role package
- ask the user whether to switch to an existing role or create a new role package first

## Dialogue Procedure

Use this turn policy:

### Mode 1: Ask

Use when any of these is unclear:

- entry role
- final output role
- event names
- whether branching/parallel/join/loop is truly required
- whether quorum, context projection, human review, ERROR* compensation, route ordering, or handoff contracts are needed
- law id
- whether to use `model.bind` or `exec.bind`
- the exact existing role to use for an `@roleId` mention

Ask at most 3 short questions.

### Mode 2: Draft

Use when most constraints are known but the user should still confirm routing or bindings.

Return:

1. Mermaid source
2. a short assumptions list
3. a plain `txt` structure preview
4. the validator command

### Mode 3: Final

Use when:

- all required constraints are known
- Mermaid stays inside the supported subset
- referenced roles exist
- referenced models exist
- validator passes, or remaining warnings are explicitly acceptable

Return:

1. Mermaid source
2. plain `txt` structure preview
3. validation result summary
4. validation command

## Txt Preview Contract

During drafting, print a non-Markdown plain text structure view similar to:

```txt
SYSTEM architecture.debate.current v1.0.0
LAW law.debate.base
ENTRY debate-moderator

ROLES
  debate-moderator [model=fast-gpt54, mode=parallel_split, loop.max=2]
  debate-minimalist [model=balanced-gpt52]
  debate-alignmentist [model=deep-o3]
  debate-judge [model=deep-o3, join=all_of, sources=debate-minimalist,debate-alignmentist]
  debate-summary [model=steady-gpt54]

CONNECTIONS
[input]
  --DEBATE_REQUEST--> debate-moderator [model=fast-gpt54, mode=parallel_split, loop.max=2]
[debate-moderator]
  --SEND_MINIMALIST--> debate-minimalist [model=balanced-gpt52]
  --SEND_ALIGNMENTIST--> debate-alignmentist [model=deep-o3]
[debate-judge]
  --REBUTTAL_NEEDED--> debate-moderator [model=fast-gpt54, mode=parallel_split, loop.max=2]
  --DECISION_READY--> debate-summary [model=steady-gpt54]
```

The preview is for human confirmation and must remain plain text, not Mermaid and not Markdown explanation.

## Naming Rules

Use these defaults unless the user gives exact names:

- `roleId`: prefer lowercase kebab-case semantic ids
- `nodeId`: usually same as `roleId` when readable
- `event`: uppercase snake case
- `system.id`: dotted lowercase semantic id

Good event names:

- `REQUEST_RECEIVED`
- `CASE_RECEIVED`
- `DECISION_READY`
- `SUMMARY_READY`

Avoid vague names:

- `DONE`
- `NEXT`
- `OK`

## Self-Check Before Returning Mermaid

Check all of these:

- Mermaid starts with `flowchart TD` or `flowchart LR`
- required metadata exists
- metadata keys stay inside the allow-list
- `entry.role` exists in the graph
- each edge has a non-empty event label
- each role id is non-reserved
- role/node mapping stays 1:1
- every referenced `model.bind` role exists
- every referenced `exec.bind` role exists
- every `role.mode` value is `parallel_split`
- every `join.mode` value is `all_of` or `quorum_of`
- every `join.sources` source really has a Mermaid edge into the join role
- every `quorum_of` join has a valid `join.min`
- every `loop.max` is a positive integer
- every `review.*` block has `review.mode.<roleId>=required`
- every ERROR* edge originates from a role node and is not listed in role output schema events
- referenced role packages exist locally
- referenced model packages exist locally
- outgoing Mermaid events match role output event enums when those enums exist

## Validation

Use the bundled validator after generation:

```bash
node skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs --system <file.mmd>
```

Useful extended form:

```bash
node skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs \
  --system <file.mmd> \
  --laws .ogs/laws.json \
  --user-profile .ogs/user-profile.json
```

The validator checks:

- Mermaid parsing against the current parser
- role package existence and contract
- model package existence
- optional profile existence for `exec.bind`
- law existence and noop policy
- event enum alignment with role output schema

## Preferred Repository Sources

Read these in order when needed:

- `src/runtime/parse-mermaid.ts`
- `src/nl2mmd/*.ts`
- `docs/usage-manual.md`
- `docs/DECISIONS.md`
- `docs/archive/history/mermaid-dsl-v0.1.md`
- `og-roles/roles/*`
- `og-models/models/*`

If docs conflict with parser truth, follow parser truth.
