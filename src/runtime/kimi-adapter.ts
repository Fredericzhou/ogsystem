import { resolveExecutable } from "./cli-adapter-support.js";
import { AcpClient } from "./acp-client.js";
import { createAcpRunSession, defaultAcpModel } from "./acp-adapter-support.js";
import type { BackendAdapter, BackendDescriptor } from "./model-backend-registry.js";
import type { ModelCatalogEntry } from "./types.js";

const definition = { backendId: "kimi" as const, command: "kimi", args: ["acp"], protocolVersion: 0, modelEnv: "OGS_KIMI_MODEL" };

export const kimiBackendDescriptor: BackendDescriptor = {
  backendId: "kimi", displayName: "Kimi Code", iconKey: "kimi", transport: "acp-stdio", sessionKind: "process-session", processOwnership: "spawned_by_ogs",
  capabilities: { textInput: true, textOutput: true, toolcall: true, structuredOutput: true, sessionReuse: true, abort: true }
};

export const kimiBackendAdapter: BackendAdapter = {
  backendId: "kimi", verifiedRunnable: true,
  async discover({ workdir }) {
    const command = await resolveExecutable("kimi");
    if (!command) return { status: "not_installed", detail: "Kimi Code CLI is not installed on this machine.", models: [] };
    try {
      const client = await AcpClient.start({ ...definition, command, cwd: workdir });
      try {
        const configuredModel = defaultAcpModel(definition);
        const session = await client.createSessionInfo(workdir, 30_000);
        const modelId = configuredModel !== "default" ? configuredModel : (session.modelId ?? configuredModel);
        const models: ModelCatalogEntry[] = [{ backend: "kimi", modelId, runnable: true, name: modelId, status: "active", capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [], ...(session.reasoning ? { reasoning: session.reasoning } : {}) }];
        return { status: "runnable", detail: `Kimi ACP ready (session ${session.sessionId}).`, models };
      } finally { await client.close(); }
    } catch (error) { return { status: "installed_but_broken", detail: error instanceof Error ? error.message : String(error), models: [] }; }
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
