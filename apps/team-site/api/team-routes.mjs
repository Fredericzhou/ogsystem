export async function handleTeamRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject, useCases }) {
  const batchCancelMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/training-baselines\/batches\/([a-z0-9-]+)\/cancel$/);
  if (batchCancelMatch && request.method === "POST") {
    try {
      sendJson(response, 200, { batch: await useCases.cancelTrainingBaselineBatch(batchCancelMatch[1], batchCancelMatch[2]) });
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to cancel training baseline batch." });
    }
    return true;
  }
  const batchStatusMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/training-baselines\/batches\/latest$/);
  if (batchStatusMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTrainingBaselineBatchStatus(batchStatusMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read training baseline batch." });
    }
    return true;
  }
  const batchStartMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/training-baselines\/batches$/);
  if (batchStartMatch && request.method === "POST") {
    try {
      const body = await readBody(request, 1024 * 1024);
      sendJson(response, 202, { batch: await useCases.startTrainingBaselineBatch(batchStartMatch[1], body) });
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to start training baseline batch." });
    }
    return true;
  }
  const comparisonMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/training-baselines\/comparison$/);
  if (comparisonMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.compareTrainingBaselines(comparisonMatch[1], url.searchParams.get("target") || "parent_version"));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to compare training baselines." });
    }
    return true;
  }
  const releaseReadinessMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/training-readiness$/);
  if (releaseReadinessMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamTrainingReadiness(releaseReadinessMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to verify TeamVersion training readiness." });
    }
    return true;
  }
  const accuracyReviewMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/training-review$/);
  if (accuracyReviewMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamAccuracyReview(accuracyReviewMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read TeamVersion accuracy review." });
    }
    return true;
  }
  if (accuracyReviewMatch && request.method === "PUT") {
    try {
      sendJson(response, 200, await useCases.saveTeamAccuracyReview(accuracyReviewMatch[1], await readBody(request, 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to save TeamVersion accuracy review." });
    }
    return true;
  }
  const trainingBaselinesMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/training-baselines$/);
  if (trainingBaselinesMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTrainingBaselineScenarios(trainingBaselinesMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read training baselines." });
    }
    return true;
  }
  if (trainingBaselinesMatch && request.method === "PUT") {
    try {
      sendJson(response, 200, await useCases.saveTrainingBaselineScenarios(trainingBaselinesMatch[1], await readBody(request, 2 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to save training baselines." });
    }
    return true;
  }
  const graphMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/graph$/);
  if (graphMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamGraph(graphMatch[1], url.searchParams.get("locale") || "zh-CN"));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to load TeamVersion graph." });
    }
    return true;
  }
  const chatMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/chat$/);
  if (chatMatch && request.method === "POST") {
    try {
      const upstream = await useCases.chatTeamAssistant(chatMatch[1], await readBody(request, 4 * 1024 * 1024));
      sendJson(response, upstream.status, upstream.body);
    } catch (error) {
      sendJson(response, 502, { error: `TEAM_ASSISTANT_UNAVAILABLE: ${error instanceof Error ? error.message : "Request failed."}` });
    }
    return true;
  }
  const teamVersionMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)(?:\/(design(?:\/validate)?|train|archive|edit))?$/);
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
  if (teamVersionMatch && request.method === "DELETE" && !teamVersionMatch[2]) {
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
  const saveVersionMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/save$/);
  if (saveVersionMatch && request.method === "PUT") {
    try {
      sendJson(response, 200, await useCases.saveTeamVersion(saveVersionMatch[1], await readBody(request, 8 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), {
        error: error instanceof Error ? error.message : "Unable to save TeamVersion.",
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.blockedProjects ? { blockedProjects: error.blockedProjects } : {})
      });
    }
    return true;
  }
  const assetsMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/design\/assets$/);
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
  if (request.method === "GET" && url.pathname === "/api/v2/team-factory") {
    sendJson(response, 200, { teams: (await useCases.listTeamFactory()).map(publicProject) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v2/team-repository") {
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

  const deleteTeamMatch = url.pathname.match(/^\/api\/v2\/teams\/([a-z0-9-]+)$/);
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

  if (request.method === "POST" && url.pathname === "/api/v2/team-factory") {
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

  const editMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/edit$/);
  if (editMatch && request.method === "POST") {
    try {
      sendJson(response, 201, publicProject(await useCases.forkTeamVersion(editMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to edit team version." });
    }
    return true;
  }

  const trainMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/train$/);
  if (trainMatch && request.method === "POST") {
    try {
      sendJson(response, 200, publicProject(await useCases.trainTeamVersion(trainMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to train team version." });
    }
    return true;
  }

  const archiveMatch = url.pathname.match(/^\/api\/v2\/team-versions\/([a-z0-9-]+)\/archive$/);
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
