export type EventContract = {
  eventType: string;
  payloadSchema?: unknown;
  writableStateFields?: string[];
};

export type EventValidationResult = {
  eventType: string;
  payloadDigest: string;
  payload: unknown;
};

import { createHash } from "node:crypto";
import { listJsonSchemaIssues } from "./json-schema.js";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function validateBasicSchema(payload: unknown, schema: unknown): void {
  if (!schema || typeof schema !== "object") return;
  const issues = listJsonSchemaIssues({ schema, data: payload });
  if (issues.length > 0) throw new Error("Event payload schema mismatch: " + issues.map((issue) => issue.path + " " + issue.message).join("; "));
}

/** Validates an adapter event against the currently selected role mode contract. */
export function validateEventCandidate(args: {
  roleId: string;
  mode: string;
  eventType: string;
  payload: unknown;
  contracts: Record<string, EventContract>;
  allowedStateUpdates?: string[];
  stateUpdateFields?: string[];
}): EventValidationResult {
  const contract = args.contracts[args.eventType];
  if (!contract) throw new Error(`Event ${args.eventType} is not declared for role ${args.roleId} mode ${args.mode}`);
  validateBasicSchema(args.payload, contract.payloadSchema);
  const allowed = new Set(contract.writableStateFields ?? args.allowedStateUpdates ?? []);
  for (const field of args.stateUpdateFields ?? []) {
    if (!allowed.has(field)) throw new Error(`Event ${args.eventType} cannot update state field ${field}`);
  }
  return { eventType: args.eventType, payloadDigest: digest(args.payload), payload: structuredClone(args.payload) };
}
