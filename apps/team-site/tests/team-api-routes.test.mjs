import assert from "node:assert/strict";
import test from "node:test";
import { handleTeamRoutes } from "../api/team-routes.mjs";

function routeHarness(useCases) {
  const sent = [];
  const calls = [];
  const dependencies = {
    request: { method: "GET" },
    response: {},
    url: new URL("http://site.test/"),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: () => 400,
    publicProject: (project) => ({ ...project, public: true }),
    useCases
  };
  return {
    sent,
    calls,
    invoke: (method, path, body = {}) => handleTeamRoutes({
      ...dependencies,
      request: { method },
      url: new URL(`http://site.test${path}`),
      readBody: async () => body
    })
  };
}

test("Team collection routes list factory teams, create drafts, and query repository", async () => {
  const calls = [];
  const harness = routeHarness({
    listTeamFactory: async () => [{ projectId: "draft-1" }],
    queryTeamRepository: async (filters) => (calls.push(["query", filters]), { teams: [{ projectId: "team-1" }], stats: { total: 1 }, pagination: { page: 1 } }),
    createTeamDraft: async (input) => (calls.push(["createTeamDraft", input]), { projectId: "draft-2" })
  });

  assert.equal(await harness.invoke("GET", "/api/v1/team-factory"), true);
  assert.deepEqual(harness.sent[0], { status: 200, payload: { teams: [{ projectId: "draft-1", public: true }] } });

  assert.equal(await harness.invoke("POST", "/api/v1/team-factory", { name: "Ops", overview: "Coordinate work", locale: "en" }), true);
  assert.equal(harness.sent[1].status, 201);
  assert.deepEqual(calls[0], ["createTeamDraft", { name: "Ops", overview: "Coordinate work", locale: "en" }]);

  assert.equal(await harness.invoke("GET", "/api/v1/team-repository?query=ops&category=engineering&sort=name&page=2&pageSize=5"), true);
  assert.deepEqual(calls[1], ["query", { query: "ops", category: "engineering", status: "all", sort: "name", page: "2", pageSize: "5" }]);
  assert.deepEqual(harness.sent[2].payload, { teams: [{ projectId: "team-1", public: true }], stats: { total: 1 }, pagination: { page: 1 } });
});

test("Team version actions preserve their statuses, IDs, bodies, and error mapping", async () => {
  const calls = [];
  const harness = routeHarness({
    forkTeamVersion: async (id) => (calls.push(["edit", id]), { projectId: "draft-3" }),
    releaseTeamVersion: async (id) => (calls.push(["release", id]), { projectId: id }),
    archiveTeamVersion: async (id) => (calls.push(["archive", id]), { projectId: id })
  });

  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-1/edit"), true);
  assert.equal(harness.sent[0].status, 201);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-2/release"), true);
  assert.equal(harness.sent[1].status, 200);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-3/archive"), true);
  assert.equal(harness.sent[2].status, 200);
  assert.deepEqual(calls, [["edit", "team-1"], ["release", "team-2"], ["archive", "team-3"]]);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-3/simulate", { prompt: "Review this" }), false);

  harness.sent.length = 0;
  const failing = routeHarness({ releaseTeamVersion: async () => { throw new Error("Cannot release."); } });
  assert.equal(await failing.invoke("POST", "/api/v1/team-versions/team-4/release"), true);
  assert.deepEqual(failing.sent[0], { status: 400, payload: { error: "Cannot release." } });
});

test("Team design routes use TeamVersion identity and keep writes outside the Project API", async () => {
  const calls = [];
  const harness = routeHarness({
    getTeamVersion: async (id) => (calls.push(["getTeam", id]), { projectId: id, teamVersionId: id }),
    updateTeamMetadata: async (...args) => (calls.push(["updateTeamMetadata", ...args]), { teamVersionId: args[0], ...args[1] }),
    getTeamDesign: async (...args) => (calls.push(["design", ...args]), { authoring: true }),
    getTeamGraph: async (...args) => (calls.push(["getTeamGraph", ...args]), { graph: true }),
    chatTeamAssistant: async (...args) => (calls.push(["chatTeamAssistant", ...args]), { status: 202, body: { accepted: true } }),
    validateTeamDesign: async (...args) => (calls.push(["validate", ...args]), { ok: true }),
    saveTeamDesign: async (...args) => (calls.push(["save", ...args]), { teamVersionId: args[0], saved: true }),
    getTeamDesignAssets: async (...args) => (calls.push(["assets", ...args]), { roles: {}, contracts: "" }),
    saveTeamDesignAssets: async (...args) => (calls.push(["saveAssets", ...args]), { roles: {}, contracts: "" })
  });

  assert.equal(await harness.invoke("GET", "/api/v1/team-versions/team-v1"), true);
  assert.equal(await harness.invoke("PATCH", "/api/v1/team-versions/team-v1", { name: "Team", overview: "Purpose" }), true);
  assert.deepEqual(calls[0], ["getTeam", "team-v1"]);
  assert.deepEqual(calls[1], ["updateTeamMetadata", "team-v1", { name: "Team", overview: "Purpose" }]);
  assert.equal(await harness.invoke("GET", "/api/v1/team-versions/team-v1/design?locale=en"), true);
  assert.deepEqual(calls[2], ["design", "team-v1", "en"]);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-v1/design/validate", { authoring: {} }), true);
  assert.deepEqual(calls[3], ["validate", "team-v1", { authoring: {} }]);
  assert.equal(await harness.invoke("PUT", "/api/v1/team-versions/team-v1/design", { authoring: {}, expectedTeamVersionDigest: "digest" }), true);
  assert.deepEqual(calls[4], ["save", "team-v1", { authoring: {}, expectedTeamVersionDigest: "digest" }]);
  assert.equal(await harness.invoke("GET", "/api/v1/team-versions/team-v1/design/assets"), true);
  assert.deepEqual(calls[5], ["assets", "team-v1"]);
  assert.equal(await harness.invoke("PUT", "/api/v1/team-versions/team-v1/design/assets", { assets: { contracts: "{}" } }), true);
  assert.deepEqual(calls[6], ["saveAssets", "team-v1", { assets: { contracts: "{}" } }]);
  assert.equal(await harness.invoke("GET", "/api/v1/projects/team-v1/team/design"), false);
  assert.equal(await harness.invoke("GET", "/api/v1/team-versions/team-v1/graph?locale=en"), true);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-v1/chat", { message: "adjust" }), true);
  assert.deepEqual(calls[7], ["getTeamGraph", "team-v1", "en"]);
  assert.deepEqual(calls[8], ["chatTeamAssistant", "team-v1", { message: "adjust" }]);
});

test("release baseline routes are TeamVersion scoped and versioned through application use cases", async () => {
  const calls = [];
  const route = routeHarness({
    getReleaseBaselineScenarios: async (id) => (calls.push(["get-baselines", id]), { teamVersionId: id, scenarios: [] }),
    saveReleaseBaselineScenarios: async (id, body) => (calls.push(["save-baselines", id, body]), { teamVersionId: id, scenarios: body.scenarios })
  });
  assert.equal(await route.invoke("GET", "/api/v1/team-versions/team-v1/release-baselines"), true);
  assert.deepEqual(route.sent[0].payload, { teamVersionId: "team-v1", scenarios: [] });
  assert.equal(await route.invoke("PUT", "/api/v1/team-versions/team-v1/release-baselines", { scenarios: [{ scenarioId: "smoke" }] }), true);
  assert.deepEqual(calls, [["get-baselines", "team-v1"], ["save-baselines", "team-v1", { scenarios: [{ scenarioId: "smoke" }] }]]);
});

test("release readiness delegates the current digest and proof decision to Team lifecycle", async () => {
  const calls = [];
  const route = routeHarness({
    getTeamReleaseReadiness: async (id) => (calls.push(id), {
      teamVersionId: id, teamCoreDigest: "current-digest", ready: false, reason: "TEAM_RELEASE_BASELINE_EVIDENCE_REQUIRED"
    })
  });
  assert.equal(await route.invoke("GET", "/api/v1/team-versions/team-v1/release-readiness"), true);
  assert.deepEqual(calls, ["team-v1"]);
  assert.equal(route.sent[0].payload.ready, false);
  assert.equal(route.sent[0].payload.teamCoreDigest, "current-digest");
});

test("Team routes leave unrelated requests unmatched", async () => {
  const harness = routeHarness({});
  assert.equal(await harness.invoke("GET", "/api/v1/projects"), false);
  assert.equal(await harness.invoke("PUT", "/api/v1/team-factory"), false);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-1/release/extra"), false);
});
