import assert from "node:assert/strict";
import test from "node:test";
import { handleTeamIrSimulationRoutes } from "../api/team-ir-simulation-routes.mjs";

function response() {
  return { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
}
function dependencies(useCases) {
  return {
    readBody: async () => ({ artifactScopeId: "sandbox-1", slotId: "brief", mediaType: "text/plain", contentBase64: "aGk=" }),
    sendJson: (res, status, payload) => { res.writeHead(status); res.end(JSON.stringify(payload)); },
    errorStatus: () => 400,
    useCases
  };
}

test("Studio Simulation exposes Team IR slots and restricts Artifact uploads to same-origin loopback", async () => {
  const calls = [];
  const useCases = {
    async listRunInputArtifactSlots(teamVersionId) { calls.push(["slots", teamVersionId]); return { slots: [{ slotId: "brief", required: true }] }; },
    async registerSimulationInputArtifact(teamVersionId, input) { calls.push(["upload", teamVersionId, input]); return { artifactId: `art_${"a".repeat(36)}` }; }
  };
  const slotsResponse = response();
  await handleTeamIrSimulationRoutes({
    ...dependencies(useCases), request: { method: "GET", socket: { remoteAddress: "127.0.0.1" } }, response: slotsResponse,
    url: new URL("http://127.0.0.1:4173/api/v1/team-versions/team-v1/ir/simulation-artifact-slots")
  });
  assert.equal(slotsResponse.status, 200);
  assert.deepEqual(calls[0], ["slots", "team-v1"]);

  const deniedResponse = response();
  await handleTeamIrSimulationRoutes({
    ...dependencies(useCases), request: { method: "POST", socket: { remoteAddress: "192.0.2.10" }, headers: { host: "studio.example", origin: "https://evil.example" } },
    response: deniedResponse, url: new URL("https://studio.example/api/v1/team-versions/team-v1/ir/simulation-artifacts/run-input")
  });
  assert.equal(deniedResponse.status, 403);
  assert.equal(calls.some(([kind]) => kind === "upload"), false);

  const acceptedResponse = response();
  await handleTeamIrSimulationRoutes({
    ...dependencies(useCases), request: { method: "POST", socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { host: "localhost:4173", origin: "http://localhost:4173" } },
    response: acceptedResponse, url: new URL("http://localhost:4173/api/v1/team-versions/team-v1/ir/simulation-artifacts/run-input")
  });
  assert.equal(acceptedResponse.status, 201);
  assert.equal(calls.at(-1)[0], "upload");
});
