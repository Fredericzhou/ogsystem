import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createFileStudioSimulationStore } from "../infrastructure/file-studio-simulation-store.mjs";

test("Studio Simulation evidence is isolated, redacted, persisted, and owner checked", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-"));
  const store = createFileStudioSimulationStore({ projectsRoot, now: () => "2026-01-02T03:04:05.000Z" });
  try {
    const metadata = await store.createSimulation("team-v1", "input api_key=top-secret", {
      simulationId: "sim-1",
      teamId: "team-root",
      teamCoreDigest: "a".repeat(64)
    });
    const target = join(projectsRoot, ".studio", "simulations", "team-v1", "sim-1");
    assert.equal(metadata.runKind, "studio_simulation");
    assert.equal(metadata.owner.kind, "studio_simulation");
    assert.doesNotMatch(metadata.input, /top-secret/);
    assert.deepEqual((await readdir(target)).sort(), ["events.jsonl", "simulation.json", "state.json"]);
    assert.equal(await readFile(join(target, "simulation.json"), "utf8").then((value) => value.includes("top-secret")), false);

    await store.updateSimulation("team-v1", "sim-1", {
      metadata: { status: "completed", completedAt: "2026-01-02T03:04:06.000Z", outputSummary: "token=super-secret" },
      state: {
        status: "completed",
        finalOutput: "token=super-secret",
        auditTrail: [{ roleId: "analyst", backend: "opencode", modelId: "model-a", profileId: "profile-a", toolRef: "tool.task.execute" }]
      },
      events: [{ type: "simulation.completed", token: "super-secret" }]
    });
    const evidence = await store.getSimulationEvidence("team-v1", "sim-1");
    assert.equal(evidence.simulation.status, "completed");
    assert.deepEqual(evidence.state.auditTrail[0], {
      roleId: "analyst", backend: "opencode", modelId: "model-a", profileId: "profile-a", toolRef: "tool.task.execute"
    });
    assert.doesNotMatch(evidence.simulation.outputSummary, /super-secret/);
    assert.doesNotMatch(JSON.stringify(evidence.state), /super-secret/);
    assert.doesNotMatch(JSON.stringify(evidence.events), /super-secret/);
    assert.deepEqual((await store.listVersionSimulations("team-v1")).map((item) => item.simulationId), ["sim-1"]);
    await assert.rejects(store.getSimulationEvidence("team-v2", "sim-1"), /STUDIO_SIMULATION_NOT_FOUND/);
    assert.deepEqual(await readdir(projectsRoot), [".studio"]);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Simulation path IDs are validated before filesystem access", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-id-"));
  const store = createFileStudioSimulationStore({ projectsRoot });
  try {
    const owner = { teamId: "team-root", teamCoreDigest: "d".repeat(64) };
    await assert.rejects(store.createSimulation("../outside", "prompt", { ...owner, simulationId: "sim-1" }), /TEAM_VERSION_ID_INVALID/);
    await assert.rejects(store.createSimulation("team-v1", "prompt", { ...owner, simulationId: "..\\outside" }), /ID_INVALID/);
    assert.deepEqual(await readdir(projectsRoot), []);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Simulation storage rejects linked namespace and evidence paths", async (t) => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-link-"));
  const outside = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-outside-"));
  const store = createFileStudioSimulationStore({ projectsRoot });
  try {
    try {
      await symlink(outside, join(projectsRoot, ".studio"), "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("directory links are unavailable on this host");
      throw error;
    }
    await assert.rejects(store.createSimulation("team-v1", "input", { simulationId: "sim-1", teamId: "team-1", teamCoreDigest: "e".repeat(64) }), /STUDIO_SIMULATION_LINK_NOT_ALLOWED/);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("Simulation detail refuses linked evidence files before reading them", async (t) => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-evidence-link-"));
  const outside = join(projectsRoot, "outside.json");
  const store = createFileStudioSimulationStore({ projectsRoot });
  try {
    await store.createSimulation("team-v1", "input", { simulationId: "sim-1", teamId: "team-1", teamCoreDigest: "b".repeat(64) });
    const statePath = join(projectsRoot, ".studio", "simulations", "team-v1", "sim-1", "state.json");
    await writeFile(outside, JSON.stringify({ secret: "outside" }));
    await rm(statePath);
    try {
      await symlink(outside, statePath, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("file symlinks are unavailable on this host");
      throw error;
    }
    await assert.rejects(store.getSimulationEvidence("team-v1", "sim-1"), /STUDIO_SIMULATION_LINK_NOT_ALLOWED/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Simulation detail and updates reject a linked TeamVersion namespace", async (t) => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-version-link-"));
  const outside = join(projectsRoot, "outside-version");
  const versionPath = join(projectsRoot, ".studio", "simulations", "team-v1");
  const store = createFileStudioSimulationStore({ projectsRoot });
  try {
    await store.createSimulation("team-v1", "input", { simulationId: "sim-1", teamId: "team-1", teamCoreDigest: "b".repeat(64) });
    await mkdir(outside, { recursive: true });
    await rm(versionPath, { recursive: true, force: true });
    try {
      await symlink(outside, versionPath, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip(`directory links unavailable: ${error.code}`);
      throw error;
    }
    await assert.rejects(store.getSimulationEvidence("team-v1", "sim-1"), /STUDIO_SIMULATION_LINK_NOT_ALLOWED/);
    await assert.rejects(store.updateSimulation("team-v1", "sim-1", { metadata: { status: "failed" } }), /STUDIO_SIMULATION_LINK_NOT_ALLOWED/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("service recovery marks only unfinished Studio Simulations interrupted", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-recovery-"));
  let tick = 0;
  const store = createFileStudioSimulationStore({ projectsRoot, now: () => `2026-01-01T00:00:0${tick++}.000Z` });
  const owner = { teamId: "team-1", teamCoreDigest: "f".repeat(64) };
  try {
    await store.createSimulation("team-v1", "unfinished", { ...owner, simulationId: "sim-running" });
    await store.createSimulation("team-v1", "finished", { ...owner, simulationId: "sim-finished" });
    await store.updateSimulation("team-v1", "sim-finished", { metadata: { status: "completed" } });
    const recovered = await store.recoverInterruptedSimulations("team-v1");
    assert.deepEqual(recovered.map((item) => item.simulationId), ["sim-running"]);
    const evidence = await store.getSimulationEvidence("team-v1", "sim-running");
    assert.equal(evidence.simulation.status, "failed");
    assert.equal(evidence.state.interrupted, true);
    assert.equal(evidence.events.at(-1).type, "simulation.interrupted");
    assert.equal((await store.getSimulationEvidence("team-v1", "sim-finished")).simulation.status, "completed");
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Studio retention deletes only expired terminal Simulations in its own namespace", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-studio-simulation-retention-"));
  let currentTime = "2026-01-31T00:00:00.000Z";
  const store = createFileStudioSimulationStore({ projectsRoot, now: () => currentTime });
  const owner = { teamId: "team-1", teamCoreDigest: "c".repeat(64) };
  try {
    await store.createSimulation("team-v1", "old completed", { ...owner, simulationId: "sim-old" });
    await store.updateSimulation("team-v1", "sim-old", { metadata: { status: "completed", completedAt: "2026-01-01T00:00:00.000Z" } });
    await store.createSimulation("team-v1", "recent completed", { ...owner, simulationId: "sim-recent" });
    await store.updateSimulation("team-v1", "sim-recent", { metadata: { status: "completed", completedAt: "2026-01-30T00:00:00.000Z" } });
    await store.createSimulation("team-v1", "unfinished", { ...owner, simulationId: "sim-running" });

    const result = await store.cleanupExpiredSimulations({ retentionDays: 7 });

    assert.deepEqual(result, { removedCount: 1, removedSimulationIds: ["sim-old"] });
    assert.deepEqual((await store.listVersionSimulations("team-v1")).map((item) => item.simulationId).sort(), ["sim-recent", "sim-running"]);
    assert.equal(await readdir(join(projectsRoot, ".studio", "simulations", "team-v1")).then((items) => items.includes("sim-old")), false);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
