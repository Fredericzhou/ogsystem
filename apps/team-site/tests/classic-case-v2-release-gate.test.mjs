import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleCaseRoutes } from "../api/case-routes.mjs";
import { errorStatus } from "../api/error-status.mjs";
import { createTeamLifecycleUseCases } from "../application/team-lifecycle-use-cases.mjs";
import { createTeamIrUseCases } from "../application/team-ir-use-cases.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { cases } from "../cases.mjs";

const teamIrFixtures = Object.fromEntries(await Promise.all(cases.map(async ({ id }) => [
  id,
  JSON.parse(await readFile(new URL(`../../../examples/team-ir-v2/classic-${id}.json`, import.meta.url), "utf8"))
])));

for (const { id: caseId } of cases) test(`new classic Team ${caseId} provisions only native v2 and compensates when release evidence is missing`, async (t) => {
  const projectsRoot = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "ogs-classic-case-v2-gate-")));
  t.after(() => rm(projectsRoot, { recursive: true, force: true }));

  const projects = new Map();
  let legacyCreateCalled = false;
  const projectStore = {
    async getProject(id) { return projects.get(id); },
    async listProjects() { return [...projects.values()]; },
    async createProject() { legacyCreateCalled = true; throw new Error("legacy createProject must not be called"); },
    async createNativeTeamIrProject(input) {
      const projectId = "classic-case-new";
      const workdir = join(projectsRoot, projectId);
      await mkdir(join(workdir, ".site"), { recursive: true });
      const project = { projectId, workdir, teamVersionId: projectId, teamVersionStatus: "draft", projectType: "team", ...input };
      await writeFile(join(workdir, ".site", "project.json"), JSON.stringify(project));
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
    locks: {
      withWorkspaceBindingLock: async (action) => action(),
      withTeamVersionLock: async (_id, action) => action(),
      withTeamNameLock: async (_name, action) => action()
    },
    confirmation: {
      async validateTopology() {},
      async computeDigests() { return { projectDigest: "project", teamCoreDigest: "core", teamDigestVersion: 3 }; }
    },
    releaseEvidence: {
      async validateTeamIrReleaseEvidence() { throw new Error("TEAM_IR_V2_SANDBOX_EVIDENCE_REQUIRED: evidence is unavailable"); }
    },
    teamIrRelease,
    teamIrFixtures,
    caseCatalog: {
      getCase: (id) => cases.find((item) => item.id === id),
      listCases: () => []
    }
  });

  const sent = [];
  const handled = await handleCaseRoutes({
    request: { method: "POST" },
    response: {},
    url: new URL(`http://site.test/api/v1/cases/${caseId}/use`),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus,
    publicProject: (project) => project,
    cases,
    teamIrFixtures,
    createClassicTeamProject: useCases.createClassicTeamProject
  });

  assert.equal(handled, true);
  assert.equal(legacyCreateCalled, false);
  assert.equal(sent[0].status, 400);
  assert.match(sent[0].payload.error, /TEAM_IR_(?:RELEASE_CLOSURE_UNAVAILABLE|V2_SANDBOX_EVIDENCE_REQUIRED)/);
  assert.ok(!sent[0].payload.error.includes("Mermaid"));
  assert.equal(projects.size, 0, "a failed v2 release must not leave a draft TeamVersion");
  assert.deepEqual(await readdir(projectsRoot), [], "compensation removes the provisional Team workspace");
});
