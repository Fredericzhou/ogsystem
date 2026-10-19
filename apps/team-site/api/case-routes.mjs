export async function handleCaseRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject, cases, eventLabels, buildCaseGraph, runCase, createClassicTeamProject }) {
  if (request.method === "GET" && url.pathname === "/api/v1/cases") {
    sendJson(response, 200, { eventLabels, cases: cases.map((item) => ({
      id: item.id,
      title: item.title,
      short: item.short,
      category: item.category,
      duration: item.duration,
      accent: item.accent,
      icon: item.icon,
      detail: item.detail,
      layout: item.layout,
      roles: item.roles.map(({ id, label }) => ({ id, label, description: item.detail?.roles?.[id] })),
      flows: item.flows.map(([from, to, event]) => ({ from, to, event })),
      joins: item.joins.map(({ roleId }) => ({ roleId }))
    })) });
    return true;
  }

  const graphMatch = url.pathname.match(/^\/api\/v1\/cases\/([a-z0-9-]+)\/graph$/);
  const caseActionMatch = url.pathname.match(/^\/api\/v1\/cases\/([a-z0-9-]+)\/(use|template)$/);
  if (caseActionMatch && request.method === "POST") {
    try {
      const payload = await readBody(request);
      const project = await createClassicTeamProject({
        caseId: caseActionMatch[1],
        asTemplate: caseActionMatch[2] === "template",
        name: payload.name,
        overview: payload.overview,
        locale: payload.locale
      });
      sendJson(response, 201, publicProject(project));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create team project." });
    }
    return true;
  }
  if (request.method === "GET" && graphMatch) {
    try {
      sendJson(response, 200, buildCaseGraph(graphMatch[1], url.searchParams.get("locale") || "zh-CN"));
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : "Unable to load team graph." });
    }
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/demo-runs") {
    try {
      const payload = await readBody(request);
      const result = await runCase({ caseId: payload.caseId, prompt: payload.prompt, locale: payload.locale, mode: "simulation" });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Run failed." });
    }
    return true;
  }
  return false;
}
