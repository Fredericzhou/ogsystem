import type { Cell } from "@antv/x6";

import type { GraphViewModelNode } from "../studio-contracts.js";
import { STUDIO_SYSTEM_END_ROLE_ID, STUDIO_SYSTEM_START_ROLE_ID } from "../studio-contracts.js";

export function isStudioRoleCell(cell: Cell | null | undefined): boolean {
  const data = cell?.getData() as { studioNode?: GraphViewModelNode } | undefined;
  return data?.studioNode?.roleSeat === true;
}

export function isStudioBoundaryCell(cell: Cell | null | undefined): boolean {
  const data = cell?.getData() as { studioNode?: GraphViewModelNode } | undefined;
  return data?.studioNode?.kind === "specialRole";
}

export function validateStudioConnectionCells(source: Cell | null | undefined, target: Cell | null | undefined): {
  ok: boolean;
  code:
    | "missing-endpoint"
    | "same-cell"
    | "source-boundary"
    | "source-invalid"
    | "target-boundary"
    | "target-invalid"
    | "";
} {
  if (!source || !target) {
    return { ok: false, code: "missing-endpoint" };
  }
  if (source.id === target.id) {
    return { ok: false, code: "same-cell" };
  }
  const sourceSpecial = isStudioBoundaryCell(source);
  const targetSpecial = isStudioBoundaryCell(target);
  if (sourceSpecial && targetSpecial) {
    return { ok: false, code: "target-invalid" };
  }
  if (sourceSpecial && source.id !== STUDIO_SYSTEM_START_ROLE_ID) {
    return { ok: false, code: "source-boundary" };
  }
  if (!sourceSpecial && !isStudioRoleCell(source)) {
    return { ok: false, code: "source-invalid" };
  }
  if (targetSpecial) {
    return target.id === STUDIO_SYSTEM_END_ROLE_ID
      ? { ok: true, code: "" }
      : { ok: false, code: "target-boundary" };
  }
  if (!targetSpecial && !isStudioRoleCell(target)) {
    return { ok: false, code: "target-invalid" };
  }
  return { ok: true, code: "" };
}

export function canConnectStudioCells(source: Cell | null | undefined, target: Cell | null | undefined): boolean {
  return validateStudioConnectionCells(source, target).ok;
}
