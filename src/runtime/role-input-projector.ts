import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import {
  findRoleResult,
  getBranchResult
} from "./graph-runtime-state.js";
import { createRuntimeError } from "./runtime-errors.js";
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
  allowed_events: string;
  user_preferences: string;
  task: string;
  input: string;
};

function getDirectContext(state: GraphState, branch: BranchRecord): string {
  if (!branch.parentBranchId) {
    return state.userPrompt;
  }
  const upstream = getBranchResult(state, branch.parentBranchId);
  return upstream?.content ?? state.userPrompt;
}

function renderJoinContext(args: {
  state: GraphState;
  joinSources: string[];
  branch: BranchRecord;
}): string {
  const namespace = Object.fromEntries(args.joinSources.map((sourceRoleId) => {
    const result = findRoleResult({
      state: args.state,
      roleId: sourceRoleId,
      lineageId: args.branch.lineageId,
      loopIteration: args.branch.loopIteration
    });
    const artifact: Record<string, unknown> = {};
    if (result?.event) {
      artifact.event = result.event;
    }
    if (result?.content !== undefined) {
      artifact.content = result.content;
    }
    if (result?.data !== undefined) {
      artifact.data = result.data;
    }
    return [sourceRoleId, artifact];
  }));
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
}): unknown {
  let current = args.value;
  for (const segment of args.path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
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
  field: "content" | "event" | "data";
  selector: string;
  roleId: string;
  branchId: string;
}): unknown {
  const value = args.artifact[args.field];
  if (value === undefined) {
    failContextProjection({
      errorCode: "ROLE_CONTEXT_PATH_MISSING",
      message: `Role "${args.roleId}" selector "${args.selector}" is missing required field "${args.field}".`,
      roleId: args.roleId,
      branchId: args.branchId
    });
  }
  return value;
}

function getRequiredDirectArtifact(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
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
  return upstream;
}

function getRequiredJoinSourceArtifact(args: {
  state: GraphState;
  branch: BranchRecord;
  roleId: string;
  node: ExecutionPlanNode;
  sourceRoleId: string;
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
  return result;
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

function evaluateContextSelector(args: {
  selector: string;
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
}): unknown {
  const selector = args.selector;
  if (selector === "global.task") {
    return args.state.userPrompt;
  }
  if (selector === "global.user_profile") {
    if (!args.userProfile) {
      failContextProjection({
        errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
        message: `Role "${args.roleId}" selector "${selector}" requires user_profile input.`,
        roleId: args.roleId,
        branchId: args.branch.branchId
      });
    }
    return args.userProfile;
  }
  if (selector.startsWith("global.user_profile.")) {
    if (!args.userProfile) {
      failContextProjection({
        errorCode: "ROLE_CONTEXT_SOURCE_UNAVAILABLE",
        message: `Role "${args.roleId}" selector "${selector}" requires user_profile input.`,
        roleId: args.roleId,
        branchId: args.branch.branchId
      });
    }
    return resolveObjectPath({
      value: args.userProfile,
      path: selector.slice("global.user_profile.".length).split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  if (selector === "global.human_review.current") {
    return getRequiredHumanReviewContext({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    });
  }
  if (selector === "global.human_review.current.comment") {
    return getRequiredHumanReviewContext({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    }).comment;
  }
  if (selector === "global.human_review.current.round") {
    return getRequiredHumanReviewContext({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    }).round;
  }
  if (selector === "global.human_review.current.previous_output") {
    return getRequiredHumanReviewContext({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    }).previousOutput;
  }
  if (selector.startsWith("global.human_review.current.previous_output.")) {
    const context = getRequiredHumanReviewContext({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    });
    return resolveObjectPath({
      value: context.previousOutput,
      path: selector.slice("global.human_review.current.previous_output.".length).split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  if (selector === "direct.content" || selector === "direct.event" || selector === "direct.data") {
    const artifact = getRequiredDirectArtifact({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    });
    return resolveArtifactField({
      artifact,
      field: selector.slice("direct.".length) as "content" | "event" | "data",
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  if (selector.startsWith("direct.data.")) {
    const artifact = getRequiredDirectArtifact({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId
    });
    return resolveObjectPath({
      value: resolveArtifactField({
        artifact,
        field: "data",
        selector,
        roleId: args.roleId,
        branchId: args.branch.branchId
      }),
      path: selector.slice("direct.data.".length).split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
  }

  const sourceMatch = selector.match(/^source\(([A-Za-z0-9._:-]+)\)\.(content|event|data)(?:\.(.+))?$/);
  if (sourceMatch) {
    const [, sourceRoleId, field, nestedPath] = sourceMatch;
    const artifact = getRequiredJoinSourceArtifact({
      state: args.state,
      branch: args.branch,
      roleId: args.roleId,
      node: args.node,
      sourceRoleId
    });
    const fieldValue = resolveArtifactField({
      artifact,
      field: field as "content" | "event" | "data",
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
    });
    if (!nestedPath) {
      return fieldValue;
    }
    return resolveObjectPath({
      value: fieldValue,
      path: nestedPath.split("."),
      selector,
      roleId: args.roleId,
      branchId: args.branch.branchId
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
}): Record<string, unknown> {
  const sortedEntries = Object.entries(args.node.contextMap ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return Object.fromEntries(sortedEntries.map(([fieldName, selector]) => [
    fieldName,
    evaluateContextSelector({
      selector,
      roleId: args.roleId,
      node: args.node,
      branch: args.branch,
      state: args.state,
      userProfile: args.userProfile
    })
  ]));
}

function renderProjectedContext(args: {
  roleId: string;
  node: ExecutionPlanNode;
  branch: BranchRecord;
  state: GraphState;
  userProfile?: UserProfile;
}): string {
  return stringifyJson(
    buildProjectedContext({
      roleId: args.roleId,
      node: args.node,
      branch: args.branch,
      state: args.state,
      userProfile: args.userProfile
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
}): RolePromptInput {
  const allowedEvents = getSelectableOutgoingFlows(args.node).map((item) => item.eventType);
  const hasContextMap = Boolean(args.node.contextMap && Object.keys(args.node.contextMap).length > 0);
  const context =
    hasContextMap
      ? renderProjectedContext(args)
      : args.node.joinMode
        ? renderJoinContext({
            state: args.state,
            joinSources: args.node.joinSources,
            branch: args.branch
          })
        : getDirectContext(args.state, args.branch);

  return {
    allowed_events: JSON.stringify(allowedEvents),
    user_preferences: renderUserProfile(args.userProfile),
    task: args.state.userPrompt,
    input: context
  };
}
