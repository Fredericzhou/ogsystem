/**
 * @fileoverview Projects audit trail entries into UI-friendly stage snapshots.
 * File Set: runtime-observability
 * Responsibilities:
 * - Map ordered audit records to RUNNING/TERMINAL/FAILED stages.
 * Boundaries:
 * - Read-only projection; does not affect runtime state.
 */
import type { AuditRecord, StageSnapshot } from "./types.js";

export function projectStages(args: {
  auditTrail: AuditRecord[];
}): StageSnapshot[] {
  const stages: StageSnapshot[] = [];
  const terminalIndex = args.auditTrail.length - 1;
  for (let index = 0; index < args.auditTrail.length; index += 1) {
    const record = args.auditTrail[index];
    const phase: StageSnapshot["phase"] =
      record.status === "failed" ? "FAILED" : index === terminalIndex ? "TERMINAL" : "RUNNING";

    stages.push({
      stageId: `stage.${index + 1}`,
      at: record.at,
      phase,
      roleId: record.roleId,
      selectedEvent: record.selectedEvent,
      nextRoleId: record.nextRoleId,
      notes: record.error
    });
  }
  return stages;
}
