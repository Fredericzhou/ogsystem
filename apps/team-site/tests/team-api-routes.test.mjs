import assert from "node:assert/strict";
import test from "node:test";
import { handleTeamRoutes } from "../api/team-routes.mjs";
import { errorStatus } from "../api/error-status.mjs";

function routeHarness(useCases) {
  const sent = [];
  const calls = [];
  const dependencies = {
    request: { method: "GET" },
    response: {},
    url: new URL("http://site.test/"),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus,
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

test("Team collection routes list factory teams and query repository without legacy draft creation", async () => {
  const calls = [];
  const harness = routeHarness({
    listTeamFactory: async () => [{ projectId: "draft-1" }],
    queryTeamRepository: async (filters) => (calls.push(["query", filters]), { teams: [{ projectId: "team-1" }], stats: { total: 1 }, pagination: { page: 1 } }),
    createTeamDraft: async () => { throw new Error("legacy draft creation must not be called"); }
  });

  assert.equal(await harness.invoke("GET", "/api/v1/team-factory"), true);
  assert.deepEqual(harness.sent[0], { status: 200, payload: { teams: [{ projectId: "draft-1", public: true }] } });

  assert.equal(await harness.invoke("POST", "/api/v1/team-factory", { name: "Ops", overview: "Coordinate work", locale: "en" }), false);

  assert.equal(await harness.invoke("GET", "/api/v1/team-repository?query=ops&category=engineering&sort=name&page=2&pageSize=5"), true);
  assert.deepEqual(calls[0], ["query", { query: "ops", category: "engineering", status: "all", sort: "name", page: "2", pageSize: "5" }]);
  assert.deepEqual(harness.sent[1].payload, { teams: [{ projectId: "team-1", public: true }], stats: { total: 1 }, pagination: { page: 1 } });
});

test("native Team IR draft route delegates to v2 creation without reusing legacy creation", async () => {
  const calls = [];
  const harness = routeHarness({
    createTeamIrDraft: async (input) => (calls.push(input), { projectId: "native-v2", source: "team-ir-v2" })
  });
  assert.equal(await harness.invoke("POST", "/api/v1/team-ir-drafts", { name: "Native v2", overview: "Typed team", locale: "en" }), true);
  assert.deepEqual(harness.sent[0], { status: 201, payload: { projectId: "native-v2", source: "team-ir-v2", public: true } });
  assert.deepEqual(calls, [{ name: "Native v2", overview: "Typed team", locale: "en" }]);
});

test("Team version actions preserve their statuses, IDs, bodies, and error mapping", async () => {
  const calls = [];
  const harness = routeHarness({
    forkTeamVersion: async (id) => (calls.push(["edit", id]), { projectId: "draft-3" }),
    releaseTeamVersion: async (id) => (calls.push(["release", id]), { projectId: id }),
    archiveTeamVersion: async (id) => (calls.push(["archive", id]), { projectId: id }),
    deleteTeamVersion: async (id) => (calls.push(["deleteVersion", id]), { teamId: "root", deletedTeamVersionIds: [id] }),
    deleteTeam: async (id) => (calls.push(["delete", id]), { teamId: id, deletedTeamVersionIds: [id] })
  });

  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-1/edit"), true);
  assert.equal(harness.sent[0].status, 201);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-2/release"), true);
  assert.equal(harness.sent[1].status, 200);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-3/archive"), true);
  assert.equal(harness.sent[2].status, 200);
  assert.equal(await harness.invoke("DELETE", "/api/v1/team-versions/draft-1"), true);
  assert.equal(harness.sent[3].status, 200);
  assert.equal(await harness.invoke("DELETE", "/api/v1/teams/team-4"), true);
  assert.equal(harness.sent[4].status, 200);
  assert.deepEqual(calls, [["edit", "team-1"], ["release", "team-2"], ["archive", "team-3"], ["deleteVersion", "draft-1"], ["delete", "team-4"]]);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-3/simulate", { prompt: "Review this" }), false);

  harness.sent.length = 0;
  const failing = routeHarness({ releaseTeamVersion: async () => { throw new Error("Cannot release."); } });
  assert.equal(await failing.invoke("POST", "/api/v1/team-versions/team-4/release"), true);
  assert.deepEqual(failing.sent[0], { status: 400, payload: { error: "Cannot release." } });

  const blocked = new Error("TEAM_IN_USE: mounted by Projects.");
  blocked.code = "TEAM_IN_USE";
  blocked.blockedProjects = [{ projectId: "project-a", name: "A" }, { projectId: "project-b", name: "B" }];
  const deleteFailure = routeHarness({ deleteTeam: async () => { throw blocked; } });
  assert.equal(await deleteFailure.invoke("DELETE", "/api/v1/teams/team-root"), true);
  assert.deepEqual(deleteFailure.sent[0], {
    status: 409,
    payload: { error: blocked.message, code: "TEAM_IN_USE", blockedProjects: blocked.blockedProjects }
  });

  const staleSave = new Error("TEAM_VERSION_DIGEST_CONFLICT: the TeamVersion changed in another editor.");
  const saveFailure = routeHarness({ saveTeamVersion: async () => { throw staleSave; } });
  assert.equal(await saveFailure.invoke("PUT", "/api/v1/team-versions/team-v1/save", { authoring: {} }), true);
  assert.deepEqual(saveFailure.sent[0], { status: 409, payload: { error: staleSave.message } });

  const oldDesignSave = routeHarness({ saveTeamVersion: async () => { throw new Error("TEAM_IR_V2_REQUIRED: TeamVersion content must be authored and saved through Team IR v2."); } });
  assert.equal(await oldDesignSave.invoke("PUT", "/api/v1/team-versions/team-v1/save", { authoring: {} }), true);
  assert.equal(oldDesignSave.sent[0].status, 409);
});

test("TeamVersion metadata routes remain available while legacy authoring routes fail closed", async () => {
  const calls = [];
  const harness = routeHarness({
    getTeamVersion: async (id) => (calls.push(["getTeam", id]), { projectId: id, teamVersionId: id }),
    updateTeamMetadata: async (...args) => (calls.push(["updateTeamMetadata", ...args]), { teamVersionId: args[0], ...args[1] }),
    getTeamGraph: async (...args) => (calls.push(["getTeamGraph", ...args]), { graph: true }),
    chatTeamAssistant: async (...args) => (calls.push(["chatTeamAssistant", ...args]), { status: 202, body: { accepted: true } }),
    saveTeamVersion: async (...args) => (calls.push(["saveTeamVersion", ...args]), { teamVersionId: args[0], createdDraft: true })
  });

  assert.equal(await harness.invoke("GET", "/api/v1/team-versions/team-v1"), true);
  assert.equal(await harness.invoke("PATCH", "/api/v1/team-versions/team-v1", { name: "Team", overview: "Purpose" }), true);
  assert.deepEqual(calls[0], ["getTeam", "team-v1"]);
  assert.deepEqual(calls[1], ["updateTeamMetadata", "team-v1", { name: "Team", overview: "Purpose" }]);
  for (const [method, path, body] of [
    ["GET", "/api/v1/team-versions/team-v1/design?locale=en"],
    ["POST", "/api/v1/team-versions/team-v1/design/validate", { authoring: {} }],
    ["PUT", "/api/v1/team-versions/team-v1/design", { authoring: {}, expectedTeamVersionDigest: "digest" }],
    ["GET", "/api/v1/team-versions/team-v1/design/assets"],
    ["PUT", "/api/v1/team-versions/team-v1/design/assets", { assets: { contracts: "{}" } }]
  ]) {
    assert.equal(await harness.invoke(method, path, body), true, `${method} ${path} is explicitly rejected`);
    assert.equal(harness.sent.at(-1).status, 409);
    assert.match(harness.sent.at(-1).payload.error, /TEAM_IR_V2_REQUIRED/);
  }

  assert.equal(await harness.invoke("PUT", "/api/v1/team-versions/team-v1/save", { name: "Team", expectedTeamVersionDigest: "digest-1" }), true);
  assert.deepEqual(calls[2], ["saveTeamVersion", "team-v1", { name: "Team", expectedTeamVersionDigest: "digest-1" }]);
  assert.equal(await harness.invoke("GET", "/api/v1/projects/team-v1/team/design"), false);
  assert.equal(await harness.invoke("GET", "/api/v1/team-versions/team-v1/graph?locale=en"), true);
  assert.equal(harness.sent.at(-1).status, 409);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-v1/chat", { message: "adjust" }), true);
  assert.equal(harness.sent.at(-1).status, 409);
  assert.equal(calls.length, 3, "legacy graph and assistant calls are never dispatched");
});

test("Team IR routes remain version-scoped while legacy design routes are rejected", async () => {
  const calls = [];
  const harness = routeHarness({
    getTeamIr: async (id) => (calls.push(["get-ir", id]), { teamVersionId: id, teamIR: null, semanticDigest: null }),
    validateTeamIr: async (...args) => (calls.push(["validate-ir", ...args]), { ok: true, diagnostics: [] }),
    saveTeamIr: async (...args) => (calls.push(["save-ir", ...args]), { saved: true, semanticDigest: "semantic" }),
    validateTeamDesign: async () => { throw new Error("legacy endpoint invoked"); },
    saveTeamDesign: async () => { throw new Error("legacy endpoint invoked"); },
    saveTeamVersion: async () => { throw new Error("legacy endpoint invoked"); }
  });

  assert.equal(await harness.invoke("GET", "/api/v1/team-versions/team-v1/ir"), true);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-v1/ir/validate", { teamIR: { schemaVersion: 2 } }), true);
  assert.equal(await harness.invoke("PUT", "/api/v1/team-versions/team-v1/ir", { teamIR: { schemaVersion: 2 }, expectedSemanticDigest: null }), true);
  assert.deepEqual(calls, [
    ["get-ir", "team-v1"],
    ["validate-ir", "team-v1", { schemaVersion: 2 }],
    ["save-ir", "team-v1", { teamIR: { schemaVersion: 2 }, expectedSemanticDigest: null }]
  ]);

  for (const [method, path, body] of [
    ["POST", "/api/v1/team-versions/team-v1/design/validate", { schemaVersion: 2 }],
    ["PUT", "/api/v1/team-versions/team-v1/design", { teamIR: { schemaVersion: 2 } }]
  ]) {
    assert.equal(await harness.invoke(method, path, body), true);
    assert.equal(harness.sent.at(-1).status, 409);
  }
});

test("legacy release baseline routes are rejected in favor of Team IR v2 evidence", async () => {
  const route = routeHarness({
    getReleaseBaselineScenarios: async () => { throw new Error("legacy baseline route invoked"); },
    saveReleaseBaselineScenarios: async () => { throw new Error("legacy baseline route invoked"); }
  });
  assert.equal(await route.invoke("GET", "/api/v1/team-versions/team-v1/release-baselines"), true);
  assert.equal(route.sent[0].status, 409);
  assert.equal(await route.invoke("PUT", "/api/v1/team-versions/team-v1/release-baselines", { scenarios: [{ scenarioId: "smoke" }] }), true);
  assert.equal(route.sent.at(-1).status, 409);
});

test("legacy release baseline batch and comparison routes do not dispatch", async () => {
  const calls = [];
  const route = routeHarness({
    startReleaseBaselineBatch: async (...args) => (calls.push(["start", ...args]), { batchId: "batch-1", status: "running" }),
    getReleaseBaselineBatchStatus: async (...args) => (calls.push(["latest", ...args]), { teamVersionId: args[0], batch: { batchId: "batch-1" } }),
    cancelReleaseBaselineBatch: async (...args) => (calls.push(["cancel", ...args]), { batchId: args[1], cancelRequested: true }),
    compareReleaseBaselines: async (...args) => (calls.push(["compare", ...args]), { availableTargets: {}, selectedTarget: "parent_version", scenarios: [] })
  });
  for (const [method, path, body] of [
    ["POST", "/api/v1/team-versions/team-v1/release-baselines/batches", { mode: "all_required" }],
    ["GET", "/api/v1/team-versions/team-v1/release-baselines/batches/latest"],
    ["POST", "/api/v1/team-versions/team-v1/release-baselines/batches/batch-1/cancel", {}],
    ["GET", "/api/v1/team-versions/team-v1/release-baselines/comparison?target=latest_released"]
  ]) {
    assert.equal(await route.invoke(method, path, body), true);
    assert.equal(route.sent.at(-1).status, 409);
  }
  assert.deepEqual(calls, []);
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
