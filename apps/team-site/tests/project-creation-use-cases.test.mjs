import assert from "node:assert/strict";
import test from "node:test";
import { createProjectCreationUseCases } from "../application/project-creation-use-cases.mjs";

test("Project creation initializes its reserved workspace and tolerates an already committed workspace replay", async () => {
  let metadata = { projectId: "project-1", workdir: "/tmp/project-1", ogsProjectId: null };
  let workspaceCalls = 0;
  let removed = false;
  const useCases = createProjectCreationUseCases({
    projectStore: {
      async createProject() { return metadata; },
      async saveProjectMetadata(_projectId, next) { metadata = { ...next }; },
      async removeProjectData() { removed = true; }
    },
    workspaceStore: {
      async createWorkspace(args) {
        workspaceCalls += 1;
        assert.equal(args.conflictStrategy, "init-current");
        if (workspaceCalls > 1) throw new Error("PROJECT_ALREADY_EXISTS");
        return { projectId: "studio-project-1" };
      },
      async inspectWorkspace() { return { hasProject: workspaceCalls > 0, isProjectValid: workspaceCalls > 0 }; }
    },
    projectQuery: { async getProject() { return metadata; } }
  });

  const created = await useCases.createProject({ name: "Project One" });
  assert.equal(created.ogsProjectId, "studio-project-1");
  assert.equal(removed, false);

  const replayed = await useCases.createProject({ name: "Project One" });
  assert.equal(replayed.ogsProjectId, "studio-project-1");
  assert.equal(workspaceCalls, 1);
  assert.equal(removed, false);
});

test("Project creation rejects legacy Case materialization requests", async () => {
  let created = false;
  const useCases = createProjectCreationUseCases({
    projectStore: { async createProject() { created = true; }, async saveProjectMetadata() {}, async removeProjectData() {} },
    workspaceStore: { async createWorkspace() {} },
    projectQuery: { async getProject() {} }
  });
  await assert.rejects(useCases.createProject({ name: "Legacy", caseId: "software-team" }), /TEAM_IR_V2_REQUIRED/);
  assert.equal(created, false);
});
