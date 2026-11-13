import { pageFetch } from "../api.js";
import { $, $$, esc, icon } from "../components/dom.js";
import { state } from "../state.js";
import { text } from "../i18n.js";

const landingCopy = {
  "zh-CN": {
    homeCases: "团队协作", homeStudio: "团队工厂", homeEyebrow: "为复杂工作，组织一支 AI 团队",
    homeTitle: "让专业分工，<br>协作交付结果。", homeIntro: "从清晰目标开始，定义职责角色与交接方式；每项责任由配置的执行者承担，共同产出可检查的结果。",
    homePrimary: "在线运行示例", homeProof: "真实运行流程 · 无需注册 · 中英文示例", visualTitle: "专业分工，协作交付", visualStatus: "协作中",
    visualTask: "一个清楚的目标", visualTaskSub: "让团队朝同一个目标推进", visualRoleOne: "工程规划", visualRoleOneSub: "实现与依赖",
    visualRoleTwo: "体验设计", visualRoleTwoSub: "流程与细节", visualRoleThree: "质量把关", visualRoleThreeSub: "验收与风险",
    visualResult: "汇成一份共同成果", visualResultSub: "职责 · 交接 · 下一步", visualFooter: "职责清晰，协作有序，过程可追踪",
    homeCasesEyebrow: "四类常见协作场景", homeCasesTitle: "从典型团队协作开始", homeAllCases: "查看全部协作案例",
    promiseKicker: "面向真实工作", promiseTitle: "过程清楚，交付有据。", promiseOne: "每个职责都有清晰边界", promiseOneBody: "从目标拆解到结果整合，每项责任都在流程中明确。",
    promiseTwo: "工作交接看得见", promiseTwoBody: "随时了解谁在处理、信息如何流转。", promiseThree: "结果可以逐步检查", promiseThreeBody: "回看各方意见、汇总过程和最终输出。",
    homeFooter: "为复杂工作构建协作团队", homeFooterCta: "进入协作项目", openCase: "查看案例详情"
  },
  en: {
    homeCases: "Team collaboration", homeStudio: "Team factory", homeEyebrow: "A team for complex work",
    homeTitle: "Specialized roles<br>working toward one delivery.", homeIntro: "Start with a clear goal. Define responsibility roles and handoffs; configured executors perform each responsibility and produce a reviewable outcome.",
    homePrimary: "Run an example", homeProof: "Real workflow run · No sign-up · English and Chinese", visualTitle: "Specialized roles, one shared delivery", visualStatus: "Working together",
    visualTask: "A clear shared goal", visualTaskSub: "One direction for the whole team", visualRoleOne: "Engineering plan", visualRoleOneSub: "Build and dependencies",
    visualRoleTwo: "Experience design", visualRoleTwoSub: "Flow and details", visualRoleThree: "Quality review", visualRoleThreeSub: "Acceptance and risks",
    visualResult: "One shared outcome", visualResultSub: "Ownership · Handoffs · Next steps", visualFooter: "Clear roles. Coordinated work. Visible progress.",
    homeCasesEyebrow: "Four common collaboration scenarios", homeCasesTitle: "Explore representative team workflows", homeAllCases: "Browse all collaboration examples",
    promiseKicker: "Built for real work", promiseTitle: "Clear process. Reviewable results.", promiseOne: "Every responsibility has a clear boundary", promiseOneBody: "Each responsibility is explicit, from framing the task to assembling the result.",
    promiseTwo: "Handoffs stay visible", promiseTwoBody: "See who is working and how information moves through the team.", promiseThree: "Results are easy to review", promiseThreeBody: "Revisit each view, the synthesis, and the final output.",
    homeFooter: "Teams for complex work", homeFooterCta: "Open the team workspace", openCase: "Explore case details"
  }
};

const themeStorageKey = "ogs.visualizer.theme";
let started = false;

function copy() {
  return landingCopy[state.locale] || landingCopy["zh-CN"];
}

function applyTheme(theme, persist = true) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.visualizerTheme = next;
  if (persist) try { localStorage.setItem(themeStorageKey, next); } catch {}
  const labels = state.locale === "en" ? { light: "Light mode", dark: "Dark mode" } : { light: "浅色模式", dark: "深色模式" };
  $("#landing-locale")?.setAttribute("aria-label", state.locale === "en" ? "Switch language" : "切换语言");
  $$("[data-site-theme-choice]").forEach((button) => {
    const active = button.dataset.siteThemeChoice === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", labels[button.dataset.siteThemeChoice] || button.dataset.siteThemeChoice);
    button.setAttribute("title", labels[button.dataset.siteThemeChoice] || button.dataset.siteThemeChoice);
  });
}

function applyLocale() {
  const values = copy();
  document.documentElement.lang = state.locale;
  $$('[data-i18n]').forEach((element) => {
    const value = values[element.dataset.i18n];
    if (value) element.innerHTML = value;
  });
  $("#landing-locale")?.replaceChildren(document.createTextNode(state.locale === "zh-CN" ? "EN" : "中文"));
  applyTheme(document.documentElement.dataset.visualizerTheme || "light", false);
}

function caseIcon(item) {
  return `<span class="case-icon case-icon-${esc(item.icon)}" aria-hidden="true">${icon[item.icon] || "✦"}</span>`;
}

function caseCatalogMarkup(item, values) {
  const catalog = item.catalog || {};
  return `<div class="case-card-labels"><span class="case-card-category">${esc(text(item.category))}</span><span class="case-tier-chip">${esc(text(catalog.tier) || values.defaultTier)}</span></div>`;
}

function renderCases() {
  const values = copy();
  const grid = $("#landing-case-grid");
  if (!grid) return;
  grid.innerHTML = state.cases.map((item) => `<article class="landing-case-card" data-accent="${esc(item.accent)}"><a class="case-card-link" href="/cases/${esc(item.id)}" data-route="/cases/${esc(item.id)}">${caseIcon(item)}${caseCatalogMarkup(item, { defaultTier: state.locale === "en" ? "Template" : "模板", delivery: state.locale === "en" ? "Delivery" : "交付" })}<h3>${esc(text(item.title))}</h3><p class="case-fit">${esc(text(item.catalog?.fit) || text(item.short))}</p><div class="case-card-meta"><span>${esc(state.locale === "en" ? "Delivery" : "交付")}</span><strong>${esc(text(item.catalog?.delivery))}</strong></div><div class="case-mini-graph" aria-hidden="true"><span></span><i></i><i></i><i></i><b></b></div><span class="case-more">${esc(values.openCase)}</span></a></article>`).join("");
}

function navigateFromLanding(event) {
  const link = event.target.closest("a[data-route]");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || link.target === "_blank") return;
  event.preventDefault();
  window.location.assign(href);
}

export async function bootstrapLanding() {
  if (started) return;
  started = true;
  $("#landing-view")?.classList.remove("hidden");
  $("#app-shell")?.classList.add("hidden");
  let savedTheme = "light";
  try { savedTheme = localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light"; } catch {}
  applyTheme(savedTheme, false);
  applyLocale();
  $("#landing-locale")?.addEventListener("click", () => {
    state.locale = state.locale === "zh-CN" ? "en" : "zh-CN";
    try { localStorage.setItem("ogs-locale", state.locale); } catch {}
    applyLocale();
    renderCases();
  });
  $$('[data-site-theme-choice]').forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.siteThemeChoice)));
  $("#landing-view")?.addEventListener("click", navigateFromLanding);
  const response = await pageFetch("/api/v1/cases");
  if (!response.ok) throw new Error("Unable to load team cases.");
  const payload = await response.json();
  state.cases = payload.cases || [];
  state.eventLabels = payload.eventLabels || {};
  renderCases();
}
