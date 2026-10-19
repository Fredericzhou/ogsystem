import assert from "node:assert/strict";
import test from "node:test";
import { createCollaborationProjectUseCases } from "../application/collaboration-project-use-cases.mjs";

function makeUseCases({ project, teams = [], onSave } = {}) {
  const calls = [];
  const current = structuredClone(project || {
    projectId: "project-1",
    projectType: "collaboration",
    projectDefinitionDigest: "old-digest",
    mountedTeams: [],
    taskRecords: []
  });
  const projectStore = {
    async getProject() { return structuredClone(current); },
    async listProjects() { return []; },
    async createProject(input) {
      calls.push(["create", input]);
      return { projectId: "new-project", ...input };
    },
    async initializeCollaborationProject(projectId, input) {
      calls.push(["initialize", projectId, input]);
      Object.assign(current, { projectId, projectType: "collaboration", projectDefinitionDigest: input.projectDefinitionDigest, ...input });
    },
    async removeProject(projectId) { calls.push(["remove", projectId]); },
    async withProjectWriteLock(projectId, operation, action) {
      calls.push(["lock", projectId, operation]);
      return action();
    },
    async withCollaborationProjectNameLock(name, action) {
      calls.push(["name-lock", name]);
      return action();
    },
    async saveProjectMetadata(projectId, next) {
      calls.push(["save", projectId, next]);
      Object.assign(current, next);
      await onSave?.(next);
      return structuredClone(current);
    }
  };
  const teamStore = {
    async getTeamVersion(teamVersionId) {
      calls.push(["team", teamVersionId]);
      const team = teams.find((item) => item.teamVersionId === teamVersionId);
      if (!team) throw new Error("Project not found.");
      return team;
    }
  };
  return {
    calls,
    useCases: createCollaborationProjectUseCases({
      projectStore,
      teamStore,
      computeProjectDefinitionDigest: (value) => `digest:${value.mountedTeams.map((item) => item.teamVersionId).join(",")}`
    })
  };
}

const releasedTeam = {
  projectId: "team-1",
  teamId: "team-1",
  teamVersionId: "team-1",
  teamVersionStatus: "released",
  teamVersionNumber: 2,
  teamName: "Software Team",
  teamCoreDigest: "digest-1"
};

test("Project team listing returns the collaboration Project mount projection", async () => {
  const { useCases } = makeUseCases({ project: { projectId: "project-1", projectType: "collaboration", projectDefinitionDigest: "digest", mountedTeams: [releasedTeam] } });
  assert.deepEqual(await useCases.listProjectTeams("project-1"), {
    projectId: "project-1",
    projectDefinitionDigest: "digest",
    mountedTeams: [releasedTeam]
  });
});

test("Collaboration Project creation validates canonical released teams and initializes through the store", async () => {
  const { useCases, calls } = makeUseCases({ teams: [releasedTeam] });
  const project = await useCases.createCollaborationProject({ name: "  Product Launch  ", overview: "Plan launch", teamVersionIds: ["team-1"] });
  assert.equal(project.projectType, "collaboration");
  assert.deepEqual(calls.find(([kind]) => kind === "create")[1], {
    name: "Product Launch", overview: "Plan launch", templateId: "empty", source: "collaboration-project"
  });
  assert.equal(calls.find(([kind]) => kind === "initialize")[2].mountedTeams[0].teamVersionId, "team-1");
  assert.equal(calls.find(([kind]) => kind === "initialize")[2].projectDefinitionDigest, "digest:team-1");
});

test("Collaboration Project creation compensates failed initialization and rejects duplicate names", async () => {
  let removed = false;
  const calls = [];
  const useCases = createCollaborationProjectUseCases({
    projectStore: {
      async getProject() { throw new Error("unused"); },
      async listProjects() { return [{ projectType: "collaboration", name: "Existing" }]; },
      async createProject() { calls.push("create"); return { projectId: "partial" }; },
      async initializeCollaborationProject() { throw new Error("write failed"); },
      async removeProject(projectId) { removed = projectId === "partial"; },
      async withProjectWriteLock(_id, _operation, action) { return action(); },
      async withCollaborationProjectNameLock(_name, action) { return action(); },
      async saveProjectMetadata() {}
    },
    teamStore: { async getTeamVersion() { return releasedTeam; } },
    computeProjectDefinitionDigest: () => "digest"
  });
  await assert.rejects(() => useCases.createCollaborationProject({ name: " existing " }), /PROJECT_NAME_EXISTS/);
  assert.deepEqual(calls, []);
  await assert.rejects(() => useCases.createCollaborationProject({ name: "New", teamVersionIds: ["team-1"] }), /write failed/);
  assert.equal(removed, true);
});

test("Project team replacement validates released versions and preserves mount timestamps", async () => {
  const { useCases, calls } = makeUseCases({
    project: { projectId: "project-1", projectType: "collaboration", taskRecords: [], mountedTeams: [{ ...releasedTeam, mountedAt: "2026-01-01T00:00:00.000Z" }] },
    teams: [releasedTeam]
  });
  const result = await useCases.replaceProjectTeams("project-1", ["team-1", "team-1"]);
  assert.equal(result.mountedTeams.length, 1);
  assert.equal(result.mountedTeams[0].mountedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(result.projectDefinitionDigest, "digest:team-1");
  assert.deepEqual(calls.filter(([kind]) => kind === "team").map(([, id]) => id), ["team-1"]);
});

test("Project team replacement rejects active tasks and never writes on failure", async () => {
  let writes = 0;
  const { useCases } = makeUseCases({
    project: { projectId: "project-1", projectType: "collaboration", taskRecords: [{ taskId: "task-1", status: "running" }] },
    teams: [releasedTeam],
    onSave() { writes += 1; }
  });
  await assert.rejects(() => useCases.replaceProjectTeams("project-1", ["team-1"]), /PROJECT_TEAM_UPDATE_LOCKED/);
  assert.equal(writes, 0);
});

test("Project team replacement requires released canonical TeamVersions", async () => {
  const draft = { ...releasedTeam, teamVersionStatus: "draft" };
  const { useCases } = makeUseCases({ teams: [draft] });
  await assert.rejects(() => useCases.replaceProjectTeams("project-1", ["team-1"]), /TEAM_VERSION_NOT_RELEASED/);
  await assert.rejects(() => useCases.replaceProjectTeams("project-1", ["case:software-team"]), /TEAM_VERSION_ID_INVALID/);
});
