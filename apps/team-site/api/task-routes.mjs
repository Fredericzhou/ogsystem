export async function handleTaskRoutes({ request, response, url, readBody, sendJson, errorStatus, publicTask, useCases }) {
  const collectionMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks$/);
  if (collectionMatch && request.method === "POST") {
    try {
      sendJson(response, 201, publicTask(await useCases.createProjectTask(collectionMatch[1], await readBody(request))));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create project task." });
    }
    return true;
  }

  const itemMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)$/);
  if (itemMatch && request.method === "GET") {
    try {
      sendJson(response, 200, publicTask(await useCases.getProjectTask(itemMatch[1], itemMatch[2])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read project task." });
    }
    return true;
  }
  if (itemMatch && request.method === "DELETE") {
    try {
      sendJson(response, 200, publicTask(await useCases.deleteProjectTask(itemMatch[1], itemMatch[2])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to delete project task." });
    }
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)\/(start|pause|resume|cancel|review|retry)$/);
  if (!actionMatch || request.method !== "POST") return false;
  try {
    const [, projectId, taskId, action] = actionMatch;
    const payload = await readBody(request);
    const result = action === "review"
      ? await useCases.reviewProjectTask(projectId, taskId, payload)
      : action === "retry"
        ? await useCases.retryProjectTask(projectId, taskId, payload)
      : action === "start"
        ? await useCases.startProjectTask(projectId, taskId, payload)
        : await useCases.controlProjectTask(projectId, taskId, action);
    const responsePayload = result?.task
      ? { ...result, task: publicTask(result.task) }
      : action === "start" ? { task: publicTask(result) } : publicTask(result);
    sendJson(response, ["start", "retry"].includes(action) ? 202 : 200, responsePayload);
  } catch (error) {
    sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to control project task." });
  }
  return true;
}
