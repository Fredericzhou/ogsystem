import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildNl2MmdSystemPrompt,
  detectSemanticHints,
  loadNl2MmdContext,
  renderTxtGraphFromMermaidSource,
  resolveRoleMentions,
  searchModels,
  searchRoles,
  validateNl2MmdCandidate
} from "../dist/nl2mmd/index.js";

const repoRoot = path.resolve(".");

test("nl2mmd context discovers supported dictionary, roles, and models", async () => {
  const context = await loadNl2MmdContext({
    workdir: repoRoot
  });

  assert.ok(context.roleCatalog.some((item) => item.roleId === "debate-judge"));
  assert.ok(context.modelCatalog.some((item) => item.modelId === "fast-gpt54"));
  assert.deepStrictEqual(context.supportedDictionary.roleModes, ["parallel_split"]);
  assert.deepStrictEqual(context.supportedDictionary.joinModes, ["all_of", "quorum_of"]);
  assert.ok(context.supportedDictionary.exactMetadataKeys.includes("handoff.mode"));
  assert.ok(context.supportedDictionary.exactMetadataKeys.includes("handoff.contracts"));
  assert.ok(context.supportedDictionary.metadataPrefixes.includes("route.order."));
});

test("nl2mmd resolves @role mentions against local role repo", async () => {
  const context = await loadNl2MmdContext({
    workdir: repoRoot
  });

  const mentions = resolveRoleMentions(
    "请用 @debate-judge 汇总，再把未知的 @not-found-role 标出来",
    context
  );

  assert.deepStrictEqual(mentions, [
    {
      mention: "@debate-judge",
      roleId: "debate-judge",
      exists: true
    },
    {
      mention: "@not-found-role",
      roleId: "not-found-role",
      exists: false
    }
  ]);
});

test("nl2mmd txt graph renderer prints plain structure preview", async () => {
  const mermaid = await readFile(
    path.resolve(repoRoot, "examples/langgraph-debate-current/system.mmd"),
    "utf8"
  );

  const txt = renderTxtGraphFromMermaidSource(mermaid);

  assert.match(txt, /^SYSTEM architecture\.debate\.current v1\.0\.0/m);
  assert.match(txt, /^ROLES$/m);
  assert.match(txt, /^\[input\]$/m);
  assert.match(txt, /--DEBATE_REQUEST--> debate-moderator/);
  assert.match(
    txt,
    /debate-judge \[model=general-steady, join=all_of, sources=debate-minimalist,debate-alignmentist\]/
  );
});

test("nl2mmd validator accepts the runnable debate example and returns txt preview", async () => {
  const context = await loadNl2MmdContext({
    workdir: repoRoot
  });
  const mermaid = await readFile(
    path.resolve(repoRoot, "examples/langgraph-debate-current/system.mmd"),
    "utf8"
  );

  const validation = await validateNl2MmdCandidate({
    mermaid,
    context,
    lawsPath: path.resolve(repoRoot, "examples/langgraph-debate-current/laws.json")
  });

  assert.strictEqual(validation.status, "ok");
  assert.deepStrictEqual(validation.errors, []);
  assert.ok(validation.txtGraph?.includes("CONNECTIONS"));
});

test("nl2mmd prompt includes current dictionary and local catalog hints", async () => {
  const context = await loadNl2MmdContext({
    workdir: repoRoot
  });

  const prompt = buildNl2MmdSystemPrompt(context);

  assert.match(
    prompt,
    /Metadata prefixes allowed: talent\.bind\., exec\.bind\., model\.bind\., role\.mode\., join\.mode\., join\.min\., join\.sources\., context\.map\., loop\.max\., route\.order\./
  );
  assert.match(
    prompt,
    /Exact metadata keys allowed: engine, system\.id, system\.version, law\.global, entry\.role, handoff\.mode, handoff\.contracts/
  );
  assert.match(
    prompt,
    /Flow-contract metadata are also supported: handoff\.mode, handoff\.contracts, and route\.order\.<fromRoleId>/
  );
  assert.ok(prompt.length < 3000, `expected compact prompt, got length ${prompt.length}`);
  assert.ok(!prompt.includes("Role catalog:"));
  assert.ok(!prompt.includes("Model catalog:"));
});

test("nl2mmd semantic mapping detects common routing and loop intents", () => {
  const hints = detectSemanticHints("请并行分发给多个专家，最后汇总，如果有争议则再次循环重试");
  const labels = hints.map((item) => item.label);

  assert.ok(labels.includes("parallel_split"));
  assert.ok(labels.includes("all_of"));
  assert.ok(labels.includes("loop.max"));
});

test("nl2mmd search helpers suggest likely roles and models from free text", async () => {
  const context = await loadNl2MmdContext({
    workdir: repoRoot
  });

  const roleMatches = searchRoles(context, "judge summary");
  const modelMatches = searchModels(context, "fast low-cost");

  assert.ok(roleMatches.slice(0, 3).some((item) => item.item.roleId === "debate-judge"));
  assert.strictEqual(modelMatches[0].item.modelId, "fast-gpt54");
});
