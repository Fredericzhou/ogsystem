function normalizeAddress(value) {
  let address = String(value || "").toLowerCase();
  if (address.startsWith("::ffff:")) address = address.slice(7);
  return address;
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1";
}

function isTailnetAddress(address) {
  const ipv4 = address.split(".").map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127;
  }
  return address.startsWith("fd7a:115c:a1e0:");
}

function isLoopbackOrTailnet(request) {
  const remote = normalizeAddress(request.socket?.remoteAddress || request.connection?.remoteAddress);
  if (isLoopback(remote)) return true;
  const local = normalizeAddress(request.socket?.localAddress);
  return isTailnetAddress(remote) && isTailnetAddress(local);
}

function sendError(response, sendJson, errorStatus, error) {
  const message = String(error?.message || error || "ROLE_SOURCE_REQUEST_FAILED");
  sendJson(response, errorStatus(error), { error: message, ...(error?.detail ? { detail: error.detail } : {}) });
}

export async function handleRoleSourceAdminRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases, scheduler }) {
  const root = "/api/v1/platform/role-sources";
  if (url.pathname === root && request.method === "GET") {
    if (!isLoopbackOrTailnet(request)) { sendJson(response, 403, { error: "ROLE_SOURCE_ADMIN_ACCESS_REQUIRED" }); return true; }
    try { sendJson(response, 200, { sources: await useCases.listConfiguredRoleSources() }); }
    catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  if (url.pathname === root && request.method === "POST") {
    if (!isLoopbackOrTailnet(request)) { sendJson(response, 403, { error: "ROLE_SOURCE_ADMIN_ACCESS_REQUIRED" }); return true; }
    try {
      const source = await useCases.configureRoleSource(await readBody(request, 64 * 1024));
      sendJson(response, 201, { source, sync: "manual" });
    } catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  const sourceMatch = url.pathname.match(/^\/api\/v1\/platform\/role-sources\/([a-z0-9-]+)$/);
  if (sourceMatch && request.method === "PUT") {
    if (!isLoopbackOrTailnet(request)) { sendJson(response, 403, { error: "ROLE_SOURCE_ADMIN_ACCESS_REQUIRED" }); return true; }
    try {
      const sourceId = sourceMatch[1];
      const source = await useCases.configureRoleSource({ ...(await readBody(request, 64 * 1024)), sourceId });
      sendJson(response, 200, { source, sync: "manual" });
    } catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  const operation = url.pathname.match(/^\/api\/v1\/platform\/role-sources\/([a-z0-9-]+)\/(sync|reindex)$/);
  if (operation && request.method === "POST") {
    if (!isLoopbackOrTailnet(request)) { sendJson(response, 403, { error: "ROLE_SOURCE_ADMIN_ACCESS_REQUIRED" }); return true; }
    try {
      const source = (await useCases.listConfiguredRoleSources()).find((item) => item.sourceId === operation[1]);
      if (!source) { sendJson(response, 404, { error: "NOT_FOUND" }); return true; }
      if (!source.enabled) { sendJson(response, 409, { error: "ROLE_SOURCE_DISABLED" }); return true; }
      const queued = scheduler.enqueue(operation[1], operation[2] === "reindex" ? "reindex" : "sync");
      sendJson(response, 202, { sourceId: operation[1], ...queued });
    } catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  return false;
}
