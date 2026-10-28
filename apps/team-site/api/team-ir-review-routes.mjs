export function createTeamIrReviewPrincipalResolver({ createLocalPrincipal, basicIdentityProvider } = {}) {
  if (typeof createLocalPrincipal !== "function") throw new TypeError("Team IR Review identity requires a local principal factory.");
  return async (request) => {
    const address = String(request.socket?.remoteAddress || request.connection?.remoteAddress || "").toLowerCase();
    if (address === "127.0.0.1" || address === "::1" || /^::ffff:127\./.test(address)) return createLocalPrincipal();
    if (request.socket?.encrypted !== true) return null;
    return (await basicIdentityProvider?.authenticate(request))?.principal || null;
  };
}

export async function handleTeamIrReviewRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases, resolvePrincipal }) {
  const match = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)\/runs\/([A-Za-z0-9._-]+)\/team-ir-reviews\/([A-Za-z0-9._-]+)$/);
  if (!match) return false;
  const [, projectId, taskId, runId, reviewId] = match;
  try {
    const principal = typeof resolvePrincipal === "function" ? await resolvePrincipal(request) : null;
    if (!principal || typeof principal.id !== "string" || !principal.id.trim()) {
      response.setHeader?.("www-authenticate", "Basic realm=\"Team IR Review\"");
      sendJson(response, 401, { error: "TEAM_REVIEW_PRINCIPAL_UNAVAILABLE: authenticated reviewer identity is unavailable." });
      return true;
    }
    if (request.method === "GET") {
      sendJson(response, 200, await useCases.getProjectTaskTeamIrReview(projectId, taskId, runId, reviewId, principal));
      return true;
    }
    if (request.method === "POST") {
      sendJson(response, 200, await useCases.decideProjectTaskTeamIrReview(
        projectId, taskId, runId, reviewId, await readBody(request, 1024 * 1024), principal
      ));
      return true;
    }
  } catch (error) {
    sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to access Team IR v2 Review." });
    return true;
  }
  return false;
}
