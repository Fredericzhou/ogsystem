export async function handlePackageRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject, useCases }) {
  if (request.method === "POST" && url.pathname === "/api/v1/team-packages/import") {
    try {
      const payload = await readBody(request, 8 * 1024 * 1024);
      const { conflictStrategy, teamName, ...bundle } = payload || {};
      const imported = await useCases.importTeamPackage(bundle, { conflictStrategy: conflictStrategy || "reject", name: teamName });
      sendJson(response, 201, publicProject(imported));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to import project." });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/team-packages/preview") {
    try {
      const payload = await readBody(request, 8 * 1024 * 1024);
      sendJson(response, 200, await useCases.previewTeamPackage(payload));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to preview package." });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/project-packages/import") {
    try {
      const payload = await readBody(request, 8 * 1024 * 1024);
      const { conflictStrategy, ...bundle } = payload || {};
      sendJson(response, 201, publicProject(await useCases.importProjectBundle(bundle, { conflictStrategy: conflictStrategy || "reject" })));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to import project." });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/project-packages/preview") {
    try {
      sendJson(response, 200, await useCases.previewProjectBundle(await readBody(request, 8 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to preview project package." });
    }
    return true;
  }

  const teamExportMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/team\/export$/);
  if (teamExportMatch && request.method === "GET") {
    try {
      const bundle = await useCases.exportProjectTeam(teamExportMatch[1]);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${teamExportMatch[1]}.team.ogs.json"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      response.end(JSON.stringify(bundle, null, 2));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to export project." });
    }
    return true;
  }

  const projectExportMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/export$/);
  if (projectExportMatch && request.method === "GET") {
    try {
      const bundle = await useCases.exportProjectBundle(projectExportMatch[1]);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${projectExportMatch[1]}.project.ogs.json"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      response.end(JSON.stringify(bundle, null, 2));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to export project." });
    }
    return true;
  }

  return false;
}
