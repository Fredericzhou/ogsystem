import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectModelRef } from "../../dist/runtime/model-selection.js";
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
  listProjects
} from "./infrastructure/file-project-store.mjs";
import { createFilePackageStore } from "./infrastructure/file-package-store.mjs";
import { createVisualizerAdapter } from "./infrastructure/visualizer-adapter.mjs";
import { resolveTeamStudioModelRef } from "./capabilities/team-studio-model.mjs";
import { handleProjectRoutes } from "./api/project-routes.mjs";
import { handleTaskRoutes } from "./api/task-routes.mjs";
import { handleRunRoutes } from "./api/run-routes.mjs";
import { handleTeamRoutes } from "./api/team-routes.mjs";
import { handlePackageRoutes } from "./api/package-routes.mjs";
import { handleCollaborationProjectRoutes } from "./api/collaboration-project-routes.mjs";
import { handlePlatformRoutes } from "./api/platform-routes.mjs";
import { handleCaseRoutes } from "./api/case-routes.mjs";
import { createTeamStudioUseCases } from "./application/team-studio-use-cases.mjs";
import { createTeamVersionLifecycleUseCases } from "./application/team-version-lifecycle-use-cases.mjs";
import { createTeamLifecycleUseCases } from "./application/team-lifecycle-use-cases.mjs";
import { createTeamAdjustmentUseCases } from "./application/team-adjustment-use-cases.mjs";
import { createFileTeamLifecycleLocks } from "./infrastructure/file-team-lifecycle-locks.mjs";
import { createRuntimeTeamConfirmation } from "./infrastructure/runtime-team-confirmation.mjs";
import { createTeamSimulationUseCases } from "./application/team-simulation-use-cases.mjs";
import { createRuntimeTeamSimulation } from "./infrastructure/runtime-team-simulation.mjs";
import { createProjectReadinessUseCases } from "./application/project-readiness-use-cases.mjs";
import { createRuntimeProjectReadinessInspector } from "./infrastructure/runtime-project-readiness.mjs";
import { createProjectDesignValidationUseCases } from "./application/project-design-validation-use-cases.mjs";
import { createVisualizerProjectDesignValidator } from "./infrastructure/visualizer-project-design-validator.mjs";
import { createProjectDesignProjectionUseCases } from "./application/project-design-projection-use-cases.mjs";
import { createVisualizerProjectDesignProjector } from "./infrastructure/visualizer-project-design-projector.mjs";
import { createFileTeamVersionLifecycle } from "./infrastructure/file-team-version-lifecycle.mjs";
import { createPlatformUseCases } from "./application/platform-use-cases.mjs";
import { createFilePlatformSettings } from "./infrastructure/file-platform-settings.mjs";
import { createModelCatalog } from "./infrastructure/model-catalog.mjs";
import { createModelAvailabilityProbe } from "./infrastructure/model-availability-probe.mjs";
import { createTeamCatalogUseCases } from "./application/team-catalog-use-cases.mjs";
import { createFileTeamCatalog } from "./infrastructure/file-team-catalog.mjs";
import { createRunResultUseCases } from "./application/run-result-use-cases.mjs";
import { createFileRunResultStore } from "./infrastructure/file-run-result-store.mjs";
import { createRunQueryUseCases } from "./application/run-query-use-cases.mjs";
import { createFileRunQueryStore } from "./infrastructure/file-run-query-store.mjs";
import { createRecentRunUseCases } from "./application/recent-run-use-cases.mjs";
import { createFileRecentRunStore } from "./infrastructure/file-recent-run-store.mjs";
import { createTeamPackagePreviewUseCases } from "./application/team-package-preview-use-cases.mjs";
import { createProjectPackageUseCases } from "./application/project-package-use-cases.mjs";
import { createCollaborationProjectUseCases } from "./application/collaboration-project-use-cases.mjs";
import { createFileCollaborationProjectStore } from "./infrastructure/file-collaboration-project-store.mjs";
import { normalizeMaterialPath } from "./domain/material-path.mjs";
import { computeContentDigest, computePackageDigest, computeProjectDefinitionDigest, computeTeamPackageCoreDigest } from "./infrastructure/package-integrity.mjs";
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
import { projectVisualizerStore } from "./infrastructure/project-visualizer-store.mjs";
import { caseTeamMaterializer } from "./infrastructure/case-team-materializer.mjs";
import { createProjectCreationUseCases } from "./application/project-creation-use-cases.mjs";
import { createFileRunRecoveryStore } from "./infrastructure/file-run-recovery-store.mjs";
import { createRuntimeTaskReviewStore } from "./infrastructure/runtime-task-review-store.mjs";
import { listHumanReviews, writeHumanReviewDecision } from "../../dist/runtime/project-lifecycle.js";
import { createLocalControlPlanePrincipal } from "../../dist/runtime/identity.js";

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
const filePackageStore = createFilePackageStore();
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
const projectRunUseCases = createProjectRunUseCases({
  projectStore: { getProject },
  runStore: { ...createFileProjectRunStore(), ...createRuntimeProjectRunExecutor({ getDefaultModelSelection: getPlatformDefaultModelSelection }) },
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
  projectStore: { getProject },
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
async function getPlatformDefaultModelSelection() {
  const [settings, discovery] = await Promise.all([
    platformUseCases.readPlatformSettings(),
    platformUseCases.getPlatformDiscovery()
  ]);
  const models = (discovery.models || []).filter((model) => model.runnable);
  const configured = String(settings.defaultModel || "default");
  const selected = configured === "default"
    ? models.find((model) => model.backend === settings.defaultProvider)
    : models.find((model) => model.ref === configured || model.id === configured && model.backend === settings.defaultProvider);
  return selected ? {
    modelSelectionDefaults: { backend: selected.backend, modelId: selected.id },
    modelCatalogGeneratedAt: discovery.generatedAt,
    modelCatalogModels: models.map((model) => ({
      backend: model.backend,
      modelId: model.id,
      ref: model.ref || `${model.backend}/${model.id}`,
      provider: model.provider || model.backend,
      model: model.id,
      name: model.name,
      status: model.status || "active",
      runnable: true,
      capabilities: model.capabilities || { textInput: true, textOutput: true, toolcall: false },
      variants: []
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
const teamSimulationUseCases = createTeamSimulationUseCases({
  teamCatalog,
  simulationRunner: createRuntimeTeamSimulation({ getDefaultModelSelection: getPlatformDefaultModelSelection })
});
const projectReadinessUseCases = createProjectReadinessUseCases({
  getProject,
  readinessInspector: createRuntimeProjectReadinessInspector()
});
const projectDesignValidator = createVisualizerProjectDesignValidator();
const projectDesignValidationUseCases = createProjectDesignValidationUseCases({
  getProject,
  designValidator: projectDesignValidator
});
const projectDesignProjectionUseCases = createProjectDesignProjectionUseCases({
  getProject,
  withProjectWriteLock,
  designStore: createVisualizerProjectDesignStore(),
  designProjector: createVisualizerProjectDesignProjector(),
  designSerializer: { serialize: serializeAuthoringToMermaid }
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
const recentRunUseCases = createRecentRunUseCases({
  listProjects,
  runArtifactStore: taskAttemptStore
});
const runRecoveryUseCases = createRunRecoveryUseCases({
  recoveryStore: createFileRunRecoveryStore({ projectsRoot: siteProjectsRoot })
});

function errorStatus(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/PROJECT_NOT_CONFIRMED|PROJECT_LOCK_CONFLICT|PROJECT_NAME_EXISTS|PROJECT_TEAM_REQUIRED|PROJECT_TEAM_UPDATE_LOCKED|TEAM_NAME_EXISTS|TEAM_VERSION_NOT_RELEASED|IDEMPOTENCY_KEY_REUSE|PROJECT_TASK_CONCURRENCY_LIMIT|TASK_CONTROL_INVALID|TASK_START_NOT_ALLOWED|TASK_EXECUTION_UNAVAILABLE|TASK_RESUME_NOT_ALLOWED|TASK_REVIEW_NOT_ALLOWED|IMPORT_CONFLICT|active|conflict/i.test(message)) return 409;
  if (/PROJECT_NOT_READY/i.test(message)) return 422;
  if (/not found|TASK_NOT_FOUND/i.test(message)) return 404;
  if (/REAL_RUN_UNSUPPORTED/i.test(message)) return 501;
  return 400;
}

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
  isDirectModelRef,
  resolveTeamStudioModelRef
});
const teamVersionLifecycle = createFileTeamVersionLifecycle({ getTeamVersion: getProject });
const teamVersionLifecycleUseCases = createTeamVersionLifecycleUseCases({
  teamVersions: { ...teamVersionLifecycle, getTeamVersion: getProject }
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
  caseCatalog: { getCase: (caseId) => cases.find((item) => item.id === caseId), listCases: () => cases },
  assertTrustedTeamTopology: (team) => ["classic", "classic-template"].includes(team.source) && Boolean(team.caseId)
});
const teamAdjustmentUseCases = createTeamAdjustmentUseCases({
  projectStore: { getProject },
  forkTeamVersion: teamLifecycleUseCases.forkTeamVersion
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
  if (await handlePlatformRoutes({ request, response, url, readBody, sendJson, visUrl, useCases: platformUseCases })) return;
  if (await handleProjectRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    useCases: collaborationProjectUseCases
  })) return;
  if (await handleTeamRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    useCases: { ...teamCatalogUseCases, ...teamLifecycleUseCases, archiveTeamVersion: teamVersionLifecycleUseCases.archiveTeamVersion, ...teamSimulationUseCases }
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
  if (await handleCollaborationProjectRoutes({
    request, response, url, readBody, sendJson, errorStatus, publicProject,
    useCases: {
      ...teamLifecycleUseCases, ...projectDesignProjectionUseCases, ...projectDesignValidationUseCases,
      ...projectReadinessUseCases, ...projectMaterialUseCases,
      startProjectRun: projectRunUseCases.startProjectRun, getProject, ...projectUpdateUseCases,
      chatTeamAssistant: teamStudioUseCases.chat,
      visualizerUrl: visUrl,
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
        response.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff"
        });
        response.end(await readFile(resolve(root, "../../dist/visualizer/studio-client/studio-graph.js")));
      } catch {
        sendJson(response, 503, { error: "Build OGSystem before starting the team site." });
      }
      return;
    }
    if (url.pathname === "/" || url.pathname === "/studio" || url.pathname === "/projects" || url.pathname === "/platform" || url.pathname === "/factory" || url.pathname === "/factory/new" || url.pathname === "/studio/project/new" || /^\/studio\/project\/[a-z0-9-]+\/(?:run|teams)\/?$/.test(url.pathname) || /^\/studio\/team\/[a-z0-9-]+\/?$/.test(url.pathname) || url.pathname === "/examples" || url.pathname === "/history" || /^\/cases\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      await serveStatic("/index.html", response);
      return;
    }
    await serveStatic(url.pathname, response);
    return;
  }
  sendJson(response, 405, { error: "Method not allowed" });
});

teamLifecycleUseCases.provisionBuiltInTeamVersions().then(() => runRecoveryUseCases.recoverOrphanedRuns()).then(() => {
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
