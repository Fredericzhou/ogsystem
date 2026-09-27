import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

import { writeJsonFileAtomic } from "../runtime/json-file.js";
import { loadSystemFromMermaid } from "../runtime/parse-mermaid.js";

export type ServeSession = {
  version: 1;
  sessionId: string;
  parentSessionId?: string;
  status: "active" | "stale";
  createdAt: string;
  systemPath: string;
  systemDigest: string;
  configurationDigest: string;
  workspaceDir: string;
  turns: Array<{ turnId: string; runId: string; idempotencyKey: string; status: string; requestDigest: string; dryRun?: boolean; createdAt: string }>;
};

export type ServeProject = { ogsDir: string; systemPath: string; workspaceDir: string };

function sessionsRoot(ogsDir: string): string {
  return resolve(ogsDir, ".ogs", "sessions");
}

async function digestFile(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
  try {
    hash.update(relative(process.cwd(), path)).update("\0").update(await readFile(path)).update("\0");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function digestDirectory(hash: ReturnType<typeof createHash>, root: string, excludedRootEntries: Set<string> = new Set()): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (dir === root && excludedRootEntries.has(entry.name)) continue;
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".ogs") continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) await digestFile(hash, path);
    }
  };
  await walk(root);
}

export async function fingerprintServeProject(project: ServeProject): Promise<{ systemDigest: string; configurationDigest: string }> {
  const source = await readFile(project.systemPath);
  const systemDigest = createHash("sha256").update(source).digest("hex");
  const hash = createHash("sha256");
  hash.update(systemDigest).update("\0").update(resolve(project.workspaceDir));
  for (const name of [".ogs/runtime.json", ".ogs/model-selection.json", ".ogs/model-catalog.json", ".ogs/laws.json", ".ogs/user-profile.json", ".ogs/project.json", "profiles.json", "tools.json"]) {
    await digestFile(hash, resolve(project.ogsDir, name));
  }
  await digestDirectory(hash, resolve(project.ogsDir, ".ogs"), new Set(["runs", "sessions", "runs-index.json"]));
  const runtimeRecord = JSON.parse(await readFile(resolve(project.ogsDir, ".ogs", "runtime.json"), "utf8").catch(() => "{}")) as { roleRepo?: unknown };
  const roleRepo = typeof runtimeRecord.roleRepo === "string" && runtimeRecord.roleRepo.trim()
    ? resolve(project.ogsDir, runtimeRecord.roleRepo)
    : resolve(project.ogsDir, "og-roles");
  await digestDirectory(hash, roleRepo);
  const system = await loadSystemFromMermaid(project.systemPath);
  if (system.graph?.handoffContracts) await digestFile(hash, system.graph.handoffContracts);
  return { systemDigest, configurationDigest: hash.digest("hex") };
}

export async function createServeSession(args: {
  project: ServeProject;
  parentSessionId?: string;
}): Promise<ServeSession> {
  const fingerprint = await fingerprintServeProject(args.project);
  const sessionId = randomUUID();
  const session: ServeSession = {
    version: 1,
    sessionId,
    ...(args.parentSessionId ? { parentSessionId: args.parentSessionId } : {}),
    status: "active",
    createdAt: new Date().toISOString(),
    systemPath: args.project.systemPath,
    ...fingerprint,
    workspaceDir: resolve(args.project.workspaceDir),
    turns: []
  };
  const dir = resolve(sessionsRoot(args.project.ogsDir), sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "system.mmd"), await readFile(args.project.systemPath));
  await writeJsonFileAtomic(resolve(dir, "session.json"), session);
  return session;
}

export async function readServeSession(ogsDir: string, sessionId: string): Promise<ServeSession | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return undefined;
  try {
    return JSON.parse(await readFile(resolve(sessionsRoot(ogsDir), sessionId, "session.json"), "utf8")) as ServeSession;
  } catch { return undefined; }
}

export async function listServeSessions(ogsDir: string): Promise<ServeSession[]> {
  let entries;
  try { entries = await readdir(sessionsRoot(ogsDir), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const sessions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readServeSession(ogsDir, entry.name)));
  return sessions.filter((session): session is ServeSession => Boolean(session)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function persistServeSession(ogsDir: string, session: ServeSession): Promise<void> {
  await writeJsonFileAtomic(resolve(sessionsRoot(ogsDir), session.sessionId, "session.json"), session);
}
