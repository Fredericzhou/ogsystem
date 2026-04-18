/**
 * @fileoverview Read-only visualization server for OGSystem.
 * Responsibilities:
 * - Serve run observability data from local run artifacts.
 * - Expose command registry and command graph metadata as read-only APIs.
 * - Provide a thin NL2MMD preview endpoint without writing runtime files.
 * Boundaries:
 * - Node HTTP only, no frontend framework, no database.
 * - Never mutates run artifacts or writes files.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createNl2MmdConversation,
  loadNl2MmdContext,
  runNl2MmdPreflight,
  runNl2MmdTurn,
  validateNl2MmdCandidate
} from "../nl2mmd/index.js";
import { inspectRun, loadIndexedRuns, loadRunLogs } from "../runtime/project-lifecycle.js";
import { loadTimelineSnapshot, projectTimelineRecord } from "../runtime/timeline-projector.js";
import {
  buildVisualizerCommandGraphLiveUrl,
  getVisualizerCommandGraph,
  getVisualizerCommandGroups,
  getVisualizerCommandRegistry,
  getVisualizerCommands
} from "./command-graph.js";

type VisualizationPreviewRequest = Record<string, unknown> & {
  message?: string;
  draftMermaid?: string;
  modelId?: string;
  runtimeConfigPath?: string;
  lawsPath?: string;
  profilesPath?: string;
  userProfilePath?: string;
  validateOnly?: boolean;
  preflight?: boolean;
};

type VisualizationPreviewHandlerArgs = {
  workdir: string;
  request: VisualizationPreviewRequest;
  rawBody: string;
  url: URL;
};

export type VisualizationPreviewHandler =
  | ((args: VisualizationPreviewHandlerArgs) => Promise<unknown> | unknown)
  | undefined;

type VisualizationServerOptions = {
  workdir: string;
  host: string;
  port: number;
  previewHandler?: VisualizationPreviewHandler;
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
  durationMs?: number;
  lastRoleId?: string;
  lastErrorCode?: string;
  finalRoleId?: string;
  error?: string;
  updatedAt: string;
  activeBranches: number;
  recentAudits: number;
  systemSource: string | null;
};

const API_PREFIX = "/api/v1";
const REQUEST_BODY_LIMIT = 1_000_000;

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

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, '\\"');
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > REQUEST_BODY_LIMIT) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonRequestBody<T extends Record<string, unknown>>(
  request: IncomingMessage
): Promise<{ rawBody: string; body: T }> {
  const rawBody = await readRequestBody(request);
  if (!rawBody.trim()) {
    return { rawBody, body: {} as T };
  }
  const parsed: unknown = JSON.parse(rawBody);
  if (!asRecord(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return { rawBody, body: parsed as T };
}

function extractGraphState(state: unknown): Record<string, unknown> | undefined {
  const record = asRecord(state);
  if (!record) {
    return undefined;
  }
  const nested = asRecord(record.graphState);
  return nested ?? record;
}

function countActiveBranches(graphState: Record<string, unknown> | undefined): number {
  const branchRecords = asRecord(graphState?.branchRecords);
  if (!branchRecords) {
    return 0;
  }
  return Object.values(branchRecords).filter((value) => {
    const record = asRecord(value);
    return asString(record?.status) === "active";
  }).length;
}

function countRecentAudits(graphState: Record<string, unknown> | undefined): number {
  return Array.isArray(graphState?.recentAudits) ? graphState!.recentAudits.length : 0;
}

function buildRunSnapshot(detail: LoadedRunDetail): RunSnapshot {
  const state = extractGraphState(detail.state);
  const summary = asRecord(detail.summary);
  const stateRecord = asRecord(detail.state);
  const status =
    asString(summary?.status) ??
    asString(state?.status) ??
    asString(stateRecord?.status) ??
    "unknown";
  const transitionCount =
    asNumber(summary?.transitionCount) ??
    asNumber(state?.transitionCount) ??
    asNumber(stateRecord?.transitionCount) ??
    0;
  const finalRoleId =
    asString(summary?.finalRoleId) ??
    asString(state?.finalRoleId) ??
    asString(stateRecord?.finalRoleId);
  const lastRoleId =
    asString(summary?.lastRoleId) ??
    asString(state?.lastExecutedRoleId) ??
    asString(stateRecord?.lastExecutedRoleId);
  const lastErrorCode =
    asString(summary?.lastErrorCode) ??
    asString(state?.lastErrorCode) ??
    asString(stateRecord?.lastErrorCode);
  const error = asString(state?.error) ?? asString(stateRecord?.error);

  return {
    runId: detail.runId,
    runDir: detail.runDir,
    status,
    transitionCount,
    durationMs: asNumber(summary?.durationMs),
    lastRoleId,
    lastErrorCode,
    finalRoleId,
    error,
    updatedAt:
      asString(summary?.updatedAt) ??
      asString(asRecord(detail.resolvedConfig)?.updatedAt) ??
      "",
    activeBranches: countActiveBranches(state),
    recentAudits: countRecentAudits(state),
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
    // Fall back to raw events for older runs.
  }

  const eventsPath = resolve(runDir, "events.ndjson");
  let content: string;
  try {
    content = await readFile(eventsPath, "utf8");
  } catch {
    return [];
  }

  const entries: NdjsonEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const record = asRecord(parsed);
      if (!record) {
        continue;
      }
      const projected = projectTimelineRecord({
        cursor: entries.length,
        event: record
      });
      if (!projected) {
        continue;
      }
      entries.push({
        cursor: projected.cursor,
        record: projected
      });
    } catch {
      continue;
    }
  }
  return entries;
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
  const allEvents = await readRunEvents(detail.runDir);
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
  jsonResponse(response, 200, { runs: await loadIndexedRuns(workdir) });
}

async function handleApiRunsReindex(workdir: string, response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, {
    status: "read-only",
    runs: await loadIndexedRuns(workdir)
  });
}

async function handleApiRunDetail(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
  const detail = await loadRunDetail(workdir, runId);
  jsonResponse(response, 200, {
    ...detail,
    snapshot: buildRunSnapshot(detail)
  });
}

async function handleApiRunState(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
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
  const roleId = url.searchParams.get("roleId") ?? url.searchParams.get("role") ?? undefined;
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
  const roleId = url.searchParams.get("roleId") ?? url.searchParams.get("role") ?? undefined;
  const engine = asBoolean(url.searchParams.get("engine"));
  const tailParam = url.searchParams.get("tail");
  const tailValue = tailParam !== null ? Number(tailParam) : undefined;
  const since = url.searchParams.get("since") ?? undefined;
  const records = await loadRunLogs({
    workdir,
    runId,
    roleId,
    engine,
    tail: tailValue !== undefined && Number.isFinite(tailValue) ? tailValue : undefined,
    since
  });
  jsonResponse(response, 200, { records });
}

function buildCommandsEndpointGraph(): {
  direction: "TD";
  mermaid: string;
  liveUrl: string;
  text: string;
  nodes: Array<{ id: string; label: string; summary: string; parentId?: string }>;
} {
  const groups = getVisualizerCommandGroups();
  const commands = getVisualizerCommands();
  const lines = ["flowchart TD"];
  const nodes = [
    ...groups.map((group) => ({
      id: group.id,
      label: group.label,
      summary: group.summary
    })),
    ...commands.map((command) => ({
      id: command.id,
      label: command.command,
      summary: command.summary,
      parentId: command.groupId
    }))
  ];

  for (const group of groups) {
    lines.push(`  ${group.id.replace(/[^A-Za-z0-9_]/g, "_")}["${escapeMermaidLabel(group.label)}"]`);
  }
  for (const command of commands) {
    lines.push(
      `  ${command.id.replace(/[^A-Za-z0-9_]/g, "_")}["${escapeMermaidLabel(command.command)}"]`
    );
  }
  for (const command of commands) {
    lines.push(
      `  ${command.groupId.replace(/[^A-Za-z0-9_]/g, "_")} --> ${command.id.replace(/[^A-Za-z0-9_]/g, "_")}`
    );
  }

  const mermaid = lines.join("\n");
  return {
    direction: "TD",
    mermaid,
    liveUrl: buildVisualizerCommandGraphLiveUrl(mermaid),
    text: commands
      .map((command) => `${command.command} | ${command.summary} | group=${command.groupId}`)
      .join("\n"),
    nodes
  };
}

function buildCommandRegistryPathGraph(): {
  direction: "TD";
  mermaid: string;
  liveUrl: string;
  text: string;
  nodes: Array<{ id: string; label: string; summary: string; parentId?: string }>;
} {
  const source = getVisualizerCommandGraph();
  const nodes = source.nodes.map((node) => ({
    id: node.id,
    label: node.id,
    summary: node.summary,
    parentId: node.parentId
  }));
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    lines.push(`  ${node.id.replace(/[^A-Za-z0-9_]/g, "_")}["${escapeMermaidLabel(node.label)}"]`);
  }
  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }
    lines.push(
      `  ${node.parentId.replace(/[^A-Za-z0-9_]/g, "_")} --> ${node.id.replace(/[^A-Za-z0-9_]/g, "_")}`
    );
  }
  const mermaid = lines.join("\n");
  return {
    direction: "TD",
    mermaid,
    liveUrl: buildVisualizerCommandGraphLiveUrl(mermaid),
    text: nodes
      .map((node) => `${node.id} | ${node.summary}${node.parentId ? ` | parent=${node.parentId}` : ""}`)
      .join("\n"),
    nodes
  };
}

async function handleApiRunGraph(
  workdir: string,
  runId: string,
  response: ServerResponse
): Promise<void> {
  const detail = await loadRunDetail(workdir, runId);
  jsonResponse(response, 200, {
    runId: detail.runId,
    systemSource: detail.systemSource,
    state: detail.state ?? null,
    snapshot: buildRunSnapshot(detail)
  });
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

async function handleApiCommands(response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, {
    groups: getVisualizerCommandGroups(),
    commands: getVisualizerCommands(),
    registry: getVisualizerCommandRegistry(),
    graph: buildCommandsEndpointGraph(),
    registryGraph: getVisualizerCommandGraph()
  });
}

async function handleApiCommandGraph(response: ServerResponse): Promise<void> {
  jsonResponse(response, 200, buildCommandRegistryPathGraph());
}

function buildPreviewContextSummary(context: {
  workdir: string;
  roleCatalog?: unknown[];
  modelCatalog?: unknown[];
  lawIds?: unknown[];
}): Record<string, unknown> {
  return {
    workdir: context.workdir,
    roleCount: context.roleCatalog?.length ?? 0,
    modelCount: context.modelCatalog?.length ?? 0,
    lawCount: context.lawIds?.length ?? 0
  };
}

async function defaultPreviewHandler(args: VisualizationPreviewHandlerArgs): Promise<unknown> {
  const context = await loadNl2MmdContext({
    workdir: args.workdir,
    runtimeConfigPath: asString(args.request.runtimeConfigPath),
    lawsPath: asString(args.request.lawsPath)
  });
  const message = asString(args.request.message);
  const draftMermaid = asString(args.request.draftMermaid) ?? "";
  const validateOnly = asBoolean(args.request.validateOnly);
  const preflight = asBoolean(args.request.preflight);
  const modelId = asString(args.request.modelId) ?? "fast-gpt54";

  if (!message && !draftMermaid.trim()) {
    throw new Error("Preview request requires message or draftMermaid");
  }

  if (validateOnly || !message) {
    if (!draftMermaid.trim()) {
      throw new Error("Preview validation requires draftMermaid");
    }
    const validation = await validateNl2MmdCandidate({
      mermaid: draftMermaid,
      context,
      lawsPath: asString(args.request.lawsPath),
      profilesPath: asString(args.request.profilesPath),
      userProfilePath: asString(args.request.userProfilePath)
    });
    return {
      mode: "validate",
      workdir: args.workdir,
      context: buildPreviewContextSummary(context),
      draftMermaid,
      txtGraph: validation.txtGraph,
      validation
    };
  }

  const conversation = await createNl2MmdConversation({
    workdir: args.workdir,
    modelId,
    runtimeConfigPath: asString(args.request.runtimeConfigPath),
    lawsPath: asString(args.request.lawsPath),
    context
  });

  try {
    if (preflight) {
      await runNl2MmdPreflight({ conversation });
    }
    const turn = await runNl2MmdTurn({
      conversation,
      input: {
        message,
        draftMermaid,
        validationErrors: asStringArray(args.request.validationErrors),
        validationWarnings: asStringArray(args.request.validationWarnings)
      },
      lawsPath: asString(args.request.lawsPath),
      profilesPath: asString(args.request.profilesPath),
      userProfilePath: asString(args.request.userProfilePath)
    });
    return {
      mode: "turn",
      workdir: args.workdir,
      context: buildPreviewContextSummary(context),
      turn
    };
  } finally {
    conversation.close();
  }
}

async function handleApiNl2MmdPreview(
  request: IncomingMessage,
  response: ServerResponse,
  args: VisualizationServerOptions,
  url: URL
): Promise<void> {
  if ((request.method?.toUpperCase() ?? "GET") !== "POST") {
    textResponse(response, 405, "Method Not Allowed");
    return;
  }
  const { rawBody, body } = await readJsonRequestBody<VisualizationPreviewRequest>(request);
  const handler = args.previewHandler ?? defaultPreviewHandler;
  const payload = await handler({
    workdir: args.workdir,
    request: body,
    rawBody,
    url
  });
  jsonResponse(response, 200, payload);
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
      --bg: #0a1020;
      --panel: rgba(15, 20, 35, 0.92);
      --panel-soft: rgba(21, 28, 49, 0.86);
      --border: rgba(148, 163, 184, 0.2);
      --text: #e6eefb;
      --muted: #90a2c4;
      --accent: #4fc3f7;
      --ok: #34d399;
      --warn: #fbbf24;
      --bad: #f87171;
      --radius: 16px;
      --shadow: 0 24px 72px rgba(0, 0, 0, 0.3);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(79, 195, 247, 0.16), transparent 32%),
        radial-gradient(circle at top right, rgba(251, 191, 36, 0.14), transparent 24%),
        linear-gradient(180deg, #07101c 0%, #0a1020 45%, #08101a 100%);
    }
    code, pre, input, textarea, button { font: inherit; }
    .app {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      min-height: 100vh;
    }
    .sidebar {
      padding: 20px;
      background: rgba(7, 12, 23, 0.8);
      border-right: 1px solid var(--border);
      backdrop-filter: blur(18px);
    }
    .brand {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 18px;
    }
    .brand h1 {
      margin: 0;
      font-size: 20px;
      letter-spacing: 0.02em;
    }
    .brand span, .hint, .meta, .subtle {
      color: var(--muted);
      font-size: 12px;
    }
    .stack {
      display: grid;
      gap: 12px;
    }
    .pill {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.03);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .search, .field, textarea {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      outline: none;
    }
    .search, .field {
      padding: 12px 14px;
    }
    textarea {
      min-height: 128px;
      padding: 12px 14px;
      resize: vertical;
    }
    .search::placeholder, .field::placeholder, textarea::placeholder {
      color: #6980a8;
    }
    .run-list {
      display: grid;
      gap: 10px;
      max-height: calc(100vh - 180px);
      overflow: auto;
      padding-right: 4px;
    }
    .run-card {
      width: 100%;
      text-align: left;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      cursor: pointer;
    }
    .run-card.active {
      border-color: rgba(79, 195, 247, 0.5);
      background: rgba(79, 195, 247, 0.08);
    }
    .run-title, .event-top, .actions {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
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
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03));
      box-shadow: var(--shadow);
    }
    .hero h2 {
      margin: 4px 0 6px;
      font-size: clamp(22px, 3vw, 34px);
    }
    .hero p { margin: 0; color: var(--muted); }
    .button {
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text);
      border-radius: 12px;
      padding: 10px 14px;
      cursor: pointer;
    }
    .button:hover { border-color: rgba(79, 195, 247, 0.4); }
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
    .card header { padding: 16px 18px 0; }
    .card h3 {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: #c8d7ed;
    }
    .card .body {
      padding: 16px 18px 18px;
      display: grid;
      gap: 12px;
    }
    .span-5 { grid-column: span 5; }
    .span-6 { grid-column: span 6; }
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
    pre {
      margin: 0;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(4, 8, 16, 0.8);
      color: #dce7f7;
      overflow: auto;
      max-height: 480px;
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
    .command-list {
      display: grid;
      gap: 10px;
    }
    .command-group {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.03);
      padding: 12px 14px;
    }
    .command-group h4 {
      margin: 0 0 8px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #ced9eb;
    }
    .command-chip {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-top: 1px solid rgba(148, 163, 184, 0.14);
    }
    .command-chip:first-of-type { border-top: 0; padding-top: 0; }
    .command-chip code { color: #9be7ff; }
    .form-grid {
      display: grid;
      gap: 12px;
    }
    .form-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .form-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    @media (max-width: 1180px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--border); }
      .run-list { max-height: 280px; }
      .span-5, .span-6, .span-7, .span-12 { grid-column: span 12; }
      .hero { flex-direction: column; }
      .actions { justify-content: flex-start; }
      .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .form-row { grid-template-columns: 1fr; }
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
        <article class="card span-6">
          <header><h3>Commands</h3></header>
          <div class="body">
            <div id="commands" class="command-list"></div>
            <pre id="commands-graph">Loading command graph...</pre>
          </div>
        </article>
        <article class="card span-6">
          <header><h3>Compose</h3></header>
          <div class="body">
            <form id="compose-form" class="form-grid">
              <div class="form-row">
                <input id="compose-model" class="field" value="fast-gpt54" placeholder="model id" />
                <label class="pill"><input id="compose-preflight" type="checkbox" /> run preflight</label>
              </div>
              <textarea id="compose-message" placeholder="Describe the flow you want visualized."></textarea>
              <textarea id="compose-draft" placeholder="Optional draft Mermaid to validate or refine."></textarea>
              <div class="form-actions">
                <button class="button" type="submit">Preview</button>
                <span class="subtle">Read-only preview only. No files are written.</span>
              </div>
            </form>
            <pre id="compose-output">No preview yet.</pre>
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
      commands: null,
      refreshTimer: null
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
    const commandsEl = document.getElementById("commands");
    const commandsGraphEl = document.getElementById("commands-graph");
    const composeFormEl = document.getElementById("compose-form");
    const composeMessageEl = document.getElementById("compose-message");
    const composeDraftEl = document.getElementById("compose-draft");
    const composeModelEl = document.getElementById("compose-model");
    const composePreflightEl = document.getElementById("compose-preflight");
    const composeOutputEl = document.getElementById("compose-output");

    function escapeText(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatJson(value) {
      return JSON.stringify(value ?? null, null, 2);
    }

    function formatTime(value) {
      if (!value) return "n/a";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function statusClass(status) {
      return ["running", "stopping", "stopped", "done", "failed"].includes(status)
        ? status
        : "unknown";
    }

    function requestJson(path, options) {
      return fetch(path, {
        headers: { accept: "application/json" },
        cache: "no-store",
        ...(options || {})
      }).then(function(response) {
        if (!response.ok) {
          throw new Error(response.status + " " + response.statusText);
        }
        return response.json();
      });
    }

    function setLive(mode, label) {
      liveEl.className = "live" + (mode === "online" ? " online" : "");
      liveEl.textContent = label;
    }

    function runCardHtml(run) {
      return (
        '<button class="run-card ' +
        (run.runId === state.selectedRunId ? "active" : "") +
        '" data-run-id="' +
        escapeText(run.runId) +
        '">' +
        '<div class="run-title">' +
        "<span>" +
        escapeText(run.runId) +
        "</span>" +
        '<span class="status ' +
        statusClass(run.status) +
        '">' +
        escapeText(run.status) +
        "</span>" +
        "</div>" +
        '<div class="meta">' +
        "<span>transitions " +
        escapeText(run.transitionCount) +
        "</span>" +
        "<span>updated " +
        escapeText(formatTime(run.updatedAt)) +
        "</span>" +
        "</div>" +
        "</button>"
      );
    }

    function renderRuns() {
      const term = state.filter.trim().toLowerCase();
      const runs = state.runs.filter(function(run) {
        if (!term) return true;
        return [run.runId, run.status, run.finalRoleId, run.lastRoleId]
          .filter(Boolean)
          .some(function(item) {
            return String(item).toLowerCase().includes(term);
          });
      });
      if (!runs.length) {
        runListEl.innerHTML = '<div class="hint">No runs match the filter.</div>';
        return;
      }
      runListEl.innerHTML = runs.map(runCardHtml).join("");
      for (const button of runListEl.querySelectorAll("[data-run-id]")) {
        button.addEventListener("click", function() {
          selectRun(button.getAttribute("data-run-id"));
        });
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
        .map(function(item) {
          const label = item[0];
          const value = item[1];
          return (
            '<div class="stat">' +
            "<strong>" +
            escapeText(value) +
            "</strong>" +
            "<span>" +
            escapeText(label) +
            "</span>" +
            "</div>"
          );
        })
        .join("");
    }

    function timelineEventHtml(entry) {
      const record = entry.record || {};
      const type = record.type || "event";
      const role = record.roleId ? "<code>" + escapeText(record.roleId) + "</code>" : "";
      const branch = record.branchId ? "<code>" + escapeText(record.branchId) + "</code>" : "";
      const event = record.event ? "<code>" + escapeText(record.event) + "</code>" : "";
      const status = record.status
        ? '<span class="status ' +
          statusClass(record.status) +
          '">' +
          escapeText(record.status) +
          "</span>"
        : "";
      return (
        '<div class="event">' +
        '<div class="event-top">' +
        "<span>#" +
        escapeText(entry.cursor) +
        " " +
        escapeText(type) +
        "</span>" +
        "<span>" +
        escapeText(record.at || "") +
        "</span>" +
        "</div>" +
        "<strong>" +
        role +
        " " +
        event +
        " " +
        status +
        "</strong>" +
        '<div class="hint">' +
        branch +
        "</div>" +
        "</div>"
      );
    }

    function renderTimeline(events) {
      if (!events.length) {
        timelineEl.innerHTML = '<div class="hint">No events captured yet.</div>';
        return;
      }
      timelineEl.innerHTML = events.slice().reverse().map(timelineEventHtml).join("");
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
      window.clearTimeout(state.refreshTimer);
      state.refreshTimer = window.setTimeout(function() {
        if (state.selectedRunId) {
          loadSelectedRun(state.selectedRunId, { keepStream: true });
        }
      }, 250);
    }

    function loadRuns() {
      return requestJson(API_PREFIX + "/runs").then(function(payload) {
        state.runs = payload.runs || [];
        renderRuns();
        if (!state.selectedRunId && state.runs.length) {
          return selectRun(state.runs[0].runId);
        }
        if (!state.runs.length) {
          setLive("idle", "no runs");
        }
      });
    }

    function loadSelectedRun(runId, options) {
      return requestJson(API_PREFIX + "/runs/" + encodeURIComponent(runId))
        .then(function(detail) {
          return requestJson(
            API_PREFIX + "/runs/" + encodeURIComponent(runId) + "/events?cursor=0&limit=250"
          ).then(function(eventsPayload) {
            return { detail: detail, eventsPayload: eventsPayload };
          });
        })
        .then(function(result) {
          const detail = result.detail;
          const eventsPayload = result.eventsPayload;
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
        });
    }

    function selectRun(runId) {
      if (!runId) return Promise.resolve();
      state.selectedRunId = runId;
      renderRuns();
      return loadSelectedRun(runId, { keepStream: false });
    }

    function connectStream(runId, cursor) {
      stopStream();
      const stream = new EventSource(
        API_PREFIX + "/runs/" + encodeURIComponent(runId) + "/stream?cursor=" + cursor
      );
      state.stream = stream;
      stream.onopen = function() {
        setLive("online", "live");
      };
      stream.onmessage = function(message) {
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
      stream.onerror = function() {
        setLive("idle", "stream reconnecting");
      };
    }

    function renderCommands(payload) {
      const groups = payload.groups || [];
      const commands = payload.commands || [];
      const commandsByGroup = new Map(groups.map(function(group) {
        return [group.id, []];
      }));
      for (const command of commands) {
        if (!commandsByGroup.has(command.groupId)) {
          commandsByGroup.set(command.groupId, []);
        }
        commandsByGroup.get(command.groupId).push(command);
      }
      commandsEl.innerHTML = groups
        .map(function(group) {
          const items = commandsByGroup.get(group.id) || [];
          return (
            '<section class="command-group">' +
            "<h4>" +
            escapeText(group.label) +
            "</h4>" +
            '<div class="subtle">' +
            escapeText(group.summary) +
            "</div>" +
            items
              .map(function(command) {
                return (
                  '<div class="command-chip">' +
                  "<div>" +
                  "<code>" +
                  escapeText(command.command) +
                  "</code>" +
                  '<div class="subtle">' +
                  escapeText(command.summary) +
                  "</div>" +
                  "</div>" +
                  "</div>"
                );
              })
              .join("") +
            "</section>"
          );
        })
        .join("");
      commandsGraphEl.textContent =
        (payload.graph && payload.graph.mermaid) || "No command graph available.";
    }

    function loadCommands() {
      return requestJson(API_PREFIX + "/commands").then(function(payload) {
        state.commands = payload;
        renderCommands(payload);
      });
    }

    function submitPreview(event) {
      event.preventDefault();
      composeOutputEl.textContent = "Loading preview...";
      const body = {
        modelId: composeModelEl.value.trim() || "fast-gpt54",
        message: composeMessageEl.value,
        draftMermaid: composeDraftEl.value,
        preflight: composePreflightEl.checked
      };
      return fetch(API_PREFIX + "/nl2mmd/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(body)
      }).then(function(response) {
        if (!response.ok) {
          throw new Error(response.status + " " + response.statusText);
        }
        return response.json();
      }).then(function(payload) {
        composeOutputEl.textContent = formatJson(payload);
      });
    }

    document.getElementById("refresh").addEventListener("click", function() {
      return loadRuns()
        .then(function() {
          return loadCommands();
        })
        .then(function() {
          if (state.selectedRunId) {
            return loadSelectedRun(state.selectedRunId, { keepStream: false });
          }
        });
    });

    searchEl.addEventListener("input", function(event) {
      state.filter = event.target.value || "";
      renderRuns();
    });

    composeFormEl.addEventListener("submit", function(event) {
      submitPreview(event).catch(function(error) {
        composeOutputEl.textContent = "Preview failed: " + (error.message || error);
      });
    });

    Promise.all([loadRuns(), loadCommands()]).catch(function(error) {
      runListEl.innerHTML =
        '<div class="hint">Failed to load data: ' +
        escapeText(error.message || error) +
        "</div>";
      setLive("idle", "offline");
      commandsEl.innerHTML = '<div class="hint">Command data unavailable.</div>';
      commandsGraphEl.textContent = "Command graph unavailable.";
    });
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
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? `${args.host}:${args.port}`}`
  );
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

  if (
    segments.length === 4 &&
    segments[2] === "runs" &&
    segments[3] === "reindex" &&
    (method === "GET" || method === "POST")
  ) {
    await handleApiRunsReindex(args.workdir, response);
    return;
  }

  if (segments.length === 3 && segments[2] === "commands" && method === "GET") {
    await handleApiCommands(response);
    return;
  }

  if (segments.length === 4 && segments[2] === "commands" && segments[3] === "graph" && method === "GET") {
    await handleApiCommandGraph(response);
    return;
  }

  if (segments.length === 4 && segments[2] === "nl2mmd" && segments[3] === "preview") {
    await handleApiNl2MmdPreview(request, response, args, url);
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
        const events = await readRunEvents(detail.runDir);
        while (cursor < events.length && active) {
          const entry = events[cursor];
          response.write(`id: ${cursor}\n`);
          response.write("event: event\n");
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
  if (segments.length === 5 && segments[4] === "stop") {
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
  const port = typeof address === "object" && address && "port" in address ? address.port : args.port;
  return {
    server,
    url: `http://${args.host}:${port}`,
    port
  };
}
