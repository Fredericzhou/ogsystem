import assert from "node:assert/strict";
import test from "node:test";
import { createRecentRunUseCases } from "../application/recent-run-use-cases.mjs";

test("recent Run query projects Task attempts, sorts newest first, and bounds the result", async () => {
  const useCases = createRecentRunUseCases({
    listProjects: async () => [
      {
        projectId: "collaboration",
        projectType: "collaboration",
        name: "Project",
        taskRecords: [{
          taskId: "task-1", taskNumber: 17, input: "Prepare report", runProjectId: "team-version-1",
          teamId: "team-1", teamVersionId: "team-version-1", teamName: "Research",
          currentRunId: "run-2", runIds: ["run-1", "run-2"], status: "completed",
          updatedAt: "2026-01-01T00:00:00Z", outputSummary: "Done"
        }]
      },
      {
        projectId: "workspace",
        projectType: "workspace",
        teamProjectId: "team-version-1",
        name: "Workspace",
        runs: [{ runId: "run-3", status: "completed", updatedAt: "2026-01-03T00:00:00Z", prompt: "Another task" }]
      }
    ],
    runArtifactStore: {
      async readRunArtifacts(_projectId, runId) {
        return { state: { status: "completed", attemptNumber: runId === "run-1" ? 1 : 2, updatedAt: `2026-01-0${runId === "run-1" ? 1 : 2}T00:00:00Z` }, plan: { executionPolicy: { mode: "dry-run" } } };
      }
    }
  });

  const runs = await useCases.listRecentProjectRuns(2);
  assert.deepEqual(runs.map((run) => run.runId), ["run-3", "run-2"]);
  assert.equal(runs[0].collaborationProjectId, null);
  assert.equal(runs[0].taskId, null);
  assert.equal(runs[0].runtimeProjectId, "workspace");
  assert.equal(Object.hasOwn(runs[0], "projectId"), false);
  const retry = runs[1];
  assert.equal(retry.taskId, "task-1");
  assert.equal(retry.taskNumber, 17);
  assert.equal(retry.collaborationProjectId, "collaboration");
  assert.equal(retry.runtimeProjectId, "team-version-1");
  assert.equal(Object.hasOwn(retry, "projectId"), false);
  assert.equal(retry.attemptNumber, 2);
  assert.equal(retry.isCurrent, true);
  assert.equal(retry.mode, "dry-run");
  assert.equal(retry.outputSummary, "Done");
  assert.equal(Object.hasOwn(retry, "roundNumber"), false);
});
