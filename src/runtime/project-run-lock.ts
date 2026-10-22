import { hostname } from "node:os";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { parse, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export type ProjectLockKind = "write" | "active-run" | "deliverable-index";

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
  constructor(message: string, public readonly metadata?: ProjectLockMetadata, public readonly retryable = false) {
    super(message);
    this.name = "ProjectLockError";
  }
}

function lockPath(workdir: string, kind: ProjectLockKind): string {
  const filename = kind === "write"
    ? "project-write.lock"
    : kind === "active-run"
      ? "active-run.lock"
      : "deliverable-index.lock";
  return resolve(workdir, ".site", filename);
}

async function ensureSafeLockDirectory(workdir: string): Promise<void> {
  const root = resolve(workdir);
  const filesystemRoot = parse(root).root;
  let current = filesystemRoot;
  for (const segment of relative(filesystemRoot, root).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    let stats = await lstat(current).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stats) {
      await mkdir(current, { recursive: false }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
      stats = await lstat(current);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new ProjectLockError(`Project lock directory must be a real directory: ${current}`);
    }
  }
  const metadataDir = resolve(root, ".site");
  let metadataStat = await lstat(metadataDir).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (!metadataStat) {
    await mkdir(metadataDir, { recursive: false }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    metadataStat = await lstat(metadataDir);
  }
  if (metadataStat.isSymbolicLink() || !metadataStat.isDirectory()) throw new ProjectLockError(`Project metadata directory must be a real directory: ${metadataDir}`);
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
  if (!expired) throw new ProjectLockError(`Project lock is active: ${path}`, metadata, true);
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
  await ensureSafeLockDirectory(args.workdir);
  const path = lockPath(args.workdir, args.kind);
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
