import { hostname } from "node:os";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type ProjectLockKind = "write" | "active-run";

export type ProjectLockMetadata = {
  kind: ProjectLockKind;
  lockId: string;
  runId?: string;
  pid: number;
  host: string;
  createdAt: string;
  heartbeatAt: string;
  operation?: string;
};

export class ProjectLockError extends Error {
  readonly code = "PROJECT_LOCK_CONFLICT";
  constructor(message: string, public readonly metadata?: ProjectLockMetadata) {
    super(message);
    this.name = "ProjectLockError";
  }
}

function lockPath(workdir: string, kind: ProjectLockKind): string {
  return resolve(workdir, ".site", kind === "write" ? "project-write.lock" : "active-run.lock");
}

async function readLock(path: string): Promise<ProjectLockMetadata | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ProjectLockMetadata;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return undefined;
    throw new ProjectLockError(`Cannot inspect lock safely: ${path}`);
  }
}

function processIsAlive(pid: number): boolean | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ESRCH") return false;
    return undefined;
  }
}

async function clearStaleLock(path: string, metadata: ProjectLockMetadata): Promise<void> {
  const heartbeat = Date.parse(metadata.heartbeatAt || metadata.createdAt);
  const expired = !Number.isFinite(heartbeat) || Date.now() - heartbeat > 30_000;
  if (!expired) throw new ProjectLockError(`Project lock is active: ${path}`, metadata);
  if (metadata.host !== hostname()) {
    throw new ProjectLockError(`Project lock ownership is uncertain on another host: ${path}`, metadata);
  }
  const alive = processIsAlive(metadata.pid);
  if (alive !== false) {
    throw new ProjectLockError(`Project lock ownership is uncertain: ${path}`, metadata);
  }
  await unlink(path).catch((error) => {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  });
}

export async function acquireProjectLock(args: {
  workdir: string;
  kind: ProjectLockKind;
  runId?: string;
  operation?: string;
}): Promise<{ metadata: ProjectLockMetadata; release: () => Promise<void> }> {
  const path = lockPath(args.workdir, args.kind);
  await mkdir(dirname(path), { recursive: true });
  const metadata: ProjectLockMetadata = {
    kind: args.kind,
    lockId: randomUUID(),
    ...(args.runId ? { runId: args.runId } : {}),
    pid: process.pid,
    host: hostname(),
    createdAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    ...(args.operation ? { operation: args.operation } : {})
  };
  try {
    const handle = await open(path, "wx");
    await handle.writeFile(JSON.stringify(metadata, null, 2) + "\n", "utf8");
    await handle.close();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "EEXIST") throw error;
    const existing = await readLock(path);
    if (existing) await clearStaleLock(path, existing);
    return acquireProjectLock(args);
  }
  let released = false;
  let heartbeatWork = Promise.resolve();
  const runHeartbeat = async (): Promise<void> => {
    if (released) return;
    const current = await readLock(path);
    if (released || !current || current.lockId !== metadata.lockId) return;
    current.heartbeatAt = new Date().toISOString();
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(current, null, 2) + "\n", "utf8");
      if (released) {
        await unlink(temp).catch(() => undefined);
        return;
      }
      await rename(temp, path);
    } catch {
      await unlink(temp).catch(() => undefined);
    }
  };
  const heartbeat = setInterval(() => {
    heartbeatWork = heartbeatWork.then(runHeartbeat).catch(() => undefined);
  }, 10_000);
  heartbeat.unref?.();
  return {
    metadata,
    release: async () => {
      released = true;
      clearInterval(heartbeat);
      await heartbeatWork;
      const current = await readLock(path);
      if (current?.lockId !== metadata.lockId) return;
      await unlink(path).catch((error) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      });
    }
  };
}

export const acquireProjectWriteLock = (workdir: string, operation?: string) =>
  acquireProjectLock({ workdir, kind: "write", operation });

export const acquireActiveRunLock = (workdir: string, runId: string) =>
  acquireProjectLock({ workdir, kind: "active-run", runId, operation: "project-run" });
