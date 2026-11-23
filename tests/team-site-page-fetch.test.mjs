import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

const teamSiteApiExists = existsSync(new URL("../apps/team-site/public/app/api.js", import.meta.url));

if (!teamSiteApiExists) {
  test.skip("pageFetch preserves Response body method receivers for text responses (skipped: apps/team-site proprietary layer not present)", () => {});
} else {
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
}
