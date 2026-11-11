import { state } from "../state.js";
import { esc } from "./dom.js";

export function createStudioTranscriptTools({ roleColorForId, renderRoleAvatarWithBadge, formatEventTime, formatStatus }) {
  const fallbackEventLabels = {
    READY: { en: "Result ready", zh: "准备好了" },
    APPROVED: { en: "Approved", zh: "同意" },
    REJECTED: { en: "Rejected", zh: "不同意" },
    NEEDS_REWORK: { en: "Needs rework", zh: "请再改改" },
    BLOCKED: { en: "Business blocked", zh: "办不了" },
    START: { en: "Started", zh: "开始" },
    DONE: { en: "Completed", zh: "完成" },
    COMPLETED: { en: "Completed", zh: "完成" },
    FAILED: { en: "Failed", zh: "失败" },
    STOPPED: { en: "Stopped", zh: "已停止" }
  };
  const eventEmojis = {
    READY: "✅",
    APPROVED: "👍",
    REJECTED: "🙅",
    NEEDS_REWORK: "🔁",
    BLOCKED: "🚫"
  };
  let messageId = 0;

  function eventLabel(event) {
    const key = String(event || "").trim();
    if (!key) return "";
    const normalized = key.toUpperCase();
    const configured = state.eventLabels?.[key]
      || state.eventLabels?.[normalized]
      || Object.entries(state.eventLabels || {}).find(([candidate]) => candidate.toUpperCase() === normalized)?.[1];
    const fallback = fallbackEventLabels[normalized];
    const labels = configured || fallback;
    return Array.isArray(labels)
      ? labels[state.locale === "en" ? 1 : 0] || labels[0] || key
      : labels && typeof labels === "object"
        ? labels[state.locale === "en" ? "en" : "zh"] || labels[state.locale === "en" ? "en" : "zh-CN"] || labels.zh || labels.en || key
        : labels || key;
  }

  function eventEmoji(event) {
    return state.locale === "en" ? "" : eventEmojis[String(event || "").trim().toUpperCase()] || "";
  }

  function messagePresentation(value) {
    const raw = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
    let structuredValue = value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) structuredValue = parsed;
      } catch {
        // Plain text and event=... previews use the existing string parser below.
      }
    }
    let event = "";
    let content = raw;
    if (structuredValue && typeof structuredValue === "object" && !Array.isArray(structuredValue)) {
      event = String(structuredValue.event || structuredValue.type || "").trim();
      if (Object.hasOwn(structuredValue, "content")) content = typeof structuredValue.content === "string" ? structuredValue.content : JSON.stringify(structuredValue.content, null, 2);
    } else {
      const match = raw.match(/^\s*event\s*=\s*([^|]+?)\s*\|\s*content\s*=\s*([\s\S]*)$/i);
      if (match) {
        event = match[1].trim();
        content = match[2].trim();
      }
    }
    return { event, label: eventLabel(event), content: String(content || ""), raw, fullText: typeof value === "string" && structuredValue !== value ? raw : undefined };
  }

  function messageMarkup(sectionLabel, value) {
    const presentation = messagePresentation(value);
    const long = presentation.content.length > 280;
    const preview = long ? `${presentation.content.slice(0, 280).trimEnd()}…` : presentation.content;
    const eventIcon = eventEmoji(presentation.event);
    const heading = presentation.label
      ? `<span class="studio-message-event">${eventIcon ? `<span class="studio-message-event-emoji" aria-hidden="true">${eventIcon}</span>` : ""}${esc(presentation.label)}</span><span class="studio-message-content-preview">${esc(preview)}</span>`
      : `<span class="studio-message-content-preview">${esc(preview)}</span>`;
    const fullId = `studio-message-full-${++messageId}`;
    const fullText = presentation.fullText || (presentation.label ? `${presentation.label}\n${presentation.content}` : presentation.content);
    return `<section class="studio-message-section" data-studio-message-section>${sectionLabel ? `<small>${esc(sectionLabel)}</small>` : ""}<div class="studio-message-preview">${heading}</div>${long ? `<button type="button" class="studio-message-more" data-studio-message-more aria-expanded="false" aria-controls="${fullId}">${state.locale === "en" ? "More" : "更多"}</button><pre id="${fullId}" data-studio-message-full hidden>${esc(fullText)}</pre>` : ""}</section>`;
  }

  function messageSectionMarkup(label, value) {
    return messageMarkup(label, value);
  }

  function messageBodyMarkup(value) {
    return messageMarkup("", value);
  }

  function bindMessageMore(section) {
    section?.querySelector("[data-studio-message-more]")?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      const pre = section.querySelector("[data-studio-message-full]");
      if (!pre) return;
      const expanded = button.getAttribute("aria-expanded") === "true";
      pre.hidden = expanded;
      button.setAttribute("aria-expanded", String(!expanded));
      button.textContent = expanded ? (state.locale === "en" ? "More" : "更多") : (state.locale === "en" ? "Less" : "收起");
    });
  }

  function auditDrawerMarkup(locale) {
    const english = locale === "en";
    const labels = english
      ? { telemetry: "Telemetry", input: "Input Context", output: "Output", diagnostics: "Diagnostics", raw: "Raw JSON", close: "Close", focus: "Focus node", copy: "Copy JSON" }
      : { telemetry: "调用明细", input: "输入上下文", output: "执行交付", diagnostics: "失败诊断", raw: "原始数据", close: "关闭", focus: "定位图谱节点", copy: "复制 JSON" };
    return `<aside class="studio-audit-drilldown-drawer" data-studio-runtime-audit-drawer aria-label="${english ? "Audit drilldown" : "审计下钻明细"}" hidden><div class="studio-audit-drawer-head"><div><span class="section-kicker">${english ? "Audit drilldown" : "深度审计下钻"}</span><h3 data-audit-drawer-title>${english ? "Role activation audit" : "角色激活审计明细"}</h3></div><button type="button" class="close-button" data-audit-drawer-close aria-label="${labels.close}">×</button></div><div class="studio-audit-drawer-tabs" role="tablist">${["telemetry", "input", "output", "diagnostics", "raw"].map((key, index) => `<button type="button" class="studio-audit-drawer-tab${index === 0 ? " is-active" : ""}" data-audit-tab="${key}" role="tab" aria-selected="${index === 0}">${labels[key]}</button>`).join("")}</div><div class="studio-audit-drawer-body" data-audit-drawer-body></div><div class="studio-audit-drawer-foot"><button type="button" class="secondary-button" data-audit-action="focus-node">${labels.focus}</button><button type="button" class="secondary-button" data-audit-action="copy-json">${labels.copy}</button><button type="button" class="primary-button" data-audit-drawer-close>${labels.close}</button></div></aside>`;
  }

  function roleCardMarkup({ event, roleName, backend = "", authoring = {}, locale = state.locale, auditIndex = 0, bodyMarkup = "", handoffMarkup = "", auditMarkup = "", statusLabel = "", focusableAvatar = true, extraClass = "" }) {
    const roleId = event.roleId || "system";
    const avatar = renderRoleAvatarWithBadge(roleId, authoring, backend, { focusable: focusableAvatar });
    const status = event.status || (event.type === "role_waiting" || event.type === "role.started" ? "working"
      : event.type === "role.input_ready" ? "accepted"
        : event.type === "role.failed" ? "failed" : event.type === "role.skipped" ? "skipped" : "completed");
    const backendTag = backend ? `<span class="team-debug-backend-tag" title="${esc(backend)}">${esc(backend)}</span>` : "";
    const name = roleName || roleId;
    const focusName = focusableAvatar ? ` data-focus-role="${esc(roleId)}" role="button" tabindex="0"` : "";
    const defaultAudit = `<button type="button" class="team-debug-drilldown-btn" data-runtime-audit-open title="${locale === "en" ? "Inspect full audit trail" : "审计下钻明细"}">${locale === "en" ? "Audit" : "审计下钻"}</button>`;
    return `<li class="team-debug-chat-item${extraClass ? ` ${esc(extraClass)}` : ""}" data-role-id="${esc(roleId)}" data-audit-index="${auditIndex}" data-status="${status}" tabindex="0" style="--role-accent:${esc(roleColorForId(roleId).accent)};--role-fill:${esc(roleColorForId(roleId).fill)}">${avatar}<div class="team-debug-bubble-col"><header><div class="team-debug-role"><strong class="team-debug-sender-name"${focusName}>${esc(name)}</strong>${backendTag}</div><div class="team-debug-header-meta"><span class="team-debug-time-status">${esc(statusLabel || `${formatEventTime(event)} · ${formatStatus(status)}`)}</span>${auditMarkup || defaultAudit}</div></header><div class="team-debug-bubble"><div class="team-debug-bubble-body">${bodyMarkup}</div><div class="team-debug-handoff-mentions">${handoffMarkup}</div></div></div></li>`;
  }

  function focusRole(graph, roleId, onFocusRole) {
    if (!roleId || roleId === "__system_start__" || roleId === "__system_end__" || roleId === "__user__") return;
    graph?.update?.({ selectedRoleId: roleId, selectedFlowKey: "" });
    graph?.focusRoleNode?.(roleId);
    onFocusRole?.(roleId);
  }

  function attachAuditDrawer(result) {
    let drawer = result?._studioRuntimeAuditDrawer;
    if (!drawer?.isConnected) drawer = result?.querySelector("[data-studio-runtime-audit-drawer]");
    if (!drawer && result) {
      result.insertAdjacentHTML("beforeend", auditDrawerMarkup(state.locale));
      drawer = result.querySelector("[data-studio-runtime-audit-drawer]");
    }
    if (drawer && result) result._studioRuntimeAuditDrawer = drawer;
    if (drawer && drawer.parentElement !== document.body) document.body.append(drawer);
    if (drawer && result && !result._studioRuntimeAuditCleanup) {
      const observer = new MutationObserver(() => {
        if (result.isConnected) return;
        drawer.remove();
        observer.disconnect();
        result._studioRuntimeAuditCleanup = null;
      });
      observer.observe(document.body, { childList: true, subtree: true });
      result._studioRuntimeAuditCleanup = observer;
    }
    return drawer;
  }

  function mergeAuditTrail(cards, auditTrail) {
    for (const audit of auditTrail || []) {
      const candidates = [...cards.values()].filter((card) => card.dataset.roleId === audit.roleId);
      const card = audit.executionId
        ? candidates.find((entry) => entry.dataset.executionKey === audit.executionId)
        : candidates.at(-1);
      if (card) card._studioAuditItem = { ...card._studioAuditItem, ...audit };
    }
  }

  function appendRuntimeHandoff(cards, event, roleName, pendingHandoffs) {
    const { fromRoleId, toRoleId } = event || {};
    if (!fromRoleId || !toRoleId || fromRoleId === "__system_start__") return;
    const completesForUser = toRoleId === "__system_end__";
    const candidates = [...cards.values()].filter((card) => card.dataset.roleId === fromRoleId);
    const source = (event.executionId && candidates.find((card) => card._studioAuditItem?.executionId === event.executionId))
      || (event.branchId && candidates.find((card) => card._studioAuditItem?.branchId === event.branchId))
      || candidates.at(-1);
    if (!source) {
      const pending = pendingHandoffs.get(fromRoleId) || [];
      pending.push(event);
      pendingHandoffs.set(fromRoleId, pending);
      return;
    }
    const container = source.querySelector(".team-debug-handoff-mentions");
    if (!container) return;
    const handoffKey = event.handoffId || `${event.branchId || ""}:${fromRoleId}:${toRoleId}:${event.loopIteration || 1}`;
    if ([...container.children].some((child) => child.dataset.runtimeHandoffKey === handoffKey)) return;
    const mention = document.createElement("div");
    mention.className = "chat-mention-callout";
    if (completesForUser) mention.dataset.userCompletion = "true";
    else mention.dataset.handoffRole = toRoleId;
    mention.dataset.runtimeHandoffKey = handoffKey;
    mention.setAttribute("role", completesForUser ? "status" : "button");
    if (!completesForUser) mention.tabIndex = 0;
    mention.title = completesForUser
      ? (state.locale === "en" ? "The completed result is delivered to the user" : "已完成结果交付给用户")
      : state.locale === "en" ? `Click to focus ${roleName(toRoleId)}` : `点击聚焦到 ${roleName(toRoleId)}`;
    mention.innerHTML = completesForUser
      ? `<span class="chat-mention">@${state.locale === "en" ? "User" : "用户"}</span><span class="chat-mention-hint">${state.locale === "en" ? "Task complete" : "任务已完成"}</span>`
      : `<span class="chat-mention">@${esc(roleName(toRoleId))}</span>`;
    container.append(mention);
  }

  function appendUserPrompt(transcript, prompt, timestamp = Date.now()) {
    if (!transcript || !prompt || transcript.querySelector(".is-user-prompt, .is-user-initiator")) return;
    const item = document.createElement("li");
    item.className = "team-debug-chat-item is-user-initiator is-user-prompt";
    const at = typeof timestamp === "number" ? new Date(timestamp).toISOString() : timestamp;
    item.innerHTML = `<div class="team-debug-avatar is-user" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="team-debug-bubble-col"><header><div class="team-debug-role"><strong class="team-debug-sender-name">${state.locale === "en" ? "User Task" : "用户任务"}</strong><span class="team-debug-user-badge">${state.locale === "en" ? "Task Prompt" : "初始任务"}</span></div><span class="team-debug-time-status">${formatEventTime({ at })}</span></header><div class="team-debug-bubble"><div class="team-debug-bubble-body"><p class="team-debug-user-prompt">${esc(prompt)}</p></div></div></div>`;
    transcript.append(item);
  }

  function bindAuditDrawer(result, graph, getRoleName, onFocusRole) {
    const drawer = attachAuditDrawer(result);
    const transcript = result?.querySelector(".team-debug-transcript");
    if (!drawer || !transcript || drawer.dataset.bound === "true") return;
    drawer.dataset.bound = "true";
    let activeItem = null;
    const renderTab = (key) => {
      if (!activeItem) return;
      drawer.querySelectorAll("[data-audit-tab]").forEach((tab) => {
        const selected = tab.dataset.auditTab === key;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-selected", String(selected));
      });
      const body = drawer.querySelector("[data-audit-drawer-body]");
      if (!body) return;
      const calls = activeItem.promptCalls || [];
      const callMarkup = calls.map((call, index) => `<div class="studio-audit-stat-card"><small>${esc(call.phase || `Call #${index + 1}`)} · ${esc(call.modelId || activeItem.modelId || "—")}</small><strong>${Number(call.renderedPromptChars || 0).toLocaleString(state.locale)} chars · ${Number(call.estimatedInputTokens || 0) + Number(call.estimatedOutputTokens || 0)} tokens</strong></div>`).join("") || `<p class="empty-note">${state.locale === "en" ? "No call-level breakdown recorded." : "未记录单次调用分解。"}</p>`;
      if (key === "telemetry") {
        const values = {
          status: formatStatus(activeItem.status || activeItem.type || "unknown"),
          backend: activeItem.backend || "—",
          durationMs: activeItem.durationMs ?? "—",
          externalDataIsolated: activeItem.externalDataIsolated === true ? (state.locale === "en" ? "Isolated" : "已分隔") : activeItem.externalDataIsolated === false ? (state.locale === "en" ? "Not isolated" : "未分隔") : "—",
          fallbackUsed: activeItem.fallbackUsed ? (state.locale === "en" ? "Yes" : "已触发") : (state.locale === "en" ? "No" : "未触发"),
          renderedPromptChars: activeItem.renderedPromptChars ?? "—",
          projectedInputChars: activeItem.projectedInputChars ?? "—",
          estimatedInputTokens: activeItem.estimatedInputTokens ?? "—",
          estimatedOutputTokens: activeItem.estimatedOutputTokens ?? "—"
        };
        body.innerHTML = `<div class="studio-audit-section"><h4 class="studio-audit-section-title">${state.locale === "en" ? "Activation Telemetry" : "激活遥测指标"}</h4><div class="studio-audit-stat-grid">${Object.entries(values).map(([keyName, value]) => `<div class="studio-audit-stat-card"><small>${esc(keyName)}</small><strong>${esc(value)}</strong></div>`).join("")}</div></div><div class="studio-audit-section"><h4 class="studio-audit-section-title">${state.locale === "en" ? "Prompt Calls" : "模型调用记录"} (${calls.length})</h4>${callMarkup}</div>`;
        return;
      }
      const value = key === "input" ? activeItem.inputContext
        : key === "output" ? (activeItem.stdout || activeItem.failure || activeItem.content || activeItem.stdoutPreview)
          : key === "diagnostics" ? (activeItem.errorEnvelope || { failure: activeItem.failure, error: activeItem.error, attempt: activeItem.attempt })
            : activeItem;
      const label = key === "input" ? (state.locale === "en" ? "Input Context" : "输入上下文")
        : key === "output" ? (state.locale === "en" ? "Execution Output" : "执行输出与交付成果")
          : key === "diagnostics" ? (state.locale === "en" ? "Failure Diagnostics" : "失败诊断与错误信封")
            : (state.locale === "en" ? "Complete Raw Audit Payload" : "完整原始审计 JSON");
      body.innerHTML = `<div class="studio-audit-section"><h4 class="studio-audit-section-title">${label}</h4><pre class="studio-audit-code-block">${esc(typeof value === "string" ? value : value ? JSON.stringify(value, null, 2) : (state.locale === "en" ? "No details recorded." : "未采集详细信息。"))}</pre></div>`;
    };
    transcript.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-runtime-audit-open]");
      if (button) {
        event.stopPropagation();
        const card = button.closest("[data-role-id]");
        activeItem = card?._studioAuditItem || { roleId: card?.dataset.roleId, type: card?.dataset.status };
        const title = drawer.querySelector("[data-audit-drawer-title]");
        if (title) title.textContent = `${getRoleName(activeItem.roleId || "")} (${activeItem.roleId || "—"}) · ${state.locale === "en" ? "Audit Drilldown" : "审计明细"}`;
        renderTab("telemetry");
        drawer.hidden = false;
        return;
      }
      const focus = event.target.closest?.("[data-focus-role], [data-handoff-role]");
      if (focus) focusRole(graph, focus.dataset.focusRole || focus.dataset.handoffRole, onFocusRole);
    });
    transcript.addEventListener("keydown", (event) => {
      if ((event.key !== "Enter" && event.key !== " ") || !event.target.matches("[data-focus-role], [data-handoff-role]")) return;
      event.preventDefault();
      focusRole(graph, event.target.dataset.focusRole || event.target.dataset.handoffRole, onFocusRole);
    });
    drawer.querySelectorAll("[data-audit-tab]").forEach((tab) => tab.addEventListener("click", () => renderTab(tab.dataset.auditTab)));
    drawer.querySelectorAll("[data-audit-drawer-close]").forEach((button) => button.addEventListener("click", () => { drawer.hidden = true; }));
    drawer.querySelector('[data-audit-action="focus-node"]')?.addEventListener("click", () => {
      if (activeItem?.roleId) focusRole(graph, activeItem.roleId, onFocusRole);
    });
    drawer.querySelector('[data-audit-action="copy-json"]')?.addEventListener("click", async () => {
      if (!activeItem) return;
      try { await navigator.clipboard.writeText(JSON.stringify(activeItem, null, 2)); } catch { /* Clipboard may be unavailable. */ }
    });
  }

  return Object.freeze({
    messagePresentation,
    messageSectionMarkup,
    messageBodyMarkup,
    bindMessageMore,
    auditDrawerMarkup,
    roleCardMarkup,
    mergeAuditTrail,
    appendRuntimeHandoff,
    appendUserPrompt,
    bindAuditDrawer
  });
}
