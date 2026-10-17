const state = { cases: [], eventLabels: {}, selected: null, locale: localStorage.getItem("ogs-locale") || "zh-CN", view: "workspace", history: [], projectId: null, visUrl: "http://127.0.0.1:4177", recentRuns: [] };
function professionalWorkspaceUrl(projectId, panel = "design", runId = "") {
  try {
    const url = new URL(String(state.visUrl || ""));
    if (!/^https?:$/.test(url.protocol)) return "";
    if (projectId) url.searchParams.set("projectId", projectId);
    if (runId) url.searchParams.set("runId", runId);
    if (panel) url.searchParams.set("panel", panel);
    return url.toString();
  } catch {
    return "";
  }
}
function bindProfessionalWorkspaceLink(link, projectId, panel = "design", runId = "") {
  if (!link) return;
  const href = professionalWorkspaceUrl(projectId, panel, runId);
  if (href) {
    link.href = href;
    return;
  }
  link.href = "#";
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showToast(state.locale === "en" ? "The advanced workspace is temporarily unavailable." : "高级工作台暂时不可用");
  });
}
const themeStorageKey = "ogs.visualizer.theme";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const text = (value) => value?.[state.locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = { code: "⌘", medical: "✚", scales: "⚖" };
const copy = {
  "zh-CN": {
    homeCases: "团队仓库", homeStudio: "在线体验", homeCta: "开始体验", homeEyebrow: "为复杂工作，组织一支 AI 团队", homeTitle: "让专业分工，<br>协作交付结果。", homeIntro: "从清晰目标开始，定义职责角色与交接方式；每项责任由配置的执行者承担，共同产出可检查的结果。", homePrimary: "在线运行示例", homeProof: "真实运行流程 · 无需注册 · 中英文示例", visualTitle: "专业分工，协作交付", visualStatus: "协作中", visualTask: "一个清楚的目标", visualTaskSub: "让团队朝同一个目标推进", visualRoleOne: "工程规划", visualRoleOneSub: "实现与依赖", visualRoleTwo: "体验设计", visualRoleTwoSub: "流程与细节", visualRoleThree: "质量把关", visualRoleThreeSub: "验收与风险", visualResult: "汇成一份共同成果", visualResultSub: "职责 · 交接 · 下一步", visualFooter: "职责清晰，协作有序，过程可追踪", homeCasesEyebrow: "三种真实的协作方式", homeCasesTitle: "从团队仓库开始", homeAllCases: "查看全部案例 →", promiseKicker: "面向真实工作", promiseTitle: "过程清楚，交付有据。", promiseOne: "每位成员有明确职责", promiseOneBody: "从目标拆解到结果整合，每一步都有负责的人。", promiseTwo: "工作交接看得见", promiseTwoBody: "随时了解谁在处理、信息如何流转。", promiseThree: "结果可以逐步检查", promiseThreeBody: "回看各方意见、汇总过程和最终输出。", homeFooter: "为复杂工作构建协作团队", homeFooterCta: "进入在线工作台 →",
    workspaceName: "个人工作台", workspaceType: "访客空间", navTeams: "团队仓库", navExamples: "团队工厂", navRuns: "最近运行", runtimeReady: "运行服务就绪", crumbHome: "首页", guestMode: "访客体验", eyebrow: "团队仓库", pageTitle: "把复杂任务，交给一支有分工的团队", pageIntro: "从一个目标开始。选择团队案例，查看协作路径，再运行一次完整流程。", metaLabel: "本次体验", metaValue: "完整团队流程 · 结果可回看", taskLabel: "你想完成什么？", taskHint: "先选一个团队案例，也可以改写任务目标", taskPlaceholder: "例如：为一款记账工具制定首版研发方案", charCount: "/ 1,200", runDemo: "运行团队示例", chooseCase: "选择一种协作方式", caseHeading: "典型协作案例", allExamples: "查看团队详情", teamPlan: "团队如何协作", temporaryConfig: "访客预览", adjustWithChat: "编辑任务", membersTitle: "团队成员", membersSubtitle: "每位成员负责一项工作", roleReady: "待开始", memberCompleted: "已完成", flowTitle: "协作路径", flowSubtitle: "从任务输入到最终交付", legendRole: "团队成员", legendFlow: "工作交接", taskInputNode: "任务", deliveryNode: "成果", splitNote: "成员按职责交接，并在汇总时整合所需信息。", capabilityKicker: "清楚 · 有序 · 可回看", capabilityTitle: "每一次协作，都有迹可循", capabilityBody: "团队按职责交接工作，运行过程保留时间线，成果可以逐步检查。", capabilityOne: "明确成员职责", capabilityOneBody: "每位成员有清晰的工作范围", capabilityTwo: "逐步整合意见", capabilityTwoBody: "各方结果按团队安排汇总", capabilityThree: "回看交付过程", capabilityThreeBody: "进度、结果和交接记录可查", footerNote: "公开体验展示完整的团队协作过程，不调用模型或生成业务交付内容。", libraryEyebrow: "团队仓库案例", libraryTitle: "典型协作案例", libraryIntro: "浏览不同团队的背景、分工和预期成果。", caseBackground: "场景背景", caseProblem: "适合解决", caseCollaboration: "协作过程", caseDeliverable: "预期成果", caseRoles: "团队分工", openCase: "查看案例详情", useCase: "使用这个团队", backCases: "返回全部团队", detailEyebrow: "团队仓库案例", runHistoryEyebrow: "最近运行", historyTitle: "最近运行", historyIntro: "本机浏览器临时保存的体验记录。", clearHistory: "清空记录", noHistory: "还没有运行记录。选择一个案例并运行团队示例。", historyRestore: "查看运行", runPanelKicker: "团队运行", runPanelTitle: "运行结果", running: "正在运行团队流程…", runFailed: "运行未完成", simulation: "流程预览", rolesCompleted: "角色执行", transitions: "任务交接", elapsed: "耗时", finalDelivery: "最终成果", runResult: "预览说明", dryOutput: "本次预览展示团队如何分工与交接工作，不调用真实角色模型，也不会生成业务交付内容。", timeline: "运行时间线", noOutput: "团队没有返回最终交付内容。", historyDone: "已完成", selected: "当前团队", close: "关闭", inputRequired: "请先输入任务目标。", networkError: "暂时无法连接运行服务，请稍后重试。", promptCopied: "已载入案例任务，可继续修改。", inputEvent: "收到任务", outputEvent: "流程完成", roleStatus: "已完成", fallbackEvent: "工作已更新"
  },
  en: {
    homeCases: "Team repository", homeStudio: "Live preview", homeCta: "Explore the preview", homeEyebrow: "A team for complex work", homeTitle: "Specialized roles<br>working toward one delivery.", homeIntro: "Start with a clear goal. Define responsibility roles and handoffs; configured executors perform each responsibility and produce a reviewable outcome.", homePrimary: "Run an example", homeProof: "Real workflow run · No sign-up · English and Chinese", visualTitle: "Specialized roles, one shared delivery", visualStatus: "Working together", visualTask: "A clear shared goal", visualTaskSub: "One direction for the whole team", visualRoleOne: "Engineering plan", visualRoleOneSub: "Build and dependencies", visualRoleTwo: "Experience design", visualRoleTwoSub: "Flow and details", visualRoleThree: "Quality review", visualRoleThreeSub: "Acceptance and risks", visualResult: "One shared outcome", visualResultSub: "Ownership · Handoffs · Next steps", visualFooter: "Clear roles. Coordinated work. Visible progress.", homeCasesEyebrow: "Three practical ways to collaborate", homeCasesTitle: "Start from the team repository", homeAllCases: "Browse all cases →", promiseKicker: "Built for real work", promiseTitle: "Clear process. Reviewable results.", promiseOne: "Every member has a clear role", promiseOneBody: "Each step has an owner, from framing the task to assembling the result.", promiseTwo: "Handoffs stay visible", promiseTwoBody: "See who is working and how information moves through the team.", promiseThree: "Results are easy to review", promiseThreeBody: "Revisit each view, the synthesis, and the final output.", homeFooter: "Teams for complex work", homeFooterCta: "Open the team workspace →",
    workspaceName: "My workspace", workspaceType: "Guest space", navTeams: "Team repository", navExamples: "Team factory", navRuns: "Recent runs", runtimeReady: "Service ready", crumbHome: "Home", guestMode: "Guest preview", eyebrow: "Online team workspace", pageTitle: "Give complex work to a team with clear roles", pageIntro: "Start with a goal. Choose a team, inspect how it works, then run the complete flow.", metaLabel: "This preview", metaValue: "Complete team workflow · Reviewable results", taskLabel: "What would you like to accomplish?", taskHint: "Choose a team example or rewrite the task", taskPlaceholder: "For example: plan the first release of a bookkeeping tool", charCount: "/ 1,200", runDemo: "Run team example", chooseCase: "Choose how to collaborate", caseHeading: "Practical collaboration examples", allExamples: "Explore team details", teamPlan: "How this team works", temporaryConfig: "Guest preview", adjustWithChat: "Edit task", membersTitle: "Team members", membersSubtitle: "Each member owns a part of the work", roleReady: "Ready", memberCompleted: "Completed", flowTitle: "Collaboration flow", flowSubtitle: "From task input to final delivery", legendRole: "Team member", legendFlow: "Work handoff", taskInputNode: "Task", deliveryNode: "Outcome", splitNote: "Members hand off work by responsibility and bring the needed information together.", capabilityKicker: "Clear · Ordered · Reviewable", capabilityTitle: "Every collaboration leaves a trail", capabilityBody: "Members hand off work by responsibility. A timeline captures progress, and you can review each result.", capabilityOne: "Clear member ownership", capabilityOneBody: "Each member has a defined scope", capabilityTwo: "Views brought together", capabilityTwoBody: "Results are assembled according to the team plan", capabilityThree: "Review the process", capabilityThreeBody: "Progress, results, and handoffs stay visible", footerNote: "The public preview demonstrates a complete team workflow. It does not call models or generate business deliverables.", libraryEyebrow: "Team repository examples", libraryTitle: "How teams work together", libraryIntro: "Explore each team's context, responsibilities, and expected outcome.", caseBackground: "Background", caseProblem: "When to use it", caseCollaboration: "How the team works", caseDeliverable: "Expected outcome", caseRoles: "Team responsibilities", openCase: "View case details", useCase: "Use this team", backCases: "All teams", detailEyebrow: "Team repository example", runHistoryEyebrow: "Recent runs", historyTitle: "Recent runs", historyIntro: "Preview history stored temporarily in this browser.", clearHistory: "Clear history", noHistory: "No run history yet. Choose a case and run the team example.", historyRestore: "View run", runPanelKicker: "Team run", runPanelTitle: "Run result", running: "Running the team workflow…", runFailed: "Run did not complete", simulation: "Workflow preview", rolesCompleted: "Role executions", transitions: "Handoffs", elapsed: "Duration", finalDelivery: "Final delivery", runResult: "Preview details", dryOutput: "This preview shows how the team divides and hands off work. It does not call role models or generate a business deliverable.", timeline: "Run timeline", noOutput: "The team returned no final delivery content.", historyDone: "Completed", selected: "Selected team", close: "Close", inputRequired: "Enter a task to run.", networkError: "The runtime is temporarily unavailable. Try again shortly.", promptCopied: "Example task loaded. You can edit it before running.", inputEvent: "Task received", outputEvent: "Workflow complete", roleStatus: "Completed", fallbackEvent: "Work updated"
  }
};
Object.assign(copy["zh-CN"], {
  navProjects: "协作项目", navPlatform: "平台配置",
  homeIntro: "从清晰目标开始，定义职责角色与交接方式；每项责任由配置的执行者承担，共同产出可检查的结果。",
  promiseOne: "每个职责都有清晰边界",
  promiseOneBody: "从目标拆解到结果整合，每项责任都在流程中明确。",
  membersTitle: "团队职责",
  membersSubtitle: "图中展示职责角色；实际执行者由配置决定",
  legendRole: "职责角色",
  splitNote: "职责角色按流程交接工作，并在汇总时整合所需信息。",
  capabilityOne: "明确职责边界",
  capabilityOneBody: "每个角色都有清晰的责任范围",
  readinessTitle: "隔离运行配置检查",
  readinessReady: "基础配置检查通过。外部服务连通性和凭据会在执行时验证。",
  readinessBlocked: "存在 {count} 个待处理项。请先修复配置；流程预览仍可使用。",
  readinessUnavailable: "暂时无法读取配置检查结果。开始隔离运行前会再次校验。",
  sandboxBlocked: "隔离运行 · 配置未就绪",
  readinessStateReady: "静态检查通过",
  readinessStateBlocked: "未就绪 · {count}",
  readinessStateUnknown: "检查暂不可用",
  readinessConfirmed: "结构已确认",
  readinessUnconfirmed: "结构未确认"
});
Object.assign(copy.en, {
  navProjects: "Collaboration projects", navPlatform: "Platform settings",
  homeIntro: "Start with a clear goal. Define responsibility roles and handoffs; configured executors perform each responsibility and produce a reviewable outcome.",
  promiseOne: "Every responsibility has a clear boundary",
  promiseOneBody: "Each responsibility is explicit, from framing the task to assembling the result.",
  membersTitle: "Team responsibilities",
  membersSubtitle: "The graph shows responsibility roles; configured executors perform them",
  legendRole: "Responsibility role",
  splitNote: "Responsibility roles hand off work through the flow and bring needed information together.",
  capabilityOne: "Clear responsibility boundaries",
  capabilityOneBody: "Each role has a defined scope of responsibility",
  readinessTitle: "Isolated run configuration check",
  readinessReady: "Basic configuration checks passed. Provider connectivity and credentials are checked during execution.",
  readinessBlocked: "{count} items need attention. Flow preview remains available while you resolve them.",
  readinessUnavailable: "Configuration check is unavailable. The server will validate again before an isolated run.",
  sandboxBlocked: "Isolated run · Configuration not ready",
  readinessStateReady: "Static checks passed",
  readinessStateBlocked: "Not ready · {count}",
  readinessStateUnknown: "Check unavailable",
  readinessConfirmed: "Structure confirmed",
  readinessUnconfirmed: "Structure not confirmed"
});
function syncThemeControls(theme = document.documentElement.dataset.visualizerTheme || "light") {
  const labels = state.locale === "zh-CN" ? { light: "浅色", dark: "深色" } : { light: "Light", dark: "Dark" };
  $$(".theme-switch").forEach((group) => group.setAttribute("aria-label", state.locale === "zh-CN" ? "显示模式" : "Display mode"));
  $$("[data-site-theme-choice]").forEach((button) => {
    const choice = button.dataset.siteThemeChoice;
    const active = choice === theme;
    button.textContent = labels[choice];
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
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
  homeCases: "团队协作",
  homeProof: "可运行团队示例 · 无需注册 · 中英文支持",
  homeCasesEyebrow: "三类常见协作场景",
  homeCasesTitle: "从典型团队协作开始",
  homeAllCases: "查看全部协作案例 →",
  navExamples: "团队工厂",
  caseHeading: "典型团队协作",
  pageIntro: "从一个目标开始。选择团队案例，了解成员之间如何协作，再运行一次完整流程。",
  membersSubtitle: "成员各有专长，分工完成任务",
  allExamples: "查看案例详情",
  libraryEyebrow: "团队仓库案例",
  libraryTitle: "典型协作案例",
  libraryIntro: "浏览不同协作场景的背景、分工和预期成果。",
  detailEyebrow: "典型团队协作案例",
  flowTitle: "协作关系",
  flowSubtitle: "成员之间如何分工与衔接",
  caseScenario: "示例任务"
});
Object.assign(copy.en, {
  homeCases: "Team collaboration",
  homeProof: "Runnable team examples · No sign-up · Bilingual",
  homeCasesEyebrow: "Three common collaboration scenarios",
  homeCasesTitle: "Explore representative team workflows",
  homeAllCases: "Browse all collaboration examples →",
  navExamples: "Team factory",
  caseHeading: "Representative team collaboration",
  pageIntro: "Start with a goal. Choose a team, see how members work together, then run the complete example.",
  membersSubtitle: "Each member brings a specialty to the shared task",
  allExamples: "Explore case details",
  libraryEyebrow: "Team repository examples",
  libraryTitle: "Released team versions",
  libraryIntro: "Explore the context, responsibilities, and expected outcomes for each scenario.",
  detailEyebrow: "Representative collaboration example",
  flowTitle: "Team relationships",
  flowSubtitle: "How members divide and connect their work",
  caseScenario: "Example task"
});
Object.assign(copy["zh-CN"], {
  navTeams: "团队仓库", navExamples: "团队工厂", libraryEyebrow: "团队仓库", libraryTitle: "已发布团队版本",
  libraryIntro: "选择已经发布的团队版本创建项目。团队结构和项目工作目录分开管理。", factoryEyebrow: "团队工厂",
  factoryTitle: "创建、编辑和调试团队", factoryIntro: "在这里通过对话或专业编辑完善团队，发布后才会进入团队仓库。",
  noReleasedTeams: "还没有已发布的团队版本", noFactoryTeams: "团队工厂还是空的", createTeam: "创建团队",
  continueEditing: "继续编辑", editAsVersion: "编辑为新版本", releaseVersion: "发布版本", archiveVersion: "归档版本",
  exportAsset: "导出团队", versionLabel: "版本", releasedLabel: "已发布", editingLabel: "编辑中", draftLabel: "草案",
  archivedLabel: "已归档", useTeam: "使用团队创建项目", createProject: "创建项目", repositoryEmptyHint: "先在团队工厂创建并发布一支团队。",
  factoryEmptyHint: "从一句话开始，创建你的第一支团队。", runRound: "第 {round} 轮", clearHistory: "清理本机缓存",
  historyIntro: "按项目轮次查看团队运行结果。清理只影响本机缓存，不会删除项目记录。",
  noHistory: "还没有项目运行记录。完成一次项目运行后，这里会显示团队、版本和轮次。",
  targetHint: "请包含目标、角色关系、大致流程、输入材料和期望输出，便于自动生成团队结构。",
  releaseTeam: "发布团队版本 →", advancedWorkspace: "打开专业工作台"
});
Object.assign(copy.en, {
  navTeams: "Team repository", navExamples: "Team factory", libraryEyebrow: "Team repository", libraryTitle: "Released team versions",
  libraryIntro: "Choose a released team version when creating a project. Team design and project workspaces stay separate.", factoryEyebrow: "Team factory",
  factoryTitle: "Create, edit, and debug teams", factoryIntro: "Use conversation or the professional editor to refine a team. Publish it before using it in a project.",
  noReleasedTeams: "No released team versions yet", noFactoryTeams: "The team factory is empty", createTeam: "Create team",
  continueEditing: "Continue editing", editAsVersion: "Edit as new version", releaseVersion: "Release version", archiveVersion: "Archive version",
  exportAsset: "Export team", versionLabel: "Version", releasedLabel: "Released", editingLabel: "Editing", draftLabel: "Draft",
  archivedLabel: "Archived", useTeam: "Create project with team", createProject: "Create project", repositoryEmptyHint: "Create and release a team in the team factory first.",
  factoryEmptyHint: "Start with one sentence to create your first team.", runRound: "Round {round}", clearHistory: "Clear local cache",
  historyIntro: "Review team runs by project round. Clearing only affects this browser cache, not project records.",
  noHistory: "No project runs yet. Complete a project run to see its team, version, and round here.",
  targetHint: "Include the goal, role relationships, rough workflow, inputs, and expected outputs so the team structure can be generated accurately.",
  releaseTeam: "Release team version →", advancedWorkspace: "Open professional workspace"
});

function readHistory() { return []; }
function saveHistory() { return undefined; }
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
  const card = (item, landing = false) => {
    if (landing) return `<article class="landing-case-card" data-accent="${esc(item.accent)}"><a class="case-card-link" href="/studio?team=${encodeURIComponent(item.id)}" data-route="/studio?team=${encodeURIComponent(item.id)}">${caseIcon(item)}<span class="case-card-category">${esc(text(item.category))}</span><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><div class="case-mini-graph" aria-hidden="true"><span></span><i></i><i></i><i></i><b></b></div><span class="case-more">${esc(copy[state.locale].useCase)} <span aria-hidden="true">→</span></span></a></article>`;
    return `<article class="library-card" data-accent="${esc(item.accent)}"><a class="case-card-link" href="/cases/${esc(item.id)}" data-route="/cases/${esc(item.id)}">${caseIcon(item)}<span class="case-card-category">${esc(text(item.category))}</span><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><span class="case-more">${esc(copy[state.locale].openCase)} <span aria-hidden="true">→</span></span></a></article>`;
  };
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
    const response = await fetch(`/api/v1/cases/${encodeURIComponent(item.id)}/graph?locale=${encodeURIComponent(state.locale)}`);
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
    viewportGroup: "图谱视图", editGroup: "编辑图谱", zoomOut: "缩小", zoomIn: "放大", resetView: "重置缩放", fullscreen: "全屏", fitView: "适应画布", autoLayout: "自动布局", layoutModeFlow: "流程布局", layoutModeCompact: "紧凑布局", layoutModeStacked: "分层布局", topologyOrder: "关系顺序", enabled: "开启", disabled: "关闭", layoutSwitched: "已切换为{layout}布局", generate: "生成与运行", debugRun: "快速调试", debugAdvanced: "高级调试", debugRunNow: "立即运行", debugQuickInput: "调试输入", debugQuickHint: "在当前图谱中启动一次流程预览；路径覆盖等高级设置可在高级工作台完成。", debugQuickPlaceholder: "描述本次调试要验证的任务", debugQuickOpen: "打开快速调试", close: "关闭", debugRunShort: "运行", quickOpen: "快速定位", quickOpenPlaceholder: "搜索角色或协作关系", quickOpenEmpty: "没有匹配的角色或协作关系。", quickOpenRole: "角色", quickOpenFlow: "协作关系", contextEditRole: "编辑角色", contextEditFlow: "编辑关系", contextInsertRole: "插入角色", contextDelete: "删除", minimap: "图谱导航", addRole: "新增角色", addEdge: "新增关系", editSelection: "编辑所选", editRole: "编辑角色", editEdge: "编辑关系", deleteSelection: "删除所选", undo: "撤销", redo: "重做", validateWorkbench: "校验结构", saveWorkbench: "保存团队", ready: "就绪", graphUnavailable: "图谱不可用", graphReady: "图谱已载入", fixMermaidBeforeGraphEditing: "请先修复结构诊断，再编辑图谱。", noRolesAvailable: "暂无可用角色。", selectRoleBeforeAddingEdge: "请先选择角色，再新增关系。", invalidConnection: "无效的团队关系。", entryRoleDeletionBlocked: "不能删除入口角色。", invalidEdgeEndpoints: "关系端点无效。", duplicateRoleId: "角色 ID 已存在。", invalidRoleId: "角色 ID 必须以字母开头，只能使用字母、数字、下划线或连字符。", duplicateEdge: "该关系已存在。", invalidEventType: "事件类型必须使用大写字母。", deleteRoleConfirm: "确定删除角色 {roleId} 吗？", editBlocked: "结构校验通过后才能编辑图谱。", exportSvg: "导出 SVG", exportPng: "导出 PNG", boundaryEntry: "任务", boundaryEnd: "成果"
  },
  en: {
    viewportGroup: "Graph view", editGroup: "Edit graph", zoomOut: "Zoom out", zoomIn: "Zoom in", resetView: "Reset zoom", fullscreen: "Fullscreen", fitView: "Fit graph", autoLayout: "Auto layout", layoutModeFlow: "Flow layout", layoutModeCompact: "Compact layout", layoutModeStacked: "Layered layout", topologyOrder: "Flow order", enabled: "On", disabled: "Off", layoutSwitched: "Switched to {layout} layout", generate: "Generate and run", debugRun: "Quick debug", debugAdvanced: "Advanced debug", debugRunNow: "Run now", debugQuickInput: "Debug input", debugQuickHint: "Start a flow preview from this graph; use advanced settings for path overrides.", debugQuickPlaceholder: "Describe the task to verify", debugQuickOpen: "Open quick debug", close: "Close", debugRunShort: "Run", quickOpen: "Quick locate", quickOpenPlaceholder: "Search roles or relationships", quickOpenEmpty: "No matching roles or relationships.", quickOpenRole: "Role", quickOpenFlow: "Relationship", contextEditRole: "Edit role", contextEditFlow: "Edit relationship", contextInsertRole: "Insert role", contextDelete: "Delete", minimap: "Graph navigator", addRole: "Add role", addEdge: "Add relationship", editSelection: "Edit selected", editRole: "Edit role", editEdge: "Edit relationship", deleteSelection: "Delete selected", undo: "Undo", redo: "Redo", validateWorkbench: "Validate structure", saveWorkbench: "Save team", ready: "Ready", graphUnavailable: "Graph unavailable", graphReady: "Graph loaded", fixMermaidBeforeGraphEditing: "Fix the structure diagnostics before editing the graph.", noRolesAvailable: "No roles available.", selectRoleBeforeAddingEdge: "Select a role before adding a relationship.", invalidConnection: "Invalid team relationship.", entryRoleDeletionBlocked: "The entry role cannot be deleted.", invalidEdgeEndpoints: "Relationship endpoints are invalid.", duplicateRoleId: "Role ID already exists.", invalidRoleId: "Role ID must start with a letter and use letters, digits, _ or -.", duplicateEdge: "This relationship already exists.", invalidEventType: "Event type must use uppercase letters.", deleteRoleConfirm: "Delete role {roleId}?", editBlocked: "Pass structure validation before editing the graph.", exportSvg: "Export SVG", exportPng: "Export PNG", boundaryEntry: "Task", boundaryEnd: "Outcome"
  }
};
const graphFormLabels = {
  "zh-CN": {
    roleDialogTitle: "新增角色", edgeDialogTitle: "新增关系", editRoleDialogTitle: "编辑角色", editEdgeDialogTitle: "编辑关系", repositoryRole: "角色库", customRole: "自定义角色", rolePackage: "角色包", rolePackageSource: "从已安装的角色库导入", roleId: "角色 ID", title: "显示名称", bindingKind: "绑定方式", modelRef: "模型", profileId: "执行配置", existingProfile: "复用已有执行配置", createProfile: "创建项目执行配置", newProfileId: "生成的配置 ID", newProfileToolRef: "工具", newProfileTimeoutMs: "超时毫秒数", newProfileMaxOutputBytes: "最大输出字节数", sourceRole: "起始角色", targetRole: "目标角色", flowLabel: "关系名称", eventType: "事件类型", runtimeOnlyErrorFlow: "运行时错误关系", participatesInJoin: "参与汇总", cancel: "取消", create: "创建", save: "保存", noRepositoryRoles: "暂无角色库角色", noModels: "暂无模型", noProfiles: "暂无执行配置", noTools: "暂无工具", outputTarget: "成果"
  },
  en: {
    roleDialogTitle: "Add role", edgeDialogTitle: "Add relationship", editRoleDialogTitle: "Edit role", editEdgeDialogTitle: "Edit relationship", repositoryRole: "Role library", customRole: "Custom role", rolePackage: "Role package", rolePackageSource: "Import from the installed role library", roleId: "Role ID", title: "Display name", bindingKind: "Binding", modelRef: "Model", profileId: "Execution profile", existingProfile: "Reuse existing execution config", createProfile: "Create project execution config", newProfileId: "Generated profile ID", newProfileToolRef: "Tool", newProfileTimeoutMs: "Timeout in milliseconds", newProfileMaxOutputBytes: "Maximum output bytes", sourceRole: "Source role", targetRole: "Target role", flowLabel: "Relationship name", eventType: "Event type", runtimeOnlyErrorFlow: "Runtime error relationship", participatesInJoin: "Participates in join", cancel: "Cancel", create: "Create", save: "Save", noRepositoryRoles: "No role library entries", noModels: "No models", noProfiles: "No execution profiles", noTools: "No tools", outputTarget: "Outcome"
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
  const detailRoot = $("#case-detail-view");
  const useLink = detailRoot.querySelector("[data-use-case]");
  if (useLink) {
    useLink.removeAttribute("data-use-case");
    useLink.dataset.caseAction = "use";
    useLink.dataset.caseId = item.id;
    useLink.href = "#";
    useLink.innerHTML = "使用这个团队 <span aria-hidden=\"true\">→</span>";
    useLink.insertAdjacentHTML("afterend", "<button class=\"secondary-button\" type=\"button\" data-case-action=\"template\" data-case-id=\"" + esc(item.id) + "\">使用模板，创建新团队</button>");
  }
  detailRoot.querySelector(".detail-content")?.insertAdjacentHTML("beforebegin", "<section class=\"detail-graph-section\"><div class=\"detail-section-heading\"><div><span class=\"section-kicker\">团队协作结构</span><h2>团队协作结构</h2><p>先查看角色和交接关系，再决定直接使用，或复制为新团队进行微调。</p></div><span class=\"status-chip\">只读预览</span></div><div id=\"detail-graph-stage\" class=\"graph-stage detail-graph-stage\" role=\"img\" aria-label=\"Team collaboration graph\"></div></section>");
  detailRoot.querySelectorAll("[data-case-action]").forEach((element) => element.addEventListener("click", (event) => {
    event.preventDefault();
    void createProjectFromCase(element.dataset.caseId, element.dataset.caseAction, element);
  }));
  void renderDetailGraph(item);
  $$('[data-use-case]').forEach((element) => element.addEventListener("click", (event) => { event.preventDefault(); selectCase(element.dataset.useCase); navigate("/studio"); }));
}

async function renderDetailGraph(item) {
  const stage = $("#detail-graph-stage");
  if (!stage || !window.OGSStudioGraphBundle?.mountStudioX6Bridge) return;
  try {
    const response = await fetch("/api/v1/cases/" + encodeURIComponent(item.id) + "/graph?locale=" + encodeURIComponent(state.locale));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load the team graph.");
    window.OGSStudioGraphBundle.mountStudioX6Bridge(stage, {
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
  } catch (error) {
    stage.textContent = error.message || "Unable to load the team graph.";
  }
}

async function createProjectFromCase(caseId, action, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/v1/cases/" + encodeURIComponent(caseId) + "/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法创建团队。");
    navigate(action === "use" ? "/studio/project/new?team=" + encodeURIComponent(payload.projectId) : "/studio/team/" + encodeURIComponent(payload.projectId));
  } catch (error) {
    if (button) button.disabled = false;
    showToast(error.message || "无法创建团队。");
  }
}
function applyLocale() {
  document.documentElement.lang = state.locale;
  $$('[data-i18n]').forEach((element) => { const value = copy[state.locale][element.dataset.i18n]; if (value) element.innerHTML = value; });
  $$('[data-i18n-placeholder]').forEach((element) => { const value = copy[state.locale][element.dataset.i18nPlaceholder]; if (value) element.placeholder = value; });
  $$("#locale-toggle, #landing-locale").forEach((button) => { button.textContent = state.locale === "zh-CN" ? "EN" : "中文"; });
  syncThemeControls();
  const projectRoute = isProjectRoute();
  if (!projectRoute) {
    renderCases();
    renderSelected(state.cases.find((item) => item.id === state.selected));
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
  return path === "/studio"
    || path === "/projects"
    || path === "/platform"
    || path === "/factory"
    || path === "/studio/new"
    || path === "/studio/project/new"
    || /^\/studio\/(?:project|team)\/[a-z0-9-]+(?:\/run)?$/.test(path);
}
function setView(view) {
  state.view = view;
  const viewMap = { projects: "projects-view", workspace: "workspace-view", factory: "factory-view", platform: "platform-view", examples: "examples-view", history: "history-view", "new-project": "new-project-view", "project-workspace": "project-workspace-view" };
  Object.entries(viewMap).forEach(([key, id]) => document.getElementById(id)?.classList.toggle("hidden", key !== view));
  $("#case-detail-view")?.classList.add("hidden");
  $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const nav = $(`.nav-item[data-view="${view}"] [data-i18n]`);
  $("#breadcrumb-current").textContent = nav?.textContent || copy[state.locale].navTeams;
}
function navigate(path) {
  history.pushState({}, "", String(path));
  syncRoute();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function teamStatusMeta(status) {
  const labels = state.locale === "en"
    ? { draft: ["Team draft", "Continue editing"], editing: ["Being edited", "Continue editing"], invalid: ["Needs fixes", "Review structure"], validated: ["Structure validated", "Ready to confirm"], confirmed: ["Team confirmed", "Ready to create a project"], archived: ["Archived", "View only"] }
    : { draft: ["团队草案", "可继续编辑"], editing: ["正在编辑", "可继续编辑"], invalid: ["需要修复", "请检查团队结构"], validated: ["结构已验证", "可以发布版本"], confirmed: ["已发布", "可以创建项目"], archived: ["已归档", "仅供查看"] };
  const value = labels[status] || labels.draft;
  return { label: value[0], hint: value[1] };
}
function materialStatusLabel(status) {
  if (state.locale === "en") return ({ indexed: "Ready", pending: "Processing", failed: "Needs attention" })[status] || status || "Ready";
  return ({ indexed: "已就绪", pending: "处理中", failed: "需要处理" })[status] || status || "已就绪";
}
function normalizeWorkspaceKey(value) {
  return String(value || "workspace").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workspace";
}
async function renderProjectCreate() {
  const root = $("#new-project-view");
  root.innerHTML = `<section class="page-heading project-create-heading"><div><a class="detail-back" href="/projects" data-route="/projects">← 协作项目</a><div class="eyebrow">创建协作项目</div><h1>先建立项目，再安排团队</h1><p>项目共享一个工作目录。选择至少一个已发布团队，之后可以在同一项目中继续添加团队和运行不同任务。</p></div></section><section class="project-builder project-create-builder"><form id="collaboration-project-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">项目基础信息</span><h2>项目名称与工作目录</h2><p>工作目录是项目的长期资源空间，后续任务和团队共享这里的材料。</p></div><label>项目名称<input name="name" required maxlength="120" placeholder="例如：新产品上市项目"></label><label>工作目录<input name="workspaceKey" required maxlength="80" placeholder="例如：product-launch"></label><label>项目目标<textarea name="intent" rows="4" maxlength="4000" placeholder="描述项目要完成的事情、阶段目标和预期成果"></textarea></label><fieldset class="builder-choice-group"><legend>挂载团队 <span>至少选择一个</span></legend><div id="project-team-options" class="builder-choice-grid"><span class="project-loading">正在读取团队仓库...</span></div></fieldset><div class="new-team-form-footer"><p class="form-hint">团队版本发布后才能挂载到项目；项目创建后仍可继续添加团队。</p><div class="form-actions"><button class="primary-button" type="submit">创建协作项目 <span aria-hidden="true">→</span></button></div></div><p class="form-status" id="collaboration-project-status" role="status" aria-live="polite"></p></form></section>`;
  const options = $("#project-team-options");
  options.insertAdjacentHTML("beforebegin", '<div class="team-picker-toolbar"><label class="team-picker-search"><span class="sr-only">搜索团队</span><input id="project-team-search" type="search" placeholder="搜索团队名称或目标" autocomplete="off"></label><span id="project-team-count" class="team-picker-count">已选 0 个</span></div>');
  try {
    const response = await fetch("/api/v1/team-repository"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取团队仓库");
    const teams = payload.teams || [];
    const selectableTeams = teams.filter((team) => team.teamVersionStatus === "released");
    options.innerHTML = selectableTeams.length ? selectableTeams.map((team) => `<label class="builder-choice"><input type="checkbox" name="teamVersionId" value="${esc(team.projectId)}"><strong>${esc(team.name)} · v${team.teamVersionNumber || 1}${team.builtIn ? " · 内置" : ""}</strong><span>${esc((team.intent || "").slice(0, 120))}</span></label>`).join("") : `<p class="empty-note">暂无可用团队，请先到团队仓库创建并发布团队。</p>`;
    const search = $("#project-team-search"); const count = $("#project-team-count");
    const refreshTeamPicker = () => { const query = String(search?.value || "").trim().toLocaleLowerCase(); let selectedCount = 0; options.querySelectorAll(".builder-choice").forEach((card) => { const input = card.querySelector("input"); const matches = !query || card.textContent.toLocaleLowerCase().includes(query); card.hidden = !matches; card.classList.toggle("selected", Boolean(input?.checked)); if (input?.checked) selectedCount += 1; }); if (count) count.textContent = `已选 ${selectedCount} 个`; };
    search?.addEventListener("input", refreshTeamPicker); options.querySelectorAll("input[type=checkbox]").forEach((input) => input.addEventListener("change", refreshTeamPicker));
    const preselectedTeam = new URLSearchParams(location.search).get("team");
    if (preselectedTeam) options.querySelector(`input[value="${CSS.escape(preselectedTeam)}"]`)?.setAttribute("checked", "checked");
    refreshTeamPicker();
    $("#collaboration-project-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const selected = form.getAll("teamVersionId"); const status = $("#collaboration-project-status"); if (!selected.length) { status.textContent = "请至少选择一个团队。"; return; } status.textContent = "正在创建项目..."; const createResponse = await fetch("/api/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), workspaceKey: normalizeWorkspaceKey(form.get("workspaceKey")), intent: form.get("intent") }) }); const project = await createResponse.json(); if (!createResponse.ok) { status.textContent = project.error || "项目创建失败"; return; } for (const teamVersionId of selected) { const mountResponse = await fetch(`/api/v1/projects/${encodeURIComponent(project.projectId)}/teams`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamVersionId }) }); if (!mountResponse.ok) { const error = await mountResponse.json(); status.textContent = error.error || "团队挂载失败"; return; } } navigate(`/studio/project/${encodeURIComponent(project.projectId)}/run`); });
  } catch (error) { options.innerHTML = `<p class="run-error">${esc(error.message || "无法读取团队仓库")}</p>`; }
}
async function renderNewProject() {
  const root = $("#new-project-view");
  root.innerHTML = [
    '<section class="page-heading new-team-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← 团队仓库</a><div class="eyebrow">创建团队 · 第 1 步</div><h1>先定义团队目标</h1><p>写下团队要完成的事情，并选择协作方式。提交后会生成草案，你可以继续调整角色与流程，再确认入库。</p></div></section>',
    '<section class="project-builder new-team-builder"><ol class="new-team-steps" aria-label="创建团队流程"><li class="active" aria-current="step"><span>1</span><div><strong>创建草案</strong><small>填写目标与协作偏好</small></div></li><li><span>2</span><div><strong>完善并发布</strong><small>检查团队结构后发布版本</small></div></li></ol>',
    `<form id="new-project-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">团队草案</span><h2>你希望团队完成什么？</h2><p>从目标开始，名称和协作偏好之后都可以修改。</p></div><label>团队名称<input name="name" required maxlength="120" autocomplete="organization" placeholder="例如：产品研究团队"></label><label>团队目标<textarea name="intent" required maxlength="4000" rows="6" placeholder="例如：目标是分析竞品资料并提出行动建议；研究员负责资料整理，分析员负责比较，负责人汇总并审核；流程为收集材料→独立分析→汇总审核；输入包括竞品文档，输出为带依据的建议清单。"></textarea><small class="field-hint">${esc(copy[state.locale].targetHint)}</small></label><fieldset class="builder-choice-group"><legend>选择协作方式 <span>可选</span></legend><div class="builder-choice-grid"><button class="builder-choice" type="button" data-builder-choice="顺序接力：每个角色完成后交给下一个" aria-pressed="false"><strong>顺序接力</strong><span>适合步骤明确、需要逐步交接的任务</span></button><button class="builder-choice" type="button" data-builder-choice="独立分析后汇总：多个角色分别研究，最后统一整理" aria-pressed="false"><strong>分头分析，再汇总</strong><span>适合需要多个角度并行研究的任务</span></button><button class="builder-choice" type="button" data-builder-choice="负责人协调：由一个负责人安排和检查其他角色" aria-pressed="false"><strong>负责人协调</strong><span>适合过程中需要统筹与检查的任务</span></button></div></fieldset><div class="new-team-form-footer"><p class="form-hint">创建后可继续用自然语言调整角色、流程和输出要求。</p><div class="form-actions"><button class="primary-button" type="submit">创建团队草案 <span aria-hidden="true">→</span></button></div></div><p class="form-status" id="new-project-status" role="status" aria-live="polite"></p></form></section>`
  ].join("");
  const choiceLegend = root.querySelector(".builder-choice-group legend span");
  if (choiceLegend) choiceLegend.textContent = "可选，再次点击可取消";
  $$("[data-builder-choice]").forEach((choice) => choice.addEventListener("click", () => {
    const wasSelected = choice.getAttribute("aria-pressed") === "true";
    $$('[data-builder-choice]').forEach((item) => { item.classList.remove("selected"); item.setAttribute("aria-pressed", "false"); });
    if (!wasSelected) { choice.classList.add("selected"); choice.setAttribute("aria-pressed", "true"); }
  }));
  $("#new-project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = $("#new-project-status");
    status.textContent = "正在创建团队草案…";
    try {
      const preference = $("[data-builder-choice].selected")?.dataset.builderChoice;
      const intent = [String(form.get("intent") || "").trim(), preference ? `协作偏好：${preference}` : ""].filter(Boolean).join("\n\n");
      const response = await fetch("/api/v1/team-factory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), intent, locale: state.locale }) });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "项目创建失败");
      state.projectId = project.projectId;
      navigate("/studio/team/" + encodeURIComponent(project.projectId));
    } catch (error) {
      status.textContent = error.message || "项目创建失败";
    }
  });
}

async function renderTeamAssistant(projectId, project) {
  const root = $("#team-assistant");
  if (!root) return;
  let latestDesign;
  let latestDigest = project.projectDigest;
  let lastResponse;
  root.innerHTML = '<div class="panel-head"><div><span class="section-kicker">对话完善</span><h2>继续和团队对话</h2></div><span class="status-chip">可随时微调</span></div><p class="panel-intro">告诉我你想增加、删除或调整什么。每次修改都会先生成预览，确认后才保存到草案。</p><div class="assistant-history" id="team-assistant-history"><div class="assistant-message"><strong>可以这样说</strong><span>增加一个事实核查角色，并让最终结论都附上来源。</span></div></div><div class="assistant-choices"><button type="button" class="builder-choice" data-assistant-choice="按顺序接力完成任务，并在最后增加人工审核"><strong>增加审核</strong><span>在最终输出前检查质量</span></button><button type="button" class="builder-choice" data-assistant-choice="减少角色，优先保证运行速度和成本"><strong>减少角色</strong><span>让流程更短、更容易运行</span></button><button type="button" class="builder-choice" data-assistant-choice="为每个关键结论增加来源引用要求"><strong>增加来源</strong><span>让结果更容易核查</span></button></div><label class="assistant-input-label"><span>告诉团队助手下一步怎么改</span><textarea id="team-assistant-input" rows="3" maxlength="4000" placeholder="例如：让研究员先分析，再让审核员检查事实依据"></textarea></label><div class="form-actions"><button class="primary-button" type="button" id="team-assistant-send">生成修改预览</button><a class="secondary-button" id="team-assistant-vis" href="#" target="_self">打开高级工作台</a></div><p class="form-status" id="team-assistant-status"></p><div id="team-assistant-preview"></div>';
  bindProfessionalWorkspaceLink($("#team-assistant-vis"), projectId, "design");
  try {
    const designResponse = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design`);
    latestDesign = await designResponse.json();
  } catch (error) {
    $("#team-assistant-status").textContent = error.message || "无法读取当前团队设计";
  }
  const addMessage = (label, content, kind = "assistant") => {
    $("#team-assistant-history")?.insertAdjacentHTML("beforeend", `<div class="assistant-message ${kind}"><strong>${esc(label)}</strong><span>${esc(content)}</span></div>`);
  };
  const send = async (message) => {
    const text = String(message || "").trim();
    if (!text) return;
    const status = $("#team-assistant-status");
    const input = $("#team-assistant-input");
    input.value = text;
    addMessage("你", text, "user");
    status.textContent = "正在分析团队结构并生成预览…";
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, systemSource: latestDesign?.systemSource, authoring: latestDesign?.authoring }) });
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
      preview.innerHTML = `<div class="assistant-preview"><div class="preview-list"><div><strong>当前状态</strong><span>${esc(payload.mode || "draft")}</span></div><div><strong>待确认问题</strong><span>${payload.unresolvedItems?.length || 0}</span></div></div>${payload.assumptions?.length ? `<p class="form-hint">假设：${esc(payload.assumptions.join("；"))}</p>` : ""}${questions ? `<div class="assistant-question-list">${questions}</div>` : ""}${patchReady ? '<div class="form-actions"><button type="button" class="primary-button" id="team-assistant-apply">应用到团队草案</button></div>' : ""}</div>`;
      preview.querySelectorAll("[data-assistant-choice]").forEach((button) => button.addEventListener("click", () => send(button.dataset.assistantChoice)));
      $("#team-assistant-apply")?.addEventListener("click", async () => {
        const patch = lastResponse?.authoringPatch?.authoring;
        if (!patch) return;
        const save = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ authoring: patch, expectedProjectDigest: latestDigest }) });
        const saved = await save.json();
        if (!save.ok) throw new Error(saved.error || "团队草案保存失败");
        status.textContent = "修改已应用，团队回到草案状态，请检查后确认。";
        await renderProjectDraftV2(projectId);
      });
      status.textContent = patchReady ? "预览已生成，确认后才会保存。" : "请回答团队助手的问题，继续完善团队。";
    } catch (error) {
      status.textContent = error.message || "团队助手暂时不可用";
    }
  };
  $("#team-assistant-send")?.addEventListener("click", () => send($("#team-assistant-input").value));
  $$("#team-assistant [data-assistant-choice]").forEach((button) => button.addEventListener("click", () => send(button.dataset.assistantChoice)));
}
function teamVersionMeta(team) {
  const status = team.teamVersionStatus || (team.projectStatus === "confirmed" ? "released" : "draft");
  const labels = state.locale === "en"
    ? { released: ["Released", "Ready for projects"], editing: ["Editing", "Continue refining"], draft: ["Draft", "Continue building"], archived: ["Archived", "View only"] }
    : { released: ["已发布", "可用于创建项目"], editing: ["编辑中", "继续完善团队"], draft: ["草案", "继续建设团队"], archived: ["已归档", "仅供查看"] };
  const value = labels[status] || labels.draft;
  return { status, label: value[0], hint: value[1], version: `v${team.teamVersionNumber || 1}` };
}
function teamCard(team, area) {
  const meta = teamVersionMeta(team); const id = encodeURIComponent(team.projectId); const title = esc(team.teamName || team.name);
  const actions = area === "repository"
    ? `<a class="primary-button" href="/studio/project/new?team=${id}" data-route="/studio/project/new?team=${id}">${esc(copy[state.locale].useTeam)} →</a><button class="secondary-button" type="button" data-team-action="edit" data-team-id="${id}">${esc(copy[state.locale].editAsVersion)}</button><a class="secondary-button" href="/api/v1/projects/${id}/team/export">${esc(copy[state.locale].exportAsset)}</a><button class="text-button danger-text" type="button" data-team-action="archive" data-team-id="${id}">${esc(copy[state.locale].archiveVersion)}</button>`
    : `<a class="primary-button" href="/studio/team/${id}" data-route="/studio/team/${id}">${esc(copy[state.locale].continueEditing)} →</a><a class="secondary-button" href="${esc(professionalWorkspaceUrl(team.projectId, "design"))}" target="_self">${esc(copy[state.locale].advancedWorkspace)}</a><button class="secondary-button" type="button" data-team-action="release" data-team-id="${id}">${esc(copy[state.locale].releaseVersion)}</button>`;
  return `<article class="project-asset-card team-version-card" data-team-status="${esc(meta.status)}"><div class="asset-card-top"><span class="asset-mark">O</span><span class="status-chip ${esc(meta.status)}">${esc(meta.label)}</span></div><div class="asset-title-row"><h2>${title}</h2><span class="version-badge">${esc(meta.version)}</span></div><p>${esc(team.intent || "")}</p><div class="asset-card-meta"><span>${esc(meta.hint)}</span><span>${team.updatedAt ? new Date(team.updatedAt).toLocaleDateString(state.locale) : ""}</span></div><div class="asset-card-actions">${actions}</div></article>`;
}
function bindTeamActions(root) {
  root.querySelectorAll("a[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.getAttribute("href")); }));
  root.querySelectorAll("[data-team-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.teamAction; const id = button.dataset.teamId; button.disabled = true;
    try {
      const endpoint = action === "edit" ? `/api/v1/team-versions/${id}/edit` : `/api/v1/team-versions/${id}/${action}`;
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "操作失败");
      if (action === "edit") navigate(`/studio/team/${encodeURIComponent(payload.projectId)}`);
      else { showToast(action === "release" ? "团队版本已发布" : "团队版本已归档"); if (state.view === "factory") await renderTeamFactory(); else await renderProjectLibrary(); }
    } catch (error) { showToast(error.message || "操作失败"); button.disabled = false; }
  }));
}
async function renderProjectLibrary() {
  const root = $("#workspace-view");
  const importLabelText = () => { const label = root.querySelector(".import-project-button"); if (label?.firstChild) label.firstChild.textContent = "导入团队"; };
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">${esc(copy[state.locale].libraryEyebrow)}</div><h1>${esc(copy[state.locale].libraryTitle)}</h1><p>${esc(copy[state.locale].libraryIntro)}</p></div><div class="heading-actions"><label class="secondary-button import-project-button">导入团队<input id="project-import-file" type="file" accept="application/json" hidden></label><a class="primary-button" href="/factory" data-route="/factory">${esc(copy[state.locale].createTeam)} →</a></div></section><section class="project-library-toolbar"><div><strong>${esc(copy[state.locale].releasedLabel)}</strong><span>${esc(copy[state.locale].repositoryEmptyHint)}</span></div><div class="project-library-filters"><label><span class="sr-only">搜索团队</span><input id="project-library-search" type="search" placeholder="搜索团队名称或目标"></label></div></section><div id="project-library-grid" class="project-library-grid"><div class="project-loading">正在读取团队仓库...</div></div>`;
  importLabelText();
  const grid = $("#project-library-grid");
  root.querySelector(".project-library-toolbar")?.insertAdjacentHTML("afterend", `<section class="classic-team-section repository-classic-section"><div class="section-header"><div><div class="section-kicker">${esc(state.locale === "en" ? "Repository examples" : "典型团队")}</div><h2>${esc(state.locale === "en" ? "Ready-made collaboration patterns" : "开箱即用的协作方式")}</h2><p class="section-description">${esc(state.locale === "en" ? "Repository examples are read-only templates in the repository. Use one to create your own team version, then create a project." : "平台内置团队以只读模板形式放在仓库中。使用后会生成你的团队版本，再进入独立的项目创建流程。")}</p></div></div><div class="classic-team-grid">${state.cases.map((item) => `<article class="classic-team-card" data-accent="${esc(item.accent)}"><div class="classic-team-card-top"><span class="asset-mark">${esc(icon[item.icon] || "✦")}</span><span class="status-chip">${esc(state.locale === "en" ? "Built-in" : "内置版本")}</span></div><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><div class="classic-team-meta"><span>${esc(item.duration?.[state.locale] || item.duration?.["zh-CN"] || "")}</span><span>${item.roles.length} ${state.locale === "en" ? "roles" : "个角色"}</span></div><button class="secondary-button" type="button" data-classic-team="${esc(item.id)}">${esc(copy[state.locale].useTeam)} →</button></article>`).join("")}</div></section>`);
  root.querySelectorAll("[data-classic-team]").forEach((button) => button.addEventListener("click", async () => {
    const caseId = button.dataset.classicTeam; button.disabled = true;
    try {
      const response = await fetch(`/api/v1/cases/${encodeURIComponent(caseId)}/use`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: state.locale }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法使用内置团队");
      navigate(`/studio/project/new?team=${encodeURIComponent(payload.projectId)}`);
    } catch (error) { showToast(error.message || "无法使用内置团队"); button.disabled = false; }
  }));
  try {
    const response = await fetch("/api/v1/team-repository"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取团队仓库");
    const teams = payload.teams || [];
    grid.innerHTML = teams.length ? teams.map((team) => teamCard(team, "repository")).join("") : `<div class="empty-projects"><strong>${esc(copy[state.locale].noReleasedTeams)}</strong><p>${esc(copy[state.locale].repositoryEmptyHint)}</p><a class="primary-button" href="/factory" data-route="/factory">${esc(copy[state.locale].createTeam)} →</a></div>`;
    bindTeamActions(grid);
    $("#project-library-search")?.addEventListener("input", (event) => { const query = event.target.value.trim().toLowerCase(); grid.querySelectorAll(".team-version-card").forEach((card) => { card.hidden = Boolean(query && !card.textContent.toLowerCase().includes(query)); }); });
    $("#project-import-file")?.addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (!file) return; event.target.value = ""; try { const imported = await fetch("/api/v1/team-packages/import", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() }); const result = await imported.json(); if (!imported.ok) throw new Error(result.error); navigate(`/studio/team/${encodeURIComponent(result.projectId)}`); } catch (error) { showToast(error.message || "导入失败"); } });
  } catch (error) { grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取团队仓库")}</div>`; }
}
async function renderCollaborationProjects() {
  const root = $("#projects-view");
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">协作项目</div><h1>按任务推进项目</h1><p>一个项目共享工作目录，可以挂载多个团队并按任务重复运行。</p></div><div class="heading-actions"><a class="primary-button" href="/studio/project/new" data-route="/studio/project/new">创建协作项目 →</a></div></section><div id="collaboration-project-grid" class="project-library-grid"><div class="project-loading">正在读取协作项目...</div></div>`;
  const grid = $("#collaboration-project-grid");
  try {
    const response = await fetch("/api/v1/projects"); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法读取协作项目");
    const projects = payload.projects || [];
    grid.innerHTML = projects.length ? projects.map((project) => { const teams = project.mountedTeams || []; const taskCount = project.taskRecords?.length || 0; return `<article class="project-asset-card collaboration-project-card"><div class="asset-card-top"><span class="asset-mark">⌘</span><span class="status-chip ${esc(project.projectStatus || "draft")}">${esc(taskCount ? "进行中" : "待开始")}</span></div><div class="asset-title-row"><h2>${esc(project.name)}</h2><span class="version-badge">${teams.length} 个团队</span></div><p>${esc(project.intent || "共享工作目录，按任务记录项目进展")}</p><div class="asset-card-meta"><span>${esc(project.workspaceKey || "未设置工作目录")}</span><span>${taskCount} 个任务</span></div><div class="asset-card-actions"><a class="primary-button" href="/studio/project/${encodeURIComponent(project.projectId)}/run" data-route="/studio/project/${encodeURIComponent(project.projectId)}/run">打开项目 →</a></div></article>`; }).join("") : `<div class="empty-projects"><strong>还没有协作项目</strong><p>先创建项目，再挂载团队并开始任务。</p><a class="primary-button" href="/studio/project/new" data-route="/studio/project/new">创建协作项目 →</a></div>`;
    grid.querySelectorAll("a[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.getAttribute("href")); }));
  } catch (error) { grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取协作项目")}</div>`; }
}

async function renderPlatformConfig() {
  const root = $("#platform-view");
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">平台配置</div><h1>运行底座与默认设置</h1><p>自动检查可用的运行底座和模型，为团队角色选择稳定的默认执行方式。</p></div><div class="heading-actions"><button id="platform-discovery-refresh" class="secondary-button" type="button">刷新底座与模型</button></div></section><section class="platform-config-grid"><article class="project-panel platform-discovery-panel"><div class="panel-head"><div><span class="section-kicker">运行底座</span><h2>发现到的服务</h2></div></div><div id="platform-providers" class="platform-list">正在读取...</div></article><article class="project-panel platform-discovery-panel"><div class="panel-head"><div><span class="section-kicker">模型目录</span><h2>发现到的模型</h2></div></div><div id="platform-models" class="platform-list">正在读取...</div></article><article class="project-panel platform-settings-panel"><div class="panel-head"><div><span class="section-kicker">默认值</span><h2>执行设置</h2></div><p class="panel-note" id="platform-discovery-meta">正在读取探测时间...</p></div><form id="platform-settings-form" class="compact-form"><label>默认底座<select name="defaultProvider"><option value="codex">Codex</option><option value="opencode">OpenCode</option></select></label><label>默认模型<select name="defaultModel"><option value="default">跟随默认底座</option></select></label><label><span>模型请求超时（秒）</span><input name="timeoutSeconds" type="number" min="10" max="3600" value="120" title="等待本次模型请求返回的最长时间；不限制整个任务的执行时长" aria-describedby="platform-timeout-help"><small id="platform-timeout-help" class="platform-field-hint">只计算单次模型请求等待返回的时间，不限制整个任务执行多久。超过后该次请求异常，可从任务记录重新处理。</small></label><label>失败重试次数<input name="retryCount" type="number" min="0" max="5" value="1"></label><button class="primary-button" type="submit">保存设置</button><p class="form-status" id="platform-settings-status"></p></form></article></section>`;
  const statusText = (status) => status === "available" || status === "active" ? "可用" : "未发现";
  const statusClass = (status) => status === "available" || status === "active" ? "confirmed" : "warning";
  const capabilityLabels = (capabilities = {}) => [capabilities.textInput && "文本输入", capabilities.textOutput && "文本输出", capabilities.toolcall && "工具调用"].filter(Boolean);
  const sourceDetail = (item) => { const detail = String(item.detail || ""); if (/not found|missing|command/i.test(detail)) return "未检测到该运行底座，请安装后再刷新"; if (/persistent|adapter/i.test(detail)) return "已检测到命令，当前仅展示发现结果"; return detail || "已完成自动检查"; };
  const formatDiscoveryTime = (value) => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "时间未知" : date.toLocaleString(state.locale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }); };
  const renderDiscovery = (discovery, settings) => {
    const providers = discovery.sources || [];
    const models = discovery.models || [];
    $("#platform-providers").innerHTML = providers.length ? providers.map((item) => `<div class="platform-source-row"><div class="platform-row-main"><div class="platform-row-title"><strong>${esc(item.name || item.backend)}</strong><span class="status-chip ${statusClass(item.status)}">${statusText(item.status)}</span></div><span class="platform-row-detail">${esc(sourceDetail(item))}</span><code>${esc(item.command || "自动检查")}</code></div></div>`).join("") : `<div class="platform-empty">暂未发现运行底座</div>`;
    $("#platform-models").innerHTML = models.length ? models.map((item) => { const capabilities = capabilityLabels(item.capabilities); return `<div class="platform-model-row"><div class="platform-row-main"><div class="platform-row-title"><strong>${esc(item.name || item.id)}</strong><span class="status-chip ${statusClass(item.status)}">${item.runnable ? "可运行" : "不可运行"}</span></div><span class="platform-row-detail">${esc(item.providerName || item.provider || "未知底座")} · ${esc(item.id)}</span><div class="platform-capabilities">${capabilities.length ? capabilities.map((label) => `<span>${esc(label)}</span>`).join("") : "<span>能力信息未提供</span>"}</div></div></div>`; }).join("") : `<div class="platform-empty">暂未发现可用模型，请先安装并登录运行底座</div>`;
    $("#platform-discovery-meta").textContent = `上次检查：${formatDiscoveryTime(discovery.generatedAt)}${discovery.stale ? " · 建议刷新" : ""}`;
    const modelSelect = document.querySelector("#platform-settings-form select[name=defaultModel]");
    if (modelSelect) {
      const runnableModels = models.filter((item) => item.runnable);
      modelSelect.innerHTML = `<option value="default">跟随默认底座</option>${runnableModels.map((item) => `<option value="${esc(item.id)}">${esc(item.name || item.id)}</option>`).join("")}`;
      modelSelect.value = settings?.defaultModel && [...modelSelect.options].some((option) => option.value === settings.defaultModel) ? settings.defaultModel : "default";
    }
    const providerSelect = document.querySelector("#platform-settings-form select[name=defaultProvider]");
    if (providerSelect && settings?.defaultProvider) providerSelect.value = settings.defaultProvider;
    if (settings) {
      const timeout = document.querySelector("#platform-settings-form input[name=timeoutSeconds]");
      const retry = document.querySelector("#platform-settings-form input[name=retryCount]");
      if (timeout) timeout.value = settings.timeoutSeconds;
      if (retry) retry.value = settings.retryCount;
    }
  };
  $("#platform-discovery-refresh")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; const currentSettings = Object.fromEntries(new FormData(document.querySelector("#platform-settings-form") || document.createElement("form")).entries()); button.disabled = true; button.textContent = "正在刷新...";
    try { const response = await fetch("/api/v1/platform/discovery", { method: "POST" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "刷新失败"); renderDiscovery(payload, currentSettings); button.textContent = "已刷新"; setTimeout(() => { button.textContent = "刷新底座与模型"; }, 1500); }
    catch (error) { showToast(error.message || "刷新失败"); button.textContent = "刷新失败"; }
    finally { button.disabled = false; }
  });
  try {
    const [discoveryResponse, settingsResponse] = await Promise.all([fetch("/api/v1/platform/discovery"), fetch("/api/v1/platform/settings")]);
    const discovery = await discoveryResponse.json(); const settingsPayload = await settingsResponse.json();
    if (!discoveryResponse.ok) throw new Error(discovery.error || "无法读取运行底座");
    renderDiscovery(discovery, settingsPayload.settings);
    $("#platform-settings-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/v1/platform/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form.entries())) }); const result = await response.json(); $("#platform-settings-status").textContent = response.ok ? "设置已保存" : (result.error || "保存失败"); });
  } catch (error) { $("#platform-providers").innerHTML = `<div class="platform-empty">${esc(error.message || "无法读取平台配置")}</div>`; $("#platform-models").innerHTML = `<div class="platform-empty">请检查运行服务后重试</div>`; }
}

async function renderTeamFactory() {
  const root = $("#factory-view");
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">${esc(copy[state.locale].factoryEyebrow)}</div><h1>${esc(copy[state.locale].factoryTitle)}</h1><p>${esc(copy[state.locale].factoryIntro)}</p></div><div class="heading-actions"><a class="primary-button" href="/studio/new" data-route="/studio/new">${esc(copy[state.locale].createTeam)} →</a></div></section><section class="project-library-toolbar"><div><strong>${esc(copy[state.locale].factoryEyebrow)}</strong><span>${esc(copy[state.locale].factoryEmptyHint)}</span></div></section><div id="factory-grid" class="project-library-grid"><div class="project-loading">正在读取团队工厂...</div></div>`;
  const grid = $("#factory-grid");
  try {
    const response = await fetch("/api/v1/team-factory"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取团队工厂");
    const teams = payload.teams || [];
    grid.innerHTML = teams.length ? teams.map((team) => teamCard(team, "factory")).join("") : `<div class="empty-projects"><strong>${esc(copy[state.locale].noFactoryTeams)}</strong><p>${esc(copy[state.locale].factoryEmptyHint)}</p><a class="primary-button" href="/studio/new" data-route="/studio/new">${esc(copy[state.locale].createTeam)} →</a></div>`;
    bindTeamActions(grid);
  } catch (error) { grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取团队工厂")}</div>`; }
}

async function renderProjectGraph(projectId, stageId = "project-graph-stage", readOnly = false) {
  const stage = $("#" + stageId);
  if (!stage || !window.OGSStudioGraphBundle?.mountStudioX6Bridge) return;
  try {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design?locale=${encodeURIComponent(state.locale)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load the project graph.");
    if (readOnly) {
      window.OGSStudioGraphBundle.mountStudioX6Bridge(stage, {
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
      return;
    }
    let authoring = payload.authoring;
    let canvas = payload.canvas;
    let projectDigest = payload.projectDigest;
    let dirty = false;
    const setEditorState = (message) => {
      const status = $("#project-design-status");
      if (status) status.textContent = message;
    };
    window.OGSStudioGraphBundle.mountStudioX6Bridge(stage, {
      mode: "product-edit",
      authoring,
      canvas,
      viewModel: payload.viewModel,
      readOnly: false,
      showTopologyOrder: false,
      showTechnicalDetails: false,
      initialLayoutMode: "flow",
      defaultAutoLayout: true,
      defaultAutoLayoutRequestId: 1,
      canSaveWorkbench: true,
      labels: graphLabels[state.locale],
      commandFormLabels: graphFormLabels[state.locale],
      onApplyCommand: (result) => {
        authoring = result.authoring;
        canvas = result.canvas;
        dirty = true;
        setEditorState("有未保存的结构修改");
      },
      onApplyCanvas: (nextCanvas) => {
        canvas = nextCanvas;
        dirty = true;
        setEditorState("有未保存的布局修改");
      },
      onValidateWorkbench: async () => {
        const result = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design/validate`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ authoring })
        });
        const validation = await result.json();
        if (!result.ok || validation.ok === false) {
          setEditorState(validation.error || validation.diagnostics?.map((item) => item.message).join("; ") || "结构校验失败");
          return;
        }
        setEditorState("结构校验通过");
      },
      onSaveWorkbench: async () => {
        if (!dirty) { setEditorState("没有待保存的修改"); return; }
        const result = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ authoring, expectedProjectDigest: projectDigest })
        });
        const saved = await result.json();
        if (!result.ok) { setEditorState(saved.error || "结构保存失败"); return; }
        projectDigest = saved.projectDigest;
        dirty = false;
        setEditorState("已保存，项目已回到草案状态");
        await renderProjectDraftV2(projectId);
        await renderProjectGraph(projectId);
      },
      onToggleFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await stage.requestFullscreen();
      }
    });
  } catch (error) {
    stage.textContent = error.message || "Unable to load the project graph.";
  }
}

function mountRunTeamGraph(projectId) {
  const root = $("#project-workspace-view");
  if (!root || root.querySelector("#project-run-graph-stage")) return;
  root.insertAdjacentHTML("beforeend", "<section class=\"project-panel project-graph-preview run-team-graph\"><div class=\"panel-head\"><div><span class=\"section-kicker\">已选团队</span><h2>团队协作结构</h2><p class=\"form-status\">只读图谱，用于确认当前运行使用的角色和交接关系。</p></div><span class=\"status-chip\">只读</span></div><div id=\"project-run-graph-stage\" class=\"graph-stage studio-graph-island\" role=\"img\" aria-label=\"Selected team collaboration graph\"></div></section>");
  void renderProjectGraph(projectId, "project-run-graph-stage", true);
}

function projectRunStatusLabel(status) {
  return ({ waiting_review: "等待人工审核", paused: "已安全暂停", ready: "等待恢复", running: "运行中", planning: "准备运行", completed: "已完成", done: "已完成", failed: "运行失败", cancelled: "已取消" })[status] || status || "已完成";
}

function renderProjectRunResult(projectId, payload) {
  const result = $("#project-run-result-v2");
  if (!result || !payload?.runId) return;
  const runId = payload.runId;
  const stateStatus = payload.state?.status || payload.result?.status || "completed";
  const modeLabel = payload.mode === "sandbox" ? "隔离运行" : "流程预览";
  const nodes = (payload.runPlan?.nodeGraph || []).map((node) => `<div class="analysis-row"><strong>${esc(node.nodeId)}</strong><span>${esc(node.reviewRequired ? "审核节点" : "执行节点")}</span></div>`).join("");
  const actions = [];
  if (["running", "planning"].includes(stateStatus)) actions.push(`<button class="secondary-button" type="button" data-project-run-action="pause" data-run-id="${esc(runId)}">暂停运行</button>`);
  if (["waiting_review", "paused", "ready"].includes(stateStatus)) actions.push(`<button class="secondary-button" type="button" data-project-run-action="resume" data-run-id="${esc(runId)}">继续运行</button>`);
  if (["running", "planning", "waiting_review", "paused", "ready"].includes(stateStatus)) actions.push(`<button class="secondary-button danger-button" type="button" data-project-run-action="cancel" data-run-id="${esc(runId)}">停止运行</button>`);
  if (stateStatus === "failed") actions.push(`<button class="secondary-button" type="button" data-project-run-action="retry" data-run-id="${esc(runId)}">从快照重新运行</button>`);
  actions.push(`<a class="secondary-button" data-project-run-action="advanced" href="${esc(professionalWorkspaceUrl(projectId, "diagnosis", runId))}">打开高级工作台查看诊断</a>`);
  result.innerHTML = `<div class="run-result-card" data-run-id="${esc(runId)}"><div class="run-result-header"><strong>${esc(projectRunStatusLabel(stateStatus))}</strong><span class="run-mode">${esc(modeLabel)}</span></div><span class="run-plan-status">运行计划已固定</span><span class="run-result-meta">运行 ID：${esc(runId)} · ${(payload.runPlan?.nodeGraph || []).length} 个节点 · ${(payload.materials || []).length} 份材料</span><pre>${esc(payload.result?.finalOutput || payload.result?.status || projectRunStatusLabel(stateStatus))}</pre><div class="form-actions project-run-actions">${actions.join("")}</div><details class="run-analysis"><summary>查看执行分析</summary><p>产品站点展示运行摘要；需要逐节点输入输出、事件和故障定位时，请打开高级工作台查看同一运行。</p>${nodes}</details></div>`;
  bindProfessionalWorkspaceLink(result.querySelector('[data-project-run-action="advanced"]'), projectId, "diagnosis", runId);
  result.querySelectorAll("[data-project-run-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.projectRunAction;
    if (action === "advanced") return;
    button.disabled = true;
    const status = $("#run-status-v2");
    try {
      const endpoint = action === "retry"
        ? `/api/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/retry`
        : `/api/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/${action}`;
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: action === "retry" ? JSON.stringify({ mode: $("#project-run-mode-v2")?.value || "dry-run" }) : "{}" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "运行控制失败");
      if (action === "retry") {
        status.textContent = `已创建新的运行：${next.runId}`;
        renderProjectRunResult(projectId, next);
      } else {
        status.textContent = action === "cancel" ? "运行已停止" : "运行已恢复";
        if (next.runId && next.state) renderProjectRunResult(projectId, next);
      }
    } catch (error) {
      status.textContent = error.message || "运行控制失败";
      button.disabled = false;
    }
  }));
}

async function renderProjectDraftV2(projectId) {
  const root = $("#project-workspace-view"); root.innerHTML = '<div class="project-loading">正在读取团队项目...</div>';
  try {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`); const project = await response.json(); if (!response.ok) throw new Error(project.error || "项目不存在");
    const confirmed = project.projectStatus === "confirmed";
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← 团队仓库</a><div class="eyebrow">01 / 团队建设</div><h1>${esc(project.name)} <span class="version-badge">v${project.teamVersionNumber || 1}</span></h1><p>${esc(project.intent || "还没有填写团队目标")}</p></div><span class="project-status ${confirmed ? "confirmed" : "draft"}">${confirmed ? "团队版本已发布" : "团队草案，可继续微调"}</span></section><nav class="project-steps team-only"><a class="project-step active" href="#team"><span>01</span><strong>团队建设</strong><small>${confirmed ? "已发布版本" : "编辑和调试中"}</small></a></nav><section class="project-grid draft-grid"><article class="project-panel project-editor-panel" id="team"><div class="panel-head"><div><span class="section-kicker">团队建设</span><h2>定义职责与协作方式</h2></div><span class="count-badge">${confirmed ? "RELEASED" : "DRAFT"}</span></div><form id="project-edit-form-v2" class="compact-form"><label>团队名称<input name="name" value="${esc(project.name)}" required maxlength="120"></label><label>团队目标与流程<textarea name="intent" rows="7" maxlength="4000" required>${esc(project.intent || "")}</textarea><span class="field-hint">${esc(copy[state.locale].targetHint)}</span></label><div class="form-actions"><button class="secondary-button" type="submit">保存微调</button>${confirmed ? '<button id="reconfirm-project-v2" class="secondary-button" type="button">另存为新版本</button>' : `<button id="confirm-project-v2" class="primary-button" type="button">${esc(copy[state.locale].releaseTeam)}</button>`}</div><p class="form-status" id="project-edit-status-v2"></p></form></article><article class="project-panel project-preview-panel"><div class="panel-head"><div><span class="section-kicker">团队方案预览</span><h2>团队版本</h2></div><span class="status-chip">${confirmed ? "已发布" : (project.teamVersionStatus === "editing" ? "编辑中" : "草案")}</span></div><div class="preview-list"><div><strong>版本状态</strong><span>${confirmed ? "已发布，可用于创建项目" : "未发布，只在团队工厂中可见"}</span></div><div><strong>方案内容</strong><span>职责、角色关系、协作流程和运行规则</span></div></div><p class="preview-note">团队只负责结构和协作方式；材料、任务和运行记录在项目工作区中单独管理。</p></article></section>`;
        const previewVersion = root.querySelector(".project-preview-panel .preview-list > div:first-child span");
    if (previewVersion) previewVersion.textContent = confirmed ? "已发布版本" : "未发布，仅在团队工厂中可见";
    const previewNote = root.querySelector(".project-preview-panel .preview-note");
    if (previewNote) previewNote.textContent = "团队只负责结构、角色和协作方式。";
    root.insertAdjacentHTML("beforeend", '<section class="project-panel project-graph-preview"><div class="panel-head"><div><span class="section-kicker">团队协作结构</span><h2>团队协作结构</h2><p id="project-design-status" class="form-status">正在加载可编辑团队结构</p></div><span class="status-chip">可视化编辑</span></div><div id="project-graph-stage" class="graph-stage studio-graph-island" role="application" aria-label="Editable project team graph"></div><p class="preview-note">这里提供轻量编辑和预览；保存结构修改后，团队会回到草案状态。</p><details class="team-professional-mode"><summary><span><strong>专业模式</strong><small>结构编辑、团队调试和运行诊断</small></span><span class="status-chip">默认收起</span></summary><div class="professional-mode-content"><p>需要更细的模型、上下文、单步调试或运行诊断时，再打开高级工作台。</p><a class="secondary-button" id="project-advanced-workspace" href="#" target="_self">打开高级工作台</a></div></details></section>');
    bindProfessionalWorkspaceLink($("#project-advanced-workspace"), projectId, "design");
    root.insertAdjacentHTML("beforeend", '<section class="project-panel team-assistant-panel" id="team-assistant"></section>');
    const confirmedStatus = root.querySelector(".page-heading .project-status");
    if (confirmedStatus) {
      const status = teamStatusMeta(project.projectStatus);
      confirmedStatus.textContent = status.label;
      confirmedStatus.title = status.hint;
    }
    const previewStatus = root.querySelector(".project-preview-panel .status-chip");
    if (previewStatus) previewStatus.textContent = teamStatusMeta(project.projectStatus).label;
    const editorTitle = root.querySelector(".project-editor-panel .panel-head h2");
    if (editorTitle) editorTitle.textContent = state.locale === "en" ? "Define responsibilities and collaboration" : "定义职责与协作方式";
    void renderTeamAssistant(projectId, project);
    $$("a[data-route]").forEach((link) => link.addEventListener("click", (event) => { if (link.getAttribute("href")) { event.preventDefault(); navigate(link.getAttribute("href")); } }));
    $("#project-edit-form-v2").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), intent: form.get("intent") }) }); const payload = await result.json(); $("#project-edit-status-v2").textContent = result.ok ? (payload.projectStatus === "draft" ? "已保存，团队回到草案状态。" : "已保存。") : (payload.error || "保存失败"); if (result.ok) await renderProjectDraftV2(projectId); });
    const confirm = $("#confirm-project-v2"); confirm?.addEventListener("click", async () => { const result = await fetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/release`, { method: "POST" }); const payload = await result.json(); if (!result.ok) { $("#project-edit-status-v2").textContent = payload.error || "发布失败"; return; } await renderProjectDraftV2(projectId); });
    $("#reconfirm-project-v2")?.addEventListener("click", async () => { const result = await fetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/edit`, { method: "POST" }); const payload = await result.json(); if (!result.ok) { $("#project-edit-status-v2").textContent = payload.error || "新版本创建失败"; return; } navigate(`/studio/team/${encodeURIComponent(payload.projectId)}`); });
  } catch (error) { root.innerHTML = `<div class="run-error">${esc(error.message || "项目读取失败")}</div>`; }
}

function projectTaskStatusLabel(status) {
  return ({ queued: "待执行", running: "处理中", planning: "准备处理中", pause_requested: "正在暂停", waiting_review: "待人工审核", paused: "已暂停，可继续", ready: "等待继续", completed: "已完成", failed: "处理失败", stopped: "已停止", cancelled: "已停止", deleted: "已删除" })[status] || status || "待执行";
}

function taskActionMarkup(task) {
  const actions = [];
  if (task.status === "queued") actions.push(`<button class="secondary-button" type="button" data-task-action="start" data-task-id="${esc(task.taskId)}">开始处理</button>`);
  if (["running", "planning", "waiting_review", "ready"].includes(task.status)) actions.push(`<button class="secondary-button" type="button" data-task-action="pause" data-task-id="${esc(task.taskId)}">暂停</button>`);
  if (["pause_requested", "paused", "ready"].includes(task.status)) actions.push(`<button class="secondary-button" type="button" data-task-action="resume" data-task-id="${esc(task.taskId)}">继续</button>`);
  if (task.status === "waiting_review") actions.push(`<button class="secondary-button" type="button" data-task-action="review" data-task-id="${esc(task.taskId)}">人工审核</button>`);
  if (["queued", "running", "planning", "pause_requested", "waiting_review", "paused", "ready"].includes(task.status)) actions.push(`<button class="secondary-button danger-button" type="button" data-task-action="stop" data-task-id="${esc(task.taskId)}">停止</button>`);
  if (task.status !== "deleted") actions.push(`<button class="text-button task-delete-button" type="button" data-task-action="delete" data-task-id="${esc(task.taskId)}">删除</button>`);
  return actions.join("");
}

async function openTaskReview(projectId, taskId) {
  const dialog = document.createElement("dialog");
  dialog.className = "task-review-dialog";
  dialog.innerHTML = `<form method="dialog" class="task-review-form"><div class="panel-head"><div><span class="section-kicker">任务审核</span><h2>确认这次交付</h2></div><button class="text-button" value="cancel" aria-label="关闭">关闭</button></div><label>审核结果<select name="decision"><option value="approve">通过并继续</option><option value="rework">退回修改</option><option value="terminate">终止任务</option></select></label><label>给执行团队的反馈<textarea name="comment" rows="5" maxlength="4000" placeholder="说明通过条件、需要修改的内容或终止原因"></textarea></label><div class="form-actions"><button class="secondary-button" value="cancel">取消</button><button class="primary-button" value="submit">提交审核</button></div></form>`;
  document.body.append(dialog);
  dialog.showModal();
  const form = dialog.querySelector("form");
  form.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "submit") return;
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) { window.alert(result.error || "审核提交失败"); return; }
    dialog.close();
    dialog.remove();
    await renderProjectRunV2(projectId);
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
}

async function renderCollaborationProject(projectId, project) {
  const root = $("#project-workspace-view");
  const teams = project.mountedTeams || [];
  const tasks = (project.taskRecords || []).filter((task) => !task.deletedAt && task.status !== "deleted");
  const materials = project.materials?.materials || [];
  root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/projects" data-route="/projects">← 协作项目</a><div class="eyebrow">协作项目</div><h1>${esc(project.name)}</h1><p>${esc(project.intent || "共享工作目录，按任务推进")}</p></div><span class="project-status confirmed">${teams.length} 个团队 · ${tasks.length} 个任务</span></section><section class="project-grid collaboration-project-grid"><article class="project-panel project-resources-panel"><div class="panel-head"><div><span class="section-kicker">项目资源</span><h2>当前工作目录</h2></div><span class="count-badge">${materials.length}</span></div><p class="panel-intro">${esc(project.workspaceKey || "尚未设置工作目录")}，所有已挂载团队共享这里的项目材料。</p><div class="material-list">${materials.length ? materials.map((item) => `<div class="material-row"><strong>${esc(item.filename)}</strong><span>${esc(materialStatusLabel(item.status))} · ${item.size || 0} bytes</span></div>`).join("") : '<p class="empty-note">还没有项目材料，可以在任务开始前补充需求、背景或附件。</p>'}</div></article><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">执行团队</span><h2>已挂载团队</h2></div><span class="count-badge">${teams.length}</span></div><div class="material-list">${teams.length ? teams.map((team) => { const teamHref = String(team.teamVersionId || "").startsWith("case:") ? `/cases/${encodeURIComponent(String(team.teamVersionId).slice(5))}` : `/studio/team/${encodeURIComponent(team.teamVersionId)}`; return `<div class="material-row"><a class="team-link" href="${teamHref}" data-route="${teamHref}"><strong>${esc(team.teamName)}</strong><span>v${team.teamVersionNumber || 1} · ${esc(team.status || "可用")}</span></a></div>`; }).join("") : '<p class="empty-note">还没有挂载团队。</p>'}</div><a class="secondary-button" href="/studio/project/new" data-route="/studio/project/new">管理挂载团队</a></article><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">安排工作</span><h2>创建下一项任务</h2></div></div>${teams.length ? `<form id="collaboration-task-form" class="compact-form"><label><span>执行团队</span><select name="teamVersionId">${teams.map((team) => `<option value="${esc(team.teamVersionId)}">${esc(team.teamName)} · v${team.teamVersionNumber || 1}</option>`).join("")}</select></label><label><span>任务内容</span><textarea name="input" required rows="4" maxlength="4000" placeholder="描述这次要完成的具体工作"></textarea></label><button class="primary-button" type="submit">记录任务</button><p class="form-status" id="collaboration-task-status"></p></form>` : '<p class="empty-note">请先挂载至少一个已发布团队。</p>'}</article><article class="project-panel task-list-panel"><div class="panel-head"><div><span class="section-kicker">任务清单与运行记录</span><h2>按任务追踪交付</h2></div><span class="count-badge">${tasks.length}</span></div><p class="panel-intro">每条任务保留输入内容、执行团队、项目轮次和处理结果。暂停后可以继续，待审核时可提交反馈。</p><div class="material-list">${tasks.length ? tasks.slice().reverse().map((task) => `<div class="material-row task-record-row"><div class="task-record-main"><strong>第 ${task.roundNumber || 1} 轮 · ${esc(task.teamName || "团队")}</strong><p>${esc(task.input || "")}</p><div class="task-record-meta"><span class="status-chip ${task.status}">${esc(projectTaskStatusLabel(task.status))}</span>${task.runId ? `<span>运行 ${esc(task.runId)}</span>` : ""}${task.review?.comment ? `<span>反馈：${esc(task.review.comment)}</span>` : ""}</div></div><div class="task-record-actions">${taskActionMarkup(task)}</div></div>`).join("") : '<p class="empty-note">还没有任务记录。先描述一项具体工作。</p>'}</div></article></section>`;
  root.querySelectorAll("a[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.getAttribute("href")); }));
  $("#collaboration-task-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const status = $("#collaboration-task-status"); const payload = Object.fromEntries(new FormData(form).entries()); payload.idempotencyKey = crypto.randomUUID(); const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) { status.textContent = result.error || "任务创建失败"; return; } status.textContent = "任务已加入清单"; await renderProjectRunV2(projectId); });
  root.querySelectorAll("[data-task-action]").forEach((button) => button.addEventListener("click", async () => { const action = button.dataset.taskAction; const taskId = button.dataset.taskId; if (action === "review") { await openTaskReview(projectId, taskId); return; } if (action === "delete" && !window.confirm("删除后任务将从清单隐藏，运行快照仍会保留。确定删除吗？")) return; button.disabled = true; const endpoint = action === "delete" ? `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}` : `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/${action}`; const response = await fetch(endpoint, { method: action === "delete" ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: action === "delete" ? undefined : "{}" }); const result = await response.json(); if (!response.ok) window.alert(result.error || "任务操作失败"); await renderProjectRunV2(projectId); }));
}

async function renderProjectRunV2(projectId) {
  const root = $("#project-workspace-view"); root.innerHTML = '<div class="project-loading">正在读取运行工作区...</div>';
  try {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`); const project = await response.json(); if (!response.ok) throw new Error(project.error || "项目不存在");
    if (project.projectType === "collaboration") {
      await renderCollaborationProject(projectId, project);
      return;
    }
    navigate(`/studio/team/${encodeURIComponent(projectId)}`);
  } catch (error) { root.innerHTML = `<div class="run-error">${esc(error.message || "运行工作区读取失败")}</div>`; }
}

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
  if (path === "/studio/new") {
    setView("new-project");
    void renderNewProject();
    return;
  }
  if (path === "/studio/project/new") {
    setView("new-project");
    void renderProjectCreate();
    return;
  }
  const teamMatch = path.match(/^\/studio\/team\/([a-z0-9-]+)$/);
  if (teamMatch) {
    setView("project-workspace");
    void renderProjectDraftV2(teamMatch[1]).then(() => renderProjectGraph(teamMatch[1]));
    return;
  }
  const projectRunMatch = path.match(/^\/studio\/project\/([a-z0-9-]+)\/run$/);
  if (projectRunMatch) {
    setView("project-workspace");
    void renderProjectRunV2(projectRunMatch[1]);
    return;
  }
  if (path === "/studio" && new URLSearchParams(location.search).has("team")) {
    const id = new URLSearchParams(location.search).get("team");
    if (state.cases.some((entry) => entry.id === id)) state.selected = id;
  }
  if (path === "/projects") { state.view = "projects"; void renderCollaborationProjects(); }
  else if (path === "/studio") { state.view = "workspace"; void renderProjectLibrary(); }
  else if (path === "/factory") { state.view = "factory"; void renderTeamFactory(); }
  else if (path === "/platform") { state.view = "platform"; void renderPlatformConfig(); }
  else if (path === "/examples") state.view = "examples";
  else if (path === "/history") state.view = "history";
  setView(state.view);
  if (!["/projects", "/studio", "/factory", "/platform", "/examples", "/history", "/cases"].includes(path)) history.replaceState({}, "", "/projects");
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
  if (id) state.history = [{ id, caseId: item.id, prompt, title: text(item.title), durationMs: result.durationMs, status: result.status, createdAt: new Date().toISOString(), result }, ...state.history.filter((entry) => entry.id !== id)].slice(0, 12);
}
async function runSelected() {
  const item = state.cases.find((entry) => entry.id === state.selected);
  const prompt = $("#task-input").value.trim();
  if (!prompt) { $("#task-input").focus(); showToast(copy[state.locale].inputRequired); return; }
  const button = $("#run-button"); button.disabled = true;
  $("#run-content").innerHTML = `<div class="run-loading"><span class="spinner"></span><span>${esc(copy[state.locale].running)}</span></div>`; openDrawer();
  try {
    const response = await fetch("/api/v1/demo-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: item.id, prompt, locale: state.locale }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || copy[state.locale].networkError);
    if (result.status !== "done") throw new Error(`${copy[state.locale].runFailed}: ${result.status || "unknown"}`);
    openRun(result, item, prompt);
  } catch (error) { $("#run-content").innerHTML = `<div class="run-error">${esc(error.message || copy[state.locale].networkError)}</div>`; }
  finally { button.disabled = false; }
}
async function renderHistory() {
  const root = $("#history-list"); if (!root) return;
  root.innerHTML = '<div class="project-loading">正在读取项目运行记录...</div>';
  try {
    const response = await fetch("/api/v1/runs/recent?limit=50"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取运行记录");
    state.recentRuns = payload.runs || [];
    if (!state.recentRuns.length) { root.innerHTML = `<div class="history-empty"><strong>${esc(copy[state.locale].noHistory)}</strong></div>`; return; }
    root.innerHTML = state.recentRuns.map((run) => {
      const mode = run.mode === "sandbox" ? (state.locale === "en" ? "Isolated run" : "隔离运行") : (state.locale === "en" ? "Preview" : "流程预览");
      const status = projectRunStatusLabel(run.status || "记录");
      return `<article class="history-row"><span class="history-icon">O</span><div class="history-main"><div class="history-title-line"><strong>${esc(run.teamName || "团队")} <span class="version-badge">v${run.teamVersionNumber || 1}</span></strong><span class="history-status">${esc(status)}</span></div><p><span class="history-tag">${esc(run.projectName || "项目")}</span><span class="history-tag">${esc((copy[state.locale].runRound || "第 {round} 轮").replace("{round}", String(run.roundNumber || 1)))}</span><span class="history-tag">${esc(run.workspaceKey || "工作目录未命名")}</span><span class="history-tag">${esc(mode)}</span></p><small>${run.updatedAt ? new Date(run.updatedAt).toLocaleString(state.locale) : ""}</small></div><div class="history-actions"><a class="text-button" href="/studio/project/${encodeURIComponent(run.projectId)}/run" data-route="/studio/project/${encodeURIComponent(run.projectId)}/run">${esc(copy[state.locale].historyRestore)}</a><a class="text-button" href="${esc(professionalWorkspaceUrl(run.projectId, "diagnosis", run.runId))}" target="_self">${esc(copy[state.locale].advancedWorkspace)}</a></div></article>`;
    }).join("");
    root.querySelectorAll("a[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.getAttribute("href")); }));
  } catch (error) { root.innerHTML = `<div class="run-error">${esc(error.message || "无法读取运行记录")}</div>`; }
}
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2300); }
// Run actions are rendered with the response that created the run. Keeping the
// run ID in the result avoids deriving control state from human-readable text.
async function init() {
  let savedTheme = "light";
  try { savedTheme = localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light"; } catch {}
  applySiteTheme(savedTheme, false);
  const [response, configResponse] = await Promise.all([fetch("/api/v1/cases"), fetch("/api/v1/config")]); if (!response.ok) throw new Error("Unable to load team cases.");
  const payload = await response.json();
  if (configResponse.ok) {
    const config = await configResponse.json();
    if (typeof config.visUrl === "string" && /^https?:\/\//i.test(config.visUrl)) state.visUrl = config.visUrl.replace(/\/$/, "");
  }
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
  $$('[data-site-theme-choice]').forEach((button) => button.addEventListener("click", () => applySiteTheme(button.dataset.siteThemeChoice)));
  $("#task-input")?.addEventListener("input", updateCount); $("#run-button")?.addEventListener("click", runSelected);
  $("#edit-task-button")?.addEventListener("click", () => { $("#task-input")?.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("#clear-history")?.addEventListener("click", () => { state.history = []; try { localStorage.removeItem("ogs-run-history"); } catch {} renderHistory(); });
  $$('[data-close-drawer]').forEach((element) => element.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
  applyLocale();
  const team = new URLSearchParams(location.search).get("team"); if (team && state.cases.some((item) => item.id === team)) state.selected = team;
  if (!isProjectRoute() && $("#task-input")) selectCase(state.selected);
  syncRoute(); updateCount();
}
init().catch((error) => { document.body.innerHTML = `<main class="fatal-error">${esc(error.message)}</main>`; });
