export type StateReducerName = "replace" | "merge" | "append" | "increment" | "max" | "set-once";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function applyStateReducer(name: StateReducerName, current: unknown, candidate: unknown): unknown {
  switch (name) {
    case "replace":
      return clone(candidate);
    case "merge":
      if (!isObject(current) || !isObject(candidate)) throw new Error("merge requires object values");
      return { ...clone(current), ...clone(candidate) };
    case "append":
      if (!Array.isArray(current)) throw new Error("append requires an array state");
      return [...clone(current), clone(candidate)];
    case "increment":
      if (typeof current !== "number" || typeof candidate !== "number" || !Number.isFinite(current) || !Number.isFinite(candidate)) {
        throw new Error("increment requires finite numeric values");
      }
      return current + candidate;
    case "max":
      if (typeof current !== "number" || typeof candidate !== "number" || !Number.isFinite(current) || !Number.isFinite(candidate)) {
        throw new Error("max requires finite numeric values");
      }
      return Math.max(current, candidate);
    case "set-once":
      return current === undefined || current === null ? clone(candidate) : clone(current);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
