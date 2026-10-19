export async function handleTeamRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject, useCases }) {
  if (request.method === "GET" && url.pathname === "/api/v1/team-factory") {
    sendJson(response, 200, { teams: (await useCases.listTeamFactory()).map(publicProject) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/team-repository") {
    const result = await useCases.queryTeamRepository({
      query: url.searchParams.get("query") || "",
      category: url.searchParams.get("category") || "",
      status: url.searchParams.get("status") || "released",
      sort: url.searchParams.get("sort") || "updated",
      page: url.searchParams.get("page") || 1,
      pageSize: url.searchParams.get("pageSize") || 12
    });
    sendJson(response, 200, { ...result, teams: result.teams.map(publicProject) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/team-factory") {
    try {
      const payload = await readBody(request);
      const team = await useCases.createTeamDraft({
        name: payload.name,
        overview: payload.overview,
        locale: payload.locale
      });
      sendJson(response, 201, publicProject(team));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create team draft." });
    }
    return true;
  }

  const editMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/edit$/);
  if (editMatch && request.method === "POST") {
    try {
      sendJson(response, 201, publicProject(await useCases.forkTeamVersion(editMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to edit team version." });
    }
    return true;
  }

  const releaseMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/release$/);
  if (releaseMatch && request.method === "POST") {
    try {
      sendJson(response, 200, publicProject(await useCases.releaseTeamVersion(releaseMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to release team version." });
    }
    return true;
  }

  const archiveMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/archive$/);
  if (archiveMatch && request.method === "POST") {
    try {
      sendJson(response, 200, publicProject(await useCases.archiveTeamVersion(archiveMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to archive team version." });
    }
    return true;
  }

  const simulateMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/simulate$/);
  if (simulateMatch && request.method === "POST") {
    try {
      sendJson(response, 200, await useCases.simulateTeamVersion(simulateMatch[1], await readBody(request)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to simulate team." });
    }
    return true;
  }

  return false;
}
