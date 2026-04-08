import type { AuditRecord, StageSnapshot } from "./types.js";

export function projectStages(args: {
  auditTrail: AuditRecord[];
}): StageSnapshot[] {
  const stages: StageSnapshot[] = [];
  for (let index = 0; index < args.auditTrail.length; index += 1) {
    const record = args.auditTrail[index];
    const phase: StageSnapshot["phase"] =
      record.status === "failed" ? "FAILED" : record.nextRoleId ? "RUNNING" : "TERMINAL";

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
