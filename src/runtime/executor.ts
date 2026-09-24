/**
 * @fileoverview Execution bridge that routes role requests to model or CLI backends.
 * File Set: runtime-exec
 * Responsibilities:
 * - Manage shared OpenCode server lifecycle for model-bound roles.
 * - Execute model/profile bindings with consistent result contracts.
 * Boundaries:
 * - Does not parse role output semantics or advance graph state.
 */
import { writeFile } from "node:fs/promises";

import { executeOpencodeModelRole, startOpencodeRunClient } from "./opencode-executor.js";
import { CodexAppServerClient } from "./codex-app-server.js";
import { filesystemArtifactStore } from "./artifact-store.js";
import { stringifyJson } from "./runtime-support.js";
import { runCliTool } from "./tool-runner.js";
import type { CliTool, ExecutionProfile, RunContext } from "./types.js";

/**
 * Acts as the bridge between runtime role planning and actual execution engines.
 * Responsibilities: manage the OpenCode server lifecycle, route model/profile bindings,
 * and surface deterministic outputs for auditing. Boundaries: does not inspect schema outputs
 * itself, it only orchestrates either OpenCode SDK or CLI tool runs.
 */

/**
 * Describes how a role should be executed. Model bindings rely on OpenCode SDK runs,
 * whereas profile bindings delegate to a CLI tool; callers must not mix the two.
 */
export type ExecutorBinding =
  | {
      kind: "model";
      backend: "opencode" | "codex" | "claude" | "antigravity";
      modelId: string;
      modelRef: string;
      variant?: string;
    }
  | {
    kind: "profile";
    profile: ExecutionProfile;
    tool: CliTool;
  };

/**
 * Input bundle for a single role execution, including the prompt, schema, and infrastructure bindings.
 * `sessionKey` is optional but shared across retries; `dryRunOutputEvent` drives test instrumentation.
 */
export type ExecutorRequest = {
  roleId: string;
  sessionKey?: string;
  prompt: string;
  schema: unknown;
  binding: ExecutorBinding;
  workdir: string;
  /** Coding project passed to OpenCode SDK session APIs. */
  directory: string;
  commandBaseDir?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  dryRunOutputEvent?: string;
  sessionId?: string;
};

/**
 * Result returned to the planner. `exitCode`/`stdout` reflect the external executor, while
 * optional IDs capture the OpenCode session (or CLI profile) for auditing and recovery.
 */
export type ExecutorResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  args: string[];
  sessionId?: string;
  messageId?: string;
  serverPid?: number;
  modelId?: string;
  backend?: string;
  profileId?: string;
  toolRef?: string;
  command?: string;
};

/**
 * Metadata that reflects the current OpenCode server state; empty when no server is running.
 */
export type ExecutorServerMetadata = {
  url?: string;
  pid?: number;
  startedAt?: string;
};

/**
 * Executor is the interface for executing role actions.
 * It abstracts away whether a role is executed by an LLM (model) 
 * or by a local tool (profile).
 */
export interface Executor {
  /**
   * Starts any necessary background services (like the OpenCode server).
   */
  start(): Promise<void>;
  
  /**
   * Executes a single role request.
   */
  execute(request: ExecutorRequest): Promise<ExecutorResult>;
  
  /**
   * Aborts an ongoing session (for model-based execution).
   */
  abortSession(args: { sessionId: string; directory: string }): Promise<void>;
  
  /**
   * Returns metadata about any running background services.
   */
  getServerMetadata(): ExecutorServerMetadata;
  
  /**
   * Shuts down background services and cleans up resources.
   */
  close(): Promise<void>;
}

/**
 * createDefaultExecutor returns the default runtime executor.
 * It manages an optional OpenCode server for model roles while leaving profile execution local.
 * The implementation persists the OpenCode endpoint/pid for observability and keeps `start`/`close`
 * idempotent so the runtime can safely call them during retries.
 */
export function createDefaultExecutor(args: {
  dryRun?: boolean;
  runContext: RunContext;
  targetDir: string;
  needsModelExecutor: boolean;
  modelBackends?: string[];
}): Executor {
  let runClient: Awaited<ReturnType<typeof startOpencodeRunClient>> | undefined;
  let codexClient: CodexAppServerClient | undefined;

  return {
    async start() {
      // Guard ensures model server is started only once and only when needed.
      if (args.dryRun || !args.needsModelExecutor) {
        return;
      }
      const backends = new Set(args.modelBackends?.length ? args.modelBackends : ["opencode"]);
      if (backends.has("opencode")) {
        runClient = await startOpencodeRunClient({
          timeoutMs: 30000,
          env: { OGSYSTEM_RUN_DIR: args.runContext.runDir, OGSYSTEM_SHARED_DIR: args.runContext.sharedDir },
          directory: args.targetDir
        });
        await writeFile(args.runContext.opencodeEndpointPath, stringifyJson({
          backend: "opencode", lifecycle: "single-serve-multi-session", startedAt: runClient.startedAt,
          url: runClient.url, pid: runClient.pid
        }), "utf8");
        await writeFile(args.runContext.opencodePidPath, `${runClient.pid ?? ""}\n`, "utf8");
        await filesystemArtifactStore.appendEvent(args.runContext, {
          type: "backend_server_started", backend: "opencode", at: runClient.startedAt,
          url: runClient.url, pid: runClient.pid, lifecycle: "single-serve-multi-session"
        });
      }
      if (backends.has("codex")) {
        codexClient = await CodexAppServerClient.start({
          cwd: args.targetDir,
          env: { OGSYSTEM_RUN_DIR: args.runContext.runDir, OGSYSTEM_SHARED_DIR: args.runContext.sharedDir }
        });
        await filesystemArtifactStore.appendEvent(args.runContext, {
          type: "backend_server_started", backend: "codex", at: new Date().toISOString(),
          lifecycle: "single-app-server-multi-thread"
        });
      }
      await filesystemArtifactStore.flush(args.runContext);
    },

    async execute(request) {
      // Model-bound paths depend on the shared OpenCode client; throw if it's missing during active runs.
      if (request.binding.kind === "model") {
        if (request.binding.backend === "codex") {
          if (!args.dryRun && !codexClient) throw new Error(`Codex app-server missing for role "${request.roleId}"`);
          const result = args.dryRun || !codexClient
            ? { sessionId: request.sessionId ?? `dryrun-codex-${request.sessionKey ?? request.roleId}`, stdout: JSON.stringify({ event: request.dryRunOutputEvent, content: "[dry-run] codex-app-server" }) }
            : await codexClient.execute({
                roleId: request.roleId, prompt: request.prompt, schema: request.schema,
                modelId: request.binding.modelId, cwd: request.directory, timeoutMs: request.timeoutMs,
                sessionId: request.sessionId, signal: request.signal
              });
          return {
            exitCode: 0, stdout: result.stdout, stderr: "", args: ["app-server"],
            sessionId: result.sessionId, messageId: result.messageId, modelId: request.binding.modelId,
            backend: "codex",
            toolRef: `model.codex/${request.binding.modelId}`, command: "codex app-server"
          };
        }
        if (request.binding.backend !== "opencode") throw new Error(`Backend "${request.binding.backend}" has no persistent OGS executor`);
        if (request.binding.backend !== "opencode") {
          throw new Error(`Backend "${request.binding.backend}" is not yet supported for persistent execution`);
        }
        if (!args.dryRun && !runClient) {
          throw new Error(`OpenCode run server missing for model-bound role "${request.roleId}"`);
        }

        const result =
          args.dryRun || !runClient
            ? {
                exitCode: 0,
                stdout: JSON.stringify({
                  event: request.dryRunOutputEvent,
                  content: "[dry-run] opencode-sdk"
                }),
                stderr: "",
                args: [] as string[],
                sessionId: request.sessionId ?? `dryrun-session-${request.sessionKey ?? request.roleId}`,
                messageId: `dryrun-message-${request.sessionKey ?? request.roleId}`
              }
            : await executeOpencodeModelRole({
                roleId: request.roleId,
                prompt: request.prompt,
                schema: request.schema,
                modelRef: request.binding.modelRef,
                variant: request.binding.variant,
                workdir: request.workdir,
                directory: request.directory,
                timeoutMs: request.timeoutMs,
                maxOutputBytes: request.maxOutputBytes,
                signal: request.signal,
                runClient,
                sessionId: request.sessionId
              });

        return {
          ...result,
          modelId: request.binding.modelRef,
          backend: "opencode",
          toolRef: `model.${request.binding.modelRef}`,
          command: "opencode-sdk"
        };
      }

      // CLI tool executions are isolated per request and do not rely on OpenCode state.
      const result = await runCliTool({
        tool: request.binding.tool,
        vars: { prompt: request.prompt },
        env: request.env,
        commandBaseDir: request.commandBaseDir ?? request.workdir,
        workdir: request.workdir,
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
        signal: request.signal,
        dryRun: args.dryRun,
        dryRunOutput: {
          event: request.dryRunOutputEvent
        }
      });

      return {
        ...result,
        profileId: request.binding.profile.profileId,
        toolRef: request.binding.tool.toolRef,
        command: request.binding.tool.command
      };
    },

    async abortSession(run) {
      // No-op when the model server is not running; aborts only make sense for model-backed roles.
      if (!runClient) {
        return;
      }
      await runClient.client.session.abort({
        sessionID: run.sessionId,
        directory: run.directory
      });
    },

    getServerMetadata() {
      return runClient
        ? {
            url: runClient.url,
            pid: runClient.pid,
            startedAt: runClient.startedAt
          }
        : {};
    },

    async close() {
      const closedAt = new Date().toISOString();
      if (runClient) {
        await runClient.close();
        await writeFile(args.runContext.opencodeEndpointPath, stringifyJson({
          backend: "opencode", lifecycle: "single-serve-multi-session", startedAt: runClient.startedAt,
          closedAt, url: runClient.url, pid: runClient.pid
        }), "utf8");
        await filesystemArtifactStore.appendEvent(args.runContext, {
          type: "backend_server_closed", backend: "opencode", at: closedAt,
          url: runClient.url, pid: runClient.pid, lifecycle: "single-serve-multi-session"
        });
        runClient = undefined;
      }
      if (codexClient) {
        await codexClient.close();
        await filesystemArtifactStore.appendEvent(args.runContext, {
          type: "backend_server_closed", backend: "codex", at: closedAt,
          lifecycle: "single-app-server-multi-thread"
        });
        codexClient = undefined;
      }
      await filesystemArtifactStore.flush(args.runContext);
    }
  };
}
