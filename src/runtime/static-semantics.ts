import { isRuntimeOnlyErrorEvent } from "./error-flow-utils.js";
import { SYSTEM_END_ROLE_ID } from "./types.js";
import type { Flow } from "./types.js";
export { summarizeContextSelector } from "../context-selector.js";
export type { SelectorSummary } from "../context-selector.js";


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
