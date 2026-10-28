import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleCaseRoutes } from "../api/case-routes.mjs";
import { errorStatus } from "../api/error-status.mjs";
import { createTeamLifecycleUseCases } from "../application/team-lifecycle-use-cases.mjs";
import { createTeamIrUseCases } from "../application/team-ir-use-cases.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";

test("new classic Case rejects before legacy baseline execution and removes its materialized Team on v2 release failure", async (t) => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-classic-case-v2-gate-"));
  t.after(() => rm(projectsRoot, { recursive: true, force: true }));

  const projects = new Map();
  const legacyBaselineCalls = [];
  let materializedLegacySystem = false;
  const projectStore = {
    async getProject(id) { return projects.get(id); },
    async listProjects() { return [...projects.values()]; },
    async createProject(input) {
      const projectId = "classic-case-new";
      const workdir = join(projectsRoot, projectId);
      await mkdir(join(workdir, ".site"), { recursive: true });
      await mkdir(workdir, { recursive: true });
      await writeFile(join(workdir, ".site", "project.json"), JSON.stringify(input));
      await writeFile(join(workdir, "system.mmd"), "flowchart TD\n");
      materializedLegacySystem = true;
      const project = { projectId, workdir, teamVersionId: projectId, teamVersionStatus: "draft", projectType: "team", ...input };
      projects.set(projectId, project);
      return project;
    },
    async saveProjectMetadata(id, metadata) {
      const project = { ...projects.get(id), ...metadata };
      projects.set(id, project);
      return project;
    },
    async removeProjectData(id) {
      const project = projects.get(id);
      if (project) await rm(project.workdir, { recursive: true, force: true });
      projects.delete(id);
    },
    async removeProject(id) { return this.removeProjectData(id); },
    async withProjectWriteLock(_id, _operation, action) { return action(); }
  };
  const teamIrRelease = createTeamIrUseCases({
    teamCatalog: { getTeamVersion: projectStore.getProject },
    teamIrStore: createFileTeamIrStore(),
    withTeamVersionLock: async (_id, action) => action()
  });
  const useCases = createTeamLifecycleUseCases({
    projectStore,
    packageStore: { async exportTeamPackage() {}, async loadTeamPackage() {} },
    locks: { withWorkspaceBindingLock: async (action) => action(), withTeamVersionLock: async (_id, action) => action() },
    confirmation: {
      async validateTopology() {},
      async computeDigests() { return { projectDigest: "project", teamCoreDigest: "core", teamDigestVersion: 3 }; }
    },
    releaseEvidence: {
      async validateTeamIrReleaseEvidence() { throw new Error("unexpected v2 evidence validation"); },
      async prepareBuiltInTeamVersion(...args) { legacyBaselineCalls.push(args); }
    },
    teamIrRelease,
    caseCatalog: {
      getCase: (id) => id === "software-team" ? {
        id,
        title: { "zh-CN": "Software delivery" },
        detail: { scenario: { "zh-CN": "Plan a software release." } }
      } : undefined,
      listCases: () => []
    }
  });

  const sent = [];
  const handled = await handleCaseRoutes({
    request: { method: "POST" },
    response: {},
    url: new URL("http://site.test/api/v1/cases/software-team/use"),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus,
    publicProject: (project) => project,
    cases: [],
    eventLabels: {},
    buildCaseGraph() {},
    runCase() {},
    createClassicTeamProject: useCases.createClassicTeamProject
  });

  assert.equal(handled, true);
  assert.equal(materializedLegacySystem, true, "the reproduction starts with the legacy Case materializer");
  assert.equal(sent[0].status, 400);
  assert.match(sent[0].payload.error, /TEAM_IR_V2_REQUIRED/);
  assert.deepEqual(legacyBaselineCalls, [], "legacy Mermaid Simulation must not be presented as native v2 release evidence");
  assert.equal(projects.size, 0, "a failed Case release must not leave an unlisted draft TeamVersion");
  assert.deepEqual(await readdir(projectsRoot), [], "compensation removes the materialized Team workspace");
});
