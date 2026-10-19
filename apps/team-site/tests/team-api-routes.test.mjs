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
  assert.deepEqual(calls[1], ["query", { query: "ops", category: "engineering", status: "released", sort: "name", page: "2", pageSize: "5" }]);
  assert.deepEqual(harness.sent[2].payload, { teams: [{ projectId: "team-1", public: true }], stats: { total: 1 }, pagination: { page: 1 } });
});

test("Team version actions preserve their statuses, IDs, bodies, and error mapping", async () => {
  const calls = [];
  const harness = routeHarness({
    forkTeamVersion: async (id) => (calls.push(["edit", id]), { projectId: "draft-3" }),
    releaseTeamVersion: async (id) => (calls.push(["release", id]), { projectId: id }),
    archiveTeamVersion: async (id) => (calls.push(["archive", id]), { projectId: id }),
    simulateTeamVersion: async (id, input) => (calls.push(["simulate", id, input]), { output: "ok" })
  });

  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-1/edit"), true);
  assert.equal(harness.sent[0].status, 201);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-2/release"), true);
  assert.equal(harness.sent[1].status, 200);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-3/archive"), true);
  assert.equal(harness.sent[2].status, 200);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-3/simulate", { prompt: "Review this" }), true);
  assert.equal(harness.sent[3].status, 200);
  assert.deepEqual(calls, [["edit", "team-1"], ["release", "team-2"], ["archive", "team-3"], ["simulate", "team-3", { prompt: "Review this" }]]);

  harness.sent.length = 0;
  const failing = routeHarness({ releaseTeamVersion: async () => { throw new Error("Cannot release."); } });
  assert.equal(await failing.invoke("POST", "/api/v1/team-versions/team-4/release"), true);
  assert.deepEqual(failing.sent[0], { status: 400, payload: { error: "Cannot release." } });
});

test("Team routes leave unrelated requests unmatched", async () => {
  const harness = routeHarness({});
  assert.equal(await harness.invoke("GET", "/api/v1/projects"), false);
  assert.equal(await harness.invoke("PUT", "/api/v1/team-factory"), false);
  assert.equal(await harness.invoke("POST", "/api/v1/team-versions/team-1/release/extra"), false);
});
