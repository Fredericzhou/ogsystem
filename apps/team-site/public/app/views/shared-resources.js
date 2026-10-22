import { pageFetch } from "../api.js";
import { esc } from "../components/dom.js";

const labels = {
  zh: {
    models: ["模型目录", "共享执行底座发现的模型与可运行状态。模型凭据和连通性由底座管理。"],
    data: ["共享数据", "发布并核验不可变的数据集版本。项目 Materials 与此目录分开保存；数据集不会自动注入任务或仿真。"],
    tools: ["工具目录", "登记团队可引用的工具能力。密钥只接受凭据引用，不在此处保存明文。"],
    storage: ["存储目标", "登记受控的外部存储目标。项目成果与运行证据仍由 Projects 自己持有。"],
    roles: ["角色仓库", "管理可复用的角色模板。选用后会复制到团队草稿；再在图上连接角色并编辑配置，不会修改模板。"]
  },
  en: {
    models: ["Model catalog", "Models discovered by the shared execution base, with current availability."],
    data: ["Shared data", "Publish and verify immutable dataset versions. Project Materials remain separate; datasets are not automatically injected into tasks or simulations."],
    tools: ["Tool catalog", "Register tool capabilities that teams may reference. Store credential references, never plaintext secrets."],
    storage: ["Storage targets", "Register controlled external storage targets. Project deliverables and run evidence remain Project-owned."],
    roles: ["Role repository", "Manage reusable role templates. A selected template is copied into a team draft; connect and configure the role there. The template stays unchanged."]
  }
};

function pageHeading(section, locale) {
  const [title, description] = labels[locale === "en" ? "en" : "zh"][section];
  return `<section class="page-heading library-heading"><div><div class="eyebrow">${section === "roles" ? "OGS Studio" : "OGSystem · 要素配置"}</div><h1>${title}</h1><p>${description}</p></div></section>`;
}

async function jsonRequest(path, method, body) {
  const response = await pageFetch(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function renderCatalogPage(root, section, locale) {
  const tools = section === "tools";
  const title = tools ? (locale === "en" ? "Tool" : "工具") : (locale === "en" ? "Storage target" : "存储目标");
  const path = tools ? "/api/v1/platform/tools" : "/api/v1/platform/storage-targets";
  const typeOptions = tools
    ? '<option value="exec">Command line</option><option value="http">HTTP</option><option value="mcp">MCP</option>'
    : '<option value="database">Database</option><option value="object">Object storage</option><option value="http">HTTP</option>';
  const listId = "shared-resource-list";
  root.innerHTML = `${pageHeading(section, locale)}<div class="shared-resource-layout"><form id="shared-resource-form" class="project-panel compact-form"><div class="panel-head"><div><span class="section-kicker">${locale === "en" ? "Catalog entry" : "目录条目"}</span><h2>${locale === "en" ? `Register ${title.toLowerCase()}` : `登记${title}`}</h2></div></div><label>${locale === "en" ? "ID" : "标识"}<input name="id" required pattern="[a-z0-9][a-z0-9-]{0,79}" maxlength="80"></label><label>${locale === "en" ? "Name" : "名称"}<input name="name" required maxlength="120"></label><label>${locale === "en" ? "Type" : "类型"}<select name="type">${typeOptions}</select></label><label>${locale === "en" ? "Description" : "说明"}<textarea name="description" rows="3" maxlength="1000"></textarea></label>${tools ? '<label>Capabilities<input name="capabilities" placeholder="text, files, search"></label>' : '<label>Credential reference<input name="credentialRef" maxlength="200" placeholder="vault/provider/credential-id"><small class="field-hint">Never enter a secret value here.</small></label>'}<label class="field checkbox"><input name="enabled" type="checkbox" checked><span>${locale === "en" ? "Enabled" : "启用"}</span></label><button class="primary-button" type="submit">${locale === "en" ? "Save entry" : "保存条目"}</button><p class="form-status" id="shared-resource-status" role="status" aria-live="polite"></p></form><section><div class="panel-head"><div><span class="section-kicker">${locale === "en" ? "Registered" : "已登记"}</span><h2>${locale === "en" ? `${title}s` : `${title}目录`}</h2></div></div><div id="${listId}" class="shared-resource-list" role="list"><p class="project-loading">${locale === "en" ? "Loading…" : "正在读取…"}</p></div></section></div>`;
  const list = root.querySelector(`#${listId}`);
  const refresh = async () => {
    const payload = await jsonRequest(path, "GET");
    const items = tools ? payload.tools : payload.storageTargets;
    list.innerHTML = items.length ? items.map((item) => `<article class="shared-resource-row" role="listitem"><div><strong>${esc(item.name)}</strong><code>${esc(item.id)}</code><p>${esc(item.description || "")}</p></div><span class="status-chip ${item.enabled ? "confirmed" : "warning"}">${esc(item.type)} · ${item.enabled ? (locale === "en" ? "Enabled" : "启用") : (locale === "en" ? "Disabled" : "停用")}</span></article>`).join("") : `<p class="empty-note">${locale === "en" ? "No entries yet." : "尚无登记条目。"}</p>`;
  };
  root.querySelector("#shared-resource-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = root.querySelector("#shared-resource-status");
    const data = new FormData(form);
    const body = Object.fromEntries(data.entries());
    body.enabled = data.get("enabled") === "on";
    if (tools) body.capabilities = String(body.capabilities || "").split(",").map((item) => item.trim()).filter(Boolean);
    status.textContent = locale === "en" ? "Saving…" : "正在保存…";
    try { await jsonRequest(path, "PUT", body); status.textContent = locale === "en" ? "Saved." : "已保存。"; form.reset(); await refresh(); }
    catch (error) { status.textContent = error.message; }
  });
  void refresh().catch((error) => { list.innerHTML = `<p class="run-error">${esc(error.message)}</p>`; });
}

function renderDatasetPage(root, locale) {
  root.innerHTML = `${pageHeading("data", locale)}<div class="shared-resource-layout"><form id="dataset-form" class="project-panel compact-form"><div class="panel-head"><div><span class="section-kicker">${locale === "en" ? "Immutable snapshot" : "不可变快照"}</span><h2>${locale === "en" ? "Publish dataset version" : "发布数据集版本"}</h2></div></div><label>${locale === "en" ? "Dataset ID" : "数据集标识"}<input name="resourceId" required pattern="[a-z0-9][a-z0-9-]{0,79}"></label><label>${locale === "en" ? "Version ID" : "版本标识"}<input name="versionId" required pattern="[a-z0-9][a-z0-9-]{0,79}"></label><label>${locale === "en" ? "Display name" : "显示名称"}<input name="name" maxlength="120"></label><label>${locale === "en" ? "Files as JSON object" : "文件内容（JSON 对象）"}<textarea name="files" rows="10" required spellcheck="false">{"README.md":"Shared reference data"}</textarea><small class="field-hint">${locale === "en" ? "Keys are relative file paths. Published versions cannot be overwritten." : "键为相对文件路径。已发布版本不能覆盖。"}</small></label><button class="primary-button" type="submit">${locale === "en" ? "Publish version" : "发布版本"}</button><p class="form-status" id="dataset-status" role="status" aria-live="polite"></p></form><section><div class="panel-head"><div><span class="section-kicker">${locale === "en" ? "Published snapshots" : "已发布快照"}</span><h2>${locale === "en" ? "Dataset versions" : "数据集版本"}</h2></div></div><div id="dataset-list" class="shared-resource-list"><p class="project-loading">${locale === "en" ? "Loading…" : "正在读取…"}</p></div></section></div>`;
  const list = root.querySelector("#dataset-list");
  const refresh = async () => {
    const payload = await jsonRequest("/api/v1/platform/data-sets", "GET");
    list.innerHTML = payload.datasets.length ? payload.datasets.map((dataset) => `<article class="shared-resource-row"><div><strong>${esc(dataset.name)}</strong><code>${esc(dataset.resourceId)} · ${esc(dataset.versionId)}</code><p>${dataset.files.length} files · SHA-256 ${esc(dataset.digest)}</p></div><span class="status-chip confirmed">${locale === "en" ? "Read only" : "只读"}</span></article>`).join("") : `<p class="empty-note">${locale === "en" ? "No published datasets." : "尚无已发布数据集。"}</p>`;
  };
  root.querySelector("#dataset-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const status = root.querySelector("#dataset-status");
    let files;
    try { files = Object.entries(JSON.parse(fields.get("files"))).map(([path, content]) => ({ path, content })); }
    catch { status.textContent = locale === "en" ? "Files must be a JSON object of path to text content." : "文件内容必须是“路径: 文本内容”的 JSON 对象。"; return; }
    status.textContent = locale === "en" ? "Publishing…" : "正在发布…";
    try {
      await jsonRequest("/api/v1/platform/data-sets/versions", "POST", { resourceId: fields.get("resourceId"), versionId: fields.get("versionId"), name: fields.get("name"), files });
      status.textContent = locale === "en" ? "Immutable version published." : "不可变版本已发布。";
      await refresh();
    } catch (error) { status.textContent = error.message; }
  });
  void refresh().catch((error) => { list.innerHTML = `<p class="run-error">${esc(error.message)}</p>`; });
}

async function renderRoleRepository(root, locale, navigate) {
  root.innerHTML = `${pageHeading("roles", locale)}<section class="project-library-toolbar studio-repository-toolbar"><div><strong>${locale === "en" ? "Versioned role assets" : "版本化角色资产"}</strong><span>${locale === "en" ? "Templates are read-only; each use creates a team draft copy." : "模板只读；每次选用都会复制到团队草稿。"}</span></div><a class="secondary-button" href="/studio" data-route="/studio">${locale === "en" ? "Team repository" : "团队仓库"}</a></section><div class="shared-role-layout"><form id="role-template-form" class="project-panel compact-form"><div class="panel-head"><div><span class="section-kicker">${locale === "en" ? "New template version" : "新建模板版本"}</span><h2>${locale === "en" ? "Publish role template" : "发布角色模板"}</h2></div></div><label>${locale === "en" ? "Role ID" : "角色标识"}<input name="roleId" required pattern="[a-z0-9][a-z0-9-]{0,79}"></label><label>${locale === "en" ? "Version ID" : "版本标识"}<input name="versionId" required pattern="[a-z0-9][a-z0-9-]{0,79}"></label><label>${locale === "en" ? "Name" : "名称"}<input name="name" required maxlength="120"></label><label>${locale === "en" ? "Category" : "分类"}<input name="category" maxlength="80"></label><label>${locale === "en" ? "Description" : "说明"}<textarea name="description" rows="3" maxlength="1000"></textarea></label><label>${locale === "en" ? "Role files as JSON object" : "角色文件（JSON 对象）"}<textarea name="assets" rows="11" required spellcheck="false">{"prompt.md":"Describe the role's responsibilities and output."}</textarea><small class="field-hint">agent.md, prompt.md, role.json, output.schema.json</small></label><button class="primary-button" type="submit">${locale === "en" ? "Publish template" : "发布模板"}</button><p class="form-status" id="role-template-status" role="status" aria-live="polite"></p></form><section><div class="panel-head"><div><span class="section-kicker">${locale === "en" ? "Available templates" : "可用模板"}</span><h2>${locale === "en" ? "Role repository" : "角色模板"}</h2></div></div><div id="role-template-list" class="shared-resource-list"><p class="project-loading">${locale === "en" ? "Loading…" : "正在读取…"}</p></div></section></div>`;
  const list = root.querySelector("#role-template-list");
  let templates = [];
  let drafts = [];
  const refresh = async () => {
    const [rolePayload, teamPayload] = await Promise.all([
      jsonRequest("/api/v1/studio/role-repository", "GET"),
      jsonRequest("/api/v1/team-repository?status=all&pageSize=100", "GET")
    ]);
    templates = rolePayload.templates || [];
    drafts = (teamPayload.teams || []).filter((team) => !team.teamProjectId && !team.builtIn && ["draft", "editing"].includes(team.teamVersionStatus || team.projectStatus));
    list.innerHTML = templates.length ? templates.map((template, index) => `<article class="shared-resource-row shared-role-row"><div><strong>${esc(template.name)}</strong><code>${esc(template.roleId)} · ${esc(template.versionId)}</code><p>${esc(template.description || "")} · ${esc(template.category || "general")} · ${template.assets.length} files</p></div><form class="role-template-use" data-template-index="${index}"><label><span class="sr-only">${locale === "en" ? "Team draft" : "团队草稿"}</span><select name="teamVersionId" required><option value="">${locale === "en" ? "Choose a team draft" : "选择团队草稿"}</option>${drafts.map((team) => `<option value="${esc(team.projectId || team.teamVersionId)}">${esc(team.name || team.teamName)} · v${team.teamVersionNumber || 1}</option>`).join("")}</select></label><label><span class="sr-only">${locale === "en" ? "Role ID in team" : "团队内角色标识"}</span><input name="targetRoleId" required pattern="[a-z][a-z0-9_-]{0,79}" value="${esc(template.roleId)}"></label><button class="secondary-button" type="submit" ${drafts.length ? "" : "disabled"}>${locale === "en" ? "Use in draft" : "复制到草稿"}</button></form></article>`).join("") : `<p class="empty-note">${locale === "en" ? "No role templates yet." : "尚无角色模板。"}</p>`;
    list.querySelectorAll(".role-template-use").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const template = templates[Number(form.dataset.templateIndex)];
      const query = new URLSearchParams({ roleTemplate: template.roleId, version: template.versionId, roleId: String(data.get("targetRoleId")) });
      navigate(`/studio/teams/${encodeURIComponent(data.get("teamVersionId"))}/design?${query}`);
    }));
  };
  root.querySelector("#role-template-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const status = root.querySelector("#role-template-status");
    let assets;
    try { assets = JSON.parse(data.get("assets")); }
    catch { status.textContent = locale === "en" ? "Role files must be a JSON object." : "角色文件必须是 JSON 对象。"; return; }
    status.textContent = locale === "en" ? "Publishing…" : "正在发布…";
    try {
      await jsonRequest("/api/v1/studio/role-repository", "POST", { roleId: data.get("roleId"), versionId: data.get("versionId"), metadata: { name: data.get("name"), category: data.get("category"), description: data.get("description") }, assets });
      status.textContent = locale === "en" ? "Immutable template version published." : "不可变角色模板版本已发布。";
      await refresh();
    } catch (error) { status.textContent = error.message; }
  });
  void refresh().catch((error) => { list.innerHTML = `<p class="run-error">${esc(error.message)}</p>`; });
}

export function renderSharedResourcePage(root, section, locale = "zh-CN", navigate = (path) => { location.href = path; }) {
  if (section === "roles") return renderRoleRepository(root, locale === "en" ? "en" : "zh", navigate);
  if (section === "data") return renderDatasetPage(root, locale === "en" ? "en" : "zh");
  renderCatalogPage(root, section, locale === "en" ? "en" : "zh");
}
