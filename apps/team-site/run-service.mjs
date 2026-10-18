import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { ACTIVE_RUN_STATUSES } from "./domain/contracts.mjs";
import { loadProjectRunState, updateProjectRunState } from "../../dist/runtime/project-run-state.js";

const projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"));

export async function recoverOrphanedRuns() {
  await mkdir(projectsRoot, { recursive: true });
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const recovered = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".staging") continue;
    const runsRoot = join(projectsRoot, entry.name, ".ogs", "runs");
    const runEntries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
    for (const runEntry of runEntries) {
      if (!runEntry.isDirectory()) continue;
      const runDir = join(runsRoot, runEntry.name);
      const state = await loadProjectRunState(runDir).catch(() => undefined);
      if (!state || !ACTIVE_RUN_STATUSES.has(state.status)) continue;
      await updateProjectRunState(runDir, (current) => {
        if (!ACTIVE_RUN_STATUSES.has(current.status)) return current;
        return {
          ...current,
          status: "failed",
          error: "RUNNER_RESTARTED: the service restarted before this run reached a terminal state.",
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      });
      recovered.push({ projectId: entry.name, runId: runEntry.name });
    }
  }
  return recovered;
}
