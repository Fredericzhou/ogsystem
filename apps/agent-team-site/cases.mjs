export const cases = [
  {
    id: "software-team",
    title: { "zh-CN": "软件研发团队", en: "Software delivery team" },
    short: {
      "zh-CN": "把需求拆成工程、体验和质量工作流，再由负责人整合交付。",
      en: "Turn a product request into engineering, experience, and quality workstreams, then bring them together for delivery."
    },
    category: { "zh-CN": "产品研发", en: "Product development" },
    duration: { "zh-CN": "5 个角色", en: "5 roles" },
    icon: "code",
    detail: {
      scenario: { "zh-CN": "为自由职业者记账工具规划首版：覆盖账目记录、月度汇总，并列出上线前的验收项。", en: "Plan the first release of a bookkeeping tool for independent professionals, including expense entry, monthly summaries, and launch checks." },
      relationship: { "zh-CN": "产品负责人先明确目标；工程、体验和质量三方分别拆解；交付负责人收齐三份方案后统一排期与验收。", en: "The product lead frames the goal. Engineering, experience, and quality plan in parallel; the delivery lead combines all three into one sequence and acceptance plan." },
      background: { "zh-CN": "一项产品需求通常同时牵涉工程实现、用户体验和质量保障。由单一角色从头包办，容易遗漏接口依赖或验收条件。", en: "A product request often spans engineering, user experience, and quality. A single owner can miss interface dependencies or acceptance criteria." },
      problem: { "zh-CN": "适合把目标明确、但需要多专业共同拆解的产品功能，整理成可评审的首版交付方案。", en: "Use this team when a clear product goal needs several disciplines to shape a reviewable first delivery plan." },
      collaboration: { "zh-CN": "产品负责人先统一目标和限制；后端、体验、质量成员分别准备方案；交付负责人收齐三方结果，明确依赖、顺序和完成标准。", en: "The product lead aligns on goals and constraints. Engineering, experience, and quality prepare separate plans; a delivery lead combines them with dependencies, sequencing, and a definition of done." },
      deliverable: { "zh-CN": "一份包含实现拆分、关键体验、验收检查、风险和待确认问题的研发建议。", en: "A delivery proposal covering implementation slices, key experience, acceptance checks, risks, and open questions." },
      roles: {
        "delivery-coordinator": { "zh-CN": "归纳用户目标、约束与验收重点。", en: "Aligns the user outcome, constraints, and acceptance priorities." },
        "backend-planner": { "zh-CN": "规划服务端职责、接口和数据处理。", en: "Plans backend responsibilities, interfaces, and data handling." },
        "experience-planner": { "zh-CN": "梳理主要操作路径、界面状态与无障碍要求。", en: "Maps the main user flow, interface states, and accessibility needs." },
        "quality-planner": { "zh-CN": "提出高价值验收检查、边界情况与发布风险。", en: "Defines useful acceptance checks, edge cases, and release risks." },
        "delivery-lead": { "zh-CN": "整合专业方案，标出依赖、顺序和完成条件。", en: "Combines the plans and identifies dependencies, order, and completion criteria." }
      }
    },
    accent: "mint",
    layout: {
      "delivery-coordinator": [80, 145],
      "backend-planner": [360, 48],
      "experience-planner": [360, 145],
      "quality-planner": [360, 242],
      "delivery-lead": [690, 145]
    },
    semantics: ["parallel_split", "all_of", "context.map"],
    entryRole: "delivery-coordinator",
    joins: [{ roleId: "delivery-lead", mode: "all_of", sources: ["backend-planner", "experience-planner", "quality-planner"] }],
    projections: [
      ["delivery-lead", "backend_plan", "source(backend-planner).content"],
      ["delivery-lead", "experience_plan", "source(experience-planner).content"],
      ["delivery-lead", "quality_plan", "source(quality-planner).content"],
      ["delivery-lead", "task", "global.task"]
    ],
    roles: [
      {
        id: "delivery-coordinator", label: { "zh-CN": "产品负责人", en: "Product lead" },
        purpose: "Turn the user's software request into a shared engineering brief.", events: ["PLAN_BACKEND", "PLAN_EXPERIENCE", "PLAN_QUALITY"], mode: "parallel_split",
        prompt: "Read the product request. Prepare one concise shared brief for a backend planner, an experience planner, and a quality planner. Name the core user outcome, constraints, and acceptance criteria. Return valid JSON with content and one allowed event."
      },
      {
        id: "backend-planner", label: { "zh-CN": "后端工程师", en: "Backend engineer" },
        purpose: "Plan the backend responsibilities and interfaces for a software feature.", events: ["BACKEND_PLAN_READY"],
        prompt: "Act as the backend engineer. Propose a practical implementation plan, key interfaces, data handling, and risks for the requested software feature. Return valid JSON with event BACKEND_PLAN_READY and a useful content summary."
      },
      {
        id: "experience-planner", label: { "zh-CN": "体验设计师", en: "Experience designer" },
        purpose: "Plan a clear and accessible user experience for a software feature.", events: ["EXPERIENCE_PLAN_READY"],
        prompt: "Act as the experience designer. Describe the primary user flow, important states, accessibility considerations, and the smallest useful interface for this request. Return valid JSON with event EXPERIENCE_PLAN_READY and a useful content summary."
      },
      {
        id: "quality-planner", label: { "zh-CN": "质量工程师", en: "Quality engineer" },
        purpose: "Define verifiable acceptance and testing coverage for a software feature.", events: ["QUALITY_PLAN_READY"],
        prompt: "Act as the quality engineer. Define the highest-value acceptance checks, edge cases, and release risks for this request. Return valid JSON with event QUALITY_PLAN_READY and a useful content summary."
      },
      {
        id: "delivery-lead", label: { "zh-CN": "交付负责人", en: "Delivery lead" },
        purpose: "Integrate engineering, experience, and quality plans into one delivery proposal.", events: ["DELIVERY_READY"],
        prompt: "Integrate the three supplied workstream plans into a concise delivery proposal. Identify dependencies, sequencing, open questions, and a definition of done. Do not invent implementation results. Return valid JSON with event DELIVERY_READY and the integrated proposal as content."
      }
    ],
    flows: [
      ["input", "delivery-coordinator", "SOFTWARE_REQUEST"],
      ["delivery-coordinator", "backend-planner", "PLAN_BACKEND"],
      ["delivery-coordinator", "experience-planner", "PLAN_EXPERIENCE"],
      ["delivery-coordinator", "quality-planner", "PLAN_QUALITY"],
      ["backend-planner", "delivery-lead", "BACKEND_PLAN_READY"],
      ["experience-planner", "delivery-lead", "EXPERIENCE_PLAN_READY"],
      ["quality-planner", "delivery-lead", "QUALITY_PLAN_READY"],
      ["delivery-lead", "output", "DELIVERY_READY"]
    ]
  },
  {
    id: "expert-consultation",
    title: { "zh-CN": "多学科专家会诊", en: "Expert consultation" },
    short: {
      "zh-CN": "让不同专科独立分析，由主审汇总已收到的意见与待确认的问题。",
      en: "Gather independent specialist views, then let a lead reviewer summarize the available perspectives and open questions."
    },
    category: { "zh-CN": "专业咨询", en: "Expert consultation" },
    duration: { "zh-CN": "5 个角色", en: "5 roles" },
    icon: "medical",
    detail: {
      scenario: { "zh-CN": "个案资料：患者反复头痛并伴短暂视物模糊。请梳理风险信号、待补充资料与合理的后续问题。", en: "Case brief: recurring headaches with brief blurred vision. Identify risk signals, missing information, and useful follow-up questions." },
      relationship: { "zh-CN": "同一份资料交给三位专科独立评估；主审至少收到两份意见后综合，并标出分歧和需升级关注的信号。", en: "Three specialists review the same brief independently. The lead reviewer synthesizes once at least two reviews arrive, noting disagreement and urgent signals." },
      background: { "zh-CN": "复杂个案往往需要从不同专科视角核对线索。先独立分析，再由主审归纳，有助于看见共识、分歧和资料缺口。", en: "Complex cases can benefit from separate specialist perspectives. Independent reviews followed by synthesis make agreement, disagreement, and missing information visible." },
      problem: { "zh-CN": "适合信息尚不完整、需要多学科辅助梳理风险与后续问题的讨论。此示例用于辅助决策，不构成诊断或治疗建议。", en: "Use this team to organize risks and follow-up questions when information is incomplete. This example supports decision making and does not provide a diagnosis or treatment advice." },
      collaboration: { "zh-CN": "协调员向心血管、神经和影像专科提供同一份资料；各专科独立列出观察、疑点和需要补充的证据；主审归纳已收到的意见，并指出紧急信号与不确定性。", en: "A coordinator gives cardiology, neurology, and imaging the same brief. Each specialist independently records observations, concerns, and needed evidence; a lead reviewer synthesizes the available views, urgent signals, and uncertainty." },
      deliverable: { "zh-CN": "一份谨慎的会诊摘要，区分观察与假设，列出共识、分歧、风险信号和建议补充的信息。", en: "A cautious consultation summary that separates observations from hypotheses and lists agreement, disagreement, risk signals, and information to gather." },
      roles: {
        "consultation-dispatcher": { "zh-CN": "整理中立、简明的共同资料摘要。", en: "Prepares a concise, neutral shared case brief." },
        "cardiology-expert": { "zh-CN": "从心血管角度梳理线索、风险与补充证据。", en: "Reviews cardiovascular clues, risks, and evidence needs." },
        "neurology-expert": { "zh-CN": "从神经系统角度梳理线索、风险与补充证据。", en: "Reviews neurological clues, risks, and evidence needs." },
        "imaging-expert": { "zh-CN": "核对影像证据能支持什么，以及还缺少什么。", en: "Clarifies what imaging supports and what evidence is missing." },
        "chief-reviewer": { "zh-CN": "归纳专科意见、分歧、不确定性及后续问题。", en: "Synthesizes specialist views, disagreements, uncertainty, and follow-up questions." }
      }
    },
    accent: "coral",
    layout: {
      "consultation-dispatcher": [80, 145],
      "cardiology-expert": [360, 48],
      "neurology-expert": [360, 145],
      "imaging-expert": [360, 242],
      "chief-reviewer": [690, 145]
    },
    semantics: ["parallel_split", "quorum_of", "join timeout"],
    entryRole: "consultation-dispatcher",
    joins: [{ roleId: "chief-reviewer", mode: "quorum_of", sources: ["cardiology-expert", "neurology-expert", "imaging-expert"], min: 2 }],
    projections: [],
    roles: [
      {
        id: "consultation-dispatcher", label: { "zh-CN": "会诊协调员", en: "Consultation coordinator" },
        purpose: "Package the consultation question and start the specialist review.", events: ["START_CARDIOLOGY", "START_NEUROLOGY", "START_IMAGING"], mode: "parallel_split",
        prompt: "Prepare a neutral, concise case brief for the specialists. State uncertainty clearly and ask each specialist to return observations, supporting signals, risks, and follow-up questions. Return valid JSON with content and one allowed event."
      },
      {
        id: "cardiology-expert", label: { "zh-CN": "心血管专家", en: "Cardiology specialist" },
        purpose: "Review the case from a cardiovascular perspective.", events: ["CARDIOLOGY_REVIEW_READY"],
        prompt: "Review the provided case from a cardiovascular perspective. Separate observations from hypotheses, identify urgent red flags, and list what additional evidence would change your assessment. Do not make a definitive diagnosis. Return valid JSON with event CARDIOLOGY_REVIEW_READY and your analysis as content."
      },
      {
        id: "neurology-expert", label: { "zh-CN": "神经科专家", en: "Neurology specialist" },
        purpose: "Review the case from a neurological perspective.", events: ["NEUROLOGY_REVIEW_READY"],
        prompt: "Review the provided case from a neurological perspective. Separate observations from hypotheses, identify urgent red flags, and list what additional evidence would change your assessment. Do not make a definitive diagnosis. Return valid JSON with event NEUROLOGY_REVIEW_READY and your analysis as content."
      },
      {
        id: "imaging-expert", label: { "zh-CN": "影像专家", en: "Imaging specialist" },
        purpose: "Review imaging and evidence needs for the consultation.", events: ["IMAGING_REVIEW_READY"],
        prompt: "Review the provided case from an imaging and evidence perspective. State which findings are supported, what cannot be concluded, and which follow-up study or evidence would be useful. Do not fabricate imaging results. Return valid JSON with event IMAGING_REVIEW_READY and your analysis as content."
      },
      {
        id: "chief-reviewer", label: { "zh-CN": "主审专家", en: "Lead reviewer" },
        purpose: "Synthesize available specialist reviews into a cautious consultation summary.", events: ["CONSULTATION_READY"],
        prompt: "Synthesize the specialist reviews that are available. Note agreement, disagreement, uncertainty, urgent escalation signals, and reasonable next steps. Do not claim that absent specialists agreed. This is decision support, not a diagnosis. Return valid JSON with event CONSULTATION_READY and the synthesis as content."
      }
    ],
    flows: [
      ["input", "consultation-dispatcher", "CASE_RECEIVED"],
      ["consultation-dispatcher", "cardiology-expert", "START_CARDIOLOGY"],
      ["consultation-dispatcher", "neurology-expert", "START_NEUROLOGY"],
      ["consultation-dispatcher", "imaging-expert", "START_IMAGING"],
      ["cardiology-expert", "chief-reviewer", "CARDIOLOGY_REVIEW_READY"],
      ["neurology-expert", "chief-reviewer", "NEUROLOGY_REVIEW_READY"],
      ["imaging-expert", "chief-reviewer", "IMAGING_REVIEW_READY"],
      ["chief-reviewer", "output", "CONSULTATION_READY"]
    ]
  },
  {
    id: "structured-debate",
    title: { "zh-CN": "正反方团队辩论", en: "Structured team debate" },
    short: {
      "zh-CN": "正反方围绕同一议题交锋，由中立裁判审阅双方论据并限轮裁决。",
      en: "Two sides argue from a shared brief while a neutral judge reviews both and closes within a bounded number of rounds."
    },
    category: { "zh-CN": "观点讨论", en: "Deliberation" },
    duration: { "zh-CN": "5 个角色", en: "5 roles" },
    icon: "scales",
    detail: {
      scenario: { "zh-CN": "讨论议题：一家 30 人的公司，是否应要求员工每周到办公室三天？", en: "Debate topic: should a 30-person company ask employees to work from the office three days each week?" },
      relationship: { "zh-CN": "主持人把同一议题交给正反双方；裁判比较双方论据，可要求补充回应，再将评议交给记录员整理。", en: "The host gives both sides the same question. A neutral judge compares their arguments, may request a rebuttal, then hands the review to a reporter." },
      background: { "zh-CN": "面对影响团队的选择，支持与反对意见都需要被充分表达。让双方围绕同一问题和标准交锋，再交由中立角色评议，可以减少只听到单一立场的风险。", en: "Team decisions deserve a fair account of both support and opposition. Giving each side the same question and criteria before neutral review reduces the risk of hearing only one position." },
      problem: { "zh-CN": "适合比较政策、产品方向或资源投入等存在真实取舍的问题。它帮助团队澄清依据，不替代负责人作出决定。", en: "Use this team to compare policies, product directions, or investments with real trade-offs. It clarifies the reasoning while leaving the decision to the responsible people." },
      collaboration: { "zh-CN": "主持人给双方相同的辩题和评议标准；正反方分别陈述理由并回应对方；中立评议者判断是否需要一轮补充质询，随后作出有依据的评议；记录员整理双方强点、结论与未决问题。", en: "A host gives both sides the same question and criteria. The proposition and opposition make their cases and respond to one another. A neutral reviewer may request one bounded rebuttal before reaching a reasoned view; a reporter records the strongest points and open questions." },
      deliverable: { "zh-CN": "一份平衡的讨论纪要，呈现双方最有力的论据、评议理由、不确定因素和后续决策问题。", en: "A balanced debate brief with each side's strongest case, the reviewer's reasoning, uncertainty, and questions for the decision makers." },
      roles: {
        "debate-host": { "zh-CN": "明确辩题、评议标准，并把相同资料交给双方。", en: "Frames the question and criteria, then gives both sides the same brief." },
        "proponent": { "zh-CN": "提出支持方案的理由、依据与成立条件。", en: "Builds the case for the proposal, its rationale, and conditions." },
        "opponent": { "zh-CN": "指出方案的假设、代价、风险与替代思路。", en: "Challenges assumptions and explains costs, risks, and alternatives." },
        "neutral-judge": { "zh-CN": "按共同标准比较双方论据，说明评议依据与不确定性。", en: "Compares both cases against shared criteria and explains its reasoning and uncertainty." },
        "debate-reporter": { "zh-CN": "整理双方强点、评议结论和仍待回答的问题。", en: "Records each side's strongest points, the review, and unanswered questions." }
      }
    },
    accent: "blue",
    layout: {
      "debate-host": [90, 155],
      proponent: [360, 55],
      opponent: [360, 250],
      "neutral-judge": [640, 155],
      "debate-reporter": [900, 155]
    },
    semantics: ["parallel_split", "all_of", "loop.max"],
    entryRole: "debate-host",
    joins: [{ roleId: "neutral-judge", mode: "all_of", sources: ["proponent", "opponent"] }],
    loopBudgets: [{ roleId: "debate-host", max: 3 }],
    projections: [
      ["neutral-judge", "pro_argument", "source(proponent).content"],
      ["neutral-judge", "con_argument", "source(opponent).content"],
      ["neutral-judge", "topic", "global.task"]
    ],
    roles: [
      {
        id: "debate-host", label: { "zh-CN": "辩论主持人", en: "Debate host" },
        purpose: "Frame the topic and distribute the same debate brief to both sides.", events: ["ISSUE_TO_PRO", "ISSUE_TO_CON"], mode: "parallel_split",
        prompt: "Frame a balanced debate brief with the exact question, decision criteria, and current round. Give both sides the same brief. Return valid JSON with content and one allowed event."
      },
      {
        id: "proponent", label: { "zh-CN": "正方", en: "Proposition" },
        purpose: "Build the strongest evidence-based case in favor of the proposal.", events: ["PRO_ARGUMENT_READY"],
        prompt: "Argue in favor of the proposal. Make a clear claim, use the strongest available reasons, address the opponent's prior points if present, and name a condition that could change your position. Do not fabricate evidence. Return valid JSON with event PRO_ARGUMENT_READY and your argument as content."
      },
      {
        id: "opponent", label: { "zh-CN": "反方", en: "Opposition" },
        purpose: "Build the strongest evidence-based case against the proposal.", events: ["CON_ARGUMENT_READY"],
        prompt: "Argue against the proposal. Challenge assumptions, identify trade-offs and risks, address the proposition's prior points if present, and name a condition that could change your position. Do not fabricate evidence. Return valid JSON with event CON_ARGUMENT_READY and your argument as content."
      },
      {
        id: "neutral-judge", label: { "zh-CN": "中立裁判", en: "Neutral judge" },
        purpose: "Evaluate both arguments against shared criteria and decide whether one bounded rebuttal is needed.", events: ["REBUTTAL_REQUESTED", "DECISION_READY"],
        prompt: "Evaluate both sides fairly against the stated criteria. On round 1, request one rebuttal only when a material unresolved issue remains; otherwise decide. On round 2, always issue a decision. Explain the strongest point on each side, uncertainty, and the reason for your decision. Return valid JSON with event REBUTTAL_REQUESTED or DECISION_READY and your reasoning as content."
      },
      {
        id: "debate-reporter", label: { "zh-CN": "辩论记录员", en: "Debate reporter" },
        purpose: "Present the judge's final decision and the strongest reasoning from both sides.", events: ["DEBATE_SUMMARY_READY"],
        prompt: "Prepare a balanced final report from the judge's decision. Include the decision, strongest argument for each side, key uncertainty, and follow-up question. Do not introduce new evidence. Return valid JSON with event DEBATE_SUMMARY_READY and the report as content."
      }
    ],
    flows: [
      ["input", "debate-host", "DEBATE_TOPIC"],
      ["debate-host", "proponent", "ISSUE_TO_PRO"],
      ["debate-host", "opponent", "ISSUE_TO_CON"],
      ["proponent", "neutral-judge", "PRO_ARGUMENT_READY"],
      ["opponent", "neutral-judge", "CON_ARGUMENT_READY"],
      ["neutral-judge", "debate-host", "REBUTTAL_REQUESTED"],
      ["neutral-judge", "debate-reporter", "DECISION_READY"],
      ["debate-reporter", "output", "DEBATE_SUMMARY_READY"]
    ]
  }
];

export function getCase(caseId) {
  return cases.find((item) => item.id === caseId);
}

export function localized(value, locale = "zh-CN") {
  return value?.[locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
}
