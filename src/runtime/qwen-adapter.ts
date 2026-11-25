import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultAcpModel } from "./acp-adapter-support.js";
import { createOpenAIResponsesAdapter } from "./openai-responses-adapter.js";
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

const shared = createOpenAIResponsesAdapter("qwen");
export const qwenBackendDescriptor = shared.descriptor;
export const qwenBackendAdapter = shared.adapter;
