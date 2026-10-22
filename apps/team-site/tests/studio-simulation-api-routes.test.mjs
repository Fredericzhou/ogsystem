import assert from "node:assert/strict";
import test from "node:test";
import { handleStudioSimulationRoutes } from "../api/studio-simulation-routes.mjs";

function harness(useCases) {
  const sent = [];
  const base = {
    request: { method: "GET" },
    response: {},
    url: new URL("http://site.test/"),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: (error) => error.message === "STUDIO_SIMULATION_NOT_FOUND" ? 404 : 400,
    useCases
  };
  return {
    sent,
    invoke(method, path, body = {}) {
      return handleStudioSimulationRoutes({ ...base, request: { method }, url: new URL(`http://site.test${path}`), readBody: async () => body });
    }
  };
}

test("Studio Simulation API creates, lists, reads, and replays owner-scoped evidence", async () => {
  const calls = [];
  const route = harness({
    createSimulation: async (...args) => (calls.push(["create", ...args]), { simulation: { simulationId: "sim-1" } }),
    listTeamVersionSimulations: async (...args) => (calls.push(["list", ...args]), { simulations: [] }),
    getTeamVersionSimulation: async (...args) => (calls.push(["get", ...args]), { simulation: { simulationId: args[2] } }),
    getTeamVersionSimulationEvents: async (...args) => (calls.push(["events", ...args]), { events: [] })
  });
  const base = "/api/v1/teams/team-1/versions/team-v1/simulations";
  assert.equal(await route.invoke("POST", base, { prompt: "Inspect" }), true);
  assert.equal(route.sent[0].status, 201);
  assert.equal(await route.invoke("GET", base), true);
  assert.equal(await route.invoke("GET", `${base}/sim-1`), true);
  assert.equal(await route.invoke("GET", `${base}/sim-1/events`), true);
  assert.deepEqual(calls.map(([kind]) => kind), ["create", "list", "get", "events"]);
  assert.deepEqual(calls[0], ["create", "team-1", "team-v1", { prompt: "Inspect" }]);
  assert.equal(await route.invoke("POST", `${base}/sim-1/events`), false);
  assert.equal(await route.invoke("GET", "/api/v1/projects/project-1/simulations"), false);
});

test("Studio Simulation API maps owner misses without exposing other namespace details", async () => {
  const route = harness({ getTeamVersionSimulation: async () => { throw new Error("STUDIO_SIMULATION_NOT_FOUND"); } });
  assert.equal(await route.invoke("GET", "/api/v1/teams/team-1/versions/team-v1/simulations/sim-1"), true);
  assert.deepEqual(route.sent[0], { status: 404, payload: { error: "STUDIO_SIMULATION_NOT_FOUND" } });
});
