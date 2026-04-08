# OGSystem Role Repo Minimal Plan

Date: 2026-04-09  
Status: landed

## 1. Goal

Keep `OGSystem` focused on:

- system orchestration
- event routing
- runtime state control
- audit and projection

Move reusable role content out of `OGSystem` into a separate role repository.

Do not change current tool execution behavior in this phase.

## 2. Design Principles

### 2.1 Keep Responsibilities Narrow

- `OGSystem` defines graph structure and runtime rules.
- `Role Repo` defines node behavior and output contract.
- `profiles/tools` continue to define execution configuration.

### 2.2 System Owns Flow

Roles must not define system routing.

Roles may know:

- what task to perform
- what style to use
- what output shape to emit

Roles must not know:

- which node executes next
- system-level join policy
- loop policy
- law policy

### 2.3 Output Must Stay Machine-Stable

All executable roles must emit strict JSON:

```json
{"event":"EVENT_NAME","content":"...","data":{}}
```

Rules:

- `event` is required when outgoing flows exist
- `event` must match one allowed event exactly
- `content` is human-readable payload
- `data` is optional structured payload
- no free-form text outside JSON

### 2.4 Keep Current Execution Path

Do not redesign:

- `profiles.json`
- `tools.json`
- tool runner
- CLI invocation model

Only replace `role-prompts.json` with role package resolution.

## 3. Target Architecture

### 3.1 Repositories

`role repo`

```txt
og-roles/
  registry.json
  schemas/
    role.schema.json
  roles/
    debate-minimalist/
      role.json
      persona.md
      work.md
      prompt.md
      output.schema.json
    diagnosis-cardiology/
      role.json
      persona.md
      work.md
      prompt.md
      output.schema.json
```

`OGSystem`

```txt
systems/
  current-debate/
    system.mmd
    assembly.json
    laws.json
    profiles.json
    tools.json
```

### 3.2 Runtime Assembly

```txt
system.mmd
-> parse graph
-> load assembly.json
-> resolve roleRef
-> render prompt from role package + runtime context
-> execute with current profile/tool path
-> validate JSON output
-> route by event
```

## 4. Role Package Contract

### 4.1 Required Files

- `role.json`
- `prompt.md`
- `output.schema.json`

Optional:

- `persona.md`
- `work.md`
- examples

### 4.2 role.json

Minimal shape:

```json
{
  "roleId": "debate-minimalist",
  "roleVersion": "1.0.0",
  "name": "Minimalist Debater",
  "description": "Argues for minimal implementation first.",
  "promptTemplate": "prompt.md",
  "outputSchema": "output.schema.json",
  "tags": ["debate", "architecture"]
}
```

### 4.3 prompt.md

Recommended template:

```md
{{persona}}

{{work}}

Task:
{{task}}

Context:
{{context}}

Allowed events:
{{allowed_events}}

Last output:
{{last_output}}

Output requirements:
- Return JSON only
- event must be one of allowed_events
- content must be concise and concrete
```

### 4.4 output.schema.json

Recommended baseline:

```json
{
  "type": "object",
  "required": ["event", "content"],
  "properties": {
    "event": { "type": "string" },
    "content": { "type": "string" },
    "data": { "type": "object" }
  },
  "additionalProperties": false
}
```

## 5. Ogsystem Assembly Contract

### 5.1 system.mmd

`system.mmd` should contain only:

- roles
- flows
- entry
- join metadata
- loop metadata
- law binding
- execution profile binding

It should not contain full role prompt content.

### 5.2 assembly.json

Purpose:

- bind system node -> role package
- provide prompt args
- keep role identity separate from execution profile

Minimal shape:

```json
{
  "nodes": {
    "minimalist": {
      "roleRef": "file:../og-roles/roles/debate-minimalist",
      "profileRef": "profile.minimalist.claude",
      "promptArgs": {
        "task": "Argue for minimal implementation first."
      }
    }
  }
}
```

### 5.3 Allowed roleRef schemes

Phase 1:

- `file:`

Phase 2:

- `github:org/repo/path@version`

Do not implement network fetch in phase 1.

## 6. Event Flow Best Practices

### 6.1 Events Belong To System

Outgoing events are defined by graph edges, not by role package.

Runtime injects:

- `allowed_events`

Role must choose from that list.

### 6.2 Keep Event Names Stable

Use clear, domain-relevant names:

- `MINIMALIST_DONE`
- `ALIGNMENTIST_DONE`
- `CONSENSUS_READY`
- `REQUEST_RECHECK`

Avoid vague names:

- `DONE`
- `NEXT`
- `OK`

### 6.3 Validate Before Routing

For each node output:

1. parse JSON
2. validate output schema
3. validate `event` against outgoing edges
4. then route

No regex fallback.

## 7. Runtime Context Best Practices

Inject only a small stable context surface into roles:

- `task`
- `context`
- `allowed_events`
- `last_output`
- `system_notes`
- `round`

Do not inject whole runtime internals.

## 8. Migration Strategy

### Phase 1

- keep `profiles.json`
- keep `tools.json`
- keep current tool runner
- add `assembly.json`
- add local file-based role resolution
- deprecate `role-prompts.json`

### Phase 2

- add role schema validation
- add rendered prompt snapshot tests
- add role package version lock file

### Phase 3

- add optional GitHub-based role refs
- add role cache and lock resolution

## 9. Risks And Controls

### Risk: role prompt becomes system-aware

Control:

- keep routing state out of role package
- inject only `allowed_events`

### Risk: role package and runtime output diverge

Control:

- require `output.schema.json`
- validate at runtime

### Risk: same role behaves differently across systems

Control:

- keep role generic
- move system-specific task wording into `assembly.json.promptArgs`

### Risk: role repo adds execution concerns

Control:

- forbid `toolRef`, `command`, `timeoutMs` in role package schema

## 10. Recommended First Scope

Start with these roles:

- `debate-moderator`
- `debate-minimalist`
- `debate-alignmentist`
- `debate-judge`
- `diagnosis-cardiology`
- `diagnosis-neurology`
- `diagnosis-chief-review`

These cover both existing LangGraph design examples.

## 11. Execution Checklist

### P0

- [x] create `og-roles` repository
- [x] define `role.schema.json`
- [x] create 4 debate role packages
- [x] create 3 diagnosis role packages
- [x] add `assembly.json` support in `OGSystem`
- [x] add file-based role resolver
- [x] add prompt renderer for `prompt.md`
- [x] inject `allowed_events` and `last_output`
- [x] validate role package output against `output.schema.json`

### P1

- [x] migrate debate example from `role-prompts.json` to `assembly.json + roleRef`
- [x] migrate expert consultation example the same way
- [x] add tests for role resolution
- [x] add tests for rendered prompt inputs
- [x] add tests for output schema validation failures

### P2

- [x] add `roles.lock.json`
- [x] support versioned local role refs
- [x] add GitHub role ref design
- [x] document role authoring guide

## 12. Done Criteria

- [x] `role-prompts.json` is no longer required for migrated systems
- [x] a node can resolve its prompt from role repo + assembly context
- [x] output is schema-validated before routing
- [x] profiles/tools execution path is unchanged
- [x] debate and consultation systems both work with role refs
