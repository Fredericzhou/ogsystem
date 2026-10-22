import { ACTIVE_RUN_STATUSES } from "./contracts.mjs";

export function assertCollaborationProject(project) {
  if (project?.projectType !== "collaboration") {
    throw new Error("PROJECT_TYPE_INVALID: only collaboration projects can manage teams.");
  }
}

export function assertProjectHasSingleTeam(teamVersionIds) {
  const selected = Array.isArray(teamVersionIds) ? [...new Set(teamVersionIds.map((value) => String(value || "").trim()).filter(Boolean))] : [];
  if (selected.length !== 1) throw new Error("PROJECT_SINGLE_TEAM_REQUIRED: a collaboration project must use exactly one released TeamVersion.");
}

export function assertProjectTeamMutationAllowed(project) {
  const activeTask = (project?.taskRecords || []).find((task) => !task.deletedAt && ACTIVE_RUN_STATUSES.has(task.status));
  if (activeTask) throw new Error(`PROJECT_TEAM_UPDATE_LOCKED: active task ${activeTask.taskId} is ${activeTask.status}.`);
}
