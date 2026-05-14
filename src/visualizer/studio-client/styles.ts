const STYLE_ID = "ogs-studio-graph-island-styles";

export function injectStudioGraphStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .studio-graph-island {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 390px;
      height: 100%;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(4, 8, 16, 0.54);
      min-width: 0;
      overflow: hidden;
    }
    .studio-canvas-shell.is-fullscreen .studio-graph-island {
      height: calc(100vh - 108px);
    }
    .studio-graph-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 5px 6px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
      background:
        linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(8, 13, 26, 0.76));
      backdrop-filter: blur(14px);
      min-width: 0;
    }
    .studio-graph-toolbar-main {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .studio-graph-toolbar-group {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 3px;
      min-width: 0;
      padding: 2px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      background: rgba(255, 255, 255, 0.035);
    }
    .studio-graph-toolbar-group[hidden],
    .studio-graph-toolbar button[hidden] {
      display: none;
    }
    .studio-graph-toolbar button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      border: 1px solid transparent;
      background: transparent;
      color: #e5eefb;
      padding: 4px 6px;
      min-width: 28px;
      min-height: 28px;
      cursor: pointer;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    .studio-graph-toolbar button:hover {
      border-color: rgba(56, 189, 248, 0.32);
      background: rgba(56, 189, 248, 0.13);
      color: #bae6fd;
    }
    .studio-graph-toolbar button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .studio-graph-status {
      color: #8fa1c3;
      font-size: 12px;
      flex: 0 1 auto;
      overflow-wrap: anywhere;
    }
    .studio-graph-toolbar-icon {
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
    }
    .studio-graph-toolbar-text {
      font-size: 10px;
    }
    @media (max-width: 720px) {
      .studio-graph-toolbar {
        align-items: stretch;
        flex-direction: column;
      }
      .studio-graph-toolbar-main {
        overflow-x: auto;
      }
      .studio-graph-toolbar-text {
        display: none;
      }
      .studio-graph-quick-debug {
        inset: auto 12px 12px 12px;
        width: auto;
      }
    }
    .studio-graph-stage {
      min-height: 320px;
      height: 100%;
      min-width: 0;
      position: relative;
      overflow: hidden;
    }
    .studio-graph-canvas {
      min-height: 320px;
      width: 100%;
      height: 100%;
      min-width: 0;
      position: relative;
    }
    .studio-graph-canvas .x6-graph-svg,
    .studio-graph-canvas svg {
      width: 100% !important;
      height: 100% !important;
      inset: 0;
    }
    .studio-graph-canvas .x6-node .x6-port-body {
      transition: stroke 140ms ease, fill 140ms ease, opacity 140ms ease;
    }
    .studio-graph-canvas .x6-node .x6-port-body,
    .studio-graph-canvas .x6-node [data-studio-port] {
      vector-effect: non-scaling-stroke;
    }
    .studio-graph-canvas .x6-node:hover rect,
    .studio-graph-canvas .x6-node:hover path:first-of-type {
      stroke: #7dd3fc;
    }
    .studio-graph-canvas .x6-node.is-selection-active rect,
    .studio-graph-canvas .x6-node.is-selection-active path:first-of-type {
      filter: drop-shadow(0 0 0.35rem rgba(56, 189, 248, 0.32));
      stroke: #38bdf8;
    }
    .studio-graph-canvas .x6-node.is-selection-focus-pulse rect,
    .studio-graph-canvas .x6-node.is-selection-focus-pulse path:first-of-type {
      animation: studio-node-focus-pulse 820ms ease-out 1;
    }
    .studio-graph-canvas .x6-node rect,
    .studio-graph-canvas .x6-node path:first-of-type {
      transition: filter 220ms ease, stroke 220ms ease, opacity 220ms ease;
    }
    .studio-graph-canvas .x6-node.is-runtime-active rect,
    .studio-graph-canvas .x6-node.is-runtime-active path:first-of-type {
      filter: drop-shadow(0 0 0.55rem rgba(56, 189, 248, 0.22));
      animation: studio-node-active-pulse 2400ms ease-in-out infinite;
    }
    .studio-graph-canvas .x6-node[data-runtime-status="failed"] rect,
    .studio-graph-canvas .x6-node[data-runtime-status="failed"] path:first-of-type {
      animation: studio-node-error-shake 400ms ease-out 1;
    }
    .studio-graph-canvas .x6-node.is-runtime-waiting-review rect,
    .studio-graph-canvas .x6-node.is-runtime-waiting-review path:first-of-type {
      animation: studio-human-gate-pulse 2200ms ease-in-out infinite;
    }
    .studio-graph-canvas .x6-node.has-human-gate:not(.is-runtime-waiting-review) rect,
    .studio-graph-canvas .x6-node.has-human-gate:not(.is-runtime-waiting-review) path:first-of-type {
      stroke-dasharray: 8 4;
    }
    .studio-graph-canvas .x6-edge .connection {
      transition: stroke 160ms ease, stroke-width 160ms ease, opacity 160ms ease, stroke-dasharray 160ms ease;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .studio-graph-canvas .x6-edge:hover .connection {
      stroke-width: 2.1px !important;
    }
    .studio-graph-canvas .x6-edge.is-selection-active .connection {
      stroke-width: 2.6px !important;
      filter: drop-shadow(0 0 0.3rem rgba(56, 189, 248, 0.25));
    }
    .studio-graph-canvas .x6-edge.is-pending-preview .connection {
      stroke: #38bdf8 !important;
      stroke-width: 2px !important;
      stroke-dasharray: 7 5;
      filter: drop-shadow(0 0 0.22rem rgba(56, 189, 248, 0.2));
      animation: studio-edge-flow 760ms linear infinite;
      opacity: 0.95;
    }
    .studio-graph-canvas .x6-edge.is-pending-preview .x6-edge-label rect {
      stroke: #38bdf8;
      stroke-dasharray: 6 4;
    }
    .studio-graph-canvas .x6-edge.is-runtime-active .connection {
      stroke-width: 2.5px !important;
      stroke-dasharray: 10 10;
      filter: drop-shadow(0 0 0.32rem rgba(56, 189, 248, 0.24));
      animation: studio-edge-flow 680ms linear infinite;
    }
    .studio-graph-canvas .x6-edge.is-runtime-error .connection {
      stroke-dasharray: 7 5;
    }
    .studio-graph-canvas .x6-edge.is-loop-back .connection {
      stroke-dasharray: 5 6;
    }
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-selection-focus-pulse rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-selection-focus-pulse path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-active rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-active path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node[data-runtime-status="failed"] rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node[data-runtime-status="failed"] path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-waiting-review rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-waiting-review path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-edge.is-pending-preview .connection,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-edge.is-runtime-active .connection {
      animation: none !important;
    }
    @keyframes studio-node-focus-pulse {
      0% {
        transform: scale(1);
      }
      28% {
        transform: scale(1.025);
      }
      100% {
        transform: scale(1);
      }
    }
    @keyframes studio-edge-flow {
      from {
        stroke-dashoffset: 18;
      }
      to {
        stroke-dashoffset: 0;
      }
    }
    @keyframes studio-human-gate-pulse {
      0%,
      100% {
        filter: drop-shadow(0 0 0 rgba(251, 191, 36, 0));
      }
      50% {
        filter: drop-shadow(0 0 0.45rem rgba(251, 191, 36, 0.32));
      }
    }
    @keyframes studio-node-active-pulse {
      0%, 100% {
        filter: drop-shadow(0 0 0.35rem rgba(56, 189, 248, 0.15));
      }
      50% {
        filter: drop-shadow(0 0 0.7rem rgba(56, 189, 248, 0.35));
      }
    }
    @keyframes studio-node-error-shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-2px); }
      40% { transform: translateX(2px); }
      60% { transform: translateX(-1.5px); }
      80% { transform: translateX(1px); }
    }
    .studio-graph-empty {
      display: grid;
      place-items: center;
      position: absolute;
      inset: 0;
      z-index: 2;
      padding: 24px;
      text-align: center;
      color: #8fa1c3;
      font-size: 13px;
      background: rgba(4, 8, 16, 0.76);
    }
    .studio-graph-empty[hidden] {
      display: none;
    }
    .studio-graph-diagnostic-card {
      position: absolute;
      z-index: 6;
      max-width: 320px;
      padding: 10px 12px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 10px;
      background: rgba(8, 13, 26, 0.96);
      color: #dbeafe;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.36);
      pointer-events: none;
      display: grid;
      gap: 6px;
      font-size: 12px;
      line-height: 1.45;
    }
    .studio-graph-diagnostic-card[hidden] {
      display: none;
    }
    .studio-graph-minimap {
      position: absolute;
      right: 14px;
      bottom: 14px;
      width: 180px;
      height: 120px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 10px;
      background: rgba(8, 13, 26, 0.92);
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.24);
      overflow: hidden;
      z-index: 4;
      pointer-events: auto;
      cursor: pointer;
    }
    .studio-graph-minimap[hidden] {
      display: none;
    }
    .studio-graph-minimap-content {
      position: absolute;
      inset: 8px;
      overflow: hidden;
    }
    .studio-graph-minimap-edges {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .studio-graph-minimap-edges line {
      stroke: rgba(148, 163, 184, 0.35);
      stroke-width: 0.6;
    }
    .studio-graph-minimap-node {
      position: absolute;
      min-width: 4px;
      min-height: 6px;
      border-radius: 3px;
      background: rgba(56, 189, 248, 0.55);
      border: 1px solid rgba(186, 230, 253, 0.4);
    }
    .studio-graph-minimap-node.is-boundary {
      background: rgba(100, 116, 139, 0.45);
      border-color: rgba(148, 163, 184, 0.4);
      border-style: dashed;
      border-radius: 2px;
    }
    .studio-graph-minimap-node.is-selected {
      background: rgba(56, 189, 248, 0.85);
      border-color: rgba(186, 230, 253, 0.8);
      box-shadow: 0 0 4px rgba(56, 189, 248, 0.5);
    }
    .studio-graph-minimap-viewport {
      position: absolute;
      border: 1px solid rgba(56, 189, 248, 0.9);
      background: rgba(56, 189, 248, 0.08);
      border-radius: 6px;
      box-shadow: inset 0 0 0 1px rgba(186, 230, 253, 0.22);
      pointer-events: none;
    }
    .studio-graph-context-menu {
      position: absolute;
      z-index: 8;
      display: grid;
      gap: 4px;
      min-width: 152px;
      padding: 6px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 12px;
      background: rgba(8, 13, 26, 0.97);
      box-shadow: 0 18px 36px rgba(0, 0, 0, 0.34);
      backdrop-filter: blur(12px);
    }
    .studio-graph-context-menu[hidden] {
      display: none;
    }
    .studio-graph-context-menu-item {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      width: 100%;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: #e5eefb;
      padding: 8px 10px;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
    }
    .studio-graph-context-menu-item:hover {
      border-color: rgba(56, 189, 248, 0.34);
      background: rgba(56, 189, 248, 0.12);
      color: #bae6fd;
    }
    .studio-graph-context-menu-item.is-destructive:hover {
      border-color: rgba(248, 113, 113, 0.36);
      background: rgba(248, 113, 113, 0.12);
      color: #fecaca;
    }
    .studio-graph-context-menu-item:disabled {
      opacity: 0.42;
      cursor: not-allowed;
    }
    .studio-graph-quick-open {
      position: absolute;
      inset: 16px auto auto 16px;
      z-index: 7;
      width: min(420px, calc(100% - 32px));
    }
    .studio-graph-quick-open[hidden] {
      display: none;
    }
    .studio-graph-quick-open-panel {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 12px;
      background: rgba(8, 13, 26, 0.96);
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.34);
    }
    .studio-graph-quick-open-label {
      font-size: 12px;
      color: #8fa1c3;
    }
    .studio-graph-quick-open-input {
      width: 100%;
      min-width: 0;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(4, 8, 16, 0.92);
      color: #e5eefb;
      padding: 9px 10px;
      box-sizing: border-box;
    }
    .studio-graph-quick-open-results {
      display: grid;
      gap: 6px;
      max-height: 240px;
      overflow: auto;
    }
    .studio-graph-quick-open-item {
      display: grid;
      gap: 3px;
      width: 100%;
      text-align: left;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(255, 255, 255, 0.03);
      color: #e5eefb;
      padding: 9px 10px;
      cursor: pointer;
    }
    .studio-graph-quick-open-item.is-active,
    .studio-graph-quick-open-item:hover {
      border-color: rgba(56, 189, 248, 0.4);
      background: rgba(56, 189, 248, 0.12);
      color: #bae6fd;
    }
    .studio-graph-quick-open-kind,
    .studio-graph-quick-open-empty {
      font-size: 11px;
      color: #8fa1c3;
    }
    .studio-graph-quick-debug {
      position: absolute;
      inset: 16px 16px auto auto;
      z-index: 7;
      width: min(380px, calc(100% - 32px));
    }
    .studio-graph-quick-debug[hidden] {
      display: none;
    }
    .studio-graph-quick-debug-panel {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 12px;
      background: rgba(8, 13, 26, 0.96);
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.34);
    }
    .studio-graph-quick-debug-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .studio-graph-quick-debug-label {
      font-size: 12px;
      color: #8fa1c3;
    }
    .studio-graph-quick-debug-input {
      width: 100%;
      min-width: 0;
      min-height: 104px;
      box-sizing: border-box;
      resize: vertical;
    }
    .studio-graph-quick-debug-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }
    .studio-graph-quick-debug-hint {
      margin-top: -2px;
    }
    .studio-graph-stage.is-empty .studio-graph-canvas {
      opacity: 0.34;
    }
    .studio-command-dialog {
      width: 100%;
      max-width: 100%;
      overflow: auto;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: rgba(8, 13, 26, 0.96);
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.36);
    }
    .studio-command-dialog[hidden] {
      display: none;
    }
    .studio-command-form {
      display: grid;
      gap: 10px;
      padding: 12px;
      color: #dbeafe;
      font-size: 13px;
    }
    .studio-command-form-header,
    .studio-command-form-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .studio-command-form-header button,
    .studio-command-form-actions button {
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(255, 255, 255, 0.05);
      color: #e5eefb;
      padding: 7px 10px;
      cursor: pointer;
    }
    .studio-command-form-actions button {
      background: rgba(56, 189, 248, 0.16);
      border-color: rgba(56, 189, 248, 0.36);
    }
    .studio-command-form-actions button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .studio-command-form-row {
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    .studio-command-form-row.segmented {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .studio-command-form-row.segmented label,
    .studio-command-form-check {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .studio-command-form input,
    .studio-command-form select {
      width: 100%;
      min-width: 0;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(4, 8, 16, 0.88);
      color: #e5eefb;
      padding: 8px;
      box-sizing: border-box;
    }
    .studio-command-form input[type="radio"],
    .studio-command-form input[type="checkbox"] {
      width: auto;
      flex: 0 0 auto;
    }
    .studio-command-form-error,
    .studio-command-form-diagnostic {
      color: #fecaca;
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .studio-command-form-diagnostics {
      display: grid;
      gap: 6px;
    }
    .studio-command-form-diagnostic.warning {
      color: #fde68a;
    }
    .studio-command-form-diagnostic.info {
      color: #bae6fd;
    }
  `;
  document.head.appendChild(style);
}
