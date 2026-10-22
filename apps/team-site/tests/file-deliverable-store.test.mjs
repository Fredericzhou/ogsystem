import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireProjectWriteLock } from "../../../dist/runtime/project-run-lock.js";
import { createFileDeliverableStore } from "../infrastructure/file-deliverable-store.mjs";

test("Deliverable snapshots publish atomically and archive each Run idempotently", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-deliverable-"));
  const store = createFileDeliverableStore();
  const project = { projectType: "collaboration", workdir };
  try {
    const metadata = { taskId: "task-1", runId: "run-1", attemptNumber: 1 };
    const first = await store.archive(project, metadata, "first result");
    const replay = await store.archive(project, metadata, "changed replay must not overwrite");
    const second = await store.archive(project, { ...metadata, runId: "run-2", attemptNumber: 2 }, "second result");
    assert.equal(replay.deliverableId, first.deliverableId);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(await store.readContent(project, first.deliverableId), "first result");
    assert.equal(await store.readContent(project, second.deliverableId), "second result");
    assert.equal((await store.list(project)).length, 2);
    assert.deepEqual((await readdir(join(workdir, "workspace", "deliverables"))).sort(), [first.deliverableId, second.deliverableId].sort());
    assert.equal(JSON.parse(await readFile(join(workdir, ".site", "deliverables.json"), "utf8")).items.length, 2);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("archive recovers a complete published snapshot and removes interrupted temporary writes", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-deliverable-recovery-"));
  const store = createFileDeliverableStore();
  const project = { projectType: "collaboration", workdir };
  const root = join(workdir, "workspace", "deliverables");
  const orphanId = "orphan-deliverable";
  const interrupted = join(root, ".interrupted.tmp");
  const orphan = join(root, orphanId);
  try {
    await mkdir(interrupted, { recursive: true });
    await writeFile(join(interrupted, "content.txt"), "partial");
    await mkdir(orphan, { recursive: true });
    const orphanContent = "complete result";
    const metadata = {
      deliverableId: orphanId,
      taskId: "task-1",
      runId: "run-1",
      attemptNumber: 1,
      digest: createHash("sha256").update(orphanContent).digest("hex")
    };
    await writeFile(join(orphan, "metadata.json"), JSON.stringify(metadata));
    await writeFile(join(orphan, "content.txt"), orphanContent);
    await mkdir(join(workdir, ".site"), { recursive: true });
    await writeFile(join(workdir, ".site", "deliverables.json.temporary.tmp"), "partial index");

    const replay = await store.archive(project, { taskId: "task-1", runId: "run-1", attemptNumber: 1 }, "ignored replay");

    assert.equal(replay.deliverableId, orphanId);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(await store.readContent(project, orphanId), "complete result");
    assert.deepEqual(await readdir(root), [orphanId]);
    assert.deepEqual(await readdir(join(workdir, ".site")), ["deliverables.json"]);
    assert.equal(JSON.parse(await readFile(join(workdir, ".site", "deliverables.json"), "utf8")).items.length, 1);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("list recovers published snapshots and excludes content whose digest no longer matches", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-deliverable-integrity-"));
  const store = createFileDeliverableStore();
  const project = { projectType: "collaboration", workdir };
  try {
    const recovered = await store.archive(project, { taskId: "task-1", runId: "run-1", attemptNumber: 1 }, "valid result");
    await rm(join(workdir, ".site", "deliverables.json"));
    assert.deepEqual((await store.list(project)).map((item) => item.deliverableId), [recovered.deliverableId]);

    await writeFile(join(workdir, "workspace", "deliverables", recovered.deliverableId, "content.txt"), "tampered result");
    assert.deepEqual(await store.list(project), []);
    await assert.rejects(store.readContent(project, recovered.deliverableId), /DELIVERABLE_NOT_FOUND/);
    assert.deepEqual(JSON.parse(await readFile(join(workdir, ".site", "deliverables.json"), "utf8")).items, []);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("concurrent archive requests for the same Run resolve idempotently to one snapshot", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-deliverable-concurrent-"));
  const store = createFileDeliverableStore();
  const project = { projectType: "collaboration", workdir };
  try {
    const metadata = { taskId: "task-1", runId: "run-1", attemptNumber: 1 };
    const concurrent = await Promise.all([
      store.archive(project, metadata, "first concurrent result"),
      store.archive(project, metadata, "second concurrent result")
    ]);
    assert.equal(concurrent[0].deliverableId, concurrent[1].deliverableId);
    assert.equal(concurrent.filter((item) => item.idempotentReplay).length, 1);
    assert.equal((await store.list(project)).length, 1);
    assert.ok(["first concurrent result", "second concurrent result"].includes(await store.readContent(project, concurrent[0].deliverableId)));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("deliverable index recovery does not contend with Project Run writes", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-deliverable-run-lock-"));
  const store = createFileDeliverableStore();
  const project = { projectType: "collaboration", workdir };
  const runLock = await acquireProjectWriteLock(workdir, "project-run");
  try {
    assert.deepEqual(await store.list(project), []);
    await assert.rejects(readFile(join(workdir, ".site", "deliverable-index.lock"), "utf8"), { code: "ENOENT" });
    const projectLock = JSON.parse(await readFile(join(workdir, ".site", "project-write.lock"), "utf8"));
    assert.equal(projectLock.lockId, runLock.metadata.lockId, "listing must leave the Project Run lock untouched");
  } finally {
    await runLock.release();
    await rm(workdir, { recursive: true, force: true });
  }
});

test("deliverable storage fails closed on symlink and junction path components", async (t) => {
  const cases = [".site", "workspace", "workspace/deliverables"];
  for (const component of cases) {
    await t.test(component, async (t) => {
      const workdir = await mkdtemp(join(tmpdir(), "ogs-deliverable-link-"));
      const outside = await mkdtemp(join(tmpdir(), "ogs-deliverable-outside-"));
      const parent = component.includes("/") ? join(workdir, "workspace") : workdir;
      const target = join(workdir, component);
      await mkdir(parent, { recursive: true });
      try {
        await symlink(outside, target, "junction");
      } catch (error) {
        await rm(workdir, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("directory links are unavailable on this host");
        throw error;
      }
      try {
        await assert.rejects(
          createFileDeliverableStore().archive({ projectType: "collaboration", workdir }, { runId: "run-1" }, "result"),
          /DELIVERABLE_LINK_NOT_ALLOWED/
        );
        assert.deepEqual(await readdir(outside), []);
      } finally {
        await rm(workdir, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    });
  }
});

test("listing validates a linked project metadata directory before touching its lock", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-deliverable-list-link-"));
  const outside = await mkdtemp(join(tmpdir(), "ogs-deliverable-list-outside-"));
  const staleLock = join(outside, "project-write.lock");
  const siteLink = join(workdir, ".site");
  await writeFile(staleLock, JSON.stringify({
    kind: "write",
    lockId: "stale-outside-lock",
    pid: -1,
    host: "different-host",
    createdAt: "2000-01-01T00:00:00.000Z",
    heartbeatAt: "2000-01-01T00:00:00.000Z"
  }));
  try {
    try {
      await symlink(outside, siteLink, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("directory links are unavailable on this host");
      throw error;
    }
    await assert.rejects(createFileDeliverableStore().list({ workdir }), /DELIVERABLE_LINK_NOT_ALLOWED/);
    assert.match(await readFile(staleLock, "utf8"), /stale-outside-lock/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("snapshot recovery rejects linked content files", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-deliverable-file-link-"));
  const outside = join(workdir, "outside.txt");
  const store = createFileDeliverableStore();
  const project = { projectType: "collaboration", workdir };
  try {
    const record = await store.archive(project, { runId: "run-1" }, "original");
    const contentPath = join(workdir, "workspace", "deliverables", record.deliverableId, "content.txt");
    await writeFile(outside, "external");
    await rm(contentPath);
    try {
      await symlink(outside, contentPath, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("file symlinks are unavailable on this host");
      throw error;
    }
    await assert.rejects(store.list(project), /DELIVERABLE_LINK_NOT_ALLOWED/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
