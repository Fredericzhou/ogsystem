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
      grid-template-rows: auto minmax(320px, 1fr);
      min-height: 390px;
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
      padding: 7px;
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
      gap: 7px;
      min-width: 0;
    }
    .studio-graph-toolbar-group {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 3px;
      min-width: 0;
      padding: 3px;
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
      padding: 5px 7px;
      min-width: 30px;
      min-height: 30px;
      cursor: pointer;
      font-size: 12px;
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
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
    }
    .studio-graph-toolbar-text {
      font-size: 11px;
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
    }
    .studio-graph-stage {
      min-height: 320px;
      min-width: 0;
      position: relative;
    }
    .studio-graph-canvas {
      min-height: 320px;
      min-width: 0;
      position: relative;
    }
    .studio-graph-canvas .x6-node .x6-port-body {
      transition: stroke 140ms ease, fill 140ms ease, opacity 140ms ease;
    }
    .studio-graph-canvas .x6-node .x6-port-body,
    .studio-graph-canvas .x6-node [data-studio-port] {
      vector-effect: non-scaling-stroke;
    }
    .studio-graph-canvas .x6-node.is-selection-active rect,
    .studio-graph-canvas .x6-node.is-selection-active path:first-of-type {
      filter: drop-shadow(0 0 0.35rem rgba(56, 189, 248, 0.32));
    }
    .studio-graph-canvas .x6-node.is-selection-focus-pulse rect,
    .studio-graph-canvas .x6-node.is-selection-focus-pulse path:first-of-type {
      animation: studio-node-focus-pulse 820ms ease-out 1;
    }
    .studio-graph-canvas .x6-node.is-runtime-active rect,
    .studio-graph-canvas .x6-node.is-runtime-active path:first-of-type {
      filter: drop-shadow(0 0 0.55rem rgba(56, 189, 248, 0.22));
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
    }
    .studio-graph-canvas .x6-edge.is-selection-active .connection {
      stroke-width: 2.6px !important;
      filter: drop-shadow(0 0 0.3rem rgba(56, 189, 248, 0.25));
    }
    .studio-graph-canvas .x6-edge.is-runtime-active .connection {
      stroke-width: 2.6px !important;
      stroke-dasharray: 8 8;
      animation: studio-edge-flow 900ms linear infinite;
    }
    .studio-graph-canvas .x6-edge.is-runtime-error .connection {
      stroke-dasharray: 7 5;
    }
    .studio-graph-canvas .x6-edge.is-loop-back .connection {
      stroke-dasharray: 5 6;
    }
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-selection-focus-pulse rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-selection-focus-pulse path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-waiting-review rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-waiting-review path:first-of-type,
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
