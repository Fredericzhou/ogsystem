import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectReadinessUseCases } from "../application/project-readiness-use-cases.mjs";
import { createRuntimeTaskExecutionReadiness } from "../infrastructure/runtime-task-execution-readiness.mjs";
import { computeProjectAssetDigest } from "../../../dist/runtime/project-asset-digest.js";

test("Project Readiness blocks a trained TeamVersion whose confirmation digest is stale", async () => {
  const checked = [];
  const projects = new Map([
    ["project", {
      projectId: "project",
      projectType: "collaboration",
      projectStatus: "confirmed",
      mountedTeams: [{ teamId: "team", teamVersionId: "team-v2" }]
    }],
    ["team-v2", {
      projectType: "team",
      teamId: "team",
      teamRootId: "team",
      teamVersionId: "team-v2",
      teamVersionStatus: "trained",
      workdir: "/private/team-v2"
    }]
  ]);
  const useCases = createProjectReadinessUseCases({
    getProject: async (id) => projects.get(id),
    readinessInspector: { inspect: async () => ({ canDryRun: true, blockers: [], warnings: [], missingBindings: [] }) },
    confirmation: {
      async assertCurrent(version) {
        checked.push(version.teamVersionId);
        throw new Error("PROJECT_CONFIRMATION_STALE: internal filesystem detail");
      }
    }
  });

  const readiness = await useCases.getProjectReadiness("project");
  assert.deepEqual(checked, ["team-v2"]);
  assert.equal(readiness.canDryRun, false);
  assert.deepEqual(readiness.blockers, [{
    code: "PROJECT_CONFIRMATION_STALE",
    severity: "blocker",
    message: "Trained TeamVersion assets changed; create and train a new TeamVersion before running.",
    teamVersionId: "team-v2"
  }]);
  assert.deepEqual(readiness.teams[0].blockers, [{
    code: "PROJECT_CONFIRMATION_STALE",
    severity: "blocker",
    message: "Trained TeamVersion assets changed; create and train a new TeamVersion before running."
  }]);
  assert.equal(JSON.stringify(readiness).includes("internal filesystem detail"), false);
});

test("Project Readiness checks frozen confirmation only for trained TeamVersions", async () => {
  let confirmationCalls = 0;
  const useCases = createProjectReadinessUseCases({
    getProject: async () => ({
      projectType: "team",
      teamVersionStatus: "draft",
      workdir: "/private/draft"
    }),
    readinessInspector: { inspect: async () => ({ canDryRun: true, blockers: [], warnings: [], missingBindings: [] }) },
    confirmation: { async assertCurrent() { confirmationCalls += 1; } }
  });

  const readiness = await useCases.getProjectReadiness("draft");
  assert.equal(readiness.canDryRun, true);
  assert.equal(confirmationCalls, 0);
});

test("Sandbox confirmation gives recovery guidance that matches the immutable version boundary", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-readiness-confirmation-"));
  try {
    await writeFile(join(workdir, "system.mmd"), "flowchart TD\n%% system.id=readiness.test\n%% system.version=1.0.0\n%% law.global=law.test\nstart[开始] -->|START| planner[Role:planner]\nplanner[Role:planner] -->|READY| end[结束]\n", "utf8");
    const digest = await computeProjectAssetDigest(workdir);
    await writeFile(join(workdir, "system.mmd"), "flowchart TD\n%% system.id=readiness.test\n%% system.version=1.0.0\n%% law.global=law.test\nstart[开始] -->|START| reviewer[Role:reviewer]\nreviewer[Role:reviewer] -->|READY| end[结束]\n", "utf8");
    const readiness = createRuntimeTaskExecutionReadiness({ inspect: async () => ({ canDryRun: true }) });
    await assert.rejects(
      readiness.requireCurrentConfirmation({ workdir, projectType: "team", teamVersionStatus: "trained", projectDigest: digest }),
      /PROJECT_CONFIRMATION_STALE: trained TeamVersion assets changed; create and train a new TeamVersion\./
    );
    await assert.rejects(
      readiness.requireCurrentConfirmation({ workdir, projectType: "collaboration", projectStatus: "confirmed", confirmedAt: "2026-11-20", projectDigest: digest }),
      /PROJECT_CONFIRMATION_STALE: Project semantic files changed; confirm the Project again\./
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
