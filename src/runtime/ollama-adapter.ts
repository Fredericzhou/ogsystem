import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { OpencodeExecutionError } from "./opencode-executor.js";
import type {
  BackendAdapter,
  BackendAvailabilityStatus,
  BackendDescriptor,
  BackendExecuteRequest,
  BackendExecuteResult,
  BackendRunSession
} from "./model-backend-registry.js";
import type { ModelCatalogEntry } from "./types.js";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

function localOllamaUrl(value: string): string | undefined {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function resolveOllamaBaseUrl(): string {
  const raw = process.env.OLLAMA_HOST?.trim();
  if (!raw) {
    return DEFAULT_OLLAMA_BASE_URL;
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return localOllamaUrl(withProtocol) ?? DEFAULT_OLLAMA_BASE_URL;
}

async function isCommandInstalled(command: string, args: string[], cwd: string): Promise<{
  installed: boolean;
  exitCode: number | null;
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
        resolvePromise({ installed: false, exitCode: null });
        return;
      }
      resolvePromise({ installed: true, exitCode: 1 });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ installed: true, exitCode: code });
    });
  });
}

type RawOllamaTag = {
  name?: unknown;
  model?: unknown;
};

function parseOllamaTagsPayload(payload: unknown): ModelCatalogEntry[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Ollama /api/tags response must be a JSON object.");
  }
  const rawModels = (payload as { models?: unknown }).models;
  if (!Array.isArray(rawModels)) {
    throw new Error("Ollama /api/tags response is missing a models array.");
  }
  const seen = new Set<string>();
  const models: ModelCatalogEntry[] = [];
  for (const item of rawModels) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const tag = item as RawOllamaTag;
    const modelId = typeof tag.name === "string" && tag.name.trim()
      ? tag.name.trim()
      : typeof tag.model === "string" && tag.model.trim()
        ? tag.model.trim()
        : "";
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    models.push({
      backend: "ollama",
      modelId,
      runnable: true,
      name: modelId,
      status: "active",
      capabilities: {
        textInput: true,
        textOutput: true,
        toolcall: true
      },
      variants: [],
      reasoning: { supported: false, kind: "none", levels: [] }
    });
  }
  return models;
}

export const ollamaBackendDescriptor: BackendDescriptor = {
  backendId: "ollama",
  displayName: "Ollama",
  iconKey: "ollama",
  transport: "http",
  sessionKind: "logical-session",
  processOwnership: "attached_external",
  capabilities: {
    textInput: true,
    textOutput: true,
    toolcall: true,
    structuredOutput: true,
    sessionReuse: true,
    abort: true
  }
};

export async function executeOllamaChatRequest(args: {
  baseUrl?: string;
  modelId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  schema?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ content: string; messageId: string }> {
  const baseUrl = args.baseUrl
    ? localOllamaUrl(args.baseUrl)
    : resolveOllamaBaseUrl();
  if (!baseUrl) throw new Error("OLLAMA_LOCAL_ONLY: Ollama execution only permits a loopback service.");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Ollama request timed out after ${args.timeoutMs}ms`));
  }, Math.max(1, args.timeoutMs));
  const onExternalAbort = () => controller.abort(args.signal?.reason ?? new Error("Request aborted"));
  if (args.signal) {
    if (args.signal.aborted) {
      clearTimeout(timer);
      throw new OpencodeExecutionError("Ollama request aborted before start", { timedOut: false });
    }
    args.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: args.modelId,
        messages: args.messages,
        stream: false,
        ...(args.schema && typeof args.schema === "object" ? { format: args.schema } : {})
      }),
      signal: controller.signal
    });
    const rawBody = await response.text();
    if (!response.ok) {
      throw new OpencodeExecutionError(
        `Ollama HTTP ${response.status}: ${rawBody.slice(0, 400) || response.statusText}`,
        { stderr: rawBody, timedOut: false }
      );
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new OpencodeExecutionError("Ollama /api/chat returned non-JSON response", {
        stdout: rawBody,
        timedOut: false
      });
    }
    const message = parsed.message && typeof parsed.message === "object" && !Array.isArray(parsed.message)
      ? parsed.message as Record<string, unknown>
      : undefined;
    const content = typeof message?.content === "string"
      ? message.content
      : typeof parsed.response === "string"
        ? parsed.response
        : "";
    if (!content.trim()) {
      throw new OpencodeExecutionError("Ollama /api/chat returned empty message content", {
        stdout: rawBody,
        timedOut: false
      });
    }
    return {
      content,
      messageId: `ollama-msg-${randomUUID()}`
    };
  } catch (error) {
    if (error instanceof OpencodeExecutionError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new OpencodeExecutionError(`Ollama execution failed: ${message}`, {
      timedOut
    });
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export const ollamaBackendAdapter: BackendAdapter = {
  backendId: "ollama",
  verifiedRunnable: true,

  async discover(args): Promise<{
    status: BackendAvailabilityStatus;
    detail?: string;
    models: ModelCatalogEntry[];
  }> {
    const fixtureJson = process.env.OGSYSTEM_OLLAMA_TAGS_JSON;
    if (fixtureJson !== undefined) {
      try {
        const models = parseOllamaTagsPayload(JSON.parse(fixtureJson));
        return {
          status: models.length > 0 ? "runnable" : "unavailable",
          detail: models.length > 0 ? `Discovered ${models.length} local Ollama model(s).` : "Ollama service is running, but no local models are pulled.",
          models
        };
      } catch (error) {
        return {
          status: "installed_but_broken",
          detail: error instanceof Error ? error.message : String(error),
          models: []
        };
      }
    }

    const baseUrl = resolveOllamaBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(2500)
      });
      if (!response.ok) {
        return {
          status: "service_unavailable",
          detail: `Ollama HTTP service responded with status ${response.status}.`,
          models: []
        };
      }
      const payload = await response.json();
      const models = parseOllamaTagsPayload(payload);
      if (models.length === 0) {
        return {
          status: "unavailable",
          detail: "Ollama service is online, but no local models are installed.",
          models: []
        };
      }
      return {
        status: "runnable",
        detail: `Ollama HTTP service ready (${models.length} model${models.length === 1 ? "" : "s"}).`,
        models
      };
    } catch {
      const cliProbe = await isCommandInstalled("ollama", ["--version"], args.workdir);
      if (!cliProbe.installed) {
        return {
          status: "not_installed",
          detail: "Ollama is not installed on this machine.",
          models: []
        };
      }
      if (cliProbe.exitCode !== 0) {
        return {
          status: "installed_but_broken",
          detail: "Ollama CLI is present but failed health verification.",
          models: []
        };
      }
      return {
        status: "service_unavailable",
        detail: "Ollama CLI is installed, but the local HTTP service is not running.",
        models: []
      };
    }
  },

  async startRun(): Promise<BackendRunSession> {
    const baseUrl = resolveOllamaBaseUrl();
    const historyBySessionId = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
    const activeAbortBySessionId = new Map<string, AbortController>();

    return {
      async execute(request: BackendExecuteRequest): Promise<BackendExecuteResult> {
        const requestedReasoning = (request as BackendExecuteRequest & { reasoningEffort?: string }).reasoningEffort;
        if (requestedReasoning && requestedReasoning !== "auto") {
          throw new Error(`REASONING_UNSUPPORTED: Ollama does not expose reasoning level "${requestedReasoning}"`);
        }
        const sessionId = request.sessionId ?? `ollama-session-${request.sessionKey ?? request.roleId}`;
        const history = historyBySessionId.get(sessionId) ?? [];
        const messages = [...history, { role: "user" as const, content: request.prompt }];
        const sessionController = new AbortController();
        activeAbortBySessionId.set(sessionId, sessionController);
        const onRequestAbort = () => sessionController.abort(request.signal?.reason);
        request.signal?.addEventListener("abort", onRequestAbort, { once: true });

        const phase = request.promptCallPhase ?? "primary";
        const ordinal = 1;
        await request.onPromptCall?.({ phase, ordinal, stage: "before", prompt: request.prompt });
        let output: string | undefined;
        let outputChars = 0;
        try {
          const response = await executeOllamaChatRequest({
            baseUrl,
            modelId: request.modelId,
            messages,
            schema: request.schema,
            timeoutMs: request.timeoutMs,
            signal: sessionController.signal
          });
          output = response.content;
          outputChars = output.length;
          historyBySessionId.set(sessionId, [
            ...messages,
            { role: "assistant", content: response.content }
          ]);
          return {
            exitCode: 0,
            stdout: response.content,
            stderr: "",
            args: ["/api/chat"],
            sessionId,
            messageId: response.messageId,
            modelId: request.modelId,
            backend: "ollama",
            toolRef: `model.ollama/${request.modelId}`,
            command: "ollama-http"
          };
        } finally {
          request.signal?.removeEventListener("abort", onRequestAbort);
          activeAbortBySessionId.delete(sessionId);
          await request.onPromptCall?.({
            phase,
            ordinal,
            stage: "after",
            prompt: request.prompt,
            outputChars,
            ...(output !== undefined ? { output } : {})
          });
        }
      },

      async abort(args: { sessionId: string; directory: string }): Promise<void> {
        activeAbortBySessionId.get(args.sessionId)?.abort(new Error("Session aborted"));
        activeAbortBySessionId.delete(args.sessionId);
      },

      getServerMetadata() {
        return { url: baseUrl };
      },

      async close(): Promise<void> {
        for (const controller of activeAbortBySessionId.values()) {
          controller.abort(new Error("Backend session closed"));
        }
        activeAbortBySessionId.clear();
        historyBySessionId.clear();
      }
    };
  },

  async probe(args: { modelId: string; workdir: string; timeoutMs: number }): Promise<void> {
    await executeOllamaChatRequest({
      modelId: args.modelId,
      messages: [{ role: "user", content: 'Return exactly this JSON: {"ok":true}' }],
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false
      },
      timeoutMs: args.timeoutMs
    });
  }
};
