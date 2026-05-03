export function renderPageShellStyles(): string {
  return `    :root {
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
      grid-template-columns: minmax(0, 1fr);
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
      display: none;
      padding: 14px;
      border-right: 1px solid var(--border);
      background: rgba(8, 13, 26, 0.78);
      backdrop-filter: blur(18px);
      min-width: 0;
      overflow-x: hidden;
      overflow-y: auto;
      z-index: 30;
    }
    body.show-run-sidebar .app {
      grid-template-columns: 288px minmax(0, 1fr);
    }
    body.show-run-sidebar .sidebar {
      display: block;
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
    body:not(.show-run-sidebar) .stack {
      display: none;
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
      gap: 0;
      min-width: 0;
    }
    .shell {
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-height: 100vh;
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
    .flash.warning {
      border-color: rgba(251, 191, 36, 0.25);
      background: rgba(251, 191, 36, 0.08);
    }
    .top-nav {
      position: sticky;
      top: 0;
      z-index: 12;
      display: grid;
      gap: 10px;
      padding: 14px 14px 10px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.12);
      background: linear-gradient(180deg, rgba(7, 12, 24, 0.96), rgba(7, 12, 24, 0.88));
      backdrop-filter: blur(20px);
    }
    .top-nav-row {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-start;
      min-width: 0;
    }
    .top-nav-row-secondary {
      align-items: center;
    }
    .top-nav-brand,
    .top-nav-stage-heading,
    .stage-heading {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .brand-lockup {
      display: flex;
      align-items: baseline;
      gap: 12px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .brand-lockup h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0.02em;
    }
    .brand-lockup span {
      color: var(--muted);
      font-size: 12px;
    }
    .top-nav-actions {
      display: grid;
      grid-template-columns: auto auto auto;
      gap: 6px;
      align-items: center;
      justify-items: end;
      min-width: 0;
    }
    .main-stage {
      min-width: 0;
      padding: 10px 14px 14px;
    }
    .stage-stack {
      display: grid;
      gap: 12px;
      align-content: start;
      min-width: 0;
    }
    .status-bar {
      margin: 0 14px 14px;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
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
      grid-template-columns: auto auto auto;
      gap: 6px;
      align-items: center;
      justify-items: end;
      min-width: 0;
    }
    .hero-actions {
      display: flex;
      gap: 5px;
      align-items: center;
      flex-wrap: nowrap;
      justify-content: flex-end;
      min-width: 0;
    }
    .hero-actions-primary {
      grid-column: auto;
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
      white-space: nowrap;
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
    .global-status {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      flex-wrap: nowrap;
      min-width: 0;
      padding: 7px 9px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.035);
      box-shadow: var(--shadow);
    }
    .global-status .pill {
      max-width: min(54vw, 720px);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 12px;
      align-items: start;
    }
    [hidden] {
      display: none !important;
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
    .operate-workspace {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .operate-tabs {
      justify-content: flex-start;
      width: fit-content;
      max-width: 100%;
    }
    .operate-main {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
      gap: 12px;
      align-items: start;
      min-width: 0;
    }
    .operate-primary,
    .operate-detail-stack,
    .operate-tab-panel {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .operate-tab-panel[hidden] {
      display: none !important;
    }
    body.show-operate-workspace:not(.operate-tab-overview) .operate-overview,
    body.show-operate-workspace:not(.operate-tab-graph) .operate-graph,
    body.show-operate-workspace:not(.operate-tab-recovery) .operate-recovery,
    body.show-operate-workspace:not(.operate-tab-logs) .operate-logs,
    body.show-operate-workspace:not(.operate-tab-reviews) .operate-reviews,
    body.show-operate-workspace:not(.operate-tab-artifacts) .operate-artifacts {
      display: none !important;
    }
    body.show-operate-workspace:not(.operate-tab-logs) #console-panel-logs,
    body.show-operate-workspace:not(.operate-tab-artifacts) #console-panel-artifacts {
      display: none !important;
    }
    body.show-operate-workspace.operate-tab-logs #console-panel-logs,
    body.show-operate-workspace.operate-tab-artifacts #console-panel-artifacts {
      display: grid !important;
    }
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
    .build-header {
      align-items: flex-start;
    }
    .build-header .header-copy {
      flex: 1 1 220px;
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
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .loading-skeleton {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.025);
    }
    .skeleton-line {
      height: 12px;
      border-radius: 999px;
      background: linear-gradient(90deg, rgba(148, 163, 184, 0.12), rgba(56, 189, 248, 0.28), rgba(148, 163, 184, 0.12));
      background-size: 220% 100%;
      animation: skeleton-shimmer 1.2s ease-in-out infinite;
    }
    .skeleton-line-1 { width: 72%; }
    .skeleton-line-2 { width: 92%; }
    .skeleton-line-3 { width: 64%; }
    .skeleton-line-4 { width: 84%; }
    .skeleton-line-5 { width: 52%; }
    .skeleton-line-6 { width: 76%; }
    @keyframes skeleton-shimmer {
      0% { background-position: 120% 0; }
      100% { background-position: -120% 0; }
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
    .workbench-source-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.025);
    }
    .toolbar-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      flex-wrap: nowrap;
      min-width: 0;
    }
    .toolbar-group {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
      align-items: center;
      min-width: 0;
    }
    .build-control-bar {
      display: grid;
      gap: 8px;
      align-items: end;
      justify-content: flex-end;
      min-width: 0;
      flex: 1 1 520px;
    }
    .build-control-bar #workbench-status {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(126px, 1fr));
      gap: 6px;
      width: 100%;
      max-width: min(720px, 58vw);
      justify-self: end;
    }
    .build-control-bar #workbench-actions,
    .build-control-bar #workbench-tabs {
      justify-self: end;
    }
    .project-open-browser-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
      gap: 8px;
      align-items: center;
      min-width: 0;
    }
    .workbench-view-tabs {
      justify-content: flex-start;
      margin-bottom: 2px;
    }
    .segmented {
      display: inline-flex;
      flex-wrap: nowrap;
      gap: 6px;
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.03);
    }
    .segmented .button {
      padding: 5px 8px;
      border-radius: 8px;
      white-space: nowrap;
    }
    .segmented .button.active {
      background: rgba(56, 189, 248, 0.14);
      border-color: rgba(56, 189, 248, 0.36);
      color: #b5ecff;
    }
    .console-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: rgba(255, 255, 255, 0.03);
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
    .legacy-tabs {
      flex: 1 1 100%;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }
    .legacy-tabs .button {
      flex: 0 1 auto;
      min-width: 96px;
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
    .project-menu {
      grid-column: 1 / -1;
      justify-content: flex-start;
      width: max-content;
      max-width: 100%;
      overflow-x: auto;
    }
    .studio-bridge-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      min-width: 0;
    }
    .studio-graph-column,
    .studio-inspector,
    .studio-bridge-index,
    .studio-diagnostics {
      grid-column: 1 / -1;
    }
    .studio-bridge-index {
      grid-column: 1 / -1;
      min-width: 0;
    }
    .studio-index-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(240px, 1fr));
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
    .studio-canvas-toolbar > div {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .studio-canvas-shell.is-fullscreen {
      position: fixed;
      inset: 12px;
      z-index: 90;
      background: var(--panel);
      border: 1px solid var(--border);
      padding: 12px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.52);
    }
    .studio-canvas-shell.is-fullscreen .studio-graph-root,
    .studio-canvas-shell.is-fullscreen .studio-graph-island {
      min-height: calc(100vh - 108px);
    }
    .studio-graph-root {
      min-height: clamp(480px, 62vh, 760px);
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
    .release-checklist {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .release-group {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .release-group h4 {
      margin: 0;
      color: #dbeafe;
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
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
    .field [aria-invalid="true"] {
      border-color: rgba(248, 113, 113, 0.78);
      box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.14);
    }
    .field-error {
      min-height: 14px;
      color: #fca5a5;
      font-size: 12px;
    }
    .field textarea {
      min-height: 120px;
      resize: vertical;
    }
    .field.full {
      grid-column: 1 / -1;
    }
    .studio-chat-panel[hidden] {
      display: none;
    }
    .studio-chat-panel.is-open {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 80;
      width: min(860px, calc(100vw - 48px));
      max-height: min(760px, calc(100vh - 48px));
      overflow: auto;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: rgba(7, 12, 24, 0.96);
      box-shadow: 0 22px 70px rgba(0, 0, 0, 0.42);
      padding: 12px;
    }
    @media (max-width: 720px) {
      .studio-chat-panel.is-open {
        inset: 12px;
        width: auto;
        max-height: none;
      }
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
      body.show-run-sidebar .app,
      .app { grid-template-columns: 1fr; }
      .sidebar {
        display: block;
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
      body:not(.show-run-sidebar) .sidebar {
        display: none;
      }
      body.drawer-open .sidebar {
        transform: translateX(0);
      }
      .run-list { max-height: 280px; }
      .span-4, .span-6, .span-8, .span-12 { grid-column: span 12; }
      .operate-main {
        grid-template-columns: 1fr;
      }
      .operate-tabs {
        width: 100%;
      }
      .studio-bridge-layout { grid-template-columns: 1fr; }
      .studio-graph-column { order: 1; }
      .studio-inspector { order: 2; }
      .studio-bridge-index { order: 3; }
      .studio-index-grid { grid-template-columns: 1fr; }
      .studio-navigator { order: 3; }
      .studio-flow-list {
        order: 4;
        max-height: 520px;
        overflow: auto;
        padding-right: 2px;
      }
      .studio-diagnostics { order: 5; }
      .top-nav-row,
      .top-nav-stage-heading {
        display: grid;
        grid-template-columns: 1fr;
      }
      .top-nav-actions,
      .hero-toolbar {
        width: 100%;
        grid-template-columns: 1fr;
        justify-items: stretch;
      }
      .hero-actions,
      .hero-utilities {
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      .hero-actions, .hero-utilities, .actions { justify-content: flex-start; }
      .sidebar-toggle {
        display: inline-flex;
      }
    }
    @media (max-width: 960px) {
      .content { padding: 12px; }
      .top-nav {
        padding: 12px 12px 10px;
      }
      .main-stage {
        padding: 10px 12px 12px;
      }
      .status-bar {
        margin: 0 12px 12px;
      }
      .top-nav-actions,
      .hero-toolbar {
        grid-template-columns: 1fr;
      }
      .workbench-source-actions,
      .row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
      }
      .workbench-source-actions > *,
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
      .top-nav {
        padding: 10px 10px 8px;
      }
      .main-stage {
        padding: 8px 10px 10px;
      }
      .status-bar {
        margin: 0 10px 10px;
      }
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
      .build-control-bar,
      .workbench-source-actions,
      .row {
        display: grid;
        grid-template-columns: 1fr;
      }
      .build-control-bar #workbench-status {
        max-width: 100%;
      }
      .build-control-bar #workbench-actions,
      .build-control-bar #workbench-tabs {
        justify-self: stretch;
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
      .top-nav {
        padding: 8px 8px 6px;
      }
      .main-stage {
        padding: 8px;
      }
      .status-bar {
        margin: 0 8px 8px;
      }
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
`;
}
