import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { redactStudioSimulationText, redactStudioSimulationValue } from "../domain/studio-simulation-redaction.mjs";

const TEAM_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const SIMULATION_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

function assertId(value, pattern, field) {
  if (!pattern.test(String(value || ""))) throw new Error(`STUDIO_SIMULATION_${field}_INVALID`);
}

function isNotFound(error) {
  return error?.code === "ENOENT";
}

export function createFileStudioSimulationStore({ projectsRoot, now = () => new Date().toISOString() }) {
  if (!projectsRoot) throw new TypeError("Studio simulation store projects root is required.");
  const root = resolve(projectsRoot);

  function resolveVersionDirectory(teamVersionId) {
    assertId(teamVersionId, TEAM_ID, "TEAM_VERSION_ID");
    const studioRoot = resolve(root, ".studio");
    const simulationsRoot = resolve(studioRoot, "simulations");
    const versionDirectory = resolve(simulationsRoot, teamVersionId);
    if (!studioRoot.startsWith(`${root}${sep}`)
      || !simulationsRoot.startsWith(`${studioRoot}${sep}`)
      || !versionDirectory.startsWith(`${simulationsRoot}${sep}`)) {
      throw new Error("STUDIO_SIMULATION_PATH_OUTSIDE_ROOT");
    }
    return { studioRoot, simulationsRoot, versionDirectory };
  }

  function resolveSimulationDirectory(teamVersionId, simulationId) {
    assertId(simulationId, SIMULATION_ID, "ID");
    const directories = resolveVersionDirectory(teamVersionId);
    const simulationDirectory = resolve(directories.versionDirectory, simulationId);
    if (!simulationDirectory.startsWith(`${directories.versionDirectory}${sep}`)) {
      throw new Error("STUDIO_SIMULATION_PATH_OUTSIDE_VERSION");
    }
    return { ...directories, simulationDirectory };
  }

  async function assertDirectory(path, label, { create = false } = {}) {
    if (create) await mkdir(path, { recursive: false }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`STUDIO_SIMULATION_LINK_NOT_ALLOWED: ${label} must be a real directory.`);
    }
    return true;
  }

  async function assertManagedDirectories(directories, { create = false } = {}) {
    if (create) {
      const rootExists = await assertDirectory(root, "projects root");
      if (!rootExists) await mkdir(root, { recursive: true });
    }
    await assertDirectory(root, "projects root");
    const studioExists = await assertDirectory(directories.studioRoot, ".studio", { create });
    if (!studioExists) return false;
    const simulationsExists = await assertDirectory(directories.simulationsRoot, "simulations", { create });
    if (!simulationsExists) return false;
    return true;
  }

  async function atomicWrite(path, content) {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async function readMetadata(simulationDirectory, expectedTeamVersionId, expectedSimulationId) {
    await assertDirectory(simulationDirectory, "simulation");
    const metadataPath = join(simulationDirectory, "simulation.json");
    try {
      const stats = await lstat(metadataPath);
      if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("STUDIO_SIMULATION_LINK_NOT_ALLOWED: metadata must be a regular file.");
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    let metadata;
    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch (error) {
      if (isNotFound(error)) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
      throw new Error("STUDIO_SIMULATION_METADATA_INVALID");
    }
    if (!metadata || metadata.runKind !== "studio_simulation"
      || metadata.teamVersionId !== expectedTeamVersionId
      || metadata.simulationId !== expectedSimulationId
      || metadata.owner?.kind !== "studio_simulation"
      || metadata.owner?.teamId !== metadata.teamId
      || metadata.owner?.teamVersionId !== expectedTeamVersionId
      || metadata.owner?.simulationId !== expectedSimulationId
      || metadata.owner?.teamCoreDigest !== metadata.teamCoreDigest) {
      throw new Error("STUDIO_SIMULATION_NOT_FOUND");
    }
    return metadata;
  }

  async function readJsonFile(path, fallback) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (isNotFound(error)) return fallback;
      throw new Error("STUDIO_SIMULATION_EVIDENCE_INVALID");
    }
  }

  async function readEvents(simulationDirectory) {
    const eventsPath = join(simulationDirectory, "events.jsonl");
    try {
      const lines = (await readFile(eventsPath, "utf8")).split(/\r?\n/).filter(Boolean);
      return lines.map((line) => JSON.parse(line));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw new Error("STUDIO_SIMULATION_EVENTS_INVALID");
    }
  }

  async function assertSimulationEvidenceFiles(simulationDirectory) {
    for (const name of ["simulation.json", "state.json", "events.jsonl"]) {
      const filePath = join(simulationDirectory, name);
      try {
        const stats = await lstat(filePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          throw new Error("STUDIO_SIMULATION_LINK_NOT_ALLOWED: evidence files must be regular files.");
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
  }

  return Object.freeze({
    async createSimulation(teamVersionId, input, options = {}) {
      const simulationId = options.simulationId || randomUUID();
      assertId(simulationId, SIMULATION_ID, "ID");
      assertId(options.teamId, TEAM_ID, "TEAM_ID");
      if (!/^[a-f0-9]{64}$/i.test(String(options.teamCoreDigest || ""))) {
        throw new Error("STUDIO_SIMULATION_TEAM_DIGEST_INVALID");
      }
      const directories = resolveVersionDirectory(teamVersionId);
      await assertManagedDirectories(directories, { create: true });
      await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace", { create: true });
      const { simulationDirectory } = resolveSimulationDirectory(teamVersionId, simulationId);
      let exists = false;
      try {
        await lstat(simulationDirectory);
        exists = true;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (exists) throw new Error("STUDIO_SIMULATION_ALREADY_EXISTS");

      const createdAt = options.createdAt || now();
      const metadata = redactStudioSimulationValue({
        simulationId,
        runKind: "studio_simulation",
        teamId: options.teamId,
        teamVersionId,
        teamCoreDigest: options.teamCoreDigest,
        teamDigestVersion: Number.isInteger(options.teamDigestVersion) ? options.teamDigestVersion : 1,
        mode: options.mode || "dry-run",
        baselineScenarioId: options.baselineScenarioId || null,
        baselineRevision: Number.isInteger(options.baselineRevision) ? options.baselineRevision : null,
        baselineScenarioDigest: options.baselineScenarioDigest || null,
        expectedRoleIds: Array.isArray(options.expectedRoleIds) ? [...new Set(options.expectedRoleIds.map(String))] : [],
        status: "running",
        input: redactStudioSimulationText(input),
        createdAt,
        startedAt: options.startedAt || createdAt,
        completedAt: null,
        durationMs: null,
        failureSummary: null,
        outputSummary: null,
        owner: {
          kind: "studio_simulation",
          teamId: options.teamId,
          teamVersionId,
          simulationId,
          teamCoreDigest: options.teamCoreDigest,
          teamDigestVersion: Number.isInteger(options.teamDigestVersion) ? options.teamDigestVersion : 1
        }
      });
      const stagingDirectory = join(directories.versionDirectory, `.tmp-${simulationId}-${randomUUID()}`);
      await mkdir(stagingDirectory, { recursive: false });
      try {
        await writeFile(join(stagingDirectory, "simulation.json"), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        await writeFile(join(stagingDirectory, "state.json"), "{}\n", { encoding: "utf8", flag: "wx" });
        await writeFile(join(stagingDirectory, "events.jsonl"), `${JSON.stringify({ type: "simulation.started", at: metadata.startedAt })}\n`, { encoding: "utf8", flag: "wx" });
        await rename(stagingDirectory, simulationDirectory);
      } catch (error) {
        await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return metadata;
    },

    async updateSimulation(teamVersionId, simulationId, update = {}) {
      const directories = resolveSimulationDirectory(teamVersionId, simulationId);
      if (!await assertManagedDirectories(directories)) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
      await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace");
      await assertSimulationEvidenceFiles(directories.simulationDirectory);
      const metadata = await readMetadata(directories.simulationDirectory, teamVersionId, simulationId);
      const nextMetadata = redactStudioSimulationValue({ ...metadata, ...(update.metadata || {}) });
      if (nextMetadata.owner?.teamVersionId !== teamVersionId || nextMetadata.owner?.simulationId !== simulationId) {
        throw new Error("STUDIO_SIMULATION_OWNER_MISMATCH");
      }
      if (update.state !== undefined) {
        await atomicWrite(join(directories.simulationDirectory, "state.json"), `${JSON.stringify(redactStudioSimulationValue(update.state), null, 2)}\n`);
      }
      if (update.events !== undefined) {
        const existing = await readEvents(directories.simulationDirectory);
        const added = Array.isArray(update.events) ? update.events : [update.events];
        const safeEvents = redactStudioSimulationValue([...existing, ...added]);
        await atomicWrite(join(directories.simulationDirectory, "events.jsonl"), safeEvents.map((event) => JSON.stringify(event)).join("\n") + "\n");
      }
      await atomicWrite(join(directories.simulationDirectory, "simulation.json"), `${JSON.stringify(nextMetadata, null, 2)}\n`);
      return nextMetadata;
    },

    async getSimulationEvidence(teamVersionId, simulationId) {
      const directories = resolveSimulationDirectory(teamVersionId, simulationId);
      if (!await assertManagedDirectories(directories)) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
      await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace");
      await assertSimulationEvidenceFiles(directories.simulationDirectory);
      const simulation = await readMetadata(directories.simulationDirectory, teamVersionId, simulationId);
      return {
        simulation,
        state: await readJsonFile(join(directories.simulationDirectory, "state.json"), {}),
        events: await readEvents(directories.simulationDirectory)
      };
    },

    async listVersionSimulations(teamVersionId) {
      const directories = resolveVersionDirectory(teamVersionId);
      if (!await assertManagedDirectories(directories)) return [];
      if (!await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace")) return [];
      const entries = await readdir(directories.versionDirectory, { withFileTypes: true });
      const simulations = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".tmp-")) continue;
        const simulationId = entry.name;
        assertId(simulationId, SIMULATION_ID, "ID");
        const { simulationDirectory } = resolveSimulationDirectory(teamVersionId, simulationId);
        const metadata = await readMetadata(simulationDirectory, teamVersionId, simulationId);
        simulations.push(metadata);
      }
      return simulations.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    },

    async recoverInterruptedSimulations(teamVersionId) {
      const running = (await this.listVersionSimulations(teamVersionId)).filter((item) => item.status === "running");
      const recovered = [];
      for (const item of running) {
        const completedAt = now();
        const message = "Simulation was interrupted when the service stopped.";
        recovered.push(await this.updateSimulation(teamVersionId, item.simulationId, {
          metadata: {
            status: "failed",
            completedAt,
            durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(item.startedAt || item.createdAt)),
            failureSummary: message
          },
          state: { status: "failed", error: message, interrupted: true },
          events: [{ type: "simulation.interrupted", at: completedAt, error: message }]
        }));
      }
      return recovered;
    },

    async cleanupExpiredSimulations({ retentionDays } = {}) {
      if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
        throw new TypeError("Studio Simulation retentionDays must be a positive number.");
      }
      const rootExists = await assertDirectory(root, "projects root");
      if (!rootExists) return { removedCount: 0, removedSimulationIds: [] };
      const studioRoot = resolve(root, ".studio");
      if (!await assertDirectory(studioRoot, ".studio")) return { removedCount: 0, removedSimulationIds: [] };
      const simulationsRoot = resolve(studioRoot, "simulations");
      if (!await assertDirectory(simulationsRoot, "simulations")) return { removedCount: 0, removedSimulationIds: [] };
      const cutoff = Date.parse(now()) - retentionDays * 24 * 60 * 60 * 1000;
      const removedSimulationIds = [];
      for (const versionEntry of await readdir(simulationsRoot, { withFileTypes: true })) {
        assertId(versionEntry.name, TEAM_ID, "TEAM_VERSION_ID");
        const versionDirectory = resolve(simulationsRoot, versionEntry.name);
        await assertDirectory(versionDirectory, "TeamVersion simulation namespace");
        for (const simulationEntry of await readdir(versionDirectory, { withFileTypes: true })) {
          if (simulationEntry.name.startsWith(".tmp-")) continue;
          assertId(simulationEntry.name, SIMULATION_ID, "ID");
          const simulationDirectory = resolve(versionDirectory, simulationEntry.name);
          await assertDirectory(simulationDirectory, "simulation");
          const metadata = await readMetadata(simulationDirectory, versionEntry.name, simulationEntry.name);
          const terminalAt = Date.parse(metadata.completedAt || "");
          if (!Number.isFinite(terminalAt) || terminalAt > cutoff || !["completed", "failed"].includes(metadata.status)) continue;
          await rm(simulationDirectory, { recursive: true, force: false });
          removedSimulationIds.push(metadata.simulationId);
        }
      }
      return { removedCount: removedSimulationIds.length, removedSimulationIds };
    }
  });
}
