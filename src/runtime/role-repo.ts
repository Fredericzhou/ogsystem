import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  LoadedRolePackage,
  RoleExecutionOutput,
  RolePackageManifest
} from "./types.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function fail(filePath: string, fieldPath: string, message: string): never {
  throw new Error(`Invalid role config in ${filePath} at ${fieldPath}: ${message}`);
}

function expectRecord(
  value: unknown,
  filePath: string,
  fieldPath: string
): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(filePath, fieldPath, `expected object, received ${describeType(value)}`);
  }
  return value as Record<string, JsonValue>;
}

function expectString(value: unknown, filePath: string, fieldPath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(filePath, fieldPath, "expected non-empty string");
  }
  return value;
}

function expectOptionalStringArray(
  value: unknown,
  filePath: string,
  fieldPath: string
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    fail(filePath, fieldPath, `expected array, received ${describeType(value)}`);
  }
  return value.map((entry, index) => expectString(entry, filePath, `${fieldPath}[${index}]`));
}

function expectNoExtraKeys(
  record: Record<string, JsonValue>,
  allowedKeys: string[],
  filePath: string,
  fieldPath: string
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(filePath, `${fieldPath}.${key}`, "unknown field");
    }
  }
}

export function validateRolePackageManifest(
  value: unknown,
  filePath: string
): RolePackageManifest {
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(
    record,
    [
      "roleId",
      "roleVersion",
      "name",
      "description",
      "promptTemplate",
      "inputSchema",
      "outputSchema",
      "tags"
    ],
    filePath,
    "$"
  );

  return {
    roleId: expectString(record.roleId, filePath, "$.roleId"),
    roleVersion: expectString(record.roleVersion, filePath, "$.roleVersion"),
    name: expectString(record.name, filePath, "$.name"),
    description: expectString(record.description, filePath, "$.description"),
    promptTemplate: expectString(record.promptTemplate, filePath, "$.promptTemplate"),
    inputSchema:
      record.inputSchema === undefined
        ? undefined
        : expectString(record.inputSchema, filePath, "$.inputSchema"),
    outputSchema: expectString(record.outputSchema, filePath, "$.outputSchema"),
    tags: expectOptionalStringArray(record.tags, filePath, "$.tags")
  };
}

async function readJsonFile(path: string): Promise<unknown> {
  const source = await readFile(path, "utf8");
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${path}: ${message}`);
  }
}

export async function loadRolePackage(args: {
  roleId: string;
  roleRootDir: string;
}): Promise<LoadedRolePackage> {
  const resolvedPath = resolve(args.roleRootDir, args.roleId);
  const manifestPath = resolve(resolvedPath, "role.json");
  const manifest = validateRolePackageManifest(await readJsonFile(manifestPath), manifestPath);

  if (manifest.roleId !== args.roleId) {
    throw new Error(
      `Role package mismatch in ${manifestPath}: expected roleId "${args.roleId}", got "${manifest.roleId}"`
    );
  }

  const promptTemplatePath = resolve(resolvedPath, manifest.promptTemplate);
  const inputSchemaPath = manifest.inputSchema ? resolve(resolvedPath, manifest.inputSchema) : undefined;
  const outputSchemaPath = resolve(resolvedPath, manifest.outputSchema);
  const promptTemplate = await readFile(promptTemplatePath, "utf8");
  const inputSchema = inputSchemaPath ? await readJsonFile(inputSchemaPath) : undefined;
  const outputSchema = await readJsonFile(outputSchemaPath);

  let persona: string | undefined;
  try {
    persona = await readFile(resolve(resolvedPath, "persona.md"), "utf8");
  } catch {
    persona = undefined;
  }

  let work: string | undefined;
  try {
    work = await readFile(resolve(resolvedPath, "work.md"), "utf8");
  } catch {
    work = undefined;
  }

  return {
    resolvedPath,
    manifest,
    promptTemplate,
    inputSchema,
    outputSchema,
    persona,
    work
  };
}

export function renderRolePrompt(args: {
  promptTemplate: string;
  persona?: string;
  work?: string;
  values: Record<string, string>;
}): string {
  const variables: Record<string, string> = {
    persona: args.persona?.trim() ?? "",
    work: args.work?.trim() ?? "",
    ...args.values
  };

  return args.promptTemplate.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_all, key) => {
    return variables[key] ?? "";
  });
}

function validateObjectSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (type !== "object") {
    errors.push(`${path}: only object schemas are supported`);
    return errors;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  const record = value as Record<string, unknown>;
  const properties =
    typeof schema.properties === "object" && schema.properties !== null && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  const additionalProperties = schema.additionalProperties;

  for (const key of required) {
    if (!(key in record)) {
      errors.push(`${path}.${key}: required`);
    }
  }

  for (const [key, entry] of Object.entries(record)) {
    const propertySchema = properties[key];
    if (!propertySchema) {
      if (additionalProperties === false) {
        errors.push(`${path}.${key}: additional property not allowed`);
      }
      continue;
    }

    const propertyType = propertySchema.type;
    if (propertyType === "string" && typeof entry !== "string") {
      errors.push(`${path}.${key}: expected string`);
      continue;
    }
    if (propertyType === "object" && (typeof entry !== "object" || entry === null || Array.isArray(entry))) {
      errors.push(`${path}.${key}: expected object`);
      continue;
    }
    if (Array.isArray(propertySchema.enum) && !propertySchema.enum.includes(entry)) {
      errors.push(`${path}.${key}: expected one of ${propertySchema.enum.join(", ")}`);
    }
  }

  return errors;
}

export function validateRoleInputSchema(args: {
  input: Record<string, string>;
  schema: unknown;
  roleId: string;
}): void {
  if (typeof args.schema !== "object" || args.schema === null || Array.isArray(args.schema)) {
    throw new Error(`Invalid input schema for role "${args.roleId}": expected JSON object`);
  }

  const errors = validateObjectSchema(args.input, args.schema as Record<string, unknown>, "$");
  if (errors.length > 0) {
    throw new Error(
      `Role "${args.roleId}" input does not match schema: ${errors.join("; ")}`
    );
  }
}

export function validateRoleOutputSchema(args: {
  output: RoleExecutionOutput;
  schema: unknown;
  roleId: string;
}): void {
  if (typeof args.schema !== "object" || args.schema === null || Array.isArray(args.schema)) {
    throw new Error(`Invalid output schema for role "${args.roleId}": expected JSON object`);
  }

  const errors = validateObjectSchema(
    args.output,
    args.schema as Record<string, unknown>,
    "$"
  );
  if (errors.length > 0) {
    throw new Error(
      `Role "${args.roleId}" output does not match schema: ${errors.join("; ")}`
    );
  }
}
