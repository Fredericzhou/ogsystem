import assert from "node:assert/strict";
import test from "node:test";
import { createRecentRunUseCases } from "../application/recent-run-use-cases.mjs";

test("recent Project Run query lists only Collaboration Project Task attempts", async () => {
  const useCases = createRecentRunUseCases({
    listProjects: async () => [
      {
        projectId: "collaboration",
        projectType: "collaboration",
        name: "Project",
        taskRecords: [{
          taskId: "task-1", taskNumber: 17, input: "Prepare report",
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
      async readRunArtifacts(_projectId, _taskId, runId) {
        return { state: { status: "completed", attemptNumber: runId === "run-1" ? 1 : 2, updatedAt: `2026-01-0${runId === "run-1" ? 1 : 2}T00:00:00Z` }, plan: { engine: "team-ir-v2" }, outputSummary: runId === "run-1" ? "Previous result" : "Latest result" };
      }
    }
  });

  const runs = await useCases.listRecentProjectRuns(2);
  assert.deepEqual(runs.map((run) => run.runId), ["run-2", "run-1"]);
  const retry = runs[0];
  assert.equal(retry.taskId, "task-1");
  assert.equal(retry.taskNumber, 17);
  assert.equal(retry.runKind, "project_task");
  assert.equal(retry.owner.projectId, "collaboration");
  assert.equal(retry.owner.teamVersionId, "team-version-1");
  assert.equal(Object.hasOwn(retry, "projectId"), false);
  assert.equal(retry.attemptNumber, 2);
  assert.equal(retry.isCurrent, true);
  assert.equal(retry.mode, "sandbox");
  assert.equal(retry.outputSummary, "Latest result");
  assert.equal(runs[1].isCurrent, false);
  assert.equal(runs[1].mode, "sandbox");
  assert.equal(runs[1].outputSummary, "Previous result");
  assert.equal(Object.hasOwn(retry, "roundNumber"), false);
});

test("recent Project Run query surfaces old-format Run rejection without a legacy reader", async () => {
  let legacyReads = 0;
  const useCases = createRecentRunUseCases({
    listProjects: async () => [{
      projectId: "collaboration",
      projectType: "collaboration",
      taskRecords: [{ taskId: "task-1", taskNumber: 1, currentRunId: "run-old", runIds: ["run-old"], status: "completed" }]
    }],
    runArtifactStore: {
      async readRunArtifacts() {
        throw new Error("TEAM_IR_V2_REQUIRED: Project Task attempts must use a Team IR v2 Run.");
      },
      async readLegacyRunArtifacts() { legacyReads += 1; }
    }
  });

  const [run] = await useCases.listRecentProjectRuns();
  assert.equal(run.status, "completed");
  assert.equal(run.error, "TEAM_IR_V2_REQUIRED: Project Task attempts must use a Team IR v2 Run.");
  assert.equal(legacyReads, 0);
});
