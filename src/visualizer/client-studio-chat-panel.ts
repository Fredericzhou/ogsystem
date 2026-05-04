type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;

export function asStudioChatList(value: unknown): any[] {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function studioChatCanApply(result: Record<string, any> | null | undefined): boolean {
  if (!result?.authoringPatch?.authoring) {
    return false;
  }
  const action = asStudioChatList(result.actions).find((item) => item && item.id === "apply-authoring-patch");
  if (action && action.enabled === false) {
    return false;
  }
  const projectValidation = result.validation?.project;
  return !projectValidation || projectValidation.ok === true;
}

export function studioChatModeLabel(mode: string | undefined, t: Translator): string {
  if (mode === "ask") return t("studio.chat.mode.ask", undefined, "needs input");
  if (mode === "final") return t("studio.chat.mode.final", undefined, "ready");
  if (mode === "draft") return t("studio.chat.mode.draft", undefined, "draft");
  return t("studio.chat.mode.idle", undefined, "idle");
}

export function renderStudioChatPanelHtml(args: {
  state: Record<string, any>;
  t: Translator;
  escapeText: (value: unknown) => string;
}): string {
  // Chat input stays draft-only until an explicit send/regenerate/apply action fires.
  const { state, t, escapeText } = args;
  const result = state.studioChatResult;
  const disabled = state.actionBusy ? " disabled" : "";
  const chatBusy = state.actionBusy === "studio:chat-mmd";
  const messages = asStudioChatList(state.studioChatMessages);
  const previewMermaid = String(result?.previewMermaid || "");
  const questions = asStudioChatList(result?.questions);
  const assumptions = asStudioChatList(result?.assumptions);
  const warnings = asStudioChatList(result?.warnings);
  const projectDiagnostics = asStudioChatList(result?.validation?.project?.diagnostics);
  const nlDiagnostics = asStudioChatList(result?.validation?.nl2mmd?.diagnostics);
  const diagnostics = projectDiagnostics.length ? projectDiagnostics : nlDiagnostics;
  const selectedContext = state.studioBridgeSelectedRoleId
    ? t("studio.chat.contextRole", { roleId: state.studioBridgeSelectedRoleId }, "role {roleId}")
    : state.studioBridgeSelectedFlowKey
      ? t("studio.chat.contextFlow", { flowKey: state.studioBridgeSelectedFlowKey }, "flow {flowKey}")
      : t("studio.chat.contextGraph", undefined, "whole graph");
  const resultMode = result?.mode || "idle";
  const validationOk = result?.validation?.project?.ok === true;
  const hasResult = Boolean(result);
  const applyDisabled = !studioChatCanApply(result) || Boolean(state.actionBusy);
  const applyReason = result?.actions?.find((item: Record<string, any>) => item?.id === "apply-authoring-patch")?.reason || "";
  const messageHtml = messages.length
    ? messages.slice(-8).map((message) =>
        '<div class="event"><div class="event-top"><span>' + escapeText(message.role === "assistant" ? t("studio.chat.assistant", undefined, "assistant") : t("studio.chat.you", undefined, "you")) +
        '</span><span>' + escapeText(message.mode ? studioChatModeLabel(message.mode, t) : "") + '</span></div><strong>' +
        escapeText(message.text || "") + '</strong></div>'
      ).join("")
    : '<div class="hint">' + escapeText(t("studio.chat.emptyHistory", undefined, "Describe the system you want to generate or the selected graph item you want to adjust.")) + '</div>';
  const busyHtml = chatBusy
    ? '<div class="hint" role="status" aria-live="polite">' + escapeText(t("studio.chat.generating", undefined, "Generating Studio draft. You can close this panel while the request finishes.")) + '</div>'
    : "";
  const questionHtml = questions.length
    ? '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.chat.questions", undefined, "questions")) + '</span><span>' + escapeText(String(questions.length)) + '</span></div><strong>' +
      escapeText(questions.join(" · ")) + '</strong></div>'
    : "";
  const assumptionHtml = assumptions.length
    ? '<div class="hint">' + escapeText(t("studio.chat.assumptions", undefined, "Assumptions")) + ": " + escapeText(assumptions.join(" · ")) + '</div>'
    : "";
  const warningHtml = warnings.length
    ? '<div class="hint">' + escapeText(t("studio.chat.warnings", undefined, "Warnings")) + ": " + escapeText(warnings.join(" · ")) + '</div>'
    : "";
  const diagnosticHtml = diagnostics.length
    ? diagnostics.slice(0, 4).map((diagnostic) =>
        '<div class="event"><div class="event-top"><span>' + escapeText(String(diagnostic.code || diagnostic.severity || "diagnostic")) + '</span><span>' +
        escapeText(String(diagnostic.stage || "validate")) + '</span></div><strong>' + escapeText(String(diagnostic.message || diagnostic.code || "")) + '</strong></div>'
      ).join("")
    : hasResult
      ? '<div class="hint">' + escapeText(validationOk ? t("studio.chat.validationOk", undefined, "Preview validation passed.") : t("studio.chat.validationPending", undefined, "Preview validation is pending.")) + '</div>'
      : "";
  return [
    '<div class="studio-chat-panel structure-list' + (state.studioChatDialogOpen ? ' is-open' : '') + '" data-studio-bridge-region="chat"' + (state.studioChatDialogOpen ? ' role="region"' : ' hidden') + '>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.chat.title", undefined, "Chat to MMD")) + '</span><span>' + escapeText(studioChatModeLabel(resultMode, t)) + '</span></div><strong>' +
      escapeText(t("studio.chat.subtitle", undefined, "Generate or adjust the Studio draft with natural language.")) +
      '</strong><div class="hint">' + escapeText(t("studio.chat.context", { context: selectedContext }, "Context: {context}")) + '</div></div>',
    state.studioChatCollapsed
      ? '<button class="button subtle" type="button" id="studio-chat-toggle">' + escapeText(t("studio.chat.expand", undefined, "Show chat")) + '</button>'
      : [
          '<div class="studio-chat-grid">',
          '<div class="structure-list">',
          messageHtml,
          busyHtml,
          '<label class="field full"><span>' + escapeText(t("studio.chat.prompt", undefined, "Prompt")) + '</span><textarea id="studio-chat-input" rows="4"' + disabled + ' placeholder="' + escapeText(t("studio.chat.placeholder", undefined, "Ask to generate a flow, refine the selected role, or fix diagnostics.")) + '">' + escapeText(state.studioChatDraftMessage || "") + '</textarea></label>',
          '<div class="toolbar-row compact"><div class="toolbar-group">',
          '<button class="button primary" type="button" id="studio-chat-send"' + disabled + '>' + escapeText(t("studio.chat.send", undefined, "Send")) + '</button>',
          '<button class="button subtle" type="button" id="studio-chat-regenerate"' + (state.actionBusy || !state.studioChatLastRequest ? " disabled" : "") + '>' + escapeText(t("studio.chat.regenerate", undefined, "Regenerate")) + '</button>',
          '<button class="button subtle" type="button" id="studio-chat-close">' + escapeText(t("action.cancel", undefined, "Cancel")) + '</button>',
          '<button class="button subtle" type="button" id="studio-chat-toggle">' + escapeText(t("studio.chat.collapse", undefined, "Hide chat")) + '</button>',
          '</div></div>',
          '</div>',
          '<div class="structure-list">',
          '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.chat.preview", undefined, "preview")) + '</span><span>' + escapeText(validationOk ? t("workbench.validationOk", undefined, "validation ok") : studioChatModeLabel(resultMode, t)) + '</span></div><strong>' +
            escapeText(result?.summary || t("studio.chat.noPreview", undefined, "No generated preview yet.")) + '</strong></div>',
          questionHtml,
          assumptionHtml,
          warningHtml,
          diagnosticHtml,
          previewMermaid ? '<pre class="studio-chat-preview">' + escapeText(previewMermaid) + '</pre>' : "",
          applyReason ? '<div class="hint">' + escapeText(applyReason) + '</div>' : "",
          '<div class="toolbar-row compact"><div class="toolbar-group">',
          '<button class="button primary" type="button" id="studio-chat-apply"' + (applyDisabled ? " disabled" : "") + '>' + escapeText(t("studio.chat.apply", undefined, "Apply")) + '</button>',
          '<button class="button subtle" type="button" id="studio-chat-refine"' + (state.actionBusy || !hasResult ? " disabled" : "") + '>' + escapeText(t("studio.chat.refine", undefined, "Refine")) + '</button>',
          '<button class="button subtle" type="button" id="studio-chat-save-draft"' + (state.actionBusy || !state.studioBridge?.authoring ? " disabled" : "") + '>' + escapeText(t("studio.saveDraft", undefined, "Save draft")) + '</button>',
          '</div></div>',
          '</div>',
          '</div>'
        ].join(""),
    '</div>'
  ].join("");
}
