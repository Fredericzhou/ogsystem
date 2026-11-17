export async function handlePlatformRoutes({
  request,
  response,
  url,
  readBody,
  sendJson,
  useCases,
  harnessUseCases = useCases
}) {
  const harnessMatch = url.pathname.match(/^\/api\/v2\/harness\/templates\/([^/]+)(?:\/(binding|verify|archive|copy))?$/);
  if (request.method === "GET" && url.pathname === "/api/v2/harness/templates") {
    try { sendJson(response, 200, { templates: await harnessUseCases.listTemplates({ includeArchived: url.searchParams.get("includeArchived") === "1" }) }); }
    catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : "Unable to list Harness templates." }); }
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/v2/harness/templates") {
    try { sendJson(response, 201, { template: await harnessUseCases.saveTemplate(await readBody(request)) }); }
    catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : "Unable to save Harness template." }); }
    return true;
  }
  if (harnessMatch) {
    const templateId = decodeURIComponent(harnessMatch[1]);
    const action = harnessMatch[2];
    try {
      if (request.method === "GET" && !action) {
        const template = await harnessUseCases.getTemplate(templateId, url.searchParams.get("revision"));
        if (!template) { sendJson(response, 404, { error: "HARNESS_TEMPLATE_NOT_FOUND" }); return true; }
        sendJson(response, 200, { template });
      } else if (request.method === "GET" && action === "binding") {
        sendJson(response, 200, await harnessUseCases.bindingSnapshot(templateId, url.searchParams.get("revision")));
      } else if (request.method === "PUT" && !action) {
        sendJson(response, 200, { template: await harnessUseCases.saveTemplate({ ...(await readBody(request)), templateId }) });
      } else if (request.method === "POST" && action === "verify") {
        sendJson(response, 200, { template: await harnessUseCases.verifyTemplate(templateId, url.searchParams.get("revision")) });
      } else if (request.method === "POST" && action === "copy") {
        sendJson(response, 201, { template: await harnessUseCases.copyTemplate(templateId, await readBody(request)) });
      } else if (request.method === "POST" && action === "archive") {
        sendJson(response, 200, { template: await harnessUseCases.archiveTemplate(templateId) });
      } else {
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      }
    } catch (error) {
      const status = error?.code === "HARNESS_TEMPLATE_NOT_FOUND" ? 404 : error?.code?.startsWith("HARNESS_") ? 400 : 500;
      sendJson(response, status, { error: error instanceof Error ? error.message : "Harness template operation failed." });
    }
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/v2/harness/backends") {
    try { sendJson(response, 200, { backends: await harnessUseCases.listBackends() }); }
    catch (error) { sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to list Harness backends." }); }
    return true;
  }
  const harnessBackendDiscovery = url.pathname.match(/^\/api\/v2\/harness\/backends\/([^/]+)\/discovery$/);
  if (request.method === "GET" && harnessBackendDiscovery) {
    try { sendJson(response, 200, await harnessUseCases.discoverBackend(decodeURIComponent(harnessBackendDiscovery[1]), url.searchParams.get("refresh") === "1", url.searchParams.get("model") || undefined)); }
    catch (error) { sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover Harness backend." }); }
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/v2/platform/backends") {
    try {
      sendJson(response, 200, { backends: useCases.listPlatformBackends(), discoveryPending: true });
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to list platform backends." });
    }
    return true;
  }

  const backendDiscoveryMatch = url.pathname.match(/^\/api\/v2\/platform\/backends\/([^/]+)\/discovery$/);
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

  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/v2/platform/discovery") {
    try {
      sendJson(response, 200, await useCases.getPlatformDiscovery(request.method === "POST" || url.searchParams.get("refresh") === "1"));
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform tools." });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v2/platform/models/probe") {
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

  if (request.method === "GET" && url.pathname === "/api/v2/platform/providers") {
    try {
      sendJson(response, 200, await useCases.listPlatformProviders());
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform providers." });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v2/platform/models") {
    try {
      sendJson(response, 200, await useCases.listPlatformModels());
    } catch (error) {
      sendJson(response, 503, { error: error instanceof Error ? error.message : "Unable to discover platform models." });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v2/platform/settings") {
    try {
      sendJson(response, 200, { settings: await useCases.readPlatformSettings() });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Unable to read platform settings." });
    }
    return true;
  }

  if (request.method === "PUT" && url.pathname === "/api/v2/platform/settings") {
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
