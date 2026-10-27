import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTeamRunStore, TeamRunConflictError } from "../dist/team-ir/index.js";

function record(runId = "run-1") {
  return {
    runId,
    revision: 0,
    status: "queued",
    compiledPlanDigest: "a".repeat(64),
    createdAt: 10,
    updatedAt: 10,
    runInput: { task: "test", input: {}, preferences: {}, attachments: {} },
    activeExecutionBudgetMs: 1000,
    activeExecutionMs: 0,
    invocations: {},
    events: []
  };
}

async function withStoreRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "team-ir-store-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("FileTeamRunStore loads committed Run records through a new store instance", async () => {
  await withStoreRoot(async (root) => {
    const firstProcess = new FileTeamRunStore(root);
    await firstProcess.create(record());
    const initial = await firstProcess.load("run-1");
    const next = { ...initial, revision: 1, status: "running", updatedAt: 11 };
    assert.equal(await firstProcess.compareAndSet("run-1", 0, next), true);

    const afterRestart = new FileTeamRunStore(root);
    assert.deepEqual(await afterRestart.load("run-1"), next);
    assert.deepEqual(await afterRestart.listRunIds(), ["run-1"]);
  });
});

test("concurrent compareAndSet calls linearize by revision", async () => {
  await withStoreRoot(async (root) => {
    const writerA = new FileTeamRunStore(root);
    const writerB = new FileTeamRunStore(root);
    await writerA.create(record());
    const candidateA = { ...record(), revision: 1, status: "running", updatedAt: 11 };
    const candidateB = { ...record(), revision: 1, status: "failing", updatedAt: 12 };
    const results = await Promise.all([
      writerA.compareAndSet("run-1", 0, candidateA),
      writerB.compareAndSet("run-1", 0, candidateB)
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal((await writerA.load("run-1")).revision, 1);
  });
});

test("failed atomic replacement preserves the previous record and removes its temp file", async () => {
  await withStoreRoot(async (root) => {
    const store = new FileTeamRunStore(root);
    await store.create(record());
    const path = join(root, "run-1.json");
    const backup = join(root, "run-1.backup");
    await rename(path, backup);
    await mkdir(path);
    const next = { ...record(), revision: 1, status: "running", updatedAt: 11 };

    await assert.rejects(store.compareAndSet("run-1", 0, next));
    assert.equal((await readdir(root)).some((entry) => entry.endsWith(".tmp")), false);
    assert.equal((await readFile(join(backup), "utf8")).includes('"revision":0'), true);

    await rm(path, { recursive: true });
    await rename(backup, path);
    assert.equal((await store.load("run-1")).revision, 0);
  });
});

test("duplicate create and invalid run paths fail explicitly", async () => {
  await withStoreRoot(async (root) => {
    const store = new FileTeamRunStore(root);
    await store.create(record());
    await assert.rejects(store.create(record()), TeamRunConflictError);
    await assert.rejects(store.load("../escape"), /TEAM_RUN_ID_INVALID/);
  });
});
