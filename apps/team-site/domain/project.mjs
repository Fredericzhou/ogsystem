import { ACTIVE_RUN_STATUSES } from "./contracts.mjs";

export function assertCollaborationProject(project) {
  if (project?.projectType !== "collaboration") {
    throw new Error("PROJECT_TYPE_INVALID: only collaboration projects can manage teams.");
  }
}

export function assertProjectHasTeams(teamVersionIds) {
  if (!Array.isArray(teamVersionIds) || !teamVersionIds.some((value) => String(value || "").trim())) {
    throw new Error("PROJECT_TEAM_REQUIRED: a collaboration project must have at least one team.");
  }
}

export function assertProjectTeamMutationAllowed(project) {
  const activeTask = (project?.taskRecords || []).find((task) => !task.deletedAt && ACTIVE_RUN_STATUSES.has(task.status));
  if (activeTask) throw new Error(`PROJECT_TEAM_UPDATE_LOCKED: active task ${activeTask.taskId} is ${activeTask.status}.`);
}
