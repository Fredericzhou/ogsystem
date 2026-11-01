# Model Backend Adapter Registry Plan

## 1. Decision

OGSystem routes model-backed Roles through a backend adapter registry. The registry
owns backend transport, process/service lifecycle, model discovery, and backend
session operations. The executor retains orchestration-facing execution but does
not contain backend-specific transport branches.

The product model is intentionally small:

~~~text
Role responsibility
  + backend
  + backend-local modelId
~~~

backend is the execution adapter identity. modelId is an opaque identifier
understood by that backend. Provider, vendor, gateway, and upstream model source
are not product identities in OGSystem.

This plan defines the current schema and runtime contract. It is a breaking change
for the implementation release covered by this plan. Old config, catalog, and
session formats do not need to remain readable; fixtures, examples, and local
runtime files are updated together.

### 1.1 Product positioning

OGSystem is a general task-solving collaboration system. Its Roles may handle
research, analysis, planning, content, operations, or software work, and the
graph remains the product's primary collaboration model.

Orca is used as a reference for the collaboration control plane: coordinator,
tasks, dispatches, worker sessions, messages, completion, and decision gates.
Orca's source-code worktrees, terminal layout, IDE features, and CLI integration
are outside OGSystem's product boundary. A backend is an execution participant in
an OGS task, not an IDE or a second orchestration system.

## 2. Design Principles

### 2.1 Keep graph semantics backend-neutral

Roles continue to define responsibility, prompt, output schema, allowed events, and
orchestration. A Role is never a Codex Role, OpenCode Role, or Ollama Role in the
graph model.

Do not add backend-specific Mermaid metadata, Flow fields, Context Map fields, or
role-package fields.

### 2.2 Make backend identity explicit

Every model binding has a typed backend ID. Backend IDs are stable runtime/product
identifiers, not endpoints, credentials, user identities, or provider names.

The Studio uses the backend descriptor for a local icon and accessible label. Icons
are controlled product assets and are never supplied by a model catalog.

### 2.3 Treat model IDs as backend-local opaque values

The runtime does not split or interpret a model ID:

~~~text
backend = codex     modelId = gpt-6-luna
backend = opencode  modelId = codex-gateway/gpt-6-luna
backend = ollama    modelId = qwen3:8b
~~~

The adapter receives the complete value unchanged. A slash in an OpenCode model ID
is not a system-level source boundary.

### 2.4 Keep the adapter contract small

The common contract covers only:

- model discovery;
- a Run-scoped client;
- Role execution;
- cancellation;
- client close and sanitized runtime metadata.

There is no separate probe API in the minimum design. Discovery reports availability
and capabilities; Run start or the first request performs any backend-specific live
check required by that adapter.

### 2.5 Preserve capability honesty

Capabilities are reported at descriptor and model-catalog level. Runtime readiness
rejects a Role whose required output contract is unsupported. It never silently
converts required structured JSON output into free text.

### 2.6 Make agent collaboration the product boundary

The primary product concern is the relationship between Agents, not the inventory
of tools inside an Agent backend. Follow the useful Orca ADE model:

- a durable Run owns the collaboration namespace and coordinator inbox;
- a Task is an owned work item with dependencies and a lifecycle;
- a Dispatch records one Task attempt on one Agent session;
- messages carry status, questions, completion, and escalation between the
  coordinator and workers;
- decision gates pause a Task until a coordinator or human resolves the choice;
- separate worktrees or equivalent execution scopes isolate parallel Agents.

OGSystem maps these concepts to its existing graph semantics: Role is the
responsibility seat, Flow and event contracts are the handoff path, parallel split
and join express dependencies, and review nodes are decision gates. An Agent
backend executes a bound Role; it does not coordinate other Roles by sharing an
implicit session or private context.

Handoffs remain explicit and typed. Shared state is passed through declared output
events and context maps, while session lineage is used only for the owning Role's
continuation. The coordinator owns routing, retries, completion acceptance, and
escalation. This keeps collaboration deterministic even when different Roles use
different backends.

### 2.7 Keep tools, skills, and MCP backend-native

The backend adapter registry does not enumerate, authorize, or synchronize every
tool, skill, or MCP server. Those capabilities remain in the selected Agent CLI or
backend configuration. OGS only needs the transport-level capabilities required to
execute a Role, such as structured output, streaming, cancellation, or resume.

Backend-native tools, skills, and MCP are available by default according to the
selected Agent CLI's normal configuration. This plan adds no backend-wide exposure
schema, per-Role native-tool matrix, or MCP permission matrix. The registry records
only sanitized session metadata and execution outcomes. A capability is available
when the selected backend has it configured; OGS does not promise that every
backend installation has every capability.

The existing Role tool contract and law checks remain available for OGS-managed
tools that already have an OGS execution path. They do not become a second catalog
for backend-native tools.

Orca's current ADE behavior is a useful reference for launch policy: supported CLI
Agents are started with their full-autonomy permission flag by default, while the
user can switch an Agent to manual approval. This is an Agent launch setting, not
an OGS capability grant and not a promise that every possible tool is installed.
OGSystem can use the backend's normal full-autonomy mode by default and leave
manual approval as an optional backend launch setting, without modeling native
tools individually.

### 2.8 Preserve behavior before adding backends

Codex and OpenCode are wrapped without changing current session reuse, retry, JSON
repair, cancellation, or evidence behavior. Ollama is added after the registry path
is proven.

### 2.9 Keep backend configuration server-side

Backend settings such as an Ollama base URL or OpenCode mode belong to runtime or
platform configuration. Credentials and authorization headers never enter
TeamVersion content, browser DTOs, audit records, or model catalog entries.

### 2.10 Detect the local backend with backend-owned probes

Local backend status is obtained on the server by the adapter or a small shared
local-tool probe utility. The probe first resolves the real executable or service,
then runs only an allowlisted version/model command with a timeout. It reports
structured status rather than making the UI infer state from an error string.

The minimum status distinction is:

~~~text
not_installed
installed_but_broken
installed_and_runnable
service_unavailable
~~~

The implementation may also report a sanitized environment label such as macOS,
Linux, Windows, or WSL. Full executable paths, credential paths, environment
variables, and command output containing secrets stay server-side.

This follows the useful implementation pattern in
[CC Switch](https://github.com/farion1231/cc-switch): allowlisted tool names,
real executable resolution, bounded version probes, explicit
installed_but_broken, and backend-specific model listing. CC Switch's
provider-management model is not adopted.

Useful reference locations in CC Switch are:

- `src/components/ProviderIcon.tsx` and `src/icons/extracted`: local icon lookup,
  inline/local asset rendering, and text fallback;
- `src/config/appConfig.tsx`: stable application-to-icon/label mapping;
- `src-tauri/src/commands/misc.rs`: allowlisted tool names, executable resolution,
  version probing, timeout handling, and `installed_but_broken` reporting;
- `src-tauri/src/commands/model_fetch.rs`: backend-specific OpenCode and
  Antigravity model-list commands and output parsing.

### 2.11 Keep Agent workers in a replaceable Runtime boundary

An Agent worker is a collaboration execution unit, not a backend process. In the
minimum implementation, the worker loop runs in the existing Runtime process:

~~~text
API or Studio -> Runtime executor -> Worker/Dispatch loop -> Backend adapter
~~~

There is no operating-system service, network worker pool, or one-process-per-Agent
requirement. A Run owns its Tasks, Dispatches, session lineage, evidence, and
backend clients. The backend adapter remains an implementation detail of that
Run-scoped worker.

When operational isolation or online Runtime replacement is needed, the same
worker loop can be hosted by a supervised Runtime service without changing graph
or adapter contracts:

~~~text
API or Studio -> Runtime supervisor -> Worker Runtime (generation N)
                                      -> Backend adapters -> Agent backends
~~~

The service boundary is around the Worker Runtime, which may host many Runs; it
is not around every Role or model. The control plane sends commands and reads
persisted Run state. It may reconnect to a Runtime and reattach to a Run without
creating a second Dispatch.

Runtime replacement follows a readiness handoff:

1. Persist an atomic replacement request with the current and target Runtime
   versions.
2. Stop accepting new Runs on the old generation and keep active Dispatches
   owned by that generation.
3. Start the new generation and require a versioned readiness handshake.
4. Route new Runs to the new generation; let the old generation drain active
   Dispatches or recover them from persisted state according to the selected
   shutdown policy.
5. Mark the handoff complete only after the new generation is ready, and retain
   Runtime generation in Run evidence.

This is process replacement with session continuity, not in-place hot mutation.
It does not promise that a host reboot, Runtime crash, or backend process failure
will leave an active request running. Such failures use the existing persisted
Run state, retry, cancellation, and recovery rules.

Service mode is an operational extension. It is not required to introduce the
backend registry or Ollama adapter, and it must not add backend-native tool,
skill, or MCP management.

## 3. Scope

### 3.1 Initial backends

- codex: Codex app-server and persistent threads;
- opencode: OpenCode SDK server and persistent sessions;
- ollama: local Ollama HTTP service and OGS-managed logical sessions.

The registry reserves claude and antigravity. Until a supported transport is
selected and verified, those adapters may register descriptors and return an
explicit unavailable status. They must not advertise runnable models or infer
support from a binary name alone.

### 3.2 Included

- typed backend IDs and descriptors;
- backend adapter registry;
- registry-based executor routing;
- backend-neutral session persistence;
- backend-local model discovery and catalog output;
- local backend installation and health status;
- controlled local backend icon assets;
- Ollama logical sessions and cancellation;
- backend badges in model selection, Role cards, graph nodes, and run detail;
- current-schema updates to fixtures, examples, and tests.

### 3.3 Not included in the minimum design

- provider/source identity as a product concept;
- source icons, source filters, or provider/model identity panels;
- old schema migration or compatibility loaders;
- cross-backend model fallback;
- shared multi-user service pooling or backpressure;
- one operating-system service or daemon per Agent/Role;
- a separate probe service;
- backend-specific Mermaid or Role package metadata;
- IDE, terminal, repository, or worktree management;
- backend-native tool, skill, or MCP catalogs and permission matrices.

The Worker Runtime service boundary, supervisor, reconnect protocol, and online
replacement handoff are optional operational work after the in-process registry
path is stable. They are not prerequisites for backend selection or execution.

## 4. Current Selection Contract

The current selection authority remains .ogs/model-selection.json:

~~~json
{
  "configVersion": "3",
  "defaults": {
    "backend": "codex",
    "modelId": "gpt-6-luna"
  },
  "roles": {
    "market-analyst": {
      "backend": "ollama",
      "modelId": "qwen3:8b"
    }
  }
}
~~~

The current executor starts OpenCode and Codex clients directly and contains
backend conditionals. Session reuse is keyed by roleId:sessionLineageId; sibling
branches do not share a Role session.

The following constraints must be removed or generalized:

- executor routing is an explicit backend if chain;
- RoleExecutionBinding and ExecutorBinding omit Ollama;
- model discovery is hard-coded in model-catalog.ts;
- catalog and selection validators use the old fixed schema;
- OpencodeSessionRecord names and structures all persisted sessions;
- runtime configuration identifies OpenCode as the global executor;
- Studio model values are treated as composite provider references.

## 5. Target Contracts

### 5.1 Backend IDs and descriptors

Add src/runtime/backend-types.ts:

~~~ts
export type ModelBackendId =
  | "codex"
  | "opencode"
  | "claude"
  | "antigravity"
  | "ollama";

export type BackendDescriptor = {
  id: ModelBackendId;
  displayName: string;
  iconKey: string;
  sessionKind: "thread" | "session" | "logical";
  lifecycle: "stdio_process" | "managed_server" | "http_service" | "cli_process";
  capabilities: {
    structuredOutput: boolean;
    jsonSchema: boolean;
    toolCalls: boolean;
    streaming: boolean;
    abort: boolean;
    resume: boolean;
  };
};
~~~

iconKey is resolved through a local product registry. Remote or adapter-returned
icon keys are ignored.

The backend status returned to the server/UI is separate from the descriptor:

~~~ts
export type BackendInstallationStatus = {
  backend: ModelBackendId;
  state:
    | "not_installed"
    | "installed_but_broken"
    | "installed_and_runnable"
    | "service_unavailable";
  version?: string;
  environment?: "macos" | "linux" | "windows" | "wsl" | "unknown";
  diagnostics?: string;
};
~~~

The browser receives this sanitized projection. A resolved executable path is an
internal server value and is never part of the public DTO.

### 5.2 Model binding

~~~ts
export type ModelBinding = {
  backend: ModelBackendId;
  modelId: string;
  variant?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  fallbackModelId?: string;
};
~~~

fallbackModelId, when present, uses the same backend as the primary binding.
Cross-backend fallback requires a separate design and is outside this plan.

An internal modelRef alias may remain temporarily during code changes, but it must
equal the backend-local modelId and is not a second identity.

### 5.3 Model catalog

The current catalog is replaced by a strict current version:

~~~ts
export type ModelCatalogEntry = {
  backend: ModelBackendId;
  modelId: string;
  name?: string;
  status: "active" | "unavailable" | "deprecated" | "offline";
  runnable: boolean;
  capabilities: {
    textInput: boolean;
    textOutput: boolean;
    structuredOutput: boolean;
    jsonSchema: boolean;
    toolCalls: boolean;
    streaming: boolean;
    abort: boolean;
    resume: boolean;
  };
  variants: string[];
  discoveredAt: string;
  diagnostics?: string;
};

export type ModelCatalog = {
  catalogVersion: "3";
  generatedAt: string;
  backends: Array<{
    backend: ModelBackendId;
    status: "available" | "unavailable";
    detail?: string;
  }>;
  models: ModelCatalogEntry[];
};
~~~

The catalog contains no source, provider, credential, endpoint, or arbitrary remote
icon field.

### 5.4 Adapter interface

Add src/runtime/backend-adapter.ts:

~~~ts
export type BackendRunClient = {
  backend: ModelBackendId;
  startedAt: string;
  close(): Promise<void>;
  metadata(): Record<string, unknown>;
};

export type BackendExecuteArgs = {
  client: BackendRunClient;
  roleId: string;
  modelId: string;
  variant?: string;
  prompt: string;
  schema: unknown;
  sessionId?: string;
  directory: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  onPromptCall?: ExecutorRequest["onPromptCall"];
};

export interface ModelBackendAdapter {
  readonly descriptor: BackendDescriptor;

  discover(args: BackendDiscoveryArgs): Promise<ModelCatalogEntry[]>;
  startRun(args: BackendStartArgs): Promise<BackendRunClient>;
  execute(args: BackendExecuteArgs): Promise<ExecutorResult>;
  abort(args: {
    client: BackendRunClient;
    sessionId?: string;
    directory: string;
  }): Promise<void>;
  close(client: BackendRunClient): Promise<void>;
}
~~~

The adapter does not advance graph state, choose Flow routes, validate business
results, or write audit records. Those remain executor/runtime artifact concerns.

### 5.5 Registry

Add src/runtime/backend-registry.ts:

~~~ts
export type BackendRegistry = {
  register(adapter: ModelBackendAdapter): void;
  get(id: ModelBackendId): ModelBackendAdapter;
  list(): BackendDescriptor[];
};
~~~

Registration rejects duplicate IDs and descriptors whose ID does not match the
registered key. Unknown backend errors occur during readiness, before Run
execution starts.

The default registry registers Codex, OpenCode, Ollama, and honest unavailable
descriptors for Claude and Antigravity.

### 5.6 Local icon registry

Add a local visual registry, for example in
apps/team-site/public/app/backend-visuals.js:

~~~ts
type BackendVisual = {
  backend: ModelBackendId;
  label: string;
  iconKey: string;
  accessibleLabel: string;
};
~~~

The registry maps known backend IDs to bundled SVG/PNG or inline SVG assets. The
rendering helper follows this order:

1. bundled icon for the known backend;
2. generic local adapter icon;
3. text label or initials fallback.

It must not fetch a remote image at render time. The icon is always supplemental
to visible or accessible backend text. This is the same useful pattern as CC
Switch's ProviderIcon: controlled built-ins, safe local image rendering, and a
fallback when an asset is missing.

## 6. Adapter Behavior

### 6.1 Codex

Wrap the existing CodexAppServerClient:

- lifecycle: stdio_process;
- session kind: thread;
- start a thread when no session ID exists;
- resume the Role thread when a matching session ID exists;
- map turn/interrupt to adapter abort;
- use app-server model discovery;
- obtain local installation status by resolving the Codex executable and probing
  its version before starting the app-server;
- preserve session ID, message ID, model ID, and backend in audit records.

The app-server process and stdin/stdout are never exposed to the browser.

### 6.2 OpenCode

Move the current OpenCode transport from opencode-executor.ts behind the adapter:

- lifecycle: managed_server;
- session kind: session;
- preserve current per-Run server startup;
- preserve session create, prompt, abort, retries, JSON Schema output, and repair;
- obtain local installation status by resolving the OpenCode executable and probing
  its version; use the detected executable for the models command;
- preserve existing endpoint and PID artifacts as internal run diagnostics.

External shared service mode is not part of this minimum implementation.

### 6.3 Ollama

Add an adapter for the local Ollama HTTP API:

- lifecycle: http_service;
- discovery: /api/tags;
- execution: /api/chat;
- use the supported JSON or JSON Schema format option when available;
- use AbortController for request cancellation;
- session kind: logical.

The adapter reports service_unavailable when the configured Ollama base URL cannot
be reached. Model IDs are taken from the Ollama response unchanged. A model
capability check may use the Ollama model detail endpoint, but provider/vendor
metadata is discarded.

Ollama does not provide the same server-side thread semantics as Codex or OpenCode.
The adapter stores bounded per-Run, per-Role lineage history in the OGS session
record and sends that history on each request. History is subject to the existing
prompt budget and redaction policy.

The logical session ID is generated by OGS and is never presented as an Ollama
server session ID.

### 6.4 Claude and Antigravity

Register descriptors only when no supported transport is selected. Discovery returns
unavailable with a sanitized diagnostic. A binary presence check alone is not
sufficient to mark either backend runnable.

When a transport is selected, Claude and Antigravity follow the same local probe
rules. Antigravity model discovery must invoke the resolved real agy executable's
model-list command with a timeout; a shell lookup result alone is insufficient.

## 7. Runtime Execution Flow

1. Resolve each Role to backend, modelId, limits, and optional same-backend fallback.
2. Validate the backend against the registry.
3. Validate the selected catalog entry and required capabilities.
4. Start one Run client for every backend used by the plan.
5. Build roleId:sessionLineageId.
6. Load the generic backend session record for that key.
7. Reuse the session only when persisted backend matches the binding.
8. Call the adapter with prompt, schema, model ID, session ID, and abort signal.
9. Validate and repair the returned OGS role JSON.
10. Persist backend, model, session, retry, and output metadata.
11. Route the structured result through the existing graph and Context Map.
12. Abort only the active backend request/session on stop or timeout.
13. Close all Run clients after execution.

The core executor must not contain backend-specific execution branches.

### 7.1 Worker ownership and service mode

The in-process implementation treats the Runtime executor as the Worker host. It
owns the Run dispatch loop, backend clients, cancellation signals, session reuse,
and evidence writes. A Worker is identified by its Run and Dispatch state rather
than by a permanently running Agent process.

If service mode is enabled later, move this ownership behind a Runtime service
interface. Keep the following invariants:

- one Dispatch has one owning Runtime generation at a time;
- reconnecting a client observes the existing Run instead of starting a new
  Dispatch;
- new work is fenced from an old generation before replacement;
- active backend clients are closed only by their owning generation, or recovered
  through the persisted Run state after failure;
- Runtime version and generation are recorded in evidence.

The service interface should expose Run/Task/Dispatch commands and event
subscriptions. It should not expose backend-specific process handles, credentials,
native tool inventories, or MCP permission state.

## 8. Session and Evidence Model

Rename OpencodeSessionRecord to BackendSessionRecord in types.ts and run-artifacts.ts.
sessions.json remains the Run-level session index but uses the new current schema.

Every record contains:

~~~text
sessionKey
roleId
backend
sessionKind
sessionId
modelId
createdAt
lastPromptAt
promptCount
~~~

Ollama records additionally contain bounded logical message state needed for resume.

Audit records continue to use backend and model fields. Add fallbackModelId if
needed to identify the same-backend fallback. Do not add provider/source fields.

Run evidence may include sanitized adapter metadata, but must not include API keys,
authorization headers, or credential-bearing URLs.

## 9. Configuration and Selection

### 9.1 Runtime configuration

Change the global runtime executor marker from the OpenCode-only value to a registry
value, or remove the marker if it no longer carries behavior. Recommended shape:

~~~json
{
  "configVersion": "3",
  "executor": "registry",
  "backends": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434"
    },
    "opencode": {
      "mode": "managed"
    }
  }
}
~~~

Backend settings are validated by the runtime loader and consumed only by the
server-side adapter.

### 9.2 Model selection

Keep .ogs/model-selection.json as the selection authority. Do not duplicate model
selection in Mermaid metadata.

Backend and model ID are stored separately. UI code must not infer backend by
splitting a composite model string.

## 10. Discovery and Readiness

model-catalog.ts becomes a catalog coordinator:

1. iterate over the registry;
2. call each adapter discover();
3. normalize entries to ModelCatalogEntry;
4. record backend-level availability and sanitized diagnostics;
5. write the current catalog version.

Required Role capabilities are derived from the existing Role output schema and
tool contract:

- every model Role requires text input and text output;
- structured Role output requires structured output and JSON Schema support;
- model tool-call protocol capability is required only when the existing Role path
  uses model tool calls; this does not enumerate or authorize native tools;
- streaming and resume are checked only when the runtime path requests them.

Stale catalog state remains visible, but readiness must not select a model marked
unavailable or missing a required capability.

### 10.1 Backend-local discovery table

| Backend | Local status probe | Model discovery | Notes |
| --- | --- | --- | --- |
| Codex | resolved executable + version probe | app-server model/list | Do not infer model availability from provider configuration. |
| OpenCode | resolved executable + version probe | detected executable models command | Pass the configured OpenCode config directory and bound the command timeout. |
| Ollama | configured HTTP health request | /api/tags, optionally model detail | No CLI is required; service failure is distinct from an empty model list. |
| Claude | selected transport probe | selected transport model listing, if supported | Binary presence alone does not make the adapter runnable. |
| Antigravity | resolved real agy executable + version or initialization | resolved agy models command | Parse only validated model IDs/display names and redact command errors. |

Each adapter normalizes its result to the common catalog entry while retaining
backend-specific parsing inside the adapter. The coordinator does not parse CLI
output or inspect provider metadata.

## 11. Studio Changes

Add a local backend visual registry with entries for Codex, OpenCode, Claude,
Antigravity, Ollama, and an unknown fallback.

Backend visuals are bundled assets or inline SVGs selected by the local registry.
The server may return the backend ID, label, icon key, installation state, version,
and sanitized diagnostics. It never returns a remote icon URL, credential path, or
raw command output.

Model options display:

~~~text
[OpenCode icon] OpenCode · codex-gateway/gpt-6-luna
[Codex icon]    Codex · gpt-6-luna
[Ollama icon]   Ollama · qwen3:8b
~~~

Role inspector, Role cards, graph nodes, model catalog, and run trace show:

- backend icon;
- accessible backend label;
- backend-local model ID;
- capability and availability state where relevant.

They do not show source/provider identity. Role responsibility remains the primary
graph label. Changing backend/model changes only the model binding.

## 12. Proposed Code Changes

### New files

~~~text
src/runtime/backend-types.ts
src/runtime/backend-adapter.ts
src/runtime/backend-registry.ts
src/runtime/local-backend-probe.ts
src/runtime/adapters/codex-adapter.ts
src/runtime/adapters/opencode-adapter.ts
src/runtime/adapters/ollama-adapter.ts
src/runtime/adapters/claude-adapter.ts
src/runtime/adapters/antigravity-adapter.ts
~~~

### Runtime files

~~~text
src/runtime/types.ts
src/runtime/model-selection.ts
src/runtime/model-catalog.ts
src/runtime/executor.ts
src/runtime/adapter.ts
src/runtime/binding-resolver.ts
src/runtime/role-executor.ts
src/runtime/run-artifacts.ts
src/runtime/artifact-store.ts
src/runtime/config.ts
src/runtime/runtime-loader.ts
src/runtime/plan-fingerprint.ts
src/runtime/compiler.ts
src/runtime/remote-execution-contract.ts
src/runtime/cli.ts
src/runtime/doctor.ts
~~~

### Studio and application files

~~~text
apps/team-site/infrastructure/model-catalog.mjs
apps/team-site/public/app/backend-visuals.js
apps/team-site/public/app/views/app.js
apps/team-site/public/assets/backend-icons/*
src/visualizer/studio-authoring.ts
src/visualizer/studio-contracts.ts
src/visualizer/project-projection.ts
src/visualizer/client-renderers.ts
src/visualizer/project-readiness.ts
~~~

Graph parser, graph runner routing, Context Map semantics, and Role package
contracts do not require backend-specific changes.

## 13. Delivery Phases

### Phase 1: Contract and registry

- define backend IDs, descriptors, catalog version 3, and binding types;
- implement duplicate/unknown backend errors;
- register unavailable Claude and Antigravity descriptors;
- implement the shared allowlisted local executable/version probe;
- bundle the first backend icon assets and generic fallback;
- update current runtime fixtures and configuration examples.

### Phase 2: Codex and OpenCode parity

- wrap existing Codex and OpenCode clients;
- migrate executor routing to registry lookup;
- preserve lifecycle, session reuse, cancellation, retries, JSON repair, audit, and
  endpoint artifacts;
- generalize persisted session records.

### Phase 3: Ollama

- implement /api/tags discovery;
- implement /api/chat execution and structured output;
- implement Ollama health/status reporting;
- implement logical sessions and bounded history;
- implement timeout and cancellation;
- add local Ollama configuration and health diagnostics.

### Phase 4: Catalog and Studio

- make catalog discovery registry-driven;
- expose sanitized local backend status and versions;
- update readiness and capability checks;
- add local backend icon registry;
- update Role inspector, graph badges, catalog rows, and run detail;
- remove source/provider UI concepts.

### Phase 5: Claude and Antigravity

- select and verify one supported transport per backend;
- implement the adapter only after the transport contract is known;
- expose capability-aware availability and real UAT results.

### Phase 6: Optional Worker Runtime serviceization

Only implement this phase when the deployment requires Runtime isolation,
client reconnect, or online replacement without stopping active Dispatches:

- extract the in-process Worker host behind a versioned Runtime service boundary;
- persist Run/Task/Dispatch ownership and an atomic replacement handoff record;
- add a supervisor that starts a replacement, waits for readiness, and fences new
  work on the old generation;
- keep active Dispatches on the old generation until drain or explicit recovery;
- reconnect control-plane clients to the new generation without duplicating work;
- record Runtime version and generation in Run evidence;
- test restart, failed readiness, reconnect, drain, cancellation, and recovery.

Do not introduce per-Agent daemons, shared backend pools, or native tool/MCP
authorization as part of this phase.

## 14. Test Plan

### Registry and contract tests

- duplicate backend registration fails;
- unknown backend fails during readiness;
- local probes distinguish not installed from installed but broken;
- probes reject unallowlisted commands and enforce timeouts;
- every registered adapter has a matching descriptor;
- only backends used by the plan are started;
- injected fake adapters execute without spawning processes;
- managed Run clients close exactly once.

### Existing backend parity tests

- Codex thread start, resume, interrupt, and model discovery;
- OpenCode session create, prompt, abort, retry, and JSON repair;
- Role session key and sibling branch isolation;
- audit and sessions.json retain backend, model, and session metadata.

### Ollama tests

- /api/tags parsing;
- structured chat request;
- logical session history and prompt budget;
- redaction;
- timeout and abort;
- unavailable service and model diagnostics.

### Local backend and icon tests

- Codex, OpenCode, and Antigravity probes use the resolved executable rather than
  an untrusted shell string;
- WSL or platform environment labels are stable when applicable;
- probe errors are sanitized before reaching browser DTOs;
- known backend icons render from bundled assets;
- missing icons use the generic icon and accessible text fallback;
- no remote icon URL is loaded by the Studio.

### Selection and catalog tests

- current config and catalog schemas validate;
- backend-local model IDs are preserved exactly;
- Ollama model IDs containing colon or slash are not truncated;
- unavailable models remain visible for repair;
- required Role capabilities reject incompatible models.

### Browser tests

- backend icons have accessible text labels;
- models can be selected across Codex, OpenCode, and Ollama;
- Role cards and graph nodes show backend badges;
- saving and reopening restores backend and model ID;
- unavailable Claude/Antigravity entries are displayed honestly;
- no provider/source fields are rendered.

## 15. Acceptance Criteria

The minimum design is complete when:

1. Model-backed Roles route through a backend registry with no backend transport
   if chain in the core executor.
2. Codex and OpenCode pass current behavior and evidence tests through adapters.
3. Ollama discovers and runs at least one local model with logical session state.
4. Claude and Antigravity are either fully implemented with a verified transport or
   explicitly marked unavailable; neither is represented by a fake runnable model.
5. One TeamVersion can bind different Roles to different backends in one graph.
6. Selection and catalog records contain backend and backend-local model ID only.
7. Studio displays backend icons, model IDs, capability state, and availability.
8. Session and audit evidence record backend, model, session, retry, and fallback
   information without credentials or provider/source metadata.
9. Role, Flow, Context Map, and graph semantics remain unchanged.
10. Current-version runtime, catalog, selection, fixture, and browser tests pass.
