export async function handleTeamIrSimulationRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const recovery = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/ir\/simulations\/recover$/);
  if (recovery && request.method === "POST") {
    try {
      sendJson(response, 200, await useCases.recoverInterruptedSimulations(recovery[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to recover Team IR v2 Simulations." });
    }
    return true;
  }
  const collection = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/ir\/simulations$/);
  if (collection && request.method === "POST") {
    try {
      sendJson(response, 200, await useCases.createSimulation(collection[1], await readBody(request, 4 * 1024 * 1024)));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to run Team IR v2 Simulation." });
    }
    return true;
  }
  if (collection && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.listSimulations(collection[1]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list Team IR v2 Simulations." });
    }
    return true;
  }
  const detail = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/ir\/simulations\/([a-z0-9-]+)$/);
  if (detail && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getSimulation(detail[1], detail[2]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read Team IR v2 Simulation." });
    }
    return true;
  }
  return false;
}
