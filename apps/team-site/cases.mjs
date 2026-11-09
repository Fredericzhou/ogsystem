export const cases = [
  {
    id: "cross-backend-review-loop",
    title: { "zh-CN": "跨底座审核循环", en: "Cross-backend review loop" },
    short: { "zh-CN": "Codex 分析、OpenCode 审核，打回后回到分析角色，直到审核通过。", en: "Codex analyzes and OpenCode reviews, looping back for rework until approval." },
    category: { "zh-CN": "工程协作", en: "Engineering collaboration" },
    duration: { "zh-CN": "2 个角色 · 最多 3 轮", en: "2 roles · up to 3 rounds" },
    icon: "refresh",
    detail: {
      scenario: { "zh-CN": "验证一个由 Codex 编写、OpenCode 复核的有界交付流程。", en: "Validate a bounded delivery flow written by Codex and reviewed by OpenCode." },
      relationship: { "zh-CN": "分析角色提交结果，审核角色可以通过或打回；打回意见回传给分析角色。", en: "The analyst submits a result. The reviewer approves or rejects it, sending feedback back to the analyst." },
      background: { "zh-CN": "跨模型协作需要明确的审核决策和循环上限。", en: "Cross-model collaboration needs an explicit review decision and a bounded loop." },
      problem: { "zh-CN": "适合验证共享工作目录中的分析、复核和返工。", en: "Use this to validate analysis, review, and rework in one shared workspace." },
      collaboration: { "zh-CN": "Codex 负责分析，OpenCode 负责审核；REJECTED 回到 Codex，APPROVED 进入结束。", en: "Codex analyzes and OpenCode reviews; REJECTED returns to Codex and APPROVED ends the run." },
      deliverable: { "zh-CN": "包含分析内容、审核决策、反馈和最终通过结果的审计记录。", en: "An audit trail containing analysis, review decision, feedback, and the approved result." },
      roles: {
        "codex-analyst": { "zh-CN": "分析并根据审核意见返工。", en: "Analyzes and reworks from review feedback." },
        "opencode-reviewer": { "zh-CN": "复核分析结果并决定通过或打回。", en: "Reviews the analysis and approves or rejects it." }
      }
    },
    accent: "mint",
    layout: { "codex-analyst": [180, 150], "opencode-reviewer": [600, 150] },
    semantics: ["bounded_loop", "context.map"],
    joins: [],
    loopBudgets: [{ roleId: "codex-analyst", max: 3 }],
    projections: [],
    roles: [
      { id: "codex-analyst", backend: "codex", label: { "zh-CN": "Codex 分析师", en: "Codex analyst" }, purpose: "Analyze the task and revise it after review feedback.", events: ["READY"], prompt: "Act as the Codex analyst. Produce a concise evidence-based analysis and incorporate any review feedback in the input. Return valid JSON with event READY." },
      { id: "opencode-reviewer", backend: "opencode", label: { "zh-CN": "OpenCode 审核员", en: "OpenCode reviewer" }, purpose: "Review the analysis and approve or reject it.", events: ["APPROVED", "REJECTED"], prompt: "Act as the OpenCode reviewer. On the first review, identify one concrete issue and return REJECTED with actionable feedback. On every later review, return APPROVED and briefly confirm that the analyst responded. Judge only the analysis and prior feedback; do not require future runtime state, resultCommit, or result_committed evidence because those are produced after approval. Return valid JSON with one allowed event." }
    ],
    flows: [
      ["__system_start__", "codex-analyst", "START"],
      ["codex-analyst", "opencode-reviewer", "READY"],
      ["opencode-reviewer", "codex-analyst", "REJECTED"],
      ["opencode-reviewer", "__system_end__", "APPROVED"]
    ]
  },
  {
    id: "management-consulting",
    title: { "zh-CN": "管理咨询交付", en: "Management consulting delivery" },
    short: {
      "zh-CN": "按经典咨询 SOP 并行拆解市场、运营、商业和风险，再汇聚成可执行的高管决策简报。",
      en: "Use a classic consulting SOP: parallel market, operations, commercial, and risk analysis, followed by synthesis, review, and an executive brief."
    },
    category: { "zh-CN": "管理咨询", en: "Management consulting" },
    duration: { "zh-CN": "9 个角色", en: "9 roles" },
    icon: "briefcase",
    detail: {
      scenario: { "zh-CN": "一家成长中的企业希望评估进入新市场的机会、实施路径和主要风险。请基于给定资料形成决策建议。", en: "A growing company is assessing entry into a new market and needs a decision recommendation, implementation path, and risk view based on the supplied brief." },
      relationship: { "zh-CN": "负责人先界定问题；四位专业顾问独立分析；主顾问至少收到三份意见后综合；质量复核通过后交给高管简报顾问。", en: "The engagement lead frames the question. Four specialists work independently. The synthesis consultant can proceed after at least three views, then quality review hands a checked recommendation to the executive brief consultant." },
      background: { "zh-CN": "管理咨询交付需要把客户目标、外部证据、运营约束、财务可行性和风险边界放在同一套决策逻辑中。", en: "A management consulting engagement must connect the client goal, external evidence, operating constraints, commercial feasibility, and risk boundaries in one decision logic." },
      problem: { "zh-CN": "适合需要多专业独立判断、证据汇聚和高管决策摘要的战略、运营或增长问题。", en: "Use this team for strategy, operating model, or growth questions that need independent specialist views, evidence synthesis, and an executive decision summary." },
      collaboration: { "zh-CN": "负责人明确目标、范围、成功标准与假设；市场、运营、商业财务和风险合规四路并行；主顾问汇总至少三路意见，质量顾问检查证据和建议一致性，最后由高管简报顾问输出行动计划。", en: "The lead defines the objective, scope, success criteria, and assumptions. Market, operations, commercial, and risk workstreams run in parallel. The synthesis consultant combines at least three views, a quality reviewer checks evidence and recommendation consistency, and the executive brief consultant produces the action plan." },
      deliverable: { "zh-CN": "结构化高管简报，固定包含 executiveSummary、recommendations、implementationPlan、risks、assumptions 和 openQuestions。", en: "A structured executive brief with executiveSummary, recommendations, implementationPlan, risks, assumptions, and openQuestions." },
      roles: {
        "engagement-lead": { "zh-CN": "界定目标、范围、成功标准和关键假设。", en: "Defines the objective, scope, success criteria, and key assumptions." },
        "market-analyst": { "zh-CN": "分析客户、市场、竞争和需求证据。", en: "Analyzes customer, market, competition, and demand evidence." },
        "operations-analyst": { "zh-CN": "分析流程、瓶颈、实施约束和组织影响。", en: "Analyzes processes, bottlenecks, implementation constraints, and organizational impact." },
        "commercial-analyst": { "zh-CN": "分析成本、收益、资源和商业可行性。", en: "Analyzes cost, benefit, resource needs, and commercial feasibility." },
        "risk-advisor": { "zh-CN": "识别风险、合规边界、依赖和不可确认事项。", en: "Identifies risks, compliance boundaries, dependencies, and what cannot be confirmed." },
        "synthesis-consultant": { "zh-CN": "汇总并行分析，形成候选方案和优先级。", en: "Synthesizes the parallel analyses into options and priorities." },
        "quality-reviewer": { "zh-CN": "复核证据、假设、风险和建议是否一致。", en: "Checks the evidence, assumptions, risks, and recommendations for consistency." },
        "executive-brief": { "zh-CN": "输出最终决策摘要、行动计划、风险和待确认问题。", en: "Produces the final decision summary, action plan, risks, and open questions." },
        "document-publisher": { "zh-CN": "把高管简报发布为文档和结构化业务文件。", en: "Publishes the executive brief as documents and structured business files." }
      }
    },
    accent: "gold",
    layout: {
      "engagement-lead": [80, 165],
      "market-analyst": [355, 30],
      "operations-analyst": [355, 120],
      "commercial-analyst": [355, 210],
      "risk-advisor": [355, 300],
      "synthesis-consultant": [690, 165],
      "quality-reviewer": [980, 165],
      "executive-brief": [1260, 165],
      "document-publisher": [1540, 165]
    },
    semantics: ["parallel_split", "quorum_of", "all_of", "context.map"],
    joins: [
      { roleId: "synthesis-consultant", mode: "quorum_of", sources: ["market-analyst", "operations-analyst", "commercial-analyst", "risk-advisor"], min: 3 },
      { roleId: "quality-reviewer", mode: "all_of", sources: ["synthesis-consultant"] },
      { roleId: "executive-brief", mode: "all_of", sources: ["quality-reviewer"] }
    ],
    projections: [
      ["synthesis-consultant", "marketAnalysis", "source(market-analyst).content?"],
      ["synthesis-consultant", "operationsAnalysis", "source(operations-analyst).content?"],
      ["synthesis-consultant", "commercialAnalysis", "source(commercial-analyst).content?"],
      ["synthesis-consultant", "riskAnalysis", "source(risk-advisor).content?"],
      ["synthesis-consultant", "task", "global.task"],
      ["quality-reviewer", "synthesis", "source(synthesis-consultant).content"],
      ["executive-brief", "review", "source(quality-reviewer).content"],
      ["executive-brief", "recommendation", "source(quality-reviewer).content"]
    ],
    outputSchema: {
      type: "object",
      required: ["executiveSummary", "recommendations", "implementationPlan", "risks", "assumptions", "openQuestions"],
      properties: {
        executiveSummary: { type: "string" },
        recommendations: { type: "array", items: { type: "string" } },
        implementationPlan: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        assumptions: { type: "array", items: { type: "string" } },
        openQuestions: { type: "array", items: { type: "string" } }
      },
      additionalProperties: false
    },
    roles: [
      {
        id: "engagement-lead", label: { "zh-CN": "咨询负责人", en: "Engagement lead" },
        purpose: "Define the consulting question, scope, success criteria, and assumptions.", events: ["READY"], mode: "parallel_split",
        prompt: "Act as the engagement lead. Frame the client's objective, scope, decision to make, success criteria, constraints, and key assumptions. Give the same neutral brief to four independent analysts. Return exactly one JSON object with content and one event from allowed_events. Do not invent external facts."
      },
      {
        id: "market-analyst", label: { "zh-CN": "市场与客户分析师", en: "Market and customer analyst" },
        purpose: "Analyze customer, market, competition, and demand evidence.", events: ["READY"],
        prompt: "Act as the market and customer analyst. Analyze only the supplied evidence. Separate facts, assumptions, and evidence gaps; cover customers, demand, market context, and competition. Return exactly one JSON object with event READY and a concise structured content string. Never fabricate market data."
      },
      {
        id: "operations-analyst", label: { "zh-CN": "运营流程分析师", en: "Operations analyst" },
        purpose: "Analyze current operations, bottlenecks, implementation constraints, and organizational impact.", events: ["READY"],
        prompt: "Act as the operations analyst. Review the supplied brief for process implications, bottlenecks, dependencies, implementation constraints, and organizational impact. Distinguish facts from assumptions and list missing evidence. Return exactly one JSON object with event READY and a concise structured content string."
      },
      {
        id: "commercial-analyst", label: { "zh-CN": "商业与财务分析师", en: "Commercial and financial analyst" },
        purpose: "Analyze cost, benefit, resources, and commercial feasibility.", events: ["READY"],
        prompt: "Act as the commercial and financial analyst. Assess cost drivers, potential benefits, resource needs, viability, and measurement assumptions using only supplied information. Do not create numbers that are not in the brief. Return exactly one JSON object with event READY and a concise structured content string."
      },
      {
        id: "risk-advisor", label: { "zh-CN": "风险与合规顾问", en: "Risk and compliance advisor" },
        purpose: "Identify risks, compliance boundaries, dependencies, and unconfirmed matters.", events: ["READY"],
        prompt: "Act as the risk and compliance advisor. Identify material risks, compliance boundaries, dependencies, downside scenarios, and matters that cannot be confirmed from the supplied brief. Separate facts, assumptions, and open questions. Return exactly one JSON object with event READY and a concise structured content string."
      },
      {
        id: "synthesis-consultant", label: { "zh-CN": "方案主顾问", en: "Synthesis consultant" },
        purpose: "Synthesize independent consulting analyses into options and priorities.", events: ["READY"],
        prompt: "Act as the synthesis consultant. Combine the independent analyses you receive, using at least three specialist views when available. Separate evidence, assumptions, risks, and unresolved questions. Form candidate options, trade-offs, and a recommendation priority without inventing facts. Return exactly one JSON object with event READY and a structured content string."
      },
      {
        id: "quality-reviewer", label: { "zh-CN": "质量复核顾问", en: "Quality reviewer" },
        purpose: "Check evidence, assumptions, risks, and recommendations for consistency.", events: ["READY"],
        prompt: "Act as the quality reviewer. Check the synthesis for unsupported claims, missing evidence, inconsistent assumptions, unbounded risks, and recommendations that do not follow from the analysis. State corrections and a clear pass or revise view. Return exactly one JSON object with event READY and a structured content string."
      },
      {
        id: "executive-brief", label: { "zh-CN": "高管简报顾问", en: "Executive brief consultant" },
        purpose: "Produce a decision-ready executive summary and action plan.", events: ["READY"],
        prompt: "Act as the executive brief consultant. Use the reviewed synthesis and quality findings to produce the final decision brief. Return exactly one JSON object with event READY and content set to a JSON object serialized as a string, with exactly these keys: executiveSummary (string), recommendations (array of strings), implementationPlan (array of strings), risks (array of strings), assumptions (array of strings), openQuestions (array of strings). Distinguish facts, assumptions, risks, and questions. Do not add Markdown, external data, or extra keys."
      },
      {
        id: "document-publisher", label: { "zh-CN": "文件发布员", en: "Document publisher" },
        purpose: "Publish the reviewed executive brief as document and structured business files.", events: ["READY"],
        execution: { profileId: "consulting-publisher", toolRef: "tool.consulting.publisher", format: "consulting", timeoutMs: 180000, maxOutputBytes: 65536 },
        prompt: "Publish the reviewed brief using the configured local publisher. Return the publisher JSON unchanged."
      }
    ],
    flows: [
      ["__system_start__", "engagement-lead", "START"],
      ["engagement-lead", "market-analyst", "READY"],
      ["engagement-lead", "operations-analyst", "READY"],
      ["engagement-lead", "commercial-analyst", "READY"],
      ["engagement-lead", "risk-advisor", "READY"],
      ["market-analyst", "synthesis-consultant", "READY"],
      ["operations-analyst", "synthesis-consultant", "READY"],
      ["commercial-analyst", "synthesis-consultant", "READY"],
      ["risk-advisor", "synthesis-consultant", "READY"],
      ["synthesis-consultant", "quality-reviewer", "READY"],
      ["quality-reviewer", "executive-brief", "READY"],
      ["executive-brief", "document-publisher", "READY"],
      ["document-publisher", "__system_end__", "READY"]
    ]
  },
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
        purpose: "Turn the user's software request into a shared engineering brief.", events: ["READY"], mode: "parallel_split",
        prompt: "Read the product request. Prepare one concise shared brief for a backend planner, an experience planner, and a quality planner. Name the core user outcome, constraints, and acceptance criteria. Return valid JSON with content and one allowed event."
      },
      {
        id: "backend-planner", label: { "zh-CN": "后端工程师", en: "Backend engineer" },
        purpose: "Plan the backend responsibilities and interfaces for a software feature.", events: ["READY"],
        prompt: "Act as the backend engineer. Propose a practical implementation plan, key interfaces, data handling, and risks for the requested software feature. Return valid JSON with event READY and a useful content summary."
      },
      {
        id: "experience-planner", label: { "zh-CN": "体验设计师", en: "Experience designer" },
        purpose: "Plan a clear and accessible user experience for a software feature.", events: ["READY"],
        prompt: "Act as the experience designer. Describe the primary user flow, important states, accessibility considerations, and the smallest useful interface for this request. Return valid JSON with event READY and a useful content summary."
      },
      {
        id: "quality-planner", label: { "zh-CN": "质量工程师", en: "Quality engineer" },
        purpose: "Define verifiable acceptance and testing coverage for a software feature.", events: ["READY"],
        prompt: "Act as the quality engineer. Define the highest-value acceptance checks, edge cases, and release risks for this request. Return valid JSON with event READY and a useful content summary."
      },
      {
        id: "delivery-lead", label: { "zh-CN": "交付负责人", en: "Delivery lead" },
        purpose: "Integrate engineering, experience, and quality plans into one delivery proposal.", events: ["READY"],
        prompt: "Integrate the three supplied workstream plans into a concise delivery proposal. Identify dependencies, sequencing, open questions, and a definition of done. Do not invent implementation results. Set content to a JSON object with keys summary, implementationSlices, dependencies, acceptanceChecks, risks, and openQuestions. Return valid JSON with event READY and that JSON object serialized as the content string. Do not wrap the content in Markdown."
      }
    ],
    flows: [
      ["__system_start__", "delivery-coordinator", "START"],
      ["delivery-coordinator", "backend-planner", "READY"],
      ["delivery-coordinator", "experience-planner", "READY"],
      ["delivery-coordinator", "quality-planner", "READY"],
      ["backend-planner", "delivery-lead", "READY"],
      ["experience-planner", "delivery-lead", "READY"],
      ["quality-planner", "delivery-lead", "READY"],
      ["delivery-lead", "__system_end__", "READY"]
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
        purpose: "Package the consultation question and start the specialist review.", events: ["READY"], mode: "parallel_split",
        prompt: "Prepare a neutral, concise case brief for the specialists. State uncertainty clearly and ask each specialist to return observations, supporting signals, risks, and follow-up questions. Return valid JSON with content and one allowed event."
      },
      {
        id: "cardiology-expert", label: { "zh-CN": "心血管专家", en: "Cardiology specialist" },
        purpose: "Review the case from a cardiovascular perspective.", events: ["READY"],
        prompt: "Review the provided case from a cardiovascular perspective. Separate observations from hypotheses, identify urgent red flags, and list what additional evidence would change your assessment. Do not make a definitive diagnosis. Return valid JSON with event READY and your analysis as content."
      },
      {
        id: "neurology-expert", label: { "zh-CN": "神经科专家", en: "Neurology specialist" },
        purpose: "Review the case from a neurological perspective.", events: ["READY"],
        prompt: "Review the provided case from a neurological perspective. Separate observations from hypotheses, identify urgent red flags, and list what additional evidence would change your assessment. Do not make a definitive diagnosis. Return valid JSON with event READY and your analysis as content."
      },
      {
        id: "imaging-expert", label: { "zh-CN": "影像专家", en: "Imaging specialist" },
        purpose: "Review imaging and evidence needs for the consultation.", events: ["READY"],
        prompt: "Review the provided case from an imaging and evidence perspective. State which findings are supported, what cannot be concluded, and which follow-up study or evidence would be useful. Do not fabricate imaging results. Return valid JSON with event READY and your analysis as content."
      },
      {
        id: "chief-reviewer", label: { "zh-CN": "主审专家", en: "Lead reviewer" },
        purpose: "Synthesize available specialist reviews into a cautious consultation summary.", events: ["READY"],
        prompt: "Synthesize the specialist reviews that are available. Note agreement, disagreement, uncertainty, urgent escalation signals, and reasonable next steps. Do not claim that absent specialists agreed. This is decision support, not a diagnosis. Set content to a JSON object with keys summary, riskSignals, missingInformation, nextSteps, and uncertainty. Return valid JSON with event READY and that JSON object serialized as the content string. Do not wrap the content in Markdown."
      }
    ],
    flows: [
      ["__system_start__", "consultation-dispatcher", "START"],
      ["consultation-dispatcher", "cardiology-expert", "READY"],
      ["consultation-dispatcher", "neurology-expert", "READY"],
      ["consultation-dispatcher", "imaging-expert", "READY"],
      ["cardiology-expert", "chief-reviewer", "READY"],
      ["neurology-expert", "chief-reviewer", "READY"],
      ["imaging-expert", "chief-reviewer", "READY"],
      ["chief-reviewer", "__system_end__", "READY"]
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
    duration: { "zh-CN": "6 个角色", en: "6 roles" },
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
      "debate-reporter": { "zh-CN": "整理双方强点、评议结论和仍待回答的问题。", en: "Records each side's strongest points, the review, and unanswered questions." },
      "media-publisher": { "zh-CN": "把辩论纪要发布为图片、视频和音频文件。", en: "Publishes the debate brief as image, video, and audio files." }
      }
    },
    accent: "blue",
    layout: {
      "debate-host": [90, 155],
      proponent: [360, 55],
      opponent: [360, 250],
      "neutral-judge": [640, 155],
      "debate-reporter": [900, 155],
      "media-publisher": [1190, 155]
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
        purpose: "Frame the topic and distribute the same debate brief to both sides.", events: ["READY"], mode: "parallel_split",
        prompt: "Frame a balanced debate brief with the exact question, decision criteria, and current round. Give both sides the same brief. Return valid JSON with content and one allowed event."
      },
      {
        id: "proponent", label: { "zh-CN": "正方", en: "Proposition" },
        purpose: "Build the strongest evidence-based case in favor of the proposal.", events: ["READY"],
        prompt: "Argue in favor of the proposal. Make a clear claim, use the strongest available reasons, address the opponent's prior points if present, and name a condition that could change your position. Do not fabricate evidence. Return valid JSON with event READY and your argument as content."
      },
      {
        id: "opponent", label: { "zh-CN": "反方", en: "Opposition" },
        purpose: "Build the strongest evidence-based case against the proposal.", events: ["READY"],
        prompt: "Argue against the proposal. Challenge assumptions, identify trade-offs and risks, address the proposition's prior points if present, and name a condition that could change your position. Do not fabricate evidence. Return valid JSON with event READY and your argument as content."
      },
      {
        id: "neutral-judge", label: { "zh-CN": "中立裁判", en: "Neutral judge" },
        purpose: "Evaluate both arguments against shared criteria and decide whether one bounded rebuttal is needed.", events: ["NEEDS_REWORK", "READY"],
        prompt: "Evaluate both sides fairly against the stated criteria. You may request at most one rebuttal, and only when a material issue could change the decision. Use the Runtime execution context: on loop_iteration 1 this is the initial review; when loop_iteration is greater than 1, always issue READY and never request another round. If an issue remains unresolved, state it as uncertainty. Explain each side's strongest point and your reasoning. Return valid JSON with event NEEDS_REWORK or READY and your reasoning as content."
      },
      {
        id: "debate-reporter", label: { "zh-CN": "辩论记录员", en: "Debate reporter" },
        purpose: "Present the judge's final decision and the strongest reasoning from both sides.", events: ["READY"],
        prompt: "Prepare a balanced final report from the judge's decision. Include the decision, strongest argument for each side, key uncertainty, and follow-up question. Do not introduce new evidence. Set content to a JSON object with keys decision (string), propositionCase (object with strongestPoint and reasoning strings), oppositionCase (object with strongestPoint and reasoning strings), judgeReasoning (string), uncertainty (array of strings), and followUpQuestions (array of strings). Return valid JSON with event READY and that JSON object serialized as the content string. Do not wrap the content in Markdown."
      },
      {
        id: "media-publisher", label: { "zh-CN": "媒体发布员", en: "Media publisher" },
        purpose: "Publish the debate report as PNG, MP4, and MP3 files.", events: ["READY"],
        execution: { profileId: "debate-publisher", toolRef: "tool.debate.publisher", format: "debate", timeoutMs: 180000, maxOutputBytes: 65536 },
        prompt: "Publish the final debate report using the configured local media publisher. Return the publisher JSON unchanged."
      }
    ],
    flows: [
      ["__system_start__", "debate-host", "START"],
      ["debate-host", "proponent", "READY"],
      ["debate-host", "opponent", "READY"],
      ["proponent", "neutral-judge", "READY"],
      ["opponent", "neutral-judge", "READY"],
      ["neutral-judge", "debate-host", "NEEDS_REWORK"],
      ["neutral-judge", "debate-reporter", "READY"],
      ["debate-reporter", "media-publisher", "READY"],
      ["media-publisher", "__system_end__", "READY"]
    ]
  }
];

export function getCase(caseId) {
  return cases.find((item) => item.id === caseId);
}

export function localized(value, locale = "zh-CN") {
  return value?.[locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
}
