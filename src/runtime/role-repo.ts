/**
 * @fileoverview Role package loader, prompt rendering, and schema contract checks.
 * File Set: runtime-exec
 * Responsibilities:
 * - Load role manifests/templates/schemas from role repository.
 * - Validate the current Role Manifest and role I/O payloads against their schemas.
 * Boundaries:
 * - Does not schedule graph transitions or execute external tools/models.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readJsonFile } from "./json-file.js";
import { assertJsonSchema } from "./json-schema.js";
import { validateConditionAst } from "./condition-ast.js";
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

function purposeNamesConcreteEntity(purpose: string): boolean {
  // Keep this lexical and conservative: generic responsibility terms such as
  // "human review" and "Model QA" are valid, while explicit identity markers
  // and well-known provider/model/runtime identifiers are not.
  const providerOrModel = /\b(?:OpenAI|Anthropic|Mistral|Cohere|DeepSeek|Qwen|xAI|Azure\s+OpenAI)\b|\b(?:ChatGPT|Copilot|Grok|Gemini|Claude|GPT(?:[-\s]?\d+(?:\.\d+)?)?|Llama(?:[-\s]?\d+(?:\.\d+)?)?|o[1-9](?:[-\s](?:mini|preview))?)\b|\b(?:OpenAI|Anthropic|Google(?:\s+DeepMind)?|Microsoft|Meta|Alibaba)\s+(?:ChatGPT|Copilot|Grok|Gemini|Claude|GPT|Llama|Qwen|model)\b|\b(?:openai|anthropic|google|microsoft|azure|amazon|aws|meta|mistral|cohere|deepseek|qwen|alibaba|xai)\/[A-Za-z0-9._-]+\b/i;
  const explicitVendor = /\b(?:provider|vendor|service)\s*(?:is|:)\s*[A-Za-z][A-Za-z0-9._/-]*\b|\b[A-Z][A-Za-z0-9.-]+\s+(?:provider|vendor)\b/i;
  const identifiedPerson = /\b(?:person|operator|owner|assignee|assigned\s+to|maintained\s+by|managed\s+by|reviewed\s+by)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/;
  const runtimeInstance = /\b(?:runtime\s+instance|run\s+instance|execution\s+instance)\b|\b(?:session|branch|run|execution|instance)[-_ ](?:id|instance)\b|\b(?:run|execution|session|branch|instance)[-_ ](?:\d+|#\d+|[a-z]*\d[a-z0-9-]*|[a-f0-9]{8,})\b/i;
  return providerOrModel.test(purpose) || explicitVendor.test(purpose) || identifiedPerson.test(purpose) || runtimeInstance.test(purpose);
}

function expectPurpose(value: unknown, filePath: string): string {
  const purpose = expectString(value, filePath, "$.purpose");
  if (purposeNamesConcreteEntity(purpose)) {
    fail(filePath, "$.purpose", "must describe an abstract responsibility and must not name a person, model, provider, or runtime instance");
  }
  return purpose;
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

function expectSortedUniqueStrings(value: unknown, filePath: string, fieldPath: string): string[] {
  if (!Array.isArray(value)) fail(filePath, fieldPath, `expected array, received ${describeType(value)}`);
  const result = value.map((entry, index) => expectString(entry, filePath, `${fieldPath}[${index}]`));
  if (new Set(result).size !== result.length) fail(filePath, fieldPath, "must not contain duplicates");
  if (result.some((item, index) => index > 0 && result[index - 1].localeCompare(item) >= 0)) fail(filePath, fieldPath, "must be stable sorted");
  return result;
}

function expectContract(value: unknown, filePath: string): Pick<RolePackageManifest, "contractVersion" | "purpose" | "responsibility" | "inputs" | "outputs" | "authority" | "constraints" | "failure" | "audit"> {
  const contract = expectRecord(value, filePath, "$");
  const responsibility = expectRecord(contract.responsibility, filePath, "$.responsibility");
  const inputs = expectRecord(contract.inputs, filePath, "$.inputs");
  const outputs = expectRecord(contract.outputs, filePath, "$.outputs");
  const authority = expectRecord(contract.authority, filePath, "$.authority");
  const constraints = expectRecord(contract.constraints, filePath, "$.constraints");
  const failure = expectRecord(contract.failure, filePath, "$.failure");
  const audit = expectRecord(contract.audit, filePath, "$.audit");
  expectNoExtraKeys(responsibility, ["kind", "owns", "contributes", "doesNotOwn", "composition"], filePath, "$.responsibility");
  expectNoExtraKeys(inputs, ["preconditions"], filePath, "$.inputs");
  expectNoExtraKeys(outputs, ["events", "postconditions"], filePath, "$.outputs");
  expectNoExtraKeys(authority, ["controlActions"], filePath, "$.authority");
  expectNoExtraKeys(constraints, ["writableStateFields", "allowedTools"], filePath, "$.constraints");
  expectNoExtraKeys(failure, ["retryableErrorCodes", "terminalErrorCodes"], filePath, "$.failure");
  expectNoExtraKeys(audit, ["requiredFields"], filePath, "$.audit");
  if (contract.contractVersion !== 1) fail(filePath, "$.contractVersion", "must equal 1");
  const purpose = expectPurpose(contract.purpose, filePath);
  const kind = contract.responsibility && typeof contract.responsibility === "object" && !Array.isArray(contract.responsibility)
    ? contract.responsibility.kind
    : undefined;
  if (kind !== "atomic" && kind !== "composite") fail(filePath, "$.responsibility.kind", "must be atomic or composite");
  const owns = expectSortedUniqueStrings(responsibility.owns, filePath, "$.responsibility.owns");
  const contributes = expectSortedUniqueStrings(responsibility.contributes, filePath, "$.responsibility.contributes");
  const doesNotOwn = expectSortedUniqueStrings(responsibility.doesNotOwn, filePath, "$.responsibility.doesNotOwn");
  if (owns.some((field) => doesNotOwn.includes(field)) || contributes.some((field) => doesNotOwn.includes(field))) fail(filePath, "$.responsibility", "doesNotOwn must not overlap owns or contributes");
  const compositionValue = responsibility.composition;
  if (kind === "atomic" && compositionValue !== undefined) fail(filePath, "$.responsibility.composition", "is only valid for composite responsibilities");
  let composition: RolePackageManifest["responsibility"]["composition"];
  if (kind === "composite") {
    const item = expectRecord(compositionValue, filePath, "$.responsibility.composition");
    expectNoExtraKeys(item, ["nestedSystemRef", "inputContract", "outputContract", "stateNamespace", "checkpointNamespace", "errorPropagation", "terminationPropagation"], filePath, "$.responsibility.composition");
    const errorPropagation = expectString(item.errorPropagation, filePath, "$.responsibility.composition.errorPropagation") as "fail" | "route" | "contain";
    const terminationPropagation = expectString(item.terminationPropagation, filePath, "$.responsibility.composition.terminationPropagation") as "propagate" | "contain";
    if (!["fail", "route", "contain"].includes(errorPropagation)) fail(filePath, "$.responsibility.composition.errorPropagation", "contains unsupported value");
    if (!["propagate", "contain"].includes(terminationPropagation)) fail(filePath, "$.responsibility.composition.terminationPropagation", "contains unsupported value");
    composition = {
      nestedSystemRef: expectString(item.nestedSystemRef, filePath, "$.responsibility.composition.nestedSystemRef"),
      inputContract: expectString(item.inputContract, filePath, "$.responsibility.composition.inputContract"),
      outputContract: expectString(item.outputContract, filePath, "$.responsibility.composition.outputContract"),
      stateNamespace: expectString(item.stateNamespace, filePath, "$.responsibility.composition.stateNamespace"),
      checkpointNamespace: expectString(item.checkpointNamespace, filePath, "$.responsibility.composition.checkpointNamespace"),
      errorPropagation,
      terminationPropagation
    };
  }
  const preconditions = inputs.preconditions;
  const postconditions = outputs.postconditions;
  if (!Array.isArray(preconditions) || !Array.isArray(postconditions)) fail(filePath, "$.inputs/outputs", "conditions must be arrays");
  for (const [path, conditions] of [["$.inputs.preconditions", preconditions], ["$.outputs.postconditions", postconditions]] as const) {
    conditions.forEach((condition, index) => { const diagnostics = validateConditionAst(condition); if (diagnostics.length) fail(filePath, `${path}[${index}]`, diagnostics.join(", ")); });
  }
  const controlActions = expectSortedUniqueStrings(authority.controlActions, filePath, "$.authority.controlActions") as RolePackageManifest["authority"]["controlActions"];
  if (!controlActions.every((action) => ["approve", "rework", "pause", "terminate"].includes(action))) fail(filePath, "$.authority.controlActions", "contains unsupported action");
  const retryableErrorCodes = expectSortedUniqueStrings(failure.retryableErrorCodes, filePath, "$.failure.retryableErrorCodes");
  const terminalErrorCodes = expectSortedUniqueStrings(failure.terminalErrorCodes, filePath, "$.failure.terminalErrorCodes");
  if (![...retryableErrorCodes, ...terminalErrorCodes].every((code) => /^[A-Z][A-Z0-9_]*$/.test(code))) fail(filePath, "$.failure", "error codes must be stable uppercase identifiers");
  if (retryableErrorCodes.some((code) => terminalErrorCodes.includes(code))) fail(filePath, "$.failure", "an error code cannot be both retryable and terminal");
  return { contractVersion: 1, purpose, responsibility: { kind, owns, contributes, doesNotOwn, ...(composition ? { composition } : {}) }, inputs: { preconditions: preconditions as any[] }, outputs: { events: expectSortedUniqueStrings(outputs.events, filePath, "$.outputs.events"), postconditions: postconditions as any[] }, authority: { controlActions }, constraints: { writableStateFields: expectSortedUniqueStrings(constraints.writableStateFields, filePath, "$.constraints.writableStateFields"), allowedTools: expectSortedUniqueStrings(constraints.allowedTools, filePath, "$.constraints.allowedTools") }, failure: { retryableErrorCodes, terminalErrorCodes }, audit: { requiredFields: expectSortedUniqueStrings(audit.requiredFields, filePath, "$.audit.requiredFields") } };
}

function validateAuditFields(manifest: RolePackageManifest, outputSchema: unknown, filePath: string): void {
  const builtInAuditFields = new Set([
    "at", "roleId", "branchId", "joinId", "loopIteration", "lawRef", "modelId", "profileId", "toolRef",
    "command", "args", "sessionId", "messageId", "serverPid", "exitCode", "durationMs", "selectedEvent",
    "nextRoleId", "status", "stdoutPreview", "stderrPreview", "error", "errorEnvelope", "compilerDigest",
    "compilerDiagnosticCode", "repair", "correctionRequest", "inputContext", "handledByEvent", "handledTargetRoleId"
  ]);
  const properties = outputSchema && typeof outputSchema === "object" && !Array.isArray(outputSchema)
    ? (outputSchema as { properties?: unknown }).properties
    : undefined;
  const outputFields = properties && typeof properties === "object" && !Array.isArray(properties)
    ? new Set(Object.keys(properties as Record<string, unknown>))
    : new Set<string>();
  for (const field of manifest.audit.requiredFields) {
    if (!builtInAuditFields.has(field) && !outputFields.has(field)) fail(filePath, "$.audit.requiredFields", `unknown audit or output field ${field}`);
  }
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
  // Role Contract sections are mandatory in the current development-test format.
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(
    record,
    [
      "roleId",
      "roleVersion",
      "name",
      "description",
      "promptTemplate",
      "outputSchema",
      "contractVersion", "purpose", "responsibility", "inputs", "outputs", "authority", "constraints", "failure", "audit",
      "preferredModelTags",
      "tags"
    ],
    filePath,
    "$"
  );

  const description = expectString(record.description, filePath, "$.description");
  const manifest = {
    roleId: expectString(record.roleId, filePath, "$.roleId"),
    roleVersion: expectString(record.roleVersion, filePath, "$.roleVersion"),
    name: expectString(record.name, filePath, "$.name"),
    description,
    promptTemplate: expectString(record.promptTemplate, filePath, "$.promptTemplate"),
    outputSchema: expectString(record.outputSchema, filePath, "$.outputSchema"),
    preferredModelTags: expectOptionalStringArray(
      record.preferredModelTags,
      filePath,
      "$.preferredModelTags"
    ),
    tags: expectOptionalStringArray(record.tags, filePath, "$.tags"),
    ...expectContract(record, filePath)
  };
  return manifest;
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
  const outputSchemaPath = resolve(resolvedPath, manifest.outputSchema);
  const promptTemplate = await readFile(promptTemplatePath, "utf8");
  const outputSchema = await readJsonFile(outputSchemaPath);
  validateAuditFields(manifest, outputSchema, manifestPath);
  const agent = await readFile(resolve(resolvedPath, "agent.md"), "utf8");

  return {
    resolvedPath,
    manifest,
    promptTemplate,
    outputSchema,
    outputSchemaPath,
    agent
  };
}

export function renderRolePrompt(args: {
  promptTemplate: string;
  agent: string;
  values: Record<string, string>;
}): string {
  const variables: Record<string, string> = {
    agent: args.agent.trim(),
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
