import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { assertCanonicalWorkspaceLock as assertLockRecord, type CanonicalWorkspaceLock } from "./workspace-contracts.js";

export class WorkspaceLockError extends Error {
  constructor(public readonly code: "WORKSPACE_LOCK_HELD" | "WORKSPACE_LOCK_STALE_HEAD" | "WORKSPACE_LOCK_INVALID" | "WORKSPACE_LOCK_OWNER_MISMATCH", message: string) {
    super(`[${code}] ${message}`);
    this.name = "WorkspaceLockError";
  }
}

function lockPath(workspaceDir: string): string {
  return resolve(workspaceDir, ".ogs", "workspace-lock.json");
}

async function readLock(path: string): Promise<CanonicalWorkspaceLock | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    assertLockRecord(value);
    return value;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    if (error instanceof WorkspaceLockError) throw error;
    throw new WorkspaceLockError("WORKSPACE_LOCK_INVALID", `cannot read canonical lock ${path}`);
  }
}

export async function readCanonicalWorkspaceLock(workspaceDir: string): Promise<CanonicalWorkspaceLock | undefined> {
  return readLock(lockPath(workspaceDir));
}

export async function acquireCanonicalWorkspaceLock(args: {
  workspaceDir: string;
  workspaceId: string;
  owner: string;
  expectedCanonicalHead: string;
  currentCanonicalHead?: string;
  leaseMs?: number;
  now?: Date;
}): Promise<{ lock: CanonicalWorkspaceLock; release: () => Promise<void> }> {
  const now = args.now ?? new Date();
  if (args.currentCanonicalHead !== undefined && args.currentCanonicalHead !== args.expectedCanonicalHead) throw new WorkspaceLockError("WORKSPACE_LOCK_STALE_HEAD", "expected canonical head does not match current head");
  const path = lockPath(args.workspaceDir);
  await mkdir(dirname(path), { recursive: true });
  const previous = await readLock(path);
  if (previous && Date.parse(previous.leaseUntil) > now.getTime()) throw new WorkspaceLockError("WORKSPACE_LOCK_HELD", `workspace lock is held by ${previous.owner}`);
  if (previous) {
    const reclaimPath = `${path}.reclaim`;
    const guard = await open(reclaimPath, "wx").catch(() => undefined);
    if (!guard) throw new WorkspaceLockError("WORKSPACE_LOCK_HELD", "expired workspace lock is being reclaimed");
    try {
      const current = await readLock(path);
      if (current && current.fencingToken === previous.fencingToken && Date.parse(current.leaseUntil) <= now.getTime()) await unlink(path);
    } finally {
      await guard.close();
      await unlink(reclaimPath).catch(() => undefined);
    }
  }
  const lock: CanonicalWorkspaceLock = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    workspaceId: args.workspaceId,
    owner: args.owner,
    leaseUntil: new Date(now.getTime() + (args.leaseMs ?? 60_000)).toISOString(),
    fencingToken: (previous?.fencingToken ?? 0) + 1,
    expectedCanonicalHead: args.expectedCanonicalHead
  };
  const handle = await open(path, "wx").catch(async (error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new WorkspaceLockError("WORKSPACE_LOCK_HELD", "workspace lock was claimed concurrently");
    throw error;
  });
  try {
    await handle.writeFile(JSON.stringify(lock) + "\n", "utf8");
  } finally {
    await handle.close();
  }
  let released = false;
  return {
    lock,
    release: async () => {
      if (released) return;
      released = true;
      const current = await readLock(path);
      if (!current) return;
      if (current.owner !== lock.owner || current.fencingToken !== lock.fencingToken) throw new WorkspaceLockError("WORKSPACE_LOCK_OWNER_MISMATCH", "lock was replaced by another owner");
      await unlink(path).catch((error) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      });
    }
  };
}

export async function assertCanonicalWorkspaceLock(args: {
  workspaceDir: string;
  lock: CanonicalWorkspaceLock;
  owner: string;
  fencingToken: number;
  expectedCanonicalHead: string;
  currentCanonicalHead: string;
  now?: Date;
}): Promise<void> {
  const current = await readCanonicalWorkspaceLock(args.workspaceDir);
  const now = (args.now ?? new Date()).getTime();
  if (!current || current.owner !== args.owner || current.fencingToken !== args.fencingToken || current.expectedCanonicalHead !== args.expectedCanonicalHead || Date.parse(current.leaseUntil) <= now) throw new WorkspaceLockError("WORKSPACE_LOCK_OWNER_MISMATCH", "canonical lock is not valid for this mutation");
  if (args.currentCanonicalHead !== args.expectedCanonicalHead) throw new WorkspaceLockError("WORKSPACE_LOCK_STALE_HEAD", "canonical head advanced while the lock was held");
}

export async function replaceCanonicalWorkspaceLock(workspaceDir: string, lock: CanonicalWorkspaceLock): Promise<void> {
  assertLockRecord(lock);
  const path = lockPath(workspaceDir);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(JSON.stringify(lock) + "\n", "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}
