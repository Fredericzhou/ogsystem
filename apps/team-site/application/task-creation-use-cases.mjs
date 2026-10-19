import { assertCollaborationProject } from "../domain/project.mjs";
import { assertCanonicalTeamVersionId } from "../domain/team.mjs";

export function createTaskCreationUseCases({ projectStore, taskStore, fingerprintRequest }) {
  if (typeof projectStore?.getProject !== "function"
    || typeof projectStore?.withProjectWriteLock !== "function"
    || typeof projectStore?.saveProjectMetadata !== "function") {
    throw new TypeError("Task creation requires Project read, lock, and persistence operations.");
  }
  if (typeof taskStore?.createTaskId !== "function" || typeof fingerprintRequest !== "function") {
    throw new TypeError("Task creation requires a Task ID generator and request fingerprint operation.");
  }

  return Object.freeze({
    async createProjectTask(projectId, { input, teamVersionId, idempotencyKey } = {}) {
      const taskInput = String(input || "").trim();
      if (!taskInput || taskInput.length > 4000) throw new Error("Task input must contain 1 to 4,000 characters.");
      const requestedTeamVersionId = String(teamVersionId || "").trim();
      if (!requestedTeamVersionId) throw new Error("TEAM_VERSION_REQUIRED: select a team for this task.");
      assertCanonicalTeamVersionId(requestedTeamVersionId);

      return projectStore.withProjectWriteLock(projectId, "project-task-create", async () => {
        const project = await projectStore.getProject(projectId);
        assertCollaborationProject(project);
        const mountedTeams = project.mountedTeams || [];
        if (!mountedTeams.length) throw new Error("PROJECT_TEAM_REQUIRED: mount a team before creating a task.");
        const team = mountedTeams.find((item) => item.teamVersionId === requestedTeamVersionId);
        if (!team) throw new Error("TEAM_VERSION_NOT_MOUNTED: the selected team is not mounted in this project.");

        const requestKey = idempotencyKey ? String(idempotencyKey).trim().slice(0, 160) : "";
        const requestFingerprint = fingerprintRequest(JSON.stringify({
          projectId,
          input: taskInput,
          teamVersionId: team.teamVersionId
        }));
        const existing = (project.taskRecords || []).find((item) => requestKey && item.idempotencyKey === requestKey);
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) {
            throw new Error("IDEMPOTENCY_KEY_REUSE: idempotency key was already used with a different task.");
          }
          return { ...existing, idempotentReplay: true };
        }

        if (!Number.isSafeInteger(project.nextTaskNumber) || project.nextTaskNumber < 1) {
          throw new Error("PROJECT_SCHEMA_UNSUPPORTED: start with a clean latest-format collaboration project.");
        }

        const task = {
          taskId: taskStore.createTaskId(),
          taskNumber: project.nextTaskNumber,
          projectId,
          input: taskInput,
          teamId: team.teamId,
          teamVersionId: team.teamVersionId,
          teamVersionNumber: team.teamVersionNumber,
          teamName: team.teamName,
          status: "queued",
          idempotencyKey: requestKey || null,
          requestFingerprint,
          currentRunId: null,
          runIds: [],
          attemptRequests: {},
          startedAt: null,
          completedAt: null,
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          review: null,
          outputSummary: ""
        };
        await projectStore.saveProjectMetadata(projectId, {
          ...project,
          nextTaskNumber: project.nextTaskNumber + 1,
          taskRecords: [...(project.taskRecords || []), task],
          updatedAt: new Date().toISOString()
        });
        return task;
      });
    }
  });
}
