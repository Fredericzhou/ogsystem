import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { serializeAuthoringToMermaid } from "../../dist/visualizer/studio-authoring.js";
import { exportTeamPackage, loadTeamPackage } from "../../dist/visualizer/project-projection.js";
import { cases } from "./cases.mjs";
import { buildCaseGraph, runCase } from "./demo-runner.mjs";
import { eventLabels } from "./event-labels.mjs";
import {
  createProject as createFileProjectRecord,
  getProject as readProject,
  listTeamRepository,
  initializeCollaborationProject,
  removeProject,
  withProjectWriteLock,
  saveProjectMetadata,
  saveTaskRecord,
  removeProjectData,
  listProjects,
  fileProjectStoreInternals
} from "./infrastructure/file-project-store.mjs";
import { createFilePackageStore } from "./infrastructure/file-package-store.mjs";
import { createVisualizerAdapter } from "./infrastructure/visualizer-adapter.mjs";
import { resolveTeamStudioModel } from "./capabilities/team-studio-model.mjs";
import { handleProjectRoutes } from "./api/project-routes.mjs";
import { handleTaskRoutes } from "./api/task-routes.mjs";
import { handleRunRoutes } from "./api/run-routes.mjs";
import { handleTeamRoutes } from "./api/team-routes.mjs";
import { errorStatus } from "./api/error-status.mjs";
import { handleStudioSimulationRoutes } from "./api/studio-simulation-routes.mjs";
import { handlePackageRoutes } from "./api/package-routes.mjs";
import { handleCollaborationProjectRoutes } from "./api/collaboration-project-routes.mjs";
import { handlePlatformRoutes } from "./api/platform-routes.mjs";
import { handleSharedResourceRoutes } from "./api/shared-resource-routes.mjs";
import { handleCaseRoutes } from "./api/case-routes.mjs";
import { createTeamStudioUseCases } from "./application/team-studio-use-cases.mjs";
import { createTeamVersionLifecycleUseCases } from "./application/team-version-lifecycle-use-cases.mjs";
import { createTeamVersionSaveUseCases } from "./application/team-version-save-use-cases.mjs";
import { createTeamLifecycleUseCases } from "./application/team-lifecycle-use-cases.mjs";
import { createTeamAdjustmentUseCases } from "./application/team-adjustment-use-cases.mjs";
import { createFileTeamLifecycleLocks } from "./infrastructure/file-team-lifecycle-locks.mjs";
import { createRuntimeTeamConfirmation } from "./infrastructure/runtime-team-confirmation.mjs";
import { createStudioSimulationUseCases } from "./application/studio-simulation-use-cases.mjs";
import { createRuntimeTeamSimulation } from "./infrastructure/runtime-team-simulation.mjs";
import { createFileStudioSimulationStore } from "./infrastructure/file-studio-simulation-store.mjs";
import { createProjectReadinessUseCases } from "./application/project-readiness-use-cases.mjs";
import { createRuntimeProjectReadinessInspector } from "./infrastructure/runtime-project-readiness.mjs";
import { createVisualizerProjectDesignValidator } from "./infrastructure/visualizer-project-design-validator.mjs";
import { createVisualizerProjectDesignProjector } from "./infrastructure/visualizer-project-design-projector.mjs";
import { createTeamDesignUseCases } from "./application/team-design-use-cases.mjs";
import { createFileTeamDesignAssetStore } from "./infrastructure/file-team-design-asset-store.mjs";
import { isProcessAlive } from "./infrastructure/process-liveness.mjs";
import { createFileTeamVersionLifecycle } from "./infrastructure/file-team-version-lifecycle.mjs";
import { createPlatformUseCases } from "./application/platform-use-cases.mjs";
import { createSharedResourceUseCases } from "./application/shared-resource-use-cases.mjs";
import { createFilePlatformSettings } from "./infrastructure/file-platform-settings.mjs";
import { createFileSharedResourceStore } from "./infrastructure/file-shared-resource-store.mjs";
import { createModelCatalog } from "./infrastructure/model-catalog.mjs";
import { createModelAvailabilityProbe } from "./infrastructure/model-availability-probe.mjs";
import { createTeamCatalogUseCases } from "./application/team-catalog-use-cases.mjs";
import { createFileTeamCatalog } from "./infrastructure/file-team-catalog.mjs";
import { createRunResultUseCases } from "./application/run-result-use-cases.mjs";
import { createFileRunResultStore } from "./infrastructure/file-run-result-store.mjs";
import { createFileDeliverableStore } from "./infrastructure/file-deliverable-store.mjs";
import { createDeliverableUseCases } from "./application/deliverable-use-cases.mjs";
import { handleDeliverableRoutes } from "./api/deliverable-routes.mjs";
import { createRunQueryUseCases } from "./application/run-query-use-cases.mjs";
import { createFileRunQueryStore } from "./infrastructure/file-run-query-store.mjs";
import { createRecentRunUseCases } from "./application/recent-run-use-cases.mjs";
import { createFileRecentRunStore } from "./infrastructure/file-recent-run-store.mjs";
import { createTeamPackagePreviewUseCases } from "./application/team-package-preview-use-cases.mjs";
import { createProjectPackageUseCases } from "./application/project-package-use-cases.mjs";
import { createCollaborationProjectUseCases } from "./application/collaboration-project-use-cases.mjs";
import { createFileCollaborationProjectStore } from "./infrastructure/file-collaboration-project-store.mjs";
import { normalizeMaterialPath } from "./domain/material-path.mjs";
import { computeContentDigest, computePackageDigest, computeProjectDefinitionDigest, computeReleaseBaselineDigest, computeTeamPackageCoreDigest } from "./infrastructure/package-integrity.mjs";
import { createTeamPackageValidationUseCases } from "./application/team-package-validation-use-cases.mjs";
import { createVisualizerProjectDesignStore } from "./infrastructure/visualizer-project-design-store.mjs";
import { createTaskRetryUseCases } from "./application/task-retry-use-cases.mjs";
import { createTaskExecutionUseCases } from "./application/task-execution-use-cases.mjs";
import { createProjectRunUseCases } from "./application/project-run-use-cases.mjs";
import { createProjectRunControlUseCases } from "./application/project-run-control-use-cases.mjs";
import { createFileTaskExecutionStore } from "./infrastructure/file-task-execution-store.mjs";
import { taskWorkers, waitForActiveTaskWorker } from "./infrastructure/in-memory-task-workers.mjs";
import { createTaskExecutionIdentifiers } from "./infrastructure/task-execution-identifiers.mjs";
import { createRuntimeTaskExecutionReadiness } from "./infrastructure/runtime-task-execution-readiness.mjs";
import { createFileProjectRunStore } from "./infrastructure/file-project-run-store.mjs";
import { createFileProjectRunControlStore } from "./infrastructure/file-project-run-control-store.mjs";
import { createRuntimeProjectRunExecutor } from "./infrastructure/runtime-project-run-executor.mjs";
import { evaluateProjectRunResult } from "../../dist/runtime/project-quality.js";
import { createFileTaskRetryStore } from "./infrastructure/file-task-retry-store.mjs";
import { createTaskCreationUseCases } from "./application/task-creation-use-cases.mjs";
import { createTaskIdentifiers } from "./infrastructure/task-identifiers.mjs";
import { createProjectUpdateUseCases } from "./application/project-update-use-cases.mjs";
import { createProjectMaterialUseCases } from "./application/project-material-use-cases.mjs";
import { createFileProjectMaterialStore } from "./infrastructure/file-project-material-store.mjs";
import { createTaskLifecycleUseCases } from "./application/task-lifecycle-use-cases.mjs";
import { createFileTaskLifecycleStore } from "./infrastructure/file-task-lifecycle-store.mjs";
import { createRunRecoveryUseCases } from "./application/run-recovery-use-cases.mjs";
import { createProjectQueryUseCases } from "./application/project-query-use-cases.mjs";
import { ACTIVE_RUN_STATUSES } from "./domain/contracts.mjs";
import { projectVisualizerStore } from "./infrastructure/project-visualizer-store.mjs";
import { caseTeamMaterializer } from "./infrastructure/case-team-materializer.mjs";
import { createProjectCreationUseCases } from "./application/project-creation-use-cases.mjs";
import { createFileRunRecoveryStore } from "./infrastructure/file-run-recovery-store.mjs";
import { createRuntimeTaskReviewStore } from "./infrastructure/runtime-task-review-store.mjs";
import { listHumanReviews, writeHumanReviewDecision } from "../../dist/runtime/project-lifecycle.js";
import { createLocalControlPlanePrincipal } from "../../dist/runtime/identity.js";
import { validateRoleOutputSchemaDefinition, validateRolePackageManifest, validateRolePromptTemplate, validateRoleSourceRecord } from "../../dist/runtime/role-repo.js";
import { isRuntimeOnlyErrorEvent } from "../../dist/runtime/error-flow-utils.js";
import { requestRunStop } from "../../dist/runtime/run-artifacts.js";
import { parseMarkdownRole, convertMarkdownRole } from "../../tools/agent-source/markdown-role-adapter.mjs";
import { handleRoleSourceCatalogRoutes } from "./api/role-source-catalog-routes.mjs";
import { handleRoleSourceAdminRoutes } from "./api/role-source-admin-routes.mjs";
import { createRoleSourceCatalogUseCases } from "./application/role-source-catalog-use-cases.mjs";
import { createRuntimeRoleSourceTrial } from "./infrastructure/runtime-role-source-trial.mjs";
import { createRoleSourceSyncScheduler } from "./application/role-source-sync-scheduler.mjs";
import { createFileRoleSourceCatalogStore } from "./infrastructure/file-role-source-catalog-store.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, "public");
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
const visUrl = process.env.OGS_VIS_URL || "http://127.0.0.1:4177";
const visualizer = createVisualizerAdapter({
  baseUrl: visUrl,
  username: process.env.OGS_VIS_USERNAME,
  password: process.env.OGS_VIS_PASSWORD
});
const discoveryWorkdir = process.env.OGS_VIS_WORKDIR || join(process.env.LOCALAPPDATA || process.cwd(), "OGSystem", "visualizer-workspace");
const siteProjectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"));
const platformConfigRoot = resolve(process.env.OGS_PLATFORM_CONFIG_DIR || join(siteProjectsRoot, ".site"));
const taskAttemptStore = createFileRecentRunStore({ projectsRoot: siteProjectsRoot });
const projectQueryUseCases = createProjectQueryUseCases({
  projectStore: { getProject: readProject },
  taskAttemptStore,
  waitForActiveTaskWorker,
  workspaceInspector: projectVisualizerStore.inspectWorkspace
});
const getProject = projectQueryUseCases.getProject;
const getProjectTask = projectQueryUseCases.getProjectTask;
const filePackageStore = createFilePackageStore({
  projectStore: fileProjectStoreInternals,
  visualizer: projectVisualizerStore,
  packageIntegrity: { computeTeamPackageCoreDigest },
  normalizeMaterialPath
});
const projectCreationUseCases = createProjectCreationUseCases({
  projectStore: { createProject: createFileProjectRecord, saveProjectMetadata, removeProjectData },
  workspaceStore: {
    createWorkspace: projectVisualizerStore.createWorkspace,
    inspectWorkspace: projectVisualizerStore.inspectWorkspace
  },
  caseMaterializer: caseTeamMaterializer,
  projectQuery: { getProject }
});
const createProject = projectCreationUseCases.createProject;
const platformSettingsPath = join(platformConfigRoot, "platform-settings.json");
const platformSettingsStore = createFilePlatformSettings({ path: platformSettingsPath });
const teamPackageValidationUseCases = createTeamPackageValidationUseCases({
  packageIntegrity: { computePackageDigest, computeTeamPackageCoreDigest }
});
const { validateTeamPackage } = teamPackageValidationUseCases;
const teamPackagePreviewUseCases = createTeamPackagePreviewUseCases({
  validateTeamPackage,
  teamCatalog: { listTeamRepository },
  packageStore: filePackageStore
});
const projectPackageUseCases = createProjectPackageUseCases({
  validateTeamPackage,
  packageIntegrity: { computeContentDigest, computePackageDigest, computeProjectDefinitionDigest },
  normalizeMaterialPath,
  projectCatalog: { listProjects },
  packageStore: filePackageStore
});
const teamLifecycleLocks = createFileTeamLifecycleLocks({ projectsRoot: siteProjectsRoot });
const collaborationProjectUseCases = createCollaborationProjectUseCases({
  projectStore: createFileCollaborationProjectStore({
    getProject,
    withProjectWriteLock,
    saveProjectMetadata,
    listProjects,
    createProject,
    initializeCollaborationProject,
    removeProject,
    withCollaborationProjectNameLock: teamLifecycleLocks.withCollaborationProjectNameLock
  }),
  teamStore: { getTeamVersion: getProject },
  computeProjectDefinitionDigest
});
const taskExecutionReadiness = createRuntimeTaskExecutionReadiness();
const teamDesignProjector = createVisualizerProjectDesignProjector();
const projectRunUseCases = createProjectRunUseCases({
  projectStore: { getProject },
  teamStore: { getTeamVersion: getProject },
  runStore: { ...createFileProjectRunStore(), ...createRuntimeProjectRunExecutor({ getDefaultModelSelection: getPlatformDefaultModelSelection, projectTeamDesign: (team) => teamDesignProjector.project(team) }) },
  readiness: taskExecutionReadiness,
  identifiers: createTaskExecutionIdentifiers(),
  evaluateResult: evaluateProjectRunResult
});
const projectMaterialUseCases = createProjectMaterialUseCases({
  projectStore: { getProject, withProjectWriteLock },
  materialStore: createFileProjectMaterialStore({ computeProjectDefinitionDigest }),
  confirmation: { assertCurrent: taskExecutionReadiness.requireCurrentConfirmation }
});
const taskExecutionUseCases = createTaskExecutionUseCases({
  projectStore: { getProject },
  teamStore: { getTeamVersion: getProject },
  attemptStore: createFileTaskExecutionStore({ projectStore: { getProject, withProjectWriteLock, saveTaskRecord } }),
  workerStore: taskWorkers,
  runStore: { execute: projectRunUseCases.startProjectRun },
  readiness: taskExecutionReadiness,
  identifiers: createTaskExecutionIdentifiers()
});
const projectRunControlUseCases = createProjectRunControlUseCases({
  projectStore: { getProject, withProjectWriteLock },
  runControlStore: createFileProjectRunControlStore(),
  startProjectRun: projectRunUseCases.startProjectRun
});
const controlProjectRunWithApplication = projectRunControlUseCases.controlProjectRun;
const taskRetryUseCases = createTaskRetryUseCases({
  taskStore: { startTask: taskExecutionUseCases.startProjectTask },
  projectStore: { getProject },
  runStore: createFileTaskRetryStore()
});
const taskCreationUseCases = createTaskCreationUseCases({
  projectStore: { getProject, withProjectWriteLock, saveProjectMetadata },
  taskStore: createTaskIdentifiers(),
  fingerprintRequest: computeContentDigest
});
const taskLifecycleUseCases = createTaskLifecycleUseCases({
  projectStore: createFileTaskLifecycleStore({
    getProject,
    withProjectWriteLock,
    saveTaskRecord,
    controlRun: controlProjectRunWithApplication
  }),
  runControlStore: { controlRun: controlProjectRunWithApplication },
  reviewStore: createRuntimeTaskReviewStore({
    listHumanReviews,
    writeHumanReviewDecision,
    createPrincipal: createLocalControlPlanePrincipal,
    getProject
  })
});
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

const modelCatalog = createModelCatalog({ workdir: discoveryWorkdir });
const platformUseCases = createPlatformUseCases({
  platformSettingsStore,
  modelCatalog,
  probeModelAvailability: createModelAvailabilityProbe()
});
const sharedResourceUseCases = createSharedResourceUseCases({
  store: createFileSharedResourceStore({ root: join(platformConfigRoot, "shared-resources") })
});
async function getPlatformDefaultModelSelection() {
  const settings = await platformUseCases.readPlatformSettings();
  const discoveryPromise = platformUseCases.getPlatformDiscovery();
  // Model discovery can invoke local CLIs and must not block Studio design saves.
  // The catalog cache will be reused by later requests once discovery completes.
  const discovery = await Promise.race([
    discoveryPromise,
    new Promise((resolve) => setTimeout(() => resolve({ models: [], generatedAt: undefined }), 2500))
  ]);
  const models = (discovery.models || []).filter((model) => model.runnable);
  const configured = String(settings.defaultModel || "default");
  const matchesConfiguredModel = (model) => {
    const modelId = model.modelId || model.id;
    if (modelId === configured) return true;
    if (model.backend !== settings.defaultProvider || configured === "default") return false;
    return modelId?.endsWith(`/${configured}`);
  };
  const selected = configured === "default"
    ? models.find((model) => model.backend === settings.defaultProvider)
    : models.find(matchesConfiguredModel);
  const fallbackSelection = !selected && !models.length && configured !== "default"
    ? { backend: settings.defaultProvider || "opencode", modelId: configured }
    : !selected && !models.length
      ? { backend: settings.defaultProvider || "opencode", modelId: "gpt-6-luna" }
      : undefined;
  return selected || models.length || fallbackSelection ? {
    ...(selected ? { modelSelectionDefaults: { backend: selected.backend, modelId: selected.modelId || selected.id } } : fallbackSelection ? { modelSelectionDefaults: fallbackSelection } : {}),
    modelCatalogGeneratedAt: discovery.generatedAt,
    modelCatalogModels: models.map((model) => ({
      backend: model.backend,
      modelId: model.modelId || model.id,
      name: model.name,
      status: model.status || "active",
      runnable: true,
      capabilities: model.capabilities || { textInput: true, textOutput: true, toolcall: false },
      variants: model.variants || []
    }))
  } : undefined;
}
const teamCatalog = createFileTeamCatalog({ projectsRoot: siteProjectsRoot });
const teamCatalogUseCases = createTeamCatalogUseCases({ teamCatalog });
const projectUpdateUseCases = createProjectUpdateUseCases({
  projectStore: { getProject, withProjectWriteLock, saveProjectMetadata },
  teamCatalog,
  computeProjectDefinitionDigest
});
const studioSimulationStore = createFileStudioSimulationStore({ projectsRoot: siteProjectsRoot });
const teamDesignAssetStore = createFileTeamDesignAssetStore();
async function openWorkspaceDirectory(workspaceDir) {
  try {
    if (!(await stat(workspaceDir)).isDirectory()) throw new Error("TEAM_WORKSPACE_INVALID");
  } catch (error) {
    if (error?.message === "TEAM_WORKSPACE_INVALID") throw error;
    throw new Error("TEAM_WORKSPACE_INVALID");
  }
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [workspaceDir], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", rejectPromise);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}
const studioSimulationUseCases = createStudioSimulationUseCases({
  teamCatalog,
  teamPackageReader: projectVisualizerStore,
  packageIntegrity: { computeTeamPackageCoreDigest, computeReleaseBaselineDigest },
  simulationStore: studioSimulationStore,
  simulationRunner: createRuntimeTeamSimulation({ getDefaultModelSelection: getPlatformDefaultModelSelection }),
  identifiers: { simulationId: randomUUID },
  requestRunStop,
  openWorkspaceDirectory,
  baselineStore: teamDesignAssetStore,
  projectTeamDesign: (team) => teamDesignProjector.project(team),
  withTeamVersionLock: teamLifecycleLocks.withTeamVersionLock,
  processId: process.pid,
  hostName: hostname(),
  processIsAlive: isProcessAlive
});
const projectReadinessUseCases = createProjectReadinessUseCases({
  getProject,
  readinessInspector: createRuntimeProjectReadinessInspector({ getRuntimeModelConfig: getPlatformDefaultModelSelection })
});
const projectDesignValidator = createVisualizerProjectDesignValidator({ getRuntimeModelConfig: getPlatformDefaultModelSelection });
const teamDesignUseCases = createTeamDesignUseCases({
  teamCatalog,
  withTeamVersionLock: teamLifecycleLocks.withTeamVersionLock,
  teamMetadataStore: { saveTeamMetadata: saveProjectMetadata },
  designStore: createVisualizerProjectDesignStore({ getRuntimeModelConfig: getPlatformDefaultModelSelection }),
  designProjector: teamDesignProjector,
  designSerializer: { serialize: serializeAuthoringToMermaid },
  designValidator: projectDesignValidator,
  designAssetStore: teamDesignAssetStore,
  packageIntegrity: { computeReleaseBaselineDigest },
  rolePackageValidator: {
    validateManifest: validateRolePackageManifest,
    validatePrompt: validateRolePromptTemplate,
    validateSchema: validateRoleOutputSchemaDefinition,
    validateSource: validateRoleSourceRecord,
    isRuntimeOnlyErrorEvent
  }
});
const agencyNonRoleDirectories = new Set([".github", "docs", "examples", "integrations", "scripts"]);
const agencyCnNonRoleDirectories = new Set([".github", "docs", "examples", "integrations", "scripts"]);
const roleSourceAdapters = {
  "agency-agents-markdown": {
    version: "1",
    parseMarkdownRole,
    convertMarkdownRole,
    shouldIndex: (path) => {
      const segments = path.split("/");
      return segments.length > 1 && !agencyNonRoleDirectories.has(segments[0].toLowerCase());
    }
  },
  "agency-agents-cn-markdown": {
    version: "1",
    parseMarkdownRole: (markdown, options = {}) => parseMarkdownRole(markdown, { ...options, defaultLanguage: "zh-CN" }),
    convertMarkdownRole,
    shouldIndex: (path) => {
      const segments = path.split("/");
      return segments.length > 1 && !agencyCnNonRoleDirectories.has(segments[0].toLowerCase());
    }
  }
};
const roleSourceCatalogStore = createFileRoleSourceCatalogStore({
  root: join(platformConfigRoot, "role-sources"),
  adapters: roleSourceAdapters,
  defaultSources: [{
    sourceId: "agency-agents-cn",
    name: "Agency Agents CN",
    gitUrl: "https://github.com/Aura-huang/agency-agents-cn.git",
    branch: "main",
    adapterId: "agency-agents-cn-markdown",
    adapterVersion: "1",
    enabled: true
  }]
});
const roleSourceCatalogUseCases = createRoleSourceCatalogUseCases({
  store: roleSourceCatalogStore,
  adapters: roleSourceAdapters,
  copyRoleSourceToDraft: teamDesignUseCases.copyRoleSourceToDraft,
  runRoleTrial: createRuntimeRoleSourceTrial({ getDefaultModelSelection: getPlatformDefaultModelSelection })
});
const roleSourceSyncScheduler = createRoleSourceSyncScheduler({
  listSources: roleSourceCatalogStore.listSources,
  getSyncStatus: roleSourceCatalogStore.getSyncStatus,
  updateSyncStatus: roleSourceCatalogStore.updateSyncStatus,
  synchronizeSource: roleSourceCatalogStore.synchronizeSource,
  refreshSourceIndex: roleSourceCatalogStore.refreshSourceIndex,
});
const runQueryUseCases = createRunQueryUseCases({
  getProject,
  waitForActiveTaskWorker,
  runQueryStore: createFileRunQueryStore({ projectsRoot: siteProjectsRoot })
});
const runResultUseCases = createRunResultUseCases({
  getRun: runQueryUseCases.getProjectRun,
  runResultStore: createFileRunResultStore({ projectsRoot: siteProjectsRoot })
});
const deliverableUseCases = createDeliverableUseCases({
  getProject,
  getRun: runQueryUseCases.getProjectRun,
  runResultStore: createFileRunResultStore({ projectsRoot: siteProjectsRoot }),
  deliverableStore: createFileDeliverableStore()
});
const recentRunUseCases = createRecentRunUseCases({
  listProjects,
  runArtifactStore: taskAttemptStore
});
const runRecoveryUseCases = createRunRecoveryUseCases({
  recoveryStore: createFileRunRecoveryStore({ projectsRoot: siteProjectsRoot })
});

async function readBody(request, limit = 1024 * 1024) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw new Error("Request body is too large.");
  }
  return JSON.parse(body || "{}");
}

const teamStudioUseCases = createTeamStudioUseCases({
  visualizer,
  readPlatformSettings: platformUseCases.readPlatformSettings,
  getPlatformDiscovery: platformUseCases.getPlatformDiscovery,
  resolveTeamStudioModel
});
const teamVersionLifecycle = createFileTeamVersionLifecycle({ getTeamVersion: getProject, listProjects, removeProjectData });
const teamVersionLifecycleUseCases = createTeamVersionLifecycleUseCases({
  teamVersions: { ...teamVersionLifecycle, getTeamVersion: getProject },
  withTeamVersionLock: teamLifecycleLocks.withTeamVersionLock
});
const teamLifecycleUseCases = createTeamLifecycleUseCases({
  projectStore: {
    getProject,
    listProjects,
    createProject,
    saveProjectMetadata,
    removeProject,
    withProjectWriteLock
  },
  packageStore: { exportTeamPackage, loadTeamPackage },
  locks: teamLifecycleLocks,
  confirmation: createRuntimeTeamConfirmation(),
  releaseEvidence: studioSimulationUseCases,
  caseMaterializer: caseTeamMaterializer,
  caseCatalog: { getCase: (caseId) => cases.find((item) => item.id === caseId), listCases: () => cases },
  assertTrustedTeamTopology: (team) => ["classic", "classic-template"].includes(team.source) && Boolean(team.caseId)
});
const teamAdjustmentUseCases = createTeamAdjustmentUseCases({
  projectStore: { getProject },
  getTeamVersion: teamCatalog.getTeamVersion
});
const teamVersionSaveUseCases = createTeamVersionSaveUseCases({
  teamCatalog,
  designUseCases: teamDesignUseCases,
  lifecycleUseCases: teamLifecycleUseCases,
  withTeamVersionSaveLock: teamLifecycleLocks.withTeamVersionSaveLock,
  removeProject,
  digestSnapshot: (value) => createHash("sha256").update(value).digest("hex")
});

function publicProject(project) {
  const { workdir, workspaceDir, ...safe } = project;
  if (workspaceDir !== undefined) safe.workspaceAvailable = Boolean(workspaceDir);
  if (safe.workspace && typeof safe.workspace === "object") {
    const { workdir: workspaceWorkdir, ...workspace } = safe.workspace;
    safe.workspace = workspace;
  }
  if (Array.isArray(safe.taskRecords)) {
    safe.taskRecords = safe.taskRecords.map((task) => {
      const { requestFingerprint, attemptRequests, ...publicTask } = task;
      return publicTask;
    });
  }
  if (safe.projectType === "collaboration" && Array.isArray(safe.taskRecords)) {
    const activeTasks = safe.taskRecords
      .filter((task) => !task.deletedAt && ACTIVE_RUN_STATUSES.has(task.status))
      .map((task) => ({ taskId: task.taskId, taskNumber: task.taskNumber, status: task.status }));
    const capacity = 1;
    safe.taskCapacity = {
      capacity,
      used: Math.min(capacity, activeTasks.length),
      available: Math.max(0, capacity - activeTasks.length),
      activeTasks
    };
    safe.executionSlot = safe.taskCapacity;
  }
  return safe;
}

function publicTask(task) {
  if (!task || typeof task !== "object") return task;
  const { requestFingerprint, attemptRequests, ...safe } = task;
  return safe;
}

const compressedStaticCache = new Map();
const immutableStaticName = /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i;

function staticContentEncoding(request) {
  const header = String(request?.headers?.["accept-encoding"] || "");
  const values = new Map(header.split(",").map((part) => {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const parsed = quality ? Number.parseFloat(quality.trim().slice(2)) : 1;
    return [name, Number.isFinite(parsed) ? parsed : 0];
  }).filter(([name]) => name));
  const wildcard = values.get("*") || 0;
  const brQuality = values.has("br") ? values.get("br") : wildcard;
  const gzipQuality = values.has("gzip") ? values.get("gzip") : wildcard;
  return [["br", brQuality], ["gzip", gzipQuality]]
    .filter(([, quality]) => quality > 0)
    .sort((left, right) => right[1] - left[1])
    .at(0)?.[0];
}

function compressStaticContents(filePath, contents, info, encoding) {
  if (!encoding || contents.length < 1024) return { contents, encoding: undefined };
  const cacheKey = `${filePath}:${info.mtimeMs}:${info.size}:${encoding}`;
  const cached = compressedStaticCache.get(cacheKey);
  if (cached) return cached;
  const compressed = encoding === "br" ? brotliCompressSync(contents) : gzipSync(contents);
  const result = compressed.length < contents.length
    ? { contents: compressed, encoding }
    : { contents, encoding: undefined };
  compressedStaticCache.set(cacheKey, result);
  if (compressedStaticCache.size > 64) compressedStaticCache.delete(compressedStaticCache.keys().next().value);
  return result;
}

function writeStaticResponse({ request, response, pathname, filePath, contents, info, immutable = false, headers = {} }) {
  const compressed = compressStaticContents(filePath, contents, info, staticContentEncoding(request));
  const fileName = filePath.split(sep).at(-1) || "";
  const cacheable = immutable || (pathname.startsWith("/assets/") && immutableStaticName.test(fileName));
  response.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": cacheable ? "public, max-age=31536000, immutable" : "no-cache",
    "vary": "Accept-Encoding",
    "content-length": compressed.contents.length,
    ...(compressed.encoding ? { "content-encoding": compressed.encoding } : {}),
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...headers
  });
  response.end(compressed.contents);
}

async function serveStatic(pathname, request, response, { immutable = false, headers = {} } = {}) {
  const relative = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname)).replace(/^([/\\])+/, "");
  const filePath = resolve(publicRoot, relative);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const contents = await readFile(filePath);
    writeStaticResponse({ request, response, pathname, filePath, contents, info, immutable, headers });
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (await handlePlatformRoutes({ request, response, url, readBody, sendJson, useCases: platformUseCases })) return;
  if (await handleRoleSourceAdminRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases: roleSourceCatalogUseCases, scheduler: roleSourceSyncScheduler })) return;
  if (await handleRoleSourceCatalogRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases: roleSourceCatalogUseCases })) return;
  if (await handleSharedResourceRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases: sharedResourceUseCases })) return;
  if (await handleProjectRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    useCases: collaborationProjectUseCases
  })) return;
  if (await handleStudioSimulationRoutes({
    request, response, url, readBody, sendJson, errorStatus,
    useCases: studioSimulationUseCases
  })) return;
  if (await handleTeamRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    useCases: {
      ...teamCatalogUseCases,
      ...teamLifecycleUseCases,
      ...teamDesignUseCases,
      ...teamVersionSaveUseCases,
      chatTeamAssistant: teamStudioUseCases.chat,
      getTeamVersion: teamVersionSaveUseCases.getTeamVersionForSave,
      getTeamDesign: teamVersionSaveUseCases.getTeamDesignForSave,
      archiveTeamVersion: teamVersionLifecycleUseCases.archiveTeamVersion,
      deleteTeamVersion: teamVersionLifecycleUseCases.deleteTeamVersion,
      deleteTeam: teamVersionLifecycleUseCases.deleteTeam
    }
  })) return;
  if (await handlePackageRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    useCases: {
      importTeamPackage: teamPackagePreviewUseCases.importTeamPackage,
      previewTeamPackage: teamPackagePreviewUseCases.previewTeamPackage,
      importProjectBundle: projectPackageUseCases.importProjectBundle,
      previewProjectBundle: projectPackageUseCases.previewProjectBundle,
      exportProjectTeam: teamPackagePreviewUseCases.exportTeamPackage,
      exportProjectBundle: projectPackageUseCases.exportProjectBundle
    }
  })) return;
  if (await handleTaskRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicTask,
    useCases: { ...taskCreationUseCases, ...taskLifecycleUseCases, getProjectTask, startProjectTask: taskExecutionUseCases.startProjectTask, retryProjectTask: taskRetryUseCases.retryProjectTask }
  })) return;
  if (await handleRunRoutes({
    request, response, url, readBody, sendJson, errorStatus,
    useCases: { ...runQueryUseCases, ...runResultUseCases, listRecentProjectRuns: recentRunUseCases.listRecentProjectRuns }
  })) return;
  if (await handleDeliverableRoutes({
    request, response, url, sendJson, errorStatus,
    useCases: deliverableUseCases
  })) return;
  if (await handleCollaborationProjectRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    useCases: {
      ...teamLifecycleUseCases,
      ...projectReadinessUseCases, ...projectMaterialUseCases,
      getProject, ...projectUpdateUseCases,
      chatTeamAssistant: teamStudioUseCases.chat,
      ...teamAdjustmentUseCases
    },
  })) return;
  if (await handleCaseRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    cases, eventLabels, buildCaseGraph, runCase, createClassicTeamProject: teamLifecycleUseCases.createClassicTeamProject
  })) return;
  if (request.method === "GET") {
    if (url.pathname === "/assets/ogs-studio-graph.js") {
      try {
        const filePath = resolve(root, "../../dist/visualizer/studio-client/studio-graph.js");
        const info = await stat(filePath);
        writeStaticResponse({ request, response, pathname: url.pathname, filePath, contents: await readFile(filePath), info });
      } catch {
        sendJson(response, 503, { error: "Build OGSystem before starting the team site." });
      }
      return;
    }
    const isStudioRoute = url.pathname === "/studio"
      || url.pathname === "/studio/new"
      || url.pathname === "/studio/roles"
      || /^\/studio\/teams\/[a-z0-9-]+\/(?:info|design|run(?:\/[a-z0-9._-]+(?:\/artifacts)?)?|release|simulations)\/?$/.test(url.pathname)
      || /^\/studio\/teams\/[a-z0-9-]+\/versions\/[a-z0-9-]+\/simulations\/[a-z0-9._-]+(?:\/events)?\/?$/.test(url.pathname);
    const isPlatformRoute = ["/platform", "/platform/models", "/platform/role-sources"].includes(url.pathname);
    if (url.pathname === "/" || url.pathname === "/teams" || url.pathname === "/projects" || url.pathname === "/projects/new" || /^\/projects\/[a-z0-9-]+(?:\/(?:teams|runs\/[A-Za-z0-9._-]+))?\/?$/.test(url.pathname) || isPlatformRoute || isStudioRoute || url.pathname === "/examples" || url.pathname === "/history" || /^\/cases\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      await serveStatic("/index.html", request, response, isStudioRoute
        ? { headers: { link: "</assets/ogs-studio-graph.js>; rel=preload; as=script" } }
        : undefined);
      return;
    }
    await serveStatic(url.pathname, request, response, {
      immutable: /^[a-f0-9]{8,}$/i.test(url.searchParams.get("v") || "")
    });
    return;
  }
  sendJson(response, 405, { error: "Method not allowed" });
});

const studioSimulationRetentionDays = Number.parseInt(process.env.OGS_STUDIO_SIMULATION_RETENTION_DAYS || "", 10);
teamLifecycleUseCases.provisionBuiltInTeamTemplates()
  .then(() => runRecoveryUseCases.recoverOrphanedRuns())
  .then(() => studioSimulationUseCases.recoverInterruptedSimulations())
  .then(() => Number.isFinite(studioSimulationRetentionDays) && studioSimulationRetentionDays > 0
    ? studioSimulationUseCases.cleanupExpiredSimulations({ retentionDays: studioSimulationRetentionDays })
    : undefined)
  .then(() => roleSourceSyncScheduler.recoverInterrupted())
  .then(() => {
  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = address && typeof address === "object" ? address.port : port;
    process.stdout.write(`OGS Projects is ready at http://${host}:${boundPort}\n`);
  });
}).catch((error) => {
  process.stderr.write(`Unable to initialize OGS Projects: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function close() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

function dirname(path) {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}
