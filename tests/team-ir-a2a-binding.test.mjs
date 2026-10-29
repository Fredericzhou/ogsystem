import assert from "node:assert/strict";
import test from "node:test";
import { compileTeamIr, createTeamA2ABinding, MemoryTeamRunStore, TeamBindingError, TeamRuntime } from "../dist/team-ir/index.js";

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

test("concurrent A2A invocations with the same idempotency key share one remote Task", async () => {
  let releaseTask;
  const taskGate = new Promise((resolve) => { releaseTask = resolve; });
  let sends = 0;
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    client: {
      async getAgentCard() { return card(); },
      async sendMessage(message) {
        sends += 1;
        assert.equal(message.idempotencyKey, invocation.idempotencyKey);
        return task("working");
      },
      async getTask() { await taskGate; return task("completed", { result: { event: "DONE", data: {} } }); },
      async cancelTask() { return true; }
    },
    sleep: async () => {}
  });

  const first = binding.invoke(invocation);
  const second = binding.invoke(invocation);
  releaseTask();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(sends, 1);
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

test("A2A submission response loss reports unknown outcome and retry keeps the invocation key", async () => {
  const sentKeys = [];
  let sends = 0;
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    client: {
      async getAgentCard() { return card(); },
      async sendMessage(message) {
        sends += 1;
        sentKeys.push(message.idempotencyKey);
        if (sends === 1) throw new Error("connection closed after request write");
        return task("completed", { result: { event: "DONE", data: {} } });
      },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });

  await assert.rejects(binding.invoke(invocation), (error) => error.failureClass === "transport" && error.outcomeUnknown === true);
  assert.deepEqual(await binding.invoke(invocation), { kind: "completed", output: { event: "DONE", data: {} } });
  assert.deepEqual(sentKeys, [invocation.idempotencyKey, invocation.idempotencyKey]);
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
  let associatedTaskId;
  assert.deepEqual(await binding.invoke({ ...invocation, async onRemoteTaskId(taskId) { associatedTaskId = taskId; } }), {
    kind: "input-required", remoteTaskId: "remote-task-1", messageParts: [{ text: "Please clarify" }],
    requestedInputSchema: { type: "object", required: ["scope"] }
  });
  assert.equal(associatedTaskId, "remote-task-1");
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

test("A2A completed Message Parts map allowlisted file parts into Team output Artifacts", async () => {
  const content = new TextEncoder().encode("remote evidence");
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    outputMediaTypes: ["application/json", "text/markdown"],
    client: {
      async getAgentCard() { return card({ defaultOutputModes: ["application/json", "text/markdown"] }); },
      async sendMessage() {
        return task("completed", { result: {
          event: "REVIEWED",
          data: { approved: true },
          artifacts: { review: { mediaType: "text/markdown", bytesBase64: Buffer.from(content).toString("base64") } }
        } });
      },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });

  const result = await binding.invoke(invocation);
  assert.equal(result.kind, "completed");
  assert.equal(result.output.event, "REVIEWED");
  assert.deepEqual(result.output.artifacts.review, { mediaType: "text/markdown", content });
});

test("completed A2A file Message Parts require an explicit unique output slot", async () => {
  const encoded = Buffer.from("review evidence").toString("base64");
  const make = (messageParts) => createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    outputMediaTypes: ["application/json", "text/markdown"],
    client: {
      async getAgentCard() { return card({ defaultOutputModes: ["application/json", "text/markdown"] }); },
      async sendMessage() { return task("completed", { messageParts, result: { event: "REVIEWED", data: {} } }); },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });
  const valid = await make([{ kind: "file", slotId: "review", mediaType: "text/markdown", bytesBase64: encoded }]).invoke(invocation);
  assert.equal(Buffer.from(valid.output.artifacts.review.content).toString(), "review evidence");
  await assert.rejects(make([{ kind: "file", mediaType: "text/markdown", bytesBase64: encoded }]).invoke(invocation),
    (error) => error.failureClass === "invalid_output");
});

test("A2A output Artifacts reject malformed bytes and media outside the pinned output contract", async () => {
  const make = (artifact) => createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    outputMediaTypes: ["application/json", "text/markdown"],
    client: {
      async getAgentCard() { return card({ defaultOutputModes: ["application/json", "text/markdown"] }); },
      async sendMessage() { return task("completed", { result: { event: "REVIEWED", data: {}, artifacts: { review: artifact } } }); },
      async getTask() { throw new Error("not expected"); },
      async cancelTask() { return true; }
    }
  });
  await assert.rejects(make({ mediaType: "text/markdown", bytesBase64: "not base64!" }).invoke(invocation),
    (error) => error.failureClass === "invalid_output");
  await assert.rejects(make({ mediaType: "image/png", bytesBase64: "AQ==" }).invoke(invocation),
    (error) => error.failureClass === "policy");
});

test("Team Runtime Handoff deadline cancels the active A2A Task", async () => {
  let now = 0;
  const sleepers = new Set();
  const clock = {
    now: () => now,
    sleep(ms, signal) {
      return new Promise((resolve) => {
        const sleeper = { due: now + ms, resolve };
        const abort = () => { sleepers.delete(sleeper); resolve(); };
        sleeper.abort = abort;
        sleepers.add(sleeper);
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
    advanceTo(value) {
      now = value;
      for (const sleeper of [...sleepers]) {
        if (sleeper.due <= now) {
          sleepers.delete(sleeper);
          sleeper.resolve();
        }
      }
    }
  };
  let startedPolling;
  const pollingStarted = new Promise((resolve) => { startedPolling = resolve; });
  let releasePoll;
  const pollGate = new Promise((resolve) => { releasePoll = resolve; });
  let remoteCancelCalls = 0;
  const a2a = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    sleep: async () => { startedPolling(); await pollGate; },
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { return task("working"); },
      async getTask() { return task("working"); },
      async cancelTask() { remoteCancelCalls += 1; releasePoll(); return true; }
    }
  });
  const team = {
    schemaVersion: 2,
    team: { id: "a2a-deadline", version: "2.0.0" },
    runInput: { dataSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false }, preferencesSchema: { type: "object" }, artifactSlots: {} },
    runResult: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }, artifactSlots: {} },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 1000 },
    agents: [{ id: "remote", packageRef: "role:remote@1", bindingRef: "binding:remote", inputPorts: { default: { dataSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false } } }, outputPorts: { DONE: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } } }],
    handoffs: [
      { id: "start", from: { kind: "run" }, to: { kind: "agent", agentId: "remote", inputPort: "default" }, map: { data: { question: { "$ref": "$.run.input.question" } } }, when: { priority: 0 }, delivery: { deadlineMs: 20 } },
      { id: "finish", from: { kind: "agent", agentId: "remote", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { "$ref": "$.output.data.answer" } } } }
    ],
    orchestration: { routes: [{ from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["start"] }], joins: [], loops: [], reviews: [] },
    bindings: [{ id: "binding:remote", kind: "a2a", agentCardRef: "https://agents.example/card.json", attemptTimeoutMs: 100, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }, capabilities: { inputMediaTypes: ["application/json"], outputMediaTypes: ["application/json"], protocolCapabilities: ["cancel"] } }]
  };
  const runtime = new TeamRuntime({ store: new MemoryTeamRunStore(), clock, bindings: { "binding:remote": a2a } });
  const plan = compileTeamIr(team);
  await runtime.createRun(plan, { runId: "a2a-deadline-run", task: "wait on remote", input: { question: "Review this change" } });
  const executing = runtime.executeRun(plan, "a2a-deadline-run");
  await pollingStarted;
  clock.advanceTo(20);
  const result = await executing;

  assert.equal(result.status, "failed");
  assert.equal(result.events.find((event) => event.type === "run.failing")?.data?.code, "HANDOFF_DEADLINE_EXCEEDED");
  assert.equal(result.invocations["a2a-deadline-run:start"].outcomeUnknown, false);
  assert.equal(remoteCancelCalls, 1);
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

test("A2A cancellation uses a persisted remote task ID when the Binding process has restarted", async () => {
  const cancelled = [];
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { throw new Error("not expected"); },
      async getTask() { throw new Error("not expected"); },
      async cancelTask(taskId) { cancelled.push(taskId); return true; }
    }
  });
  assert.equal(await binding.cancel({ ...invocation, remoteTaskId: "persisted-remote-task" }), true);
  assert.deepEqual(cancelled, ["persisted-remote-task"]);
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
