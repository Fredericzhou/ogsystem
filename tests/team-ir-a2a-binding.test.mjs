import assert from "node:assert/strict";
import test from "node:test";
import { createTeamA2ABinding, TeamBindingError } from "../dist/team-ir/index.js";

const invocation = {
  runId: "run-1",
  handoffId: "handoff-1",
  agentId: "remote-reviewer",
  bindingId: "binding:remote",
  attempt: 1,
  input: { question: "Review this change" },
  idempotencyKey: "run-1:handoff-1"
};
const artifactInvocation = {
  ...invocation,
  input: { data: { question: "Review this change" }, artifacts: [{ artifactId: "artifact-1", mediaType: "text/markdown" }] }
};

function card(overrides = {}) {
  return {
    protocolVersion: "1.0",
    name: "Remote reviewer",
    version: "2026-10-1",
    defaultInputModes: ["application/json", "text/markdown"],
    defaultOutputModes: ["application/json"],
    capabilities: { streaming: true, pushNotifications: false },
    ...overrides
  };
}

function task(status, fields = {}) {
  return { id: "remote-task-1", status, ...fields };
}

test("A2A Binding checks the pinned Agent Card and maps JSON and authorized Artifact parts", async () => {
  const sent = [];
  let reads = 0;
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    inputMediaTypes: ["application/json", "text/markdown"],
    outputMediaTypes: ["application/json"],
    artifactReader: { async read(id) { reads += 1; assert.equal(id, "artifact-1"); return { mediaType: "text/markdown", bytes: new TextEncoder().encode("draft") }; } },
    client: {
      async getAgentCard() { return card(); },
      async sendMessage(message) { sent.push(message); return task("completed", { result: { event: "REVIEWED", data: { approved: true } } }); },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });
  const result = await binding.invoke(artifactInvocation);
  assert.deepEqual(result, { kind: "completed", output: { event: "REVIEWED", data: { approved: true } } });
  assert.equal(reads, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageId, invocation.idempotencyKey);
  assert.equal(sent[0].idempotencyKey, invocation.idempotencyKey);
  assert.deepEqual(sent[0].parts[0], { kind: "data", mediaType: "application/json", data: { question: "Review this change" } });
  assert.equal(sent[0].parts[1].kind, "file");
  assert.equal(sent[0].parts[1].mediaType, "text/markdown");
  assert.equal(sent[0].parts[1].bytesBase64, Buffer.from("draft").toString("base64"));
  assert.deepEqual(await binding.invoke(artifactInvocation), result);
  assert.equal(sent.length, 1, "completed idempotency key must not create a second remote Task");
});

test("A2A Binding rejects Agent Card version and media mismatches before creating a Task", async () => {
  let sends = 0;
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    inputMediaTypes: ["application/json", "image/png"],
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { sends += 1; return task("completed", { result: { event: "DONE", data: {} } }); },
      async getTask() { return task("failed"); },
      async cancelTask() { return true; }
    }
  });
  await assert.rejects(binding.invoke(invocation), (error) => error instanceof TeamBindingError && error.failureClass === "policy");
  assert.equal(sends, 0);

  const changed = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "other-version",
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { sends += 1; return task("completed", { result: { event: "DONE", data: {} } }); },
      async getTask() { return task("failed"); },
      async cancelTask() { return true; }
    }
  });
  await assert.rejects(changed.invoke({ ...invocation, idempotencyKey: "run-2:handoff-1" }), (error) => error instanceof TeamBindingError && error.failureClass === "policy");
  assert.equal(sends, 0);
});

test("A2A transport errors are classified for the Binding retry policy", async () => {
  const make = (status) => createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { throw Object.assign(new Error("remote transport failed"), { status }); },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });
  await assert.rejects(make(429).invoke(invocation), (error) => error.failureClass === "rate_limited");
  await assert.rejects(make(503).invoke({ ...invocation, idempotencyKey: "run-2:handoff-1" }), (error) => error.failureClass === "server_error");
});

test("A2A input-required returns the durable remote task and requested input contract", async () => {
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { return task("input-required", { messageParts: [{ text: "Please clarify" }], requestedInputSchema: { type: "object", required: ["scope"] } }); },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });
  assert.deepEqual(await binding.invoke(invocation), {
    kind: "input-required", remoteTaskId: "remote-task-1", messageParts: [{ text: "Please clarify" }],
    requestedInputSchema: { type: "object", required: ["scope"] }
  });
});

test("A2A Binding polls working Tasks and maps completed, failed, canceled, and rejected states", async () => {
  let next;
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    sleep: async () => {},
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { return task("working"); },
      async getTask() { return next; },
      async cancelTask() { return true; }
    }
  });
  next = task("completed", { result: { event: "DONE", data: { answer: "ok" } } });
  assert.equal((await binding.invoke(invocation)).kind, "completed");
  next = task("failed", { errorCode: "REMOTE_FAILED" });
  await assert.rejects(binding.invoke({ ...invocation, idempotencyKey: "run-2:handoff-1" }), (error) => error.failureClass === "server_error");
  next = task("canceled");
  await assert.rejects(binding.invoke({ ...invocation, idempotencyKey: "run-3:handoff-1" }), (error) => error.failureClass === "cancelled");
  next = task("rejected");
  await assert.rejects(binding.invoke({ ...invocation, idempotencyKey: "run-4:handoff-1" }), (error) => error.failureClass === "policy");
});

test("A2A cancellation requests remote cancellation and reports unconfirmed outcomes", async () => {
  let resolveSleep;
  let cancelCalls = 0;
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    sleep: () => new Promise((resolve) => { resolveSleep = resolve; }),
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { return task("working"); },
      async getTask() { return task("working"); },
      async cancelTask() { cancelCalls += 1; return false; }
    }
  });
  const pending = binding.invoke(invocation);
  while (!resolveSleep) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await binding.cancel(invocation), false);
  resolveSleep();
  await assert.rejects(pending, (error) => error.failureClass === "cancelled" && error.outcomeUnknown === true);
  assert.ok(cancelCalls >= 1);
});

test("A2A Artifact delivery fails closed without authorized bytes or when media type changed", async () => {
  const make = (artifactReader) => createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    artifactReader,
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { throw new Error("must not send"); },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });
  await assert.rejects(make(undefined).invoke(artifactInvocation), (error) => error.failureClass === "policy");
  await assert.rejects(make({ async read() { return { mediaType: "image/png", bytes: new Uint8Array([1]) }; } }).invoke(artifactInvocation), (error) => error.failureClass === "invalid_input");
});
