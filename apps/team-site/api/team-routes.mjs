export async function handleTeamRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject, useCases }) {
  const releaseReadinessMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/release-readiness$/);
  if (releaseReadinessMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamReleaseReadiness(releaseReadinessMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to verify TeamVersion release readiness." });
    }
    return true;
  }
  const releaseBaselinesMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/release-baselines$/);
  if (releaseBaselinesMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getReleaseBaselineScenarios(releaseBaselinesMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read release baselines." });
    }
    return true;
  }
  if (releaseBaselinesMatch && request.method === "PUT") {
    try {
      sendJson(response, 200, await useCases.saveReleaseBaselineScenarios(releaseBaselinesMatch[1], await readBody(request, 2 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to save release baselines." });
    }
    return true;
  }
  const graphMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/graph$/);
  if (graphMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamGraph(graphMatch[1], url.searchParams.get("locale") || "zh-CN"));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to load TeamVersion graph." });
    }
    return true;
  }
  const chatMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/chat$/);
  if (chatMatch && request.method === "POST") {
    try {
      const upstream = await useCases.chatTeamAssistant(chatMatch[1], await readBody(request, 4 * 1024 * 1024));
      sendJson(response, upstream.status, upstream.body);
    } catch (error) {
      sendJson(response, 502, { error: `TEAM_ASSISTANT_UNAVAILABLE: ${error instanceof Error ? error.message : "Request failed."}` });
    }
    return true;
  }
  const teamVersionMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)(?:\/(design(?:\/validate)?|release|archive|edit))?$/);
  if (teamVersionMatch && request.method === "GET" && !teamVersionMatch[2]) {
    try {
      sendJson(response, 200, publicProject(await useCases.getTeamVersion(teamVersionMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read TeamVersion." });
    }
    return true;
  }
  if (teamVersionMatch && request.method === "PATCH" && !teamVersionMatch[2]) {
    try {
      sendJson(response, 200, publicProject(await useCases.updateTeamMetadata(teamVersionMatch[1], await readBody(request))));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to update TeamVersion metadata." });
    }
    return true;
  }
  if (teamVersionMatch && teamVersionMatch[2] === "design" && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamDesign(teamVersionMatch[1], url.searchParams.get("locale") || "zh-CN"));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to load TeamVersion design." });
    }
    return true;
  }
  if (teamVersionMatch && teamVersionMatch[2] === "design/validate" && request.method === "POST") {
    try {
      sendJson(response, 200, await useCases.validateTeamDesign(teamVersionMatch[1], await readBody(request, 4 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to validate TeamVersion design." });
    }
    return true;
  }
  if (teamVersionMatch && teamVersionMatch[2] === "design" && request.method === "PUT") {
    try {
      sendJson(response, 200, await useCases.saveTeamDesign(teamVersionMatch[1], await readBody(request, 4 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to save TeamVersion design." });
    }
    return true;
  }
  const assetsMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/design\/assets$/);
  if (assetsMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamDesignAssets(assetsMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read TeamVersion assets." });
    }
    return true;
  }
  if (assetsMatch && request.method === "PUT") {
    try {
      sendJson(response, 200, await useCases.saveTeamDesignAssets(assetsMatch[1], await readBody(request, 4 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to save TeamVersion assets." });
    }
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/team-factory") {
    sendJson(response, 200, { teams: (await useCases.listTeamFactory()).map(publicProject) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/team-repository") {
    const result = await useCases.queryTeamRepository({
      query: url.searchParams.get("query") || "",
      category: url.searchParams.get("category") || "",
      status: url.searchParams.get("status") || "all",
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

  return false;
}
