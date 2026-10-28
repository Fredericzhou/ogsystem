import assert from "node:assert/strict";
import test from "node:test";
import { handleTeamIrArtifactRoutes } from "../api/team-ir-artifact-routes.mjs";

function response() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = JSON.parse(body); } };
}

test("Project Artifact slot discovery is read-only and upload is restricted to a same-origin loopback operator", async () => {
  const calls = [];
  const useCases = {
    async listProjectRunInputArtifactSlots(projectId, teamVersionId) { calls.push(["slots", projectId, teamVersionId]); return { slots: [{ slotId: "brief" }] }; },
    async registerProjectRunInputArtifact(...args) { calls.push(["register", ...args]); return { artifactId: `art_${"a".repeat(36)}`, mediaType: "text/plain" }; }
  };
  const readBody = async () => ({ teamVersionId: "team-v1", slotId: "brief" });
  const slotsResponse = response();
  assert.equal(await handleTeamIrArtifactRoutes({
    request: { method: "GET", socket: { remoteAddress: "127.0.0.1" } },
    response: slotsResponse,
    url: new URL("http://127.0.0.1:4173/api/v1/projects/project-1/artifacts/run-input-slots?teamVersionId=team-v1"),
    readBody, sendJson: (res, status, payload) => { res.writeHead(status, {}); res.end(JSON.stringify(payload)); }, errorStatus: () => 400, useCases
  }), true);
  assert.equal(slotsResponse.status, 200);
  assert.deepEqual(calls[0], ["slots", "project-1", "team-v1"]);

  const denied = response();
  await handleTeamIrArtifactRoutes({
    request: { method: "POST", socket: { remoteAddress: "192.0.2.4" }, headers: { host: "site.example", origin: "https://attacker.example" } },
    response: denied, url: new URL("https://site.example/api/v1/projects/project-1/artifacts/run-input"),
    readBody, sendJson: (res, status, payload) => { res.writeHead(status, {}); res.end(JSON.stringify(payload)); }, errorStatus: () => 400, useCases
  });
  assert.equal(denied.status, 403);
  assert.equal(calls.some(([kind]) => kind === "register"), false);

  const accepted = response();
  await handleTeamIrArtifactRoutes({
    request: { method: "POST", socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { host: "localhost:4173", origin: "http://localhost:4173" } },
    response: accepted, url: new URL("http://localhost:4173/api/v1/projects/project-1/artifacts/run-input"),
    readBody, sendJson: (res, status, payload) => { res.writeHead(status, {}); res.end(JSON.stringify(payload)); }, errorStatus: () => 400, useCases
  });
  assert.equal(accepted.status, 201);
  assert.equal(calls.at(-1)[0], "register");
  assert.deepEqual(calls.at(-1)[3], { id: "local-operator", issuer: "team-site-loopback" });
});
