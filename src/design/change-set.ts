import { createHash, randomUUID } from "node:crypto";

import type {
  ChangeSet,
  DesignDiagnostic,
  DesignOperation,
  DesignValidationResult,
  SystemDesignDocument
} from "./types.js";

const SEAT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const EVENT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function diagnostic(
  code: string,
  message: string,
  path?: string,
  extra?: Partial<DesignDiagnostic>
): DesignDiagnostic {
  return { code, severity: "error", message, path, ...extra };
}

function transitionKey(transition: { fromSeatId: string; toSeatId: string; eventType: string }): string {
  return `${transition.fromSeatId}:${transition.eventType}:${transition.toSeatId}`;
}

export function createEmptySystemDesign(args: Partial<SystemDesignDocument["system"]> = {}): SystemDesignDocument {
  return {
    schemaVersion: 1,
    revision: 0,
    intent: {
      objective: "",
      inputs: [],
      outputs: [],
      constraints: [],
      acceptanceCriteria: []
    },
    system: {
      systemId: args.systemId ?? "ogs.system",
      systemVersion: args.systemVersion ?? "1.0.0",
      entrySeatId: args.entrySeatId ?? "",
      entryEventType: args.entryEventType ?? "START",
      lawGlobalRef: args.lawGlobalRef ?? "law.global"
    },
    seats: {},
    transitions: [],
    state: { schemaVersion: 1 },
    contracts: [],
    policies: {},
    bindings: {},
    presentation: { nodes: {} }
  };
}

export function validateSystemDesign(design: SystemDesignDocument): DesignValidationResult {
  const diagnostics: DesignDiagnostic[] = [];
  if (!design || typeof design !== "object") {
    return { ok: false, diagnostics: [diagnostic("DESIGN_DOCUMENT_REQUIRED", "A design document is required.")] };
  }
  if (design.schemaVersion !== 1) {
    diagnostics.push(diagnostic("DESIGN_SCHEMA_VERSION_UNSUPPORTED", "Only System Design schema version 1 is supported.", "schemaVersion"));
  }
  if (!Number.isInteger(design.revision) || design.revision < 0) {
    diagnostics.push(diagnostic("DESIGN_REVISION_INVALID", "revision must be a non-negative integer.", "revision"));
  }
  const seatIds = new Set(Object.keys(design.seats ?? {}));
  if (!design.system?.systemId?.trim()) diagnostics.push(diagnostic("DESIGN_SYSTEM_ID_REQUIRED", "system.systemId is required.", "system.systemId"));
  if (!design.system?.entrySeatId) diagnostics.push(diagnostic("DESIGN_ENTRY_REQUIRED", "system.entrySeatId is required.", "system.entrySeatId"));
  if (design.system?.entrySeatId && !seatIds.has(design.system.entrySeatId)) {
    diagnostics.push(diagnostic("DESIGN_ENTRY_UNKNOWN", `Entry seat "${design.system.entrySeatId}" does not exist.`, "system.entrySeatId"));
  }
  for (const [seatId, seat] of Object.entries(design.seats ?? {})) {
    if (seatId !== seat.seatId) diagnostics.push(diagnostic("DESIGN_SEAT_KEY_MISMATCH", `Seat key "${seatId}" does not match seatId.`, `seats.${seatId}.seatId`, { seatId }));
    if (!SEAT_ID_PATTERN.test(seatId)) diagnostics.push(diagnostic("DESIGN_SEAT_ID_INVALID", `Seat id "${seatId}" is invalid.`, `seats.${seatId}`, { seatId }));
    if (!seat.rolePackageRef?.trim()) diagnostics.push(diagnostic("DESIGN_ROLE_PACKAGE_REQUIRED", `Seat "${seatId}" requires a role package.`, `seats.${seatId}.rolePackageRef`, { seatId }));
    const indexedBinding = design.bindings?.[seatId];
    if (!indexedBinding) {
      diagnostics.push(diagnostic("DESIGN_BINDING_INDEX_MISSING", `Seat "${seatId}" is missing from the top-level bindings index.`, `bindings.${seatId}`, { seatId }));
    } else if (!sameJson(indexedBinding, seat.binding)) {
      diagnostics.push(diagnostic("DESIGN_BINDING_INDEX_MISMATCH", `Binding index entry for seat "${seatId}" does not match the seat binding.`, `bindings.${seatId}`, { seatId }));
    }
    if (seat.join) {
      if (!seat.join.sources.length) diagnostics.push(diagnostic("DESIGN_JOIN_SOURCES_REQUIRED", `Join seat "${seatId}" requires at least one source.`, `seats.${seatId}.join.sources`, { seatId }));
      if (seat.join.sources.some((source) => !seatIds.has(source))) diagnostics.push(diagnostic("DESIGN_JOIN_SOURCE_UNKNOWN", `Join seat "${seatId}" references an unknown source.`, `seats.${seatId}.join.sources`, { seatId }));
      if (seat.join.mode === "quorum_of" && (!Number.isInteger(seat.join.min) || (seat.join.min ?? 0) < 1 || (seat.join.min ?? 0) > seat.join.sources.length)) diagnostics.push(diagnostic("DESIGN_JOIN_MIN_INVALID", `Join seat "${seatId}" has an invalid quorum minimum.`, `seats.${seatId}.join.min`, { seatId }));
    }
    if (seat.loop && (!Number.isInteger(seat.loop.maxRounds) || seat.loop.maxRounds < 1)) diagnostics.push(diagnostic("DESIGN_LOOP_MAX_INVALID", `Loop seat "${seatId}" requires a positive maxRounds.`, `seats.${seatId}.loop.maxRounds`, { seatId }));
  }
  for (const seatId of Object.keys(design.bindings ?? {})) {
    if (!seatIds.has(seatId)) diagnostics.push(diagnostic("DESIGN_BINDING_INDEX_EXTRA", `Bindings index contains an entry for unknown seat "${seatId}".`, `bindings.${seatId}`, { seatId }));
  }
  const transitionIds = new Set<string>();
  const transitionKeys = new Set<string>();
  for (const transition of design.transitions ?? []) {
    if (transitionIds.has(transition.transitionId)) diagnostics.push(diagnostic("DESIGN_TRANSITION_ID_DUPLICATE", `Transition id "${transition.transitionId}" is duplicated.`, "transitions", { transitionId: transition.transitionId }));
    transitionIds.add(transition.transitionId);
    if (!seatIds.has(transition.fromSeatId)) diagnostics.push(diagnostic("DESIGN_TRANSITION_SOURCE_UNKNOWN", `Transition source "${transition.fromSeatId}" does not exist.`, `transitions.${transition.transitionId}.fromSeatId`, { transitionId: transition.transitionId }));
    if (transition.toSeatId !== "__system_end__" && !seatIds.has(transition.toSeatId)) diagnostics.push(diagnostic("DESIGN_TRANSITION_TARGET_UNKNOWN", `Transition target "${transition.toSeatId}" does not exist.`, `transitions.${transition.transitionId}.toSeatId`, { transitionId: transition.transitionId }));
    if (!EVENT_PATTERN.test(transition.eventType)) diagnostics.push(diagnostic("DESIGN_EVENT_INVALID", `Event "${transition.eventType}" must use uppercase snake case.`, `transitions.${transition.transitionId}.eventType`, { transitionId: transition.transitionId }));
    const key = transitionKey(transition);
    if (transitionKeys.has(key)) diagnostics.push(diagnostic("DESIGN_TRANSITION_DUPLICATE", `Transition "${key}" is duplicated.`, "transitions", { transitionId: transition.transitionId }));
    transitionKeys.add(key);
  }
  return { ok: diagnostics.length === 0, diagnostics, design };
}

function applyOperation(design: SystemDesignDocument, operation: DesignOperation): void {
  switch (operation.type) {
    case "addSeat":
      if (design.seats[operation.seat.seatId]) throw new Error(`DESIGN_SEAT_EXISTS:${operation.seat.seatId}`);
      design.seats[operation.seat.seatId] = clone(operation.seat);
      design.bindings[operation.seat.seatId] = clone(operation.seat.binding);
      if (operation.layout) design.presentation.nodes[operation.seat.seatId] = clone(operation.layout);
      return;
    case "updateSeat": {
      const seat = design.seats[operation.seatId];
      if (!seat) throw new Error(`DESIGN_SEAT_NOT_FOUND:${operation.seatId}`);
      design.seats[operation.seatId] = { ...seat, ...clone(operation.patch), seatId: operation.seatId };
      design.bindings[operation.seatId] = clone(design.seats[operation.seatId].binding);
      return;
    }
    case "deleteSeat":
      if (!design.seats[operation.seatId]) throw new Error(`DESIGN_SEAT_NOT_FOUND:${operation.seatId}`);
      if (design.system.entrySeatId === operation.seatId) throw new Error(`DESIGN_ENTRY_DELETE_BLOCKED:${operation.seatId}`);
      delete design.seats[operation.seatId];
      delete design.bindings[operation.seatId];
      design.transitions = design.transitions.filter((transition) => transition.fromSeatId !== operation.seatId && transition.toSeatId !== operation.seatId);
      delete design.presentation.nodes[operation.seatId];
      return;
    case "addTransition":
      design.transitions.push(clone(operation.transition));
      return;
    case "updateTransition": {
      const index = design.transitions.findIndex((transition) => transition.transitionId === operation.transitionId);
      if (index < 0) throw new Error(`DESIGN_TRANSITION_NOT_FOUND:${operation.transitionId}`);
      design.transitions[index] = { ...design.transitions[index], ...clone(operation.patch), transitionId: operation.transitionId };
      return;
    }
    case "deleteTransition": {
      const before = design.transitions.length;
      design.transitions = design.transitions.filter((transition) => transition.transitionId !== operation.transitionId);
      if (before === design.transitions.length) throw new Error(`DESIGN_TRANSITION_NOT_FOUND:${operation.transitionId}`);
      return;
    }
    case "setJoinPolicy": {
      const seat = design.seats[operation.seatId];
      if (!seat) throw new Error(`DESIGN_SEAT_NOT_FOUND:${operation.seatId}`);
      seat.join = operation.join ? clone(operation.join) : undefined;
      return;
    }
    case "setLoopPolicy": {
      const seat = design.seats[operation.seatId];
      if (!seat) throw new Error(`DESIGN_SEAT_NOT_FOUND:${operation.seatId}`);
      seat.loop = operation.loop ? clone(operation.loop) : undefined;
      return;
    }
    case "setReviewPolicy": {
      const seat = design.seats[operation.seatId];
      if (!seat) throw new Error(`DESIGN_SEAT_NOT_FOUND:${operation.seatId}`);
      seat.review = operation.review ? clone(operation.review) : undefined;
      return;
    }
    case "setContextMapping": {
      const seat = design.seats[operation.seatId];
      if (!seat) throw new Error(`DESIGN_SEAT_NOT_FOUND:${operation.seatId}`);
      seat.contextMap = clone(operation.contextMap);
      return;
    }
    case "bindModel": {
      const seat = design.seats[operation.seatId];
      if (!seat) throw new Error(`DESIGN_SEAT_NOT_FOUND:${operation.seatId}`);
      seat.binding = { kind: "model", modelRef: operation.modelRef };
      design.bindings[operation.seatId] = clone(seat.binding);
      return;
    }
    case "bindTool": {
      const seat = design.seats[operation.seatId];
      if (!seat) throw new Error(`DESIGN_SEAT_NOT_FOUND:${operation.seatId}`);
      seat.binding = { kind: "exec", profileId: operation.profileId };
      design.bindings[operation.seatId] = clone(seat.binding);
      return;
    }
    case "setStateSchema":
      design.state = clone(operation.state);
      return;
    case "setContracts":
      design.contracts = clone(operation.contracts);
      return;
    case "setPolicies":
      design.policies = clone(operation.policies);
      return;
    case "setBindings":
      design.bindings = clone(operation.bindings);
      return;
    case "setSystem":
      design.system = clone(operation.system);
      return;
    case "setIntent":
      design.intent = clone(operation.intent);
      return;
    case "setPresentation":
      design.presentation = clone(operation.presentation);
      return;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Build a reviewable ChangeSet from a generated design preview. */
export function diffSystemDesign(args: {
  current: SystemDesignDocument;
  proposed: SystemDesignDocument;
  summary?: string;
  assumptions?: ChangeSet["assumptions"];
}): ChangeSet {
  const operations: DesignOperation[] = [];
  const currentSeatIds = new Set(Object.keys(args.current.seats));
  const proposedSeatIds = new Set(Object.keys(args.proposed.seats));
  for (const seatId of [...proposedSeatIds].sort()) {
    const seat = args.proposed.seats[seatId];
    if (!currentSeatIds.has(seatId)) {
      operations.push({ type: "addSeat", seat, layout: args.proposed.presentation.nodes[seatId] });
    } else if (!sameJson(args.current.seats[seatId], seat)) {
      const { seatId: ignored, ...patch } = seat;
      void ignored;
      operations.push({ type: "updateSeat", seatId, patch });
    }
  }
  for (const seatId of [...currentSeatIds].filter((id) => !proposedSeatIds.has(id)).sort()) {
    operations.push({ type: "deleteSeat", seatId });
  }

  const currentTransitions = new Map(args.current.transitions.map((item) => [item.transitionId, item]));
  const proposedTransitions = new Map(args.proposed.transitions.map((item) => [item.transitionId, item]));
  for (const [transitionId, transition] of proposedTransitions) {
    if (!currentTransitions.has(transitionId)) operations.push({ type: "addTransition", transition });
    else if (!sameJson(currentTransitions.get(transitionId), transition)) {
      const { transitionId: ignored, ...patch } = transition;
      void ignored;
      operations.push({ type: "updateTransition", transitionId, patch });
    }
  }
  for (const transitionId of [...currentTransitions.keys()].filter((id) => !proposedTransitions.has(id)).sort()) {
    operations.push({ type: "deleteTransition", transitionId });
  }
  if (!sameJson(args.current.system, args.proposed.system)) operations.push({ type: "setSystem", system: args.proposed.system });
  if (!sameJson(args.current.intent, args.proposed.intent)) operations.push({ type: "setIntent", intent: args.proposed.intent });
  if (!sameJson(args.current.state, args.proposed.state)) operations.push({ type: "setStateSchema", state: args.proposed.state });
  if (!sameJson(args.current.contracts, args.proposed.contracts)) operations.push({ type: "setContracts", contracts: args.proposed.contracts });
  if (!sameJson(args.current.policies, args.proposed.policies)) operations.push({ type: "setPolicies", policies: args.proposed.policies });
  if (!sameJson(args.current.bindings, args.proposed.bindings)) operations.push({ type: "setBindings", bindings: args.proposed.bindings });
  if (!sameJson(args.current.presentation, args.proposed.presentation)) operations.push({ type: "setPresentation", presentation: args.proposed.presentation });
  return createChangeSet({
    baseRevision: args.current.revision,
    summary: args.summary ?? "Refine the system design",
    operations,
    assumptions: args.assumptions
  });
}

export function applyChangeSet(args: {
  design: SystemDesignDocument;
  changeSet: ChangeSet;
}): DesignValidationResult {
  if (args.design.revision !== args.changeSet.baseRevision) {
    return {
      ok: false,
      diagnostics: [diagnostic("DESIGN_REVISION_CONFLICT", `ChangeSet targets revision ${args.changeSet.baseRevision}, current revision is ${args.design.revision}.`)]
    };
  }
  const next = clone(args.design);
  try {
    for (const operation of args.changeSet.operations) applyOperation(next, operation);
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic("DESIGN_OPERATION_REJECTED", error instanceof Error ? error.message : String(error))] };
  }
  next.revision += 1;
  const validation = validateSystemDesign(next);
  return validation.ok ? { ...validation, design: next } : validation;
}

export function createChangeSet(args: {
  baseRevision: number;
  summary: string;
  operations: DesignOperation[];
  assumptions?: ChangeSet["assumptions"];
}): ChangeSet {
  return {
    id: randomUUID(),
    baseRevision: args.baseRevision,
    summary: args.summary,
    assumptions: args.assumptions ?? [],
    operations: args.operations,
    affectedPaths: [],
    diagnostics: [],
    confidence: undefined
  };
}

export function designDigest(design: SystemDesignDocument): string {
  return createHash("sha256").update(JSON.stringify(design)).digest("hex");
}
