import { createServer } from "node:http";
import { mkdir, readFile, stat, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverLocalModelCatalog, isModelCatalogStale } from "../../dist/runtime/model-catalog.js";
import { isDirectModelRef } from "../../dist/runtime/model-selection.js";
import { cases } from "./cases.mjs";
import { buildCaseGraph, runCase } from "./demo-runner.mjs";
import { eventLabels } from "./event-labels.mjs";
import {
  addProjectMaterial,
  addProjectMaterials,
  createProject,
  createProjectWorkspace,
  createClassicTeamProject,
  confirmProjectTeam,
  exportProjectTeam,
  exportProjectBundle,
  getProjectGraph,
  getProjectDesign,
  getProjectReadiness,
  validateProjectDesign,
  saveProjectDesign,
  getProject,
  importTeamPackage,
  importProjectBundle,
  previewTeamPackage,
  previewProjectBundle,
  simulateTeamVersion,
  listProjects,
  listCollaborationProjects,
  createProjectTask,
  startProjectTask,
  controlProjectTask,
  reviewProjectTask,
  deleteProjectTask,
  retryProjectRun,
  controlProjectRun,
  getProjectRun,
  getProjectTask,
  getProjectRunEvents,
  startProjectRun,
  updateProject
  ,listTeamFactory
  ,listTeamRepository
  ,queryTeamRepository
  ,forkTeamVersion
  ,releaseTeamVersion
  ,archiveTeamVersion
  ,listRecentProjectRuns
} from "./project-repository.mjs";
import { recoverOrphanedRuns } from "./run-service.mjs";
import { createVisualizerAdapter } from "./capabilities/visualizer-adapter.mjs";
import { resolveTeamStudioModelRef } from "./capabilities/team-studio-model.mjs";
import { handleProjectRoutes } from "./api/project-routes.mjs";

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
const discoveryCacheMs = 30_000;
const siteProjectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"));
const platformSettingsPath = join(siteProjectsRoot, ".site", "platform-settings.json");
const defaultPlatformSettings = { defaultProvider: "codex", defaultModel: "default", timeoutSeconds: 120, retryCount: 1 };
let discoveryCache;
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

function providerLabel(backend) {
  return ({ codex: "Codex", opencode: "OpenCode", claude: "Claude", antigravity: "Antigravity", openai: "OpenAI", code2: "Code2", multidebate: "Multi Debate" })[backend] || backend;
}

async function getPlatformDiscovery(force = false) {
  const now = Date.now();
  if (!force && discoveryCache && now - discoveryCache.at < discoveryCacheMs) return discoveryCache.value;
  const promise = (async () => {
    await mkdir(discoveryWorkdir, { recursive: true });
    const catalog = await discoverLocalModelCatalog({ workdir: discoveryWorkdir });
    return {
      generatedAt: catalog.generatedAt,
      stale: isModelCatalogStale(catalog),
      workdir: discoveryWorkdir,
      sources: catalog.sources.map((source) => ({
        ...source,
        backend: source.backend,
        name: providerLabel(source.backend)
      })),
      models: catalog.models.map((model) => ({
        id: model.modelId,
        name: model.name || model.modelId,
        provider: model.provider || model.backend,
        providerName: providerLabel(model.provider || model.backend),
        status: model.status || (model.runnable ? "active" : "unavailable"),
        runnable: Boolean(model.runnable),
        capabilities: model.capabilities,
        ref: model.ref
      }))
    };
  })();
  discoveryCache = { at: now, value: promise };
  try {
    return await promise;
  } catch (error) {
    if (discoveryCache?.value === promise) discoveryCache = undefined;
    throw error;
  }
}

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

async function readPlatformSettings() {
  try { return { ...defaultPlatformSettings, ...JSON.parse(await readFile(platformSettingsPath, "utf8")), runtimeApplied: false }; }
  catch { return { ...defaultPlatformSettings, runtimeApplied: false }; }
}

async function writePlatformSettings(settings) {
  await mkdir(join(siteProjectsRoot, ".site"), { recursive: true });
  const temp = `${platformSettingsPath}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2) + "\n", "utf8");
  await rename(temp, platformSettingsPath);
}

function publicProject(project) {
  const { workdir, ...safe } = project;
  if (safe.workspace && typeof safe.workspace === "object") {
    const { workdir: workspaceWorkdir, ...workspace } = safe.workspace;
    safe.workspace = workspace;
  }
  if (Array.isArray(safe.taskRecords)) {
    safe.taskRecords = safe.taskRecords.map((task) => {
      const { requestFingerprint, ...publicTask } = task;
      return publicTask;
    });
  }
  return safe;
}

function publicTask(task) {
  if (!task || typeof task !== "object") return task;
  const { requestFingerprint, ...safe } = task;
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
  if (request.method === "GET" && url.pathname === "/api/v1/cases") {
    sendJson(response, 200, { eventLabels, cases: cases.map((item) => ({
      id: item.id,
      title: item.title,
      short: item.short,
      category: item.category,
      duration: item.duration,
      accent: item.accent,
      icon: item.icon,
      detail: item.detail,
      layout: item.layout,
      roles: item.roles.map(({ id, label }) => ({ id, label, description: item.detail?.roles?.[id] })),
      flows: item.flows.map(([from, to, event]) => ({ from, to, event })),
      joins: item.joins.map(({ roleId }) => ({ roleId }))
    })) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/config") {
    sendJson(response, 200, { visUrl });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/projects") {
    sendJson(response, 200, { projects: (await listCollaborationProjects()).map(publicProject) });
    return;
  }
  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/v1/platform/discovery") {
    try {
      const discovery = await getPlatformDiscovery(request.method === "POST");
      sendJson(response, 200, discovery);
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform tools." });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/platform/providers") {
    try {
      const discovery = await getPlatformDiscovery();
      sendJson(response, 200, { providers: discovery.sources.map(({ backend, name, status, command, detail }) => ({ id: backend, name, status, command, detail })) });
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform providers." });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/platform/models") {
    try {
      const discovery = await getPlatformDiscovery();
      sendJson(response, 200, { models: discovery.models });
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform models." });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/platform/settings") {
    sendJson(response, 200, { settings: await readPlatformSettings() });
    return;
  }
  if (request.method === "PUT" && url.pathname === "/api/v1/platform/settings") {
    try {
      const payload = await readBody(request);
      const timeoutSeconds = Number(payload.timeoutSeconds);
      const retryCount = Number(payload.retryCount);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 3600) throw new Error("timeoutSeconds must be between 10 and 3600.");
      if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 5) throw new Error("retryCount must be between 0 and 5.");
      const settings = {
        defaultProvider: String(payload.defaultProvider || "codex").trim(),
        defaultModel: String(payload.defaultModel || "default").trim(),
        timeoutSeconds,
        retryCount,
        updatedAt: new Date().toISOString(),
        runtimeApplied: false
      };
      await writePlatformSettings(settings);
      sendJson(response, 200, { settings });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Unable to update platform settings." });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/team-factory") {
    sendJson(response, 200, { teams: (await listTeamFactory()).map(publicProject) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/team-repository") {
    const result = await queryTeamRepository({
      query: url.searchParams.get("query") || "",
      category: url.searchParams.get("category") || "",
      status: url.searchParams.get("status") || "released",
      sort: url.searchParams.get("sort") || "updated",
      page: url.searchParams.get("page") || 1,
      pageSize: url.searchParams.get("pageSize") || 12
    });
    sendJson(response, 200, { ...result, teams: result.teams.map(publicProject) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/runs/recent") {
    sendJson(response, 200, { runs: await listRecentProjectRuns(Number(url.searchParams.get("limit") || 50)) });
    return;
  }
  if (await handleProjectRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject })) return;
  if (request.method === "POST" && url.pathname === "/api/v1/team-factory") {
    try {
      const payload = await readBody(request);
      const team = await createProject({
        name: payload.name,
        overview: payload.overview,
        templateId: "empty",
        source: "team-factory",
        locale: payload.locale
      });
      sendJson(response, 201, publicProject(team));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create team draft." });
    }
    return;
  }
  const projectTaskMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks$/);
  if (projectTaskMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      sendJson(response, 201, publicTask(await createProjectTask(projectTaskMatch[1], payload)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create project task." });
    }
    return;
  }
  const projectTaskGetMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)$/);
  if (projectTaskGetMatch && request.method === "GET") {
    try {
      sendJson(response, 200, publicTask(await getProjectTask(projectTaskGetMatch[1], projectTaskGetMatch[2])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read project task." });
    }
    return;
  }
  const projectTaskActionMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)\/(start|pause|resume|cancel|review)$/);
  if (projectTaskActionMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      const projectId = projectTaskActionMatch[1];
      const taskId = projectTaskActionMatch[2];
      const action = projectTaskActionMatch[3];
      const result = action === "review"
        ? await reviewProjectTask(projectId, taskId, payload)
        : action === "start"
          ? await startProjectTask(projectId, taskId, payload)
          : await controlProjectTask(projectId, taskId, action);
      const responsePayload = action === "start"
        ? result?.task
          ? { ...result, task: publicTask(result.task) }
          : { task: publicTask(result) }
        : result?.task
          ? { ...result, task: publicTask(result.task) }
          : publicTask(result);
      sendJson(response, action === "start" ? 202 : 200, responsePayload);
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to control project task." });
    }
    return;
  }
  const projectTaskDeleteMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)$/);
  if (projectTaskDeleteMatch && request.method === "DELETE") {
    try {
      sendJson(response, 200, publicTask(await deleteProjectTask(projectTaskDeleteMatch[1], projectTaskDeleteMatch[2])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to delete project task." });
    }
    return;
  }
  const workspaceCreateMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/workspaces$/);
  if (workspaceCreateMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      sendJson(response, 201, publicProject(await createProjectWorkspace(workspaceCreateMatch[1], {
        name: payload.name,
        workspaceKey: payload.workspaceKey,
        locale: payload.locale
      })));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create project workspace." });
    }
    return;
  }
  const forkTeamMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/edit$/);
  if (forkTeamMatch && request.method === "POST") {
    try { sendJson(response, 201, publicProject(await forkTeamVersion(forkTeamMatch[1]))); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to edit team version." }); }
    return;
  }
  const releaseTeamMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/release$/);
  if (releaseTeamMatch && request.method === "POST") {
    try { sendJson(response, 200, publicProject(await releaseTeamVersion(releaseTeamMatch[1]))); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to release team version." }); }
    return;
  }
  const archiveTeamMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/archive$/);
  if (archiveTeamMatch && request.method === "POST") {
    try { sendJson(response, 200, publicProject(await archiveTeamVersion(archiveTeamMatch[1]))); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to archive team version." }); }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/team-packages/import") {
    try {
      const payload = await readBody(request, 8 * 1024 * 1024);
      const { conflictStrategy, teamName, ...bundle } = payload || {};
      const imported = await importTeamPackage(bundle, { conflictStrategy: conflictStrategy || "reject", name: teamName });
      sendJson(response, 201, publicProject(imported));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to import project." });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/team-packages/preview") {
    try {
      const payload = await readBody(request, 8 * 1024 * 1024);
      sendJson(response, 200, await previewTeamPackage(payload));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to preview package." });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/project-packages/import") {
    try {
      const payload = await readBody(request, 8 * 1024 * 1024);
      const { conflictStrategy, ...bundle } = payload || {};
      sendJson(response, 201, publicProject(await importProjectBundle(bundle, { conflictStrategy: conflictStrategy || "reject" })));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to import project." });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/project-packages/preview") {
    try {
      sendJson(response, 200, await previewProjectBundle(await readBody(request, 8 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to preview project package." });
    }
    return;
  }
  const exportMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team\/export$/);
  if (exportMatch && request.method === "GET") {
    try {
      const bundle = await exportProjectTeam(exportMatch[1]);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${exportMatch[1]}.team.ogs.json"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      response.end(JSON.stringify(bundle, null, 2));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to export project." });
    }
    return;
  }
  const projectExportMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/export$/);
  if (projectExportMatch && request.method === "GET") {
    try {
      const bundle = await exportProjectBundle(projectExportMatch[1]);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${projectExportMatch[1]}.project.ogs.json"`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      response.end(JSON.stringify(bundle, null, 2));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to export project." });
    }
    return;
  }
  const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)(?:\/(materials|runs))?$/);
  const teamChatMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team\/chat$/);
  if (teamChatMatch && request.method === "POST") {
    try {
      const payload = await readBody(request, 4 * 1024 * 1024);
      const settings = await readPlatformSettings();
      const discovery = await getPlatformDiscovery();
      const modelRef = isDirectModelRef(payload.modelRef) ? payload.modelRef : resolveTeamStudioModelRef(discovery, settings);
      if (!modelRef) throw new Error("TEAM_ASSISTANT_MODEL_UNAVAILABLE: configure an active OpenCode model in Platform settings and refresh discovery.");
      const upstream = await visualizer.chat({ projectId: teamChatMatch[1], payload: { ...payload, modelRef } });
      sendJson(response, upstream.status, upstream.body);
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error ? `TEAM_ASSISTANT_UNAVAILABLE: ${error.message}` : "TEAM_ASSISTANT_UNAVAILABLE" });
    }
    return;
  }
  const projectGraphMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team\/graph$/);
  if (projectGraphMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await getProjectGraph(projectGraphMatch[1], url.searchParams.get("locale") || "zh-CN"));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to load project graph." });
    }
    return;
  }
  const designMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team(?:\/design)?(?:\/(validate))?$/);
  if (designMatch && request.method === "GET" && !designMatch[2]) {
    try { sendJson(response, 200, await getProjectDesign(designMatch[1], url.searchParams.get("locale") || "zh-CN")); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to load project design." }); }
    return;
  }
  if (designMatch && request.method === "POST" && designMatch[2] === "validate") {
    try { sendJson(response, 200, await validateProjectDesign(designMatch[1], await readBody(request, 4 * 1024 * 1024))); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to validate project design." }); }
    return;
  }
  if (designMatch && request.method === "PUT" && !designMatch[2]) {
    try { sendJson(response, 200, publicProject(await saveProjectDesign(designMatch[1], await readBody(request, 4 * 1024 * 1024)))); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to save project design." }); }
    return;
  }
  const retryMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/runs\/([A-Za-z0-9._-]+)\/retry$/);
  if (retryMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      sendJson(response, 201, await retryProjectRun(retryMatch[1], retryMatch[2], payload));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to retry project run." });
    }
    return;
  }
  const runGetMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/runs\/([A-Za-z0-9._-]+)$/);
  if (runGetMatch && request.method === "GET") {
    try { sendJson(response, 200, await getProjectRun(runGetMatch[1], runGetMatch[2])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read project run." }); }
    return;
  }
  const runEventsMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/runs\/([A-Za-z0-9._-]+)\/events$/);
  if (runEventsMatch && request.method === "GET") {
    try {
      const snapshot = await getProjectRunEvents(runEventsMatch[1], runEventsMatch[2], {
        cursor: url.searchParams.has("cursor") ? Number(url.searchParams.get("cursor")) : undefined,
        limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        type: url.searchParams.get("type") || undefined,
        roleId: url.searchParams.get("roleId") || undefined,
        branchId: url.searchParams.get("branchId") || undefined,
        status: url.searchParams.get("status") || undefined,
        errorCode: url.searchParams.get("errorCode") || undefined,
        channel: url.searchParams.get("channel") || undefined
      });
      sendJson(response, 200, snapshot);
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read project run events." });
    }
    return;
  }
  const controlMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/runs\/([A-Za-z0-9._-]+)\/(pause|resume|cancel)$/);
  if (controlMatch && request.method === "POST") {
    try {
      sendJson(response, 200, await controlProjectRun(controlMatch[1], controlMatch[2], controlMatch[3]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to control project run." });
    }
    return;
  }
  if (projectMatch && request.method === "GET") {
    try {
      const project = await getProject(projectMatch[1]);
      sendJson(response, 200, publicProject(project));
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : "Project not found." });
    }
    return;
  }
  const readinessMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/readiness$/);
  if (readinessMatch && request.method === "GET") {
    try { sendJson(response, 200, await getProjectReadiness(readinessMatch[1])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to inspect project readiness." }); }
    return;
  }
  if (projectMatch && !projectMatch[2] && request.method === "PATCH") {
    try {
      const payload = await readBody(request);
      sendJson(response, 200, publicProject(await updateProject(projectMatch[1], payload)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to update project." });
    }
    return;
  }
  const confirmMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team\/confirm$/);
  if (confirmMatch && request.method === "POST") {
    try {
      sendJson(response, 200, publicProject(await confirmProjectTeam(confirmMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to confirm project." });
    }
    return;
  }
  if (projectMatch && projectMatch[2] === "materials" && request.method === "POST") {
    try {
      const payload = await readBody(request, 10 * 1024 * 1024);
      const batch = Array.isArray(payload.files);
      const materials = batch ? await addProjectMaterials(projectMatch[1], payload.files) : [await addProjectMaterial(projectMatch[1], payload)];
      sendJson(response, 201, batch ? { materials } : materials[0]);
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to add material." });
    }
    return;
  }
  if (projectMatch && projectMatch[2] === "runs" && request.method === "POST") {
    try {
      const payload = await readBody(request);
      const result = await startProjectRun(projectMatch[1], payload);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to run project." });
    }
    return;
  }
  const graphMatch = url.pathname.match(/^\/api\/v1\/cases\/([a-z0-9-]+)\/graph$/);
  const caseActionMatch = url.pathname.match(/^\/api\/v1\/cases\/([a-z0-9-]+)\/(use|template)$/);
  if (caseActionMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      const project = await createClassicTeamProject({
        caseId: caseActionMatch[1],
        asTemplate: caseActionMatch[2] === "template",
        name: payload.name,
        overview: payload.overview,
        locale: payload.locale
      });
      sendJson(response, 201, publicProject(project));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create team project." });
    }
    return;
  }
  if (request.method === "GET" && graphMatch) {
    try {
      sendJson(response, 200, buildCaseGraph(graphMatch[1], url.searchParams.get("locale") || "zh-CN"));
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : "Unable to load team graph." });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/demo-runs") {
    try {
      const payload = await readBody(request);
      const result = await runCase({ caseId: payload.caseId, prompt: payload.prompt, locale: payload.locale, mode: "simulation" });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Run failed." });
    }
    return;
  }
  const simulateTeamMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9:-]+)\/simulate$/);
  if (simulateTeamMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      sendJson(response, 200, await simulateTeamVersion(simulateTeamMatch[1], payload));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to simulate team." });
    }
    return;
  }
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

recoverOrphanedRuns().then(() => {
  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = address && typeof address === "object" ? address.port : port;
    process.stdout.write(`OGSystem Team Studio is ready at http://${host}:${boundPort}\n`);
  });
}).catch((error) => {
  process.stderr.write(`Unable to recover Team Site runs: ${error instanceof Error ? error.message : String(error)}\n`);
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
