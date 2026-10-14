const state = { cases: [], selected: null, locale: localStorage.getItem("ogs-locale") || "zh-CN", view: "workspace", history: readHistory() };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const text = (value) => value?.[state.locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const eventLabels = {
  SOFTWARE_REQUEST: ["软件需求", "Software request"], PLAN_BACKEND: ["制定后端方案", "Plan backend"], PLAN_EXPERIENCE: ["制定体验方案", "Plan experience"], PLAN_QUALITY: ["制定质量方案", "Plan quality"], BACKEND_PLAN_READY: ["后端方案就绪", "Backend plan ready"], EXPERIENCE_PLAN_READY: ["体验方案就绪", "Experience plan ready"], QUALITY_PLAN_READY: ["质量方案就绪", "Quality plan ready"], DELIVERY_READY: ["交付方案就绪", "Delivery ready"], CASE_RECEIVED: ["收到会诊资料", "Case received"], START_CARDIOLOGY: ["请心血管专科评估", "Request cardiology review"], START_NEUROLOGY: ["请神经专科评估", "Request neurology review"], START_IMAGING: ["请影像专科评估", "Request imaging review"], CARDIOLOGY_REVIEW_READY: ["心血管评估完成", "Cardiology review ready"], NEUROLOGY_REVIEW_READY: ["神经专科评估完成", "Neurology review ready"], IMAGING_REVIEW_READY: ["影像评估完成", "Imaging review ready"], CONSULTATION_READY: ["会诊建议就绪", "Consultation ready"], DEBATE_TOPIC: ["辩题", "Debate topic"], ISSUE_TO_PRO: ["提交正方", "Issue to proposition"], ISSUE_TO_CON: ["提交反方", "Issue to opposition"], PRO_ARGUMENT_READY: ["正方论点完成", "Proposition argument ready"], CON_ARGUMENT_READY: ["反方论点完成", "Opposition argument ready"], REBUTTAL_REQUESTED: ["请求补充辩论", "Rebuttal requested"], DECISION_READY: ["裁决完成", "Decision ready"], DEBATE_SUMMARY_READY: ["辩论纪要完成", "Debate summary ready"]
};

const copy = {
  "zh-CN": {
    workspaceName: "个人工作台", workspaceType: "访客空间", navTeams: "团队工作台", navExamples: "案例库", navRuns: "最近运行", runtimeReady: "运行服务就绪", navGuide: "产品指南", crumbHome: "工作区", guestMode: "访客体验", eyebrow: "AGENT TEAM WORKSPACE", pageTitle: "把复杂任务，交给一支有分工的团队", pageIntro: "从一个目标开始。选择团队角色，查看协作路径，再运行一次完整流程。", metaLabel: "本次体验", metaValue: "模拟角色 · 真实流程", taskLabel: "你想完成什么？", taskHint: "先选一个团队案例，也可以改写任务目标", taskPlaceholder: "例如：为一款面向自由职业者的记账工具设计首版研发方案", charCount: "/ 1,200", runDemo: "运行团队示例", chooseCase: "STEP 01 · 选择协作方式", caseHeading: "从经典团队开始", allExamples: "查看全部案例", teamPlan: "STEP 02 · 团队方案", temporaryConfig: "临时配置", adjustWithChat: "调整任务", membersTitle: "团队成员", membersSubtitle: "每个角色负责一类工作", memberNote: "角色名称与职责可随团队模板切换；高级自定义将在后续版本开放。", flowTitle: "协作流程", flowSubtitle: "从任务输入到最终交付", legendRole: "团队角色", legendFlow: "任务交接", taskInputNode: "任务", deliveryNode: "交付", splitNote: "分支按运行语义执行，并在汇总节点收集所需结果。", capabilityKicker: "清晰、有边界、可追踪", capabilityTitle: "每一次协作，都有迹可循", capabilityBody: "团队按职责交接工作，运行过程保留时间线。需要人工把关时，可暂停、审查并继续。", capabilityOne: "明确角色职责", capabilityOneBody: "每个成员有清晰输入与交付", capabilityTwo: "按流程汇总", capabilityTwoBody: "并行分工、全员或法定人数汇合", capabilityThree: "查看运行证据", capabilityThreeBody: "进度、结果和交接记录可回看", footerNote: "当前为公开体验版。角色输出使用模拟内容，展示真实流程语义。", footerLink: "了解产品边界", runHistoryEyebrow: "RUN HISTORY", historyTitle: "最近运行", historyIntro: "本机浏览器临时保存的体验记录。", clearHistory: "清空记录", guideEyebrow: "PRODUCT GUIDE", guideTitle: "让团队协作变得清晰可控", guideIntro: "从职责分工到交付结果，了解一次 Agent Team 运行会发生什么。", guide1Title: "先定义目标", guide1Body: "告诉团队希望完成什么，模板会提供一组职责明确的角色。", guide2Title: "查看分工与交接", guide2Body: "协作图展示角色之间如何交接，以及哪些结果需要汇总。", guide3Title: "运行并检查结果", guide3Body: "运行记录按时间展示角色状态、交接事件和最终交付。", guide4Title: "公开体验模式", guide4Body: "示例通过框架运行真实图流程，但角色输出使用模拟内容，不调用真实模型。请勿提交个人或敏感信息。", libraryEyebrow: "TEAM LIBRARY", libraryTitle: "案例库", libraryIntro: "选择一种协作方式，查看团队如何分工、汇总和交付。", errorDemoKicker: "能力演示", errorDemoTitle: "失败后继续有序处理", errorDemoBody: "查看受控故障如何进入补偿或升级流程，并保留运行记录。", comingSoon: "即将开放", runPanelKicker: "TEAM RUN", runPanelTitle: "团队运行", noHistory: "还没有运行记录。选择一个案例并运行团队示例。", running: "正在运行团队流程…", runFailed: "运行未完成", simulation: "模拟运行", rolesCompleted: "角色执行", transitions: "流程交接", elapsed: "耗时", finalDelivery: "最终交付", timeline: "运行时间线", noOutput: "框架没有返回最终交付内容。", historyDone: "已完成", selectCase: "已选择", roleReady: "待运行", inputRequired: "请先输入任务目标。", networkError: "暂时无法连接运行服务，请稍后重试。", promptCopied: "已载入案例任务，可继续修改。", selected: "当前团队", close: "关闭", historyRestore: "查看运行", runAgain: "再次运行", inputEvent: "任务进入", outputEvent: "流程结束"
  },
  en: {
    workspaceName: "Personal workspace", workspaceType: "Guest space", navTeams: "Team workspace", navExamples: "Case library", navRuns: "Recent runs", runtimeReady: "Runtime ready", navGuide: "Product guide", crumbHome: "Workspace", guestMode: "Guest preview", eyebrow: "AGENT TEAM WORKSPACE", pageTitle: "Give complex work to a team with clear roles", pageIntro: "Start with an outcome. Choose a team, inspect its flow, then run the complete workflow.", metaLabel: "This preview", metaValue: "Simulated roles · real workflow", taskLabel: "What would you like to accomplish?", taskHint: "Choose a team example or rewrite the task", taskPlaceholder: "For example: plan the first release of a bookkeeping tool for independent professionals", charCount: "/ 1,200", runDemo: "Run team example", chooseCase: "STEP 01 · CHOOSE A COLLABORATION PATTERN", caseHeading: "Start with a classic team", allExamples: "Browse all cases", teamPlan: "STEP 02 · TEAM DESIGN", temporaryConfig: "Temporary config", adjustWithChat: "Edit task", membersTitle: "Team members", membersSubtitle: "Each role owns a part of the work", memberNote: "Roles and responsibilities change with the selected template. Advanced customization is planned for a later release.", flowTitle: "Collaboration flow", flowSubtitle: "From task input to final delivery", legendRole: "Team role", legendFlow: "Handoff", taskInputNode: "Task", deliveryNode: "Delivery", splitNote: "Branches follow the configured run semantics and collect required results at the join.", capabilityKicker: "Clear, bounded, traceable", capabilityTitle: "Every collaboration leaves a trail", capabilityBody: "Roles hand work off by responsibility, with a timeline for each run. Review and continue when human oversight is needed.", capabilityOne: "Clear role ownership", capabilityOneBody: "Each member has defined inputs and outputs", capabilityTwo: "Workflow-based joins", capabilityTwoBody: "Parallel work, all-of, or quorum joins", capabilityThree: "Inspectable run evidence", capabilityThreeBody: "Review progress, results, and handoffs", footerNote: "Public preview. Role outputs are simulated while the framework runs the actual workflow semantics.", footerLink: "Product boundaries", runHistoryEyebrow: "RUN HISTORY", historyTitle: "Recent runs", historyIntro: "Preview history stored temporarily in this browser.", clearHistory: "Clear history", guideEyebrow: "PRODUCT GUIDE", guideTitle: "Make team collaboration clear and controlled", guideIntro: "See what happens during an Agent Team run, from role ownership to delivery.", guide1Title: "Define the outcome", guide1Body: "Describe what the team should accomplish. A template supplies roles with clear responsibilities.", guide2Title: "Inspect work and handoffs", guide2Body: "The flow shows how roles pass work and which results must be collected.", guide3Title: "Run and review", guide3Body: "The run timeline shows role states, handoff events, and the final delivery.", guide4Title: "Public preview mode", guide4Body: "The framework runs the actual graph workflow, while role outputs are simulated and no model is called. Do not submit personal or sensitive information.", libraryEyebrow: "TEAM LIBRARY", libraryTitle: "Case library", libraryIntro: "Choose a collaboration pattern to see how a team divides, joins, and delivers work.", errorDemoKicker: "CAPABILITY PREVIEW", errorDemoTitle: "Recover in a controlled way", errorDemoBody: "See how a controlled failure can enter compensation or escalation while preserving the run record.", comingSoon: "Coming soon", runPanelKicker: "TEAM RUN", runPanelTitle: "Team run", noHistory: "No run history yet. Choose a case and run the team example.", running: "Running the team workflow…", runFailed: "Run did not complete", simulation: "Simulation", rolesCompleted: "Role executions", transitions: "Transitions", elapsed: "Duration", finalDelivery: "Final delivery", timeline: "Run timeline", noOutput: "The framework returned no final delivery content.", historyDone: "Completed", selectCase: "Selected", roleReady: "Ready", inputRequired: "Enter a task to run.", networkError: "The runtime is temporarily unavailable. Try again shortly.", promptCopied: "Example task loaded. You can edit it before running.", selected: "Selected team", close: "Close", historyRestore: "View run", runAgain: "Run again", inputEvent: "Task received", outputEvent: "Workflow complete"
  }
};
Object.assign(copy["zh-CN"], {
  splitNote: "分支按图中路由语义依次进入流程，并在汇总节点收集所需结果。",
  capabilityTwoBody: "分支调度、全员或法定人数汇合"
});
Object.assign(copy.en, {
  splitNote: "Branches follow the diagram's routing semantics in order, then collect required results at the join.",
  capabilityTwoBody: "Branch routing, all-of, or quorum joins"
});
Object.assign(copy["zh-CN"], {
  runResult: "运行说明",
  dryOutput: "框架已完成流程模拟验证。本次访客运行未调用角色模型，因此没有生成业务交付内容。"
});
Object.assign(copy.en, {
  runResult: "Run details",
  dryOutput: "The framework completed a workflow dry run. Guest preview does not call role models, so this run did not generate a business deliverable."
});
Object.assign(copy["zh-CN"], {
  footerNote: "公开体验会运行框架图流程的 dry-run，不调用真实角色模型，也不会生成业务交付内容。",
  guide4Body: "示例通过框架 dry-run 校验图流程与路由语义，不调用真实模型，也不会生成角色内容。请勿提交个人或敏感信息。"
});
Object.assign(copy.en, {
  footerNote: "The public preview runs the framework graph in dry-run mode. It does not call role models or generate business deliverables.",
  guide4Body: "The framework dry-runs the graph and routing semantics. It does not call models or generate role content. Do not submit personal or sensitive information."
});

function readHistory() { try { return JSON.parse(localStorage.getItem("ogs-run-history") || "[]"); } catch { return []; } }
function saveHistory() { localStorage.setItem("ogs-run-history", JSON.stringify(state.history.slice(0, 12))); }
function labelEvent(event) { const label = eventLabels[event]; return label ? label[state.locale === "zh-CN" ? 0 : 1] : String(event || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function displayRun(run) { return typeof run === "string" ? run : JSON.stringify(run, null, 2); }

function applyLocale() {
  document.documentElement.lang = state.locale;
  $$('[data-i18n]').forEach((element) => { const value = copy[state.locale][element.dataset.i18n]; if (value) element.textContent = value; });
  $$('[data-i18n-placeholder]').forEach((element) => { const value = copy[state.locale][element.dataset.i18nPlaceholder]; if (value) element.placeholder = value; });
  $("#locale-toggle").textContent = state.locale === "zh-CN" ? "EN" : "中文";
  const selected = state.cases.find((item) => item.id === state.selected);
  if (selected) renderSelected(selected);
  renderCases();
  renderHistory();
  setView(state.view);
}

function renderCases() {
  const list = state.cases;
  const card = (item) => `<button class="case-card ${item.id === state.selected ? "selected" : ""}" data-case="${escapeHtml(item.id)}" data-accent="${escapeHtml(item.accent)}" type="button"><span class="case-card-top"><span class="case-icon">${escapeHtml(item.title.en.slice(0, 1))}</span>${item.id === state.selected ? `<span class="case-selected">${escapeHtml(copy[state.locale].selected)}</span>` : ""}</span><h3>${escapeHtml(text(item.title))}</h3><p>${escapeHtml(text(item.short))}</p><span class="case-card-foot"><span>${escapeHtml(text(item.category))}</span><span class="semantics">${item.semantics.map((semantic) => `<span class="semantic-chip">${escapeHtml(semantic)}</span>`).join("")}</span></span></button>`;
  $("#case-grid").innerHTML = list.map(card).join("");
  $("#library-grid").innerHTML = list.map((item) => `<article class="library-card"><span class="case-icon" data-accent="${escapeHtml(item.accent)}">${escapeHtml(item.title.en.slice(0, 1))}</span><h2>${escapeHtml(text(item.title))}</h2><p>${escapeHtml(text(item.short))}</p><div class="semantics">${item.semantics.map((semantic) => `<span class="semantic-chip">${escapeHtml(semantic)}</span>`).join("")}</div><button class="secondary-button" type="button" data-select-case="${escapeHtml(item.id)}">${escapeHtml(copy[state.locale].selectCase)}</button></article>`).join("");
  $$("[data-case]").forEach((button) => button.addEventListener("click", () => selectCase(button.dataset.case)));
  $$("[data-select-case]").forEach((button) => button.addEventListener("click", () => { selectCase(button.dataset.selectCase); setView("workspace"); window.scrollTo({ top: 0, behavior: "smooth" }); }));
}

function renderSelected(item) {
  $("#selected-case-title").textContent = text(item.title);
  $("#selected-case-description").textContent = text(item.short);
  $("#role-count").textContent = item.roles.length;
  $("#member-list").innerHTML = item.roles.map((role, index) => `<div class="member-row"><span class="member-avatar">${escapeHtml(text(role.label).slice(0, 1))}</span><div><div class="member-name">${escapeHtml(text(role.label))}</div><div class="member-role">${escapeHtml(role.id)}</div></div><span class="member-status">${escapeHtml(copy[state.locale].roleReady)}</span></div>`).join("");
  renderGraph(item);
}

function renderGraph(item) {
  const stage = $("#graph-stage");
  stage.style.width = "1080px";
  const positions = item.layout;
  const nodeWidth = 154;
  const nodeHeight = 62;
  const centers = Object.fromEntries(Object.entries(positions).map(([id, [x, y]]) => [id, [x + nodeWidth / 2, y + nodeHeight / 2]]));
  const flows = item.flows.map(({ from, to, event }) => {
    const start = from === "input" ? [63, 175] : centers[from];
    const end = to === "output" ? [927, 175] : centers[to];
    if (!start || !end) return "";
    const middle = Math.max(30, (end[0] - start[0]) * .48);
    const label = escapeHtml(labelEvent(event));
    const loop = event === "REBUTTAL_REQUESTED";
    const curve = loop ? `M ${end[0]} ${end[1] - 31} C ${end[0] + 175} ${end[1] - 115}, ${start[0] + 10} ${start[1] - 105}, ${start[0]} ${start[1] - 31}` : `M ${start[0]} ${start[1]} C ${start[0] + middle} ${start[1]}, ${end[0] - middle} ${end[1]}, ${end[0]} ${end[1]}`;
    return `<path class="edge-path ${loop ? "edge-loop" : ""}" d="${curve}"/><text class="edge-label" x="${(start[0] + end[0]) / 2}" y="${(start[1] + end[1]) / 2 - 8}">${label}</text>`;
  }).join("");
  $("#graph-edges").innerHTML = `<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#a7b9b0"/></marker></defs>${flows}`;
  $("#graph-nodes").innerHTML = item.roles.map((role, index) => {
    const [x, y] = positions[role.id] || [60 + index * 190, 145];
    const isJoin = item.joins.some((join) => join.roleId === role.id);
    return `<div class="graph-node node-${escapeHtml(role.id)} ${isJoin ? "join-node" : ""}"><div class="node-top"><span class="node-number">${String(index + 1).padStart(2, "0")}</span><span class="node-name" title="${escapeHtml(text(role.label))}">${escapeHtml(text(role.label))}</span></div><div class="node-role">${escapeHtml(role.id)}</div></div>`;
  }).join("");
}

function selectCase(caseId) {
  const item = state.cases.find((entry) => entry.id === caseId);
  if (!item) return;
  state.selected = caseId;
  renderSelected(item);
  renderCases();
  const input = $("#task-input");
  if (!input.value.trim()) input.value = item.taskExample?.[state.locale] || defaultTask(item);
  updateCount();
}

function defaultTask(item) {
  const defaults = {
    "software-team": { "zh-CN": "为一款面向自由职业者的记账工具制定首版研发方案，覆盖核心体验、技术拆分与验收标准。", en: "Plan the first release of a bookkeeping tool for independent professionals, covering core experience, engineering, and acceptance criteria." },
    "expert-consultation": { "zh-CN": "评估一位患者反复头痛且伴短暂视物模糊的情况，列出需要补充的信息与紧急风险信号。", en: "Review a case of recurring headache with brief blurred vision, noting missing information and urgent risk signals." },
    "structured-debate": { "zh-CN": "讨论一家 30 人的公司是否应采用每周三天到办公室的混合办公政策。", en: "Debate whether a 30-person company should adopt a hybrid policy requiring three office days per week." }
  };
  return defaults[item.id]?.[state.locale] || "";
}

function updateCount() { $("#input-count").textContent = $("#task-input").value.length; }
function setView(view) {
  state.view = view;
  const viewMap = { workspace: "workspace-view", examples: "examples-view", history: "history-view", guide: "guide-view" };
  Object.entries(viewMap).forEach(([key, id]) => $(`#${id}`).classList.toggle("hidden", key !== view));
  $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const nav = $(`.nav-item[data-view="${view}"] [data-i18n]`);
  $("#breadcrumb-current").textContent = nav?.textContent || copy[state.locale].navTeams;
}

function openDrawer() { $("#run-drawer").classList.add("open"); $("#run-drawer").setAttribute("aria-hidden", "false"); document.body.classList.add("drawer-open"); }
function closeDrawer() { $("#run-drawer").classList.remove("open"); $("#run-drawer").setAttribute("aria-hidden", "true"); document.body.classList.remove("drawer-open"); }
function openRun(result, item, prompt, id = crypto.randomUUID()) {
  const audit = result.auditTrail || [];
  const finalOutput = result.finalOutput;
  const dryRun = typeof finalOutput === "string" && finalOutput.startsWith("[dry-run]");
  const content = dryRun ? copy[state.locale].dryOutput : (typeof finalOutput === "string" ? finalOutput : finalOutput?.content || JSON.stringify(finalOutput ?? "", null, 2));
  const outputTitle = dryRun ? copy[state.locale].runResult : copy[state.locale].finalDelivery;
  const timeline = audit.map((entry) => `<div class="timeline-item"><span class="timeline-marker"></span><div class="timeline-copy"><strong>${escapeHtml(text(item.roles.find((role) => role.id === entry.roleId)?.label) || entry.roleId)} · ${escapeHtml(labelEvent(entry.selectedEvent))}</strong><span>${escapeHtml(entry.status || "ok")}${entry.durationMs ? ` · ${Math.round(entry.durationMs)} ms` : ""}</span></div></div>`).join("");
  $("#run-content").innerHTML = `<section class="run-summary"><div class="run-summary-top"><h3>${escapeHtml(text(item.title))}</h3><span class="run-mode">${escapeHtml(copy[state.locale].simulation)}</span></div><div class="run-metrics"><div><strong>${audit.length}</strong><span>${escapeHtml(copy[state.locale].rolesCompleted)}</span></div><div><strong>${escapeHtml(result.summary?.totalTransitions ?? audit.length)}</strong><span>${escapeHtml(copy[state.locale].transitions)}</span></div><div><strong>${(result.durationMs / 1000).toFixed(1)}s</strong><span>${escapeHtml(copy[state.locale].elapsed)}</span></div></div><h3 class="output-heading">${escapeHtml(outputTitle)}</h3><div class="run-output">${escapeHtml(content || copy[state.locale].noOutput)}</div></section><section class="timeline"><h3>${escapeHtml(copy[state.locale].timeline)}</h3><div class="timeline-list">${timeline}</div></section><p class="run-disclaimer">${escapeHtml(copy[state.locale].footerNote)}</p>`;
  openDrawer();
  if (id) {
    const row = { id, caseId: item.id, prompt, title: text(item.title), durationMs: result.durationMs, status: result.status, createdAt: new Date().toISOString(), result };
    state.history = [row, ...state.history.filter((entry) => entry.id !== id)].slice(0, 12);
    saveHistory();
    renderHistory();
  }
}

async function runSelected() {
  const item = state.cases.find((entry) => entry.id === state.selected);
  const prompt = $("#task-input").value.trim();
  if (!prompt) { $("#task-input").focus(); showToast(copy[state.locale].inputRequired); return; }
  const button = $("#run-button");
  button.disabled = true;
  $("#run-content").innerHTML = `<div class="run-loading"><span class="spinner"></span><span>${escapeHtml(copy[state.locale].running)}</span></div>`;
  openDrawer();
  try {
    const response = await fetch("/api/demo-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: item.id, prompt, locale: state.locale }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || copy[state.locale].networkError);
    if (result.status !== "done") throw new Error(`${copy[state.locale].runFailed}: ${result.status || "unknown"}`);
    openRun(result, item, prompt);
  } catch (error) {
    $("#run-content").innerHTML = `<div class="run-error">${escapeHtml(error.message || copy[state.locale].networkError)}</div>`;
  } finally { button.disabled = false; }
}

function renderHistory() {
  const root = $("#history-list");
  if (!root) return;
  if (!state.history.length) { root.innerHTML = `<div class="history-empty">${escapeHtml(copy[state.locale].noHistory)}</div>`; return; }
  root.innerHTML = state.history.map((entry) => `<article class="history-row"><span class="history-icon">✓</span><div><strong>${escapeHtml(entry.title || entry.caseId)}</strong><p>${escapeHtml(entry.prompt)} · ${new Date(entry.createdAt).toLocaleString(state.locale)}</p></div><button class="text-button" type="button" data-history="${escapeHtml(entry.id)}">${escapeHtml(copy[state.locale].historyRestore)}</button></article>`).join("");
  $$("[data-history]").forEach((button) => button.addEventListener("click", () => {
    const entry = state.history.find((item) => item.id === button.dataset.history);
    const item = state.cases.find((candidate) => candidate.id === entry.caseId);
    if (entry && item) { selectCase(item.id); openRun(entry.result, item, entry.prompt, null); }
  }));
}

function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2300); }

async function init() {
  const response = await fetch("/api/cases");
  if (!response.ok) throw new Error("Unable to load team cases.");
  state.cases = await response.json();
  state.selected = state.cases[0]?.id;
  $$(".nav-item[data-view], [data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $("#locale-toggle").addEventListener("click", () => { state.locale = state.locale === "zh-CN" ? "en" : "zh-CN"; localStorage.setItem("ogs-locale", state.locale); applyLocale(); });
  $("#task-input").addEventListener("input", updateCount);
  $("#run-button").addEventListener("click", runSelected);
  $("#edit-task-button").addEventListener("click", () => { $("#task-input").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("#clear-history").addEventListener("click", () => { state.history = []; saveHistory(); renderHistory(); });
  $$('[data-close-drawer]').forEach((element) => element.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
  selectCase(state.selected);
  applyLocale();
  updateCount();
}

init().catch((error) => { document.body.innerHTML = `<main class="fatal-error">${escapeHtml(error.message)}</main>`; });
