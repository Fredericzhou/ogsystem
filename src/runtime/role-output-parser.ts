import type {
  RoleExecutionOutput,
  RoleOutputRepairRecord
} from "./types.js";

function extractJsonObjectCandidate(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  const start = raw.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (character === "\\") {
        escaping = true;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1).trim();
      }
    }
  }

  return undefined;
}

export function parseRoleExecutionOutputWithRepair(args: {
  rawOutput: string;
  requireEvent: boolean;
}): { output: RoleExecutionOutput; repair?: RoleOutputRepairRecord } {
  const trimmed = args.rawOutput.trim();
  if (!trimmed) {
    throw new Error("Executable role output is empty; expected JSON object");
  }

  let parsed: unknown;
  let repair: RoleOutputRepairRecord | undefined;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const candidate = extractJsonObjectCandidate(trimmed);
    if (candidate && candidate !== trimmed) {
      try {
        parsed = JSON.parse(candidate);
        repair = {
          kind: "invalid_json",
          attempted: true,
          applied: true,
          strategy: "extract_json_object",
          detail: "Recovered JSON object from wrapped stdout"
        };
      } catch {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Executable role output must be valid JSON: ${message}`);
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Executable role output must be valid JSON: ${message}`);
    }
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

  const output: RoleExecutionOutput = {};
  if (record.event !== undefined) {
    if (typeof record.event !== "string" || !record.event.trim()) {
      throw new Error('Executable role output field "event" must be a non-empty string');
    }
    output.event = record.event.trim();
  }
  if (record.content !== undefined) {
    if (typeof record.content !== "string") {
      throw new Error('Executable role output field "content" must be a string');
    }
    output.content = record.content;
  }
  if (record.data !== undefined) {
    if (typeof record.data !== "object" || record.data === null || Array.isArray(record.data)) {
      throw new Error('Executable role output field "data" must be an object');
    }
    output.data = record.data as Record<string, unknown>;
  }
  if (args.requireEvent && !output.event) {
    throw new Error('Executable role output must include "event" for roles with outgoing flows');
  }

  return {
    output,
    repair
  };
}

export function repairUnknownEvent(args: {
  output: RoleExecutionOutput;
  allowedEvents: string[];
}): RoleOutputRepairRecord | undefined {
  if (args.allowedEvents.length !== 1) {
    return undefined;
  }
  const [onlyAllowedEvent] = args.allowedEvents;
  if (args.output.event === onlyAllowedEvent) {
    return undefined;
  }

  args.output.event = onlyAllowedEvent;
  return {
    kind: "unknown_event",
    attempted: true,
    applied: true,
    strategy: "single_allowed_event",
    detail: `Normalized event to the only allowed transition "${onlyAllowedEvent}"`
  };
}

export function assertNoReservedErrorEventFromRoleOutput(args: {
  roleId: string;
  event?: string;
}): void {
  if (!args.event) {
    return;
  }
  if (!args.event.startsWith("ERROR")) {
    return;
  }
  throw new Error(
    `Executable role output event "${args.event}" uses reserved prefix "ERROR*"; runtime-only failure routing must trigger it`
  );
}

export function mergeRepairRecord(
  left?: RoleOutputRepairRecord,
  right?: RoleOutputRepairRecord
): RoleOutputRepairRecord | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return {
    kind: right.kind,
    attempted: left.attempted || right.attempted,
    applied: left.applied || right.applied,
    strategy: `${left.strategy},${right.strategy}`,
    detail: `${left.detail}; ${right.detail}`
  };
}

export function inferCorrectionReason(message: string): RoleOutputRepairRecord["kind"] | undefined {
  if (
    /valid JSON/i.test(message) ||
    /JSON object/i.test(message) ||
    /unsupported field/i.test(message)
  ) {
    return "invalid_json";
  }
  if (/does not match schema/i.test(message)) {
    return "schema_mismatch";
  }
  if (/does not match any outgoing flow/i.test(message)) {
    return "unknown_event";
  }
  return undefined;
}

export function buildCorrectionRequest(args: {
  roleId: string;
  message: string;
  rawOutput?: string;
  allowedEvents: string[];
  schemaPath?: string;
}) {
  const reason = inferCorrectionReason(args.message);
  if (!reason || !args.rawOutput?.trim()) {
    return undefined;
  }

  return {
    roleId: args.roleId,
    reason,
    rawOutput: args.rawOutput,
    allowedEvents: args.allowedEvents,
    schemaPath: args.schemaPath,
    detail: args.message
  };
}
