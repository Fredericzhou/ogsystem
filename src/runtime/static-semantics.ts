import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type { Flow } from "./types.js";

const SELECTOR_PATH_SEGMENT_REGEX = /^[A-Za-z0-9_]+$/;

export type SelectorSummary = {
  selectorKind:
    | "global.task"
    | "global.user_profile"
    | "global.user_profile.path"
    | "global.human_review.current"
    | "global.human_review.current.comment"
    | "global.human_review.current.round"
    | "global.human_review.current.previous_output"
    | "global.human_review.current.previous_output.path"
    | "direct"
    | "direct.data.path"
    | "source"
    | "unsupported";
  sourceRoleId?: string;
  validPath: boolean;
  optional?: boolean;
};

function isValidSelectorPath(path: string): boolean {
  if (!path) {
    return false;
  }
  return path.split(".").every((segment) => SELECTOR_PATH_SEGMENT_REGEX.test(segment));
}

export function summarizeContextSelector(selector: string): SelectorSummary {
  const optional = selector.endsWith("?");
  const normalizedSelector = optional ? selector.slice(0, -1) : selector;

  if (optional && !normalizedSelector.startsWith("global.human_review.current")) {
    return {
      selectorKind: "unsupported",
      validPath: false,
      optional
    };
  }

  if (normalizedSelector === "global.task" || normalizedSelector === "global.user_profile") {
    return {
      selectorKind: normalizedSelector,
      validPath: true,
      optional
    };
  }
  if (normalizedSelector.startsWith("global.user_profile.")) {
    return {
      selectorKind: "global.user_profile.path",
      validPath: isValidSelectorPath(normalizedSelector.slice("global.user_profile.".length)),
      optional
    };
  }
  if (normalizedSelector === "global.human_review.current") {
    return {
      selectorKind: "global.human_review.current",
      validPath: true,
      optional
    };
  }
  if (normalizedSelector === "global.human_review.current.comment") {
    return {
      selectorKind: "global.human_review.current.comment",
      validPath: true,
      optional
    };
  }
  if (normalizedSelector === "global.human_review.current.round") {
    return {
      selectorKind: "global.human_review.current.round",
      validPath: true,
      optional
    };
  }
  if (normalizedSelector === "global.human_review.current.previous_output") {
    return {
      selectorKind: "global.human_review.current.previous_output",
      validPath: true,
      optional
    };
  }
  if (normalizedSelector.startsWith("global.human_review.current.previous_output.")) {
    return {
      selectorKind: "global.human_review.current.previous_output.path",
      validPath: isValidSelectorPath(
        normalizedSelector.slice("global.human_review.current.previous_output.".length)
      ),
      optional
    };
  }
  if (
    normalizedSelector === "direct.content" ||
    normalizedSelector === "direct.event" ||
    normalizedSelector === "direct.data"
  ) {
    return {
      selectorKind: "direct",
      validPath: true,
      optional
    };
  }
  if (normalizedSelector.startsWith("direct.data.")) {
    return {
      selectorKind: "direct.data.path",
      validPath: isValidSelectorPath(normalizedSelector.slice("direct.data.".length)),
      optional
    };
  }
  const sourceMatch = normalizedSelector.match(
    /^source\(([A-Za-z0-9._:-]+)\)\.(content|event|data|data\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/
  );
  if (sourceMatch) {
    return {
      selectorKind: "source",
      sourceRoleId: sourceMatch[1],
      validPath: true,
      optional
    };
  }
  return {
    selectorKind: "unsupported",
    validPath: false,
    optional
  };
}

export function collectCycleComponents(args: {
  roleIds: string[];
  flows: Flow[];
  includeRuntimeOnlyErrorEvents?: boolean;
}): string[][] {
  const roleSet = new Set(args.roleIds);
  const adjacency = new Map<string, string[]>(
    args.roleIds.map((roleId) => [roleId, [] as string[]])
  );
  for (const flow of args.flows) {
    if (flow.toRoleId === SYSTEM_END_ROLE_ID) {
      continue;
    }
    if (!args.includeRuntimeOnlyErrorEvents && isRuntimeOnlyErrorEvent(flow.eventType)) {
      continue;
    }
    if (!roleSet.has(flow.fromRoleId) || !roleSet.has(flow.toRoleId)) {
      continue;
    }
    adjacency.get(flow.fromRoleId)?.push(flow.toRoleId);
  }

  const indexByRoleId = new Map<string, number>();
  const lowLinkByRoleId = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let cursor = 0;

  const strongConnect = (roleId: string): void => {
    indexByRoleId.set(roleId, cursor);
    lowLinkByRoleId.set(roleId, cursor);
    cursor += 1;
    stack.push(roleId);
    onStack.add(roleId);

    for (const neighborRoleId of adjacency.get(roleId) ?? []) {
      if (!indexByRoleId.has(neighborRoleId)) {
        strongConnect(neighborRoleId);
        const roleLowLink = lowLinkByRoleId.get(roleId) ?? 0;
        const neighborLowLink = lowLinkByRoleId.get(neighborRoleId) ?? 0;
        lowLinkByRoleId.set(roleId, Math.min(roleLowLink, neighborLowLink));
      } else if (onStack.has(neighborRoleId)) {
        const roleLowLink = lowLinkByRoleId.get(roleId) ?? 0;
        const neighborIndex = indexByRoleId.get(neighborRoleId) ?? 0;
        lowLinkByRoleId.set(roleId, Math.min(roleLowLink, neighborIndex));
      }
    }

    if ((lowLinkByRoleId.get(roleId) ?? -1) !== (indexByRoleId.get(roleId) ?? -2)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const popped = stack.pop();
      if (!popped) {
        break;
      }
      onStack.delete(popped);
      component.push(popped);
      if (popped === roleId) {
        break;
      }
    }

    if (component.length > 1) {
      components.push(component);
      return;
    }
    const [single] = component;
    if (single && (adjacency.get(single) ?? []).includes(single)) {
      components.push(component);
    }
  };

  for (const roleId of args.roleIds) {
    if (!indexByRoleId.has(roleId)) {
      strongConnect(roleId);
    }
  }

  return components;
}
