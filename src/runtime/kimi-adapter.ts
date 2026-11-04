import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveExecutable } from "./cli-adapter-support.js";
import { AcpClient } from "./acp-client.js";
import { createAcpRunSession, defaultAcpModel } from "./acp-adapter-support.js";
import type { BackendAdapter, BackendDescriptor } from "./model-backend-registry.js";
import type { ModelCatalogEntry } from "./types.js";

const definition = { backendId: "kimi" as const, command: "kimi", args: ["acp"], protocolVersion: 0, modelEnv: "OGS_KIMI_MODEL" };

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
    const command = await resolveExecutable("kimi");
    if (!command) return { status: "not_installed", detail: "Kimi Code CLI is not installed on this machine.", models: [] };
    const apiKeyEnv = await configuredApiKeyEnv();
    if (apiKeyEnv && !process.env[apiKeyEnv]?.trim()) {
      return {
        status: "installed_but_broken",
        detail: `Kimi Code CLI is installed and configured for an API provider, but ${apiKeyEnv} is not set in the OGS process environment.`,
        models: []
      };
    }
    try {
      const client = await AcpClient.start({ ...definition, command, cwd: workdir });
      try {
        const configuredModel = defaultAcpModel(definition);
        const session = await client.createSessionInfo(workdir, 30_000);
        const modelId = configuredModel !== "default" ? configuredModel : (session.modelId ?? configuredModel);
        const models: ModelCatalogEntry[] = [{ backend: "kimi", modelId, runnable: true, name: modelId, status: "active", capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [], ...(session.reasoning ? { reasoning: session.reasoning } : {}) }];
        return { status: "runnable", detail: `Kimi ACP ready (session ${session.sessionId}).`, models };
      } finally { await client.close(); }
    } catch (error) { return { status: "installed_but_broken", detail: apiProviderError(error, apiKeyEnv), models: [] }; }
  },
  async startRun(args) {
    const command = await resolveExecutable("kimi");
    if (!command) throw new Error("Kimi Code CLI is not installed.");
    return createAcpRunSession({ ...definition, command }, args);
  },
  async probe({ modelId, workdir, timeoutMs }) {
    const command = await resolveExecutable("kimi");
    if (!command) throw new Error("Kimi Code CLI is not installed.");
    const client = await AcpClient.start({ ...definition, command, cwd: workdir, timeoutMs });
    try {
      const session = await client.createSessionInfo(workdir, timeoutMs);
      if (session.modelId !== modelId) await client.setModel(session.sessionId, modelId, timeoutMs);
      await client.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: 'Return exactly {"ok":true}' }] }, timeoutMs);
    } finally { await client.close(); }
  }
};
