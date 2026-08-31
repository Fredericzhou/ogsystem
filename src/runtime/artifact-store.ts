/**
 * Runtime artifact persistence port.
 *
 * The filesystem implementation deliberately delegates to the legacy artifact writer for now.
 * This keeps the on-disk contract stable while callers depend on a small ownership boundary.
 */
import {
  allocateRoleExecution,
  appendBufferedText,
  appendEvent,
  buildRoleSessionKey,
  flushBufferedRunArtifacts,
  getRoleSession,
  persistRoleExecutionOutcome,
  persistRolePrelude,
  persistRoleResult,
  persistRoleSession,
  resolvePrivateWorkspaceDir
} from "./run-artifacts.js";
import type { RunContext, RoleExecutionOutcomeRecord, RoleExecutionRecord } from "./types.js";

export type ArtifactStore = {
  allocateExecution: typeof allocateRoleExecution;
  buildSessionKey: typeof buildRoleSessionKey;
  resolvePrivateWorkspace: typeof resolvePrivateWorkspaceDir;
  getSession: typeof getRoleSession;
  persistSession: typeof persistRoleSession;
  persistPrelude: typeof persistRolePrelude;
  persistResult: typeof persistRoleResult;
  persistExecutionOutcome: typeof persistRoleExecutionOutcome;
  appendEvent: typeof appendEvent;
  appendText: typeof appendBufferedText;
  flush: typeof flushBufferedRunArtifacts;
};

export const filesystemArtifactStore: ArtifactStore = {
  allocateExecution: allocateRoleExecution,
  buildSessionKey: buildRoleSessionKey,
  resolvePrivateWorkspace: resolvePrivateWorkspaceDir,
  getSession: getRoleSession,
  persistSession: persistRoleSession,
  persistPrelude: persistRolePrelude,
  persistResult: persistRoleResult,
  persistExecutionOutcome: persistRoleExecutionOutcome,
  appendEvent,
  appendText: appendBufferedText,
  flush: flushBufferedRunArtifacts
};

export type { RoleExecutionOutcomeRecord, RoleExecutionRecord, RunContext };
