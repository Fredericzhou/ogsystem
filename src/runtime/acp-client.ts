import { spawn } from "node:child_process";
import { RpcStdioClient, type JsonRpcMessage } from "./rpc-stdio-client.js";
import type { ReasoningCapability, ReasoningEffort, ReasoningEffortLevel } from "./types.js";

export type AcpClientOptions = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  protocolVersion?: number;
};

export type AcpSessionInfo = {
  sessionId: string;
  modelId?: string;
  reasoning?: ReasoningCapability;
};

function normalizeSessionModelId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const model = value.trim().split("/").pop()?.replace(/\([^)]*\)$/, "").trim();
  return model || undefined;
}

function parseReasoningOption(option: Record<string, unknown>): ReasoningCapability | undefined {
  const id = typeof option.id === "string" ? option.id.toLowerCase() : "";
  if (!id.includes("reason") && !id.includes("think")) return undefined;
  const rawOptions = Array.isArray(option.options) ? option.options : Array.isArray(option.values) ? option.values : [];
  const levels = rawOptions.map((value) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && !Array.isArray(value)) return String((value as Record<string, unknown>).value ?? (value as Record<string, unknown>).id ?? "");
    return "";
  }).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const supportedEffort = levels.filter((level): level is Exclude<ReasoningEffort, "auto" | "on"> => ["off", "low", "medium", "high", "xhigh", "max"].includes(level));
  const supportedToggle = levels.filter((level): level is "off" | "on" => level === "off" || level === "on");
  const defaultValue = typeof option.currentValue === "string" ? option.currentValue.trim().toLowerCase() : undefined;
  // `off` is valid in both shapes; the presence of `on` is the discriminator.
  if (supportedToggle.includes("on")) return { supported: true, kind: "toggle", levels: [...new Set(supportedToggle)], ...(defaultValue === "off" || defaultValue === "on" ? { default: defaultValue } : {}) };
  if (supportedEffort.length) return { supported: true, kind: "effort", levels: [...new Set(supportedEffort)], ...(defaultValue && supportedEffort.includes(defaultValue as never) ? { default: defaultValue as Exclude<ReasoningEffort, "auto" | "on"> } : {}) };
  return { supported: false, kind: "none", levels: [] };
}

export class AcpClient {
  readonly rpc: RpcStdioClient;
  readonly agentInfo: Record<string, unknown>;
  private readonly subscriptions = new Set<(message: JsonRpcMessage) => void>();
  private readonly reasoningConfigIdBySession = new Map<string, string>();
  private readonly modelConfigIdBySession = new Map<string, string>();

  private constructor(rpc: RpcStdioClient, agentInfo: Record<string, unknown>) {
    this.rpc = rpc;
    this.agentInfo = agentInfo;
    this.rpc.onNotification((message) => {
      for (const listener of this.subscriptions) listener(message);
    });
  }

  static async start(options: AcpClientOptions & { timeoutMs?: number }): Promise<AcpClient> {
    const rpc = RpcStdioClient.spawn(options.command, options.args, { cwd: options.cwd, env: options.env });
    try {
      const result = await rpc.request("initialize", {
        protocolVersion: options.protocolVersion ?? 1,
        clientInfo: { name: "ogs", title: "OGSystem", version: "1.0.0" },
        clientCapabilities: {}
      }, options.timeoutMs ?? 15_000) as Record<string, unknown>;
      const agentInfo = result.agentInfo && typeof result.agentInfo === "object" && !Array.isArray(result.agentInfo)
        ? result.agentInfo as Record<string, unknown>
        : {};
      return new AcpClient(rpc, agentInfo);
    } catch (error) {
      await rpc.close();
      throw error;
    }
  }

  onNotification(listener: (message: JsonRpcMessage) => void): () => void {
    this.subscriptions.add(listener);
    return () => this.subscriptions.delete(listener);
  }

  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    return this.rpc.request(method, params, timeoutMs);
  }

  respond(id: string | number, result?: unknown, error?: unknown): void {
    this.rpc.respond(id, result, error);
  }

  async createSession(cwd: string, timeoutMs = 20_000): Promise<string> {
    const session = await this.createSessionInfo(cwd, timeoutMs);
    return session.sessionId;
  }

  async createSessionInfo(cwd: string, timeoutMs = 20_000): Promise<AcpSessionInfo> {
    const result = await this.request("session/new", { cwd, mcpServers: [] }, timeoutMs) as Record<string, unknown>;
    const id = typeof result.sessionId === "string" ? result.sessionId : "";
    if (!id) throw new Error("ACP session/new did not return sessionId");
    const models = result.models && typeof result.models === "object" && !Array.isArray(result.models)
      ? result.models as Record<string, unknown>
      : undefined;
    const configOptions = Array.isArray(result.configOptions) ? result.configOptions : [];
    const modelOption = configOptions
      ? configOptions.find((option) => option && typeof option === "object" && !Array.isArray(option)
        && (option as Record<string, unknown>).id === "model") as Record<string, unknown> | undefined
      : undefined;
    const reasoning = configOptions
      .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === "object" && !Array.isArray(option)))
      .map((option) => ({ option, capability: parseReasoningOption(option) }))
      .find((value): value is { option: Record<string, unknown>; capability: ReasoningCapability } => value.capability !== undefined);
    const modelId = normalizeSessionModelId(models?.currentModelId)
      ?? normalizeSessionModelId(modelOption?.currentValue);
    if (modelOption?.id) this.modelConfigIdBySession.set(id, String(modelOption.id));
    if (reasoning) this.reasoningConfigIdBySession.set(id, String(reasoning.option.id));
    return { sessionId: id, ...(modelId ? { modelId } : {}), ...(reasoning ? { reasoning: reasoning.capability } : {}) };
  }

  async setReasoning(sessionId: string, requested: ReasoningEffort, capability: ReasoningCapability, timeoutMs = 20_000): Promise<ReasoningEffortLevel | undefined> {
    if (requested === "auto") return capability.default;
    if (!capability.supported || !capability.levels.includes(requested as never)) {
      throw new Error(`REASONING_UNSUPPORTED: ACP does not support reasoning level "${requested}"`);
    }
    const configId = this.reasoningConfigIdBySession.get(sessionId) ?? (capability.kind === "toggle" ? "thinking" : "reasoning_effort");
    try {
      await this.request("session/set_config_option", { sessionId, configId, value: requested }, timeoutMs);
    } catch (error) {
      throw new Error(`REASONING_CONFIG_FAILED: ACP rejected reasoning level "${requested}": ${error instanceof Error ? error.message : String(error)}`);
    }
    return requested;
  }

  async setModel(sessionId: string, modelId: string, timeoutMs = 20_000): Promise<void> {
    const configId = this.modelConfigIdBySession.get(sessionId);
    if (!configId || !modelId || modelId === "default") return;
    try {
      await this.request("session/set_config_option", { sessionId, configId, value: modelId }, timeoutMs);
    } catch (error) {
      throw new Error(`MODEL_CONFIG_FAILED: ACP rejected model "${modelId}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadSession(sessionId: string, cwd: string, timeoutMs = 20_000): Promise<AcpSessionInfo> {
    const result = await this.request("session/load", { sessionId, cwd, mcpServers: [] }, timeoutMs) as Record<string, unknown>;
    const loadedSessionId = typeof result.sessionId === "string" ? result.sessionId : sessionId;
    const configOptions = Array.isArray(result.configOptions) ? result.configOptions : [];
    const reasoning = configOptions
      .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === "object" && !Array.isArray(option)))
      .map((option) => ({ option, capability: parseReasoningOption(option) }))
      .find((value): value is { option: Record<string, unknown>; capability: ReasoningCapability } => value.capability !== undefined);
    const modelOption = configOptions.find((option) => option && typeof option === "object" && !Array.isArray(option)
      && (option as Record<string, unknown>).id === "model") as Record<string, unknown> | undefined;
    if (modelOption?.id) this.modelConfigIdBySession.set(loadedSessionId, String(modelOption.id));
    if (reasoning) this.reasoningConfigIdBySession.set(loadedSessionId, String(reasoning.option.id));
    const models = result.models && typeof result.models === "object" && !Array.isArray(result.models)
      ? result.models as Record<string, unknown>
      : undefined;
    const modelId = normalizeSessionModelId(models?.currentModelId);
    return { sessionId: loadedSessionId, ...(modelId ? { modelId } : {}), ...(reasoning ? { reasoning: reasoning.capability } : {}) };
  }

  async close(): Promise<void> {
    await this.rpc.close();
    this.reasoningConfigIdBySession.clear();
    this.modelConfigIdBySession.clear();
  }
}

export function acpProcess(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
}
