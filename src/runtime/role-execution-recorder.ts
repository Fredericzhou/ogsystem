import { appendAuditRecord } from "./audit-recorder.js";
import {
  persistRoleExecutionOutcome,
  persistRolePrelude,
  persistRoleResult,
  persistRoleSession
} from "./run-artifacts.js";
import type {
  AuditRecord,
  BranchRecord,
  RoleExecutionOutcomeRecord,
  RoleExecutionOutput,
  RoleExecutionRecord,
  RuntimeErrorEnvelope,
  RunContext,
  StoredRoleResult
} from "./types.js";

export type PersistedRoleExecutorResult =
  | {
      status: "ok" | "noop";
      audit: AuditRecord;
      storedResult?: StoredRoleResult;
      selectedEvent?: string;
      executionId: string;
      branchId: string;
      loopIteration: number;
    }
  | {
      status: "failed";
      error: string;
      failure: RuntimeErrorEnvelope;
      audit: AuditRecord;
      executionId: string;
      branchId: string;
      loopIteration: number;
    };

function buildRoleExecutionOutcome(args: {
  execution: RoleExecutionRecord;
  branch: BranchRecord;
  result: PersistedRoleExecutorResult;
}): RoleExecutionOutcomeRecord {
  const committedAt = new Date().toISOString();
  if (args.result.status === "failed") {
    return {
      version: 1,
      executionId: args.result.executionId,
      roleId: args.execution.roleId,
      branchId: args.result.branchId,
      loopIteration: args.result.loopIteration,
      sessionKey: args.execution.sessionKey,
      branch: args.branch,
      committedAt,
      status: "failed",
      error: args.result.error,
      failure: args.result.failure,
      audit: args.result.audit
    };
  }
  return {
    version: 1,
    executionId: args.result.executionId,
    roleId: args.execution.roleId,
    branchId: args.result.branchId,
    loopIteration: args.result.loopIteration,
    sessionKey: args.execution.sessionKey,
    branch: args.branch,
    committedAt,
    status: args.result.status,
    selectedEvent: args.result.selectedEvent,
    storedResult: args.result.storedResult,
    audit: args.result.audit
  };
}

export async function persistCommittedExecutionResult(args: {
  execution: RoleExecutionRecord;
  branch: BranchRecord;
  result: PersistedRoleExecutorResult;
}): Promise<RoleExecutionOutcomeRecord> {
  const outcome = buildRoleExecutionOutcome(args);
  await persistRoleExecutionOutcome({
    execution: args.execution,
    outcome
  });
  return outcome;
}

export async function recordRolePrelude(args: Parameters<typeof persistRolePrelude>[0]): Promise<void> {
  await persistRolePrelude(args);
}

export async function recordRoleResult(args: {
  roleId: string;
  context: RunContext;
  execution: RoleExecutionRecord;
  output?: RoleExecutionOutput;
  audit: AuditRecord;
}): Promise<void> {
  await persistRoleResult(args);
}

export async function recordRoleSession(args: Parameters<typeof persistRoleSession>[0]): Promise<void> {
  await persistRoleSession(args);
}

export async function recordAudit(args: {
  context: RunContext;
  audit: AuditRecord;
}): Promise<void> {
  await appendAuditRecord(args.context, args.audit);
}
