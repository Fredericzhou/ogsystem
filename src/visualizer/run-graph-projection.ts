import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { inspectRun, resolveRunDir } from "./run-query-service.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import {
  importSystemToAuthoring,
  loadStudioAuthoringDraft,
  type StudioAuthoringDocument
} from "./studio-authoring.js";
import { buildGraphViewModel } from "./graph-view-model.js";
import {
  asBoolean,
  asRecord,
  asString
} from "./json-guards.js";
import type { GraphState } from "../runtime/types.js";

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

function isAuthoringDocument(value: unknown): value is StudioAuthoringDocument {
  const record = asRecord(value);
  return record?.version === 1
    && typeof record.project === "object"
    && record.project !== null
    && typeof record.system === "object"
    && record.system !== null
    && typeof record.roles === "object"
    && record.roles !== null
    && typeof record.flows === "object"
    && record.flows !== null
    && typeof record.layout === "object"
    && record.layout !== null;
}

function flowSemanticKey(flow: {
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
}): string {
  return `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId}`;
}

function overlayAuthoringDraftLayout(args: {
  base: StudioAuthoringDocument;
  draft: StudioAuthoringDocument;
}): StudioAuthoringDocument {
  const draftFlowByKey = new Map(
    Object.values(args.draft.flows).map((flow) => [flowSemanticKey(flow), flow])
  );
  return {
    ...args.base,
    roles: Object.fromEntries(
      Object.entries(args.base.roles).map(([roleId, role]) => {
        const draftRole = args.draft.roles[roleId];
        return [
          roleId,
          draftRole?.title
            ? { ...role, title: draftRole.title }
            : role
        ];
      })
    ),
    flows: Object.fromEntries(
      Object.entries(args.base.flows).map(([flowId, flow]) => {
        const draftFlow = draftFlowByKey.get(flowSemanticKey(flow));
        return [
          flowId,
          draftFlow?.label
            ? { ...flow, label: draftFlow.label }
            : flow
        ];
      })
    ),
    layout: {
      ...args.base.layout,
      nodes: {
        ...args.base.layout.nodes,
        ...Object.fromEntries(
          Object.entries(args.draft.layout?.nodes || {}).filter(([roleId]) => Boolean(args.base.roles[roleId]))
        )
      },
      viewport: args.draft.layout?.viewport ?? args.base.layout.viewport
    }
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
  const draftPayload = await loadStudioAuthoringDraft(args.workdir).catch(() => null);
  const draftAuthoring = isAuthoringDocument(draftPayload?.authoring) ? draftPayload.authoring : null;
  const authoring = system
    ? (() => {
        const base = importSystemToAuthoring({
          workdir: args.workdir,
          systemPath: resolve(runDir, "system.mmd"),
          system,
          systemSource: systemSource ?? undefined
        });
        return draftAuthoring ? overlayAuthoringDraftLayout({ base, draft: draftAuthoring }) : base;
      })()
    : null;
  const graph = system && authoring
    ? buildGraphViewModel({
        authoring,
        system,
        state: extractGraphState(detail.state),
        mode: "run"
      })
    : null;
  const graphRecord = asRecord(graph);
  const nodes = Array.isArray(graphRecord?.nodes) ? graphRecord.nodes.map((node) => asRecord(node)).filter(Boolean) : [];
  const expectedPathRoleIds = nodes
    .filter((node) => {
      const runtime = asRecord(node?.runtime);
      return runtime && ["active", "waiting_review", "completed", "done", "failed"].includes(String(runtime.status ?? ""));
    })
    .map((node) => asString(node?.roleId))
    .filter((roleId): roleId is string => Boolean(roleId));

  return {
    runId: args.runId,
    systemSource,
    authoring,
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
