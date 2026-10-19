import { state, beginPageRequest, isCurrentRequest, isAbort, setDirty, clearDirty, isDirty } from "../state.js";
import { pageFetch } from "../api.js";
import { $, $$, esc, icon } from "../components/dom.js";
import { bindDirtyForm, confirmAction, lockBodyScroll, trapFocus } from "../components/interaction.js";
import { createRunPoller, isTerminalRunStatus } from "../components/run-poll.js";
import { labelEvent as localizedEventLabel, taskExample, text } from "../i18n.js";
import { createRouter } from "../router.js";
function professionalWorkspaceUrl(projectId, lifecycle = "run", runId = "", collaborationProjectId = "", taskId = "") {
  try {
    const url = new URL(String(state.visUrl || ""));
    if (!/^https?:$/.test(url.protocol)) return "";
    if (projectId) url.searchParams.set("projectId", projectId);
    if (runId) url.searchParams.set("runId", runId);
    if (collaborationProjectId) url.searchParams.set("collaborationProjectId", collaborationProjectId);
    if (taskId) url.searchParams.set("taskId", taskId);
    url.searchParams.set("diagnostic", "projects");
    url.searchParams.delete("panel");
    if (lifecycle) url.searchParams.set("lifecycle", lifecycle);
    return url.toString();
  } catch { return ""; }
}
function bindProfessionalWorkspaceLink(link, projectId, panel = "diagnosis", runId = "") {
  if (!link) return;
  const href = professionalWorkspaceUrl(projectId, panel, runId);
  if (href) { link.href = href; link.target = "_blank"; link.rel = "noopener"; return; }
  link.removeAttribute("href");
  link.addEventListener("click", (event) => { event.preventDefault(); showToast(state.locale === "en" ? "The technical workspace is temporarily unavailable." : "技术运行工作台暂时不可用"); });
}
const themeStorageKey = "ogs.visualizer.theme";
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
  navExamples: "OGS Studio",
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
  navExamples: "OGS Studio",
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
  navTeams: "团队仓库", navExamples: "OGS Studio", libraryEyebrow: "团队仓库", libraryTitle: "已发布团队版本",
  libraryIntro: "选择已经发布的团队版本创建项目。团队结构和项目工作目录分开管理。", factoryEyebrow: "OGS Studio",
  factoryTitle: "专业团队开发", factoryIntro: "在 OGS Studio 中编辑、调试并发布团队版本。",
  noReleasedTeams: "还没有已发布的团队版本", noFactoryTeams: "OGS Studio 中还没有团队", createTeam: "创建团队",
  continueEditing: "继续编辑", editAsVersion: "编辑为新版本", releaseVersion: "发布版本", archiveVersion: "归档版本",
  exportAsset: "导出团队", versionLabel: "版本", releasedLabel: "已发布", editingLabel: "编辑中", draftLabel: "草案",
  archivedLabel: "已归档", useTeam: "使用团队创建项目", createProject: "创建项目", repositoryEmptyHint: "先在 OGS Studio 创建并发布一支团队。",
  factoryEmptyHint: "用自然语言创建团队草稿，再检查并发布。", runRound: "任务 {round}", clearHistory: "清理本机缓存",
  historyIntro: "按任务查看团队运行结果。清理只影响本机缓存，不会删除项目记录。",
  noHistory: "还没有项目运行记录。完成一次项目任务后，这里会显示团队、版本和任务序号。",
  targetHint: "请包含目标、角色关系、大致流程、输入材料和期望输出，便于自动生成团队结构。",
    releaseTeam: "发布团队版本 →", advancedWorkspace: "查看全流程"
});
Object.assign(copy.en, {
  navTeams: "Team repository", navExamples: "OGS Studio", libraryEyebrow: "Team repository", libraryTitle: "Released team versions",
  libraryIntro: "Choose a released team version when creating a project. Team design and project workspaces stay separate.", factoryEyebrow: "OGS Studio",
  factoryTitle: "Professional team development", factoryIntro: "Edit, debug, and release team versions in OGS Studio.",
  noReleasedTeams: "No released team versions yet", noFactoryTeams: "No teams in OGS Studio yet", createTeam: "Create team",
  continueEditing: "Continue editing", editAsVersion: "Edit as new version", releaseVersion: "Release version", archiveVersion: "Archive version",
  exportAsset: "Export team", versionLabel: "Version", releasedLabel: "Released", editingLabel: "Editing", draftLabel: "Draft",
  archivedLabel: "Archived", useTeam: "Create project with team", createProject: "Create project", repositoryEmptyHint: "Create and release a team in OGS Studio first.",
  factoryEmptyHint: "Describe a team in natural language, then review and release the draft.", runRound: "Task {round}", clearHistory: "Clear local cache",
  historyIntro: "Review team runs by task. Clearing only affects this browser cache, not project records.",
  noHistory: "No project runs yet. Complete a project task to see its team, version, and task number here.",
  targetHint: "Include the goal, role relationships, rough workflow, inputs, and expected outputs so the team structure can be generated accurately.",
    releaseTeam: "Release team version →", advancedWorkspace: "View full run"
});

function labelEvent(event) { return localizedEventLabel(event, copy); }

function readHistory() { return []; }
function saveHistory() { return undefined; }
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
    const response = await pageFetch(`/api/v1/cases/${encodeURIComponent(item.id)}/graph?locale=${encodeURIComponent(state.locale)}`);
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
  } catch (error) { if (isAbort(error)) return;
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
}

async function renderDetailGraph(item) {
  const stage = $("#detail-graph-stage");
  if (!stage || !window.OGSStudioGraphBundle?.mountStudioX6Bridge) return;
  try {
    const response = await pageFetch("/api/v1/cases/" + encodeURIComponent(item.id) + "/graph?locale=" + encodeURIComponent(state.locale));
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
    navigate(action === "use" ? "/studio/project/new?team=" + encodeURIComponent(payload.projectId) : "/studio/team/" + encodeURIComponent(payload.projectId));
  } catch (error) { if (isAbort(error)) return;
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
    || path === "/studio/project/new"
    || path === "/factory/new"
    || /^\/studio\/project\/[a-z0-9-]+\/(?:run|teams)$/.test(path)
    || /^\/studio\/team\/[a-z0-9-]+$/.test(path);
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
const router = createRouter({ syncRoute, canLeave: confirmRouteLeave, onRouteChange: closeActiveDialogs });
function navigate(path) { router.navigate(path); }

async function confirmRouteLeave() {
  if (!isDirty()) return true;
  const confirmed = await confirmAction({
    title: state.locale === "en" ? "Discard unsaved changes?" : "放弃未保存的修改？",
    message: state.locale === "en" ? "Your changes will be lost if you leave this page." : "离开当前页面后，尚未保存的修改将被放弃。",
    confirmLabel: state.locale === "en" ? "Discard and leave" : "放弃并离开",
    cancelLabel: state.locale === "en" ? "Stay" : "留在当前页面"
  });
  if (confirmed) clearDirty();
  return confirmed;
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
async function renderProjectCreate() {
  const root = $("#new-project-view");
  root.innerHTML = `<section class="page-heading project-create-heading"><div><a class="detail-back" href="/projects" data-route="/projects">← 协作项目</a><div class="eyebrow">创建协作项目</div><h1>先建立项目，再安排团队</h1><p>项目会自动准备共享资料空间。选择至少一个已发布团队，之后可以继续添加团队并运行不同任务。</p></div></section><section class="project-builder project-create-builder"><form id="collaboration-project-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">项目基础信息</span><h2>项目名称与概述</h2><p>项目资料和团队会在这里统一管理。</p></div><label>项目名称<input name="name" required maxlength="120" placeholder="例如：新产品上市项目"></label><label>项目概述（选填）<textarea name="overview" rows="4" maxlength="4000" placeholder="描述项目要完成的事情、阶段目标和预期成果"></textarea></label><fieldset class="builder-choice-group"><legend>挂载团队 <span>至少选择一个</span></legend><div id="project-team-options" class="builder-choice-grid"><span class="project-loading">正在读取团队仓库...</span></div></fieldset><div class="new-team-form-footer"><p class="form-hint">只有已发布的团队版本可以挂载到项目；项目创建后可以在项目内管理团队。</p><div class="form-actions"><a class="secondary-button" href="/projects" data-route="/projects">取消</a><button class="primary-button" type="submit">创建项目</button></div></div><p class="form-status" id="collaboration-project-status" role="status" aria-live="polite"></p></form></section>`;
  const options = $("#project-team-options");
  options.insertAdjacentHTML("beforebegin", '<div class="team-picker-toolbar"><label class="team-picker-search"><span class="sr-only">搜索团队</span><input id="project-team-search" type="search" placeholder="搜索团队名称或目标" autocomplete="off"></label><span id="project-team-count" class="team-picker-count">已选 0 个</span></div>');
  try {
    const response = await pageFetch("/api/v1/team-repository"); const payload = await response.json(); if (!isCurrentRequest(state.activeRequest)) return; if (!response.ok) throw new Error(payload.error || "无法读取团队仓库");
    const teams = payload.teams || [];
    const selectableTeams = teams.filter((team) => team.teamVersionStatus === "released");
    options.innerHTML = selectableTeams.length ? selectableTeams.map((team) => `<label class="builder-choice"><input type="checkbox" name="teamVersionId" value="${esc(team.projectId)}"><strong>${esc(team.name)} · v${team.teamVersionNumber || 1}${team.builtIn ? " · 内置" : ""}</strong><span>${esc((team.overview || "").slice(0, 120))}</span></label>`).join("") : `<p class="empty-note">暂无可用团队，请先到团队仓库创建并发布团队。</p>`;
    const search = $("#project-team-search"); const count = $("#project-team-count");
    const refreshTeamPicker = () => { const query = String(search?.value || "").trim().toLocaleLowerCase(); let selectedCount = 0; options.querySelectorAll(".builder-choice").forEach((card) => { const input = card.querySelector("input"); const matches = !query || card.textContent.toLocaleLowerCase().includes(query); card.hidden = !matches; card.classList.toggle("selected", Boolean(input?.checked)); if (input?.checked) selectedCount += 1; }); if (count) count.textContent = `已选 ${selectedCount} 个`; };
    search?.addEventListener("input", refreshTeamPicker); options.querySelectorAll("input[type=checkbox]").forEach((input) => input.addEventListener("change", refreshTeamPicker));
    const preselectedTeam = new URLSearchParams(location.search).get("team");
    if (preselectedTeam) options.querySelector(`input[value="${CSS.escape(preselectedTeam)}"]`)?.setAttribute("checked", "checked");
    refreshTeamPicker();
    const collaborationProjectForm = $("#collaboration-project-form");
    bindDirtyForm(collaborationProjectForm, () => setDirty("collaboration-project-form"));
    collaborationProjectForm.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const selected = form.getAll("teamVersionId"); const status = $("#collaboration-project-status"); const submit = event.currentTarget.querySelector("button[type=submit]"); if (!selected.length) { status.textContent = "请至少选择一个团队。"; return; } submit.disabled = true; status.textContent = "正在创建项目..."; try { const createResponse = await pageFetch("/api/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), overview: form.get("overview"), teamVersionIds: selected }) }); const project = await createResponse.json(); if (!createResponse.ok) throw new Error(project.error || "项目创建失败"); clearDirty("collaboration-project-form"); navigate(`/studio/project/${encodeURIComponent(project.projectId)}/run`); } catch (error) { if (isAbort(error)) return; status.textContent = error.message || "项目创建失败"; submit.disabled = false; } });
  } catch (error) { if (isAbort(error)) return; if (error?.name !== "AbortError") options.innerHTML = `<p class="run-error">${esc(error.message || "无法读取团队仓库")}</p>`; }
}
async function renderNewProject() {
  const root = $("#new-project-view");
  root.innerHTML = [
    '<section class="page-heading new-team-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← 团队仓库</a><div class="eyebrow">Team Studio · Natural</div><h1>先说清团队要完成什么</h1><p>提交目标后，团队助手会先整理你的意图，再通过对话完善职责、协作关系和交付结果。</p></div></section>',
    '<section class="project-builder new-team-builder">',
    `<form id="new-project-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">团队草案</span><h2>你希望团队完成什么？</h2><p>从目标开始，名称和协作偏好之后都可以修改。</p></div><label>团队名称<input name="name" required maxlength="120" autocomplete="organization" placeholder="例如：产品研究团队"></label><label>团队目标<textarea name="overview" required maxlength="4000" rows="6" placeholder="例如：目标是分析竞品资料并提出行动建议；研究员负责资料整理，分析员负责比较，负责人汇总并审核；流程为收集材料→独立分析→汇总审核；输入包括竞品文档，输出为带依据的建议清单。"></textarea><small class="field-hint">${esc(copy[state.locale].targetHint)}</small></label><fieldset class="builder-choice-group"><legend>选择协作方式 <span>可选</span></legend><div class="builder-choice-grid"><button class="builder-choice" type="button" data-builder-choice="顺序接力：每个角色完成后交给下一个" aria-pressed="false"><strong>顺序接力</strong><span>适合步骤明确、需要逐步交接的任务</span></button><button class="builder-choice" type="button" data-builder-choice="独立分析后汇总：多个角色分别研究，最后统一整理" aria-pressed="false"><strong>分头分析，再汇总</strong><span>适合需要多个角度并行研究的任务</span></button><button class="builder-choice" type="button" data-builder-choice="负责人协调：由一个负责人安排和检查其他角色" aria-pressed="false"><strong>负责人协调</strong><span>适合过程中需要统筹与检查的任务</span></button></div></fieldset><div class="new-team-form-footer"><p class="form-hint">创建后可继续用自然语言调整角色、流程和输出要求。</p><div class="form-actions"><button class="primary-button" type="submit">创建团队草案 <span aria-hidden="true">→</span></button></div></div><p class="form-status" id="new-project-status" role="status" aria-live="polite"></p></form></section>`
  ].join("");
  const choiceLegend = root.querySelector(".builder-choice-group legend span");
  if (choiceLegend) choiceLegend.textContent = "可选，再次点击可取消";
  $$("[data-builder-choice]").forEach((choice) => choice.addEventListener("click", () => {
    const wasSelected = choice.getAttribute("aria-pressed") === "true";
    $$('[data-builder-choice]').forEach((item) => { item.classList.remove("selected"); item.setAttribute("aria-pressed", "false"); });
    if (!wasSelected) { choice.classList.add("selected"); choice.setAttribute("aria-pressed", "true"); }
    setDirty("new-project-form");
  }));
  const newProjectForm = $("#new-project-form");
  bindDirtyForm(newProjectForm, () => setDirty("new-project-form"));
  newProjectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = $("#new-project-status");
    status.textContent = "正在创建团队草案…";
    try {
      const preference = $("[data-builder-choice].selected")?.dataset.builderChoice;
      const overview = [String(form.get("overview") || "").trim(), preference ? `协作偏好：${preference}` : ""].filter(Boolean).join("\n\n");
      const response = await pageFetch("/api/v1/team-factory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), overview, locale: state.locale }) });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "项目创建失败");
      clearDirty("new-project-form");
      state.projectId = project.projectId;
      navigate("/studio/team/" + encodeURIComponent(project.projectId));
    } catch (error) { if (isAbort(error)) return;
      status.textContent = error.message || "项目创建失败";
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
  try {
    const designResponse = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design`);
    latestDesign = await designResponse.json();
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
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, systemSource: latestDesign?.systemSource, authoring: latestDesign?.authoring }) });
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
      preview.innerHTML = `<div class="assistant-preview"><div class="preview-list"><div><strong>当前状态</strong><span>${esc(payload.mode || "draft")}</span></div><div><strong>待确认问题</strong><span>${payload.unresolvedItems?.length || 0}</span></div></div>${payload.assumptions?.length ? `<p class="form-hint">假设：${esc(payload.assumptions.join("；"))}</p>` : ""}${questions ? `<div class="assistant-question-list">${questions}</div>` : ""}${patchReady ? '<div class="form-actions"><button type="button" class="primary-button" id="team-assistant-apply">应用到团队草案</button></div>' : ""}</div>`;
      preview.querySelectorAll("[data-assistant-choice]").forEach((button) => button.addEventListener("click", () => send(button.dataset.assistantChoice)));
      $("#team-assistant-apply")?.addEventListener("click", async (event) => {
        const patch = lastResponse?.authoringPatch?.authoring;
        if (!patch) return;
        const applyButton = event.currentTarget;
        applyButton.disabled = true;
        status.textContent = "正在保存团队草案…";
        try {
          const save = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ authoring: patch, expectedProjectDigest: latestDigest }) });
          const saved = await save.json();
          if (!save.ok) throw new Error(saved.error || "团队草案保存失败");
          latestDigest = saved.projectDigest || latestDigest;
          latestDesign = saved;
          clearDirty("team-assistant");
          status.textContent = "修改已应用，团队回到草案状态，请检查后确认。";
          await renderProjectDraft(projectId, pageRequest);
          await renderProjectGraph(projectId, "project-graph-stage", false, pageRequest);
          state.teamStudioDialog?.("assistant");
          const refreshedStatus = $("#team-assistant-status");
          if (refreshedStatus) refreshedStatus.textContent = status.textContent;
        } catch (error) {
          if (isAbort(error)) return;
          status.textContent = error.message || "团队草案保存失败";
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
    : `<a class="primary-button" href="/studio/team/${id}" data-route="/studio/team/${id}">${esc(copy[state.locale].continueEditing)} →</a><button class="secondary-button" type="button" data-team-action="release" data-team-id="${id}">${esc(copy[state.locale].releaseVersion)}</button>`;
  return `<article class="team-version-card project-asset-surface" data-team-status="${esc(meta.status)}"><div class="asset-card-top"><span class="asset-mark">O</span><span class="status-chip ${esc(meta.status)}">${esc(meta.label)}</span></div><div class="asset-title-row"><h2>${title}</h2><span class="version-badge">${esc(meta.version)}</span></div><p>${esc(team.overview || "")}</p><div class="asset-card-meta"><span>${esc(meta.hint)}</span><span>${team.updatedAt ? new Date(team.updatedAt).toLocaleDateString(state.locale) : ""}</span></div><div class="asset-card-actions">${actions}</div></article>`;
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
  const nodes = points.map(({ role, x, y }) => `<g><rect x="${x - 25}" y="${y - 11}" width="50" height="22" rx="5" /><text x="${x}" y="${y + 3}" text-anchor="middle">${esc(text(role.label)).slice(0, 8)}</text></g>`).join("");
  return `<svg class="team-graph-thumbnail" viewBox="0 0 360 128" aria-hidden="true"><g class="thumbnail-edges">${edges}</g><g class="thumbnail-nodes">${nodes}</g></svg>`;
}
function bindTeamActions(root) {
  const pageRequest = state.activeRequest;
  root.querySelectorAll("[data-team-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.teamAction; const id = button.dataset.teamId; button.disabled = true;
    try {
      const endpoint = action === "edit" ? `/api/v1/team-versions/${id}/edit` : `/api/v1/team-versions/${id}/${action}`;
      const response = await pageFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "操作失败");
      if (action === "edit") navigate(`/studio/team/${encodeURIComponent(payload.projectId)}`);
      else { showToast(action === "release" ? "团队版本已发布" : "团队版本已归档"); if (state.view === "factory") await renderTeamFactory(pageRequest); else await renderProjectLibrary(pageRequest); }
    } catch (error) { if (isAbort(error)) return; showToast(error.message || "操作失败"); button.disabled = false; }
  }));
}
async function renderProjectLibrary() {
  const root = $("#workspace-view");
  const importLabelText = () => { const label = root.querySelector(".import-project-button"); if (label?.firstChild) label.firstChild.textContent = "导入团队"; };
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">${esc(copy[state.locale].libraryEyebrow)}</div><h1>${esc(copy[state.locale].libraryTitle)}</h1><p>${esc(copy[state.locale].libraryIntro)}</p></div><div class="heading-actions"><label class="secondary-button import-project-button">导入团队<input id="project-import-file" type="file" accept="application/json" hidden></label><a class="primary-button" href="/factory" data-route="/factory">${esc(copy[state.locale].createTeam)}</a></div></section><section class="project-library-toolbar"><div><strong>${esc(copy[state.locale].releasedLabel)}</strong><span>${esc(copy[state.locale].repositoryEmptyHint)}</span></div><div class="project-library-filters"><label><span class="sr-only">搜索团队</span><input id="project-library-search" type="search" placeholder="搜索团队名称或目标"></label></div></section><div id="project-library-grid" class="project-library-grid"><div class="project-loading">正在读取团队仓库...</div></div>`;
  importLabelText();
  const grid = $("#project-library-grid");
  root.querySelector(".project-library-toolbar")?.insertAdjacentHTML("afterend", `<section class="classic-team-section repository-classic-section"><div class="section-header"><div><div class="section-kicker">${esc(state.locale === "en" ? "Repository examples" : "典型团队")}</div><h2>${esc(state.locale === "en" ? "Ready-made collaboration patterns" : "开箱即用的协作方式")}</h2><p class="section-description">${esc(state.locale === "en" ? "Inspect a built-in team graph, then decide whether to try it or copy it into a new version." : "先查看内置团队图谱，再决定试用流程或复制为新版本。")}</p></div></div><div class="classic-team-grid">${state.cases.map((item) => `<article class="classic-team-card" data-accent="${esc(item.accent)}"><a class="classic-team-preview" href="/cases/${encodeURIComponent(item.id)}" data-route="/cases/${encodeURIComponent(item.id)}" aria-label="${esc(text(item.title))}">${caseGraphThumbnail(item)}<span class="classic-team-arrow" aria-hidden="true">↗</span></a><div class="classic-team-card-top"><span class="asset-mark">${esc(icon[item.icon] || "✦")}</span><span class="status-chip">${esc(state.locale === "en" ? "Built-in" : "内置版本")}</span></div><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><div class="classic-team-meta"><span>${esc(item.duration?.[state.locale] || item.duration?.["zh-CN"] || "")}</span><span>${item.roles.length} ${state.locale === "en" ? "roles" : "个角色"}</span></div></article>`).join("")}</div></section>`);
  root.querySelectorAll("[data-classic-team]").forEach((button) => button.addEventListener("click", async () => {
    const caseId = button.dataset.classicTeam; button.disabled = true;
    try {
      const response = await pageFetch(`/api/v1/cases/${encodeURIComponent(caseId)}/use`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: state.locale }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法使用内置团队");
      navigate(`/studio/project/new?team=${encodeURIComponent(payload.projectId)}`);
    } catch (error) { if (isAbort(error)) return; showToast(error.message || "无法使用内置团队"); button.disabled = false; }
  }));
  try {
    const response = await pageFetch("/api/v1/team-repository"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取团队仓库");
    const teams = (payload.teams || []).filter((team) => !team.builtIn);
    grid.innerHTML = teams.length ? teams.map((team) => teamCard(team, "repository")).join("") : `<div class="empty-projects"><strong>${esc(copy[state.locale].noReleasedTeams)}</strong><p>${esc(copy[state.locale].repositoryEmptyHint)}</p><a class="primary-button" href="/factory" data-route="/factory">${esc(copy[state.locale].createTeam)} →</a></div>`;
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
          navigate(`/studio/team/${encodeURIComponent(preview.duplicate.projectId)}`);
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
        navigate(`/studio/team/${encodeURIComponent(result.projectId)}`);
      } catch (error) { if (isAbort(error)) return; showToast(error.message || "导入失败"); }
    });
  } catch (error) { if (isAbort(error)) return; grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取团队仓库")}</div>`; }
}
async function renderCollaborationProjects() {
  const root = $("#projects-view");
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">协作项目</div><h1>按任务推进项目</h1><p>一个项目可以挂载多个团队，统一管理资料、任务和运行结果。</p></div><div class="heading-actions"><a class="primary-button" href="/studio/project/new" data-route="/studio/project/new">创建协作项目</a></div></section><div id="collaboration-project-grid" class="project-library-grid"><div class="project-loading">正在读取协作项目...</div></div>`;
  const grid = $("#collaboration-project-grid");
  try {
    const response = await pageFetch("/api/v1/projects"); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法读取协作项目");
    const projects = payload.projects || [];
    grid.innerHTML = projects.length ? projects.map((project) => { const teams = project.mountedTeams || []; const taskCount = project.taskRecords?.length || 0; return `<article class="project-asset-card collaboration-project-card"><div class="asset-card-top"><span class="asset-mark">⌘</span><span class="status-chip ${esc(project.projectStatus || "draft")}">${esc(taskCount ? "进行中" : "待开始")}</span></div><div class="asset-title-row"><h2>${esc(project.name)}</h2><span class="version-badge">${teams.length} 个团队</span></div><p>${esc(project.overview || "共享资料，按任务记录项目进展")}</p><div class="asset-card-meta"><span>${teams.length ? "已配置团队" : "待配置团队"}</span><span>${taskCount} 个任务</span></div><div class="asset-card-actions"><a class="primary-button" href="/studio/project/${encodeURIComponent(project.projectId)}/run" data-route="/studio/project/${encodeURIComponent(project.projectId)}/run">打开项目 →</a></div></article>`; }).join("") : `<div class="empty-projects"><strong>还没有协作项目</strong><p>先创建项目，再挂载团队并开始任务。</p><a class="primary-button" href="/studio/project/new" data-route="/studio/project/new">创建协作项目 →</a></div>`;
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
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio/project/${encodeURIComponent(projectId)}/run" data-route="/studio/project/${encodeURIComponent(projectId)}/run">← 返回项目</a><div class="eyebrow">协作项目 · 团队管理</div><h1>${esc(project.name)}</h1><p>${esc(project.overview || "选择项目要使用的已发布团队")}</p></div><span class="project-status confirmed">${mounted.length} 个团队</span></section><section class="project-builder project-team-manager"><form id="project-team-management-form" class="project-form"><div class="new-team-form-heading"><span class="section-kicker">项目团队</span><h2>管理挂载团队</h2><p>这里修改的是当前项目，不会创建新项目。运行中的任务完成后才能调整团队。</p></div><fieldset class="builder-choice-group"><legend>已发布团队 <span>至少选择一个</span></legend><div id="project-managed-team-options" class="builder-choice-grid">${teams.length ? teams.map((team) => { const id = team.projectId || team.teamVersionId; const selected = mounted.some((item) => item.teamVersionId === id); return `<label class="builder-choice${selected ? " selected" : ""}"><input type="checkbox" name="teamVersionId" value="${esc(id)}"${selected ? " checked" : ""}><strong>${esc(team.teamName || team.name)} · v${team.teamVersionNumber || 1}${team.builtIn ? " · 内置" : ""}</strong><span>${esc((team.overview || "").slice(0, 140))}</span></label>`; }).join("") : '<p class="empty-note">暂无可用的已发布团队。</p>'}</div></fieldset><div class="new-team-form-footer"><p class="form-hint" id="project-team-management-hint">保存后会更新项目定义摘要；当前运行不会被改变。</p><div class="form-actions"><a class="secondary-button" href="/studio/project/${encodeURIComponent(projectId)}/run" data-route="/studio/project/${encodeURIComponent(projectId)}/run">取消</a><button class="primary-button" type="submit">保存团队配置</button></div></div><p class="form-status" id="project-team-management-status" role="status" aria-live="polite"></p></form></section>`;
    const form = $("#project-team-management-form");
    const options = $("#project-managed-team-options");
    const addVersion = new URLSearchParams(window.location.search).get("addVersion");
    if (addVersion) {
      const candidate = options?.querySelector(`input[value="${CSS.escape(addVersion)}"]`);
      if (candidate) {
        candidate.checked = true;
        candidate.closest(".builder-choice")?.classList.add("selected");
        const message = document.createElement("p");
        message.className = "form-hint";
        message.setAttribute("role", "status");
        message.textContent = "新发布的团队版本已预选；保存后才会挂载到项目。";
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
      const selected = new FormData(form).getAll("teamVersionId");
      if (!selected.length) { status.textContent = "请至少保留一个团队。"; return; }
      submit.disabled = true;
      status.textContent = "正在保存团队配置…";
      try {
        const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/teams`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamVersionIds: selected }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "团队配置保存失败");
        clearDirty("project-team-management-form");
        navigate(`/studio/project/${encodeURIComponent(projectId)}/run`);
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
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">平台配置</div><h1>运行底座与默认设置</h1><p>自动检查可用的运行底座和模型，为团队角色选择稳定的默认执行方式。</p></div><div class="heading-actions"><button id="platform-discovery-refresh" class="secondary-button" type="button">刷新底座与模型</button></div></section><section class="platform-config-grid"><article class="project-panel platform-discovery-panel"><div class="panel-head"><div><span class="section-kicker">运行底座</span><h2>发现到的服务</h2></div></div><div id="platform-providers" class="platform-list">正在读取...</div></article><article class="project-panel platform-discovery-panel"><div class="panel-head"><div><span class="section-kicker">模型目录</span><h2>发现到的模型</h2></div></div><div id="platform-models" class="platform-list">正在读取...</div></article><article class="project-panel platform-settings-panel"><div class="panel-head"><div><span class="section-kicker">默认值</span><h2>执行设置</h2></div><p class="panel-note" id="platform-discovery-meta">正在读取探测时间...</p></div><form id="platform-settings-form" class="compact-form"><label>默认底座<select name="defaultProvider"><option value="codex">Codex</option><option value="opencode">OpenCode</option></select></label><label>默认模型<select name="defaultModel"><option value="default">跟随默认底座</option></select></label><label><span>模型请求超时（秒）</span><input name="timeoutSeconds" type="number" min="10" max="3600" value="120" title="等待本次模型请求返回的最长时间；不限制整个任务的执行时长" aria-describedby="platform-timeout-help"><small id="platform-timeout-help" class="platform-field-hint">只计算单次模型请求等待返回的时间，不限制整个任务执行多久。超过后该次请求异常，可从任务记录重新处理。</small></label><label>失败重试次数<input name="retryCount" type="number" min="0" max="5" value="1"></label><button class="primary-button" type="submit">保存设置</button><p class="form-status" id="platform-settings-status"></p><p class="form-status platform-runtime-status" id="platform-runtime-status" role="status" aria-live="polite"></p></form></article></section>`;
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
    const runtimeStatus = $("#platform-runtime-status");
    if (runtimeStatus) {
      runtimeStatus.textContent = settings?.runtimeApplied === false
        ? "设置已持久化；运行时尚未应用，将在后续运行生效。"
        : settings?.runtimeApplied === true ? "设置已应用到当前运行时。" : "";
    }
  };
  $("#platform-discovery-refresh")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; const currentSettings = Object.fromEntries(new FormData(document.querySelector("#platform-settings-form") || document.createElement("form")).entries()); button.disabled = true; button.textContent = "正在刷新...";
    try { const response = await pageFetch("/api/v1/platform/discovery", { method: "POST" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "刷新失败"); renderDiscovery(payload, currentSettings); button.textContent = "已刷新"; setTimeout(() => { button.textContent = "刷新底座与模型"; }, 1500); }
    catch (error) { if (isAbort(error)) return; showToast(error.message || "刷新失败"); button.textContent = "刷新失败"; }
    finally { button.disabled = false; }
  });
  try {
    const [discoveryResponse, settingsResponse] = await Promise.all([pageFetch("/api/v1/platform/discovery"), pageFetch("/api/v1/platform/settings")]);
    const discovery = await discoveryResponse.json(); const settingsPayload = await settingsResponse.json();
    if (!discoveryResponse.ok) throw new Error(discovery.error || "无法读取运行底座");
    renderDiscovery(discovery, settingsPayload.settings);
    $("#platform-settings-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await pageFetch("/api/v1/platform/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form.entries())) }); const result = await response.json(); if (!isCurrentRequest(state.activeRequest)) return; $("#platform-settings-status").textContent = response.ok ? "设置已保存" : (result.error || "保存失败"); if (response.ok) renderDiscovery(discovery, result.settings); });
  } catch (error) { if (isAbort(error)) return; $("#platform-providers").innerHTML = `<div class="platform-empty">${esc(error.message || "无法读取平台配置")}</div>`; $("#platform-models").innerHTML = `<div class="platform-empty">请检查运行服务后重试</div>`; }
}

async function renderTeamFactory() {
  const root = $("#factory-view");
  root.innerHTML = `<section class="page-heading library-heading"><div><div class="eyebrow">${esc(copy[state.locale].factoryEyebrow)}</div><h1>${esc(copy[state.locale].factoryTitle)}</h1><p>${esc(copy[state.locale].factoryIntro)}</p></div><div class="heading-actions"><a class="primary-button" href="/factory/new" data-route="/factory/new">${esc(copy[state.locale].createTeam)}</a></div></section><section class="project-library-toolbar"><div><strong>${esc(copy[state.locale].factoryEyebrow)}</strong><span>${esc(copy[state.locale].factoryEmptyHint)}</span></div></section><div id="factory-grid" class="project-library-grid"><div class="project-loading">正在读取团队工厂...</div></div>`;
  const grid = $("#factory-grid");
  try {
    const response = await pageFetch("/api/v1/team-factory"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取团队工厂");
    const teams = payload.teams || [];
    grid.innerHTML = teams.length ? teams.map((team) => teamCard(team, "factory")).join("") : `<div class="empty-projects"><strong>${esc(copy[state.locale].noFactoryTeams)}</strong><p>${esc(copy[state.locale].factoryEmptyHint)}</p><a class="primary-button" href="/factory/new" data-route="/factory/new">${esc(copy[state.locale].createTeam)} →</a></div>`;
    bindTeamActions(grid);
  } catch (error) { if (isAbort(error)) return; grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取团队工厂")}</div>`; }
}

async function renderProjectGraph(projectId, stageId = "project-graph-stage", readOnly = false, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  const stage = $("#" + stageId);
  if (!stage || !window.OGSStudioGraphBundle?.mountStudioX6Bridge) return;
  try {
    const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design?locale=${encodeURIComponent(state.locale)}`);
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
    const simulateTeam = async (input) => {
      const prompt = String(input || "").trim();
      if (!prompt) {
        setEditorState("请输入本次模拟的任务内容");
        return false;
      }
      if (dirty) {
        setEditorState("请先保存未提交的图谱修改，再运行模拟");
        return false;
      }
      const result = $("#team-simulation-result");
      if (result) result.innerHTML = '<p class="form-status" role="status">正在运行临时模拟…</p>';
      setEditorState("正在运行临时模拟…");
      try {
        const response = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/simulate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, locale: state.locale })
        });
        const payload = await response.json();
        if (!isCurrentRequest(pageRequest)) return false;
        if (!response.ok) throw new Error(payload.error || "团队模拟失败");
        const roleRows = (payload.auditTrail || []).map((item) => `<li><strong>${esc(item.roleId || "角色")}</strong><span>${esc(item.status || "已执行")}${item.failure ? ` · ${esc(item.failure)}` : ""}</span></li>`).join("");
        const succeeded = !["failed", "error"].includes(String(payload.status || "").toLowerCase());
        const statusLabel = succeeded
          ? (state.locale === "en" ? "Not saved" : "未写入运行历史")
          : (state.locale === "en" ? "Simulation failed" : "模拟失败");
        if (result) result.innerHTML = `<div class="team-simulation-result"><div class="panel-head"><strong>${state.locale === "en" ? "Simulation result" : "模拟结果"}</strong><span class="status-chip${succeeded ? "" : " warning"}">${statusLabel}</span></div>${roleRows ? `<ul class="team-simulation-roles">${roleRows}</ul>` : ""}<pre>${esc(payload.finalOutput || payload.error || "模拟没有返回结果")}</pre></div>`;
        setEditorState(succeeded
          ? (state.locale === "en" ? "Simulation completed; no Project or Run history was written." : "模拟完成；未写入项目或运行历史")
          : (state.locale === "en" ? "Simulation failed; review the role details and retry." : "模拟失败；请检查角色执行信息后重试"));
        return succeeded;
      } catch (error) {
        if (isAbort(error)) return false;
        if (result) result.innerHTML = `<p class="run-error" role="alert">${teamStudioErrorMarkup(error.message || "团队模拟失败")}</p>`;
        setEditorState(error.message || "团队模拟失败");
        return false;
      }
    };
    state.runTeamStudioSimulation = simulateTeam;
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
      onChatGenerate: () => state.teamStudioDialog?.("assistant"),
      onQuickDebugOpen: () => state.teamStudioDialog?.("run"),
      onApplyCommand: (result) => {
        authoring = result.authoring;
        canvas = result.canvas;
        dirty = true;
        setDirty("project-graph");
        setEditorState("有未保存的结构修改");
      },
      onApplyCanvas: (nextCanvas) => {
        canvas = nextCanvas;
        dirty = true;
        setDirty("project-graph");
        setEditorState("有未保存的布局修改");
      },
      onValidateWorkbench: async () => {
        const result = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design/validate`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ authoring })
        });
        const validation = await result.json();
        if (!isCurrentRequest(pageRequest)) return;
        if (!result.ok || validation.ok === false) {
          setEditorState(validation.error || validation.diagnostics?.map((item) => item.message).join("; ") || "结构校验失败");
          return;
        }
        setEditorState("结构校验通过");
      },
      onSaveWorkbench: async () => {
        if (!dirty) { setEditorState("没有待保存的修改"); return; }
        const result = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/design`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ authoring, expectedProjectDigest: projectDigest })
        });
        const saved = await result.json();
        if (!isCurrentRequest(pageRequest)) return;
        if (!result.ok) { setEditorState(saved.error || "结构保存失败"); return; }
        projectDigest = saved.projectDigest;
        dirty = false;
        clearDirty("project-graph");
        setEditorState("已保存，项目已回到草案状态");
        await renderProjectDraft(projectId, pageRequest);
        await renderProjectGraph(projectId, "project-graph-stage", false, pageRequest);
      },
      onQuickDebugRun: simulateTeam,
      onToggleFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await stage.requestFullscreen();
      }
    });
  } catch (error) { if (isAbort(error)) return;
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
  return ({ waiting_review: "等待人工审核", paused: "已安全暂停", pause_requested: "正在暂停", running: "运行中", planning: "准备运行", completed: "已完成", failed: "运行失败", cancelled: "已取消", cancel_requested: "正在取消" })[status] || status || "已完成";
}

async function renderProjectDraft(projectId, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  const root = $("#project-workspace-view"); root.innerHTML = '<div class="project-loading">正在读取团队项目...</div>';
  try {
    const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`); const project = await response.json(); if (!response.ok) throw new Error(project.error || "项目不存在");
    const confirmed = project.projectStatus === "confirmed";
    const adjustmentParams = new URLSearchParams(window.location.search);
    const collaborationProjectId = adjustmentParams.get("collaborationProjectId");
    if (collaborationProjectId) {
      root.insertAdjacentHTML("afterbegin", `<p class="form-hint" role="status">此草稿来自 OGS Projects 项目调整。检查并发布后返回项目显式挂载新版本。</p>`);
    }
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← 团队仓库</a><div class="eyebrow">01 / 团队建设</div><h1>${esc(project.name)} <span class="version-badge">v${project.teamVersionNumber || 1}</span></h1><p>${esc(project.overview || "还没有填写团队目标")}</p></div><span class="project-status ${confirmed ? "confirmed" : "draft"}">${confirmed ? "团队版本已发布" : "团队草案，可继续微调"}</span></section><nav class="project-steps team-only"><a class="project-step active" href="#team"><span>01</span><strong>团队建设</strong><small>${confirmed ? "已发布版本" : "编辑和调试中"}</small></a></nav><section class="project-grid draft-grid"><article class="project-panel project-editor-panel" id="team"><div class="panel-head"><div><span class="section-kicker">团队建设</span><h2>定义职责与协作方式</h2></div><span class="count-badge">${confirmed ? "RELEASED" : "DRAFT"}</span></div><form id="project-edit-form" class="compact-form"><label>团队名称<input name="name" value="${esc(project.name)}" required maxlength="120"></label><label>团队目标与流程<textarea name="overview" rows="7" maxlength="4000" required>${esc(project.overview || "")}</textarea><span class="field-hint">${esc(copy[state.locale].targetHint)}</span></label><div class="form-actions"><button class="secondary-button" type="submit">保存微调</button>${confirmed ? '<button id="reconfirm-project" class="secondary-button" type="button">另存为新版本</button>' : `<button id="confirm-project" class="primary-button" type="button">${esc(copy[state.locale].releaseTeam)}</button>`}</div><p class="form-status" id="project-edit-status"></p></form></article><article class="project-panel project-preview-panel"><div class="panel-head"><div><span class="section-kicker">团队方案预览</span><h2>团队版本</h2></div><span class="status-chip">${confirmed ? "已发布" : (project.teamVersionStatus === "editing" ? "编辑中" : "草案")}</span></div><div class="preview-list"><div><strong>版本状态</strong><span>${confirmed ? "已发布，可用于创建项目" : "未发布，只在团队工厂中可见"}</span></div><div><strong>方案内容</strong><span>职责、角色关系、协作流程和运行规则</span></div></div><p class="preview-note">团队只负责结构和协作方式；材料、任务和运行记录在项目工作区中单独管理。</p></article></section>`;
        const previewVersion = root.querySelector(".project-preview-panel .preview-list > div:first-child span");
    if (previewVersion) previewVersion.textContent = confirmed ? "已发布版本" : "未发布，仅在 OGS Studio 中可见";
    const previewNote = root.querySelector(".project-preview-panel .preview-note");
    if (previewNote) previewNote.textContent = "团队只负责结构、角色和协作方式。";
    if (collaborationProjectId) root.querySelector(".page-heading")?.insertAdjacentHTML("afterend", '<p class="form-hint" role="status">此草稿来自 OGS Projects 项目调整。检查并发布后返回项目显式挂载新版本。</p>');
    root.insertAdjacentHTML("beforeend", '<section class="project-panel project-graph-preview"><div class="panel-head"><div><span class="section-kicker">Team Studio</span><h2>团队结构</h2><p id="project-design-status" class="form-status" role="status" aria-live="polite">正在加载可编辑团队结构</p></div><span class="status-chip">可视化编辑</span></div><div id="project-graph-stage" class="graph-stage studio-graph-island" role="application" aria-label="Editable team collaboration graph"></div><p class="preview-note">结构编辑、对话完善和运行调试都从图谱工具栏进入。</p></section>');
    root.insertAdjacentHTML("beforeend", '<dialog id="team-studio-dialog" class="team-studio-dialog" aria-labelledby="team-studio-title"><div class="team-studio-dialog-content"><header class="team-studio-dialog-head"><div><span class="section-kicker">Team Studio</span><h2 id="team-studio-title">生成与运行</h2></div><button class="close-button" type="button" data-team-studio-close aria-label="关闭">×</button></header><div class="team-studio-tabs" role="tablist" aria-label="团队工作台操作"><button type="button" role="tab" id="team-studio-tab-assistant" aria-controls="team-studio-panel-assistant" aria-selected="true" data-team-studio-tab="assistant">完善团队</button><button type="button" role="tab" id="team-studio-tab-run" aria-controls="team-studio-panel-run" aria-selected="false" data-team-studio-tab="run">运行调试</button></div><section id="team-studio-panel-assistant" class="team-studio-panel" role="tabpanel" aria-labelledby="team-studio-tab-assistant"><section id="team-assistant" class="team-assistant-panel"></section></section><section id="team-studio-panel-run" class="team-studio-panel" role="tabpanel" aria-labelledby="team-studio-tab-run" hidden><label class="assistant-input-label"><span>调试输入</span><textarea id="team-simulation-input" rows="4" maxlength="4000" placeholder="描述本次要验证的任务"></textarea></label><p class="form-hint">临时模拟不会创建项目 Run 或运行历史。</p><div class="form-actions"><button class="primary-button" id="team-simulation-run" type="button">开始模拟</button></div><div id="team-simulation-result" aria-live="polite"></div></section></div></dialog>');
    root.querySelectorAll(".team-studio-dialog .section-kicker").forEach((element) => { element.textContent = "OGS Studio"; });
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
    const dialog = $("#team-studio-dialog");
    let assistantReady = false;
    const selectStudioTab = (tab) => {
      for (const name of ["assistant", "run"]) {
        const selected = name === tab;
        $(`#team-studio-tab-${name}`)?.setAttribute("aria-selected", String(selected));
        $(`#team-studio-panel-${name}`)?.toggleAttribute("hidden", !selected);
      }
      if (tab === "assistant" && !assistantReady) {
        assistantReady = true;
        void renderTeamAssistant(projectId, project, pageRequest);
      }
      if (tab === "run") $("#team-simulation-input")?.focus();
      else $("#team-assistant-input")?.focus();
    };
    state.teamStudioDialog = (tab = "assistant") => {
      if (!dialog.open) dialog.showModal();
      selectStudioTab(tab);
    };
    root.querySelectorAll("[data-team-studio-tab]").forEach((button, index, buttons) => {
      button.addEventListener("click", () => selectStudioTab(button.dataset.teamStudioTab));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const next = buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
        next.focus();
        selectStudioTab(next.dataset.teamStudioTab);
      });
    });
    root.querySelector("[data-team-studio-close]")?.addEventListener("click", () => dialog.close());
    root.querySelector("#team-simulation-run")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const input = $("#team-simulation-input");
      if (!input?.value.trim()) { input?.focus(); return; }
      button.disabled = true;
      try { await state.runTeamStudioSimulation?.(input.value); }
      finally { if (button.isConnected) button.disabled = false; }
    });
    const projectEditForm = $("#project-edit-form");
    bindDirtyForm(projectEditForm, () => setDirty("project-form"));
    projectEditForm.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), overview: form.get("overview") }) }); const payload = await result.json(); if (!isCurrentRequest(pageRequest)) return; $("#project-edit-status").textContent = result.ok ? (payload.projectStatus === "draft" ? "已保存，团队回到草案状态。" : "已保存。") : (payload.error || "保存失败"); if (result.ok) { clearDirty("project-form"); await renderProjectDraft(projectId, pageRequest); } });
    const confirm = $("#confirm-project"); confirm?.addEventListener("click", async () => { const result = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/release`, { method: "POST" }); const payload = await result.json(); if (!isCurrentRequest(pageRequest)) return; if (!result.ok) { $("#project-edit-status").textContent = payload.error || "发布失败"; return; } clearDirty("project-form"); if (collaborationProjectId) navigate(`/studio/project/${encodeURIComponent(collaborationProjectId)}/teams?addVersion=${encodeURIComponent(projectId)}`); else await renderProjectDraft(projectId, pageRequest); });
    $("#reconfirm-project")?.addEventListener("click", async () => { const result = await pageFetch(`/api/v1/team-versions/${encodeURIComponent(projectId)}/edit`, { method: "POST" }); const payload = await result.json(); if (!result.ok) { $("#project-edit-status").textContent = payload.error || "新版本创建失败"; return; } clearDirty("project-form"); navigate(`/studio/team/${encodeURIComponent(payload.projectId)}`); });
    if (collaborationProjectId && adjustmentParams.get("adjust") === "1") state.teamStudioDialog?.("assistant");
  } catch (error) { if (isAbort(error)) return; root.innerHTML = `<div class="run-error">${esc(error.message || "项目读取失败")}</div>`; }
}

function projectTaskStatusLabel(status) {
  return ({ queued: "待执行", running: "处理中", planning: "准备处理中", pause_requested: "正在暂停", waiting_review: "待人工审核", paused: "已暂停，可继续", completed: "已完成", failed: "处理失败", cancel_requested: "正在取消", cancelled: "已取消", deleted: "已删除" })[status] || status || "待执行";
}

function teamStudioErrorMarkup(message) {
  const detail = String(message || "团队操作暂时不可用");
  if (detail.includes("TEAM_ASSISTANT_MODEL_UNAVAILABLE")) {
    return '尚未配置可用的 OpenCode 模型。请在<a href="/platform" data-route="/platform">平台设置</a>中选择活跃模型并刷新底座与模型，再重试。';
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
  const fullResult = detail.dataset.fullResult || "";
  const workspaceUrl = professionalWorkspaceUrl(run.runtimeProjectId, "run", run.runId, run.collaborationProjectId, run.taskId);
  detail.dataset.runStatus = status;
  detail.innerHTML = `<div class="task-run-detail-head"><strong class="task-run-status">${esc(projectRunStatusLabel(status))}</strong><span class="task-run-mode-label run-mode-chip">${mode === "sandbox" ? "隔离运行" : "流程预览"}</span><span class="task-run-progress-label">${progress}%</span></div>${workspaceUrl ? `<p class="task-run-workspace-link"><a class="text-button" href="${esc(workspaceUrl)}" target="_blank" rel="noopener">查看全流程</a></p>` : ""}<div class="task-run-progress" role="progressbar" aria-label="运行进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><ul class="task-run-events">${events || "<li><span>暂无事件摘要</span></li>"}</ul>${failure ? `<p class="task-run-failure" role="status">${esc(failure)}</p>` : ""}${summary ? `<section class="task-run-output"><strong>结果摘要</strong><pre>${esc(summary)}</pre></section>` : ""}<section class="task-run-output"><strong>完整结果</strong>${fullResult ? `<pre>${esc(fullResult)}</pre>` : `<button class="text-button" type="button" data-load-run-result>读取完整结果</button>`}</section><p class="form-status task-run-error" role="status" aria-live="polite"></p>`;
  detail.querySelector("[data-load-run-result]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(detail.dataset.projectId)}/runs/${encodeURIComponent(run.runId)}/result`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "完整结果读取失败");
      if (detail.dataset.selectedRunId !== run.runId) return;
      detail.dataset.fullResult = payload.available ? payload.result.finalOutput : "完整结果暂不可用；当前仅显示结果摘要。";
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
  if (status) status.textContent = error?.message || "运行状态读取失败，将继续重试。";
}

function taskActionErrorMessage(message) {
  if (String(message || "").includes("PROJECT_NOT_READY")) return "当前团队未通过运行就绪检查。请先修复运行配置中的阻塞项，再重新开始。";
  return message || "任务操作失败";
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

async function openTaskReview(projectId, taskId) {
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
  form.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "submit") return;
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
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
  activeTaskReviewClose?.("route");
}

async function renderCollaborationProject(projectId, project, pageRequest = state.activeRequest) {
  if (pageRequest && !isCurrentRequest(pageRequest)) return;
  pageRequest?.runPollers?.forEach((stop) => stop());
  pageRequest?.runPollers?.clear();
  const root = $("#project-workspace-view");
  const teams = project.mountedTeams || [];
  const tasks = (project.taskRecords || []).filter((task) => !task.deletedAt && task.status !== "deleted");
  const materials = project.materials?.materials || [];
  const terminalRefreshes = pageRequest?.terminalRunRefreshes || (pageRequest ? (pageRequest.terminalRunRefreshes = new Set()) : new Set());
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/projects" data-route="/projects">← 协作项目</a><div class="eyebrow">协作项目</div><h1>${esc(project.name)}</h1><p>${esc(project.overview || "按任务推进项目")}</p></div><span class="project-status confirmed">${teams.length} 个团队 · ${tasks.length} 个任务</span></section><section class="project-grid collaboration-project-grid"><article class="project-panel project-resources-panel"><div class="panel-head"><div><span class="section-kicker">项目资料</span><h2>项目资料</h2></div><span class="count-badge">${materials.length}</span></div><p class="panel-intro">这里的资料属于当前项目，供已挂载团队使用。</p><form id="project-material-form" class="material-upload-form"><div class="form-actions"><label class="secondary-button material-upload-button">上传文件<input id="project-material-file-input" type="file" multiple hidden accept=".md,.txt,.json,.yaml,.yml,.csv,text/markdown,text/plain,application/json,text/csv"></label><label class="secondary-button material-upload-button">导入文件夹<input id="project-material-folder-input" type="file" multiple webkitdirectory directory hidden accept=".md,.txt,.json,.yaml,.yml,.csv,text/markdown,text/plain,application/json,text/csv"></label></div><small>支持批量文件和文件夹导入，保留文件夹相对路径；单批最多 200 个文件、8 MB。</small><p class="form-status" id="project-material-status" role="status" aria-live="polite"></p></form><div class="material-list">${materials.length ? materials.map((item) => `<div class="material-row"><strong>${esc(item.filename)}</strong><span>${esc(materialStatusLabel(item.status))} · ${item.size || 0} bytes</span></div>`).join("") : '<p class="empty-note">还没有项目资料，可以在任务开始前补充需求、背景或附件。</p>'}</div></article><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">执行团队</span><h2>已挂载团队</h2></div><span class="count-badge">${teams.length}</span></div><div class="material-list">${teams.length ? teams.map((team) => { const teamHref = String(team.teamVersionId || "").startsWith("case:") ? `/cases/${encodeURIComponent(String(team.teamVersionId).slice(5))}` : `/studio/team/${encodeURIComponent(team.teamVersionId)}`; return `<div class="material-row"><a class="team-link" href="${teamHref}" data-route="${teamHref}"><strong>${esc(team.teamName)}</strong><span>v${team.teamVersionNumber || 1} · ${esc(team.status || "可用")}</span></a></div>`; }).join("") : '<p class="empty-note">还没有挂载团队。</p>'}</div><a class="secondary-button" href="/studio/project/${encodeURIComponent(projectId)}/teams" data-route="/studio/project/${encodeURIComponent(projectId)}/teams">管理挂载团队</a></article><article class="project-panel"><div class="panel-head"><div><span class="section-kicker">安排工作</span><h2>创建下一项任务</h2></div></div>${teams.length ? `<form id="collaboration-task-form" class="compact-form"><label><span>执行团队</span><select name="teamVersionId">${teams.map((team) => `<option value="${esc(team.teamVersionId)}">${esc(team.teamName)} · v${team.teamVersionNumber || 1}</option>`).join("")}</select></label><label><span>任务内容</span><textarea name="input" required rows="4" maxlength="4000" placeholder="描述这次要完成的具体工作"></textarea></label><button class="primary-button" type="submit">记录任务</button><p class="form-status" id="collaboration-task-status"></p></form>` : '<p class="empty-note">请先挂载至少一个已发布团队。</p>'}</article><article class="project-panel task-list-panel"><div class="panel-head"><div><span class="section-kicker">任务清单与运行记录</span><h2>按任务追踪交付</h2></div><span class="count-badge">${tasks.length}</span></div><p class="panel-intro">每条任务保留输入内容、执行团队、任务序号和处理结果。暂停后可以继续，待审核时可提交反馈。</p><div class="material-list">${tasks.length ? tasks.slice().reverse().map((task) => `<div class="material-row task-record-row"><div class="task-record-main"><strong>任务 #${esc(task.taskNumber)} · ${esc(task.teamName || "团队")}</strong><p>${esc(task.input || "")}</p><div class="task-record-meta"><span class="status-chip ${task.status}">${esc(projectTaskStatusLabel(task.status))}</span>${task.currentRunId ? `<span>运行 ${esc(task.currentRunId)}</span>` : ""}${task.review?.comment ? `<span>反馈：${esc(task.review.comment)}</span>` : ""}</div>${task.status === "failed" && task.lastError ? `<p class="task-run-last-error" role="status">${esc(task.lastError)}</p>` : ""}${task.currentRunId ? `<div class="task-run-detail" data-run-id="${esc(task.currentRunId)}"><div class="task-run-detail-head"><strong class="task-run-status">${esc(projectRunStatusLabel(task.status))}</strong><span class="task-run-progress-label">正在读取...</span></div><div class="task-run-progress" role="progressbar" aria-label="运行进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span style="width:0%"></span></div><ul class="task-run-events"><li><span>正在读取运行事件...</span></li></ul><p class="form-status task-run-error" role="status" aria-live="polite"></p></div>` : ""}</div><div class="task-record-actions">${taskActionMarkup(task)}</div></div>`).join("") : '<p class="empty-note">还没有任务记录。先描述一项具体工作。</p>'}</div></article></section>`;
  const collaborationGrid = root.querySelector(".collaboration-project-grid");
  if (collaborationGrid && teams.length) {
    collaborationGrid.insertAdjacentHTML("afterbegin", `<article class="project-panel team-adjustment-panel"><div class="panel-head"><div><span class="section-kicker">团队优化</span><h2>调整执行团队</h2></div></div><p class="panel-intro">从当前版本创建 Studio 草稿。检查并发布后，再回到项目明确挂载新版本。</p><div class="team-adjustment-actions">${teams.map((team) => `<button class="secondary-button" type="button" data-team-adjust="${esc(team.teamVersionId)}">调整 ${esc(team.teamName)} · v${team.teamVersionNumber || 1}</button>`).join("")}</div></article>`);
    collaborationGrid.querySelectorAll("[data-team-adjust]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team-adjustments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ teamVersionId: button.dataset.teamAdjust })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "无法创建团队调整草稿");
        navigate(`/studio/team/${encodeURIComponent(payload.draft.projectId)}?collaborationProjectId=${encodeURIComponent(projectId)}&adjust=1`);
      } catch (error) {
        if (isAbort(error)) return;
        showToast(error.message || "无法创建团队调整草稿");
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
    detail.dataset.selectedRunId = task.currentRunId;
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
      detail.dataset.fullResult = "";
      detail.innerHTML = '<p class="task-run-loading" role="status">正在读取这次尝试...</p>';
      try {
        const base = `/api/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(attempt.runId)}`;
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
  bindDirtyForm(collaborationTaskForm, () => setDirty("collaboration-task-form"));
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
    payload.idempotencyKey = crypto.randomUUID();
    submit.disabled = true;
    try {
      const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!isCurrentRequest(pageRequest)) return;
      if (!response.ok) { status.textContent = result.error || "任务创建失败"; return; }
      clearDirty("collaboration-task-form");
      status.textContent = "任务已加入清单";
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
    if (action === "review") { await openTaskReview(projectId, taskId); return; }
    if (action === "delete") {
      const confirmed = await confirmAction({ title: "删除任务记录？", message: "删除后任务将从清单隐藏，运行快照仍会保留。", confirmLabel: "删除", cancelLabel: "取消" });
      if (!confirmed) return;
    }
    button.disabled = true;
    const rowStatus = button.closest(".task-record-row")?.querySelector(".task-action-status");
    try {
      const endpoint = action === "delete"
        ? `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
        : action === "retry"
          ? `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/retry`
          : `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/${action}`;
      const response = await pageFetch(endpoint, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: action === "delete" ? undefined : ["start", "retry"].includes(action)
          ? JSON.stringify({ mode: root.querySelector(`[data-task-mode="${CSS.escape(taskId)}"]`)?.value || "dry-run", idempotencyKey: crypto.randomUUID() })
          : "{}"
      });
      const result = await response.json();
      if (!isCurrentRequest(pageRequest)) return;
      if (!response.ok) {
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
  const root = $("#project-workspace-view"); root.innerHTML = '<div class="project-loading">正在读取运行工作区...</div>';
  try {
    const response = await pageFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`); const project = await response.json(); if (!response.ok) throw new Error(project.error || "项目不存在");
    if (project.projectType === "collaboration") {
      await renderCollaborationProject(projectId, project, pageRequest);
      return;
    }
    navigate(`/studio/team/${encodeURIComponent(projectId)}`);
  } catch (error) { if (isAbort(error)) return; root.innerHTML = `<div class="run-error">${esc(error.message || "运行工作区读取失败")}</div>`; }
}

function syncRoute() {
  const pageRequest = beginPageRequest();
  const path = location.pathname.replace(/\/$/, "") || "/";
  const landing = path === "/";
  $("#landing-view").classList.toggle("hidden", !landing);
  $("#app-shell").classList.toggle("hidden", landing);
  if (landing) return;
  const detailMatch = path.match(/^\/cases\/([a-z0-9-]+)$/);
  if (detailMatch) {
    const item = state.cases.find((entry) => entry.id === detailMatch[1]);
    if (item) { $("#workspace-view").classList.add("hidden"); $("#examples-view").classList.add("hidden"); $("#history-view").classList.add("hidden"); $("#case-detail-view").classList.remove("hidden"); state.selected = item.id; renderDetail(item); return; }
    history.replaceState({}, "", "/studio"); router.syncCurrentPath(); syncRoute(); return;
  }
  if (path === "/factory/new") {
    setView("new-project");
    void renderNewProject(pageRequest);
    return;
  }
  if (path === "/studio/project/new") {
    setView("new-project");
    void renderProjectCreate(pageRequest);
    return;
  }
  const teamMatch = path.match(/^\/studio\/team\/([a-z0-9-]+)$/);
  if (teamMatch) {
    setView("project-workspace");
    void renderProjectDraft(teamMatch[1], pageRequest).then(() => renderProjectGraph(teamMatch[1], "project-graph-stage", false, pageRequest));
    return;
  }
  const projectTeamsMatch = path.match(/^\/studio\/project\/([a-z0-9-]+)\/teams$/);
  if (projectTeamsMatch) {
    setView("project-workspace");
    void renderProjectTeams(projectTeamsMatch[1], pageRequest);
    return;
  }
  const projectRunMatch = path.match(/^\/studio\/project\/([a-z0-9-]+)\/run$/);
  if (projectRunMatch) {
    setView("project-workspace");
    void renderProjectRun(projectRunMatch[1], pageRequest);
    return;
  }
  if (path === "/studio" && new URLSearchParams(location.search).has("team")) {
    const id = new URLSearchParams(location.search).get("team");
    if (state.cases.some((entry) => entry.id === id)) state.selected = id;
  }
  if (path === "/projects") { state.view = "projects"; void renderCollaborationProjects(pageRequest); }
  else if (path === "/studio") { state.view = "workspace"; void renderProjectLibrary(pageRequest); }
  else if (path === "/factory") { state.view = "factory"; void renderTeamFactory(pageRequest); }
  else if (path === "/platform") { state.view = "platform"; void renderPlatformConfig(pageRequest); }
  else if (path === "/examples") state.view = "examples";
  else if (path === "/history") { state.view = "history"; void renderHistory(pageRequest); }
  setView(state.view);
  if (!["/projects", "/studio", "/factory", "/platform", "/examples", "/history"].includes(path) && !detailMatch && !teamMatch && !projectRunMatch && !projectTeamsMatch && path !== "/factory/new" && path !== "/studio/project/new") { history.replaceState({}, "", "/projects"); router.syncCurrentPath(); syncRoute(); }
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
    const response = await pageFetch("/api/v1/runs/recent?limit=50"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取运行记录");
    state.recentRuns = payload.runs || [];
    if (!state.recentRuns.length) { root.innerHTML = `<div class="history-empty"><strong>${esc(copy[state.locale].noHistory)}</strong></div>`; return; }
    root.innerHTML = state.recentRuns.map((run) => {
      const restoreProjectId = run.collaborationProjectId || run.runtimeProjectId;
      const runtimeProjectId = run.runtimeProjectId || restoreProjectId;
      const mode = run.mode === "sandbox" ? (state.locale === "en" ? "Isolated run" : "隔离运行") : (state.locale === "en" ? "Preview" : "流程预览");
      const status = projectRunStatusLabel(run.status || "记录");
      return `<article class="history-row"><span class="history-icon">O</span><div class="history-main"><div class="history-title-line"><strong>${esc(run.teamName || "团队")} <span class="version-badge">v${run.teamVersionNumber || 1}</span></strong><span class="history-status">${esc(status)}</span></div><p><span class="history-tag">${esc(run.projectName || "项目")}</span><span class="history-tag">${esc((copy[state.locale].runRound || "任务 {round}").replace("{round}", String(run.taskNumber ?? run.roundNumber ?? "-")))}</span><span class="history-tag">${esc(mode)}</span></p><small>${run.updatedAt ? new Date(run.updatedAt).toLocaleString(state.locale) : ""}</small></div><div class="history-actions"><a class="text-button" href="/studio/project/${encodeURIComponent(restoreProjectId)}/run" data-route="/studio/project/${encodeURIComponent(restoreProjectId)}/run">${esc(copy[state.locale].historyRestore)}</a><a class="text-button" href="${esc(professionalWorkspaceUrl(runtimeProjectId, "run", run.runId, run.collaborationProjectId, run.taskId))}" target="_blank" rel="noopener">${esc(copy[state.locale].advancedWorkspace)}</a></div></article>`;
    }).join("");
  } catch (error) { if (isAbort(error)) return; root.innerHTML = `<div class="run-error">${esc(error.message || "无法读取运行记录")}</div>`; }
}
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2300); }
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
  const [response, configResponse] = await Promise.all([pageFetch("/api/v1/cases"), pageFetch("/api/v1/config")]); if (!response.ok) throw new Error("Unable to load team cases.");
  const payload = await response.json();
  if (configResponse.ok) {
    const config = await configResponse.json();
    if (typeof config.visUrl === "string" && /^https?:\/\//i.test(config.visUrl)) state.visUrl = config.visUrl.replace(/\/$/, "");
  }
  state.cases = payload.cases || [];
  state.eventLabels = payload.eventLabels || {};
  state.selected = state.cases[0]?.id;
  router.install();
  $$("#locale-toggle, #landing-locale").forEach((button) => button.addEventListener("click", () => { state.locale = state.locale === "zh-CN" ? "en" : "zh-CN"; localStorage.setItem("ogs-locale", state.locale); applyLocale(); }));
  $$('[data-site-theme-choice]').forEach((button) => button.addEventListener("click", () => applySiteTheme(button.dataset.siteThemeChoice)));
  $("#task-input")?.addEventListener("input", () => { updateCount(); setDirty("task-input"); }); $("#run-button")?.addEventListener("click", runSelected);
  $("#edit-task-button")?.addEventListener("click", () => { $("#task-input")?.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); });
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
