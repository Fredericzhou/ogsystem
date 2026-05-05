import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildNl2MmdSystemPrompt,
  buildNl2MmdTurnPrompt,
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
  assert.ok(context.modelCatalog.some((item) => item.modelRef === "opencode/gpt-5-nano"));
  assert.deepStrictEqual(context.supportedDictionary.roleModes, ["parallel_split"]);
  assert.deepStrictEqual(context.supportedDictionary.joinModes, ["all_of", "quorum_of"]);
  assert.ok(context.supportedDictionary.exactMetadataKeys.includes("handoff.mode"));
  assert.ok(context.supportedDictionary.exactMetadataKeys.includes("handoff.contracts"));
  assert.ok(context.supportedDictionary.metadataPrefixes.includes("route.order."));
  assert.ok(context.supportedDictionary.metadataPrefixes.includes("review.mode."));
  assert.ok(context.supportedDictionary.metadataPrefixes.includes("review.timeout."));
  assert.ok(context.supportedDictionary.metadataPrefixes.includes("review.timeout.action."));
  assert.ok(context.supportedDictionary.metadataPrefixes.includes("review.rework.target."));
  assert.ok(context.supportedDictionary.metadataPrefixes.includes("review.rework.max."));
  assert.ok(context.supportedDictionary.metadataPrefixes.includes("review.terminate.scope."));
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
    /debate-judge \[model=opencode\/gpt-5-nano, join=all_of, sources=debate-minimalist,debate-alignmentist\]/
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
    /Metadata prefixes allowed: talent\.bind\., exec\.bind\., model\.bind\., role\.mode\., join\.mode\., join\.min\., join\.sources\., context\.map\., loop\.max\., route\.order\., review\.mode\., review\.timeout\., review\.timeout\.action\., review\.rework\.target\., review\.rework\.max\., review\.terminate\.scope\./
  );
  assert.match(
    prompt,
    /Exact metadata keys allowed: engine, system\.id, system\.version, law\.global, entry\.role, handoff\.mode, handoff\.contracts/
  );
  assert.match(
    prompt,
    /Flow-contract metadata are also supported: handoff\.mode, handoff\.contracts, and route\.order\.<fromRoleId>/
  );
  assert.match(prompt, /Runtime-native human review uses review\.\* metadata/);
  assert.match(prompt, /do not add a synthetic reviewer role solely to represent the human decision/);
  assert.match(prompt, /context\.map\.<roleId>\.review_comment=global\.human_review\.current\.comment\?/);
  assert.match(prompt, /Runtime failure compensation uses role-origin ERROR or ERROR\.<errorCode> edges/);
  assert.match(prompt, /quorum_of joins must include join\.min\.<roleId>/);
  assert.match(prompt, /Use role JSON Schema output packages for structured role output/);
  assert.match(prompt, /Chinese requests should receive concise Chinese operator-facing text/);
  assert.ok(prompt.length < 5000, `expected compact prompt, got length ${prompt.length}`);
  assert.ok(!prompt.includes("Role catalog:"));
  assert.ok(!prompt.includes("Model catalog:"));
});

test("nl2mmd turn prompt stays compact and keeps ranked hints", async () => {
  const context = await loadNl2MmdContext({
    workdir: repoRoot
  });

  const prompt = buildNl2MmdTurnPrompt({
    context,
    input: {
      message: "请用 @debate-judge 汇总，并检查未知的 @not-found-role 是否存在",
      draftMermaid: "flowchart TD\ninput --> draft[Role:debate-judge]",
      validationErrors: ["missing entry.role"],
      validationWarnings: ["using inferred model binding"]
    }
  });

  assert.ok(prompt.length < 1500, `expected compact turn prompt, got length ${prompt.length}`);
  assert.match(prompt, /^User: 请用 @debate-judge 汇总，并检查未知的 @not-found-role 是否存在$/m);
  assert.match(prompt, /^Mentions: @debate-judge:resolved, @not-found-role:missing$/m);
  assert.match(prompt, /^Roles: /m);
  assert.match(prompt, /^Models: /m);
  assert.match(prompt, /^Hints: /m);
  assert.match(prompt, /^Draft: flowchart TD$/m);
  assert.match(prompt, /^Errors: missing entry\.role$/m);
  assert.match(prompt, /^Warnings: using inferred model binding$/m);
});

test("nl2mmd semantic mapping detects common routing and loop intents", () => {
  const hints = detectSemanticHints("请并行分发给多个专家，至少两名形成共识后汇总，如果有争议则再次循环重试，并增加人工审核和错误补偿，把审核意见注入返工");
  const labels = hints.map((item) => item.label);

  assert.ok(labels.includes("parallel_split"));
  assert.ok(labels.includes("all_of"));
  assert.ok(labels.includes("quorum_of"));
  assert.ok(labels.includes("loop.max"));
  assert.ok(labels.includes("review.*"));
  assert.ok(labels.includes("ERROR*"));
  assert.ok(labels.includes("context.map"));
});

test("nl2mmd search helpers suggest likely roles and models from free text", async () => {
  const context = await loadNl2MmdContext({
    workdir: repoRoot
  });

  const roleMatches = searchRoles(context, "judge summary");
  const modelMatches = searchModels(context, "gpt 5 nano");

  assert.ok(roleMatches.slice(0, 3).some((item) => item.item.roleId === "debate-judge"));
  assert.strictEqual(modelMatches[0].item.modelRef, "opencode/gpt-5-nano");
});
