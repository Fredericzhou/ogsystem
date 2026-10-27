import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import teamIrV2Schema from "../../schemas/team-ir-v2.schema.json" with { type: "json" };
import type { TeamIrDiagnostic, TeamIrDocument, TeamIrParseResult } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false, ownProperties: true });
const validateRoot = ajv.compile(teamIrV2Schema);

function pointerWithMissingProperty(error: ErrorObject): string {
  const base = error.instancePath ?? "";
  const missing = typeof error.params === "object" && error.params !== null && "missingProperty" in error.params
    ? String(error.params.missingProperty)
    : undefined;
  const additional = typeof error.params === "object" && error.params !== null && "additionalProperty" in error.params
    ? String(error.params.additionalProperty)
    : undefined;
  const property = missing ?? additional;
  const pointer = property ? `${base}/${property.replaceAll("~", "~0").replaceAll("/", "~1")}` : base;
  return pointer || "/";
}

function diagnosticFor(error: ErrorObject): TeamIrDiagnostic {
  const pointer = pointerWithMissingProperty(error);
  const message = error.message ?? "does not match Team IR v2 schema";
  const duplicate = error.keyword === "uniqueItems";
  return {
    code: duplicate ? "IR_DUPLICATE_VALUE" : "IR_SCHEMA_INVALID",
    pointer,
    message,
    severity: "error",
    suggestedFix: duplicate ? "Remove the duplicate value." : "Correct the value to match the Team IR v2 schema."
  };
}

export function validateTeamIrSchema(value: unknown): TeamIrDiagnostic[] {
  if (validateRoot(value)) return [];
  return (validateRoot.errors ?? []).map(diagnosticFor);
}

export function parseTeamIr(value: unknown): TeamIrParseResult {
  const diagnostics = validateTeamIrSchema(value);
  if (diagnostics.length > 0) return { diagnostics };
  return { document: value as TeamIrDocument, diagnostics: [] };
}

export function getTeamIrV2JsonSchema(): object {
  return teamIrV2Schema as object;
}
