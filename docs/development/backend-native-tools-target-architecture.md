# Backend Native Tools Target Architecture

## 1. Goal

The target architecture separates business configuration from technical execution:

```text
Role = business responsibility and acceptance
Backend = model and native tools
Runtime = resource boundaries, audit, and recovery
Adapter = mapping to backend-native configuration
```

The default execution policy is automatic. A Role uses all verified native tools exposed by its selected Backend unless an explicit technical restriction is configured. Business Human Review happens after a Role produces a durable result and before the graph hands off to the next Role.

## 2. Target Architecture

```mermaid
flowchart TB
    subgraph Business["Business layer"]
        RC["Role Contract v2<br/>responsibility / inputs / outputs / acceptance"]
        IR["Semantic IR<br/>roles / topology / state / handoffs / review"]
        HR["Business Human Review<br/>approve / rework / pause / terminate"]
    end

    subgraph Technical["Technical binding layer"]
        EB["Harness / API-Cmd Template<br/>Backend + Model or fixed invocation<br/>preset + optional overrides"]
        BR["Backend Registry"]
        CS["Capability Snapshot<br/>models / native tools / enforceable resources"]
    end

    subgraph Runtime["Runtime execution layer"]
        PR["Policy Resolver<br/>effective tools and environment policy"]
        LAW["Law / quota / staging"]
        PLAN["Execution Plan"]
        SNAP["Run resolved config<br/>frozen snapshot / policy / law digest"]
    end

    subgraph Adapter["Adapter mapping layer"]
        AD["Backend Adapter"]
        MAP["EnvironmentPolicy mapping"]
    end

    subgraph Backend["Backend capability layer"]
        BS["Backend native session"]
        MODEL["Backend model"]
        NT["Native tools<br/>read / edit / command / MCP / search"]
        PP["Native permission protocol"]
    end

    subgraph Evidence["Evidence layer"]
        AUDIT["Runtime audit"]
        RECOVERY["Recovery / resume"]
        ARTIFACT["Artifact verification"]
    end

    RC --> IR
    IR --> HR
    EB --> PR
    BR --> CS
    CS --> PR
    LAW --> PR
    IR --> PLAN
    PR --> PLAN
    PLAN --> SNAP
    PLAN --> AD
    AD --> MAP
    MAP --> BS
    MODEL --> BS
    CS --> AD
    BS --> NT
    BS --> PP
    NT --> AUDIT
    PP --> AUDIT
    BS --> AUDIT
    AUDIT --> RECOVERY
    BS --> ARTIFACT
    ARTIFACT --> HR
    HR --> IR
```

## 3. Layering and Responsibility

### Layering

The target product model has four layers. Capability discovery, policy resolution, permission enforcement, adapters, and the Backend runtime remain separate implementation modules inside the execution layer; they are not separate user configuration concepts.

```mermaid
flowchart TB
    B["Business layer<br/>Role Contract + Flow Semantic IR"]
    T["Technical binding layer<br/>Backend + Model + preset + optional overrides"]
    X["Execution layer<br/>Capability + Policy + Permission + Adapter + Backend"]
    E["Evidence layer<br/>Audit + Artifacts + Recovery + Review records"]

    B --> T
    T --> X
    X --> E
    B --> E
```

### Layer responsibilities

| Layer | Owns | Receives | Produces | Must not own |
| --- | --- | --- | --- | --- |
| Business | responsibility, inputs, outputs, acceptance, topology, state, events, handoffs, Human Review source | business requirements and graph design | Role Contract and Semantic IR | Backend, model, native tool, resource permission |
| Technical binding | Harness Template or API/Cmd Template | project or TeamVersion technical configuration | binding input for execution | business acceptance rules, native tool implementation |
| Execution | capability discovery, snapshot, effective policy, permission allow/deny, staging, Law, quota, Adapter, Backend session | technical binding, Backend, Run context, and business execution plan | Role result, native tool events, execution outcome | business review decisions and mutable Role configuration |
| Evidence | audit, artifacts, recovery, Human Review records | events and durable results from all relevant layers | replayable Run evidence | mutable business and technical configuration |

### Dependency direction

Dependencies flow downward for execution and upward only as evidence:

```text
Business -> Technical binding -> Execution -> Evidence
Business ---------------------> Evidence (business review state)
```

Inside the Execution layer:

```text
Capability = what the Backend can provide and enforce
Technical policy = what this Run chooses within those capabilities
Permission = the final allow/deny result for one resource request
Adapter = the mapping from policy to Backend-native parameters
Backend = the model and native tools that execute the request
```

Capability is descriptive, while permission is prescriptive and runtime-scoped. Permission is not a separate business layer or a user-facing tool approval model.

### User Page Configuration by Layer

The UI should expose the layers according to ownership. It should not turn internal Backend implementation details into business configuration.

```mermaid
flowchart TB
    BP["Business Design page"] --> L1U["L1 Role Contract"]
    BP --> L2U["Business Flow Semantic IR"]
    TP["Technical Binding page"] --> L3U["Technical binding"]
    CP["Capability / Readiness panel"] --> L4U["Execution layer<br/>capability read-only"]
    RP["Run / Diagnostics panel"] --> L5U["Execution layer<br/>effective policy read-only"]
    RP --> EU["Evidence Layer<br/>audit / artifacts / recovery"]
    L3U --> L5U
    L4U --> L5U
    L5U --> EU
```

| Page or panel | Layers involved | User can edit | User can only inspect |
| --- | --- | --- | --- |
| Business Design / Role | Business | purpose, responsibility, inputs, outputs, acceptance criteria, business failure semantics | resolved Backend and technical policy summary |
| Business Design / Flow | Business | roles, edges, events, topology, joins, loops, Human Review requirement | compiled business flow diagnostics |
| Technical Binding | Technical binding | Backend, model, execution preset, optional advanced overrides | binding validation and unresolved references |
| Capability / Readiness | Execution | refresh discovery or select a verified Backend/model | verified models, native tools, enforceable resources, snapshot time and digest |
| Runtime Policy / Diagnostics | Execution | normally none; technical overrides are edited in Technical Binding | effective tools, staging root, Law, quota, degradation, allow/deny reasons |
| Adapter / Backend Diagnostics | Execution | normally none | native permission mapping, adapter version, unsupported policy fields, native tool events |
| Run / Evidence / Review | Evidence | Human Review decision, rework, pause, terminate | tool calls, permission decisions, artifacts, errors, recovery history |

The normal user workflow is:

```text
Business Design
  -> Technical Binding
  -> Execution capability validation and policy calculation
  -> Adapter starts Backend
  -> Run Evidence and Human Review
```

The Execution layer contains capability discovery, policy calculation, permission enforcement, adapter mapping, and the Backend session. It is not exposed as several independent business configuration surfaces.

## 4. User Page Design

The user-facing product exposes two configuration pages and two operational pages. Capability, permission, and adapter internals remain automatic or read-only diagnostics.

### 4.1 Business Design

Business Design is the primary authoring page. It contains Role and Flow tabs.

#### Role tab

```text
Role identity
  Role ID (system-managed)
  Display name
  Purpose

Responsibility
  Responsibility kind
  Owned business state
  Contributes
  Does not own

Input contract
  Business fields
  Type
  Required / optional
  Business constraints
  Preconditions

Output contract
  Result fields
  Type
  Artifact declarations
  Postconditions
  Acceptance criteria
```

The user does not configure Backend, native tools, API/Cmd commands, or permission parameters on this tab.

#### Flow tab

```text
Role nodes
Handoff edges
Event labels
Conditional routes
Join mode and sources
Loop budget
Human Review gate
```

The Flow is the single source for routable event names. The system compiles outgoing event labels into the Role's `allowed_events` runtime field.

### 4.2 Technical Binding

Technical Binding is a separate page for project or TeamVersion maintainers.

```text
Backend
  Select an installed and verified Backend

Model
  Select a model discovered from the selected Backend

Execution preset
  Default: Backend recommended preset

Advanced overrides (collapsed by default)
  Optional allowedTools
  Optional filesystem/process/network overrides
  Optional timeout and quota overrides
```

The normal page only requires Backend and Model. The selected Backend supplies the default native tools, environment policy, adapter parameters, and recommended limits through its execution preset. The Runtime still owns the enforceable staging boundary and platform safety limits. Advanced overrides are optional and are stored as differences from the preset rather than as a complete duplicate policy.

The tool list is read from the Backend Capability Snapshot. Users cannot create a Model Role tool, edit a native tool command, or configure Backend-specific flags such as `sandboxPolicy` or `allow dangerous`.

### Harness Template as the Model Role Binding

The primary purpose of a `Harness Template` is to bind a Model Role to the Backend that will run it and to a model offered by that Backend. The Backend is the source of truth for the CLI/adapter, model catalog, native tools, and supported permission mapping. A template does not invent a second tool or model system.

The reusable technical template for a Model Role represents the complete CLI/Backend harness in which the Role runs:

```text
Harness Template
  Backend / CLI adapter identity
  Model exposed by that Backend
  Backend-supported native tools
  Backend permission and resource mapping
  Optional filesystem/process/network policy overrides
  Optional timeout and quota overrides
```

The user-facing relationship becomes:

```text
Model Role -> Harness Template -> current Backend -> selected Backend model
                                  \-> Backend native tools and permission mapping
```

Each Model Role has its own resolved Harness Template reference. Different Roles may select different templates, and multiple Roles may reuse one template when that is intentional. A project or TeamVersion may define a default Harness Template for Model Roles that do not select one explicitly; this is an explicit fallback, not an invisible global execution policy.

Persist only one user-facing technical object per invocation kind. Do not create separate
binding or execution-template objects in addition to Harness and API/Cmd Templates. The
recommended storage shape is:

```json
{
  "version": 1,
  "harnessTemplates": {
    "codex-default": {
      "kind": "harness",
      "backend": "codex",
      "model": "gpt-6-luna",
      "preset": "backend-default",
      "tools": { "mode": "all" },
      "permissions": {
        "filesystem": { "read": true, "write": true },
        "process": true,
        "network": false
      },
      "limits": {
        "timeoutMs": 600000,
        "maxOutputBytes": 200000,
        "maxStorageBytes": 200000000
      }
    },
    "codex-no-network": {
      "kind": "harness",
      "backend": "codex",
      "model": "gpt-6-luna",
      "preset": "backend-default",
      "tools": { "mode": "all" },
      "permissions": {
        "filesystem": { "read": true, "write": true },
        "process": true,
        "network": false
      }
    }
  },
  "apiCmdTemplates": {
    "local-shell-builder": {
      "kind": "api_cmd",
      "runner": "command",
      "toolRef": "tool.local.shell.builder",
      "command": "build-script"
    }
  },
  "defaults": {
    "harnessTemplate": "codex-default"
  },
  "roles": {
    "writer": { "harnessTemplate": "codex-default" },
    "reviewer": { "harnessTemplate": "codex-no-network" },
    "builder": { "apiCmdTemplate": "local-shell-builder" }
  }
}
```

Harness binding rules:

```text
backend:
  Required. Identifies the installed Backend/CLI adapter used to create the session.

model:
  Required. Must be present in the selected Backend's verified model catalog.
  A model reference is not portable to a different Backend unless that Backend
  exposes the same model and the binding is revalidated.

preset:
  Optional Backend-owned defaults for native tools, permissions, and limits.

tools and permissions:
  Optional differences from the Backend preset. They can only refer to tools and
  resources exposed and enforceable by the selected Backend/Adapter. `permissions`
  expresses resource policy intent; it is not a per-tool approval workflow.

tools.mode:
  `all` uses every verified native tool exposed by the selected Backend. The default
  is `all` when the tools object is omitted.

tools.allowedTools:
  Optional technical allow-set used when `mode` is `allowlist`. Every entry must
  exist in the selected Backend capability snapshot.
```

Changing `backend` invalidates the model, tool, and permission resolution until the
new Backend is discovered and the template passes readiness. Changing `model` keeps
the Backend but reruns model-specific readiness and freezes the resulting capability
snapshot for the next Run.

In this model:

```text
Harness Template:
  Project or TeamVersion-owned reusable CLI/Backend technical binding.

Backend preset:
  Backend-owned default values, resolved internally and not a second user configuration object.

Capability Snapshot:
  Generated and frozen at Run start; not manually authored.

Effective Policy:
  Computed by Runtime from the environment, capabilities, Law, staging, and quota.
```

The Harness Template is a configuration template. The Capability Snapshot and Effective Policy are execution results. This keeps the user model small while preserving deterministic recovery.

### Default Harness Template

Defaults are resolved in this order:

```text
1. Role.harnessTemplate
2. TeamVersion or project default harnessTemplate
3. Backend-owned default preset for the selected Backend
4. Readiness error when no Backend can be resolved
```

The default is applied when a Model Role is created or when its binding is resolved. The resolved Role-to-Harness reference is written into the Run snapshot, so recovery never depends on a later default change.

Backend-owned presets are read-only. Project or TeamVersion default Harness Templates can be customized and versioned.

### Team Import and Export

The Team package should carry business structure, logical Harness Templates, and logical API/Cmd Templates, not machine-specific execution state.

```text
Team export includes:
  Role Contracts
  Flow / Semantic IR
  Input and output schemas
  Acceptance criteria
  Human Review configuration
  Harness Templates
  API/Cmd Templates
  Role -> Harness or API/Cmd Template references
```

The Team package excludes:

```text
Backend native tool implementations
Local command paths
Backend sandbox or approval internals
Capability Snapshots
Effective Policies
Run staging directories
Audit, Artifact, and Recovery records
Credentials and Secrets
Machine-specific Backend discovery results
```

Import resolves technical availability in the target environment:

```text
Import Team
  -> Read Roles and Flow
  -> Read Harness Templates
  -> Resolve Backend and Model against local Backend Registry
  -> Generate a new Capability Snapshot
  -> Recalculate Effective Policy
  -> Run Readiness
```

When a target environment does not have a referenced Backend or Model, the Team can still be imported. The Harness Template is marked unresolved and the Team cannot be released or run until the binding is repaired.

API/Cmd Role packages use `API/Cmd Template -> API/Cmd runner`. Their export contains logical API/Cmd references and reviewed argument templates, but not host-specific absolute paths, credentials, or generated execution artifacts. Local command and dependency readiness is checked after import.

This keeps the portable Team package small:

```text
Team package
  = business structure + Harness Templates

Project / machine
  = Backend, Model, Capability, Adapter, and local resources

Run
  = frozen technical snapshot, audit, recovery, and delivery evidence
```

For an API/Cmd Role, the page shows a separate API/Cmd Template binding:

```text
API/Cmd template
API or command reference
Command and argument template
Stdin mode
Timeout and output limit
```

### 4.3 Runtime Diagnostics

Runtime Diagnostics is read-only. It explains the technical decision generated for the current Run:

```text
Selected Backend and model
Capability Snapshot digest and verification time
Effective native tools
Execution staging root
Effective filesystem/process/network policy
Law and quota constraints
Capability degradation
Allow/deny reasons
Adapter mapping summary
```

The page explains why a capability is unavailable, but is not a second policy editor.

### 4.4 Evidence and Review

Evidence and Review is the operational page:

```text
Role result
Acceptance criteria status
Artifacts and verification
Native tool invocation history
Permission allow/deny history
Errors and recovery history
Human Review decision
```

Human Review actions are:

```text
Approve -> continue graph flow
Rework -> return to configured Role
Pause -> keep the Run waiting
Terminate -> end the Run
```

These actions are business decisions. They do not approve or reject individual Backend tool calls.

### 4.5 Page Save and Readiness Rules

Business Design save checks:

```text
Role responsibility is present
Input and output business schemas are valid
Flow endpoints and event labels are valid
Join and loop settings are consistent
Human Review targets are resolvable
```

Technical Binding save checks:

```text
Backend is installed and verified
Model belongs to the selected Backend
Every allowedTools entry exists in the Capability Snapshot
Requested environment resources are expressible by the Adapter
Required limits are valid
```

Run readiness checks:

```text
Capability Snapshot is frozen
Effective Policy can be calculated
Execution staging can be created
Law and quota checks pass
All explicitly selected technical capabilities are enforceable
```

The normal navigation is:

```text
Business Design -> Technical Binding -> Readiness -> Run -> Evidence / Review
```

### 4.6 Optimized Page Information Architecture

The four-layer architecture should not become four separate technical pages. The product navigation should expose three main workspaces:

```text
Design
  Business Design: Role and Flow

Environments
  Harness Templates and API/Cmd Templates

Operate
  Run status, evidence, recovery, and Human Review
```

Capability discovery, effective policy, and Adapter mapping appear as read-only details inside Environments and Operate. They do not become primary navigation items.

#### Design workspace

```text
Left: Role list and Flow element list
Center: Flow canvas
Right: selected Role or Flow business inspector
```

The Role inspector contains only:

```text
Purpose
Responsibility
Input fields
Output fields
Acceptance criteria
```

The Flow inspector contains:

```text
Source and target Role
Event label
Condition
Join / Loop settings
Review before handoff
```

The Role inspector contains a compact `Harness Template` selector for Model Roles or an
`API/Cmd Template` selector for API/Cmd Roles. It saves only the template reference,
not Backend tools or permission fields. A `View template` action opens the shared
template details without duplicating them in the Role configuration.

#### Environments workspace

```text
Left: Harness and API/Cmd Template list
Center: selected template summary
Right or drawer: advanced customization
```

The default view shows:

```text
Template name
Template kind
Backend
Model
Default status
Roles using this template
```

The advanced view shows:

```text
allowedTools override
Filesystem intent
Process intent
Network intent
Timeout and quotas
```

Capability Snapshot, effective tools, enforceability, and Adapter mapping are read-only sections below the form or in a diagnostics drawer. Switching Backend or Model refreshes these sections and validates existing overrides.

The primary action is `Use default`. The secondary action is `Customize`, which creates
or updates a Harness Template rather than adding fields to each Role. Changing a Role's
selector changes its technical binding; editing a shared template can affect every Role
that references it and therefore creates a new template revision for released
TeamVersions.

#### Operate workspace

```text
Run status
Flow progress
Current Role
Current Harness or API/Cmd Template
Effective policy summary
Artifacts
Audit timeline
Recovery controls
Human Review panel
```

The Human Review panel is shown only when the current Role has reached its post-execution review gate. Its actions are `Approve`, `Rework`, `Pause`, and `Terminate`. Native tool permission decisions remain in the audit timeline and are not presented as user approval tasks.

#### Progressive disclosure rules

```text
Default view:
  business fields, Harness Template name, Backend, Model, readiness status

Advanced view:
  tool and environment overrides, limits, degradation details

Diagnostic view:
  Capability Snapshot, Adapter mapping, native permission events, raw audit data
```

The user should be able to complete a normal Role setup without seeing a native tool name. Technical detail is available for diagnosis and deliberate customization, but it is not required for ordinary business authoring.

### Input and Output Configuration

Input and output configuration is split between user-owned business data and Runtime-owned execution data.

#### User must configure

```text
Input business fields:
  field name, meaning, type, required/optional status, and business constraints

Input preconditions:
  facts that must be true before the Role starts

Output business fields:
  result fields, artifact declarations, and their business meaning

Output acceptance criteria:
  checks that determine whether the result is acceptable

Business outcome events:
  READY, BLOCKED, APPROVED, REWORK, or other events used by the Flow
```

The user defines the business schema, but does not manually repeat Runtime envelope fields.

#### Runtime generates or injects

```text
task and original user input
allowed_events derived from outgoing Flow edges
upstream and join context selectors
runId, roleId, executionId, branchId, and loop iteration
workspace root and artifact declaration envelope
technical tool and permission metadata
```

The Runtime prompt shell and audit envelope are not part of the business input/output schema.

#### Suggested, then confirmed by the user

```text
context map from upstream Flow edges to Role input fields
output schema skeleton from declared events and artifact declarations
event labels from outgoing Flow edges
required input fields inferred from the Role schema
```

The graph is the single source for routable event names. A Role Contract may expose the compiled event list for validation, but users should not maintain conflicting event lists in both the Role package and the Flow editor. Ambiguous context mappings require user confirmation before saving.

```text
Role Contract
  Business responsibility, inputs, outputs, acceptance criteria, and failure semantics.

Semantic IR
  Business topology, state, events, handoffs, joins, loops, and the single Human Review source.

Harness Template
  Backend, its selected model, Backend-native tool defaults, and optional environment overrides.

API/Cmd Template
  Fixed API or command invocation independent of a Model Role Backend.

Backend Registry
  Backend discovery, model catalog, native tool catalog, and resource enforcement capabilities.

Runtime
  Staging, Law, quotas, effective policy calculation, audit, and recovery.

Adapter
  Translation from the OGS environment policy to Backend-native parameters.

Backend
  Model inference, native tool execution, and native permission protocol.
```

Role packages do not define Backend tools, Harness configuration, API/Cmd templates, commands, or permission parameters.

## 5. Role Execution Paths

### Model Role

```mermaid
flowchart LR
    A["Model Role"] --> B["Harness Template"]
    B --> C["Current Backend + selected model"]
    C --> D["Capability Snapshot"]
    D --> E["Effective policy"]
    E --> F["Backend Adapter"]
    F --> G["Native session"]
    G --> H["Native tools"]
    H --> I["Tool / permission events"]
    I --> J["Audit"]
    G --> K["Role result"]
    K --> L["Business Human Review"]
    L --> M["Graph transition"]
```

Model Roles do not use API/Cmd Templates.

### API/Cmd Role

```mermaid
flowchart LR
    A["API/Cmd Role"] --> B["API/Cmd Template"]
    B --> C["API or command runner"]
    C --> D["API/Cmd result"]
    D --> E["Runtime audit"]
    E --> F["Human Review / graph transition"]
```

API/Cmd Templates are independent of Models and Backend native tools. They cover fixed API calls and commands such as compilers, converters, test runners, publishing scripts, and `tool.console.print`.

## 6. Role Contract

The business Role Contract does not contain Backend or tool configuration:

```json
{
  "contractVersion": 2,
  "roleId": "writer",
  "purpose": "Produce project documentation",
  "responsibility": {
    "kind": "atomic",
    "owns": ["document"],
    "contributes": [],
    "doesNotOwn": []
  },
  "inputs": {
    "preconditions": []
  },
  "outputs": {
    "events": ["BLOCKED", "READY"],
    "postconditions": [],
    "decisionCriteria": []
  },
  "authority": {
    "controlActions": ["approve", "pause", "rework", "terminate"]
  },
  "failure": {
    "retryableErrorCodes": [],
    "terminalErrorCodes": []
  },
  "audit": {
    "requiredFields": []
  }
}
```

`authority.controlActions` describes business decisions that may be taken. It does not declare whether Human Review is required. The review requirement has one source in the Semantic IR or graph definition; `ExecutionPlanNode.review` is only its compiled read-only projection.

## 7. Technical Binding Resolution

Technical template references are kept outside the business Role package, for example in `.ogs/execution-bindings.json` or the released TeamVersion. The file is a binding index; the user-facing technical objects remain Harness Templates and API/Cmd Templates.

The preferred persisted form is a template plus a Role-to-template reference. The expanded object below is the resolved form used by the Runtime.

```json
{
  "version": 1,
  "roles": {
    "writer": {
      "kind": "harness",
      "harnessTemplate": "codex-default"
    },
    "builder": {
      "kind": "api_cmd",
      "apiCmdTemplate": "local-shell-builder"
    }
  }
}
```

Rules:

```text
Backend preset omitted:
  Use the selected Backend's default execution preset.

tools, permissions, or limits omitted:
  Use the selected Backend/model preset's verified tools, resource policy,
  adapter settings, and limits.

tools.mode = allowlist:
  It is an optional technical allow-set and can only name tools from the Backend snapshot.
```

The initial model does not keep a separate `deniedTools` field. Users cannot create Model Role tools in OGS. The resolved policy is generated from the Backend preset and optional overrides.

## 8. Backend Capability Snapshot

The snapshot is frozen at Run start and reused during recovery:

For a Model Role, the snapshot always contains the resolved `backend` and `model` pair.
`model` is optional in the type only because the registry may also expose a Backend-level
snapshot before a model is selected.

```ts
type BackendCapabilitySnapshot = {
  backend: string;
  model?: string;
  adapterVersion: string;
  verifiedAt: string;
  tools: string[];
  enforceableResources: {
    filesystem: boolean;
    process: boolean;
    network: boolean;
  };
  permissionProtocol: "static" | "request" | "none";
  digest: string;
};
```

The resource booleans mean that the Adapter can actually enforce the resource boundary. They do not merely mean that the Backend theoretically supports the resource.

Capability sources are ordered as follows:

1. Backend protocol discovery;
2. Adapter static descriptor when discovery is unavailable;
3. No user-created descriptors.

Unverified or unenforceable capabilities are not included in the default effective set.

## 9. Capability, Technical Policy, and Permission

These concepts have different ownership and meaning:

```text
Capability
  What the selected Backend and Adapter can actually provide and enforce.

Technical policy
  What this Project and Run choose to permit within the available capabilities.

Permission decision
  The final allow/deny result for one resource request at execution time.
```

Capability is descriptive; it is not permission. A Backend may support process execution, but the Run policy may deny it. A policy may request network access, but the capability snapshot may show that the Adapter cannot enforce a network boundary; the effective policy must then deny it.

The relationship is:

```text
Backend capability snapshot
  + Harness Template or API/Cmd Template reference
  + Law / quota / staging
  -> Effective technical policy
  -> Permission allow / deny
```

The capability layer belongs to Backend discovery and readiness. The technical policy belongs to Runtime policy resolution. Permission is the enforcement result produced by Runtime and Adapter; it is not a second business configuration layer.

## 10. Flow Execution Model

The graph Flow remains a business handoff model. It does not contain native tool calls. A Role completes its responsibility, emits a business event, and the Runtime selects the next graph transition. Native tool activity is an internal execution trace for that Role.

```mermaid
sequenceDiagram
    participant F as Graph Flow
    participant R as Role Runtime
    participant P as Policy Resolver
    participant A as Backend Adapter
    participant B as Backend Session
    participant T as Native Tool
    participant U as Audit
    participant H as Human Review

    F->>R: Activate Role
    R->>P: Resolve binding, snapshot, Law, staging, and quota
    P-->>R: Effective tools and environment policy
    R->>A: Start Backend session in execution staging
    A->>B: Create native session

    loop Role work
        B->>A: Native tool/resource request
        A->>P: Check resource boundary
        alt Allowed
            P-->>A: allow
            A-->>B: Backend-native allow
            B->>T: Execute native tool
            T-->>B: Tool result
            B->>U: tool_invocation completed
        else Denied
            P-->>A: deny
            A-->>B: Backend-native reject
            B->>U: permission denied
        end
    end

    B-->>R: Structured Role result
    R->>U: Persist result and execution audit
    alt Human Review configured
        R->>H: Waiting for business review
        H-->>F: approve / rework / pause / terminate
    else No Human Review
        R-->>F: Emit business event and continue flow
    end
```

Flow transitions are driven by Role business events, not by individual native tool events. Tool events remain evidence and diagnostics; they do not become graph edges.

## 11. Effective Policy Calculation

The Runtime calculates one effective policy:

```text
verifiedTools
  intersect optional allowedTools when configured
  intersect tools whose resources are enforceable
= effectiveTools
```

If a configured `allowedTools` entry is not in the capability snapshot, readiness fails before execution. When `allowedTools` is omitted, the verified Backend tool set is used. A tool that is unavailable because its resource boundary cannot be enforced is denied when called and is recorded in audit; it does not stop the Role unless the binding explicitly selected that tool.

The effective environment policy is resource-oriented:

```ts
type EffectiveEnvironmentPolicy = {
  root: string;
  filesystem: {
    read: boolean;
    write: boolean;
  };
  process: boolean;
  network: boolean;
  limits: {
    timeoutMs: number;
    maxOutputBytes: number;
    maxStorageBytes: number;
  };
  degradation?: Array<{
    resource: string;
    reason: string;
  }>;
};
```

Default rules:

```text
filesystem.read = true inside execution staging
filesystem.write = true when the Backend can enforce the staging root
process = allow only when the Backend can enforce the process boundary
network = allow only when the Backend can enforce the network boundary
unknown tool = deny
unknown resource request = deny
```

All access remains subject to Law, staging, and quotas.

## 12. Permission Protocol

The Permission Protocol is a technical Backend control channel. It only returns:

```ts
type PermissionDecision = "allow" | "deny";
```

```mermaid
sequenceDiagram
    participant B as Backend
    participant A as Adapter
    participant R as Runtime
    participant U as Audit

    B->>A: Native tool/resource request
    A->>R: Resource permission request
    R->>R: Check staging, Law, quota, enforceability
    alt Allowed
        R-->>A: allow
        A-->>B: Backend-native allow
        B->>U: tool invocation completed
    else Denied
        R-->>A: deny
        A-->>B: Backend-native reject
        B->>U: permission denied
    end
```

There is no technical Permission Review. Human Review is a business gate after the Role result is durable and before graph handoff.

## 13. Human Review

```mermaid
flowchart LR
    A["Role execution"] --> B["Durable result"]
    B --> C{"Human Review configured?"}
    C -->|No| D["Graph transition"]
    C -->|Yes| E["Waiting for business review"]
    E -->|Approve| D
    E -->|Rework| F["Target Role"]
    E -->|Terminate| G["End Run"]
```

Human Review checks business acceptance. It does not decide whether a Backend may use a native tool.

## 14. Run Freeze and Recovery

At Run start, write `.ogs/runs/<run-id>/resolved-config.json` containing:

```text
Semantic IR digest
Resolved Harness/API-Cmd binding
Capability Snapshot
Effective EnvironmentPolicy
Law digest
Adapter version
```

Recovery must reuse this snapshot. It must not rediscover capabilities and silently change the technical decision for the same Run.

## 15. Audit

Existing Role-level audit remains. Add normalized native tool and resource events:

```json
{
  "event": "tool_invocation",
  "runId": "run-1",
  "roleId": "writer",
  "executionId": "exec-1",
  "backend": "codex",
  "model": "gpt-6-luna",
  "tool": "exec_command",
  "decision": "allow",
  "status": "completed",
  "durationMs": 842,
  "policyDigest": "sha256:..."
}
```

```json
{
  "event": "permission_request",
  "requestId": "perm-1",
  "backend": "acp",
  "resource": "filesystem",
  "decision": "deny",
  "reason": "outside execution staging"
}
```

No new audit store is required. Existing events and Role audit records remain the persistence surface.

## 16. Studio

### Business panel

```text
Responsibility
Inputs and outputs
Acceptance criteria
Human Review
```

### Technical panel

```text
Backend
Model
Backend-native tools
Filesystem policy
Process policy
Network policy
Timeout and output quotas
Capability degradation
```

Tool rules:

```text
Read tools from the Backend capability snapshot.
Default to all verified tools.
Do not allow users to create Model Role tools.
Keep optional allowedTools as an advanced technical setting.
Keep API/Cmd invocation editing separate from Harness Templates.
```

## 17. Migration

The new Runtime does not read legacy fields. A one-time repository rewrite is required:

```text
old role.json
  -> Role Contract v2

old allowedToolsByRoleId
  -> Harness Template allowedTools

old workspace.* references
  -> Harness Template environment overrides

Legacy fixed invocation references
  -> API/Cmd Template

old tests, examples, and fixtures
  -> rewrite to the new schema
```

The migration must classify Model Roles and API/Cmd Roles explicitly. Existing Model Role tool declarations become an optional technical `allowedTools` override. Fixed command or API declarations become API/Cmd Template entries. The old fields must not be copied into the business Role Contract.

After migration:

```text
Legacy fields produce schema errors.
No runtime fallback is kept.
No dual write is kept.
```

## 18. Implementation Order

### P0: Model cutover

1. Add Role Contract v2.
2. Remove required `constraints.allowedTools`.
3. Remove `permissionProfile`.
4. Remove `allowedToolsByRoleId` from Semantic IR.
5. Add `execution-bindings.json`.
6. Add the one-time migration script.

### P1: Backend capabilities

1. Add Backend tool and model discovery.
2. Add Capability Snapshot.
3. Add EnvironmentPolicyResolver.
4. Freeze the snapshot and resolved policy per Run.
5. Default to all verified Backend-native tools.

### P2: Adapter mapping

1. Map OpenCode environment policy.
2. Map Codex sandbox and approval configuration.
3. Map ACP resource requests.
4. Complete Pi workspace and resource mapping.
5. Deny capabilities whose boundaries cannot be enforced.

### P3: Audit and recovery

1. Normalize `tool_invocation` events.
2. Normalize `permission_request` events.
3. Reuse frozen capability and policy snapshots on recovery.
4. Keep business Human Review in graph state only.

### P4: Studio

1. Separate business and technical panels.
2. Populate tools from Backend discovery.
3. Default to all verified tools.
4. Add optional advanced `allowedTools` settings.
5. Display capability degradation and readiness failures.

## 19. Acceptance Criteria

1. Role Contract contains no Backend, native tool, or environment permission fields.
2. Semantic IR contains no native tool or resource policy.
3. Model Roles resolve through a Harness Template.
4. API/Cmd Roles resolve through an API/Cmd Template and do not depend on a Backend model or native tool catalog.
5. Every Harness Template resolves one installed Backend and one model from that Backend's verified catalog.
6. Changing the Backend or model reruns readiness and freezes a new capability snapshot for the next Run.
7. Backend discovery returns verified models and tools.
8. Verified Backend tools are enabled by default.
9. Unknown or unenforceable capabilities are denied.
10. Configured `allowedTools` entries must exist in the frozen Backend capability snapshot.
11. Access outside execution staging always fails.
12. Permission decisions are only `allow` or `deny`.
13. Human Review occurs only after a durable Role result and before handoff.
14. Recovery reuses the original Capability Snapshot and Effective EnvironmentPolicy.
15. Every native tool invocation produces an audit event.
16. Legacy fields produce schema errors after migration.
