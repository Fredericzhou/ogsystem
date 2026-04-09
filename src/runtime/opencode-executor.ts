import { spawn } from "node:child_process";

import { createOpencodeClient } from "@opencode-ai/sdk/v2";

import { ToolExecutionError } from "./tool-runner.js";
import type { LoadedModelPackage } from "./types.js";

type StartedServer = {
  url: string;
  pid?: number;
  close(): void;
  getOutput(): string;
};

type PromptResponse = {
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
  create(args: { title: string }): Promise<{ data?: { id?: string } }>;
  prompt(args: {
    sessionID: string;
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
  }): Promise<PromptResponse>;
};

type OpencodeClientLike = {
  session: SessionApi;
};

export type OpencodeSdkTransport = {
  startServer(args: {
    timeoutMs: number;
    env?: Record<string, string>;
  }): Promise<StartedServer>;
  createClient(args: {
    baseUrl: string;
    directory: string;
  }): OpencodeClientLike;
};

export class OpencodeExecutionError extends Error {
  constructor(
    message: string,
    public readonly details?: {
      args?: string[];
      stdout?: string;
      stderr?: string;
    }
  ) {
    super(message);
    this.name = "OpencodeExecutionError";
  }
}

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

function normalizeStructuredOutput(structured: unknown): string {
  if (typeof structured !== "object" || structured === null || Array.isArray(structured)) {
    throw new Error("OpenCode structured output must be a JSON object");
  }
  return JSON.stringify(structured, null, 2);
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new ToolExecutionError("timeout", `Command timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
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
      finishReject(new ToolExecutionError("timeout", `OpenCode server startup timeout after ${args.timeoutMs}ms`));
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
          finishReject(new ToolExecutionError("spawn", `Failed to parse OpenCode server url from output: ${line}`));
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

function createClient(args: { baseUrl: string; directory: string }): OpencodeClientLike {
  return createOpencodeClient({
    baseUrl: args.baseUrl,
    directory: args.directory
  });
}

const defaultTransport: OpencodeSdkTransport = {
  startServer,
  createClient
};

export async function executeOpencodeModelRole(
  args: {
    roleId: string;
    prompt: string;
    schema: unknown;
    modelPackage: LoadedModelPackage;
    workdir: string;
    env?: Record<string, string>;
    timeoutMs: number;
    maxOutputBytes: number;
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
  const server = await transport.startServer({
    timeoutMs: Math.max(15000, Math.min(args.timeoutMs, 30000)),
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({}),
      ...args.env
    }
  });

  try {
    return await withTimeout(
      (async () => {
        const client = transport.createClient({
          baseUrl: server.url,
          directory: args.workdir
        });
        const created = await client.session.create({
          title: `${args.roleId}-${Date.now()}`
        });
        const sessionId = created.data?.id;
        if (!sessionId) {
          throw new Error("OpenCode SDK did not return a session id");
        }

        const response = await client.session.prompt({
          sessionID: sessionId,
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

        const info = response.data?.info;
        const stderr = summarizeParts(response.data?.parts);
        if (info?.error) {
          const message = info.error.data?.message || info.error.name || "OpenCode execution failed";
          throw new OpencodeExecutionError(message, {
            stderr,
            args: [
              "serve",
              "--hostname=127.0.0.1",
              "--port=0",
              `directory=${args.workdir}`,
              `session=${sessionId}`,
              `model=${providerID}/${modelID}`,
              ...(variant ? [`variant=${variant}`] : [])
            ]
          });
        }

        const stdout = normalizeStructuredOutput(info?.structured);
        enforceOutputLimit(stdout, stderr, args.maxOutputBytes);

        return {
          exitCode: 0,
          stdout,
          stderr,
          args: [
            "serve",
            "--hostname=127.0.0.1",
            "--port=0",
            `directory=${args.workdir}`,
            `session=${sessionId}`,
            `model=${providerID}/${modelID}`,
            ...(variant ? [`variant=${variant}`] : [])
          ],
          sessionId,
          messageId: response.data?.id,
          serverPid: server.pid
        };
      })(),
      args.timeoutMs,
      () => server.close()
    );
  } catch (error) {
    if (error instanceof OpencodeExecutionError) {
      const serverOutput = server.getOutput();
      throw new OpencodeExecutionError(error.message, {
        args: error.details?.args,
        stdout: error.details?.stdout,
        stderr: [error.details?.stderr, serverOutput].filter(Boolean).join("\n")
      });
    }
    throw error;
  } finally {
    server.close();
  }
}
