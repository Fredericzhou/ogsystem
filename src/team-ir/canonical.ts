import { createHash } from "node:crypto";

export type TeamIRJsonValue = null | boolean | number | string | TeamIRJsonValue[] | { [key: string]: TeamIRJsonValue };

function normalizeValue(value: unknown, path: string, ancestors: Set<object>): TeamIRJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must be a finite JSON number`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not a JSON value`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new TypeError(`${path} contains a non-JSON array property`);
        }
      }
      const normalized: TeamIRJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`${path}[${index}] must be a present JSON array value`);
        }
        normalized.push(normalizeValue(descriptor.value, `${path}[${index}]`, ancestors));
      }
      return normalized;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain JSON object`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) throw new TypeError(`${path} contains a symbol key`);

    const normalized: Record<string, TeamIRJsonValue> = {};
    for (const key of (ownKeys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${path}.${key} must be an enumerable JSON data property`);
      }
      normalized[key] = normalizeValue(descriptor.value, `${path}.${key}`, ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

/** Normalize semantic Team IR JSON, excluding the root presentation-only field. */
export function canonicalizeTeamIR(teamIR: unknown): TeamIRJsonValue {
  if (!teamIR || typeof teamIR !== "object" || Array.isArray(teamIR)) {
    throw new TypeError("Team IR root must be an object");
  }
  const prototype = Object.getPrototypeOf(teamIR);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Team IR root must be a plain JSON object");

  const root = teamIR as Record<string, unknown>;
  const semanticRoot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(root)) {
    if (typeof key !== "string") throw new TypeError("Team IR root contains a symbol key");
    if (key === "presentation") continue;
    const descriptor = Object.getOwnPropertyDescriptor(root, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`Team IR root.${key} must be an enumerable JSON data property`);
    }
    semanticRoot[key] = descriptor.value;
  }
  return normalizeValue(semanticRoot, "$", new Set());
}

export function serializeCanonicalTeamIR(teamIR: unknown): string {
  return JSON.stringify(canonicalizeTeamIR(teamIR));
}

export function teamIRSemanticDigest(teamIR: unknown): string {
  return createHash("sha256").update(serializeCanonicalTeamIR(teamIR), "utf8").digest("hex");
}
