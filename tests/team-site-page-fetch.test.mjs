import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = {
  fetch: async () => new Response("history file", {
    status: 200,
    headers: { "content-type": "text/plain" }
  })
};

const [{ beginPageRequest }, { pageFetch }] = await Promise.all([
  import("../apps/team-site/public/app/state.js"),
  import("../apps/team-site/public/app/api.js")
]);

test("pageFetch preserves Response body method receivers for text responses", async () => {
  beginPageRequest();
  const response = await pageFetch("/history.txt");
  assert.equal(await response.text(), "history file");
});
