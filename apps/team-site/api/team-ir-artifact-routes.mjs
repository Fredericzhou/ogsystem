function isLoopback(request) {
  const address = String(request.socket?.remoteAddress || request.connection?.remoteAddress || "").toLowerCase();
  return address === "127.0.0.1" || address === "::1" || /^::ffff:127\./.test(address);
}

function isSameOriginRequest(request) {
  const origin = request.headers?.origin;
  if (!origin) return true;
  try { return new URL(origin).host === request.headers?.host; }
  catch { return false; }
}

export async function handleTeamIrArtifactRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const slotsMatch = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/artifacts\/run-input-slots$/);
  if (slotsMatch && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.listProjectRunInputArtifactSlots(slotsMatch[1], url.searchParams.get("teamVersionId")));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read Team IR Run input Artifact slots." });
    }
    return true;
  }
  const match = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/artifacts\/run-input$/);
  if (!match || request.method !== "POST") return false;
  if (!isLoopback(request) || !isSameOriginRequest(request)) {
    sendJson(response, 403, { error: "ARTIFACT_PRINCIPAL_UNAVAILABLE: Run input Artifact upload is limited to a same-origin local Project operator." });
    return true;
  }
  try {
    sendJson(response, 201, await useCases.registerProjectRunInputArtifact(match[1], await readBody(request), { id: "local-operator", issuer: "team-site-loopback" }));
  } catch (error) {
    sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to register Project Run input Artifact." });
  }
  return true;
}
