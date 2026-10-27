import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  convertMarkdownRole,
  parseMarkdownRole,
  slugifyTeamRoleName
} from "../tools/agent-source/markdown-role-adapter.mjs";

const COMMIT = "b37b5bb33b78f2c1d6567d98e25ca818e3259219";
const HEADER = [
  "---",
  "name: Frontend Developer",
  "description: Build thoughtful interfaces",
  "color: \"#0077B6\"",
  "emoji: \"🧑🏽‍💻\"",
  "vibe: Product minded and precise",
  "language: en",
  "---",
  ""
].join("\n");
const BODY = "# Frontend Developer\n\nPreserve this body exactly.\n\n```yaml\nname: do not parse this\n```\n";

function convert(extra = {}) {
  return convertMarkdownRole({
    sourceText: HEADER + BODY,
    sourceId: "agency-agents",
    gitUrl: "https://github.com/msitarzewski/agency-agents.git",
    commit: COMMIT,
    sourcePath: "engineering/engineering-frontend-developer.md",
    adapterId: "agency-agents-markdown",
    adapterVersion: "1",
    importedAt: "2026-10-27T00:00:00.000Z",
    ...extra
  });
}

test("Agency Markdown parser separates front matter and preserves the body byte for byte", () => {
  const parsed = parseMarkdownRole(HEADER + BODY, { category: "engineering" });

  assert.equal(parsed.name, "Frontend Developer");
  assert.equal(parsed.description, "Build thoughtful interfaces");
  assert.equal(parsed.category, "engineering");
  assert.equal(parsed.language, "en");
  assert.equal(parsed.body, BODY);
  assert.deepEqual(parsed.metadata, {
    color: "#0077B6",
    emoji: "🧑🏽‍💻",
    vibe: "Product minded and precise"
  });
  assert.equal(parsed.sourceDigest, createHash("sha256").update(HEADER + BODY).digest("hex"));
});

test("conversion creates a traceable, unverified package with safe display metadata", () => {
  const result = convert({ category: "engineering" });

  assert.equal(result.roleId, "frontend-developer");
  assert.equal(result.files["agent.md"], BODY);
  assert.equal(result.files["prompt.md"].includes("{{task}}"), true);
  assert.equal(result.role.outputs.events.length, 0);
  assert.equal(result.role.constraints.allowedTools.length, 0);
  assert.equal(result.verification.status, "unverified");
  assert.deepEqual(result.verification.missingConfirmations, ["roleIdentity", "outputEvents", "allowedTools"]);
  assert.deepEqual(result.display.icon, { kind: "text", value: "🧑🏽‍💻" });
  assert.equal(result.display.color, "#0077B6");
  assert.equal(JSON.parse(result.files["source.json"]).commit, COMMIT);
  assert.equal(JSON.parse(result.files["source.json"]).path, "engineering/engineering-frontend-developer.md");
  assert.equal(JSON.parse(result.files["role.json"]).outputs.events.length, 0);
});

test("explicit confirmations are kept separate from source prose", () => {
  const result = convert({
    identityConfirmed: true,
    outputEvents: ["DONE", "BLOCKED"],
    allowedTools: ["team.search"]
  });

  assert.equal(result.verification.status, "ready-for-validation");
  assert.deepEqual(result.verification.missingConfirmations, []);
  assert.deepEqual(result.role.outputs.events, ["BLOCKED", "DONE"]);
  assert.deepEqual(result.role.constraints.allowedTools, ["team.search"]);
  assert.deepEqual(JSON.parse(result.files["output.schema.json"]).properties.event.enum, ["BLOCKED", "DONE"]);
});

test("safe YAML rejects missing front matter, malformed syntax, duplicate keys, and non-scalar metadata", () => {
  const expectCode = (sourceText, code) => assert.throws(
    () => parseMarkdownRole(sourceText),
    (error) => error.code === code
  );

  expectCode("# No front matter\n", "AGENT_FRONTMATTER_MISSING");
  expectCode("---\nname: [unterminated\n---\nBody", "AGENT_FRONTMATTER_INVALID");
  expectCode("---\nname: One\nname: Two\n---\nBody", "AGENT_FRONTMATTER_INVALID");
  expectCode("---\nname: One\nextra:\n  nested: value\n---\nBody", "AGENT_FRONTMATTER_FIELD_INVALID");
});

test("conversion validates source paths, IDs, and requires a full commit SHA", () => {
  assert.throws(() => convert({ sourcePath: "../outside.md" }), { code: "AGENT_SOURCE_PATH_INVALID" });
  assert.throws(() => convert({ roleId: "not valid" }), { code: "TEAM_ROLE_ID_INVALID" });
  assert.throws(() => convert({ commit: "b37b5bb" }), { code: "AGENT_SOURCE_INVALID" });
});

test("Team role slug generation handles accents and empty names safely", () => {
  assert.equal(slugifyTeamRoleName("Développeur Frontend"), "developpeur-frontend");
  assert.equal(slugifyTeamRoleName("工程师", "design/agent.md"), "agent");
  assert.match(slugifyTeamRoleName("工程师"), /^role-[a-f0-9]{10}$/);
});

test("pinned Agency Agents samples preserve reviewed metadata and body digests", async () => {
  const expected = JSON.parse(await readFile(new URL("./fixtures/agent-source/agency-agents.fixture.json", import.meta.url), "utf8"));
  assert.equal(expected.commit, COMMIT);

  for (const entry of expected.entries) {
    const sourceText = await readFile(new URL(`./fixtures/agent-source/agency-agents/${entry.path}`, import.meta.url), "utf8");
    const parsed = parseMarkdownRole(sourceText, { category: entry.category });
    const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
    const bodyDigest = createHash("sha256").update(parsed.body).digest("hex");

    assert.equal(parsed.name, entry.name, entry.path);
    assert.equal(parsed.description, entry.description, entry.path);
    assert.equal(parsed.category, entry.category, entry.path);
    assert.equal(parsed.metadata.color, entry.color, entry.path);
    assert.equal(parsed.metadata.emoji, entry.emoji, entry.path);
    assert.equal(parsed.metadata.vibe, entry.vibe, entry.path);
    assert.equal(parsed.language, entry.language, entry.path);
    assert.equal(sourceDigest, entry.sourceSha256, `${entry.path} raw source digest`);
    assert.equal(bodyDigest, entry.bodySha256, `${entry.path} post-front-matter body digest`);
  }
});
