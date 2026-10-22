import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireActiveRunLock, acquireProjectWriteLock } from "../dist/runtime/project-run-lock.js";

test("project locks serialize active runs and release independently from write locks", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-project-lock-"));
  try {
    const writeLock = await acquireProjectWriteLock(workdir, "test");
    const activeLock = await acquireActiveRunLock(workdir, "run-1");
    await assert.rejects(() => acquireActiveRunLock(workdir, "run-2"), (error) => {
      assert.match(error.message, /Project lock is active|ownership is uncertain/);
      assert.equal(error.retryable, true);
      return true;
    });
    assert.equal(activeLock.metadata.runId, "run-1");
    await writeLock.release();
    const secondWrite = await acquireProjectWriteLock(workdir, "test-2");
    await secondWrite.release();
    await activeLock.release();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("an uncertain or live stale lock fails closed", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-project-lock-stale-"));
  try {
    const path = join(workdir, ".site", "active-run.lock");
    await mkdir(join(workdir, ".site"), { recursive: true });
    await writeFile(path, JSON.stringify({ kind: "active-run", lockId: "stale", runId: "run", pid: process.pid, host: "test", createdAt: "2000-01-01T00:00:00.000Z", heartbeatAt: "2000-01-01T00:00:00.000Z" }));
    await assert.rejects(() => acquireActiveRunLock(workdir, "new"), (error) => {
      assert.match(error.message, /ownership is uncertain/);
      assert.equal(error.retryable, false);
      return true;
    });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("project lock rejects a linked metadata directory before inspecting or removing an outside lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-project-lock-link-"));
  const workdir = join(root, "project");
  const outsideSite = join(root, "outside-site");
  const outsideLock = join(outsideSite, "project-write.lock");
  try {
    await mkdir(workdir, { recursive: true });
    await mkdir(outsideSite, { recursive: true });
    await writeFile(outsideLock, JSON.stringify({
      kind: "write",
      lockId: "stale-outside",
      pid: 99999999,
      host: "other-host",
      createdAt: "2000-01-01T00:00:00.000Z",
      heartbeatAt: "2000-01-01T00:00:00.000Z"
    }));
    try {
      await symlink(outsideSite, join(workdir, ".site"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) {
        t.skip(`directory links unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(acquireProjectWriteLock(workdir, "test"), /metadata directory must be a real directory/);
    assert.equal((await lstat(outsideLock)).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
