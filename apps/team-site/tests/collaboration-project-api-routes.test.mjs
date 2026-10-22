import assert from "node:assert/strict";
import test from "node:test";
import { handleCollaborationProjectRoutes } from "../api/collaboration-project-routes.mjs";

function routeHarness(useCases = {}, overrides = {}) {
  const sent = [];
  const calls = [];
  const dependencies = {
    request: { method: "GET" },
    response: {},
    url: new URL("http://site.test/"),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: (error) => /NOT_FOUND/.test(error instanceof Error ? error.message : String(error)) ? 404 : 422,
    publicProject: (project) => ({ ...project, public: true }),
    useCases,
    ...overrides
  };
  return {
    sent,
    calls,
    invoke(method, path, body = {}) {
      return handleCollaborationProjectRoutes({
        ...dependencies,
        request: { method },
        url: new URL(`http://site.test${path}`),
        readBody: async (...args) => (calls.push(["readBody", ...args]), body)
      });
    }
  };
}

test("project read and patch routes preserve IDs, DTO shaping, and statuses", async () => {
  const harness = routeHarness({
    getProject: async (id) => (harness.calls.push(["get", id]), { projectId: id, projectType: "collaboration" }),
    updateProject: async (...args) => (harness.calls.push(["patch", ...args]), { projectId: args[0], name: args[1].name })
  });

  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-1"), true);
  assert.deepEqual(harness.sent[0], { status: 200, payload: { projectId: "proj-1", projectType: "collaboration", public: true } });
  assert.equal(await harness.invoke("PATCH", "/api/v1/projects/proj-1", { name: "Updated" }), true);
  assert.ok(harness.calls.some((call) => call[0] === "patch" && call[1] === "proj-1" && call[2].name === "Updated"));
  assert.deepEqual(harness.sent[1], { status: 200, payload: { projectId: "proj-1", name: "Updated", public: true } });
});

test("Project metadata route rejects Team records so Team metadata stays in Studio", async () => {
  const harness = routeHarness({
    getProject: async (id) => ({ projectId: id, projectType: "team" }),
    updateProject: async () => assert.fail("Project update must not receive Team metadata")
  });
  assert.equal(await harness.invoke("PATCH", "/api/v1/projects/team-v1", { name: "Renamed" }), true);
  assert.equal(harness.sent[0].status, 404);
  assert.match(harness.sent[0].payload.error, /PROJECT_NOT_FOUND/);
});

test("Project routes leave Team design APIs outside the Project boundary", async () => {
  const harness = routeHarness({});
  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-2/team/graph?locale=ja"), false);
  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-2/team/design"), false);
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-2/team/design/validate", { nodes: [] }), false);
  assert.equal(await harness.invoke("PUT", "/api/v1/projects/proj-2/team/design", { authoring: {} }), false);
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-2/team/chat", { prompt: "Review" }), false);
  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-2/team"), false);
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-2/workspaces"), false);
});

test("Project Team adjustment creates a source-linked Studio draft and validates errors", async () => {
  const harness = routeHarness({
    createProjectTeamAdjustment: async (...args) => (harness.calls.push(["adjust", ...args]), {
      draft: { projectId: "team-draft" }, collaborationProjectId: args[0], sourceTeamVersionId: args[1]
    })
  });
  assert.equal(await harness.invoke("POST", "/api/v1/projects/project-1/team-adjustments", { teamVersionId: "team-v1" }), true);
  assert.deepEqual(harness.calls[1], ["adjust", "project-1", "team-v1"]);
  assert.deepEqual(harness.sent[0], { status: 201, payload: {
    draft: { projectId: "team-draft", public: true }, collaborationProjectId: "project-1", sourceTeamVersionId: "team-v1"
  } });
  const invalid = routeHarness({ createProjectTeamAdjustment: async () => { throw new Error("TEAM_VERSION_NOT_MOUNTED"); } });
  await invalid.invoke("POST", "/api/v1/projects/project-1/team-adjustments", { teamVersionId: "other-team" });
  assert.deepEqual(invalid.sent[0], { status: 422, payload: { error: "TEAM_VERSION_NOT_MOUNTED" } });
});

test("readiness, team confirmation, and material batches retain response contracts", async () => {
  const harness = routeHarness({
    getProjectReadiness: async (id) => ({ projectId: id, ready: true }),
    confirmProjectTeam: async (id) => ({ projectId: id, status: "confirmed" }),
    addProjectMaterials: async (id, files) => files.map((file) => ({ projectId: id, name: file.name }))
  });
  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-3/readiness"), true);
  assert.deepEqual(harness.sent[0], { status: 200, payload: { projectId: "proj-3", ready: true } });
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-3/team/confirm"), true);
  assert.deepEqual(harness.sent[1], { status: 200, payload: { projectId: "proj-3", status: "confirmed", public: true } });
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-3/materials", { files: [{ name: "brief.md" }] }), true);
  assert.deepEqual(harness.sent[2], { status: 201, payload: { materials: [{ projectId: "proj-3", name: "brief.md" }] } });
});

test("Project Runs can only start through a Task", async () => {
  const harness = routeHarness({
    startProjectRun: async (...args) => (harness.calls.push(["run", ...args]), { accepted: true })
  });
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-4/runs", { prompt: "run" }), false);
  assert.deepEqual(harness.calls, []);
});

test("project routes map errors and leave nested Run resources and unknown paths unmatched", async () => {
  const harness = routeHarness({
    getProject: async () => { throw new Error("not found"); },
    getProjectReadiness: async () => { throw new Error("not ready"); }
  });
  assert.equal(await harness.invoke("GET", "/api/v1/projects/missing"), true);
  assert.deepEqual(harness.sent[0], { status: 404, payload: { error: "not found" } });
  assert.equal(await harness.invoke("GET", "/api/v1/projects/p-1/readiness"), true);
  assert.deepEqual(harness.sent[1], { status: 422, payload: { error: "not ready" } });
  assert.equal(await harness.invoke("GET", "/api/v1/projects/p-1/runs/run-1"), false);
  assert.equal(await harness.invoke("GET", "/api/v1/projects/p-1/team/chat"), false);
  assert.equal(await harness.invoke("GET", "/api/v1/unknown"), false);
});
