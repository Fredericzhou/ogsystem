import { createAgentEventEmitter } from "./agent-client-types.js";
import { AcpClient } from "./acp-client.js";
import { boundedText, modelFromEnv, schemaInstruction } from "./cli-adapter-support.js";
import { OpencodeExecutionError } from "./opencode-executor.js";
import type { BackendExecuteRequest, BackendRunSession } from "./model-backend-registry.js";
import { isAbsolute, relative, resolve } from "node:path";
import type { ReasoningCapability, ReasoningEffort, RunContext } from "./types.js";

export type AcpWorkspaceCapabilityPolicy = {
  root: string;
  read?: boolean;
  write?: boolean;
  command?: boolean;
};

export type AcpPermissionDecision = {
  allowed: boolean;
  capability: "read" | "write" | "command" | "unknown";
  reason: string;
  response?: { outcome: { outcome: "selected"; optionId: string } };
};

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

function permissionRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const nested = asRecord(record.permission) ?? asRecord(record.request);
  return nested ?? record;
}

function permissionText(record: Record<string, unknown>): string {
  return ["permission", "kind", "type", "action", "operation", "tool", "title", "description"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function permissionCapability(record: Record<string, unknown>): AcpPermissionDecision["capability"] {
  const text = permissionText(record);
  if (/command|execute|shell|terminal|run\b/.test(text)) return "command";
  if (/write|edit|modify|delete|create|patch|move|rename/.test(text)) return "write";
  if (/read|list|search|open|view|inspect|stat/.test(text)) return "read";
  return "unknown";
}

function pathCandidates(record: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!/(?:path|file|directory|cwd|workspace)/i.test(key) || typeof value !== "string") continue;
    paths.push(value);
  }
  return paths;
}

function isWithinRoot(candidate: string, root: string): boolean {
  if (!candidate || candidate.startsWith("file://")) return false;
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const relativePath = relative(resolve(root), absolute);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function commandText(record: Record<string, unknown>): string {
  for (const key of ["command", "cmd", "shellCommand", "script"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return "";
}

function shellWords(value: string): string[] | undefined {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) { words.push(current); current = ""; }
      continue;
    }
    current += character;
  }
  if (quote) return undefined;
  if (current) words.push(current);
  return words;
}

function commandIsBounded(record: Record<string, unknown>, root: string): boolean {
  const command = commandText(record).trim();
  if (!command) return false;
  // ACP executes through a shell. Reject composition, substitution and
  // redirection so a single allow-once decision cannot hide extra commands.
  if (/[;|&<>`\n\r]|\$\(/.test(command)) return false;
  const words = shellWords(command);
  if (!words?.length) return false;
  const shellInterpreters = new Set(["sh", "bash", "zsh", "fish", "pwsh", "powershell", "cmd", "node", "deno", "python", "python3", "ruby", "perl"]);
  if (shellInterpreters.has(words[0].split("/").at(-1) ?? "")) return false;
  for (const word of words) {
    if (word === "~" || word.startsWith("~/") || word.startsWith("$")) return false;
    const pathToken = word.includes("=") ? word.slice(word.indexOf("=") + 1) : word;
    if (isAbsolute(pathToken) || pathToken.includes("/") || pathToken === "." || pathToken === "..") {
      if (!isWithinRoot(pathToken, root)) return false;
    }
  }
  const cdIndex = words.indexOf("cd");
  if (cdIndex >= 0 && (!words[cdIndex + 1] || !isWithinRoot(words[cdIndex + 1], root))) return false;
  return true;
}

/**
 * Decide whether an ACP permission request can be granted by the explicit
 * workspace capability policy. Unknown requests and requests outside the
 * execution root remain denied; callers can still emit them for audit/UI.
 */
export function decideAcpPermission(
  request: unknown,
  policy?: AcpWorkspaceCapabilityPolicy
): AcpPermissionDecision {
  const record = permissionRecord(request);
  if (!record || !policy?.root) return { allowed: false, capability: "unknown", reason: "no explicit workspace capability policy" };
  const capability = permissionCapability(record);
  if (capability === "unknown" || policy[capability] !== true) {
    return { allowed: false, capability, reason: `capability ${capability} is not explicitly granted` };
  }
  // Some ACP clients describe a terminal command without repeating its cwd.
  // A command is still bounded to the already-authorized execution root;
  // file read/write requests must name their target explicitly.
  const candidates = pathCandidates(record);
  if (capability === "command") {
    if (!commandIsBounded(record, policy.root)) {
      return { allowed: false, capability, reason: "command is not bounded to the execution workspace" };
    }
    if (candidates.length === 0) candidates.push(policy.root);
  }
  if (candidates.length === 0 || candidates.some((candidate) => !isWithinRoot(candidate, policy.root))) {
    return { allowed: false, capability, reason: "permission target is outside the execution workspace" };
  }
  const options = Array.isArray(record.options) ? record.options : [];
  const selected = options
    .map((option) => asRecord(option))
    .find((option) => {
      const label = String(option?.optionId ?? option?.id ?? option?.name ?? option?.title ?? "").toLowerCase();
      return /allow|approve|once|yes/.test(label) && !/always|session|\ball\b/.test(label);
    });
  const optionId = selected ? String(selected.optionId ?? selected.id ?? "") : "";
  if (!optionId) return { allowed: false, capability, reason: "ACP request has no bounded allow-once option" };
  return { allowed: true, capability, reason: "explicit workspace capability granted", response: { outcome: { outcome: "selected", optionId } } };
}

export function createAcpRunSession(definition: AcpAdapterDefinition, args: { targetDir: string; runContext: RunContext }): BackendRunSession {
  let clientPromise: Promise<AcpClient> | undefined;
  const sessionByKey = new Map<string, string>();
  const sessionDirectoryByKey = new Map<string, string>();
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
      const executionDirectory = request.executionDirectory ?? request.directory;
      const normalizedExecutionDirectory = resolve(executionDirectory);
      const knownDirectory = sessionDirectoryByKey.get(key);
      // A session is tied to the directory it was created in. Never carry a
      // session from an earlier clean-room execution into a new directory.
      let sessionId = knownDirectory === undefined || knownDirectory === normalizedExecutionDirectory
        ? request.sessionId ?? sessionByKey.get(key)
        : undefined;
      let sessionModelId: string | undefined;
      if (!sessionId) {
        const session = await client.createSessionInfo(executionDirectory, request.timeoutMs);
        sessionId = session.sessionId;
        sessionModelId = session.modelId;
        if (session.reasoning) capabilityByKey.set(key, session.reasoning);
        sessionByKey.set(key, sessionId);
        sessionDirectoryByKey.set(key, normalizedExecutionDirectory);
      } else if (!sessionByKey.has(key)) {
        try {
          const loaded = await client.loadSession(sessionId, executionDirectory, request.timeoutMs);
          sessionId = loaded.sessionId;
          sessionModelId = loaded.modelId;
          if (loaded.reasoning) capabilityByKey.set(key, loaded.reasoning);
          sessionByKey.set(key, sessionId);
          sessionDirectoryByKey.set(key, normalizedExecutionDirectory);
        } catch {
          const previousSessionId = sessionId;
          const session = await client.createSessionInfo(executionDirectory, request.timeoutMs);
          sessionId = session.sessionId;
          sessionModelId = session.modelId;
          if (session.reasoning) capabilityByKey.set(key, session.reasoning);
          sessionByKey.set(key, sessionId);
          sessionDirectoryByKey.set(key, normalizedExecutionDirectory);
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
          const decision = decideAcpPermission(message.params, request.workspaceCapabilityPolicy);
          client.respond(message.id as string | number, decision.allowed ? decision.response : { outcome: { outcome: "cancelled" } });
          void emitter.emit({ type: "permission_required", request: { request: message.params, decision: { allowed: decision.allowed, capability: decision.capability, reason: decision.reason } } });
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
      sessionDirectoryByKey.clear();
      capabilityByKey.clear();
      activeSessionIds.clear();
    }
  };
}

type BackendExecuteRequestWithReasoning = BackendExecuteRequest & { reasoningEffort?: ReasoningEffort };

export function defaultAcpModel(definition: AcpAdapterDefinition): string {
  return modelFromEnv(definition.modelEnv, "default");
}
