import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultAcpModel } from "./acp-adapter-support.js";
import { createOpenAIResponsesAdapter } from "./openai-responses-adapter.js";
import type { ModelCatalogEntry } from "./types.js";

const definition = { backendId: "kimi" as const, command: "kimi", args: ["acp"], protocolVersion: 0, modelEnv: "OGS_KIMI_MODEL" };

export async function discoverConfiguredKimiModels(): Promise<ModelCatalogEntry[]> {
  const configPath = process.env.KIMI_CONFIG_PATH
    || join(process.env.KIMI_HOME || join(homedir(), ".kimi-code"), "config.toml");
  try {
    const config = await readFile(configPath, "utf8");
    const ids = new Set<string>();
    const defaultModel = config.match(/^\s*default_model\s*=\s*["']([^"']+)["']\s*$/m)?.[1]?.trim();
    if (defaultModel) ids.add(defaultModel);
    const tablePattern = /^\s*\[models\.(["'])([^"']+)\1\]\s*$/gm;
    for (const match of config.matchAll(tablePattern)) if (match[2]?.trim()) ids.add(match[2].trim());
    const envModel = defaultAcpModel(definition);
    if (envModel !== "default") ids.add(envModel);
    return [...ids].map((modelId) => ({
      backend: "kimi",
      modelId,
      runnable: false,
      name: modelId,
      status: "unverified",
      capabilities: { textInput: true, textOutput: true, toolcall: true },
      variants: []
    }));
  } catch {
    const envModel = defaultAcpModel(definition);
    return envModel === "default" ? [] : [{
      backend: "kimi",
      modelId: envModel,
      runnable: false,
      name: envModel,
      status: "unverified",
      capabilities: { textInput: true, textOutput: true, toolcall: true },
      variants: []
    }];
  }
}

const shared = createOpenAIResponsesAdapter("kimi");
export const kimiBackendDescriptor = shared.descriptor;
export const kimiBackendAdapter = shared.adapter;
