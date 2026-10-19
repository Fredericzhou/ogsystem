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
  const workspaceMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/workspaces$/);
  if (workspaceMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      const project = await useCases.createProjectWorkspace(workspaceMatch[1], {
        name: payload.name,
        workspaceKey: payload.workspaceKey,
        locale: payload.locale
      });
      sendJson(response, 201, publicProject(project));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create project workspace." });
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

  const chatMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team\/chat$/);
  if (chatMatch && request.method === "POST") {
    try {
      const payload = await readBody(request, 4 * 1024 * 1024);
      const upstream = await useCases.chatTeamAssistant(chatMatch[1], payload);
      sendJson(response, upstream.status, upstream.body);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Request failed.";
      const address = String(visualizerUrl || "").replace(/\/$/, "");
      const hint = /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(detail) && address
        ? ` Visualizer upstream: ${address}. Configure OGS_VIS_URL when starting Team Site.`
        : "";
      sendJson(response, 502, { error: `TEAM_ASSISTANT_UNAVAILABLE: ${detail}.${hint}` });
    }
    return true;
  }

  const graphMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team\/graph$/);
  if (graphMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getProjectGraph(graphMatch[1], url.searchParams.get("locale") || "zh-CN"));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to load project graph." });
    }
    return true;
  }

  const designMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team(?:\/design)?(?:\/(validate))?$/);
  if (designMatch && request.method === "GET" && !designMatch[2]) {
    try {
      sendJson(response, 200, await useCases.getProjectDesign(designMatch[1], url.searchParams.get("locale") || "zh-CN"));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to load project design." });
    }
    return true;
  }
  if (designMatch && request.method === "POST" && designMatch[2] === "validate") {
    try {
      sendJson(response, 200, await useCases.validateProjectDesign(designMatch[1], await readBody(request, 4 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to validate project design." });
    }
    return true;
  }
  if (designMatch && request.method === "PUT" && !designMatch[2]) {
    try {
      sendJson(response, 200, publicProject(await useCases.saveProjectDesign(designMatch[1], await readBody(request, 4 * 1024 * 1024))));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to save project design." });
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

  const runStartMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/runs$/);
  if (runStartMatch && request.method === "POST") {
    try {
      sendJson(response, 200, await useCases.startProjectRun(runStartMatch[1], await readBody(request)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to run project." });
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
      sendJson(response, 200, publicProject(await useCases.updateProject(projectMatch[1], await readBody(request))));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to update project." });
    }
    return true;
  }
  return false;
}
