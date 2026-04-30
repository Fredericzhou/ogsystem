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
    .studio-graph-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
      background: rgba(8, 13, 26, 0.78);
      min-width: 0;
    }
    .studio-graph-toolbar-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .studio-graph-toolbar-group[hidden],
    .studio-graph-toolbar button[hidden] {
      display: none;
    }
    .studio-graph-toolbar button {
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(255, 255, 255, 0.04);
      color: #e5eefb;
      padding: 6px 8px;
      min-width: 34px;
      min-height: 32px;
      cursor: pointer;
    }
    .studio-graph-toolbar button:hover {
      border-color: rgba(56, 189, 248, 0.44);
      background: rgba(56, 189, 248, 0.12);
    }
    .studio-graph-toolbar button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .studio-graph-status {
      color: #8fa1c3;
      font-size: 12px;
      overflow-wrap: anywhere;
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
      position: absolute;
      inset: 12px 12px auto auto;
      z-index: 6;
      width: min(420px, calc(100% - 24px));
      max-height: calc(100% - 24px);
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
