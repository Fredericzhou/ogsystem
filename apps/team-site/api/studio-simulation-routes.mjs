export async function handleStudioSimulationRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const collection = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations$/);
  if (collection && request.method === "POST") {
    try {
      sendJson(response, 201, await useCases.createSimulation(collection[1], collection[2], await readBody(request)));
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

  const detail = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations\/([a-z0-9-]+)(?:\/(events))?$/);
  if (detail && request.method === "GET") {
    try {
      if (detail[4]) {
        sendJson(response, 200, await useCases.getTeamVersionSimulationEvents(detail[1], detail[2], detail[3]));
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
