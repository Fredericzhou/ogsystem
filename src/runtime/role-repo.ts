import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  AssemblyConfig,
  AssemblyNodeConfig,
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

function expectStringRecord(
  value: unknown,
  filePath: string,
  fieldPath: string
): Record<string, string> {
  const record = expectRecord(value, filePath, fieldPath);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    result[key] = expectString(entry, filePath, `${fieldPath}.${key}`);
  }
  return result;
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

export function validateAssemblyConfig(value: unknown, filePath: string): AssemblyConfig {
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(record, ["nodes"], filePath, "$");
  const nodesRecord = expectRecord(record.nodes, filePath, "$.nodes");
  const nodes: Record<string, AssemblyNodeConfig> = {};

  for (const [roleId, rawNode] of Object.entries(nodesRecord)) {
    const fieldPath = `$.nodes.${roleId}`;
    const nodeRecord = expectRecord(rawNode, filePath, fieldPath);
    expectNoExtraKeys(nodeRecord, ["roleRef", "profileRef", "promptArgs"], filePath, fieldPath);
    nodes[roleId] = {
      roleRef: expectString(nodeRecord.roleRef, filePath, `${fieldPath}.roleRef`),
      profileRef:
        nodeRecord.profileRef === undefined
          ? undefined
          : expectString(nodeRecord.profileRef, filePath, `${fieldPath}.profileRef`),
      promptArgs:
        nodeRecord.promptArgs === undefined
          ? undefined
          : expectStringRecord(nodeRecord.promptArgs, filePath, `${fieldPath}.promptArgs`)
    };
  }

  return { nodes };
}

export function validateRolePackageManifest(
  value: unknown,
  filePath: string
): RolePackageManifest {
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(
    record,
    ["roleId", "roleVersion", "name", "description", "promptTemplate", "outputSchema", "tags"],
    filePath,
    "$"
  );

  return {
    roleId: expectString(record.roleId, filePath, "$.roleId"),
    roleVersion: expectString(record.roleVersion, filePath, "$.roleVersion"),
    name: expectString(record.name, filePath, "$.name"),
    description: expectString(record.description, filePath, "$.description"),
    promptTemplate: expectString(record.promptTemplate, filePath, "$.promptTemplate"),
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

function resolveFileRoleRef(roleRef: string, baseDir: string): { path: string; version?: string } {
  if (!roleRef.startsWith("file:")) {
    throw new Error(`Unsupported roleRef "${roleRef}". Only file: refs are supported`);
  }
  const raw = roleRef.slice("file:".length);
  const match = raw.match(/^(.*?)(?:@([^/@]+))?$/);
  if (!match || !match[1]) {
    throw new Error(`Invalid file roleRef "${roleRef}"`);
  }
  return {
    path: resolve(baseDir, match[1]),
    version: match[2]
  };
}

export async function loadAssemblyConfig(path?: string): Promise<{
  assembly: AssemblyConfig;
  baseDir: string;
  path?: string;
}> {
  if (!path) {
    return {
      assembly: { nodes: {} },
      baseDir: process.cwd(),
      path: undefined
    };
  }
  return {
    assembly: validateAssemblyConfig(await readJsonFile(path), path),
    baseDir: dirname(path),
    path
  };
}

export async function loadRolePackage(args: {
  roleRef: string;
  baseDir: string;
}): Promise<LoadedRolePackage> {
  const resolved = resolveFileRoleRef(args.roleRef, args.baseDir);
  const manifestPath = resolve(resolved.path, "role.json");
  const manifest = validateRolePackageManifest(await readJsonFile(manifestPath), manifestPath);

  if (resolved.version && manifest.roleVersion !== resolved.version) {
    throw new Error(
      `Role package version mismatch for ${args.roleRef}: expected ${resolved.version}, got ${manifest.roleVersion}`
    );
  }

  const promptTemplatePath = resolve(resolved.path, manifest.promptTemplate);
  const outputSchemaPath = resolve(resolved.path, manifest.outputSchema);
  const promptTemplate = await readFile(promptTemplatePath, "utf8");
  const outputSchema = await readJsonFile(outputSchemaPath);

  let persona: string | undefined;
  try {
    persona = await readFile(resolve(resolved.path, "persona.md"), "utf8");
  } catch {
    persona = undefined;
  }

  let work: string | undefined;
  try {
    work = await readFile(resolve(resolved.path, "work.md"), "utf8");
  } catch {
    work = undefined;
  }

  return {
    ref: args.roleRef,
    resolvedPath: resolved.path,
    manifest,
    promptTemplate,
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
