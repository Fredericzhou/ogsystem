import type { SystemDefinition } from "./types.js";
import type { OgsSpecificationSnapshot } from "./ogs-spec-loader.js";
import { semanticIRDigest, validateSemanticIR } from "./semantic-ir.js";
import { validateConditionAst } from "./condition-ast.js";
import { validateCapabilityPolicy } from "./capability-policy.js";
import type { SemanticIR, SemanticIRJoinSpec, SemanticIRLoopScope } from "./semantic-ir.js";
import { compileSubgraphSpec, type SubgraphSpec } from "./subgraph.js";

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(path + " must be an object");
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry)) throw new Error(path + " must be an array of non-empty strings");
  return value;
}

function numberValue(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(path + " must be a positive integer");
  return value as number;
}

function sourceByBasename(snapshot: OgsSpecificationSnapshot, basename: string): unknown | undefined {
  return Object.entries(snapshot.sources).find(([path]) => path.endsWith("/" + basename))?.[1].value;
}

function compileLoops(raw: unknown): SemanticIRLoopScope[] {
  if (raw === undefined) return [];
  const loops = record(raw, "semantics.loops");
  return Object.entries(loops).map(([loopId, value]) => {
    const loop = record(value, "loops." + loopId);
    return {
      loopId,
      members: stringArray(loop.members, "loops." + loopId + ".members"),
      boundaryRoleId: String(loop.boundary ?? loop.boundaryRoleId ?? ""),
      counterField: String(loop.counter ?? loop.counterField ?? ""),
      maxRounds: numberValue(loop.max_rounds ?? loop.maxRounds, "loops." + loopId + ".maxRounds"),
      ...(loop.max_role_activations ?? loop.maxRoleActivationsByRoleId
        ? { maxRoleActivationsByRoleId: record(loop.max_role_activations ?? loop.maxRoleActivationsByRoleId, "loops." + loopId + ".maxRoleActivations") as Record<string, number> }
        : {}),
      onExhausted: String(loop.on_exhausted ?? loop.onExhausted ?? "")
    };
  });
}

function compileJoins(raw: unknown): SemanticIRJoinSpec[] {
  if (raw === undefined) return [];
  const joins = record(raw, "semantics.joins");
  return Object.entries(joins).map(([roleId, value]) => {
    const join = record(value, "joins." + roleId);
    const sources = stringArray(join.sources, "joins." + roleId + ".sources");
    const mode = join.mode;
    if (mode !== "all_of" && mode !== "quorum_of") throw new Error("joins." + roleId + ".mode is unsupported");
    return {
      roleId,
      mode,
      sources,
      min: mode === "all_of" ? sources.length : numberValue(join.min, "joins." + roleId + ".min"),
      key: "run+role+lineage+loop",
      duplicateArrival: "ignore",
      lateArrival: "ignore",
      failurePolicy: join.failurePolicy === "fail" || join.failurePolicy === "quorum_continue" ? join.failurePolicy : "wait",
      timeoutSeconds: numberValue(join.timeoutSeconds, "joins." + roleId + ".timeoutSeconds"),
      onTimeout: join.onTimeout === "quorum_continue" || join.onTimeout === "pause" || join.onTimeout === "terminate" ? join.onTimeout : "fail"
    };
  });
}

function compileConditions(raw: unknown): Map<string, { condition: any; priority: number }> {
  const result = new Map<string, { condition: any; priority: number }>();
  if (raw === undefined) return result;
  const routes = Array.isArray(raw) ? raw : Object.values(record(raw, "semantics.routes"));
  for (const value of routes) {
    const route = record(value, "semantics.routes[]");
    const from = String(route.from ?? route.fromRoleId ?? "");
    const event = String(route.event ?? route.eventType ?? "");
    const to = String(route.to ?? route.toRoleId ?? "");
    if (!from || !event || !to || route.when === undefined) continue;
    const diagnostics = validateConditionAst(route.when);
    if (diagnostics.length) throw new Error(diagnostics.map((item) => `[IR_INVALID_CONDITION] ${item}`).join("\n"));
    const priority = route.priority === undefined ? 0 : Number(route.priority);
    if (!Number.isInteger(priority) || priority < 0) throw new Error("[IR_INVALID_CONDITION] route priority must be a non-negative integer");
    result.set(`${from}\u0000${event}\u0000${to}`, { condition: route.when, priority });
  }
  return result;
}

function compileEvents(raw: unknown, snapshot: OgsSpecificationSnapshot): SemanticIR["events"] {
  if (raw === undefined) return undefined;
  const events = record(raw, "semantics.events");
  const compiled: NonNullable<SemanticIR["events"]> = {};
  for (const [eventType, value] of Object.entries(events)) {
    const event = record(value, `events.${eventType}`);
    const payload = event.payload === undefined ? undefined : record(event.payload, `events.${eventType}.payload`);
    const schemaRef = payload?.schema;
    let payloadSchema: unknown;
    if (schemaRef !== undefined) {
      if (typeof schemaRef !== "string" || !schemaRef) throw new Error(`[IR_CONTRACT_INVALID] events.${eventType}.payload.schema must be a string`);
      payloadSchema = Object.entries(snapshot.sources).find(([path]) => path.endsWith("/" + schemaRef) || path.endsWith("/" + String(schemaRef).split("/").at(-1)))?.[1].value;
      if (payloadSchema === undefined) throw new Error(`[IR_CONTRACT_INVALID] Event payload schema not found: ${schemaRef}`);
    }
    const writable = event.writable_state_fields ?? event.writableStateFields;
    compiled[eventType] = {
      ...(payloadSchema !== undefined ? { payloadSchema } : {}),
      ...(Array.isArray(writable) ? { writableStateFields: stringArray(writable, `events.${eventType}.writable_state_fields`) } : {})
    };
  }
  return compiled;
}

function compileRetryPolicies(raw: unknown): SemanticIR["retryByRoleId"] {
  if (raw === undefined) return undefined;
  const errors = record(raw, "semantics.errors");
  const output: NonNullable<SemanticIR["retryByRoleId"]> = {};
  for (const [roleId, value] of Object.entries(errors)) {
    const spec = record(value, `errors.${roleId}`);
    if (spec.retry === undefined) continue;
    const retry = record(spec.retry, `errors.${roleId}.retry`);
    const max = Number(retry.max_attempts ?? retry.maxAttempts);
    if (!Number.isInteger(max) || max < 1) throw new Error(`[IR_BUDGET_INVALID] errors.${roleId}.retry.max_attempts must be a positive integer`);
    const backoff = retry.backoff === "exponential" ? "exponential" : "constant";
    if (retry.backoff !== undefined && retry.backoff !== "constant" && retry.backoff !== "exponential") throw new Error(`[IR_INVALID_CONDITION] Unsupported retry backoff for ${roleId}`);
    output[roleId] = { maxAttempts: max, backoff };
  }
  return output;
}

function compileSubgraphs(raw: unknown, snapshot: OgsSpecificationSnapshot): SubgraphSpec[] | undefined {
  if (raw === undefined) return undefined;
  const entries = Array.isArray(raw)
    ? raw.map((value) => [undefined, value] as const)
    : Object.entries(record(raw, "semantics.subgraphs"));
  const namespaces = new Set<string>();
  const checkpoints = new Set<string>();
  const compiled = entries.map(([id, value], index) => {
    const source = record(value, `semantics.subgraphs[${index}]`);
    const spec = compileSubgraphSpec({ ...(id ? { id } : {}), ...source });
    const sourceExists = Object.keys(snapshot.sources).some((path) =>
      path === spec.source || path.endsWith("/" + spec.source)
    );
    if (!sourceExists) throw new Error(`[IR_UNKNOWN_REFERENCE] Subgraph source not found: ${spec.source}`);
    if (namespaces.has(spec.namespace) || checkpoints.has(spec.checkpointNamespace)) {
      throw new Error(`[IR_SUBGRAPH_INVALID] Subgraph namespaces must be unique: ${spec.id}`);
    }
    namespaces.add(spec.namespace);
    checkpoints.add(spec.checkpointNamespace);
    return spec;
  });
  return compiled.sort((left, right) => left.id.localeCompare(right.id));
}

export function compileSemanticIR(args: {
  system: SystemDefinition;
  specification: OgsSpecificationSnapshot;
  maxTransitionsPerRun: number;
}): { ir: SemanticIR; digest: string } {
  const semantics = sourceByBasename(args.specification, "semantics.yaml")
    ?? sourceByBasename(args.specification, "semantics.yml")
    ?? sourceByBasename(args.specification, "semantics.json");
  if (!semantics) throw new Error("Semantic specification is required to compile Semantic IR");
  const root = record(semantics, "semantics");
  const state = record(root.state, "semantics.state");
  const schemaRef = state.schema;
  if (typeof schemaRef !== "string" || !schemaRef) throw new Error("semantics.state.schema must be a string");
  const roles = record(root.roles ?? {}, "semantics.roles");
  const conditionByTransition = compileConditions(root.routes ?? root.transitions);
  const capabilityRoot = record(root.capabilities ?? {}, "semantics.capabilities");
  const retryByRoleId = compileRetryPolicies(root.errors);
  const subgraphs = compileSubgraphs(root.subgraphs, args.specification);
  const events = compileEvents(root.events, args.specification);
  const requestedTransitionBudget = capabilityRoot.max_transitions_per_run ?? capabilityRoot.maxTransitionsPerRun;
  const requestedBudgetNumber = requestedTransitionBudget === undefined ? undefined : Number(requestedTransitionBudget);
  if (requestedBudgetNumber !== undefined && (!Number.isInteger(requestedBudgetNumber) || requestedBudgetNumber <= 0)) {
    throw new Error("[IR_BUDGET_INVALID] capabilities.maxTransitionsPerRun must be a positive integer");
  }
  if (requestedBudgetNumber !== undefined && requestedBudgetNumber > args.maxTransitionsPerRun) {
    throw new Error("[IR_BUDGET_INVALID] capabilities.maxTransitionsPerRun exceeds the effective law limit");
  }
  const ir: SemanticIR = {
    version: 1,
    system: { systemId: args.system.systemId, systemVersion: args.system.systemVersion },
    seats: [...args.system.roleIds].sort().map((roleId) => {
      const role = roles[roleId] ? record(roles[roleId], "roles." + roleId) : {};
      const modes = record(role.modes ?? { default: {} }, "roles." + roleId + ".modes");
      const defaultMode = role.default_mode ?? role.defaultMode ?? ("default" in modes ? "default" : undefined);
      if (typeof defaultMode !== "string" || !defaultMode || !(defaultMode in modes)) {
        throw new Error(`[IR_CONTRACT_INVALID] roles.${roleId} must declare default_mode or a default mode`);
      }
      return {
        roleId,
        ...(typeof role.package === "string" ? { packageRef: role.package } : {}),
        binding: args.system.modelBinding[roleId] ?? args.system.executionBinding[roleId] ?? { kind: "noop" },
        modes,
        defaultMode
      };
    }),
    transitions: args.system.flows
      .map((flow) => ({
        flowId: flow.fromRoleId + ":" + flow.eventType + ":" + flow.toRoleId,
        ...flow,
        channel: flow.eventType.startsWith("ERROR") ? "error" as const : "normal" as const,
        ...(conditionByTransition.get(`${flow.fromRoleId}\u0000${flow.eventType}\u0000${flow.toRoleId}`) ?? { priority: 0 })
      }))
      .sort((left, right) => left.flowId.localeCompare(right.flowId)),
    stateSchema: {
      schemaVersion: Number(root.version),
      ref: schemaRef,
      ...(state.reducers ? { reducers: record(state.reducers, "semantics.state.reducers") as Record<string, any> } : {}),
      ...(state.defaults ? { defaults: record(state.defaults, "semantics.state.defaults") } : {}),
      ...(state.writable_roles ? { writableRolesByField: record(state.writable_roles, "semantics.state.writable_roles") as Record<string, string[]> } : {})
    },
    loops: compileLoops(root.loops),
    joins: compileJoins(root.joins),
    ...(events ? { events } : {}),
    ...(retryByRoleId ? { retryByRoleId } : {}),
    ...(subgraphs ? { subgraphs } : {}),
    contracts: Object.entries(args.specification.sources)
      .filter(([path]) => path.includes("/contracts/"))
      .map(([path]) => ({ id: path.split("/").at(-1) ?? path, ref: path }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    capabilities: {
      maxTransitionsPerRun: requestedBudgetNumber ?? args.maxTransitionsPerRun,
      allowedToolsByRoleId: (capabilityRoot.allowed_tools_by_role ?? capabilityRoot.allowedToolsByRoleId ?? {}) as Record<string, string[]>,
      ...(capabilityRoot.max_role_activations_by_role ?? capabilityRoot.maxRoleActivationsByRoleId
        ? { maxRoleActivationsByRoleId: (capabilityRoot.max_role_activations_by_role ?? capabilityRoot.maxRoleActivationsByRoleId) as Record<string, number> }
        : {})
    },
    defaults: { routePriority: 0, loopIteration: 0, joinDuplicateArrival: "ignore", joinTimeoutSeconds: 3600 }
  };
  const diagnostics = validateSemanticIR(ir);
  for (const message of validateCapabilityPolicy({
    roleIds: args.system.roleIds,
    allowedToolsByRoleId: ir.capabilities.allowedToolsByRoleId,
    maxTransitionsPerRun: ir.capabilities.maxTransitionsPerRun
  })) {
    diagnostics.push({ code: "IR_BUDGET_INVALID", message, path: "capabilities" });
  }
  if (!ir.contracts.some((item) => item.id === schemaRef || item.ref.endsWith("/" + schemaRef))) {
    diagnostics.push({ code: "IR_CONTRACT_INVALID", message: `State schema contract not found: ${schemaRef}`, path: "state.schema" });
  }
  for (const join of ir.joins) {
    const incomingSources = args.system.flows
      .filter((flow) => flow.toRoleId === join.roleId)
      .map((flow) => flow.fromRoleId)
      .sort();
    const declaredSources = [...join.sources].sort();
    if (incomingSources.join("\u0000") !== declaredSources.join("\u0000")) {
      diagnostics.push({
        code: "IR_JOIN_SCOPE_INVALID",
        message: `Join ${join.roleId} sources must match Mermaid incoming role edges`,
        path: "joins." + join.roleId + ".sources"
      });
    }
  }
  for (const loop of ir.loops) {
    if (loop.onExhausted !== "end" && !args.system.flows.some(
      (flow) => flow.toRoleId === loop.onExhausted && loop.members.includes(flow.fromRoleId)
    )) {
      diagnostics.push({
        code: "IR_UNKNOWN_REFERENCE",
        message: `Loop ${loop.loopId} exhausted target must be a declared outgoing Mermaid edge from a loop member`,
        path: `loops.${loop.loopId}.onExhausted`
      });
    }
  }
  const routesByKey = new Map<string, string[]>();
  for (const transition of ir.transitions) {
    const key = [transition.fromRoleId, transition.eventType, transition.priority].join("\u0000");
    const targets = routesByKey.get(key) ?? [];
    targets.push(transition.toRoleId);
    routesByKey.set(key, targets);
  }
  for (const [key, targets] of routesByKey) {
    const [roleId] = key.split("\u0000");
    if (targets.length > 1 && !args.system.graph?.routingModeByRoleId[roleId]) {
      diagnostics.push({
        code: "IR_ROUTE_AMBIGUOUS",
        message: `Multiple same-priority routes require an explicit routing mode on ${roleId}`,
        path: "transitions"
      });
    }
  }
  if (diagnostics.length) throw new Error(diagnostics.map((item) => "[" + item.code + "] " + item.message).join("\n"));
  return { ir, digest: semanticIRDigest(ir) };
}
