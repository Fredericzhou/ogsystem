/**
 * @fileoverview Minimal read-only visualization server for OGSystem runs.
 * Responsibilities:
 * - Serve run summaries, details, event snapshots, and a lightweight SSE stream.
 * - Render a single-page observability UI without a front-end build toolchain.
 * Boundaries:
 * - Read-only; never mutates runtime artifacts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  inspectRun,
  loadIndexedRuns,
  loadRunLogs,
  rebuildRunsIndex
} from "../runtime/project-lifecycle.js";
import { loadTimelineSnapshot, projectTimelineRecord } from "../runtime/timeline-projector.js";

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
  recentAudits: number;
  systemSource: string | null;
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
    recentAudits: getAuditCount(state),
    systemSource: detail.systemSource
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
  const runDir = detail.runDir;
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
}): Promise<{ events: NdjsonEntry[]; nextCursor: number }> {
  const detail = (await inspectRun(args.workdir, args.runId)) as { runDir: string };
  const runDir = detail.runDir;
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
  const snapshot = await loadRunEventsSnapshot({
    workdir,
    runId,
    cursor: Number.isFinite(cursor) ? cursor : 0,
    limit: Number.isFinite(limit) ? limit : 500,
    roleId,
    branchId,
    type
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
  const records = await loadRunLogs({
    workdir,
    runId,
    roleId,
    engine
  });
  jsonResponse(response, 200, { records });
}

async function handleApiRunGraph(workdir: string, runId: string, response: ServerResponse): Promise<void> {
  const detail = await loadRunDetail(workdir, runId);
  jsonResponse(response, 200, {
    runId: detail.runId,
    systemSource: detail.systemSource,
    state: detail.state ?? null,
    snapshot: buildRunSnapshot(detail)
  });
}

async function handleApiReindex(workdir: string, response: ServerResponse): Promise<void> {
  const index = await rebuildRunsIndex(workdir);
  jsonResponse(response, 200, index);
}

async function handleApiStop(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
  jsonResponse(response, 200, {
    status: "unsupported",
    runId,
    workdir,
    message: "Stop requests are intentionally handled by the runtime CLI, not the visualizer."
  });
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
      --bg: #0b1020;
      --panel: rgba(16, 23, 44, 0.92);
      --panel-soft: rgba(23, 31, 57, 0.85);
      --border: rgba(148, 163, 184, 0.18);
      --text: #e5eefb;
      --muted: #8fa1c3;
      --accent: #38bdf8;
      --accent-2: #f59e0b;
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
    code, pre, input, button {
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
    .search {
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
    }
    .run-card:hover,
    .run-card.active {
      transform: translateY(-1px);
      border-color: rgba(56, 189, 248, 0.42);
      background: rgba(56, 189, 248, 0.08);
    }
    .run-title {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      font-weight: 600;
      margin-bottom: 6px;
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
    .status.done { color: var(--ok); border-color: rgba(52, 211, 153, 0.22); background: rgba(52, 211, 153, 0.08); }
    .status.failed { color: var(--bad); border-color: rgba(248, 113, 113, 0.22); background: rgba(248, 113, 113, 0.08); }
    .status.unknown, .status.stopped { color: var(--muted); border-color: rgba(148, 163, 184, 0.22); background: rgba(148, 163, 184, 0.06); }
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
    .span-5 { grid-column: span 5; }
    .span-7 { grid-column: span 7; }
    .span-12 { grid-column: span 12; }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
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
      .span-5, .span-7, .span-12 { grid-column: span 12; }
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
          <p class="hint">runtime observability</p>
          <h2 id="selected-title">Select a run</h2>
          <p id="selected-subtitle">Load a run to inspect progress, audit trail, and artifacts.</p>
        </div>
        <div class="actions">
          <button id="refresh" class="button">Refresh</button>
          <div id="live" class="live">idle</div>
        </div>
      </section>
      <section class="grid">
        <article class="card span-12">
          <header><h3>Run Snapshot</h3></header>
          <div class="body">
            <div class="stat-grid" id="stats"></div>
          </div>
        </article>
        <article class="card span-7">
          <header><h3>Timeline</h3></header>
          <div class="body">
            <div id="timeline" class="timeline"></div>
          </div>
        </article>
        <article class="card span-5">
          <header><h3>Graph / State</h3></header>
          <div class="body">
            <pre id="graph">No run selected.</pre>
            <pre id="state">No run selected.</pre>
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
      runs: [],
      filter: "",
      selectedRunId: "",
      eventCursor: 0,
      events: [],
      detail: null,
      stream: null,
      refreshTimer: null,
      listTimer: null
    };

    const runListEl = document.getElementById("run-list");
    const searchEl = document.getElementById("search");
    const selectedTitleEl = document.getElementById("selected-title");
    const selectedSubtitleEl = document.getElementById("selected-subtitle");
    const statsEl = document.getElementById("stats");
    const timelineEl = document.getElementById("timeline");
    const graphEl = document.getElementById("graph");
    const stateEl = document.getElementById("state");
    const detailEl = document.getElementById("detail");
    const liveEl = document.getElementById("live");

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
      return ["running", "stopping", "stopped", "done", "failed"].includes(status)
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

    function setLive(mode, label) {
      liveEl.className = "live" + (mode === "online" ? " online" : "");
      liveEl.textContent = label;
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

    function renderStats(snapshot) {
      if (!snapshot) {
        statsEl.innerHTML = "";
        return;
      }
      const cards = [
        ["status", snapshot.status],
        ["transitions", snapshot.transitionCount],
        ["active branches", snapshot.activeBranches],
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
          const event = record.event ? \`<code>\${escapeText(record.event)}</code>\` : "";
          const status = record.status ? \`<span class="status \${statusClass(record.status)}">\${escapeText(record.status)}</span>\` : "";
          return \`
            <div class="event">
              <div class="event-top">
                <span>#\${escapeText(entry.cursor)} \${escapeText(type)}</span>
                <span>\${escapeText(record.at || "")}</span>
              </div>
              <strong>\${role} \${event} \${status}</strong>
              <div class="hint">\${branch}</div>
            </div>
          \`;
        })
        .join("");
    }

    function renderDetail(detail, snapshot, events) {
      selectedTitleEl.textContent = detail.runId;
      selectedSubtitleEl.textContent = detail.runDir;
      renderStats(snapshot);
      renderTimeline(events);
      graphEl.textContent = detail.systemSource || "No system.mmd found in run directory.";
      stateEl.textContent = formatJson(detail.state);
      detailEl.textContent = formatJson({
        runId: detail.runId,
        runDir: detail.runDir,
        metrics: detail.metrics,
        resolvedConfig: detail.resolvedConfig,
        stopRequest: detail.stopRequest,
        stopOutcome: detail.stopOutcome
      });
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

    async function loadRuns() {
      const payload = await requestJson(\`\${API_PREFIX}/runs\`);
      state.runs = payload.runs || [];
      renderRuns();
      if (!state.selectedRunId && state.runs.length) {
        await selectRun(state.runs[0].runId);
      }
      if (!state.runs.length) {
        setLive("idle", "no runs");
      }
    }

    async function loadSelectedRun(runId, options) {
      const detail = await requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}\`);
      const eventsPayload = await requestJson(\`\${API_PREFIX}/runs/\${encodeURIComponent(runId)}/events?cursor=0&limit=250\`);
      state.detail = detail;
      state.events = eventsPayload.events || [];
      state.eventCursor = eventsPayload.nextCursor || 0;
      renderDetail(detail, detail.snapshot || null, state.events);
      renderRuns();
      if (!options || !options.keepStream) {
        stopStream();
        connectStream(runId, state.eventCursor);
      }
      const status = (detail.snapshot && detail.snapshot.status) || "unknown";
      setLive(status === "running" || status === "stopping" ? "online" : "idle", status);
    }

    async function selectRun(runId) {
      if (!runId) return;
      state.selectedRunId = runId;
      renderRuns();
      await loadSelectedRun(runId, { keepStream: false });
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

    document.getElementById("refresh").addEventListener("click", async () => {
      await loadRuns();
      if (state.selectedRunId) {
        await loadSelectedRun(state.selectedRunId, { keepStream: false });
      }
    });

    searchEl.addEventListener("input", (event) => {
      state.filter = event.target.value || "";
      renderRuns();
    });

    loadRuns().catch((error) => {
      runListEl.innerHTML = \`<div class="hint">Failed to load runs: \${escapeText(error.message || error)}</div>\`;
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
  const segments = pathname.split("/").filter(Boolean);

  if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    textResponse(response, 200, renderPageHtml(args.workdir), "text/html; charset=utf-8");
    return;
  }

  if (segments[0] !== "api" || segments[1] !== "v1") {
    textResponse(response, 404, "Not found");
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
  if (segments.length === 5 && segments[4] === "stream" && method === "GET") {
    const detail = (await inspectRun(args.workdir, runId)) as { runDir: string };
    const runDir = detail.runDir;
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
    await handleApiStop(args.workdir, runId, response);
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

  await new Promise<void>((resolvePromise) => {
    server.listen(args.port, args.host, () => resolvePromise());
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
