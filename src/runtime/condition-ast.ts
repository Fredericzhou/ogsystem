import type { SemanticIRConditionAst, SemanticIRValueRef } from "./semantic-ir.js";

export type RoutableTransition = {
  flowId: string;
  eventType: string;
  toRoleId: string;
  priority: number;
  condition?: SemanticIRConditionAst;
};

export type SemanticRouteDecisionCandidate = { flowId: string; priority: number; matched?: boolean };

export class SemanticRouteSelectionError extends Error {
  constructor(
    readonly code: "IR_ROUTE_NO_CANDIDATE" | "IR_ROUTE_NO_MATCH" | "IR_ROUTE_AMBIGUOUS" | "IR_ROUTE_CONDITION_EVALUATION_FAILED",
    message: string,
    readonly candidates: SemanticRouteDecisionCandidate[] = []
  ) {
    super(message);
    this.name = "SemanticRouteSelectionError";
  }
}

export type ConditionContext = {
  state: unknown;
  loop: unknown;
  event: unknown;
  role: unknown;
};

export function resolveConditionValue(ref: SemanticIRValueRef, context: ConditionContext): unknown {
  if (ref.kind === "literal") return ref.value;
  let value = context[ref.root];
  for (const segment of ref.path) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      throw new Error(`Invalid condition path segment: ${segment}`);
    }
    if (value === null || typeof value !== "object" || !(segment in value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function compare(op: "equals" | "in" | "greater_than" | "less_than", left: unknown, right: unknown): boolean {
  if (op === "equals") return Object.is(left, right);
  if (op === "in") return Array.isArray(right) && right.some((entry) => Object.is(entry, left));
  if (typeof left !== "number" || typeof right !== "number" || Number.isNaN(left) || Number.isNaN(right)) {
    throw new Error(`${op} requires finite numeric values`);
  }
  return op === "greater_than" ? left > right : left < right;
}

export function evaluateCondition(ast: SemanticIRConditionAst, context: ConditionContext): boolean {
  switch (ast.op) {
    case "equals":
    case "in":
    case "greater_than":
    case "less_than":
      return compare(ast.op, resolveConditionValue(ast.args[0], context), resolveConditionValue(ast.args[1], context));
    case "exists":
      return resolveConditionValue(ast.args[0], context) !== undefined;
    case "not":
      return !evaluateCondition(ast.args[0], context);
    case "all":
      return ast.args.every((child) => evaluateCondition(child, context));
    case "any":
      return ast.args.some((child) => evaluateCondition(child, context));
  }
}

export function validateConditionAst(ast: unknown, path = "condition"): string[] {
  if (!ast || typeof ast !== "object" || Array.isArray(ast)) return [`${path} must be an object`];
  const value = ast as Record<string, unknown>;
  const op = value.op;
  const onlyKeys = (candidate: Record<string, unknown>, allowed: string[]) =>
    Object.keys(candidate).every((key) => allowed.includes(key));
  if (!["equals", "in", "greater_than", "less_than", "exists", "not", "all", "any"].includes(String(op))) {
    return [`${path}.op is not allowed`];
  }
  if (!onlyKeys(value, ["op", "args"])) return [`${path} contains an unsupported field`];
  if (op === "not") {
    if (!Array.isArray(value.args) || value.args.length !== 1) return [`${path}.args must contain 1 item(s)`];
    return validateConditionAst(value.args[0], `${path}.args[0]`);
  }
  if (op === "all" || op === "any") {
    if (!Array.isArray(value.args) || value.args.length === 0) return [`${path}.args must be non-empty`];
    return value.args.flatMap((child, index) => validateConditionAst(child, `${path}.args[${index}]`));
  }
  const expected = op === "exists" ? 1 : 2;
  if (!Array.isArray(value.args) || value.args.length !== expected) return [`${path}.args must contain ${expected} item(s)`];
  return (value.args as unknown[]).flatMap((ref, index) => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return [`${path}.args[${index}] must be a value reference`];
    const candidate = ref as Record<string, unknown>;
    if (candidate.kind === "literal") {
      const literal = candidate.value;
      const scalar = literal === null || typeof literal === "string" || typeof literal === "boolean" ||
        (typeof literal === "number" && Number.isFinite(literal));
      if (!onlyKeys(candidate, ["kind", "value"]) || !Object.prototype.hasOwnProperty.call(candidate, "value") || !scalar) {
        return [`${path}.args[${index}] contains an invalid literal`];
      }
      return [];
    }
    if (!onlyKeys(candidate, ["kind", "root", "path"]) || candidate.kind !== "path" ||
      !["state", "loop", "event", "role"].includes(String(candidate.root)) || !Array.isArray(candidate.path)) {
      return [`${path}.args[${index}] contains an invalid value reference`];
    }
    if (!(candidate.path as unknown[]).every((segment) => typeof segment === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) {
      return [`${path}.args[${index}].path contains an invalid segment`];
    }
    return [];
  });
}

/** Selects one deterministic route; ambiguity and evaluation errors fail closed. */
export function selectSemanticRoute(args: {
  transitions: RoutableTransition[];
  eventType: string;
  context: ConditionContext;
}): RoutableTransition {
  const candidates = args.transitions.filter((transition) => transition.eventType === args.eventType);
  if (candidates.length === 0) {
    throw new SemanticRouteSelectionError("IR_ROUTE_NO_CANDIDATE", `No route for event ${args.eventType}`);
  }
  const evaluations: SemanticRouteDecisionCandidate[] = [];
  const matching = candidates.filter((transition) => {
    try {
      const matched = transition.condition ? evaluateCondition(transition.condition, args.context) : true;
      evaluations.push({ flowId: transition.flowId, priority: transition.priority, matched });
      return matched;
    } catch (error) {
      evaluations.push({ flowId: transition.flowId, priority: transition.priority });
      throw new SemanticRouteSelectionError(
        "IR_ROUTE_CONDITION_EVALUATION_FAILED",
        error instanceof Error ? error.message : String(error),
        evaluations
      );
    }
  });
  if (matching.length === 0) {
    throw new SemanticRouteSelectionError("IR_ROUTE_NO_MATCH", `No condition matched event ${args.eventType}`, evaluations);
  }
  const highest = Math.max(...matching.map((transition) => transition.priority));
  const winners = matching.filter((transition) => transition.priority === highest);
  if (winners.length !== 1) {
    throw new SemanticRouteSelectionError("IR_ROUTE_AMBIGUOUS", `Ambiguous routes for event ${args.eventType} at priority ${highest}`, evaluations);
  }
  return winners[0];
}
