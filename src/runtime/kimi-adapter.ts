import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveExecutable } from "./cli-adapter-support.js";
import { AcpClient } from "./acp-client.js";
import { createAcpRunSession } from "./acp-adapter-support.js";
import type { BackendAdapter, BackendDescriptor } from "./model-backend-registry.js";
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
    return [];
  }
}

async function configuredApiKeyEnv(): Promise<string | undefined> {
  const configPath = process.env.KIMI_CONFIG_PATH
    || join(process.env.KIMI_HOME || join(homedir(), ".kimi-code"), "config.toml");
  try {
    const config = await readFile(configPath, "utf8");
    return config.match(/^\s*api_key_env\s*=\s*["']([^"']+)["']\s*$/m)?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function apiProviderError(error: unknown, apiKeyEnv?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!/authentication required|api[ _-]?key|unauthori[sz]ed|forbidden/i.test(message)) return message;
  const suffix = apiKeyEnv
    ? ` Set ${apiKeyEnv} in the environment that starts OGS; do not use 'kimi login' for this provider.`
    : " Check the configured API provider credentials in the environment that starts OGS.";
  return `Kimi Code ACP is using its configured API provider, but the provider rejected or did not receive its API credentials.${suffix} ${message}`;
}

export const kimiBackendDescriptor: BackendDescriptor = {
  backendId: "kimi", displayName: "Kimi Code", iconKey: "kimi", transport: "acp-stdio", sessionKind: "process-session", processOwnership: "spawned_by_ogs",
  capabilities: { textInput: true, textOutput: true, toolcall: true, structuredOutput: true, sessionReuse: true, abort: true }
};

export const kimiBackendAdapter: BackendAdapter = {
  backendId: "kimi", verifiedRunnable: true,
  async discover({ workdir }) {
    const configuredModels = await discoverConfiguredKimiModels();
    const command = await resolveExecutable("kimi", [join(process.env.KIMI_HOME || join(homedir(), ".kimi-code"), "bin", "kimi")]);
    if (!command) return { status: "not_installed", detail: "Kimi Code CLI is not installed on this machine.", models: configuredModels.map((model) => ({ ...model, status: "unavailable" })) };
    const apiKeyEnv = await configuredApiKeyEnv();
    if (apiKeyEnv && !process.env[apiKeyEnv]?.trim()) {
      return {
        status: "installed_but_broken",
        detail: `Kimi Code CLI is installed and configured for an API provider, but ${apiKeyEnv} is not set in the OGS process environment.`,
        models: configuredModels
      };
    }
    try {
      const client = await AcpClient.start({ ...definition, command, cwd: workdir });
      try {
        const session = await client.createSessionInfo(workdir, 30_000);
        const sessionModel = session.modelId ? [{ backend: "kimi", modelId: session.modelId, runnable: false, name: session.modelId, status: "unverified" as const, capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [], ...(session.reasoning ? { reasoning: session.reasoning } : {}) }] : [];
        const models = [...configuredModels.map((model) => ({ ...model, reasoning: session.reasoning })), ...sessionModel.filter((model) => !configuredModels.some((configured) => configured.modelId === model.modelId))];
        return { status: "runnable", detail: `Kimi ACP ready; ${models.length} configured model${models.length === 1 ? "" : "s"} found.`, models };
      } finally { await client.close(); }
    } catch (error) { return { status: "installed_but_broken", detail: apiProviderError(error, apiKeyEnv), models: [] }; }
  },
  async startRun(args) {
    const command = await resolveExecutable("kimi", [join(process.env.KIMI_HOME || join(homedir(), ".kimi-code"), "bin", "kimi")]);
    if (!command) throw new Error("Kimi Code CLI is not installed.");
    return createAcpRunSession({ ...definition, command }, args);
  },
  async probe({ modelId, workdir, timeoutMs }) {
    const command = await resolveExecutable("kimi", [join(process.env.KIMI_HOME || join(homedir(), ".kimi-code"), "bin", "kimi")]);
    if (!command) throw new Error("Kimi Code CLI is not installed.");
    const client = await AcpClient.start({ ...definition, command, cwd: workdir, timeoutMs });
    try {
      const session = await client.createSessionInfo(workdir, timeoutMs);
      if (session.modelId !== modelId) await client.setModel(session.sessionId, modelId, timeoutMs);
      await client.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: 'Return exactly {"ok":true}' }] }, timeoutMs);
    } finally { await client.close(); }
  }
};
