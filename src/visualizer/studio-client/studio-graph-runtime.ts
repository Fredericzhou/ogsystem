import type {
  GraphViewModel,
  GraphViewModelEdge,
  GraphViewModelNode,
  StudioAuthoringDocument,
} from "../studio-contracts.js";

export type StudioRuntimeNodeState = {
  status?: "active" | "running" | "waiting_review" | "done" | "failed" | "paused" | "pending" | "idle";
  statusLabel?: string;
  errorCode?: string;
  loopCount?: number;
  active: boolean;
  waitingReview: boolean;
  humanGateConfigured: boolean;
};

export type StudioRuntimeEdgeState = {
  active: boolean;
  error: boolean;
  loopBack: boolean;
};

export type StudioRuntimeVisualState = {
  hasRuntimeSignals: boolean;
  nodeStates: Map<string, StudioRuntimeNodeState>;
  edgeStates: Map<string, StudioRuntimeEdgeState>;
  activeNodeCount: number;
  waitingReviewCount: number;
  activeEdgeCount: number;
};

const STATUS_MATCHERS: Array<{
  status: NonNullable<StudioRuntimeNodeState["status"]>;
  patterns: RegExp[];
}> = [
  {
    status: "waiting_review",
    patterns: [/^waiting[_ ]review$/i, /^awaiting review$/i, /^等待评审$/, /^等待审核$/, /^待评审$/, /^待审核$/]
  },
  {
    status: "running",
    patterns: [/^running$/i, /^active$/i, /^执行中$/, /^运行中$/, /^活跃$/]
  },
  {
    status: "done",
    patterns: [/^done$/i, /^completed?$/i, /^完成$/, /^已完成$/]
  },
  {
    status: "failed",
    patterns: [/^failed$/i, /^error$/i, /^失败$/, /^错误$/]
  },
  {
    status: "paused",
    patterns: [/^paused$/i, /^已暂停$/, /^暂停$/]
  },
  {
    status: "pending",
    patterns: [/^pending$/i, /^等待中$/, /^待处理$/, /^待执行$/]
  },
  {
    status: "idle",
    patterns: [/^idle$/i, /^空闲$/]
  }
];

const LOOP_PATTERNS = [
  /^(?:x|×)\s*(\d+)$/i,
  /^(?:loop|round|iteration)\s*[:x]?\s*(\d+)$/i,
  /^(?:循环|轮次|迭代)\s*[:x]?\s*(\d+)$/
];

function normalizeRuntimeBadge(value: unknown): string {
  return String(value ?? "").trim();
}

function matchRuntimeStatus(value: string): StudioRuntimeNodeState["status"] | undefined {
  if (!value) {
    return undefined;
  }
  for (const matcher of STATUS_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(value))) {
      return matcher.status;
    }
  }
  return undefined;
}

function parseLoopCount(value: string): number | undefined {
  for (const pattern of LOOP_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return undefined;
}

function isLikelyErrorCode(value: string): boolean {
  if (!value || matchRuntimeStatus(value)) {
    return false;
  }
  return /^[A-Z][A-Z0-9_.:-]{2,}$/.test(value);
}

function runtimeBadges(node: Pick<GraphViewModelNode, "badges">): {
  status?: StudioRuntimeNodeState["status"];
  statusLabel?: string;
  errorCode?: string;
  loopCount?: number;
  remaining: string[];
} {
  const remaining: string[] = [];
  let status: StudioRuntimeNodeState["status"];
  let statusLabel: string | undefined;
  let errorCode: string | undefined;
  let loopCount: number | undefined;
  for (const badge of node.badges || []) {
    const value = normalizeRuntimeBadge(badge);
    if (!value) {
      continue;
    }
    const matchedStatus = matchRuntimeStatus(value);
    if (matchedStatus && !status) {
      status = matchedStatus;
      statusLabel = value;
      continue;
    }
    const matchedLoopCount = parseLoopCount(value);
    if (matchedLoopCount && !loopCount) {
      loopCount = matchedLoopCount;
      continue;
    }
    if (isLikelyErrorCode(value) && !errorCode) {
      errorCode = value;
      continue;
    }
    remaining.push(value);
  }
  return { status, statusLabel, errorCode, loopCount, remaining };
}

export function formatStudioRuntimeNodeBadges(node: Pick<GraphViewModelNode, "badges">): string[] {
  const parsed = runtimeBadges(node);
  const badges: string[] = [];
  if (parsed.statusLabel) {
    badges.push(parsed.statusLabel);
  }
  if (parsed.loopCount && parsed.loopCount > 1) {
    badges.push(`x${parsed.loopCount}`);
  }
  if (parsed.errorCode) {
    badges.push(parsed.errorCode);
  }
  for (const badge of parsed.remaining) {
    if (!badges.includes(badge)) {
      badges.push(badge);
    }
  }
  return badges;
}

export function deriveStudioRuntimeNodeState(args: {
  node: GraphViewModelNode;
  authoring?: StudioAuthoringDocument | null;
}): StudioRuntimeNodeState {
  const parsed = runtimeBadges(args.node);
  const humanGateConfigured = Boolean(args.node.structure.review ?? args.authoring?.roles?.[args.node.roleId]?.review);
  const status = matchRuntimeStatus(String(args.node.runtime?.status ?? parsed.status ?? ""));
  return {
    status,
    statusLabel: String(args.node.runtime?.status ?? parsed.statusLabel ?? ""),
    errorCode: args.node.runtime?.lastErrorCode ?? parsed.errorCode,
    loopCount: args.node.runtime?.loopIteration ?? parsed.loopCount,
    humanGateConfigured,
    waitingReview: status === "waiting_review",
    active: status === "active" || status === "running" || status === "waiting_review" || status === "paused" || status === "pending"
  };
}

export function deriveStudioRuntimeEdgeState(args: {
  edge: GraphViewModelEdge;
  readOnly?: boolean;
}): StudioRuntimeEdgeState {
  return {
    active: Boolean(args.readOnly && args.edge.runtime?.recentlyActivated === true),
    error: Boolean(args.edge.runtimeOnlyErrorFlow || args.edge.diagnostic?.severity === "error"),
    loopBack: args.edge.source === args.edge.target
  };
}

export function deriveStudioRuntimeVisualState(args: {
  authoring?: StudioAuthoringDocument | null;
  viewModel: GraphViewModel;
  readOnly?: boolean;
}): StudioRuntimeVisualState {
  const nodeStates = new Map<string, StudioRuntimeNodeState>();
  const edgeStates = new Map<string, StudioRuntimeEdgeState>();
  let activeNodeCount = 0;
  let waitingReviewCount = 0;
  let activeEdgeCount = 0;

  for (const node of args.viewModel.nodes) {
    const state = deriveStudioRuntimeNodeState({ node, authoring: args.authoring });
    nodeStates.set(node.id, state);
    if (state.active) {
      activeNodeCount += 1;
    }
    if (state.waitingReview) {
      waitingReviewCount += 1;
    }
  }

  for (const edge of args.viewModel.edges) {
    const state = deriveStudioRuntimeEdgeState({ edge, readOnly: args.readOnly });
    edgeStates.set(edge.id, state);
    if (state.active) {
      activeEdgeCount += 1;
    }
  }

  const hasRuntimeSignals = activeNodeCount > 0
    || waitingReviewCount > 0
    || activeEdgeCount > 0
    || Array.from(nodeStates.values()).some((state) => Boolean(state.errorCode))
    || Array.from(nodeStates.values()).some((state) => Boolean(state.humanGateConfigured))
    || Array.from(nodeStates.values()).some((state) => Boolean(state.loopCount && state.loopCount > 1));

  return {
    hasRuntimeSignals,
    nodeStates,
    edgeStates,
    activeNodeCount,
    waitingReviewCount,
    activeEdgeCount
  };
}
