import { lstat, readdir, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createGitCollaboration, createWorkspaceCoordinator, runSystemWithAdapter } from "../../../dist/runtime/adapter.js";
import { ensureTeamVersionManifest } from "./team-version-manifest.mjs";

const FORBIDDEN_PROJECT_WORKSPACE_DIRECTORIES = [".ogs", "source", "destination"];

async function snapshotForbiddenWorkspaceDirectories(workspaceDir) {
  const present = new Set();
  for (const name of FORBIDDEN_PROJECT_WORKSPACE_DIRECTORIES) {
    const entry = await lstat(resolve(workspaceDir, name)).catch(() => undefined);
    if (entry) present.add(name);
  }
  return present;
}

async function cleanGeneratedForbiddenWorkspaceDirectories(workspaceDir, initiallyPresent) {
  const violations = [];
  for (const name of FORBIDDEN_PROJECT_WORKSPACE_DIRECTORIES) {
    if (initiallyPresent.has(name)) continue;
    const path = resolve(workspaceDir, name);
    const entry = await lstat(path).catch(() => undefined);
    if (!entry) continue;
    if (!entry.isDirectory()) {
      violations.push(`${name} is not a directory`);
      continue;
    }
    const contents = await readdir(path);
    if (contents.length > 0) {
      violations.push(`${name} contains ${contents.length} entry(s)`);
      continue;
    }
    await rmdir(path);
  }
  if (violations.length > 0) {
    throw new Error(`PROJECT_WORKSPACE_BOUNDARY_VIOLATION: generated forbidden directory ${violations.join(", ")}`);
  }
}

export function createRuntimeProjectRunExecutor({ execute = runSystemWithAdapter, getDefaultHarnessBinding = async () => undefined, projectTeamDesign } = {}) {
  return Object.freeze({
    async cleanupWorkspace(project, { runId, terminalStatus, workspaceId, expectedCanonicalHead }) {
      if (project.workspaceId !== workspaceId) {
        throw new Error("WORKSPACE_CLEANUP_WORKSPACE_MISMATCH: cleanup Workspace does not match its Project.");
      }
      const workspaceDir = resolve(project.workspaceDir || project.workdir);
      const ogsDir = resolve(project.ogsDir || project.workdir);
      const collaboration = createGitCollaboration({
        repositoryRoot: workspaceDir,
        worktreeRoot: resolve(ogsDir, ".ogs", "worktrees"),
        runId,
        workspaceId
      });
      const probe = await collaboration.probe(workspaceDir);
      if (!probe.supported || !probe.head) {
        throw new Error(`WORKSPACE_REPOSITORY_REQUIRED: ${probe.reason || "Project Workspace must be a Git + LFS repository."}`);
      }
      const coordinator = createWorkspaceCoordinator({
        repositoryRoot: workspaceDir,
        evidenceDir: resolve(ogsDir, ".ogs", "runs", runId),
        collaboration,
        workspaceId
      });
      const result = await coordinator.cleanupMergedRunBranches({
        runId,
        terminalStatus,
        owner: runId,
        workspaceDir,
        expectedCanonicalHead
      });
      return result;
    },
    async execute(project, {
      prompt, mode, runId, resumeRunDir, resumeProjectDigest, materialInputs,
      materialSourceRoot, materialSnapshotPolicy, onPrepared, owner, runKind
    }) {
      const modelConfig = resumeRunDir || mode === "dry-run" ? undefined : await getDefaultHarnessBinding();
      const assetWorkdir = project.assetWorkdir || project.workdir;
      const ogsDir = resolve(project.ogsDir || project.workdir);
      const workspaceDir = resolve(project.workspaceDir || project.workdir);
      const isTaskRun = runKind === "project_task" || owner?.kind === "project_task";
      const initiallyPresentForbiddenWorkspaceDirectories = isTaskRun
        ? await snapshotForbiddenWorkspaceDirectories(workspaceDir)
        : undefined;
      let gitCollaboration;
      let workspaceCoordinator;
      if (isTaskRun) {
        if (typeof project.workspaceId !== "string" || !project.workspaceId.trim()) {
          throw new Error("PROJECT_WORKSPACE_ID_REQUIRED: Project Task Runs require the persisted Workspace identity.");
        }
        const collaboration = createGitCollaboration({
          repositoryRoot: workspaceDir,
          worktreeRoot: resolve(ogsDir, ".ogs", "worktrees"),
          runId,
          workspaceId: project.workspaceId
        });
        const probe = await collaboration.probe(workspaceDir);
        if (!probe.supported || !probe.head) {
          throw new Error(`WORKSPACE_REPOSITORY_REQUIRED: ${probe.reason || "Project Workspace must be a clean Git + LFS repository."}`);
        }
        const coordinator = createWorkspaceCoordinator({
          repositoryRoot: workspaceDir,
          // Project Run evidence is rooted at <project>/.ogs/runs/<runId>.
          // Keep Workspace checkpoints and Release materialization under the
          // same controlled root that the Project read APIs inspect.
          evidenceDir: resolve(ogsDir, ".ogs", "runs", runId),
          collaboration,
          workspaceId: project.workspaceId
        });
        workspaceCoordinator = coordinator;
        gitCollaboration = {
          collaboration,
          baseCommit: probe.head,
          onRoleCommit: async (branchId, commit) => (await coordinator.recordRoleCommit({
            runId,
            nodeId: commit.roleId,
            branchId,
            roleCommit: commit
          })).event,
          onMerge: async (merge) => (await coordinator.recordMerge({
            runId,
            nodeId: `merge-${merge.mergeId}`,
            merge
          })).event,
          publish: (merge) => coordinator.publishRelease({
            releaseId: `release-${runId}`,
            runId,
            workspaceDir,
            sourceDir: workspaceDir,
            releaseCommit: merge.mergeCommit,
            expectedCanonicalHead: probe.head,
            downloadReference: `project://${owner?.projectId || project.projectId}/runs/${runId}/release`
          })
        };
      }
      if (isTaskRun && (project.teamVersionId || owner?.teamVersionId)) {
        await ensureTeamVersionManifest({ ogsDir, teamVersion: { ...project, teamVersionId: project.teamVersionId || owner.teamVersionId, workdir: assetWorkdir } });
      }
      const runtimeEdgeIdsByTransition = typeof projectTeamDesign === "function"
        ? Object.fromEntries((await projectTeamDesign({ ...project, workdir: assetWorkdir })).viewModel.edges.map((edge) => [JSON.stringify([edge.source, edge.eventType, edge.target]), edge.id]))
        : undefined;
      let result;
      let executionError;
      try {
        result = await execute({
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
          modelCatalogModels: modelConfig?.modelCatalogModels,
          modelCatalogGeneratedAt: modelConfig?.modelCatalogGeneratedAt,
          runtimeEdgeIdsByTransition,
          gitCollaboration,
          onProjectRunPrepared: onPrepared,
          logRun: false
        });
      } catch (error) {
        executionError = error;
      }
      if (isTaskRun) {
        try {
          await cleanGeneratedForbiddenWorkspaceDirectories(workspaceDir, initiallyPresentForbiddenWorkspaceDirectories);
        } catch (boundaryError) {
          if (!executionError) executionError = boundaryError;
        }
      }
      if (workspaceCoordinator) {
        try {
          await workspaceCoordinator.writeEvidenceManifest({ runId });
        } catch (manifestError) {
          if (!executionError) executionError = manifestError;
        }
      }
      if (executionError) throw executionError;
      return result;
    }
  });
}
