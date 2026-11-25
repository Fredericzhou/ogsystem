export const cases = [
  {
    id: "cross-backend-review-loop",
    title: { "zh-CN": "跨底座审核循环", en: "Cross-backend review loop" },
    short: {
      "zh-CN": "由 Codex 先形成实施判断，再交给 OpenCode 复核并完成业务交接。",
      en: "Codex forms the implementation decision first, then OpenCode reviews the handoff and closes the business loop."
    },
    category: { "zh-CN": "跨底座协作", en: "Cross-backend collaboration" },
    duration: { "zh-CN": "2 个角色", en: "2 roles" },
    catalog: {
      tier: { "zh-CN": "交叉验证模板", en: "Cross-validated template" },
      fit: { "zh-CN": "用于验证不同 CLI 底座之间的业务交接和证据闭环。", en: "For validating business handoff and evidence across different CLI backends." },
      delivery: { "zh-CN": "审核结论与交接证据", en: "Review decision and handoff evidence" },
      api: { "zh-CN": "Codex → OpenCode", en: "Codex → OpenCode" }
    },
    icon: "workflow",
    detail: {
      scenario: { "zh-CN": "验证一个由 Codex 形成初步实现判断、再由 OpenCode 复核的有界交付流程。", en: "Validate a bounded delivery flow where Codex forms an implementation decision and OpenCode reviews it." },
      relationship: { "zh-CN": "规划角色输出业务判断，复核角色只接收业务数据和元数据，不接收上游 Harness 或角色私有配置。", en: "The planner emits a business decision. The reviewer receives business data and metadata only, never the upstream Harness or private role configuration." },
      background: { "zh-CN": "跨底座协作必须验证模型服务、CLI 适配、业务交接和 Evidence 能否在同一条 Flow 中闭合。", en: "Cross-backend collaboration must prove that model service, CLI adapters, business handoff, and Evidence close within one Flow." },
      problem: { "zh-CN": "适合验证跨 Backend 的角色交接、只传递业务数据以及最终业务结论。", en: "Use this team to verify cross-backend role handoff, business-only downstream inputs, and a final decision." },
      collaboration: { "zh-CN": "Codex 规划员输出审核清单，OpenCode 复核员基于交接内容确认是否继续。", en: "The Codex planner produces a review checklist, and the OpenCode reviewer decides whether to proceed from the handoff." },
      deliverable: { "zh-CN": "经复核的审核结论和完整运行证据。", en: "A reviewed decision with complete run evidence." },
      roles: {
        planner: { "zh-CN": "形成跨底座交接所需的业务判断。", en: "Forms the business decision required for the cross-backend handoff." },
        implementer: { "zh-CN": "复核交接内容并给出最终业务结论。", en: "Reviews the handoff and returns the final business decision." }
      }
    },
    accent: "blue",
    layout: { planner: [120, 150], implementer: [620, 150] },
    semantics: ["business_handoff", "cross_backend", "evidence"],
    joins: [],
    projections: [
      ["implementer", "handoff", "direct.content"],
      ["implementer", "task", "global.task"]
    ],
    outputSchema: {
      type: "object",
      required: ["content"],
      properties: { content: { type: "string", minLength: 1 } },
      additionalProperties: true
    },
    roles: [
      {
        id: "planner",
        label: { "zh-CN": "Codex 规划员", en: "Codex planner" },
        backend: "codex",
        writesFiles: true,
        purpose: "Prepare a concise business handoff for the downstream reviewer.",
        events: ["READY"],
        prompt: "Summarize the requested cross-backend business handoff. State the verified decision, acceptance checks, and whether the downstream reviewer should proceed. Create cross-backend-review.md in the execution workspace with that business handoff when write-capable staging is available. Do not claim the file exists unless it was actually written. Return JSON with event READY and content only; do not expose Harness, tool, permission, or private role configuration."
      },
      {
        id: "implementer",
        label: { "zh-CN": "OpenCode 复核员", en: "OpenCode reviewer" },
        backend: "opencode",
        purpose: "Review the planner's business handoff and verify its evidence boundaries.",
        events: ["READY"],
        prompt: "Review the planner's business conclusion and the projected handoff content. Check its acceptance checks, evidence boundaries, and limitations. Return JSON with event READY and state the reviewed conclusion, evidence checks, and any limitations. Do not request or disclose upstream Harness, tool, permission, or private role configuration."
      }
    ],
    flows: [
      ["__system_start__", "planner", "START"],
      ["planner", "implementer", "READY"],
      ["implementer", "__system_end__", "READY"]
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
    catalog: {
      tier: { "zh-CN": "核心模板", en: "Core template" },
      fit: { "zh-CN": "适合多专业并行分析与文件化决策交付。", en: "For parallel specialist analysis and document-based decisions." },
      delivery: { "zh-CN": "文档与结构化数据", en: "Documents and structured data" },
      api: { "zh-CN": "可通过 API 运行", en: "API runnable" }
    },
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
        prompt: "Act as the synthesis consultant. Combine the independent analyses you receive, using at least three specialist views when available. The Runtime quorum is an arrival gate, not a vote: three arrived specialist outputs satisfy 3/4 quorum, but arrival does not mean approval. Never call arrived sources missing, count them as votes, or claim 0/4 when their analyses are in your input. Separate evidence, assumptions, risks, and unresolved questions. Form candidate options, trade-offs, and a recommendation priority without inventing facts. Return exactly one JSON object with event READY and a structured content string."
      },
      {
        id: "quality-reviewer", label: { "zh-CN": "质量复核顾问", en: "Quality reviewer" },
        purpose: "Check evidence, assumptions, risks, and recommendations for consistency.", events: ["READY"],
        prompt: "Act as the quality reviewer. Check the synthesis for unsupported claims, missing evidence, inconsistent assumptions, unbounded risks, and recommendations that do not follow from the analysis. Keep Runtime join arrival quorum separate from business approval: a satisfied 3/4 arrival gate means three specialist views arrived, not that three sources voted to approve. Do not change an achieved arrival count to 0/4 or treat missing votes as a failed Runtime quorum. State corrections and a clear pass or revise view. Return exactly one JSON object with event READY and a structured content string."
      },
      {
        id: "executive-brief", label: { "zh-CN": "高管简报顾问", en: "Executive brief consultant" },
        purpose: "Produce a decision-ready executive summary and action plan.", events: ["READY"],
        prompt: "Act as the executive brief consultant. Use the reviewed synthesis and quality findings to produce the final decision brief. Return exactly one JSON object with event READY and content set to a JSON object serialized as a string, with exactly these keys: executiveSummary (string), recommendations (array of strings), implementationPlan (array of strings), risks (array of strings), assumptions (array of strings), openQuestions (array of strings). Distinguish facts, assumptions, risks, and questions. Do not add Markdown, external data, or extra keys."
      },
      {
        id: "document-publisher", label: { "zh-CN": "文件发布员", en: "Document publisher" },
        writesFiles: true,
        purpose: "Publish the reviewed executive brief as document and structured business files.", events: ["READY"],
        prompt: "Based on the reviewed executive brief, produce the final business document delivery. Include the executive summary, recommendations, implementation plan, risks, assumptions, and open questions. When the Harness exposes write-capable staging, create a Markdown document named executive-brief.md in the execution workspace using an available native tool. Return valid JSON with event READY and the structured business result. If the Harness cannot write files, return the document content without claiming a file was created."
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
    catalog: {
      tier: { "zh-CN": "核心模板", en: "Core template" },
      fit: { "zh-CN": "适合多角色并行实现、测试并交付小型软件功能。", en: "For implementing, testing, and delivering a small software feature across parallel roles." },
      delivery: { "zh-CN": "可运行的软件与测试", en: "Runnable software and tests" },
      api: { "zh-CN": "可通过 API 运行", en: "API runnable" }
    },
    icon: "code",
    detail: {
      scenario: { "zh-CN": "实现自由职业者记账工具的首个可运行版本：支持收入/支出记录、按月汇总、基础校验和发布前测试。", en: "Implement a runnable first release of a bookkeeping tool for independent professionals: record income and expenses, summarize by month, validate entries, and test before release." },
      relationship: { "zh-CN": "产品负责人明确目标；后端、体验和质量角色在独立文件中并行实现；交付负责人集成工作、运行测试并说明交付范围。", en: "The product lead frames the goal. Backend, experience, and quality roles implement separate files in parallel; the delivery lead integrates the work, runs tests, and documents the delivered scope." },
      background: { "zh-CN": "一项产品需求通常同时牵涉工程实现、用户体验和质量保障。由单一角色从头包办，容易遗漏接口依赖或验收条件。", en: "A product request often spans engineering, user experience, and quality. A single owner can miss interface dependencies or acceptance criteria." },
      problem: { "zh-CN": "适合需要工程、体验和质量角色共同完成并验证的小型产品功能。", en: "Use this team for a small product feature that needs implementation and verification across engineering, experience, and quality roles." },
      collaboration: { "zh-CN": "后端角色实现可测试的数据逻辑，体验角色实现可访问的浏览器界面，质量角色编写可执行测试；交付负责人运行测试并发布源代码、测试和使用说明。", en: "The backend role implements testable data logic, the experience role builds an accessible browser interface, and the quality role writes executable tests; the delivery lead runs the tests and publishes source, tests, and usage notes." },
      deliverable: { "zh-CN": "可运行的记账工具源代码、自动化测试和运行说明；未实现或未验证的能力必须明确标记。", en: "Runnable bookkeeping tool source, automated tests, and run instructions; unimplemented or unverified behavior must be stated explicitly." },
      roles: {
        "delivery-coordinator": { "zh-CN": "归纳用户目标、约束与验收重点。", en: "Aligns the user outcome, constraints, and acceptance priorities." },
        "backend-engineer": { "zh-CN": "实现可测试的数据模型、账目校验和月度汇总逻辑。", en: "Implements testable ledger validation and monthly summary logic." },
        "experience-engineer": { "zh-CN": "实现主要浏览器操作流程、界面状态与无障碍体验。", en: "Implements the browser workflow, interface states, and accessibility." },
        "quality-engineer": { "zh-CN": "编写覆盖数据逻辑和边界情况的可执行测试。", en: "Writes executable tests for the data logic and edge cases." },
        "delivery-lead": { "zh-CN": "集成并行实现、运行验证并记录真实交付范围。", en: "Integrates parallel implementation, runs verification, and records the delivered scope." }
      }
    },
    accent: "mint",
    layout: {
      "delivery-coordinator": [80, 145],
      "backend-engineer": [360, 48],
      "experience-engineer": [360, 145],
      "quality-engineer": [360, 242],
      "delivery-lead": [690, 145]
    },
    semantics: ["parallel_split", "all_of", "context.map"],
    joins: [{ roleId: "delivery-lead", mode: "all_of", sources: ["backend-engineer", "experience-engineer", "quality-engineer"] }],
    projections: [
      ["delivery-lead", "backend_result", "source(backend-engineer).content"],
      ["delivery-lead", "experience_result", "source(experience-engineer).content"],
      ["delivery-lead", "quality_result", "source(quality-engineer).content"],
      ["delivery-lead", "task", "global.task"]
    ],
    roles: [
      {
        id: "delivery-coordinator", label: { "zh-CN": "产品负责人", en: "Product lead" },
        purpose: "Turn the user's software request into a shared engineering brief.", events: ["READY"], mode: "parallel_split",
        prompt: "Read the product request. Prepare one concise shared implementation brief for the backend engineer, experience engineer, and quality engineer. Specify the core user outcome, fixed module interface, file ownership (src/ledger.mjs; index.html, styles.css, src/app.js; tests/ledger.test.mjs), constraints, and acceptance criteria. Return valid JSON with content and one allowed event."
      },
      {
        id: "backend-engineer", label: { "zh-CN": "后端工程师", en: "Backend engineer" },
        writesFiles: true,
        purpose: "Implement the bookkeeping data model and calculations in the shared Workspace.", events: ["READY"],
        prompt: "Implement the data layer for the requested bookkeeping tool in src/ledger.mjs. Export createLedger({ entries = [] }) with addEntry({ id, date, description, kind, amountCents }), listEntries(), and monthlyTotals(year, month). Accept kind income or expense; require a valid ISO calendar date, non-empty description, unique non-empty id, and positive safe-integer amountCents. monthlyTotals returns { incomeCents, expenseCents, balanceCents } for the selected calendar month. Keep this module dependency-free and suitable for Node tests and browser imports. Use an available native file-writing tool to create the implementation in the Workspace, then return the changed path and the exact exported interface in JSON with event READY. Do not claim files were written unless they exist."
      },
      {
        id: "experience-engineer", label: { "zh-CN": "体验工程师", en: "Experience engineer" },
        writesFiles: true,
        purpose: "Implement the accessible browser interface for the bookkeeping tool.", events: ["READY"],
        prompt: "Implement the browser UI for the requested bookkeeping tool in index.html, styles.css, and src/app.js. In src/app.js import createLedger from ./ledger.mjs. Provide income/expense entry, date and description fields, a monthly selector, totals, empty/error/success states, and a responsive accessible form with associated labels and keyboard-operable controls. Use no external dependencies or network assets. Use an available native file-writing tool to create the files in the Workspace. Return the changed paths and any integration assumptions in JSON with event READY; do not claim files were written unless they exist."
      },
      {
        id: "quality-engineer", label: { "zh-CN": "质量工程师", en: "Quality engineer" },
        writesFiles: true,
        purpose: "Implement executable tests for the ledger behavior and required edge cases.", events: ["READY"],
        prompt: "Create tests/ledger.test.mjs using node:test and node:assert/strict for the interface src/ledger.mjs. Cover income/expense monthly totals, balance calculation, month boundaries, invalid dates, duplicate IDs, empty descriptions, unsupported kinds, and invalid amounts. Use only Node built-ins. Use an available native file-writing tool to create the tests in the Workspace. Return the test path and cases covered in JSON with event READY; do not claim files were written unless they exist."
      },
      {
        id: "delivery-lead", label: { "zh-CN": "交付负责人", en: "Delivery lead" },
        writesFiles: true,
        purpose: "Integrate and verify the parallel software implementation before delivery.", events: ["READY"],
        prompt: "Integrate the three Workspace contributions. Inspect index.html, styles.css, src/app.js, src/ledger.mjs, and tests/ledger.test.mjs. Run `node --test tests/ledger.test.mjs` with the available process tool, fix integration or test failures, and rerun the tests. Use the available native file-writing tool to create README.md with startup instructions, implemented behavior, verification command/result, and any real limitations. Return a concise JSON business result with event READY listing the delivered source/test files, test result, and limitations. Never report a pass unless the command passed, and never claim a file exists unless it does."
      }
    ],
    flows: [
      ["__system_start__", "delivery-coordinator", "START"],
      ["delivery-coordinator", "backend-engineer", "READY"],
      ["delivery-coordinator", "experience-engineer", "READY"],
      ["delivery-coordinator", "quality-engineer", "READY"],
      ["backend-engineer", "delivery-lead", "READY"],
      ["experience-engineer", "delivery-lead", "READY"],
      ["quality-engineer", "delivery-lead", "READY"],
      ["delivery-lead", "__system_end__", "READY"]
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
    catalog: {
      tier: { "zh-CN": "核心模板", en: "Core template" },
      fit: { "zh-CN": "适合需要正反观点、质询与中立评议的争议议题。", en: "For contested questions that need opposing views and neutral review." },
      delivery: { "zh-CN": "讨论纪要文档", en: "Debate brief document" },
      api: { "zh-CN": "可通过 API 运行", en: "API runnable" }
    },
    icon: "scales",
    detail: {
      scenario: { "zh-CN": "讨论议题：一家 30 人的公司，是否应要求员工每周到办公室三天？", en: "Debate topic: should a 30-person company ask employees to work from the office three days each week?" },
      relationship: { "zh-CN": "主持人把同一议题交给正反双方；裁判比较双方论据，可要求一轮补充回应，完成评议后直接交给文档发布员。", en: "The host gives both sides the same question. A neutral judge compares their arguments, may request one bounded rebuttal, then hands the completed review directly to the document publisher." },
      background: { "zh-CN": "面对影响团队的选择，支持与反对意见都需要被充分表达。让双方围绕同一问题和标准交锋，再交由中立角色评议，可以减少只听到单一立场的风险。", en: "Team decisions deserve a fair account of both support and opposition. Giving each side the same question and criteria before neutral review reduces the risk of hearing only one position." },
      problem: { "zh-CN": "适合比较政策、产品方向或资源投入等存在真实取舍的问题。它帮助团队澄清依据，不替代负责人作出决定。", en: "Use this team to compare policies, product directions, or investments with real trade-offs. It clarifies the reasoning while leaving the decision to the responsible people." },
      collaboration: { "zh-CN": "主持人给双方相同的辩题和评议标准；正反方分别陈述理由并回应对方；中立裁判判断是否需要一轮补充质询并完成评议；文档发布员将裁判结果整理为最终交付文档。", en: "A host gives both sides the same question and criteria. The proposition and opposition make their cases and respond to one another. A neutral judge may request one bounded rebuttal and then completes the review; a document publisher turns that review into the final deliverable." },
      deliverable: { "zh-CN": "一份平衡的讨论纪要，呈现双方最有力的论据、评议理由、不确定因素和后续决策问题。", en: "A balanced debate brief with each side's strongest case, the reviewer's reasoning, uncertainty, and questions for the decision makers." },
      roles: {
        "debate-host": { "zh-CN": "明确辩题、评议标准，并把相同资料交给双方。", en: "Frames the question and criteria, then gives both sides the same brief." },
        "proponent": { "zh-CN": "提出支持方案的理由、依据与成立条件。", en: "Builds the case for the proposal, its rationale, and conditions." },
        "opponent": { "zh-CN": "指出方案的假设、代价、风险与替代思路。", en: "Challenges assumptions and explains costs, risks, and alternatives." },
        "neutral-judge": { "zh-CN": "按共同标准比较双方论据，完成评议并说明依据、不确定性和后续问题。", en: "Compares both cases against shared criteria and completes the review with reasoning, uncertainty, and follow-up questions." },
        "document-publisher": { "zh-CN": "将裁判结果整理并发布为最终讨论纪要文档。", en: "Turns the judge's result into the final debate brief document." }
      }
    },
    accent: "blue",
    layout: {
      "debate-host": [90, 155],
      proponent: [360, 55],
      opponent: [360, 250],
      "neutral-judge": [640, 155],
      "document-publisher": [940, 155]
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
        id: "document-publisher", label: { "zh-CN": "文档发布员", en: "Document publisher" },
        writesFiles: true,
        purpose: "Publish the judge's completed review as a final business document.", events: ["READY"],
        prompt: "Based on the judge's completed review, produce the final debate brief for delivery. Include the decision, strongest point for each side, judge reasoning, uncertainty, and follow-up questions. When the Harness exposes write-capable staging, always create a Markdown document named debate-brief.md in the execution workspace using an available native tool. Return valid JSON with event READY and content containing the structured business result. If the Harness cannot write files, return the document content without claiming a file was created."
      }
    ],
    flows: [
      ["__system_start__", "debate-host", "START"],
      ["debate-host", "proponent", "READY"],
      ["debate-host", "opponent", "READY"],
      ["proponent", "neutral-judge", "READY"],
      ["opponent", "neutral-judge", "READY"],
      ["neutral-judge", "debate-host", "NEEDS_REWORK"],
      ["neutral-judge", "document-publisher", "READY"],
      ["document-publisher", "__system_end__", "READY"]
    ]
  },
  {
    id: "release-operations",
    title: { "zh-CN": "产品交付与发布", en: "Product release operations" },
    short: {
      "zh-CN": "从需求澄清、并行实现和质量验证，到人工审批、发布和失败补偿的完整交付团队。",
      en: "A practical delivery team from intake and parallel implementation through human approval, release, and compensation."
    },
    category: { "zh-CN": "产品交付", en: "Product delivery" },
    duration: { "zh-CN": "7 个角色", en: "7 roles" },
    catalog: {
      tier: { "zh-CN": "高价值模板", en: "High-value template" },
      fit: { "zh-CN": "适合需要代码、测试、文档、审批和可追溯发布的小型产品交付。", en: "For small product releases that need code, tests, documentation, approval, and traceable delivery." },
      delivery: { "zh-CN": "经过审批的发布包与补偿记录", en: "Approved release package and compensation evidence" },
      api: { "zh-CN": "可通过 API 运行", en: "API runnable" }
    },
    icon: "rocket",
    detail: {
      scenario: { "zh-CN": "把一项明确的产品需求拆解为实现、测试和文档工作，完成质量门禁后交由人工审批，再执行发布。", en: "Turn a defined product request into implementation, tests, and documentation, pass a quality gate, obtain human approval, and execute a release." },
      relationship: { "zh-CN": "交付负责人分发同一份任务上下文，三个工作流并行完成后由发布经理汇总；审批通过才允许发布，返工回到发布经理，部署失败进入补偿处理。", en: "The delivery lead fans out one task context to three workstreams. A release manager joins them, requires human approval before deployment, routes rework back to the gate, and sends deployment failures to compensation." },
      background: { "zh-CN": "真实交付需要把并行产出、汇合条件、人工决策、发布动作和失败处置放在同一条可审计流程中。", en: "Real delivery needs parallel outputs, join conditions, human decisions, release actions, and failure handling in one auditable flow." },
      problem: { "zh-CN": "适合需要明确责任边界、可回退审批和发布失败处置的小型软件或文档产品交付。", en: "Use this for small software or document releases that need explicit ownership, approval rollback, and deployment failure handling." },
      collaboration: { "zh-CN": "实现、质量和文档角色在独立工作区并行工作；发布经理通过 all_of 和 context.map 汇总结果；Runtime 审批负责暂停、批准或返工；部署角色失败时由补偿角色记录恢复或升级。", en: "Implementation, quality, and documentation work in isolated workspaces. The release manager combines them through all_of and context.map. Runtime review pauses, approves, or reworks the gate; deployment failures are recorded as compensated or escalated." },
      deliverable: { "zh-CN": "经过验证的源代码、测试、发布说明，以及审批和补偿证据。", en: "Verified source, tests, release notes, and approval plus compensation evidence." },
      roles: {
        "delivery-lead": { "zh-CN": "澄清目标、范围、验收条件并分发统一上下文。", en: "Clarifies the goal, scope, acceptance criteria, and shared context." },
        "implementation-engineer": { "zh-CN": "实现需求并提交可追踪的源代码。", en: "Implements the request and commits traceable source changes." },
        "quality-engineer": { "zh-CN": "编写并运行覆盖关键边界的自动化测试。", en: "Creates and runs automated tests for the important boundaries." },
        "release-writer": { "zh-CN": "整理发布说明、变更范围和已知限制。", en: "Prepares release notes, scope, and known limitations." },
        "release-manager": { "zh-CN": "汇总并行结果，确认质量门禁并提交人工审批。", en: "Combines parallel results, confirms the quality gate, and requests human approval." },
        "release-deployer": { "zh-CN": "在审批通过后执行受控发布并报告结果。", en: "Runs the controlled release after approval and reports the result." },
        "error-handler": { "zh-CN": "记录发布失败的补偿动作、升级条件和最终状态。", en: "Records compensation actions, escalation conditions, and the final failure state." }
      }
    },
    accent: "violet",
    layout: {
      "delivery-lead": [80, 145],
      "implementation-engineer": [360, 48],
      "quality-engineer": [360, 145],
      "release-writer": [360, 242],
      "release-manager": [690, 145],
      "release-deployer": [990, 95],
      "error-handler": [990, 245]
    },
    semantics: ["handoff.strict", "parallel_split", "all_of", "context.map", "human_review", "rework", "error_compensation"],
    handoffMode: "strict",
    handoffContracts: "contracts/handoff.contracts.json",
    reviews: [{ roleId: "release-manager", mode: "required", timeout: 86400, timeoutAction: "pause", reworkTarget: "delivery-lead", reworkMax: 2, terminateScope: "run" }],
    joins: [{ roleId: "release-manager", mode: "all_of", sources: ["implementation-engineer", "quality-engineer", "release-writer"] }],
    loopBudgets: [{ roleId: "delivery-lead", max: 2 }],
    projections: [
      ["release-manager", "implementation", "source(implementation-engineer).content"],
      ["release-manager", "quality", "source(quality-engineer).content"],
      ["release-manager", "releaseNotes", "source(release-writer).content"],
      ["release-manager", "task", "global.task"],
      ["delivery-lead", "humanReviewComment", "global.human_review.current.comment?"],
      ["delivery-lead", "humanReviewRound", "global.human_review.current.round?"],
      ["delivery-lead", "previousReleaseManagerOutput", "global.human_review.current.previous_output.content?"]
    ],
    roles: [
      {
        id: "delivery-lead", label: { "zh-CN": "交付负责人", en: "Delivery lead" }, mode: "parallel_split",
        purpose: "Frame the delivery request and distribute one bounded implementation context.", events: ["READY"],
        prompt: "Read the product request and produce a concise delivery brief covering outcome, scope, acceptance criteria, constraints, and file ownership for implementation-engineer, quality-engineer, and release-writer. Do not invent external evidence. Return JSON with event READY and content."
      },
      {
        id: "implementation-engineer", label: { "zh-CN": "实现工程师", en: "Implementation engineer" }, writesFiles: true,
        purpose: "Implement the requested product change in the execution Workspace.", events: ["READY"],
        prompt: "Implement the requested change in the execution Workspace using only assigned files. Keep the implementation small and testable, inspect existing files before editing, and report changed paths and real limitations. Use native file-writing tools when available. Return JSON with event READY and content; never claim a file exists unless it was checked."
      },
      {
        id: "quality-engineer", label: { "zh-CN": "质量工程师", en: "Quality engineer" }, writesFiles: true,
        purpose: "Create executable verification for the requested product change.", events: ["READY"],
        prompt: "Create or update focused automated tests for the requested change in the execution Workspace. Cover the happy path and important boundary or failure cases. Use native file-writing tools when available and report the exact verification command and result without claiming an unrun pass. Return JSON with event READY and content."
      },
      {
        id: "release-writer", label: { "zh-CN": "发布说明负责人", en: "Release writer" }, writesFiles: true,
        purpose: "Prepare accurate release notes from the requested scope and available evidence.", events: ["READY"],
        prompt: "Prepare release notes in the execution Workspace. State what changed, acceptance evidence, known limitations, rollback considerations, and follow-up work. Use native file-writing tools when available and do not invent test or deployment results. Return JSON with event READY and content."
      },
      {
        id: "release-manager", label: { "zh-CN": "发布经理", en: "Release manager" }, backend: "qwen",
        purpose: "Evaluate the joined delivery package and submit it to human approval or bounded rework.", controlActions: ["approve", "reject", "rework"], events: ["READY"],
        outputDataSchema: {
          type: "object",
          properties: {
            requiredChanges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  criterionId: { type: "string" },
                  action: { type: "string" }
                },
                required: ["criterionId", "action"],
                additionalProperties: false
              }
            }
          },
          additionalProperties: false
        },
        prompt: "Review the projected implementation, quality, and release-note results. Keep Runtime arrival quorum separate from business approval. Submit READY with a concise gate summary when the package is ready for human approval. Include any required changes in content and data.requiredChanges when a reviewer sends the work back. Human approval, rework, and rejection are Runtime decisions, not Role events. Return JSON with event READY, content, and optional data.requiredChanges."
      },
      {
        id: "release-deployer", label: { "zh-CN": "发布执行员", en: "Release deployer" }, writesFiles: true,
        purpose: "Perform the approved release action and preserve its evidence.", events: ["SHIPPED", "ERROR"],
        prompt: "Only act after the release manager approval is present. Perform the bounded release or packaging action assigned in the Workspace, record the exact command and result, and emit SHIPPED only when it completed. Emit ERROR with the observed failure and recovery context when it did not complete. Return JSON and do not claim deployment success without evidence."
      },
      {
        id: "error-handler", label: { "zh-CN": "失败补偿处理员", en: "Failure compensation handler" }, backend: "kimi",
        purpose: "Classify a release failure and record a bounded compensation or escalation outcome.", events: ["COMPENSATED", "ESCALATED", "ABORTED"],
        prompt: "Handle the release failure as Runtime error context. Identify the failed action, preserve evidence, and choose COMPENSATED when a safe rollback or cleanup completed, ESCALATED when human or external intervention is required, or ABORTED when continuing would be unsafe. Do not claim a rollback or cleanup unless it was performed. Return JSON with the selected event and content."
      }
    ],
    flows: [
      ["__system_start__", "delivery-lead", "START"],
      ["delivery-lead", "implementation-engineer", "READY"],
      ["delivery-lead", "quality-engineer", "READY"],
      ["delivery-lead", "release-writer", "READY"],
      ["implementation-engineer", "release-manager", "READY"],
      ["quality-engineer", "release-manager", "READY"],
      ["release-writer", "release-manager", "READY"],
      ["release-manager", "release-deployer", "READY"],
      ["release-manager", "delivery-lead", "NEEDS_REWORK"],
      ["release-manager", "__system_end__", "REJECTED"],
      ["release-deployer", "__system_end__", "SHIPPED"],
      ["release-deployer", "error-handler", "ERROR"],
      ["error-handler", "__system_end__", "COMPENSATED"],
      ["error-handler", "__system_end__", "ESCALATED"],
      ["error-handler", "__system_end__", "ABORTED"]
    ]
  }
];

export function getCase(caseId) {
  return cases.find((item) => item.id === caseId);
}

export function localized(value, locale = "zh-CN") {
  return value?.[locale] ?? value?.["zh-CN"] ?? value?.en ?? "";
}
