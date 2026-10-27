import { pageFetch } from "../api.js";

const BUILTIN_ICONS = Object.freeze({
  engineering: "⌘",
  design: "◇",
  testing: "✓",
  support: "◎",
  specialized: "✳",
  general: "◉",
  role: "◉"
});
let catalogPoller;

async function request(path, method = "GET", body) {
  const response = await pageFetch(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed (" + response.status + ")");
  return payload;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function field(labelText, name, options = {}) {
  const label = element("label", options.className || "");
  label.append(document.createTextNode(labelText));
  const input = document.createElement(options.tag || "input");
  input.name = name;
  input.required = Boolean(options.required);
  if (options.type) input.type = options.type;
  if (options.maxlength) input.maxLength = options.maxlength;
  if (options.value) input.value = options.value;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.pattern) input.pattern = options.pattern;
  if (options.readOnly) input.readOnly = true;
  if (options.tag === "textarea") input.rows = options.rows || 2;
  label.append(input);
  return { label, input };
}

function roleIcon(role) {
  const value = role.icon && role.icon.type === "emoji" && typeof role.icon.value === "string" && Array.from(role.icon.value).length <= 8
    ? role.icon.value
    : role.icon && role.icon.type === "builtin" && BUILTIN_ICONS[role.icon.value]
      ? BUILTIN_ICONS[role.icon.value]
      : typeof role.emoji === "string" && Array.from(role.emoji).length <= 8
        ? role.emoji
        : "◉";
  const icon = element("span", "role-source-icon", value);
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", role.name || "Role");
  return icon;
}

function dateLabel(value, locale) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf())) return value || "—";
  return new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function renderRoleSourceCatalog(root, locale, navigate) {
  const en = locale === "en";
  const section = element("section", "role-source-catalog");

  const browser = element("div", "role-source-browser");
  const pageHeading = root.querySelector(":scope > .page-heading");
  pageHeading?.classList.add("role-source-page-heading");
  const filters = element("div", "role-source-toolbar");
  const searchField = field(en ? "Search roles" : "搜索角色", "search", { type: "search", placeholder: en ? "Role name or description" : "按角色名称或说明搜索" });
  const categorySelectField = field(en ? "Category" : "分类", "category", { tag: "select" });
  const languageSelectField = field(en ? "Language" : "语言", "language", { tag: "select" });
  filters.append(searchField.label, categorySelectField.label, languageSelectField.label);
  const sourceStatus = element("div", "page-frame-actions role-source-actions");
  pageHeading?.append(sourceStatus, filters);
  const list = element("div", "role-source-list");
  const dialog = element("dialog", "role-source-dialog");
  dialog.setAttribute("aria-label", en ? "Role details" : "角色详情");
  const dialogBar = element("div", "role-source-dialog-bar");
  dialogBar.append(element("span", "section-kicker", en ? "Role details" : "角色详情"));
  const closeDialog = element("button", "role-source-dialog-close", "×");
  closeDialog.type = "button";
  closeDialog.setAttribute("aria-label", en ? "Close role details" : "关闭角色详情");
  dialogBar.append(closeDialog);
  const detail = element("div", "role-source-detail");
  detail.setAttribute("aria-live", "polite");
  dialog.append(dialogBar, detail);
  browser.append(list, dialog);
  section.append(browser);
  root.append(section);

  let sources = [];
  let selected = null;
  let detailRequest = 0;
  const roles = () => sources.flatMap((source) => (source.roles || []).map((role) => ({
    ...role,
    sourceId: source.sourceId,
    sourceName: source.name || source.sourceId,
    sourceCommit: source.commit,
    sourceUpdatedAt: source.updatedAt
  })));
  const sourceFor = (sourceId) => sources.find((source) => source.sourceId === sourceId);
  const renderList = () => {
    const query = searchField.input.value.trim().toLocaleLowerCase();
    const visible = roles().filter((role) =>
      (!categorySelectField.input.value || role.category === categorySelectField.input.value) &&
      (!languageSelectField.input.value || (role.language || "und") === languageSelectField.input.value) &&
      (!query || [role.name, role.category, role.sourceName, role.language, role.description, role.path].some((value) => String(value || "").toLocaleLowerCase().includes(query)))
    );
    list.replaceChildren();
    sourceStatus.replaceChildren();
    for (const source of sources) {
      const sourceSummary = element("div", "role-source-summary");
      sourceSummary.append(element("strong", "", source.name || source.sourceId));
      if (source.inventory?.completeness === "unverified" && (source.roles || []).length > 0) {
        sourceSummary.append(element("span", "role-source-inventory-note", en
          ? "Showing roles identified in the synced version; the source has no complete role list."
          : "仅展示当前已同步版本中识别到的角色；上游未提供完整清单。"));
      }
      const inventory = source.inventory;
      const summaryText = inventory
        ? (en
          ? `${inventory.readyRoles} available roles · ${inventory.unsupportedCandidates} need review`
          : `${inventory.readyRoles} 个可用角色 · ${inventory.unsupportedCandidates} 个待检查`)
        : (source.commit ? (en ? "Index pending" : "索引待生成") : (en ? "Not synced" : "尚未同步"));
      sourceSummary.append(element("span", "role-source-summary-meta", summaryText));
      if (source.commit) sourceSummary.append(element("span", "role-source-summary-meta", (en ? "Updated " : "更新于 ") + dateLabel(source.updatedAt, locale)));
      const syncStatus = source.syncStatus;
      if (syncStatus?.state === "running") sourceSummary.append(element("span", "role-source-summary-meta", en ? "Background update in progress; showing the last completed snapshot." : "后台更新中；当前显示最近一次完成的快照。"));
      else if (syncStatus?.state === "failed") sourceSummary.append(element("span", "role-source-summary-meta", en ? "Latest update failed; the previous snapshot remains available." : "最近一次更新失败，继续显示上一个可用快照。"));
      else if (source.enabled === false) sourceSummary.append(element("span", "role-source-summary-meta", en ? "Updates paused" : "后台更新已停用"));
      sourceStatus.append(sourceSummary);
    }
    if (!visible.length) {
      const empty = !roles().length
        ? (en ? "No role snapshot is available yet. The catalog will show roles after the background update completes." : "尚无可展示的角色快照；后台更新完成后，角色会显示在此处。")
        : (en ? "No matching roles." : "没有匹配的角色。");
      list.append(element("p", "empty-note role-source-empty", empty));
      return;
    }
    const categories = new Map();
    for (const role of visible) {
      const key = role.category || "uncategorized";
      if (!categories.has(key)) categories.set(key, []);
      categories.get(key).push(role);
    }
    for (const [category, categoryRoles] of [...categories].sort(([left], [right]) => left.localeCompare(right))) {
      const group = element("section", "role-source-category");
      group.append(element("h3", "", `${category} (${categoryRoles.length})`));
      const cards = element("div", "role-source-category-grid");
      cards.setAttribute("role", "list");
      group.append(cards);
      list.append(group);
      for (const role of categoryRoles.sort((left, right) => String(left.name || left.path).localeCompare(String(right.name || right.path)))) {
        const row = element("button", "role-source-item");
        row.type = "button";
        row.setAttribute("role", "listitem");
        row.dataset.sourceId = role.sourceId;
        row.dataset.roleId = role.roleId;
        row.dataset.commit = role.commit || role.sourceCommit || "";
        row.title = role.description || (en ? "No role description provided." : "上游未提供角色说明。");
        row.setAttribute("aria-label", [role.name || role.roleId, role.description].filter(Boolean).join(". "));
        if (selected && selected.sourceId === role.sourceId && selected.roleId === role.roleId && selected.commit === row.dataset.commit) row.classList.add("is-selected");
        row.append(roleIcon(role));
        const copy = element("span", "role-source-item-copy");
        copy.append(element("strong", "", role.name || role.roleId));
        copy.append(element("span", "role-source-item-description", role.description || (en ? "No role description provided." : "上游未提供角色说明。")));
        copy.append(element("span", "role-source-item-meta", [role.language || "und", role.sourceName].join(" · ")));
        row.append(copy);
        const statusText = role.status === "ready" ? (en ? "Ready" : "可用") : role.status === "unsupported" ? (en ? "Unsupported" : "未适配") : role.status === "error" ? (en ? "Needs review" : "待检查") : (en ? "Indexed" : "已索引");
        const status = element("span", "status-chip " + (["error", "unsupported"].includes(role.status) ? "warning" : "confirmed"), statusText);
        row.append(status);
        cards.append(row);
      }
    }
  };
  const renderDetail = async (sourceId, roleId, commit) => {
    const requestId = ++detailRequest;
    const source = sourceFor(sourceId);
    const role = (source && source.roles || []).find((item) => item.roleId === roleId && (item.commit || source.commit) === commit);
    if (!source) return;
    selected = { sourceId, roleId, commit };
    renderList();
    if (!dialog.open) dialog.showModal();
    const versionBar = element("details", "role-source-version-control");
    versionBar.append(element("summary", "", en ? "Source version" : "来源版本"));
    const versionSelect = document.createElement("select");
    versionSelect.setAttribute("aria-label", en ? "Source version" : "来源版本");
    versionSelect.add(new Option(en ? "Loading versions…" : "读取版本中…", ""));
    versionBar.append(versionSelect);
    detail.replaceChildren(element("p", "project-loading", en ? "Loading source versions…" : "正在读取来源版本…"));
    try {
      const versionsPayload = await request("/api/v1/studio/role-sources/" + encodeURIComponent(sourceId) + "/versions");
      if (requestId !== detailRequest) return;
      const versions = Array.isArray(versionsPayload.versions) ? versionsPayload.versions : [];
      if (!versions.some((version) => version.commit === commit)) versions.unshift({ commit, updatedAt: role?.updatedAt || source.updatedAt, roleCount: source.roles?.length || 0 });
      versions.forEach((version) => {
        const option = new Option(version.commit.slice(0, 12) + " · " + dateLabel(version.updatedAt, locale) + " · " + String(version.roleCount) + (en ? " roles" : " 个角色"), version.commit);
        versionSelect.add(option);
      });
      versionSelect.value = commit;
      versionSelect.addEventListener("change", () => { void renderDetail(sourceId, roleId, versionSelect.value); });
      detail.replaceChildren(versionBar, element("p", "project-loading", en ? "Loading source preview…" : "正在读取来源预览…"));
      const path = "/api/v1/studio/role-sources/" + encodeURIComponent(sourceId) + "/roles/" + encodeURIComponent(roleId) + "?commit=" + encodeURIComponent(commit);
      const payload = await request(path);
      if (requestId !== detailRequest) return;
      const current = payload.role || role;
      detail.replaceChildren(versionBar);
      const header = element("header", "role-source-detail-head");
      header.append(roleIcon(current));
      const title = element("div");
      title.append(element("span", "section-kicker", (source.name || sourceId) + " · " + (current.category || "general")));
      title.append(element("h2", "", current.name || roleId));
      header.append(title);
      detail.append(header);
      detail.append(element("p", "role-source-description", current.description || ""));
      const sourceFacts = element("details", "role-source-source-facts role-source-detail-facts");
      sourceFacts.append(element("summary", "", en ? "Source information" : "来源信息"));
      const facts = element("dl", "role-source-facts");
      for (const [label, value] of [[en ? "Language" : "语言", current.language || "und"], ["Commit", current.commit || commit], [en ? "Updated" : "更新时间", dateLabel(current.updatedAt || source.updatedAt, locale)], [en ? "Path" : "来源路径", current.path || ""]]) {
        const item = element("div");
        item.append(element("dt", "", label));
        item.append(element("dd", "", value));
        facts.append(item);
      }
      sourceFacts.append(facts);
      if (current.display && typeof current.display === "object") {
        const display = element("dl", "role-source-display");
        Object.entries(current.display).filter(([key, value]) => /^[a-zA-Z0-9_-]{1,40}$/.test(key) && ["string", "number", "boolean"].includes(typeof value)).slice(0, 8).forEach(([key, value]) => {
          const item = element("div");
          item.append(element("dt", "", key));
          item.append(element("dd", "", String(value).slice(0, 160)));
          display.append(item);
        });
        if (display.childElementCount) sourceFacts.append(display);
      }
      detail.append(sourceFacts);
      if (Array.isArray(current.diagnostics) && current.diagnostics.length) {
        const diagnostics = element("ul", "role-source-diagnostics");
        current.diagnostics.slice(0, 20).forEach((item) => diagnostics.append(element("li", "", typeof item === "string" ? item : item.message || JSON.stringify(item))));
        detail.append(diagnostics);
      }
      const preview = element("details", "role-source-preview");
      preview.append(element("summary", "", en ? "Original role instructions" : "查看上游角色说明"));
      preview.append(element("pre", "", payload.markdown || ""));
      detail.append(preview);
      const trialForm = element("form", "role-source-trial");
      trialForm.append(element("h3", "", en ? "Try this role" : "试用角色"));
      trialForm.append(element("p", "role-source-trial-meta", en ? "Platform default model · no tool access" : "平台默认模型 · 不授予工具权限"));
      const taskField = field(en ? "Task" : "任务", "task", { required: true, tag: "textarea", rows: 2, maxlength: 12000 });
      taskField.input.value = en
        ? "Review the input and return practical recommendations with evidence and open questions."
        : "请依据输入给出可执行建议，并列明依据与待确认事项。";
      const inputField = field(en ? "Structured input (JSON object)" : "结构化输入（JSON 对象）", "input", { required: true, tag: "textarea", rows: 3 });
      inputField.input.value = JSON.stringify({ context: en ? "Describe the situation" : "描述背景", requirements: [en ? "Goal" : "目标", en ? "Constraints" : "限制"], references: [] }, null, 2);
      inputField.input.spellcheck = false;
      const preferencesField = field(en ? "User preferences (optional)" : "用户偏好（可选）", "userPreferences", { tag: "textarea", rows: 1, maxlength: 2000 });
      preferencesField.input.placeholder = en ? "Example: concise, distinguish facts from assumptions" : "例如：简洁表达，区分事实与假设";
      trialForm.append(taskField.label, inputField.label, preferencesField.label);
      trialForm.append(element("p", "role-source-trial-output-hint", en
        ? "Expected output: { event, content, data? } · event: ROLE_TRIAL_COMPLETE"
        : "输出结构：{ event, content, data? } · event 固定为 ROLE_TRIAL_COMPLETE"));
      const submit = element("button", "primary-button", en ? "Run trial" : "运行试用");
      submit.type = "submit";
      trialForm.append(submit);
      const status = element("p", "form-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      const output = element("pre", "role-source-trial-output");
      output.hidden = true;
      trialForm.append(status, output);
      trialForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        let parsedInput;
        try {
          parsedInput = JSON.parse(inputField.input.value);
          if (!parsedInput || Array.isArray(parsedInput) || typeof parsedInput !== "object") throw new Error("JSON 输入必须是对象");
        } catch (error) { status.textContent = error.message; return; }
        submit.disabled = true;
        status.textContent = en ? "Running with the platform model…" : "正在使用平台模型运行…";
        output.hidden = true;
        try {
          const result = await request("/api/v1/studio/role-sources/" + encodeURIComponent(sourceId) + "/roles/" + encodeURIComponent(roleId) + "/trial?commit=" + encodeURIComponent(commit), "POST", {
            task: taskField.input.value,
            input: parsedInput,
            userPreferences: preferencesField.input.value
          });
          const trial = result.result || {};
          status.textContent = `${trial.status === "failed" ? (en ? "Failed" : "失败") : (en ? "Completed" : "完成")} · ${trial.model?.backend || ""}/${trial.model?.modelId || ""} · ${trial.durationMs || 0} ms`;
          output.textContent = JSON.stringify(trial.output || trial.summary || {}, null, 2);
          output.hidden = false;
        } catch (error) {
          const messages = {
            ROLE_TRIAL_MODEL_UNAVAILABLE: en ? "No runnable default model is configured on this platform." : "平台尚未配置可运行的默认模型。",
            ROLE_SOURCE_ROLE_UNSUPPORTED: en ? "This source role cannot be converted for a trial." : "此来源角色未通过适配，不能试用。"
          };
          status.textContent = messages[error.message] || error.message;
        }
        finally { submit.disabled = false; }
      });
      detail.append(trialForm);
    } catch (error) {
      if (requestId !== detailRequest) return;
      const message = error.message === "NOT_FOUND"
        ? (en ? "This role is not present in the selected source version." : "所选来源版本中不存在此角色。")
        : error.message;
      detail.replaceChildren(versionBar, element("p", error.message === "NOT_FOUND" ? "empty-note" : "run-error", message));
    }
  };

  const refresh = async () => {
    const payload = await request("/api/v1/studio/role-sources");
    sources = Array.isArray(payload.sources) ? payload.sources : [];
    const previousLanguage = languageSelectField.input.value;
    const languages = Array.from(new Set(roles().map((role) => role.language || "und"))).sort();
    const categories = Array.from(new Set(roles().map((role) => role.category || "uncategorized"))).sort();
    languageSelectField.input.replaceChildren(new Option(en ? "All languages" : "所有语言", ""));
    languages.forEach((language) => languageSelectField.input.add(new Option(language, language)));
    languageSelectField.input.value = previousLanguage;
    const previousCategory = categorySelectField.input.value;
    categorySelectField.input.replaceChildren(new Option(en ? "All categories" : "所有分类", ""));
    categories.forEach((category) => categorySelectField.input.add(new Option(category, category)));
    categorySelectField.input.value = previousCategory;
    renderList();
    if (selected) {
      const sourceStillPresent = sourceFor(selected.sourceId);
      if (!sourceStillPresent) {
        selected = null;
        detailRequest += 1;
        if (dialog.open) dialog.close();
      } else if (dialog.open) {
        await renderDetail(selected.sourceId, selected.roleId, selected.commit);
      }
    }
  };

  if (catalogPoller) clearInterval(catalogPoller);
  searchField.input.addEventListener("input", renderList);
  categorySelectField.input.addEventListener("change", renderList);
  languageSelectField.input.addEventListener("change", renderList);
  closeDialog.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  list.addEventListener("click", async (event) => {
    const roleButton = event.target.closest("button[data-role-id]");
    if (roleButton) {
      await renderDetail(roleButton.dataset.sourceId, roleButton.dataset.roleId, roleButton.dataset.commit);
      return;
    }
  });
  void refresh().catch((error) => list.replaceChildren(element("p", "run-error", error.message)));
  catalogPoller = setInterval(() => {
    if (!root.isConnected || !root.contains(section)) { clearInterval(catalogPoller); catalogPoller = undefined; return; }
    if (sources.some((source) => source.syncStatus?.state === "running")) void refresh().catch(() => {});
  }, 3000);
}
