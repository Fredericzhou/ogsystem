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
    errorStatus: () => 422,
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

test("project workspace, read, and patch routes preserve IDs, DTO shaping, and statuses", async () => {
  const harness = routeHarness({
    createProjectWorkspace: async (...args) => (harness.calls.push(["workspace", ...args]), { projectId: args[0] }),
    getProject: async (id) => (harness.calls.push(["get", id]), { projectId: id }),
    updateProject: async (...args) => (harness.calls.push(["patch", ...args]), { projectId: args[0], name: args[1].name })
  });

  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-1/workspaces", { name: "Docs", workspaceKey: "docs", locale: "en" }), true);
  assert.deepEqual(harness.sent[0], { status: 201, payload: { projectId: "proj-1", public: true } });
  assert.deepEqual(harness.calls[1], ["workspace", "proj-1", { name: "Docs", workspaceKey: "docs", locale: "en" }]);

  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-1"), true);
  assert.deepEqual(harness.sent[1], { status: 200, payload: { projectId: "proj-1", public: true } });
  assert.equal(await harness.invoke("PATCH", "/api/v1/projects/proj-1", { name: "Updated" }), true);
  assert.deepEqual(harness.calls[4], ["patch", "proj-1", { name: "Updated" }]);
  assert.deepEqual(harness.sent[2], { status: 200, payload: { projectId: "proj-1", name: "Updated", public: true } });
});

test("team graph, design validation, and chat routes preserve locale, body limits, and model selection", async () => {
  const harness = routeHarness({
    getProjectGraph: async (...args) => (harness.calls.push(["graph", ...args]), { graph: true }),
    getProjectDesign: async (...args) => (harness.calls.push(["design", ...args]), { design: true }),
    saveProjectDesign: async (...args) => (harness.calls.push(["saveDesign", ...args]), { projectId: args[0], saved: true }),
    validateProjectDesign: async (...args) => (harness.calls.push(["validate", ...args]), { valid: true })
  });

  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-2/team/graph?locale=ja"), true);
  assert.deepEqual(harness.calls[0], ["graph", "proj-2", "ja"]);
  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-2/team/design"), true);
  assert.deepEqual(harness.calls[1], ["design", "proj-2", "zh-CN"]);
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-2/team/design/validate", { nodes: [] }), true);
  assert.equal(harness.calls[2][0], "readBody");
  assert.equal(harness.calls[2][1].method, "POST");
  assert.equal(harness.calls[2][2], 4 * 1024 * 1024);
  assert.deepEqual(harness.sent[2], { status: 200, payload: { valid: true } });
  const designBody = { authoring: { version: 1 }, expectedProjectDigest: "digest-1" };
  assert.equal(await harness.invoke("PUT", "/api/v1/projects/proj-2/team/design", designBody), true);
  assert.equal(harness.calls[4][0], "readBody");
  assert.equal(harness.calls[4][2], 4 * 1024 * 1024);
  assert.deepEqual(harness.calls[5], ["saveDesign", "proj-2", designBody]);
  assert.deepEqual(harness.sent[3], { status: 200, payload: { projectId: "proj-2", saved: true, public: true } });

  const projectionFailure = routeHarness({
    getProjectGraph: async () => { throw new Error("graph unavailable"); },
    getProjectDesign: async () => { throw new Error("design unavailable"); }
  });
  assert.equal(await projectionFailure.invoke("GET", "/api/v1/projects/proj-2/team/graph?locale=en"), true);
  assert.deepEqual(projectionFailure.sent[0], { status: 422, payload: { error: "graph unavailable" } });
  assert.equal(await projectionFailure.invoke("GET", "/api/v1/projects/proj-2/team/design"), true);
  assert.deepEqual(projectionFailure.sent[1], { status: 422, payload: { error: "design unavailable" } });

  const validationFailure = routeHarness({
    validateProjectDesign: async () => { throw new Error("PROJECT_DESIGN_INVALID: invalid Mermaid source."); }
  });
  assert.equal(await validationFailure.invoke("POST", "/api/v1/projects/proj-2/team/design/validate", { systemSource: "invalid" }), true);
  assert.deepEqual(validationFailure.sent[0], {
    status: 422,
    payload: { error: "PROJECT_DESIGN_INVALID: invalid Mermaid source." }
  });

  const chatHarness = routeHarness({
    chatTeamAssistant: async (...args) => (chatHarness.calls.push(["chat", ...args]), { status: 202, body: { accepted: true } })
  });
  assert.equal(await chatHarness.invoke("POST", "/api/v1/projects/proj-2/team/chat", { prompt: "Review", modelRef: "direct:test" }), true);
  assert.deepEqual(chatHarness.calls[1], ["chat", "proj-2", { prompt: "Review", modelRef: "direct:test" }]);
  assert.deepEqual(chatHarness.sent[0], { status: 202, payload: { accepted: true } });

  const unavailableChat = routeHarness({
    chatTeamAssistant: async () => { throw new Error("fetch failed"); }
  }, { visualizerUrl: "http://127.0.0.1:4177/" });
  assert.equal(await unavailableChat.invoke("POST", "/api/v1/projects/proj-2/team/chat", { prompt: "Review" }), true);
  assert.deepEqual(unavailableChat.sent[0], {
    status: 502,
    payload: {
      error: "TEAM_ASSISTANT_UNAVAILABLE: fetch failed. Visualizer upstream: http://127.0.0.1:4177. Configure OGS_VIS_URL when starting Team Site."
    }
  });
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

test("readiness, team confirmation, material batches, and standalone run start retain response contracts", async () => {
  const harness = routeHarness({
    getProjectReadiness: async (id) => ({ projectId: id, ready: true }),
    confirmProjectTeam: async (id) => ({ projectId: id, status: "confirmed" }),
    addProjectMaterials: async (id, files) => files.map((file) => ({ projectId: id, name: file.name })),
    startProjectRun: async (id, payload) => ({ projectId: id, prompt: payload.prompt })
  });
  assert.equal(await harness.invoke("GET", "/api/v1/projects/proj-3/readiness"), true);
  assert.deepEqual(harness.sent[0], { status: 200, payload: { projectId: "proj-3", ready: true } });
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-3/team/confirm"), true);
  assert.deepEqual(harness.sent[1], { status: 200, payload: { projectId: "proj-3", status: "confirmed", public: true } });
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-3/materials", { files: [{ name: "brief.md" }] }), true);
  assert.deepEqual(harness.sent[2], { status: 201, payload: { materials: [{ projectId: "proj-3", name: "brief.md" }] } });
  assert.equal(await harness.invoke("POST", "/api/v1/projects/proj-3/runs", { prompt: "Summarize" }), true);
  assert.deepEqual(harness.sent[3], { status: 200, payload: { projectId: "proj-3", prompt: "Summarize" } });
  assert.equal(harness.calls.filter(([name]) => name === "readBody").at(-1).length, 2);
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
