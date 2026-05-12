/**
 * @fileoverview Minimal read-mostly visualization server for OGSystem runs.
 * Responsibilities:
 * - Serve run summaries, details, event snapshots, and a lightweight SSE stream.
 * - Render a single-page observability UI without a front-end build toolchain.
 * Boundaries:
 * - Read-mostly; mutations are limited to lifecycle/control-plane entrypoints.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runSystemWithAdapter } from "../runtime/adapter.js";
import {
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
import { redactUnknown } from "../runtime/redaction.js";
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
  createProjectVisualization,
  exportProjectBundle,
  inspectProjectBindingVisualization,
  inspectProjectConfigVisualization,
  inspectProjectContractVisualization,
  inspectProjectRolePackageFilesVisualization,
  inspectProjectRolePackagesVisualization,
  inspectProjectSystemVisualization,
  inspectProjectSystemWorkbench,
  inspectProjectWorkspace,
  inspectProjectVisualization,
  getProjectProjectionCacheStats,
  invalidateProjectProjectionCache,
  importInstalledRolesVisualization,
  listInstalledRoleCatalog,
  listProjectRolesVisualization,
  saveProjectRolePackageFilesVisualization,
  saveProjectSystemSource,
  upsertProjectExecutionConfigVisualization,
  upsertProjectProfilesVisualization,
  validateProjectSystemSource
} from "./project-projection.js";
import { inspectRunGraphVisualization } from "./run-graph-projection.js";
import {
  authoringToCanvasDocument,
  importMermaidToAuthoring,
  inspectStudioBridgeDraft,
  loadStudioAuthoringDraft,
  saveStudioAuthoringDraft,
  serializeAuthoringToMermaid,
  type StudioAuthoringDocument
} from "./studio-authoring.js";
import {
  parseStudioChatToMmdRequest,
  StudioChatToMmdDependencyError,
  runStudioChatToMmdTurn,
  type StudioChatToMmdSessionMap
} from "./studio-chat-to-mmd.js";
import { listStudioAuthoringTemplates } from "./studio-templates.js";
import {
  mapControlActionView,
  mapErrorView,
  mapFailureProjectionView,
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
import {
  JsonBodyError,
  readJsonRequestBody
} from "./request-body.js";
import {
  asNumber,
  asRecord,
  asString
} from "./json-guards.js";
import {
  cachePendingProjectCreateResponse,
  cacheProjectCreateResponse,
  clearPendingProjectCreateResponse,
  clearRunsListCache,
  createRunsListCacheEntry,
  getRunsListCacheStats,
  getVisualizerSseMetricsSnapshot,
  readCachedProjectCreateResponse,
  readFallbackRunsListCache,
  readPendingProjectCreateResponse,
  readRunsListCache,
  recordSseConnectionClosed,
  recordSseConnectionOpened,
  recordSseSnapshotAttempt,
  recordSseSnapshotError,
  recordSseTick,
  recordSseWrite,
  type ProjectCreateRequestCacheEntry,
  writeRunsListCache
} from "./server-runtime-state.js";

type VisualizationServerOptions = {
  workdir: string;
  host: string;
  port: number;
  projectCreateRequestCacheTtlMs?: number;
  projectCreateRequestCacheMaxSize?: number;
  testHooks?: {
    projectCreate?: {
      cleanupFailurePatterns?: string[];
      forceCreateFailure?: boolean;
    };
    studioChat?: {
      forceDependencyFailureMessage?: string;
    };
  };
};

type VisualizationServerState = {
  workdir: string;
  projectCreateRequests: Map<string, ProjectCreateRequestCacheEntry>;
  projectCreateRequestCacheTtlMs: number;
  projectCreateRequestCacheMaxSize: number;
  studioChatToMmdSessions: StudioChatToMmdSessionMap;
  testHooks?: VisualizationServerOptions["testHooks"];
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
  snapshotManifest: Record<string, unknown> | null;
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
const DEFAULT_PROJECT_CREATE_REQUEST_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_PROJECT_CREATE_REQUEST_CACHE_MAX_SIZE = 128;
const MAX_JSON_REQUEST_BYTES = 1024 * 1024;
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

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function readProjectCreatePayload(body: Record<string, unknown>): {
  projectName?: unknown;
  templateId?: unknown;
  conflictStrategy?: unknown;
} {
  const wizard = asRecord(body.wizard);
  return {
    projectName: body.projectName ?? wizard?.projectName,
    templateId: body.templateId ?? wizard?.templateId,
    conflictStrategy: body.conflictStrategy ?? wizard?.conflictStrategy
  };
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
  clearRunsListCache(workdir);
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

function resolveOptionalRuntimePathWithinProject(
  workdir: string,
  inputPath: string | undefined,
  label: string
): string | undefined {
  return inputPath ? resolveRuntimePathWithinProject(workdir, inputPath, label) : undefined;
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

async function readSnapshotManifest(runDir: string, systemSource: string | null): Promise<Record<string, unknown> | null> {
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readFile(resolve(runDir, "snapshot-manifest.json"), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        manifestVersion: 0,
        status: "invalid",
        warning: "snapshot-manifest.json is not an object."
      };
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    return {
      manifestVersion: 0,
      status: "missing",
      warning: "snapshot-manifest.json is missing; run artifact system.mmd remains the historical source."
    };
  }
  const source = asRecord(manifest.source);
  const expectedHash = asString(source?.sourceHash);
  const actualHash = systemSource === null ? undefined : createHash("sha256").update(systemSource).digest("hex");
  return {
    ...manifest,
    status: expectedHash && actualHash && expectedHash !== actualHash ? "hash_mismatch" : "ok",
    actualSourceHash: actualHash,
    warning: expectedHash && actualHash && expectedHash !== actualHash
      ? "snapshot sourceHash differs from run artifact system.mmd; run artifact system.mmd is used as historical truth."
      : undefined
  };
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
  const snapshotManifest = await readSnapshotManifest(runDir, systemSource);
  return {
    ...detail,
    systemSource,
    snapshotManifest
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
  const cached = readRunsListCache(workdir, indexStat?.mtimeMs);
  if (cached) {
    jsonResponse(response, 200, { generatedAt: cached.generatedAt, runs: cached.runs });
    return;
  }
  const persisted = await loadPersistedRunsIndex(workdir);
  if (persisted) {
    const entry = createRunsListCacheEntry({
      generatedAt: persisted.generatedAt,
      runs: persisted.runs,
      indexMtimeMs: indexStat?.mtimeMs
    });
    writeRunsListCache(workdir, entry);
    jsonResponse(response, 200, { generatedAt: persisted.generatedAt, runs: persisted.runs });
    return;
  }
  const fallbackCached = readFallbackRunsListCache(workdir);
  if (fallbackCached) {
    jsonResponse(response, 200, { generatedAt: fallbackCached.generatedAt, runs: fallbackCached.runs });
    return;
  }
  const runs = await loadIndexedRuns(workdir);
  const fallbackEntry = createRunsListCacheEntry({
    generatedAt: new Date().toISOString(),
    runs
  });
  writeRunsListCache(workdir, fallbackEntry);
  jsonResponse(response, 200, { generatedAt: fallbackEntry.generatedAt, runs });
}

async function handleApiVisualizerDiagnostics(response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, {
    caches: {
      runsList: getRunsListCacheStats(),
      projectProjection: getProjectProjectionCacheStats()
    },
    sse: getVisualizerSseMetricsSnapshot()
  });
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

async function handleApiProjectExecutionConfigUpsert(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  jsonResponse(response, 200, await upsertProjectExecutionConfigVisualization({
    workdir,
    profiles: Array.isArray(body.profiles) ? body.profiles : [],
    tools: Array.isArray(body.tools) ? body.tools : []
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

async function handleApiProjectRolePackageDetail(
  workdir: string,
  roleId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method?.toUpperCase() === "POST") {
    const body = await readJsonRequest(request);
    jsonResponse(response, 200, await saveProjectRolePackageFilesVisualization({
      workdir,
      roleId,
      files: body.files ?? body
    }));
    return;
  }
  jsonResponse(response, 200, await inspectProjectRolePackageFilesVisualization({ workdir, roleId }));
}

async function handleApiProjectReadiness(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectReadiness(workdir));
}

async function readJsonRequest(request: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    return await readJsonRequestBody(request);
  } catch (error) {
    if (error instanceof JsonBodyError) {
      throw new HttpError(error.statusCode, error.errorCode, error.message, error.details);
    }
    throw error;
  }
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
  if (!authoring || typeof authoring !== "object" || Array.isArray(authoring)) {
    throw new HttpError(400, "AUTHORING_DOCUMENT_REQUIRED", "authoring is required.");
  }
  const saved = await saveStudioAuthoringDraft({
    workdir,
    authoring,
    validateSystemSource: validateProjectSystemSource
  });
  const appliedAuthoring = saved.authoring as StudioAuthoringDocument;
  jsonResponse(response, 200, {
    workdir,
    systemPath: resolve(workdir, "system.mmd"),
    draftPath: saved.draftPath,
    authoring: appliedAuthoring,
    canvas: authoringToCanvasDocument(appliedAuthoring),
    systemSource: saved.generatedMermaid ?? serializeAuthoringToMermaid(appliedAuthoring),
    validation: saved.validation
  });
}

async function handleApiStudioChatToMmd(
  state: VisualizationServerState,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  let chatRequest;
  try {
    chatRequest = parseStudioChatToMmdRequest(body);
  } catch (error) {
    if (error instanceof Error && error.message === "CHAT_MESSAGE_REQUIRED") {
      throw new HttpError(400, "CHAT_MESSAGE_REQUIRED", "message is required.");
    }
    if (
      error instanceof Error &&
      /must stay within the current workdir\.$/.test(error.message)
    ) {
      const label = error.message.replace(/ must stay within the current workdir\.$/, "");
      throw new HttpError(
        400,
        "PROJECT_PATH_OUTSIDE_WORKDIR",
        `${label} must stay within the current workdir.`
      );
    }
    throw error;
  }
  if (state.testHooks?.studioChat?.forceDependencyFailureMessage) {
    throw new StudioChatToMmdDependencyError(
      state.testHooks.studioChat.forceDependencyFailureMessage
    );
  }
  jsonResponse(response, 200, await runStudioChatToMmdTurn({
    workdir: state.workdir,
    request: chatRequest,
    sessions: state.studioChatToMmdSessions,
    validateSystemSource: validateProjectSystemSource
  }));
}

async function handleApiStudioTemplates(response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, {
    templates: listStudioAuthoringTemplates()
  });
}

async function handleApiWorkspace(state: VisualizationServerState, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectWorkspace(state.workdir));
}

async function assertInitializedProject(workdir: string): Promise<void> {
  const workspace = await inspectProjectWorkspace(workdir);
  if (workspace.hasProject !== true) {
    throw new HttpError(
      409,
      "PROJECT_NOT_INITIALIZED",
      "Initialize the current directory as an OGSystem project before using this project endpoint.",
      workspace
    );
  }
}

async function handleApiProjectCreate(
  state: VisualizationServerState,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readJsonRequest(request);
  const createPayload = readProjectCreatePayload(body);
  if (body.workdir !== undefined || body.targetWorkdir !== undefined) {
    throw new HttpError(
      400,
      "INVALID_PROJECT_WORKDIR",
      "Project creation only supports the current visualizer directory."
    );
  }
  const requestId = asString(body.requestId)?.trim();
  if (requestId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) {
    throw new HttpError(400, "INVALID_PROJECT_CREATE_REQUEST_ID", "requestId must start with a letter or number and use only letters, numbers, dots, underscores, colons, or hyphens.");
  }
  if (requestId) {
    const cached = readCachedProjectCreateResponse(state, requestId);
    if (cached) {
      const cachedWorkdir = asString(cached.workdir);
      if (cachedWorkdir) {
        const previousWorkdir = state.workdir;
        state.workdir = cachedWorkdir;
        invalidateAllProjectCaches(previousWorkdir);
        invalidateAllProjectCaches(cachedWorkdir);
      }
      jsonResponse(response, 200, {
        ...cached,
        idempotentReplay: true
      });
      return;
    }
  }
  try {
    if (requestId) {
      const pending = readPendingProjectCreateResponse(state, requestId);
      if (pending) {
        const replayed = await pending;
        const replayWorkdir = asString(replayed.workdir);
        if (replayWorkdir) {
          const previousWorkdir = state.workdir;
          state.workdir = replayWorkdir;
          invalidateAllProjectCaches(previousWorkdir);
          invalidateAllProjectCaches(replayWorkdir);
        }
        jsonResponse(response, 200, {
          ...replayed,
          idempotentReplay: true
        });
        return;
      }
    }
    const createOnce = async () => {
      const created = await createProjectVisualization({
        currentWorkdir: state.workdir,
        projectName: createPayload.projectName,
        templateId: createPayload.templateId,
        conflictStrategy: createPayload.conflictStrategy,
        testHooks: state.testHooks?.projectCreate
      });
      const createdWorkdir = asString(asRecord(created)?.workdir) ?? state.workdir;
      const previousWorkdir = state.workdir;
      state.workdir = createdWorkdir;
      invalidateAllProjectCaches(previousWorkdir);
      invalidateAllProjectCaches(createdWorkdir);
      return {
        ...created,
        followUpActions: [
          {
            action: "project-created",
            label: `Project created at ${createdWorkdir}.`
          },
          {
            action: "open-build",
            label: "Open Build to continue visual authoring."
          }
        ]
      };
    };
    const payload = requestId
      ? await (() => {
          const promise = createOnce();
          cachePendingProjectCreateResponse(state, requestId, promise);
          return promise;
        })()
      : await createOnce();
    if (requestId) {
      cacheProjectCreateResponse(state, requestId, payload);
    }
    jsonResponse(response, 200, payload);
  } catch (error) {
    if (requestId) {
      clearPendingProjectCreateResponse(state, requestId);
    }
    const code = asString((error as { code?: unknown })?.code) || (error instanceof Error ? error.message : "");
    const details = (error as { details?: unknown })?.details;
    if (code === "INVALID_PROJECT_NAME") {
      throw new HttpError(400, "INVALID_PROJECT_NAME", "Project name must start with a letter or number.", details);
    }
    if (code === "INVALID_PROJECT_TEMPLATE") {
      throw new HttpError(400, "INVALID_PROJECT_TEMPLATE", "Project template is unavailable.", details);
    }
    if (code === "INVALID_PROJECT_WORKDIR") {
      throw new HttpError(400, "INVALID_PROJECT_WORKDIR", "Project creation only supports the current visualizer directory.", details);
    }
    if (code === "PROJECT_ALREADY_EXISTS") {
      throw new HttpError(409, "PROJECT_ALREADY_EXISTS", "Current directory is already an OGSystem project.", details);
    }
    if (code === "PROJECT_DIR_CONFLICT") {
      throw new HttpError(409, "PROJECT_DIR_CONFLICT", "Current directory is not empty. Confirm current-directory initialization to continue.", details);
    }
    if (code === "PROJECT_FILE_CONFLICT") {
      throw new HttpError(409, "PROJECT_FILE_CONFLICT", "Current directory contains OGSystem-controlled paths and cannot be initialized.", details);
    }
    throw new HttpError(500, "PROJECT_CREATE_FAILED", error instanceof Error ? error.message : String(error), details);
  }
}

async function handleApiRoleCatalog(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await listInstalledRoleCatalog(workdir));
}

async function handleApiRoleImport(
  workdir: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await assertInitializedProject(workdir);
  const body = await readJsonRequest(request);
  if (body.source !== undefined && body.source !== "installed") {
    throw new HttpError(400, "ROLE_IMPORT_SOURCE_UNSUPPORTED", "Only installed role catalog imports are supported.");
  }
  try {
    jsonResponse(response, 200, await importInstalledRolesVisualization({
      workdir,
      roleIds: body.roleIds
    }));
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === "ROLE_IMPORT_SELECTION_REQUIRED") {
      throw new HttpError(400, "ROLE_IMPORT_SELECTION_REQUIRED", "Select at least one role to import.");
    }
    throw error;
  }
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
      systemSource: detail.systemSource,
      snapshotManifest: detail.snapshotManifest
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
  jsonResponse(response, 200, { records: redactUnknown(records) });
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
  writeRunsListCache(workdir, createRunsListCacheEntry({
    generatedAt: index.generatedAt,
    runs: index.runs,
    indexMtimeMs: indexStat?.mtimeMs
  }));
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

async function writeRunSnapshotManifest(args: {
  workdir: string;
  runId: string;
  systemPath: string;
}): Promise<void> {
  const runDir = resolveRunDir(args.workdir, args.runId);
  const systemSource = await readFile(resolve(runDir, "system.mmd"), "utf8");
  const manifest = {
    manifestVersion: 1,
    snapshotId: args.runId,
    runId: args.runId,
    createdAt: new Date().toISOString(),
    source: {
      systemPath: args.systemPath,
      runArtifactSystemPath: "system.mmd",
      sourceHash: createHash("sha256").update(systemSource).digest("hex")
    },
    artifactSemantics: {
      historicalTruth: "run-artifact-system.mmd",
      manifestRole: "summary-and-consistency-check"
    }
  };
  await writeFile(resolve(runDir, "snapshot-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
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
  const workspace = await inspectProjectWorkspace(workdir);
  if (workspace.hasProject !== true) {
    throw new HttpError(
      409,
      "PROJECT_NOT_INITIALIZED",
      "Create or load an OGSystem project before starting a run.",
      workspace
    );
  }
  const beforeIds = new Set(
    (await loadIndexedRuns(workdir).catch(() => []))
      .map((run) => asString(asRecord(run)?.runId))
      .filter((runId): runId is string => Boolean(runId))
  );
  const result = await runSystemWithAdapter({
    systemPath: resolveRuntimePathWithinProject(workdir, systemPath, "systemPath"),
    prompt,
    runtimeConfigPath: resolveOptionalRuntimePathWithinProject(workdir, asString(body.runtimePath), "runtimePath"),
    userProfilePath: resolveOptionalRuntimePathWithinProject(workdir, asString(body.userProfilePath), "userProfilePath"),
    lawsPath: resolveOptionalRuntimePathWithinProject(workdir, asString(body.lawsPath), "lawsPath"),
    workdir,
    dryRun: body.dryRun === true,
    cleanupExecutionHistory: asNumber(body.cleanupExecutionHistory),
    logRun: false
  });
  await rebuildRunsIndex(workdir);
  const runId = await detectNewRunId(workdir, beforeIds);
  await writeRunSnapshotManifest({ workdir, runId, systemPath });
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
    runtimeConfigPath: resolveOptionalRuntimePathWithinProject(workdir, asString(body.runtimePath), "runtimePath"),
    userProfilePath: resolveOptionalRuntimePathWithinProject(workdir, asString(body.userProfilePath), "userProfilePath"),
    lawsPath: resolveOptionalRuntimePathWithinProject(workdir, asString(body.lawsPath), "lawsPath"),
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
  if (/ must stay within the current workdir\.$/.test(message)) {
    return new HttpError(400, "PROJECT_PATH_OUTSIDE_WORKDIR", message);
  }
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
  if (error instanceof StudioChatToMmdDependencyError) {
    return new HttpError(
      503,
      "STUDIO_CHAT_NL2MMD_UNAVAILABLE",
      message,
      error.details
    );
  }
  if (
    /^INVALID_ROLE_PACKAGE_ID$/.test(message) ||
    /^Invalid role\.json:/.test(message) ||
    /^Invalid output\.schema\.json:/.test(message) ||
    /^role\.json roleId mismatch:/.test(message) ||
    /^role\.json must keep /.test(message) ||
    /^Missing .+ content\.$/.test(message) ||
    /^ROLE_PACKAGE_REPO_OUTSIDE_WORKDIR$/.test(message) ||
    /^Invalid role config /.test(message)
  ) {
    return new HttpError(400, "ROLE_PACKAGE_INVALID", message);
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

  if (segments.length === 4 && segments[2] === "diagnostics" && segments[3] === "visualizer" && method === "GET") {
    await handleApiVisualizerDiagnostics(response);
    return;
  }
  if (segments.length === 3 && segments[2] === "workspace" && method === "GET") {
    await handleApiWorkspace(state, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "create" && method === "POST") {
    await handleApiProjectCreate(state, request, response);
    return;
  }
  const isProjectEndpoint = segments[2] === "project";
  const isProjectStudioTemplatesEndpoint =
    segments.length === 5 &&
    segments[2] === "project" &&
    segments[3] === "studio" &&
    segments[4] === "templates" &&
    method === "GET";
  const isProjectRoleCatalogEndpoint =
    segments.length === 4 &&
    segments[2] === "project" &&
    segments[3] === "role-catalog" &&
    method === "GET";
  if (
    isProjectEndpoint &&
    !isProjectStudioTemplatesEndpoint &&
    !isProjectRoleCatalogEndpoint
  ) {
    await assertInitializedProject(state.workdir);
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
    segments[4] === "chat" &&
    method === "POST"
  ) {
    await handleApiStudioChatToMmd(state, request, response);
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
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "execution-config" && method === "POST") {
    await handleApiProjectExecutionConfigUpsert(state.workdir, request, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "roles" && method === "GET") {
    await handleApiProjectRoles(state.workdir, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "role-catalog" && method === "GET") {
    await handleApiRoleCatalog(state.workdir, response);
    return;
  }
  if (segments.length === 5 && segments[2] === "project" && segments[3] === "roles" && segments[4] === "import" && method === "POST") {
    await handleApiRoleImport(state.workdir, request, response);
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
  if (
    segments.length === 5 &&
    segments[2] === "project" &&
    segments[3] === "role-packages" &&
    (method === "GET" || method === "POST")
  ) {
    await handleApiProjectRolePackageDetail(state.workdir, decodeURIComponent(segments[4] || ""), request, response);
    return;
  }
  if (segments.length === 4 && segments[2] === "project" && segments[3] === "readiness" && method === "GET") {
    await handleApiProjectReadiness(state.workdir, response);
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
    recordSseConnectionOpened(runId);

    let active = true;
    let cursor = startCursor;
    let inFlight = false;
    let closed = false;

    const pushSnapshot = async (): Promise<void> => {
      if (!active || inFlight) {
        return;
      }
      inFlight = true;
      try {
        recordSseSnapshotAttempt();
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
          recordSseWrite();
          cursor = entry.cursor + 1;
        }
      } catch {
        recordSseSnapshotError();
      } finally {
        inFlight = false;
      }
    };

    const interval = setInterval(() => {
      recordSseTick();
      void pushSnapshot();
    }, 1000);
    request.on("close", () => {
      if (closed) {
        return;
      }
      closed = true;
      active = false;
      clearInterval(interval);
      recordSseConnectionClosed(runId);
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
    workdir: resolve(args.workdir),
    projectCreateRequests: new Map(),
    projectCreateRequestCacheTtlMs: normalizePositiveInteger(
      args.projectCreateRequestCacheTtlMs,
      DEFAULT_PROJECT_CREATE_REQUEST_CACHE_TTL_MS
    ),
    projectCreateRequestCacheMaxSize: normalizePositiveInteger(
      args.projectCreateRequestCacheMaxSize,
      DEFAULT_PROJECT_CREATE_REQUEST_CACHE_MAX_SIZE
    ),
    studioChatToMmdSessions: new Map(),
    testHooks: args.testHooks
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
