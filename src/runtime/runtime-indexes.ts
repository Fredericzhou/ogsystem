import type { GraphState, GraphStateUpdate, StoredRoleResult } from "./types.js";

export type RuntimeIndexes = {
  branchById: Map<string, GraphState["branchRecords"][string]>;
  activeBranchIdsByRoleId: Map<string, string[]>;
  resultByRoleLineageLoopKey: Map<string, StoredRoleResult>;
};

export function buildRoleLineageLoopKey(args: {
  roleId: string;
  lineageId: string;
  loopIteration: number;
}): string {
  return `${args.roleId}::${args.lineageId}::${args.loopIteration}`;
}

function sortBranchIdsBySequence(
  branchIds: string[],
  branchById: Map<string, GraphState["branchRecords"][string]>
): string[] {
  return branchIds.sort((left, right) => {
    const leftBranch = branchById.get(left);
    const rightBranch = branchById.get(right);
    return (leftBranch?.branchSequence ?? 0) - (rightBranch?.branchSequence ?? 0);
  });
}

export function buildRuntimeIndexes(state: GraphState): RuntimeIndexes {
  const branchById = new Map(Object.entries(state.branchRecords));
  const activeBranchIdsByRoleId = new Map<string, string[]>();
  const resultByRoleLineageLoopKey = new Map<string, StoredRoleResult>();

  for (const [branchId, branch] of Object.entries(state.branchRecords)) {
    if (branch.status !== "active") {
      continue;
    }
    const branchIds = activeBranchIdsByRoleId.get(branch.roleId) ?? [];
    branchIds.push(branchId);
    activeBranchIdsByRoleId.set(branch.roleId, branchIds);
  }

  for (const branchIds of activeBranchIdsByRoleId.values()) {
    sortBranchIdsBySequence(branchIds, branchById);
  }

  for (const result of Object.values(state.roleResults)) {
    resultByRoleLineageLoopKey.set(
      buildRoleLineageLoopKey({
        roleId: result.roleId,
        lineageId: result.lineageId,
        loopIteration: result.loopIteration
      }),
      result
    );
  }

  return {
    branchById,
    activeBranchIdsByRoleId,
    resultByRoleLineageLoopKey
  };
}

export function applyGraphUpdateToIndexes(indexes: RuntimeIndexes, update: GraphStateUpdate): RuntimeIndexes {
  for (const [branchId, branch] of Object.entries(update.branchRecords ?? {})) {
    indexes.branchById.set(branchId, branch);
    const current = indexes.activeBranchIdsByRoleId.get(branch.roleId) ?? [];
    const withoutBranch = current.filter((candidate) => candidate !== branchId);
    if (branch.status === "active") {
      withoutBranch.push(branchId);
      indexes.activeBranchIdsByRoleId.set(
        branch.roleId,
        sortBranchIdsBySequence(withoutBranch, indexes.branchById)
      );
    } else if (withoutBranch.length > 0) {
      indexes.activeBranchIdsByRoleId.set(
        branch.roleId,
        sortBranchIdsBySequence(withoutBranch, indexes.branchById)
      );
    } else {
      indexes.activeBranchIdsByRoleId.delete(branch.roleId);
    }
  }

  for (const result of Object.values(update.roleResults ?? {})) {
    indexes.resultByRoleLineageLoopKey.set(
      buildRoleLineageLoopKey({
        roleId: result.roleId,
        lineageId: result.lineageId,
        loopIteration: result.loopIteration
      }),
      result
    );
  }

  return indexes;
}
