import { resolve } from "node:path";

import { readJsonFile } from "./json-file.js";
import type { LoadedModelPackage, ModelPackageManifest } from "./types.js";

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
  throw new Error(`Invalid model config in ${filePath} at ${fieldPath}: ${message}`);
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

function expectOptionalPositiveInteger(
  value: unknown,
  filePath: string,
  fieldPath: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(filePath, fieldPath, "expected positive integer");
  }
  return value;
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

function expectOptionalArgsRecord(
  value: unknown,
  filePath: string,
  fieldPath: string
): Record<string, string | boolean> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = expectRecord(value, filePath, fieldPath);
  const result: Record<string, string | boolean> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string" && typeof entry !== "boolean") {
      fail(filePath, `${fieldPath}.${key}`, "expected string or boolean");
    }
    result[key] = entry;
  }
  return result;
}

export function validateModelPackageManifest(
  value: unknown,
  filePath: string
): ModelPackageManifest {
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(
    record,
    ["modelId", "executor", "model", "args", "timeoutMs", "maxOutputBytes", "tags"],
    filePath,
    "$"
  );

  const executor = expectString(record.executor, filePath, "$.executor");
  if (executor !== "opencode") {
    fail(filePath, "$.executor", `expected "opencode", received "${executor}"`);
  }

  return {
    modelId: expectString(record.modelId, filePath, "$.modelId"),
    executor: "opencode",
    model: expectString(record.model, filePath, "$.model"),
    args: expectOptionalArgsRecord(record.args, filePath, "$.args"),
    timeoutMs: expectOptionalPositiveInteger(record.timeoutMs, filePath, "$.timeoutMs"),
    maxOutputBytes: expectOptionalPositiveInteger(
      record.maxOutputBytes,
      filePath,
      "$.maxOutputBytes"
    ),
    tags: expectOptionalStringArray(record.tags, filePath, "$.tags")
  };
}

export async function loadModelPackage(args: {
  modelId: string;
  modelRootDir: string;
}): Promise<LoadedModelPackage> {
  const resolvedPath = resolve(args.modelRootDir, "models", args.modelId);
  const manifestPath = resolve(resolvedPath, "model.json");
  const manifest = validateModelPackageManifest(await readJsonFile(manifestPath), manifestPath);

  if (manifest.modelId !== args.modelId) {
    throw new Error(
      `Model package mismatch in ${manifestPath}: expected modelId "${args.modelId}", got "${manifest.modelId}"`
    );
  }

  return {
    resolvedPath,
    manifest
  };
}
