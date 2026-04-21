import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readJsonFile } from "./json-file.js";
import { pathExists } from "./run-artifacts.js";
import type { ModelCatalog, ModelCatalogEntry } from "./types.js";

function fail(filePath: string, fieldPath: string, message: string): never {
  throw new Error(`Invalid model catalog in ${filePath} at ${fieldPath}: ${message}`);
}

function asRecord(value: unknown, filePath: string, fieldPath: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(filePath, fieldPath, "expected object");
  }
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown, filePath: string, fieldPath: string): boolean {
  if (typeof value !== "boolean") {
    fail(filePath, fieldPath, "expected boolean");
  }
  return value;
}

function asOptionalString(value: unknown, filePath: string, fieldPath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    fail(filePath, fieldPath, "expected non-empty string");
  }
  return value;
}

function asString(value: unknown, filePath: string, fieldPath: string): string {
  const next = asOptionalString(value, filePath, fieldPath);
  if (!next) {
    fail(filePath, fieldPath, "expected non-empty string");
  }
  return next;
}

function asStringArray(value: unknown, filePath: string, fieldPath: string): string[] {
  if (!Array.isArray(value)) {
    fail(filePath, fieldPath, "expected array");
  }
  return value.map((entry, index) => asString(entry, filePath, `${fieldPath}[${index}]`));
}

export function validateModelCatalog(value: unknown, filePath: string): ModelCatalog {
  const record = asRecord(value, filePath, "$");
  const catalogVersion = asString(record.catalogVersion, filePath, "$.catalogVersion");
  if (catalogVersion !== "1") {
    fail(filePath, "$.catalogVersion", `unsupported version "${catalogVersion}"`);
  }
  const source = asRecord(record.source, filePath, "$.source");
  const modelsValue = record.models;
  if (!Array.isArray(modelsValue)) {
    fail(filePath, "$.models", "expected array");
  }
  const models = modelsValue.map((entry, index) => {
    const modelRecord = asRecord(entry, filePath, `$.models[${index}]`);
    const capabilities = asRecord(modelRecord.capabilities, filePath, `$.models[${index}].capabilities`);
    const rawValue = modelRecord.raw;
    const rawRecord =
      rawValue === undefined ? undefined : asRecord(rawValue, filePath, `$.models[${index}].raw`);
    return {
      ref: asString(modelRecord.ref, filePath, `$.models[${index}].ref`),
      provider: asString(modelRecord.provider, filePath, `$.models[${index}].provider`),
      model: asString(modelRecord.model, filePath, `$.models[${index}].model`),
      name: asOptionalString(modelRecord.name, filePath, `$.models[${index}].name`),
      status: asOptionalString(modelRecord.status, filePath, `$.models[${index}].status`),
      capabilities: {
        textInput: asBoolean(capabilities.textInput, filePath, `$.models[${index}].capabilities.textInput`),
        textOutput: asBoolean(
          capabilities.textOutput,
          filePath,
          `$.models[${index}].capabilities.textOutput`
        ),
        toolcall: asBoolean(capabilities.toolcall, filePath, `$.models[${index}].capabilities.toolcall`)
      },
      variants: asStringArray(modelRecord.variants ?? [], filePath, `$.models[${index}].variants`),
      raw: rawRecord
        ? {
            id: asOptionalString(rawRecord.id, filePath, `$.models[${index}].raw.id`),
            providerID: asOptionalString(
              rawRecord.providerID,
              filePath,
              `$.models[${index}].raw.providerID`
            )
          }
        : undefined
    } satisfies ModelCatalogEntry;
  });

  return {
    catalogVersion: "1",
    generatedAt: asString(record.generatedAt, filePath, "$.generatedAt"),
    source: {
      command: asString(source.command, filePath, "$.source.command")
    },
    models
  };
}

function countOccurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

type RawOpencodeModelRecord = {
  id?: string;
  providerID?: string;
  name?: string;
  status?: string;
  capabilities?: {
    toolcall?: boolean;
    input?: {
      text?: boolean;
    };
    output?: {
      text?: boolean;
    };
  };
  variants?: Record<string, unknown>;
};

function normalizeRawOpencodeModel(args: {
  ref: string;
  raw: RawOpencodeModelRecord;
}): ModelCatalogEntry {
  const separator = args.ref.indexOf("/");
  if (separator <= 0 || separator === args.ref.length - 1) {
    throw new Error(`Invalid OpenCode model reference from verbose output: ${args.ref}`);
  }
  return {
    ref: args.ref,
    provider: args.ref.slice(0, separator),
    model: args.ref.slice(separator + 1),
    name: args.raw.name,
    status: args.raw.status,
    capabilities: {
      textInput: args.raw.capabilities?.input?.text === true,
      textOutput: args.raw.capabilities?.output?.text === true,
      toolcall: args.raw.capabilities?.toolcall === true
    },
    variants: Object.keys(args.raw.variants ?? {}).sort((left, right) => left.localeCompare(right)),
    raw: {
      id: args.raw.id,
      providerID: args.raw.providerID
    }
  };
}

export function parseOpencodeModelsVerboseOutput(stdout: string): ModelCatalog {
  const lines = stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0);
  const models: ModelCatalogEntry[] = [];
  let index = 0;

  while (index < lines.length) {
    const ref = lines[index]?.trim();
    if (!ref) {
      index += 1;
      continue;
    }
    index += 1;
    const jsonLines: string[] = [];
    while (index < lines.length) {
      jsonLines.push(lines[index]);
      const joined = jsonLines.join("\n");
      if (countOccurrences(joined, "{") > 0 && countOccurrences(joined, "{") === countOccurrences(joined, "}")) {
        const parsed = JSON.parse(joined) as RawOpencodeModelRecord;
        models.push(
          normalizeRawOpencodeModel({
            ref,
            raw: parsed
          })
        );
        index += 1;
        break;
      }
      index += 1;
    }
  }

  return {
    catalogVersion: "1",
    generatedAt: new Date().toISOString(),
    source: {
      command: "opencode models --verbose"
    },
    models
  };
}

async function runOpencodeModelsVerbose(workdir: string): Promise<string> {
  const fixturePath = process.env.OGSYSTEM_OPENCODE_MODELS_STDOUT_FILE?.trim();
  if (fixturePath) {
    return readFile(resolve(workdir, fixturePath), "utf8");
  }
  const fixtureInline = process.env.OGSYSTEM_OPENCODE_MODELS_STDOUT;
  if (fixtureInline) {
    return fixtureInline;
  }

  return new Promise((resolvePromise, reject) => {
    const child = spawn("opencode", ["models", "--verbose"], {
      cwd: workdir,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`opencode models --verbose failed with code ${code}: ${stderr.trim() || "unknown error"}`)
        );
        return;
      }
      resolvePromise(stdout);
    });
  });
}

export async function refreshModelCatalog(args: {
  workdir: string;
}): Promise<ModelCatalog> {
  return parseOpencodeModelsVerboseOutput(await runOpencodeModelsVerbose(args.workdir));
}

export async function loadModelCatalog(path: string): Promise<ModelCatalog | undefined> {
  if (!(await pathExists(path))) {
    return undefined;
  }
  return validateModelCatalog(await readJsonFile(path), path);
}

export function chooseDefaultModelFromCatalog(catalog: ModelCatalog): ModelCatalogEntry | undefined {
  return catalog.models.find(
    (model) =>
      model.status === "active" &&
      model.capabilities.textInput &&
      model.capabilities.textOutput &&
      model.capabilities.toolcall
  );
}
