import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hostname, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
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

test("concurrent processes reclaim one dead-owner lock without evicting the new owner", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-project-lock-reclaim-race-"));
  const siteDir = join(workdir, ".site");
  await mkdir(siteDir, { recursive: true });
  await writeFile(join(siteDir, "active-run.lock"), JSON.stringify({
    kind: "active-run", lockId: "dead-owner", runId: "run-1", pid: 99999999,
    host: hostname(), createdAt: new Date().toISOString(), heartbeatAt: new Date().toISOString()
  }));
  const moduleUrl = pathToFileURL(resolve("dist/runtime/project-run-lock.js")).href;
  const childSource = `
    import { access, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { acquireActiveRunLock } from ${JSON.stringify(moduleUrl)};
    const [workdir, name] = process.argv.slice(1);
    await writeFile(join(workdir, name + ".ready"), "ready");
    while (true) { try { await access(join(workdir, "go")); break; } catch { await new Promise(resolve => setTimeout(resolve, 5)); } }
    try {
      const lock = await acquireActiveRunLock(workdir, name);
      await writeFile(join(workdir, name + ".result"), "acquired");
      await new Promise(resolve => setTimeout(resolve, 250));
      await lock.release();
    } catch (error) {
      await writeFile(join(workdir, name + ".result"), "rejected:" + error.message);
    }
  `;
  const children = ["writer-a", "writer-b"].map((name) => new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", childSource, workdir, name], { stdio: "ignore" });
    child.once("error", rejectChild);
    child.once("exit", (code) => code === 0 ? resolveChild() : rejectChild(new Error(`lock contender exited with ${code}`)));
  }));
  try {
    const deadline = Date.now() + 5000;
    let bothReady = false;
    while (Date.now() < deadline) {
      try {
        await Promise.all([access(join(workdir, "writer-a.ready")), access(join(workdir, "writer-b.ready"))]);
        bothReady = true;
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
    }
    assert.equal(bothReady, true, "both lock contenders must reach the start barrier");
    await writeFile(join(workdir, "go"), "go");
    await Promise.all(children);
    const results = await Promise.all(["writer-a", "writer-b"].map((name) => readFile(join(workdir, name + ".result"), "utf8")));
    assert.equal(results.filter((result) => result === "acquired").length, 1, results.join("\n"));
    assert.equal(results.filter((result) => result.startsWith("rejected:")).length, 1, results.join("\n"));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("a leftover stale-reclaim guard fails closed and distinct run directories stay independent", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-project-lock-guard-"));
  const guarded = join(root, "guarded-run");
  const firstRun = join(root, "first-run");
  const other = join(root, "other-run");
  try {
    await mkdir(join(guarded, ".site"), { recursive: true });
    await mkdir(join(firstRun, ".site"), { recursive: true });
    await mkdir(join(other, ".site"), { recursive: true });
    await writeFile(join(guarded, ".site", "active-run.lock"), JSON.stringify({
      kind: "active-run", lockId: "dead-owner", runId: "guarded", pid: 99999999,
      host: hostname(), createdAt: "2000-01-01T00:00:00.000Z", heartbeatAt: "2000-01-01T00:00:00.000Z"
    }));
    await writeFile(join(guarded, ".site", "active-run.lock.reclaim.lock"), "left by crashed reclaimer");
    await assert.rejects(acquireActiveRunLock(guarded, "guarded"), /reclamation guard is occupied/);

    const first = await acquireActiveRunLock(firstRun, "one");
    const second = await acquireActiveRunLock(other, "two");
    await first.release();
    await second.release();
  } finally {
    await rm(root, { recursive: true, force: true });
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
