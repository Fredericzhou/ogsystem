import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveExecutable } from "./cli-adapter-support.js";
import { AcpClient } from "./acp-client.js";
import { createAcpRunSession, defaultAcpModel } from "./acp-adapter-support.js";
import type { BackendAdapter, BackendDescriptor } from "./model-backend-registry.js";
import type { ModelCatalogEntry } from "./types.js";

const definition = { backendId: "qwen" as const, command: "qwen", args: ["--acp"], protocolVersion: 1, modelEnv: "OGS_QWEN_MODEL" };

export async function discoverConfiguredQwenModels(): Promise<ModelCatalogEntry[]> {
  const configPath = process.env.QWEN_SETTINGS_PATH
    || join(process.env.QWEN_HOME || join(homedir(), ".qwen"), "settings.json");
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    const providers = parsed.modelProviders && typeof parsed.modelProviders === "object" && !Array.isArray(parsed.modelProviders)
      ? parsed.modelProviders as Record<string, unknown>
      : {};
    const models: ModelCatalogEntry[] = [];
    for (const entries of Object.values(providers)) {
      if (!Array.isArray(entries)) continue;
      for (const item of entries) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const modelId = typeof record.id === "string" ? record.id.trim() : "";
        if (!modelId || models.some((model) => model.modelId === modelId)) continue;
        models.push({ backend: "qwen", modelId, runnable: false, name: typeof record.name === "string" ? record.name : modelId, status: "unverified", capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [] });
      }
    }
    const configuredDefault = parsed.model && typeof parsed.model === "object" && !Array.isArray(parsed.model)
      ? (parsed.model as Record<string, unknown>).name
      : undefined;
    if (typeof configuredDefault === "string" && configuredDefault.trim() && !models.some((model) => model.modelId === configuredDefault.trim())) {
      models.push({ backend: "qwen", modelId: configuredDefault.trim(), runnable: false, name: configuredDefault.trim(), status: "unverified", capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [] });
    }
    const envModel = defaultAcpModel(definition);
    if (envModel !== "default" && !models.some((model) => model.modelId === envModel)) {
      models.push({ backend: "qwen", modelId: envModel, runnable: false, name: envModel, status: "unverified", capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [] });
    }
    return models;
  } catch {
    const envModel = defaultAcpModel(definition);
    return envModel === "default" ? [] : [{ backend: "qwen", modelId: envModel, runnable: false, name: envModel, status: "unverified", capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [] }];
  }
}

export const qwenBackendDescriptor: BackendDescriptor = {
  backendId: "qwen", displayName: "Qwen Code", iconKey: "qwen", transport: "acp-stdio", sessionKind: "process-session", processOwnership: "spawned_by_ogs",
  capabilities: { textInput: true, textOutput: true, toolcall: true, structuredOutput: true, sessionReuse: true, abort: true }
};

export const qwenBackendAdapter: BackendAdapter = {
  backendId: "qwen", verifiedRunnable: true,
  async discover({ workdir }) {
    const configuredModels = await discoverConfiguredQwenModels();
    const command = await resolveExecutable("qwen", [join(process.env.QWEN_HOME || join(homedir(), ".qwen"), "bin", "qwen")]);
    if (!command) return { status: "not_installed", detail: "Qwen Code CLI is not installed on this machine.", models: configuredModels.map((model) => ({ ...model, status: "unavailable" })) };
    try {
      const client = await AcpClient.start({ ...definition, command, cwd: workdir });
      try {
        const session = await client.createSessionInfo(workdir, 30_000);
        const sessionModel = session.modelId ? [{ backend: "qwen", modelId: session.modelId, runnable: false, name: session.modelId, status: "unverified" as const, capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [], ...(session.reasoning ? { reasoning: session.reasoning } : {}) }] : [];
        const models = [...configuredModels.map((model) => ({ ...model, reasoning: session.reasoning })), ...sessionModel.filter((model) => !configuredModels.some((configured) => configured.modelId === model.modelId))];
        return { status: "runnable", detail: `Qwen ACP ready; ${models.length} configured model${models.length === 1 ? "" : "s"} found.`, models };
      } finally { await client.close(); }
    } catch (error) { return { status: "installed_but_broken", detail: error instanceof Error ? error.message : String(error), models: [] }; }
  },
  async startRun(args) {
    const command = await resolveExecutable("qwen", [join(process.env.QWEN_HOME || join(homedir(), ".qwen"), "bin", "qwen")]);
    if (!command) throw new Error("Qwen Code CLI is not installed.");
    return createAcpRunSession({ ...definition, command }, args);
  },
  async probe({ modelId, workdir, timeoutMs }) {
    const command = await resolveExecutable("qwen", [join(process.env.QWEN_HOME || join(homedir(), ".qwen"), "bin", "qwen")]);
    if (!command) throw new Error("Qwen Code CLI is not installed.");
    const client = await AcpClient.start({ ...definition, command, cwd: workdir, timeoutMs });
    try {
      const session = await client.createSessionInfo(workdir, timeoutMs);
      if (session.modelId !== modelId) await client.setModel(session.sessionId, modelId, timeoutMs);
      await client.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: 'Return exactly {"ok":true}' }] }, timeoutMs);
    } finally { await client.close(); }
  }
};
