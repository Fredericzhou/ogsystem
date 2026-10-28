import assert from "node:assert/strict";
import test from "node:test";
import { handleCaseRoutes } from "../api/case-routes.mjs";

async function invoke(method, pathname, body, overrides = {}) {
  const sent = [];
  const calls = [];
  const handled = await handleCaseRoutes({
    request: { method },
    response: {},
    url: new URL(pathname, "http://localhost"),
    readBody: async () => body ?? {},
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: () => 409,
    publicProject: (project) => ({ projectId: project.projectId }),
    cases: [{ id: "classic", title: "Classic", roles: [{ id: "lead", label: "Lead" }], detail: { roles: { lead: "Coordinates" } }, flows: [["lead", "worker", "start"]], joins: [{ roleId: "worker" }] }],
    teamIrFixtures: { classic: { schemaVersion: 2, team: { id: "classic" } } },
    createClassicTeamProject: async (input) => { calls.push(["create", input]); return { projectId: "project-1" }; },
    ...overrides
  });
  return { handled, sent, calls };
}

test("case catalog returns presentation metadata and graph reads the native v2 fixture", async () => {
  const catalog = await invoke("GET", "/api/v1/cases");
  assert.equal(catalog.handled, true);
  assert.deepEqual(catalog.sent[0].payload.cases[0].roles, [{ id: "lead", label: "Lead", description: "Coordinates" }]);
  assert.equal("flows" in catalog.sent[0].payload.cases[0], false);
  assert.equal("joins" in catalog.sent[0].payload.cases[0], false);

  const graph = await invoke("GET", "/api/v1/cases/classic/ir");
  assert.deepEqual(graph.sent[0].payload, { teamIR: { schemaVersion: 2, team: { id: "classic" } } });
});

test("classic team actions use v2 provisioning and reject the old demo-run endpoint", async () => {
  const created = await invoke("POST", "/api/v1/cases/classic/template", { name: "Template", overview: "Overview", locale: "en-US" });
  assert.deepEqual(created.calls[0], ["create", { caseId: "classic", asTemplate: true, name: "Template", overview: "Overview", locale: "en-US" }]);
  assert.equal(created.sent[0].status, 201);

  const legacyRun = await invoke("POST", "/api/v1/demo-runs", { caseId: "classic", prompt: "Review" });
  assert.equal(legacyRun.handled, false);
});

test("case routes report domain errors and leave unrelated paths unmatched", async () => {
  const failed = await invoke("POST", "/api/v1/cases/classic/use", {}, { createClassicTeamProject: async () => { throw new Error("not ready"); } });
  assert.equal(failed.sent[0].status, 409);
  assert.deepEqual(failed.sent[0].payload, { error: "not ready" });
  assert.equal((await invoke("GET", "/api/v1/other")).handled, false);
});
