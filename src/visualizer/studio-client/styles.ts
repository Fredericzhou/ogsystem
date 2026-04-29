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
    .studio-graph-canvas {
      min-height: 320px;
      min-width: 0;
      position: relative;
    }
    .studio-graph-empty {
      display: grid;
      place-items: center;
      min-height: 320px;
      color: #8fa1c3;
      font-size: 13px;
    }
  `;
  document.head.appendChild(style);
}
