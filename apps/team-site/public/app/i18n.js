import { state } from "./state.js";

export function text(value) {
  return value?.[state.locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
}

export function labelEvent(event, copy) {
  const value = state.eventLabels[event];
  return value ? value[state.locale === "zh-CN" ? 0 : 1] : copy[state.locale].fallbackEvent;
}

export function taskExample(item) {
  const tasks = {
    "software-team": { "zh-CN": "为一款面向自由职业者的记账工具制定首版研发方案，覆盖核心体验、技术拆分与验收标准。", en: "Plan the first release of a bookkeeping tool for independent professionals, covering core experience, engineering, and acceptance criteria." },
    "expert-consultation": { "zh-CN": "梳理一位患者反复头痛且伴短暂视物模糊的资料，列出需要补充的信息与紧急风险信号。", en: "Review a case of recurring headache with brief blurred vision, noting missing information and urgent risk signals." },
    "structured-debate": { "zh-CN": "讨论一家 30 人的公司是否应采用每周三天到办公室的混合办公政策。", en: "Debate whether a 30-person company should adopt a hybrid policy requiring three office days per week." }
  };
  return tasks[item.id]?.[state.locale] || "";
}
