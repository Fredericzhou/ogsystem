import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readJsonFile } from "./json-file.js";
import { pathExists } from "./run-store.js";
import type { ModelCatalog, ModelCatalogEntry } from "./types.js";

export const OPENCODE_MODEL_DISCOVERY_COMMAND = "opencode models --verbose";
export const MODEL_CATALOG_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type ModelDiscoveryErrorCode =
  | "MODEL_DISCOVERY_COMMAND_MISSING"
  | "MODEL_DISCOVERY_NONZERO_EXIT"
  | "MODEL_DISCOVERY_MALFORMED"
  | "MODEL_DISCOVERY_EMPTY";

export class ModelDiscoveryError extends Error {
  constructor(
    public readonly code: ModelDiscoveryErrorCode,
    message: string,
    public readonly action: string
  ) {
    super(`[${code}] ${message} Action: ${action}`);
    this.name = "ModelDiscoveryError";
  }
}

function discoveryMalformed(message: string): ModelDiscoveryError {
  return new ModelDiscoveryError(
    "MODEL_DISCOVERY_MALFORMED",
    `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} returned malformed output: ${message}`,
    "Check the installed OpenCode version and rerun `ogs project sync-models`."
  );
}

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
  if (lines.length === 0) {
    throw new ModelDiscoveryError(
      "MODEL_DISCOVERY_EMPTY",
      `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} returned an empty catalog.`,
      "Configure at least one usable OpenCode model and rerun `ogs project sync-models`."
    );
  }

  const models: ModelCatalogEntry[] = [];
  let index = 0;

  while (index < lines.length) {
    const ref = lines[index]?.trim();
    if (!ref || !/^[^/\s]+\/.+/.test(ref)) {
      throw discoveryMalformed(`expected a provider/model reference, got "${ref ?? ""}"`);
    }
    index += 1;
    if (index >= lines.length || !lines[index].trim().startsWith("{")) {
      throw discoveryMalformed(`model "${ref}" is missing its JSON record`);
    }
    const jsonLines: string[] = [];
    let parsed: RawOpencodeModelRecord | undefined;
    while (index < lines.length) {
      jsonLines.push(lines[index]);
      const joined = jsonLines.join("\n");
      try {
        const candidate = JSON.parse(joined) as unknown;
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
          throw discoveryMalformed(`model "${ref}" JSON record must be an object`);
        }
        parsed = candidate as RawOpencodeModelRecord;
        index += 1;
        break;
      } catch (error) {
        if (error instanceof ModelDiscoveryError) {
          throw error;
        }
        if (index === lines.length - 1) {
          throw discoveryMalformed(`model "${ref}" JSON record could not be parsed`);
        }
        index += 1;
      }
    }
    if (!parsed) {
      throw discoveryMalformed(`model "${ref}" JSON record is incomplete`);
    }
    if (models.some((model) => model.ref === ref)) {
      throw discoveryMalformed(`duplicate model reference "${ref}"`);
    }
    try {
      models.push(normalizeRawOpencodeModel({ ref, raw: parsed }));
    } catch (error) {
      if (error instanceof ModelDiscoveryError) {
        throw error;
      }
      throw discoveryMalformed(error instanceof Error ? error.message : String(error));
    }
  }

  if (models.length === 0) {
    throw new ModelDiscoveryError(
      "MODEL_DISCOVERY_EMPTY",
      `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} returned no models.`,
      "Configure at least one usable OpenCode model and rerun `ogs project sync-models`."
    );
  }

  return {
    catalogVersion: "1",
    generatedAt: new Date().toISOString(),
    source: {
      command: OPENCODE_MODEL_DISCOVERY_COMMAND
    },
    models
  };
}

type DiscoveryCommandResult = {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
};

export type DiscoveryCommandRunner = (args: {
  command: string;
  args: string[];
  cwd: string;
}) => Promise<DiscoveryCommandResult | string>;

async function runOpencodeModelsVerbose(
  workdir: string,
  commandRunner?: DiscoveryCommandRunner
): Promise<string> {
  if (commandRunner) {
    let result: DiscoveryCommandResult | string;
    try {
      result = await commandRunner({
        command: "opencode",
        args: ["models", "--verbose"],
        cwd: workdir
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ModelDiscoveryError(
          "MODEL_DISCOVERY_COMMAND_MISSING",
          `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} could not start because the "opencode" command was not found.`,
          "Install OpenCode and ensure `opencode` is available on PATH, then rerun `ogs project sync-models`."
        );
      }
      throw error;
    }
    if (typeof result === "string") {
      return result;
    }
    if (result.exitCode !== undefined && result.exitCode !== null && result.exitCode !== 0) {
      throw new ModelDiscoveryError(
        "MODEL_DISCOVERY_NONZERO_EXIT",
        `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} exited with code ${result.exitCode}: ${result.stderr?.trim() || "unknown error"}`,
        "Fix the OpenCode command or provider configuration, then rerun `ogs project sync-models`."
      );
    }
    return result.stdout;
  }

  const fixturePath = process.env.OGSYSTEM_OPENCODE_MODELS_STDOUT_FILE?.trim();
  if (fixturePath) {
    return readFile(resolve(workdir, fixturePath), "utf8");
  }
  const fixtureInline = process.env.OGSYSTEM_OPENCODE_MODELS_STDOUT;
  if (fixtureInline !== undefined) {
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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new ModelDiscoveryError(
            "MODEL_DISCOVERY_COMMAND_MISSING",
            `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} could not start because the "opencode" command was not found.`,
            "Install OpenCode and ensure `opencode` is available on PATH, then rerun `ogs project sync-models`."
          )
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new ModelDiscoveryError(
            "MODEL_DISCOVERY_NONZERO_EXIT",
            `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} exited with code ${code}: ${stderr.trim() || "unknown error"}`,
            "Fix the OpenCode command or provider configuration, then rerun `ogs project sync-models`."
          )
        );
        return;
      }
      resolvePromise(stdout);
    });
  });
}

export async function refreshModelCatalog(args: {
  workdir: string;
  commandRunner?: DiscoveryCommandRunner;
}): Promise<ModelCatalog> {
  try {
    return parseOpencodeModelsVerboseOutput(
      await runOpencodeModelsVerbose(args.workdir, args.commandRunner)
    );
  } catch (error) {
    if (error instanceof ModelDiscoveryError) {
      throw error;
    }
    throw discoveryMalformed(error instanceof Error ? error.message : String(error));
  }
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

export function isModelCatalogStale(
  catalog: ModelCatalog,
  nowMs = Date.now(),
  staleAfterMs = MODEL_CATALOG_STALE_AFTER_MS
): boolean {
  const generatedAtMs = Date.parse(catalog.generatedAt);
  return !Number.isFinite(generatedAtMs) || nowMs - generatedAtMs > staleAfterMs;
}
