import assert from "node:assert/strict";
import test from "node:test";
import { createCollaborationProjectUseCases } from "../application/collaboration-project-use-cases.mjs";
import { createTaskExecutionUseCases } from "../application/task-execution-use-cases.mjs";
import { createRuntimeTaskExecutionReadiness } from "../infrastructure/runtime-task-execution-readiness.mjs";

test("Project mount rejects a trained TeamVersion whose frozen digest is stale", async () => {
  let created = false;
  let checkedTeamVersion;
  const team = {
    projectId: "team-v1",
    teamId: "team",
    teamVersionId: "team-v1",
    teamVersionStatus: "trained",
    projectType: "team"
  };
  const useCases = createCollaborationProjectUseCases({
    projectStore: {
      async getProject() { return undefined; },
      async withProjectWriteLock(_id, _reason, action) { return action(); },
      async withCollaborationProjectNameLock(_name, action) { return action(); },
      async saveProjectMetadata() {},
      async listProjects() { return []; },
      async createProject() { created = true; return { projectId: "project-1", workdir: "/tmp/project-1" }; },
      async initializeCollaborationProject() {},
      async removeProject() {}
    },
    teamStore: { async getTeamVersion() { return team; } },
    computeProjectDefinitionDigest: () => "definition-digest",
    computeProjectAssetDigest: async () => "asset-digest",
    async requireCurrentTeamVersion(value) {
      checkedTeamVersion = value.teamVersionId;
      throw new Error("PROJECT_CONFIRMATION_STALE: trained TeamVersion assets changed.");
    }
  });

  await assert.rejects(
    useCases.createCollaborationProject({ name: "Project", teamVersionIds: ["team-v1"] }),
    /PROJECT_CONFIRMATION_STALE/
  );
  assert.equal(checkedTeamVersion, "team-v1");
  assert.equal(created, false);
});

test("Project mount preserves the exact trained TeamVersion identity and digest", async () => {
  const team = {
    projectId: "team-version-1",
    teamId: "team",
    teamVersionId: "team-version-1",
    teamVersionNumber: 3,
    teamVersionStatus: "trained",
    projectType: "team",
    teamName: "Research Team",
    projectDigest: "b".repeat(64),
    teamCoreDigest: "a".repeat(64),
    teamDigestVersion: 3
  };
  let initialized;
  let savedProject;
  const useCases = createCollaborationProjectUseCases({
    projectStore: {
      async getProject() { return savedProject; },
      async withProjectWriteLock(_id, _reason, action) { return action(); },
      async withCollaborationProjectNameLock(_name, action) { return action(); },
      async saveProjectMetadata() {},
      async listProjects() { return []; },
      async createProject() { return { projectId: "project-1", workdir: "/tmp/project-1" }; },
      async initializeCollaborationProject(_id, value) {
        initialized = value;
        savedProject = { projectId: "project-1", ...value, projectType: "collaboration" };
      },
      async removeProject() {}
    },
    teamStore: { async getTeamVersion() { return team; } },
    computeProjectDefinitionDigest: () => "definition-digest",
    computeProjectAssetDigest: async () => "asset-digest",
    async requireCurrentTeamVersion(value) {
      assert.equal(value.teamVersionId, "team-version-1");
      assert.equal(value.projectDigest, "b".repeat(64));
    }
  });

  const project = await useCases.createCollaborationProject({ name: "Project", teamVersionIds: ["team-version-1"] });
  assert.equal(project.projectId, "project-1");
  assert.equal(initialized.mountedTeams[0].teamVersionId, "team-version-1");
  assert.equal(initialized.mountedTeams[0].teamCoreDigest, "a".repeat(64));
  assert.equal(initialized.mountedTeams[0].teamDigestVersion, 3);
});

test("dry-run Task execution checks the trained TeamVersion freeze before reserving a Run", async () => {
  let reserved = false;
  const project = {
    projectId: "project-1",
    projectType: "collaboration",
    mountedTeams: [{ teamId: "team", teamVersionId: "team-v1" }],
    taskRecords: [{ taskId: "task-1", status: "queued", teamVersionId: "team-v1", input: "Complete the task." }],
    materials: { materials: [] }
  };
  const useCases = createTaskExecutionUseCases({
    projectStore: { async getProject() { return project; } },
    teamStore: {
      async getTeamVersion() {
        return { projectId: "team-v1", teamId: "team", teamVersionId: "team-v1", teamVersionStatus: "trained", projectDigest: "frozen" };
      }
    },
    attemptStore: {
      async reserveAttempt() { reserved = true; throw new Error("should not reserve"); },
      async completeAttempt() {},
      async failAttempt() {}
    },
    workerStore: { get() {}, set() {}, delete() {}, async wait() {} },
    runStore: { async execute() {} },
    readiness: {
      async inspect() { return { canDryRun: true, blockers: [] }; },
      async requireCurrentConfirmation() { throw new Error("PROJECT_CONFIRMATION_STALE: trained TeamVersion assets changed."); }
    },
    identifiers: {
      createRunId: () => "run-1",
      fingerprint: () => "fingerprint",
      resolveProjectMaterial: () => ""
    }
  });

  await assert.rejects(useCases.startProjectTask("project-1", "task-1", { mode: "dry-run" }), /PROJECT_CONFIRMATION_STALE/);
  assert.equal(reserved, false);
});

test("runtime confirmation rejects legacy trained TeamVersions with incomplete Role Contracts", async () => {
  const readiness = createRuntimeTaskExecutionReadiness({
    inspect: async () => ({ canDryRun: true, blockers: [] }),
    assertTeamVersionContracts: async () => {
      throw new Error("PROJECT_TEAM_VERSION_CONTRACT_INVALID: lead:incomplete; create and train a new TeamVersion.");
    }
  });
  await assert.rejects(
    () => readiness.requireCurrentConfirmation({
      projectType: "team",
      teamVersionStatus: "trained",
      projectDigest: "frozen",
      workdir: "/tmp/team"
    }),
    /PROJECT_TEAM_VERSION_CONTRACT_INVALID/
  );
});
