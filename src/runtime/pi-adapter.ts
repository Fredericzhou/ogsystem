import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { boundedText, modelFromEnv, resolveExecutable, schemaInstruction } from "./cli-adapter-support.js";
import { createAgentEventEmitter } from "./agent-client-types.js";
import { terminateChildProcessTree, waitForChildExit } from "./child-process-lifecycle.js";
import type { BackendAdapter, BackendDescriptor, BackendRunSession } from "./model-backend-registry.js";
import type { ModelCatalogEntry, ReasoningCapability, ReasoningEffort } from "./types.js";
import { OpencodeExecutionError } from "./opencode-executor.js";

type PiMessage = Record<string, unknown>;

class PiRpcSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, { resolve(value: PiMessage): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private readonly listeners = new Set<(message: PiMessage) => void>();
  private nextId = 0;
  private closed = false;
  private stderr = "";

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk.toString()}`.slice(-8192); });
    child.on("error", (error) => this.failAll(error instanceof Error ? error : new Error(String(error))));
    child.on("exit", (code, signal) => {
      if (!this.closed) this.failAll(new Error(`Pi RPC exited (${signal ?? code ?? "unknown"})${this.stderr ? `: ${this.stderr}` : ""}`));
    });
  }

  static async start(command: string, cwd: string, modelId?: string, sessionId?: string): Promise<PiRpcSession> {
    const args = ["--mode", "rpc"];
    if (!sessionId) args.push("--no-session");
    if (modelId && modelId !== "default") args.push("--model", modelId);
    if (sessionId) args.push("--session-id", sessionId);
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
    const session = new PiRpcSession(child);
    try {
      await session.request("get_state", {}, 10_000);
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  onMessage(listener: (message: PiMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(type: string, data: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<PiMessage> {
    const id = `req_${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC ${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ ...data, type, id })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private onLine(line: string): void {
    let message: PiMessage;
    try { message = JSON.parse(line) as PiMessage; } catch { return; }
    if (message.type === "response" && typeof message.id === "string") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.success === false) pending.reject(new Error(String(message.error ?? "Pi request failed")));
      else pending.resolve(message);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("Pi RPC closed"));
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin.end();
    if (!await waitForChildExit(this.child, 2000)) await terminateChildProcessTree(this.child);
  }
}

function piReasoningCapability(value: unknown): ReasoningCapability | undefined {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const candidates = [record.thinkingLevels, record.availableThinkingLevels, record.levels];
  const raw = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!raw) return undefined;
  const levels = raw.filter((level): level is string => typeof level === "string").map((level) => level.trim().toLowerCase());
  const supported = levels.filter((level): level is Exclude<ReasoningEffort, "auto" | "on"> => ["off", "low", "medium", "high", "xhigh", "max"].includes(level));
  if (!supported.length) return { supported: false, kind: "none", levels: [] };
  const defaultValue = [record.currentLevel, record.currentThinkingLevel, record.defaultLevel]
    .find((level): level is string => typeof level === "string")?.trim().toLowerCase();
  return { supported: true, kind: "effort", levels: [...new Set(supported)], ...(defaultValue && supported.includes(defaultValue as never) ? { default: defaultValue as Exclude<ReasoningEffort, "auto" | "on"> } : {}) };
}

function modelsFromPi(value: unknown, reasoning?: ReasoningCapability): ModelCatalogEntry[] {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const raw = Array.isArray(data.models) ? data.models : [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) return [];
    return [{ backend: "pi", modelId: id, runnable: true, name: typeof record.name === "string" ? record.name : id, status: "active", capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [], ...(reasoning ? { reasoning } : {}) }];
  });
}

export const piBackendDescriptor: BackendDescriptor = {
  backendId: "pi",
  displayName: "Pi",
  iconKey: "pi",
  transport: "rpc-stdio",
  sessionKind: "process-session",
  processOwnership: "spawned_by_ogs",
  capabilities: { textInput: true, textOutput: true, toolcall: true, structuredOutput: true, sessionReuse: true, abort: true }
};

export const piBackendAdapter: BackendAdapter = {
  backendId: "pi",
  verifiedRunnable: true,
  async discover({ workdir }) {
    const command = await resolveExecutable("pi", ["/Users/fred/.local/bin/pi"]);
    if (!command) return { status: "not_installed", detail: "Pi CLI is not installed on this machine.", models: [] };
    try {
      const client = await PiRpcSession.start(command, workdir);
      try {
        const result = await client.request("get_available_models", {}, 10_000);
        const levels = await client.request("get_available_thinking_levels", {}, 10_000).catch(() => undefined);
        const models = modelsFromPi(result.data, piReasoningCapability(levels?.data));
        return { status: models.length ? "runnable" : "unavailable", detail: models.length ? `Pi ready (${models.length} model${models.length === 1 ? "" : "s"}).` : "Pi is installed but no authenticated model is available.", models };
      } finally { await client.close(); }
    } catch (error) {
      return { status: "installed_but_broken", detail: error instanceof Error ? error.message : String(error), models: [] };
    }
  },
  async startRun({ targetDir, runContext }): Promise<BackendRunSession> {
    const command = await resolveExecutable("pi", ["/Users/fred/.local/bin/pi"]);
    if (!command) throw new Error("Pi CLI is not installed.");
    const clients = new Map<string, PiRpcSession>();
    const getClient = async (modelId: string, sessionKey: string, sessionId?: string) => {
      const key = `${modelId || modelFromEnv("OGS_PI_MODEL")}:${sessionKey}`;
      let client = clients.get(key);
      if (!client) { client = await PiRpcSession.start(command, targetDir, modelId, sessionId); clients.set(key, client); }
      return client;
    };
    return {
      async execute(request) {
        const phase = request.promptCallPhase ?? "primary";
        await request.onPromptCall?.({ phase, ordinal: 1, stage: "before", prompt: request.prompt });
        const client = await getClient(request.modelId, request.sessionKey ?? request.roleId, request.sessionId);
        const requestedReasoning = (request as BackendExecuteRequestWithReasoning).reasoningEffort;
        const frozenReasoning = request.effectiveReasoningEffort;
        let reasoningCapability: ReasoningCapability | undefined;
        let effectiveReasoning: import("./types.js").ReasoningEffortLevel | undefined;
        const configuredReasoning = frozenReasoning ?? (requestedReasoning !== "auto" ? requestedReasoning : undefined);
        if (configuredReasoning) {
          const levelsResponse = await client.request("get_available_thinking_levels", {}, Math.min(request.timeoutMs, 10_000)).catch((error) => {
            throw new Error(`REASONING_CAPABILITY_UNKNOWN: Pi thinking levels unavailable: ${error instanceof Error ? error.message : String(error)}`);
          });
          const capability = piReasoningCapability(levelsResponse.data);
          reasoningCapability = capability;
          if (!capability || !capability.supported || !capability.levels.includes(configuredReasoning as never)) {
            throw new Error(`REASONING_UNSUPPORTED: Pi does not support reasoning level "${configuredReasoning}"`);
          }
          try {
            await client.request("set_thinking_level", { level: configuredReasoning }, Math.min(request.timeoutMs, 10_000));
            effectiveReasoning = configuredReasoning as import("./types.js").ReasoningEffortLevel;
          } catch (error) {
            throw new Error(`REASONING_CONFIG_FAILED: Pi rejected thinking level "${configuredReasoning}": ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (!reasoningCapability && requestedReasoning === "auto") {
          const levelsResponse = await client.request("get_available_thinking_levels", {}, Math.min(request.timeoutMs, 10_000)).catch(() => undefined);
          reasoningCapability = levelsResponse ? piReasoningCapability(levelsResponse.data) : undefined;
          effectiveReasoning = reasoningCapability?.default;
        }
        const state = await client.request("get_state");
        const sessionId = typeof (state.data as Record<string, unknown> | undefined)?.sessionId === "string" ? String((state.data as Record<string, unknown>).sessionId) : randomUUID();
        const emitter = createAgentEventEmitter({ runId: request.runId ?? runContext.runId, roleId: request.roleId, executionId: request.executionId ?? "unknown", attempt: request.attempt ?? 1, backend: "pi", sessionId, onEvent: request.onEvent });
        let output = "";
        const unsubscribe = client.onMessage((message) => {
          if (message.type === "message_update") {
            const event = message.assistantMessageEvent as Record<string, unknown> | undefined;
            if (event?.type === "text_delta" && typeof event.delta === "string") { output += event.delta; void emitter.emit({ type: "text_delta", text: event.delta }); }
          } else if (message.type === "tool_execution_start" && typeof message.toolName === "string") void emitter.emit({ type: "tool_started", tool: message.toolName, input: message.args });
          else if (message.type === "tool_execution_end" && typeof message.toolName === "string") void emitter.emit({ type: "tool_finished", tool: message.toolName, output: message.result });
        });
        try {
          const settled = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { stop(); reject(new Error(`Pi role timed out after ${request.timeoutMs}ms`)); }, request.timeoutMs);
            const stop = client.onMessage((message) => { if (message.type === "agent_settled") { clearTimeout(timer); stop(); resolve(); } });
            const abort = () => { void client.request("abort").catch(() => undefined); clearTimeout(timer); stop(); reject(new Error("Pi role was cancelled")); };
            request.signal?.addEventListener("abort", abort, { once: true });
            if (request.signal?.aborted) abort();
            const finish = (fn: () => void) => { request.signal?.removeEventListener("abort", abort); fn(); };
            const originalResolve = resolve;
            const originalReject = reject;
            resolve = () => finish(originalResolve);
            reject = (reason) => finish(() => originalReject(reason));
          });
          await client.request("prompt", { message: `${request.prompt}${schemaInstruction(request.schema)}` }, request.timeoutMs);
          await settled;
          if (!output) { const last = await client.request("get_last_assistant_text"); output = String((last.data as Record<string, unknown> | undefined)?.text ?? ""); }
          output = boundedText(output, request.maxOutputBytes);
          await emitter.emit({ type: "turn_completed", output });
          return {
            exitCode: 0,
            stdout: output,
            stderr: "",
            args: ["--mode", "rpc"],
            sessionId,
            messageId: `pi-${Date.now()}`,
            modelId: request.modelId,
            backend: "pi",
            toolRef: `model.pi/${request.modelId}`,
            command: "pi --mode rpc",
            requestedReasoningEffort: requestedReasoning,
            effectiveReasoningEffort: effectiveReasoning,
            reasoningKind: reasoningCapability?.kind,
            reasoningSupported: reasoningCapability?.supported
          };
        } catch (error) {
          await emitter.emit({ type: "turn_failed", error: error instanceof Error ? error.message : String(error) });
          throw new OpencodeExecutionError(error instanceof Error ? error.message : String(error), { stderr: "", timedOut: /timed out/i.test(String(error)) });
        } finally {
          unsubscribe();
          await request.onPromptCall?.({ phase, ordinal: 1, stage: "after", prompt: request.prompt, output, outputChars: output.length });
        }
      },
      async abort() { for (const client of clients.values()) await client.request("abort").catch(() => undefined); },
      async close() { for (const client of clients.values()) await client.close(); clients.clear(); }
    };
  },
  async probe({ modelId, workdir, timeoutMs }) {
    const command = await resolveExecutable("pi", ["/Users/fred/.local/bin/pi"]);
    if (!command) throw new Error("Pi CLI is not installed.");
    const client = await PiRpcSession.start(command, workdir, modelId);
    try { await client.request("prompt", { message: 'Return exactly {"ok":true}' }, timeoutMs); } finally { await client.close(); }
  }
};

type BackendExecuteRequestWithReasoning = import("./model-backend-registry.js").BackendExecuteRequest & { reasoningEffort?: ReasoningEffort };
