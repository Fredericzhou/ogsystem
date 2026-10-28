import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTeamIr, createTeamA2ABinding, FileTeamRunStore, TeamRuntime } from "../dist/team-ir/index.js";

const fixtureUrl = new URL("../examples/team-ir-v2/classic-a2a-intake.json", import.meta.url);

async function loadFixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

function card() {
  return {
    protocolVersion: "1.0",
    name: "Remote intake service",
    version: "2026-10-1",
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    capabilities: { streaming: false, pushNotifications: false }
  };
}

function withinTimeout(promise, label, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function makeRuntime(root, binding) {
  return new TeamRuntime({
    store: new FileTeamRunStore(root),
    clock: { now: () => Date.now(), sleep: () => new Promise(() => {}) },
    bindings: { "binding:remote-intake": binding }
  });
}

test("classic A2A intake fixture compiles with a pinned remote card contract", async () => {
  const fixture = await loadFixture();
  const plan = compileTeamIr(fixture);

  assert.equal(fixture.team.id, "classic-a2a-intake");
  assert.equal(fixture.bindings[0].agentCardRef, "https://agents.example/intake/agent-card.json");
  assert.equal(fixture.bindings[0].kind, "a2a");
  assert.equal(plan.team.agents[0].bindingRef, "binding:remote-intake");
  assert.equal(plan.team.executionPolicy.resultMode, "required");
});

test("input-required persists the request, keeps it out of audit events, and requires a new Run for changed input", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "classic-a2a-intake-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = compileTeamIr(await loadFixture());
  let mode = "input-required";
  let sends = 0;
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    inputMediaTypes: ["application/json"],
    outputMediaTypes: ["application/json"],
    client: {
      async getAgentCard() { return card(); },
      async sendMessage(message) {
        sends += 1;
        assert.equal(message.idempotencyKey, message.messageId);
        if (mode === "input-required") {
          return {
            id: "remote-task-needs-scope",
            status: "input-required",
            messageParts: [{ text: "Please provide the service location." }],
            requestedInputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] }
          };
        }
        return { id: `remote-task-${sends}`, status: "completed", result: { event: "INTAKE_COMPLETE", data: { summary: "Intake completed for the clarified location." } } };
      },
      async getTask() { throw new Error("No polling is expected in this scenario."); },
      async cancelTask() { return true; }
    }
  });

  const firstRuntime = makeRuntime(root, binding);
  const runId = "a2a-intake-pending";
  await firstRuntime.createRun(plan, { runId, task: "intake request", input: { request: "Open a service case." } });
  const paused = await firstRuntime.executeRun(plan, runId);
  assert.equal(paused.status, "paused_input_required");
  assert.equal(paused.pendingInput.remoteTaskId, "remote-task-needs-scope");
  assert.deepEqual(paused.pendingInput.messageParts, [{ text: "Please provide the service location." }]);
  assert.deepEqual(paused.pendingInput.requestedInputSchema.required, ["location"]);

  const restartedStore = new FileTeamRunStore(root);
  const afterRestart = await restartedStore.load(runId);
  assert.equal(afterRestart.status, "paused_input_required");
  assert.equal(afterRestart.pendingInput.remoteTaskId, "remote-task-needs-scope");
  const audit = JSON.stringify(afterRestart.events);
  assert.equal(audit.includes("Please provide the service location"), false);
  assert.equal(audit.includes("location"), false);
  await assert.rejects(makeRuntime(root, binding).executeRun(plan, runId), /TEAM_RUN_INPUT_REQUIRED_NEW_RUN/);

  mode = "completed";
  const changedInputRunId = "a2a-intake-clarified";
  const changedInputRun = await makeRuntime(root, binding).createRun(plan, {
    runId: changedInputRunId,
    task: "intake request with location",
    input: { request: "Open a service case for the north branch." }
  });
  assert.equal(changedInputRun.runInput.input.request, "Open a service case for the north branch.");
  const completed = await makeRuntime(root, binding).executeRun(plan, changedInputRunId);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, { summary: "Intake completed for the clarified location." });
  assert.equal(sends, 2, "changed input must start an independent remote Task with a new idempotency key");
});

test("active remote A2A Task can be canceled and settles its Run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "classic-a2a-intake-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = compileTeamIr(await loadFixture());
  let releasePoll;
  let pollStarted;
  const pollStartedPromise = new Promise((resolve) => { pollStarted = resolve; });
  let remoteCancelCalls = 0;
  const binding = createTeamA2ABinding({
    expectedProtocolVersion: "1.0",
    expectedAgentVersion: "2026-10-1",
    sleep: async () => {
      pollStarted();
      await new Promise((resolve) => { releasePoll = resolve; });
    },
    client: {
      async getAgentCard() { return card(); },
      async sendMessage() { return { id: "remote-task-working", status: "working" }; },
      async getTask() { return { id: "remote-task-working", status: "working" }; },
      async cancelTask(taskId) { assert.equal(taskId, "remote-task-working"); remoteCancelCalls += 1; return true; }
    }
  });
  const runtime = makeRuntime(root, binding);
  const runId = "a2a-intake-cancel";
  await runtime.createRun(plan, { runId, task: "cancel intake", input: { request: "Open a service case." } });
  const executing = runtime.executeRun(plan, runId);
  try {
    await withinTimeout(pollStartedPromise, "remote A2A polling");
    await runtime.cancel(runId);
  } finally {
    releasePoll?.();
  }
  await withinTimeout(executing, "Runtime observes A2A cancellation");
  const cancelled = await runtime.settle(runId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.invocations[`${runId}:run-to-remote-intake`].status, "cancelled");
  assert.equal(cancelled.invocations[`${runId}:run-to-remote-intake`].outcomeUnknown, false);
  assert.ok(remoteCancelCalls >= 1);
});
