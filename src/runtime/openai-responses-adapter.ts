import { readFileSync as readFileSyncNative } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { OpencodeExecutionError } from "./opencode-executor.js";
import { boundedText, schemaInstruction } from "./cli-adapter-support.js";
import type {
  BackendAdapter,
  BackendDescriptor,
  BackendExecuteRequest,
  BackendRunSession
} from "./model-backend-registry.js";
import type { ModelCatalogEntry } from "./types.js";

export const SHARED_API_MODEL = "gpt-6-luna";

type ResponsesConfig = {
  baseUrl: string;
  apiKey?: string;
};

function configuredValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readCodexConfigValue(key: string): string | undefined {
  const configPath = configuredValue("CODEX_CONFIG_PATH")
    ?? join(configuredValue("CODEX_HOME") ?? join(homedir(), ".codex"), "config.toml");
  try {
    const source = readFileSyncNative(configPath, "utf8");
    const providerSection = source.match(/\[model_providers\.custom\]([\s\S]*?)(?=\n\s*\[|$)/)?.[1] ?? "";
    return providerSection.match(new RegExp(`^\\s*${key}\\s*=\\s*[\"']([^\"']+)[\"']\\s*$`, "m"))?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function readCodexAuthKey(): string | undefined {
  const authPath = configuredValue("CODEX_AUTH_PATH")
    ?? join(configuredValue("CODEX_HOME") ?? join(homedir(), ".codex"), "auth.json");
  try {
    const parsed = JSON.parse(readFileSyncNative(authPath, "utf8")) as Record<string, unknown>;
    return typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.trim()
      ? parsed.OPENAI_API_KEY.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSharedResponsesConfig(): ResponsesConfig {
  const configuredBaseUrl = configuredValue("OGS_OPENAI_BASE_URL")
    ?? configuredValue("OPENAI_BASE_URL")
    ?? readCodexConfigValue("base_url");
  const normalizedBaseUrl = (configuredBaseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  return {
    // Codex provider base_url values already carry the provider's API root.
    // Only the built-in public default includes /v1 implicitly.
    baseUrl: normalizedBaseUrl,
    apiKey: configuredValue("OGS_OPENAI_API_KEY")
      ?? configuredValue("OPENAI_API_KEY")
      ?? readCodexAuthKey()
  };
}

function modelEntry(backend: string): ModelCatalogEntry {
  return {
    backend,
    modelId: SHARED_API_MODEL,
    runnable: true,
    name: "GPT-6 Luna",
    status: "active",
    capabilities: { textInput: true, textOutput: true, toolcall: false },
    variants: [],
    reasoning: { supported: true, kind: "effort", levels: ["low", "medium", "high", "xhigh", "max"] }
  };
}

function responseText(payload: unknown): string {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  if (typeof record.output_text === "string") return record.output_text;
  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("");
}

function requestModel(request: BackendExecuteRequest): string {
  // Qwen and Kimi are intentionally pinned to the same Codex-compatible
  // gateway model so catalog aliases cannot silently select another model.
  void request;
  return SHARED_API_MODEL;
}

async function executeResponsesRequest(args: {
  config: ResponsesConfig;
  request: BackendExecuteRequest;
  controller?: AbortController;
}): Promise<{ content: string; responseId?: string }> {
  if (!args.config.apiKey) throw new Error("OPENAI_API_KEY is not configured for the shared Responses API.");
  const controller = args.controller ?? new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Responses API request timed out after ${args.request.timeoutMs}ms`));
  }, Math.max(1, args.request.timeoutMs));
  const onAbort = () => controller.abort(args.request.signal?.reason ?? new Error("Request aborted"));
  if (args.request.signal?.aborted) onAbort();
  else args.request.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const body: Record<string, unknown> = {
      model: requestModel(args.request),
      input: `${args.request.prompt}${schemaInstruction(args.request.schema)}`,
      max_output_tokens: Math.max(1, Math.ceil(args.request.maxOutputBytes / 4)),
      store: false
    };
    if (args.request.reasoningEffort && args.request.reasoningEffort !== "auto") {
      body.reasoning = { effort: args.request.reasoningEffort };
    }
    const response = await fetch(`${args.config.baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${args.config.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new OpencodeExecutionError(`Responses API HTTP ${response.status}: ${raw.slice(0, 800) || response.statusText}`, { stderr: raw, timedOut: false });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new OpencodeExecutionError("Responses API returned non-JSON output", { stdout: raw, timedOut: false }); }
    const content = boundedText(responseText(parsed), args.request.maxOutputBytes);
    if (!content.trim()) throw new OpencodeExecutionError("Responses API returned empty output", { stdout: raw, timedOut: false });
    const responseId = parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>).id === "string"
      ? (parsed as Record<string, unknown>).id as string
      : undefined;
    return { content, responseId };
  } catch (error) {
    if (error instanceof OpencodeExecutionError) throw error;
    throw new OpencodeExecutionError(`Responses API execution failed: ${error instanceof Error ? error.message : String(error)}`, { timedOut });
  } finally {
    clearTimeout(timer);
    args.request.signal?.removeEventListener("abort", onAbort);
  }
}

export function createOpenAIResponsesAdapter(backendId: "qwen" | "kimi"): {
  descriptor: BackendDescriptor;
  adapter: BackendAdapter;
} {
  const displayName = backendId === "qwen" ? "Qwen Code" : "Kimi Code";
  const descriptor: BackendDescriptor = {
    backendId,
    displayName,
    iconKey: backendId,
    transport: "http",
    sessionKind: "logical-session",
    processOwnership: "attached_external",
    capabilities: {
      textInput: true,
      textOutput: true,
      toolcall: false,
      structuredOutput: true,
      sessionReuse: true,
      abort: true
    }
  };
  const adapter: BackendAdapter = {
    backendId,
    verifiedRunnable: true,
    adapterVersion: "openai-responses-shared-gpt-6-luna-1",
    nativeToolsConfigurable: false,
    getResourceCapabilities() { return { filesystem: false, process: false, network: false }; },
    async discover() {
      const config = resolveSharedResponsesConfig();
      if (!config.apiKey) return { status: "installed_but_broken", detail: "Shared Responses API credential is unavailable.", models: [] };
      try {
        const response = await fetch(`${config.baseUrl}/models`, { headers: { authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(10_000) });
        if (response.status === 404 || response.status === 405) {
          return { status: "runnable", detail: `Shared Responses API does not expose model listing; using pinned ${SHARED_API_MODEL}.`, models: [modelEntry(backendId)] };
        }
        if (!response.ok) return { status: "service_unavailable", detail: `Shared Responses API model discovery returned HTTP ${response.status}.`, models: [] };
        const payload = await response.json() as Record<string, unknown>;
        const models = Array.isArray(payload.data) && payload.data.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === SHARED_API_MODEL)
          ? [modelEntry(backendId)]
          : [];
        return models.length ? { status: "runnable", detail: `Shared Responses API ready for ${SHARED_API_MODEL}.`, models } : { status: "unavailable", detail: `Shared Responses API does not expose ${SHARED_API_MODEL}.`, models: [] };
      } catch (error) {
        return { status: "service_unavailable", detail: error instanceof Error ? error.message : String(error), models: [] };
      }
    },
    async startRun(args): Promise<BackendRunSession> {
      const config = resolveSharedResponsesConfig();
      const activeControllers = new Map<string, AbortController>();
      return {
        async execute(request) {
          if (request.effectiveTools?.length) throw new Error(`${backendId} shared Responses API is text-only and cannot execute workspace tools.`);
          const key = request.sessionKey ?? request.roleId;
          const controller = new AbortController();
          activeControllers.set(key, controller);
          await request.onPromptCall?.({ phase: request.promptCallPhase ?? "primary", ordinal: 1, stage: "before", prompt: request.prompt });
          try {
            const result = await executeResponsesRequest({ config, request, controller });
            await request.onPromptCall?.({ phase: request.promptCallPhase ?? "primary", ordinal: 1, stage: "after", prompt: request.prompt, output: result.content, outputChars: result.content.length });
            return {
              exitCode: 0,
              stdout: result.content,
              stderr: "",
              args: ["/v1/responses", "--model", SHARED_API_MODEL],
              sessionId: key,
              messageId: result.responseId ?? `responses-${randomUUID()}`,
              modelId: SHARED_API_MODEL,
              backend: backendId,
              toolRef: `model.${backendId}/${SHARED_API_MODEL}`,
              command: "HTTPS POST /v1/responses",
              requestedReasoningEffort: request.reasoningEffort,
              effectiveReasoningEffort: request.effectiveReasoningEffort,
              reasoningKind: "effort",
              reasoningSupported: true
            };
          } catch (error) {
            await request.onPromptCall?.({ phase: request.promptCallPhase ?? "primary", ordinal: 1, stage: "after", prompt: request.prompt, outputChars: 0 });
            throw error;
          } finally {
            if (activeControllers.get(key) === controller) activeControllers.delete(key);
          }
        },
        async abort({ sessionId }) {
          activeControllers.get(sessionId)?.abort(new Error(`${backendId} Responses API session aborted`));
        },
        async close() {
          for (const controller of activeControllers.values()) controller.abort(new Error(`${backendId} Responses API run closed`));
          activeControllers.clear();
        }
      };
    },
    async probe() {
      await executeResponsesRequest({
        config: resolveSharedResponsesConfig(),
        request: {
          roleId: "platform-model-probe",
          prompt: 'Return exactly {"ok":true}',
          schema: { type: "object" },
          modelId: SHARED_API_MODEL,
          workdir: resolve("."),
          directory: resolve("."),
          timeoutMs: 30_000,
          maxOutputBytes: 4096
        }
      });
    }
  };
  return { descriptor, adapter };
}
