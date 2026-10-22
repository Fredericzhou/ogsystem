export async function handleCollaborationProjectRoutes({
  request,
  response,
  url,
  readBody,
  sendJson,
  errorStatus,
  publicProject,
  visualizerUrl,
  useCases,
}) {
  const teamReadinessMatch = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/readiness$/);
  if (teamReadinessMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getTeamVersionReadiness(teamReadinessMatch[1], teamReadinessMatch[2]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to inspect TeamVersion readiness." });
    }
    return true;
  }

  const adjustmentMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team-adjustments$/);
  if (adjustmentMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      const result = await useCases.createProjectTeamAdjustment(adjustmentMatch[1], payload.teamVersionId);
      sendJson(response, 201, {
        draft: publicProject(result.draft),
        collaborationProjectId: result.collaborationProjectId,
        sourceTeamVersionId: result.sourceTeamVersionId
      });
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create a Team adjustment draft." });
    }
    return true;
  }

  const readinessMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/readiness$/);
  if (readinessMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getProjectReadiness(readinessMatch[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to inspect project readiness." });
    }
    return true;
  }

  const confirmMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team\/confirm$/);
  if (confirmMatch && request.method === "POST") {
    try {
      sendJson(response, 200, publicProject(await useCases.confirmProjectTeam(confirmMatch[1])));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to confirm project." });
    }
    return true;
  }

  const materialsMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/materials$/);
  if (materialsMatch && request.method === "POST") {
    try {
      const payload = await readBody(request, 10 * 1024 * 1024);
      const batch = Array.isArray(payload.files);
      const materials = batch
        ? await useCases.addProjectMaterials(materialsMatch[1], payload.files)
        : [await useCases.addProjectMaterial(materialsMatch[1], payload)];
      sendJson(response, 201, batch ? { materials } : materials[0]);
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to add material." });
    }
    return true;
  }

  const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)$/);
  if (projectMatch && request.method === "GET") {
    try {
      sendJson(response, 200, publicProject(await useCases.getProject(projectMatch[1])));
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : "Project not found." });
    }
    return true;
  }
  if (projectMatch && request.method === "PATCH") {
    try {
      const current = await useCases.getProject(projectMatch[1]);
      if (current.projectType !== "collaboration") throw new Error("PROJECT_NOT_FOUND: the requested Collaboration Project does not exist.");
      sendJson(response, 200, publicProject(await useCases.updateProject(projectMatch[1], await readBody(request))));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to update project." });
    }
    return true;
  }
  return false;
}
