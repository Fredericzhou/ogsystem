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

function baseMetadata(systemId: string): string[] {
  return [
    "flowchart TD",
    `%% system.id=${systemId}`,
    "%% system.version=1.0.0",
    "%% law.global=law.minimal.base"
  ];
}

const templates: StudioAuthoringTemplate[] = [
  {
    id: "debate",
    title: "Debate",
    description: "Parallel proposer and critic roles join into a final synthesis role.",
    systemSource: [
      ...baseMetadata("studio.template.debate"),
      "%% role.mode.moderator=parallel_split",
      "%% route.order.moderator=proposer,critic",
      "%% join.mode.synthesizer=all_of",
      "%% join.sources.synthesizer=proposer,critic",
      "start[开始] -->|START| a[Role:moderator]",
      "a[Role:moderator] -->|READY| b[Role:proposer]",
      "a[Role:moderator] -->|READY| c[Role:critic]",
      "b[Role:proposer] -->|READY| d[Role:synthesizer]",
      "c[Role:critic] -->|READY| d[Role:synthesizer]",
      "d[Role:synthesizer] -->|READY| end[结束]",
      ""
    ].join("\n")
  },
  {
    id: "consultation",
    title: "Consultation",
    description: "A coordinator fans out to specialists and joins their findings.",
    systemSource: [
      ...baseMetadata("studio.template.consultation"),
      "%% role.mode.coordinator=parallel_split",
      "%% route.order.coordinator=specialist_a,specialist_b",
      "%% join.mode.summary=all_of",
      "%% join.sources.summary=specialist_a,specialist_b",
      "start[开始] -->|START| a[Role:coordinator]",
      "a[Role:coordinator] -->|READY| b[Role:specialist_a]",
      "a[Role:coordinator] -->|READY| c[Role:specialist_b]",
      "b[Role:specialist_a] -->|READY| d[Role:summary]",
      "c[Role:specialist_b] -->|READY| d[Role:summary]",
      "d[Role:summary] -->|READY| end[结束]",
      ""
    ].join("\n")
  },
  {
    id: "review",
    title: "Review",
    description: "A writer role uses runtime-native human review with rework feedback projected back into the same role.",
    systemSource: [
      ...baseMetadata("studio.template.review"),
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
      "start[开始] -->|START| a[Role:writer]",
      "a[Role:writer] -->|READY| end[结束]",
      ""
    ].join("\n")
  },
  {
    id: "quorum",
    title: "Quorum",
    description: "A coordinator fans out to three specialists and a decision role proceeds after a quorum is reached.",
    systemSource: [
      ...baseMetadata("studio.template.quorum"),
      "%% role.mode.coordinator=parallel_split",
      "%% route.order.coordinator=specialist_a,specialist_b,specialist_c",
      "%% join.mode.decision=quorum_of",
      "%% join.sources.decision=specialist_a,specialist_b,specialist_c",
      "%% join.min.decision=2",
      "%% context.map.decision.task=global.task",
      "start[开始] -->|START| a[Role:coordinator]",
      "a[Role:coordinator] -->|READY| b[Role:specialist_a]",
      "a[Role:coordinator] -->|READY| c[Role:specialist_b]",
      "a[Role:coordinator] -->|READY| d[Role:specialist_c]",
      "b[Role:specialist_a] -->|READY| e[Role:decision]",
      "c[Role:specialist_b] -->|READY| e[Role:decision]",
      "d[Role:specialist_c] -->|READY| e[Role:decision]",
      "e[Role:decision] -->|READY| end[结束]",
      ""
    ].join("\n")
  },
  {
    id: "compensation",
    title: "Compensation",
    description: "An execution role routes runtime failures through typed ERROR* compensation edges.",
    systemSource: [
      ...baseMetadata("studio.template.compensation"),
      "%% exec.bind.worker=profile.worker",
      "%% exec.bind.error-handler-base=profile.error-handler",
      "start[开始] -->|START| a[Role:worker]",
      "a[Role:worker] -->|READY| c[Role:finalizer]",
      "a[Role:worker] -->|ERROR.TOOL_EXECUTION_TIMEOUT| b[Role:error-handler-base]",
      "a[Role:worker] -->|ERROR| b[Role:error-handler-base]",
      "b[Role:error-handler-base] -->|READY| c[Role:finalizer]",
      "b[Role:error-handler-base] -->|BLOCKED| end[结束]",
      "b[Role:error-handler-base] -->|REJECTED| end[结束]",
      "c[Role:finalizer] -->|READY| end[结束]",
      ""
    ].join("\n")
  },
  {
    id: "zh-dev-team",
    title: "Chinese Dev Team",
    description: "A Chinese multi-agent delivery team splits implementation work, joins plans, and pauses for human review.",
    systemSource: [
      ...baseMetadata("studio.template.zh.dev.team"),
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
      "start[开始] -->|START| a[Role:product-manager]",
      "a[Role:product-manager] -->|READY| b[Role:solution-architect]",
      "b[Role:solution-architect] -->|READY| c[Role:backend-engineer]",
      "b[Role:solution-architect] -->|READY| d[Role:frontend-engineer]",
      "b[Role:solution-architect] -->|READY| e[Role:qa-engineer]",
      "c[Role:backend-engineer] -->|READY| f[Role:delivery-lead]",
      "d[Role:frontend-engineer] -->|READY| f[Role:delivery-lead]",
      "e[Role:qa-engineer] -->|READY| f[Role:delivery-lead]",
      "f[Role:delivery-lead] -->|READY| end[结束]",
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
