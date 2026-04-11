import type { Flow, UserProfile } from "./types.js";

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
