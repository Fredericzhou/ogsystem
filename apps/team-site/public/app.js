const state = { cases: [], eventLabels: {}, selected: null, locale: localStorage.getItem("ogs-locale") || "zh-CN", view: "workspace", history: readHistory(), projectId: null, visUrl: "http://127.0.0.1:4177" };
const themeStorageKey = "ogs.visualizer.theme";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const text = (value) => value?.[state.locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = { code: "⌘", medical: "✚", scales: "⚖" };
const copy = {
  "zh-CN": {
    homeCases: "经典团队", homeStudio: "在线体验", homeCta: "开始体验", homeEyebrow: "为复杂工作，组织一支 AI 团队", homeTitle: "让不同专长，<br>协作成一个结果。", homeIntro: "从清楚的目标开始，让合适的成员各司其职、交接信息，并共同完成可检查的成果。", homePrimary: "在线运行示例", homeSecondary: "浏览经典团队", homeProof: "真实运行流程 · 无需注册 · 中英文示例", visualTitle: "从不同观点，到共同交付", visualStatus: "协作中", visualTask: "一个清楚的目标", visualTaskSub: "给团队共同的方向", visualRoleOne: "工程规划", visualRoleOneSub: "实现与依赖", visualRoleTwo: "体验设计", visualRoleTwoSub: "流程与细节", visualRoleThree: "质量把关", visualRoleThreeSub: "验收与风险", visualResult: "汇成一份完整方案", visualResultSub: "意见 · 依据 · 下一步", visualFooter: "分工清楚，过程可追踪", homeCasesEyebrow: "三种真实的协作方式", homeCasesTitle: "从经典团队开始", homeAllCases: "查看全部案例 →", promiseKicker: "面向真实工作", promiseTitle: "过程清楚，交付有据。", promiseOne: "每位成员有明确职责", promiseOneBody: "从目标拆解到结果整合，每一步都有负责的人。", promiseTwo: "工作交接看得见", promiseTwoBody: "随时了解谁在处理、信息如何流转。", promiseThree: "结果可以逐步检查", promiseThreeBody: "回看各方意见、汇总过程和最终输出。", homeFooter: "为复杂工作构建协作团队", homeFooterCta: "进入在线工作台 →",
    workspaceName: "个人工作台", workspaceType: "访客空间", navTeams: "团队库", navExamples: "经典团队", navRuns: "最近运行", runtimeReady: "运行服务就绪", crumbHome: "首页", guestMode: "访客体验", eyebrow: "团队库", pageTitle: "把复杂任务，交给一支有分工的团队", pageIntro: "从一个目标开始。选择团队案例，查看协作路径，再运行一次完整流程。", metaLabel: "本次体验", metaValue: "完整团队流程 · 结果可回看", taskLabel: "你想完成什么？", taskHint: "先选一个团队案例，也可以改写任务目标", taskPlaceholder: "例如：为一款记账工具制定首版研发方案", charCount: "/ 1,200", runDemo: "运行团队示例", chooseCase: "选择一种协作方式", caseHeading: "经典团队案例", allExamples: "查看团队详情", teamPlan: "团队如何协作", temporaryConfig: "访客预览", adjustWithChat: "编辑任务", membersTitle: "团队成员", membersSubtitle: "每位成员负责一项工作", roleReady: "待开始", memberCompleted: "已完成", flowTitle: "协作路径", flowSubtitle: "从任务输入到最终交付", legendRole: "团队成员", legendFlow: "工作交接", taskInputNode: "任务", deliveryNode: "成果", splitNote: "成员按职责交接，并在汇总时整合所需信息。", capabilityKicker: "清楚 · 有序 · 可回看", capabilityTitle: "每一次协作，都有迹可循", capabilityBody: "团队按职责交接工作，运行过程保留时间线，成果可以逐步检查。", capabilityOne: "明确成员职责", capabilityOneBody: "每位成员有清晰的工作范围", capabilityTwo: "逐步整合意见", capabilityTwoBody: "各方结果按团队安排汇总", capabilityThree: "回看交付过程", capabilityThreeBody: "进度、结果和交接记录可查", footerNote: "公开体验展示完整的团队协作过程，不调用模型或生成业务交付内容。", libraryEyebrow: "经典团队案例", libraryTitle: "团队如何协作", libraryIntro: "浏览不同团队的背景、分工和预期成果。", caseBackground: "场景背景", caseProblem: "适合解决", caseCollaboration: "协作过程", caseDeliverable: "预期成果", caseRoles: "团队分工", openCase: "查看案例详情", useCase: "使用这个团队", backCases: "返回全部团队", detailEyebrow: "经典团队案例", runHistoryEyebrow: "最近运行", historyTitle: "最近运行", historyIntro: "本机浏览器临时保存的体验记录。", clearHistory: "清空记录", noHistory: "还没有运行记录。选择一个案例并运行团队示例。", historyRestore: "查看运行", runPanelKicker: "团队运行", runPanelTitle: "运行结果", running: "正在运行团队流程…", runFailed: "运行未完成", simulation: "流程预览", rolesCompleted: "角色执行", transitions: "任务交接", elapsed: "耗时", finalDelivery: "最终成果", runResult: "预览说明", dryOutput: "本次预览展示团队如何分工与交接工作，不调用真实角色模型，也不会生成业务交付内容。", timeline: "运行时间线", noOutput: "团队没有返回最终交付内容。", historyDone: "已完成", selected: "当前团队", close: "关闭", inputRequired: "请先输入任务目标。", networkError: "暂时无法连接运行服务，请稍后重试。", promptCopied: "已载入案例任务，可继续修改。", inputEvent: "收到任务", outputEvent: "流程完成", roleStatus: "已完成", fallbackEvent: "工作已更新"
  },
  en: {
    homeCases: "Classic teams", homeStudio: "Live preview", homeCta: "Explore the preview", homeEyebrow: "A team for complex work", homeTitle: "Bring different strengths<br>together around one result.", homeIntro: "Start with a clear goal. Give each member a defined responsibility, pass work between them, and create an outcome you can review.", homePrimary: "Run an example", homeSecondary: "Explore classic teams", homeProof: "Real workflow run · No sign-up · English and Chinese", visualTitle: "Different perspectives, one delivery", visualStatus: "Working together", visualTask: "A clear shared goal", visualTaskSub: "One direction for the team", visualRoleOne: "Engineering plan", visualRoleOneSub: "Build and dependencies", visualRoleTwo: "Experience design", visualRoleTwoSub: "Flow and details", visualRoleThree: "Quality review", visualRoleThreeSub: "Acceptance and risks", visualResult: "One complete proposal", visualResultSub: "Views · Evidence · Next steps", visualFooter: "Clear ownership. Visible progress.", homeCasesEyebrow: "Three practical ways to collaborate", homeCasesTitle: "Start with a classic team", homeAllCases: "Browse all cases →", promiseKicker: "Built for real work", promiseTitle: "Clear process. Reviewable results.", promiseOne: "Every member has a clear role", promiseOneBody: "Each step has an owner, from framing the task to assembling the result.", promiseTwo: "Handoffs stay visible", promiseTwoBody: "See who is working and how information moves through the team.", promiseThree: "Results are easy to review", promiseThreeBody: "Revisit each view, the synthesis, and the final output.", homeFooter: "Teams for complex work", homeFooterCta: "Open the team workspace →",
    workspaceName: "My workspace", workspaceType: "Guest space", navTeams: "Team workspace", navExamples: "Classic teams", navRuns: "Recent runs", runtimeReady: "Service ready", crumbHome: "Home", guestMode: "Guest preview", eyebrow: "Online team workspace", pageTitle: "Give complex work to a team with clear roles", pageIntro: "Start with a goal. Choose a team, inspect how it works, then run the complete flow.", metaLabel: "This preview", metaValue: "Complete team workflow · Reviewable results", taskLabel: "What would you like to accomplish?", taskHint: "Choose a team example or rewrite the task", taskPlaceholder: "For example: plan the first release of a bookkeeping tool", charCount: "/ 1,200", runDemo: "Run team example", chooseCase: "Choose how to collaborate", caseHeading: "Classic team examples", allExamples: "Explore team details", teamPlan: "How this team works", temporaryConfig: "Guest preview", adjustWithChat: "Edit task", membersTitle: "Team members", membersSubtitle: "Each member owns a part of the work", roleReady: "Ready", memberCompleted: "Completed", flowTitle: "Collaboration flow", flowSubtitle: "From task input to final delivery", legendRole: "Team member", legendFlow: "Work handoff", taskInputNode: "Task", deliveryNode: "Outcome", splitNote: "Members hand off work by responsibility and bring the needed information together.", capabilityKicker: "Clear · Ordered · Reviewable", capabilityTitle: "Every collaboration leaves a trail", capabilityBody: "Members hand off work by responsibility. A timeline captures progress, and you can review each result.", capabilityOne: "Clear member ownership", capabilityOneBody: "Each member has a defined scope", capabilityTwo: "Views brought together", capabilityTwoBody: "Results are assembled according to the team plan", capabilityThree: "Review the process", capabilityThreeBody: "Progress, results, and handoffs stay visible", footerNote: "The public preview demonstrates a complete team workflow. It does not call models or generate business deliverables.", libraryEyebrow: "Classic team examples", libraryTitle: "How teams work together", libraryIntro: "Explore each team's context, responsibilities, and expected outcome.", caseBackground: "Background", caseProblem: "When to use it", caseCollaboration: "How the team works", caseDeliverable: "Expected outcome", caseRoles: "Team responsibilities", openCase: "View case details", useCase: "Use this team", backCases: "All teams", detailEyebrow: "Classic team example", runHistoryEyebrow: "Recent runs", historyTitle: "Recent runs", historyIntro: "Preview history stored temporarily in this browser.", clearHistory: "Clear history", noHistory: "No run history yet. Choose a case and run the team example.", historyRestore: "View run", runPanelKicker: "Team run", runPanelTitle: "Run result", running: "Running the team workflow…", runFailed: "Run did not complete", simulation: "Workflow preview", rolesCompleted: "Role executions", transitions: "Handoffs", elapsed: "Duration", finalDelivery: "Final delivery", runResult: "Preview details", dryOutput: "This preview shows how the team divides and hands off work. It does not call role models or generate a business deliverable.", timeline: "Run timeline", noOutput: "The team returned no final delivery content.", historyDone: "Completed", selected: "Selected team", close: "Close", inputRequired: "Enter a task to run.", networkError: "The runtime is temporarily unavailable. Try again shortly.", promptCopied: "Example task loaded. You can edit it before running.", inputEvent: "Task received", outputEvent: "Workflow complete", roleStatus: "Completed", fallbackEvent: "Work updated"
  }
};
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
  homeSecondary: "浏览典型协作案例",
  homeProof: "可运行团队示例 · 无需注册 · 中英文支持",
  homeCasesEyebrow: "三类常见协作场景",
  homeCasesTitle: "从典型团队协作开始",
  homeAllCases: "查看全部协作案例 →",
  navExamples: "经典团队",
  caseHeading: "典型团队协作",
  pageIntro: "从一个目标开始。选择团队案例，了解成员之间如何协作，再运行一次完整流程。",
  membersSubtitle: "成员各有专长，分工完成任务",
  allExamples: "查看案例详情",
  libraryEyebrow: "经典团队案例",
  libraryTitle: "经典团队",
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
  navExamples: "Classic teams",
  caseHeading: "Representative team collaboration",
  pageIntro: "Start with a goal. Choose a team, see how members work together, then run the complete example.",
  membersSubtitle: "Each member brings a specialty to the shared task",
  allExamples: "Explore case details",
  libraryEyebrow: "Classic team examples",
  libraryTitle: "Classic teams",
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
    viewportGroup: "图谱视图", editGroup: "编辑图谱", zoomOut: "缩小", zoomIn: "放大", resetView: "重置缩放", fullscreen: "全屏", fitView: "适应画布", autoLayout: "自动布局", layoutModeFlow: "流程布局", layoutModeCompact: "紧凑布局", layoutModeStacked: "分层布局", topologyOrder: "关系顺序", enabled: "开启", disabled: "关闭", layoutSwitched: "已切换为{layout}布局", generate: "生成与运行", debugRun: "快速调试", debugAdvanced: "高级调试", debugRunNow: "立即运行", debugQuickInput: "调试输入", debugQuickHint: "在当前图谱中启动一次 Dry Run；路径覆盖等高级设置可在高级调试中完成。", debugQuickPlaceholder: "描述本次调试要验证的任务", debugQuickOpen: "打开快速调试", close: "关闭", debugRunShort: "运行", quickOpen: "快速定位", quickOpenPlaceholder: "搜索角色或协作关系", quickOpenEmpty: "没有匹配的角色或协作关系。", quickOpenRole: "角色", quickOpenFlow: "协作关系", contextEditRole: "编辑角色", contextEditFlow: "编辑关系", contextInsertRole: "插入角色", contextDelete: "删除", minimap: "图谱导航", addRole: "新增角色", addEdge: "新增关系", editSelection: "编辑所选", editRole: "编辑角色", editEdge: "编辑关系", deleteSelection: "删除所选", undo: "撤销", redo: "重做", validateWorkbench: "校验结构", saveWorkbench: "保存团队", ready: "就绪", graphUnavailable: "图谱不可用", graphReady: "图谱已载入", fixMermaidBeforeGraphEditing: "请先修复 Mermaid 诊断，再编辑图谱。", noRolesAvailable: "暂无可用角色。", selectRoleBeforeAddingEdge: "请先选择角色，再新增关系。", invalidConnection: "无效的团队关系。", entryRoleDeletionBlocked: "不能删除入口角色。", invalidEdgeEndpoints: "关系端点无效。", duplicateRoleId: "角色 ID 已存在。", invalidRoleId: "角色 ID 必须以字母开头，只能使用字母、数字、下划线或连字符。", duplicateEdge: "该关系已存在。", invalidEventType: "事件类型必须使用大写字母。", deleteRoleConfirm: "确定删除角色 {roleId} 吗？", editBlocked: "Mermaid 解析成功后才能编辑图谱。", exportSvg: "导出 SVG", exportPng: "导出 PNG", boundaryEntry: "任务", boundaryEnd: "成果"
  },
  en: {
    viewportGroup: "Graph view", editGroup: "Edit graph", zoomOut: "Zoom out", zoomIn: "Zoom in", resetView: "Reset zoom", fullscreen: "Fullscreen", fitView: "Fit graph", autoLayout: "Auto layout", layoutModeFlow: "Flow layout", layoutModeCompact: "Compact layout", layoutModeStacked: "Layered layout", topologyOrder: "Flow order", enabled: "On", disabled: "Off", layoutSwitched: "Switched to {layout} layout", generate: "Generate and run", debugRun: "Quick debug", debugAdvanced: "Advanced debug", debugRunNow: "Run now", debugQuickInput: "Debug input", debugQuickHint: "Start a Dry Run from this graph; use advanced debug for path overrides.", debugQuickPlaceholder: "Describe the task to verify", debugQuickOpen: "Open quick debug", close: "Close", debugRunShort: "Run", quickOpen: "Quick locate", quickOpenPlaceholder: "Search roles or relationships", quickOpenEmpty: "No matching roles or relationships.", quickOpenRole: "Role", quickOpenFlow: "Relationship", contextEditRole: "Edit role", contextEditFlow: "Edit relationship", contextInsertRole: "Insert role", contextDelete: "Delete", minimap: "Graph navigator", addRole: "Add role", addEdge: "Add relationship", editSelection: "Edit selected", editRole: "Edit role", editEdge: "Edit relationship", deleteSelection: "Delete selected", undo: "Undo", redo: "Redo", validateWorkbench: "Validate structure", saveWorkbench: "Save team", ready: "Ready", graphUnavailable: "Graph unavailable", graphReady: "Graph loaded", fixMermaidBeforeGraphEditing: "Fix Mermaid diagnostics before editing the graph.", noRolesAvailable: "No roles available.", selectRoleBeforeAddingEdge: "Select a role before adding a relationship.", invalidConnection: "Invalid team relationship.", entryRoleDeletionBlocked: "The entry role cannot be deleted.", invalidEdgeEndpoints: "Relationship endpoints are invalid.", duplicateRoleId: "Role ID already exists.", invalidRoleId: "Role ID must start with a letter and use letters, digits, _ or -.", duplicateEdge: "This relationship already exists.", invalidEventType: "Event type must use uppercase letters.", deleteRoleConfirm: "Delete role {roleId}?", editBlocked: "Fix Mermaid diagnostics before editing the graph.", exportSvg: "Export SVG", exportPng: "Export PNG", boundaryEntry: "Task", boundaryEnd: "Outcome"
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
  detailRoot.querySelector(".detail-content")?.insertAdjacentHTML("beforebegin", "<section class=\"detail-graph-section\"><div class=\"detail-section-heading\"><div><span class=\"section-kicker\">OGS / Mermaid</span><h2>团队协作结构</h2><p>先查看角色和交接关系，再决定直接使用，或复制为新团队进行微调。</p></div><span class=\"status-chip\">只读预览</span></div><div id=\"detail-graph-stage\" class=\"graph-stage detail-graph-stage\" role=\"img\" aria-label=\"Team collaboration graph\"></div></section>");
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
    navigate(action === "use" ? "/studio/project/" + encodeURIComponent(payload.projectId) + "/run" : "/studio/project/" + encodeURIComponent(payload.projectId));
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
    || path === "/studio/new"
    || /^\/studio\/project\/[a-z0-9-]+(?:\/run)?$/.test(path);
}
function setView(view) {
  state.view = view;
  const viewMap = { workspace: "workspace-view", examples: "examples-view", history: "history-view", "new-project": "new-project-view", "project-workspace": "project-workspace-view" };
  Object.entries(viewMap).forEach(([key, id]) => document.getElementById(id)?.classList.toggle("hidden", key !== view));
  $("#case-detail-view")?.classList.add("hidden");
  $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const nav = $(`.nav-item[data-view="${view}"] [data-i18n]`);
  $("#breadcrumb-current").textContent = nav?.textContent || copy[state.locale].navTeams;
}
function navigate(path) { history.pushState({}, "", path); syncRoute(); window.scrollTo({ top: 0, behavior: "instant" }); }
async function renderNewProject() {
  const root = $("#new-project-view");
  root.innerHTML = [
    '<section class="page-heading"><div><div class="eyebrow">创建团队草案 · 01 / 召唤团队</div><h1>用一句话创建团队</h1><p>先说清楚目标，再选择协作方式。系统会创建一个可继续对话完善的团队草案，确认后才进入团队库，之后再单独配置项目。</p></div><a class="secondary-button" href="/studio" data-route="/studio">返回团队库</a></section>',
    '<section class="project-builder"><div class="project-step active"><span>01</span><div><strong>创建团队</strong><small>描述目标并选择协作偏好，生成团队草案。</small></div></div><div class="project-step"><span>02</span><div><strong>确认入库</strong><small>通过结构校验后保存为可复用团队资产。</small></div></div><div class="project-step"><span>03</span><div><strong>选择团队运行</strong><small>从团队库选择团队，再配置材料和任务。</small></div></div>',
    '<form id="new-project-form" class="project-form"><label>团队名称<input name="name" required maxlength="120" placeholder="例如：产品研究团队"></label><label>你希望团队完成什么？<textarea name="intent" required maxlength="4000" rows="5" placeholder="例如：分析我上传的竞品资料，输出市场机会、竞品对比和产品建议。"></textarea></label><fieldset class="builder-choice-group"><legend>团队更适合怎样协作？</legend><div class="builder-choice-grid"><button class="builder-choice" type="button" data-builder-choice="顺序接力：每个角色完成后交给下一个" aria-pressed="false"><strong>顺序接力</strong><span>适合明确、可追踪的工作流程</span></button><button class="builder-choice" type="button" data-builder-choice="独立分析后汇总：多个角色分别研究，最后统一整理" aria-pressed="false"><strong>独立分析后汇总</strong><span>适合需要多角度判断的任务</span></button><button class="builder-choice" type="button" data-builder-choice="负责人协调：由一个负责人安排和检查其他角色" aria-pressed="false"><strong>负责人协调</strong><span>适合目标变化较多的工作</span></button></div></fieldset><p class="form-hint">创建后可以继续用自然语言完善角色、流程和输出要求；模型、工具和权限等专业配置按需展开。</p><div class="form-actions"><button class="primary-button" type="submit">创建团队草案 <span aria-hidden="true">→</span></button></div><p class="form-status" id="new-project-status"></p></form></section>'
  ].join("");
  $$("[data-builder-choice]").forEach((choice) => choice.addEventListener("click", () => {
    $$('[data-builder-choice]').forEach((item) => { item.classList.remove("selected"); item.setAttribute("aria-pressed", "false"); });
    choice.classList.add("selected");
    choice.setAttribute("aria-pressed", "true");
  }));
  $("#new-project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = $("#new-project-status");
    status.textContent = "正在创建团队草案…";
    try {
      const preference = $("[data-builder-choice].selected")?.dataset.builderChoice;
      const intent = [String(form.get("intent") || "").trim(), preference ? `协作偏好：${preference}` : ""].filter(Boolean).join("\n\n");
      const response = await fetch("/api/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), intent, templateId: "empty" }) });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "项目创建失败");
      state.projectId = project.projectId;
      navigate("/studio/project/" + encodeURIComponent(project.projectId));
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
  root.innerHTML = '<div class="panel-head"><div><span class="section-kicker">自然语言完善</span><h2>继续和团队对话</h2></div><span class="status-chip">nl2mmd</span></div><p class="panel-intro">告诉我你想增加、删除或调整什么。每次修改都会先生成预览，确认后才保存到草案。</p><div class="assistant-history" id="team-assistant-history"><div class="assistant-message"><strong>可以这样说</strong><span>增加一个事实核查角色，并让最终结论都附上来源。</span></div></div><div class="assistant-choices"><button type="button" class="builder-choice" data-assistant-choice="按顺序接力完成任务，并在最后增加人工审核"><strong>增加审核</strong><span>在最终输出前检查质量</span></button><button type="button" class="builder-choice" data-assistant-choice="减少角色，优先保证运行速度和成本"><strong>减少角色</strong><span>让流程更短、更容易运行</span></button><button type="button" class="builder-choice" data-assistant-choice="为每个关键结论增加来源引用要求"><strong>增加来源</strong><span>让结果更容易核查</span></button></div><label class="assistant-input-label"><span>告诉团队助手下一步怎么改</span><textarea id="team-assistant-input" rows="3" maxlength="4000" placeholder="例如：让研究员先分析，再让审核员检查事实依据"></textarea></label><div class="form-actions"><button class="primary-button" type="button" id="team-assistant-send">生成修改预览</button><a class="secondary-button" id="team-assistant-vis" href="#" target="_self">打开 Vis 专业编辑</a></div><p class="form-status" id="team-assistant-status"></p><div id="team-assistant-preview"></div>';
  $("#team-assistant-vis").href = `${state.visUrl}/?projectId=${encodeURIComponent(projectId)}&panel=design`;
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
async function renderProjectLibrary() {
  const root = $("#workspace-view");
  root.innerHTML = '<section class="page-heading library-heading"><div><div class="eyebrow">团队库 · OGS TEAM LIBRARY</div><h1>选择或创建团队</h1><p>团队是可复用的静态 OGS 结构。先创建并确认团队，再选择它创建项目工作区，配置材料并运行任务。</p></div><div class="heading-actions"><label class="secondary-button import-project-button">导入团队资产<input id="project-import-file" type="file" accept="application/json" hidden></label><a class="primary-button" href="/studio/new" data-route="/studio/new">创建团队 →</a></div></section><section class="project-library-toolbar"><div><strong>团队资产</strong><span>团队资产只保存结构和配置；材料、任务和运行记录会在项目工作区中单独管理。</span></div><div class="project-library-filters"><label><span class="sr-only">搜索团队</span><input id="project-library-search" type="search" placeholder="搜索团队名称或目标"></label><label><span class="sr-only">筛选状态</span><select id="project-library-filter"><option value="all">全部状态</option><option value="draft">草案</option><option value="confirmed">已确认</option></select></label></div></section><div id="project-library-grid" class="project-library-grid"><div class="project-loading">正在读取团队库...</div></div>';
  const createTeamLink = root.querySelector(".heading-actions a.primary-button");
  if (createTeamLink) createTeamLink.textContent = "创建团队 →";
  const grid = $("#project-library-grid");
  const classicSection = `<section class="classic-team-section"><div class="section-header"><div><div class="section-kicker">经典团队</div><h2>先了解成熟的协作方式</h2><p class="section-description">这些是平台提供的静态示例，用来理解角色分工和协作路径。使用经典团队会先复制为你的团队资产，不会修改示例本身。</p></div><a class="hero-link" href="/examples" data-route="/examples">查看全部案例 →</a></div><div class="classic-team-grid">${state.cases.map((item) => `<article class="classic-team-card" data-accent="${esc(item.accent)}"><div class="classic-team-card-top"><span class="asset-mark">${esc(icon[item.icon] || "✦")}</span><span class="status-chip">${esc(text(item.category))}</span></div><h3>${esc(text(item.title))}</h3><p>${esc(text(item.short))}</p><div class="classic-team-meta"><span>${esc(item.duration?.[state.locale] || item.duration?.["zh-CN"] || "")}</span><span>${item.roles.length} 个角色</span></div><a class="secondary-button" href="/cases/${encodeURIComponent(item.id)}" data-route="/cases/${encodeURIComponent(item.id)}">查看经典团队 →</a></article>`).join("")}</div></section>`;
  grid.insertAdjacentHTML("beforebegin", classicSection);
  try {
    const response = await fetch("/api/v1/projects"); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法读取项目库");
    const projects = payload.projects || [];
    grid.innerHTML = projects.length ? projects.map((project) => `<article class="project-asset-card" data-project-status="${esc(project.projectStatus)}"><div class="asset-card-top"><span class="asset-mark">O</span><span class="status-chip ${project.projectStatus}">${project.projectStatus === "confirmed" ? "团队已确认" : "团队草案"}</span></div><h2>${esc(project.name)}</h2><p>${esc(project.intent || "还没有填写团队目标")}</p><div class="asset-card-meta"><span>${project.projectStatus === "confirmed" ? "可使用团队并配置项目" : "需要先确认团队"}</span><span>${new Date(project.updatedAt).toLocaleDateString()}</span></div><a class="secondary-button" href="/studio/project/${encodeURIComponent(project.projectId)}" data-route="/studio/project/${encodeURIComponent(project.projectId)}">打开团队资产 →</a></article>`).join("") : '<div class="empty-projects"><strong>还没有团队资产</strong><p>从一句话召唤团队，创建你的第一个团队草案。</p><a class="primary-button" href="/studio/new" data-route="/studio/new">召唤第一支团队</a></div>';
    [...grid.querySelectorAll(".project-asset-card")].forEach((card, index) => {
      const project = projects[index];
      const primary = card.querySelector("a.secondary-button");
      if (!primary || !project) return;
      if (project.projectStatus === "confirmed") {
        primary.className = "primary-button";
        primary.href = "/studio/project/" + encodeURIComponent(project.projectId) + "/run";
        primary.textContent = "使用团队 →";
        primary.insertAdjacentHTML("afterend", "<a class=\"secondary-button\" href=\"/studio/project/" + encodeURIComponent(project.projectId) + "\" data-route=\"/studio/project/" + encodeURIComponent(project.projectId) + "\">编辑团队</a>");
      } else {
        primary.textContent = "编辑团队 →";
      }
    });
    $$("a[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.getAttribute("href")); }));
    const filterLibrary = () => {
      const query = $("#project-library-search")?.value.trim().toLowerCase() || "";
      const filter = $("#project-library-filter")?.value || "all";
      const cards = $$(".project-asset-card");
      cards.forEach((card) => {
        const matchesQuery = !query || card.textContent.toLowerCase().includes(query);
        const matchesFilter = filter === "all" || card.dataset.projectStatus === filter;
        card.hidden = !(matchesQuery && matchesFilter);
      });
      let empty = grid.querySelector(".library-filter-empty");
      const hasVisibleCard = cards.some((card) => !card.hidden);
      if (!hasVisibleCard && cards.length) {
        if (!empty) {
          grid.insertAdjacentHTML("beforeend", '<div class="empty-projects library-filter-empty"><strong>没有匹配的团队资产</strong><p>换一个关键词或清除筛选。</p></div>');
          empty = grid.querySelector(".library-filter-empty");
        }
        empty.hidden = false;
      } else if (empty) empty.hidden = true;
    };
    $("#project-library-search")?.addEventListener("input", filterLibrary);
    $("#project-library-filter")?.addEventListener("change", filterLibrary);
    $("#project-import-file").addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (!file) return; event.target.value = ""; try { const imported = await fetch("/api/v1/team-packages/import", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() }); const result = await imported.json(); if (!imported.ok) throw new Error(result.error); navigate(`/studio/project/${encodeURIComponent(result.projectId)}`); } catch (error) { showToast(error.message || "导入失败"); } });
  } catch (error) { grid.innerHTML = `<div class="run-error">${esc(error.message || "无法读取项目库")}</div>`; }
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

function addProjectExportToolbar(projectId) {
  const root = $("#project-workspace-view");
  if (!root || root.querySelector(".project-toolbar")) return;
  root.insertAdjacentHTML("afterbegin", '<div class="project-toolbar"><span>已确认团队 · 可继续准备材料或运行任务</span><a class="secondary-button" href="/api/v1/projects/' + encodeURIComponent(projectId) + '/team/export">导出团队资产</a></div>');
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
  const modeLabel = payload.mode === "sandbox" ? "Sandbox Run · 隔离执行" : "Dry Run · 结构预览";
  const nodes = (payload.runPlan?.nodeGraph || []).map((node) => `<div class="analysis-row"><strong>${esc(node.nodeId)}</strong><span>${esc(node.reviewRequired ? "审核节点" : "执行节点")}</span></div>`).join("");
  const actions = [];
  if (["waiting_review", "paused", "ready"].includes(stateStatus)) actions.push(`<button class="secondary-button" type="button" data-project-run-action="resume" data-run-id="${esc(runId)}">继续运行</button>`);
  if (["running", "planning", "waiting_review", "paused", "ready"].includes(stateStatus)) actions.push(`<button class="secondary-button danger-button" type="button" data-project-run-action="cancel" data-run-id="${esc(runId)}">停止运行</button>`);
  if (stateStatus === "failed") actions.push(`<button class="secondary-button" type="button" data-project-run-action="retry" data-run-id="${esc(runId)}">从快照重新运行</button>`);
  actions.push(`<a class="secondary-button" data-project-run-action="vis" href="${esc(state.visUrl)}/?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(runId)}&panel=diagnosis">在 Vis 中查看诊断</a>`);
  result.innerHTML = `<div class="run-result-card" data-run-id="${esc(runId)}"><div class="run-result-header"><strong>${esc(projectRunStatusLabel(stateStatus))}</strong><span class="run-mode">${esc(modeLabel)}</span></div><span class="run-plan-status">运行计划已固定 · RunPlan</span><span class="run-result-meta">运行 ID：${esc(runId)} · ${(payload.runPlan?.nodeGraph || []).length} 个节点 · ${(payload.materials || []).length} 份材料</span><pre>${esc(payload.result?.finalOutput || payload.result?.status || projectRunStatusLabel(stateStatus))}</pre><div class="form-actions project-run-actions">${actions.join("")}</div><details class="run-analysis"><summary>查看执行分析</summary><p>产品站点展示运行摘要；需要逐节点输入输出、事件和故障定位时，请在 Vis 专业工作台查看同一运行。</p>${nodes}</details></div>`;
  result.querySelectorAll("[data-project-run-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.projectRunAction;
    if (action === "vis") return;
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
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio" data-route="/studio">← 团队库</a><div class="eyebrow">01 / 创建团队</div><h1>${esc(project.name)}</h1><p>${esc(project.intent || "还没有填写团队目标")}</p></div><span class="project-status ${confirmed ? "confirmed" : "draft"}">${confirmed ? "团队已确认，可使用团队" : "团队草案，可继续微调"}</span></section><nav class="project-steps"><a class="project-step active" href="#team"><span>01</span><strong>创建团队</strong><small>${confirmed ? "OGS 团队资产已确认" : "确认前可继续微调"}</small></a><a class="project-step ${confirmed ? "" : "disabled"}" href="${confirmed ? `/studio/project/${encodeURIComponent(projectId)}/run` : "#"}" data-route="${confirmed ? `/studio/project/${encodeURIComponent(projectId)}/run` : ""}"><span>02</span><strong>使用团队</strong><small>${confirmed ? "创建项目工作区" : "确认后解锁"}</small></a><a class="project-step disabled" href="#"><span>03</span><strong>运行任务</strong><small>配置材料并检查结果</small></a></nav><section class="project-grid draft-grid"><article class="project-panel project-editor-panel" id="team"><div class="panel-head"><div><span class="section-kicker">团队资产</span><h2>把一句话变成可运行的团队</h2></div><span class="count-badge">${confirmed ? "OK" : "DRAFT"}</span></div><form id="project-edit-form-v2" class="compact-form"><label>团队名称<input name="name" value="${esc(project.name)}" required maxlength="120"></label><label>团队目标<textarea name="intent" rows="6" maxlength="4000" required>${esc(project.intent || "")}</textarea></label><div class="form-actions"><button class="secondary-button" type="submit">保存微调</button>${confirmed ? '<button id="reconfirm-project-v2" class="secondary-button" type="button">重新确认</button>' : '<button id="confirm-project-v2" class="primary-button" type="button">确认团队并进入团队库 →</button>'}</div><p class="form-status" id="project-edit-status-v2"></p></form></article><article class="project-panel project-preview-panel"><div class="panel-head"><div><span class="section-kicker">OGS 结构预览</span><h2>团队资产</h2></div><span class="status-chip">single-project-v1</span></div><div class="preview-list"><div><strong>资产状态</strong><span>${confirmed ? "团队已确认" : "团队草案"}</span></div><div><strong>结构来源</strong><span>OGS / Mermaid</span></div><div><strong>项目关系</strong><span>团队 + 资源 + 运行</span></div></div><p class="preview-note">团队包只包含静态 OGS 资源；使用团队后创建的项目工作区才会保存材料、任务和运行记录。</p><div class="form-actions"><a class="secondary-button" href="/api/v1/projects/${encodeURIComponent(projectId)}/team/export">导出团队资产</a>${confirmed ? `<a class="primary-button" href="/studio/project/${encodeURIComponent(projectId)}/run" data-route="/studio/project/${encodeURIComponent(projectId)}/run">使用团队 →</a>` : ""}</div></article></section>`;
    root.insertAdjacentHTML("beforeend", '<section class="project-panel project-graph-preview"><div class="panel-head"><div><span class="section-kicker">OGS / Mermaid</span><h2>团队协作结构</h2><p id="project-design-status" class="form-status">正在加载可编辑团队结构</p></div><div class="form-actions"><span class="status-chip">可视化编辑</span><a class="secondary-button" href="' + esc(state.visUrl) + '/?projectId=' + encodeURIComponent(projectId) + '&panel=design" target="_self">在 Vis 中打开专业工作台</a></div></div><div id="project-graph-stage" class="graph-stage studio-graph-island" role="application" aria-label="Editable project team graph"></div><p class="preview-note">这里提供轻量编辑和预览；模型、上下文、单步调试与运行诊断请在 Vis 专业工作台处理。保存语义修改后，团队会回到草案状态。</p></section>');
    root.insertAdjacentHTML("beforeend", '<section class="project-panel team-assistant-panel" id="team-assistant"></section>');
    void renderTeamAssistant(projectId, project);
    $$("a[data-route]").forEach((link) => link.addEventListener("click", (event) => { if (link.getAttribute("href")) { event.preventDefault(); navigate(link.getAttribute("href")); } }));
    $("#project-edit-form-v2").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), intent: form.get("intent") }) }); const payload = await result.json(); $("#project-edit-status-v2").textContent = result.ok ? (payload.projectStatus === "draft" ? "已保存，语义修改使项目回到草案。" : "已保存。") : (payload.error || "保存失败"); if (result.ok) await renderProjectDraftV2(projectId); });
    const confirm = $("#confirm-project-v2") || $("#reconfirm-project-v2"); confirm?.addEventListener("click", async () => { const result = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/team/confirm`, { method: "POST" }); const payload = await result.json(); if (!result.ok) { $("#project-edit-status-v2").textContent = payload.error || "确认失败"; return; } await renderProjectDraftV2(projectId); });
  } catch (error) { root.innerHTML = `<div class="run-error">${esc(error.message || "项目读取失败")}</div>`; }
}

async function renderProjectRunV2(projectId) {
  const root = $("#project-workspace-view"); root.innerHTML = '<div class="project-loading">正在读取运行工作区...</div>';
  try {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`); const project = await response.json(); if (!response.ok) throw new Error(project.error || "项目不存在");
    if (project.projectStatus !== "confirmed") { navigate(`/studio/project/${encodeURIComponent(projectId)}`); return; }
    const materials = project.materials?.materials || []; const runs = project.runs || [];
    root.innerHTML = `<section class="page-heading"><div><a class="detail-back" href="/studio/project/${encodeURIComponent(projectId)}" data-route="/studio/project/${encodeURIComponent(projectId)}">← 团队配置</a><div class="eyebrow">已选团队 · 项目工作区</div><h1>${esc(project.name)}</h1><p>${esc(project.intent || "")}</p></div><span class="project-status confirmed">团队已确认，可配置项目</span></section><nav class="project-steps"><a class="project-step completed" href="/studio/project/${encodeURIComponent(projectId)}" data-route="/studio/project/${encodeURIComponent(projectId)}"><span>01</span><strong>团队资产</strong><small>已确认的 OGS 团队</small></a><a class="project-step active" href="#workspace"><span>02</span><strong>配置资源</strong><small>材料会复制到运行快照</small></a><a class="project-step active" href="#task"><span>03</span><strong>运行任务</strong><small>选择模式并检查结果</small></a></nav><section class="project-grid"><article class="project-panel" id="workspace"><div class="panel-head"><div><span class="section-kicker">02 / 项目资源</span><h2>为项目准备材料</h2></div><span class="count-badge">${materials.length}</span></div><p class="panel-intro">材料属于项目工作区。开始运行时，系统会把它们复制为不可变快照，之后删除原材料也不会改变本次运行。</p><form id="material-form-v2" class="compact-form"><input name="filename" required placeholder="文件名，例如 brief.md"><textarea name="content" required rows="4" placeholder="粘贴 Markdown、文本或结构化材料"></textarea><button class="secondary-button" type="submit">添加到工作空间</button><p class="form-status" id="material-status-v2"></p></form><div class="material-list">${materials.length ? materials.map((item) => `<div class="material-row"><strong>${esc(item.filename)}</strong><span>${esc(item.status)} · ${item.size} bytes</span></div>`).join("") : '<p class="empty-note">还没有材料。先添加一份需求、竞品或背景资料。</p>'}</div></article><article class="project-panel" id="task"><div class="panel-head"><div><span class="section-kicker">03 / 运行</span><h2>让团队完成什么？</h2></div><select id="project-run-mode-v2" class="run-mode-select" aria-label="运行模式"><option value="dry-run">Dry Run · 结构预览</option><option value="sandbox">Sandbox Run · 隔离执行</option></select></div><p class="panel-intro">Dry Run 只检查流程和快照；Sandbox Run 会执行模型，并在隔离环境模拟工具副作用。Real Run 当前未开放。</p><form id="project-run-form-v2" class="compact-form"><textarea name="prompt" required rows="5" maxlength="4000" placeholder="例如：基于工作空间材料，输出一份结构化市场分析"></textarea><button class="primary-button" type="submit">创建运行并执行 <span aria-hidden="true">▶</span></button><p class="form-status" id="run-status-v2"></p></form><div id="project-run-result-v2"></div><div class="run-list">${runs.slice(0, 5).map((run) => `<div class="material-row"><strong>${esc(run.runId)}</strong><span>${esc(run.status || "记录")}</span></div>`).join("")}</div></article></section>`;
    $$("a[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.getAttribute("href")); }));
    $("#material-form-v2").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/materials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: form.get("filename"), content: form.get("content"), contentType: "text/plain" }) }); const payload = await result.json(); if (!result.ok) { $("#material-status-v2").textContent = payload.error || "材料添加失败"; return; } await renderProjectRunV2(projectId); });
    $("#project-run-form-v2").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const prompt = new FormData(form).get("prompt"); const mode = $("#project-run-mode-v2").value; const status = $("#run-status-v2"); const button = form.querySelector("button[type=submit]"); const idempotencyKey = crypto.randomUUID(); button.disabled = true; status.textContent = `正在创建 ${mode === "sandbox" ? "Sandbox Run" : "Dry Run"}…`; try { const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, mode, idempotencyKey }) }); const payload = await response.json(); if (!response.ok) { status.textContent = payload.error || "运行失败"; return; } status.textContent = `运行已完成：${payload.runId}`; renderProjectRunResult(projectId, payload); } catch (error) { status.textContent = error.message || "运行失败"; } finally { button.disabled = false; } });
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
  const projectMatch = path.match(/^\/studio\/project\/([a-z0-9-]+)$/);
  if (projectMatch) {
    setView("project-workspace");
    void renderProjectDraftV2(projectMatch[1]).then(() => renderProjectGraph(projectMatch[1]));
    return;
  }
  const projectRunMatch = path.match(/^\/studio\/project\/([a-z0-9-]+)\/run$/);
  if (projectRunMatch) {
    setView("project-workspace");
    void renderProjectRunV2(projectRunMatch[1]).then(() => {
      addProjectExportToolbar(projectRunMatch[1]);
      mountRunTeamGraph(projectRunMatch[1]);
    });
    return;
  }
  if (path === "/studio" && new URLSearchParams(location.search).has("team")) {
    const id = new URLSearchParams(location.search).get("team");
    if (state.cases.some((entry) => entry.id === id)) state.selected = id;
  }
  if (path === "/studio") { state.view = "workspace"; void renderProjectLibrary(); }
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
    const response = await fetch("/api/v1/demo-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: item.id, prompt, locale: state.locale }) });
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
  document.addEventListener("submit", (event) => {
    if (event.target?.id !== "material-form-v2") return;
    const match = location.pathname.match(/^\/studio\/project\/([a-z0-9-]+)\/run$/);
    if (match) setTimeout(() => { addProjectExportToolbar(match[1]); mountRunTeamGraph(match[1]); }, 100);
  });
  window.addEventListener("popstate", syncRoute);
  $$("button.nav-item[data-view]").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; history.pushState({}, "", `/${state.view}`); syncRoute(); }));
  $$("#locale-toggle, #landing-locale").forEach((button) => button.addEventListener("click", () => { state.locale = state.locale === "zh-CN" ? "en" : "zh-CN"; localStorage.setItem("ogs-locale", state.locale); applyLocale(); }));
  $$('[data-site-theme-choice]').forEach((button) => button.addEventListener("click", () => applySiteTheme(button.dataset.siteThemeChoice)));
  $("#task-input")?.addEventListener("input", updateCount); $("#run-button")?.addEventListener("click", runSelected);
  $("#edit-task-button")?.addEventListener("click", () => { $("#task-input")?.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("#clear-history")?.addEventListener("click", () => { state.history = []; saveHistory(); renderHistory(); });
  $$('[data-close-drawer]').forEach((element) => element.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
  applyLocale();
  const team = new URLSearchParams(location.search).get("team"); if (team && state.cases.some((item) => item.id === team)) state.selected = team;
  if (!isProjectRoute() && $("#task-input")) selectCase(state.selected);
  syncRoute(); updateCount();
}
init().catch((error) => { document.body.innerHTML = `<main class="fatal-error">${esc(error.message)}</main>`; });
