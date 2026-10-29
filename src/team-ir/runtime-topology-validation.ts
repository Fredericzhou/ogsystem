import type { TeamIrDiagnostic, TeamIrDocument } from "./types.js";

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function endpoint(value: unknown): Row {
  return isRecord(value) ? value : {};
}

function add(diagnostics: TeamIrDiagnostic[], code: string, pointer: string, message: string): void {
  diagnostics.push({ code, pointer, message, severity: "error" });
}

function conditionEqualsRef(handoff: Row | undefined, ref: string, value: string): boolean {
  const when = endpoint(handoff?.when);
  const condition = endpoint(when.condition);
  const args = Array.isArray(condition.args) ? condition.args : [];
  return condition.op === "equals" && args.length === 2
    && endpoint(args[0]).$ref === ref && endpoint(args[1]).$literal === value;
}

function hasReviewFeedbackMapping(handoff: Row | undefined): boolean {
  const map = endpoint(endpoint(handoff?.map).data);
  return Object.values(map).some((value) => isRecord(value)
    && typeof value.$ref === "string" && value.$ref.startsWith("$.review.feedback."));
}

function isMakerChecker(team: TeamIrDocument, handoffs: Map<string, Row>): boolean {
  const orchestration = endpoint(team.orchestration);
  const loops = rows(orchestration.loops);
  const reviews = rows(orchestration.reviews);
  const joins = rows(orchestration.joins);
  const routes = rows(orchestration.routes);
  if (loops.length !== 1 || reviews.length !== 1 || joins.length !== 0) return false;
  const loop = loops[0];
  const members = strings(loop.members);
  const entryIds = strings(loop.entryHandoffIds);
  const continueIds = strings(loop.continueHandoffIds);
  const exitIds = strings(loop.exitHandoffIds);
  const agentId = String(loop.boundaryAgentId);
  const review = reviews[0];
  const at = endpoint(review.at);
  if (members.length !== 1 || members[0] !== agentId || at.kind !== "agentOutput" || at.agentId !== agentId) return false;
  if (entryIds.length !== 1 || continueIds.length !== 1 || exitIds.length !== 1) return false;
  const entry = handoffs.get(entryIds[0]);
  const revise = handoffs.get(continueIds[0]);
  const exit = handoffs.get(exitIds[0]);
  if (endpoint(entry?.from).kind !== "run" || endpoint(entry?.to).kind !== "agent" || endpoint(entry?.to).agentId !== agentId) return false;
  if (endpoint(revise?.from).kind !== "agent" || endpoint(revise?.from).agentId !== agentId) return false;
  if (endpoint(revise?.from).outputPort !== at.outputPort || endpoint(revise?.to).kind !== "agent"
    || endpoint(revise?.to).agentId !== agentId || endpoint(revise?.to).inputPort === endpoint(entry?.to).inputPort) return false;
  if (endpoint(exit?.from).kind !== "agent" || endpoint(exit?.from).agentId !== agentId
    || endpoint(exit?.from).outputPort !== at.outputPort || endpoint(exit?.to).kind !== "result") return false;
  if (!conditionEqualsRef(revise, "$.review.decision", "reject") || !conditionEqualsRef(exit, "$.review.decision", "approve")
    || !hasReviewFeedbackMapping(revise)) return false;
  const sourceRoutes = routes.filter((route) => endpoint(route.from).kind === "agent"
    && endpoint(route.from).agentId === agentId && endpoint(route.from).outputPort === at.outputPort);
  const runRoutes = routes.filter((route) => endpoint(route.from).kind === "run");
  if (sourceRoutes.length !== 1 || sourceRoutes[0].mode !== "exclusive_priority"
    || strings(sourceRoutes[0].handoffIds).sort().join("\0") !== [continueIds[0], exitIds[0]].sort().join("\0")) return false;
  if (runRoutes.length !== 1 || runRoutes[0].mode !== "exclusive_priority"
    || strings(runRoutes[0].handoffIds).join("\0") !== entryIds.join("\0")) return false;
  return [...handoffs.entries()].every(([id, handoff]) => {
    const from = endpoint(handoff.from);
    const to = endpoint(handoff.to);
    return (from.agentId !== agentId && to.agentId !== agentId) || [entryIds[0], continueIds[0], exitIds[0]].includes(id);
  });
}

function isReviewBeforeFanout(team: TeamIrDocument, handoffs: Map<string, Row>): boolean {
  const orchestration = endpoint(team.orchestration);
  const loops = rows(orchestration.loops);
  const joins = rows(orchestration.joins);
  const reviews = rows(orchestration.reviews);
  const routes = rows(orchestration.routes);
  const fanouts = routes.filter((route) => route.mode === "parallel_fanout");
  if (loops.length !== 0 || joins.length !== 0 || routes.length < 1 || fanouts.length !== 1) return false;
  const fanout = fanouts[0];
  const from = endpoint(fanout.from);
  const fanoutIds = strings(fanout.handoffIds);
  if (from.kind === "run" && routes.length === 1 && reviews.length >= 2 && fanoutIds.length === reviews.length) {
    const agents = fanoutIds.map((id) => endpoint(handoffs.get(id)?.to).kind === "agent" ? String(endpoint(handoffs.get(id)?.to).agentId) : undefined);
    const reviewed = reviews.map((review) => endpoint(review.at).kind === "agentOutput" ? String(endpoint(review.at).agentId) : undefined);
    return agents.every((id) => id !== undefined) && new Set(agents).size === agents.length
      && reviewed.every((id) => id !== undefined && agents.includes(id)) && new Set(reviewed).size === reviewed.length;
  }
  if (reviews.length !== 1 || routes.length !== 2) return false;
  const review = reviews[0];
  const at = endpoint(review.at);
  if (at.kind !== "agentOutput") return false;
  const agentId = String(at.agentId);
  const outputPort = String(at.outputPort);
  if (from.kind !== "agent" || from.agentId !== agentId || from.outputPort !== outputPort) return false;
  if (fanoutIds.length < 2 || new Set(fanoutIds).size !== fanoutIds.length) return false;
  const targets = fanoutIds.map((id) => {
    const handoff = handoffs.get(id);
    return endpoint(handoff?.from).kind === "agent" && endpoint(handoff?.from).agentId === agentId
      && endpoint(handoff?.from).outputPort === outputPort && endpoint(handoff?.to).kind === "agent"
      ? String(endpoint(handoff?.to).agentId) : undefined;
  });
  if (targets.some((id) => id === undefined) || new Set(targets).size !== targets.length) return false;
  const runRoute = routes.find((route) => endpoint(route.from).kind === "run");
  return Boolean(runRoute && runRoute.mode === "exclusive_priority" && strings(runRoute.handoffIds).length > 0
    && strings(runRoute.handoffIds).every((id) => endpoint(handoffs.get(id)?.to).kind === "agent"
      && endpoint(handoffs.get(id)?.to).agentId === agentId));
}

function isReviewOnRunAllOfJoin(team: TeamIrDocument, handoffs: Map<string, Row>): boolean {
  const orchestration = endpoint(team.orchestration);
  const loops = rows(orchestration.loops);
  const joins = rows(orchestration.joins);
  const reviews = rows(orchestration.reviews);
  const routes = rows(orchestration.routes);
  if (loops.length !== 0 || joins.length !== 1 || reviews.length !== 1 || routes.length !== 1) return false;
  const join = joins[0];
  const scope = endpoint(join.scope);
  if (join.mode !== "all_of" || scope.kind !== "run") return false;
  const targetAgentId = String(join.agentId);
  const targetInputPort = String(join.inputPort);
  const reviewAt = endpoint(reviews[0].at);
  if (reviewAt.kind !== "agentOutput" || reviewAt.agentId !== targetAgentId) return false;
  const targetAgent = rows(team.agents).find((agent) => agent.id === targetAgentId);
  if (!Object.hasOwn(endpoint(targetAgent?.outputPorts), String(reviewAt.outputPort))) return false;
  const route = routes[0];
  if (endpoint(route.from).kind !== "run" || route.mode !== "parallel_fanout") return false;
  const routeIds = strings(route.handoffIds);
  if (routeIds.length < 2) return false;
  const producers = new Set<string>();
  for (const id of routeIds) {
    const to = endpoint(handoffs.get(id)?.to);
    if (to.kind !== "agent") return false;
    producers.add(String(to.agentId));
  }
  const joinIds = strings(join.handoffIds);
  if (routeIds.length !== producers.size || joinIds.length < 2 || joinIds.length !== producers.size) return false;
  const joined = new Set<string>();
  for (const id of joinIds) {
    const handoff = handoffs.get(id);
    const from = endpoint(handoff?.from);
    const to = endpoint(handoff?.to);
    if (from.kind !== "agent" || to.kind !== "agent" || to.agentId !== targetAgentId || to.inputPort !== targetInputPort
      || !producers.has(String(from.agentId))) return false;
    joined.add(String(from.agentId));
  }
  return joined.size === producers.size;
}

function loopTopologySupported(team: TeamIrDocument, loop: Row, handoffs: Map<string, Row>): boolean {
  const orchestration = endpoint(team.orchestration);
  const members = strings(loop.members);
  const memberSet = new Set(members);
  const entries = strings(loop.entryHandoffIds);
  const continues = strings(loop.continueHandoffIds);
  const exits = strings(loop.exitHandoffIds);
  const joins = rows(orchestration.joins);
  const loopJoins = joins.filter((join) => endpoint(join.scope).kind === "loop" && endpoint(join.scope).loopId === loop.id);
  const loopJoin = loopJoins.length === 1 ? loopJoins[0] : undefined;
  const joinIds = strings(loopJoin?.handoffIds);
  const joinTarget = loopJoin ? `${String(loopJoin.agentId)}\0${String(loopJoin.inputPort)}` : undefined;
  const routes = rows(orchestration.routes);
  const boundaryFanouts = routes.filter((route) => endpoint(route.from).kind === "agent"
    && endpoint(route.from).agentId === loop.boundaryAgentId && route.mode === "parallel_fanout");
  const fanoutEdges = boundaryFanouts.length === 1 ? strings(boundaryFanouts[0].handoffIds).map((id) => handoffs.get(id)) : [];
  const fanoutKeys = fanoutEdges.map((handoff) => {
    const to = endpoint(handoff?.to);
    return to.kind === "agent" ? `${String(to.agentId)}\0${String(to.inputPort)}` : "";
  });
  const fanoutAgents = fanoutEdges.map((handoff) => String(endpoint(handoff?.to).agentId));
  const joinedAgents = joinIds.map((id) => String(endpoint(handoffs.get(id)?.from).agentId));
  const entryTargets = entries.map((id) => endpoint(handoffs.get(id)?.to));
  const entryRoute = routes.find((route) => endpoint(route.from).kind === "run" && route.mode === "parallel_fanout"
    && strings(route.handoffIds).sort().join("\0") === [...entries].sort().join("\0"));
  const supportedEntries = entries.length === 1 || Boolean(entryRoute && entries.length > 1
    && entryTargets.every((to) => to.kind === "agent" && to.agentId === loop.boundaryAgentId)
    && new Set(entryTargets.map((to) => `${String(to.agentId)}\0${String(to.inputPort)}`)).size === 1);
  const supportedJoin = Boolean(loopJoin && joins.length === 1 && ["all_of", "quorum_of"].includes(String(loopJoin.mode))
    && endpoint(loopJoin.scope).loopId === loop.id && memberSet.has(String(loopJoin.agentId)) && joinIds.length > 0
    && fanoutEdges.length > 1 && fanoutEdges.every((edge) => endpoint(edge?.to).kind === "agent" && memberSet.has(String(endpoint(edge?.to).agentId)))
    && new Set(fanoutKeys).size === fanoutKeys.length && new Set(fanoutAgents).size === fanoutAgents.length
    && [...new Set(joinedAgents)].sort().join("\0") === [...new Set(fanoutAgents)].sort().join("\0")
    && joinIds.every((id) => {
      const source = handoffs.get(id);
      const from = endpoint(source?.from);
      const to = endpoint(source?.to);
      return from.kind === "agent" && memberSet.has(String(from.agentId)) && to.kind === "agent"
        && `${String(to.agentId)}\0${String(to.inputPort)}` === joinTarget;
    }));
  if (members.length < 1 || continues.length !== 1 || !supportedEntries || exits.length < 1) return false;
  const boundaryIds = [...entries, ...continues, ...exits];
  if (boundaryIds.some((id) => !handoffs.has(id) || endpoint(handoffs.get(id)?.to).kind === "agent"
    && rows(orchestration.joins).some((join) => `${String(join.agentId)}\0${String(join.inputPort)}` === targetKey(handoffs.get(id)!)))) return false;
  if (joins.length > 0 && !supportedJoin) return false;
  for (const handoff of handoffs.values()) {
    const to = endpoint(handoff.to);
    if (to.kind === "agent" && memberSet.has(String(to.agentId))
      && joins.some((join) => `${String(join.agentId)}\0${String(join.inputPort)}` === targetKey(handoff))
      && (!supportedJoin || `${String(to.agentId)}\0${String(to.inputPort)}` !== joinTarget)) return false;
  }
  for (const route of routes) {
    const from = endpoint(route.from);
    if (from.kind === "agent" && memberSet.has(String(from.agentId)) && route.mode === "parallel_fanout"
      && (from.agentId !== loop.boundaryAgentId || strings(route.handoffIds).some((id) => {
        const to = endpoint(handoffs.get(id)?.to);
        return to.kind !== "agent" || !memberSet.has(String(to.agentId));
      }))) return false;
  }
  return true;
}

function targetKey(handoff: Row): string {
  const to = endpoint(handoff.to);
  return `${String(to.agentId)}\0${String(to.inputPort)}`;
}

function sequentialLoopsSupported(loops: Row[], handoffs: Map<string, Row>): boolean {
  if (loops.length !== 2) return false;
  const [first, second] = loops;
  const firstMembers = new Set(strings(first.members));
  const secondMembers = new Set(strings(second.members));
  // A member belongs to one Loop scope only. Reusing it would make
  // checkpoint lineage ambiguous even when the boundary handoff is sequential.
  if ([...firstMembers].some((member) => secondMembers.has(member))) return false;
  const entryIds = strings(second.entryHandoffIds);
  const exitIds = strings(first.exitHandoffIds);
  if (entryIds.length !== 1 || exitIds.length !== 1 || !firstMembers.size || !secondMembers.size || entryIds[0] !== exitIds[0]) return false;
  const edge = handoffs.get(entryIds[0]);
  const from = endpoint(edge?.from);
  const to = endpoint(edge?.to);
  return from.kind === "agent" && firstMembers.has(String(from.agentId)) && from.agentId === first.boundaryAgentId
    && to.kind === "agent" && secondMembers.has(String(to.agentId));
}

/** Static counterpart to Runtime topology guards. Conditions remain runtime-evaluated. */
export function validateTeamIrRuntimeTopologies(document: TeamIrDocument): TeamIrDiagnostic[] {
  const diagnostics: TeamIrDiagnostic[] = [];
  const orchestration = endpoint(document.orchestration);
  const loops = rows(orchestration.loops);
  const joins = rows(orchestration.joins);
  const reviews = rows(orchestration.reviews);
  const routes = rows(orchestration.routes);
  const fanoutRoutes = routes.filter((route) => route.mode === "parallel_fanout");
  const handoffs = new Map(rows(document.handoffs).map((handoff) => [String(handoff.id), handoff]));

  if (loops.length > 1) {
    const sequential = sequentialLoopsSupported(loops, handoffs) && joins.length === 0 && reviews.length === 0;
    if (!sequential) {
      add(diagnostics, "IR_LOOP_TOPOLOGY_UNSUPPORTED", "/orchestration/loops", "Only two precisely sequential, disjoint Loop Scopes are supported; they cannot be combined with Join or Review.");
    } else {
      // The sequence contract does not relax each scope's own boundary rules.
      for (const [index, loop] of loops.entries()) {
        if (!loopTopologySupported(document, loop, handoffs)) {
          add(diagnostics, "IR_LOOP_TOPOLOGY_UNSUPPORTED", `/orchestration/loops/${index}`, "Each sequential Loop must independently satisfy the bounded single-boundary topology contract.");
        }
      }
    }
  } else {
    for (const [index, loop] of loops.entries()) {
      if (!loopTopologySupported(document, loop, handoffs)) {
        add(diagnostics, "IR_LOOP_TOPOLOGY_UNSUPPORTED", `/orchestration/loops/${index}`, "This Loop topology is not supported by the current Runtime. Use one boundary, one continue Handoff, and a supported entry/exit shape; unsupported Join/fan-out combinations must be removed.");
      }
    }
  }

  const quorumJoins = joins.filter((join) => join.mode === "quorum_of");
  const supportedLoopQuorum = loops.length === 1 && joins.length === 1 && quorumJoins.length === 1
    && endpoint(quorumJoins[0].scope).kind === "loop" && endpoint(quorumJoins[0].scope).loopId === loops[0].id;
  if (loops.length > 0 && quorumJoins.length > 0 && !supportedLoopQuorum) {
    for (const [index, join] of joins.entries()) if (join.mode === "quorum_of") {
      add(diagnostics, "IR_JOIN_TOPOLOGY_UNSUPPORTED", `/orchestration/joins/${index}`, "A quorum Join with Loop is supported only as the single Join scoped to that one Loop.");
    }
  }

  if (reviews.length > 0) {
    const reviewTopologySupported = (loops.length === 0 && joins.length === 0 && fanoutRoutes.length === 0)
      || isMakerChecker(document, handoffs)
      || isReviewBeforeFanout(document, handoffs)
      || isReviewOnRunAllOfJoin(document, handoffs);
    if (!reviewTopologySupported) {
      for (const [index] of reviews.entries()) {
        add(diagnostics, "IR_REVIEW_TOPOLOGY_UNSUPPORTED", `/orchestration/reviews/${index}`, "This Review combination is not supported by the current Runtime. Supported shapes are Maker-Checker Loop, independent Reviews on Run-entry fan-out, Review before Agent fan-out, or Review on a Run-scope all_of Join target.");
      }
    }
  }

  if (fanoutRoutes.length > 0 && loops.length === 0 && reviews.length === 0) {
    const fanout = fanoutRoutes.length === 1 ? fanoutRoutes[0] : undefined;
    const ids = strings(fanout?.handoffIds);
    const supported = ["run", "agent"].includes(String(endpoint(fanout?.from).kind)) && ids.length > 1
      && ids.every((id) => endpoint(handoffs.get(id)?.to).kind === "agent");
    if (!supported) add(diagnostics, "IR_PARALLEL_TOPOLOGY_UNSUPPORTED", "/orchestration/routes", "Parallel Runtime currently supports one fan-out route with at least two Agent targets and no Loop or Review.");
  }
  return diagnostics;
}
