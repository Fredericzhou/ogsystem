import { readFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { loadProjectRunPlan } from "../../../dist/runtime/project-run.js";
import { loadProjectRunState } from "../../../dist/runtime/project-run-state.js";
import { loadRunEventsSnapshot } from "../../../dist/visualizer/run-query-service.js";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath } from "./safe-evidence-path.mjs";

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
    const runDir = resolve(projectRoot, ".ogs", "runs", runId);
    if (!runDir.startsWith(`${projectRoot}${sep}`)) throw new Error("Run query path is outside the project workspace.");
    return { projectRoot, runDir };
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
    const task = (metadata.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
    if (!task) throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task.");
    return readProjectRunOwner({ projectId, workdir: projectRoot }, task, runId);
  }

  return Object.freeze({
    async readRunOwner(projectId, taskId, runId) {
      const { projectRoot } = resolveRunDirectory(projectId, runId);
      return readTaskOwner(projectRoot, projectId, taskId, runId);
    },
    async readRunState(projectId, taskId, runId) {
      const { projectRoot, runDir } = resolveRunDirectory(projectId, runId);
      await readTaskOwner(projectRoot, projectId, taskId, runId);
      await assertSafeEvidencePath(projectRoot, [".ogs", "runs", runId, "control", "state.json"], { kind: "file", label: "Run state" });
      return loadProjectRunState(runDir);
    },
    async readRunPlan(projectId, taskId, runId) {
      const { projectRoot, runDir } = resolveRunDirectory(projectId, runId);
      await readTaskOwner(projectRoot, projectId, taskId, runId);
      try {
        await assertSafeEvidencePath(projectRoot, [".ogs", "runs", runId, "run-plan.json"], { kind: "file", label: "Run plan" });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return loadProjectRunPlan(runDir).catch(() => undefined);
    },
    async readRunEvents(projectId, taskId, runId, options = {}) {
      const { projectRoot } = resolveRunDirectory(projectId, runId);
      await readTaskOwner(projectRoot, projectId, taskId, runId);
      for (const file of ["timeline.jsonl", "events.ndjson"]) {
        try {
          await assertSafeEvidencePath(projectRoot, [".ogs", "runs", runId, file], { kind: "file", label: "Run events" });
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      return loadRunEventsSnapshot({ ...options, workdir: projectRoot, runId });
    }
  });
}
