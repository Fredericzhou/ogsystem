import { createHash } from "node:crypto";
import { canonicalizeTeamIR } from "./canonical.js";
import { validateTeamIr } from "./index.js";
import { TeamSchemaResolver } from "./schema-resolver.js";
import type { ValidateFunction } from "ajv";
import { payloadValidatorKey } from "./payload-validation.js";
import type { TeamIrDiagnostic, TeamIrDocument } from "./types.js";

export interface CompiledTeamPlan {
  readonly compilerSemanticsVersion: string;
  readonly compiledPlanDigest: string;
  readonly schemaSnapshot: readonly { path: string; dialect: string; digest: string }[];
  readonly payloadValidators: ReadonlyMap<string, ValidateFunction>;
  readonly team: Readonly<TeamIrDocument>;
  readonly routesBySource: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly handoffsById: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly joinsByTarget: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly loopsById: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly reviewsByOutput: ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>;
}

export class TeamIrCompileError extends Error {
  readonly diagnostics: TeamIrDiagnostic[];

  constructor(diagnostics: TeamIrDiagnostic[]) {
    super(`Team IR compilation failed with ${diagnostics.filter((item) => item.severity === "error").length} error(s).`);
    this.name = "TeamIrCompileError";
    this.diagnostics = diagnostics;
  }
}

export interface TeamIrCompileOptions {
  schemaDigests?: Record<string, string>;
  packageDigests?: Record<string, string>;
  bindingDigests?: Record<string, string>;
  adapterVersions?: Record<string, string>;
  packageSchemas?: Record<string, unknown>;
  compilerSemanticsVersion?: string;
}

function sourceKey(source: Record<string, unknown>): string {
  return source.kind === "run" ? "run" : `agent:${String(source.agentId)}:${String(source.outputPort)}`;
}

function targetKey(agentId: unknown, portId: unknown): string {
  return `${String(agentId)}:${String(portId)}`;
}

function indexRecords<T extends Record<string, unknown>>(items: unknown, keyOf: (item: T) => string): Map<string, T> {
  const index = new Map<string, T>();
  if (!Array.isArray(items)) return index;
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) index.set(keyOf(item as T), item as T);
  }
  return index;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function embeddedSchemas(document: TeamIrDocument): unknown[] {
  const output: unknown[] = [];
  const push = (value: unknown): void => {
    if (value === undefined) return;
    output.push(value);
  };
  const runInput = document.runInput as Record<string, unknown>;
  const runResult = document.runResult as Record<string, unknown>;
  push(runInput.dataSchema);
  push(runInput.preferencesSchema);
  push(runResult.dataSchema);
  for (const agent of document.agents) {
    for (const kind of ["inputPorts", "outputPorts"] as const) {
      const ports = agent[kind] as Record<string, Record<string, unknown>>;
      for (const port of Object.values(ports)) push(port.dataSchema);
    }
  }
  const orchestration = document.orchestration as Record<string, unknown>;
  for (const review of Array.isArray(orchestration.reviews) ? orchestration.reviews as Record<string, unknown>[] : []) push(review.feedbackSchema);
  for (const schema of Object.values(document.$defs ?? {})) push(schema);
  return output;
}

function compileSchemaClosure(resolver: TeamSchemaResolver, schemas: unknown[]): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (typeof object.$ref === "string") resolver.compile(object.$ref);
    for (const [key, child] of Object.entries(object)) if (key !== "$ref") visit(child);
  };
  schemas.forEach(visit);
}

function compilePayloadValidators(document: TeamIrDocument, resolver: TeamSchemaResolver): Map<string, ValidateFunction> {
  const validators = new Map<string, ValidateFunction>();
  const add = (key: Parameters<typeof payloadValidatorKey>[0], schema: unknown): void => {
    validators.set(payloadValidatorKey(key), resolver.compileSchema(schema));
  };
  const runInput = document.runInput as Record<string, unknown>;
  const runResult = document.runResult as Record<string, unknown>;
  add({ kind: "run-input", part: "input" }, runInput.dataSchema);
  add({ kind: "run-input", part: "preferences" }, runInput.preferencesSchema);
  add({ kind: "run-result" }, runResult.dataSchema);
  for (const agent of document.agents) {
    const agentId = String(agent.id);
    for (const [kind, direction] of [["inputPorts", "agent-input"], ["outputPorts", "agent-output"]] as const) {
      const ports = agent[kind] as Record<string, Record<string, unknown>>;
      for (const [portId, port] of Object.entries(ports)) {
        add({ kind: direction, agentId, portId }, port.dataSchema);
      }
    }
  }
  const orchestration = document.orchestration as Record<string, unknown>;
  for (const review of Array.isArray(orchestration.reviews) ? orchestration.reviews as Record<string, unknown>[] : []) {
    add({ kind: "review-feedback", reviewId: String(review.id) }, review.feedbackSchema);
  }
  return validators;
}

export function compileTeamIr(value: unknown, options: TeamIrCompileOptions = {}): CompiledTeamPlan {
  const diagnostics = validateTeamIr(value, { packageSchemas: options.packageSchemas });
  if (diagnostics.some((item) => item.severity === "error")) throw new TeamIrCompileError(diagnostics);
  const document = value as TeamIrDocument;
  const semanticsVersion = options.compilerSemanticsVersion ?? "team-ir-v2/1";
  const schemaResolver = new TeamSchemaResolver({ teamDocument: document, packageSchemas: options.packageSchemas });
  compileSchemaClosure(schemaResolver, embeddedSchemas(document));
  const payloadValidators = compilePayloadValidators(document, schemaResolver);
  const schemaSnapshot = Object.freeze(schemaResolver.snapshot().map((resource) => Object.freeze(resource)));
  const compiledClosure = {
    team: canonicalizeTeamIR(document),
    schemaSnapshot,
    externalSchemaDigests: options.schemaDigests ?? {},
    packageDigests: options.packageDigests ?? {},
    bindingDigests: options.bindingDigests ?? {},
    adapterVersions: options.adapterVersions ?? {},
    compilerSemanticsVersion: semanticsVersion
  };
  const compiledPlanDigest = createHash("sha256").update(JSON.stringify(canonicalizeTeamIR(compiledClosure)), "utf8").digest("hex");
  const orchestration = document.orchestration as Record<string, unknown>;
  const routesBySource = indexRecords(orchestration.routes, (route) => sourceKey(route.from as Record<string, unknown>));
  const handoffsById = indexRecords(document.handoffs, (handoff) => String(handoff.id));
  const joinsByTarget = indexRecords(orchestration.joins, (join) => targetKey(join.agentId, join.inputPort));
  const loopsById = indexRecords(orchestration.loops, (loop) => String(loop.id));
  const reviewsByOutput = new Map<string, Readonly<Record<string, unknown>>[]>();
  for (const review of Array.isArray(orchestration.reviews) ? orchestration.reviews : []) {
    if (!review || typeof review !== "object" || Array.isArray(review)) continue;
    const item = review as Record<string, unknown>;
    const at = item.at as Record<string, unknown>;
    const key = `${String(at.agentId)}:${String(at.outputPort)}`;
    reviewsByOutput.set(key, [...(reviewsByOutput.get(key) ?? []), item]);
  }
  const snapshot = deepFreeze(JSON.parse(JSON.stringify(canonicalizeTeamIR(document))) as TeamIrDocument);
  for (const reviews of reviewsByOutput.values()) Object.freeze(reviews);
  return Object.freeze({
    compilerSemanticsVersion: semanticsVersion,
    compiledPlanDigest,
    schemaSnapshot,
    payloadValidators,
    team: snapshot,
    routesBySource,
    handoffsById,
    joinsByTarget,
    loopsById,
    reviewsByOutput
  });
}
