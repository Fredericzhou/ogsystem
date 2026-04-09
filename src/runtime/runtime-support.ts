import type { Flow, RoleExecutionOutput, UserProfile } from "./types.js";

export function preview(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 400);
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function renderUserProfile(userProfile?: UserProfile): string {
  if (!userProfile) {
    return "";
  }
  return stringifyJson(userProfile);
}

export function buildAdjacency(flows: Flow[]): Map<string, Flow[]> {
  const map = new Map<string, Flow[]>();
  for (const flow of flows) {
    const list = map.get(flow.fromRoleId) ?? [];
    list.push(flow);
    map.set(flow.fromRoleId, list);
  }
  return map;
}

export function buildIncoming(flows: Flow[]): Map<string, Flow[]> {
  const map = new Map<string, Flow[]>();
  for (const flow of flows) {
    const list = map.get(flow.toRoleId) ?? [];
    list.push(flow);
    map.set(flow.toRoleId, list);
  }
  return map;
}

export function parseRoleExecutionOutput(
  output: string,
  options: { requireEvent: boolean }
): RoleExecutionOutput {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Executable role output is empty; expected JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Executable role output must be valid JSON: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Executable role output must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const allowedKeys = new Set(["event", "content", "data"]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Executable role output contains unsupported field "${key}"`);
    }
  }

  const result: RoleExecutionOutput = {};
  if (record.event !== undefined) {
    if (typeof record.event !== "string" || !record.event.trim()) {
      throw new Error('Executable role output field "event" must be a non-empty string');
    }
    result.event = record.event;
  }
  if (record.content !== undefined) {
    if (typeof record.content !== "string") {
      throw new Error('Executable role output field "content" must be a string');
    }
    result.content = record.content;
  }
  if (record.data !== undefined) {
    if (typeof record.data !== "object" || record.data === null || Array.isArray(record.data)) {
      throw new Error('Executable role output field "data" must be an object');
    }
    result.data = record.data as Record<string, unknown>;
  }
  if (options.requireEvent && !result.event) {
    throw new Error('Executable role output must include "event" for roles with outgoing flows');
  }

  return result;
}
