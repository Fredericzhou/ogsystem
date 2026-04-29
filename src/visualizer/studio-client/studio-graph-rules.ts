import type { Cell } from "@antv/x6";

import type { StudioGraphProjectionNode } from "../studio-contracts.js";

export function isStudioRoleCell(cell: Cell | null | undefined): boolean {
  const data = cell?.getData() as { studioNode?: StudioGraphProjectionNode } | undefined;
  return data?.studioNode?.kind === "role";
}

export function isStudioBoundaryCell(cell: Cell | null | undefined): boolean {
  const data = cell?.getData() as { studioNode?: StudioGraphProjectionNode } | undefined;
  return data?.studioNode?.kind === "boundary";
}

export function canConnectStudioCells(source: Cell | null | undefined, target: Cell | null | undefined): boolean {
  if (!source || !target || source.id === target.id) {
    return false;
  }
  if (!isStudioRoleCell(source)) {
    return false;
  }
  return isStudioRoleCell(target) || target.id === "output";
}
