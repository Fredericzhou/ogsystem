import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FileTeamArtifactStore } from "../../dist/team-ir/index.js";
import { cases } from "./cases.mjs";
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
import { handleProjectRoutes } from "./api/project-routes.mjs";
import { handleTaskRoutes } from "./api/task-routes.mjs";
import { handleTeamIrArtifactRoutes } from "./api/team-ir-artifact-routes.mjs";
import { createTeamIrReviewPrincipalResolver, handleTeamIrReviewRoutes } from "./api/team-ir-review-routes.mjs";
import { handleRunRoutes } from "./api/run-routes.mjs";
import { handleTeamRoutes } from "./api/team-routes.mjs";
import { handleTeamIrSimulationRoutes } from "./api/team-ir-simulation-routes.mjs";
import { errorStatus } from "./api/error-status.mjs";
import { handleCollaborationProjectRoutes } from "./api/collaboration-project-routes.mjs";
import { handlePlatformRoutes } from "./api/platform-routes.mjs";
import { handleSharedResourceRoutes } from "./api/shared-resource-routes.mjs";
import { handleCaseRoutes } from "./api/case-routes.mjs";
import { createTeamVersionLifecycleUseCases } from "./application/team-version-lifecycle-use-cases.mjs";
import { createTeamVersionSaveUseCases } from "./application/team-version-save-use-cases.mjs";
import { createTeamLifecycleUseCases } from "./application/team-lifecycle-use-cases.mjs";
import { createTeamAdjustmentUseCases } from "./application/team-adjustment-use-cases.mjs";
import { createFileTeamLifecycleLocks } from "./infrastructure/file-team-lifecycle-locks.mjs";
import { createRuntimeTeamConfirmation } from "./infrastructure/runtime-team-confirmation.mjs";
import { createProjectReadinessUseCases } from "./application/project-readiness-use-cases.mjs";
import { createRuntimeProjectReadinessInspector } from "./infrastructure/runtime-project-readiness.mjs";
import { createTeamMetadataUseCases } from "./application/team-metadata-use-cases.mjs";
import { createTeamIrUseCases } from "./application/team-ir-use-cases.mjs";
import { createTeamIrArtifactUseCases } from "./application/team-ir-artifact-use-cases.mjs";
import { assertSafeEvidencePath } from "./infrastructure/safe-evidence-path.mjs";
import { createFileTeamIrStore } from "./infrastructure/file-team-ir-store.mjs";
import { createFileTeamIrSimulationStore } from "./infrastructure/file-team-ir-simulation-store.mjs";
import { createTeamIrStudioSimulationUseCases } from "./application/team-ir-studio-simulation-use-cases.mjs";
import { createRuntimeTeamIrProjectRunExecutor } from "./infrastructure/runtime-team-ir-project-run-executor.mjs";
import { createProjectTaskTeamIrReviewContextResolver, createTeamIrReviewUseCases } from "./application/team-ir-review-use-cases.mjs";
import { createRuntimeTeamIrStudioSimulation } from "./infrastructure/runtime-team-ir-studio-simulation.mjs";
import { loadTeamIrV2Resolvers } from "./infrastructure/team-ir-v2-resolvers.mjs";
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
import { createTeamIrTaskAttemptStore } from "./infrastructure/v2-aware-task-attempt-store.mjs";
import { createCollaborationProjectUseCases } from "./application/collaboration-project-use-cases.mjs";
import { createFileCollaborationProjectStore } from "./infrastructure/file-collaboration-project-store.mjs";
import { computeContentDigest, computeProjectDefinitionDigest } from "./infrastructure/package-integrity.mjs";
import { createTaskRetryUseCases } from "./application/task-retry-use-cases.mjs";
import { createTaskExecutionUseCases } from "./application/task-execution-use-cases.mjs";
import { createFileTaskExecutionStore } from "./infrastructure/file-task-execution-store.mjs";
import { taskWorkers, waitForActiveTaskWorker } from "./infrastructure/in-memory-task-workers.mjs";
import { createTaskExecutionIdentifiers } from "./infrastructure/task-execution-identifiers.mjs";
import { createRuntimeTaskExecutionReadiness } from "./infrastructure/runtime-task-execution-readiness.mjs";
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
import { createProjectCreationUseCases } from "./application/project-creation-use-cases.mjs";
import { createFileRunRecoveryStore } from "./infrastructure/file-run-recovery-store.mjs";
import { createBasicControlPlaneIdentityProvider, createLocalControlPlanePrincipal } from "../../dist/runtime/identity.js";
import { parseMarkdownRole, convertMarkdownRole } from "../../tools/agent-source/markdown-role-adapter.mjs";
import { handleRoleSourceCatalogRoutes } from "./api/role-source-catalog-routes.mjs";
import { handleRoleSourceAdminRoutes } from "./api/role-source-admin-routes.mjs";
import { createRoleSourceCatalogUseCases } from "./application/role-source-catalog-use-cases.mjs";
import { createRoleSourceSyncScheduler } from "./application/role-source-sync-scheduler.mjs";
import { createFileRoleSourceCatalogStore } from "./infrastructure/file-role-source-catalog-store.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, "public");
const classicTeamIrFixtures = Object.fromEntries(await Promise.all(cases.map(async ({ id }) => [
  id,
  JSON.parse(await readFile(resolve(root, "../../examples/team-ir-v2", `classic-${id}.json`), "utf8"))
])));
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
const discoveryWorkdir = process.env.OGS_VIS_WORKDIR || join(process.env.LOCALAPPDATA || process.cwd(), "OGSystem", "visualizer-workspace");
const siteProjectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"));
const teamIrReviewBasicIdentityProvider = process.env.OGS_TEAM_IR_REVIEW_USERNAME && process.env.OGS_TEAM_IR_REVIEW_PASSWORD
  ? createBasicControlPlaneIdentityProvider({ username: process.env.OGS_TEAM_IR_REVIEW_USERNAME, password: process.env.OGS_TEAM_IR_REVIEW_PASSWORD })
  : undefined;
const resolveTeamIrReviewPrincipal = createTeamIrReviewPrincipalResolver({
  createLocalPrincipal: createLocalControlPlanePrincipal,
  basicIdentityProvider: teamIrReviewBasicIdentityProvider
});
const platformConfigRoot = resolve(process.env.OGS_PLATFORM_CONFIG_DIR || join(siteProjectsRoot, ".site"));
const taskAttemptStore = createTeamIrTaskAttemptStore({ projectsRoot: siteProjectsRoot });
const projectQueryUseCases = createProjectQueryUseCases({
  projectStore: { getProject: readProject },
  taskAttemptStore,
  waitForActiveTaskWorker,
  workspaceInspector: projectVisualizerStore.inspectWorkspace
});
const getProject = projectQueryUseCases.getProject;
const getProjectTask = projectQueryUseCases.getProjectTask;
const projectCreationUseCases = createProjectCreationUseCases({
  projectStore: { createProject: createFileProjectRecord, saveProjectMetadata, removeProjectData },
  workspaceStore: {
    createWorkspace: projectVisualizerStore.createWorkspace,
    inspectWorkspace: projectVisualizerStore.inspectWorkspace
  },
  projectQuery: { getProject }
});
const createProject = projectCreationUseCases.createProject;
const platformSettingsPath = join(platformConfigRoot, "platform-settings.json");
const platformSettingsStore = createFilePlatformSettings({ path: platformSettingsPath });
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
const teamIrStore = createFileTeamIrStore();
const teamIrV2Resolvers = await loadTeamIrV2Resolvers();
const runtimeTeamReadinessInspector = createRuntimeProjectReadinessInspector({
  teamIrStore,
  resolveReleaseClosure: teamIrV2Resolvers.resolveTeamIrReleaseClosure,
  resolveBindings: teamIrV2Resolvers.resolveBindings
});
const taskExecutionReadiness = createRuntimeTaskExecutionReadiness({
  inspect: runtimeTeamReadinessInspector.inspect,
  teamIrStore,
  confirmation: createRuntimeTeamConfirmation({ teamIrStore })
});
const teamIrProjectRunExecutor = createRuntimeTeamIrProjectRunExecutor({
  teamStore: { getTeamVersion: getProject },
  teamIrStore,
  resolveReleaseClosure: teamIrV2Resolvers.resolveTeamIrReleaseClosure,
  resolveBindings: teamIrV2Resolvers.resolveBindings,
  authorizeTeamIrReviewer: teamIrV2Resolvers.authorizeTeamIrReviewer,
  artifactStoreFactory: async ({ project, projectRoot }) => {
    await assertSafeEvidencePath(projectRoot, [".ogs"], { kind: "directory", label: "Project evidence" });
    await assertSafeEvidencePath(projectRoot, [".ogs", "team-artifacts"], { kind: "directory", allowMissingFinal: true, label: "Project Team IR Artifacts" });
    return new FileTeamArtifactStore(join(projectRoot, ".ogs", "team-artifacts"));
  }
});
const teamIrArtifactUseCases = createTeamIrArtifactUseCases({
  getProject,
  getTeamVersion: getProject,
  teamIrStore,
  artifactStoreFactory: async ({ project }) => {
    const projectRoot = resolve(project.workdir);
    await assertSafeEvidencePath(projectRoot, [".ogs"], { kind: "directory", label: "Project evidence" });
    await assertSafeEvidencePath(projectRoot, [".ogs", "team-artifacts"], { kind: "directory", allowMissingFinal: true, label: "Project Team IR Artifacts" });
    return new FileTeamArtifactStore(join(projectRoot, ".ogs", "team-artifacts"));
  }
});
let taskExecutionUseCases;
const teamIrReviewUseCases = createTeamIrReviewUseCases({
  projectStore: { getProject },
  resolveReviewContext: createProjectTaskTeamIrReviewContextResolver({
    teamIrProjectRunExecutor,
    getTaskExecutionUseCases: () => taskExecutionUseCases
  })
});
const projectMaterialUseCases = createProjectMaterialUseCases({
  projectStore: { getProject, withProjectWriteLock },
  materialStore: createFileProjectMaterialStore({ computeProjectDefinitionDigest }),
  confirmation: { assertCurrent: taskExecutionReadiness.requireCurrentConfirmation }
});
taskExecutionUseCases = createTaskExecutionUseCases({
  projectStore: { getProject },
  teamStore: { getTeamVersion: getProject },
  attemptStore: createFileTaskExecutionStore({ projectStore: { getProject, withProjectWriteLock, saveTaskRecord } }),
  workerStore: taskWorkers,
  teamIrRunStore: teamIrProjectRunExecutor,
  readiness: taskExecutionReadiness,
  identifiers: createTaskExecutionIdentifiers()
});
const controlProjectRunWithApplication = async (projectId, runId, control) => {
  const project = await getProject(projectId);
  const task = (project.taskRecords || []).find((item) => !item.deletedAt && item.runIds?.includes(runId));
  if (!task || task.currentRunId !== runId) throw new Error("PROJECT_RUN_OWNER_INVALID: Run identity does not match the current Collaboration Project Task.");
  const attemptNumber = task.runIds.indexOf(runId) + 1;
  return teamIrProjectRunExecutor.control(project, {
    runId,
    taskId: task.taskId,
    taskNumber: task.taskNumber,
    attemptNumber,
    teamVersionId: task.teamVersionId,
    teamIrSemanticDigest: task.teamIrSemanticDigest,
    compiledPlanDigest: task.compiledPlanDigest,
    attachments: task.runInputAttachments || {},
    prompt: task.input,
    mode: "sandbox"
  }, control);
};
const taskRetryUseCases = createTaskRetryUseCases({
  taskStore: { startTask: taskExecutionUseCases.startProjectTask },
  projectStore: { getProject },
  runStore: createFileTaskRetryStore()
});
const taskCreationUseCases = createTaskCreationUseCases({
  projectStore: { getProject, withProjectWriteLock, saveProjectMetadata },
  taskStore: createTaskIdentifiers(),
  fingerprintRequest: computeContentDigest,
  validateRunInputAttachments: teamIrArtifactUseCases.validateRunInputAttachments
});
const taskLifecycleUseCases = createTaskLifecycleUseCases({
  projectStore: createFileTaskLifecycleStore({
    getProject,
    withProjectWriteLock,
    saveTaskRecord,
    controlRun: controlProjectRunWithApplication
  }),
  runControlStore: { controlRun: controlProjectRunWithApplication }
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
const teamCatalog = createFileTeamCatalog({ projectsRoot: siteProjectsRoot });
const teamCatalogUseCases = createTeamCatalogUseCases({ teamCatalog });
const projectUpdateUseCases = createProjectUpdateUseCases({
  projectStore: { getProject, withProjectWriteLock, saveProjectMetadata },
  teamCatalog,
  computeProjectDefinitionDigest
});
const projectReadinessUseCases = createProjectReadinessUseCases({
  getProject,
  readinessInspector: runtimeTeamReadinessInspector
});
const teamMetadataUseCases = createTeamMetadataUseCases({
  teamCatalog,
  teamMetadataStore: { saveTeamMetadata: saveProjectMetadata },
  withTeamVersionLock: teamLifecycleLocks.withTeamVersionLock
});
const teamIrUseCases = createTeamIrUseCases({
  teamCatalog,
  teamIrStore,
  withTeamVersionLock: teamLifecycleLocks.withTeamVersionLock,
  resolveTeamIrReleaseClosure: teamIrV2Resolvers.resolveTeamIrReleaseClosure,
  getTeamIrAuthoringCatalog: teamIrV2Resolvers.getTeamIrAuthoringCatalog
});
const teamIrStudioSimulationUseCases = createTeamIrStudioSimulationUseCases({
  teamCatalog,
  teamIrStore,
  simulationStore: createFileTeamIrSimulationStore({ projectsRoot: siteProjectsRoot }),
  artifactStoreFactory: async ({ teamVersionId }) => {
    const root = resolve(siteProjectsRoot, ".studio", "team-ir-v2-simulation-artifacts", teamVersionId);
    await mkdir(root, { recursive: true });
    await assertSafeEvidencePath(siteProjectsRoot, [".studio"], { kind: "directory", label: "Studio state" });
    await assertSafeEvidencePath(siteProjectsRoot, [".studio", "team-ir-v2-simulation-artifacts"], { kind: "directory", allowMissingFinal: true, label: "Studio Simulation Artifact store" });
    await assertSafeEvidencePath(siteProjectsRoot, [".studio", "team-ir-v2-simulation-artifacts", teamVersionId], { kind: "directory", label: "Studio Simulation Artifact TeamVersion" });
    return new FileTeamArtifactStore(root);
  },
  resolveReleaseClosure: teamIrV2Resolvers.resolveTeamIrReleaseClosure,
  resolveBindings: teamIrV2Resolvers.resolveBindings,
  identifiers: {
    simulationId: randomUUID,
    artifactScopeId: (teamVersionId, scopeId) => createHash("sha256").update(`${teamVersionId}\0${scopeId}`).digest("hex").slice(0, 48)
  },
  simulationRunner: createRuntimeTeamIrStudioSimulation()
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
  adapters: roleSourceAdapters
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
    createNativeTeamIrProject: createFileProjectRecord,
    saveProjectMetadata,
    removeProject,
    removeProjectData,
    withProjectWriteLock
  },
  locks: teamLifecycleLocks,
  confirmation: createRuntimeTeamConfirmation({ teamIrStore }),
  releaseEvidence: {
    validateTeamIrReleaseEvidence: (input) => teamIrStudioSimulationUseCases.validateReleaseEvidence(input)
  },
  teamIrRelease: teamIrUseCases,
  teamIrFixtures: classicTeamIrFixtures,
  caseCatalog: { getCase: (caseId) => cases.find((item) => item.id === caseId), listCases: () => cases },
  assertTrustedTeamTopology: (team) => ["classic", "classic-template"].includes(team.source) && Boolean(team.caseId)
});
const teamAdjustmentUseCases = createTeamAdjustmentUseCases({
  projectStore: { getProject },
  getTeamVersion: teamCatalog.getTeamVersion
});
const teamVersionSaveUseCases = createTeamVersionSaveUseCases({
  teamCatalog,
  teamMetadataUseCases,
  lifecycleUseCases: teamLifecycleUseCases,
  withTeamVersionSaveLock: teamLifecycleLocks.withTeamVersionSaveLock,
  removeProject,
  digestSnapshot: (value) => createHash("sha256").update(value).digest("hex")
});

function publicProject(project) {
  const { workdir, ...safe } = project;
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

async function serveStatic(pathname, response) {
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
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    response.end(contents);
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
  if (await handleTeamIrSimulationRoutes({
    request, response, url, readBody, sendJson, errorStatus,
    useCases: teamIrStudioSimulationUseCases
  })) return;
  if (await handleTeamRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    useCases: {
      ...teamCatalogUseCases,
      ...teamLifecycleUseCases,
      ...teamMetadataUseCases,
      ...teamIrUseCases,
      ...teamVersionSaveUseCases,
      getTeamVersion: teamVersionSaveUseCases.getTeamVersionForSave,
      archiveTeamVersion: teamVersionLifecycleUseCases.archiveTeamVersion,
      deleteTeamVersion: teamVersionLifecycleUseCases.deleteTeamVersion,
      deleteTeam: teamVersionLifecycleUseCases.deleteTeam
    }
  })) return;
  if (await handleTaskRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicTask,
    useCases: { ...taskCreationUseCases, ...taskLifecycleUseCases, getProjectTask, startProjectTask: taskExecutionUseCases.startProjectTask, retryProjectTask: taskRetryUseCases.retryProjectTask }
  })) return;
  if (await handleTeamIrArtifactRoutes({
    request, response, url, readBody, sendJson, errorStatus,
    useCases: teamIrArtifactUseCases
  })) return;
  if (await handleTeamIrReviewRoutes({
    request, response, url, readBody, sendJson, errorStatus,
    useCases: teamIrReviewUseCases,
    resolvePrincipal: resolveTeamIrReviewPrincipal
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
      ...teamAdjustmentUseCases
    },
  })) return;
  if (await handleCaseRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    cases, teamIrFixtures: classicTeamIrFixtures, createClassicTeamProject: teamLifecycleUseCases.createClassicTeamProject
  })) return;
  if (request.method === "GET") {
    if (url.pathname === "/") {
      response.writeHead(302, { location: "/projects", "cache-control": "no-store" });
      response.end();
      return;
    }
    if (url.pathname === "/examples") {
      response.writeHead(302, { location: "/teams", "cache-control": "no-store" });
      response.end();
      return;
    }
    const isStudioRoute = url.pathname === "/studio"
      || url.pathname === "/studio/new"
      || url.pathname === "/studio/roles"
      || /^\/studio\/teams\/[a-z0-9-]+\/(?:info|ir|release)\/?$/.test(url.pathname);
    const isPlatformRoute = ["/platform", "/platform/models", "/platform/role-sources"].includes(url.pathname);
    if (url.pathname === "/teams" || url.pathname === "/projects" || url.pathname === "/projects/new" || /^\/projects\/[a-z0-9-]+(?:\/(?:teams|runs\/[A-Za-z0-9._-]+))?\/?$/.test(url.pathname) || isPlatformRoute || isStudioRoute || url.pathname === "/history" || /^\/cases\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      await serveStatic("/index.html", response);
      return;
    }
    await serveStatic(url.pathname, response);
    return;
  }
  sendJson(response, 405, { error: "Method not allowed" });
});

teamLifecycleUseCases.provisionBuiltInTeamTemplates()
  .then(() => runRecoveryUseCases.recoverOrphanedRuns())
  .then(() => teamIrStudioSimulationUseCases.recoverAllInterruptedSimulations())
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
