import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTeamArtifactStore } from "../../../dist/team-ir/index.js";
import {
  authorizeTeamIrReviewer,
  classifyDockerAdapterFailure,
  getOpenCodeDisabledToolsForTest,
  getDockerRunArgsForTest,
  getDockerEgressProxySourceForTest,
  makePrompt,
  outputJsonSchema,
  resolveBindings,
  resolveTeamIrReleaseClosure,
  validateModelOutput
} from "../infrastructure/team-ir-v2-opencode-docker-resolver.mjs";

const fixture = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-artifact-evidence.json", import.meta.url), "utf8"));

test("trusted closure verifies checked-in role package digests and pins the model adapter", async () => {
  const closure = await resolveTeamIrReleaseClosure({ teamIR: fixture });
  assert.equal(closure.complete, true);
  assert.equal(closure.adapterVersions.model, "ogs-opencode-docker-adapter/20");
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
  assert.match(prompt.system, /Do not use Markdown fences or add a preface/);
  assert.match(prompt.system, /Escape quotes, backslashes, and line breaks inside JSON string values/);
  assert.match(prompt.system, /ALWAYS return exactly one object with all three top-level fields event, data, and artifactTexts/);
  assert.match(prompt.system, /MUST contain a substantive body for every requiredArtifactSlot/);
  assert.match(prompt.system, /"requiredArtifactSlots":\["report"\]/);
  const cleaned = makePrompt({
    role: {
      agent: "You coordinate an evidence review.\n- Emit exactly one valid event.\n{{agent}}",
      prompt: "Compare the two reports. Return valid JSON with event REVIEW_READY and content as the result."
    },
    input: { task: "Compare reports" },
    invocation: { handoffId: "compare" },
    agent: { id: "reviewer", outputPorts: { REVIEW_READY: { dataSchema: { type: "object" } } } }
  });
  assert.match(cleaned.system, /You coordinate an evidence review/);
  assert.match(cleaned.system, /Compare the two reports\./);
  assert.doesNotMatch(cleaned.system, /\{\{agent\}\}|Emit exactly one valid event|Return valid JSON with event/);
});

test("Team IR model schema always sends the complete envelope even when an Agent has no Artifact slots", async () => {
  const maker = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-maker-checker.json", import.meta.url), "utf8"));
  const agent = maker.agents[0];
  const schema = outputJsonSchema(agent);
  assert.deepEqual(schema.required, ["event", "data", "artifactTexts"]);
  assert.deepEqual(schema.properties.event.enum, ["DONE"]);
  assert.deepEqual(schema.properties.data, agent.outputPorts.DONE.dataSchema);
  assert.deepEqual(schema.properties.artifactTexts, { type: "object", properties: {}, required: [], additionalProperties: false });
});

test("structured output schema binds each event to its Team IR data and required text Artifacts", () => {
  const schema = outputJsonSchema({ id: "writer", outputPorts: {
    READY: {
      dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
      artifactSlots: { report: { required: true, mediaTypes: ["text/markdown"] }, notes: { required: false, mediaTypes: ["text/plain"] } }
    },
    SKIPPED: { dataSchema: { type: "object" }, artifactSlots: {} }
  } });
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.properties.event.enum, ["READY", "SKIPPED"]);
  assert.equal(schema.properties.data.anyOf.length, 2);
  assert.deepEqual(schema.properties.data.anyOf[0], { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false });
  assert.deepEqual(schema.properties.artifactTexts.required, []);
  assert.deepEqual(Object.keys(schema.properties.artifactTexts.properties).sort(), ["notes", "report"]);
});

test("resolver rejects required non-text model Artifacts and omits optional non-text slots from the model contract", async () => {
  const agent = { id: "writer", outputPorts: { DONE: { dataSchema: { type: "object" }, artifactSlots: {
    report: { required: true, mediaTypes: ["text/markdown"] },
    image: { required: false, mediaTypes: ["image/png"] }
  } } } };
  const schema = outputJsonSchema(agent);
  assert.deepEqual(Object.keys(schema.properties.artifactTexts.properties), ["report"]);
  const invalid = structuredClone(agent);
  invalid.outputPorts.DONE.artifactSlots.image.required = true;
  await assert.rejects(Promise.resolve().then(() => outputJsonSchema(invalid)), /TEAM_IR_MODEL_REQUIRED_ARTIFACT_NOT_TEXT:writer:DONE:image/);
});

test("Docker adapter failures classify unsupported and incomplete structured output as invalid output", () => {
  assert.deepEqual(classifyDockerAdapterFailure("response_parts_step-start_tool_step-finish"), {
    failureClass: "invalid_output", diagnosticCode: "OUTPUT_PARTS_UNSUPPORTED"
  });
  assert.deepEqual(classifyDockerAdapterFailure("response_text_invalid"), {
    failureClass: "invalid_output", diagnosticCode: "OUTPUT_TEXT_MISSING"
  });
  assert.deepEqual(classifyDockerAdapterFailure("response_parts_unexpected_tool"), {
    failureClass: "invalid_output", diagnosticCode: "OUTPUT_PARTS_UNEXPECTED_TOOL"
  });
  assert.deepEqual(classifyDockerAdapterFailure("provider_http_503"), { failureClass: "server_error" });
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
    ["", "OUTPUT_JSON_EMPTY"],
    ["```json\n{}\n```", "OUTPUT_JSON_MARKDOWN_FENCE"],
    ["not-json including secret-marker", "OUTPUT_JSON_NON_OBJECT_TEXT"],
    ["{broken", "OUTPUT_JSON_SYNTAX"],
    [JSON.stringify([]), "OUTPUT_ENVELOPE_INVALID", "/"],
    [JSON.stringify({ data: {} }), "OUTPUT_ENVELOPE_EVENT_MISSING", "/event"],
    [JSON.stringify({ event: 12, data: {} }), "OUTPUT_ENVELOPE_EVENT_TYPE_INVALID", "/event"],
    [JSON.stringify({ event: "DONE" }), "OUTPUT_ENVELOPE_INVALID", "/data"],
    [JSON.stringify({ event: "DONE", data: { answer: "ok" }, secretMarker: "do-not-persist" }), "OUTPUT_FIELD_UNDECLARED"],
    [JSON.stringify({ event: "DONE", data: { answer: 12 }, artifactTexts: { report: "report" } }), "OUTPUT_DATA_TYPE_INVALID", "/data/answer"],
    [JSON.stringify({ event: "DONE", data: { answer: "ok" }, artifactTexts: "not-a-map" }), "OUTPUT_ARTIFACT_MAP_INVALID"],
    [JSON.stringify({ event: "DONE", data: { answer: "ok" }, artifactTexts: { undeclared: "report" } }), "OUTPUT_ARTIFACT_SLOT_INVALID"],
    [JSON.stringify({ event: "DONE", data: { answer: "ok" } }), "OUTPUT_ARTIFACT_REQUIRED"]
  ];
  for (const [response, diagnosticCode, diagnosticPointer] of cases) {
    assert.throws(() => validateModelOutput(response, agent), (error) => {
      assert.equal(error.failureClass, "invalid_output");
      assert.equal(error.diagnosticCode, diagnosticCode);
      assert.equal(error.diagnosticPointer, diagnosticPointer);
      assert.equal(JSON.stringify(error).includes("secret-marker"), false);
      return true;
    });
  }
  assert.equal(validateModelOutput(JSON.stringify({
    event: "DONE", data: { answer: "ok" }, artifactTexts: { report: "# Report" }
  }), agent).kind, "completed");
});

test("model data diagnostics identify safe Schema failure classes without exposing values", () => {
  const agent = { outputPorts: { DONE: { dataSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false
  } } } };
  const cases = [
    [{ answer: 12 }, "OUTPUT_DATA_TYPE_INVALID", "/data/answer"],
    [{}, "OUTPUT_DATA_REQUIRED", "/data/answer"],
    [{ answer: "ok", secretMarker: "hidden" }, "OUTPUT_DATA_FIELD_UNDECLARED", "/data"]
  ];
  for (const [data, diagnosticCode, diagnosticPointer] of cases) {
    assert.throws(() => validateModelOutput(JSON.stringify({ event: "DONE", data }), agent), (error) => {
      assert.equal(error.diagnosticCode, diagnosticCode);
      assert.equal(error.diagnosticPointer, diagnosticPointer);
      assert.equal(JSON.stringify(error).includes("hidden"), false);
      return true;
    });
  }
});

test("trusted closure refuses unpinned role packages and model providers", async () => {
  const unpinnedRole = structuredClone(fixture);
  unpinnedRole.agents[0].packageRef = "role:untrusted@1";
  await assert.rejects(resolveTeamIrReleaseClosure({ teamIR: unpinnedRole }), /TEAM_IR_PACKAGE_NOT_ALLOWLISTED/);

  const unpinnedModel = structuredClone(fixture);
  unpinnedModel.bindings[0].modelRef = "other-provider/model";
  await assert.rejects(resolveTeamIrReleaseClosure({ teamIR: unpinnedModel }), /TEAM_IR_BINDING_NOT_ALLOWLISTED/);

  const unsupportedArtifact = structuredClone(fixture);
  const agent = unsupportedArtifact.agents[0];
  const outputPort = Object.values(agent.outputPorts)[0];
  outputPort.artifactSlots = { image: { required: true, mediaTypes: ["image/png"], cardinality: "single" } };
  await assert.rejects(resolveTeamIrReleaseClosure({ teamIR: unsupportedArtifact }), /TEAM_IR_MODEL_REQUIRED_ARTIFACT_NOT_TEXT/);
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

test("Docker Binding refuses an Artifact outside the invocation allowlist before starting the container", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "team-ir-docker-artifact-scope-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const passwordFile = join(directory, "serve.env");
  await writeFile(passwordFile, "OPENCODE_API_KEY=local-test-password-value\n", { mode: 0o600 });
  await chmod(passwordFile, 0o600);
  const previousPasswordFile = process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
  const previousDockerBin = process.env.OGS_TEAM_IR_V2_DOCKER_BIN;
  process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = passwordFile;
  process.env.OGS_TEAM_IR_V2_DOCKER_BIN = join(directory, "docker-must-not-start");
  try {
    const artifacts = new FileTeamArtifactStore(join(directory, "artifacts"));
    const allowed = await artifacts.registerRunInput({
      team: fixture, projectId: "allowed-project", slotId: "brief", mediaType: "text/markdown",
      content: Buffer.from("authorized input"), authorizeUpload: () => true
    });
    const outside = await artifacts.registerRunInput({
      team: fixture, projectId: "other-project", slotId: "brief", mediaType: "text/markdown",
      content: Buffer.from("other project input"), authorizeUpload: () => true
    });
    const owner = { projectId: "allowed-project", runId: "run-allowed" };
    const bound = await artifacts.bindRunInputAttachments({
      team: fixture, owner, attachments: { brief: allowed }
    });
    const artifactResolver = await artifacts.createInvocationResolver({ owner, allowedArtifacts: [bound.brief] });
    const bindings = await resolveBindings({ teamIR: fixture });

    await assert.rejects(bindings["binding:evidence-analyst"].invoke({
      idempotencyKey: "cross-project-artifact-denied",
      handoffId: "run-to-analyst",
      agentId: "evidence-analyst",
      bindingId: "binding:evidence-analyst",
      attempt: 1,
      input: { request: "Summarize authorized evidence.", artifacts: { brief: outside } },
      artifactResolver
    }), /Allowed Artifact Set/);
  } finally {
    if (previousPasswordFile === undefined) delete process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
    else process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = previousPasswordFile;
    if (previousDockerBin === undefined) delete process.env.OGS_TEAM_IR_V2_DOCKER_BIN;
    else process.env.OGS_TEAM_IR_V2_DOCKER_BIN = previousDockerBin;
  }
});

test("Docker Binding uses an internal-only network and applies fixed resource and privilege limits", () => {
  const args = getDockerRunArgsForTest();
  assert.equal(args[0], "run");
  assert.equal(args.includes("--network=TEAM_IR_EGRESS_NETWORK"), true);
  assert.equal(args.includes("--read-only"), true);
  assert.equal(args.includes("--cap-drop=ALL"), true);
  assert.equal(args.includes("--security-opt=no-new-privileges"), true);
  assert.equal(args.includes("--memory=512m"), true);
  assert.equal(args.includes("--cpus=1"), true);
  assert.equal(args.includes("--pids-limit=64"), true);
  assert.equal(args.some((arg) => arg === "-v" || arg === "--volume" || arg.startsWith("--volume=")), false);
  assert.equal(args.some((arg) => arg.includes("host-gateway")), false);
  const proxy = getDockerEgressProxySourceForTest();
  assert.match(proxy, /const UPSTREAM = "http:\/\/host\.docker\.internal:4096"/);
  assert.match(proxy, /const MODEL = \{ providerID: "codex-gateway", modelID: "gpt-6-luna" \}/);
  assert.match(proxy, /server\.on\("connect"/);
  assert.match(proxy, /request_not_allowed/);
  assert.match(proxy, /request_contract_invalid/);
  assert.match(proxy, /structuredOutputMode/);
  assert.match(proxy, /outputFormat/);
});

test("OpenCode prompt tool overrides explicitly disable every pinned built-in tool", () => {
  const tools = getOpenCodeDisabledToolsForTest();
  assert.deepEqual(Object.keys(tools), ["invalid", "question", "bash", "read", "glob", "grep", "edit", "write", "task", "webfetch", "todowrite", "websearch", "skill", "apply_patch"]);
  assert.ok(Object.keys(tools).length > 0);
  assert.ok(Object.values(tools).every((enabled) => enabled === false));
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
