const state = { cases: [], eventLabels: {}, selected: null, locale: localStorage.getItem("ogs-locale") || "zh-CN", view: "workspace", history: readHistory() };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const text = (value) => value?.[state.locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = { code: "⌘", medical: "✚", scales: "⚖" };
const copy = {
  "zh-CN": {
    homeCases: "经典团队", homeStudio: "在线体验", homeCta: "开始体验", homeEyebrow: "为复杂工作，组织一支 AI 团队", homeTitle: "让不同专长，<br>协作成一个结果。", homeIntro: "从清楚的目标开始，让合适的成员各司其职、交接信息，并共同完成可检查的成果。", homePrimary: "在线运行示例", homeSecondary: "浏览经典团队", homeProof: "真实运行流程 · 无需注册 · 中英文示例", visualTitle: "从不同观点，到共同交付", visualStatus: "协作中", visualTask: "一个清楚的目标", visualTaskSub: "给团队共同的方向", visualRoleOne: "工程规划", visualRoleOneSub: "实现与依赖", visualRoleTwo: "体验设计", visualRoleTwoSub: "流程与细节", visualRoleThree: "质量把关", visualRoleThreeSub: "验收与风险", visualResult: "汇成一份完整方案", visualResultSub: "意见 · 依据 · 下一步", visualFooter: "分工清楚，过程可追踪", homeCasesEyebrow: "三种真实的协作方式", homeCasesTitle: "从经典团队开始", homeAllCases: "查看全部案例 →", promiseKicker: "面向真实工作", promiseTitle: "过程清楚，交付有据。", promiseOne: "每位成员有明确职责", promiseOneBody: "从目标拆解到结果整合，每一步都有负责的人。", promiseTwo: "工作交接看得见", promiseTwoBody: "随时了解谁在处理、信息如何流转。", promiseThree: "结果可以逐步检查", promiseThreeBody: "回看各方意见、汇总过程和最终输出。", homeFooter: "为复杂工作构建协作团队", homeFooterCta: "进入在线工作台 →",
    workspaceName: "个人工作台", workspaceType: "访客空间", navTeams: "团队工作台", navExamples: "经典团队", navRuns: "最近运行", runtimeReady: "运行服务就绪", crumbHome: "首页", guestMode: "访客体验", eyebrow: "在线团队工作台", pageTitle: "把复杂任务，交给一支有分工的团队", pageIntro: "从一个目标开始。选择团队案例，查看协作路径，再运行一次完整流程。", metaLabel: "本次体验", metaValue: "完整团队流程 · 结果可回看", taskLabel: "你想完成什么？", taskHint: "先选一个团队案例，也可以改写任务目标", taskPlaceholder: "例如：为一款记账工具制定首版研发方案", charCount: "/ 1,200", runDemo: "运行团队示例", chooseCase: "选择一种协作方式", caseHeading: "经典团队案例", allExamples: "查看团队详情", teamPlan: "团队如何协作", temporaryConfig: "访客预览", adjustWithChat: "编辑任务", membersTitle: "团队成员", membersSubtitle: "每位成员负责一项工作", roleReady: "待开始", memberCompleted: "已完成", flowTitle: "协作路径", flowSubtitle: "从任务输入到最终交付", legendRole: "团队成员", legendFlow: "工作交接", taskInputNode: "任务", deliveryNode: "成果", splitNote: "成员按职责交接，并在汇总时整合所需信息。", capabilityKicker: "清楚 · 有序 · 可回看", capabilityTitle: "每一次协作，都有迹可循", capabilityBody: "团队按职责交接工作，运行过程保留时间线，成果可以逐步检查。", capabilityOne: "明确成员职责", capabilityOneBody: "每位成员有清晰的工作范围", capabilityTwo: "逐步整合意见", capabilityTwoBody: "各方结果按团队安排汇总", capabilityThree: "回看交付过程", capabilityThreeBody: "进度、结果和交接记录可查", footerNote: "公开体验展示完整的团队协作过程，不调用模型或生成业务交付内容。", libraryEyebrow: "经典团队案例", libraryTitle: "团队如何协作", libraryIntro: "浏览不同团队的背景、分工和预期成果。", caseBackground: "场景背景", caseProblem: "适合解决", caseCollaboration: "协作过程", caseDeliverable: "预期成果", caseRoles: "团队分工", openCase: "查看案例详情", useCase: "使用这个团队", backCases: "返回全部团队", detailEyebrow: "经典团队案例", runHistoryEyebrow: "最近运行", historyTitle: "最近运行", historyIntro: "本机浏览器临时保存的体验记录。", clearHistory: "清空记录", noHistory: "还没有运行记录。选择一个案例并运行团队示例。", historyRestore: "查看运行", runPanelKicker: "团队运行", runPanelTitle: "运行结果", running: "正在运行团队流程…", runFailed: "运行未完成", simulation: "流程预览", rolesCompleted: "角色执行", transitions: "任务交接", elapsed: "耗时", finalDelivery: "最终成果", runResult: "预览说明", dryOutput: "本次预览展示团队如何分工与交接工作，不调用真实角色模型，也不会生成业务交付内容。", timeline: "运行时间线", noOutput: "团队没有返回最终交付内容。", historyDone: "已完成", selected: "当前团队", close: "关闭", inputRequired: "请先输入任务目标。", networkError: "暂时无法连接运行服务，请稍后重试。", promptCopied: "已载入案例任务，可继续修改。", inputEvent: "收到任务", outputEvent: "流程完成", roleStatus: "已完成", fallbackEvent: "工作已更新"
  },
  en: {
    homeCases: "Classic teams", homeStudio: "Live preview", homeCta: "Explore the preview", homeEyebrow: "A team for complex work", homeTitle: "Bring different strengths<br>together around one result.", homeIntro: "Start with a clear goal. Give each member a defined responsibility, pass work between them, and create an outcome you can review.", homePrimary: "Run an example", homeSecondary: "Explore classic teams", homeProof: "Real workflow run · No sign-up · English and Chinese", visualTitle: "Different perspectives, one delivery", visualStatus: "Working together", visualTask: "A clear shared goal", visualTaskSub: "One direction for the team", visualRoleOne: "Engineering plan", visualRoleOneSub: "Build and dependencies", visualRoleTwo: "Experience design", visualRoleTwoSub: "Flow and details", visualRoleThree: "Quality review", visualRoleThreeSub: "Acceptance and risks", visualResult: "One complete proposal", visualResultSub: "Views · Evidence · Next steps", visualFooter: "Clear ownership. Visible progress.", homeCasesEyebrow: "Three practical ways to collaborate", homeCasesTitle: "Start with a classic team", homeAllCases: "Browse all cases →", promiseKicker: "Built for real work", promiseTitle: "Clear process. Reviewable results.", promiseOne: "Every member has a clear role", promiseOneBody: "Each step has an owner, from framing the task to assembling the result.", promiseTwo: "Handoffs stay visible", promiseTwoBody: "See who is working and how information moves through the team.", promiseThree: "Results are easy to review", promiseThreeBody: "Revisit each view, the synthesis, and the final output.", homeFooter: "Teams for complex work", homeFooterCta: "Open the team workspace →",
    workspaceName: "My workspace", workspaceType: "Guest space", navTeams: "Team workspace", navExamples: "Classic teams", navRuns: "Recent runs", runtimeReady: "Service ready", crumbHome: "Home", guestMode: "Guest preview", eyebrow: "Online team workspace", pageTitle: "Give complex work to a team with clear roles", pageIntro: "Start with a goal. Choose a team, inspect how it works, then run the complete flow.", metaLabel: "This preview", metaValue: "Complete team workflow · Reviewable results", taskLabel: "What would you like to accomplish?", taskHint: "Choose a team example or rewrite the task", taskPlaceholder: "For example: plan the first release of a bookkeeping tool", charCount: "/ 1,200", runDemo: "Run team example", chooseCase: "Choose how to collaborate", caseHeading: "Classic team examples", allExamples: "Explore team details", teamPlan: "How this team works", temporaryConfig: "Guest preview", adjustWithChat: "Edit task", membersTitle: "Team members", membersSubtitle: "Each member owns a part of the work", roleReady: "Ready", memberCompleted: "Completed", flowTitle: "Collaboration flow", flowSubtitle: "From task input to final delivery", legendRole: "Team member", legendFlow: "Work handoff", taskInputNode: "Task", deliveryNode: "Outcome", splitNote: "Members hand off work by responsibility and bring the needed information together.", capabilityKicker: "Clear · Ordered · Reviewable", capabilityTitle: "Every collaboration leaves a trail", capabilityBody: "Members hand off work by responsibility. A timeline captures progress, and you can review each result.", capabilityOne: "Clear member ownership", capabilityOneBody: "Each member has a defined scope", capabilityTwo: "Views brought together", capabilityTwoBody: "Results are assembled according to the team plan", capabilityThree: "Review the process", capabilityThreeBody: "Progress, results, and handoffs stay visible", footerNote: "The public preview demonstrates a complete team workflow. It does not call models or generate business deliverables.", libraryEyebrow: "Classic team examples", libraryTitle: "How teams work together", libraryIntro: "Explore each team's context, responsibilities, and expected outcome.", caseBackground: "Background", caseProblem: "When to use it", caseCollaboration: "How the team works", caseDeliverable: "Expected outcome", caseRoles: "Team responsibilities", openCase: "View case details", useCase: "Use this team", backCases: "All teams", detailEyebrow: "Classic team example", runHistoryEyebrow: "Recent runs", historyTitle: "Recent runs", historyIntro: "Preview history stored temporarily in this browser.", clearHistory: "Clear history", noHistory: "No run history yet. Choose a case and run the team example.", historyRestore: "View run", runPanelKicker: "Team run", runPanelTitle: "Run result", running: "Running the team workflow…", runFailed: "Run did not complete", simulation: "Workflow preview", rolesCompleted: "Role executions", transitions: "Handoffs", elapsed: "Duration", finalDelivery: "Final delivery", runResult: "Preview details", dryOutput: "This preview shows how the team divides and hands off work. It does not call role models or generate a business deliverable.", timeline: "Run timeline", noOutput: "The team returned no final delivery content.", historyDone: "Completed", selected: "Selected team", close: "Close", inputRequired: "Enter a task to run.", networkError: "The runtime is temporarily unavailable. Try again shortly.", promptCopied: "Example task loaded. You can edit it before running.", inputEvent: "Task received", outputEvent: "Workflow complete", roleStatus: "Completed", fallbackEvent: "Work updated"
  }
};

Object.assign(copy["zh-CN"], {
  homeCases: "团队协作",
  homeSecondary: "浏览典型协作案例",
  homeProof: "可运行团队示例 · 无需注册 · 中英文支持",
  homeCasesEyebrow: "三类常见协作场景",
  homeCasesTitle: "从典型团队协作开始",
  homeAllCases: "查看全部协作案例 →",
  navExamples: "协作案例",
  caseHeading: "典型团队协作",
  pageIntro: "从一个目标开始。选择团队案例，了解成员之间如何协作，再运行一次完整流程。",
  membersSubtitle: "成员各有专长，分工完成任务",
  allExamples: "查看案例详情",
  libraryEyebrow: "典型团队协作案例",
  libraryTitle: "团队协作案例",
  libraryIntro: "浏览不同协作场景的背景、分工和预期成果。",
  detailEyebrow: "典型团队协作案例",
  flowTitle: "协作关系",
  flowSubtitle: "成员之间如何分工与衔接",
  caseScenario: "示例任务"
});
Object.assign(copy.en, {
  homeCases: "Team collaboration",
  homeSecondary: "Explore representative examples",
  homeProof: "Runnable team examples · No sign-up · Bilingual",
  homeCasesEyebrow: "Three common collaboration scenarios",
  homeCasesTitle: "Explore representative team workflows",
  homeAllCases: "Browse all collaboration examples →",
  navExamples: "Collaboration examples",
  caseHeading: "Representative team collaboration",
  pageIntro: "Start with a goal. Choose a team, see how members work together, then run the complete example.",
  membersSubtitle: "Each member brings a specialty to the shared task",
  allExamples: "Explore case details",
  libraryEyebrow: "Representative collaboration examples",
  libraryTitle: "Team collaboration examples",
  libraryIntro: "Explore the context, responsibilities, and expected outcomes for each scenario.",
  detailEyebrow: "Representative collaboration example",
  flowTitle: "Team relationships",
  flowSubtitle: "How members divide and connect their work",
  caseScenario: "Example task"
});

function readHistory() { try { return JSON.parse(localStorage.getItem("ogs-run-history") || "[]"); } catch { return []; } }
function saveHistory() { localStorage.setItem("ogs-run-history", JSON.stringify(state.history.slice(0, 12))); }
function localized(value) { return text(value); }
function labelEvent(event) { const value = state.eventLabels[event]; return value ? value[state.locale === "zh-CN" ? 0 : 1] : copy[state.locale].fallbackEvent; }
function taskExample(item) {
  const tasks = {
    "software-team": { "zh-CN": "为一款面向自由职业者的记账工具制定首版研发方案，覆盖核心体验、技术拆分与验收标准。", en: "Plan the first release of a bookkeeping tool for independent professionals, covering core experience, engineering, and acceptance criteria." },
    "expert-consultation": { "zh-CN": "梳理一位患者反复头痛且伴短暂视物模糊的资料，列出需要补充的信息与紧急风险信号。", en: "Review a case of recurring headache with brief blurred vision, noting missing information and urgent risk signals." },
    "structured-debate": { "zh-CN": "讨论一家 30 人的公司是否应采用每周三天到办公室的混合办公政策。", en: "Debate whether a 30-person company should adopt a hybrid policy requiring three office days per week." }
  };
  return tasks[item.id]?.[state.locale] || "";
}
function caseIcon(item) { return `<span class="case-icon case-icon-${esc(item.icon)}" aria-hidden="true">${icon[item.icon] || "✦"}</span>`; }
function renderCases() {
  const card = (item, landing = false) => `<article class="${landing ? "landing-case-card" : "library-card"}" data-accent="${esc(item.accent)}"><a class="case-card-link" href="/cases/${esc(item.id)}" data-route="/cases/${esc(item.id)}">${caseIcon(item)}<span class="case-card-category">${esc(text(item.category))}</span><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><span class="case-more">${esc(copy[state.locale].openCase)} <span aria-hidden="true">→</span></span></a></article>`;
  $("#landing-case-grid").innerHTML = state.cases.map((item) => card(item, true)).join("");
  $("#library-grid").innerHTML = state.cases.map((item) => card(item)).join("");
  $("#case-grid").innerHTML = state.cases.map((item) => `<button class="case-card ${item.id === state.selected ? "selected" : ""}" data-case="${esc(item.id)}" data-accent="${esc(item.accent)}" type="button">${caseIcon(item)}<span class="case-selected">${item.id === state.selected ? esc(copy[state.locale].selected) : esc(text(item.category))}</span><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><span class="case-card-foot">${esc(text(item.duration))}<span aria-hidden="true">→</span></span></button>`).join("");
  $$('[data-case]').forEach((button) => button.addEventListener("click", () => selectCase(button.dataset.case)));
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
  stage.dataset.case = item.id;
  stage.setAttribute("aria-label", state.locale === "zh-CN" ? `${text(item.title)}协作关系图` : `${text(item.title)} team relationship diagram`);
  $(".graph-foot span[data-i18n='splitNote']").textContent = text(item.detail.relationship);
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(item.id)}/graph?locale=${encodeURIComponent(state.locale)}`);
    const viewModel = await response.json();
    if (!response.ok) throw new Error(viewModel.error || "Unable to load the team graph.");
    if (state.selected !== item.id) return;
    window.OGSStudioGraphBundle.mountStudioX6Bridge(stage, {
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
  } catch (error) {
    stage.textContent = error.message || "Unable to load the team graph.";
  }
}

const graphLabels = {
  "zh-CN": {
    viewportGroup: "图谱视图", zoomOut: "缩小", zoomIn: "放大", resetView: "重置缩放", fullscreen: "全屏", fitView: "适应画布", autoLayout: "自动布局", layoutModeFlow: "流程布局", layoutModeCompact: "紧凑布局", layoutModeStacked: "分层布局", topologyOrder: "关系顺序", enabled: "开启", disabled: "关闭", generate: "生成与运行", editGroup: "编辑图谱", minimap: "图谱导航", exportSvg: "导出 SVG", exportPng: "导出 PNG", boundaryEntry: "任务", boundaryEnd: "成果", graphReady: "图谱已载入", quickOpen: "快速定位", quickOpenPlaceholder: "搜索角色或协作关系", quickOpenEmpty: "没有匹配的角色或协作关系。", quickOpenRole: "角色", quickOpenFlow: "协作关系"
  },
  en: {
    viewportGroup: "Graph view", zoomOut: "Zoom out", zoomIn: "Zoom in", resetView: "Reset zoom", fullscreen: "Fullscreen", fitView: "Fit graph", autoLayout: "Auto layout", layoutModeFlow: "Flow layout", layoutModeCompact: "Compact layout", layoutModeStacked: "Layered layout", topologyOrder: "Flow order", enabled: "On", disabled: "Off", generate: "Generate and run", editGroup: "Graph editing", minimap: "Graph navigator", exportSvg: "Export SVG", exportPng: "Export PNG", boundaryEntry: "Task", boundaryEnd: "Outcome", graphReady: "Graph loaded", quickOpen: "Quick locate", quickOpenPlaceholder: "Search roles or relationships", quickOpenEmpty: "No matching roles or relationships.", quickOpenRole: "Role", quickOpenFlow: "Relationship"
  }
};
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
    <a class="detail-back" href="/studio" data-route="/studio">← ${esc(copy[state.locale].backCases)}</a>
    <header class="detail-heading" data-accent="${esc(item.accent)}">
      <div>${caseIcon(item)}<span class="eyebrow">${esc(copy[state.locale].detailEyebrow)} · ${esc(text(item.category))}</span></div>
      <h1>${esc(text(item.title))}</h1><p>${esc(text(item.short))}</p>
      <a class="primary-button" href="/studio?team=${esc(item.id)}" data-use-case="${esc(item.id)}">${esc(copy[state.locale].useCase)} <span aria-hidden="true">→</span></a>
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
  $$('[data-use-case]').forEach((element) => element.addEventListener("click", (event) => { event.preventDefault(); selectCase(element.dataset.useCase); navigate("/studio"); }));
}
function applyLocale() {
  document.documentElement.lang = state.locale;
  $$('[data-i18n]').forEach((element) => { const value = copy[state.locale][element.dataset.i18n]; if (value) element.innerHTML = value; });
  $$('[data-i18n-placeholder]').forEach((element) => { const value = copy[state.locale][element.dataset.i18nPlaceholder]; if (value) element.placeholder = value; });
  $$("#locale-toggle, #landing-locale").forEach((button) => { button.textContent = state.locale === "zh-CN" ? "EN" : "中文"; });
  renderCases();
  renderSelected(state.cases.find((item) => item.id === state.selected));
  renderHistory();
  syncRoute();
}
function updateCount() { $("#input-count").textContent = $("#task-input").value.length; }
function setView(view) {
  state.view = view;
  const viewMap = { workspace: "workspace-view", examples: "examples-view", history: "history-view" };
  Object.entries(viewMap).forEach(([key, id]) => $(`#${id}`).classList.toggle("hidden", key !== view));
  $("#case-detail-view").classList.add("hidden");
  $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const nav = $(`.nav-item[data-view="${view}"] [data-i18n]`);
  $("#breadcrumb-current").textContent = nav?.textContent || copy[state.locale].navTeams;
}
function navigate(path) { history.pushState({}, "", path); syncRoute(); window.scrollTo({ top: 0, behavior: "instant" }); }
function syncRoute() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const landing = path === "/";
  $("#landing-view").classList.toggle("hidden", !landing);
  $("#app-shell").classList.toggle("hidden", landing);
  if (landing) return;
  const detailMatch = path.match(/^\/cases\/([a-z0-9-]+)$/);
  if (detailMatch) {
    const item = state.cases.find((entry) => entry.id === detailMatch[1]);
    if (item) { $("#workspace-view").classList.add("hidden"); $("#examples-view").classList.add("hidden"); $("#history-view").classList.add("hidden"); $("#case-detail-view").classList.remove("hidden"); state.selected = item.id; renderDetail(item); return; }
    navigate("/studio"); return;
  }
  if (path === "/studio" && new URLSearchParams(location.search).has("team")) {
    const id = new URLSearchParams(location.search).get("team");
    if (state.cases.some((entry) => entry.id === id)) state.selected = id;
  }
  if (path === "/studio") state.view = "workspace";
  else if (path === "/examples") state.view = "examples";
  else if (path === "/history") state.view = "history";
  setView(state.view);
  if (!["/studio", "/examples", "/history", "/cases"].includes(path)) history.replaceState({}, "", "/studio");
}
function openDrawer() { $("#run-drawer").classList.add("open"); $("#run-drawer").setAttribute("aria-hidden", "false"); document.body.classList.add("drawer-open"); }
function closeDrawer() { $("#run-drawer").classList.remove("open"); $("#run-drawer").setAttribute("aria-hidden", "true"); document.body.classList.remove("drawer-open"); }
function openRun(result, item, prompt, id = crypto.randomUUID()) {
  const audit = result.auditTrail || [];
  const finalOutput = result.finalOutput;
  const dryRun = typeof finalOutput === "string" && finalOutput.startsWith("[dry-run]");
  const content = dryRun ? copy[state.locale].dryOutput : (typeof finalOutput === "string" ? finalOutput : finalOutput?.content || JSON.stringify(finalOutput ?? "", null, 2));
  const title = dryRun ? copy[state.locale].runResult : copy[state.locale].finalDelivery;
  const timeline = audit.map((entry) => `<div class="timeline-item"><span class="timeline-marker"></span><div class="timeline-copy"><strong>${esc(text(item.roles.find((role) => role.id === entry.roleId)?.label) || copy[state.locale].fallbackEvent)} · ${esc(labelEvent(entry.selectedEvent))}</strong><span>${esc(copy[state.locale].roleStatus)}${entry.durationMs ? ` · ${Math.round(entry.durationMs)} ms` : ""}</span></div></div>`).join("");
  $("#run-content").innerHTML = `<section class="run-summary"><div class="run-summary-top"><h3>${esc(text(item.title))}</h3><span class="run-mode">${esc(copy[state.locale].simulation)}</span></div><div class="run-metrics"><div><strong>${audit.length}</strong><span>${esc(copy[state.locale].rolesCompleted)}</span></div><div><strong>${esc(result.summary?.totalTransitions ?? audit.length)}</strong><span>${esc(copy[state.locale].transitions)}</span></div><div><strong>${(result.durationMs / 1000).toFixed(1)}s</strong><span>${esc(copy[state.locale].elapsed)}</span></div></div><h3 class="output-heading">${esc(title)}</h3><div class="run-output">${esc(content || copy[state.locale].noOutput)}</div></section><section class="timeline"><h3>${esc(copy[state.locale].timeline)}</h3><div class="timeline-list">${timeline}</div></section><p class="run-disclaimer">${esc(copy[state.locale].footerNote)}</p>`;
  openDrawer();
  if (id) {
    state.history = [{ id, caseId: item.id, prompt, title: text(item.title), durationMs: result.durationMs, status: result.status, createdAt: new Date().toISOString(), result }, ...state.history.filter((entry) => entry.id !== id)].slice(0, 12);
    saveHistory(); renderHistory();
  }
}
async function runSelected() {
  const item = state.cases.find((entry) => entry.id === state.selected);
  const prompt = $("#task-input").value.trim();
  if (!prompt) { $("#task-input").focus(); showToast(copy[state.locale].inputRequired); return; }
  const button = $("#run-button"); button.disabled = true;
  $("#run-content").innerHTML = `<div class="run-loading"><span class="spinner"></span><span>${esc(copy[state.locale].running)}</span></div>`; openDrawer();
  try {
    const response = await fetch("/api/demo-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: item.id, prompt, locale: state.locale }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || copy[state.locale].networkError);
    if (result.status !== "done") throw new Error(`${copy[state.locale].runFailed}: ${result.status || "unknown"}`);
    openRun(result, item, prompt);
  } catch (error) { $("#run-content").innerHTML = `<div class="run-error">${esc(error.message || copy[state.locale].networkError)}</div>`; }
  finally { button.disabled = false; }
}
function renderHistory() {
  const root = $("#history-list"); if (!root) return;
  if (!state.history.length) { root.innerHTML = `<div class="history-empty">${esc(copy[state.locale].noHistory)}</div>`; return; }
  root.innerHTML = state.history.map((entry) => { const item = state.cases.find((candidate) => candidate.id === entry.caseId); return `<article class="history-row"><span class="history-icon">✓</span><div><strong>${esc(item ? text(item.title) : entry.title)}</strong><p>${esc(entry.prompt)} · ${new Date(entry.createdAt).toLocaleString(state.locale)}</p></div><button class="text-button" type="button" data-history="${esc(entry.id)}">${esc(copy[state.locale].historyRestore)}</button></article>`; }).join("");
  $$('[data-history]').forEach((button) => button.addEventListener("click", () => { const entry = state.history.find((item) => item.id === button.dataset.history); const item = state.cases.find((candidate) => candidate.id === entry?.caseId); if (entry && item) openRun(entry.result, item, entry.prompt, null); }));
}
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2300); }
async function init() {
  const response = await fetch("/api/cases"); if (!response.ok) throw new Error("Unable to load team cases.");
  const payload = await response.json();
  state.cases = payload.cases || [];
  state.eventLabels = payload.eventLabels || {};
  state.selected = state.cases[0]?.id;
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-route]");
    if (!link) return;
    event.preventDefault(); navigate(link.getAttribute("href"));
  });
  window.addEventListener("popstate", syncRoute);
  $$("button.nav-item[data-view]").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; history.pushState({}, "", `/${state.view}`); syncRoute(); }));
  $$("#locale-toggle, #landing-locale").forEach((button) => button.addEventListener("click", () => { state.locale = state.locale === "zh-CN" ? "en" : "zh-CN"; localStorage.setItem("ogs-locale", state.locale); applyLocale(); }));
  $("#task-input").addEventListener("input", updateCount); $("#run-button").addEventListener("click", runSelected);
  $("#edit-task-button").addEventListener("click", () => { $("#task-input").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("#clear-history").addEventListener("click", () => { state.history = []; saveHistory(); renderHistory(); });
  $$('[data-close-drawer]').forEach((element) => element.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
  applyLocale();
  const team = new URLSearchParams(location.search).get("team"); if (team && state.cases.some((item) => item.id === team)) state.selected = team;
  selectCase(state.selected); syncRoute(); updateCount();
}
init().catch((error) => { document.body.innerHTML = `<main class="fatal-error">${esc(error.message)}</main>`; });
