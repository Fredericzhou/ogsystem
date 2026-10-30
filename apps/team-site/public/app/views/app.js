import { state, beginPageRequest, isCurrentRequest, isAbort, setDirty, clearDirty, isDirty } from "../state.js";
import { pageFetch } from "../api.js";
import { $, $$, esc, icon } from "../components/dom.js";
import { pageFrame, frameExistingPage } from "../components/page-frame.js";
import { bindDirtyForm, confirmAction, lockBodyScroll, trapFocus } from "../components/interaction.js";
import { createRunPoller, isTerminalRunStatus } from "../components/run-poll.js";
import { labelEvent as localizedEventLabel, text } from "../i18n.js";
import { createRouter } from "../router.js";
import { renderSharedResourcePage } from "./shared-resources.js";
import { renderPlatformRoleSources } from "./platform-role-sources.js";
import { END_ID, START_ID, applyTeamIrPatch, graphAuthoringToTeamIr, readGraphLayout, teamIrToGraphAuthoring, writeGraphLayout } from "../team-ir-graph-adapter.js";
let studioGraphLoad;
const mountedStudioGraphs = new Set();
let fallbackUuidCounter = 0;
function createUuid() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((byte, index) => `${[4, 6, 8, 10].includes(index) ? "-" : ""}${byte.toString(16).padStart(2, "0")}`).join("");
  }
  fallbackUuidCounter += 1;
  return `fallback-${Date.now().toString(36)}-${fallbackUuidCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function ensureStudioGraphBundle() {
  if (window.OGSStudioGraphBundle?.mountStudioX6Bridge) return Promise.resolve();
  if (!studioGraphLoad) studioGraphLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/ogs-studio-graph.js";
    script.onload = () => resolve();
    script.onerror = () => { studioGraphLoad = null; reject(new Error("Studio graph engine could not be loaded.")); };
    document.head.append(script);
  });
  return studioGraphLoad;
}
function mountStudioGraph(root, options) {
  const mount = window.OGSStudioGraphBundle?.mountStudioX6Bridge;
  if (!mount) return undefined;
  let currentOptions = { ...options };
  mount(root, currentOptions);
  mountedStudioGraphs.add(root);
  return Object.freeze({
    update(changes) {
      currentOptions = { ...currentOptions, ...changes };
      mount(root, currentOptions);
    },
    setRuntimeProgress(events) { window.OGSStudioGraphBundle?.setStudioX6RuntimeProgress?.(root, events); },
    focusRuntimeHandoff(handoffId) { window.OGSStudioGraphBundle?.focusStudioX6RuntimeHandoff?.(root, handoffId); }
  });
}
function disposeStudioGraphs() {
  const dispose = window.OGSStudioGraphBundle?.disposeStudioX6Bridge;
  for (const stage of mountedStudioGraphs) dispose?.(stage);
  mountedStudioGraphs.clear();
}
function professionalWorkspaceUrl(projectId, runId = "") {
  if (!projectId || !runId) return "";
  return `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`;
}
const themeStorageKey = "ogs.visualizer.theme";
const navStorageKey = "ogs.team-site.nav-state";
let navPreferenceStored = false;
let mobileNavReleaseTrap;
let mobileNavReleaseScroll;
const copy = {
  "zh-CN": {
    "workspaceName": "个人工作台",
    "workspaceType": "本机工作区",
    "navTeams": "团队仓库",
    "navRuns": "最近运行",
    "runtimeReady": "运行服务就绪",
    "crumbHome": "首页",
    "guestMode": "本机运行",
    "libraryEyebrow": "团队仓库案例",
    "libraryTitle": "已发布团队版本",
    "libraryIntro": "选择已发布团队版本，开始管理项目任务。",
    "caseBackground": "场景背景",
    "caseProblem": "适合解决",
    "caseCollaboration": "协作过程",
    "caseDeliverable": "预期成果",
    "caseRoles": "团队分工",
    "useCase": "使用这个团队",
    "backCases": "返回全部团队",
    "detailEyebrow": "团队仓库案例",
    "runHistoryEyebrow": "最近运行",
    "historyTitle": "最近运行",
    "historyIntro": "按任务查看团队运行结果。",
    "noHistory": "还没有项目运行记录。完成一次项目任务后，这里会显示团队、版本和任务序号。",
    "historyRestore": "查看运行",
    "navProjects": "协作项目",
    "navStudioRepository": "Studio 团队",
    "navRoleRepository": "角色仓库",
    "navModels": "模型服务",
    "navPlatform": "平台配置",
    "navRoleSources": "角色源配置"
  },
  "en": {
    "workspaceName": "My workspace",
    "workspaceType": "Local workspace",
    "navTeams": "Team repository",
    "navRuns": "Recent runs",
    "runtimeReady": "Service ready",
    "crumbHome": "Home",
    "guestMode": "Local runtime",
    "libraryEyebrow": "Team repository examples",
    "libraryTitle": "Released team versions",
    "libraryIntro": "Choose a released team version to start a project.",
    "caseBackground": "Background",
    "caseProblem": "When to use it",
    "caseCollaboration": "How the team works",
    "caseDeliverable": "Expected outcome",
    "caseRoles": "Team responsibilities",
    "useCase": "Use this team",
    "backCases": "All teams",
    "detailEyebrow": "Team repository example",
    "runHistoryEyebrow": "Recent runs",
    "historyTitle": "Recent runs",
    "historyIntro": "Review team runs by task.",
    "noHistory": "No project runs yet. Complete a project task to see its team, version, and task number here.",
    "historyRestore": "View run",
    "navProjects": "Collaboration projects",
    "navStudioRepository": "Studio teams",
    "navRoleRepository": "Role repository",
    "navModels": "Model services",
    "navPlatform": "Platform settings",
    "navRoleSources": "Role sources"
  }
};
function syncThemeControls(theme = document.documentElement.dataset.visualizerTheme || "light") {
  const labels = state.locale === "zh-CN" ? { light: "浅色模式", dark: "深色模式" } : { light: "Light mode", dark: "Dark mode" };
  const toggle = $("#site-theme-toggle");
  if (toggle) {
    const target = theme === "dark" ? "light" : "dark";
    const label = state.locale === "zh-CN" ? `切换到${labels[target]}模式` : `Switch to ${labels[target].toLowerCase()} mode`;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
  }
  $$(".theme-switch").forEach((group) => group.setAttribute("aria-label", state.locale === "zh-CN" ? "显示模式" : "Display mode"));
  $$("[data-site-theme-choice]").forEach((button) => {
    const choice = button.dataset.siteThemeChoice;
    const active = choice === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("aria-label", labels[choice]);
    button.setAttribute("title", labels[choice]);
  });
}
function applySiteTheme(theme, persist = true) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.visualizerTheme = nextTheme;
  if (persist) {
    try { localStorage.setItem(themeStorageKey, nextTheme); } catch {}
  }
  syncThemeControls(nextTheme);
  document.dispatchEvent(new CustomEvent("ogs-visualizer-theme-change", { detail: { theme: nextTheme } }));
}

Object.assign(copy["zh-CN"], {
  libraryEyebrow: "团队仓库", libraryTitle: "已发布团队版本",
  navRuns: "运行历史",
  libraryIntro: "选择已发布团队版本，开始管理项目任务。", factoryEyebrow: "OGS Studio",
  factoryTitle: "设计与发布团队", factoryIntro: "在 OGS Studio 中创建 Team IR v2 草稿，编辑协作结构，运行仿真并发布团队版本。",
  caseScenario: "示例任务",
  noReleasedTeams: "还没有已发布的团队版本", createTeam: "创建团队",
  continueEditing: "继续设计", editAsVersion: "编辑团队", archiveVersion: "停用团队",
  releasedLabel: "已发布",
  archivedLabel: "已归档", useTeam: "创建项目", repositoryEmptyHint: "先创建并发布团队。",
  deleteTeam: "删除团队", deleteProject: "删除项目", confirmDeleteProject: "确定删除项目“{name}”及其任务、运行记录和资料吗？此操作不可撤销。", teamDeleted: "团队及其版本已删除", projectDeleted: "项目及其资料已删除",
  runRound: "任务 {round}",
  historyIntro: "按任务查看团队运行结果。",
  noHistory: "还没有项目运行记录。完成一次项目任务后，这里会显示团队、版本和任务序号。",
  targetHint: "请包含目标、角色关系、大致流程、输入材料和期望输出，便于自动生成团队结构。",
  advancedWorkspace: "查看全流程"
});
Object.assign(copy.en, {
  libraryEyebrow: "Team repository", libraryTitle: "Released team versions",
  navRuns: "Run history",
  libraryIntro: "Choose a released team version to start a project.", factoryEyebrow: "OGS Studio",
  factoryTitle: "Design and release teams", factoryIntro: "Create a Team IR v2 draft, edit its collaboration structure, run a simulation, and release the team in OGS Studio.",
  caseScenario: "Example task",
  noReleasedTeams: "No released team versions yet", createTeam: "Create team",
  continueEditing: "Continue design", editAsVersion: "Edit team", archiveVersion: "Deactivate team",
  releasedLabel: "Released",
  archivedLabel: "Archived", useTeam: "Create project", repositoryEmptyHint: "Create and release a team first.",
  deleteTeam: "Delete team", deleteProject: "Delete project", confirmDeleteProject: "Delete project “{name}” and its tasks, runs, and materials? This cannot be undone.", teamDeleted: "Team and versions deleted", projectDeleted: "Project and materials deleted",
  runRound: "Task {round}",
  historyIntro: "Review team runs by task.",
  noHistory: "No project runs yet. Complete a project task to see its team, version, and task number here.",
  targetHint: "Include the goal, role relationships, rough workflow, inputs, and expected outputs so the team structure can be generated accurately.",
  advancedWorkspace: "View full run"
});

const graphLabels = {
  "zh-CN": {
    viewportGroup: "图谱视图", editGroup: "编辑图谱", teamConfiguration: "团队配置",
    zoomOut: "缩小", zoomIn: "放大", resetView: "重置缩放", fullscreen: "全屏", fitView: "适应画布",
    autoLayout: "自动布局", layoutModeFlow: "流程布局", layoutModeCompact: "紧凑布局", layoutModeStacked: "分层布局",
    topologyOrder: "流转顺序", technicalDetails: "Handoff 编号", enabled: "开启", disabled: "关闭",
    layoutSwitched: "已切换为{layout}布局", generate: "AI 构建", debugRun: "仿真", close: "关闭", debugRunShort: "仿真",
    quickOpen: "快速定位", quickOpenPlaceholder: "搜索 Agent 或 Handoff", quickOpenEmpty: "没有匹配的 Agent 或 Handoff。",
    quickOpenRole: "Agent", quickOpenFlow: "Handoff", contextEditRole: "编辑 Agent", contextEditFlow: "编辑 Handoff",
    contextInsertRole: "插入 Agent", contextDelete: "删除", minimap: "图谱导航", addRole: "新增 Agent", addEdge: "新增 Handoff",
    editSelection: "编辑所选", editRole: "编辑 Agent", editEdge: "编辑 Handoff", deleteSelection: "删除所选", undo: "撤销", redo: "重做",
    validateWorkbench: "校验", saveWorkbench: "保存", ready: "就绪", graphUnavailable: "图谱不可用", graphReady: "图谱已载入",
    fixMermaidBeforeGraphEditing: "请先修复结构诊断，再编辑图谱。", noRolesAvailable: "请先添加 Agent。", selectRoleBeforeAddingEdge: "请先选择 Agent，再新增 Handoff。",
    invalidConnection: "无效的 Handoff 端点。", entryRoleDeletionBlocked: "不能删除入口 Agent。", invalidEdgeEndpoints: "Handoff 端点无效。",
    duplicateRoleId: "Agent ID 已存在。", invalidRoleId: "Agent ID 格式无效。", duplicateEdge: "该 Handoff 已存在。", invalidEventType: "输出 Port 无效。",
    deleteRoleConfirm: "确定删除 Agent {roleId} 吗？", editBlocked: "通过结构校验后才能编辑图谱。", exportPng: "导出 PNG", boundaryEntry: "Run", boundaryEnd: "Result"
  },
  en: {
    viewportGroup: "Graph view", editGroup: "Edit graph", teamConfiguration: "Team configuration",
    zoomOut: "Zoom out", zoomIn: "Zoom in", resetView: "Reset zoom", fullscreen: "Fullscreen", fitView: "Fit graph",
    autoLayout: "Auto layout", layoutModeFlow: "Flow layout", layoutModeCompact: "Compact layout", layoutModeStacked: "Layered layout",
    topologyOrder: "Handoff order", technicalDetails: "Handoff ID", enabled: "On", disabled: "Off", layoutSwitched: "Switched to {layout} layout",
    generate: "AI Build", debugRun: "Simulation", close: "Close", debugRunShort: "Simulation", quickOpen: "Quick locate",
    quickOpenPlaceholder: "Search Agents or Handoffs", quickOpenEmpty: "No matching Agents or Handoffs.", quickOpenRole: "Agent", quickOpenFlow: "Handoff",
    contextEditRole: "Edit Agent", contextEditFlow: "Edit Handoff", contextInsertRole: "Insert Agent", contextDelete: "Delete", minimap: "Graph navigator",
    addRole: "Add Agent", addEdge: "Add Handoff", editSelection: "Edit selected", editRole: "Edit Agent", editEdge: "Edit Handoff", deleteSelection: "Delete selected",
    undo: "Undo", redo: "Redo", validateWorkbench: "Validate", saveWorkbench: "Save", ready: "Ready", graphUnavailable: "Graph unavailable", graphReady: "Graph loaded",
    fixMermaidBeforeGraphEditing: "Fix structural diagnostics before editing the graph.", noRolesAvailable: "Add an Agent first.", selectRoleBeforeAddingEdge: "Select an Agent before adding a Handoff.",
    invalidConnection: "Invalid Handoff endpoints.", entryRoleDeletionBlocked: "The entry Agent cannot be deleted.", invalidEdgeEndpoints: "Invalid Handoff endpoints.",
    duplicateRoleId: "Agent ID already exists.", invalidRoleId: "Invalid Agent ID.", duplicateEdge: "That Handoff already exists.", invalidEventType: "Invalid output Port.",
    deleteRoleConfirm: "Delete Agent {roleId}?", editBlocked: "Pass structural validation before editing the graph.", exportPng: "Export PNG", boundaryEntry: "Run", boundaryEnd: "Result"
  }
};

function labelEvent(event) { return localizedEventLabel(event, copy); }

function renderPageFrame(root, template, renderPromise) {
  const route = location.pathname;
  const isStudioCreate = route === "/studio/new";
  const studioWorkspace = route.match(/^\/studio\/teams\/([a-z0-9-]+)\/(info|run|release)(?:\/[a-z0-9-]+)?$/);
  const workspaceTabs = studioWorkspace ? `<div class="studio-workspace-tabs">${studioWorkspaceNav(studioWorkspace[1], studioWorkspace[2])}</div>` : "";
  const projectWorkspaceTabs = root.id === "project-workspace-view" && /^\/projects\/[a-z0-9-]+(?:\/runs\/[A-Za-z0-9._-]+)?$/.test(route)
    ? `<div class="project-workspace-tabs"><a href="#project-info-panel" data-project-workspace-tab="overview">概况</a><a href="#project-resources-panel" data-project-workspace-tab="materials">资料</a><a href="#project-run-panel" data-project-workspace-tab="tasks">任务与运行</a><a href="#project-team-heading" data-project-workspace-tab="teams">团队</a></div>`
    : "";
  const tabs = workspaceTabs || projectWorkspaceTabs;
  const aside = template === "E" ? (isStudioCreate
    ? ""
    : '<aside class="page-frame-aside"><h2>创建项目</h2><ol><li>填写项目名称和业务目标</li><li>选择项目可使用的已发布团队</li><li>创建后添加资料并建立任务</li></ol></aside>') : "";
  frameExistingPage(root, template, aside, tabs);
  if (isStudioCreate) {
    const firstStep = root.querySelector(".page-frame-aside li");
    if (firstStep) firstStep.textContent = state.locale === "en" ? "Describe the team goal" : "描述团队目标";
  }
  Promise.resolve(renderPromise).then(() => {
    if (location.pathname === route && !root.classList.contains("hidden")) {
      frameExistingPage(root, template, aside, tabs);
      root.querySelectorAll("[data-project-workspace-tab]").forEach((link) => link.addEventListener("click", (event) => {
        event.preventDefault();
        const target = root.querySelector(link.getAttribute("href"));
        if (!target) return;
        target.scrollIntoView({ block: "start", behavior: "smooth" });
        root.querySelectorAll("[data-project-workspace-tab]").forEach((item) => item.removeAttribute("aria-current"));
        link.setAttribute("aria-current", "page");
      }));
    }
  }, () => {});
  return renderPromise;
}

function caseIcon(item) { return `<span class="case-icon case-icon-${esc(item.icon)}" aria-hidden="true">${icon[item.icon] || "✦"}</span>`; }
function renderDetail(item) {
  const details = item.detail;
  $("#case-detail-view").innerHTML = `
    <a class="detail-back" href="/teams" data-route="/teams">← ${esc(copy[state.locale].backCases)}</a>
    <header class="detail-heading" data-accent="${esc(item.accent)}">
      <div>${caseIcon(item)}<span class="eyebrow">${esc(copy[state.locale].detailEyebrow)} · ${esc(text(item.category))}</span></div>
      <h1>${esc(text(item.title))}</h1><p>${esc(text(item.short))}</p>
      <a class="primary-button" href="/teams?team=${esc(item.id)}" data-use-case="${esc(item.id)}">${esc(copy[state.locale].useCase)}</a>
    </header>
    <aside class="detail-scenario"><span>${esc(copy[state.locale].caseScenario)}</span><p>${esc(text(details.scenario))}</p></aside>
    <div class="detail-content">
      <section><span class="detail-index">01</span><div><h2>${esc(copy[state.locale].caseBackground)}</h2><p>${esc(text(details.background))}</p></div></section>
      <section><span class="detail-index">02</span><div><h2>${esc(copy[state.locale].caseProblem)}</h2><p>${esc(text(details.problem))}</p></div></section>
      <section><span class="detail-index">03</span><div><h2>${esc(copy[state.locale].caseCollaboration)}</h2><p>${esc(text(details.collaboration))}</p></div></section>
      <section><span class="detail-index">04</span><div><h2>${esc(copy[state.locale].caseDeliverable)}</h2><p>${esc(text(details.deliverable))}</p></div></section>
      <section class="detail-roles"><span class="detail-index">05</span><div><h2>${esc(copy[state.locale].caseRoles)}</h2><div class="detail-role-grid">${item.roles.map((role, index) => `<article><span class="member-avatar member-avatar-${index % 3}">${esc(icon[item.icon] || "✦")}</span><div><h3>${esc(text(role.label))}</h3><p>${esc(text(role.description))}</p></div></article>`).join("")}</div></div></section>
    </div>`;
  $("#breadcrumb-current").textContent = text(item.title);
  const detailRoot = $("#case-detail-view");
  const useLink = detailRoot.querySelector("[data-use-case]");
  if (useLink) {
    useLink.removeAttribute("data-use-case");
    useLink.dataset.caseAction = "use";
    useLink.dataset.caseId = item.id;
    useLink.href = "#";
    useLink.textContent = "使用这个团队";
    useLink.insertAdjacentHTML("afterend", "<button class=\"secondary-button\" type=\"button\" data-case-action=\"template\" data-case-id=\"" + esc(item.id) + "\">使用模板，创建新团队</button>");
  }
  detailRoot.querySelector(".detail-content")?.insertAdjacentHTML("beforebegin", "<section class=\"detail-graph-section\"><div class=\"detail-section-heading\"><div><span class=\"section-kicker\">团队协作结构</span><h2>团队协作结构</h2><p>先查看角色和交接关系，再决定直接使用，或复制为新团队进行微调。</p></div><span class=\"status-chip\">只读预览</span></div><div id=\"detail-graph-stage\" class=\"graph-stage detail-graph-stage\" role=\"img\" aria-label=\"Team collaboration graph\"></div></section>");
  detailRoot.querySelectorAll("[data-case-action]").forEach((element) => element.addEventListener("click", (event) => {
    event.preventDefault();
    void createProjectFromCase(element.dataset.caseId, element.dataset.caseAction, element);
  }));
  void renderDetailGraph(item);
}

async function renderDetailGraph(item) {
  const stage = $("#detail-graph-stage");

  try {
    const response = await pageFetch("/api/v1/cases/" + encodeURIComponent(item.id) + "/ir");
    const payload = await response.json();
    if (!response.ok || payload.teamIR?.schemaVersion !== 2) throw new Error(payload.error || "Unable to load the Team IR v2 fixture.");
    if (!stage.isConnected) return;
    stage.innerHTML = renderTeamIrStructureGraph(payload.teamIR, esc, false);
    stage.setAttribute("aria-label", state.locale === "en" ? "Team IR v2 structure" : "Team IR v2 协作结构");
  } catch (error) { if (isAbort(error)) return;
    stage.textContent = error.message || "Unable to load the team graph.";
  }
}

async function createProjectFromCase(caseId, action, button) {
  if (button) button.disabled = true;
  try {
    const response = await pageFetch("/api/v1/cases/" + encodeURIComponent(caseId) + "/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: state.locale }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法创建团队。");
    navigate(action === "use" ? "/projects/new?team=" + encodeURIComponent(payload.projectId) : "/studio/teams/" + encodeURIComponent(payload.projectId) + "/ir");
  } catch (error) { if (isAbort(error)) return;
    if (button) button.disabled = false;
    showToast(error.message || "无法创建团队。");
  }
}
function applyLocale() {
  document.documentElement.lang = state.locale;
  $$('[data-i18n]').forEach((element) => { const value = copy[state.locale][element.dataset.i18n]; if (value) element.innerHTML = value; });
  $$('[data-i18n-placeholder]').forEach((element) => { const value = copy[state.locale][element.dataset.i18nPlaceholder]; if (value) element.placeholder = value; });
  $("#locale-toggle").textContent = state.locale === "zh-CN" ? "中" : "EN";
  $("#locale-toggle")?.setAttribute("aria-label", state.locale === "zh-CN" ? "切换到英文" : "Switch to Chinese");
  $("#locale-toggle")?.setAttribute("title", state.locale === "zh-CN" ? "切换到英文" : "Switch to Chinese");
  syncNavigationLabels();
  syncThemeControls();
  setProductMode(document.documentElement.dataset.productMode || "normal", false);
  renderHistory();
  syncRoute();
}
function setView(view) {
  state.view = view;
  const viewMap = { projects: "projects-view", workspace: "workspace-view", studio: "studio-view", platform: "platform-view", history: "history-view", "new-project": "new-project-view", "project-workspace": "project-workspace-view" };
  Object.entries(viewMap).forEach(([key, id]) => document.getElementById(id)?.classList.toggle("hidden", key !== view));
  $("#case-detail-view")?.classList.add("hidden");
  const activeView = state.studioRoute ? (location.pathname === "/studio/new" ? "studio-create" : location.pathname === "/studio/roles" ? "studio-roles" : "studio") : view;
  $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView && !(activeView === "platform" && button.getAttribute("href") !== location.pathname)));
  const nav = $(`.nav-item[href="${location.pathname}"] [data-i18n]`) || $(`.nav-item[data-view="${activeView}"] [data-i18n]`);
  $("#breadcrumb-current").textContent = nav?.textContent || copy[state.locale].navTeams;
}
const router = createRouter({ syncRoute, canLeave: confirmRouteLeave, onRouteChange: closeActiveDialogs });
function navigate(path) { router.navigate(path); }
function withCurrentSearch(path) { return `${path}${location.search}`; }

async function confirmRouteLeave() {
  if (!isDirty()) return true;
  const confirmed = await confirmAction({
    title: state.locale === "en" ? "Unsaved changes" : "尚有未保存的修改",
    message: state.locale === "en" ? "Stay here and use Save changes, or discard them and leave." : "留在当前页面，点击“保存微调”保存；也可以放弃修改并离开。",
    confirmLabel: state.locale === "en" ? "Discard and leave" : "放弃并离开",
    cancelLabel: state.locale === "en" ? "Stay" : "留在当前页面"
  });
  if (confirmed) clearDirty();
  return confirmed;
}
function teamStatusMeta(status) {
  const labels = state.locale === "en"
    ? { draft: ["In design", "Continue editing"], invalid: ["Needs fixes", "Review structure"], validated: ["Structure validated", "Ready to release"], confirmed: ["Released", "Ready to create a project"], archived: ["Inactive", "View only"] }
    : { draft: ["设计中", "可继续编辑"], invalid: ["需要修复", "请检查结构"], validated: ["结构已验证", "可以发布版本"], confirmed: ["已发布", "可以创建项目"], archived: ["已停用", "仅供查看"] };
  const value = labels[status] || labels.draft;
  return { label: value[0], hint: value[1] };
}
function materialStatusLabel(status) {
  if (state.locale === "en") return ({ indexed: "Ready", pending: "Processing", failed: "Needs attention" })[status] || status || "Ready";
  return ({ indexed: "已就绪", pending: "处理中", failed: "需要处理" })[status] || status || "已就绪";
}
async function renderProjectCreate() {
  const root = $("#new-project-view");
  root.innerHTML = `<section class="page-heading project-create-heading"><div><a class="detail-back" href="/projects" data-route="/projects">← 协作项目</a><div class="eyebrow">OGS Projects · 业务协作</div><h1>创建协作项目</h1><p>项目管理生产资料、任务和成果。先在 OGS Studio 发布团队，再为项目选择团队版本。</p></div></section><section class="project-builder project-create-builder"><form id="collaboration-project-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">项目基础信息</span><h2>项目名称与概述</h2><p>项目与团队分别管理；每项任务会选择一个已挂载团队。</p></div><label>项目名称<input name="name" required maxlength="120" placeholder="例如：新产品上市项目"></label><label>项目概述（选填）<textarea name="overview" rows="4" maxlength="4000" placeholder="描述项目要完成的事情、阶段目标和预期成果"></textarea></label><fieldset class="builder-choice-group"><legend>选择已发布团队 <span>至少选择一个</span></legend><div id="project-team-options" class="builder-choice-grid"><span class="project-loading">正在读取团队仓库...</span></div></fieldset><div class="new-team-form-footer"><p class="form-hint">团队设计、仿真和发布由 OGS Studio 负责。每项任务固定使用其选择的团队版本。</p><div class="form-actions"><a class="secondary-button" href="/projects" data-route="/projects">取消</a><button class="primary-button" type="submit">创建项目</button></div></div><p class="form-status" id="collaboration-project-status" role="status" aria-live="polite"></p></form></section>`;
  const options = $("#project-team-options");
  options.insertAdjacentHTML("beforebegin", '<div class="team-picker-toolbar"><label class="team-picker-search"><span class="sr-only">搜索团队</span><input id="project-team-search" type="search" placeholder="搜索团队名称或目标" autocomplete="off"></label><span id="project-team-count" class="team-picker-count">已选 0 个</span></div>');
  try {
    const response = await pageFetch("/api/v1/team-repository"); const payload = await response.json(); if (!isCurrentRequest(state.activeRequest)) return; if (!response.ok) throw new Error(payload.error || "无法读取团队仓库");
    const teams = payload.teams || [];
    const selectableTeams = teams.filter((team) => team.teamVersionStatus === "released");
    options.innerHTML = selectableTeams.length ? selectableTeams.map((team) => `<label class="builder-choice"><input type="checkbox" name="teamVersionIds" value="${esc(team.projectId)}"><strong>${esc(team.name)} · v${team.teamVersionNumber || 1}${team.builtIn ? " · 内置" : ""}</strong><span>${esc((team.overview || "").slice(0, 120))}</span></label>`).join("") : `<p class="empty-note">暂无已发布团队。请先到 OGS Studio 创建、调试并发布团队。</p>`;
    const search = $("#project-team-search"); const count = $("#project-team-count");
    const refreshTeamPicker = () => { const query = String(search?.value || "").trim().toLocaleLowerCase(); let selectedCount = 0; options.querySelectorAll(".builder-choice").forEach((card) => { const input = card.querySelector("input"); const matches = !query || card.textContent.toLocaleLowerCase().includes(query); card.hidden = !matches; card.classList.toggle("selected", Boolean(input?.checked)); if (input?.checked) selectedCount += 1; }); if (count) count.textContent = `已选 ${selectedCount} 个`; };
    search?.addEventListener("input", refreshTeamPicker); options.querySelectorAll("input[type=checkbox]").forEach((input) => input.addEventListener("change", refreshTeamPicker));
    const preselectedTeam = new URLSearchParams(location.search).get("team");
    if (preselectedTeam) options.querySelector(`input[value="${CSS.escape(preselectedTeam)}"]`)?.setAttribute("checked", "checked");
    refreshTeamPicker();
    const collaborationProjectForm = $("#collaboration-project-form");
    bindDirtyForm(collaborationProjectForm, () => setDirty("collaboration-project-form"));
    collaborationProjectForm.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const teamVersionIds = form.getAll("teamVersionIds").map(String); const status = $("#collaboration-project-status"); const submit = event.currentTarget.querySelector("button[type=submit]"); if (!teamVersionIds.length) { status.textContent = "请至少选择一个已发布团队版本。"; return; } submit.disabled = true; status.textContent = "正在创建项目..."; try { const createResponse = await pageFetch("/api/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), overview: form.get("overview"), teamVersionIds }) }); const project = await createResponse.json(); if (!createResponse.ok) throw new Error(project.error || "项目创建失败"); clearDirty("collaboration-project-form"); navigate(`/projects/${encodeURIComponent(project.projectId)}`); } catch (error) { if (isAbort(error)) return; status.textContent = error.message || "项目创建失败"; submit.disabled = false; } });
  } catch (error) { if (isAbort(error)) return; if (error?.name !== "AbortError") options.innerHTML = `<p class="run-error">${esc(error.message || "无法读取团队仓库")}</p>`; }
}
async function renderNewProject(_pageRequest) {
  const root = $("#new-project-view");
  const english = state.locale === "en";
  const t = (en, zh) => english ? en : zh;
  const classicChoices = (state.cases || []).map((item) => `<label class="classic-template-choice"><input type="radio" name="templateCaseId" value="${esc(item.id)}"><span class="classic-template-choice-body"><strong>${esc(text(item.title))}</strong><small>${esc(text(item.short))}</small><span class="classic-team-meta"><span>${item.roles.length} ${t("roles", "个角色")}</span></span></span></label>`).join("");
  root.innerHTML = `<section class="page-heading new-team-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← ${t("Back to OGS Studio", "返回 OGS Studio")}</a><div class="eyebrow">Team Studio · ${t("Create", "创建")}</div><h1>${t("Create a Team IR v2 draft", "新建 Team IR v2 草稿")}</h1><p>${t("Start with a blank typed workflow or copy a built-in team into a new draft.", "从空白类型化流程开始，或复制内置经典团队为新的可编辑草稿。")}</p></div></section><section class="project-builder new-team-builder"><form id="new-project-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">Team IR v2</span><h2>${t("Choose a starting point", "选择起点")}</h2><p>${t("A template always creates a separate draft; this page never overwrites an existing version.", "选择模板只会创建新的草稿，不会覆盖已有版本。")}</p></div><fieldset class="classic-template-picker"><legend>${t("Starting point", "起始方式")}</legend><label class="classic-template-choice classic-template-blank"><input type="radio" name="templateCaseId" value="" checked><span class="classic-template-choice-body"><strong>${t("Blank draft", "空白草稿")}</strong><small>${t("Create the minimal native Team IR v2 starter workflow.", "创建最小原生 Team IR v2 起始流程。")}</span></label>${classicChoices || `<p class="empty-note">${t("No built-in teams are available.", "暂无内置经典团队。")}</p>`}</fieldset><label>${t("Team name", "团队名称")}<input name="name" required maxlength="120" autocomplete="organization" placeholder="${t("For example: Product research team", "例如：产品研究团队")}"></label><label>${t("Team goal", "团队目标")}<textarea name="overview" required maxlength="4000" rows="6" placeholder="${t("For example: compare competitor research and produce evidence-based recommendations; researchers collect sources, analysts compare findings, and a lead reviews the result.", "例如：分析竞品资料并提出行动建议；明确角色职责、交接顺序、输入材料和结果格式。")}"></textarea><small class="field-hint">${esc(copy[state.locale].targetHint)}</small><div class="new-team-form-footer"><div class="form-actions"><button class="primary-button" type="submit">${t("Create v2 draft", "创建 v2 草稿")} <span aria-hidden="true">→</span></button></div></div><p class="form-status" id="new-project-status" role="status" aria-live="polite"></p></form></section>`;
  const newProjectForm = $("#new-project-form");
  bindDirtyForm(newProjectForm, () => setDirty("new-project-form"));
  newProjectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = $("#new-project-status");
    const submit = newProjectForm.querySelector('button[type="submit"]');
    const originalLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = state.locale === "en" ? "Creating team…" : "正在创建团队…";
    status.textContent = state.locale === "en" ? "Creating team…" : "正在创建团队…";
    try {
      const templateCaseId = String(form.get("templateCaseId") || "").trim();
      const response = templateCaseId
        ? await pageFetch(`/api/v1/cases/${encodeURIComponent(templateCaseId)}/template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), overview: form.get("overview"), locale: state.locale }) })
        : await pageFetch("/api/v1/team-ir-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), overview: form.get("overview"), locale: state.locale }) });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "项目创建失败");
      clearDirty("new-project-form");
      state.projectId = project.projectId;
      navigate("/studio/teams/" + encodeURIComponent(project.projectId) + "/ir");
    } catch (error) { if (isAbort(error)) return;
      status.textContent = error.message || t("Team creation failed.", "团队创建失败。");
    } finally {
      if (submit?.isConnected) {
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
    }
  });
}

function teamVersionMeta(team) {
  const status = team.teamVersionStatus || "draft";
  const displayStatus = status;
  const labels = state.locale === "en"
    ? { released: ["Released", "Ready for projects"], draft: ["In design", "Continue editing"], archived: ["Inactive", "Unavailable for new projects; history retained"] }
    : { released: ["已发布", "可用于创建项目"], draft: ["设计中", "可继续编辑"], archived: ["已停用", "不再用于新项目，保留历史"] };
  const value = labels[displayStatus] || labels.draft;
  return { status, displayStatus, label: value[0], hint: value[1], version: `v${team.teamVersionNumber || 1}` };
}
function teamCard(team, area) {
  const meta = teamVersionMeta(team); const id = encodeURIComponent(team.projectId); const rootId = encodeURIComponent(team.teamRootId || team.teamId || team.projectId); const title = esc(team.teamName || team.name);
  const deleteButton = !team.builtIn ? `<button class="danger-button team-delete-button" type="button" data-team-action="delete" data-team-id="${id}" data-team-name="${title}" data-team-status="${meta.status}">${esc(copy[state.locale].deleteTeam)}</button>` : "";
  const actions = area === "repository"
    ? `<a class="primary-button" href="/projects/new?team=${id}" data-route="/projects/new?team=${id}">${esc(copy[state.locale].useTeam)}</a><button class="secondary-button" type="button" data-team-action="edit" data-team-id="${id}">${esc(copy[state.locale].editAsVersion)}</button>${deleteButton}`
    : meta.status === "archived"
      ? `<a class="secondary-button team-view-button" href="/studio/teams/${id}/info" data-route="/studio/teams/${id}/info">${state.locale === "en" ? "View team" : "查看团队"}</a>${deleteButton}`
      : `${meta.status === "released"
        ? `<button class="primary-button" type="button" data-team-action="edit" data-team-id="${id}">${state.locale === "en" ? "Edit team" : "编辑团队"}</button><button class="secondary-button" type="button" data-team-action="archive" data-team-id="${id}">${esc(copy[state.locale].archiveVersion)}</button>`
        : `<a class="primary-button" href="/studio/teams/${id}/ir" data-route="/studio/teams/${id}/ir">${esc(copy[state.locale].continueEditing)}</a>`}${deleteButton}`;
  const statusClass = meta.displayStatus === "released" ? "released" : meta.displayStatus;
  return `<article class="team-version-card project-asset-surface" data-team-root-id="${esc(team.teamRootId || team.teamId || team.projectId)}" data-team-status="${esc(meta.displayStatus)}" data-team-builtin="${team.builtIn ? "true" : "false"}"><div class="asset-card-top"><span class="asset-mark">O</span><span class="status-chip ${esc(statusClass)}">${esc(meta.label)}</span></div><div class="asset-title-row"><h2>${title}</h2><span class="version-badge">${esc(meta.version)}</span></div><p>${esc(team.overview || "")}</p><div class="asset-card-meta"><span>${team.builtIn ? (state.locale === "en" ? "Built-in team" : "内置经典团队") : esc(meta.hint)}</span><span>${team.updatedAt ? new Date(team.updatedAt).toLocaleDateString(state.locale) : ""}</span></div><div class="asset-card-actions">${actions}</div></article>`;
}
function roleColorForId(roleId) {
  let hash = 2166136261;
  for (const character of String(roleId)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const hue = (hash >>> 0) % 360;
  return { accent: `hsl(${hue} 58% 30%)`, fill: `hsl(${hue} 42% 95%)` };
}
function caseGraphThumbnail(item) {
  return `<div class="team-role-preview" aria-hidden="true">${(item.roles || []).slice(0, 5).map((role) => `<span>${esc(text(role.label))}</span>`).join("")}</div>`;
}
function bindTeamActions(root) {
  const pageRequest = state.activeRequest;
  root.querySelectorAll("[data-team-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.teamAction; const id = button.dataset.teamId; button.disabled = true;
    try {
      if (action === "delete") {
        const name = button.dataset.teamName || id;
        const message = button.dataset.teamStatus === "released" || button.dataset.teamStatus === "archived"
          ? `确定删除团队“${name}”及其全部版本吗？此操作不可撤销。`
          : `确定删除设计中版本“${name}”吗？此操作不可撤销。`;
        if (!window.confirm(message)) { button.disabled = false; return; }
      }
      if (action === "edit") {
        const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(id)}/edit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to create a draft version.");
        navigate(`/studio/teams/${encodeURIComponent(payload.projectId)}/ir`);
        return;
      }
      const isDraftDelete = action === "delete" && button.dataset.teamStatus === "draft";
      const teamId = button.closest("[data-team-root-id]")?.dataset.teamRootId || id;
      const endpoint = action === "delete"
        ? (isDraftDelete ? `/api/v1/team-versions/${id}` : `/api/v1/teams/${encodeURIComponent(teamId)}`)
        : `/api/v1/team-versions/${id}/${action}`;
      const response = await pageFetch(endpoint, { method: action === "delete" ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: "{}" }); const payload = await response.json();
      if (!response.ok) { const error = new Error(payload.error || "操作失败"); error.blockedProjects = payload.blockedProjects; throw error; }
      showToast(action === "delete"
        ? (isDraftDelete ? (state.locale === "en" ? "Design-stage version deleted" : "设计中版本已删除") : copy[state.locale].teamDeleted)
        : action === "release" ? "团队版本已发布" : (state.locale === "en" ? "Version deactivated" : "团队版本已停用"));
      if (state.studioRoute) await renderStudioOverview(pageRequest); else await renderProjectLibrary(pageRequest);
    } catch (error) {
      if (isAbort(error)) return;
      const blocked = error.blockedProjects;
      if (Array.isArray(blocked) && blocked.length) {
        showBlockedTeamProjects(blocked);
      } else showToast(error.message || "操作失败");
      button.disabled = false;
    }
  }));
}
function showBlockedTeamProjects(projects) {
  const dialog = document.createElement("dialog");
  dialog.className = "confirm-dialog team-delete-blocked-dialog";
  dialog.setAttribute("aria-labelledby", "team-delete-blocked-title");
  dialog.innerHTML = `<div class="dialog-head"><div><span class="section-kicker">团队仍在使用</span><h2 id="team-delete-blocked-title">以下项目挂载了此团队，暂时无法删除</h2></div><button type="button" class="close-button" data-close-blocked-dialog aria-label="关闭">×</button></div><ul class="team-delete-blocked-projects">${projects.map((project) => `<li><a href="/projects/${encodeURIComponent(project.projectId)}" data-route="/projects/${encodeURIComponent(project.projectId)}"><strong>${esc(project.name || "未命名项目")}</strong><code>${esc(project.projectId)}</code></a></li>`).join("")}</ul><div class="form-actions"><button type="button" class="primary-button" data-close-blocked-dialog>知道了</button></div>`;
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelectorAll("[data-close-blocked-dialog]").forEach((button) => button.addEventListener("click", close));
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-route]");
    if (link) { event.preventDefault(); const route = link.dataset.route; close(); navigate(route); }
  });
  dialog.showModal();
}
async function renderProjectLibrary() {
  const root = $("#workspace-view");
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">${esc(copy[state.locale].libraryEyebrow)}</div><h1>${esc(copy[state.locale].libraryTitle)}</h1><p>${esc(copy[state.locale].libraryIntro)}</p></div></section><section class="project-library-toolbar"><div><strong>${esc(copy[state.locale].releasedLabel)}</strong><span>${esc(copy[state.locale].repositoryEmptyHint)}</span></div><div class="project-library-filters repository-actions"><label><span class="sr-only">搜索团队</span><input id="project-library-search" type="search" placeholder="搜索团队名称或目标"></label><a class="primary-button" href="/studio" data-route="/studio">${esc(copy[state.locale].createTeam)}</a></div></section><div id="project-library-grid" class="project-library-grid"><div class="project-loading">正在读取团队仓库...</div></div>`;
  const grid = $("#project-library-grid");
  root.querySelector(".project-library-toolbar")?.insertAdjacentHTML("afterend", `<section class="classic-team-section repository-classic-section"><div class="section-header"><div><div class="section-kicker">${esc(state.locale === "en" ? "Repository examples" : "典型团队")}</div><h2>${esc(state.locale === "en" ? "Ready-made collaboration patterns" : "开箱即用的协作方式")}</h2><p class="section-description">${esc(state.locale === "en" ? "Inspect a built-in team graph, then decide whether to try it or copy it into a new version." : "先查看内置团队图谱，再决定试用流程或复制为新版本。")}</p></div></div><div class="classic-team-grid">${state.cases.map((item) => `<article class="classic-team-card" data-accent="${esc(item.accent)}"><a class="classic-team-preview" href="/cases/${encodeURIComponent(item.id)}" data-route="/cases/${encodeURIComponent(item.id)}" aria-label="${esc(text(item.title))}">${caseGraphThumbnail(item)}<span class="classic-team-arrow" aria-hidden="true">↗</span></a><div class="classic-team-card-top"><span class="asset-mark">${esc(icon[item.icon] || "✦")}</span><span class="status-chip">${esc(state.locale === "en" ? "Built-in" : "内置版本")}</span></div><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><div class="classic-team-meta"><span>${esc(item.duration?.[state.locale] || item.duration?.["zh-CN"] || "")}</span><span>${item.roles.length} ${state.locale === "en" ? "roles" : "个角色"}</span></div></article>`).join("")}</div></section>`);
  root.querySelectorAll("[data-classic-team]").forEach((button) => button.addEventListener("click", async () => {
    const caseId = button.dataset.classicTeam; button.disabled = true;
    try {
      const response = await pageFetch(`/api/v1/cases/${encodeURIComponent(caseId)}/use`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: state.locale }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法使用内置团队");
      navigate(`/projects/new?team=${encodeURIComponent(payload.projectId)}`);
    } catch (error) { if (isAbort(error)) return; showToast(error.message || "无法使用内置团队"); button.disabled = false; }
  }));
  try {
    const response = await pageFetch("/api/v1/team-repository"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取团队仓库");
    const teams = (payload.teams || []).filter((team) => !team.builtIn);
    grid.innerHTML = teams.length ? teams.map((team) => teamCard(team, "repository")).join("") : `<div class="empty-projects"><strong>${esc(copy[state.locale].noReleasedTeams)}</strong><p>${esc(copy[state.locale].repositoryEmptyHint)}</p></div>`;
    bindTeamActions(grid);
    $("#project-library-search")?.addEventListener("input", (event) => { const query = event.target.value.trim().toLowerCase(); grid.querySelectorAll(".team-version-card").forEach((card) => { card.hidden = Boolean(query && !card.textContent.toLowerCase().includes(query)); }); });
  } catch (error) { if (isAbort(error)) return; grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取团队仓库")}</div>`; }
}
async function renderCollaborationProjects() {
  const root = $("#projects-view");
  root.dataset.template = "A";
  root.innerHTML = pageFrame({
    template: "A",
    title: "协作项目",
    subtitle: "统一管理项目资料、任务、运行和交付。",
    actions: '<a class="primary-button" href="/projects/new" data-route="/projects/new">创建项目</a>',
    body: '<div id="collaboration-project-grid" class="project-library-grid" data-layout-scroll><div class="project-loading">正在读取协作项目...</div></div>'
  });
  const grid = $("#collaboration-project-grid");
  try {
    const response = await pageFetch("/api/v1/projects"); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法读取协作项目");
    const projects = payload.projects || [];
    grid.innerHTML = projects.length ? projects.map((project) => { const teams = project.mountedTeams || []; const taskCount = (project.taskRecords || []).filter((task) => !task.deletedAt && task.status !== "deleted").length; const teamSummary = teams.map((team) => `${team.teamName} · v${team.teamVersionNumber || 1}`).join("、"); return `<article class="project-asset-card collaboration-project-card"><div class="asset-card-top"><span class="asset-mark">⌘</span><span class="status-chip ${esc(project.projectStatus || "draft")}">${esc(taskCount ? "进行中" : "待开始")}</span></div><div class="asset-title-row"><h2>${esc(project.name)}</h2><span class="version-badge">${teams.length} 个团队</span></div><p>${esc(project.overview || "共享生产资料，按任务记录项目进展")}</p><div class="asset-card-meta"><span>${esc(teamSummary || "需要挂载已发布团队")}</span><span>${taskCount} 个任务</span></div><div class="asset-card-actions"><a class="primary-button" href="/projects/${encodeURIComponent(project.projectId)}" data-route="/projects/${encodeURIComponent(project.projectId)}">${state.locale === "en" ? "Open project" : "打开项目"}</a><button class="danger-button team-delete-button" type="button" data-project-delete="${esc(project.projectId)}" data-project-name="${esc(project.name)}">${esc(copy[state.locale].deleteProject)}</button></div></article>`; }).join("") : `<div class="empty-projects"><strong>还没有协作项目</strong><p>创建项目后，可挂载已发布团队并开始任务。</p></div>`;
    grid.querySelectorAll("[data-project-delete]").forEach((button) => button.addEventListener("click", async () => {
      const message = copy[state.locale].confirmDeleteProject.replace("{name}", button.dataset.projectName || button.dataset.projectDelete);
      if (!window.confirm(message)) return;
      button.disabled = true;
      try {
        const result = await pageFetch(`/api/v1/projects/${encodeURIComponent(button.dataset.projectDelete)}`, { method: "DELETE" });
        const payload = await result.json();
        if (!result.ok) throw new Error(payload.error || "Unable to delete project.");
        showToast(copy[state.locale].projectDeleted);
        await renderCollaborationProjects();
      } catch (error) { if (isAbort(error)) return; showToast(error.message || "Unable to delete project."); button.disabled = false; }
    }));
  } catch (error) { if (isAbort(error)) return; grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取协作项目")}</div>`; }
}

async function renderProjectTeams(projectId, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  const root = $("#project-workspace-view");
  root.innerHTML = '<div class="project-loading">正在读取项目团队...</div>';
  try {
    const [projectResponse, mountedResponse, repositoryResponse] = await Promise.all([
      pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`),
      pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/teams`),
      pageFetch("/api/v1/team-repository")
    ]);
    const project = await projectResponse.json();
    const mountedPayload = await mountedResponse.json();
    const repositoryPayload = await repositoryResponse.json();
    if (!projectResponse.ok) throw new Error(project.error || "项目不存在");
    if (!mountedResponse.ok) throw new Error(mountedPayload.error || "无法读取项目团队");
    if (!repositoryResponse.ok) throw new Error(repositoryPayload.error || "无法读取团队仓库");
    if (!isCurrentRequest(pageRequest)) return;
    const mounted = mountedPayload.mountedTeams || project.mountedTeams || [];
    const known = new Map((repositoryPayload.teams || []).map((team) => [team.projectId || team.teamVersionId, team]));
    mounted.forEach((team) => {
      const id = team.teamVersionId;
      if (id && !known.has(id)) known.set(id, { projectId: id, name: team.teamName, teamName: team.teamName, teamVersionId: id, teamVersionNumber: team.teamVersionNumber, teamVersionStatus: "released", builtIn: team.builtIn });
    });
    const teams = [...known.values()].filter((team) => team.teamVersionStatus === "released");
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/projects/${encodeURIComponent(projectId)}" data-route="/projects/${encodeURIComponent(projectId)}">← 返回项目</a><div class="eyebrow">OGS Projects · 项目配置</div><h1>${esc(project.name)}</h1><p>${esc(project.overview || "选择项目使用的已发布团队版本")}</p></div><span class="project-status confirmed">${mounted.length} 个团队版本</span></section><section class="project-builder project-team-manager"><form id="project-team-management-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">项目团队版本</span><h2>管理执行团队</h2><p>项目可以挂载多个已发布团队。每项任务选择一个团队；运行中的任务完成后才能修改挂载配置。</p></div><fieldset class="builder-choice-group"><legend>已发布团队 <span>至少选择一个</span></legend><div id="project-managed-team-options" class="builder-choice-grid">${teams.length ? teams.map((team) => { const id = team.projectId || team.teamVersionId; const selected = mounted.some((item) => item.teamVersionId === id); return `<label class="builder-choice${selected ? " selected" : ""}"><input type="checkbox" name="teamVersionIds" data-team-id="${esc(team.teamId || id)}" value="${esc(id)}"${selected ? " checked" : ""}><strong>${esc(team.teamName || team.name)} · v${team.teamVersionNumber || 1}${team.builtIn ? " · 内置" : ""}</strong><span>${esc((team.overview || "").slice(0, 140))}</span></label>`; }).join("") : '<p class="empty-note">暂无可用的已发布团队。</p>'}</div></fieldset><div class="new-team-form-footer"><p class="form-hint" id="project-team-management-hint">已创建的任务仍固定使用其原团队版本。移除挂载不会改写任务记录。</p><div class="form-actions"><a class="secondary-button" href="/projects/${encodeURIComponent(projectId)}" data-route="/projects/${encodeURIComponent(projectId)}">取消</a><button class="primary-button" type="submit">保存团队版本</button></div></div><p class="form-status" id="project-team-management-status" role="status" aria-live="polite"></p></form></section>`;
    const form = $("#project-team-management-form");
    const options = $("#project-managed-team-options");
    const addVersion = new URLSearchParams(window.location.search).get("addVersion");
    if (addVersion) {
      const candidate = options?.querySelector(`input[value="${CSS.escape(addVersion)}"]`);
      if (candidate) {
        const sourceTeamId = candidate.dataset.teamId;
        options.querySelectorAll(`input[data-team-id="${CSS.escape(sourceTeamId)}"]`).forEach((input) => { input.checked = input === candidate; });
        candidate.checked = true;
        candidate.closest(".builder-choice")?.classList.add("selected");
        const message = document.createElement("p");
        message.className = "form-hint";
        message.setAttribute("role", "status");
        message.textContent = "新发布的团队版本已预选，并会替换同一团队的旧挂载版本；保存后生效。";
        form.querySelector(".new-team-form-heading")?.append(message);
      }
    }
    const refreshSelection = () => options?.querySelectorAll(".builder-choice").forEach((card) => card.classList.toggle("selected", Boolean(card.querySelector("input")?.checked)));
    options?.querySelectorAll("input[type=checkbox]").forEach((input) => input.addEventListener("change", refreshSelection));
    bindDirtyForm(form, () => setDirty("project-team-management-form"));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("#project-team-management-status");
      const submit = form.querySelector("button[type=submit]");
      const selectedTeamVersionIds = new FormData(form).getAll("teamVersionIds").map(String);
      if (!selectedTeamVersionIds.length) { status.textContent = "请至少选择一个已发布团队版本。"; return; }
      submit.disabled = true;
      status.textContent = "正在保存团队配置…";
      try {
        const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/teams`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamVersionIds: selectedTeamVersionIds }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "团队配置保存失败");
        clearDirty("project-team-management-form");
        navigate(`/projects/${encodeURIComponent(projectId)}`);
      } catch (error) {
        if (isAbort(error)) return;
        status.textContent = error.message || "团队配置保存失败";
        submit.disabled = false;
      }
    });
  } catch (error) {
    if (isAbort(error)) return;
    root.innerHTML = `<div class="run-error">${esc(error.message || "无法读取项目团队")}</div>`;
  }
}

async function renderPlatformConfig() {
  const root = $("#platform-view");
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">平台配置</div><h1>运行底座与默认设置</h1><p>模型需探测成功后才标记为可用。</p></div><div class="heading-actions"><button id="platform-discovery-refresh" class="secondary-button platform-action-button" type="button"><svg class="platform-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.8 10a7.5 7.5 0 0 1 12.7-3L20 9M4 17v-5h5m10.2 2a7.5 7.5 0 0 1-12.7 3L4 15"/></svg><span>刷新</span></button></div></section><section class="platform-config-grid"><article class="project-panel platform-discovery-panel"><div class="panel-head"><div><span class="section-kicker">运行底座</span><h2>发现到的服务</h2></div></div><div id="platform-providers" class="platform-list" data-layout-scroll>正在读取...</div></article><article class="project-panel platform-discovery-panel"><div class="panel-head"><div><span class="section-kicker">模型目录</span><h2>发现到的模型</h2></div></div><div id="platform-models" class="platform-list" data-layout-scroll>正在读取...</div></article><article class="project-panel platform-settings-panel"><div class="panel-head"><div><span class="section-kicker">默认值</span><h2>执行设置</h2></div><p class="panel-note" id="platform-discovery-meta">正在读取探测时间...</p></div><form id="platform-settings-form" class="compact-form"><label>默认底座<select name="defaultProvider"><option value="codex">Codex</option><option value="opencode">OpenCode</option></select></label><label>默认模型<select name="defaultModel"><option value="default">自动选择</option></select></label><label><span>模型请求超时（秒）</span><input name="timeoutSeconds" type="number" min="10" max="3600" value="120" title="等待本次模型请求返回的最长时间；不限制整个任务的执行时长" aria-describedby="platform-timeout-help"><small id="platform-timeout-help" class="platform-field-hint">只计算单次模型请求等待返回的时间，不限制整个任务执行多久。超过后该次请求异常，可从任务记录重新处理。</small></label><label>失败重试次数<input name="retryCount" type="number" min="0" max="5" value="1"></label><button class="primary-button platform-action-button" type="submit"><svg class="platform-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l3 3v13H4V4zM8 4v6h8V4M8 20v-7h8v7"/></svg><span>保存</span></button><p class="form-status" id="platform-settings-status"></p><p class="form-status platform-runtime-status" id="platform-runtime-status" role="status" aria-live="polite"></p></form></article></section>`;
  const modelProbes = new Map();
  let discoverySnapshot;
  let selectedSettings;
  const platformDescription = root.querySelector(".page-heading p");
  if (platformDescription) platformDescription.textContent = "刷新时自动探测模型可用性。";
  const timeoutHelp = root.querySelector("#platform-timeout-help");
  if (timeoutHelp) timeoutHelp.textContent = "单次请求最长等待时间，不限制任务时长；超时后可从运行记录重试。";
  const statusText = (status) => status === "available" || status === "active" ? "可用" : "未发现";
  const statusClass = (status) => status === "available" || status === "active" ? "confirmed" : "warning";
  const capabilityLabels = (capabilities = {}) => [capabilities.textInput && "文本输入", capabilities.textOutput && "文本输出", capabilities.toolcall && "工具调用"].filter(Boolean);
  const sourceDetail = (item) => { const detail = String(item.detail || ""); if (/not found|missing|command/i.test(detail)) return "未检测到该运行底座，请安装后再刷新"; if (/persistent|adapter/i.test(detail)) return "已检测到命令，当前仅展示发现结果"; return detail || "已完成自动检查"; };
  const formatDiscoveryTime = (value) => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "时间未知" : date.toLocaleString(state.locale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }); };
  const renderDiscovery = (discovery, settings) => {
    discoverySnapshot = discovery;
    selectedSettings = settings;
    const providers = discovery.sources || [];
    const models = discovery.models || [];
    $("#platform-providers").innerHTML = providers.length ? providers.map((item) => `<div class="platform-source-row"><div class="platform-row-main"><div class="platform-row-title"><strong>${esc(item.name || item.backend)}</strong><span class="status-chip ${statusClass(item.status)}">${statusText(item.status)}</span></div><span class="platform-row-detail">${esc(sourceDetail(item))}</span><code>${esc(item.command || "自动检查")}</code></div></div>`).join("") : `<div class="platform-empty">暂未发现运行底座</div>`;
    $("#platform-models").innerHTML = models.length ? models.map((item) => { const capabilities = capabilityLabels(item.capabilities); const ref = item.ref || `${item.backend}/${item.id}`; const probe = modelProbes.get(ref); const availability = probe?.status === "available" ? "可用" : probe?.status === "unavailable" ? "不可用" : probe?.status === "checking" ? "探测中" : "未验证"; const chip = probe?.status === "available" ? "confirmed" : probe?.status === "unavailable" ? "error" : ""; const message = probe?.status === "available" ? `<span class="platform-row-detail">验证成功${Number.isFinite(probe.durationMs) ? `，${Math.round(probe.durationMs)} ms` : ""}</span>` : probe?.message ? `<span class="platform-row-detail">${esc(probe.message)}</span>` : ""; return `<div class="platform-model-row"><div class="platform-row-main"><div class="platform-row-title"><strong>${esc(item.name || item.id)}</strong><span class="status-chip ${chip}">${availability}</span></div><span class="platform-row-detail">${esc(item.providerName || item.provider || "未知底座")} ${esc(item.id)}</span>${message}<div class="platform-capabilities">${capabilities.length ? capabilities.map((label) => `<span>${esc(label)}</span>`).join("") : "<span>能力信息未提供</span>"}</div></div></div>`; }).join("") : `<div class="platform-empty">暂未发现模型</div>`;
    const hasCodexModel = models.some((item) => item.backend === "codex" && modelProbes.get(item.ref || `${item.backend}/${item.id}`)?.status === "available");
    const hasOpenCodeModel = models.some((item) => item.backend === "opencode" && modelProbes.get(item.ref || `${item.backend}/${item.id}`)?.status === "available");
    const missingBackends = [!hasCodexModel && "Codex", !hasOpenCodeModel && "OpenCode"].filter(Boolean);
    const requirementMessage = missingBackends.length
      ? (state.locale === "en"
        ? `No ${missingBackends.join(" or ")} model has passed a live availability probe. Probe discovered models before using them.`
        : `尚无通过实际请求验证的 ${missingBackends.join(" 或 ")} 模型。请对发现的模型执行可用性探测。`)
      : (state.locale === "en"
        ? "Codex and OpenCode models have passed live availability probes."
        : "Codex 和 OpenCode 均有模型通过实际请求验证。");
    $("#platform-models .platform-model-requirement")?.remove();
    $("#platform-models").insertAdjacentHTML("afterbegin", `<p class="form-hint platform-model-requirement" role="status">${esc(requirementMessage)}</p>`);
    $("#platform-discovery-meta").textContent = `上次检查：${formatDiscoveryTime(discovery.generatedAt)}${discovery.stale ? " · 建议刷新" : ""}`;
    const providerSelect = document.querySelector("#platform-settings-form select[name=defaultProvider]");
    if (providerSelect && settings?.defaultProvider) providerSelect.value = settings.defaultProvider;
    const modelSelect = document.querySelector("#platform-settings-form select[name=defaultModel]");
    if (modelSelect) {
      const backend = providerSelect?.value || settings?.defaultProvider || "codex";
      const runnableModels = models.filter((item) => item.backend === backend && modelProbes.get(item.ref || `${item.backend}/${item.id}`)?.status === "available");
      modelSelect.innerHTML = `<option value="default">自动选择</option>${runnableModels.map((item) => {
        const ref = item.ref || `${item.backend}/${item.id}`;
        return `<option value="${esc(ref)}">${esc(item.name || item.id)} · ${esc(ref)}</option>`;
      }).join("")}`;
      const savedModel = settings?.defaultModel;
      const selectedModel = runnableModels.find((item) => item.ref === savedModel || item.id === savedModel);
      modelSelect.value = selectedModel ? (selectedModel.ref || `${selectedModel.backend}/${selectedModel.id}`) : "default";
    }
    if (settings) {
      const timeout = document.querySelector("#platform-settings-form input[name=timeoutSeconds]");
      const retry = document.querySelector("#platform-settings-form input[name=retryCount]");
      if (timeout) timeout.value = settings.timeoutSeconds;
      if (retry) retry.value = settings.retryCount;
    }
    const runtimeStatus = $("#platform-runtime-status");
    if (runtimeStatus) {
      runtimeStatus.textContent = settings?.runtimeApplied === false
        ? "设置已持久化；默认模型用于未单独绑定模型的角色，超时与重试等运行时设置将在后续运行生效。"
        : settings?.runtimeApplied === true ? "设置已应用到当前运行时。" : "";
    }
  };
  $("#platform-discovery-refresh")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; const label = button.querySelector("span"); const currentSettings = Object.fromEntries(new FormData(document.querySelector("#platform-settings-form") || document.createElement("form")).entries()); button.disabled = true; label.textContent = "刷新中";
    try {
      const response = await pageFetch("/api/v1/platform/discovery", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "刷新失败");
      modelProbes.clear();
      const models = payload.models || [];
      for (const model of models) modelProbes.set(model.ref || `${model.backend}/${model.id}`, { status: "checking" });
      renderDiscovery(payload, currentSettings);
      for (let index = 0; index < models.length; index += 1) {
        const model = models[index];
        const modelRef = model.ref || `${model.backend}/${model.id}`;
        label.textContent = "探测中";
        try {
          const probeResponse = await pageFetch("/api/v1/platform/models/probe", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelRef })
          });
          const probePayload = await probeResponse.json();
          if (!probeResponse.ok) throw new Error(probePayload.error || "模型探测失败");
          modelProbes.set(modelRef, probePayload.result || { status: "unavailable", message: "未收到探测结果" });
        } catch (error) {
          if (isAbort(error)) return;
          modelProbes.set(modelRef, { status: "unavailable", message: error.message || "模型探测失败" });
        }
      }
      const latestSettings = Object.fromEntries(new FormData(document.querySelector("#platform-settings-form")).entries());
      renderDiscovery(payload, latestSettings);
      label.textContent = "已刷新";
      setTimeout(() => { label.textContent = "刷新"; }, 1500);
    }
    catch (error) { if (isAbort(error)) return; showToast(error.message || "刷新失败"); label.textContent = "重试"; }
    finally { button.disabled = false; }
  });
  try {
    const [discoveryResponse, settingsResponse] = await Promise.all([pageFetch("/api/v1/platform/discovery"), pageFetch("/api/v1/platform/settings")]);
    const discovery = await discoveryResponse.json(); const settingsPayload = await settingsResponse.json();
    if (!discoveryResponse.ok) throw new Error(discovery.error || "无法读取运行底座");
    renderDiscovery(discovery, settingsPayload.settings);
    $("#platform-settings-form select[name=defaultProvider]")?.addEventListener("change", () => {
      const form = document.querySelector("#platform-settings-form");
      const current = Object.fromEntries(new FormData(form).entries());
      current.defaultModel = "default";
      renderDiscovery(discoverySnapshot, current);
    });
    $("#platform-settings-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await pageFetch("/api/v1/platform/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form.entries())) }); const result = await response.json(); if (!isCurrentRequest(state.activeRequest)) return; $("#platform-settings-status").textContent = response.ok ? "已保存" : (result.error || "保存失败"); if (response.ok) renderDiscovery(discoverySnapshot, result.settings); });
  } catch (error) { if (isAbort(error)) return; $("#platform-providers").innerHTML = `<div class="platform-empty">${esc(error.message || "无法读取平台配置")}</div>`; $("#platform-models").innerHTML = `<div class="platform-empty">请检查运行服务后重试</div>`; }
}

async function renderStudioOverview() {
  const root = $("#studio-view");
  root.dataset.template = "A";
  root.innerHTML = `<section class="page-frame" data-template="A" data-fit><div class="page-frame-body" data-layout-scroll><section class="project-library-toolbar studio-repository-toolbar"><div class="repository-heading"><div class="eyebrow">${esc(copy[state.locale].factoryEyebrow)}</div><h1>${esc(copy[state.locale].factoryTitle)}</h1><p>${esc(copy[state.locale].factoryIntro)}</p></div><div class="project-library-filters repository-actions"><label><span class="sr-only">${state.locale === "en" ? "Search teams" : "搜索团队"}</span><input id="studio-team-search" type="search" placeholder="${state.locale === "en" ? "Search teams" : "搜索团队"}"></label><label><span class="sr-only">${state.locale === "en" ? "Filter status" : "筛选状态"}</span><select id="studio-team-status"><option value="all">${state.locale === "en" ? "All statuses" : "全部状态"}</option><option value="released">${esc(copy[state.locale].releasedLabel)}</option><option value="draft">${state.locale === "en" ? "Designing" : "设计中"}</option><option value="archived">${esc(copy[state.locale].archivedLabel)}</option></select></label><a class="primary-button" href="/studio/new" data-route="/studio/new">${esc(copy[state.locale].createTeam)}</a></div></section><section class="classic-team-section studio-classic-section"><div class="section-header"><div><div class="section-kicker">${state.locale === "en" ? "Built-in v2 teams" : "内置 v2 经典团队"}</div><h2>${state.locale === "en" ? "Start from a collaboration pattern" : "从经典协作场景开始"}</h2></div></div><div class="classic-team-grid" id="studio-classic-teams"></div></section><div id="studio-grid" class="project-library-grid"><div class="project-loading" role="status">${state.locale === "en" ? "Loading team repository…" : "正在读取团队仓库…"}</div></div></div></section>`;
  const classicGrid = $("#studio-classic-teams");
  classicGrid.innerHTML = state.cases.map((item) => `<article class="classic-team-card" data-studio-classic-case="${esc(item.id)}"><a class="classic-team-preview" href="/cases/${encodeURIComponent(item.id)}" data-route="/cases/${encodeURIComponent(item.id)}" aria-label="${esc(text(item.title))}">${caseGraphThumbnail(item)}<span class="classic-team-arrow" aria-hidden="true">↗</span></a><div class="classic-team-card-top"><span class="asset-mark">${esc(icon[item.icon] || "✦")}</span><span class="status-chip">${state.locale === "en" ? "Built-in" : "内置 v2"}</span></div><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><div class="classic-team-meta"><span>${item.roles.length} ${state.locale === "en" ? "roles" : "个角色"}</span></div><button class="secondary-button" type="button" data-classic-team-template="${esc(item.id)}">${state.locale === "en" ? "Create a version" : "创建可编辑版本"}</button></article>`).join("");
  classicGrid.querySelectorAll("[data-classic-team-template]").forEach((button) => button.addEventListener("click", () => {
    void createProjectFromCase(button.dataset.classicTeamTemplate, "template", button);
  }));
  const grid = $("#studio-grid");
  const statusFilter = $("#studio-team-status");
  const draftOption = statusFilter?.querySelector('option[value="draft"]');
  const inactiveOption = statusFilter?.querySelector('option[value="archived"]');
  if (draftOption) draftOption.textContent = state.locale === "en" ? "In design" : "设计中";
  if (inactiveOption) inactiveOption.textContent = state.locale === "en" ? "Inactive" : "已停用";
  const repositoryIntro = root.querySelector(".repository-heading p");
  if (repositoryIntro) repositoryIntro.textContent = state.locale === "en"
    ? "Released versions are immutable. The first changed save creates an in-design version."
    : "已发布版本不可直接修改；首次保存修改时会创建设计中版本。";
  try {
    const response = await pageFetch("/api/v1/team-repository?status=all&pageSize=50"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取团队仓库");
    const teams = (payload.teams || []).filter((team) => !team.teamProjectId && team.projectType !== "collaboration");
    const renderTeams = () => {
      const query = String($("#studio-team-search")?.value || "").trim().toLocaleLowerCase();
      const status = $("#studio-team-status")?.value || "all";
      const visible = teams.filter((team) => {
        const meta = teamVersionMeta(team);
        const matchesQuery = !query || `${team.teamName || team.name} ${team.overview || ""}`.toLocaleLowerCase().includes(query);
        return matchesQuery && (status === "all" || meta.displayStatus === status);
      });
      grid.innerHTML = visible.length ? visible.map((team) => teamCard(team, teamVersionMeta(team).status === "released" ? "repository" : "factory")).join("") : `<div class="empty-projects"><strong>${state.locale === "en" ? "No matching teams" : "没有符合条件的团队版本"}</strong><p>${state.locale === "en" ? "Change the filters or create a team." : "调整筛选条件，或创建团队。"}</p></div>`;
      bindTeamActions(grid);
    };
    $("#studio-team-search")?.addEventListener("input", renderTeams);
    $("#studio-team-status")?.addEventListener("change", renderTeams);
    renderTeams();
  } catch (error) { if (isAbort(error)) return; grid.innerHTML = `<div class="run-error">${esc(error.message || (state.locale === "en" ? "Unable to load the team repository." : "无法读取团队仓库。"))}</div>`; }
}

function studioWorkspaceNav(teamVersionId, active) {
  const id = encodeURIComponent(teamVersionId);
  const search = location.search;
  const items = [
    ["info", state.locale === "en" ? "Team info" : "团队信息", "info"],
    ["ir", "Team IR v2", "ir"],
    ["release", state.locale === "en" ? "Release" : "发布", "release"]
  ];
  return `<nav class="studio-workspace-nav" aria-label="${state.locale === "en" ? "Team workspace" : "团队工作区"}">${items.map(([key, label, route]) => `<a href="/studio/teams/${id}/${route}${search}" data-route="/studio/teams/${id}/${route}${search}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}

function teamIrAdvancedContracts(ir) {
  return {
    runInput: ir.runInput,
    runResult: ir.runResult,
    executionPolicy: ir.executionPolicy,
    orchestration: ir.orchestration,
    $defs: ir.$defs || {},
    agentPortContracts: Object.fromEntries((ir.agents || []).map((agent) => [agent.id, {
      inputPorts: agent.inputPorts,
      outputPorts: agent.outputPorts
    }])),
    handoffContracts: Object.fromEntries((ir.handoffs || []).map((handoff) => [handoff.id, handoff])),
    bindings: ir.bindings || []
  };
}

function teamIrWithAdvancedContracts(form, candidate, previous) {
  const source = form.querySelector("[data-ir-advanced-json]")?.value;
  if (source === undefined) return candidate;
  let advanced;
  try {
    advanced = JSON.parse(source);
  } catch (error) {
    throw new Error(`Advanced contract JSON is invalid: ${error.message}`);
  }
  if (!advanced || typeof advanced !== "object" || Array.isArray(advanced)) {
    throw new Error("Advanced contracts must be a JSON object.");
  }
  candidate.runInput = advanced.runInput ?? candidate.runInput;
  candidate.runResult = advanced.runResult ?? candidate.runResult;
  candidate.executionPolicy = advanced.executionPolicy ?? candidate.executionPolicy;
  candidate.$defs = advanced.$defs ?? candidate.$defs;
  const previousRoutes = previous.orchestration?.routes || [];
  const storedRoutes = advanced.orchestration?.routes || [];
  const liveHandoffIds = new Set(candidate.handoffs.map((handoff) => handoff.id));
  const liveStoredRoutes = storedRoutes
    .map((route) => ({ ...route, handoffIds: route.handoffIds.filter((id) => liveHandoffIds.has(id)) }))
    .filter((route) => route.handoffIds.length > 0);
  const advancedRoutesChanged = JSON.stringify(storedRoutes) !== JSON.stringify(previousRoutes);
  const generatedRoutesByKey = new Map(candidate.orchestration.routes.map((route) => [JSON.stringify(route.from), route]));
  const routes = advancedRoutesChanged ? liveStoredRoutes : [
    ...liveStoredRoutes.map((stored) => {
      const generated = generatedRoutesByKey.get(JSON.stringify(stored.from));
      return generated ? { ...stored, ...generated, onNoMatch: stored.onNoMatch } : stored;
    }),
    ...candidate.orchestration.routes.filter((route) => !liveStoredRoutes.some((stored) => JSON.stringify(stored.from) === JSON.stringify(route.from)))
  ];
  const mergeOrchestrationRows = (key, fields) => {
    const formRows = candidate.orchestration[key] || [];
    const previousRows = previous.orchestration?.[key] || [];
    const storedRows = advanced.orchestration?.[key] || [];
    const rowChanged = (row, old) => fields.some((field) => JSON.stringify(row[field]) !== JSON.stringify(old?.[field]));
    if (formRows.length === previousRows.length && !formRows.some((row, index) => rowChanged(row, previousRows[index]))) return storedRows;
    return formRows.map((row, index) => {
      const old = previousRows[index] || {};
      const stored = storedRows.find((item) => item.id === old.id) || storedRows[index] || old;
      const merged = { ...stored };
      for (const field of fields) if (JSON.stringify(row[field]) !== JSON.stringify(old[field])) merged[field] = row[field];
      return merged;
    });
  };
  candidate.orchestration = {
    ...candidate.orchestration,
    joins: mergeOrchestrationRows("joins", ["id", "agentId", "inputPort", "mode", "handoffIds", "scope", "threshold", "baseMapping", "timeoutMs", "onTimeout"]),
    loops: mergeOrchestrationRows("loops", ["id", "members", "boundaryAgentId", "entryHandoffIds", "continueHandoffIds", "exitHandoffIds", "maxRounds", "maxAgentActivations", "onExhausted"]),
    reviews: mergeOrchestrationRows("reviews", ["id", "at", "feedbackSchema", "timeoutMs", "onTimeout"]),
    routes
  };
  const agentContracts = advanced.agentPortContracts || {};
  candidate.agents = candidate.agents.map((agent) => {
    const contracts = agentContracts[agent.id] || {};
    const oldAgent = (previous.agents || []).find((item) => item.id === agent.id);
    const ports = (current, stored, oldPorts) => {
      if (JSON.stringify(current) === JSON.stringify(oldPorts)) return stored || current;
      return Object.fromEntries(Object.entries(current).map(([portId, port]) => {
        const saved = stored?.[portId] || {};
        const old = oldPorts?.[portId] || {};
        return [portId, {
          ...saved,
          ...port,
          ...(JSON.stringify(port.dataSchema) === JSON.stringify(old.dataSchema) && saved.dataSchema !== undefined
            ? { dataSchema: saved.dataSchema } : {}),
          ...(JSON.stringify(port.artifactSlots) === JSON.stringify(old.artifactSlots) && Object.hasOwn(saved, "artifactSlots")
            ? { artifactSlots: saved.artifactSlots } : {})
        }];
      }));
    };
    return {
      ...agent,
      inputPorts: ports(agent.inputPorts, contracts.inputPorts, oldAgent?.inputPorts),
      outputPorts: ports(agent.outputPorts, contracts.outputPorts, oldAgent?.outputPorts)
    };
  });
  const handoffContracts = advanced.handoffContracts || {};
  candidate.handoffs = candidate.handoffs.map((handoff, index) => {
    const stored = handoffContracts[handoff.id] || {};
    const oldHandoff = (previous.handoffs || []).find((item) => item.id === handoff.id);
    const data = new FormData(form);
    const priority = Number(data.get(`handoff-${index}-priority`) || 0);
    const storedWhen = stored.when ?? oldHandoff?.when;
    const conditionChanged = JSON.stringify(handoff.when?.condition) !== JSON.stringify(oldHandoff?.when?.condition);
    const priorityChanged = priority !== Number(oldHandoff?.when?.priority ?? 0);
    const mergedWhen = storedWhen ? { ...storedWhen, ...(priorityChanged ? { priority } : {}) } : {};
    const when = conditionChanged
      ? handoff.when?.condition ? { ...mergedWhen, condition: handoff.when.condition, priority } : undefined
      : storedWhen ? (priorityChanged ? { ...storedWhen, priority } : storedWhen) : handoff.when;
    const mapFormUnchanged = JSON.stringify(handoff.map?.data || {}) === JSON.stringify(oldHandoff?.map?.data || {});
    const merged = {
      ...stored,
      ...handoff,
      when,
      delivery: { ...(handoff.delivery || {}), ...(stored.delivery || {}) },
      map: { ...(stored.map || {}), ...handoff.map, data: mapFormUnchanged ? (stored.map?.data || handoff.map?.data || {}) : (handoff.map?.data || {}), ...(stored.map?.artifacts ? { artifacts: stored.map.artifacts } : {}) }
    };
    if (handoff.to.kind === "result") delete merged.delivery;
    return merged;
  });
  if (Array.isArray(advanced.bindings)) {
    const referencedBindingIds = new Set(candidate.agents.map((agent) => agent.bindingRef));
    const configured = advanced.bindings.filter((binding) => referencedBindingIds.has(binding.id));
    const configuredIds = new Set(configured.map((binding) => binding.id));
    candidate.bindings = [...configured, ...candidate.bindings.filter((binding) => !configuredIds.has(binding.id))];
  }
  return candidate;
}

function teamIrSimulationSchemaFields(dataSchema) {
  if (!dataSchema || dataSchema.type !== "object" || !dataSchema.properties || Array.isArray(dataSchema.properties)) return null;
  const fields = Object.entries(dataSchema.properties);
  if (fields.some(([, schema]) => !schema || !["string", "number", "integer", "boolean"].includes(schema.type)
    || Object.keys(schema).some((key) => !["type", "title", "description", "default", "minimum", "maximum", "minLength", "maxLength"].includes(key)))) return null;
  if (Object.keys(dataSchema).some((key) => !["type", "properties", "required", "additionalProperties", "title", "description"].includes(key))) return null;
  return fields;
}

function teamIrConditionValueSummary(value) {
  if (value && typeof value === "object" && typeof value.$ref === "string" && Object.keys(value).length === 1) return value.$ref;
  if (value && typeof value === "object" && Object.hasOwn(value, "$literal") && Object.keys(value).length === 1) return JSON.stringify(value.$literal);
  return JSON.stringify(value);
}

export function teamIrConditionSummary(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return "Always selected";
  const args = Array.isArray(condition.args) ? condition.args : [];
  if (condition.op === "equals" || condition.op === "notEquals") {
    const operator = condition.op === "equals" ? "equals" : "does not equal";
    return `${teamIrConditionValueSummary(args[0])} ${operator} ${teamIrConditionValueSummary(args[1])}`;
  }
  if (condition.op === "and" || condition.op === "or") {
    const operator = condition.op === "and" ? " AND " : " OR ";
    return `(${args.map(teamIrConditionSummary).join(operator)})`;
  }
  if (condition.op === "not") return `NOT (${teamIrConditionSummary(args[0])})`;
  if (condition.op === "exists") {
    const reference = args[0]?.$ref || "<invalid reference>";
    return `${reference} exists (the path must be present; explicit null counts as present)`;
  }
  return JSON.stringify(condition);
}

function teamIrConditionEditorSupported(condition, depth = 0) {
  if (depth > 8) return false;
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return true;
  const args = condition.args;
  if (condition.op === "equals" || condition.op === "notEquals") return Array.isArray(args) && args.length === 2 && args.every((value) =>
    value && typeof value === "object" && !Array.isArray(value)
      && ((Object.keys(value).length === 1 && typeof value.$ref === "string") || (Object.keys(value).length === 1 && Object.hasOwn(value, "$literal"))));
  if (condition.op === "exists") return Array.isArray(args) && args.length === 1 && typeof args[0]?.$ref === "string";
  if (condition.op === "not") return Array.isArray(args) && args.length === 1 && teamIrConditionEditorSupported(args[0], depth + 1);
  if (condition.op === "and" || condition.op === "or") return Array.isArray(args) && args.length >= 1 && args.length <= 16
    && args.every((item) => teamIrConditionEditorSupported(item, depth + 1));
  return false;
}

function renderTeamIrConditionExpr(value, esc, editable) {
  const isRef = value && typeof value === "object" && typeof value.$ref === "string" && Object.keys(value).length === 1;
  const raw = isRef ? value.$ref : JSON.stringify(value && typeof value === "object" && Object.hasOwn(value, "$literal") ? value.$literal : "");
  return `<div class="ir-condition-expr"><select data-ir-condition-expr-kind aria-label="Condition value kind"${editable ? "" : " disabled"}><option value="ref"${isRef ? " selected" : ""}>Path</option><option value="literal"${isRef ? "" : " selected"}>Literal JSON</option></select><input data-ir-condition-expr-value aria-label="Condition path or literal JSON" value="${esc(raw)}"${editable ? "" : " disabled"}></div>`;
}

function renderTeamIrConditionNode(condition, esc, editable, root = false, depth = 0) {
  const supported = teamIrConditionEditorSupported(condition, depth);
  if (!supported) return `<div class="ir-condition-node ir-condition-unsupported"><span>Condition uses an expression not available in this editor. Edit it in Advanced JSON.</span></div>`;
  const op = condition?.op || "";
  const args = Array.isArray(condition?.args) ? condition.args : [];
  const options = `<option value=""${!op ? " selected" : ""}>Always selected</option><option value="equals"${op === "equals" ? " selected" : ""}>equals</option><option value="notEquals"${op === "notEquals" ? " selected" : ""}>does not equal</option><option value="exists"${op === "exists" ? " selected" : ""}>exists</option><option value="and"${op === "and" ? " selected" : ""}>all conditions (AND)</option><option value="or"${op === "or" ? " selected" : ""}>any condition (OR)</option><option value="not"${op === "not" ? " selected" : ""}>not</option>`;
  let content = "";
  if (op === "equals" || op === "notEquals") content = `${renderTeamIrConditionExpr(args[0], esc, editable)}<span class="ir-condition-operator">${op === "equals" ? "equals" : "does not equal"}</span>${renderTeamIrConditionExpr(args[1], esc, editable)}`;
  else if (op === "exists") content = renderTeamIrConditionExpr(args[0], esc, editable);
  else if (op === "not") content = `<div class="ir-condition-child">${renderTeamIrConditionNode(args[0], esc, editable, false, depth + 1)}</div>`;
  else if (op === "and" || op === "or") content = `<div class="ir-condition-children">${args.map((child) => `<div class="ir-condition-child">${renderTeamIrConditionNode(child, esc, editable, false, depth + 1)}${editable && args.length > 1 ? '<button class="text-button" type="button" data-ir-condition-remove-child>Remove condition</button>' : ""}</div>`).join("")}</div>${editable && args.length < 16 ? '<button class="secondary-button" type="button" data-ir-condition-add-child>Add condition</button>' : ""}`;
  return `<div class="ir-condition-node" data-ir-condition-node${root ? ' data-ir-condition-root="true"' : ""}><label class="ir-condition-op-label">${root ? "Condition" : "Condition group"}<select data-ir-condition-op aria-label="Condition operator"${editable ? "" : " disabled"}>${options}</select></label>${content}</div>`;
}

function readTeamIrConditionExpr(container) {
  const kind = container.querySelector("[data-ir-condition-expr-kind]")?.value;
  const raw = container.querySelector("[data-ir-condition-expr-value]")?.value ?? "";
  if (kind === "ref") return { $ref: raw.trim() };
  try { return { $literal: JSON.parse(raw) }; }
  catch { throw new Error("Condition literal must be valid JSON."); }
}

function readTeamIrConditionNode(container, depth = 0) {
  if (depth > 8) throw new Error("Condition nesting is limited to 8 levels in the structured editor.");
  const op = container.querySelector(":scope > .ir-condition-op-label [data-ir-condition-op]")?.value || "";
  if (!op) return undefined;
  if (op === "equals" || op === "notEquals") {
    const expressions = [...container.querySelectorAll(":scope > .ir-condition-expr")];
    if (expressions.length !== 2) throw new Error("Condition comparison requires two values.");
    return { op, args: expressions.map(readTeamIrConditionExpr) };
  }
  if (op === "exists") {
    const expression = container.querySelector(":scope > .ir-condition-expr");
    const value = expression && readTeamIrConditionExpr(expression);
    if (!value?.$ref) throw new Error("Exists requires a data path.");
    return { op, args: [value] };
  }
  if (op === "not") {
    const child = container.querySelector(":scope > .ir-condition-child > [data-ir-condition-node]");
    return { op, args: [child ? readTeamIrConditionNode(child, depth + 1) : { op: "exists", args: [{ $ref: "$.run.input.value" }] }] };
  }
  if (op === "and" || op === "or") {
    const children = [...container.querySelectorAll(":scope > .ir-condition-children > .ir-condition-child > [data-ir-condition-node]")]
      .map((child) => readTeamIrConditionNode(child, depth + 1)).filter(Boolean);
    if (!children.length) throw new Error("Condition group needs at least one condition.");
    return { op, args: children };
  }
  return undefined;
}

function renderTeamIrSimulationInput(schema, value, esc) {
  const fields = teamIrSimulationSchemaFields(schema);
  if (!fields) return `<label data-ir-simulation-input-container>Run input JSON<textarea data-ir-simulation-input rows="8" spellcheck="false">${esc(JSON.stringify(value, null, 2))}</textarea></label>`;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const controls = fields.map(([key, field]) => {
    const current = Object.hasOwn(value, key) ? value[key] : field.default;
    const label = esc(field.title || key);
    const description = field.description ? `<small class="field-hint">${esc(field.description)}</small>` : "";
    const attr = `data-ir-simulation-field="${esc(key)}" data-ir-simulation-type="${field.type}"${required.has(key) ? " required" : ""}`;
    if (field.type === "boolean") return `<label>${label}<input type="checkbox" ${attr}${current === true ? " checked" : ""}>${description}</label>`;
    if (field.type === "number" || field.type === "integer") {
      const bounds = `${Number.isFinite(field.minimum) ? ` min="${field.minimum}"` : ""}${Number.isFinite(field.maximum) ? ` max="${field.maximum}"` : ""}`;
      return `<label>${label}<input type="number" ${attr} step="${field.type === "integer" ? "1" : "any"}"${bounds} value="${current === undefined || current === null ? "" : esc(String(current))}">${description}</label>`;
    }
    const bounds = `${Number.isInteger(field.minLength) ? ` minlength="${field.minLength}"` : ""}${Number.isInteger(field.maxLength) ? ` maxlength="${field.maxLength}"` : ""}`;
    return `<label>${label}<input type="text" ${attr}${bounds} value="${current === undefined || current === null ? "" : esc(String(current))}">${description}</label>`;
  }).join("");
  return `<div data-ir-simulation-input-container data-ir-simulation-fields>${controls || '<p class="empty-note">This Run input has no data fields.</p>'}</div>`;
}

function decodeTeamIrPointer(pointer) {
  if (pointer === "" || pointer === "/") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return null;
  try {
    return pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return null;
  }
}

function teamIrAdvancedPointer(parts, ir) {
  if (!parts?.length) return [];
  if (parts[0] === "agents" && /^\d+$/.test(parts[1] || "")) {
    const agent = ir.agents?.[Number(parts[1])];
    if (!agent) return parts;
    if (["inputPorts", "outputPorts"].includes(parts[2])) return ["agentPortContracts", agent.id, ...parts.slice(2)];
  }
  if (parts[0] === "handoffs" && /^\d+$/.test(parts[1] || "")) {
    const handoff = ir.handoffs?.[Number(parts[1])];
    if (handoff) return ["handoffContracts", handoff.id, ...parts.slice(2)];
  }
  return parts;
}

function teamIrJsonPointerRange(source, parts) {
  if (!Array.isArray(parts)) return null;
  let cursor = 0;
  let targetRange = null;
  const skipSpace = () => { while (/\s/.test(source[cursor] || "")) cursor += 1; };
  const parseString = () => {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") { cursor += 2; continue; }
      if (source[cursor] === '"') { cursor += 1; return { start, end: cursor, value: JSON.parse(source.slice(start, cursor)) }; }
      cursor += 1;
    }
    throw new Error("Unterminated JSON string");
  };
  const parseValue = (path) => {
    skipSpace();
    const start = cursor;
    const valuePath = path;
    let value;
    if (source[cursor] === "{") {
      cursor += 1;
      skipSpace();
      value = {};
      while (source[cursor] !== "}") {
        skipSpace();
        const key = parseString().value;
        skipSpace();
        if (source[cursor] !== ":") throw new Error("Invalid JSON object");
        cursor += 1;
        value[key] = parseValue([...path, key]).value;
        skipSpace();
        if (source[cursor] !== ",") break;
        cursor += 1;
        skipSpace();
      }
      if (source[cursor] !== "}") throw new Error("Invalid JSON object");
      cursor += 1;
    } else if (source[cursor] === "[") {
      cursor += 1;
      skipSpace();
      value = [];
      let index = 0;
      while (source[cursor] !== "]") {
        value.push(parseValue([...path, String(index)]).value);
        index += 1;
        skipSpace();
        if (source[cursor] !== ",") break;
        cursor += 1;
        skipSpace();
      }
      if (source[cursor] !== "]") throw new Error("Invalid JSON array");
      cursor += 1;
    } else if (source[cursor] === '"') {
      value = parseString().value;
    } else {
      const endMatch = /^[^\s,}\]]+/.exec(source.slice(cursor));
      if (!endMatch) throw new Error("Invalid JSON value");
      cursor += endMatch[0].length;
      value = JSON.parse(endMatch[0]);
    }
    const end = cursor;
    if (valuePath.length === parts.length && valuePath.every((segment, index) => segment === parts[index])) {
      targetRange = { start, end };
    }
    return { value, range: { start, end, path: valuePath } };
  };
  try {
    parseValue([]);
  } catch {
    return null;
  }
  return targetRange;
}

function teamIrBasicControl(form, ir, parts) {
  if (!parts?.length) return null;
  const reflectValue = (target, value) => {
    if (target && target.type !== "checkbox" && target.tagName !== "TEXTAREA") {
      target.value = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
    }
    return target;
  };
  const [root, indexText, section, member, detail] = parts;
  const index = Number(indexText);
  if (root === "team" && parts[1] === "id") return form.querySelector('[name="team-id"]');
  if (root === "agents" && Number.isInteger(index)) {
    const agent = ir.agents?.[index];
    if (!agent) return null;
    const names = { id: "id", packageRef: "package", bindingRef: "binding" };
    if (names[section]) return form.querySelector(`[name="agent-${index}-${names[section]}"]`);
    if (["inputPorts", "outputPorts"].includes(section) && agent[section]?.[member]) {
      const portRow = [...form.querySelectorAll(`[data-ir-agent="${index}"] [data-ir-port-row="${section}"]`)]
        .find((row) => row.querySelector('input[name$="-id"]')?.value === member);
      if (!portRow) return null;
      if (detail === undefined) return portRow.querySelector('input[name$="-id"]');
      if (detail === "dataSchema") return portRow.querySelector('textarea[name$="-schema"]');
      if (detail === "artifactSlots") return portRow.querySelector('textarea[name$="-artifacts"]');
    }
    return null;
  }
  if (root === "handoffs" && Number.isInteger(index)) {
    const edge = ir.handoffs?.[index];
    if (!edge) return null;
    if (section === "id") return form.querySelector(`[name="handoff-${index}-id"]`);
    if (section === "from") {
      if (member === "agentId" || member === "kind") return form.querySelector(`[name="handoff-${index}-from-agent"]`);
      if (member === "outputPort") return form.querySelector(`[name="handoff-${index}-from-port"]`);
    }
    if (section === "to") {
      if (member === "agentId" || member === "kind") return form.querySelector(`[name="handoff-${index}-to-agent"]`);
      if (member === "inputPort") return form.querySelector(`[name="handoff-${index}-to-port"]`);
    }
    if (section === "map" && member === "data") {
      const rows = [...form.querySelectorAll(`[data-ir-handoff="${index}"] [data-ir-map-row]`)];
      const selected = rows.find((row) => row.querySelector("[data-ir-map-target]")?.value === detail);
      if (!selected) return null;
      const suffix = parts.slice(5);
      const reserved = suffix.at(-1) === "$ref" || suffix.at(-1) === "$literal" ? suffix.pop() : null;
      const node = [...selected.querySelectorAll("[data-ir-value-node]")].find((candidate) => JSON.stringify(JSON.parse(candidate.dataset.irValuePath || "[]")) === JSON.stringify(suffix));
      if (!node) return null;
      const expression = teamIrValueAtPath(edge.map?.data?.[detail], suffix);
      if (reserved === "$ref" || (!reserved && typeof expression?.$ref === "string")) {
        const reference = node.querySelector("[data-ir-value-direct-ref]");
        if (reference && typeof expression?.$ref === "string") {
          if (![...reference.options].some((option) => option.value === expression.$ref)) reference.add(new Option(expression.$ref, expression.$ref));
          return reflectValue(reference, expression.$ref);
        }
        const path = node.querySelector("[data-ir-value-ref-path]");
        if (path && typeof expression?.$ref === "string") return reflectValue(path, expression.$ref);
        return reference || path || node.querySelector("[data-ir-value-kind]");
      }
      if (reserved === "$ref") return node.querySelector("[data-ir-value-direct-ref], [data-ir-value-ref-path]") || node.querySelector("[data-ir-value-kind]");
      if (reserved === "$literal") return node.querySelector("[data-ir-value-literal]") || node.querySelector("[data-ir-value-kind]");
      if (suffix.length) return node.querySelector("[data-ir-value-kind]");
      return node.querySelector("[data-ir-value-direct-ref], [data-ir-value-ref-path], [data-ir-value-kind]");
    }
    if (section === "when") {
      if (member === "priority") return form.querySelector(`[name="handoff-${index}-priority"]`);
      if (member === "condition") return form.querySelector(`[data-ir-condition-editor="${index}"] [data-ir-condition-root] [data-ir-condition-op]`);
    }
  }
  if (root === "orchestration" && Number.isInteger(Number(section))) {
    const orchestrationIndex = Number(section);
    if (indexText === "joins" && ir.orchestration?.joins?.[orchestrationIndex]) {
      const joinRow = form.querySelector(`[data-ir-join="${orchestrationIndex}"]`);
      if (member === "baseMapping" && detail === "data" && typeof parts[5] === "string") {
        const mappingRow = [...(joinRow?.querySelectorAll("[data-ir-join-base-row]") || [])]
          .find((candidate) => candidate.querySelector("[data-ir-join-base-target]")?.value === parts[5]);
        if (mappingRow) {
          const mapping = ir.orchestration.joins[orchestrationIndex].baseMapping?.data?.[parts[5]];
          const suffix = parts.slice(6);
          const reserved = suffix.at(-1) === "$ref" || suffix.at(-1) === "$literal" ? suffix.pop() : null;
          const valueNode = [...mappingRow.querySelectorAll("[data-ir-value-node]")]
            .find((candidate) => JSON.stringify(JSON.parse(candidate.dataset.irValuePath || "[]")) === JSON.stringify(suffix));
          if (valueNode) {
            if (reserved === "$ref") return valueNode.querySelector("[data-ir-value-direct-ref], [data-ir-value-ref-path]") || valueNode.querySelector("[data-ir-value-kind]");
            if (reserved === "$literal") return valueNode.querySelector("[data-ir-value-literal]") || valueNode.querySelector("[data-ir-value-kind]");
            if (suffix.length) return valueNode.querySelector("[data-ir-value-kind]");
          }
          if (typeof mapping?.$ref === "string") {
            const source = mappingRow.querySelector("[data-ir-join-base-source]");
            if (source && ![...source.options].some((option) => option.value === mapping.$ref.split(".").at(-1))) {
              source.add(new Option(mapping.$ref.split(".").at(-1), mapping.$ref.split(".").at(-1)));
            }
            if (source) return reflectValue(source, mapping.$ref.split(".").at(-1));
          }
          return mappingRow.querySelector("[data-ir-value-kind], [data-ir-value-ref-path], [data-ir-value-literal], [data-ir-join-base-target]");
        }
      }
      const fields = { id: "id", agentId: "agent", inputPort: "port", mode: "mode", threshold: "threshold", timeoutMs: "timeout", scope: "scope-kind", handoffIds: "handoffs" };
      if (fields[member]) {
        const value = member === "scope" ? ir.orchestration.joins[orchestrationIndex].scope?.kind : ir.orchestration.joins[orchestrationIndex][member];
        return reflectValue(form.querySelector(`[name="join-${orchestrationIndex}-${fields[member]}"]`), value);
      }
      if (member === "scope" && detail === "loopId") return reflectValue(form.querySelector(`[name="join-${orchestrationIndex}-scope-loop"]`), ir.orchestration.joins[orchestrationIndex].scope?.loopId);
    }
    if (indexText === "loops" && ir.orchestration?.loops?.[orchestrationIndex]) {
      const fields = { id: "id", boundaryAgentId: "boundary", members: "members", maxRounds: "rounds", maxAgentActivations: "activations", onExhausted: "exhausted", entryHandoffIds: "entry", continueHandoffIds: "continue", exitHandoffIds: "exit" };
      if (fields[member]) return reflectValue(form.querySelector(`[name="loop-${orchestrationIndex}-${fields[member]}"]`), ir.orchestration.loops[orchestrationIndex][member]);
    }
    if (indexText === "reviews" && ir.orchestration?.reviews?.[orchestrationIndex]) {
      const fields = { id: "id", timeoutMs: "timeout", feedbackSchema: "feedback-schema", onTimeout: "on-timeout" };
      if (fields[member]) return reflectValue(form.querySelector(`[name="review-${orchestrationIndex}-${fields[member]}"]`), ir.orchestration.reviews[orchestrationIndex][member]);
      if (member === "at") {
        return form.querySelector(`[name="review-${orchestrationIndex}-at"]`);
      }
    }
  }
  return null;
}

function focusTeamIrDiagnostic(form, ir, pointer) {
  const revealTarget = (target) => {
    target.focus({ preventScroll: true });
    if (target.tagName === "TEXTAREA" || ["text", "search", "url", "tel", "password"].includes(target.type)) target.select?.();
    target.scrollIntoView({
      block: "center",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
    target.classList.add("ir-diagnostic-target");
    window.setTimeout(() => target.classList.remove("ir-diagnostic-target"), 1400);
  };
  const parts = decodeTeamIrPointer(pointer);
  const basic = teamIrBasicControl(form, ir, parts);
  if (basic) {
    revealTarget(basic);
    return;
  }
  const advanced = form.querySelector("[data-ir-advanced-json]");
  if (!advanced) return;
  const details = advanced.closest("details");
  if (details) details.open = true;
  const advancedParts = teamIrAdvancedPointer(parts, ir);
  const range = teamIrJsonPointerRange(advanced.value, advancedParts);
  const fallback = range || { start: 0, end: Math.min(advanced.value.length, 1) };
  revealTarget(advanced);
  advanced.setSelectionRange(fallback.start, fallback.end);
}

function schemaFromFields(value) {
  const fields = [...new Set(String(value || "").split(",").map((item) => item.trim()).filter((item) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(item)))];
  return { type: "object", properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])), required: fields, additionalProperties: false };
}

function fieldsFromSchema(schema) {
  return Object.keys(schema?.properties || {}).join(", ");
}

function teamIrHandoffMappingFields(ir, handoff) {
  const sourceSchema = handoff.from.kind === "run"
    ? ir.runInput?.dataSchema
    : ir.agents.find((agent) => agent.id === handoff.from.agentId)?.outputPorts?.[handoff.from.outputPort]?.dataSchema;
  const targetSchema = handoff.to.kind === "result"
    ? ir.runResult?.dataSchema
    : ir.agents.find((agent) => agent.id === handoff.to.agentId)?.inputPorts?.[handoff.to.inputPort]?.dataSchema;
  const sourceFields = Object.keys(sourceSchema?.properties || {});
  const targetFields = Object.keys(targetSchema?.properties || {});
  const sourceRoot = handoff.from.kind === "run" ? "$.run.input" : "$.output.data";
  return { sourceFields, targetFields, sourceRoot };
}

const TEAM_IR_VALUE_EDITOR_MAX_DEPTH = 6;
const TEAM_IR_VALUE_EDITOR_MAX_ITEMS = 16;

function teamIrValueExprKind(value) {
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$ref" && typeof value.$ref === "string") return "reference";
    if (keys.length === 1 && keys[0] === "$literal") return "literal";
    if (keys.includes("$ref") || keys.includes("$literal")) return "unsupported";
    return "object";
  }
  return "literal";
}

function teamIrValueExprEditable(value, depth = 0) {
  if (depth > TEAM_IR_VALUE_EDITOR_MAX_DEPTH) return false;
  const kind = teamIrValueExprKind(value);
  if (kind === "unsupported") return false;
  if (kind === "reference" || kind === "literal") return true;
  if (kind === "array") return value.length <= TEAM_IR_VALUE_EDITOR_MAX_ITEMS && value.every((item) => teamIrValueExprEditable(item, depth + 1));
  const entries = Object.entries(value);
  return entries.length <= TEAM_IR_VALUE_EDITOR_MAX_ITEMS && entries.every(([, item]) => teamIrValueExprEditable(item, depth + 1));
}

function renderTeamIrValueExprNode(value, options, escText, editable, depth = 0, path = []) {
  const kind = teamIrValueExprKind(value);
  const pathValue = escText(JSON.stringify(path));
  const disabled = editable ? "" : " disabled";
  const kindOptions = [["reference", "Reference"], ["literal", "Literal"], ["object", "Object"], ["array", "Array"]]
    .map(([option, label]) => `<option value="${option}"${kind === option ? " selected" : ""}>${label}</option>`).join("");
  let content = "";
  if (kind === "reference") {
    const directRefs = depth === 0 && options.directRefs ? [...options.directRefs, ...(value.$ref && !options.directRefs.some((item) => item.reference === value.$ref) ? [{ value: value.$ref, reference: value.$ref, label: `${value.$ref} (review)` }] : [])] : [];
    const direct = directRefs.find((item) => item.reference === value.$ref);
    if (direct) {
      const sourceAttr = options.kind === "handoff" ? "data-ir-map-source" : "data-ir-join-base-source";
      content = `<label>${options.kind === "handoff" ? "Source field" : "Run input field"}<select ${sourceAttr} data-ir-value-direct-ref aria-label="${escText(options.directLabel)}"${disabled}><option value="">Choose field</option>${directRefs.map((item) => `<option value="${escText(item.value)}"${item.reference === value.$ref ? " selected" : ""}>${escText(item.label)}</option>`).join("")}</select></label>`;
    } else {
      content = `<label>Reference path<input data-ir-value-ref-path value="${escText(value.$ref)}" placeholder="$.run.input.field"${disabled}></label>`;
    }
  } else if (kind === "literal") {
    const literal = value && typeof value === "object" && Object.hasOwn(value, "$literal") ? value.$literal : value;
    content = `<label>JSON value<textarea data-ir-value-literal rows="3" spellcheck="false"${disabled}>${escText(JSON.stringify(literal, null, 2))}</textarea></label>`;
  } else if (kind === "object") {
    const entries = Object.entries(value);
    content = `<div class="ir-value-children">${entries.map(([key, child], index) => `<div class="ir-value-child" data-ir-value-entry><label>Property<input data-ir-value-object-key value="${escText(key)}" aria-label="Object property ${index + 1}"${disabled}></label>${renderTeamIrValueExprNode(child, options, escText, editable, depth + 1, [...path, key])}<button class="icon-button" type="button" data-ir-value-remove aria-label="Remove object property ${escText(key)}" title="Remove property"${disabled}>×</button></div>`).join("")}</div><button class="text-button" type="button" data-ir-value-add="object"${disabled || depth >= TEAM_IR_VALUE_EDITOR_MAX_DEPTH || entries.length >= TEAM_IR_VALUE_EDITOR_MAX_ITEMS ? " disabled" : ""}>Add property</button>`;
  } else if (kind === "array") {
    content = `<div class="ir-value-children">${value.map((child, index) => `<div class="ir-value-child" data-ir-value-entry>${renderTeamIrValueExprNode(child, options, escText, editable, depth + 1, [...path, String(index)])}<button class="icon-button" type="button" data-ir-value-remove aria-label="Remove array item ${index + 1}" title="Remove item"${disabled}>×</button></div>`).join("")}</div><button class="text-button" type="button" data-ir-value-add="array"${disabled || depth >= TEAM_IR_VALUE_EDITOR_MAX_DEPTH || value.length >= TEAM_IR_VALUE_EDITOR_MAX_ITEMS ? " disabled" : ""}>Add item</button>`;
  } else {
    content = '<p class="field-hint">This value is outside the structured editor grammar. Edit it in Advanced JSON.</p>';
  }
  return `<div class="ir-value-node" data-ir-value-node data-ir-value-path="${pathValue}" data-ir-value-depth="${depth}"><label>Value type<select data-ir-value-kind aria-label="Mapping value type"${disabled}>${kindOptions}</select></label>${content}<p class="field-hint" data-ir-value-error hidden></p></div>`;
}

function teamIrValueAtPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function teamIrSetValueAtPath(value, path, replacement) {
  if (!path.length) return replacement;
  const parent = teamIrValueAtPath(value, path.slice(0, -1));
  if (parent && typeof parent === "object") parent[path.at(-1)] = replacement;
  return value;
}

function teamIrDeleteValueAtPath(value, path) {
  if (!path.length) return value;
  const parent = teamIrValueAtPath(value, path.slice(0, -1));
  const key = path.at(-1);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else if (parent && typeof parent === "object") delete parent[key];
  return value;
}

function renderTeamIrMappingRow(index, rowIndex, fields, values, escText, editable) {
  const targetOptions = [...new Set([...fields.targetFields, values.target].filter(Boolean))];
  const targetList = `<option value="">Choose field</option>${targetOptions.map((item) => `<option value="${escText(item)}"${item === values.target ? " selected" : ""}>${escText(item)}</option>`).join("")}`;
  const expression = values.expression ?? { $ref: values.reference || "" };
  const editorOptions = {
    kind: "handoff",
    directRefs: fields.sourceFields.map((field) => ({ value: `${fields.sourceRoot}.${field}`, reference: `${fields.sourceRoot}.${field}`, label: `${fields.sourceRoot}.${field}` })),
    directLabel: `Handoff ${index + 1} source field`
  };
  return `<div class="ir-map-row ir-value-map-row" data-ir-map-row="${rowIndex}"><label>Target field<select data-ir-map-target aria-label="Handoff ${index + 1} target field"${editable ? "" : " disabled"}>${targetList}</select></label><div class="ir-value-editor" data-ir-value-editor><input type="hidden" data-ir-value-state value="${escText(JSON.stringify(expression))}">${renderTeamIrValueExprNode(expression, editorOptions, escText, editable)}</div><button class="icon-button" type="button" data-ir-map-remove aria-label="Remove field mapping" title="Remove field mapping"${editable ? "" : " disabled"}>×</button></div>`;
}

function teamIrJoinBaseMappingFields(ir, join) {
  const agent = ir.agents.find((item) => item.id === join.agentId);
  const targetSchema = agent?.inputPorts?.[join.inputPort]?.dataSchema;
  return {
    sourceFields: Object.keys(ir.runInput?.dataSchema?.properties || {}),
    targetFields: Object.keys(targetSchema?.properties || {})
  };
}

function renderTeamIrJoinBaseMappingRow(index, rowIndex, fields, values, escText, editable) {
  const targetOptions = [...new Set([...fields.targetFields, values.target].filter(Boolean))];
  const targetList = `<option value="">Choose field</option>${targetOptions.map((item) => `<option value="${escText(item)}"${item === values.target ? " selected" : ""}>${escText(item)}</option>`).join("")}`;
  const expression = values.expression ?? { $ref: values.source ? `$.run.input.${values.source}` : "" };
  const editorOptions = {
    kind: "join",
    directRefs: fields.sourceFields.map((field) => ({ value: field, reference: `$.run.input.${field}`, label: field })),
    directLabel: `Join ${index + 1} base mapping source`
  };
  return `<div class="ir-map-row ir-value-map-row" data-ir-join-base-row="${rowIndex}"><label>Join target field<select data-ir-join-base-target aria-label="Join ${index + 1} base mapping target"${editable ? "" : " disabled"}>${targetList}</select></label><div class="ir-value-editor" data-ir-value-editor><input type="hidden" data-ir-value-state value="${escText(JSON.stringify(expression))}">${renderTeamIrValueExprNode(expression, editorOptions, escText, editable)}</div><button class="icon-button" type="button" data-ir-join-base-remove aria-label="Remove Join base mapping" title="Remove field mapping"${editable ? "" : " disabled"}>×</button></div>`;
}

function stableTeamIrSchemaValue(value) {
  if (Array.isArray(value)) return value.map(stableTeamIrSchemaValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableTeamIrSchemaValue(value[key])]));
  }
  return value;
}

function hasTeamIrSchemaReference(value) {
  if (Array.isArray(value)) return value.some(hasTeamIrSchemaReference);
  if (!value || typeof value !== "object") return false;
  return Object.hasOwn(value, "$ref") || Object.values(value).some(hasTeamIrSchemaReference);
}

function teamIrAutoMappingCandidates(ir, handoff) {
  const sourceSchema = handoff.from.kind === "run"
    ? ir.runInput?.dataSchema
    : ir.agents.find((agent) => agent.id === handoff.from.agentId)?.outputPorts?.[handoff.from.outputPort]?.dataSchema;
  const targetSchema = handoff.to.kind === "result"
    ? ir.runResult?.dataSchema
    : ir.agents.find((agent) => agent.id === handoff.to.agentId)?.inputPorts?.[handoff.to.inputPort]?.dataSchema;
  const sourceProperties = sourceSchema?.properties || {};
  const targetProperties = targetSchema?.properties || {};
  const sourceRequired = new Set(sourceSchema?.required || []);
  const sourceRoot = handoff.from.kind === "run" ? "$.run.input" : "$.output.data";
  const alreadyMapped = new Set(Object.keys(handoff.map?.data || {}));
  const canAssign = (source, target) => {
    if (!source || !target || hasTeamIrSchemaReference(source) || hasTeamIrSchemaReference(target)) return false;
    return JSON.stringify(stableTeamIrSchemaValue(source)) === JSON.stringify(stableTeamIrSchemaValue(target));
  };
  return Object.keys(targetProperties).filter((field) => sourceRequired.has(field)
    && Object.hasOwn(sourceProperties, field) && !alreadyMapped.has(field)
    && canAssign(sourceProperties[field], targetProperties[field]))
    .map((field) => ({ target: field, reference: `${sourceRoot}.${field}` }));
}

function teamIrFromEditor(form, base) {
  const data = new FormData(form);
  let advanced = {};
  let advancedHandoffContracts = {};
  try {
    advanced = JSON.parse(form.querySelector("[data-ir-advanced-json]")?.value || "{}");
    advancedHandoffContracts = advanced.handoffContracts || {};
  } catch { /* The advanced editor reports invalid JSON through its own validation path. */ }
  const parsePortJson = (value, label) => {
    try { return JSON.parse(value); }
    catch (error) { throw new Error(`${label} must be valid JSON: ${error.message}`); }
  };
  const agents = [...form.querySelectorAll("[data-ir-agent]")].map((row) => {
    const index = row.dataset.irAgent;
    const id = String(data.get(`agent-${index}-id`) || "").trim();
    const readPorts = (direction) => Object.fromEntries([...row.querySelectorAll(`[data-ir-port-row="${direction}"]`)].map((portRow) => {
      const portIndex = portRow.dataset.irPortIndex;
      const portId = String(data.get(`agent-${index}-${direction}-${portIndex}-id`) || "").trim();
      if (!portId) throw new Error(`${direction === "inputPorts" ? "Input" : "Output"} port ID is required.`);
      const dataSchema = parsePortJson(data.get(`agent-${index}-${direction}-${portIndex}-schema`), `${portId} data schema`);
      const artifactSlotsText = String(data.get(`agent-${index}-${direction}-${portIndex}-artifacts`) || "").trim();
      const port = { dataSchema };
      if (artifactSlotsText) port.artifactSlots = parsePortJson(artifactSlotsText, `${portId} Artifact slots`);
      return [portId, port];
    }));
    return {
      id,
      packageRef: String(data.get(`agent-${index}-package`) || "").trim(),
      bindingRef: String(data.get(`agent-${index}-binding`) || "").trim(),
      inputPorts: readPorts("inputPorts"),
      outputPorts: readPorts("outputPorts")
    };
  });
  const bindingIds = new Set(agents.map((agent) => agent.bindingRef).filter(Boolean));
  const bindings = (advanced.bindings || []).filter((binding) => bindingIds.has(binding.id)).map((binding) => structuredClone(binding));
  // A trusted catalog may expose a new immutable Binding ref before the
  // current draft has a concrete entry for it. Reuse the existing Binding
  // contract as the explicit seed; the user still has to select the ref and
  // the server remains authoritative for closure validation.
  const bindingTemplate = advanced.bindings?.find((binding) => binding && typeof binding === "object");
  for (const bindingId of bindingIds) {
    if (!bindings.some((binding) => binding.id === bindingId) && bindingTemplate) {
      bindings.push({ ...structuredClone(bindingTemplate), id: bindingId });
    }
  }
  const handoffs = [...form.querySelectorAll("[data-ir-handoff]")].map((row) => {
    const index = row.dataset.irHandoff;
    const fromAgentId = String(data.get(`handoff-${index}-from-agent`) || "");
    const fromPort = String(data.get(`handoff-${index}-from-port`) || "").trim();
    const toAgentId = String(data.get(`handoff-${index}-to-agent`) || "");
    const toPort = String(data.get(`handoff-${index}-to-port`) || "").trim();
    const id = String(data.get(`handoff-${index}-id`) || "").trim();
    const preservedMap = JSON.parse(row.querySelector("[data-ir-map-preserved]")?.value || "{}");
    const mapData = { ...preservedMap };
    for (const mappingRow of row.querySelectorAll("[data-ir-map-row]")) {
      const invalidValue = mappingRow.querySelector("[data-ir-value-error]:not([hidden])");
      if (invalidValue) throw new Error(invalidValue.textContent || `Handoff ${index + 1} mapping is invalid.`);
      const target = mappingRow.querySelector("[data-ir-map-target]")?.value;
      const expression = parsePortJson(mappingRow.querySelector("[data-ir-value-state]")?.value || "null", `Handoff ${index + 1} mapping`);
      if (target && !(expression && typeof expression === "object" && !Array.isArray(expression) && expression.$ref === "")) mapData[target] = expression;
    }
    const map = { data: mapData };
    const from = fromAgentId ? { kind: "agent", agentId: fromAgentId, outputPort: fromPort } : { kind: "run" };
    const to = toAgentId === "@result" ? { kind: "result" } : { kind: "agent", agentId: toAgentId, inputPort: toPort };
    const conditionNode = row.querySelector("[data-ir-condition-root]");
    const condition = conditionNode ? readTeamIrConditionNode(conditionNode) : advancedHandoffContracts[id]?.when?.condition;
    const oldWhen = advancedHandoffContracts[id]?.when;
    const priority = Number(data.get(`handoff-${index}-priority`) || 0);
    const when = conditionNode
      ? condition ? { condition, priority } : undefined
      : oldWhen?.condition ? { ...oldWhen, priority } : undefined;
    return { id, from, to, map, ...(when ? { when } : {}), ...(to.kind === "agent" ? { delivery: { deadlineMs: 300000 } } : {}) };
  });
  const joins = [...form.querySelectorAll("[data-ir-join]")].map((row) => {
    const index = row.dataset.irJoin;
    const id = String(data.get(`join-${index}-id`) || "").trim();
    const mode = String(data.get(`join-${index}-mode`) || "all_of");
    const handoffIds = data.getAll(`join-${index}-handoffs`).map((item) => String(item));
    const advancedJoin = (advanced.orchestration?.joins || []).find((item) => item.id === id) || {};
    let preservedBaseMapping = {};
    try { preservedBaseMapping = JSON.parse(row.querySelector("[data-ir-join-base-preserved]")?.value || "{}"); } catch { /* Advanced JSON validation reports malformed values. */ }
    const baseMappingData = { ...preservedBaseMapping };
    for (const mappingRow of row.querySelectorAll("[data-ir-join-base-row]")) {
      const invalidValue = mappingRow.querySelector("[data-ir-value-error]:not([hidden])");
      if (invalidValue) throw new Error(invalidValue.textContent || `Join ${index + 1} base mapping is invalid.`);
      const target = mappingRow.querySelector("[data-ir-join-base-target]")?.value;
      const expression = parsePortJson(mappingRow.querySelector("[data-ir-value-state]")?.value || "null", `Join ${index + 1} base mapping`);
      if (target && !(expression && typeof expression === "object" && !Array.isArray(expression) && expression.$ref === "")) baseMappingData[target] = expression;
    }
    return {
      id,
      agentId: String(data.get(`join-${index}-agent`) || "").trim(),
      inputPort: String(data.get(`join-${index}-port`) || "").trim(),
      mode,
      handoffIds,
      scope: { kind: String(data.get(`join-${index}-scope-kind`) || "run"), ...(String(data.get(`join-${index}-scope-loop`) || "").trim() ? { loopId: String(data.get(`join-${index}-scope-loop`)).trim() } : {}) },
      ...(mode === "quorum_of" ? { threshold: Number(data.get(`join-${index}-threshold`)) } : {}),
      ...(Object.keys(baseMappingData).length || advancedJoin.baseMapping ? { baseMapping: { data: baseMappingData } } : {}),
      timeoutMs: Number(data.get(`join-${index}-timeout`) || 0),
      onTimeout: "fail"
    };
  });
  const loops = [...form.querySelectorAll("[data-ir-loop]")].map((row) => {
    const index = row.dataset.irLoop;
    const list = (key) => String(data.get(`loop-${index}-${key}`) || "").split(",").map((item) => item.trim()).filter(Boolean);
    const boundaryAgentId = String(data.get(`loop-${index}-boundary`) || "").trim();
    return {
      id: String(data.get(`loop-${index}-id`) || "").trim(),
      members: String(data.get(`loop-${index}-members`) || "").split(",").map((item) => item.trim()).filter(Boolean),
      boundaryAgentId,
      entryHandoffIds: list("entry"),
      continueHandoffIds: list("continue"),
      exitHandoffIds: list("exit"),
      maxRounds: Number(data.get(`loop-${index}-rounds`) || 0),
      maxAgentActivations: Number(data.get(`loop-${index}-activations`) || 0),
      onExhausted: String(data.get(`loop-${index}-exhausted`) || "fail")
    };
  });
  const reviews = [...form.querySelectorAll("[data-ir-review]")].map((row) => {
    const index = row.dataset.irReview;
    let position;
    try { position = JSON.parse(String(data.get(`review-${index}-at`) || "null")); } catch { position = null; }
    const [agentId, outputPort] = Array.isArray(position) ? position : [];
    if (!agentId || !outputPort) throw new Error(`Review ${index + 1} requires a valid Agent output position.`);
    return {
      id: String(data.get(`review-${index}-id`) || "").trim(),
      at: { kind: "agentOutput", agentId, outputPort },
      feedbackSchema: parsePortJson(data.get(`review-${index}-feedback-schema`), `Review ${index + 1} feedback schema`),
      timeoutMs: Number(data.get(`review-${index}-timeout`) || 0),
      onTimeout: "fail"
    };
  });
  const routes = [];
  const sourceGroups = new Map();
  for (const edge of handoffs) {
    const key = edge.from.kind === "run" ? "run" : `${edge.from.agentId}:${edge.from.outputPort}`;
    sourceGroups.set(key, [...(sourceGroups.get(key) || []), edge]);
  }
  for (const group of sourceGroups.values()) if (group.length > 1 || group.some((edge) => edge.when)) {
    const from = group[0].from;
    const mode = group.some((edge) => edge.when) ? "exclusive_priority" : "parallel_fanout";
    group.forEach((edge, index) => { if (mode === "exclusive_priority" && !edge.when) edge.when = { priority: index + group.length }; });
    routes.push({ from, mode, onNoMatch: "fail", handoffIds: group.map((edge) => edge.id) });
  }
  return {
    ...base,
    team: { id: String(data.get("team-id") || base.team.id).trim(), version: base.team?.version || "2.0.0" },
    agents, handoffs, bindings,
    orchestration: { routes, joins, loops, reviews }
  };
}

function renderTeamIrJoinOwnershipMatrix(ir, join, escText) {
  const targetAgent = (ir.agents || []).find((agent) => agent.id === join.agentId);
  const targetPort = targetAgent?.inputPorts?.[join.inputPort];
  const targetProperties = targetPort?.dataSchema?.properties || {};
  const required = new Set(targetPort?.dataSchema?.required || []);
  const targetArtifacts = targetPort?.artifactSlots || {};
  const sourceHandoffs = (join.handoffIds || []).map((id) => (ir.handoffs || []).find((handoff) => handoff.id === id)).filter(Boolean);
  const baseMappingData = join.baseMapping?.data || {};
  const rows = [];
  for (const field of Object.keys(targetProperties)) {
    const providers = sourceHandoffs.filter((handoff) => Object.hasOwn(handoff.map?.data || {}, field));
    const baseProvider = Object.hasOwn(baseMappingData, field) ? ["Run input"] : [];
    const providerLabels = [...baseProvider, ...providers.map((handoff) => handoff.id)];
    const conditional = providers.some((handoff) => handoff.when?.condition);
    rows.push({ field, kind: "field", required: required.has(field), providers: providerLabels, conditional });
  }
  for (const slot of Object.keys(targetArtifacts)) {
    const providers = sourceHandoffs.filter((handoff) => Object.hasOwn(handoff.map?.artifacts || {}, slot));
    const conditional = providers.some((handoff) => handoff.when?.condition);
    rows.push({ field: slot, kind: "artifact", required: targetArtifacts[slot]?.required === true, providers: providers.map((handoff) => handoff.id), conditional });
  }
  if (!rows.length) return '<p class="field-hint">Target Schema has no declared fields or Artifact slots. The server remains authoritative for Join diagnostics.</p>';
  const body = rows.map((row) => {
    const missing = row.required && row.providers.length === 0;
    const conflict = row.providers.length > 1;
    const arrival = row.providers.length === 0 ? "Missing" : row.conditional ? "May be skipped" : "Guaranteed";
    const state = missing ? "Missing provider" : conflict ? "Conflict" : "";
    return `<tr class="${missing || conflict ? "is-warning" : ""}"><th scope="row">${escText(row.field)}<small>${row.kind === "artifact" ? "Artifact" : "Data"}</small></th><td>${row.required ? "Required" : "Optional"}</td><td>${arrival}</td><td>${escText(row.providers.join(", ") || "—")}</td><td>${escText(state)}</td></tr>`;
  }).join("");
  return `<div class="ir-join-ownership"><div class="panel-head"><strong>Join field ownership</strong><span class="field-hint">Read-only view; server diagnostics decide save and release.</span></div><div class="ir-join-ownership-scroll"><table><thead><tr><th>Target</th><th>Required</th><th>Arrival</th><th>Sources</th><th>Check</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

function renderTeamIrOrchestrationRows(ir, escText, editable) {
  const disabled = editable ? "" : " disabled";
  const agents = ir.agents || [];
  const handoffs = ir.handoffs || [];
  const agentOptions = (selected) => agents.map((agent) => `<option value="${escText(agent.id)}"${agent.id === selected ? " selected" : ""}>${escText(agent.id)}</option>`).join("");
  const joins = (ir.orchestration?.joins || []).map((join, index) => {
    const fields = teamIrJoinBaseMappingFields(ir, join);
    const baseData = join.baseMapping?.data || {};
    const simpleMappings = [];
    const preserved = {};
    for (const [target, mapping] of Object.entries(baseData)) {
      if (teamIrValueExprEditable(mapping)) simpleMappings.push({ target, expression: mapping });
      else preserved[target] = mapping;
    }
    const mappingRows = simpleMappings.map((mapping, rowIndex) => renderTeamIrJoinBaseMappingRow(index, rowIndex, fields, mapping, escText, editable)).join("");
    return `<section class="project-panel ir-editor-row" data-ir-join="${index}">
    <div class="panel-head"><h3>Join ${index + 1}</h3><button class="icon-button" type="button" data-ir-remove-join="${index}" aria-label="Remove Join" title="Remove Join"${disabled}>×</button></div>
    <div class="ir-form-grid">
      <label>Join ID<input name="join-${index}-id" value="${escText(join.id || "")}" required${disabled}></label>
      <label>Target Agent<select name="join-${index}-agent" required${disabled}>${agentOptions(join.agentId)}</select></label>
      <label>Target input port<input name="join-${index}-port" value="${escText(join.inputPort || "")}" required${disabled}></label>
      <label>Mode<select name="join-${index}-mode"${disabled}><option value="all_of"${join.mode === "all_of" ? " selected" : ""}>all_of</option><option value="quorum_of"${join.mode === "quorum_of" ? " selected" : ""}>quorum_of</option></select></label>
      <label>Quorum threshold<input type="number" min="1" name="join-${index}-threshold" value="${Number(join.threshold || 1)}"${disabled}></label>
      <label>Timeout (ms)<input type="number" min="1" name="join-${index}-timeout" value="${Number(join.timeoutMs || 0)}" required${disabled}></label>
      <label>Scope<select name="join-${index}-scope-kind"${disabled}><option value="run"${join.scope?.kind !== "loop" ? " selected" : ""}>Run</option><option value="loop"${join.scope?.kind === "loop" ? " selected" : ""}>Loop</option></select></label>
      <label>Scope Loop ID<input name="join-${index}-scope-loop" value="${escText(join.scope?.loopId || "")}"${disabled}></label>
      <fieldset class="full ir-join-handoffs"><legend>Contributing Handoffs</legend>${handoffs.length ? handoffs.map((handoff) => `<label class="ir-handoff-choice"><input type="checkbox" name="join-${index}-handoffs" value="${escText(handoff.id)}"${(join.handoffIds || []).includes(handoff.id) ? " checked" : ""}${disabled}><span>${escText(handoff.id)}</span></label>`).join("") : '<p class="empty-note">No Handoffs are defined.</p>'}</fieldset>
      <fieldset class="full"><legend>Base mapping from Run input</legend><input type="hidden" data-ir-join-base-preserved value="${escText(JSON.stringify(preserved))}"><div data-ir-join-base-mappings>${mappingRows}</div><button class="secondary-button" type="button" data-ir-join-base-add${disabled}>Add field mapping</button></fieldset>
      <div class="full">${renderTeamIrJoinOwnershipMatrix(ir, join, escText)}</div>
    </div></section>`;
  }).join("");
  const loops = (ir.orchestration?.loops || []).map((loop, index) => `<section class="project-panel ir-editor-row" data-ir-loop="${index}">
    <div class="panel-head"><h3>Loop ${index + 1}</h3><button class="icon-button" type="button" data-ir-remove-loop="${index}" aria-label="Remove Loop" title="Remove Loop"${disabled}>×</button></div>
    <div class="ir-form-grid">
      <label>Loop ID<input name="loop-${index}-id" value="${escText(loop.id || "")}" required${disabled}></label>
      <label>Boundary Agent<select name="loop-${index}-boundary" required${disabled}>${agentOptions(loop.boundaryAgentId)}</select></label>
      <label>Member Agent IDs<input name="loop-${index}-members" value="${escText((loop.members || []).join(", "))}" required${disabled}></label>
      <label>Max rounds<input type="number" min="1" name="loop-${index}-rounds" value="${Number(loop.maxRounds || 0)}" required${disabled}></label>
      <label>Max Agent activations<input type="number" min="1" name="loop-${index}-activations" value="${Number(loop.maxAgentActivations || 0)}" required${disabled}></label>
      <label>On exhausted<select name="loop-${index}-exhausted"${disabled}><option value="fail"${loop.onExhausted !== "finish" ? " selected" : ""}>fail</option><option value="finish"${loop.onExhausted === "finish" ? " selected" : ""}>finish</option></select></label>
      <label>Entry Handoff IDs<input name="loop-${index}-entry" value="${escText((loop.entryHandoffIds || []).join(", "))}" required${disabled}></label>
      <label>Continue Handoff IDs<input name="loop-${index}-continue" value="${escText((loop.continueHandoffIds || []).join(", "))}" required${disabled}></label>
      <label>Exit Handoff IDs<input name="loop-${index}-exit" value="${escText((loop.exitHandoffIds || []).join(", "))}" required${disabled}></label>
    </div></section>`).join("");
  const reviewLocations = agents.flatMap((agent) => Object.keys(agent.outputPorts || {}).map((outputPort) => ({
    value: JSON.stringify([agent.id, outputPort]), label: `${agent.id}.${outputPort}`
  })));
  const reviews = (ir.orchestration?.reviews || []).map((review, index) => {
    const selected = reviewLocations.find((location) => location.value === JSON.stringify([review.at?.agentId || "", review.at?.outputPort || ""]))?.value || "";
    return `<section class="project-panel ir-editor-row" data-ir-review="${index}">
    <div class="panel-head"><h3>Review ${index + 1}</h3><button class="icon-button" type="button" data-ir-remove-review="${index}" aria-label="Remove Review" title="Remove Review"${disabled}>×</button></div>
    <div class="ir-form-grid">
      <label>Review ID<input name="review-${index}-id" value="${escText(review.id || "")}" required${disabled}></label>
      <label>Position<select name="review-${index}-at" required${disabled}><option value="">Select Agent output</option>${reviewLocations.map((location) => `<option value="${escText(location.value)}"${location.value === selected ? " selected" : ""}>${escText(location.label)}</option>`).join("")}</select></label>
      <label>Timeout (ms)<input type="number" min="1" name="review-${index}-timeout" value="${Number(review.timeoutMs || 0)}" required${disabled}></label>
      <label>On timeout<input name="review-${index}-on-timeout" value="${escText(review.onTimeout || "fail")}" readonly${disabled}></label>
      <label class="full">Feedback schema JSON<textarea name="review-${index}-feedback-schema" rows="7" spellcheck="false" required${disabled}>${escText(JSON.stringify(review.feedbackSchema ?? {}, null, 2))}</textarea></label>
    </div></section>`;
  }).join("");
  return { joins, loops, reviews };
}

function renderTeamIrSchemaQuickEditor(schema, target, escText, editable) {
  const properties = schema?.type === "object" && schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? Object.entries(schema.properties).filter(([, value]) => value && typeof value === "object" && ["string", "number", "integer", "boolean"].includes(value.type))
    : [];
  if (!properties.length && schema?.type !== "object") return "";
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const rows = properties.map(([name, value], index) => `<div class="ir-schema-field" data-ir-schema-field data-ir-schema-original="${escText(name)}"><input data-ir-schema-name value="${escText(name)}" aria-label="Schema field ${index + 1} name"${editable ? "" : " disabled"}><select data-ir-schema-type aria-label="Schema field ${index + 1} type"${editable ? "" : " disabled"}>${["string", "number", "integer", "boolean"].map((type) => `<option value="${type}"${value.type === type ? " selected" : ""}>${type}</option>`).join("")}</select><label class="checkbox-label"><input type="checkbox" data-ir-schema-required${required.has(name) ? " checked" : ""}${editable ? "" : " disabled"}>Required</label><button type="button" class="icon-button" data-ir-schema-remove aria-label="Remove schema field" title="Remove schema field"${editable ? "" : " disabled"}>×</button></div>`).join("");
  return `<div class="ir-schema-quick" data-ir-schema-quick data-ir-schema-target="${escText(target)}" data-ir-schema-managed="${escText(JSON.stringify(properties.map(([name]) => name)))}"><div class="panel-head"><strong>Common fields</strong><span class="field-hint">Structured editor for simple fields; advanced constraints stay in JSON.</span></div><div data-ir-schema-fields>${rows}</div><button type="button" class="text-button" data-ir-schema-add${editable ? "" : " disabled"}>Add field</button></div>`;
}

function renderTeamIrArtifactQuickEditor(artifactSlots, target, direction, escText, editable) {
  const mediaKey = direction === "outputPorts" ? "mediaTypes" : "acceptedMediaTypes";
  const slots = artifactSlots && typeof artifactSlots === "object" && !Array.isArray(artifactSlots) ? artifactSlots : {};
  const rows = Object.entries(slots).map(([slotId, spec], index) => {
    const value = spec && typeof spec === "object" && !Array.isArray(spec) ? spec : {};
    const mediaTypes = Array.isArray(value[mediaKey]) ? value[mediaKey] : (Array.isArray(value.mediaTypes) ? value.mediaTypes : (Array.isArray(value.acceptedMediaTypes) ? value.acceptedMediaTypes : []));
    return `<div class="ir-artifact-field" data-ir-artifact-field data-ir-artifact-original="${escText(slotId)}"><input data-ir-artifact-name value="${escText(slotId)}" aria-label="Artifact slot ${index + 1} name"${editable ? "" : " disabled"}><input data-ir-artifact-media value="${escText(mediaTypes.join(", "))}" placeholder="text/plain, text/markdown" aria-label="Artifact slot ${index + 1} media types"${editable ? "" : " disabled"}><select data-ir-artifact-cardinality aria-label="Artifact slot ${index + 1} cardinality"${editable ? "" : " disabled"}><option value="single"${value.cardinality !== "many" ? " selected" : ""}>single</option><option value="many"${value.cardinality === "many" ? " selected" : ""}>many</option></select><label class="checkbox-label"><input type="checkbox" data-ir-artifact-required${value.required === true ? " checked" : ""}${editable ? "" : " disabled"}>Required</label><button type="button" class="icon-button" data-ir-artifact-remove aria-label="Remove Artifact slot" title="Remove Artifact slot"${editable ? "" : " disabled"}>x</button></div>`;
  }).join("");
  return `<div class="ir-artifact-quick" data-ir-artifact-quick data-ir-artifact-target="${escText(target)}" data-ir-artifact-media-key="${mediaKey}"><div class="panel-head"><strong>Common Artifact slots</strong><span class="field-hint">Edit slot name, accepted media types, cardinality and required status; advanced fields remain in JSON.</span></div><div data-ir-artifact-fields>${rows}</div><button type="button" class="text-button" data-ir-artifact-add${editable ? "" : " disabled"}>Add Artifact slot</button></div>`;
}

function renderTeamIrEditorRows(ir, escText, editable, authoringCatalog = null) {
  const packageRefs = [...new Set([
    ...(authoringCatalog?.packages || []).map((item) => String(item.ref || "").trim()),
    ...(ir.agents || []).map((agent) => String(agent.packageRef || "").trim())
  ].filter(Boolean))].sort();
  const bindingRefs = [...new Set([
    ...(authoringCatalog?.bindings || []).map((item) => String(item.ref || "").trim()),
    ...(ir.bindings || []).map((binding) => String(binding.id || "").trim()),
    ...(ir.agents || []).map((agent) => String(agent.bindingRef || "").trim())
  ].filter(Boolean))].sort();
  const catalogOptions = (values, selected, placeholder) => [
    `<option value=""${selected ? "" : " selected"}>${placeholder}</option>`,
    ...values.map((value) => `<option value="${escText(value)}"${value === selected ? " selected" : ""}>${escText(value)}</option>`)
  ].join("");
  const agents = (ir.agents || []).map((agent, index) => {
    const outputContractHint = state.locale === "en"
      ? "Each event schema defines its data payload. The Binding must return one JSON object: event, matching data, and artifactTexts (use an empty object when none are produced). The configured provider must support this output schema; results are validated again by Team IR. Markdown fences and surrounding text are rejected."
      : "每个事件 Schema 描述该事件的 data。Binding 必须返回单个 JSON 对象，包含 event、匹配的 data 和 artifactTexts（没有 Artifact 时传空对象）。所配置的 Provider 需支持该输出 Schema；Team IR 仍会再次校验。Markdown 围栏和前后说明会被拒绝。";
    const renderPorts = (direction, ports) => `<fieldset class="full ir-agent-ports" data-ir-agent-ports="${index}" data-ir-port-direction="${direction}"><legend>${direction === "inputPorts" ? "Input ports" : "Output events"}</legend>${direction === "outputPorts" ? `<p class="field-hint" data-ir-output-contract-hint>${esc(outputContractHint)}</p>` : ""}${Object.entries(ports || {}).map(([portId, port], portIndex) => { const schemaTarget = `agent-${index}-${direction}-${portIndex}-schema`; const artifactTarget = `agent-${index}-${direction}-${portIndex}-artifacts`; return `<section class="ir-port-contract" data-ir-port-row="${direction}" data-ir-port-index="${portIndex}"><div class="panel-head"><strong>${direction === "inputPorts" ? "Input" : "Output"} port ${portIndex + 1}</strong><button class="icon-button" type="button" data-ir-remove-port="${index}" data-ir-port-direction="${direction}" data-ir-port-index="${portIndex}" aria-label="Remove ${direction === "inputPorts" ? "input" : "output"} port" title="Remove port"${editable ? "" : " disabled"}>×</button></div><label>Port ID<input name="agent-${index}-${direction}-${portIndex}-id" value="${escText(portId)}" required${editable ? "" : " disabled"}></label><div class="ir-port-schema-editor"><label>Data schema JSON<textarea data-ir-schema-textarea name="${schemaTarget}" rows="7" spellcheck="false" required${editable ? "" : " disabled"}>${escText(JSON.stringify(port.dataSchema ?? {}, null, 2))}</textarea></label>${renderTeamIrSchemaQuickEditor(port.dataSchema, schemaTarget, escText, editable)}</div><div class="ir-port-artifact-editor"><label>Artifact slots JSON<textarea data-ir-artifact-textarea name="${artifactTarget}" rows="5" spellcheck="false" placeholder="{}"${editable ? "" : " disabled"}>${escText(port.artifactSlots ? JSON.stringify(port.artifactSlots, null, 2) : "")}</textarea></label>${renderTeamIrArtifactQuickEditor(port.artifactSlots, artifactTarget, direction, escText, editable)}</div></section>`; }).join("")}<button class="text-button" type="button" data-ir-add-port="${index}" data-ir-port-direction="${direction}"${editable ? "" : " disabled"}>Add ${direction === "inputPorts" ? "input port" : "output event"}</button></fieldset>`;
    return `<section class="project-panel ir-editor-row" data-ir-agent="${index}"><div class="panel-head"><h3>Agent ${index + 1}</h3><button class="icon-button" type="button" data-ir-remove-agent="${index}" aria-label="Remove Agent" title="Remove Agent"${editable ? "" : " disabled"}>×</button></div><div class="ir-form-grid"><label>Agent ID<input name="agent-${index}-id" value="${escText(agent.id)}" required${editable ? "" : " disabled"}></label><label>Package reference<select name="agent-${index}-package" required${editable ? "" : " disabled"}>${catalogOptions(packageRefs, agent.packageRef, "Select a verified role package")}</select>${agent.packageRef ? "" : '<small class="field-hint">Choose a catalog entry before saving this Agent.</small>'}</label><label>Binding reference<select name="agent-${index}-binding" required${editable ? "" : " disabled"}>${catalogOptions(bindingRefs, agent.bindingRef, "Select a configured Binding")}</select>${agent.bindingRef ? "" : '<small class="field-hint">Choose a catalog entry before saving this Agent.</small>'}</label>${renderPorts("inputPorts", agent.inputPorts)}${renderPorts("outputPorts", agent.outputPorts)}</div></section>`;
  }).join("");
  const agentOptions = (selected, allowRun = false) => `${allowRun ? `<option value=""${!selected ? " selected" : ""}>Run START</option>` : ""}${(ir.agents || []).map((agent) => `<option value="${escText(agent.id)}"${selected === agent.id ? " selected" : ""}>${escText(agent.id)}</option>`).join("")}${allowRun ? '<option value="@result"' + (selected === "@result" ? " selected" : "") + ">Run result</option>" : ""}`;
  const portOptions = (direction, selected, includeStart = false) => {
    const values = [...new Set((ir.agents || []).flatMap((agent) => Object.keys(agent[direction] || {})))].sort();
    return [
      ...(includeStart ? [`<option value="START"${selected === "START" ? " selected" : ""}>START (Run input)</option>`] : []),
      ...values.map((port) => `<option value="${escText(port)}"${selected === port ? " selected" : ""}>${escText(port)}</option>`)
    ].join("");
  };
  const handoffs = (ir.handoffs || []).map((edge, index) => {
    const fromAgent = edge.from?.kind === "agent" ? edge.from.agentId : "";
    const toAgent = edge.to?.kind === "result" ? "@result" : edge.to?.agentId || "";
    const mappingFields = teamIrHandoffMappingFields(ir, edge);
    const preservedMappings = {};
    const visualMappings = [];
    for (const [target, expr] of Object.entries(edge.map?.data || {})) {
      if (teamIrValueExprEditable(expr)) {
        visualMappings.push({ target, expression: expr });
      } else preservedMappings[target] = expr;
    }
    const mapping = visualMappings.map(({ target, expression }) => expression?.$ref ? `${target}=${expression.$ref}` : "").filter(Boolean).join(", ");
    const mappingRows = visualMappings.map((values, rowIndex) => renderTeamIrMappingRow(index, rowIndex, mappingFields, values, escText, editable)).join("");
    const conditionSummary = edge.when?.condition ? teamIrConditionSummary(edge.when.condition) : "Always selected";
    const conditionEditor = renderTeamIrConditionNode(edge.when?.condition, escText, editable, true);
    return `<section class="project-panel ir-editor-row" data-ir-handoff="${index}"><div class="panel-head"><h3>Handoff ${index + 1}</h3><button class="icon-button" type="button" data-ir-remove-handoff="${index}" aria-label="Remove Handoff" title="Remove Handoff"${editable ? "" : " disabled"}>×</button></div><div class="ir-form-grid"><label>Handoff ID<input name="handoff-${index}-id" value="${escText(edge.id)}" required${editable ? "" : " disabled"}></label><label>From Agent<select name="handoff-${index}-from-agent"${editable ? "" : " disabled"}>${agentOptions(fromAgent, true)}</select></label><label>From output event<select name="handoff-${index}-from-port"${editable ? "" : " disabled"}>${portOptions("outputPorts", edge.from?.outputPort || "START", true)}</select></label><label>To Agent / endpoint<select name="handoff-${index}-to-agent"${editable ? "" : " disabled"}>${agentOptions(toAgent, false)}<option value="@result"${toAgent === "@result" ? " selected" : ""}>Run result</option></select></label><label>To input port<select name="handoff-${index}-to-port"${editable ? "" : " disabled"}>${portOptions("inputPorts", edge.to?.inputPort || "default")}</select></label><div class="ir-map-editor full"><span class="ir-map-editor-title">Field mappings</span><input type="hidden" name="handoff-${index}-mapping" value="${escText(mapping)}"><input type="hidden" data-ir-map-preserved value="${escText(JSON.stringify(preservedMappings))}"><div data-ir-map-rows="${index}">${mappingRows}</div><div class="ir-map-editor-actions">${editable ? `<button class="secondary-button" type="button" data-ir-map-add="${index}"${mappingFields.targetFields.length && mappingFields.sourceFields.length ? "" : " disabled"}>Add field mapping</button><button class="text-button" type="button" data-ir-map-suggest="${index}">Suggest same-name fields</button>` : ""}</div><span class="field-hint">Map a target field from a declared Run input or Agent output. Run task stays immutable.</span><div class="ir-map-suggestions" data-ir-map-suggestions="${index}" aria-live="polite"></div></div><div class="ir-condition-editor full" data-ir-condition-editor="${index}">${conditionEditor}<p class="field-hint" data-ir-condition-summary="${index}">${escText(conditionSummary)}</p><p class="field-hint">Structured conditions support up to 8 nested levels and 16 items per group. Other expressions remain available in Advanced JSON.</p></div><label>Priority<input type="number" min="0" name="handoff-${index}-priority" value="${Number(edge.when?.priority ?? 0)}"${editable ? "" : " disabled"}></label></div></section>`;
  }).join("");
  return { agents, handoffs };
}

function renderTeamIrStructureGraph(ir, escText, editable) {
  const disabled = editable ? "" : " disabled";
  const layoutKey = `ogs-team-ir-layout:${ir.team?.id || "team"}`;
  let savedLayout = {};
  try { savedLayout = JSON.parse(localStorage.getItem(layoutKey) || "{}"); } catch { savedLayout = {}; }
  const nodesData = [
    { key: "run", label: "Run", kind: "run", ports: [] },
    ...(ir.agents || []).map((agent) => ({ key: `agent:${agent.id}`, label: agent.id, kind: "agent", agent, ports: [] })),
    { key: "result", label: "Run Result", kind: "result", ports: [] }
  ];
  const layout = (key, index) => savedLayout[key] || { x: 24 + (index % 3) * 290, y: 24 + Math.floor(index / 3) * 205 };
  const portPicker = (ports, kind, index, agentId) => {
    const entries = Object.keys(ports || {});
    if (entries.length < 2) return "";
    const label = kind === "source" ? "来源输出端口" : "目标输入端口";
    const attribute = kind === "source" ? "data-ir-link-source-port" : "data-ir-link-target-port";
    return `<label class="ir-graph-port-picker"><span>${label}</span><select ${attribute}="${index}" aria-label="${label} ${escText(agentId)}"${disabled}>${entries.map((port) => `<option value="${escText(port)}">${escText(port)}</option>`).join("")}</select></label>`;
  };
  const nodes = nodesData.map((node, index) => {
    const point = layout(node.key, index);
    const agentIndex = node.agent ? ir.agents.indexOf(node.agent) : -1;
    const ports = node.kind === "run"
      ? `<button class="ir-graph-port run-port" type="button" data-ir-connect-source="run"${editable ? ' draggable="true"' : ""}${disabled}>START</button>`
      : node.kind === "result"
        ? `<button class="ir-graph-port result-port" type="button" data-ir-connect-target="result"${editable ? ' data-ir-connect-drop-target="true"' : ""}${disabled}>Result</button>`
        : `<div class="ir-graph-port-list"><div>${Object.keys(node.agent.outputPorts || {}).map((port) => `<button class="ir-graph-port output-port" type="button" data-ir-port-source-agent-index="${agentIndex}" data-ir-port="${escText(port)}"${editable ? ' draggable="true"' : ""}${disabled}>${escText(port)}</button>`).join("")}</div><div>${Object.keys(node.agent.inputPorts || {}).map((port) => `<button class="ir-graph-port input-port" type="button" data-ir-port-target-agent-index="${agentIndex}" data-ir-port="${escText(port)}"${editable ? ' data-ir-connect-drop-target="true"' : ""}${disabled}>${escText(port)}</button>`).join("")}</div></div>`;
    return `<div class="ir-graph-node-wrap" data-ir-layout-node="${escText(node.key)}" style="left:${point.x}px;top:${point.y}px"><button class="ir-graph-node ${node.kind}" type="button" data-ir-graph-node="${node.kind}"${node.agent ? ` data-agent-id="${escText(node.agent.id)}"` : ""}><span>${escText(node.label)}</span><small>${escText(node.kind === "run" ? `输入 · ${ir.team?.id || "Team"}` : node.kind === "result" ? "最终输出" : node.agent.packageRef || "Agent")}</small></button>${ports}<div class="ir-graph-node-actions">${node.kind === "run" ? "" : node.kind === "agent" ? `<button class="text-button" type="button" data-ir-connect-source-agent-index="${agentIndex}"${editable ? ' draggable="true"' : ""}${disabled}>选择 ${escText(node.label)} 来源</button><button class="text-button" type="button" data-ir-connect-target-agent-index="${agentIndex}"${editable ? ' data-ir-connect-drop-target="true"' : ""}${disabled}>选择 ${escText(node.label)} 目标</button>${portPicker(node.agent.outputPorts, "source", agentIndex, node.agent.id)}${portPicker(node.agent.inputPorts, "target", agentIndex, node.agent.id)}</div>` : ""}</div>`;
  }).join("");
  const edgeRows = (ir.handoffs || []).map((handoff, index) => `<button class="ir-graph-edge" type="button" data-ir-graph-handoff="${index}"><code>${escText(handoff.id)}</code><span>${escText(handoff.from?.agentId || "Run")}.${escText(handoff.from?.outputPort || "START")} <b aria-hidden="true">→</b> ${escText(handoff.to?.agentId || "Run Result")}.${escText(handoff.to?.inputPort || "Result")}</span></button>`).join("");
  return `<section class="ir-structure-graph" aria-labelledby="ir-structure-graph-title"><div class="panel-head"><div><span class="section-kicker">Team IR v2</span><h2 id="ir-structure-graph-title">结构图</h2></div><span class="form-hint">节点位置仅保存在本机</span></div><p class="form-status" data-ir-connect-status role="status" aria-live="polite">拖动端口锚点创建 Handoff；也可选择来源和目标。</p><button class="text-button" type="button" data-ir-connect-cancel${disabled}>取消连接</button><div class="ir-graph-canvas" data-ir-graph-canvas data-layout-key="${escText(layoutKey)}"><svg class="ir-graph-wires" aria-hidden="true" data-ir-graph-wires></svg><div class="ir-graph-nodes" aria-label="Run and Agent nodes">${nodes}</div></div><div class="ir-graph-edges" aria-label="Handoff edges">${edgeRows || '<p class="empty-note">尚未定义 Handoff。</p>'}</div></section>`;
}

function renderTeamIrDerivedViews(ir, escText) {
  const handoffSummary = (ir.handoffs || []).map((handoff) => {
    const from = handoff.from?.kind === "run" ? "Run" : `${handoff.from?.agentId || "?"}.${handoff.from?.outputPort || "?"}`;
    const to = handoff.to?.kind === "result" ? "Run result" : `${handoff.to?.agentId || "?"}.${handoff.to?.inputPort || "?"}`;
    const fields = Object.keys(handoff.map?.data || {});
    const condition = handoff.when?.condition ? teamIrConditionSummary(handoff.when.condition) : "Always selected";
    return `<li><strong>${escText(handoff.id)}</strong><span>${escText(from)} → ${escText(to)} · ${escText(condition)} · fields: ${escText(fields.join(", ") || "none")}</span></li>`;
  }).join("");
  const visibility = (ir.agents || []).map((agent) => {
    const incoming = (ir.handoffs || []).filter((handoff) => handoff.to?.kind === "agent" && handoff.to.agentId === agent.id);
    const fields = [...new Set(incoming.flatMap((handoff) => Object.keys(handoff.map?.data || {})))];
    return `<li><strong>${escText(agent.id)}</strong><span>${escText(fields.join(", ") || "no mapped fields yet")}</span></li>`;
  }).join("");
  const resultRequired = Array.isArray(ir.runResult?.dataSchema?.required) ? ir.runResult.dataSchema.required : [];
  const requiredSlots = Object.entries(ir.runResult?.artifactSlots || {})
    .filter(([, slot]) => slot?.required === true)
    .map(([slot]) => slot);
  const resultChecks = (ir.handoffs || []).filter((handoff) => handoff.to?.kind === "result").map((handoff) => {
    const missing = [
      ...resultRequired.filter((field) => !Object.hasOwn(handoff.map?.data || {}, field)).map((field) => `field ${field}`),
      ...requiredSlots.filter((slot) => !Object.hasOwn(handoff.map?.artifacts || {}, slot)).map((slot) => `Artifact ${slot}`)
    ];
    return `<li class="${missing.length ? "is-warning" : "is-ready"}"><strong>${escText(handoff.id)}</strong><span>${escText(missing.length ? `Missing: ${missing.join(", ")}` : "Complete result contract")}</span></li>`;
  }).join("");
  return `<section class="ir-derived-views"><div class="ir-derived-view"><div class="panel-head"><strong>Collaboration summary</strong><span class="field-hint">Derived from the saved IR; it does not change execution.</span></div><ul class="ir-derived-list">${handoffSummary || "<li>No Handoffs defined.</li>"}</ul></div><div class="ir-derived-view"><div class="panel-head"><strong>Agent input visibility</strong><span class="field-hint"><code>$.run.task</code> is visible to every Agent; mapped fields below are explicit.</span></div><ul class="ir-derived-list">${visibility || "<li>No Agents defined.</li>"}</ul></div><div class="ir-derived-view"><div class="panel-head"><strong>Result completeness</strong><span class="field-hint">Preview only; Compiler diagnostics decide whether a Result Handoff is valid.</span></div><ul class="ir-derived-list">${resultChecks || "<li>No Result Handoff defined.</li>"}</ul></div></section>`;
}

function renderTeamIrCollaborationSummary(ir, escText) {
  const handoffRows = (ir.handoffs || []).map((handoff) => {
    const from = handoff.from?.kind === "run" ? "Run input" : `${handoff.from?.agentId || "?"}.${handoff.from?.outputPort || "?"}`;
    const to = handoff.to?.kind === "result" ? "Run result" : `${handoff.to?.agentId || "?"}.${handoff.to?.inputPort || "?"}`;
    const fields = Object.keys(handoff.map?.data || {});
    const condition = handoff.when?.condition ? teamIrConditionSummary(handoff.when.condition) : "Always selected";
    return `<li><strong>${escText(from)} → ${escText(to)}</strong><span>${escText(fields.length ? `Fields: ${fields.join(", ")}` : "No data fields mapped")} · ${escText(condition)}</span></li>`;
  }).join("");
  const visibilityRows = (ir.agents || []).map((agent) => {
    const inputs = Object.entries(agent.inputPorts || {}).map(([port, contract]) => `${port}: ${Object.keys(contract.dataSchema?.properties || {}).join(", ") || "no declared fields"}`).join("; ");
    return `<li><strong>${escText(agent.id)}</strong><span>${escText(inputs || "No input ports declared")}</span></li>`;
  }).join("");
  return `<section class="ir-editor-section ir-collaboration-summary"><div class="panel-head"><div><span class="section-kicker">Collaboration view</span><h2>Inputs, handoffs and visibility</h2></div></div><div class="ir-summary-grid"><div><h3>Handoffs</h3><ul class="ir-summary-list">${handoffRows || "<li>No Handoffs defined.</li>"}</ul></div><div><h3>Agent inputs</h3><p class="field-hint"><code>$.run.task</code> is visible to every Agent by contract; this view does not provide isolation or secrecy.</p><ul class="ir-summary-list">${visibilityRows || "<li>No Agents defined.</li>"}</ul></div></div></section>`;
}

function focusTeamIrGraphSelection(form, draft, selection) {
  let target;
  if (selection.kind === "run") target = form.querySelector('[name="team-id"]');
  if (selection.kind === "agent") {
    const index = draft.agents.findIndex((agent) => agent.id === selection.agentId);
    target = index >= 0 ? form.querySelector(`[data-ir-agent="${index}"] input[name$="-id"]`) : null;
  }
  if (selection.kind === "handoff") target = form.querySelector(`[data-ir-handoff="${selection.index}"] [data-ir-map-target]`) || form.querySelector(`[data-ir-handoff="${selection.index}"] [data-ir-map-add]`);
  if (selection.kind === "result") {
    const advanced = form.querySelector("[data-ir-advanced-json]");
    if (advanced?.closest("details")) advanced.closest("details").open = true;
    focusTeamIrDiagnostic(form, draft, "/runResult");
    return;
  }
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  target?.focus({ preventScroll: true });
}

function addStudioWorkspaceNav(root, teamVersionId, active) {
  if (!root || root.querySelector(".studio-workspace-nav")) return;
  root.querySelector(".page-heading")?.insertAdjacentHTML("afterend", studioWorkspaceNav(teamVersionId, active));
}

async function renderStudioTeamInfo(teamVersionId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  root.innerHTML = '<div class="project-loading">正在读取团队信息...</div>';
  try {
    const [response, irResponse] = await Promise.all([
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir`)
    ]);
    const [team, stored] = await Promise.all([response.json(), irResponse.json()]);
    if (!response.ok) throw new Error(team.error || "无法读取团队版本");
    if (!irResponse.ok || stored.teamIR?.schemaVersion !== 2) throw new Error("TEAM_IR_V2_REQUIRED");
    if (pageRequest && !isCurrentRequest(pageRequest)) return;
    const meta = teamVersionMeta(team);
    const editable = meta.status !== "archived";
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← 团队仓库</a><div class="eyebrow">OGS Studio · ${esc(team.teamId || team.teamRootId || team.projectId)}</div><h1>${esc(team.name || team.teamName)} <span class="version-badge">${esc(meta.version)}</span></h1><p>${state.locale === "en" ? "Team identity and release state. Project materials and tasks are managed separately in OGS Projects." : "管理团队身份与版本状态。项目资料和业务任务由 OGS Projects 独立管理。"}</p></div><span class="status-chip ${esc(meta.status)}">${esc(meta.label)}</span></section>${studioWorkspaceNav(teamVersionId, "info")}<section class="studio-info-layout"><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Team identity" : "团队身份"}</span><h2>${state.locale === "en" ? "Team information" : "团队基本信息"}</h2></div></div><form id="studio-team-info-form" class="compact-form"><label>${state.locale === "en" ? "Team name" : "团队名称"}<input name="name" value="${esc(team.name || team.teamName || "")}" maxlength="120" required${editable ? "" : " disabled"}></label><label>${state.locale === "en" ? "Team goal" : "团队目标"}<textarea name="overview" rows="6" maxlength="4000" required${editable ? "" : " disabled"}>${esc(team.overview || "")}</textarea></label><p class="form-status" id="studio-team-info-status" role="status" aria-live="polite"></p><div class="form-actions">${editable ? `<button class="primary-button" type="submit">${state.locale === "en" ? "Save team info" : "保存团队信息"}</button>` : `<span class="form-hint">${state.locale === "en" ? "Inactive teams are read-only." : "已停用团队为只读。"}</span>`}</div></form></article><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Version" : "版本信息"}</span><h2>${state.locale === "en" ? "TeamVersion" : "团队版本"}</h2></div></div><dl class="studio-version-facts"><div><dt>${state.locale === "en" ? "Status" : "状态"}</dt><dd>${esc(meta.label)}</dd></div><div><dt>${state.locale === "en" ? "Version" : "版本"}</dt><dd>${esc(meta.version)}</dd></div><div><dt>${state.locale === "en" ? "Team ID" : "团队 ID"}</dt><dd><code>${esc(team.teamId || team.teamRootId || team.projectId)}</code></dd></div><div><dt>${state.locale === "en" ? "Updated" : "更新时间"}</dt><dd>${esc(team.updatedAt ? new Date(team.updatedAt).toLocaleString(state.locale) : "—")}</dd></div></dl><p class="panel-intro">${state.locale === "en" ? "Saving a change to a released version creates a draft; the released version remains unchanged." : "保存已发布版本的修改时才创建草案，原已发布版本保持不变。"}</p></article></section>`;
    const infoVersionHint = root.querySelector(".studio-info-layout .project-panel:nth-child(2) .panel-intro");
    if (infoVersionHint) infoVersionHint.textContent = state.locale === "en"
      ? "The first changed save creates an in-design version; the released version remains unchanged."
      : "首次保存实际修改时会创建设计中版本，原已发布版本保持不变。";
    const form = $("#studio-team-info-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const status = $("#studio-team-info-status");
      submit.disabled = true;
      try {
        const values = new FormData(form);
        const save = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/save`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: values.get("name"), overview: values.get("overview"), expectedMetadataDigest: team.expectedMetadataDigest }) });
        const result = await save.json();
        if (!save.ok) throw new Error(result.error || "保存团队信息失败");
        if (pageRequest && !isCurrentRequest(pageRequest)) return;
        if (result.createdDraft) {
          navigate(withCurrentSearch(`/studio/teams/${encodeURIComponent(result.teamVersionId)}/info`));
          return;
        }
        team.expectedMetadataDigest = result.expectedMetadataDigest;
        status.textContent = result.unchanged ? (state.locale === "en" ? "No changes to save." : "内容未变化，无需创建新版本。") : (state.locale === "en" ? "Team information saved." : "团队信息已保存。");
        const heading = root.querySelector(".page-heading h1");
        if (heading) heading.firstChild.textContent = `${result.name || result.teamName} `;
      } catch (error) {
        if (isAbort(error)) return;
        status.textContent = error.message || "保存团队信息失败";
      } finally { if (submit?.isConnected) submit.disabled = false; }
    });
  } catch (error) {
    if (isAbort(error)) return;
    root.innerHTML = `<div class="run-error">${esc(error.message || "无法读取团队信息")}</div>`;
  }
}

async function renderStudioTeamIrWorkbench(teamVersionId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  const english = state.locale === "en";
  const t = (en, zh) => english ? en : zh;
  root.innerHTML = '<div class="project-loading">' + t("Loading Team IR v2 graph…", "正在读取 Team IR v2 图谱…") + '</div>';
    const [teamResponse, irResponse, catalogResponse] = await Promise.all([
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir/catalog`)
    ]);
    const [team, stored, catalog] = await Promise.all([teamResponse.json(), irResponse.json(), catalogResponse.json()]);
    if (!teamResponse.ok) throw new Error(team.error || t("Unable to load TeamVersion.", "无法读取团队版本。"));
    if (!irResponse.ok || stored.teamIR?.schemaVersion !== 2) throw new Error(stored.error || "TEAM_IR_V2_REQUIRED");
    if (pageRequest && !isCurrentRequest(pageRequest)) return;
    const editable = team.teamVersionStatus === "draft";
    let draft = structuredClone(stored.teamIR);
    let expectedSemanticDigest = stored.semanticDigest || null;
    let selectedRoleId = "";
    let selectedFlowId = "";
    let graph;
    let dirty = false;
    const layout = readGraphLayout(team.teamId || draft.team?.id || teamVersionId, teamVersionId);
    const knownPackages = new Map((catalog?.packages || []).map((item) => [item.ref, item]));
    const knownBindings = new Map((catalog?.bindings || []).map((item) => [item.ref, item]));
    for (const agent of draft.agents || []) {
      if (agent.packageRef && !knownPackages.has(agent.packageRef)) knownPackages.set(agent.packageRef, { ref: agent.packageRef, label: agent.packageRef, version: "saved" });
      if (agent.bindingRef && !knownBindings.has(agent.bindingRef)) knownBindings.set(agent.bindingRef, { ref: agent.bindingRef, label: agent.bindingRef, modelRef: "saved" });
    }
    const packageOptions = [...knownPackages.values()].map((item) => `<option value="${esc(item.ref)}">${esc(item.label || item.ref)} · ${esc(item.version || "")}</option>`).join("");
    const bindingOptions = [...knownBindings.values()].map((item) => `<option value="${esc(item.ref)}">${esc(item.label || item.ref)} · ${esc(item.modelRef || "")}</option>`).join("");
    const renderInspector = () => {
      const inspector = root.querySelector("#studio-property-inspector");
      if (!inspector) return;
      const role = draft.agents?.find((item) => item.id === selectedRoleId);
      const flow = draft.handoffs?.find((item) => item.id === selectedFlowId);
      if (!role && !flow) {
        inspector.innerHTML = `<div class="studio-inspector-empty"><strong>${t("Select an Agent or Handoff", "选择 Agent 或 Handoff")}</strong><p>${t("The graph keeps the original layout. v2 semantics are edited here.", "图谱保留原版布局，v2 语义在此处编辑。")}</p></div>`;
        return;
      }
      if (role) {
        const inputPorts = Object.keys(role.inputPorts || {}).map((id) => `<li><code>${esc(id)}</code></li>`).join("") || `<li>${t("None", "暂无")}</li>`;
        const outputPorts = Object.keys(role.outputPorts || {}).map((id) => `<li><code>${esc(id)}</code></li>`).join("") || `<li>${t("None", "暂无")}</li>`;
        inspector.innerHTML = `<section class="studio-inspector-section"><div class="panel-head"><div><span class="section-kicker">Agent</span><h2>${esc(role.id)}</h2></div><span class="status-chip">v2</span></div><label class="field"><span>${t("Package", "角色包")}</span><select data-v2-role-package ${editable ? "" : "disabled"}><option value="">${t("Select a trusted package", "选择可信角色包")}</option>${packageOptions}</select></label><label class="field"><span>${t("Binding", "Binding")}</span><select data-v2-role-binding ${editable ? "" : "disabled"}><option value="">${t("Select a trusted binding", "选择可信 Binding")}</option>${bindingOptions}</select></label><div class="studio-port-summary"><div><strong>${t("Input Ports", "输入 Port")}</strong><ul>${inputPorts}</ul></div><div><strong>${t("Output Ports", "输出 Port")}</strong><ul>${outputPorts}</ul></div></div><p class="field-hint">${t("Port schemas and advanced contracts remain in Advanced JSON.", "Port Schema 与高级合同保留在高级 JSON 中。")}</p></section>`;
        const packageSelect = inspector.querySelector("[data-v2-role-package]");
        const bindingSelect = inspector.querySelector("[data-v2-role-binding]");
        if (packageSelect) { packageSelect.value = role.packageRef || ""; packageSelect.addEventListener("change", () => applyRoleField("packageRef", packageSelect.value)); }
        if (bindingSelect) { bindingSelect.value = role.bindingRef || ""; bindingSelect.addEventListener("change", () => applyRoleField("bindingRef", bindingSelect.value)); }
        return;
      }
      const fromLabel = flow.from?.kind === "run" ? "Run" : `${flow.from?.agentId || "?"}.${flow.from?.outputPort || "?"}`;
      const toLabel = flow.to?.kind === "result" ? "Result" : `${flow.to?.agentId || "?"}.${flow.to?.inputPort || "?"}`;
      inspector.innerHTML = `<section class="studio-inspector-section"><div class="panel-head"><div><span class="section-kicker">Handoff</span><h2>${esc(flow.id)}</h2></div><span class="status-chip">v2</span></div><dl class="studio-version-facts"><div><dt>${t("From", "来源")}</dt><dd><code>${esc(fromLabel)}</code></dd></div><div><dt>${t("To", "目标")}</dt><dd><code>${esc(toLabel)}</code></dd></div></dl><label class="field"><span>${t("Condition JSON", "条件 JSON")}</span><textarea data-v2-flow-condition rows="8" spellcheck="false" ${editable ? "" : "disabled"}>${esc(JSON.stringify(flow.when?.condition || null, null, 2))}</textarea></label><label class="field"><span>${t("Mapping JSON", "映射 JSON")}</span><textarea data-v2-flow-map rows="8" spellcheck="false" ${editable ? "" : "disabled"}>${esc(JSON.stringify(flow.map || { data: {} }, null, 2))}</textarea></label><button class="secondary-button" type="button" data-v2-apply-flow ${editable ? "" : "disabled"}>${t("Apply Handoff", "应用 Handoff")}</button><p class="form-status" data-v2-inspector-status role="status"></p></section>`;
        inspector.querySelector("[data-v2-apply-flow]")?.addEventListener("click", () => {
          const conditionField = inspector.querySelector("[data-v2-flow-condition]");
          const mapField = inspector.querySelector("[data-v2-flow-map]");
          const statusField = inspector.querySelector("[data-v2-inspector-status]");
          let condition;
          let map;
          try { condition = JSON.parse(conditionField.value); map = JSON.parse(mapField.value); } catch (error) { statusField.textContent = error.message || t("Invalid JSON.", "JSON 无效。"); return; }
          const result = applyTeamIrPatch(draft, { op: "update", collection: "handoffs", id: flow.id, fields: { when: condition ? { ...(flow.when || {}), condition } : undefined, map } });
          if (!result.ok) { statusField.textContent = result.error; return; }
          draft = result.teamIR; dirty = true; redraw();
          statusField.textContent = t("Handoff updated.", "Handoff 已更新。");
        });
    };
    const applyRoleField = (field, value) => {
      const result = applyTeamIrPatch(draft, { op: "update", collection: "agents", id: selectedRoleId, fields: { [field]: value || undefined } });
      if (!result.ok) { showToast(result.error); return; }
      draft = result.teamIR; dirty = true; redraw();
    };
    const graphMarkup = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← ${t("Team repository", "团队仓库")}</a><div class="eyebrow">OGS Studio · ${esc(team.name || team.teamName || teamVersionId)}</div><h1>${t("Team graph", "团队图谱")}</h1><p>${t("Original graph workspace with Team IR v2 semantics.", "沿用原版图谱工作台，语义由 Team IR v2 提供。")}</p></div><span class="status-chip ${editable ? "draft" : "released"}">${editable ? t("Design", "设计中") : t("Released", "已发布")}</span></section>${studioWorkspaceNav(teamVersionId, "ir")}<div class="studio-design-workbench-host"><div class="studio-design-workbench"><section class="project-panel project-graph-preview"><div class="panel-head"><div><span class="section-kicker">Team IR v2</span><h2>${t("Collaboration graph", "团队协作图谱")}</h2><p id="project-design-status" class="form-status" role="status">${t("Loading graph…", "正在加载图谱…")}</p></div><div class="form-actions"><button type="button" class="secondary-button" data-v2-open-inspector>${t("Inspector", "属性")}</button><button type="button" class="primary-button" data-v2-save ${editable ? "" : "disabled"}>${t("Save", "保存")}</button></div></div><div id="project-graph-stage" class="graph-stage studio-graph-island" role="application" aria-label="${t("Team IR v2 graph", "Team IR v2 团队图谱")}"></div><p class="preview-note">${t("Drag nodes to change layout only. Select an Agent or Handoff to edit v2 semantics.", "拖动节点只改变布局；选择 Agent 或 Handoff 编辑 v2 语义。")}</p></section><aside id="studio-asset-drawer" class="studio-asset-drawer" aria-label="${t("Team configuration", "团队配置")}" aria-hidden="true"><div class="studio-asset-drawer-head"><strong>${t("Team configuration", "团队配置")}</strong><button type="button" class="close-button" data-v2-close-inspector aria-label="${t("Close", "关闭")}">×</button></div><div id="studio-assets-property-view"><section class="studio-property-inspector" id="studio-property-inspector"></section><div class="studio-asset-editor-actions"><span class="form-hint">${t("Layout is local and excluded from semantic digest.", "布局只保存在本机，不进入语义 digest。")}</span><button type="button" class="primary-button" data-v2-save-inspector ${editable ? "" : "disabled"}>${t("Save", "保存")}</button></div></div></aside></div></div><section class="project-panel" data-v2-diagnostics><div class="panel-head"><div><span class="section-kicker">${t("Validation", "校验")}</span><h2>${t("Team IR diagnostics", "Team IR 诊断")}</h2></div></div><ul class="studio-event-list ir-diagnostics" data-v2-diagnostics-list></ul><p class="form-status" data-v2-status role="status" aria-live="polite"></p></section>`;
    root.innerHTML = graphMarkup;
    const stage = root.querySelector("#project-graph-stage");
    const status = root.querySelector("#project-design-status");
    await ensureStudioGraphBundle();
    const redraw = () => {
      const authoring = teamIrToGraphAuthoring(draft, layout);
      graph?.update({ authoring, labels: graphLabels[state.locale], selectedRoleId, selectedFlowKey: selectedFlowId });
      renderInspector();
    };
    const save = async () => {
      const buttons = [...root.querySelectorAll("[data-v2-save], [data-v2-save-inspector]")];
      if (!editable || !dirty) return;
      buttons.forEach((button) => { button.disabled = true; });
      try {
        const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamIR: draft, expectedSemanticDigest }) });
        const payload = await response.json();
        if (!response.ok || !payload.saved) throw new Error(payload.error || t("Team IR draft was not saved.", "Team IR 草稿未保存。"));
        expectedSemanticDigest = payload.semanticDigest || expectedSemanticDigest; dirty = false;
        root.querySelector("[data-v2-status]").textContent = payload.releaseReady === false ? t("Draft saved; release diagnostics remain.", "草稿已保存；仍有发布诊断。") : t("Saved and release-ready.", "已保存，可发布。");
        renderDiagnostics(payload.diagnostics || []);
      } catch (error) { root.querySelector("[data-v2-status]").textContent = error.message || t("Unable to save.", "保存失败。"); }
      finally { buttons.filter((button) => button.isConnected).forEach((button) => { button.disabled = false; }); }
    };
    const renderDiagnostics = (diagnostics) => {
      const list = root.querySelector("[data-v2-diagnostics-list]");
      list.innerHTML = (diagnostics || []).map((item) => `<li><strong>${esc(item.severity || "error")} ${esc(item.code || "IR_DIAGNOSTIC")}</strong> <code>${esc(item.pointer || "/")}</code> ${esc(item.message || "")}</li>`).join("") || `<li>${t("No diagnostics.", "暂无诊断。")}</li>`;
    };
    const selectFlow = (flowKey) => {
      const flow = (draft.handoffs || []).find((handoff) => {
        const source = handoff.from?.kind === "run" ? START_ID : handoff.from?.agentId;
        const target = handoff.to?.kind === "result" ? END_ID : handoff.to?.agentId;
        const eventType = handoff.from?.kind === "agent" ? handoff.from.outputPort : "START";
        return flowKey === handoff.id || flowKey === `${source}:${eventType}:${target}`;
      });
      if (!flow) return;
      selectedFlowId = flow.id; selectedRoleId = "";
      root.querySelector("#studio-asset-drawer")?.classList.add("is-open");
      root.querySelector("#studio-asset-drawer")?.setAttribute("aria-hidden", "false");
      renderInspector();
    };
    stage.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-cell-id]") : null;
      const flowId = target?.getAttribute("data-cell-id") || "";
      if (flowId && (draft.handoffs || []).some((handoff) => handoff.id === flowId)) selectFlow(flowId);
    });
    graph = mountStudioGraph(stage, {
      mode: "product-edit", authoring: teamIrToGraphAuthoring(draft, layout), readOnly: !editable,
      initialLayoutMode: "flow", defaultAutoLayout: true, defaultAutoLayoutRequestId: 1,
      labels: graphLabels[state.locale], onSelectRole: (id) => { selectedRoleId = id; selectedFlowId = ""; root.querySelector("#studio-asset-drawer")?.classList.add("is-open"); root.querySelector("#studio-asset-drawer")?.setAttribute("aria-hidden", "false"); renderInspector(); },
      onSelectFlow: selectFlow,
      onApplyCanvas: async (canvas) => { for (const node of (canvas?.nodes || [])) if (node?.id) { writeGraphLayout(team.teamId || draft.team?.id || teamVersionId, teamVersionId, node.id, { x: node.x, y: node.y, width: node.width, height: node.height }); } },
      onApplyCommand: async (result) => { const next = graphAuthoringToTeamIr(draft, result.authoring); draft = next; dirty = true; redraw(); },
      onSaveWorkbench: save, canSaveWorkbench: editable, onToggleFullscreen: async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); },
      onStatusChange: (message) => { if (status) status.textContent = message; }, onToast: (tone, message) => showToast(message)
    });
    root.querySelector("[data-v2-save]")?.addEventListener("click", save);
    root.querySelector("[data-v2-save-inspector]")?.addEventListener("click", save);
    root.querySelector("[data-v2-open-inspector]")?.addEventListener("click", () => { const drawer = root.querySelector("#studio-asset-drawer"); drawer?.classList.add("is-open"); drawer?.setAttribute("aria-hidden", "false"); });
    root.querySelector("[data-v2-close-inspector]")?.addEventListener("click", () => { const drawer = root.querySelector("#studio-asset-drawer"); drawer?.classList.remove("is-open"); drawer?.setAttribute("aria-hidden", "true"); });
    renderDiagnostics([]); renderInspector();
    return;
}

async function renderStudioTeamIr(teamVersionId, pageRequest = state.activeRequest) {
  return renderStudioTeamIrWorkbench(teamVersionId, pageRequest);
}

async function renderStudioTeamIrLongForm(teamVersionId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  root.innerHTML = '<div class="project-loading">Loading Team IR v2…</div>';
  try {
    const [teamResponse, irResponse] = await Promise.all([
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir`)
    ]);
    const [team, stored] = await Promise.all([teamResponse.json(), irResponse.json()]);
    if (!teamResponse.ok) throw new Error(team.error || "Unable to load TeamVersion.");
    if (!irResponse.ok) throw new Error(stored.error || "Unable to load Team IR v2.");
    if (pageRequest && !isCurrentRequest(pageRequest)) return;
    if (stored.teamIR?.schemaVersion !== 2) throw new Error("TEAM_IR_V2_REQUIRED: TeamVersion must contain a native Team IR v2 document.");
    let authoringCatalog = null;
    try {
      const catalogResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir/catalog`);
      const catalog = await catalogResponse.json();
      if (catalogResponse.ok && Array.isArray(catalog.packages) && Array.isArray(catalog.bindings)) authoringCatalog = catalog;
    } catch (error) {
      if (isAbort(error)) throw error;
    }
    let draft = stored.teamIR;
    let expectedSemanticDigest = stored.semanticDigest ?? null;
    const editable = team.teamVersionStatus === "draft";
    let simulationInputValue = {};
    let pendingConnectionSource;
    let undoDraft;
    const undoStack = [];
    const redraw = () => {
      const t = (en, zh) => state.locale === "en" ? en : zh;
      const rows = renderTeamIrEditorRows(draft, esc, editable, authoringCatalog);
      Object.assign(rows, renderTeamIrOrchestrationRows(draft, esc, editable));
      const advancedContracts = esc(JSON.stringify(teamIrAdvancedContracts(draft), null, 2));
      const versionActions = editable
        ? `<button class="secondary-button" type="button" data-ir-reference-classic>${state.locale === "en" ? "Reference a classic team" : "参考经典团队"}</button>`
        : `<button class="primary-button" type="button" data-ir-create-version>${state.locale === "en" ? "Create a new version" : "创建新版本"}</button><button class="secondary-button" type="button" data-ir-reference-classic>${state.locale === "en" ? "Reference a classic team" : "参考经典团队"}</button>`;
      root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← ${t("OGS Studio", "OGS Studio")}</a><div class="eyebrow">${esc(team.name || team.teamName)} · v${team.teamVersionNumber || 1}</div><h1>Team IR v2</h1><p>${t("Versioned, typed handoffs and execution policy for this TeamVersion.", "版本化的类型交接与执行策略，用于此 TeamVersion。")}</p><div class="form-actions ir-version-actions">${versionActions}</div></div><span class="status-chip ${editable ? "draft" : "released"}">${editable ? t("Design", "设计中") : esc(team.teamVersionStatus)}</span></section>${studioWorkspaceNav(teamVersionId, "ir")}<form id="team-ir-editor" class="team-ir-editor" novalidate>${renderTeamIrStructureGraph(draft, esc, editable)}<section class="project-panel"><div class="panel-head"><div><span class="section-kicker">${t("Team", "团队")}</span><h2>${t("Team identity and Run input", "团队信息与运行输入")}</h2></div></div><div class="ir-form-grid"><label>${t("Team ID", "团队 ID")}<input name="team-id" value="${esc(draft.team?.id || teamVersionId)}" required${editable ? "" : " disabled"}></label></div></section><section class="ir-editor-section"><div class="panel-head"><div><span class="section-kicker">${t("Agents and ports", "Agent 与端口")}</span><h2>${t("Team responsibilities", "团队职责")}</h2></div><button class="secondary-button" type="button" data-ir-add-agent${editable ? "" : " disabled"}>${t("Add Agent", "添加 Agent")}</button></div><div class="ir-editor-list">${rows.agents || `<p class="empty-note">${t("Add at least one Agent.", "请至少添加一个 Agent。")}</p>`}</div></section><section class="ir-editor-section"><div class="panel-head"><div><span class="section-kicker">${t("Handoffs", "Handoff")}</span><h2>${t("Explicit field mapping", "显式字段映射")}</h2></div><button class="secondary-button" type="button" data-ir-add-handoff${editable ? "" : " disabled"}>${t("Add Handoff", "添加 Handoff")}</button></div><div class="ir-editor-list">${rows.handoffs || `<p class="empty-note">${t("Add Run-to-Agent and result handoffs.", "请添加 Run 到 Agent 及结果 Handoff。")}</p>`}</div></section>${renderTeamIrCollaborationSummary(draft, esc)}<details class="project-panel ir-advanced-contracts" open><summary>${t("Join, Loop, Review, Artifact and A2A contracts", "Join、Loop、Review、Artifact 与 A2A 合同")}</summary><p class="form-hint">${t("Edit the v2 JSON fields below. Advanced values are preserved while the fields above are edited; server validation reports schema and semantic diagnostics before saving.", "编辑下方 v2 JSON 字段。上方编辑会保留高级字段；保存前由服务端报告 Schema 与语义诊断。")}</p><label>${t("Advanced contracts JSON", "高级合同 JSON")}<textarea data-ir-advanced-json rows="24" spellcheck="false"${editable ? "" : " disabled"}>${advancedContracts}</textarea></label></details><ul class="studio-event-list ir-diagnostics" data-team-ir-diagnostics aria-live="polite" hidden></ul><p class="form-status" data-team-ir-status role="status" aria-live="polite"></p><div class="form-actions">${editable ? `<button class="primary-button" type="submit">${t("Save and verify", "保存并验证")}</button><button class="secondary-button" type="button" data-ir-undo${undoDraft ? "" : " hidden"}>${t("Undo last suggestion", "撤销上次建议")}</button>` : `<span class="form-hint">${t("Released TeamVersions are read-only.", "已发布 TeamVersion 为只读。")}</span>`}<code data-team-ir-digest>${esc(expectedSemanticDigest || t("Not saved", "尚未保存"))}</code></div></form><section class="project-panel" data-team-ir-simulation><div class="panel-head"><div><span class="section-kicker">${t("Sandbox", "沙箱")}</span><h2>${t("Team IR v2 Simulation", "Team IR v2 仿真")}</h2></div></div><p class="form-hint">${t("Studio Sandbox Simulation automatically approves Review gates. Project Task Reviews require an authenticated reviewer.", "Studio 沙箱仿真会自动通过 Review 门；项目任务 Review 需要已认证的审核人。")}</p>${renderTeamIrSimulationInput(draft.runInput?.dataSchema, simulationInputValue, esc)}<label>${t("Task", "任务")}<input data-ir-simulation-task value="" maxlength="4000"></label><p class="form-status" data-ir-simulation-status role="status" aria-live="polite"></p><div class="form-actions"><button class="primary-button" type="button" data-ir-simulation-run>${t("Run Simulation", "运行仿真")}</button></div><div data-ir-simulation-evidence></div><div data-ir-simulation-history></div></section>`;
      const form = root.querySelector("#team-ir-editor");
      root.querySelector("[data-ir-create-version]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Unable to create a new TeamVersion.");
          navigate(`/studio/teams/${encodeURIComponent(payload.projectId)}/ir`);
        } catch (error) {
          if (isAbort(error)) return;
          button.disabled = false;
          showToast(error.message || "Unable to create a new TeamVersion.");
        }
      });
      root.querySelector("[data-ir-reference-classic]")?.addEventListener("click", () => {
        const dialog = document.createElement("dialog");
        dialog.className = "confirm-dialog ir-template-dialog";
        dialog.innerHTML = `<div class="dialog-head"><div><span class="section-kicker">${state.locale === "en" ? "Team IR v2" : "Team IR v2"}</span><h2>${state.locale === "en" ? "Reference a classic team" : "参考经典团队"}</h2><p class="form-hint">${state.locale === "en" ? "Choose a built-in team to create a separate draft. This TeamVersion stays unchanged." : "选择内置团队创建独立草稿；当前 TeamVersion 不会被修改。"}</p></div><button type="button" class="close-button" data-close-ir-template aria-label="${state.locale === "en" ? "Close" : "关闭"}">×</button></div><div class="classic-template-dialog-grid">${(state.cases || []).map((item) => `<button type="button" class="classic-template-dialog-item" data-ir-template-case="${esc(item.id)}"><strong>${esc(text(item.title))}</strong><span>${esc(text(item.short))}</span></button>`).join("")}</div>`;
        document.body.append(dialog);
        const close = () => { dialog.close(); dialog.remove(); };
        dialog.querySelector("[data-close-ir-template]")?.addEventListener("click", close);
        dialog.querySelectorAll("[data-ir-template-case]").forEach((button) => button.addEventListener("click", () => {
          close();
          void createProjectFromCase(button.dataset.irTemplateCase, "template", button);
        }));
        dialog.addEventListener("close", () => dialog.remove(), { once: true });
        dialog.showModal();
      });
      form.querySelector(".ir-advanced-contracts")?.insertAdjacentHTML("beforebegin", renderTeamIrDerivedViews(draft, esc));
      form.querySelector(".ir-advanced-contracts")?.insertAdjacentHTML("beforebegin", `<section class="ir-editor-section"><div class="panel-head"><div><span class="section-kicker">Orchestration</span><h2>Join contracts</h2></div><button class="secondary-button" type="button" data-ir-add-join${editable ? "" : " disabled"}>Add Join</button></div><div class="ir-editor-list">${rows.joins || '<p class="empty-note">No Join contracts.</p>'}</div></section><section class="ir-editor-section"><div class="panel-head"><div><span class="section-kicker">Orchestration</span><h2>Loop contracts</h2></div><button class="secondary-button" type="button" data-ir-add-loop${editable ? "" : " disabled"}>Add Loop</button></div><div class="ir-editor-list">${rows.loops || '<p class="empty-note">No Loop contracts.</p>'}</div></section><section class="ir-editor-section"><div class="panel-head"><div><span class="section-kicker">Orchestration</span><h2>Review gates</h2></div><button class="secondary-button" type="button" data-ir-add-review${editable ? "" : " disabled"}>Add Review</button></div><div class="ir-editor-list">${rows.reviews || '<p class="empty-note">No Review gates.</p>'}</div></section>`);
      const captureEditor = () => teamIrWithAdvancedContracts(form, teamIrFromEditor(form, draft), draft);
      form.querySelector("[data-ir-undo]")?.addEventListener("click", () => {
        const previous = undoStack.pop() || undoDraft;
        if (!previous) return;
        draft = previous;
        undoDraft = undefined;
        redraw();
        root.querySelector("[data-team-ir-status]").textContent = state.locale === "en" ? "Undid last structured edit; save to persist." : "已撤销上次结构化编辑；保存后才会持久化。";
      });
      const syncQuickSchema = (editor) => {
        const target = editor.dataset.irSchemaTarget;
        const textarea = form.querySelector(`[data-ir-schema-textarea][name="${CSS.escape(target)}"]`);
        if (!textarea) return;
        let current;
        try { current = JSON.parse(textarea.value || "{}"); } catch { current = {}; }
        const sourceProperties = { ...(current.properties && typeof current.properties === "object" && !Array.isArray(current.properties) ? current.properties : {}) };
        let managedBefore = [];
        try {
          const parsed = JSON.parse(editor.dataset.irSchemaManaged || "[]");
          if (Array.isArray(parsed)) managedBefore = parsed.filter((name) => typeof name === "string");
        } catch { /* A malformed editor marker must not affect Advanced JSON. */ }
        const rows = [...editor.querySelectorAll("[data-ir-schema-field]")];
        const rowValues = [];
        const quickNames = new Set();
        for (const row of rows) {
          const name = row.querySelector("[data-ir-schema-name]")?.value.trim();
          if (!name || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
            form.querySelector("[data-team-ir-status]").textContent = state.locale === "en" ? "Schema field names must be non-empty and use letters, numbers, _ or -." : "Schema 字段名不能为空，且只能使用字母、数字、下划线或连字符。";
            return;
          }
          if (quickNames.has(name)) {
            form.querySelector("[data-team-ir-status]").textContent = state.locale === "en" ? `Schema field names must be unique: ${name}.` : `Schema 字段名必须唯一：${name}。`;
            return;
          }
          quickNames.add(name);
          rowValues.push({ row, name, type: row.querySelector("[data-ir-schema-type]")?.value, original: row.dataset.irSchemaOriginal || "" });
        }
        const properties = { ...sourceProperties };
        const required = [];
        for (const original of managedBefore) delete properties[original];
        for (const { row, name, type, original } of rowValues) {
          const previous = original && sourceProperties[original] && typeof sourceProperties[original] === "object" ? sourceProperties[original] : {};
          if (original && original !== name) delete properties[original];
          properties[name] = { ...previous, type };
          if (row.querySelector("[data-ir-schema-required]")?.checked) required.push(name);
        }
        const previousRequired = Array.isArray(current.required) ? current.required : [];
        const preservedRequired = previousRequired.filter((name) => !managedBefore.includes(name));
        const nextSchema = { ...current, type: current.type || "object", properties };
        const nextRequired = [...new Set([...preservedRequired, ...required])];
        if (nextRequired.length || Object.hasOwn(current, "required")) nextSchema.required = nextRequired;
        else delete nextSchema.required;
        editor.dataset.irSchemaManaged = JSON.stringify([...quickNames]);
        for (const { row, name } of rowValues) row.dataset.irSchemaOriginal = name;
        textarea.value = JSON.stringify(nextSchema, null, 2);
        try { draft = captureEditor(); syncAdvancedContracts(); } catch (error) { captureFailure(error); }
      };
      const syncQuickArtifacts = (editor) => {
        const target = editor.dataset.irArtifactTarget;
        const textarea = form.querySelector(`[data-ir-artifact-textarea][name="${CSS.escape(target)}"]`);
        if (!textarea) return;
        let current = {};
        try { current = JSON.parse(textarea.value || "{}") || {}; } catch { /* Advanced JSON validation reports malformed values. */ }
        const mediaKey = editor.dataset.irArtifactMediaKey || "acceptedMediaTypes";
        const rows = [...editor.querySelectorAll("[data-ir-artifact-field]")];
        const rowValues = [];
        const names = new Set();
        for (const row of rows) {
          const name = row.querySelector("[data-ir-artifact-name]")?.value.trim();
          if (!name || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
            form.querySelector("[data-team-ir-status]").textContent = state.locale === "en" ? "Artifact slot names must be non-empty and use letters, numbers, _ or -." : "Artifact 槽位名不能为空，且只能使用字母、数字、下划线或连字符。";
            return;
          }
          if (names.has(name)) {
            form.querySelector("[data-team-ir-status]").textContent = state.locale === "en" ? `Artifact slot names must be unique: ${name}.` : `Artifact 槽位名必须唯一：${name}。`;
            return;
          }
          names.add(name);
          rowValues.push({ row, name, original: row.dataset.irArtifactOriginal || "" });
        }
        const slots = {};
        for (const { row, name, original } of rowValues) {
          const spec = { ...(current[original] && typeof current[original] === "object" ? current[original] : {}) };
          const mediaTypes = row.querySelector("[data-ir-artifact-media]")?.value.split(",").map((item) => item.trim()).filter(Boolean) || [];
          spec[mediaKey] = mediaTypes;
          spec.cardinality = row.querySelector("[data-ir-artifact-cardinality]")?.value || "single";
          spec.required = row.querySelector("[data-ir-artifact-required]")?.checked === true;
          slots[name] = spec;
        }
        for (const { row, name } of rowValues) row.dataset.irArtifactOriginal = name;
        textarea.value = JSON.stringify(slots, null, 2);
        try { draft = captureEditor(); syncAdvancedContracts(); } catch (error) { captureFailure(error); }
      };
      form.addEventListener("input", (event) => {
        const editor = event.target.closest("[data-ir-schema-quick]");
        if (editor) syncQuickSchema(editor);
        const artifactEditor = event.target.closest("[data-ir-artifact-quick]");
        if (artifactEditor) syncQuickArtifacts(artifactEditor);
      });
      form.addEventListener("change", (event) => {
        const editor = event.target.closest("[data-ir-schema-quick]");
        if (editor) syncQuickSchema(editor);
        const artifactEditor = event.target.closest("[data-ir-artifact-quick]");
        if (artifactEditor) syncQuickArtifacts(artifactEditor);
      });
      form.addEventListener("click", (event) => {
        const addField = event.target.closest("[data-ir-schema-add]");
        const removeField = event.target.closest("[data-ir-schema-remove]");
        if (!addField && !removeField) return;
        const editor = event.target.closest("[data-ir-schema-quick]");
        if (!editor) return;
        if (removeField) removeField.closest("[data-ir-schema-field]")?.remove();
        else {
          const names = new Set([...editor.querySelectorAll("[data-ir-schema-name]")].map((input) => input.value.trim()));
          let name = "field";
          for (let suffix = 2; names.has(name); suffix += 1) name = `field${suffix}`;
          editor.querySelector("[data-ir-schema-fields]")?.insertAdjacentHTML("beforeend", `<div class="ir-schema-field" data-ir-schema-field data-ir-schema-original=""><input data-ir-schema-name value="${escText(name)}" aria-label="New schema field name"><select data-ir-schema-type aria-label="New schema field type"><option value="string">string</option><option value="number">number</option><option value="integer">integer</option><option value="boolean">boolean</option></select><label class="checkbox-label"><input type="checkbox" data-ir-schema-required>Required</label><button type="button" class="icon-button" data-ir-schema-remove aria-label="Remove schema field" title="Remove schema field">×</button></div>`);
        }
        syncQuickSchema(editor);
      });
      form.addEventListener("click", (event) => {
        const addSlot = event.target.closest("[data-ir-artifact-add]");
        const removeSlot = event.target.closest("[data-ir-artifact-remove]");
        if (!addSlot && !removeSlot) return;
        const editor = event.target.closest("[data-ir-artifact-quick]");
        if (!editor) return;
        if (removeSlot) removeSlot.closest("[data-ir-artifact-field]")?.remove();
        else {
          const names = new Set([...editor.querySelectorAll("[data-ir-artifact-name]")].map((input) => input.value.trim()));
          let name = "slot";
          for (let suffix = 2; names.has(name); suffix += 1) name = `slot${suffix}`;
          editor.querySelector("[data-ir-artifact-fields]")?.insertAdjacentHTML("beforeend", `<div class="ir-artifact-field" data-ir-artifact-field data-ir-artifact-original=""><input data-ir-artifact-name value="${escText(name)}" aria-label="New Artifact slot name"><input data-ir-artifact-media value="text/plain" placeholder="text/plain, text/markdown" aria-label="New Artifact slot media types"><select data-ir-artifact-cardinality aria-label="New Artifact slot cardinality"><option value="single" selected>single</option><option value="many">many</option></select><label class="checkbox-label"><input type="checkbox" data-ir-artifact-required>Required</label><button type="button" class="icon-button" data-ir-artifact-remove aria-label="Remove Artifact slot" title="Remove Artifact slot">x</button></div>`);
        }
        syncQuickArtifacts(editor);
      });
      const syncMappingText = (handoffRow) => {
        const index = handoffRow.dataset.irHandoff;
        const values = [...handoffRow.querySelectorAll("[data-ir-map-row]")].map((row) => {
          const target = row.querySelector("[data-ir-map-target]")?.value;
          let expression;
          try { expression = JSON.parse(row.querySelector("[data-ir-value-state]")?.value || "null"); } catch { return ""; }
          return target && typeof expression?.$ref === "string" && expression.$ref ? `${target}=${expression.$ref}` : "";
        }).filter(Boolean);
        handoffRow.querySelector(`[name="handoff-${index}-mapping"]`).value = values.join(", ");
      };
      const valueEditorOptions = (mapRow) => {
        const handoffRow = mapRow.closest("[data-ir-handoff]");
        if (handoffRow) {
          const handoff = draft.handoffs[Number(handoffRow.dataset.irHandoff)];
          const fields = teamIrHandoffMappingFields(draft, handoff);
          return { kind: "handoff", directRefs: fields.sourceFields.map((field) => ({ value: `${fields.sourceRoot}.${field}`, reference: `${fields.sourceRoot}.${field}`, label: `${fields.sourceRoot}.${field}` })), directLabel: "Handoff source field" };
        }
        const joinRow = mapRow.closest("[data-ir-join]");
        const join = draft.orchestration.joins[Number(joinRow?.dataset.irJoin)];
        const fields = teamIrJoinBaseMappingFields(draft, join);
        return { kind: "join", directRefs: fields.sourceFields.map((field) => ({ value: field, reference: `$.run.input.${field}`, label: field })), directLabel: "Join base mapping source" };
      };
      const valuePath = (node) => JSON.parse(node?.dataset.irValuePath || "[]");
      const valueNodeAtPath = (mapRow, path) => [...mapRow.querySelectorAll("[data-ir-value-node]")]
        .find((node) => JSON.stringify(valuePath(node)) === JSON.stringify(path));
      const rowValue = (mapRow) => JSON.parse(mapRow.querySelector("[data-ir-value-state]")?.value || "null");
      const saveValue = (mapRow, expression, changedPath = [], rerender = false) => {
        const state = mapRow.querySelector("[data-ir-value-state]");
        state.value = JSON.stringify(expression);
        if (rerender) {
          const previousNode = valueNodeAtPath(mapRow, changedPath);
          if (previousNode) previousNode.outerHTML = renderTeamIrValueExprNode(teamIrValueAtPath(expression, changedPath), valueEditorOptions(mapRow), esc, editable, changedPath.length, changedPath);
        }
        const handoffRow = mapRow.closest("[data-ir-handoff]");
        if (handoffRow) syncMappingText(handoffRow);
        try {
          draft = captureEditor();
          syncAdvancedContracts();
        } catch (error) { captureFailure(error); }
      };
      const removeHandoffMappingRow = (mapRow) => {
        const handoffRow = mapRow?.closest("[data-ir-handoff]");
        mapRow?.remove();
        if (handoffRow) syncMappingText(handoffRow);
        try { draft = captureEditor(); syncAdvancedContracts(); } catch (error) { captureFailure(error); }
      };
      const bindHandoffMappingRow = (mapRow) => {
        mapRow?.querySelector("[data-ir-map-remove]")?.addEventListener("click", () => removeHandoffMappingRow(mapRow));
      };
      const addMappingRow = (handoffIndex, target = "", reference = "") => {
        const current = captureEditor();
        const handoff = current.handoffs[handoffIndex];
        if (!handoff) return;
        undoStack.push(structuredClone(current));
        const row = form.querySelector(`[data-ir-handoff="${handoffIndex}"]`);
        const container = row.querySelector(`[data-ir-map-rows="${handoffIndex}"]`);
        const fields = teamIrHandoffMappingFields(current, handoff);
        const expression = { $ref: reference || fields.sourceFields[0] ? reference || `${fields.sourceRoot}.${fields.sourceFields[0]}` : "" };
        container.insertAdjacentHTML("beforeend", renderTeamIrMappingRow(handoffIndex, container.children.length, fields, { target, expression }, esc, editable));
        const mapRow = container.lastElementChild;
        bindHandoffMappingRow(mapRow);
        syncMappingText(row);
        mapRow.querySelector("[data-ir-map-target]")?.focus();
        form.querySelector("[data-ir-undo]")?.removeAttribute("disabled");
      };
      form.querySelectorAll("[data-ir-map-row]").forEach(bindHandoffMappingRow);
      form.addEventListener("change", (event) => {
        const mapRow = event.target.closest("[data-ir-map-row], [data-ir-join-base-row]");
        if (!mapRow) return;
        if (event.target.matches("[data-ir-map-target], [data-ir-join-base-target]")) {
          const handoffRow = mapRow.closest("[data-ir-handoff]");
          if (handoffRow) syncMappingText(handoffRow);
          try { draft = captureEditor(); syncAdvancedContracts(); } catch (error) { captureFailure(error); }
          return;
        }
        if (event.target.matches("[data-ir-value-object-key]")) {
          const entry = event.target.closest("[data-ir-value-entry]");
          const childNode = entry?.querySelector("[data-ir-value-node]");
          if (!childNode) return;
          const childPath = valuePath(childNode);
          const previousKey = childPath.at(-1);
          const nextKey = event.target.value.trim();
          let expression = rowValue(mapRow);
          const parent = teamIrValueAtPath(expression, childPath.slice(0, -1));
          const error = childNode.querySelector("[data-ir-value-error]");
          if (!nextKey || nextKey === "$ref" || nextKey === "$literal" || (nextKey !== previousKey && Object.hasOwn(parent, nextKey))) {
            error.hidden = false;
            error.textContent = "Property names must be non-empty, unique, and cannot use reserved ValueExpr keys.";
            event.target.value = previousKey;
            return;
          }
          if (nextKey !== previousKey) {
            const entries = Object.entries(parent).map(([key, child]) => [key === previousKey ? nextKey : key, child]);
            expression = teamIrSetValueAtPath(expression, childPath.slice(0, -1), Object.fromEntries(entries));
          }
          saveValue(mapRow, expression, childPath.slice(0, -1), true);
          return;
        }
        const node = event.target.closest("[data-ir-value-node]");
        if (!node) return;
        const path = valuePath(node);
        let expression = rowValue(mapRow);
        let value = teamIrValueAtPath(expression, path);
        if (event.target.matches("[data-ir-value-kind]")) {
          const nextKind = event.target.value;
          value = nextKind === "reference" ? { $ref: value?.$ref || valueEditorOptions(mapRow).directRefs[0]?.reference || "" }
            : nextKind === "literal" ? { $literal: null }
              : nextKind === "object" ? {} : [];
        } else if (event.target.matches("[data-ir-value-direct-ref]")) {
          const option = valueEditorOptions(mapRow).directRefs.find((item) => item.value === event.target.value);
          value = { $ref: option?.reference || "" };
        }
        expression = teamIrSetValueAtPath(expression, path, value);
        saveValue(mapRow, expression, path, true);
      });
      form.addEventListener("input", (event) => {
        const mapRow = event.target.closest("[data-ir-map-row], [data-ir-join-base-row]");
        const node = event.target.closest("[data-ir-value-node]");
        if (!mapRow || !node) return;
        const path = valuePath(node);
        let expression = rowValue(mapRow);
        let replacement;
        if (event.target.matches("[data-ir-value-ref-path]")) replacement = { $ref: event.target.value };
        else if (event.target.matches("[data-ir-value-literal]")) {
          try {
            replacement = { $literal: JSON.parse(event.target.value) };
            const error = node.querySelector("[data-ir-value-error]");
            error.hidden = true;
            error.textContent = "";
          } catch (error) {
            const message = node.querySelector("[data-ir-value-error]");
            message.hidden = false;
            message.textContent = `Literal must be valid JSON: ${error.message}`;
            return;
          }
        } else return;
        expression = teamIrSetValueAtPath(expression, path, replacement);
        const state = mapRow.querySelector("[data-ir-value-state]");
        state.value = JSON.stringify(expression);
        const handoffRow = mapRow.closest("[data-ir-handoff]");
        if (handoffRow) syncMappingText(handoffRow);
        try { draft = captureEditor(); syncAdvancedContracts(); } catch (error) { captureFailure(error); }
      });
      form.addEventListener("click", (event) => {
        const mapRow = event.target.closest("[data-ir-map-row], [data-ir-join-base-row]");
        if (!mapRow) return;
        const node = event.target.closest("[data-ir-value-node]");
        const add = event.target.closest("[data-ir-value-add]");
        const remove = event.target.closest("[data-ir-value-remove]");
        if (!node || (!add && !remove)) {
          if (event.target.closest("[data-ir-map-remove]")) {
            removeHandoffMappingRow(event.target.closest("[data-ir-map-row]"));
          }
          return;
        }
        const path = valuePath(node);
        const expression = rowValue(mapRow);
        const value = teamIrValueAtPath(expression, path);
        if (add) {
          if (add.dataset.irValueAdd === "object" && Object.keys(value).length < TEAM_IR_VALUE_EDITOR_MAX_ITEMS) {
            let key = "field";
            for (let suffix = 2; Object.hasOwn(value, key); suffix += 1) key = `field${suffix}`;
            value[key] = { $literal: null };
          } else if (add.dataset.irValueAdd === "array" && value.length < TEAM_IR_VALUE_EDITOR_MAX_ITEMS) value.push({ $literal: null });
          else return;
        } else {
          const entryNode = remove.closest("[data-ir-value-entry]")?.querySelector("[data-ir-value-node]");
          if (!entryNode) return;
          teamIrDeleteValueAtPath(expression, valuePath(entryNode));
        }
        saveValue(mapRow, expression, path, true);
      });
      form.querySelectorAll("[data-ir-map-add]").forEach((button) => button.addEventListener("click", () => {
        addMappingRow(Number(button.dataset.irMapAdd));
      }));
      form.querySelectorAll("[data-ir-graph-node]").forEach((button) => button.addEventListener("click", () => {
        focusTeamIrGraphSelection(form, draft, { kind: button.dataset.irGraphNode, agentId: button.dataset.agentId });
      }));
      const graphCanvas = form.querySelector("[data-ir-graph-canvas]");
      const layoutKey = graphCanvas?.dataset.layoutKey;
      const updateGraphWires = () => {
        if (!graphCanvas) return;
        const svg = graphCanvas.querySelector("[data-ir-graph-wires]");
        const bounds = graphCanvas.getBoundingClientRect();
        svg.setAttribute("width", String(graphCanvas.scrollWidth));
        svg.setAttribute("height", String(graphCanvas.scrollHeight));
        svg.setAttribute("viewBox", `0 0 ${graphCanvas.scrollWidth} ${graphCanvas.scrollHeight}`);
        svg.replaceChildren();
        const anchor = (endpoint, source) => {
          if (endpoint.kind === "run") return graphCanvas.querySelector('[data-ir-connect-source="run"].ir-graph-port');
          if (endpoint.kind === "result") return graphCanvas.querySelector('[data-ir-connect-target="result"].ir-graph-port');
          const selector = source ? "data-ir-port-source-agent-index" : "data-ir-port-target-agent-index";
          const agentIndex = draft.agents.findIndex((agent) => agent.id === endpoint.agentId);
          const port = source ? endpoint.outputPort : endpoint.inputPort;
          return graphCanvas.querySelector(`[${selector}="${agentIndex}"][data-ir-port="${CSS.escape(port || "")}"]`);
        };
        (draft.handoffs || []).forEach((handoff) => {
          const from = anchor(handoff.from, true)?.getBoundingClientRect();
          const to = anchor(handoff.to, false)?.getBoundingClientRect();
          if (!from || !to) return;
          const x1 = from.left - bounds.left + graphCanvas.scrollLeft + from.width / 2;
          const y1 = from.top - bounds.top + graphCanvas.scrollTop + from.height / 2;
          const x2 = to.left - bounds.left + graphCanvas.scrollLeft + to.width / 2;
          const y2 = to.top - bounds.top + graphCanvas.scrollTop + to.height / 2;
          const curve = Math.max(45, Math.abs(x2 - x1) * .45);
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`);
          path.setAttribute("class", "ir-graph-wire");
          path.dataset.handoffId = handoff.id;
          svg.append(path);
        });
      };
      if (graphCanvas) {
        const graphNodes = graphCanvas.querySelector(".ir-graph-nodes");
        const maxRight = [...graphNodes.children].reduce((value, node) => Math.max(value, node.offsetLeft + node.offsetWidth + 24), graphCanvas.clientWidth);
        const maxBottom = [...graphNodes.children].reduce((value, node) => Math.max(value, node.offsetTop + node.offsetHeight + 24), graphCanvas.clientHeight);
        graphNodes.style.minWidth = `${maxRight}px`;
        graphNodes.style.minHeight = `${maxBottom}px`;
        graphCanvas.addEventListener("scroll", updateGraphWires, { passive: true });
        form.querySelectorAll("[data-ir-layout-node]").forEach((node) => {
          const handle = node.querySelector("[data-ir-graph-node]");
          handle.addEventListener("pointerdown", (event) => {
            if (!editable || event.button !== 0) return;
            const canvasRect = graphCanvas.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = node.offsetLeft;
            const startTop = node.offsetTop;
            handle.setPointerCapture(event.pointerId);
            const move = (moveEvent) => {
              node.style.left = `${Math.max(8, startLeft + moveEvent.clientX - startX)}px`;
              node.style.top = `${Math.max(8, startTop + moveEvent.clientY - startY)}px`;
              graphNodes.style.minWidth = `${Math.max(graphCanvas.clientWidth, node.offsetLeft + node.offsetWidth + 24)}px`;
              graphNodes.style.minHeight = `${Math.max(canvasRect.height, node.offsetTop + node.offsetHeight + 24)}px`;
              updateGraphWires();
            };
            const finish = () => {
              const stored = {};
              try { Object.assign(stored, JSON.parse(localStorage.getItem(layoutKey) || "{}")); } catch { }
              stored[node.dataset.irLayoutNode] = { x: node.offsetLeft, y: node.offsetTop };
              try { localStorage.setItem(layoutKey, JSON.stringify(stored)); } catch { }
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", finish);
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", finish, { once: true });
          });
        });
        requestAnimationFrame(updateGraphWires);
      }
      form.querySelectorAll("[data-ir-graph-handoff]").forEach((button) => button.addEventListener("click", () => {
        focusTeamIrGraphSelection(form, draft, { kind: "handoff", index: Number(button.dataset.irGraphHandoff) });
      }));
      form.querySelectorAll("[data-ir-map-suggest]").forEach((button) => button.addEventListener("click", () => {
        try {
          const current = captureEditor();
          const handoffIndex = Number(button.dataset.irMapSuggest);
          const handoff = current.handoffs[handoffIndex];
          const suggestions = form.querySelector(`[data-ir-map-suggestions="${handoffIndex}"]`);
          const candidates = handoff ? teamIrAutoMappingCandidates(current, handoff) : [];
          if (!candidates.length) {
            suggestions.innerHTML = '<span class="field-hint">No compatible required fields with matching names.</span>';
            return;
          }
          suggestions.innerHTML = candidates.map((candidate) => `<button class="text-button" type="button" data-ir-map-accept="${esc(candidate.target)}" data-ir-map-ref="${esc(candidate.reference)}">Add ${esc(candidate.target)} ← ${esc(candidate.reference)}</button>`).join("");
          suggestions.querySelectorAll("[data-ir-map-accept]").forEach((accept) => accept.addEventListener("click", () => {
            undoDraft = structuredClone(draft);
            addMappingRow(handoffIndex, accept.dataset.irMapAccept, accept.dataset.irMapRef);
            suggestions.innerHTML = `<span class="field-hint">${state.locale === "en" ? "Mapping added. Save and verify to include it in Team IR." : "已添加映射。保存并验证后才会写入 Team IR。"}</span>`;
            form.querySelector("[data-ir-undo]")?.removeAttribute("hidden");
          }));
        } catch (error) { captureFailure(error); }
      }));
      const showDiagnostics = (diagnostics = [], targetForm = form) => {
        const list = targetForm.querySelector("[data-team-ir-diagnostics]");
        let resultStatus = targetForm.querySelector("[data-ir-result-completeness]");
        if (!resultStatus) {
          list.insertAdjacentHTML("afterend", '<p class="form-status" data-ir-result-completeness role="status" aria-live="polite" hidden></p>');
          resultStatus = targetForm.querySelector("[data-ir-result-completeness]");
        }
        const resultDiagnostics = diagnostics.filter((item) => item.code === "IR_RESULT_REQUIRED_MISSING" || item.code === "IR_RESULT_CONFLICT");
        resultStatus.hidden = resultDiagnostics.length === 0;
        resultStatus.textContent = resultDiagnostics.length
          ? `Result completeness: ${resultDiagnostics.map((item) => `${item.code} ${item.pointer || "/"}`).join("; ")}`
          : "";
        list.innerHTML = diagnostics.map((item, index) => `<li><button type="button" class="ir-diagnostic" data-ir-diagnostic-index="${index}"><strong>${esc(item.severity || "error")} ${esc(item.code || "IR_DIAGNOSTIC")}</strong> <code>${esc(item.pointer || "/")}</code> <span>${esc(item.message || "")}</span></button></li>`).join("");
        list.hidden = diagnostics.length === 0;
        list.querySelectorAll("[data-ir-diagnostic-index]").forEach((button) => button.addEventListener("click", () => {
          const item = diagnostics[Number(button.dataset.irDiagnosticIndex)];
          if (!item) return;
          try {
            const current = teamIrWithAdvancedContracts(targetForm, teamIrFromEditor(targetForm, draft), draft);
            focusTeamIrDiagnostic(targetForm, current, item.pointer || "/");
          } catch {
            const advanced = targetForm.querySelector("[data-ir-advanced-json]");
            advanced?.closest("details") && (advanced.closest("details").open = true);
            advanced?.focus();
            advanced?.setSelectionRange(0, Math.min(advanced.value.length, 1));
          }
        }));
      };
      const captureFailure = (error) => {
          form.querySelector("[data-team-ir-status]").textContent = error.message || (state.locale === "en" ? "Unable to read Team IR form." : "无法读取 Team IR 表单。" );
      };
      const syncAdvancedContracts = () => {
        form.querySelector("[data-ir-advanced-json]").value = JSON.stringify(teamIrAdvancedContracts(draft), null, 2);
      };
      const refreshHandoffConditionSummary = (index, condition) => {
        const summary = form.querySelector(`[data-ir-condition-summary="${index}"]`);
        if (summary) summary.textContent = condition ? teamIrConditionSummary(condition) : "Always selected";
      };
      const defaultCondition = (op) => {
        if (op === "equals" || op === "notEquals") return { op, args: [{ $ref: "$.run.input.value" }, { $literal: "" }] };
        if (op === "exists") return { op, args: [{ $ref: "$.run.input.value" }] };
        if (op === "not") return { op, args: [{ op: "exists", args: [{ $ref: "$.run.input.value" }] }] };
        if (op === "and" || op === "or") return { op, args: [defaultCondition("exists"), defaultCondition("exists")] };
        return undefined;
      };
      const updateConditionNode = (container, condition, target = container.querySelector(":scope > [data-ir-condition-node]")) => {
        const isRoot = target?.hasAttribute("data-ir-condition-root") ?? true;
        if (target) target.outerHTML = renderTeamIrConditionNode(condition, esc, editable, isRoot);
        else if (condition) container.insertAdjacentHTML("afterbegin", renderTeamIrConditionNode(condition, esc, editable, true));
      };
      form.addEventListener("click", (event) => {
        const add = event.target.closest("[data-ir-condition-add-child]");
        const remove = event.target.closest("[data-ir-condition-remove-child]");
        if (!add && !remove) return;
        const editor = event.target.closest("[data-ir-condition-editor]");
        const root = editor?.querySelector("[data-ir-condition-root]");
        if (!editor || !root) return;
        try {
          const condition = readTeamIrConditionNode(root);
          if (!condition || (condition.op !== "and" && condition.op !== "or")) return;
          if (add) condition.args.push(defaultCondition("exists"));
          else {
            const child = remove.closest(".ir-condition-child");
            const children = [...root.querySelectorAll(":scope > .ir-condition-children > .ir-condition-child")];
            const index = children.indexOf(child);
            if (index >= 0 && condition.args.length > 1) condition.args.splice(index, 1);
          }
          updateConditionNode(editor, condition);
          draft = captureEditor();
          syncAdvancedContracts();
          refreshHandoffConditionSummary(Number(editor.dataset.irConditionEditor), condition);
        } catch (error) { captureFailure(error); }
      });
      form.addEventListener("change", (event) => {
        const editor = event.target.closest("[data-ir-condition-editor]");
        if (!editor || !event.target.matches("[data-ir-condition-op]")) return;
        try {
          const condition = defaultCondition(event.target.value);
          updateConditionNode(editor, condition, event.target.closest("[data-ir-condition-node]"));
          draft = captureEditor();
          syncAdvancedContracts();
          refreshHandoffConditionSummary(Number(editor.dataset.irConditionEditor), condition);
        } catch (error) { captureFailure(error); }
      });
      form.addEventListener("input", (event) => {
        const editor = event.target.closest("[data-ir-condition-editor]");
        if (!editor || !event.target.matches("[data-ir-condition-expr-value]")) return;
        try {
          draft = captureEditor();
          syncAdvancedContracts();
          refreshHandoffConditionSummary(Number(editor.dataset.irConditionEditor), draft.handoffs[Number(editor.dataset.irConditionEditor)]?.when?.condition);
        } catch (error) { captureFailure(error); }
      });
      form.querySelectorAll(".ir-join-handoffs input[type=checkbox]").forEach((input) => input.addEventListener("change", () => {
        try {
          draft = captureEditor();
          syncAdvancedContracts();
        } catch (error) { captureFailure(error); }
      }));
      form.addEventListener("change", (event) => {
        if (!event.target.matches("[data-ir-join-base-target], [data-ir-join-base-source]")) return;
        try {
          draft = captureEditor();
          syncAdvancedContracts();
        } catch (error) { captureFailure(error); }
      });
      const removeBaseMapping = (button) => {
        button.addEventListener("click", () => {
          try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
          const row = button.closest("[data-ir-join]");
          const joinIndex = Number(row?.dataset.irJoin);
          const join = draft.orchestration.joins[joinIndex];
          const mappingIndex = Number(button.closest("[data-ir-join-base-row]")?.dataset.irJoinBaseRow);
          const mappings = [...row.querySelectorAll("[data-ir-join-base-row]")];
          const target = mappings[mappingIndex]?.querySelector("[data-ir-join-base-target]")?.value;
          if (target) delete join?.baseMapping?.data?.[target];
          button.closest("[data-ir-join-base-row]")?.remove();
          if (join?.baseMapping && !Object.keys(join.baseMapping.data || {}).length) delete join.baseMapping;
          syncAdvancedContracts();
        });
      };
      const addBaseMapping = (button) => {
        button.addEventListener("click", () => {
          try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
          const row = button.closest("[data-ir-join]");
          const joinIndex = Number(row?.dataset.irJoin);
          const join = draft.orchestration.joins[joinIndex];
          if (!join) return;
          const fields = teamIrJoinBaseMappingFields(draft, join);
          const mappings = row.querySelector("[data-ir-join-base-mappings]");
          const nextIndex = mappings.querySelectorAll("[data-ir-join-base-row]").length;
          mappings.insertAdjacentHTML("beforeend", renderTeamIrJoinBaseMappingRow(joinIndex, nextIndex, fields, {}, esc, true));
          removeBaseMapping(mappings.querySelector(`[data-ir-join-base-row="${nextIndex}"] [data-ir-join-base-remove]`));
          syncAdvancedContracts();
        });
      };
      form.querySelectorAll("[data-ir-join-base-add]").forEach(addBaseMapping);
      form.querySelectorAll("[data-ir-join-base-remove]").forEach(removeBaseMapping);
      form.querySelectorAll("[data-ir-review] input, [data-ir-review] select, [data-ir-review] textarea").forEach((input) => {
        input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
          try {
            draft = captureEditor();
            syncAdvancedContracts();
          } catch (error) { captureFailure(error); }
        });
      });
      const add = (kind) => {
        try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
        if (kind === "agent") {
          const id = `agent-${draft.agents.length + 1}`;
          draft.agents.push({ id, packageRef: "", bindingRef: "", inputPorts: { default: { dataSchema: schemaFromFields("request") } }, outputPorts: { DONE: { dataSchema: schemaFromFields("summary") } } });
        } else if (kind === "handoff") {
          draft.handoffs.push({ id: `handoff-${draft.handoffs.length + 1}`, from: { kind: "run" }, to: { kind: "agent", agentId: draft.agents[0]?.id || "", inputPort: "default" }, map: { data: {} }, delivery: { deadlineMs: 300000 } });
        } else if (kind === "join") {
          const agent = draft.agents[0];
          draft.orchestration.joins.push({
            id: `join-${draft.orchestration.joins.length + 1}`, agentId: agent?.id || "", inputPort: Object.keys(agent?.inputPorts || {})[0] || "default",
            mode: "all_of", handoffIds: [], scope: { kind: "run" }, timeoutMs: 300000, onTimeout: "fail"
          });
        } else if (kind === "review") {
          const agent = draft.agents.find((candidate) => Object.keys(candidate.outputPorts || {}).length > 0);
          const outputPort = Object.keys(agent?.outputPorts || {})[0];
          draft.orchestration.reviews.push({
            id: `review-${draft.orchestration.reviews.length + 1}`,
            at: { kind: "agentOutput", agentId: agent?.id || "", outputPort: outputPort || "" },
            feedbackSchema: { type: "object", properties: {}, additionalProperties: false },
            timeoutMs: 300000,
            onTimeout: "fail"
          });
        } else {
          const agent = draft.agents[0];
          draft.orchestration.loops.push({
            id: `loop-${draft.orchestration.loops.length + 1}`, members: agent ? [agent.id] : [], boundaryAgentId: agent?.id || "",
            entryHandoffIds: [], continueHandoffIds: [], exitHandoffIds: [], maxRounds: 3, maxAgentActivations: 10, onExhausted: "fail"
          });
        }
        syncAdvancedContracts();
        redraw();
      };
      const chooseConnectionSource = (agentIndex, selectedPort) => {
        try {
          const current = captureEditor();
          if (agentIndex === undefined) pendingConnectionSource = { kind: "run" };
          else {
            const agent = current.agents[agentIndex];
            const outputPort = selectedPort || form.querySelector(`[data-ir-link-source-port="${agentIndex}"]`)?.value || Object.keys(agent?.outputPorts || {})[0];
            if (!agent || !outputPort) throw new Error(`Agent at row ${agentIndex + 1} has no output port to connect.`);
            pendingConnectionSource = { kind: "agent", agentId: agent.id, outputPort };
          }
          form.querySelector("[data-ir-connect-status]").textContent = `来源已选择：${pendingConnectionSource.kind === "run" ? "Run" : `${pendingConnectionSource.agentId}.${pendingConnectionSource.outputPort}`}。现在选择目标。`;
        } catch (error) { captureFailure(error); }
      };
      const completeConnection = (agentIndex, selectedPort) => {
        const status = form.querySelector("[data-ir-connect-status]");
        if (!pendingConnectionSource) {
          status.textContent = "请先选择来源，再选择目标。";
          return;
        }
        try {
          const current = captureEditor();
          let target;
          if (agentIndex === "result") target = { kind: "result" };
          else {
            const agent = current.agents[agentIndex];
            const inputPort = selectedPort || form.querySelector(`[data-ir-link-target-port="${agentIndex}"]`)?.value || Object.keys(agent?.inputPorts || {})[0];
            if (!agent || !inputPort) throw new Error(`Agent at row ${agentIndex + 1} has no input port to connect.`);
            target = { kind: "agent", agentId: agent.id, inputPort };
          }
          const endpointKey = (endpoint) => endpoint.kind === "run" ? "run" : `agent:${endpoint.agentId}:${endpoint.outputPort || endpoint.inputPort}`;
          const sourceKey = endpointKey(pendingConnectionSource);
          const existingRoute = current.orchestration.routes.find((route) => endpointKey(route.from) === sourceKey);
          const handoffId = `handoff-${current.handoffs.length + 1}`;
          const existingPriorities = current.handoffs
            .filter((handoff) => endpointKey(handoff.from) === sourceKey)
            .map((handoff) => Number(handoff.when?.priority ?? -1));
          const priority = existingPriorities.length ? Math.max(...existingPriorities) + 1 : 0;
          current.handoffs.push({
            id: handoffId,
            from: structuredClone(pendingConnectionSource),
            to: target,
            map: { data: {} },
            ...(existingRoute
              ? (existingRoute.mode === "exclusive_priority" ? { when: { priority } } : {})
              : { when: { priority: 0 } }),
            delivery: { deadlineMs: 300000 }
          });
          if (existingRoute) existingRoute.handoffIds.push(handoffId);
          else current.orchestration.routes.push({
            from: structuredClone(pendingConnectionSource),
            mode: "exclusive_priority",
            onNoMatch: "fail",
            handoffIds: [handoffId]
          });
          draft = current;
          pendingConnectionSource = undefined;
          syncAdvancedContracts();
          redraw();
          const updatedForm = root.querySelector("#team-ir-editor");
          updatedForm.querySelector("[data-ir-connect-status]").textContent = `已创建 ${handoffId} 草稿。请补充字段映射并通过保存校验。`;
          updatedForm.querySelector(`[data-ir-handoff="${current.handoffs.length - 1}"] input[name$="-id"]`)?.focus();
        } catch (error) { captureFailure(error); }
      };
      form.querySelector("[data-ir-add-agent]")?.addEventListener("click", () => add("agent"));
      form.querySelector("[data-ir-add-handoff]")?.addEventListener("click", () => add("handoff"));
      form.querySelector("[data-ir-add-join]")?.addEventListener("click", () => add("join"));
      form.querySelector("[data-ir-add-loop]")?.addEventListener("click", () => add("loop"));
      form.querySelector("[data-ir-add-review]")?.addEventListener("click", () => add("review"));
      form.querySelector("[data-ir-connect-source='run']")?.addEventListener("click", () => chooseConnectionSource());
      form.querySelectorAll("[data-ir-connect-source-agent-index]").forEach((button) => button.addEventListener("click", () => chooseConnectionSource(Number(button.dataset.irConnectSourceAgentIndex))));
      form.querySelectorAll("[data-ir-connect-target-agent-index]").forEach((button) => button.addEventListener("click", () => completeConnection(Number(button.dataset.irConnectTargetAgentIndex))));
      form.querySelectorAll("[data-ir-port-source-agent-index]").forEach((button) => button.addEventListener("click", () => chooseConnectionSource(Number(button.dataset.irPortSourceAgentIndex), button.dataset.irPort)));
      form.querySelectorAll("[data-ir-port-target-agent-index]").forEach((button) => button.addEventListener("click", () => completeConnection(Number(button.dataset.irPortTargetAgentIndex), button.dataset.irPort)));
      form.querySelector("[data-ir-connect-target='result']")?.addEventListener("click", () => completeConnection("result"));
      form.querySelectorAll("[draggable='true'][data-ir-connect-source], [draggable='true'][data-ir-connect-source-agent-index], [draggable='true'][data-ir-port-source-agent-index]").forEach((button) => {
        button.addEventListener("dragstart", (event) => {
          if (button.dataset.irConnectSource === "run") chooseConnectionSource();
          else if (button.hasAttribute("data-ir-port-source-agent-index")) chooseConnectionSource(Number(button.dataset.irPortSourceAgentIndex), button.dataset.irPort);
          else chooseConnectionSource(Number(button.dataset.irConnectSourceAgentIndex));
          if (!pendingConnectionSource) { event.preventDefault(); return; }
          event.dataTransfer?.setData("text/plain", JSON.stringify(pendingConnectionSource));
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "link";
          button.classList.add("ir-graph-connection-dragging");
        });
        button.addEventListener("dragend", () => button.classList.remove("ir-graph-connection-dragging"));
      });
      form.querySelectorAll("[data-ir-connect-drop-target='true']").forEach((button) => {
        button.addEventListener("dragover", (event) => {
          if (!pendingConnectionSource) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "link";
          button.classList.add("ir-graph-connection-drop-target");
        });
        button.addEventListener("dragleave", () => button.classList.remove("ir-graph-connection-drop-target"));
        button.addEventListener("drop", (event) => {
          event.preventDefault();
          button.classList.remove("ir-graph-connection-drop-target");
          if (!pendingConnectionSource) {
            try { pendingConnectionSource = JSON.parse(event.dataTransfer?.getData("text/plain") || "null") || undefined; }
            catch { pendingConnectionSource = undefined; }
          }
          if (button.dataset.irConnectTarget === "result") completeConnection("result");
          else if (button.hasAttribute("data-ir-port-target-agent-index")) completeConnection(Number(button.dataset.irPortTargetAgentIndex), button.dataset.irPort);
          else completeConnection(Number(button.dataset.irConnectTargetAgentIndex));
        });
      });
      form.querySelector("[data-ir-connect-cancel]")?.addEventListener("click", () => {
        pendingConnectionSource = undefined;
        form.querySelector("[data-ir-connect-status]").textContent = "连接已取消；Team IR 未更改。";
      });
      form.querySelectorAll("[data-ir-remove-agent]").forEach((button) => button.addEventListener("click", () => {
        try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
        const index = Number(button.dataset.irRemoveAgent);
        const agent = draft.agents[index];
        if (!agent) return;
        const references = [
          ...(draft.handoffs || []).filter((handoff) => handoff.from?.agentId === agent.id || handoff.to?.agentId === agent.id).map((handoff) => `Handoff ${handoff.id}`),
          ...(draft.orchestration.routes || []).filter((route) => route.from?.agentId === agent.id).map(() => "a Route"),
          ...(draft.orchestration.joins || []).filter((join) => join.agentId === agent.id).map((join) => `Join ${join.id}`),
          ...(draft.orchestration.loops || []).filter((loop) => loop.boundaryAgentId === agent.id || loop.members?.includes(agent.id)).map((loop) => `Loop ${loop.id}`),
          ...(draft.orchestration.reviews || []).filter((review) => review.at?.agentId === agent.id).map((review) => `Review ${review.id}`)
        ];
        if (references.length && !window.confirm(`Agent ${agent.id} is referenced by ${references.join(", ")}. Remove it and clean these references?`)) {
          captureFailure(new Error(`Cannot remove Agent ${agent.id}; it is referenced by ${references.join(", ")}.`));
          return;
        }
        if (references.length) {
          const removedHandoffs = new Set((draft.handoffs || [])
            .filter((handoff) => handoff.from?.agentId === agent.id || handoff.to?.agentId === agent.id)
            .map((handoff) => handoff.id));
          draft.handoffs = draft.handoffs.filter((handoff) => !removedHandoffs.has(handoff.id));
          draft.orchestration.routes = draft.orchestration.routes
            .filter((route) => route.from?.agentId !== agent.id)
            .map((route) => ({ ...route, handoffIds: route.handoffIds.filter((id) => !removedHandoffs.has(id)) }))
            .filter((route) => route.handoffIds.length);
          draft.orchestration.joins = draft.orchestration.joins.filter((join) => join.agentId !== agent.id)
            .map((join) => ({ ...join, handoffIds: join.handoffIds.filter((id) => !removedHandoffs.has(id)) }));
          draft.orchestration.loops = draft.orchestration.loops
            .filter((loop) => loop.boundaryAgentId !== agent.id)
            .map((loop) => ({ ...loop, members: loop.members.filter((id) => id !== agent.id), entryHandoffIds: loop.entryHandoffIds.filter((id) => !removedHandoffs.has(id)), continueHandoffIds: loop.continueHandoffIds.filter((id) => !removedHandoffs.has(id)), exitHandoffIds: loop.exitHandoffIds.filter((id) => !removedHandoffs.has(id)) }));
          draft.orchestration.reviews = draft.orchestration.reviews.filter((review) => review.at?.agentId !== agent.id);
        }
        draft.agents.splice(index, 1);
        draft.bindings = draft.bindings.filter((binding) => draft.agents.some((agent) => agent.bindingRef === binding.id));
        syncAdvancedContracts();
        redraw();
      }));
      form.querySelectorAll("[data-ir-remove-handoff]").forEach((button) => button.addEventListener("click", () => {
        try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
        const [removed] = draft.handoffs.splice(Number(button.dataset.irRemoveHandoff), 1);
        if (removed) {
          draft.orchestration.routes = draft.orchestration.routes
            .map((route) => ({ ...route, handoffIds: route.handoffIds.filter((id) => id !== removed.id) }))
            .filter((route) => route.handoffIds.length > 0);
          for (const join of draft.orchestration.joins) join.handoffIds = join.handoffIds.filter((id) => id !== removed.id);
          for (const loop of draft.orchestration.loops) {
            loop.entryHandoffIds = loop.entryHandoffIds.filter((id) => id !== removed.id);
            loop.continueHandoffIds = loop.continueHandoffIds.filter((id) => id !== removed.id);
            loop.exitHandoffIds = loop.exitHandoffIds.filter((id) => id !== removed.id);
          }
        }
        syncAdvancedContracts();
        redraw();
      }));
      form.querySelectorAll("[data-ir-remove-join]").forEach((button) => button.addEventListener("click", () => {
        try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
        draft.orchestration.joins.splice(Number(button.dataset.irRemoveJoin), 1);
        syncAdvancedContracts();
        redraw();
      }));
      form.querySelectorAll("[data-ir-remove-loop]").forEach((button) => button.addEventListener("click", () => {
        try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
        draft.orchestration.loops.splice(Number(button.dataset.irRemoveLoop), 1);
        syncAdvancedContracts();
        redraw();
      }));
      form.querySelectorAll("[data-ir-remove-review]").forEach((button) => button.addEventListener("click", () => {
        try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
        draft.orchestration.reviews.splice(Number(button.dataset.irRemoveReview), 1);
        syncAdvancedContracts();
        redraw();
      }));
      form.querySelectorAll("[data-ir-add-port]").forEach((button) => button.addEventListener("click", () => {
        try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
        const agent = draft.agents[Number(button.dataset.irAddPort)];
        const direction = button.dataset.irPortDirection;
        if (!agent || !["inputPorts", "outputPorts"].includes(direction)) return;
        const ports = agent[direction];
        let suffix = Object.keys(ports).length + 1;
        let portId = `${direction === "inputPorts" ? "input" : "output"}-${suffix}`;
        while (Object.hasOwn(ports, portId)) portId = `${direction === "inputPorts" ? "input" : "output"}-${++suffix}`;
        ports[portId] = { dataSchema: { type: "object", properties: {}, additionalProperties: false } };
        syncAdvancedContracts();
        redraw();
        root.querySelector(`[data-ir-agent="${button.dataset.irAddPort}"] [name$="-${direction}-${Object.keys(ports).length - 1}-id"]`)?.focus();
      }));
      form.querySelectorAll("[data-ir-remove-port]").forEach((button) => button.addEventListener("click", () => {
        try { draft = captureEditor(); } catch (error) { captureFailure(error); return; }
        const agent = draft.agents[Number(button.dataset.irRemovePort)];
        const direction = button.dataset.irPortDirection;
        const portId = Object.keys(agent?.[direction] || {})[Number(button.dataset.irPortIndex)];
        if (!agent || !portId) return;
        const references = direction === "inputPorts"
          ? [
              ...(draft.handoffs || []).filter((handoff) => handoff.to?.kind === "agent" && handoff.to.agentId === agent.id && handoff.to.inputPort === portId).map((handoff) => `Handoff ${handoff.id}`),
              ...(draft.orchestration.joins || []).filter((join) => join.agentId === agent.id && join.inputPort === portId).map((join) => `Join ${join.id}`)
            ]
          : [
              ...(draft.handoffs || []).filter((handoff) => handoff.from?.kind === "agent" && handoff.from.agentId === agent.id && handoff.from.outputPort === portId).map((handoff) => `Handoff ${handoff.id}`),
              ...(draft.orchestration.routes || []).filter((route) => route.from?.kind === "agent" && route.from.agentId === agent.id && route.from.outputPort === portId).map((route) => "a Route"),
              ...(draft.orchestration.reviews || []).filter((review) => review.at?.kind === "agentOutput" && review.at.agentId === agent.id && review.at.outputPort === portId).map((review) => `Review ${review.id}`)
            ];
        if (references.length && !window.confirm(`${portId} is referenced by ${references.join(", ")}. Remove it and clean these references?`)) {
          captureFailure(new Error(`Cannot remove ${portId}; it is referenced by ${references.join(", ")}.`));
          return;
        }
        if (references.length) {
          const isSource = direction === "outputPorts";
          const removedHandoffs = new Set((draft.handoffs || [])
            .filter((handoff) => isSource
              ? handoff.from?.agentId === agent.id && handoff.from.outputPort === portId
              : handoff.to?.agentId === agent.id && handoff.to.inputPort === portId)
            .map((handoff) => handoff.id));
          draft.handoffs = draft.handoffs.filter((handoff) => !removedHandoffs.has(handoff.id));
          draft.orchestration.routes = draft.orchestration.routes
            .filter((route) => !(isSource && route.from?.agentId === agent.id && route.from.outputPort === portId))
            .map((route) => ({ ...route, handoffIds: route.handoffIds.filter((id) => !removedHandoffs.has(id)) }))
            .filter((route) => route.handoffIds.length);
          draft.orchestration.joins = draft.orchestration.joins
            .map((join) => ({ ...join, handoffIds: join.handoffIds.filter((id) => !removedHandoffs.has(id)) }))
            .filter((join) => !(join.agentId === agent.id && !isSource && join.inputPort === portId));
          draft.orchestration.reviews = draft.orchestration.reviews
            .filter((review) => !(isSource && review.at?.agentId === agent.id && review.at.outputPort === portId));
        }
        delete agent[direction][portId];
        syncAdvancedContracts();
        redraw();
      }));
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = form.querySelector("[data-team-ir-status]");
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        showDiagnostics();
        try {
          const candidate = captureEditor();
          const unconfiguredAgents = (candidate.agents || []).filter((agent) => !String(agent.packageRef || "").trim() || !String(agent.bindingRef || "").trim());
          if (unconfiguredAgents.length) {
            status.textContent = state.locale === "en"
              ? `Configure a Package and Binding before saving: ${unconfiguredAgents.map((agent) => agent.id || "new Agent").join(", ")}.`
              : `保存前请为以下 Agent 选择角色包和 Binding：${unconfiguredAgents.map((agent) => agent.id || "新 Agent").join("、")}`;
            return;
          }
          // This preview is advisory only. The server owns the draft/release
          // decision and the PUT below is always attempted, including semantic
          // diagnostics that are valid to persist as a draft.
          const previewResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir/validate`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamIR: candidate })
          });
          const preview = await previewResponse.json();
          showDiagnostics(preview.diagnostics || []);
          const saveResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir`, {
            method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamIR: candidate, expectedSemanticDigest })
          });
          const saved = await saveResponse.json();
          showDiagnostics(saved.diagnostics || []);
          if (!saveResponse.ok || !saved.saved) {
            status.textContent = saved.error || (state.locale === "en" ? "Team IR draft was not saved." : "Team IR 草稿未保存。" );
            return;
          }
          const reloadResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir`);
          const reloaded = await reloadResponse.json();
          if (!reloadResponse.ok || reloaded.semanticDigest !== saved.semanticDigest) throw new Error("Saved Team IR digest did not match the reopened document.");
          draft = reloaded.teamIR;
          expectedSemanticDigest = reloaded.semanticDigest;
          redraw();
          showDiagnostics(saved.diagnostics || preview.diagnostics || [], root.querySelector("#team-ir-editor"));
          const readiness = saved.releaseReady === false
            ? (saved.draftSaveable ? (state.locale === "en" ? "Draft saved; release readiness still has diagnostics." : "草稿已保存；发布就绪仍有诊断。") : (state.locale === "en" ? "Draft saved." : "草稿已保存。"))
            : (state.locale === "en" ? "Saved and release-ready." : "已保存，可发布。" );
          root.querySelector("[data-team-ir-status]").textContent = `${state.locale === "en" ? "Saved and reopened" : "已保存并重开"} · ${expectedSemanticDigest} · ${readiness}`;
        } catch (error) {
          if (isAbort(error)) return;
          status.textContent = error.message || (state.locale === "en" ? "Unable to save Team IR v2." : "无法保存 Team IR v2。" );
        } finally {
          if (submit?.isConnected) submit.disabled = !editable;
        }
      });
      const simulation = root.querySelector("[data-team-ir-simulation]");
      const simulationStatus = simulation.querySelector("[data-ir-simulation-status]");
      const readSimulationInput = (validate = false) => {
        const json = simulation.querySelector("[data-ir-simulation-input]");
        if (json) {
          const parsed = JSON.parse(json.value);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Run input must be a JSON object.");
          simulationInputValue = parsed;
          return parsed;
        }
        const input = { ...(simulationInputValue || {}) };
        for (const field of simulation.querySelectorAll("[data-ir-simulation-field]")) {
          const key = field.dataset.irSimulationField;
          const type = field.dataset.irSimulationType;
          if (type === "boolean") {
            input[key] = field.checked;
            continue;
          }
          if (field.value === "") {
            if (validate && field.required) throw new Error(`${key} is required.`);
            delete input[key];
            continue;
          }
          if (type === "number" || type === "integer") {
            const number = Number(field.value);
            if (!Number.isFinite(number) || (type === "integer" && !Number.isInteger(number))) throw new Error(`${key} must be a ${type}.`);
            if (field.min !== "" && number < Number(field.min)) throw new Error(`${key} must be at least ${field.min}.`);
            if (field.max !== "" && number > Number(field.max)) throw new Error(`${key} must be at most ${field.max}.`);
            input[key] = number;
          } else {
            if (field.hasAttribute("minlength") && field.value.length < Number(field.minLength)) throw new Error(`${key} must contain at least ${field.minLength} characters.`);
            if (field.hasAttribute("maxlength") && field.value.length > Number(field.maxLength)) throw new Error(`${key} must contain at most ${field.maxLength} characters.`);
            input[key] = field.value;
          }
        }
        simulationInputValue = input;
        return input;
      };
      const refreshSimulationInput = (schema) => {
        try { simulationInputValue = readSimulationInput(false); } catch { /* Keep the last valid input while a JSON fallback is being edited. */ }
        const container = simulation.querySelector("[data-ir-simulation-input-container]");
        if (!container) return;
        container.outerHTML = renderTeamIrSimulationInput(schema, simulationInputValue, esc);
        simulation.querySelectorAll("[data-ir-simulation-field]").forEach((field) => field.addEventListener("input", () => {
          try { readSimulationInput(false); } catch { /* Validation runs when Simulation starts. */ }
        }));
        simulation.querySelector("[data-ir-simulation-input]")?.addEventListener("input", () => {
          try { readSimulationInput(false); } catch { /* Keep the last valid input while JSON is incomplete. */ }
        });
      };
      refreshSimulationInput(draft.runInput?.dataSchema);
      const syncQuickEditorBaselinesFromAdvanced = (advanced) => {
        const contracts = advanced?.agentPortContracts;
        if (!contracts || typeof contracts !== "object" || Array.isArray(contracts)) return;
        form.querySelectorAll("[data-ir-agent]").forEach((agentRow) => {
          const agentIndex = agentRow.dataset.irAgent;
          const agentId = String(form.querySelector(`[name="agent-${CSS.escape(agentIndex)}-id"]`)?.value || "").trim();
          const agentContracts = contracts[agentId];
          if (!agentContracts || typeof agentContracts !== "object") return;
          for (const direction of ["inputPorts", "outputPorts"]) {
            agentRow.querySelectorAll(`[data-ir-port-row="${direction}"]`).forEach((portRow) => {
              const portIndex = portRow.dataset.irPortIndex;
              const portId = String(form.querySelector(`[name="agent-${CSS.escape(agentIndex)}-${direction}-${CSS.escape(portIndex)}-id"]`)?.value || "").trim();
              const contract = agentContracts[direction]?.[portId];
              if (!contract || typeof contract !== "object") return;
              const schema = form.querySelector(`[data-ir-schema-textarea][name="agent-${CSS.escape(agentIndex)}-${direction}-${CSS.escape(portIndex)}-schema"]`);
              const artifacts = form.querySelector(`[data-ir-artifact-textarea][name="agent-${CSS.escape(agentIndex)}-${direction}-${CSS.escape(portIndex)}-artifacts"]`);
              if (schema && contract.dataSchema !== undefined) schema.value = JSON.stringify(contract.dataSchema, null, 2);
              if (artifacts) artifacts.value = contract.artifactSlots ? JSON.stringify(contract.artifactSlots, null, 2) : "";

              // Advanced JSON is the authoritative baseline. Re-render the quick
              // rows so their names, types, metadata keys, and original keys all
              // point at the newly parsed contracts before the next quick edit.
              const schemaEditor = portRow.querySelector("[data-ir-schema-quick]");
              if (schema && schemaEditor && contract.dataSchema !== undefined) {
                const markup = renderTeamIrSchemaQuickEditor(contract.dataSchema, schema.name, esc, editable);
                if (markup) schemaEditor.outerHTML = markup;
                else schemaEditor.remove();
              } else if (schema && !schemaEditor && contract.dataSchema !== undefined) {
                const markup = renderTeamIrSchemaQuickEditor(contract.dataSchema, schema.name, esc, editable);
                if (markup) schema.closest(".ir-port-schema-editor")?.insertAdjacentHTML("beforeend", markup);
              }
              const artifactEditor = portRow.querySelector("[data-ir-artifact-quick]");
              if (artifacts && artifactEditor) {
                artifactEditor.outerHTML = renderTeamIrArtifactQuickEditor(
                  contract.artifactSlots || {},
                  artifacts.name,
                  direction,
                  esc,
                  editable
                );
              }
            });
          }
        });
      };
      form.querySelector("[data-ir-advanced-json]")?.addEventListener("input", (event) => {
        try {
          const advanced = JSON.parse(event.currentTarget.value);
          syncQuickEditorBaselinesFromAdvanced(advanced);
          refreshSimulationInput(advanced.runInput?.dataSchema);
          const contracts = advanced.handoffContracts || {};
          draft.handoffs.forEach((handoff, index) => refreshHandoffConditionSummary(index, contracts[handoff.id]?.when?.condition));
        } catch { /* The editor may be temporarily incomplete while typing. */ }
      });
      const simulationArtifactInputs = document.createElement("section");
      simulationArtifactInputs.dataset.irSimulationArtifactInputs = "";
      simulationArtifactInputs.hidden = true;
      simulationArtifactInputs.innerHTML = '<div class="panel-head"><div><span class="section-kicker">Run input</span><h3>Simulation attachments</h3></div></div><div class="form-actions"><label>Artifact slot<select data-ir-simulation-artifact-slot disabled><option value="">Loading slots...</option></select></label><label class="secondary-button material-upload-button">Choose file<input type="file" data-ir-simulation-artifact-file hidden></label><button class="secondary-button" type="button" data-ir-simulation-artifact-add disabled>Add attachment</button></div><div class="material-list" data-ir-simulation-artifact-list></div><p class="form-status" data-ir-simulation-artifact-status role="status" aria-live="polite"></p>';
      simulation.querySelector("[data-ir-simulation-input-container]")?.after(simulationArtifactInputs);
      const simulationArtifactSlot = simulationArtifactInputs.querySelector("[data-ir-simulation-artifact-slot]");
      const simulationArtifactFile = simulationArtifactInputs.querySelector("[data-ir-simulation-artifact-file]");
      const simulationArtifactAdd = simulationArtifactInputs.querySelector("[data-ir-simulation-artifact-add]");
      const simulationArtifactStatus = simulationArtifactInputs.querySelector("[data-ir-simulation-artifact-status]");
      const simulationArtifactList = simulationArtifactInputs.querySelector("[data-ir-simulation-artifact-list]");
      const simulationArtifactScopeId = createUuid().toLowerCase();
      const simulationArtifactReferences = new Map();
      const renderSimulationArtifacts = () => {
        simulationArtifactList.innerHTML = [...simulationArtifactReferences.entries()].map(([slotId, item]) => `<div class="material-row"><div><strong>${esc(slotId)}</strong><span>${esc(item.filename)} · ${item.size} bytes</span></div><button class="text-button" type="button" data-ir-simulation-artifact-remove="${esc(slotId)}">Remove</button></div>`).join("");
        simulationArtifactList.querySelectorAll("[data-ir-simulation-artifact-remove]").forEach((button) => button.addEventListener("click", () => {
          simulationArtifactReferences.delete(button.dataset.irSimulationArtifactRemove);
          renderSimulationArtifacts();
        }));
      };
      const loadSimulationArtifactSlots = async () => {
        simulationArtifactSlot.disabled = true;
        simulationArtifactAdd.disabled = true;
        simulationArtifactStatus.textContent = "";
        try {
          const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir/simulation-artifact-slots`);
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Unable to load Simulation Artifact slots.");
          const slots = (payload.slots || []).filter((slot) => slot.cardinality === "single");
          simulationArtifactSlot.innerHTML = slots.length
            ? slots.map((slot) => `<option value="${esc(slot.slotId)}">${esc(slot.slotId)}${slot.required ? " · required" : " · optional"}</option>`).join("")
            : '<option value="">No single Artifact input slots</option>';
          simulationArtifactInputs.hidden = slots.length === 0;
          simulationArtifactSlot.disabled = slots.length === 0;
          simulationArtifactAdd.disabled = slots.length === 0;
          const unsupportedRequired = (payload.slots || []).filter((slot) => slot.required && slot.cardinality !== "single");
          if (unsupportedRequired.length) simulationArtifactStatus.textContent = `Required slot(s) need unsupported cardinality: ${unsupportedRequired.map((slot) => slot.slotId).join(", ")}.`;
        } catch (error) {
          if (!isAbort(error)) simulationArtifactStatus.textContent = error.message || "Unable to load Simulation Artifact slots.";
        }
      };
      simulationArtifactAdd.addEventListener("click", async () => {
        const file = simulationArtifactFile.files?.[0];
        const slotId = simulationArtifactSlot.value;
        if (!file || !slotId) { simulationArtifactStatus.textContent = "Select an Artifact slot and a file."; return; }
        if (!file.size || file.size > 512 * 1024) { simulationArtifactStatus.textContent = "Choose a non-empty file no larger than 512 KiB."; return; }
        simulationArtifactAdd.disabled = true;
        simulationArtifactStatus.textContent = "Registering Simulation attachment...";
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          const mediaType = file.type || (file.name.endsWith(".md") ? "text/markdown" : "text/plain");
          const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir/simulation-artifacts/run-input`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ artifactScopeId: simulationArtifactScopeId, slotId, mediaType, contentBase64: btoa(binary) })
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Unable to register Simulation attachment.");
          simulationArtifactReferences.set(slotId, { filename: file.name, size: file.size, reference: { artifactId: payload.artifactId, mediaType: payload.mediaType } });
          simulationArtifactFile.value = "";
          simulationArtifactStatus.textContent = "Simulation attachment registered.";
          renderSimulationArtifacts();
        } catch (error) {
          if (!isAbort(error)) simulationArtifactStatus.textContent = error.message || "Unable to register Simulation attachment.";
        } finally {
          simulationArtifactAdd.disabled = simulationArtifactSlot.disabled;
        }
      });
      void loadSimulationArtifactSlots();
      const renderSimulation = (record) => {
        simulation.querySelector("[data-ir-simulation-evidence]").innerHTML = `<h3>${esc(record.status || "unknown")} · ${esc(record.simulationId || "")}</h3>${record.error ? `<p class="form-status" role="alert">${esc(record.error)}</p>` : ""}<pre>${esc(JSON.stringify({ result: record.result, events: record.events }, null, 2))}</pre>`;
      };
      const refreshSimulationHistory = async () => {
        const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir/simulations`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load Team IR Simulations.");
        const rows = (result.simulations || []).sort((left, right) => right.updatedAt - left.updatedAt);
        simulation.querySelector("[data-ir-simulation-history]").innerHTML = rows.length
          ? `<h3>Recent simulations</h3><ul class="studio-event-list">${rows.map((item) => `<li><button type="button" class="text-button" data-ir-simulation-id="${esc(item.simulationId)}">${esc(item.status)} · ${esc(item.simulationId)}</button> <code>${esc(item.compiledPlanDigest || "")}</code></li>`).join("")}</ul>`
          : "";
        simulation.querySelectorAll("[data-ir-simulation-id]").forEach((button) => button.addEventListener("click", async () => {
          try {
            const detailResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir/simulations/${encodeURIComponent(button.dataset.irSimulationId)}`);
            const detail = await detailResponse.json();
            if (!detailResponse.ok) throw new Error(detail.error || "Unable to load Simulation evidence.");
            renderSimulation(detail);
          } catch (error) { simulationStatus.textContent = error.message || "Unable to load Simulation evidence."; }
        }));
      };
      simulation.querySelector("[data-ir-simulation-run]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        simulationStatus.textContent = state.locale === "en" ? "Running Team IR v2 Simulation…" : "正在运行 Team IR v2 仿真…";
        try {
          const input = readSimulationInput(true);
          const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir/simulations`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ input, task: simulation.querySelector("[data-ir-simulation-task]").value, artifactScopeId: simulationArtifactScopeId,
              attachments: Object.fromEntries([...simulationArtifactReferences.entries()].map(([slotId, item]) => [slotId, item.reference])) })
          });
          const record = await response.json();
          if (!response.ok) throw new Error(record.error || "Unable to run Team IR v2 Simulation.");
          renderSimulation(record);
          simulationStatus.textContent = record.error || `Simulation ${record.status}.`;
          await refreshSimulationHistory();
          simulationArtifactReferences.clear();
          renderSimulationArtifacts();
        } catch (error) {
          simulationStatus.textContent = error instanceof SyntaxError ? "Run input must be valid JSON." : (error.message || "Unable to run Simulation.");
        } finally { button.disabled = false; }
      });
      refreshSimulationHistory().catch((error) => { simulationStatus.textContent = error.message || "Simulation history is unavailable."; });
    };
    redraw();
  } catch (error) {
    if (isAbort(error)) return;
    root.innerHTML = `<div class="run-error">${esc(error.message || "Unable to load Team IR v2.")}</div>`;
  }
}

async function renderStudioReleaseGate(teamVersionId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  const english = state.locale === "en";
  if (!root.querySelector(".page-heading")) root.innerHTML = `<div class="project-loading">${english ? "Checking TeamVersion configuration…" : "正在检查团队版本配置…"}</div>`;
  try {
    const [versionResponse, irResponse] = await Promise.all([
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir`)
    ]);
    const [version, storedIr] = await Promise.all([versionResponse.json(), irResponse.json()]);
    if (!versionResponse.ok) throw new Error(version.error || "TeamVersion not found.");
    if (!irResponse.ok || storedIr.teamIR?.schemaVersion !== 2) throw new Error("TEAM_IR_V2_REQUIRED");
    await renderStudioTeamIrReleaseGate(teamVersionId, version, storedIr, pageRequest);
  } catch (error) {
    if (isAbort(error)) return;
    root.innerHTML = `<div class="run-error">${esc(error.message || "Unable to validate TeamVersion.")}</div>`;
  }
}

async function renderStudioTeamIrReleaseGate(teamVersionId, team, stored, pageRequest) {
  const root = $("#studio-view");
  const english = state.locale === "en";
  const t = (en, zh) => english ? en : zh;
  const base = `/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`;
  const studioIrUrl = `/studio/teams/${encodeURIComponent(teamVersionId)}/ir`;
  const [snapshotResponse, readinessResponse, validationResponse] = await Promise.all([
    pageFetch(`${base}/ir/release-snapshot`),
    pageFetch(`${base}/release-readiness`),
    pageFetch(`${base}/ir/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamIR: stored.teamIR }) })
  ]);
  const [snapshot, readiness, validation] = await Promise.all([
    snapshotResponse.json(), readinessResponse.json(), validationResponse.json()
  ]);
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  const released = team.teamVersionStatus === "released";
  const diagnostics = validation.diagnostics || snapshot.diagnostics || [];
  const blockers = [
    ...(validation.ok === false ? [t("Team IR validation has blocking diagnostics.", "Team IR 校验存在阻断诊断。")]: []),
    ...(!snapshotResponse.ok ? [snapshot.error || t("The immutable Team IR release snapshot is unavailable.", "不可变 Team IR 发布快照不可用。")]: []),
    ...(!readinessResponse.ok ? [readiness.error || t("Release readiness could not be verified.", "无法验证发布就绪状态。")]: []),
    ...(readiness.ready !== true && readinessResponse.ok ? [readiness.reason || t("Required v2 release evidence is missing.", "缺少 v2 发布所需证据。")]: [])
  ];
  const canRelease = !released && validation.ok === true && snapshotResponse.ok && readinessResponse.ok && readiness.ready === true;
  const diagnosticRows = diagnostics.map((item) => `<li><strong>${esc(item.severity || "error")} ${esc(item.code || "IR_DIAGNOSTIC")}</strong> <code>${esc(item.pointer || "/")}</code> ${esc(item.message || "")}</li>`).join("");
  const blockerRows = blockers.map((item) => `<li>${esc(item)}</li>`).join("");
  root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="${studioIrUrl}" data-route="${studioIrUrl}">← ${t("Team IR v2", "Team IR v2")}</a><div class="eyebrow">OGS Studio · v${team.teamVersionNumber || 1}</div><h1>${t("Team IR v2 release gate", "Team IR v2 发布检查")}</h1><p>${esc(team.name || team.teamName || "")}</p></div><span class="status-chip ${released ? "released" : canRelease ? "completed" : "warning"}">${released ? t("Released", "已发布") : canRelease ? t("Ready", "就绪") : t("Blocked", "受阻")}</span></section>${studioWorkspaceNav(teamVersionId, "release")}<section class="project-panel"><div class="panel-head"><div><span class="section-kicker">${t("Immutable v2 release contract", "不可变 v2 发布合同")}</span><h2>${t("Team IR and dependency closure", "Team IR 与依赖闭包")}</h2></div></div><dl class="studio-version-facts"><div><dt>Team IR semantic digest</dt><dd><code>${esc(stored.semanticDigest || "—")}</code></dd></div><div><dt>Compiled plan digest</dt><dd><code>${esc(snapshot.compiledPlanDigest || "—")}</code></dd></div></dl>${diagnosticRows ? `<ul class="studio-event-list ir-diagnostics" data-team-ir-diagnostics>${diagnosticRows}</ul>` : `<p class="form-status" role="status">${t("No blocking Team IR diagnostics.", "Team IR 没有阻断诊断。")}</p>`}${blockerRows ? `<ul class="studio-event-list" data-release-blockers>${blockerRows}</ul>` : ""}<p class="form-status" id="studio-release-status" role="status" aria-live="polite"></p><div class="form-actions">${released ? `<span class="form-hint">${t("Released TeamVersions are immutable.", "已发布 TeamVersion 不可变。")}</span>` : `<button class="primary-button" id="studio-release-button" type="button" ${canRelease ? "" : "disabled"}>${t("Release TeamVersion", "发布团队版本")}</button>`}</div></section>`;
  const releaseButton = root.querySelector("#studio-release-button");
  releaseButton?.addEventListener("click", async () => {
    releaseButton.disabled = true;
    root.querySelector("#studio-release-status").textContent = t("Releasing TeamVersion…", "正在发布团队版本…");
    try {
      const response = await pageFetch(`${base}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("Unable to release TeamVersion.", "无法发布团队版本。"));
      await renderStudioReleaseGate(teamVersionId, pageRequest);
    } catch (error) {
      if (!isAbort(error)) {
        root.querySelector("#studio-release-status").textContent = error.message || t("Unable to release TeamVersion.", "无法发布团队版本。");
        releaseButton.disabled = false;
      }
    }
  });
}

async function confirmTeamRuntimeReadiness(teamId, teamVersionId, pageRequest = state.activeRequest) {
  if (!teamId || !teamVersionId) throw new Error("Team IR v2 readiness requires a Team and TeamVersion.");
  const path = `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/readiness`;
  const response = await pageFetch(path);
  const readiness = await response.json();
  if (pageRequest && !isCurrentRequest(pageRequest)) return false;
  if (!response.ok) throw new Error(readiness.error || "Unable to inspect Team IR v2 readiness.");
  if (readiness.canDryRun !== true || (readiness.blockers || []).length) {
    const blocker = (readiness.blockers || [])[0];
    throw new Error(blocker?.message || blocker?.code || "Team IR v2 is not ready for a Sandbox Run.");
  }
  return true;
}

function runtimeEventsFromPayload(eventsPayload) {
  return (eventsPayload?.events || []).map((entry) => {
    const record = entry?.record || entry || {};
    const event = record.event && typeof record.event === "object" ? record.event : record;
    return { ...record, ...event, type: event.type || record.type || record.eventType };
  }).filter((event) => typeof event.type === "string");
}
async function mountTeamIrRunGraph(teamVersionId, stage, eventsPayload, runId) {
  try {
    const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/ir`);
    const payload = await response.json();
    if (!response.ok || payload.teamIR?.schemaVersion !== 2) {
      throw new Error(payload.error || "Frozen Team IR v2 graph is unavailable.");
    }
    stage.innerHTML = `${renderTeamIrStructureGraph(payload.teamIR, esc, false)}<p class="form-hint">Run ${esc(runId)} · ${runtimeEventsFromPayload(eventsPayload).length} 个运行事件</p>`;
    stage.setAttribute("aria-label", "Frozen Team IR v2 Run graph");
  } catch (error) {
    stage.textContent = error.message || "Frozen Team IR v2 graph is unavailable.";
  }
}

function projectRunStatusLabel(status) {
  return ({ waiting_review: "等待人工审核", paused: "已安全暂停", pause_requested: "正在暂停", running: "运行中", planning: "准备运行", completed: "已完成", failed: "运行失败", cancelled: "已取消", cancel_requested: "正在取消" })[status] || status || "已完成";
}

function projectTaskStatusLabel(status) {
  return ({ queued: "待执行", running: "处理中", planning: "准备处理中", pause_requested: "正在暂停", waiting_review: "待人工审核", paused: "已暂停，可继续", completed: "已完成", failed: "处理失败", cancel_requested: "正在取消", cancelled: "已取消", deleted: "已删除" })[status] || status || "待执行";
}

function runProgress(run) {
  const stateSnapshot = run?.state || {};
  const explicit = Number(stateSnapshot.progress ?? run?.progress);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));
  const nodes = Object.values(stateSnapshot.nodes || {});
  const done = nodes.filter((node) => ["completed", "failed"].includes(node?.status)).length;
  return nodes.length ? Math.round((done / nodes.length) * 100) : 0;
}

export function teamBindingDiagnosticMessage(code, locale = state.locale) {
  const messages = {
    OUTPUT_JSON_INVALID: { en: "The response was not valid JSON.", zh: "模型响应不是有效 JSON。" },
    OUTPUT_JSON_EMPTY: { en: "The model returned an empty response.", zh: "模型返回了空响应。" },
    OUTPUT_JSON_MARKDOWN_FENCE: { en: "Remove Markdown fences from the model response.", zh: "模型响应包含 Markdown 代码围栏。" },
    OUTPUT_JSON_NON_OBJECT_TEXT: { en: "Return one JSON object without surrounding text.", zh: "请只返回一个 JSON 对象，不要添加前后说明。" },
    OUTPUT_JSON_SYNTAX: { en: "The response started as an object but had invalid JSON syntax.", zh: "响应以对象开头，但 JSON 语法无效。" },
    OUTPUT_PARTS_UNSUPPORTED: { en: "The model returned no usable text output; check that the configured provider supports structured JSON output.", zh: "模型没有返回可用文本；请检查所配置的 Provider 是否支持结构化 JSON 输出。" },
    OUTPUT_PARTS_UNEXPECTED_TOOL: { en: "The provider returned a tool call instead of only structured output.", zh: "Provider 在结构化结果之外返回了工具调用。" },
    OUTPUT_PARTS_MULTIPLE_STRUCTURED: { en: "The provider returned more than one structured result.", zh: "Provider 返回了多个结构化结果。" },
    OUTPUT_PARTS_INVALID_TEXT_SIDECAR: { en: "The provider returned an invalid text sidecar with structured output.", zh: "Provider 在结构化结果旁返回了无效文本 part。" },
    OUTPUT_TEXT_MISSING: { en: "The model response did not contain text output.", zh: "模型响应中缺少文本输出。" },
    OUTPUT_ENVELOPE_INVALID: { en: "The response does not match the Team IR event envelope.", zh: "响应不符合 Team IR 事件封套。" },
    OUTPUT_DATA_SCHEMA_INVALID: { en: "The event data did not match its output schema.", zh: "事件数据不符合对应的输出 Schema。" },
    OUTPUT_DATA_TYPE_INVALID: { en: "An event data value had the wrong type.", zh: "事件数据中的值类型不符合要求。" },
    OUTPUT_DATA_REQUIRED: { en: "A required event data field was missing.", zh: "事件数据缺少必需字段。" },
    OUTPUT_DATA_FIELD_UNDECLARED: { en: "Event data included an undeclared field.", zh: "事件数据包含未声明字段。" },
    OUTPUT_ARTIFACT_REQUIRED: { en: "A required text Artifact was missing.", zh: "缺少必需的文本 Artifact。" }
  };
  const message = messages[code];
  return message ? message[locale === "en" ? "en" : "zh"] : "";
}

function runEventSummary(eventsPayload) {
  return (eventsPayload?.events || []).slice(-4).reverse().map((entry) => {
    const raw = entry?.record || entry || {};
    const record = raw.event && typeof raw.event === "object" ? { ...raw, ...raw.event } : raw;
    const event = record.event || record.type || record.status || "运行更新";
    const role = record.roleId || record.roleName || record.nodeId || "运行器";
    const diagnostic = record.data?.diagnosticCode || record.diagnosticCode;
    const detailText = teamBindingDiagnosticMessage(diagnostic) || record.message || record.summary || record.error || record.selectedEvent || "状态已更新";
    const pointer = record.data?.diagnosticPointer || record.diagnosticPointer;
    const detail = pointer ? `${detailText} (${pointer})` : detailText;
    return `<li><strong>${esc(role)}</strong><span>${esc(event)} · ${esc(detail)}</span></li>`;
  }).join("");
}

function readableRunOutput(value) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return value; }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const teamResult = parsed.teamResult && typeof parsed.teamResult === "object" ? parsed.teamResult : parsed;
    if (typeof teamResult.answer === "string") return teamResult.answer;
    if (typeof teamResult.summary === "string") return teamResult.summary;
    return JSON.stringify(parsed, null, 2);
  }
  return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
}

function renderTaskRunDetail(detail, run, eventsPayload) {
  if (!detail || !run) return;
  const status = run.state?.status || run.status || "planning";
  const progress = runProgress(run);
  const mode = run.plan?.executionPolicy?.mode || (run.plan?.engine === "team-ir-v2" ? "sandbox" : run.mode || "dry-run");
  const events = runEventSummary(eventsPayload);
  const summary = run.outputSummary || run.task?.outputSummary || "";
  const readableSummary = summary ? readableRunOutput(summary) : "";
  const failure = run.state?.error || run.error || "";
  let fullResult;
  try { fullResult = detail.dataset.fullResult ? JSON.parse(detail.dataset.fullResult) : null; } catch { fullResult = detail.dataset.fullResult || ""; }
  const fullResultHtml = fullResult?.finalOutputsByRoleId
    ? renderRoleOutputs(fullResult.finalOutputsByRoleId, fullResult.finalOutputRoleOrder, "无文本输出")
    : (fullResult !== null && fullResult !== undefined ? `<pre>${esc(readableRunOutput(fullResult))}</pre>` : "");
  const workspaceUrl = professionalWorkspaceUrl(run.owner?.projectId || detail.dataset.projectId, run.runId);
  const graphTeamVersionId = detail.dataset.teamVersionId || run.teamVersionId || run.task?.teamVersionId;
  const graphTaskId = detail.dataset.taskId || run.taskId;
  if (run.plan?.engine === "team-ir-v2") {
    const root = $("#project-workspace-view");
    let graphStage = root?.querySelector(`[data-team-ir-run-graph="${CSS.escape(graphTaskId)}"]`);
    if (!graphStage && root && graphTeamVersionId) {
      const stageId = `project-run-graph-${createUuid()}`;
      root.insertAdjacentHTML("beforeend", `<section class="project-panel project-graph-preview run-team-graph"><div class="panel-head"><div><span class="section-kicker">已选团队 · 任务 ${esc(graphTaskId)}</span><h2>团队协作结构</h2><p class="form-status">冻结的 Team IR v2 结构与本次运行状态。</p></div><span class="status-chip">只读</span></div><div id="${esc(stageId)}" class="graph-stage" data-team-ir-run-graph="${esc(graphTaskId)}"></div></section>`);
      graphStage = root.querySelector(`#${CSS.escape(stageId)}`);
    }
    if (graphStage) void mountTeamIrRunGraph(graphTeamVersionId, graphStage, eventsPayload, run.runId);
  } else {
    detail.querySelector(".run-team-graph")?.remove();
  }
  detail.dataset.runStatus = status;
  detail.innerHTML = `<div class="task-run-detail-head"><strong class="task-run-status">${esc(projectRunStatusLabel(status))}</strong><span class="task-run-mode-label run-mode-chip">${mode === "sandbox" ? "隔离运行" : "流程预览"}</span><span class="task-run-progress-label">${progress}%</span></div>${workspaceUrl ? `<p class="task-run-workspace-link"><a class="text-button" href="${esc(workspaceUrl)}"${/^https?:\/\//.test(workspaceUrl) ? ' target="_blank" rel="noopener"' : ""}>查看全流程</a></p>` : ""}<div class="task-run-progress" role="progressbar" aria-label="运行进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><ul class="task-run-events">${events || "<li><span>暂无事件摘要</span></li>"}</ul>${failure ? `<p class="task-run-failure" role="status">${esc(failure)}</p>` : ""}${readableSummary ? `<section class="task-run-output"><strong>结果摘要</strong><pre>${esc(readableSummary)}</pre></section>` : ""}<section class="task-run-output"><strong>完整结果</strong>${fullResultHtml || `<button class="text-button" type="button" data-load-run-result>读取完整结果</button>`}</section><p class="form-status task-run-error" role="status" aria-live="polite"></p>`;
  if ((run.teamIrSemanticDigest || run.owner?.teamIrSemanticDigest) && detail.dataset.taskId
    && run.runId && run.runId === detail.dataset.runId) {
    void mountTeamIrRunReviews(detail, run);
  }
  detail.querySelector("[data-load-run-result]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(detail.dataset.projectId)}/tasks/${encodeURIComponent(detail.dataset.taskId)}/runs/${encodeURIComponent(run.runId)}/result`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "完整结果读取失败");
      if (detail.dataset.selectedRunId !== run.runId) return;
      detail.dataset.fullResult = payload.available ? JSON.stringify(payload.result) : JSON.stringify("完整结果暂不可用；当前仅显示结果摘要。");
      renderTaskRunDetail(detail, run, eventsPayload);
    } catch (error) {
      if (detail.dataset.selectedRunId !== run.runId) return;
      renderTaskRunError(detail, error);
      button.disabled = false;
    }
  });
}

const teamIrRunReviewPanels = new Map();
async function mountTeamIrRunReviews(detail, run) {
  const orchestration = run.plan?.team?.orchestration || run.plan?.orchestration;
  const reviewDefinitions = Array.isArray(orchestration?.reviews) ? [...orchestration.reviews] : [];
  const activeReview = run.state?.waitingReview || run.state?.waitingReviews?.[0];
  if (!reviewDefinitions.length && activeReview?.reviewId) reviewDefinitions.push({ id: activeReview.reviewId });
  if (!reviewDefinitions.length) return;
  const key = `${detail.dataset.projectId}/${detail.dataset.taskId}/${run.runId}`;
  let cached = teamIrRunReviewPanels.get(key);
  if (cached) {
    if (!cached.panel.isConnected) detail.append(cached.panel);
    if (cached.loading) await cached.loading;
    return;
  }
  const panel = document.createElement("section");
  panel.className = "task-run-output team-ir-run-reviews";
  panel.dataset.teamIrRunReviews = "";
  panel.innerHTML = '<strong>Team IR v2 人工审核</strong><p class="form-status" role="status" aria-live="polite">正在读取审核状态...</p><div data-team-ir-review-list></div>';
  detail.append(panel);
  cached = { panel, loading: null };
  teamIrRunReviewPanels.set(key, cached);
  const status = panel.querySelector('[role="status"]');
  const list = panel.querySelector("[data-team-ir-review-list]");
  const base = `/api/v1/projects/${encodeURIComponent(detail.dataset.projectId)}/tasks/${encodeURIComponent(detail.dataset.taskId)}/runs/${encodeURIComponent(run.runId)}/team-ir-reviews`;
  try {
    cached.loading = Promise.all(reviewDefinitions.map(async (definition) => {
      if (!definition?.id) return null;
      const response = await pageFetch(`${base}/${encodeURIComponent(definition.id)}`);
      const payload = await response.json();
      if (response.status === 404 || response.status === 409 && /TEAM_REVIEW_NOT_PENDING/.test(payload.error || "")) return null;
      if (!response.ok) throw new Error(payload.error || "Team IR v2 审核状态读取失败");
      return { ...payload, definition };
    }));
    const reviews = await cached.loading;
    if (!panel.isConnected || detail.dataset.selectedRunId && detail.dataset.selectedRunId !== run.runId) return;
    const pending = reviews.filter((review) => review?.status === "pending");
    if (!pending.length) { panel.remove(); teamIrRunReviewPanels.delete(key); return; }
    status.textContent = "存在待处理的 v2 审核请求。";
    list.innerHTML = pending.map((review, index) => `<form data-team-ir-review="${index}" data-review-id="${esc(review.reviewId)}"><h3>${esc(review.reviewId)}</h3><p>激活时间：${esc(review.activatedAt || "未知")} · 截止时间：${esc(review.deadlineAt || "未设置")} · 修订 ${esc(review.revision)}</p><label>审核决定<select name="decision"><option value="approve">通过</option><option value="reject">拒绝并反馈</option></select></label><label data-review-feedback hidden>拒绝反馈（JSON 对象）<textarea name="feedback" rows="4" placeholder='{"comments":"请补充……"}'></textarea></label><p class="form-status" data-review-status role="status" aria-live="polite"></p><button class="primary-button" type="submit">提交 v2 审核</button></form>`).join("");
    list.querySelectorAll("form[data-team-ir-review]").forEach((form, index) => {
      const review = pending[index];
      const decision = form.elements.decision;
      const feedbackField = form.querySelector("[data-review-feedback]");
      const feedback = form.elements.feedback;
      let submissionSignature = "";
      let submissionIdempotencyKey = "";
      decision.addEventListener("change", () => { feedbackField.hidden = decision.value !== "reject"; feedback.required = decision.value === "reject"; });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const resultStatus = form.querySelector("[data-review-status]");
        let feedbackValue;
        if (decision.value === "reject") {
          try { feedbackValue = JSON.parse(feedback.value); }
          catch { resultStatus.textContent = "反馈必须是有效 JSON 对象。"; return; }
          if (!feedbackValue || typeof feedbackValue !== "object" || Array.isArray(feedbackValue)) { resultStatus.textContent = "反馈必须是 JSON 对象。"; return; }
        }
        const nextSignature = JSON.stringify({ decision: decision.value, feedback: feedbackValue });
        if (nextSignature !== submissionSignature) {
          submissionSignature = nextSignature;
          submissionIdempotencyKey = createUuid();
        }
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        resultStatus.textContent = "正在提交...";
        try {
          const response = await pageFetch(`${base}/${encodeURIComponent(review.reviewId)}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ decision: decision.value, revisionToken: review.revisionToken, idempotencyKey: submissionIdempotencyKey, ...(feedbackValue ? { feedback: feedbackValue } : {}) })
          });
          const payload = await response.json();
          if (!response.ok) {
            if (/REVIEW_(?:CONFLICT|STALE_TOKEN)/.test(payload.error || "")) {
              resultStatus.textContent = "审核状态已变化，当前修订令牌已过期。";
              const refresh = document.createElement("button");
              refresh.type = "button";
              refresh.className = "text-button";
              refresh.textContent = "重新读取审核状态";
              refresh.addEventListener("click", async () => {
                teamIrRunReviewPanels.delete(key);
                await mountTeamIrRunReviews(detail, run);
              }, { once: true });
              resultStatus.append(" ", refresh);
            } else resultStatus.textContent = payload.error || "审核提交失败。";
            button.disabled = false;
            return;
          }
          resultStatus.textContent = `审核已记录：${payload.status}（修订 ${payload.revision}）。`;
          form.querySelectorAll("input, select, textarea, button").forEach((control) => { control.disabled = true; });
          panel.remove();
          teamIrRunReviewPanels.delete(key);
          if (document.querySelector("#project-workspace-view")?.contains(detail)) {
            await renderProjectRun(detail.dataset.projectId, state.activeRequest);
          } else {
            await mountTeamIrRunReviews(detail, run);
          }
        } catch (error) {
          if (!isAbort(error)) resultStatus.textContent = error.message || "审核提交失败。";
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    if (!isAbort(error) && panel.isConnected) {
      status.textContent = error.message || "Team IR v2 审核状态读取失败。";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "text-button";
      retry.textContent = "重新读取审核状态";
      retry.addEventListener("click", async () => {
        teamIrRunReviewPanels.delete(key);
        panel.remove();
        await mountTeamIrRunReviews(detail, run);
      }, { once: true });
      status.append(" ", retry);
    }
  } finally {
    cached.loading = null;
  }
}

function renderTaskRunError(detail, error) {
  if (!detail) return;
  const status = detail.querySelector(".task-run-error");
  if (error?.status === 404) {
    detail.dataset.runStatus = "missing";
    const progressLabel = detail.querySelector(".task-run-progress-label");
    const events = detail.querySelector(".task-run-events");
    if (progressLabel) progressLabel.textContent = "记录缺失";
    if (events) events.innerHTML = "<li><span>运行证据已不存在</span></li>";
    if (status) status.textContent = "此运行记录已不存在。请新建任务并重新运行。";
    return;
  }
  if (status) status.textContent = error?.message || "运行状态读取失败，将继续重试。";
}

function renderMissingRunDetail(detail) {
  if (!detail) return;
  detail.dataset.runStatus = "missing";
  detail.innerHTML = '<div class="task-run-detail-head"><strong class="task-run-status">运行记录缺失</strong><span class="task-run-progress-label">证据不可用</span></div><p class="task-run-error" role="status">此运行记录已不存在。请新建任务并重新运行。</p>';
}

function taskActionErrorMessage(message) {
  if (String(message || "").includes("PROJECT_NOT_READY")) return "当前团队未通过运行就绪检查。请先修复运行配置中的阻塞项，再重新开始。";
  if (String(message || "").includes("PROJECT_SCHEMA_UNSUPPORTED")) return "此项目使用旧结构，当前版本不支持继续添加任务。请创建新项目并选择最新版团队。";
  return message || "任务操作失败";
}

function projectReadinessIssueMessage(issue) {
  const message = String(issue?.message || issue?.code || "");
  if (/Unsupported metadata key ["']entry\.role["']/.test(message)) {
    return "团队使用旧版入口配置。请按当前“开始”连线重新创建团队、发布新版本并重新挂载。";
  }
  return message;
}

function taskActionMarkup(task) {
  const actions = [];
  if (task.status === "queued") actions.push(`<button class="secondary-button" type="button" data-task-action="start" data-task-id="${esc(task.taskId)}">开始处理</button>`);
  if (task.status === "failed" && task.currentRunId) actions.push(`<button class="secondary-button" type="button" data-task-action="retry" data-task-id="${esc(task.taskId)}">重试此任务</button>`);
  if (task.status === "waiting_review") actions.push(`<button class="secondary-button" type="button" data-task-action="review" data-task-id="${esc(task.taskId)}">人工审核</button>`);
  if (["queued", "running", "planning", "waiting_review", "paused", "cancel_requested"].includes(task.status)) actions.push(`<button class="secondary-button danger-button" type="button" data-task-action="cancel" data-task-id="${esc(task.taskId)}">取消</button>`);
  if (task.status !== "deleted") actions.push(`<button class="text-button task-delete-button" type="button" data-task-action="delete" data-task-id="${esc(task.taskId)}">删除</button>`);
  return `${actions.join("")}<p class="form-status task-action-status" role="status" aria-live="polite"></p>`;
}

async function openTaskReview(projectId, taskId, task = {}) {
  const row = document.querySelector(`#project-workspace-view [data-task-record="${CSS.escape(String(taskId))}"]`);
  const detail = row?.querySelector(".task-run-detail");
  const runId = task.currentRunId || detail?.dataset.runId;
  const status = row?.querySelector(".task-action-status");
  if (!runId || !detail) {
    if (status) status.textContent = "当前任务没有可审核的 Team IR v2 运行记录。";
    return;
  }
  try {
    const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}`);
    const run = await response.json();
    if (!response.ok) throw new Error(run.error || "Team IR v2 运行记录读取失败。");
    const activeReview = run.state?.waitingReview || run.state?.waitingReviews?.[0];
    if (run.plan?.engine !== "team-ir-v2" || !run.owner?.teamIrSemanticDigest
      || run.state?.status !== "waiting_human_review" || !activeReview?.reviewId) {
      if (status) status.textContent = "当前运行没有待处理的 Team IR v2 审核请求。";
      return;
    }
    detail.dataset.projectId = projectId;
    detail.dataset.taskId = taskId;
    detail.dataset.selectedRunId = runId;
    await mountTeamIrRunReviews(detail, run);
    const panel = detail.querySelector("[data-team-ir-run-reviews]");
    const reviewForm = panel?.querySelector(`form[data-review-id="${CSS.escape(String(activeReview.reviewId))}"]`);
    if (!panel || !reviewForm) {
      if (status) status.textContent = "此审核请求已处理或已过期。";
      return;
    }
    status.textContent = "已打开当前运行的 Team IR v2 审核请求。";
    reviewForm.scrollIntoView({ block: "center", behavior: "smooth" });
    reviewForm.querySelector("select[name=decision]")?.focus({ preventScroll: true });
  } catch (error) {
    if (!isAbort(error) && status) status.textContent = error.message || "Team IR v2 审核读取失败。";
  }
}

function closeActiveDialogs() {
  closeMobileNav();
  closeTopbarMore();
  document.querySelector("#collaboration-task-dialog[open]")?.close();
  document.querySelector("[data-deliverable-viewer][open]")?.close();
}

async function renderCollaborationProject(projectId, project, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  pageRequest?.runPollers?.forEach((stop) => stop());
  pageRequest?.runPollers?.clear();
  const root = $("#project-workspace-view");
  const teams = project.mountedTeams || [];
  const tasks = (project.taskRecords || []).filter((task) => !task.deletedAt && task.status !== "deleted");
  const orderedTasks = tasks.slice().sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || "") || 0;
    const rightTime = Date.parse(right.createdAt || "") || 0;
    return rightTime - leftTime || Number(right.taskNumber || 0) - Number(left.taskNumber || 0);
  });
  const taskCapacity = project.taskCapacity || { capacity: 1, used: 0, available: 1, activeTasks: [] };
  const materials = project.materials?.materials || [];
  const terminalRefreshes = pageRequest?.terminalRunRefreshes || (pageRequest ? (pageRequest.terminalRunRefreshes = new Set()) : new Set());
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/projects" data-route="/projects">← 协作项目</a><div class="eyebrow">协作项目</div><h1>${esc(project.name)}</h1><p>${esc(project.overview || "按任务推进项目")}</p></div><span class="project-status confirmed">${teams.length} 个团队版本 · ${tasks.length} 个任务</span></section><div class="project-detail-sections collaboration-project-grid"><section id="project-info-panel" class="project-panel project-info-panel"><div class="panel-head"><div><span class="section-kicker">01 · 项目概况</span><h2>项目信息</h2></div></div><p class="project-overview-text">${esc(project.overview || "尚未填写项目概要。")}</p><div class="project-readiness-panel"><div class="panel-head"><div><span class="section-kicker">运行检查</span><h3>团队就绪情况</h3></div></div><div data-project-readiness><p class="empty-note">正在检查已挂载团队...</p></div></div><div id="project-team-heading" class="panel-head project-team-heading"><div><span class="section-kicker">执行团队</span><h3>已挂载版本</h3></div><span class="count-badge">${teams.length}</span></div><div class="material-list project-team-list">${teams.length ? teams.map((team) => `<div class="material-row team-mount-row"><div><strong>${esc(team.teamName || "团队")}</strong><span>v${team.teamVersionNumber || 1} · ${esc(team.status || "可用")}</span></div><button class="text-button" type="button" data-team-adjust="${esc(team.teamVersionId)}">编辑团队</button></div>`).join("") : '<p class="empty-note">尚未挂载团队。</p>'}</div><div class="form-actions"><a class="secondary-button" href="/projects/${encodeURIComponent(projectId)}/teams" data-route="/projects/${encodeURIComponent(projectId)}/teams">管理团队版本</a></div><p class="panel-intro">打开编辑不会新建版本；首次保存实际修改时才创建设计中版本，发布后再将其挂载到项目。</p></section><section id="project-resources-panel" class="project-panel project-resources-panel"><div class="panel-head"><div><span class="section-kicker">02 · 项目文件</span><h2>生产资料</h2></div><span class="count-badge">${materials.length}</span></div><p class="panel-intro">生产资料属于当前项目，供任务执行时使用。</p><form id="project-material-form" class="material-upload-form"><div class="form-actions"><label class="secondary-button material-upload-button">上传文件<input id="project-material-file-input" type="file" multiple hidden accept=".md,.txt,.json,.yaml,.yml,.csv,text/markdown,text/plain,application/json,text/csv"></label><label class="secondary-button material-upload-button">导入文件夹<input id="project-material-folder-input" type="file" multiple webkitdirectory directory hidden accept=".md,.txt,.json,.yaml,.yml,.csv,text/markdown,text/plain,application/json,text/csv"></label></div><small>支持批量文件和文件夹导入，保留文件夹相对路径；单批最多 200 个文件、8 MB。</small><p class="form-status" id="project-material-status" role="status" aria-live="polite"></p></form><div class="material-list">${materials.length ? materials.map((item) => `<div class="material-row"><strong>${esc(item.filename)}</strong><span>${esc(materialStatusLabel(item.status))} · ${item.size || 0} bytes</span></div>`).join("") : '<p class="empty-note">还没有生产资料。</p>'}</div></section><section id="project-run-panel" class="project-panel task-list-panel project-run-panel"><div class="panel-head"><div><span class="section-kicker">03 · 任务与运行</span><h2>运行信息</h2></div><button class="primary-button" type="button" data-open-task-dialog ${teams.length ? "" : "disabled"}>新增任务</button></div><p class="panel-intro">每项任务绑定一个团队版本；同一项目一次运行一个任务，其他任务可先加入清单。</p><div class="task-capacity-summary" data-task-capacity></div><div class="material-list project-task-list">${orderedTasks.length ? orderedTasks.map((task) => `<div class="material-row task-record-row" data-task-record="${esc(task.taskId)}"><div class="task-record-main"><div class="task-title-line"><strong>任务 #${esc(task.taskNumber)} · ${esc(task.teamName || "团队")}</strong><time datetime="${esc(task.createdAt || "")}">${esc(task.createdAt ? new Date(task.createdAt).toLocaleString(state.locale) : `任务 #${task.taskNumber}`)}</time></div><p>${esc(task.input || "")}</p>${task.outputSummary ? `<p class="task-output-summary"><strong>输出摘要：</strong>${esc(task.outputSummary)}</p>` : ""}<div class="task-record-meta"><span class="status-chip ${task.status}">${esc(projectTaskStatusLabel(task.status))}</span>${task.currentRunId ? `<span>Run ${esc(task.currentRunId)}</span>` : ""}${task.review?.comment ? `<span>反馈：${esc(task.review.comment)}</span>` : ""}</div>${task.status === "failed" && task.lastError ? `<p class="task-run-last-error" role="status">${esc(task.lastError)}</p>` : ""}${task.currentRunId ? `<div class="task-run-detail" data-run-id="${esc(task.currentRunId)}" data-team-version-id="${esc(task.teamVersionId || "")}"><div class="task-run-detail-head"><strong class="task-run-status">${esc(projectRunStatusLabel(task.status))}</strong><span class="task-run-progress-label">正在读取...</span></div><div class="task-run-progress" role="progressbar" aria-label="运行进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span style="width:0%"></span></div><ul class="task-run-events"><li><span>正在读取运行事件...</span></li></ul><p class="form-status task-run-error" role="status" aria-live="polite"></p></div>` : ""}</div><div class="task-record-actions">${taskActionMarkup(task)}</div></div>`).join("") : '<p class="empty-note">还没有任务记录。</p>'}</div><dialog class="task-review-dialog" id="collaboration-task-dialog"><form id="collaboration-task-form" class="task-review-form"><div class="panel-head"><div><span class="section-kicker">新增任务</span><h2>安排一项工作</h2></div><button class="text-button" type="button" data-close-task-dialog aria-label="关闭">关闭</button></div><label>执行团队<select name="teamVersionId" required>${teams.map((team) => `<option value="${esc(team.teamVersionId)}">${esc(team.teamName)} · v${team.teamVersionNumber || 1}</option>`).join("")}</select></label><label>任务内容<textarea name="input" required rows="5" maxlength="4000" placeholder="描述这次需要完成的具体工作"></textarea></label><p class="form-status" id="collaboration-task-status" role="status" aria-live="polite"></p><div class="form-actions"><button class="secondary-button" type="button" data-close-task-dialog>取消</button><button class="primary-button" type="submit">添加到清单</button></div></form></dialog></section></div>`;
  for (const task of orderedTasks) {
    const detail = root.querySelector(`[data-task-record="${CSS.escape(task.taskId)}"] .task-run-detail`);
    if (detail) {
      detail.dataset.taskId = task.taskId;
      detail.dataset.teamVersionId = task.teamVersionId || "";
    }
  }
    root.querySelectorAll('.team-link[data-route^="/teams/"]').forEach((link) => link.setAttribute("data-pro-only", ""));
  const collaborationGrid = root.querySelector(".collaboration-project-grid");
  if (collaborationGrid) {
    const boundary = state.locale === "en"
      ? "This check does not verify external network access or credentials. Sandbox Run checks again on the server."
      : "此检查不代表外部网络或凭据已连通。隔离运行启动时服务端会重新检查。";
    const readinessPanel = collaborationGrid.querySelector(".project-readiness-panel");
    pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/readiness`).then((response) => response.json().then((payload) => ({ response, payload }))).then(({ response, payload }) => {
      if (!isCurrentRequest(pageRequest) || !readinessPanel.isConnected) return;
      const target = readinessPanel.querySelector("[data-project-readiness]");
      if (!response.ok) { target.textContent = payload.error || "Readiness check failed."; return; }
      const issues = [...(payload.blockers || []), ...(payload.warnings || [])];
      const stateLabel = payload.canDryRun ? (state.locale === "en" ? "Ready" : "可运行") : (state.locale === "en" ? "Blocked" : "存在阻塞");
      target.innerHTML = '<p class="status-chip ' + (payload.canDryRun ? "completed" : "failed") + '">' + stateLabel + '</p>' + (issues.length
        ? '<ul>' + issues.map((issue) => { const team = teams.find((item) => item.teamVersionId === issue.teamVersionId); return '<li>' + esc(team ? `${team.teamName} · v${team.teamVersionNumber || 1}: ` : "") + esc(projectReadinessIssueMessage(issue)) + '</li>'; }).join("") + '</ul>'
        : '<p>所有已挂载团队均通过静态配置检查。</p>') + '<p class="panel-intro">' + boundary + '</p>';
    }).catch((error) => { if (isCurrentRequest(pageRequest) && !isAbort(error) && readinessPanel) readinessPanel.querySelector("[data-project-readiness]").textContent = error.message; });

    const activeTask = taskCapacity.activeTasks?.[0];
    const capacityNotice = document.createElement("p");
    capacityNotice.className = "panel-intro task-capacity-notice";
    capacityNotice.setAttribute("role", "status");
    capacityNotice.textContent = taskCapacity.available > 0
      ? `执行槽位 ${taskCapacity.used}/${taskCapacity.capacity}，可开始排队任务。`
      : `执行槽位已满，由任务 #${activeTask?.taskNumber ?? "?"}（${activeTask?.status ?? "处理中"}）占用。`;
    collaborationGrid.querySelector("[data-task-capacity]")?.replaceChildren(capacityNotice);
    if (taskCapacity.available <= 0) {
      collaborationGrid.querySelectorAll('[data-task-action="start"], [data-task-action="retry"]').forEach((button) => {
        button.disabled = true;
        button.title = "项目执行槽位正被占用";
      });
    }
  }
  if (collaborationGrid) {
    const section = document.createElement("article");
    section.className = "project-panel project-deliverables-panel";
    section.id = "project-deliverables-panel";
    section.innerHTML = `<div class="panel-head"><div><span class="section-kicker">04 · 项目交付</span><h2>项目成果</h2></div><span class="count-badge" data-deliverable-count>0</span></div><div class="material-list" data-deliverable-list><p class="empty-note">正在读取归档成果...</p></div><dialog class="task-review-dialog deliverable-viewer" data-deliverable-viewer><div class="task-review-form"><div class="panel-head"><div><span class="section-kicker">成果预览</span><h3 data-deliverable-title></h3></div><button class="text-button" type="button" data-close-deliverable>关闭</button></div><p class="panel-intro" data-deliverable-path></p><pre class="task-run-output" data-deliverable-content></pre><div class="form-actions"><button class="primary-button" type="button" data-download-deliverable>下载成果</button></div></div></dialog>`;
    collaborationGrid.append(section);
    const list = section.querySelector("[data-deliverable-list]");
    pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/deliverables`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load deliverables.");
      return payload;
    }).then((payload) => {
      if (!isCurrentRequest(pageRequest) || !section.isConnected) return;
      const deliverables = Array.isArray(payload.deliverables) ? payload.deliverables : [];
      section.querySelector("[data-deliverable-count]").textContent = String(deliverables.length);
      const archivedRunIds = new Set(deliverables.map((item) => item.runId));
      collaborationGrid.querySelectorAll("[data-archive-run]").forEach((button) => {
        if (!archivedRunIds.has(button.dataset.archiveRun)) return;
        button.disabled = true;
        button.textContent = state.locale === "en" ? `Run ${button.dataset.archiveRun} archived` : `Run ${button.dataset.archiveRun} 已归档`;
      });
      list.innerHTML = deliverables.length ? deliverables.slice().reverse().map((item) => `<div class="material-row deliverable-row"><div><strong>任务 ${esc(item.taskId)} · Run ${esc(item.runId)}</strong><p>${esc(item.summary || "暂无结果摘要")}</p><span>尝试 ${esc(item.attemptNumber)} · ${esc(item.createdAt || "")}</span><code>${esc(item.outputPath || "")}</code></div><button class="secondary-button" type="button" data-open-deliverable="${esc(item.deliverableId)}">打开成果</button></div>`).join("") : '<p class="empty-note">尚无已归档成果。完成任务后可从运行记录归档。</p>';
      list.querySelectorAll("[data-open-deliverable]").forEach((button) => button.addEventListener("click", async () => {
        const dialog = section.querySelector("[data-deliverable-viewer]");
        const output = dialog.querySelector("[data-deliverable-content]");
        try {
          const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/deliverables/${encodeURIComponent(button.dataset.openDeliverable)}/content`);
          const result = await response.json();
          if (!isCurrentRequest(pageRequest)) return;
          if (!response.ok) throw new Error(result.error || "Unable to read deliverable.");
          output.textContent = result.content || result.error || "";
          dialog.querySelector("[data-deliverable-title]").textContent = `任务 ${item.taskId} · Run ${item.runId}`;
          dialog.querySelector("[data-deliverable-path]").textContent = item.outputPath || "";
          const download = dialog.querySelector("[data-download-deliverable]");
          download.onclick = () => {
            const url = URL.createObjectURL(new Blob([result.content || ""], { type: "text/plain;charset=utf-8" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `task-${item.taskId}-run-${item.runId}.txt`;
            anchor.click();
            URL.revokeObjectURL(url);
          };
          dialog.showModal();
        } catch (error) { if (!isAbort(error)) showToast(error.message || "Unable to read deliverable."); }
      }));
      section.querySelector("[data-close-deliverable]")?.addEventListener("click", () => section.querySelector("[data-deliverable-viewer]").close());
    }).catch((error) => { if (isCurrentRequest(pageRequest) && !isAbort(error)) list.innerHTML = `<p class="run-error">${esc(error.message)}</p>`; });
    for (const task of tasks) {
      const row = collaborationGrid.querySelector(`.task-record-row:has([data-task-id="${CSS.escape(task.taskId)}"])`);
      const attempts = task.runAttempts || [];
      const completed = attempts.filter((attempt) => attempt.status === "completed" && attempt.evidenceAvailable !== false);
      const candidates = completed.length ? completed : task.status === "completed" && task.currentRunId && !task.runEvidenceMissing ? [{ runId: task.currentRunId, attemptNumber: task.runIds?.indexOf(task.currentRunId) + 1 || 1 }] : [];
      for (const attempt of candidates) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "text-button";
        button.dataset.archiveRun = attempt.runId;
        button.textContent = state.locale === "en" ? `Archive Run ${attempt.runId}` : `归档 Run ${attempt.runId}`;
        row?.querySelector(".task-record-actions")?.prepend(button);
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.taskId)}/runs/${encodeURIComponent(attempt.runId)}/deliverable`, { method: "POST" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Unable to archive deliverable.");
            await renderProjectRun(projectId, pageRequest);
          } catch (error) {
            if (isAbort(error)) return;
            button.disabled = false;
            showToast(error.message || "Unable to archive deliverable.");
          }
        });
      }
    }
  }
  if (collaborationGrid && teams.length) {
    collaborationGrid.querySelectorAll("[data-team-adjust]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team-adjustments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ teamVersionId: button.dataset.teamAdjust })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "无法打开团队编辑");
        navigate(`/studio/teams/${encodeURIComponent(payload.teamVersion.teamVersionId || payload.sourceTeamVersionId)}/ir?collaborationProjectId=${encodeURIComponent(projectId)}&adjust=1&edit=1`);
      } catch (error) {
        if (isAbort(error)) return;
        showToast(error.message || "无法打开团队编辑");
        button.disabled = false;
      }
    }));
  }
  for (const task of tasks) {
    const row = root.querySelector(`.task-record-row:has([data-task-id="${CSS.escape(String(task.taskId))}"])`);
    const main = row?.querySelector(".task-record-main");
    const attempts = task.runAttempts || [];
    if (main && attempts.length > 1) {
      main.insertAdjacentHTML("beforeend", `<ol class="task-attempt-timeline" aria-label="任务尝试记录">${attempts.map((attempt) => `<li class="${attempt.isCurrent ? "current" : "historical"}"><button class="task-attempt-select" type="button" data-attempt-run-id="${esc(attempt.runId)}" aria-pressed="${attempt.isCurrent ? "true" : "false"}"><span>尝试 ${attempt.attemptNumber}</span><span>${esc(projectRunStatusLabel(attempt.status))}</span><span>${attempt.isCurrent ? "当前尝试" : "历史尝试"}</span><span>${attempt.mode === "sandbox" ? "隔离运行" : attempt.mode === "dry-run" ? "流程预览" : "运行方式未知"}</span></button></li>`).join("")}</ol>`);
    }
    const detail = task.currentRunId && root.querySelector(`[data-run-id="${CSS.escape(String(task.currentRunId))}"]`);
    if (!detail) continue;
    detail.dataset.projectId = projectId;
    detail.dataset.taskId = task.taskId;
    detail.dataset.selectedRunId = task.currentRunId;
    if (task.runEvidenceMissing) {
      renderMissingRunDetail(detail);
      continue;
    }
    const actionPanel = row?.querySelector(".task-record-actions");
    const attemptButtons = [...(row?.querySelectorAll("[data-attempt-run-id]") || [])];
    let attemptRequestId = 0;
    const selectAttempt = async (attempt) => {
      const requestId = ++attemptRequestId;
      detail.dataset.selectedRunId = attempt.runId;
      if (actionPanel) actionPanel.hidden = !attempt.isCurrent;
      for (const button of attemptButtons) {
        const selected = button.dataset.attemptRunId === attempt.runId;
        button.setAttribute("aria-pressed", String(selected));
        button.closest("li")?.classList.toggle("selected", selected);
      }
      if (attempt.evidenceAvailable === false) {
        renderMissingRunDetail(detail);
        return;
      }
      detail.dataset.fullResult = "";
      detail.innerHTML = '<p class="task-run-loading" role="status">正在读取这次尝试...</p>';
      try {
        const base = `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.taskId)}/runs/${encodeURIComponent(attempt.runId)}`;
        const [runResponse, eventsResponse] = await Promise.all([pageFetch(base), pageFetch(`${base}/events`)]);
        const [run, events] = await Promise.all([runResponse.json(), eventsResponse.json()]);
        if (!runResponse.ok) throw new Error(run.error || "运行记录读取失败");
        if (!eventsResponse.ok) throw new Error(events.error || "运行事件读取失败");
        if (requestId !== attemptRequestId || !isCurrentRequest(pageRequest)) return;
        renderTaskRunDetail(detail, {
          ...run,
          outputSummary: attempt.outputSummary || "",
          task: { outputSummary: attempt.outputSummary || "" }
        }, events);
      } catch (error) {
        if (requestId === attemptRequestId && isCurrentRequest(pageRequest)) {
          detail.innerHTML = `<p class="task-run-error" role="status">${esc(error.message || "运行记录读取失败")}</p>`;
        }
      }
    };
    for (const button of attemptButtons) {
      button.addEventListener("click", () => {
        const attempt = attempts.find((item) => item.runId === button.dataset.attemptRunId);
        if (attempt) void selectAttempt(attempt);
      });
    }
    if (actionPanel) actionPanel.hidden = false;
    const stop = createRunPoller({
      projectId,
      taskId: task.taskId,
      runId: task.currentRunId,
      request: pageFetch,
      isCurrent: () => isCurrentRequest(pageRequest),
      onUpdate: ({ run, events }) => {
        if (detail.dataset.selectedRunId !== task.currentRunId) return;
        renderTaskRunDetail(detail, run, events);
        const status = run.state?.status || run.status;
        if (isTerminalRunStatus(status) && !terminalRefreshes.has(task.currentRunId)) {
          terminalRefreshes.add(task.currentRunId);
          void renderProjectRun(projectId, pageRequest);
        }
      },
      onError: (error) => renderTaskRunError(detail, error)
    });
    pageRequest?.runPollers?.add(stop);
  }
  const collaborationTaskForm = $("#collaboration-task-form");
  const collaborationTaskDialog = $("#collaboration-task-dialog");
  const taskArtifactReferences = new Map();
  let taskArtifactSlots = [];
  let taskArtifactSlotsReady = false;
  const artifactControls = document.createElement("section");
  artifactControls.className = "task-artifact-inputs";
  artifactControls.innerHTML = '<div class="panel-head"><div><span class="section-kicker">Team IR v2</span><h3>任务输入附件</h3></div></div><div class="form-actions"><label>输入槽位<select data-task-artifact-slot disabled><option value="">正在读取输入槽位...</option></select></label><label class="secondary-button material-upload-button">选择文件<input type="file" data-task-artifact-file hidden accept="text/plain,text/markdown,.txt,.md"></label><button class="secondary-button" type="button" data-task-add-artifact disabled>添加附件</button></div><div class="material-list" data-task-artifact-list></div><p class="form-status" data-task-artifact-status role="status" aria-live="polite"></p>';
  collaborationTaskForm?.querySelector('textarea[name="input"]')?.closest("label")?.after(artifactControls);
  bindDirtyForm(collaborationTaskForm, () => setDirty("collaboration-task-form"));
  const artifactSlotSelect = artifactControls.querySelector("[data-task-artifact-slot]");
  const artifactFileInput = artifactControls.querySelector("[data-task-artifact-file]");
  const artifactStatus = artifactControls.querySelector("[data-task-artifact-status]");
  const artifactList = artifactControls.querySelector("[data-task-artifact-list]");
  const addArtifactButton = artifactControls.querySelector("[data-task-add-artifact]");
  const renderTaskArtifactReferences = () => {
    artifactList.innerHTML = [...taskArtifactReferences.entries()].map(([slotId, item]) => `<div class="material-row"><div><strong>${esc(slotId)}</strong><span>${esc(item.filename)} · ${item.size} bytes</span></div><button class="text-button" type="button" data-remove-task-artifact="${esc(slotId)}" aria-label="移除 ${esc(slotId)} 附件">移除</button></div>`).join("");
    artifactList.querySelectorAll("[data-remove-task-artifact]").forEach((button) => button.addEventListener("click", () => {
      taskArtifactReferences.delete(button.dataset.removeTaskArtifact);
      renderTaskArtifactReferences();
    }));
  };
  const loadTaskArtifactSlots = async () => {
    const teamVersionId = collaborationTaskForm?.elements.teamVersionId?.value;
    taskArtifactSlotsReady = false;
    artifactSlotSelect.disabled = true;
    addArtifactButton.disabled = true;
    artifactSlotSelect.innerHTML = '<option value="">正在读取输入槽位...</option>';
    artifactStatus.textContent = "";
    if (!teamVersionId) return;
    try {
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/run-input-slots?teamVersionId=${encodeURIComponent(teamVersionId)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "输入附件槽位读取失败");
      const slots = (payload.slots || []).filter((slot) => slot.cardinality === "single");
      taskArtifactSlots = slots;
      taskArtifactSlotsReady = true;
      artifactSlotSelect.innerHTML = slots.length
        ? slots.map((slot) => `<option value="${esc(slot.slotId)}">${esc(slot.slotId)}${slot.required ? " · 必填" : " · 可选"}</option>`).join("")
        : '<option value="">该团队没有支持的单文件输入槽位</option>';
      artifactSlotSelect.disabled = slots.length === 0;
      addArtifactButton.disabled = slots.length === 0;
      artifactControls.hidden = slots.length === 0;
    } catch (error) {
      taskArtifactSlots = [];
      if (!isAbort(error)) artifactStatus.textContent = error.message || "输入附件槽位读取失败";
    }
  };
  root.querySelector("[data-open-task-dialog]")?.addEventListener("click", () => {
    taskArtifactReferences.clear();
    renderTaskArtifactReferences();
    collaborationTaskDialog?.showModal();
    void loadTaskArtifactSlots();
  });
  collaborationTaskForm?.elements.teamVersionId?.addEventListener("change", () => {
    taskArtifactReferences.clear();
    renderTaskArtifactReferences();
    void loadTaskArtifactSlots();
  });
  addArtifactButton?.addEventListener("click", async () => {
    const file = artifactFileInput.files?.[0];
    const slotId = artifactSlotSelect.value;
    if (!file || !slotId) { artifactStatus.textContent = "请选择输入槽位和文件。"; return; }
    if (!file.size || file.size > 512 * 1024) { artifactStatus.textContent = "附件需为非空文本文件，且不超过 512 KiB。"; return; }
    addArtifactButton.disabled = true;
    artifactStatus.textContent = "正在登记附件...";
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/run-input`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamVersionId: collaborationTaskForm.elements.teamVersionId.value, slotId, mediaType: file.type || (file.name.endsWith(".md") ? "text/markdown" : "text/plain"), contentBase64: btoa(binary) })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "附件登记失败");
      taskArtifactReferences.set(slotId, { filename: file.name, size: file.size, reference: { artifactId: payload.artifactId, mediaType: payload.mediaType } });
      artifactFileInput.value = "";
      artifactStatus.textContent = "附件已登记到所选输入槽位。";
      renderTaskArtifactReferences();
    } catch (error) {
      if (!isAbort(error)) artifactStatus.textContent = error.message || "附件登记失败";
    } finally {
      addArtifactButton.disabled = artifactSlotSelect.disabled;
    }
  });
  collaborationTaskDialog?.querySelectorAll("[data-close-task-dialog]").forEach((button) => button.addEventListener("click", () => collaborationTaskDialog.close()));
  const uploadMaterials = async (event) => {
    const input = event.currentTarget;
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length) return;
    setDirty("project-materials");
    const status = $("#project-material-status");
    status.textContent = `正在读取 ${files.length} 个文件...`;
    try {
      const payload = { files: await Promise.all(files.map(async (file) => ({ filename: file.webkitRelativePath || file.name, content: await file.text(), contentType: file.type || "text/plain" }))) };
      if (!isCurrentRequest(pageRequest)) return;
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/materials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "资料上传失败");
      clearDirty("project-materials");
      await renderProjectRun(projectId, pageRequest);
    } catch (error) { if (isAbort(error)) return; status.textContent = error.message || "资料上传失败"; }
  };
  $("#project-material-file-input")?.addEventListener("change", uploadMaterials);
  $("#project-material-folder-input")?.addEventListener("change", uploadMaterials);
  collaborationTaskForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("#collaboration-task-status");
    if (!taskArtifactSlotsReady) {
      status.textContent = "请等待输入附件槽位加载完成。";
      return;
    }
    const missingRequiredSlot = taskArtifactSlots.find((slot) => slot.required && !taskArtifactReferences.has(slot.slotId));
    if (missingRequiredSlot) {
      status.textContent = `请先添加必填附件：${missingRequiredSlot.slotId}`;
      return;
    }
    const submit = form.querySelector("button[type=submit]");
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.idempotencyKey = createUuid();
    payload.attachments = Object.fromEntries([...taskArtifactReferences.entries()].map(([slotId, item]) => [slotId, item.reference]));
    submit.disabled = true;
    status.textContent = "正在添加任务...";
    try {
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!isCurrentRequest(pageRequest)) return;
      if (!response.ok) { status.textContent = taskActionErrorMessage(result.error); return; }
      clearDirty("collaboration-task-form");
      taskArtifactReferences.clear();
      collaborationTaskDialog.close();
      form.reset();
      await renderProjectRun(projectId, pageRequest);
    } catch (error) {
      if (isAbort(error)) return;
      if (isCurrentRequest(pageRequest)) status.textContent = error.message || "任务创建失败";
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  });
  root.querySelectorAll("[data-task-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.taskAction;
    const taskId = button.dataset.taskId;
    const task = tasks.find((item) => item.taskId === taskId);
    if (action === "review") { await openTaskReview(projectId, taskId, task); return; }
    if (action === "delete") {
      const confirmed = await confirmAction({ title: "删除任务记录？", message: "删除后任务将从清单隐藏，运行快照仍会保留。", confirmLabel: "删除", cancelLabel: "取消" });
      if (!confirmed) return;
    }
    button.disabled = true;
    const requestedMode = "sandbox";
    const rowStatus = button.closest(".task-record-row")?.querySelector(".task-action-status");
    try {
      if (["start", "retry"].includes(action)) {
        const team = teams.find((item) => item.teamVersionId === task?.teamVersionId);
        const ready = await confirmTeamRuntimeReadiness(task?.teamId || team?.teamId, task?.teamVersionId, pageRequest);
        if (!ready) {
          if (rowStatus && isCurrentRequest(pageRequest)) rowStatus.textContent = "Team IR v2 readiness could not be verified.";
          return;
        }
      }
      const endpoint = action === "delete"
        ? `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
        : action === "retry"
          ? `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/retry`
          : `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/${action}`;
      const response = await pageFetch(endpoint, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: action === "delete" ? undefined : ["start", "retry"].includes(action)
          ? JSON.stringify({ mode: requestedMode, idempotencyKey: createUuid() })
          : "{}"
      });
      const result = await response.json();
      if (!isCurrentRequest(pageRequest)) return;
      if (!response.ok) {
        if (response.status === 409 && String(result.error || "").includes("PROJECT_TASK_CONCURRENCY_LIMIT")) {
          await renderProjectRun(projectId, pageRequest);
          showToast(state.locale === "en" ? "Project task state was refreshed. The execution slot is occupied." : "项目状态已刷新，当前执行槽位已被占用。");
          return;
        }
        if (rowStatus) rowStatus.textContent = taskActionErrorMessage(result.error);
        return;
      }
      await renderProjectRun(projectId, pageRequest);
    } catch (error) {
      if (isAbort(error)) return;
      if (isCurrentRequest(pageRequest)) {
        if (rowStatus) rowStatus.textContent = taskActionErrorMessage(error.message);
        else showToast(error.message || "任务操作失败");
      }
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }));
}

async function renderProjectRun(projectId, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  const workspaceRoot = $("#project-workspace-view");
  const diagnosticMatch = location.pathname.match(/^\/projects\/([a-z0-9-]+)\/runs\/([A-Za-z0-9._-]+)$/);
  const focusedDiagnosticRunId = diagnosticMatch?.[1] === projectId
    ? [...workspaceRoot.querySelectorAll("[data-run-id]")].find((item) => item.dataset.runId === diagnosticMatch[2] && item === document.activeElement)?.dataset.runId
    : undefined;
  const root = $("#project-workspace-view"); root.innerHTML = '<div class="project-loading">正在读取运行工作区...</div>';
  try {
    const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`); const project = await response.json(); if (!response.ok) throw new Error(project.error || "项目不存在");
    if (project.projectType === "collaboration") {
      await renderCollaborationProject(projectId, project, pageRequest);
      if (focusedDiagnosticRunId && isCurrentRequest(pageRequest)) {
        const detail = [...root.querySelectorAll("[data-run-id]")].find((item) => item.dataset.runId === focusedDiagnosticRunId);
        detail?.setAttribute("tabindex", "-1");
        detail?.focus({ preventScroll: true });
      }
      return;
    }
    navigate(`/studio/teams/${encodeURIComponent(projectId)}/ir`);
  } catch (error) { if (isAbort(error)) return; root.innerHTML = `<div class="run-error">${esc(error.message || "运行工作区读取失败")}</div>`; }
}

function syncRoute() {

  const pageRequest = beginPageRequest();
  const currentPath = location.pathname.replace(/\/$/, "") || "/";
  const path = currentPath;
  if (path === "/") {
    history.replaceState({}, "", "/projects");
    router.syncCurrentPath();
    return syncRoute();
  }
  state.studioRoute = path === "/studio" || path.startsWith("/studio/");
  $("#app-shell").classList.remove("hidden");
  const detailMatch = path.match(/^\/cases\/([a-z0-9-]+)$/);
  if (detailMatch) {
    const item = state.cases.find((entry) => entry.id === detailMatch[1]);
    if (item) { $$(".main-area > .page-content").forEach((page) => page.classList.add("hidden")); $("#case-detail-view").classList.remove("hidden"); renderDetail(item); return; }
    history.replaceState({}, "", "/teams"); router.syncCurrentPath(); syncRoute(); return;
  }
  if (path === "/studio/new") {
    setView("new-project");
    renderPageFrame($("#new-project-view"), "E", renderNewProject(pageRequest));
    return;
  }
  if (path === "/studio/roles") {
    setView("studio");
    renderPageFrame($("#studio-view"), "A", renderSharedResourcePage($("#studio-view"), "roles", state.locale, navigate));
    return;
  }
  if (path === "/projects/new") {
    setView("new-project");
    renderPageFrame($("#new-project-view"), "E", renderProjectCreate(pageRequest));
    return;
  }
  const runDiagnosticMatch = path.match(/^\/projects\/([a-z0-9-]+)\/runs\/([A-Za-z0-9._-]+)$/);
  if (runDiagnosticMatch) {
    setView("project-workspace");
    renderPageFrame($("#project-workspace-view"), "B", renderProjectRun(runDiagnosticMatch[1], pageRequest)).then(() => {
      if (!isCurrentRequest(pageRequest)) return;
      const detail = [...document.querySelectorAll("[data-run-id]")].find((item) => item.dataset.runId === runDiagnosticMatch[2]);
      detail?.setAttribute("tabindex", "-1");
      detail?.focus({ preventScroll: true });
      detail?.scrollIntoView({ block: "center" });
    });
    return;
  }
  const studioInfoMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/info$/);
  if (studioInfoMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "D", renderStudioTeamInfo(studioInfoMatch[1], pageRequest));
    return;
  }
  const studioIrMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/ir$/);
  if (studioIrMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "D", renderStudioTeamIr(studioIrMatch[1], pageRequest));
    return;
  }
  const studioReleaseMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/release$/);
  if (studioReleaseMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "D", renderStudioReleaseGate(studioReleaseMatch[1], pageRequest));
    return;
  }
  const projectTeamsMatch = path.match(/^\/projects\/([a-z0-9-]+)\/teams$/);
  if (projectTeamsMatch) {
    setView("project-workspace");
    renderPageFrame($("#project-workspace-view"), "B", renderProjectTeams(projectTeamsMatch[1], pageRequest));
    return;
  }
  const projectRunMatch = path.match(/^\/projects\/([a-z0-9-]+)$/);
  if (projectRunMatch) {
    setView("project-workspace");
    renderPageFrame($("#project-workspace-view"), "B", renderProjectRun(projectRunMatch[1], pageRequest));
    return;
  }
  if (path === "/projects") { state.view = "projects"; void renderCollaborationProjects(pageRequest); }
  else if (path === "/teams") { state.view = "workspace"; void renderProjectLibrary(pageRequest); }
  else if (path === "/studio") { state.view = "studio"; renderPageFrame($("#studio-view"), "A", renderStudioOverview(pageRequest)); }
  else if (path === "/platform/role-sources") { state.view = "platform"; renderPageFrame($("#platform-view"), "D", renderPlatformRoleSources($("#platform-view"), state.locale)); }
  else if (path === "/platform" || path === "/platform/models") { state.view = "platform"; renderPageFrame($("#platform-view"), "D", renderPlatformConfig(pageRequest)); }
  else if (path === "/history") { state.view = "history"; frameExistingPage($("#history-view"), "A"); void renderHistory(pageRequest); }
  setView(state.view);
  if (!["/projects", "/teams", "/studio", "/studio/roles", "/platform", "/platform/models", "/platform/role-sources", "/history"].includes(path) && !detailMatch && !projectRunMatch && !projectTeamsMatch && !studioInfoMatch && !studioIrMatch && !studioReleaseMatch && path !== "/studio/new" && path !== "/projects/new") { history.replaceState({}, "", "/projects"); router.syncCurrentPath(); syncRoute(); }
}
function renderRoleOutputs(outputMap, roleOrder, emptyLabel) {
  if (!outputMap || typeof outputMap !== "object") return `<p>${esc(emptyLabel)}</p>`;
  const orderedRoleIds = [...new Set([...(Array.isArray(roleOrder) ? roleOrder : []), ...Object.keys(outputMap)])];
  const groups = orderedRoleIds.filter((roleId) => Array.isArray(outputMap[roleId])).map((roleId) => {
    const outputs = outputMap[roleId].map((output, index) => {
      const parts = [];
      if (typeof output?.content === "string" && output.content) parts.push(`<pre>${esc(output.content)}</pre>`);
      if (output?.data && typeof output.data === "object") parts.push(`<pre>${esc(JSON.stringify(output.data, null, 2))}</pre>`);
      if (!parts.length) parts.push(`<p>${esc(emptyLabel)}</p>`);
      return `<div class="run-role-output-item">${outputMap[roleId].length > 1 ? `<strong>第 ${index + 1} 次输出</strong>` : ""}${parts.join("")}</div>`;
    }).join("");
    return `<section class="run-role-output"><h4>${esc(roleId)}</h4>${outputs}</section>`;
  }).join("");
  return groups || `<p>${esc(emptyLabel)}</p>`;
}

async function renderHistory() {
  const root = $("#history-list"); if (!root) return;
  root.innerHTML = '<div class="project-loading">正在读取项目运行记录...</div>';
  try {
    const response = await pageFetch("/api/v1/projects/runs/recent?limit=50"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取运行记录");
    state.recentRuns = payload.runs || [];
    if (!state.recentRuns.length) { root.innerHTML = `<div class="history-empty"><strong>${esc(copy[state.locale].noHistory)}</strong></div>`; return; }
    root.innerHTML = state.recentRuns.map((run) => {
      const restoreProjectId = run.owner?.projectId;
      const workspaceUrl = professionalWorkspaceUrl(restoreProjectId, run.runId);
      const workspaceIsInternal = workspaceUrl.startsWith("/");
      const mode = run.mode === "sandbox" ? (state.locale === "en" ? "Isolated run" : "隔离运行") : (state.locale === "en" ? "Preview" : "流程预览");
      const status = projectRunStatusLabel(run.status || "记录");
      return `<article class="history-row"><span class="history-icon">O</span><div class="history-main"><div class="history-title-line"><strong>${esc(run.teamName || "团队")} <span class="version-badge">v${run.teamVersionNumber || 1}</span></strong><span class="history-status">${esc(status)}</span></div><p><span class="history-tag">${esc(run.projectName || "项目")}</span><span class="history-tag">${esc((copy[state.locale].runRound || "任务 {round}").replace("{round}", String(run.taskNumber ?? run.roundNumber ?? "-")))}</span><span class="history-tag">${esc(mode)}</span></p><small>${run.updatedAt ? new Date(run.updatedAt).toLocaleString(state.locale) : ""}</small></div><div class="history-actions"><a class="text-button" href="/projects/${encodeURIComponent(restoreProjectId)}" data-route="/projects/${encodeURIComponent(restoreProjectId)}">${esc(copy[state.locale].historyRestore)}</a><a class="text-button" href="${esc(workspaceUrl)}"${workspaceIsInternal ? ' data-route="' + esc(workspaceUrl) + '"' : ' target="_blank" rel="noopener"'}>${esc(copy[state.locale].advancedWorkspace)}</a></div></article>`;
    }).join("");
  } catch (error) { if (isAbort(error)) return; root.innerHTML = `<div class="run-error">${esc(error.message || "无法读取运行记录")}</div>`; }
}
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2300); }
function setProductMode(mode, persist = true) {
  const normalized = mode === "professional" ? "professional" : "normal";
  document.documentElement.dataset.productMode = normalized;
  const toggle = $("#product-mode-toggle");
  if (toggle) {
    const currentLabel = state.locale === "en" ? (normalized === "professional" ? "Pro" : "Normal") : (normalized === "professional" ? "专业" : "普通");
    const targetLabel = state.locale === "en" ? (normalized === "professional" ? "normal" : "professional") : (normalized === "professional" ? "普通" : "专业");
    const actionLabel = state.locale === "en" ? `Switch to ${targetLabel} mode` : `切换到${targetLabel}模式`;
    toggle.querySelector("[data-product-mode-label]").textContent = currentLabel;
    toggle.setAttribute("aria-pressed", String(normalized === "professional"));
    toggle.setAttribute("aria-label", `${actionLabel} · ${state.locale === "en" ? `Current: ${currentLabel}` : `当前：${currentLabel}`}`);
    toggle.setAttribute("title", actionLabel);
  }
  if (persist) try { localStorage.setItem("ogs.product-mode", normalized); } catch {}
}
function syncNavigationLabels() {
  $$('.primary-nav .nav-item').forEach((link) => {
    const label = link.querySelector("[data-i18n]")?.textContent?.trim();
    if (label) {
      link.title = label;
      link.setAttribute("aria-label", label);
    }
  });
  const shell = $("#app-shell");
  const collapsed = shell?.dataset.nav === "collapsed";
  const label = state.locale === "en"
    ? (collapsed ? "Expand sidebar" : "Collapse sidebar")
    : (collapsed ? "展开侧栏" : "收起侧栏");
  const collapse = $("#sidebar-collapse");
  if (collapse) {
    collapse.title = label;
    collapse.setAttribute("aria-label", label);
    collapse.setAttribute("aria-expanded", String(!collapsed));
    collapse.querySelector("span").textContent = collapsed ? "›" : "‹";
  }
  const mobileToggle = $("#mobile-nav-toggle");
  if (mobileToggle) {
    const open = shell?.dataset.mobileNav === "open";
    mobileToggle.setAttribute("aria-label", state.locale === "en" ? (open ? "Close navigation" : "Open navigation") : (open ? "关闭导航" : "打开导航"));
  }
}
function setNavCollapsed(collapsed, persist = true) {
  const shell = $("#app-shell");
  if (!shell) return;
  shell.dataset.nav = collapsed ? "collapsed" : "expanded";
  if (persist) {
    try {
      localStorage.setItem(navStorageKey, collapsed ? "collapsed" : "expanded");
      navPreferenceStored = true;
    } catch {
      navPreferenceStored = false;
    }
  }
  syncNavigationLabels();
}
function initializeNavigationState() {
  let saved;
  try { saved = localStorage.getItem(navStorageKey); } catch {}
  navPreferenceStored = saved === "collapsed" || saved === "expanded";
  setNavCollapsed(navPreferenceStored ? saved === "collapsed" : window.innerWidth < 1200, false);
  $("#app-shell")?.setAttribute("data-mobile-nav", "closed");
}
function closeMobileNav() {
  const shell = $("#app-shell");
  if (shell?.dataset.mobileNav !== "open") return;
  shell.dataset.mobileNav = "closed";
  $("#mobile-nav-toggle")?.setAttribute("aria-expanded", "false");
  const scrim = $("#sidebar-scrim");
  if (scrim) scrim.hidden = true;
  mobileNavReleaseTrap?.();
  mobileNavReleaseTrap = undefined;
  mobileNavReleaseScroll?.();
  mobileNavReleaseScroll = undefined;
  syncNavigationLabels();
}
function openMobileNav() {
  if (window.innerWidth >= 768) return;
  const shell = $("#app-shell");
  const sidebar = $("#primary-sidebar");
  if (!shell || !sidebar || shell.dataset.mobileNav === "open") return;
  shell.dataset.mobileNav = "open";
  $("#mobile-nav-toggle")?.setAttribute("aria-expanded", "true");
  const scrim = $("#sidebar-scrim");
  if (scrim) scrim.hidden = false;
  mobileNavReleaseScroll = lockBodyScroll("nav-open");
  mobileNavReleaseTrap = trapFocus(sidebar, { initial: 'a[data-route]', onEscape: closeMobileNav });
  syncNavigationLabels();
}
function setTopbarMoreOpen(open) {
  const preferences = $(".topbar-preferences");
  const toggle = $("#topbar-more-toggle");
  if (!preferences || !toggle) return;
  preferences.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
}
function closeTopbarMore() { setTopbarMoreOpen(false); }
function bindNavigationControls() {
  $("#sidebar-collapse")?.addEventListener("click", () => {
    setNavCollapsed($("#app-shell")?.dataset.nav !== "collapsed");
  });
  $("#mobile-nav-toggle")?.addEventListener("click", () => {
    if ($("#app-shell")?.dataset.mobileNav === "open") closeMobileNav();
    else openMobileNav();
  });
  $("#sidebar-scrim")?.addEventListener("click", closeMobileNav);
  $("#topbar-more-toggle")?.addEventListener("click", () => {
    const expanded = $("#topbar-more-toggle").getAttribute("aria-expanded") === "true";
    setTopbarMoreOpen(!expanded);
  });
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".topbar-preferences")) closeTopbarMore();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTopbarMore();
  });
  window.addEventListener("resize", () => {
    if (!navPreferenceStored) setNavCollapsed(window.innerWidth < 1200, false);
    if (window.innerWidth >= 768) closeMobileNav();
    if (window.innerWidth > 767) closeTopbarMore();
  });
}
// Run actions are rendered with the response that created the run. Keeping the
// run ID in the result avoids deriving control state from human-readable text.
async function init() {
  beginPageRequest();
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  let savedTheme = "light";
  try { savedTheme = localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light"; } catch {}
  applySiteTheme(savedTheme, false);
  let savedMode = "normal";
  try { savedMode = localStorage.getItem("ogs.product-mode") === "professional" ? "professional" : "normal"; } catch {}
  setProductMode(savedMode, false);
  initializeNavigationState();
  bindNavigationControls();
  const response = await pageFetch("/api/v1/cases"); if (!response.ok) throw new Error("Unable to load team cases.");
  const payload = await response.json();
  state.cases = payload.cases || [];
  state.eventLabels = payload.eventLabels || {};
  router.install();
  $("#locale-toggle")?.addEventListener("click", () => { state.locale = state.locale === "zh-CN" ? "en" : "zh-CN"; try { localStorage.setItem("ogs-locale", state.locale); } catch {} applyLocale(); });
  $$('[data-site-theme-choice]').forEach((button) => button.addEventListener("click", () => applySiteTheme(button.dataset.siteThemeChoice)));
  $("#site-theme-toggle")?.addEventListener("click", () => applySiteTheme(document.documentElement.dataset.visualizerTheme === "dark" ? "light" : "dark"));
  $("#product-mode-toggle")?.addEventListener("click", () => setProductMode(document.documentElement.dataset.productMode === "professional" ? "normal" : "professional"));
  applyLocale();
}
export { openTaskReview, mountTeamIrRunReviews };

export function bootstrap() {
  return init().catch((error) => { document.body.innerHTML = `<main class="fatal-error">${esc(error.message)}</main>`; });
}
