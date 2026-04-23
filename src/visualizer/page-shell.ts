import { buildClientAppScript } from "./client-app.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPageHtml(workdir: string, apiPrefix: string): string {
  const clientScript = buildClientAppScript(apiPrefix);
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
    .status.done, .status.simulation, .status.completed { color: var(--ok); border-color: rgba(52, 211, 153, 0.22); background: rgba(52, 211, 153, 0.08); }
    .status.failed { color: var(--bad); border-color: rgba(248, 113, 113, 0.22); background: rgba(248, 113, 113, 0.08); }
    .status.unknown, .status.stopped, .status.idle { color: var(--muted); border-color: rgba(148, 163, 184, 0.22); background: rgba(148, 163, 184, 0.06); }
    .status.waiting_review, .status.active { color: var(--accent); border-color: rgba(56, 189, 248, 0.22); background: rgba(56, 189, 248, 0.08); }
    .status.pending, .status.paused, .status.recorded, .status.pending_reconcile { color: var(--warn); border-color: rgba(251, 191, 36, 0.22); background: rgba(251, 191, 36, 0.08); }
    .status.applied { color: var(--ok); border-color: rgba(52, 211, 153, 0.22); background: rgba(52, 211, 153, 0.08); }
    .content {
      padding: 24px;
      display: grid;
      gap: 16px;
      align-content: start;
    }
    .flash {
      padding: 12px 16px;
      border-radius: 14px;
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
      <div id="flash" class="flash hidden"></div>
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
          <header>
            <div class="row">
              <h3>Resume Diagnostics</h3>
              <div id="resume-controls" class="actions"></div>
            </div>
          </header>
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
${clientScript}
  </script>
</body>
</html>`;
}
