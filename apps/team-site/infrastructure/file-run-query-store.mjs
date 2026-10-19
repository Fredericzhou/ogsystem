import { readFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { loadProjectRunPlan } from "../../../dist/runtime/project-run.js";
import { loadProjectRunState } from "../../../dist/runtime/project-run-state.js";
import { loadRunEventsSnapshot } from "../../../dist/visualizer/run-query-service.js";

function assertSafeId(value, field, pattern) {
  if (!pattern.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

export function createFileRunQueryStore({ projectsRoot }) {
  if (!projectsRoot) throw new TypeError("Run query store projects root is required.");
  const root = resolve(projectsRoot);

  function resolveRunDirectory(runtimeProjectId, runId) {
    assertSafeId(runtimeProjectId, "runtimeProjectId", /^[a-z0-9][a-z0-9-]{0,80}$/);
    assertSafeId(runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    const projectRoot = resolve(root, runtimeProjectId);
    if (!projectRoot.startsWith(`${root}${sep}`)) throw new Error("Run query path is outside the site workspace.");
    const runDir = resolve(projectRoot, ".ogs", "runs", runId);
    if (!runDir.startsWith(`${projectRoot}${sep}`)) throw new Error("Run query path is outside the project workspace.");
    return { projectRoot, runDir };
  }

  async function assertProjectExists(projectRoot) {
    try {
      const metadata = JSON.parse(await readFile(join(projectRoot, ".site", "project.json"), "utf8"));
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("invalid metadata");
    } catch {
      throw new Error("Project not found.");
    }
  }

  return Object.freeze({
    async readRunState(runtimeProjectId, runId) {
      const { projectRoot, runDir } = resolveRunDirectory(runtimeProjectId, runId);
      await assertProjectExists(projectRoot);
      return loadProjectRunState(runDir);
    },
    async readRunPlan(runtimeProjectId, runId) {
      const { runDir } = resolveRunDirectory(runtimeProjectId, runId);
      return loadProjectRunPlan(runDir).catch(() => undefined);
    },
    async readRunEvents(runtimeProjectId, runId, options = {}) {
      const { projectRoot } = resolveRunDirectory(runtimeProjectId, runId);
      await assertProjectExists(projectRoot);
      return loadRunEventsSnapshot({ ...options, workdir: projectRoot, runId });
    }
  });
}
