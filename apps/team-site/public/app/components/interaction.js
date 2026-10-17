const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])"
].join(",");

function focusable(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

export function trapFocus(root, { initial, onEscape } = {}) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = focusable(root);
    if (!elements.length) {
      event.preventDefault();
      root.focus?.();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  root.addEventListener("keydown", handleKeydown);
  root.classList.add("focus-scope");
  const first = (initial && root.querySelector(initial)) || focusable(root)[0] || root;
  if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
  first.focus({ preventScroll: true });
  return () => {
    root.removeEventListener("keydown", handleKeydown);
    root.classList.remove("focus-scope");
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
}

export function lockBodyScroll(className = "modal-open") {
  document.body.classList.add(className);
  return () => document.body.classList.remove(className);
}

export function confirmAction({ title, message, confirmLabel = "确认", cancelLabel = "取消" } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "confirm-dialog";
  dialog.setAttribute("aria-labelledby", "confirm-dialog-title");
  dialog.innerHTML = `<form method="dialog" class="confirm-form"><h2 id="confirm-dialog-title"></h2><p class="confirm-message"></p><div class="form-actions"><button class="secondary-button" value="cancel" type="submit"></button><button class="primary-button" value="confirm" type="submit"></button></div></form>`;
  dialog.querySelector("#confirm-dialog-title").textContent = title || "确认操作";
  dialog.querySelector(".confirm-message").textContent = message || "确定继续吗？";
  dialog.querySelector("button[value=cancel]").textContent = cancelLabel;
  dialog.querySelector("button[value=confirm]").textContent = confirmLabel;
  document.body.append(dialog);
  let settled = false;
  let releaseTrap;
  let releaseScroll;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    releaseTrap?.();
    releaseScroll?.();
    if (dialog.open) dialog.close();
    dialog.remove();
    resolvePromise(value);
  };
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  dialog.addEventListener("close", () => finish(dialog.returnValue === "confirm"));
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
  dialog.showModal();
  releaseScroll = lockBodyScroll();
  releaseTrap = trapFocus(dialog, { initial: "button[value=confirm]", onEscape: () => finish(false) });
  return promise;
}

export function bindDirtyForm(form, mark) {
  if (!form) return () => {};
  const handler = () => mark();
  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
  return () => {
    form.removeEventListener("input", handler);
    form.removeEventListener("change", handler);
  };
}
