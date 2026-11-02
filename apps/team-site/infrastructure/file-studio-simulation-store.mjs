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
import { assertSafeEvidencePath, readSafeEvidenceFile, resolveSafeEvidencePath } from "./safe-evidence-path.mjs";

const TEAM_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const SIMULATION_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const ARTIFACT_ROOTS = new Set([
  "system.mmd", "request.md", "state.json", "summary.json", "events.ndjson", "timeline.jsonl",
  "audit", "logs", "roles", "checkpoints"
]);
const ARTIFACT_DIRECTORY_ROOTS = new Set(["audit", "logs", "roles", "checkpoints"]);
const TERMINAL_SIMULATION_STATUSES = new Set(["completed", "failed", "stopped"]);

function assertId(value, pattern, field) {
  if (!pattern.test(String(value || ""))) throw new Error(`STUDIO_SIMULATION_${field}_INVALID`);
}

function isNotFound(error) {
  return error?.code === "ENOENT";
}

export function createFileStudioSimulationStore({ projectsRoot, now = () => new Date().toISOString() }) {
  if (!projectsRoot) throw new TypeError("Studio simulation store projects root is required.");
  const root = resolve(projectsRoot);
  const eventWriteLocks = new Map();

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

  function resolveBatchPath(teamVersionId) {
    const directories = resolveVersionDirectory(teamVersionId);
    return { ...directories, batchPath: join(directories.versionDirectory, "batch-latest.json") };
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

  function resolveSimulationRunDirectory(teamVersionId, simulationId) {
    const { simulationDirectory } = resolveSimulationDirectory(teamVersionId, simulationId);
    return resolve(simulationDirectory, "run");
  }

  function artifactSegments(pathValue) {
    const value = String(pathValue || "").replaceAll("\\", "/");
    if (!value || value.startsWith("/") || value.includes("//")) throw new Error("STUDIO_SIMULATION_ARTIFACT_PATH_INVALID");
    const segments = value.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.startsWith("."))) {
      throw new Error("STUDIO_SIMULATION_ARTIFACT_PATH_INVALID");
    }
    if (segments.some((segment) => /^(control|shared|credentials?|secrets?|server\.pid|endpoint\.json)$/i.test(segment))) {
      throw new Error("STUDIO_SIMULATION_ARTIFACT_NOT_ALLOWED");
    }
    if (segments[0] === "roles" && segments[2] === "private") {
      throw new Error("STUDIO_SIMULATION_ARTIFACT_NOT_ALLOWED");
    }
    if (!ARTIFACT_ROOTS.has(segments[0])) throw new Error("STUDIO_SIMULATION_ARTIFACT_NOT_ALLOWED");
    return segments;
  }

  function assertArtifactSegments(segments) {
    if (segments.length > 1 && !ARTIFACT_DIRECTORY_ROOTS.has(segments[0])) {
      throw new Error("STUDIO_SIMULATION_ARTIFACT_NOT_ALLOWED");
    }
  }

  async function assertRunDirectory(runDirectory) {
    await assertSafeEvidencePath(runDirectory, [], { kind: "directory", label: "Simulation run evidence" });
  }

  async function listArtifacts(runDirectory) {
    const entries = [];
    async function visit(relativeSegments) {
      const absolute = resolveSafeEvidencePath(runDirectory, relativeSegments);
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) throw new Error("STUDIO_SIMULATION_LINK_NOT_ALLOWED: artifact links are not allowed.");
      const relativePath = relativeSegments.join("/");
      if (stats.isDirectory()) {
        if (relativePath) entries.push({ path: relativePath, kind: "directory", size: 0, updatedAt: new Date(stats.mtimeMs).toISOString() });
        for (const child of await readdir(absolute, { withFileTypes: true })) {
          const childSegments = [...relativeSegments, child.name];
          if (child.name.startsWith(".") || !ARTIFACT_ROOTS.has(childSegments[0])
            || (childSegments[0] === "roles" && childSegments[2] === "private")) continue;
          await visit(childSegments);
        }
        return;
      }
      if (!stats.isFile()) return;
      entries.push({ path: relativePath, kind: "file", size: stats.size, updatedAt: new Date(stats.mtimeMs).toISOString() });
    }
    for (const rootName of ARTIFACT_ROOTS) {
      const path = resolveSafeEvidencePath(runDirectory, [rootName]);
      try {
        await visit([rootName]);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
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

  async function withEventWriteLock(key, action) {
    const previous = eventWriteLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolvePromise) => { release = resolvePromise; });
    eventWriteLocks.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (eventWriteLocks.get(key) === current) eventWriteLocks.delete(key);
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
    async readLatestBatch(teamVersionId) {
      const directories = resolveBatchPath(teamVersionId);
      if (!await assertManagedDirectories(directories)) return null;
      if (!await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace")) return null;
      const path = directories.batchPath;
      try {
        const stats = await lstat(path);
        if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("STUDIO_SIMULATION_BATCH_INVALID");
        const batch = JSON.parse(await readFile(path, "utf8"));
        if (!batch || batch.teamVersionId !== teamVersionId || typeof batch.batchId !== "string" || typeof batch.status !== "string" || !Array.isArray(batch.items)) {
          throw new Error("STUDIO_SIMULATION_BATCH_INVALID");
        }
        return batch;
      } catch (error) {
        if (isNotFound(error)) return null;
        if (error?.message === "STUDIO_SIMULATION_BATCH_INVALID") throw error;
        throw new Error("STUDIO_SIMULATION_BATCH_INVALID");
      }
    },

    async writeLatestBatch(teamVersionId, batchRecord) {
      if (!batchRecord || batchRecord.teamVersionId !== teamVersionId || typeof batchRecord.batchId !== "string" || typeof batchRecord.status !== "string" || !Array.isArray(batchRecord.items)) {
        throw new Error("STUDIO_SIMULATION_BATCH_INVALID");
      }
      const directories = resolveBatchPath(teamVersionId);
      await assertManagedDirectories(directories, { create: true });
      await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace", { create: true });
      await atomicWrite(directories.batchPath, `${JSON.stringify(redactStudioSimulationValue(batchRecord), null, 2)}\n`);
      return batchRecord;
    },

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
        simulationScenario: options.simulationScenario || null,
        expectedRoleIds: Array.isArray(options.expectedRoleIds) ? [...new Set(options.expectedRoleIds.map(String))] : [],
        roleDisplayNames: options.roleDisplayNames && typeof options.roleDisplayNames === "object"
          ? Object.fromEntries(Object.entries(options.roleDisplayNames).map(([roleId, name]) => [String(roleId), redactStudioSimulationText(name)]))
          : {},
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

    getSimulationRunDirectory(teamVersionId, simulationId) {
      return resolveSimulationRunDirectory(teamVersionId, simulationId);
    },

    async updateSimulation(teamVersionId, simulationId, update = {}) {
      const directories = resolveSimulationDirectory(teamVersionId, simulationId);
      return withEventWriteLock(`${teamVersionId}/${simulationId}`, async () => {
        if (!await assertManagedDirectories(directories)) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
        await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace");
        await assertSimulationEvidenceFiles(directories.simulationDirectory);
        const metadata = await readMetadata(directories.simulationDirectory, teamVersionId, simulationId);
        const currentStatus = String(metadata.status || "");
        const requestedMetadata = update.metadata && typeof update.metadata === "object" ? update.metadata : {};
        const requestedStatus = Object.hasOwn(requestedMetadata, "status") ? String(requestedMetadata.status || "") : currentStatus;
        const effectiveStatus = TERMINAL_SIMULATION_STATUSES.has(currentStatus)
          ? currentStatus
          : currentStatus === "stopping" && requestedStatus === "running"
            ? currentStatus
            : requestedStatus;
        const nextMetadata = redactStudioSimulationValue({
          ...metadata,
          ...requestedMetadata,
          status: effectiveStatus
        });
        if (nextMetadata.owner?.teamVersionId !== teamVersionId || nextMetadata.owner?.simulationId !== simulationId) {
          throw new Error("STUDIO_SIMULATION_OWNER_MISMATCH");
        }
        const currentState = await readJsonFile(join(directories.simulationDirectory, "state.json"), {});
        const proposedState = update.state !== undefined ? redactStudioSimulationValue(update.state) : currentState;
        const nextState = TERMINAL_SIMULATION_STATUSES.has(currentStatus)
          ? { ...(currentState && typeof currentState === "object" && !Array.isArray(currentState) ? currentState : {}), status: effectiveStatus }
          : proposedState && typeof proposedState === "object" && !Array.isArray(proposedState)
            ? { ...proposedState, status: effectiveStatus }
            : { status: effectiveStatus };
        if (update.state !== undefined || currentStatus !== effectiveStatus || currentState?.status !== effectiveStatus) {
          await atomicWrite(join(directories.simulationDirectory, "state.json"), `${JSON.stringify(nextState, null, 2)}\n`);
        }
        if (update.events !== undefined) {
          const existing = await readEvents(directories.simulationDirectory);
          const added = Array.isArray(update.events) ? update.events : [update.events];
          const safeEvents = redactStudioSimulationValue([...existing, ...added]);
          await atomicWrite(join(directories.simulationDirectory, "events.jsonl"), safeEvents.map((event) => JSON.stringify(event)).join("\n") + "\n");
        }
        await atomicWrite(join(directories.simulationDirectory, "simulation.json"), `${JSON.stringify(nextMetadata, null, 2)}\n`);
        return nextMetadata;
      });
    },

    async appendSimulationEvents(teamVersionId, simulationId, events) {
      const directories = resolveSimulationDirectory(teamVersionId, simulationId);
      return withEventWriteLock(`${teamVersionId}/${simulationId}`, async () => {
        if (!await assertManagedDirectories(directories)) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
        await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace");
        await assertSimulationEvidenceFiles(directories.simulationDirectory);
        await readMetadata(directories.simulationDirectory, teamVersionId, simulationId);
        const existing = await readEvents(directories.simulationDirectory);
        const added = Array.isArray(events) ? events : [events];
        const safeEvents = redactStudioSimulationValue([...existing, ...added]);
        await atomicWrite(join(directories.simulationDirectory, "events.jsonl"), safeEvents.map((event) => JSON.stringify(event)).join("\n") + "\n");
        return safeEvents.length;
      });
    },

    async clearInteractiveSimulations(teamVersionId) {
      const directories = resolveVersionDirectory(teamVersionId);
      if (!await assertManagedDirectories(directories)) return { removedCount: 0, removedSimulationIds: [] };
      if (!await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace")) return { removedCount: 0, removedSimulationIds: [] };
      const removedSimulationIds = [];
      for (const entry of await readdir(directories.versionDirectory, { withFileTypes: true })) {
        if (entry.name === "batch-latest.json" || entry.name.startsWith(".tmp-") || entry.name.endsWith(".tmp")) continue;
        assertId(entry.name, SIMULATION_ID, "ID");
        const { simulationDirectory } = resolveSimulationDirectory(teamVersionId, entry.name);
        await assertDirectory(simulationDirectory, "simulation");
        const metadata = await readMetadata(simulationDirectory, teamVersionId, entry.name);
        if (metadata.mode === "sandbox" || metadata.baselineScenarioId || !["completed", "failed", "stopped"].includes(metadata.status)) continue;
        await rm(simulationDirectory, { recursive: true, force: false });
        removedSimulationIds.push(metadata.simulationId);
      }
      return { removedCount: removedSimulationIds.length, removedSimulationIds };
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

    async listSimulationArtifacts(teamVersionId, simulationId) {
      const directories = resolveSimulationDirectory(teamVersionId, simulationId);
      if (!await assertManagedDirectories(directories)) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
      await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace");
      await readMetadata(directories.simulationDirectory, teamVersionId, simulationId);
      const runDirectory = resolveSimulationRunDirectory(teamVersionId, simulationId);
      try {
        await assertRunDirectory(runDirectory);
      } catch (error) {
        if (error?.code === "ENOENT") return { root: "run", entries: [] };
        throw error;
      }
      return { root: "run", entries: await listArtifacts(runDirectory) };
    },

    async readSimulationArtifact(teamVersionId, simulationId, pathValue, { maxBytes = 1024 * 1024 } = {}) {
      const directories = resolveSimulationDirectory(teamVersionId, simulationId);
      if (!await assertManagedDirectories(directories)) throw new Error("STUDIO_SIMULATION_NOT_FOUND");
      await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace");
      await readMetadata(directories.simulationDirectory, teamVersionId, simulationId);
      const segments = artifactSegments(pathValue);
      assertArtifactSegments(segments);
      const runDirectory = resolveSimulationRunDirectory(teamVersionId, simulationId);
      const target = await assertSafeEvidencePath(runDirectory, segments, { kind: "file", label: "Simulation artifact" });
      const stats = await lstat(target);
      if (stats.size > maxBytes) {
        return { path: segments.join("/"), size: stats.size, updatedAt: new Date(stats.mtimeMs).toISOString(), tooLarge: true };
      }
      const content = await readSafeEvidenceFile(runDirectory, segments, "utf8", "Simulation artifact");
      return { path: segments.join("/"), size: stats.size, updatedAt: new Date(stats.mtimeMs).toISOString(), content };
    },

    async listVersionSimulations(teamVersionId) {
      const directories = resolveVersionDirectory(teamVersionId);
      if (!await assertManagedDirectories(directories)) return [];
      if (!await assertDirectory(directories.versionDirectory, "TeamVersion simulation namespace")) return [];
      const entries = await readdir(directories.versionDirectory, { withFileTypes: true });
      const simulations = [];
      for (const entry of entries) {
        if (entry.name === "batch-latest.json" || entry.name.startsWith(".tmp-") || entry.name.endsWith(".tmp")) continue;
        const simulationId = entry.name;
        assertId(simulationId, SIMULATION_ID, "ID");
        const { simulationDirectory } = resolveSimulationDirectory(teamVersionId, simulationId);
        const metadata = await readMetadata(simulationDirectory, teamVersionId, simulationId);
        simulations.push(metadata);
      }
      return simulations.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    },

    async recoverInterruptedSimulations(teamVersionId) {
      const unfinished = (await this.listVersionSimulations(teamVersionId)).filter((item) => ["running", "stopping"].includes(item.status));
      const recovered = [];
      for (const item of unfinished) {
        const completedAt = now();
        const stopping = item.status === "stopping";
        const message = stopping
          ? "Simulation stop was accepted before the service stopped."
          : "Simulation was interrupted when the service stopped.";
        recovered.push(await this.updateSimulation(teamVersionId, item.simulationId, {
          metadata: {
            status: stopping ? "stopped" : "failed",
            completedAt,
            durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(item.startedAt || item.createdAt)),
            ...(stopping ? {} : { failureSummary: message })
          },
          state: stopping
            ? { status: "stopped", stopRecovered: true }
            : { status: "failed", error: message, interrupted: true },
          events: [{ type: stopping ? "simulation.stopped" : "simulation.interrupted", at: completedAt, ...(stopping ? { reason: message } : { error: message }) }]
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
          if (simulationEntry.name === "batch-latest.json" || simulationEntry.name.startsWith(".tmp-") || simulationEntry.name.endsWith(".tmp")) continue;
          assertId(simulationEntry.name, SIMULATION_ID, "ID");
          const simulationDirectory = resolve(versionDirectory, simulationEntry.name);
          await assertDirectory(simulationDirectory, "simulation");
          const metadata = await readMetadata(simulationDirectory, versionEntry.name, simulationEntry.name);
          const terminalAt = Date.parse(metadata.completedAt || "");
          if (!Number.isFinite(terminalAt) || terminalAt > cutoff || !["completed", "failed", "stopped"].includes(metadata.status)) continue;
          await rm(simulationDirectory, { recursive: true, force: false });
          removedSimulationIds.push(metadata.simulationId);
        }
      }
      return { removedCount: removedSimulationIds.length, removedSimulationIds };
    }
  });
}
