/**
 * @fileoverview Execution bridge that routes role requests to model or CLI backends.
 * File Set: runtime-exec
 * Responsibilities:
 * - Manage shared backend run sessions via BackendRegistry for model-bound roles.
 * - Execute model/profile bindings with consistent result contracts.
 * Boundaries:
 * - Does not parse role output semantics or advance graph state.
 */
import { filesystemArtifactStore } from "./artifact-store.js";
import {
  defaultBackendRegistry,
  type BackendRunSession,
  type ModelBackendId
} from "./model-backend-registry.js";
import { getSideEffectByKey, recordSideEffect } from "./side-effect-store.js";
import { runCliTool, ToolExecutionError } from "./tool-runner.js";
import type { CliTool, ExecutionProfile, RunContext } from "./types.js";

type JsonSchemaShape = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchemaShape>;
  required?: string[];
  items?: JsonSchemaShape;
  minItems?: number;
  minLength?: number;
  minimum?: number;
};

function minimumSchemaValue(schema: JsonSchemaShape): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.type === "object") {
    const value: Record<string, unknown> = {};
    for (const key of schema.required ?? []) {
      const child = schema.properties?.[key];
      if (child) value[key] = minimumSchemaValue(child);
    }
    return value;
  }
  if (schema.type === "array") {
    return Array.from({ length: schema.minItems ?? 0 }, () => minimumSchemaValue(schema.items ?? {}));
  }
  if (schema.type === "string") return "x".repeat(schema.minLength ?? 0);
  if (schema.type === "number" || schema.type === "integer") return schema.minimum ?? 0;
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;
  return null;
}

function buildDryRunRoleOutput(schema: unknown, event: string | undefined, content: string): Record<string, unknown> {
  const shape = schema && typeof schema === "object" ? schema as JsonSchemaShape : {};
  const output = minimumSchemaValue(shape);
  const result = output && typeof output === "object" && !Array.isArray(output)
    ? output as Record<string, unknown>
    : {};
  if (shape.properties?.event) result.event = event ?? minimumSchemaValue(shape.properties.event);
  if (shape.properties?.content) result.content = content;
  return result;
}

export type ExecutorBinding =
  | {
      kind: "model";
      backend: ModelBackendId;
      modelId: string;
      modelRef: string;
      fallbackModelId?: string;
      variant?: string;
    }
  | {
      kind: "profile";
      profile: ExecutionProfile;
      tool: CliTool;
    };

export type ExecutorRequest = {
  roleId: string;
  sessionKey?: string;
  prompt: string;
  schema: unknown;
  binding: ExecutorBinding;
  workdir: string;
  directory: string;
  commandBaseDir?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  dryRunOutputEvent?: string;
  sessionId?: string;
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

export type ExecutorServerMetadata = {
  url?: string;
  pid?: number;
  startedAt?: string;
};

export interface Executor {
  supportsPromptCallMetering?: boolean;
  start(): Promise<void>;
  execute(request: ExecutorRequest): Promise<ExecutorResult>;
  abortSession(args: { sessionId: string; directory: string }): Promise<void>;
  getServerMetadata(): ExecutorServerMetadata;
  close(): Promise<void>;
}

export type SandboxToolExecutor = (request: ExecutorRequest) => Promise<ExecutorResult>;

export function createDefaultExecutor(args: {
  dryRun?: boolean;
  sandbox?: boolean;
  runContext: RunContext;
  targetDir: string;
  needsModelExecutor: boolean;
  modelBackends?: string[];
  toolEnvironmentPolicy?: "inherit" | "minimal";
  toolEnvAllowlist?: string[];
  sandboxToolExecutor?: SandboxToolExecutor;
}): Executor {
  const sessionsByBackend = new Map<ModelBackendId, BackendRunSession>();

  return {
    supportsPromptCallMetering: true,
    async start() {
      if (args.dryRun || !args.needsModelExecutor) {
        return;
      }
      const backends = new Set<ModelBackendId>(args.modelBackends?.length ? args.modelBackends : ["opencode"]);
      for (const backendId of backends) {
        if (sessionsByBackend.has(backendId)) continue;
        const adapter = defaultBackendRegistry.getAdapter(backendId);
        if (!adapter || !adapter.verifiedRunnable || !adapter.startRun) {
          throw new Error(`Backend "${backendId}" has no runnable OGS executor`);
        }
        const session = await adapter.startRun({
          runContext: args.runContext,
          targetDir: args.targetDir
        });
        sessionsByBackend.set(backendId, session);
      }
      await filesystemArtifactStore.flush(args.runContext);
    },

    async execute(request) {
      if (request.binding.kind === "model") {
        const backendId = request.binding.backend;
        const adapter = defaultBackendRegistry.getAdapter(backendId);
        if (!adapter || !adapter.verifiedRunnable || !adapter.startRun) {
          throw new Error(`Backend "${backendId}" has no persistent OGS executor`);
        }
        if (args.dryRun) {
          const phase = request.promptCallPhase ?? "primary";
          await request.onPromptCall?.({ phase, ordinal: 1, stage: "before", prompt: request.prompt });
          const dryRunTag = backendId === "codex"
            ? "[dry-run] codex-app-server"
            : backendId === "opencode"
              ? "[dry-run] opencode-sdk"
              : `[dry-run] ${backendId}`;
          const stdout = JSON.stringify(
            buildDryRunRoleOutput(request.schema, request.dryRunOutputEvent, dryRunTag)
          );
          const sessionId = request.sessionId ?? (
            backendId === "codex"
              ? `dryrun-codex-${request.sessionKey ?? request.roleId}`
              : `dryrun-session-${request.sessionKey ?? request.roleId}`
          );
          const messageId = `dryrun-message-${request.sessionKey ?? request.roleId}`;
          await request.onPromptCall?.({
            phase,
            ordinal: 1,
            stage: "after",
            prompt: request.prompt,
            outputChars: stdout.length,
            output: stdout
          });
          return {
            exitCode: 0,
            stdout,
            stderr: "",
            args: backendId === "codex" ? ["app-server"] : [],
            sessionId,
            messageId,
            modelId: request.binding.modelId,
            backend: backendId,
            toolRef: backendId === "opencode"
              ? `model.${request.binding.modelId}`
              : `model.${backendId}/${request.binding.modelId}`,
            command: backendId === "codex"
              ? "codex app-server"
              : backendId === "opencode"
                ? "opencode-sdk"
                : `${backendId}-adapter`
          };
        }

        let session = sessionsByBackend.get(backendId);
        if (!session) {
          session = await adapter.startRun({
            runContext: args.runContext,
            targetDir: args.targetDir
          });
          sessionsByBackend.set(backendId, session);
        }

        return session.execute({
          roleId: request.roleId,
          sessionKey: request.sessionKey,
          sessionId: request.sessionId,
          prompt: request.prompt,
          schema: request.schema,
          modelId: request.binding.modelId,
          variant: request.binding.variant,
          workdir: request.workdir,
          directory: request.directory,
          timeoutMs: request.timeoutMs,
          maxOutputBytes: request.maxOutputBytes,
          signal: request.signal,
          promptCallPhase: request.promptCallPhase,
          onPromptCall: request.onPromptCall
        });
      }

      // CLI tool executions are isolated per request and do not rely on model backend state.
      const sideEffectKey = `${args.runContext.runId}:tool:${request.sessionKey ?? request.roleId}`;
      if (args.sandbox && args.runContext.runDir) {
        const prior = await getSideEffectByKey(args.runContext.runDir, sideEffectKey);
        if (prior?.status === "completed" && prior.result && typeof prior.result === "object") {
          return prior.result as ExecutorResult;
        }
        if (prior?.status === "unknown" || prior?.status === "needs_review") {
          throw new Error(`SIDE_EFFECT_TERMINAL_UNCERTAIN: ${sideEffectKey} is ${prior.status}`);
        }
        await recordSideEffect(args.runContext.runDir, {
          operationId: `tool:${request.sessionKey ?? request.roleId}`,
          idempotencyKey: sideEffectKey,
          approvalId: null,
          status: "requested",
          startedAt: new Date().toISOString()
        });
        await recordSideEffect(args.runContext.runDir, {
          operationId: `tool:${request.sessionKey ?? request.roleId}`,
          idempotencyKey: sideEffectKey,
          approvalId: null,
          status: "running",
          startedAt: new Date().toISOString()
        });
      }
      let result: Awaited<ReturnType<typeof runCliTool>>;
      try {
        result = args.sandbox && args.sandboxToolExecutor
          ? await args.sandboxToolExecutor(request)
          : await runCliTool({
              tool: request.binding.tool,
              vars: { prompt: request.prompt },
              env: request.env,
              environmentPolicy: args.toolEnvironmentPolicy,
              envAllowlist: args.toolEnvAllowlist,
              commandBaseDir: request.commandBaseDir ?? request.workdir,
              workdir: request.workdir,
              timeoutMs: request.timeoutMs,
              maxOutputBytes: request.maxOutputBytes,
              signal: request.signal,
              dryRun: args.dryRun || args.sandbox,
              dryRunOutput: {
                event: request.dryRunOutputEvent,
                output: buildDryRunRoleOutput(request.schema, request.dryRunOutputEvent, "")
              }
            });
        if (result.exitCode !== 0) {
          throw new ToolExecutionError("exit_code", `Sandbox tool exited with code ${result.exitCode}`);
        }
        if (args.sandbox && args.runContext.runDir) await recordSideEffect(args.runContext.runDir, {
          operationId: `tool:${request.sessionKey ?? request.roleId}`,
          idempotencyKey: sideEffectKey,
          approvalId: null,
          status: "completed",
          completedAt: new Date().toISOString(),
          result: { ...result, simulated: true }
        });
      } catch (error) {
        if (args.sandbox && args.runContext.runDir) {
          const status = error && typeof error === "object" && "sideEffectStatus" in error
            ? String((error as { sideEffectStatus?: unknown }).sideEffectStatus)
            : request.signal?.aborted || (error instanceof Error && error.name === "AbortError")
              ? "interrupted"
              : error instanceof ToolExecutionError && error.category === "timeout"
                ? "timeout"
                : error instanceof ToolExecutionError && error.category === "exit_code"
                  ? "failed"
                  : "unknown";
          const acceptedStatus = ["failed", "timeout", "interrupted", "unknown", "needs_review"].includes(status)
            ? status as "failed" | "timeout" | "interrupted" | "unknown" | "needs_review"
            : "unknown";
          await recordSideEffect(args.runContext.runDir, {
            operationId: `tool:${request.sessionKey ?? request.roleId}`,
            idempotencyKey: sideEffectKey,
            approvalId: null,
            status: acceptedStatus,
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error)
          });
        }
        throw error;
      }

      return {
        ...result,
        profileId: request.binding.profile.profileId,
        toolRef: request.binding.tool.toolRef,
        command: request.binding.tool.command
      };
    },

    async abortSession(run) {
      for (const session of sessionsByBackend.values()) {
        if (session.abort) {
          await session.abort(run);
        }
      }
    },

    getServerMetadata() {
      const opencodeSession = sessionsByBackend.get("opencode");
      if (opencodeSession?.getServerMetadata) {
        return opencodeSession.getServerMetadata();
      }
      for (const session of sessionsByBackend.values()) {
        if (session.getServerMetadata) {
          return session.getServerMetadata();
        }
      }
      return {};
    },

    async close() {
      for (const [backendId, session] of sessionsByBackend.entries()) {
        await session.close();
        sessionsByBackend.delete(backendId);
      }
      await filesystemArtifactStore.flush(args.runContext);
    }
  };
}
