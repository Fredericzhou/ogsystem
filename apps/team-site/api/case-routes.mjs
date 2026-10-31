import { eventLabels } from "../event-labels.mjs";

function localizedFlowLabels(item, teamIR) {
  const legacyFlows = Array.isArray(item.flows) ? item.flows : [];
  const labelsFor = (eventType) => {
    const labels = eventLabels[eventType] || [eventType, eventType];
    return { "zh-CN": labels[0], en: labels[1] };
  };
  const result = {};
  const endpointLabels = new Map();
  for (const [from, to, eventType] of legacyFlows) {
    const key = `${from}:${to}`;
    const values = endpointLabels.get(key) || [];
    values.push({ eventType, label: labelsFor(eventType) });
    endpointLabels.set(key, values);
  }
  const outputEvents = new Map((item.roles || []).map((role) => [role.id, Object.fromEntries(
    (Array.isArray(role.events) ? role.events : []).map((eventType, index) => [index, eventType])
  )]));
  const agents = new Map((teamIR?.agents || []).map((agent) => [agent.id, agent]));
  const handoffs = Array.isArray(teamIR?.handoffs) ? teamIR.handoffs : [];
  const handoffsByEndpoint = new Map();
  for (const handoff of handoffs) {
    const from = handoff.from?.kind === "run" ? "__system_start__" : handoff.from?.agentId;
    const to = handoff.to?.kind === "result" ? "__system_end__" : handoff.to?.agentId;
    const key = `${from}:${to}`;
    const values = handoffsByEndpoint.get(key) || [];
    values.push(handoff);
    handoffsByEndpoint.set(key, values);
  }
  const eventByHandoff = new Map();
  const eventByPort = new Map();
  for (const [key, candidates] of handoffsByEndpoint) {
    const legacy = endpointLabels.get(key) || [];
    if (legacy.length !== 1) continue;
    // When a v2 port splits one legacy transition into conditional branches,
    // the last branch is the terminal transition in the built-in fixtures.
    const handoff = candidates[candidates.length - 1];
    eventByHandoff.set(handoff.id, legacy[0].eventType);
    if (handoff.from?.kind === "agent") eventByPort.set(`${handoff.from.agentId}:${handoff.from.outputPort}`, legacy[0].eventType);
  }
  for (const handoff of handoffs) {
    let eventType = eventByHandoff.get(handoff.id);
    if (!eventType && handoff.from?.kind === "agent") eventType = eventByPort.get(`${handoff.from.agentId}:${handoff.from.outputPort}`);
    if (!eventType && handoff.from?.kind === "agent") {
      const agent = agents.get(handoff.from.agentId);
      const outputPort = Object.keys(agent?.outputPorts || {}).indexOf(handoff.from.outputPort);
      eventType = outputEvents.get(handoff.from.agentId)?.[outputPort];
    }
    if (eventType) result[handoff.id] = labelsFor(eventType);
  }
  for (const [key, values] of endpointLabels) if (values.length === 1) result[key] = values[0].label;
  return result;
}

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
      flowLabels: localizedFlowLabels(item, teamIrFixtures?.[item.id]),
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
