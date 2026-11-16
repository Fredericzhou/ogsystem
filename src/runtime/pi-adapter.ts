import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
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

  static async start(command: string, cwd: string, modelId?: string, sessionId?: string, tools?: string[]): Promise<PiRpcSession> {
    const args = ["--mode", "rpc"];
    if (!sessionId) args.push("--no-session");
    if (modelId && modelId !== "default") args.push("--model", modelId);
    if (sessionId) args.push("--session-id", sessionId);
    if (tools !== undefined) {
      // Pi owns the native tool names. `--no-tools` makes the binding an
      // explicit allowlist instead of inheriting the CLI default tool set.
      args.push("--no-tools");
      if (tools.length > 0) args.push("--tools", tools.join(","));
    }
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

const piNativeToolAliases: Record<string, string> = {
  "workspace.read": "read",
  "workspace.list": "ls",
  "workspace.glob": "find",
  "workspace.search": "grep",
  "workspace.patch_text": "edit",
  "workspace.write": "write",
  "workspace.run": "bash",
  list: "ls",
  glob: "find"
};

/** Map the frozen v2 tool set to Pi's native CLI tool identifiers. */
export function mapPiEffectiveTools(effectiveTools: string[] | undefined): string[] | undefined {
  if (effectiveTools === undefined) return undefined;
  return [...new Set(effectiveTools.map((tool) => piNativeToolAliases[tool] ?? tool))].sort();
}

/** Pi must fail closed when the backend returns more bytes than the frozen quota. */
export function assertPiOutputWithinLimit(value: string, maxOutputBytes: number): void {
  if (Buffer.byteLength(value, "utf8") > maxOutputBytes) {
    throw new Error(`V2_OUTPUT_QUOTA_EXCEEDED: Pi output exceeded maxOutputBytes (${maxOutputBytes})`);
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

const PI_CLI_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

type PiToolDiscovery = {
  names: string[];
  source: "pi-sdk" | "pi-cli-contract";
};

async function piPackageRoot(command: string): Promise<string | undefined> {
  const roots: string[] = [];
  const managedRoot = process.env.PI_MANAGED_INSTALL_ROOT?.trim();
  if (managedRoot) {
    try {
      const version = (await readFile(join(managedRoot, "current-version"), "utf8")).trim();
      if (version) roots.push(join(managedRoot, "releases", version));
    } catch { /* Fall through to the executable and default managed paths. */ }
  }
  try {
    const executable = await realpath(command);
    const binDirectory = dirname(executable);
    const agentDirectory = dirname(dirname(binDirectory));
    const installRoot = join(agentDirectory, "install");
    const version = (await readFile(join(installRoot, "current-version"), "utf8")).trim();
    if (version) roots.push(join(installRoot, "releases", version));
  } catch { /* A system-installed Pi may not expose a managed release layout. */ }
  const piHome = process.env.PI_HOME?.trim() || join(homedir(), ".pi", "agent");
  try {
    const version = (await readFile(join(piHome, "install", "current-version"), "utf8")).trim();
    if (version) roots.push(join(piHome, "install", "releases", version));
  } catch { /* Use the CLI contract fallback below. */ }
  for (const root of [...new Set(roots)]) {
    const packageRoot = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
    try {
      await access(join(packageRoot, "dist", "index.js"));
      return packageRoot;
    } catch { /* Try the next installation candidate. */ }
  }
  return undefined;
}

async function discoverPiNativeToolNames(command: string): Promise<PiToolDiscovery> {
  const packageRoot = await piPackageRoot(command);
  if (packageRoot) {
    try {
      // These are the public SDK constructors used by Pi itself. Calling them
      // only creates definitions; it does not start a model or execute a tool.
      const sdk = await import(pathToFileURL(join(packageRoot, "dist", "index.js")).href) as {
        createCodingTools?: (cwd: string) => Array<{ name?: unknown }>;
        createReadOnlyTools?: (cwd: string) => Array<{ name?: unknown }>;
      };
      const tools = [
        ...(sdk.createCodingTools?.(process.cwd()) ?? []),
        ...(sdk.createReadOnlyTools?.(process.cwd()) ?? [])
      ];
      const names = [...new Set(tools.map((tool) => typeof tool.name === "string" ? tool.name : "").filter(Boolean))].sort();
      if (names.length > 0) return { names, source: "pi-sdk" };
    } catch { /* Fall back to the installed CLI's documented contract. */ }
  }
  // Pi documents these names in `--help` and accepts them through `--tools`.
  // The list intentionally excludes MCP and extension tools, which are dynamic.
  return { names: [...PI_CLI_TOOL_NAMES], source: "pi-cli-contract" };
}

function modelsFromPi(value: unknown, reasoning?: ReasoningCapability, status = "discovered", runnable = true): ModelCatalogEntry[] {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const raw = Array.isArray(data.models) ? data.models : [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) return [];
    const provider = typeof record.provider === "string" ? record.provider.trim() : "";
    const modelId = provider && !id.includes("/") ? `${provider}/${id}` : id;
    return [{ backend: "pi", modelId, runnable, name: typeof record.name === "string" ? record.name : modelId, status, capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [], ...(reasoning ? { reasoning } : {}) }];
  });
}

export async function discoverConfiguredPiModels(reasoning?: ReasoningCapability): Promise<ModelCatalogEntry[]> {
  const configPath = process.env.PI_MODELS_PATH
    || join(process.env.PI_HOME || join(homedir(), ".pi", "agent"), "models.json");
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    const providers = parsed.providers && typeof parsed.providers === "object" && !Array.isArray(parsed.providers)
      ? parsed.providers as Record<string, unknown>
      : {};
    const models: ModelCatalogEntry[] = [];
    for (const [providerId, value] of Object.entries(providers)) {
      const records = value && typeof value === "object" && !Array.isArray(value)
        && Array.isArray((value as Record<string, unknown>).models)
        ? (value as Record<string, unknown>).models as unknown[]
        : [];
      for (const item of records) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        if (!id) continue;
        const modelId = id.includes("/") ? id : `${providerId}/${id}`;
        if (models.some((model) => model.modelId === modelId)) continue;
        models.push({ backend: "pi", modelId, runnable: false, name: typeof record.name === "string" ? record.name : modelId, status: "unverified", capabilities: { textInput: true, textOutput: true, toolcall: true }, variants: [], ...(reasoning ? { reasoning } : {}) });
      }
    }
    return models;
  } catch {
    return [];
  }
}

/**
 * Pi resolves bare model names across every configured provider. A Harness
 * model may stay backend-local (for example `gpt-6-luna`), but the adapter
 * must pass the provider-qualified ID required by Pi when one is configured.
 */
export async function resolvePiModelId(modelId?: string): Promise<string | undefined> {
  if (!modelId || modelId === "default" || modelId.includes("/")) return modelId;
  const configured = await discoverConfiguredPiModels();
  return configured.find((model) => model.modelId.endsWith(`/${modelId}`))?.modelId ?? modelId;
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
  adapterVersion: "pi-rpc-v2-native-tools-1",
  getResourceCapabilities() {
    // Pi's RPC cwd is not a security boundary for absolute paths or symlinks.
    // Text-only Roles remain usable; explicit filesystem/process tools fail
    // closed until a real sandbox/path guard is available.
    return { filesystem: false, process: false, network: false };
  },
  mapEnvironmentPolicy(policy) {
    return { root: policy.root, read: policy.filesystem.read, write: policy.filesystem.write, command: policy.process, network: policy.network };
  },
  validateToolResources(toolId, policy) {
    const native = piNativeToolAliases[toolId] ?? toolId;
    if (["read", "ls", "find", "grep"].includes(native) && !policy.filesystem.read) {
      return { allowed: false, reason: "filesystem reads are disabled by the effective environment policy" };
    }
    if (["write", "edit"].includes(native) && !policy.filesystem.write) {
      return { allowed: false, reason: "filesystem writes are disabled by the effective environment policy" };
    }
    if (native === "bash" && !policy.process) {
      return { allowed: false, reason: "process execution is disabled by the effective environment policy" };
    }
    return { allowed: true };
  },
  async discover({ workdir }) {
    const command = await resolveExecutable("pi", [join(homedir(), ".local", "bin", "pi")]);
    const configuredModels = await discoverConfiguredPiModels();
    if (!command) return { status: "not_installed", detail: "Pi CLI is not installed on this machine.", models: configuredModels.map((model) => ({ ...model, status: "unavailable" })) };
    try {
      const client = await PiRpcSession.start(command, workdir);
      try {
        const levels = await client.request("get_available_thinking_levels", {}, 10_000).catch(() => undefined);
        const reasoning = piReasoningCapability(levels?.data);
        const result = await client.request("get_available_models", {}, 10_000).catch(() => undefined);
        const liveModels = result ? modelsFromPi(result.data, reasoning) : [];
        const models = [...configuredModels.map((model) => ({ ...model, reasoning })), ...liveModels.filter((model) => !configuredModels.some((configured) => configured.modelId === model.modelId))];
        return { status: "runnable", detail: models.length ? `Pi RPC ready; ${models.length} configured model${models.length === 1 ? "" : "s"} found.` : "Pi RPC ready; no local model configuration was found.", models };
      } finally { await client.close(); }
    } catch (error) {
      return { status: "installed_but_broken", detail: error instanceof Error ? error.message : String(error), models: [] };
    }
  },
  async discoverNativeTools({ modelId, workdir, timeoutMs }) {
    const command = await resolveExecutable("pi", [join(homedir(), ".local", "bin", "pi")]);
    if (!command) throw new Error("Pi CLI is not installed.");
    const discovered = await discoverPiNativeToolNames(command);
    return {
      verifiedTools: discovered.names,
      detail: `Pi ${discovered.source} verified ${discovered.names.length} built-in tool${discovered.names.length === 1 ? "" : "s"}; MCP and extension tools require a separate dynamic refresh.`,
      resources: this.getResourceCapabilities?.()
    };
  },
  async startRun({ targetDir, runContext }): Promise<BackendRunSession> {
    const command = await resolveExecutable("pi", [join(homedir(), ".local", "bin", "pi")]);
    if (!command) throw new Error("Pi CLI is not installed.");
    const clients = new Map<string, PiRpcSession>();
    const getClient = async (modelId: string, sessionKey: string, executionDirectory: string, sessionId?: string, effectiveTools?: string[]) => {
      const nativeTools = mapPiEffectiveTools(effectiveTools);
      const resolvedModelId = await resolvePiModelId(modelId || modelFromEnv("OGS_PI_MODEL"));
      const key = `${resolvedModelId}:${sessionKey}:${executionDirectory}:${nativeTools?.join(",") ?? "default"}`;
      let client = clients.get(key);
      if (!client) { client = await PiRpcSession.start(command, executionDirectory, resolvedModelId, sessionId, nativeTools); clients.set(key, client); }
      return client;
    };
    return {
      async execute(request) {
        const phase = request.promptCallPhase ?? "primary";
        await request.onPromptCall?.({ phase, ordinal: 1, stage: "before", prompt: request.prompt });
        const executionDirectory = request.executionDirectory ?? request.directory;
        const client = await getClient(request.modelId, request.sessionKey ?? request.roleId, executionDirectory, request.sessionId, request.effectiveTools);
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
        const emitter = createAgentEventEmitter({ runId: request.runId ?? runContext.runId, roleId: request.roleId, executionId: request.executionId ?? "unknown", attempt: request.attempt ?? 1, backend: "pi", model: request.modelId, sessionId, policyDigest: request.policyDigest, onEvent: request.onEvent });
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
          assertPiOutputWithinLimit(output, request.maxOutputBytes);
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
    const command = await resolveExecutable("pi", [join(homedir(), ".local", "bin", "pi")]);
    if (!command) throw new Error("Pi CLI is not installed.");
    const client = await PiRpcSession.start(command, workdir, await resolvePiModelId(modelId));
    try { await client.request("prompt", { message: 'Return exactly {"ok":true}' }, timeoutMs); } finally { await client.close(); }
  }
};

type BackendExecuteRequestWithReasoning = import("./model-backend-registry.js").BackendExecuteRequest & { reasoningEffort?: ReasoningEffort };
