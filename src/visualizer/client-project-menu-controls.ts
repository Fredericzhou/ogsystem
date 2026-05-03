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
  onMenuTab: (tabId: string) => void;
  onOpenDraftInput: (value: string) => void;
  onRefreshBrowse: () => void;
  onValidateBrowse: () => void;
  onOpenSubmit: (target: string) => void;
  onBrowseSelect: (target: string) => void;
  onProjectSelect: (target: string) => void;
  onRecentSelect: (target: string) => void;
  onCreateSubmit: (form: ElementLike) => void;
  onDraftFormChange: (form: ElementLike) => void;
  onRoleFilter: (value: string, form: ElementLike | null | undefined) => void;
  onPageSize: (value: string, form: ElementLike | null | undefined) => void;
  onPrevPage: (form: ElementLike | null | undefined) => void;
  onNextPage: (form: ElementLike | null | undefined) => void;
  autoBrowse?: () => void;
}): void {
  const listElements = (root: RootLike, selector: string): ElementLike[] => {
    if (!root?.querySelectorAll) {
      return [];
    }
    return Array.from(root.querySelectorAll(selector) as ArrayLike<ElementLike>);
  };

  for (const button of listElements(args.root, "[data-project-menu-tab]")) {
    button.addEventListener?.("click", () => {
      args.onMenuTab(button.getAttribute?.("data-project-menu-tab") || "overview");
    });
  }

  const openInput = args.getElementById("project-open-workdir");
  openInput?.addEventListener?.("input", (event) => {
    args.onOpenDraftInput(String(event.target?.value ?? ""));
  });

  args.getElementById("project-open-browse-refresh")?.addEventListener?.("click", () => {
    args.onRefreshBrowse();
  });
  args.getElementById("project-open-validate")?.addEventListener?.("click", () => {
    args.onValidateBrowse();
  });

  const openForm = args.getElementById("project-open-form");
  openForm?.addEventListener?.("submit", (event) => {
    event.preventDefault?.();
    const target = args.getElementById("project-open-workdir")?.value || "";
    args.onOpenSubmit(String(target).trim());
  });

  for (const button of listElements(args.root, "[data-project-open-browse]")) {
    button.addEventListener?.("click", () => {
      args.onBrowseSelect(button.getAttribute?.("data-project-open-browse") || "");
    });
  }
  for (const button of listElements(args.root, "[data-project-open-project]")) {
    button.addEventListener?.("click", () => {
      args.onProjectSelect(button.getAttribute?.("data-project-open-project") || "");
    });
  }
  for (const button of listElements(args.root, "[data-project-open-recent]")) {
    button.addEventListener?.("click", () => {
      args.onRecentSelect(button.getAttribute?.("data-project-open-recent") || "");
    });
  }

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

  args.getElementById("project-role-catalog-filter")?.addEventListener?.("input", (event) => {
    args.onRoleFilter(String(event.target?.value ?? ""), createForm);
  });
  args.getElementById("project-role-page-size")?.addEventListener?.("change", (event) => {
    args.onPageSize(String(event.target?.value ?? ""), createForm);
  });
  args.getElementById("project-role-prev")?.addEventListener?.("click", () => {
    args.onPrevPage(createForm);
  });
  args.getElementById("project-role-next")?.addEventListener?.("click", () => {
    args.onNextPage(createForm);
  });

  args.autoBrowse?.();
}
