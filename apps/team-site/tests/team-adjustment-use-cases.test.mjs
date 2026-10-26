import assert from "node:assert/strict";
import test from "node:test";
import { createTeamAdjustmentUseCases } from "../application/team-adjustment-use-cases.mjs";

test("Team adjustment opens a mounted released version without forking before a change is saved", async () => {
  const project = {
    projectType: "collaboration",
    projectId: "project-1",
    mountedTeams: [{ teamVersionId: "team-v1" }]
  };
  const calls = [];
  let forks = 0;
  const source = { projectId: "team-v1", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const useCases = createTeamAdjustmentUseCases({
    projectStore: { async getProject(id) { calls.push(["project", id]); return structuredClone(project); } },
    async getTeamVersion(id) { calls.push(["team", id]); return source; },
    async forkTeamVersion() { forks += 1; }
  });
  const result = await useCases.createProjectTeamAdjustment("project-1", "team-v1");
  assert.deepEqual(result, {
    teamVersion: source,
    collaborationProjectId: "project-1",
    sourceTeamVersionId: "team-v1"
  });
  assert.deepEqual(calls, [["project", "project-1"], ["team", "team-v1"]]);
  assert.equal(forks, 0);
  assert.deepEqual(project.mountedTeams, [{ teamVersionId: "team-v1" }]);
});

test("Team adjustment rejects a non-project or unmounted source before creating a draft", async () => {
  let forks = 0;
  const useCases = createTeamAdjustmentUseCases({
    projectStore: { async getProject(id) { return id === "workspace" ? { projectType: "workspace" } : { projectType: "collaboration", mountedTeams: [] }; } },
    async getTeamVersion() { forks += 1; return { teamVersionStatus: "draft" }; }
  });
  await assert.rejects(() => useCases.createProjectTeamAdjustment("workspace", "team-v1"), /PROJECT_TYPE_INVALID/);
  await assert.rejects(() => useCases.createProjectTeamAdjustment("project-1", "team-v1"), /TEAM_VERSION_NOT_MOUNTED/);
  assert.equal(forks, 0);
});

test("Team adjustment rejects a mounted draft without creating another version", async () => {
  const useCases = createTeamAdjustmentUseCases({
    projectStore: { async getProject() { return { projectType: "collaboration", mountedTeams: [{ teamVersionId: "team-v1" }] }; } },
    async getTeamVersion() { return { teamVersionStatus: "draft" }; }
  });
  await assert.rejects(() => useCases.createProjectTeamAdjustment("project-1", "team-v1"), /TEAM_VERSION_NOT_RELEASED/);
});
