import assert from "node:assert/strict";
import test from "node:test";
import { handlePlatformRoutes } from "../api/platform-routes.mjs";

async function dispatch(url, useCases) {
  let result;
  await handlePlatformRoutes({
    request: { method: "GET", url },
    response: {},
    url: new URL(url, "http://localhost"),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => { result = { status, payload }; },
    useCases,
    harnessUseCases: useCases
  });
  return result;
}

test("platform discovery GET refresh forwards the force-refresh flag", async () => {
  const calls = [];
  const result = await dispatch("/api/v2/platform/discovery?refresh=1", {
    getPlatformDiscovery: async (forceRefresh) => {
      calls.push(forceRefresh);
      return { sources: [{ backend: "codex", status: "runnable" }], models: [] };
    }
  });
  assert.deepEqual(calls, [true]);
  assert.equal(result.status, 200);
  assert.equal(result.payload.sources[0].status, "runnable");
});
