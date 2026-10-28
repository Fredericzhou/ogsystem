function sendError(response, sendJson, errorStatus, error) {
  const message = String(error?.message || error || "ROLE_SOURCE_REQUEST_FAILED");
  sendJson(response, errorStatus(error), { error: message, ...(error?.detail ? { detail: error.detail } : {}) });
}

export async function handleRoleSourceCatalogRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const root = "/api/v1/studio/role-sources";
  if (url.pathname === root && request.method === "GET") {
    try { sendJson(response, 200, { sources: await useCases.listRoleSources() }); }
    catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  const versions = url.pathname.match(/^\/api\/v1\/studio\/role-sources\/([a-z0-9-]+)\/versions$/);
  if (versions && request.method === "GET") {
    try { sendJson(response, 200, { versions: await useCases.listRoleSourceVersions(versions[1]) }); }
    catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  const copy = url.pathname.match(/^\/api\/v1\/studio\/role-sources\/([a-z0-9-]+)\/roles\/([a-z0-9-]+)\/copy$/);
  if (copy && request.method === "POST") {
    try {
      const body = await readBody(request, 1024 * 1024);
      const result = await useCases.copyRoleSourceRoleToDraft({
        ...body, sourceId: copy[1], roleKey: copy[2], commit: url.searchParams.get("commit") || body.commit
      });
      sendJson(response, 201, { result });
    } catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  const action = url.pathname.match(/^\/api\/v1\/studio\/role-sources\/([a-z0-9-]+)\/roles\/([a-z0-9-]+)\/convert$/);
  if (action && request.method === "POST") {
    try {
      const body = await readBody(request, 1024 * 1024);
      const payload = { ...body, sourceId: action[1], roleKey: action[2], commit: url.searchParams.get("commit") || body.commit };
      sendJson(response, 200, { result: await useCases.convertRoleSourceRole(payload) });
    } catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  const role = url.pathname.match(/^\/api\/v1\/studio\/role-sources\/([a-z0-9-]+)\/roles\/([a-z0-9-]+)$/);
  if (role && request.method === "GET") {
    try {
      const result = await useCases.getRoleSourceRole(role[1], role[2], url.searchParams.get("commit") || undefined);
      sendJson(response, 200, { role: result.role, markdown: result.markdown, source: { sourceId: result.source.sourceId, name: result.source.name } });
    } catch (error) { sendError(response, sendJson, errorStatus, error); }
    return true;
  }
  return false;
}
