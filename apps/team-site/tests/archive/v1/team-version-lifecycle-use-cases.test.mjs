import assert from "node:assert/strict";
import test from "node:test";
import { createTeamVersionLifecycleUseCases } from "../application/team-version-lifecycle-use-cases.mjs";

function setup(team, versions = [team], { mountedProjects = [], lockCalls = [] } = {}) {
  const calls = [];
  const teamVersions = {
    getTeamVersion: async () => team,
    archiveReleasedTeamVersion: async (...args) => (calls.push(args), { ...team, teamVersionStatus: "archived" }),
    listProjects: async () => [...versions, ...mountedProjects],
    deleteTeamVersions: async (ids) => calls.push(["delete", ...ids])
  };
  return {
    calls,
    useCases: createTeamVersionLifecycleUseCases({
      teamVersions,
      withTeamVersionLock: async (id, action) => { lockCalls.push(id); return action(); }
    }),
    lockCalls
  };
}

test("TeamVersion archive allows an in-use released version and delegates persistence", async () => {
  const version = { projectId: "team-v1", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const { calls, lockCalls, useCases } = setup(version, [version, { teamProjectId: "workspace-a", teamVersionId: "team-v1" }]);
  assert.equal((await useCases.archiveTeamVersion("team-v1")).teamVersionStatus, "archived");
  assert.deepEqual(lockCalls, ["team-v1"]);
  assert.deepEqual(calls, [["team-v1"]]);
});

test("TeamVersion archive rechecks release status under the Team lock", async () => {
  const team = { projectId: "team-v1", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const calls = [];
  const lockCalls = [];
  const useCases = createTeamVersionLifecycleUseCases({
    teamVersions: {
      getTeamVersion: async () => ({ ...team }),
      archiveReleasedTeamVersion: async (id) => (calls.push(["archive", id]), { ...team, teamVersionStatus: "archived" }),
      listProjects: async () => [],
      deleteTeamVersions: async () => {}
    },
    withTeamVersionLock: async (id, action) => {
      lockCalls.push(id);
      team.teamVersionStatus = "archived";
      return action();
    }
  });

  await assert.rejects(() => useCases.archiveTeamVersion("team-v1"), /TEAM_VERSION_NOT_RELEASED/);
  assert.deepEqual(lockCalls, ["team-root"]);
  assert.deepEqual(calls, []);
});

test("TeamVersion archive rejects workspaces and unreleased versions", async () => {
  const workspace = setup({ projectId: "workspace-a", teamProjectId: "team-v1", teamVersionStatus: "draft" });
  await assert.rejects(() => workspace.useCases.archiveTeamVersion("workspace-a"), /TEAM_VERSION_INVALID/);
  const draft = setup({ projectId: "team-draft", teamVersionStatus: "draft" });
  await assert.rejects(() => draft.useCases.archiveTeamVersion("team-draft"), /TEAM_VERSION_NOT_RELEASED/);
  assert.equal(workspace.calls.length + draft.calls.length, 0);
});

test("TeamVersion lifecycle use cases require persistence operations", () => {
  assert.throws(() => createTeamVersionLifecycleUseCases({}), /require team version operations/);
});

test("deleting a custom Team removes its complete unused version lineage under the Team lock", async () => {
  const root = { projectId: "team-root", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-root", source: "team-factory", teamVersionStatus: "released" };
  const fork = { projectId: "team-v2", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v2", source: "version-edit", teamVersionStatus: "draft" };
  const { calls, lockCalls, useCases } = setup(root, [root, fork]);
  assert.deepEqual(await useCases.deleteTeam("team-root"), { teamId: "team-root", deletedTeamVersionIds: ["team-root", "team-v2"] });
  assert.deepEqual(lockCalls, ["team-root"]);
  assert.deepEqual(calls, [["delete", "team-root", "team-v2"]]);
});

test("built-in Teams and Teams mounted by Projects cannot be deleted", async () => {
  const builtIn = setup({ projectId: "classic", teamId: "classic", teamRootId: "classic", teamVersionId: "classic", source: "classic", caseId: "software-team" });
  await assert.rejects(() => builtIn.useCases.deleteTeam("classic"), /BUILT_IN_TEAM_DELETE_BLOCKED/);
  assert.deepEqual(builtIn.calls, []);

  const custom = { projectId: "custom", teamId: "custom", teamRootId: "custom", teamVersionId: "custom", source: "team-factory" };
  const mounted = setup(custom, [custom], { mountedProjects: [{ projectId: "project-1", projectType: "collaboration", mountedTeams: [{ teamVersionId: "custom" }] }] });
  await assert.rejects(() => mounted.useCases.deleteTeam("custom"), /TEAM_IN_USE/);
  assert.deepEqual(mounted.calls, []);
});

test("deleting a draft removes only that TeamVersion and reports every current mounting Project", async () => {
  const draft = { projectId: "team-v2", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v2", teamVersionStatus: "draft" };
  const released = { projectId: "team-v1", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const { calls, useCases } = setup(draft, [released, draft], {
    mountedProjects: [
      { projectId: "project-a", name: "A 项目", projectType: "collaboration", mountedTeams: [{ teamVersionId: "team-v2" }] },
      { projectId: "project-b", name: "B 项目", projectType: "collaboration", mountedTeams: [{ teamVersionId: "team-v2" }] },
      { projectId: "project-old", name: "旧挂载", projectType: "collaboration", mountedTeams: [{ teamVersionId: "team-v1" }] }
    ]
  });
  await assert.rejects(useCases.deleteTeamVersion("team-v2"), (error) => {
    assert.equal(error.code, "TEAM_IN_USE");
    assert.deepEqual(error.blockedProjects, [
      { projectId: "project-a", name: "A 项目" },
      { projectId: "project-b", name: "B 项目" }
    ]);
    return true;
  });
  assert.deepEqual(calls, []);
});

test("deleteTeamVersion removes only draft version and rejects released versions", async () => {
  const draft = { projectId: "team-v2", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v2", teamVersionStatus: "draft" };
  const released = { projectId: "team-v1", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const { calls, useCases } = setup(draft, [released, draft]);
  const deleted = await useCases.deleteTeamVersion("team-v2");
  assert.deepEqual(deleted, { teamId: "team-root", deletedTeamVersionIds: ["team-v2"] });
  assert.deepEqual(calls, [["delete", "team-v2"]]);

  // Reject released version individual deletion
  const releasedSetup = setup(released, [released, draft]);
  await assert.rejects(releasedSetup.useCases.deleteTeamVersion("team-v1"), (error) => {
    assert.equal(error.code, "TEAM_RELEASED_DELETE_BLOCKED");
    return true;
  });
});

test("deleting an unused design-stage TeamVersion succeeds without deleting its released sibling", async () => {
  const draft = { projectId: "team-v2", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v2", teamVersionStatus: "draft" };
  const released = { projectId: "team-v1", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const { calls, useCases } = setup(draft, [released, draft]);
  assert.deepEqual(await useCases.deleteTeamVersion("team-v2"), { teamId: "team-root", deletedTeamVersionIds: ["team-v2"] });
  assert.deepEqual(calls, [["delete", "team-v2"]]);
});

test("deleteTeamVersion blocks deletion if draft is mounted by collaboration projects", async () => {
  const draft = { projectId: "team-v2", teamId: "team-root", teamRootId: "team-root", teamVersionId: "team-v2", teamVersionStatus: "draft" };
  const { calls, useCases } = setup(draft, [draft], {
    mountedProjects: [
      { projectId: "project-c", name: "C 项目", projectType: "collaboration", mountedTeams: [{ teamVersionId: "team-v2" }] }
    ]
  });
  await assert.rejects(useCases.deleteTeamVersion("team-v2"), (error) => {
    assert.equal(error.code, "TEAM_IN_USE");
    assert.deepEqual(error.blockedProjects, [{ projectId: "project-c", name: "C 项目" }]);
    return true;
  });
  assert.deepEqual(calls, []);
});
