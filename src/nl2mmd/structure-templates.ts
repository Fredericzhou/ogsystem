/**
 * @fileoverview Structure templates for NL2MMD semantic graph generation.
 * File Set: nl2mmd-templates
 * Responsibilities:
 * - Describe stable graph skeletons keyed by OGSystem semantic intent.
 * - Provide lightweight template suggestion helpers for future prompt routing.
 * Boundaries:
 * - Advisory only; does not mutate prompts or execute validation.
 */
import { detectSemanticHints } from "./semantic-map.js";
import type { Nl2MmdSemanticHint } from "./types.js";

export type Nl2MmdStructureTemplateId =
  | "linear_flow"
  | "fanout_fanin"
  | "quorum_consultation"
  | "contract_gated_handoff"
  | "error_compensation"
  | "bounded_loop"
  | "human_gate"
  | "binding_compat";

export type Nl2MmdStructureSlot = {
  key: string;
  required: boolean;
  description: string;
  examples: string[];
};

export type Nl2MmdStructureTemplate = {
  id: Nl2MmdStructureTemplateId;
  title: string;
  summary: string;
  triggerPatterns: RegExp[];
  semanticHintLabels: string[];
  requiredMetadataKeys: string[];
  requiredSlots: Nl2MmdStructureSlot[];
  optionalSlots: Nl2MmdStructureSlot[];
  skeleton: string[];
};

export type Nl2MmdStructureTemplateMatch = {
  template: Nl2MmdStructureTemplate;
  score: number;
  reasons: string[];
  hints: Nl2MmdSemanticHint[];
};

function slot(
  key: string,
  description: string,
  examples: string[],
  required = true
): Nl2MmdStructureSlot {
  return {
    key,
    required,
    description,
    examples
  };
}

const TEMPLATES: readonly Nl2MmdStructureTemplate[] = [
  {
    id: "linear_flow",
    title: "Linear Flow",
    summary: "Single-path orchestration with one entry role and one terminal path.",
    triggerPatterns: [/直线|单线|简单|顺序|线性|single[- ]?flow/i],
    semanticHintLabels: ["entry_hint", "terminal_hint"],
    requiredMetadataKeys: ["system.id", "system.version", "law.global", "entry.role"],
    requiredSlots: [
      slot("entry", "Declare the entry role and the main linear path.", ["entry.role=debate-minimalist"]),
      slot("roles", "List the ordered roles in the single chain.", ["input -> role_a -> role_b -> output"]),
      slot("bindings", "Bind each active role to a direct model ref or legacy executor.", ["model.bind.role_a=opencode/gpt-5-nano"])
    ],
    optionalSlots: [
      slot("notes", "Capture any lightweight constraints or delivery preferences.", ["user profile style notes"], false)
    ],
    skeleton: [
      "flowchart TD",
      "%% system.id=<system.id>",
      "%% system.version=1.0.0",
      "%% law.global=<law.ref>",
      "%% entry.role=<entry-role>",
      "input -->|<EVENT>| <node>[Role:<role-id>]",
      "<node>[Role:<role-id>] -->|<EVENT>| output"
    ]
  },
  {
    id: "fanout_fanin",
    title: "Fan-out / Fan-in",
    summary: "Parallel split followed by a deterministic merge role.",
    triggerPatterns: [/并行|同时|fan[ -]?out|fan[ -]?in|多路|parallel/i],
    semanticHintLabels: ["routing_mode", "join_mode"],
    requiredMetadataKeys: [
      "system.id",
      "system.version",
      "law.global",
      "entry.role",
      "role.mode.<split-role>",
      "join.mode.<join-role>",
      "join.sources.<join-role>"
    ],
    requiredSlots: [
      slot("split", "Declare the split role and its fan-out event set.", ["role.mode.dispatch=parallel_split"]),
      slot("branches", "List parallel worker roles as separate branches.", ["dispatch -> worker_a", "dispatch -> worker_b"]),
      slot("join", "Declare the merge role and all of its sources.", ["join.mode.review=all_of", "join.sources.review=worker_a,worker_b"])
    ],
    optionalSlots: [
      slot("route-order", "Optionally stabilize sibling fan-out order.", ["route.order.dispatch=worker_a,worker_b"], false)
    ],
    skeleton: [
      "flowchart TD",
      "%% role.mode.<split-role>=parallel_split",
      "%% join.mode.<join-role>=all_of",
      "%% join.sources.<join-role>=<source-a>,<source-b>",
      "input -->|<START>| <split>[Role:<split-role>]",
      "<split>[Role:<split-role>] -->|<EVENT>| <worker-a>[Role:<worker-a>]",
      "<split>[Role:<split-role>] -->|<EVENT>| <worker-b>[Role:<worker-b>]",
      "<worker-a>[Role:<worker-a>] -->|<DONE>| <join>[Role:<join-role>]",
      "<worker-b>[Role:<worker-b>] -->|<DONE>| <join>[Role:<join-role>]",
      "<join>[Role:<join-role>] -->|DONE| output"
    ]
  },
  {
    id: "quorum_consultation",
    title: "Quorum Consultation",
    summary: "Parallel consultation with quorum-based readiness before merge.",
    triggerPatterns: [/会诊|共识|投票|多数|多学科|至少|最少|阈值|minimum|min|quorum|consultation|review panel/i],
    semanticHintLabels: ["routing_mode", "join_mode", "entry_hint"],
    requiredMetadataKeys: [
      "system.id",
      "system.version",
      "law.global",
      "entry.role",
      "join.mode.<join-role>",
      "join.sources.<join-role>",
      "join.min.<join-role>"
    ],
    requiredSlots: [
      slot("consultants", "List the roles contributing evidence to the quorum.", ["join.sources.review=worker_a,worker_b,worker_c"]),
      slot("threshold", "Declare the quorum minimum explicitly.", ["join.min.review=2"]),
      slot("merge", "Declare the merge role that consumes quorum output.", ["join.mode.review=quorum_of"])
    ],
    optionalSlots: [
      slot("projection", "Describe any `context.map` fields needed for the merge role.", ["context.map.review.summary=source(worker_a).content"], false)
    ],
    skeleton: [
      "flowchart TD",
      "%% join.mode.<join-role>=quorum_of",
      "%% join.sources.<join-role>=<source-a>,<source-b>,<source-c>",
      "%% join.min.<join-role>=2",
      "input -->|<START>| <lead>[Role:<lead-role>]",
      "<lead>[Role:<lead-role>] -->|<EVENT>| <consultant-a>[Role:<consultant-a>]",
      "<lead>[Role:<lead-role>] -->|<EVENT>| <consultant-b>[Role:<consultant-b>]",
      "<consultant-a>[Role:<consultant-a>] -->|<DONE>| <merge>[Role:<join-role>]",
      "<consultant-b>[Role:<consultant-b>] -->|<DONE>| <merge>[Role:<join-role>]",
      "<merge>[Role:<join-role>] -->|DONE| output"
    ]
  },
  {
    id: "contract_gated_handoff",
    title: "Contract-Gated Handoff",
    summary: "Flow is split by handoff contracts and may reorder sibling routes.",
    triggerPatterns: [/合同|契约|handoff|transition|strict|交接|审批流/i],
    semanticHintLabels: ["binding_policy", "routing_mode"],
    requiredMetadataKeys: [
      "system.id",
      "system.version",
      "law.global",
      "entry.role",
      "handoff.mode",
      "handoff.contracts"
    ],
    requiredSlots: [
      slot("handoff", "Declare the handoff mode and contract bundle.", ["handoff.mode=strict", "handoff.contracts=contracts/handoff.contracts.json"]),
      slot("routes", "List deterministic sibling targets in route order when needed.", ["route.order.dispatch=reviewer,observer"]),
      slot("binds", "Bind roles that own the handoff decision.", ["model.bind.reviewer=opencode/gpt-5-nano"])
    ],
    optionalSlots: [
      slot("warnings", "Note transition behavior for warned contracts.", ["handoff.mode=transition skips warned contracts"], false)
    ],
    skeleton: [
      "flowchart TD",
      "%% handoff.mode=<strict|transition>",
      "%% handoff.contracts=<bundle-path>",
      "%% route.order.<from-role>=<sibling-a>,<sibling-b>",
      "input -->|<EVENT>| <source>[Role:<source-role>]",
      "<source>[Role:<source-role>] -->|<EVENT>| <target>[Role:<target-role>]",
      "<target>[Role:<target-role>] -->|DONE| output"
    ]
  },
  {
    id: "error_compensation",
    title: "Error Compensation",
    summary: "Primary path with typed error edges and compensating recovery roles.",
    triggerPatterns: [/错误|异常|补偿|恢复|故障|error|fallback|compensat/i],
    semanticHintLabels: ["terminal_hint", "binding_policy"],
    requiredMetadataKeys: ["system.id", "system.version", "law.global", "entry.role"],
    requiredSlots: [
      slot("normal-path", "Describe the success path explicitly.", ["reviewer --> output"]),
      slot("error-path", "Add typed error edges for supported failures.", ["reviewer -->|ERROR.CONTRACT_MISSING| recovery"]),
      slot("recovery", "Declare compensating roles or fallback sink.", ["recovery --> output"])
    ],
    optionalSlots: [
      slot("feature-flag", "Document feature-gated rollout conditions if present.", ["runtime.error_flows.v1=false"], false)
    ],
    skeleton: [
      "flowchart TD",
      "%% system.id=<system.id>",
      "%% system.version=1.0.0",
      "%% law.global=<law.ref>",
      "%% entry.role=<entry-role>",
      "input -->|<EVENT>| <main>[Role:<main-role>]",
      "<main>[Role:<main-role>] -->|DONE| output",
      "<main>[Role:<main-role>] -->|ERROR.<CODE>| <recovery>[Role:<recovery-role>]",
      "<recovery>[Role:<recovery-role>] -->|DONE| output"
    ]
  },
  {
    id: "bounded_loop",
    title: "Bounded Loop",
    summary: "A loop with an explicit iteration cap and a clear exit path.",
    triggerPatterns: [/循环|重试|反复|再次|loop|retry|bounded/i],
    semanticHintLabels: ["loop_hint", "routing_mode"],
    requiredMetadataKeys: ["system.id", "system.version", "law.global", "entry.role", "loop.max.<role>"],
    requiredSlots: [
      slot("loop-cap", "Declare the role-local iteration limit.", ["loop.max.review=3"]),
      slot("loop-back", "Add the return edge and the exit edge.", ["review -->|RETRY| intake", "review -->|DONE| output"]),
      slot("exit", "Describe the terminating condition or stop event.", ["DONE"])
    ],
    optionalSlots: [
      slot("loop-summary", "Capture how the loop state is projected or summarized.", ["context.map.review.last_attempt=direct.content"], false)
    ],
    skeleton: [
      "flowchart TD",
      "%% loop.max.<role>=<N>",
      "input -->|<START>| <loop>[Role:<role>]",
      "<loop>[Role:<role>] -->|RETRY| <loop>[Role:<role>]",
      "<loop>[Role:<role>] -->|DONE| output"
    ]
  },
  {
    id: "human_gate",
    title: "Human Gate",
    summary: "A workflow with a manual review/approval checkpoint.",
    triggerPatterns: [/人工|审核|审批|确认|review|approve|gate|human/i],
    semanticHintLabels: ["entry_hint", "binding_policy"],
    requiredMetadataKeys: ["system.id", "system.version", "law.global", "entry.role"],
    requiredSlots: [
      slot("gate", "Declare the approval or review role.", ["reviewer[Role:reviewer]"]),
      slot("decision", "Represent the approval decision as a typed event.", ["APPROVE", "REJECT"]),
      slot("post-gate", "Describe the downstream branch after the gate.", ["reviewer -->|APPROVE| output"])
    ],
    optionalSlots: [
      slot("profile", "Document whether the gate uses a user profile or a human executor.", ["exec.bind.reviewer=ops-human"], false)
    ],
    skeleton: [
      "flowchart TD",
      "%% system.id=<system.id>",
      "%% system.version=1.0.0",
      "%% law.global=<law.ref>",
      "%% entry.role=<entry-role>",
      "input -->|<EVENT>| <gate>[Role:<gate-role>]",
      "<gate>[Role:<gate-role>] -->|APPROVE| output",
      "<gate>[Role:<gate-role>] -->|REJECT| output"
    ]
  },
  {
    id: "binding_compat",
    title: "Binding Compatibility",
    summary: "Legacy migration template for mixed model.bind and exec.bind systems.",
    triggerPatterns: [/exec\.bind|model\.bind|兼容|迁移|legacy|binding/i],
    semanticHintLabels: ["binding_policy"],
    requiredMetadataKeys: ["system.id", "system.version", "law.global", "entry.role"],
    requiredSlots: [
      slot("primary-binding", "Declare the preferred modern binding.", ["model.bind.reviewer=opencode/gpt-5-nano"]),
      slot("legacy-binding", "Keep the legacy compatibility binding if required.", ["exec.bind.reviewer=review-profile"]),
      slot("migration-note", "Record which binding path is authoritative.", ["model.bind is primary; exec.bind is compatibility-only"])
    ],
    optionalSlots: [
      slot("transition", "Note any gradual migration or fallback conditions.", ["compatibility mode"], false)
    ],
    skeleton: [
      "flowchart TD",
      "%% system.id=<system.id>",
      "%% system.version=1.0.0",
      "%% law.global=<law.ref>",
      "%% entry.role=<entry-role>",
      "%% model.bind.<role>=<provider/model>",
      "%% exec.bind.<role>=<profile-id>",
      "input -->|<EVENT>| <role>[Role:<role>]",
      "<role>[Role:<role>] -->|DONE| output"
    ]
  }
] as const;

const TEMPLATE_BY_ID = new Map<Nl2MmdStructureTemplateId, Nl2MmdStructureTemplate>(
  TEMPLATES.map((template) => [template.id, template])
);

function scoreTemplate(args: {
  message: string;
  template: Nl2MmdStructureTemplate;
  hints: Nl2MmdSemanticHint[];
}): Omit<Nl2MmdStructureTemplateMatch, "template"> {
  const reasons: string[] = [];
  let score = 0;
  for (const pattern of args.template.triggerPatterns) {
    if (pattern.test(args.message)) {
      score += 10;
      reasons.push(`pattern:${pattern.source}`);
    }
  }
  for (const hint of args.hints) {
    if (args.template.semanticHintLabels.includes(hint.kind)) {
      score += 4;
      reasons.push(`hint:${hint.label}`);
    }
  }
  if (score === 0 && args.template.id === "linear_flow") {
    score = 1;
    reasons.push("fallback:linear_flow");
  }
  return {
    score,
    reasons,
    hints: args.hints
  };
}

export function listNl2MmdStructureTemplates(): Nl2MmdStructureTemplate[] {
  return [...TEMPLATES];
}

export function getNl2MmdStructureTemplate(
  id: Nl2MmdStructureTemplateId
): Nl2MmdStructureTemplate | undefined {
  return TEMPLATE_BY_ID.get(id);
}

export function suggestNl2MmdStructureTemplates(message: string): Nl2MmdStructureTemplateMatch[] {
  const hints = detectSemanticHints(message);
  return TEMPLATES.map((template) => ({
    template,
    ...scoreTemplate({
      message,
      template,
      hints
    })
  })).sort((left, right) => right.score - left.score || left.template.id.localeCompare(right.template.id));
}

export function inferNl2MmdStructureTemplate(message: string): Nl2MmdStructureTemplateMatch {
  return suggestNl2MmdStructureTemplates(message)[0] ?? {
    template: TEMPLATES[0],
    score: 0,
    reasons: ["fallback:empty"],
    hints: detectSemanticHints(message)
  };
}
