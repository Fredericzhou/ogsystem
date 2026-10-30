const START_ID = "__system_start__";
const END_ID = "__system_end__";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

export function teamIrToGraphAuthoring(teamIR, layout = {}) {
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
  const roles = Object.fromEntries(agents.map((agent, index) => {
    const binding = bindingFor(teamIR, agent.bindingRef);
    const join = Object.values(agent.inputPorts || {}).map((portId) => joinsByTarget.get(`${agent.id}:${portId}`)).find(Boolean);
    const loop = loopsByAgent.get(agent.id);
    const review = reviewsByAgent.get(agent.id);
    return [agent.id, {
      roleId: agent.id,
      title: agent.id,
      bindingKind: binding.kind === "a2a" ? "model" : binding.kind === "tool" ? "exec" : "model",
      modelRef: binding.modelRef,
      profileId: binding.toolRef,
      joinMode: join?.mode,
      joinMin: join?.threshold,
      joinSources: join?.handoffIds,
      loopMax: loop?.maxRounds,
      review: review ? { mode: "required", timeoutSeconds: Math.round(Number(review.timeoutMs || 0) / 1000) || undefined } : undefined,
      layout: layoutFor(layout, agent.id, index)
    }];
  }));
  const flows = Object.fromEntries(handoffs.map((handoff) => {
    const fromRoleId = handoff.from?.kind === "run" ? START_ID : String(handoff.from?.agentId || "");
    const toRoleId = handoff.to?.kind === "result" ? END_ID : String(handoff.to?.agentId || "");
    return [handoff.id, {
      flowId: handoff.id,
      fromRoleId,
      toRoleId,
      eventType: handoff.from?.kind === "agent" ? String(handoff.from.outputPort || "") : "START",
      label: handoff.id,
      condition: handoff.when?.condition,
      priority: handoff.when?.priority,
      participatesInJoin: handoff.to?.kind === "agent" && joinsByTarget.has(`${handoff.to.agentId}:${handoff.to.inputPort}`)
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
    if (flow.fromRoleId === START_ID) handoff.from = { kind: "run" };
    else if (flow.fromRoleId && handoff.from?.kind === "agent") handoff.from.agentId = flow.fromRoleId;
    if (flow.toRoleId === END_ID) handoff.to = { kind: "result" };
    else if (flow.toRoleId && handoff.to?.kind === "agent") handoff.to.agentId = flow.toRoleId;
    if (handoff.from?.kind === "agent" && flow.eventType) handoff.from.outputPort = flow.eventType;
    if (flow.condition) handoff.when = { ...(handoff.when || {}), condition: clone(flow.condition) };
    else if (handoff.when?.condition) delete handoff.when.condition;
    if (flow.priority !== undefined) handoff.when = { ...(handoff.when || {}), priority: flow.priority };
  }
  return next;
}

/**
 * Apply one explicit Team IR edit. Graph objects are never merged directly
 * into the IR: each operation names the v2 collection and the fields it owns.
 */
export function applyTeamIrPatch(baseTeamIR, patch) {
  const next = clone(baseTeamIR);
  if (!next || next.schemaVersion !== 2 || !patch || typeof patch !== "object") {
    return { ok: false, error: "TEAM_IR_PATCH_INVALID", teamIR: clone(baseTeamIR) };
  }
  const collectionNames = new Set(["agents", "handoffs", "bindings"]);
  const collection = collectionNames.has(patch.collection) ? patch.collection : null;
  const id = typeof patch.id === "string" ? patch.id.trim() : "";
  if (["add", "update", "remove"].includes(patch.op) && (!collection || !id)) {
    return { ok: false, error: "TEAM_IR_PATCH_TARGET_INVALID", teamIR: clone(baseTeamIR) };
  }
  if (collection) {
    const values = Array.isArray(next[collection]) ? next[collection] : [];
    const index = values.findIndex((item) => item?.id === id);
    if (patch.op === "remove") {
      if (index < 0) return { ok: false, error: "TEAM_IR_PATCH_TARGET_MISSING", teamIR: clone(baseTeamIR) };
      next[collection] = values.filter((_, valueIndex) => valueIndex !== index);
      if (collection === "agents") {
        next.handoffs = (next.handoffs || []).filter((handoff) => handoff?.from?.agentId !== id && handoff?.to?.agentId !== id);
        if (next.orchestration && typeof next.orchestration === "object") {
          for (const key of ["joins", "loops", "reviews"]) {
            if (Array.isArray(next.orchestration[key])) next.orchestration[key] = next.orchestration[key].filter((entry) => entry?.agentId !== id && !(entry?.members || []).includes(id));
          }
        }
      }
      return { ok: true, teamIR: next };
    }
    if (patch.op === "add") {
      if (index >= 0 || !patch.value || typeof patch.value !== "object" || Array.isArray(patch.value)) return { ok: false, error: "TEAM_IR_PATCH_TARGET_EXISTS", teamIR: clone(baseTeamIR) };
      next[collection] = [...values, { ...clone(patch.value), id }];
      return { ok: true, teamIR: next };
    }
    if (patch.op === "update") {
      if (index < 0 || !patch.fields || typeof patch.fields !== "object" || Array.isArray(patch.fields)) return { ok: false, error: "TEAM_IR_PATCH_UPDATE_INVALID", teamIR: clone(baseTeamIR) };
      const current = values[index];
      const updated = { ...current };
      for (const [field, value] of Object.entries(patch.fields)) {
        if (!["id", "packageRef", "bindingRef", "inputPorts", "outputPorts", "from", "to", "when", "map", "label", "description", "kind", "modelRef", "adapterVersion"].includes(field)) {
          return { ok: false, error: `TEAM_IR_PATCH_FIELD_UNSUPPORTED:${field}`, teamIR: clone(baseTeamIR) };
        }
        updated[field] = clone(value);
      }
      next[collection] = values.map((item, valueIndex) => valueIndex === index ? updated : item);
      return { ok: true, teamIR: next };
    }
  }
  if (patch.op === "set-orchestration") {
    if (!patch.value || typeof patch.value !== "object" || Array.isArray(patch.value)) return { ok: false, error: "TEAM_IR_PATCH_ORCHESTRATION_INVALID", teamIR: clone(baseTeamIR) };
    next.orchestration = { ...(next.orchestration || {}), ...clone(patch.value) };
    return { ok: true, teamIR: next };
  }
  if (patch.op === "set-run-contract") {
    if (!patch.value || typeof patch.value !== "object" || Array.isArray(patch.value)) return { ok: false, error: "TEAM_IR_PATCH_RUN_CONTRACT_INVALID", teamIR: clone(baseTeamIR) };
    next.runInput = { ...(next.runInput || {}), ...clone(patch.value) };
    return { ok: true, teamIR: next };
  }
  if (patch.op === "set-result-contract") {
    if (!patch.value || typeof patch.value !== "object" || Array.isArray(patch.value)) return { ok: false, error: "TEAM_IR_PATCH_RESULT_CONTRACT_INVALID", teamIR: clone(baseTeamIR) };
    next.runResult = { ...(next.runResult || {}), ...clone(patch.value) };
    return { ok: true, teamIR: next };
  }
  if (patch.op === "replace-advanced") {
    if (!patch.value || typeof patch.value !== "object" || Array.isArray(patch.value)) return { ok: false, error: "TEAM_IR_PATCH_ADVANCED_INVALID", teamIR: clone(baseTeamIR) };
    for (const key of ["agentPortContracts", "handoffContracts", "orchestration", "runInput", "runResult"]) {
      if (Object.hasOwn(patch.value, key)) next[key] = clone(patch.value[key]);
    }
    return { ok: true, teamIR: next };
  }
  return { ok: false, error: "TEAM_IR_PATCH_UNSUPPORTED", teamIR: clone(baseTeamIR) };
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
