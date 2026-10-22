export async function handleDeliverableRoutes({ request, response, url, sendJson, errorStatus, useCases }) {
  const collection = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/deliverables$/);
  if (collection && request.method === "GET") {
    try { sendJson(response, 200, await useCases.listProjectDeliverables(collection[1])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list deliverables." }); }
    return true;
  }
  const archive = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)\/runs\/([A-Za-z0-9._-]+)\/deliverable$/);
  if (archive && request.method === "POST") {
    try {
      const result = await useCases.archiveProjectRun(archive[1], archive[2], archive[3]);
      sendJson(response, result.deliverable?.idempotentReplay ? 200 : 201, result);
    }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to archive deliverable." }); }
    return true;
  }
  const content = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/deliverables\/([A-Za-z0-9._-]+)\/content$/);
  if (content && request.method === "GET") {
    try { sendJson(response, 200, await useCases.getProjectDeliverableContent(content[1], content[2])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read deliverable." }); }
    return true;
  }
  return false;
}
