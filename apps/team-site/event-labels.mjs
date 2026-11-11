import { BUSINESS_EVENT_TYPES, RUNTIME_AUDIT_EVENT_TYPES } from "../../dist/business-events.js";

const businessEventLabels = {
  READY: ["准备好了", "Result ready"],
  APPROVED: ["同意", "Approved"],
  REJECTED: ["不同意", "Rejected"],
  NEEDS_REWORK: ["请再改改", "Needs rework"],
  BLOCKED: ["办不了", "Business blocked"]
};

export const eventLabels = {
  START: ["任务分发", "Task dispatch"],
  loop_exhausted: ["循环预算耗尽", "Loop budget exhausted"],
  human_review_rejected: ["审核不同意并转交", "Review rejected and routed"],
  human_review_decision_rejected: ["审核决定不同意", "Review decision rejected"],
  ...Object.fromEntries(BUSINESS_EVENT_TYPES.map((eventType) => [eventType, businessEventLabels[eventType]]) )
};

for (const eventType of RUNTIME_AUDIT_EVENT_TYPES) {
  if (!eventLabels[eventType]) throw new Error(`Missing Team Site label for runtime audit event ${eventType}`);
}

export function localizedEventLabel(eventType, locale = "zh-CN") {
  const labels = eventLabels[eventType];
  return labels ? labels[locale === "zh-CN" ? 0 : 1] : locale === "zh-CN" ? "工作已更新" : "Work updated";
}
