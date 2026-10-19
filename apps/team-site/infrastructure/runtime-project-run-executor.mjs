import { resolve } from "node:path";
import { runSystemWithAdapter } from "../../../dist/runtime/adapter.js";

export function createRuntimeProjectRunExecutor({ execute = runSystemWithAdapter } = {}) {
  return Object.freeze({
    async execute(project, {
      prompt, mode, runId, resumeRunDir, resumeProjectDigest, materialInputs,
      materialSourceRoot, onPrepared
    }) {
      return execute({
        systemPath: resolve(project.workdir, "system.mmd"),
        prompt,
        workdir: project.workdir,
        runId,
        resumeRunDir,
        dryRun: mode === "dry-run",
        projectId: project.projectId,
        projectRunMode: mode,
        trustedProjectTopology: project.source === "classic" || project.source === "classic-template",
        projectDigest: resumeProjectDigest ?? project.projectDigest,
        projectRunLock: false,
        materialInputs,
        materialSourceRoot,
        onProjectRunPrepared: onPrepared,
        logRun: false
      });
    }
  });
}
