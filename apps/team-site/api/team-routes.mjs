export async function handleTeamRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject, useCases }) {
  const teamIrMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/ir(?:\/(validate))?$/);
  if (teamIrMatch && request.method === "GET" && !teamIrMatch[2]) {
    try {
      sendJson(response, 200, await useCases.getTeamIr(teamIrMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read Team IR." });
    }
    return true;
  }
  if (teamIrMatch && request.method === "POST" && teamIrMatch[2] === "validate") {
    try {
      const body = await readBody(request, 4 * 1024 * 1024);
      sendJson(response, 200, await useCases.validateTeamIr(teamIrMatch[1], body.teamIR ?? body));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to validate Team IR." });
    }
    return true;
  }
  if (teamIrMatch && request.method === "PUT" && !teamIrMatch[2]) {
    try {
      sendJson(response, 200, await useCases.saveTeamIr(teamIrMatch[1], await readBody(request, 4 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to save Team IR." });
    }
    return true;
  }
  const teamIrReleaseSnapshotMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/ir\/release-snapshot$/);
  if (teamIrReleaseSnapshotMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamIrReleaseSnapshot(teamIrReleaseSnapshotMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), {
        error: error instanceof Error ? error.message : "Unable to verify Team IR release snapshot.",
        ...(error?.code ? { code: error.code } : {}),
        ...(Array.isArray(error?.diagnostics) ? { diagnostics: error.diagnostics } : {})
      });
    }
    return true;
  }

  const batchCancelMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/release-baselines\/batches\/([a-z0-9-]+)\/cancel$/);
  if (batchCancelMatch && request.method === "POST") {
    try {
      sendJson(response, 200, { batch: await useCases.cancelReleaseBaselineBatch(batchCancelMatch[1], batchCancelMatch[2]) });
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to cancel release baseline batch." });
    }
    return true;
  }
  const batchStatusMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/release-baselines\/batches\/latest$/);
  if (batchStatusMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getReleaseBaselineBatchStatus(batchStatusMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read release baseline batch." });
    }
    return true;
  }
  const batchStartMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/release-baselines\/batches$/);
  if (batchStartMatch && request.method === "POST") {
    try {
      const body = await readBody(request, 1024 * 1024);
      sendJson(response, 202, { batch: await useCases.startReleaseBaselineBatch(batchStartMatch[1], body) });
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to start release baseline batch." });
    }
    return true;
  }
  const comparisonMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/release-baselines\/comparison$/);
  if (comparisonMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.compareReleaseBaselines(comparisonMatch[1], url.searchParams.get("target") || "parent_version"));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to compare release baselines." });
    }
    return true;
  }
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
  const teamVersionMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)$/);
  if (teamVersionMatch && request.method === "GET") {
    try {
      sendJson(response, 200, publicProject(await useCases.getTeamVersion(teamVersionMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read TeamVersion." });
    }
    return true;
  }
  if (teamVersionMatch && request.method === "PATCH") {
    try {
      sendJson(response, 200, publicProject(await useCases.updateTeamMetadata(teamVersionMatch[1], await readBody(request))));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to update TeamVersion metadata." });
    }
    return true;
  }
  if (teamVersionMatch && request.method === "DELETE") {
    try {
      sendJson(response, 200, await useCases.deleteTeamVersion(teamVersionMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), {
        error: error instanceof Error ? error.message : "Unable to delete team version.",
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.blockedProjects ? { blockedProjects: error.blockedProjects } : {})
      });
    }
    return true;
  }
  const saveVersionMatch = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/save$/);
  if (saveVersionMatch && request.method === "PUT") {
    try {
      const body = await readBody(request, 1024 * 1024);
      sendJson(response, 200, await useCases.saveTeamVersion(saveVersionMatch[1], body));
    } catch (error) {
      const status = /TEAM_IR_V2_REQUIRED/.test(error instanceof Error ? error.message : String(error)) ? 409 : errorStatus(error);
      sendJson(response, status, {
        error: error instanceof Error ? error.message : "Unable to save TeamVersion.",
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.blockedProjects ? { blockedProjects: error.blockedProjects } : {})
      });
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

  const deleteTeamMatch = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)$/);
  if (deleteTeamMatch && request.method === "DELETE") {
    try {
      sendJson(response, 200, await useCases.deleteTeam(deleteTeamMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), {
        error: error instanceof Error ? error.message : "Unable to delete team.",
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.blockedProjects ? { blockedProjects: error.blockedProjects } : {})
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/team-ir-drafts") {
    try {
      const payload = await readBody(request);
      const team = await useCases.createTeamIrDraft({
        name: payload.name,
        overview: payload.overview,
        locale: payload.locale
      });
      sendJson(response, 201, publicProject(team));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create Team IR v2 draft." });
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
