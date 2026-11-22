import { readFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { loadProjectRunPlan } from "../../../dist/runtime/project-run.js";
import { loadProjectRunState } from "../../../dist/runtime/project-run-state.js";
import { loadRunEventsSnapshot } from "../../../dist/visualizer/run-query-service.js";
import { assertEvidenceManifest } from "../../../dist/runtime/workspace-contracts.js";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath, readSafeEvidenceFile } from "./safe-evidence-path.mjs";
import { projectOgsDir } from "./project-paths.mjs";
import { isRuntimeBusinessEvent } from "./runtime-business-event-types.mjs";

function assertSafeId(value, field, pattern) {
  if (!pattern.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

export function createFileRunQueryStore({ projectsRoot }) {
  if (!projectsRoot) throw new TypeError("Run query store projects root is required.");
  const root = resolve(projectsRoot);

  function resolveRunDirectory(projectId, runId) {
    assertSafeId(projectId, "projectId", /^[a-z0-9][a-z0-9-]{0,80}$/);
    assertSafeId(runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    const projectRoot = resolve(root, projectId);
    if (!projectRoot.startsWith(`${root}${sep}`)) throw new Error("Run query path is outside the site workspace.");
    const controlRoot = projectOgsDir({ workdir: projectRoot });
    const runDir = resolve(controlRoot, ".ogs", "runs", runId);
    if (!runDir.startsWith(`${controlRoot}${sep}`)) throw new Error("Run query path is outside the project control root.");
    return { projectRoot, controlRoot, runDir };
  }

  async function assertProjectExists(projectRoot, projectId) {
    try {
      await assertSafeEvidencePath(root, [projectId], { kind: "directory", label: "Project" });
      await assertSafeEvidencePath(root, [projectId, ".site"], { kind: "directory", label: "Project metadata" });
      await assertSafeEvidencePath(root, [projectId, ".site", "project.json"], { kind: "file", label: "Project metadata" });
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error("Project not found.");
      throw error;
    }
    try {
      const metadata = JSON.parse(await readFile(join(projectRoot, ".site", "project.json"), "utf8"));
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("invalid metadata");
      return metadata;
    } catch {
      throw new Error("Project not found.");
    }
  }

  async function readTaskOwner(projectRoot, projectId, taskId, runId) {
    const metadata = await assertProjectExists(projectRoot, projectId);
    if (metadata.projectType !== "collaboration") throw new Error("RUN_NOT_FOUND: Task Runs are owned by Collaboration Projects.");
    if (typeof metadata.workspaceId !== "string" || !metadata.workspaceId.trim() || metadata.workspaceBackend !== "git-lfs") {
      throw new Error("Collaboration Project requires a Git LFS Workspace binding.");
    }
    const task = (metadata.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
    if (!task) throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task.");
    const workspaceDir = typeof metadata.workspaceDir === "string" ? resolve(projectRoot, metadata.workspaceDir) : projectRoot;
    return readProjectRunOwner({ projectId, workdir: projectRoot, ogsDir: projectRoot, workspaceDir }, task, runId);
  }

  async function readEvidenceManifest(controlRoot, runId) {
    const segments = [".ogs", "runs", runId, "evidence-manifest.json"];
    await assertSafeEvidencePath(controlRoot, segments, { kind: "file", label: "Run Evidence manifest" });
    const manifest = JSON.parse(await readSafeEvidenceFile(controlRoot, segments, "utf8", "Run Evidence manifest"));
    try { assertEvidenceManifest(manifest); }
    catch { throw new Error("RUN_EVIDENCE_MANIFEST_INVALID: Evidence manifest is invalid."); }
    if (manifest.runId !== runId || manifest.manifestId !== `${runId}:evidence`) {
      throw new Error("RUN_EVIDENCE_MANIFEST_INVALID: Evidence manifest identity does not match its Run.");
    }
    const references = [
      ...manifest.eventRefs.map((ref) => ({ ref, prefix: "events.ndjson#", category: "event" })),
      ...manifest.checkpointRefs.map((ref) => ({ ref, prefix: "", category: "checkpoint" })),
      ...manifest.provenanceRefs.map((ref) => ({ ref, prefix: "provenance/", category: "provenance" })),
      ...manifest.reviewRefs.map((ref) => ({ ref, prefix: "control/reviews/", category: "review" }))
    ];
    const eventIds = new Set();
    if (manifest.eventRefs.length > 0) {
      const eventSegments = [".ogs", "runs", runId, "events.ndjson"];
      await assertSafeEvidencePath(controlRoot, eventSegments, { kind: "file", label: "Run event reference" });
      const eventFile = await readSafeEvidenceFile(controlRoot, eventSegments, "utf8", "Run event reference");
      for (const line of eventFile.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); }
        catch { throw new Error("RUN_EVIDENCE_MANIFEST_INVALID: Run event file is malformed."); }
        if (event?.runId === runId && typeof event.eventId === "string" && event.eventId) eventIds.add(event.eventId);
      }
    }
    for (const { ref, prefix, category } of references) {
      if (typeof ref !== "string" || !ref || ref.includes("\\") || ref.startsWith("/") || ref.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("RUN_EVIDENCE_MANIFEST_INVALID: Evidence reference path is unsafe.");
      }
      if (category === "event") {
        const [path, encodedEventId, extra] = ref.split("#");
        let eventId;
        try { eventId = decodeURIComponent(encodedEventId || ""); }
        catch { throw new Error("RUN_EVIDENCE_MANIFEST_INVALID: Event reference is malformed."); }
        if (path !== "events.ndjson" || !eventId || extra !== undefined) throw new Error("RUN_EVIDENCE_MANIFEST_INVALID: Event reference is malformed.");
        if (!eventIds.has(eventId)) throw new Error("RUN_EVIDENCE_MANIFEST_REFERENCE_NOT_FOUND: Event reference does not resolve.");
      } else {
        if (prefix && !ref.startsWith(prefix)) throw new Error("RUN_EVIDENCE_MANIFEST_INVALID: Evidence reference has the wrong category.");
        if (category === "checkpoint" && !ref.startsWith("checkpoints/") && !ref.startsWith("workspace/checkpoints/")) throw new Error("RUN_EVIDENCE_MANIFEST_INVALID: Checkpoint reference has the wrong category.");
        await assertSafeEvidencePath(controlRoot, [".ogs", "runs", runId, ...ref.split("/")], { kind: "file", label: "Run Evidence reference" });
      }
    }
    return manifest;
  }

  return Object.freeze({
    async readRunOwner(projectId, taskId, runId) {
      const { projectRoot, controlRoot } = resolveRunDirectory(projectId, runId);
      return readTaskOwner(projectRoot, projectId, taskId, runId);
    },
    async readRunState(projectId, taskId, runId) {
      const { projectRoot, controlRoot, runDir } = resolveRunDirectory(projectId, runId);
      await readTaskOwner(projectRoot, projectId, taskId, runId);
      await assertSafeEvidencePath(controlRoot, [".ogs", "runs", runId, "control", "state.json"], { kind: "file", label: "Run state" });
      return loadProjectRunState(runDir);
    },
    async readRunPlan(projectId, taskId, runId) {
      const { projectRoot, controlRoot, runDir } = resolveRunDirectory(projectId, runId);
      await readTaskOwner(projectRoot, projectId, taskId, runId);
      try {
        await assertSafeEvidencePath(controlRoot, [".ogs", "runs", runId, "run-plan.json"], { kind: "file", label: "Run plan" });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return loadProjectRunPlan(runDir).catch(() => undefined);
    },
    async readRunEvents(projectId, taskId, runId, options = {}) {
      const { projectRoot, controlRoot } = resolveRunDirectory(projectId, runId);
      await readTaskOwner(projectRoot, projectId, taskId, runId);
      for (const file of ["timeline.jsonl", "events.ndjson"]) {
        try {
          await assertSafeEvidencePath(controlRoot, [".ogs", "runs", runId, file], { kind: "file", label: "Run events" });
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      const requestedLimit = Number.isFinite(options.limit) ? Math.min(1000, Math.max(1, Math.floor(options.limit))) : 200;
      let cursor = Number.isFinite(options.cursor) ? Math.max(0, Math.floor(options.cursor)) : 0;
      const events = [];
      let nextCursor = cursor;
      do {
        const snapshot = await loadRunEventsSnapshot({
          ...options,
          cursor,
          limit: 1000,
          workdir: controlRoot,
          runId
        });
        for (const entry of snapshot.events || []) {
          if (isRuntimeBusinessEvent(entry.record)) events.push(entry);
          if (events.length >= requestedLimit) break;
        }
        const batch = snapshot.events || [];
        const lastReadCursor = batch.length ? batch[batch.length - 1].cursor : cursor;
        nextCursor = events.length >= requestedLimit
          ? (events[events.length - 1]?.cursor ?? lastReadCursor) + 1
          : snapshot.nextCursor;
        if (events.length >= requestedLimit || !batch.length || lastReadCursor < cursor) break;
        if (lastReadCursor + 1 >= snapshot.nextCursor) break;
        cursor = lastReadCursor + 1;
      } while (true);
      return { events: events.slice(0, requestedLimit), nextCursor };
    },
    async readRunEvidenceManifest(projectId, taskId, runId) {
      const { projectRoot, controlRoot } = resolveRunDirectory(projectId, runId);
      await readTaskOwner(projectRoot, projectId, taskId, runId);
      return readEvidenceManifest(controlRoot, runId);
    }
  });
}
