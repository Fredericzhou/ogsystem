import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { acquireProjectWriteLock, ProjectLockError } from "../../../dist/runtime/project-run-lock.js";

export function createFileTeamLifecycleLocks({ projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects")) } = {}) {
  const root = resolve(projectsRoot);
  const nameLockPath = join(root, ".site", "team-name-creation");
  const nameLockQueues = new Map();
  const teamLockQueues = new Map();
  const teamLockContext = new AsyncLocalStorage();

  async function withLock(path, operation, action) {
    const lock = await acquireProjectWriteLock(path, operation);
    try {
      return await action();
    } finally {
      await lock.release();
    }
  }

  async function withTeamLock(teamId, action) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(teamId || ""))) throw new Error("Invalid Team id.");
    const lockPath = join(root, `.team-version-${teamId}`);
    const held = teamLockContext.getStore();
    if (held?.has(lockPath)) return action();
    const previous = teamLockQueues.get(lockPath) || Promise.resolve();
    let releaseQueue;
    const turn = new Promise((resolveTurn) => { releaseQueue = resolveTurn; });
    const queued = previous.then(() => turn);
    teamLockQueues.set(lockPath, queued);
    await previous;
    let lock;
    try {
      for (;;) {
        try {
          lock = await acquireProjectWriteLock(lockPath, "team-version");
          break;
        } catch (error) {
          if (!(error instanceof ProjectLockError) || !error.message.includes("Project lock is active:")) throw error;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
      }
      const next = new Set(held || []);
      next.add(lockPath);
      return await teamLockContext.run(next, action);
    } finally {
      await lock?.release();
      releaseQueue();
      if (teamLockQueues.get(lockPath) === queued) teamLockQueues.delete(lockPath);
    }
  }

  async function withTeamNameLock(action) {
    const previous = nameLockQueues.get(nameLockPath) || Promise.resolve();
    let releaseQueue;
    const turn = new Promise((resolveTurn) => { releaseQueue = resolveTurn; });
    const queued = previous.then(() => turn);
    nameLockQueues.set(nameLockPath, queued);
    await previous;
    let lock;
    try {
      for (;;) {
        try {
          lock = await acquireProjectWriteLock(nameLockPath, "team-name-create");
          break;
        } catch (error) {
          if (!(error instanceof ProjectLockError) || !error.message.includes("Project lock is active:")) throw error;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
      }
      return await action();
    } finally {
      await lock?.release();
      releaseQueue();
      if (nameLockQueues.get(nameLockPath) === queued) nameLockQueues.delete(nameLockPath);
    }
  }

  async function withCollaborationProjectNameLock(name, action) {
    const normalizedName = String(name || "").trim().toLocaleLowerCase();
    const digest = createHash("sha256").update(normalizedName).digest("hex");
    const lockPath = join(root, ".site", `collaboration-project-${digest}`);
    const previous = nameLockQueues.get(lockPath) || Promise.resolve();
    let releaseQueue;
    const turn = new Promise((resolveTurn) => { releaseQueue = resolveTurn; });
    const queued = previous.then(() => turn);
    nameLockQueues.set(lockPath, queued);
    await previous;
    let lock;
    try {
      for (;;) {
        try {
          lock = await acquireProjectWriteLock(lockPath, "collaboration-project-create");
          break;
        } catch (error) {
          if (!(error instanceof ProjectLockError) || !error.message.includes("Project lock is active:")) throw error;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
      }
      return await action();
    } finally {
      await lock?.release();
      releaseQueue();
      if (nameLockQueues.get(lockPath) === queued) nameLockQueues.delete(lockPath);
    }
  }

  return Object.freeze({
    withTeamNameLock,
    withCollaborationProjectNameLock,
    withWorkspaceBindingLock: (action) => withLock(join(root, ".workspace-binding"), "workspace-binding", action),
    withTeamVersionSaveLock: withTeamLock,
    withTeamVersionLock: withTeamLock
  });
}
