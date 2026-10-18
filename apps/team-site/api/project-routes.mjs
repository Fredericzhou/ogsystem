import {
  createCollaborationProject,
  listProjectTeams,
  replaceProjectTeams
} from "../project-repository.mjs";

export async function handleProjectRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject }) {
  if (request.method === "POST" && url.pathname === "/api/v1/projects") {
    try {
      const payload = await readBody(request);
      const project = await createCollaborationProject({
        name: payload.name,
        overview: payload.overview,
        teamVersionIds: payload.teamVersionIds
      });
      sendJson(response, 201, publicProject(project));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create project." });
    }
    return true;
  }

  const projectTeamMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/teams$/);
  if (!projectTeamMatch) return false;

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await listProjectTeams(projectTeamMatch[1]));
      return true;
    }
    if (request.method === "PUT") {
      const payload = await readBody(request);
      sendJson(response, 200, publicProject(await replaceProjectTeams(projectTeamMatch[1], payload.teamVersionIds)));
      return true;
    }
  } catch (error) {
    sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to update project teams." });
    return true;
  }
  return false;
}
