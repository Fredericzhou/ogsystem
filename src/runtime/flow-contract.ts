/**
 * Loads and evaluates flow-contract bundles so the runtime can keep contract checks separate from
 * role schemas without introducing a second execution engine.
 * Boundaries:
 * - This module only compiles contract files and validates projected payloads against JSON Schema.
 * - It does not schedule graph transitions or mutate runtime state.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { readJsonFile } from "./json-file.js";
import { listJsonSchemaIssues } from "./json-schema.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type {
  CompiledFlowContract,
  FlowContractDefinition,
  FlowContractFile,
  FlowContractPlan,
  FlowContractViolationPolicy,
  HandoffMode,
  SystemDefinition
} from "./types.js";
import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";

type FlowContractSourceRecord = {
  id: string;
  kind: "flow" | "role_input";
  match: Record<string, string>;
  onViolation: FlowContractViolationPolicy;
  schema: unknown;
  schemaPath: string;
};

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeValue((value as Record<string, unknown>)[key])])
    );
  }
  return value ?? null;
}

function digestValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalizeValue(value))).digest("hex");
}

function fail(message: string): never {
  throw new Error(message);
}

function expectRecord(value: unknown, filePath: string, fieldPath: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`Invalid contract file in ${filePath} at ${fieldPath}: expected object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, filePath: string, fieldPath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(`Invalid contract file in ${filePath} at ${fieldPath}: expected non-empty string`);
  }
  return value.trim();
}

function expectOptionalViolation(
  value: unknown,
  filePath: string,
  fieldPath: string
): FlowContractViolationPolicy {
  if (value === undefined) {
    return "FAIL";
  }
  if (value === "FAIL" || value === "WARN") {
    return value;
  }
  fail(`Invalid contract file in ${filePath} at ${fieldPath}: expected FAIL or WARN`);
}

function expectContractFile(value: unknown, filePath: string): FlowContractFile {
  const record = expectRecord(value, filePath, "$");
  if (record.version !== 1) {
    fail(`Invalid contract file in ${filePath} at $.version: expected 1`);
  }
  if (!Array.isArray(record.contracts)) {
    fail(`Invalid contract file in ${filePath} at $.contracts: expected array`);
  }

  const contracts = record.contracts.map((entry, index) => {
    const contract = expectRecord(entry, filePath, `$.contracts[${index}]`);
    const id = expectString(contract.id, filePath, `$.contracts[${index}].id`);
    const kind = expectString(contract.kind, filePath, `$.contracts[${index}].kind`);
    if (kind !== "flow" && kind !== "role_input") {
      fail(`Invalid contract file in ${filePath} at $.contracts[${index}].kind: expected flow or role_input`);
    }
    const match = expectRecord(contract.match, filePath, `$.contracts[${index}].match`);
    const schema = expectString(contract.schema, filePath, `$.contracts[${index}].schema`);
    const onViolation = expectOptionalViolation(
      contract.onViolation,
      filePath,
      `$.contracts[${index}].onViolation`
    );

    return {
      id,
      kind: kind as "flow" | "role_input",
      match: Object.fromEntries(
        Object.entries(match).map(([key, entryValue]) => [key, expectString(entryValue, filePath, `$.contracts[${index}].match.${key}`)])
      ),
      schema,
      onViolation
    } satisfies FlowContractDefinition;
  });

  return {
    version: 1,
    contracts
  };
}

function validateContractSchema(schema: unknown, schemaPath: string): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    fail(`Invalid contract schema in ${schemaPath}: expected JSON object`);
  }
}

function buildFlowContractKey(args: {
  fromRoleId: string;
  toRoleId: string;
  eventType?: string;
  mode?: "split";
}): string {
  return args.mode === "split"
    ? `split:${args.fromRoleId}:${args.toRoleId}`
    : `flow:${args.fromRoleId}:${args.eventType}:${args.toRoleId}`;
}

function isEligibleFlowEdge(args: {
  system: SystemDefinition;
  fromRoleId: string;
  eventType: string;
  toRoleId: string;
}): boolean {
  if (args.toRoleId === SYSTEM_END_ROLE_ID) {
    return false;
  }
  if (isRuntimeOnlyErrorEvent(args.eventType)) {
    return false;
  }
  return true;
}

function normalizeFlowContractDefinition(definition: FlowContractDefinition): FlowContractSourceRecord {
  const onViolation = definition.onViolation ?? "FAIL";
  if (definition.kind === "flow") {
    if (!definition.match.fromRoleId || !definition.match.toRoleId) {
      fail(`Invalid flow contract "${definition.id}": fromRoleId and toRoleId are required`);
    }
    if (definition.match.mode === "split") {
      if (definition.match.eventType) {
        fail(`Invalid flow contract "${definition.id}": split contracts must not declare eventType`);
      }
    } else if (!definition.match.eventType) {
      fail(`Invalid flow contract "${definition.id}": eventType is required for ordinary flows`);
    }
  }

  if (definition.kind === "role_input") {
    if (!definition.match.roleId) {
      fail(`Invalid role_input contract "${definition.id}": roleId is required`);
    }
  }

  return {
    id: definition.id,
    kind: definition.kind,
    match: { ...definition.match },
    onViolation,
    schema: undefined,
    schemaPath: definition.schema
  };
}

function buildNormalizedContractDigest(contracts: Array<FlowContractSourceRecord & { schema: unknown }>): string {
  return digestValue(
    contracts.map((contract) => ({
      id: contract.id,
      kind: contract.kind,
      match: contract.match,
      onViolation: contract.onViolation,
      schema: contract.schema
    }))
  );
}

export function buildFlowContractKeyForFlow(args: {
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
}): string {
  return buildFlowContractKey(args);
}

export function buildFlowContractKeyForSplit(args: {
  fromRoleId: string;
  toRoleId: string;
}): string {
  return buildFlowContractKey({
    fromRoleId: args.fromRoleId,
    toRoleId: args.toRoleId,
    mode: "split"
  });
}

export async function loadFlowContractPlan(args: {
  system: SystemDefinition;
  contractPath: string;
}): Promise<FlowContractPlan> {
  const source = expectContractFile(await readJsonFile(args.contractPath), args.contractPath);
  const baseDir = dirname(args.contractPath);
  const compiledContracts: Array<FlowContractSourceRecord & { schema: unknown }> = [];
  const flowContractsByKey = new Map<string, CompiledFlowContract>();
  const roleInputContractsByRoleId = new Map<string, CompiledFlowContract>();

  for (const contract of source.contracts) {
    const normalized = normalizeFlowContractDefinition(contract);
    const schemaPath = resolve(baseDir, normalized.schemaPath);
    const schema = await readJsonFile(schemaPath);
    validateContractSchema(schema, schemaPath);
    compiledContracts.push({
      ...normalized,
      schema
    });

    const compiled: CompiledFlowContract = {
      definition: contract,
      schema,
      schemaPath
    };

    if (contract.kind === "flow") {
      const fromRoleId = contract.match.fromRoleId!;
      const toRoleId = contract.match.toRoleId!;
      if (!args.system.roleIds.includes(fromRoleId)) {
        fail(`Unbound flow contract "${contract.id}": undefined fromRoleId "${fromRoleId}"`);
      }
      if (!args.system.roleIds.includes(toRoleId)) {
        fail(`Unbound flow contract "${contract.id}": undefined toRoleId "${toRoleId}"`);
      }
      const fromNodeMode = args.system.graph?.routingModeByRoleId[fromRoleId];
      const key = contract.match.mode === "split"
        ? buildFlowContractKeyForSplit({ fromRoleId, toRoleId })
        : buildFlowContractKeyForFlow({
            fromRoleId,
            toRoleId,
            eventType: contract.match.eventType!
          });
      if (flowContractsByKey.has(key)) {
        fail(`Duplicate flow contract binding for "${key}"`);
      }
      if (contract.match.mode === "split" && fromNodeMode !== "parallel_split") {
        fail(`Flow contract "${contract.id}" uses mode=split but role "${fromRoleId}" is not parallel_split`);
      }
      if (contract.match.mode !== "split") {
        const hasMatchingEdge = args.system.flows.some(
          (flow) =>
            flow.fromRoleId === fromRoleId &&
            flow.toRoleId === toRoleId &&
            flow.eventType === contract.match.eventType
        );
        if (!hasMatchingEdge) {
          fail(`Unbound flow contract "${contract.id}": no matching flow edge in system`);
        }
      }
      flowContractsByKey.set(key, compiled);
      continue;
    }

    const roleId = contract.match.roleId!;
    if (!args.system.roleIds.includes(roleId)) {
      fail(`Unbound role_input contract "${contract.id}": undefined roleId "${roleId}"`);
    }
    if (roleInputContractsByRoleId.has(roleId)) {
      fail(`Duplicate role_input contract binding for role "${roleId}"`);
    }
    if (!args.system.graph?.contextMapByRoleId[roleId]) {
      fail(`role_input contract "${contract.id}" requires context.map.${roleId}.* metadata`);
    }
    roleInputContractsByRoleId.set(roleId, compiled);
  }

  const eligibleFlowKeys = new Set<string>();
  for (const flow of args.system.flows) {
    if (!isEligibleFlowEdge({
      system: args.system,
      fromRoleId: flow.fromRoleId,
      eventType: flow.eventType,
      toRoleId: flow.toRoleId
    })) {
      continue;
    }
    const routingMode = args.system.graph?.routingModeByRoleId[flow.fromRoleId];
    eligibleFlowKeys.add(
      routingMode === "parallel_split"
        ? buildFlowContractKeyForSplit({
            fromRoleId: flow.fromRoleId,
            toRoleId: flow.toRoleId
          })
        : buildFlowContractKeyForFlow({
            fromRoleId: flow.fromRoleId,
            toRoleId: flow.toRoleId,
            eventType: flow.eventType
          })
    );
  }

  if (args.system.graph?.handoffMode === "strict") {
    for (const key of eligibleFlowKeys) {
      if (!flowContractsByKey.has(key)) {
        fail(`Unbound flow "${key}" under handoff.mode=strict`);
      }
    }
  }

  const digest = buildNormalizedContractDigest(compiledContracts);
  return {
    handoffMode: args.system.graph?.handoffMode,
    contractPath: args.contractPath,
    digest,
    flowContractsByKey,
    roleInputContractsByRoleId
  };
}

export function validateContractAgainstSchema(args: {
  contract: CompiledFlowContract;
  data: unknown;
  subject: string;
}): string | undefined {
  const issues = listJsonSchemaIssues({
    schema: args.contract.schema,
    data: args.data
  });
  if (issues.length === 0) {
    return undefined;
  }
  const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  return `Contract "${args.contract.definition.id}" ${args.subject} does not match schema in ${args.contract.schemaPath}: ${detail}`;
}

export function getFlowContractByTarget(args: {
  plan: FlowContractPlan;
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
}): CompiledFlowContract | undefined {
  return args.plan.flowContractsByKey.get(
    buildFlowContractKeyForFlow({
      fromRoleId: args.fromRoleId,
      toRoleId: args.toRoleId,
      eventType: args.eventType
    })
  );
}

export function getSplitFlowContractByTarget(args: {
  plan: FlowContractPlan;
  fromRoleId: string;
  toRoleId: string;
}): CompiledFlowContract | undefined {
  return args.plan.flowContractsByKey.get(
    buildFlowContractKeyForSplit({
      fromRoleId: args.fromRoleId,
      toRoleId: args.toRoleId
    })
  );
}

export function getRoleInputContract(args: {
  plan: FlowContractPlan;
  roleId: string;
}): CompiledFlowContract | undefined {
  return args.plan.roleInputContractsByRoleId.get(args.roleId);
}
