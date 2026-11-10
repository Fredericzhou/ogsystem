import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import {
  findRoleResult,
  getBranchResult
} from "./graph-runtime-state.js";
import { createRuntimeError } from "./runtime-errors.js";
import { buildAllowedArtifactSet, createArtifactResolver, type ArtifactAccessAudit } from "./artifact-access.js";
import { renderUserProfile, stringifyJson } from "./runtime-support.js";
import type {
  BranchRecord,
  ExecutionPlanNode,
  Flow,
  GraphState,
  StoredRoleResult,
  UserProfile
} from "./types.js";

export type RolePromptInput = {
  role_id?: string;
  mode?: string;
  allowed_events: string;
  user_preferences: string;
  task: string;
  input: string;
};

function getDirectContext(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): string {
  if (!args.branch.parentBranchId) {
    return args.state.userPrompt;
  }
  const upstream = getBranchResult(args.state, args.branch.parentBranchId);
  const authorized = upstream
    ? authorizeArtifact({
        artifact: upstream,
        roleId: args.roleId,
        branchId: args.branch.branchId,
        state: args.state,
        allowedArtifacts: [upstream],
        onArtifactAccessAudit: args.onArtifactAccessAudit
      })
    : undefined;
  return authorized?.content ?? args.state.userPrompt;
}

function renderJoinContext(args: {
  state: GraphState;
  joinSources: string[];
  branch: BranchRecord;
  roleId: string;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): string {
  // Join authorization is fixed when the target branch is activated. Do not
  // derive it from whichever source results happen to be visible at prompt
  // rendering time, otherwise a role could self-authorize a late artifact.
  const allowedArtifactIds = new Set(args.state.artifactAllowedByBranchId?.[args.branch.branchId] ?? []);
  const resolver = createArtifactResolver(Object.values(args.state.roleResults));
  const namespaceEntries = args.joinSources.flatMap((sourceRoleId) => {
    const result = findRoleResult({
      state: args.state,
      roleId: sourceRoleId,
      lineageId: args.branch.lineageId,
      loopIteration: args.branch.loopIteration
    });
    if (!result) return [];
    // A quorum branch may observe a source that arrived after activation. It
    // remains outside the persisted invocation allow-set and is omitted from
    // the aggregate context; explicit source(...) selectors still fail closed
    // through authorizeArtifact below.
    if (result.artifactRef && !allowedArtifactIds.has(result.artifactRef.artifactId)) return [];
    const authorized = result.artifactRef
      ? resolver.resolve(result.artifactRef, {
          consumerRoleId: args.roleId,
          allowedArtifactIds,
          audit: args.onArtifactAccessAudit
        })
      : result;
    const artifact: Record<string, unknown> = {};
    if (authorized?.event) {
      artifact.event = authorized.event;
    }
    if (authorized?.content !== undefined) {
      artifact.content = authorized.content;
    }
    if (authorized?.data !== undefined) {
      artifact.data = authorized.data;
    }
    return [[sourceRoleId, artifact] as const];
  });
  const namespace = Object.fromEntries(namespaceEntries);
  return stringifyJson(namespace);
}

export function failContextProjection(args: {
  errorCode: string;
  message: string;
  roleId: string;
  branchId: string;
}): never {
  throw createRuntimeError({
    errorCode: args.errorCode,
    errorCategory: "state",
    message: args.message,
    retryable: false,
    stage: "execute",
    roleId: args.roleId,
    branchId: args.branchId
  });
}

function resolveObjectPath(args: {
  value: unknown;
  path: string[];
  selector: string;
  roleId: string;
  branchId: string;
  optional?: boolean;
}): unknown {
  let current = args.value;
  for (const segment of args.path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      if (args.optional) return undefined;
      failContextProjection({
        errorCode: "ROLE_CONTEXT_PATH_MISSING",
        message: `Role "${args.roleId}" selector "${args.selector}" is missing required path "${segment}".`,
        roleId: args.roleId,
        branchId: args.branchId
      });
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveArtifactField(args: {
  artifact: StoredRoleResult;
  field: "content" | "event" | "data" | "artifactRef";
  selector: string;
  roleId: string;
  branchId: string;
  optional?: boolean;
}): unknown {
  const value = args.field === "artifactRef" ? args.artifact.artifactRef : args.artifact[args.field];
  if (value === undefined) {
    if (args.optional) return undefined;
    failContextProjection({
      errorCode: "ROLE_CONTEXT_PATH_MISSING",
      message: `Role "${args.roleId}" selector "${args.selector}" is missing required field "${args.field}".`,
      roleId: args.roleId,
      branchId: args.branchId
    });
  }
  return value;
}

function authorizeArtifact(args: {
  artifact: StoredRoleResult;
  roleId: string;
  branchId: string;
  state: GraphState;
  allowedArtifacts: Iterable<StoredRoleResult | undefined>;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): StoredRoleResult {
  if (!args.artifact.artifactRef) return args.artifact;
  const resolver = createArtifactResolver(Object.values(args.state.roleResults));
  const allowedArtifactIds = args.state.artifactAllowedByBranchId
    ? new Set(args.state.artifactAllowedByBranchId[args.branchId] ?? [])
    : buildAllowedArtifactSet(args.allowedArtifacts);
  return resolver.resolve(args.artifact.artifactRef, {
    consumerRoleId: args.roleId,
    allowedArtifactIds,
    audit: args.onArtifactAccessAudit
  });
}

function getRequiredDirectArtifact(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): StoredRoleResult {
  if (!args.branch.parentBranchId) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
      message: `Role "${args.roleId}" cannot resolve direct.* selector without an upstream branch.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  const upstream = getBranchResult(args.state, args.branch.parentBranchId);
  if (!upstream) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
      message: `Role "${args.roleId}" requires an upstream result for direct.* selector evaluation.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  return authorizeArtifact({
    artifact: upstream,
    roleId: args.roleId,
    branchId: args.branch.branchId,
    state: args.state,
    allowedArtifacts: [upstream],
    onArtifactAccessAudit: args.onArtifactAccessAudit
  });
}

function getRequiredJoinSourceArtifact(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
  node: ExecutionPlanNode;
  sourceRoleId: string;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): StoredRoleResult {
  if (!args.node.joinMode) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SELECTOR_UNAUTHORIZED",
      message: `Role "${args.roleId}" cannot use source(...) selectors without join.mode.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  if (!args.node.joinSources.includes(args.sourceRoleId)) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SELECTOR_UNAUTHORIZED",
      message:
        `Role "${args.roleId}" selector source("${args.sourceRoleId}") is not declared in join.sources.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  const result = findRoleResult({
    state: args.state,
    roleId: args.sourceRoleId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration
  });
  if (!result) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
      message:
        `Role "${args.roleId}" selector source("${args.sourceRoleId}") is not available for the current lineage and loop iteration.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  const allowedArtifacts = args.node.joinSources.map((sourceRoleId) => findRoleResult({
    state: args.state,
    roleId: sourceRoleId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration
  }));
  return authorizeArtifact({
    artifact: result,
    roleId: args.roleId,
    branchId: args.branch.branchId,
    state: args.state,
    allowedArtifacts,
    onArtifactAccessAudit: args.onArtifactAccessAudit
  });
}

function getOptionalJoinSourceArtifact(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
  node: ExecutionPlanNode;
  sourceRoleId: string;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): StoredRoleResult | undefined {
  if (!args.node.joinMode) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SELECTOR_UNAUTHORIZED",
      message: `Role "${args.roleId}" cannot use source(...) selectors without join.mode.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  if (!args.node.joinSources.includes(args.sourceRoleId)) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SELECTOR_UNAUTHORIZED",
      message: `Role "${args.roleId}" selector source("${args.sourceRoleId}") is not declared in join.sources.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  const result = findRoleResult({
    state: args.state,
    roleId: args.sourceRoleId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration
  });
  if (!result) return result;
  // A quorum branch freezes its invocation allow-set when the threshold is
  // reached. Sources that arrive after activation are valid run history but
  // are outside this invocation and must be omitted by optional selectors;
  // required selectors still fail closed through authorizeArtifact.
  if (result.artifactRef) {
    const persistedAllowSet = args.state.artifactAllowedByBranchId;
    if (persistedAllowSet && Object.hasOwn(persistedAllowSet, args.branch.branchId)) {
      const allowedArtifactIds = new Set(persistedAllowSet[args.branch.branchId] ?? []);
      if (!allowedArtifactIds.has(result.artifactRef.artifactId)) return undefined;
    }
  }
  const allowedArtifacts = args.node.joinSources.map((sourceRoleId) => findRoleResult({
    state: args.state,
    roleId: sourceRoleId,
    lineageId: args.branch.lineageId,
    loopIteration: args.branch.loopIteration
  }));
  return authorizeArtifact({
    artifact: result,
    roleId: args.roleId,
    branchId: args.branch.branchId,
    state: args.state,
    allowedArtifacts,
    onArtifactAccessAudit: args.onArtifactAccessAudit
  });
}

function getRequiredHumanReviewContext(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
}): NonNullable<GraphState["humanReviewContextByBranchId"][string]> {
  const context = args.state.humanReviewContextByBranchId[args.branch.branchId];
  if (!context) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
      message:
        `Role "${args.roleId}" selector requires human review context, but branch "${args.branch.branchId}" has none.`,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }
  return context;
}

function getOptionalHumanReviewContext(args: {
  state: GraphState;
  branch: BranchRecord;
}): NonNullable<GraphState["humanReviewContextByBranchId"][string]> | undefined {
  return args.state.humanReviewContextByBranchId[args.branch.branchId];
}

function evaluateContextSelector(args: {
  selector: string;
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): unknown {
  const selector = args.selector;
  const optional = selector.endsWith("?");
  const normalizedSelector = optional ? selector.slice(0, -1) : selector;
  if (normalizedSelector === "global.task") {
    return args.state.userPrompt;
  }
  if (normalizedSelector === "global.user_profile") {
    if (!args.userProfile) {
      failContextProjection({
        errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
        message: `Role "${args.roleId}" selector "${normalizedSelector}" requires user_profile input.`,
        roleId: args.roleId,
        branchId: args.branch.branchId
      });
    }
    return args.userProfile;
  }
  if (normalizedSelector.startsWith("global.user_profile.")) {
    if (!args.userProfile) {
      failContextProjection({
        errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
        message: `Role "${args.roleId}" selector "${normalizedSelector}" requires user_profile input.`,
        roleId: args.roleId,
        branchId: args.branch.branchId
      });
    }
    return resolveObjectPath({
      value: args.userProfile,
      path: normalizedSelector.slice("global.user_profile.".length).split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  if (normalizedSelector.startsWith("global.human_review.current")) {
    const humanReviewContext = optional
      ? getOptionalHumanReviewContext({
          state: args.state,
          branch: args.branch
        })
      : getRequiredHumanReviewContext({
          state: args.state,
          branch: args.branch,
          roleId: args.roleId
        });

    if (normalizedSelector === "global.human_review.current") {
      return humanReviewContext;
    }
    if (normalizedSelector === "global.human_review.current.comment") {
      return humanReviewContext?.comment;
    }
    if (normalizedSelector === "global.human_review.current.round") {
      return humanReviewContext?.round;
    }
    if (normalizedSelector === "global.human_review.current.previous_output") {
      return humanReviewContext?.previousOutput;
    }
    if (normalizedSelector.startsWith("global.human_review.current.previous_output.")) {
      if (!humanReviewContext) {
        return undefined;
      }
      return resolveObjectPath({
        value: humanReviewContext.previousOutput,
        path: normalizedSelector.slice("global.human_review.current.previous_output.".length).split("."),
        selector,
        roleId: args.roleId,
        branchId: args.branch.branchId
      });
    }
  }

  if (normalizedSelector === "direct.content" || normalizedSelector === "direct.event" || normalizedSelector === "direct.data" || normalizedSelector === "direct.artifact") {
    const rawArtifact = optional
      ? args.branch.parentBranchId ? getBranchResult(args.state, args.branch.parentBranchId) : undefined
      : getRequiredDirectArtifact({
          state: args.state,
          branch: args.branch,
          roleId: args.roleId,
          onArtifactAccessAudit: args.onArtifactAccessAudit
        });
    if (!rawArtifact) return undefined;
    const artifact = optional
      ? authorizeArtifact({
          artifact: rawArtifact,
          roleId: args.roleId,
          branchId: args.branch.branchId,
          state: args.state,
          allowedArtifacts: [rawArtifact],
          onArtifactAccessAudit: args.onArtifactAccessAudit
        })
      : rawArtifact;
    return resolveArtifactField({
      artifact,
      field: normalizedSelector === "direct.artifact"
        ? "artifactRef"
        : normalizedSelector.slice("direct.".length) as "content" | "event" | "data",
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId,
      optional
    });
  }

  if (normalizedSelector.startsWith("direct.data.")) {
    const rawArtifact = optional
      ? args.branch.parentBranchId
        ? getBranchResult(args.state, args.branch.parentBranchId)
        : undefined
        : getRequiredDirectArtifact({ state: args.state, branch: args.branch, roleId: args.roleId, onArtifactAccessAudit: args.onArtifactAccessAudit });
    const artifact = rawArtifact
      ? authorizeArtifact({
          artifact: rawArtifact,
          roleId: args.roleId,
          branchId: args.branch.branchId,
          state: args.state,
          allowedArtifacts: [rawArtifact],
          onArtifactAccessAudit: args.onArtifactAccessAudit
        })
      : undefined;
    if (!artifact) return undefined;
    const data = resolveArtifactField({
      artifact,
      field: "data",
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId,
      optional
    });
    if (data === undefined) return undefined;
    return resolveObjectPath({
      value: data,
      path: normalizedSelector.slice("direct.data.".length).split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId,
      optional
    });
  }

  const sourceMatch = normalizedSelector.match(/^source\(([A-Za-z0-9._:-]+)\)\.(content|event|data|artifact)(?:\.(.+))?$/);
  if (sourceMatch) {
    const [, sourceRoleId, field, nestedPath] = sourceMatch;
    const artifact = optional
      ? getOptionalJoinSourceArtifact({ state: args.state, branch: args.branch, roleId: args.roleId, node: args.node, sourceRoleId, onArtifactAccessAudit: args.onArtifactAccessAudit })
      : getRequiredJoinSourceArtifact({ state: args.state, branch: args.branch, roleId: args.roleId, node: args.node, sourceRoleId, onArtifactAccessAudit: args.onArtifactAccessAudit });
    if (!artifact) return undefined;
    const fieldValue = sourceMatch[2] === "artifact"
      ? resolveArtifactField({
          artifact,
          field: "artifactRef",
          selector,
          roleId: args.roleId,
          branchId: args.branch.branchId,
          optional
        })
      : resolveArtifactField({
          artifact,
          field: field as "content" | "event" | "data",
          selector,
          roleId: args.roleId,
          branchId: args.branch.branchId,
          optional
      });
    if (!nestedPath) {
      return fieldValue;
    }
    return resolveObjectPath({
      value: fieldValue,
      path: nestedPath.split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId,
      optional
    });
  }

  failContextProjection({
    errorCode: "ROLE_CONTEXT_SELECTOR_UNSUPPORTED",
    message: `Role "${args.roleId}" uses unsupported context selector "${selector}".`,
    roleId: args.roleId,
    branchId: args.branch.branchId
  });
}

export function buildProjectedContext(args: {
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): Record<string, unknown> {
  const sortedEntries = Object.entries(args.node.contextMap ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return Object.fromEntries(
    sortedEntries
      .map(([fieldName, selector]) => [
        fieldName,
        evaluateContextSelector({
          selector,
          roleId: args.roleId,
          node: args.node,
          branch: args.branch,
          state: args.state,
          userProfile: args.userProfile,
          onArtifactAccessAudit: args.onArtifactAccessAudit
        })
      ])
      .filter(([, value]) => value !== undefined)
  );
}

function renderProjectedContext(args: {
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): string {
  return stringifyJson(
    buildProjectedContext({
      roleId: args.roleId,
      node: args.node,
      branch: args.branch,
      state: args.state,
      userProfile: args.userProfile,
      onArtifactAccessAudit: args.onArtifactAccessAudit
    })
  );
}

export function getSelectableOutgoingFlows(node: ExecutionPlanNode): Flow[] {
  return node.outgoing.filter((flow) => !isRuntimeOnlyErrorEvent(flow.eventType));
}

const ROLE_INPUT_CONTEXT_MAX_CHARS = 800;

export function sanitizeRoleInputContext(value: string): string {
  const redacted = value.replace(
    /\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
    "$1=<redacted>"
  );
  if (redacted.length <= ROLE_INPUT_CONTEXT_MAX_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, ROLE_INPUT_CONTEXT_MAX_CHARS)}...`;
}

export function buildRolePromptInput(args: {
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
  onArtifactAccessAudit?: (audit: ArtifactAccessAudit) => void;
}): RolePromptInput {
  const outgoingEvents = getSelectableOutgoingFlows(args.node).map((item) => item.eventType);
  const allowedEvents = args.node.modeAllowedEvents
    ? outgoingEvents.filter((event) => args.node.modeAllowedEvents?.includes(event))
    : outgoingEvents;
  const hasContextMap = Boolean(args.node.contextMap && Object.keys(args.node.contextMap).length > 0);
  const context =
    hasContextMap
      ? renderProjectedContext(args)
      : args.node.joinMode
        ? renderJoinContext({
            state: args.state,
            joinSources: args.node.joinSources,
            branch: args.branch,
            roleId: args.roleId,
            onArtifactAccessAudit: args.onArtifactAccessAudit
          })
        : getDirectContext({
            state: args.state,
            branch: args.branch,
            roleId: args.roleId,
            onArtifactAccessAudit: args.onArtifactAccessAudit
          });

  return {
    role_id: args.roleId,
    ...(args.node.executionMode ? { mode: args.node.executionMode } : {}),
    allowed_events: JSON.stringify(allowedEvents),
    user_preferences: renderUserProfile(args.userProfile),
    task: args.state.userPrompt,
    input: context
  };
}
