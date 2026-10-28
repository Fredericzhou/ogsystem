import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeTeamIrReviewer,
  getDockerRunArgsForTest,
  makePrompt,
  resolveBindings,
  resolveTeamIrReleaseClosure,
  validateModelOutput
} from "../infrastructure/team-ir-v2-opencode-docker-resolver.mjs";

const fixture = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-artifact-evidence.json", import.meta.url), "utf8"));

test("trusted closure verifies checked-in role package digests and pins the model adapter", async () => {
  const closure = await resolveTeamIrReleaseClosure({ teamIR: fixture });
  assert.equal(closure.complete, true);
  assert.equal(closure.packageDigests["role:advanced-worker-a@1"], "f1ab03e99bd7db6c19547b05fb0f81a4110c38c88a0211a6c17f9dd4f8f02c3a");
  assert.equal(closure.packageDigests["role:advanced-worker-b@1"], "bed3d1028ac4b1cef61876169d75fa5ed4fab3405c9710f048b6827976236c23");
  assert.equal(closure.adapterVersions.model, "ogs-opencode-docker-adapter/3");
  assert.match(closure.schemaDigests.reviewAuthorization, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(closure.bindingDigests).length, 2);
});

test("local Review authorization accepts only the operating-system principal", async () => {
  assert.equal(await authorizeTeamIrReviewer({ principal: { id: "local:fred", issuer: "ogs:local" } }), true);
  assert.equal(await authorizeTeamIrReviewer({ principal: { id: "reviewer:fred", issuer: "remote:oidc" } }), false);
  assert.equal(await authorizeTeamIrReviewer({ principal: { id: "local:fred", issuer: "remote:basic" } }), false);
});

test("model prompt makes the Team IR v2 envelope authoritative over legacy role formatting", () => {
  const prompt = makePrompt({
    role: { agent: "Return {decision, request}.", prompt: "Match output.schema.json." },
    input: { task: "Review" },
    invocation: { handoffId: "run-to-judge" },
    agent: { id: "judge", outputPorts: { JUDGMENT: { dataSchema: { type: "object" }, artifactSlots: { report: { required: true, mediaTypes: ["text/markdown"] } } } } }
  });
  assert.ok(prompt.system.indexOf("Authoritative Team IR v2 response contract") > prompt.system.indexOf("Return {decision, request}"));
  assert.match(prompt.system, /data payload, not this envelope/);
  assert.match(prompt.system, /artifactTexts when the selected event declares required Artifact slots/);
  assert.match(prompt.system, /MUST contain a substantive body for every requiredArtifactSlot/);
  assert.match(prompt.system, /"requiredArtifactSlots":\["report"\]/);
});

test("model output validation returns safe stable diagnostics without retaining response text", () => {
  const agent = {
    outputPorts: {
      DONE: {
        dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
        artifactSlots: { report: { required: true, mediaTypes: ["text/markdown"] } }
      }
    }
  };
  const cases = [
    ["not-json including secret-marker", "OUTPUT_JSON_INVALID"],
    [JSON.stringify({ event: 12, data: {} }), "OUTPUT_ENVELOPE_INVALID"],
    [JSON.stringify({ event: "DONE", data: { answer: "ok" }, secretMarker: "do-not-persist" }), "OUTPUT_FIELD_UNDECLARED"],
    [JSON.stringify({ event: "DONE", data: { answer: 12 }, artifactTexts: { report: "report" } }), "OUTPUT_DATA_SCHEMA_INVALID"],
    [JSON.stringify({ event: "DONE", data: { answer: "ok" }, artifactTexts: "not-a-map" }), "OUTPUT_ARTIFACT_MAP_INVALID"],
    [JSON.stringify({ event: "DONE", data: { answer: "ok" }, artifactTexts: { undeclared: "report" } }), "OUTPUT_ARTIFACT_SLOT_INVALID"],
    [JSON.stringify({ event: "DONE", data: { answer: "ok" } }), "OUTPUT_ARTIFACT_REQUIRED"]
  ];
  for (const [response, diagnosticCode] of cases) {
    assert.throws(() => validateModelOutput(response, agent), (error) => {
      assert.equal(error.failureClass, "invalid_output");
      assert.equal(error.diagnosticCode, diagnosticCode);
      assert.equal(JSON.stringify(error).includes("secret-marker"), false);
      return true;
    });
  }
  assert.equal(validateModelOutput(JSON.stringify({
    event: "DONE", data: { answer: "ok" }, artifactTexts: { report: "# Report" }
  }), agent).kind, "completed");
});

test("trusted closure refuses unpinned role packages and model providers", async () => {
  const unpinnedRole = structuredClone(fixture);
  unpinnedRole.agents[0].packageRef = "role:untrusted@1";
  await assert.rejects(resolveTeamIrReleaseClosure({ teamIR: unpinnedRole }), /TEAM_IR_PACKAGE_NOT_ALLOWLISTED/);

  const unpinnedModel = structuredClone(fixture);
  unpinnedModel.bindings[0].modelRef = "other-provider/model";
  await assert.rejects(resolveTeamIrReleaseClosure({ teamIR: unpinnedModel }), /TEAM_IR_BINDING_NOT_ALLOWLISTED/);
});

test("trusted resolver closure compiles every classic model fixture", async () => {
  const { compileTeamIr } = await import("../../../dist/team-ir/index.js");
  const { readdir } = await import("node:fs/promises");
  const fixturesDirectory = new URL("../../../examples/team-ir-v2/", import.meta.url);
  for (const name of await readdir(fixturesDirectory)) {
    if (!name.startsWith("classic-") || !name.endsWith(".json")) continue;
    const teamIR = JSON.parse(await readFile(new URL(name, fixturesDirectory), "utf8"));
    if (teamIR.bindings.some((binding) => binding.kind !== "model" || binding.modelRef !== "codex-gateway/gpt-6-luna")) continue;
    const closure = await resolveTeamIrReleaseClosure({ teamIR });
    assert.doesNotThrow(() => compileTeamIr(teamIR, closure), name);
  }
});

test("resolver strictly parses one owner-only OpenCode password assignment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "team-ir-opencode-secret-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "serve.env");
  await writeFile(file, "OPENCODE_API_KEY=local-test-password-value\n", { mode: 0o600 });
  await chmod(file, 0o600);
  const previous = process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
  process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = file;
  try {
    assert.equal(Object.keys(await resolveBindings({ teamIR: fixture })).length, 2);
    await writeFile(file, "OPENCODE_API_KEY=local-test-password-value\nOTHER=value\n");
    await chmod(file, 0o600);
    await assert.rejects(resolveBindings({ teamIR: fixture }), /TEAM_IR_OPENCODE_PASSWORD_FILE_FORMAT/);
  } finally {
    if (previous === undefined) delete process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
    else process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = previous;
  }
});

test("Docker Binding has no host/project mounts and applies fixed resource and privilege limits", () => {
  const args = getDockerRunArgsForTest();
  assert.equal(args[0], "run");
  assert.equal(args.includes("--network=bridge"), true);
  assert.equal(args.includes("--read-only"), true);
  assert.equal(args.includes("--cap-drop=ALL"), true);
  assert.equal(args.includes("--security-opt=no-new-privileges"), true);
  assert.equal(args.includes("--memory=512m"), true);
  assert.equal(args.includes("--cpus=1"), true);
  assert.equal(args.includes("--pids-limit=64"), true);
  assert.equal(args.some((arg) => arg === "-v" || arg === "--volume" || arg.startsWith("--volume=")), false);
  assert.equal(args.some((arg) => arg.includes("host-gateway")), true);
});

test("opt-in local Docker model Binding returns schema-valid output without logging model content", {
  skip: process.env.OGS_TEAM_IR_V2_DOCKER_BINDING_UAT !== "1"
}, async () => {
  const bindings = await resolveBindings({ teamIR: fixture });
  const result = await bindings["binding:evidence-analyst"].invoke({
    idempotencyKey: "resolver-contract-smoke",
    handoffId: "run-to-analyst",
    agentId: "evidence-analyst",
    bindingId: "binding:evidence-analyst",
    attempt: 1,
    input: { request: "Produce a brief note about verifying a release checklist." }
  });
  assert.equal(result.kind, "completed");
  assert.equal(result.output.event, "A_DONE");
  assert.equal(typeof result.output.data.analysis, "string");
  const draft = result.output.artifacts?.draft;
  assert.equal(draft?.mediaType, "text/markdown");
  assert.ok(draft?.content instanceof Uint8Array);
  process.stdout.write(JSON.stringify({
    event: result.output.event,
    schemaPass: true,
    artifacts: Object.entries(result.output.artifacts || {}).map(([slot, value]) => ({
      slot, mediaType: value.mediaType, byteLength: value.content.byteLength
    })),
    exitCode: 0
  }) + "\n");
});
