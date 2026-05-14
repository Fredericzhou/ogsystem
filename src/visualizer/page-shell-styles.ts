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
      --control-bg: rgba(255, 255, 255, 0.035);
      --control-bg-strong: rgba(255, 255, 255, 0.055);
      --control-border-strong: rgba(148, 163, 184, 0.24);
      --tab-active-bg: linear-gradient(180deg, rgba(56, 189, 248, 0.18), rgba(56, 189, 248, 0.1));
      --tab-active-border: rgba(56, 189, 248, 0.4);
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
    body.show-run-sidebar .sidebar {
      display: block;
    }
    .pill {
      display: flex;
      align-items: center;
      gap: 5px;
      width: auto;
      padding: 3px 7px;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--muted);
      background: rgba(255, 255, 255, 0.03);
      font-size: 11px;
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
    .pill-compact {
      gap: 4px;
      padding: 3px 7px;
    }
    .pill-label {
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
      gap: 6px;
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
      background: var(--control-bg);
      color: var(--text);
      outline: none;
      transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }
    .search:hover, .select:hover,
    .search:focus, .select:focus {
      border-color: rgba(56, 189, 248, 0.26);
      background: var(--control-bg-strong);
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
      max-height: calc(100dvh - 70px);
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
      padding: 12px;
      display: grid;
      gap: 10px;
      min-width: 0;
    }
    .shell {
      display: grid;
      grid-template-columns: minmax(0, 0) minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-height: 100dvh;
      height: 100dvh;
      overflow: hidden;
    }
    .shell.content > .sidebar {
      grid-column: 1;
      grid-row: 1 / 4;
    }
    .shell.content > .top-nav,
    .shell.content > .main-stage,
    .shell.content > .status-bar {
      grid-column: 2;
      min-width: 0;
    }
    body.show-run-sidebar .shell.content {
      grid-template-columns: 288px minmax(0, 1fr);
    }
    .flash {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      max-width: min(560px, calc(100vw - 32px));
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
      gap: 6px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background:
        linear-gradient(180deg, rgba(56, 189, 248, 0.08), rgba(56, 189, 248, 0) 28%),
        linear-gradient(180deg, rgba(7, 12, 24, 0.96), rgba(7, 12, 24, 0.9));
      backdrop-filter: blur(20px);
      box-shadow: var(--shadow);
    }
    .top-nav-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 10px;
      align-items: center;
      min-width: 0;
    }
    .top-nav-brand {
      display: flex;
      align-items: center;
      gap: 5px 8px;
      flex: 0 1 auto;
      flex-wrap: wrap;
      min-width: 0;
    }
    .top-nav-meta {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    .top-nav-center {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: start;
      flex: 1 1 460px;
      min-width: min(100%, 360px);
    }
    .top-nav-meta .pill {
      max-width: min(30vw, 280px);
      padding: 3px 7px;
    }
    .brand-lockup {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .brand-lockup h1 {
      margin: 0;
      font-size: 16px;
      letter-spacing: 0.02em;
    }
    .brand-lockup span {
      color: var(--muted);
      font-size: 11px;
    }
    .top-nav-actions {
      display: flex;
      flex: 0 0 auto;
      flex-wrap: wrap;
      gap: 5px 6px;
      align-items: center;
      justify-content: flex-end;
      margin-left: auto;
      min-width: 0;
    }
    .main-stage {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: 0;
    }
    .stage-stack {
      display: grid;
      gap: 0;
      align-content: stretch;
      grid-auto-rows: minmax(0, 1fr);
      min-height: 100%;
      height: 100%;
      overflow: auto;
      padding: 0;
      min-width: 0;
    }
    .status-bar {
      margin: 0;
      position: sticky;
      bottom: 0;
      z-index: 14;
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
      gap: 4px;
      align-items: center;
      flex-wrap: nowrap;
      justify-content: flex-end;
      min-width: 0;
    }
    .hero-actions-primary {
      grid-column: auto;
    }
    .hero-utilities {
      display: flex;
      gap: 6px;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      min-width: 0;
    }
    .top-nav-center .hero-utilities {
      justify-self: end;
      padding: 4px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 11px;
      background: rgba(255, 255, 255, 0.02);
    }
    .top-nav-center .locale-field {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 2px;
    }
    .top-nav-center .locale-field span {
      white-space: nowrap;
      font-size: 11px;
    }
    .top-nav-center .locale-field .select {
      min-width: 92px;
      width: auto;
      min-height: 30px;
      padding: 6px 10px;
    }
    .actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .button {
      border: 1px solid var(--border);
      background: var(--control-bg);
      color: var(--text);
      border-radius: 9px;
      padding: 5px 9px;
      min-height: 30px;
      min-width: 0;
      white-space: nowrap;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
    }
    .button:hover {
      border-color: rgba(56, 189, 248, 0.4);
      background: var(--control-bg-strong);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
      transform: translateY(-1px);
    }
    .button:active {
      transform: translateY(0);
      box-shadow: none;
    }
    .button.primary {
      background: linear-gradient(180deg, rgba(56, 189, 248, 0.24), rgba(14, 165, 233, 0.12));
      border-color: rgba(56, 189, 248, 0.45);
    }
    .button.subtle {
      background: rgba(148, 163, 184, 0.055);
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
      padding: 5px 9px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(7, 12, 24, 0.92);
      backdrop-filter: blur(18px);
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.22);
    }
    .global-status-primary,
    .global-status-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .global-status-primary {
      flex: 1 1 auto;
      flex-wrap: wrap;
    }
    .global-status-actions {
      flex: 0 1 auto;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .global-status .pill {
      max-width: min(36vw, 420px);
    }
    .global-status-context {
      min-width: 0;
    }
    .global-status-context.mode-toggle {
      display: flex;
      align-items: center;
      padding: 0;
      border: 0;
      background: transparent;
      max-width: none;
      overflow: visible;
    }
    .global-status-context-copy {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .global-status-context .segmented {
      max-width: 100%;
    }
    .workbench-view-tabs-compat {
      display: none;
    }
    .global-status-diagnostics {
      flex: 1 1 auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .global-status-diagnostics.warn {
      color: #fcd34d;
    }
    .global-status-workbench-status {
      flex: 1 1 auto;
      justify-content: flex-start;
    }
    .global-status-workbench-status[hidden] {
      display: none;
    }
    .global-status-workbench-status .pill {
      max-width: min(100%, 240px);
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
      padding: 8px 10px 0;
    }
    .card h3 {
      margin: 0;
      font-size: 13px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: #c9d6ec;
    }
    .card .body {
      padding: 9px 10px 10px;
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
      gap: 10px;
      align-items: center;
    }
    .header-copy {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .build-header {
      align-items: flex-start;
    }
    .build-header .header-copy {
      flex: 1 1 240px;
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
      font-size: 11px;
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
      min-height: 0;
      height: 100%;
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
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
      min-width: 0;
    }
    .build-control-bar {
      display: grid;
      gap: 8px;
      align-items: start;
      justify-items: stretch;
      min-width: 0;
      flex: 1 1 520px;
    }
    .build-control-primary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 10px;
      align-items: start;
      min-width: 0;
    }
    .build-ide-shell,
    .build-ide-body,
    .build-nav-stack,
    .build-command-stack {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .build-nav-stack {
      align-content: start;
    }
    .build-command-stack {
      justify-items: end;
      align-content: start;
    }
    .build-ide-body {
      height: 100%;
      min-height: 0;
      align-content: stretch;
      grid-auto-rows: minmax(0, 1fr);
      overflow: hidden;
    }
    .build-control-status {
      min-width: 0;
    }
    .build-control-bar #workbench-status {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      width: auto;
      justify-content: flex-end;
      min-width: 0;
    }
    .build-control-bar #workbench-status .pill {
      flex: 0 1 auto;
      max-width: min(100%, 210px);
    }
    .build-control-bar #workbench-status .workbench-status-last-run {
      max-width: min(100%, 260px);
    }
    .build-control-bar #workbench-status code {
      flex: 0 1 auto;
      max-width: 16ch;
    }
    .build-control-bar #workbench-tabs,
    .build-control-bar #workbench-actions {
      min-width: 0;
    }
    .build-control-primary #workbench-actions {
      justify-content: flex-end;
    }
    .build-mode-tabs {
      justify-self: start;
    }
    .workbench-view-tabs {
      justify-content: flex-start;
      margin-bottom: 0;
    }
    .build-submenu-tabs {
      margin-left: 10px;
    }
    .build-submenu-tabs:empty {
      display: none;
    }
    .segmented {
      display: inline-flex;
      flex-wrap: nowrap;
      gap: 4px;
      padding: 4px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.16);
      background: rgba(255, 255, 255, 0.025);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      min-width: 0;
      max-width: 100%;
    }
    .segmented .button {
      padding: 5px 9px;
      border-radius: 9px;
      white-space: nowrap;
      width: auto;
      min-height: 30px;
      border-color: transparent;
      background: transparent;
    }
    .segmented .button.active {
      background: var(--tab-active-bg);
      border-color: var(--tab-active-border);
      color: #b5ecff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }
    .console-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-width: 0;
      width: 100%;
      padding: 4px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.02);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }
    .console-tabs .button {
      flex: 1 1 112px;
      justify-content: center;
      width: auto;
      border-color: transparent;
      background: transparent;
    }
    .console-tabs .button.active {
      background: var(--tab-active-bg);
      border-color: var(--tab-active-border);
      color: #b5ecff;
    }
    .console-panel[hidden] {
      display: none;
    }
    #console-panel-build,
    #console-panel-build > .card,
    #console-panel-build > .card > .body,
    .build-ide-shell,
    .build-ide-body {
      min-height: 0;
    }
    #console-panel-build {
      min-height: 0;
      height: 100%;
      align-content: stretch;
    }
    #console-panel-build > .card {
      min-height: 0;
      height: 100%;
      display: grid;
      grid-template-rows: minmax(0, 1fr);
    }
    #console-panel-build > .card > .body {
      min-height: 0;
      height: 100%;
      display: grid;
      overflow: hidden;
      padding: 0;
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
    .project-home-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(220px, 0.56fr);
      gap: 10px;
      align-items: start;
      min-width: 0;
    }
    .project-home-main,
    .project-side-panel {
      display: grid;
      gap: 10px;
      min-width: 0;
    }
    .project-home-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      min-width: 0;
    }
    .project-home-overview-grid {
      display: grid;
      grid-template-columns: minmax(260px, 0.92fr) minmax(0, 1.25fr);
      gap: 10px;
      min-width: 0;
      align-items: start;
    }
    .project-home-overview-sections {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .project-home-info-strip {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      min-width: 0;
    }
    .project-home-info-item {
      display: grid;
      gap: 3px;
      min-width: 0;
      padding: 9px 10px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background:
        linear-gradient(180deg, rgba(56, 189, 248, 0.06), rgba(56, 189, 248, 0.02)),
        rgba(255, 255, 255, 0.02);
    }
    .project-home-info-label {
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .project-home-info-value {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      color: #f8fbff;
    }
    .project-home-section {
      display: grid;
      gap: 7px;
      min-width: 0;
      padding: 8px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.025);
    }
    .project-home-section h4 {
      margin: 0;
      color: #dbeafe;
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .project-home-section .structure-list {
      gap: 6px;
    }
    .project-home-side-note {
      display: grid;
      gap: 4px;
      padding: 8px;
      border-radius: 10px;
      border: 1px solid rgba(56, 189, 248, 0.2);
      background: rgba(56, 189, 248, 0.06);
    }
    .project-home-recent-runs-inline {
      gap: 6px;
      padding-top: 2px;
      border-top: 1px solid rgba(148, 163, 184, 0.12);
    }
    .project-home-recent-runs-inline > .hint {
      margin-top: 2px;
    }
    .project-home-card .event,
    .project-home-section .event,
    .project-home-side-note .event {
      padding: 8px 9px;
      gap: 4px;
    }
    .project-home-card .body {
      min-width: 0;
    }
    .studio-bridge,
    .studio-bridge-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      align-items: stretch;
      min-width: 0;
      min-height: 0;
      height: 100%;
    }
    .studio-graph-column { grid-column: 1 / -1; }
    .studio-bridge-index {
      min-width: 0;
      height: 100%;
    }
    .studio-index-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(240px, 1fr));
      gap: 12px;
      align-items: start;
      min-width: 0;
    }
    .studio-index-stack {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      min-width: 0;
    }
    .studio-navigator,
    .studio-graph-column {
      min-width: 0;
    }
    .studio-graph-column {
      display: grid;
      gap: 8px;
      min-height: 0;
      height: 100%;
    }
    .studio-diagnostics {
      min-width: 0;
    }
    .studio-canvas-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      grid-template-rows: auto minmax(0, 1fr);
      gap: 0;
      min-width: 0;
      position: relative;
      min-height: 100%;
      height: 100%;
      align-items: stretch;
      overflow: hidden;
    }
    .studio-canvas-shell.has-docked-selection {
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
    }
    .studio-canvas-shell.has-docked-selection.has-collapsed-selection {
      grid-template-columns: minmax(0, 1fr) 56px;
    }
    .studio-canvas-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border);
      background: rgba(7, 12, 24, 0.9);
      position: sticky;
      top: 0;
      z-index: 3;
      min-width: 0;
      grid-column: 1 / -1;
      grid-row: 1;
    }
    .studio-canvas-toolbar > div {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .studio-graph-selection-label {
      font-size: 11px;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: min(100%, 42ch);
    }
    .studio-graph-root,
    .studio-selection-overlay {
      min-width: 0;
      min-height: 0;
      height: 100%;
    }
    .studio-outline-panel {
      display: grid;
      align-content: start;
      gap: 8px;
      height: 100%;
      padding: 10px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(8, 13, 26, 0.94), rgba(12, 20, 38, 0.92));
      overflow: auto;
    }
    .studio-canvas-toolbar-slot {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      min-width: 0;
      flex: 0 1 auto;
    }
    .studio-canvas-toolbar-slot .workbench-view-tabs {
      margin-left: 0;
      padding-left: 3px;
      background: rgba(148, 163, 184, 0.08);
    }
    .build-footer {
      display: flex;
      justify-content: flex-end;
      padding-top: 8px;
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
    .studio-canvas-shell.is-fullscreen .studio-graph-island,
    .studio-canvas-shell.is-fullscreen .studio-selection-overlay {
      min-height: calc(100dvh - 108px);
    }
    .studio-graph-root {
      grid-column: 1 / 2;
      grid-row: 2;
      align-self: stretch;
      padding: 8px 10px;
      overflow: hidden;
    }
    .studio-source-root {
      display: grid;
      min-height: 0;
      height: 100%;
    }
    .studio-source-panel {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 8px;
      min-height: 0;
      height: 100%;
      padding: 10px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: linear-gradient(180deg, rgba(8, 13, 26, 0.94), rgba(15, 23, 42, 0.88));
    }
    .studio-source-panel .editor {
      min-height: 0;
      height: 100%;
      resize: none;
    }
    .studio-canvas-shell.has-docked-selection .studio-graph-root {
      grid-column: 1 / 2;
      grid-row: 2;
    }
    .studio-selection-overlay[hidden] {
      display: none;
    }
    .studio-selection-overlay {
      grid-column: 2 / 3;
      grid-row: 2;
      position: relative;
      z-index: 1;
      display: grid;
      justify-items: stretch;
      align-items: stretch;
      pointer-events: auto;
      padding: 8px 0 8px 8px;
      border-left: 1px solid rgba(148, 163, 184, 0.12);
      overflow: hidden;
    }
    .studio-selection-overlay.is-open {
      pointer-events: auto;
    }
    .studio-selection-overlay.is-docked {
      pointer-events: auto;
    }
    .studio-selection-overlay.is-docked .studio-selection-dialog {
      pointer-events: auto;
    }
    .studio-canvas-shell.has-docked-selection .studio-selection-overlay.is-docked .studio-selection-dialog {
      width: 100%;
      max-width: 100%;
      height: 100%;
      max-height: 100%;
      min-height: 100%;
      box-shadow: none;
      align-self: stretch;
    }
    .studio-selection-backdrop {
      display: none;
    }
    .studio-selection-dialog {
      position: relative;
      width: 100%;
      max-width: 100%;
      height: 100%;
      max-height: 100%;
      min-height: 0;
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-left: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(5, 10, 23, 0.98), rgba(10, 18, 36, 0.96));
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.24);
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      pointer-events: auto;
      overflow: hidden;
    }
    .studio-selection-overlay.is-collapsed .studio-selection-dialog {
      width: 56px;
      max-width: 56px;
      height: 100%;
      max-height: 100%;
      border-left: 1px solid rgba(148, 163, 184, 0.18);
    }
    .studio-selection-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 6px;
      padding: 6px 8px 4px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    }
    .studio-selection-body {
      padding: 4px 8px 8px;
      min-height: 0;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      display: block;
      gap: 8px;
      scrollbar-gutter: stable;
      overscroll-behavior: contain;
    }
    .studio-selection-tabstrip {
      margin: 0 8px;
      width: fit-content;
      max-width: calc(100% - 16px);
    }
    .studio-selection-panels {
      min-height: 0;
    }
    .studio-selection-panel {
      min-height: 0;
      overflow: visible;
      display: grid;
      align-content: start;
      align-self: stretch;
      gap: 8px;
    }
    .studio-selection-title-wrap strong {
      display: block;
      font-size: 12px;
      line-height: 1.25;
    }
    .studio-selection-debug-panel {
      grid-auto-rows: max-content;
    }
    .studio-selection-title-wrap {
      min-width: 0;
    }
    .studio-selection-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .studio-selection-dialog .button {
      min-height: 26px;
      padding: 3px 7px;
    }
    .studio-selection-tabstrip .button {
      min-height: 26px;
      padding: 3px 7px;
      font-size: 11px;
    }
    .studio-bridge-index-controls {
      display: grid;
      gap: 6px;
      padding-bottom: 2px;
    }
    .studio-index-section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 2px 0;
      border: 0;
      background: transparent;
    }
    .studio-index-section-heading strong {
      font-size: 11px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: #c9d6ec;
    }
    .studio-index-section-heading .hint {
      font-size: 11px;
    }
    .studio-selection-panel .event,
    .studio-selection-panel .run-card,
    .studio-selection-panel .compact-list-item {
      padding: 7px 8px;
    }
    .studio-selection-role-package:empty {
      display: none;
    }
    .studio-selection-structure-panel .studio-index-grid {
      grid-template-columns: 1fr;
    }
    .studio-outline-panel .studio-bridge-index,
    .studio-selection-structure-panel .studio-bridge-index {
      height: 100%;
    }
    .studio-outline-panel .studio-index-grid,
    .studio-selection-structure-panel .studio-index-grid {
      grid-template-columns: 1fr;
      align-content: start;
    }
    .studio-outline-panel .studio-navigator,
    .studio-outline-panel .studio-flow-list,
    .studio-selection-structure-panel .studio-navigator,
    .studio-selection-structure-panel .studio-flow-list {
      max-height: none;
    }
    .studio-selection-role-package .form-grid {
      max-height: none;
      overflow: visible;
      padding-right: 0;
    }
    .studio-execution-config-editor textarea {
      min-height: 96px;
    }
    .studio-flow-config-editor .field.checkbox {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 38px;
    }
    .studio-flow-config-editor .field.checkbox input {
      width: auto;
      margin: 0;
    }
    .studio-flow-config-diagnostics {
      display: grid;
      gap: 4px;
    }
    .studio-execution-config-editor .field input[readonly] {
      opacity: 0.9;
      cursor: default;
    }
    .studio-selection-command-host {
      min-height: 0;
    }
    .studio-selection-command-host .studio-command-dialog {
      box-shadow: none;
      border-color: rgba(148, 163, 184, 0.2);
    }
    .studio-selection-overlay.is-collapsed .studio-selection-title-wrap,
    .studio-selection-overlay.is-collapsed .studio-selection-body,
    .studio-selection-overlay.is-collapsed [data-studio-selection-pin],
    .studio-selection-overlay.is-collapsed [data-studio-selection-close] {
      display: none;
    }
    .studio-selection-overlay.is-collapsed .studio-selection-header {
      padding: 8px 6px;
      border-bottom: 0;
    }
    .studio-selection-overlay.is-collapsed .studio-selection-actions {
      width: 100%;
      justify-content: center;
    }
    .studio-selection-overlay.is-collapsed [data-studio-selection-collapse] {
      width: 42px;
      min-width: 42px;
      padding: 6px 0;
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
    .artifact-section-collapsed {
      gap: 6px;
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
      gap: 8px;
      min-width: 0;
    }
    .release-group {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .release-group h4 {
      margin: 0;
      color: #dbeafe;
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .release-checklist .event,
    .release-checklist .compact-list-item {
      padding: 8px 9px;
    }
    .release-checklist .disclosure-summary {
      padding: 8px 9px;
    }
    .release-checklist .disclosure-hint,
    .release-checklist .disclosure-body,
    .release-checklist .compact-list {
      padding-left: 9px;
      padding-right: 9px;
      padding-bottom: 9px;
    }
    .debug-graph-body {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(360px, 0.82fr);
      align-items: start;
      gap: 10px;
      min-width: 0;
    }
    .operate-graph-main,
    .operate-graph-sidebar,
    .operate-graph-view,
    .operate-graph-state {
      min-width: 0;
    }
    .operate-graph-main,
    .operate-graph-sidebar {
      display: grid;
      gap: 8px;
      align-content: start;
    }
    .operate-graph-sidebar {
      position: relative;
    }
    .operate-graph-state {
      gap: 10px;
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
    .run-role-matrix {
      display: grid;
      gap: 0;
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(4, 8, 16, 0.42);
    }
    .run-role-matrix-head,
    .run-role-matrix-row {
      display: grid;
      grid-template-columns: minmax(120px, 0.78fr) minmax(120px, 0.72fr) minmax(0, 1.15fr) minmax(0, 1.15fr);
      min-width: 0;
    }
    .run-role-matrix-head {
      background: rgba(255, 255, 255, 0.04);
      color: #dbeafe;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .run-role-matrix-row + .run-role-matrix-row {
      border-top: 1px solid var(--border);
    }
    .run-role-cell {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 10px;
      border-right: 1px solid rgba(148, 163, 184, 0.12);
      align-content: start;
    }
    .run-role-matrix-head .run-role-cell {
      padding-top: 8px;
      padding-bottom: 8px;
    }
    .run-role-matrix-head .run-role-cell:last-child,
    .run-role-matrix-row .run-role-cell:last-child {
      border-right: 0;
    }
    .run-role-cell strong,
    .run-role-cell code {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .run-role-cell-summary {
      color: var(--text);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .run-role-cell .hint {
      font-size: 11px;
    }
    .run-role-cell details {
      margin-top: 2px;
    }
    .run-role-cell summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 11px;
    }
    .state-panel {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .state-card-grid-primary {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
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
    .studio-debug-panel-stack {
      gap: 8px;
    }
    .studio-debug-launch-panel {
      margin-bottom: -2px;
    }
    .studio-debug-form-grid {
      gap: 6px;
    }
    .studio-selection-debug-panel .field textarea {
      min-height: 88px;
    }
    .studio-selection-debug-panel .event,
    .studio-selection-debug-panel .compact-list-item {
      padding: 8px 9px;
    }
    .studio-selection-result-panel .disclosure-body {
      max-height: min(58vh, calc(100dvh - 320px));
      overflow: auto;
      padding-right: 4px;
    }
    .studio-result-summary-grid {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .state-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      min-width: 0;
    }
    .run-graph-summary-rail {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .disclosure {
      gap: 0;
      padding: 0;
      overflow: hidden;
    }
    .disclosure-summary {
      list-style: none;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 10px;
      cursor: pointer;
    }
    .disclosure-summary::-webkit-details-marker {
      display: none;
    }
    .disclosure-summary-copy {
      display: grid;
      gap: 4px;
      min-width: 0;
      flex: 1 1 auto;
    }
    .disclosure-kicker {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .disclosure-meta {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .disclosure-hint,
    .disclosure-body {
      padding: 0 10px 10px;
    }
    .disclosure-body {
      display: grid;
      gap: 8px;
    }
    .compact-list {
      display: grid;
      gap: 6px;
      padding: 0 10px 10px;
    }
    .compact-list-item {
      display: grid;
      gap: 4px;
      padding: 7px 8px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(148, 163, 184, 0.14);
      min-width: 0;
    }
    .compact-list-title {
      font-size: 13px;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .compact-list-meta {
      color: var(--muted);
      font-size: 12px;
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
    .studio-log-lanes {
      min-width: 0;
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 12px;
      background: rgba(7, 12, 24, 0.45);
    }
    .studio-log-lanes-scroll {
      overflow: auto;
      max-height: 460px;
    }
    .studio-log-lane-header,
    .studio-log-lane-row {
      display: grid;
      gap: 8px;
      align-items: stretch;
      min-width: 0;
      padding: 8px;
    }
    .studio-log-lane-header {
      position: sticky;
      top: 0;
      z-index: 1;
      background: rgba(5, 10, 23, 0.96);
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    }
    .studio-log-lanes-body {
      max-height: none;
      overflow: visible;
      padding: 0;
      gap: 0;
    }
    .studio-log-time-cell,
    .studio-log-lane-heading {
      min-width: 0;
      display: grid;
      align-content: start;
    }
    .studio-log-time-cell {
      padding-top: 4px;
    }
    .studio-log-lane-cell {
      min-width: 0;
      min-height: 18px;
    }
    .studio-log-lane-cell.is-empty {
      border-radius: 10px;
      border: 1px dashed rgba(148, 163, 184, 0.1);
      background: rgba(148, 163, 184, 0.03);
    }
    .studio-log-lane-card {
      min-height: 100%;
    }
    .studio-role-io-modal-root {
      position: fixed;
      inset: 0;
      z-index: 120;
      display: grid;
      place-items: center;
      padding: 18px;
    }
    .studio-role-io-backdrop {
      position: absolute;
      inset: 0;
      border: 0;
      background: rgba(2, 6, 23, 0.72);
      cursor: pointer;
    }
    .studio-role-io-dialog {
      position: relative;
      z-index: 1;
      width: min(920px, calc(100vw - 36px));
      max-height: min(86vh, 920px);
      overflow: hidden;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      border-radius: 16px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: linear-gradient(180deg, rgba(5, 10, 23, 0.98), rgba(10, 18, 36, 0.98));
      box-shadow: 0 30px 100px rgba(0, 0, 0, 0.5);
    }
    .studio-role-io-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
    }
    .studio-role-io-body {
      display: grid;
      gap: 12px;
      overflow: auto;
      padding: 14px 16px 16px;
    }
    .studio-role-io-body pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(2, 6, 23, 0.66);
      border: 1px solid rgba(148, 163, 184, 0.14);
      max-height: 240px;
      overflow: auto;
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
    .event.warn,
    .event.warning {
      border-color: rgba(251, 191, 36, 0.24);
      background: rgba(251, 191, 36, 0.08);
    }
    .event.blocker,
    .event.critical {
      border-color: rgba(248, 113, 113, 0.28);
      background: rgba(248, 113, 113, 0.1);
    }
    .event.notice {
      border-color: rgba(56, 189, 248, 0.24);
      background: rgba(56, 189, 248, 0.08);
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
    .event strong.severity-critical {
      color: #fecaca;
    }
    .event strong.severity-warning {
      color: #fde68a;
    }
    .event strong.severity-info {
      color: #bae6fd;
    }
    .event code {
      color: #9be7ff;
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
    }
    .event-top .severity-critical,
    .hint.severity-critical {
      color: #fca5a5;
      font-weight: 600;
    }
    .event-top .severity-warning,
    .hint.severity-warning {
      color: #fcd34d;
      font-weight: 600;
    }
    .event-top .severity-info,
    .hint.severity-info {
      color: #7dd3fc;
      font-weight: 600;
    }
    .project-create-stage-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .project-create-stage-item {
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      background: rgba(255, 255, 255, 0.03);
    }
    .project-create-stage-item.active {
      border-color: rgba(56, 189, 248, 0.3);
      background: rgba(56, 189, 248, 0.1);
    }
    .project-create-stage-item.done {
      border-color: rgba(52, 211, 153, 0.2);
      background: rgba(52, 211, 153, 0.08);
    }
    .project-create-stage-item.pending {
      opacity: 0.8;
    }
    .project-create-stage-item .event-top {
      margin-bottom: 4px;
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
      body.show-run-sidebar .shell.content,
      .shell.content { grid-template-columns: 1fr; }
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
      .studio-index-grid { grid-template-columns: 1fr; }
      .studio-canvas-shell.has-docked-selection {
        grid-template-columns: 1fr;
      }
      .studio-canvas-shell {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(360px, 1fr) minmax(260px, auto);
      }
      .studio-canvas-shell.has-docked-selection .studio-canvas-toolbar,
      .studio-canvas-shell.has-docked-selection .studio-graph-root,
      .studio-canvas-shell.has-docked-selection .studio-selection-overlay.is-docked {
        grid-column: 1 / -1;
      }
      .studio-graph-root {
        grid-column: 1 / -1;
        grid-row: 2;
        padding: 8px 0;
      }
      .studio-navigator { order: 3; }
      .studio-flow-list {
        order: 4;
        max-height: 520px;
        overflow: auto;
        padding-right: 2px;
      }
      .studio-diagnostics { order: 5; }
      .studio-selection-overlay {
        grid-column: 1 / -1;
        grid-row: 3;
        padding: 8px 0 0;
        border-left: 0;
        border-top: 1px solid rgba(148, 163, 184, 0.12);
      }
      .studio-canvas-shell.has-docked-selection .studio-selection-overlay.is-docked {
        position: relative;
        inset: auto;
        height: 100%;
      }
      .studio-selection-dialog {
        width: 100%;
        max-width: 100%;
        max-height: 100%;
        height: 100%;
        border-left: 1px solid rgba(148, 163, 184, 0.18);
        border-top: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: none;
      }
      .top-nav-row {
        align-items: flex-start;
      }
      .top-nav-brand {
        flex: 1 1 auto;
      }
      .top-nav-center {
        flex: 1 1 100%;
      }
      .top-nav-actions {
        margin-left: auto;
      }
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
      .project-home-layout,
      .project-home-grid,
      .project-home-overview-grid {
        grid-template-columns: 1fr;
      }
      .project-home-info-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .run-role-matrix-head,
      .run-role-matrix-row {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .global-status {
        flex-wrap: wrap;
      }
      .global-status-primary,
      .global-status-actions {
        width: 100%;
      }
    }
    @media (max-width: 960px) {
      .content { padding: 12px; }
      .top-nav {
        padding: 10px 12px;
      }
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
      .run-role-matrix-head {
        display: none;
      }
      .run-role-matrix-row {
        grid-template-columns: 1fr;
      }
      .run-role-cell {
        border-right: 0;
      }
      .run-role-cell + .run-role-cell {
        border-top: 1px solid rgba(148, 163, 184, 0.12);
      }
      .button {
        width: 100%;
      }
      .top-nav .button,
      .console-tabs .button,
      .segmented .button,
      .build-control-bar .actions .button,
      .hero-toolbar .button {
        width: auto;
      }
      .hero-toolbar .button {
        width: auto;
      }
      .top-nav-actions {
        justify-content: flex-start;
        margin-left: 0;
      }
      .build-header {
        align-items: flex-start;
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
      .studio-graph-root {
        min-height: clamp(430px, 68vh, 760px);
      }
      .project-home-info-strip {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 768px) {
      .content { padding: 10px; }
      .top-nav {
        padding: 9px 10px;
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
      .top-nav-row,
      .toolbar-row,
      .workbench-source-actions,
      .row {
        display: grid;
        grid-template-columns: 1fr;
      }
      .top-nav-brand,
      .top-nav-center,
      .top-nav-actions,
      .build-header,
      .build-control-primary,
      .build-control-bar {
        display: grid;
        grid-template-columns: 1fr;
      }
      .top-nav-center .hero-utilities {
        justify-self: stretch;
      }
      .top-nav-actions,
      .build-control-bar #workbench-status,
      .build-control-bar #workbench-actions {
        justify-content: flex-start;
      }
      .build-command-stack {
        justify-items: stretch;
      }
      .console-tabs {
        min-width: 0;
      }
      .top-nav-meta .pill,
      .build-control-bar #workbench-status .pill {
        max-width: 100%;
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
      .disclosure-summary {
        display: grid;
        grid-template-columns: 1fr;
      }
      pre,
      .timeline {
        max-height: 320px;
      }
      .global-status {
        gap: 6px;
      }
      .global-status-primary,
      .global-status-actions {
        flex-wrap: wrap;
      }
    }
    @media (max-width: 480px) {
      .content { padding: 8px; }
      .top-nav {
        padding: 8px;
      }
      .sidebar {
        width: calc(100vw - 18px);
      }
      .button {
        min-width: 0;
        padding: 8px 10px;
      }
      .top-nav-actions,
      .hero-actions,
      .hero-utilities,
      .build-control-bar #workbench-actions {
        display: grid;
        grid-template-columns: 1fr;
      }
      .run-card,
      .event,
      pre,
      .preview,
      .editor {
        border-radius: 9px;
      }
    }
    .button:focus-visible,
    .run-card:focus-visible,
    .search:focus-visible,
    .select:focus-visible,
    .segmented .button:focus-visible,
    .console-tabs .button:focus-visible {
      outline: 2px solid rgba(56, 189, 248, 0.7);
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
`;
}
