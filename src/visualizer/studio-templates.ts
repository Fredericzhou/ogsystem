import {
  importMermaidToAuthoring,
  type StudioAuthoringDocument
} from "./studio-authoring.js";

export type StudioTemplateId =
  | "debate"
  | "consultation"
  | "review"
  | "quorum"
  | "compensation"
  | "zh-dev-team";

export type StudioAuthoringTemplate = {
  id: StudioTemplateId;
  title: string;
  description: string;
  systemSource: string;
};

function baseMetadata(systemId: string, entryRoleId: string): string[] {
  return [
    "flowchart TD",
    `%% system.id=${systemId}`,
    "%% system.version=1.0.0",
    "%% law.global=law.minimal.base",
    `%% entry.role=${entryRoleId}`
  ];
}

const templates: StudioAuthoringTemplate[] = [
  {
    id: "debate",
    title: "Debate",
    description: "Parallel proposer and critic roles join into a final synthesis role.",
    systemSource: [
      ...baseMetadata("studio.template.debate", "moderator"),
      "%% model.bind.moderator=opencode/gpt-5.4",
      "%% model.bind.proposer=opencode/gpt-5.4",
      "%% model.bind.critic=opencode/gpt-5.4",
      "%% model.bind.synthesizer=opencode/gpt-5.4",
      "%% role.mode.moderator=parallel_split",
      "%% route.order.moderator=proposer,critic",
      "%% join.mode.synthesizer=all_of",
      "%% join.sources.synthesizer=proposer,critic",
      "input -->|START| a[Role:moderator]",
      "a[Role:moderator] -->|PROPOSE| b[Role:proposer]",
      "a[Role:moderator] -->|CRITIQUE| c[Role:critic]",
      "b[Role:proposer] -->|DONE| d[Role:synthesizer]",
      "c[Role:critic] -->|DONE| d[Role:synthesizer]",
      "d[Role:synthesizer] -->|DONE| output",
      ""
    ].join("\n")
  },
  {
    id: "consultation",
    title: "Consultation",
    description: "A coordinator fans out to specialists and joins their findings.",
    systemSource: [
      ...baseMetadata("studio.template.consultation", "coordinator"),
      "%% model.bind.coordinator=opencode/gpt-5.4",
      "%% model.bind.specialist_a=opencode/gpt-5.4",
      "%% model.bind.specialist_b=opencode/gpt-5.4",
      "%% model.bind.summary=opencode/gpt-5.4",
      "%% role.mode.coordinator=parallel_split",
      "%% route.order.coordinator=specialist_a,specialist_b",
      "%% join.mode.summary=all_of",
      "%% join.sources.summary=specialist_a,specialist_b",
      "input -->|START| a[Role:coordinator]",
      "a[Role:coordinator] -->|ASK_A| b[Role:specialist_a]",
      "a[Role:coordinator] -->|ASK_B| c[Role:specialist_b]",
      "b[Role:specialist_a] -->|DONE| d[Role:summary]",
      "c[Role:specialist_b] -->|DONE| d[Role:summary]",
      "d[Role:summary] -->|DONE| output",
      ""
    ].join("\n")
  },
  {
    id: "review",
    title: "Review",
    description: "A writer role uses runtime-native human review with rework feedback projected back into the same role.",
    systemSource: [
      ...baseMetadata("studio.template.review", "writer"),
      "%% model.bind.writer=opencode/gpt-5.4",
      "%% review.mode.writer=required",
      "%% review.timeout.writer=86400",
      "%% review.timeout.action.writer=pause",
      "%% review.rework.target.writer=writer",
      "%% review.rework.max.writer=2",
      "%% review.terminate.scope.writer=branch",
      "%% context.map.writer.task=global.task",
      "%% context.map.writer.review_comment=global.human_review.current.comment?",
      "%% context.map.writer.review_round=global.human_review.current.round?",
      "%% context.map.writer.previous_output=global.human_review.current.previous_output.content?",
      "input -->|START| a[Role:writer]",
      "a[Role:writer] -->|DRAFT_READY| output",
      ""
    ].join("\n")
  },
  {
    id: "quorum",
    title: "Quorum",
    description: "A coordinator fans out to three specialists and a decision role proceeds after a quorum is reached.",
    systemSource: [
      ...baseMetadata("studio.template.quorum", "coordinator"),
      "%% model.bind.coordinator=opencode/gpt-5.4",
      "%% model.bind.specialist_a=opencode/gpt-5.4",
      "%% model.bind.specialist_b=opencode/gpt-5.4",
      "%% model.bind.specialist_c=opencode/gpt-5.4",
      "%% model.bind.decision=opencode/gpt-5.4",
      "%% role.mode.coordinator=parallel_split",
      "%% route.order.coordinator=specialist_a,specialist_b,specialist_c",
      "%% join.mode.decision=quorum_of",
      "%% join.sources.decision=specialist_a,specialist_b,specialist_c",
      "%% join.min.decision=2",
      "%% context.map.decision.task=global.task",
      "input -->|CASE_RECEIVED| a[Role:coordinator]",
      "a[Role:coordinator] -->|ASK_A| b[Role:specialist_a]",
      "a[Role:coordinator] -->|ASK_B| c[Role:specialist_b]",
      "a[Role:coordinator] -->|ASK_C| d[Role:specialist_c]",
      "b[Role:specialist_a] -->|A_READY| e[Role:decision]",
      "c[Role:specialist_b] -->|B_READY| e[Role:decision]",
      "d[Role:specialist_c] -->|C_READY| e[Role:decision]",
      "e[Role:decision] -->|DECISION_READY| output",
      ""
    ].join("\n")
  },
  {
    id: "compensation",
    title: "Compensation",
    description: "An execution role routes runtime failures through typed ERROR* compensation edges.",
    systemSource: [
      ...baseMetadata("studio.template.compensation", "worker"),
      "%% exec.bind.worker=profile.worker",
      "%% exec.bind.error-handler-base=profile.error-handler",
      "%% model.bind.finalizer=opencode/gpt-5.4",
      "input -->|START| a[Role:worker]",
      "a[Role:worker] -->|WORK_DONE| c[Role:finalizer]",
      "a[Role:worker] -->|ERROR.TOOL_EXECUTION_TIMEOUT| b[Role:error-handler-base]",
      "a[Role:worker] -->|ERROR| b[Role:error-handler-base]",
      "b[Role:error-handler-base] -->|COMPENSATED| c[Role:finalizer]",
      "b[Role:error-handler-base] -->|ESCALATED| output",
      "b[Role:error-handler-base] -->|ABORTED| output",
      "c[Role:finalizer] -->|DONE| output",
      ""
    ].join("\n")
  },
  {
    id: "zh-dev-team",
    title: "Chinese Dev Team",
    description: "A Chinese multi-agent delivery team splits implementation work, joins plans, and pauses for human review.",
    systemSource: [
      ...baseMetadata("studio.template.zh.dev.team", "product-manager"),
      "%% model.bind.product-manager=opencode/gpt-5.4",
      "%% model.bind.solution-architect=opencode/gpt-5.4",
      "%% model.bind.backend-engineer=opencode/gpt-5.4",
      "%% model.bind.frontend-engineer=opencode/gpt-5.4",
      "%% model.bind.qa-engineer=opencode/gpt-5.4",
      "%% model.bind.delivery-lead=opencode/gpt-5.4",
      "%% role.mode.solution-architect=parallel_split",
      "%% route.order.solution-architect=backend-engineer,frontend-engineer,qa-engineer",
      "%% join.mode.delivery-lead=all_of",
      "%% join.sources.delivery-lead=backend-engineer,frontend-engineer,qa-engineer",
      "%% review.mode.delivery-lead=required",
      "%% review.timeout.delivery-lead=86400",
      "%% review.timeout.action.delivery-lead=pause",
      "%% review.rework.target.delivery-lead=delivery-lead",
      "%% review.rework.max.delivery-lead=2",
      "%% review.terminate.scope.delivery-lead=branch",
      "%% context.map.delivery-lead.backend_plan=source(backend-engineer).content",
      "%% context.map.delivery-lead.frontend_plan=source(frontend-engineer).content",
      "%% context.map.delivery-lead.qa_plan=source(qa-engineer).content",
      "%% context.map.delivery-lead.project_goal=global.task",
      "%% context.map.delivery-lead.review_comment=global.human_review.current.comment?",
      "input -->|PROJECT_REQUEST| a[Role:product-manager]",
      "a[Role:product-manager] -->|REQUIREMENTS_READY| b[Role:solution-architect]",
      "b[Role:solution-architect] -->|START_BACKEND| c[Role:backend-engineer]",
      "b[Role:solution-architect] -->|START_FRONTEND| d[Role:frontend-engineer]",
      "b[Role:solution-architect] -->|START_QA| e[Role:qa-engineer]",
      "c[Role:backend-engineer] -->|BACKEND_READY| f[Role:delivery-lead]",
      "d[Role:frontend-engineer] -->|FRONTEND_READY| f[Role:delivery-lead]",
      "e[Role:qa-engineer] -->|QA_READY| f[Role:delivery-lead]",
      "f[Role:delivery-lead] -->|PLAN_READY| output",
      ""
    ].join("\n")
  }
];

export function listStudioAuthoringTemplates(): StudioAuthoringTemplate[] {
  return templates.map((template) => ({ ...template }));
}

export function createStudioAuthoringFromTemplate(args: {
  templateId: StudioTemplateId;
  workdir: string;
  systemPath: string;
}): StudioAuthoringDocument {
  const template = templates.find((item) => item.id === args.templateId);
  if (!template) {
    throw new Error(`Unknown Studio template: ${args.templateId}`);
  }
  return importMermaidToAuthoring({
    workdir: args.workdir,
    systemPath: args.systemPath,
    systemSource: template.systemSource
  });
}

export function createStudioAuthoringFromMermaidDraft(args: {
  workdir: string;
  systemPath: string;
  systemSource: string;
}): StudioAuthoringDocument {
  return importMermaidToAuthoring(args);
}
