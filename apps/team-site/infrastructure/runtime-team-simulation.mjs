import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSystemWithAdapter } from "../../../dist/runtime/adapter.js";
import { exportTeamPackage, loadTeamPackage } from "../../../dist/visualizer/project-projection.js";

export function createRuntimeTeamSimulation({ run = runSystemWithAdapter } = {}) {
  return Object.freeze({
    async simulate(team, { prompt }) {
      const workdir = await mkdtemp(join(tmpdir(), "ogs-team-simulation-"));
      const runId = `simulation-${randomUUID()}`;
      try {
        await mkdir(join(workdir, ".ogs"), { recursive: true });
        const bundle = await exportTeamPackage(team.workdir);
        const loaded = await loadTeamPackage({ workdir, bundle });
        if (loaded.validation?.ok === false) throw new Error("TEAM_SIMULATION_INVALID: team version failed validation.");
        const result = await run({
          systemPath: resolve(workdir, "system.mmd"),
          prompt,
          workdir,
          runId,
          dryRun: true,
          projectRunMode: "dry-run",
          projectId: `preview:${team.teamVersionId}`,
          trustedProjectTopology: team.source === "classic" || team.source === "classic-template",
          projectDigest: team.projectDigest,
          projectRunLock: false,
          logRun: false
        });
        return {
          teamVersionId: team.teamVersionId,
          mode: "simulation",
          persisted: false,
          status: result.status,
          finalRoleId: result.finalRoleId,
          finalOutput: result.finalOutput,
          stages: Array.isArray(result.stages) ? result.stages : [],
          auditTrail: Array.isArray(result.auditTrail) ? result.auditTrail.map((item) => ({
            roleId: item.roleId,
            selectedEvent: item.selectedEvent,
            status: item.status,
            durationMs: item.durationMs,
            backend: item.backend,
            modelId: item.modelId,
            failure: item.error
          })) : [],
          summary: result.runSummary || {},
          durationMs: 0
        };
      } finally {
        await rm(workdir, { recursive: true, force: true });
      }
    }
  });
}
