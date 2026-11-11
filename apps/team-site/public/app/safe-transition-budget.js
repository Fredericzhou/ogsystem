const START_ROLE_ID = "__system_start__";
function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function calculateSafeTransitionBudget(authoring) {
  const roles = authoring?.roles && typeof authoring.roles === "object" ? authoring.roles : {};
  const roleIds = Object.keys(roles);
  const flows = Object.values(authoring?.flows || {}).filter((flow) =>
    flow && typeof flow.fromRoleId === "string" && typeof flow.toRoleId === "string"
  );
  const caps = new Map();
  const setCap = (roleId, rounds) => {
    if (!roleIds.includes(roleId)) return;
    const cap = rounds + 1;
    caps.set(roleId, Math.min(caps.get(roleId) ?? Number.POSITIVE_INFINITY, cap));
  };

  for (const [roleId, role] of Object.entries(roles)) {
    const rounds = positiveInteger(role?.loopMax);
    if (rounds) setCap(roleId, rounds);
    const reworkTarget = role?.review?.reworkTargetRoleId;
    const reworkRounds = positiveInteger(role?.review?.reworkMax);
    if (reworkTarget && reworkRounds) setCap(reworkTarget, reworkRounds);
  }
  const scopedRoles = new Set();
  for (const loop of Object.values(authoring?.system?.loops || {})) {
    const rounds = positiveInteger(loop?.maxRounds);
    if (!rounds || !Array.isArray(loop.members)) continue;
    for (const roleId of loop.members) {
      if (scopedRoles.has(roleId)) continue;
      scopedRoles.add(roleId);
      setCap(roleId, rounds);
    }
  }

  const outgoing = new Map(roleIds.map((roleId) => [roleId, new Set()]));
  for (const flow of flows) {
    if (outgoing.has(flow.fromRoleId) && outgoing.has(flow.toRoleId)) {
      outgoing.get(flow.fromRoleId).add(flow.toRoleId);
    }
  }

  const entries = [...new Set(flows
    .filter((flow) => flow.fromRoleId === START_ROLE_ID && outgoing.has(flow.toRoleId))
    .map((flow) => flow.toRoleId))];
  if (!entries.length) {
    const hasIncoming = new Set(flows.filter((flow) => outgoing.has(flow.toRoleId)).map((flow) => flow.toRoleId));
    entries.push(...roleIds.filter((roleId) => !hasIncoming.has(roleId)));
  }
  if (!entries.length) return { budget: 0 };

  const active = new Set();
  const joinRoles = new Set(Object.entries(roles).filter(([, role]) => role?.joinMode).map(([roleId]) => roleId));
  const seenJoins = new Set();
  const visit = (roleId, counts) => {
    const count = (counts.get(roleId) ?? 0) + 1;
    const cap = caps.get(roleId);
    if (cap !== undefined && count > cap) return 0;
    const nextCounts = cap === undefined ? counts : new Map(counts).set(roleId, count);
    const stateKey = `${roleId}\0${[...nextCounts].sort(([left], [right]) => left.localeCompare(right)).map(([id, value]) => `${id}:${value}`).join(",")}`;
    if (active.has(stateKey)) {
      throw new Error(`TEAM_TRANSITION_BUDGET_UNBOUNDED_LOOP: role "${roleId}" belongs to a cycle without a finite configured loop limit.`);
    }
    const joinKey = joinRoles.has(roleId)
      ? `${roleId}\0${[...nextCounts].sort(([left], [right]) => left.localeCompare(right)).map(([id, value]) => `${id}:${value}`).join(",")}`
      : undefined;
    if (joinKey && seenJoins.has(joinKey)) return 0;
    if (joinKey) seenJoins.add(joinKey);
    active.add(stateKey);
    let total = 1;
    for (const targetRoleId of outgoing.get(roleId) || []) {
      total += visit(targetRoleId, nextCounts);
      if (!Number.isSafeInteger(total)) {
        throw new Error("TEAM_TRANSITION_BUDGET_OVERFLOW: computed structural budget exceeds the supported integer range.");
      }
    }
    active.delete(stateKey);
    return total;
  };

  const entryBudgets = entries.map((roleId) => {
    seenJoins.clear();
    return visit(roleId, new Map());
  }).sort((left, right) => right - left);
  const dispatch = authoring?.system?.startDispatch;
  const count = dispatch?.mode === "random_n"
    ? Math.max(1, Math.min(entryBudgets.length, positiveInteger(dispatch.count) ?? entryBudgets.length))
    : entryBudgets.length;
  return { budget: entryBudgets.slice(0, count).reduce((total, value) => total + value, 0) };
}
