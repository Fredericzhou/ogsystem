import { state, beginPageRequest, isCurrentRequest, isAbort, setDirty, clearDirty, isDirty } from "../state.js";
import { pageFetch } from "../api.js";
import { $, $$, esc, icon } from "../components/dom.js";
import { pageFrame, frameExistingPage } from "../components/page-frame.js";
import { bindDirtyForm, confirmAction, lockBodyScroll, trapFocus } from "../components/interaction.js";
import { createRunPoller, isTerminalRunStatus } from "../components/run-poll.js";
import { labelEvent as localizedEventLabel, taskExample, text } from "../i18n.js";
import { createRouter } from "../router.js";
import { renderSharedResourcePage } from "./shared-resources.js";
import { renderPlatformRoleSources } from "./platform-role-sources.js";
import { createFloatingPanelController } from "../components/floating-panel.js";
import { renderBackendIcon, formatBackendStatusBadge, resolveBackendIconEntry } from "../components/backend-icon.js";
import { createStudioTranscriptTools } from "../components/studio-transcript.js";
import { calculateSafeTransitionBudget } from "../safe-transition-budget.js";
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
  const withTeamFlowPresentation = (value, previousAuthoring = value.authoring, previousViewModel = value.viewModel) => {
    if (value.mode !== "product-edit" || !value.authoring) return value;
    const previousEdges = previousViewModel?.edges || [];
    const previousEdgeById = new Map(previousEdges.map((edge) => [edge.id, edge]));
    const previousLabelByEvent = new Map();
    for (const edge of previousEdges) {
      if (edge.label && edge.label !== edge.eventType && !previousLabelByEvent.has(edge.eventType)) {
        previousLabelByEvent.set(edge.eventType, edge.label);
      }
    }
    const edgeLabels = Object.fromEntries(Object.values(value.authoring.flows || {}).flatMap((flow) => {
      const flowId = typeof flow.flowId === "string" ? flow.flowId : "";
      if (!flowId) return [];
      const previous = previousEdgeById.get(flowId);
      const isSameEvent = previous ? previous.eventType === flow.eventType : true;
      const previousPresentationLabel = isSameEvent ? value.presentation?.edgeLabels?.[flowId] : "";
      const label = flow.label?.trim()
        || (isSameEvent ? previous?.label : "")
        || previousPresentationLabel
        || (isSameEvent ? previousLabelByEvent.get(flow.eventType) : "")
        || localizedEventLabel(flow.eventType, copy);
      return [[flowId, label]];
    }));
    return { ...value, presentation: { ...value.presentation, edgeLabels } };
  };
  let currentOptions = withTeamFlowPresentation({ ...options });
  mount(root, currentOptions);
  mountedStudioGraphs.add(root);
  return Object.freeze({
    update(changes) {
      const previousOptions = currentOptions;
      currentOptions = withTeamFlowPresentation(
        { ...previousOptions, ...changes },
        previousOptions.authoring,
        previousOptions.viewModel
      );
      mount(root, currentOptions);
    },
    setRuntimeProgress(events) {
      window.OGSStudioGraphBundle?.setStudioX6RuntimeProgress?.(root, events);
    },
    focusRuntimeHandoff(handoffId) {
      window.OGSStudioGraphBundle?.focusStudioX6RuntimeHandoff?.(root, handoffId);
    },
    focusRoleNode(roleId) {
      return window.OGSStudioGraphBundle?.focusStudioX6Node?.(root, roleId);
    },
    fitViewport() {
      return window.OGSStudioGraphBundle?.fitStudioX6Viewport?.(root);
    }
  });
}
function disposeStudioGraphs() {
  const dispose = window.OGSStudioGraphBundle?.disposeStudioX6Bridge;
  for (const stage of mountedStudioGraphs) {
    dispose?.(stage);
    const graphRegion = stage.closest(".project-graph-preview, .detail-graph-section");
    if (graphRegion) graphRegion.remove();
    else stage.remove();
  }
  mountedStudioGraphs.clear();
}
function trackStudioGraphRoot(root) { if (root) mountedStudioGraphs.add(root); }
function professionalWorkspaceUrl(projectId, runId = "") {
  if (!projectId || !runId) return "";
  return `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`;
}
const themeStorageKey = "ogs.visualizer.theme";
const navStorageKey = "ogs.team-site.nav-state";
let navPreferenceStored = false;
let mobileNavReleaseTrap;
let mobileNavReleaseScroll;
const copy = { "zh-CN": {}, en: {} };
let copyLoad;
async function loadCopy() {
  if (!copyLoad) {
    copyLoad = pageFetch("/app/i18n.json").then(async (response) => {
      if (!response.ok) throw new Error("Unable to load the application language dictionary.");
      const payload = await response.json();
      Object.assign(copy["zh-CN"], payload["zh-CN"] || {});
      Object.assign(copy.en, payload.en || {});
    });
  }
  await copyLoad;
}
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

function labelEvent(event) { return localizedEventLabel(event, copy); }

function renderPageFrame(root, template, renderPromise) {
  const route = location.pathname;
  const isStudioCreate = route === "/studio/new";
  const studioWorkspace = route.match(/^\/studio\/teams\/([a-z0-9-]+)\/(info|design|run|release)(?:\/[a-z0-9-]+)?$/);
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
function renderCases() {
  const library = $("#library-grid");
  if (library) library.innerHTML = state.cases.map((item) => `<article class="library-card" data-accent="${esc(item.accent)}"><a class="case-card-link" href="/cases/${esc(item.id)}" data-route="/cases/${esc(item.id)}">${caseIcon(item)}<span class="case-card-category">${esc(text(item.category))}</span><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><span class="case-more">${esc(copy[state.locale].openCase)}</span></a></article>`).join("");
  const landingGrid = $("#landing-case-grid");
  if (landingGrid) landingGrid.innerHTML = state.cases.map((item) => `<article class="landing-case-card" data-accent="${esc(item.accent)}"><a class="case-card-link" href="/cases/${esc(item.id)}" data-route="/cases/${esc(item.id)}">${caseIcon(item)}<span class="case-card-category">${esc(text(item.category))}</span><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><div class="case-mini-graph" aria-hidden="true"><span></span><i></i><i></i><i></i><b></b></div><span class="case-more">${esc(copy[state.locale].openCase)}</span></a></article>`).join("");
  const caseGrid = $("#case-grid");
  if (caseGrid) caseGrid.innerHTML = state.cases.map((item) => `<button class="case-card ${item.id === state.selected ? "selected" : ""}" data-case="${esc(item.id)}" data-accent="${esc(item.accent)}" type="button">${caseIcon(item)}<span class="case-selected">${item.id === state.selected ? esc(copy[state.locale].selected) : esc(text(item.category))}</span><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><span class="case-card-foot">${esc(text(item.duration))}</span></button>`).join("");
  $$('[data-case]').forEach((button) => button.addEventListener("click", () => selectCase(button.dataset.case)));
  if ($("#examples-view")) frameExistingPage($("#examples-view"), "A");
}
function renderSelected(item) {
  if (!item) return;
  $("#selected-case-title").textContent = text(item.title);
  $("#selected-case-description").textContent = text(item.short);
  $("#role-count").textContent = item.roles.length;
  $("#member-list").innerHTML = item.roles.map((role, index) => `<div class="member-row"><span class="member-avatar member-avatar-${index % 3}">${esc(icon[item.icon] || "✦")}</span><div><div class="member-name">${esc(text(role.label))}</div><div class="member-role">${esc(text(role.description))}</div></div><span class="member-status">${esc(copy[state.locale].roleReady)}</span></div>`).join("");
  renderGraph(item);
}
async function renderGraph(item) {
  const stage = $("#graph-stage");
  if (!stage) return;
  trackStudioGraphRoot(stage);
  stage.dataset.case = item.id;
  stage.setAttribute("aria-label", state.locale === "zh-CN" ? `${text(item.title)}协作关系图` : `${text(item.title)} team relationship diagram`);
  $(".graph-foot span[data-i18n='splitNote']").textContent = text(item.detail.relationship);
  try {
    await ensureStudioGraphBundle();
    const response = await pageFetch(`/api/v1/cases/${encodeURIComponent(item.id)}/graph?locale=${encodeURIComponent(state.locale)}`);
    const viewModel = await response.json();
    if (!response.ok) throw new Error(viewModel.error || "Unable to load the team graph.");
    if (state.selected !== item.id) return;
    mountStudioGraph(stage, {
      viewModel,
      readOnly: true,
      showTopologyOrder: false,
      showTechnicalDetails: false,
      initialLayoutMode: "flow",
      defaultAutoLayout: true,
      defaultAutoLayoutRequestId: 1,
      labels: graphLabels[state.locale],
      onToggleFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await stage.requestFullscreen();
      }
    });
  } catch (error) { if (isAbort(error)) return;
    stage.textContent = error.message || "Unable to load the team graph.";
  }
}

const graphLabels = {
  "zh-CN": {
    viewportGroup: "图谱视图", editGroup: "编辑图谱", teamConfiguration: "配置", connectFromSelectedRole: "从已选角色的输出链接桩拖到目标角色，创建关系。", zoomOut: "缩小", zoomIn: "放大", resetView: "重置缩放", fullscreen: "全屏", fitView: "适应画布", autoLayout: "自动布局", layoutModeFlow: "流程布局", layoutModeCompact: "紧凑布局", layoutModeStacked: "分层布局", topologyOrder: "流转顺序", enabled: "开启", disabled: "关闭", layoutSwitched: "已切换为{layout}布局", generate: "AI构建", debugRun: "调试", close: "关闭", debugRunShort: "调试", quickOpen: "快速定位", quickOpenPlaceholder: "搜索角色或协作关系", quickOpenEmpty: "没有匹配的角色或协作关系。", quickOpenRole: "角色", quickOpenFlow: "协作关系", contextEditRole: "编辑角色", contextEditFlow: "编辑关系", contextInsertRole: "插入角色", contextDelete: "删除", minimap: "图谱导航", addRole: "新增角色", addEdge: "新增关系", editSelection: "编辑所选", editRole: "编辑角色", editEdge: "编辑关系", deleteSelection: "删除所选", undo: "撤销", redo: "重做", validateWorkbench: "校验", saveWorkbench: "保存", ready: "就绪", graphUnavailable: "图谱不可用", graphReady: "图谱已载入", fixMermaidBeforeGraphEditing: "请先修复结构诊断，再编辑图谱。", noRolesAvailable: "请先选择角色，再新增关系。", selectRoleBeforeAddingEdge: "请先选择角色，再新增关系。", invalidConnection: "无效的团队关系。", entryRoleDeletionBlocked: "不能删除入口角色。", invalidEdgeEndpoints: "关系端点无效。", duplicateRoleId: "角色 ID 已存在。", invalidRoleId: "角色 ID 必须以字母开头，只能使用字母、数字、下划线或连字符。", duplicateEdge: "该关系已存在。", invalidEventType: "事件类型必须使用大写字母。", deleteRoleConfirm: "确定删除角色 {roleId} 吗？", editBlocked: "结构校验通过后才能编辑图谱。", exportPng: "导出 PNG", boundaryEntry: "开始", boundaryEnd: "结束"
  },
  en: {
    viewportGroup: "Graph view", editGroup: "Edit graph", teamConfiguration: "Configuration", connectFromSelectedRole: "Drag from the selected role’s output port to a target role to create a relationship.", zoomOut: "Zoom out", zoomIn: "Zoom in", resetView: "Reset zoom", fullscreen: "Fullscreen", fitView: "Fit graph", autoLayout: "Auto layout", layoutModeFlow: "Flow layout", layoutModeCompact: "Compact layout", layoutModeStacked: "Layered layout", topologyOrder: "Flow order", enabled: "On", disabled: "Off", layoutSwitched: "Switched to {layout} layout", generate: "AI Build", debugRun: "Debug", close: "Close", debugRunShort: "Debug", quickOpen: "Quick locate", quickOpenPlaceholder: "Search roles or relationships", quickOpenEmpty: "No matching roles or relationships.", quickOpenRole: "Role", quickOpenFlow: "Relationship", contextEditRole: "Edit role", contextEditFlow: "Edit relationship", contextInsertRole: "Insert role", contextDelete: "Delete", minimap: "Graph navigator", addRole: "Add role", addEdge: "Add relationship", editSelection: "Edit selected", editRole: "Edit role", editEdge: "Edit relationship", deleteSelection: "Delete selected", undo: "Undo", redo: "Undo", validateWorkbench: "Validate", saveWorkbench: "Save", ready: "Ready", graphUnavailable: "Graph unavailable", graphReady: "Graph loaded", fixMermaidBeforeGraphEditing: "Fix the structure diagnostics before editing the graph.", noRolesAvailable: "Select a role before adding a relationship.", selectRoleBeforeAddingEdge: "Select a role before adding a relationship.", invalidConnection: "Invalid team relationship.", entryRoleDeletionBlocked: "The entry role cannot be deleted.", invalidEdgeEndpoints: "Relationship endpoints are invalid.", duplicateRoleId: "Role ID already exists.", invalidEventType: "Event type must use uppercase letters.", deleteRoleConfirm: "Delete role {roleId}?", editBlocked: "Pass structure validation before editing the graph.", exportPng: "Export PNG", boundaryEntry: "Start", boundaryEnd: "End"
  }
};
graphLabels.en.redo = "Redo";
graphLabels.en.entryRoleDeletionBlocked = "Remove this role's connection from Start before deleting it.";
graphLabels["zh-CN"].entryRoleDeletionBlocked = "请先移除此角色与开始节点的连线，再删除角色。";
graphLabels.en.quickOpenPlaceholder = "Search roles or transitions";
graphLabels.en.quickOpenEmpty = "No matching roles or transitions.";
graphLabels.en.quickOpenFlow = "Transition";
graphLabels.en.contextEditFlow = "Edit transition";
graphLabels.en.addEdge = "Add transition";
graphLabels.en.editEdge = "Edit transition";
graphLabels.en.connectFromSelectedRole = "Drag from a role's output port to another role to create a transition.";
graphLabels["zh-CN"].quickOpenPlaceholder = "搜索角色或流转";
graphLabels["zh-CN"].quickOpenEmpty = "没有匹配的角色或流转。";
graphLabels["zh-CN"].quickOpenFlow = "流转";
graphLabels["zh-CN"].contextEditFlow = "编辑流转";
graphLabels["zh-CN"].addEdge = "新增流转";
graphLabels["zh-CN"].editEdge = "编辑流转";
graphLabels["zh-CN"].connectFromSelectedRole = "从已选角色的输出端口拖到目标角色，创建流转。";
graphLabels["zh-CN"].technicalDetails = "流转编号";
graphLabels.en.technicalDetails = "Flow number";
const graphFormLabels = {
  "zh-CN": {
    roleDialogTitle: "新增角色", edgeDialogTitle: "新增关系", editRoleDialogTitle: "编辑角色", editEdgeDialogTitle: "编辑关系", repositoryRole: "角色库", customRole: "自定义角色", rolePackage: "角色包", rolePackageSource: "从已安装的角色库导入", roleId: "角色 ID", title: "显示名称", bindingKind: "绑定方式", modelRef: "模型", profileId: "执行配置", existingProfile: "复用已有执行配置", createProfile: "创建项目执行配置", newProfileId: "生成的配置 ID", newProfileToolRef: "工具", newProfileTimeoutMs: "超时毫秒数", newProfileMaxOutputBytes: "最大输出字节数", sourceRole: "起始角色", targetRole: "目标角色", flowLabel: "关系名称", eventType: "事件类型", runtimeOnlyErrorFlow: "运行时错误关系", participatesInJoin: "参与汇总", cancel: "取消", create: "创建", save: "保存", noRepositoryRoles: "暂无角色库角色", noModels: "暂无模型", noProfiles: "暂无执行配置", noTools: "暂无工具", outputTarget: "成果"
  },
  en: {
    roleDialogTitle: "Add role", edgeDialogTitle: "Add relationship", editRoleDialogTitle: "Edit role", editEdgeDialogTitle: "Edit relationship", repositoryRole: "Role library", customRole: "Custom role", rolePackage: "Role package", rolePackageSource: "Import from the installed role library", roleId: "Role ID", title: "Display name", bindingKind: "Binding", modelRef: "Model", profileId: "Execution profile", existingProfile: "Reuse existing execution config", createProfile: "Create project execution config", newProfileId: "Generated profile ID", newProfileToolRef: "Tool", newProfileTimeoutMs: "Timeout in milliseconds", newProfileMaxOutputBytes: "Maximum output bytes", sourceRole: "Source role", targetRole: "Target role", flowLabel: "Relationship name", eventType: "Event type", runtimeOnlyErrorFlow: "Runtime error relationship", participatesInJoin: "Participates in join", cancel: "Cancel", create: "Create", save: "Save", noRepositoryRoles: "No role library entries", noModels: "No models", noProfiles: "No execution profiles", noTools: "No tools", outputTarget: "Outcome"
  }
};
graphFormLabels.en.edgeDialogTitle = "Add transition";
graphFormLabels.en.editEdgeDialogTitle = "Edit transition";
graphFormLabels.en.flowLabel = "Transition name";
graphFormLabels["zh-CN"].edgeDialogTitle = "新增流转";
graphFormLabels["zh-CN"].editEdgeDialogTitle = "编辑流转";
graphFormLabels["zh-CN"].flowLabel = "流转名称";
function selectCase(caseId) {
  const item = state.cases.find((entry) => entry.id === caseId);
  if (!item) return;
  state.selected = caseId;
  renderSelected(item);
  renderCases();
  const input = $("#task-input");
  if (!input.value.trim()) input.value = taskExample(item);
  updateCount();
}
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
  if (stage) trackStudioGraphRoot(stage);
  try {
    await ensureStudioGraphBundle();
    if (!stage?.isConnected || !window.OGSStudioGraphBundle?.mountStudioX6Bridge) return;
    const response = await pageFetch("/api/v1/cases/" + encodeURIComponent(item.id) + "/graph?locale=" + encodeURIComponent(state.locale));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load the team graph.");
    if (!stage.isConnected) return;
    mountStudioGraph(stage, {
      viewModel: payload,
      readOnly: true,
      showTopologyOrder: false,
      showTechnicalDetails: false,
      initialLayoutMode: "flow",
      defaultAutoLayout: true,
      defaultAutoLayoutRequestId: 1,
      labels: graphLabels[state.locale],
      onToggleFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await stage.requestFullscreen();
      }
    });
  } catch (error) { if (isAbort(error)) return;
    stage.textContent = error.message || "Unable to load the team graph.";
  }
}

async function createProjectFromCase(caseId, action, button) {
  if (button) button.disabled = true;
  try {
    const response = await pageFetch("/api/v1/cases/" + encodeURIComponent(caseId) + "/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法创建团队。");
    navigate(action === "use" ? "/projects/new?team=" + encodeURIComponent(payload.projectId) : "/studio/teams/" + encodeURIComponent(payload.projectId) + "/design");
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
  $("#landing-locale")?.replaceChildren(document.createTextNode(state.locale === "zh-CN" ? "EN" : "中文"));
  syncNavigationLabels();
  syncThemeControls();
  setProductMode(document.documentElement.dataset.productMode || "normal", false);
  const projectRoute = isProjectRoute();
  if (!projectRoute) {
    renderCases();
    if ($("#graph-stage")) renderSelected(state.cases.find((item) => item.id === state.selected));
  }
  renderHistory();
  syncRoute();
}
function updateCount() {
  const input = $("#task-input");
  const count = $("#input-count");
  if (input && count) count.textContent = input.value.length;
}
function isProjectRoute() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (path === "/") return false;
  return path === "/teams"
    || path === "/studio"
    || path === "/studio/roles"
    || /^\/studio\/teams\/[a-z0-9-]+\/(info|run|release|design)$/.test(path)
    || /^\/studio\/teams\/[a-z0-9-]+\/run\/[a-z0-9-]+\/artifacts$/.test(path)
    || /^\/studio\/teams\/[a-z0-9-]+\/run\/[a-z0-9-]+$/.test(path)
    || /^\/studio\/teams\/[a-z0-9-]+\/release$/.test(path)
    || /^\/studio\/teams\/[a-z0-9-]+\/design$/.test(path)
    || path === "/projects"
    || path === "/platform"
    || path === "/platform/models"
    || path === "/platform/role-sources"
    || path === "/projects/new"
    || path === "/studio/new"
    || /^\/projects\/[a-z0-9-]+\/runs\/[A-Za-z0-9._-]+$/.test(path)
    || /^\/projects\/[a-z0-9-]+(?:\/teams)?$/.test(path);
}

const viewShells = {
  "workspace-view": "",
  "case-detail-view": "",
  "new-project-view": "",
  "project-workspace-view": "",
  "history-view": '<section class="page-frame" data-template="A" data-fit><header class="page-frame-header project-library-toolbar page-heading"><div class="repository-heading"><h1 data-i18n="historyTitle">项目运行历史</h1><p data-i18n="historyIntro">按项目轮次查看团队执行记录与审计证据。</p></div><div class="project-library-filters repository-actions"><button class="secondary-button" id="clear-history" type="button" data-i18n="clearHistory">清理本机记录</button></div></header><div class="page-frame-body" data-layout-scroll><div id="history-list" class="history-list"></div></div></section>',
  "examples-view": '<div class="page-heading"><div><div class="eyebrow" data-i18n="libraryEyebrow">典型团队协作案例</div><h1 data-i18n="libraryTitle">团队协作案例</h1><p data-i18n="libraryIntro">浏览不同协作场景的背景、分工和预期成果。</p></div></div><div id="library-grid" class="library-grid"></div>',
  "studio-view": "",
  "projects-view": "",
  "platform-view": ""
};

function ensureViewElements() {
  const main = document.querySelector(".main-area");
  if (!main) return;
  for (const [id, html] of Object.entries(viewShells)) {
    if (document.getElementById(id)) continue;
    const view = document.createElement("div");
    view.id = id;
    view.className = "page-content alternate-view hidden";
    if (id === "history-view") view.dataset.template = "A";
    if (html) view.innerHTML = html;
    main.append(view);
  }
}

function setView(view) {
  state.view = view;
  const viewMap = { projects: "projects-view", workspace: "workspace-view", studio: "studio-view", platform: "platform-view", examples: "examples-view", history: "history-view", "new-project": "new-project-view", "project-workspace": "project-workspace-view" };
  Object.entries(viewMap).forEach(([key, id]) => document.getElementById(id)?.classList.toggle("hidden", key !== view));
  $("#case-detail-view")?.classList.add("hidden");
  const activeView = state.studioRoute ? (location.pathname === "/studio/new" ? "studio-create" : location.pathname === "/studio/roles" ? "studio-roles" : "studio") : view;
  $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView && !(activeView === "platform" && button.getAttribute("href") !== location.pathname)));
  $("#breadcrumb-current").textContent = primaryNavigationLabel(location.pathname);
}

function primaryNavigationLabel(path = location.pathname) {
  const labels = state.locale === "en"
    ? { home: "Home", collaboration: "Business collaboration", engineering: "Team engineering", platform: "Platform settings" }
    : { home: "首页", collaboration: "业务协作", engineering: "团队工程", platform: "平台配置" };
  const normalized = String(path || "/").replace(/\/$/, "") || "/";
  if (normalized === "/") return labels.home;
  if (normalized === "/platform" || normalized.startsWith("/platform/")) return labels.platform;
  if (normalized === "/studio" || normalized.startsWith("/studio/") || normalized === "/teams") return labels.engineering;
  if (normalized === "/projects" || normalized.startsWith("/projects/") || normalized === "/history") return labels.collaboration;
  return labels.collaboration;
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
async function renderNewProject() {
  const root = $("#new-project-view");
  const english = state.locale === "en";
  const t = (en, zh) => english ? en : zh;
  root.innerHTML = `<section class="page-heading new-team-heading"><div><a class="detail-back" href="/teams" data-route="/teams">← ${t("Team repository", "团队仓库")}</a><div class="eyebrow">Team Studio · ${t("Create", "创建")}</div><h1>${t("Describe the team’s goal", "先说清团队要完成什么")}</h1><p>${t("The assistant will turn your goal into a design that you can review and refine.", "提交目标后，团队助手会先整理你的意图，再通过对话完善职责、协作关系和交付结果。")}</p></div></section><section class="project-builder new-team-builder"><form id="new-project-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">${t("Team design", "团队设计")}</span><h2>${t("What should this team accomplish?", "你希望团队完成什么？")}</h2><p>${t("Start with the goal. Refine the name, roles, and workflow in the design workspace.", "从目标开始，创建后可在设计工作区调整名称、角色和协作结构。")}</p></div><label>${t("Team name", "团队名称")}<input name="name" required maxlength="120" autocomplete="organization" placeholder="${t("For example: Product research team", "例如：产品研究团队")}"></label><label>${t("Team goal", "团队目标")}<textarea name="overview" required maxlength="4000" rows="6" placeholder="${t("For example: compare competitor research and produce evidence-based recommendations; researchers collect sources, analysts compare findings, and a lead reviews the result.", "例如：目标是分析竞品资料并提出行动建议；研究员负责资料整理，分析员负责比较，负责人汇总并审核；流程为收集材料、独立分析、汇总审核；输入包括竞品文档，输出为带依据的建议清单。")}"></textarea><small class="field-hint">${esc(copy[state.locale].targetHint)}</small></label><div class="new-team-form-footer"><p class="form-hint">${t("After creation, refine roles, workflow, and output requirements with the assistant.", "创建后可继续用自然语言调整角色、流程和输出要求。")}</p><div class="form-actions"><button class="primary-button" type="submit">${t("Create team", "创建团队")} <span aria-hidden="true">→</span></button></div></div><p class="form-status" id="new-project-status" role="status" aria-live="polite"></p></form></section>`;
  const studioCreateBack = root.querySelector(".new-team-heading .detail-back");
  const createIntro = root.querySelector(".new-team-heading p");
  if (createIntro) createIntro.textContent = t("Describe the goal, then refine the team design before release.", "描述团队目标，再完善设计并发布。");
  const createSectionLabel = root.querySelector(".new-team-form-heading .section-kicker");
  if (createSectionLabel) createSectionLabel.textContent = t("Team design", "团队设计");
  if (studioCreateBack) {
    studioCreateBack.href = "/studio";
    studioCreateBack.dataset.route = "/studio";
    studioCreateBack.textContent = state.locale === "en" ? "Back to OGS Studio" : "返回 OGS Studio";
  }
  const createDraftButton = root.querySelector("#new-project-form button[type=submit]");
  if (createDraftButton) createDraftButton.textContent = t("Create team", "创建团队");
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
      const response = await pageFetch("/api/v1/team-factory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), overview: form.get("overview"), locale: state.locale }) });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "项目创建失败");
      clearDirty("new-project-form");
      state.projectId = project.projectId;
      navigate("/studio/teams/" + encodeURIComponent(project.projectId) + "/design");
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

async function renderTeamAssistant(projectId, project, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  const root = $("#team-assistant");
  if (!root) return;
  let latestDesign;
  let latestDigest = project.projectDigest;
  let lastResponse;
  let sending = false;
  root.innerHTML = `<p class="panel-intro">团队目标已预填。发送后先生成结构预览，确认后才应用到草案。</p><div class="assistant-history" id="team-assistant-history"><div class="assistant-message"><strong>当前目标</strong><span>${esc(project.overview || "还没有填写团队目标")}</span></div><div class="assistant-message"><strong>可以这样说</strong><span>增加一个事实核查角色，并让最终结论都附上来源。</span></div></div><div class="assistant-choices"><button type="button" class="builder-choice" data-assistant-choice="按顺序接力完成任务，并在最后增加人工审核"><strong>增加审核</strong><span>在最终输出前检查质量</span></button><button type="button" class="builder-choice" data-assistant-choice="减少角色，优先保证运行速度和成本"><strong>减少角色</strong><span>让流程更短、更容易运行</span></button><button type="button" class="builder-choice" data-assistant-choice="为每个关键结论增加来源引用要求"><strong>增加来源</strong><span>让结果更容易核查</span></button></div><label class="assistant-input-label"><span>团队目标或调整要求</span><textarea id="team-assistant-input" rows="3" maxlength="4000" placeholder="例如：让研究员先分析，再让审核员检查事实依据">${esc(project.overview || "")}</textarea></label><div class="form-actions"><button class="primary-button" type="button" id="team-assistant-send">生成结构预览</button></div><p class="form-status" id="team-assistant-status" role="status" aria-live="polite"></p><div id="team-assistant-preview"></div>`;
  const assistantIntro = root.querySelector(".panel-intro");
  if (assistantIntro) assistantIntro.textContent = "团队目标已预填。发送后先生成结构预览，确认后才应用到团队设计。";
  try {
    const designResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/design`);
    latestDesign = await designResponse.json();
    latestDigest = latestDesign.saveSnapshotDigest || latestDesign.teamVersionDigest || latestDigest;
  } catch (error) { if (isAbort(error)) return;
    $("#team-assistant-status").textContent = error.message || "无法读取当前团队设计";
  }
  const addMessage = (label, content, kind = "assistant") => {
    $("#team-assistant-history")?.insertAdjacentHTML("beforeend", `<div class="assistant-message ${kind}"><strong>${esc(label)}</strong><span>${esc(content)}</span></div>`);
  };
  const send = async (message) => {
    const text = String(message || "").trim();
    if (!text) return;
    if (sending) return;
    const status = $("#team-assistant-status");
    const input = $("#team-assistant-input");
    const sendButton = $("#team-assistant-send");
    sending = true;
    if (sendButton) sendButton.disabled = true;
    input.value = text;
    addMessage("你", text, "user");
    status.textContent = "正在分析团队结构并生成预览…";
    try {
      const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, systemSource: latestDesign?.systemSource, authoring: latestDesign?.authoring }) });
      const payload = await response.json();
      const responseError = typeof payload.error === "string"
        ? payload.error
        : payload.error?.message || payload.error?.code || "团队助手暂时不可用";
      if (!response.ok) throw new Error(responseError);
      lastResponse = payload;
      addMessage("团队助手", payload.summary || payload.questions?.join("\n") || "已生成下一步建议。");
      const preview = $("#team-assistant-preview");
      const questions = (payload.questions || []).map((question) => `<button type="button" class="assistant-question" data-assistant-choice="${esc(question)}">${esc(question)}</button>`).join("");
      const patchReady = payload.authoringPatch?.authoring;
      if (patchReady) setDirty("team-assistant");
      const modeLabel = payload.mode === "draft" ? (state.locale === "en" ? "In design" : "设计中") : payload.mode || (state.locale === "en" ? "In design" : "设计中");
      preview.innerHTML = `<div class="assistant-preview"><div class="preview-list"><div><strong>当前状态</strong><span>${esc(modeLabel)}</span></div><div><strong>待确认问题</strong><span>${payload.unresolvedItems?.length || 0}</span></div></div>${payload.assumptions?.length ? `<p class="form-hint">假设：${esc(payload.assumptions.join("；"))}</p>` : ""}${questions ? `<div class="assistant-question-list">${questions}</div>` : ""}${patchReady ? '<div class="form-actions"><button type="button" class="primary-button" id="team-assistant-apply">应用到团队设计</button></div>' : ""}</div>`;
      preview.querySelectorAll("[data-assistant-choice]").forEach((button) => button.addEventListener("click", () => send(button.dataset.assistantChoice)));
      $("#team-assistant-apply")?.addEventListener("click", async (event) => {
        const patch = lastResponse?.authoringPatch?.authoring;
        if (!patch) return;
        const applyButton = event.currentTarget;
        applyButton.disabled = true;
        status.textContent = "正在保存团队设计…";
        try {
          const save = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/save`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ authoring: patch, expectedTeamVersionDigest: latestDigest }) });
          const saved = await save.json();
          if (!save.ok) throw new Error(saved.error || "团队设计保存失败");
          if (saved.createdDraft) {
            clearDirty("team-assistant");
            navigate(withCurrentSearch(`/studio/teams/${encodeURIComponent(saved.teamVersionId)}/design`));
            return;
          }
          latestDigest = saved.teamVersionDigest || latestDigest;
          latestDesign = saved;
          clearDirty("team-assistant");
          status.textContent = "修改已应用，团队处于设计中，请检查后发布。";
          await renderProjectStudio(projectId, pageRequest);
          state.teamStudioDialog?.("assistant");
          const refreshedStatus = $("#team-assistant-status");
          if (refreshedStatus) refreshedStatus.textContent = status.textContent;
        } catch (error) {
          if (isAbort(error)) return;
          status.textContent = error.message || "团队设计保存失败";
          applyButton.disabled = false;
        }
      });
      status.textContent = patchReady ? "预览已生成，确认后才会保存。" : "请回答团队助手的问题，继续完善团队。";
    } catch (error) { if (isAbort(error)) return;
      status.innerHTML = teamStudioErrorMarkup(error.message || "团队助手暂时不可用");
    } finally {
      sending = false;
      if (sendButton?.isConnected) sendButton.disabled = false;
    }
  };
  $("#team-assistant-send")?.addEventListener("click", () => send($("#team-assistant-input").value));
  $$("#team-assistant [data-assistant-choice]").forEach((button) => button.addEventListener("click", () => send(button.dataset.assistantChoice)));
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
        : `<a class="primary-button" href="/studio/teams/${id}/design" data-route="/studio/teams/${id}/design">${esc(copy[state.locale].continueEditing)}</a>`}${deleteButton}`;
  const statusClass = meta.displayStatus === "released" ? "released" : meta.displayStatus;
  return `<article class="team-version-card project-asset-surface" data-team-root-id="${esc(team.teamRootId || team.teamId || team.projectId)}" data-team-status="${esc(meta.displayStatus)}" data-team-builtin="${team.builtIn ? "true" : "false"}"><div class="asset-card-top"><span class="asset-mark">O</span><span class="status-chip ${esc(statusClass)}">${esc(meta.label)}</span></div><div class="asset-title-row"><h2>${title}</h2><span class="version-badge">${esc(meta.version)}</span></div><p>${esc(team.overview || "")}</p><div class="asset-card-meta"><span>${team.builtIn ? (state.locale === "en" ? "Built-in team" : "内置经典团队") : esc(meta.hint)}</span><span>${team.updatedAt ? new Date(team.updatedAt).toLocaleDateString(state.locale) : ""}</span></div><div class="asset-card-actions">${actions}</div></article>`;
}
function roleColorForId(roleId) {
  let hash = 2166136261;
  for (const character of String(roleId)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const hue = (hash >>> 0) % 360;
  const isDark = (typeof document !== "undefined" && document.documentElement.dataset.visualizerTheme === "dark")
    || (typeof state !== "undefined" && state.theme === "dark");
  return isDark
    ? { accent: `hsl(${hue} 78% 69%)`, fill: `hsl(${hue} 40% 17%)`, ink: `hsl(${hue} 60% 10%)` }
    : { accent: `hsl(${hue} 58% 30%)`, fill: `hsl(${hue} 42% 95%)`, ink: "#ffffff" };
}
function caseGraphThumbnail(item) {
  const roles = item.roles || [];
  const points = roles.map((role, index) => ({ role, x: 28 + (index % 4) * 102, y: 34 + Math.floor(index / 4) * 54 }));
  const pointById = new Map(points.map((point) => [point.role.id, point]));
  const edges = (item.flows || []).map((flow) => {
    const [from, to] = Array.isArray(flow) ? flow : [flow?.from, flow?.to];
    const source = pointById.get(from); const target = pointById.get(to);
    return source && target ? `<path d="M ${source.x + 25} ${source.y + 11} C ${(source.x + target.x) / 2} ${source.y + 11}, ${(source.x + target.x) / 2} ${target.y + 11}, ${target.x - 25} ${target.y - 11}" />` : "";
  }).join("");
  const nodes = points.map(({ role, x, y }) => { const color = roleColorForId(role.id); return `<g><rect x="${x - 25}" y="${y - 11}" width="50" height="22" rx="5" fill="${color.fill}" stroke="${color.accent}" /><text x="${x}" y="${y + 3}" fill="${color.accent}" text-anchor="middle">${esc(text(role.label)).slice(0, 8)}</text></g>`; }).join("");
  return `<svg class="team-graph-thumbnail" viewBox="0 0 360 128" aria-hidden="true"><g class="thumbnail-edges">${edges}</g><g class="thumbnail-nodes">${nodes}</g></svg>`;
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
        navigate(`/studio/teams/${encodeURIComponent(id)}/design?edit=1`);
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
  const importLabelText = () => { const label = root.querySelector(".import-project-button"); if (label?.firstChild) label.firstChild.textContent = "导入团队"; };
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">${esc(copy[state.locale].libraryEyebrow)}</div><h1>${esc(copy[state.locale].libraryTitle)}</h1><p>${esc(copy[state.locale].libraryIntro)}</p></div></section><section class="project-library-toolbar"><div><strong>${esc(copy[state.locale].releasedLabel)}</strong><span>${esc(copy[state.locale].repositoryEmptyHint)}</span></div><div class="project-library-filters repository-actions"><label><span class="sr-only">搜索团队</span><input id="project-library-search" type="search" placeholder="搜索团队名称或目标"></label><label class="secondary-button import-project-button">导入团队<input id="project-import-file" type="file" accept="application/json" hidden></label><a class="primary-button" href="/studio" data-route="/studio">${esc(copy[state.locale].createTeam)}</a></div></section><div id="project-library-grid" class="project-library-grid"><div class="project-loading">正在读取团队仓库...</div></div>`;
  importLabelText();
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
    $("#project-import-file")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.value = "";
      try {
        const bundle = JSON.parse(await file.text());
        const previewResponse = await pageFetch("/api/v1/team-packages/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bundle) });
        const preview = await previewResponse.json();
        if (!previewResponse.ok) throw new Error(preview.error || "导入预览失败");
        if (preview.duplicate) {
          showToast(`内容一致：团队“${preview.name}”已经存在，已取消重复导入。`);
          navigate(`/studio/teams/${encodeURIComponent(preview.duplicate.projectId)}/design`);
          return;
        }
        let teamName;
        if (preview.conflicts?.length) {
          teamName = window.prompt(`团队“${preview.name}”已存在，但内容不同。请输入新的团队名称后导入：`, `${preview.name}（导入）`)?.trim();
          if (!teamName) {
            showToast("未提供新的团队名称，已取消导入。");
            return;
          }
        }
        const imported = await pageFetch("/api/v1/team-packages/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...bundle, conflictStrategy: "reject", ...(teamName ? { teamName } : {}) }) });
        const result = await imported.json();
        if (!imported.ok) throw new Error(result.error || "导入失败");
        navigate(`/studio/teams/${encodeURIComponent(result.projectId)}/design`);
      } catch (error) { if (isAbort(error)) return; showToast(error.message || "导入失败"); }
    });
  } catch (error) { if (isAbort(error)) return; grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取团队仓库")}</div>`; }
}
async function renderCollaborationProjects() {
  const root = $("#projects-view");
  root.dataset.template = "A";
  root.innerHTML = `<section class="page-frame" data-template="A" data-fit><header class="page-frame-header project-library-toolbar page-heading"><div class="repository-heading"><h1>${state.locale === "en" ? "Collaboration projects" : "协作项目"}</h1><p>${state.locale === "en" ? "Manage project assets, task execution, and run delivery." : "统一管理项目资料、任务调度与运行交付。"}</p></div><div class="project-library-filters repository-actions"><label><span class="sr-only">${state.locale === "en" ? "Search projects" : "搜索项目"}</span><input id="project-library-search" type="search" placeholder="${state.locale === "en" ? "Search projects" : "搜索项目"}"></label><a class="primary-button" href="/projects/new" data-route="/projects/new">${state.locale === "en" ? "Create project" : "创建项目"}</a></div></header><div class="page-frame-body"><div id="collaboration-project-grid" class="project-library-grid" data-layout-scroll><div class="project-loading">${state.locale === "en" ? "Loading projects..." : "正在读取协作项目..."}</div></div></div></section>`;
  const grid = $("#collaboration-project-grid");
  const searchInput = $("#project-library-search");
  searchInput?.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    grid.querySelectorAll(".collaboration-project-card").forEach((card) => {
      const text = card.textContent.toLowerCase();
      card.classList.toggle("hidden", Boolean(query && !text.includes(query)));
    });
  });
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
  const isModels = location.pathname === "/platform/models" || location.pathname === "/platform";
  const title = isModels ? (state.locale === "en" ? "Model services" : "模型服务") : (state.locale === "en" ? "Platform settings" : "平台配置");
  const subtitle = state.locale === "en" ? "Manage execution runtime connectivity, credentials, and default model routes." : "配置运行底座连接状态、API 凭据与默认模型路由。";
  root.innerHTML = `<section class="project-library-toolbar page-heading"><div class="repository-heading"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="project-library-filters repository-actions"><button id="platform-discovery-refresh" class="secondary-button platform-action-button" type="button"><svg class="platform-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.8 10a7.5 7.5 0 0 1 12.7-3L20 9M4 17v-5h5m10.2 2a7.5 7.5 0 0 1-12.7 3L4 15"/></svg><span>${state.locale === "en" ? "Refresh" : "刷新"}</span></button></div></section><section class="platform-config-grid"><article class="project-panel platform-discovery-panel"><div class="panel-head"><div><span class="section-kicker">运行底座</span><h2>${state.locale === "en" ? "Discovered services" : "发现到的服务"}</h2></div></div><div id="platform-providers" class="platform-list" data-layout-scroll>正在读取...</div></article><article class="project-panel platform-discovery-panel"><div class="panel-head"><div><span class="section-kicker" id="platform-models-kicker">模型目录</span><h2>${state.locale === "en" ? "Discovered models" : "发现到的模型"}</h2></div><div class="platform-filter-toggle" role="group" aria-label="${state.locale === "en" ? "Model filter mode" : "模型列表过滤模式"}"><button type="button" class="filter-toggle-btn active" data-model-filter="service" data-touch-target-exempt>${state.locale === "en" ? "By service" : "按服务"}</button><button type="button" class="filter-toggle-btn" data-model-filter="available" data-touch-target-exempt>${state.locale === "en" ? "Available only" : "仅可用"}</button></div></div><div id="platform-models" class="platform-list" data-layout-scroll>正在读取...</div></article><article class="project-panel platform-settings-panel"><div class="panel-head"><div><span class="section-kicker">默认值</span><h2>执行设置</h2></div><p class="panel-note" id="platform-discovery-meta">正在读取探测时间...</p></div><form id="platform-settings-form" class="compact-form"><label>默认底座<select name="defaultProvider"><option value="codex">Codex</option><option value="opencode">OpenCode</option><option value="ollama">Ollama</option></select></label><label>默认模型<select name="defaultModel"><option value="default">自动选择</option></select></label><label><span>模型请求超时（秒）</span><input name="timeoutSeconds" type="number" min="10" max="604800" value="120" title="等待本次模型请求返回的最长时间；不限制整个任务的执行时长" aria-describedby="platform-timeout-help"><small id="platform-timeout-help" class="platform-field-hint">只计算单次模型请求等待返回的时间，不限制整个任务执行多久。超过后该次请求异常，可从任务记录重新处理。</small></label><label>失败重试次数<input name="retryCount" type="number" min="0" max="5" value="1"></label><button class="primary-button platform-action-button" type="submit"><svg class="platform-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l3 3v13H4V4zM8 4v6h8V4M8 20v-7h8v7"/></svg><span>保存</span></button><p class="form-status" id="platform-settings-status"></p><p class="form-status platform-runtime-status" id="platform-runtime-status" role="status" aria-live="polite"></p></form></article></section>`;
  const modelProbes = new Map();
  let discoverySnapshot;
  let selectedSettings;
  let modelFilterMode = "service";
  let selectedBackend = "";
  const timeoutHelp = root.querySelector("#platform-timeout-help");
  if (timeoutHelp) timeoutHelp.textContent = "单次请求最长等待时间，不限制任务时长；超时后可从运行记录重试。";
  const capabilityLabels = (capabilities = {}) => [capabilities.textInput && "文本输入", capabilities.textOutput && "文本输出", capabilities.toolcall && "工具调用"].filter(Boolean);
  const sourceDetail = (item) => {
    const status = String(item.status || "");
    const detail = String(item.detail || "");
    if (status === "checking") return "正在检查 CLI、协议和模型目录";
    if (status === "not_installed" || /not found|missing|not installed/i.test(detail)) return "未安装该运行底座，安装后刷新即可识别";
    if (status === "service_unavailable") return "已检测到本地 CLI，但后台服务未启动或无法连接";
    if (status === "installed_but_broken") return "已检测到本地安装，但健康检查或目录探测异常";
    if (status === "unavailable") return "已检测到本地 CLI，协议适配尚未开放运行";
    if (status === "runnable") return detail || "运行底座已就绪，可通过实际请求探测模型可用性";
    return detail || "已完成自动检查";
  };
  const formatDiscoveryTime = (value) => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "时间未知" : date.toLocaleString(state.locale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }); };
  const probeKeyForModel = (item) => `${item.backend}:${item.modelId}`;
  const checkingSource = (item) => ({ ...item, status: item.status || "checking" });
  const mergeBackendDiscovery = (snapshot, backendPayload) => {
    const source = backendPayload?.source || backendPayload?.sources?.[0];
    const sources = (snapshot.sources || []).filter((item) => item.backend !== source?.backend);
    if (source) sources.push(source);
    const models = (snapshot.models || []).filter((item) => item.backend !== source?.backend);
    models.push(...(backendPayload?.models || []));
    return { ...snapshot, sources, models, generatedAt: backendPayload?.generatedAt || snapshot.generatedAt, discoveryPending: false };
  };
  const discoverBackendsIncrementally = async ({ forceRefresh = false, settings, initial } = {}) => {
    const backendResponse = await pageFetch("/api/v1/platform/backends");
    const backendPayload = await backendResponse.json();
    if (!backendResponse.ok) throw new Error(backendPayload.error || "无法读取运行底座");
    let snapshot = { generatedAt: new Date().toISOString(), sources: (backendPayload.backends || []).map(checkingSource), models: [], discoveryPending: true };
    renderDiscovery(snapshot, settings);
    const discoverOne = async (backend) => {
      // A slow CLI must remain visibly checking without holding the other
      // backends behind repeated server-side timeout windows.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await pageFetch(`/api/v1/platform/backends/${encodeURIComponent(backend.backend)}/discovery${forceRefresh ? "?refresh=1" : ""}`);
        const payload = await response.json();
        if (response.status !== 202) return { response, payload };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return {
        response: { ok: true },
        payload: {
          source: {
            ...backend,
            status: "checking",
            detail: "底座检测仍在进行，请稍后刷新"
          },
          models: [],
          discoveryPending: false
        }
      };
    };
    await Promise.all((backendPayload.backends || []).map(async (backend) => {
      try {
        const { response, payload } = await discoverOne(backend);
        if (!response.ok) throw new Error(payload.error || "底座探测失败");
        snapshot = mergeBackendDiscovery(snapshot, payload);
      } catch (error) {
        if (isAbort(error)) return;
        snapshot = mergeBackendDiscovery(snapshot, { source: { ...backend, status: "installed_but_broken", detail: error.message || "底座探测失败" }, models: [] });
      }
      renderDiscovery(snapshot, settings);
    }));
    snapshot.discoveryPending = false;
    renderDiscovery(snapshot, settings);
    return snapshot;
  };
  const renderDiscovery = (discovery, settings) => {
    discoverySnapshot = discovery;
    selectedSettings = settings;
    const providers = discovery.sources || [];
    const models = discovery.models || [];
    const sourceByBackend = new Map(providers.map((item) => [item.backend, item]));

    if (!selectedBackend || !providers.some((item) => item.backend === selectedBackend)) {
      const firstRunnable = providers.find((item) => item.status === "runnable")?.backend;
      selectedBackend = firstRunnable || providers[0]?.backend || "";
    }

    $("#platform-providers").innerHTML = providers.length ? providers.map((item) => {
      const badge = formatBackendStatusBadge(item.status, state.locale);
      const displayName = item.displayName || resolveBackendIconEntry(item.backend).displayName;
      const isSelected = modelFilterMode === "service" && item.backend === selectedBackend;
      return `<div class="platform-source-row is-clickable${isSelected ? " is-selected" : ""}" data-backend="${esc(item.backend)}" tabindex="0" role="button" aria-selected="${isSelected ? "true" : "false"}">${renderBackendIcon(item.backend, { iconKey: item.iconKey, displayName, status: item.status, size: 24 })}<div class="platform-row-main"><div class="platform-row-title"><strong>${esc(displayName)}</strong><span class="backend-id-pill">${esc(item.backend)}</span><span class="status-chip ${esc(badge.chipClass)}">${esc(badge.label)}</span></div><span class="platform-row-detail">${esc(sourceDetail(item))}</span></div></div>`;
    }).join("") : `<div class="platform-empty">${state.locale === "en" ? "No services discovered." : "暂未发现运行底座"}</div>`;

    const toggleContainer = root.querySelector(".platform-filter-toggle");
    if (toggleContainer) {
      toggleContainer.querySelectorAll(".filter-toggle-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.modelFilter === modelFilterMode);
      });
    }

    let filteredModels = models;
    const kicker = $("#platform-models-kicker");
    if (modelFilterMode === "service") {
      filteredModels = models.filter((item) => item.backend === selectedBackend);
      const source = sourceByBackend.get(selectedBackend);
      const backendDisplayName = source?.displayName || resolveBackendIconEntry(selectedBackend).displayName || selectedBackend;
      if (kicker) {
        kicker.textContent = selectedBackend
          ? (state.locale === "en" ? `Catalog · ${backendDisplayName}` : `模型目录 · ${backendDisplayName}`)
          : (state.locale === "en" ? "Catalog" : "模型目录");
      }
    } else {
      filteredModels = models.filter((item) => {
        const probeKey = probeKeyForModel(item);
        const probe = modelProbes.get(probeKey);
        if (probe) return probe.status === "runnable";
        const source = sourceByBackend.get(item.backend);
        return ["verified", "runnable"].includes(probe?.status || item.status) || (probe === undefined && item.runnable === true);
      });
      if (kicker) {
        kicker.textContent = state.locale === "en" ? `Catalog · Available (${filteredModels.length})` : `模型目录 · 仅可用 (${filteredModels.length})`;
      }
    }

    const emptyMessage = modelFilterMode === "service"
      ? (state.locale === "en" ? "No models discovered for this service." : "该运行底座暂未发现模型")
      : (state.locale === "en" ? "No runnable models currently available." : "暂无可用的模型");

    $("#platform-models").innerHTML = filteredModels.length ? filteredModels.map((item) => {
      const capabilities = capabilityLabels(item.capabilities);
      const probeKey = probeKeyForModel(item);
      const probe = modelProbes.get(probeKey);
      const modelStatus = probe?.status || item.status || "unverified";
      const availability = modelStatus === "verified" || probe?.status === "runnable" ? "可运行" : modelStatus === "unavailable" || probe?.status === "failed" ? "不可用" : modelStatus === "checking" ? "探测中" : "已发现，待验证";
      const chip = modelStatus === "verified" || probe?.status === "runnable" ? "confirmed" : modelStatus === "unavailable" || probe?.status === "failed" ? "error" : "";
      const message = modelStatus === "verified" || probe?.status === "runnable" ? `<span class="platform-row-detail">验证成功${Number.isFinite(probe?.durationMs) ? `，${Math.round(probe.durationMs)} ms` : ""}</span>` : probe?.message || item.detail ? `<span class="platform-row-detail">${esc(probe?.message || item.detail)}</span>` : "";
      const source = sourceByBackend.get(item.backend);
      const backendDisplayName = source?.displayName || resolveBackendIconEntry(item.backend).displayName;
      return `<div class="platform-model-row is-clickable" data-backend="${esc(item.backend)}" data-model-id="${esc(item.modelId)}" tabindex="0" role="button" title="点击验证模型">${renderBackendIcon(item.backend, { iconKey: source?.iconKey, displayName: backendDisplayName, status: source?.status, size: 22 })}<div class="platform-row-main"><div class="platform-row-title"><strong>${esc(item.modelId)}</strong><span class="status-chip ${chip}">${availability}</span></div><span class="platform-row-detail">${esc(backendDisplayName)} · ${esc(item.name || item.modelId)}</span>${message}<div class="platform-capabilities">${capabilities.length ? capabilities.map((label) => `<span>${esc(label)}</span>`).join("") : "<span>能力信息未提供</span>"}</div></div></div>`;
    }).join("") : `<div class="platform-empty">${emptyMessage}</div>`;
    const hasCodexModel = models.some((item) => item.backend === "codex" && ["verified", "runnable"].includes(modelProbes.get(probeKeyForModel(item))?.status));
    const hasOpenCodeModel = models.some((item) => item.backend === "opencode" && ["verified", "runnable"].includes(modelProbes.get(probeKeyForModel(item))?.status));
    const selectedSource = sourceByBackend.get(selectedBackend);
    const selectedDisplayName = selectedSource?.displayName || resolveBackendIconEntry(selectedBackend).displayName || selectedBackend;
    const missingBackends = [!hasCodexModel && "Codex", !hasOpenCodeModel && "OpenCode"].filter(Boolean);
    const requirementMessage = modelFilterMode === "service" && selectedBackend && !["codex", "opencode"].includes(selectedBackend)
      ? (state.locale === "en"
        ? `${selectedDisplayName} models are read from the local ${selectedDisplayName} configuration. Click a model to verify it through ${selectedSource?.transport || "its native protocol"}.`
        : `已读取 ${selectedDisplayName} 的本地配置模型。点击模型后，将通过 ${selectedSource?.transport || "该底座原生协议"} 执行实际请求验证。`)
      : missingBackends.length
        ? (state.locale === "en"
          ? `No ${missingBackends.join(" or ")} model has passed a live availability probe. Probe discovered models before using them. Team Assistant requires OpenCode.`
          : `尚无通过实际请求验证的 ${missingBackends.join(" 或 ")} 模型。请对发现的模型执行可用性探测；团队助手对话需要 OpenCode。`)
        : (state.locale === "en"
          ? "Codex and OpenCode models have passed live availability probes. Team Assistant uses OpenCode."
          : "Codex 和 OpenCode 均有模型通过实际请求验证；团队助手对话使用 OpenCode。");
    $("#platform-models .platform-model-requirement")?.remove();
    $("#platform-models").insertAdjacentHTML("afterbegin", `<p class="form-hint platform-model-requirement" role="status">${esc(requirementMessage)}</p>`);
    $("#platform-discovery-meta").textContent = `上次检查：${formatDiscoveryTime(discovery.generatedAt)}${discovery.stale ? " · 建议刷新" : ""}`;
    const providerSelect = document.querySelector("#platform-settings-form select[name=defaultProvider]");
    if (providerSelect && settings?.defaultProvider) providerSelect.value = settings.defaultProvider;
    const modelSelect = document.querySelector("#platform-settings-form select[name=defaultModel]");
    if (modelSelect) {
      const backend = providerSelect?.value || settings?.defaultProvider || "codex";
      const runnableModels = models.filter((item) => item.backend === backend && ["verified", "runnable"].includes(modelProbes.get(probeKeyForModel(item))?.status));
      modelSelect.innerHTML = `<option value="default">自动选择</option>${runnableModels.map((item) => `<option value="${esc(item.modelId)}">${esc(item.name || item.modelId)} · ${esc(item.backend)} · ${esc(item.modelId)}</option>`).join("")}`;
      const savedModel = settings?.defaultModel;
      const selectedModel = runnableModels.find((item) => item.modelId === savedModel || `${item.backend}/${item.modelId}` === savedModel);
      modelSelect.value = selectedModel ? selectedModel.modelId : "default";
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
      modelProbes.clear();
      await discoverBackendsIncrementally({ forceRefresh: true, settings: currentSettings });
      label.textContent = "已刷新";
      setTimeout(() => { label.textContent = "刷新"; }, 1500);
    }
    catch (error) { if (isAbort(error)) return; showToast(error.message || "刷新失败"); label.textContent = "重试"; }
    finally { button.disabled = false; }
  });
  $("#platform-providers")?.addEventListener("click", (event) => {
    const row = event.target.closest(".platform-source-row");
    if (!row) return;
    const backend = row.dataset.backend;
    if (backend) {
      selectedBackend = backend;
      modelFilterMode = "service";
      if (discoverySnapshot) renderDiscovery(discoverySnapshot, selectedSettings);
    }
  });
  $("#platform-models")?.addEventListener("click", async (event) => {
    const row = event.target.closest(".platform-model-row");
    if (!row) return;
    const model = { backend: row.dataset.backend, modelId: row.dataset.modelId };
    const key = `${model.backend}:${model.modelId}`;
    modelProbes.set(key, { status: "checking" });
    if (discoverySnapshot) renderDiscovery(discoverySnapshot, selectedSettings);
    try {
      const response = await pageFetch("/api/v1/platform/models/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(model) });
      const payload = await response.json();
      modelProbes.set(key, payload.result || { status: "failed", message: "未收到探测结果" });
    } catch (error) {
      if (isAbort(error)) return;
      modelProbes.set(key, { status: "failed", message: error.message || "模型探测失败" });
    }
    if (discoverySnapshot) renderDiscovery(discoverySnapshot, selectedSettings);
  });
  $("#platform-providers")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const row = event.target.closest(".platform-source-row");
      if (row) {
        event.preventDefault();
        row.click();
      }
    }
  });
  root.querySelector(".platform-filter-toggle")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-model-filter]");
    if (!btn) return;
    const mode = btn.dataset.modelFilter;
    if (mode && mode !== modelFilterMode) {
      modelFilterMode = mode;
      if (discoverySnapshot) renderDiscovery(discoverySnapshot, selectedSettings);
    }
  });
  try {
    const [settingsResponse, backendsSnapshot] = await Promise.all([pageFetch("/api/v1/platform/settings"), discoverBackendsIncrementally({ settings: undefined })]);
    const settingsPayload = await settingsResponse.json();
    if (!settingsResponse.ok) throw new Error(settingsPayload.error || "无法读取平台配置");
    renderDiscovery(backendsSnapshot, settingsPayload.settings);
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
  root.innerHTML = `<section class="page-frame" data-template="A" data-fit><header class="page-frame-header project-library-toolbar studio-repository-toolbar"><div class="repository-heading"><h1>${esc(copy[state.locale].factoryTitle)}</h1><p>${esc(copy[state.locale].factoryIntro)}</p></div><div class="project-library-filters repository-actions"><label><span class="sr-only">${state.locale === "en" ? "Search teams" : "搜索团队"}</span><input id="studio-team-search" type="search" placeholder="${state.locale === "en" ? "Search teams" : "搜索团队"}"></label><label><span class="sr-only">${state.locale === "en" ? "Filter status" : "筛选状态"}</span><select id="studio-team-status"><option value="all">${state.locale === "en" ? "All statuses" : "全部状态"}</option><option value="released">${esc(copy[state.locale].releasedLabel)}</option><option value="draft">${state.locale === "en" ? "Designing" : "设计中"}</option><option value="archived">${esc(copy[state.locale].archivedLabel)}</option></select></label><a class="primary-button" href="/studio/new" data-route="/studio/new">${esc(copy[state.locale].createTeam)}</a></div></header><div class="page-frame-body" data-layout-scroll><div id="studio-grid" class="project-library-grid"><div class="project-loading" role="status">${state.locale === "en" ? "Loading team repository…" : "正在读取团队仓库…"}</div></div></div></section>`;
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

function studioSimulationStatus(status) {
  const labels = state.locale === "en"
    ? { running: "Working", stopping: "Stopping", stopped: "Stopped", waiting: "Waiting", completed: "Completed", failed: "Failed", skipped: "Skipped", accepted: "Task accepted", working: "Working", unknown: "Unknown" }
    : { running: "工作中", stopping: "正在停止", stopped: "已停止", waiting: "等待中", completed: "已完成", failed: "失败", skipped: "已跳过", accepted: "接受任务", working: "工作中", unknown: "未知" };
  return labels[status] || status || (state.locale === "en" ? "Unknown" : "未知");
}

function studioSimulationModeLabel(mode) {
  return mode === "sandbox"
    ? (state.locale === "en" ? "Sandbox" : "沙箱")
    : (state.locale === "en" ? "Simulation" : "仿真");
}

function studioSimulationEventTime(event) {
  const parts = [];
  if (event.at) {
    const date = new Date(event.at);
    if (!Number.isNaN(date.getTime())) {
      parts.push(date.toLocaleString(state.locale, {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
      }));
    }
  }
  if (Number.isFinite(Number(event.durationMs))) {
    parts.push(state.locale === "en" ? `${Math.max(0, Number(event.durationMs))} ms` : `耗时 ${Math.max(0, Number(event.durationMs))} 毫秒`);
  }
  return parts.join(" · ");
}

const {
  messagePresentation: studioMessagePresentation,
  messageSectionMarkup: studioTranscriptSectionMarkup,
  bindMessageMore: bindStudioMessageMore,
  auditDrawerMarkup: studioRuntimeAuditDrawerMarkup,
  roleCardMarkup: studioRuntimeRoleCardMarkup,
  mergeAuditTrail: mergeStudioAuditTrail,
  appendRuntimeHandoff: appendStudioRuntimeHandoff,
  appendUserPrompt: appendStudioUserPrompt,
  bindAuditDrawer: bindStudioRuntimeAuditDrawer
} = createStudioTranscriptTools({
  roleColorForId,
  renderRoleAvatarWithBadge,
  formatEventTime: studioSimulationEventTime,
  formatStatus: studioSimulationStatus
});

function studioWorkspaceNav(teamVersionId, active) {
  const id = encodeURIComponent(teamVersionId);
  const search = location.search;
  const items = [
    ["info", state.locale === "en" ? "Team info" : "团队信息", "info"],
    ["design", state.locale === "en" ? "Design" : "设计", "design"],
    ["run", state.locale === "en" ? "Debug history" : "调试历史", "run"],
    ["release", state.locale === "en" ? "Release" : "发布", "release"]
  ];
  return `<nav class="studio-workspace-nav" aria-label="${state.locale === "en" ? "Team workspace" : "团队工作区"}">${items.map(([key, label, route]) => `<a href="/studio/teams/${id}/${route}${search}" data-route="/studio/teams/${id}/${route}${search}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}

function studioArtifactsBrowserUrl(teamVersionId, simulationId, teamId = teamVersionId) {
  return `/studio/teams/${encodeURIComponent(teamVersionId)}/run/${encodeURIComponent(simulationId)}/artifacts?teamId=${encodeURIComponent(teamId)}`;
}

function bindStudioWorkspaceButtons(root) {
  root.querySelectorAll("[data-open-workspace]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const originalLabel = button.textContent;
      button.disabled = true;
      button.dataset.opening = "true";
      button.textContent = state.locale === "en" ? "Opening…" : "正在打开…";
      try {
        const response = await pageFetch(button.dataset.openWorkspace, { method: "POST" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || (state.locale === "en" ? "Unable to open workspace." : "无法打开工作目录。"));
        button.textContent = state.locale === "en" ? "Opened" : "已打开";
        window.setTimeout(() => {
          if (button.isConnected) button.textContent = originalLabel;
        }, 1400);
      } catch (error) {
        button.textContent = originalLabel;
        button.title = studioSimulationErrorText(error.message) || (state.locale === "en" ? "Unable to open workspace." : "无法打开工作目录。");
      } finally {
        button.disabled = false;
        delete button.dataset.opening;
      }
    });
  });
}

async function renderStudioArtifactsPage(teamVersionId, simulationId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  if (!root) return;
    root.innerHTML = '<div class="project-loading">正在读取运行证据...</div>';
  const requestedTeamId = new URLSearchParams(location.search).get("teamId") || teamVersionId;
  const simulationApi = `/api/v1/teams/${encodeURIComponent(requestedTeamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations/${encodeURIComponent(simulationId)}`;
  try {
    const simulationResponse = await pageFetch(simulationApi);
    const simulationPayload = await simulationResponse.json();
    if (!simulationResponse.ok) throw new Error(simulationPayload.error || "无法读取运行详情");
    const teamId = simulationPayload.simulation?.teamId || teamVersionId;
    const apiBase = `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations/${encodeURIComponent(simulationId)}/artifacts`;
    const response = await pageFetch(apiBase);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法读取运行目录");
    if (pageRequest && !isCurrentRequest(pageRequest)) return;
    const entries = (Array.isArray(payload.entries) ? payload.entries : []).filter((entry) => {
      const path = String(entry.path || "");
      return /^roles\/[^/]+\/(?:outbox\.md|result\.json)$/.test(path) || /^roles\/[^/]+\/executions\/[^/]+\/execution-outcome\.json$/.test(path);
    });
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio/teams/${encodeURIComponent(teamVersionId)}/run/${encodeURIComponent(simulationId)}" data-route="/studio/teams/${encodeURIComponent(teamVersionId)}/run/${encodeURIComponent(simulationId)}">← 返回运行详情</a><div class="eyebrow">OGS Studio · 工作目录</div><h1>运行产物</h1><p>查看本次调试运行生成的角色成果和交接文件。</p></div><span class="status-chip">${entries.length} 个产物</span></section><section class="studio-artifact-browser"><aside class="studio-artifact-list"><div class="panel-head"><div><span class="section-kicker">Work directory</span><h2>产物文件</h2></div></div>${entries.length ? entries.map((entry, index) => `<button type="button" class="studio-artifact-entry${index === 0 ? " selected" : ""}" data-artifact-path="${esc(entry.path)}"><strong>${esc(entry.path)}</strong><span>${Number(entry.size || 0).toLocaleString()} bytes · ${esc(entry.updatedAt || entry.modifiedAt || "")}</span></button>`).join("") : '<p class="empty-note">本次运行暂无可展示产物。</p>'}</aside><section class="studio-artifact-preview"><div class="panel-head"><div><span class="section-kicker">Artifact preview</span><h2 data-artifact-title>${esc(entries[0]?.path || "未选择产物")}</h2></div><a class="secondary-button" data-artifact-download href="#" hidden>下载产物</a></div><pre data-artifact-content>选择左侧产物查看内容。</pre></section></section>`;
    const title = root.querySelector("[data-artifact-title]");
    const content = root.querySelector("[data-artifact-content]");
    const download = root.querySelector("[data-artifact-download]");
    const buttons = [...root.querySelectorAll("[data-artifact-path]")];
    const select = async (entry, button) => {
      buttons.forEach((item) => item.classList.toggle("selected", item === button));
      title.textContent = entry.path;
      const rawUrl = `${apiBase}/${entry.path.split("/").map(encodeURIComponent).join("/")}`;
      download.hidden = false;
      download.href = `${rawUrl}?download=1`;
      content.textContent = "正在读取文件...";
      try {
        const fileResponse = await pageFetch(rawUrl);
        content.textContent = fileResponse.ok ? await fileResponse.text() : "无法读取该文件。";
      } catch (error) {
        if (!isAbort(error)) content.textContent = error.message || "无法读取该文件。";
      }
    };
    buttons.forEach((button, index) => button.addEventListener("click", () => select(entries[index], button)));
    if (entries[0]) await select(entries[0], buttons[0]);
  } catch (error) {
    if (isAbort(error)) return;
    root.innerHTML = `<section class="page-heading"><div><div class="eyebrow">OGS Studio · 运行证据</div><h1>运行目录</h1></div></section><p class="run-error">${esc(error.message || "无法读取运行目录")}</p>`;
  }
}

function addStudioWorkspaceNav(root, teamVersionId, active) {
  if (!root || root.querySelector(".studio-workspace-nav")) return;
  root.querySelector(".page-heading")?.insertAdjacentHTML("afterend", studioWorkspaceNav(teamVersionId, active));
}

async function renderStudioTeamInfo(teamVersionId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  root.innerHTML = '<div class="project-loading">正在读取团队信息...</div>';
  try {
    const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`);
    const team = await response.json();
    if (!response.ok) throw new Error(team.error || "无法读取团队版本");
    if (pageRequest && !isCurrentRequest(pageRequest)) return;
    const meta = teamVersionMeta(team);
    const editable = meta.status !== "archived";
    const isReleased = meta.status === "released";
    const versionBannerHtml = isReleased
      ? `<div class="version-state-banner is-released"><span class="version-state-icon" aria-hidden="true">🔒</span><div class="version-state-body"><strong>${state.locale === "en" ? "Immutable Released Version" : "不可变已发布版本"}</strong><p>${state.locale === "en" ? "This version is verified and ready for project mounting. Saving modifications will automatically derive a new draft without affecting existing projects." : "此版本已通过发布门禁，可供项目直接挂载。保存任何修改将自动派生出新版本的草案，原已发布版本不受影响。"}</p></div></div>`
      : `<div class="version-state-banner is-draft"><span class="version-state-icon" aria-hidden="true">✏️</span><div class="version-state-body"><strong>${state.locale === "en" ? "Draft Version In Design" : "编辑中草案版本"}</strong><p>${state.locale === "en" ? "Team architecture and role flows are in design. You can continue editing or run simulations to verify." : "团队架构与角色流转正在设计中，可继续自由编辑或启动沙箱调试。"}</p><div class="version-banner-actions"><a class="secondary-button" href="/studio/teams/${encodeURIComponent(teamVersionId)}/design" data-route="/studio/teams/${encodeURIComponent(teamVersionId)}/design">${state.locale === "en" ? "Continue Design →" : "继续设计 →"}</a></div></div></div>`;
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← 团队仓库</a><div class="eyebrow">OGS Studio · ${esc(team.teamId || team.teamRootId || team.projectId)}</div><h1>${esc(team.name || team.teamName)} <span class="version-badge">${esc(meta.version)}</span></h1><p>${state.locale === "en" ? "Team identity and release state. Project materials and tasks are managed separately in OGS Projects." : "管理团队身份与版本状态。项目资料和业务任务由 OGS Projects 独立管理。"}</p></div><span class="status-chip ${esc(meta.status)}">${esc(meta.label)}</span></section>${studioWorkspaceNav(teamVersionId, "info")}<section class="studio-info-layout"><div class="studio-stats-bar"><div class="studio-stat-item"><span class="studio-stat-label">${state.locale === "en" ? "Version" : "版本"}</span><strong class="studio-stat-val">${esc(meta.version)}</strong></div><div class="studio-stat-item"><span class="studio-stat-label">${state.locale === "en" ? "Status" : "状态"}</span><strong class="studio-stat-val"><span class="status-chip ${esc(meta.status)}">${esc(meta.label)}</span></strong></div><div class="studio-stat-item"><span class="studio-stat-label">${state.locale === "en" ? "Updated" : "更新时间"}</span><strong class="studio-stat-val">${esc(team.updatedAt ? new Date(team.updatedAt).toLocaleDateString(state.locale) : "—")}</strong></div><div class="studio-stat-item"><span class="studio-stat-label">${state.locale === "en" ? "Team ID" : "团队标识"}</span><strong class="studio-stat-val"><code>${esc(team.teamId || team.teamRootId || team.projectId)}</code></strong></div></div><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Team identity" : "团队身份"}</span><h2>${state.locale === "en" ? "Team information" : "团队基本信息"}</h2></div></div><form id="studio-team-info-form" class="compact-form"><label>${state.locale === "en" ? "Team name" : "团队名称"}<input name="name" value="${esc(team.name || team.teamName || "")}" maxlength="120" required${editable ? "" : " disabled"}></label><label>${state.locale === "en" ? "Team goal" : "团队目标"}<textarea name="overview" rows="6" maxlength="4000" required${editable ? "" : " disabled"}>${esc(team.overview || "")}</textarea></label><p class="form-status" id="studio-team-info-status" role="status" aria-live="polite"></p><div class="form-actions">${editable ? `<button class="primary-button" type="submit">${state.locale === "en" ? "Save team info" : "保存团队信息"}</button>` : `<span class="form-hint">${state.locale === "en" ? "Inactive teams are read-only." : "已停用团队为只读。"}</span>`}</div></form></article><article class="project-panel studio-version-facts-card"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Version" : "版本信息"}</span><h2>${state.locale === "en" ? "TeamVersion" : "团队版本"}</h2></div><span class="status-chip ${esc(meta.status)}">${esc(meta.label)}</span></div>${versionBannerHtml}<dl class="studio-version-facts"><div><dt>${state.locale === "en" ? "Status" : "状态"}</dt><dd>${esc(meta.label)}</dd></div><div><dt>${state.locale === "en" ? "Version" : "版本"}</dt><dd>${esc(meta.version)}</dd></div><div><dt>${state.locale === "en" ? "Team ID" : "团队 ID"}</dt><dd><code>${esc(team.teamId || team.teamRootId || team.projectId)}</code></dd></div><div><dt>${state.locale === "en" ? "Updated" : "更新时间"}</dt><dd>${esc(team.updatedAt ? new Date(team.updatedAt).toLocaleString(state.locale) : "—")}</dd></div></dl><p class="panel-intro">${state.locale === "en" ? "Saving a change to a released version creates a draft; the released version remains unchanged." : "保存已发布版本的修改时才创建草案，原已发布版本保持不变。"}</p></article></section>`;
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

async function renderStudioSystemSettings(teamVersionId, pageRequest = state.activeRequest, root = $("#studio-assets-global"), current = {}) {
  if (!root) return;
  root.innerHTML = '<div class="project-loading">正在读取团队全局配置...</div>';
  try {
    const [teamResponse, designResponse, assetsResponse] = await Promise.all([
      current.teamVersion || state.studioTeamVersion ? Promise.resolve(null) : pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`),
      current.authoring ? Promise.resolve(null) : pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/design?locale=${encodeURIComponent(state.locale)}`),
      current.assets ? Promise.resolve(null) : pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/design/assets`)
    ]);
    const [team, design, assets] = await Promise.all([
      teamResponse ? teamResponse.json() : Promise.resolve(current.teamVersion || state.studioTeamVersion),
      designResponse ? designResponse.json() : Promise.resolve(null),
      assetsResponse ? assetsResponse.json() : Promise.resolve(null)
    ]);
    if ((teamResponse && !teamResponse.ok) || (designResponse && !designResponse.ok) || (assetsResponse && !assetsResponse.ok)) {
      throw new Error(team.error || design?.error || assets?.error || "无法读取团队全局配置");
    }
    if (!root.isConnected || (pageRequest && !isCurrentRequest(pageRequest))) return;
    const authoring = structuredClone(current.authoring || design.authoring);
    const teamVersionDigest = current.teamVersionDigest || design?.saveSnapshotDigest || design?.teamVersionDigest;
    const editable = teamVersionMeta(team).status !== "archived";
    const currentAssets = current.assets || design?.saveSnapshotAssets || assets;
    const lawCatalog = currentAssets.laws || { laws: [] };
    const selectedLawId = authoring.system.lawGlobalRef || "";
    const selectedLaw = (lawCatalog.laws || []).find((law) => law.lawId === selectedLawId) || null;
    const laws = selectedLaw?.constraints || {};
    const contractSchemas = currentAssets.contractSchemas || {};
    const emptyContractManifest = '{\n  "version": 1,\n  "contracts": []\n}';
    const contractManifest = currentAssets.contracts || emptyContractManifest;
    const displayValue = (value) => `<output class="studio-readonly-value">${esc(value || (state.locale === "en" ? "Not set" : "未设置"))}</output>`;
    const configField = (key, label, value, options) => editable
      ? `<label class="field"><span>${label}</span>${options ? `<select data-system-field="${key}">${options}</select>` : `<input data-system-field="${key}" value="${esc(value || "")}">`}</label>`
      : `<div class="field"><span>${label}</span>${displayValue(options ? (authoring.system.handoffMode === "strict" ? (state.locale === "en" ? "Strict validation" : "严格校验") : authoring.system.handoffMode === "transition" ? (state.locale === "en" ? "Flow validation" : "流转校验") : (state.locale === "en" ? "Off" : "关闭")) : value)}</div>`;
    const handoffOptions = `<option value="">${state.locale === "en" ? "Off" : "关闭"}</option><option value="transition" ${authoring.system.handoffMode === "transition" ? "selected" : ""}>${state.locale === "en" ? "Flow validation" : "流转校验"}</option><option value="strict" ${authoring.system.handoffMode === "strict" ? "selected" : ""}>${state.locale === "en" ? "Strict validation" : "严格校验"}</option>`;
    const teamConfigurationFields = [
      `<div class="field"><span>${state.locale === "en" ? "System ID" : "系统标识"}</span>${displayValue(authoring.system.systemId)}</div>`,
      configField("systemVersion", state.locale === "en" ? "Version" : "版本", authoring.system.systemVersion),
      configField("lawGlobalRef", state.locale === "en" ? "Global law" : "全局法则", authoring.system.lawGlobalRef),
      configField("handoffMode", state.locale === "en" ? "Handoff mode" : "流转模式", authoring.system.handoffMode, handoffOptions)
    ].join("");
    const schemaFields = Object.entries(contractSchemas).map(([path, content]) => editable
      ? `<label class="field full"><span>${esc(path)}</span><textarea data-system-schema="${esc(path)}" rows="7" spellcheck="false">${esc(content)}</textarea></label>`
      : `<div class="field full"><span>${esc(path)}</span><pre class="studio-readonly-code">${esc(content)}</pre></div>`).join("");
    const contractField = editable
      ? `<label class="field full"><span>${state.locale === "en" ? "Contract manifest" : "契约清单"}</span><textarea data-system-contracts rows="8" spellcheck="false">${esc(contractManifest)}</textarea></label>`
      : `<div class="field full"><span>${state.locale === "en" ? "Contract manifest" : "契约清单"}</span><pre class="studio-readonly-code">${esc(contractManifest)}</pre></div>`;
    const lawNumber = (key) => Number.isSafeInteger(laws[key]) && laws[key] > 0 ? laws[key] : "";
    let initialSafeBudget;
    let initialBudgetError;
    try { initialSafeBudget = calculateSafeTransitionBudget(authoring).budget; }
    catch (error) { initialBudgetError = error.message; }
    const recommendedBudget = (budget) => Math.ceil(budget * 1.5);
    const budgetSummary = (budget, error) => error
      ? (state.locale === "en" ? `Cannot calculate a finite structural budget: ${error}` : `无法计算有限的结构预算：${error}`)
      : (state.locale === "en"
        ? `Structural safety budget: ${budget}; recommended reference: ${recommendedBudget(budget)} (1.5x). This covers the complete graph, all branches, and configured loop limits. It is not the minimum budget for one completable path.`
        : `完整结构安全预算：${budget}；推荐参考值：${recommendedBudget(budget)}（1.5 倍）。该值覆盖完整图结构、全部分支及已配置循环上限，不是最低可完成路径的预算。`);
    const lawFields = `<section class="studio-global-settings-section"><div class="panel-head"><h3>${state.locale === "en" ? "Runtime laws" : "运行法则"}</h3></div><div class="studio-inspector-fields"><label class="field"><span>${state.locale === "en" ? "Maximum role activations" : "最大角色激活次数"}</span><input data-law-number="maxTransitions" type="number" min="${initialSafeBudget ?? 1}" step="1" value="${esc(lawNumber("maxTransitions"))}" ${editable ? "" : "disabled"}></label><p class="field-hint full" data-transition-budget-summary role="status">${esc(budgetSummary(initialSafeBudget, initialBudgetError))}</p><label class="field"><span>${state.locale === "en" ? "Prompt limit per role (characters)" : "单角色提示词上限（字符）"}</span><input data-law-number="maxPromptCharsPerRole" type="number" min="1" step="1" value="${esc(lawNumber("maxPromptCharsPerRole"))}" ${editable ? "" : "disabled"}></label><label class="field"><span>${state.locale === "en" ? "Prompt limit per run (characters)" : "单次运行提示词上限（字符）"}</span><input data-law-number="maxTotalPromptCharsPerRun" type="number" min="1" step="1" value="${esc(lawNumber("maxTotalPromptCharsPerRun"))}" ${editable ? "" : "disabled"}></label><label class="field full"><span>${state.locale === "en" ? "Disabled tool references" : "禁用工具引用"}</span><textarea data-law-tools rows="3" ${editable ? "" : "disabled"}>${esc((laws.forbiddenToolRefs || []).join(", "))}</textarea></label><label class="field checkbox full"><input data-law-isolation type="checkbox" ${laws.isolateExternalData !== false ? "checked" : ""} ${editable ? "" : "disabled"}><span>${state.locale === "en" ? "Separate external data from instructions" : "将外部资料与指令结构化分隔"}</span></label><p class="field-hint full" data-law-isolation-warning role="status" ${laws.isolateExternalData !== false ? "hidden" : ""}>${state.locale === "en" ? "External materials will not be wrapped in an &lt;ogs_external_data&gt; block. Use only for controlled compatibility debugging." : "外部材料将不再使用 &lt;ogs_external_data&gt; 包裹。仅建议在受控环境中临时排查兼容问题。"}</p></div></section>`;
    const loopConfig = authoring.system.loops && typeof authoring.system.loops === "object" ? authoring.system.loops : {};
    const loopFields = `<section class="studio-global-settings-section"><div class="panel-head"><h3>${state.locale === "en" ? "Loop configuration" : "循环配置"}</h3></div><div class="studio-inspector-fields"><label class="field full"><span>${state.locale === "en" ? "Loops by identifier (JSON)" : "按循环编号配置（JSON）"}</span><textarea data-system-loops rows="9" spellcheck="false" ${editable ? "" : "disabled"}>${esc(JSON.stringify(loopConfig, null, 2))}</textarea><span class="field-hint">${state.locale === "en" ? "Configure members, maxRounds and optional maxRoleActivations by loop identifier." : "按循环编号配置成员、最大轮次和可选的角色激活上限。"}</span></label></div></section>`;
    root.innerHTML = `<div class="studio-global-settings"><header class="studio-global-settings-head"><div><span class="section-kicker">${esc(team.name || team.teamName)} · v${team.teamVersionNumber || 1}</span><h2>${state.locale === "en" ? "Global configuration" : "全局配置"}</h2></div><p>${state.locale === "en" ? "System identity, runtime loops and handoff contracts for this team version." : "配置团队身份、通用循环与流转契约。"}</p></header><section class="studio-global-settings-section"><div class="panel-head"><h3>${state.locale === "en" ? "Team configuration" : "团队配置"}</h3></div><div class="studio-inspector-fields"></div></section>${lawFields}${loopFields}<section class="studio-global-settings-section"><div class="panel-head"><h3>${state.locale === "en" ? "Contracts and schemas" : "交接契约与 Schema"}</h3></div><div class="studio-inspector-fields">${contractField}${schemaFields || `<p class="field-hint full">${state.locale === "en" ? "No schema files are referenced by the contract manifest yet." : "当前契约清单尚未引用 Schema 文件。"}</p>`}<code>.ogs/contracts/handoff.json</code></div></section><div class="form-actions studio-system-actions">${editable ? `<button class="primary-button" type="button" data-system-save>${state.locale === "en" ? "Save global configuration" : "保存全局配置"}</button>` : `<span class="form-hint">${state.locale === "en" ? "Released versions are read-only. Create a design version to edit." : "已发布版本为只读；请创建新的设计中版本再编辑。"}</span>`}<p class="form-status" data-system-status role="status" aria-live="polite"></p></div></div>`;
    root.querySelector(".studio-global-settings-section .studio-inspector-fields").innerHTML = teamConfigurationFields;
    const readOnlyHint = root.querySelector(".studio-system-actions .form-hint");
    if (!editable && readOnlyHint) readOnlyHint.textContent = state.locale === "en"
      ? "Archived versions are read-only."
      : "已停用版本为只读，不能在此编辑。";
    const status = root.querySelector("[data-system-status]");
    const setPageDirty = () => setDirty("studio-system-settings");
    const hadLoopConfiguration = Object.hasOwn(authoring.system, "loops");
    root.querySelectorAll("[data-system-field], [data-system-contracts], [data-system-schema], [data-system-loops], [data-law-number], [data-law-tools], [data-law-isolation]").forEach((field) => field.addEventListener("input", setPageDirty));
    const refreshSafetyBudget = () => {
      const summary = root.querySelector("[data-transition-budget-summary]");
      const transitionField = root.querySelector('[data-law-number="maxTransitions"]');
      if (!summary || !transitionField) return;
      try {
        const budgetAuthoring = structuredClone(authoring);
        const loopField = root.querySelector("[data-system-loops]");
        if (loopField) {
          const parsedLoops = loopField.value.trim() ? JSON.parse(loopField.value) : {};
          if (!parsedLoops || Array.isArray(parsedLoops) || typeof parsedLoops !== "object") throw new Error("循环配置必须是对象 JSON。");
          if (Object.keys(parsedLoops).length) budgetAuthoring.system.loops = parsedLoops;
          else delete budgetAuthoring.system.loops;
        }
        const budget = calculateSafeTransitionBudget(budgetAuthoring).budget;
        transitionField.min = String(Math.max(1, budget));
        summary.textContent = budgetSummary(budget);
      } catch (error) {
        transitionField.min = "1";
        summary.textContent = budgetSummary(undefined, error.message);
      }
    };
    root.querySelector("[data-system-loops]")?.addEventListener("input", refreshSafetyBudget);
    root.querySelector("[data-law-isolation]")?.addEventListener("change", (event) => {
      const warning = root.querySelector("[data-law-isolation-warning]");
      warning.hidden = event.currentTarget.checked;
      setPageDirty();
    });
    root.querySelector("[data-system-save]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      status.textContent = state.locale === "en" ? "Saving configuration…" : "正在保存全局配置…";
      const nextAuthoring = structuredClone(authoring);
      root.querySelectorAll("[data-system-field]").forEach((field) => { nextAuthoring.system[field.dataset.systemField] = field.value; });
      const loopField = root.querySelector("[data-system-loops]");
      if (loopField) {
        try {
          const parsedLoops = loopField.value.trim() ? JSON.parse(loopField.value) : {};
          if (!parsedLoops || Array.isArray(parsedLoops) || typeof parsedLoops !== "object") throw new Error("循环配置必须是对象 JSON。 ");
          if (!hadLoopConfiguration && Object.keys(parsedLoops).length === 0) delete nextAuthoring.system.loops;
          else nextAuthoring.system.loops = parsedLoops;
        } catch (error) {
          status.textContent = state.locale === "en" ? `Loop configuration JSON is invalid: ${error.message}` : `循环配置 JSON 无效：${error.message}`;
          button.disabled = false;
          return;
        }
      }
      if (nextAuthoring.system.handoffMode) nextAuthoring.system.handoffContracts = ".ogs/contracts/handoff.json";
      else delete nextAuthoring.system.handoffContracts;
      const nextAssets = {
        contracts: !currentAssets.contracts && root.querySelector("[data-system-contracts]").value === emptyContractManifest
          ? (nextAuthoring.system.handoffMode ? emptyContractManifest : undefined)
          : root.querySelector("[data-system-contracts]").value,
        contractSchemas: Object.fromEntries([...root.querySelectorAll("[data-system-schema]")].map((field) => [field.dataset.systemSchema, field.value])),
        laws: { ...laws }
      };
      try {
        root.querySelectorAll("[data-law-number]").forEach((field) => {
          const value = field.value === "" ? undefined : Number(field.value);
          if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error(state.locale === "en" ? `${field.dataset.lawNumber} must be a positive integer.` : `${field.dataset.lawNumber} 必须是正整数。`);
          if (value === undefined) delete nextAssets.laws[field.dataset.lawNumber];
          else nextAssets.laws[field.dataset.lawNumber] = value;
        });
        const { budget: safeBudget } = calculateSafeTransitionBudget(nextAuthoring);
        const configuredBudget = nextAssets.laws.maxTransitions ?? 100;
        if (configuredBudget < safeBudget) {
          throw new Error(state.locale === "en"
            ? `Maximum role activations must be at least the structural safety budget of ${safeBudget}. Recommended reference: ${recommendedBudget(safeBudget)}.`
            : `最大角色激活次数不能低于完整结构安全预算 ${safeBudget}。推荐参考值：${recommendedBudget(safeBudget)}。`);
        }
        nextAssets.laws.forbiddenToolRefs = root.querySelector("[data-law-tools]").value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
        nextAssets.laws.isolateExternalData = root.querySelector("[data-law-isolation]").checked;
        const nextCatalog = structuredClone(lawCatalog);
        const nextLawId = nextAuthoring.system.lawGlobalRef || selectedLawId || "law.team.default";
        let nextLaw = nextCatalog.laws.find((law) => law.lawId === nextLawId);
        if (!nextLaw) {
          nextLaw = { lawId: nextLawId, constraints: {} };
          nextCatalog.laws.push(nextLaw);
        }
        nextLaw.constraints = nextAssets.laws;
        nextAssets.laws = nextCatalog;
        nextAuthoring.system.lawGlobalRef = nextLawId;
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
        return;
      }
      const candidateAssets = { ...currentAssets, ...nextAssets };
      delete candidateAssets.lawsText;
      try {
        const designSave = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/save`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ authoring: nextAuthoring, assets: candidateAssets, expectedTeamVersionDigest: teamVersionDigest })
        });
        const savedDesign = await designSave.json();
        if (!designSave.ok) throw new Error(savedDesign.error || "全局配置保存失败");
        if (pageRequest && !isCurrentRequest(pageRequest)) return;
        if (savedDesign.createdDraft) {
          clearDirty("studio-system-settings");
          navigate(withCurrentSearch(`/studio/teams/${encodeURIComponent(savedDesign.teamVersionId)}/design`));
          return;
        }
        const assetsResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(savedDesign.teamVersionId || teamVersionId)}/design/assets`);
        const savedAssets = await assetsResponse.json();
        if (!assetsResponse.ok) throw new Error(savedAssets.error || "全局配置已保存，但读取资产失败");
        current.onSaved?.({ authoring: nextAuthoring, teamVersionDigest: savedDesign.teamVersionDigest, assets: savedAssets });
        clearDirty("studio-system-settings");
        status.textContent = state.locale === "en" ? "Global configuration saved." : "全局配置已保存。";
      } catch (error) {
        if (isAbort(error)) return;
        status.textContent = error.message || "全局配置保存失败";
      } finally { if (button?.isConnected) button.disabled = false; }
    });
  } catch (error) {
    if (isAbort(error)) return;
    if (!root.isConnected || (pageRequest && !isCurrentRequest(pageRequest))) return;
    root.innerHTML = `<div class="run-error" role="alert"><p>${esc(error.message || "无法读取团队全局配置")}</p><button class="secondary-button" type="button" data-system-settings-retry>${state.locale === "en" ? "Retry" : "重试"}</button></div>`;
    root.querySelector("[data-system-settings-retry]")?.addEventListener("click", () => {
      delete root.dataset.loaded;
      if (root.dataset.loading) return;
      root.dataset.loading = "true";
      void renderStudioSystemSettings(teamVersionId, state.activeRequest, root, { ...current, teamVersion: current.teamVersion || state.studioTeamVersion })
        .finally(() => { delete root.dataset.loading; });
    });
  }
}

function studioSimulationErrorText(message) {
  const detail = String(message || "");
  const code = detail.match(/^([A-Z][A-Z0-9_]+)(?::|$)/)?.[1];
  const messages = {
    STUDIO_SIMULATION_INPUT_INVALID: ["Enter a debug request between 1 and 1,200 characters.", "请输入 1 到 1,200 个字符的调试任务。"],
    STUDIO_SIMULATION_NOT_FOUND: ["This TeamVersion or debug run could not be found.", "找不到此团队版本或调试记录。"],
    STUDIO_SIMULATION_TEAM_VERSION_UNAVAILABLE: ["This TeamVersion is not available for a debug run.", "此团队版本当前不可用于调试。"],
    STUDIO_SIMULATION_MODE_INVALID: ["Choose Simulation or Sandbox.", "请选择仿真或沙箱。"],
    STUDIO_SIMULATION_TEAM_DIGEST_INVALID: ["The TeamVersion package failed its integrity check.", "团队版本包未通过完整性校验。"],
    STUDIO_SIMULATION_TEAM_DIGEST_UNAVAILABLE: ["The TeamVersion package could not be read for debugging.", "无法读取团队版本包，暂不能运行调试。"],
    TEAM_WORKSPACE_UNBOUND: ["No business workspace is bound to this TeamVersion.", "此团队版本尚未绑定业务工作目录。"],
    TEAM_WORKSPACE_INVALID: ["The bound business workspace is unavailable.", "绑定的业务工作目录不可用。"],
    MODEL_UNAVAILABLE: ["A runnable model is unavailable. Check Platform settings and retry.", "当前没有可运行的模型，请检查平台设置后重试。"],
    TEAM_ASSISTANT_MODEL_UNAVAILABLE: ["A runnable model is unavailable. Check Platform settings and retry.", "当前没有可运行的模型，请检查平台设置后重试。"]
  };
  if (code && messages[code]) return messages[code][state.locale === "en" ? 0 : 1];
  if (code) return state.locale === "en" ? "The debug run could not be completed. Check the TeamVersion and retry." : "调试无法完成，请检查团队版本后重试。";
  return detail || (state.locale === "en" ? "The debug run could not be completed. Try again." : "调试无法完成，请重试。");
}

async function renderStudioRunPage(teamVersionId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  const english = state.locale === "en";
  root.innerHTML = `<div class="project-loading">${english ? "Loading team simulations…" : "正在读取团队仿真…"}</div>`;
  try {
    const teamResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`);
    const team = await teamResponse.json();
    if (!teamResponse.ok) throw new Error(team.error || "无法读取团队版本");
    const simulationResponse = await pageFetch(`/api/v1/teams/${encodeURIComponent(team.teamId)}/versions/${encodeURIComponent(team.teamVersionId || teamVersionId)}/simulations`);
    const payload = await simulationResponse.json();
    if (!simulationResponse.ok) throw new Error(payload.error || "无法读取 Studio 仿真记录");
    if (pageRequest && !isCurrentRequest(pageRequest)) return;
    const simulations = payload.simulations || [];
    const workspaceAvailable = Boolean(payload.workspaceAvailable || team.workspaceAvailable);
    const workspaceOpenPath = `/api/v1/teams/${encodeURIComponent(team.teamId)}/versions/${encodeURIComponent(team.teamVersionId || teamVersionId)}/workspace/open-directory`;
    const auditLabel = english ? "Run audit" : "运行审计";
    const workspaceLabel = english ? "Open workspace" : "工作目录";
    const workspaceUnavailableTitle = english ? "No workspace is bound to this TeamVersion" : "此团队版本尚未绑定工作目录";
    const history = simulations.length ? simulations.map((simulation) => {
      const detail = `/studio/teams/${encodeURIComponent(teamVersionId)}/run/${encodeURIComponent(simulation.simulationId)}`;
      const auditHref = studioArtifactsBrowserUrl(teamVersionId, simulation.simulationId, simulation.teamId || team.teamId);
      return `<div class="material-row studio-simulation-row"><a class="studio-simulation-link" href="${detail}" data-route="${detail}"><div><strong>${esc(simulation.input || "Studio Simulation")}</strong><div class="task-record-meta"><span class="status-chip ${esc(simulation.status)}">${esc(studioSimulationStatus(simulation.status))}</span><span class="mode-chip ${esc(simulation.mode || "dry-run")}">${esc(studioSimulationModeLabel(simulation.mode))}</span><span>${esc(simulation.createdAt || "")}</span><span>${esc(simulation.simulationId)}</span></div>${simulation.failureSummary ? `<p class="task-run-last-error">${esc(studioSimulationErrorText(simulation.failureSummary))}</p>` : ""}</div></a><div class="studio-history-actions" aria-label="${english ? "Simulation actions" : "运行操作"}"><a class="secondary-button studio-history-action" href="${auditHref}" target="_blank" rel="noreferrer">${auditLabel}</a><button type="button" class="secondary-button studio-history-action" data-open-workspace="${workspaceOpenPath}"${workspaceAvailable ? "" : ` disabled title="${workspaceUnavailableTitle}"`}>${workspaceLabel}</button></div></div>`;
    }).join("") : `<p class="empty-note">${english ? "No simulations for this TeamVersion yet." : "此团队版本还没有仿真记录。"}</p>`;
    const clearable = simulations.some((item) => item.mode !== "sandbox" && !item.baselineScenarioId && ["completed", "failed", "stopped"].includes(item.status));
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← ${english ? "Team repository" : "团队仓库"}</a><div class="eyebrow">OGS Studio · ${esc(team.teamId || team.teamRootId || team.projectId)}</div><h1>${esc(team.name || team.teamName)} <span class="version-badge">v${team.teamVersionNumber || 1}</span></h1><p>${english ? "Review role input, output, progress, and failures from each isolated debug run." : "按次回看独立调试中的角色输入、输出、进度和异常诊断。"}</p></div><span class="status-chip ${esc(team.teamVersionStatus || "draft")}">${esc(teamVersionMeta(team).label)}</span></section>${studioWorkspaceNav(teamVersionId, "run")}<section class="project-panel"><div class="panel-head"><div><span class="section-kicker">${english ? "Debug runs" : "调试记录"}</span><h2>${english ? "Debug history" : "调试历史"}</h2></div><div class="form-actions"><span class="count-badge">${simulations.length}</span>${clearable ? `<button class="secondary-button danger-button" type="button" data-clear-studio-history>${english ? "Clear finished debug runs" : "清理已完成调试记录"}</button>` : ""}</div></div><div class="material-list studio-simulation-list">${history}</div></section>`;
    bindStudioWorkspaceButtons(root);
    root.querySelector(".project-panel .panel-head h2").textContent = english ? "Debug history" : "调试历史";
    root.querySelector("[data-clear-studio-history]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const message = english ? "Remove completed, failed, and stopped interactive debug records? Sandbox release evidence and running records are protected." : "清理已结束的交互式调试记录？发布 Sandbox 证据和运行中的记录会保留。";
      if (!window.confirm(message)) return;
      button.disabled = true;
      try {
        const clearResponse = await pageFetch(`/api/v1/teams/${encodeURIComponent(team.teamId)}/versions/${encodeURIComponent(team.teamVersionId || teamVersionId)}/simulations`, { method: "DELETE" });
        const cleared = await clearResponse.json();
        if (!clearResponse.ok) throw new Error(cleared.error || "Unable to clear debug history.");
        await renderStudioRunPage(teamVersionId, pageRequest);
      } catch (error) {
        if (isAbort(error)) return;
        showToast(error.message || "清理调试历史失败");
        button.disabled = false;
      }
    });
  } catch (error) {
    if (isAbort(error)) return;
    root.innerHTML = `<div class="run-error">${esc(studioSimulationErrorText(error.message))}</div>`;
  }
}

async function renderStudioRunDetail(teamVersionId, simulationId, pageRequest = state.activeRequest) {
  const teamResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`);
  const team = await teamResponse.json();
  if (!teamResponse.ok) {
    $("#studio-view").innerHTML = `<div class="run-error">${esc(team.error || "无法读取团队版本")}</div>`;
    return;
  }
  await renderStudioSimulationDetail(team.teamId, team.teamVersionId || teamVersionId, simulationId, pageRequest);
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  addStudioWorkspaceNav($("#studio-view"), teamVersionId, "run");
}

async function renderStudioSimulationDetail(teamId, teamVersionId, simulationId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  const isRefresh = Boolean(root.querySelector(".studio-run-split"));
  const wasHistoryCollapsed = root.querySelector(".studio-run-split")?.classList.contains("is-history-collapsed") || false;
  const previousGraphStage = root.querySelector("#studio-run-graph-stage");
  if (previousGraphStage) {
    window.OGSStudioGraphBundle?.disposeStudioX6Bridge?.(previousGraphStage);
    mountedStudioGraphs.delete(previousGraphStage);
  }
  const historyScrollTop = root.querySelector(".studio-run-history")?.scrollTop || 0;
  const evidenceScrollTop = root.querySelector(".studio-run-evidence")?.scrollTop || 0;
  if (!isRefresh) {
    root.innerHTML = `<div class="project-loading">${state.locale === "en" ? "Loading simulation evidence…" : "正在读取模拟证据…"}</div>`;
  }
  try {
    const base = `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations/${encodeURIComponent(simulationId)}`;
    const simulationListPath = `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations`;
    const [detailResponse, eventsResponse, simulationsResponse, designResponse] = await Promise.all([
      pageFetch(base),
      pageFetch(`${base}/events`),
      pageFetch(simulationListPath),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/design?locale=${encodeURIComponent(state.locale)}`)
    ]);
    const detail = await detailResponse.json();
    const eventPayload = await eventsResponse.json();
    const simulationsPayload = await simulationsResponse.json();
    const designPayload = designResponse.ok ? await designResponse.json() : {};
    if (!detailResponse.ok) throw new Error(detail.error || "Studio Simulation not found.");
    if (!eventsResponse.ok) throw new Error(eventPayload.error || "Unable to load simulation events.");
    if (!simulationsResponse.ok) throw new Error(simulationsPayload.error || "Unable to load simulation history.");
    if (pageRequest && !isCurrentRequest(pageRequest)) return;
    const simulation = detail.simulation || {};
    const stateData = detail.state || {};
    const roleLabel = (roleId) => simulation.roleDisplayNames?.[roleId] || roleId;
    const evidenceText = stateData.finalOutputsByRoleId
      ? Object.entries(stateData.finalOutputsByRoleId).flatMap(([roleId, outputs]) => (outputs || []).map((output) => `${roleLabel(roleId)}: ${output.content || JSON.stringify(output.data || {})}`)).join("\n\n")
      : studioSimulationErrorText(stateData.error || simulation.failureSummary || simulation.outputSummary);
    const auditTrail = stateData.auditTrail || [];
    const auditSummary = stateData.auditSummary || simulation.auditSummary || {};
    const promptCalls = auditTrail.flatMap((item) => item.promptCalls || []);
    const sumCallMetric = (key) => promptCalls.length ? promptCalls.reduce((sum, call) => sum + (Number(call[key]) || 0), 0) : undefined;
    const metric = (key, fallback) => auditSummary[key] ?? simulation[key] ?? fallback;
    const promptChars = metric("totalRenderedPromptChars", sumCallMetric("renderedPromptChars"));
    const inputTokens = metric("totalEstimatedInputTokens", sumCallMetric("estimatedInputTokens"));
    const outputTokens = metric("totalEstimatedOutputTokens", sumCallMetric("estimatedOutputTokens"));
    const transitionCount = metric("transitionCount", simulation.transitionCount ?? ((eventPayload.events || []).filter((event) => event.type === "transition" || event.type === "flow_transition").length || undefined));
    const formatMetric = (value) => value === undefined || value === null ? "—" : Number(value).toLocaleString(state.locale);
    const runMetrics = `<section class="project-panel studio-run-metrics" aria-label="${state.locale === "en" ? "Run metrics" : "运行指标"}"><div class="studio-run-metric"><span>${state.locale === "en" ? "Transitions" : "流转步数"}</span><strong>${formatMetric(transitionCount)}</strong></div><div class="studio-run-metric"><span>${state.locale === "en" ? "Rendered prompt characters" : "完整提示词字符"}</span><strong>${formatMetric(promptChars)}</strong></div><div class="studio-run-metric"><span>${state.locale === "en" ? "Estimated input tokens" : "估算输入 Token"}</span><strong>${formatMetric(inputTokens)}</strong></div><div class="studio-run-metric"><span>${state.locale === "en" ? "Estimated output tokens" : "估算输出 Token"}</span><strong>${formatMetric(outputTokens)}</strong></div><p class="field-hint">${state.locale === "en" ? "Token values are estimates, not billing totals. A dash means this historical run did not collect the field." : "Token 数为估算值，不代表账单精确值；“—”表示此历史运行未采集该字段。"}</p></section>`;
    const back = `/studio/teams/${encodeURIComponent(teamVersionId)}/run`;
    const simulationAuthoring = designPayload.authoring || {};
    const actualHandoffsByExecution = new Map();
    const legacyHandoffsByRole = new Map();
    const completedExecutions = new Set();
    const legacyCompletedRoles = new Set();
    for (const event of runtimeEventsFromPayload(eventPayload)) {
      if (event.type !== "flow.activated" || !event.fromRoleId || !event.toRoleId
        || event.fromRoleId === "__system_start__") continue;
      const executionId = event.executionId || event.sourceExecutionId;
      if (event.toRoleId === "__system_end__") {
        if (executionId) completedExecutions.add(executionId);
        else legacyCompletedRoles.add(event.fromRoleId);
        continue;
      }
      const handoffs = executionId ? actualHandoffsByExecution : legacyHandoffsByRole;
      const key = executionId || event.fromRoleId;
      const targets = handoffs.get(key) || [];
      if (!targets.includes(event.toRoleId)) targets.push(event.toRoleId);
      handoffs.set(key, targets);
    }
    const promptTranscript = document.createElement("ol");
    appendStudioUserPrompt(promptTranscript, simulation.input, simulation.createdAt || Date.now());
    const userPromptCard = promptTranscript.innerHTML;
    const transcriptItemsHtml = auditTrail.map((item, index) => {
      const roleId = item.roleId || "system";
      const roleNameStr = roleLabel(item.roleId || "");
      const roleDef = simulationAuthoring.roles?.[item.roleId] || {};
      const backend = item.backend || roleDef.backend || "";
      const actualTargets = actualHandoffsByExecution.get(item.executionId) || legacyHandoffsByRole.get(item.roleId) || [];
      const legacyHandoffMarkup = actualTargets.length ? `<div class="team-debug-handoff-mentions">${actualTargets.map((targetRoleId) => `<div class="chat-mention-callout" data-handoff-role="${esc(targetRoleId)}" role="button" tabindex="0" title="${state.locale === "en" ? `Click to focus ${roleLabel(targetRoleId)}` : `点击聚焦到 ${roleLabel(targetRoleId)}`}"><span class="chat-mention">@${esc(roleLabel(targetRoleId))}</span></div>`).join("")}</div>` : "";
      const completionMarkup = (completedExecutions.has(item.executionId) || legacyCompletedRoles.has(item.roleId))
        ? `<div class="chat-mention-callout is-user-target" data-user-completion="true" role="status" title="${state.locale === "en" ? "The completed result is delivered to the user" : "已完成结果交付给用户"}"><span class="chat-mention">@${state.locale === "en" ? "User" : "用户"}</span><span class="chat-mention-hint">${state.locale === "en" ? "Task complete" : "任务已完成"}</span></div>`
        : "";
      const handoffMarkup = legacyHandoffMarkup ? legacyHandoffMarkup.slice(0, -6) + completionMarkup + "</div>" : completionMarkup;
      const inputText = item.inputContext ? JSON.stringify(item.inputContext, null, 2) : "";
      const outputText = item.stdoutPreview || item.failure || item.error || "";
      const calls = item.promptCalls || [];
      const callChars = calls.reduce((sum, call) => sum + (Number(call.renderedPromptChars) || 0), 0);
      const callTokens = calls.reduce((sum, call) => sum + (Number(call.estimatedInputTokens) || 0) + (Number(call.estimatedOutputTokens) || 0), 0);
      const fallbackCall = calls.find((call) => call.phase === "fallback");
      const meter = item.renderedPromptChars ?? (calls.length ? callChars : undefined);
      const projected = item.projectedInputChars ?? (calls.length ? calls.reduce((sum, call) => sum + (Number(call.projectedInputChars) || 0), 0) : undefined);
      const tokens = (item.estimatedInputTokens ?? item.estimatedOutputTokens) !== undefined ? `${item.estimatedInputTokens ?? 0} / ${item.estimatedOutputTokens ?? 0}` : calls.length ? String(callTokens) : undefined;
      const isolation = item.externalDataIsolated === true ? (state.locale === "en" ? "External data isolated" : "外部数据已分隔") : item.externalDataIsolated === false ? (state.locale === "en" ? "External data not isolated" : "外部数据未分隔") : (state.locale === "en" ? "Isolation not recorded" : "隔离状态未采集");
      const fallbackLabel = item.fallbackUsed || fallbackCall ? `${state.locale === "en" ? "Fallback model" : "备选模型"}: ${fallbackCall?.modelId || "—"} (${state.locale === "en" ? "primary" : "主模型"}: ${item.primaryModelId || "—"})` : "";
      const bodyMarkup = `<div class="studio-audit-badges"><span>${esc(isolation)}</span>${fallbackLabel ? `<span>${esc(fallbackLabel)}</span>` : ""}${projected !== undefined ? `<span>${state.locale === "en" ? "Projected input" : "输入数据"}: ${formatMetric(projected)} ${state.locale === "en" ? "chars" : "字符"}</span>` : ""}${meter !== undefined ? `<span>${state.locale === "en" ? "Prompt" : "提示词"}: ${formatMetric(meter)} ${state.locale === "en" ? "chars" : "字符"}</span>` : `<span>${state.locale === "en" ? "Prompt: not recorded" : "提示词：未采集"}</span>`}${tokens !== undefined ? `<span>${state.locale === "en" ? "Estimated input / output tokens" : "估算输入 / 输出 Token"}: ${esc(tokens)}</span>` : ""}</div>${inputText ? `<section><small>${state.locale === "en" ? "Input" : "收到的任务"}</small><pre>${esc(inputText)}</pre></section>` : `<p class="form-hint">${state.locale === "en" ? "Input details were not collected for this activation." : "此角色激活未采集详细输入。"}</p>`}${outputText ? (item.failure || item.error ? studioTranscriptSectionMarkup(state.locale === "en" ? "Failure" : "异常诊断", studioSimulationErrorText(outputText)) : studioTranscriptSectionMarkup(state.locale === "en" ? "Output" : "执行输出", outputText)) : `<p class="form-hint">${state.locale === "en" ? "Output details were not collected for this activation." : "此角色激活未采集详细输出。"}</p>`}${item.errorEnvelope ? `<details><summary>${state.locale === "en" ? "Failure diagnostics" : "失败诊断详情"}</summary><pre>${esc(JSON.stringify(item.errorEnvelope, null, 2))}</pre></details>` : ""}`;
      return studioRuntimeRoleCardMarkup({ event: { ...item, roleId }, roleName: roleNameStr, backend, authoring: simulationAuthoring, auditIndex: index, bodyMarkup, handoffMarkup, statusLabel: `${studioSimulationEventTime(item)} · ${studioSimulationStatus(item.status || "unknown")}`, focusableAvatar: false });
    }).join("") || `<li class="empty-note">${state.locale === "en" ? "No role execution trace was collected." : "未采集到角色执行流水。"}</li>`;
    const transcriptHtml = `${userPromptCard}${transcriptItemsHtml}`;
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="${back}" data-route="${back}">← ${state.locale === "en" ? "Debug history" : "调试历史"}</a><div class="eyebrow">${esc(simulation.teamId || teamId)} · ${esc(simulation.teamVersionId || teamVersionId)}</div><h1>${state.locale === "en" ? "Debug run" : "调试运行"}</h1><p>${esc(simulation.createdAt || "")}</p></div><span class="status-chip ${esc(simulation.status)}">${esc(studioSimulationStatus(simulation.status))}</span></section>${runMetrics}<div class="studio-dual-core-bar"><div class="studio-dual-core-meta"><button type="button" class="secondary-button studio-history-expand-btn" data-history-toggle="expand" title="${state.locale === "en" ? "Expand history drawer" : "展开调试历史"}" aria-label="${state.locale === "en" ? "Expand history drawer" : "展开调试历史"}">▶ ${state.locale === "en" ? "History" : "历史"}</button><strong>${state.locale === "en" ? "Macro / Micro Twin Core Cockpit" : "宏微双核联动视窗"}</strong><span class="field-hint">${state.locale === "en" ? "Macro topological view & micro role chat content" : "宏观拓扑结构与微观角色对话同屏联动"}</span></div><div class="studio-layout-switcher" role="radiogroup" aria-label="${state.locale === "en" ? "Layout preference" : "宏微双核布局"}"><button type="button" class="studio-layout-switcher-btn" data-preference="structure-focus" title="${state.locale === "en" ? "Focus on Structure (60:40)" : "突出结构 (60:40)"}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="10" height="18" rx="2"/><rect x="15" y="3" width="6" height="18" rx="2"/></svg><span>${state.locale === "en" ? "Structure" : "突出结构"}</span></button><button type="button" class="studio-layout-switcher-btn" data-preference="balanced" title="${state.locale === "en" ? "Balanced Dual-Core (50:50)" : "双核并重 (50:50)"}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="18" rx="2"/><rect x="13" y="3" width="8" height="18" rx="2"/></svg><span>${state.locale === "en" ? "Balanced" : "双核并重"}</span></button><button type="button" class="studio-layout-switcher-btn is-active" data-preference="content-focus" title="${state.locale === "en" ? "Focus on Content (40:60)" : "突出内容 (40:60)"}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="6" height="18" rx="2"/><rect x="11" y="3" width="10" height="18" rx="2"/></svg><span>${state.locale === "en" ? "Content" : "突出内容"}</span></button></div></div><div class="studio-run-dual-core" data-layout-preference="content-focus"><section class="studio-run-macro-panel detail-graph-section project-panel"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Macro view" : "宏观拓扑"}</span><h2>${state.locale === "en" ? "Read-only execution view" : "只读运行视图"}</h2></div><div class="panel-head-actions"><span class="status-chip">${state.locale === "en" ? "Read-only" : "只读"}</span><button type="button" class="studio-panel-maximize-btn" data-panel-maximize="macro" title="${state.locale === "en" ? "Maximize Macro Graph" : "最大化宏观图谱"}" aria-label="${state.locale === "en" ? "Maximize Macro Graph" : "最大化宏观图谱"}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div></div><div id="studio-run-graph-stage" class="graph-stage studio-run-graph-stage" role="application" aria-label="${state.locale === "en" ? "Historical runtime graph" : "历史运行图谱"}"></div></section><section class="studio-run-micro-panel project-panel studio-debug-detail"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Micro view" : "微观内容"}</span><h2>${state.locale === "en" ? "Role execution trace" : "角色执行过程"}</h2></div><div class="panel-head-actions"><span class="count-badge">${auditTrail.length}</span><button type="button" class="studio-panel-maximize-btn" data-panel-maximize="micro" title="${state.locale === "en" ? "Maximize Micro Chat" : "最大化微观群聊"}" aria-label="${state.locale === "en" ? "Maximize Micro Chat" : "最大化微观群聊"}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div></div><div class="team-debug-transcript-wrap"><ol class="team-debug-transcript">${transcriptHtml}</ol></div></section></div><section class="project-grid"><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Input" : "输入"}</span><h2>${state.locale === "en" ? "Debug request" : "调试任务"}</h2></div></div><pre>${esc(simulation.input || "")}</pre></article><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Result" : "结果"}</span><h2>${state.locale === "en" ? "Final outputs" : "最终结果"}</h2></div></div><pre>${esc(evidenceText || studioSimulationErrorText(stateData.error || simulation.failureSummary || ""))}</pre></article></section><section class="project-panel"><div class="panel-head"><div><span class="section-kicker">${state.locale === "en" ? "Events" : "事件"}</span><h2>${state.locale === "en" ? "Simulation events" : "调试事件"}</h2></div><span class="count-badge">${(eventPayload.events || []).length}</span></div><ol class="studio-event-list">${(eventPayload.events || []).map((event) => `<li data-role-id="${esc(event.roleId || "")}" data-edge-id="${esc(event.edgeId || event.flowId || "")}"><time>${esc(studioSimulationEventTime(event))}</time><strong>${esc(event.type || "event")}${event.status ? ` · ${esc(studioSimulationStatus(event.status))}` : ""}</strong>${event.roleId ? `<span>${esc(roleLabel(event.roleId))}</span>` : ""}${event.failure ? `<span>${esc(studioSimulationErrorText(event.failure))}</span>` : ""}</li>`).join("")}</ol></section><p class="form-hint">${state.locale === "en" ? "Studio debug runs are isolated from Project Runs. Evidence is read-only." : "Studio 调试与项目运行隔离保存，证据为只读。"}</p><aside id="studio-audit-drilldown-drawer" class="studio-audit-drilldown-drawer" aria-label="${state.locale === "en" ? "Audit Drilldown" : "审计下钻明细"}" hidden><div class="studio-audit-drawer-head"><div><span class="section-kicker">${state.locale === "en" ? "Audit drilldown" : "深度审计下钻"}</span><h3 data-audit-drawer-title>${state.locale === "en" ? "Role Activation Audit" : "角色激活审计明细"}</h3></div><button type="button" class="close-button" data-audit-drawer-close aria-label="${state.locale === "en" ? "Close" : "关闭"}">×</button></div><div class="studio-audit-drawer-tabs" role="tablist"><button type="button" class="studio-audit-drawer-tab is-active" data-audit-tab="telemetry" role="tab" aria-selected="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg><span>${state.locale === "en" ? "Telemetry" : "调用明细"}</span></button><button type="button" class="studio-audit-drawer-tab" data-audit-tab="input" role="tab" aria-selected="false"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg><span>${state.locale === "en" ? "Input Context" : "输入上下文"}</span></button><button type="button" class="studio-audit-drawer-tab" data-audit-tab="output" role="tab" aria-selected="false"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>${state.locale === "en" ? "Output" : "执行交付"}</span></button><button type="button" class="studio-audit-drawer-tab" data-audit-tab="diagnostics" role="tab" aria-selected="false"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${state.locale === "en" ? "Diagnostics" : "失败诊断"}</span></button><button type="button" class="studio-audit-drawer-tab" data-audit-tab="raw" role="tab" aria-selected="false"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg><span>${state.locale === "en" ? "Raw JSON" : "原始数据"}</span></button></div><div class="studio-audit-drawer-body" data-audit-drawer-body></div><div class="studio-audit-drawer-foot"><button type="button" class="secondary-button" data-audit-action="focus-node"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg><span>${state.locale === "en" ? "Focus Node" : "定位图谱节点"}</span></button><button type="button" class="secondary-button" data-audit-action="copy-json"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>${state.locale === "en" ? "Copy JSON" : "复制 JSON"}</span></button><button type="button" class="primary-button" data-audit-drawer-close>${state.locale === "en" ? "Close" : "关闭"}</button></div></aside>`;
    root.querySelector(".studio-layout-switcher")?.remove();
    root.querySelector(".studio-run-dual-core")?.setAttribute("data-layout-preference", "balanced");
    root.querySelector("#studio-audit-drilldown-drawer")?.setAttribute("data-studio-runtime-audit-drawer", "");
    root.querySelectorAll(".team-debug-transcript > li[data-audit-index]").forEach((card) => {
      card._studioAuditItem = auditTrail[Number(card.dataset.auditIndex)];
    });
    root.querySelectorAll(".team-debug-transcript section:not([data-studio-message-section])").forEach((section) => {
      const label = section.querySelector("small")?.textContent || (state.locale === "en" ? "Details" : "详情");
      const pre = section.querySelector("pre");
      if (!pre) return;
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = label;
      details.append(summary, pre);
      section.replaceWith(details);
    });
    root.addEventListener("click", (event) => {
      const more = event.target.closest?.("[data-studio-message-more]");
      if (!more) return;
      const section = more.closest("[data-studio-message-section]");
      const pre = section?.querySelector("pre");
      if (!pre) return;
      const expanded = more.getAttribute("aria-expanded") === "true";
      pre.hidden = expanded;
      more.setAttribute("aria-expanded", String(!expanded));
      more.textContent = expanded ? (state.locale === "en" ? "More" : "更多") : (state.locale === "en" ? "Less" : "收起");
    });
    const historyGraphStage = root.querySelector("#studio-run-graph-stage");
    let historyGraph;
    const focusHistoryEntry = ({ roleId = "", edgeId = "" } = {}) => {
      const entries = [...root.querySelectorAll(".team-debug-transcript > li, .studio-event-list > li")];
      const entry = entries.find((candidate) => (roleId && candidate.dataset.roleId === roleId)
        || (edgeId && candidate.dataset.edgeId === edgeId));
      if (!entry) return;
      entry.scrollIntoView({ block: "center", behavior: "smooth" });
      entry.focus({ preventScroll: true });
      entry.classList.add("is-runtime-focus-entry");
      window.setTimeout(() => entry.classList.remove("is-runtime-focus-entry"), 900);
    };
    if (historyGraphStage && designPayload.viewModel) {
      trackStudioGraphRoot(historyGraphStage);
      try {
        await ensureStudioGraphBundle();
        if (historyGraphStage.isConnected && (!pageRequest || isCurrentRequest(pageRequest))) {
          historyGraph = mountStudioGraph(historyGraphStage, {
            mode: "run-diagnosis",
            viewModel: designPayload.viewModel,
            readOnly: true,
            runtimeProgress: runtimeEventsFromPayload(eventPayload),
            showTopologyOrder: false,
            showTechnicalDetails: false,
            initialLayoutMode: "flow",
            defaultAutoLayout: true,
            defaultAutoLayoutRequestId: 1,
            labels: graphLabels[state.locale],
            onSelectRole: (roleId) => focusHistoryEntry({ roleId }),
            onSelectFlow: (flowKey) => focusHistoryEntry({ edgeId: flowKey }),
            onToggleFullscreen: async () => {
              if (document.fullscreenElement) await document.exitFullscreen();
              else await historyGraphStage.requestFullscreen();
            }
          });
        }
      } catch (error) {
        if (!isAbort(error)) historyGraphStage.textContent = error.message || (state.locale === "en" ? "Runtime graph unavailable." : "运行图谱不可用。");
      }
    }
    bindStudioRuntimeAuditDrawer(root, historyGraph, roleLabel, (roleId) => focusHistoryEntry({ roleId }));
    root.querySelectorAll(".team-debug-transcript > li[data-role-id]").forEach((entry) => {
      entry.addEventListener("click", (event) => {
        if (event.target.closest?.("[data-runtime-audit-open], [data-handoff-role]")) return;
        const roleId = entry.dataset.roleId || "";
        historyGraph?.update({ selectedRoleId: roleId, selectedFlowKey: "" });
        historyGraph?.focusRoleNode?.(roleId);
      });
      entry.addEventListener("keydown", (event) => {
        if (event.target !== entry || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        entry.click();
      });
    });
    const dualCoreContainer = root.querySelector(".studio-run-dual-core");
    if (dualCoreContainer && !dualCoreContainer.querySelector("[data-runtime-split-handle]")) {
      dualCoreContainer.insertAdjacentHTML("beforeend", `<button type="button" class="studio-runtime-split-handle" data-runtime-split-handle aria-label="${state.locale === "en" ? "Resize graph and chat panels" : "调整图谱和群聊面板宽度"}" title="${state.locale === "en" ? "Resize graph and chat panels" : "调整图谱和群聊面板宽度"}"><span aria-hidden="true"></span></button>`);
      const splitHandle = dualCoreContainer.querySelector("[data-runtime-split-handle]");
      let splitDrag = null;
      let splitRaf = null;
      splitHandle?.addEventListener("pointerdown", (event) => {
        if (window.matchMedia?.("(max-width: 768px)").matches) return;
        dualCoreContainer.classList.add("is-split-dragging");
        const bounds = dualCoreContainer.getBoundingClientRect();
        splitDrag = { pointerId: event.pointerId, left: bounds.left, width: bounds.width };
        splitHandle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      splitHandle?.addEventListener("pointermove", (event) => {
        if (!splitDrag || event.pointerId !== splitDrag.pointerId) return;
        const ratio = Math.min(0.7, Math.max(0.3, (event.clientX - splitDrag.left) / splitDrag.width));
        dualCoreContainer.style.setProperty("--studio-runtime-split", `${Math.round(ratio * 100)}%`);
        if (!splitRaf) {
          splitRaf = window.requestAnimationFrame(() => {
            splitRaf = null;
            historyGraph?.fitViewport?.();
          });
        }
      });
      const finishSplitDrag = (event) => {
        if (splitDrag?.pointerId === event.pointerId) {
          splitDrag = null;
          dualCoreContainer.classList.remove("is-split-dragging");
          if (splitRaf) {
            window.cancelAnimationFrame(splitRaf);
            splitRaf = null;
          }
          historyGraph?.fitViewport?.();
        }
      };
      splitHandle?.addEventListener("pointerup", finishSplitDrag);
      splitHandle?.addEventListener("pointercancel", finishSplitDrag);
      splitHandle?.addEventListener("keydown", (event) => {
        const delta = event.shiftKey ? 0.08 : 0.04;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const current = Number.parseFloat(getComputedStyle(dualCoreContainer).getPropertyValue("--studio-runtime-split")) || 50;
        const next = Math.min(70, Math.max(30, current + (event.key === "ArrowRight" ? delta * 100 : -delta * 100)));
        dualCoreContainer.style.setProperty("--studio-runtime-split", `${next}%`);
        historyGraph?.fitViewport?.();
      });
    }
    const maximizeBtns = root.querySelectorAll(".studio-panel-maximize-btn");

    maximizeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!dualCoreContainer) return;
        const panel = btn.dataset.panelMaximize;
        const currentMode = dualCoreContainer.dataset.maximizeMode;
        if (currentMode === panel) {
          delete dualCoreContainer.dataset.maximizeMode;
          btn.classList.remove("is-maximized");
          btn.title = panel === "macro"
            ? (state.locale === "en" ? "Maximize Macro Graph" : "最大化宏观图谱")
            : (state.locale === "en" ? "Maximize Micro Chat" : "最大化微观群聊");
        } else {
          dualCoreContainer.dataset.maximizeMode = panel;
          maximizeBtns.forEach((b) => {
            const isTarget = b === btn;
            b.classList.toggle("is-maximized", isTarget);
            b.title = isTarget
              ? (state.locale === "en" ? "Restore Dual-Core Split" : "还原双核分栏")
              : (b.dataset.panelMaximize === "macro" ? "最大化宏观图谱" : "最大化微观群聊");
          });
        }
        window.setTimeout(() => {
          historyGraph?.update({});
          window.dispatchEvent(new Event("resize"));
        }, 60);
      });
    });

    const workspaceAvailable = Boolean(simulationsPayload.workspaceAvailable || simulation.workspaceAvailable);
    const workspaceLabel = state.locale === "en" ? "Open workspace" : "工作目录";
    const auditLabel = state.locale === "en" ? "Run audit" : "运行审计";
    const workspaceUnavailableTitle = state.locale === "en" ? "No workspace is bound to this TeamVersion" : "此团队版本尚未绑定工作目录";
    const workspaceOpenPath = `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/workspace/open-directory`;
    const heading = root.querySelector(".page-heading");
    const statusNode = heading?.querySelector(".status-chip");
    if (heading && statusNode) {
      const actions = document.createElement("div");
      actions.className = "page-heading-actions";
      actions.append(statusNode);
      const openDrawerButton = document.createElement("button");
      openDrawerButton.type = "button";
      openDrawerButton.className = "secondary-button";
      openDrawerButton.textContent = state.locale === "en" ? "View Artifacts" : "产物速览";
      actions.append(openDrawerButton);
      const artifactsLink = document.createElement("a");
      artifactsLink.className = "secondary-button";
      artifactsLink.href = studioArtifactsBrowserUrl(teamVersionId, simulationId, simulation.teamId);
      artifactsLink.target = "_blank";
      artifactsLink.rel = "noreferrer";
      artifactsLink.textContent = auditLabel;
      actions.append(artifactsLink);
      const workspaceButton = document.createElement("button");
      workspaceButton.type = "button";
      workspaceButton.className = "secondary-button studio-history-action";
      workspaceButton.dataset.openWorkspace = workspaceOpenPath;
      workspaceButton.disabled = !workspaceAvailable;
      workspaceButton.title = workspaceAvailable ? workspaceLabel : workspaceUnavailableTitle;
      workspaceButton.textContent = workspaceLabel;
      actions.append(workspaceButton);
      heading.append(actions);

      root.insertAdjacentHTML("beforeend", `<aside id="studio-simulation-artifact-drawer" class="studio-asset-drawer studio-artifact-drawer" aria-label="运行产物" hidden><div class="studio-asset-drawer-head"><strong>${state.locale === "en" ? "Run Artifacts" : "本次运行产物"}</strong><button type="button" class="close-button" data-artifact-drawer-close aria-label="关闭">×</button></div><div class="studio-artifact-drawer-body"><div class="studio-artifact-drawer-list"><p class="project-loading">${state.locale === "en" ? "Loading artifacts…" : "正在读取产物…"}</p></div><div class="studio-artifact-drawer-preview"><div class="panel-head"><strong data-drawer-artifact-title>${state.locale === "en" ? "Select an artifact" : "选择产物查看内容"}</strong><a class="secondary-button" data-drawer-artifact-download href="#" hidden target="_blank">${state.locale === "en" ? "Download" : "下载"}</a></div><pre data-drawer-artifact-content>${state.locale === "en" ? "Select an artifact from the list to preview." : "从列表中选择产物以查看内容。"}</pre></div></div></aside>`);

      openDrawerButton.addEventListener("click", async () => {
        const drawer = root.querySelector("#studio-simulation-artifact-drawer");
        if (!drawer) return;
        drawer.hidden = !drawer.hidden;
        if (!drawer.hidden) {
          const listContainer = drawer.querySelector(".studio-artifact-drawer-list");
          const titleEl = drawer.querySelector("[data-drawer-artifact-title]");
          const contentEl = drawer.querySelector("[data-drawer-artifact-content]");
          const downloadLink = drawer.querySelector("[data-drawer-artifact-download]");
          listContainer.innerHTML = `<p class="project-loading">${state.locale === "en" ? "Loading artifacts…" : "正在读取产物…"}</p>`;
          try {
            const apiBase = `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations/${encodeURIComponent(simulationId)}/artifacts`;
            const resp = await pageFetch(apiBase);
            const payload = await resp.json();
            const entries = (Array.isArray(payload.entries) ? payload.entries : []).filter((entry) => {
              const p = String(entry.path || "");
              return /^roles\/[^/]+\/(?:outbox\.md|result\.json)$/.test(p) || /^roles\/[^/]+\/executions\/[^/]+\/execution-outcome\.json$/.test(p);
            });
            if (!entries.length) {
              listContainer.innerHTML = `<p class="empty-note">${state.locale === "en" ? "No artifacts found." : "本次运行暂无可展示产物。"}</p>`;
              return;
            }
            listContainer.innerHTML = entries.map((entry, idx) => `<button type="button" class="studio-artifact-drawer-entry${idx === 0 ? " selected" : ""}" data-artifact-path="${esc(entry.path)}"><strong>${esc(entry.path)}</strong><span>${Number(entry.size || 0).toLocaleString()} bytes</span></button>`).join("");
            const selectEntry = async (entry, btn) => {
              listContainer.querySelectorAll(".studio-artifact-drawer-entry").forEach((b) => b.classList.toggle("selected", b === btn));
              titleEl.textContent = entry.path;
              const rawUrl = `${apiBase}/${entry.path.split("/").map(encodeURIComponent).join("/")}`;
              downloadLink.hidden = false;
              downloadLink.href = `${rawUrl}?download=1`;
              contentEl.textContent = state.locale === "en" ? "Reading file…" : "正在读取文件…";
              try {
                const fileResp = await pageFetch(rawUrl);
                contentEl.textContent = fileResp.ok ? await fileResp.text() : "无法读取该文件。";
              } catch (err) {
                contentEl.textContent = err.message || "无法读取该文件。";
              }
            };
            const btns = [...listContainer.querySelectorAll("[data-artifact-path]")];
            btns.forEach((btn, idx) => btn.addEventListener("click", () => selectEntry(entries[idx], btn)));
            if (entries[0]) await selectEntry(entries[0], btns[0]);
          } catch (err) {
            listContainer.innerHTML = `<p class="run-error">${esc(err.message || "无法读取产物")}</p>`;
          }
        }
      });
      root.querySelector("[data-artifact-drawer-close]")?.addEventListener("click", () => {
        const drawer = root.querySelector("#studio-simulation-artifact-drawer");
        if (drawer) drawer.hidden = true;
      });
    }
    const list = (simulationsPayload.simulations || []).map((item) => {
      const href = `/studio/teams/${encodeURIComponent(teamVersionId)}/run/${encodeURIComponent(item.simulationId)}`;
      const selected = item.simulationId === simulationId;
      const itemAuditHref = studioArtifactsBrowserUrl(teamVersionId, item.simulationId, item.teamId || teamId);
      return `<div class="material-row studio-simulation-row${selected ? " selected" : ""}"${selected ? ' aria-current="page"' : ""}><a class="studio-simulation-link" href="${href}" data-route="${href}"${selected ? ' aria-current="page"' : ""}><div><strong>${esc(item.input || "调试任务")}</strong><div class="task-record-meta"><span class="status-chip ${esc(item.status)}">${esc(studioSimulationStatus(item.status))}</span><span class="run-mode-chip">${esc(studioSimulationModeLabel(item.mode))}</span><span>${esc(item.createdAt || "")}</span></div></div></a><div class="studio-history-actions" aria-label="${state.locale === "en" ? "Simulation actions" : "运行操作"}"><a class="secondary-button studio-history-action" href="${itemAuditHref}" target="_blank" rel="noreferrer">${auditLabel}</a><button type="button" class="secondary-button studio-history-action" data-open-workspace="${workspaceOpenPath}"${workspaceAvailable ? "" : ` disabled title="${workspaceUnavailableTitle}"`}>${workspaceLabel}</button></div></div>`;
    }).join("");
    const detailBody = document.createElement("div");
    detailBody.className = "studio-run-evidence";
    while (root.children.length > 1) detailBody.append(root.children[1]);
    const split = document.createElement("div");
    split.className = "studio-run-split";
    if (wasHistoryCollapsed) split.classList.add("is-history-collapsed");
    split.innerHTML = `<aside class="studio-run-history" data-layout-scroll><div class="studio-run-history-head"><h2>${state.locale === "en" ? "Debug history" : "调试历史"}</h2><button type="button" class="studio-history-collapse-btn" data-history-toggle="collapse" title="${state.locale === "en" ? "Collapse history drawer" : "收起调试历史"}" aria-label="${state.locale === "en" ? "Collapse history drawer" : "收起调试历史"}">◀</button></div>${list || `<p class="empty-note">暂无其他调试记录。</p>`}</aside>`;
    split.append(detailBody);
    root.append(split);
    split.querySelectorAll("[data-history-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const collapsed = split.classList.toggle("is-history-collapsed");
        split.querySelectorAll("[data-history-toggle]").forEach((b) => b.setAttribute("aria-expanded", String(!collapsed)));
        window.setTimeout(() => {
          historyGraph?.fitViewport?.();
          window.dispatchEvent(new Event("resize"));
        }, 240);
      });
    });
    bindStudioWorkspaceButtons(root);
    addStudioWorkspaceNav(root, teamVersionId, "run");
    if (isRefresh && root.dataset.template) {
      frameExistingPage(root, root.dataset.template);
    }
    const historyNode = root.querySelector(".studio-run-history");
    const evidenceNode = root.querySelector(".studio-run-evidence");
    if (historyNode) historyNode.scrollTop = historyScrollTop;
    if (evidenceNode) evidenceNode.scrollTop = evidenceScrollTop;
    if (simulation.status === "running" && (!pageRequest || isCurrentRequest(pageRequest))) {
      let cursor = Number(eventPayload.cursor || 0);
      const collectedEvents = runtimeEventsFromPayload(eventPayload);
      const poll = async () => {
        if (!root.isConnected || (pageRequest && !isCurrentRequest(pageRequest))) return;
        try {
          const [nextEventsResponse, latestResponse] = await Promise.all([
            pageFetch(`${base}/events?afterCursor=${cursor}`),
            pageFetch(base)
          ]);
          const nextEventsPayload = await nextEventsResponse.json();
          const latestPayload = await latestResponse.json();
          if (!nextEventsResponse.ok || !latestResponse.ok) throw new Error(nextEventsPayload.error || latestPayload.error || "Unable to refresh simulation progress.");
          const incoming = runtimeEventsFromPayload(nextEventsPayload);
          collectedEvents.push(...incoming);
          cursor = Number(nextEventsPayload.cursor || cursor);
          historyGraph?.setRuntimeProgress(collectedEvents);
          const latestSimulation = latestPayload.simulation || simulation;
          const status = latestSimulation.status || "running";
          const currentStatus = root.querySelector(".page-heading .status-chip");
          if (currentStatus) {
            currentStatus.className = `status-chip ${esc(status)}`;
            currentStatus.textContent = studioSimulationStatus(status);
          }
          if (nextEventsPayload.done || status !== "running") {
            await renderStudioSimulationDetail(teamId, teamVersionId, simulationId, pageRequest);
            return;
          }
          window.setTimeout(poll, 800);
        } catch (error) {
          if (!isAbort(error) && root.isConnected && (!pageRequest || isCurrentRequest(pageRequest))) window.setTimeout(poll, 1600);
        }
      };
      window.setTimeout(poll, 800);
    }
  } catch (error) {
    if (isAbort(error)) return;
    root.innerHTML = `<div class="run-error">${esc(studioSimulationErrorText(error.message))}</div>`;
  }
}

async function renderStudioReleaseGate(teamVersionId, pageRequest = state.activeRequest) {
  const root = $("#studio-view");
  const english = state.locale === "en";
  if (!root.querySelector(".page-heading")) root.innerHTML = `<div class="project-loading">${english ? "Checking TeamVersion configuration…" : "正在检查团队版本配置…"}</div>`;
  try {
    const [teamResponse, designResponse, baselineResponse, readinessResponse, batchResponse, comparisonResponse] = await Promise.all([
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/design?locale=${encodeURIComponent(state.locale)}`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/release-baselines`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/release-readiness`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/release-baselines/batches/latest`),
      pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/release-baselines/comparison`)
    ]);
    const team = await teamResponse.json();
    const design = await designResponse.json();
    const baselinePayload = await baselineResponse.json();
    const readiness = await readinessResponse.json();
    const batchPayload = batchResponse.ok ? await batchResponse.json() : {};
    const comparisonPayload = comparisonResponse.ok ? await comparisonResponse.json() : {};
    if (!teamResponse.ok) throw new Error(team.error || "TeamVersion not found.");
    if (!designResponse.ok) throw new Error(design.error || "Unable to read TeamVersion design.");
    if (!baselineResponse.ok) throw new Error(baselinePayload.error || "Unable to read release baselines.");
    if (!readinessResponse.ok) throw new Error(readiness.error || "Unable to verify release readiness.");
    const baselines = baselinePayload.scenarios || [];
    const latestBatch = batchPayload.batch || batchPayload.latestBatch || batchPayload;
    const comparisonTargetSource = comparisonPayload.availableTargets || [];
    const comparisonTargets = Array.isArray(comparisonTargetSource)
      ? comparisonTargetSource
      : Object.entries(comparisonTargetSource).filter(([, value]) => value).map(([target, value]) => ({ ...value, target }));
    const comparisonTargetKey = (target) => typeof target === "string" ? target : target?.target || target?.id || target?.key || "";
    const selectedComparisonKey = comparisonTargetKey(comparisonPayload.selectedTarget) || comparisonTargetKey(comparisonTargets[0]);
    const simulationsResponse = await pageFetch(`/api/v1/teams/${encodeURIComponent(team.teamId)}/versions/${encodeURIComponent(team.teamVersionId || teamVersionId)}/simulations`);
    const simulationPayload = await simulationsResponse.json();
    if (!simulationsResponse.ok) throw new Error(simulationPayload.error || "Unable to verify Sandbox evidence.");
    const simulations = simulationPayload.simulations || [];
    const validationResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/design/validate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ authoring: design.authoring })
    });
    const validation = await validationResponse.json();
    if (!validationResponse.ok) throw new Error(validation.error || "Unable to validate TeamVersion.");
    if (pageRequest && !isCurrentRequest(pageRequest)) return;
    const passed = validation.ok !== false;
    const released = team.teamVersionStatus === "released";
    const baselineEvidenceReady = readiness.ready === true;
    const adjustmentParams = new URLSearchParams(location.search);
    const collaborationProjectId = adjustmentParams.get("collaborationProjectId");
    const back = `/studio/teams/${encodeURIComponent(teamVersionId)}/design${location.search}`;
    const diagnostics = (validation.diagnostics || []).map((item) => `<li>${esc(item.message || item.code || item)}</li>`).join("");
    const releaseBlocker = !passed
      ? (english ? "Fix the static configuration issues above before release." : "请先修复上方的结构校验问题，再发布团队版本。")
      : !baselineEvidenceReady
        ? (english ? "Run every required Sandbox baseline for this exact TeamVersion before release." : "请先为当前团队版本运行全部必跑 Sandbox 基线场景，再发布。")
        : "";
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← ${english ? "Team repository" : "团队仓库"}</a><div class="eyebrow">OGS Studio · ${esc(team.teamId || team.teamRootId || team.projectId)}</div><h1>${esc(team.name || team.teamName)} <span class="version-badge">v${team.teamVersionNumber || 1}</span></h1><p>${english ? "Release gate: review static structure and sandboxed baselines before publishing." : "发布门禁：在正式发布前完成静态图谱与沙箱基线检查。"}</p></div><span class="status-chip ${released ? "released" : passed ? "completed" : "warning"}">${released ? (english ? "Released" : "已发布") : passed ? (english ? "Validation passed" : "静态校验通过") : (english ? "Needs changes" : "需要修改")}</span></section><section class="project-panel"><div class="panel-head"><div><span class="section-kicker">${english ? "Static configuration check" : "静态配置检查"}</span><h2>${english ? "Release gate" : "发布检查"} · ${passed ? (english ? "TeamVersion is structurally valid" : "团队版本结构有效") : (english ? "Resolve the reported issues" : "请先处理以下问题")}</h2></div></div><p class="panel-intro">${english ? "This check covers the saved graph and role bindings. It does not verify external network access or credentials; isolated execution checks those at runtime." : "此检查覆盖已保存的图结构和角色绑定，不验证外部网络或凭据是否连通；隔离运行时会再次检查实际可用性。"}</p>${diagnostics ? `<ul class="studio-event-list">${diagnostics}</ul>` : `<p class="form-status" role="status">${english ? "No static configuration issues were reported." : "未发现静态配置问题。"}</p>`}${releaseBlocker ? `<p class="form-status" role="status">${releaseBlocker}</p>` : ""}<p class="form-status" id="studio-release-status" role="status" aria-live="polite"></p><div class="form-actions">${released ? `<span class="form-hint">${english ? "This TeamVersion is already released and remains immutable." : "此团队版本已发布且不可变。"}</span>` : `<button class="primary-button" id="studio-release-button" type="button" ${passed ? "" : "disabled"}>${english ? "Release TeamVersion" : "发布团队版本"}</button>`}</div></section>`;
    const releaseButtonState = $("#studio-release-button");
    if (releaseButtonState && !released && (!passed || !baselineEvidenceReady)) releaseButtonState.disabled = true;
    const t = (en, zh) => english ? en : zh;
    const requiredBaselines = baselines.filter((scenario) => scenario.requiredForRelease !== false);
    const hasEvidence = (scenario) => simulations.some((item) => item.status === "completed" && item.mode === "sandbox" && item.runKind === "studio_simulation" && item.teamVersionId === teamVersionId && item.teamDigestVersion === readiness.teamDigestVersion && item.teamCoreDigest === readiness.teamCoreDigest && item.baselineScenarioId === scenario.scenarioId && item.baselineRevision === scenario.revision && item.baselineScenarioDigest === scenario.scenarioDigest);
    const batchItems = latestBatch?.items || latestBatch?.scenarios || [];
    const failedBatchCount = batchItems.filter((item) => ["failed", "interrupted"].includes(item.status)).length;
    const missingBaselineCount = requiredBaselines.filter((scenario) => !hasEvidence(scenario)).length;
    const batchIsRunning = latestBatch?.status === "running";
    const batchProgress = Number.isFinite(latestBatch?.completedCount) ? latestBatch.completedCount : batchItems.filter((item) => ["completed", "failed", "interrupted", "cancelled", "skipped"].includes(item.status)).length;
    const batchTotal = Number.isFinite(latestBatch?.totalCount) ? latestBatch.totalCount : batchItems.length;
    const batchStatusText = (batch, progress = batchProgress, total = batchTotal) => {
      if (!batch || !batch.status) return t("No batch has been run.", "尚未运行基线批次。");
      if (batch.status === "invalidated") return t("Batch invalidated: TeamVersion or baseline scenarios changed during execution. Run the pending scenarios again.", "批次已失效：团队配置或基线场景在执行期间发生变更，请重新运行待验证场景。");
      if (batch.status === "running") return `${t("Running batch", "正在运行批次")} · ${progress}/${total}${batch.currentScenarioName ? ` · ${esc(batch.currentScenarioName)}` : ""}`;
      return `${t("Latest batch", "最近批次")}: ${esc(batch.status)}${batch.failureCode ? ` · ${esc(batch.failureCode)}` : ""}`;
    };
    const targetOption = (target) => {
      const key = comparisonTargetKey(target);
      const label = target?.label || (target?.target === "parent_version" ? t(`Parent version v${target.version || ""}`, `父版本 v${target.version || ""}`) : target?.target === "latest_released" ? t(`Latest released v${target.version || ""}`, `最新发布版本 v${target.version || ""}`) : target?.name || key);
      return `<option value="${esc(key)}" ${key === selectedComparisonKey ? "selected" : ""}>${esc(label)}</option>`;
    };
    const comparisonRows = (payload) => (payload.scenarios || payload.comparisons || []).map((item) => `<li data-comparison-scenario="${esc(item.scenarioId || "")}"><strong>${esc(item.name || item.scenarioId || "")}</strong><span>${item.revisionChanged ? t("Scenario revised", "场景已修订") : item.regression ? t("Regression", "出现退化") : t("No regression", "未发现退化")}</span><small>${t("Current", "当前版本")}: ${item.current?.passed ? t("passed", "已通过") : t("not passed", "未通过")} · ${t("Reference", "对比版本")}: ${item.target?.passed ? t("passed", "已通过") : t("not passed", "未通过")}${item.revisionChanged ? ` · r${item.target?.revision ?? "—"} → r${item.current?.revision ?? "—"}` : ""}</small></li>`).join("") || `<li class="empty-note">${t("No comparison evidence is available for this target.", "此对比基准暂无可用证据。")}</li>`;
    const comparisonOptions = comparisonTargets.length ? comparisonTargets.map(targetOption).join("") : `<option value="">${t("No historical version available", "暂无可对比的历史版本")}</option>`;
    const batchPanel = `<section class="project-panel studio-baseline-batch" data-studio-batch-panel><div class="panel-head"><div><span class="section-kicker">${t("Release baseline batch", "发布基线批次")}</span><h2>${t("Run required scenarios", "运行必跑场景")}</h2></div></div><div class="studio-batch-actions"><button class="secondary-button" type="button" data-run-batch="missing_only" ${!missingBaselineCount || batchIsRunning || released ? "disabled" : ""}>${t("Run pending required", "运行待验证必跑场景")} (${missingBaselineCount})</button><button class="secondary-button" type="button" data-run-batch="all_required" ${!requiredBaselines.length || batchIsRunning || released ? "disabled" : ""}>${t("Rerun all required", "重跑全部必跑")} (${requiredBaselines.length})</button>${failedBatchCount ? `<button class="secondary-button" type="button" data-run-batch="retry_failed" ${batchIsRunning || released ? "disabled" : ""}>${t("Retry failed only", "仅重试失败项")} (${failedBatchCount})</button>` : ""}</div><div class="studio-batch-status" data-batch-status role="status" aria-live="polite">${batchStatusText(latestBatch)}</div><progress data-batch-progress max="${batchTotal || 1}" value="${Math.min(batchProgress, batchTotal || 1)}" ${batchIsRunning ? "" : "hidden"}></progress><div data-batch-cancel-slot>${batchIsRunning ? `<button class="danger-button" type="button" data-cancel-batch="${esc(latestBatch.batchId || "")}">${t("Cancel batch", "取消批次")}</button>` : ""}</div></section><section class="project-panel studio-baseline-comparison"><div class="panel-head"><div><span class="section-kicker">${t("Historical reference", "历史版本对比参考")}</span><h2>${t("Diagnosis only; does not affect release readiness", "仅供诊断，不影响当前版本发布就绪度")}</h2></div><label class="studio-comparison-select"><span>${t("Compare with", "对比基准")}</span><select data-comparison-target ${comparisonTargets.length < 2 ? "disabled" : ""}>${comparisonOptions}</select></label></div><ul class="studio-comparison-list" data-comparison-list>${comparisonRows(comparisonPayload)}</ul></section>`;
    root.insertAdjacentHTML("beforeend", batchPanel);
    root.insertAdjacentHTML("beforeend", `<section class="project-panel"><div class="panel-head"><div><span class="section-kicker">${t("Release baselines", "发布基线")}</span><h2>${t("Required scenarios", "必跑场景")}</h2></div></div><p class="panel-intro">${t("Each required scenario needs passing Sandbox evidence for this TeamVersion. Editing a scenario creates a new revision and invalidates its previous evidence.", "每条必跑场景都需要当前 TeamVersion 的 Sandbox 证据通过。修改场景会生成新版本，并使旧证据失效。")}</p><div class="material-list">${baselines.map((scenario) => { const evidence = hasEvidence(scenario); return `<div class="material-row" data-baseline-row="${esc(scenario.scenarioId)}"><div><strong>${esc(scenario.name)} · r${scenario.revision}</strong><div class="task-record-meta"><span>${esc(scenario.scenarioId)}</span><span>${scenario.requiredForRelease !== false ? t("Required", "必跑") : t("Optional", "可选")}</span><span>${t("Required roles", "必跑角色")}: ${scenario.expectedRoleIds.length}</span><span data-baseline-evidence>${evidence ? t("Sandbox passed", "Sandbox 已通过") : t("Pending run", "待运行")}</span><span data-batch-item-status></span></div></div><button class="secondary-button" type="button" data-run-baseline="${esc(scenario.scenarioId)}" ${released ? "disabled" : ""}>${t("Run baseline", "运行基线")}</button></div>`; }).join("") || `<p class="empty-note">${t("No release baselines configured.", "尚未配置发布基线。")}</p>`}</div>${released ? "" : `<form id="studio-baseline-form" class="compact-form"><label>${t("Scenario ID", "场景 ID")}<input name="scenarioId" pattern="[a-z0-9][a-z0-9-]{0,63}" required></label><label>${t("Scenario name", "场景名称")}<input name="name" maxlength="120" required></label><label>${t("Fixed task input", "固定任务输入")}<textarea name="prompt" maxlength="4000" required></textarea></label><label>${t("Required role IDs (comma-separated)", "必跑角色 ID（逗号分隔）")}<input name="roles" required placeholder="analyst, reviewer"></label><label class="field checkbox"><input name="requiredForRelease" type="checkbox" checked><span>${t("Require this scenario for release", "作为发布必跑场景")}</span></label><label>${t("Output JSON Schema", "输出 JSON Schema")}<textarea name="schema" rows="5" required>{"type":"object"}</textarea></label><label>${t("Materials snapshot JSON", "材料快照 JSON")}<textarea name="materials" rows="4">[]</textarea></label><button class="secondary-button" type="submit">${t("Save baseline", "保存基线场景")}</button></form>`}</section>`);
    const updateBatchUi = (batch) => {
      const panel = root.querySelector("[data-studio-batch-panel]");
      if (!panel || !batch) return;
      const items = batch.items || batch.scenarios || [];
      const total = Number.isFinite(batch.totalCount) ? batch.totalCount : items.length;
      const progress = Number.isFinite(batch.completedCount) ? batch.completedCount : items.filter((item) => ["completed", "failed", "interrupted", "cancelled", "skipped"].includes(item.status)).length;
      const running = batch.status === "running";
      panel.querySelector("[data-batch-status]").textContent = batchStatusText(batch, progress, total);
      const progressElement = panel.querySelector("[data-batch-progress]");
      progressElement.max = total || 1;
      progressElement.value = Math.min(progress, total || 1);
      progressElement.hidden = !running;
      panel.querySelectorAll("[data-run-batch]").forEach((button) => { button.disabled = running || released || (button.dataset.runBatch === "missing_only" && !missingBaselineCount) || (button.dataset.runBatch === "all_required" && !requiredBaselines.length); });
      panel.querySelector("[data-batch-cancel-slot]").innerHTML = running ? `<button class="danger-button" type="button" data-cancel-batch="${esc(batch.batchId || "")}">${t("Cancel batch", "取消批次")}</button>` : "";
      for (const item of items) {
        const row = root.querySelector(`[data-baseline-row="${CSS.escape(item.scenarioId || "")}"]`);
        const status = row?.querySelector("[data-batch-item-status]");
        if (status) status.textContent = item.status ? `${t("Batch", "批次")}: ${item.status}` : "";
      }
      if (running) panel.querySelector("[data-cancel-batch]")?.addEventListener("click", cancelBatch);
    };
    const batchPath = `/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/release-baselines/batches`;
    const pollBatch = async () => {
      if (pageRequest && !isCurrentRequest(pageRequest)) return;
      try {
        const response = await pageFetch(`${batchPath}/latest`);
        if (!response.ok) return;
        const payload = await response.json();
        const batch = payload.batch || payload.latestBatch || payload;
        updateBatchUi(batch);
        if (batch?.status === "running") window.setTimeout(pollBatch, 800);
        else if (latestBatch?.status === "running" || batch?.status) void renderStudioReleaseGate(teamVersionId, pageRequest);
      } catch (error) { if (!isAbort(error)) window.setTimeout(pollBatch, 1600); }
    };
    const cancelBatch = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const response = await pageFetch(`${batchPath}/${encodeURIComponent(button.dataset.cancelBatch)}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || t("Unable to cancel the batch.", "无法取消批次。"));
        updateBatchUi(payload.batch || payload);
      } catch (error) {
        if (!isAbort(error)) {
          panelStatusError(error.message);
          button.disabled = false;
        }
      }
    };
    const panelStatusError = (message) => {
      const status = root.querySelector("[data-batch-status]");
      if (status) status.textContent = message;
    };
    root.querySelectorAll("[data-run-batch]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      panelStatusError(t("Starting batch…", "正在启动批次…"));
      try {
        const response = await pageFetch(batchPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: button.dataset.runBatch, locale: state.locale }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || t("Unable to start the batch.", "无法启动基线批次。"));
        const batch = payload.batch || payload;
        updateBatchUi(batch);
        if (batch.status === "running") window.setTimeout(pollBatch, 800);
        else void renderStudioReleaseGate(teamVersionId, pageRequest);
      } catch (error) {
        if (!isAbort(error)) {
          panelStatusError(error.message);
          button.disabled = false;
        }
      }
    }));
    root.querySelector("[data-cancel-batch]")?.addEventListener("click", cancelBatch);
    if (batchIsRunning) window.setTimeout(pollBatch, 800);
    root.querySelector("[data-comparison-target]")?.addEventListener("change", async (event) => {
      const select = event.currentTarget;
      select.disabled = true;
      try {
        const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/release-baselines/comparison?target=${encodeURIComponent(select.value)}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || t("Unable to load comparison.", "无法读取版本对比。"));
        root.querySelector("[data-comparison-list]").innerHTML = comparisonRows(payload);
      } catch (error) {
        if (!isAbort(error)) root.querySelector("[data-comparison-list]").innerHTML = `<li role="alert">${esc(error.message)}</li>`;
      } finally { if (select.isConnected) select.disabled = comparisonTargets.length < 2; }
    });
    root.querySelectorAll("[data-run-baseline]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      const scenario = baselines.find((item) => item.scenarioId === button.dataset.runBaseline);
      try {
        $("#studio-release-status").textContent = t("Running Sandbox baseline…", "正在运行 Sandbox 基线…");
        const response = await pageFetch(`/api/v1/teams/${encodeURIComponent(team.teamId)}/versions/${encodeURIComponent(team.teamVersionId || teamVersionId)}/simulations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: scenario.prompt, baselineScenarioId: scenario.scenarioId }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Baseline Sandbox failed.");
        await renderStudioReleaseGate(teamVersionId, pageRequest);
      } catch (error) { if (!isAbort(error)) { $("#studio-release-status").textContent = studioSimulationErrorText(error.message); button.disabled = false; } }
    }));
    root.querySelector("#studio-baseline-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const submit = formElement.querySelector('button[type="submit"]');
      const originalLabel = submit.textContent;
      const form = new FormData(formElement);
      submit.disabled = true;
      submit.textContent = t("Saving…", "正在保存…");
      try {
        const next = { scenarioId: String(form.get("scenarioId")), name: String(form.get("name")), prompt: String(form.get("prompt")), expectedRoleIds: String(form.get("roles")).split(",").map((item) => item.trim()).filter(Boolean), requiredForRelease: form.get("requiredForRelease") === "on", outputSchema: JSON.parse(String(form.get("schema") || "{}")), materials: JSON.parse(String(form.get("materials") || "[]")) };
        const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/release-baselines`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarios: [...baselines.filter((item) => item.scenarioId !== next.scenarioId), next] }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to save baseline.");
        await renderStudioReleaseGate(teamVersionId, pageRequest);
      } catch (error) { if (!isAbort(error)) $("#studio-release-status").textContent = error.message || t("Invalid baseline JSON.", "基线场景 JSON 格式无效。"); }
      finally { if (submit?.isConnected) { submit.disabled = false; submit.textContent = originalLabel; } }
    });
    addStudioWorkspaceNav(root, teamVersionId, "release");
    const releaseButton = $("#studio-release-button");
    releaseButton?.addEventListener("click", async () => {
      releaseButton.disabled = true;
      $("#studio-release-status").textContent = english ? "Releasing TeamVersion…" : "正在发布团队版本…";
      try {
        const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to release TeamVersion.");
        if (collaborationProjectId) {
          const designUrl = `/studio/teams/${encodeURIComponent(teamVersionId)}/design?collaborationProjectId=${encodeURIComponent(collaborationProjectId)}&adjust=1&mount=1`;
          navigate(designUrl);
          return;
        }
        await renderStudioReleaseGate(teamVersionId, pageRequest);
      } catch (error) {
        if (isAbort(error)) return;
        $("#studio-release-status").textContent = error.message || "Unable to release TeamVersion.";
        releaseButton.disabled = false;
      }
    });
  } catch (error) {
    if (isAbort(error)) return;
    root.innerHTML = `<div class="run-error">${esc(error.message || "Unable to validate TeamVersion.")}</div>`;
  }
}

function studioRoleDisplayName(authoring, roleId, locale) {
  if (roleId === "__system_start__") return locale === "en" ? "Start" : "开始";
  if (roleId === "__system_end__") return locale === "en" ? "End" : "结束";
  const title = String(authoring.roles?.[roleId]?.title || "").trim();
  return title || roleId;
}

function renderRoleAvatarWithBadge(roleId, authoring = {}, explicitBackend = "", options = {}) {
  const role = authoring?.roles?.[roleId] || {};
  const color = roleColorForId(roleId || "system");
  const name = studioRoleDisplayName(authoring, roleId, state.locale) || role?.name || roleId || "Role";
  const monogram = name.trim().slice(0, 1).toUpperCase();
  const backend = explicitBackend || role.backend || "";
  const size = options.size || 32;
  const badgeSize = Math.max(11, Math.round(size * 0.45));
  const badgeMarkup = backend
    ? `<span class="role-avatar-badge" title="${esc(backend)}">${renderBackendIcon(backend, { size: badgeSize })}</span>`
    : "";
  const focusAttrs = options.focusable ? ` data-focus-role="${esc(roleId)}" role="button" tabindex="0" aria-label="${esc(state.locale === "en" ? `Focus ${name} in graph` : `在图谱中定位${name}`)}"` : "";
  return `<div class="team-debug-avatar-wrap"${focusAttrs} style="--role-accent:${esc(color.accent)};--role-fill:${esc(color.fill)}"><span class="team-debug-avatar" aria-label="${esc(name)}">${esc(monogram)}</span>${badgeMarkup}</div>`;
}

function studioRoleTopology(authoring = {}, roleId = "") {
  const startId = "__system_start__";
  const endId = "__system_end__";
  const flows = Object.values(authoring.flows || {}).filter((flow) =>
    flow && !flow.runtimeOnlyErrorFlow && !flow.displayOnly && flow.eventType !== "START"
  );
  const incoming = [...new Set(flows
    .filter((flow) => flow.toRoleId === roleId && flow.fromRoleId !== startId && flow.fromRoleId !== endId)
    .map((flow) => flow.fromRoleId).filter(Boolean))];
  const outgoing = [...new Set(flows
    .filter((flow) => flow.fromRoleId === roleId && flow.toRoleId !== startId && flow.toRoleId !== endId)
    .map((flow) => flow.toRoleId).filter(Boolean))];
  const adjacency = new Map();
  for (const flow of flows) {
    if (!flow.fromRoleId || !flow.toRoleId || flow.fromRoleId.startsWith("__system_") || flow.toRoleId.startsWith("__system_")) continue;
    const list = adjacency.get(flow.fromRoleId) || [];
    list.push(flow.toRoleId);
    adjacency.set(flow.fromRoleId, list);
  }
  const visit = (current, seen = new Set()) => {
    if (current === roleId && seen.size > 0) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    return (adjacency.get(current) || []).some((next) => visit(next, new Set(seen)));
  };
  return { incoming, outgoing, hasJoin: incoming.length > 1, hasRoute: outgoing.length > 1, hasCycle: visit(roleId) };
}

const STUDIO_BUSINESS_EVENT_TYPES = [
  { value: "READY", zh: "就绪", en: "Result ready", glyph: "✓" },
  { value: "APPROVED", zh: "通过", en: "Approved", glyph: "✓" },
  { value: "REJECTED", zh: "拒绝", en: "Rejected", glyph: "✗" },
  { value: "NEEDS_REWORK", zh: "需要返工", en: "Needs rework", glyph: "↺" },
  { value: "BLOCKED", zh: "业务阻塞", en: "Business blocked", glyph: "⛔" }
];

const STUDIO_ROUTING_ERROR_EVENT_TYPES = [
  { value: "ERROR", zh: "运行时错误", en: "Runtime error", glyph: "⚡" }
];

function studioPropertyInspectorMarkup(authoring, selection, locale, discoveredModels = []) {
  const english = locale === "en";
  const copyOverrides = {
    en: {
      "Random number": "Randomly select a specified number of roles",
      "Candidates are defined by flows connected from Start. Random selection is fixed for each run.": "Candidates are the roles connected from Start. The selected roles stay the same when this run resumes.",
      "Only distinct roles connected directly to End are counted.": "The threshold counts distinct roles connected directly to End. Repeated outputs from one role are retained but count as one role.",
      "Only discovered runnable models are listed. Existing unavailable bindings remain visible for repair.": "Only discovered runnable models are selectable.",
      "Start dispatch is configured on the Start role. This flow defines one eligible role.": "Configure dispatch on Start. This flow adds its target role to the candidate set.",
      "Minimum number": "Wait for at least a specified number of terminal roles",
      "Minimum arrivals": "Minimum number of terminal roles",
      "Distribution": "Routing mode",
      "Minimum sources": "Minimum incoming roles",
      "Structural role": "Boundary node",
      "Flow properties": "Transition properties",
      "Flow and condition": "Transition rules",
      "Flow contract": "Transition contract"
    },
    zh: {
      "随机选择数量": "随机选取指定数量",
      "达到指定数量": "至少有指定数量的终端角色到达",
      "最少到达数": "最少终端角色数",
      "选择数量": "角色数量",
      "最少来源数": "最少上游角色数",
      "候选角色由开始节点的连线决定；随机选择在每次运行中固定。": "候选角色由开始节点的连线决定；本次运行及恢复执行时，随机抽选结果保持不变。",
      "只统计直接连接到结束节点的不同角色。": "门槛按直接连接到结束节点的不同角色计算。同一角色的多份终端输出都会保留，但只计作一个角色。",
      "列表仅包含已发现且可运行的模型；已有但不可用的绑定会保留显示，便于修复。": "仅可选择已发现且可运行的模型。",
      "开始分发策略在开始角色中配置；此关系定义一个候选角色。": "请在开始节点配置分发方式；此连线将目标角色加入候选范围。",
      "结构角色": "边界节点",
      "流程属性": "流转属性",
      "流程与条件": "流转规则",
      "流程契约": "流转契约"
    }
  };
  const t = (en, zh) => {
    if (en === "Dispatch") return english ? "Task dispatch" : "任务分发";
    if (en === "Distribution") return english ? "Routing mode" : "路由策略";
    if (en === "All connected roles") return english ? (zh === "全部候选角色" ? "Dispatch to all connected roles" : "Wait for all terminal roles to complete") : (zh === "全部连接角色到达" ? "全部终端角色完成" : zh);
    return (english ? copyOverrides.en[en] : copyOverrides.zh[zh]) || (english ? en : zh);
  };
  const system = authoring.system || (authoring.system = {});
  const roles = authoring.roles || {};
  const roleIds = Object.keys(roles).sort();
  const selectedFlow = resolveStudioSelectedFlow(authoring, selection);
  let manifest = { version: 1, contracts: [] };
  try { manifest = JSON.parse(selection.assets?.contracts || JSON.stringify(manifest)); } catch { /* The editor shows the repairable manifest as empty. */ }
  const flowContract = selectedFlow && Array.isArray(manifest.contracts)
    ? manifest.contracts.find((item) => item?.kind === "flow" && item.match?.fromRoleId === selectedFlow.fromRoleId && item.match?.eventType === selectedFlow.eventType && item.match?.toRoleId === studioContractTargetRoleId(selectedFlow.toRoleId))
    : null;
  const manifestContracts = Array.isArray(manifest.contracts) ? manifest.contracts : [];
  const contractSchemaRef = flowContract?.schema || `schemas/${String(selectedFlow?.flowId || "flow").replace(/[^a-zA-Z0-9_.-]/g, "-")}.json`;
  const role = selection.roleId ? roles[selection.roleId] : null;
  const roleName = (roleId) => studioRoleDisplayName(authoring, roleId, locale);
  const roleModelKey = role?.backend && role?.modelId ? JSON.stringify([role.backend, role.modelId]) : "";
  const runnableModels = discoveredModels.filter((model) => model.runnable);
  const selectedModelKnown = runnableModels.some((model) => JSON.stringify([model.backend, model.modelId]) === roleModelKey);
  const modelOptions = `${!selectedModelKnown ? `<option value="" selected${runnableModels.length ? "" : " disabled"}>${runnableModels.length ? t("Choose a discovered model", "选择已发现且可运行的模型") : t("No runnable models discovered", "未发现可运行模型")}</option>` : ""}${runnableModels.map((model) => {
    const modelId = model.modelId;
    const modelKey = JSON.stringify([model.backend, modelId]);
    return `<option value="${esc(modelKey)}" ${modelKey === roleModelKey ? "selected" : ""}>${esc(model.name || modelId)} · ${esc(modelId)} (${esc(model.backend)})</option>`;
  }).join("")}`;
  const fallbackModel = role?.fallback?.backend && role?.fallback?.modelId
    ? JSON.stringify([role.fallback.backend, role.fallback.modelId])
    : "";
  const fallbackModelKnown = runnableModels.some((model) => JSON.stringify([model.backend, model.modelId]) === fallbackModel);
  const fallbackModelOptions = `${fallbackModel && !fallbackModelKnown ? `<option value="" selected${runnableModels.length ? "" : " disabled"}>${runnableModels.length ? t("Choose a discovered model", "选择已发现且可运行的模型") : t("No runnable models discovered", "未发现可运行模型")}</option>` : ""}${runnableModels.map((model) => {
    const modelId = model.modelId;
    const modelKey = JSON.stringify([model.backend, modelId]);
    return `<option value="${esc(modelKey)}" ${modelKey === fallbackModel ? "selected" : ""}>${esc(model.name || modelId)} · ${esc(modelId)} (${esc(model.backend)})</option>`;
  }).join("")}`;
  let roleContract = {};
  try { roleContract = JSON.parse(selection.assets?.roles?.[role?.roleId]?.["role.json"] || "{}"); } catch { /* Keep the inspector readable while a role contract is being repaired. */ }
  const allowedTools = roleContract.constraints?.allowedTools || [];
  const writableStateFields = roleContract.constraints?.writableStateFields || [];
  const selectedGlobalLaw = (selection.assets?.laws?.laws || []).find((law) => law.lawId === authoring.system?.lawGlobalRef);
  const forbiddenTools = selectedGlobalLaw?.constraints?.forbiddenToolRefs || [];
  const blockedRoleTools = allowedTools.filter((toolRef) => forbiddenTools.includes(toolRef));
  const standardWorkspaceTools = new Set(["workspace.write", "workspace.run", "workspace.patch_text"]);
  const extraTools = allowedTools.filter((toolRef) => !standardWorkspaceTools.has(toolRef));
  const permissionMarkup = role ? `<details class="studio-inspector-section studio-contract-permissions" open><summary>${t("Contract permissions", "契约权限边界")}</summary><div class="studio-permission-columns"><div><strong>${t("Allowed tools", "允许工具")}</strong><p data-studio-allowed-tools-summary>${esc(allowedTools.join(", ") || t("None", "无"))}</p></div><div><strong>${t("Writable state fields", "可写状态字段")}</strong><p>${esc(writableStateFields.join(", ") || t("None", "无"))}</p></div></div><div class="studio-tool-config-group"><span class="studio-tool-config-title">${t("Configure allowed tools", "配置允许工具")}</span><div class="studio-tool-checkboxes"><label class="field checkbox"><input type="checkbox" data-studio-role-tool="workspace.write" ${allowedTools.includes("workspace.write") ? "checked" : ""}><span>workspace.write <small>(${t("Write files in staging", "工作区文件写入")})</small></span></label><label class="field checkbox"><input type="checkbox" data-studio-role-tool="workspace.run" ${allowedTools.includes("workspace.run") ? "checked" : ""}><span>workspace.run <small>(${t("Run CLI commands in staging", "工作区命令行执行")})</small></span></label><label class="field checkbox"><input type="checkbox" data-studio-role-tool="workspace.patch_text" ${allowedTools.includes("workspace.patch_text") ? "checked" : ""}><span>workspace.patch_text <small>(${t("Patch files in staging", "工作区文件修补")})</small></span></label></div><label class="field full"><span>${t("Other tool references", "其他工具引用")}</span><input type="text" data-studio-role-tool-extra value="${esc(extraTools.join(", "))}" placeholder="${t("Comma-separated tool identifiers, e.g. web.search", "逗号分隔的工具标识，如 web.search")}"></label></div><div data-studio-role-tool-conflict>${blockedRoleTools.length ? `<p class="studio-permission-conflict" role="alert">${t("Disabled by global law", "与全局禁用工具冲突")}: ${esc(blockedRoleTools.join(", "))}</p>` : ""}</div></details>` : "";
  const fallbackModelField = role?.bindingKind === "model" ? `<label class="field full"><span>${t("Fallback model", "备选模型")}</span><select data-studio-role-field="fallbackModel"><option value="">${t("No fallback", "不使用备选模型")}</option>${fallbackModelOptions}</select><span class="field-hint">${t("Used only for retryable model channel failures.", "仅在模型通道发生可重试故障时触发。")}</span></label>` : "";
  const review = role?.review || {};
  const reviewTarget = review.reworkTargetRoleId || "";
  const reworkRoleOptions = roleIds.map((roleId) => `<option value="${esc(roleId)}" ${reviewTarget === roleId ? "selected" : ""}>${esc(studioRoleDisplayName(authoring, roleId, locale))}</option>`).join("");
  const startRoleId = "__system_start__";
  const endRoleId = "__system_end__";
  const terminalRoleCount = new Set(Object.values(authoring.flows || {}).filter((flow) => flow.toRoleId === endRoleId).map((flow) => flow.fromRoleId)).size;
  const roleTopology = role ? studioRoleTopology(authoring, role.roleId) : { hasJoin: false, hasRoute: false, hasCycle: false };
  const routingField = roleTopology.hasRoute ? `<label class="field"><span>${t("Distribution", "分发策略")}</span><select data-studio-role-field="routingMode"><option value="">standard</option><option value="parallel_split" ${role.routingMode === "parallel_split" ? "selected" : ""}>parallel_split</option></select></label>` : "";
  const joinField = roleTopology.hasJoin ? `<label class="field"><span>${t("Join mode", "汇聚策略")}</span><select data-studio-role-field="joinMode"><option value="">none</option><option value="all_of" ${role.joinMode === "all_of" ? "selected" : ""}>all_of</option><option value="quorum_of" ${role.joinMode === "quorum_of" ? "selected" : ""}>quorum_of</option></select></label>${role.joinMode === "quorum_of" ? `<label class="field"><span>${t("Minimum sources", "最少来源数")}</span><input data-studio-role-field="joinMin" type="number" min="1" step="1" value="${esc(role.joinMin ?? "")}"></label>` : ""}` : "";
  const loopField = roleTopology.hasCycle ? `<label class="field full"><span>${t("Loop budget", "循环上限")}</span><input data-studio-role-field="loopMax" type="number" min="1" step="1" value="${esc(role.loopMax ?? "")}"><span class="field-hint">${english ? "Legacy role budget; prefer the loop configuration in Global settings." : "兼容旧角色上限；建议在全局配置中按循环编号设置。"}</span></label>` : "";
  if (selection.roleId === startRoleId) return `<div class="studio-inspector-heading"><span class="section-kicker">${t("Structural role", "结构角色")}</span><h2>${t("Start", "开始")}</h2></div><div class="studio-inspector-fields"><label class="field"><span>${t("Dispatch", "分发策略")}</span><select data-studio-special-field="startDispatchMode"><option value="all" ${system.startDispatch?.mode !== "random_n" ? "selected" : ""}>${t("All connected roles", "全部候选角色")}</option><option value="random_n" ${system.startDispatch?.mode === "random_n" ? "selected" : ""}>${t("Random number", "随机选择数量")}</option></select></label>${system.startDispatch?.mode === "random_n" ? `<label class="field"><span>${t("Candidate count", "选择数量")}</span><input type="number" min="1" max="${Math.max(1, roleIds.filter((roleId) => Object.values(authoring.flows || {}).some((flow) => flow.fromRoleId === startRoleId && flow.toRoleId === roleId)).length)}" step="1" data-studio-special-field="startDispatchCount" value="${esc(system.startDispatch.count)}"></label>` : ""}<p class="field-hint full">${t("Candidates are defined by flows connected from Start. Random selection is fixed for each run.", "候选角色由开始节点的连线决定；随机选择在每次运行中固定。")}</p><p class="studio-structure-rule full">${t("Start can connect only to business roles. It cannot connect directly to End.", "开始只能连接业务角色，不能直接连接结束。")}</p></div>`;
  if (selection.roleId === endRoleId) return `<div class="studio-inspector-heading"><span class="section-kicker">${t("Structural role", "结构角色")}</span><h2>${t("End", "结束")}</h2></div><div class="studio-inspector-fields"><label class="field"><span>${t("Aggregation", "汇聚策略")}</span><select data-studio-special-field="endJoinMode"><option value="all_of" ${system.endJoin?.mode !== "quorum_of" ? "selected" : ""}>${t("All connected roles", "全部连接角色到达")}</option><option value="quorum_of" ${system.endJoin?.mode === "quorum_of" ? "selected" : ""}>${t("Minimum number", "达到指定数量")}</option></select></label>${system.endJoin?.mode === "quorum_of" ? `<label class="field"><span>${t("Minimum arrivals", "最少到达数")}</span><input type="number" min="1" max="${Math.max(1, terminalRoleCount)}" step="1" data-studio-special-field="endJoinMin" value="${esc(system.endJoin.min ?? 1)}"></label>` : ""}<p class="field-hint full">${t("Only distinct roles connected directly to End are counted.", "只统计直接连接到结束节点的不同角色。")}</p><p class="studio-structure-rule full">${t("End can receive flows only from business roles. Start cannot connect directly to End.", "结束只能接收业务角色的连接，不能与开始直接连接。")}</p></div>`;
  const deleteFlowButton = selectedFlow ? `<button type="button" class="secondary-button danger-button" data-studio-flow-delete>${t("Delete flow", "删除关系")}</button>` : "";
  if (selectedFlow?.fromRoleId === startRoleId) {
    const flowIcon = renderStudioFlowContractIcon(selectedFlow, authoring, selection?.assets?.contracts, locale);
    return `<div class="studio-inspector-heading">${flowIcon}<div><span class="section-kicker">${t("Flow properties", "流程属性")}</span><h2>${esc(roleName(selectedFlow.fromRoleId))} → ${esc(roleName(selectedFlow.toRoleId))}</h2></div></div><details class="studio-inspector-section" open><summary>${t("Flow and condition", "流程与条件")}</summary><div class="studio-inspector-fields"><label class="field"><span>${t("Structural event", "结构事件")}</span><input value="${t("Start", "开始")}" readonly></label><label class="field"><span>${t("Display label", "显示名称")}</span><input data-studio-flow-field="label" value="${esc(selectedFlow.label || localizedEventLabel("START", copy))}"></label><p class="field-hint full">${t("Start dispatch is configured on the Start role. This flow defines one eligible role.", "开始分发策略在开始角色中配置；此关系定义一个候选角色。")}</p></div></details><div class="form-actions">${deleteFlowButton}</div>`;
  }
  if (selectedFlow) {
    const isBusiness = STUDIO_BUSINESS_EVENT_TYPES.some((item) => item.value === selectedFlow.eventType);
    const isRoutingError = STUDIO_ROUTING_ERROR_EVENT_TYPES.some((item) => item.value === selectedFlow.eventType);
    const isKnownEvent = isBusiness || isRoutingError;

    const preservedOption = !isKnownEvent && selectedFlow.eventType
      ? `<optgroup label="${locale === "en" ? "Current preserved value" : "当前保留值"}"><option value="${esc(selectedFlow.eventType)}" selected>◇ ${esc(selectedFlow.eventType)} · ${locale === "en" ? "Preserved" : "保留值"}</option></optgroup>`
      : "";
    const businessOptions = `<optgroup label="${locale === "en" ? "Business events" : "业务事件"}">${STUDIO_BUSINESS_EVENT_TYPES.map((item) => `<option value="${esc(item.value)}" ${selectedFlow.eventType === item.value ? "selected" : ""}>${item.glyph} ${esc(item.value)} · ${locale === "en" ? item.en : item.zh}</option>`).join("")}</optgroup>`;
    const routingErrorOptions = `<optgroup label="${locale === "en" ? "Runtime error routing" : "运行时错误路由"}">${STUDIO_ROUTING_ERROR_EVENT_TYPES.map((item) => `<option value="${esc(item.value)}" ${selectedFlow.eventType === item.value ? "selected" : ""}>${item.glyph} ${esc(item.value)} · ${locale === "en" ? item.en : item.zh}</option>`).join("")}</optgroup>`;
    const eventTypeOptions = `${preservedOption}${businessOptions}${routingErrorOptions}`;
    const flowIcon = renderStudioFlowContractIcon(selectedFlow, authoring, selection?.assets?.contracts, locale);
    return `<div class="studio-inspector-heading">${flowIcon}<div><span class="section-kicker">${t("Flow properties", "流程属性")}</span><h2>${esc(roleName(selectedFlow.fromRoleId))} → ${esc(roleName(selectedFlow.toRoleId))}</h2></div></div><details class="studio-inspector-section" open><summary>${t("Flow and condition", "流程与条件")}</summary><div class="studio-inspector-fields"><label class="field"><span>${t("Event type", "事件类型")}</span><select data-studio-flow-field="eventType">${eventTypeOptions}</select></label><p class="field-hint full">${t("Note: loop_exhausted is a runtime budget control event and human_review_rejected is an audit event; both are raised by the engine and cannot be wired as flow edges.", "说明：loop_exhausted（预算耗尽）由运行时引擎控制，human_review_rejected（审核拒绝）为审计事件；两者由系统自动捕获，不作为流转连线事件。")}</p><label class="field"><span>${t("Display label", "显示名称")}</span><input data-studio-flow-field="label" value="${esc(selectedFlow.label || "")}"></label><label class="field"><span>${t("Priority", "优先级")}</span><input data-studio-flow-field="priority" type="number" step="1" value="${esc(selectedFlow.priority ?? "")}"></label><label class="field checkbox"><input data-studio-flow-field="runtimeOnlyErrorFlow" type="checkbox" ${selectedFlow.runtimeOnlyErrorFlow ? "checked" : ""}><span>${t("Error flow", "错误分支")}</span></label><label class="field full"><span>${t("Condition (JSON)", "条件（JSON）")}</span><textarea data-studio-flow-field="condition" rows="5">${esc(selectedFlow.condition ? JSON.stringify(selectedFlow.condition, null, 2) : "")}</textarea></label></div></details><details class="studio-inspector-section" open><summary>${t("Flow contract", "流程契约")}</summary><div class="studio-inspector-fields"><label class="field"><span>${t("Contract ID", "契约 ID")}</span><input data-studio-contract-field="id" value="${esc(flowContract?.id || "")}" placeholder="${esc(selectedFlow.flowId)}"></label><label class="field"><span>${t("Violation policy", "违约策略")}</span><select data-studio-contract-field="onViolation"><option value="FAIL" ${(flowContract?.onViolation || "FAIL") === "FAIL" ? "selected" : ""}>FAIL</option><option value="WARN" ${flowContract?.onViolation === "WARN" ? "selected" : ""}>WARN</option></select></label><label class="field full"><span>${t("Schema file", "Schema 文件")}</span><input data-studio-contract-field="schema" value="${esc(contractSchemaRef)}"></label><label class="field full"><span>${esc(contractSchemaRef)}</span><textarea data-studio-contract-schema="${esc(contractSchemaRef)}" rows="8">${esc(selection.assets?.contractSchemas?.[contractSchemaRef] || '{\n  "type": "object"\n}')}</textarea></label><p class="field-hint full">${t("A schema is attached to this exact flow. Contracts are stored with the TeamVersion and checked by release validation.", "Schema 绑定到当前流程。契约保存在 TeamVersion 中，并由发布校验检查。")}</p></div></details><div class="form-actions">${deleteFlowButton}</div>`;
  }
  if (role) return `<div class="studio-inspector-heading"><span class="section-kicker">${t("Role properties", "角色属性")}</span><h2>${esc(roleName(role.roleId))}</h2><code>${esc(role.roleId)}</code></div><details class="studio-inspector-section" open><summary>${t("Execution and orchestration", "执行与编排")}</summary><div class="studio-inspector-fields"><label class="field full"><span>${t("Display name", "显示名称")}</span><input data-studio-role-field="title" value="${esc(role.title || "")}" maxlength="80"></label><label class="field"><span>${t("Binding type", "执行绑定")}</span><select data-studio-role-field="bindingKind"><option value="model" ${role.bindingKind === "model" ? "selected" : ""}>AI model</option><option value="exec" ${role.bindingKind === "exec" ? "selected" : ""}>CLI tool</option><option value="noop" ${role.bindingKind === "noop" ? "selected" : ""}>No-op</option></select></label>${role.bindingKind === "model" ? `<label class="field full"><span>${t("Runnable model", "可运行模型")}</span><select data-studio-role-field="modelRef"><option value="">${t("Choose a discovered model", "选择已发现的模型")}</option>${modelOptions}</select><span class="field-hint">${t("Only discovered runnable models are listed. Existing unavailable bindings remain visible for repair.", "列表仅包含已发现且可运行的模型；已有但不可用的绑定会保留显示，便于修复。")}</span></label>${fallbackModelField}` : ""}${role.bindingKind === "exec" ? `<label class="field full"><span>${t("Execution profile ID", "执行配置 ID")}</span><input list="studio-profile-options" data-studio-role-field="profileId" value="${esc(role.profileId || "")}"><datalist id="studio-profile-options">${(selection.assets.executionConfig?.profiles || []).map((profile) => `<option value="${esc(profile.profileId)}"></option>`).join("")}</datalist></label>` : ""}${routingField}${joinField}${loopField}<label class="field checkbox"><input data-studio-role-field="reviewEnabled" type="checkbox" ${review.mode === "required" ? "checked" : ""}><span>${t("Require human review", "需要人工审核")}</span></label>${review.mode === "required" ? `<label class="field"><span>${t("Review timeout (seconds)", "审核超时（秒）")}</span><input data-studio-role-field="reviewTimeout" type="number" min="0" value="${esc(review.timeoutSeconds ?? "")}"></label><label class="field"><span>${t("Timeout action", "超时动作")}</span><select data-studio-role-field="reviewTimeoutAction"><option value="pause" ${review.timeoutAction !== "terminate" ? "selected" : ""}>pause</option><option value="terminate" ${review.timeoutAction === "terminate" ? "selected" : ""}>terminate</option></select></label><label class="field"><span>${t("Rework target", "返工目标")}</span><select data-studio-role-field="reviewTarget"><option value="">${t("None", "无")}</option>${reworkRoleOptions}</select></label><label class="field"><span>${t("Maximum rework rounds", "最大返工轮次")}</span><input data-studio-role-field="reviewReworkMax" type="number" min="0" value="${esc(review.reworkMax ?? "")}"></label><label class="field"><span>${t("Termination scope", "终止范围")}</span><select data-studio-role-field="reviewTerminateScope"><option value="branch" ${review.terminateScope !== "run" ? "selected" : ""}>branch</option><option value="run" ${review.terminateScope === "run" ? "selected" : ""}>run</option></select></label>` : ""}<label class="field full"><span>${t("Context Map (JSON)", "上下文映射（JSON）")}</span><textarea data-studio-role-field="contextMap" rows="5">${esc(JSON.stringify(role.contextMap || {}, null, 2))}</textarea></label></div></details>${permissionMarkup}<details class="studio-inspector-section" open><summary>${t("Role package", "角色资产包")}</summary><div class="studio-inspector-fields">${["agent.md", "prompt.md", "role.json", "output.schema.json"].map((file) => `<label class="field full"><span>${esc(file)}</span><textarea data-studio-role-asset="${esc(file)}" rows="${file.endsWith(".md") ? 10 : 6}">${esc(selection.assets?.roles?.[role.roleId]?.[file] || "")}</textarea></label>`).join("")}</div></details>`;
  return `<div class="studio-inspector-heading"><span class="section-kicker">${t("No selection", "未选择对象")}</span><h2>${t("Select a role or flow", "请选择角色或流程")}</h2></div><p class="form-hint">${t("Open Global from Team configuration to edit team-wide settings.", "请从团队配置中选择“全局”编辑团队级配置。")}</p>`;
}

function localizeStudioInspector(inspector, locale) {
  if (!inspector) return;
  const english = locale === "en";
  const bindingLabels = english
    ? { model: "AI model", exec: "Execution tool", noop: "No execution binding" }
    : { model: "AI 模型", exec: "执行工具", noop: "未绑定执行器" };
  const optionLabels = english
    ? {
        routingMode: { "": "Standard routing", parallel_split: "Parallel fan-out" },
        joinMode: { "": "No join", all_of: "Wait for all sources", quorum_of: "Wait for a quorum" },
        reviewTimeoutAction: { pause: "Pause", terminate: "Terminate" },
        reviewTerminateScope: { branch: "Current branch", run: "Entire run" }
      }
    : {
        routingMode: { "": "标准路由", parallel_split: "并行分发" },
        joinMode: { "": "不等待上游汇聚", all_of: "等待全部来源", quorum_of: "等待达到最少来源数" },
        reviewTimeoutAction: { pause: "暂停等待", terminate: "终止" },
        reviewTerminateScope: { branch: "当前分支", run: "整个运行" }
      };
  inspector.querySelectorAll('[data-studio-role-field="bindingKind"] option').forEach((option) => {
    option.textContent = bindingLabels[option.value] || option.textContent;
  });
  for (const [field, labels] of Object.entries(optionLabels)) {
    inspector.querySelectorAll(`[data-studio-role-field="${field}"] option`).forEach((option) => {
      if (Object.hasOwn(labels, option.value)) option.textContent = labels[option.value];
    });
  }
  const roleId = inspector.querySelector(".studio-inspector-heading > code");
  if (roleId) {
    const details = document.createElement("details");
    details.className = "studio-inspector-advanced-id";
    const summary = document.createElement("summary");
    summary.textContent = english ? "Technical identifier" : "技术标识";
    const roleHeading = roleId.parentElement;
    details.append(summary, roleId);
    roleHeading?.append(details);
  }
  inspector.querySelectorAll(".studio-inspector-section").forEach((section) => {
    const summary = section.querySelector(":scope > summary")?.textContent.trim().toLocaleLowerCase() || "";
    if (/flow contract|transition contract|role package|execution profile|流程契约|流转契约|角色资产包|执行配置与本地工具/.test(summary)) section.open = false;
  });
}

function localizeStudioDesignPage(root, locale, { confirmed, version } = {}) {
  if (!root) return;
  const english = locale === "en";
  root.querySelector("#studio-asset-drawer")?.setAttribute("aria-label", english ? "Team configuration" : "团队配置");
  root.querySelector(".studio-asset-tabs")?.setAttribute("aria-label", english ? "Team configuration" : "团队配置");
  root.querySelector("#studio-property-inspector")?.setAttribute("aria-label", english ? "Team configuration properties" : "团队配置属性");
  root.querySelector(".team-debug-panel-head")?.setAttribute("aria-label", english ? "Drag the debug panel. Use arrow keys to move." : "拖动调试面板；也可使用方向键移动。");
  root.querySelector("#project-graph-stage")?.setAttribute("aria-label", english ? "Editable team collaboration graph" : "可编辑的团队协作图谱");
  if (!english) return;
  const setText = (selector, text) => {
    const element = root.querySelector(selector);
    if (!element) return;
    if (selector === "#project-design-status") {
      let messageSpan = element.querySelector(".studio-graph-status-text");
      if (!messageSpan) {
        messageSpan = document.createElement("span");
        messageSpan.className = "studio-graph-status-text";
        const projectStatus = element.querySelector(".project-status") || element.parentElement?.querySelector(":scope > .project-status");
        element.replaceChildren(messageSpan);
        if (projectStatus) element.append(document.createTextNode(" · "), projectStatus);
      }
      messageSpan.textContent = text;
      return;
    }
    element.textContent = text;
  };
  const setLabel = (selector, text) => {
    const label = root.querySelector(selector)?.closest("label");
    const textNode = [...(label?.childNodes || [])].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (textNode) textNode.textContent = `${text} `;
  };
  setText(".page-heading .eyebrow", "OGS Studio · Team design");
  setText(".page-heading .project-status", confirmed ? `Released · v${version}` : "In design");
  setText(".studio-workspace-nav + p.form-hint[role='status']", "This TeamVersion is in design from a project team adjustment. Review and release it, then return to the project to mount the new version.");
  const backLink = root.querySelector(".page-heading .detail-back");
  if (backLink) backLink.textContent = backLink.getAttribute("href")?.startsWith("/projects/") ? "← Back to project" : "← Back to OGS Studio";
  setText("#studio-team-info-open", "Team info");
  setText("#team-build-title", "AI team builder");
  setText("#confirm-project", "Release team version");
  setText("#reconfirm-project", "Create a new draft");
  setText('#project-edit-form button[type="submit"]', "Save changes");
  setText("#studio-team-metadata-title", "Team information");
  setText(".project-graph-preview .panel-head h2", "Team collaboration graph");
  setText("#project-design-status", "Loading editable team structure");
  setLabel('#project-edit-form input[name="name"]', "Team name");
  setLabel('#project-edit-form textarea[name="overview"]', "Team goal");
  setLabel("#team-simulation-input", "Debug task");
  setText("#team-debug-dialog .team-debug-panel-head strong", "Debug");
  setText("#team-debug-dialog [data-debug-view=\"config\"]", "Configure");
  setText("#team-debug-dialog [data-debug-view=\"run\"]", "Run process");
  setText("#team-debug-dialog [data-debug-view-panel=\"config\"] .form-hint", "The task and additional materials are sent together as this run's input. The run uses the current TeamVersion snapshot and is stored as an isolated debug record.");
  setText("#team-simulation-run", "Start debug run");
  setText("#team-simulation-mode legend", "Run mode");
  setText("#team-simulation-mode [data-debug-mode-label=\"dry-run\"]", "Simulation");
  setText("#team-simulation-mode [data-debug-mode-label=\"sandbox\"]", "Sandbox");
  setText("#team-simulation-mode [data-debug-mode-description=\"dry-run\"]", "Preview the workflow without model calls");
  setText("#team-simulation-mode [data-debug-mode-description=\"sandbox\"]", "Call the configured model in an isolated sandbox");
  setLabel("#team-simulation-materials", "Additional materials");
  setText("#team-debug-dialog .team-debug-panel-content .form-actions a", "Debug history");
  const debugHint = root.querySelector("#team-debug-dialog .debug-config-view .form-hint");
  if (debugHint) debugHint.textContent = "The task and additional materials are sent together as this run's input. The run uses the current TeamVersion snapshot and is stored as an isolated debug record.";
  const debugInput = root.querySelector("#team-simulation-input");
  if (debugInput) debugInput.placeholder = "Describe the task to validate";
  const debugMaterials = root.querySelector("#team-simulation-materials");
  if (debugMaterials) debugMaterials.placeholder = "Paste background, source text, requirements, or other test data";
  root.querySelector("#team-debug-dialog")?.setAttribute("aria-label", "Debug panel");
  root.querySelector("#team-debug-dialog [data-team-debug-close]")?.setAttribute("aria-label", "Close debug panel");
  root.querySelector("#team-build-panel [data-team-build-close]")?.setAttribute("aria-label", "Close AI builder");
  root.querySelector("#studio-workbench-host")?.setAttribute("aria-label", "Team design workspace");
}

function studioExecutionConfigMarkup(role, selection, locale) {
  const config = selection.assets.executionConfig || { profiles: [], tools: { tools: [] } };
  const profileId = role.profileId || `${role.roleId}-profile`;
  const profile = (config.profiles || []).find((item) => item.profileId === profileId) || {};
  const toolRef = profile.toolRef || `${role.roleId}-tool`;
  const tool = (config.tools?.tools || []).find((item) => item.toolRef === toolRef) || {};
  const label = (en, zh) => locale === "en" ? en : zh;
  return `<details class="studio-inspector-section" open><summary>${label("Execution profile and local tool", "执行配置与本地工具")}</summary><div class="studio-inspector-fields"><label class="field full"><span>${label("Profile ID", "配置标识")}</span><input list="studio-profile-options" data-studio-profile-field="profileId" value="${esc(profileId)}" maxlength="100"><datalist id="studio-profile-options">${(config.profiles || []).map((item) => `<option value="${esc(item.profileId)}"></option>`).join("")}</datalist></label><label class="field full"><span>${label("Tool reference", "工具引用")}</span><input list="studio-tool-options" data-studio-profile-field="toolRef" value="${esc(toolRef)}" maxlength="100"><datalist id="studio-tool-options">${(config.tools?.tools || []).map((item) => `<option value="${esc(item.toolRef)}"></option>`).join("")}</datalist></label><label class="field full"><span>${label("Command", "启动命令")}</span><input data-studio-tool-field="command" value="${esc(tool.command || "node")}" maxlength="500"></label><label class="field full"><span>${label("Argument template (JSON array)", "参数模板（JSON 数组）")}</span><textarea data-studio-tool-field="argsTemplate" rows="3">${esc(JSON.stringify(tool.argsTemplate || [], null, 2))}</textarea></label><label class="field"><span>${label("Stdin mode", "标准输入模式")}</span><select data-studio-tool-field="stdinMode"><option value="text" ${tool.stdinMode !== "none" ? "selected" : ""}>text</option><option value="none" ${tool.stdinMode === "none" ? "selected" : ""}>none</option></select></label><label class="field"><span>${label("Timeout (ms)", "超时（毫秒）")}</span><input data-studio-profile-field="timeoutMs" type="number" min="1" step="1" value="${esc(profile.timeoutMs ?? "")}"></label><label class="field"><span>${label("Maximum output bytes", "最大输出字节数")}</span><input data-studio-profile-field="maxOutputBytes" type="number" min="1" step="1" value="${esc(profile.maxOutputBytes ?? "")}"></label><p class="field-hint full">${label("This command runs within the TeamVersion execution environment. Review its permissions before release.", "命令在 TeamVersion 执行环境中运行。发布前请核对命令权限。")}</p></div></details>`;
}

function studioRouteOrderMarkup(authoring, role, locale) {
  const outgoing = [...new Set(Object.values(authoring.flows || {})
    .filter((flow) => flow.fromRoleId === role.roleId && flow.toRoleId !== "__system_end__")
    .map((flow) => flow.toRoleId))].sort();
  if (outgoing.length < 2) return "";
  const saved = Array.isArray(role.routeOrder) ? role.routeOrder.filter((target) => outgoing.includes(target)) : [];
  const targets = [...saved, ...outgoing.filter((target) => !saved.includes(target))];
  const label = locale === "en" ? "Sibling flow order" : "同级下游顺序";
  const hint = locale === "en" ? "Drag rows to set the order. Lower positions run first when sibling flows compete." : "拖动角色调整顺序；同级流程竞争时，序号靠前的优先。";
  const roleName = (roleId) => studioRoleDisplayName(authoring, roleId, locale);
  return `<section class="studio-inspector-section studio-route-order-editor"><h3>${label}<span class="studio-order-count">${targets.length}</span></h3><p class="field-hint">${hint}</p><div class="studio-route-order-list" data-studio-route-order-list role="list">${targets.map((target, index) => `<div class="studio-route-order-row" data-studio-route-order-item data-studio-route-order="${esc(target)}" draggable="true" role="listitem" aria-posinset="${index + 1}" aria-setsize="${targets.length}"><span class="studio-route-order-position" data-studio-route-order-position>${index + 1}</span><span class="studio-route-order-name">${esc(roleName(target))}</span><button type="button" class="studio-order-handle" data-studio-route-order-handle aria-label="${locale === "en" ? `Drag to reorder ${esc(roleName(target))}` : `拖动调整${esc(roleName(target))}顺序`}" title="${locale === "en" ? "Drag to reorder" : "拖动调整顺序"}">⠿</button><span class="studio-route-order-moves"><button type="button" class="studio-order-move" data-studio-route-order-move="up" aria-label="${locale === "en" ? `Move ${esc(roleName(target))} up` : `将${esc(roleName(target))}上移`}" title="${locale === "en" ? "Move up" : "上移"}" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" class="studio-order-move" data-studio-route-order-move="down" aria-label="${locale === "en" ? `Move ${esc(roleName(target))} down` : `将${esc(roleName(target))}下移`}" title="${locale === "en" ? "Move down" : "下移"}" ${index === targets.length - 1 ? "disabled" : ""}>↓</button></span></div>`).join("")}</div></section>`;
}

function studioContextMapMarkup(authoring, role, locale) {
  const incoming = [...new Set(Object.values(authoring.flows || {}).filter((flow) => flow.toRoleId === role.roleId).map((flow) => flow.fromRoleId))];
  const candidates = new Set([
    "global.task", "global.user_profile", "global.human_review.current.comment",
    "global.human_review.current.round", "global.human_review.current.previous_output.content"
  ]);
  if (role.joinMode) {
    if (role.joinMode !== "quorum_of" || Number(role.joinMin || incoming.length) >= incoming.length) {
      for (const source of incoming) for (const suffix of ["content", "event", "data"]) candidates.add(`source(${source}).${suffix}`);
    }
  } else if (incoming.length) {
    for (const source of ["direct.content", "direct.event", "direct.data"]) candidates.add(source);
  }
  const sourceLabel = (value) => {
    const roleSource = value.match(/^source\((.+)\)\.(content|event|data)$/);
    if (roleSource) {
      const labels = locale === "en"
        ? { content: "role output", event: "flow event", data: "structured data" }
        : { content: "角色输出", event: "流转事件", data: "结构化数据" };
      return `${studioRoleDisplayName(authoring, roleSource[1], locale)} · ${labels[roleSource[2]]}`;
    }
    const labels = locale === "en" ? {
      "global.task": "Current task",
      "global.user_profile": "User profile",
      "global.human_review.current.comment": "Current review comment",
      "global.human_review.current.round": "Current review round",
      "global.human_review.current.previous_output.content": "Previous role output",
      "direct.content": "Direct upstream content",
      "direct.event": "Direct upstream event",
      "direct.data": "Direct upstream data"
    } : {
      "global.task": "本次任务",
      "global.user_profile": "用户档案",
      "global.human_review.current.comment": "当前审核意见",
      "global.human_review.current.round": "当前审核轮次",
      "global.human_review.current.previous_output.content": "上轮角色输出",
      "direct.content": "直接上游内容",
      "direct.event": "直接上游事件",
      "direct.data": "直接上游数据"
    };
    return labels[value] || value;
  };
  const candidateOptions = [...candidates].sort().map((value) => `<option value="${esc(value)}">${esc(sourceLabel(value))}</option>`).join("");
  const rows = Object.entries(role.contextMap || {}).sort(([left], [right]) => left.localeCompare(right)).map(([target, raw]) => {
    const optional = String(raw).endsWith("?");
    const selector = optional ? String(raw).slice(0, -1) : String(raw);
    const base = [...candidates].sort((left, right) => right.length - left.length).find((candidate) => selector === candidate || selector.startsWith(`${candidate}.`)) || "global.task";
    const path = selector === base ? "" : selector.slice(base.length + 1);
    const optionalAllowed = base === "direct.data" || base.startsWith("source(") && base.endsWith(".data") || base.startsWith("global.human_review.current");
    return `<div class="studio-context-map-row" data-studio-context-row><label class="field"><span>${locale === "en" ? "Target field" : "目标字段"}</span><input data-studio-context-target value="${esc(target)}"></label><label class="field"><span>${locale === "en" ? "Source" : "来源"}</span><select data-studio-context-source>${candidateOptions}<option value="${esc(base)}" selected>${esc(sourceLabel(base))}</option></select></label><label class="field"><span>${locale === "en" ? "Field path" : "字段路径"}</span><input data-studio-context-path value="${esc(path)}" placeholder="issue.id"></label><label class="field checkbox"><input type="checkbox" data-studio-context-optional ${optional ? "checked" : ""}${optionalAllowed ? "" : " disabled"}><span>${locale === "en" ? "Optional" : "可选"}</span></label><button type="button" class="icon-button" data-studio-context-remove aria-label="${locale === "en" ? "Remove mapping" : "移除映射"}" title="${locale === "en" ? "Remove mapping" : "移除映射"}">×</button></div>`;
  }).join("");
  return `<section class="studio-inspector-section studio-context-map-editor"><h3>${locale === "en" ? "Context Map" : "上下文映射"}</h3><p class="field-hint">${locale === "en" ? "Map supported incoming values to role input fields." : "将受支持的上游值映射到角色输入字段。"}</p><div data-studio-context-rows>${rows}</div><button type="button" class="secondary-button" data-studio-context-add>${locale === "en" ? "Add mapping" : "添加映射"}</button></section>`;
}

function studioRoleInputContractMarkup(authoring, selection, locale) {
  const roles = Object.keys(authoring.roles || {}).sort();
  const options = roles.map((roleId) => `<option value="${esc(roleId)}">${esc(roleId)}</option>`).join("");
  return `<section class="studio-inspector-section studio-role-input-contract"><h3>${locale === "en" ? "Role input contract" : "角色输入契约"}</h3><div class="studio-inspector-fields"><label class="field"><span>${locale === "en" ? "Role" : "角色"}</span><select data-studio-role-input-contract-role>${options}</select></label><label class="field"><span>${locale === "en" ? "Schema path" : "Schema 路径"}</span><input data-studio-role-input-contract-schema value="schemas/${esc(roles[0] || "role")}-input.json"></label><button type="button" class="secondary-button" data-studio-role-input-contract-add ${roles.length ? "" : "disabled"}>${locale === "en" ? "Add role input contract" : "添加角色输入契约"}</button><p class="field-hint full">${locale === "en" ? "Creates or updates the role_input entry in the TeamVersion manifest and adds its schema to this design." : "在 TeamVersion 清单中新增或更新 role_input 项，并在当前设计中创建对应 Schema。"}</p></div></section>`;
}

function studioAuthoringFlowKey(flow) {
  const source = flow.fromRoleId === "__system_start__" ? "start" : flow.fromRoleId;
  const target = flow.toRoleId === "__system_end__" ? "end" : flow.toRoleId;
  return `${source}:${flow.eventType}:${target}`;
}

function deleteStudioAuthoringFlow(authoring, canvas, flow) {
  const nextAuthoring = structuredClone(authoring);
  const nextCanvas = structuredClone(canvas);
  delete nextAuthoring.flows[flow.flowId];
  if (flow.toRoleId !== "__system_end__") {
    const target = nextAuthoring.roles[flow.toRoleId];
    if (target?.joinSources) {
      target.joinSources = target.joinSources.filter((sourceRoleId) => sourceRoleId !== flow.fromRoleId);
    }
  }
  nextCanvas.edges = (nextCanvas.edges || []).filter((edge) => edge.id !== flow.flowId && !(
    edge.source === flow.fromRoleId && edge.target === flow.toRoleId && edge.eventType === flow.eventType
  ));
  return { authoring: nextAuthoring, canvas: nextCanvas };
}

function resolveStudioSelectedFlow(authoring, selection) {
  if (selection.roleId) return null;
  if (!selection.flowKey || !selection.flowId) return null;
  const flows = Object.values(authoring.flows || {});
  const byId = flows.find((flow) => flow.flowId === selection.flowId);
  const byKey = flows.find((flow) => studioAuthoringFlowKey(flow) === selection.flowKey);
  return byId && byKey && byKey.flowId === byId.flowId ? byId : null;
}

function studioContractTargetRoleId(roleId) {
  return roleId === "__system_end__" ? "output" : roleId;
}

function getStudioFlowType(flow) {
  if (flow.fromRoleId === "__system_start__" || flow.eventType === "START") return "start";
  if (flow.toRoleId === "__system_end__") return "end";
  if (flow.runtimeOnlyErrorFlow || (typeof flow.eventType === "string" && (flow.eventType === "ERROR" || flow.eventType.startsWith("ERROR.")))) return "error";
  if (flow.eventType === "BLOCKED") return "blocked";
  if (flow.eventType === "NEEDS_REWORK") return "rework";
  if (flow.eventType === "REJECTED") return "rejected";
  if (flow.eventType === "APPROVED") return "approved";
  if (flow.eventType === "READY") return "ready";
  if (flow.condition && typeof flow.condition === "object" && Object.keys(flow.condition).length > 0) return "condition";
  return "handoff";
}

function flowColorForType(type) {
  const isDark = (typeof document !== "undefined" && document.documentElement.dataset.visualizerTheme === "dark")
    || (typeof state !== "undefined" && state.theme === "dark");
  const palettes = {
    // 黄（待办/分发类）
    start: isDark
      ? { accent: "hsl(38 92% 58%)", fill: "hsl(38 45% 18%)", nameEn: "Start dispatch", nameZh: "开始分发" }
      : { accent: "hsl(38 90% 36%)", fill: "hsl(38 60% 95%)", nameEn: "Start dispatch", nameZh: "开始分发" },
    rework: isDark
      ? { accent: "hsl(45 92% 58%)", fill: "hsl(45 45% 18%)", nameEn: "Needs rework", nameZh: "需要返工" }
      : { accent: "hsl(45 90% 36%)", fill: "hsl(45 60% 95%)", nameEn: "Needs rework", nameZh: "需要返工" },

    // 绿（成功/通过类）
    approved: isDark
      ? { accent: "hsl(142 72% 52%)", fill: "hsl(142 40% 17%)", nameEn: "Approved", nameZh: "通过" }
      : { accent: "hsl(142 70% 34%)", fill: "hsl(142 45% 94%)", nameEn: "Approved", nameZh: "通过" },
    ready: isDark
      ? { accent: "hsl(142 72% 52%)", fill: "hsl(142 40% 17%)", nameEn: "Result ready", nameZh: "就绪" }
      : { accent: "hsl(142 70% 34%)", fill: "hsl(142 45% 94%)", nameEn: "Result ready", nameZh: "就绪" },
    end: isDark
      ? { accent: "hsl(142 72% 52%)", fill: "hsl(142 40% 17%)", nameEn: "End delivery", nameZh: "结束交付" }
      : { accent: "hsl(142 70% 34%)", fill: "hsl(142 45% 94%)", nameEn: "End delivery", nameZh: "结束交付" },

    // 红（错误/拒绝类）
    rejected: isDark
      ? { accent: "hsl(0 75% 64%)", fill: "hsl(0 40% 18%)", nameEn: "Rejected", nameZh: "拒绝" }
      : { accent: "hsl(0 70% 45%)", fill: "hsl(0 55% 95%)", nameEn: "Rejected", nameZh: "拒绝" },
    blocked: isDark
      ? { accent: "hsl(15 88% 60%)", fill: "hsl(15 40% 18%)", nameEn: "Business blocked", nameZh: "业务阻塞" }
      : { accent: "hsl(15 80% 40%)", fill: "hsl(15 55% 95%)", nameEn: "Business blocked", nameZh: "业务阻塞" },
    error: isDark
      ? { accent: "hsl(0 80% 65%)", fill: "hsl(0 40% 18%)", nameEn: "Runtime error", nameZh: "运行时错误" }
      : { accent: "hsl(0 75% 45%)", fill: "hsl(0 55% 95%)", nameEn: "Runtime error", nameZh: "运行时错误" },

    condition: isDark
      ? { accent: "hsl(199 85% 58%)", fill: "hsl(199 40% 18%)", nameEn: "Conditional branch", nameZh: "条件分支" }
      : { accent: "hsl(199 80% 36%)", fill: "hsl(199 50% 95%)", nameEn: "Conditional branch", nameZh: "条件分支" },
    handoff: isDark
      ? { accent: "hsl(215 50% 65%)", fill: "hsl(215 30% 18%)", nameEn: "Standard handoff", nameZh: "标准流转" }
      : { accent: "hsl(215 45% 36%)", fill: "hsl(215 35% 95%)", nameEn: "Standard handoff", nameZh: "标准流转" }
  };
  return palettes[type] || palettes.handoff;
}

const STUDIO_FLOW_GLYPH_PATHS = {
  start: "M 10 9.5 L 15.5 12.5 L 10 15.5 Z",
  end: "M 9 9 L 9 17 L 10.5 17 L 10.5 14 L 15.5 11.5 L 10.5 9 Z",
  approved: "M 10.2 15.2 L 7.5 12.5 L 8.7 11.3 L 10.2 12.8 L 15.3 7.7 L 16.5 8.9 Z",
  ready: "M 10.2 15.2 L 7.5 12.5 L 8.7 11.3 L 10.2 12.8 L 15.3 7.7 L 16.5 8.9 Z",
  rejected: "M 9 10.2 L 10.2 9 L 12 10.8 L 13.8 9 L 15 10.2 L 13.2 12 L 15 13.8 L 13.8 15 L 12 13.2 L 10.2 15 L 9 13.8 L 10.8 12 Z",
  rework: "M 12 8.5 C 14.2 8.5 16 10.3 16 12.5 C 16 14.7 14.2 16.5 12 16.5 C 10.2 16.5 8.7 15.3 8.2 13.7 L 9.8 13.2 C 10.1 14.3 11 15 12 15 C 13.4 15 14.5 13.9 14.5 12.5 C 14.5 11.1 13.4 10 12 10 L 12 11.5 L 8.5 9.2 L 12 7 Z",
  blocked: "M 12 7.5 C 9.5 7.5 7.5 9.5 7.5 12 C 7.5 14.5 9.5 16.5 12 16.5 C 14.5 16.5 16.5 14.5 16.5 12 C 16.5 9.5 14.5 7.5 12 7.5 Z M 9.2 11.2 L 14.8 11.2 L 14.8 12.8 L 9.2 12.8 Z",
  error: "M 12.5 7 L 8.5 12.5 L 11.5 12.5 L 10.5 17 L 15.5 11.5 L 12.5 11.5 Z",
  condition: "M 12 8 L 16 12.5 L 12 17 L 8 12.5 Z",
  handoff: "M 8 11.7 L 13 11.7 L 11.2 9.9 L 12.4 8.7 L 16.2 12.5 L 12.4 16.3 L 11.2 15.1 L 13 13.3 L 8 13.3 Z"
};

function renderStudioFlowContractIcon(flow, authoring, contractsManifest, locale) {
  const flowType = getStudioFlowType(flow);
  const color = flowColorForType(flowType);
  const glyph = STUDIO_FLOW_GLYPH_PATHS[flowType] || STUDIO_FLOW_GLYPH_PATHS.handoff;
  const paperOutline = "M 6 3 C 4.9 3 4 3.9 4 5 L 4 19 C 4 20.1 4.9 21 6 21 L 18 21 C 19.1 21 20 20.1 20 19 L 20 9 L 14 3 Z";

  let manifest = { version: 1, contracts: [] };
  if (typeof contractsManifest === "string") {
    try { manifest = JSON.parse(contractsManifest); } catch {}
  } else if (contractsManifest && typeof contractsManifest === "object") {
    manifest = contractsManifest;
  }
  const flowContract = Array.isArray(manifest.contracts)
    ? manifest.contracts.find((item) => item?.kind === "flow" && item.match?.fromRoleId === flow.fromRoleId && item.match?.eventType === flow.eventType && item.match?.toRoleId === studioContractTargetRoleId(flow.toRoleId))
    : null;
  const hasSchema = Boolean(flowContract?.schema);
  const badgeTitle = hasSchema
    ? (locale === "en" ? `Schema contract bound: ${flowContract.schema}` : `已绑定契约 Schema: ${flowContract.schema}`)
    : "";
  const badge = hasSchema
    ? `<span class="flow-contract-badge" title="${esc(badgeTitle)}"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M6 1.5l3.5 1.5v3c0 2.2-1.7 3.8-3.5 4.5-1.8-.7-3.5-2.3-3.5-4.5V3L6 1.5z"/><path d="M4.5 6l1 1 2-2"/></svg></span>`
    : "";

  const typeLabel = locale === "en" ? color.nameEn : color.nameZh;
  return `<span class="studio-flow-contract-icon" style="--flow-accent:${color.accent};--flow-fill:${color.fill}" title="${esc(typeLabel)}" aria-hidden="true"><svg class="flow-contract-svg" viewBox="0 0 24 24" focusable="false"><path fill-rule="evenodd" clip-rule="evenodd" d="${paperOutline} ${glyph}" fill="currentColor"/><path d="M 14 3 L 14 8.5 C 14 8.8 14.2 9 14.5 9 L 20 9 Z" fill="currentColor" opacity="0.55"/></svg>${badge}</span>`;
}

function markStudioGraphReady(stage) {
  stage?.closest(".page-frame")?.querySelector(":scope > .page-frame-body")?.removeAttribute("data-layout-scroll");
}

const studioActiveRunStorageKey = "ogs.studio.activeSimulation";
function readStudioActiveRun() {
  try { return JSON.parse(window.sessionStorage.getItem(studioActiveRunStorageKey) || "null"); }
  catch { return null; }
}
function writeStudioActiveRun(run) {
  try { window.sessionStorage.setItem(studioActiveRunStorageKey, JSON.stringify(run)); }
  catch { /* Storage may be unavailable in restricted browser contexts. */ }
}
function clearStudioActiveRun(simulationId) {
  const active = readStudioActiveRun();
  if (simulationId && active?.simulationId !== simulationId) return;
  try { window.sessionStorage.removeItem(studioActiveRunStorageKey); } catch { /* Ignore unavailable storage. */ }
}
const studioProgressSubscriptions = new Map();
async function resumeStudioProgress(teamVersionId, stage, graph, debugPanel, setDebugView, syncDebugRunButton, setEditorState, pageRequest, authoring = {}) {
  const active = readStudioActiveRun();
  const currentSubscription = active?.simulationId && studioProgressSubscriptions.get(active.simulationId);
  if (!active?.simulationId || active.teamVersionId !== teamVersionId || currentSubscription?.isConnected) return;
  const subscription = active.simulationId;
  studioProgressSubscriptions.set(subscription, stage);
  state.studioActiveRun = active;
  setDebugView("run");
  syncDebugRunButton("running");
  state.teamStudioDialog?.("run");
  const result = debugPanel?.querySelector("#team-simulation-result");
  if (result && !result.querySelector(".team-debug-transcript")) {
    result.innerHTML = `<div class="team-simulation-result"><div class="panel-head"><strong>${state.locale === "en" ? "Debug trace" : "调试过程"}</strong><span class="status-chip running">${esc(studioSimulationStatus("running"))}</span></div><div class="team-debug-transcript-wrap"><ol class="team-debug-transcript" aria-live="polite"></ol></div><p class="form-hint">${state.locale === "en" ? "This run continues in the current tab. Use Stop to end it." : "调试会在当前标签页继续运行；点击“停止”可结束任务。"}</p>${studioRuntimeAuditDrawerMarkup(state.locale)}</div>`;
  }
  const transcriptList = result?.querySelector(".team-debug-transcript");
  const roleName = (roleId) => studioRoleDisplayName(authoring, roleId, state.locale) || roleId;
  bindStudioRuntimeAuditDrawer(result, graph, roleName);
  const restoredCards = new Map();
  const pendingHandoffs = new Map();
  const endpoint = `/api/v1/teams/${encodeURIComponent(active.teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations/${encodeURIComponent(subscription)}`;
  const connected = () => stage.isConnected;
  try {
    const detailResponse = await pageFetch(endpoint);
    const initialDetail = await detailResponse.json();
    if (!detailResponse.ok) throw new Error(initialDetail.error || "Unable to load the active Studio debug run.");
    const simulationInput = debugPanel?.querySelector("#team-simulation-input");
    if (simulationInput) simulationInput.value = initialDetail.simulation?.input || "";
    appendStudioUserPrompt(transcriptList, initialDetail.simulation?.input, initialDetail.simulation?.createdAt || Date.now());
    if (initialDetail.simulation?.mode) {
      const mode = debugPanel?.querySelector(`input[name="studioSimulationMode"][value="${CSS.escape(initialDetail.simulation.mode)}"]`);
      if (mode) mode.checked = true;
    }
    let cursor = 0;
    const transcript = [];
    while (connected() && (!pageRequest || isCurrentRequest(pageRequest))) {
      const response = await pageFetch(`${endpoint}/events?afterCursor=${cursor}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to resume Studio debug progress.");
      const incoming = runtimeEventsFromPayload(payload);
      transcript.push(...incoming);
      cursor = Number(payload.cursor || cursor);
      graph.setRuntimeProgress(transcript);
      const followProgress = transcriptList && transcriptList.scrollHeight - transcriptList.scrollTop - transcriptList.clientHeight <= 56;
      for (const event of incoming) {
        if (event.type === "flow.activated") {
          appendStudioRuntimeHandoff(restoredCards, event, roleName, pendingHandoffs);
          continue;
        }
        if (event.fromRoleId === "__system_start__" || event.toRoleId === "__system_end__" || event.eventType === "START") continue;
        const roleId = event.roleId || event.toRoleId || event.fromRoleId || "system";
        const key = event.executionId || `${roleId}:${event.branchId || ""}:${event.loopIteration || 1}`;
        let item = restoredCards.get(key);
        if (!item) {
          const template = document.createElement("template");
          template.innerHTML = studioRuntimeRoleCardMarkup({ event, roleName: roleName(roleId), authoring, auditIndex: transcript.length - incoming.length });
          item = template.content.firstElementChild;
          if (!item) continue;
          item.dataset.executionKey = key;
          transcriptList?.append(item);
          restoredCards.set(key, item);
          for (const handoff of pendingHandoffs.get(roleId) || []) appendStudioRuntimeHandoff(restoredCards, handoff, roleName, pendingHandoffs);
          pendingHandoffs.delete(roleId);
        }
        item._studioAuditItem = { ...(item._studioAuditItem || {}), ...event };
        const detail = event.failure || event.stdoutPreview || event.content || event.reason || event.eventType || "";
        if (detail) {
          const presentation = studioMessagePresentation(detail);
          const short = presentation.content.length > 280 ? `${presentation.content.slice(0, 280).trimEnd()}…` : presentation.content;
          const body = item.querySelector(".team-debug-bubble-body");
          body.innerHTML = `${presentation.label ? `<span class="studio-message-event">${esc(presentation.label)}</span>` : ""}<span class="studio-message-content-preview">${esc(short)}</span>${presentation.content.length > 280 ? `<button type="button" class="studio-message-more">${state.locale === "en" ? "More" : "更多"}</button><pre hidden>${esc(presentation.content)}</pre>` : ""}`;
          bindStudioMessageMore(body);
        }
      }
      bindStudioRuntimeAuditDrawer(result, graph, roleName);
      if (followProgress && incoming.length) transcriptList.scrollTop = transcriptList.scrollHeight;
      setEditorState(state.locale === "en" ? "Studio debug run in progress…" : "Studio 调试运行中…");
      if (payload.done) {
        const detailResponse = await pageFetch(endpoint);
        const detailPayload = await detailResponse.json();
        const simulation = detailPayload.simulation || {};
        const finalState = detailPayload.state || {};
        mergeStudioAuditTrail(restoredCards, finalState.auditTrail);
        const output = finalState.finalOutputsByRoleId
          ? Object.entries(finalState.finalOutputsByRoleId).flatMap(([roleId, outputs]) => (outputs || []).map((entry) => `${roleId}: ${entry.content || JSON.stringify(entry.data || {})}`)).join("\n\n")
          : studioSimulationErrorText(finalState.error || simulation.failureSummary || "");
        const status = simulation.status || "completed";
        const statusChip = result?.querySelector(".team-simulation-result .status-chip");
        if (statusChip) {
          statusChip.className = `status-chip ${esc(status)}`;
          statusChip.textContent = studioSimulationStatus(status);
        }
        if (result) {
          const final = document.createElement("pre");
          final.textContent = output || (state.locale === "en" ? "No final output was produced." : "没有生成最终结果。");
          result.querySelector(".team-simulation-result")?.append(final);
        }
        clearStudioActiveRun(subscription);
        state.studioActiveRun = null;
        syncDebugRunButton("terminal");
        setEditorState(state.locale === "en" ? "Studio debug run completed." : "Studio 调试运行已结束。");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
  } catch (error) {
    if (!isAbort(error)) console.warn("Unable to resume Studio debug progress", error);
  } finally {
    if (studioProgressSubscriptions.get(subscription) === stage) studioProgressSubscriptions.delete(subscription);
  }
}

async function renderProjectGraph(projectId, stageId = "project-graph-stage", readOnly = false, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  const stage = $("#" + stageId);
  if (!stage) return;
  trackStudioGraphRoot(stage);
  const editorStatusCopy = {
    "有未保存的下游顺序修改": "Unsaved transition-order changes.",
    "有未保存的专业配置修改": "Unsaved execution settings.",
    "有未保存的上下文映射修改": "Unsaved context-map changes.",
    "有未保存的流程契约修改": "Unsaved transition-contract changes.",
    "交接契约 JSON 无效，请修正后再编辑。": "The transition-contract JSON is invalid. Fix it before editing.",
    "交接契约必须包含 version: 1 和 contracts 数组。": "The transition contract must contain version: 1 and a contracts array.",
    "请输入本次模拟的任务内容": "Enter a task to debug.",
    "请先保存未提交的图谱修改，再运行模拟": "Save the unsaved graph changes before starting a debug run.",
    "请先点击图谱工具栏中的“保存”保存未提交的图谱修改，再开始调试。": "Save the unsaved graph changes from the graph toolbar before starting a debug run.",
    "正在运行 Studio 模拟…": "Studio debug run in progress…"
  };
  const setEditorState = (message) => {
    const status = $("#project-design-status");
    if (!status) return;
    const text = state.locale === "en" ? editorStatusCopy[message] || message : message;
    let messageSpan = status.querySelector(".studio-graph-status-text");
    if (!messageSpan) {
      messageSpan = document.createElement("span");
      messageSpan.className = "studio-graph-status-text";
      const projectStatus = status.querySelector(".project-status") || status.parentElement?.querySelector(":scope > .project-status");
      status.replaceChildren(messageSpan);
      if (projectStatus) status.append(document.createTextNode(" · "), projectStatus);
    }
    messageSpan.textContent = text;
  };
  const showLoading = (message) => {
    stage.setAttribute("aria-busy", "true");
    stage.innerHTML = '<div class="studio-graph-loading" role="status" aria-live="polite"><span class="studio-graph-loading-spinner" aria-hidden="true"></span><span>' + esc(message) + '</span><span class="studio-graph-loading-track" aria-hidden="true"><i></i></span></div>';
    setEditorState(message);
  };
  showLoading(state.locale === "en" ? "Preparing graph editor…" : "正在准备图谱编辑器…");
  try {
    await ensureStudioGraphBundle();
  } catch (error) {
    stage.removeAttribute("aria-busy");
    stage.textContent = error.message || "Studio graph engine is unavailable.";
    setEditorState(error.message || (state.locale === "en" ? "Unable to load the graph editor." : "图谱编辑器加载失败。"));
    return;
  }
  if (!stage.isConnected || (pageRequest && !isCurrentRequest(pageRequest))) return;
  if (!window.OGSStudioGraphBundle?.mountStudioX6Bridge) {
    const message = state.locale === "en" ? "Graph editor is unavailable. Reload the page and try again." : "图谱编辑器不可用，请刷新页面后重试。";
    stage.removeAttribute("aria-busy");
    stage.textContent = message;
    setEditorState(message);
    return;
  }
  try {
    showLoading(state.locale === "en" ? "Loading team structure…" : "正在读取团队结构…");
    const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/design?locale=${encodeURIComponent(state.locale)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load the project graph.");
    if (!stage.isConnected || (pageRequest && !isCurrentRequest(pageRequest))) return;
    if (readOnly) {
      const graph = mountStudioGraph(stage, {
        mode: "run-diagnosis",
        viewModel: payload.viewModel,
        readOnly: true,
        showTopologyOrder: false,
        showTechnicalDetails: false,
        initialLayoutMode: "flow",
        defaultAutoLayout: true,
        defaultAutoLayoutRequestId: 1,
        labels: graphLabels[state.locale],
        onToggleFullscreen: async () => {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await stage.requestFullscreen();
        }
      });
      stage.removeAttribute("aria-busy");
      markStudioGraphReady(stage);
      return graph;
    }
    let authoring = payload.authoring;
    let canvas = payload.canvas;
    let projectDigest = payload.saveSnapshotDigest || payload.teamVersionDigest;
    let dirty = false;
    state.isTeamGraphDirty = () => dirty;
    let selection = { roleId: "", flowKey: "", flowId: "", assets: { roles: {}, contracts: "" } };
    const workbench = stage.closest(".studio-design-workbench");
    const inspector = $("#studio-property-inspector");
    let assetDrawer = workbench?.querySelector("#studio-asset-drawer");
    const debugPanel = workbench?.querySelector("#team-debug-dialog");
    const setDebugView = (view) => {
      const next = view === "run" ? "run" : "config";
      debugPanel?.querySelectorAll("[data-debug-view]").forEach((tab) => {
        const active = tab.dataset.debugView === next;
        tab.setAttribute("aria-selected", String(active));
        tab.classList.toggle("active", active);
      });
      debugPanel?.querySelectorAll("[data-debug-view-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.debugViewPanel !== next;
      });
    };
    const syncDebugRunButton = (status = "idle") => {
      const button = debugPanel?.querySelector("#team-simulation-run");
      const stateLabel = debugPanel?.querySelector("[data-debug-run-state]");
      if (!button) return;
      const running = status === "running" || status === "stopping";
      button.dataset.running = String(running);
      button.classList.toggle("danger-button", running);
      button.classList.toggle("is-stopping", status === "stopping");
      button.dataset.debugState = status;
      button.disabled = status === "stopping";
      button.textContent = status === "stopping"
        ? (state.locale === "en" ? "Stopping…" : "正在停止…")
        : running
          ? (state.locale === "en" ? "Stop" : "停止")
          : status === "terminal"
            ? (state.locale === "en" ? "Debug again" : "重新调试")
            : (state.locale === "en" ? "Start debug run" : "开始调试");
      button.setAttribute("aria-label", button.textContent);
      if (stateLabel) stateLabel.textContent = running
        ? (status === "stopping" ? (state.locale === "en" ? "stopping" : "正在停止") : (state.locale === "en" ? "running" : "运行中"))
        : "";
    };
    const assetToggle = () => workbench?.querySelector("[data-studio-graph-action='assets']");
    let assetListView = assetDrawer?.querySelector("#studio-assets-list-view");
    let propertyView = assetDrawer?.querySelector("#studio-assets-property-view");
    let globalView = assetDrawer?.querySelector("#studio-assets-global");
    let assetBack = assetDrawer?.querySelector("[data-studio-assets-back]");
    let assetPanelView = "list";
    let commandDismissRequest = 0;
    let runtimePanelStyleSnapshot = null;
    let runtimeWorkbenchClassSnapshot = null;
    let runtimeGraphPanelClassSnapshot = null;
    let runtimeDebugPanelClassSnapshot = null;
    let runtimeMicroOpen = true;
    let syncRuntimeDualCore = null;
    const isCompactPanelViewport = () => window.matchMedia?.("(max-width: 760px)").matches === true;
    const showAssetPanel = (view = "list", { focusInspector = true } = {}) => {
      assetDrawer ||= workbench?.querySelector("#studio-asset-drawer");
      if (!assetDrawer) return;
      assetListView ||= assetDrawer.querySelector("#studio-assets-list-view");
      propertyView ||= assetDrawer.querySelector("#studio-assets-property-view");
      globalView ||= assetDrawer.querySelector("#studio-assets-global");
      assetBack ||= assetDrawer.querySelector("[data-studio-assets-back]");
      const buildPanel = workbench?.querySelector("#team-build-panel");
      const currentDebugPanel = workbench?.querySelector("#team-debug-dialog");
      if (isCompactPanelViewport()) {
        buildPanel?.classList.remove("is-open");
        buildPanel?.setAttribute("aria-hidden", "true");
        currentDebugPanel?.classList.remove("is-open");
        currentDebugPanel?.setAttribute("aria-hidden", "true");
        workbench?.querySelector('[data-studio-graph-action="debug-run"]')?.setAttribute("aria-expanded", "false");
      }
      assetDrawer.classList.add("is-open");
      workbench?.studioSyncPanelDockLayout?.("asset");
      assetPanelView = view;
      assetToggle()?.setAttribute("aria-expanded", "true");
      assetDrawer.setAttribute("aria-hidden", "false");
      const showProperties = view === "properties";
      if (assetListView) assetListView.hidden = showProperties;
      if (propertyView) propertyView.hidden = !showProperties;
      if (assetBack) assetBack.hidden = !showProperties;
      if (showProperties && focusInspector) inspector?.querySelector("input,select,textarea,button")?.focus({ preventScroll: true });
    };
    workbench?.addEventListener("studio-assets-show", (event) => showAssetPanel(event.detail?.view || "list"));
    workbench?.addEventListener("studio-global-settings-saved", (event) => {
      const { authoring: savedAuthoring, teamVersionDigest, assets } = event.detail || {};
      if (!savedAuthoring) return;
      const stagedAssets = selection.assets;
      authoring = savedAuthoring;
      projectDigest = teamVersionDigest || projectDigest;
      selection.assets = { ...assets, roles: stagedAssets.roles, executionConfig: stagedAssets.executionConfig };
      updateStudioGraph?.update({ authoring, viewModel: undefined, historyContext: captureEditorHistoryContext() });
      renderInspector();
      renderAssetNavigator();
      setEditorState(state.locale === "en" ? "Global configuration saved." : "全局配置已保存。");
    });
    workbench?.addEventListener("studio-command-dismiss", () => {
      updateStudioGraph?.update({ dismissCommandFormRequest: ++commandDismissRequest });
    });
    const pendingRoleAssets = new Set();
    const pendingContractSchemas = new Set();
    let contractsDirty = false;
    let executionConfigDirty = false;
    let modelSelectionDirty = false;
    let editorHistoryRevision = 0;
    let editorHistoryFieldActive = false;
    const captureEditorHistoryContext = () => JSON.parse(JSON.stringify({
      assets: selection.assets,
      pendingRoleAssets: [...pendingRoleAssets],
      pendingContractSchemas: [...pendingContractSchemas],
      contractsDirty,
      executionConfigDirty,
      modelSelectionDirty
    }));
    const recordEditorHistory = () => updateStudioGraph?.update({
      historyContext: captureEditorHistoryContext(),
      historyEvent: { id: ++editorHistoryRevision, kind: "push-before-replace", label: "Edit team properties" }
    });
    selection.assets = payload.saveSnapshotAssets;
    let discoveredModels = [];
    try {
      const modelResponse = await pageFetch("/api/v1/platform/models");
      const modelPayload = await modelResponse.json();
      if (modelResponse.ok) discoveredModels = modelPayload.models || [];
    } catch { /* The design editor remains available when model discovery is offline. */ }
    let studioRoleTemplatesByCommandId = new Map();
    let studioSourceRolesByCommandId = new Map();
    let studioRolePackages = { rolePackages: [] };
    try {
      const templateResponse = await pageFetch("/api/v1/studio/role-repository");
      const templatePayload = await templateResponse.json();
      if (templateResponse.ok) {
        const templates = templatePayload.templates || [];
        const latestTemplates = new Map();
        for (const template of templates) {
          const current = latestTemplates.get(template.roleId);
          if (!current || String(template.createdAt || "") > String(current.createdAt || "")) latestTemplates.set(template.roleId, template);
        }
        studioRolePackages.rolePackages = [...latestTemplates.values()].map((template) => ({
          roleId: template.roleId,
          name: template.name,
          description: template.description,
          status: template.assets?.includes("role.json") && template.assets?.includes("prompt.md") ? "ok" : "incomplete",
          hasRoleJson: template.assets?.includes("role.json"),
          hasPrompt: template.assets?.includes("prompt.md"),
          hasOutputSchema: template.assets?.includes("output.schema.json"),
          source: "OGS Studio role repository"
        }));
        for (const template of latestTemplates.values()) studioRoleTemplatesByCommandId.set(template.roleId, template);
        const requested = new URLSearchParams(location.search);
        const templateId = requested.get("roleTemplate");
        const versionId = requested.get("version");
        const targetRoleId = requested.get("roleId");
        const selectedTemplate = templates.find((template) => template.roleId === templateId && template.versionId === versionId);
        if (selectedTemplate && /^[a-z][a-z0-9_-]{0,79}$/.test(targetRoleId || "")) {
          studioRolePackages.rolePackages = studioRolePackages.rolePackages.filter((item) => item.roleId !== selectedTemplate.roleId);
          studioRolePackages.rolePackages.push({
            roleId: targetRoleId,
            name: selectedTemplate.name,
            description: selectedTemplate.description,
            status: selectedTemplate.assets?.includes("role.json") && selectedTemplate.assets?.includes("prompt.md") ? "ok" : "incomplete",
            hasRoleJson: selectedTemplate.assets?.includes("role.json"),
            hasPrompt: selectedTemplate.assets?.includes("prompt.md"),
            hasOutputSchema: selectedTemplate.assets?.includes("output.schema.json"),
            source: "OGS Studio role repository"
          });
          studioRoleTemplatesByCommandId.set(targetRoleId, selectedTemplate);
        }
      }
    } catch { /* A missing optional shared catalog must not block team design. */ }
    try {
      const sourcesResponse = await pageFetch("/api/v1/studio/role-sources");
      const sourcesPayload = await sourcesResponse.json();
      if (sourcesResponse.ok) {
        for (const source of sourcesPayload.sources || []) for (const sourceRole of source.roles || []) {
          if (sourceRole.status !== "ready") continue;
          let hash = 2166136261;
          for (const character of `${source.sourceId}/${sourceRole.roleId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
          const roleId = `source-${(hash >>> 0).toString(36)}`;
          if (studioRolePackages.rolePackages.some((item) => item.roleId === roleId)) continue;
          studioRolePackages.rolePackages.push({
            roleId,
            name: sourceRole.name,
            description: sourceRole.description,
            status: "ok",
            hasRoleJson: true,
            hasPrompt: true,
            hasOutputSchema: true,
            source: `${source.name || source.sourceId} · ${sourceRole.category || "role"}`
          });
          studioSourceRolesByCommandId.set(roleId, { sourceId: source.sourceId, roleKey: sourceRole.roleId, commit: sourceRole.commit || source.commit });
        }
      }
    } catch { /* Source roles are optional; installed role packages remain available. */ }
    const renderInspector = () => {
      if (!inspector) return;
      inspector.innerHTML = studioPropertyInspectorMarkup(authoring, selection, state.locale, discoveredModels);
      const selectedRole = selection.roleId ? authoring.roles?.[selection.roleId] : undefined;
      if (selectedRole?.bindingKind === "exec") inspector.insertAdjacentHTML("beforeend", studioExecutionConfigMarkup(selectedRole, selection, state.locale));
      if (selectedRole) {
        inspector.insertAdjacentHTML("beforeend", studioRouteOrderMarkup(authoring, selectedRole, state.locale));
        inspector.insertAdjacentHTML("beforeend", studioContextMapMarkup(authoring, selectedRole, state.locale));
      }
      if (!selectedRole && !selection.roleId && !selection.flowId && !selection.flowKey) inspector.insertAdjacentHTML("beforeend", studioRoleInputContractMarkup(authoring, selection, state.locale));
      localizeStudioInspector(inspector, state.locale);
      inspector.querySelectorAll("[data-studio-contract-schema]").forEach((element) => {
        element.addEventListener("input", () => updateInspector(element));
      });
    };
    const updateRouteOrderPresentation = (list) => {
      const rows = [...list.querySelectorAll("[data-studio-route-order-item]")];
      rows.forEach((row, index) => {
        row.setAttribute("aria-posinset", String(index + 1));
        row.querySelector("[data-studio-route-order-position]").textContent = String(index + 1);
        row.querySelector('[data-studio-route-order-move="up"]').disabled = index === 0;
        row.querySelector('[data-studio-route-order-move="down"]').disabled = index === rows.length - 1;
      });
      const role = authoring.roles[selection.roleId];
      if (role) role.routeOrder = rows.map((row) => row.dataset.studioRouteOrder);
    };
    const moveRouteOrderRow = (row, direction) => {
      const list = row.closest("[data-studio-route-order-list]");
      if (!list) return false;
      const sibling = direction === "up" ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling) return false;
      recordEditorHistory();
      if (direction === "up") list.insertBefore(row, sibling);
      else list.insertBefore(sibling, row);
      updateRouteOrderPresentation(list);
      markDesignDirty("有未保存的下游顺序修改");
      return true;
    };
    inspector?.addEventListener("dragstart", (event) => {
      const row = event.target.closest("[data-studio-route-order-item]");
      if (!row) return;
      recordEditorHistory();
      row.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", row.dataset.studioRouteOrder || "");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    inspector?.addEventListener("dragover", (event) => {
      const target = event.target.closest("[data-studio-route-order-item]");
      const dragging = inspector.querySelector("[data-studio-route-order-item].is-dragging");
      if (!target || !dragging || target === dragging) return;
      event.preventDefault();
      const bounds = target.getBoundingClientRect();
      const after = event.clientY > bounds.top + bounds.height / 2;
      target.parentElement.insertBefore(dragging, after ? target.nextSibling : target);
    });
    inspector?.addEventListener("drop", (event) => {
      const list = event.target.closest("[data-studio-route-order-list]");
      if (!list) return;
      event.preventDefault();
      const dragging = list.querySelector("[data-studio-route-order-item].is-dragging");
      if (!dragging) return;
      dragging.classList.remove("is-dragging");
      updateRouteOrderPresentation(list);
      markDesignDirty("有未保存的下游顺序修改");
    });
    inspector?.addEventListener("dragend", (event) => {
      const row = event.target.closest("[data-studio-route-order-item]");
      if (row) row.classList.remove("is-dragging");
    });
    const renderAssetNavigator = () => {
      const roleList = workbench?.querySelector("#studio-assets-roles");
      const flowList = workbench?.querySelector("#studio-assets-flows");
      if (!roleList || !flowList) return;
      const roles = Object.values(authoring.roles || {});
      const flows = Object.values(authoring.flows || {});
      roleList.innerHTML = `<label class="studio-asset-search"><span class="sr-only">${state.locale === "en" ? "Search roles" : "搜索角色"}</span><input type="search" placeholder="${state.locale === "en" ? "Search roles" : "搜索角色"}"></label>${roles.map((role) => { const color = roleColorForId(role.roleId); const backend = role.backend || (role.modelRef ? role.modelRef.split("/", 1)[0] : ""); const badge = backend ? `<span class="role-avatar-badge" title="${esc(backend)}">${renderBackendIcon(backend, { size: 10 })}</span>` : ""; return `<button type="button" class="studio-asset-row" data-studio-asset-role="${esc(role.roleId)}" aria-current="${selection.roleId === role.roleId ? "true" : "false"}"><span class="studio-role-avatar" style="--role-accent:${color.accent}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="7.5" r="3.3"></circle><path d="M4.5 21c.3-4.2 3-6.7 7.5-6.7s7.2 2.5 7.5 6.7z"></path></svg>${badge}</span><span><strong>${esc(studioRoleDisplayName(authoring, role.roleId, state.locale))}</strong><small>${esc(role.roleId)} · ${esc(role.bindingKind || "noop")}</small></span></button>`; }).join("") || `<p class="empty-note">${state.locale === "en" ? "No roles yet." : "尚无角色。"}</p>`}`;
      roleList.querySelectorAll("[data-studio-asset-role]").forEach((button) => {
        const role = roles.find((item) => item.roleId === button.dataset.studioAssetRole);
        const binding = role?.bindingKind || "noop";
        const label = state.locale === "en"
          ? { model: "AI model", exec: "Execution tool", noop: "Unbound" }[binding] || "Custom executor"
          : { model: "AI 模型", exec: "执行工具", noop: "未绑定执行器" }[binding] || "自定义执行器";
        const description = role?.description || role?.summary;
        button.querySelector("small").textContent = description ? `${label} · ${description}` : label;
      });
      flowList.innerHTML = `<label class="studio-asset-search"><span class="sr-only">${state.locale === "en" ? "Search flows" : "搜索流程"}</span><input type="search" placeholder="${state.locale === "en" ? "Search flows" : "搜索流程"}"></label>${flows.map((flow) => { const flowKey = studioAuthoringFlowKey(flow); const fromLabel = studioRoleDisplayName(authoring, flow.fromRoleId, state.locale); const targetLabel = studioRoleDisplayName(authoring, flow.toRoleId, state.locale); const flowLabel = flow.label || localizedEventLabel(flow.eventType, copy); return `<button type="button" class="studio-asset-row studio-flow-row" data-studio-asset-flow="${esc(flowKey)}" aria-current="${selection.flowKey === flowKey ? "true" : "false"}">${renderStudioFlowContractIcon(flow, authoring, selection?.assets?.contracts, state.locale)}<span><strong>${esc(flowLabel)}</strong><small>${esc(fromLabel)} → ${esc(targetLabel)}</small></span></button>`; }).join("") || `<p class="empty-note">${state.locale === "en" ? "No flows yet." : "尚无流程。"}</p>`}`;
      const flowSearch = flowList.querySelector(".studio-asset-search");
      if (flowSearch) {
        const label = state.locale === "en" ? "Search transitions" : "搜索流转";
        flowSearch.querySelector("span").textContent = label;
        flowSearch.querySelector("input").placeholder = label;
      }
      const emptyFlows = flowList.querySelector(":scope > .empty-note");
      if (emptyFlows) emptyFlows.textContent = state.locale === "en" ? "No transitions yet." : "暂无流转。";
      flowList.querySelectorAll("[data-studio-asset-flow]").forEach((button) => {
        const key = button.dataset.studioAssetFlow;
        const flow = flows.find((item) => studioAuthoringFlowKey(item) === key);
        if (!flow) return;
        const endpointName = (roleId) => studioRoleDisplayName(authoring, roleId, state.locale);
        button.querySelector("small").textContent = `${endpointName(flow.fromRoleId)} → ${endpointName(flow.toRoleId)}`;
      });
      for (const [list, selector, getFlow] of [[roleList, "[data-studio-asset-role]", false], [flowList, "[data-studio-asset-flow]", true]]) {
        list.querySelectorAll(selector).forEach((button) => button.addEventListener("click", () => {
          const value = button.dataset[getFlow ? "studioAssetFlow" : "studioAssetRole"];
          const flow = getFlow ? Object.values(authoring.flows || {}).find((item) => studioAuthoringFlowKey(item) === value) : null;
          if (getFlow && !flow) {
            setStudioSelection();
          } else {
            setStudioSelection(getFlow ? { flowKey: value, flowId: flow.flowId } : { roleId: value });
          }
          updateStudioGraph?.update({ selectedRoleId: selection.roleId, selectedFlowKey: selection.flowKey });
          renderInspector();
          renderAssetNavigator();
          showAssetPanel("properties");
        }));
        list.querySelector(".studio-asset-search input")?.addEventListener("input", (event) => {
          const query = event.currentTarget.value.trim().toLocaleLowerCase();
          list.querySelectorAll(selector).forEach((button) => { button.hidden = Boolean(query && !button.textContent.toLocaleLowerCase().includes(query)); });
        });
      }
    };
    const setStudioSelection = ({ roleId = "", flowKey = "", flowId = "" } = {}) => {
      selection = {
        roleId: roleId || "",
        flowKey: flowKey || "",
        flowId: flowId || "",
        assets: selection.assets
      };
    };
    const syncFlowPresentation = (flow) => {
      if (!flow) {
        setStudioSelection();
        updateStudioGraph?.update({ selectedRoleId: "", selectedFlowKey: "" });
        renderAssetNavigator();
        syncAssetNavigatorSelection();
        return;
      }
      setStudioSelection({ flowKey: studioAuthoringFlowKey(flow), flowId: flow.flowId });
      updateStudioGraph?.update({
        authoring,
        viewModel: undefined,
        selectedRoleId: "",
        selectedFlowKey: selection.flowKey
      });
      renderAssetNavigator();
      syncAssetNavigatorSelection();
    };
    const syncRoleDependentPresentation = (role) => {
      if (!role) return;
      const roleName = (roleId) => studioRoleDisplayName(authoring, roleId, state.locale);
      inspector?.querySelectorAll("[data-studio-route-order-item]").forEach((row) => {
        const target = row.dataset.studioRouteOrder || "";
        const name = roleName(target);
        const nameElement = row.querySelector(".studio-route-order-name");
        if (nameElement) nameElement.textContent = name;
        const handle = row.querySelector("[data-studio-route-order-handle]");
        if (handle) {
          const label = state.locale === "en" ? `Drag to reorder ${name}` : `拖动调整${name}顺序`;
          handle.setAttribute("aria-label", label);
          handle.title = label;
        }
        const moveUp = state.locale === "en" ? `Move ${name} up` : `将${name}上移`;
        const moveDown = state.locale === "en" ? `Move ${name} down` : `将${name}下移`;
        const upButton = row.querySelector('[data-studio-route-order-move="up"]');
        const downButton = row.querySelector('[data-studio-route-order-move="down"]');
        upButton?.setAttribute("aria-label", moveUp);
        upButton?.setAttribute("title", moveUp);
        downButton?.setAttribute("aria-label", moveDown);
        downButton?.setAttribute("title", moveDown);
      });
      inspector?.querySelectorAll('[data-studio-role-field="reviewTarget"] option').forEach((option) => {
        if (option.value) option.textContent = roleName(option.value);
      });
      inspector?.querySelectorAll("[data-studio-context-source] option").forEach((option) => {
        const match = String(option.value || "").match(/^source\((.+)\)\.(content|event|data)$/);
        if (!match) return;
        const labels = state.locale === "en"
          ? { content: "role output", event: "flow event", data: "structured data" }
          : { content: "角色输出", event: "流转事件", data: "结构化数据" };
        option.textContent = `${roleName(match[1])} · ${labels[match[2]]}`;
      });
    };
    const syncRoleTitlePresentation = () => {
      const role = selection.roleId ? authoring.roles?.[selection.roleId] : null;
      if (!role) return;
      const heading = inspector?.querySelector(".studio-inspector-heading h2");
      if (heading) heading.textContent = studioRoleDisplayName(authoring, role.roleId, state.locale);
      syncRoleDependentPresentation(role);
      updateStudioGraph?.update({
        authoring,
        viewModel: undefined,
        selectedRoleId: selection.roleId,
        selectedFlowKey: ""
      });
      renderAssetNavigator();
      syncAssetNavigatorSelection();
    };
    const syncAssetNavigatorSelection = () => {
      workbench?.querySelectorAll(".studio-asset-row").forEach((button) => {
        const selected = button.dataset.studioAssetRole === selection.roleId || button.dataset.studioAssetFlow === selection.flowKey;
        button.setAttribute("aria-current", String(selected));
      });
    };
    const markDesignDirty = (message) => {
      dirty = true;
      setDirty("project-graph");
      updateStudioGraph?.update({ historyContext: captureEditorHistoryContext() });
      setEditorState(message);
    };
    const readJsonField = (element, emptyValue) => {
      const source = element.value.trim();
      if (!source) return { ok: true, value: emptyValue };
      try { return { ok: true, value: JSON.parse(source) }; }
      catch { return { ok: false }; }
    };
    const profileForRole = (role) => {
      const config = selection.assets.executionConfig ||= { profiles: [], tools: { tools: [] } };
      const profileId = role.profileId || `${role.roleId}-profile`;
      let profile = config.profiles.find((item) => item.profileId === profileId);
      if (!profile) {
        profile = { profileId, toolRef: `${role.roleId}-tool` };
        config.profiles.push(profile);
      }
      return profile;
    };
    const toolForProfile = (profile) => {
      const config = selection.assets.executionConfig;
      let tool = config.tools.tools.find((item) => item.toolRef === profile.toolRef);
      if (!tool) {
        tool = { toolRef: profile.toolRef, runner: "local_shell", command: "node", argsTemplate: [], stdinMode: "text" };
        config.tools.tools.push(tool);
      }
      return tool;
    };
    const updateInspector = (element) => {
      const systemField = element.dataset.studioSystemField;
      const roleField = element.dataset.studioRoleField;
      const flowField = element.dataset.studioFlowField;
      const roleAsset = element.dataset.studioRoleAsset;
      const specialField = element.dataset.studioSpecialField;
      const profileField = element.dataset.studioProfileField;
      const toolField = element.dataset.studioToolField;
      const roleTool = element.dataset.studioRoleTool;
      const roleToolExtra = element.dataset.studioRoleToolExtra !== undefined;
      if (roleTool !== undefined || roleToolExtra) {
        if (!selection.roleId) return false;
        const roleId = selection.roleId;
        const toolCheckboxes = inspector?.querySelectorAll("[data-studio-role-tool]") || [];
        const checkedTools = [];
        toolCheckboxes.forEach((cb) => {
          if (cb.checked) checkedTools.push(cb.dataset.studioRoleTool);
        });
        const extraInput = inspector?.querySelector("[data-studio-role-tool-extra]");
        const extraTools = (extraInput?.value || "")
          .split(/[\s,]+/)
          .map((item) => item.trim())
          .filter(Boolean);
        const nextAllowedTools = Array.from(new Set([...checkedTools, ...extraTools])).sort((a, b) => a.localeCompare(b));
        selection.assets.roles ||= {};
        selection.assets.roles[roleId] ||= {};
        let roleContract = {};
        try {
          roleContract = JSON.parse(selection.assets.roles[roleId]["role.json"] || "{}");
        } catch {
          roleContract = {};
        }
        roleContract.contractVersion ||= 1;
        roleContract.purpose ||= `Role execution contract for ${roleId}`;
        roleContract.responsibility ||= { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] };
        roleContract.inputs ||= { preconditions: [] };
        roleContract.outputs ||= { events: ["READY"], postconditions: [] };
        roleContract.authority ||= { controlActions: [] };
        roleContract.constraints ||= { writableStateFields: [] };
        roleContract.constraints.writableStateFields ||= [];
        roleContract.constraints.allowedTools = nextAllowedTools;
        roleContract.failure ||= { retryableErrorCodes: [], terminalErrorCodes: [] };
        roleContract.audit ||= { requiredFields: [] };
        const nextJson = JSON.stringify(roleContract, null, 2);
        selection.assets.roles[roleId]["role.json"] = nextJson;
        pendingRoleAssets.add(`${roleId}/role.json`);
        const rawEditor = inspector?.querySelector('[data-studio-role-asset="role.json"]');
        if (rawEditor && document.activeElement !== rawEditor) {
          rawEditor.value = nextJson;
        }
        const summary = inspector?.querySelector("[data-studio-allowed-tools-summary]");
        if (summary) {
          summary.textContent = nextAllowedTools.join(", ") || (state.locale === "en" ? "None" : "无");
        }
        const conflictContainer = inspector?.querySelector("[data-studio-role-tool-conflict]");
        if (conflictContainer) {
          const selectedGlobalLaw = (selection.assets?.laws?.laws || []).find((law) => law.lawId === authoring.system?.lawGlobalRef);
          const forbiddenTools = selectedGlobalLaw?.constraints?.forbiddenToolRefs || [];
          const blockedRoleTools = nextAllowedTools.filter((toolRef) => forbiddenTools.includes(toolRef));
          conflictContainer.innerHTML = blockedRoleTools.length
            ? `<p class="studio-permission-conflict" role="alert">${state.locale === "en" ? "Disabled by global law" : "与全局禁用工具冲突"}: ${esc(blockedRoleTools.join(", "))}</p>`
            : "";
        }
        markDesignDirty(state.locale === "en" ? "Allowed tools modified." : "有未保存的角色工具权限修改");
        return true;
      }
      if (profileField || toolField) {
        const role = authoring.roles[selection.roleId];
        if (!role) return false;
        const oldProfileId = role.profileId || `${role.roleId}-profile`;
        const profile = profileForRole(role);
        if (profileField === "profileId") {
          const nextId = element.value.trim();
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(nextId)) return false;
          if (selection.assets.executionConfig.profiles.some((item) => item !== profile && item.profileId === nextId)) return false;
          profile.profileId = nextId;
          role.profileId = nextId;
        } else if (profileField === "toolRef") {
          const nextRef = element.value.trim();
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(nextRef)) return false;
          const oldRef = profile.toolRef;
          profile.toolRef = nextRef;
          let tool = selection.assets.executionConfig.tools.tools.find((item) => item.toolRef === oldRef);
          if (tool) tool.toolRef = nextRef;
          else toolForProfile(profile);
        } else if (["timeoutMs", "maxOutputBytes"].includes(profileField)) {
          const value = element.value === "" ? undefined : Number(element.value);
          if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) return false;
          if (value === undefined) delete profile[profileField];
          else profile[profileField] = value;
          toolForProfile(profile);
        } else if (toolField === "argsTemplate") {
          const parsed = readJsonField(element, []);
          if (!parsed.ok || !Array.isArray(parsed.value) || parsed.value.some((item) => typeof item !== "string")) return false;
          toolForProfile(profile).argsTemplate = parsed.value;
        } else if (toolField === "command") {
          const command = element.value.trim();
          if (!command) return false;
          toolForProfile(profile).command = command;
        } else if (toolField === "stdinMode") {
          if (!new Set(["none", "text"]).has(element.value)) return false;
          toolForProfile(profile).stdinMode = element.value;
        }
        if (oldProfileId !== profile.profileId) role.profileId = profile.profileId;
        executionConfigDirty = true;
      } else if (specialField === "startDispatchMode") {
        authoring.system.startDispatch = element.value === "random_n"
          ? { mode: "random_n", count: Math.min(Math.max(1, authoring.system.startDispatch?.count || 1), Object.values(authoring.flows || {}).filter((flow) => flow.fromRoleId === "__system_start__").length) }
          : { mode: "all" };
      } else if (specialField === "startDispatchCount") {
        const count = Number(element.value);
        const candidates = Object.values(authoring.flows || {}).filter((flow) => flow.fromRoleId === "__system_start__").length;
        if (!Number.isInteger(count) || count < 1 || count > candidates) return false;
        authoring.system.startDispatch = { mode: "random_n", count };
      } else if (specialField === "endJoinMode") {
        authoring.system.endJoin = element.value === "quorum_of"
          ? { mode: "quorum_of", min: Math.min(Math.max(1, authoring.system.endJoin?.min || 1), Math.max(1, new Set(Object.values(authoring.flows || {}).filter((flow) => flow.toRoleId === "__system_end__").map((flow) => flow.fromRoleId)).size)) }
          : { mode: "all_of" };
      } else if (specialField === "endJoinMin") {
        const count = Number(element.value);
        const terminalRoles = new Set(Object.values(authoring.flows || {}).filter((flow) => flow.toRoleId === "__system_end__").map((flow) => flow.fromRoleId)).size;
        if (!Number.isInteger(count) || count < 1 || count > terminalRoles) return false;
        authoring.system.endJoin = { mode: "quorum_of", min: count };
      } else if (systemField) {
        authoring.system[systemField] = element.value;
      } else if (roleField) {
        const role = authoring.roles[selection.roleId];
        if (!role) return false;
        if (roleField === "contextMap") {
          const parsed = readJsonField(element, {});
          if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)
            || Object.entries(parsed.value).some(([key, value]) => !key.trim() || typeof value !== "string" || !value.trim())) return false;
          role.contextMap = parsed.value;
        } else if (roleField === "reviewEnabled") {
          role.review = element.checked ? { ...role.review, mode: "required", timeoutAction: role.review?.timeoutAction || "pause", terminateScope: role.review?.terminateScope || "branch" } : undefined;
        } else if (roleField.startsWith("review")) {
          const review = { ...(role.review || {}), mode: "required" };
          if (roleField === "reviewTimeout") review.timeoutSeconds = element.value === "" ? undefined : Number(element.value);
          if (roleField === "reviewTimeoutAction") review.timeoutAction = element.value;
          if (roleField === "reviewTarget") review.reworkTargetRoleId = element.value || undefined;
          if (roleField === "reviewReworkMax") review.reworkMax = element.value === "" ? undefined : Number(element.value);
          if (roleField === "reviewTerminateScope") review.terminateScope = element.value;
          role.review = review;
        } else if (["joinMin", "loopMax"].includes(roleField)) {
          role[roleField] = element.value === "" ? undefined : Number(element.value);
        } else if (["routingMode", "joinMode"].includes(roleField)) {
          if (element.value) role[roleField] = element.value;
          else delete role[roleField];
        } else if (roleField === "profileId") {
          const profileId = element.value.trim();
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(profileId)) return false;
          const currentProfile = profileForRole(role);
          if (selection.assets.executionConfig.profiles.some((item) => item !== currentProfile && item.profileId === profileId)) return false;
          currentProfile.profileId = profileId;
          role.profileId = profileId;
          executionConfigDirty = true;
        } else if (roleField === "modelRef") {
          const [backend, modelId] = element.value ? JSON.parse(element.value) : [];
          role.backend = typeof backend === "string" ? backend : undefined;
          role.modelId = typeof modelId === "string" ? modelId : undefined;
          delete role.modelRef;
          role.modelSelectionSource = "role";
          modelSelectionDirty = true;
        } else if (roleField === "fallbackModel") {
          const [backend, modelId] = element.value ? JSON.parse(element.value) : [];
          role.fallback = backend && modelId ? {
            backend,
            modelId,
            modelRef: `${backend}/${modelId}`
          } : undefined;
          modelSelectionDirty = true;
        } else if (roleField === "bindingKind") {
          role.bindingKind = element.value;
          modelSelectionDirty = true;
          if (role.bindingKind === "exec") {
            role.profileId ||= `${role.roleId}-profile`;
            toolForProfile(profileForRole(role));
            executionConfigDirty = true;
          }
          if (role.bindingKind !== "model") {
            delete role.modelRef;
            delete role.backend;
            delete role.modelId;
            delete role.fallback;
            delete role.modelSelectionSource;
          }
          if (role.bindingKind !== "exec") delete role.profileId;
        } else if (roleField === "title") {
          const title = element.value.trim().slice(0, 80);
          if (element.value !== title) element.value = title;
          role.title = title || undefined;
          syncRoleTitlePresentation();
        } else {
          role[roleField] = element.value || undefined;
        }
      } else if (flowField) {
        const flow = resolveStudioSelectedFlow(authoring, selection);
        if (!flow) return false;
        if (flowField === "condition") {
          const parsed = readJsonField(element, undefined);
          if (!parsed.ok) return false;
          if (parsed.value === undefined) delete flow.condition;
          else flow.condition = parsed.value;
        } else if (flowField === "priority") {
          flow.priority = element.value === "" ? undefined : Number(element.value);
        } else if (flowField === "runtimeOnlyErrorFlow") {
          flow.runtimeOnlyErrorFlow = element.checked;
        } else if (flowField === "eventType") {
          if (flow.fromRoleId === "__system_start__") {
            flow.eventType = "START";
            markDesignDirty("有未保存的专业配置修改");
            return true;
          }
          const previousEventType = flow.eventType;
          const previousDefaultZh = STUDIO_BUSINESS_EVENT_TYPES.find((item) => item.value === previousEventType)?.zh
            || (previousEventType === "ERROR" ? "运行时错误" : undefined);
          const previousDefaultEn = STUDIO_BUSINESS_EVENT_TYPES.find((item) => item.value === previousEventType)?.en
            || (previousEventType === "ERROR" ? "Runtime error" : undefined);
          const currentLabel = flow.label?.trim();
          const nextDefaultLabel = STUDIO_BUSINESS_EVENT_TYPES.find((item) => item.value === element.value)?.[state.locale === "en" ? "en" : "zh"]
            || STUDIO_ROUTING_ERROR_EVENT_TYPES.find((item) => item.value === element.value)?.[state.locale === "en" ? "en" : "zh"]
            || localizedEventLabel(element.value, copy);
          if (!currentLabel || currentLabel === previousEventType || currentLabel === previousDefaultZh || currentLabel === previousDefaultEn) {
            flow.label = nextDefaultLabel;
            const labelInput = inspector?.querySelector('[data-studio-flow-field="label"]');
            if (labelInput) labelInput.value = nextDefaultLabel;
          }
          try {
            const manifest = JSON.parse(selection.assets.contracts || '{"version":1,"contracts":[]}');
            const contract = manifest.contracts?.find((item) => item?.kind === "flow"
              && item.match?.fromRoleId === flow.fromRoleId
              && item.match?.eventType === flow.eventType
              && item.match?.toRoleId === studioContractTargetRoleId(flow.toRoleId));
            if (contract) {
              contract.match.eventType = element.value;
              selection.assets.contracts = JSON.stringify(manifest, null, 2);
              contractsDirty = true;
              authoring.system.handoffContracts = ".ogs/contracts/handoff.json";
            }
          } catch { /* The manifest editor remains available for correcting invalid JSON. */ }
          flow.eventType = element.value;
          syncFlowPresentation(flow);
          const headingIconContainer = inspector?.querySelector(".studio-inspector-heading");
          if (headingIconContainer) {
            const currentIcon = headingIconContainer.querySelector(".studio-flow-contract-icon");
            if (currentIcon) {
              const temp = document.createElement("div");
              temp.innerHTML = renderStudioFlowContractIcon(flow, authoring, selection?.assets?.contracts, state.locale);
              const newIcon = temp.firstElementChild;
              if (newIcon) headingIconContainer.replaceChild(newIcon, currentIcon);
            }
          }
        } else {
          flow[flowField] = element.value;
        }
      } else if (roleAsset && selection.roleId) {
        selection.assets.roles[selection.roleId] ||= {};
        selection.assets.roles[selection.roleId][roleAsset] = element.value;
        pendingRoleAssets.add(`${selection.roleId}/${roleAsset}`);
        if (roleAsset === "role.json") {
          try {
            const parsed = JSON.parse(element.value);
            if (parsed && typeof parsed === "object" && parsed.constraints && Array.isArray(parsed.constraints.allowedTools)) {
              const tools = parsed.constraints.allowedTools;
              const toolCheckboxes = inspector?.querySelectorAll("[data-studio-role-tool]") || [];
              toolCheckboxes.forEach((cb) => {
                cb.checked = tools.includes(cb.dataset.studioRoleTool);
              });
              const standardTools = new Set(["workspace.write", "workspace.run", "workspace.patch_text"]);
              const extraTools = tools.filter((toolRef) => !standardTools.has(toolRef));
              const extraInput = inspector?.querySelector("[data-studio-role-tool-extra]");
              if (extraInput && document.activeElement !== extraInput) {
                extraInput.value = extraTools.join(", ");
              }
              const summary = inspector?.querySelector("[data-studio-allowed-tools-summary]");
              if (summary) {
                summary.textContent = tools.join(", ") || (state.locale === "en" ? "None" : "无");
              }
              const conflictContainer = inspector?.querySelector("[data-studio-role-tool-conflict]");
              if (conflictContainer) {
                const selectedGlobalLaw = (selection.assets?.laws?.laws || []).find((law) => law.lawId === authoring.system?.lawGlobalRef);
                const forbiddenTools = selectedGlobalLaw?.constraints?.forbiddenToolRefs || [];
                const blockedRoleTools = tools.filter((toolRef) => forbiddenTools.includes(toolRef));
                conflictContainer.innerHTML = blockedRoleTools.length
                  ? `<p class="studio-permission-conflict" role="alert">${state.locale === "en" ? "Disabled by global law" : "与全局禁用工具冲突"}: ${esc(blockedRoleTools.join(", "))}</p>`
                  : "";
              }
            }
          } catch { /* The inspector remains readable while raw JSON is invalid. */ }
        }
      } else if (element.dataset.studioAsset === "contracts") {
        selection.assets.contracts = element.value;
        contractsDirty = true;
        authoring.system.handoffContracts = ".ogs/contracts/handoff.json";
      } else if (element.dataset.studioContractSchema) {
        selection.assets.contractSchemas ||= {};
        selection.assets.contractSchemas[element.dataset.studioContractSchema] = element.value;
        pendingContractSchemas.add(element.dataset.studioContractSchema);
      } else return false;
      markDesignDirty("有未保存的专业配置修改");
      return true;
    };
    const syncContextMapFromRows = () => {
      const role = authoring.roles[selection.roleId];
      if (!role) return false;
      const mappings = {};
      for (const row of inspector.querySelectorAll("[data-studio-context-row]")) {
        const target = row.querySelector("[data-studio-context-target]")?.value.trim() || "";
        const source = row.querySelector("[data-studio-context-source]")?.value || "";
        const path = row.querySelector("[data-studio-context-path]")?.value.trim() || "";
        const optional = row.querySelector("[data-studio-context-optional]")?.checked === true;
        if (!/^[a-zA-Z0-9_]+$/.test(target) || Object.hasOwn(mappings, target)) return false;
        if (path && !/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(path)) return false;
        const optionalAllowed = source === "direct.data" || source.startsWith("source(") && source.endsWith(".data") || source.startsWith("global.human_review.current");
        if (optional && !optionalAllowed) return false;
        mappings[target] = `${source}${path ? `.${path}` : ""}${optional ? "?" : ""}`;
      }
      role.contextMap = mappings;
      const advanced = inspector.querySelector('[data-studio-role-field="contextMap"]');
      if (advanced) advanced.value = JSON.stringify(mappings, null, 2);
      markDesignDirty("有未保存的上下文映射修改");
      return true;
    };
    renderInspector();
    inspector?.addEventListener("focusout", () => { editorHistoryFieldActive = false; });
    const recordInspectorEdit = () => {
      if (editorHistoryFieldActive) return;
      editorHistoryFieldActive = true;
      recordEditorHistory();
    };
    inspector?.addEventListener("input", (event) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
      recordInspectorEdit();
      if (element.dataset.studioContractField) return;
      if (element.dataset.studioProfileField === "profileId" || element.dataset.studioRoleField === "profileId") return;
      if (element.closest("[data-studio-context-row]")) {
        if (!syncContextMapFromRows()) setEditorState(state.locale === "en" ? "Check the mapping fields and keep target names unique." : "请检查映射字段，并确保目标字段不重复。");
        return;
      }
      if (!updateInspector(element)) {
        setEditorState(state.locale === "en" ? "Invalid JSON or Context Map; fix the field before saving." : "JSON 或上下文映射格式无效，请修正后再保存。");
      }
    });
    inspector?.addEventListener("change", (event) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
      recordInspectorEdit();
      const contractField = element.dataset.studioContractField;
      if (contractField && selection.flowId) {
        const flow = Object.values(authoring.flows || {}).find((item) => item.flowId === selection.flowId);
        if (!flow) return;
        let manifest;
        try { manifest = JSON.parse(selection.assets.contracts || '{"version":1,"contracts":[]}'); }
        catch { setEditorState(state.locale === "en" ? "The transition contract JSON is invalid. Fix it before editing." : "流转契约 JSON 无效，请修正后再编辑。"); return; }
        if (manifest.version !== 1 || !Array.isArray(manifest.contracts)) { setEditorState(state.locale === "en" ? "The transition contract must contain version: 1 and a contracts array." : "流转契约必须包含 version: 1 和 contracts 数组。"); return; }
        let contract = manifest.contracts.find((item) => item?.kind === "flow" && item.match?.fromRoleId === flow.fromRoleId && item.match?.eventType === flow.eventType && item.match?.toRoleId === studioContractTargetRoleId(flow.toRoleId));
        if (!contract) {
          const schemaName = String(flow.flowId).replace(/[^a-zA-Z0-9_.-]/g, "-");
          contract = { kind: "flow", match: { fromRoleId: flow.fromRoleId, eventType: flow.eventType, toRoleId: studioContractTargetRoleId(flow.toRoleId) }, schema: `schemas/${schemaName}.json`, onViolation: "FAIL" };
          manifest.contracts.push(contract);
        }
        if (contractField === "id") contract.id = element.value.trim() || flow.flowId;
        if (contractField === "schema") {
          contract.schema = element.value.trim();
          const schemaEditor = inspector.querySelector("[data-studio-contract-schema]");
          if (schemaEditor) {
            schemaEditor.dataset.studioContractSchema = contract.schema;
            schemaEditor.value = selection.assets.contractSchemas?.[contract.schema] || '{\n  "type": "object"\n}';
            schemaEditor.previousElementSibling?.querySelector("span")?.replaceChildren(document.createTextNode(contract.schema));
          }
        }
        if (contractField === "onViolation") contract.onViolation = element.value;
        selection.assets.contracts = JSON.stringify(manifest, null, 2);
        contractsDirty = true;
        authoring.system.handoffContracts = ".ogs/contracts/handoff.json";
        markDesignDirty("有未保存的流程契约修改");
        return;
      }
      if (element.dataset.studioContractSchema) {
        updateInspector(element);
        return;
      }
      if (!updateInspector(element)) return;
      if (element.dataset.studioRoleField === "bindingKind" || element.dataset.studioRoleField === "reviewEnabled"
        || element.dataset.studioRoleField === "joinMode" || element.dataset.studioSpecialField) renderInspector();
    });
    inspector?.addEventListener("click", (event) => {
      const orderMove = event.target.closest("[data-studio-route-order-move]");
      if (orderMove) {
        moveRouteOrderRow(orderMove.closest("[data-studio-route-order-item]"), orderMove.dataset.studioRouteOrderMove);
        return;
      }
      const deleteFlow = event.target.closest("[data-studio-flow-delete]");
      if (deleteFlow && selection.flowId) {
        const flow = Object.values(authoring.flows || {}).find((item) => item.flowId === selection.flowId);
        if (!flow) return;
        const result = deleteStudioAuthoringFlow(authoring, canvas, flow);
        let manifest;
        try { manifest = JSON.parse(selection.assets.contracts || '{"version":1,"contracts":[]}'); } catch { manifest = { version: 1, contracts: [] }; }
        const removedContracts = (manifest.contracts || []).filter((item) => item?.kind === "flow" && item.match?.fromRoleId === flow.fromRoleId && item.match?.eventType === flow.eventType && item.match?.toRoleId === studioContractTargetRoleId(flow.toRoleId));
        manifest.contracts = (manifest.contracts || []).filter((item) => !removedContracts.includes(item));
        selection.assets.contracts = JSON.stringify(manifest, null, 2);
        contractsDirty = removedContracts.length > 0;
        for (const contract of removedContracts) {
          if (contract.schema && !manifest.contracts.some((item) => item?.schema === contract.schema)) {
            delete selection.assets.contractSchemas?.[contract.schema];
            pendingContractSchemas.add(contract.schema);
          }
        }
        setStudioSelection();
        authoring = result.authoring;
        canvas = result.canvas;
        updateStudioGraph?.update({
          authoring,
          canvas,
          viewModel: undefined,
          selectedRoleId: "",
          selectedFlowKey: "",
          historyContext: captureEditorHistoryContext()
        });
        renderInspector();
        renderAssetNavigator();
        showAssetPanel("list");
        markDesignDirty(state.locale === "en" ? "Flow deleted." : "关系已删除。");
        return;
      }
      const remove = event.target.closest("[data-studio-context-remove]");
      if (remove) {
        remove.closest("[data-studio-context-row]")?.remove();
        syncContextMapFromRows();
        return;
      }
      if (event.target.closest("[data-studio-role-input-contract-add]")) {
        recordEditorHistory();
        if (!authoring.system.handoffMode) {
          setEditorState(state.locale === "en" ? "Choose a handoff mode before adding a contract." : "添加契约前，请先选择交接模式。");
          return;
        }
        const roleId = inspector.querySelector("[data-studio-role-input-contract-role]")?.value || "";
        const schemaPath = inspector.querySelector("[data-studio-role-input-contract-schema]")?.value.trim() || "";
        if (!authoring.roles?.[roleId] || !schemaPath || schemaPath.startsWith("/") || schemaPath.split("/").some((part) => !part || part === "." || part === ".." || !/^[a-zA-Z0-9_.-]+$/.test(part)) || !schemaPath.endsWith(".json")) {
          setEditorState(state.locale === "en" ? "Choose a role and a safe relative JSON Schema path." : "请选择角色，并填写安全的相对 JSON Schema 路径。");
          return;
        }
        let manifest;
        try { manifest = JSON.parse(selection.assets.contracts || '{"version":1,"contracts":[]}'); }
        catch { setEditorState(state.locale === "en" ? "Repair the contract manifest JSON before adding an entry." : "请先修正契约清单 JSON，再添加条目。"); return; }
        if (manifest.version !== 1 || !Array.isArray(manifest.contracts)) {
          setEditorState(state.locale === "en" ? "The contract manifest must contain version 1 and a contracts array." : "契约清单必须包含 version: 1 和 contracts 数组。");
          return;
        }
        let contract = manifest.contracts.find((item) => item?.kind === "role_input" && item.match?.roleId === roleId);
        if (!contract) { contract = { id: `role-input-${roleId}`, kind: "role_input", match: { roleId }, onViolation: "FAIL" }; manifest.contracts.push(contract); }
        contract.match ||= { roleId };
        contract.schema = schemaPath;
        contract.onViolation ||= "FAIL";
        selection.assets.contracts = JSON.stringify(manifest, null, 2);
        selection.assets.contractSchemas ||= {};
        selection.assets.contractSchemas[schemaPath] ||= '{\n  "type": "object",\n  "properties": {}\n}';
        pendingContractSchemas.add(schemaPath);
        contractsDirty = true;
        authoring.system.handoffContracts = ".ogs/contracts/handoff.json";
        markDesignDirty(state.locale === "en" ? "Role input contract has unsaved changes." : "角色输入契约有未保存的修改。");
        renderInspector();
        const schemaEditor = inspector.querySelector(`[data-studio-contract-schema="${CSS.escape(schemaPath)}"]`);
        schemaEditor?.closest("details")?.setAttribute("open", "");
        schemaEditor?.focus();
        return;
      }
      if (event.target.closest("[data-studio-context-add]")) {
        recordEditorHistory();
        const role = authoring.roles[selection.roleId];
        if (!role) return;
        role.contextMap ||= {};
        let key = "new_field";
        let suffix = 2;
        while (Object.hasOwn(role.contextMap, key)) key = `new_field_${suffix++}`;
        role.contextMap[key] = "global.task";
        markDesignDirty("有未保存的上下文映射修改");
        renderInspector();
        inspector.querySelector(`[data-studio-context-target][value="${CSS.escape(key)}"]`)?.focus();
      }
    });
    renderAssetNavigator();
    const showUnsavedDebugNotice = () => {
      const message = state.locale === "en"
        ? "Save the unsaved graph changes from the graph toolbar before starting a debug run."
        : "请先点击图谱工具栏中的“保存”保存未提交的图谱修改，再开始调试。";
      const result = $("#team-simulation-result");
      if (result) result.innerHTML = `<p class="run-error" role="alert">${esc(message)}</p>`;
      setEditorState(message);
    };
    syncRuntimeDualCore = ({ active = true, preference = "balanced", maximize = "", microOpen = runtimeMicroOpen } = {}) => {
      const runtimeWorkbench = stage.closest(".studio-design-workbench");
      const runtimeGraphPanel = stage.closest(".project-graph-preview");
      const runtimeDebugPanel = runtimeWorkbench?.querySelector("#team-debug-dialog");
      if (!runtimeWorkbench || !runtimeGraphPanel || !runtimeDebugPanel) return;
      const runtimeControls = runtimeWorkbench?.querySelectorAll("[data-runtime-dual-controls]") || [];
      if (!active) {
        if (runtimeWorkbenchClassSnapshot) runtimeWorkbench.className = runtimeWorkbenchClassSnapshot;
        else runtimeWorkbench.classList.remove("studio-run-dual-core", "is-runtime-dual-core");
        if (runtimeGraphPanelClassSnapshot) runtimeGraphPanel.className = runtimeGraphPanelClassSnapshot;
        if (runtimeDebugPanelClassSnapshot) runtimeDebugPanel.className = runtimeDebugPanelClassSnapshot;
        delete runtimeWorkbench.dataset.layoutPreference;
        delete runtimeWorkbench.dataset.maximizeMode;
        runtimeWorkbench.style.removeProperty("--studio-runtime-split");
        if (runtimePanelStyleSnapshot) {
          for (const [element, style] of [[runtimeWorkbench, runtimePanelStyleSnapshot.workbench], [runtimeDebugPanel, runtimePanelStyleSnapshot.debug]]) {
            if (style == null) element.removeAttribute("style");
            else element.setAttribute("style", style);
          }
        }
        runtimePanelStyleSnapshot = null;
        runtimeWorkbenchClassSnapshot = null;
        runtimeGraphPanelClassSnapshot = null;
        runtimeDebugPanelClassSnapshot = null;
        runtimeMicroOpen = true;
        runtimeControls.forEach((controls) => { controls.hidden = true; });
        runtimeDebugPanel.querySelectorAll("[data-runtime-panel-maximize]").forEach((button) => button.classList.remove("is-maximized"));
        updateStudioGraph?.fitViewport?.();
        return;
      }
      if (!runtimePanelStyleSnapshot) {
        runtimePanelStyleSnapshot = { workbench: runtimeWorkbench.getAttribute("style"), debug: runtimeDebugPanel.getAttribute("style") };
        runtimeWorkbenchClassSnapshot = runtimeWorkbench.className;
        runtimeGraphPanelClassSnapshot = runtimeGraphPanel.className;
        runtimeDebugPanelClassSnapshot = runtimeDebugPanel.className;
      }
      runtimeMicroOpen = microOpen !== false;
      runtimeWorkbench.classList.add("studio-run-dual-core", "is-runtime-dual-core");
      const assetDrawer = runtimeWorkbench.querySelector("#studio-asset-drawer");
      if (assetDrawer?.classList.contains("is-right-docked")) {
        runtimeWorkbench.studioUndockPanel?.(assetDrawer, "asset");
      }
      runtimeWorkbench.dataset.layoutPreference = preference;
      if (!runtimeWorkbench.style.getPropertyValue("--studio-runtime-split")) {
        runtimeWorkbench.style.setProperty("--studio-runtime-split", "50%");
      }
      if (maximize) runtimeWorkbench.dataset.maximizeMode = maximize;
      else delete runtimeWorkbench.dataset.maximizeMode;
      runtimeGraphPanel.classList.add("studio-run-macro-panel");
      runtimeDebugPanel.classList.add("studio-run-micro-panel");
      runtimeDebugPanel.classList.toggle("is-runtime-micro-closed", !runtimeMicroOpen);
      runtimeDebugPanel.classList.remove("is-right-docked", "is-maximized");
      for (const prop of ["left", "top", "right", "bottom", "width", "height", "inset", "transform"]) runtimeDebugPanel.style.removeProperty(prop);
      runtimeDebugPanel.setAttribute("aria-hidden", String(!runtimeMicroOpen));
      runtimeDebugPanel.classList.toggle("is-open", runtimeMicroOpen);
      runtimeControls.forEach((controls) => { controls.hidden = false; });
      runtimeWorkbench.querySelectorAll("[data-runtime-panel-maximize]").forEach((button) => {
        const isActive = button.dataset.runtimePanelMaximize === maximize;
        button.classList.toggle("is-maximized", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
      window.setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
        updateStudioGraph?.fitViewport?.();
      }, 60);
    };
    const ensureRuntimeDualCoreControls = () => {
      const runtimeWorkbench = stage.closest(".studio-design-workbench");
      const runtimeGraphPanel = stage.closest(".project-graph-preview");
      const runtimeDebugPanel = runtimeWorkbench?.querySelector("#team-debug-dialog");
      if (!runtimeGraphPanel || !runtimeDebugPanel) return;
      const graphHead = runtimeGraphPanel.querySelector(":scope > .panel-head");
      if (graphHead && !graphHead.querySelector("[data-runtime-dual-controls]")) {
        graphHead.insertAdjacentHTML("beforeend", `<div class="studio-runtime-dual-controls" data-runtime-dual-controls hidden><button type="button" class="studio-panel-maximize-btn" data-runtime-panel-maximize="macro" aria-pressed="false" title="${state.locale === "en" ? "Maximize Macro Graph" : "最大化宏观图谱"}" aria-label="${state.locale === "en" ? "Maximize Macro Graph" : "最大化宏观图谱"}">⛶</button></div>`);
        graphHead.querySelector("[data-runtime-panel-maximize]")?.addEventListener("click", () => {
          const current = runtimeWorkbench?.dataset.maximizeMode;
          syncRuntimeDualCore({ preference: runtimeWorkbench?.dataset.layoutPreference || "balanced", maximize: current === "macro" ? "" : "macro" });
        });
      }
      if (!runtimeWorkbench?.querySelector("[data-runtime-split-handle]")) {
        runtimeWorkbench?.insertAdjacentHTML("beforeend", `<button type="button" class="studio-runtime-split-handle" data-runtime-split-handle aria-label="${state.locale === "en" ? "Resize graph and chat panels" : "调整图谱和群聊面板宽度"}" title="${state.locale === "en" ? "Resize graph and chat panels" : "调整图谱和群聊面板宽度"}"><span aria-hidden="true"></span></button>`);
        const splitHandle = runtimeWorkbench?.querySelector("[data-runtime-split-handle]");
        let splitDrag = null;
        let runtimeSplitRaf = null;
        splitHandle?.addEventListener("pointerdown", (event) => {
          if (window.matchMedia?.("(max-width: 768px)").matches) return;
          runtimeWorkbench.classList.add("is-split-dragging");
          const bounds = runtimeWorkbench.getBoundingClientRect();
          splitDrag = { pointerId: event.pointerId, left: bounds.left, width: bounds.width };
          splitHandle.setPointerCapture(event.pointerId);
          event.preventDefault();
        });
        splitHandle?.addEventListener("pointermove", (event) => {
          if (!splitDrag || event.pointerId !== splitDrag.pointerId) return;
          const ratio = Math.min(0.7, Math.max(0.3, (event.clientX - splitDrag.left) / splitDrag.width));
          runtimeWorkbench.style.setProperty("--studio-runtime-split", `${Math.round(ratio * 100)}%`);
          if (!runtimeSplitRaf) {
            runtimeSplitRaf = window.requestAnimationFrame(() => {
              runtimeSplitRaf = null;
              updateStudioGraph?.fitViewport?.();
            });
          }
        });
        const finishSplitDrag = (event) => {
          if (splitDrag?.pointerId === event.pointerId) {
            splitDrag = null;
            runtimeWorkbench.classList.remove("is-split-dragging");
            if (runtimeSplitRaf) {
              window.cancelAnimationFrame(runtimeSplitRaf);
              runtimeSplitRaf = null;
            }
            updateStudioGraph?.fitViewport?.();
          }
        };
        splitHandle?.addEventListener("pointerup", finishSplitDrag);
        splitHandle?.addEventListener("pointercancel", finishSplitDrag);
        splitHandle?.addEventListener("keydown", (event) => {
          const delta = event.shiftKey ? 0.08 : 0.04;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const current = Number.parseFloat(getComputedStyle(runtimeWorkbench).getPropertyValue("--studio-runtime-split")) || 50;
          const next = Math.min(70, Math.max(30, current + (event.key === "ArrowRight" ? delta * 100 : -delta * 100)));
          runtimeWorkbench.style.setProperty("--studio-runtime-split", `${next}%`);
          updateStudioGraph?.fitViewport?.();
        });
      }
      const debugActions = runtimeDebugPanel.querySelector(":scope > .team-debug-panel-head .team-debug-panel-actions");
      if (debugActions && !debugActions.querySelector("[data-runtime-dual-controls]")) {
        debugActions.insertAdjacentHTML("afterbegin", `<div class="studio-runtime-dual-controls" data-runtime-dual-controls hidden><button type="button" class="studio-panel-maximize-btn" data-runtime-panel-maximize="micro" aria-pressed="false" title="${state.locale === "en" ? "Maximize Micro Chat" : "最大化微观群聊"}" aria-label="${state.locale === "en" ? "Maximize Micro Chat" : "最大化微观群聊"}">⛶</button></div>`);
        debugActions.querySelector("[data-runtime-panel-maximize]")?.addEventListener("click", () => {
          const current = runtimeWorkbench?.dataset.maximizeMode;
          syncRuntimeDualCore({ preference: runtimeWorkbench?.dataset.layoutPreference || "balanced", maximize: current === "micro" ? "" : "micro" });
        });
      }
    };
    ensureRuntimeDualCoreControls();
    state.showTeamGraphUnsavedDebugNotice = showUnsavedDebugNotice;
    const simulateTeam = async (input, mode = "dry-run") => {
      const prompt = String(input || "").trim();
      if (!prompt) {
        setEditorState(state.locale === "en" ? "Enter a task to debug." : "请输入本次调试任务。");
        return false;
      }
      if (dirty) {
        showUnsavedDebugNotice();
        state.teamStudioDialog?.("run");
        return false;
      }
      const runGeneration = (state._studioRunGeneration || 0) + 1;
      state._studioRunGeneration = runGeneration;
      setEditorState(state.locale === "en" ? "Checking role model readiness…" : "正在检查角色模型配置…");
      const ready = await confirmTeamRuntimeReadiness(projectId, authoring, pageRequest);
      if (state._studioRunGeneration !== runGeneration) return false;
      if (!ready) {
        if (isCurrentRequest(pageRequest)) setEditorState(state.locale === "en" ? "Debug run cancelled; configure the listed roles and try again." : "调试已取消；请配置提示中的角色后重试。");
        return false;
      }
      const abortController = new AbortController();
      state._activeSimulationAbort = abortController;
      let simulationFinished = false;
      let activeSimulationId = "";
      const runtimeLockToken = `${runGeneration}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      state._studioRuntimeLockToken = runtimeLockToken;
      const ownsRuntimePanel = () => state._studioRunGeneration === runGeneration
        && (!activeSimulationId || state.studioActiveRun?.simulationId === activeSimulationId);
      const releaseRuntimeUi = () => {
        if (state._studioRuntimeLockToken !== runtimeLockToken) return false;
        if (stage.isConnected) updateStudioGraph?.update({ runtimeLock: false, readOnly: false });
        if (hud) hud.hidden = true;
        syncDebugRunButton(simulationFinished ? "terminal" : "idle");
        if (simulationFinished) clearStudioActiveRun(activeSimulationId);
        if (state.studioActiveRun?.simulationId === activeSimulationId) state.studioActiveRun = null;
        delete state._studioRuntimeLockToken;
        return true;
      };
      const result = $("#team-simulation-result");
      setDebugView("run");
      syncDebugRunButton("running");
      ensureRuntimeDualCoreControls();
      syncRuntimeDualCore({ active: true, preference: "balanced" });
      updateStudioGraph?.setRuntimeProgress([]);
      updateStudioGraph?.update({ runtimeLock: true, readOnly: false });
      if (result) result.innerHTML = `<p class="form-status" role="status">${state.locale === "en" ? "Studio debug run in progress…" : "Studio 调试运行中…"}</p>`;
      setEditorState(state.locale === "en" ? "Studio debug run in progress…" : "Studio 调试运行中…");
      let hud = stage?.querySelector(".studio-runtime-hud");
      if (!hud && stage) {
        hud = document.createElement("div");
        hud.className = "studio-runtime-hud";
        hud.innerHTML = `<span class="studio-runtime-hud-pulse" aria-hidden="true"></span><span class="studio-runtime-hud-metrics"><span class="studio-hud-timer">00:00</span><span class="studio-hud-status">${state.locale === "en" ? "Running" : "运行中"}</span></span><button type="button" class="studio-runtime-hud-btn" data-studio-hud-focus><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg><span>${state.locale === "en" ? "Focus active" : "聚焦活跃节点"}</span></button>`;
        stage.append(hud);
      }
      if (hud) hud.hidden = false;
      const startTime = Date.now();
      let lastActiveRoleId = "";
      const hudTimer = setInterval(() => {
        if (!hud || hud.hidden) return;
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
        const secs = String(elapsedSec % 60).padStart(2, "0");
        const timerEl = hud.querySelector(".studio-hud-timer");
        if (timerEl) timerEl.textContent = `${mins}:${secs}`;
      }, 1000);
      const focusBtn = hud?.querySelector("[data-studio-hud-focus]");
      const onFocusClick = () => {
        if (lastActiveRoleId) updateStudioGraph?.focusRoleNode?.(lastActiveRoleId);
      };
      focusBtn?.addEventListener("click", onFocusClick);
      try {
        const teamResponse = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}`);
        const team = await teamResponse.json();
        if (!teamResponse.ok) throw new Error(team.error || "无法读取团队版本身份");
        const teamId = team.teamId || team.teamRootId || team.projectId;
        const teamVersionId = team.teamVersionId || team.projectId;
        const response = await pageFetch(`/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, locale: state.locale, mode })
        });
        const payload = await response.json();
        if (!isCurrentRequest(pageRequest)) return false;
        if (!response.ok) throw new Error(payload.error || (state.locale === "en" ? "Team debug run failed." : "团队调试失败。"));
        let simulation = payload.simulation || {};
        activeSimulationId = simulation.simulationId || "";
        state.studioActiveRun = { teamId, teamVersionId, simulationId: simulation.simulationId };
        writeStudioActiveRun(state.studioActiveRun);
        let simulationState = payload.state || {};
        let cursor = 0;
        const transcript = [];
        const roleCards = new Map();
        const pendingHandoffs = new Map();
        const roleDefinitions = Object.values(authoring.roles || authoring.seats || {});
        const roleName = (roleId) => roleDefinitions.find((role) => role.roleId === roleId || role.id === roleId)?.name
          || roleDefinitions.find((role) => role.roleId === roleId || role.id === roleId)?.title
          || (roleId === "__system_start__" ? (state.locale === "en" ? "Start" : "开始")
            : roleId === "__system_end__" ? (state.locale === "en" ? "End" : "结束") : roleId);
        const eventActivationKey = (item) => item.executionId || `${item.roleId || ""}:${item.branchId || ""}:${item.loopIteration || 1}`;
        const eventLabel = (item) => {
          const english = state.locale === "en";
          const role = roleName(item.roleId || "");
          const labels = {
            "role_waiting": english ? `${role} is working` : `${role} 正在工作中`,
            "role_retry_scheduled": english ? `${role} will retry (attempt ${item.attempt || "?"}/${item.maxAttempts || "?"})` : `${role} 将重试（第 ${item.attempt || "?"}/${item.maxAttempts || "?"} 次）`,
            "join_activated": english ? `Join activated for ${role}` : `${role} 汇聚已启动`,
            "join_quorum_reached": english ? `Join condition met for ${role}` : `${role} 已满足汇聚条件`,
            "join_late_arrival_ignored": english ? `Late result ignored at ${role}` : `${role} 忽略了迟到结果`,
            "human_review_requested": english ? `Review requested for ${role}` : `${role} 已提交人工审核`,
            "human_review_approved": english ? `Review approved for ${role}` : `${role} 审核已通过`,
            "human_review_rework_requested": english ? `Rework requested for ${role}` : `${role} 收到返工要求`,
            "human_review_rejected": english ? `Review rejected and routed for ${role}` : `${role} 审核拒绝并已路由`,
            "human_review_decision_rejected": english ? `Review decision rejected for ${role}` : `${role} 审核决定被拒绝`,
            "human_review_paused": english ? `Run paused for review` : "运行已暂停，等待审核",
            "human_review_terminated": english ? `Run terminated during review` : "审核终止了运行",
            "human_review_expired": english ? `Review timed out` : "审核已超时",
            "run_waiting": english ? `Run is waiting: ${item.reason || "external decision"}` : `运行正在等待：${item.reason || "外部决策"}`,
            "run_stopping": english ? "Run is stopping after the active transition" : "当前流转结束后将停止运行",
            "run_stopped": english ? "Run stopped" : "运行已停止",
            "run_terminated": english ? "Run terminated" : "运行已终止"
          };
          return labels[item.type] || String(item.type || "event").replaceAll("_", " ");
        };
        const drawTranscript = (events = []) => {
          if (!result || !ownsRuntimePanel()) return;
          let panel = result.querySelector(".team-simulation-result");
          if (!panel) {
            result.innerHTML = `<div class="team-simulation-result"><div class="panel-head"><strong>${state.locale === "en" ? "Debug trace" : "调试过程"}</strong><span class="status-chip running">${esc(studioSimulationStatus("running"))}</span></div><div class="team-debug-transcript-wrap"><ol class="team-debug-transcript" aria-live="polite"></ol><button type="button" class="team-debug-new-messages" hidden>${state.locale === "en" ? "↓ New messages" : "↓ 有新消息"}</button></div><p class="form-hint">${state.locale === "en" ? "The debug panel stays visible while this run is active. Use Stop to end it." : "调试运行期间面板保持显示；点击“停止”可结束任务。"}</p>${studioRuntimeAuditDrawerMarkup(state.locale)}</div>`;
            panel = result.querySelector(".team-simulation-result");
          }
          bindStudioRuntimeAuditDrawer(result, updateStudioGraph, roleName);
          const list = panel.querySelector(".team-debug-transcript");
          const chip = panel.querySelector(".status-chip");
          const newMessages = panel.querySelector(".team-debug-new-messages");
          if (!list.dataset.smartScrollBound) {
            const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight <= 56;
            list.dataset.smartScrollBound = "true";
            list.addEventListener("scroll", () => {
              const readingBacklog = !nearBottom();
              list.dataset.userReading = readingBacklog ? "true" : "false";
              if (newMessages) newMessages.hidden = !readingBacklog;
            }, { passive: true });
            list.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
            newMessages?.addEventListener("click", () => {
              list.dataset.userReading = "false";
              list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
              newMessages.hidden = true;
            });
          }
          const wasAtBottom = list.dataset.userReading !== "true" && list.scrollHeight - list.scrollTop - list.clientHeight <= 56;
          appendStudioUserPrompt(list, prompt);
          const addSection = (card, label, value, className = "") => {
            if (!value) return;
            const bubbleBody = card.querySelector(".team-debug-bubble-body") || card.querySelector(".team-debug-bubble") || card;
            let section = bubbleBody.querySelector(`[data-debug-section="${className || label}"]`);
            if (className === "output") {
              const template = document.createElement("template");
              template.innerHTML = studioTranscriptSectionMarkup(label, value);
              const nextSection = template.content.firstElementChild;
              if (!nextSection) return;
              nextSection.dataset.debugSection = className || label;
              if (section) section.replaceWith(nextSection);
              else bubbleBody.append(nextSection);
              bindStudioMessageMore(nextSection);
              return;
            }
            if (!section) {
              section = document.createElement("section");
              section.dataset.debugSection = className || label;
              section.innerHTML = `<details><summary>${esc(label)}</summary><pre></pre></details>`;
              bubbleBody.append(section);
            }
            section.querySelector("pre").textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
          };
          const appendRuntimeFailure = (failure, details = {}) => {
            const message = studioSimulationErrorText(failure || details.message || (state.locale === "en" ? "The debug run failed." : "调试运行失败。"));
            const failureItem = document.createElement("li");
            failureItem.className = "team-debug-event team-debug-event-failure run-error";
            failureItem.dataset.eventType = "simulation.failed";
            const time = document.createElement("time");
            time.textContent = studioSimulationEventTime({ at: new Date().toISOString() });
            const label = document.createElement("strong");
            label.textContent = state.locale === "en" ? "Debug run failed" : "调试运行失败";
            const body = document.createElement("span");
            body.textContent = message;
            failureItem.append(time, label, body);
            if (details.errorCode || details.backend || details.modelId) {
              const diagnostic = document.createElement("small");
              diagnostic.textContent = [details.errorCode, details.backend, details.modelId].filter(Boolean).join(" · ");
              failureItem.append(diagnostic);
            }
            list.append(failureItem);
            const raw = { message: failure || details.message || message, ...details };
            const detailsBlock = document.createElement("details");
            detailsBlock.className = "team-debug-runtime-failure-details";
            detailsBlock.open = true;
            detailsBlock.innerHTML = `<summary>${state.locale === "en" ? "Failure details" : "失败诊断详情"}</summary><pre></pre>`;
            detailsBlock.querySelector("pre").textContent = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
            failureItem.append(detailsBlock);
            list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
          };
          for (const item of events) {
            const flowEvent = item.type === "flow.activated";
            if (flowEvent) {
              appendStudioRuntimeHandoff(roleCards, item, roleName, pendingHandoffs);
              continue;
            }
            if (item.fromRoleId === "__system_start__" || item.toRoleId === "__system_end__" || item.eventType === "START") continue;
            if (item.roleId && (item.type === "role_waiting" || item.type === "role.started")) {
              lastActiveRoleId = item.roleId;
              const hudStatus = hud?.querySelector(".studio-hud-status");
              if (hudStatus) hudStatus.textContent = `${state.locale === "en" ? "Active" : "执行中"}: ${roleName(item.roleId)}`;
            }
            const eventType = String(item.type || "");
            if (eventType === "role_retry_scheduled" || eventType.startsWith("join_") || eventType.startsWith("human_review_") || eventType.startsWith("run_")) {
              const notice = document.createElement("li");
              notice.className = `team-debug-event team-debug-event-${eventType.replaceAll(".", "-")}`;
              notice.dataset.eventType = eventType;
              const time = document.createElement("time");
              time.textContent = studioSimulationEventTime(item);
              const message = document.createElement("span");
              message.textContent = eventLabel(item);
              notice.append(time, message);
              if (item.reason || item.errorCode || item.backoffMs) {
                const detail = document.createElement("small");
                detail.textContent = [item.reason, item.errorCode, item.backoffMs ? `${item.backoffMs} ms` : ""].filter(Boolean).join(" · ");
                notice.append(detail);
              }
              list.append(notice);
              continue;
            }
            if (item.type === "simulation.started") continue;
            if (item.type === "simulation.completed" || item.type === "simulation.failed" || item.type === "simulation.stopped") {
              if (chip) {
                const finalStatus = item.type === "simulation.completed" ? "completed" : item.type === "simulation.stopped" ? "stopped" : "failed";
                chip.className = `status-chip ${finalStatus}`;
                chip.textContent = studioSimulationStatus(finalStatus);
              }
              if (item.type === "simulation.failed") {
                appendRuntimeFailure(item.error || item.failure || item.errorEnvelope?.message, item.errorEnvelope || item);
              }
              continue;
            }
            if (!String(item.type || "").startsWith("role.") && item.type !== "role_waiting") continue;
            const key = eventActivationKey(item);
            let card = roleCards.get(key);
            if (!card) {
              const roleDef = roleDefinitions.find((r) => r.roleId === item.roleId || r.id === item.roleId) || {};
              const backend = item.backend || roleDef.backend || "";
              const template = document.createElement("template");
              template.innerHTML = studioRuntimeRoleCardMarkup({ event: item, roleName: roleName(item.roleId || "system"), backend, authoring, auditIndex: Math.max(0, transcript.indexOf(item)) });
              card = template.content.firstElementChild;
              if (!card) continue;
              card.dataset.executionKey = key;
              list.append(card);
              roleCards.set(key, card);
              for (const handoff of pendingHandoffs.get(item.roleId) || []) appendStudioRuntimeHandoff(roleCards, handoff, roleName, pendingHandoffs);
              pendingHandoffs.delete(item.roleId);
            }
            card._studioAuditItem = { ...(card._studioAuditItem || {}), ...item };
            const status = item.type === "role_waiting" ? "working"
              : item.type === "role.started" ? "working"
              : item.type === "role.input_ready" ? "accepted"
              : item.type === "role.failed" ? "failed" : item.type === "role.skipped" ? "skipped" : "completed";
            card.dataset.status = status;
            const attempt = item.attempt ? ` · ${state.locale === "en" ? "attempt" : "尝试"} ${item.attempt}/${item.maxAttempts || "?"}` : "";
            const duration = item.durationMs !== undefined ? ` · ${Number(item.durationMs).toLocaleString(state.locale)} ms` : "";
            const statusSpan = card.querySelector(".team-debug-time-status") || card.querySelector("header span");
            if (statusSpan) statusSpan.textContent = `${studioSimulationEventTime(item)} · ${studioSimulationStatus(status)}${attempt}${duration}`;
            if (item.type === "role.input_ready" || item.inputContext) {
              addSection(card, state.locale === "en" ? "Input" : "收到的任务", item.inputContext, "input");
            }
            if (item.type === "role_waiting") {
              const waitStage = item.stage === "model_provider"
                ? (state.locale === "en" ? "Model service" : "模型服务")
                : item.stage === "cli_tool"
                  ? (state.locale === "en" ? "Execution tool" : "执行工具")
                  : item.stage;
              const waitText = Number.isFinite(item.elapsedMs)
                ? (state.locale === "en" ? `Working · ${item.elapsedMs} ms` : `工作中 · ${item.elapsedMs} 毫秒`)
                : (state.locale === "en" ? "Working" : "工作中");
              addSection(card, state.locale === "en" ? "Working" : "工作中", waitText, "waiting");
            }
            if (item.stdoutPreview || item.failure) {
              addSection(card, item.failure ? (state.locale === "en" ? "Failure" : "异常诊断") : (state.locale === "en" ? "Output" : "执行输出"), item.failure || item.stdoutPreview, "output");
            }
            const diagnostics = {
              ...(item.backend ? { backend: item.backend } : {}),
              ...(item.modelId ? { modelId: item.modelId } : {}),
              ...(item.profileId ? { profileId: item.profileId } : {}),
              ...(item.toolRef ? { toolRef: item.toolRef } : {}),
              ...(item.promptCalls ? { promptCalls: item.promptCalls } : {}),
              ...(item.estimatedInputTokens !== undefined ? { estimatedInputTokens: item.estimatedInputTokens } : {}),
              ...(item.estimatedOutputTokens !== undefined ? { estimatedOutputTokens: item.estimatedOutputTokens } : {}),
              ...(item.externalDataIsolated !== undefined ? { externalDataIsolated: item.externalDataIsolated } : {})
            };
            if (Object.keys(diagnostics).length) addSection(card, state.locale === "en" ? "Model and execution diagnostics" : "模型与执行诊断", diagnostics, "diagnostics");
            if (item.errorEnvelope) {
              addSection(card, state.locale === "en" ? "Failure details" : "失败诊断详情", item.errorEnvelope, "diagnostic");
            }
          }
          if (wasAtBottom) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
          else if (newMessages && events.length) newMessages.hidden = false;
          if (ownsRuntimePanel()) updateStudioGraph?.setRuntimeProgress(transcript);
        };
        const endpoint = `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations`;
        while (true) {
          if (abortController.signal.aborted) break;
          const eventsResponse = await pageFetch(`${endpoint}/${encodeURIComponent(simulation.simulationId)}/events?afterCursor=${cursor}`, { signal: abortController.signal });
          const eventPayload = await eventsResponse.json();
          if (!eventsResponse.ok) throw new Error(eventPayload.error || "读取运行事件失败");
          const incomingEvents = runtimeEventsFromPayload(eventPayload);
          transcript.push(...incomingEvents);
          cursor = Number(eventPayload.cursor || cursor);
          drawTranscript(incomingEvents);
          if (eventPayload.done) break;
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
        const detailResponse = await pageFetch(`${endpoint}/${encodeURIComponent(simulation.simulationId)}`);
        const detailPayload = await detailResponse.json();
        if (!detailResponse.ok) throw new Error(detailPayload.error || "读取运行状态失败");
        simulation = detailPayload.simulation || simulation;
        simulationState = detailPayload.state || simulationState;
        simulationFinished = simulation.status !== "running";
        if (ownsRuntimePanel()) syncDebugRunButton(simulation.status === "stopping" ? "stopping" : "idle");
        const auditTrail = simulationState.auditTrail || [];
        mergeStudioAuditTrail(roleCards, auditTrail);
        const noopRoles = auditTrail.filter((item) => String(item.status || "").toLowerCase() === "noop");
        const stopped = ["stopped", "stopping"].includes(String(simulation.status || "").toLowerCase()) || ["stopped", "stopping"].includes(String(simulationState.status || "").toLowerCase());
        const failed = !stopped && (simulation.status === "failed" || ["failed", "error"].includes(String(simulationState.status || "").toLowerCase()) || auditTrail.some((item) => String(item.status || "").toLowerCase() === "failed"));
        const output = simulationState.finalOutputsByRoleId
          ? Object.entries(simulationState.finalOutputsByRoleId).flatMap(([roleId, outputs]) => (outputs || []).map((item) => `${roleName(roleId)}: ${item.content || JSON.stringify(item.data || {})}`)).join("\n\n")
          : "";
        const hasOutput = typeof output === "string" && Boolean(output.trim());
        const succeeded = !stopped && !failed && hasOutput;
        const roleRows = auditTrail.map((item) => {
          const status = String(item.status || "").toLowerCase();
          const label = status === "noop"
            ? (state.locale === "en" ? "Not run: no model or execution profile" : "未执行：未配置模型或执行配置")
            : (item.status || (state.locale === "en" ? "Executed" : "已执行"));
          return `<li><strong>${esc(item.roleId || (state.locale === "en" ? "Role" : "角色"))}</strong><span>${esc(label)}${item.failure ? ` · ${esc(item.failure)}` : ""}</span></li>`;
        }).join("");
        const statusLabel = stopped
          ? (state.locale === "en" ? (simulation.status === "stopping" ? "Stopping" : "Stopped") : (simulation.status === "stopping" ? "正在停止" : "已停止"))
          : failed
          ? (state.locale === "en" ? "Debug run failed" : "调试失败")
          : !hasOutput
            ? (state.locale === "en" ? "No result produced" : "未产出结果")
            : noopRoles.length
              ? (state.locale === "en" ? "Partial result" : "部分完成")
              : (state.locale === "en" ? "Debug run complete" : "调试完成");
        const historyHref = `/studio/teams/${encodeURIComponent(teamVersionId)}/run`;
        const detailHref = `/studio/teams/${encodeURIComponent(teamVersionId)}/run/${encodeURIComponent(simulation.simulationId || "")}`;
        const artifactsHref = studioArtifactsBrowserUrl(teamVersionId, simulation.simulationId || "", simulation.teamId);
        const persistenceLabel = state.locale === "en" ? "Saved as isolated Studio evidence · not a Project Run" : "已保存为独立 Studio 证据 · 不属于项目 Run";
        const emptyMessage = noopRoles.length
          ? (state.locale === "en" ? "No result was produced because one or more roles have no execution binding. Configure a model or execution profile for the listed roles, then retry." : "角色尚未配置执行绑定，因此没有生成结果。请为上方角色配置模型或执行配置后重试。")
          : (state.locale === "en" ? "The debug run returned no final result." : "调试未返回最终结果。");
        const terminalFailure = [...transcript].reverse().find((item) => item.type === "simulation.failed");
        const displayedFailure = studioSimulationErrorText(simulationState.error || simulation.failureSummary || terminalFailure?.error || emptyMessage);
        if (result && ownsRuntimePanel()) {
          drawTranscript();
        result.insertAdjacentHTML("beforeend", `<div class="team-simulation-result"><div class="panel-head"><strong>${state.locale === "en" ? "Final result" : "最终结果"}</strong><span class="status-chip${succeeded && !noopRoles.length ? "" : " warning"}">${statusLabel}</span></div><p class="form-hint">${persistenceLabel}</p>${roleRows ? `<ul class="team-simulation-roles">${roleRows}</ul>` : ""}<pre>${esc(hasOutput ? output : displayedFailure)}</pre><div class="form-actions"><a class="secondary-button" href="${detailHref}" data-route="${detailHref}">${state.locale === "en" ? "Open run details" : "查看运行详情"}</a><a class="secondary-button" href="${artifactsHref}" target="_blank" rel="noreferrer">${state.locale === "en" ? "View run evidence" : "查看运行证据"}</a><a class="text-button" href="${historyHref}" data-route="${historyHref}">${state.locale === "en" ? "Debug history" : "调试历史"}</a></div></div>`);
        }
        if (ownsRuntimePanel()) setEditorState(stopped
          ? (state.locale === "en" ? (simulation.status === "stopping" ? "Stop requested; the debug run is finishing its current operation." : "Debug run stopped before completion.") : (simulation.status === "stopping" ? "已请求停止；当前操作完成后将结束调试。" : "调试运行已停止，未完成全部流程。"))
          : failed
          ? (state.locale === "en" ? "Debug run failed; review the role details and retry." : "调试失败；请检查角色执行信息后重试。")
          : !hasOutput
            ? emptyMessage
            : noopRoles.length
              ? (state.locale === "en" ? "A partial result was produced; some roles were not run." : "已生成部分结果；仍有角色未执行。")
              : (state.locale === "en" ? "Debug run completed and saved as Studio evidence." : "调试完成，已保存为 Studio 证据。"));
        return succeeded;
      } catch (error) {
        if (isAbort(error)) return false;
        const message = studioSimulationErrorText(error.message);
        if (ownsRuntimePanel()) {
          if (result) {
            const panel = result.querySelector(".team-simulation-result");
            if (panel) {
              const statusChip = panel.querySelector(".panel-head .status-chip");
              if (statusChip) {
                statusChip.className = "status-chip failed";
                statusChip.textContent = studioSimulationStatus("failed");
              }
              const failure = document.createElement("p");
              failure.className = "run-error runtime-failure-summary";
              failure.setAttribute("role", "alert");
              failure.textContent = message;
              panel.append(failure);
              const raw = document.createElement("details");
              raw.open = true;
              raw.innerHTML = `<summary>${state.locale === "en" ? "Failure details" : "失败诊断详情"}</summary><pre></pre>`;
              raw.querySelector("pre").textContent = error?.stack || error?.message || String(error);
              panel.append(raw);
            } else {
              result.innerHTML = `<div class="team-simulation-result"><p class="run-error" role="alert">${esc(message)}</p><details open><summary>${state.locale === "en" ? "Failure details" : "失败诊断详情"}</summary><pre>${esc(error?.stack || error?.message || String(error))}</pre></details></div>`;
            }
          }
          setEditorState(message);
        }
        return false;
      } finally {
        clearInterval(hudTimer);
        focusBtn?.removeEventListener("click", onFocusClick);
        // Keep the user's split ratio and panel state available after the run ends.
        releaseRuntimeUi();
        const preserveRun = !simulationFinished && pageRequest && !isCurrentRequest(pageRequest);
        if (!preserveRun && stage.isConnected && ownsRuntimePanel()) syncDebugRunButton(simulationFinished ? "terminal" : "idle");
        if (!preserveRun && state.studioActiveRun?.simulationId === activeSimulationId) state.studioActiveRun = null;
        if (state._activeSimulationAbort === abortController) state._activeSimulationAbort = null;
      }
    };
    state.runTeamStudioSimulation = simulateTeam;
    const updateStudioGraph = mountStudioGraph(stage, {
      mode: "product-edit",
      authoring,
      canvas,
      viewModel: payload.viewModel,
      readOnly: false,
      showTopologyOrder: true,
      showTechnicalDetails: true,
      initialLayoutMode: "flow",
      defaultAutoLayout: true,
      defaultAutoLayoutRequestId: 1,
      canSaveWorkbench: true,
      historyContext: captureEditorHistoryContext(),
      rolePackages: studioRolePackages,
      projectConfig: { modelCatalog: { models: discoveredModels } },
      labels: graphLabels[state.locale],
      commandFormLabels: graphFormLabels[state.locale],
      commandFormHost: workbench?.querySelector("#studio-command-form-host"),
      onCommandFormStateChange: ({ open }) => {
        const commandHost = workbench?.querySelector("#studio-command-form-host");
        if (open) showAssetPanel("properties");
        if (commandHost) commandHost.hidden = !open;
        if (inspector) inspector.hidden = open;
        if (assetBack) assetBack.hidden = open || assetPanelView !== "properties";
        const editorActions = assetDrawer?.querySelector(".studio-asset-editor-actions");
        if (editorActions) editorActions.hidden = open;
      },
      onSelectRole: (roleId) => {
        setStudioSelection({ roleId });
        updateStudioGraph?.update({ selectedRoleId: roleId, selectedFlowKey: "" });
        renderInspector();
        syncAssetNavigatorSelection();
        showAssetPanel("properties", { focusInspector: false });
      },
      onSelectFlow: (flowKey) => {
        const flow = Object.values(authoring.flows || {}).find((item) => studioAuthoringFlowKey(item) === flowKey);
        if (!flow) {
          setStudioSelection();
          updateStudioGraph?.update({ selectedRoleId: "", selectedFlowKey: "" });
          renderInspector();
          syncAssetNavigatorSelection();
          return;
        }
        setStudioSelection({ flowKey, flowId: flow.flowId });
        updateStudioGraph?.update({ selectedRoleId: "", selectedFlowKey: flowKey });
        renderInspector();
        syncAssetNavigatorSelection();
        showAssetPanel("properties", { focusInspector: false });
      },
      onOpenTeamAssets: () => showAssetPanel("list"),
      onClearSelection: () => {
        setStudioSelection();
        updateStudioGraph?.update({ selectedRoleId: "", selectedFlowKey: "" });
        renderInspector();
        syncAssetNavigatorSelection();
      },
      onChatGenerate: () => state.teamStudioDialog?.("assistant"),
      onOpenDebug: () => state.teamStudioDialog?.("run"),
      onQuickDebugRun: (input) => simulateTeam(input),
      onFocusDebugInput: () => { state.teamStudioDialog?.("run"); return true; },
      onStatusChange: setEditorState,
      onToast: (tone, message) => {
        setEditorState(message);
        if (tone === "error") showToast(message);
      },
      onApplyCommand: async (result) => {
        let convertedSourceAssets;
        const pendingSourceRole = result.repositoryRoleId ? studioSourceRolesByCommandId.get(result.repositoryRoleId) : undefined;
        if (pendingSourceRole && result.selectedRoleId) {
          const sourceResponse = await pageFetch(`/api/v1/studio/role-sources/${encodeURIComponent(pendingSourceRole.sourceId)}/roles/${encodeURIComponent(pendingSourceRole.roleKey)}/convert?commit=${encodeURIComponent(pendingSourceRole.commit)}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ roleId: result.selectedRoleId })
          });
          const sourcePayload = await sourceResponse.json();
          if (!sourceResponse.ok) throw new Error(sourcePayload.error || "Unable to convert the source role.");
          convertedSourceAssets = sourcePayload.result?.files || {};
        }
        authoring = result.authoring;
        canvas = result.canvas;
        if (result.historyContext) {
          const history = result.historyContext;
          selection.assets = history.assets || selection.assets;
          pendingRoleAssets.clear();
          for (const key of history.pendingRoleAssets || []) pendingRoleAssets.add(key);
          pendingContractSchemas.clear();
          for (const path of history.pendingContractSchemas || []) pendingContractSchemas.add(path);
          contractsDirty = Boolean(history.contractsDirty);
          executionConfigDirty = Boolean(history.executionConfigDirty);
          modelSelectionDirty = Boolean(history.modelSelectionDirty);
        }
        const selectedFlow = result.selectedFlowKey
          ? Object.values(authoring.flows || {}).find((flow) => studioAuthoringFlowKey(flow) === result.selectedFlowKey)
          : null;
        const selectedRoleId = result.selectedFlowKey ? "" : result.selectedRoleId || "";
        setStudioSelection({ roleId: selectedRoleId, flowKey: result.selectedFlowKey || "", flowId: selectedFlow?.flowId || "" });
        if (result.repositoryRoleId) {
          const template = studioRoleTemplatesByCommandId.get(result.repositoryRoleId);
          if (template && result.selectedRoleId) {
            const templateResponse = await pageFetch(`/api/v1/studio/role-repository/${encodeURIComponent(template.roleId)}/versions/${encodeURIComponent(template.versionId)}`);
            const templatePayload = await templateResponse.json();
            if (!templateResponse.ok) throw new Error(templatePayload.error || "Unable to load role template assets.");
            selection.assets.roles ||= {};
            selection.assets.roles[result.selectedRoleId] = templatePayload.assets || {};
            for (const file of Object.keys(templatePayload.assets || {})) pendingRoleAssets.add(`${result.selectedRoleId}/${file}`);
          }
          if (convertedSourceAssets && result.selectedRoleId) {
            selection.assets.roles ||= {};
            selection.assets.roles[result.selectedRoleId] = convertedSourceAssets;
            for (const file of Object.keys(convertedSourceAssets)) pendingRoleAssets.add(`${result.selectedRoleId}/${file}`);
          }
        }
        updateStudioGraph?.update({
          authoring,
          canvas,
          viewModel: undefined,
          selectedRoleId,
          selectedFlowKey: result.selectedFlowKey || "",
          historyContext: result.historyContext || captureEditorHistoryContext()
        });
        renderInspector();
        renderAssetNavigator();
        dirty = true;
        setDirty("project-graph");
        setEditorState(state.locale === "en" ? "Unsaved structure changes." : "有未保存的结构修改");
        if (result.selectedRoleId || result.selectedFlowKey) showAssetPanel("properties");
      },
      onApplyCanvas: (nextCanvas) => {
        canvas = nextCanvas;
        dirty = true;
        setDirty("project-graph");
        setEditorState(state.locale === "en" ? "Unsaved layout changes." : "有未保存的布局修改");
      },
      onValidateWorkbench: async () => {
        const result = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/design/validate`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ authoring })
        });
        const validation = await result.json();
        if (!isCurrentRequest(pageRequest)) return;
        const problemsDrawer = document.querySelector("#studio-problems-drawer");
        const problemsList = problemsDrawer?.querySelector(".studio-problems-list");
        const statusElement = $("#project-design-status");
        if (!result.ok || validation.ok === false) {
          const diagnostics = validation.diagnostics || [];
          const errorMsg = validation.error || diagnostics.map((item) => item.message).join("; ") || (state.locale === "en" ? "Structure validation failed." : "结构校验失败");
          setEditorState(errorMsg);
          if (problemsDrawer && problemsList && diagnostics.length) {
            problemsList.innerHTML = diagnostics.map((d) => {
              const roleTag = d.roleId ? `<span class="problem-role-tag">${esc(d.roleId)}</span>` : "";
              const flowTag = d.flowKey ? `<span class="problem-role-tag">${esc(d.flowKey)}</span>` : "";
              return `<li class="studio-problem-item" data-problem-role="${esc(d.roleId || "")}" data-problem-flow="${esc(d.flowKey || "")}" tabindex="0"><span class="problem-icon">●</span><div class="problem-item-text"><span>${esc(d.message || d.code || "校验错误")}</span>${roleTag}${flowTag}</div></li>`;
            }).join("");
            problemsDrawer.hidden = false;
            let trigger = statusElement?.querySelector(".studio-problems-trigger");
            if (!trigger && statusElement) {
              trigger = document.createElement("button");
              trigger.type = "button";
              trigger.className = "studio-problems-trigger";
              trigger.setAttribute("data-touch-target-exempt", "");
              trigger.innerHTML = `<span class="problems-dot">●</span> <span>${diagnostics.length} ${state.locale === "en" ? "Problems" : "个问题"}</span>`;
              trigger.addEventListener("click", () => {
                problemsDrawer.hidden = !problemsDrawer.hidden;
              });
              statusElement.append(trigger);
            }
          }
          return;
        }
        setEditorState(state.locale === "en" ? "Structure validation passed." : "结构校验通过");
        if (problemsDrawer) problemsDrawer.hidden = true;
        statusElement?.querySelector(".studio-problems-trigger")?.remove();
      },
      onSaveWorkbench: async () => {
        if (!dirty) { setEditorState(state.locale === "en" ? "There are no unsaved changes." : "没有待保存的修改"); return; }
        setEditorState(state.locale === "en" ? "Saving TeamVersion design…" : "正在保存团队设计…");
        const result = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/save`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ authoring, assets: selection.assets, expectedTeamVersionDigest: projectDigest })
        });
        const saved = await result.json();
        if (!isCurrentRequest(pageRequest)) return;
        if (!result.ok) {
          setEditorState(saved.error || "团队版本保存失败");
          return;
        }
        dirty = false;
        clearDirty("project-graph");
        pendingRoleAssets.clear();
        pendingContractSchemas.clear();
        contractsDirty = false;
        executionConfigDirty = false;
        modelSelectionDirty = false;
        if (saved.createdDraft) {
          navigate(withCurrentSearch(`/studio/teams/${encodeURIComponent(saved.teamVersionId)}/design`));
          return;
        }
        projectDigest = saved.teamVersionDigest || saved.saveSnapshotDigest || projectDigest;
        if (saved.authoring) authoring = saved.authoring;
        updateStudioGraph?.update({ authoring, viewModel: undefined, selectedRoleId: selection.roleId, selectedFlowKey: selection.flowKey });
        renderInspector();
        renderAssetNavigator();
        syncAssetNavigatorSelection();
        setEditorState(saved.unchanged ? "内容未变化，无需创建新版本。" : (state.locale === "en" ? "Saved." : "已保存。"));
      },
      onQuickDebugRun: simulateTeam,
      onToggleFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await stage.requestFullscreen();
      }
    });
    stage.removeAttribute("aria-busy");
    markStudioGraphReady(stage);
    setEditorState(state.locale === "en" ? "Team graph loaded and ready to edit." : "团队结构已加载，可以编辑。");
    const problemsDrawer = document.querySelector("#studio-problems-drawer");
    problemsDrawer?.querySelector("[data-problems-close]")?.addEventListener("click", () => {
      problemsDrawer.hidden = true;
    });
    stage._studioGraph = updateStudioGraph;
    problemsDrawer?.addEventListener("click", (event) => {
      const item = event.target.closest?.(".studio-problem-item");
      if (!item) return;
      const targetRole = item.dataset.problemRole;
      const targetFlow = item.dataset.problemFlow;
      if (targetRole) {
        selectedRoleId = targetRole;
        selectedFlowKey = "";
        updateStudioGraph?.update?.({ selectedRoleId: targetRole, selectedFlowKey: "" });
        renderInspector();
        showAssetPanel("properties");
      } else if (targetFlow) {
        selectedRoleId = "";
        selectedFlowKey = targetFlow;
        updateStudioGraph?.update?.({ selectedRoleId: "", selectedFlowKey: targetFlow });
        renderInspector();
        showAssetPanel("properties");
      }
    });
    void resumeStudioProgress(projectId, stage, updateStudioGraph, debugPanel, setDebugView, syncDebugRunButton, setEditorState, pageRequest, authoring);
  } catch (error) { if (isAbort(error)) return;
    stage.removeAttribute("aria-busy");
    stage.textContent = error.message || "Unable to load the project graph.";
    setEditorState(error.message || (state.locale === "en" ? "Unable to load the project graph." : "团队结构加载失败。"));
  }
}

async function confirmTeamRuntimeReadiness(teamVersionId, authoring, pageRequest = state.activeRequest) {
  try {
    const fetchBounded = async (url, timeoutMs, options = {}) => {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        return await pageFetch(url, { ...options, signal: controller.signal });
      } catch (error) {
        if (timedOut) {
          const timeoutError = new Error(`Request timed out after ${timeoutMs}ms.`);
          timeoutError.code = "PLATFORM_REQUEST_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };
    // Prefer the complete discovery snapshot so readiness sees backend and model
    // identity together. Fall back to the bounded UI projection when a slow CLI
    // keeps the aggregate endpoint pending.
    let discoveryResponse;
    try {
      discoveryResponse = await fetchBounded("/api/v1/platform/discovery", 3000);
    } catch (error) {
      if (isAbort(error)) throw error;
      discoveryResponse = await fetchBounded("/api/v1/platform/models", 5000);
    }
    const [designResponse, settingsResponse] = await Promise.all([
      authoring ? Promise.resolve(undefined) : pageFetch(`/api/v1/team-versions/${encodeURIComponent(teamVersionId)}/design`),
      pageFetch("/api/v1/platform/settings")
    ]);
    const discovery = await discoveryResponse.json();
    if (!discoveryResponse.ok) throw new Error(discovery.error || "Unable to discover runtime models.");
    const design = designResponse ? await designResponse.json() : undefined;
    if (designResponse && !designResponse.ok) throw new Error(design.error || "Unable to read the team model bindings.");
    const settingsPayload = await settingsResponse.json();
    if (!settingsResponse.ok) throw new Error(settingsPayload.error || "Unable to read the default model setting.");
    if (pageRequest && !isCurrentRequest(pageRequest)) return false;
    const roles = (authoring || design?.authoring)?.roles || {};
    const models = discovery.models || [];
    const settings = settingsPayload.settings || {};
    const configuredDefault = String(settings.defaultModel || "default");
    const defaultModel = configuredDefault === "default"
      ? models.find((item) => item.backend === settings.defaultProvider && item.runnable)
      : models.find((item) => item.runnable && item.backend === settings.defaultProvider && item.modelId === configuredDefault);
    const issues = [];
    const inheritedRoles = [];
    await Promise.all(Object.entries(roles).map(async ([roleId, role]) => {
      if (role.bindingKind === "exec" || (role.profileId && role.bindingKind !== "model")) return;
      if (role.bindingKind !== "model") {
        if (defaultModel) {
          inheritedRoles.push(roleId);
          return;
        }
        issues.push(`${roleId}: ${state.locale === "en" ? "no model or execution profile is configured" : "未配置模型或执行配置"}`);
        return;
      }
      const modelRef = role.modelRef || (role.backend && role.modelId ? `${role.backend}/${role.modelId}` : "");
      if (!modelRef && defaultModel) {
        inheritedRoles.push(roleId);
        return;
      }
      const backend = role.backend || modelRef.split("/", 1)[0];
      const modelId = role.modelId || modelRef.slice(backend ? backend.length + 1 : 0);
      const model = models.find((item) => item.backend === backend && item.modelId === modelId && (item.status === "verified" || item.runnable === true));
      if (!model) {
        issues.push(`${roleId}: ${state.locale === "en" ? `runnable model ${modelRef || "is not selected"} was not discovered` : `未发现可运行模型 ${modelRef || "（尚未选择）"}`}`);
      }
    }));
    if (!issues.length && !inheritedRoles.length) return true;
    return confirmAction({
      title: issues.length
        ? (state.locale === "en" ? "Some team roles may not run" : "部分团队角色可能无法执行")
        : (state.locale === "en" ? "Use the platform default model?" : "使用平台默认模型运行？"),
      message: state.locale === "en"
        ? `${issues.length ? `${issues.join("\n")}\n` : ""}${inheritedRoles.length ? `Unbound roles: ${inheritedRoles.join(", ")}\n` : ""}Unbound roles use the selected platform default. Explicit role and project model settings keep priority.`
        : `${issues.length ? `${issues.join("\n")}\n` : ""}${inheritedRoles.length ? `未绑定模型：${inheritedRoles.join("、")}\n` : ""}未绑定角色会使用平台默认模型；角色和项目中已配置的模型优先。`,
      confirmLabel: state.locale === "en" ? "Continue anyway" : "仍然继续",
      cancelLabel: state.locale === "en" ? "Return to configure" : "返回配置"
    });
  } catch (error) {
    if (isAbort(error)) return false;
    if (pageRequest && !isCurrentRequest(pageRequest)) return false;
    return confirmAction({
      title: state.locale === "en" ? "Model readiness could not be checked" : "暂时无法确认模型状态",
      message: state.locale === "en"
        ? "Refresh Codex and OpenCode discovery in Platform settings, or continue without a readiness check."
        : "可到平台设置刷新 Codex 和 OpenCode 的发现结果，或跳过检查继续运行。",
      confirmLabel: state.locale === "en" ? "Continue without check" : "跳过检查并继续",
      cancelLabel: state.locale === "en" ? "Cancel" : "取消"
    });
  }
}

async function renderProjectStudio(projectId, pageRequest = state.activeRequest) {
  await renderProjectDraft(projectId, pageRequest);
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  if (state.studioRoute) {
    const tabs = `<div class="studio-workspace-tabs">${studioWorkspaceNav(projectId, "design")}</div>`;
    frameExistingPage($("#studio-view"), "B", "", tabs);
  }
  await renderProjectGraph(projectId, "project-graph-stage", false, pageRequest);
}

const runTeamGraphMounts = new Map();
function runtimeEventsFromPayload(eventsPayload) {
  return (eventsPayload?.events || []).map((entry) => {
    const record = entry?.record || entry || {};
    const event = record.event && typeof record.event === "object" ? record.event : record;
    return { ...record, ...event, type: event.type || record.type || record.eventType };
  }).filter((event) => typeof event.type === "string");
}
function mountRunTeamGraph(teamVersionId, eventsPayload, taskId = teamVersionId) {
  const root = $("#project-workspace-view");
  if (!root || !teamVersionId) return;
  let mount = runTeamGraphMounts.get(taskId);
  if (mount && !mount.stage.isConnected) {
    runTeamGraphMounts.delete(taskId);
    mount = null;
  }
  if (!mount) {
    const stageId = `project-run-graph-${createUuid()}`;
    root.insertAdjacentHTML("beforeend", `<section class="project-panel project-graph-preview run-team-graph"><div class="panel-head"><div><span class="section-kicker">已选团队 · 任务 ${esc(taskId)}</span><h2>团队协作结构</h2><p class="form-status">只读图谱，用于查看此运行经过的角色与交接。</p></div><span class="status-chip">只读</span></div><div id="${esc(stageId)}" class="graph-stage studio-graph-island" role="img" aria-label="Selected team collaboration graph"></div></section>`);
    const stage = root.querySelector(`#${CSS.escape(stageId)}`);
    if (!stage) return;
    mount = { stage, ready: renderProjectGraph(teamVersionId, stageId, true), events: runtimeEventsFromPayload(eventsPayload) };
    runTeamGraphMounts.set(taskId, mount);
  }
  mount.events = runtimeEventsFromPayload(eventsPayload);
  void Promise.resolve(mount.ready).then((graph) => {
    if (!mount.stage.isConnected) return;
    if (graph?.setRuntimeProgress) graph.setRuntimeProgress(mount.events);
    else window.OGSStudioGraphBundle?.setStudioX6RuntimeProgress?.(mount.stage, mount.events);
  });
}

function projectRunStatusLabel(status) {
  return ({ waiting_review: "等待人工审核", paused: "已安全暂停", pause_requested: "正在暂停", running: "运行中", planning: "准备运行", completed: "已完成", failed: "运行失败", cancelled: "已取消", cancel_requested: "正在取消" })[status] || status || "已完成";
}

async function renderProjectDraft(projectId, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  const root = state.studioRoute ? $("#studio-view") : $("#project-workspace-view");
  root?._studioDraftCleanup?.();
  if (root) root._studioDraftCleanup = null;
  if (state.studioRoute) {
    root.classList.add("studio-design-page");
    root.dataset.template = "B";
  } else {
    root.classList.remove("studio-design-page");
    delete root.dataset.template;
  }
  const loading = `<div class="project-loading">${state.locale === "en" ? "Loading team version…" : "正在读取团队版本…"}</div>`;
  root.innerHTML = state.studioRoute
    ? `<section class="page-frame" data-template="B" data-fit><div class="page-frame-body" data-layout-scroll>${loading}</div></section>`
    : loading;
  try {
    const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}`); const project = await response.json(); if (!response.ok) throw new Error(project.error || (state.locale === "en" ? "Team version not found." : "团队版本不存在。"));
    state.studioTeamVersion = project;
    const confirmed = project.teamVersionStatus === "released";
    const adjustmentParams = new URLSearchParams(window.location.search);
    const collaborationProjectId = adjustmentParams.get("collaborationProjectId");
    if (collaborationProjectId) {
      root.insertAdjacentHTML("afterbegin", `<p class="form-hint" role="status">此设计来自 OGS Projects 项目调整。检查并发布后返回项目显式挂载新版本。</p>`);
    }
    const designBackUrl = collaborationProjectId ? `/projects/${encodeURIComponent(collaborationProjectId)}/teams` : state.studioRoute ? "/studio" : "/projects";
    const designBackLabel = state.locale === "en" ? (collaborationProjectId ? "Back to project" : state.studioRoute ? "Team repository" : "Back to project") : (collaborationProjectId ? "返回项目" : state.studioRoute ? "团队仓库" : "返回项目");
    const designTeamId = project.teamId || project.teamRootId || projectId;
    root.innerHTML = `<section class="page-heading page-frame-header"><div><a class="detail-back" href="${designBackUrl}" data-route="${designBackUrl}">← ${designBackLabel}</a><div class="eyebrow">OGS Studio · ${esc(designTeamId)}</div><h1>${esc(project.name)} <span class="version-badge">v${project.teamVersionNumber || 1}</span></h1><p>${esc(project.overview || (state.locale === "en" ? "Team orchestration and asset design workbench" : "团队编排与资产设计工作台"))}</p></div><span class="status-chip ${confirmed ? "released" : "draft"}">${confirmed ? (state.locale === "en" ? "Released" : "已发布") : (state.locale === "en" ? "In design" : "设计中")}</span><span class="project-status ${confirmed ? "confirmed" : "draft"}" hidden>${confirmed ? "团队版本已发布" : "团队设计中，可继续调整"}</span></section><nav class="project-steps team-only"><a class="project-step active" href="#team"><span>01</span><strong>团队设计</strong><small>${confirmed ? "已发布版本" : "编辑与验证中"}</small></a></nav><section class="project-grid draft-grid"><article class="project-panel project-editor-panel" id="team"><div class="panel-head"><div><span class="section-kicker">团队资产</span><h2>定义团队职责</h2></div><span class="count-badge">${confirmed ? "RELEASED" : "DESIGN"}</span></div><form id="project-edit-form" class="compact-form"><label>团队名称<input name="name" value="${esc(project.name)}" required maxlength="120"></label><label>团队目标<textarea name="overview" rows="7" maxlength="4000" required>${esc(project.overview || "")}</textarea><span class="field-hint">${esc(copy[state.locale].targetHint)}</span></label><div class="form-actions"><button class="secondary-button" type="submit">保存微调</button>${confirmed ? '<button id="reconfirm-project" class="secondary-button" type="button">另存为新版本</button>' : `<button id="confirm-project" class="primary-button" type="button">${esc(copy[state.locale].releaseTeam)}</button>`}</div><p class="form-status" id="project-edit-status"></p></form></article><article class="project-panel project-preview-panel"><div class="panel-head"><div><span class="section-kicker">版本信息</span><h2>团队版本</h2></div><span class="status-chip">${confirmed ? "已发布" : "设计中"}</span></div><div class="preview-list"><div><strong>版本状态</strong><span>${confirmed ? "已发布，可挂载到项目" : "未发布，不能挂载到项目"}</span></div><div><strong>工程资产</strong><span>图谱、角色绑定、角色资产包、上下文映射与流程契约</span></div></div><p class="preview-note">团队工程配置由 Studio 管理；Projects 使用已发布版本并独立保存业务材料、任务和运行证据。</p></article></section>`;
    const versionChip = root.querySelector(".project-preview-panel .status-chip");
    if (versionChip) {
      versionChip.textContent = confirmed ? "已发布" : "设计中";
      versionChip.classList.add(confirmed ? "released" : "draft");
    }
    if (state.studioRoute) {
      root.classList.add("studio-design-page");
      root.querySelector(".project-steps")?.remove();
      const editorPanel = root.querySelector(".project-editor-panel");
      const metadataForm = editorPanel?.querySelector("#project-edit-form");
      const releaseAction = metadataForm?.querySelector("#confirm-project, #reconfirm-project");
      const heading = root.querySelector(".page-heading");
      releaseAction?.remove();
      if (state.studioRoute) addStudioWorkspaceNav(root, projectId, "design");
      const teamStatus = heading?.querySelector(".project-status");
      if (teamStatus) teamStatus.textContent = confirmed ? `已发布 · v${project.teamVersionNumber || 1}` : "设计中";
      editorPanel?.remove();
      root.querySelector(".project-preview-panel")?.remove();
      root.querySelector(".project-grid")?.remove();
      root.insertAdjacentHTML("beforeend", '<div class="studio-design-workbench-host" id="studio-workbench-host"></div>');
      metadataForm?.remove();
    } else {
      root.classList.remove("studio-design-page");
    }
    const previewVersion = root.querySelector(".project-preview-panel .preview-list > div:first-child span");
    if (previewVersion) previewVersion.textContent = confirmed ? "已发布版本" : "未发布，仅在 OGS Studio 中可见";
    const previewAssets = root.querySelector(".project-preview-panel .preview-list > div:nth-child(2) span");
    if (previewAssets) previewAssets.textContent = state.locale === "en"
      ? "Topology, role bindings, role packages, Context Map, and flow contracts"
      : "图谱拓扑、角色绑定、角色资产包、上下文映射和流程契约";
    const previewNote = root.querySelector(".project-preview-panel .preview-note");
    if (previewNote) previewNote.textContent = "团队只负责结构、角色和协作方式。";
    if (collaborationProjectId) {
      root.querySelector(".page-heading")?.insertAdjacentHTML("afterend", `<p class="form-hint" role="status">${state.locale === "en" ? "This in-design version is from a project team adjustment. Review and release it, then return to the project to mount it." : "此设计中版本来自 OGS Projects 项目调整。检查并发布后返回项目显式挂载。"}</p>`);
    }
    const graphStatusMarkup = state.studioRoute
      ? `<span class="project-status ${confirmed ? "confirmed" : "draft"}">${confirmed ? "团队版本已发布" : "团队设计中，可继续调整"}</span>`
      : "";
    const graphMarkup = `<section class="project-panel project-graph-preview"><div class="panel-head"><div><span class="section-kicker">OGS Studio · 架构编排</span><h2>团队协作图谱</h2><p id="project-design-status" class="form-status" role="status" aria-live="polite"><span class="studio-graph-status-text">正在加载可编辑团队结构</span></p></div></div><div id="project-graph-stage" class="graph-stage studio-graph-island" role="application" aria-label="Editable team collaboration graph"></div><p class="preview-note">此处编辑团队拓扑；选择角色或流程可打开对应属性。静态校验不代表模型服务或凭据已连通。</p>${graphStatusMarkup}</section>`;
    if (state.studioRoute) root.querySelector("#studio-workbench-host")?.insertAdjacentHTML("beforeend", graphMarkup);
    else root.querySelector(".project-grid")?.insertAdjacentHTML("beforebegin", graphMarkup);
    const graphPanel = root.querySelector(".project-graph-preview");
    let workbench = null;
    let debugPanel = null;
    let panelDockStates = {
      build: { docked: false, floatingBounds: null },
      asset: { docked: false, floatingBounds: null },
      debug: { docked: false, floatingBounds: null }
    };
    let activeDockPanel = null;
    let undockPanelForDrag = () => {};
    let dockPanelAfterDrag = () => false;
    let syncPanelDockLayout = () => {};
    let assetDrawer = null;
    let assetToggle = null;
    let buildPanel = null;
    const isCompactPanelViewport = () => window.matchMedia?.("(max-width: 760px)").matches === true;
    if (graphPanel) {
      graphPanel.querySelector(".section-kicker")?.remove();
      graphPanel.querySelector(".studio-canvas-actions .status-chip")?.remove();
      const graphStatus = graphPanel.querySelector("#project-design-status");
      graphStatus?.classList.add("studio-graph-status-bar");
      graphPanel.querySelector("#project-graph-stage")?.after(graphStatus);
      graphPanel.querySelector(".preview-note")?.remove();
      const studioStatus = state.studioRoute ? graphPanel.querySelector(":scope > .project-status") : null;
      if (studioStatus) {
        root.querySelector(".page-heading .project-status")?.remove();
        if (!graphStatus.querySelector(".studio-graph-status-text")) {
          const textSpan = document.createElement("span");
          textSpan.className = "studio-graph-status-text";
          textSpan.textContent = graphStatus.textContent || "";
          graphStatus.replaceChildren(textSpan);
        }
        graphStatus?.append(document.createTextNode(" · "), studioStatus);
      }
      workbench = document.createElement("section");
      workbench.className = "studio-design-workbench";
      workbench.dataset.layoutPreference = "structure-focus";
      if (state.studioRoute) root.querySelector("#studio-workbench-host")?.append(workbench);
      else graphPanel.before(workbench);
      workbench.append(graphPanel);
      workbench.insertAdjacentHTML("beforeend", '<aside id="studio-asset-drawer" class="studio-asset-drawer" aria-label="团队配置" aria-hidden="true"><div class="studio-asset-drawer-head" tabindex="0" aria-label="拖动团队配置面板"><button type="button" class="studio-asset-back" data-studio-assets-back hidden aria-label="返回团队配置">←</button><strong>团队配置</strong><button type="button" id="studio-asset-drawer-close" class="close-button" aria-label="关闭团队配置">×</button></div><div id="studio-assets-list-view"><div class="studio-asset-tabs" role="tablist" aria-label="团队配置"><button type="button" role="tab" id="studio-assets-roles-tab" aria-controls="studio-assets-roles" aria-selected="true">角色</button><button type="button" role="tab" id="studio-assets-flows-tab" aria-controls="studio-assets-flows" aria-selected="false">流转</button><button type="button" role="tab" id="studio-assets-global-tab" aria-controls="studio-assets-global" aria-selected="false">全局</button></div><section id="studio-assets-roles" role="tabpanel" aria-labelledby="studio-assets-roles-tab" class="studio-asset-list"></section><section id="studio-assets-flows" role="tabpanel" aria-labelledby="studio-assets-flows-tab" class="studio-asset-list" hidden></section><section id="studio-assets-global" role="tabpanel" aria-labelledby="studio-assets-global-tab" class="studio-asset-list" hidden></section></div><div id="studio-assets-property-view" hidden><div id="studio-command-form-host" hidden></div><section class="studio-property-inspector" id="studio-property-inspector" aria-label="团队配置属性"></section><div class="studio-asset-editor-actions"><span class="form-hint">保存会写入当前团队版本</span><button type="button" class="primary-button" data-studio-save-workspace>保存团队</button></div></div></aside><aside id="team-debug-dialog" class="team-debug-panel" aria-label="调试" aria-hidden="true"><header class="team-debug-panel-head" tabindex="0" aria-label="拖动调试面板"><div><strong>调试</strong><span class="team-debug-run-state" data-debug-run-state></span></div><div class="team-debug-panel-actions"><button class="primary-button" id="team-simulation-run" type="button">开始调试</button><button class="close-button" type="button" data-team-debug-close aria-label="关闭调试面板">×</button></div></header><div class="debug-view-tabs" role="tablist" aria-label="调试视图"><button type="button" role="tab" data-debug-view="config" aria-selected="true">配置</button><button type="button" role="tab" data-debug-view="run" aria-selected="false">运行过程</button></div><div class="team-debug-panel-content"><div class="debug-config-view" data-debug-view-panel="config"><label class="assistant-input-label"><span>调试任务</span><textarea id="team-simulation-input" rows="3" maxlength="4000" placeholder="描述本次要验证的任务"></textarea></label><label class="assistant-input-label"><span>补充资料（可选）</span><textarea id="team-simulation-materials" rows="3" maxlength="8000" placeholder="粘贴背景、原始文本、要求或其他测试数据"></textarea></label><fieldset class="debug-mode-choice" id="team-simulation-mode"><legend>运行方式</legend><label><input type="radio" name="studioSimulationMode" value="dry-run" checked><span data-debug-mode-label="dry-run">仿真</span><small data-debug-mode-description="dry-run">仅预览流程，不调用模型</small></label><label><input type="radio" name="studioSimulationMode" value="sandbox"><span data-debug-mode-label="sandbox">沙箱</span><small data-debug-mode-description="sandbox">调用真实模型，但运行在隔离环境</small></label><p class="form-hint">任务与补充资料将合并作为本次输入；调试使用当前团队版本快照，运行记录独立保存。</p></fieldset></div><div class="debug-run-view" data-debug-view-panel="run" hidden><div id="team-simulation-result" aria-live="polite"></div></div></div></aside>');
      workbench.insertAdjacentHTML("beforeend", '<aside id="team-build-panel" class="studio-asset-drawer studio-build-panel" aria-label="AI 构建" aria-hidden="true"><header class="studio-asset-drawer-head team-build-panel-head" tabindex="0" aria-label="拖动 AI 构建面板"><strong>AI 构建</strong><button class="close-button" type="button" data-team-build-close aria-label="关闭 AI 构建">×</button></header><div class="studio-build-panel-content"><section id="team-assistant" class="team-assistant-panel"></section></div></aside>');
      workbench.insertAdjacentHTML("beforeend", '<aside id="studio-problems-drawer" class="studio-problems-drawer" aria-label="诊断问题" hidden><div class="studio-problems-head"><div class="studio-problems-title"><span class="problem-icon">⚠️</span><strong>' + (state.locale === "en" ? "Problems & Diagnostics" : "结构校验问题与诊断") + '</strong></div><button type="button" class="close-button" data-problems-close aria-label="' + (state.locale === "en" ? "Close problems" : "关闭诊断面板") + '">×</button></div><ul class="studio-problems-list"></ul></aside>');
      workbench.insertAdjacentHTML("beforeend", `<button type="button" class="studio-dock-split-handle" data-studio-dock-split-handle aria-label="${state.locale === "en" ? "Resize canvas and docked sidebar" : "调整画布与侧边栏宽度"}" title="${state.locale === "en" ? "Resize canvas and docked sidebar" : "调整画布与侧边栏宽度"}"><span aria-hidden="true"></span></button>`);
      workbench.addEventListener("click", (event) => {
        const action = event.target.closest?.("[data-studio-graph-action]");
        if (!action) return;
        const actionName = action.dataset.studioGraphAction;
        if (actionName !== "assets" && actionName !== "debug-run") return;
        window.setTimeout(() => {
          if (isCompactPanelViewport() && actionName === "assets") {
            buildPanel?.classList.remove("is-open");
            buildPanel?.setAttribute("aria-hidden", "true");
            debugPanel?.classList.remove("is-open");
            debugPanel?.setAttribute("aria-hidden", "true");
          }
          const panel = actionName === "assets" ? assetDrawer : debugPanel;
          panel?.classList.add("is-open");
          panel?.setAttribute("aria-hidden", "false");
        }, 0);
      });
      const inspector = workbench.querySelector("#studio-property-inspector");
      assetDrawer = workbench.querySelector("#studio-asset-drawer");
      debugPanel = workbench.querySelector("#team-debug-dialog");
      buildPanel = workbench.querySelector("#team-build-panel");
      const ensurePanelMaximizeButton = (panel, label) => {
        if (!panel) return null;
        const header = panel.querySelector("header, .studio-asset-drawer-head");
        if (!header || header.querySelector("[data-panel-maximize]")) return header?.querySelector("[data-panel-maximize]") || null;
        const existingClose = header.querySelector(":scope > .close-button");
        const actions = header.querySelector(".team-debug-panel-actions") || header.querySelector(".studio-panel-head-actions") || (() => {
          const node = document.createElement("div");
          node.className = "studio-panel-head-actions";
          if (existingClose) node.append(existingClose);
          header.append(node);
          return node;
        })();
        if (existingClose && existingClose.parentElement !== actions) actions.append(existingClose);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "studio-panel-maximize";
        button.dataset.panelMaximize = "";
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", label);
        button.title = label;
        button.textContent = "⛶";
        actions.insertBefore(button, actions.querySelector(".close-button") || null);
        return button;
      };
      const ensurePanelDockButton = (panel, key, { dockLabel, floatLabel } = {}) => {
        if (!panel) return null;
        const header = panel.querySelector("header, .studio-asset-drawer-head");
        if (!header || header.querySelector("[data-panel-dock]")) return header?.querySelector("[data-panel-dock]") || null;
        const existingClose = header.querySelector(":scope > .close-button");
        const actions = header.querySelector(".team-debug-panel-actions") || header.querySelector(".studio-panel-head-actions") || (() => {
          const node = document.createElement("div");
          node.className = "studio-panel-head-actions";
          if (existingClose) node.append(existingClose);
          header.append(node);
          return node;
        })();
        if (existingClose && existingClose.parentElement !== actions) actions.append(existingClose);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "studio-panel-dock-btn";
        button.dataset.panelDock = key;
        const dLabel = dockLabel || (state.locale === "en" ? "Dock to right" : "停靠至右侧");
        const fLabel = floatLabel || (state.locale === "en" ? "Float panel" : "浮动面板");
        const isCurrentlyDocked = panelDockStates[key]?.docked || panel.classList.contains("is-right-docked");
        button.setAttribute("aria-pressed", String(isCurrentlyDocked));
        button.setAttribute("aria-label", isCurrentlyDocked ? fLabel : dLabel);
        button.title = isCurrentlyDocked ? fLabel : dLabel;
        button.textContent = isCurrentlyDocked ? "❐" : "⇥";
        const maxBtn = actions.querySelector("[data-panel-maximize]");
        actions.insertBefore(button, maxBtn || actions.querySelector(".close-button") || null);
        button.addEventListener("click", (e) => {
          e.stopPropagation();
          workbench.studioTogglePanelDock?.(panel, key);
        });
        return button;
      };
      const assetMaximizeButton = ensurePanelMaximizeButton(assetDrawer, state.locale === "en" ? "Maximize team configuration" : "最大化团队配置");
      const buildMaximizeButton = ensurePanelMaximizeButton(buildPanel, state.locale === "en" ? "Maximize AI build" : "最大化 AI 构建");
      const debugMaximizeButton = ensurePanelMaximizeButton(debugPanel, state.locale === "en" ? "Maximize debug panel" : "最大化调试面板");
      const assetDockButton = ensurePanelDockButton(assetDrawer, "asset", {
        dockLabel: state.locale === "en" ? "Dock team configuration" : "停靠团队配置",
        floatLabel: state.locale === "en" ? "Float team configuration" : "浮动团队配置"
      });
      const buildDockButton = ensurePanelDockButton(buildPanel, "build", {
        dockLabel: state.locale === "en" ? "Dock AI build" : "停靠 AI 构建",
        floatLabel: state.locale === "en" ? "Float AI build" : "浮动 AI 构建"
      });
      const debugDockButton = ensurePanelDockButton(debugPanel, "debug", {
        dockLabel: state.locale === "en" ? "Dock debug panel" : "停靠调试面板",
        floatLabel: state.locale === "en" ? "Float debug panel" : "浮动调试面板"
      });
      [assetDrawer, buildPanel, debugPanel].forEach((panel) => panel?.setAttribute("data-floating-panel-controller", "true"));
      const resizePanel = (panel, handle, minWidth, minHeight, key) => {
        if (!panel || !handle || panel.dataset.floatingPanelController === "true") return;
        let resizeState = null;
        const applySize = (width, height, anchor = null) => {
          const host = workbench.getBoundingClientRect();
          const bounds = panel.getBoundingClientRect();
          const left = Math.max(0, anchor?.left ?? bounds.left - host.left - workbench.clientLeft);
          const top = Math.max(0, anchor?.top ?? bounds.top - host.top - workbench.clientTop);
          const maxWidth = Math.max(1, workbench.clientWidth - left - 12);
          const maxHeight = Math.max(1, workbench.clientHeight - top - 12);
          const nextWidth = Math.min(Math.max(Math.min(minWidth, maxWidth), width), maxWidth);
          const nextHeight = Math.min(Math.max(Math.min(minHeight, maxHeight), height), maxHeight);
          panel.style.left = `${left}px`;
          panel.style.top = `${top}px`;
          panel.style.right = "auto";
          panel.style.width = `${nextWidth}px`;
          panel.style.height = `${nextHeight}px`;
        };
        handle.addEventListener("pointerdown", (event) => {
          const bounds = panel.getBoundingClientRect();
          const host = workbench.getBoundingClientRect();
          resizeState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left - host.left - workbench.clientLeft, top: bounds.top - host.top - workbench.clientTop, width: bounds.width, height: bounds.height };
          handle.setPointerCapture(event.pointerId);
          event.preventDefault();
          event.stopPropagation();
        });
        handle.addEventListener("pointermove", (event) => {
          if (!resizeState || event.pointerId !== resizeState.pointerId) return;
          if (panel.classList.contains("is-right-docked")) {
            const nextWidth = Math.min(520, Math.max(minWidth, resizeState.width - (event.clientX - resizeState.x)));
            workbench.style.setProperty("--studio-panel-dock-width", `${nextWidth}px`);
            panelDockStates[key].floatingBounds = { ...panelDockStates[key].floatingBounds, width: nextWidth };
            return;
          }
          applySize(resizeState.width + event.clientX - resizeState.x, resizeState.height + event.clientY - resizeState.y, resizeState);
        });
        const finishResize = (event) => { if (resizeState?.pointerId === event.pointerId) resizeState = null; };
        handle.addEventListener("pointerup", finishResize);
        handle.addEventListener("pointercancel", finishResize);
        handle.addEventListener("keydown", (event) => {
          const delta = event.shiftKey ? 48 : 16;
          const changes = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
          if (!changes[event.key]) return;
          event.preventDefault();
          const bounds = panel.getBoundingClientRect();
          if (panel.classList.contains("is-right-docked")) {
            const nextWidth = Math.min(520, Math.max(minWidth, bounds.width + changes[event.key][0]));
            workbench.style.setProperty("--studio-panel-dock-width", `${nextWidth}px`);
            panelDockStates[key].floatingBounds = { ...panelDockStates[key].floatingBounds, width: nextWidth };
            return;
          }
          applySize(bounds.width + changes[event.key][0], bounds.height + changes[event.key][1]);
        });
      };
      const assetResizeHandle = document.createElement("button");
      assetResizeHandle.type = "button";
      assetResizeHandle.className = "studio-panel-resize-handle";
      assetResizeHandle.setAttribute("aria-label", state.locale === "en" ? "Resize team configuration panel" : "调整团队配置面板大小");
      assetResizeHandle.title = state.locale === "en" ? "Resize panel" : "调整面板大小";
      assetResizeHandle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 13 13 5M9 13l4-4M13 9v4H9"></path></svg>';
      assetDrawer?.append(assetResizeHandle);
      const buildResizeHandle = document.createElement("button");
      buildResizeHandle.type = "button";
      buildResizeHandle.className = "studio-panel-resize-handle";
      buildResizeHandle.setAttribute("aria-label", state.locale === "en" ? "Resize AI Build panel" : "调整 AI 构建面板大小");
      buildResizeHandle.title = state.locale === "en" ? "Resize panel" : "调整面板大小";
      buildResizeHandle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 13 13 5M9 13l4-4M13 9v4H9"></path></svg>';
      buildPanel?.append(buildResizeHandle);
      const debugResizeHandle = document.createElement("button");
      debugResizeHandle.type = "button";
      debugResizeHandle.className = "studio-panel-resize-handle";
      debugResizeHandle.setAttribute("aria-label", state.locale === "en" ? "Resize debug panel" : "调整调试面板大小");
      debugResizeHandle.title = state.locale === "en" ? "Resize panel" : "调整面板大小";
      debugResizeHandle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 13 13 5M9 13l4-4M13 9v4H9"></path></svg>';
      debugPanel?.append(debugResizeHandle);
      const triggerCanvasRefit = () => {
        const stage = workbench?.querySelector("#project-graph-stage");
        if (stage) {
          stage._studioGraph?.fitViewport?.();
          window.OGSStudioGraphBundle?.fitStudioX6Viewport?.(stage);
        }
        window.requestAnimationFrame(() => {
          if (stage) {
            stage._studioGraph?.fitViewport?.();
            window.OGSStudioGraphBundle?.fitStudioX6Viewport?.(stage);
          }
        });
      };
      const updateDockButtons = () => {
        for (const key of ["asset", "debug", "build"]) {
          const panel = key === "build" ? buildPanel : key === "asset" ? assetDrawer : debugPanel;
          const btn = panel?.querySelector("[data-panel-dock]");
          if (!btn) continue;
          const isDocked = panelDockStates[key]?.docked && panel.classList.contains("is-right-docked");
          const dLabel = key === "asset"
            ? (state.locale === "en" ? "Dock team configuration" : "停靠团队配置")
            : key === "build"
              ? (state.locale === "en" ? "Dock AI build" : "停靠 AI 构建")
              : (state.locale === "en" ? "Dock debug panel" : "停靠调试面板");
          const fLabel = key === "asset"
            ? (state.locale === "en" ? "Float team configuration" : "浮动团队配置")
            : key === "build"
              ? (state.locale === "en" ? "Float AI build" : "浮动 AI 构建")
              : (state.locale === "en" ? "Float debug panel" : "浮动调试面板");
          btn.setAttribute("aria-pressed", String(isDocked));
          btn.setAttribute("aria-label", isDocked ? fLabel : dLabel);
          btn.title = isDocked ? fLabel : dLabel;
          btn.textContent = isDocked ? "❐" : "⇥";
        }
      };
      const syncDockLayout = () => {
        workbench.classList.remove("is-build-docked", "is-asset-docked", "is-debug-docked");
        workbench.style.removeProperty("--studio-panel-dock-width");
        for (const panel of [buildPanel, assetDrawer, debugPanel]) panel?.classList.remove("is-right-docked");
        if (!activeDockPanel || !panelDockStates[activeDockPanel]?.docked) {
          updateDockButtons();
          return;
        }
        const panel = activeDockPanel === "build" ? buildPanel : activeDockPanel === "asset" ? assetDrawer : debugPanel;
        if (!panel) {
          updateDockButtons();
          return;
        }
        const dockState = panelDockStates[activeDockPanel];
        const host = workbench.getBoundingClientRect();
        const minWidth = 320;
        const preferredWidth = dockState.floatingBounds?.width || (activeDockPanel === "build" ? 420 : activeDockPanel === "asset" ? 340 : 360);
        const maxWidth = Math.max(minWidth, host.width - 420);
        const dockWidth = Math.min(Math.max(minWidth, preferredWidth), Math.min(560, maxWidth));
        workbench.classList.add(`is-${activeDockPanel}-docked`);
        workbench.style.setProperty("--studio-panel-dock-width", `${dockWidth}px`);
        panel.classList.add("is-right-docked");
        updateDockButtons();

        const dockBoundary = host.width - dockWidth;
        let cascadeOffset = 0;
        for (const otherKey of ["asset", "build", "debug"]) {
          if (otherKey === activeDockPanel) continue;
          const otherPanel = otherKey === "build" ? buildPanel : otherKey === "asset" ? assetDrawer : debugPanel;
          if (otherPanel && otherPanel.classList.contains("is-open") && !otherPanel.classList.contains("is-right-docked")) {
            const otherRect = otherPanel.getBoundingClientRect();
            const otherLeft = otherPanel.style.left ? parseFloat(otherPanel.style.left) : (otherRect.left - host.left);
            const otherWidth = otherRect.width || (otherKey === "build" ? 420 : otherKey === "asset" ? 340 : 360);
            if (isNaN(otherLeft) || otherLeft + otherWidth > dockBoundary) {
              const safeLeft = Math.max(20, Math.round(dockBoundary - otherWidth - 16 - cascadeOffset));
              const safeTop = Math.max(20, Math.round(48 + cascadeOffset));
              otherPanel.style.left = `${safeLeft}px`;
              otherPanel.style.top = `${safeTop}px`;
              otherPanel.style.right = "auto";
              cascadeOffset += 44;
              if (panelDockStates[otherKey]) {
                panelDockStates[otherKey].floatingBounds = {
                  ...panelDockStates[otherKey].floatingBounds,
                  left: safeLeft,
                  top: safeTop,
                  width: otherWidth,
                  height: otherRect.height || 480
                };
              }
            }
          }
        }
      };
      syncPanelDockLayout = (key) => {
        if (key !== null && !panelDockStates[key]?.docked) {
          if (activeDockPanel && panelDockStates[activeDockPanel]?.docked) {
            syncDockLayout();
          }
          triggerCanvasRefit();
          return;
        }
        const previousKey = activeDockPanel;
        if (previousKey && previousKey !== key && key !== null && panelDockStates[previousKey]?.docked) {
          const prevPanel = previousKey === "build" ? buildPanel : previousKey === "asset" ? assetDrawer : debugPanel;
          if (prevPanel) {
            panelDockStates[previousKey].docked = false;
            prevPanel.classList.remove("is-right-docked");
            const host = workbench.getBoundingClientRect();
            const prevBounds = panelDockStates[previousKey].floatingBounds || {
              left: Math.max(20, host.width - (previousKey === "build" ? 440 : previousKey === "asset" ? 360 : 380) - 24),
              top: 48,
              width: previousKey === "build" ? 420 : previousKey === "asset" ? 340 : 360,
              height: 480
            };
            prevPanel.style.left = `${Math.max(0, prevBounds.left)}px`;
            prevPanel.style.top = `${Math.max(0, prevBounds.top)}px`;
            prevPanel.style.right = "auto";
            prevPanel.style.width = `${prevBounds.width}px`;
            prevPanel.style.height = `${prevBounds.height}px`;
          }
        }
        activeDockPanel = key;
        syncDockLayout();
        triggerCanvasRefit();
      };
      workbench.studioSyncPanelDockLayout = syncPanelDockLayout;
      const undockPanel = (panel, key) => {
        const dockState = panelDockStates[key];
        if (!dockState) return;
        dockState.docked = false;
        panel.classList.remove("is-right-docked");
        const host = workbench.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        const width = dockState.floatingBounds?.width || bounds.width || (key === "build" ? 420 : key === "asset" ? 340 : 360);
        const height = dockState.floatingBounds?.height || bounds.height || 480;
        const left = dockState.floatingBounds?.left ?? Math.max(20, host.width - width - 24);
        const top = dockState.floatingBounds?.top ?? 48;
        panel.style.left = `${Math.max(0, left)}px`;
        panel.style.top = `${Math.max(0, top)}px`;
        panel.style.right = "auto";
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
        if (activeDockPanel === key) {
          activeDockPanel = null;
          syncDockLayout();
        }
        updateDockButtons();
        triggerCanvasRefit();
      };
      const dockPanel = async (panel, key) => {
        const dockState = panelDockStates[key];
        if (!dockState) return;
        await panel?._studioPanelController?.restoreMaximized?.();
        panel?.classList.remove("is-maximized");
        const host = workbench.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        dockState.floatingBounds = {
          left: bounds.left - host.left,
          top: bounds.top - host.top,
          width: bounds.width,
          height: bounds.height
        };
        dockState.docked = true;
        panel.style.left = "";
        panel.style.top = "";
        panel.style.right = "";
        panel.style.width = "";
        panel.style.height = "";
        syncPanelDockLayout(key);
      };
      const togglePanelDock = async (panel, key) => {
        if (!panel) return;
        const isDocked = panelDockStates[key]?.docked && panel.classList.contains("is-right-docked");
        if (isDocked) undockPanel(panel, key);
        else await dockPanel(panel, key);
      };
      workbench.studioUndockPanel = undockPanel;
      workbench.studioDockPanel = dockPanel;
      workbench.studioTogglePanelDock = togglePanelDock;
      undockPanelForDrag = (panel, key) => {
        const dockState = panelDockStates[key];
        if (!dockState?.docked) return;
        const bounds = panel.getBoundingClientRect();
        const host = workbench.getBoundingClientRect();
        dockState.docked = false;
        panel.classList.remove("is-right-docked");
        panel.style.left = `${Math.max(0, bounds.left - host.left)}px`;
        panel.style.top = `${Math.max(0, bounds.top - host.top)}px`;
        panel.style.right = "auto";
        panel.style.width = `${dockState.floatingBounds?.width || bounds.width}px`;
        panel.style.height = `${dockState.floatingBounds?.height || bounds.height}px`;
        syncPanelDockLayout(null);
      };
      dockPanelAfterDrag = (panel, key) => {
        const host = workbench.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        if (host.right - bounds.right > 44) return false;
        const dockState = panelDockStates[key];
        panel?._studioPanelController?.restoreMaximized?.();
        panel?.classList.remove("is-maximized");
        dockState.floatingBounds = {
          left: bounds.left - host.left,
          top: bounds.top - host.top,
          width: bounds.width,
          height: bounds.height
        };
        dockState.docked = true;
        panel.style.left = "";
        panel.style.top = "";
        panel.style.right = "";
        panel.style.width = "";
        panel.style.height = "";
        syncPanelDockLayout(key);
        return true;
      };
      const dockSplitHandle = workbench.querySelector("[data-studio-dock-split-handle]");
      let dockSplitDrag = null;
      let dockSplitRaf = null;
      dockSplitHandle?.addEventListener("pointerdown", (event) => {
        if (window.matchMedia?.("(max-width: 768px)").matches) return;
        if (!activeDockPanel || !panelDockStates[activeDockPanel]?.docked) return;
        workbench.classList.add("is-split-dragging");
        const host = workbench.getBoundingClientRect();
        dockSplitDrag = { pointerId: event.pointerId, hostRight: host.right, hostWidth: host.width };
        dockSplitHandle.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });
      const onDockSplitPointerMove = (event) => {
        if (!dockSplitDrag || event.pointerId !== dockSplitDrag.pointerId) return;
        const minWidth = 320;
        const maxWidth = Math.max(minWidth, dockSplitDrag.hostWidth - 420);
        const nextWidth = Math.min(maxWidth, Math.max(minWidth, dockSplitDrag.hostRight - event.clientX));
        workbench.style.setProperty("--studio-panel-dock-width", `${nextWidth}px`);
        if (activeDockPanel && panelDockStates[activeDockPanel]) {
          panelDockStates[activeDockPanel].floatingBounds = {
            ...panelDockStates[activeDockPanel].floatingBounds,
            width: nextWidth
          };
        }
        if (!dockSplitRaf) {
          dockSplitRaf = window.requestAnimationFrame(() => {
            dockSplitRaf = null;
            triggerCanvasRefit();
          });
        }
      };
      dockSplitHandle?.addEventListener("pointermove", onDockSplitPointerMove);
      window.addEventListener("pointermove", onDockSplitPointerMove);
      const finishDockSplitDrag = (event) => {
        if (dockSplitDrag?.pointerId === event.pointerId) {
          dockSplitDrag = null;
          workbench.classList.remove("is-split-dragging");
          if (dockSplitRaf) {
            window.cancelAnimationFrame(dockSplitRaf);
            dockSplitRaf = null;
          }
          triggerCanvasRefit();
        }
      };
      dockSplitHandle?.addEventListener("pointerup", finishDockSplitDrag);
      dockSplitHandle?.addEventListener("pointercancel", finishDockSplitDrag);
      window.addEventListener("pointerup", finishDockSplitDrag);
      dockSplitHandle?.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (!activeDockPanel || !panelDockStates[activeDockPanel]?.docked) return;
        event.preventDefault();
        const delta = event.shiftKey ? 48 : 16;
        const host = workbench.getBoundingClientRect();
        const current = Number.parseFloat(getComputedStyle(workbench).getPropertyValue("--studio-panel-dock-width")) || 360;
        const minWidth = 320;
        const maxWidth = Math.max(minWidth, host.width - 420);
        const nextWidth = Math.min(maxWidth, Math.max(minWidth, current + (event.key === "ArrowLeft" ? delta : -delta)));
        workbench.style.setProperty("--studio-panel-dock-width", `${nextWidth}px`);
        if (activeDockPanel && panelDockStates[activeDockPanel]) {
          panelDockStates[activeDockPanel].floatingBounds = {
            ...panelDockStates[activeDockPanel].floatingBounds,
            width: nextWidth
          };
        }
        triggerCanvasRefit();
      });
      assetToggle = graphPanel.querySelector('[data-studio-graph-action="assets"]');
      assetToggle?.addEventListener("click", () => {
        if (!assetDrawer) return;
        if (isCompactPanelViewport()) {
          buildPanel?.classList.remove("is-open");
          buildPanel?.setAttribute("aria-hidden", "true");
          debugPanel?.classList.remove("is-open");
          debugPanel?.setAttribute("aria-hidden", "true");
        }
        assetDrawer.classList.add("is-open");
        assetDrawer.setAttribute("aria-hidden", "false");
        syncPanelDockLayout("asset");
        assetToggle.setAttribute("aria-expanded", "true");
      });
      if (assetDrawer) assetDrawer.querySelector(".studio-asset-drawer-head strong").textContent = state.locale === "en" ? "Team configuration" : "团队配置";
      if (assetToggle) assetToggle.setAttribute("aria-expanded", "false");
      assetDrawer?.querySelector("#studio-assets-roles-tab")?.replaceChildren(document.createTextNode(state.locale === "en" ? "Roles" : "角色"));
      assetDrawer?.querySelector("#studio-assets-flows-tab")?.replaceChildren(document.createTextNode(state.locale === "en" ? "Transitions" : "流转"));
      assetDrawer?.querySelector("#studio-assets-global-tab")?.replaceChildren(document.createTextNode(state.locale === "en" ? "Global" : "全局"));
      assetDrawer?.setAttribute("aria-label", state.locale === "en" ? "Team configuration" : "团队配置");
      assetDrawer?.querySelector("#studio-asset-drawer-close")?.setAttribute("aria-label", state.locale === "en" ? "Close team configuration" : "关闭团队配置");
      assetDrawer?.querySelector(".studio-asset-back")?.setAttribute("aria-label", state.locale === "en" ? "Back to team configuration" : "返回团队配置");
      assetDrawer?.querySelector(".studio-asset-drawer-head")?.setAttribute("aria-label", state.locale === "en" ? "Drag team configuration panel. Use arrow keys to move." : "拖动团队配置面板；也可使用方向键移动。");
      assetDrawer?.querySelector(".studio-asset-editor-actions .form-hint")?.replaceChildren(document.createTextNode(state.locale === "en" ? "Saves changes to the current in-design TeamVersion." : "保存会写入当前设计中的团队版本"));
      assetDrawer?.querySelector("[data-studio-save-workspace]")?.replaceChildren(document.createTextNode(state.locale === "en" ? "Save team" : "保存团队"));
      workbench.querySelector("#studio-asset-drawer-close")?.addEventListener("click", () => {
        workbench.dispatchEvent(new CustomEvent("studio-command-dismiss"));
        assetDrawer?.classList.remove("is-open");
        assetDrawer?.setAttribute("aria-hidden", "true");
        if (activeDockPanel === "asset") syncPanelDockLayout(null);
        workbench.querySelector('[data-studio-graph-action="assets"]')?.setAttribute("aria-expanded", "false");
        workbench.querySelector('[data-studio-graph-action="assets"]')?.focus();
      });
      assetDrawer?.querySelector("[data-studio-assets-back]")?.addEventListener("click", () => {
        workbench.dispatchEvent(new CustomEvent("studio-assets-show", { detail: { view: "list" } }));
        assetDrawer?.querySelector('#studio-assets-roles [data-studio-asset-role], #studio-assets-flows [data-studio-asset-flow]')?.focus({ preventScroll: true });
      });
      assetDrawer?.querySelector("[data-studio-save-workspace]")?.addEventListener("click", () => {
        graphPanel.querySelector('[data-studio-graph-action="save"]')?.click();
      });
      const assetTabs = [...workbench.querySelectorAll('.studio-asset-tabs [role="tab"]')];
      assetTabs.forEach((tab, index) => {
        tab.addEventListener("click", () => {
          const selected = tab.getAttribute("aria-controls");
          assetTabs.forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
          workbench.querySelectorAll(".studio-asset-list").forEach((panel) => { panel.hidden = panel.id !== selected; });
          const selectedGlobalView = selected === "studio-assets-global" ? workbench.querySelector("#studio-assets-global") : null;
          if (selectedGlobalView && !selectedGlobalView.dataset.loaded && !selectedGlobalView.dataset.loading) {
            selectedGlobalView.dataset.loading = "true";
            void renderStudioSystemSettings(projectId, pageRequest, selectedGlobalView, {
              teamVersion: state.studioTeamVersion,
              onSaved: (detail) => workbench.dispatchEvent(new CustomEvent("studio-global-settings-saved", { detail }))
            }).finally(() => {
              delete selectedGlobalView.dataset.loading;
              if (selectedGlobalView.querySelector("[data-system-field]")) selectedGlobalView.dataset.loaded = "true";
            });
          }
        });
        tab.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          const next = assetTabs[(index + (event.key === "ArrowRight" ? 1 : assetTabs.length - 1)) % assetTabs.length];
          next.focus();
          next.click();
        });
      });
      assetDrawer?.setAttribute("aria-hidden", "true");
      const dragHandle = assetDrawer?.querySelector(".studio-asset-drawer-head");
      if (assetDrawer?.dataset.floatingPanelController !== "true") {
      let dragState = null;
      const moveAssetPanel = (left, top) => {
        if (!assetDrawer || !workbench) return;
        const host = workbench.getBoundingClientRect();
        const panel = assetDrawer.getBoundingClientRect();
        const maxLeft = Math.max(0, host.width - panel.width);
        const maxTop = Math.max(0, host.height - panel.height);
        assetDrawer.style.left = `${Math.min(maxLeft, Math.max(0, left))}px`;
        assetDrawer.style.top = `${Math.min(maxTop, Math.max(0, top))}px`;
        assetDrawer.style.right = "auto";
      };
      dragHandle?.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) return;
        undockPanelForDrag(assetDrawer, "asset");
        const host = workbench.getBoundingClientRect();
        const panel = assetDrawer.getBoundingClientRect();
        dragState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: panel.left - host.left, top: panel.top - host.top };
        dragHandle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      dragHandle?.addEventListener("pointermove", (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        moveAssetPanel(dragState.left + event.clientX - dragState.x, dragState.top + event.clientY - dragState.y);
      });
      const finishDrag = (event) => {
        if (dragState?.pointerId !== event.pointerId) return;
        dragState = null;
        dockPanelAfterDrag(assetDrawer, "asset");
      };
      dragHandle?.addEventListener("pointerup", finishDrag);
      dragHandle?.addEventListener("pointercancel", finishDrag);
      dragHandle?.addEventListener("keydown", (event) => {
        if (event.target.closest("button")) return;
        const delta = event.shiftKey ? 48 : 16;
        const moves = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
        if (!moves[event.key]) return;
        event.preventDefault();
        const host = workbench.getBoundingClientRect();
        const panel = assetDrawer.getBoundingClientRect();
        moveAssetPanel(panel.left - host.left + moves[event.key][0], panel.top - host.top + moves[event.key][1]);
      });
      }
      const buildDragHandle = buildPanel?.querySelector(".team-build-panel-head");
      if (buildPanel?.dataset.floatingPanelController !== "true") {
      let buildDrag = null;
      const moveBuildPanel = (left, top) => {
        if (!buildPanel || !workbench) return;
        const host = workbench.getBoundingClientRect();
        const panel = buildPanel.getBoundingClientRect();
        buildPanel.style.left = `${Math.min(Math.max(0, host.width - panel.width), Math.max(0, left))}px`;
        buildPanel.style.top = `${Math.min(Math.max(0, host.height - panel.height), Math.max(0, top))}px`;
        buildPanel.style.right = "auto";
      };
      buildDragHandle?.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) return;
        undockPanelForDrag(buildPanel, "build");
        const host = workbench.getBoundingClientRect();
        const panel = buildPanel.getBoundingClientRect();
        buildDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: panel.left - host.left, top: panel.top - host.top };
        buildDragHandle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      buildDragHandle?.addEventListener("pointermove", (event) => {
        if (!buildDrag || event.pointerId !== buildDrag.pointerId) return;
        moveBuildPanel(buildDrag.left + event.clientX - buildDrag.x, buildDrag.top + event.clientY - buildDrag.y);
      });
      const finishBuildDrag = (event) => {
        if (buildDrag?.pointerId !== event.pointerId) return;
        buildDrag = null;
        dockPanelAfterDrag(buildPanel, "build");
      };
      buildDragHandle?.addEventListener("pointerup", finishBuildDrag);
      buildDragHandle?.addEventListener("pointercancel", finishBuildDrag);
      buildDragHandle?.addEventListener("keydown", (event) => {
        const delta = event.shiftKey ? 48 : 16;
        const moves = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
        if (!moves[event.key]) return;
        event.preventDefault();
        const host = workbench.getBoundingClientRect();
        const panel = buildPanel.getBoundingClientRect();
        undockPanelForDrag(buildPanel, "build");
        moveBuildPanel(panel.left - host.left + moves[event.key][0], panel.top - host.top + moves[event.key][1]);
      });
      }
      const panelControllers = [
        createFloatingPanelController({
          panel: assetDrawer,
          host: workbench,
          header: assetDrawer?.querySelector(".studio-asset-drawer-head"),
          resizeHandle: assetDrawer?.querySelector(".studio-panel-resize-handle"),
          maximizeButton: assetMaximizeButton,
          minWidth: 320,
          minHeight: 300,
          isDocked: () => panelDockStates.asset?.docked,
          onUndock: () => undockPanelForDrag(assetDrawer, "asset"),
          onDrop: () => dockPanelAfterDrag(assetDrawer, "asset"),
          onResizeDock: (deltaX, startWidth) => {
            const nextWidth = Math.min(560, Math.max(320, startWidth - deltaX));
            workbench.style.setProperty("--studio-panel-dock-width", `${nextWidth}px`);
            panelDockStates.asset.floatingBounds = { ...panelDockStates.asset.floatingBounds, width: nextWidth };
            triggerCanvasRefit();
          },
          labels: { maximize: state.locale === "en" ? "Maximize team configuration" : "最大化团队配置", restore: state.locale === "en" ? "Restore team configuration" : "还原团队配置" },
          enableDrag: !isCompactPanelViewport(),
          enableResize: true
        }),
        createFloatingPanelController({
          panel: buildPanel,
          host: workbench,
          header: buildPanel?.querySelector(".team-build-panel-head"),
          resizeHandle: buildPanel?.querySelector(".studio-panel-resize-handle"),
          maximizeButton: buildMaximizeButton,
          minWidth: 320,
          minHeight: 320,
          isDocked: () => panelDockStates.build?.docked,
          onUndock: () => undockPanelForDrag(buildPanel, "build"),
          onDrop: () => dockPanelAfterDrag(buildPanel, "build"),
          onResizeDock: (deltaX, startWidth) => {
            const nextWidth = Math.min(560, Math.max(320, startWidth - deltaX));
            workbench.style.setProperty("--studio-panel-dock-width", `${nextWidth}px`);
            panelDockStates.build.floatingBounds = { ...panelDockStates.build.floatingBounds, width: nextWidth };
            triggerCanvasRefit();
          },
          labels: { maximize: state.locale === "en" ? "Maximize AI build" : "最大化 AI 构建", restore: state.locale === "en" ? "Restore AI build" : "还原 AI 构建" },
          enableDrag: !isCompactPanelViewport(),
          enableResize: true
        }),
        createFloatingPanelController({
          panel: debugPanel,
          host: workbench,
          header: debugPanel?.querySelector(".team-debug-panel-head"),
          resizeHandle: debugPanel?.querySelector(".studio-panel-resize-handle"),
          maximizeButton: debugMaximizeButton,
          minWidth: 320,
          minHeight: 320,
          isDocked: () => panelDockStates.debug?.docked,
          onUndock: () => undockPanelForDrag(debugPanel, "debug"),
          onDrop: () => dockPanelAfterDrag(debugPanel, "debug"),
          onResizeDock: (deltaX, startWidth) => {
            const nextWidth = Math.min(560, Math.max(320, startWidth - deltaX));
            workbench.style.setProperty("--studio-panel-dock-width", `${nextWidth}px`);
            panelDockStates.debug.floatingBounds = { ...panelDockStates.debug.floatingBounds, width: nextWidth };
            triggerCanvasRefit();
          },
          labels: { maximize: state.locale === "en" ? "Maximize debug panel" : "最大化调试面板", restore: state.locale === "en" ? "Restore debug panel" : "还原调试面板" },
          enableDrag: !isCompactPanelViewport(),
          enableResize: true,
          fullscreen: true
        })
      ];
      workbench._studioPanelControllers = panelControllers;
      [
        [assetDrawer, panelControllers[0]],
        [buildPanel, panelControllers[1]],
        [debugPanel, panelControllers[2]]
      ].forEach(([panel, controller]) => {
        if (panel && controller) panel._studioPanelController = controller;
      });
      root._studioDraftCleanup = () => {
        if (dockSplitRaf) {
          window.cancelAnimationFrame(dockSplitRaf);
          dockSplitRaf = null;
        }
        dockSplitDrag = null;
        workbench.classList.remove("is-split-dragging");
        window.removeEventListener("pointermove", onDockSplitPointerMove);
        window.removeEventListener("pointerup", finishDockSplitDrag);
        panelControllers.forEach((controller) => controller?.destroy?.());
        workbench._studioPanelControllers = [];
      };
    }
    const confirmedStatus = root.querySelector(".page-heading .project-status");
    if (confirmedStatus) {
      const status = teamStatusMeta(project.teamVersionStatus);
      confirmedStatus.textContent = status.label;
      confirmedStatus.title = status.hint;
    }
    const previewStatus = root.querySelector(".project-preview-panel .status-chip");
    if (previewStatus) previewStatus.textContent = teamStatusMeta(project.teamVersionStatus).label;
    const editorTitle = root.querySelector(".project-editor-panel .panel-head h2");
    if (editorTitle) editorTitle.textContent = state.locale === "en" ? "Define responsibilities and collaboration" : "定义职责与协作方式";
    root.querySelector(".project-editor-panel .section-kicker")?.replaceChildren(document.createTextNode(state.locale === "en" ? "Team configuration" : "团队配置"));
    localizeStudioDesignPage(root, state.locale, { confirmed, version: project.teamVersionNumber || 1 });
    if (state.studioRoute) {
      const graphStatus = root.querySelector("#project-design-status");
      const studioStatus = root.querySelector(".project-graph-preview > .project-status, #project-design-status .project-status");
      if (graphStatus && studioStatus && !graphStatus.contains(studioStatus)) {
        if (!graphStatus.querySelector(".studio-graph-status-text")) {
          const textSpan = document.createElement("span");
          textSpan.className = "studio-graph-status-text";
          textSpan.textContent = graphStatus.textContent || "";
          graphStatus.replaceChildren(textSpan);
        }
        graphStatus.append(document.createTextNode(" · "), studioStatus);
      }
    }
    buildPanel = workbench?.querySelector("#team-build-panel") || null;
    const buildOpenButton = graphPanel.querySelector('[data-studio-graph-action="chat-generate"]');
    debugPanel = workbench?.querySelector("#team-debug-dialog") || null;
    const setDebugView = (view) => {
      const next = view === "run" ? "run" : "config";
      debugPanel?.querySelectorAll("[data-debug-view]").forEach((tab) => {
        const active = tab.dataset.debugView === next;
        tab.setAttribute("aria-selected", String(active));
        tab.classList.toggle("active", active);
      });
      debugPanel?.querySelectorAll("[data-debug-view-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.debugViewPanel !== next;
      });
    };
    const syncDebugRunButton = (status = "idle") => {
      const button = debugPanel?.querySelector("#team-simulation-run");
      const stateLabel = debugPanel?.querySelector("[data-debug-run-state]");
      if (!button) return;
      const running = status === "running" || status === "stopping";
      button.dataset.running = String(running);
      button.classList.toggle("danger-button", running);
      button.classList.toggle("is-stopping", status === "stopping");
      button.disabled = status === "stopping";
      button.textContent = status === "stopping"
        ? (state.locale === "en" ? "Stopping…" : "正在停止…")
        : running
          ? (state.locale === "en" ? "Stop" : "停止")
          : status === "terminal"
            ? (state.locale === "en" ? "Debug again" : "重新调试")
            : (state.locale === "en" ? "Start debug run" : "开始调试");
      if (stateLabel) stateLabel.textContent = running
        ? (status === "stopping" ? (state.locale === "en" ? "stopping" : "正在停止") : (state.locale === "en" ? "running" : "运行中"))
        : "";
    };
    debugPanel?.querySelectorAll("[data-debug-view]").forEach((tab) => tab.addEventListener("click", () => setDebugView(tab.dataset.debugView)));
    setDebugView("config");
    const debugOpenButton = graphPanel.querySelector('[data-studio-graph-action="debug-run"]');
    const debugCloseButton = debugPanel?.querySelector("[data-team-debug-close]");
    const moveDebugPanel = (left, top) => {
      if (!debugPanel || !workbench) return;
      const host = workbench.getBoundingClientRect();
      const panel = debugPanel.getBoundingClientRect();
      debugPanel.style.left = `${Math.min(Math.max(0, host.width - panel.width), Math.max(0, left))}px`;
      debugPanel.style.top = `${Math.min(Math.max(0, host.height - panel.height), Math.max(0, top))}px`;
      debugPanel.style.right = "auto";
    };
    const closeDebugPanel = ({ focus = true } = {}) => {
      debugPanel?.classList.remove("is-open");
      debugPanel?.setAttribute("aria-hidden", "true");
      if (activeDockPanel === "debug") syncPanelDockLayout(null);
      if (typeof syncRuntimeDualCore === "function" && workbench?.classList.contains("is-runtime-dual-core")) {
        syncRuntimeDualCore({ active: true, preference: workbench.dataset.layoutPreference || "balanced", maximize: workbench.dataset.maximizeMode || "", microOpen: false });
      }
      debugOpenButton?.setAttribute("aria-expanded", "false");
      if (focus && debugOpenButton?.isConnected) debugOpenButton.focus({ preventScroll: true });
    };
    const openDebugPanel = () => {
      if (isCompactPanelViewport()) {
        buildPanel?.classList.remove("is-open");
        buildPanel?.setAttribute("aria-hidden", "true");
        assetDrawer?.classList.remove("is-open");
        assetDrawer?.setAttribute("aria-hidden", "true");
        assetToggle?.setAttribute("aria-expanded", "false");
      }
      debugPanel?.classList.add("is-open");
      syncPanelDockLayout("debug");
      debugPanel?.setAttribute("aria-hidden", "false");
      if (typeof syncRuntimeDualCore === "function" && workbench?.classList.contains("is-runtime-dual-core")) {
        syncRuntimeDualCore({ active: true, preference: workbench.dataset.layoutPreference || "balanced", maximize: workbench.dataset.maximizeMode || "", microOpen: true });
        setDebugView("run");
      }
      debugOpenButton?.setAttribute("aria-expanded", "true");
      if (state.isTeamGraphDirty?.()) state.showTeamGraphUnsavedDebugNotice?.();
      $("#team-simulation-input")?.focus({ preventScroll: true });
    };
    debugOpenButton?.addEventListener("click", () => openDebugPanel());
    const debugHead = debugPanel?.querySelector(".team-debug-panel-head");
    if (debugPanel?.dataset.floatingPanelController !== "true") {
    let debugDrag = null;
    debugHead?.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      undockPanelForDrag(debugPanel, "debug");
      const host = workbench.getBoundingClientRect();
      const panel = debugPanel.getBoundingClientRect();
      debugDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: panel.left - host.left, top: panel.top - host.top };
      debugHead.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    debugHead?.addEventListener("pointermove", (event) => {
      if (!debugDrag || event.pointerId !== debugDrag.pointerId) return;
      moveDebugPanel(debugDrag.left + event.clientX - debugDrag.x, debugDrag.top + event.clientY - debugDrag.y);
    });
    const finishDebugDrag = (event) => {
      if (debugDrag?.pointerId !== event.pointerId) return;
      debugDrag = null;
      dockPanelAfterDrag(debugPanel, "debug");
    };
    debugHead?.addEventListener("pointerup", finishDebugDrag);
    debugHead?.addEventListener("pointercancel", finishDebugDrag);
    debugHead?.addEventListener("keydown", (event) => {
      if (event.target.closest("button")) return;
      const delta = event.shiftKey ? 48 : 16;
      const moves = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
      if (!moves[event.key]) return;
      event.preventDefault();
      const host = workbench.getBoundingClientRect();
      const panel = debugPanel.getBoundingClientRect();
      moveDebugPanel(panel.left - host.left + moves[event.key][0], panel.top - host.top + moves[event.key][1]);
    });
    }
    debugCloseButton?.addEventListener("click", () => closeDebugPanel());
    debugPanel?.querySelector(".team-debug-panel-head strong")?.replaceChildren(document.createTextNode(state.locale === "en" ? "Debug" : "调试"));
    let assistantReady = false;
    state.teamStudioDialog = (tab = "assistant") => {
      if (tab === "run") openDebugPanel();
      else {
        if (isCompactPanelViewport()) {
          closeDebugPanel({ focus: false });
          assetDrawer?.classList.remove("is-open");
          assetDrawer?.setAttribute("aria-hidden", "true");
          assetToggle?.setAttribute("aria-expanded", "false");
        }
        buildPanel?.classList.add("is-open");
        buildPanel?.setAttribute("aria-hidden", "false");
        syncPanelDockLayout("build");
        buildOpenButton?.setAttribute("aria-expanded", "true");
      }
      if (tab !== "run" && !assistantReady) {
        assistantReady = true;
        void renderTeamAssistant(projectId, project, pageRequest);
      }
      if (tab === "run") $("#team-simulation-input")?.focus();
      else $("#team-assistant-input")?.focus();
    };
    root.querySelector("[data-team-build-close]")?.addEventListener("click", () => {
      buildPanel?.classList.remove("is-open");
      buildPanel?.setAttribute("aria-hidden", "true");
      if (activeDockPanel === "build") syncPanelDockLayout(null);
      buildOpenButton?.setAttribute("aria-expanded", "false");
      buildOpenButton?.focus({ preventScroll: true });
    });
    root.querySelector("#team-simulation-run")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (button.dataset.debugState === "terminal") {
        state.studioActiveRun = null;
        clearStudioActiveRun();
        setDebugView("config");
        const result = root.querySelector("#team-simulation-result");
        if (result) result.replaceChildren();
        syncDebugRunButton("idle");
      }
      if (button.dataset.running === "true") {
        if (!state.studioActiveRun) return;
        syncDebugRunButton("stopping");
        try {
          const stopResponse = await pageFetch(`/api/v1/teams/${encodeURIComponent(state.studioActiveRun.teamId)}/versions/${encodeURIComponent(state.studioActiveRun.teamVersionId)}/simulations/${encodeURIComponent(state.studioActiveRun.simulationId)}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: state.locale === "en" ? "Stopped from Studio" : "从 Studio 请求停止" }) });
          const stopPayload = await stopResponse.json();
          if (!stopResponse.ok) throw new Error(stopPayload.error || (state.locale === "en" ? "Unable to stop the run." : "停止运行失败。"));
        } catch (error) {
          if (isAbort(error)) return;
          syncDebugRunButton("running");
          showToast(error.message || (state.locale === "en" ? "Unable to stop the run." : "停止运行失败。"));
        }
        return;
      }
      const input = $("#team-simulation-input");
      if (!input?.value.trim()) { input?.focus(); return; }
      const mode = root.querySelector('input[name="studioSimulationMode"]:checked')?.value || "dry-run";
      const materials = $("#team-simulation-materials")?.value.trim() || "";
      const prompt = materials
        ? `${input.value.trim()}\n\n${state.locale === "en" ? "Additional materials:" : "补充资料："}\n${materials}`
        : input.value.trim();
      button.disabled = true;
      try { await state.runTeamStudioSimulation?.(prompt, mode); }
      finally { if (button.isConnected && button.dataset.running !== "true") button.disabled = false; }
    });
    const projectEditForm = $("#project-edit-form");
    $("#reconfirm-project")?.remove();
    bindDirtyForm(projectEditForm, () => setDirty("project-form"));
    projectEditForm?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/save`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), overview: form.get("overview"), expectedMetadataDigest: project.expectedMetadataDigest }) }); const payload = await result.json(); if (!isCurrentRequest(pageRequest)) return; $("#project-edit-status").textContent = result.ok ? (payload.unchanged ? "内容未变化，无需创建新版本。" : "已保存，团队版本处于设计中。") : (payload.error || (state.locale === "en" ? "Unable to save team information." : "保存失败")); if (result.ok) { clearDirty("project-form"); if (payload.createdDraft) { navigate(withCurrentSearch(`/studio/teams/${encodeURIComponent(payload.teamVersionId)}/design`)); return; } await renderProjectStudio(projectId, pageRequest); } });
    const mountReleasedVersion = async (button = null) => {
      const status = $("#team-mount-status");
      if (!collaborationProjectId) return false;
      if (button) button.disabled = true;
      status.hidden = false;
      status.textContent = state.locale === "en" ? "Team version released. Mounting it to the project…" : "版本已发布，正在挂载到项目…";
      try {
        const currentResponse = await pageFetch(`/api/v1/projects/${encodeURIComponent(collaborationProjectId)}/teams`);
        const current = await currentResponse.json();
        if (!currentResponse.ok) throw new Error(current.error || (state.locale === "en" ? "Unable to load the project's team configuration." : "无法读取项目团队配置"));
        const sourceTeamId = team.teamId || team.teamRootId || teamVersionId;
        const nextTeamVersionIds = (current.mountedTeams || [])
          .filter((item) => (item.teamId || item.teamVersionId) !== sourceTeamId)
          .map((item) => item.teamVersionId);
        nextTeamVersionIds.push(teamVersionId);
        const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(collaborationProjectId)}/teams`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ teamVersionIds: nextTeamVersionIds })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || (state.locale === "en" ? "Mount failed." : "挂载失败"));
        clearDirty("project-form");
        status.textContent = state.locale === "en" ? "Team version released and mounted." : "团队版本已发布并挂载。";
        navigate(`/projects/${encodeURIComponent(collaborationProjectId)}`);
        return true;
      } catch (error) {
        if (isAbort(error)) return false;
        status.textContent = state.locale === "en" ? `Team version released but not mounted: ${error.message || "Mount failed."}` : `团队版本已发布，但尚未挂载：${error.message || "挂载失败"}`;
        if (button) button.disabled = false;
        return false;
      }
    };
    const mountStatus = document.createElement("p");
    mountStatus.id = "team-mount-status";
    mountStatus.className = state.studioRoute ? "form-status studio-mount-status" : "form-status";
    mountStatus.setAttribute("role", "status");
    mountStatus.setAttribute("aria-live", "polite");
    mountStatus.hidden = true;
    if (state.studioRoute) {
      const workspaceNav = root.querySelector(".studio-workspace-nav");
      if (workspaceNav) workspaceNav.after(mountStatus);
      else root.append(mountStatus);
    } else {
      $("#project-edit-status")?.after(mountStatus);
    }
    if (collaborationProjectId && adjustmentParams.get("mount") === "1" && confirmed) {
      void mountReleasedVersion({ disabled: false });
    }
    const confirm = $("#confirm-project"); confirm?.addEventListener("click", () => navigate(`/studio/teams/${encodeURIComponent(projectId)}/release${location.search}`));
    if (collaborationProjectId && adjustmentParams.get("adjust") === "1") state.teamStudioDialog?.("assistant");
  } catch (error) { if (isAbort(error)) return; root.innerHTML = `<div class="run-error">${esc(error.message || (state.locale === "en" ? "Unable to load the team design." : "团队设计读取失败。"))}</div>`; }
}

function projectTaskStatusLabel(status) {
  return ({ queued: "待执行", running: "处理中", planning: "准备处理中", pause_requested: "正在暂停", waiting_review: "待人工审核", paused: "已暂停，可继续", completed: "已完成", failed: "处理失败", cancel_requested: "正在取消", cancelled: "已取消", deleted: "已删除" })[status] || status || "待执行";
}

function teamStudioErrorMarkup(message) {
  const detail = String(message || "团队操作暂时不可用");
  if (detail.includes("TEAM_ASSISTANT_MODEL_UNAVAILABLE")) {
    return '部署环境尚未发现可运行的 OpenCode 模型。请确认 OpenCode 已安装并登录，再到<a href="/platform" data-route="/platform">平台设置</a>刷新底座与模型后重试。';
  }
  if (detail.includes("TEAM_ASSISTANT_UNAVAILABLE") || /fetch failed/i.test(detail)) {
    return `团队助手无法连接 Visualizer。请启动 Visualizer，或在启动 Team Site 时将 OGS_VIS_URL 配置为可访问的服务地址。<br><small>${esc(detail)}</small> <a href="/platform" data-route="/platform">检查运行底座与模型</a>`;
  }
  return esc(detail);
}

function runProgress(run) {
  const stateSnapshot = run?.state || {};
  const explicit = Number(stateSnapshot.progress ?? run?.progress);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));
  const nodes = Object.values(stateSnapshot.nodes || {});
  const done = nodes.filter((node) => ["completed", "failed"].includes(node?.status)).length;
  return nodes.length ? Math.round((done / nodes.length) * 100) : 0;
}

function runEventSummary(eventsPayload) {
  return (eventsPayload?.events || []).slice(-4).reverse().map((entry) => {
    const record = entry?.record || entry || {};
    const event = record.event || record.type || record.status || "运行更新";
    const role = record.roleId || record.roleName || record.nodeId || "运行器";
    const detail = record.message || record.summary || record.error || record.selectedEvent || "状态已更新";
    return `<li><strong>${esc(role)}</strong><span>${esc(event)} · ${esc(detail)}</span></li>`;
  }).join("");
}

function renderTaskRunDetail(detail, run, eventsPayload) {
  if (!detail || !run) return;
  const status = run.state?.status || run.status || "planning";
  const progress = runProgress(run);
  const mode = run.plan?.executionPolicy?.mode || run.mode || "dry-run";
  const events = runEventSummary(eventsPayload);
  const summary = run.outputSummary || run.task?.outputSummary || "";
  const failure = run.state?.error || run.error || "";
  let fullResult;
  try { fullResult = detail.dataset.fullResult ? JSON.parse(detail.dataset.fullResult) : null; } catch { fullResult = detail.dataset.fullResult || ""; }
  const fullResultHtml = fullResult?.finalOutputsByRoleId
    ? renderRoleOutputs(fullResult.finalOutputsByRoleId, fullResult.finalOutputRoleOrder, "无文本输出")
    : (typeof fullResult === "string" ? `<pre>${esc(fullResult)}</pre>` : "");
  const workspaceUrl = professionalWorkspaceUrl(run.owner?.projectId || detail.dataset.projectId, run.runId);
  mountRunTeamGraph(detail.dataset.teamVersionId || run.teamVersionId || run.task?.teamVersionId, eventsPayload, detail.dataset.taskId || run.taskId);
  detail.dataset.runStatus = status;
  detail.innerHTML = `<div class="task-run-detail-head"><strong class="task-run-status">${esc(projectRunStatusLabel(status))}</strong><span class="task-run-mode-label run-mode-chip">${mode === "sandbox" ? "隔离运行" : "流程预览"}</span><span class="task-run-progress-label">${progress}%</span></div>${workspaceUrl ? `<p class="task-run-workspace-link"><a class="text-button" href="${esc(workspaceUrl)}"${/^https?:\/\//.test(workspaceUrl) ? ' target="_blank" rel="noopener"' : ""}>查看全流程</a></p>` : ""}<div class="task-run-progress" role="progressbar" aria-label="运行进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><ul class="task-run-events">${events || "<li><span>暂无事件摘要</span></li>"}</ul>${failure ? `<p class="task-run-failure" role="status">${esc(failure)}</p>` : ""}${summary ? `<section class="task-run-output"><strong>结果摘要</strong><pre>${esc(summary)}</pre></section>` : ""}<section class="task-run-output"><strong>完整结果</strong>${fullResultHtml || `<button class="text-button" type="button" data-load-run-result>读取完整结果</button>`}</section><p class="form-status task-run-error" role="status" aria-live="polite"></p>`;
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
  if (["queued", "failed"].includes(task.status)) actions.push(`<label class="task-run-mode"><span>运行方式</span><select data-task-mode="${esc(task.taskId)}"><option value="dry-run">流程预览</option><option value="sandbox">隔离运行</option></select></label>`);
  if (task.status === "queued") actions.push(`<button class="secondary-button" type="button" data-task-action="start" data-task-id="${esc(task.taskId)}">开始处理</button>`);
  if (task.status === "failed" && task.currentRunId) actions.push(`<button class="secondary-button" type="button" data-task-action="retry" data-task-id="${esc(task.taskId)}">重试此任务</button>`);
  if (["running", "planning", "waiting_review", "pause_requested"].includes(task.status)) actions.push(`<button class="secondary-button" type="button" data-task-action="pause" data-task-id="${esc(task.taskId)}">暂停</button>`);
  if (["pause_requested", "paused"].includes(task.status)) actions.push(`<button class="secondary-button" type="button" data-task-action="resume" data-task-id="${esc(task.taskId)}">继续</button>`);
  if (["waiting_review", "paused"].includes(task.status)) actions.push(`<button class="secondary-button" type="button" data-task-action="review" data-task-id="${esc(task.taskId)}">人工审核</button>`);
  if (["queued", "running", "planning", "pause_requested", "waiting_review", "paused", "cancel_requested"].includes(task.status)) actions.push(`<button class="secondary-button danger-button" type="button" data-task-action="cancel" data-task-id="${esc(task.taskId)}">取消</button>`);
  if (task.status !== "deleted") actions.push(`<button class="text-button task-delete-button" type="button" data-task-action="delete" data-task-id="${esc(task.taskId)}">删除</button>`);
  return `${actions.join("")}<p class="form-status task-action-status" role="status" aria-live="polite"></p>`;
}

async function openTaskReview(projectId, taskId, task = {}) {
  const pageRequest = state.activeRequest;
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement("dialog");
  dialog.className = "task-review-dialog";
  dialog.innerHTML = `<form method="dialog" class="task-review-form"><div class="panel-head"><div><span class="section-kicker">任务审核</span><h2>确认这次交付</h2></div><button class="text-button" value="cancel" aria-label="关闭">关闭</button></div><label>审核结果<select name="decision"><option value="approve">通过并继续</option><option value="rework">退回修改</option><option value="terminate">终止任务</option></select></label><label>给执行团队的反馈<textarea name="comment" rows="5" maxlength="4000" placeholder="说明通过条件、需要修改的内容或终止原因"></textarea></label><p class="form-status" id="task-review-status" role="status" aria-live="polite"></p><div class="form-actions"><button class="secondary-button" value="cancel">取消</button><button class="primary-button" value="submit">提交审核</button></div></form>`;
  document.body.append(dialog);
  let releaseTrap;
  let releaseScroll;
  const cleanup = () => {
    releaseTrap?.();
    releaseScroll?.();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    dialog.remove();
    if (activeTaskReviewClose === closeDialog) activeTaskReviewClose = null;
  };
  const closeDialog = (returnValue = "cancel") => {
    if (dialog.open) dialog.close(returnValue);
    else cleanup();
  };
  activeTaskReviewClose = closeDialog;
  dialog.showModal();
  releaseScroll = lockBodyScroll();
  releaseTrap = trapFocus(dialog, { initial: "select", onEscape: () => dialog.close("cancel") });
  const form = dialog.querySelector("form");
  const status = dialog.querySelector("#task-review-status");
  const context = document.createElement("section");
  context.className = "task-review-context";
  context.setAttribute("aria-live", "polite");
  context.innerHTML = '<p class="empty-note">Loading review request and Run events...</p>';
  form.querySelector("label")?.before(context);
  let reviews = [];
  let reviewIdSelect = null;
  try {
    const contextResponse = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/review`);
    const reviewContext = await contextResponse.json();
    if (!contextResponse.ok) throw new Error(reviewContext.error || "Unable to load review context.");
    reviews = reviewContext.reviews || [];
    const reviewSelect = document.createElement("label");
    reviewSelect.innerHTML = '<span>Review request</span><select name="reviewId"></select>';
    reviewIdSelect = reviewSelect.querySelector("select");
    reviewIdSelect.innerHTML = reviews.length ? reviews.map((review) => `<option value="${esc(review.reviewId)}">${esc(review.roleId || review.reviewId)} · ${esc(review.currentStatus)}${review.recoveryDecision ? " · recovery" : ""}</option>`).join("") : '<option value="">Latest task feedback</option>';
    form.querySelector("[name=decision]")?.closest("label")?.before(reviewSelect);
    const decisionSelect = form.querySelector("[name=decision]");
    const commentInput = form.querySelector("[name=comment]");
    const submitReview = form.querySelector('button[value="submit"]');
    const targetRoleLabel = document.createElement("label");
    targetRoleLabel.innerHTML = '<span>目标角色</span><select name="targetRoleId"></select>';
    const additionalBudgetLabel = document.createElement("label");
    additionalBudgetLabel.innerHTML = '<span>新增循环预算</span><input name="additionalBudget" type="number" min="1" step="1" />';
    form.querySelector("[name=comment]")?.closest("label")?.before(targetRoleLabel, additionalBudgetLabel);
    const updateReviewActions = () => {
      const selectedReview = reviews.find((review) => review.reviewId === reviewIdSelect.value);
      const recovering = Boolean(selectedReview?.recoveryDecision);
      const allowed = recovering ? [selectedReview.recoveryDecision] : selectedReview?.allowedDecisions || [];
      const previousDecision = decisionSelect.value;
      const focusWillBeDisabled = !allowed.length && document.activeElement === decisionSelect;
      decisionSelect.innerHTML = allowed.length
        ? allowed.map((decision) => `<option value="${esc(decision)}">${esc(({ approve: "Approve and continue", rework: "Return for revision", pause: "Pause", terminate: "Terminate", continue: "Continue with budget", reject: "Reject and route" })[decision] || decision)}</option>`).join("")
        : '<option value="" selected>No actions are available for this review request</option>';
      if (allowed.includes(previousDecision)) decisionSelect.value = previousDecision;
      if (recovering) {
        decisionSelect.value = selectedReview.recoveryDecision;
        commentInput.value = selectedReview.recoveryComment || "";
        commentInput.disabled = true;
      } else {
        commentInput.disabled = false;
      }
      decisionSelect.disabled = allowed.length === 0 || recovering;
      reviewIdSelect.disabled = recovering;
      const budget = selectedReview?.loopBudget || {};
      const targetRoles = decisionSelect.value === "rework"
        ? budget.reworkTargetRoleIds || []
        : decisionSelect.value === "reject"
          ? budget.rejectTargetRoleIds || []
          : budget.targetRoleIds || [];
      targetRoleLabel.hidden = selectedReview?.kind !== "loop_budget";
      additionalBudgetLabel.hidden = selectedReview?.kind !== "loop_budget" || decisionSelect.value === "reject" || decisionSelect.value === "terminate";
      const targetSelect = targetRoleLabel.querySelector("select");
      targetSelect.innerHTML = targetRoles.map((roleId) => `<option value="${esc(roleId)}">${esc(roleId)}</option>`).join("");
      targetSelect.disabled = targetRoles.length === 0 || recovering;
      additionalBudgetLabel.querySelector("input").disabled = additionalBudgetLabel.hidden || recovering;
      if (submitReview) submitReview.disabled = allowed.length === 0;
      if (focusWillBeDisabled) form.querySelector('button[value="cancel"]')?.focus({ preventScroll: true });
    };
    reviewIdSelect.addEventListener("change", updateReviewActions);
    updateReviewActions();
    let events = [];
    if (reviewContext.runId) {
      const eventsPayload = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(reviewContext.runId)}/events?limit=100`).then((item) => item.json());
      events = eventsPayload.events || [];
    }
    const reviewRows = reviews.map((review) => `<section><strong>${esc(review.roleId || "Review role")} · ${esc(review.currentStatus)}</strong><p>${esc(review.selectedEvent || "Human review checkpoint")}</p>${review.draftResult ? `<pre>${esc(JSON.stringify(review.draftResult, null, 2))}</pre>` : ""}${review.humanReviewContext ? `<pre>${esc(JSON.stringify(review.humanReviewContext, null, 2))}</pre>` : ""}</section>`).join("");
    const eventRows = events.slice(-12).reverse().map((entry) => {
      const record = entry.record || entry;
      return `<li><strong>${esc(record.roleId || record.nodeId || record.type || "Run event")}</strong> ${esc(record.message || record.summary || record.event || record.status || "Updated")}</li>`;
    }).join("");
    context.innerHTML = `<p class="panel-intro">Task ${esc(task.taskNumber || taskId)} · Run ${esc(reviewContext.runId || task.currentRunId || "n/a")} · ${esc(task.teamName || "Team")}</p>${reviews.some((review) => review.recoveryDecision) ? '<p class="form-status">A review decision was recorded; retry the same decision to finish Task recovery.</p>' : ""}${reviewRows || '<p class="empty-note">No active review request was returned. A decision cannot be submitted.</p>'}<h3>Recent events</h3><ul>${eventRows || "<li>No Run events available.</li>"}</ul>`;
  } catch (error) {
    const decisionSelect = form.querySelector("[name=decision]");
    const focusWillBeDisabled = document.activeElement === decisionSelect;
    decisionSelect.replaceChildren(new Option("No active review request", ""));
    decisionSelect.disabled = true;
    const submitReview = form.querySelector('button[value="submit"]');
    if (submitReview) submitReview.disabled = true;
    if (focusWillBeDisabled) form.querySelector('button[value="cancel"]')?.focus({ preventScroll: true });
    if (!isAbort(error)) context.innerHTML = `<p class="run-error">${esc(error.message || "Unable to load review context.")}</p>`;
  }
  form.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "submit") return;
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    const selectedReview = reviews.find((review) => review.reviewId === reviewIdSelect?.value);
    if (selectedReview?.recoveryDecision) {
      payload.reviewId = selectedReview.reviewId;
      payload.decision = selectedReview.recoveryDecision;
      payload.comment = selectedReview.recoveryComment || "";
    }
    if (!payload.reviewId) delete payload.reviewId;
    if (selectedReview?.kind !== "loop_budget") {
      delete payload.targetRoleId;
      delete payload.additionalBudget;
    } else if (!payload.targetRoleId) {
      delete payload.targetRoleId;
    }
    try {
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) { status.textContent = result.error || "审核提交失败"; return; }
      dialog.close("submit");
      if (isCurrentRequest(pageRequest)) {
        await renderProjectRun(projectId, pageRequest);
        const taskRow = $("#project-workspace-view")?.querySelector(`.task-record-row:has([data-task-id="${CSS.escape(String(taskId))}"])`);
        const taskStatus = taskRow?.querySelector(".status-chip");
        taskStatus?.setAttribute("tabindex", "-1");
        taskStatus?.focus({ preventScroll: true });
      }
    } catch (error) {
      if (isAbort(error)) return;
      status.textContent = error.message || "审核提交失败";
    }
  });
  dialog.addEventListener("close", cleanup, { once: true });
}

let activeTaskReviewClose = null;
function closeActiveDialogs() {
  closeDrawer();
  closeMobileNav();
  closeTopbarMore();
  activeTaskReviewClose?.("route");
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
        navigate(`/studio/teams/${encodeURIComponent(payload.teamVersion.teamVersionId || payload.sourceTeamVersionId)}/design?collaborationProjectId=${encodeURIComponent(projectId)}&adjust=1&edit=1`);
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
  bindDirtyForm(collaborationTaskForm, () => setDirty("collaboration-task-form"));
  root.querySelector("[data-open-task-dialog]")?.addEventListener("click", () => collaborationTaskDialog?.showModal());
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
    const submit = form.querySelector("button[type=submit]");
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.idempotencyKey = createUuid();
    submit.disabled = true;
    status.textContent = "正在添加任务...";
    try {
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!isCurrentRequest(pageRequest)) return;
      if (!response.ok) { status.textContent = taskActionErrorMessage(result.error); return; }
      clearDirty("collaboration-task-form");
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
    const requestedMode = root.querySelector(`[data-task-mode="${CSS.escape(taskId)}"]`)?.value || "dry-run";
    const rowStatus = button.closest(".task-record-row")?.querySelector(".task-action-status");
    try {
      if (["start", "retry"].includes(action)) {
        const ready = await confirmTeamRuntimeReadiness(task?.teamVersionId, undefined, pageRequest);
        if (!ready) {
          if (rowStatus && isCurrentRequest(pageRequest)) rowStatus.textContent = state.locale === "en" ? "Run cancelled; review the team role model bindings before retrying." : "已取消运行；请检查团队角色模型配置后重试。";
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
    navigate(`/studio/teams/${encodeURIComponent(projectId)}/design`);
  } catch (error) { if (isAbort(error)) return; root.innerHTML = `<div class="run-error">${esc(error.message || "运行工作区读取失败")}</div>`; }
}

function syncRoute() {
  disposeStudioGraphs();
  const pageRequest = beginPageRequest();
  const currentPath = location.pathname.replace(/\/$/, "") || "/";
  const path = currentPath;
  const landing = path === "/";
  $("#landing-view")?.classList.toggle("hidden", !landing);
  if (landing) {
    $("#app-shell").classList.add("hidden");
    if (!$("#landing-case-grid")?.children?.length) renderCases();
    return;
  }
  state.studioRoute = path === "/studio" || path.startsWith("/studio/");
  $("#app-shell").classList.remove("hidden");
  const detailMatch = path.match(/^\/cases\/([a-z0-9-]+)$/);
  if (detailMatch) {
    const item = state.cases.find((entry) => entry.id === detailMatch[1]);
    if (item) { $$(".main-area > .page-content").forEach((page) => page.classList.add("hidden")); $("#case-detail-view").classList.remove("hidden"); state.selected = item.id; renderDetail(item); return; }
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
  const studioDesignMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/design$/);
  if (studioDesignMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "B", renderProjectStudio(studioDesignMatch[1], pageRequest));
    return;
  }
  const studioInfoMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/info$/);
  if (studioInfoMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "D", renderStudioTeamInfo(studioInfoMatch[1], pageRequest));
    return;
  }
  const studioReleaseMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/release$/);
  if (studioReleaseMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "D", renderStudioReleaseGate(studioReleaseMatch[1], pageRequest));
    return;
  }
  const studioArtifactsMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/run\/([a-z0-9-]+)\/artifacts$/);
  if (studioArtifactsMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "C", renderStudioArtifactsPage(studioArtifactsMatch[1], studioArtifactsMatch[2], pageRequest));
    return;
  }
  const studioRunDetailMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/run\/([a-z0-9-]+)$/);
  if (studioRunDetailMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "C", renderStudioRunDetail(studioRunDetailMatch[1], studioRunDetailMatch[2], pageRequest));
    return;
  }
  const studioRunMatch = path.match(/^\/studio\/teams\/([a-z0-9-]+)\/run$/);
  if (studioRunMatch) {
    setView("studio");
    renderPageFrame($("#studio-view"), "C", renderStudioRunPage(studioRunMatch[1], pageRequest));
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
  if (path === "/teams" && new URLSearchParams(location.search).has("team")) {
    const id = new URLSearchParams(location.search).get("team");
    if (state.cases.some((entry) => entry.id === id)) state.selected = id;
  }
  if (path === "/projects") { state.view = "projects"; void renderCollaborationProjects(pageRequest); }
  else if (path === "/teams") { state.view = "workspace"; void renderProjectLibrary(pageRequest); }
  else if (path === "/studio") { state.view = "studio"; renderPageFrame($("#studio-view"), "A", renderStudioOverview(pageRequest)); }
  else if (path === "/platform/role-sources") { state.view = "platform"; renderPageFrame($("#platform-view"), "D", renderPlatformRoleSources($("#platform-view"), state.locale)); }
  else if (path === "/platform" || path === "/platform/models") { state.view = "platform"; renderPageFrame($("#platform-view"), "D", renderPlatformConfig(pageRequest)); }
  else if (path === "/examples") state.view = "examples";
  else if (path === "/history") { state.view = "history"; const historyView = $("#history-view"); if (historyView) historyView.dataset.template = "A"; void renderHistory(pageRequest); }
  else if (path === "/examples") frameExistingPage($("#examples-view"), "A");
  setView(state.view);
  if (!["/projects", "/teams", "/studio", "/studio/roles", "/platform", "/platform/models", "/platform/role-sources", "/examples", "/history"].includes(path) && !detailMatch && !projectRunMatch && !projectTeamsMatch && !studioDesignMatch && !studioInfoMatch && !studioReleaseMatch && !studioRunMatch && !studioRunDetailMatch && !/^\/studio\/teams\/[a-z0-9-]+\/run\/[a-z0-9-]+\/artifacts$/.test(path) && path !== "/studio/new" && path !== "/projects/new") { history.replaceState({}, "", "/projects"); router.syncCurrentPath(); syncRoute(); }
}
let drawerReleaseTrap;
let drawerReleaseScroll;
function openDrawer(trigger = document.activeElement) {
  const drawer = $("#run-drawer");
  if (!drawer) return;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  if (!drawerReleaseTrap) {
    drawer._trigger = trigger instanceof HTMLElement ? trigger : null;
    drawerReleaseScroll = lockBodyScroll("drawer-open");
    drawerReleaseTrap = trapFocus(drawer.querySelector(".drawer-panel"), { initial: "[data-close-drawer]", onEscape: closeDrawer });
  }
}
function closeDrawer() {
  const drawer = $("#run-drawer");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  drawerReleaseTrap?.();
  drawerReleaseScroll?.();
  drawerReleaseTrap = null;
  drawerReleaseScroll = null;
  const trigger = drawer._trigger;
  drawer._trigger = null;
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
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

function openRun(result, item, prompt, id = createUuid()) {
  const audit = result.auditTrail || [];
  const outputMap = result.finalOutputsByRoleId || {};
  const dryRun = Object.values(outputMap).flat().some((output) => typeof output?.content === "string" && output.content.startsWith("[dry-run]"));
  const content = dryRun ? `<p>${esc(copy[state.locale].dryOutput)}</p>` : renderRoleOutputs(outputMap, result.finalOutputRoleOrder, copy[state.locale].noOutput);
  const title = dryRun ? copy[state.locale].runResult : copy[state.locale].finalDelivery;
  const timeline = audit.map((entry) => `<div class="timeline-item"><span class="timeline-marker"></span><div class="timeline-copy"><strong>${esc(text(item.roles.find((role) => role.id === entry.roleId)?.label) || copy[state.locale].fallbackEvent)} · ${esc(labelEvent(entry.selectedEvent))}</strong><span>${esc(copy[state.locale].roleStatus)}${entry.durationMs ? ` · ${Math.round(entry.durationMs)} ms` : ""}</span></div></div>`).join("");
  $("#run-content").innerHTML = `<section class="run-summary"><div class="run-summary-top"><h3>${esc(text(item.title))}</h3><span class="run-mode">${esc(copy[state.locale].simulation)}</span></div><div class="run-metrics"><div><strong>${audit.length}</strong><span>${esc(copy[state.locale].rolesCompleted)}</span></div><div><strong>${esc(result.summary?.totalTransitions ?? audit.length)}</strong><span>${esc(copy[state.locale].transitions)}</span></div><div><strong>${(result.durationMs / 1000).toFixed(1)}s</strong><span>${esc(copy[state.locale].elapsed)}</span></div></div><h3 class="output-heading">${esc(title)}</h3><div class="run-output">${content}</div></section><section class="timeline"><h3>${esc(copy[state.locale].timeline)}</h3><div class="timeline-list">${timeline}</div></section><p class="run-disclaimer">${esc(copy[state.locale].footerNote)}</p>`;
  openDrawer();
  if (id) state.history = [{ id, caseId: item.id, prompt, title: text(item.title), durationMs: result.durationMs, status: result.status, createdAt: new Date().toISOString(), result }, ...state.history.filter((entry) => entry.id !== id)].slice(0, 12);
}
async function runSelected() {
  const item = state.cases.find((entry) => entry.id === state.selected);
  const prompt = $("#task-input").value.trim();
  if (!prompt) { $("#task-input").focus(); showToast(copy[state.locale].inputRequired); return; }
  const button = $("#run-button"); button.disabled = true;
  const trigger = document.activeElement;
  $("#run-content").innerHTML = `<div class="run-loading"><span class="spinner"></span><span>${esc(copy[state.locale].running)}</span></div>`; openDrawer(trigger);
  try {
    const response = await pageFetch("/api/v1/demo-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: item.id, prompt, locale: state.locale }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || copy[state.locale].networkError);
    if (result.status !== "done") throw new Error(`${copy[state.locale].runFailed}: ${result.status || "unknown"}`);
    openRun(result, item, prompt);
    clearDirty("task-input");
  } catch (error) { if (isAbort(error)) return; $("#run-content").innerHTML = `<div class="run-error">${esc(error.message || copy[state.locale].networkError)}</div>`; }
  finally { button.disabled = false; }
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
    if (event.key === "Escape") {
      closeTopbarMore();
      const problemsDrawer = document.querySelector("#studio-problems-drawer:not([hidden])");
      if (problemsDrawer) problemsDrawer.hidden = true;
      const artifactDrawer = document.querySelector("#studio-simulation-artifact-drawer:not([hidden])");
      if (artifactDrawer) artifactDrawer.hidden = true;
      const closeAssetBtn = document.querySelector("#studio-asset-drawer:not([aria-hidden='true']) #studio-asset-drawer-close");
      if (closeAssetBtn) closeAssetBtn.click();
      const closeDebugBtn = document.querySelector("#team-debug-dialog:not([aria-hidden='true']) [data-team-debug-close]");
      if (closeDebugBtn) closeDebugBtn.click();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      const studioSave = document.querySelector("[data-studio-save-workspace]:not([disabled])");
      if (studioSave && studioSave.offsetParent !== null) {
        event.preventDefault();
        studioSave.click();
        return;
      }
      const activeForm = document.querySelector(".page-content:not(.hidden) form:not([inert])");
      const submitBtn = activeForm?.querySelector('button[type="submit"]:not([disabled])');
      if (submitBtn) {
        event.preventDefault();
        submitBtn.click();
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      const debugRunBtn = document.querySelector("#team-simulation-run:not([disabled])");
      if (debugRunBtn && debugRunBtn.offsetParent !== null) {
        event.preventDefault();
        debugRunBtn.click();
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "0") {
      const resetViewBtn = document.querySelector('[data-studio-graph-action="reset-view"]');
      if (resetViewBtn) {
        event.preventDefault();
        resetViewBtn.click();
      }
    }
  });
  window.electronAPI?.onMenuCommand?.((command) => {
    const actions = {
      "menu-save-draft": [
        '[data-studio-graph-action="save"]:not([disabled])',
        "[data-studio-save-workspace]:not([disabled])"
      ],
      "menu-run-debug": ["#team-simulation-run:not([disabled])"],
      "menu-reset-view": ['[data-studio-graph-action="reset-view"]']
    };
    for (const selector of actions[command] || []) {
      const action = document.querySelector(selector);
      if (action) {
        action.click();
        break;
      }
    }
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
  await loadCopy();
  ensureViewElements();
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
  state.selected = state.cases[0]?.id;
  router.install();
  $("#locale-toggle")?.addEventListener("click", () => { state.locale = state.locale === "zh-CN" ? "en" : "zh-CN"; try { localStorage.setItem("ogs-locale", state.locale); } catch {} applyLocale(); });
  $("#landing-locale")?.addEventListener("click", () => { state.locale = state.locale === "zh-CN" ? "en" : "zh-CN"; try { localStorage.setItem("ogs-locale", state.locale); } catch {} applyLocale(); });
  $$('[data-site-theme-choice]').forEach((button) => button.addEventListener("click", () => applySiteTheme(button.dataset.siteThemeChoice)));
  $("#site-theme-toggle")?.addEventListener("click", () => applySiteTheme(document.documentElement.dataset.visualizerTheme === "dark" ? "light" : "dark"));
  $("#product-mode-toggle")?.addEventListener("click", () => setProductMode(document.documentElement.dataset.productMode === "professional" ? "normal" : "professional"));
  $("#task-input")?.addEventListener("input", () => { updateCount(); setDirty("task-input"); }); $("#run-button")?.addEventListener("click", runSelected);
  $("#edit-task-button")?.addEventListener("click", () => { $("#task-input")?.focus(); $("#workspace-view")?.scrollTo({ top: 0, behavior: "smooth" }); });
  $("#clear-history")?.addEventListener("click", () => { state.history = []; try { localStorage.removeItem("ogs-run-history"); } catch {} renderHistory(); });
  $$('[data-close-drawer]').forEach((element) => element.addEventListener("click", closeDrawer));
  applyLocale();
  const team = new URLSearchParams(location.search).get("team"); if (team && state.cases.some((item) => item.id === team)) state.selected = team;
  if (!isProjectRoute() && $("#task-input")) selectCase(state.selected);
  updateCount();
}
export { openDrawer, closeDrawer, openTaskReview };

export function bootstrap() {
  return init().catch((error) => { document.body.innerHTML = `<main class="fatal-error">${esc(error.message)}</main>`; });
}
