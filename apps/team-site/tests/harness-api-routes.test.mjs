import assert from "node:assert/strict";
import test from "node:test";
import { handlePlatformRoutes } from "../api/platform-routes.mjs";

function request(method, pathname, body) {
  return { method, url: pathname };
}

async function dispatch(requestValue, useCases) {
  let result;
  await handlePlatformRoutes({
    request: requestValue,
    response: {},
    url: new URL(requestValue.url, "http://localhost"),
    readBody: async () => requestValue.body || {},
    sendJson: (_response, status, payload) => { result = { status, payload }; },
    useCases,
    harnessUseCases: useCases
  });
  return result;
}

test("Harness repository API exposes V2 list/save/verify/binding routes", async () => {
  const template = {
    templateId: "harness.api",
    status: "draft",
    backend: "codex",
    model: "gpt-6-luna",
    allowedTools: [],
    environment: { filesystem: "none", process: "deny", network: "deny" }
  };
  const calls = [];
  const useCases = {
    listTemplates: async () => [template],
    saveTemplate: async (input) => { calls.push(["save", input]); return template; },
    getTemplate: async () => template,
    verifyTemplate: async () => ({ ...template, status: "verified" }),
    copyTemplate: async (_id, input) => ({ ...template, ...input, status: "verified" }),
    archiveTemplate: async () => ({ ...template, status: "archived" }),
    bindingSnapshot: async () => ({ template: { ...template, status: undefined }, revision: 1, digest: "digest", verifiedTools: [] }),
    listBackends: async () => [],
    discoverBackend: async () => ({ source: { backend: "codex", status: "runnable" }, models: [] })
  };

  assert.deepEqual((await dispatch(request("GET", "/api/v2/harness/templates"), useCases)).payload.templates, [template]);
  assert.equal((await dispatch({ ...request("POST", "/api/v2/harness/templates"), body: { template } }, useCases)).status, 201);
  assert.equal(calls[0][0], "save");
  assert.equal((await dispatch(request("POST", "/api/v2/harness/templates/harness.api/verify"), useCases)).payload.template.status, "verified");
  assert.equal((await dispatch({ ...request("POST", "/api/v2/harness/templates/harness.api/copy"), body: { templateId: "harness.api.copy" } }, useCases)).status, 201);
  assert.equal((await dispatch(request("GET", "/api/v2/harness/templates/harness.api/binding"), useCases)).payload.digest, "digest");
});
