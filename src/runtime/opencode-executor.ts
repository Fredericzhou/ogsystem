/**
 * @fileoverview OpenCode SDK execution adapter for model-bound roles.
 * File Set: runtime-exec
 * Responsibilities:
 * - Start/stop OpenCode server and manage session prompts.
 * - Enforce timeout/retry/output constraints and normalize execution errors.
 * Boundaries:
 * - Does not mutate graph state or persist run artifacts.
 */
import { spawn } from "node:child_process";

import { createOpencodeClient } from "@opencode-ai/sdk/v2";

import { ToolExecutionError } from "./tool-runner.js";
import type { LoadedModelPackage } from "./types.js";

/**
 * Handles the OpenCode server lifecycle, sessions, and structured-output plumbing for model roles.
 * Responsibilities: start/stop the server, retry transient failures, enforce JSON schema adherence,
 * and translate OpenCode errors into runtime-friendly forms. Boundaries: does not mutate runtime state,
 * and all CLI interactions happen elsewhere. Trade-off: uses correction prompts instead of schema-less fallbacks
 * so callers either receive schema-shaped output or a failure.
 */

/**
 * Represents the spawned OpenCode serve process; callers must call `close` to avoid leaks.
 */
export type StartedServer = {
  url: string;
  pid?: number;
  close(): void;
  getOutput(): string;
};

type SessionCreateResponse = {
  error?: {
    name?: string;
    data?: unknown;
  };
  data?: {
    id?: string;
  };
  id?: string;
};

type SessionPromptResponse = {
  error?: {
    name?: string;
    data?: unknown;
  };
  data?: {
    id?: string;
    info?: {
      structured?: unknown;
      error?: {
        name?: string;
        data?: {
          message?: string;
        };
      };
    };
    parts?: Array<Record<string, unknown>>;
  };
};

type SessionApi = {
  create(args: {
    title: string;
    directory?: string;
    workspace?: string;
  }): Promise<SessionCreateResponse>;
  prompt(args: {
    sessionID: string;
    directory?: string;
    workspace?: string;
    model: {
      providerID: string;
      modelID: string;
    };
    variant?: string;
    format: {
      type: "json_schema";
      schema: Record<string, unknown>;
    };
    parts: Array<{
      type: "text";
      text: string;
    }>;
  }): Promise<SessionPromptResponse>;
  abort(args: {
    sessionID: string;
    directory?: string;
    workspace?: string;
  }): Promise<unknown>;
};

type OpencodeClientLike = {
  session: SessionApi;
};

/**
 * Transport layer allows injecting stubbed servers/clients for tests while production uses the CLI.
 */
export type OpencodeSdkTransport = {
  startServer(args: {
    timeoutMs: number;
    env?: Record<string, string>;
  }): Promise<StartedServer>;
  createClient(args: {
    baseUrl: string;
    directory?: string;
  }): OpencodeClientLike;
};

/**
 * Surface layer for a running OpenCode server; used to create sessions and collect diagnostics.
 */
export type OpencodeRunClient = {
  url: string;
  pid?: number;
  startedAt: string;
  close(): void;
  getOutput(): string;
  client: OpencodeClientLike;
};

/**
 * Wraps OpenCode failures so Executor can understand retryability, runtime args, and session IDs.
 */
export class OpencodeExecutionError extends Error {
  constructor(
    message: string,
    public readonly details?: {
      args?: string[];
      stdout?: string;
      stderr?: string;
      sessionId?: string;
      messageId?: string;
      serverPid?: number;
    }
  ) {
    super(message);
    this.name = "OpencodeExecutionError";
  }
}

const TRANSIENT_OPENCODE_ERROR_PATTERNS = [
  /service temporarily unavailable/i,
  /temporarily unavailable/i,
  /api_error/i,
  /rate limit/i,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /socket hang up/i,
  /econnreset/i
];

const MAX_OPENCODE_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const STRUCTURED_OUTPUT_CORRECTION_INSTRUCTION =
  "Return exactly one JSON object that matches the provided JSON schema. Do not include markdown fences or extra commentary.";

function splitModelRef(model: string): { providerID: string; modelID: string } {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error(
      `Model "${model}" must use "provider/model" format for OpenCode SDK execution`
    );
  }
  return {
    providerID: model.slice(0, separator),
    modelID: model.slice(separator + 1)
  };
}

function resolveVariant(args?: Record<string, string | boolean>): string | undefined {
  if (!args) {
    return undefined;
  }

  const supportedKeys = new Set(["variant", "reasoningEffort"]);
  const unsupportedKeys = Object.keys(args).filter((key) => !supportedKeys.has(key));
  if (unsupportedKeys.length > 0) {
    throw new Error(
      `Unsupported OpenCode model args for SDK execution: ${unsupportedKeys.join(", ")}`
    );
  }

  const variant = args.variant ?? args.reasoningEffort;
  if (variant === undefined) {
    return undefined;
  }
  if (typeof variant !== "string" || !variant.trim()) {
    throw new Error("OpenCode model variant must be a non-empty string");
  }
  return variant;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

function augmentKnownOpencodeError(
  message: string,
  modelRef: { providerID: string; modelID: string }
): string {
  if (message.includes("@ai-sdk/openai-compatible")) {
    return message;
  }
  if (
    /sdk\.responses is not a function/i.test(message) &&
    modelRef.providerID === "openai" &&
    /^gpt-5(?:$|[-.])/i.test(modelRef.modelID)
  ) {
    return [
      message,
      'Hint: OpenCode provider "openai" appears to use "@ai-sdk/openai-compatible", which does not expose responses().',
      'Update ~/.config/opencode/opencode.json provider.openai.npm to "@ai-sdk/openai", or switch to a non-Responses model (for example openai/gpt-4.1).'
    ].join("\n");
  }
  return message;
}

function extractSdkErrorMessage(
  response: { error?: { name?: string; data?: unknown } } | undefined,
  modelRef: { providerID: string; modelID: string }
): string | undefined {
  const payload = response?.error;
  if (!payload) {
    return undefined;
  }
  const messageFromData =
    typeof payload.data === "object" &&
    payload.data !== null &&
    "message" in payload.data &&
    typeof (payload.data as { message?: unknown }).message === "string"
      ? (payload.data as { message: string }).message
      : "";
  const message = messageFromData || payload.name || "";
  const normalized = message.trim();
  if (!normalized) {
    return undefined;
  }
  return augmentKnownOpencodeError(normalized, modelRef);
}

function isStructuredOutputMissingError(infoError: {
  name?: string;
  data?: {
    message?: string;
  };
}): boolean {
  const message = `${infoError.data?.message ?? ""} ${infoError.name ?? ""}`.trim();
  return /structured output/i.test(message) || /did not produce structured/i.test(message);
}

function isTransientOpenCodeError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return TRANSIENT_OPENCODE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function buildExecutionArgs(args: {
  runClient: OpencodeRunClient;
  workdir: string;
  sessionId?: string;
  messageId?: string;
  providerID: string;
  modelID: string;
  variant?: string;
}): string[] {
  return [
    `server=${args.runClient.url}`,
    `directory=${args.workdir}`,
    ...(args.sessionId ? [`session=${args.sessionId}`] : []),
    ...(args.messageId ? [`message=${args.messageId}`] : []),
    `model=${args.providerID}/${args.modelID}`,
    ...(args.variant ? [`variant=${args.variant}`] : [])
  ];
}

function wrapExecutionError(args: {
  error: unknown;
  stderr?: string;
  sessionId?: string;
  messageId?: string;
  serverPid?: number;
  providerID?: string;
  modelID?: string;
  executionArgs: string[];
}): OpencodeExecutionError {
  const baseMessage =
    args.error instanceof OpencodeExecutionError ? args.error.message : getErrorMessage(args.error);
  const message =
    args.providerID && args.modelID
      ? augmentKnownOpencodeError(baseMessage, {
          providerID: args.providerID,
          modelID: args.modelID
        })
      : baseMessage;

  if (args.error instanceof OpencodeExecutionError) {
    return new OpencodeExecutionError(message, {
      args: args.error.details?.args ?? args.executionArgs,
      stdout: args.error.details?.stdout,
      stderr: [args.stderr, args.error.details?.stderr].filter(Boolean).join("\n"),
      sessionId: args.error.details?.sessionId ?? args.sessionId,
      messageId: args.error.details?.messageId ?? args.messageId,
      serverPid: args.error.details?.serverPid ?? args.serverPid
    });
  }

  return new OpencodeExecutionError(message, {
    args: args.executionArgs,
    stderr: [args.stderr, message].filter(Boolean).join("\n"),
    sessionId: args.sessionId,
    messageId: args.messageId,
    serverPid: args.serverPid
  });
}

function summarizeParts(parts: Array<Record<string, unknown>> | undefined): string {
  if (!parts?.length) {
    return "";
  }

  return parts
    .map((part) => {
      const type = typeof part.type === "string" ? part.type : "unknown";
      if (type !== "tool") {
        return type;
      }

      const tool = typeof part.tool === "string" ? part.tool : "tool";
      const state =
        typeof part.state === "object" && part.state !== null
          ? (part.state as Record<string, unknown>)
          : undefined;
      const status = typeof state?.status === "string" ? state.status : "unknown";
      const error = typeof state?.error === "string" ? state.error : "";
      return `${tool}:${status}${error ? ` (${error})` : ""}`;
    })
    .join("\n");
}

function collectStringLeaves(value: unknown, sink: string[], depth = 0): void {
  if (depth > 6 || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      sink.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringLeaves(item, sink, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "id" || key === "type" || key === "tool" || key === "status") {
      continue;
    }
    collectStringLeaves(nested, sink, depth + 1);
  }
}

function extractStructuredOutputFromParts(parts: Array<Record<string, unknown>> | undefined): string | undefined {
  if (!parts?.length) {
    return undefined;
  }
  const candidates: string[] = [];
  for (const part of parts) {
    collectStringLeaves(part, candidates);
  }
  const unique = Array.from(new Set(candidates));
  if (unique.length === 0) {
    return undefined;
  }
  const jsonLike = unique.find((item) => item.includes("{") && item.includes("}"));
  return jsonLike ?? unique.join("\n");
}

function normalizeStructuredOutput(args: {
  structured: unknown;
  parts?: Array<Record<string, unknown>>;
}): string {
  if (
    typeof args.structured === "object" &&
    args.structured !== null &&
    !Array.isArray(args.structured)
  ) {
    return JSON.stringify(args.structured, null, 2);
  }
  if (typeof args.structured === "string" && args.structured.trim()) {
    return args.structured.trim();
  }
  const fallback = extractStructuredOutputFromParts(args.parts);
  if (fallback) {
    return fallback;
  }
  throw new Error("OpenCode structured output must be a JSON object");
}

function enforceOutputLimit(stdout: string, stderr: string, maxOutputBytes: number): void {
  const totalBytes = Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8");
  if (totalBytes > maxOutputBytes) {
    throw new ToolExecutionError(
      "output_limit",
      `Command output exceeded ${maxOutputBytes} bytes`
    );
  }
}

function createTimeoutError(timeoutMs: number): ToolExecutionError {
  return new ToolExecutionError("timeout", `Command timeout after ${timeoutMs}ms`);
}

function isTimeoutError(error: unknown): error is ToolExecutionError {
  return error instanceof ToolExecutionError && error.category === "timeout";
}

function throwIfCancelled(signal: AbortSignal, timeoutMs: number): void {
  if (!signal.aborted) {
    return;
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw createTimeoutError(timeoutMs);
}

/**
 * Stability: implements timeout-driven cancellation with AbortController.
 * On timeout the executor issues a best-effort remote abort before surfacing the timeout error.
 */
function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  onTimeout: (signal: AbortSignal) => void | Promise<void>
): Promise<T> {
  // Timeout cleanup is best-effort: abort the remote session when possible, but surface the timeout either way.
  return new Promise((resolve, reject) => {
    let settled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const timeoutError = createTimeoutError(timeoutMs);
      controller.abort(timeoutError);
      Promise.resolve(onTimeout(controller.signal))
        .catch(() => undefined)
        .finally(() => {
          if (settled) {
            return;
          }
          settled = true;
          reject(timeoutError);
        });
    }, timeoutMs);

    operation(controller.signal).then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function startServer(args: {
  timeoutMs: number;
  env?: Record<string, string>;
}): Promise<StartedServer> {
  const child = spawn("opencode", ["serve", "--hostname=127.0.0.1", "--port=0"], {
    env: {
      ...process.env,
      ...args.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  // stdout/stderr monitored so we can extract the listening URL and avoid waiting forever.
  let output = "";
  let settled = false;

  return await new Promise((resolve, reject) => {
    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const finishResolve = (url: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        url,
        pid: child.pid,
        close() {
          if (!child.killed) {
            child.kill("SIGTERM");
          }
        },
        getOutput() {
          return output.trim();
        }
      });
    };

    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      finishReject(
        new ToolExecutionError("timeout", `OpenCode server startup timeout after ${args.timeoutMs}ms`)
      );
    }, args.timeoutMs);

    const parseOutput = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const lines = output.split("\n");
      for (const line of lines) {
        if (!line.startsWith("opencode server listening")) {
          continue;
        }
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
        if (!match) {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
          finishReject(
            new ToolExecutionError("spawn", `Failed to parse OpenCode server url from output: ${line}`)
          );
          return;
        }
        finishResolve(match[1]);
        return;
      }
    };

    child.stdout.on("data", parseOutput);
    child.stderr.on("data", parseOutput);
    child.on("error", (error) => {
      finishReject(new ToolExecutionError("spawn", error.message));
    });
    child.on("exit", (code) => {
      if (!settled) {
        finishReject(
          new ToolExecutionError(
            "spawn",
            `OpenCode server exited with code ${code ?? 1}${output.trim() ? `\n${output.trim()}` : ""}`
          )
        );
      }
    });
  });
}

function createClient(args: { baseUrl: string; directory?: string }): OpencodeClientLike {
  if (args.directory) {
    return createOpencodeClient({
      baseUrl: args.baseUrl,
      directory: args.directory
    });
  }
  return createOpencodeClient({
    baseUrl: args.baseUrl
  });
}

const defaultTransport: OpencodeSdkTransport = {
  startServer,
  createClient
};

/**
 * startOpencodeRunClient launches an 'opencode serve' process and creates
 * a client to interact with it. It's used for model-based role executions.
 */
export async function startOpencodeRunClient(
  args: {
    timeoutMs: number;
    env?: Record<string, string>;
    directory?: string;
  },
  transport: OpencodeSdkTransport = defaultTransport
): Promise<OpencodeRunClient> {
  const server = await transport.startServer(args);
  return {
    url: server.url,
    pid: server.pid,
    startedAt: new Date().toISOString(),
    close() {
      server.close();
    },
    getOutput() {
      return server.getOutput();
    },
    client: transport.createClient({
      baseUrl: server.url,
      directory: args.directory
    })
  };
}

/**
 * executeOpencodeModelRole is the primary function for running a model-bound role.
 * It manages:
 * 1. Starting the OpenCode server (if not already provided).
 * 2. Creating or reusing a session.
 * 3. Sending the prompt and receiving the structured response.
 * 4. Automatic retries for transient errors.
 * 5. Simple output correction if the model fails to return valid JSON.
 * The call also enforces that timeouts abort remote sessions and non-transient failures stop retries.
 */
export async function executeOpencodeModelRole(
  args: {
    roleId: string;
    prompt: string;
    schema: unknown;
    modelPackage: LoadedModelPackage;
    workdir: string;
    timeoutMs: number;
    maxOutputBytes: number;
    runClient?: OpencodeRunClient;
    sessionId?: string;
  },
  transport: OpencodeSdkTransport = defaultTransport
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  args: string[];
  sessionId: string;
  messageId?: string;
  serverPid?: number;
}> {
  if (typeof args.schema !== "object" || args.schema === null || Array.isArray(args.schema)) {
    throw new Error(`Role "${args.roleId}" output schema must be a JSON object`);
  }

  const { providerID, modelID } = splitModelRef(args.modelPackage.manifest.model);
  const variant = resolveVariant(args.modelPackage.manifest.args);
  // Start a local OpenCode server only when the caller has not already supplied one.
  const ownRunClient = args.runClient
    ? undefined
    : await startOpencodeRunClient(
        {
          timeoutMs: Math.max(15000, Math.min(args.timeoutMs, 30000)),
          directory: args.workdir
        },
        transport
      );
  const runClient = args.runClient ?? ownRunClient;
  if (!runClient) {
    throw new Error("OpenCode run client is unavailable");
  }
  let sessionId = args.sessionId ?? "";
  let messageId: string | undefined;
  let timeoutCleanupSessionId: string | undefined;

  try {
    return await withTimeout(
      async (signal) => {
        const abortTimedOutSession = async (): Promise<void> => {
          if (!sessionId || timeoutCleanupSessionId === sessionId) {
            return;
          }
          timeoutCleanupSessionId = sessionId;
          try {
            await runClient.client.session.abort({
              sessionID: sessionId,
              directory: args.workdir
            });
          } catch {
            // Ignore timeout cleanup failures; the timeout error is the primary signal.
          }
        };

        const ensureNotCancelled = async (): Promise<void> => {
          if (!signal.aborted) {
            return;
          }
          await abortTimedOutSession();
          throwIfCancelled(signal, args.timeoutMs);
        };

        for (let attempt = 1; attempt <= MAX_OPENCODE_ATTEMPTS; attempt += 1) {
          await ensureNotCancelled();
          sessionId = args.sessionId ?? sessionId;
          messageId = undefined;
          let stderr = "";

          try {
            if (!sessionId) {
              const created = await runClient.client.session.create({
                title: `${args.roleId}-${Date.now()}`,
                directory: args.workdir
              });
              const createErrorMessage = extractSdkErrorMessage(created, {
                providerID,
                modelID
              });
              if (createErrorMessage) {
                throw new Error(createErrorMessage);
              }
              sessionId =
                created.data?.id ??
                (typeof created.id === "string" ? created.id : "") ??
                "";
              if (!sessionId) {
                throw new Error("OpenCode SDK did not return a session id");
              }
              await ensureNotCancelled();
            }

            await ensureNotCancelled();
            const response = await runClient.client.session.prompt({
              sessionID: sessionId,
              directory: args.workdir,
              model: {
                providerID,
                modelID
              },
              variant,
              format: {
                type: "json_schema",
                schema: args.schema as Record<string, unknown>
              },
              parts: [
                {
                  type: "text",
                  text: args.prompt
                }
              ]
            });
            await ensureNotCancelled();

            const promptErrorMessage = extractSdkErrorMessage(response, {
              providerID,
              modelID
            });
            if (promptErrorMessage) {
              throw new Error(promptErrorMessage);
            }
            const info = response.data?.info;
            messageId = response.data?.id;
            stderr = summarizeParts(response.data?.parts);
            if (info?.error && !isStructuredOutputMissingError(info.error)) {
              const message = augmentKnownOpencodeError(
                info.error.data?.message || info.error.name || "OpenCode execution failed",
                {
                  providerID,
                  modelID
                }
              );
              throw new OpencodeExecutionError(message, {
                stderr,
                sessionId,
                messageId,
                serverPid: runClient.pid,
                args: buildExecutionArgs({
                  runClient,
                  workdir: args.workdir,
                  sessionId,
                  messageId,
                  providerID,
                  modelID,
                  variant
                })
              });
            }

            let stdout: string;
            try {
              stdout = normalizeStructuredOutput({
                structured: info?.structured,
                parts: response.data?.parts
              });
            } catch (error) {
              if (getErrorMessage(error) !== "OpenCode structured output must be a JSON object") {
                throw error;
              }

              const correctionResponse = await runClient.client.session.prompt({
                sessionID: sessionId,
                directory: args.workdir,
                model: {
                  providerID,
                  modelID
                },
                variant,
                format: {
                  type: "json_schema",
                  schema: args.schema as Record<string, unknown>
                },
                parts: [
                  {
                    type: "text",
                    text: `${args.prompt}\n\n${STRUCTURED_OUTPUT_CORRECTION_INSTRUCTION}`
                  }
                ]
              });
              await ensureNotCancelled();

              const correctionErrorMessage = extractSdkErrorMessage(correctionResponse, {
                providerID,
                modelID
              });
              if (correctionErrorMessage) {
                throw new Error(correctionErrorMessage);
              }
              const correctionInfo = correctionResponse.data?.info;
              messageId = correctionResponse.data?.id;
              const correctionStderr = summarizeParts(correctionResponse.data?.parts);
              stderr = [stderr, correctionStderr].filter(Boolean).join("\n");
              if (correctionInfo?.error && !isStructuredOutputMissingError(correctionInfo.error)) {
                const message = augmentKnownOpencodeError(
                  correctionInfo.error.data?.message ||
                    correctionInfo.error.name ||
                    "OpenCode execution failed",
                  {
                    providerID,
                    modelID
                  }
                );
                throw new OpencodeExecutionError(message, {
                  stderr,
                  sessionId,
                  messageId,
                  serverPid: runClient.pid,
                  args: buildExecutionArgs({
                    runClient,
                    workdir: args.workdir,
                    sessionId,
                    messageId,
                    providerID,
                    modelID,
                    variant
                  })
                });
              }

              stdout = normalizeStructuredOutput({
                structured: correctionInfo?.structured,
                parts: correctionResponse.data?.parts
              });
            }
            enforceOutputLimit(stdout, stderr, args.maxOutputBytes);

            return {
              exitCode: 0,
              stdout,
              stderr,
              args: buildExecutionArgs({
                runClient,
                workdir: args.workdir,
                sessionId,
                messageId,
                providerID,
                modelID,
                variant
              }),
              sessionId,
              messageId,
              serverPid: runClient.pid
            };
          } catch (error) {
            if (isTimeoutError(error)) {
              throw error;
            }

            const wrappedError = wrapExecutionError({
              error,
              stderr,
              sessionId,
              messageId,
              serverPid: runClient.pid,
              providerID,
              modelID,
              executionArgs: buildExecutionArgs({
                runClient,
                workdir: args.workdir,
                sessionId,
                messageId,
                providerID,
                modelID,
                variant
              })
            });

            if (attempt >= MAX_OPENCODE_ATTEMPTS || !isTransientOpenCodeError(error)) {
              if (attempt > 1) {
                throw new OpencodeExecutionError(
                  `OpenCode execution failed after ${attempt} attempts: ${wrappedError.message}`,
                  wrappedError.details
                );
              }
              throw wrappedError;
            }

            if (sessionId) {
              // Attempt a best-effort abort so the next retry starts fresh.
              try {
                await runClient.client.session.abort({
                  sessionID: sessionId,
                  directory: args.workdir
                });
              } catch {
                // Retry should still proceed when best-effort abort fails.
              }
            }
            await sleep(RETRY_BASE_DELAY_MS * attempt);
          }
        }

        throw new Error("OpenCode execution attempts exhausted");
      },
      args.timeoutMs,
      async () => {
        if (!sessionId || timeoutCleanupSessionId === sessionId) {
          return;
        }
        timeoutCleanupSessionId = sessionId;
        try {
          await runClient.client.session.abort({
            sessionID: sessionId,
            directory: args.workdir
          });
        } catch {
          // Ignore timeout cleanup failures; the timeout error is the primary signal.
        }
      }
    );
  } catch (error) {
    if (error instanceof OpencodeExecutionError) {
      const serverOutput = runClient.getOutput();
      throw new OpencodeExecutionError(error.message, {
        args: error.details?.args,
        stdout: error.details?.stdout,
        stderr: [error.details?.stderr, serverOutput].filter(Boolean).join("\n"),
        sessionId: error.details?.sessionId,
        messageId: error.details?.messageId,
        serverPid: error.details?.serverPid
      });
    }
    throw error;
  } finally {
    ownRunClient?.close();
  }
}
