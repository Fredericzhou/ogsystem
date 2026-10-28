import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTeamIrV2A2AResolver } from "../infrastructure/team-ir-v2-a2a-resolver.mjs";

const fixture = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-a2a-intake.json", import.meta.url), "utf8"));
const card = {
  protocolVersion: "1.0",
  name: "Intake Agent",
  version: "2.4.1",
  defaultInputModes: ["application/json"],
  defaultOutputModes: ["application/json"],
  capabilities: { streaming: false, pushNotifications: false }
};

function makeClient() {
  const calls = [];
  let task = { id: "remote-1", status: "working" };
  return {
    calls,
    async getAgentCard() { calls.push("card"); return card; },
    async sendMessage(input) {
      calls.push({ method: "send", idempotencyKey: input.idempotencyKey });
      task = { id: "remote-1", status: "submitted" };
      return task;
    },
    async getTask(taskId) {
      calls.push({ method: "get", taskId });
      task = { id: taskId, status: "completed", result: { event: "INTAKE_COMPLETE", data: { summary: "received" } } };
      return task;
    },
    async cancelTask(taskId) { calls.push({ method: "cancel", taskId }); return true; }
  };
}

test("A2A resolver pins Agent Card and adapter in the release closure and executes through injected client", async () => {
  const client = makeClient();
  const resolver = createTeamIrV2A2AResolver({ resolveAgent: async () => ({ client, agentCard: card }) });
  const closure = await resolver.resolveClosure({ team: {}, teamIR: fixture });
  assert.equal(closure.adapterVersions.a2a, "ogs-team-ir-a2a-binding/1");
  assert.match(closure.bindingDigests["binding:remote-intake"], /^[a-f0-9]{64}$/);
  const bindings = await resolver.resolveBindings({ team: {}, teamIR: fixture, closure });
  const result = await bindings["binding:remote-intake"].invoke({
    idempotencyKey: "run-1:remote-intake",
    handoffId: "run-to-remote-intake",
    agentId: "remote-intake",
    bindingId: "binding:remote-intake",
    attempt: 1,
    input: { request: "Collect intake details" }
  });
  assert.deepEqual(result, { kind: "completed", output: { event: "INTAKE_COMPLETE", data: { summary: "received" } } });
  assert.deepEqual(client.calls.map((call) => typeof call === "string" ? call : call.method), ["card", "send", "get"]);
  assert.equal(client.calls.find((call) => call?.method === "send").idempotencyKey, "run-1:remote-intake");
});

test("A2A resolver rejects card drift and missing deployment clients", async () => {
  let currentCard = card;
  const client = makeClient();
  const resolver = createTeamIrV2A2AResolver({ resolveAgent: async () => ({ client, agentCard: currentCard }) });
  const closure = await resolver.resolveClosure({ team: {}, teamIR: fixture });
  currentCard = { ...card, version: "2.4.2" };
  await assert.rejects(resolver.resolveBindings({ team: {}, teamIR: fixture, closure }), /TEAM_IR_A2A_CARD_DRIFT/);
  const unavailable = createTeamIrV2A2AResolver({ resolveAgent: async () => undefined });
  await assert.rejects(unavailable.resolveClosure({ team: {}, teamIR: fixture }), /TEAM_IR_A2A_CLIENT_UNAVAILABLE/);
});
