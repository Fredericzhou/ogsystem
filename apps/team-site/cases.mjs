export const cases = [
  {
    id: "software-team",
    title: { "zh-CN": "软件研发", en: "Software delivery" },
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
        prompt: "Integrate the three supplied workstream plans into a concise delivery proposal. Identify dependencies, sequencing, open questions, and a definition of done. Do not invent implementation results. Set content to a JSON object with keys summary, implementationSlices, dependencies, acceptanceChecks, risks, and openQuestions. Return valid JSON with event DELIVERY_READY and that JSON object serialized as the content string. Do not wrap the content in Markdown."
      }
    ],
    flows: [
      ["__system_start__", "delivery-coordinator", "START"],
      ["delivery-coordinator", "backend-planner", "PLAN_BACKEND"],
      ["delivery-coordinator", "experience-planner", "PLAN_EXPERIENCE"],
      ["delivery-coordinator", "quality-planner", "PLAN_QUALITY"],
      ["backend-planner", "delivery-lead", "BACKEND_PLAN_READY"],
      ["experience-planner", "delivery-lead", "EXPERIENCE_PLAN_READY"],
      ["quality-planner", "delivery-lead", "QUALITY_PLAN_READY"],
      ["delivery-lead", "__system_end__", "DELIVERY_READY"]
    ]
  },
  {
    id: "expert-consultation",
    title: { "zh-CN": "专家会诊", en: "Expert consultation" },
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
        prompt: "Synthesize the specialist reviews that are available. Note agreement, disagreement, uncertainty, urgent escalation signals, and reasonable next steps. Do not claim that absent specialists agreed. This is decision support, not a diagnosis. Set content to a JSON object with keys summary, riskSignals, missingInformation, nextSteps, and uncertainty. Return valid JSON with event CONSULTATION_READY and that JSON object serialized as the content string. Do not wrap the content in Markdown."
      }
    ],
    flows: [
      ["__system_start__", "consultation-dispatcher", "START"],
      ["consultation-dispatcher", "cardiology-expert", "START_CARDIOLOGY"],
      ["consultation-dispatcher", "neurology-expert", "START_NEUROLOGY"],
      ["consultation-dispatcher", "imaging-expert", "START_IMAGING"],
      ["cardiology-expert", "chief-reviewer", "CARDIOLOGY_REVIEW_READY"],
      ["neurology-expert", "chief-reviewer", "NEUROLOGY_REVIEW_READY"],
      ["imaging-expert", "chief-reviewer", "IMAGING_REVIEW_READY"],
      ["chief-reviewer", "__system_end__", "CONSULTATION_READY"]
    ]
  },
  {
    id: "structured-debate",
    title: { "zh-CN": "正反方辩论", en: "Structured debate" },
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
    joins: [{ roleId: "neutral-judge", mode: "all_of", sources: ["proponent", "opponent"] }],
    loopBudgets: [{ roleId: "debate-host", max: 2 }],
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
        prompt: "Evaluate both sides fairly against the stated criteria. You may request at most one rebuttal, and only when a material issue could change the decision. Use the Runtime execution context: on loop_iteration 1 this is the initial review; when loop_iteration is greater than 1, always issue DECISION_READY and never request another round. If an issue remains unresolved, state it as uncertainty. Explain each side's strongest point and your reasoning. Return valid JSON with event REBUTTAL_REQUESTED or DECISION_READY and your reasoning as content."
      },
      {
        id: "debate-reporter", label: { "zh-CN": "辩论记录员", en: "Debate reporter" },
        purpose: "Present the judge's final decision and the strongest reasoning from both sides.", events: ["DEBATE_SUMMARY_READY"],
        prompt: "Prepare a balanced final report from the judge's decision. Include the decision, strongest argument for each side, key uncertainty, and follow-up question. Do not introduce new evidence. Set content to a JSON object with keys decision (string), propositionCase (object with strongestPoint and reasoning strings), oppositionCase (object with strongestPoint and reasoning strings), judgeReasoning (string), uncertainty (array of strings), and followUpQuestions (array of strings). Return valid JSON with event DEBATE_SUMMARY_READY and that JSON object serialized as the content string. Do not wrap the content in Markdown."
      }
    ],
    flows: [
      ["__system_start__", "debate-host", "START"],
      ["debate-host", "proponent", "ISSUE_TO_PRO"],
      ["debate-host", "opponent", "ISSUE_TO_CON"],
      ["proponent", "neutral-judge", "PRO_ARGUMENT_READY"],
      ["opponent", "neutral-judge", "CON_ARGUMENT_READY"],
      ["neutral-judge", "debate-host", "REBUTTAL_REQUESTED"],
      ["neutral-judge", "debate-reporter", "DECISION_READY"],
      ["debate-reporter", "__system_end__", "DEBATE_SUMMARY_READY"]
    ]
  },
  {
    id: "a2a-intake",
    title: { "zh-CN": "远程补件受理", en: "Remote intake" },
    short: { "zh-CN": "由远程 A2A 服务检查请求；信息不足时暂停并等待补件。", en: "A remote A2A service reviews a request and pauses for missing information." },
    category: { "zh-CN": "远程协作", en: "Remote collaboration" },
    duration: { "zh-CN": "1 个角色", en: "1 role" },
    icon: "message",
    accent: "blue",
    detail: {
      scenario: { "zh-CN": "检查一份外部提交的服务接入申请，缺少必要信息时向申请人补问。", en: "Review an external service onboarding request and ask for missing details." },
      background: { "zh-CN": "远程 Agent 可能要求补充信息；这不是普通失败，也不能假装任务已经完成。", en: "A remote Agent can request more information; that is not a normal failure or a completed task." },
      problem: { "zh-CN": "需要保留远程任务身份与请求内容，并明确禁止原 Run 续接。", en: "Preserve the remote task identity and requested fields, while requiring a new Run after clarification." },
      collaboration: { "zh-CN": "请求发送到固定 Agent Card；Runtime 持久化待补件状态，收到补充信息后由用户创建新 Run。", en: "Send the request to a pinned Agent Card, persist the input-required state, then start a new Run after clarification." },
      deliverable: { "zh-CN": "受理结论、所需补充字段和远程任务状态。", en: "An intake decision, requested fields, and remote task state." },
      roles: { "remote-intake": { "zh-CN": "远程受理 Agent，检查申请并提出补件要求。", en: "Remote intake Agent that reviews the request and asks for missing details." } }
    },
    roles: [{ id: "remote-intake", label: { "zh-CN": "远程受理 Agent", en: "Remote intake Agent" }, description: "A2A" }]
  },
  {
    id: "artifact-evidence",
    title: { "zh-CN": "证据材料交付", en: "Artifact evidence delivery" },
    short: { "zh-CN": "分析与编辑角色通过声明的 Artifact 槽传递大文件证据。", en: "Analyst and editor roles exchange large evidence through declared Artifact slots." },
    category: { "zh-CN": "资料分析", en: "Evidence analysis" },
    duration: { "zh-CN": "2 个角色", en: "2 roles" },
    icon: "file",
    accent: "mint",
    detail: {
      scenario: { "zh-CN": "分析一组合同与访谈材料，产出附带原始证据的审阅报告。", en: "Analyze contracts and interviews and deliver a review with its source evidence." },
      background: { "zh-CN": "大型材料不应复制进普通 JSON 映射；Artifact 引用须按声明槽位授权。", en: "Large materials should not be copied into ordinary JSON mappings; Artifact references need declared slot authorization." },
      problem: { "zh-CN": "保证材料在绑定、Run 和结果之间按槽位传递，并可核查其摘要。", en: "Carry materials through bindings, Runs, and results by slot, with verifiable digests." },
      collaboration: { "zh-CN": "分析员登记证据包，编辑员只读取授权槽并生成报告与证据索引。", en: "An analyst registers an evidence bundle; an editor reads only declared slots and creates a report and index." },
      deliverable: { "zh-CN": "审阅报告、Artifact 引用及其摘要。", en: "A review report, Artifact references, and their digests." },
      roles: {
        "evidence-analyst": { "zh-CN": "整理原始材料并登记证据 Artifact。", en: "Organizes source materials and registers evidence Artifacts." },
        "evidence-editor": { "zh-CN": "读取声明槽位并生成带引用的审阅报告。", en: "Reads declared slots and produces a cited review." }
      }
    },
    roles: [
      { id: "evidence-analyst", label: { "zh-CN": "证据分析员", en: "Evidence analyst" }, description: "Registers source evidence." },
      { id: "evidence-editor", label: { "zh-CN": "报告编辑", en: "Report editor" }, description: "Produces a cited report." }
    ]
  },
  {
    id: "conditional-signoff",
    title: { "zh-CN": "条件会签", en: "Conditional sign-off" },
    short: { "zh-CN": "主审与条件触发的合规审核汇总后，由签署主席作出结论。", en: "A chair decides after primary and conditionally selected compliance reviews." },
    category: { "zh-CN": "审核与治理", en: "Review and governance" },
    duration: { "zh-CN": "3 个角色", en: "3 roles" },
    icon: "shield",
    accent: "gold",
    detail: {
      scenario: { "zh-CN": "审查新供应商；涉及受监管数据时，增加合规角色会签。", en: "Review a new supplier and add compliance sign-off when regulated data is involved." },
      background: { "zh-CN": "条件路由可能让同一来源的某条 Handoff 被跳过；Join 必须按 Handoff 身份区分到达与跳过。", en: "Conditional routing can skip one Handoff while another shares its source; Join must track each Handoff separately." },
      problem: { "zh-CN": "同时验证 optional Join、条件分支、同端点候选 Handoff 和字段冲突处理。", en: "Exercise optional Join, conditions, same-source candidate Handoffs, and field conflict handling." },
      collaboration: { "zh-CN": "主审先检查；条件满足时并行征求合规意见；签署主席按声明集合形成决定。", en: "A primary reviewer checks first, compliance joins conditionally, and a chair decides from the declared set." },
      deliverable: { "zh-CN": "会签结果、触发依据、未参与分支状态和待办事项。", en: "A sign-off decision, trigger rationale, skipped branch states, and follow-up items." },
      roles: {
        "primary-reviewer": { "zh-CN": "评估供应商申请与主要风险。", en: "Reviews the supplier request and primary risks." },
        "compliance-reviewer": { "zh-CN": "在适用时评估监管义务。", en: "Assesses regulatory obligations when applicable." },
        "signoff-chair": { "zh-CN": "汇总适用意见并给出会签结论。", en: "Combines applicable reviews into the sign-off decision." }
      }
    },
    roles: [
      { id: "primary-reviewer", label: { "zh-CN": "主审", en: "Primary reviewer" }, description: "Reviews the request." },
      { id: "compliance-reviewer", label: { "zh-CN": "合规审核员", en: "Compliance reviewer" }, description: "Conditional compliance review." },
      { id: "signoff-chair", label: { "zh-CN": "签署主席", en: "Sign-off chair" }, description: "Decides from applicable reviews." }
    ]
  },
  {
    id: "maker-checker",
    title: { "zh-CN": "制作者与复核者", en: "Maker-checker" },
    short: { "zh-CN": "制作者提交修改，由独立复核者批准或要求限轮返工。", en: "A maker submits a change for independent approval or bounded revision." },
    category: { "zh-CN": "审核与治理", en: "Review and governance" },
    duration: { "zh-CN": "1 个角色 + Review", en: "1 role + Review" },
    icon: "check",
    accent: "coral",
    detail: {
      scenario: { "zh-CN": "修改服务配置，直到独立审核通过或达到返工轮次上限。", en: "Revise a service configuration until independent approval or the round limit." },
      background: { "zh-CN": "Review 与受限 Loop 需要区分每一轮产物，恢复时不能重放已提交的制作调用。", en: "Review and bounded Loop need round-scoped outputs; recovery must not replay committed maker calls." },
      problem: { "zh-CN": "验证 reject/revise、审核等待、回合隔离和跨实例恢复。", en: "Exercise reject/revise, review waiting, round isolation, and cross-instance recovery." },
      collaboration: { "zh-CN": "制作者提交版本；Review 决定批准或给出反馈；拒绝后只在预算内启动下一轮。", en: "The maker submits a version; Review approves or returns feedback; rejection starts another bounded round." },
      deliverable: { "zh-CN": "最终版本、审核决定、返工轮次和剩余问题。", en: "The final version, review decision, revision count, and remaining issues." },
      roles: { maker: { "zh-CN": "根据任务制作或修改交付物。", en: "Creates or revises the deliverable." } }
    },
    roles: [{ id: "maker", label: { "zh-CN": "制作者", en: "Maker" }, description: "Creates and revises the deliverable." }]
  },
  {
    id: "release-gate",
    title: { "zh-CN": "阶段放行门", en: "Release gate" },
    short: { "zh-CN": "按验证结果进入互斥放行或拒绝分支，并遵守结果完整性策略。", en: "Validation selects an exclusive release or reject path under a result completeness policy." },
    category: { "zh-CN": "交付与发布", en: "Delivery and release" },
    duration: { "zh-CN": "1 个角色", en: "1 role" },
    icon: "check",
    accent: "mint",
    detail: {
      scenario: { "zh-CN": "检查发布清单，所有必需项通过才输出放行决定。", en: "Check a release checklist and approve only when every required item passes." },
      background: { "zh-CN": "互斥条件路由必须唯一命中；拒绝分支不能被错误地视作成功结果。", en: "Exclusive conditional routes must select one path; rejection must not be treated as a successful result." },
      problem: { "zh-CN": "验证成功/拒绝分支、唯一结果和 required/partial 结果策略。", en: "Exercise pass/reject branches, unique results, and required/partial result policies." },
      collaboration: { "zh-CN": "放行角色逐项验证证据，只能给出批准或拒绝之一，并附上依据。", en: "A gate Agent validates evidence and returns exactly one approval or rejection with rationale." },
      deliverable: { "zh-CN": "放行状态、检查摘要、阻断项与依据。", en: "A release decision, checklist summary, blockers, and rationale." },
      roles: { "release-gate": { "zh-CN": "根据完整检查清单作出阶段放行决定。", en: "Decides whether the release checklist permits progression." } }
    },
    roles: [{ id: "release-gate", label: { "zh-CN": "放行审核员", en: "Release gate" }, description: "Validates the release checklist." }]
  }
];

export function getCase(caseId) {
  return cases.find((item) => item.id === caseId);
}

export function localized(value, locale = "zh-CN") {
  return value?.[locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
}
