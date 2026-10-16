import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cases } from "./cases.mjs";
import { buildCaseGraph, runCase } from "./demo-runner.mjs";
import { eventLabels } from "./event-labels.mjs";
import {
  addProjectMaterial,
  createProject,
  confirmProjectTeam,
  exportProjectTeam,
  getProjectGraph,
  getProjectDesign,
  validateProjectDesign,
  saveProjectDesign,
  getProject,
  importTeamPackage,
  listProjects,
  retryProjectRun,
  controlProjectRun,
  startProjectRun,
  updateProject
} from "./project-repository.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, "public");
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
const visUrl = process.env.OGS_VIS_URL || "http://127.0.0.1:4177";
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

function errorStatus(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/PROJECT_NOT_CONFIRMED|PROJECT_LOCK_CONFLICT|active|conflict/i.test(message)) return 409;
  if (/not found/i.test(message)) return 404;
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

function publicProject(project) {
  const { workdir, ...safe } = project;
  if (safe.workspace && typeof safe.workspace === "object") {
    const { workdir: workspaceWorkdir, ...workspace } = safe.workspace;
    safe.workspace = workspace;
  }
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
    sendJson(response, 200, { projects: (await listProjects()).map(publicProject) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/projects") {
    try {
      const payload = await readBody(request);
      const project = await createProject({
        name: payload.name,
        intent: payload.intent,
        templateId: payload.templateId
      });
      sendJson(response, 201, publicProject(project));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Unable to create project." });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/team-packages/import") {
    try {
      const payload = await readBody(request, 8 * 1024 * 1024);
      sendJson(response, 201, publicProject(await importTeamPackage(payload)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to import project." });
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
  const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)(?:\/(materials|runs))?$/);
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
      const payload = await readBody(request);
      const material = await addProjectMaterial(projectMatch[1], payload);
      sendJson(response, 201, material);
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
    if (url.pathname === "/" || url.pathname === "/studio" || url.pathname === "/studio/new" || /^\/studio\/project\/[a-z0-9-]+(?:\/run)?\/?$/.test(url.pathname) || url.pathname === "/examples" || url.pathname === "/history" || /^\/cases\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      await serveStatic("/index.html", response);
      return;
    }
    await serveStatic(url.pathname, response);
    return;
  }
  sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(port, host, () => {
  const address = server.address();
  const boundPort = address && typeof address === "object" ? address.port : port;
  process.stdout.write(`OGSystem Team Studio is ready at http://${host}:${boundPort}\n`);
});

function close() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

function dirname(path) {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}
