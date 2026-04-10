import { Ajv, type AnySchema, type DefinedError, type ErrorObject, type ValidateFunction } from "ajv";

import type { JsonSchemaValidationIssue } from "./types.js";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});

const validatorCache = new Map<string, ValidateFunction>();

function getValidator(schema: unknown): ValidateFunction {
  const cacheKey = JSON.stringify(schema);
  const existing = validatorCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const compiled = ajv.compile(schema as AnySchema);
  validatorCache.set(cacheKey, compiled);
  return compiled;
}

function toJsonPath(instancePath: string): string {
  if (!instancePath) {
    return "$";
  }
  return `$${instancePath.replace(/\//g, ".")}`;
}

function normalizeIssue(error: ErrorObject): JsonSchemaValidationIssue {
  const defined = error as DefinedError;
  if (defined.keyword === "required" && typeof defined.params.missingProperty === "string") {
    return {
      path: `${toJsonPath(defined.instancePath)}.${defined.params.missingProperty}`,
      message: "required"
    };
  }

  if (defined.keyword === "additionalProperties" && typeof defined.params.additionalProperty === "string") {
    return {
      path: `${toJsonPath(defined.instancePath)}.${defined.params.additionalProperty}`,
      message: "additional property not allowed"
    };
  }

  return {
    path: toJsonPath(error.instancePath),
    message: error.message ?? error.keyword
  };
}

export function listJsonSchemaIssues(args: {
  schema: unknown;
  data: unknown;
}): JsonSchemaValidationIssue[] {
  const validate = getValidator(args.schema);
  const valid = validate(args.data);
  if (valid) {
    return [];
  }
  return (validate.errors ?? []).map(normalizeIssue);
}

export function assertJsonSchema(args: {
  schema: unknown;
  data: unknown;
  schemaPath: string;
  roleId: string;
  subject: "input" | "output";
}): void {
  if (typeof args.schema !== "object" || args.schema === null || Array.isArray(args.schema)) {
    throw new Error(
      `Invalid ${args.subject} schema for role "${args.roleId}" in ${args.schemaPath}: expected JSON object`
    );
  }

  const issues = listJsonSchemaIssues({
    schema: args.schema,
    data: args.data
  });
  if (issues.length === 0) {
    return;
  }

  const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  throw new Error(
    `Role "${args.roleId}" ${args.subject} does not match schema in ${args.schemaPath}: ${detail}`
  );
}
