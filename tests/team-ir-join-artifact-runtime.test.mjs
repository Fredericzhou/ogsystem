import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTeamIr, FileTeamArtifactStore, FileTeamRunStore, TeamRuntime } from "../dist/team-ir/index.js";

function within(promise, label, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function artifactJoinTeam(mode) {
  const sourceAgent = (id) => ({
    id,
    packageRef: `role:${id}@1`,
    bindingRef: `binding:${id}`,
    inputPorts: { default: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false } } },
    outputPorts: { DONE: {
      dataSchema: { type: "object", properties: { result: { type: "string" } }, required: ["result"], additionalProperties: false },
      artifactSlots: { report: { required: true, mediaTypes: ["text/plain"], cardinality: "single" } }
    } }
  });
  const quorum = mode === "quorum_of";
  const value = {
    schemaVersion: 2,
    team: { id: `artifact-${mode}`, version: "1" },
    runInput: {
      dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false },
      preferencesSchema: { type: "object" },
      artifactSlots: { brief: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } }
    },
    runResult: { dataSchema: { type: "object" }, artifactSlots: {} },
    executionPolicy: { resultMode: "allow_empty", activeExecutionBudgetMs: 10000 },
    agents: [sourceAgent("left"), sourceAgent("right"), {
      id: "joiner",
      packageRef: "role:joiner@1",
      bindingRef: "binding:joiner",
      inputPorts: { default: {
        dataSchema: { type: "object", properties: {}, additionalProperties: false },
        artifactSlots: {
          brief: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" },
          leftDoc: { required: !quorum, acceptedMediaTypes: ["text/plain"], cardinality: "single" },
          rightDoc: { required: !quorum, acceptedMediaTypes: ["text/plain"], cardinality: "single" }
        }
      } },
      outputPorts: { DONE: { dataSchema: { type: "object", properties: {}, additionalProperties: false } } }
    }],
    handoffs: [
      { id: "start-left", from: { kind: "run" }, to: { kind: "agent", agentId: "left", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 5000 } },
      { id: "start-right", from: { kind: "run" }, to: { kind: "agent", agentId: "right", inputPort: "default" }, map: { data: { prompt: { "$ref": "$.run.input.prompt" } } }, delivery: { deadlineMs: 5000 } },
      { id: "left-join", from: { kind: "agent", agentId: "left", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { artifacts: { leftDoc: { "$ref": "$.output.artifacts.report" } } }, when: { priority: 0 }, delivery: { deadlineMs: 5000 } },
      { id: "right-join", from: { kind: "agent", agentId: "right", outputPort: "DONE" }, to: { kind: "agent", agentId: "joiner", inputPort: "default" }, map: { artifacts: { rightDoc: { "$ref": "$.output.artifacts.report" } } }, when: { priority: 0 }, delivery: { deadlineMs: 5000 } }
    ],
    orchestration: {
      routes: [
        { from: { kind: "run" }, mode: "parallel_fanout", onNoMatch: "fail", handoffIds: ["start-left", "start-right"] },
        { from: { kind: "agent", agentId: "left", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: ["left-join"] },
        { from: { kind: "agent", agentId: "right", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "finish", handoffIds: ["right-join"] }
      ],
      joins: [{
        id: "collect",
        agentId: "joiner",
        inputPort: "default",
        mode,
        ...(quorum ? { threshold: 1 } : {}),
        handoffIds: ["left-join", "right-join"],
        scope: { kind: "run" },
        timeoutMs: 4000,
        onTimeout: "fail",
        baseMapping: { artifacts: { brief: { "$ref": "$.run.attachments.brief" } } }
      }],
      loops: [],
      reviews: []
    },
    bindings: ["left", "right", "joiner"].map((id) => ({
      id: `binding:${id}`, kind: "model", modelRef: "models/default", attemptTimeoutMs: 3000,
      retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } }
    }))
  };
  return value;
}

async function setup(t, mode, bindings) {
  const root = await mkdtemp(join(tmpdir(), `team-ir-join-artifact-${mode}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const team = artifactJoinTeam(mode);
  const plan = compileTeamIr(team);
  const artifactStore = new FileTeamArtifactStore(join(root, "artifacts"));
  const brief = await artifactStore.registerRunInput({
    team, projectId: "project-1", slotId: "brief", mediaType: "text/plain", content: Buffer.from("base brief"), authorizeUpload: () => true
  });
  const runStore = new FileTeamRunStore(join(root, "runs"));
  const runtime = new TeamRuntime({
    store: runStore,
    clock: { now: () => 100, sleep: () => new Promise(() => {}) },
    bindings,
    artifactStore
  });
  await runtime.createRun(plan, { runId: `join-artifact-${mode}`, projectId: "project-1", task: "collect", input: { prompt: "collect" }, attachments: { brief } });
  return { root, team, plan, artifactStore, runStore, runtime };
}

function outputArtifact(content) {
  return { kind: "completed", output: { event: "DONE", data: { result: content }, artifacts: { report: { mediaType: "text/plain", content: Buffer.from(content) } } } };
}

test("all_of Join projects source and baseMapping Artifacts with provenance into the target allowlist", async (t) => {
  const reads = [];
  const bindings = {
    "binding:left": { async invoke() { return outputArtifact("left report"); } },
    "binding:right": { async invoke() { return outputArtifact("right report"); } },
    "binding:joiner": { async invoke(invocation) {
      const artifacts = invocation.input.artifacts;
      reads.push(...await Promise.all(Object.entries(artifacts).map(async ([slot, ref]) => [slot, Buffer.from(await invocation.artifactResolver.read(ref.artifactId)).toString()] )));
      await assert.rejects(invocation.artifactResolver.read("art_00000000-0000-0000-0000-000000000000"), (error) => error?.code === "ARTIFACT_ACCESS_DENIED");
      return { kind: "completed", output: { event: "DONE", data: {} } };
    } }
  };
  const fixture = await setup(t, "all_of", bindings);
  const result = await fixture.runtime.executeRun(fixture.plan, "join-artifact-all_of");
  assert.equal(result.status, "completed", JSON.stringify(result.events.filter((entry) => entry.type === "run.failing")));
  assert.deepEqual(reads.sort(), [["brief", "base brief"], ["leftDoc", "left report"], ["rightDoc", "right report"]]);
  const round = (await new FileTeamRunStore(join(fixture.root, "runs")).load("join-artifact-all_of")).scheduler.joinRounds.collect;
  assert.equal(round.merged.artifacts.brief.sourceHandoffId, "join.baseMapping");
  assert.equal(round.merged.artifacts.leftDoc.sourceHandoffId, "left-join");
  assert.equal(round.merged.artifacts.rightDoc.sourceHandoffId, "right-join");
});

test("quorum Join passes only selected source Artifacts plus baseMapping through the invocation allowlist", async (t) => {
  let releaseRight;
  let rightStarted;
  const rightStartedPromise = new Promise((resolve) => { rightStarted = resolve; });
  let joinStarted;
  const joinStartedPromise = new Promise((resolve) => { joinStarted = resolve; });
  const reads = [];
  const bindings = {
    "binding:left": { async invoke() { return outputArtifact("left report"); } },
    "binding:right": { async invoke() {
      rightStarted();
      await new Promise((resolve) => { releaseRight = resolve; });
      return outputArtifact("late right report");
    } },
    "binding:joiner": { async invoke(invocation) {
      const artifacts = invocation.input.artifacts;
      reads.push(...await Promise.all(Object.entries(artifacts).map(async ([slot, ref]) => [slot, Buffer.from(await invocation.artifactResolver.read(ref.artifactId)).toString()] )));
      joinStarted();
      return { kind: "completed", output: { event: "DONE", data: {} } };
    } }
  };
  const fixture = await setup(t, "quorum_of", bindings);
  const running = fixture.runtime.executeRun(fixture.plan, "join-artifact-quorum_of");
  try {
    await within(rightStartedPromise, "right source activation");
    await within(joinStartedPromise, "quorum target activation");
    assert.deepEqual(reads.sort(), [["brief", "base brief"], ["leftDoc", "left report"]]);
  } finally {
    releaseRight?.();
    await within(running.catch(() => undefined), "quorum Run settlement");
  }
  const result = await running;
  assert.equal(result.status, "completed", JSON.stringify(result.events.filter((entry) => entry.type === "run.failing")));
  const round = (await new FileTeamRunStore(join(fixture.root, "runs")).load("join-artifact-quorum_of")).scheduler.joinRounds.collect;
  assert.equal(round.merged.artifacts.leftDoc.sourceHandoffId, "left-join");
  assert.equal(Object.hasOwn(round.merged.artifacts, "rightDoc"), false);
  assert.equal(round.audit.some((entry) => entry.type === "join.source.late_arrival" && entry.sourceId === "right-join"), true);
});

test("Join Artifact mappings fail before source invocation when no ArtifactStore is configured", async (t) => {
  const team = artifactJoinTeam("all_of");
  team.runInput.artifactSlots = {};
  delete team.agents.find((agent) => agent.id === "joiner").inputPorts.default.artifactSlots.brief;
  team.orchestration.joins[0].baseMapping = {};
  const plan = compileTeamIr(team);
  const root = await mkdtemp(join(tmpdir(), "team-ir-join-artifact-missing-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runStore = new FileTeamRunStore(join(root, "runs"));
  let calls = 0;
  const bindings = Object.fromEntries(["left", "right", "joiner"].map((id) => [`binding:${id}`, {
    async invoke() {
      calls += 1;
      return { kind: "completed", output: { event: "DONE", data: { result: id } } };
    }
  }]));
  const runtime = new TeamRuntime({ store: runStore, clock: { now: () => 100, sleep: () => new Promise(() => {}) }, bindings });
  await runtime.createRun(plan, { runId: "join-artifact-missing-store", projectId: "project-1", task: "collect", input: { prompt: "collect" } });
  const result = await runtime.executeRun(plan, "join-artifact-missing-store");
  assert.equal(result.status, "failed");
  assert.equal(calls, 0);
  assert.equal(result.events.some((entry) => entry.type === "run.failing" && entry.data?.code === "ARTIFACT_STORE_REQUIRED"), true);
});
