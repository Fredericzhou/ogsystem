const START_ID = "__system_start__";
const END_ID = "__system_end__";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function teamConditionValueToStudio(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.keys(value).length === 1 && typeof value.$ref === "string") {
      const path = value.$ref.startsWith("$.") ? value.$ref.slice(2).split(".") : [];
      if (path.length && path.every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) {
        return { kind: "path", root: "state", path };
      }
    }
    if (Object.keys(value).length === 1 && Object.hasOwn(value, "$literal")) return { kind: "literal", value: clone(value.$literal) };
  }
  return clone(value);
}

export function teamConditionToStudio(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return clone(condition);
  const op = condition.op;
  const args = Array.isArray(condition.args) ? condition.args : [];
  if (op === "notEquals") return { op: "not", args: [{ op: "equals", args: args.map(teamConditionValueToStudio) }] };
  const nextOp = op === "and" ? "all" : op === "or" ? "any" : op;
  if (["equals", "exists"].includes(nextOp)) return { op: nextOp, args: args.map(teamConditionValueToStudio) };
  if (["all", "any", "not"].includes(nextOp)) return { op: nextOp, args: args.map((child) => teamConditionToStudio(child)) };
  return clone(condition);
}

function studioConditionValueToTeam(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.kind === "path" && Array.isArray(value.path) && value.path.every((segment) => typeof segment === "string")) {
      return { $ref: `$.${value.path.join(".")}` };
    }
    if (value.kind === "literal") return { $literal: clone(value.value) };
    if (Object.keys(value).length === 1 && (typeof value.$ref === "string" || Object.hasOwn(value, "$literal"))) return clone(value);
  }
  return clone(value);
}

export function studioConditionToTeam(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return clone(condition);
  const op = condition.op;
  const args = Array.isArray(condition.args) ? condition.args : [];
  if (op === "not" && args[0]?.op === "equals") return { op: "notEquals", args: args[0].args.map(studioConditionValueToTeam) };
  const nextOp = op === "all" ? "and" : op === "any" ? "or" : op;
  if (["equals", "notEquals", "exists"].includes(nextOp)) return { op: nextOp, args: args.map(studioConditionValueToTeam) };
  if (["and", "or", "not"].includes(nextOp)) return { op: nextOp, args: args.map((child) => studioConditionToTeam(child)) };
  return clone(condition);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundaryRoleId(endpoint, boundaryId) {
  return endpoint?.kind === boundaryId ? boundaryId === "run" ? START_ID : END_ID : String(endpoint?.agentId || "");
}

function boundaryEndpoint(roleId, kind) {
  if (roleId === START_ID) return { kind: "run" };
  if (roleId === END_ID) return { kind: "result" };
  return kind === "source"
    ? { kind: "agent", agentId: roleId, outputPort: "" }
    : { kind: "agent", agentId: roleId, inputPort: "" };
}

function bindingFor(teamIR, bindingRef) {
  return (Array.isArray(teamIR?.bindings) ? teamIR.bindings : []).find((binding) => binding?.id === bindingRef) || {};
}

function layoutFor(layout, id, index, columns = 3) {
  return layout?.[id] || { x: 160 + (index % columns) * 260, y: 110 + Math.floor(index / columns) * 150, width: 180, height: 84 };
}

export function teamIrToGraphAuthoring(teamIR, layout = {}, presentation = {}) {
  const agents = Array.isArray(teamIR?.agents) ? teamIR.agents : [];
  const handoffs = Array.isArray(teamIR?.handoffs) ? teamIR.handoffs : [];
  const orchestration = asRecord(teamIR?.orchestration);
  const joinsByTarget = new Map((Array.isArray(orchestration.joins) ? orchestration.joins : [])
    .filter((join) => join?.agentId && join?.inputPort)
    .map((join) => [`${join.agentId}:${join.inputPort}`, join]));
  const loopsByAgent = new Map();
  for (const loop of Array.isArray(orchestration.loops) ? orchestration.loops : []) {
    for (const agentId of Array.isArray(loop?.members) ? loop.members : []) loopsByAgent.set(agentId, loop);
  }
  const reviewsByAgent = new Map();
  for (const review of Array.isArray(orchestration.reviews) ? orchestration.reviews : []) {
    if (review?.at?.agentId) reviewsByAgent.set(review.at.agentId, review);
  }
  const roleLabels = asRecord(presentation?.roleLabels);
  const edgeLabels = asRecord(presentation?.edgeLabels);
  const roles = Object.fromEntries(agents.map((agent, index) => {
    const binding = bindingFor(teamIR, agent.bindingRef);
    // inputPorts is keyed by the stable port id; values are port contracts.
    const join = Object.keys(agent.inputPorts || {}).map((portId) => joinsByTarget.get(`${agent.id}:${portId}`)).find(Boolean);
    const joinSources = join?.handoffIds
      ?.map((handoffId) => handoffs.find((handoff) => handoff.id === handoffId)?.from?.agentId)
      .filter(Boolean);
    const loop = loopsByAgent.get(agent.id);
    const review = reviewsByAgent.get(agent.id);
    const irPresentation = asRecord(teamIR?.presentation);
    const nodePresentation = asRecord(asRecord(irPresentation.nodes)[agent.id]);
    const title = nodePresentation.label || roleLabels[agent.id] || agent.id;
    return [agent.id, {
      roleId: agent.id,
      title,
      label: nodePresentation.label,
      packageRef: agent.packageRef,
      bindingRef: agent.bindingRef,
      inputPorts: clone(agent.inputPorts),
      outputPorts: clone(agent.outputPorts),
      bindingKind: binding.kind === "a2a" ? "model" : binding.kind === "tool" ? "exec" : "model",
      modelRef: binding.modelRef,
      profileId: binding.toolRef,
      joinMode: join?.mode,
      joinMin: join?.threshold,
      joinSources: joinSources?.length ? joinSources : undefined,
      loopMax: loop?.maxRounds,
      review: review ? { mode: "required", timeoutSeconds: Math.round(Number(review.timeoutMs || 0) / 1000) || undefined } : undefined,
      layout: layoutFor(layout, agent.id, index)
    }];
  }));
  const flows = Object.fromEntries(handoffs.map((handoff) => {
    const fromRoleId = handoff.from?.kind === "run" ? START_ID : String(handoff.from?.agentId || "");
    const toRoleId = handoff.to?.kind === "result" ? END_ID : String(handoff.to?.agentId || "");
    const edgePresentation = asRecord(asRecord(teamIR?.presentation).edges)[handoff.id];
    const sourceKey = fromRoleId === START_ID ? "__system_start__" : fromRoleId;
    const targetKey = toRoleId === END_ID ? "__system_end__" : toRoleId;
    return [handoff.id, {
      flowId: handoff.id,
      fromRoleId,
      toRoleId,
      eventType: handoff.from?.kind === "agent" ? String(handoff.from.outputPort || "") : "START",
      outputPort: handoff.from?.kind === "agent" ? String(handoff.from.outputPort || "") : "",
      inputPort: handoff.to?.kind === "agent" ? String(handoff.to.inputPort || "") : "",
      label: edgePresentation?.label || edgeLabels[handoff.id] || edgeLabels[`${sourceKey}:${targetKey}`] || handoff.id,
      condition: teamConditionToStudio(handoff.when?.condition),
      priority: handoff.when?.priority,
      participatesInJoin: handoff.to?.kind === "agent"
        && Array.isArray(joinsByTarget.get(`${handoff.to.agentId}:${handoff.to.inputPort}`)?.handoffIds)
        && joinsByTarget.get(`${handoff.to.agentId}:${handoff.to.inputPort}`).handoffIds.includes(handoff.id)
    }];
  }));
  return {
    version: 1,
    project: { workdir: "", systemPath: "" },
    system: {
      systemId: teamIR?.team?.id || "team",
      systemVersion: teamIR?.team?.version || "2.0.0",
      startDispatch: { mode: "all" },
      lawGlobalRef: "team-ir-v2"
    },
    roles,
    flows,
    layout: {
      nodes: {
        [START_ID]: layoutFor(layout, START_ID, 0, 1),
        ...Object.fromEntries(agents.map((agent, index) => [agent.id, layoutFor(layout, agent.id, index)])),
        [END_ID]: layoutFor(layout, END_ID, agents.length + 1, 1)
      }
    }
  };
}

export function graphAuthoringToTeamIr(baseTeamIR, nextAuthoring) {
  const next = clone(baseTeamIR);
  const roles = asRecord(nextAuthoring?.roles);
  const flows = asRecord(nextAuthoring?.flows);
  const agentsById = new Map((Array.isArray(next.agents) ? next.agents : []).map((agent) => [agent.id, agent]));
  const bindingsById = new Map((Array.isArray(next.bindings) ? next.bindings : []).map((binding) => [binding.id, binding]));
  const roleIds = new Set(Object.keys(roles).filter((roleId) => ![START_ID, END_ID].includes(roleId)));
  next.agents = (next.agents || []).filter((agent) => roleIds.has(agent.id));
  for (const [roleId, role] of Object.entries(roles)) {
    if ([START_ID, END_ID].includes(roleId) || agentsById.has(roleId)) continue;
    next.agents.push({
      id: roleId,
      packageRef: role.packageRef,
      bindingRef: role.bindingRef,
      inputPorts: {},
      outputPorts: {}
    });
  }
  for (const [roleId, role] of Object.entries(roles)) {
    const agent = agentsById.get(roleId);
    if (!agent) continue;
    const binding = bindingsById.get(agent.bindingRef);
    if (binding && role.modelRef && binding.kind === "model") binding.modelRef = role.modelRef;
  }
  const handoffById = new Map((Array.isArray(next.handoffs) ? next.handoffs : []).map((handoff) => [handoff.id, handoff]));
  const flowIds = new Set(Object.keys(flows));
  next.handoffs = (next.handoffs || []).filter((handoff) => flowIds.has(handoff.id));
  for (const [flowId, flow] of Object.entries(flows)) {
    let handoff = handoffById.get(flowId);
    if (!handoff) {
      handoff = {
        id: flowId,
        from: boundaryEndpoint(flow.fromRoleId, "source"),
        to: boundaryEndpoint(flow.toRoleId, "target"),
        map: { data: {} },
        when: { priority: Number(flow.priority || 0) },
        delivery: { deadlineMs: 300000 }
      };
      next.handoffs.push(handoff);
    }
    handoff.from = flow.fromRoleId === START_ID
      ? { kind: "run" }
      : { kind: "agent", agentId: flow.fromRoleId, outputPort: flow.outputPort || flow.eventType || "" };
    handoff.to = flow.toRoleId === END_ID
      ? { kind: "result" }
      : { kind: "agent", agentId: flow.toRoleId, inputPort: flow.inputPort || "" };
    if (flow.condition) handoff.when = { ...(handoff.when || {}), condition: studioConditionToTeam(flow.condition) };
    else if (handoff.when?.condition) delete handoff.when.condition;
    if (flow.priority !== undefined) handoff.when = { ...(handoff.when || {}), priority: flow.priority };
  }
  return next;
}

const AGENT_FIELDS = new Set(["packageRef", "bindingRef", "inputPorts", "outputPorts"]);
const HANDOFF_FIELDS = new Set(["from", "to", "map", "when", "delivery"]);
const BINDING_FIELDS = new Set(["kind", "modelRef", "toolRef", "agentCardRef", "credentialRef", "attemptTimeoutMs", "retry", "capabilities"]);
const AGENT_BINDING_FIELDS = new Set(["bindingRef"]);
const ROUTE_FIELDS = new Set(["from", "mode", "onNoMatch", "handoffIds"]);
const JOIN_FIELDS = new Set(["agentId", "inputPort", "mode", "handoffIds", "scope", "threshold", "baseMapping", "timeoutMs", "onTimeout"]);
const LOOP_FIELDS = new Set(["members", "boundaryAgentId", "entryHandoffIds", "continueHandoffIds", "exitHandoffIds", "maxRounds", "maxAgentActivations", "onExhausted"]);
const REVIEW_FIELDS = new Set(["at", "feedbackSchema", "timeoutMs", "onTimeout"]);
const PORT_FIELDS = new Set(["dataSchema", "artifactSlots"]);
const ARTIFACT_SLOT_FIELDS = new Set(["required", "acceptedMediaTypes", "mediaTypes", "cardinality"]);
const RUN_INPUT_FIELDS = new Set(["dataSchema", "preferencesSchema", "artifactSlots"]);
const RUN_RESULT_FIELDS = new Set(["dataSchema", "artifactSlots"]);
const EXECUTION_POLICY_FIELDS = new Set(["resultMode", "activeExecutionBudgetMs"]);

function patchFailure(baseTeamIR, error) {
  return { ok: false, error, teamIR: clone(baseTeamIR) };
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function fieldsValue(patch) {
  return objectValue(patch?.fields) || objectValue(patch?.value);
}

function assertFields(fields, allowed) {
  if (!fields) return "TEAM_IR_PATCH_UPDATE_INVALID";
  for (const field of Object.keys(fields)) if (!allowed.has(field)) return `TEAM_IR_PATCH_FIELD_UNSUPPORTED:${field}`;
  return null;
}

function bindingShapeError(binding) {
  if (binding?.kind === "model" && typeof binding.modelRef === "string" && binding.modelRef
    && !binding.toolRef && !binding.agentCardRef) return null;
  if (binding?.kind === "tool" && typeof binding.toolRef === "string" && binding.toolRef
    && !binding.modelRef && !binding.agentCardRef) return null;
  if (binding?.kind === "a2a" && typeof binding.agentCardRef === "string" && binding.agentCardRef
    && !binding.modelRef && !binding.toolRef) return null;
  return "TEAM_IR_PATCH_BINDING_SHAPE_INVALID";
}

function orchestration(next) {
  if (!objectValue(next.orchestration)) next.orchestration = {};
  for (const key of ["routes", "joins", "loops", "reviews"]) if (!Array.isArray(next.orchestration[key])) next.orchestration[key] = [];
  return next.orchestration;
}

function removeHandoffReferences(next, handoffId) {
  const orchestrationValue = orchestration(next);
  orchestrationValue.routes = orchestrationValue.routes
    .map((route) => ({ ...route, handoffIds: Array.isArray(route?.handoffIds) ? route.handoffIds.filter((id) => id !== handoffId) : [] }))
    .filter((route) => route.handoffIds.length > 0);
  orchestrationValue.joins = orchestrationValue.joins
    .map((join) => ({ ...join, handoffIds: Array.isArray(join?.handoffIds) ? join.handoffIds.filter((id) => id !== handoffId) : [] }))
    .filter((join) => join.handoffIds.length > 0);
  orchestrationValue.loops = orchestrationValue.loops
    .map((loop) => ({
      ...loop,
      entryHandoffIds: Array.isArray(loop?.entryHandoffIds) ? loop.entryHandoffIds.filter((id) => id !== handoffId) : [],
      continueHandoffIds: Array.isArray(loop?.continueHandoffIds) ? loop.continueHandoffIds.filter((id) => id !== handoffId) : [],
      exitHandoffIds: Array.isArray(loop?.exitHandoffIds) ? loop.exitHandoffIds.filter((id) => id !== handoffId) : []
    }))
    .filter((loop) => loop.entryHandoffIds.length > 0 && loop.continueHandoffIds.length > 0 && loop.exitHandoffIds.length > 0);
}

function removeAgentReferences(next, agentId) {
  const handoffs = Array.isArray(next.handoffs) ? next.handoffs : [];
  const removedHandoffIds = handoffs.filter((handoff) => handoff?.from?.agentId === agentId || handoff?.to?.agentId === agentId).map((handoff) => handoff.id);
  next.handoffs = handoffs.filter((handoff) => !removedHandoffIds.includes(handoff?.id));
  const orchestrationValue = orchestration(next);
  orchestrationValue.routes = orchestrationValue.routes.filter((route) => route?.from?.agentId !== agentId);
  orchestrationValue.joins = orchestrationValue.joins.filter((join) => join?.agentId !== agentId && join?.scope?.agentId !== agentId);
  orchestrationValue.loops = orchestrationValue.loops
    .filter((loop) => loop?.boundaryAgentId !== agentId)
    .map((loop) => ({
      ...loop,
      ...(Array.isArray(loop?.members) ? { members: loop.members.filter((member) => member !== agentId) } : {})
    }))
    .filter((loop) => Array.isArray(loop?.members) ? loop.members.length > 0 : true);
  orchestrationValue.reviews = orchestrationValue.reviews.filter((review) => review?.at?.agentId !== agentId);
  for (const handoffId of removedHandoffIds) removeHandoffReferences(next, handoffId);
  const presentation = objectValue(next.presentation);
  if (presentation?.nodes && Object.hasOwn(presentation.nodes, agentId)) delete presentation.nodes[agentId];
}

function removePortReferences(next, agentId, direction, portId) {
  const output = direction === "output";
  const handoffs = Array.isArray(next.handoffs) ? next.handoffs : [];
  const removedHandoffIds = handoffs.filter((handoff) => {
    if (output) return handoff?.from?.kind === "agent" && handoff.from.agentId === agentId && handoff.from.outputPort === portId;
    return handoff?.to?.kind === "agent" && handoff.to.agentId === agentId && handoff.to.inputPort === portId;
  }).map((handoff) => handoff.id);
  next.handoffs = handoffs.filter((handoff) => !removedHandoffIds.includes(handoff?.id));
  const orchestrationValue = orchestration(next);
  orchestrationValue.joins = orchestrationValue.joins.filter((join) => !(join?.agentId === agentId && join?.inputPort === portId));
  orchestrationValue.reviews = orchestrationValue.reviews.filter((review) => !(output && review?.at?.agentId === agentId && review?.at?.outputPort === portId));
  orchestrationValue.routes = orchestrationValue.routes.filter((route) => !(output && route?.from?.agentId === agentId && route?.from?.outputPort === portId));
  for (const handoffId of removedHandoffIds) removeHandoffReferences(next, handoffId);
}

function endpointMatches(route, patch) {
  if (Number.isInteger(patch?.index)) return patch.index;
  const target = patch?.from || patch?.route?.from;
  if (!target) return -1;
  return route.findIndex((entry) => JSON.stringify(entry?.from) === JSON.stringify(target));
}

function updateCollection(next, collection, id, fields, allowed) {
  const values = Array.isArray(next[collection]) ? next[collection] : [];
  const index = values.findIndex((item) => item?.id === id);
  if (index < 0) return patchFailure(next, "TEAM_IR_PATCH_TARGET_MISSING");
  const fieldError = assertFields(fields, allowed);
  if (fieldError) return patchFailure(next, fieldError);
  next[collection] = values.map((item, valueIndex) => valueIndex === index ? { ...item, ...clone(fields) } : item);
  return { ok: true, teamIR: next };
}

/**
 * Apply one explicit Team IR edit. Graph objects are never merged directly
 * into the IR: each operation names the v2 collection and the fields it owns.
 * Legacy collection operations remain supported for the current Studio slices.
 */
export function applyTeamIrPatch(baseTeamIR, patch) {
  const next = clone(baseTeamIR);
  if (!next || next.schemaVersion !== 2 || !patch || typeof patch !== "object") return patchFailure(baseTeamIR, "TEAM_IR_PATCH_INVALID");
  const op = typeof patch.op === "string" ? patch.op : "";
  const id = typeof patch.id === "string" ? patch.id.trim() : "";

  // Compatibility operations used by the current form editor.
  if (["add", "update", "remove"].includes(op) && ["agents", "handoffs", "bindings"].includes(patch.collection)) {
    const collection = patch.collection;
    if (!id) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_INVALID");
    const values = Array.isArray(next[collection]) ? next[collection] : [];
    const index = values.findIndex((item) => item?.id === id);
    if (op === "remove") {
      if (index < 0) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
      next[collection] = values.filter((_, valueIndex) => valueIndex !== index);
      if (collection === "agents") removeAgentReferences(next, id);
      return { ok: true, teamIR: next };
    }
    if (op === "add") {
      const value = objectValue(patch.value);
      if (index >= 0) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_EXISTS");
      if (!value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_VALUE_INVALID");
      const allowed = collection === "agents" ? AGENT_FIELDS : collection === "handoffs" ? HANDOFF_FIELDS : BINDING_FIELDS;
      const fieldError = assertFields(value, allowed);
      if (fieldError) return patchFailure(baseTeamIR, fieldError);
      next[collection] = [...values, { ...clone(value), id }];
      return { ok: true, teamIR: next };
    }
    return updateCollection(next, collection, id, objectValue(patch.fields), collection === "agents" ? AGENT_FIELDS : collection === "handoffs" ? HANDOFF_FIELDS : BINDING_FIELDS);
  }

  if (op === "agent.create") {
    const value = objectValue(patch.value || patch.agent);
    const agentId = id || String(value?.id || "").trim();
    if (!agentId || !value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_INVALID");
    const { id: _ignoredId, ...agentFields } = value;
    const fieldError = assertFields(agentFields, AGENT_FIELDS);
    if (fieldError) return patchFailure(baseTeamIR, fieldError);
    if ((next.agents || []).some((agent) => agent?.id === agentId)) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_EXISTS");
    next.agents = [...(Array.isArray(next.agents) ? next.agents : []), { ...clone(agentFields), id: agentId }];
    return { ok: true, teamIR: next };
  }
  if (op === "agent.update") return updateCollection(next, "agents", id, fieldsValue(patch), AGENT_FIELDS);
  if (op === "agent.remove") {
    const values = Array.isArray(next.agents) ? next.agents : [];
    if (!id || !values.some((agent) => agent?.id === id)) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
    next.agents = values.filter((agent) => agent?.id !== id);
    removeAgentReferences(next, id);
    return { ok: true, teamIR: next };
  }
  if (op === "agent.rename") {
    const oldId = id || patch.from;
    const newId = String(patch.newId || patch.to || "").trim();
    if (!oldId || !newId || oldId === newId) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_RENAME_INVALID");
    if (!(next.agents || []).some((agent) => agent?.id === oldId)) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
    if ((next.agents || []).some((agent) => agent?.id === newId)) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_EXISTS");
    next.agents = next.agents.map((agent) => agent?.id === oldId ? { ...agent, id: newId } : agent);
    for (const handoff of next.handoffs || []) {
      for (const endpoint of [handoff.from, handoff.to]) if (endpoint?.agentId === oldId) endpoint.agentId = newId;
    }
    const orchestrationValue = orchestration(next);
    for (const route of orchestrationValue.routes) if (route?.from?.agentId === oldId) route.from.agentId = newId;
    for (const join of orchestrationValue.joins) if (join?.agentId === oldId) join.agentId = newId;
    for (const loop of orchestrationValue.loops) {
      if (loop?.boundaryAgentId === oldId) loop.boundaryAgentId = newId;
      if (Array.isArray(loop?.members)) loop.members = loop.members.map((member) => member === oldId ? newId : member);
    }
    for (const review of orchestrationValue.reviews) if (review?.at?.agentId === oldId) review.at.agentId = newId;
    const presentation = objectValue(next.presentation);
    if (presentation?.nodes && Object.hasOwn(presentation.nodes, oldId)) {
      presentation.nodes[newId] = presentation.nodes[oldId];
      delete presentation.nodes[oldId];
    }
    return { ok: true, teamIR: next };
  }

  if (op === "agent.port.upsert" || op === "agent.port.remove") {
    const agentId = String(patch.agentId || patch.ownerId || "").trim();
    const direction = String(patch.direction || patch.portKind || "").toLowerCase().replace(/s$/, "");
    const portId = String(patch.portId || (direction === "input" ? patch.inputPort : patch.outputPort) || patch.id || "").trim();
    const agent = (next.agents || []).find((candidate) => candidate?.id === agentId);
    if (!agent || !["input", "output"].includes(direction) || !portId) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_PORT_TARGET_INVALID");
    const portsKey = direction === "input" ? "inputPorts" : "outputPorts";
    const ports = objectValue(agent[portsKey]) || {};
    if (op === "agent.port.remove") {
      if (!Object.hasOwn(ports, portId)) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
      delete ports[portId];
      if (!Object.keys(ports).length) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_LAST_PORT");
      agent[portsKey] = ports;
      removePortReferences(next, agentId, direction, portId);
    } else {
      const value = objectValue(patch.port || patch.value);
      if (!value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_PORT_VALUE_INVALID");
      const fieldError = assertFields(value, PORT_FIELDS);
      if (fieldError) return patchFailure(baseTeamIR, fieldError);
      ports[portId] = clone(value);
      agent[portsKey] = ports;
    }
    return { ok: true, teamIR: next };
  }

  if (op === "agent.binding.update") {
    const agent = (next.agents || []).find((candidate) => candidate?.id === id || candidate?.id === patch.agentId);
    if (!agent) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
    const rawFields = fieldsValue(patch) || (patch.bindingRef !== undefined ? { bindingRef: patch.bindingRef } : null);
    const fieldError = assertFields(rawFields, AGENT_BINDING_FIELDS);
    if (fieldError) return patchFailure(baseTeamIR, fieldError);
    const bindingRef = String(rawFields.bindingRef || "").trim();
    if (!bindingRef) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_BINDING_INVALID");
    agent.bindingRef = bindingRef;
    return { ok: true, teamIR: next };
  }

  if (op === "a2a.binding.update") {
    const rawFields = fieldsValue(patch);
    const bindingId = String(patch.bindingId || id || rawFields?.id || "").trim();
    if (!bindingId || !rawFields) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_BINDING_INVALID");
    const { id: _ignoredId, ...bindingFields } = rawFields;
    const result = updateCollection(next, "bindings", bindingId, bindingFields, BINDING_FIELDS);
    if (result.ok) {
      const binding = result.teamIR.bindings.find((candidate) => candidate.id === bindingId);
      if (binding?.kind !== "a2a") return patchFailure(baseTeamIR, "TEAM_IR_PATCH_BINDING_KIND_INVALID");
      const shapeError = bindingShapeError(binding);
      if (shapeError) return patchFailure(baseTeamIR, shapeError);
    }
    return result;
  }

  if (op === "binding.update") {
    const rawFields = fieldsValue(patch);
    const bindingId = String(patch.bindingId || id || rawFields?.id || "").trim();
    if (!bindingId || !rawFields) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_BINDING_INVALID");
    const { id: _ignoredId, ...bindingFields } = rawFields;
    const result = updateCollection(next, "bindings", bindingId, bindingFields, BINDING_FIELDS);
    if (result.ok) {
      const binding = result.teamIR.bindings.find((candidate) => candidate.id === bindingId);
      const shapeError = bindingShapeError(binding);
      if (shapeError) return patchFailure(baseTeamIR, shapeError);
    }
    return result;
  }

  if (["handoff.create", "handoff.update", "handoff.remove", "handoff.retarget"].includes(op)) {
    const handoffs = Array.isArray(next.handoffs) ? next.handoffs : [];
    const index = handoffs.findIndex((handoff) => handoff?.id === id);
    if (op === "handoff.remove") {
      if (index < 0) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
      next.handoffs = handoffs.filter((_, valueIndex) => valueIndex !== index);
      removeHandoffReferences(next, id);
      return { ok: true, teamIR: next };
    }
    if (op === "handoff.create") {
      const value = objectValue(patch.value || patch.handoff);
      const handoffId = id || String(value?.id || "").trim();
      if (!handoffId || !value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_INVALID");
      const { id: _ignoredId, ...handoffFields } = value;
      const fieldError = assertFields(handoffFields, HANDOFF_FIELDS);
      if (fieldError) return patchFailure(baseTeamIR, fieldError);
      if (handoffs.some((handoff) => handoff?.id === handoffId)) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_EXISTS");
      next.handoffs = [...handoffs, { ...clone(handoffFields), id: handoffId }];
      return { ok: true, teamIR: next };
    }
    if (index < 0) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
    if (op === "handoff.retarget") {
      const from = patch.from || patch.source;
      const to = patch.to || patch.target;
      if ((from !== undefined && !objectValue(from)) || (to !== undefined && !objectValue(to)) || (from === undefined && to === undefined)) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_RETARGET_INVALID");
      const updated = { ...handoffs[index], ...(from ? { from: clone(from) } : {}), ...(to ? { to: clone(to) } : {}) };
      if (updated.to?.kind === "result") delete updated.delivery;
      else if (updated.to?.kind === "agent" && !updated.delivery) updated.delivery = { deadlineMs: 300000 };
      next.handoffs[index] = updated;
      return { ok: true, teamIR: next };
    }
    return updateCollection(next, "handoffs", id, fieldsValue(patch), HANDOFF_FIELDS);
  }

  if (op === "route.upsert" || op === "route.remove") {
    const routes = orchestration(next).routes;
    const index = endpointMatches(routes, patch);
    if (op === "route.remove") {
      if (index < 0 || index >= routes.length) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
      routes.splice(index, 1);
      return { ok: true, teamIR: next };
    }
    const value = objectValue(patch.value || patch.route) || fieldsValue(patch);
    if (!value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_ROUTE_INVALID");
    const fieldError = assertFields(value, ROUTE_FIELDS);
    if (fieldError) return patchFailure(baseTeamIR, fieldError);
    if (index >= 0 && index < routes.length) routes[index] = { ...routes[index], ...clone(value) };
    else routes.push(clone(value));
    return { ok: true, teamIR: next };
  }

  for (const [kind, key, allowed] of [["join", "joins", JOIN_FIELDS], ["loop", "loops", LOOP_FIELDS], ["review", "reviews", REVIEW_FIELDS]]) {
    if (op === `${kind}.remove`) {
      const values = orchestration(next)[key];
      const index = values.findIndex((entry) => entry?.id === id);
      if (index < 0) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
      values.splice(index, 1);
      return { ok: true, teamIR: next };
    }
    if (op === `${kind}.upsert`) {
      const values = orchestration(next)[key];
      const value = objectValue(patch.value || patch[kind]) || fieldsValue(patch);
      const entryId = id || String(value?.id || "").trim();
      if (!entryId || !value) return patchFailure(baseTeamIR, `TEAM_IR_PATCH_${kind.toUpperCase()}_INVALID`);
      const { id: _ignoredId, ...entryFields } = value;
      const fieldError = assertFields(entryFields, allowed);
      if (fieldError) return patchFailure(baseTeamIR, fieldError);
      const index = values.findIndex((entry) => entry?.id === entryId);
      if (index >= 0) values[index] = { ...values[index], ...clone(entryFields), id: entryId };
      else values.push({ ...clone(entryFields), id: entryId });
      return { ok: true, teamIR: next };
    }
  }

  if (op === "artifactSlot.upsert" || op === "artifactSlot.remove") {
    const target = objectValue(patch.target) || patch;
    const slotId = String(patch.slotId || patch.id || "").trim();
    const owner = target.owner || target.scope || target.kind;
    let slots;
    if (owner === "runInput" || owner === "runResult") {
      const contractKey = owner;
      if (!objectValue(next[contractKey])) next[contractKey] = {};
      slots = objectValue(next[contractKey].artifactSlots) || {};
      next[contractKey].artifactSlots = slots;
    } else {
      const agent = (next.agents || []).find((candidate) => candidate?.id === target.agentId);
      const direction = String(target.direction || target.portKind || (target.inputPort ? "input" : "output") || "").toLowerCase().replace(/s$/, "");
      const portId = String(target.portId || target.inputPort || target.outputPort || "").trim();
      const portsKey = direction === "output" ? "outputPorts" : "inputPorts";
      const port = agent && objectValue(agent[portsKey])?.[portId];
      if (!port) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_ARTIFACT_TARGET_INVALID");
      slots = objectValue(port.artifactSlots) || {};
      port.artifactSlots = slots;
    }
    if (!slotId) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_ARTIFACT_SLOT_INVALID");
    if (op === "artifactSlot.remove") {
      if (!Object.hasOwn(slots, slotId)) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_TARGET_MISSING");
      delete slots[slotId];
    } else {
      const value = objectValue(patch.slot || patch.value);
      if (!value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_ARTIFACT_SLOT_INVALID");
      const fieldError = assertFields(value, ARTIFACT_SLOT_FIELDS);
      if (fieldError) return patchFailure(baseTeamIR, fieldError);
      slots[slotId] = clone(value);
    }
    return { ok: true, teamIR: next };
  }

  if (op === "runInput.update" || op === "runResult.update" || op === "executionPolicy.update") {
    const key = op === "runInput.update" ? "runInput" : op === "runResult.update" ? "runResult" : "executionPolicy";
    const allowed = op === "runInput.update" ? RUN_INPUT_FIELDS : op === "runResult.update" ? RUN_RESULT_FIELDS : EXECUTION_POLICY_FIELDS;
    const fields = fieldsValue(patch);
    const fieldError = assertFields(fields, allowed);
    if (fieldError) return patchFailure(baseTeamIR, fieldError);
    next[key] = { ...(objectValue(next[key]) || {}), ...clone(fields) };
    return { ok: true, teamIR: next };
  }

  if (op === "presentation.nodeLabel" || op === "presentation.edgeLabel") {
    const targetId = String(patch.nodeId || patch.edgeId || patch.id || "").trim();
    const label = patch.label ?? patch.value;
    if (!targetId || (label !== undefined && typeof label !== "string")) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_PRESENTATION_INVALID");
    if (!objectValue(next.presentation)) next.presentation = {};
    const key = op.endsWith("nodeLabel") ? "nodes" : "edges";
    if (!objectValue(next.presentation[key])) next.presentation[key] = {};
    const presentation = next.presentation[key];
    if (label === undefined || label === null || label === "") {
      if (Object.hasOwn(presentation, targetId) && objectValue(presentation[targetId])) delete presentation[targetId].label;
    } else presentation[targetId] = { ...(objectValue(presentation[targetId]) || {}), label };
    return { ok: true, teamIR: next };
  }

  if (op === "document.replace") {
    const value = objectValue(patch.document || patch.value);
    if (!value || value.schemaVersion !== 2) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_DOCUMENT_INVALID");
    return { ok: true, teamIR: clone(value) };
  }

  // Older named operations remain available for Advanced JSON and existing forms.
  if (op === "set-orchestration") {
    const value = objectValue(patch.value);
    if (!value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_ORCHESTRATION_INVALID");
    next.orchestration = { ...(objectValue(next.orchestration) || {}), ...clone(value) };
    return { ok: true, teamIR: next };
  }
  if (op === "set-run-contract") {
    const value = objectValue(patch.value);
    if (!value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_RUN_CONTRACT_INVALID");
    next.runInput = { ...(objectValue(next.runInput) || {}), ...clone(value) };
    return { ok: true, teamIR: next };
  }
  if (op === "set-result-contract") {
    const value = objectValue(patch.value);
    if (!value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_RESULT_CONTRACT_INVALID");
    next.runResult = { ...(objectValue(next.runResult) || {}), ...clone(value) };
    return { ok: true, teamIR: next };
  }
  if (op === "replace-advanced") {
    const value = objectValue(patch.value);
    if (!value) return patchFailure(baseTeamIR, "TEAM_IR_PATCH_ADVANCED_INVALID");
    for (const key of ["agentPortContracts", "handoffContracts", "orchestration", "runInput", "runResult"]) if (Object.hasOwn(value, key)) next[key] = clone(value[key]);
    return { ok: true, teamIR: next };
  }
  return patchFailure(baseTeamIR, "TEAM_IR_PATCH_UNSUPPORTED");
}

export function applyTeamIrPatches(baseTeamIR, patches) {
  let current = clone(baseTeamIR);
  for (const patch of Array.isArray(patches) ? patches : []) {
    const result = applyTeamIrPatch(current, patch);
    if (!result.ok) return { ...result, teamIR: clone(baseTeamIR), failedPatch: patch };
    current = result.teamIR;
  }
  return { ok: true, teamIR: current };
}

export function graphLayoutKey(teamId, teamVersionId, nodeId) {
  return `ogs.team-ir-v2.layout.v1:${teamId}:${teamVersionId}:${nodeId}`;
}

export function readGraphLayout(teamId, teamVersionId) {
  const layout = {};
  const prefix = `ogs.team-ir-v2.layout.v1:${teamId}:${teamVersionId}:`;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const nodeId = key.slice(prefix.length);
      const value = JSON.parse(localStorage.getItem(key) || "null");
      if (value) layout[nodeId] = value;
    }
  } catch {}
  for (const nodeId of [START_ID, END_ID]) {
    try { const value = JSON.parse(localStorage.getItem(graphLayoutKey(teamId, teamVersionId, nodeId)) || "null"); if (value) layout[nodeId] = value; } catch {}
  }
  return layout;
}

export function writeGraphLayout(teamId, teamVersionId, nodeId, value) {
  try { localStorage.setItem(graphLayoutKey(teamId, teamVersionId, nodeId), JSON.stringify(value)); } catch {}
}

export function removeGraphLayout(teamId, teamVersionId, nodeId) {
  try { localStorage.removeItem(graphLayoutKey(teamId, teamVersionId, nodeId)); } catch {}
}

export { START_ID, END_ID };
