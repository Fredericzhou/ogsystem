import assert from "node:assert/strict";
import test from "node:test";
import { handleTeamIrSimulationRoutes } from "../api/team-ir-simulation-routes.mjs";

function responseHarness() {
  return { statusCode: 0, payload: null, writeHead(status) { this.statusCode = status; }, end(body) { this.payload = JSON.parse(body); } };
}

test("Team IR v2 Simulation endpoints use their dedicated use case contract", async () => {
  const calls = [];
  const useCases = {
    async createSimulation(teamVersionId, input) { calls.push(["create", teamVersionId, input]); return { simulationId: "sim-1" }; },
    async recoverInterruptedSimulations(teamVersionId) { calls.push(["recover", teamVersionId]); return { recoveredCount: 0 }; },
    async listSimulations(teamVersionId) { calls.push(["list", teamVersionId]); return { simulations: [] }; },
    async getSimulation(teamVersionId, simulationId) { calls.push(["get", teamVersionId, simulationId]); return { simulationId }; }
  };
  for (const [method, path, body, expected] of [
    ["POST", "/api/v1/team-versions/team-v1/ir/simulations", { input: { request: "task" } }, ["create", "team-v1", { input: { request: "task" } }]],
    ["POST", "/api/v1/team-versions/team-v1/ir/simulations/recover", undefined, ["recover", "team-v1"]],
    ["GET", "/api/v1/team-versions/team-v1/ir/simulations", undefined, ["list", "team-v1"]],
    ["GET", "/api/v1/team-versions/team-v1/ir/simulations/sim-1", undefined, ["get", "team-v1", "sim-1"]]
  ]) {
    const response = responseHarness();
    const handled = await handleTeamIrSimulationRoutes({
      request: { method }, response, url: new URL(`http://localhost${path}`),
      readBody: async () => body, sendJson: (res, status, payload) => { res.writeHead(status); res.end(JSON.stringify(payload)); },
      errorStatus: () => 500, useCases
    });
    assert.equal(handled, true);
    assert.deepEqual(calls.at(-1), expected);
    assert.equal(response.statusCode, 200);
  }
  assert.equal(await handleTeamIrSimulationRoutes({ request: { method: "DELETE" }, url: new URL("http://localhost/api/v1/team-versions/team-v1/ir/simulations"), useCases }), false);
});
