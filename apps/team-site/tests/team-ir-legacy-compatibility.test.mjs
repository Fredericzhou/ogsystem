import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { createTeamIrUseCases } from "../application/team-ir-use-cases.mjs";
import { createCollaborationProjectUseCases } from "../application/collaboration-project-use-cases.mjs";
import { createTaskCreationUseCases } from "../application/task-creation-use-cases.mjs";
import { createFileRecentRunStore } from "../infrastructure/file-recent-run-store.mjs";
import { handleTeamRoutes } from "../api/team-routes.mjs";
import { errorStatus } from "../api/error-status.mjs";

function routeHarness(useCases) {
  const sent = [];
  const dependencies = {
    request: { method: "GET" }, response: {}, url: new URL("http://site.test/"),
    readBody: async () => ({}), sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus, publicProject: (project) => project, useCases
  };
  return {
    sent,
    invoke: (method, path, body = {}) => handleTeamRoutes({
      ...dependencies, request: { method }, url: new URL(`http://site.test${path}`), readBody: async () => body
    })
  };
}

async function hashTree(root) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, relativePath);
      else if (entry.isFile()) files.push([relativePath, createHash("sha256").update(await readFile(path)).digest("hex")]);
    }
  }
  await visit(root);
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

test("Team Site browser entry contains no removed Team Assistant or legacy authoring handlers", async () => {
  const source = await readFile(new URL("../public/app/views/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Team Assistant|团队助手|TEAM_ASSISTANT_(?:MODEL_UNAVAILABLE|UNAVAILABLE)/);
  assert.doesNotMatch(source, /studioSimulationErrorText|teamStudioErrorMarkup|release-baselines|\/api\/v1\/team-versions\/[^`]*\/(?:design|graph|chat)/);
});

test("legacy authoring API has no creation, read, validate, or write dispatch", async () => {
  const calls = [];
  const harness = routeHarness({
    createTeamDraft: async (input) => (calls.push(["create", input]), { projectId: "team-draft" }),
    getTeamVersion: async (id) => (calls.push(["read", id]), { projectId: id, teamVersionStatus: "draft" }),
    getTeamDesign: async (id, locale) => (calls.push(["design", id, locale]), { authoring: { roles: {} } }),
    validateTeamDesign: async (id, input) => (calls.push(["validate", id, input]), { ok: true }),
    saveTeamDesign: async (id, input) => (calls.push(["save", id, input]), { teamVersionId: id, saved: true })
  });

  assert.equal(await harness.invoke("POST", "/api/v1/team-factory", { name: "Legacy team", overview: "Existing contract" }), false);
  for (const [method, path, body] of [
    ["GET", "/api/v1/team-versions/legacy-v1/design?locale=en"],
    ["POST", "/api/v1/team-versions/legacy-v1/design/validate", { authoring: { roles: {} } }],
    ["PUT", "/api/v1/team-versions/legacy-v1/design", { authoring: { roles: {} } }],
    ["GET", "/api/v1/team-versions/legacy-v1/design/assets"],
    ["PUT", "/api/v1/team-versions/legacy-v1/design/assets", { assets: {} }]
  ]) {
    assert.equal(await harness.invoke(method, path, body), true);
    assert.equal(harness.sent.at(-1).status, 409);
    assert.match(harness.sent.at(-1).payload.error, /TEAM_IR_V2_REQUIRED/);
  }
  assert.deepEqual(calls, []);
});

test("missing v2 document reads and release snapshots fail closed without creating IR files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-legacy-compat-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createFileTeamIrStore();
  const teamRoot = join(root, "legacy-team");
  const useCases = createTeamIrUseCases({
    teamCatalog: { getTeamVersion: async () => ({ teamVersionId: "legacy-team", projectType: "team", workdir: teamRoot }) },
    teamIrStore: store,
    withTeamVersionLock: async (_id, action) => action()
  });
  await assert.rejects(useCases.getTeamIr("legacy-team"), /TEAM_IR_V2_REQUIRED/);
  await assert.rejects(useCases.getTeamIrReleaseSnapshot("legacy-team"), /TEAM_IR_V2_REQUIRED/);
  await assert.rejects(readFile(join(teamRoot, ".ogs", "team.ir.json")), { code: "ENOENT" });
});

test("legacy Run evidence stays byte-for-byte unchanged across v2 API, mount, Task, and history boundaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-legacy-run-readonly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const teamId = "legacy-team";
  const teamRoot = join(root, teamId);
  const legacyRun = join(teamRoot, ".ogs", "runs", "run-old");
  await mkdir(legacyRun, { recursive: true });
  await writeFile(join(legacyRun, "run-plan.json"), JSON.stringify({ version: 1, source: "legacy-mermaid", graph: "flowchart TD" }));
  await writeFile(join(legacyRun, "state.json"), JSON.stringify({ status: "completed", outputs: [{ text: "historical result" }] }));
  await writeFile(join(teamRoot, "system.mmd"), "flowchart TD\n  A[Legacy] --> B[Run]\n");
  await mkdir(join(teamRoot, ".ogs"), { recursive: true });
  await writeFile(join(teamRoot, ".ogs", "authoring.json"), JSON.stringify({ schemaVersion: 1, scenario: "legacy" }));
  const historicalTeamRunDigest = await hashTree(join(teamRoot, ".ogs", "runs"));
  const legacyWorkspaceDigest = await hashTree(teamRoot);

  const irUseCases = createTeamIrUseCases({
    teamCatalog: { getTeamVersion: async () => ({ teamVersionId: teamId, teamRootId: teamId, projectType: "team", teamVersionStatus: "released", workdir: teamRoot }) },
    teamIrStore: createFileTeamIrStore(),
    withTeamVersionLock: async (_id, action) => action()
  });
  const teamApi = routeHarness({
    ...irUseCases,
    async releaseTeamVersion() { throw new Error("TEAM_IR_V2_REQUIRED: rebuild this TeamVersion."); }
  });
  assert.equal(await teamApi.invoke("GET", `/api/v1/team-versions/${teamId}/ir`), true);
  assert.match(teamApi.sent.at(-1).payload.error, /TEAM_IR_V2_REQUIRED/);
  assert.equal(teamApi.sent.at(-1).status, 400);
  assert.equal(await teamApi.invoke("POST", `/api/v1/team-versions/${teamId}/ir/validate`, { teamIR: { schemaVersion: 2 } }), true);
  assert.equal(teamApi.sent.at(-1).status, 200);
  assert.equal(await teamApi.invoke("POST", `/api/v1/team-versions/${teamId}/release`), true);
  assert.equal(teamApi.sent.at(-1).status, 400);
  for (const [method, path, body] of [
    ["GET", `/api/v1/team-versions/${teamId}/design?locale=en`],
    ["POST", `/api/v1/team-versions/${teamId}/design/validate`, { authoring: { roles: {} } }],
    ["PUT", `/api/v1/team-versions/${teamId}/design`, { authoring: { roles: {} } }],
    ["GET", `/api/v1/team-versions/${teamId}/design/assets`],
    ["PUT", `/api/v1/team-versions/${teamId}/design/assets`, { assets: {} }]
  ]) {
    assert.equal(await teamApi.invoke(method, path, body), true);
    assert.equal(teamApi.sent.at(-1).status, 409);
    assert.match(teamApi.sent.at(-1).payload.error, /TEAM_IR_V2_REQUIRED/);
  }

  let project = {
    projectId: "project-legacy-mount", projectType: "collaboration", nextTaskNumber: 1,
    mountedTeams: [{ teamId, teamVersionId: teamId, teamVersionNumber: 1, teamName: "Legacy Team" }], taskRecords: []
  };
  const projectStore = {
    async getProject() { return structuredClone(project); },
    async withProjectWriteLock(_id, _operation, action) { return action(); },
    async withCollaborationProjectNameLock(_name, action) { return action(); },
    async saveProjectMetadata(_id, metadata) { project = structuredClone(metadata); return project; },
    async listProjects() { return [project]; },
    async createProject() { throw new Error("unexpected create"); },
    async initializeCollaborationProject() {},
    async removeProject() {}
  };
  const mountUseCases = createCollaborationProjectUseCases({
    projectStore,
    teamStore: { async getTeamVersion() { return { projectId: teamId, teamId, teamRootId: teamId, teamVersionId: teamId, teamVersionNumber: 1, teamVersionStatus: "released", name: "Legacy Team" }; } },
    computeProjectDefinitionDigest: () => "project-definition"
  });
  const projectBeforeMountAttempt = structuredClone(project);
  await assert.rejects(mountUseCases.replaceProjectTeams(project.projectId, [teamId]), /TEAM_IR_V2_REQUIRED/);
  assert.deepEqual(project, projectBeforeMountAttempt, "a rejected legacy mount must not rewrite Project metadata");
  const taskUseCases = createTaskCreationUseCases({
    projectStore,
    taskStore: { createTaskId: () => "task-should-not-exist" },
    fingerprintRequest: (value) => value
  });
  await assert.rejects(taskUseCases.createProjectTask(project.projectId, { input: "Run the old Team", teamVersionId: teamId }), /TEAM_IR_V2_REQUIRED/);
  assert.deepEqual(project.taskRecords, []);
  assert.equal(await hashTree(join(teamRoot, ".ogs", "runs")), historicalTeamRunDigest,
    "IR inspection, rejected release, mount lookup, and rejected Task creation must not migrate or rewrite legacy Team Runs");
  assert.equal(await hashTree(teamRoot), legacyWorkspaceDigest,
    "v2/legacy API rejection, mount lookup, and Task creation must leave the complete legacy Team workspace unchanged");

  const historyProject = join(root, "history-project");
  const historyRun = join(historyProject, ".ogs", "runs", "run-1");
  await mkdir(join(historyRun, "control"), { recursive: true });
  await mkdir(join(historyProject, ".site"), { recursive: true });
  await writeFile(join(historyProject, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [{ taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1", teamCoreDigest: "a".repeat(64) }] }));
  await writeFile(join(historyRun, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "history-project", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", teamCoreDigest: "a".repeat(64), runId: "run-1" }));
  await writeFile(join(historyRun, "control", "state.json"), JSON.stringify({ status: "completed" }));
  await writeFile(join(historyRun, "run-plan.json"), JSON.stringify({ runId: "run-1" }));
  await writeFile(join(historyRun, "state.json"), JSON.stringify({ graphState: { finalOutputsByRoleId: { reviewer: [{ content: "historical result" }] }, finalOutputRoleOrder: ["reviewer"] } }));
  const projectHistoryDigest = await hashTree(join(historyProject, ".ogs", "runs"));
  const history = await createFileRecentRunStore({ projectsRoot: root }).readRunArtifacts("history-project", "task-1", "run-1");
  assert.equal(history.outputSummary, "reviewer: historical result");
  assert.equal(await hashTree(join(historyProject, ".ogs", "runs")), projectHistoryDigest,
    "history reads must not rewrite, migrate, or add Run evidence");
});
