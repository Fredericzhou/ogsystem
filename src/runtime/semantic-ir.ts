import { createHash } from "node:crypto";
import type { SubgraphSpec } from "./subgraph.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";

export type SemanticIRValueRef =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "path"; root: "state" | "loop" | "event" | "role"; path: string[] };

export type SemanticIRConditionAst =
  | {
      op: "equals" | "in" | "greater_than" | "less_than";
      args: [SemanticIRValueRef, SemanticIRValueRef];
    }
  | { op: "exists"; args: [SemanticIRValueRef] }
  | { op: "not"; args: [SemanticIRConditionAst] }
  | { op: "all" | "any"; args: SemanticIRConditionAst[] };

export type SemanticIRJoinScopeKey = {
  runId: string;
  joinRoleId: string;
  lineageId: string;
  loopId?: string;
  loopIteration: number;
};

export type SemanticIRLoopScope = {
  loopId: string;
  members: string[];
  boundaryRoleId: string;
  counterField: string;
  maxRounds: number;
  maxRoleActivationsByRoleId?: Record<string, number>;
  onExhausted: string;
};

export type SemanticIRJoinSpec = {
  roleId: string;
  mode: "all_of" | "quorum_of";
  sources: string[];
  min: number;
  key: "run+role+lineage+loop";
  duplicateArrival: "ignore";
  lateArrival: "ignore";
  failurePolicy: "wait" | "fail" | "quorum_continue";
  timeoutSeconds: number;
  onTimeout: "fail" | "quorum_continue" | "pause" | "terminate";
};

export type SemanticIRCapabilityPolicy = {
  maxTransitionsPerRun: number;
  maxRoleActivationsByRoleId?: Record<string, number>;
  allowedToolsByRoleId: Record<string, string[]>;
};

export type SemanticIRRetryPolicy = {
  maxAttempts: number;
  backoff: "constant" | "exponential";
};

export type SemanticIR = {
  version: 1;
  system: { systemId: string; systemVersion: string };
  seats: Array<{ roleId: string; packageRef?: string; binding: unknown; modes: Record<string, unknown>; defaultMode: string }>;
  transitions: Array<{
    flowId: string;
    fromRoleId: string;
    toRoleId: string;
    eventType: string;
    condition?: SemanticIRConditionAst;
    channel: "normal" | "error" | "loop" | "join";
    priority: number;
  }>;
  stateSchema: {
    schemaVersion: number;
    ref: string;
    reducers?: Record<string, "replace" | "merge" | "append" | "increment" | "max" | "set-once">;
    defaults?: Record<string, unknown>;
    writableRolesByField?: Record<string, string[]>;
  };
  loops: SemanticIRLoopScope[];
  joins: SemanticIRJoinSpec[];
  events?: Record<string, { payloadSchema?: unknown; writableStateFields?: string[] }>;
  retryByRoleId?: Record<string, SemanticIRRetryPolicy>;
  contracts: Array<{ id: string; ref: string }>;
  subgraphs?: SubgraphSpec[];
  capabilities: SemanticIRCapabilityPolicy;
  defaults: {
    routePriority: 0;
    loopIteration: 0;
    joinDuplicateArrival: "ignore";
    joinTimeoutSeconds: 3600;
  };
};

export type SemanticIRDiagnostic = {
  code:
  | "IR_DUPLICATE_ROLE"
  | "IR_UNKNOWN_REFERENCE"
  | "IR_ROUTE_AMBIGUOUS"
  | "IR_INVALID_CONDITION"
  | "IR_JOIN_SCOPE_INVALID"
  | "IR_LOOP_UNBOUNDED"
  | "IR_BUDGET_INVALID"
  | "IR_CONTRACT_INVALID";
  message: string;
  path?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value ?? null;
}

export function semanticIRDigest(ir: SemanticIR): string {
  return createHash("sha256").update(JSON.stringify(normalize(ir))).digest("hex");
}

export function buildJoinScopeKey(value: SemanticIRJoinScopeKey): string {
  if (!value.runId || !value.joinRoleId || !value.lineageId || !Number.isInteger(value.loopIteration) || value.loopIteration < 0) {
    throw new Error("Invalid JoinScopeKey");
  }
  return JSON.stringify([
    value.runId,
    value.joinRoleId,
    value.lineageId,
    value.loopId ?? null,
    value.loopIteration
  ]);
}

export function buildJoinDisplayId(value: SemanticIRJoinScopeKey): string {
  return `${value.joinRoleId}#${value.lineageId}#${value.loopIteration}`;
}

export function validateSemanticIR(ir: SemanticIR): SemanticIRDiagnostic[] {
  const diagnostics: SemanticIRDiagnostic[] = [];
  const roleIds = new Set<string>();
  for (const [index, seat] of ir.seats.entries()) {
    if (!seat.roleId || roleIds.has(seat.roleId)) {
      diagnostics.push({ code: "IR_DUPLICATE_ROLE", message: `Duplicate or empty roleId: ${seat.roleId}`, path: `seats[${index}].roleId` });
    }
    roleIds.add(seat.roleId);
  }
  for (const [index, transition] of ir.transitions.entries()) {
    if (!roleIds.has(transition.fromRoleId) ||
      (!roleIds.has(transition.toRoleId) && transition.toRoleId !== SYSTEM_END_ROLE_ID)) {
      diagnostics.push({ code: "IR_UNKNOWN_REFERENCE", message: `Transition references an unknown role`, path: `transitions[${index}]` });
    }
    if (!Number.isInteger(transition.priority) || transition.priority < 0) {
      diagnostics.push({ code: "IR_ROUTE_AMBIGUOUS", message: `Transition priority must be a non-negative integer`, path: `transitions[${index}].priority` });
    }
  }
  for (const [index, loop] of ir.loops.entries()) {
    if (!loop.members.length || !Number.isInteger(loop.maxRounds) || loop.maxRounds <= 0 || !roleIds.has(loop.boundaryRoleId)) {
      diagnostics.push({ code: "IR_LOOP_UNBOUNDED", message: `Invalid loop scope`, path: `loops[${index}]` });
    }
    for (const roleId of loop.members) {
      if (!roleIds.has(roleId)) diagnostics.push({ code: "IR_UNKNOWN_REFERENCE", message: `Loop references unknown role ${roleId}`, path: `loops[${index}].members` });
    }
    if (loop.onExhausted !== "end" && !roleIds.has(loop.onExhausted)) {
      diagnostics.push({ code: "IR_UNKNOWN_REFERENCE", message: `Loop exhausted target is unknown: ${loop.onExhausted}`, path: `loops[${index}].onExhausted` });
    }
    for (const [roleId, limit] of Object.entries(loop.maxRoleActivationsByRoleId ?? {})) {
      if (!roleIds.has(roleId) || !Number.isInteger(limit) || limit <= 0) {
        diagnostics.push({ code: "IR_BUDGET_INVALID", message: `Invalid loop role activation budget for ${roleId}`, path: `loops[${index}].maxRoleActivationsByRoleId` });
      }
    }
  }
  for (const [index, join] of ir.joins.entries()) {
    const uniqueSources = new Set(join.sources);
    const validMin = join.mode === "all_of" ? join.min === join.sources.length : join.min >= 1 && join.min <= join.sources.length;
    if (!roleIds.has(join.roleId) || !join.sources.length || uniqueSources.size !== join.sources.length || !validMin || !Number.isInteger(join.timeoutSeconds) || join.timeoutSeconds <= 0) {
      diagnostics.push({ code: "IR_JOIN_SCOPE_INVALID", message: `Invalid join specification`, path: `joins[${index}]` });
    }
    for (const roleId of join.sources) {
      if (!roleIds.has(roleId)) diagnostics.push({ code: "IR_UNKNOWN_REFERENCE", message: `Join references unknown role ${roleId}`, path: `joins[${index}].sources` });
    }
    if (join.onTimeout === "quorum_continue" && join.mode !== "quorum_of") {
      diagnostics.push({ code: "IR_JOIN_SCOPE_INVALID", message: `quorum_continue timeout requires quorum_of`, path: `joins[${index}].onTimeout` });
    }
  }
  if (!ir.stateSchema?.ref || !Number.isInteger(ir.stateSchema.schemaVersion) || ir.stateSchema.schemaVersion <= 0) {
    diagnostics.push({ code: "IR_CONTRACT_INVALID", message: "stateSchema must include a positive schemaVersion and ref", path: "stateSchema" });
  }
  const reducerNames = new Set(["replace", "merge", "append", "increment", "max", "set-once"]);
  for (const [field, reducer] of Object.entries(ir.stateSchema.reducers ?? {})) {
    if (!field || !reducerNames.has(reducer)) {
      diagnostics.push({ code: "IR_CONTRACT_INVALID", message: `Invalid reducer for state field ${field}`, path: `stateSchema.reducers.${field}` });
    }
  }
  if (!Number.isInteger(ir.capabilities.maxTransitionsPerRun) || ir.capabilities.maxTransitionsPerRun <= 0) {
    diagnostics.push({ code: "IR_BUDGET_INVALID", message: "maxTransitionsPerRun must be positive", path: "capabilities.maxTransitionsPerRun" });
  }
  for (const [roleId, limit] of Object.entries(ir.capabilities.maxRoleActivationsByRoleId ?? {})) {
    if (!roleIds.has(roleId) || !Number.isInteger(limit) || limit <= 0) {
      diagnostics.push({ code: "IR_BUDGET_INVALID", message: `Invalid role activation budget for ${roleId}`, path: "capabilities.maxRoleActivationsByRoleId" });
    }
  }
  return diagnostics;
}
