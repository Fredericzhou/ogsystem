import { buildClientAppScript } from "./client-app.js";
import { createTranslator, getDictionary, type Dictionary, type Locale } from "./i18n/index.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type PageI18nOptions = {
  locale?: Locale;
  messages?: Dictionary;
};

export function renderPageHtml(workdir: string, apiPrefix: string, i18n: PageI18nOptions = {}): string {
  const locale = i18n.locale ?? "en";
  const messages = i18n.messages ?? getDictionary(locale);
  const t = createTranslator(locale);
  const clientScript = buildClientAppScript(apiPrefix, { locale, messages });
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(t("app.title"))}</title>
  <style>
    :root {
      color-scheme: dark;
      --panel: rgba(16, 23, 44, 0.92);
      --panel-soft: rgba(23, 31, 57, 0.85);
      --panel-deep: rgba(7, 12, 24, 0.92);
      --border: rgba(148, 163, 184, 0.18);
      --text: #e5eefb;
      --muted: #8fa1c3;
      --accent: #38bdf8;
      --accent-soft: rgba(56, 189, 248, 0.12);
      --ok: #34d399;
      --warn: #fbbf24;
      --bad: #f87171;
      --shadow: 0 14px 44px rgba(0, 0, 0, 0.26);
      --radius: 12px;
      --radius-sm: 8px;
      font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
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
    textarea {
      font: 500 14px/1.6 "IBM Plex Mono", "SFMono-Regular", ui-monospace, monospace;
    }
    .app {
      display: grid;
      grid-template-columns: 288px minmax(0, 1fr);
      min-height: 100vh;
    }
    .sidebar-overlay {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.62);
      opacity: 0;
      pointer-events: none;
      transition: opacity 160ms ease;
      z-index: 20;
    }
    body.drawer-open .sidebar-overlay {
      opacity: 1;
      pointer-events: auto;
    }
    .sidebar {
      padding: 14px;
      border-right: 1px solid var(--border);
      background: rgba(8, 13, 26, 0.78);
      backdrop-filter: blur(18px);
      min-width: 0;
      overflow-x: hidden;
      overflow-y: auto;
      z-index: 30;
    }
    .brand {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .brand h1 {
      margin: 0;
      font-size: 17px;
      letter-spacing: 0.02em;
    }
    .brand span {
      color: var(--muted);
      font-size: 12px;
    }
    .pill {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 5px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--muted);
      background: rgba(255, 255, 255, 0.03);
      font-size: 12px;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
    }
    .pill code {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pill.warn {
      color: var(--warn);
      background: rgba(251, 191, 36, 0.08);
      border-color: rgba(251, 191, 36, 0.24);
    }
    .stack {
      display: grid;
      gap: 8px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow: hidden;
    }
    .search, .select {
      width: 100%;
      min-width: 0;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      outline: none;
    }
    .search::placeholder { color: #6d7c9b; }
    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .run-list {
      display: grid;
      gap: 8px;
      max-height: calc(100vh - 136px);
      overflow: auto;
      padding-right: 4px;
      min-width: 0;
    }
    .run-card {
      width: 100%;
      min-width: 0;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      cursor: pointer;
      transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
      text-align: left;
      overflow: hidden;
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
      flex-wrap: wrap;
      min-width: 0;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid transparent;
    }
    .status.running, .status.stopping { color: var(--warn); border-color: rgba(251, 191, 36, 0.22); background: rgba(251, 191, 36, 0.08); }
    .status.done, .status.simulation, .status.completed { color: var(--ok); border-color: rgba(52, 211, 153, 0.22); background: rgba(52, 211, 153, 0.08); }
    .status.failed { color: var(--bad); border-color: rgba(248, 113, 113, 0.22); background: rgba(248, 113, 113, 0.08); }
    .status.unknown, .status.stopped, .status.idle { color: var(--muted); border-color: rgba(148, 163, 184, 0.22); background: rgba(148, 163, 184, 0.06); }
    .status.waiting_review, .status.active { color: var(--accent); border-color: rgba(56, 189, 248, 0.22); background: rgba(56, 189, 248, 0.08); }
    .status.pending, .status.paused, .status.recorded, .status.pending_reconcile { color: var(--warn); border-color: rgba(251, 191, 36, 0.22); background: rgba(251, 191, 36, 0.08); }
    .status.applied { color: var(--ok); border-color: rgba(52, 211, 153, 0.22); background: rgba(52, 211, 153, 0.08); }
    .content {
      padding: 14px;
      display: grid;
      gap: 12px;
      align-content: start;
      min-width: 0;
    }
    .flash {
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
    }
    .flash.hidden {
      display: none;
    }
    .flash.success {
      border-color: rgba(52, 211, 153, 0.25);
      background: rgba(52, 211, 153, 0.08);
    }
    .flash.error {
      border-color: rgba(248, 113, 113, 0.25);
      background: rgba(248, 113, 113, 0.08);
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03));
      box-shadow: var(--shadow);
    }
    .hero h2 {
      margin: 2px 0 4px;
      font-size: clamp(19px, 2.3vw, 27px);
    }
    .hero p {
      margin: 0;
      color: var(--muted);
    }
    .hero-copy {
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    .hero-toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      justify-items: end;
      min-width: min(620px, 100%);
    }
    .hero-actions {
      display: flex;
      gap: 7px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
      min-width: 0;
    }
    .hero-actions-primary {
      grid-column: 1 / -1;
    }
    .hero-actions-secondary {
      opacity: 0.88;
    }
    .hero-utilities {
      display: flex;
      gap: 8px;
      align-items: end;
      justify-content: flex-end;
      flex-wrap: wrap;
      min-width: 0;
    }
    .actions {
      display: flex;
      gap: 7px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .button {
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text);
      border-radius: 9px;
      padding: 7px 10px;
      min-height: 34px;
      min-width: 0;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }
    .button:hover {
      border-color: rgba(56, 189, 248, 0.4);
      background: rgba(255, 255, 255, 0.08);
      transform: translateY(-1px);
    }
    .button.primary {
      background: linear-gradient(180deg, rgba(56, 189, 248, 0.24), rgba(14, 165, 233, 0.12));
      border-color: rgba(56, 189, 248, 0.45);
    }
    .button.subtle {
      background: rgba(148, 163, 184, 0.06);
      color: var(--muted);
    }
    .button.warn {
      border-color: rgba(251, 191, 36, 0.28);
      background: rgba(251, 191, 36, 0.08);
      color: #fcd34d;
    }
    .button.danger {
      border-color: rgba(248, 113, 113, 0.28);
      background: rgba(248, 113, 113, 0.08);
      color: #fca5a5;
    }
    .button:disabled,
    .run-card:disabled {
      cursor: not-allowed;
      opacity: 0.6;
      transform: none;
    }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-radius: 9px;
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
      gap: 12px;
      align-items: start;
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .card header {
      padding: 10px 12px 0;
    }
    .card h3 {
      margin: 0;
      font-size: 13px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: #c9d6ec;
    }
    .card .body {
      padding: 10px 12px 12px;
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    .card-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }
    .header-copy {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
      gap: 8px;
    }
    .stat {
      padding: 10px;
      border-radius: 9px;
      background: var(--panel-soft);
      border: 1px solid var(--border);
      min-width: 0;
    }
    .stat strong {
      display: block;
      font-size: 18px;
      margin-bottom: 2px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stat span {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    pre {
      margin: 0;
      padding: 10px;
      border-radius: 9px;
      border: 1px solid var(--border);
      background: rgba(4, 8, 16, 0.8);
      color: #dce7f7;
      overflow: auto;
      max-height: 340px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .editor-shell {
      display: grid;
      gap: 8px;
    }
    .toolbar-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .toolbar-group {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
      align-items: center;
      min-width: 0;
    }
    .segmented {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.03);
    }
    .segmented .button {
      padding: 6px 9px;
      border-radius: 8px;
    }
    .segmented .button.active {
      background: rgba(56, 189, 248, 0.14);
      border-color: rgba(56, 189, 248, 0.36);
      color: #b5ecff;
    }
    .console-tabs {
      position: sticky;
      top: 0;
      z-index: 12;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: rgba(8, 13, 26, 0.86);
      backdrop-filter: blur(14px);
      box-shadow: var(--shadow);
    }
    .console-tabs .button {
      flex: 1 1 128px;
      justify-content: center;
    }
    .console-tabs .button.active {
      background: rgba(56, 189, 248, 0.16);
      border-color: rgba(56, 189, 248, 0.44);
      color: #b5ecff;
    }
    .console-panel[hidden] {
      display: none;
    }
    .editor {
      width: 100%;
      min-height: 300px;
      resize: vertical;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--panel-deep);
      color: #dce7f7;
      padding: 12px;
      outline: none;
    }
    .preview {
      min-height: 300px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(8, 13, 26, 0.94), rgba(15, 23, 42, 0.88));
      overflow: auto;
      padding: 12px;
    }
    .project-overview-grid {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      align-items: stretch;
    }
    .studio-bridge-layout {
      display: grid;
      grid-template-columns: minmax(170px, 220px) minmax(520px, 1fr) minmax(220px, 300px);
      gap: 12px;
      align-items: start;
      min-width: 0;
    }
    .studio-navigator,
    .studio-inspector,
    .studio-graph-column {
      min-width: 0;
    }
    .studio-graph-column {
      display: grid;
      gap: 8px;
    }
    .studio-flow-list {
      grid-column: 2;
    }
    .studio-diagnostics {
      grid-column: 1 / -1;
    }
    .studio-canvas-shell {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .studio-canvas-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .studio-graph-root {
      min-height: 390px;
      min-width: 0;
    }
    .log-toolbar {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) minmax(110px, 140px) minmax(90px, 120px) minmax(160px, 1fr);
      gap: 8px;
      align-items: center;
    }
    .log-stream-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
    }
    .artifact-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .artifact-section {
      display: grid;
      gap: 8px;
    }
    .preview svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .structure-list {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .debug-graph-body {
      grid-template-columns: 1fr;
      align-items: start;
    }
    .run-graph-root {
      min-height: 520px;
    }
    .run-graph-summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
      min-width: 0;
    }
    .state-panel {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .state-group {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .state-group-title {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .state-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      min-width: 0;
    }
    .form-shell {
      display: grid;
      gap: 8px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .field {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .field span {
      color: var(--muted);
      font-size: 12px;
    }
    .field textarea,
    .field input,
    .field select {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      outline: none;
    }
    .field textarea {
      min-height: 120px;
      resize: vertical;
    }
    .field.full {
      grid-column: 1 / -1;
    }
    .timeline {
      display: grid;
      gap: 8px;
      max-height: 430px;
      overflow: auto;
      padding-right: 4px;
    }
    .event {
      border-radius: 9px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.03);
      padding: 9px 10px;
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    .event-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
      min-width: 0;
    }
    .event-top > *,
    .event strong,
    .hint {
      min-width: 0;
      overflow-wrap: anywhere;
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
    .timeline-controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
      align-items: stretch;
    }
    .timeline-controls .button {
      width: 100%;
    }
    .split-inline {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      min-width: 0;
    }
    .sidebar-toggle {
      display: none;
    }
    @media (max-width: 1180px) {
      .app { grid-template-columns: 1fr; }
      .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        width: min(360px, calc(100vw - 36px));
        border-right: 1px solid var(--border);
        border-bottom: 0;
        transform: translateX(-102%);
        transition: transform 180ms ease;
      }
      body.drawer-open .sidebar {
        transform: translateX(0);
      }
      .run-list { max-height: 280px; }
      .span-4, .span-6, .span-8, .span-12 { grid-column: span 12; }
      .studio-bridge-layout { grid-template-columns: 1fr; }
      .studio-graph-column { order: 1; }
      .studio-inspector { order: 2; }
      .studio-navigator { order: 3; }
      .studio-flow-list {
        order: 4;
        grid-column: auto;
        max-height: 520px;
        overflow: auto;
        padding-right: 2px;
      }
      .studio-diagnostics { order: 5; }
      .hero { flex-direction: column; }
      .hero-toolbar {
        width: 100%;
        justify-items: stretch;
      }
      .hero-actions, .hero-utilities, .actions { justify-content: flex-start; }
      .sidebar-toggle {
        display: inline-flex;
      }
    }
    @media (max-width: 960px) {
      .content { padding: 12px; }
      .hero-toolbar {
        grid-template-columns: 1fr;
      }
      .toolbar-row,
      .row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
      }
      .toolbar-row > *,
      .row > * {
        min-width: 0;
      }
      .button {
        width: 100%;
      }
      .hero-toolbar .button {
        width: auto;
      }
      .timeline-controls {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .log-toolbar {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .debug-graph-body {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 768px) {
      .content { padding: 10px; }
      .hero { padding: 10px; }
      .hero-actions,
      .hero-utilities {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
      }
      .hero-toolbar .button,
      .hero-utilities .field,
      .hero-utilities .live {
        width: 100%;
      }
      .toolbar-row,
      .row {
        grid-template-columns: 1fr;
      }
      .timeline-controls {
        grid-template-columns: 1fr;
      }
      .form-grid {
        grid-template-columns: 1fr;
      }
      .log-toolbar {
        grid-template-columns: 1fr;
      }
      .preview,
      .editor {
        min-height: 280px;
      }
      pre,
      .timeline {
        max-height: 320px;
      }
    }
    @media (max-width: 480px) {
      .content { padding: 8px; }
      .sidebar {
        width: calc(100vw - 18px);
      }
      .button {
        min-width: 0;
        padding: 8px 10px;
      }
      .run-card,
      .event,
      pre,
      .preview,
      .editor {
        border-radius: 9px;
      }
    }
  </style>
</head>
<body>
  <div id="sidebar-overlay" class="sidebar-overlay"></div>
  <div class="app">
    <aside id="sidebar" class="sidebar">
      <div class="brand">
        <h1>${escapeHtml(t("app.title"))}</h1>
        <span>${escapeHtml(t("app.local"))}</span>
      </div>
      <div class="stack">
        <div class="pill">${escapeHtml(t("app.workdir"))} <code id="workdir">${escapeHtml(workdir)}</code></div>
        <input id="search" class="search" placeholder="${escapeHtml(t("search.placeholder"))}" />
        <div id="run-list" class="run-list"></div>
      </div>
    </aside>
    <main class="content">
      <div id="flash" class="flash hidden"></div>
      <section class="hero">
        <div class="hero-copy">
          <div class="split-inline">
            <button id="sidebar-toggle" class="button subtle sidebar-toggle">${escapeHtml(t("hero.runs"))}</button>
            <p class="hint">${escapeHtml(t("hero.subtitle"))}</p>
          </div>
          <h2 id="selected-title">${escapeHtml(t("hero.selectRun"))}</h2>
          <p id="selected-subtitle" class="truncate">${escapeHtml(t("hero.selectRunHint"))}</p>
        </div>
        <div class="hero-toolbar">
          <div class="actions hero-actions hero-actions-primary">
            <button id="start-run" class="button primary">${escapeHtml(t("action.startRun"))}</button>
            <button id="resume-run" class="button">${escapeHtml(t("action.resumeSelected"))}</button>
            <button id="stop-run" class="button warn">${escapeHtml(t("action.requestStop"))}</button>
            <button id="refresh" class="button">${escapeHtml(t("action.refresh"))}</button>
          </div>
          <div class="actions hero-actions hero-actions-secondary">
            <button id="project-home" class="button subtle">${escapeHtml(t("action.project"))}</button>
            <button id="project-load" class="button subtle">${escapeHtml(t("action.loadProject"))}</button>
            <button id="project-export" class="button subtle">${escapeHtml(t("action.exportProject"))}</button>
            <button id="reindex" class="button subtle">${escapeHtml(t("action.reindex"))}</button>
          </div>
          <div class="hero-utilities">
            <label class="field locale-field">
              <span>${escapeHtml(t("app.locale"))}</span>
              <select id="locale-select" class="select">
                <option value="en"${locale === "en" ? " selected" : ""}>English</option>
                <option value="zh-CN"${locale === "zh-CN" ? " selected" : ""}>中文</option>
              </select>
            </label>
            <div id="live" class="live">${escapeHtml(t("state.idle"))}</div>
          </div>
        </div>
      </section>
      <nav id="console-tabs" class="console-tabs" aria-label="Visualizer sections"></nav>
      <section class="grid">
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.actionForm"))}</h3></header>
          <div class="body">
            <div id="action-form" class="form-shell"><div class="hint">${escapeHtml(t("form.emptyHint"))}</div></div>
          </div>
        </article>
      </section>
      <section id="console-panel-project" class="console-panel grid" data-console-panel="project" hidden>
        <article class="card span-12">
          <header>
            <div class="card-header">
              <div class="header-copy">
                <h3 id="workbench-title">${escapeHtml(t("section.mermaidWorkbench"))}</h3>
                <div id="workbench-meta" class="hint">${escapeHtml(t("workbench.defaultMeta"))}</div>
              </div>
              <div id="workbench-actions" class="actions"></div>
            </div>
          </header>
          <div class="body">
            <div class="editor-shell">
              <div class="toolbar-row">
                <div id="workbench-status" class="toolbar-group"></div>
                <div id="workbench-tabs" class="segmented"></div>
              </div>
              <div id="workbench-body"></div>
            </div>
          </div>
        </article>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.projectOverview"))}</h3></header>
          <div class="body">
            <div id="project-summary" class="structure-list">${escapeHtml(t("state.loadingProject"))}</div>
          </div>
        </article>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.projectReadiness"))}</h3></header>
          <div class="body">
            <div id="project-readiness" class="structure-list">${escapeHtml(t("state.loadingProjectReadiness"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-debug" class="console-panel grid" data-console-panel="debug">
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.runSnapshot"))}</h3></header>
          <div class="body">
            <div class="stat-grid" id="stats"></div>
          </div>
        </article>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.timeline"))}</h3></header>
          <div class="body">
            <div class="row timeline-controls">
              <select id="timeline-role" class="select">
                <option value="">${escapeHtml(t("timeline.allRoles"))}</option>
              </select>
              <input id="timeline-type" class="select" placeholder="${escapeHtml(t("timeline.eventType"))}" />
              <select id="timeline-status" class="select">
                <option value="">${escapeHtml(t("timeline.allStatuses"))}</option>
                <option value="pending">pending</option>
                <option value="paused">paused</option>
                <option value="running">running</option>
                <option value="stopped">stopped</option>
                <option value="done">done</option>
                <option value="failed">failed</option>
                <option value="waiting_review">waiting_review</option>
              </select>
              <input id="timeline-branch" class="select" placeholder="${escapeHtml(t("timeline.branchId"))}" />
              <input id="timeline-review" class="select" placeholder="${escapeHtml(t("timeline.reviewId"))}" />
              <input id="timeline-error" class="select" placeholder="${escapeHtml(t("timeline.errorCode"))}" />
              <button id="timeline-apply" class="button subtle">${escapeHtml(t("action.applyFilters"))}</button>
              <button id="timeline-clear" class="button subtle">${escapeHtml(t("action.clearFilters"))}</button>
            </div>
            <div id="timeline" class="timeline"></div>
          </div>
        </article>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.graphView"))}</h3></header>
          <div class="body debug-graph-body">
            <div id="graph-view" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="state" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
          </div>
        </article>
        <article class="card span-12">
          <header>
            <div class="row">
              <h3>${escapeHtml(t("section.failureTriage"))}</h3>
              <div id="failure-controls" class="actions"></div>
            </div>
          </header>
          <div class="body">
            <div id="failure-summary" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="failure-detail" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="failure-next-checks" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
          </div>
        </article>
        <article class="card span-6">
          <header><h3>${escapeHtml(t("section.reviewQueue"))}</h3></header>
          <div class="body">
            <div id="reviews" class="timeline"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="review-actions" class="actions"></div>
            <div id="review-detail" class="structure-list">${escapeHtml(t("state.noReviewSelected"))}</div>
          </div>
        </article>
        <article class="card span-6">
          <header>
            <div class="row">
              <h3>${escapeHtml(t("section.resumeReadiness"))}</h3>
              <div id="resume-controls" class="actions"></div>
            </div>
          </header>
          <div class="body">
            <div id="resume-readiness" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="resume-diagnostics" class="timeline"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
          </div>
        </article>
      </section>
      <section id="console-panel-ops" class="console-panel grid" data-console-panel="ops" hidden>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.opsSummary"))}</h3></header>
          <div class="body">
            <div id="ops-summary" class="structure-list">${escapeHtml(t("state.loadingOpsSummary"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-config" class="console-panel grid" data-console-panel="config" hidden>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.configExplain"))}</h3></header>
          <div class="body">
            <div id="binding-explain" class="structure-list">${escapeHtml(t("state.loadingBindingResolution"))}</div>
            <div id="role-packages" class="structure-list">${escapeHtml(t("state.loadingRolePackages"))}</div>
            <div id="contract-explain" class="structure-list">${escapeHtml(t("state.loadingContracts"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-logs" class="console-panel grid" data-console-panel="logs" hidden>
        <article class="card span-12">
          <header>
            <div class="toolbar-row">
              <div class="toolbar-group">
                <h3>${escapeHtml(t("section.logs"))}</h3>
                <div id="logs-controls" class="actions"></div>
              </div>
              <div class="log-toolbar">
                <select id="log-role" class="select">
                <option value="">${escapeHtml(t("timeline.allRoles"))}</option>
                </select>
                <select id="log-page-size" class="select">
                  <option value="100">100</option>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                  <option value="">${escapeHtml(t("logs.all"))}</option>
                </select>
                <input id="log-tail" class="select" type="number" min="1" placeholder="${escapeHtml(t("logs.tail"))}" />
                <input id="log-since" class="select" type="datetime-local" />
              </div>
            </div>
          </header>
          <div class="body">
            <div id="logs-filters" class="hint"></div>
            <div id="logs" class="structure-list">${escapeHtml(t("state.noRunSelected"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-artifacts" class="console-panel grid" data-console-panel="artifacts" hidden>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.artifacts"))}</h3></header>
          <div class="body">
            <div id="detail" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
          </div>
        </article>
      </section>
    </main>
  </div>
  <script src="/assets/studio-graph.js"></script>
  <script>
${clientScript}
  </script>
</body>
</html>`;
}
