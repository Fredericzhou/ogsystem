/**
 * Hosts the durable artifact operations that keep runs recoverable and audit-ready.
 * Responsibilities: directory creation for runs, locking resume attempts, snapshot/plan validation,
 * checkpoints, buffers, and role/graph persistence artifacts.
 * Boundaries: this module only manages files that coordinate execution state and recovery evidence.
 * Trade-off: writes a constellation of small JSON files instead of reserializing the entire graph
 * on every transition to keep checkpointing cheap while still providing enough context for resume.
 */
import {
  access,
  appendFile,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { arch, hostname, platform } from "node:os";
import { createInterface } from "node:readline";

import { readJsonFile, writeJsonFileAtomic, writeTextFileAtomic } from "./json-file.js";
import {
  isHumanReviewContext,
  isHumanReviewDecisionRecord,
  isPendingHumanReview
} from "./human-review.js";
import { createRuntimeError } from "./runtime-errors.js";
import {
  redactJsonForStorage,
  redactPromptText,
  stringifyRedactedUnknown
} from "./redaction.js";
import type {
  AuditRecord,
  BranchRecord,
  GraphState,
  HumanReviewDecisionRecord,
  OpencodeSessionRecord,
  PendingHumanReview,
  RoleExecutionOutput,
  RoleExecutionOutcomeRecord,
  RoleExecutionRecord,
  RoleRunDirs,
  RuntimeCheckpointRecord,
  RunContext,
  RuntimeConfig,
  SystemDefinition
} from "./types.js";
import { stringifyJson } from "./runtime-support.js";

export const RUN_PLAN_FINGERPRINT_FILE = "plan-fingerprint.json";
export const RESOLVED_CONFIG_FILE = "resolved-config.json";
export const ROLE_EXECUTION_OUTCOME_FILE = "execution-outcome.json";
export const RESUME_RUN_LOCK_FILE = ".resume.lock";
const BUFFER_RECOVERY_DIR = ".buffer-recovery";

export type RunPlanFingerprint = {
  version: number;
  algorithm: "sha256";
  digest: string;
  payload: Record<string, unknown>;
};

export function resolvePrivateWorkspaceDir(args: {
  roleDirs: RoleRunDirs;
  workspaceIsolation: "role" | "branch";
  branchId?: string;
}): string {
  if (args.workspaceIsolation !== "branch" || !args.branchId) {
    return args.roleDirs.privateDir;
  }
  return resolve(args.roleDirs.privateDir, "branches", args.branchId);
}

export function buildRoleSessionKey(roleId: string, sessionLineageId: string): string {
  return `${roleId}:${sessionLineageId}`;
}

type BufferedAppendBatch = {
  key: string;
  path: string;
  content: string;
};

type BufferedAppendState = {
  pendingByKey: Map<string, BufferedAppendBatch>;
  flushPromise?: Promise<void>;
  flushToken?: symbol;
};

type ResumeRunLockRecord = {
  pid: number;
  hostname: string;
  acquiredAt: string;
  command: string;
};

export function buildHumanReviewRequestPath(context: RunContext, reviewId: string): string {
  return resolve(context.reviewsDir, `${reviewId}.request.json`);
}

export function buildHumanReviewDecisionPath(context: RunContext, reviewId: string): string {
  return resolve(context.reviewsDir, `${reviewId}.decision.json`);
}

export type RunStopRequestRecord = {
  version: 1;
  requestedAt: string;
  requestedByPid: number;
  reason: string;
};

export type RunStopOutcomeRecord = {
  version: 1;
  status: "stopped" | "failed";
  committedAt: string;
  reason: string;
};

const bufferedAppendStateByRunDir = new Map<string, BufferedAppendState>();

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function timestampForRunId(date: Date): string {
  return [
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`,
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  ].join("-");
}

function buildRunId(createdAt: Date): string {
  const entropy = createHash("sha256")
    .update(`${process.pid}:${createdAt.toISOString()}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 8);
  return `${timestampForRunId(createdAt)}-${entropy}`;
}

function parseCreatedAtFromRunId(runId: string): string | undefined {
  const match = runId.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[a-f0-9]{8}$/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  const createdAt = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(createdAt.getTime()) ? undefined : createdAt.toISOString();
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRunReproScript(args: {
  workdir: string;
  generatedAt: string;
}): string {
  const workdir = shellEscape(args.workdir);
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Environment Context:",
    `# Node.js: ${process.version}`,
    `# OS: ${platform()} (${arch()})`,
    `# Timestamp: ${args.generatedAt}`,
    "",
    "RUN_DIR=\"$(cd -- \"$(dirname -- \"$0\")\" && pwd)\"",
    `WORKDIR=${workdir}`,
    "INPUT_FILE=\"$RUN_DIR/request.md\"",
    "SYSTEM_FILE=\"$RUN_DIR/system.mmd\"",
    "RUNTIME_FILE=\"$WORKDIR/.ogs/runtime.json\"",
    "LAWS_FILE=\"$WORKDIR/.ogs/laws.json\"",
    "USER_PROFILE_FILE=\"$WORKDIR/.ogs/user-profile.json\"",
    "",
    "if [[ ! -f \"$INPUT_FILE\" ]]; then",
    "  echo \"missing input snapshot: $INPUT_FILE\" >&2",
    "  exit 1",
    "fi",
    "",
    "ARGS=(",
    "  --system \"$SYSTEM_FILE\"",
    "  --input \"$(cat \"$INPUT_FILE\")\"",
    "  --workdir \"$WORKDIR\"",
    "  --resume-run \"$RUN_DIR\"",
    ")",
    "",
    "if [[ -f \"$RUNTIME_FILE\" ]]; then",
    "  ARGS+=(--runtime \"$RUNTIME_FILE\")",
    "fi",
    "if [[ -f \"$LAWS_FILE\" ]]; then",
    "  ARGS+=(--laws \"$LAWS_FILE\")",
    "fi",
    "if [[ -f \"$USER_PROFILE_FILE\" ]]; then",
    "  ARGS+=(--user-profile \"$USER_PROFILE_FILE\")",
    "fi",
    "",
    "if ! command -v ogs >/dev/null 2>&1; then",
    "  echo \"missing ogs in PATH; install the ogsystem CLI package before replaying this run\" >&2",
    "  exit 1",
    "fi",
    "",
    "ogs \"${ARGS[@]}\"",
    ""
  ].join("\n");
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

function isResumeRunLockRecord(value: unknown): value is ResumeRunLockRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as ResumeRunLockRecord).pid === "number" &&
    typeof (value as ResumeRunLockRecord).hostname === "string" &&
    typeof (value as ResumeRunLockRecord).acquiredAt === "string" &&
    typeof (value as ResumeRunLockRecord).command === "string"
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

async function acquireResumeRunLock(runDir: string): Promise<() => Promise<void>> {
  // Invariant: only one process may resume a directory, so the lock file is a single source of truth.
  // Trade-off: we rely on an advisory lock that assumes the runner honors pid/hostname checks instead
  // of cross-host distributed coordination, keeping recovery logic simple for the single-machine case.
  const lockPath = resolve(runDir, RESUME_RUN_LOCK_FILE);
  const owner: ResumeRunLockRecord = {
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString(),
    command: process.argv.join(" ")
  };

  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(stringifyJson(owner), "utf8");
      } finally {
        await handle.close();
      }
      return async () => {
        if (!(await pathExists(lockPath))) {
          return;
        }
        const raw = await readJsonFile(lockPath);
        if (!isResumeRunLockRecord(raw)) {
          return;
        }
        if (
          raw.pid !== owner.pid ||
          raw.hostname !== owner.hostname ||
          raw.acquiredAt !== owner.acquiredAt ||
          raw.command !== owner.command
        ) {
          return;
        }
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        (error as { code?: string }).code !== "EEXIST"
      ) {
        throw error;
      }

      let existing: unknown;
      try {
        existing = await readJsonFile(lockPath);
      } catch (lockReadError) {
        const message =
          lockReadError instanceof Error ? lockReadError.message : String(lockReadError);
        throw createRuntimeError({
          errorCode: "RESUME_RUN_LOCK_INVALID",
          errorCategory: "state",
          message: `Resume run lock is unreadable: ${lockPath} (${message})`,
          retryable: false,
          stage: "resume",
          runId: basename(runDir)
        });
      }

      if (!isResumeRunLockRecord(existing)) {
        throw createRuntimeError({
          errorCode: "RESUME_RUN_LOCK_INVALID",
          errorCategory: "state",
          message: `Resume run lock is invalid: ${lockPath}`,
          retryable: false,
          stage: "resume",
          runId: basename(runDir)
        });
      }

      if (existing.hostname !== owner.hostname) {
        throw createRuntimeError({
          errorCode: "RESUME_RUN_LOCK_HELD",
          errorCategory: "state",
          message:
            `Resume run is locked by host "${existing.hostname}" pid ${existing.pid}: ${lockPath}`,
          retryable: true,
          stage: "resume",
          runId: basename(runDir)
        });
      }

      if (isProcessAlive(existing.pid)) {
        throw createRuntimeError({
          errorCode: "RESUME_RUN_LOCK_HELD",
          errorCategory: "state",
          message:
            `Resume run is already active on pid ${existing.pid}: ${lockPath}`,
          retryable: true,
          stage: "resume",
          runId: basename(runDir)
        });
      }

      await rm(lockPath, { force: true });
    }
  }
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

export async function releaseResumeLockAfterSetupFailure(args: {
  runDir: string;
  releaseResumeLock?: () => Promise<void>;
}): Promise<void> {
  if (!args.releaseResumeLock) {
    return;
  }
  try {
    await args.releaseResumeLock();
  } catch (error) {
    process.stderr.write(
      `[warn] failed to release resume lock after setup failure: runDir=${args.runDir} error=${describeUnknownError(error)}\n`
    );
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

function resolveRunControlDir(runDir: string): string {
  return resolve(runDir, "control");
}

function resolveStopRequestPath(runDir: string): string {
  return resolve(resolveRunControlDir(runDir), "stop-request.json");
}

function resolveStopOutcomePath(runDir: string): string {
  return resolve(resolveRunControlDir(runDir), "stop-outcome.json");
}

function isRunStopRequestRecord(value: unknown): value is RunStopRequestRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as RunStopRequestRecord).version === 1 &&
    typeof (value as RunStopRequestRecord).requestedAt === "string" &&
    typeof (value as RunStopRequestRecord).requestedByPid === "number" &&
    typeof (value as RunStopRequestRecord).reason === "string"
  );
}

export async function requestRunStop(args: {
  runDir: string;
  reason?: string;
  requestedByPid?: number;
}): Promise<RunStopRequestRecord> {
  const controlDir = resolveRunControlDir(args.runDir);
  await mkdir(controlDir, { recursive: true });
  const request: RunStopRequestRecord = {
    version: 1,
    requestedAt: new Date().toISOString(),
    requestedByPid: args.requestedByPid ?? process.pid,
    reason: args.reason ?? "ogs run stop"
  };
  await writeAtomicFile(resolveStopRequestPath(args.runDir), stringifyJson(request));
  return request;
}

export async function readRunStopRequest(runDir: string): Promise<RunStopRequestRecord | undefined> {
  const requestPath = resolveStopRequestPath(runDir);
  if (!(await pathExists(requestPath))) {
    return undefined;
  }
  const raw = await readJsonFile(requestPath);
  if (!isRunStopRequestRecord(raw)) {
    return undefined;
  }
  return raw;
}

export async function clearRunStopRequest(runDir: string): Promise<void> {
  await rm(resolveStopRequestPath(runDir), { force: true });
}

export async function persistRunStopOutcome(args: {
  context: RunContext;
  status: "stopped" | "failed";
  reason: string;
}): Promise<RunStopOutcomeRecord> {
  await mkdir(args.context.controlDir, { recursive: true });
  const outcome: RunStopOutcomeRecord = {
    version: 1,
    status: args.status,
    committedAt: new Date().toISOString(),
    reason: args.reason
  };
  await writeAtomicFile(args.context.stopOutcomePath, stringifyJson(outcome));
  await rm(args.context.stopRequestPath, { force: true });
  return outcome;
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

function listChangedFingerprintComponents(args: {
  expected: RunPlanFingerprint;
  stored: RunPlanFingerprint;
}): string[] {
  const expectedComponents =
    typeof args.expected.payload.components === "object" &&
    args.expected.payload.components !== null &&
    !Array.isArray(args.expected.payload.components)
      ? (args.expected.payload.components as Record<string, { digest?: unknown }>)
      : undefined;
  const storedComponents =
    typeof args.stored.payload.components === "object" &&
    args.stored.payload.components !== null &&
    !Array.isArray(args.stored.payload.components)
      ? (args.stored.payload.components as Record<string, { digest?: unknown }>)
      : undefined;

  if (!expectedComponents || !storedComponents) {
    return [];
  }

  const componentNames = new Set([
    ...Object.keys(expectedComponents),
    ...Object.keys(storedComponents)
  ]);
  return Array.from(componentNames).filter(
    (componentName) =>
      expectedComponents[componentName]?.digest !== storedComponents[componentName]?.digest
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

async function countRoleExecutionDirs(executionsDir: string): Promise<number> {
  if (!(await directoryExists(executionsDir))) {
    return 0;
  }
  const entries = await readdir(executionsDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).length;
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

function getRoleExecutionOutcomePath(executionDir: string): string {
  return resolve(executionDir, ROLE_EXECUTION_OUTCOME_FILE);
}

function isBranchRecord(value: unknown): value is BranchRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as BranchRecord).branchId === "string" &&
    typeof (value as BranchRecord).roleId === "string" &&
    typeof (value as BranchRecord).loopIteration === "number" &&
    typeof (value as BranchRecord).branchSequence === "number" &&
    typeof (value as BranchRecord).lineageId === "string" &&
    typeof (value as BranchRecord).sessionLineageId === "string" &&
    ((value as BranchRecord).status === "active" ||
      (value as BranchRecord).status === "waiting_review" ||
      (value as BranchRecord).status === "completed")
  );
}

function isRoleExecutionOutcomeRecord(value: unknown): value is RoleExecutionOutcomeRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as RoleExecutionOutcomeRecord;
  if (
    record.version !== 1 ||
    typeof record.executionId !== "string" ||
    typeof record.roleId !== "string" ||
    typeof record.branchId !== "string" ||
    typeof record.loopIteration !== "number" ||
    typeof record.sessionKey !== "string" ||
    typeof record.committedAt !== "string" ||
    !isBranchRecord(record.branch) ||
    typeof record.audit !== "object" ||
    record.audit === null
  ) {
    return false;
  }
  if (record.status === "failed") {
    return typeof record.error === "string" && typeof record.failure === "object" && record.failure !== null;
  }
  return record.status === "ok" || record.status === "noop";
}

async function persistSessionSnapshot(context: RunContext): Promise<void> {
  await writeAtomicFile(
    context.sessionsPath,
    stringifyJson(
      Array.from(context.sessionRecordsByKey.values()).sort((left, right) => {
        if (left.roleId !== right.roleId) {
          return left.roleId.localeCompare(right.roleId);
        }
        return left.sessionKey.localeCompare(right.sessionKey);
      })
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
  resolvedConfigSnapshot?: Record<string, unknown>;
  resumeRunDir?: string;
}): Promise<RunContext> {
  // Fresh runs and resumed runs share the same directory contract. Initialization therefore
  // prefers idempotent setup and write-if-missing files so resume never overwrites evidence.
  if (args.resumeRunDir?.includes("ogsystem-history")) {
    throw createRuntimeError({
      errorCode: "RUNTIME_LEGACY_RUN_PATH_UNSUPPORTED",
      errorCategory: "input",
      message: `Legacy resume path is not supported: ${args.resumeRunDir}`,
      retryable: false,
      stage: "resume"
    });
  }
  const createdAt = new Date();
  const runId = args.resumeRunDir ? basename(resolve(args.workdir, args.resumeRunDir)) : buildRunId(createdAt);
  const runCreatedAt = args.resumeRunDir
    ? parseCreatedAtFromRunId(runId) ?? createdAt.toISOString()
    : createdAt.toISOString();
  const runDir = args.resumeRunDir
    ? resolve(args.workdir, args.resumeRunDir)
    : resolve(args.workdir, args.runtimeConfig.runsDir, runId);
  const auditDir = resolve(runDir, "audit");
  const logsDir = resolve(runDir, "logs");
  const roleLogsDir = resolve(logsDir, "roles");
  const controlDir = resolve(runDir, "control");
  const reviewsDir = resolve(controlDir, "reviews");
  const checkpointsDir = resolve(runDir, "checkpoints");
  const rolesRootDir = resolve(runDir, args.runtimeConfig.workspace.rolesDir);
  const sharedDir = resolveSharedDir({
    runDir,
    workdir: args.workdir,
    runtimeConfig: args.runtimeConfig
  });
  const roleDirsById = new Map<string, RoleRunDirs>();
  const roleExecutionCounts = new Map<string, number>();
  let executionDirCount = 0;
  const releaseResumeLock = args.resumeRunDir
    ? await acquireResumeRunLock(runDir)
    : undefined;
  try {
    await mkdir(runDir, { recursive: true });
    await mkdir(auditDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
    await mkdir(roleLogsDir, { recursive: true });
    await mkdir(controlDir, { recursive: true });
    await mkdir(reviewsDir, { recursive: true });
    await mkdir(checkpointsDir, { recursive: true });
    await mkdir(rolesRootDir, { recursive: true });
    await mkdir(sharedDir, { recursive: true });
    await mkdir(resolve(runDir, ".opencode"), { recursive: true });

    const sourceSystem = await readFile(args.systemPath, "utf8");
    // Idempotency: resumed directories reuse existing snapshots so we don't lose checkpoints when
    // rerunning setup after a crash.
    await writeIfMissing(
      resolve(runDir, "request.md"),
      `${redactPromptText(args.prompt, args.runtimeConfig.redaction)}\n`
    );
    await writeIfMissing(resolve(runDir, "system.mmd"), sourceSystem);
    await writeIfMissing(
      resolve(runDir, "run.md"),
      [
        `# Run ${runId}`,
        "",
        `- systemId: ${args.system.systemId}`,
        `- systemVersion: ${args.system.systemVersion}`,
        `- entryRoleId: ${args.system.entryRoleId}`,
        `- sharedDir: ${sharedDir}`,
        `- logsDir: ${logsDir}`
      ].join("\n")
    );
    if (args.resolvedConfigSnapshot) {
      await writeIfMissing(
        resolve(runDir, RESOLVED_CONFIG_FILE),
        `${stringifyJson(args.resolvedConfigSnapshot)}\n`
      );
    }
    const reproPath = resolve(runDir, "repro.sh");
    await writeIfMissing(
      reproPath,
      buildRunReproScript({
        workdir: args.workdir,
        generatedAt: new Date().toISOString()
      })
    );
    await chmod(reproPath, 0o755);
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
      const latestSessionPath = resolve(roleDir, "latest-session.json");
      await mkdir(privateDir, { recursive: true });
      if (args.runtimeConfig.workspace.workspaceIsolation === "branch") {
        await mkdir(resolve(privateDir, "branches"), { recursive: true });
      }
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
      roleDirsById.set(roleId, { roleDir, privateDir, executionsDir, latestSessionPath });
      roleExecutionCounts.set(roleId, await restoreRoleExecutionCount(executionsDir));
      executionDirCount += await countRoleExecutionDirs(executionsDir);
    }

    const sessionsPath = resolve(runDir, "sessions.json");
    if (!args.resumeRunDir) {
      await writeIfMissing(sessionsPath, "[]\n");
    }
    let sessionRecordsByKey = new Map<string, OpencodeSessionRecord>();
    if (await pathExists(sessionsPath)) {
      const existing = await readJsonFile(sessionsPath);
      if (Array.isArray(existing)) {
        sessionRecordsByKey = new Map(
          existing
            .filter(
              (item): item is OpencodeSessionRecord =>
                typeof item === "object" &&
                item !== null &&
                !Array.isArray(item) &&
                typeof (item as OpencodeSessionRecord).sessionKey === "string" &&
                typeof (item as OpencodeSessionRecord).roleId === "string" &&
                typeof (item as OpencodeSessionRecord).sessionId === "string"
            )
            .map((item) => [item.sessionKey, item])
        );
      }
    }

    await replayBufferedAppendRecovery(runDir);
    getBufferedAppendState(runDir);

    return {
      runId,
      createdAt: runCreatedAt,
      runDir,
      resolvedConfigPath: resolve(runDir, RESOLVED_CONFIG_FILE),
      auditDir,
      logsDir,
      engineLogPath: resolve(logsDir, "engine.ndjson"),
      roleLogsDir,
      controlDir,
      reviewsDir,
      stopRequestPath: resolve(controlDir, "stop-request.json"),
      stopOutcomePath: resolve(controlDir, "stop-outcome.json"),
      eventsPath: resolve(runDir, "events.ndjson"),
      statePath: resolve(runDir, "state.json"),
      metricsPath: resolve(runDir, "metrics.json"),
      summaryPath: resolve(runDir, "summary.json"),
      timelinePath: resolve(runDir, "timeline.jsonl"),
      opencodeDir: resolve(runDir, ".opencode"),
      opencodePidPath: resolve(runDir, ".opencode", "server.pid"),
      opencodeEndpointPath: resolve(runDir, ".opencode", "endpoint.json"),
      sessionsPath,
      checkpointsDir,
      roleDirsById,
      roleExecutionCounts,
      executionDirCount,
      sessionRecordsByKey,
      nextCheckpointSequence: await restoreCheckpointSequence(checkpointsDir),
      sharedDir,
      workspaceIsolation: args.runtimeConfig.workspace.workspaceIsolation ?? "role",
      redaction: args.runtimeConfig.redaction ?? { enabled: true },
      releaseResumeLock
    };
  } catch (error) {
    // Failure window: the caught error occurs before execution starts, so we must drop the resume
    // lock to avoid a stale blocker for the next run attempt.
    await releaseResumeLockAfterSetupFailure({
      runDir,
      releaseResumeLock
    });
    throw error;
  }
}

export async function loadResumeGraphState(args: {
  runDir: string;
}): Promise<GraphState> {
  // Resume fails closed: validate both the state snapshot and the session index before any
  // executor starts. Partial copies or manual edits should stop here, not during execution.
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
    typeof graphState.auditSummary !== "object" ||
    graphState.auditSummary === null ||
    Array.isArray(graphState.auditSummary)
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
  const auditSummaryRecord = graphState.auditSummary as Record<string, unknown>;
  if (auditSummaryRecord.handledFailureCount === undefined) {
    auditSummaryRecord.handledFailureCount = 0;
  } else if (!isNonNegativeInteger(auditSummaryRecord.handledFailureCount)) {
    throw createRuntimeError({
      errorCode: "RESUME_STATE_INVALID",
      errorCategory: "state",
      message:
        `Resume state snapshot has invalid graphState.auditSummary.handledFailureCount: ${statePath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }
  if (auditSummaryRecord.unhandledFailureCount === undefined) {
    auditSummaryRecord.unhandledFailureCount = 0;
  } else if (!isNonNegativeInteger(auditSummaryRecord.unhandledFailureCount)) {
    throw createRuntimeError({
      errorCode: "RESUME_STATE_INVALID",
      errorCategory: "state",
      message:
        `Resume state snapshot has invalid graphState.auditSummary.unhandledFailureCount: ${statePath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }
  if (auditSummaryRecord.handledFailureByEvent === undefined) {
    auditSummaryRecord.handledFailureByEvent = {};
  } else if (
    typeof auditSummaryRecord.handledFailureByEvent !== "object" ||
    auditSummaryRecord.handledFailureByEvent === null ||
    Array.isArray(auditSummaryRecord.handledFailureByEvent)
  ) {
    throw createRuntimeError({
      errorCode: "RESUME_STATE_INVALID",
      errorCategory: "state",
      message:
        `Resume state snapshot has invalid graphState.auditSummary.handledFailureByEvent: ${statePath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }
  for (const [eventType, count] of Object.entries(
    auditSummaryRecord.handledFailureByEvent as Record<string, unknown>
  )) {
    if (!isNonNegativeInteger(count)) {
      throw createRuntimeError({
        errorCode: "RESUME_STATE_INVALID",
        errorCategory: "state",
        message:
          `Resume state snapshot has invalid graphState.auditSummary.handledFailureByEvent["${eventType}"]: ${statePath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
  }
  if (auditSummaryRecord.handledFailureByTargetRole === undefined) {
    auditSummaryRecord.handledFailureByTargetRole = {};
  } else if (
    typeof auditSummaryRecord.handledFailureByTargetRole !== "object" ||
    auditSummaryRecord.handledFailureByTargetRole === null ||
    Array.isArray(auditSummaryRecord.handledFailureByTargetRole)
  ) {
    throw createRuntimeError({
      errorCode: "RESUME_STATE_INVALID",
      errorCategory: "state",
      message:
        `Resume state snapshot has invalid graphState.auditSummary.handledFailureByTargetRole: ${statePath}`,
      retryable: false,
      stage: "resume",
      runId: basename(args.runDir)
    });
  }
  for (const [targetRoleId, count] of Object.entries(
    auditSummaryRecord.handledFailureByTargetRole as Record<string, unknown>
  )) {
    if (!isNonNegativeInteger(count)) {
      throw createRuntimeError({
        errorCode: "RESUME_STATE_INVALID",
        errorCategory: "state",
        message:
          `Resume state snapshot has invalid graphState.auditSummary.handledFailureByTargetRole["${targetRoleId}"]: ${statePath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
  }
  if (
    graphState.nextBranchSequence === undefined &&
    typeof graphState.branchRecords === "object" &&
    graphState.branchRecords !== null &&
    !Array.isArray(graphState.branchRecords)
  ) {
    const maxBranchSequence = Object.values(graphState.branchRecords as Record<string, unknown>).reduce<number>(
      (currentMax, branch) => {
        if (
          typeof branch === "object" &&
          branch !== null &&
          !Array.isArray(branch) &&
          typeof (branch as { branchSequence?: unknown }).branchSequence === "number"
        ) {
          return Math.max(currentMax, (branch as { branchSequence: number }).branchSequence);
        }
        return currentMax;
      },
      0
    );
    graphState.nextBranchSequence = maxBranchSequence + 1;
  }
  if (graphState.humanReviewContextByBranchId === undefined) {
    graphState.humanReviewContextByBranchId = {};
  }
  if (
    typeof graphState.userPrompt !== "string" ||
    typeof graphState.status !== "string" ||
    typeof graphState.error !== "string" ||
    typeof graphState.transitionCount !== "number" ||
    !Array.isArray(graphState.recentAudits) ||
    typeof graphState.auditSummary !== "object" ||
    graphState.auditSummary === null ||
    Array.isArray(graphState.auditSummary) ||
    typeof graphState.auditSummary.okCount !== "number" ||
    typeof graphState.auditSummary.failedCount !== "number" ||
    typeof graphState.auditSummary.noopCount !== "number" ||
    typeof graphState.auditSummary.repairAttemptedCount !== "number" ||
    typeof graphState.auditSummary.repairAppliedCount !== "number" ||
    typeof graphState.auditSummary.failureCountsByErrorCode !== "object" ||
    graphState.auditSummary.failureCountsByErrorCode === null ||
    Array.isArray(graphState.auditSummary.failureCountsByErrorCode) ||
    typeof graphState.roleMetricsByRoleId !== "object" ||
    graphState.roleMetricsByRoleId === null ||
    Array.isArray(graphState.roleMetricsByRoleId) ||
    typeof graphState.roleResults !== "object" ||
    graphState.roleResults === null ||
    Array.isArray(graphState.roleResults) ||
    typeof graphState.pendingReviewsById !== "object" ||
    graphState.pendingReviewsById === null ||
    Array.isArray(graphState.pendingReviewsById) ||
    typeof graphState.reviewHistoryByBranchId !== "object" ||
    graphState.reviewHistoryByBranchId === null ||
    Array.isArray(graphState.reviewHistoryByBranchId) ||
    typeof graphState.humanReviewContextByBranchId !== "object" ||
    graphState.humanReviewContextByBranchId === null ||
    Array.isArray(graphState.humanReviewContextByBranchId) ||
    typeof graphState.reviewRoundByRoleLineageKey !== "object" ||
    graphState.reviewRoundByRoleLineageKey === null ||
    Array.isArray(graphState.reviewRoundByRoleLineageKey) ||
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
  for (const [reviewId, review] of Object.entries(graphState.pendingReviewsById as Record<string, unknown>)) {
    if (!isPendingHumanReview(review)) {
      throw createRuntimeError({
        errorCode: "RESUME_STATE_INVALID",
        errorCategory: "state",
        message: `Resume state snapshot has invalid pending review "${reviewId}": ${statePath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
  }
  for (const [branchId, history] of Object.entries(
    graphState.reviewHistoryByBranchId as Record<string, unknown>
  )) {
    if (!Array.isArray(history) || !history.every((entry) => isHumanReviewDecisionRecord(entry))) {
      throw createRuntimeError({
        errorCode: "RESUME_STATE_INVALID",
        errorCategory: "state",
        message: `Resume state snapshot has invalid review history for branch "${branchId}": ${statePath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
  }
  for (const [branchId, context] of Object.entries(
    graphState.humanReviewContextByBranchId as Record<string, unknown>
  )) {
    if (!isHumanReviewContext(context)) {
      throw createRuntimeError({
        errorCode: "RESUME_STATE_INVALID",
        errorCategory: "state",
        message: `Resume state snapshot has invalid human review context for branch "${branchId}": ${statePath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
  }
  const integerFieldChecks: Array<{
    fieldPath: string;
    value: unknown;
  }> = [
    {
      fieldPath: "graphState.transitionCount",
      value: graphState.transitionCount
    },
    {
      fieldPath: "graphState.auditSummary.okCount",
      value: graphState.auditSummary.okCount
    },
    {
      fieldPath: "graphState.auditSummary.failedCount",
      value: graphState.auditSummary.failedCount
    },
    {
      fieldPath: "graphState.auditSummary.noopCount",
      value: graphState.auditSummary.noopCount
    },
    {
      fieldPath: "graphState.auditSummary.repairAttemptedCount",
      value: graphState.auditSummary.repairAttemptedCount
    },
    {
      fieldPath: "graphState.auditSummary.repairAppliedCount",
      value: graphState.auditSummary.repairAppliedCount
    },
    {
      fieldPath: "graphState.nextBranchSequence",
      value: graphState.nextBranchSequence
    },
    {
      fieldPath: "graphState.lastCheckpointSequence",
      value: graphState.lastCheckpointSequence
    }
  ];
  for (const check of integerFieldChecks) {
    if (!isNonNegativeInteger(check.value)) {
      throw createRuntimeError({
        errorCode: "RESUME_STATE_INVALID",
        errorCategory: "state",
        message: `Resume state snapshot has invalid ${check.fieldPath}: ${statePath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
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

  const seenSessionKeys = new Set<string>();
  for (const item of sessions) {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      typeof (item as OpencodeSessionRecord).sessionKey !== "string" ||
      typeof (item as OpencodeSessionRecord).roleId !== "string" ||
      typeof (item as OpencodeSessionRecord).sessionId !== "string"
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

    const sessionKey = (item as OpencodeSessionRecord).sessionKey;
    const roleId = (item as OpencodeSessionRecord).roleId;
    const sessionLineageId = (item as OpencodeSessionRecord).sessionLineageId;
    if (seenSessionKeys.has(sessionKey)) {
      throw createRuntimeError({
        errorCode: "RESUME_SESSIONS_INVALID",
        errorCategory: "state",
        message: `Resume session snapshot contains duplicate sessionKey "${sessionKey}": ${sessionsPath}`,
        retryable: false,
        stage: "resume",
        runId: basename(args.runDir)
      });
    }
    seenSessionKeys.add(sessionKey);

    const hasRoleMetricEntry =
      typeof graphState.roleMetricsByRoleId[roleId] === "object" &&
      graphState.roleMetricsByRoleId[roleId] !== null;
    const hasRoleResult = Object.values(graphState.roleResults).some(
      (result) => result.roleId === roleId
    );
    const hasBranchRecord = Object.values(graphState.branchRecords).some(
      (branch) =>
        branch.roleId === roleId &&
        (!sessionLineageId || branch.sessionLineageId === sessionLineageId)
    );
    const matchesLastExecution =
      graphState.lastExecutedRoleId === roleId || graphState.finalRoleId === roleId;
    if (!hasRoleMetricEntry && !hasRoleResult && !hasBranchRecord && !matchesLastExecution) {
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
    const changedComponents = listChangedFingerprintComponents({
      expected: args.expectedFingerprint,
      stored
    });
    const mismatchScope =
      changedComponents.length > 0
        ? ` (${changedComponents.join(", ")})`
        : "";
    throw createRuntimeError({
      errorCode: "RESUME_PLAN_FINGERPRINT_MISMATCH",
      errorCategory: "state",
      message: `Resume plan fingerprint mismatch${mismatchScope}: expected ${args.expectedFingerprint.digest} but found ${stored.digest}`,
      retryable: false,
      stage: "resume",
      runId
    });
  }
}

/**
 * Reliability: Implements a Write-Ahead Log (WAL) pattern using small checkpoint files.
 * This allows for O(1) incremental updates during execution, achieving crash-idempotency 
 * (preventing duplicate work on resume) without the I/O amplification of saving 
 * the full state.json on every transition.
 */
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

export async function persistRoleExecutionOutcome(args: {
  execution: RoleExecutionRecord;
  outcome: RoleExecutionOutcomeRecord;
}): Promise<void> {
  await mkdir(args.execution.executionDir, { recursive: true });
  await writeAtomicFile(
    getRoleExecutionOutcomePath(args.execution.executionDir),
    stringifyJson(args.outcome)
  );
}

export async function markRoleExecutionOutcomeReconciled(args: {
  executionDir: string;
  checkpointSequence: number;
}): Promise<RoleExecutionOutcomeRecord> {
  const outcomePath = getRoleExecutionOutcomePath(args.executionDir);
  const raw = await readJsonFile(outcomePath);
  if (!isRoleExecutionOutcomeRecord(raw)) {
    throw new Error(`Invalid role execution outcome: ${outcomePath}`);
  }
  const updated: RoleExecutionOutcomeRecord = {
    ...raw,
    checkpointSequence: args.checkpointSequence,
    reconciledAt: new Date().toISOString()
  };
  await writeAtomicFile(outcomePath, stringifyJson(updated));
  return updated;
}

export async function persistHumanReviewRequest(args: {
  context: RunContext;
  review: PendingHumanReview;
}): Promise<void> {
  await mkdir(args.context.reviewsDir, { recursive: true });
  await writeAtomicFile(
    buildHumanReviewRequestPath(args.context, args.review.reviewId),
    stringifyJson(args.review)
  );
}

export async function loadHumanReviewRequests(args: {
  context: RunContext;
}): Promise<PendingHumanReview[]> {
  if (!(await directoryExists(args.context.reviewsDir))) {
    return [];
  }
  const entries = await readdir(args.context.reviewsDir, { withFileTypes: true });
  const reviews: PendingHumanReview[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".request.json")) {
      continue;
    }
    const raw = await readJsonFile(resolve(args.context.reviewsDir, entry.name));
    if (!isPendingHumanReview(raw)) {
      throw new Error(`Invalid human review request: ${resolve(args.context.reviewsDir, entry.name)}`);
    }
    reviews.push(raw);
  }
  return reviews.sort((left, right) => left.reviewId.localeCompare(right.reviewId));
}

export async function persistHumanReviewDecision(args: {
  context: RunContext;
  decision: HumanReviewDecisionRecord;
}): Promise<void> {
  await mkdir(args.context.reviewsDir, { recursive: true });
  await writeAtomicFile(
    buildHumanReviewDecisionPath(args.context, args.decision.reviewId),
    stringifyJson(args.decision)
  );
}

export async function loadHumanReviewDecisions(args: {
  context: RunContext;
  unresolvedOnly?: boolean;
}): Promise<HumanReviewDecisionRecord[]> {
  if (!(await directoryExists(args.context.reviewsDir))) {
    return [];
  }
  const entries = await readdir(args.context.reviewsDir, { withFileTypes: true });
  const decisions: HumanReviewDecisionRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".decision.json")) {
      continue;
    }
    const raw = await readJsonFile(resolve(args.context.reviewsDir, entry.name));
    if (!isHumanReviewDecisionRecord(raw)) {
      throw new Error(`Invalid human review decision: ${resolve(args.context.reviewsDir, entry.name)}`);
    }
    if (args.unresolvedOnly && raw.reconciledAt && raw.appliedAt && raw.checkpointSequence !== undefined) {
      continue;
    }
    decisions.push(raw);
  }
  return decisions.sort((left, right) => left.reviewId.localeCompare(right.reviewId));
}

export async function markHumanReviewDecisionApplied(args: {
  context: RunContext;
  reviewId: string;
  checkpointSequence: number;
  appliedAt?: string;
  reconciledAt?: string;
}): Promise<HumanReviewDecisionRecord> {
  const path = buildHumanReviewDecisionPath(args.context, args.reviewId);
  const raw = await readJsonFile(path);
  if (!isHumanReviewDecisionRecord(raw)) {
    throw new Error(`Invalid human review decision: ${path}`);
  }
  const updated: HumanReviewDecisionRecord = {
    ...raw,
    checkpointSequence: args.checkpointSequence,
    appliedAt: args.appliedAt ?? raw.appliedAt ?? new Date().toISOString(),
    reconciledAt: args.reconciledAt ?? raw.reconciledAt
  };
  await writeJsonFileAtomic(path, updated);
  return updated;
}

export async function markHumanReviewDecisionReconciled(args: {
  context: RunContext;
  reviewId: string;
  reconciledAt?: string;
}): Promise<HumanReviewDecisionRecord> {
  const path = buildHumanReviewDecisionPath(args.context, args.reviewId);
  const raw = await readJsonFile(path);
  if (!isHumanReviewDecisionRecord(raw)) {
    throw new Error(`Invalid human review decision: ${path}`);
  }
  const updated: HumanReviewDecisionRecord = {
    ...raw,
    reconciledAt: args.reconciledAt ?? new Date().toISOString()
  };
  await writeJsonFileAtomic(path, updated);
  return updated;
}

export async function loadCommittedRoleExecutionOutcomes(args: {
  context: RunContext;
  unresolvedOnly?: boolean;
}): Promise<RoleExecutionOutcomeRecord[]> {
  const outcomes: RoleExecutionOutcomeRecord[] = [];

  for (const roleDirs of args.context.roleDirsById.values()) {
    const entries = await readdir(roleDirs.executionsDir, { withFileTypes: true });
    const executionDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const executionDirName of executionDirs) {
      const executionDir = resolve(roleDirs.executionsDir, executionDirName);
      const outcomePath = getRoleExecutionOutcomePath(executionDir);
      if (!(await pathExists(outcomePath))) {
        continue;
      }
      const raw = await readJsonFile(outcomePath);
      if (!isRoleExecutionOutcomeRecord(raw)) {
        throw new Error(`Invalid role execution outcome: ${outcomePath}`);
      }
      if (args.unresolvedOnly && raw.checkpointSequence !== undefined) {
        continue;
      }
      outcomes.push(raw);
    }
  }

  return outcomes.sort((left, right) => {
    if (left.committedAt !== right.committedAt) {
      return left.committedAt.localeCompare(right.committedAt);
    }
    return left.executionId.localeCompare(right.executionId);
  });
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
    args.context.executionDirCount = Math.max(0, args.context.executionDirCount - removable.length);
  }
}

export function allocateRoleExecution(args: {
  context: RunContext;
  roleId: string;
  sessionKey: string;
  sessionLineageId?: string;
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
  args.context.executionDirCount += 1;
  const startedAt = new Date().toISOString();
  const executionId = buildExecutionId(executionIndex, startedAt);
  return {
    executionId,
    executionIndex,
    executionDir: resolve(roleDirs.executionsDir, executionId),
    roleId: args.roleId,
    sessionKey: args.sessionKey,
    sessionLineageId: args.sessionLineageId,
    startedAt,
    branchId: args.branchId,
    loopIteration: args.loopIteration
  };
}

export function getRoleSession(
  context: RunContext,
  sessionKey: string
): OpencodeSessionRecord | undefined {
  return context.sessionRecordsByKey.get(sessionKey);
}

export async function persistRoleSession(args: {
  context: RunContext;
  roleId: string;
  execution: RoleExecutionRecord;
  sessionId: string;
  messageId?: string;
  sessionDirectory?: string;
}): Promise<OpencodeSessionRecord> {
  const roleDirs = args.context.roleDirsById.get(args.roleId);
  if (!roleDirs) {
    throw new Error(`Role run directory missing for "${args.roleId}"`);
  }
  const previous = args.context.sessionRecordsByKey.get(args.execution.sessionKey);
  const record: OpencodeSessionRecord = {
    sessionKey: args.execution.sessionKey,
    roleId: args.roleId,
    sessionLineageId: args.execution.sessionLineageId,
    branchId: args.execution.branchId,
    sessionId: args.sessionId,
    directory: args.sessionDirectory ?? roleDirs.roleDir,
    createdAt: previous?.createdAt ?? args.execution.startedAt,
    lastPromptAt: args.execution.startedAt,
    lastMessageId: args.messageId,
    promptCount:
      previous?.sessionId === args.sessionId ? previous.promptCount + 1 : (previous?.promptCount ?? 0) + 1
  };
  args.context.sessionRecordsByKey.set(args.execution.sessionKey, record);
  const content = redactJsonForStorage(record, args.context.redaction);
  await mkdir(args.execution.executionDir, { recursive: true });
  await writeAtomicFile(roleDirs.latestSessionPath, content);
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
          redactJsonForStorage(args.roleInputProjection, args.context.redaction),
          "```"
        ].join("\n")
      },
      {
        path: "prompt.md",
        content: `${redactPromptText(args.prompt, args.context.redaction)}\n`
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
        content: redactJsonForStorage(args.execution, args.context.redaction)
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
      content: redactJsonForStorage(args.audit, args.context.redaction)
    }
  ];
  if (args.output) {
    files.push(
      {
        path: "result.json",
        content: redactJsonForStorage(args.output, args.context.redaction)
      },
      {
        path: "outbox.md",
        content: `${redactPromptText(args.output.content ?? "", args.context.redaction)}\n`
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
  const encoded = `${stringifyRedactedUnknown(payload, context.redaction)}\n`;
  const state = getBufferedAppendState(context.runDir);
  state.pendingByKey.set("events", {
    key: "events",
    path: context.eventsPath,
    content: `${state.pendingByKey.get("events")?.content ?? ""}${encoded}`
  });

  const payloadType = typeof payload.type === "string" ? payload.type : "";
  const roleId = typeof payload.roleId === "string" ? payload.roleId : "";
  if (payloadType === "audit" && roleId) {
    const key = `role-log:${roleId}`;
    state.pendingByKey.set(key, {
      key,
      path: resolve(context.roleLogsDir, `${roleId}.ndjson`),
      content: `${state.pendingByKey.get(key)?.content ?? ""}${encoded}`
    });
    return;
  }

  state.pendingByKey.set("engine-log", {
    key: "engine-log",
    path: context.engineLogPath,
    content: `${state.pendingByKey.get("engine-log")?.content ?? ""}${encoded}`
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

export function chainBufferedFlush(
  state: BufferedAppendState,
  runFlush: () => Promise<void>
): Promise<void> {
  // The token guards against an older queued flush clearing the promise that a newer flush
  // still depends on.
  const flushToken = Symbol("flush");
  const queuedFlush = (state.flushPromise ?? Promise.resolve()).then(runFlush);
  const activeFlush = queuedFlush.finally(() => {
    if (state.flushToken === flushToken && state.flushPromise === activeFlush) {
      state.flushPromise = undefined;
      state.flushToken = undefined;
    }
  });

  state.flushToken = flushToken;
  state.flushPromise = activeFlush;
  return activeFlush;
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
          // Recovery semantics: persist the pending append in a replay bin so the next startup can finish it.
          await writeBufferedAppendRecovery(context.runDir, batch);
          throw error;
        }
      }
  };

  await chainBufferedFlush(state, runFlush);
}

export async function loadAuditTrailFromEvents(args: {
  context: RunContext;
  allowedRoleIds?: Set<string>;
}): Promise<AuditRecord[]> {
  if (!(await pathExists(args.context.eventsPath))) {
    return [];
  }

  const audits: AuditRecord[] = [];
  const reader = createInterface({
    input: createReadStream(args.context.eventsPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as { type?: unknown }).type !== "audit"
    ) {
      continue;
    }
    const { type: _type, ...rest } = parsed as Record<string, unknown>;
    if (
      args.allowedRoleIds &&
      (!("roleId" in rest) ||
        typeof rest.roleId !== "string" ||
        !args.allowedRoleIds.has(rest.roleId))
    ) {
      continue;
    }
    audits.push(rest as AuditRecord);
  }

  return audits;
}
