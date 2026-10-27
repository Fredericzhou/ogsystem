import { TeamBindingError, type TeamBinding, type TeamBindingInvocation, type TeamBindingResult } from "./runtime.js";
import type { TeamArtifactResolver } from "./artifact-store.js";

export interface TeamA2AAgentCard {
  protocolVersion: string;
  name: string;
  version: string;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills?: Array<{
    id: string;
    inputModes?: string[];
    outputModes?: string[];
  }>;
}

export type TeamA2AMessagePart =
  | { kind: "data"; mediaType: "application/json"; data: unknown }
  | { kind: "file"; mediaType: string; name: string; bytesBase64: string };

export type TeamA2ARemoteTask = {
  id: string;
  status: "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled" | "rejected";
  messageParts?: unknown[];
  requestedInputSchema?: unknown;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
};

export interface TeamA2AClient {
  getAgentCard(): Promise<TeamA2AAgentCard>;
  sendMessage(input: {
    messageId: string;
    idempotencyKey: string;
    parts: TeamA2AMessagePart[];
  }): Promise<TeamA2ARemoteTask>;
  getTask(taskId: string): Promise<TeamA2ARemoteTask>;
  cancelTask(taskId: string): Promise<boolean>;
}

export interface TeamA2AArtifactReader {
  read(artifactId: string): Promise<{ mediaType: string; bytes: Uint8Array }>;
}

export type TeamA2ABindingOptions = {
  client: TeamA2AClient;
  artifactReader?: TeamA2AArtifactReader;
  expectedProtocolVersion: string;
  expectedAgentVersion: string;
  inputMediaTypes?: string[];
  outputMediaTypes?: string[];
  pollIntervalMs?: number;
  skillId?: string;
  readOutput?: (task: TeamA2ARemoteTask) => TeamBindingResult;
  classifyError?: (error: unknown) => "transport" | "timeout" | "rate_limited" | "server_error" | "policy";
  sleep?: (ms: number) => Promise<void>;
};

type InvocationControl = {
  cancelled: boolean;
  taskId?: string;
  promise?: Promise<TeamBindingResult>;
  terminalResult?: TeamBindingResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mediaModes(card: TeamA2AAgentCard, skillId?: string, direction: "inputModes" | "outputModes" = "inputModes"): string[] {
  const skill = skillId ? card.skills?.find((item) => item.id === skillId) : undefined;
  const modes = skill?.[direction] ?? (direction === "inputModes" ? card.defaultInputModes : card.defaultOutputModes);
  return Array.isArray(modes) ? modes : [];
}

export function assertTeamA2ACardCompatible(
  card: TeamA2AAgentCard,
  requirements: { protocolVersion: string; agentVersion: string; inputMediaTypes?: string[]; outputMediaTypes?: string[]; skillId?: string }
): void {
  if (!isRecord(card) || card.protocolVersion !== requirements.protocolVersion || card.version !== requirements.agentVersion) {
    throw new TeamBindingError("Remote Agent Card protocol or version does not match the published Binding snapshot.", "policy");
  }
  if (typeof card.name !== "string" || !card.name || !card.capabilities
    || typeof card.capabilities.streaming !== "boolean" || typeof card.capabilities.pushNotifications !== "boolean") {
    throw new TeamBindingError("Remote Agent Card is missing required capability metadata.", "policy");
  }
  const inputModes = mediaModes(card, requirements.skillId, "inputModes");
  const outputModes = mediaModes(card, requirements.skillId, "outputModes");
  for (const mediaType of requirements.inputMediaTypes ?? ["application/json"]) {
    if (!inputModes.includes(mediaType)) throw new TeamBindingError(`Remote Agent does not accept '${mediaType}'.`, "policy");
  }
  for (const mediaType of requirements.outputMediaTypes ?? ["application/json"]) {
    if (!outputModes.includes(mediaType)) throw new TeamBindingError(`Remote Agent does not produce '${mediaType}'.`, "policy");
  }
}

function encodeInput(input: unknown, artifactReader?: TeamA2AArtifactReader, invocationResolver?: TeamArtifactResolver): Promise<TeamA2AMessagePart[]> {
  return (async () => {
    const data = isRecord(input) && Object.prototype.hasOwnProperty.call(input, "data") ? input.data : input;
    const artifacts = isRecord(input) && Array.isArray(input.artifacts) ? input.artifacts
      : isRecord(input) && isRecord(input.artifacts) ? Object.values(input.artifacts) : [];
    const parts: TeamA2AMessagePart[] = [{ kind: "data", mediaType: "application/json", data }];
    for (const item of artifacts) {
      if (!isRecord(item) || typeof item.artifactId !== "string" || typeof item.mediaType !== "string") {
        throw new TeamBindingError("Mapped Artifact reference is malformed.", "invalid_input");
      }
      if (!invocationResolver && !artifactReader) throw new TeamBindingError("No authorized Artifact reader is available for this A2A invocation.", "policy");
      const artifact = invocationResolver
        ? { mediaType: item.mediaType, bytes: await invocationResolver.read(item.artifactId) }
        : await artifactReader!.read(item.artifactId);
      if (artifact.mediaType !== item.mediaType) throw new TeamBindingError("Mapped Artifact media type changed before A2A delivery.", "invalid_input");
      parts.push({ kind: "file", mediaType: artifact.mediaType, name: item.artifactId, bytesBase64: Buffer.from(artifact.bytes).toString("base64") });
    }
    return parts;
  })();
}

function defaultReadOutput(task: TeamA2ARemoteTask): TeamBindingResult {
  if (!isRecord(task.result) || typeof task.result.event !== "string" || !Object.prototype.hasOwnProperty.call(task.result, "data")) {
    throw new TeamBindingError("Completed A2A Task did not return a typed Team output envelope.", "invalid_output");
  }
  return { kind: "completed", output: {
    event: task.result.event,
    data: task.result.data,
    ...(isRecord(task.result.artifacts) ? { artifacts: task.result.artifacts } : {})
  } };
}

function mapTerminal(task: TeamA2ARemoteTask, readOutput: (task: TeamA2ARemoteTask) => TeamBindingResult): TeamBindingResult {
  if (task.status === "completed") return readOutput(task);
  if (task.status === "input-required") {
    return { kind: "input-required", remoteTaskId: task.id, messageParts: task.messageParts ?? [], ...(task.requestedInputSchema === undefined ? {} : { requestedInputSchema: task.requestedInputSchema }) };
  }
  if (task.status === "canceled") throw new TeamBindingError(task.errorMessage ?? "Remote A2A Task was canceled.", "cancelled");
  if (task.status === "rejected") throw new TeamBindingError(task.errorMessage ?? "Remote A2A Task was rejected by policy.", "policy");
  throw new TeamBindingError(task.errorMessage ?? task.errorCode ?? "Remote A2A Task failed.", "server_error");
}

export function createTeamA2ABinding(options: TeamA2ABindingOptions): TeamBinding {
  if (!options.client || !options.expectedProtocolVersion || !options.expectedAgentVersion) throw new TypeError("A2A Binding requires a client and immutable protocol/Agent version requirements.");
  const controls = new Map<string, InvocationControl>();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readOutput = options.readOutput ?? defaultReadOutput;
  const classifyError = options.classifyError ?? ((error: unknown) => {
    if (isRecord(error) && typeof error.status === "number") {
      if (error.status === 429) return "rate_limited" as const;
      if (error.status >= 500) return "server_error" as const;
    }
    return "transport" as const;
  });

  return Object.freeze({
    async invoke(invocation: TeamBindingInvocation): Promise<TeamBindingResult> {
      const prior = controls.get(invocation.idempotencyKey);
      if (prior?.terminalResult) return structuredClone(prior.terminalResult);
      if (prior?.promise) return prior.promise;
      const control: InvocationControl = { cancelled: false };
      controls.set(invocation.idempotencyKey, control);
      control.promise = (async () => {
        const card = await options.client.getAgentCard();
        assertTeamA2ACardCompatible(card, {
          protocolVersion: options.expectedProtocolVersion,
          agentVersion: options.expectedAgentVersion,
          inputMediaTypes: options.inputMediaTypes,
          outputMediaTypes: options.outputMediaTypes,
          skillId: options.skillId
        });
        const parts = await encodeInput(invocation.input, options.artifactReader, invocation.artifactResolver);
        if (control.cancelled) throw new TeamBindingError("A2A invocation canceled before task submission.", "cancelled");
        const submitted = await options.client.sendMessage({ messageId: invocation.idempotencyKey, idempotencyKey: invocation.idempotencyKey, parts });
        control.taskId = submitted.id;
        if (control.cancelled) {
          const confirmed = await options.client.cancelTask(submitted.id).catch(() => false);
          const error = new TeamBindingError("A2A invocation canceled during task submission.", "cancelled");
          error.outcomeUnknown = !confirmed;
          throw error;
        }
        let task = submitted;
        while (["submitted", "working"].includes(task.status)) {
          await sleep(options.pollIntervalMs ?? 1000);
          if (control.cancelled) {
            const confirmed = await options.client.cancelTask(task.id).catch(() => false);
            const error = new TeamBindingError("A2A invocation canceled while waiting for its Task.", "cancelled");
            error.outcomeUnknown = !confirmed;
            throw error;
          }
          task = await options.client.getTask(task.id);
        }
        const result = mapTerminal(task, readOutput);
        control.terminalResult = structuredClone(result);
        return result;
      })().catch((error) => {
        control.promise = undefined;
        if (error instanceof TeamBindingError) throw error;
        const mapped = new TeamBindingError(error instanceof Error ? error.message : String(error), classifyError(error));
        mapped.outcomeUnknown = control.taskId !== undefined;
        throw mapped;
      });
      return control.promise;
    },
    async cancel(invocation: TeamBindingInvocation): Promise<boolean> {
      const control = controls.get(invocation.idempotencyKey);
      if (!control) return false;
      control.cancelled = true;
      if (!control.taskId) return false;
      try { return await options.client.cancelTask(control.taskId); }
      catch { return false; }
    }
  });
}
