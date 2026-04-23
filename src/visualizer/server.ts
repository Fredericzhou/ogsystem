/**
 * @fileoverview Minimal read-mostly visualization server for OGSystem runs.
 * Responsibilities:
 * - Serve run summaries, details, event snapshots, and a lightweight SSE stream.
 * - Render a single-page observability UI without a front-end build toolchain.
 * Boundaries:
 * - Read-mostly; mutations are limited to lifecycle/control-plane entrypoints.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  inspectHumanReview,
  inspectRun,
  listHumanReviews,
  loadPersistedRunsIndex,
  loadIndexedRuns,
  loadRunLogs,
  requestStop,
  rebuildRunsIndex,
  resolveRunDir,
  writeHumanReviewDecision
} from "../runtime/project-lifecycle.js";
import {
  loadTimelineTailSnapshot,
  projectTimelineRecord
} from "../runtime/timeline-projector.js";
import {
  inspectRunResumeDiagnostics,
} from "./data.js";
import {
  inspectProjectConfigVisualization,
  inspectProjectSystemVisualization,
  inspectProjectVisualization,
  listProjectRolesVisualization
} from "./project-projection.js";
import { inspectRunGraphVisualization } from "./run-graph-projection.js";
import {
  mapResumeDiagnosticsView,
  mapReviewDetailView,
  mapReviewListItem,
  mapRunDetailView,
  type RunHeader
} from "./dto.js";
import { renderPageHtml as renderVisualizerPageHtml } from "./page-shell.js";

type VisualizationServerOptions = {
  workdir: string;
  host: string;
  port: number;
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

const API_PREFIX = "/api/v1";
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isSimulationRun(resolvedConfig: unknown): boolean {
  const record =
    typeof resolvedConfig === "object" && resolvedConfig !== null && !Array.isArray(resolvedConfig)
      ? (resolvedConfig as Record<string, unknown>)
      : undefined;
  const effective =
    typeof record?.effective === "object" &&
    record.effective !== null &&
    !Array.isArray(record.effective)
      ? (record.effective as Record<string, unknown>)
      : undefined;
  const invocation =
    typeof effective?.invocation === "object" &&
    effective.invocation !== null &&
    !Array.isArray(effective.invocation)
      ? (effective.invocation as Record<string, unknown>)
      : undefined;
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

async function handleApiProjectConfig(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await inspectProjectConfigVisualization(workdir));
}

async function handleApiProjectRoles(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, await listProjectRolesVisualization(workdir));
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
  const reviews = Array.isArray(record.reviews)
    ? record.reviews.map((review) => mapReviewListItem(review)).filter(Boolean)
    : [];
  jsonResponse(response, 200, {
    runId,
    runDir: asString(record.runDir) ?? resolveRunDir(workdir, runId),
    latestPendingReviewId: asString(record.latestPendingReviewId),
    reviews
  });
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
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object request body.");
  }
  return parsed as Record<string, unknown>;
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
    throw new Error("Expected decision to be one of: approve, rework, pause, terminate.");
  }
  const scopeValue = asString(body.scope);
  jsonResponse(
    response,
    200,
    await writeHumanReviewDecision({
      workdir,
      runId,
      reviewId,
      decision,
      comment: asString(body.comment),
      actor: asString(body.actor),
      scope: scopeValue === "branch" || scopeValue === "run" ? scopeValue : undefined
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
  jsonResponse(response, 200, await requestStop(workdir, runId, asString(body.reason)));
}

function renderPageHtml(workdir: string): string {
  return renderVisualizerPageHtml(workdir, API_PREFIX);
}

async function handleVisualizationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  args: VisualizationServerOptions
): Promise<void> {
  const method = request.method?.toUpperCase() ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${args.host}:${args.port}`}`);
  const pathname = url.pathname;
  let segments: string[];
  try {
    segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    textResponse(response, 400, "Invalid path encoding");
    return;
  }

  if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    textResponse(response, 200, renderPageHtml(args.workdir), "text/html; charset=utf-8");
    return;
  }

  if (segments[0] !== "api" || segments[1] !== "v1") {
    textResponse(response, 404, "Not found");
    return;
  }

  if (segments.length === 3 && segments[2] === "project" && method === "GET") {
    await handleApiProjectSummary(args.workdir, response);
    return;
  }

  if (segments.length === 4 && segments[2] === "project" && segments[3] === "system" && method === "GET") {
    await handleApiProjectSystem(args.workdir, response);
    return;
  }

  if (segments.length === 4 && segments[2] === "project" && segments[3] === "config" && method === "GET") {
    await handleApiProjectConfig(args.workdir, response);
    return;
  }

  if (segments.length === 4 && segments[2] === "project" && segments[3] === "roles" && method === "GET") {
    await handleApiProjectRoles(args.workdir, response);
    return;
  }

  if (segments.length === 3 && segments[2] === "runs" && method === "GET") {
    await handleApiRunsList(args.workdir, response);
    return;
  }

  if (segments.length >= 3 && segments[2] === "runs" && segments[3] === "reindex" && method === "POST") {
    await handleApiReindex(args.workdir, response);
    return;
  }

  if (segments.length < 4 || segments[2] !== "runs") {
    textResponse(response, 404, "Not found");
    return;
  }

  const runId = segments[3];

  if (segments.length === 4 && method === "GET") {
    await handleApiRunDetail(args.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "state" && method === "GET") {
    await handleApiRunState(args.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "events" && method === "GET") {
    await handleApiRunEvents(args.workdir, runId, url, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "logs" && method === "GET") {
    await handleApiRunLogs(args.workdir, runId, url, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "graph" && method === "GET") {
    await handleApiRunGraph(args.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "reviews" && method === "GET") {
    await handleApiRunReviews(args.workdir, runId, response);
    return;
  }
  if (segments.length === 5 && segments[4] === "resume-diagnostics" && method === "GET") {
    await handleApiRunResumeDiagnostics(args.workdir, runId, response);
    return;
  }
  if (segments.length === 7 && segments[4] === "reviews" && segments[6] === "decide" && method === "POST") {
    await handleApiRunReviewDecision(args.workdir, runId, segments[5], request, response);
    return;
  }
  if (segments.length === 6 && segments[4] === "reviews" && method === "GET") {
    await handleApiRunReviewDetail(args.workdir, runId, segments[5], response);
    return;
  }
  if (segments.length === 5 && segments[4] === "stream" && method === "GET") {
    const startCursor = Math.max(0, Number(url.searchParams.get("cursor") ?? "0") || 0);
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    response.write(`retry: 2000\n`);

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
          workdir: args.workdir,
          runId,
          cursor,
          limit: 500
        });
        for (const entry of snapshot.events) {
          if (!active) {
            break;
          }
          response.write(`id: ${cursor}\n`);
          response.write(`event: event\n`);
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
    await handleApiStop(args.workdir, runId, request, response);
    return;
  }

  textResponse(response, 404, "Not found");
}

export async function startVisualizationServer(args: VisualizationServerOptions): Promise<{
  server: ReturnType<typeof createServer>;
  url: string;
  port: number;
}> {
  const server = createServer((request, response) => {
    void handleVisualizationRequest(request, response, args).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      textResponse(response, 500, message);
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
