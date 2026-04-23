/**
 * @fileoverview Minimal read-mostly visualization server for OGSystem runs.
 * Responsibilities:
 * - Serve run summaries, details, event snapshots, and a lightweight SSE stream.
 * - Render a single-page observability UI without a front-end build toolchain.
 * Boundaries:
 * - Read-mostly; mutations are limited to lifecycle/control-plane entrypoints.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  inspectHumanReview,
  inspectRun,
  listHumanReviews,
  loadIndexedRuns,
  loadRunLogs,
  requestStop,
  rebuildRunsIndex,
  resolveRunDir,
  writeHumanReviewDecision
} from "../runtime/project-lifecycle.js";
import { loadTimelineSnapshot, projectTimelineRecord } from "../runtime/timeline-projector.js";
import {
  inspectProjectConfigVisualization,
  inspectProjectSystemVisualization,
  inspectProjectVisualization,
  inspectRunGraphVisualization,
  inspectRunResumeDiagnostics,
  listProjectRolesVisualization
} from "./data.js";

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
  eventsCount: number;
};

type RunSnapshot = {
  runId: string;
  runDir: string;
  status: string;
  transitionCount: number;
  finalRoleId?: string;
  lastExecutedRoleId?: string;
  error?: string;
  updatedAt: string;
  activeBranches: number;
  pendingReviewCount: number;
  hasWaitingHumanReview: boolean;
  recentAudits: number;
  systemSource: string | null;
  isSimulation: boolean;
  runMode: "simulation" | "runtime";
};

const API_PREFIX = "/api/v1";

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

function buildRunSnapshot(detail: LoadedRunDetail): RunSnapshot {
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

async function loadRunDetail(workdir: string, runId: string): Promise<LoadedRunDetail> {
  const detail = (await inspectRun(workdir, runId)) as InspectRunRecord;
  const runDir = resolveRunDir(workdir, runId);
  const [systemSource, events] = await Promise.all([
    readSystemSource(runDir),
    readRunEvents(runDir)
  ]);
  return {
    ...detail,
    systemSource,
    eventsCount: events.length
  };
}

async function readRunEvents(runDir: string): Promise<NdjsonEntry[]> {
  const timelinePath = resolve(runDir, "timeline.jsonl");
  try {
    await readFile(timelinePath, "utf8");
    return (
      await loadTimelineSnapshot({
        timelinePath,
        cursor: 0,
        limit: Number.MAX_SAFE_INTEGER
      })
    ).events;
  } catch {
    // Fall back to raw events for older runs that do not have a projected timeline yet.
  }

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
  const allEvents = await readRunEvents(runDir);
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
  const runs = await loadIndexedRuns(workdir);
  jsonResponse(response, 200, { runs });
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
  const snapshot = buildRunSnapshot(detail);
  jsonResponse(response, 200, {
    ...detail,
    snapshot
  });
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
  jsonResponse(response, 200, await listHumanReviews(workdir, runId));
}

async function handleApiRunReviewDetail(
  workdir: string,
  runId: string,
  reviewId: string,
  response: ServerResponse
): Promise<void> {
  jsonResponse(response, 200, await inspectHumanReview(workdir, runId, reviewId));
}

async function handleApiRunResumeDiagnostics(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
  jsonResponse(response, 200, await inspectRunResumeDiagnostics(workdir, runId));
}

async function handleApiReindex(workdir: string, response: ServerResponse): Promise<void> {
  const index = await rebuildRunsIndex(workdir);
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
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OGSystem Visualizer</title>
  <style>
    :root {
      color-scheme: dark;
      --panel: rgba(16, 23, 44, 0.92);
      --panel-soft: rgba(23, 31, 57, 0.85);
      --border: rgba(148, 163, 184, 0.18);
      --text: #e5eefb;
      --muted: #8fa1c3;
      --accent: #38bdf8;
      --ok: #34d399;
      --warn: #fbbf24;
      --bad: #f87171;
      --shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
      --radius: 18px;
      --radius-sm: 12px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(56, 189, 248, 0.18), transparent 30%),
        radial-gradient(circle at top right, rgba(245, 158, 11, 0.15), transparent 26%),
        linear-gradient(180deg, #09101d 0%, #0b1020 42%, #08111c 100%);
      color: var(--text);
    }
    code, pre, input, button, select {
      font: inherit;
    }
    .app {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      min-height: 100vh;
    }
    .sidebar {
      padding: 20px;
      border-right: 1px solid var(--border);
      background: rgba(8, 13, 26, 0.78);
      backdrop-filter: blur(18px);
    }
    .brand {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
    }
    .brand h1 {
      margin: 0;
      font-size: 20px;
      letter-spacing: 0.02em;
    }
    .brand span {
      color: var(--muted);
      font-size: 12px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--muted);
      background: rgba(255, 255, 255, 0.03);
      font-size: 12px;
    }
    .stack {
      display: grid;
      gap: 12px;
    }
    .search, .select {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      outline: none;
    }
    .search::placeholder { color: #6d7c9b; }
    .run-list {
      display: grid;
      gap: 10px;
      max-height: calc(100vh - 180px);
      overflow: auto;
      padding-right: 4px;
    }
    .run-card {
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      cursor: pointer;
      transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
      text-align: left;
    }
    .run-card:hover,
    .run-card.active {
      transform: translateY(-1px);
      border-color: rgba(56, 189, 248, 0.42);
      background: rgba(56, 189, 248, 0.08);
    }
    .run-title, .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid transparent;
    }
    .status.running, .status.stopping { color: var(--warn); border-color: rgba(251, 191, 36, 0.22); background: rgba(251, 191, 36, 0.08); }
    .status.done, .status.simulation { color: var(--ok); border-color: rgba(52, 211, 153, 0.22); background: rgba(52, 211, 153, 0.08); }
    .status.failed { color: var(--bad); border-color: rgba(248, 113, 113, 0.22); background: rgba(248, 113, 113, 0.08); }
    .status.unknown, .status.stopped, .status.idle { color: var(--muted); border-color: rgba(148, 163, 184, 0.22); background: rgba(148, 163, 184, 0.06); }
    .status.waiting_review, .status.active { color: var(--accent); border-color: rgba(56, 189, 248, 0.22); background: rgba(56, 189, 248, 0.08); }
    .content {
      padding: 24px;
      display: grid;
      gap: 16px;
      align-content: start;
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: start;
      padding: 18px 20px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03));
      box-shadow: var(--shadow);
    }
    .hero h2 {
      margin: 4px 0 6px;
      font-size: clamp(22px, 3vw, 34px);
    }
    .hero p {
      margin: 0;
      color: var(--muted);
    }
    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .button {
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text);
      border-radius: 12px;
      padding: 10px 14px;
      cursor: pointer;
    }
    .button:hover { border-color: rgba(56, 189, 248, 0.4); }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: 13px;
    }
    .live::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--muted);
    }
    .live.online { color: var(--ok); }
    .live.online::before { background: var(--ok); }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 16px;
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .card header {
      padding: 16px 18px 0;
    }
    .card h3 {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: #c9d6ec;
    }
    .card .body {
      padding: 16px 18px 18px;
      display: grid;
      gap: 12px;
    }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
    }
    .stat {
      padding: 14px;
      border-radius: 14px;
      background: var(--panel-soft);
      border: 1px solid var(--border);
    }
    .stat strong {
      display: block;
      font-size: 22px;
      margin-bottom: 4px;
    }
    .stat span {
      color: var(--muted);
      font-size: 12px;
    }
    pre {
      margin: 0;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(4, 8, 16, 0.8);
      color: #dce7f7;
      overflow: auto;
      max-height: 520px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .timeline {
      display: grid;
      gap: 10px;
      max-height: 620px;
      overflow: auto;
      padding-right: 4px;
    }
    .event {
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.03);
      padding: 12px 14px;
      display: grid;
      gap: 6px;
    }
    .event-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
    }
    .event strong {
      font-size: 14px;
    }
    .event code {
      color: #9be7ff;
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
    }
    @media (max-width: 1180px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--border); }
      .run-list { max-height: 280px; }
      .span-4, .span-6, .span-8, .span-12 { grid-column: span 12; }
      .hero { flex-direction: column; }
      .actions { justify-content: flex-start; }
      .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <h1>OGSystem Visualizer</h1>
        <span>local</span>
      </div>
      <div class="stack">
        <div class="pill">workdir <code id="workdir">${escapeHtml(workdir)}</code></div>
        <input id="search" class="search" placeholder="Filter runs by id, status, role..." />
        <div id="run-list" class="run-list"></div>
      </div>
    </aside>
    <main class="content">
      <section class="hero">
        <div>
          <p class="hint">project + runtime observability</p>
          <h2 id="selected-title">Select a run</h2>
          <p id="selected-subtitle">Load a run to inspect project context, graph progress, review state, diagnostics, and artifacts.</p>
        </div>
        <div class="actions">
          <button id="project-home" class="button">Project</button>
          <button id="reindex" class="button">Reindex</button>
          <button id="stop-run" class="button">Stop</button>
          <button id="refresh" class="button">Refresh</button>
          <div id="live" class="live">idle</div>
        </div>
      </section>
      <section class="grid">
        <article class="card span-12">
          <header><h3>Project Overview</h3></header>
          <div class="body">
            <pre id="project-summary">Loading project...</pre>
          </div>
        </article>
        <article class="card span-12">
          <header><h3>Run Snapshot</h3></header>
          <div class="body">
            <div class="stat-grid" id="stats"></div>
          </div>
        </article>
        <article class="card span-8">
          <header><h3>Timeline</h3></header>
          <div class="body">
            <div id="timeline" class="timeline"></div>
          </div>
        </article>
        <article class="card span-4">
          <header><h3>Graph View</h3></header>
          <div class="body">
            <div id="graph-view" class="timeline"><div class="hint">No run selected.</div></div>
            <pre id="state">No run selected.</pre>
          </div>
        </article>
        <article class="card span-6">
          <header><h3>Reviews</h3></header>
          <div class="body">
            <div id="reviews" class="timeline"><div class="hint">No run selected.</div></div>
            <div id="review-actions" class="actions"></div>
            <pre id="review-detail">No review selected.</pre>
          </div>
        </article>
        <article class="card span-6">
          <header><h3>Resume Diagnostics</h3></header>
          <div class="body">
            <div id="resume-diagnostics" class="timeline"><div class="hint">No run selected.</div></div>
          </div>
        </article>
        <article class="card span-12">
          <header>
            <div class="row">
              <h3>Logs</h3>
              <select id="log-role" class="select">
                <option value="">Latest role</option>
              </select>
              <input id="log-tail" class="select" type="number" min="1" placeholder="tail" />
              <input id="log-since" class="select" type="datetime-local" />
            </div>
          </header>
          <div class="body">
            <div id="logs-filters" class="hint"></div>
            <pre id="logs">No run selected.</pre>
          </div>
        </article>
        <article class="card span-12">
          <header><h3>Artifacts</h3></header>
          <div class="body">
            <pre id="detail">No run selected.</pre>
          </div>
        </article>
      </section>
    </main>
  </div>
  <script>
    const API_PREFIX = ${JSON.stringify(API_PREFIX)};
    const state = {
      project: null,
      runs: [],
      filter: "",
      projectHome: false,
      selectedRunId: "",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logSince: "",
      eventCursor: 0,
      events: [],
      detail: null,
      graph: null,
      reviews: null,
      reviewDetail: null,
      resumeDiagnostics: null,
      engineLogs: [],
      roleLogs: [],
      stream: null,
      refreshTimer: null,
      listTimer: null
    };

    const runListEl = document.getElementById("run-list");
    const searchEl = document.getElementById("search");
    const selectedTitleEl = document.getElementById("selected-title");
    const selectedSubtitleEl = document.getElementById("selected-subtitle");
    const projectSummaryEl = document.getElementById("project-summary");
    const statsEl = document.getElementById("stats");
    const timelineEl = document.getElementById("timeline");
    const graphViewEl = document.getElementById("graph-view");
    const stateEl = document.getElementById("state");
    const reviewsEl = document.getElementById("reviews");
    const reviewActionsEl = document.getElementById("review-actions");
    const reviewDetailEl = document.getElementById("review-detail");
    const resumeEl = document.getElementById("resume-diagnostics");
    const logsFiltersEl = document.getElementById("logs-filters");
    const logsEl = document.getElementById("logs");
    const detailEl = document.getElementById("detail");
    const liveEl = document.getElementById("live");
    const logRoleEl = document.getElementById("log-role");
    const logTailEl = document.getElementById("log-tail");
    const logSinceEl = document.getElementById("log-since");

    function escapeText(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTime(value) {
      if (!value) return "n/a";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function formatJson(value) {
      return JSON.stringify(value ?? null, null, 2);
    }

    function statusClass(status) {
      return ["running", "stopping", "stopped", "done", "failed", "waiting_review", "active", "idle", "simulation"].includes(status)
        ? status
        : "unknown";
    }

    async function requestJson(path, options) {
      const response = await fetch(path, {
        headers: { accept: "application/json" },
        cache: "no-store",
        ...(options || {})
      });
      if (!response.ok) {
        throw new Error(\`\${response.status} \${response.statusText}\`);
      }
      return response.json();
    }

    async function requestAction(path, body) {
      return requestJson(path, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(body || {})
      });
    }

    function readRouteFromLocation() {
      const params = new URLSearchParams(window.location.search);
      return {
        view: params.get("view") || "",
        runId: params.get("runId") || "",
        reviewId: params.get("reviewId") || "",
        logRoleId: params.get("logRoleId") || "",
        tail: params.get("tail") || "",
        since: params.get("since") || ""
      };
    }

    function writeRouteToLocation() {
      const params = new URLSearchParams();
      if (state.projectHome && !state.selectedRunId) {
        params.set("view", "project");
      }
      if (state.selectedRunId) {
        params.set("runId", state.selectedRunId);
      }
      if (state.selectedReviewId) {
        params.set("reviewId", state.selectedReviewId);
      }
      if (state.selectedLogRoleId) {
        params.set("logRoleId", state.selectedLogRoleId);
      }
      if (state.logTail) {
        params.set("tail", state.logTail);
      }
      if (state.logSince) {
        params.set("since", state.logSince);
      }
      const query = params.toString();
      window.history.replaceState(null, "", query ? "?" + query : window.location.pathname);
    }

    function buildLogsQuery(runId, extra) {
      const params = new URLSearchParams();
      if (extra.engine) {
        params.set("engine", "true");
      }
      if (extra.roleId) {
        params.set("roleId", extra.roleId);
      }
      if (state.logTail) {
        params.set("tail", state.logTail);
      }
      if (state.logSince) {
        const normalized = state.logSince.includes(":") && state.logSince.length === 16
          ? new Date(state.logSince).toISOString()
          : state.logSince;
        params.set("since", normalized);
      }
      return API_PREFIX + "/runs/" + encodeURIComponent(runId) + "/logs?" + params.toString();
    }

    function setLive(mode, label) {
      liveEl.className = "live" + (mode === "online" ? " online" : "");
      liveEl.textContent = label;
    }

    function renderProject() {
      if (!state.project) {
        projectSummaryEl.textContent = "Project data unavailable.";
        return;
      }
      const summary = state.project.summary?.project ?? {};
      const roles = state.project.roles?.roles ?? [];
      projectSummaryEl.textContent = [
        "projectName: " + (summary.projectName ?? "n/a"),
        "projectId: " + (summary.projectId ?? "n/a"),
        "systemId: " + (summary.systemId ?? "n/a"),
        "systemVersion: " + (summary.systemVersion ?? "n/a"),
        "entryRoleId: " + (summary.entryRoleId ?? "n/a"),
        "roleCount: " + (summary.roleCount ?? 0),
        "flowCount: " + (summary.flowCount ?? 0),
        "runsDir: " + (summary.runsDir ?? "n/a"),
        "reviewedRoleIds: " + ((summary.reviewedRoleIds ?? []).join(", ") || "none"),
        "joinRoleIds: " + ((summary.joinRoleIds ?? []).join(", ") || "none"),
        "loopRoleIds: " + ((summary.loopRoleIds ?? []).join(", ") || "none"),
        "contextMappedRoleIds: " + ((summary.contextMappedRoleIds ?? []).join(", ") || "none"),
        "",
        "roles:",
        ...roles.map((role) => "- " + role.roleId + " [binding=" + (role.binding?.bindingKind || "n/a") + " review=" + (role.review ? "yes" : "no") + " join=" + (role.join ? "yes" : "no") + " loop=" + (role.loop ? "yes" : "no") + "]"),
        "",
        "modelSelectionWarnings:",
        ...((state.project.config?.modelSelectionWarnings ?? []).length
          ? state.project.config.modelSelectionWarnings.map((warning) => "- " + warning)
          : ["- none"]),
        "",
        "system.mmd:",
        state.project.system?.systemSource ?? "n/a"
      ].join("\n");
    }

    function renderRuns() {
      const term = state.filter.trim().toLowerCase();
      const runs = state.runs.filter((run) => {
        if (!term) return true;
        return [run.runId, run.status, run.finalRoleId, run.lastExecutedRoleId]
          .filter(Boolean)
          .some((item) => String(item).toLowerCase().includes(term));
      });
      if (!runs.length) {
        runListEl.innerHTML = '<div class="hint">No runs match the filter.</div>';
        return;
      }
      runListEl.innerHTML = runs
        .map((run) => \`
          <button class="run-card \${run.runId === state.selectedRunId ? "active" : ""}" data-run-id="\${escapeText(run.runId)}">
            <div class="run-title">
              <span>\${escapeText(run.runId)}</span>
              <span class="status \${statusClass(run.status)}">\${escapeText(run.status)}</span>
            </div>
            <div class="meta">
              <span>transitions \${escapeText(run.transitionCount)}</span>
              <span>updated \${escapeText(formatTime(run.updatedAt))}</span>
            </div>
          </button>
        \`)
        .join("");
      for (const button of runListEl.querySelectorAll("[data-run-id]")) {
        button.addEventListener("click", () => selectRun(button.getAttribute("data-run-id")));
      }
    }

    function renderStats(snapshot, graphPayload) {
      if (!snapshot) {
        statsEl.innerHTML = "";
        return;
      }
      const cards = [
        ["status", snapshot.status],
        ["mode", graphPayload?.simulation?.mode || snapshot.runMode || "runtime"],
        ["transitions", snapshot.transitionCount],
        ["active branches", snapshot.activeBranches],
        ["pending reviews", snapshot.pendingReviewCount],
        ["recent audits", snapshot.recentAudits]
      ];
      statsEl.innerHTML = cards
        .map(([label, value]) => \`
          <div class="stat">
            <strong>\${escapeText(value)}</strong>
            <span>\${escapeText(label)}</span>
          </div>
        \`)
        .join("");
    }

    function renderTimeline(events) {
      if (!events.length) {
        timelineEl.innerHTML = '<div class="hint">No events captured yet.</div>';
        return;
      }
      timelineEl.innerHTML = events
        .slice()
        .reverse()
        .map((entry) => {
          const record = entry.record || {};
          const type = record.type || "event";
          const role = record.roleId ? \`<code>\${escapeText(record.roleId)}</code>\` : "";
          const branch = record.branchId ? \`<code>\${escapeText(record.branchId)}</code>\` : "";
          const review = record.reviewId ? \`<code>\${escapeText(record.reviewId)}</code>\` : "";
          const event = record.event ? \`<code>\${escapeText(record.event)}</code>\` : "";
          const status = record.status ? \`<span class="status \${statusClass(record.status)}">\${escapeText(record.status)}</span>\` : "";
          return \`
            <div class="event">
              <div class="event-top">
                <span>#\${escapeText(entry.cursor)} \${escapeText(type)}</span>
                <span>\${escapeText(record.at || "")}</span>
              </div>
              <strong>\${role} \${event} \${status}</strong>
              <div class="hint">\${branch} \${review}</div>
            </div>
          \`;
        })
        .join("");
    }

    function renderGraph() {
      if (!state.graph) {
        graphViewEl.innerHTML = '<div class="hint">No run selected.</div>';
        stateEl.textContent = "No run selected.";
        return;
      }
      const graph = state.graph.graph;
      if (!graph) {
        graphViewEl.innerHTML = '<div class="hint">Graph projection unavailable.</div>';
        stateEl.textContent = formatJson(state.detail?.state ?? null);
        return;
      }
      const nodes = graph.nodes || [];
      const edges = (graph.edges || []).filter((edge) => edge.recentlyActivated || edge.isErrorFlow);
      graphViewEl.innerHTML = [
        '<div class="event"><strong>' + escapeText(graph.systemId || "unknown") + '</strong><div class="hint">entry ' + escapeText(graph.entryRoleId || "n/a") + " · roles " + escapeText(graph.roleCount || 0) + " · flows " + escapeText(graph.flowCount || 0) + "</div></div>",
        ...nodes.map((node) =>
          '<div class="event">' +
            '<div class="event-top">' +
              '<span><code>' + escapeText(node.roleId) + "</code> · " + escapeText(node.nodeType) + "</span>" +
              '<span class="status ' + statusClass(node.status) + '">' + escapeText(node.status) + "</span>" +
            "</div>" +
            "<strong>binding=" + escapeText(node.bindingKind) + " · active=" + escapeText(node.activeBranchCount) + " · waitingReview=" + escapeText(node.waitingReviewCount) + " · loop=" + escapeText(node.loopIteration) + "</strong>" +
            '<div class="hint">' + escapeText(node.lastErrorCode || "no error") + (node.missingSources?.length ? " · missing join sources " + escapeText(node.missingSources.join(", ")) : "") + "</div>" +
          "</div>"
        ),
        ...(edges.length > 0
          ? edges.map((edge) =>
              '<div class="event">' +
                '<div class="event-top">' +
                  '<span><code>' + escapeText(edge.sourceRoleId) + "</code> -> <code>" + escapeText(edge.targetRoleId) + "</code></span>" +
                  "<span>" + (edge.recentlyActivated ? "recent" : edge.isErrorFlow ? "error-flow" : "") + "</span>" +
                "</div>" +
                "<strong>" + escapeText(edge.event) + "</strong>" +
              "</div>"
            )
          : ['<div class="hint">No activated or error-flow edges in the current snapshot.</div>'])
      ].join("");
      stateEl.textContent = formatJson(state.detail?.state ?? null);
    }

    function renderReviews() {
      if (!state.reviews?.reviews?.length) {
        reviewsEl.innerHTML = '<div class="hint">No reviews for this run.</div>';
        reviewActionsEl.innerHTML = "";
        reviewDetailEl.textContent = "No review selected.";
        return;
      }
      reviewsEl.innerHTML = state.reviews.reviews
        .map((review) =>
          '<button class="run-card ' + (review.reviewId === state.selectedReviewId ? "active" : "") + '" data-review-id="' + escapeText(review.reviewId) + '">' +
            '<div class="run-title">' +
              "<span><code>" + escapeText(review.reviewId) + "</code></span>" +
              '<span class="status ' + statusClass(review.currentStatus || "unknown") + '">' + escapeText(review.currentStatus || "unknown") + "</span>" +
            "</div>" +
            '<div class="meta">' +
              "<span>" + escapeText(review.roleId || "n/a") + "</span>" +
              "<span>" + escapeText(review.branchStatus || "n/a") + "</span>" +
            "</div>" +
          "</button>"
        )
        .join("");
      for (const button of reviewsEl.querySelectorAll("[data-review-id]")) {
        button.addEventListener("click", () => selectReview(state.selectedRunId, button.getAttribute("data-review-id")));
      }
      const detail = state.reviewDetail;
      reviewDetailEl.textContent = detail
        ? formatJson({
            reviewId: detail.reviewId,
            roleId: detail.roleId,
            branchId: detail.branchId,
            round: detail.round,
            currentStatus: detail.currentStatus,
            decision: detail.decision,
            comment: detail.comment,
            history: detail.history,
            humanReviewContext: detail.humanReviewContext
          })
        : "No review selected.";
      const actionable = detail && (detail.currentStatus === "pending" || detail.currentStatus === "paused");
      reviewActionsEl.innerHTML = actionable
        ? [
          '<button class="button" data-review-action="approve">Approve</button>',
          '<button class="button" data-review-action="rework">Rework</button>',
          '<button class="button" data-review-action="pause">Pause</button>',
          '<button class="button" data-review-action="terminate" data-review-scope="' + escapeText(detail.scope || "branch") + '">Terminate</button>'
          ].join("")
        : "";
      for (const button of reviewActionsEl.querySelectorAll("[data-review-action]")) {
        button.addEventListener("click", () =>
          submitReviewDecision(button.getAttribute("data-review-action"), button.getAttribute("data-review-scope"))
        );
      }
    }

    function renderResumeDiagnostics() {
      if (!state.resumeDiagnostics) {
        resumeEl.innerHTML = '<div class="hint">No run selected.</div>';
        return;
      }
      const checks = state.resumeDiagnostics.checks || [];
      const recommendations = state.resumeDiagnostics.recommendations || [];
      resumeEl.innerHTML = [
        '<div class="event"><div class="event-top"><span>resume status</span><span class="status ' + statusClass(state.resumeDiagnostics.status) + '">' + escapeText(state.resumeDiagnostics.status) + "</span></div><strong>" + escapeText(state.resumeDiagnostics.fingerprint?.mismatch ? "fingerprint mismatch" : "authority set inspected") + "</strong></div>",
        ...checks.map((check) =>
          '<div class="event">' +
            '<div class="event-top">' +
              "<span>" + escapeText(check.label) + "</span>" +
              '<span class="status ' + statusClass(check.ok ? "done" : check.severity === "warning" ? "waiting_review" : "failed") + '">' + escapeText(check.severity) + "</span>" +
            "</div>" +
            "<strong>" + escapeText(check.ok ? "ok" : "attention") + "</strong>" +
            '<div class="hint">' + escapeText(check.message || "") + "</div>" +
          "</div>"
        ),
        ...(recommendations.length > 0
          ? recommendations.map((recommendation) =>
              '<div class="event">' +
                '<div class="event-top"><span>next action</span><span>' + escapeText(recommendation.action) + "</span></div>" +
                "<strong>" + escapeText(recommendation.label) + "</strong>" +
              "</div>"
            )
          : ['<div class="hint">No additional recovery recommendations.</div>'])
      ].join("");
    }

    function renderLogs() {
      logsFiltersEl.textContent = "role=" + (state.selectedLogRoleId || "latest") + " tail=" + (state.logTail || "all") + " since=" + (state.logSince || "n/a");
      logsEl.textContent = formatJson({
        selectedRoleId: state.selectedLogRoleId || null,
        engine: state.engineLogs,
        role: state.roleLogs
      });
    }

    function renderDetail() {
      detailEl.textContent = formatJson({
        detail: state.detail,
        graph: state.graph,
        reviews: state.reviews,
        resumeDiagnostics: state.resumeDiagnostics
      });
    }

    function renderSelectedRun() {
      const detail = state.detail;
      const snapshot = detail?.snapshot || null;
      const graphPayload = state.graph;
      if (!detail || !snapshot || state.projectHome) {
        selectedTitleEl.textContent = "Project Overview";
        selectedSubtitleEl.textContent = "Use query-state deep links or the run list to switch between project, run, and review details.";
      } else {
        const simulation = graphPayload?.simulation?.isSimulation ? "simulation" : "runtime";
        selectedTitleEl.textContent = graphPayload?.simulation?.isSimulation ? \`\${detail.runId} [simulation]\` : detail.runId;
        selectedSubtitleEl.textContent = state.selectedReviewId
          ? \`\${detail.runDir} · \${simulation} · review \${state.selectedReviewId}\`
          : \`\${detail.runDir} · \${simulation}\`;
      }
      renderStats(snapshot, graphPayload);
      renderTimeline(state.events);
      renderGraph();
      renderReviews();
      renderResumeDiagnostics();
      renderLogs();
      renderDetail();
    }

    function stopStream() {
      if (state.stream) {
        state.stream.close();
        state.stream = null;
      }
    }

    function scheduleRefresh() {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = setTimeout(() => {
        if (state.selectedRunId) {
          loadSelectedRun(state.selectedRunId, { keepStream: true });
        }
      }, 250);
    }

    function populateLogRoleOptions(graphPayload, fallbackRoleId) {
      const roleIds = (graphPayload?.graph?.nodes || []).map((node) => node.roleId).filter(Boolean);
      const selected = state.selectedLogRoleId || fallbackRoleId || "";
      const options = ['<option value="">Latest role</option>']
        .concat(roleIds.map((roleId) => \`<option value="\${escapeText(roleId)}" \${roleId === selected ? "selected" : ""}>\${escapeText(roleId)}</option>\`));
      logRoleEl.innerHTML = options.join("");
      state.selectedLogRoleId = selected;
    }

    async function loadProject() {
      const [summary, system, config, roles] = await Promise.all([
        requestJson(\`\${API_PREFIX}/project\`),
        requestJson(\`\${API_PREFIX}/project/system\`),
        requestJson(\`\${API_PREFIX}/project/config\`),
        requestJson(\`\${API_PREFIX}/project/roles\`)
      ]);
      state.project = { summary, system, config, roles };
      renderProject();
    }

    async function loadRuns() {
      const payload = await requestJson(\`\${API_PREFIX}/runs\`);
      state.runs = payload.runs || [];
      renderRuns();
      if (!state.projectHome && !state.selectedRunId && state.runs.length) {
        await selectRun(state.runs[0].runId);
      }
      if (!state.runs.length) {
        setLive("idle", "no runs");
      }
    }

    async function loadRoleLogs(runId, roleId) {
      if (!roleId) {
        state.roleLogs = [];
        renderLogs();
        return;
      }
      const roleLogsPayload = await requestJson(buildLogsQuery(runId, { roleId }));
      state.roleLogs = roleLogsPayload.records || [];
      renderLogs();
    }

    async function loadEngineLogs(runId) {
      const engineLogsPayload = await requestJson(buildLogsQuery(runId, { engine: true }));
      state.engineLogs = engineLogsPayload.records || [];
      renderLogs();
    }

    async function loadSelectedRun(runId, options) {
      const [
        detail,
        eventsPayload,
        graphPayload,
        reviewsPayload,
        resumePayload
      ] = await Promise.all([
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/events?cursor=0&limit=250\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/graph\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews\`),
        requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/resume-diagnostics\`)
      ]);

      state.detail = detail;
      state.events = eventsPayload.events || [];
      state.eventCursor = eventsPayload.nextCursor || 0;
      state.graph = graphPayload;
      state.reviews = reviewsPayload;
      state.resumeDiagnostics = resumePayload;
      const fallbackRoleId = detail.snapshot?.lastExecutedRoleId || detail.snapshot?.finalRoleId || "";
      if (!state.selectedReviewId) {
        state.selectedReviewId = reviewsPayload.latestPendingReviewId || "";
      }
      state.reviewDetail = state.selectedReviewId
        ? await requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews/\${encodeURIComponent(state.selectedReviewId)}\`).catch(() => null)
        : null;
      populateLogRoleOptions(graphPayload, fallbackRoleId);
      await Promise.all([
        loadEngineLogs(runId),
        loadRoleLogs(runId, state.selectedLogRoleId || fallbackRoleId)
      ]);
      renderSelectedRun();
      renderRuns();
      writeRouteToLocation();

      if (!options || !options.keepStream) {
        stopStream();
        connectStream(runId, state.eventCursor);
      }
      const status = (detail.snapshot && detail.snapshot.status) || "unknown";
      const hasWaitingHumanReview = Boolean(detail.snapshot && detail.snapshot.hasWaitingHumanReview);
      if (hasWaitingHumanReview) {
        setLive("idle", "waiting_review");
      } else {
        setLive(status === "running" || status === "stopping" ? "online" : "idle", status);
      }
    }

    async function selectRun(runId) {
      if (!runId) return;
      state.projectHome = false;
      state.selectedRunId = runId;
      state.selectedReviewId = "";
      renderRuns();
      await loadSelectedRun(runId, { keepStream: false });
    }

    function selectProjectHome() {
      stopStream();
      state.projectHome = true;
      state.selectedRunId = "";
      state.selectedReviewId = "";
      state.detail = null;
      state.graph = null;
      state.reviews = null;
      state.reviewDetail = null;
      state.resumeDiagnostics = null;
      state.events = [];
      state.engineLogs = [];
      state.roleLogs = [];
      renderSelectedRun();
      renderRuns();
      writeRouteToLocation();
      setLive("idle", "project");
    }

    async function selectReview(runId, reviewId) {
      if (!runId || !reviewId) {
        return;
      }
      if (state.selectedRunId !== runId) {
        state.selectedRunId = runId;
      }
      state.projectHome = false;
      state.selectedReviewId = reviewId;
      state.reviewDetail = await requestJson(
        \`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/reviews/\${encodeURIComponent(reviewId)}\`
      );
      renderSelectedRun();
      writeRouteToLocation();
    }

    async function submitReviewDecision(decision, scope) {
      if (!state.selectedRunId || !state.selectedReviewId) {
        return;
      }
      await requestAction(
        \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/reviews/\${encodeURIComponent(state.selectedReviewId)}/decide\`,
        {
          decision,
          scope: decision === "terminate" ? scope : undefined,
          actor: "visualizer",
          comment: \`recorded via visualizer (\${decision})\`
        }
      );
      await loadSelectedRun(state.selectedRunId, { keepStream: true });
    }

    async function submitStopRequest() {
      if (!state.selectedRunId) {
        return;
      }
      await requestAction(
        \`\${API_PREFIX}/runs/\${encodeURIComponent(state.selectedRunId)}/stop\`,
        { reason: "requested via visualizer" }
      );
      await loadSelectedRun(state.selectedRunId, { keepStream: true });
    }

    function connectStream(runId, cursor) {
      stopStream();
      const stream = new EventSource(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/stream?cursor=\${cursor}\`);
      state.stream = stream;
      stream.onopen = () => setLive("online", "live");
      stream.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          if (payload && payload.record) {
            state.eventCursor = payload.cursor + 1;
            state.events.push(payload);
            renderTimeline(state.events);
            scheduleRefresh();
          }
        } catch {
          // Ignore malformed stream payloads.
        }
      };
      stream.onerror = () => {
        setLive("idle", "stream reconnecting");
      };
    }

    document.getElementById("project-home").addEventListener("click", () => {
      selectProjectHome();
    });

    document.getElementById("reindex").addEventListener("click", async () => {
      await requestAction(\`\${API_PREFIX}/runs/reindex\`);
      await loadRuns();
    });

    document.getElementById("stop-run").addEventListener("click", async () => {
      await submitStopRequest();
    });

    document.getElementById("refresh").addEventListener("click", async () => {
      await loadProject();
      await loadRuns();
      if (state.selectedRunId) {
        await loadSelectedRun(state.selectedRunId, { keepStream: false });
      } else {
        renderSelectedRun();
      }
    });

    logRoleEl.addEventListener("change", async (event) => {
      state.selectedLogRoleId = event.target.value || "";
      if (state.selectedRunId) {
        await Promise.all([
          loadEngineLogs(state.selectedRunId),
          loadRoleLogs(state.selectedRunId, state.selectedLogRoleId || state.detail?.snapshot?.lastExecutedRoleId || "")
        ]);
        writeRouteToLocation();
      }
    });

    logTailEl.addEventListener("change", async (event) => {
      state.logTail = event.target.value || "";
      if (state.selectedRunId) {
        await Promise.all([
          loadEngineLogs(state.selectedRunId),
          loadRoleLogs(state.selectedRunId, state.selectedLogRoleId || state.detail?.snapshot?.lastExecutedRoleId || "")
        ]);
      }
      writeRouteToLocation();
    });

    logSinceEl.addEventListener("change", async (event) => {
      state.logSince = event.target.value || "";
      if (state.selectedRunId) {
        await Promise.all([
          loadEngineLogs(state.selectedRunId),
          loadRoleLogs(state.selectedRunId, state.selectedLogRoleId || state.detail?.snapshot?.lastExecutedRoleId || "")
        ]);
      }
      writeRouteToLocation();
    });

    searchEl.addEventListener("input", (event) => {
      state.filter = event.target.value || "";
      renderRuns();
    });

    const initialRoute = readRouteFromLocation();
    state.projectHome = initialRoute.view === "project";
    state.selectedRunId = initialRoute.runId;
    state.selectedReviewId = initialRoute.reviewId;
    state.selectedLogRoleId = initialRoute.logRoleId;
    state.logTail = initialRoute.tail;
    state.logSince = initialRoute.since;
    logTailEl.value = state.logTail;
    logSinceEl.value = state.logSince;

    Promise.all([loadProject(), loadRuns()])
      .then(async () => {
        if (state.selectedRunId) {
          await loadSelectedRun(state.selectedRunId, { keepStream: false });
        } else {
          renderSelectedRun();
        }
      })
      .catch((error) => {
        runListEl.innerHTML = \`<div class="hint">Failed to load visualizer data: \${escapeText(error.message || error)}</div>\`;
        projectSummaryEl.textContent = \`Failed to load project: \${error.message || error}\`;
        setLive("idle", "offline");
      });

    state.listTimer = setInterval(() => {
      loadRuns().catch(() => {
        // keep the page usable even if a refresh fails
      });
    }, 15000);
  </script>
</body>
</html>`;
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
    const runDir = resolveRunDir(args.workdir, runId);
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
        const events = await readRunEvents(runDir);
        while (cursor < events.length && active) {
          const entry = events[cursor];
          response.write(`id: ${cursor}\n`);
          response.write(`event: event\n`);
          response.write(`data: ${JSON.stringify(entry)}\n\n`);
          cursor += 1;
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
