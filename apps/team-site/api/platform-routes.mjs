export async function handlePlatformRoutes({
  request,
  response,
  url,
  readBody,
  sendJson,
  useCases
}) {
  if (request.method === "GET" && url.pathname === "/api/v1/platform/backends") {
    try {
      sendJson(response, 200, { backends: useCases.listPlatformBackends(), discoveryPending: true });
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to list platform backends." });
    }
    return true;
  }

  const backendDiscoveryMatch = url.pathname.match(/^\/api\/v1\/platform\/backends\/([^/]+)\/discovery$/);
  if (request.method === "GET" && backendDiscoveryMatch) {
    try {
      const payload = await useCases.discoverPlatformBackend(decodeURIComponent(backendDiscoveryMatch[1]), url.searchParams.get("refresh") === "1");
      sendJson(response, payload.discoveryPending ? 202 : 200, payload);
    } catch (error) {
      const status = error?.code === "BACKEND_NOT_FOUND" ? 404 : 503;
      sendJson(response, status, { error: error instanceof Error ? error.message : "Unable to discover platform backend." });
    }
    return true;
  }

  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/v1/platform/discovery") {
    try {
      sendJson(response, 200, await useCases.getPlatformDiscovery(request.method === "POST"));
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform tools." });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/platform/models/probe") {
    try {
      const payload = await readBody(request);
      const result = await useCases.probeModelAvailability({
        backend: String(payload?.backend || ""),
        modelId: String(payload?.modelId || "")
      });
      sendJson(response, 200, { result });
    } catch (error) {
      sendJson(response, 200, { result: { status: "failed", message: error instanceof Error ? error.message : "Model availability probe failed." } });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/platform/providers") {
    try {
      sendJson(response, 200, await useCases.listPlatformProviders());
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform providers." });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/platform/models") {
    try {
      sendJson(response, 200, await useCases.listPlatformModels());
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform models." });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/platform/settings") {
    try {
      sendJson(response, 200, { settings: await useCases.readPlatformSettings() });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Unable to read platform settings." });
    }
    return true;
  }

  if (request.method === "PUT" && url.pathname === "/api/v1/platform/settings") {
    try {
      const payload = await readBody(request);
      const settings = await useCases.updatePlatformSettings(payload);
      sendJson(response, 200, { settings });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Unable to update platform settings." });
    }
    return true;
  }

  return false;
}
