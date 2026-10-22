import assert from "node:assert/strict";
import test from "node:test";
import { handlePlatformRoutes } from "../api/platform-routes.mjs";
import { createPlatformUseCases } from "../application/platform-use-cases.mjs";

function harness(overrides = {}) {
  const sent = [];
  const response = {};
  const dependencies = {
    request: { method: "GET" },
    response,
    url: new URL("http://site.test/"),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    useCases: {
    getPlatformDiscovery: async () => ({
      sources: [{ backend: "codex", name: "Codex", status: "ready", command: "codex", detail: "local" }],
      models: [{ id: "model-1" }]
    }),
    listPlatformProviders: async () => ({ providers: [{ id: "codex", name: "Codex", status: "ready", command: "codex", detail: "local" }] }),
    listPlatformModels: async () => ({ models: [{ id: "model-1" }] }),
    readPlatformSettings: async () => ({ defaultProvider: "codex" }),
    updatePlatformSettings: async (payload) => payload,
    },
    ...overrides
  };
  return { sent, dependencies };
}

function invoke(harness, method, path, body = {}) {
  return handlePlatformRoutes({
    ...harness.dependencies,
    request: { method },
    url: new URL(`http://site.test${path}`),
    readBody: async (request) => (harness.bodyRequest = request, body)
  });
}

test("discovery routes preserve forced refresh and response projections", async () => {
  const calls = [];
  const h = harness({
    useCases: {
    getPlatformDiscovery: async (force) => {
      calls.push(force);
      return {
        generatedAt: "now",
        sources: [{ backend: "codex", name: "Codex", status: "ready", command: "codex", detail: "local", secret: "hidden" }],
        models: [{ id: "model-1" }]
      };
    },
    listPlatformProviders: async () => ({ providers: [{ id: "codex", name: "Codex", status: "ready", command: "codex", detail: "local" }] }),
    listPlatformModels: async () => ({ models: [{ id: "model-1" }] })
    }
  });

  assert.equal(await invoke(h, "GET", "/api/v1/platform/discovery"), true);
  assert.equal(await invoke(h, "POST", "/api/v1/platform/discovery"), true);
  assert.deepEqual(calls, [false, true]);
  assert.deepEqual(h.sent[0], { status: 200, payload: {
    generatedAt: "now",
    sources: [{ backend: "codex", name: "Codex", status: "ready", command: "codex", detail: "local", secret: "hidden" }],
    models: [{ id: "model-1" }]
  } });

  assert.equal(await invoke(h, "GET", "/api/v1/platform/providers"), true);
  assert.deepEqual(h.sent[2], { status: 200, payload: {
    providers: [{ id: "codex", name: "Codex", status: "ready", command: "codex", detail: "local" }]
  } });
  assert.equal(await invoke(h, "GET", "/api/v1/platform/models"), true);
  assert.deepEqual(h.sent[3], { status: 200, payload: { models: [{ id: "model-1" }] } });
});

test("model probe route returns a model availability result", async () => {
  const h = harness({ useCases: {
    probeModelAvailability: async (modelRef) => ({ modelRef, status: "available", durationMs: 42 })
  } });
  assert.equal(await invoke(h, "POST", "/api/v1/platform/models/probe", { modelRef: "codex/gpt-6-luna" }), true);
  assert.deepEqual(h.sent[0], { status: 200, payload: { result: { modelRef: "codex/gpt-6-luna", status: "available", durationMs: 42 } } });
});

test("discovery failures keep route-specific 503 responses", async () => {
  const h = harness({ useCases: {
    getPlatformDiscovery: async () => { throw new Error("catalog unavailable"); },
    listPlatformProviders: async () => { throw new Error("catalog unavailable"); },
    listPlatformModels: async () => { throw new Error("catalog unavailable"); }
  } });
  assert.equal(await invoke(h, "GET", "/api/v1/platform/discovery"), true);
  assert.equal(await invoke(h, "GET", "/api/v1/platform/providers"), true);
  assert.equal(await invoke(h, "GET", "/api/v1/platform/models"), true);
  assert.deepEqual(h.sent.map(({ status, payload }) => [status, payload.error]), [
    [503, "catalog unavailable"],
    [503, "catalog unavailable"],
    [503, "catalog unavailable"]
  ]);
  const hUnknown = harness({ useCases: { listPlatformModels: async () => { throw "unknown"; } } });
  await invoke(hUnknown, "GET", "/api/v1/platform/models");
  assert.deepEqual(hUnknown.sent[0], { status: 503, payload: { error: "Unable to discover platform models." } });
});

test("platform settings read and update preserve defaults, validation, and response shape", async () => {
  const writes = [];
  const app = createPlatformUseCases({
    platformSettingsStore: { read: async () => ({ defaultProvider: "opencode", runtimeApplied: false }), write: async (settings) => writes.push(settings) },
    modelCatalog: { discover: async () => ({ sources: [], models: [] }) }
  });
  const h = harness({ useCases: {
    readPlatformSettings: app.readPlatformSettings,
    updatePlatformSettings: app.updatePlatformSettings
  } });
  assert.equal(await invoke(h, "GET", "/api/v1/platform/settings"), true);
  assert.deepEqual(h.sent[0], { status: 200, payload: { settings: { defaultProvider: "opencode", runtimeApplied: false } } });

  const request = { method: "PUT" };
  const validBody = { defaultProvider: " opencode ", defaultModel: " model-x ", timeoutSeconds: "60", retryCount: "2" };
  assert.equal(await handlePlatformRoutes({
    ...h.dependencies,
    request,
    url: new URL("http://site.test/api/v1/platform/settings"),
    readBody: async (actualRequest) => (h.bodyRequest = actualRequest, validBody)
  }), true);
  assert.equal(h.bodyRequest, request);
  assert.equal(writes.length, 1);
  assert.deepEqual({ ...writes[0], updatedAt: undefined }, {
    defaultProvider: "opencode", defaultModel: "model-x", timeoutSeconds: 60, retryCount: 2,
    updatedAt: undefined, runtimeApplied: false
  });
  assert.match(writes[0].updatedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(h.sent[1], { status: 200, payload: { settings: writes[0] } });

  for (const body of [
    { timeoutSeconds: 9, retryCount: 0 },
    { timeoutSeconds: 3601, retryCount: 0 },
    { timeoutSeconds: 10, retryCount: 1.5 },
    { timeoutSeconds: 10, retryCount: 6 }
  ]) {
    const before = writes.length;
    assert.equal(await invoke(h, "PUT", "/api/v1/platform/settings", body), true);
    assert.equal(h.sent.at(-1).status, 400);
    assert.equal(writes.length, before);
  }
});

test("settings write failures return 400 and unrelated methods remain unmatched", async () => {
  const h = harness({ useCases: { updatePlatformSettings: async () => { throw new Error("disk full"); } } });
  assert.equal(await invoke(h, "PUT", "/api/v1/platform/settings", { timeoutSeconds: 120, retryCount: 1 }), true);
  assert.deepEqual(h.sent[0], { status: 400, payload: { error: "disk full" } });
  assert.equal(await invoke(h, "DELETE", "/api/v1/platform/settings"), false);
  assert.equal(await invoke(h, "GET", "/api/v1/platform/unknown"), false);
});
