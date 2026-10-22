export async function handleSharedResourceRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const catalog = url.pathname.match(/^\/api\/v1\/platform\/(tools|storage-targets)$/);
  if (catalog && request.method === "GET") {
    const kind = catalog[1] === "tools" ? "tools" : "storageTargets";
    try { sendJson(response, 200, await useCases.listCatalog(kind)); }
    catch (error) { sendJson(response, errorStatus(error), { error: String(error.message || error) }); }
    return true;
  }
  if (catalog && request.method === "PUT") {
    const kind = catalog[1] === "tools" ? "tools" : "storageTargets";
    try { sendJson(response, 200, { item: await useCases.saveCatalogItem(kind, await readBody(request)) }); }
    catch (error) { sendJson(response, errorStatus(error), { error: String(error.message || error) }); }
    return true;
  }
  if (url.pathname === "/api/v1/platform/data-sets" && request.method === "GET") {
    try { sendJson(response, 200, await useCases.listDatasets()); }
    catch (error) { sendJson(response, errorStatus(error), { error: String(error.message || error) }); }
    return true;
  }
  if (url.pathname === "/api/v1/platform/data-sets/versions" && request.method === "POST") {
    try { sendJson(response, 201, { version: await useCases.createDatasetVersion(await readBody(request, 16 * 1024 * 1024)) }); }
    catch (error) { sendJson(response, errorStatus(error), { error: String(error.message || error) }); }
    return true;
  }
  const dataVersion = url.pathname.match(/^\/api\/v1\/platform\/data-sets\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)$/);
  if (dataVersion && request.method === "GET") {
    try { sendJson(response, 200, await useCases.readDatasetVersion(dataVersion[1], dataVersion[2])); }
    catch (error) { sendJson(response, errorStatus(error), { error: String(error.message || error) }); }
    return true;
  }
  if (url.pathname === "/api/v1/studio/role-repository" && request.method === "GET") {
    try { sendJson(response, 200, await useCases.listRoleTemplates()); }
    catch (error) { sendJson(response, errorStatus(error), { error: String(error.message || error) }); }
    return true;
  }
  if (url.pathname === "/api/v1/studio/role-repository" && request.method === "POST") {
    try { sendJson(response, 201, { template: await useCases.createRoleTemplate(await readBody(request, 4 * 1024 * 1024)) }); }
    catch (error) { sendJson(response, errorStatus(error), { error: String(error.message || error) }); }
    return true;
  }
  const roleTemplate = url.pathname.match(/^\/api\/v1\/studio\/role-repository\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)$/);
  if (roleTemplate && request.method === "GET") {
    try { sendJson(response, 200, await useCases.getRoleTemplate(roleTemplate[1], roleTemplate[2])); }
    catch (error) { sendJson(response, errorStatus(error), { error: String(error.message || error) }); }
    return true;
  }
  return false;
}
