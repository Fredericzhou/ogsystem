const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_MAX_HEIGHT = 1200;

function clamp(value, min, max) {
  return Math.min(Math.max(min, value), Math.max(min, max));
}

function panelBounds(panel, host) {
  const panelRect = panel.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  return {
    left: panelRect.left - hostRect.left - host.clientLeft,
    top: panelRect.top - hostRect.top - host.clientTop,
    width: panelRect.width,
    height: panelRect.height
  };
}

export function cascadeFloatingPosition(panel, host, bounds) {
  if (!panel || !host || !bounds) return bounds;
  const otherPanels = [...host.querySelectorAll(".studio-asset-drawer.is-open:not(.is-right-docked), .team-debug-panel.is-open:not(.is-right-docked), .studio-floating-panel.is-open:not(.is-right-docked)")].filter((p) => p !== panel);
  let nextLeft = bounds.left;
  let nextTop = bounds.top;
  for (const other of otherPanels) {
    const ob = panelBounds(other, host);
    if (Math.abs(ob.left - nextLeft) < 32 && Math.abs(ob.top - nextTop) < 32) {
      nextLeft = Math.min(host.clientWidth - bounds.width, nextLeft + 28);
      nextTop = Math.min(host.clientHeight - bounds.height, nextTop + 28);
    }
  }
  return { ...bounds, left: nextLeft, top: nextTop };
}

function applyPanelBounds(panel, host, bounds, { minWidth, minHeight } = {}) {
  if (!panel || !host || panel.classList.contains("is-right-docked")) return;
  const next = { ...bounds };
  const maxWidth = Math.min(DEFAULT_MAX_WIDTH, Math.max(1, host.clientWidth - 16));
  const maxHeight = Math.min(DEFAULT_MAX_HEIGHT, Math.max(1, host.clientHeight - 16));
  next.width = clamp(next.width, Math.min(minWidth || 1, maxWidth), maxWidth);
  next.height = clamp(next.height, Math.min(minHeight || 1, maxHeight), maxHeight);
  next.left = clamp(next.left, 0, Math.max(0, host.clientWidth - next.width));
  next.top = clamp(next.top, 0, Math.max(0, host.clientHeight - next.height));
  panel.style.left = `${Math.round(next.left)}px`;
  panel.style.top = `${Math.round(next.top)}px`;
  panel.style.right = "auto";
  panel.style.width = `${Math.round(next.width)}px`;
  panel.style.height = `${Math.round(next.height)}px`;
  return next;
}

/**
 * Adds the shared pointer, keyboard and maximize behavior used by Studio's
 * movable panels. Docking remains owned by the page because it changes the
 * workbench grid; this controller only reports drag boundaries to the page.
 */
export function createFloatingPanelController({
  panel,
  host,
  header,
  resizeHandle,
  minWidth = 320,
  minHeight = 300,
  isDocked = () => panel?.classList.contains("is-right-docked"),
  onUndock = () => {},
  onDrop = () => {},
  onResizeDock = () => {},
  onFocus = () => {},
  maximizeButton,
  labels = {},
  enableDrag = true,
  enableResize = true,
  fullscreen = false
} = {}) {
  if (!panel || !host) return { destroy() {} };
  let dragState = null;
  let resizeState = null;
  let restoreBounds = null;
  let maximized = panel.classList.contains("is-maximized");
  let nativeFullscreen = false;

  const bringToFront = () => {
    onFocus(panel);
    panel.style.zIndex = String(Math.max(Number(panel.style.zIndex || 5), 10));
    host.querySelectorAll(".studio-asset-drawer, .team-debug-panel").forEach((item) => {
      if (item !== panel && Number(item.style.zIndex || 5) > Number(panel.style.zIndex || 5)) return;
      if (item !== panel) item.style.zIndex = String(Math.max(5, Number(panel.style.zIndex || 10) - 1));
    });
  };

  const move = (left, top) => {
    if (isDocked() || maximized) return;
    const current = panelBounds(panel, host);
    applyPanelBounds(panel, host, { ...current, left, top }, { minWidth, minHeight });
  };

  const setMaximizedState = (next) => {
    maximized = next;
    panel.classList.toggle("is-maximized", next);
    maximizeButton?.setAttribute("aria-pressed", String(next));
    maximizeButton?.setAttribute("aria-label", next ? (labels.restore || "Restore panel") : (labels.maximize || "Maximize panel"));
    maximizeButton?.setAttribute("title", maximizeButton.getAttribute("aria-label"));
  };

  const toggleFallbackMaximize = () => {
    if (isDocked()) onUndock(panel);
    if (!maximized) {
      restoreBounds = panelBounds(panel, host);
      panel.style.left = "8px";
      panel.style.top = "8px";
      panel.style.right = "8px";
      panel.style.bottom = "8px";
      panel.style.width = "auto";
      panel.style.height = "auto";
      setMaximizedState(true);
    } else {
      const bounds = restoreBounds || panelBounds(panel, host);
      panel.style.bottom = "auto";
      applyPanelBounds(panel, host, bounds, { minWidth, minHeight });
      setMaximizedState(false);
    }
    bringToFront();
  };

  const toggleMaximize = async () => {
    if (fullscreen && typeof panel.requestFullscreen === "function") {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen?.();
        return;
      }
      try {
        if (!maximized) restoreBounds = panelBounds(panel, host);
        await panel.requestFullscreen();
        nativeFullscreen = true;
        setMaximizedState(true);
        bringToFront();
        return;
      } catch {
        // Browsers can reject fullscreen outside a user gesture or in embedded contexts.
      }
    }
    toggleFallbackMaximize();
  };

  const onFullscreenChange = () => {
    if (!nativeFullscreen || document.fullscreenElement === panel) return;
    nativeFullscreen = false;
    const bounds = restoreBounds || panelBounds(panel, host);
    panel.style.bottom = "auto";
    panel.classList.remove("is-maximized");
    applyPanelBounds(panel, host, bounds, { minWidth, minHeight });
    setMaximizedState(false);
  };

  const onHeaderPointerDown = (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    if (maximized) {
      bringToFront();
      return;
    }
    if (isDocked()) onUndock(panel);
    bringToFront();
    const bounds = panelBounds(panel, host);
    dragState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
    header.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onHeaderPointerMove = (event) => {
    if (!dragState) return;
    move(dragState.left + event.clientX - dragState.x, dragState.top + event.clientY - dragState.y);
  };
  const finishDrag = (event) => {
    if (!dragState) return;
    dragState = null;
    onDrop(panel);
  };
  const onResizePointerDown = (event) => {
    if (isDocked()) {
      bringToFront();
      resizeState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, bounds: panelBounds(panel, host) };
      resizeHandle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    bringToFront();
    resizeState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, bounds: panelBounds(panel, host) };
    resizeHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const onResizePointerMove = (event) => {
    if (!resizeState) return;
    const deltaX = event.clientX - resizeState.x;
    const deltaY = event.clientY - resizeState.y;
    if (isDocked()) {
      onResizeDock(deltaX, resizeState.bounds.width);
      return;
    }
    applyPanelBounds(panel, host, {
      ...resizeState.bounds,
      width: resizeState.bounds.width + deltaX,
      height: resizeState.bounds.height + deltaY
    }, { minWidth, minHeight });
  };
  const finishResize = (event) => {
    if (resizeState) resizeState = null;
  };
  const onKeyDown = (event) => {
    const delta = event.shiftKey ? 48 : 16;
    const moves = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    if (!moves[event.key] || event.target.closest("button, a, input, select, textarea")) return;
    event.preventDefault();
    if (isDocked()) onUndock(panel);
    const bounds = panelBounds(panel, host);
    move(bounds.left + moves[event.key][0], bounds.top + moves[event.key][1]);
  };

  panel.classList.add("studio-floating-panel");
  const onPanelEscape = (event) => {
    if (event.key === "Escape") {
      const closeBtn = panel.querySelector(".close-button, [data-team-debug-close], [data-team-build-close], #studio-asset-drawer-close");
      if (closeBtn) {
        event.preventDefault();
        event.stopPropagation();
        closeBtn.click();
      }
    }
  };
  panel.addEventListener("keydown", onPanelEscape);
  panel.addEventListener("pointerdown", bringToFront);
  if (enableDrag) {
    header?.addEventListener("pointerdown", onHeaderPointerDown);
    header?.addEventListener("pointermove", onHeaderPointerMove);
    header?.addEventListener("pointerup", finishDrag);
    header?.addEventListener("pointercancel", finishDrag);
    header?.addEventListener("keydown", onKeyDown);
  }
  if (enableResize) {
    resizeHandle?.addEventListener("pointerdown", onResizePointerDown);
    resizeHandle?.addEventListener("pointermove", onResizePointerMove);
    resizeHandle?.addEventListener("pointerup", finishResize);
    resizeHandle?.addEventListener("pointercancel", finishResize);
    resizeHandle?.addEventListener("keydown", onKeyDown);
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  maximizeButton?.addEventListener("click", (event) => { event.stopPropagation(); void toggleMaximize(); });

  return {
    move,
    bringToFront,
    toggleMaximize,
    isMaximized: () => maximized,
    destroy() {
      panel.removeEventListener("keydown", onPanelEscape);
      panel.removeEventListener("pointerdown", bringToFront);
      if (enableDrag) {
        header?.removeEventListener("pointerdown", onHeaderPointerDown);
        header?.removeEventListener("pointermove", onHeaderPointerMove);
        header?.removeEventListener("pointerup", finishDrag);
        header?.removeEventListener("pointercancel", finishDrag);
        header?.removeEventListener("keydown", onKeyDown);
      }
      if (enableResize) {
        resizeHandle?.removeEventListener("pointerdown", onResizePointerDown);
        resizeHandle?.removeEventListener("pointermove", onResizePointerMove);
        resizeHandle?.removeEventListener("pointerup", finishResize);
        resizeHandle?.removeEventListener("pointercancel", finishResize);
        resizeHandle?.removeEventListener("keydown", onKeyDown);
      }
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    }
  };
}
