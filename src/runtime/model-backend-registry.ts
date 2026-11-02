import { spawn } from "node:child_process";
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
import { executeOpencodeModelRole, startOpencodeRunClient } from "./opencode-executor.js";
import { stringifyJson } from "./runtime-support.js";
import type { ModelCatalogEntry, ModelCatalogSource, RunContext } from "./types.js";

export type ModelBackendId = string;

export type BackendAvailabilityStatus =
  | "runnable"
  | "unavailable"
  | "not_installed"
  | "installed_but_broken"
  | "service_unavailable";

export type BackendTransportKind = "http" | "stdio-jsonrpc" | "cli-stdio";
export type BackendSessionKind = "server-session" | "app-server-thread" | "logical-session";

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
  capabilities: BackendCapabilities;
};

export type BackendStartRunArgs = {
  runContext: RunContext;
  targetDir: string;
};

export type BackendExecuteRequest = {
  roleId: string;
  sessionKey?: string;
  sessionId?: string;
  prompt: string;
  schema: unknown;
  modelId: string;
  variant?: string;
  workdir: string;
  directory: string;
  timeoutMs: number;
  maxOutputBytes: number;
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
    args: { workdir: string; commandRunner?: DiscoveryCommandRunner }
  ): Promise<{ source: ModelCatalogSource; models: ModelCatalogEntry[] }> {
    const descriptor = this.descriptors.get(backendId);
    const adapter = this.adapters.get(backendId);
    if (!descriptor || !adapter) {
      throw new Error(`Backend "${backendId}" is not registered.`);
    }
    const discovered = await adapter.discover(args);
    // Strict tier gate: unverified adapters can be registered and detected, but never runnable.
    const effectiveStatus: BackendAvailabilityStatus = !adapter.verifiedRunnable
      ? discovered.status === "not_installed" || discovered.status === "installed_but_broken"
        ? discovered.status
        : "unavailable"
      : discovered.status;
    const effectiveModels: ModelCatalogEntry[] =
      adapter.verifiedRunnable && effectiveStatus === "runnable"
        ? discovered.models.map((entry) => ({
            backend: descriptor.backendId,
            modelId: entry.modelId,
            runnable: Boolean(entry.runnable),
            ...(entry.name ? { name: entry.name } : {}),
            ...(entry.status ? { status: entry.status } : {}),
            capabilities: {
              textInput: Boolean(entry.capabilities.textInput),
              textOutput: Boolean(entry.capabilities.textOutput),
              toolcall: Boolean(entry.capabilities.toolcall)
            },
            variants: [...entry.variants]
          }))
        : [];
    return {
      source: {
        backend: descriptor.backendId,
        displayName: descriptor.displayName,
        iconKey: descriptor.iconKey,
        transport: descriptor.transport,
        sessionKind: descriptor.sessionKind,
        status: effectiveStatus,
        ...(discovered.detail ? { detail: discovered.detail } : {})
      },
      models: effectiveModels
    };
  }
}

async function probeCliBinary(command: string, args: string[], cwd: string): Promise<{
  installed: boolean;
  healthy: boolean;
}> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "ignore",
      shell: process.platform === "win32"
    });
    const timer = setTimeout(() => child.kill(), 2500);
    child.once("error", (error) => {
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        resolvePromise({ installed: false, healthy: false });
        return;
      }
      resolvePromise({ installed: true, healthy: false });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ installed: true, healthy: code === 0 });
    });
  });
}

function createUnverifiedCliBackend(args: {
  backendId: ModelBackendId;
  displayName: string;
  iconKey: string;
  binary: string;
  versionArgs?: string[];
  transport?: BackendTransportKind;
  sessionKind?: BackendSessionKind;
}): { descriptor: BackendDescriptor; adapter: BackendAdapter } {
  const descriptor: BackendDescriptor = {
    backendId: args.backendId,
    displayName: args.displayName,
    iconKey: args.iconKey,
    transport: args.transport ?? "cli-stdio",
    sessionKind: args.sessionKind ?? "logical-session",
    capabilities: {
      textInput: true,
      textOutput: true,
      toolcall: true,
      structuredOutput: false,
      sessionReuse: false,
      abort: true
    }
  };
  const adapter: BackendAdapter = {
    backendId: args.backendId,
    verifiedRunnable: false,
    async discover({ workdir }) {
      const probe = await probeCliBinary(args.binary, args.versionArgs ?? ["--version"], workdir);
      if (!probe.installed) {
        return {
          status: "not_installed",
          detail: `${args.displayName} is not installed on this machine.`,
          models: []
        };
      }
      if (!probe.healthy) {
        return {
          status: "installed_but_broken",
          detail: `${args.displayName} binary was found but failed verification.`,
          models: []
        };
      }
      return {
        status: "unavailable",
        detail: `${args.displayName} is detected locally; structured OGS transport verification is pending.`,
        models: []
      };
    }
  };
  return { descriptor, adapter };
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
      const stdout = await runOpencodeModelsVerbose(args.workdir, args.commandRunner);
      const parsed = parseOpencodeModelsVerboseOutput(stdout);
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
      timeoutMs: 30000,
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
          workdir: request.workdir,
          directory: request.directory,
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
      timeoutMs: args.timeoutMs,
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
    const binaryProbe = await probeCliBinary("codex", ["--version"], args.workdir);
    if (!binaryProbe.installed) {
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
            cwd: request.directory,
            timeoutMs: request.timeoutMs,
            sessionId: request.sessionId,
            signal: request.signal
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

  const mainstreamClis = [
    createUnverifiedCliBackend({
      backendId: "claude-code",
      displayName: "Claude Code",
      iconKey: "claude-code",
      binary: "claude"
    }),
    createUnverifiedCliBackend({
      backendId: "gemini-cli",
      displayName: "Gemini CLI",
      iconKey: "gemini-cli",
      binary: "gemini"
    }),
    createUnverifiedCliBackend({
      backendId: "copilot-cli",
      displayName: "GitHub Copilot CLI",
      iconKey: "copilot-cli",
      binary: "copilot"
    }),
    createUnverifiedCliBackend({
      backendId: "qwen-code",
      displayName: "Qwen Code",
      iconKey: "qwen-code",
      binary: "qwen"
    }),
    createUnverifiedCliBackend({
      backendId: "kimi-cli",
      displayName: "Kimi CLI",
      iconKey: "kimi-cli",
      binary: "kimi"
    })
  ];

  for (const entry of mainstreamClis) {
    registry.register(entry.descriptor, entry.adapter);
  }

  return registry;
}

export const defaultBackendRegistry = createDefaultBackendRegistry();
