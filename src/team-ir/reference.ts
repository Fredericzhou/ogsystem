export type ReferenceSegment = string | number;
export type ReferenceRoot = "output" | "run" | "review" | "loop";

export type ParsedTeamReference = {
  root: ReferenceRoot;
  path: ReferenceSegment[];
  source: string;
};

export type TeamReferenceContext = Partial<Record<ReferenceRoot, unknown>>;
export type ResolvedTeamValue = { present: true; value: unknown } | { present: false };

export const MISSING_TEAM_VALUE: unique symbol = Symbol("team-ir-missing-value");
export type MissingTeamValue = typeof MISSING_TEAM_VALUE;

export class TeamReferenceError extends Error {
  constructor(message: string, readonly code = "IR_MAPPING_REF_INVALID") {
    super(message);
    this.name = "TeamReferenceError";
  }
}

const identifier = /^[A-Za-z_][A-Za-z0-9_-]*/;

function parseSegments(text: string, reference: string): ReferenceSegment[] {
  const segments: ReferenceSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === ".") {
      cursor += 1;
      const match = identifier.exec(text.slice(cursor));
      if (!match) throw new TeamReferenceError(`Invalid path segment in ${reference}`);
      segments.push(match[0]);
      cursor += match[0].length;
      continue;
    }
    if (text[cursor] === "[") {
      const match = /^\[(0|[1-9][0-9]*)\]/.exec(text.slice(cursor));
      if (!match) throw new TeamReferenceError(`Invalid array index in ${reference}`);
      const index = Number(match[1]);
      if (!Number.isSafeInteger(index)) throw new TeamReferenceError(`Array index is too large in ${reference}`);
      segments.push(index);
      cursor += match[0].length;
      continue;
    }
    throw new TeamReferenceError(`Invalid path syntax in ${reference}`);
  }
  return segments;
}

function requirePrefix(actual: ReferenceSegment[], expected: ReferenceSegment[], reference: string): void {
  if (expected.some((segment, index) => actual[index] !== segment)) {
    throw new TeamReferenceError(`Unsupported reference root in ${reference}`);
  }
}

/** Parses the closed Team IR reference syntax. Scope authorization is a compiler responsibility. */
export function parseTeamReference(reference: string): ParsedTeamReference {
  if (typeof reference !== "string" || !reference.startsWith("$")) {
    throw new TeamReferenceError("Reference must start with '$'");
  }
  if (!reference.startsWith("$.")) throw new TeamReferenceError(`Invalid reference root in ${reference}`);
  const path = parseSegments(reference.slice(1), reference);
  const root = path[0];
  const rest = path.slice(1);

  if (root === "output") {
    if (rest[0] === "event" && rest.length === 1) return { root, path: rest, source: reference };
    if (rest[0] === "data" && rest.length >= 2) return { root, path: rest, source: reference };
    if (rest[0] === "artifacts" && rest.length === 2 && typeof rest[1] === "string") return { root, path: rest, source: reference };
    throw new TeamReferenceError(`Unsupported output reference in ${reference}`);
  }
  if (root === "run") {
    if (rest[0] === "task" && rest.length === 1) return { root, path: rest, source: reference };
    if ((rest[0] === "input" || rest[0] === "preferences") && rest.length >= 2) return { root, path: rest, source: reference };
    if (rest[0] === "attachments" && rest.length === 2 && typeof rest[1] === "string") return { root, path: rest, source: reference };
    throw new TeamReferenceError(`Unsupported run reference in ${reference}`);
  }
  if (root === "review") {
    if (rest[0] === "decision" && rest.length === 1) return { root, path: rest, source: reference };
    if (rest[0] === "feedback" && rest.length >= 2) return { root, path: rest, source: reference };
    throw new TeamReferenceError(`Unsupported review reference in ${reference}`);
  }
  if (root === "loop") {
    requirePrefix(rest, ["previous"], reference);
    if (rest.length < 5 || typeof rest[1] !== "string" || rest[2] !== "output") {
      throw new TeamReferenceError(`Unsupported loop reference in ${reference}`);
    }
    const outputKind = rest[3];
    if (outputKind === "data" && rest.length >= 5) return { root, path: rest, source: reference };
    if (outputKind === "artifacts" && rest.length === 5 && typeof rest[4] === "string") return { root, path: rest, source: reference };
    throw new TeamReferenceError(`Unsupported loop reference in ${reference}`);
  }
  throw new TeamReferenceError(`Unsupported reference root in ${reference}`);
}

export function resolveTeamReference(reference: string | ParsedTeamReference, context: TeamReferenceContext): ResolvedTeamValue {
  const parsed = typeof reference === "string" ? parseTeamReference(reference) : reference;
  let value = context[parsed.root];
  if (value === undefined || value === null || typeof value !== "object") return { present: false };
  for (const segment of parsed.path) {
    if (value === null || typeof value !== "object") return { present: false };
    if (typeof segment === "number") {
      if (!Array.isArray(value) || segment >= value.length || !(segment in value)) return { present: false };
      value = value[segment];
      continue;
    }
    if (Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, segment)) return { present: false };
    value = (value as Record<string, unknown>)[segment];
  }
  return { present: true, value };
}

function ownKeys(value: Record<string, unknown>, expected: string[], location: string): void {
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) throw new TeamReferenceError(`Unexpected ${key} in ${location}`);
  }
}

/** Evaluates recursive ValueExpr mappings. Missing object members are omitted; null is retained. */
export function evaluateTeamValueExpr(expression: unknown, context: TeamReferenceContext): unknown | MissingTeamValue {
  if (Array.isArray(expression)) {
    return expression.map((item) => {
      const value = evaluateTeamValueExpr(item, context);
      if (value === MISSING_TEAM_VALUE) throw new TeamReferenceError("Array mapping items cannot be missing", "IR_MAPPING_SOURCE_MISSING");
      return value;
    });
  }
  if (expression === null || typeof expression !== "object") return expression;

  const record = expression as Record<string, unknown>;
  const hasRef = Object.prototype.hasOwnProperty.call(record, "$ref");
  const hasLiteral = Object.prototype.hasOwnProperty.call(record, "$literal");
  if (hasRef || hasLiteral) {
    if (hasRef && hasLiteral) throw new TeamReferenceError("ValueExpr cannot contain both $ref and $literal");
    if (hasRef) {
      ownKeys(record, ["$ref"], "ValueExpr");
      if (typeof record.$ref !== "string") throw new TeamReferenceError("$ref must be a string");
      const resolved = resolveTeamReference(record.$ref, context);
      return resolved.present ? resolved.value : MISSING_TEAM_VALUE;
    }
    ownKeys(record, ["$literal"], "ValueExpr");
    return record.$literal;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    const value = evaluateTeamValueExpr(child, context);
    if (value !== MISSING_TEAM_VALUE) {
      Object.defineProperty(output, key, { value, enumerable: true, configurable: true, writable: true });
    }
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => deepJsonEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepJsonEqual(leftRecord[key], rightRecord[key]));
}

function evaluateConditionValue(value: unknown, context: TeamReferenceContext, allowMissing = false): unknown | MissingTeamValue {
  const result = evaluateTeamValueExpr(value, context);
  if (result === MISSING_TEAM_VALUE && !allowMissing) throw new TeamReferenceError("Condition reference is missing", "IR_ROUTE_CONDITION_INPUT_MISSING");
  return result;
}

/** Evaluates the closed, typed condition AST frozen in the Team IR v2 design. */
export function evaluateTeamCondition(condition: unknown, context: TeamReferenceContext): boolean {
  if (!isRecord(condition)) throw new TeamReferenceError("Condition must be an object", "IR_ROUTE_CONDITION_INVALID");
  const op = condition.op;
  const args = condition.args;
  if (!Array.isArray(args)) throw new TeamReferenceError("Condition args must be an array", "IR_ROUTE_CONDITION_INVALID");
  const unary = (name: string): unknown => {
    ownKeys(condition, ["op", "args"], "condition");
    if (args.length !== 1) throw new TeamReferenceError(`${name} requires one argument`, "IR_ROUTE_CONDITION_INVALID");
    return args[0];
  };
  const binary = (name: string): [unknown, unknown] => {
    ownKeys(condition, ["op", "args"], "condition");
    if (args.length !== 2) throw new TeamReferenceError(`${name} requires two arguments`, "IR_ROUTE_CONDITION_INVALID");
    return [args[0], args[1]];
  };
  if (op === "exists") {
    const [reference] = [unary("exists")];
    if (!isRecord(reference) || Object.keys(reference).length !== 1 || typeof reference.$ref !== "string") {
      throw new TeamReferenceError("exists requires one $ref", "IR_ROUTE_CONDITION_INVALID");
    }
    return resolveTeamReference(reference.$ref, context).present;
  }
  if (op === "not") {
    const child = evaluateTeamCondition(unary("not"), context);
    return !child;
  }
  if (op === "and" || op === "or") {
    ownKeys(condition, ["op", "args"], "condition");
    if (args.length === 0) throw new TeamReferenceError(`${op} requires at least one argument`, "IR_ROUTE_CONDITION_INVALID");
    if (op === "and") {
      for (const child of args) if (!evaluateTeamCondition(child, context)) return false;
      return true;
    }
    for (const child of args) if (evaluateTeamCondition(child, context)) return true;
    return false;
  }
  if (op === "equals" || op === "notEquals") {
    const [leftExpr, rightExpr] = binary(String(op));
    const left = evaluateConditionValue(leftExpr, context);
    const right = evaluateConditionValue(rightExpr, context);
    const equal = deepJsonEqual(left, right);
    return op === "equals" ? equal : !equal;
  }
  throw new TeamReferenceError(`Unsupported condition operator: ${String(op)}`, "IR_ROUTE_CONDITION_INVALID");
}
