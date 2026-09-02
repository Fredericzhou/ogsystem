import type { SemanticIRConditionAst, SemanticIRValueRef } from "./semantic-ir.js";

export type RoutableTransition = {
  flowId: string;
  eventType: string;
  toRoleId: string;
  priority: number;
  condition?: SemanticIRConditionAst;
};

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
  if (!["equals", "in", "greater_than", "less_than", "exists", "not", "all", "any"].includes(String(op))) {
    return [`${path}.op is not allowed`];
  }
  if (op === "not") return validateConditionAst((value.args as unknown[])?.[0], `${path}.args[0]`);
  if (op === "all" || op === "any") {
    if (!Array.isArray(value.args) || value.args.length === 0) return [`${path}.args must be non-empty`];
    return value.args.flatMap((child, index) => validateConditionAst(child, `${path}.args[${index}]`));
  }
  const expected = op === "exists" ? 1 : 2;
  if (!Array.isArray(value.args) || value.args.length !== expected) return [`${path}.args must contain ${expected} item(s)`];
  return (value.args as unknown[]).flatMap((ref, index) => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return [`${path}.args[${index}] must be a value reference`];
    const candidate = ref as Record<string, unknown>;
    if (candidate.kind === "literal") return [];
    if (candidate.kind !== "path" || !["state", "loop", "event", "role"].includes(String(candidate.root)) || !Array.isArray(candidate.path)) {
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
  if (candidates.length === 0) throw new Error(`No route for event ${args.eventType}`);
  const matching = candidates.filter((transition) => transition.condition ? evaluateCondition(transition.condition, args.context) : true);
  if (matching.length === 0) throw new Error(`No condition matched event ${args.eventType}`);
  const highest = Math.max(...matching.map((transition) => transition.priority));
  const winners = matching.filter((transition) => transition.priority === highest);
  if (winners.length !== 1) throw new Error(`Ambiguous routes for event ${args.eventType} at priority ${highest}`);
  return winners[0];
}
