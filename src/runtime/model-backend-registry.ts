import { writeFile } from "node:fs/promises";

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
import { executeOpencodeModelRole, startOpencodeRunClient } from "./opencode-executor.js";
import { stringifyJson } from "./runtime-support.js";
import { resolveExecutable } from "./cli-adapter-support.js";
import type { ModelCatalogEntry, ModelCatalogSource, ReasoningEffort, ReasoningEffortLevel, RunContext } from "./types.js";

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

export type BackendStartRunArgs = {
  runContext: RunContext;
  targetDir: string;
};

/**
 * Capabilities granted to a model session for the current execution staging
 * directory. An omitted capability remains denied by backend adapters.
 */
export type WorkspaceCapabilityPolicy = {
  root: string;
  read?: boolean;
  write?: boolean;
  command?: boolean;
};

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
          workspaceCapabilityPolicy: request.workspaceCapabilityPolicy,
          timeoutMs: request.timeoutMs,
          maxOutputBytes: request.maxOutputBytes,
          signal: request.signal,
          runClient,
          sessionId: request.sessionId,
          promptCallPhase: request.promptCallPhase,
          onPromptCall: request.onPromptCall
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

export const codexBackendAdapter: BackendAdapter = {
  backendId: "codex",
  verifiedRunnable: true,
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
        const phase = request.promptCallPhase ?? "primary";
        const ordinal = 1;
        await request.onPromptCall?.({ phase, ordinal, stage: "before", prompt: request.prompt });
        let result: { sessionId: string; stdout: string; messageId?: string };
        let outputChars = 0;
        let output: string | undefined;
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
            workspaceCapabilityPolicy: request.workspaceCapabilityPolicy
          });
          outputChars = result.stdout.length;
          output = result.stdout;
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
