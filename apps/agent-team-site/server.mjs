import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cases } from "./cases.mjs";
import { runCase } from "./run-engine.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, "public");
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
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

async function readBody(request, limit = 8192) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw new Error("Request body is too large.");
  }
  return JSON.parse(body || "{}");
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
      "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    response.end(contents);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/api/cases") {
    sendJson(response, 200, cases.map((item) => ({
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
    })));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/demo-runs") {
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
    if (url.pathname === "/" || url.pathname === "/studio" || url.pathname === "/examples" || url.pathname === "/history" || /^\/cases\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      await serveStatic("/index.html", response);
      return;
    }
    await serveStatic(url.pathname, response);
    return;
  }
  sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(port, host, () => {
  process.stdout.write(`OGSystem Team Studio is ready at http://${host}:${port}\n`);
});

function close() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

function dirname(path) {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}
