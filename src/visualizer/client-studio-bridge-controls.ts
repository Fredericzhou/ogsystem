type ListenerEvent = {
  target?: { value?: string | null } | null;
};

type ElementLike = {
  addEventListener?: (type: string, listener: (event: ListenerEvent) => void) => void;
  getAttribute?: (name: string) => string | null;
  setAttribute?: (name: string, value: string) => void;
};

type LookupFn = (selector: string) => ElementLike | null | undefined;
type RootLike = {
  querySelectorAll?: (selector: string) => Iterable<ElementLike> | ArrayLike<ElementLike>;
};

export function bindStudioBridgeControls(args: {
  root: RootLike;
  findElement: LookupFn;
  onRoleSelect: (roleId: string) => void;
  onFlowSelect: (flowKey: string) => void;
  onFilterInput: (value: string) => void;
  onListModeChange: (value: string) => void;
}): void {
  const bindOnce = (element: ElementLike | null | undefined, eventName: string, marker: string, listener: (event: ListenerEvent) => void): void => {
    if (!element?.addEventListener) {
      return;
    }
    if (element.getAttribute?.("data-bound-" + marker) === "true") {
      return;
    }
    element.setAttribute?.("data-bound-" + marker, "true");
    element.addEventListener(eventName, listener);
  };

  const listElements = (root: RootLike, selector: string): ElementLike[] => {
    if (!root?.querySelectorAll) {
      return [];
    }
    return Array.from(root.querySelectorAll(selector) as ArrayLike<ElementLike>);
  };

  for (const button of listElements(args.root, "[data-studio-role-id]")) {
    bindOnce(button, "click", "studio-role-select", () => {
      args.onRoleSelect(button.getAttribute?.("data-studio-role-id") || "");
    });
  }
  for (const button of listElements(args.root, "[data-studio-flow-key]")) {
    bindOnce(button, "click", "studio-flow-select", () => {
      args.onFlowSelect(button.getAttribute?.("data-studio-flow-key") || "");
    });
  }
  bindOnce(args.findElement("[data-studio-bridge-filter]"), "input", "studio-bridge-filter", (event) => {
    args.onFilterInput(String(event.target?.value ?? ""));
  });
  bindOnce(args.findElement("[data-studio-bridge-list-mode]"), "change", "studio-bridge-list-mode", (event) => {
    args.onListModeChange(String(event.target?.value ?? "all"));
  });
}

export function bindStudioChatControls(args: {
  getElementById: (id: string) => ElementLike | null | undefined;
  onToggle: () => void;
  onInput: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  onRegenerate: () => void;
  onRefine: () => void;
  onApply: () => void;
  onSaveDraft: () => void;
}): void {
  args.getElementById("studio-chat-toggle")?.addEventListener?.("click", () => {
    args.onToggle();
  });
  args.getElementById("studio-chat-input")?.addEventListener?.("input", (event) => {
    args.onInput(String(event.target?.value ?? ""));
  });
  args.getElementById("studio-chat-send")?.addEventListener?.("click", () => {
    args.onSend();
  });
  args.getElementById("studio-chat-close")?.addEventListener?.("click", () => {
    args.onClose();
  });
  args.getElementById("studio-chat-regenerate")?.addEventListener?.("click", () => {
    args.onRegenerate();
  });
  args.getElementById("studio-chat-refine")?.addEventListener?.("click", () => {
    args.onRefine();
  });
  args.getElementById("studio-chat-apply")?.addEventListener?.("click", () => {
    args.onApply();
  });
  args.getElementById("studio-chat-save-draft")?.addEventListener?.("click", () => {
    args.onSaveDraft();
  });
}
