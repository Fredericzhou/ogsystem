import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from "@a2a-js/sdk/client";
import { Role, TaskState, type AgentCard, type Artifact, type Message, type Part, type Task } from "@a2a-js/sdk";
import type { TeamA2AAgentCard, TeamA2AClient, TeamA2AMessagePart, TeamA2ARemoteTask } from "./a2a-binding.js";

const TEAM_IR_METADATA = "team.ir";
const TERMINAL_FAILURE_STATES = new Set([TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_CANCELED, TaskState.TASK_STATE_REJECTED]);

export type TeamA2AHttpClientOptions = {
  endpoint: string;
  authorization?: string;
  headers?: Record<string, string>;
  cardPath?: string;
  protocolBinding?: "JSONRPC" | "HTTP+JSON";
  acceptedOutputModes?: string[];
  fetch?: typeof fetch;
};

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function normalizeEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash) throw new TypeError("A2A endpoint must not contain credentials, query parameters, or fragments.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new TypeError("A2A endpoint must use HTTPS except for loopback development endpoints.");
  }
  return url;
}

function statusFrom(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const status = record.status ?? record.statusCode ?? record.response?.status;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function sanitizedError(error: unknown): Error & { status?: number } {
  const status = statusFrom(error);
  const result = new Error(status ? `A2A request failed with HTTP ${status}.` : "A2A request failed.") as Error & { status?: number };
  if (status) result.status = status;
  return result;
}

function makeTrustedFetch(origin: string, auth: string | undefined, headers: Record<string, string>, fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== origin) throw new Error("A2A request target is outside the configured origin.");
    const requestHeaders = new Headers(request.headers);
    for (const [name, value] of Object.entries(headers)) requestHeaders.set(name, value);
    if (auth) requestHeaders.set("authorization", auth);
    try {
      const response = await fetchImpl(new Request(request, { headers: requestHeaders, redirect: "error" }));
      if (!response.ok) throw Object.assign(new Error("A2A HTTP response was not successful."), { status: response.status });
      return response;
    } catch (error) {
      throw sanitizedError(error);
    }
  };
}

function asTeamCard(card: AgentCard, protocolBinding?: string): TeamA2AAgentCard {
  const preferred = card.supportedInterfaces.find((item) => !protocolBinding || item.protocolBinding === protocolBinding) ?? card.supportedInterfaces[0];
  if (!preferred) throw new Error("Remote Agent Card has no supported interface.");
  return {
    protocolVersion: preferred.protocolVersion,
    name: card.name,
    version: card.version,
    defaultInputModes: card.defaultInputModes,
    defaultOutputModes: card.defaultOutputModes,
    capabilities: {
      streaming: card.capabilities?.streaming ?? false,
      pushNotifications: card.capabilities?.pushNotifications ?? false,
    },
    skills: card.skills.map((skill) => ({ id: skill.id, inputModes: skill.inputModes, outputModes: skill.outputModes })),
  };
}

function metadata(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mapPart(part: Part): Record<string, unknown> {
  const teamMetadata = metadata(metadata(part.metadata)[TEAM_IR_METADATA]);
  if (part.content?.$case === "data") return { kind: "data", mediaType: part.mediaType, data: part.content.value };
  if (part.content?.$case === "raw") return {
    kind: "file",
    mediaType: part.mediaType,
    name: part.filename,
    bytesBase64: Buffer.from(part.content.value).toString("base64"),
    ...(typeof teamMetadata.slotId === "string" ? { slotId: teamMetadata.slotId } : {}),
  };
  if (part.content?.$case === "text") return { kind: "text", mediaType: part.mediaType, text: part.content.value };
  if (part.content?.$case === "url") return { kind: "url", mediaType: part.mediaType };
  return { kind: "unknown", mediaType: part.mediaType };
}

function mapTask(task: Task): TeamA2ARemoteTask {
  const state = task.status?.state;
  const status = state === TaskState.TASK_STATE_SUBMITTED ? "submitted"
    : state === TaskState.TASK_STATE_WORKING ? "working"
      : state === TaskState.TASK_STATE_INPUT_REQUIRED ? "input-required"
        : state === TaskState.TASK_STATE_AUTH_REQUIRED ? "auth-required"
        : state === TaskState.TASK_STATE_COMPLETED ? "completed"
          : state === TaskState.TASK_STATE_CANCELED ? "canceled"
            : state === TaskState.TASK_STATE_REJECTED ? "rejected" : "failed";
  const allParts = [
    ...task.history.flatMap((message) => message.parts.map(mapPart)),
    ...(task.status?.message?.parts ?? []).map(mapPart),
    ...task.artifacts.flatMap((artifact) => artifact.parts.map((part) => ({ ...mapPart(part), ...artifactPartMetadata(artifact) }))),
  ];
  const outputParts = task.artifacts.flatMap((artifact) => artifact.parts.map((part) => ({ ...mapPart(part), ...artifactPartMetadata(artifact) })));
  const envelope = outputParts.find((part) => part.kind === "data" && isTypedEnvelope(part.data));
  const files = outputParts.filter((part) => part.kind === "file" && typeof part.slotId === "string");
  const output = envelope && isTypedEnvelope(envelope.data) ? envelope.data : undefined;
  const result = output
    ? { event: output.event, data: output.data, ...(files.length ? { artifacts: Object.fromEntries(files.map((part) => [part.slotId, part])) } : {}) }
    : undefined;
  const teamTask = metadata(metadata(task.metadata)[TEAM_IR_METADATA]);
  return {
    id: task.id,
    status,
    ...(allParts.length ? { messageParts: allParts } : {}),
    ...(teamTask.requestedInputSchema === undefined ? {} : { requestedInputSchema: teamTask.requestedInputSchema }),
    ...(result ? { result } : {}),
    ...(TERMINAL_FAILURE_STATES.has(state ?? TaskState.UNRECOGNIZED) ? { errorCode: `A2A_TASK_STATE_${state}` } : {}),
  };
}

function artifactPartMetadata(artifact: Artifact): Record<string, unknown> {
  const teamMetadata = metadata(metadata(artifact.metadata)[TEAM_IR_METADATA]);
  return typeof teamMetadata.slotId === "string" ? { slotId: teamMetadata.slotId } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTypedEnvelope(value: unknown): value is { event: string; data: unknown } {
  return isRecord(value) && typeof value.event === "string" && Object.prototype.hasOwnProperty.call(value, "data");
}

function toSdkPart(part: TeamA2AMessagePart): Part {
  if (part.kind === "data") return {
    content: { $case: "data", value: part.data }, mediaType: part.mediaType, filename: "", metadata: undefined,
  };
  return {
    content: { $case: "raw", value: Buffer.from(part.bytesBase64, "base64") },
    mediaType: part.mediaType,
    filename: part.name,
    metadata: { [TEAM_IR_METADATA]: { slotId: part.name } },
  };
}

function toRemote(result: Task | Message): TeamA2ARemoteTask {
  if ("status" in result) return mapTask(result);
  return {
    id: result.taskId || result.messageId,
    status: "completed",
    messageParts: result.parts.map(mapPart),
    ...(result.parts.map((part) => part.content?.$case === "data" ? part.content.value : undefined).find(isTypedEnvelope)
      ? { result: result.parts.map((part) => part.content?.$case === "data" ? part.content.value : undefined).find(isTypedEnvelope) }
      : {}),
  };
}

export function createTeamA2AHttpClient(options: TeamA2AHttpClientOptions): TeamA2AClient {
  const endpoint = normalizeEndpoint(options.endpoint);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const trustedFetch = makeTrustedFetch(endpoint.origin, options.authorization, options.headers ?? {}, fetchImpl);
  const resolver = new DefaultAgentCardResolver({ path: options.cardPath, fetchImpl: trustedFetch });
  const transports = [new JsonRpcTransportFactory({ fetchImpl: trustedFetch }), new RestTransportFactory({ fetchImpl: trustedFetch })];
  let clientPromise: ReturnType<ClientFactory["createFromUrl"]> | undefined;
  const getClient = () => clientPromise ??= new ClientFactory({
    transports,
    cardResolver: resolver,
    preferredTransports: options.protocolBinding ? [options.protocolBinding] : ["HTTP+JSON", "JSONRPC"],
    clientConfig: { polling: true, acceptedOutputModes: options.acceptedOutputModes ?? ["application/json"] },
  }).createFromUrl(endpoint.toString(), options.cardPath);

  return Object.freeze({
    async getAgentCard() {
      try { return asTeamCard(await (await getClient()).getAgentCard(), options.protocolBinding); }
      catch (error) { throw sanitizedError(error); }
    },
    async sendMessage(input: Parameters<TeamA2AClient["sendMessage"]>[0]) {
      try {
        const client = await getClient();
        const message: Message = {
          messageId: input.messageId,
          contextId: "",
          taskId: "",
          role: Role.ROLE_USER,
          parts: input.parts.map(toSdkPart),
          metadata: { [TEAM_IR_METADATA]: { idempotencyKey: input.idempotencyKey } },
          extensions: [],
          referenceTaskIds: [],
        };
        return toRemote(await client.sendMessage({
          tenant: "",
          message,
          configuration: { acceptedOutputModes: options.acceptedOutputModes ?? ["application/json"], taskPushNotificationConfig: undefined, returnImmediately: true },
          metadata: { [TEAM_IR_METADATA]: { idempotencyKey: input.idempotencyKey } },
        }));
      } catch (error) { throw sanitizedError(error); }
    },
    async getTask(taskId: string) {
      try { return mapTask(await (await getClient()).getTask({ tenant: "", id: taskId })); }
      catch (error) { throw sanitizedError(error); }
    },
    async cancelTask(taskId: string) {
      try {
        const task = await (await getClient()).cancelTask({ tenant: "", id: taskId, metadata: undefined });
        return task.status?.state === TaskState.TASK_STATE_CANCELED;
      } catch (error) { throw sanitizedError(error); }
    },
  });
}
