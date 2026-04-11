import { resolve } from "node:path";

import { appendBufferedText, appendEvent } from "./run-artifacts.js";
import { preview } from "./runtime-support.js";
import type {
  AuditRecord,
  RoleOutputCorrectionRequest,
  RoleOutputRepairRecord,
  RuntimeErrorEnvelope,
  RunContext
} from "./types.js";

type AuditRecordInput = {
  roleId: string;
  branchId?: string;
  joinId?: string;
  loopIteration?: number;
  lawRef: string;
  started: number;
  status: AuditRecord["status"];
  modelId?: string;
  profileId?: string;
  toolRef?: string;
  command?: string;
  resultArgs?: string[];
  sessionId?: string;
  messageId?: string;
  serverPid?: number;
  exitCode: number;
  selectedEvent?: string;
  nextRoleId?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  errorEnvelope?: RuntimeErrorEnvelope;
  repair?: RoleOutputRepairRecord;
  correctionRequest?: RoleOutputCorrectionRequest;
};

export function createAuditRecord(args: AuditRecordInput): AuditRecord {
  return {
    at: new Date().toISOString(),
    roleId: args.roleId,
    branchId: args.branchId,
    joinId: args.joinId,
    loopIteration: args.loopIteration,
    lawRef: args.lawRef,
    modelId: args.modelId,
    profileId: args.profileId,
    toolRef: args.toolRef,
    command: args.command,
    args: args.resultArgs,
    sessionId: args.sessionId,
    messageId: args.messageId,
    serverPid: args.serverPid,
    exitCode: args.exitCode,
    durationMs: Date.now() - args.started,
    selectedEvent: args.selectedEvent,
    nextRoleId: args.nextRoleId,
    status: args.status,
    stdoutPreview: preview(args.stdout ?? ""),
    stderrPreview: preview(args.stderr ?? ""),
    error: args.error,
    errorEnvelope: args.errorEnvelope,
    repair: args.repair,
    correctionRequest: args.correctionRequest
  };
}

export async function appendAuditRecord(runContext: RunContext, audit: AuditRecord): Promise<void> {
  await appendEvent(runContext, { type: "audit", ...audit });
  await appendBufferedText({
    context: runContext,
    key: "transitions",
    path: resolve(runContext.auditDir, "transitions.md"),
    content: `- ${audit.roleId}: ${audit.status}${audit.selectedEvent ? ` (${audit.selectedEvent})` : ""}\n`
  });
}
