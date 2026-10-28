export async function handleCaseRoutes({ request, response, url, readBody, sendJson, errorStatus, publicProject, cases, teamIrFixtures, createClassicTeamProject }) {
  if (request.method === "GET" && url.pathname === "/api/v1/cases") {
    sendJson(response, 200, { cases: cases.map((item) => ({
      id: item.id,
      title: item.title,
      short: item.short,
      category: item.category,
      duration: item.duration,
      accent: item.accent,
      icon: item.icon,
      detail: item.detail,
      roles: item.roles.map(({ id, label }) => ({ id, label, description: item.detail?.roles?.[id] })),
    })) });
    return true;
  }

  const irMatch = url.pathname.match(/^\/api\/v1\/cases\/([a-z0-9-]+)\/ir$/);
  if (irMatch && request.method === "GET") {
    const teamIR = teamIrFixtures?.[irMatch[1]];
    if (!teamIR) sendJson(response, 404, { error: "TEAM_IR_V2_FIXTURE_NOT_FOUND: no native Team IR v2 fixture exists for this team." });
    else sendJson(response, 200, { teamIR });
    return true;
  }
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
  return false;
}
