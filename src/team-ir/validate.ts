import type { TeamIrDiagnostic, TeamIrDocument } from "./types.js";
import { validateTeamIrRuntimeTopologies } from "./runtime-topology-validation.js";

type RecordValue = Record<string, unknown>;
type Endpoint = { kind?: unknown; agentId?: unknown; outputPort?: unknown };
type Target = { kind?: unknown; agentId?: unknown; inputPort?: unknown };

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pointerPart(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function diagnostic(code: string, pointer: string, message: string, suggestedFix?: string, relatedAgentIds?: string[]): TeamIrDiagnostic {
  return {
    code,
    pointer: pointer || "/",
    message,
    severity: "error",
    ...(suggestedFix ? { suggestedFix } : {}),
    ...(relatedAgentIds?.length ? { relatedAgentIds } : {})
  };
}

function agentEndpointKey(endpoint: Endpoint): string | undefined {
  if (endpoint.kind === "run") return JSON.stringify(["run"]);
  if (endpoint.kind === "agent" && typeof endpoint.agentId === "string" && typeof endpoint.outputPort === "string") {
    return JSON.stringify(["agent", endpoint.agentId, endpoint.outputPort]);
  }
  return undefined;
}

function routeEndpointKey(endpoint: unknown): string | undefined {
  return isRecord(endpoint) ? agentEndpointKey(endpoint as Endpoint) : undefined;
}

function endpointKeyForHandoff(handoff: RecordValue): string | undefined {
  return isRecord(handoff.from) ? agentEndpointKey(handoff.from as Endpoint) : undefined;
}

function targetKey(target: Target): string | undefined {
  if (target.kind !== "agent" || typeof target.agentId !== "string" || typeof target.inputPort !== "string") return undefined;
  return `${target.agentId}\u0000${target.inputPort}`;
}

function handoffTargetKey(handoff: RecordValue): string | undefined {
  return isRecord(handoff.to) ? targetKey(handoff.to as Target) : undefined;
}

/** Validate Team IR references and relationships that JSON Schema cannot express. */
export function validateTeamIrReferences(document: TeamIrDocument): TeamIrDiagnostic[] {
  const diagnostics: TeamIrDiagnostic[] = [];
  const agents = items(document.agents).filter(isRecord);
  const handoffs = items(document.handoffs).filter(isRecord);
  const bindings = items(document.bindings).filter(isRecord);
  const orchestration = isRecord(document.orchestration) ? document.orchestration : {};
  const routes = items(orchestration.routes).filter(isRecord);
  const joins = items(orchestration.joins).filter(isRecord);
  const loops = items(orchestration.loops).filter(isRecord);
  const reviews = items(orchestration.reviews).filter(isRecord);

  const agentsById = new Map<string, RecordValue>();
  const bindingsById = new Set<string>();
  const handoffsById = new Map<string, RecordValue>();
  const semanticIds = new Map<string, string>();
  const addSemanticId = (id: unknown, kind: string, pointer: string): void => {
    if (typeof id !== "string") return;
    const previous = semanticIds.get(id);
    if (previous) diagnostics.push(diagnostic("IR_DUPLICATE_ID", pointer, `ID '${id}' is already used by ${previous}.`, "Assign a unique ID."));
    else semanticIds.set(id, kind);
  };

  agents.forEach((agent, index) => {
    const id = agent.id;
    if (typeof id !== "string") return;
    addSemanticId(id, "an Agent", `/agents/${index}/id`);
    if (!agentsById.has(id)) agentsById.set(id, agent);
  });
  bindings.forEach((binding, index) => {
    const id = binding.id;
    if (typeof id !== "string") return;
    addSemanticId(id, "a Binding", `/bindings/${index}/id`);
    bindingsById.add(id);
    const retry = isRecord(binding.retry) ? binding.retry : {};
    const backoff = isRecord(retry.backoff) ? retry.backoff : {};
    if (backoff.mode === "exponential" && typeof backoff.initialDelayMs === "number" && typeof backoff.maxDelayMs === "number" && backoff.maxDelayMs < backoff.initialDelayMs) {
      diagnostics.push(diagnostic("IR_BINDING_RETRY_INVALID", `/bindings/${index}/retry/backoff/maxDelayMs`, "Exponential maxDelayMs must be at least initialDelayMs."));
    }
  });
  handoffs.forEach((handoff, index) => {
    const id = handoff.id;
    if (typeof id !== "string") return;
    addSemanticId(id, "a Handoff", `/handoffs/${index}/id`);
    if (!handoffsById.has(id)) handoffsById.set(id, handoff);
  });

  joins.forEach((join, index) => addSemanticId(join.id, "a Join", `/orchestration/joins/${index}/id`));
  loops.forEach((loop, index) => addSemanticId(loop.id, "a Loop", `/orchestration/loops/${index}/id`));
  reviews.forEach((review, index) => addSemanticId(review.id, "a Review", `/orchestration/reviews/${index}/id`));

  for (const [index, agent] of agents.entries()) {
    if (typeof agent.id !== "string") continue;
    if (typeof agent.bindingRef === "string" && !bindingsById.has(agent.bindingRef)) {
      diagnostics.push(diagnostic("IR_UNKNOWN_BINDING", `/agents/${index}/bindingRef`, `Unknown Binding '${agent.bindingRef}'.`, "Declare the referenced Binding."));
    }
  }

  const sourceHandoffs = new Map<string, Array<{ handoff: RecordValue; index: number }>>();
  const incomingByPort = new Map<string, Array<{ handoff: RecordValue; index: number }>>();
  for (const [index, handoff] of handoffs.entries()) {
    const source = isRecord(handoff.from) ? handoff.from as Endpoint : {};
    const target = isRecord(handoff.to) ? handoff.to as Target : {};
    if (source.kind === "agent") {
      const agent = typeof source.agentId === "string" ? agentsById.get(source.agentId) : undefined;
      if (!agent) {
        diagnostics.push(diagnostic("IR_UNKNOWN_AGENT", `/handoffs/${index}/from/agentId`, `Unknown source Agent '${String(source.agentId)}'.`, "Reference a declared Agent."));
      }
      if (agent && typeof source.outputPort === "string") {
        const outputPorts = isRecord(agent.outputPorts) ? agent.outputPorts : {};
        if (!Object.prototype.hasOwnProperty.call(outputPorts, source.outputPort)) {
          diagnostics.push(diagnostic("IR_UNKNOWN_PORT", `/handoffs/${index}/from/outputPort`, `Unknown output port '${source.outputPort}' on Agent '${source.agentId}'.`, "Use a declared output port.", [source.agentId as string]));
        }
      }
    }
    if (target.kind === "agent") {
      const agent = typeof target.agentId === "string" ? agentsById.get(target.agentId) : undefined;
      if (!agent) {
        diagnostics.push(diagnostic("IR_UNKNOWN_AGENT", `/handoffs/${index}/to/agentId`, `Unknown target Agent '${String(target.agentId)}'.`, "Reference a declared Agent."));
      } else if (typeof target.inputPort === "string") {
        const inputPorts = isRecord(agent.inputPorts) ? agent.inputPorts : {};
        if (!Object.prototype.hasOwnProperty.call(inputPorts, target.inputPort)) {
          diagnostics.push(diagnostic("IR_UNKNOWN_PORT", `/handoffs/${index}/to/inputPort`, `Unknown input port '${target.inputPort}' on Agent '${target.agentId}'.`, "Use a declared input port.", [target.agentId as string]));
        }
      }
      const key = targetKey(target);
      if (key) incomingByPort.set(key, [...(incomingByPort.get(key) ?? []), { handoff, index }]);
    }

    const key = endpointKeyForHandoff(handoff);
    if (key) sourceHandoffs.set(key, [...(sourceHandoffs.get(key) ?? []), { handoff, index }]);
  }

  const routeBySource = new Map<string, { route: RecordValue; index: number }>();
  for (const [index, route] of routes.entries()) {
    const key = routeEndpointKey(route.from);
    if (!key) {
      diagnostics.push(diagnostic("IR_ROUTE_SOURCE_INVALID", `/orchestration/routes/${index}/from`, "Route source must be Run or a declared Agent output endpoint."));
      continue;
    }
    if (isRecord(route.from) && route.from.kind === "agent") {
      const agentId = typeof route.from.agentId === "string" ? route.from.agentId : undefined;
      const outputPort = typeof route.from.outputPort === "string" ? route.from.outputPort : undefined;
      const agent = agentId ? agentsById.get(agentId) : undefined;
      if (!agent) diagnostics.push(diagnostic("IR_UNKNOWN_AGENT", `/orchestration/routes/${index}/from/agentId`, `Unknown route Agent '${agentId}'.`));
      else if (outputPort && (!isRecord(agent.outputPorts) || !Object.prototype.hasOwnProperty.call(agent.outputPorts, outputPort))) {
        diagnostics.push(diagnostic("IR_UNKNOWN_PORT", `/orchestration/routes/${index}/from/outputPort`, `Unknown route output port '${outputPort}' on Agent '${agentId}'.`));
      }
    }
    const previous = routeBySource.get(key);
    if (previous) diagnostics.push(diagnostic("IR_DUPLICATE_ROUTE", `/orchestration/routes/${index}/from`, "Only one route may be declared for a source endpoint."));
    else routeBySource.set(key, { route, index });

    const ids = items(route.handoffIds).filter((id): id is string => typeof id === "string");
    const seen = new Set<string>();
    for (const [candidateIndex, id] of ids.entries()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const handoff = handoffsById.get(id);
      if (!handoff) diagnostics.push(diagnostic("IR_UNKNOWN_HANDOFF", `/orchestration/routes/${index}/handoffIds/${candidateIndex}`, `Unknown Handoff '${id}'.`));
      else if (endpointKeyForHandoff(handoff) !== key) diagnostics.push(diagnostic("IR_ROUTE_SOURCE_MISMATCH", `/orchestration/routes/${index}/handoffIds/${candidateIndex}`, `Handoff '${id}' does not originate at this route source.`));
    }

    const candidates = ids.map((id) => handoffsById.get(id)).filter((handoff): handoff is RecordValue => Boolean(handoff));
    if (route.mode === "exclusive_priority") {
      const priorities = new Map<number, number>();
      let fallbackPriority: number | undefined;
      for (const [candidateIndex, handoff] of candidates.entries()) {
        const when = isRecord(handoff.when) ? handoff.when : undefined;
        const priority = when?.priority;
        const candidatePointer = `/orchestration/routes/${index}/handoffIds/${candidateIndex}`;
        if (!Number.isInteger(priority) || (priority as number) < 0) {
          diagnostics.push(diagnostic("IR_ROUTE_PRIORITY_REQUIRED", `${candidatePointer}`, "Every exclusive_priority candidate must have an explicit non-negative priority."));
        } else {
          const duplicateAt = priorities.get(priority as number);
          if (duplicateAt !== undefined) diagnostics.push(diagnostic("IR_ROUTE_AMBIGUOUS", `/handoffs/${handoffs.indexOf(handoff)}/when/priority`, `Priority ${priority} is duplicated in this route.`));
          else priorities.set(priority as number, candidateIndex);
          if (!when || when.condition === undefined) {
            if (fallbackPriority !== undefined) diagnostics.push(diagnostic("IR_ROUTE_FALLBACK_DUPLICATE", candidatePointer, "An exclusive_priority route may have at most one unconditional fallback."));
            fallbackPriority = priority as number;
          } else if (!isRecord(when.condition)) {
            diagnostics.push(diagnostic("IR_ROUTE_CONDITION_INVALID", `/handoffs/${handoffs.indexOf(handoff)}/when/condition`, "Route condition must be a condition AST object."));
          }
        }
      }
      if (fallbackPriority !== undefined && [...priorities.keys()].some((priority) => priority > fallbackPriority!)) {
        diagnostics.push(diagnostic("IR_ROUTE_FALLBACK_PRIORITY", `/orchestration/routes/${index}/handoffIds`, "The unconditional fallback must have a numerically greater priority than every conditional candidate."));
      }
    } else if (route.mode === "parallel_fanout") {
      for (const handoff of candidates) {
        const when = isRecord(handoff.when) ? handoff.when : undefined;
        if (when && Object.prototype.hasOwnProperty.call(when, "priority")) {
          diagnostics.push(diagnostic("IR_ROUTE_PRIORITY_FORBIDDEN", `/handoffs/${handoffs.indexOf(handoff)}/when/priority`, "parallel_fanout candidates cannot declare priority."));
        }
        if (when && when.condition === undefined) diagnostics.push(diagnostic("IR_ROUTE_CONDITION_INVALID", `/handoffs/${handoffs.indexOf(handoff)}/when`, "A conditional Handoff must include a condition."));
      }
    }
  }

  for (const [source, sourceEdges] of sourceHandoffs) {
    const routeInfo = routeBySource.get(source);
    const conditional = sourceEdges.some(({ handoff }) => isRecord(handoff.when) && handoff.when.condition !== undefined);
    if (sourceEdges.length > 1 || conditional) {
      if (!routeInfo) {
        diagnostics.push(diagnostic("IR_ROUTE_REQUIRED", `/handoffs/${sourceEdges[0]?.index ?? 0}/from`, "Multiple or conditional Handoffs from one endpoint require an explicit route."));
      } else {
        const declared = new Set(items(routeInfo.route.handoffIds).filter((id): id is string => typeof id === "string"));
        const actual = new Set(sourceEdges.map(({ handoff }) => handoff.id).filter((id): id is string => typeof id === "string"));
        for (const id of actual) if (!declared.has(id)) diagnostics.push(diagnostic("IR_ROUTE_HANDOFF_OMITTED", `/orchestration/routes/${routeInfo.index}/handoffIds`, `Route omits outgoing Handoff '${id}'.`));
        for (const id of declared) if (!actual.has(id)) diagnostics.push(diagnostic("IR_ROUTE_HANDOFF_EXTRA", `/orchestration/routes/${routeInfo.index}/handoffIds`, `Route lists non-outgoing Handoff '${id}'.`));
      }
    } else if (routeInfo) {
      const declared = new Set(items(routeInfo.route.handoffIds).filter((id): id is string => typeof id === "string"));
      const actual = new Set(sourceEdges.map(({ handoff }) => handoff.id).filter((id): id is string => typeof id === "string"));
      if ([...declared].some((id) => !actual.has(id)) || [...actual].some((id) => !declared.has(id))) {
        diagnostics.push(diagnostic("IR_ROUTE_HANDOFF_MISMATCH", `/orchestration/routes/${routeInfo.index}/handoffIds`, "A declared route must list exactly the Handoffs from its source endpoint."));
      }
    }
  }

  const resultHandoffs = handoffs.filter((handoff) => isRecord(handoff.to) && handoff.to.kind === "result");
  if (document.executionPolicy.resultMode === "required" && resultHandoffs.length === 0) {
    diagnostics.push(diagnostic("IR_RESULT_REQUIRED_MISSING", "/handoffs", "resultMode is required but no Handoff targets the Run result."));
  }
  if (resultHandoffs.length > 1) {
    const firstSource = endpointKeyForHandoff(resultHandoffs[0]!);
    const sameSource = firstSource !== undefined && resultHandoffs.every((handoff) => endpointKeyForHandoff(handoff) === firstSource);
    const route = sameSource ? routes.find((candidate) => routeEndpointKey(candidate.from) === firstSource) : undefined;
    const routeIds = route && Array.isArray(route.handoffIds) ? route.handoffIds : [];
    const resultIds = resultHandoffs.map((handoff) => handoff.id);
    const routedResultIds = routeIds.filter((id) => typeof id === "string" && resultHandoffs.some((handoff) => handoff.id === id));
    const coveredByExclusiveRoute = route?.mode === "exclusive_priority"
      && resultIds.every((id) => routeIds.includes(id))
      && routedResultIds.length === resultIds.length;
    if (!coveredByExclusiveRoute) {
      diagnostics.push(diagnostic("IR_RESULT_CONFLICT", "/handoffs", "Multiple result Handoffs are not proven mutually exclusive."));
    }
  }

  for (const [index, join] of joins.entries()) {
    const agentId = join.agentId;
    const inputPort = join.inputPort;
    const target = typeof agentId === "string" && typeof inputPort === "string" ? `${agentId}\u0000${inputPort}` : undefined;
    if (!target || !agentsById.has(agentId as string)) {
      diagnostics.push(diagnostic("IR_UNKNOWN_AGENT", `/orchestration/joins/${index}/agentId`, `Unknown Join target Agent '${String(agentId)}'.`));
      continue;
    }
    const agent = agentsById.get(agentId as string)!;
    if (!isRecord(agent.inputPorts) || !Object.prototype.hasOwnProperty.call(agent.inputPorts, inputPort as string)) {
      diagnostics.push(diagnostic("IR_UNKNOWN_PORT", `/orchestration/joins/${index}/inputPort`, `Unknown Join input port '${String(inputPort)}' on Agent '${agentId}'.`, undefined, [agentId as string]));
    }
    const ids = items(join.handoffIds).filter((id): id is string => typeof id === "string");
    const scope = isRecord(join.scope) ? join.scope : {};
    if (scope.kind === "loop") {
      const loopIndex = loops.findIndex((loop) => loop.id === scope.loopId);
      if (loopIndex < 0) {
        diagnostics.push(diagnostic("IR_UNKNOWN_LOOP", `/orchestration/joins/${index}/scope/loopId`, `Unknown Join Loop '${String(scope.loopId)}'.`));
      } else {
        const loopMembers = items(loops[loopIndex]?.members).filter((id): id is string => typeof id === "string");
        if (!loopMembers.includes(agentId as string)) diagnostics.push(diagnostic("IR_JOIN_SCOPE_INVALID", `/orchestration/joins/${index}/agentId`, "A Loop-scoped Join target must be a member of its Loop."));
      }
    }
    const seen = new Set<string>();
    for (const [sourceIndex, id] of ids.entries()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const handoff = handoffsById.get(id);
      if (!handoff) diagnostics.push(diagnostic("IR_UNKNOWN_HANDOFF", `/orchestration/joins/${index}/handoffIds/${sourceIndex}`, `Unknown Join Handoff '${id}'.`));
      else {
        if (handoffTargetKey(handoff) !== target) diagnostics.push(diagnostic("IR_JOIN_TARGET_MISMATCH", `/orchestration/joins/${index}/handoffIds/${sourceIndex}`, `Handoff '${id}' does not target this Join input port.`, undefined, [agentId as string]));
        if (scope.kind === "loop") {
          const loop = loops.find((item) => item.id === scope.loopId);
          const members = items(loop?.members).filter((member): member is string => typeof member === "string");
          const source = isRecord(handoff.from) ? handoff.from : {};
          if (source.kind !== "agent" || typeof source.agentId !== "string" || !members.includes(source.agentId)) {
            diagnostics.push(diagnostic("IR_JOIN_SCOPE_INVALID", `/orchestration/joins/${index}/handoffIds/${sourceIndex}`, `Loop-scoped Join source '${id}' must originate from a member of that Loop.`));
          }
        }
      }
    }
    const incoming = incomingByPort.get(target) ?? [];
    for (const { handoff, index: edgeIndex } of incoming) {
      if (!seen.has(String(handoff.id))) diagnostics.push(diagnostic("IR_JOIN_UNDECLARED_INBOUND", `/handoffs/${edgeIndex}/to`, `Handoff '${String(handoff.id)}' targets a Join port but is not listed in its handoffIds.`, undefined, [agentId as string]));
    }
    if (join.mode === "quorum_of" && (!Number.isInteger(join.threshold) || Number(join.threshold) < 1 || Number(join.threshold) > ids.length)) {
      diagnostics.push(diagnostic("IR_JOIN_THRESHOLD_INVALID", `/orchestration/joins/${index}/threshold`, "quorum_of threshold must be a positive integer no greater than the number of sources."));
    }
  }

  for (const [index, loop] of loops.entries()) {
    const members = items(loop.members).filter((id): id is string => typeof id === "string");
    const memberSet = new Set(members);
    if (members.length !== memberSet.size) diagnostics.push(diagnostic("IR_LOOP_MEMBER_DUPLICATE", `/orchestration/loops/${index}/members`, "Loop members must be unique."));
    for (const [memberIndex, member] of members.entries()) {
      if (!agentsById.has(member)) diagnostics.push(diagnostic("IR_UNKNOWN_AGENT", `/orchestration/loops/${index}/members/${memberIndex}`, `Unknown Loop member Agent '${member}'.`));
    }
    if (typeof loop.boundaryAgentId !== "string" || !memberSet.has(loop.boundaryAgentId)) {
      diagnostics.push(diagnostic("IR_LOOP_BOUNDARY_INVALID", `/orchestration/loops/${index}/boundaryAgentId`, "Loop boundaryAgentId must be included in members."));
    }
    const sets = ["entryHandoffIds", "continueHandoffIds", "exitHandoffIds"] as const;
    const idSets = new Map<string, Set<string>>();
    for (const setName of sets) {
      const ids = items(loop[setName]).filter((id): id is string => typeof id === "string");
      const set = new Set(ids);
      if (set.size !== ids.length) diagnostics.push(diagnostic("IR_LOOP_HANDOFF_DUPLICATE", `/orchestration/loops/${index}/${setName}`, `${setName} must contain unique Handoff IDs.`));
      idSets.set(setName, set);
      for (const [edgeIndex, id] of ids.entries()) {
        const handoff = handoffsById.get(id);
        if (!handoff) diagnostics.push(diagnostic("IR_UNKNOWN_HANDOFF", `/orchestration/loops/${index}/${setName}/${edgeIndex}`, `Unknown Loop Handoff '${id}'.`));
      }
    }
    const entry = idSets.get("entryHandoffIds") ?? new Set();
    const continued = idSets.get("continueHandoffIds") ?? new Set();
    const exit = idSets.get("exitHandoffIds") ?? new Set();
    for (const id of entry) if (continued.has(id) || exit.has(id)) diagnostics.push(diagnostic("IR_LOOP_HANDOFF_SET_OVERLAP", `/orchestration/loops/${index}`, `Handoff '${id}' appears in multiple Loop boundary sets.`));
    for (const id of continued) if (exit.has(id)) diagnostics.push(diagnostic("IR_LOOP_HANDOFF_SET_OVERLAP", `/orchestration/loops/${index}`, `Handoff '${id}' appears in multiple Loop boundary sets.`));

    const checkBoundaryEdge = (id: string, setName: typeof sets[number]): void => {
      const handoff = handoffsById.get(id);
      if (!handoff) return;
      const from = isRecord(handoff.from) ? handoff.from as Endpoint : {};
      const to = isRecord(handoff.to) ? handoff.to as Target : {};
      const sourceInside = from.kind === "agent" && typeof from.agentId === "string" && memberSet.has(from.agentId);
      const targetInside = to.kind === "agent" && typeof to.agentId === "string" && memberSet.has(to.agentId);
      const boundaryId = loop.boundaryAgentId;
      const pointer = `/orchestration/loops/${index}/${setName}`;
      if (setName === "entryHandoffIds" && (sourceInside || !targetInside || to.agentId !== boundaryId)) {
        diagnostics.push(diagnostic("IR_LOOP_ENTRY_INVALID", pointer, `Entry Handoff '${id}' must enter boundaryAgentId from outside the Loop.`));
      }
      if (setName === "continueHandoffIds" && (!sourceInside || !targetInside || to.agentId !== boundaryId)) {
        diagnostics.push(diagnostic("IR_LOOP_CONTINUE_INVALID", pointer, `Continue Handoff '${id}' must remain in the Loop and target boundaryAgentId.`));
      }
      if (setName === "exitHandoffIds" && (!sourceInside || targetInside)) {
        diagnostics.push(diagnostic("IR_LOOP_EXIT_INVALID", pointer, `Exit Handoff '${id}' must leave the Loop from one of its members.`));
      }
    };
    for (const setName of sets) for (const id of idSets.get(setName) ?? []) checkBoundaryEdge(id, setName);

    for (const [handoffIndex, handoff] of handoffs.entries()) {
      const from = isRecord(handoff.from) ? handoff.from as Endpoint : {};
      const to = isRecord(handoff.to) ? handoff.to as Target : {};
      const sourceInside = from.kind === "agent" && typeof from.agentId === "string" && memberSet.has(from.agentId);
      const targetInside = to.kind === "agent" && typeof to.agentId === "string" && memberSet.has(to.agentId);
      if (sourceInside !== targetInside) {
        const id = typeof handoff.id === "string" ? handoff.id : "";
        if (!entry.has(id) && !continued.has(id) && !exit.has(id)) {
          diagnostics.push(diagnostic("IR_LOOP_BOUNDARY_HANDOFF_UNDECLARED", `/handoffs/${handoffIndex}`, `Cross-boundary Handoff '${id}' must be declared in exactly one Loop boundary set.`));
        }
      }
    }
  }

  for (let index = 0; index < loops.length; index += 1) {
    const members = new Set(items(loops[index].members).filter((id): id is string => typeof id === "string"));
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      const sharedMembers = items(loops[otherIndex].members).filter((id): id is string => typeof id === "string" && members.has(id));
      if (sharedMembers.length) {
        diagnostics.push(diagnostic(
          "IR_LOOP_SCOPE_OVERLAP_UNSUPPORTED",
          `/orchestration/loops/${index}/members`,
          `Loop Scope '${String(loops[index].id)}' overlaps Loop Scope '${String(loops[otherIndex].id)}' at Agent '${sharedMembers[0]}'. Nested or overlapping Loop Scopes are unsupported.`
        ));
      }
    }
  }

  for (const [index, review] of reviews.entries()) {
    const at = isRecord(review.at) ? review.at : {};
    const agentId = at.agentId;
    const outputPort = at.outputPort;
    const agent = typeof agentId === "string" ? agentsById.get(agentId) : undefined;
    if (!agent) diagnostics.push(diagnostic("IR_UNKNOWN_AGENT", `/orchestration/reviews/${index}/at/agentId`, `Unknown Review Agent '${String(agentId)}'.`));
    else if (typeof outputPort === "string" && (!isRecord(agent.outputPorts) || !Object.prototype.hasOwnProperty.call(agent.outputPorts, outputPort))) {
      diagnostics.push(diagnostic("IR_UNKNOWN_PORT", `/orchestration/reviews/${index}/at/outputPort`, `Unknown Review output port '${outputPort}' on Agent '${agentId}'.`, "Use a declared output port.", [agentId as string]));
    }
  }

  diagnostics.push(...validateTeamIrRuntimeTopologies(document));

  return diagnostics;
}
