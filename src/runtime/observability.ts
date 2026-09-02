import { createHash } from "node:crypto";

export type OgsCloudEvent = {
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string;
  datacontenttype: "application/json";
  data?: unknown;
  ogs: {
    runId: string;
    systemId: string;
    systemVersion: string;
    irDigest?: string;
    roleId?: string;
    branchId?: string;
    lineageId?: string;
    loopIteration?: number;
    payloadDigest?: string;
  };
};

export type OgsSpanProjection = {
  traceId: string;
  spanId: string;
  name: string;
  startTime: string;
  endTime?: string;
  attributes: Record<string, string | number | boolean>;
  status: "UNSET" | "OK" | "ERROR";
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export function toOgsCloudEvent(args: {
  id: string;
  type: string;
  source?: string;
  time?: string;
  subject?: string;
  runId: string;
  systemId: string;
  systemVersion: string;
  irDigest?: string;
  roleId?: string;
  branchId?: string;
  lineageId?: string;
  loopIteration?: number;
  data?: unknown;
}): OgsCloudEvent {
  if (!args.id || !args.type || !args.runId || !args.systemId || !args.systemVersion) {
    throw new Error("CloudEvent id, type, runId, systemId, and systemVersion are required");
  }
  return {
    specversion: "1.0",
    id: args.id,
    source: args.source ?? "ogs://runtime",
    type: args.type,
    time: args.time ?? new Date().toISOString(),
    ...(args.subject ? { subject: args.subject } : {}),
    datacontenttype: "application/json",
    ...(args.data === undefined ? {} : { data: structuredClone(args.data) }),
    ogs: {
      runId: args.runId,
      systemId: args.systemId,
      systemVersion: args.systemVersion,
      ...(args.irDigest ? { irDigest: args.irDigest } : {}),
      ...(args.roleId ? { roleId: args.roleId } : {}),
      ...(args.branchId ? { branchId: args.branchId } : {}),
      ...(args.lineageId ? { lineageId: args.lineageId } : {}),
      ...(args.loopIteration === undefined ? {} : { loopIteration: args.loopIteration }),
      ...(args.data === undefined ? {} : { payloadDigest: digest(args.data) })
    }
  };
}

export function projectOgsSpan(args: {
  traceId: string;
  spanId: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  runId: string;
  roleId?: string;
  branchId?: string;
  lineageId?: string;
  loopIteration?: number;
  status?: "UNSET" | "OK" | "ERROR";
}): OgsSpanProjection {
  if (!args.traceId || !args.spanId || !args.name || !args.runId) throw new Error("traceId, spanId, name, and runId are required");
  return {
    traceId: args.traceId,
    spanId: args.spanId,
    name: args.name,
    startTime: args.startedAt,
    ...(args.endedAt ? { endTime: args.endedAt } : {}),
    attributes: {
      "ogs.run_id": args.runId,
      ...(args.roleId ? { "ogs.role_id": args.roleId } : {}),
      ...(args.branchId ? { "ogs.branch_id": args.branchId } : {}),
      ...(args.lineageId ? { "ogs.lineage_id": args.lineageId } : {}),
      ...(args.loopIteration === undefined ? {} : { "ogs.loop_iteration": args.loopIteration })
    },
    status: args.status ?? "UNSET"
  };
}
