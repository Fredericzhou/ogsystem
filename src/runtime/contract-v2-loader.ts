import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { assertV2ContractRoot, type ContractRoot, type ExecutionBindingsV2, type HarnessTemplateV2 } from "./contract-v2.js";
import { listJsonSchemaIssues } from "./json-schema.js";

const CONTRACT_SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../schemas/contract-v2.schema.json");
let contractSchemaPromise: Promise<unknown> | undefined;

async function loadContractSchema(): Promise<unknown> {
  contractSchemaPromise ??= readFile(CONTRACT_SCHEMA_PATH, "utf8").then((source) => JSON.parse(source));
  return contractSchemaPromise;
}
/**
 * Load one persisted Contract Set v2 root.  This is intentionally strict:
 * callers must opt into a separate historical archive reader for v1 data.
 */
export async function loadV2ContractFile<T extends ContractRoot = ContractRoot>(path: string): Promise<T> {
  const source = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = extname(path).toLowerCase() === ".json" ? JSON.parse(source) : parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid v2 contract syntax in ${path}: ${message}`);
  }
  await validateV2ContractValue(value, path);
  return value as T;
}
/** Validate an in-memory v2 contract with the same schema used by persisted files. */
export async function validateV2ContractValue(value: unknown, subject = "contract"): Promise<void> {
  assertV2ContractRoot(value, subject);
  const issues = listJsonSchemaIssues({ schema: await loadContractSchema(), data: value });
  if (issues.length > 0) {
    throw new Error(`Invalid v2 contract schema in ${subject}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
}
/**
 * Load the v2 technical binding index.  The index is optional for projects
 * which use the generated Backend default, but when present it is authoritative
 * and must contain a complete Harness Template for every referenced Role.
 */
export async function loadExecutionBindingsV2(path: string): Promise<ExecutionBindingsV2> {
  const value = await loadV2ContractFile<ExecutionBindingsV2>(path);
  if (!value.roles || typeof value.roles !== "object" || Array.isArray(value.roles)) {
    throw new Error(`${path}.roles must be an object`);
  }
  const templates = value.harnessTemplates ?? {};
  for (const [templateId, template] of Object.entries(templates)) {
    if (!template || typeof template !== "object" || template.templateId !== templateId) {
      throw new Error(`${path}.harnessTemplates.${templateId} must have matching templateId`);
    }
    validateHarnessTemplate(template, `${path}.harnessTemplates.${templateId}`);
  }
  for (const [roleId, binding] of Object.entries(value.roles)) {
    if (!binding || binding.kind !== "harness" || typeof binding.harnessTemplate !== "string" || !binding.harnessTemplate.trim()) {
      throw new Error(`${path}.roles.${roleId} must reference a Harness Template`);
    }
    if (!templates[binding.harnessTemplate]) {
      throw new Error(`${path}.roles.${roleId}.harnessTemplate is unresolved: ${binding.harnessTemplate}`);
    }
  }
  if (value.defaults?.harnessTemplate && !templates[value.defaults.harnessTemplate]) {
    throw new Error(`${path}.defaults.harnessTemplate is unresolved: ${value.defaults.harnessTemplate}`);
  }
  return value;
}
/**
 * A v2 project must not accidentally retain the v1 fixed-command registry.
 * Keep this check at the v2 asset boundary so Runtime, snapshot, and future
 * callers share the same fail-closed rule instead of silently ignoring files.
 */
export async function assertNoLegacyV1ExecutionAssets(workdir: string): Promise<void> {
  const root = resolve(workdir);
  // model-selection was historically stored under .ogs, while the fixed
  // profile/tool registries lived at the project root. Check both locations
  // so a stale v1 asset cannot be silently ignored by a v2 entry point.
  const paths = [
    ...["model-selection.json", "profiles.json", "tools.json"].flatMap((name) => [
      resolve(root, name),
      resolve(root, ".ogs", name)
    ])
  ];
  for (const path of paths) {
    const entry = await lstat(path).catch(() => undefined);
    if (!entry) continue;
    throw new Error(`V2_LEGACY_EXECUTION_ASSET: ${path} is not accepted with Contract Set v2; remove legacy execution assets and bind Roles through Harness Templates.`);
  }
}
function validateHarnessTemplate(template: HarnessTemplateV2, path: string): void {
  if (!template.backend.trim() || !template.model.trim()) throw new Error(`${path} requires backend and model`);
  if (!Array.isArray(template.allowedTools) || template.allowedTools.some((tool) => typeof tool !== "string" || !tool.trim())) {
    throw new Error(`${path}.allowedTools must contain non-empty strings`);
  }
  if (!template.environment || typeof template.environment !== "object") throw new Error(`${path}.environment is required`);
  const environment = template.environment as Record<string, unknown>;
  if (!("filesystem" in environment) || !("process" in environment) || !("network" in environment)) {
    throw new Error(`${path}.environment must declare filesystem, process, and network`);
  }
}
// End of the V2 contract loader.
