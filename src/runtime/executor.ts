import { writeFile } from "node:fs/promises";

import { executeOpencodeModelRole, startOpencodeRunClient } from "./opencode-executor.js";
import { appendEvent } from "./run-artifacts.js";
import { stringifyJson } from "./runtime-support.js";
import { runCliTool } from "./tool-runner.js";
import type {
  CliTool,
  ExecutionProfile,
  LoadedModelPackage,
  RunContext
} from "./types.js";

export type ExecutorBinding =
  | {
      kind: "model";
      modelPackage: LoadedModelPackage;
    }
  | {
      kind: "profile";
      profile: ExecutionProfile;
      tool: CliTool;
    };

export type ExecutorRequest = {
  roleId: string;
  prompt: string;
  schema: unknown;
  binding: ExecutorBinding;
  workdir: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  dryRunOutputEvent?: string;
  sessionId?: string;
};

export type ExecutorResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  args: string[];
  sessionId?: string;
  messageId?: string;
  serverPid?: number;
  modelId?: string;
  profileId?: string;
  toolRef?: string;
  command?: string;
};

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
  abortSession(args: { sessionId: string; workdir: string }): Promise<void>;
  
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
 * createDefaultExecutor creates the standard implementation of the Executor interface.
 * It supports both OpenCode-based model execution and local CLI tool execution.
 * In model mode, it manages a single 'opencode serve' instance to handle multiple
 * sequential or parallel role sessions efficiently.
 */
export function createDefaultExecutor(args: {
  dryRun?: boolean;
  runContext: RunContext;
  needsModelExecutor: boolean;
}): Executor {
  let runClient: Awaited<ReturnType<typeof startOpencodeRunClient>> | undefined;

  return {
    async start() {
      if (args.dryRun || !args.needsModelExecutor || runClient) {
        return;
      }

      runClient = await startOpencodeRunClient({
        timeoutMs: 30000,
        env: {
          OGSYSTEM_RUN_DIR: args.runContext.runDir,
          OGSYSTEM_SHARED_DIR: args.runContext.sharedDir
        }
      });

      await writeFile(
        args.runContext.opencodeServerPath,
        stringifyJson({
          lifecycle: "single-serve-multi-session",
          startedAt: runClient.startedAt,
          url: runClient.url,
          pid: runClient.pid
        }),
        "utf8"
      );
      await appendEvent(args.runContext, {
        type: "opencode_server_started",
        at: runClient.startedAt,
        url: runClient.url,
        pid: runClient.pid,
        lifecycle: "single-serve-multi-session"
      });
    },

    async execute(request) {
      if (request.binding.kind === "model") {
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
                sessionId: request.sessionId ?? `dryrun-session-${request.roleId}`,
                messageId: `dryrun-message-${request.roleId}`
              }
            : await executeOpencodeModelRole({
                roleId: request.roleId,
                prompt: request.prompt,
                schema: request.schema,
                modelPackage: request.binding.modelPackage,
                workdir: request.workdir,
                timeoutMs: request.timeoutMs,
                maxOutputBytes: request.maxOutputBytes,
                runClient,
                sessionId: request.sessionId
              });

        return {
          ...result,
          modelId: request.binding.modelPackage.manifest.modelId,
          toolRef: `model.${request.binding.modelPackage.manifest.modelId}`,
          command: "opencode-sdk"
        };
      }

      const result = await runCliTool({
        tool: request.binding.tool,
        vars: { prompt: request.prompt },
        env: request.env,
        workdir: request.workdir,
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
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
      if (!runClient) {
        return;
      }
      await runClient.client.session.abort({
        sessionID: run.sessionId,
        directory: run.workdir
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
      if (!runClient) {
        return;
      }

      const closedAt = new Date().toISOString();
      runClient.close();
      await writeFile(
        args.runContext.opencodeServerPath,
        stringifyJson({
          lifecycle: "single-serve-multi-session",
          startedAt: runClient.startedAt,
          closedAt,
          url: runClient.url,
          pid: runClient.pid
        }),
        "utf8"
      );
      await appendEvent(args.runContext, {
        type: "opencode_server_closed",
        at: closedAt,
        url: runClient.url,
        pid: runClient.pid,
        lifecycle: "single-serve-multi-session"
      });
      runClient = undefined;
    }
  };
}
