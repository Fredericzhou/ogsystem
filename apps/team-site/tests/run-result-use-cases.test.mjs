import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunResultUseCases } from "../application/run-result-use-cases.mjs";
import { createFileRunResultStore } from "../infrastructure/file-run-result-store.mjs";

test("Run result use case reads only final output and returns unavailable when absent", async () => {
  const runs = new Map([
    ["run-1", { projectId: "collaboration-1", runtimeProjectId: "team-1", teamVersionId: "team-1", taskId: "task-1", runId: "run-1", attemptNumber: 2 }],
    ["run-2", { projectId: "collaboration-1", runtimeProjectId: "team-1", teamVersionId: "team-1", taskId: "task-1", runId: "run-2", attemptNumber: 3 }]
  ]);
  const runResultStore = { readFinalOutput: async (run) => run.runId === "run-1" ? "  complete output  " : undefined };
  const useCases = createRunResultUseCases({ getRun: async (_projectId, runId) => runs.get(runId), runResultStore });

  assert.deepEqual(await useCases.getProjectRunResult("collaboration-1", "run-1"), {
    collaborationProjectId: "collaboration-1", runtimeProjectId: "team-1",
    teamVersionId: "team-1", taskId: "task-1", runId: "run-1", attemptNumber: 2,
    available: true, result: { finalOutput: "  complete output  " }
  });
  assert.deepEqual(await useCases.getProjectRunResult("collaboration-1", "run-2"), {
    collaborationProjectId: "collaboration-1", runtimeProjectId: "team-1",
    teamVersionId: "team-1", taskId: "task-1", runId: "run-2", attemptNumber: 3,
    available: false, result: null
  });
});

test("file Run result store reads only graph final output and redacts credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-result-"));
  const statePath = join(root, "team-1", ".ogs", "runs", "run-1", "state.json");
  try {
    await mkdir(join(root, "team-1", ".ogs", "runs", "run-1"), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      graphState: { finalOutput: "Authorization: Bearer abcdefghijklmnop" },
      privateRuntimeField: "must not escape"
    }), "utf8");
    const store = createFileRunResultStore({ projectsRoot: root });
    assert.match(await store.readFinalOutput({ runtimeProjectId: "team-1", runId: "run-1" }), /\[REDACTED\]/);
    assert.equal(await store.readFinalOutput({ runtimeProjectId: "team-1", runId: "missing" }), undefined);
    await assert.rejects(store.readFinalOutput({ runtimeProjectId: "../outside", runId: "run-1" }), /runtimeProjectId is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
