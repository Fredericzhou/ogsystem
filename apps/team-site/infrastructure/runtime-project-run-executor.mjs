import { resolve } from "node:path";
import { runSystemWithAdapter } from "../../../dist/runtime/adapter.js";
import { ensureTeamVersionManifest } from "./team-version-manifest.mjs";

export function createRuntimeProjectRunExecutor({ execute = runSystemWithAdapter, getDefaultModelSelection = async () => undefined, projectTeamDesign } = {}) {
  return Object.freeze({
    async execute(project, {
      prompt, mode, runId, resumeRunDir, resumeProjectDigest, materialInputs,
      materialSourceRoot, materialSnapshotPolicy, onPrepared, owner, runKind
    }) {
      const modelConfig = resumeRunDir || mode === "dry-run" ? undefined : await getDefaultModelSelection();
      const assetWorkdir = project.assetWorkdir || project.workdir;
      const ogsDir = resolve(project.ogsDir || project.workdir);
      const workspaceDir = resolve(project.workspaceDir || project.workdir);
      const isTaskRun = runKind === "project_task" || owner?.kind === "project_task";
      if (isTaskRun && (project.teamVersionId || owner?.teamVersionId)) {
        await ensureTeamVersionManifest({ ogsDir, teamVersion: { ...project, teamVersionId: project.teamVersionId || owner.teamVersionId, workdir: assetWorkdir } });
      }
      const runtimeEdgeIdsByTransition = typeof projectTeamDesign === "function"
        ? Object.fromEntries((await projectTeamDesign({ ...project, workdir: assetWorkdir })).viewModel.edges.map((edge) => [JSON.stringify([edge.source, edge.eventType, edge.target]), edge.id]))
        : undefined;
      return execute({
        systemPath: resolve(assetWorkdir, "system.mmd"),
        prompt,
        workdir: ogsDir,
        ...(isTaskRun ? {
          assetSource: assetWorkdir,
          targetDir: workspaceDir,
          runEvidenceRoot: ogsDir,
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
        materialSourceRoot: materialSourceRoot || workspaceDir,
        modelSelectionDefaults: modelConfig?.modelSelectionDefaults,
        modelCatalogModels: modelConfig?.modelCatalogModels,
        modelCatalogGeneratedAt: modelConfig?.modelCatalogGeneratedAt,
        runtimeEdgeIdsByTransition,
        onProjectRunPrepared: onPrepared,
        logRun: false
      });
    }
  });
}
