/**
 * Tracks runtime transitions for the audit log and the lightweight transition stream.
 * Responsibilities: standardize the fields stored per role execution and write the two
 * persisted artifacts that external observers use to reconstruct graph progress.
 * Boundaries: this module never mutates the runtime state itself and relies on the upstream
 * caller to decide when an audit entry is ready. Trade-off: writes are sequential (event then
 * transition line) so a single failure may still leave the stream short, but it keeps the surface
 * area small and avoids heavy locks.
 */
import { resolve } from "node:path";

import { appendBufferedText, appendEvent } from "./run-artifacts.js";
import { preview, previewStructuredStdout } from "./runtime-support.js";
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

/**
 * Normalizes the per-transition metadata we persist so all consumers read the same shape.
 * Invariant: every record carries `durationMs`, `status`, and the same `lawRef` so downstream
 * recovery helpers can bound how long that attempt has occupied the runtime and why it failed.
 */
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
    stdoutPreview: previewStructuredStdout(args.stdout ?? ""),
    stderrPreview: preview(args.stderr ?? ""),
    error: args.error,
    errorEnvelope: args.errorEnvelope,
    repair: args.repair,
    correctionRequest: args.correctionRequest
  };
}

/**
 * Appends both the canonical audit event and the lightweight transition stream.
 * Failure semantics: the JSON event is written first so eventual recovery logic can depend on
 * the more structured record even if the markdown transition line fails to persist.
 */
export async function appendAuditRecord(runContext: RunContext, audit: AuditRecord): Promise<void> {
  // Failure window: if appending the transition markdown fails after the event is written,
  // the runtime can still rely on the persistent event log.
  await appendEvent(runContext, { type: "audit", ...audit });
  // Invariant: transition stream entry is appended after the event so readers see at least
  // the audit log even if conditional transition logging fails.
  await appendBufferedText({
    context: runContext,
    key: "transitions",
    path: resolve(runContext.auditDir, "transitions.md"),
    content: `- ${audit.roleId}: ${audit.status}${audit.selectedEvent ? ` (${audit.selectedEvent})` : ""}\n`
  });
}
