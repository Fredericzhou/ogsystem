/**
 * Compiler facade for the runtime's static execution snapshot.
 * Responsibilities:
 * - Collect stable summaries from system, role packages, contracts, and law policy.
 * - Emit deterministic diagnostics for manual/loaded graph inconsistencies.
 * - Produce a semantic digest that can participate in resume fingerprinting.
 * Boundaries:
 * - It does not execute roles or mutate runtime state.
 * - It keeps runtime validation as a last defense rather than replacing it.
 */
import { createHash } from "node:crypto";

import { SYSTEM_END_ROLE_ID } from "./types.js";
import { createExecutionPlan } from "./execution-plan.js";
import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import type { ResolvedModelRuntimeConfig } from "./model-selection.js";
import {
  RUNTIME_ROLE_PROMPT_INPUT_SCHEMA,
  RUNTIME_ROLE_PROMPT_INPUT_SCHEMA_PATH
} from "./role-prompt-input-schema.js";
import {
  collectCycleComponents,
  summarizeContextSelector
} from "./static-semantics.js";
import type {
  CompiledFlowContract,
  EffectiveLawConstraints,
  ExecutionPlan,
  Flow,
  FlowContractPlan,
  GraphJoinMode,
  LoadedRolePackage,
  RoleExecutionBinding,
  RuntimeErrorEnvelope,
  SystemDefinition
} from "./types.js";

export type CompilerDiagnostic = {
  stage: "compile";
  severity: "error";
  code: string;
  message: string;
  roleId?: string;
  contractId?: string;
  fieldName?: string;
  selector?: string;
};

export type RoleSummary = {
  roleId: string;
  roleVersion: string;
  name: string;
  description: string;
  promptTemplateDigest: string;
  outputSchemaDigest: string;
  agentDigest: string;
  preferredModelTags: string[];
  tags: string[];
};

export type FlowSummary = {
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
};

export type ContextProjectionSummary = {
  roleId: string;
  fields: Array<{
    fieldName: string;
    selector: string;
    selectorKind: string;
    sourceRoleId?: string;
  }>;
};

export type JoinSummary = {
  roleId: string;
  joinMode?: GraphJoinMode;
  sources: string[];
  joinMin?: number;
  incomingRoleIds: string[];
};

export type ContractSummary = {
  id: string;
  kind: "flow" | "role_input";
  match: Record<string, string>;
  onViolation: "FAIL" | "WARN";
  schemaDigest: string;
};

export type LoopSummary = {
  roleId: string;
  max?: number;
  isInCycle: boolean;
};

export type ReviewSummary = {
  roleId: string;
  mode: "required";
  timeoutSeconds?: number;
  timeoutAction: "pause" | "terminate";
  reworkTargetRoleId: string;
  reworkMax?: number;
  terminateScope: "branch" | "run";
};

export type BindingSummary = {
  roleId: string;
  kind: RoleExecutionBinding["kind"];
  modelRef?: string;
  bindingSource?: "system" | "selection";
  profileId?: string;
};

export type LawSummary = {
  globalLawRef: string;
  forbiddenToolRefs: string[];
  maxTransitions?: number;
  allowNoopWithoutExecutionBinding: boolean;
};

export type CompiledExecutionSnapshot = {
  basePlan: ExecutionPlan;
  diagnostics: CompilerDiagnostic[];
  digest: string;
  runtimePromptInputSchemaDigest: string;
  runtimePromptInputSchemaPath: string;
  roleSummaryByRoleId: Record<string, RoleSummary>;
  flowSummaryByKey: Record<string, FlowSummary>;
  projectionSummaryByRoleId: Record<string, ContextProjectionSummary>;
  joinSummaryByRoleId: Record<string, JoinSummary>;
  contractSummaryById: Record<string, ContractSummary>;
  loopSummaryByRoleId: Record<string, LoopSummary>;
  reviewSummaryByRoleId: Record<string, ReviewSummary>;
  bindingSummaryByRoleId: Record<string, BindingSummary>;
  lawSummary: LawSummary;
};

export type CompilerResult = {
  ok: boolean;
  snapshot: CompiledExecutionSnapshot;
  diagnostics: CompilerDiagnostic[];
  digest: string;
};

type CompilerInput = {
  system: SystemDefinition;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
  effectiveLaw: EffectiveLawConstraints;
  contractPlan?: FlowContractPlan;
  resolvedModelsByRoleId?: Map<string, ResolvedModelRuntimeConfig>;
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

function sortStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortEntries<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function flowKey(flow: Flow): string {
  return `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId}`;
}

function buildRoleSummary(rolePackage: LoadedRolePackage): RoleSummary {
  return {
    roleId: rolePackage.manifest.roleId,
    roleVersion: rolePackage.manifest.roleVersion,
    name: rolePackage.manifest.name,
    description: rolePackage.manifest.description,
    promptTemplateDigest: digestValue(rolePackage.promptTemplate),
    outputSchemaDigest: digestValue(rolePackage.outputSchema),
    agentDigest: digestValue(rolePackage.agent),
    preferredModelTags: sortStrings(rolePackage.manifest.preferredModelTags ?? []),
    tags: sortStrings(rolePackage.manifest.tags ?? [])
  };
}

function createDiagnostic(args: {
  code: string;
  message: string;
  roleId?: string;
  contractId?: string;
  fieldName?: string;
  selector?: string;
}): CompilerDiagnostic {
  return {
    stage: "compile",
    severity: "error",
    code: args.code,
    message: args.message,
    roleId: args.roleId,
    contractId: args.contractId,
    fieldName: args.fieldName,
    selector: args.selector
  };
}

function getNodeFlows(args: {
  basePlan: ExecutionPlan;
  roleId: string;
}): {
  incoming: Flow[];
  outgoing: Flow[];
} {
  const node = args.basePlan.nodesByRoleId.get(args.roleId);
  return {
    incoming: node?.incoming ?? [],
    outgoing: node?.outgoing ?? []
  };
}

function summarizeContract(contract: CompiledFlowContract): ContractSummary {
  return {
    id: contract.definition.id,
    kind: contract.definition.kind,
    match: normalizeValue(contract.definition.match) as Record<string, string>,
    onViolation: contract.definition.onViolation ?? "FAIL",
    schemaDigest: digestValue(contract.schema)
  };
}

function buildContractSummaryById(args: {
  contractPlan?: FlowContractPlan;
}): Record<string, ContractSummary> {
  if (!args.contractPlan) {
    return {};
  }

  const summaries: Array<[string, ContractSummary]> = [];
  for (const [key, contract] of [...args.contractPlan.flowContractsByKey.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    summaries.push([key, summarizeContract(contract)]);
  }
  for (const [roleId, contract] of [...args.contractPlan.roleInputContractsByRoleId.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    summaries.push([`role_input:${roleId}`, summarizeContract(contract)]);
  }

  return Object.fromEntries(summaries);
}

function buildProjectionSummary(args: {
  system: SystemDefinition;
}): Record<string, ContextProjectionSummary> {
  const summaries: Array<[string, ContextProjectionSummary]> = [];
  for (const roleId of sortStrings(Object.keys(args.system.graph?.contextMapByRoleId ?? {}))) {
    const fields = Object.entries(args.system.graph?.contextMapByRoleId[roleId] ?? {})
      .map(([fieldName, selector]) => {
        const selectorInfo = summarizeContextSelector(selector);
        return {
          fieldName,
          selector,
          selectorKind: selectorInfo.selectorKind,
          sourceRoleId: selectorInfo.sourceRoleId
        };
      })
      .sort((left, right) => left.fieldName.localeCompare(right.fieldName));
    summaries.push([roleId, { roleId, fields }]);
  }
  return Object.fromEntries(summaries);
}

function buildJoinSummary(args: {
  basePlan: ExecutionPlan;
}): Record<string, JoinSummary> {
  const summaries: Array<[string, JoinSummary]> = [];
  for (const roleId of args.basePlan.roleIds) {
    const node = args.basePlan.nodesByRoleId.get(roleId);
    if (!node) {
      continue;
    }
    summaries.push([
      roleId,
      {
        roleId,
        joinMode: node.joinMode,
        sources: sortStrings(node.joinSources),
        joinMin: node.joinMin,
        incomingRoleIds: sortStrings(
          node.incoming
            .filter(
              (flow) =>
                flow.toRoleId === roleId &&
                flow.fromRoleId !== SYSTEM_END_ROLE_ID &&
                !isRuntimeOnlyErrorEvent(flow.eventType)
            )
            .map((flow) => flow.fromRoleId)
        )
      }
    ]);
  }
  return Object.fromEntries(summaries);
}

function buildFlowSummary(basePlan: ExecutionPlan): Record<string, FlowSummary> {
  const summaries: Array<[string, FlowSummary]> = [];
  for (const flow of [...basePlan.flows].sort((left, right) => {
    if (left.fromRoleId !== right.fromRoleId) {
      return left.fromRoleId.localeCompare(right.fromRoleId);
    }
    if (left.eventType !== right.eventType) {
      return left.eventType.localeCompare(right.eventType);
    }
    return left.toRoleId.localeCompare(right.toRoleId);
  })) {
    summaries.push([
      flowKey(flow),
      {
        fromRoleId: flow.fromRoleId,
        toRoleId: flow.toRoleId,
        eventType: flow.eventType
      }
    ]);
  }
  return Object.fromEntries(summaries);
}

function buildLoopSummary(args: {
  system: SystemDefinition;
}): Record<string, LoopSummary> {
  const cycleRoleIds = new Set(
    collectCycleComponents({
      roleIds: args.system.roleIds,
      flows: args.system.flows
    }).flat()
  );
  const summaries: Array<[string, LoopSummary]> = [];
  for (const roleId of sortStrings(Object.keys(args.system.graph?.loopMaxByRoleId ?? {}))) {
    summaries.push([
      roleId,
      {
        roleId,
        max: args.system.graph?.loopMaxByRoleId[roleId],
        isInCycle: cycleRoleIds.has(roleId)
      }
    ]);
  }
  return Object.fromEntries(summaries);
}

function buildBindingSummary(basePlan: ExecutionPlan): Record<string, BindingSummary> {
  const summaries: Array<[string, BindingSummary]> = [];
  for (const roleId of basePlan.roleIds) {
    const node = basePlan.nodesByRoleId.get(roleId);
    if (!node) {
      continue;
    }
    const summary: BindingSummary = {
      roleId,
      kind: node.binding.kind
    };
    if (node.binding.kind === "model") {
      summary.modelRef = node.binding.modelRef;
      summary.bindingSource = node.binding.bindingSource;
    }
    if (node.binding.kind === "profile") {
      summary.profileId = node.binding.profileId;
    }
    summaries.push([roleId, summary]);
  }
  return Object.fromEntries(summaries);
}

function buildReviewSummary(args: {
  basePlan: ExecutionPlan;
}): Record<string, ReviewSummary> {
  const summaries: Array<[string, ReviewSummary]> = [];
  for (const roleId of args.basePlan.roleIds) {
    const review = args.basePlan.nodesByRoleId.get(roleId)?.review;
    if (!review) {
      continue;
    }
    summaries.push([
      roleId,
      {
        roleId,
        mode: review.mode,
        timeoutSeconds: review.timeoutSeconds,
        timeoutAction: review.timeoutAction,
        reworkTargetRoleId: review.reworkTargetRoleId,
        reworkMax: review.reworkMax,
        terminateScope: review.terminateScope
      }
    ]);
  }
  return Object.fromEntries(summaries);
}

function buildRoleSummaryByRoleId(args: {
  system: SystemDefinition;
  rolePackagesByRoleId: Map<string, LoadedRolePackage>;
}): Record<string, RoleSummary> {
  const summaries: Array<[string, RoleSummary]> = [];
  for (const roleId of sortStrings(args.system.roleIds)) {
    const rolePackage = args.rolePackagesByRoleId.get(roleId);
    if (!rolePackage) {
      continue;
    }
    summaries.push([roleId, buildRoleSummary(rolePackage)]);
  }
  return Object.fromEntries(summaries);
}

function buildLawSummary(effectiveLaw: EffectiveLawConstraints, system: SystemDefinition): LawSummary {
  return {
    globalLawRef: system.lawBinding.globalLawRef,
    forbiddenToolRefs: sortStrings(effectiveLaw.forbiddenToolRefs),
    maxTransitions: effectiveLaw.maxTransitions,
    allowNoopWithoutExecutionBinding: effectiveLaw.allowNoopWithoutExecutionBinding
  };
}

function validateRouteOrder(args: {
  system: SystemDefinition;
  basePlan: ExecutionPlan;
  roleId: string;
  diagnostics: CompilerDiagnostic[];
}): void {
  const routeOrder = args.system.graph?.routeOrderByRoleId?.[args.roleId];
  if (!routeOrder) {
    return;
  }

  const node = args.basePlan.nodesByRoleId.get(args.roleId);
  const outgoingTargets = (node?.outgoing ?? [])
    .filter(
      (flow) =>
        flow.toRoleId !== SYSTEM_END_ROLE_ID && !isRuntimeOnlyErrorEvent(flow.eventType)
    )
    .map((flow) => flow.toRoleId);
  const uniqueOrderedTargets = Array.from(new Set(routeOrder));

  if (uniqueOrderedTargets.length !== routeOrder.length) {
    args.diagnostics.push(
      createDiagnostic({
        code: "COMPILER_ROUTE_ORDER_DUPLICATE",
        message: `route.order.${args.roleId} must not contain duplicate target roles`,
        roleId: args.roleId
      })
    );
    return;
  }

  const outgoingSet = new Set(outgoingTargets);
  const hasExactCoverage =
    outgoingSet.size === uniqueOrderedTargets.length &&
    uniqueOrderedTargets.every((targetRoleId) => outgoingSet.has(targetRoleId));

  if (!hasExactCoverage) {
    args.diagnostics.push(
      createDiagnostic({
        code: "COMPILER_ROUTE_ORDER_MISMATCH",
        message: `route.order.${args.roleId} must match the outgoing role edges`,
        roleId: args.roleId
      })
    );
  }
}

function validateJoinMetadata(args: {
  system: SystemDefinition;
  basePlan: ExecutionPlan;
  roleId: string;
  diagnostics: CompilerDiagnostic[];
}): void {
  const node = args.basePlan.nodesByRoleId.get(args.roleId);
  if (!node?.joinMode) {
    return;
  }

  const declaredSources = sortStrings(node.joinSources);
  const incomingSources = sortStrings(
    node.incoming
      .filter(
        (flow) =>
          flow.toRoleId === args.roleId &&
          flow.fromRoleId !== SYSTEM_END_ROLE_ID &&
          !isRuntimeOnlyErrorEvent(flow.eventType)
      )
      .map((flow) => flow.fromRoleId)
  );

  if (node.joinMode === "all_of" || node.joinMode === "quorum_of") {
    const missingSources = incomingSources.filter(
      (sourceRoleId) => !declaredSources.includes(sourceRoleId)
    );
    const extraSources = declaredSources.filter(
      (sourceRoleId) => !incomingSources.includes(sourceRoleId)
    );
    if (missingSources.length > 0 || extraSources.length > 0) {
      args.diagnostics.push(
        createDiagnostic({
          code: "COMPILER_JOIN_SOURCES_MISMATCH",
          message: `join.sources.${args.roleId} must match the incoming Mermaid role edges`,
          roleId: args.roleId
        })
      );
    }
  }

  if (node.joinMode === "quorum_of") {
    const joinMin = node.joinMin;
    if (joinMin === undefined || joinMin < 1 || joinMin > declaredSources.length) {
      args.diagnostics.push(
        createDiagnostic({
          code: "COMPILER_JOIN_MIN_INVALID",
          message: `join.min.${args.roleId} must be within [1, ${declaredSources.length}]`,
          roleId: args.roleId
        })
      );
    }
  }
}

function validateContextMap(args: {
  system: SystemDefinition;
  basePlan: ExecutionPlan;
  roleId: string;
  diagnostics: CompilerDiagnostic[];
}): void {
  const contextMap = args.system.graph?.contextMapByRoleId?.[args.roleId];
  if (!contextMap) {
    return;
  }

  const node = args.basePlan.nodesByRoleId.get(args.roleId);
  const isJoinNode = node?.joinMode !== undefined;
  const joinSources = new Set(node?.joinSources ?? []);
  const sourceRoleIds = new Set(args.system.roleIds);

  for (const [fieldName, selector] of Object.entries(contextMap)) {
    const selectorInfo = summarizeContextSelector(selector);
    if (selectorInfo.selectorKind === "unsupported" || !selectorInfo.validPath) {
      args.diagnostics.push(
        createDiagnostic({
          code: "COMPILER_CONTEXT_SELECTOR_INVALID",
          message: `context.map.${args.roleId}.${fieldName} uses unsupported selector "${selector}"`,
          roleId: args.roleId,
          fieldName,
          selector
        })
      );
      continue;
    }

    if (selectorInfo.selectorKind.startsWith("direct") && isJoinNode) {
      args.diagnostics.push(
        createDiagnostic({
          code: "COMPILER_CONTEXT_SELECTOR_JOIN_ONLY",
          message: `context.map.${args.roleId}.${fieldName} uses "${selector}" but join nodes do not allow direct.* selectors`,
          roleId: args.roleId,
          fieldName,
          selector
        })
      );
      continue;
    }

    if (selectorInfo.selectorKind === "source") {
      const sourceRoleId = selectorInfo.sourceRoleId ?? "";
      if (!isJoinNode) {
        args.diagnostics.push(
          createDiagnostic({
            code: "COMPILER_CONTEXT_SOURCE_REQUIRES_JOIN",
            message: `context.map.${args.roleId}.${fieldName} uses join-only selector "${selector}" on a non-join role`,
            roleId: args.roleId,
            fieldName,
            selector
          })
        );
        continue;
      }
      if (!sourceRoleIds.has(sourceRoleId)) {
        args.diagnostics.push(
          createDiagnostic({
            code: "COMPILER_CONTEXT_SOURCE_UNDEFINED",
            message: `context.map.${args.roleId}.${fieldName} references undefined role "${sourceRoleId}"`,
            roleId: args.roleId,
            fieldName,
            selector
          })
        );
        continue;
      }
      if (!joinSources.has(sourceRoleId)) {
        args.diagnostics.push(
          createDiagnostic({
            code: "COMPILER_CONTEXT_SOURCE_NOT_ALLOWED",
            message: `context.map.${args.roleId}.${fieldName} references source("${sourceRoleId}") not declared in join.sources.${args.roleId}`,
            roleId: args.roleId,
            fieldName,
            selector
          })
        );
      }
      if (node?.joinMode === "quorum_of" && node.joinMin !== undefined && node.joinMin < joinSources.size) {
        args.diagnostics.push(
          createDiagnostic({
            code: "COMPILER_CONTEXT_SOURCE_QUORUM_MISMATCH",
            message: `context.map.${args.roleId}.${fieldName} uses source("${sourceRoleId}") but join.min.${args.roleId} is below join.sources size`,
            roleId: args.roleId,
            fieldName,
            selector
          })
        );
      }
    }
  }
}

function validateReview(args: {
  basePlan: ExecutionPlan;
  roleId: string;
  diagnostics: CompilerDiagnostic[];
}): void {
  const node = args.basePlan.nodesByRoleId.get(args.roleId);
  if (!node?.review) {
    return;
  }
  if (node.binding.kind === "noop") {
    args.diagnostics.push(
      createDiagnostic({
        code: "COMPILER_REVIEW_REQUIRES_EXECUTION_BINDING",
        message: `Role "${args.roleId}" cannot declare review.mode=${node.review.mode} with noop binding`,
        roleId: args.roleId
      })
    );
  }
}

function validateLoopBudget(args: {
  system: SystemDefinition;
  roleId: string;
  diagnostics: CompilerDiagnostic[];
}): void {
  const loopMax = args.system.graph?.loopMaxByRoleId?.[args.roleId];
  if (loopMax === undefined) {
    return;
  }
  if (loopMax <= 0) {
    args.diagnostics.push(
      createDiagnostic({
        code: "COMPILER_LOOP_MAX_INVALID",
        message: `loop.max.${args.roleId} must be positive`,
        roleId: args.roleId
      })
    );
  }
}

function validateBinding(args: {
  basePlan: ExecutionPlan;
  roleId: string;
  diagnostics: CompilerDiagnostic[];
  effectiveLaw: EffectiveLawConstraints;
}): void {
  const node = args.basePlan.nodesByRoleId.get(args.roleId);
  if (!node) {
    args.diagnostics.push(
      createDiagnostic({
        code: "COMPILER_ROLE_UNMAPPED",
        message: `Execution plan is missing role "${args.roleId}"`,
        roleId: args.roleId
      })
    );
    return;
  }
  if (node.binding.kind !== "noop" || args.effectiveLaw.allowNoopWithoutExecutionBinding) {
    if (node.binding.kind !== "noop") {
      return;
    }
  } else {
    args.diagnostics.push(
      createDiagnostic({
        code: "COMPILER_ROLE_BINDING_MISSING",
        message: `Role "${args.roleId}" has no executable binding (model.bind/exec.bind)`,
        roleId: args.roleId
      })
    );
    return;
  }

  const selectableOutgoingCount = node.outgoing.filter(
    (flow) => !isRuntimeOnlyErrorEvent(flow.eventType)
  ).length;
  if (selectableOutgoingCount > 1) {
    args.diagnostics.push(
      createDiagnostic({
        code: "COMPILER_ROLE_NOOP_AMBIGUOUS",
        message:
          `Role "${args.roleId}" cannot use noop binding with ${selectableOutgoingCount} selectable outgoing flows`,
        roleId: args.roleId
      })
    );
  }
}

function validateContracts(args: {
  system: SystemDefinition;
  contractPlan?: FlowContractPlan;
  diagnostics: CompilerDiagnostic[];
}): void {
  if (!args.contractPlan) {
    return;
  }

  for (const contract of args.contractPlan.flowContractsByKey.values()) {
    const definition = contract.definition;
    if (definition.kind !== "flow") {
      continue;
    }
    const fromRoleId = definition.match.fromRoleId;
    const toRoleId = definition.match.toRoleId;
    const eventType = definition.match.eventType;
    if (!fromRoleId || !toRoleId) {
      continue;
    }
    const hasFlow = args.system.flows.some(
      (flow) =>
        flow.fromRoleId === fromRoleId &&
        flow.toRoleId === toRoleId &&
        (definition.match.mode === "split" ? true : flow.eventType === eventType)
    );
    if (!hasFlow) {
      args.diagnostics.push(
        createDiagnostic({
          code: "COMPILER_FLOW_CONTRACT_UNBOUND",
          message: `Flow contract "${definition.id}" has no matching system edge`,
          contractId: definition.id
        })
      );
    }
  }

  for (const contract of args.contractPlan.roleInputContractsByRoleId.values()) {
    const definition = contract.definition;
    if (definition.kind !== "role_input") {
      continue;
    }
    const roleId = definition.match.roleId;
    if (!roleId) {
      continue;
    }
    if (!args.system.roleIds.includes(roleId)) {
      args.diagnostics.push(
        createDiagnostic({
          code: "COMPILER_ROLE_INPUT_UNBOUND",
          message: `role_input contract "${definition.id}" references undefined role "${roleId}"`,
          contractId: definition.id,
          roleId
        })
      );
      continue;
    }
    const contextMap = args.system.graph?.contextMapByRoleId?.[roleId];
    if (!contextMap || Object.keys(contextMap).length === 0) {
      args.diagnostics.push(
        createDiagnostic({
          code: "COMPILER_ROLE_INPUT_CONTEXT_MISSING",
          message: `role_input contract "${definition.id}" requires context.map.${roleId}.* metadata`,
          contractId: definition.id,
          roleId
        })
      );
    }
  }
}

function buildCompilerDigestValue(args: {
  system: SystemDefinition;
  runtimePromptInputSchemaDigest: string;
  roleSummaryByRoleId: Record<string, RoleSummary>;
  flowSummaryByKey: Record<string, FlowSummary>;
  projectionSummaryByRoleId: Record<string, ContextProjectionSummary>;
  joinSummaryByRoleId: Record<string, JoinSummary>;
  contractSummaryById: Record<string, ContractSummary>;
  loopSummaryByRoleId: Record<string, LoopSummary>;
  reviewSummaryByRoleId: Record<string, ReviewSummary>;
  bindingSummaryByRoleId: Record<string, BindingSummary>;
  lawSummary: LawSummary;
}): unknown {
  return {
    compilerVersion: 2,
    system: {
      systemId: args.system.systemId,
      systemVersion: args.system.systemVersion,
      entryRoleId: args.system.entryRoleId,
      roleIds: sortStrings(args.system.roleIds),
      flows: [...args.system.flows]
        .map((flow) => ({
          fromRoleId: flow.fromRoleId,
          toRoleId: flow.toRoleId,
          eventType: flow.eventType
        }))
        .sort((left, right) => {
          if (left.fromRoleId !== right.fromRoleId) {
            return left.fromRoleId.localeCompare(right.fromRoleId);
          }
          if (left.eventType !== right.eventType) {
            return left.eventType.localeCompare(right.eventType);
          }
          return left.toRoleId.localeCompare(right.toRoleId);
        })
    },
    runtimePromptInputSchemaDigest: args.runtimePromptInputSchemaDigest,
    roleSummaryByRoleId: sortEntries(args.roleSummaryByRoleId).map(([roleId, summary]) => [roleId, summary]),
    flowSummaryByKey: sortEntries(args.flowSummaryByKey),
    projectionSummaryByRoleId: sortEntries(args.projectionSummaryByRoleId),
    joinSummaryByRoleId: sortEntries(args.joinSummaryByRoleId),
    contractSummaryById: sortEntries(args.contractSummaryById),
    loopSummaryByRoleId: sortEntries(args.loopSummaryByRoleId),
    reviewSummaryByRoleId: sortEntries(args.reviewSummaryByRoleId),
    bindingSummaryByRoleId: sortEntries(args.bindingSummaryByRoleId),
    lawSummary: args.lawSummary
  };
}

export function compileExecutionSnapshot(args: CompilerInput): CompilerResult {
  const basePlan = createExecutionPlan(args.system, args.resolvedModelsByRoleId);
  const diagnostics: CompilerDiagnostic[] = [];

  for (const roleId of args.system.roleIds) {
    validateBinding({
      basePlan,
      roleId,
      diagnostics,
      effectiveLaw: args.effectiveLaw
    });
    validateJoinMetadata({
      system: args.system,
      basePlan,
      roleId,
      diagnostics
    });
    validateContextMap({
      system: args.system,
      basePlan,
      roleId,
      diagnostics
    });
    validateRouteOrder({
      system: args.system,
      basePlan,
      roleId,
      diagnostics
    });
    validateLoopBudget({
      system: args.system,
      roleId,
      diagnostics
    });
    validateReview({
      basePlan,
      roleId,
      diagnostics
    });
  }

  validateContracts({
    system: args.system,
    contractPlan: args.contractPlan,
    diagnostics
  });

  for (const roleId of args.system.roleIds) {
    if (!args.rolePackagesByRoleId.has(roleId)) {
      diagnostics.push(
        createDiagnostic({
          code: "COMPILER_ROLE_PACKAGE_MISSING",
          message: `Role package missing for "${roleId}"`,
          roleId
        })
      );
    }
  }

  const roleSummaryByRoleId = buildRoleSummaryByRoleId({
    system: args.system,
    rolePackagesByRoleId: args.rolePackagesByRoleId
  });
  const flowSummaryByKey = buildFlowSummary(basePlan);
  const projectionSummaryByRoleId = buildProjectionSummary({
    system: args.system
  });
  const joinSummaryByRoleId = buildJoinSummary({
    basePlan
  });
  const contractSummaryById = buildContractSummaryById({
    contractPlan: args.contractPlan
  });
  const loopSummaryByRoleId = buildLoopSummary({
    system: args.system
  });
  const reviewSummaryByRoleId = buildReviewSummary({
    basePlan
  });
  const bindingSummaryByRoleId = buildBindingSummary(basePlan);
  const lawSummary = buildLawSummary(args.effectiveLaw, args.system);
  const runtimePromptInputSchemaDigest = digestValue(RUNTIME_ROLE_PROMPT_INPUT_SCHEMA);

  const digest = digestValue(
    buildCompilerDigestValue({
      system: args.system,
      runtimePromptInputSchemaDigest,
      roleSummaryByRoleId,
      flowSummaryByKey,
      projectionSummaryByRoleId,
      joinSummaryByRoleId,
      contractSummaryById,
      loopSummaryByRoleId,
      reviewSummaryByRoleId,
      bindingSummaryByRoleId,
      lawSummary
    })
  );

  const snapshot: CompiledExecutionSnapshot = {
    basePlan,
    diagnostics: [...diagnostics].sort((left, right) => {
      if (left.code !== right.code) {
        return left.code.localeCompare(right.code);
      }
      if ((left.roleId ?? "") !== (right.roleId ?? "")) {
        return (left.roleId ?? "").localeCompare(right.roleId ?? "");
      }
      if ((left.contractId ?? "") !== (right.contractId ?? "")) {
        return (left.contractId ?? "").localeCompare(right.contractId ?? "");
      }
      if ((left.fieldName ?? "") !== (right.fieldName ?? "")) {
        return (left.fieldName ?? "").localeCompare(right.fieldName ?? "");
      }
      if ((left.selector ?? "") !== (right.selector ?? "")) {
        return (left.selector ?? "").localeCompare(right.selector ?? "");
      }
      return left.message.localeCompare(right.message);
    }),
    digest,
    runtimePromptInputSchemaDigest,
    runtimePromptInputSchemaPath: RUNTIME_ROLE_PROMPT_INPUT_SCHEMA_PATH,
    roleSummaryByRoleId,
    flowSummaryByKey,
    projectionSummaryByRoleId,
    joinSummaryByRoleId,
    contractSummaryById,
    loopSummaryByRoleId,
    reviewSummaryByRoleId,
    bindingSummaryByRoleId,
    lawSummary
  };

  return {
    ok: snapshot.diagnostics.length === 0,
    snapshot,
    diagnostics: snapshot.diagnostics,
    digest
  };
}

const RUNTIME_TO_COMPILER_DIAGNOSTIC_CODE: Record<string, string> = {
  ROLE_CONTEXT_PATH_MISSING: "COMPILER_CONTEXT_SELECTOR_INVALID",
  ROLE_CONTEXT_SELECTOR_UNAUTHORIZED: "COMPILER_CONTEXT_SOURCE_NOT_ALLOWED",
  ROLE_CONTEXT_SELECTOR_UNSUPPORTED: "COMPILER_CONTEXT_SELECTOR_INVALID",
  ROLE_CONTEXT_SOURCE_UNAVAILABLE: "COMPILER_CONTEXT_SOURCE_UNDEFINED",
  CONTRACT_ROLE_INPUT_VALIDATION_FAILED: "COMPILER_ROLE_INPUT_CONTEXT_MISSING",
  CONTRACT_MISSING: "COMPILER_FLOW_CONTRACT_UNBOUND",
  CONTRACT_VALIDATION_FAILED: "COMPILER_FLOW_CONTRACT_UNBOUND"
};

export function mapRuntimeErrorToCompilerDiagnosticCode(
  errorEnvelope: Pick<RuntimeErrorEnvelope, "errorCode">
): string | undefined {
  return RUNTIME_TO_COMPILER_DIAGNOSTIC_CODE[errorEnvelope.errorCode];
}
