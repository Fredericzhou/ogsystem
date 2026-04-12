import type { Flow, UserProfile } from "./types.js";

export function preview(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 400);
}

function normalizePreviewContent(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return value;
  }
  if (!normalized.startsWith("{") && !normalized.startsWith("[")) {
    return value;
  }
  try {
    return stringifyJson(JSON.parse(normalized));
  } catch {
    return value;
  }
}

export function previewStructuredStdout(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return preview(value);
    }
    const payload = parsed as Record<string, unknown>;
    const lines: string[] = [];
    if (typeof payload.event === "string" && payload.event.trim()) {
      lines.push(`event: ${payload.event.trim()}`);
    }
    if (typeof payload.content === "string" && payload.content.trim()) {
      lines.push("content:");
      lines.push(normalizePreviewContent(payload.content));
    }
    if (payload.data !== undefined) {
      lines.push("data:");
      lines.push(stringifyJson(payload.data));
    }
    if (lines.length === 0) {
      return preview(value);
    }
    return preview(lines.join("\n"));
  } catch {
    return preview(value);
  }
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
