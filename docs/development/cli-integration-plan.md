# Native CLI Integration Plan

## Scope

OGSystem keeps the existing `opencode`, `codex`, and `ollama` backends and adds four native coding-agent clients:

```text
pi
qwen
kimi
gemini
```

The following versions are the compatibility snapshot used when this plan was written. They are
not a permanent protocol contract; implementation must keep a version compatibility matrix and
probe the installed client:

```text
OpenCode   1.19.5
Pi         1.5.0
Qwen Code  0.26.5
Kimi Code  2.4.1
Gemini CLI 0.66.0
```

OpenCode remains the `opencode` backend. `opencode2` is not a separate backend ID: the current implementation already uses the SDK v2 API namespace (`@opencode-ai/sdk/v2`).

## Protocol Model

RPC describes a request/response mechanism. ACP (Agent Client Protocol) is a coding-agent protocol with session, prompt, tool, permission, cancellation, and lifecycle semantics, usually transported using JSON-RPC.

```text
RPC = request/response mechanism
ACP = coding-agent RPC semantics
MCP = agent-to-tool protocol
```

The runtime talks to coding agents through ACP, RPC, or a client-specific JSON stream. The agent can use MCP to call external tools.

The direction is sound, but the implementation should extend the existing runtime boundary rather
than introduce a second adapter abstraction. The repository already has `BackendAdapter`,
`BackendRunSession`, `BackendRegistry`, and an `Executor` that owns one run's backend sessions.
Those types are the compatibility surface for both the CLI and a future desktop host.

The plan uses three distinct layers:

```text
Graph Runtime
    -> Executor / Backend Registry       (OGS run semantics)
        -> Backend Adapter               (provider protocol)
            -> Transport Client          (stdio, HTTP, ACP, JSON-RPC)
```

An adapter must not import Electron APIs. Electron is one possible host for the same runtime
services; the installed `ogs` CLI and a local HTTP Visualizer are other hosts.

## Runtime Coordination Architecture

The graph runtime does not handle client-specific wire formats. The existing `Executor` and backend
registry provide the run-scoped coordination boundary. A small transport client may be shared by
multiple adapters, but provider protocol details stay inside the adapter.

```text
Graph Runtime
    |
    v
Executor / Backend Registry
    |
    +-- OpenCode Adapter  -> opencode serve / SDK v2
    +-- Codex Adapter     -> codex app-server
    +-- Pi Adapter        -> Pi RPC / JSON stdio
    +-- Qwen Adapter      -> Qwen ACP daemon
    +-- Kimi Adapter      -> kimi acp
    +-- Gemini Adapter    -> Gemini headless JSON
```

The run-scoped executor owns:

- session creation, reuse, resume, and shutdown
- prompt dispatch and event streaming
- timeout, cancellation, retry, and process exit handling
- workspace and worktree assignment
- run-scoped transport process ownership
- normalized runtime and audit events

The graph runtime owns:

- role scheduling
- branches, joins, loops, and routing
- run state and checkpoints
- role-level retry policy

An adapter owns:

- the CLI command and arguments
- protocol handshake and version checks
- model discovery
- protocol-specific event parsing
- capability mapping

The executor owns a transport process or server handle once per backend and run. A logical agent
session is a separate concept: it is keyed by the OGS session key (`roleId:sessionLineageId`) and
must not be shared across sibling branches or unrelated roles. A backend may multiplex those
logical sessions on one process or server when its protocol supports that.

## Common Adapter Contract

Extend the existing `BackendAdapter` contract in place. Do not add a parallel `AgentClientAdapter`
interface with a second registry. The minimum shape remains:

```ts
interface BackendAdapter {
  readonly backendId: string;
  readonly verifiedRunnable: boolean;
  discover(args: DiscoveryArgs): Promise<DiscoveryResult>;
  startRun(args: StartRunArgs): Promise<BackendRunSession>;
  probe?(args: ProbeArgs): Promise<void>;
}

interface BackendRunSession {
  execute(request: BackendExecuteRequest): Promise<BackendExecuteResult>;
  abort?(args: AbortArgs): Promise<void>;
  close(): Promise<void>;
}
```

`BackendRunSession` is the run-scoped transport handle, not a logical conversation. The request's
`sessionId` remains the provider session/thread identifier and is persisted in `sessions.json`.

All adapters normalize their raw protocol messages into a shared event model:

```ts
type AgentEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; tool: string; input?: unknown }
  | { type: "tool_finished"; tool: string; output?: unknown }
  | { type: "permission_required"; request: unknown }
  | { type: "turn_completed"; output: string }
  | { type: "turn_failed"; error: string }
  | { type: "session_closed" };
```

Wrap every normalized event in a durable envelope:

```ts
type AgentEventEnvelope = {
  schemaVersion: 1;
  runId: string;
  roleId: string;
  sessionKey: string;
  sequence: number;
  at: string;
  source: string;
  event: AgentEvent;
};
```

`BackendExecuteRequest` should expose an optional `onEvent` callback (or an equivalent async
iterator) for normalized streaming. The final `BackendExecuteResult` remains the completion
contract used by graph execution; Electron and the Visualizer consume the event callback or the
persisted replay stream.

The envelope is the public contract. Provider messages are diagnostic input and are never treated
as the runtime event shape. Raw capture is bounded, redacted, and policy-controlled so it cannot
become an unbounded copy of provider transcripts or credentials.

Both normalized and raw events are retained:

```text
normalized event -> timeline.jsonl
raw event        -> redacted role execution snapshot
```

Use a defined run-local path such as
`.ogs/runs/<run-id>/roles/<role-id>/executions/<n>/protocol.ndjson` for bounded raw capture, and
include that path in the artifact policy and redaction rules.

## Transport Mapping

| Backend | Transport | Session model | Adapter |
| --- | --- | --- | --- |
| `opencode` | HTTP + SDK | server session | existing implementation |
| `codex` | stdio JSON-RPC | app-server thread | existing implementation |
| `pi` | stdio RPC/JSON | process session | new Pi RPC client |
| `qwen` | daemon HTTP/SSE or ACP | logical session on external daemon | new ACP client |
| `kimi` | stdio ACP | process session | new ACP client |
| `gemini` | stdio JSON | logical session | new headless JSON client |

Extend the transport union:

```ts
type BackendTransportKind =
  | "http"
  | "stdio-jsonrpc"
  | "cli-stdio"
  | "acp-stdio"
  | "acp-http"
  | "rpc-stdio";
```

Also add an explicit lifecycle ownership field to the descriptor or run start result:

```ts
type BackendProcessOwnership = "spawned_by_ogs" | "attached_external";
```

OGS closes processes it spawned. It closes sessions on an external daemon but does not terminate
the daemon unless the adapter explicitly owns it.

## Client Adapters

### Pi

Priority: P0.

Use Pi's RPC/JSON mode or TypeScript SDK. The adapter should:

- start one process per OGS backend run
- initialize and create or resume a session
- stream text and tool events
- support structured output
- support cancellation and clean shutdown
- record session IDs and raw protocol messages

Pi is the first `rpc-stdio` backend and the reference implementation for a process-oriented agent client.

### Qwen Code

Priority: P0.

Prefer the daemon mode when its documented protocol is available:

```text
qwen serve -> HTTP/SSE or ACP
```

Use headless mode as a fallback for environments where the daemon is unavailable. The daemon is
preferred because it supports long-lived sessions, multiple workspaces, reconnects, and shared
automation clients. Treat it as an externally owned service by default; do not stop a user's
daemon when an OGS Run ends.

The adapter must probe the installed version and confirm the daemon's protocol before marking the backend runnable.

### Kimi Code

Priority: P0.

Use the official ACP entrypoint:

```text
kimi acp
```

The adapter should implement initialize, session creation/loading, prompt, event streaming, cancellation, and shutdown. The archived legacy `kimi-cli` project is not the target implementation; use Kimi Code CLI.

### Gemini CLI

Priority: P1.

Use the headless JSON interface and its streaming JSON variant. The adapter must handle:

- text events
- tool calls
- permission requests
- final structured output
- session resume where supported
- output truncation
- non-zero process exit

Gemini command-line flags and event schemas must be version-probed instead of treated as permanently stable.

## Backend Descriptors

Register four backend descriptors:

```text
pi
qwen
kimi
gemini
```

Each descriptor must report:

- display name and icon key
- transport and session kind
- text input/output
- tool calls
- structured output
- session reuse
- abort support

A binary being present is not enough to mark a backend `runnable`; the handshake, model discovery, and minimum execution probe must pass.

## Model Discovery

All clients write into the existing `.ogs/model-catalog.json` format:

```json
{
  "backend": "qwen",
  "modelId": "qwen3-coder",
  "runnable": true,
  "capabilities": {
    "textInput": true,
    "textOutput": true,
    "toolcall": true
  }
}
```

Discovery flow:

```text
binary exists
  -> version check
  -> protocol handshake
  -> model list
  -> optional structured-output probe
  -> mark runnable
```

Use the existing statuses:

```text
runnable
unavailable
not_installed
installed_but_broken
service_unavailable
```

## Session Lifecycle

Each OGS Run groups transport handles by backend, while logical sessions remain isolated:

```text
Run start
  -> group roles by backend
  -> start one service or process per backend
  -> reuse one backend transport per backend when supported
  -> create or resume one logical session per OGS session key
  -> persist each role/session-lineage sessionId
  -> close logical sessions and OGS-owned transports at Run end
```

On recovery:

```text
checkpoint.sessionId
  -> attempt resume
  -> if resume fails, create a new session according to policy
  -> record session_recreated
```

Sessions from different backends must never be mixed. A failed resume must be recorded with the
old and new session identifiers, the reason, and the recovery policy. Automatic recreation is not
allowed when the selected policy requires fail-closed recovery.

## Electron Desktop Host

Electron should be a host for the existing application services, not a new runtime implementation.
Keep the following process boundary:

```text
Renderer
  -> typed preload bridge
Electron main process
  -> desktop host child process (`ogs host` or equivalent)
  -> CLI/ACP/HTTP backend processes
```

Rules for the desktop host:

- Keep `contextIsolation: true`, `nodeIntegration: false`, and an allowlisted IPC channel set.
- Expose typed commands and event subscriptions from preload. Do not expose a generic arbitrary
  `invoke(channel, payload)` surface to the renderer.
- The current `Window.OGSElectronAPI.invoke(channel, payload)` fallback in
  `src/visualizer/client-api.ts` is a transport hook, not the final security boundary. The desktop
  preload must allowlist channels and validate request shapes before forwarding them.
- Keep the existing HTTP API for browser use. The desktop bridge may proxy the same application
  service contract, but it must not duplicate domain or runtime logic.
- Bind any local HTTP listener to loopback, choose an ephemeral port, and use a per-instance
  capability token or equivalent request authentication. A loopback listener is not an implicit
  trust boundary.
- Run provider CLIs from the host child process, never from renderer code or an Electron web page.
  On macOS and Windows, discover or configure executable paths explicitly because GUI `PATH` often
  differs from a login shell.
- On app close, request graceful run stop, wait for the persisted stop outcome, then terminate
  only child processes owned by OGS. Reuse the existing process-tree termination and recovery
  rules.
- Keep desktop packaging, code signing, auto-update, and native window behavior outside
  `src/runtime`; they belong under an Electron host package.

Suggested host modules:

```text
src/host/application-host.ts       # host-neutral service composition
src/host/backend-supervisor.ts     # child process and external daemon ownership
src/host/host-protocol.ts          # versioned commands/events
apps/desktop/main/                 # Electron main process
apps/desktop/preload/              # narrow typed bridge
apps/desktop/renderer/              # existing Visualizer client entry
```

The host protocol should carry `runId`, `requestId`, `sessionKey`, `sequence`, and cancellation
state. It must support reconnect and replay from persisted run artifacts so closing a window does
not cancel a run or lose its audit stream.

## Configuration and Security

Role bindings continue to use the existing model-selection shape:

```json
{
  "roles": {
    "backend-engineer": {
      "backend": "pi",
      "modelId": "..."
    },
    "reviewer": {
      "backend": "qwen",
      "modelId": "..."
    }
  }
}
```

OGS does not import or manage provider credentials. Each CLI continues to use its own user-level authentication.

Every adapter receives:

- `cwd`
- `workspaceDir`
- `runDir`
- `sharedDir`
- approval policy
- sandbox policy
- timeout
- maximum output bytes

Credentials must never appear in command arguments, run artifacts, or normalized events.
Provider authentication remains in each provider's user-level configuration; Electron must not
copy it into renderer storage or app-managed project files.

## Code Layout

Add:

```text
src/runtime/agent-client-types.ts
src/runtime/agent-event-normalizer.ts
src/runtime/acp-client.ts
src/runtime/rpc-stdio-client.ts
src/runtime/pi-adapter.ts
src/runtime/qwen-adapter.ts
src/runtime/kimi-adapter.ts
src/runtime/gemini-adapter.ts
```

Update:

```text
src/runtime/model-backend-registry.ts
src/runtime/executor.ts
src/runtime/model-catalog.ts
src/runtime/doctor.ts
src/runtime/types.ts
```

`acp-client.ts` must be shared by Qwen and Kimi rather than implemented twice.

## Delivery Phases

### Phase 1: Shared infrastructure

- add the common `AgentEvent` model
- add `rpc-stdio-client`
- add the ACP client
- add event normalization and error mapping
- extend transport and session types
- add a versioned host-neutral command/event protocol
- add conformance fixtures for malformed JSON, protocol errors, cancellation, and bounded output

### Phase 2: Pi

- implement discovery and the `pi` adapter
- implement session reuse and resume
- implement abort and structured output
- persist normalized and raw events

### Phase 3: Qwen and Kimi

- implement the shared ACP client
- implement Qwen daemon lifecycle
- implement Kimi stdio lifecycle
- add protocol version probes

### Phase 4: Gemini

- implement headless JSON adapter
- implement streaming JSON parsing
- handle tool and permission events
- add compatibility checks by CLI version

### Phase 5: Product integration

- add backend choices to Visualizer
- add model catalog refresh
- add `ogs doctor` checks
- add readiness diagnostics
- add fallback model support
- add examples and operator documentation

### Phase 6: Electron host

- add the host child process and typed host protocol
- add preload allowlists and reconnect/replay handling
- add executable-path and environment diagnostics for desktop launches
- add graceful app-close/run-stop behavior and packaged-artifact smoke checks

## Acceptance Criteria

Every adapter must pass the checks for the capabilities it advertises:

- binary and version detection
- model discovery
- minimum prompt execution
- structured output when `structuredOutput` is true
- tool call when `toolcall` is true
- session reuse when `sessionReuse` is true
- session resume when the protocol supports it; otherwise an explicit unsupported result
- timeout
- cancellation
- non-zero exit handling
- output-size limits
- workspace isolation
- raw event audit
- `ogs doctor`
- `ogs run start --dry-run`
- interrupted run followed by `ogs run resume`

The matrix must also include host mode (CLI, local HTTP, Electron), process ownership
(`spawned_by_ogs` versus `attached_external`), and the provider CLI version used for each result.

## Priority

```text
P0: Pi, Qwen Code, Kimi Code
P1: Gemini CLI
P2: Aider, Goose, Mistral Vibe
```

OpenCode remains the primary server-based backend. Pi, Qwen Code, Kimi Code, and Gemini CLI are complementary native adapters, not replacements for the existing OpenCode implementation.
