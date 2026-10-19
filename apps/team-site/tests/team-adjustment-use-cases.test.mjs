import assert from "node:assert/strict";
import test from "node:test";
import { createTeamAdjustmentUseCases } from "../application/team-adjustment-use-cases.mjs";

test("Team adjustment forks a mounted version and returns project context without changing its mount", async () => {
  const project = {
    projectType: "collaboration",
    projectId: "project-1",
    mountedTeams: [{ teamVersionId: "team-v1" }]
  };
  const calls = [];
  const useCases = createTeamAdjustmentUseCases({
    projectStore: { async getProject(id) { calls.push(["project", id]); return structuredClone(project); } },
    async forkTeamVersion(id) { calls.push(["fork", id]); return { projectId: "team-v2", parentTeamVersionId: id, teamVersionStatus: "editing" }; }
  });
  const result = await useCases.createProjectTeamAdjustment("project-1", "team-v1");
  assert.deepEqual(result, {
    draft: { projectId: "team-v2", parentTeamVersionId: "team-v1", teamVersionStatus: "editing" },
    collaborationProjectId: "project-1",
    sourceTeamVersionId: "team-v1"
  });
  assert.deepEqual(calls, [["project", "project-1"], ["fork", "team-v1"]]);
  assert.deepEqual(project.mountedTeams, [{ teamVersionId: "team-v1" }]);
});

test("Team adjustment rejects a non-project or unmounted source before creating a draft", async () => {
  let forks = 0;
  const useCases = createTeamAdjustmentUseCases({
    projectStore: { async getProject(id) { return id === "workspace" ? { projectType: "workspace" } : { projectType: "collaboration", mountedTeams: [] }; } },
    async forkTeamVersion() { forks += 1; return {}; }
  });
  await assert.rejects(() => useCases.createProjectTeamAdjustment("workspace", "team-v1"), /PROJECT_TYPE_INVALID/);
  await assert.rejects(() => useCases.createProjectTeamAdjustment("project-1", "team-v1"), /TEAM_VERSION_NOT_MOUNTED/);
  assert.equal(forks, 0);
});
