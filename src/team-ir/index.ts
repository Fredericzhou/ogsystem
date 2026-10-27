import { parseTeamIr } from "./schema.js";
import { validateTeamIrReferences } from "./validate.js";
import { validateTeamIrMappings } from "./mapping-validation.js";
import { TeamSchemaResolver, TeamSchemaResolverError } from "./schema-resolver.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import type { TeamIrDiagnostic } from "./types.js";

export * from "./compiler.js";
export * from "./a2a-binding.js";
export * from "./file-run-store.js";
export * from "./artifact-store.js";
export * from "./runtime.js";
export * from "./join-runtime.js";
export * from "./review-runtime.js";

export * from "./canonical.js";
export * from "./mapping-validation.js";
export * from "./reference.js";
export * from "./payload-validation.js";
export * from "./schema-resolver.js";
export * from "./schema.js";
export * from "./types.js";
export * from "./validate.js";

function collectSchemas(document: Record<string, unknown>): Array<{ schema: unknown; pointer: string }> {
  const output: Array<{ schema: unknown; pointer: string }> = [];
  const push = (schema: unknown, pointer: string): void => {
    if (typeof schema === "boolean" || (schema && typeof schema === "object" && !Array.isArray(schema))) output.push({ schema, pointer });
  };
  const runInput = document.runInput as Record<string, unknown>;
  const runResult = document.runResult as Record<string, unknown>;
  push(runInput.dataSchema, "/runInput/dataSchema");
  push(runInput.preferencesSchema, "/runInput/preferencesSchema");
  push(runResult.dataSchema, "/runResult/dataSchema");
  const agents = Array.isArray(document.agents) ? document.agents as Array<Record<string, unknown>> : [];
  for (const [agentIndex, agent] of agents.entries()) {
    for (const portKind of ["inputPorts", "outputPorts"] as const) {
      const ports = agent[portKind] && typeof agent[portKind] === "object" ? agent[portKind] as Record<string, Record<string, unknown>> : {};
      for (const [portId, port] of Object.entries(ports)) push(port.dataSchema, `/agents/${agentIndex}/${portKind}/${portId}/dataSchema`);
    }
  }
  const orchestration = document.orchestration as Record<string, unknown>;
  const reviews = Array.isArray(orchestration.reviews) ? orchestration.reviews as Array<Record<string, unknown>> : [];
  for (const [index, review] of reviews.entries()) push(review.feedbackSchema, `/orchestration/reviews/${index}/feedbackSchema`);
  const definitions = document.$defs && typeof document.$defs === "object" ? document.$defs as Record<string, unknown> : {};
  for (const [id, schema] of Object.entries(definitions)) push(schema, `/$defs/${id}`);
  return output;
}

function validateEmbeddedSchemas(schemas: Array<{ schema: unknown; pointer: string }>): TeamIrDiagnostic[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const diagnostics: TeamIrDiagnostic[] = [];
  for (const { schema, pointer } of schemas) {
    if (ajv.validateSchema(schema as AnySchema)) continue;
    for (const error of ajv.errors ?? []) diagnostics.push({
      code: "IR_SCHEMA_INVALID",
      pointer: `${pointer}${error.instancePath ?? ""}` || "/",
      message: error.message ?? "Invalid JSON Schema",
      severity: "error",
      suggestedFix: "Correct the embedded Schema to Draft 2020-12."
    });
  }
  return diagnostics;
}

function schemaReferences(schemas: Array<{ schema: unknown; pointer: string }>): Array<{ reference: string; pointer: string }> {
  const references: Array<{ reference: string; pointer: string }> = [];
  const visit = (value: unknown, pointer: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pointer}/${index}`));
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(object, "$ref")) {
      if (typeof object.$ref === "string") references.push({ reference: object.$ref, pointer: `${pointer}/$ref` });
    }
    for (const [key, child] of Object.entries(object)) if (key !== "$ref") visit(child, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  };
  schemas.forEach(({ schema, pointer }) => visit(schema, pointer));
  return references;
}

export function validateTeamIr(value: unknown, options: { packageSchemas?: Record<string, unknown> } = {}): TeamIrDiagnostic[] {
  const parsed = parseTeamIr(value);
  if (!parsed.document) return parsed.diagnostics;
  const document = parsed.document;
  const diagnostics = [...validateEmbeddedSchemas(collectSchemas(document as unknown as Record<string, unknown>))];
  diagnostics.push(...validateTeamIrReferences(document));
  let resolver: TeamSchemaResolver;
  try {
    resolver = new TeamSchemaResolver({ teamDocument: document, packageSchemas: options.packageSchemas });
  } catch (error) {
    const resolverError = error instanceof TeamSchemaResolverError ? error : undefined;
    diagnostics.push({
      code: resolverError?.code ?? "IR_SCHEMA_INVALID",
      pointer: "/$defs",
      message: String(error),
      severity: "error"
    });
    return diagnostics;
  }
  const schemas = collectSchemas(document as unknown as Record<string, unknown>);
  for (const { reference, pointer } of schemaReferences(schemas)) {
    try {
      resolver.compile(reference);
    } catch (error) {
      const resolverError = error instanceof TeamSchemaResolverError ? error : undefined;
      diagnostics.push({
        code: resolverError?.code ?? "IR_SCHEMA_INVALID",
        pointer,
        message: String(error),
        severity: "error",
        suggestedFix: "Use a valid local or package-relative Draft 2020-12 Schema reference."
      });
    }
  }
  diagnostics.push(...validateTeamIrMappings({ document, resolver }));
  const unique = new Map<string, TeamIrDiagnostic>();
  for (const item of diagnostics) unique.set(JSON.stringify([item.code, item.pointer, item.message, item.severity]), item);
  return [...unique.values()];
}
