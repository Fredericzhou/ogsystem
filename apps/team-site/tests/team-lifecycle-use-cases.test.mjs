import assert from "node:assert/strict";
import test from "node:test";
import { createTeamLifecycleUseCases } from "../application/team-lifecycle-use-cases.mjs";

function setup({ projects = [], team, loaded = { validation: { ok: true } } } = {}) {
  const calls = [];
  const created = [];
  const store = {
    async getProject(id) { calls.push(["get", id]); return id === team?.projectId ? team : [...projects, ...created].find((item) => item.projectId === id); },
    async listProjects() { return projects; },
    async createProject(input) {
      calls.push(["create", input]);
      const project = { projectId: `new-${created.length + 1}`, workdir: `/tmp/new-${created.length + 1}`, ...input };
      created.push(project);
      return project;
    },
    async saveProjectMetadata(id, metadata) { calls.push(["save", id, metadata]); return { ...metadata, projectId: id }; },
    async withProjectWriteLock(_id, _operation, action) { return action(); },
    async removeProject(id) { calls.push(["remove", id]); },
  };
  const packageStore = {
    async exportTeamPackage(workdir) { calls.push(["export", workdir]); return { bundle: true }; },
    async loadTeamPackage(input) { calls.push(["load", input]); return loaded; }
  };
  const caseSpec = { id: "sample", title: { "zh-CN": "Sample Team" }, detail: { scenario: { "zh-CN": "Scenario" } } };
  const useCases = createTeamLifecycleUseCases({
    projectStore: store,
    packageStore,
    locks: {
      withWorkspaceBindingLock: (action) => action(),
      withTeamVersionLock: (_teamId, action) => action()
    },
    confirmation: {
      async validateTopology() {},
      async computeDigests() { return { projectDigest: "digest", teamCoreDigest: "core" }; }
    },
    caseCatalog: { getCase: (id) => id === "sample" ? caseSpec : undefined, listCases: () => [caseSpec] },
    assertTrustedTeamTopology: (value) => value.source === "classic"
  });
  return { calls, created, useCases };
}

test("Team workspace creation copies a confirmed TeamVersion and compensates failed setup", async () => {
  const team = { projectId: "team-v1", workdir: "/teams/team-v1", name: "Research", projectStatus: "confirmed", teamVersionStatus: "released" };
  const harness = setup({ team });
  const workspace = await harness.useCases.createProjectWorkspace("team-v1", { workspaceKey: "research-project" });
  assert.equal(workspace.projectId, "new-1");
  assert.equal(harness.calls.filter(([name]) => name === "save").at(-1)[2].projectStatus, "confirmed");

  const failed = setup({ team, loaded: { validation: { ok: false } } });
  await assert.rejects(() => failed.useCases.createProjectWorkspace("team-v1"), /PROJECT_WORKSPACE_INVALID/);
  assert.deepEqual(failed.calls.at(-1), ["remove", "new-1"]);
});

test("Team draft creation uses the Team lifecycle contract and normalizes supported fields", async () => {
  const harness = setup();
  const draft = await harness.useCases.createTeamDraft({ name: "  Support Team  ", overview: "  Coordinate support.  ", locale: "en" });
  assert.equal(draft.projectId, "new-1");
  assert.deepEqual(harness.calls.find(([kind]) => kind === "create")[1], {
    name: "Support Team", overview: "Coordinate support.", templateId: "empty", source: "team-factory", locale: "en"
  });
  await assert.rejects(() => harness.useCases.createTeamDraft({ name: "   " }), /TEAM_NAME_REQUIRED/);
});

test("Team workspace creation enforces confirmation and unique binding", async () => {
  const draft = setup({ team: { projectId: "draft", projectStatus: "draft" } });
  await assert.rejects(() => draft.useCases.createProjectWorkspace("draft"), /TEAM_NOT_CONFIRMED/);
  const bound = setup({ team: { projectId: "team-v1", projectStatus: "confirmed" }, projects: [{ projectId: "other", workspaceKey: "research-project", teamProjectId: "team-v2" }] });
  await assert.rejects(() => bound.useCases.createProjectWorkspace("team-v1", { workspaceKey: "research project" }), /WORKSPACE_BOUND_TO_OTHER_TEAM/);
});

test("TeamVersion fork numbers the next immutable version and release delegates confirmation", async () => {
  const source = { projectId: "team-v1", workdir: "/teams/team-v1", name: "Research", teamId: "team-root", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const harness = setup({ team: source, projects: [source, { projectId: "team-v2", teamId: "team-root", teamVersionNumber: 2 }] });
  const fork = await harness.useCases.forkTeamVersion("team-v1");
  assert.equal(fork.teamVersionNumber, 3);
  assert.equal(fork.parentTeamVersionId, "team-v1");
  await harness.useCases.releaseTeamVersion("team-v2");
  assert.equal(harness.calls.at(-1)[0], "save");
  assert.equal(harness.calls.at(-1)[2].teamVersionStatus, "released");
});

test("forked classic topology loses its trusted exemption when its TeamVersion core digest changes", async () => {
  const validation = [];
  const source = {
    projectId: "classic-v1", workdir: "/teams/classic-v1", name: "Classic", teamId: "classic-root",
    teamVersionId: "classic-v1", teamVersionStatus: "released", source: "classic", caseId: "software-team", teamCoreDigest: "core-v1"
  };
  const harness = setup({ team: source });
  harness.useCases = createTeamLifecycleUseCases({
    projectStore: {
      async getProject(id) {
        return id === "classic-v1" ? source : harness.created.find((project) => project.projectId === id);
      },
      async listProjects() { return [source, ...harness.created]; },
      async createProject(input) {
        const project = { projectId: "classic-v2", workdir: "/teams/classic-v2", ...input };
        harness.created.push(project);
        return project;
      },
      async saveProjectMetadata(id, metadata) {
        const saved = { ...metadata, projectId: id };
        const index = harness.created.findIndex((project) => project.projectId === id);
        if (index >= 0) harness.created[index] = saved;
        return saved;
      },
      async removeProject() {},
      async withProjectWriteLock(_id, _operation, action) { return action(); }
    },
    packageStore: { async exportTeamPackage() { return {}; }, async loadTeamPackage() { return { validation: { ok: true } }; } },
    locks: { withWorkspaceBindingLock: (action) => action(), withTeamVersionLock: (_id, action) => action() },
    confirmation: {
      async validateTopology(project, options) { validation.push({ project, options }); },
      async computeDigests(project) { return { projectDigest: "digest", teamCoreDigest: project.overview === "edited" ? "core-v2" : "core-v1" }; }
    },
    caseCatalog: { getCase: () => undefined, listCases: () => [] }
  });

  const fork = await harness.useCases.forkTeamVersion("classic-v1");
  assert.equal(fork.caseId, "software-team");
  assert.equal(fork.trustedClassicTopologyDigest, "core-v1");
  harness.created[0].overview = "edited";
  await harness.useCases.releaseTeamVersion("classic-v2");
  assert.equal(validation.at(-1).options.trustedClassic, false);
  assert.equal(harness.created[0].trustedClassicTopologyDigest, null);
});

test("classic Team creation reuses a released version and provisions templates through the same flow", async () => {
  const existing = { projectId: "classic-v1", source: "classic", caseId: "sample", teamVersionStatus: "released", teamVersionNumber: 1 };
  const reuse = setup({ projects: [existing] });
  assert.equal(await reuse.useCases.createClassicTeamProject({ caseId: "sample" }), existing);
  assert.equal(reuse.created.length, 0);

  const template = setup();
  const created = await template.useCases.createClassicTeamProject({ caseId: "sample", asTemplate: true });
  assert.equal(created.source, "classic-template");
  assert.equal(template.calls.some(([name]) => name === "save"), false);
});
