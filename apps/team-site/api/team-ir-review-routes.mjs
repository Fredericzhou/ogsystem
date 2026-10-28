export async function handleTeamIrReviewRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const match = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)\/runs\/([A-Za-z0-9._-]+)\/team-ir-reviews\/([A-Za-z0-9._-]+)$/);
  if (!match) return false;
  const [, projectId, taskId, runId, reviewId] = match;
  try {
    if (request.method === "GET") {
      sendJson(response, 200, await useCases.getProjectTaskTeamIrReview(projectId, taskId, runId, reviewId));
      return true;
    }
    if (request.method === "POST") {
      sendJson(response, 200, await useCases.decideProjectTaskTeamIrReview(
        projectId, taskId, runId, reviewId, await readBody(request, 1024 * 1024)
      ));
      return true;
    }
  } catch (error) {
    sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to access Team IR v2 Review." });
    return true;
  }
  return false;
}
