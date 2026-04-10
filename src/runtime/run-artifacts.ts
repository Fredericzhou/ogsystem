import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";

import { readJsonFile, writeTextFileAtomic } from "./json-file.js";
import { createRuntimeError } from "./runtime-errors.js";
import type {
  AuditRecord,
  GraphState,
  OpencodeSessionRecord,
  RoleExecutionOutput,
  RoleExecutionRecord,
  RoleRunDirs,
  RuntimeCheckpointRecord,
  RunContext,
  RuntimeConfig,
  SystemDefinition
} from "./types.js";
import { stringifyJson } from "./runtime-support.js";

export const RUN_PLAN_FINGERPRINT_FILE = "plan-fingerprint.json";
const BUFFER_RECOVERY_DIR = ".buffer-recovery";

export type RunPlanFingerprint = {
  version: number;
  algorithm: "sha256";
  digest: string;
  payload: Record<string, unknown>;
};

type BufferedAppendBatch = {
  key: string;
  path: string;
  content: string;
};

type BufferedAppendState = {
  pendingByKey: Map<string, BufferedAppendBatch>;
  flushPromise?: Promise<void>;
};

const bufferedAppendStateByRunDir = new Map<string, BufferedAppendState>();

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "run";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function timestampForPath(date: Date): string {
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`
  ].join("_");
}

function runCodeForPath(systemId: string): string {
  const compact = slugify(systemId).replace(/-/g, "");
  return (compact || "run").slice(0, 4).padEnd(4, "x");
}

function buildRunDirectoryName(createdAt: Date, systemId: string): string {
  return `${timestampForPath(createdAt)}_${runCodeForPath(systemId)}`;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

function resolveSharedDir(args: {
  runDir: string;
  workdir: string;
  runtimeConfig: RuntimeConfig;
}): string {
  if (!args.runtimeConfig.sharedDir) {
    return resolve(args.runDir, "shared");
  }
  return resolve(args.workdir, args.runtimeConfig.sharedDir);
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await pathExists(path)) {
    return;
  }
  await writeFile(path, content, "utf8");
}

export async function writeAtomicFile(path: string, content: string): Promise<void> {
  await writeTextFileAtomic(path, content);
}

function getBufferedAppendState(runDir: string): BufferedAppendState {
  const existing = bufferedAppendStateByRunDir.get(runDir);
  if (existing) {
    return existing;
  }
  const created: BufferedAppendState = {
    pendingByKey: new Map()
  };
  bufferedAppendStateByRunDir.set(runDir, created);
  return created;
}

async function writeBufferedAppendRecovery(
  runDir: string,
  batch: BufferedAppendBatch
): Promise<void> {
  const recoveryDir = resolve(runDir, BUFFER_RECOVERY_DIR);
  await mkdir(recoveryDir, { recursive: true });
  await writeAtomicFile(
    resolve(recoveryDir, `${Date.now()}-${randomUUID()}.json`),
    stringifyJson(batch)
  );
}

async function replayBufferedAppendRecovery(runDir: string): Promise<void> {
  const recoveryDir = resolve(runDir, BUFFER_RECOVERY_DIR);
  if (!(await directoryExists(recoveryDir))) {
    return;
  }

  const entries = await readdir(recoveryDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const recoveryPath = resolve(recoveryDir, file);
    const payload = await readJsonFile(recoveryPath);
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      typeof (payload as BufferedAppendBatch).path !== "string" ||
      typeof (payload as BufferedAppendBatch).content !== "string"
    ) {
      await rm(recoveryPath, { force: true });
      continue;
    }

    const batch = payload as BufferedAppendBatch;
    await appendFile(batch.path, batch.content, "utf8");
    await rm(recoveryPath, { force: true });
  }
}

function isFingerprintRecord(value: unknown): value is RunPlanFingerprint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "number" &&
    record.algorithm === "sha256" &&
    typeof record.digest === "string" &&
    typeof record.payload === "object" &&
    record.payload !== null &&
    !Array.isArray(record.payload)
  );
}

async function restoreRoleExecutionCount(executionsDir: string): Promise<number> {
  if (!(await directoryExists(executionsDir))) {
    return 0;
  }
  const entries = await readdir(executionsDir, { withFileTypes: true });
  return entries.reduce((max, entry) => {
    if (!entry.isDirectory()) {
      return max;
    }
    const value = Number.parseInt(entry.name.slice(0, 4), 10);
    if (!Number.isFinite(value)) {
      return max;
    }
    return Math.max(max, value);
  }, 0);
}

async function restoreCheckpointSequence(checkpointsDir: string): Promise<number> {
  if (!(await directoryExists(checkpointsDir))) {
    return 1;
  }
  const entries = await readdir(checkpointsDir, { withFileTypes: true });
  return (
    entries.reduce((max, entry) => {
      if (!entry.isFile()) {
        return max;
      }
      const value = Number.parseInt(entry.name.slice(0, 6), 10);
      if (!Number.isFinite(value)) {
        return max;
      }
      return Math.max(max, value + 1);
    }, 1) || 1
  );
}

function buildExecutionId(executionIndex: number, startedAt: string): string {
  return `${String(executionIndex).padStart(4, "0")}-${startedAt.replace(/[:.]/g, "-")}`;
}

function buildCheckpointFileName(sequence: number, executionId: string): string {
  return `${String(sequence).padStart(6, "0")}-${executionId}.json`;
}

async function persistSessionSnapshot(context: RunContext): Promise<void> {
  await writeAtomicFile(
    context.sessionsPath,
    stringifyJson(
      Array.from(context.sessionRecordsByRoleId.values()).sort((left, right) =>
        left.roleId.localeCompare(right.roleId)
      )
    )
  );
}

async function writeRoleExecutionFiles(args: {
  roleDirs: RoleRunDirs;
  execution: RoleExecutionRecord;
  files: Array<{ path: string; content: string }>;
}): Promise<void> {
  await mkdir(args.execution.executionDir, { recursive: true });
  await Promise.all(
    args.files.flatMap((entry) => [
      writeFile(resolve(args.roleDirs.roleDir, entry.path), entry.content, "utf8"),
      writeFile(resolve(args.execution.executionDir, entry.path), entry.content, "utf8")
    ])
  );
}

export async function initializeRunContext(args: {
  system: SystemDefinition;
  systemPath: string;
  prompt: string;
  workdir: string;
  runtimeConfig: RuntimeConfig;
  resumeRunDir?: string;
}): Promise<RunContext> {
  const createdAt = new Date();
  const runDir = args.resumeRunDir
    ? resolve(args.workdir, args.resumeRunDir)
    : resolve(
        args.workdir,
        args.runtimeConfig.runsDir,
        buildRunDirectoryName(createdAt, args.system.systemId)
      );
  const runId = basename(runDir);
  const auditDir = resolve(runDir, "audit");
  const checkpointsDir = resolve(runDir, "checkpoints");
  const rolesRootDir = resolve(runDir, args.runtimeConfig.workspace.rolesDir);
  const sharedDir = resolveSharedDir({
    runDir,
    workdir: args.workdir,
    runtimeConfig: args.runtimeConfig
  });
  const roleDirsById = new Map<string, RoleRunDirs>();
  const roleExecutionCounts = new Map<string, number>();

  await mkdir(auditDir, { recursive: true });
  await mkdir(checkpointsDir, { recursive: true });
  await mkdir(rolesRootDir, { recursive: true });
  await mkdir(sharedDir, { recursive: true });

  const sourceSystem = await readFile(args.systemPath, "utf8");
  await writeIfMissing(resolve(runDir, "request.md"), `${args.prompt}\n`);
  await writeIfMissing(resolve(runDir, "system.mmd"), sourceSystem);
  await writeIfMissing(
    resolve(runDir, "run.md"),
    [
      `# Run ${runId}`,
      "",
      `- systemId: ${args.system.systemId}`,
      `- systemVersion: ${args.system.systemVersion}`,
      `- entryRoleId: ${args.system.entryRoleId}`,
      `- sharedDir: ${sharedDir}`
    ].join("\n")
  );
  await writeIfMissing(resolve(auditDir, "summary.md"), "# Audit Summary\n");
  await writeIfMissing(resolve(auditDir, "transitions.md"), "# Transitions\n");
  await writeIfMissing(
    resolve(sharedDir, "README.md"),
    [
      "# Shared Workspace",
      "",
      "Run-shared writable workspace.",
      "Use this for files intentionally visible to multiple roles in the same run."
    ].join("\n")
  );

  for (const roleId of args.system.roleIds) {
    const roleDir = resolve(rolesRootDir, roleId);
    const privateDir = resolve(roleDir, args.runtimeConfig.workspace.privateDirName);
    const executionsDir = resolve(roleDir, "executions");
    const sessionPath = resolve(roleDir, "session.json");
    await mkdir(privateDir, { recursive: true });
    await mkdir(executionsDir, { recursive: true });
    await writeIfMissing(
      resolve(privateDir, "README.md"),
      [
        "# Private Workspace",
        "",
        "Role-private writable workspace.",
        "Use this for scratch files, notes, and non-shared intermediate artifacts."
      ].join("\n")
    );
    roleDirsById.set(roleId, { roleDir, privateDir, executionsDir, sessionPath });
    roleExecutionCounts.set(roleId, await restoreRoleExecutionCount(executionsDir));
  }

  const sessionsPath = resolve(runDir, "sessions.json");
  let sessionRecordsByRoleId = new Map<string, OpencodeSessionRecord>();
  if (await pathExists(sessionsPath)) {
    const existing = await readJsonFile(sessionsPath);
    if (Array.isArray(existing)) {
      sessionRecordsByRoleId = new Map(
        existing
          .filter(
            (item): item is OpencodeSessionRecord =>
              typeof item === "object" &&
              item !== null &&
              !Array.isArray(item) &&
              typeof (item as OpencodeSessionRecord).roleId === "string" &&
              typeof (item as OpencodeSessionRecord).sessionId === "string"
          )
          .map((item) => [item.roleId, item])
      );
    }
  }

  await replayBufferedAppendRecovery(runDir);
  getBufferedAppendState(runDir);

  return {
    runId,
    runDir,
    auditDir,
    eventsPath: resolve(runDir, "events.ndjson"),
    statePath: resolve(runDir, "state.json"),
    metricsPath: resolve(runDir, "metrics.json"),
    opencodeServerPath: resolve(runDir, "opencode-server.json"),
    sessionsPath,
    checkpointsDir,
    roleDirsById,
    roleExecutionCounts,
    sessionRecordsByRoleId,
    nextCheckpointSequence: await restoreCheckpointSequence(checkpointsDir),
    sharedDir
  };
}

export async function loadResumeGraphState(args: {
  runDir: string;
}): Promise<GraphState> {
  const statePath = resolve(args.runDir, "state.json");
  const sessionsPath = resolve(args.runDir, "sessions.json");

  if (!(await pathExists(statePath))) {
    throw createRuntimeError({
      errorCode: "RESUME_STATE_MISSING",
      errorCategory: "state",
      message: `Missing resume state snapshot: ${statePath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }
  if (!(await pathExists(sessionsPath))) {
    throw createRuntimeError({
      errorCode: "RESUME_SESSIONS_MISSING",
      errorCategory: "state",
      message: `Missing resume session snapshot: ${sessionsPath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }

  let rawState: unknown;
  try {
    rawState = await readJsonFile(statePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createRuntimeError({
      errorCode: "RESUME_STATE_INVALID",
      errorCategory: "state",
      message: `Resume state snapshot is unreadable: ${statePath} (${message})`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }
  if (
    typeof rawState !== "object" ||
    rawState === null ||
    Array.isArray(rawState) ||
    !("graphState" in rawState)
  ) {
    throw createRuntimeError({
      errorCode: "RESUME_STATE_INVALID",
      errorCategory: "state",
      message: `Resume state snapshot is missing graphState: ${statePath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }

  const graphState = (rawState as { graphState?: GraphState }).graphState;
  if (
    typeof graphState !== "object" ||
    graphState === null ||
    Array.isArray(graphState)
  ) {
    throw createRuntimeError({
      errorCode: "RESUME_STATE_INVALID",
      errorCategory: "state",
      message: `Resume state snapshot contains an invalid graphState: ${statePath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }
  if (
    typeof graphState.userPrompt !== "string" ||
    typeof graphState.status !== "string" ||
    typeof graphState.error !== "string" ||
    typeof graphState.transitionCount !== "number" ||
    !Array.isArray(graphState.auditTrail) ||
    typeof graphState.roleResults !== "object" ||
    graphState.roleResults === null ||
    Array.isArray(graphState.roleResults) ||
    typeof graphState.branchRecords !== "object" ||
    graphState.branchRecords === null ||
    Array.isArray(graphState.branchRecords) ||
    typeof graphState.loopIterations !== "object" ||
    graphState.loopIterations === null ||
    Array.isArray(graphState.loopIterations) ||
    typeof graphState.selectedEventByBranchId !== "object" ||
    graphState.selectedEventByBranchId === null ||
    Array.isArray(graphState.selectedEventByBranchId) ||
    typeof graphState.finalOutput !== "string" ||
    typeof graphState.finalRoleId !== "string" ||
    typeof graphState.lastExecutedRoleId !== "string" ||
    typeof graphState.nextBranchSequence !== "number" ||
    typeof graphState.lastCheckpointSequence !== "number"
  ) {
    throw createRuntimeError({
      errorCode: "RESUME_STATE_INVALID",
      errorCategory: "state",
      message: `Resume state snapshot is partial or corrupted: ${statePath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }

  let sessions: unknown;
  try {
    sessions = await readJsonFile(sessionsPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createRuntimeError({
      errorCode: "RESUME_SESSIONS_INVALID",
      errorCategory: "state",
      message: `Resume session snapshot is unreadable: ${sessionsPath} (${message})`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }
  if (!Array.isArray(sessions)) {
    throw createRuntimeError({
      errorCode: "RESUME_SESSIONS_INVALID",
      errorCategory: "state",
      message: `Resume session snapshot must be an array: ${sessionsPath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }

  const seenRoleIds = new Set<string>();
  for (const item of sessions) {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      typeof (item as OpencodeSessionRecord).roleId !== "string"
    ) {
      throw createRuntimeError({
        errorCode: "RESUME_SESSIONS_INVALID",
        errorCategory: "state",
        message: `Resume session snapshot contains invalid entries: ${sessionsPath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }

    const roleId = (item as OpencodeSessionRecord).roleId;
    if (seenRoleIds.has(roleId)) {
      throw createRuntimeError({
        errorCode: "RESUME_SESSIONS_INVALID",
        errorCategory: "state",
        message: `Resume session snapshot contains duplicate roleId "${roleId}": ${sessionsPath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
    seenRoleIds.add(roleId);

    const hasAuditTrailEntry = graphState.auditTrail.some((entry) => entry.roleId === roleId);
    const hasRoleResult = Object.values(graphState.roleResults).some(
      (result) => result.roleId === roleId
    );
    const hasBranchRecord = Object.values(graphState.branchRecords).some(
      (branch) => branch.roleId === roleId
    );
    const matchesLastExecution =
      graphState.lastExecutedRoleId === roleId || graphState.finalRoleId === roleId;
    if (!hasAuditTrailEntry && !hasRoleResult && !hasBranchRecord && !matchesLastExecution) {
      throw createRuntimeError({
        errorCode: "RESUME_SNAPSHOT_INCONSISTENT",
        errorCategory: "state",
        message: `Resume session record for "${roleId}" is not represented in graphState: ${statePath} vs ${sessionsPath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
  }

  return graphState;
}

export async function persistRunPlanFingerprint(args: {
  runDir: string;
  fingerprint: RunPlanFingerprint;
}): Promise<void> {
  const fingerprintPath = resolve(args.runDir, RUN_PLAN_FINGERPRINT_FILE);
  await writeAtomicFile(fingerprintPath, stringifyJson(args.fingerprint));
}

export async function validateResumePlanFingerprint(args: {
  runDir: string;
  expectedFingerprint: RunPlanFingerprint;
}): Promise<void> {
  const fingerprintPath = resolve(args.runDir, RUN_PLAN_FINGERPRINT_FILE);
  const runId = basename(args.runDir);

  if (!(await pathExists(fingerprintPath))) {
    throw createRuntimeError({
      errorCode: "RESUME_PLAN_FINGERPRINT_MISSING",
      errorCategory: "state",
      message: `Missing resume plan fingerprint: ${fingerprintPath}`,
      retryable: false,
      stage: "resume",
      runId
    });
  }

  let stored: unknown;
  try {
    stored = await readJsonFile(fingerprintPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createRuntimeError({
      errorCode: "RESUME_PLAN_FINGERPRINT_INVALID",
      errorCategory: "state",
      message: `Resume plan fingerprint is unreadable: ${fingerprintPath} (${message})`,
      retryable: false,
      stage: "resume",
      runId
    });
  }

  if (!isFingerprintRecord(stored)) {
    throw createRuntimeError({
      errorCode: "RESUME_PLAN_FINGERPRINT_INVALID",
      errorCategory: "state",
      message: `Resume plan fingerprint is invalid: ${fingerprintPath}`,
      retryable: false,
      stage: "resume",
      runId
    });
  }

  if (
    stored.version !== args.expectedFingerprint.version ||
    stored.algorithm !== args.expectedFingerprint.algorithm ||
    stored.digest !== args.expectedFingerprint.digest
  ) {
    throw createRuntimeError({
      errorCode: "RESUME_PLAN_FINGERPRINT_MISMATCH",
      errorCategory: "state",
      message: `Resume plan fingerprint mismatch: expected ${args.expectedFingerprint.digest} but found ${stored.digest}`,
      retryable: false,
      stage: "resume",
      runId
    });
  }
}

export async function persistRuntimeCheckpoint(args: {
  context: RunContext;
  roleId: string;
  branchId: string;
  loopIteration: number;
  executionId: string;
  update: RuntimeCheckpointRecord["update"];
}): Promise<RuntimeCheckpointRecord> {
  const checkpointSequence = args.context.nextCheckpointSequence;
  args.context.nextCheckpointSequence += 1;
  const checkpoint: RuntimeCheckpointRecord = {
    checkpointSequence,
    roleId: args.roleId,
    branchId: args.branchId,
    loopIteration: args.loopIteration,
    executionId: args.executionId,
    update: {
      ...args.update,
      lastCheckpointSequence: checkpointSequence
    }
  };

  await writeAtomicFile(
    resolve(
      args.context.checkpointsDir,
      buildCheckpointFileName(checkpointSequence, args.executionId)
    ),
    stringifyJson(checkpoint)
  );
  return checkpoint;
}

export async function loadPendingRuntimeCheckpoints(args: {
  context: RunContext;
  afterSequence: number;
}): Promise<RuntimeCheckpointRecord[]> {
  if (!(await directoryExists(args.context.checkpointsDir))) {
    return [];
  }

  const entries = await readdir(args.context.checkpointsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const checkpoints: RuntimeCheckpointRecord[] = [];

  for (const file of files) {
    const sequence = Number.parseInt(file.slice(0, 6), 10);
    if (!Number.isFinite(sequence) || sequence <= args.afterSequence) {
      continue;
    }

    const raw = await readJsonFile(resolve(args.context.checkpointsDir, file));
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      typeof (raw as RuntimeCheckpointRecord).checkpointSequence !== "number" ||
      typeof (raw as RuntimeCheckpointRecord).roleId !== "string" ||
      typeof (raw as RuntimeCheckpointRecord).branchId !== "string" ||
      typeof (raw as RuntimeCheckpointRecord).loopIteration !== "number" ||
      typeof (raw as RuntimeCheckpointRecord).executionId !== "string" ||
      typeof (raw as RuntimeCheckpointRecord).update !== "object" ||
      (raw as RuntimeCheckpointRecord).update === null ||
      Array.isArray((raw as RuntimeCheckpointRecord).update)
    ) {
      throw new Error(`Invalid runtime checkpoint: ${resolve(args.context.checkpointsDir, file)}`);
    }

    checkpoints.push(raw as RuntimeCheckpointRecord);
  }

  return checkpoints.sort(
    (left, right) => left.checkpointSequence - right.checkpointSequence
  );
}

export async function cleanupHistoricalExecutionSnapshots(args: {
  context: RunContext;
  keepLatest: number;
}): Promise<void> {
  if (!Number.isInteger(args.keepLatest) || args.keepLatest <= 0) {
    return;
  }

  for (const roleDirs of args.context.roleDirsById.values()) {
    const entries = await readdir(roleDirs.executionsDir, { withFileTypes: true });
    const executionDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    const removable = executionDirs.slice(0, Math.max(0, executionDirs.length - args.keepLatest));
    await Promise.all(
      removable.map((entry) => rm(resolve(roleDirs.executionsDir, entry), { recursive: true, force: true }))
    );
  }
}

export function allocateRoleExecution(args: {
  context: RunContext;
  roleId: string;
  branchId?: string;
  loopIteration?: number;
}): RoleExecutionRecord {
  const roleDirs = args.context.roleDirsById.get(args.roleId);
  if (!roleDirs) {
    throw new Error(`Role run directory missing for "${args.roleId}"`);
  }
  const current = args.context.roleExecutionCounts.get(args.roleId) ?? 0;
  const executionIndex = current + 1;
  args.context.roleExecutionCounts.set(args.roleId, executionIndex);
  const startedAt = new Date().toISOString();
  const executionId = buildExecutionId(executionIndex, startedAt);
  return {
    executionId,
    executionIndex,
    executionDir: resolve(roleDirs.executionsDir, executionId),
    roleId: args.roleId,
    sessionKey: args.roleId,
    startedAt,
    branchId: args.branchId,
    loopIteration: args.loopIteration
  };
}

export function getRoleSession(context: RunContext, roleId: string): OpencodeSessionRecord | undefined {
  return context.sessionRecordsByRoleId.get(roleId);
}

export async function persistRoleSession(args: {
  context: RunContext;
  roleId: string;
  execution: RoleExecutionRecord;
  sessionId: string;
  messageId?: string;
}): Promise<OpencodeSessionRecord> {
  const roleDirs = args.context.roleDirsById.get(args.roleId);
  if (!roleDirs) {
    throw new Error(`Role run directory missing for "${args.roleId}"`);
  }
  const previous = args.context.sessionRecordsByRoleId.get(args.roleId);
  const record: OpencodeSessionRecord = {
    sessionKey: args.execution.sessionKey,
    roleId: args.roleId,
    sessionId: args.sessionId,
    directory: roleDirs.roleDir,
    createdAt: previous?.createdAt ?? args.execution.startedAt,
    lastPromptAt: args.execution.startedAt,
    lastMessageId: args.messageId,
    promptCount:
      previous?.sessionId === args.sessionId ? previous.promptCount + 1 : (previous?.promptCount ?? 0) + 1
  };
  args.context.sessionRecordsByRoleId.set(args.roleId, record);
  const content = stringifyJson(record);
  await mkdir(args.execution.executionDir, { recursive: true });
  await writeAtomicFile(roleDirs.sessionPath, content);
  await writeAtomicFile(resolve(args.execution.executionDir, "session.json"), content);
  await persistSessionSnapshot(args.context);
  return record;
}

export async function persistRolePrelude(args: {
  roleId: string;
  roleName: string;
  roleDescription: string;
  prompt: string;
  allowedEvents: string[];
  modelId?: string;
  resolvedRolePath?: string;
  preferredModelTags?: string[];
  sharedDir: string;
  privateDir: string;
  execution: RoleExecutionRecord;
  roleInputProjection: Record<string, unknown>;
  context: RunContext;
}): Promise<void> {
  const roleDirs = args.context.roleDirsById.get(args.roleId);
  if (!roleDirs) {
    return;
  }
  await writeRoleExecutionFiles({
    roleDirs,
    execution: args.execution,
    files: [
      {
        path: "inbox.md",
        content: [
          `# Inbox: ${args.roleId}`,
          "",
          `Role: ${args.roleName}`,
          "",
          "Role Description:",
          args.roleDescription,
          "",
          "Runtime Input Projection:",
          "```json",
          stringifyJson(args.roleInputProjection),
          "```"
        ].join("\n")
      },
      {
        path: "prompt.md",
        content: `${args.prompt}\n`
      },
      {
        path: "role.md",
        content: [
          `# Role ${args.roleId}`,
          "",
          `- modelId: ${args.modelId ?? "legacy-profile"}`,
          `- allowedEvents: ${args.allowedEvents.join(", ") || "(none)"}`,
          `- resolvedRolePath: ${args.resolvedRolePath ?? ""}`,
          `- preferredModelTags: ${(args.preferredModelTags ?? []).join(", ") || "(none)"}`,
          `- sharedDir: ${args.sharedDir}`,
          `- privateDir: ${args.privateDir}`,
          `- latestExecutionId: ${args.execution.executionId}`,
          `- sessionKey: ${args.execution.sessionKey}`
        ].join("\n")
      },
      {
        path: "execution.json",
        content: stringifyJson(args.execution)
      }
    ]
  });
}

export async function persistRoleResult(args: {
  roleId: string;
  context: RunContext;
  execution: RoleExecutionRecord;
  output?: RoleExecutionOutput;
  audit: AuditRecord;
}): Promise<void> {
  const roleDirs = args.context.roleDirsById.get(args.roleId);
  if (!roleDirs) {
    return;
  }
  const files: Array<{ path: string; content: string }> = [
    {
      path: "audit.json",
      content: stringifyJson(args.audit)
    }
  ];
  if (args.output) {
    files.push(
      {
        path: "result.json",
        content: stringifyJson(args.output)
      },
      {
        path: "outbox.md",
        content: `${args.output.content ?? ""}\n`
      }
    );
  }
  await writeRoleExecutionFiles({
    roleDirs,
    execution: args.execution,
    files
  });
}

export async function appendEvent(
  context: RunContext,
  payload: Record<string, unknown>
): Promise<void> {
  const state = getBufferedAppendState(context.runDir);
  state.pendingByKey.set("events", {
    key: "events",
    path: context.eventsPath,
    content: `${state.pendingByKey.get("events")?.content ?? ""}${JSON.stringify(payload)}\n`
  });
}

export async function appendBufferedText(args: {
  context: RunContext;
  key: string;
  path: string;
  content: string;
}): Promise<void> {
  const state = getBufferedAppendState(args.context.runDir);
  state.pendingByKey.set(args.key, {
    key: args.key,
    path: args.path,
    content: `${state.pendingByKey.get(args.key)?.content ?? ""}${args.content}`
  });
}

export async function flushBufferedRunArtifacts(context: RunContext): Promise<void> {
  const state = getBufferedAppendState(context.runDir);
  const runFlush = async (): Promise<void> => {
    if (state.pendingByKey.size === 0) {
      return;
    }

    const batches = Array.from(state.pendingByKey.values());
    state.pendingByKey.clear();

    for (const batch of batches) {
      try {
        await appendFile(batch.path, batch.content, "utf8");
      } catch (error) {
        await writeBufferedAppendRecovery(context.runDir, batch);
        throw error;
      }
    }
  };

  state.flushPromise = (state.flushPromise ?? Promise.resolve())
    .then(runFlush)
    .finally(() => {
      if (state.flushPromise) {
        state.flushPromise = undefined;
      }
    });

  await state.flushPromise;
}
