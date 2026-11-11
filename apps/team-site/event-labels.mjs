import { BUSINESS_EVENT_TYPES, RUNTIME_AUDIT_EVENT_TYPES } from "../../dist/business-events.js";

const businessEventLabels = {
  READY: ["就绪", "Result ready"],
  APPROVED: ["通过", "Approved"],
  REJECTED: ["拒绝", "Rejected"],
  NEEDS_REWORK: ["需要返工", "Needs rework"],
  BLOCKED: ["业务阻塞", "Business blocked"]
};

export const eventLabels = {
  START: ["任务分发", "Task dispatch"],
  loop_exhausted: ["循环预算耗尽", "Loop budget exhausted"],
  human_review_rejected: ["审核拒绝并路由", "Review rejected and routed"],
  human_review_decision_rejected: ["审核决定被拒绝", "Review decision rejected"],
  ...Object.fromEntries(BUSINESS_EVENT_TYPES.map((eventType) => [eventType, businessEventLabels[eventType]]) )
};

for (const eventType of RUNTIME_AUDIT_EVENT_TYPES) {
  if (!eventLabels[eventType]) throw new Error(`Missing Team Site label for runtime audit event ${eventType}`);
}

export function localizedEventLabel(eventType, locale = "zh-CN") {
  const labels = eventLabels[eventType];
  return labels ? labels[locale === "zh-CN" ? 0 : 1] : locale === "zh-CN" ? "工作已更新" : "Work updated";
}
