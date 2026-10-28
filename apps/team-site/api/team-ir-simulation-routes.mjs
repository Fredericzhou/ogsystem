function isLocalSameOrigin(request) {
  const address = String(request.socket?.remoteAddress || request.connection?.remoteAddress || "").toLowerCase();
  if (!(address === "127.0.0.1" || address === "::1" || /^::ffff:127\./.test(address))) return false;
  const origin = request.headers?.origin;
  if (!origin) return true;
  try { return new URL(origin).host === request.headers?.host; }
  catch { return false; }
}

export async function handleTeamIrSimulationRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const artifactSlots = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/ir\/simulation-artifact-slots$/);
  if (artifactSlots && request.method === "GET") {
    try { sendJson(response, 200, await useCases.listRunInputArtifactSlots(artifactSlots[1])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list Simulation Artifact slots." }); }
    return true;
  }
  const artifactUpload = url.pathname.match(/^\/api\/v1\/team-versions\/([a-z0-9-]+)\/ir\/simulation-artifacts\/run-input$/);
  if (artifactUpload && request.method === "POST") {
    if (!isLocalSameOrigin(request)) {
      sendJson(response, 403, { error: "TEAM_IR_SIMULATION_ARTIFACT_UPLOAD_FORBIDDEN: upload requires a same-origin loopback Studio session." });
      return true;
    }
    try { sendJson(response, 201, await useCases.registerSimulationInputArtifact(artifactUpload[1], await readBody(request, 1024 * 1024))); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to register Simulation input Artifact." }); }
    return true;
  }
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
