type ListenerEvent = {
  preventDefault?: () => void;
  target?: { value?: string | null } | null;
};

type ElementLike = {
  addEventListener?: (type: string, listener: (event: ListenerEvent) => void) => void;
  getAttribute?: (name: string) => string | null;
  querySelectorAll?: (selector: string) => Iterable<ElementLike> | ArrayLike<ElementLike>;
  value?: string;
};

type RootLike = {
  querySelectorAll?: (selector: string) => Iterable<ElementLike> | ArrayLike<ElementLike>;
};

export function bindProjectWizardControls(args: {
  root: RootLike;
  getElementById: (id: string) => ElementLike | null | undefined;
  onCreateSubmit: (form: ElementLike) => void;
  onDraftFormChange: (form: ElementLike) => void;
  onAction?: (action: string) => void;
}): void {
  const listElements = (root: RootLike, selector: string): ElementLike[] => {
    if (!root?.querySelectorAll) {
      return [];
    }
    return Array.from(root.querySelectorAll(selector) as ArrayLike<ElementLike>);
  };

  const createForm = args.getElementById("project-create-form");
  createForm?.addEventListener?.("submit", (event) => {
    event.preventDefault?.();
    args.onCreateSubmit(createForm);
  });
  if (createForm) {
    for (const input of listElements(createForm, "input, select")) {
      input.addEventListener?.("input", () => {
        args.onDraftFormChange(createForm);
      });
      input.addEventListener?.("change", () => {
        args.onDraftFormChange(createForm);
      });
    }
  }

  for (const button of listElements(args.root, "[data-project-action]")) {
    button.addEventListener?.("click", () => {
      args.onAction?.(button.getAttribute?.("data-project-action") || "");
    });
  }
}
