import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { readJsonFile } from "./json-file.js";
import type {
  AuditRecord,
  OpencodeSessionRecord,
  RoleExecutionOutput,
  RoleExecutionRecord,
  RoleRunDirs,
  RunContext,
  RuntimeConfig,
  SystemDefinition
} from "./types.js";
import { stringifyJson } from "./runtime-support.js";

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "run";
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
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

function buildExecutionId(executionIndex: number, startedAt: string): string {
  return `${String(executionIndex).padStart(4, "0")}-${startedAt.replace(/[:.]/g, "-")}`;
}

async function persistSessionSnapshot(context: RunContext): Promise<void> {
  await writeFile(
    context.sessionsPath,
    stringifyJson(
      Array.from(context.sessionRecordsByRoleId.values()).sort((left, right) =>
        left.roleId.localeCompare(right.roleId)
      )
    ),
    "utf8"
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
        `${timestampForPath(createdAt)}-${slugify(args.system.systemId)}`
      );
  const runId = basename(runDir);
  const auditDir = resolve(runDir, "audit");
  const rolesRootDir = resolve(runDir, args.runtimeConfig.workspace.rolesDir);
  const sharedDir = resolveSharedDir({
    runDir,
    workdir: args.workdir,
    runtimeConfig: args.runtimeConfig
  });
  const roleDirsById = new Map<string, RoleRunDirs>();
  const roleExecutionCounts = new Map<string, number>();

  await mkdir(auditDir, { recursive: true });
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

  return {
    runId,
    runDir,
    auditDir,
    eventsPath: resolve(runDir, "events.ndjson"),
    statePath: resolve(runDir, "state.json"),
    opencodeServerPath: resolve(runDir, "opencode-server.json"),
    sessionsPath,
    roleDirsById,
    roleExecutionCounts,
    sessionRecordsByRoleId,
    sharedDir
  };
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
  await writeFile(roleDirs.sessionPath, content, "utf8");
  await writeFile(resolve(args.execution.executionDir, "session.json"), content, "utf8");
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
  await appendFile(context.eventsPath, `${JSON.stringify(payload)}\n`, "utf8");
}
