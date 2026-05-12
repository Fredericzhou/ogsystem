import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { inspectRun, resolveRunDir } from "../runtime/project-lifecycle.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import {
  asBoolean,
  asNumber,
  asRecord,
  asString
} from "./json-guards.js";
import type { BranchRecord, GraphState, SystemDefinition } from "../runtime/types.js";

type JsonRecord = Record<string, unknown>;

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const MAX_MERMAID_LIVE_URL_LENGTH = 16_384;

function buildMermaidLiveUrl(systemSource: string | null): string | undefined {
  if (!systemSource) {
    return undefined;
  }
  const payload = JSON.stringify({
    code: systemSource,
    mermaid: { theme: "default" }
  });
  const url = `https://mermaid.live/edit#base64:${toBase64Url(payload)}`;
  return url.length <= MAX_MERMAID_LIVE_URL_LENGTH ? url : undefined;
}

function extractGraphState(state: unknown): GraphState | undefined {
  const record = asRecord(state);
  const graphState = asRecord(record?.graphState);
  return (graphState ?? record) as GraphState | undefined;
}

function getRunSimulation(detail: JsonRecord): {
  isSimulation: boolean;
  mode: "simulation" | "runtime";
  source: string;
} {
  const resolvedConfig = asRecord(detail.resolvedConfig);
  const effective = asRecord(resolvedConfig?.effective);
  const invocation = asRecord(effective?.invocation);
  const dryRun = asBoolean(invocation?.dryRun) === true;
  return {
    isSimulation: dryRun,
    mode: dryRun ? "simulation" : "runtime",
    source: dryRun ? "resolved-config" : "runtime-default"
  };
}

export function countBranches(
  branchRecords: Record<string, BranchRecord>,
  roleId: string,
  status: BranchRecord["status"]
): number {
  return Object.values(branchRecords).filter((branch) => branch.roleId === roleId && branch.status === status)
    .length;
}

export function findLastErrorCode(args: { state: GraphState; roleId: string }): string | undefined {
  for (let index = args.state.recentAudits.length - 1; index >= 0; index -= 1) {
    const audit = args.state.recentAudits[index];
    if (audit.roleId === args.roleId && audit.errorEnvelope?.errorCode) {
      return audit.errorEnvelope.errorCode;
    }
  }
  return args.state.lastExecutedRoleId === args.roleId ? args.state.errorEnvelope?.errorCode : undefined;
}

export function findLastSelectedEvent(args: { state: GraphState; roleId: string }): string | undefined {
  const selected = Object.entries(args.state.selectedEventByBranchId)
    .map(([branchId, event]) => ({
      branchId,
      event,
      branch: args.state.branchRecords[branchId]
    }))
    .filter((entry) => entry.branch?.roleId === args.roleId)
    .sort((left, right) => (left.branch?.branchSequence ?? 0) - (right.branch?.branchSequence ?? 0))
    .at(-1);
  return selected?.event;
}

export function findLatestFailureForRole(args: { state: GraphState; roleId: string }): Record<string, unknown> | undefined {
  for (let index = args.state.recentAudits.length - 1; index >= 0; index -= 1) {
    const audit = args.state.recentAudits[index];
    if (audit.roleId === args.roleId && (audit.status === "failed" || audit.errorEnvelope)) {
      return {
        errorCode: audit.errorEnvelope?.errorCode,
        errorCategory: audit.errorEnvelope?.errorCategory,
        message: audit.errorEnvelope?.message ?? audit.error,
        retryable: audit.errorEnvelope?.retryable,
        stage: audit.errorEnvelope?.stage,
        durationMs: audit.durationMs,
        branchId: audit.branchId
      };
    }
  }
  return undefined;
}

export function buildGraphNodeStatus(args: {
  state: GraphState;
  roleId: string;
  activeBranchCount: number;
  waitingReviewCount: number;
  completedBranchCount: number;
  lastErrorCode?: string;
}): string {
  if (args.state.status === "failed" && args.state.lastExecutedRoleId === args.roleId) {
    return "failed";
  }
  if (args.waitingReviewCount > 0) {
    return "waiting_review";
  }
  if (args.activeBranchCount > 0) {
    return "active";
  }
  if (args.state.finalRoleId === args.roleId && args.state.status === "done") {
    return "done";
  }
  if (args.completedBranchCount > 0) {
    return "completed";
  }
  if (args.lastErrorCode) {
    return "failed";
  }
  return "idle";
}

function buildRunGraphView(args: {
  system: SystemDefinition;
  state: GraphState | undefined;
}): Record<string, unknown> {
  const state = args.state;
  const branchRecords = state?.branchRecords ?? {};
  const pendingReviewsById = state?.pendingReviewsById ?? {};
  const nodes = args.system.roleIds.map((roleId) => {
    const activeBranchCount = countBranches(branchRecords, roleId, "active");
    const completedBranchCount = countBranches(branchRecords, roleId, "completed");
    const waitingReviewCount = countBranches(branchRecords, roleId, "waiting_review");
    const pendingReviewCount = Object.values(pendingReviewsById).filter(
      (review) => review.roleId === roleId && (review.status === "pending" || review.status === "paused")
    ).length;
    const lastErrorCode = state ? findLastErrorCode({ state, roleId }) : undefined;
    const lastFailure = state ? findLatestFailureForRole({ state, roleId }) : undefined;
    const expectedSources = args.system.graph?.joinSourcesByRoleId[roleId] ?? [];
    const readySources = state
      ? Array.from(
          new Set(
            Object.values(branchRecords)
              .filter((branch) => branch.roleId === roleId && typeof branch.activatedByRoleId === "string")
              .map((branch) => branch.activatedByRoleId)
              .filter((value): value is string => typeof value === "string")
          )
        ).sort((left, right) => left.localeCompare(right))
      : [];
    return {
      roleId,
      nodeType:
        args.system.graph?.joinModeByRoleId[roleId] !== undefined
          ? "join"
          : args.system.graph?.routingModeByRoleId[roleId] !== undefined
            ? "router"
            : "role",
      bindingKind: args.system.executionBinding[roleId]
        ? "profile"
        : args.system.modelBinding[roleId]
          ? "model"
          : "noop",
      status: state
        ? buildGraphNodeStatus({
            state,
            roleId,
            activeBranchCount,
            waitingReviewCount,
            completedBranchCount,
            lastErrorCode
          })
        : "idle",
      activeBranchCount,
      completedBranchCount,
      waitingReviewCount,
      pendingReviewCount,
      loopIteration: state?.loopIterations[roleId] ?? 0,
      lastSelectedEvent: state ? findLastSelectedEvent({ state, roleId }) : undefined,
      lastErrorCode,
      routingMode: args.system.graph?.routingModeByRoleId[roleId],
      joinMode: args.system.graph?.joinModeByRoleId[roleId],
      joinSources: expectedSources,
      expectedSources,
      readySources,
      missingSources: expectedSources.filter((sourceRoleId) => !readySources.includes(sourceRoleId)),
      joinWaitingSummary:
        expectedSources.length > 0
          ? {
              expectedCount: expectedSources.length,
              readyCount: readySources.length,
              missingCount: expectedSources.filter((sourceRoleId) => !readySources.includes(sourceRoleId)).length
            }
          : null,
      joinMin: args.system.graph?.joinMinByRoleId[roleId],
      loopMax: args.system.graph?.loopMaxByRoleId[roleId],
      contextFields: Object.keys(args.system.graph?.contextMapByRoleId[roleId] ?? {}),
      review: args.system.graph?.reviewByRoleId?.[roleId],
      lastFailure
    };
  });

  const edges = args.system.flows.map((flow) => ({
    sourceRoleId: flow.fromRoleId,
    targetRoleId: flow.toRoleId,
    event: flow.eventType,
    isErrorFlow: isRuntimeOnlyErrorEvent(flow.eventType),
    recentlyActivated:
      state === undefined
        ? false
        : Object.values(branchRecords).some(
            (branch) =>
              branch.roleId === flow.toRoleId &&
              branch.activatedByRoleId === flow.fromRoleId &&
              branch.activatedByEvent === flow.eventType
          )
  }));

  return {
    systemId: args.system.systemId,
    systemVersion: args.system.systemVersion,
    entryRoleId: args.system.entryRoleId,
    roleCount: args.system.roleIds.length,
    flowCount: args.system.flows.length,
    nodes,
    edges
  };
}

export async function inspectRunGraphVisualization(args: {
  workdir: string;
  runId: string;
  state?: unknown;
  resolvedConfig?: unknown;
  systemSource?: string | null;
  summary?: unknown;
}): Promise<Record<string, unknown>> {
  const detail = args.state !== undefined
    ? {
        runId: args.runId,
        runDir: resolveRunDir(args.workdir, args.runId),
        state: args.state,
        resolvedConfig: args.resolvedConfig,
        summary: args.summary
      }
    : await inspectRun(args.workdir, args.runId);
  const runDir = resolveRunDir(args.workdir, args.runId);
  const systemSource = args.systemSource ?? (await readFile(resolve(runDir, "system.mmd"), "utf8").catch(() => null));
  const system = systemSource ? parseSystemFromMermaidSource(systemSource) : undefined;
  const simulation = getRunSimulation(asRecord(detail) ?? {});
  const graph = system ? buildRunGraphView({ system, state: extractGraphState(detail.state) }) : null;
  const graphRecord = asRecord(graph);
  const nodes = Array.isArray(graphRecord?.nodes) ? graphRecord.nodes.map((node) => asRecord(node)).filter(Boolean) : [];
  const expectedPathRoleIds = nodes
    .filter((node) => node && ["active", "waiting_review", "completed", "done", "failed"].includes(String(node.status ?? "")))
    .map((node) => asString(node?.roleId))
    .filter((roleId): roleId is string => Boolean(roleId));

  return {
    runId: args.runId,
    systemSource,
    state: detail.state ?? null,
    summary: detail.summary ?? null,
    simulation: {
      ...simulation,
      summary: {
        simulatedNodeCount: simulation.isSimulation ? (system?.roleIds.length ?? 0) : 0,
        simulatedExternalCallCount: simulation.isSimulation
          ? nodes.filter((node) => node?.bindingKind === "model" || node?.bindingKind === "profile").length
          : 0,
        expectedPathRoleIds: expectedPathRoleIds.length > 0 ? expectedPathRoleIds : (system?.roleIds ?? []),
        mermaidLiveUrl: buildMermaidLiveUrl(systemSource)
      }
    },
    graph
  };
}
