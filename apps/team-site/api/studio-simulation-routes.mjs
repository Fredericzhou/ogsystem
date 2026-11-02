export async function handleStudioSimulationRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const workspaceOpen = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/workspace\/open-directory$/);
  if (workspaceOpen && request.method === "POST") {
    const remoteAddress = String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    const localRequest = remoteAddress === "::1" || remoteAddress === "127.0.0.1" || remoteAddress === "localhost";
    if (!localRequest) {
      sendJson(response, 403, { error: "LOCAL_WORKSPACE_OPEN_ONLY" });
      return true;
    }
    try {
      sendJson(response, 200, await useCases.openTeamVersionWorkspaceDirectory(workspaceOpen[1], workspaceOpen[2]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to open Team workspace." });
    }
    return true;
  }

  const collection = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations$/);
  if (collection && request.method === "POST") {
    try {
      sendJson(response, 202, await useCases.createSimulation(collection[1], collection[2], { ...(await readBody(request)), awaitCompletion: false }));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create Studio Simulation." });
    }
    return true;
  }
  if (collection && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.listTeamVersionSimulations(collection[1], collection[2]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list Studio Simulations." });
    }
    return true;
  }
  if (collection && request.method === "DELETE") {
    try {
      sendJson(response, 200, await useCases.clearInteractiveSimulations(collection[1], collection[2]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to clear Studio Simulation history." });
    }
    return true;
  }

  const artifactPathMatch = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations\/([a-z0-9-]+)\/artifacts(?:\/(.*))?$/);
  if (artifactPathMatch && request.method === "GET") {
    try {
      const teamId = artifactPathMatch[1];
      const teamVersionId = artifactPathMatch[2];
      const simulationId = artifactPathMatch[3];
      const artifactPath = artifactPathMatch[4] ? decodeURIComponent(artifactPathMatch[4]) : "";
      if (!artifactPath) {
        sendJson(response, 200, await useCases.listTeamVersionSimulationArtifacts(teamId, teamVersionId, simulationId));
        return true;
      }
      const isDownload = url.searchParams.get("download") === "1";
      const artifact = await useCases.readTeamVersionSimulationArtifact(teamId, teamVersionId, simulationId, artifactPath, { maxBytes: isDownload ? 32 * 1024 * 1024 : 1024 * 1024 });
      if (artifact.tooLarge) {
        sendJson(response, 413, {
          error: "STUDIO_SIMULATION_ARTIFACT_TOO_LARGE",
          path: artifact.path,
          size: artifact.size,
          ...(isDownload ? {} : { downloadUrl: `${url.pathname}?download=1` })
        });
        return true;
      }
      const contentType = artifactPath.endsWith(".json") || artifactPath.endsWith(".ndjson") || artifactPath.endsWith(".jsonl")
        ? "application/json; charset=utf-8"
        : artifactPath.endsWith(".mmd") || artifactPath.endsWith(".md") || artifactPath.endsWith(".log")
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";
      const filename = artifactPath.split("/").at(-1) || "artifact";
      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "no-store",
        "content-disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename.replaceAll('"', "")}"`,
        "x-content-type-options": "nosniff"
      });
      response.end(artifact.content || "");
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read Simulation artifacts." });
    }
    return true;
  }

  const stop = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations\/([a-z0-9-]+)\/stop$/);
  if (stop && request.method === "POST") {
    try {
      const body = await readBody(request, 32 * 1024);
      sendJson(response, 202, await useCases.stopSimulation(stop[1], stop[2], stop[3], body.reason));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to stop Studio Simulation." });
    }
    return true;
  }

  const detail = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations\/([a-z0-9-]+)(?:\/(events))?$/);
  if (detail && request.method === "GET") {
    try {
      if (detail[4]) {
        sendJson(response, 200, await useCases.getTeamVersionSimulationEvents(detail[1], detail[2], detail[3], url.searchParams.get("afterCursor") || 0));
      } else {
        sendJson(response, 200, await useCases.getTeamVersionSimulation(detail[1], detail[2], detail[3]));
      }
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read Studio Simulation." });
    }
    return true;
  }
  return false;
}
