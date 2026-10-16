import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireActiveRunLock, acquireProjectWriteLock } from "../dist/runtime/project-run-lock.js";

test("project locks serialize active runs and release independently from write locks", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-project-lock-"));
  try {
    const writeLock = await acquireProjectWriteLock(workdir, "test");
    const activeLock = await acquireActiveRunLock(workdir, "run-1");
    await assert.rejects(() => acquireActiveRunLock(workdir, "run-2"), /Project lock is active|ownership is uncertain/);
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
    await assert.rejects(() => acquireActiveRunLock(workdir, "new"), /ownership is uncertain/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
