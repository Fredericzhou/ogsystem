/**
 * @fileoverview Minimal read-mostly visualization server for OGSystem runs.
 * Responsibilities:
 * - Serve run summaries, details, event snapshots, and a lightweight SSE stream.
 * - Render a single-page observability UI without a front-end build toolchain.
 * Boundaries:
 * - Read-mostly; mutations are limited to lifecycle/control-plane entrypoints.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runSystemWithAdapter } from "../runtime/adapter.js";
import {
  ensureProjectSkeleton,
  inspectHumanReview,
  inspectRun,
  listHumanReviews,
  loadPersistedRunsIndex,
  loadIndexedRuns,
  loadRunLogs,
  rebuildRunsIndex,
  requestStop,
  resolveOgsPaths,
  resolveRunDir,
  writeHumanReviewDecision
} from "../runtime/project-lifecycle.js";
import {
  loadTimelineTailSnapshot,
  projectTimelineRecord
} from "../runtime/timeline-projector.js";
import {
  inspectRunContractStatusVisualization,
  inspectRunFailureVisualization,
  inspectRunResumeDiagnostics,
  inspectRunResumeReadiness
} from "./data.js";
import { inspectProjectOpsSummaryVisualization } from "./ops-summary-projection.js";
import { inspectProjectReadiness } from "./project-readiness.js";
import {
  exportProjectBundle,
  inspectProjectBindingVisualization,
  inspectProjectConfigVisualization,
  inspectProjectContractVisualization,
  inspectProjectRolePackagesVisualization,
  inspectProjectSystemVisualization,
  inspectProjectSystemWorkbench,
  inspectProjectVisualization,
  invalidateProjectProjectionCache,
  listProjectRolesVisualization,
  saveProjectSystemSource,
  upsertProjectProfilesVisualization,
  validateProjectSystemSource
} from "./project-projection.js";
import { inspectRunGraphVisualization } from "./run-graph-projection.js";
import {
  applyCanvasDocumentToAuthoring,
  authoringToCanvasDocument,
  importMermaidToAuthoring,
  inspectStudioBridgeDraft,
  loadStudioAuthoringDraft,
  saveStudioAuthoringDraft,
  serializeAuthoringToMermaid,
  type StudioAuthoringDocument,
  type StudioCanvasDocument
} from "./studio-authoring.js";
import { listStudioAuthoringTemplates } from "./studio-templates.js";
import {
  mapControlActionView,
  mapErrorView,
  mapFailureProjectionView,
  mapProjectLoadView,
  mapProjectTransferView,
  mapResumeReadinessView,
  mapResumeDiagnosticsView,
  mapReviewDetailView,
  mapReviewQueueView,
  mapRunDetailView,
  mapRunLifecycleView,
  mapWorkbenchSaveView,
  mapWorkbenchValidationView,
  mapWorkbenchView,
  type RunHeader
} from "./dto.js";
import { renderPageHtml as renderVisualizerPageHtml } from "./page-shell.js";
import {
  getDictionary,
  resolveLocaleFromAcceptLanguage,
  resolveLocaleFromQuery,
  type Locale
} from "./i18n/index.js";

type VisualizationServerOptions = {
  workdir: string;
  host: string;
  port: number;
};

type VisualizationServerState = {
  workdir: string;
};

type NdjsonEntry = {
  cursor: number;
  record: Record<string, unknown>;
};

type InspectRunRecord = {
  runId: string;
  runDir: string;
  state: unknown;
  metrics: unknown;
  resolvedConfig: unknown;
  stopRequest: unknown;
  stopOutcome: unknown;
  summary?: unknown;
};

type LoadedRunDetail = InspectRunRecord & {
  systemSource: string | null;
};

type RunsListCacheEntry = {
  generatedAt: string;
  runs: unknown[];
  indexMtimeMs?: number;
};

class HttpError extends Error {
  statusCode: number;
  errorCode: string;
  details?: unknown;

  constructor(statusCode: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const API_PREFIX = "/api/v1";
const VISUALIZER_MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const STUDIO_GRAPH_ASSET_PATH = VISUALIZER_MODULE_DIR.endsWith(`${sep}src${sep}visualizer`)
  ? resolve(VISUALIZER_MODULE_DIR, "..", "..", "dist", "visualizer", "studio-client", "studio-graph.js")
  : resolve(VISUALIZER_MODULE_DIR, "studio-client", "studio-graph.js");
const STATIC_ASSET_ROUTES = new Map<string, { filePath: string; contentType: string }>([
  [
    "/assets/studio-graph.js",
    {
      filePath: STUDIO_GRAPH_ASSET_PATH,
      contentType: "application/javascript; charset=utf-8"
    }
  ]
]);
const runsListCache = new Map<string, RunsListCacheEntry>();

function jsonResponse(
  response: ServerResponse,
  statusCode: number,
  value: unknown
): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function textResponse(
  response: ServerResponse,
  statusCode: number,
  value: string,
  contentType = "text/plain; charset=utf-8"
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(value)
  });
  response.end(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isSimulationRun(resolvedConfig: unknown): boolean {
  const record = asRecord(resolvedConfig);
  const effective = asRecord(record?.effective);
  const invocation = asRecord(effective?.invocation);
  return invocation?.dryRun === true;
}

function extractGraphState(state: unknown): Record<string, unknown> | undefined {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    return undefined;
  }
  const record = state as Record<string, unknown>;
  const nested = record.graphState;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return record;
}

function getBranchCount(graphState: Record<string, unknown> | undefined): number {
  const branchRecords = graphState?.branchRecords;
  if (typeof branchRecords !== "object" || branchRecords === null || Array.isArray(branchRecords)) {
    return 0;
  }
  return Object.values(branchRecords as Record<string, unknown>).filter((value) => {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      asString((value as Record<string, unknown>).status) === "active"
    );
  }).length;
}

function getAuditCount(graphState: Record<string, unknown> | undefined): number {
  const recentAudits = graphState?.recentAudits;
  return Array.isArray(recentAudits) ? recentAudits.length : 0;
}

function getPendingReviewCount(
  graphState: Record<string, unknown> | undefined,
  summary: Record<string, unknown> | undefined
): number {
  const summaryCount = asNumber(summary?.pendingReviewCount);
  if (summaryCount !== undefined) {
    return summaryCount;
  }
  const pendingReviews = graphState?.pendingReviewsById;
  if (typeof pendingReviews !== "object" || pendingReviews === null || Array.isArray(pendingReviews)) {
    return 0;
  }
  return Object.values(pendingReviews as Record<string, unknown>).filter((value) => {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      ["pending", "paused"].includes(asString((value as Record<string, unknown>).status) ?? "")
    );
  }).length;
}

function getHasWaitingHumanReview(
  graphState: Record<string, unknown> | undefined,
  summary: Record<string, unknown> | undefined
): boolean {
  const summaryFlag = summary?.hasWaitingHumanReview;
  if (typeof summaryFlag === "boolean") {
    return summaryFlag;
  }
  return getPendingReviewCount(graphState, summary) > 0;
}

function buildRunHeader(detail: LoadedRunDetail): RunHeader {
  const state = extractGraphState(detail.state);
  const summary =
    typeof detail.summary === "object" && detail.summary !== null && !Array.isArray(detail.summary)
      ? (detail.summary as Record<string, unknown>)
      : undefined;
  const status =
    asString(summary?.status) ??
    asString(state?.status) ??
    asString((detail.state as Record<string, unknown> | undefined)?.status) ??
    "unknown";
  const transitionCount =
    asNumber(summary?.transitionCount) ??
    asNumber(state?.transitionCount) ??
    asNumber((detail.state as Record<string, unknown> | undefined)?.transitionCount) ??
    0;
  const finalRoleId =
    asString(summary?.finalRoleId) ??
    asString(state?.finalRoleId) ??
    asString((detail.state as Record<string, unknown> | undefined)?.finalRoleId);
  const lastExecutedRoleId =
    asString(summary?.lastRoleId) ??
    asString(state?.lastExecutedRoleId) ??
    asString((detail.state as Record<string, unknown> | undefined)?.lastExecutedRoleId);
  const error =
    asString(state?.error) ??
    asString((detail.state as Record<string, unknown> | undefined)?.error);
  const pendingReviewCount = getPendingReviewCount(state, summary);
  const hasWaitingHumanReview = getHasWaitingHumanReview(state, summary);

  return {
    runId: detail.runId,
    runDir: detail.runDir,
    status,
    transitionCount,
    finalRoleId,
    lastExecutedRoleId,
    error,
    updatedAt:
      asString(summary?.updatedAt) ??
      asString((detail.resolvedConfig as Record<string, unknown> | undefined)?.updatedAt) ??
      "",
    activeBranches: getBranchCount(state),
    pendingReviewCount,
    hasWaitingHumanReview,
    recentAudits: getAuditCount(state),
    systemSource: detail.systemSource,
    isSimulation: isSimulationRun(detail.resolvedConfig),
    runMode: isSimulationRun(detail.resolvedConfig) ? "simulation" : "runtime"
  };
}

function invalidateAllProjectCaches(workdir: string): void {
  runsListCache.delete(workdir);
  invalidateProjectProjectionCache(workdir);
}

function resolveRuntimePathWithinProject(workdir: string, inputPath: string, label: string): string {
  const resolvedWorkdir = resolve(workdir);
  const resolvedPath = resolve(workdir, inputPath);
  if (
    resolvedPath !== resolvedWorkdir &&
    !resolvedPath.startsWith(`${resolvedWorkdir}${sep}`)
  ) {
    throw new HttpError(400, "PROJECT_PATH_OUTSIDE_WORKDIR", `${label} must stay within the current workdir.`, {
      inputPath
    });
  }
  return resolvedPath;
}

function summarizeAdapterResult(result: unknown): Record<string, unknown> {
  const record = asRecord(result) ?? {};
  const runSummary = asRecord(record.runSummary) ?? {};
  const errorEnvelope = asRecord(record.errorEnvelope) ?? {};
  return {
    systemId: asString(record.systemId),
    systemVersion: asString(record.systemVersion),
    finalRoleId: asString(record.finalRoleId),
    transitionCount: asNumber(runSummary.totalTransitions),
    stageCount: Array.isArray(record.stages) ? record.stages.length : undefined,
    error: asString(record.error),
    errorCode: asString(errorEnvelope.errorCode)
  };
}

async function readSystemSource(runDir: string): Promise<string | null> {
  try {
    return await readFile(resolve(runDir, "system.mmd"), "utf8");
  } catch {
    return null;
  }
}

async function hasTimelineProjection(runDir: string): Promise<boolean> {
  try {
    const timelineStat = await stat(resolve(runDir, "timeline.jsonl"));
    return timelineStat.isFile();
  } catch {
    return false;
  }
}

async function loadRunDetail(workdir: string, runId: string): Promise<LoadedRunDetail> {
  const detail = (await inspectRun(workdir, runId)) as InspectRunRecord;
  const runDir = resolveRunDir(workdir, runId);
  const systemSource = await readSystemSource(runDir);
  return {
    ...detail,
    systemSource
  };
}

async function readLegacyRunEvents(runDir: string): Promise<NdjsonEntry[]> {
  const eventsPath = resolve(runDir, "events.ndjson");
  let content: string;
  try {
    content = await readFile(eventsPath, "utf8");
  } catch {
    return [];
  }

  const records: NdjsonEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        continue;
      }
      const projected = projectTimelineRecord({
        cursor: records.length,
        event: parsed as Record<string, unknown>
      });
      if (!projected) {
        continue;
      }
      records.push({
        cursor: projected.cursor,
        record: projected
      });
    } catch {
      continue;
    }
  }
  return records;
}

async function loadRunEventsSnapshot(args: {
  workdir: string;
  runId: string;
  cursor?: number;
  limit?: number;
  roleId?: string;
  branchId?: string;
  type?: string;
  reviewId?: string;
  status?: string;
  errorCode?: string;
}): Promise<{ events: NdjsonEntry[]; nextCursor: number }> {
  const runDir = resolveRunDir(args.workdir, args.runId);
  if (await hasTimelineProjection(runDir)) {
    const timelineSnapshot = await loadTimelineTailSnapshot({
      timelinePath: resolve(runDir, "timeline.jsonl"),
      cursor: args.cursor,
      limit: args.limit,
      roleId: args.roleId,
      branchId: args.branchId,
      type: args.type,
      reviewId: args.reviewId,
      status: args.status,
      errorCode: args.errorCode
    });
    return {
      events: timelineSnapshot.events,
      nextCursor: timelineSnapshot.nextCursor
    };
  }
  const allEvents = await readLegacyRunEvents(runDir);
  const startCursor = Math.max(0, args.cursor ?? 0);
  const limit = args.limit ?? 500;
  const filtered = allEvents
    .filter((entry) => entry.cursor >= startCursor)
    .filter((entry) => {
      const type = asString(entry.record.type);
      const roleId = asString(entry.record.roleId);
      const branchId = asString(entry.record.branchId);
      if (args.type && type !== args.type) {
        return false;
      }
      if (args.roleId && roleId !== args.roleId) {
        return false;
      }
      if (args.branchId && branchId !== args.branchId) {
        return false;
      }
      if (args.reviewId && asString(entry.record.reviewId) !== args.reviewId) {
        return false;
      }
      if (args.status && asString(entry.record.status) !== args.status) {
        return false;
      }
      if (args.errorCode && asString(entry.record.errorCode) !== args.errorCode) {
        return false;
      }
      return true;
    })
    .slice(0, limit);

  return {
    events: filtered,
    nextCursor: allEvents.length
  };
}

async function handleApiRunsList(workdir: string, response: ServerResponse): Promise<void> {
  const indexStat = await stat(resolve(workdir, ".ogs", "runs-index.json")).catch(() => undefined);
  const cached = runsListCache.get(workdir);
  if (
    cached &&
    ((indexStat?.mtimeMs === undefined && cached.indexMtimeMs === undefined) ||
      (indexStat?.mtimeMs !== undefined && cached.indexMtimeMs === indexStat.mtimeMs))
  ) {
    jsonResponse(response, 200, { generatedAt: cached.generatedAt, runs: cached.runs });
    return;
  }
  const persisted = await loadPersistedRunsIndex(workdir);
  if (persisted) {
    const entry: RunsListCacheEntry = {
      generatedAt: persisted.generatedAt,
      runs: persisted.runs,
      indexMtimeMs: indexStat?.mtimeMs
    };
    runsListCache.set(workdir, entry);
    jsonResponse(response, 200, { generatedAt: persisted.generatedAt, runs: persisted.runs });
    return;
  }
  if (cached) {
    jsonResponse(response, 200, { generatedAt: cached.generatedAt, runs: cached.runs });
    return;
  }
  const runs = await loadIndexedRuns(workdir);
  const fallbackEntry: RunsListCacheEntry = {
    generatedAt: new Date().toISOString(),
    runs
  };
  runsListCache.set(workdir, fallbackEntry);
  jsonResponse(response, 200, { generatedAt: fallbackEntry.generatedAt, runs });
}

async function handleApiProjectSummary(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectVisualization(workdir));
}

async function handleApiProjectSystem(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectSystemVisualization(workdir));
}

async function handleApiProjectWorkbench(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, mapWorkbenchView(await inspectProjectSystemWorkbench({ workdir })));
}

async function handleApiProjectConfig(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectConfigVisualization(workdir));
}

async function handleApiProjectProfilesUpsert(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  jsonResponse(response, 200, await upsertProjectProfilesVisualization({
    workdir,
    profiles: Array.isArray(body.profiles) ? body.profiles : []
  }));
}

async function handleApiProjectRoles(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await listProjectRolesVisualization(workdir));
}

async function handleApiProjectOpsSummary(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectOpsSummaryVisualization(workdir));
}

async function handleApiProjectBindings(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectBindingVisualization(workdir));
}

async function handleApiProjectContracts(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectContractVisualization(workdir));
}

async function handleApiProjectRolePackages(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectRolePackagesVisualization(workdir));
}

async function handleApiProjectReadiness(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectReadiness(workdir));
}

async function readJsonRequest(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new HttpError(400, "INVALID_JSON_BODY", "Request body must be valid JSON.", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "INVALID_JSON_BODY", "Expected a JSON object request body.");
  }
  return parsed as Record<string, unknown>;
}

async function handleApiProjectValidate(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const systemSource = asString(body.systemSource);
  if (!systemSource) {
    throw new HttpError(400, "SYSTEM_SOURCE_REQUIRED", "systemSource is required.");
  }
  const systemPath = asString(body.systemPath);
  jsonResponse(
    response,
    200,
    mapWorkbenchValidationView(await validateProjectSystemSource({ workdir, systemPath, systemSource }))
  );
}

async function handleApiProjectSave(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse,
  saveAs: boolean
): Promise<void> {
  const body = await readJsonRequest(request);
  const systemSource = asString(body.systemSource);
  if (!systemSource) {
    throw new HttpError(400, "SYSTEM_SOURCE_REQUIRED", "systemSource is required.");
  }
  const saveAsPath = asString(body.saveAsPath);
  if (saveAs && !saveAsPath) {
    throw new HttpError(400, "SAVE_AS_PATH_REQUIRED", "saveAsPath is required for save-as.");
  }
  const result = await saveProjectSystemSource({
    workdir,
    systemSource,
    saveAsPath
  });
  invalidateAllProjectCaches(workdir);
  jsonResponse(response, 200, mapWorkbenchSaveView(result));
}

async function handleApiStudioBridgeInspect(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = request.method?.toUpperCase() === "POST" ? await readJsonRequest(request) : {};
  const systemSource = asString(body.systemSource);
  const systemPath = asString(body.systemPath);
  jsonResponse(response, 200, await inspectStudioBridgeDraft({
    workdir,
    systemPath,
    systemSource,
    validateSystemSource: validateProjectSystemSource
  }));
}

async function handleApiStudioAuthoringGet(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await loadStudioAuthoringDraft(workdir));
}

async function handleApiStudioAuthoringSave(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const authoring = body.authoring;
  if (!authoring || typeof authoring !== "object" || Array.isArray(authoring)) {
    throw new HttpError(400, "AUTHORING_DOCUMENT_REQUIRED", "authoring is required.");
  }
  jsonResponse(response, 200, await saveStudioAuthoringDraft({
    workdir,
    authoring,
    validateSystemSource: validateProjectSystemSource
  }));
}

async function handleApiStudioAuthoringImportMmd(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const systemSource = asString(body.systemSource);
  if (!systemSource) {
    throw new HttpError(400, "SYSTEM_SOURCE_REQUIRED", "systemSource is required.");
  }
  const systemPath = asString(body.systemPath) ?? resolve(workdir, "system.mmd");
  const authoring = importMermaidToAuthoring({ workdir, systemPath, systemSource });
  jsonResponse(response, 200, {
    workdir,
    systemPath,
    authoring
  });
}

async function handleApiStudioAuthoringGenerateMmd(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const authoring = body.authoring;
  if (!authoring || typeof authoring !== "object" || Array.isArray(authoring)) {
    throw new HttpError(400, "AUTHORING_DOCUMENT_REQUIRED", "authoring is required.");
  }
  const systemSource = serializeAuthoringToMermaid(authoring as StudioAuthoringDocument);
  const validation = await validateProjectSystemSource({
    workdir,
    systemPath: resolve(workdir, "system.mmd"),
    systemSource
  });
  jsonResponse(response, 200, {
    workdir,
    systemPath: resolve(workdir, "system.mmd"),
    systemSource,
    validation
  });
}

async function handleApiStudioAuthoringApplyCanvas(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const authoring = body.authoring;
  const canvas = body.canvas;
  if (!authoring || typeof authoring !== "object" || Array.isArray(authoring)) {
    throw new HttpError(400, "AUTHORING_DOCUMENT_REQUIRED", "authoring is required.");
  }
  if (!canvas || typeof canvas !== "object" || Array.isArray(canvas)) {
    throw new HttpError(400, "CANVAS_DOCUMENT_REQUIRED", "canvas is required.");
  }
  const appliedAuthoring = applyCanvasDocumentToAuthoring({
    authoring: authoring as StudioAuthoringDocument,
    canvas: canvas as StudioCanvasDocument
  });
  const systemSource = serializeAuthoringToMermaid(appliedAuthoring);
  const validation = await validateProjectSystemSource({
    workdir,
    systemPath: resolve(workdir, "system.mmd"),
    systemSource
  });
  jsonResponse(response, 200, {
    authoring: appliedAuthoring,
    canvas: authoringToCanvasDocument(appliedAuthoring),
    systemSource,
    validation
  });
}

async function handleApiStudioTemplates(response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, {
    templates: listStudioAuthoringTemplates()
  });
}

async function handleApiProjectLoad(
  state: VisualizationServerState,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const requestedWorkdir = asString(body.workdir);
  if (!requestedWorkdir) {
    throw new HttpError(400, "PROJECT_WORKDIR_REQUIRED", "workdir is required.");
  }
  const targetWorkdir = resolve(requestedWorkdir);
  const systemStat = await stat(resolve(targetWorkdir, "system.mmd")).catch(() => undefined);
  const ogsStat = await stat(resolve(targetWorkdir, ".ogs")).catch(() => undefined);
  if (!systemStat?.isFile() || !ogsStat?.isDirectory()) {
    throw new HttpError(
      400,
      "PROJECT_INVALID_WORKDIR",
      "Expected a project directory containing system.mmd and .ogs/."
    );
  }
  const workbench = await inspectProjectSystemWorkbench({ workdir: targetWorkdir });
  const workbenchRecord = asRecord(workbench) ?? {};
  const validation = asRecord(workbenchRecord.validation);
  if (validation?.ok !== true) {
    throw new HttpError(
      409,
      "PROJECT_REBIND_VALIDATION_FAILED",
      "Target project failed Mermaid validation and cannot be rebound.",
      validation
    );
  }
  const previousWorkdir = state.workdir;
  invalidateAllProjectCaches(previousWorkdir);
  invalidateAllProjectCaches(targetWorkdir);
  state.workdir = targetWorkdir;
  await rebuildRunsIndex(targetWorkdir).catch(() => undefined);
  jsonResponse(
    response,
    200,
    mapProjectLoadView({
      workdir: targetWorkdir,
      mode: "single-project-v1",
      loadedFiles: ["system.mmd", ".ogs/"],
      validation,
      followUpActions: [
        {
          action: "project-rebound",
          label: `Visualizer workdir rebound from ${previousWorkdir} to ${targetWorkdir}.`
        },
        {
          action: "reload-runs",
          label: "Refresh project and run projections for the new workdir."
        }
      ]
    })
  );
}

async function handleApiProjectExport(workdir: string, response: ServerResponse): Promise<void> {
  const exported = await exportProjectBundle(workdir);
  jsonResponse(
    response,
    200,
    mapProjectTransferView({
      ...asRecord(exported),
      sensitivityNotice:
        "Export mode omits .ogs/runs, logs, timeline, checkpoints, and review artifacts."
    })
  );
}

async function handleApiRunDetail(workdir: string, runId: string, response: ServerResponse): Promise<void> {
  const detail = await loadRunDetail(workdir, runId);
  jsonResponse(
    response,
    200,
    mapRunDetailView({
      runId: detail.runId,
      runDir: detail.runDir,
      header: buildRunHeader(detail),
      state: detail.state,
      metrics: detail.metrics,
      resolvedConfig: detail.resolvedConfig,
      stopRequest: detail.stopRequest,
      stopOutcome: detail.stopOutcome,
      summary: detail.summary,
      systemSource: detail.systemSource
    })
  );
}

async function handleApiRunState(workdir: string, runId: string, response: ServerResponse): Promise<void> {
  const detail = await inspectRun(workdir, runId);
  jsonResponse(response, 200, detail.state ?? null);
}

async function handleApiRunEvents(
  workdir: string,
  runId: string,
  url: URL,
  response: ServerResponse
): Promise<void> {
  const cursor = Number(url.searchParams.get("cursor") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "500");
  const roleId = url.searchParams.get("roleId") ?? undefined;
  const branchId = url.searchParams.get("branchId") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const reviewId = url.searchParams.get("reviewId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const errorCode = url.searchParams.get("errorCode") ?? undefined;
  const snapshot = await loadRunEventsSnapshot({
    workdir,
    runId,
    cursor: Number.isFinite(cursor) ? cursor : 0,
    limit: Number.isFinite(limit) ? limit : 500,
    roleId,
    branchId,
    type,
    reviewId,
    status,
    errorCode
  });
  jsonResponse(response, 200, snapshot);
}

async function handleApiRunLogs(
  workdir: string,
  runId: string,
  url: URL,
  response: ServerResponse
): Promise<void> {
  const roleId = url.searchParams.get("roleId") ?? undefined;
  const engine = url.searchParams.get("engine") === "true";
  const since = url.searchParams.get("since") ?? undefined;
  const tailValue = url.searchParams.get("tail");
  const tail = tailValue === null ? undefined : Number(tailValue);
  const records = await loadRunLogs({
    workdir,
    runId,
    roleId,
    engine,
    since,
    tail: Number.isFinite(tail) ? tail : undefined
  });
  jsonResponse(response, 200, { records });
}

async function handleApiRunGraph(workdir: string, runId: string, response: ServerResponse): Promise<void> {
  const detail = await loadRunDetail(workdir, runId);
  jsonResponse(
    response,
    200,
    await inspectRunGraphVisualization({
      workdir,
      runId,
      state: detail.state,
      resolvedConfig: detail.resolvedConfig,
      systemSource: detail.systemSource,
      summary: detail.summary
    })
  );
}

async function handleApiRunReviews(workdir: string, runId: string, response: ServerResponse): Promise<void> {
  const payload = await listHumanReviews(workdir, runId);
  const record =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  jsonResponse(response, 200, mapReviewQueueView({
    runId,
    runDir: asString(record.runDir) ?? resolveRunDir(workdir, runId),
    latestPendingReviewId: asString(record.latestPendingReviewId),
    reviews: Array.isArray(record.reviews) ? record.reviews : []
  }));
}

async function handleApiRunReviewDetail(
  workdir: string,
  runId: string,
  reviewId: string,
  response: ServerResponse
): Promise<void> {
  jsonResponse(response, 200, mapReviewDetailView(await inspectHumanReview(workdir, runId, reviewId)));
}

async function handleApiRunResumeDiagnostics(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
  jsonResponse(response, 200, mapResumeDiagnosticsView(await inspectRunResumeDiagnostics(workdir, runId)));
}

async function handleApiRunFailure(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
  jsonResponse(response, 200, mapFailureProjectionView(await inspectRunFailureVisualization(workdir, runId)));
}

async function handleApiRunContractStatus(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
  jsonResponse(response, 200, await inspectRunContractStatusVisualization(workdir, runId));
}

async function handleApiRunResumeReadiness(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
  jsonResponse(response, 200, mapResumeReadinessView(await inspectRunResumeReadiness(workdir, runId)));
}

async function handleApiReindex(workdir: string, response: ServerResponse): Promise<void> {
  const index = await rebuildRunsIndex(workdir);
  const indexStat = await stat(resolve(workdir, ".ogs", "runs-index.json")).catch(() => undefined);
  runsListCache.set(workdir, {
    generatedAt: index.generatedAt,
    runs: index.runs,
    indexMtimeMs: indexStat?.mtimeMs
  });
  jsonResponse(response, 200, index);
}

async function detectNewRunId(workdir: string, beforeIds: Set<string>): Promise<string> {
  const indexed = await loadIndexedRuns(workdir).catch(() => []);
  const created = indexed.find((run) => {
    const record = asRecord(run);
    const runId = asString(record?.runId);
    return runId !== undefined && !beforeIds.has(runId);
  });
  const createdRunId = asString(asRecord(created)?.runId);
  if (createdRunId) {
    return createdRunId;
  }
  const runsDir = resolveOgsPaths(workdir).runsDir;
  const entries = (await readdir(runsDir).catch(() => []))
    .sort((left, right) => right.localeCompare(left));
  const fallback = entries.find((entry) => !beforeIds.has(entry));
  if (fallback) {
    return fallback;
  }
  throw new HttpError(500, "RUN_ID_DISCOVERY_FAILED", "Run completed but no runId could be determined.");
}

async function handleApiRunStart(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const systemPath = asString(body.systemPath);
  const prompt = asString(body.input);
  if (!systemPath || !prompt) {
    throw new HttpError(400, "RUN_START_INPUT_REQUIRED", "systemPath and input are required.");
  }
  const beforeIds = new Set(
    (await loadIndexedRuns(workdir).catch(() => []))
      .map((run) => asString(asRecord(run)?.runId))
      .filter((runId): runId is string => Boolean(runId))
  );
  await ensureProjectSkeleton({ workdir });
  const result = await runSystemWithAdapter({
    systemPath: resolveRuntimePathWithinProject(workdir, systemPath, "systemPath"),
    prompt,
    runtimeConfigPath: asString(body.runtimePath),
    userProfilePath: asString(body.userProfilePath),
    lawsPath: asString(body.lawsPath),
    workdir,
    dryRun: body.dryRun === true,
    cleanupExecutionHistory: asNumber(body.cleanupExecutionHistory),
    logRun: false
  });
  await rebuildRunsIndex(workdir);
  const runId = await detectNewRunId(workdir, beforeIds);
  jsonResponse(
    response,
    200,
    mapRunLifecycleView({
      runId,
      status: asString(asRecord(result)?.status) ?? "unknown",
      resultSummary: summarizeAdapterResult(result),
      followUpActions: [
        {
          action: "open-run-detail",
          label: `Open run ${runId} to inspect graph, logs, and reviews.`
        },
        {
          action: "refresh-runs",
          label: "Runs index was rebuilt after start."
        }
      ]
    })
  );
}

async function handleApiRunResume(
  workdir: string,
  runId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const runDir = resolveRunDir(workdir, runId);
  const systemPath =
    asString(body.systemPath) ?? resolve(runDir, "system.mmd");
  const prompt =
    asString(body.input) ??
    (await readFile(resolve(runDir, "request.md"), "utf8")).replace(/\s+$/, "");
  const result = await runSystemWithAdapter({
    systemPath: resolveRuntimePathWithinProject(workdir, systemPath, "systemPath"),
    prompt,
    runtimeConfigPath: asString(body.runtimePath),
    userProfilePath: asString(body.userProfilePath),
    lawsPath: asString(body.lawsPath),
    resumeRunDir: runDir,
    workdir,
    dryRun: body.dryRun === true,
    cleanupExecutionHistory: asNumber(body.cleanupExecutionHistory),
    logRun: false
  });
  await rebuildRunsIndex(workdir);
  jsonResponse(
    response,
    200,
    mapRunLifecycleView({
      runId,
      status: asString(asRecord(result)?.status) ?? "unknown",
      resultSummary: summarizeAdapterResult(result),
      followUpActions: [
        {
          action: "open-run-detail",
          label: `Resume finished for ${runId}; inspect the updated run detail.`
        },
        {
          action: "check-resume-diagnostics",
          label: "Refresh resume diagnostics and review state after the resume run."
        }
      ]
    })
  );
}

async function handleApiRunReviewDecision(
  workdir: string,
  runId: string,
  reviewId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const decision = asString(body.decision);
  if (decision !== "approve" && decision !== "rework" && decision !== "pause" && decision !== "terminate") {
    throw new HttpError(
      400,
      "INVALID_REVIEW_DECISION",
      "decision must be one of: approve, rework, pause, terminate."
    );
  }
  const scopeValue = asString(body.scope);
  if (scopeValue !== undefined && scopeValue !== "branch" && scopeValue !== "run") {
    throw new HttpError(400, "INVALID_TERMINATE_SCOPE", "scope must be branch or run.");
  }
  if (scopeValue !== undefined && decision !== "terminate") {
    throw new HttpError(400, "INVALID_TERMINATE_SCOPE", "--scope is only valid with decision=terminate.");
  }
  const detail = await writeHumanReviewDecision({
    workdir,
    runId,
    reviewId,
    decision,
    comment: asString(body.comment),
    actor: asString(body.actor),
    scope: scopeValue
  });
  const semanticStatus =
    decision === "pause"
      ? "human-review-paused"
      : decision === "terminate"
        ? `human-review-terminated:${scopeValue ?? "branch"}`
        : `human-review-${decision}d`;
  jsonResponse(
    response,
    200,
    mapControlActionView({
      runId,
      action: `review:${decision}`,
      accepted: true,
      semanticStatus,
      detail: {
        reviewId,
        note:
          decision === "pause"
            ? "This pause only affects the human review node, not the whole run."
            : decision === "terminate"
              ? `Terminate scope=${scopeValue ?? "branch"} applies to the review target, not a generic run pause.`
              : "Decision recorded in the control plane; runtime reconcile may still be pending.",
        lifecycle: detail
      }
    })
  );
}

async function handleApiStop(
  workdir: string,
  runId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const detail = await requestStop(workdir, runId, asString(body.reason));
  const runDetail = await loadRunDetail(workdir, runId).catch(() => undefined);
  jsonResponse(
    response,
    200,
    mapControlActionView({
      runId,
      action: "run-stop",
      accepted: true,
      semanticStatus: "stop-request-recorded",
      detail: {
        requestRecorded: true,
        stopOutcomeApplied: Boolean(asRecord(runDetail?.stopOutcome)),
        runStatus:
          asString(asRecord(runDetail?.summary)?.status) ??
          asString(asRecord(runDetail?.state)?.status),
        converged:
          ["done", "failed", "stopped"].includes(
            asString(asRecord(runDetail?.summary)?.status) ??
              asString(asRecord(runDetail?.state)?.status) ??
              ""
          ),
        lifecycle: detail
      }
    })
  );
}

function resolveServerLocale(url: URL, request: IncomingMessage): Locale {
  if (url.searchParams.has("lang")) {
    return resolveLocaleFromQuery(url.searchParams);
  }
  return resolveLocaleFromAcceptLanguage(request.headers["accept-language"]) ?? "en";
}

function renderPageHtml(workdir: string, locale: Locale): string {
  return renderVisualizerPageHtml(workdir, API_PREFIX, {
    locale,
    messages: getDictionary(locale)
  });
}

function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/^Run not found:/i.test(message)) {
    return new HttpError(404, "RUN_NOT_FOUND", message);
  }
  if (/^Review not found:/i.test(message)) {
    return new HttpError(404, "REVIEW_NOT_FOUND", message);
  }
  if (/already resolved|already expired|not actionable/i.test(message)) {
    return new HttpError(409, "REVIEW_NOT_ACTIONABLE", message);
  }
  if (/^Choose either --engine or --role/i.test(message) || /^Invalid --since/i.test(message)) {
    return new HttpError(400, "INVALID_LOG_QUERY", message);
  }
  if (error instanceof Error && "envelope" in error) {
    const envelope = asRecord((error as { envelope?: unknown }).envelope);
    return new HttpError(
      400,
      asString(envelope?.errorCode) ?? "RUNTIME_ERROR",
      asString(envelope?.message) ?? message,
      envelope
    );
  }
  return new HttpError(500, "VISUALIZER_INTERNAL_ERROR", message);
}

async function handleVisualizationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: VisualizationServerState,
  options: VisualizationServerOptions
): Promise<void> {
  const method = request.method?.toUpperCase() ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${options.host}:${options.port}`}`);
  const pathname = url.pathname;
  let segments: string[];
  try {
    segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, "INVALID_PATH_ENCODING", "Invalid path encoding.");
  }

  if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    textResponse(response, 200, renderPageHtml(state.workdir, resolveServerLocale(url, request)), "text/html; charset=utf-8");
    return;
  }

  if (method === "GET" && pathname.startsWith("/assets/")) {
    const asset = STATIC_ASSET_ROUTES.get(pathname);
    if (!asset) {
      throw new HttpError(404, "NOT_FOUND", "Not found");
    }
    textResponse(response, 200, await readFile(asset.filePath, "utf8"), asset.contentType);
    return;
  }

  if (segments[0] !== "api" || segments[1] !== "v1") {
    throw new HttpError(404, "NOT_FOUND", "Not found");
  }

  if (segments.length === 3 && segments[2] === "project" && method === "GET") {
    await handleApiProjectSummary(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "system" && method === "GET") {
    await handleApiProjectSystem(state.workdir, response);
    return;
  }
  if (segments.length === 5 && segments[2] === "project" && segments[3] === "system" && segments[4] === "workbench" && method === "GET") {
    await handleApiProjectWorkbench(state.workdir, response);
    return;
  }
  if (segments.length === 5 && segments[2] === "project" && segments[3] === "system" && segments[4] === "validate" && method === "POST") {
    await handleApiProjectValidate(state.workdir, request, response);
    return;
  }
  if (segments.length === 5 && segments[2] === "project" && segments[3] === "system" && segments[4] === "save" && method === "POST") {
    await handleApiProjectSave(state.workdir, request, response, false);
    return;
  }
  if (segments.length === 5 && segments[2] === "project" && segments[3] === "system" && segments[4] === "save-as" && method === "POST") {
    await handleApiProjectSave(state.workdir, request, response, true);
    return;
  }
  if (
    segments.length === 5 &&
    segments[2] === "project" &&
    segments[3] === "studio" &&
    segments[4] === "bridge" &&
    (method === "GET" || method === "POST")
  ) {
    await handleApiStudioBridgeInspect(state.workdir, request, response);
    return;
  }
  if (
    segments.length === 5 &&
    segments[2] === "project" &&
    segments[3] === "studio" &&
    segments[4] === "authoring" &&
    method === "GET"
  ) {
    await handleApiStudioAuthoringGet(state.workdir, response);
    return;
  }
  if (
    segments.length === 5 &&
    segments[2] === "project" &&
    segments[3] === "studio" &&
    segments[4] === "authoring" &&
    method === "POST"
  ) {
    await handleApiStudioAuthoringSave(state.workdir, request, response);
    return;
  }
  if (
    segments.length === 6 &&
    segments[2] === "project" &&
    segments[3] === "studio" &&
    segments[4] === "authoring" &&
    segments[5] === "import-mmd" &&
    method === "POST"
  ) {
    await handleApiStudioAuthoringImportMmd(state.workdir, request, response);
    return;
  }
  if (
    segments.length === 6 &&
    segments[2] === "project" &&
    segments[3] === "studio" &&
    segments[4] === "authoring" &&
    segments[5] === "generate-mmd" &&
    method === "POST"
  ) {
    await handleApiStudioAuthoringGenerateMmd(state.workdir, request, response);
    return;
  }
  if (
    segments.length === 6 &&
    segments[2] === "project" &&
    segments[3] === "studio" &&
    segments[4] === "authoring" &&
    segments[5] === "apply-canvas" &&
    method === "POST"
  ) {
    await handleApiStudioAuthoringApplyCanvas(state.workdir, request, response);
    return;
  }
  if (
    segments.length === 5 &&
    segments[2] === "project" &&
    segments[3] === "studio" &&
    segments[4] === "templates" &&
    method === "GET"
  ) {
    await handleApiStudioTemplates(response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "config" && method === "GET") {
    await handleApiProjectConfig(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "profiles" && method === "POST") {
    await handleApiProjectProfilesUpsert(state.workdir, request, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "roles" && method === "GET") {
    await handleApiProjectRoles(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "ops-summary" && method === "GET") {
    await handleApiProjectOpsSummary(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "bindings" && method === "GET") {
    await handleApiProjectBindings(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "contracts" && method === "GET") {
    await handleApiProjectContracts(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "role-packages" && method === "GET") {
    await handleApiProjectRolePackages(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "readiness" && method === "GET") {
    await handleApiProjectReadiness(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "load" && method === "POST") {
    await handleApiProjectLoad(state, request, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "export" && method === "POST") {
    await handleApiProjectExport(state.workdir, response);
    return;
  }

  if (segments.length === 3 && segments[2] === "runs" && method === "GET") {
    await handleApiRunsList(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "runs" && segments[3] === "start" && method === "POST") {
    await handleApiRunStart(state.workdir, request, response);
    return;
  }
  if (segments.length >= 3 && segments[2] === "runs" && segments[3] === "reindex" && method === "POST") {
    await handleApiReindex(state.workdir, response);
    return;
  }

  if (segments.length < 4 || segments[2] !== "runs") {
    throw new HttpError(404, "NOT_FOUND", "Not found");
  }

  const runId = segments[3];

  if (segments.length === 4 && method === "GET") {
    await handleApiRunDetail(state.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "state" && method === "GET") {
    await handleApiRunState(state.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "events" && method === "GET") {
    await handleApiRunEvents(state.workdir, runId, url, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "logs" && method === "GET") {
    await handleApiRunLogs(state.workdir, runId, url, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "graph" && method === "GET") {
    await handleApiRunGraph(state.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "reviews" && method === "GET") {
    await handleApiRunReviews(state.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "failure" && method === "GET") {
    await handleApiRunFailure(state.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "contracts" && method === "GET") {
    await handleApiRunContractStatus(state.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "resume-diagnostics" && method === "GET") {
    await handleApiRunResumeDiagnostics(state.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "resume-readiness" && method === "GET") {
    await handleApiRunResumeReadiness(state.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "resume" && method === "POST") {
    await handleApiRunResume(state.workdir, runId, request, response);
    return;
  }
  if (segments.length === 7 && segments[4] === "reviews" && segments[6] === "decide" && method === "POST") {
    await handleApiRunReviewDecision(state.workdir, runId, segments[5], request, response);
    return;
  }
  if (segments.length === 6 && segments[4] === "reviews" && method === "GET") {
    await handleApiRunReviewDetail(state.workdir, runId, segments[5], response);
    return;
  }
  if (segments.length === 5 && segments[4] === "stream" && method === "GET") {
    const startCursor = Math.max(0, Number(url.searchParams.get("cursor") ?? "0") || 0);
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    response.write("retry: 2000\n");

    let active = true;
    let cursor = startCursor;
    let inFlight = false;

    const pushSnapshot = async (): Promise<void> => {
      if (!active || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const snapshot = await loadRunEventsSnapshot({
          workdir: state.workdir,
          runId,
          cursor,
          limit: 500
        });
        for (const entry of snapshot.events) {
          if (!active) {
            break;
          }
          response.write(`id: ${cursor}\n`);
          response.write("event: event\n");
          response.write(`data: ${JSON.stringify(entry)}\n\n`);
          cursor = entry.cursor + 1;
        }
      } finally {
        inFlight = false;
      }
    };

    const interval = setInterval(() => {
      void pushSnapshot();
    }, 1000);
    request.on("close", () => {
      active = false;
      clearInterval(interval);
      response.end();
    });
    await pushSnapshot();
    return;
  }
  if (segments.length === 5 && segments[4] === "stop" && method === "POST") {
    await handleApiStop(state.workdir, runId, request, response);
    return;
  }

  throw new HttpError(404, "NOT_FOUND", "Not found");
}

export async function startVisualizationServer(args: VisualizationServerOptions): Promise<{
  server: ReturnType<typeof createServer>;
  url: string;
  port: number;
}> {
  const state: VisualizationServerState = {
    workdir: resolve(args.workdir)
  };
  const server = createServer((request, response) => {
    void handleVisualizationRequest(request, response, state, args).catch((error) => {
      const normalized = normalizeError(error);
      jsonResponse(
        response,
        normalized.statusCode,
        mapErrorView({
          code: normalized.errorCode,
          message: normalized.message,
          details: normalized.details
        })
      );
    });
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const handleError = (error: Error): void => {
      server.off("listening", handleListening);
      rejectPromise(error);
    };
    const handleListening = (): void => {
      server.off("error", handleError);
      resolvePromise();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(args.port, args.host);
  });

  const address = server.address();
  const port =
    typeof address === "object" && address && "port" in address ? address.port : args.port;
  return {
    server,
    url: `http://${args.host}:${port}`,
    port
  };
}
