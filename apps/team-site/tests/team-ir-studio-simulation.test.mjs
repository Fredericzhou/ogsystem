import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { compileTeamIr, FileTeamArtifactStore, FileTeamRunStore, MemoryTeamRunStore, TeamRuntime, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { createTeamIrStudioSimulationUseCases } from "../application/team-ir-studio-simulation-use-cases.mjs";
import { createFileTeamIrSimulationStore } from "../infrastructure/file-team-ir-simulation-store.mjs";
import { createRuntimeTeamIrStudioSimulation } from "../infrastructure/runtime-team-ir-studio-simulation.mjs";

const fixtureUrl = new URL("../../../examples/team-ir-v2/classic-software-team.json", import.meta.url);
const closure = {
  complete: true,
  packageDigests: Object.fromEntries(["planner", "implementer", "tester", "lead"].map((id) => [`role:software-${id}@1`, "a".repeat(64)])),
  bindingDigests: Object.fromEntries(["planner", "implementer", "tester", "lead"].map((id) => [`binding:${id}`, "b".repeat(64)])),
  adapterVersions: { model: "team-runtime-test/1" },
  schemaDigests: {}
};

async function makeHarness(t, overrides = {}) {
  const { teamIR: suppliedTeamIR, ...useCaseOverrides } = overrides;
  const projectsRoot = await mkdtemp(resolve(tmpdir(), "ogs-team-ir-simulation-"));
  t.after(() => rm(projectsRoot, { recursive: true, force: true }));
  const teamIR = suppliedTeamIR || JSON.parse(await readFile(fixtureUrl, "utf8"));
  const semanticDigest = teamIRSemanticDigest(teamIR);
  const plan = compileTeamIr(teamIR, closure);
  const team = { teamVersionId: "classic-v2", teamId: "classic-v2", teamVersionStatus: "draft", workdir: "/team/classic-v2" };
  const outputs = {
    planner: { event: "PLAN", data: { plan: "Implement safely" } },
    implementer: { event: "IMPLEMENTED", data: { changes: "code changed" } },
    tester: { event: "TESTED", data: { tests: "all passed" } },
    lead: { event: "DELIVERED", data: { summary: "done" } }
  };
  const simulationStore = createFileTeamIrSimulationStore({ projectsRoot });
  const useCases = createTeamIrStudioSimulationUseCases({
    teamCatalog: { async getTeamVersion() { return team; } },
    teamIrStore: { async read() { return { teamIR, semanticDigest }; } },
    simulationStore,
    artifactStoreFactory: async ({ teamVersionId }) => new FileTeamArtifactStore(resolve(projectsRoot, ".studio", "team-ir-v2-simulation-artifacts", teamVersionId)),
    resolveReleaseClosure: async () => closure,
    resolveBindings: async () => Object.fromEntries(Object.entries(outputs).map(([agentId, output]) => [`binding:${agentId}`, {
      async invoke() { return { kind: "completed", output }; }
    }])),
    identifiers: { simulationId: () => "sim-1", artifactScopeId: (_teamVersionId, scopeId) => (scopeId.startsWith("different") ? "b" : "a").repeat(48) },
    clock: { now: (() => { let value = 100; return () => value++; })(), sleep: async () => undefined },
    simulationRunner: createRuntimeTeamIrStudioSimulation({ clock: { now: () => 100, sleep: async () => undefined } }),
    ...useCaseOverrides
  });
  return { projectsRoot, teamIR, semanticDigest, plan, simulationStore, useCases };
}

test("Team IR v2 Studio Simulation executes the native plan and persists digest-bound, redacted evidence", async (t) => {
  const h = await makeHarness(t);
  const simulation = await h.useCases.createSimulation("classic-v2", {
    task: "Ship a feature",
    input: { request: "Build a feature" },
    preferences: { apiKey: "sk-secret-key-value" }
  });
  assert.equal(simulation.kind, "team_ir_v2_simulation");
  assert.equal(simulation.mode, "sandbox");
  assert.equal(simulation.status, "completed", JSON.stringify(simulation));
  assert.equal(simulation.teamIrSemanticDigest, h.semanticDigest);
  assert.equal(simulation.compiledPlanDigest, h.plan.compiledPlanDigest);
  assert.deepEqual(simulation.result, { summary: "done" });
  assert.equal(simulation.run.resultWritten, true);
  assert.equal(simulation.events.filter((event) => event.type === "simulation.completed").length, 1);
  assert.equal(JSON.stringify(simulation).includes("sk-secret-key-value"), false);
  const disk = await readFile(resolve(h.projectsRoot, ".studio", "team-ir-v2-simulations", "classic-v2", "sim-1.json"), "utf8");
  assert.equal(disk.includes("sk-secret-key-value"), false);
  const verified = await h.useCases.validateReleaseEvidence({
    teamVersionId: "classic-v2", teamIrSemanticDigest: h.semanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.simulationId, "sim-1");
});

test("Team IR v2 Simulation refuses unavailable or incomplete frozen resolvers before creating evidence", async (t) => {
  const h = await makeHarness(t, { resolveReleaseClosure: undefined, resolveBindings: undefined });
  await assert.rejects(h.useCases.createSimulation("classic-v2", { input: { request: "test" } }), /TEAM_IR_V2_SIMULATION_UNAVAILABLE/);
  assert.deepEqual(await h.useCases.listSimulations("classic-v2"), { simulations: [] });
});

test("Studio Simulation Artifact input is isolated by artifact scope and limited to declared Agent inputs", async (t) => {
  const teamIR = JSON.parse(await readFile(fixtureUrl, "utf8"));
  teamIR.runInput.artifactSlots.brief = { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" };
  const planner = teamIR.agents.find((agent) => agent.id === "planner");
  planner.inputPorts.default.artifactSlots = { sources: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } };
  teamIR.handoffs.find((handoff) => handoff.id === "run-to-planner").map.artifacts = {
    sources: { $ref: "$.run.attachments.brief" }
  };
  let registeredReference;
  let invocationRead = false;
  const outputs = {
    planner: { event: "PLAN", data: { plan: "Use source" } },
    implementer: { event: "IMPLEMENTED", data: { changes: "code changed" } },
    tester: { event: "TESTED", data: { tests: "all passed" } },
    lead: { event: "DELIVERED", data: { summary: "done" } }
  };
  const runtimeClock = {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("TEAM_RUNTIME_SLEEP_ABORTED"));
      }, { once: true });
    })
  };
  const h = await makeHarness(t, {
    teamIR,
    simulationRunner: createRuntimeTeamIrStudioSimulation({ clock: runtimeClock }),
    async resolveBindings({ teamIR: resolvedTeamIR }) {
      return Object.fromEntries(resolvedTeamIR.agents.map((agent) => [agent.bindingRef, {
        async invoke(invocation) {
          if (agent.id === "planner") {
            assert.deepEqual(invocation.input.artifacts.sources, { artifactId: registeredReference.artifactId, mediaType: registeredReference.mediaType });
            assert.equal(Buffer.from(await invocation.artifactResolver.read(registeredReference.artifactId)).toString(), "Sandbox-only input");
            await assert.rejects(invocation.artifactResolver.read(`art_${"f".repeat(36)}`), /Allowed Artifact Set/);
            invocationRead = true;
          }
          return { kind: "completed", output: outputs[agent.id] };
        }
      }]));
    }
  });
  const artifactScopeId = "sandbox-session-1";
  registeredReference = await h.useCases.registerSimulationInputArtifact("classic-v2", {
    artifactScopeId, slotId: "brief", mediaType: "text/plain", contentBase64: Buffer.from("Sandbox-only input").toString("base64")
  });
  const reference = { artifactId: registeredReference.artifactId, mediaType: registeredReference.mediaType };
  await assert.rejects(h.useCases.createSimulation("classic-v2", {
    input: { request: "Use the input" }, attachments: { brief: reference }, artifactScopeId: "different-sandbox"
  }), (error) => error.code === "ARTIFACT_ACCESS_DENIED");
  const simulation = await h.useCases.createSimulation("classic-v2", {
    input: { request: "Use the input" }, attachments: { brief: reference }, artifactScopeId
  });
  assert.equal(simulation.status, "completed", JSON.stringify(simulation));
  assert.equal(invocationRead, true);
  assert.deepEqual(simulation.run.runInput.attachments, { brief: reference });

  const isolatedStore = new FileTeamArtifactStore(resolve(h.projectsRoot, ".studio", "different-artifact-store", "classic-v2"));
  await assert.rejects(isolatedStore.createInvocationResolver({
    owner: { projectId: "studio-artifact-isolated", runId: simulation.simulationId }, allowedArtifacts: [reference]
  }), (error) => error.code === "ARTIFACT_REFERENCE_INVALID");
});

test("legacy Team Package simulation evidence cannot satisfy Team IR v2 release evidence", async (t) => {
  const h = await makeHarness(t);
  await h.useCases.createSimulation("classic-v2", { input: { request: "test" } });
  await assert.rejects(h.useCases.validateReleaseEvidence({
    teamVersionId: "classic-v2", teamIrSemanticDigest: h.semanticDigest, compiledPlanDigest: "c".repeat(64)
  }), /TEAM_IR_V2_RELEASE_EVIDENCE_REQUIRED/);
});

test("Studio Sandbox Simulation auto-approves Review gates and completes a Maker-Checker Loop", async () => {
  const teamIR = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-maker-checker.json", import.meta.url), "utf8"));
  const simulationClosure = {
    packageDigests: Object.fromEntries(teamIR.agents.map((agent) => [agent.packageRef, "a".repeat(64)])),
    bindingDigests: Object.fromEntries(teamIR.bindings.map((binding) => [binding.id, "b".repeat(64)])),
    adapterVersions: { model: "team-runtime-test/1" },
    schemaDigests: {}
  };
  const plan = compileTeamIr(teamIR, simulationClosure);
  const bindings = Object.fromEntries(teamIR.agents.map((agent) => [agent.bindingRef, {
    async invoke() { return { kind: "completed", output: { event: "DONE", data: { answer: "Release proposal", again: false } } }; }
  }]));
  const run = await createRuntimeTeamIrStudioSimulation({ clock: { now: () => 100, sleep: async () => undefined } }).execute({
    plan,
    bindings,
    store: new MemoryTeamRunStore(),
    simulationId: "maker-checker-simulation",
    teamIR,
    input: { request: "Review a controlled release plan." },
    task: "Maker-Checker simulation",
    preferences: {},
    attachments: {},
    createRun: true
  });

  assert.equal(run.status, "completed", JSON.stringify(run.events.filter((event) => event.type === "run.failing")));
  assert.equal(run.resultWritten, true);
  assert.deepEqual(run.result, { answer: "Release proposal" });
  assert.equal(run.events.filter((event) => event.type === "run.review.approved").length, 1);
  assert.equal(run.events.filter((event) => event.type === "run.waiting_human_review").length, 1);
});

test("restarting a Studio Simulation resumes from its checkpoint and fails closed on an unknown active invocation", async (t) => {
  let invocationCount = 0;
  let cancelCount = 0;
  const h = await makeHarness(t);
  await h.simulationStore.create({
    kind: "team_ir_v2_simulation", simulationId: "sim-1", runId: "sim-1", teamVersionId: "classic-v2",
    teamIrSemanticDigest: h.semanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest,
    compilerSemanticsVersion: h.plan.compilerSemanticsVersion, status: "running", mode: "sandbox",
    createdAt: 100, updatedAt: 100, input: { request: "Build a feature" }, preferences: {}, attachments: {},
    task: "restart test", result: null, events: [{ type: "simulation.started", at: 100 }]
  });
  const { path } = await h.simulationStore.stateDirectory("classic-v2", "sim-1", { create: true });
  const checkpoint = new FileTeamRunStore(path);
  const seedRuntime = new TeamRuntime({
    store: checkpoint, clock: { now: () => 100, sleep: async () => undefined }, bindings: {}
  });
  await seedRuntime.createRun(h.plan, { runId: "sim-1", projectId: "studio-sim-1", task: "restart test", input: { request: "Build a feature" } });
  await seedRuntime.claim("sim-1", h.plan.compiledPlanDigest);
  const running = await checkpoint.load("sim-1");
  running.scheduler = { pending: ["run-to-planner"], sources: {}, skippedHandoffs: [], arrivedHandoffs: [], visited: {}, invocationIds: {} };
  running.invocations["sim-1:run-to-planner"] = {
    id: "sim-1:run-to-planner", handoffId: "run-to-planner", agentId: "planner", bindingId: "binding:planner",
    status: "running", deadlineAt: 180100, attempt: 1
  };
  running.revision += 1;
  await checkpoint.compareAndSet("sim-1", running.revision - 1, running);
  const restartedUseCases = createTeamIrStudioSimulationUseCases({
    teamCatalog: { async getTeamVersion() { return { teamVersionId: "classic-v2", teamId: "classic-v2", teamVersionStatus: "draft", workdir: "/team/classic-v2" }; } },
    teamIrStore: { async read() { return { teamIR: h.teamIR, semanticDigest: h.semanticDigest }; } },
    simulationStore: createFileTeamIrSimulationStore({ projectsRoot: h.projectsRoot }),
    artifactStoreFactory: async ({ teamVersionId }) => new FileTeamArtifactStore(resolve(h.projectsRoot, ".studio", "team-ir-v2-simulation-artifacts", teamVersionId)),
    resolveReleaseClosure: async () => closure,
    resolveBindings: async () => Object.fromEntries(["planner", "implementer", "tester", "lead"].map((agentId) => [`binding:${agentId}`, {
      async invoke() { invocationCount += 1; throw new Error("must not replay unknown invocation"); },
      async cancel() { cancelCount += 1; return true; }
    }])),
    identifiers: { simulationId: () => "different-sim-id", artifactScopeId: (_teamVersionId, scopeId) => (scopeId.startsWith("different") ? "b" : "a").repeat(48) },
    clock: { now: () => 200, sleep: async () => undefined },
    simulationRunner: createRuntimeTeamIrStudioSimulation({ clock: { now: () => 200, sleep: async () => undefined } })
  });
  const recovered = await restartedUseCases.recoverInterruptedSimulations("classic-v2");
  assert.equal(recovered.recoveredCount, 1);
  assert.equal(recovered.simulations[0].status, "failed", JSON.stringify(recovered));
  assert.equal(recovered.simulations[0].run.events.some((event) => event.type === "binding.outcome_unknown"), true, JSON.stringify(recovered.simulations[0]));
  assert.equal(cancelCount, 1);
  assert.equal(invocationCount, 0);
  await assert.rejects(restartedUseCases.validateReleaseEvidence({
    teamVersionId: "classic-v2", teamIrSemanticDigest: h.semanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  }), /TEAM_IR_V2_RELEASE_EVIDENCE_REQUIRED/);
});

test("restart replay reuses committed upstream output and does not invoke the completed Binding again", async (t) => {
  const h = await makeHarness(t);
  await h.simulationStore.create({
    kind: "team_ir_v2_simulation", simulationId: "sim-1", runId: "sim-1", teamVersionId: "classic-v2",
    teamIrSemanticDigest: h.semanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest,
    compilerSemanticsVersion: h.plan.compilerSemanticsVersion, status: "running", mode: "sandbox",
    createdAt: 100, updatedAt: 100, input: { request: "Build a feature" }, preferences: {}, attachments: {},
    task: "restart replay", result: null, events: [{ type: "simulation.started", at: 100 }]
  });
  const { path } = await h.simulationStore.stateDirectory("classic-v2", "sim-1", { create: true });
  const checkpoint = new FileTeamRunStore(path);
  const runtime = new TeamRuntime({ store: checkpoint, clock: { now: () => 100, sleep: async () => undefined }, bindings: {} });
  await runtime.createRun(h.plan, { runId: "sim-1", projectId: "studio-sim-1", task: "restart replay", input: { request: "Build a feature" } });
  await runtime.claim("sim-1", h.plan.compiledPlanDigest);
  const running = await checkpoint.load("sim-1");
  running.scheduler = {
    pending: ["planner-to-implementer", "planner-to-tester"],
    sources: { "agent:planner:PLAN": { event: "PLAN", data: { plan: "Implement safely" } } },
    skippedHandoffs: [], arrivedHandoffs: ["run-to-planner"], visited: { "run-to-planner": 1 }, invocationIds: {}
  };
  running.invocations["sim-1:run-to-planner"] = {
    id: "sim-1:run-to-planner", handoffId: "run-to-planner", agentId: "planner", bindingId: "binding:planner",
    status: "completed", deadlineAt: 180100, attempt: 1,
    output: { kind: "completed", output: { event: "PLAN", data: { plan: "Implement safely" } } }
  };
  running.revision += 1;
  await checkpoint.compareAndSet("sim-1", running.revision - 1, running);

  const invocations = [];
  const recovery = createTeamIrStudioSimulationUseCases({
    teamCatalog: { async getTeamVersion() { return { teamVersionId: "classic-v2", teamId: "classic-v2", teamVersionStatus: "draft", workdir: "/team/classic-v2" }; } },
    teamIrStore: { async read() { return { teamIR: h.teamIR, semanticDigest: h.semanticDigest }; } },
    simulationStore: createFileTeamIrSimulationStore({ projectsRoot: h.projectsRoot }),
    artifactStoreFactory: async ({ teamVersionId }) => new FileTeamArtifactStore(resolve(h.projectsRoot, ".studio", "team-ir-v2-simulation-artifacts", teamVersionId)),
    resolveReleaseClosure: async () => closure,
    resolveBindings: async () => Object.fromEntries(Object.entries({
      planner: { event: "PLAN", data: { plan: "unexpected duplicate" } },
      implementer: { event: "IMPLEMENTED", data: { changes: "code changed" } },
      tester: { event: "TESTED", data: { tests: "all passed" } },
      lead: { event: "DELIVERED", data: { summary: "done" } }
    }).map(([agentId, output]) => [`binding:${agentId}`, {
      async invoke() { invocations.push(agentId); return { kind: "completed", output }; }
    }])),
    identifiers: { simulationId: () => "unused", artifactScopeId: () => "a".repeat(48) },
    clock: { now: () => 200, sleep: async () => undefined },
    simulationRunner: createRuntimeTeamIrStudioSimulation({ clock: { now: () => 200, sleep: async () => undefined } })
  });
  const recovered = await recovery.recoverInterruptedSimulations("classic-v2");
  assert.equal(recovered.recoveredCount, 1);
  assert.equal(recovered.simulations[0].status, "completed", JSON.stringify(recovered));
  assert.equal(recovered.simulations[0].run.resultWritten, true);
  assert.equal(invocations.includes("planner"), false);
  assert.deepEqual(invocations.sort(), ["implementer", "lead", "tester"]);
});
