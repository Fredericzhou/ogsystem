import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { filesystemArtifactStore } from "./artifact-store.js";
import { CodexAppServerClient } from "./codex-app-server.js";
import type { ExecutorResult, ExecutorServerMetadata } from "./executor.js";
import {
  ModelDiscoveryError,
  type DiscoveryCommandRunner,
  parseOpencodeModelsVerboseOutput,
  runOpencodeModelsVerbose
} from "./model-catalog.js";
import { ollamaBackendAdapter, ollamaBackendDescriptor } from "./ollama-adapter.js";
import { piBackendAdapter, piBackendDescriptor } from "./pi-adapter.js";
import { qwenBackendAdapter, qwenBackendDescriptor } from "./qwen-adapter.js";
import { kimiBackendAdapter, kimiBackendDescriptor } from "./kimi-adapter.js";
import { discoverOpencodeNativeTools, executeOpencodeModelRole, startOpencodeRunClient } from "./opencode-executor.js";
import { stringifyJson } from "./runtime-support.js";
import { resolveExecutable } from "./cli-adapter-support.js";
import { createAgentEventEmitter, type AgentEvent } from "./agent-client-types.js";
import type { ModelCatalogEntry, ModelCatalogSource, ReasoningEffort, ReasoningEffortLevel, RunContext } from "./types.js";
import type { WorkspaceCapabilityPolicy } from "./backend-capabilities.js";
import type { AdapterResourceCapabilities, EffectiveEnvironmentPolicy } from "./v2-execution-policy.js";

export type { WorkspaceCapabilityPolicy } from "./backend-capabilities.js";

export type ModelBackendId = string;

export type BackendAvailabilityStatus =
  | "runnable"
  | "unavailable"
  | "not_installed"
  | "installed_but_broken"
  | "service_unavailable";

export type BackendTransportKind = "http" | "stdio-jsonrpc" | "cli-stdio" | "acp-stdio" | "acp-http" | "rpc-stdio";
export type BackendSessionKind = "server-session" | "app-server-thread" | "logical-session" | "process-session";
export type BackendProcessOwnership = "spawned_by_ogs" | "attached_external";

export type BackendCapabilities = {
  textInput: boolean;
  textOutput: boolean;
  toolcall: boolean;
  structuredOutput: boolean;
  sessionReuse: boolean;
  abort: boolean;
};

export type BackendDescriptor = {
  backendId: ModelBackendId;
  displayName: string;
  iconKey: string;
  transport: BackendTransportKind;
  sessionKind: BackendSessionKind;
  processOwnership: BackendProcessOwnership;
  capabilities: BackendCapabilities;
};

/**
 * Read-only, backend-neutral directory data for Studio and CLI configuration.
 * Native sandbox/approval/protocol settings intentionally never cross this
 * projection boundary; adapters keep those details private.
 */
export type BackendCapabilityDirectoryEntry = {
  backendId: ModelBackendId;
  displayName: string;
  iconKey: string;
  transport: BackendTransportKind;
  sessionKind: BackendSessionKind;
  processOwnership: BackendProcessOwnership;
  capabilities: BackendCapabilities;
  adapterVersion?: string;
  readiness: "ready" | "degraded" | "unavailable";
  nativeTools: {
    status: "ready" | "refresh_required" | "unavailable";
    verifiedTools: string[];
    configurable: true;
  };
  resources: AdapterResourceCapabilities;
  permission: {
    decisions: Array<"allow" | "deny">;
    interactiveApproval: false;
    configurable: false;
  };
  modes: {
    execution: Array<"staged" | "read_only">;
    approval: Array<"non_interactive">;
    configurable: false;
  };
};

export type BackendStartRunArgs = {
  runContext: RunContext;
  targetDir: string;
};

function mappedWorkspacePolicy(adapter: BackendAdapter, request: BackendExecuteRequest): WorkspaceCapabilityPolicy | undefined {
  const base = request.workspaceCapabilityPolicy;
  const environment = request.effectiveEnvironmentPolicy;
  if (!base || !environment) return base;
  const mapped = adapter.mapEnvironmentPolicy?.(environment);
  const value = mapped && typeof mapped === "object" && !Array.isArray(mapped)
    ? mapped as Record<string, unknown>
    : {};
  return {
    root: base.root,
    read: base.read === true && value.read !== false,
    write: base.write === true && value.write !== false,
    command: base.command === true && value.command !== false
  };
}

/**
 * Capabilities granted to a model session for the current execution staging
 * directory. An omitted capability remains denied by backend adapters.
 */
export type BackendExecuteRequest = {
  roleId: string;
  sessionKey?: string;
  sessionId?: string;
  prompt: string;
  schema: unknown;
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  effectiveReasoningEffort?: ReasoningEffortLevel;
  variant?: string;
  workdir: string;
  directory: string;
  executionDirectory?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  workspaceCapabilityPolicy?: WorkspaceCapabilityPolicy;
  /** Frozen v2 native tool set. Adapters must never expand this list. */
  effectiveTools?: string[];
  /** Frozen v2 resource policy for this execution staging root. */
  effectiveEnvironmentPolicy?: EffectiveEnvironmentPolicy;
  /** Digest of the frozen allowed-tool/environment policy for Evidence. */
  policyDigest?: string;
  /** Ask a model adapter to complete workspace tool work before final JSON. */
  artifactToolPhase?: boolean;
  signal?: AbortSignal;
  promptCallPhase?: "primary" | "fallback";
  onPromptCall?: (event: {
    phase: "primary" | "fallback" | "repair";
    ordinal: number;
    stage: "before" | "after";
    prompt: string;
    output?: string;
    outputChars?: number;
  }) => Promise<void>;
  runId?: string;
  executionId?: string;
  attempt?: number;
  onEvent?: import("./agent-client-types.js").AgentEventSink;
};

export type BackendExecuteResult = ExecutorResult;

export interface BackendRunSession {
  execute(request: BackendExecuteRequest): Promise<BackendExecuteResult>;
  abort?(args: { sessionId: string; directory: string }): Promise<void>;
  getServerMetadata?(): ExecutorServerMetadata;
  close(): Promise<void>;
}

export interface BackendAdapter {
  readonly backendId: ModelBackendId;
  readonly verifiedRunnable: boolean;
  /** Adapter implementation version captured in every v2 Run Capability Snapshot. */
  readonly adapterVersion?: string;
  discover(args: {
    workdir: string;
    commandRunner?: DiscoveryCommandRunner;
  }): Promise<{
    status: BackendAvailabilityStatus;
    detail?: string;
    models: ModelCatalogEntry[];
  }>;
  startRun?(args: BackendStartRunArgs): Promise<BackendRunSession>;
  probe?(args: { modelId: string; workdir: string; timeoutMs: number }): Promise<void>;
  /** Discover and verify the native tool IDs that can be constrained for a model session. */
  discoverNativeTools?(args: { modelId: string; workdir: string; timeoutMs: number }): Promise<{
    verifiedTools: string[];
    resources?: AdapterResourceCapabilities;
    detail?: string;
  }>;
  /** Resource enforcement facts remain Adapter-owned and are not part of the public capability matrix. */
  getResourceCapabilities?(): AdapterResourceCapabilities;
  validateToolResources?(toolId: string, policy: EffectiveEnvironmentPolicy): { allowed: boolean; reason?: string };
  mapEnvironmentPolicy?(policy: EffectiveEnvironmentPolicy): unknown;
}

export class BackendRegistry {
  private readonly descriptors = new Map<ModelBackendId, BackendDescriptor>();
  private readonly adapters = new Map<ModelBackendId, BackendAdapter>();

  register(descriptor: BackendDescriptor, adapter: BackendAdapter): void {
    const backendId = descriptor.backendId.trim();
    if (!backendId || adapter.backendId !== backendId) {
      throw new Error(`Invalid backend registration for "${descriptor.backendId}"`);
    }
    if (this.descriptors.has(backendId) || this.adapters.has(backendId)) {
      throw new Error(`Backend "${backendId}" is already registered.`);
    }
    this.descriptors.set(backendId, Object.freeze({
      ...descriptor,
      capabilities: Object.freeze({ ...descriptor.capabilities })
    }));
    this.adapters.set(backendId, adapter);
  }

  has(backendId: string): boolean {
    return this.descriptors.has(backendId);
  }

  getDescriptor(backendId: ModelBackendId): BackendDescriptor | undefined {
    return this.descriptors.get(backendId);
  }

  getAdapter(backendId: ModelBackendId): BackendAdapter | undefined {
    return this.adapters.get(backendId);
  }

  listDescriptors(): BackendDescriptor[] {
    return [...this.descriptors.values()];
  }

  listBackendIds(): ModelBackendId[] {
    return [...this.descriptors.keys()];
  }

  async discoverBackend(
    backendId: ModelBackendId,
    args: { workdir: string; commandRunner?: DiscoveryCommandRunner; preferredModelIds?: string[] }
  ): Promise<{ source: ModelCatalogSource; models: ModelCatalogEntry[] }> {
    const descriptor = this.descriptors.get(backendId);
    const adapter = this.adapters.get(backendId);
    if (!descriptor || !adapter) {
      throw new Error(`Backend "${backendId}" is not registered.`);
    }
    // Discovery checks installation, protocol health, and the model directory.
    // A real prompt probe is an explicit model-level action and must not turn a
    // healthy backend into an empty catalog.
    const discovered = await adapter.discover(args);
    // Strict tier gate: unverified adapters can be registered and detected, but never runnable.
    const effectiveStatus: BackendAvailabilityStatus = !adapter.verifiedRunnable
      ? discovered.status === "not_installed" || discovered.status === "installed_but_broken"
        ? discovered.status
        : "unavailable"
      : discovered.status;
    const effectiveModels: ModelCatalogEntry[] = discovered.models.map((entry) => ({
      backend: descriptor.backendId,
      modelId: entry.modelId,
      runnable: Boolean(entry.runnable) && effectiveStatus === "runnable",
      ...(entry.name ? { name: entry.name } : {}),
      status: effectiveStatus === "not_installed"
        ? "unavailable"
        : entry.status === "unavailable" ? "unavailable" : entry.status === "active" ? "discovered" : entry.status || "unverified",
      capabilities: {
        textInput: Boolean(entry.capabilities.textInput),
        textOutput: Boolean(entry.capabilities.textOutput),
        toolcall: Boolean(entry.capabilities.toolcall)
      },
      variants: [...entry.variants],
      ...(entry.reasoning ? { reasoning: entry.reasoning } : {})
    }));
    return {
      source: {
        backend: descriptor.backendId,
        displayName: descriptor.displayName,
        iconKey: descriptor.iconKey,
        transport: descriptor.transport,
        sessionKind: descriptor.sessionKind,
        processOwnership: descriptor.processOwnership,
        status: effectiveStatus,
        ...(discovered.detail ? { detail: discovered.detail } : {})
      },
      models: effectiveModels
    };
  }
}

/** Project only safe, generic capability facts into Studio/CLI read models. */
export function projectBackendCapabilityDirectory(
  registry: BackendRegistry,
  previews: ReadonlyMap<string, { readiness: "ready" | "degraded" | "unavailable"; verifiedTools: string[] }> = new Map()
): BackendCapabilityDirectoryEntry[] {
  return registry.listBackendIds().sort().flatMap((backendId) => {
    const descriptor = registry.getDescriptor(backendId);
    const adapter = registry.getAdapter(backendId);
    if (!descriptor || !adapter) return [];
    const hasNativeDiscovery = typeof adapter.discoverNativeTools === "function";
    // Persisted previews are keyed by backend/model. The generic directory has
    // no selected model, so expose the first matching preview only as a summary;
    // readiness performs the strict role-specific backend/model lookup.
    const preview = previews.get(backendId)
      ?? [...previews.entries()].find(([key]) => key.startsWith(`${backendId}/`))?.[1];
    const resources = adapter.getResourceCapabilities?.() ?? { filesystem: false, process: false, network: false };
    return [{
      backendId: descriptor.backendId,
      displayName: descriptor.displayName,
      iconKey: descriptor.iconKey,
      transport: descriptor.transport,
      sessionKind: descriptor.sessionKind,
      processOwnership: descriptor.processOwnership,
      capabilities: { ...descriptor.capabilities },
      ...(adapter.adapterVersion ? { adapterVersion: adapter.adapterVersion } : {}),
      readiness: preview?.readiness ?? (!adapter.verifiedRunnable
        ? "unavailable"
        : "degraded"),
      nativeTools: {
        status: preview ? "ready" : hasNativeDiscovery ? "refresh_required" : "unavailable",
        verifiedTools: preview?.verifiedTools ?? [],
        configurable: true
      },
      resources: { ...resources },
      permission: {
        decisions: ["allow", "deny"],
        interactiveApproval: false,
        configurable: false
      },
      modes: {
        execution: ["staged", "read_only"],
        approval: ["non_interactive"],
        configurable: false
      }
    }];
  });
}

const probeSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false
};

export const opencodeBackendDescriptor: BackendDescriptor = {
  backendId: "opencode",
  displayName: "OpenCode",
  iconKey: "opencode",
  transport: "http",
  sessionKind: "server-session",
  processOwnership: "spawned_by_ogs",
  capabilities: {
    textInput: true,
    textOutput: true,
    toolcall: true,
    structuredOutput: true,
    sessionReuse: true,
    abort: true
  }
};

export const opencodeBackendAdapter: BackendAdapter = {
  backendId: "opencode",
  verifiedRunnable: true,
  adapterVersion: "opencode-sdk-v2-native-tools-1",
  getResourceCapabilities() {
    // OpenCode's native bash/write tools do not provide a verifiable path
    // boundary for absolute paths and symlink traversal. Keep text-only Roles
    // available, but fail closed for filesystem/process capabilities until the
    // adapter can enforce the staging root at the tool boundary.
    return { filesystem: false, process: false, network: false };
  },
  mapEnvironmentPolicy(policy) {
    return { root: policy.root, read: policy.filesystem.read, write: policy.filesystem.write, command: policy.process, network: policy.network };
  },
  validateToolResources(toolId, policy) {
    if (["read", "list", "glob", "grep", "workspace.read", "workspace.list", "workspace.glob", "workspace.search"].includes(toolId) && !policy.filesystem.read) {
      return { allowed: false, reason: "filesystem reads are disabled by the effective environment policy" };
    }
    if (["bash", "exec_command", "workspace.run"].includes(toolId) && !policy.process) {
      return { allowed: false, reason: "process execution is disabled by the effective environment policy" };
    }
    if (["write", "edit", "apply_patch", "workspace.write", "workspace.patch_text"].includes(toolId) && !policy.filesystem.write) {
      return { allowed: false, reason: "filesystem writes are disabled by the effective environment policy" };
    }
    if (["websearch", "webfetch", "web_search", "web.search"].includes(toolId) && !policy.network) {
      return { allowed: false, reason: "network access is disabled by the effective environment policy" };
    }
    return { allowed: true };
  },
  async discoverNativeTools(args) {
    const discovered = await discoverOpencodeNativeTools(args);
    return {
      ...discovered,
      resources: this.getResourceCapabilities?.()
    };
  },
  async discover(args) {
    try {
      let parsed;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const stdout = await runOpencodeModelsVerbose(args.workdir, args.commandRunner);
        try {
          parsed = parseOpencodeModelsVerboseOutput(stdout);
          break;
        } catch (error) {
          const retryable = error instanceof ModelDiscoveryError
            && error.code === "MODEL_DISCOVERY_MALFORMED"
            && attempt === 0;
          if (!retryable) throw error;
        }
      }
      if (!parsed) throw new Error("OpenCode model discovery returned no parsed catalog.");
      return {
        status: "runnable",
        detail: `OpenCode ready (${parsed.models.length} model${parsed.models.length === 1 ? "" : "s"}).`,
        models: parsed.models
      };
    } catch (error) {
      if (error instanceof ModelDiscoveryError) {
        if (error.code === "MODEL_DISCOVERY_COMMAND_MISSING") {
          return {
            status: "not_installed",
            detail: error.message,
            models: []
          };
        }
        return {
          status: "installed_but_broken",
          detail: error.message,
          models: []
        };
      }
      return {
        status: "installed_but_broken",
        detail: error instanceof Error ? error.message : String(error),
        models: []
      };
    }
  },
  async startRun(args): Promise<BackendRunSession> {
    const runClient = await startOpencodeRunClient({
      startupTimeoutMs: 30000,
      env: {
        OGSYSTEM_RUN_DIR: args.runContext.runDir,
        OGSYSTEM_SHARED_DIR: args.runContext.sharedDir
      },
      directory: args.targetDir
    });
    await writeFile(
      args.runContext.opencodeEndpointPath,
      stringifyJson({
        backend: "opencode",
        lifecycle: "single-serve-multi-session",
        startedAt: runClient.startedAt,
        url: runClient.url,
        pid: runClient.pid
      }),
      "utf8"
    );
    await writeFile(args.runContext.opencodePidPath, `${runClient.pid ?? ""}\n`, "utf8");
    await filesystemArtifactStore.appendEvent(args.runContext, {
      type: "backend_server_started",
      backend: "opencode",
      at: runClient.startedAt,
      url: runClient.url,
      pid: runClient.pid,
      lifecycle: "single-serve-multi-session"
    });
    return {
      async execute(request) {
        const result = await executeOpencodeModelRole({
          roleId: request.roleId,
          prompt: request.prompt,
          schema: request.schema,
          modelRef: request.modelId,
          variant: request.variant,
          reasoningEffort: request.reasoningEffort,
          effectiveReasoningEffort: request.effectiveReasoningEffort,
          workdir: request.workdir,
          directory: request.executionDirectory ?? request.directory,
          workspaceCapabilityPolicy: mappedWorkspacePolicy(opencodeBackendAdapter, request),
          effectiveTools: request.effectiveTools,
          artifactToolPhase: request.artifactToolPhase,
          timeoutMs: request.timeoutMs,
          maxOutputBytes: request.maxOutputBytes,
          signal: request.signal,
          runClient,
          sessionId: request.sessionId,
          promptCallPhase: request.promptCallPhase,
          onPromptCall: request.onPromptCall,
          runId: request.runId,
          executionId: request.executionId,
          attempt: request.attempt,
          policyDigest: request.policyDigest,
          onEvent: request.onEvent
        });
        return {
          ...result,
          modelId: request.modelId,
          backend: "opencode",
          toolRef: `model.${request.modelId}`,
          command: "opencode-sdk"
        };
      },
      async abort(abortArgs) {
        await runClient.client.session.abort({
          sessionID: abortArgs.sessionId,
          directory: abortArgs.directory
        });
      },
      getServerMetadata() {
        return {
          url: runClient.url,
          pid: runClient.pid,
          startedAt: runClient.startedAt
        };
      },
      async close() {
        const closedAt = new Date().toISOString();
        await runClient.close();
        await writeFile(
          args.runContext.opencodeEndpointPath,
          stringifyJson({
            backend: "opencode",
            lifecycle: "single-serve-multi-session",
            startedAt: runClient.startedAt,
            closedAt,
            url: runClient.url,
            pid: runClient.pid
          }),
          "utf8"
        );
        await filesystemArtifactStore.appendEvent(args.runContext, {
          type: "backend_server_closed",
          backend: "opencode",
          at: closedAt,
          url: runClient.url,
          pid: runClient.pid,
          lifecycle: "single-serve-multi-session"
        });
      }
    };
  },
  async probe(args) {
    const runClient = await startOpencodeRunClient({
      startupTimeoutMs: 30000,
      directory: args.workdir
    });
    try {
      await executeOpencodeModelRole({
        roleId: "platform-model-probe",
        prompt: 'Return exactly this JSON: {"ok":true}',
        schema: probeSchema,
        modelRef: args.modelId,
        workdir: args.workdir,
        directory: args.workdir,
        timeoutMs: args.timeoutMs,
        maxOutputBytes: 4096,
        runClient
      });
    } finally {
      await runClient.close();
    }
  }
};

export const codexBackendDescriptor: BackendDescriptor = {
  backendId: "codex",
  displayName: "Codex",
  iconKey: "codex",
  transport: "stdio-jsonrpc",
  sessionKind: "app-server-thread",
  processOwnership: "spawned_by_ogs",
  capabilities: {
    textInput: true,
    textOutput: true,
    toolcall: true,
    structuredOutput: true,
    sessionReuse: true,
    abort: true
  }
};

function codexItemTool(item: Record<string, unknown>): string | undefined {
  const kind = typeof item.type === "string" ? item.type.replace(/[^a-z]/gi, "").toLowerCase() : "";
  if (kind === "commandexecution") return "exec_command";
  if (kind === "filechange") return "apply_patch";
  if (kind === "mcptoolcall" || kind === "toolcall") {
    const name = item.name ?? item.tool ?? item.toolName;
    return typeof name === "string" && name.trim() ? name.trim() : "tool";
  }
  return undefined;
}

/**
 * Convert Codex app-server notifications into the backend-neutral event
 * contract. Raw protocol payloads are intentionally not forwarded: command
 * text, file contents, and model output may contain business data and are not
 * needed for progress evidence.
 */
export function normalizeCodexProtocolEvent(message: Record<string, unknown>): AgentEvent | undefined {
  const method = typeof message.method === "string" ? message.method : "";
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params as Record<string, unknown>
    : undefined;
  if (!params) return undefined;
  if (method === "item/agentMessage/delta" || method === "item/agent_message/delta") {
    const text = typeof params.delta === "string"
      ? params.delta
      : typeof params.text === "string"
        ? params.text
        : undefined;
    return text ? { type: "text_delta", text } : undefined;
  }
  if (method !== "item/started" && method !== "item/completed") return undefined;
  const item = params.item && typeof params.item === "object" && !Array.isArray(params.item)
    ? params.item as Record<string, unknown>
    : undefined;
  if (!item) return undefined;
  const tool = codexItemTool(item);
  if (!tool) return undefined;
  if (method === "item/started") return { type: "tool_started", tool };
  const status = typeof item.status === "string" ? item.status : undefined;
  const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
  return {
    type: "tool_finished",
    tool,
    output: {
      ...(status ? { status } : {}),
      ...(exitCode !== undefined ? { exitCode } : {})
    }
  };
}

export const codexBackendAdapter: BackendAdapter = {
  backendId: "codex",
  verifiedRunnable: true,
  adapterVersion: "codex-app-server-v2-native-tools-1",
  getResourceCapabilities() {
    return { filesystem: true, process: true, network: false };
  },
  mapEnvironmentPolicy(policy) {
    return { root: policy.root, read: policy.filesystem.read, write: policy.filesystem.write, command: policy.process, network: policy.network };
  },
  validateToolResources(toolId, policy) {
    if (["read", "list", "glob", "grep", "workspace.read", "workspace.list", "workspace.glob", "workspace.search"].includes(toolId) && !policy.filesystem.read) {
      return { allowed: false, reason: "filesystem reads are disabled by the effective environment policy" };
    }
    if (["exec_command", "workspace.run"].includes(toolId) && !policy.process) {
      return { allowed: false, reason: "process execution is disabled by the effective environment policy" };
    }
    if (["apply_patch", "workspace.write", "workspace.patch_text"].includes(toolId) && !policy.filesystem.write) {
      return { allowed: false, reason: "filesystem writes are disabled by the effective environment policy" };
    }
    return { allowed: true };
  },
  async discoverNativeTools(args) {
    // Codex app-server intentionally has no tool-list RPC. The app-server
    // protocol exposes these native item kinds and the adapter maps them to
    // the only two selectable Codex tool IDs. Discovery is therefore a local
    // protocol-contract lookup and never depends on model inference or auth.
    void args;
    return {
      verifiedTools: ["apply_patch", "exec_command"],
      detail: "Codex app-server protocol contract exposes apply_patch and exec_command; model execution is not used for tool discovery.",
      resources: this.getResourceCapabilities?.()
    };
  },
  async discover(args) {
    const codexCommand = await resolveExecutable("codex");
    if (!codexCommand) {
      return {
        status: "not_installed",
        detail: "Codex CLI is not installed on this machine.",
        models: []
      };
    }
    try {
      const codex = await CodexAppServerClient.start({ cwd: args.workdir, timeoutMs: 10000 });
      try {
        const found = await codex.listModels();
        const models: ModelCatalogEntry[] = found.map((model) => ({
          backend: "codex",
          modelId: model.id,
          runnable: true,
          name: model.displayName,
          status: "active",
          capabilities: { textInput: true, textOutput: true, toolcall: true },
          variants: []
        }));
        return {
          status: models.length > 0 ? "runnable" : "unavailable",
          detail: models.length > 0
            ? `Codex app-server ready (${models.length} model${models.length === 1 ? "" : "s"}).`
            : "Codex app-server reported no available models.",
          models
        };
      } finally {
        await codex.close();
      }
    } catch (error) {
      return {
        status: "installed_but_broken",
        detail: error instanceof Error ? error.message : String(error),
        models: []
      };
    }
  },
  async startRun(args): Promise<BackendRunSession> {
    const codexClient = await CodexAppServerClient.start({
      cwd: args.targetDir,
      env: {
        OGSYSTEM_RUN_DIR: args.runContext.runDir,
        OGSYSTEM_SHARED_DIR: args.runContext.sharedDir
      }
    });
    await filesystemArtifactStore.appendEvent(args.runContext, {
      type: "backend_server_started",
      backend: "codex",
      at: new Date().toISOString(),
      lifecycle: "single-app-server-multi-thread"
    });
    return {
      async execute(request) {
        const effectiveTools = new Set(request.effectiveTools ?? []);
        const unsupported = [...effectiveTools].filter((tool) => !["apply_patch", "exec_command"].includes(tool));
        if (unsupported.length > 0) {
          throw new Error(`V2_READINESS_TOOL_UNENFORCEABLE: Codex app-server cannot constrain native tools: ${unsupported.join(", ")}`);
        }
        // Codex workspaceWrite exposes command execution whenever writable
        // roots are granted. The protocol cannot represent write-only, so
        // reject that combination instead of silently widening the frozen set.
        if (effectiveTools.has("apply_patch") && !effectiveTools.has("exec_command")) {
          throw new Error("V2_READINESS_TOOL_UNENFORCEABLE: Codex workspaceWrite cannot enforce apply_patch without exec_command");
        }
        const phase = request.promptCallPhase ?? "primary";
        const ordinal = 1;
        await request.onPromptCall?.({ phase, ordinal, stage: "before", prompt: request.prompt });
        let result: { sessionId: string; stdout: string; messageId?: string };
        let outputChars = 0;
        let output: string | undefined;
        const emitter = createAgentEventEmitter({
          runId: request.runId ?? args.runContext.runId,
          roleId: request.roleId,
          executionId: request.executionId ?? "unknown",
          attempt: request.attempt ?? 1,
          backend: "codex",
          model: request.modelId,
          sessionId: request.sessionId,
          policyDigest: request.policyDigest,
          onEvent: request.onEvent
        });
        try {
          result = await codexClient.execute({
            roleId: request.roleId,
            prompt: request.prompt,
            schema: request.schema,
            modelId: request.modelId,
            cwd: request.executionDirectory ?? request.directory,
            timeoutMs: request.timeoutMs,
            sessionId: request.sessionId,
            signal: request.signal,
            workspaceCapabilityPolicy: mappedWorkspacePolicy(codexBackendAdapter, request),
            onEvent: (message) => {
              const event = normalizeCodexProtocolEvent(message);
              if (event) void emitter.emit(event);
            }
          });
          outputChars = result.stdout.length;
          if (Buffer.byteLength(result.stdout, "utf8") > request.maxOutputBytes) {
            throw new Error(`V2_OUTPUT_QUOTA_EXCEEDED: Codex output exceeded maxOutputBytes (${request.maxOutputBytes})`);
          }
          output = result.stdout;
          await emitter.emit({ type: "turn_completed", output: result.stdout });
        } catch (error) {
          await emitter.emit({ type: "turn_failed", error: error instanceof Error ? error.message : String(error) });
          throw error;
        } finally {
          await request.onPromptCall?.({
            phase,
            ordinal,
            stage: "after",
            prompt: request.prompt,
            outputChars,
            ...(output !== undefined ? { output } : {})
          });
        }
        return {
          exitCode: 0,
          stdout: result.stdout,
          stderr: "",
          args: ["app-server"],
          sessionId: result.sessionId,
          messageId: result.messageId,
          modelId: request.modelId,
          backend: "codex",
          toolRef: `model.codex/${request.modelId}`,
          command: "codex app-server"
        };
      },
      async close() {
        const closedAt = new Date().toISOString();
        await codexClient.close();
        await filesystemArtifactStore.appendEvent(args.runContext, {
          type: "backend_server_closed",
          backend: "codex",
          at: closedAt,
          lifecycle: "single-app-server-multi-thread"
        });
      }
    };
  },
  async probe(args) {
    const client = await CodexAppServerClient.start({ cwd: args.workdir, timeoutMs: 15000 });
    try {
      await client.execute({
        roleId: "platform-model-probe",
        prompt: 'Return exactly this JSON: {"ok":true}',
        schema: probeSchema,
        modelId: args.modelId,
        cwd: args.workdir,
        timeoutMs: args.timeoutMs
      });
    } finally {
      await client.close();
    }
  }
};

export function createDefaultBackendRegistry(): BackendRegistry {
  const registry = new BackendRegistry();
  registry.register(opencodeBackendDescriptor, opencodeBackendAdapter);
  registry.register(codexBackendDescriptor, codexBackendAdapter);
  registry.register(ollamaBackendDescriptor, ollamaBackendAdapter);
  registry.register(piBackendDescriptor, piBackendAdapter);
  registry.register(qwenBackendDescriptor, qwenBackendAdapter);
  registry.register(kimiBackendDescriptor, kimiBackendAdapter);

  return registry;
}

export const defaultBackendRegistry = createDefaultBackendRegistry();
