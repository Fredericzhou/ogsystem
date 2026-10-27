import { parseTeamReference, type ParsedTeamReference, type ReferenceSegment } from "./reference.js";
import type { TeamIrDiagnostic, TeamIrDocument } from "./types.js";
import { TeamSchemaResolver, TeamSchemaResolverError } from "./schema-resolver.js";

type RecordValue = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;
type SourceValue = {
  schema?: unknown;
  schemaAlternatives?: unknown[];
  guaranteed: boolean;
  artifactSlot?: RecordValue;
  artifactAlternatives?: RecordValue[];
  uncertain?: boolean;
  description: string;
};

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function pointerPart(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function addDiagnostic(
  diagnostics: TeamIrDiagnostic[],
  code: string,
  pointer: string,
  message: string,
  severity: "error" | "warning" = "error",
  suggestedFix?: string,
  relatedAgentIds?: string[]
): void {
  diagnostics.push({
    code,
    pointer: pointer || "/",
    message,
    severity,
    ...(suggestedFix ? { suggestedFix } : {}),
    ...(relatedAgentIds?.length ? { relatedAgentIds } : {})
  });
}

function schemaObject(value: unknown): JsonSchema | undefined {
  return isRecord(value) ? value : undefined;
}

function schemaType(schema: unknown): Set<string> | undefined {
  const record = schemaObject(schema);
  if (!record) return undefined;
  const raw = record.type;
  if (typeof raw === "string") return new Set([raw]);
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) return new Set(raw as string[]);
  if (record.properties || record.required) return new Set(["object"]);
  if (record.items) return new Set(["array"]);
  return undefined;
}

function needsRuntimeSchemaCheck(schema: unknown): boolean {
  const value = schemaObject(schema);
  if (!value) return true;
  return ["allOf", "anyOf", "oneOf", "not", "if", "then", "else", "enum", "const", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "contains", "dependentSchemas", "propertyNames"]
    .some((keyword) => Object.prototype.hasOwnProperty.call(value, keyword));
}

function compatibleType(source: unknown, target: unknown): boolean | undefined {
  const sourceTypes = schemaType(source);
  const targetTypes = schemaType(target);
  if (!sourceTypes || !targetTypes) return undefined;
  for (const sourceType of sourceTypes) {
    const accepted = targetTypes.has(sourceType) || (sourceType === "integer" && targetTypes.has("number"));
    if (!accepted) return false;
  }
  return true;
}

function literalSchema(value: unknown): JsonSchema {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", const: value };
  if (typeof value === "boolean") return { type: "boolean", const: value };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number", const: value };
  if (Array.isArray(value)) return { type: "array", items: value.length ? literalSchema(value[0]) : {} };
  if (isRecord(value)) {
    return {
      type: "object",
      properties: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, literalSchema(child)])),
      required: Object.keys(value),
      additionalProperties: false
    };
  }
  return {};
}

function literalCompatibility(
  schema: unknown,
  value: unknown,
  resolver: TeamSchemaResolver,
  resourcePath = "team.json",
  active = new Set<string>()
): boolean | undefined {
  const resolved = resolveSchema(schema, resolver, [], "/", active, resourcePath);
  const target = schemaObject(resolved.schema);
  if (!target || resolved.uncertain || needsRuntimeSchemaCheck(target)) return undefined;
  const types = schemaType(target);
  const valueType = value === null ? "null"
    : Array.isArray(value) ? "array"
      : isRecord(value) ? "object"
        : typeof value === "number" ? Number.isInteger(value) ? "integer" : "number"
          : typeof value;
  if (types && ![...types].some((type) => type === valueType || (valueType === "integer" && type === "number"))) return false;
  if (Array.isArray(value)) {
    if (target.items === undefined) return value.length === 0 ? true : undefined;
    const results = value.map((item) => literalCompatibility(target.items, item, resolver, resolved.resourcePath, active));
    return results.includes(false) ? false : results.includes(undefined) ? undefined : true;
  }
  if (isRecord(value)) {
    const properties = schemaObject(target.properties) ?? {};
    const required = Array.isArray(target.required) ? target.required : [];
    if (required.some((key) => typeof key !== "string" || !Object.prototype.hasOwnProperty.call(value, key))) return false;
    const results = Object.entries(value).map(([key, child]) => {
      const childSchema = properties[key];
      if (childSchema === undefined) {
        if (target.additionalProperties === false) return false;
        if (target.additionalProperties === undefined || target.additionalProperties === true) return undefined;
        return literalCompatibility(target.additionalProperties, child, resolver, resolved.resourcePath, active);
      }
      return literalCompatibility(childSchema, child, resolver, resolved.resourcePath, active);
    });
    return results.includes(false) ? false : results.includes(undefined) ? undefined : true;
  }
  return true;
}

function resolveSchema(
  schema: unknown,
  resolver: TeamSchemaResolver,
  diagnostics: TeamIrDiagnostic[],
  pointer: string,
  active = new Set<string>(),
  fromResource = "team.json"
): { schema: unknown; resourcePath: string; uncertain: boolean } {
  const object = schemaObject(schema);
  if (!object || typeof object.$ref !== "string") return { schema, resourcePath: fromResource, uncertain: false };
  const reference = object.$ref;
  if (active.has(reference)) return { schema, resourcePath: fromResource, uncertain: true };
  try {
    const resolved = resolver.resolve(reference, fromResource);
    const target = schemaObject(resolved.schema);
    if (!target) return { schema: resolved.schema, resourcePath: resolved.resourcePath, uncertain: false };
    const siblings = Object.fromEntries(Object.entries(object).filter(([key]) => key !== "$ref"));
    if (Object.keys(siblings).length > 0) {
      return { schema: { allOf: [target, siblings] }, resourcePath: resolved.resourcePath, uncertain: true };
    }
    active.add(reference);
    const nested = resolveSchema(resolved.schema, resolver, diagnostics, pointer, active, resolved.resourcePath);
    active.delete(reference);
    return nested;
  } catch (error) {
    const code = error instanceof TeamSchemaResolverError ? error.code : "IR_UNKNOWN_SCHEMA_REF";
    addDiagnostic(diagnostics, code, pointer, `Unable to resolve schema reference '${reference}': ${String(error)}`);
    return { schema: undefined, resourcePath: fromResource, uncertain: true };
  }
}

function lookupSchemaPath(args: {
  schema: unknown;
  path: ReferenceSegment[];
  resolver: TeamSchemaResolver;
  diagnostics: TeamIrDiagnostic[];
  pointer: string;
  fromResource?: string;
}): { schema?: unknown; guaranteed: boolean; uncertain: boolean; missing?: string } {
  let current = args.schema;
  let fromResource = args.fromResource ?? "team.json";
  let guaranteed = true;
  let uncertain = false;
  for (const [index, segment] of args.path.entries()) {
    const resolved = resolveSchema(current, args.resolver, args.diagnostics, args.pointer, new Set(), fromResource);
    current = resolved.schema;
    fromResource = resolved.resourcePath;
    uncertain ||= resolved.uncertain;
    const object = schemaObject(current);
    if (!object) return { guaranteed, uncertain: true };
    if (needsRuntimeSchemaCheck(object)) uncertain = true;
    if (typeof segment === "number") {
      const types = schemaType(object);
      if (types && !types.has("array")) return { guaranteed: false, uncertain, missing: `array index ${segment}` };
      if (typeof object.maxItems === "number" && segment >= object.maxItems) {
        return { guaranteed: false, uncertain, missing: `array index ${segment}` };
      }
      const prefixItems = Array.isArray(object.prefixItems) ? object.prefixItems : undefined;
      const itemSchema = prefixItems && segment < prefixItems.length ? prefixItems[segment] : object.items;
      if (itemSchema === false) return { guaranteed: false, uncertain, missing: `array index ${segment}` };
      if (itemSchema === undefined) return { guaranteed: false, uncertain: true };
      current = itemSchema;
      guaranteed &&= typeof object.minItems === "number" && object.minItems > segment;
      continue;
    }
    const types = schemaType(object);
    if (types && !types.has("object")) return { guaranteed: false, uncertain, missing: `property '${segment}'` };
    const properties = schemaObject(object.properties);
    if (!properties || !Object.prototype.hasOwnProperty.call(properties, segment)) {
      if (needsRuntimeSchemaCheck(object)) return { guaranteed: false, uncertain: true };
      if (object.additionalProperties === false) return { guaranteed: false, uncertain, missing: `property '${segment}'` };
      return { guaranteed: false, uncertain: true };
    }
    const required = Array.isArray(object.required) ? object.required : [];
    if (!required.includes(segment)) guaranteed = false;
    current = properties[segment];
    if (index === args.path.length - 1) {
      const field = resolveSchema(current, args.resolver, args.diagnostics, args.pointer, new Set(), fromResource);
      return { schema: field.schema, guaranteed, uncertain: uncertain || field.uncertain };
    }
  }
  const resolved = resolveSchema(current, args.resolver, args.diagnostics, args.pointer, new Set(), fromResource);
  return { schema: resolved.schema, guaranteed, uncertain: uncertain || resolved.uncertain };
}

function mediaTypeMatches(sourceTypes: string[], acceptedTypes: string[]): boolean | undefined {
  if (sourceTypes.length === 0 || acceptedTypes.length === 0) return undefined;
  const sourceHasWildcard = sourceTypes.some((value) => value.includes("*"));
  const acceptedHasWildcard = acceptedTypes.some((value) => value.includes("*"));
  if (sourceHasWildcard || acceptedHasWildcard) {
    const compatible = sourceTypes.every((source) => acceptedTypes.some((accepted) => {
      if (accepted === "*/*") return true;
      if (accepted.endsWith("/*")) return source.startsWith(accepted.slice(0, -1));
      return source === accepted;
    }));
    return compatible ? true : undefined;
  }
  return sourceTypes.every((source) => acceptedTypes.includes(source));
}

function outputPortFor(document: TeamIrDocument, agentId: string, outputPort: string): RecordValue | undefined {
  const agent = records(document.agents).find((value) => value.id === agentId);
  const ports = agent && isRecord(agent.outputPorts) ? agent.outputPorts : undefined;
  return ports && isRecord(ports[outputPort]) ? ports[outputPort] as RecordValue : undefined;
}

function inputPortFor(document: TeamIrDocument, agentId: string, inputPort: string): RecordValue | undefined {
  const agent = records(document.agents).find((value) => value.id === agentId);
  const ports = agent && isRecord(agent.inputPorts) ? agent.inputPorts : undefined;
  return ports && isRecord(ports[inputPort]) ? ports[inputPort] as RecordValue : undefined;
}

function sourceForReference(args: {
  document: TeamIrDocument;
  reference: ParsedTeamReference;
  handoff?: RecordValue;
  resolver: TeamSchemaResolver;
  diagnostics: TeamIrDiagnostic[];
  pointer: string;
  baseMapping?: boolean;
}): SourceValue | undefined {
  const { document, reference, handoff, diagnostics, resolver, pointer } = args;
  const from = handoff && isRecord(handoff.from) ? handoff.from : undefined;
  const sourceAgentId = from?.kind === "agent" && typeof from.agentId === "string" ? from.agentId : undefined;
  const sourcePortId = from?.kind === "agent" && typeof from.outputPort === "string" ? from.outputPort : undefined;
  const path = reference.path;

  if (reference.root === "output") {
    if (!sourceAgentId || !sourcePortId) {
      addDiagnostic(diagnostics, "IR_MAPPING_REF_SCOPE_INVALID", pointer, "$.output references require a Handoff from an Agent output.");
      return undefined;
    }
    if (path[0] === "event") return { schema: { type: "string", const: sourcePortId }, guaranteed: true, description: "output event" };
    const port = outputPortFor(document, sourceAgentId, sourcePortId);
    if (!port) return undefined;
    if (path[0] === "data") {
      const lookup = lookupSchemaPath({ schema: port.dataSchema, path: path.slice(1), resolver, diagnostics, pointer });
      if (lookup.missing) addDiagnostic(diagnostics, "IR_MAPPING_SOURCE_MISSING", pointer, `Source schema has no ${lookup.missing}.`);
      return { schema: lookup.schema, guaranteed: lookup.guaranteed, description: "Agent output data" };
    }
    if (path[0] === "artifacts" && typeof path[1] === "string") {
      const slots = isRecord(port.artifactSlots) ? port.artifactSlots : {};
      const slot = isRecord(slots[path[1]]) ? slots[path[1]] as RecordValue : undefined;
      if (!slot) {
        addDiagnostic(diagnostics, "IR_MAPPING_SOURCE_MISSING", pointer, `Output artifact slot '${path[1]}' is not declared.`);
        return undefined;
      }
      return { artifactSlot: slot, guaranteed: slot.required === true, description: "Agent output Artifact" };
    }
  }

  if (reference.root === "run") {
    if (path[0] === "task") return { schema: { type: "string" }, guaranteed: true, description: "Run task" };
    if (path[0] === "input" || path[0] === "preferences") {
      const contract = path[0] === "input" ? document.runInput.dataSchema : document.runInput.preferencesSchema;
      const lookup = lookupSchemaPath({ schema: contract, path: path.slice(1), resolver, diagnostics, pointer });
      if (lookup.missing) addDiagnostic(diagnostics, "IR_MAPPING_SOURCE_MISSING", pointer, `Run ${String(path[0])} schema has no ${lookup.missing}.`);
      return { schema: lookup.schema, guaranteed: lookup.guaranteed, description: `Run ${String(path[0])}` };
    }
    if (path[0] === "attachments" && typeof path[1] === "string") {
      const slots = isRecord(document.runInput.artifactSlots) ? document.runInput.artifactSlots : {};
      const slot = isRecord(slots[path[1]]) ? slots[path[1]] as RecordValue : undefined;
      if (!slot) {
        addDiagnostic(diagnostics, "IR_MAPPING_SOURCE_MISSING", pointer, `Run attachment slot '${path[1]}' is not declared.`);
        return undefined;
      }
      return { artifactSlot: slot, guaranteed: slot.required === true, description: "Run attachment" };
    }
  }

  if (reference.root === "review") {
    const review = records(isRecord(document.orchestration) ? document.orchestration.reviews : undefined)
      .find((item) => isRecord(item.at) && item.at.agentId === sourceAgentId && item.at.outputPort === sourcePortId);
    if (!review) {
      addDiagnostic(diagnostics, "IR_MAPPING_REF_SCOPE_INVALID", pointer, "$.review references require a Review gate on this Agent output.", "error", undefined, sourceAgentId ? [sourceAgentId] : undefined);
      return undefined;
    }
    if (path[0] === "decision") return { schema: { type: "string", enum: ["approve", "reject"] }, guaranteed: true, description: "Review decision" };
    if (path[0] === "feedback") {
      const lookup = lookupSchemaPath({ schema: review.feedbackSchema, path: path.slice(1), resolver, diagnostics, pointer });
      if (lookup.missing) addDiagnostic(diagnostics, "IR_MAPPING_SOURCE_MISSING", pointer, `Review feedback schema has no ${lookup.missing}.`);
      return { schema: lookup.schema, guaranteed: false, description: "Review feedback" };
    }
  }

  if (reference.root === "loop") {
    const previousAgentId = path[1];
    const scopes = records(isRecord(document.orchestration) ? document.orchestration.loops : undefined);
    const inScope = scopes.some((scope) => Array.isArray(scope.members) && scope.members.includes(previousAgentId) && (() => {
      if (!handoff) return false;
      if (args.baseMapping) {
        const to = isRecord(handoff.to) ? handoff.to : undefined;
        return to?.kind === "agent" && Array.isArray(scope.members) && scope.members.includes(to.agentId);
      }
      const handoffId = handoff.id;
      const fromInside = from?.kind === "agent" && Array.isArray(scope.members) && scope.members.includes(from.agentId);
      const to = isRecord(handoff.to) ? handoff.to : undefined;
      const toInside = to?.kind === "agent" && Array.isArray(scope.members) && scope.members.includes(to.agentId);
      const boundaryIds = [scope.entryHandoffIds, scope.continueHandoffIds, scope.exitHandoffIds].flatMap((value) => Array.isArray(value) ? value : []);
      return (fromInside || toInside) && (boundaryIds.includes(handoffId) || (fromInside && toInside));
    })());
    if (!inScope) {
      addDiagnostic(diagnostics, "IR_LOOP_REF_OUT_OF_SCOPE", pointer, `Loop history for '${String(previousAgentId)}' is not in this Handoff's Loop Scope.`);
      return undefined;
    }
    if (typeof previousAgentId === "string" && handoff) {
      validateLoopPreviousDominance({ document, handoff, anchorAgentId: previousAgentId, pointer, diagnostics, baseMapping: args.baseMapping });
    }
    if (path[2] === "output" && path[3] === "data") {
      const matching = records(document.agents).find((agent) => agent.id === previousAgentId);
      const outputs = matching && isRecord(matching.outputPorts) ? Object.values(matching.outputPorts).filter(isRecord) : [];
      if (outputs.length === 0) {
        addDiagnostic(diagnostics, "IR_MAPPING_SOURCE_MISSING", pointer, `Loop previous Agent '${String(previousAgentId)}' has no output ports.`);
        return undefined;
      }
      const lookups = outputs.map((output) => lookupSchemaPath({ schema: output.dataSchema, path: path.slice(4), resolver, diagnostics, pointer }));
      const missing = lookups.find((lookup) => lookup.missing);
      if (missing?.missing) addDiagnostic(diagnostics, "IR_MAPPING_SOURCE_MISSING", pointer, `Previous output is not guaranteed across all output ports; missing ${missing.missing}.`);
      return {
        schema: lookups.length === 1 ? lookups[0]?.schema : undefined,
        schemaAlternatives: lookups.map((lookup) => lookup.schema),
        guaranteed: lookups.every((lookup) => lookup.guaranteed),
        uncertain: lookups.some((lookup) => lookup.uncertain),
        description: "Loop previous output"
      };
    }
    if (path[2] === "output" && path[3] === "artifacts") {
      const matching = records(document.agents).find((agent) => agent.id === previousAgentId);
      const outputs = matching && isRecord(matching.outputPorts) ? Object.values(matching.outputPorts).filter(isRecord) : [];
      const slotId = path[4];
      if (outputs.length === 0 || typeof slotId !== "string") return undefined;
      const slots = outputs.map((output) => isRecord(output.artifactSlots) ? output.artifactSlots : {});
      const alternatives = slots.map((item) => item[slotId]).filter(isRecord);
      if (alternatives.length !== outputs.length) {
        addDiagnostic(diagnostics, "IR_MAPPING_SOURCE_MISSING", pointer, `Previous output Artifact slot '${slotId}' is not declared in every output port.`);
        return undefined;
      }
      return {
        artifactSlot: alternatives[0],
        artifactAlternatives: alternatives,
        guaranteed: alternatives.every((slot) => slot.required === true),
        description: "Loop previous Artifact"
      };
    }
  }
  return undefined;
}

function destinationForHandoff(document: TeamIrDocument, handoff: RecordValue): { dataSchema?: unknown; artifactSlots: RecordValue; targetAgentId?: string } {
  const target = isRecord(handoff.to) ? handoff.to : {};
  if (target.kind === "result") {
    return {
      dataSchema: document.runResult.dataSchema,
      artifactSlots: isRecord(document.runResult.artifactSlots) ? document.runResult.artifactSlots : {}
    };
  }
  if (target.kind === "agent" && typeof target.agentId === "string" && typeof target.inputPort === "string") {
    const port = inputPortFor(document, target.agentId, target.inputPort);
    return {
      dataSchema: port?.dataSchema,
      artifactSlots: port && isRecord(port.artifactSlots) ? port.artifactSlots : {},
      targetAgentId: target.agentId
    };
  }
  return { artifactSlots: {} };
}

function mappingFields(expression: unknown): RecordValue | undefined {
  if (!isRecord(expression)) return undefined;
  if (Object.prototype.hasOwnProperty.call(expression, "$ref") || Object.prototype.hasOwnProperty.call(expression, "$literal")) return undefined;
  return expression;
}

function isJoinedHandoff(document: TeamIrDocument, handoffId: unknown): boolean {
  return records(isRecord(document.orchestration) ? document.orchestration.joins : undefined)
    .some((join) => Array.isArray(join.handoffIds) && join.handoffIds.includes(handoffId));
}

function routeGuaranteesEdge(document: TeamIrDocument, sourceKey: string, handoff: RecordValue): boolean {
  const orchestration = isRecord(document.orchestration) ? document.orchestration : {};
  const routes = records(orchestration.routes);
  const route = routes.find((item) => {
    const from = isRecord(item.from) ? item.from : {};
    const key = from.kind === "run"
      ? JSON.stringify(["run"])
      : from.kind === "agent" && typeof from.agentId === "string" && typeof from.outputPort === "string"
        ? JSON.stringify(["agent", from.agentId, from.outputPort])
        : undefined;
    return key === sourceKey;
  });
  if (!route) return true;
  const ids = Array.isArray(route.handoffIds) ? route.handoffIds : [];
  if (!ids.includes(handoff.id) || (isRecord(handoff.when) && handoff.when.condition !== undefined)) return false;
  if (route.mode === "parallel_fanout") return true;
  if (route.mode === "exclusive_priority") return ids.length === 1;
  return false;
}

function guaranteedAgentActivations(document: TeamIrDocument): Set<string> {
  const agents = records(document.agents);
  const handoffs = records(document.handoffs);
  const guaranteed = new Set<string>();
  for (const handoff of handoffs) {
    const from = isRecord(handoff.from) ? handoff.from : {};
    const to = isRecord(handoff.to) ? handoff.to : {};
    if (from.kind !== "run" || to.kind !== "agent" || typeof to.agentId !== "string"
      || (isRecord(handoff.when) && handoff.when.condition !== undefined)) continue;
    if (routeGuaranteesEdge(document, JSON.stringify(["run"]), handoff)) guaranteed.add(to.agentId);
  }

  // Propagate only from a guaranteed source output; parallel fanout guarantees each
  // unconditional edge, while multi-edge exclusive routes remain conditional.
  let changed = true;
  while (changed) {
    changed = false;
    for (const agent of agents) {
      if (typeof agent.id !== "string" || !guaranteed.has(agent.id)) continue;
      const outputPorts = isRecord(agent.outputPorts) ? Object.keys(agent.outputPorts) : [];
      if (outputPorts.length !== 1) continue;
      const outgoing = handoffs.filter((handoff) => isRecord(handoff.from) && handoff.from.kind === "agent"
        && handoff.from.agentId === agent.id && handoff.from.outputPort === outputPorts[0]);
      const sourceKey = JSON.stringify(["agent", agent.id, outputPorts[0]]);
      for (const handoff of outgoing) {
        if ((isRecord(handoff.when) && handoff.when.condition !== undefined) || !routeGuaranteesEdge(document, sourceKey, handoff)) continue;
        if (isRecord(handoff.to) && handoff.to.kind === "agent" && typeof handoff.to.agentId === "string" && !guaranteed.has(handoff.to.agentId)) {
          guaranteed.add(handoff.to.agentId);
          changed = true;
        }
      }
    }
  }
  return guaranteed;
}

function handoffMaySkip(document: TeamIrDocument, handoff: RecordValue, guaranteedAgents = guaranteedAgentActivations(document)): boolean {
  const when = isRecord(handoff.when) ? handoff.when : undefined;
  if (when && when.condition !== undefined) return true;
  const from = isRecord(handoff.from) ? handoff.from : {};
  if (from.kind === "agent" && (typeof from.agentId !== "string" || !guaranteedAgents.has(from.agentId))) return true;
  if (from.kind !== "agent" && from.kind !== "run") return true;
  const handoffId = handoff.id;
  const routes = records(isRecord(document.orchestration) ? document.orchestration.routes : undefined);
  const route = routes.find((item) => Array.isArray(item.handoffIds) && item.handoffIds.includes(handoffId));
  return route?.mode === "exclusive_priority" && Array.isArray(route.handoffIds) && route.handoffIds.length > 1;
}

function reachesWithout(start: string, target: string, blocked: string | undefined, edges: Array<{ from: string; to: string }>): boolean {
  if (target === blocked) return false;
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (visited.has(current) || current === blocked) continue;
    visited.add(current);
    for (const edge of edges) if (edge.from === current && edge.to !== blocked) pending.push(edge.to);
  }
  return false;
}

function hasCycle(start: string, edges: Array<{ from: string; to: string }>): boolean {
  const active = new Set<string>();
  const done = new Set<string>();
  const visit = (node: string): boolean => {
    if (active.has(node)) return true;
    if (done.has(node)) return false;
    active.add(node);
    for (const edge of edges) if (edge.from === node && visit(edge.to)) return true;
    active.delete(node);
    done.add(node);
    return false;
  };
  return visit(start);
}

function loopPreviousDominates(args: {
  document: TeamIrDocument;
  handoff: RecordValue;
  loop: RecordValue;
  anchorAgentId: string;
  baseMapping?: boolean;
}): boolean {
  const members = Array.isArray(args.loop.members) ? args.loop.members.filter((id): id is string => typeof id === "string") : [];
  const memberSet = new Set(members);
  const boundary = typeof args.loop.boundaryAgentId === "string" ? args.loop.boundaryAgentId : undefined;
  const from = isRecord(args.handoff.from) ? args.handoff.from : {};
  const to = isRecord(args.handoff.to) ? args.handoff.to : {};
  const consumer = args.baseMapping
    ? (to.kind === "agent" && typeof to.agentId === "string" ? to.agentId : undefined)
    : (from.kind === "agent" && typeof from.agentId === "string" ? from.agentId : undefined);
  const handoffId = args.handoff.id;
  const entryIds = Array.isArray(args.loop.entryHandoffIds) ? args.loop.entryHandoffIds : [];
  const continueIds = new Set(Array.isArray(args.loop.continueHandoffIds) ? args.loop.continueHandoffIds : []);
  if (!boundary || !consumer || !memberSet.has(consumer) || !memberSet.has(args.anchorAgentId)) return false;
  if (typeof handoffId === "string" && entryIds.includes(handoffId)) return false;
  if (consumer === boundary && !(typeof handoffId === "string" && continueIds.has(handoffId))) return false;

  const handoffs = records(args.document.handoffs);
  const internalEdges: Array<{ from: string; to: string; conditional: boolean }> = [];
  for (const candidate of handoffs) {
    const source = isRecord(candidate.from) ? candidate.from : {};
    const target = isRecord(candidate.to) ? candidate.to : {};
    if (source.kind !== "agent" || target.kind !== "agent" || typeof source.agentId !== "string" || typeof target.agentId !== "string") continue;
    if (!memberSet.has(source.agentId) || !memberSet.has(target.agentId) || continueIds.has(candidate.id)) continue;
    internalEdges.push({ from: source.agentId, to: target.agentId, conditional: isRecord(candidate.when) && candidate.when.condition !== undefined });
  }
  const edges = internalEdges.map(({ from: source, to: target }) => ({ from: source, to: target }));
  if (hasCycle(boundary, edges)) return false;
  if (!reachesWithout(boundary, args.anchorAgentId, undefined, edges)) return false;
  if (!reachesWithout(boundary, consumer, undefined, edges)) return false;
  if (reachesWithout(boundary, consumer, args.anchorAgentId, edges)) return false;

  const anchorIncoming = internalEdges.filter((edge) => edge.to === args.anchorAgentId);
  if (args.anchorAgentId !== boundary && anchorIncoming.length !== 1) return false;
  if (internalEdges.some((edge) => edge.conditional && reachesWithout(boundary, edge.from, undefined, edges) && reachesWithout(edge.to, consumer, undefined, edges))) return false;

  for (const id of continueIds) {
    const candidate = handoffs.find((item) => item.id === id);
    const source = candidate && isRecord(candidate.from) ? candidate.from : undefined;
    if (source?.kind === "agent" && typeof source.agentId === "string" && reachesWithout(boundary, source.agentId, args.anchorAgentId, edges)) return false;
  }
  return true;
}

function validateLoopPreviousDominance(args: {
  document: TeamIrDocument;
  handoff: RecordValue;
  anchorAgentId: string;
  pointer: string;
  diagnostics: TeamIrDiagnostic[];
  baseMapping?: boolean;
}): void {
  const to = isRecord(args.handoff.to) ? args.handoff.to : {};
  const from = isRecord(args.handoff.from) ? args.handoff.from : {};
  const consumer = args.baseMapping ? to.agentId : from.agentId;
  const loops = records(isRecord(args.document.orchestration) ? args.document.orchestration.loops : undefined);
  const matches = loops.filter((candidate) => {
    const members = Array.isArray(candidate.members) ? candidate.members : [];
    return members.includes(args.anchorAgentId) && members.includes(consumer);
  });
  if (matches.length !== 1 || !loopPreviousDominates({ ...args, loop: matches[0]! })) {
    addDiagnostic(args.diagnostics, "IR_LOOP_PREVIOUS_NOT_DOMINATED", args.pointer, `Loop history for '${args.anchorAgentId}' is not proven to have exactly one successful predecessor execution on every path in this Loop round.`);
  }
}

function targetFieldSchema(targetSchema: RecordValue, field: string): unknown {
  const properties = schemaObject(targetSchema.properties);
  if (properties && Object.prototype.hasOwnProperty.call(properties, field)) return properties[field];
  return targetSchema.additionalProperties !== false ? targetSchema.additionalProperties : undefined;
}

function sourceForExpression(args: {
  expression: unknown;
  handoff: RecordValue;
  document: TeamIrDocument;
  resolver: TeamSchemaResolver;
  diagnostics: TeamIrDiagnostic[];
  pointer: string;
  baseMapping?: boolean;
}): SourceValue | undefined {
  if (!isRecord(args.expression) || Object.keys(args.expression).length !== 1 || typeof args.expression.$ref !== "string") return undefined;
  let parsed: ParsedTeamReference;
  try {
    parsed = parseTeamReference(args.expression.$ref);
  } catch (error) {
    addDiagnostic(args.diagnostics, "IR_MAPPING_REF_INVALID", args.pointer, String(error));
    return undefined;
  }
  if (args.baseMapping && (parsed.root === "output" || parsed.root === "review")) {
    addDiagnostic(args.diagnostics, "IR_MAPPING_REF_SCOPE_INVALID", args.pointer, "Join baseMapping may only read Run fields, dominated Loop history or literals.");
    return undefined;
  }
  return sourceForReference({
    document: args.document,
    reference: parsed,
    handoff: args.handoff,
    resolver: args.resolver,
    diagnostics: args.diagnostics,
    pointer: args.pointer,
    baseMapping: args.baseMapping
  });
}

function validateExpression(args: {
  expression: unknown;
  targetSchema: unknown;
  handoff: RecordValue;
  document: TeamIrDocument;
  resolver: TeamSchemaResolver;
  diagnostics: TeamIrDiagnostic[];
  pointer: string;
  targetRequired: boolean;
  baseMapping?: boolean;
  targetResource?: string;
}): void {
  const target = resolveSchema(args.targetSchema, args.resolver, args.diagnostics, args.pointer, new Set(), args.targetResource);
  const targetSchema = schemaObject(target.schema);
  const expression = args.expression;

  if (isRecord(expression) && Object.keys(expression).length === 1 && typeof expression.$ref === "string") {
    const source = sourceForExpression({ ...args, expression });
    if (!source) return;
    if (source.artifactSlot) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_ARTIFACT_IN_DATA", args.pointer, "Artifact references must be mapped through map.artifacts.");
      return;
    }
    if (args.targetRequired && !source.guaranteed) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_OPTIONAL_TO_REQUIRED", args.pointer, "An optional or index-derived source cannot satisfy a required target.");
    }
    if (source.schema === undefined) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", args.pointer, "Source Schema cannot be statically resolved; validate the mapped value against the target Schema before delivery.", "warning");
      return;
    }
    const schemas = source.schemaAlternatives ?? [source.schema];
    const compatibilities = schemas.map((candidate) => candidate === undefined ? undefined : compatibleType(candidate, targetSchema));
    if (compatibilities.includes(false)) addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, `At least one possible ${source.description} schema cannot be assigned to the target Schema type.`);
    else if (compatibilities.includes(undefined) || source.uncertain || target.uncertain || schemas.some(needsRuntimeSchemaCheck) || needsRuntimeSchemaCheck(targetSchema)) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", args.pointer, "Static Schema compatibility cannot be proven; validate the mapped value against the target Schema before delivery.", "warning");
    }
    return;
  }

  if (isRecord(expression) && Object.keys(expression).length === 1 && Object.prototype.hasOwnProperty.call(expression, "$literal")) {
    const compatible = literalCompatibility(args.targetSchema, expression.$literal, args.resolver, args.targetResource);
    if (compatible === false) addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, "Literal value is incompatible with the target Schema type.");
    else if (compatible === undefined || target.uncertain) addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", args.pointer, "Literal compatibility cannot be proven statically; validate it before delivery.", "warning");
    return;
  }

  if (Array.isArray(expression)) {
    const targetTypes = schemaType(targetSchema);
    if (targetTypes && !targetTypes.has("array")) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, "Array mapping is incompatible with the target Schema type.");
      return;
    }
    if (typeof targetSchema?.minItems === "number" && expression.length < targetSchema.minItems) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, "Array mapping has fewer items than required by the target Schema.");
    }
    if (typeof targetSchema?.maxItems === "number" && expression.length > targetSchema.maxItems) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, "Array mapping has more items than allowed by the target Schema.");
    }
    const prefixItems = Array.isArray(targetSchema?.prefixItems) ? targetSchema.prefixItems : undefined;
    if (expression.length > 0 && targetSchema?.items === false && (!prefixItems || expression.length > prefixItems.length)) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, "Array mapping contains an item forbidden by the target Schema.");
      return;
    }
    if (prefixItems && expression.length > prefixItems.length && targetSchema?.items === false) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, "Array mapping has items beyond the target tuple Schema.");
      return;
    }
    if (!targetSchema?.items && !prefixItems) {
      if (expression.length > 0) addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", args.pointer, "Target array items Schema cannot be statically checked.", "warning");
      return;
    }
    expression.forEach((child, index) => {
      const itemSchema = prefixItems && index < prefixItems.length ? prefixItems[index] : targetSchema?.items;
      if (itemSchema === false) {
        addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", `${args.pointer}/${index}`, "Array item is forbidden by the target Schema.");
      } else if (itemSchema === undefined) {
        addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", `${args.pointer}/${index}`, "Target array item Schema cannot be statically checked.", "warning");
      } else {
        validateExpression({ ...args, expression: child, targetSchema: itemSchema, targetResource: target.resourcePath, pointer: `${args.pointer}/${index}`, targetRequired: true });
      }
    });
    return;
  }

  if (isRecord(expression)) {
    const targetTypes = schemaType(targetSchema);
    if (targetTypes && !targetTypes.has("object")) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, "Object mapping is incompatible with the target Schema type.");
      return;
    }
    const properties = schemaObject(targetSchema?.properties) ?? {};
    const required = Array.isArray(targetSchema?.required) ? targetSchema.required.filter((item): item is string => typeof item === "string") : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(expression, key)) {
        addDiagnostic(args.diagnostics, "IR_MAPPING_REQUIRED_FIELD_MISSING", `${args.pointer}/${pointerPart(key)}`, `Required target field '${key}' has no provider.`);
      }
    }
    for (const [key, child] of Object.entries(expression)) {
      const childSchema = properties[key];
      if (childSchema === undefined) {
        if (targetSchema?.additionalProperties === false) {
          addDiagnostic(args.diagnostics, "IR_MAPPING_TARGET_FIELD_UNKNOWN", `${args.pointer}/${pointerPart(key)}`, `Target Schema does not declare field '${key}'.`);
        } else if (targetSchema?.additionalProperties === undefined || targetSchema.additionalProperties === true) {
          addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", `${args.pointer}/${pointerPart(key)}`, `Target field '${key}' is governed by an open or unresolved additionalProperties rule.`, "warning");
        } else {
          validateExpression({ ...args, expression: child, targetSchema: targetSchema.additionalProperties, targetResource: target.resourcePath, pointer: `${args.pointer}/${pointerPart(key)}`, targetRequired: false });
        }
      } else {
        validateExpression({ ...args, expression: child, targetSchema: childSchema, targetResource: target.resourcePath, pointer: `${args.pointer}/${pointerPart(key)}`, targetRequired: required.includes(key) });
      }
    }
    if (target.uncertain || needsRuntimeSchemaCheck(targetSchema)) addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", args.pointer, "Target Schema contains constraints outside the static subset; validate the complete mapped value before delivery.", "warning");
    return;
  }

  const compatible = compatibleType(literalSchema(expression), targetSchema);
  if (compatible === false) addDiagnostic(args.diagnostics, "IR_MAPPING_TYPE_INCOMPATIBLE", args.pointer, "Literal value is incompatible with the target Schema type.");
  else if (compatible === undefined || target.uncertain) addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", args.pointer, "Value compatibility cannot be proven statically; validate it before delivery.", "warning");
}

function validateArtifactMapping(args: {
  mapping: unknown;
  handoff: RecordValue;
  document: TeamIrDocument;
  targetSlots: RecordValue;
  diagnostics: TeamIrDiagnostic[];
  handoffIndex: number;
  resolver: TeamSchemaResolver;
  baseMapping?: boolean;
}): void {
  const mapping = isRecord(args.mapping) ? args.mapping : {};
  const provided = isRecord(mapping.artifacts) ? mapping.artifacts : {};
  const from = isRecord(args.handoff.from) ? args.handoff.from : {};
  const target = isRecord(args.handoff.to) ? args.handoff.to : {};
  const pointer = `/handoffs/${args.handoffIndex}/map/artifacts`;

  for (const [slotId, slot] of Object.entries(args.targetSlots)) {
    if (isRecord(slot) && slot.required === true && !Object.prototype.hasOwnProperty.call(provided, slotId) && !args.baseMapping && !isJoinedHandoff(args.document, args.handoff.id)) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_REQUIRED_ARTIFACT_MISSING", `${pointer}/${pointerPart(slotId)}`, `Required artifact slot '${slotId}' has no provider.`);
    }
  }

  for (const [slotId, expression] of Object.entries(provided)) {
    const targetSlot = args.targetSlots[slotId];
    if (!isRecord(targetSlot)) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_ARTIFACT_TARGET_UNKNOWN", `${pointer}/${pointerPart(slotId)}`, `Target artifact slot '${slotId}' is not declared.`);
      continue;
    }
    const source = sourceForExpression({
      expression,
      handoff: args.handoff,
      document: args.document,
      resolver: args.resolver,
      diagnostics: args.diagnostics,
      pointer: `${pointer}/${pointerPart(slotId)}`,
      baseMapping: args.baseMapping
    });
    if (!source) continue;
    if (!source.artifactSlot) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_ARTIFACT_SOURCE_INVALID", `${pointer}/${pointerPart(slotId)}`, "Artifact targets require a direct reference to a declared Artifact slot.");
      continue;
    }
    if (targetSlot.required === true && !source.guaranteed) {
      addDiagnostic(args.diagnostics, "IR_MAPPING_OPTIONAL_TO_REQUIRED", `${pointer}/${pointerPart(slotId)}`, "An optional Artifact source cannot satisfy a required target slot.");
    }
    const targetTypes = Array.isArray(targetSlot.acceptedMediaTypes) ? targetSlot.acceptedMediaTypes.filter((item): item is string => typeof item === "string") : [];
    const sourceSlots = source.artifactAlternatives ?? [source.artifactSlot];
    const compatibilities = sourceSlots.map((sourceSlot) => {
      const sourceTypes = Array.isArray(sourceSlot.mediaTypes) ? sourceSlot.mediaTypes.filter((item): item is string => typeof item === "string") :
        Array.isArray(sourceSlot.acceptedMediaTypes) ? sourceSlot.acceptedMediaTypes.filter((item): item is string => typeof item === "string") : [];
      return mediaTypeMatches(sourceTypes, targetTypes);
    });
    if (compatibilities.includes(false)) addDiagnostic(args.diagnostics, "IR_MAPPING_ARTIFACT_MEDIA_TYPE_INCOMPATIBLE", `${pointer}/${pointerPart(slotId)}`, `At least one source Artifact media type is not accepted by target slot '${slotId}'.`);
    else if (compatibilities.includes(undefined)) addDiagnostic(args.diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", `${pointer}/${pointerPart(slotId)}`, `Artifact media compatibility for slot '${slotId}' requires runtime validation.`, "warning");
  }
}

function validateJoinContributions(args: {
  document: TeamIrDocument;
  resolver: TeamSchemaResolver;
  diagnostics: TeamIrDiagnostic[];
}): void {
  const joins = records(isRecord(args.document.orchestration) ? args.document.orchestration.joins : undefined);
  const handoffs = records(args.document.handoffs);
  for (const [joinIndex, join] of joins.entries()) {
    if (typeof join.agentId !== "string" || typeof join.inputPort !== "string") continue;
    const targetPort = inputPortFor(args.document, join.agentId, join.inputPort);
    if (!targetPort) continue;
    const targetSchemaResolved = resolveSchema(targetPort.dataSchema, args.resolver, args.diagnostics, `/orchestration/joins/${joinIndex}`);
    const targetSchema = schemaObject(targetSchemaResolved.schema);
    if (!targetSchema) continue;
    const props = schemaObject(targetSchema.properties) ?? {};
    const required = Array.isArray(targetSchema.required) ? targetSchema.required.filter((item): item is string => typeof item === "string") : [];
    const sources = (Array.isArray(join.handoffIds) ? join.handoffIds : []).map((id) => handoffs.find((handoff) => handoff.id === id)).filter((item): item is RecordValue => Boolean(item));
    const base = isRecord(join.baseMapping) && isRecord(join.baseMapping.data) ? join.baseMapping.data : {};
    const providerCount = new Map<string, number>();
    for (const key of Object.keys(base)) providerCount.set(key, (providerCount.get(key) ?? 0) + 1);
    const syntheticBaseHandoff: RecordValue = {
      id: `join-base-${String(join.id)}`,
      from: { kind: "run" },
      to: { kind: "agent", agentId: join.agentId, inputPort: join.inputPort },
      map: join.baseMapping
    };
    for (const [field, expression] of Object.entries(base)) {
      const fieldSchema = targetFieldSchema(targetSchema, field);
      if (fieldSchema === undefined) {
        addDiagnostic(args.diagnostics, "IR_MAPPING_TARGET_FIELD_UNKNOWN", `/orchestration/joins/${joinIndex}/baseMapping/data/${pointerPart(field)}`, `Join baseMapping targets undeclared field '${field}'.`);
        continue;
      }
      validateExpression({
        expression,
        targetSchema: fieldSchema,
        targetResource: targetSchemaResolved.resourcePath,
        handoff: syntheticBaseHandoff,
        document: args.document,
        resolver: args.resolver,
        diagnostics: args.diagnostics,
        pointer: `/orchestration/joins/${joinIndex}/baseMapping/data/${pointerPart(field)}`,
        targetRequired: required.includes(field),
        baseMapping: true
      });
    }
    for (const handoff of sources) {
      const mapping = isRecord(handoff.map) ? handoff.map : {};
      const fields = mappingFields(mapping.data);
      if (fields) {
        for (const [key, expression] of Object.entries(fields)) {
          providerCount.set(key, (providerCount.get(key) ?? 0) + 1);
          const fieldSchema = targetFieldSchema(targetSchema, key);
          if (fieldSchema === undefined) continue;
          const fieldRequired = required.includes(key);
          const sourceMayBeLate = join.mode === "quorum_of" && Number(join.threshold) < sources.length;
          const maySkip = handoffMaySkip(args.document, handoff) || sourceMayBeLate;
          if (join.mode === "quorum_of" && fieldRequired && maySkip) {
            addDiagnostic(args.diagnostics, "IR_QUORUM_FIELD_MUST_BE_OPTIONAL", `/handoffs/${handoffs.indexOf(handoff)}/map/data/${pointerPart(key)}`, `A non-guaranteed quorum source cannot contribute required field '${key}'.`);
          } else if (join.mode === "all_of" && fieldRequired && maySkip) {
            addDiagnostic(args.diagnostics, "IR_JOIN_CONDITIONAL_REQUIRED_SOURCE", `/handoffs/${handoffs.indexOf(handoff)}/map/data/${pointerPart(key)}`, `A conditionally skipped source cannot provide required Join field '${key}'.`);
          }
          validateExpression({
            expression,
            targetSchema: fieldSchema,
            targetResource: targetSchemaResolved.resourcePath,
            handoff,
            document: args.document,
            resolver: args.resolver,
            diagnostics: args.diagnostics,
            pointer: `/handoffs/${handoffs.indexOf(handoff)}/map/data/${pointerPart(key)}`,
            targetRequired: fieldRequired && !maySkip
          });
        }
      }
      else if (isRecord(mapping.data) && typeof mapping.data.$ref === "string") {
        const source = sourceForExpression({ expression: mapping.data, handoff, document: args.document, resolver: args.resolver, diagnostics: args.diagnostics, pointer: `/handoffs/${handoffs.indexOf(handoff)}/map/data` });
        if (source?.schema && isRecord(source.schema)) {
          const sourceProperties = schemaObject(source.schema.properties) ?? {};
          const sourceRequired = Array.isArray(source.schema.required) ? source.schema.required : [];
          for (const key of Object.keys(props)) {
            if (!Object.prototype.hasOwnProperty.call(sourceProperties, key)) continue;
            providerCount.set(key, (providerCount.get(key) ?? 0) + 1);
            const fieldRequired = required.includes(key);
            const sourceMayBeLate = join.mode === "quorum_of" && Number(join.threshold) < sources.length;
            const maySkip = handoffMaySkip(args.document, handoff) || sourceMayBeLate;
            if (fieldRequired && (!sourceRequired.includes(key) || maySkip)) {
              addDiagnostic(args.diagnostics, join.mode === "quorum_of" ? "IR_QUORUM_FIELD_MUST_BE_OPTIONAL" : "IR_JOIN_CONDITIONAL_REQUIRED_SOURCE", `/handoffs/${handoffs.indexOf(handoff)}/map/data`, `This source cannot guarantee required Join field '${key}'.`);
            }
            validateExpression({ expression: { "$ref": mapping.data.$ref }, targetSchema: props[key], targetResource: targetSchemaResolved.resourcePath, handoff, document: args.document, resolver: args.resolver, diagnostics: args.diagnostics, pointer: `/handoffs/${handoffs.indexOf(handoff)}/map/data/${pointerPart(key)}`, targetRequired: fieldRequired && !maySkip });
          }
        }
      }
    }
    for (const [field, count] of providerCount) {
      if (!Object.prototype.hasOwnProperty.call(props, field) && targetSchema.additionalProperties === false) {
        addDiagnostic(args.diagnostics, "IR_MAPPING_TARGET_FIELD_UNKNOWN", `/orchestration/joins/${joinIndex}`, `Join contributes undeclared target field '${field}'.`);
      }
      if (count > 1) addDiagnostic(args.diagnostics, "IR_JOIN_FIELD_CONFLICT", `/orchestration/joins/${joinIndex}`, `Target field '${field}' has ${count} providers.`);
    }
    for (const field of required) {
      const count = providerCount.get(field) ?? 0;
      if (count === 0) addDiagnostic(args.diagnostics, "IR_JOIN_REQUIRED_FIELD_MISSING", `/orchestration/joins/${joinIndex}`, `Required Join target field '${field}' has no provider.`);
    }

    const targetSlots = isRecord(targetPort.artifactSlots) ? targetPort.artifactSlots : {};
    const artifactProviders = new Map<string, number>();
    const baseArtifacts = isRecord(join.baseMapping) && isRecord(join.baseMapping.artifacts) ? join.baseMapping.artifacts : {};
    for (const [slot, expression] of Object.entries(baseArtifacts)) {
      artifactProviders.set(slot, (artifactProviders.get(slot) ?? 0) + 1);
      validateArtifactMapping({ mapping: { artifacts: { [slot]: expression } }, handoff: syntheticBaseHandoff, document: args.document, targetSlots, diagnostics: args.diagnostics, handoffIndex: -joinIndex - 1, resolver: args.resolver, baseMapping: true });
    }
    for (const handoff of sources) {
      const mapping = isRecord(handoff.map) && isRecord(handoff.map.artifacts) ? handoff.map.artifacts : {};
      for (const [slot, expression] of Object.entries(mapping)) {
        artifactProviders.set(slot, (artifactProviders.get(slot) ?? 0) + 1);
        const targetSlot = targetSlots[slot];
        const sourceMayBeLate = join.mode === "quorum_of" && Number(join.threshold) < sources.length;
        if (isRecord(targetSlot) && targetSlot.required === true && (handoffMaySkip(args.document, handoff) || sourceMayBeLate)) {
          addDiagnostic(args.diagnostics, join.mode === "quorum_of" ? "IR_QUORUM_FIELD_MUST_BE_OPTIONAL" : "IR_JOIN_CONDITIONAL_REQUIRED_SOURCE", `/handoffs/${handoffs.indexOf(handoff)}/map/artifacts/${pointerPart(slot)}`, `A non-guaranteed source cannot provide required Join Artifact slot '${slot}'.`);
        }
        validateArtifactMapping({ mapping: { artifacts: { [slot]: expression } }, handoff, document: args.document, targetSlots, diagnostics: args.diagnostics, handoffIndex: handoffs.indexOf(handoff), resolver: args.resolver });
      }
    }
    for (const [slot, count] of artifactProviders) {
      if (!Object.prototype.hasOwnProperty.call(targetSlots, slot)) addDiagnostic(args.diagnostics, "IR_MAPPING_ARTIFACT_TARGET_UNKNOWN", `/orchestration/joins/${joinIndex}`, `Join contributes undeclared Artifact slot '${slot}'.`);
      if (count > 1) addDiagnostic(args.diagnostics, "IR_JOIN_FIELD_CONFLICT", `/orchestration/joins/${joinIndex}`, `Artifact slot '${slot}' has ${count} providers.`);
    }
    for (const [slot, spec] of Object.entries(targetSlots)) {
      if (isRecord(spec) && spec.required === true && !artifactProviders.has(slot)) addDiagnostic(args.diagnostics, "IR_JOIN_REQUIRED_FIELD_MISSING", `/orchestration/joins/${joinIndex}`, `Required Join Artifact slot '${slot}' has no provider.`);
    }
  }
}

function validateConditionValueReferences(args: {
  value: unknown;
  handoff: RecordValue;
  routeRoot: string;
  document: TeamIrDocument;
  resolver: TeamSchemaResolver;
  diagnostics: TeamIrDiagnostic[];
  pointer: string;
  existsAllowed?: boolean;
}): void {
  const { value, handoff, routeRoot, document, resolver, diagnostics, pointer } = args;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateConditionValueReferences({ ...args, value: item, pointer: `${pointer}/${index}` }));
    return;
  }
  if (!isRecord(value)) return;
  if (Object.prototype.hasOwnProperty.call(value, "$literal")) return;
  if (Object.prototype.hasOwnProperty.call(value, "$ref")) {
    if (Object.keys(value).length !== 1 || typeof value.$ref !== "string") {
      addDiagnostic(diagnostics, "IR_ROUTE_CONDITION_INVALID", pointer, "Condition references must be a single-key $ref expression.");
      return;
    }
    let parsed: ParsedTeamReference;
    try {
      parsed = parseTeamReference(value.$ref);
    } catch (error) {
      addDiagnostic(diagnostics, "IR_MAPPING_REF_INVALID", pointer, String(error));
      return;
    }
    if (parsed.root !== routeRoot && !(routeRoot === "output" && parsed.root === "review")) {
      addDiagnostic(diagnostics, "IR_MAPPING_REF_SCOPE_INVALID", pointer, `Route condition source '${routeRoot}' cannot read $.${parsed.root} references.`);
      return;
    }
    const source = sourceForReference({ document, reference: parsed, handoff, resolver, diagnostics, pointer });
    if (source && !source.guaranteed && !args.existsAllowed) {
      addDiagnostic(diagnostics, "IR_ROUTE_CONDITION_INPUT_MAY_BE_MISSING", pointer, "Condition references an optional value; guard it with exists or use a condition that is safe for a missing path.", "warning");
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    validateConditionValueReferences({ ...args, value: child, pointer: `${pointer}/${pointerPart(key)}` });
  }
}

function validateConditionAstReferences(args: {
  condition: unknown;
  handoff: RecordValue;
  routeRoot: string;
  document: TeamIrDocument;
  resolver: TeamSchemaResolver;
  diagnostics: TeamIrDiagnostic[];
  pointer: string;
}): void {
  const condition = args.condition;
  if (!isRecord(condition) || typeof condition.op !== "string" || !Array.isArray(condition.args)) {
    addDiagnostic(args.diagnostics, "IR_ROUTE_CONDITION_INVALID", args.pointer, "Condition must have an operator and an args array.");
    return;
  }
  const op = condition.op;
  const children = condition.args;
  const allowedKeys = new Set(["op", "args"]);
  if (Object.keys(condition).some((key) => !allowedKeys.has(key))) {
    addDiagnostic(args.diagnostics, "IR_ROUTE_CONDITION_INVALID", args.pointer, "Condition has unsupported fields.");
  }
  if (op === "equals" || op === "notEquals") {
    if (children.length !== 2) addDiagnostic(args.diagnostics, "IR_ROUTE_CONDITION_INVALID", args.pointer, `${op} requires exactly two ValueExpr arguments.`);
    for (const [index, child] of children.entries()) {
      validateConditionValueReferences({ ...args, value: child, pointer: `${args.pointer}/args/${index}` });
    }
    return;
  }
  if (op === "exists") {
    const reference = children.length === 1 ? children[0] : undefined;
    if (!isRecord(reference) || Object.keys(reference).length !== 1 || typeof reference.$ref !== "string") {
      addDiagnostic(args.diagnostics, "IR_ROUTE_CONDITION_INVALID", args.pointer, "exists requires exactly one $ref argument.");
      return;
    }
    validateConditionValueReferences({ ...args, value: reference, pointer: `${args.pointer}/args/0`, existsAllowed: true });
    return;
  }
  if (op === "not") {
    if (children.length !== 1) addDiagnostic(args.diagnostics, "IR_ROUTE_CONDITION_INVALID", args.pointer, "not requires exactly one Condition argument.");
    for (const [index, child] of children.entries()) validateConditionAstReferences({ ...args, condition: child, pointer: `${args.pointer}/args/${index}` });
    return;
  }
  if (op === "and" || op === "or") {
    if (children.length < 1) addDiagnostic(args.diagnostics, "IR_ROUTE_CONDITION_INVALID", args.pointer, `${op} requires at least one Condition argument.`);
    for (const [index, child] of children.entries()) validateConditionAstReferences({ ...args, condition: child, pointer: `${args.pointer}/args/${index}` });
    return;
  }
  addDiagnostic(args.diagnostics, "IR_ROUTE_CONDITION_INVALID", `${args.pointer}/op`, `Unsupported condition operator '${op}'.`);
}

function validateRouteConditionReferences(args: {
  document: TeamIrDocument;
  resolver: TeamSchemaResolver;
  diagnostics: TeamIrDiagnostic[];
}): void {
  const orchestration = isRecord(args.document.orchestration) ? args.document.orchestration : {};
  const routes = records(orchestration.routes);
  const handoffs = records(args.document.handoffs);
  for (const [routeIndex, route] of routes.entries()) {
    const from = isRecord(route.from) ? route.from : {};
    const routeRoot = from.kind === "run" ? "run" : "output";
    const candidates = Array.isArray(route.handoffIds) ? route.handoffIds : [];
    for (const id of candidates) {
      const handoff = handoffs.find((item) => item.id === id);
      const when = handoff && isRecord(handoff.when) ? handoff.when : undefined;
      if (!when || when.condition === undefined) continue;
      const conditionHandoff: RecordValue = { from, to: { kind: "result" } };
      validateConditionAstReferences({
        condition: when.condition,
        handoff: conditionHandoff,
        routeRoot,
        document: args.document,
        resolver: args.resolver,
        diagnostics: args.diagnostics,
        pointer: `/handoffs/${handoffs.indexOf(handoff!)}/when/condition`
      });
    }
  }
}

/** Validate mapping references, schema paths, field coverage, type direction and Artifact slots. */
export function validateTeamIrMappings(args: {
  document: TeamIrDocument;
  resolver: TeamSchemaResolver;
}): TeamIrDiagnostic[] {
  const diagnostics: TeamIrDiagnostic[] = [];
  const handoffs = records(args.document.handoffs);
  const joins = records(isRecord(args.document.orchestration) ? args.document.orchestration.joins : undefined);
  const joinSourceIds = new Set(joins.flatMap((join) => Array.isArray(join.handoffIds) ? join.handoffIds.filter((id): id is string => typeof id === "string") : []));

  for (const [handoffIndex, handoff] of handoffs.entries()) {
    const destination = destinationForHandoff(args.document, handoff);
    const mapping = isRecord(handoff.map) ? handoff.map : {};
    const mapPointer = `/handoffs/${handoffIndex}/map/data`;
    if (destination.dataSchema !== undefined) {
      const targetResolved = resolveSchema(destination.dataSchema, args.resolver, diagnostics, mapPointer);
      const targetSchema = schemaObject(targetResolved.schema);
      const data = mapping.data;
      const partialJoinContribution = typeof handoff.id === "string" && joinSourceIds.has(handoff.id);
      if (targetSchema && isRecord(data) && !Object.prototype.hasOwnProperty.call(data, "$ref") && !Object.prototype.hasOwnProperty.call(data, "$literal")) {
        const properties = schemaObject(targetSchema.properties) ?? {};
        const required = Array.isArray(targetSchema.required) ? targetSchema.required.filter((item): item is string => typeof item === "string") : [];
        if (!partialJoinContribution) {
          for (const field of required) {
            if (!Object.prototype.hasOwnProperty.call(data, field)) addDiagnostic(diagnostics, "IR_MAPPING_REQUIRED_FIELD_MISSING", `${mapPointer}/${pointerPart(field)}`, `Required target field '${field}' has no provider.`);
          }
        }
        for (const [field, expression] of Object.entries(data)) {
          const targetFieldSchema = properties[field];
          if (targetFieldSchema === undefined) {
            if (targetSchema.additionalProperties === false) addDiagnostic(diagnostics, "IR_MAPPING_TARGET_FIELD_UNKNOWN", `${mapPointer}/${pointerPart(field)}`, `Target Schema does not declare field '${field}'.`);
            else if (targetSchema.additionalProperties && targetSchema.additionalProperties !== true) {
              validateExpression({ expression, targetSchema: targetSchema.additionalProperties, targetResource: targetResolved.resourcePath, handoff, document: args.document, resolver: args.resolver, diagnostics, pointer: `${mapPointer}/${pointerPart(field)}`, targetRequired: false });
            } else addDiagnostic(diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", `${mapPointer}/${pointerPart(field)}`, `Target field '${field}' is not covered by a closed Schema property; validate before delivery.`, "warning");
          } else {
            validateExpression({ expression, targetSchema: targetFieldSchema, targetResource: targetResolved.resourcePath, handoff, document: args.document, resolver: args.resolver, diagnostics, pointer: `${mapPointer}/${pointerPart(field)}`, targetRequired: required.includes(field) && !partialJoinContribution });
          }
        }
      } else if (data !== undefined) {
        validateExpression({ expression: data, targetSchema: destination.dataSchema, handoff, document: args.document, resolver: args.resolver, diagnostics, pointer: mapPointer, targetRequired: !partialJoinContribution });
      } else if (!partialJoinContribution && targetSchema && Array.isArray(targetSchema.required) && targetSchema.required.length > 0) {
        addDiagnostic(diagnostics, "IR_MAPPING_REQUIRED_FIELD_MISSING", mapPointer, "Required target data fields have no mapping.");
      }
      if (targetResolved.uncertain) addDiagnostic(diagnostics, "IR_MAPPING_RUNTIME_CHECK_REQUIRED", mapPointer, "The complete target Schema requires runtime validation before delivery.", "warning");
    }
    validateArtifactMapping({ mapping, handoff, document: args.document, targetSlots: destination.artifactSlots, diagnostics, handoffIndex, resolver: args.resolver });
  }

  validateRouteConditionReferences({ document: args.document, resolver: args.resolver, diagnostics });
  validateJoinContributions({ document: args.document, resolver: args.resolver, diagnostics });
  return diagnostics;
}
