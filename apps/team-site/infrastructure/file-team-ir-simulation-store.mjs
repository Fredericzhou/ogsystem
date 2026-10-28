import { mkdir, lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { FileTeamRunStore } from "../../../dist/team-ir/index.js";
import { assertSafeEvidencePath } from "./safe-evidence-path.mjs";
import { redactStudioSimulationValue } from "../domain/studio-simulation-redaction.mjs";

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

function assertId(value) {
  if (!ID.test(String(value || ""))) throw new Error("TEAM_IR_SIMULATION_ID_INVALID");
}

export function createFileTeamIrSimulationStore({ projectsRoot }) {
  if (!projectsRoot) throw new TypeError("Team IR simulation store projects root is required.");
  const root = resolve(projectsRoot);
  const baseSegments = [".studio", "team-ir-v2-simulations"];

  function versionDirectory(teamVersionId) {
    assertId(teamVersionId);
    const base = resolve(root, ".studio", "team-ir-v2-simulations");
    const path = resolve(base, teamVersionId);
    if (!base.startsWith(`${root}${sep}`) || !path.startsWith(`${base}${sep}`)) throw new Error("TEAM_IR_SIMULATION_PATH_UNSAFE");
    return path;
  }

  async function assertDirectory(path, label, create = false) {
    if (create) await mkdir(path, { recursive: true });
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`TEAM_IR_SIMULATION_PATH_UNSAFE: ${label}`);
  }

  async function writeRecord(path, record) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(redactStudioSimulationValue(record), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }

  async function readRecord(path, teamVersionId, simulationId) {
    let stat;
    try { stat = await lstat(path); } catch (error) {
      if (error?.code === "ENOENT") throw new Error("TEAM_IR_SIMULATION_NOT_FOUND");
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("TEAM_IR_SIMULATION_PATH_UNSAFE");
    let record;
    try { record = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("TEAM_IR_SIMULATION_EVIDENCE_INVALID"); }
    if (record?.kind !== "team_ir_v2_simulation" || record.teamVersionId !== teamVersionId || record.simulationId !== simulationId) {
      throw new Error("TEAM_IR_SIMULATION_NOT_FOUND");
    }
    return record;
  }

  function recordPath(teamVersionId, simulationId) {
    assertId(simulationId);
    return join(versionDirectory(teamVersionId), `${simulationId}.json`);
  }

  async function prepareRecordDirectory(record) {
      if (!record || record.kind !== "team_ir_v2_simulation") throw new Error("TEAM_IR_SIMULATION_EVIDENCE_INVALID");
      const directory = versionDirectory(record.teamVersionId);
      await assertDirectory(root, "projects root", true);
      await assertDirectory(resolve(root, ".studio"), ".studio", true);
      await assertDirectory(resolve(root, ".studio", "team-ir-v2-simulations"), "simulation root", true);
      await assertDirectory(directory, "TeamVersion directory", true);
      return recordPath(record.teamVersionId, record.simulationId);
  }

  async function acquireExecutionLock(teamVersionId, simulationId) {
    const directory = versionDirectory(teamVersionId);
    await assertDirectory(root, "projects root", true);
    await assertDirectory(resolve(root, ".studio"), ".studio", true);
    await assertDirectory(resolve(root, ".studio", "team-ir-v2-simulations"), "simulation root", true);
    await assertDirectory(directory, "TeamVersion directory", true);
    const namespace = resolve(directory, simulationId);
    if (!namespace.startsWith(`${directory}${sep}`)) throw new Error("TEAM_IR_SIMULATION_PATH_UNSAFE");
    await assertDirectory(namespace, "simulation execution namespace", true);
    const lock = resolve(namespace, ".execution.lock");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await mkdir(lock);
        await writeFile(resolve(lock, "owner.json"), JSON.stringify({ pid: process.pid, token: randomUUID(), createdAt: Date.now() }), { encoding: "utf8", flag: "wx" });
        await assertSafeEvidencePath(root, [...baseSegments, teamVersionId, simulationId, ".execution.lock"], { kind: "directory", label: "Team IR Simulation execution lock" });
        return async () => rm(lock, { recursive: true, force: true });
      } catch (error) {
        if (error?.code !== "EEXIST") {
          await rm(lock, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
        let owner;
        try {
          owner = JSON.parse(await readFile(resolve(lock, "owner.json"), "utf8"));
        } catch { throw new Error("TEAM_IR_SIMULATION_EXECUTION_IN_PROGRESS"); }
        let ownerAlive = true;
        if (Number.isInteger(owner?.pid)) {
          try { process.kill(owner.pid, 0); }
          catch (ownerError) { ownerAlive = ownerError?.code !== "ESRCH"; }
        }
        if (ownerAlive) throw new Error("TEAM_IR_SIMULATION_EXECUTION_IN_PROGRESS");
        const quarantine = `${lock}.stale.${randomUUID()}`;
        await rename(lock, quarantine).catch((renameError) => {
          if (renameError?.code !== "ENOENT") throw renameError;
        });
        await rm(quarantine, { recursive: true, force: true });
      }
    }
    throw new Error("TEAM_IR_SIMULATION_EXECUTION_IN_PROGRESS");
  }

  return Object.freeze({
    async withExecutionLock(teamVersionId, simulationId, action) {
      assertId(simulationId);
      if (typeof action !== "function") throw new TypeError("Simulation lock requires an action.");
      const release = await acquireExecutionLock(teamVersionId, simulationId);
      try { return await action(); } finally { await release(); }
    },
    async stateDirectory(teamVersionId, simulationId, { create = false } = {}) {
      const directory = versionDirectory(teamVersionId);
      await assertDirectory(root, "projects root");
      await assertDirectory(resolve(root, ".studio"), ".studio");
      await assertDirectory(resolve(root, ".studio", "team-ir-v2-simulations"), "simulation root");
      await assertDirectory(directory, "TeamVersion directory");
      const record = await readRecord(recordPath(teamVersionId, simulationId), teamVersionId, simulationId);
      const simulationDirectory = resolve(directory, simulationId);
      const state = resolve(simulationDirectory, "state");
      if (!simulationDirectory.startsWith(`${directory}${sep}`) || !state.startsWith(`${simulationDirectory}${sep}`)) throw new Error("TEAM_IR_SIMULATION_PATH_UNSAFE");
      await assertDirectory(simulationDirectory, "simulation state namespace", create);
      await assertDirectory(state, "TeamRun checkpoint directory", create);
      return { path: state, record };
    },
    async openRunStore(teamVersionId, simulationId, { create = false } = {}) {
      const { path, record } = await this.stateDirectory(teamVersionId, simulationId, { create });
      const runStore = new FileTeamRunStore(path);
      return Object.freeze({
        async create(run) {
          await assertSafeEvidencePath(root, [...baseSegments, teamVersionId, simulationId, "state", `${run.runId}.json`], {
            kind: "file", allowMissingFinal: true, label: "Team IR Studio Simulation checkpoint"
          });
          return runStore.create(run);
        },
        async load(runId) {
          await assertSafeEvidencePath(root, [...baseSegments, teamVersionId, simulationId, "state", `${runId}.json`], {
            kind: "file", allowMissingFinal: true, label: "Team IR Studio Simulation checkpoint"
          });
          return runStore.load(runId);
        },
        async compareAndSet(runId, revision, run) {
          await assertSafeEvidencePath(root, [...baseSegments, teamVersionId, simulationId, "state", `${runId}.json`], {
            kind: "file", label: "Team IR Studio Simulation checkpoint"
          });
          return runStore.compareAndSet(runId, revision, run);
        }
      });
    },
    async create(record) {
      const path = await prepareRecordDirectory(record);
      const existing = await lstat(path).catch((error) => error?.code === "ENOENT" ? undefined : Promise.reject(error));
      if (existing) throw new Error(existing.isSymbolicLink() || existing.isDirectory() ? "TEAM_IR_SIMULATION_PATH_UNSAFE" : "TEAM_IR_SIMULATION_ALREADY_EXISTS");
      await writeRecord(path, record);
      return record;
    },
    async save(record) {
      const path = await prepareRecordDirectory(record);
      const existing = await readRecord(path, record.teamVersionId, record.simulationId);
      if (existing.createdAt !== record.createdAt || existing.teamIrSemanticDigest !== record.teamIrSemanticDigest
        || existing.compiledPlanDigest !== record.compiledPlanDigest) throw new Error("TEAM_IR_SIMULATION_EVIDENCE_CONFLICT");
      await writeRecord(path, record);
      return record;
    },
    async get(teamVersionId, simulationId) {
      const directory = versionDirectory(teamVersionId);
      await assertDirectory(root, "projects root");
      await assertDirectory(resolve(root, ".studio"), ".studio");
      await assertDirectory(resolve(root, ".studio", "team-ir-v2-simulations"), "simulation root");
      await assertDirectory(directory, "TeamVersion directory");
      return readRecord(recordPath(teamVersionId, simulationId), teamVersionId, simulationId);
    },
    async list(teamVersionId) {
      const directory = versionDirectory(teamVersionId);
      let names;
      try {
        await assertDirectory(root, "projects root");
        await assertDirectory(resolve(root, ".studio"), ".studio");
        await assertDirectory(resolve(root, ".studio", "team-ir-v2-simulations"), "simulation root");
        await assertDirectory(directory, "TeamVersion directory");
        names = await readdir(directory);
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
      const ids = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
      return Promise.all(ids.map((id) => readRecord(recordPath(teamVersionId, id), teamVersionId, id)));
    }
  });
}
