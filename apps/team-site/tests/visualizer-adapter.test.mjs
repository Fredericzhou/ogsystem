import assert from "node:assert/strict";
import test from "node:test";
import { createVisualizerAdapter } from "../infrastructure/visualizer-adapter.mjs";

test("Visualizer adapter owns the upstream chat protocol and preserves structured errors", async () => {
  const calls = [];
  const adapter = createVisualizerAdapter({
    baseUrl: "http://127.0.0.1:4177/",
    username: "user",
    password: "pass",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response("upstream unavailable", { status: 503 });
    }
  });

  const result = await adapter.chat({ projectId: "team-123", payload: { message: "clarify" } });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: "upstream unavailable" });
  assert.equal(calls[0].url, "http://127.0.0.1:4177/api/v1/ogs/workspace/studio/chat?projectId=team-123");
  assert.equal(calls[0].options.headers.authorization, `Basic ${Buffer.from("user:pass").toString("base64")}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { message: "clarify" });
});
