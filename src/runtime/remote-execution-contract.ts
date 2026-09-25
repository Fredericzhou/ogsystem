import type { ExecutorBinding, ExecutorResult } from "./executor.js";

export type RemoteExecutionInput = {
  prompt: string;
  schema: unknown;
  binding: ExecutorBinding;
};

export type RemoteExecutionRequest = {
  protocolVersion: 1;
  invocationId: string;
  idempotencyKey: string;
  runId: string;
  roleId: string;
  executionId: string;
  attempt: number;
  deadline: string;
  traceparent?: string;
  input: RemoteExecutionInput;
};

export type RemoteExecutionResponse = {
  protocolVersion: 1;
  invocationId: string;
  completedAt: string;
  result: ExecutorResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOptionalStringFields(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => value[field] === undefined || typeof value[field] === "string");
}

function isExecutorBinding(value: unknown): value is ExecutorBinding {
  if (!isRecord(value)) return false;
  if (value.kind === "model") {
    return typeof value.backend === "string" &&
      ["opencode", "codex", "claude", "antigravity"].includes(value.backend) &&
      typeof value.modelId === "string" && typeof value.modelRef === "string" &&
      (value.variant === undefined || typeof value.variant === "string");
  }
  if (value.kind !== "profile" || !isRecord(value.profile) || !isRecord(value.tool)) return false;
  const { profile, tool } = value;
  return typeof profile.profileId === "string" && typeof profile.toolRef === "string" &&
    (profile.timeoutMs === undefined || typeof profile.timeoutMs === "number") &&
    (profile.maxOutputBytes === undefined || typeof profile.maxOutputBytes === "number") &&
    typeof tool.toolRef === "string" && tool.runner === "local_shell" &&
    typeof tool.command === "string" && Array.isArray(tool.argsTemplate) &&
    tool.argsTemplate.every((argument) => typeof argument === "string") &&
    (tool.stdinMode === "none" || tool.stdinMode === "text");
}

export function validateRemoteExecutionRequest(value: unknown): value is RemoteExecutionRequest {
  if (!isRecord(value)) return false;
  const request = value;
  if (!isRecord(request.input)) return false;
  const input = request.input;
  return request.protocolVersion === 1 &&
    typeof request.invocationId === "string" && request.invocationId.length > 0 &&
    typeof request.idempotencyKey === "string" && request.idempotencyKey.length > 0 &&
    typeof request.runId === "string" && request.runId.length > 0 &&
    typeof request.roleId === "string" && request.roleId.length > 0 &&
    typeof request.executionId === "string" && request.executionId.length > 0 &&
    Number.isInteger(request.attempt) && Number(request.attempt) > 0 &&
    typeof request.deadline === "string" && Number.isFinite(Date.parse(request.deadline)) &&
    (request.traceparent === undefined || typeof request.traceparent === "string") &&
    typeof input.prompt === "string" && input.schema !== undefined && isExecutorBinding(input.binding);
}

export function validateRemoteExecutionResponse(value: unknown, invocationId: string): value is RemoteExecutionResponse {
  if (!isRecord(value) || !isRecord(value.result)) return false;
  const response = value as Record<string, unknown>;
  const result = response.result as Record<string, unknown>;
  return response.protocolVersion === 1 && response.invocationId === invocationId &&
    typeof response.completedAt === "string" && Number.isFinite(Date.parse(response.completedAt)) &&
    Number.isInteger(result.exitCode) && typeof result.stdout === "string" &&
    typeof result.stderr === "string" && Array.isArray(result.args) &&
    result.args.every((argument) => typeof argument === "string") &&
    hasOptionalStringFields(result, ["sessionId", "messageId", "modelId", "backend", "profileId", "toolRef", "command"]) &&
    (result.serverPid === undefined || typeof result.serverPid === "number");
}
