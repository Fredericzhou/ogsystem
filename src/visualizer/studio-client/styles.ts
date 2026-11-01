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
      border: 1px solid #dce8e2;
      background: #f7faf8;
      min-width: 0;
      overflow: hidden;
      container-type: inline-size;
    }
    .studio-graph-island .studio-graph-canvas {
      background-color: #f7faf8;
      background-image: radial-gradient(circle at 1px 1px, rgba(57, 108, 87, .11) 1px, transparent 1.2px);
      background-size: 16px 16px;
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
      border-bottom: 1px solid #e1e9e5;
      background: #ffffff;
      min-width: 0;
    }
    .studio-graph-toolbar-main {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      min-width: 0;
      overflow: visible;
      flex: 1 1 auto;
    }
    .studio-graph-toolbar-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px;
      min-width: 0;
      flex: 0 1 auto;
      flex-shrink: 1;
      max-width: 100%;
      padding: 2px;
      border: 1px solid #e5ede8;
      border-radius: 8px;
      background: #f7faf8;
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
      border-radius: 6px;
      background: #ffffff;
      color: #40574e;
      padding: 5px 7px;
      min-width: 32px;
      min-height: 32px;
      cursor: pointer;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
      flex: 0 0 auto;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
    }
    .studio-graph-toolbar button:hover {
      border-color: #a9cfbd;
      background: #e7f4ef;
      color: #165f50;
    }
    .studio-graph-toolbar button:focus-visible,
    .studio-graph-toolbar select:focus-visible,
    .studio-command-form button:focus-visible,
    .studio-command-form input:focus-visible,
    .studio-command-form select:focus-visible,
    .studio-graph-context-menu-item:focus-visible,
    .studio-graph-quick-open-item:focus-visible {
      outline: none;
      border-color: #1b7662;
      box-shadow: 0 0 0 3px rgba(27, 118, 98, 0.16);
    }
    .studio-graph-toolbar button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .studio-graph-toolbar select {
      min-height: 32px;
      padding: 5px 34px 5px 9px;
      border-radius: var(--control-radius);
      font-size: 11px;
      cursor: pointer;
    }
    .studio-graph-status {
      color: #52665e;
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
        align-items: center;
        box-sizing: border-box;
        flex-direction: row;
        max-width: calc(100% - 20px);
        overflow: hidden;
        padding: 4px;
      }
      .studio-graph-toolbar-main {
        flex-wrap: nowrap;
        max-width: 100%;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        width: 100%;
      }
      .studio-graph-toolbar-main::-webkit-scrollbar {
        display: none;
      }
      .studio-graph-toolbar-group {
        flex: 0 0 auto;
        flex-wrap: nowrap;
        max-width: none;
      }
      .studio-graph-toolbar-text {
        display: none;
      }
      .studio-graph-toolbar button,
      .studio-graph-toolbar select {
        min-height: 44px;
      }
      .studio-graph-toolbar button {
        flex: 0 0 44px;
        min-width: 44px;
      }
      .studio-graph-toolbar select {
        flex: 0 0 120px;
        max-width: 100%;
      }
    }
    @media (max-width: 1000px) and (max-height: 520px) and (orientation: landscape) {
      .studio-graph-toolbar {
        align-items: center;
        flex-direction: row;
        overflow: hidden;
        padding: 3px 4px;
      }
      .studio-graph-toolbar-main {
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        width: 100%;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
      }
      .studio-graph-toolbar-group {
        flex-wrap: nowrap;
        flex: 0 0 auto;
        max-width: none;
      }
      .studio-graph-toolbar button,
      .studio-graph-toolbar select {
        min-height: 38px;
      }
      .studio-graph-toolbar button {
        min-width: 38px;
      }
      .studio-graph-toolbar-text {
        display: none;
      }
      .studio-graph-island,
      .studio-graph-stage,
      .studio-graph-canvas {
        height: 100%;
        min-height: 0;
      }
    }
    @container (max-width: 920px) {
      .studio-graph-toolbar-text {
        display: none;
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
    .studio-graph-canvas .x6-node [data-studio-connect-port] {
      opacity: 0;
      transition: opacity 120ms ease, fill 120ms ease, stroke 120ms ease;
    }
    .studio-graph-canvas .x6-node.is-selection-active [data-studio-connect-port] {
      fill: #f0fdfa;
      opacity: 1;
      r: 4.5px;
      stroke: #0f766e;
      stroke-width: 1.8px;
    }
    .studio-graph-canvas .x6-node.is-relationship-source [data-studio-connect-port],
    .studio-graph-canvas .x6-node.is-connection-target [data-studio-connect-port],
    .is-relationship-connecting .x6-node:hover [data-studio-connect-port] {
      fill: #ecfeff;
      opacity: 1;
      r: 5px;
      stroke: #0891b2;
      stroke-width: 2px;
    }
    .studio-graph-canvas .x6-node.is-relationship-source [data-studio-connect-port],
    .is-relationship-connecting .x6-node.is-relationship-source [data-studio-connect-port] {
      fill: #cffafe;
      stroke: #0e7490;
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
    .studio-graph-canvas .x6-node.is-runtime-active rect:not(.studio-runtime-activity-ring),
    .studio-graph-canvas .x6-node.is-runtime-active path:first-of-type {
      filter: drop-shadow(0 0 0.42rem rgba(16, 185, 129, 0.22));
      animation: studio-agent-aura 2500ms cubic-bezier(.4, 0, .2, 1) infinite;
    }
    .studio-graph-island[data-runtime-focus="review"] .x6-edge:not(.is-runtime-active) .connection,
    .studio-graph-island[data-runtime-focus="review"] .x6-node:not(.is-runtime-waiting-review) rect,
    .studio-graph-island[data-runtime-focus="review"] .x6-node:not(.is-runtime-waiting-review) path:first-of-type {
      opacity: .38;
    }
    .studio-graph-canvas .studio-runtime-activity {
      pointer-events: none;
    }
    .studio-graph-canvas .studio-runtime-activity-ring {
      display: none;
      fill: none;
      stroke: #22a6c8;
      stroke-linejoin: round;
      stroke-width: 2px;
      vector-effect: non-scaling-stroke;
      animation: studio-runtime-ring-pulse 1400ms ease-in-out infinite;
    }
    .studio-graph-canvas .studio-runtime-activity-dot {
      fill: #22a6c8;
      stroke: #f7faf8;
      stroke-width: 1.5px;
      vector-effect: non-scaling-stroke;
      animation: studio-runtime-dot-pulse 1000ms ease-in-out infinite;
    }
    .studio-graph-canvas .studio-runtime-activity[data-mode="technical"] .studio-runtime-activity-ring {
      stroke: #5b8fd8;
      animation-duration: 2200ms;
    }
    .studio-graph-canvas .studio-runtime-activity[data-mode="technical"] .studio-runtime-activity-dot {
      fill: #5b8fd8;
      animation-duration: 1600ms;
    }
    .studio-graph-canvas .studio-runtime-activity[data-mode="review"] .studio-runtime-activity-ring {
      stroke: #d39a2e;
      animation: studio-runtime-review-pulse 1800ms ease-in-out infinite;
    }
    .studio-graph-canvas .studio-runtime-activity[data-mode="review"] .studio-runtime-activity-dot {
      fill: #d39a2e;
      animation: none;
    }
    .studio-graph-canvas .x6-node.is-runtime-completed rect,
    .studio-graph-canvas .x6-node.is-runtime-completed path:first-of-type {
      filter: drop-shadow(0 0 0.22rem rgba(52, 211, 153, 0.2));
      animation: studio-runtime-settle 700ms cubic-bezier(.16, 1, .3, 1) 1;
    }
    .studio-graph-island[data-runtime-history="on"] .studio-graph-canvas .x6-node.is-runtime-completed rect,
    .studio-graph-island[data-runtime-history="on"] .studio-graph-canvas .x6-node.is-runtime-completed path:first-of-type,
    .studio-graph-island[data-runtime-history="on"] .studio-graph-canvas .studio-runtime-data-packet,
    .studio-graph-island[data-runtime-history="on"] .studio-graph-canvas .studio-runtime-handoff-marker {
      animation: none !important;
    }
    .studio-graph-island[data-runtime-history="on"] .studio-graph-canvas .studio-runtime-data-packets,
    .studio-graph-island[data-runtime-history="on"] .studio-graph-canvas .studio-runtime-handoffs {
      display: none;
    }
    .studio-graph-canvas .x6-node[data-runtime-status="waiting"] rect,
    .studio-graph-canvas .x6-node[data-runtime-status="waiting"] path:first-of-type {
      stroke: #e6a23c !important;
      stroke-dasharray: 5 4;
      animation: none !important;
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
    .studio-graph-canvas .studio-runtime-status-bg { fill: #e6f3ee; stroke: #7db39e; stroke-width: 0.8px; opacity: .7; }
    .studio-graph-canvas .studio-runtime-status-label { fill: #245b46; font-size: 9px; font-weight: 650; opacity: .72; pointer-events: none; }
    .studio-graph-canvas .studio-runtime-status[data-status="running"] .studio-runtime-status-bg { fill: #e2f2fa; stroke: #79b7d2; }
    .studio-graph-canvas .studio-runtime-status[data-status="running"] .studio-runtime-status-label { fill: #225b72; }
    .studio-graph-canvas .studio-runtime-status[data-status="technical_waiting"] .studio-runtime-status-bg { fill: #e8effb; stroke: #7d9fda; }
    .studio-graph-canvas .studio-runtime-status[data-status="technical_waiting"] .studio-runtime-status-label { fill: #315b9b; }
    .studio-graph-canvas .studio-runtime-status[data-status="waiting"] .studio-runtime-status-bg,
    .studio-graph-canvas .studio-runtime-status[data-status="waiting_review"] .studio-runtime-status-bg { fill: #fff1d7; stroke: #d7a449; }
    .studio-graph-canvas .studio-runtime-status[data-status="waiting"] .studio-runtime-status-label,
    .studio-graph-canvas .studio-runtime-status[data-status="waiting_review"] .studio-runtime-status-label { fill: #80590f; }
    .studio-graph-canvas .studio-runtime-status[data-status="failed"] .studio-runtime-status-bg { fill: #fde6e2; stroke: #d68579; }
    .studio-graph-canvas .studio-runtime-status[data-status="failed"] .studio-runtime-status-label { fill: #8f392f; }
    .studio-graph-canvas .studio-runtime-status-icon {
      pointer-events: none;
      overflow: visible;
    }
    .studio-graph-canvas .studio-runtime-status-icon-bg {
      fill: #f4faf7;
      stroke: #7db39e;
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
    }
    .studio-graph-canvas .studio-runtime-status-icon-shape {
      fill: none;
      stroke: #245b46;
      stroke-width: 1.45px;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    .studio-graph-canvas .studio-runtime-status-icon-core { fill: #245b46; stroke: none; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="running"] .studio-runtime-status-icon-bg { fill: #e4f7ef; stroke: #34a878; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="running"] .studio-runtime-status-icon-shape { stroke: #15835c; animation: studio-runtime-gear-spin 1600ms linear infinite; transform-origin: 9px 9px; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="technical_waiting"] .studio-runtime-status-icon-bg { fill: #e9f0fb; stroke: #7d9fda; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="technical_waiting"] .studio-runtime-status-icon-shape { stroke: #315b9b; animation: studio-runtime-hourglass-pulse 1800ms ease-in-out infinite; transform-origin: 9px 9px; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="waiting"] .studio-runtime-status-icon-bg,
    .studio-graph-canvas .studio-runtime-status-icon[data-status="waiting_review"] .studio-runtime-status-icon-bg { fill: #fff7e8; stroke: #d7a449; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="waiting"] .studio-runtime-status-icon-shape,
    .studio-graph-canvas .studio-runtime-status-icon[data-status="waiting_review"] .studio-runtime-status-icon-shape { stroke: #9b6a13; animation: studio-runtime-hourglass-pulse 1800ms ease-in-out infinite; transform-origin: 9px 9px; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="done"] .studio-runtime-status-icon-bg { fill: #e6f5ed; stroke: #68ad8b; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="done"] .studio-runtime-status-icon-shape { stroke: #20734d; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="failed"] .studio-runtime-status-icon-bg { fill: #fff0ed; stroke: #d68579; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="failed"] .studio-runtime-status-icon-shape { stroke: #b74436; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="stopped"] .studio-runtime-status-icon-bg,
    .studio-graph-canvas .studio-runtime-status-icon[data-status="paused"] .studio-runtime-status-icon-bg { fill: #eef2f0; stroke: #89958f; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="stopped"] .studio-runtime-status-icon-shape,
    .studio-graph-canvas .studio-runtime-status-icon[data-status="paused"] .studio-runtime-status-icon-shape { stroke: #64716b; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="pending"] .studio-runtime-status-icon-bg,
    .studio-graph-canvas .studio-runtime-status-icon[data-status="idle"] .studio-runtime-status-icon-bg { fill: #f1f5f3; stroke: #9aaba3; }
    .studio-graph-canvas .studio-runtime-status-icon[data-status="pending"] .studio-runtime-status-icon-shape,
    .studio-graph-canvas .studio-runtime-status-icon[data-status="idle"] .studio-runtime-status-icon-shape { stroke: #687970; }
    .studio-graph-canvas .studio-runtime-handoffs { pointer-events: none; overflow: visible; }
    .studio-graph-canvas .studio-runtime-handoff-marker {
      fill: #f4faf7;
      stroke: #2ca875;
      stroke-width: 1.4px;
      vector-effect: non-scaling-stroke;
      transform-box: fill-box;
      transform-origin: center;
    }
    .studio-graph-canvas .studio-runtime-handoff-marker.is-active {
      fill: #34d399;
      stroke: #147a59;
      animation: studio-runtime-handoff-pulse 1200ms ease-in-out infinite;
    }
    .studio-graph-canvas .studio-runtime-handoff-marker.is-waiting { fill: #f8cf72; stroke: #a86c12; }
    .studio-graph-canvas .studio-runtime-handoff-marker.is-failed { fill: #e88676; stroke: #9f3a2f; }
    .studio-graph-canvas .studio-runtime-handoff-marker.is-stopped { fill: #a8b3ad; stroke: #64716b; }
    .studio-graph-canvas .studio-runtime-data-packets { pointer-events: none; overflow: visible; }
    .studio-graph-canvas .studio-runtime-data-packet {
      fill: #d9fff0;
      stroke: #0f9f6e;
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
      filter: drop-shadow(0 0 4px rgba(16, 185, 129, .72));
    }
    .studio-graph-canvas .studio-runtime-data-packets[data-waiting="true"] .studio-runtime-data-packet {
      fill: #fff1bf;
      stroke: #c98b1a;
      filter: drop-shadow(0 0 4px rgba(217, 164, 65, .58));
    }
    .studio-graph-canvas .x6-edge[data-runtime-handoff-count] .connection { stroke-linecap: round; }
    .studio-graph-canvas .x6-edge .connection {
      transition: stroke 160ms ease, stroke-width 160ms ease, opacity 160ms ease, stroke-dasharray 160ms ease;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .studio-graph-canvas .x6-edge-label {
      pointer-events: none;
    }
    .studio-graph-canvas .x6-edge:hover .connection {
      stroke-width: 2.1px !important;
    }
    .studio-graph-canvas .x6-edge.is-selection-active .connection {
      stroke-width: 2.6px !important;
      filter: drop-shadow(0 0 0.3rem rgba(56, 189, 248, 0.25));
    }
    .studio-graph-canvas .x6-edge.is-runtime-focus-edge .connection {
      stroke-width: 3px !important;
      filter: drop-shadow(0 0 0.4rem rgba(56, 189, 248, 0.36));
    }
    .studio-graph-canvas .x6-node.is-runtime-focus-target rect,
    .studio-graph-canvas .x6-node.is-runtime-focus-target path:first-of-type {
      stroke-width: 2.4px !important;
      filter: drop-shadow(0 0 0.4rem rgba(56, 189, 248, 0.34));
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
      stroke: #34d399 !important;
      stroke-width: 2.5px !important;
      stroke-dasharray: 10 10;
      filter: drop-shadow(0 0 0.32rem rgba(52, 211, 153, 0.24));
      animation: studio-edge-flow 680ms linear infinite;
    }
    .studio-graph-canvas .x6-edge.is-runtime-completed .connection {
      stroke: #34d399 !important;
      stroke-width: 2px !important;
    }
    .studio-graph-canvas .x6-edge.is-runtime-waiting .connection {
      stroke: #e6a23c !important;
      stroke-width: 2.3px !important;
      stroke-dasharray: 5 5;
      animation: none !important;
    }
    .studio-graph-canvas .x6-edge.is-runtime-error:not(.is-runtime-active) .connection {
      stroke: #d76654 !important;
      stroke-width: 2.3px !important;
      stroke-dasharray: 7 5;
      animation: none !important;
    }
    .studio-graph-canvas .x6-edge.is-runtime-error.is-runtime-active .connection {
      stroke: #d76654 !important;
      animation: studio-edge-flow 680ms linear infinite;
    }
    .studio-graph-canvas .x6-edge.is-runtime-stopped .connection {
      stroke: #89958f !important;
      stroke-width: 1.9px !important;
      stroke-dasharray: 3 5;
      animation: none !important;
    }
    .studio-graph-canvas .x6-edge.is-loop-back .connection,
    .studio-graph-canvas .x6-edge.is-loop-back path[marker-end] {
      stroke-dasharray: 7 5;
      stroke-width: 2.2px;
      stroke-linecap: round;
      filter: drop-shadow(0 0 0.22rem rgba(45, 212, 191, 0.34));
    }
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-selection-focus-pulse rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-selection-focus-pulse path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-active rect:not(.studio-runtime-activity-ring),
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-active path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .studio-runtime-activity-ring,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .studio-runtime-activity-dot,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .studio-runtime-status-icon-shape,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .studio-runtime-handoff-marker,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node[data-runtime-status="failed"] rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node[data-runtime-status="failed"] path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-waiting-review rect,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-node.is-runtime-waiting-review path:first-of-type,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-edge.is-pending-preview .connection,
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .x6-edge.is-runtime-active .connection {
      animation: none !important;
    }
    .studio-graph-island[data-reduced-motion="on"] .studio-graph-canvas .studio-runtime-data-packet {
      display: none;
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
    @keyframes studio-runtime-ring-pulse {
      0%, 100% { opacity: .58; stroke-width: 1.5px; }
      50% { opacity: 1; stroke-width: 3px; }
    }
    @keyframes studio-runtime-dot-pulse {
      0%, 100% { opacity: .62; }
      50% { opacity: 1; }
    }
    @keyframes studio-runtime-review-pulse {
      0%, 100% { opacity: .7; stroke-width: 2px; }
      50% { opacity: 1; stroke-width: 3.5px; }
    }
    @keyframes studio-runtime-gear-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes studio-runtime-hourglass-pulse {
      0%, 100% { opacity: .62; transform: scale(.92); }
      50% { opacity: 1; transform: scale(1); }
    }
    @keyframes studio-runtime-handoff-pulse {
      0%, 100% { opacity: .62; transform: scale(.84); }
      50% { opacity: 1; transform: scale(1.12); }
    }
    @keyframes studio-agent-aura {
      0%, 100% { filter: drop-shadow(0 0 0.28rem rgba(16, 185, 129, .18)); }
      50% { filter: drop-shadow(0 0 1rem rgba(16, 185, 129, .42)); }
    }
    @keyframes studio-runtime-settle {
      0% { transform: scale(.985); filter: drop-shadow(0 0 0 rgba(52, 211, 153, 0)); }
      42% { transform: scale(1.035); filter: drop-shadow(0 0 .9rem rgba(52, 211, 153, .48)); }
      100% { transform: scale(1); filter: drop-shadow(0 0 .22rem rgba(52, 211, 153, .2)); }
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
      color: #52665e;
      font-size: 13px;
      background: rgba(28, 48, 44, 0.12);
    }
    .studio-graph-empty[hidden] {
      display: none;
    }
    .studio-graph-diagnostic-card {
      position: absolute;
      z-index: 6;
      max-width: 320px;
      padding: 10px 12px;
      border: 1px solid #dce8e2;
      border-radius: 10px;
      background: #ffffff;
      color: #243b32;
      box-shadow: 0 14px 32px rgba(35, 67, 56, 0.14);
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
      border: 1px solid #dce8e2;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 12px 28px rgba(35, 67, 56, 0.12);
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
      border: 1px solid #dce8e2;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 14px 32px rgba(35, 67, 56, 0.14);
      max-width: min(260px, calc(100% - 20px));
      max-height: calc(100% - 20px);
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: #cbdad2 #f3f7f4;
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
      color: #33483f;
      padding: 8px 10px;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
    }
    .studio-graph-context-menu-item:hover {
      border-color: #a9cfbd;
      background: #e7f4ef;
      color: #165f50;
    }
    .studio-graph-context-menu-item.is-destructive:hover {
      border-color: rgba(248, 113, 113, 0.36);
      background: rgba(248, 113, 113, 0.12);
      color: #9d4e37;
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
      border: 1px solid #dce8e2;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 18px 38px rgba(35, 67, 56, 0.14);
    }
    .studio-graph-quick-open-label {
      font-size: 12px;
      color: #52665e;
    }
    .studio-graph-quick-open-input {
      width: 100%;
      min-width: 0;
      border: 1px solid #dce8e2;
      border-radius: 8px;
      background: #fbfcfb;
      color: #243b32;
      padding: 9px 10px;
      box-sizing: border-box;
    }
    .studio-graph-quick-open-input:focus-visible {
      outline: none;
      border-color: #1b7662;
      box-shadow: 0 0 0 3px rgba(27, 118, 98, 0.16);
    }
    .studio-graph-quick-open-results {
      display: grid;
      gap: 6px;
      max-height: 240px;
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: #cbdad2 #f3f7f4;
    }
    .studio-graph-quick-open-item {
      display: grid;
      gap: 3px;
      width: 100%;
      text-align: left;
      border: 1px solid #e5ede8;
      background: #ffffff;
      color: #33483f;
      padding: 9px 10px;
      cursor: pointer;
    }
    .studio-graph-quick-open-item.is-active,
    .studio-graph-quick-open-item:hover {
      border-color: #a9cfbd;
      background: #e7f4ef;
      color: #165f50;
    }
    .studio-graph-quick-open-kind,
    .studio-graph-quick-open-empty {
      font-size: 11px;
      color: #52665e;
    }
    .studio-graph-stage.is-empty .studio-graph-canvas {
      opacity: 0.34;
    }
    .studio-command-dialog {
      width: 100%;
      max-width: 100%;
      overflow: auto;
      border: 1px solid #dce8e2;
      background: #ffffff;
      box-shadow: 0 18px 48px rgba(35, 67, 56, 0.16);
      scrollbar-width: thin;
      scrollbar-color: #cbdad2 #f3f7f4;
    }
    .studio-graph-toolbar-main::-webkit-scrollbar,
    .studio-graph-context-menu::-webkit-scrollbar,
    .studio-graph-quick-open-results::-webkit-scrollbar,
    .studio-command-dialog::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    .studio-graph-toolbar-main::-webkit-scrollbar-track,
    .studio-graph-context-menu::-webkit-scrollbar-track,
    .studio-graph-quick-open-results::-webkit-scrollbar-track,
    .studio-command-dialog::-webkit-scrollbar-track {
      background: #f3f7f4;
    }
    .studio-graph-toolbar-main::-webkit-scrollbar-thumb,
    .studio-graph-context-menu::-webkit-scrollbar-thumb,
    .studio-graph-quick-open-results::-webkit-scrollbar-thumb,
    .studio-command-dialog::-webkit-scrollbar-thumb {
      border: 2px solid #f3f7f4;
      border-radius: 8px;
      background: #cbdad2;
    }
    .studio-command-dialog[hidden] {
      display: none;
    }
    .studio-command-form {
      display: grid;
      gap: 10px;
      padding: 12px;
      color: #33483f;
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
      border: 1px solid #dce8e2;
      border-radius: 8px;
      background: #ffffff;
      color: #33483f;
      padding: 7px 10px;
      min-height: 34px;
      cursor: pointer;
      font-weight: 600;
    }
    .studio-command-form-actions button {
      background: #e7f4ef;
      border-color: #b8d8c8;
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
    .studio-command-form input {
      width: 100%;
      min-width: 0;
      min-height: 36px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--control-bg);
      color: var(--text);
      padding: 7px 10px;
      box-sizing: border-box;
    }
    .studio-command-form select {
      box-sizing: border-box;
    }
    .studio-command-form input[type="radio"],
    .studio-command-form input[type="checkbox"] {
      width: auto;
      flex: 0 0 auto;
    }
    .studio-command-form-error,
    .studio-command-form-diagnostic {
      color: #a14f39;
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .studio-command-form-diagnostics {
      display: grid;
      gap: 6px;
    }
    .studio-command-form-diagnostic.warning {
      color: #946b1d;
    }
    .studio-command-form-diagnostic.info {
      color: #426b7a;
    }
    @media (max-width: 540px) {
      .studio-graph-island {
        min-height: 340px;
      }
      .studio-graph-stage,
      .studio-graph-canvas {
        min-height: 270px;
      }
      .studio-graph-minimap {
        right: 8px;
        bottom: 8px;
        width: 132px;
        height: 88px;
      }
      .studio-graph-context-menu {
        max-width: calc(100% - 16px);
      }
    }
    :root[data-visualizer-theme="dark"] .studio-graph-island {
      border-color: #334155;
      background: #0b1220;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-toolbar {
      border-color: #263449;
      background: #0f172a;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-toolbar-group {
      border-color: #334155;
      background: #111c2e;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-toolbar button,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-item {
      background: #172337;
      border-color: #334155;
      color: #dbeafe;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-toolbar button:hover,
    :root[data-visualizer-theme="dark"] .studio-graph-context-menu-item:hover,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-item:hover,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-item.is-active {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.14);
      color: #d7f3ff;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-status,
    :root[data-visualizer-theme="dark"] .studio-graph-empty,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-label,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-kind,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-empty {
      color: #8fa1c3;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-empty { background: rgba(8, 13, 26, 0.72); }
    :root[data-visualizer-theme="dark"] .studio-graph-diagnostic-card,
    :root[data-visualizer-theme="dark"] .studio-graph-minimap,
    :root[data-visualizer-theme="dark"] .studio-graph-context-menu,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-panel,
    :root[data-visualizer-theme="dark"] .studio-command-dialog {
      border-color: #334155;
      background: #0f172a;
      color: #dbeafe;
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42);
    }
    :root[data-visualizer-theme="dark"] .studio-graph-context-menu-item,
    :root[data-visualizer-theme="dark"] .studio-command-form {
      color: #dbeafe;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-input,
    :root[data-visualizer-theme="dark"] .studio-command-form input,
    :root[data-visualizer-theme="dark"] .studio-command-form select {
      border-color: #475569;
      background: #111c2e;
      color: #e5eefb;
      color-scheme: dark;
    }
    :root[data-visualizer-theme="dark"] .studio-command-form-header button,
    :root[data-visualizer-theme="dark"] .studio-command-form-actions button {
      border-color: #475569;
      background: #172337;
      color: #dbeafe;
    }
    :root[data-visualizer-theme="dark"] .studio-command-form-actions button { border-color: #1b7662; background: #12352f; }
    :root[data-visualizer-theme="dark"] .studio-graph-minimap-edges line { stroke: rgba(148, 163, 184, 0.55); }
    :root[data-visualizer-theme="dark"] .studio-graph-minimap-node { background: rgba(56, 189, 248, 0.65); border-color: rgba(186, 230, 253, 0.58); }
    :root[data-visualizer-theme="dark"] .studio-graph-minimap-viewport { border-color: rgba(56, 189, 248, 0.95); background: rgba(56, 189, 248, 0.13); }
    :root[data-visualizer-theme="dark"] .studio-graph-toolbar-main,
    :root[data-visualizer-theme="dark"] .studio-graph-context-menu,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-results,
    :root[data-visualizer-theme="dark"] .studio-command-dialog {
      scrollbar-color: #475569 #111c2e;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-toolbar-main::-webkit-scrollbar-track,
    :root[data-visualizer-theme="dark"] .studio-graph-context-menu::-webkit-scrollbar-track,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-results::-webkit-scrollbar-track,
    :root[data-visualizer-theme="dark"] .studio-command-dialog::-webkit-scrollbar-track { background: #111c2e; }
    :root[data-visualizer-theme="dark"] .studio-graph-toolbar-main::-webkit-scrollbar-thumb,
    :root[data-visualizer-theme="dark"] .studio-graph-context-menu::-webkit-scrollbar-thumb,
    :root[data-visualizer-theme="dark"] .studio-graph-quick-open-results::-webkit-scrollbar-thumb,
    :root[data-visualizer-theme="dark"] .studio-command-dialog::-webkit-scrollbar-thumb { border-color: #111c2e; background: #475569; }
    :root[data-visualizer-theme="light"] .studio-graph-canvas .x6-node:hover rect,
    :root[data-visualizer-theme="light"] .studio-graph-canvas .x6-node:hover path:first-of-type { stroke: #84b9a0; }
    :root[data-visualizer-theme="dark"] .studio-graph-canvas .x6-node.is-selection-active [data-studio-connect-port] {
      fill: #0f2f38;
      stroke: #67e8f9;
    }
    :root[data-visualizer-theme="light"] .studio-graph-canvas .x6-edge.is-selection-active .connection,
    :root[data-visualizer-theme="light"] .studio-graph-canvas .x6-edge.is-pending-preview .connection { stroke: #1b7662 !important; }
    :root[data-visualizer-theme="light"] .studio-graph-canvas .x6-edge.is-runtime-waiting .connection { stroke: #a86c12 !important; }
    :root[data-visualizer-theme="light"] .studio-graph-canvas .x6-edge.is-runtime-error .connection { stroke: #b74436 !important; }
    :root[data-visualizer-theme="light"] .studio-graph-canvas .x6-edge.is-pending-preview .x6-edge-label rect { stroke: #1b7662; }
    .studio-graph-canvas .x6-node.is-selection-active .studio-node-body {
      fill: #dcfce7 !important;
      filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.95)) drop-shadow(0 0 10px rgba(22, 163, 74, 0.75));
      stroke: #15803d !important;
      stroke-width: 4.5px !important;
    }
    :root[data-visualizer-theme="dark"] .studio-graph-canvas .x6-node.is-selection-active .studio-node-body {
      fill: #123b27 !important;
      filter: drop-shadow(0 0 2px rgba(15, 23, 42, 0.95)) drop-shadow(0 0 11px rgba(74, 222, 128, 0.95));
      stroke: #4ade80 !important;
    }
    @media (max-width: 1000px) and (max-height: 520px) and (orientation: landscape) {
      .studio-graph-island,
      .studio-graph-stage,
      .studio-graph-canvas {
        height: 100%;
        min-height: 0;
      }
    }
  `;
  document.head.appendChild(style);
}
