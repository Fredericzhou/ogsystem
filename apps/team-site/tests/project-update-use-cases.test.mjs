import assert from "node:assert/strict";
import test from "node:test";
import { createProjectUpdateUseCases } from "../application/project-update-use-cases.mjs";

function setup(project = {}) {
  const current = {
    projectId: "project-1",
    projectType: "team",
    name: "Software Team",
    teamName: "Software Team",
    teamRootId: "team-1",
    overview: "Current overview",
    projectStatus: "confirmed",
    projectDigest: "digest",
    confirmedAt: "2026-10-01T00:00:00.000Z",
    ...structuredClone(project)
  };
  const calls = [];
  const useCases = createProjectUpdateUseCases({
    projectStore: {
      async getProject() { return structuredClone(current); },
      async withProjectWriteLock(projectId, operation, action) { calls.push(["lock", projectId, operation]); return action(); },
      async saveProjectMetadata(projectId, metadata) { calls.push(["save", projectId]); Object.assign(current, metadata); return structuredClone(current); }
    },
    teamCatalog: { async assertTeamNameAvailable(name, options) { calls.push(["name", name, options]); } },
    computeProjectDefinitionDigest: (project) => `digest:${project.name}:${project.overview}`
  });
  return { useCases, current, calls };
}

test("Project update trims bounded fields and invalidates confirmation on semantic edits", async () => {
  const { useCases, current } = setup();
  const updated = await useCases.updateProject("project-1", { name: "  New Team  ", overview: "  New brief  " });
  assert.equal(updated.name, "New Team");
  assert.equal(updated.overview, "New brief");
  assert.equal(updated.teamName, "New Team");
  assert.equal(updated.projectStatus, "draft");
  assert.equal(updated.projectDigest, null);
  assert.equal(current.confirmedAt, null);
});

test("Project update refreshes collaboration digest and rejects an empty name", async () => {
  const { useCases } = setup({ projectType: "collaboration", projectDefinitionDigest: "old" });
  const updated = await useCases.updateProject("project-1", { name: "  Delivery Project  " });
  assert.equal(updated.projectDefinitionDigest, "digest:Delivery Project:Current overview");
  await assert.rejects(() => useCases.updateProject("project-1", { name: " " }), /Project name is required/);
});

test("Project confirmation invalidation is persisted under the Project write lock", async () => {
  const { useCases, calls } = setup();
  const updated = await useCases.invalidateProjectConfirmation("project-1", "design-change");
  assert.equal(updated.invalidatedReason, "design-change");
  assert.deepEqual(calls[0], ["lock", "project-1", "invalidate:design-change"]);
  assert.equal(calls.some(([kind]) => kind === "save"), true);
});
