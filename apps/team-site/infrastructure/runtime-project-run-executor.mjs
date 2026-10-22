import { resolve } from "node:path";
import { runSystemWithAdapter } from "../../../dist/runtime/adapter.js";

export function createRuntimeProjectRunExecutor({ execute = runSystemWithAdapter, getDefaultModelSelection = async () => undefined } = {}) {
  return Object.freeze({
    async execute(project, {
      prompt, mode, runId, resumeRunDir, resumeProjectDigest, materialInputs,
      materialSourceRoot, materialSnapshotPolicy, onPrepared, owner, runKind
    }) {
      const modelConfig = resumeRunDir || mode === "dry-run" ? undefined : await getDefaultModelSelection();
      const assetWorkdir = project.assetWorkdir || project.workdir;
      const isTaskRun = runKind === "project_task" || owner?.kind === "project_task";
      return execute({
        systemPath: resolve(assetWorkdir, "system.mmd"),
        prompt,
        workdir: project.workdir,
        ...(isTaskRun ? {
          assetSource: assetWorkdir,
          targetDir: project.workdir,
          runEvidenceRoot: project.workdir,
          runKind: "project_task",
          owner: { ...owner, kind: "project_task", runId },
          materialSnapshotPolicy
        } : {}),
        runId,
        resumeRunDir,
        dryRun: mode === "dry-run",
        projectId: owner?.projectId || project.projectId,
        executionMode: mode,
        trustedProjectTopology: project.trustedClassicTopology === true
          || project.source === "classic"
          || project.source === "classic-template",
        projectDigest: resumeProjectDigest ?? project.projectDigest,
        projectRunLock: false,
        materialInputs,
        materialSourceRoot,
        modelSelectionDefaults: modelConfig?.modelSelectionDefaults,
        modelCatalogModels: modelConfig?.modelCatalogModels,
        modelCatalogGeneratedAt: modelConfig?.modelCatalogGeneratedAt,
        onProjectRunPrepared: onPrepared,
        logRun: false
      });
    }
  });
}
