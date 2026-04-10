import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readJsonFile } from "./json-file.js";
import { assertJsonSchema } from "./json-schema.js";
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

function expectOptionalTalent(
  value: unknown,
  filePath: string,
  fieldPath: string
): RolePackageManifest["talent"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = expectRecord(value, filePath, fieldPath);
  const talent: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    talent[key] = expectString(entry, filePath, `${fieldPath}.${key}`);
  }
  return talent;
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
      "talent",
      "preferredModelTags",
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
    talent: expectOptionalTalent(record.talent, filePath, "$.talent"),
    preferredModelTags: expectOptionalStringArray(
      record.preferredModelTags,
      filePath,
      "$.preferredModelTags"
    ),
    tags: expectOptionalStringArray(record.tags, filePath, "$.tags")
  };
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
    inputSchemaPath,
    outputSchema,
    outputSchemaPath,
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

export function validateRoleInputSchema(args: {
  input: Record<string, string>;
  schema: unknown;
  roleId: string;
  schemaPath?: string;
}): void {
  assertJsonSchema({
    schema: args.schema,
    data: args.input,
    schemaPath: args.schemaPath ?? "(inline input schema)",
    roleId: args.roleId,
    subject: "input"
  });
}

export function validateRoleOutputSchema(args: {
  output: RoleExecutionOutput;
  schema: unknown;
  roleId: string;
  schemaPath?: string;
}): void {
  assertJsonSchema({
    schema: args.schema,
    data: args.output,
    schemaPath: args.schemaPath ?? "(inline output schema)",
    roleId: args.roleId,
    subject: "output"
  });
}
