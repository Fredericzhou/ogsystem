import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getOpenCodeDisabledToolsForTest,
  resolveBindings,
  resolveTeamIrReleaseClosure
} from "../infrastructure/team-ir-v2-opencode-direct-resolver.mjs";

const fixture = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-software-team.json", import.meta.url), "utf8"));

test("direct-host resolver pins the model closure without Docker image dependencies", async () => {
  const closure = await resolveTeamIrReleaseClosure({ teamIR: fixture });
  assert.equal(closure.complete, true);
  assert.equal(closure.adapterVersions.model, "ogs-opencode-direct-adapter/14");
  assert.equal(Object.hasOwn(closure.schemaDigests, "opencodeImage"), false);
  assert.equal(Object.keys(closure.packageDigests).length, fixture.agents.length);
});

test("direct-host resolver creates a fresh tool-free OpenCode session per Binding invocation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "team-ir-opencode-direct-secret-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const passwordFile = join(directory, "serve.env");
  await writeFile(passwordFile, "OPENCODE_API_KEY=local-test-password-value\n", { mode: 0o600 });
  await chmod(passwordFile, 0o600);
  const previousPasswordFile = process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
  const previousFetch = globalThis.fetch;
  process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = passwordFile;

  const requests = [];
  let sessionNumber = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url: String(url), headers: options.headers, body });
    if (String(url) === "http://127.0.0.1:4096/session") {
      sessionNumber += 1;
      return new Response(JSON.stringify({ id: `direct-session-${sessionNumber}` }), { status: 200 });
    }
    return new Response(JSON.stringify({
      parts: [{ type: "text", text: JSON.stringify({ event: "PLAN", data: { plan: "Implement the requested change." } }) }]
    }), { status: 200 });
  };

  try {
    const closure = await resolveTeamIrReleaseClosure({ teamIR: fixture });
    const bindings = await resolveBindings({ teamIR: fixture, closure });
    const invocation = {
      handoffId: "run-to-planner",
      agentId: "planner",
      bindingId: "binding:planner",
      attempt: 1,
      input: { request: "Plan a small software change." }
    };
    for (const idempotencyKey of ["run-1-planner-1", "run-1-planner-2"]) {
      const result = await bindings["binding:planner"].invoke({ ...invocation, idempotencyKey });
      assert.equal(result.kind, "completed");
      assert.equal(result.output.event, "PLAN");
    }

    const sessionRequests = requests.filter((request) => request.url.endsWith("/session"));
    assert.equal(sessionRequests.length, 2);
    const messageRequests = requests.filter((request) => request.url.endsWith("/message"));
    assert.equal(messageRequests.length, 2);
    assert.deepEqual(messageRequests.map((request) => request.url), [
      "http://127.0.0.1:4096/session/direct-session-1/message",
      "http://127.0.0.1:4096/session/direct-session-2/message"
    ]);
    assert.equal(messageRequests[0].body.model.providerID, "codex-gateway");
    assert.equal(messageRequests[0].body.format.type, "json_schema");
    assert.equal(messageRequests[0].body.format.schema.type, "object");
    assert.deepEqual(messageRequests[0].body.format.schema.properties.event.enum, ["PLAN"]);
    assert.deepEqual(messageRequests[0].body.format.schema.properties.data, fixture.agents[0].outputPorts.PLAN.dataSchema);
    assert.ok(messageRequests[0].body.format.schema.required.includes("artifactTexts"));
    assert.deepEqual(messageRequests[0].body.options, { structuredOutputMode: "outputFormat" });
    assert.deepEqual(messageRequests[0].body.tools, getOpenCodeDisabledToolsForTest());
    assert.ok(Object.keys(messageRequests[0].body.tools).length > 0);
    assert.ok(Object.values(messageRequests[0].body.tools).every((enabled) => enabled === false));
    assert.equal(messageRequests[0].headers.authorization.startsWith("Basic "), true);
    assert.equal(JSON.stringify(requests).includes("local-test-password-value"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousPasswordFile === undefined) delete process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
    else process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = previousPasswordFile;
  }
});

test("direct-host resolver classifies non-text OpenCode parts without exposing part contents", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "team-ir-opencode-parts-secret-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const passwordFile = join(directory, "serve.env");
  await writeFile(passwordFile, "OPENCODE_API_KEY=local-test-password-value\n", { mode: 0o600 });
  await chmod(passwordFile, 0o600);
  const previousPasswordFile = process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
  const previousFetch = globalThis.fetch;
  process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = passwordFile;
  globalThis.fetch = async (url) => String(url).endsWith("/session")
    ? new Response(JSON.stringify({ id: "direct-session-tool" }), { status: 200 })
    : new Response(JSON.stringify({ parts: [{ type: "tool", tool: "invalid", state: { status: "error", input: "secret-marker" } }] }), { status: 200 });
  try {
    const closure = await resolveTeamIrReleaseClosure({ teamIR: fixture });
    const bindings = await resolveBindings({ teamIR: fixture, closure });
    await assert.rejects(bindings["binding:planner"].invoke({
      idempotencyKey: "run-tool-output",
      agentId: "planner",
      handoffId: "run-to-planner",
      attempt: 1,
      input: { request: "Plan a small software change." },
      artifactResolver: { read: async () => Buffer.alloc(0) }
    }), (error) => {
      assert.equal(error.diagnosticCode, "OUTPUT_PARTS_UNEXPECTED_TOOL");
      assert.equal(JSON.stringify(error).includes("secret-marker"), false);
      return true;
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousPasswordFile === undefined) delete process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
    else process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = previousPasswordFile;
  }
});

test("direct-host resolver maps only OpenCode StructuredOutput parts to the Team IR envelope", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "team-ir-opencode-structured-secret-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const passwordFile = join(directory, "serve.env");
  await writeFile(passwordFile, "OPENCODE_API_KEY=local-test-password-value\n", { mode: 0o600 });
  await chmod(passwordFile, 0o600);
  const previousPasswordFile = process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
  const previousFetch = globalThis.fetch;
  process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = passwordFile;
  globalThis.fetch = async (url) => String(url).endsWith("/session")
    ? new Response(JSON.stringify({ id: "direct-session-structured" }), { status: 200 })
    : new Response(JSON.stringify({ parts: [
      { type: "step-start" },
      { type: "text", text: "ignored non-authoritative sidecar" },
      { type: "provider-note", data: "unmapped sidecar" },
      { type: "tool", tool: "StructuredOutput", state: { status: "completed", input: { event: "PLAN", data: { plan: "Implement the requested change." }, artifactTexts: {} } } },
      { type: "step-finish" }
    ] }), { status: 200 });
  try {
    const closure = await resolveTeamIrReleaseClosure({ teamIR: fixture });
    const bindings = await resolveBindings({ teamIR: fixture, closure });
    const result = await bindings["binding:planner"].invoke({
      idempotencyKey: "run-structured-output",
      agentId: "planner",
      handoffId: "run-to-planner",
      attempt: 1,
      input: { request: "Plan a small software change." },
      artifactResolver: { read: async () => Buffer.alloc(0) }
    });
    assert.equal(result.kind, "completed");
    assert.equal(result.output.event, "PLAN");
    assert.deepEqual(result.output.data, { plan: "Implement the requested change." });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousPasswordFile === undefined) delete process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
    else process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE = previousPasswordFile;
  }
});
