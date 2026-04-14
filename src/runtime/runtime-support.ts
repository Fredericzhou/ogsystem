/**
 * @fileoverview Pure utility helpers for previewing/serializing runtime values.
 * File Set: runtime-support
 * Responsibilities:
 * - Produce compact previews for logs and structured stdout.
 * - Build flow adjacency/incoming lookup maps.
 * Boundaries:
 * - No filesystem, execution, or graph-state mutation.
 */
import type { Flow, UserProfile } from "./types.js";

export function preview(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 400);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return normalizeWhitespace(value).replace(/"/g, "'");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (depth >= 1) {
      return `[${value.length} items]`;
    }
    const head = value.slice(0, 3).map((item) => summarizeValue(item, depth + 1)).join(", ");
    const suffix = value.length > 3 ? ", ..." : "";
    return `[${head}${suffix}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= 1) {
      return `{${entries.length} keys}`;
    }
    const head = entries
      .slice(0, 4)
      .map(([key, item]) => `${key}:${summarizeValue(item, depth + 1)}`)
      .join("; ");
    const suffix = entries.length > 4 ? "; ..." : "";
    return `{${head}${suffix}}`;
  }
  return String(value);
}

function summarizeContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    return "";
  }
  try {
    return summarizeValue(JSON.parse(normalized));
  } catch {
    return summarizeValue(content);
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
    const parts: string[] = [];
    if (typeof payload.event === "string" && payload.event.trim()) {
      parts.push(`event=${payload.event.trim()}`);
    }
    if (typeof payload.content === "string" && payload.content.trim()) {
      parts.push(`content=${summarizeContent(payload.content)}`);
    }
    if (payload.data !== undefined) {
      parts.push(`data=${summarizeValue(payload.data)}`);
    }
    if (parts.length === 0) {
      return preview(value);
    }
    return preview(parts.join(" | "));
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
