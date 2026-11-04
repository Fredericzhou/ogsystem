import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readJsonFile } from "./json-file.js";
import { defaultBackendRegistry } from "./model-backend-registry.js";
import { pathExists } from "./run-store.js";
import type {
  ModelCatalog,
  ModelCatalogEntry,
  ModelCatalogSource,
  ModelCatalogSourceStatus,
  ReasoningCapability,
  ReasoningEffortLevel
} from "./types.js";

export const OPENCODE_MODEL_DISCOVERY_COMMAND = "opencode models --verbose";
export const MODEL_CATALOG_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const VALID_SOURCE_STATUSES = new Set<ModelCatalogSourceStatus>([
  "runnable",
  "unavailable",
  "not_installed",
  "installed_but_broken",
  "service_unavailable"
]);

const VALID_TRANSPORTS = new Set<ModelCatalogSource["transport"]>([
  "http",
  "stdio-jsonrpc",
  "cli-stdio",
  "acp-stdio",
  "acp-http",
  "rpc-stdio"
]);

const VALID_SESSION_KINDS = new Set<ModelCatalogSource["sessionKind"]>([
  "server-session",
  "app-server-thread",
  "logical-session",
  "process-session"
]);

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

function parseReasoningCapability(value: unknown, filePath: string, fieldPath: string): ReasoningCapability | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, filePath, fieldPath);
  const supported = asBoolean(record.supported, filePath, `${fieldPath}.supported`);
  const kind = asString(record.kind, filePath, `${fieldPath}.kind`);
  const levels = asStringArray(record.levels, filePath, `${fieldPath}.levels`);
  const defaultLevel = asOptionalString(record.default, filePath, `${fieldPath}.default`);
  if (kind === "none") {
    if (supported || levels.length > 0 || defaultLevel !== undefined) {
      fail(filePath, fieldPath, "kind none must be unsupported and have no levels or default");
    }
    return { supported: false, kind: "none", levels: [] };
  }
  if (!supported) fail(filePath, fieldPath, "effort and toggle capabilities must be supported");
  if (levels.length === 0) fail(filePath, fieldPath, "supported reasoning capability must declare at least one level");
  if (kind === "toggle") {
    if (levels.some((level) => level !== "off" && level !== "on")) {
      fail(filePath, fieldPath, "toggle levels must be off or on");
    }
    if (defaultLevel !== undefined && defaultLevel !== "off" && defaultLevel !== "on") {
      fail(filePath, fieldPath, "toggle default must be off or on");
    }
    return { supported: true, kind: "toggle", levels: levels as Array<"off" | "on">, ...(defaultLevel ? { default: defaultLevel as "off" | "on" } : {}) };
  }
  if (kind === "effort") {
    const effortLevels = new Set<ReasoningEffortLevel>(["off", "low", "medium", "high", "xhigh", "max"]);
    if (levels.some((level) => !effortLevels.has(level as ReasoningEffortLevel))) {
      fail(filePath, fieldPath, "effort levels must be off, low, medium, high, xhigh, or max");
    }
    if (defaultLevel !== undefined && !effortLevels.has(defaultLevel as ReasoningEffortLevel)) {
      fail(filePath, fieldPath, "effort default must be a supported effort level");
    }
    return { supported: true, kind: "effort", levels: levels as Array<Exclude<ReasoningEffortLevel, "on">>, ...(defaultLevel ? { default: defaultLevel as Exclude<ReasoningEffortLevel, "on"> } : {}) };
  }
  fail(filePath, fieldPath, `unsupported reasoning kind "${kind}"`);
}

export function validateModelCatalog(value: unknown, filePath: string): ModelCatalog {
  const record = asRecord(value, filePath, "$");
  const catalogVersion = asString(record.catalogVersion, filePath, "$.catalogVersion");
  if (catalogVersion !== "4") {
    fail(filePath, "$.catalogVersion", `MODEL_CATALOG_REBUILD_REQUIRED: catalog version "${catalogVersion}" is no longer supported. Run \`ogs models sync\` to rebuild the catalog.`);
  }
  if (!Array.isArray(record.sources)) {
    fail(filePath, "$.sources", "expected array");
  }
  const sources = record.sources.map((entry, index): ModelCatalogSource => {
    const source = asRecord(entry, filePath, `$.sources[${index}]`);
    const backend = asString(source.backend, filePath, `$.sources[${index}].backend`);
    const descriptor = defaultBackendRegistry.getDescriptor(backend);
    const displayName = asOptionalString(source.displayName, filePath, `$.sources[${index}].displayName`)
      ?? descriptor?.displayName
      ?? backend;
    const iconKey = asOptionalString(source.iconKey, filePath, `$.sources[${index}].iconKey`)
      ?? descriptor?.iconKey
      ?? backend;
    const rawTransport = asOptionalString(source.transport, filePath, `$.sources[${index}].transport`)
      ?? descriptor?.transport
      ?? "cli-stdio";
    if (!VALID_TRANSPORTS.has(rawTransport as ModelCatalogSource["transport"])) {
      fail(filePath, `$.sources[${index}].transport`, `unsupported transport "${rawTransport}"`);
    }
    const rawSessionKind = asOptionalString(source.sessionKind, filePath, `$.sources[${index}].sessionKind`)
      ?? descriptor?.sessionKind
      ?? "logical-session";
    if (!VALID_SESSION_KINDS.has(rawSessionKind as ModelCatalogSource["sessionKind"])) {
      fail(filePath, `$.sources[${index}].sessionKind`, `unsupported sessionKind "${rawSessionKind}"`);
    }
    const processOwnership = asOptionalString(source.processOwnership, filePath, `$.sources[${index}].processOwnership`) ?? "spawned_by_ogs";
    if (processOwnership !== "spawned_by_ogs" && processOwnership !== "attached_external") {
      fail(filePath, `$.sources[${index}].processOwnership`, `unsupported processOwnership "${processOwnership}"`);
    }
    const status = asString(source.status, filePath, `$.sources[${index}].status`);
    if (!VALID_SOURCE_STATUSES.has(status as ModelCatalogSourceStatus)) {
      fail(
        filePath,
        `$.sources[${index}].status`,
        `expected one of ${[...VALID_SOURCE_STATUSES].join(", ")}`
      );
    }
    const detail = asOptionalString(source.detail, filePath, `$.sources[${index}].detail`);
    return {
      backend,
      displayName,
      iconKey,
      transport: rawTransport as ModelCatalogSource["transport"],
      sessionKind: rawSessionKind as ModelCatalogSource["sessionKind"],
      processOwnership,
      status: status as ModelCatalogSourceStatus,
      ...(detail ? { detail } : {})
    };
  });

  const modelsValue = record.models;
  if (!Array.isArray(modelsValue)) {
    fail(filePath, "$.models", "expected array");
  }
  const models = modelsValue.map((entry, index): ModelCatalogEntry => {
    const modelRecord = asRecord(entry, filePath, `$.models[${index}]`);
    const capabilities = asRecord(modelRecord.capabilities, filePath, `$.models[${index}].capabilities`);
    const backend = asString(modelRecord.backend, filePath, `$.models[${index}].backend`);
    const modelId = asString(modelRecord.modelId, filePath, `$.models[${index}].modelId`);
    const name = asOptionalString(modelRecord.name, filePath, `$.models[${index}].name`);
    const status = asOptionalString(modelRecord.status, filePath, `$.models[${index}].status`);
    return {
      backend,
      modelId,
      runnable: modelRecord.runnable === true,
      ...(name ? { name } : {}),
      ...(status ? { status } : {}),
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
      ...(modelRecord.reasoning !== undefined
        ? { reasoning: parseReasoningCapability(modelRecord.reasoning, filePath, `$.models[${index}].reasoning`) }
        : {})
    };
  });

  return {
    catalogVersion: "4",
    generatedAt: asString(record.generatedAt, filePath, "$.generatedAt"),
    sources,
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
  modelId: string;
  raw: RawOpencodeModelRecord;
}): ModelCatalogEntry {
  const separator = args.modelId.indexOf("/");
  if (separator <= 0 || separator === args.modelId.length - 1) {
    throw new Error(`Invalid OpenCode model reference from verbose output: ${args.modelId}`);
  }
  return {
    backend: "opencode",
    modelId: args.modelId,
    runnable: true,
    ...(args.raw.name ? { name: args.raw.name } : {}),
    ...(args.raw.status ? { status: args.raw.status } : {}),
    capabilities: {
      textInput: args.raw.capabilities?.input?.text === true,
      textOutput: args.raw.capabilities?.output?.text === true,
      toolcall: args.raw.capabilities?.toolcall === true
    },
    variants: Object.keys(args.raw.variants ?? {}).sort((left, right) => left.localeCompare(right))
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
    const modelId = lines[index]?.trim();
    if (!modelId || !/^[^/\s]+\/.+/.test(modelId)) {
      throw discoveryMalformed(`expected a modelId reference, got "${modelId ?? ""}"`);
    }
    index += 1;
    if (index >= lines.length || !lines[index].trim().startsWith("{")) {
      throw discoveryMalformed(`model "${modelId}" is missing its JSON record`);
    }
    const jsonLines: string[] = [];
    let parsed: RawOpencodeModelRecord | undefined;
    while (index < lines.length) {
      jsonLines.push(lines[index]);
      const joined = jsonLines.join("\n");
      try {
        const candidate = JSON.parse(joined) as unknown;
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
          throw discoveryMalformed(`model "${modelId}" JSON record must be an object`);
        }
        parsed = candidate as RawOpencodeModelRecord;
        index += 1;
        break;
      } catch (error) {
        if (error instanceof ModelDiscoveryError) {
          throw error;
        }
        if (index === lines.length - 1) {
          throw discoveryMalformed(`model "${modelId}" JSON record could not be parsed`);
        }
        index += 1;
      }
    }
    if (!parsed) {
      throw discoveryMalformed(`model "${modelId}" JSON record is incomplete`);
    }
    if (models.some((model) => model.modelId === modelId)) {
      throw discoveryMalformed(`duplicate model reference "${modelId}"`);
    }
    try {
      models.push(normalizeRawOpencodeModel({ modelId, raw: parsed }));
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
    catalogVersion: "4",
    generatedAt: new Date().toISOString(),
    sources: [
      {
        backend: "opencode",
        displayName: "OpenCode",
        iconKey: "opencode",
        transport: "http",
        sessionKind: "server-session",
        processOwnership: "spawned_by_ogs",
        status: "runnable"
      }
    ],
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

export async function runOpencodeModelsVerbose(
  workdir: string,
  commandRunner?: DiscoveryCommandRunner,
  timeoutMs = 5000
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
        "Fix the OpenCode command or configuration, then rerun `ogs project sync-models`."
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
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
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
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new ModelDiscoveryError(
          "MODEL_DISCOVERY_NONZERO_EXIT",
          `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} timed out after ${timeoutMs}ms.`,
          "Check the OpenCode installation and configuration, then rerun `ogs project sync-models`."
        ));
        return;
      }
      if (code !== 0) {
        reject(
          new ModelDiscoveryError(
            "MODEL_DISCOVERY_NONZERO_EXIT",
            `OpenCode ${OPENCODE_MODEL_DISCOVERY_COMMAND} exited with code ${code}: ${stderr.trim() || "unknown error"}`,
            "Fix the OpenCode command or configuration, then rerun `ogs project sync-models`."
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

export async function discoverLocalModelCatalog(args: {
  workdir: string;
  commandRunner?: DiscoveryCommandRunner;
  preferredModelIdsByBackend?: Record<string, string[]>;
}): Promise<ModelCatalog> {
  const outcomes = await Promise.all(defaultBackendRegistry.listBackendIds().map((backendId) =>
    defaultBackendRegistry.discoverBackend(backendId, {
      ...args,
      preferredModelIds: args.preferredModelIdsByBackend?.[backendId]
    })
  ));
  const sources = outcomes.map((outcome) => outcome.source);
  const models = outcomes.flatMap((outcome) => outcome.models);

  return {
    catalogVersion: "4",
    generatedAt: new Date().toISOString(),
    sources,
    models
  };
}

export async function loadModelCatalog(path: string): Promise<ModelCatalog | undefined> {
  if (!(await pathExists(path))) {
    return undefined;
  }
  return validateModelCatalog(await readJsonFile(path), path);
}

export function mergeModelCatalogWithLiveSnapshot(
  stored: ModelCatalog | undefined,
  liveModels: ModelCatalogEntry[] | undefined,
  generatedAt?: string
): ModelCatalog | undefined {
  if (!Array.isArray(liveModels) || liveModels.length === 0) return stored;
  const models = new Map((stored?.models ?? []).map((model) => [`${model.backend}:${model.modelId}`, model]));
  for (const model of liveModels) {
    models.set(`${model.backend}:${model.modelId}`, {
      backend: model.backend,
      modelId: model.modelId,
      runnable: Boolean(model.runnable),
      ...(model.name ? { name: model.name } : {}),
      ...(model.status ? { status: model.status } : {}),
      capabilities: model.capabilities,
      variants: model.variants ?? [],
      ...(model.reasoning ? { reasoning: model.reasoning } : {})
    });
  }
  return {
    catalogVersion: "4",
    generatedAt: generatedAt || stored?.generatedAt || new Date().toISOString(),
    sources: stored?.sources ?? [],
    models: [...models.values()]
  };
}

export function chooseDefaultModelFromCatalog(catalog: ModelCatalog): ModelCatalogEntry | undefined {
  return catalog.models.find(
    (model) =>
      model.runnable &&
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
