export const eventLabels = {
  SOFTWARE_REQUEST: ["研发需求", "Product request"],
  PLAN_BACKEND: ["规划工程实现", "Plan engineering"],
  PLAN_EXPERIENCE: ["规划使用体验", "Plan user experience"],
  PLAN_QUALITY: ["规划质量检查", "Plan quality checks"],
  BACKEND_PLAN_READY: ["工程方案已提交", "Engineering plan shared"],
  EXPERIENCE_PLAN_READY: ["体验方案已提交", "Experience plan shared"],
  QUALITY_PLAN_READY: ["质量方案已提交", "Quality plan shared"],
  DELIVERY_READY: ["研发方案已汇总", "Delivery plan assembled"],
  CASE_RECEIVED: ["收到会诊资料", "Case brief received"],
  START_CARDIOLOGY: ["请心血管专科评估", "Request cardiology review"],
  START_NEUROLOGY: ["请神经专科评估", "Request neurology review"],
  START_IMAGING: ["请影像专科评估", "Request imaging review"],
  CARDIOLOGY_REVIEW_READY: ["心血管意见已提交", "Cardiology view shared"],
  NEUROLOGY_REVIEW_READY: ["神经专科意见已提交", "Neurology view shared"],
  IMAGING_REVIEW_READY: ["影像意见已提交", "Imaging view shared"],
  CONSULTATION_READY: ["会诊意见已汇总", "Consultation views assembled"],
  DEBATE_TOPIC: ["讨论议题", "Debate topic"],
  ISSUE_TO_PRO: ["交由支持方陈述", "Invite the proposition"],
  ISSUE_TO_CON: ["交由反对方陈述", "Invite the opposition"],
  PRO_ARGUMENT_READY: ["支持方观点已提交", "Proposition shared its case"],
  CON_ARGUMENT_READY: ["反对方观点已提交", "Opposition shared its case"],
  REBUTTAL_REQUESTED: ["请双方补充回应", "Request a rebuttal"],
  DECISION_READY: ["评议已完成", "Review completed"],
  DEBATE_SUMMARY_READY: ["讨论纪要已整理", "Debate brief prepared"]
};

export function localizedEventLabel(eventType, locale = "zh-CN") {
  const labels = eventLabels[eventType];
  return labels ? labels[locale === "zh-CN" ? 0 : 1] : locale === "zh-CN" ? "工作已更新" : "Work updated";
}
