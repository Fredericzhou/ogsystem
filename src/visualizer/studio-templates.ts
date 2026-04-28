import {
  importMermaidToAuthoring,
  type StudioAuthoringDocument
} from "./studio-authoring.js";

export type StudioTemplateId = "debate" | "consultation" | "review";

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
    description: "A writer role pauses for required human review before release.",
    systemSource: [
      ...baseMetadata("studio.template.review", "writer"),
      "%% model.bind.writer=opencode/gpt-5.4",
      "%% exec.bind.reviewer=profile.reviewer",
      "%% review.mode.reviewer=required",
      "%% review.timeout.action.reviewer=pause",
      "%% review.rework.target.reviewer=writer",
      "%% review.terminate.scope.reviewer=branch",
      "%% loop.max.writer=2",
      "input -->|START| a[Role:writer]",
      "a[Role:writer] -->|READY_FOR_REVIEW| b[Role:reviewer]",
      "b[Role:reviewer] -->|APPROVED| output",
      "b[Role:reviewer] -->|REWORK| a[Role:writer]",
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
