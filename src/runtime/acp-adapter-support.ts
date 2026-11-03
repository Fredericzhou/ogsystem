import { createAgentEventEmitter } from "./agent-client-types.js";
import { AcpClient } from "./acp-client.js";
import { boundedText, modelFromEnv, schemaInstruction } from "./cli-adapter-support.js";
import { OpencodeExecutionError } from "./opencode-executor.js";
import type { BackendExecuteRequest, BackendRunSession } from "./model-backend-registry.js";
import type { ReasoningCapability, ReasoningEffort, RunContext } from "./types.js";

export type AcpAdapterDefinition = {
  backendId: "qwen" | "kimi";
  command: string;
  args: string[];
  protocolVersion: number;
  modelEnv: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textFromContent(value: unknown): string {
  const record = asRecord(value);
  return typeof record?.text === "string" ? record.text : "";
}

export function createAcpRunSession(definition: AcpAdapterDefinition, args: { targetDir: string; runContext: RunContext }): BackendRunSession {
  let clientPromise: Promise<AcpClient> | undefined;
  const sessionByKey = new Map<string, string>();
  const capabilityByKey = new Map<string, ReasoningCapability>();
  const activeSessionIds = new Set<string>();
  const getClient = () => clientPromise ??= AcpClient.start({ command: definition.command, args: definition.args, cwd: args.targetDir, protocolVersion: definition.protocolVersion });
  return {
    async execute(request: BackendExecuteRequest) {
      const phase = request.promptCallPhase ?? "primary";
      await request.onPromptCall?.({ phase, ordinal: 1, stage: "before", prompt: request.prompt });
      const client = await getClient();
      const key = request.sessionKey ?? request.roleId;
      let recreatedFrom: string | undefined;
      let sessionId = request.sessionId ?? sessionByKey.get(key);
      let sessionModelId: string | undefined;
      if (!sessionId) {
        const session = await client.createSessionInfo(request.directory, request.timeoutMs);
        sessionId = session.sessionId;
        sessionModelId = session.modelId;
        if (session.reasoning) capabilityByKey.set(key, session.reasoning);
        sessionByKey.set(key, sessionId);
      } else if (!sessionByKey.has(key)) {
        try {
          const loaded = await client.loadSession(sessionId, request.directory, request.timeoutMs);
          sessionId = loaded.sessionId;
          sessionModelId = loaded.modelId;
          if (loaded.reasoning) capabilityByKey.set(key, loaded.reasoning);
          sessionByKey.set(key, sessionId);
        } catch {
          const previousSessionId = sessionId;
          const session = await client.createSessionInfo(request.directory, request.timeoutMs);
          sessionId = session.sessionId;
          sessionModelId = session.modelId;
          if (session.reasoning) capabilityByKey.set(key, session.reasoning);
          sessionByKey.set(key, sessionId);
          recreatedFrom = previousSessionId;
        }
      }
      if (request.modelId && request.modelId !== "default" && sessionModelId !== request.modelId) {
        await client.setModel(sessionId, request.modelId, request.timeoutMs);
      }
      const requestedReasoning = (request as BackendExecuteRequestWithReasoning).reasoningEffort;
      const frozenReasoning = request.effectiveReasoningEffort;
      const reasoningCapability = capabilityByKey.get(key);
      let effectiveReasoning = frozenReasoning ?? (requestedReasoning === "auto" ? reasoningCapability?.default : undefined);
      const configuredReasoning = frozenReasoning ?? (requestedReasoning !== "auto" ? requestedReasoning : undefined);
      if (configuredReasoning) {
        if (!reasoningCapability) throw new Error("REASONING_CAPABILITY_UNKNOWN: ACP session did not expose reasoning capability");
        effectiveReasoning = await client.setReasoning(sessionId, configuredReasoning, reasoningCapability, request.timeoutMs);
      }
      activeSessionIds.add(sessionId);
      const emitter = createAgentEventEmitter({ runId: request.runId ?? args.runContext.runId, roleId: request.roleId, executionId: request.executionId ?? "unknown", attempt: request.attempt ?? 1, backend: definition.backendId, sessionId, onEvent: request.onEvent });
      if (recreatedFrom) await emitter.emit({ type: "session_recreated", previousSessionId: recreatedFrom, sessionId, reason: "resume_failed" });
      let output = "";
      const unsubscribe = client.onNotification((message) => {
        if (message.method === "session/request_permission" && message.id !== undefined) {
          client.respond(message.id as string | number, { outcome: { outcome: "cancelled" } });
          void emitter.emit({ type: "permission_required", request: message.params });
          return;
        }
        if (message.method !== "session/update") return;
        const params = asRecord(message.params);
        if (params?.sessionId !== sessionId) return;
        const update = asRecord(params.update);
        const kind = String(update?.sessionUpdate ?? "");
        if (kind === "agent_message_chunk") {
          const text = textFromContent(update?.content);
          if (text) { output += text; void emitter.emit({ type: "text_delta", text }); }
        } else if (kind === "tool_call" || kind === "tool_call_started") {
          const tool = String(update?.title ?? update?.name ?? update?.tool ?? "tool");
          void emitter.emit({ type: "tool_started", tool, input: update?.rawInput ?? update?.input });
        } else if (kind === "tool_call_update" || kind === "tool_call_completed") {
          const tool = String(update?.title ?? update?.name ?? update?.tool ?? "tool");
          void emitter.emit({ type: "tool_finished", tool, output: update?.rawOutput ?? update?.output });
        } else if (kind === "permission_request") {
          void emitter.emit({ type: "permission_required", request: update });
        }
      });
      const abort = () => { void client.request("session/cancel", { sessionId }).catch(() => undefined); };
      request.signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: `${request.prompt}${schemaInstruction(request.schema)}` }] }, request.timeoutMs);
        if (!output) {
          const record = asRecord(result);
          const content = Array.isArray(record?.content) ? record.content : [];
          output = content.map(textFromContent).join("");
        }
        output = boundedText(output, request.maxOutputBytes);
        await emitter.emit({ type: "turn_completed", output });
        return {
          exitCode: 0,
          stdout: output,
          stderr: "",
          args: definition.args,
          sessionId,
          messageId: `${definition.backendId}-${Date.now()}`,
          modelId: request.modelId,
          backend: definition.backendId,
          toolRef: `model.${definition.backendId}/${request.modelId}`,
          command: `${definition.command} ${definition.args.join(" ")}`,
          requestedReasoningEffort: requestedReasoning,
          effectiveReasoningEffort: effectiveReasoning,
          reasoningKind: reasoningCapability?.kind,
          reasoningSupported: reasoningCapability?.supported
        };
      } catch (error) {
        await emitter.emit({ type: "turn_failed", error: error instanceof Error ? error.message : String(error) });
        throw new OpencodeExecutionError(error instanceof Error ? error.message : String(error), { stderr: "", timedOut: /timed out/i.test(String(error)) });
      } finally {
        activeSessionIds.delete(sessionId);
        request.signal?.removeEventListener("abort", abort);
        unsubscribe();
        await request.onPromptCall?.({ phase, ordinal: 1, stage: "after", prompt: request.prompt, output, outputChars: output.length });
      }
    },
    async abort(args) {
      if (clientPromise) await clientPromise.then(async (client) => {
        const sessionIds = args?.sessionId ? [args.sessionId] : [...activeSessionIds];
        await Promise.all(sessionIds.map((sessionId) => client.request("session/cancel", { sessionId }).catch(() => undefined)));
      });
    },
    async close() {
      if (clientPromise) await clientPromise.then((client) => client.close());
      clientPromise = undefined;
      sessionByKey.clear();
      capabilityByKey.clear();
      activeSessionIds.clear();
    }
  };
}

type BackendExecuteRequestWithReasoning = BackendExecuteRequest & { reasoningEffort?: ReasoningEffort };

export function defaultAcpModel(definition: AcpAdapterDefinition): string {
  return modelFromEnv(definition.modelEnv, "default");
}
