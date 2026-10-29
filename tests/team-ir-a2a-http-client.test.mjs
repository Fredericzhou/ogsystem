import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TaskState } from "@a2a-js/sdk";
import { AgentEvent, DefaultRequestHandler, InMemoryTaskStore, JsonRpcTransportHandler, ServerCallContext } from "@a2a-js/sdk/server";
import { createTeamA2AHttpClient, createTeamA2ABinding } from "../dist/team-ir/index.js";

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

function card(endpoint, interfaceUrl = `${endpoint}/rpc`) {
  return {
    name: "Local reviewer",
    description: "Contract fixture",
    supportedInterfaces: [{ url: interfaceUrl, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    provider: { organization: "Tests", url: "https://example.test" },
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["application/json", "text/markdown"],
    defaultOutputModes: ["application/json"],
    skills: [{ id: "review", name: "Review", description: "Review", tags: [], examples: [], inputModes: ["application/json", "text/markdown"], outputModes: ["application/json"], securityRequirements: [] }],
    signatures: [],
  };
}

function task(state, overrides = {}) {
  return {
    id: "task-1",
    contextId: "context-1",
    status: { state, message: undefined, timestamp: "2026-10-29T00:00:00Z" },
    artifacts: [],
    history: [],
    metadata: {},
    ...overrides,
  };
}

test("A2A HTTP client discovers a pinned v1 card and maps authenticated send/get/cancel traffic", async (t) => {
  const requests = [];
  let sentMessage;
  let base = "";
  const local = await listen(async (request, response) => {
    if (request.url === "/.well-known/agent-card.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(card(base)));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ authorization: request.headers.authorization, body });
    let result;
    if (body.method === "SendMessage") {
      const message = body.params.message;
      sentMessage = message;
      result = { task: task("TASK_STATE_COMPLETED", {
        history: [{
          messageId: "input-message",
          role: "ROLE_USER",
          parts: [
            { mediaType: "application/json", data: { event: "INPUT", data: { question: "Review this" } } },
            { mediaType: "text/markdown", raw: Buffer.from("draft").toString("base64"), filename: "source-document", metadata: { "team.ir": { slotId: "source-document" } } },
          ],
          extensions: [],
          referenceTaskIds: [],
        }],
        artifacts: [{
          artifactId: "result-1",
          name: "result",
          parts: [{ mediaType: "application/json", data: { event: "REVIEWED", data: { approved: true } } }],
          metadata: {},
          extensions: [],
        }, {
          artifactId: "file-1",
          name: "report",
          parts: [{ mediaType: "text/markdown", raw: Buffer.from("approved").toString("base64"), filename: "report.md" }],
          metadata: { "team.ir": { slotId: "review-report" } },
          extensions: [],
        }],
      }) };
    } else if (body.method === "GetTask") result = task(body.params.id === "auth-required" ? "TASK_STATE_AUTH_REQUIRED" : "TASK_STATE_WORKING", {
      history: [{ messageId: "history-message", role: "ROLE_AGENT", parts: [{ mediaType: "text/plain", text: "Need details" }], extensions: [], referenceTaskIds: [] }],
      metadata: { "team.ir": { requestedInputSchema: { type: "object", required: ["account"] } } },
    });
    else if (body.method === "CancelTask") result = task("TASK_STATE_CANCELED");
    else throw new Error(`Unexpected method ${body.method}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  base = local.endpoint;
  t.after(() => new Promise((resolve) => local.server.close(resolve)));

  const client = createTeamA2AHttpClient({ endpoint: local.endpoint, authorization: "Bearer test-secret" });
  assert.deepEqual(await client.getAgentCard(), {
    protocolVersion: "1.0",
    name: "Local reviewer",
    version: "1.0.0",
    defaultInputModes: ["application/json", "text/markdown"],
    defaultOutputModes: ["application/json"],
    capabilities: { streaming: false, pushNotifications: false },
    skills: [{ id: "review", inputModes: ["application/json", "text/markdown"], outputModes: ["application/json"] }],
  });
  const submitted = await client.sendMessage({
    messageId: "run-1:handoff-1",
    idempotencyKey: "run-1:handoff-1",
    parts: [
      { kind: "data", mediaType: "application/json", data: { question: "Review this" } },
      { kind: "file", mediaType: "text/markdown", name: "source-document", bytesBase64: Buffer.from("draft").toString("base64") },
    ],
  });
  assert.equal(submitted.status, "completed");
  assert.deepEqual(submitted.result, { event: "REVIEWED", data: { approved: true }, artifacts: { "review-report": { kind: "file", mediaType: "text/markdown", name: "report.md", bytesBase64: Buffer.from("approved").toString("base64"), slotId: "review-report" } } });
  assert.equal((await client.getTask("task-1")).status, "working");
  const authRequired = await client.getTask("auth-required");
  assert.equal(authRequired.status, "auth-required");
  assert.deepEqual(authRequired.requestedInputSchema, { type: "object", required: ["account"] });
  assert.deepEqual(authRequired.messageParts, [{ kind: "text", mediaType: "text/plain", text: "Need details" }]);
  assert.equal(await client.cancelTask("task-1"), true);
  assert.equal(sentMessage.role, "ROLE_USER");
  assert.equal(sentMessage.metadata["team.ir"].idempotencyKey, "run-1:handoff-1");
  assert.deepEqual(sentMessage.parts[0].data, { question: "Review this" });
  assert.equal(sentMessage.parts[1].raw, Buffer.from("draft").toString("base64"));
  assert.deepEqual(sentMessage.parts[1].metadata["team.ir"], { slotId: "source-document" });
  assert.deepEqual(requests.map(({ body }) => body.method), ["SendMessage", "GetTask", "GetTask", "CancelTask"]);
  assert.ok(requests.every(({ authorization }) => authorization === "Bearer test-secret"));
});

test("A2A HTTP client completes a localhost round trip against the official SDK server handler", async (t) => {
  const seenAuthorization = [];
  let base = "";
  const agentCard = card("", "");
  agentCard.supportedInterfaces[0] = { url: "", protocolBinding: "JSONRPC", protocolVersion: "1.0" };
  const executor = {
    async execute(requestContext, eventBus) {
      const taskId = requestContext.taskId;
      const contextId = requestContext.contextId;
      eventBus.publish(AgentEvent.task({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: new Date().toISOString() },
        artifacts: [],
        history: [],
        metadata: {},
      }));
      eventBus.publish(AgentEvent.artifactUpdate({
        taskId,
        contextId,
        artifact: {
          artifactId: "review-result",
          name: "review result",
          description: "Typed Team envelope",
          parts: [{ content: { $case: "data", value: { event: "REVIEWED", data: { accepted: true } } }, mediaType: "application/json", filename: "", metadata: undefined }],
          metadata: undefined,
          extensions: [],
        },
        append: false,
        lastChunk: true,
        metadata: undefined,
      }));
      eventBus.publish(AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: new Date().toISOString() },
        metadata: undefined,
      }));
    },
    async cancelTask() {},
  };
  const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
  const transport = new JsonRpcTransportHandler(requestHandler);
  const local = await listen(async (request, response) => {
    seenAuthorization.push(request.headers.authorization);
    if (request.headers.authorization !== "Bearer localhost-secret") {
      response.writeHead(401);
      response.end();
      return;
    }
    if (request.url === "/.well-known/agent-card.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...agentCard, supportedInterfaces: [{ ...agentCard.supportedInterfaces[0], url: `${base}/rpc` }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    try {
      const result = await transport.handle(body, new ServerCallContext({ requestedVersion: "1.0" }));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  base = local.endpoint;
  t.after(() => new Promise((resolve) => local.server.close(resolve)));
  agentCard.supportedInterfaces[0] = { url: `${base}/rpc`, protocolBinding: "JSONRPC", protocolVersion: "1.0" };

  const client = createTeamA2AHttpClient({ endpoint: base, authorization: "Bearer localhost-secret" });
  let result = await client.sendMessage({
    messageId: "localhost-e2e-message",
    idempotencyKey: "localhost-e2e-idempotency",
    parts: [{ kind: "data", mediaType: "application/json", data: { request: "Review" } }],
  });
  for (let attempt = 0; attempt < 20 && ["submitted", "working"].includes(result.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    result = await client.getTask(result.id);
  }
  assert.equal(result.status, "completed");
  assert.deepEqual(result.result, { event: "REVIEWED", data: { accepted: true } });
  assert.ok(seenAuthorization.length >= 3, "discovery, send, and polling calls use configured auth");
  assert.ok(seenAuthorization.every((authorization) => authorization === "Bearer localhost-secret"));
});

test("A2A client interoperates with an independent official SDK Agent service process", async (t) => {
  const secret = "separate-process-test-secret";
  const serverProcess = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/team-ir-a2a-http-agent-service.mjs", import.meta.url))], {
    env: { ...process.env, TEAM_IR_A2A_TEST_SECRET: secret },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    lines.close();
    if (serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    if (serverProcess.exitCode === null) await new Promise((resolve) => serverProcess.once("exit", resolve));
  });
  const stderr = [];
  serverProcess.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const lines = createInterface({ input: serverProcess.stdout });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("A2A Agent service startup timed out")), 5000);
    serverProcess.once("error", (error) => { clearTimeout(timer); reject(error); });
    serverProcess.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("A2A Agent service exited before ready: " + code + " " + Buffer.concat(stderr).toString("utf8")));
    });
    lines.once("line", (line) => {
      clearTimeout(timer);
      if (!line.startsWith("READY http://127.0.0.1:")) reject(new Error("Unexpected A2A Agent readiness line"));
      else resolve(line.slice("READY ".length));
    });
  });
  const unauthorized = await fetch(endpoint + "/.well-known/agent-card.json");
  assert.equal(unauthorized.status, 401, "the independent Agent service requires authentication for Agent Card discovery");
  const client = createTeamA2AHttpClient({ endpoint, authorization: "Bearer " + secret, acceptedOutputModes: ["application/json", "text/plain"] });
  let polls = 0;
  const trackedClient = {
    ...client,
    async getTask(taskId) {
      polls += 1;
      return client.getTask(taskId);
    }
  };
  const agentCard = await client.getAgentCard();
  assert.equal(agentCard.name, "Local Team IR test agent");
  assert.equal(agentCard.version, "1.0.0");
  const binding = createTeamA2ABinding({
    client: trackedClient,
    expectedProtocolVersion: agentCard.protocolVersion,
    expectedAgentVersion: agentCard.version,
    inputMediaTypes: ["application/json"],
    outputMediaTypes: ["application/json", "text/plain"],
    pollIntervalMs: 1,
    sleep: async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)))
  });
  const result = await binding.invoke({
    runId: "separate-service-run",
    handoffId: "remote-intake",
    agentId: "remote-intake",
    bindingId: "binding:remote-intake",
    attempt: 1,
    input: { request: "check protocol handoff" },
    idempotencyKey: "separate-service-idempotency"
  });
  assert.equal(result.kind, "completed");
  assert.deepEqual(result.output, {
    event: "INTAKE_COMPLETE",
    data: { summary: "accepted: check protocol handoff" },
    artifacts: { evidence: { mediaType: "text/plain", content: new Uint8Array(Buffer.from("independent agent evidence")) } }
  });
  assert.ok(polls >= 1, "the A2A Binding polls the independent Agent Task until completion");
  assert.deepEqual(await binding.invoke({
    runId: "separate-service-run",
    handoffId: "remote-intake",
    agentId: "remote-intake",
    bindingId: "binding:remote-intake",
    attempt: 1,
    input: { request: "ignored on replay" },
    idempotencyKey: "separate-service-idempotency"
  }), result, "same idempotency key replays the cached typed result without another remote Task");
});

test("A2A HTTP client rejects a card interface outside the configured origin before sending credentials", async (t) => {
  let foreignCalls = 0;
  const local = await listen((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(card(local.endpoint, "https://outside.example/rpc")));
  });
  const foreign = await listen((_request, response) => { foreignCalls += 1; response.end(); });
  t.after(() => Promise.all([
    new Promise((resolve) => local.server.close(resolve)),
    new Promise((resolve) => foreign.server.close(resolve)),
  ]));
  const client = createTeamA2AHttpClient({ endpoint: local.endpoint, authorization: "Bearer secret" });
  await assert.rejects(client.sendMessage({ messageId: "m", idempotencyKey: "k", parts: [] }), /A2A request failed/);
  assert.equal(foreignCalls, 0);
});

test("A2A HTTP errors expose only status for retry classification, not response bodies or URLs", async (t) => {
  let base = "";
  const local = await listen((request, response) => {
    if (request.url === "/.well-known/agent-card.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(card(base)));
      return;
    }
    response.writeHead(429, { "content-type": "text/plain" });
    response.end("secret-token https://private.example/path");
  });
  base = local.endpoint;
  t.after(() => new Promise((resolve) => local.server.close(resolve)));
  const client = createTeamA2AHttpClient({ endpoint: local.endpoint, authorization: "Bearer secret-token" });
  await assert.rejects(client.getTask("task-1"), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.message, "A2A request failed with HTTP 429.");
    assert.equal(error.message.includes("secret-token"), false);
    assert.equal(error.message.includes("private.example"), false);
    return true;
  });
});

test("A2A HTTP endpoint configuration rejects non-HTTPS remote endpoints and URL credentials", () => {
  assert.throws(() => createTeamA2AHttpClient({ endpoint: "http://a2a.example" }), /HTTPS/);
  assert.throws(() => createTeamA2AHttpClient({ endpoint: "https://user:secret@a2a.example" }), /credentials/);
});
