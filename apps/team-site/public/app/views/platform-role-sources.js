import { pageFetch } from "../api.js";

let activePoller;

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

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = String(text);
  return item;
}

function dateLabel(value, locale) {
  const date = new Date(value || "");
  if (!value || Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sourceStatus(source, en) {
  const status = source.syncStatus;
  if (status?.state === "running") return en ? "Running " + (status.operation || "sync") + "…" : status.operation === "reindex" ? "正在重新索引…" : "正在同步…";
  if (status?.state === "failed") return (en ? "Last update failed: " : "最近更新失败：") + (status.lastError || "Unknown error");
  if (status?.state === "succeeded") return en ? "Last update succeeded" : "最近更新成功";
  return source.commit ? (en ? "Available snapshot" : "已有可用快照") : (en ? "Waiting for first update" : "等待首次同步");
}

export async function renderPlatformRoleSources(root, locale = "zh-CN") {
  const en = locale === "en";
  if (activePoller) clearInterval(activePoller);
  root.replaceChildren();
  const page = node("section", "platform-role-sources");
  const heading = node("header", "page-heading library-heading");
  const headingCopy = node("div");
  headingCopy.append(node("div", "eyebrow", en ? "Platform settings" : "平台配置"), node("h1", "", en ? "Role sources" : "角色源配置"));
  headingCopy.append(node("p", "", en ? "Configure Git sources and review server-side sync results." : "配置 Git 来源，并查看 Team Site 后台同步结果。"));
  heading.append(headingCopy);
  page.append(heading);

  const layout = node("div", "role-source-admin-layout");
  const form = node("form", "project-panel compact-form role-source-admin-form");
  const formHeading = node("div", "panel-head");
  const formHeadingCopy = node("div");
  formHeadingCopy.append(node("span", "section-kicker", en ? "Source configuration" : "来源设置"));
  formHeadingCopy.append(node("h2", "", en ? "Add or edit source" : "新增或编辑来源"));
  formHeading.append(formHeadingCopy);
  form.append(formHeading);

  const addField = (labelText, name, options = {}, parent = form) => {
    const label = node("label", "", labelText);
    const input = document.createElement("input");
    input.name = name;
    input.value = options.value || "";
    input.type = options.type || "text";
    input.required = Boolean(options.required);
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.pattern) input.pattern = options.pattern;
    label.append(input);
    parent.append(label);
    return input;
  };
  const sourceId = addField(en ? "Source ID" : "来源 ID", "sourceId", { value: "agency-agents", required: true, maxLength: 80, pattern: "[a-z0-9][a-z0-9-]{0,79}" });
  const name = addField(en ? "Display name" : "显示名称", "name", { value: "Agency Agents", required: true, maxLength: 120 });
  const gitDetails = node("details", "role-source-admin-git-details");
  gitDetails.append(node("summary", "", en ? "Git connection" : "Git 连接信息"));
  const gitUrl = addField(en ? "Git URL" : "Git 地址", "gitUrl", { value: "https://github.com/msitarzewski/agency-agents.git", type: "url", required: true, maxLength: 1000 }, gitDetails);
  const branch = addField(en ? "Branch" : "分支", "branch", { value: "main", required: true, maxLength: 200 }, gitDetails);
  form.append(gitDetails);
  const adapterLabel = node("label", "", en ? "Adapter" : "适配器");
  const adapter = document.createElement("select");
  adapter.name = "adapterId";
  adapter.add(new Option("Agency Agents Markdown", "agency-agents-markdown"));
  adapter.add(new Option("Agency Agents CN Markdown", "agency-agents-cn-markdown"));
  adapterLabel.append(adapter);
  form.append(adapterLabel);
  const enabledLabel = node("label", "field checkbox role-source-admin-enabled");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.name = "enabled";
  enabled.checked = true;
  enabledLabel.append(enabled, document.createTextNode(en ? "Available for manual updates" : "允许手动更新"));
  form.append(enabledLabel);
  const formActions = node("div", "role-source-admin-form-actions");
  const save = node("button", "primary-button", en ? "Save source" : "保存来源");
  save.type = "submit";
  const reset = node("button", "secondary-button", en ? "New source" : "新增来源");
  reset.type = "button";
  formActions.append(save, reset);
  form.append(formActions);
  const formStatus = node("p", "form-status");
  formStatus.setAttribute("role", "status");
  formStatus.setAttribute("aria-live", "polite");
  form.append(formStatus);

  const listSection = node("section", "role-source-admin-list-section");
  const listHeader = node("div", "panel-head");
  const listHeaderCopy = node("div");
  listHeaderCopy.append(node("span", "section-kicker", en ? "Background worker" : "后台同步"));
  listHeaderCopy.append(node("h2", "", en ? "Configured sources" : "已配置来源"));
  listHeader.append(listHeaderCopy);
  listSection.append(listHeader);
  listSection.append(node("p", "role-source-admin-note", en
    ? "Updates run only when started here. Sync and reindex tasks run on the Team Site server."
    : "来源仅在此处手动更新；同步和重新索引任务由 Team Site 服务端执行。"));
  const sourceList = node("div", "role-source-admin-list");
  sourceList.setAttribute("aria-live", "polite");
  sourceList.append(node("p", "project-loading", en ? "Loading sources…" : "正在读取来源…"));
  listSection.append(sourceList);
  layout.append(form, listSection);
  page.append(layout);
  root.append(page);

  let selectedId = "";
  let sources = [];
  const resetForm = () => {
    selectedId = "";
    form.reset();
    sourceId.value = "agency-agents";
    name.value = "Agency Agents";
    gitUrl.value = "https://github.com/msitarzewski/agency-agents.git";
    branch.value = "main";
    adapter.value = "agency-agents-markdown";
    sourceId.disabled = false;
    gitUrl.disabled = false;
    branch.disabled = false;
    adapter.disabled = false;
    gitDetails.hidden = false;
    gitDetails.open = false;
    enabled.checked = true;
    formStatus.textContent = "";
    save.textContent = en ? "Save source" : "保存来源";
  };
  const fillForm = (source) => {
    selectedId = source.sourceId;
    sourceId.value = source.sourceId;
    name.value = source.name || source.sourceId;
    gitUrl.value = source.gitUrl;
    branch.value = source.branch;
    adapter.value = source.adapterId;
    enabled.checked = source.enabled !== false;
    sourceId.disabled = true;
    gitUrl.disabled = true;
    branch.disabled = true;
    adapter.disabled = true;
    gitDetails.hidden = true;
    save.textContent = en ? "Save changes" : "保存修改";
    formStatus.textContent = "";
  };
  const renderSources = () => {
    sourceList.replaceChildren();
    if (!sources.length) {
      sourceList.append(node("p", "empty-note", en ? "No role sources configured." : "尚未配置角色来源。"));
      return;
    }
    for (const source of sources) {
      const row = node("article", "role-source-admin-row");
      const summary = node("div", "role-source-admin-summary");
      const title = node("div", "role-source-admin-title");
      title.append(node("strong", "", source.name || source.sourceId));
      title.append(node("code", "", source.sourceId));
      title.append(node("span", "status-chip " + (source.enabled ? "confirmed" : "warning"), source.enabled ? (en ? "Enabled" : "已启用") : (en ? "Paused" : "已停用")));
      summary.append(title);
      summary.append(node("p", "role-source-admin-state", sourceStatus(source, en)));
      const facts = [
        (en ? "Updated: " : "更新时间：") + dateLabel(source.syncStatus?.lastSuccessAt || source.updatedAt, locale),
        "Commit: " + (source.commit ? source.commit.slice(0, 12) : "—"),
        source.inventory
          ? source.inventory.readyRoles + (en ? " ready · " : " 个可用 · ") + source.inventory.unsupportedCandidates + (en ? " to review" : " 个待检查")
          : (en ? "No index" : "尚无索引")
      ];
      summary.append(node("p", "role-source-admin-facts", facts.join(" · ")));
      if (source.syncStatus?.lastError) summary.append(node("p", "role-source-admin-error", source.syncStatus.lastError));
      const actions = node("div", "role-source-admin-actions");
      const edit = node("button", "text-button", en ? "Edit" : "编辑");
      edit.type = "button";
      edit.addEventListener("click", () => fillForm(source));
      const sync = node("button", "secondary-button", en ? "Sync now" : "立即同步");
      sync.type = "button";
      sync.disabled = !source.enabled || source.syncStatus?.state === "running";
      sync.addEventListener("click", () => void trigger(source.sourceId, "sync"));
      const reindex = node("button", "secondary-button", en ? "Reindex" : "重新索引");
      reindex.type = "button";
      reindex.disabled = !source.enabled || source.syncStatus?.state === "running";
      reindex.addEventListener("click", () => void trigger(source.sourceId, "reindex"));
      actions.append(edit, sync, reindex);
      row.append(summary, actions);
      sourceList.append(row);
    }
  };
  const refresh = async () => {
    const payload = await request("/api/v1/platform/role-sources");
    sources = Array.isArray(payload.sources) ? payload.sources : [];
    renderSources();
  };
  async function trigger(id, operation) {
    formStatus.textContent = en ? "Starting background task…" : "正在启动后台任务…";
    try {
      await request("/api/v1/platform/role-sources/" + encodeURIComponent(id) + "/" + operation, "POST", {});
      await refresh();
      formStatus.textContent = en ? "Background task queued." : "后台任务已启动。";
    } catch (error) { formStatus.textContent = error.message; }
  }
  reset.addEventListener("click", resetForm);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    const body = { name: name.value.trim(), enabled: enabled.checked };
    const path = selectedId
      ? "/api/v1/platform/role-sources/" + encodeURIComponent(selectedId)
      : "/api/v1/platform/role-sources";
    if (!selectedId) Object.assign(body, { sourceId: sourceId.value.trim(), gitUrl: gitUrl.value.trim(), branch: branch.value.trim(), adapterId: adapter.value });
    formStatus.textContent = en ? "Saving…" : "正在保存…";
    try {
      await request(path, selectedId ? "PUT" : "POST", body);
      formStatus.textContent = en ? "Saved." : "已保存。";
      await refresh();
      if (!selectedId) resetForm();
    } catch (error) { formStatus.textContent = error.message; }
    finally { save.disabled = false; }
  });
  try { await refresh(); }
  catch (error) { sourceList.replaceChildren(node("p", "run-error", error.message)); }
  activePoller = setInterval(() => {
    if (location.pathname !== "/platform/role-sources") { clearInterval(activePoller); activePoller = undefined; return; }
    if (sources.some((source) => source.syncStatus?.state === "running")) void refresh().catch(() => {});
  }, 3000);
}
